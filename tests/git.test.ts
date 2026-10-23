import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { isGitRepository, getGitModifiedFiles, getGitDiffPatch } from '../src/git.js';
import { formatContext } from '../src/formatter.js';
import type { DependencyGraph } from '../src/types.js';

describe('Git Diff & Working Tree Resolver', () => {
  const workspaceRoot = path.resolve(__dirname, '..');

  it('detects that the current workspace is a Git repository', () => {
    expect(isGitRepository(workspaceRoot)).toBe(true);
  });

  it('detects that a temporary directory is not a Git repository', () => {
    const tempDir = os.tmpdir();
    // Test a non-existent subfolder inside temp
    const nonGitDir = path.join(tempDir, 'non_git_repo_test_' + Date.now());
    fs.mkdirSync(nonGitDir, { recursive: true });
    try {
      expect(isGitRepository(nonGitDir)).toBe(false);
      expect(getGitModifiedFiles(nonGitDir)).toEqual([]);
      expect(getGitDiffPatch(nonGitDir)).toBe('');
    } finally {
      fs.rmdirSync(nonGitDir);
    }
  });

  it('formats git diff patch in Markdown and XML outputs', () => {
    const samplePatch = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
-console.log("old");
+console.log("new");`;

    const mockGraph: DependencyGraph = {
      targets: ['src/index.ts'],
      rootCwd: workspaceRoot,
      circularWarnings: [],
      missingDependencies: [],
      gitDiffPatch: samplePatch,
      nodes: new Map([
        [
          'src/index.ts',
          {
            filePath: 'src/index.ts',
            absolutePath: path.join(workspaceRoot, 'src/index.ts'),
            type: 'target',
            depth: 0,
            imports: [],
            importedBy: [],
            isSkeleton: false,
            content: 'console.log("new");',
            stats: { lines: 1, characters: 19, estimatedTokens: 5 },
          },
        ],
      ]),
    };

    const md = formatContext(mockGraph, { format: 'md' });
    expect(md).toContain('## Git Diff Patch');
    expect(md).toContain('```diff');
    expect(md).toContain('+console.log("new");');

    const xml = formatContext(mockGraph, { format: 'xml' });
    expect(xml).toContain('<git_diff>');
    expect(xml).toContain('+console.log("new");');
    expect(xml).toContain('</git_diff>');
  });
});
