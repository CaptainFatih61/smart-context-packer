import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { BM25CodeSearch } from './query.js';
import { AstCache } from './cache.js';
import { POLYGLOT_GLOB_PATTERN } from './analyzer.js';

export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface TaskRecord {
  id: string;
  description: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  items: TaskItem[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskStore {
  version: string;
  activeTaskId?: string;
  tasks: TaskRecord[];
}

const DEFAULT_STORE: TaskStore = {
  version: '1.0.0',
  tasks: [],
};

export class TaskManager {
  private workspaceRoot: string;
  private filePath: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.filePath = path.join(this.workspaceRoot, '.scp', 'tasks.json');
  }

  private load(): TaskStore {
    if (!fs.existsSync(this.filePath)) {
      return { ...DEFAULT_STORE, tasks: [] };
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as TaskStore;
      if (!Array.isArray(data.tasks)) data.tasks = [];
      return data;
    } catch {
      return { ...DEFAULT_STORE, tasks: [] };
    }
  }

  private save(store: TaskStore): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  public getActiveTask(): TaskRecord | null {
    const store = this.load();
    if (!store.activeTaskId) {
      const active = store.tasks.find((t) => t.status === 'in_progress');
      return active || null;
    }
    return store.tasks.find((t) => t.id === store.activeTaskId) || null;
  }

  public createOrSetActiveTask(description: string, checklist: string[] = []): TaskRecord {
    const store = this.load();
    const now = new Date().toISOString();
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Generate automatic checklist items if none provided
    const items: TaskItem[] = checklist.length > 0
      ? checklist.map((text, idx) => ({ id: `step_${idx + 1}`, text, completed: false }))
      : [
          { id: 'step_1', text: 'Analyze existing codebase and dependency slice', completed: false },
          { id: 'step_2', text: 'Implement required changes according to specifications', completed: false },
          { id: 'step_3', text: 'Verify implementation with tests and automated checks', completed: false },
        ];

    const record: TaskRecord = {
      id,
      description: description.trim(),
      status: 'in_progress',
      items,
      createdAt: now,
      updatedAt: now,
    };

    store.tasks.unshift(record);
    store.activeTaskId = id;
    this.save(store);
    return record;
  }

  public completeItem(identifier: string): boolean {
    const store = this.load();
    const active = store.activeTaskId
      ? store.tasks.find((t) => t.id === store.activeTaskId)
      : store.tasks.find((t) => t.status === 'in_progress');
    if (!active) return false;

    const norm = identifier.toLowerCase().trim();
    const num = parseInt(identifier, 10);
    const item = active.items.find(
      (it, idx) =>
        it.id.toLowerCase() === norm ||
        (!isNaN(num) && (idx + 1 === num || it.id === `step_${num}`)) ||
        it.text.toLowerCase().includes(norm)
    );

    if (item) {
      item.completed = true;
      active.updatedAt = new Date().toISOString();

      // Check if all items completed
      if (active.items.every((it) => it.completed)) {
        active.status = 'completed';
      }

      this.save(store);
      return true;
    }
    return false;
  }

  public completeTask(taskId?: string): boolean {
    const store = this.load();
    const targetId = taskId || store.activeTaskId;
    if (!targetId) return false;

    const task = store.tasks.find((t) => t.id === targetId);
    if (task) {
      task.status = 'completed';
      task.items.forEach((it) => (it.completed = true));
      task.updatedAt = new Date().toISOString();
      if (store.activeTaskId === targetId) {
        store.activeTaskId = undefined;
      }
      this.save(store);
      return true;
    }
    return false;
  }

  public listTasks(): TaskRecord[] {
    return this.load().tasks;
  }

  /**
   * Discovers relevant seed files for a task description using BM25 intent search.
   */
  public discoverTaskSeedFiles(taskDescription: string, limit = 4): string[] {
    const candidateFiles = fg.sync([POLYGLOT_GLOB_PATTERN], {
      cwd: this.workspaceRoot,
      ignore: ['node_modules/**', 'dist/**', '.git/**', 'coverage/**', '.scp/**'],
      absolute: false,
    });

    const searcher = new BM25CodeSearch();
    for (const file of candidateFiles) {
      try {
        const fullPath = path.resolve(this.workspaceRoot, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const ext = path.extname(file);
        const symbols = AstCache.extractExportedSymbols(content, ext);
        searcher.addDocument({ path: file, symbols, content: content.slice(0, 1000) });
      } catch {
        // ignore
      }
    }

    const matches = searcher.search(taskDescription, limit);
    return matches.map((m) => m.path);
  }

  /**
   * Formats an active task into a prompt directive header.
   */
  public static formatTaskDirective(task: TaskRecord): string {
    const lines: string[] = [
      '## 🎯 Active Task Context & Plan Checklist',
      `- **Objective**: ${task.description}`,
      `- **Status**: ${task.status.toUpperCase()}`,
      '- **Plan Checklist**:',
    ];

    for (const item of task.items) {
      const mark = item.completed ? '[x]' : '[ ]';
      lines.push(`  - ${mark} ${item.text}`);
    }

    return lines.join('\n');
  }
}
