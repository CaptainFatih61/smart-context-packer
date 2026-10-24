import { describe, it, expect } from 'vitest';
import { FileFilter, redactSecrets, extractSkeleton, sliceMassiveFile } from '../src/filter.js';

describe('FileFilter & Security Engine', () => {
  it('correctly ignores node_modules, build outputs, lock files, and binary assets', () => {
    const filter = new FileFilter(process.cwd());

    expect(filter.isIgnored('node_modules/express/index.js')).toBe(true);
    expect(filter.isIgnored('dist/bundle.js')).toBe(true);
    expect(filter.isIgnored('package-lock.json')).toBe(true);
    expect(filter.isIgnored('pnpm-lock.yaml')).toBe(true);
    expect(filter.isIgnored('src/assets/logo.png')).toBe(true);
    expect(filter.isIgnored('public/favicon.ico')).toBe(true);

    // Regular source files should NOT be ignored
    expect(filter.isIgnored('src/index.ts')).toBe(false);
    expect(filter.isIgnored('src/components/App.vue')).toBe(false);
    expect(filter.isIgnored('config.lua')).toBe(false);
  });

  it('redacts sensitive API keys, tokens, and database passwords', () => {
    const raw = `
OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890abcdef
ANTHROPIC_KEY=sk-ant-api03-abcdef1234567890abcdef123456
GITHUB_TOKEN=ghp_abcdef1234567890abcdef12345678901234
AWS_KEY=AKIAIOSFODNN7EXAMPLE
DATABASE_URL=postgres://root:supersecretpass@db.example.com:5432/main
`.trim();

    const redacted = redactSecrets(raw);

    expect(redacted).not.toContain('sk-proj-');
    expect(redacted).not.toContain('sk-ant-');
    expect(redacted).not.toContain('ghp_');
    expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redacted).not.toContain('supersecretpass');

    expect(redacted).toContain('[REDACTED_OPENAI_KEY]');
    expect(redacted).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(redacted).toContain('[REDACTED_GITHUB_TOKEN]');
    expect(redacted).toContain('[REDACTED_AWS_KEY]');
    expect(redacted).toContain('postgres://root:[REDACTED]@db.example.com:5432/main');
  });

  it('strips function bodies in skeleton mode while preserving signatures and types', () => {
    const tsCode = `
import { User } from './user';

export interface Props {
  title: string;
}

export function calculateMetrics(input: number[]): number {
  const sum = input.reduce((a, b) => a + b, 0);
  const avg = sum / input.length;
  return avg * 2;
}

export const fetchUser = async (id: string): Promise<User> => {
  const res = await api.get('/users/' + id);
  return res.data;
};
`.trim();

    const skeleton = extractSkeleton(tsCode, '.ts');

    expect(skeleton).toContain('export interface Props');
    expect(skeleton).toContain('export function calculateMetrics(input: number[]): number {');
    expect(skeleton).toContain('/* [Implementation omitted for token efficiency] */');
    expect(skeleton).not.toContain('const sum = input.reduce');
    expect(skeleton).not.toContain("await api.get('/users/' + id)");
  });

  it('replaces Vue template with placeholder in skeleton mode', () => {
    const vueCode = `
<template>
  <div class="heavy-markup">
    <button @click="handleClick">Click me</button>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
</script>
`.trim();

    const skeleton = extractSkeleton(vueCode, '.vue');

    expect(skeleton).toContain('<!-- [Template omitted for token efficiency in skeleton mode] -->');
    expect(skeleton).not.toContain('<button @click="handleClick">');
    expect(skeleton).toContain("import { ref } from 'vue'");
  });

  it('slices massive files preserving head and tail', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `// Line ${i + 1}`);
    const code = lines.join('\n');
    const sliced = sliceMassiveFile(code, 30);

    expect(sliced).toContain('// Line 1');
    expect(sliced).toContain('intermediate lines omitted to fit token budget');
    expect(sliced).toContain('// Line 100');
  });
});
