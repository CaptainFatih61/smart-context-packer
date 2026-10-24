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

  it('creates universal agent presets across Cursor, Claude, Copilot, Windsurf, OpenCode, Codex, Continue, Zed, Cline, Aider, and JetBrains', () => {
    const res = initAgentRules(tempDir, 'all');

    expect(res.agentRulesCreated).toBe(true);
    expect(res.cursorRulesCreated).toBe(true);
    expect(res.created.length).toBeGreaterThanOrEqual(12);
    expect(res.created).toContain('.agent/rules/smart-context-packer.md');
    expect(res.created).toContain('.cursorrules');
    expect(res.created).toContain('CLAUDE.md');
    expect(res.created).toContain('.github/copilot-instructions.md');
    expect(res.created).toContain('.windsurfrules');
    expect(res.created).toContain('.opencode/instructions.md');
    expect(res.created).toContain('CODEX.md');
    expect(res.created).toContain('.continue/config.json');
    expect(res.created).toContain('.zed/settings.json');
    expect(res.created).toContain('.clinerules');
    expect(res.created).toContain('.roomodes');
    expect(res.created).toContain('CONVENTIONS.md');
    expect(res.created).toContain('.aider.conf.yml');
    expect(res.created).toContain('.idea/ai/instructions.md');

    const agentFile = path.join(tempDir, '.agent/rules/smart-context-packer.md');
    const cursorFile = path.join(tempDir, '.cursorrules');
    const claudeFile = path.join(tempDir, 'CLAUDE.md');
    const codexFile = path.join(tempDir, 'CODEX.md');
    const continueFile = path.join(tempDir, '.continue/config.json');
    const zedFile = path.join(tempDir, '.zed/settings.json');

    expect(fs.existsSync(agentFile)).toBe(true);
    expect(fs.existsSync(cursorFile)).toBe(true);
    expect(fs.existsSync(claudeFile)).toBe(true);
    expect(fs.existsSync(codexFile)).toBe(true);
    expect(fs.existsSync(continueFile)).toBe(true);
    expect(fs.existsSync(zedFile)).toBe(true);

    const continueJson = JSON.parse(fs.readFileSync(continueFile, 'utf-8'));
    expect(continueJson.experimental.modelContextProtocolServers).toBeDefined();

    const zedJson = JSON.parse(fs.readFileSync(zedFile, 'utf-8'));
    expect(zedJson.context_servers['smart-context-packer']).toBeDefined();
  });

  it('generates specific targeted presets when requested (continue, zed, aider, codex)', () => {
    const resContinue = initAgentRules(tempDir, 'continue');
    expect(resContinue.created).toContain('.continue/config.json');
    expect(fs.existsSync(path.join(tempDir, '.continue/config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.cursorrules'))).toBe(false);

    const resZed = initAgentRules(tempDir, 'zed');
    expect(resZed.created).toContain('.zed/settings.json');
    expect(fs.existsSync(path.join(tempDir, '.zed/settings.json'))).toBe(true);

    const resAider = initAgentRules(tempDir, 'aider');
    expect(resAider.created).toContain('.aider.conf.yml');
    expect(resAider.created).toContain('CONVENTIONS.md');

    const resCodex = initAgentRules(tempDir, 'codex');
    expect(resCodex.created).toContain('CODEX.md');
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
