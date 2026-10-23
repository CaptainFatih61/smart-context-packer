import { describe, it, expect } from 'vitest';
import { calculatePageRank, generateRepoMap } from '../src/repo-map.js';
import type { DependencyGraph } from '../src/types.js';

describe('Dependency Graph PageRank & Repo-Map Engine (src/repo-map.ts)', () => {
  const mockGraph: DependencyGraph = {
    'src/types.ts': {
      path: 'src/types.ts',
      content: 'export interface User { id: string; }\nexport type ID = string;',
      depth: 2,
      rawImports: []
    },
    'src/db.ts': {
      path: 'src/db.ts',
      content: 'import { User } from "./types.js";\nexport class Database {}',
      depth: 1,
      rawImports: ['src/types.ts']
    },
    'src/auth.ts': {
      path: 'src/auth.ts',
      content: 'import { User } from "./types.js";\nimport { Database } from "./db.js";\nexport function login() {}',
      depth: 1,
      rawImports: ['src/types.ts', 'src/db.ts']
    },
    'src/api.ts': {
      path: 'src/api.ts',
      content: 'import { login } from "./auth.js";\nimport { User } from "./types.js";\nexport const router = {};',
      depth: 0,
      rawImports: ['src/auth.ts', 'src/types.ts']
    }
  };

  it('calculates PageRank centrality correctly with types.ts as the top hub', () => {
    const pageRank = calculatePageRank(mockGraph);
    expect(pageRank.size).toBe(4);

    // src/types.ts is imported by db.ts, auth.ts, and api.ts (highest in-degree)
    const typesScore = pageRank.get('src/types.ts')?.score || 0;
    const apiScore = pageRank.get('src/api.ts')?.score || 0;

    expect(typesScore).toBeGreaterThan(apiScore);
    expect(pageRank.get('src/types.ts')?.inDegree).toBe(3);
  });

  it('generates a formatted architectural repo-map with ranked hubs and exported symbols', () => {
    const result = generateRepoMap(mockGraph, { maxTokens: 1000 });
    expect(result.rankedNodes.length).toBe(4);
    expect(result.rankedNodes[0].path).toBe('src/types.ts');
    expect(result.mapText).toContain('Codebase Architectural Repo-Map');
    expect(result.mapText).toContain('src/types.ts');
    expect(result.mapText).toContain('User');
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBeLessThan(1000);
  });

  it('truncates gracefully when maxTokens budget is tight', () => {
    const result = generateRepoMap(mockGraph, { maxTokens: 80 });
    expect(result.mapText).toContain('Repo-map truncated to fit token ceiling');
  });
});
