import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initAgentRules, AGENT_RULES_CONTENT } from '../src/agent-rules.js';

describe('Automatic Background Agent Rule Generator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `scp_agent_test_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates universal agent presets across Cursor, Claude, Copilot, Windsurf, and Antigravity', () => {
    const res = initAgentRules(tempDir, 'all');

    expect(res.agentRulesCreated).toBe(true);
    expect(res.cursorRulesCreated).toBe(true);
    expect(res.created).toHaveLength(5);
    expect(res.created).toContain('.agent/rules/smart-context-packer.md');
    expect(res.created).toContain('.cursorrules');
    expect(res.created).toContain('CLAUDE.md');
    expect(res.created).toContain('.github/copilot-instructions.md');
    expect(res.created).toContain('.windsurfrules');

    const agentFile = path.join(tempDir, '.agent/rules/smart-context-packer.md');
    const cursorFile = path.join(tempDir, '.cursorrules');
    const claudeFile = path.join(tempDir, 'CLAUDE.md');
    const copilotFile = path.join(tempDir, '.github/copilot-instructions.md');
    const windsurfFile = path.join(tempDir, '.windsurfrules');

    expect(fs.existsSync(agentFile)).toBe(true);
    expect(fs.existsSync(cursorFile)).toBe(true);
    expect(fs.existsSync(claudeFile)).toBe(true);
    expect(fs.existsSync(copilotFile)).toBe(true);
    expect(fs.existsSync(windsurfFile)).toBe(true);

    const claudeContent = fs.readFileSync(claudeFile, 'utf-8');
    expect(claudeContent).toContain('Project Intelligence with Smart Context Packer');
  });

  it('generates specific targeted presets when requested', () => {
    const resClaude = initAgentRules(tempDir, 'claude');
    expect(resClaude.created).toContain('CLAUDE.md');
    expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.cursorrules'))).toBe(false);

    const resCursor = initAgentRules(tempDir, 'cursor');
    expect(resCursor.created).toContain('.cursorrules');
    expect(fs.existsSync(path.join(tempDir, '.cursorrules'))).toBe(true);
  });

  it('appends directives to existing .cursorrules without duplicating', () => {
    const cursorFile = path.join(tempDir, '.cursorrules');
    fs.writeFileSync(cursorFile, '# Existing Project Rules\n\nBe concise.\n', 'utf-8');

    const res1 = initAgentRules(tempDir, 'cursor');
    expect(res1.cursorRulesCreated).toBe(false);
    expect(res1.updated).toContain('.cursorrules');

    const content1 = fs.readFileSync(cursorFile, 'utf-8');
    expect(content1).toContain('# Existing Project Rules');
    expect(content1).toContain('SMART CONTEXT PACKER: AUTONOMOUS AI AGENT DIRECTIVE');

    // Run a second time: should not duplicate
    const res2 = initAgentRules(tempDir, 'cursor');
    const content2 = fs.readFileSync(cursorFile, 'utf-8');
    expect(content2).toBe(content1);
  });

  it('exports valid rule content template', () => {
    expect(AGENT_RULES_CONTENT).toContain('inspect_dependency_graph');
    expect(AGENT_RULES_CONTENT).toContain('pack_context');
    expect(AGENT_RULES_CONTENT).toContain('pack_git_diff');
  });
});
