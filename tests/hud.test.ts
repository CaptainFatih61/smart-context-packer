import { describe, it, expect } from 'vitest';
import { renderAsciiProgressBar, buildContextHudData, renderTerminalHud } from '../src/hud.js';

describe('Visual Context Budget HUD (src/hud.ts)', () => {
  it('renders ASCII progress bar accurately', () => {
    const half = renderAsciiProgressBar(0.5, 10);
    expect(half).toContain('█████░░░░░');
    expect(half).toContain('50.0%');

    const full = renderAsciiProgressBar(1.0, 10);
    expect(full).toContain('██████████');
    expect(full).toContain('100.0%');

    const zero = renderAsciiProgressBar(0, 10);
    expect(zero).toContain('░░░░░░░░░░');
    expect(zero).toContain('0.0%');
  });

  it('builds category breakdown and percentages correctly', () => {
    const data = buildContextHudData(1000, 500, 250, 0, 250, 0, 4000);
    expect(data.totalTokens).toBe(2000);
    expect(data.budgetLimit).toBe(4000);
    expect(data.usagePct).toBe(50);

    expect(data.categories).toHaveLength(4);
    const targetCat = data.categories.find((c) => c.name === 'Target Files');
    expect(targetCat?.percentage).toBe(50); // 1000 / 2000

    const depCat = data.categories.find((c) => c.name === 'Dependencies');
    expect(depCat?.percentage).toBe(25); // 500 / 2000
  });

  it('renders formatted terminal HUD lines', () => {
    const data = buildContextHudData(1000, 1000);
    const lines = renderTerminalHud(data);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => l.includes('Context HUD:'))).toBe(true);
    expect(lines.some((l) => l.includes('Target Files'))).toBe(true);
  });
});
