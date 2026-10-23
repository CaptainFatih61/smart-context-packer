import { describe, it, expect } from 'vitest';
import { formatContext, AI_PREFLIGHT_DIRECTIVE, renderAsciiTree, renderDependencyMap } from '../src/formatter.js';
import type { DependencyGraph } from '../src/types.js';

describe('ContextFormatter', () => {
  const mockGraph: DependencyGraph = {
    targets: ['src/main.ts'],
    rootCwd: '/mock/app',
    circularWarnings: [],
    missingDependencies: [],
    nodes: new Map([
      [
        'src/main.ts',
        {
          filePath: 'src/main.ts',
          absolutePath: '/mock/app/src/main.ts',
          type: 'target',
          depth: 0,
          imports: ['src/utils.ts'],
          importedBy: [],
          isSkeleton: false,
          content: 'import { log } from "./utils";\nlog("hello");',
          stats: { lines: 2, characters: 43, estimatedTokens: 12 },
        },
      ],
      [
        'src/utils.ts',
        {
          filePath: 'src/utils.ts',
          absolutePath: '/mock/app/src/utils.ts',
          type: 'dependency',
          depth: 1,
          imports: [],
          importedBy: ['src/main.ts'],
          isSkeleton: true,
          content: 'export function log(msg: string): void {}',
          stats: { lines: 1, characters: 41, estimatedTokens: 11 },
        },
      ],
    ]),
  };

  it('generates standard Markdown output with directive, tree, and map', () => {
    const md = formatContext(mockGraph, { format: 'md' });

    expect(md).toContain(AI_PREFLIGHT_DIRECTIVE);
    expect(md).toContain('## Project Hierarchy');
    expect(md).toContain('## Dependency Graph Map');
    expect(md).toContain('### File: `src/main.ts` (TARGET)');
    expect(md).toContain('### File: `src/utils.ts` (DEP: depth 1, SKELETON)');
    expect(md).toContain('export function log(msg: string): void {}');
  });

  it('generates structured XML output when requested', () => {
    const xml = formatContext(mockGraph, { format: 'xml' });

    expect(xml).toContain('<context_pack generator="smart-context-packer">');
    expect(xml).toContain('<directive>');
    expect(xml).toContain('<hierarchy>');
    expect(xml).toContain('<file path="src/main.ts" type="target"');
    expect(xml).toContain('</context_pack>');
  });

  it('renders clean ASCII hierarchy tree', () => {
    const tree = renderAsciiTree(mockGraph);
    expect(tree).toContain('main.ts [TARGET]');
    expect(tree).toContain('utils.ts [DEP: depth 1, SKELETON]');
  });

  it('renders clean dependency map', () => {
    const map = renderDependencyMap(mockGraph);
    expect(map).toContain('src/main.ts -> imports -> ["src/utils.ts"]');
    expect(map).toContain('src/utils.ts -> (no local imports)');
  });

  it('supports tree-only mode without file bodies', () => {
    const md = formatContext(mockGraph, { format: 'md', treeOnly: true });

    expect(md).toContain('## Project Hierarchy');
    expect(md).toContain('## Dependency Graph Map');
    expect(md).not.toContain('## Packed Files');
    expect(md).not.toContain('export function log');
  });
});
