import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { aggregateTokenStats, calculateFileStats } from '../src/tokens.js';
import { packContext } from '../src/index.js';
import type { DependencyGraph } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleAppDir = path.resolve(__dirname, 'fixtures/sample-app');

describe('Auto Token-Budget Optimizer', () => {
  it('does not skeletonize when budget is sufficient', () => {
    const mockGraph: DependencyGraph = {
      targets: ['src/target.ts'],
      rootCwd: '/mock',
      circularWarnings: [],
      missingDependencies: [],
      nodes: new Map([
        [
          'src/target.ts',
          {
            filePath: 'src/target.ts',
            absolutePath: '/mock/src/target.ts',
            type: 'target',
            depth: 0,
            imports: ['src/dep.ts'],
            importedBy: [],
            isSkeleton: false,
            content: 'export const target = 1;',
            stats: { lines: 1, characters: 24, estimatedTokens: 6 },
          },
        ],
        [
          'src/dep.ts',
          {
            filePath: 'src/dep.ts',
            absolutePath: '/mock/src/dep.ts',
            type: 'dependency',
            depth: 1,
            imports: [],
            importedBy: ['src/target.ts'],
            isSkeleton: false,
            content: 'export function doSomething() {\n  return 42;\n}',
            stats: { lines: 3, characters: 44, estimatedTokens: 12 },
          },
        ],
      ]),
    };

    const stats = aggregateTokenStats(mockGraph, 100);
    expect(stats.budgetOptimized).toBe(false);
    expect(stats.tokensSavedByBudget).toBe(0);
    expect(mockGraph.nodes.get('src/dep.ts')?.isSkeleton).toBe(false);
  });

  it('auto-skeletonizes deepest dependencies first when budget is exceeded', () => {
    const longFn = `export function complexFunction(a: number, b: string): boolean {
  // Heavy computational logic with many variables and branches
  const data = Array.from({ length: 100 }, (_, i) => i * 2);
  const filtered = data.filter((x) => x % 3 === 0);
  const mapped = filtered.map((y) => ({ key: String(y), val: y * 10 }));
  console.log("Processed items count:", mapped.length, a, b);
  return mapped.length > 0;
}`;

    const targetCode = 'import { d1 } from "./depth1";\nexport const run = () => d1();';

    const mockGraph: DependencyGraph = {
      targets: ['src/target.ts'],
      rootCwd: '/mock',
      circularWarnings: [],
      missingDependencies: [],
      nodes: new Map([
        [
          'src/target.ts',
          {
            filePath: 'src/target.ts',
            absolutePath: '/mock/src/target.ts',
            type: 'target',
            depth: 0,
            imports: ['src/depth1.ts'],
            importedBy: [],
            isSkeleton: false,
            content: targetCode,
            stats: calculateFileStats(targetCode),
          },
        ],
        [
          'src/depth1.ts',
          {
            filePath: 'src/depth1.ts',
            absolutePath: '/mock/src/depth1.ts',
            type: 'dependency',
            depth: 1,
            imports: ['src/depth2.ts'],
            importedBy: ['src/target.ts'],
            isSkeleton: false,
            content: longFn,
            stats: calculateFileStats(longFn),
          },
        ],
        [
          'src/depth2.ts',
          {
            filePath: 'src/depth2.ts',
            absolutePath: '/mock/src/depth2.ts',
            type: 'dependency',
            depth: 2,
            imports: [],
            importedBy: ['src/depth1.ts'],
            isSkeleton: false,
            content: longFn,
            stats: calculateFileStats(longFn),
          },
        ],
      ]),
    };

    // Total tokens: target ~15, depth1 ~149, depth2 ~149 => ~313.
    // Set budget to 250: depth 2 should be skeletonized first!
    const stats = aggregateTokenStats(mockGraph, 250);

    expect(stats.budgetOptimized).toBe(true);
    expect(stats.tokensSavedByBudget).toBeGreaterThan(0);
    // Depth 0 target MUST NOT be skeletonized
    expect(mockGraph.nodes.get('src/target.ts')?.isSkeleton).toBe(false);
    // Depth 2 dependency should be skeletonized first
    expect(mockGraph.nodes.get('src/depth2.ts')?.isSkeleton).toBe(true);
    expect(mockGraph.nodes.get('src/depth2.ts')?.content).toContain('/* [Implementation omitted for token efficiency] */');
  });

  it('integrates auto-skeletonization through packContext API', async () => {
    const targetFile = path.resolve(sampleAppDir, 'src/index.ts');

    // Run packContext with a very tight maxTokens budget
    const result = await packContext({
      targets: [targetFile],
      cwd: sampleAppDir,
      depth: 2,
      maxTokens: 50,
      quiet: true,
    });

    expect(result.stats.budgetOptimized).toBe(true);
    expect(result.stats.tokensSavedByBudget).toBeGreaterThan(0);
    expect(result.formattedPrompt).toContain('SMART CONTEXT PACKER: AI DIRECTIVE');
  });
});
