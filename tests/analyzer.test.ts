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
});
