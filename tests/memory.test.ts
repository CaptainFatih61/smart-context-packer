import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectMemoryManager } from '../src/memory.js';
import { packContext } from '../src/index.js';

describe('ProjectMemoryManager (Persistent Memory)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-mem-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('matches exact, folder prefix, extension, and glob patterns correctly', () => {
    expect(ProjectMemoryManager.matchesPattern('src/mcp.ts', 'src/mcp.ts')).toBe(true);
    expect(ProjectMemoryManager.matchesPattern('src/other.ts', 'src/mcp.ts')).toBe(false);

    expect(ProjectMemoryManager.matchesPattern('src/auth/login.ts', 'src/auth/**')).toBe(true);
    expect(ProjectMemoryManager.matchesPattern('src/user/login.ts', 'src/auth/**')).toBe(false);

    expect(ProjectMemoryManager.matchesPattern('tests/unit/api.test.ts', '*.test.ts')).toBe(true);
    expect(ProjectMemoryManager.matchesPattern('src/api.ts', '*.test.ts')).toBe(false);
  });

  it('adds, persists, and loads memory entries from .scp/memory.json', () => {
    const manager1 = new ProjectMemoryManager(tmpDir);
    const entry1 = manager1.add({
      pattern: 'src/mcp.ts',
      content: 'Never use console.log in stdio MCP mode to prevent JSON-RPC corruption.',
      category: 'gotcha',
      tags: ['mcp', 'stdio'],
    });

    expect(entry1.id).toBeDefined();
    expect(entry1.category).toBe('gotcha');

    // Verify file created
    const memPath = path.join(tmpDir, '.scp', 'memory.json');
    expect(fs.existsSync(memPath)).toBe(true);

    // Verify reloading in new instance
    const manager2 = new ProjectMemoryManager(tmpDir);
    const loaded = manager2.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0].content).toContain('Never use console.log');
    expect(loaded[0].tags).toEqual(['mcp', 'stdio']);
  });

  it('queries memories by query keyword, pattern, and category', () => {
    const manager = new ProjectMemoryManager(tmpDir);
    manager.add({ pattern: 'src/auth/**', content: 'Use Argon2 for password hashing', category: 'decision' });
    manager.add({ pattern: 'src/db/**', content: 'Connection pool maximum size is 20', category: 'architecture' });
    manager.add({ pattern: 'src/mcp.ts', content: 'Do not log to stdout', category: 'gotcha' });

    const authQuery = manager.query({ pattern: 'src/auth/session.ts' });
    expect(authQuery.length).toBe(1);
    expect(authQuery[0].content).toContain('Argon2');

    const wordQuery = manager.query({ query: 'pool' });
    expect(wordQuery.length).toBe(1);
    expect(wordQuery[0].content).toContain('Connection pool');

    const catQuery = manager.query({ category: 'gotcha' });
    expect(catQuery.length).toBe(1);
    expect(catQuery[0].pattern).toBe('src/mcp.ts');
  });

  it('deletes memory by id', () => {
    const manager = new ProjectMemoryManager(tmpDir);
    const entry = manager.add({ pattern: 'temp.ts', content: 'temporary note' });
    expect(manager.load().length).toBe(1);

    const deleted = manager.delete(entry.id);
    expect(deleted).toBe(true);
    expect(manager.load().length).toBe(0);
  });

  it('automatically injects relevant memories into packContext output', async () => {
    const targetFile = path.join(tmpDir, 'service.ts');
    fs.writeFileSync(targetFile, 'export const run = () => {};', 'utf-8');

    const manager = new ProjectMemoryManager(tmpDir);
    manager.add({
      pattern: 'service.ts',
      content: 'Critical: service must always be idempotent and retryable.',
      category: 'rule',
    });

    const result = await packContext({
      cwd: tmpDir,
      targets: [targetFile],
      includeMemory: true,
      blastRadius: true,
      quiet: true,
    });

    expect(result.memories).toBeDefined();
    expect(result.memories?.length).toBe(1);
    expect(result.memories?.[0].content).toContain('Critical: service must always be idempotent');
    expect(result.formattedPrompt).toContain('🧠 Persistent Project Memory (.scp/memory.json)');
    expect(result.formattedPrompt).toContain('service must always be idempotent');
    expect(result.formattedPrompt).toContain('💥 Blast-Radius & Impact Analysis');
  });
});
