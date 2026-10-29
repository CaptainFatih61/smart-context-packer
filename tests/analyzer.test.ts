import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DependencyAnalyzer, analyzeDependencies } from '../src/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleAppDir = path.resolve(__dirname, 'fixtures/sample-app');

describe('DependencyAnalyzer (TypeScript/JS/Vue)', () => {
  it('resolves direct and transitive dependencies with tsconfig aliases', async () => {
    const analyzer = new DependencyAnalyzer({
      cwd: sampleAppDir,
      maxDepth: 3,
    });

    const graph = await analyzer.analyze(['src/index.ts']);

    expect(graph.targets).toContain('src/index.ts');
    expect(graph.nodes.has('src/index.ts')).toBe(true);

    // Should resolve @/services/auth.js -> src/services/auth.ts
    expect(graph.nodes.has('src/services/auth.ts')).toBe(true);

    // Should resolve ./utils/helpers.js -> src/utils/helpers.ts
    expect(graph.nodes.has('src/utils/helpers.ts')).toBe(true);

    // Should resolve transitive @/models/user.js -> src/models/user.ts
    expect(graph.nodes.has('src/models/user.ts')).toBe(true);

    const indexNode = graph.nodes.get('src/index.ts')!;
    expect(indexNode.type).toBe('target');
    expect(indexNode.depth).toBe(0);
    expect(indexNode.imports).toContain('src/services/auth.ts');
    expect(indexNode.imports).toContain('src/utils/helpers.ts');

    const authNode = graph.nodes.get('src/services/auth.ts')!;
    expect(authNode.type).toBe('dependency');
    expect(authNode.depth).toBe(1);
    expect(authNode.imports).toContain('src/models/user.ts');
  });

  it('respects depth limits', async () => {
    // Depth 0: only target file
    const graphDepth0 = await analyzeDependencies(['src/index.ts'], {
      cwd: sampleAppDir,
      maxDepth: 0,
    });
    expect(graphDepth0.nodes.size).toBe(1);
    expect(graphDepth0.nodes.has('src/index.ts')).toBe(true);
    expect(graphDepth0.nodes.has('src/services/auth.ts')).toBe(false);

    // Depth 1: target + direct dependencies only
    const graphDepth1 = await analyzeDependencies(['src/index.ts'], {
      cwd: sampleAppDir,
      maxDepth: 1,
    });
    expect(graphDepth1.nodes.has('src/index.ts')).toBe(true);
    expect(graphDepth1.nodes.has('src/services/auth.ts')).toBe(true);
    expect(graphDepth1.nodes.has('src/utils/helpers.ts')).toBe(true);
    // user.ts is depth 2 (transitive from auth.ts), so it must NOT be included at depth 1
    expect(graphDepth1.nodes.has('src/models/user.ts')).toBe(false);
  });

  it('parses Vue Single File Components script imports', async () => {
    const analyzer = new DependencyAnalyzer({
      cwd: sampleAppDir,
      maxDepth: 2,
    });

    const graph = await analyzer.analyze(['src/components/Card.vue']);

    expect(graph.nodes.has('src/components/Card.vue')).toBe(true);
    expect(graph.nodes.has('src/models/user.ts')).toBe(true);
    expect(graph.nodes.has('src/utils/helpers.ts')).toBe(true);

    const cardNode = graph.nodes.get('src/components/Card.vue')!;
    expect(cardNode.imports).toContain('src/models/user.ts');
    expect(cardNode.imports).toContain('src/utils/helpers.ts');
  });

  it('discovers reverse dependencies when --reverse is enabled', async () => {
    const analyzer = new DependencyAnalyzer({
      cwd: sampleAppDir,
      maxDepth: 1,
      reverse: true,
    });

    // Target the leaf helper file
    const graph = await analyzer.analyze(['src/utils/helpers.ts']);

    expect(graph.nodes.has('src/utils/helpers.ts')).toBe(true);
    // Files that import helpers.ts should be discovered in reverse mode:
    // src/index.ts and src/components/Card.vue import helpers.ts
    const importedByFiles = Array.from(graph.nodes.keys());
    expect(importedByFiles).toContain('src/index.ts');
  });

  it('prunes unused exported functions in dependencies when treeShake: true', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-treeshake-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'utils.ts'),
        [
          'export function usedHelper(x: number): number {',
          '  return internalMath(x) + 1;',
          '}',
          '',
          'function internalMath(n: number): number {',
          '  return n * 2;',
          '}',
          '',
          'export function unusedHeavyFunction(): string {',
          '  return "this should be pruned by tree-shaker";',
          '}',
        ].join('\n'),
        'utf-8'
      );

      fs.writeFileSync(
        path.join(tmpDir, 'entry.ts'),
        `import { usedHelper } from './utils.js';\nconsole.log(usedHelper(5));\n`,
        'utf-8'
      );

      const analyzer = new DependencyAnalyzer({ cwd: tmpDir, treeShake: true });
      const graph = await analyzer.analyze(['entry.ts']);

      const utilsNode = graph.nodes.get('utils.ts');
      expect(utilsNode).toBeDefined();
      expect(utilsNode?.isTreeShaken).toBe(true);
      expect(utilsNode?.content).toContain('export function usedHelper');
      expect(utilsNode?.content).toContain('function internalMath');
      expect(utilsNode?.content).not.toContain('return "this should be pruned by tree-shaker"');
      expect(utilsNode?.content).toContain('pruned 1 unused symbol(s): unusedHeavyFunction');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('automatically resolves Monorepo workspace packages (packages/*)', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-monorepo-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'root-monorepo', private: true, workspaces: ['packages/*'] }),
        'utf-8'
      );

      const sharedDir = path.join(tmpDir, 'packages', 'shared', 'src');
      const webDir = path.join(tmpDir, 'packages', 'web', 'src');
      fs.mkdirSync(sharedDir, { recursive: true });
      fs.mkdirSync(webDir, { recursive: true });

      fs.writeFileSync(
        path.join(tmpDir, 'packages', 'shared', 'package.json'),
        JSON.stringify({ name: '@acme/shared', main: './src/index.ts' }),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(sharedDir, 'index.ts'),
        'export const SHARED_VERSION = "1.0.0";\n',
        'utf-8'
      );

      fs.writeFileSync(
        path.join(webDir, 'app.ts'),
        `import { SHARED_VERSION } from '@acme/shared';\nconsole.log(SHARED_VERSION);\n`,
        'utf-8'
      );

      const analyzer = new DependencyAnalyzer({ cwd: tmpDir });
      const graph = await analyzer.analyze(['packages/web/src/app.ts']);

      expect(graph.nodes.has('packages/shared/src/index.ts')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
