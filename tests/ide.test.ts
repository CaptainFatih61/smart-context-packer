import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { initVsCodeTasks } from '../src/ide.js';

describe('VS Code Tasks & Command Palette Generator', () => {
  const testDir = path.join(os.tmpdir(), `scp_vscode_test_${Date.now()}`);

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates new .vscode/tasks.json when none exists', () => {
    fs.mkdirSync(testDir, { recursive: true });

    const result = initVsCodeTasks(testDir);
    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.taskCount).toBe(3);

    const tasksFilePath = path.join(testDir, '.vscode/tasks.json');
    expect(fs.existsSync(tasksFilePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(tasksFilePath, 'utf-8'));
    expect(content.version).toBe('2.0.0');
    expect(content.tasks).toHaveLength(3);

    const labels = content.tasks.map((t: any) => t.label);
    expect(labels).toContain('SCP: Pack Active File + Dependencies (Copy to Clipboard)');
    expect(labels).toContain('SCP: Pack Active File (Skeleton Mode -> Clipboard)');
    expect(labels).toContain('SCP: Pack Git Diff + Dependencies (Copy to Clipboard)');
  });

  it('safely merges into existing tasks.json preserving existing custom tasks', () => {
    fs.mkdirSync(path.join(testDir, '.vscode'), { recursive: true });
    const tasksFilePath = path.join(testDir, '.vscode/tasks.json');

    const initialConfig = {
      version: '2.0.0',
      tasks: [
        {
          label: 'Custom: Run Linter',
          type: 'shell',
          command: 'npm run lint',
        },
      ],
    };
    fs.writeFileSync(tasksFilePath, JSON.stringify(initialConfig, null, 2), 'utf-8');

    const result = initVsCodeTasks(testDir);
    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(result.taskCount).toBe(4); // 1 existing + 3 scp tasks

    const content = JSON.parse(fs.readFileSync(tasksFilePath, 'utf-8'));
    const labels = content.tasks.map((t: any) => t.label);
    expect(labels).toContain('Custom: Run Linter');
    expect(labels).toContain('SCP: Pack Active File + Dependencies (Copy to Clipboard)');
  });
});
