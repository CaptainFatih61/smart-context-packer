import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateVisualizerHtml, writeVisualizerReport } from '../src/visualizer.js';
import type { DependencyGraph } from '../src/types.js';

describe('Interactive Visual Dependency Inspector (src/visualizer.ts)', () => {
  const mockGraph: DependencyGraph = {
    'src/index.ts': {
      path: 'src/index.ts',
      content: 'import { auth } from "./auth.js";',
      depth: 0,
      rawImports: ['src/auth.ts'],
      stats: { lines: 10, characters: 150, estimatedTokens: 35 }
    },
    'src/auth.ts': {
      path: 'src/auth.ts',
      content: 'export function auth() {}',
      depth: 1,
      rawImports: [],
      stats: { lines: 25, characters: 400, estimatedTokens: 90 },
      exportedSymbols: ['auth']
    }
  };

  it('generates self-contained standalone HTML without external script tags', () => {
    const html = generateVisualizerHtml(mockGraph, {
      title: 'Test Visualizer'
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Visualizer');
    expect(html).toContain('src/index.ts');
    expect(html).toContain('src/auth.ts');
    // Ensure no CDN dependencies
    expect(html).not.toContain('https://cdn');
    expect(html).not.toContain('http://');
    expect(html).toContain('<canvas id="graph-canvas"></canvas>');
  });

  it('writes visualizer report file to disk and creates parent directories', () => {
    const testOut = path.resolve('tests/fixtures/test_visualizer.html');
    const returnedPath = writeVisualizerReport(mockGraph, {
      outputPath: testOut
    });

    expect(returnedPath).toBe(testOut);
    expect(fs.existsSync(testOut)).toBe(true);

    const content = fs.readFileSync(testOut, 'utf-8');
    expect(content).toContain('Smart Context Packer');

    // Clean up
    fs.unlinkSync(testOut);
  });
});
