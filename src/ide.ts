import fs from 'node:fs';
import path from 'node:path';

export interface VsCodeTask {
  label: string;
  type: string;
  command: string;
  problemMatcher: unknown[];
  presentation?: {
    reveal?: string;
    close?: boolean;
    panel?: string;
  };
}

export interface VsCodeTasksConfig {
  version: string;
  tasks: VsCodeTask[];
}

export const STANDARD_SCP_TASKS: VsCodeTask[] = [
  {
    label: 'SCP: Pack Active File + Dependencies (Copy to Clipboard)',
    type: 'shell',
    command: 'npx scp ${relativeFile} --copy',
    problemMatcher: [],
    presentation: {
      reveal: 'silent',
      close: true,
    },
  },
  {
    label: 'SCP: Pack Active File (Skeleton Mode -> Clipboard)',
    type: 'shell',
    command: 'npx scp ${relativeFile} --skeleton --copy',
    problemMatcher: [],
    presentation: {
      reveal: 'silent',
      close: true,
    },
  },
  {
    label: 'SCP: Pack Git Diff + Dependencies (Copy to Clipboard)',
    type: 'shell',
    command: 'npx scp --diff --copy',
    problemMatcher: [],
    presentation: {
      reveal: 'silent',
      close: true,
    },
  },
];

export interface InitVsCodeResult {
  created: boolean;
  updated: boolean;
  tasksPath: string;
  taskCount: number;
}

/**
 * Initializes or merges .vscode/tasks.json with smart-context-packer tasks.
 */
export function initVsCodeTasks(workspaceRoot = process.cwd()): InitVsCodeResult {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  const tasksPath = path.join(vscodeDir, 'tasks.json');

  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }

  let config: VsCodeTasksConfig = {
    version: '2.0.0',
    tasks: [],
  };

  let isCreated = true;

  if (fs.existsSync(tasksPath)) {
    isCreated = false;
    try {
      const raw = fs.readFileSync(tasksPath, 'utf-8');
      // Strip comments from json
      const cleaned = raw.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
      const parsed = JSON.parse(cleaned);
      config = {
        version: parsed.version || '2.0.0',
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      };
    } catch {
      // If corrupted or invalid JSON, start fresh with standard tasks
      config = { version: '2.0.0', tasks: [] };
    }
  }

  // Merge standard SCP tasks (replace existing with same label or append)
  const scpLabels = new Set(STANDARD_SCP_TASKS.map((t) => t.label));
  const preservedTasks = config.tasks.filter((t) => !scpLabels.has(t.label));
  const mergedTasks = [...preservedTasks, ...STANDARD_SCP_TASKS];

  config.tasks = mergedTasks;

  fs.writeFileSync(tasksPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  return {
    created: isCreated,
    updated: !isCreated,
    tasksPath,
    taskCount: mergedTasks.length,
  };
}
