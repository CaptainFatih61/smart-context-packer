import fs from 'node:fs';
import os from 'node:os';
import child_process from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { McpServer } from '../src/mcp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleAppDir = path.resolve(__dirname, 'fixtures/sample-app');

describe('Model Context Protocol (MCP) Server', () => {
  const server = new McpServer();

  it('handles initialize handshake', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test-client', version: '1.0' },
      },
    });

    expect(res).not.toBeNull();
    expect(res?.id).toBe(1);
    expect(res?.result).toHaveProperty('protocolVersion');
    expect((res?.result as any).serverInfo.name).toBe('smart-context-packer');
    expect((res?.result as any).serverInfo.version).toBe('2.4.0');
  });

  it('handles ping request', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'ping',
    });

    expect(res).not.toBeNull();
    expect(res?.id).toBe(2);
    expect(res?.result).toEqual({});
  });

  it('lists available MCP tools with schemas', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });

    expect(res?.id).toBe(3);
    const tools = (res?.result as any).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(15);

    const names = tools.map((t: any) => t.name);
    expect(names).toContain('search_codebase_index');
    expect(names).toContain('pack_context');
    expect(names).toContain('inspect_dependency_graph');
    expect(names).toContain('pack_git_diff');
    expect(names).toContain('save_project_memory');
    expect(names).toContain('query_project_memory');
    expect(names).toContain('generate_repo_map');
    expect(names).toContain('search_codebase_intent');
    expect(names).toContain('generate_visualizer');
    expect(names).toContain('manage_task_context');
    expect(names).toContain('get_framework_manifest');
    expect(names).toContain('sandbox_tool_output');
    expect(names).toContain('extract_symbol_definition');
    expect(names).toContain('get_impacted_tests');
    expect(names).toContain('audit_context_leak');
  });

  it('calls inspect_dependency_graph tool', async () => {
    const targetFile = path.resolve(sampleAppDir, 'src/index.ts');
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'inspect_dependency_graph',
        arguments: {
          targets: [targetFile],
        },
      },
    });

    expect(res?.id).toBe(4);
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('## Project Hierarchy');
    expect(content).toContain('## Dependency Graph Map');
    expect(content).not.toContain('## Packed Files');
  });

  it('calls pack_context tool with maxTokens', async () => {
    const targetFile = path.resolve(sampleAppDir, 'src/index.ts');
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'pack_context',
        arguments: {
          targets: [targetFile],
          depth: 1,
          maxTokens: 50,
        },
      },
    });

    expect(res?.id).toBe(5);
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('SMART CONTEXT PACKER: AI DIRECTIVE');
    expect(content).toContain('### File:');
  });

  it('calls pack_git_diff tool on clean working tree', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'pack_git_diff',
        arguments: {
          stagedOnly: false,
          depth: 1,
          cwd: path.resolve(__dirname, '..'),
        },
      },
    });

    expect(res?.id).toBe(6);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('SMART CONTEXT PACKER');
  });

  it('calls pack_git_diff tool on modified git working tree in isolated repo', async () => {
    const tempDir = path.join(os.tmpdir(), `scp_mcp_git_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      child_process.execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      child_process.execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
      child_process.execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });

      const fileA = path.join(tempDir, 'a.ts');
      fs.writeFileSync(fileA, 'export const a = 1;', 'utf-8');
      child_process.execSync('git add a.ts && git commit -m "init"', { cwd: tempDir, stdio: 'ignore' });

      // Modify a.ts
      fs.writeFileSync(fileA, 'export const a = 2;\nexport const b = 3;', 'utf-8');

      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'pack_git_diff',
          arguments: {
            stagedOnly: false,
            depth: 1,
            cwd: tempDir,
          },
        },
      });

      expect(res?.id).toBe(7);
      expect(res?.error).toBeUndefined();
      const content = (res?.result as any).content[0].text;
      expect(content).toContain('SMART CONTEXT PACKER: AI DIRECTIVE');
      expect(content).toContain('## Git Diff Patch');
      expect(content).toContain('+export const a = 2;');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('calls search_codebase_index tool (Layer 1 Progressive Disclosure)', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'search_codebase_index',
        arguments: {
          cwd: sampleAppDir,
          query: 'index',
        },
      },
    });

    expect(res?.id).toBe(8);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('CODEBASE INDEX (Layer 1 Progressive Disclosure)');
    expect(content).toContain('src/index.ts');
  });

  it('calls save_project_memory and query_project_memory tools', async () => {
    const memDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-mcp-mem-'));

    try {
      // 1. Save memory
      const saveRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'save_project_memory',
          arguments: {
            cwd: memDir,
            pattern: 'src/api/**',
            content: 'API responses must be enveloped in { success, data }',
            category: 'rule',
            tags: ['api', 'standards'],
          },
        },
      });

      expect(saveRes?.id).toBe(9);
      expect((saveRes?.result as any).content[0].text).toContain('Stored memory');

      // 2. Query memory
      const queryRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'query_project_memory',
          arguments: {
            cwd: memDir,
            query: 'enveloped',
          },
        },
      });

      expect(queryRes?.id).toBe(10);
      const queryText = (queryRes?.result as any).content[0].text;
      expect(queryText).toContain('Found 1 memory note');
      expect(queryText).toContain('enveloped in { success, data }');
    } finally {
      fs.rmSync(memDir, { recursive: true, force: true });
    }
  });

  it('calls pack_context with blastRadius: true', async () => {
    const targetFile = path.resolve(sampleAppDir, 'src/index.ts');
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'pack_context',
        arguments: {
          targets: [targetFile],
          blastRadius: true,
        },
      },
    });

    expect(res?.id).toBe(11);
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('💥 Blast-Radius & Impact Analysis');
    expect(content).toContain('Risk Level');
  });

  it('calls generate_repo_map MCP tool', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'generate_repo_map',
        arguments: {
          cwd: sampleAppDir,
          targets: ['src/index.ts'],
          maxTokens: 500,
        },
      },
    });

    expect(res?.id).toBe(12);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('Codebase Architectural Repo-Map');
    expect(content).toContain('src/index.ts');
  });

  it('calls search_codebase_intent MCP tool with BM25 ranking', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'search_codebase_intent',
        arguments: {
          cwd: sampleAppDir,
          query: 'auth service login user',
          topK: 3,
        },
      },
    });

    expect(res?.id).toBe(13);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('BM25 INTENT SEARCH');
    expect(content).toContain('src/services/auth.ts');
  });

  it('calls generate_visualizer MCP tool and creates report', async () => {
    const tmpOut = path.resolve('tests/fixtures/mcp_visualizer.html');
    try {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'generate_visualizer',
          arguments: {
            cwd: sampleAppDir,
            targets: ['src/index.ts'],
            outputPath: tmpOut,
          },
        },
      });

      expect(res?.id).toBe(14);
      expect(res?.error).toBeUndefined();
      expect(fs.existsSync(tmpOut)).toBe(true);
    } finally {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  });

  it('calls manage_task_context MCP tool (create, get, complete_item, list)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-mcp-task-'));
    try {
      // 1. Create task
      const createRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'manage_task_context',
          arguments: {
            cwd: tmpDir,
            action: 'create',
            taskName: 'Refactor Authentication',
            items: ['Audit tokens', 'Add refresh token support', 'Write tests'],
          },
        },
      });
      expect(createRes?.id).toBe(15);
      const createText = (createRes?.result as any).content[0].text;
      expect(createText).toContain('Active task created successfully!');

      // 2. Get active task directive
      const getRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'manage_task_context',
          arguments: { cwd: tmpDir, action: 'get' },
        },
      });
      expect(getRes?.id).toBe(16);
      const getText = (getRes?.result as any).content[0].text;
      expect(getText).toContain('Refactor Authentication');
      expect(getText).toContain('[ ] Audit tokens');

      // 3. Complete item
      const itemRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: {
          name: 'manage_task_context',
          arguments: { cwd: tmpDir, action: 'complete_item', itemIndex: 0 },
        },
      });
      expect(itemRes?.id).toBe(17);
      const itemText = (itemRes?.result as any).content[0].text;
      expect(itemText).toContain('marked completed');

      // 4. List tasks
      const listRes = await server.handleMessage({
        jsonrpc: '2.0',
        id: 18,
        method: 'tools/call',
        params: {
          name: 'manage_task_context',
          arguments: { cwd: tmpDir, action: 'list' },
        },
      });
      expect(listRes?.id).toBe(18);
      const listText = (listRes?.result as any).content[0].text;
      expect(listText).toContain('Refactor Authentication');
      expect(listText).toContain('IN PROGRESS');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('calls get_framework_manifest MCP tool', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 19,
      method: 'tools/call',
      params: {
        name: 'get_framework_manifest',
        arguments: { cwd: sampleAppDir },
      },
    });

    expect(res?.id).toBe(19);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('ACTIVE FRAMEWORKS & DEPENDENCIES');
    expect(content).toContain('express');
  });

  it('calls sandbox_tool_output MCP tool', async () => {
    const noisyOutput = [
      'PASS tests/unit/auth.test.ts',
      '  ✓ generates valid JWT token (12ms)',
      '  ✓ refreshes expired token (14ms)',
      'FAIL tests/unit/payment.test.ts',
      '  ✕ charges card with Stripe SDK (45ms)',
      '      Error: StripeCardError: Card was declined',
      '        at Object.<anonymous> (tests/unit/payment.test.ts:35:12)',
      'Test Suites: 1 failed, 1 passed, 2 total',
    ].join('\n');

    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'sandbox_tool_output',
        arguments: { rawOutput: noisyOutput },
      },
    });

    expect(res?.id).toBe(20);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('TOOL OUTPUT SANDBOX');
    expect(content).toContain('charges card with Stripe SDK');
    expect(content).toContain('StripeCardError');
  });

  it('calls extract_symbol_definition tool surgically', async () => {
    const targetFile = path.resolve(sampleAppDir, 'src/index.ts');
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'extract_symbol_definition',
        arguments: {
          filePath: targetFile,
          symbolName: 'main',
        },
      },
    });

    expect(res?.id).toBe(21);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('SURGICAL SYMBOL DEFINITION: main');
    expect(content).toContain('function main');
  });

  it('calls get_impacted_tests tool', async () => {
    const targetFile = path.resolve(sampleAppDir, 'src/services/auth.ts');
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'get_impacted_tests',
        arguments: {
          targets: [targetFile],
        },
      },
    });

    expect(res?.id).toBe(22);
    expect(res?.error).toBeUndefined();
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('Impacted Tests Analysis');
    expect(content).toContain('Untested Targets');
  });

  it('calls audit_context_leak tool to flag credentials and evaluate token density', async () => {
    // 1. Unsafe input with fake API key
    const unsafeText = 'export const apiKey = "sk-proj-abcdef1234567890abcdef1234567890abcdef1234567890";';
    const resUnsafe = await server.handleMessage({
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'audit_context_leak',
        arguments: { content: unsafeText },
      },
    });

    expect(resUnsafe?.id).toBe(23);
    const contentUnsafe = (resUnsafe?.result as any).content[0].text;
    expect(contentUnsafe).toContain('ATTENTION REQUIRED');
    expect(contentUnsafe).toContain('OPENAI_API_KEY');

    // 2. Safe input
    const safeText = 'export function add(a: number, b: number): number { return a + b; }';
    const resSafe = await server.handleMessage({
      jsonrpc: '2.0',
      id: 24,
      method: 'tools/call',
      params: {
        name: 'audit_context_leak',
        arguments: { contextText: safeText },
      },
    });

    expect(resSafe?.id).toBe(24);
    const contentSafe = (resSafe?.result as any).content[0].text;
    expect(contentSafe).toContain('✅ SAFE');
    expect(contentSafe).toContain('17 tokens');

    // 3. Audit directly via filePath parameter
    const sampleFile = path.resolve(sampleAppDir, 'src/index.ts');
    const resFile = await server.handleMessage({
      jsonrpc: '2.0',
      id: 25,
      method: 'tools/call',
      params: {
        name: 'audit_context_leak',
        arguments: { filePath: sampleFile },
      },
    });
    expect(resFile?.id).toBe(25);
    expect((resFile?.result as any).content[0].text).toContain('Context Safety & Token Density Audit');
  });

  it('returns error for unknown tool call', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
        arguments: {},
      },
    });

    expect(res?.id).toBe(21);
    expect(res?.error).toBeDefined();
    expect(res?.error?.code).toBe(-32601);
  });
});
