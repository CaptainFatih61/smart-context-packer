import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Checks whether the specified directory is inside a Git repository.
 */
export function isGitRepository(cwd: string): boolean {
  try {
    const output = execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return output === 'true';
  } catch {
    return false;
  }
}

/**
 * Discovers modified, added, and untracked files in the Git working tree.
 */
export function getGitModifiedFiles(cwd: string, stagedOnly = false): string[] {
  if (!isGitRepository(cwd)) {
    return [];
  }

  const files = new Set<string>();

  try {
    if (stagedOnly) {
      const output = execSync('git diff --name-only --cached', {
        cwd,
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf-8',
      });
      output
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((f) => files.add(f.replace(/\\/g, '/')));
    } else {
      // 1. Unstaged + staged changes against HEAD
      try {
        const diffOutput = execSync('git diff --name-only HEAD', {
          cwd,
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf-8',
        });
        diffOutput
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .forEach((f) => files.add(f.replace(/\\/g, '/')));
      } catch {
        // If repo has no HEAD commit yet, fallback to git diff
        try {
          const fallbackDiff = execSync('git diff --name-only', {
            cwd,
            stdio: ['pipe', 'pipe', 'ignore'],
            encoding: 'utf-8',
          });
          fallbackDiff
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .forEach((f) => files.add(f.replace(/\\/g, '/')));
        } catch {
          // Ignore fallback diff errors
        }
      }

      // 2. Untracked and staged/status porcelain files
      try {
        const statusOutput = execSync('git status --porcelain', {
          cwd,
          stdio: ['pipe', 'pipe', 'ignore'],
          encoding: 'utf-8',
        });

        statusOutput.split(/\r?\n/).forEach((line) => {
          if (!line || line.trim().length === 0) return;
          const status = line.slice(0, 2);
          // Exclude deleted files (' D', 'D ')
          if (status.includes('D')) return;

          let filePath = line.slice(3).trim();
          // Handle renamed files "old -> new"
          if (filePath.includes(' -> ')) {
            filePath = filePath.split(' -> ')[1]!.trim();
          }
          // Remove surrounding quotes if git added them
          filePath = filePath.replace(/^"(.*)"$/, '$1');

          if (filePath) {
            files.add(filePath.replace(/\\/g, '/'));
          }
        });
      } catch {
        // Ignore status porcelain errors
      }
    }
  } catch {
    return [];
  }

  // Filter out files that do not exist on disk (e.g. deleted files) or directories
  const validFiles: string[] = [];
  for (const file of files) {
    const fullPath = path.resolve(cwd, file);
    if (fs.existsSync(fullPath)) {
      try {
        if (fs.statSync(fullPath).isFile()) {
          validFiles.push(file);
        }
      } catch {
        // Ignore stat errors
      }
    }
  }

  return validFiles;
}

/**
 * Retrieves the unified Git diff patch string.
 */
export function getGitDiffPatch(cwd: string, stagedOnly = false): string {
  if (!isGitRepository(cwd)) {
    return '';
  }

  try {
    if (stagedOnly) {
      const patch = execSync('git diff --cached', {
        cwd,
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf-8',
      });
      return patch.replace(/\r\n/g, '\n').trim();
    }

    try {
      // Full working tree diff including staged and unstaged
      const diffHead = execSync('git diff HEAD', {
        cwd,
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf-8',
      });

      if (diffHead && diffHead.trim()) {
        return diffHead.replace(/\r\n/g, '\n').trim();
      }
    } catch {
      // Fallback if no commits exist
    }

    const fallbackPatch = execSync('git diff', {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return fallbackPatch.replace(/\r\n/g, '\n').trim();
  } catch {
    return '';
  }
}
