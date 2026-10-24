import path from 'node:path';
import pc from 'picocolors';
import type { FileStats, TokenStats, DependencyGraph } from './types.js';
import { extractSkeleton, sliceMassiveFile } from './filter.js';
export { renderAsciiProgressBar } from './hud.js';

export const CONTEXT_WINDOW_128K = 131072;
export const CONTEXT_WINDOW_200K = 204800;

/**
 * Fast, accurate token estimator for code and mixed text.
 * Approximates BPE tokenization (OpenAI cl100k/o200k, Claude, Gemini)
 * without requiring heavy native WASM dependencies.
 */
export function estimateTokensForText(text: string): number {
  if (!text || text.length === 0) return 0;

  // Split into tokens: words/identifiers, symbols/punctuation, and whitespace runs
  // Code tends to have multiple symbols and indentation chunks.
  const regex = /[a-zA-Z0-9_$]+|[^\s\w]|\n|\r\n|[ ]{2,}|[ \t]/g;
  const matches = text.match(regex);
  if (!matches) {
    return Math.ceil(text.length / 4);
  }

  let count = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    if (m === ' ' || m === '\t') {
      count += 0.5; // Single spaces often merge with preceding/following tokens
    } else if (m === '\n' || m === '\r\n') {
      count += 1;
    } else if (m.length > 8) {
      // Long identifiers or strings break into multiple subwords
      count += Math.ceil(m.length / 4);
    } else {
      count += 1;
    }
  }

  return Math.max(1, Math.round(count));
}

export const estimateTokens = estimateTokensForText;

/**
 * Computes line count, character count, and token estimate for a file's content.
 */
export function calculateFileStats(content: string): FileStats {
  const characters = content.length;
  const lines = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  const estimatedTokens = estimateTokensForText(content);
  return { lines, characters, estimatedTokens };
}

/**
 * Aggregates statistics across all nodes in the dependency graph.
 * When maxTokens is provided, auto-skeletonizes deeper dependencies to fit within budget.
 */
export function aggregateTokenStats(graph: DependencyGraph, maxTokens?: number): TokenStats {
  let totalTokens = 0;
  let totalLines = 0;
  let totalChars = 0;

  for (const [, node] of graph.nodes) {
    totalTokens += node.stats.estimatedTokens;
    totalLines += node.stats.lines;
    totalChars += node.stats.characters;
  }

  let budgetOptimized = false;
  let tokensSavedByBudget = 0;

  // If over budget, auto-skeletonize dependencies starting from deepest files down to depth 1
  if (maxTokens !== undefined && maxTokens > 0 && totalTokens > maxTokens) {
    const initialTokens = totalTokens;

    // Collect candidate dependency nodes (depth > 0, not target, not yet skeleton)
    const candidates = Array.from(graph.nodes.values()).filter(
      (n) => n.type !== 'target' && n.depth > 0 && !n.isSkeleton
    );

    // Sort: deepest dependencies first; then largest tokens first
    candidates.sort((a, b) => {
      if (b.depth !== a.depth) return b.depth - a.depth;
      return b.stats.estimatedTokens - a.stats.estimatedTokens;
    });

    let convertedAny = false;
    for (const node of candidates) {
      const ext = path.extname(node.filePath);
      const skeletonContent = extractSkeleton(node.content, ext);
      const newStats = calculateFileStats(skeletonContent);

      const tokenDiff = node.stats.estimatedTokens - newStats.estimatedTokens;
      const lineDiff = node.stats.lines - newStats.lines;
      const charDiff = node.stats.characters - newStats.characters;

      node.content = skeletonContent;
      node.isSkeleton = true;
      node.stats = newStats;
      convertedAny = true;

      totalTokens -= tokenDiff;
      totalLines -= lineDiff;
      totalChars -= charDiff;

      if (totalTokens <= maxTokens) {
        break;
      }
    }

    // Secondary pass: if still over budget, slice massive nodes (>400 lines)
    if (totalTokens > maxTokens) {
      const massiveNodes = Array.from(graph.nodes.values()).filter((n) => n.stats.lines > 400);
      massiveNodes.sort((a, b) => b.stats.lines - a.stats.lines);

      for (const node of massiveNodes) {
        const sliced = sliceMassiveFile(node.content, 300);
        if (sliced !== node.content) {
          const newStats = calculateFileStats(sliced);
          const tokenDiff = node.stats.estimatedTokens - newStats.estimatedTokens;
          const lineDiff = node.stats.lines - newStats.lines;
          const charDiff = node.stats.characters - newStats.characters;

          node.content = sliced;
          node.stats = newStats;
          totalTokens -= tokenDiff;
          totalLines -= lineDiff;
          totalChars -= charDiff;
          convertedAny = true;

          if (totalTokens <= maxTokens) break;
        }
      }
    }

    if (convertedAny) {
      budgetOptimized = true;
      tokensSavedByBudget = Math.max(0, initialTokens - totalTokens);
    }
  }

  const fileBreakdown: TokenStats['fileBreakdown'] = [];
  for (const [filePath, node] of graph.nodes) {
    fileBreakdown.push({
      filePath,
      tokens: node.stats.estimatedTokens,
      lines: node.stats.lines,
      isSkeleton: node.isSkeleton,
    });
  }

  const pct128k = Number(((totalTokens / CONTEXT_WINDOW_128K) * 100).toFixed(2));
  const pct200k = Number(((totalTokens / CONTEXT_WINDOW_200K) * 100).toFixed(2));

  return {
    totalTokens,
    totalLines,
    totalChars,
    pct128k,
    pct200k,
    budgetOptimized,
    tokensSavedByBudget,
    fileBreakdown,
  };
}

/**
 * Formats a terminal summary card with picocolors.
 */
export function renderTerminalSummary(
  graph: DependencyGraph,
  stats: TokenStats,
  destination: { file?: string; clipboard?: boolean }
): string {
  const totalFiles = graph.nodes.size;
  const targetCount = graph.targets.length;
  const depCount = totalFiles - targetCount;
  const skeletonCount = Array.from(graph.nodes.values()).filter((n) => n.isSkeleton).length;

  const pad = (str: string, length: number) => str.padEnd(length);
  const numFmt = (n: number) => n.toLocaleString();

  const lines = [
    pc.cyan('╭─────────────────────────────────────────────────────────────╮'),
    pc.cyan('│ ') + pc.bold(pc.white('📦  smart-context-packer summary')) + '                          ' + pc.cyan('│'),
    pc.cyan('├─────────────────────────────────────────────────────────────┤'),
    pc.cyan('│ ') + pad(pc.gray('Targets:'), 22) + pc.green(pc.bold(numFmt(targetCount))) + ' target file(s)' + '             '.slice(0, 15 - numFmt(targetCount).length) + pc.cyan('│'),
    pc.cyan('│ ') + pad(pc.gray('Packed Files:'), 22) + pc.yellow(pc.bold(numFmt(totalFiles))) + ` total (${depCount} deps, ${skeletonCount} skeleton)` + '   '.slice(0, 7) + pc.cyan('│'),
    pc.cyan('│ ') + pad(pc.gray('Lines of Code:'), 22) + pc.white(numFmt(stats.totalLines)) + '                           '.slice(0, 24 - numFmt(stats.totalLines).length) + pc.cyan('│'),
    pc.cyan('│ ') + pad(pc.gray('Total Characters:'), 22) + pc.white(numFmt(stats.totalChars)) + '                           '.slice(0, 24 - numFmt(stats.totalChars).length) + pc.cyan('│'),
    pc.cyan('│ ') + pad(pc.gray('Estimated Tokens:'), 22) + pc.magenta(pc.bold(numFmt(stats.totalTokens))) + ' tokens' + '                      '.slice(0, 17 - numFmt(stats.totalTokens).length) + pc.cyan('│'),
    pc.cyan('├─────────────────────────────────────────────────────────────┤'),
    pc.cyan('│ ') + pc.bold(pc.white('Context Window Usage:')) + '                                      ' + pc.cyan('│'),
    pc.cyan('│ ') + pad(pc.gray(' • 128k (GPT-4o):'), 24) + formatPercentage(stats.pct128k) + '                           '.slice(0, 22 - `${stats.pct128k}%`.length) + pc.cyan('│'),
    pc.cyan('│ ') + pad(pc.gray(' • 200k (Claude/Gemini):'), 24) + formatPercentage(stats.pct200k) + '                           '.slice(0, 22 - `${stats.pct200k}%`.length) + pc.cyan('│'),
    pc.cyan('├─────────────────────────────────────────────────────────────┤'),
  ];

  if (stats.budgetOptimized && stats.tokensSavedByBudget) {
    const budgetMsg = `✔ ${numFmt(stats.tokensSavedByBudget)} tokens saved`;
    const rightPad = Math.max(1, 37 - budgetMsg.length);
    lines.push(
      pc.cyan('│ ') + pad(pc.gray('Budget Optimized:'), 22) + pc.green(budgetMsg) + ' '.repeat(rightPad) + pc.cyan('│')
    );
  }

  if (graph.blastRadius) {
    const riskLevelColor =
      graph.blastRadius.level === 'HIGH'
        ? pc.red(pc.bold(graph.blastRadius.level))
        : graph.blastRadius.level === 'MEDIUM'
        ? pc.yellow(pc.bold(graph.blastRadius.level))
        : pc.green(pc.bold(graph.blastRadius.level));
    const blastMsg = `${riskLevelColor} (${graph.blastRadius.score}/10) | ${graph.blastRadius.impactedTests.length} tests`;
    lines.push(
      pc.cyan('│ ') + pad(pc.gray('Blast Radius:'), 22) + blastMsg + ' '.repeat(Math.max(1, 36 - `${graph.blastRadius.level} (${graph.blastRadius.score}/10) | ${graph.blastRadius.impactedTests.length} tests`.length)) + pc.cyan('│')
    );
  }

  if (graph.memories && graph.memories.length > 0) {
    const memMsg = `${graph.memories.length} notes linked`;
    lines.push(
      pc.cyan('│ ') + pad(pc.gray('Project Memory:'), 22) + pc.blue(memMsg) + ' '.repeat(Math.max(1, 36 - memMsg.length)) + pc.cyan('│')
    );
  }

  if (destination.file) {
    lines.push(
      pc.cyan('│ ') + pad(pc.gray('Output File:'), 22) + pc.blue(destination.file) + ' '.repeat(Math.max(1, 36 - destination.file.length)) + pc.cyan('│')
    );
  }
  if (destination.clipboard) {
    lines.push(
      pc.cyan('│ ') + pad(pc.gray('Clipboard:'), 22) + pc.green('✔ Copied to system clipboard') + '          ' + pc.cyan('│')
    );
  }

  if (graph.circularWarnings.length > 0) {
    lines.push(pc.cyan('├─────────────────────────────────────────────────────────────┤'));
    lines.push(
      pc.cyan('│ ') + pc.yellow(`⚠  Circular References: ${graph.circularWarnings.length} detected (handled safely)`) + ' '.repeat(Math.max(1, 10)) + pc.cyan('│')
    );
  }

  lines.push(pc.cyan('╰─────────────────────────────────────────────────────────────╯'));
  return lines.join('\n');
}

function formatPercentage(pct: number): string {
  if (pct < 25) return pc.green(`${pct}%`);
  if (pct < 65) return pc.yellow(`${pct}%`);
  return pc.red(pc.bold(`${pct}%`));
}
