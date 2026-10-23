import pc from 'picocolors';
import type { FileStats, TokenStats, DependencyGraph } from './types.js';

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
 */
export function aggregateTokenStats(graph: DependencyGraph): TokenStats {
  let totalTokens = 0;
  let totalLines = 0;
  let totalChars = 0;
  const fileBreakdown: TokenStats['fileBreakdown'] = [];

  for (const [filePath, node] of graph.nodes) {
    totalTokens += node.stats.estimatedTokens;
    totalLines += node.stats.lines;
    totalChars += node.stats.characters;
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
