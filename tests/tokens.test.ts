import { describe, it, expect } from 'vitest';
import {
  estimateTokensForText,
  calculateFileStats,
  aggregateTokenStats,
  renderTerminalSummary,
  CONTEXT_WINDOW_128K,
  CONTEXT_WINDOW_200K,
} from '../src/tokens.js';
import type { DependencyGraph } from '../src/types.js';

describe('Token Estimation & Statistics', () => {
  it('estimates token count for plain text and code snippets', () => {
    expect(estimateTokensForText('')).toBe(0);
    const shortText = 'const x = 42;';
    const tokens = estimateTokensForText(shortText);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('calculates line, character, and token stats correctly', () => {
    const code = 'function test() {\n  return "hello world";\n}\n';
    const stats = calculateFileStats(code);

    expect(stats.lines).toBe(4);
    expect(stats.characters).toBe(code.length);
    expect(stats.estimatedTokens).toBeGreaterThan(3);
  });

  it('aggregates statistics across all graph nodes', () => {
    const mockGraph: DependencyGraph = {
      targets: ['src/a.ts'],
      rootCwd: '/mock',
      circularWarnings: [],
      missingDependencies: [],
      nodes: new Map([
        [
          'src/a.ts',
          {
            filePath: 'src/a.ts',
            absolutePath: '/mock/src/a.ts',
            type: 'target',
            depth: 0,
            imports: [],
            importedBy: [],
            isSkeleton: false,
            content: 'console.log("hello");',
            stats: { lines: 1, characters: 21, estimatedTokens: 5 },
          },
        ],
        [
          'src/b.ts',
          {
            filePath: 'src/b.ts',
            absolutePath: '/mock/src/b.ts',
            type: 'dependency',
            depth: 1,
            imports: [],
            importedBy: [],
            isSkeleton: true,
            content: 'export const b = 1;',
            stats: { lines: 1, characters: 19, estimatedTokens: 6 },
          },
        ],
      ]),
    };

    const aggregated = aggregateTokenStats(mockGraph);

    expect(aggregated.totalLines).toBe(2);
    expect(aggregated.totalChars).toBe(40);
    expect(aggregated.totalTokens).toBe(11);
    expect(aggregated.pct128k).toBe(Number(((11 / CONTEXT_WINDOW_128K) * 100).toFixed(2)));
    expect(aggregated.pct200k).toBe(Number(((11 / CONTEXT_WINDOW_200K) * 100).toFixed(2)));
    expect(aggregated.fileBreakdown).toHaveLength(2);
  });

  it('renders a terminal summary box', () => {
    const mockGraph: DependencyGraph = {
      targets: ['src/a.ts'],
      rootCwd: '/mock',
      circularWarnings: [],
      missingDependencies: [],
      nodes: new Map(),
    };

    const summary = renderTerminalSummary(
      mockGraph,
      {
        totalTokens: 500,
        totalLines: 120,
        totalChars: 3200,
        pct128k: 0.38,
        pct200k: 0.24,
        fileBreakdown: [],
      },
      { file: '.context-pack.md', clipboard: true }
    );

    expect(summary).toContain('smart-context-packer summary');
    expect(summary).toContain('Estimated Tokens:');
    expect(summary).toContain('.context-pack.md');
    expect(summary).toContain('Copied to system clipboard');
  });

  it('applies secondary middle-out slicing to massive files when budget is exceeded', () => {
    const hugeLines = Array.from({ length: 600 }, (_, i) => `const row_${i} = ${i};`).join('\n');
    const mockGraph: DependencyGraph = {
      targets: ['src/huge.ts'],
      rootCwd: '/mock',
      circularWarnings: [],
      missingDependencies: [],
      nodes: new Map([
        [
          'src/huge.ts',
          {
            filePath: 'src/huge.ts',
            absolutePath: '/mock/src/huge.ts',
            type: 'target',
            depth: 0,
            imports: [],
            importedBy: [],
            isSkeleton: false,
            content: hugeLines,
            stats: { lines: 600, characters: hugeLines.length, estimatedTokens: 3000 },
          },
        ],
      ]),
    };

    const result = aggregateTokenStats(mockGraph, 1500);
    expect(result.budgetOptimized).toBe(true);
    expect(mockGraph.nodes.get('src/huge.ts')?.content).toContain('intermediate lines omitted to fit token budget');
    expect(mockGraph.nodes.get('src/huge.ts')?.stats.lines).toBeLessThanOrEqual(400);
  });
});
