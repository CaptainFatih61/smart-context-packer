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

  it('creates .agent/rules/smart-context-packer.md and .cursorrules in fresh workspace', () => {
    const res = initAgentRules(tempDir);

    expect(res.agentRulesCreated).toBe(true);
    expect(res.cursorRulesCreated).toBe(true);
    expect(res.created).toHaveLength(2);
    expect(res.updated).toHaveLength(0);

    const agentFile = path.join(tempDir, '.agent/rules/smart-context-packer.md');
    const cursorFile = path.join(tempDir, '.cursorrules');

    expect(fs.existsSync(agentFile)).toBe(true);
    expect(fs.existsSync(cursorFile)).toBe(true);

    const agentContent = fs.readFileSync(agentFile, 'utf-8');
    const cursorContent = fs.readFileSync(cursorFile, 'utf-8');

    expect(agentContent).toContain('SMART CONTEXT PACKER: AUTONOMOUS AI AGENT DIRECTIVE');
    expect(agentContent).toContain('pack_context');
    expect(agentContent).toContain('inspect_dependency_graph');
    expect(agentContent).toContain('pack_git_diff');

    expect(cursorContent).toContain('SMART CONTEXT PACKER: AUTONOMOUS AI AGENT DIRECTIVE');
  });

  it('appends directives to existing .cursorrules without duplicating', () => {
    const cursorFile = path.join(tempDir, '.cursorrules');
    fs.writeFileSync(cursorFile, '# Existing Project Rules\n\nBe concise.\n', 'utf-8');

    const res1 = initAgentRules(tempDir);
    expect(res1.cursorRulesCreated).toBe(false);
    expect(res1.updated).toContain('.cursorrules');

    const content1 = fs.readFileSync(cursorFile, 'utf-8');
    expect(content1).toContain('# Existing Project Rules');
    expect(content1).toContain('SMART CONTEXT PACKER: AUTONOMOUS AI AGENT DIRECTIVE');

    // Run a second time: should not duplicate
    const res2 = initAgentRules(tempDir);
    const content2 = fs.readFileSync(cursorFile, 'utf-8');
    expect(content2).toBe(content1);
  });

  it('exports valid rule content template', () => {
    expect(AGENT_RULES_CONTENT).toContain('inspect_dependency_graph');
    expect(AGENT_RULES_CONTENT).toContain('pack_context');
    expect(AGENT_RULES_CONTENT).toContain('pack_git_diff');
  });
});
