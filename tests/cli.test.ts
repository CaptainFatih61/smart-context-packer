import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import { describe, it, expect } from 'vitest';

const exec = promisify(child_process.exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../dist/cli.js');
const sampleAppDir = path.resolve(__dirname, 'fixtures/sample-app');

describe('CLI Execution (dist/cli.js)', () => {
  it('outputs help information with --help', async () => {
    const { stdout } = await exec(`node "${cliPath}" --help`);
    expect(stdout).toContain('Usage: scp [options]');
    expect(stdout).toContain('--depth');
    expect(stdout).toContain('--skeleton');
    expect(stdout).toContain('--format');
    expect(stdout).toContain('--copy');
    expect(stdout).toContain('--diff');
    expect(stdout).toContain('--mcp');
    expect(stdout).toContain('--init-vscode');
  });

  it('outputs current version with --version', async () => {
    const { stdout } = await exec(`node "${cliPath}" --version`);
    expect(stdout).toContain('1.2.0');
  });

  it('generates prompt to stdout using --stdout flag', async () => {
    const { stdout } = await exec(
      `node "${cliPath}" src/index.ts --stdout -d 1`,
      { cwd: sampleAppDir }
    );

    expect(stdout).toContain('SMART CONTEXT PACKER: AI DIRECTIVE');
    expect(stdout).toContain('### File: `src/index.ts` (TARGET)');
    expect(stdout).toContain('### File: `src/utils/helpers.ts` (DEP: depth 1)');
  });

  it('outputs tree-only prompt when requested', async () => {
    const { stdout } = await exec(
      `node "${cliPath}" src/index.ts --stdout --tree-only`,
      { cwd: sampleAppDir }
    );

    expect(stdout).toContain('## Project Hierarchy');
    expect(stdout).toContain('## Dependency Graph Map');
    expect(stdout).not.toContain('## Packed Files');
  });

  it('outputs structured XML with --format xml', async () => {
    const { stdout } = await exec(
      `node "${cliPath}" src/index.ts --stdout --format xml`,
      { cwd: sampleAppDir }
    );

    expect(stdout).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(stdout).toContain('<context_pack generator="smart-context-packer">');
    expect(stdout).toContain('<file path="src/index.ts" type="target"');
  });

  it('initializes VS Code tasks using --init-vscode flag', async () => {
    const tempDir = path.join(os.tmpdir(), `scp_cli_vscode_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const { stdout } = await exec(`node "${cliPath}" --init-vscode`, { cwd: tempDir });
      expect(stdout).toContain('VS Code Tasks Configured Successfully');
      expect(fs.existsSync(path.join(tempDir, '.vscode/tasks.json'))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
