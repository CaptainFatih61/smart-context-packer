import { describe, it, expect } from 'vitest';
import { sandboxOutput } from '../src/sandbox.js';

describe('Tool Output Sandboxing (src/sandbox.ts)', () => {
  it('passes short outputs through untouched', () => {
    const raw = 'All tests passed.\n10 passed, 0 failed.';
    const res = sandboxOutput(raw, 20);
    expect(res.originalLines).toBe(2);
    expect(res.tokensSaved).toBe(0);
    expect(res.output).toBe(raw);
  });

  it('compresses massive test run output by omitting passing lines while retaining failures', () => {
    const passingLines = Array.from({ length: 200 }, (_, i) => ` ✓ tests/module_${i}.test.ts (5 tests) 10ms`);
    const failureLines = [
      ' FAIL  tests/auth.test.ts > login',
      'AssertionError: expected 401 to be 200',
      '    at tests/auth.test.ts:42:15',
    ];
    const summaryLines = [
      'Test Files  1 failed | 200 passed (201)',
      '     Tests  1 failed | 1000 passed (1001)',
      '  Duration  1.42s',
    ];

    const raw = [...passingLines, ...failureLines, ...summaryLines].join('\n');
    const res = sandboxOutput(raw, 30);

    expect(res.originalLines).toBeGreaterThan(200);
    expect(res.sandboxedLines).toBeLessThan(res.originalLines);
    expect(res.tokensSaved).toBeGreaterThan(0);
    expect(res.output).toContain('FAIL  tests/auth.test.ts > login');
    expect(res.output).toContain('AssertionError: expected 401 to be 200');
    expect(res.output).toContain('Test Files  1 failed');
  });

  it('compresses general verbose text with head and tail preservation', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}: detailed build step`);
    const raw = lines.join('\n');

    const res = sandboxOutput(raw, 40);
    expect(res.sandboxedLines).toBeLessThan(150);
    expect(res.output).toContain('Line 1: detailed build step');
    expect(res.output).toContain('smart-context-packer sandbox:');
    expect(res.output).toContain('Line 150: detailed build step');
  });
});
