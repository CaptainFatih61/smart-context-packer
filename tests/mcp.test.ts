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
    expect((res?.result as any).serverInfo.version).toBe('1.2.0');
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
    expect(tools.length).toBe(2);

    const names = tools.map((t: any) => t.name);
    expect(names).toContain('pack_context');
    expect(names).toContain('inspect_dependency_graph');
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

  it('calls pack_context tool', async () => {
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
        },
      },
    });

    expect(res?.id).toBe(5);
    const content = (res?.result as any).content[0].text;
    expect(content).toContain('SMART CONTEXT PACKER: AI DIRECTIVE');
    expect(content).toContain('### File:');
  });

  it('returns error for unknown tool call', async () => {
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
        arguments: {},
      },
    });

    expect(res?.id).toBe(6);
    expect(res?.error).toBeDefined();
    expect(res?.error?.code).toBe(-32601);
  });
});
