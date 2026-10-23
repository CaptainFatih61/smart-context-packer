import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AstCache } from '../src/cache.js';

describe('AstCache (Incremental SHA-256 AST Cache)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-cache-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('computes consistent sha-256 hashes', () => {
    const hash1 = AstCache.computeSha256('hello world');
    const hash2 = AstCache.computeSha256('hello world');
    const hash3 = AstCache.computeSha256('different content');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64);
  });

  it('extracts exported symbols for various languages', () => {
    const tsCode = `
      export function parseData() {}
      export const API_URL = 'https://api.com';
      export class UserService {}
      export interface AuthToken {}
      export type ID = string;
      export default class DefaultHandler {}
    `;
    const symbols = AstCache.extractExportedSymbols(tsCode, '.ts');
    expect(symbols).toContain('parseData');
    expect(symbols).toContain('API_URL');
    expect(symbols).toContain('UserService');
    expect(symbols).toContain('AuthToken');
    expect(symbols).toContain('ID');
    expect(symbols).toContain('DefaultHandler');

    const pyCode = `
def helper_func():
    pass
class PythonModel:
    pass
`;
    const pySymbols = AstCache.extractExportedSymbols(pyCode, '.py');
    expect(pySymbols).toContain('helper_func');
    expect(pySymbols).toContain('PythonModel');
  });

  it('stores and retrieves cache entries on cache hit', () => {
    const cache = new AstCache(tmpDir);
    const testFile = path.join(tmpDir, 'service.ts');
    const content = 'export function testService() { return 42; }';
    fs.writeFileSync(testFile, content, 'utf-8');

    const stats = { lines: 1, characters: content.length, estimatedTokens: 10 };
    const rawImports = ['./utils.js'];
    const exportedSymbols = ['testService'];

    cache.set(testFile, content, rawImports, stats, exportedSymbols);

    // Retrieve from cache
    const cached = cache.get(testFile);
    expect(cached).not.toBeNull();
    expect(cached?.rawImports).toEqual(['./utils.js']);
    expect(cached?.exportedSymbols).toEqual(['testService']);
    expect(cached?.stats.lines).toBe(1);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(0);
  });

  it('invalidates cache on content change (cache miss)', () => {
    const cache = new AstCache(tmpDir);
    const testFile = path.join(tmpDir, 'service.ts');
    fs.writeFileSync(testFile, 'export function version1() {}', 'utf-8');

    cache.set(testFile, 'export function version1() {}', [], { lines: 1, characters: 30, estimatedTokens: 8 });

    // Modify file content
    fs.writeFileSync(testFile, 'export function version2() {} // modified', 'utf-8');

    const cached = cache.get(testFile);
    expect(cached).toBeNull();
    expect(cache.misses).toBe(1);
  });

  it('persists and reloads cache store from .scp/cache.json', () => {
    const cache1 = new AstCache(tmpDir);
    const testFile = path.join(tmpDir, 'api.ts');
    const content = 'export const endpoint = "/api";';
    fs.writeFileSync(testFile, content, 'utf-8');

    cache1.set(testFile, content, [], { lines: 1, characters: content.length, estimatedTokens: 8 }, ['endpoint']);

    // Create a new instance representing another run
    const cache2 = new AstCache(tmpDir);
    const cached = cache2.get(testFile);
    expect(cached).not.toBeNull();
    expect(cached?.exportedSymbols).toEqual(['endpoint']);
    expect(cache2.hits).toBe(1);
  });

  it('clears cache successfully', () => {
    const cache = new AstCache(tmpDir);
    const testFile = path.join(tmpDir, 'db.ts');
    fs.writeFileSync(testFile, 'export const db = {};', 'utf-8');
    cache.set(testFile, 'export const db = {};', [], { lines: 1, characters: 20, estimatedTokens: 5 });

    const cacheFile = path.join(tmpDir, '.scp', 'cache.json');
    expect(fs.existsSync(cacheFile)).toBe(true);

    cache.clear();
    expect(fs.existsSync(cacheFile)).toBe(false);
    expect(cache.get(testFile)).toBeNull();
  });
});
