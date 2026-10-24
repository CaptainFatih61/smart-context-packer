import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CacheEntry, CacheStore, FileStats } from './types.js';

const CACHE_VERSION = '2.0';

/**
 * Computes a SHA-256 cryptographic digest for file content.
 */
export function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Extracts top-level exported symbol names from source code for progressive disclosure indexing.
 */
export function extractExportedSymbols(content: string, ext: string): string[] {
  if (!content) return [];
  const normalizedExt = ext.toLowerCase();

  // For Lua
  if (normalizedExt === '.lua') {
    const luaSymbols = new Set<string>();
    const funcRegex = /^(?:local\s+)?function\s+([a-zA-Z0-9_.:]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = funcRegex.exec(content)) !== null) {
      if (match[1]) luaSymbols.add(match[1]);
    }
    return Array.from(luaSymbols);
  }

  // For Python
  if (normalizedExt === '.py') {
    const pySymbols = new Set<string>();
    const pyRegex = /^(?:async\s+)?(?:def|class)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = pyRegex.exec(content)) !== null) {
      if (match[1]) pySymbols.add(match[1]);
    }
    return Array.from(pySymbols);
  }

  // For Go
  if (normalizedExt === '.go') {
    const goSymbols = new Set<string>();
    // Matches top-level func/type/const/var that start with an uppercase letter
    const goRegex = /^(?:func\s+(?:\([^)]+\)\s+)?|type\s+|const\s+|var\s+)([A-Z][a-zA-Z0-9_]*)/gm;
    let match: RegExpExecArray | null;
    while ((match = goRegex.exec(content)) !== null) {
      if (match[1]) goSymbols.add(match[1]);
    }
    return Array.from(goSymbols);
  }

  // For Rust
  if (normalizedExt === '.rs') {
    const rustSymbols = new Set<string>();
    // Matches top-level pub fn, pub struct, pub enum, pub trait, pub type, pub const
    const rustRegex = /^\s*pub(?:\([^)]+\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = rustRegex.exec(content)) !== null) {
      if (match[1]) rustSymbols.add(match[1]);
    }
    return Array.from(rustSymbols);
  }

  // For C#
  if (normalizedExt === '.cs') {
    const csSymbols = new Set<string>();
    const csRegex =
      /^\s*(?:public|internal)\s+(?:static\s+|abstract\s+|sealed\s+|partial\s+)*(?:class|interface|struct|enum|record)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = csRegex.exec(content)) !== null) {
      if (match[1]) csSymbols.add(match[1]);
    }
    return Array.from(csSymbols);
  }

  // For Java & Kotlin
  if (normalizedExt === '.java' || normalizedExt === '.kt') {
    const jvmSymbols = new Set<string>();
    const jvmRegex =
      /^\s*(?:public\s+)?(?:abstract\s+|final\s+|sealed\s+)*(?:class|interface|enum|record)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = jvmRegex.exec(content)) !== null) {
      if (match[1]) jvmSymbols.add(match[1]);
    }
    if (normalizedExt === '.kt') {
      const ktFunRegex = /^\s*(?:fun)\s+([a-zA-Z0-9_]+)/gm;
      while ((match = ktFunRegex.exec(content)) !== null) {
        if (match[1]) jvmSymbols.add(match[1]);
      }
    }
    return Array.from(jvmSymbols);
  }

  // For C / C++
  if (['.c', '.cpp', '.cc', '.h', '.hpp'].includes(normalizedExt)) {
    const cppSymbols = new Set<string>();
    const structRegex = /^\s*(?:class|struct|enum(?:\s+class)?|union)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = structRegex.exec(content)) !== null) {
      if (match[1]) cppSymbols.add(match[1]);
    }
    return Array.from(cppSymbols);
  }

  // For PHP
  if (normalizedExt === '.php') {
    const phpSymbols = new Set<string>();
    const phpRegex = /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = phpRegex.exec(content)) !== null) {
      if (match[1]) phpSymbols.add(match[1]);
    }
    return Array.from(phpSymbols);
  }

  // For Dart
  if (normalizedExt === '.dart') {
    const dartSymbols = new Set<string>();
    const dartRegex = /^\s*(?:abstract\s+)?(?:class|mixin|enum|extension)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = dartRegex.exec(content)) !== null) {
      if (match[1]) dartSymbols.add(match[1]);
    }
    return Array.from(dartSymbols);
  }

  // For Swift
  if (normalizedExt === '.swift') {
    const swiftSymbols = new Set<string>();
    const swiftRegex =
      /^\s*(?:public\s+|open\s+)?(?:final\s+)?(?:class|struct|protocol|enum|actor)\s+([a-zA-Z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = swiftRegex.exec(content)) !== null) {
      if (match[1]) swiftSymbols.add(match[1]);
    }
    return Array.from(swiftSymbols);
  }

  // For Ruby
  if (normalizedExt === '.rb') {
    const rbSymbols = new Set<string>();
    const rbRegex = /^\s*(?:class|module|def)\s+([a-zA-Z0-9_!?.]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = rbRegex.exec(content)) !== null) {
      if (match[1]) rbSymbols.add(match[1]);
    }
    return Array.from(rbSymbols);
  }

  // For TS / JS / Vue / Svelte
  const symbols = new Set<string>();
  let codeToScan = content;
  if (normalizedExt === '.svelte') {
    const scriptMatch = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      codeToScan = scriptMatch[1]!;
    }
  }

  const lines = codeToScan.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('export ')) continue;

    // export [default] (function|class|interface|type|enum|const|let|var) <Name>
    const match = trimmed.match(
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([a-zA-Z0-9_$]+)/
    );
    if (match && match[1]) {
      symbols.add(match[1]);
    }
  }

  return Array.from(symbols);
}

/**
 * High-performance, zero-dependency incremental SHA-256 AST Cache.
 */
export class AstCache {
  public static computeSha256 = computeSha256;
  public static extractExportedSymbols = extractExportedSymbols;

  private workspaceRoot: string;
  private cachePath: string;
  private entries: Map<string, CacheEntry> = new Map();
  private dirty = false;
  public hits = 0;
  public misses = 0;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.cachePath = path.resolve(workspaceRoot, '.scp', 'cache.json');
    this.load();
  }

  /**
   * Loads existing cache from disk if available.
   */
  private load(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf-8');
        const parsed = JSON.parse(raw) as CacheStore;
        if (parsed.version === CACHE_VERSION && parsed.entries) {
          for (const [key, value] of Object.entries(parsed.entries)) {
            this.entries.set(key, value);
          }
        }
      }
    } catch {
      this.entries.clear();
    }
  }

  /**
   * Retrieves cached AST metadata if the file's mtime and SHA-256 hash match.
   */
  public get(filePath: string, absolutePath?: string, rawContent?: string): CacheEntry | null {
    const abs = absolutePath || (path.isAbsolute(filePath) ? filePath : path.resolve(this.workspaceRoot, filePath));
    const rel = path.relative(this.workspaceRoot, abs).replace(/\\/g, '/');
    const cached = this.entries.get(rel) || this.entries.get(filePath);
    if (!cached) {
      this.misses++;
      return null;
    }

    try {
      if (!fs.existsSync(abs)) {
        this.entries.delete(rel);
        this.entries.delete(filePath);
        this.dirty = true;
        this.misses++;
        return null;
      }

      const stat = fs.statSync(abs);
      // Fast check: size + mtimeMs
      if (stat.size === cached.stats.characters && Math.abs(stat.mtimeMs - cached.mtimeMs) < 2) {
        this.hits++;
        return cached;
      }

      // Hash check if mtime differs
      const content = rawContent !== undefined ? rawContent : fs.readFileSync(abs, 'utf-8');
      const currentHash = computeSha256(content);
      if (currentHash === cached.hash) {
        // Update mtime to current
        cached.mtimeMs = stat.mtimeMs;
        this.dirty = true;
        this.hits++;
        return cached;
      }
    } catch {
      // In case of error reading file
    }

    this.misses++;
    return null;
  }

  /**
   * Stores or updates an entry in the cache.
   */
  public set(
    filePath: string,
    absOrContent: string,
    rawImportsOrContent: string | string[],
    rawImportsOrStats?: string[] | FileStats,
    statsOrSymbols?: FileStats | string[],
    exportedSymbols?: string[]
  ): void {
    let absolutePath: string;
    let rawContent: string;
    let rawImports: string[];
    let stats: FileStats;
    let symbols: string[] | undefined;

    if (Array.isArray(rawImportsOrContent)) {
      // Called as: set(filePath, rawContent, rawImports, stats, exportedSymbols)
      absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.workspaceRoot, filePath);
      rawContent = absOrContent;
      rawImports = rawImportsOrContent;
      stats = rawImportsOrStats as FileStats;
      symbols = statsOrSymbols as string[] | undefined;
    } else {
      // Called as: set(filePath, absolutePath, rawContent, rawImports, stats, exportedSymbols)
      absolutePath = absOrContent;
      rawContent = rawImportsOrContent;
      rawImports = (rawImportsOrStats as string[]) || [];
      stats = statsOrSymbols as FileStats;
      symbols = exportedSymbols;
    }

    try {
      const rel = path.relative(this.workspaceRoot, absolutePath).replace(/\\/g, '/');
      const stat = fs.statSync(absolutePath);
      const hash = computeSha256(rawContent);
      const symList = symbols ?? extractExportedSymbols(rawContent, path.extname(filePath));

      const entry: CacheEntry = {
        hash,
        mtimeMs: stat.mtimeMs,
        rawImports,
        exportedSymbols: symList,
        stats,
      };

      this.entries.set(rel, entry);
      this.entries.set(filePath, entry);
      this.dirty = true;
      this.save();
    } catch {
      // Ignore if stat failed
    }
  }

  /**
   * Persists the cache to disk.
   */
  public save(): void {
    if (!this.dirty) return;

    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: CacheStore = {
        version: CACHE_VERSION,
        entries: Object.fromEntries(this.entries.entries()),
      };

      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // Silent fail on read-only environments
    }
  }

  /**
   * Clears in-memory entries and removes the cache file.
   */
  public clear(): void {
    this.entries.clear();
    this.dirty = false;
    this.hits = 0;
    this.misses = 0;
    try {
      if (fs.existsSync(this.cachePath)) {
        fs.unlinkSync(this.cachePath);
      }
    } catch {
      // Ignore
    }
  }

  public get size(): number {
    return this.entries.size;
  }
}
