import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { packContext } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleAppDir = path.resolve(__dirname, 'fixtures/sample-app');
const testOutputFile = path.resolve(sampleAppDir, 'test-output.md');

describe('packContext Programmatic API', () => {
  afterEach(() => {
    if (fs.existsSync(testOutputFile)) {
      fs.unlinkSync(testOutputFile);
    }
  });

  it('packs context and writes to output file', async () => {
    const result = await packContext({
      cwd: sampleAppDir,
      targets: ['src/index.ts'],
      depth: 2,
      output: 'test-output.md',
      quiet: true,
    });

    expect(result.formattedPrompt).toContain('SMART CONTEXT PACKER: AI DIRECTIVE');
    expect(result.formattedPrompt).toContain('src/index.ts');
    expect(result.formattedPrompt).toContain('src/services/auth.ts');
    expect(result.stats.totalTokens).toBeGreaterThan(50);
    expect(result.stats.totalLines).toBeGreaterThan(10);
    expect(fs.existsSync(testOutputFile)).toBe(true);

    const writtenContent = fs.readFileSync(testOutputFile, 'utf-8');
    expect(writtenContent).toBe(result.formattedPrompt);
  });

  it('runs with skeleton mode enabled', async () => {
    const result = await packContext({
      cwd: sampleAppDir,
      targets: ['src/index.ts'],
      depth: 2,
      skeleton: true,
      quiet: true,
    });

    // auth.ts is a dependency, so its implementation should be skeletonized
    expect(result.formattedPrompt).toContain('/* [Implementation omitted for token efficiency] */');
  });
});
