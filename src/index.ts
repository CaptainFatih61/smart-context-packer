import fs from 'node:fs';
import path from 'node:path';
import clipboardy from 'clipboardy';
import type { PackOptions, PackResult } from './types.js';
import { DependencyAnalyzer } from './analyzer.js';
import { aggregateTokenStats } from './tokens.js';
import { ContextFormatter } from './formatter.js';

export * from './types.js';
export * from './analyzer.js';
export * from './filter.js';
export * from './formatter.js';
export * from './tokens.js';

/**
 * Main programmatic API to pack dependencies and generate AI context prompts.
 */
export async function packContext(options: PackOptions): Promise<PackResult> {
  const cwd = path.resolve(options.cwd || process.cwd());
  const analyzer = new DependencyAnalyzer({
    cwd,
    maxDepth: options.depth ?? options.maxDepth ?? 2,
    reverse: options.reverse ?? false,
    skeleton: options.skeleton ?? false,
    redact: options.redact ?? true,
    customAliases: options.customAliases,
    ignorePatterns: options.ignorePatterns,
  });

  const graph = await analyzer.analyze(options.targets);
  const stats = aggregateTokenStats(graph);

  const formatter = new ContextFormatter({
    format: options.format || 'md',
    treeOnly: options.treeOnly || false,
    includeStatsSummary: options.includeStatsSummary !== false,
  });

  const formattedPrompt = formatter.format(graph, stats);

  let outputPath: string | undefined;
  if (options.output) {
    outputPath = path.resolve(cwd, options.output);
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, formattedPrompt, 'utf-8');
  }

  let copiedToClipboard = false;
  if (options.copy) {
    try {
      await clipboardy.write(formattedPrompt);
      copiedToClipboard = true;
    } catch (err) {
      if (!options.quiet) {
        console.warn('Warning: Failed to copy to clipboard:', err);
      }
    }
  }

  return {
    formattedPrompt,
    stats,
    graph,
    outputPath,
    copiedToClipboard,
  };
}
