import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DependencyAnalyzer } from '../src/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fivemDir = path.resolve(__dirname, 'fixtures/fivem-resource');

describe('DependencyAnalyzer (Lua & FiveM)', () => {
  it('parses fxmanifest.lua tables and globs into dependency graph', async () => {
    const analyzer = new DependencyAnalyzer({
      cwd: fivemDir,
      maxDepth: 3,
    });

    const graph = await analyzer.analyze(['fxmanifest.lua']);

    expect(graph.targets).toContain('fxmanifest.lua');
    expect(graph.nodes.has('fxmanifest.lua')).toBe(true);

    // Should resolve shared_scripts: config.lua
    expect(graph.nodes.has('config.lua')).toBe(true);

    // Should expand client_scripts: client/**/*.lua
    expect(graph.nodes.has('client/main.lua')).toBe(true);
    expect(graph.nodes.has('client/utils.lua')).toBe(true);

    // Should expand server_scripts: server/**/*.lua
    expect(graph.nodes.has('server/main.lua')).toBe(true);
  });

  it('resolves Lua dot notation require statements (client.utils -> client/utils.lua)', async () => {
    const analyzer = new DependencyAnalyzer({
      cwd: fivemDir,
      maxDepth: 2,
    });

    const graph = await analyzer.analyze(['client/main.lua']);

    expect(graph.nodes.has('client/main.lua')).toBe(true);
    expect(graph.nodes.has('client/utils.lua')).toBe(true);

    const clientNode = graph.nodes.get('client/main.lua')!;
    expect(clientNode.imports).toContain('client/utils.lua');
  });
});
