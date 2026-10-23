import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calculateBlastRadius } from '../src/blast-radius.js';
import type { DependencyGraph } from '../src/types.js';

describe('calculateBlastRadius (Impact & Risk Analysis)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-blast-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('calculates blast radius for isolated file with test', async () => {
    const authFile = path.join(tmpDir, 'auth.ts');
    const authTestFile = path.join(tmpDir, 'auth.test.ts');
    fs.writeFileSync(authFile, 'export function login() {}', 'utf-8');
    fs.writeFileSync(authTestFile, 'import { login } from "./auth";', 'utf-8');

    const graph: DependencyGraph = {
      targets: [authFile],
      nodes: new Map([
        [
          authFile,
          {
            filePath: authFile,
            content: 'export function login() {}',
            type: 'target',
            depth: 0,
            imports: [],
            importedBy: [],
            stats: { lines: 1, characters: 26, estimatedTokens: 8 },
          },
        ],
      ]),
      circularWarnings: [],
    };

    const result = await calculateBlastRadius([authFile], graph, tmpDir);

    expect(result.targets).toEqual(['auth.ts']);
    expect(result.fanInCallers).toEqual([]);
    expect(result.impactedTests).toContain('auth.test.ts');
    expect(result.untestedTargets).toEqual([]);
    expect(result.level).toBe('LOW');
    expect(result.score).toBeLessThanOrEqual(3.0);
    expect(result.summary).toContain('LOW');
  });

  it('detects callers and calculates risk score for widely-used module', async () => {
    const coreFile = path.join(tmpDir, 'core.ts');
    const appFile = path.join(tmpDir, 'app.ts');
    const apiFile = path.join(tmpDir, 'api.ts');
    const cliFile = path.join(tmpDir, 'cli.ts');
    const workerFile = path.join(tmpDir, 'worker.ts');

    fs.writeFileSync(coreFile, 'export function coreUtil() {}', 'utf-8');
    fs.writeFileSync(appFile, 'import { coreUtil } from "./core";', 'utf-8');
    fs.writeFileSync(apiFile, 'import { coreUtil } from "./core";', 'utf-8');
    fs.writeFileSync(cliFile, 'import { coreUtil } from "./core";', 'utf-8');
    fs.writeFileSync(workerFile, 'import { coreUtil } from "./core";', 'utf-8');

    const graph: DependencyGraph = {
      targets: [coreFile],
      nodes: new Map([
        [
          coreFile,
          {
            filePath: coreFile,
            content: 'export function coreUtil() {}',
            type: 'target',
            depth: 0,
            imports: [],
            importedBy: [appFile, apiFile, cliFile, workerFile],
            stats: { lines: 1, characters: 28, estimatedTokens: 9 },
          },
        ],
      ]),
      circularWarnings: [],
    };

    const result = await calculateBlastRadius([coreFile], graph, tmpDir);

    expect(result.fanInCallers?.length).toBe(4);
    expect(result.untestedTargets).toContain('core.ts');
    expect(result.level).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(7.0);
    expect(result.summary).toContain('HIGH');
  });

  it('flags untested targets when no matching test exists', async () => {
    const paymentFile = path.join(tmpDir, 'payment.ts');
    fs.writeFileSync(paymentFile, 'export function charge() {}', 'utf-8');

    const graph: DependencyGraph = {
      targets: [paymentFile],
      nodes: new Map([
        [
          paymentFile,
          {
            filePath: paymentFile,
            content: 'export function charge() {}',
            type: 'target',
            depth: 0,
            imports: [],
            importedBy: [],
            stats: { lines: 1, characters: 26, estimatedTokens: 8 },
          },
        ],
      ]),
      circularWarnings: [],
    };

    const result = await calculateBlastRadius([paymentFile], graph, tmpDir);

    expect(result.untestedTargets).toContain('payment.ts');
    expect(result.impactedTests).toEqual([]);
    // Has untested penalty but low fan-in, so medium or low
    expect(['LOW', 'MEDIUM']).toContain(result.level);
  });
});
