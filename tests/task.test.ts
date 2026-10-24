import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskManager } from '../src/task.js';

describe('Active Task & Planning Engine (src/task.ts)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `scp_task_test_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates active task with default checklist and persists to .scp/tasks.json', () => {
    const mgr = new TaskManager(tempDir);
    expect(mgr.getActiveTask()).toBeNull();

    const task = mgr.createOrSetActiveTask('Implement OAuth2 session handling');
    expect(task.description).toBe('Implement OAuth2 session handling');
    expect(task.status).toBe('in_progress');
    expect(task.items.length).toBeGreaterThanOrEqual(3);

    const active = mgr.getActiveTask();
    expect(active?.id).toBe(task.id);

    const tasksFile = path.join(tempDir, '.scp/tasks.json');
    expect(fs.existsSync(tasksFile)).toBe(true);
  });

  it('marks checklist items completed and completes task when all items done', () => {
    const mgr = new TaskManager(tempDir);
    const task = mgr.createOrSetActiveTask('Build checkout API', [
      'Validate cart',
      'Charge card',
    ]);

    expect(task.items[0]?.completed).toBe(false);
    expect(task.items[1]?.completed).toBe(false);

    const ok1 = mgr.completeItem('Validate cart');
    expect(ok1).toBe(true);

    let active = mgr.getActiveTask();
    expect(active?.items[0]?.completed).toBe(true);
    expect(active?.status).toBe('in_progress');

    const ok2 = mgr.completeItem('step_2');
    expect(ok2).toBe(true);

    active = mgr.getActiveTask();
    expect(active?.items[1]?.completed).toBe(true);
    expect(active?.status).toBe('completed');
  });

  it('formats task directive markdown cleanly', () => {
    const mgr = new TaskManager(tempDir);
    const task = mgr.createOrSetActiveTask('Refactor auth', ['Audit routes', 'Update tests']);
    mgr.completeItem('Audit routes');

    const active = mgr.getActiveTask()!;
    const directive = TaskManager.formatTaskDirective(active);

    expect(directive).toContain('## 🎯 Active Task Context & Plan Checklist');
    expect(directive).toContain('- **Objective**: Refactor auth');
    expect(directive).toContain('[x] Audit routes');
    expect(directive).toContain('[ ] Update tests');
  });

  it('discovers task seed files using BM25 intent matching', () => {
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'authService.ts'),
      'export function verifySessionToken() { return true; }\nexport class AuthManager {}'
    );
    fs.writeFileSync(
      path.join(srcDir, 'cartService.ts'),
      'export function addToCart() {}\nexport class CartManager {}'
    );

    const mgr = new TaskManager(tempDir);
    const seeds = mgr.discoverTaskSeedFiles('verify user session token');
    expect(seeds.length).toBeGreaterThanOrEqual(1);
    expect(seeds[0]).toContain('authService.ts');
  });
});
