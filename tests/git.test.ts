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

  it('correctly discovers modified and staged files in an isolated git repository with user identity', async () => {
    const { execSync } = await import('node:child_process');
    const tempRepo = path.join(os.tmpdir(), `scp_git_test_repo_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempRepo, { recursive: true });

    try {
      execSync('git init', { cwd: tempRepo, stdio: 'ignore' });
      execSync('git config user.name "CI Tester"', { cwd: tempRepo, stdio: 'ignore' });
      execSync('git config user.email "ci@example.com"', { cwd: tempRepo, stdio: 'ignore' });

      expect(isGitRepository(tempRepo)).toBe(true);

      // Create initial committed file
      const f1 = path.join(tempRepo, 'file1.ts');
      fs.writeFileSync(f1, 'export const initial = true;\n', 'utf-8');
      execSync('git add file1.ts', { cwd: tempRepo, stdio: 'ignore' });
      execSync('git commit -m "initial commit"', { cwd: tempRepo, stdio: 'ignore' });

      // Modify file1.ts
      fs.appendFileSync(f1, 'export const modified = true;\n', 'utf-8');

      // Create untracked file2.ts
      const f2 = path.join(tempRepo, 'file2.ts');
      fs.writeFileSync(f2, 'export const untracked = true;\n', 'utf-8');

      // Create and stage file3.ts
      const f3 = path.join(tempRepo, 'file3.ts');
      fs.writeFileSync(f3, 'export const staged = true;\n', 'utf-8');
      execSync('git add file3.ts', { cwd: tempRepo, stdio: 'ignore' });

      // Test all working tree files (unstaged, staged, untracked)
      const allModified = getGitModifiedFiles(tempRepo, false);
      expect(allModified).toContain('file1.ts');
      expect(allModified).toContain('file2.ts');
      expect(allModified).toContain('file3.ts');

      const fullPatch = getGitDiffPatch(tempRepo, false);
      expect(fullPatch).toContain('modified');

      // Test staged only
      const stagedOnly = getGitModifiedFiles(tempRepo, true);
      expect(stagedOnly).toContain('file3.ts');
      expect(stagedOnly).not.toContain('file2.ts');

      const stagedPatch = getGitDiffPatch(tempRepo, true);
      expect(stagedPatch).toContain('staged');
    } finally {
      try {
        fs.rmSync(tempRepo, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on locked files in Windows
      }
    }
  });
});
