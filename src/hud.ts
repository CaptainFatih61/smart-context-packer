import pc from 'picocolors';

export interface HudCategory {
  name: string;
  tokens: number;
  percentage: number;
  color?: (str: string) => string;
}

export interface ContextHudData {
  totalTokens: number;
  budgetLimit?: number;
  usagePct: number;
  categories: HudCategory[];
}

/**
 * Generates an ASCII visual progress bar.
 */
export function renderAsciiProgressBar(ratio: number, width = 24): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${(clamped * 100).toFixed(1)}%`;
}

/**
 * Builds context allocation breakdown data.
 */
export function buildContextHudData(
  targetTokens: number,
  depTokens: number,
  repoMapTokens = 0,
  diffTokens = 0,
  memoryTokens = 0,
  taskTokens = 0,
  budgetLimit?: number
): ContextHudData {
  const total = targetTokens + depTokens + repoMapTokens + diffTokens + memoryTokens + taskTokens;
  const safeTotal = total > 0 ? total : 1;

  const categories: HudCategory[] = [];

  if (targetTokens > 0) {
    categories.push({
      name: 'Target Files',
      tokens: targetTokens,
      percentage: (targetTokens / safeTotal) * 100,
      color: pc.green,
    });
  }

  if (depTokens > 0) {
    categories.push({
      name: 'Dependencies',
      tokens: depTokens,
      percentage: (depTokens / safeTotal) * 100,
      color: pc.yellow,
    });
  }

  if (repoMapTokens > 0) {
    categories.push({
      name: 'Repo-Map',
      tokens: repoMapTokens,
      percentage: (repoMapTokens / safeTotal) * 100,
      color: pc.cyan,
    });
  }

  if (diffTokens > 0) {
    categories.push({
      name: 'Git Diff',
      tokens: diffTokens,
      percentage: (diffTokens / safeTotal) * 100,
      color: pc.magenta,
    });
  }

  if (memoryTokens > 0) {
    categories.push({
      name: 'Memory',
      tokens: memoryTokens,
      percentage: (memoryTokens / safeTotal) * 100,
      color: pc.blue,
    });
  }

  if (taskTokens > 0) {
    categories.push({
      name: 'Task Directive',
      tokens: taskTokens,
      percentage: (taskTokens / safeTotal) * 100,
      color: pc.white,
    });
  }

  const limit = budgetLimit && budgetLimit > 0 ? budgetLimit : 128000;
  const usagePct = (total / limit) * 100;

  return {
    totalTokens: total,
    budgetLimit,
    usagePct,
    categories,
  };
}

/**
 * Formats a terminal-ready ASCII HUD card.
 */
export function renderTerminalHud(hud: ContextHudData): string[] {
  const lines: string[] = [];
  const ratio = hud.budgetLimit ? hud.totalTokens / hud.budgetLimit : hud.totalTokens / 128000;
  const bar = renderAsciiProgressBar(ratio, 20);

  const budgetLabel = hud.budgetLimit
    ? `${hud.totalTokens.toLocaleString()} / ${hud.budgetLimit.toLocaleString()} tokens`
    : `${hud.totalTokens.toLocaleString()} tokens`;

  lines.push(pc.cyan('│ ') + pc.bold(pc.white('Context HUD:')) + ' ' + pc.magenta(bar) + ' ' + pc.gray(budgetLabel));

  for (const cat of hud.categories) {
    const colorFn = cat.color || pc.white;
    const catLine = `  • ${cat.name.padEnd(14)}: ${cat.tokens.toLocaleString().padStart(6)} t (${cat.percentage.toFixed(1)}%)`;
    lines.push(pc.cyan('│ ') + colorFn(catLine));
  }

  return lines;
}
