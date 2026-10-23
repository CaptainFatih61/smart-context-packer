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
    expect((res?.result as any).serverInfo.version).toBe('2.0.0');
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
    expect(tools.length).toBe(6);

    const names = tools.map((t: any) => t.name);
    expect(names).toContain('search_codebase_index');
    expect(names).toContain('pack_context');
    expect(names).toContain('inspect_dependency_graph');
    expect(names).toContain('pack_git_diff');
    expect(names).toContain('save_project_memory');
    expect(names).toContain('query_project_memory');
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

  it('returns error for unknown tool call', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
        arguments: {},
      },
    });

    expect(res?.id).toBe(12);
    expect(res?.error).toBeDefined();
    expect(res?.error?.code).toBe(-32601);
  });
});
