import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type {
  AnalyzerOptions,
  DependencyGraph,
  DependencyNode,
  CircularWarning,
} from './types.js';
import {
  FileFilter,
  redactSecrets,
  extractSkeleton,
  extractNamedImportsMap,
  treeShakeCode,
  DEFAULT_IGNORED_PATTERNS,
} from './filter.js';
import { calculateFileStats } from './tokens.js';
import { locatePrismaSchema, extractRelevantPrismaSchema } from './prisma.js';
import { AstCache, extractExportedSymbols } from './cache.js';

export const SUPPORTED_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.svelte',
  '.mjs',
  '.cjs',
  '.json',
  '.lua',
  '.py',
  '.go',
  '.rs',
  '.cs',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.php',
  '.dart',
  '.swift',
  '.rb',
];

const EXTENSIONS = SUPPORTED_EXTENSIONS;

export const POLYGLOT_GLOB_PATTERN =
  '**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,lua,py,go,rs,cs,java,kt,kts,c,cpp,cc,cxx,h,hpp,php,dart,swift,rb,prisma}';

export class DependencyAnalyzer {
  private cwd: string;
  private maxDepth: number;
  private reverse: boolean;
  private skeleton: boolean;
  private treeShake: boolean;
  private redact: boolean;
  private filter: FileFilter;
  private aliasMap: Map<string, string>;
  private cache: AstCache | null;

  constructor(options: AnalyzerOptions = {}) {
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.maxDepth = options.maxDepth !== undefined ? options.maxDepth : (options.depth !== undefined ? options.depth : 2);
    this.reverse = options.reverse || false;
    this.skeleton = options.skeleton || false;
    this.treeShake = options.treeShake || false;
    this.redact = options.redact !== false;
    this.filter = new FileFilter(this.cwd, options.ignorePatterns || []);
    this.aliasMap = this.loadTsConfigAliases(options.customAliases);
    this.cache = options.noCache ? null : new AstCache(this.cwd);
  }

  public getCacheStats(): { hits: number; misses: number } | undefined {
    return this.cache ? { hits: this.cache.hits, misses: this.cache.misses } : undefined;
  }

  /**
   * Main entrypoint to analyze target files and construct the dependency graph.
   */
  public async analyze(targets: string[]): Promise<DependencyGraph> {
    const normalizedTargets: string[] = [];

    for (const target of targets) {
      const resolved = this.resolveTargetInput(target);
      if (resolved && !this.filter.isIgnored(resolved)) {
        normalizedTargets.push(resolved);
      }
    }

    if (normalizedTargets.length === 0) {
      throw new Error(`No valid target files found from input: ${targets.join(', ')}`);
    }

    const nodes = new Map<string, DependencyNode>();
    const circularWarnings: CircularWarning[] = [];
    const missingDependencies: string[] = [];
    const visited = new Set<string>();

    // 1. Process target entrypoints
    const queue: Array<{ filePath: string; depth: number; parent?: string; importedSymbols?: string[] }> = [];
    const requestedSymbolsPerNode = new Map<string, Set<string>>();
    const rawContentsMap = new Map<string, string>();

    const recordRequestedSymbols = (targetFile: string, syms?: string[]) => {
      if (!syms || syms.length === 0) return;
      if (!requestedSymbolsPerNode.has(targetFile)) {
        requestedSymbolsPerNode.set(targetFile, new Set());
      }
      const set = requestedSymbolsPerNode.get(targetFile)!;
      for (const s of syms) set.add(s);
    };

    for (const target of normalizedTargets) {
      queue.push({ filePath: target, depth: 0 });
    }

    // 2. Breadth-First-Search dependency traversal
    while (queue.length > 0) {
      const current = queue.shift()!;
      const { filePath, depth, parent, importedSymbols } = current;
      recordRequestedSymbols(filePath, importedSymbols);

      if (visited.has(filePath)) {
        // If already visited and we reached it from another parent, record reference
        if (parent && parent !== filePath) {
          const parentNode = nodes.get(parent);
          if (parentNode && !parentNode.imports.includes(filePath)) {
            parentNode.imports.push(filePath);
          }
          const currentNode = nodes.get(filePath);
          if (currentNode && !currentNode.importedBy.includes(parent)) {
            currentNode.importedBy.push(parent);
          }
          // Detect cycle: if current imports parent
          if (currentNode?.imports.includes(parent)) {
            circularWarnings.push({ from: parent, to: filePath });
          }
        }
        continue;
      }

      visited.add(filePath);

      const absolutePath = path.resolve(this.cwd, filePath);
      if (!fs.existsSync(absolutePath)) {
        missingDependencies.push(filePath);
        continue;
      }

      const rawContent = fs.readFileSync(absolutePath, 'utf-8');
      rawContentsMap.set(filePath, rawContent);
      const ext = path.extname(filePath);

      // Extract raw import specifiers & exported symbols with cache
      let rawSpecifiers: string[];
      let exportedSymbols: string[];

      const cached = this.cache?.get(filePath, absolutePath, rawContent);
      if (cached) {
        rawSpecifiers = cached.rawImports;
        exportedSymbols = cached.exportedSymbols;
      } else {
        rawSpecifiers = this.extractImportsFromFile(rawContent, ext, absolutePath);
        exportedSymbols = extractExportedSymbols(rawContent, ext);
        const baseStats = calculateFileStats(rawContent);
        this.cache?.set(filePath, absolutePath, rawContent, rawSpecifiers, baseStats, exportedSymbols);
      }

      // Resolve local filesystem imports and record named symbols imported per resolved file
      const resolvedImports: string[] = [];
      const namedImportsMap = extractNamedImportsMap(rawContent, ext);
      const resolvedSymbolsMap = new Map<string, string[]>();

      for (const specifier of rawSpecifiers) {
        const resolvedPath = this.resolveImportPath(specifier, filePath);
        if (resolvedPath) {
          if (!this.filter.isIgnored(resolvedPath)) {
            if (!resolvedImports.includes(resolvedPath)) {
              resolvedImports.push(resolvedPath);
            }
            const specSymbols = namedImportsMap.get(specifier);
            if (specSymbols && specSymbols.size > 0) {
              const prev = resolvedSymbolsMap.get(resolvedPath) || [];
              resolvedSymbolsMap.set(resolvedPath, Array.from(new Set([...prev, ...specSymbols])));
            } else {
              // If specifier wasn't matched as named import, assume wildcard/default
              const prev = resolvedSymbolsMap.get(resolvedPath) || [];
              if (!prev.includes('*')) prev.push('*');
              resolvedSymbolsMap.set(resolvedPath, prev);
            }
          }
        }
      }

      // Check if this node should be skeletonized
      const isSkeleton = this.skeleton && depth > 0;
      let processedContent = rawContent;

      if (isSkeleton) {
        processedContent = extractSkeleton(processedContent, ext);
      }

      if (this.redact) {
        processedContent = redactSecrets(processedContent, filePath);
      }

      const stats = calculateFileStats(processedContent);

      const node: DependencyNode = {
        filePath,
        absolutePath,
        type: depth === 0 ? 'target' : 'dependency',
        depth,
        imports: resolvedImports,
        importedBy: parent ? [parent] : [],
        isSkeleton,
        content: processedContent,
        stats,
        exportedSymbols,
      };

      nodes.set(filePath, node);

      if (parent) {
        const parentNode = nodes.get(parent);
        if (parentNode && !parentNode.imports.includes(filePath)) {
          parentNode.imports.push(filePath);
        }
      }

      // Enqueue child dependencies if within maxDepth limit
      if (depth < this.maxDepth) {
        for (const dep of resolvedImports) {
          queue.push({
            filePath: dep,
            depth: depth + 1,
            parent: filePath,
            importedSymbols: resolvedSymbolsMap.get(dep),
          });
        }
      }
    }

    // 2.5 Apply Symbol-Level Tree-Shaking (Dead-Code Slicing) to dependencies if requested
    for (const [filePath, node] of nodes.entries()) {
      const reqSymsSet = requestedSymbolsPerNode.get(filePath);
      if (reqSymsSet && reqSymsSet.size > 0) {
        node.importedSymbols = Array.from(reqSymsSet);
      }

      if (this.treeShake && node.type === 'dependency' && node.depth > 0 && node.importedSymbols) {
        if (!node.importedSymbols.includes('*')) {
          const raw = rawContentsMap.get(filePath) || node.content;
          const ext = path.extname(filePath);
          let shaken = treeShakeCode(raw, node.importedSymbols, ext);
          if (this.skeleton) {
            shaken = extractSkeleton(shaken, ext);
          }
          if (this.redact) {
            shaken = redactSecrets(shaken, filePath);
          }
          if (shaken !== node.content) {
            node.content = shaken;
            node.isTreeShaken = true;
            node.stats = calculateFileStats(shaken);
          }
        }
      }
    }

    // 3. Handle reverse dependency discovery if requested (--reverse)
    if (this.reverse) {
      await this.discoverReverseDependencies(normalizedTargets, nodes);
    }

    // 4. Smart Prisma Schema Model & Relation Extraction
    const prismaSchemaPath = locatePrismaSchema(this.cwd);
    if (prismaSchemaPath) {
      try {
        const schemaContent = fs.readFileSync(prismaSchemaPath, 'utf-8');
        const allCode = Array.from(nodes.values()).map((n) => n.content);
        const extractedPrisma = extractRelevantPrismaSchema(schemaContent, allCode);
        if (extractedPrisma) {
          const relativeSchemaPath = this.toRelative(prismaSchemaPath);
          const virtualPath = `${relativeSchemaPath} [Extracted Models]`;
          const stats = calculateFileStats(extractedPrisma);
          nodes.set(virtualPath, {
            filePath: virtualPath,
            absolutePath: prismaSchemaPath,
            type: 'dependency',
            depth: 1,
            imports: [],
            importedBy: [...normalizedTargets],
            isSkeleton: false,
            content: extractedPrisma,
            stats,
          });
        }
      } catch {
        // Silently continue if prisma schema extraction fails
      }
    }

    this.cache?.save();

    return {
      targets: normalizedTargets,
      nodes,
      circularWarnings,
      rootCwd: this.cwd,
      missingDependencies,
    };
  }

  /**
   * Resolves user target argument (which may be a file or directory).
   */
  private resolveTargetInput(target: string): string | null {
    const fullPath = path.resolve(this.cwd, target);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      return this.toRelative(fullPath);
    }

    if (stat.isDirectory()) {
      // Look for fxmanifest.lua (FiveM) or index.ts/index.js
      const candidates = [
        'fxmanifest.lua',
        'index.ts',
        'index.js',
        'src/index.ts',
        'src/main.ts',
      ];
      for (const candidate of candidates) {
        const candidatePath = path.join(fullPath, candidate);
        if (fs.existsSync(candidatePath)) {
          return this.toRelative(candidatePath);
        }
      }
    }

    return null;
  }

  /**
   * Extracts import/require specifiers from file content depending on language.
   */
  public extractImportsFromFile(content: string, ext: string, absolutePath: string): string[] {
    const specifiers = new Set<string>();

    const normalizedExt = ext.toLowerCase();

    // 1. FiveM fxmanifest.lua
    if (path.basename(absolutePath).toLowerCase() === 'fxmanifest.lua') {
      const manifestImports = this.parseFxManifest(content, path.dirname(absolutePath));
      manifestImports.forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 2. Lua files
    if (normalizedExt === '.lua') {
      this.parseLuaRequires(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 3. Go files
    if (normalizedExt === '.go') {
      this.parseGoImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 4. Rust files
    if (normalizedExt === '.rs') {
      this.parseRustImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 5. Python files
    if (normalizedExt === '.py') {
      this.parsePythonImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 6. C# files
    if (normalizedExt === '.cs') {
      this.parseCSharpImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 7. Java / Kotlin files
    if (normalizedExt === '.java' || normalizedExt === '.kt' || normalizedExt === '.kts') {
      this.parseJvmImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 8. C / C++ files
    if (['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'].includes(normalizedExt)) {
      this.parseCppIncludes(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 9. PHP files
    if (normalizedExt === '.php') {
      this.parsePhpImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 10. Dart files
    if (normalizedExt === '.dart') {
      this.parseDartImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 11. Swift files
    if (normalizedExt === '.swift') {
      this.parseSwiftImports(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 12. Ruby files
    if (normalizedExt === '.rb') {
      this.parseRubyRequires(content).forEach((imp) => specifiers.add(imp));
      return Array.from(specifiers);
    }

    // 13. Vue and Svelte Single File Components
    let codeToParse = content;
    if (normalizedExt === '.vue') {
      codeToParse = this.extractVueScripts(content);
    } else if (normalizedExt === '.svelte') {
      codeToParse = this.extractSvelteScripts(content);
    }

    // 14. TypeScript / JavaScript / JSX
    this.parseJavaScriptImports(codeToParse).forEach((imp) => specifiers.add(imp));

    return Array.from(specifiers);
  }

  /**
   * Parses static imports, exports, dynamic imports, and CJS requires from TS/JS code.
   */
  private parseJavaScriptImports(code: string): string[] {
    const results = new Set<string>();

    // Clean comments to prevent false positives in comments
    const cleanCode = code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    // import ... from '...' or import '...'
    const importRegex =
      /\bimport\s+(?:type\s+)?(?:(?:[\w*\s{},$]+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(cleanCode)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    // export ... from '...'
    const exportRegex =
      /\bexport\s+(?:type\s+)?(?:[\w*\s{},$]+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = exportRegex.exec(cleanCode)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    // dynamic import('...')
    const dynamicImportRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(cleanCode)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    // CommonJS require('...')
    const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(cleanCode)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    return Array.from(results);
  }

  /**
   * Extracts <script> and <script setup> tags from a Vue SFC.
   */
  private extractVueScripts(vueContent: string): string {
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let scripts = '';
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(vueContent)) !== null) {
      if (match[1]) scripts += match[1] + '\n';
    }
    return scripts;
  }

  /**
   * Extracts <script> tags from a Svelte SFC.
   */
  private extractSvelteScripts(svelteContent: string): string {
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let scripts = '';
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(svelteContent)) !== null) {
      if (match[1]) scripts += match[1] + '\n';
    }
    return scripts;
  }

  /**
   * Parses C# using declarations.
   */
  private parseCSharpImports(content: string): string[] {
    const results = new Set<string>();
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const usingRegex = /^\s*using\s+(?:static\s+)?([a-zA-Z0-9_.]+)\s*;/gm;
    let match: RegExpExecArray | null;
    while ((match = usingRegex.exec(clean)) !== null) {
      if (match[1]) results.add(match[1]);
    }
    return Array.from(results);
  }

  /**
   * Parses Java and Kotlin import declarations.
   */
  private parseJvmImports(content: string): string[] {
    const results = new Set<string>();
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const importRegex = /^\s*import\s+(?:static\s+)?([a-zA-Z0-9_.*]+)\s*;/gm;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(clean)) !== null) {
      if (match[1]) results.add(match[1]);
    }
    return Array.from(results);
  }

  /**
   * Parses C and C++ #include directives.
   */
  private parseCppIncludes(content: string): string[] {
    const results = new Set<string>();
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const incRegex = /^\s*#include\s+(?:["']([^"']+)["']|<([^>]+)>)/gm;
    let match: RegExpExecArray | null;
    while ((match = incRegex.exec(clean)) !== null) {
      const inc = match[1] || match[2];
      if (inc) results.add(inc);
    }
    return Array.from(results);
  }

  /**
   * Parses PHP use statements and require/include expressions.
   */
  private parsePhpImports(content: string): string[] {
    const results = new Set<string>();
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/#.*$/gm, '');
    const useRegex = /^\s*use\s+([\\a-zA-Z0-9_]+)\s*;/gm;
    let match: RegExpExecArray | null;
    while ((match = useRegex.exec(clean)) !== null) {
      if (match[1]) results.add(match[1]);
    }
    const reqRegex = /\b(?:require|require_once|include|include_once)\s*\(?['"]([^'"]+)['"]\)?/g;
    while ((match = reqRegex.exec(clean)) !== null) {
      if (match[1]) results.add(match[1]);
    }
    return Array.from(results);
  }

  /**
   * Parses Dart import, export, and part statements.
   */
  private parseDartImports(content: string): string[] {
    const results = new Set<string>();
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const dartRegex = /\b(?:import|export|part)\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = dartRegex.exec(clean)) !== null) {
      if (match[1]) results.add(match[1]);
    }
    return Array.from(results);
  }

  /**
   * Parses Swift import statements.
   */
  private parseSwiftImports(content: string): string[] {
    const results = new Set<string>();
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const swiftRegex = /^\s*import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?([a-zA-Z0-9_.]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = swiftRegex.exec(clean)) !== null) {
      if (match[1]) results.add(match[1]);
    }
    return Array.from(results);
  }

  /**
   * Parses Ruby require and require_relative calls.
   */
  private parseRubyRequires(content: string): string[] {
    const results = new Set<string>();
    const clean = content.replace(/#.*$/gm, '');
    const rbRegex = /\b(?:require|require_relative|load)\s*\(?['"]([^'"]+)['"]\)?/g;
    let match: RegExpExecArray | null;
    while ((match = rbRegex.exec(clean)) !== null) {
      if (match[1]) results.add(match[1]);
    }
    return Array.from(results);
  }

  /**
   * Parses Lua require and dofile statements.
   */
  private parseLuaRequires(luaContent: string): string[] {
    const results = new Set<string>();

    // Remove comments (-- ...)
    const cleanLua = luaContent.replace(/--.*$/gm, '');

    // require('module') or require "module" or require 'module'
    const requireRegex = /\brequire\s*\(?['"]([^'"]+)['"]\)?/g;
    let match: RegExpExecArray | null;
    while ((match = requireRegex.exec(cleanLua)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    // dofile('file.lua')
    const dofileRegex = /\bdofile\s*\(?['"]([^'"]+)['"]\)?/g;
    while ((match = dofileRegex.exec(cleanLua)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    return Array.from(results);
  }

  /**
   * Parses Go import declarations (single and multi-line blocks).
   */
  private parseGoImports(goContent: string): string[] {
    const results = new Set<string>();
    const cleanGo = goContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // Single import: import "fmt" or import alias "path/pkg"
    const singleRegex = /\bimport\s+(?:[a-zA-Z0-9_.]+\s+)?["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = singleRegex.exec(cleanGo)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    // Block import: import ( ... )
    const blockRegex = /\bimport\s*\(([\s\S]*?)\)/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRegex.exec(cleanGo)) !== null) {
      const block = blockMatch[1]!;
      const itemRegex = /(?:[a-zA-Z0-9_.]+\s+)?["']([^"']+)["']/g;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(block)) !== null) {
        if (itemMatch[1]) results.add(itemMatch[1]);
      }
    }

    return Array.from(results);
  }

  /**
   * Parses Rust mod declarations and use statements.
   */
  private parseRustImports(rustContent: string): string[] {
    const results = new Set<string>();
    const cleanRust = rustContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // mod declarations: mod foo; or pub mod foo;
    const modRegex = /\b(?:pub\s+)?mod\s+([a-zA-Z0-9_]+)\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = modRegex.exec(cleanRust)) !== null) {
      if (match[1]) results.add(`mod:${match[1]}`);
    }

    // use statements: use crate::foo::Bar; or use super::foo;
    const useRegex = /\buse\s+((?:crate|super|self)::[a-zA-Z0-9_:]+)/g;
    while ((match = useRegex.exec(cleanRust)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    return Array.from(results);
  }

  /**
   * Parses Python import and from ... import statements.
   */
  private parsePythonImports(pyContent: string): string[] {
    const results = new Set<string>();
    const cleanPy = pyContent.replace(/#.*$/gm, '');

    // from .foo import bar or from ..database import models
    const fromRegex = /\bfrom\s+([a-zA-Z0-9_.]+)\s+import/g;
    let match: RegExpExecArray | null;
    while ((match = fromRegex.exec(cleanPy)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    // import foo or import foo.bar
    const importRegex = /\bimport\s+([a-zA-Z0-9_.]+)/g;
    while ((match = importRegex.exec(cleanPy)) !== null) {
      if (match[1]) results.add(match[1]);
    }

    return Array.from(results);
  }

  /**
   * Parses FiveM fxmanifest.lua: shared_scripts, client_scripts, server_scripts.
   */
  private parseFxManifest(manifestContent: string, manifestDir: string): string[] {
    const results = new Set<string>();

    // Table blocks: shared_scripts { 'a.lua', 'b/**/*.lua' }
    const tableRegex =
      /(?:shared_scripts|client_scripts|server_scripts)\s*\{([^}]+)\}/gi;
    let tableMatch: RegExpExecArray | null;

    while ((tableMatch = tableRegex.exec(manifestContent)) !== null) {
      const block = tableMatch[1]!;
      const itemRegex = /['"]([^'"]+)['"]/g;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(block)) !== null) {
        const item = itemMatch[1]!;
        this.expandLuaGlob(item, manifestDir).forEach((file) => results.add(file));
      }
    }

    // Single definitions: shared_script 'file.lua'
    const singleRegex =
      /(?:shared_script|client_script|server_script)\s+['"]([^'"]+)['"]/gi;
    while ((tableMatch = singleRegex.exec(manifestContent)) !== null) {
      const item = tableMatch[1]!;
      this.expandLuaGlob(item, manifestDir).forEach((file) => results.add(file));
    }

    return Array.from(results);
  }

  /**
   * Expands glob patterns within fxmanifest.lua into concrete files.
   */
  private expandLuaGlob(pattern: string, baseDir: string): string[] {
    // Ignore external imports or non-local files
    if (pattern.startsWith('@')) {
      // FiveM resource imports e.g. '@es_extended/imports.lua' - skip or return
      return [];
    }

    try {
      const matched = fg.sync(pattern, {
        cwd: baseDir,
        onlyFiles: true,
        absolute: true,
      });

      return matched.map((abs) => this.toRelative(abs));
    } catch {
      return [];
    }
  }

  /**
   * Resolves an import specifier (relative, alias, or Lua) to a relative file path.
   */
  public resolveImportPath(specifier: string, fromFile: string): string | null {
    // If it's already an existing relative file from cwd (e.g. from fxmanifest glob expansion)
    const directFromCwd = path.resolve(this.cwd, specifier);
    if (fs.existsSync(directFromCwd) && fs.statSync(directFromCwd).isFile()) {
      return this.toRelative(directFromCwd);
    }

    const fromDir = path.dirname(path.resolve(this.cwd, fromFile));

    // 1. Path alias matching (e.g. '@/components/Button')
    const aliasResolved = this.resolveAlias(specifier);
    if (aliasResolved) {
      const verified = this.findFileWithExtension(aliasResolved);
      if (verified) return this.toRelative(verified);
    }

    // 2. Relative paths (./foo, ../bar)
    if (specifier.startsWith('.')) {
      const candidatePath = path.resolve(fromDir, specifier);
      const verified = this.findFileWithExtension(candidatePath);
      if (verified) return this.toRelative(verified);
    }

    // 3. Lua require / dofile handling
    if (fromFile.toLowerCase().endsWith('.lua')) {
      // Check direct relative to fromDir (e.g. require('utils') or require('config.lua'))
      const directFromDir = path.resolve(fromDir, specifier);
      const verifiedDirect = this.findFileWithExtension(directFromDir, ['.lua']);
      if (verifiedDirect) return this.toRelative(verifiedDirect);

      // Lua dot notation: require('client.utils') -> 'client/utils.lua'
      const luaPathConverted = specifier.replace(/\./g, '/');
      const candidatePath = path.resolve(fromDir, luaPathConverted);
      const verified = this.findFileWithExtension(candidatePath, ['.lua']);
      if (verified) return this.toRelative(verified);

      // Also try from cwd
      const candidateFromCwd = path.resolve(this.cwd, luaPathConverted);
      const verifiedFromCwd = this.findFileWithExtension(candidateFromCwd, ['.lua']);
      if (verifiedFromCwd) return this.toRelative(verifiedFromCwd);
    }

    // 4. Go package resolution
    if (fromFile.toLowerCase().endsWith('.go')) {
      // Relative import (e.g. "./subpkg" or "../pkg")
      if (specifier.startsWith('.')) {
        const candidatePath = path.resolve(fromDir, specifier);
        const verified = this.findFileWithExtension(candidatePath, ['.go']);
        if (verified) return this.toRelative(verified);
      }

      // Module-rooted import (e.g. "my-module/pkg/auth")
      const goModPath = path.join(this.cwd, 'go.mod');
      if (fs.existsSync(goModPath)) {
        try {
          const modContent = fs.readFileSync(goModPath, 'utf-8');
          const modMatch = modContent.match(/^module\s+([^\s\r\n]+)/m);
          if (modMatch && modMatch[1]) {
            const modName = modMatch[1];
            if (specifier === modName || specifier.startsWith(modName + '/')) {
              const subPath = specifier === modName ? '.' : specifier.slice(modName.length + 1);
              const candidatePath = path.resolve(this.cwd, subPath);
              const verified = this.findFileWithExtension(candidatePath, ['.go']);
              if (verified) return this.toRelative(verified);
            }
          }
        } catch {
          // ignore go.mod read errors
        }
      }
    }

    // 5. Rust module & use resolution
    if (fromFile.toLowerCase().endsWith('.rs')) {
      if (specifier.startsWith('mod:')) {
        const modName = specifier.slice(4);
        const directFile = path.resolve(fromDir, `${modName}.rs`);
        if (fs.existsSync(directFile) && fs.statSync(directFile).isFile()) {
          return this.toRelative(directFile);
        }
        const modDirFile = path.resolve(fromDir, modName, 'mod.rs');
        if (fs.existsSync(modDirFile) && fs.statSync(modDirFile).isFile()) {
          return this.toRelative(modDirFile);
        }
      }

      if (specifier.startsWith('crate::')) {
        const parts = specifier.slice(7).split('::');
        const first = parts[0]!;
        // Try src/first.rs or src/first/mod.rs
        const tryPaths = [
          path.resolve(this.cwd, 'src', `${first}.rs`),
          path.resolve(this.cwd, 'src', first, 'mod.rs'),
          path.resolve(fromDir, `${first}.rs`),
          path.resolve(fromDir, first, 'mod.rs')
        ];
        for (const p of tryPaths) {
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            return this.toRelative(p);
          }
        }
      }

      if (specifier.startsWith('super::')) {
        const parts = specifier.slice(7).split('::');
        const first = parts[0]!;
        const tryPaths = [
          path.resolve(fromDir, '..', `${first}.rs`),
          path.resolve(fromDir, '..', first, 'mod.rs')
        ];
        for (const p of tryPaths) {
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            return this.toRelative(p);
          }
        }
      }
    }

    // 6. Python import resolution
    if (fromFile.toLowerCase().endsWith('.py')) {
      if (specifier.startsWith('.')) {
        // Count leading dots
        let dots = 0;
        while (specifier[dots] === '.') dots++;
        const rest = specifier.slice(dots).replace(/\./g, '/');
        const baseDir = dots === 1 ? fromDir : path.resolve(fromDir, '../'.repeat(dots - 1));
        const candidate = rest ? path.resolve(baseDir, rest) : baseDir;
        const verified = this.findFileWithExtension(candidate, ['.py']);
        if (verified) return this.toRelative(verified);
      } else {
        const pyConverted = specifier.replace(/\./g, '/');
        const candidateFromDir = path.resolve(fromDir, pyConverted);
        const verifiedFromDir = this.findFileWithExtension(candidateFromDir, ['.py']);
        if (verifiedFromDir) return this.toRelative(verifiedFromDir);

        const candidateFromCwd = path.resolve(this.cwd, pyConverted);
        const verifiedFromCwd = this.findFileWithExtension(candidateFromCwd, ['.py']);
        if (verifiedFromCwd) return this.toRelative(verifiedFromCwd);
      }
    }

    // 7. C# namespace / file resolution
    if (fromFile.toLowerCase().endsWith('.cs')) {
      if (specifier.startsWith('.')) {
        const candidate = path.resolve(fromDir, specifier);
        const verified = this.findFileWithExtension(candidate, ['.cs']);
        if (verified) return this.toRelative(verified);
      } else {
        const converted = specifier.replace(/\./g, '/');
        const candidates = [
          path.resolve(fromDir, converted),
          path.resolve(fromDir, specifier),
          path.resolve(this.cwd, converted),
          path.resolve(this.cwd, 'src', converted),
        ];
        for (const c of candidates) {
          const verified = this.findFileWithExtension(c, ['.cs']);
          if (verified) return this.toRelative(verified);
        }
      }
    }

    // 8. Java & Kotlin package / class resolution
    if (fromFile.toLowerCase().endsWith('.java') || fromFile.toLowerCase().endsWith('.kt')) {
      const jvmExts = ['.java', '.kt'];
      if (specifier.startsWith('.')) {
        const candidate = path.resolve(fromDir, specifier);
        const verified = this.findFileWithExtension(candidate, jvmExts);
        if (verified) return this.toRelative(verified);
      } else {
        const cleanSpec = specifier.replace(/\.\*$/, '');
        const converted = cleanSpec.replace(/\./g, '/');
        const candidates = [
          path.resolve(fromDir, converted),
          path.resolve(this.cwd, converted),
          path.resolve(this.cwd, 'src/main/java', converted),
          path.resolve(this.cwd, 'src/main/kotlin', converted),
          path.resolve(this.cwd, 'src', converted),
        ];
        for (const c of candidates) {
          const verified = this.findFileWithExtension(c, jvmExts);
          if (verified) return this.toRelative(verified);
        }
      }
    }

    // 9. C / C++ include resolution
    if (['.c', '.cpp', '.cc', '.h', '.hpp'].some((e) => fromFile.toLowerCase().endsWith(e))) {
      const cppExts = ['.h', '.hpp', '.c', '.cpp', '.cc'];
      const candidates = [
        path.resolve(fromDir, specifier),
        path.resolve(this.cwd, specifier),
        path.resolve(this.cwd, 'include', specifier),
        path.resolve(this.cwd, 'src', specifier),
      ];
      for (const c of candidates) {
        const verified = this.findFileWithExtension(c, cppExts);
        if (verified) return this.toRelative(verified);
      }
    }

    // 10. PHP namespace / file resolution
    if (fromFile.toLowerCase().endsWith('.php')) {
      if (specifier.startsWith('.')) {
        const candidate = path.resolve(fromDir, specifier);
        const verified = this.findFileWithExtension(candidate, ['.php']);
        if (verified) return this.toRelative(verified);
      } else {
        const converted = specifier.replace(/\\/g, '/').replace(/^\//, '');
        const candidates = [
          path.resolve(fromDir, converted),
          path.resolve(fromDir, specifier),
          path.resolve(this.cwd, converted),
          path.resolve(this.cwd, 'src', converted),
          path.resolve(this.cwd, 'app', converted),
        ];
        for (const c of candidates) {
          const verified = this.findFileWithExtension(c, ['.php']);
          if (verified) return this.toRelative(verified);
        }
      }
    }

    // 11. Dart package & file resolution
    if (fromFile.toLowerCase().endsWith('.dart')) {
      if (specifier.startsWith('.')) {
        const candidate = path.resolve(fromDir, specifier);
        const verified = this.findFileWithExtension(candidate, ['.dart']);
        if (verified) return this.toRelative(verified);
      } else if (specifier.startsWith('package:')) {
        const rest = specifier.slice(8);
        const slashIdx = rest.indexOf('/');
        if (slashIdx !== -1) {
          const subPath = rest.slice(slashIdx + 1);
          const candidate = path.resolve(this.cwd, 'lib', subPath);
          const verified = this.findFileWithExtension(candidate, ['.dart']);
          if (verified) return this.toRelative(verified);
        }
      } else {
        const candidate = path.resolve(fromDir, specifier);
        const verified = this.findFileWithExtension(candidate, ['.dart']);
        if (verified) return this.toRelative(verified);
      }
    }

    // 12. Swift file / module resolution
    if (fromFile.toLowerCase().endsWith('.swift')) {
      const candidates = [
        path.resolve(fromDir, specifier),
        path.resolve(fromDir, `${specifier}.swift`),
        path.resolve(this.cwd, 'Sources', specifier),
        path.resolve(this.cwd, 'Sources', `${specifier}.swift`),
      ];
      for (const c of candidates) {
        const verified = this.findFileWithExtension(c, ['.swift']);
        if (verified) return this.toRelative(verified);
      }
    }

    // 13. Ruby require resolution
    if (fromFile.toLowerCase().endsWith('.rb')) {
      if (specifier.startsWith('.')) {
        const candidate = path.resolve(fromDir, specifier);
        const verified = this.findFileWithExtension(candidate, ['.rb']);
        if (verified) return this.toRelative(verified);
      } else {
        const candidates = [
          path.resolve(fromDir, specifier),
          path.resolve(this.cwd, 'lib', specifier),
          path.resolve(this.cwd, specifier),
        ];
        for (const c of candidates) {
          const verified = this.findFileWithExtension(c, ['.rb']);
          if (verified) return this.toRelative(verified);
        }
      }
    }

    // Ignore external node package imports (e.g. 'vue', 'react', 'lodash')
    if (this.isBareNodeModule(specifier)) {
      return null;
    }

    // Try relative to fromDir even without ./ prefix if file exists
    const candidatePath = path.resolve(fromDir, specifier);
    const verified = this.findFileWithExtension(candidatePath);
    if (verified) return this.toRelative(verified);

    return null;
  }

  /**
   * Checks for file with various allowed extensions, including index files and TS/JS mapping.
   */
  private findFileWithExtension(basePath: string, allowedExts = EXTENSIONS): string | null {
    // 1. Exact file match
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
      return basePath;
    }

    // 2. TypeScript NodeNext ESM mapping: import from './file.js' resolving to './file.ts' or './file.tsx'
    const currentExt = path.extname(basePath).toLowerCase();
    if (['.js', '.mjs', '.cjs', '.jsx'].includes(currentExt)) {
      const stem = basePath.slice(0, -currentExt.length);
      for (const tryExt of ['.ts', '.tsx', '.vue', '.mts', '.cts']) {
        const candidate = `${stem}${tryExt}`;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      }
    }

    // 3. Try extensions
    for (const ext of allowedExts) {
      const fileWithExt = `${basePath}${ext}`;
      if (fs.existsSync(fileWithExt) && fs.statSync(fileWithExt).isFile()) {
        return fileWithExt;
      }
    }

    // 4. Try index files inside directory
    if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
      for (const ext of allowedExts) {
        const indexFile = path.join(basePath, `index${ext}`);
        if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
          return indexFile;
        }
      }

      // Python __init__.py
      const pyInit = path.join(basePath, '__init__.py');
      if (fs.existsSync(pyInit) && fs.statSync(pyInit).isFile()) {
        return pyInit;
      }

      // Rust mod.rs
      const rustMod = path.join(basePath, 'mod.rs');
      if (fs.existsSync(rustMod) && fs.statSync(rustMod).isFile()) {
        return rustMod;
      }

      // Go package directory: pick first .go file in package
      try {
        const files = fs.readdirSync(basePath);
        const goFile = files.find((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
        if (goFile) {
          return path.join(basePath, goFile);
        }
      } catch {
        // ignore readdir error
      }
    }

    return null;
  }

  /**
   * Resolves tsconfig path aliases.
   */
  private resolveAlias(specifier: string): string | null {
    const normalizedSpecifier = specifier.replace(/\\/g, '/');
    for (const [aliasPattern, rawTargetPattern] of this.aliasMap) {
      const targetPattern = rawTargetPattern.replace(/\\/g, '/');
      if (aliasPattern.endsWith('/*')) {
        const prefix = aliasPattern.slice(0, -1); // e.g. "@/"
        if (normalizedSpecifier.startsWith(prefix)) {
          const suffix = normalizedSpecifier.slice(prefix.length).replace(/^[/\\]+/, '');
          const targetDir = targetPattern.endsWith('/*')
            ? targetPattern.slice(0, -2)
            : targetPattern;
          return path.resolve(this.cwd, targetDir, suffix);
        }
      } else if (normalizedSpecifier === aliasPattern) {
        return path.resolve(this.cwd, targetPattern);
      }
    }
    return null;
  }

  /**
   * Loads path aliases from tsconfig.json or jsconfig.json.
   */
  private loadTsConfigAliases(customAliases?: Record<string, string>): Map<string, string> {
    const map = new Map<string, string>();

    // Default common conventions
    map.set('@/*', 'src/*');
    map.set('~/*', '*');

    const configFiles = ['tsconfig.json', 'jsconfig.json'];
    for (const configFile of configFiles) {
      const fullPath = path.join(this.cwd, configFile);
      if (fs.existsSync(fullPath)) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          // Strip json comments
          const cleaned = raw.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
          const json = JSON.parse(cleaned);
          const baseUrl = json.compilerOptions?.baseUrl || '.';
          const paths = json.compilerOptions?.paths || {};

          for (const [key, targets] of Object.entries(paths)) {
            if (Array.isArray(targets) && targets.length > 0 && typeof targets[0] === 'string') {
              const target = path.join(baseUrl, targets[0]).replace(/\\/g, '/');
              map.set(key, target);
            }
          }
        } catch {
          // Continue if tsconfig cannot be parsed
        }
      }
    }

    if (customAliases) {
      for (const [k, v] of Object.entries(customAliases)) {
        map.set(k, v);
      }
    }

    // Discover Monorepo Workspace Packages (npm/yarn/pnpm workspaces, Cargo, Go workspaces)
    this.discoverMonorepoWorkspaces(map);

    return map;
  }

  /**
   * Scans workspace manifests (package.json workspaces, pnpm-workspace.yaml, Cargo.toml, go.work)
   * and maps workspace package names directly to their local source entrypoints.
   */
  private discoverMonorepoWorkspaces(map: Map<string, string>): void {
    const workspacePatterns: string[] = [];

    // 1. package.json "workspaces"
    const rootPkgPath = path.join(this.cwd, 'package.json');
    if (fs.existsSync(rootPkgPath)) {
      try {
        const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
        const ws = rootPkg.workspaces;
        if (Array.isArray(ws)) {
          workspacePatterns.push(...ws.filter((w): w is string => typeof w === 'string'));
        } else if (ws && Array.isArray(ws.packages)) {
          workspacePatterns.push(...ws.packages.filter((w: unknown): w is string => typeof w === 'string'));
        }
      } catch {
        // ignore
      }
    }

    // 2. pnpm-workspace.yaml
    const pnpmWsPath = path.join(this.cwd, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWsPath)) {
      try {
        const content = fs.readFileSync(pnpmWsPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/);
          if (m && m[1] && !m[1].startsWith('!')) {
            workspacePatterns.push(m[1].trim());
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Common monorepo conventions if packages/ or apps/ directories exist
    for (const defaultDir of ['packages/*', 'apps/*']) {
      const checkDir = path.join(this.cwd, defaultDir.slice(0, -2));
      if (fs.existsSync(checkDir) && fs.statSync(checkDir).isDirectory()) {
        if (!workspacePatterns.includes(defaultDir)) {
          workspacePatterns.push(defaultDir);
        }
      }
    }

    if (workspacePatterns.length > 0) {
      const pkgJsonPatterns = workspacePatterns.map((p) => `${p.replace(/\/+$/, '')}/package.json`);
      try {
        const pkgJsonFiles = fg.sync(pkgJsonPatterns, {
          cwd: this.cwd,
          ignore: ['**/node_modules/**', '**/dist/**'],
          onlyFiles: true,
        });

        for (const relPkgJson of pkgJsonFiles) {
          try {
            const fullPkgPath = path.join(this.cwd, relPkgJson);
            const pkgDir = path.dirname(relPkgJson).replace(/\\/g, '/');
            const pkgData = JSON.parse(fs.readFileSync(fullPkgPath, 'utf-8'));
            const pkgName = pkgData.name;
            if (typeof pkgName === 'string' && pkgName.trim()) {
              // Find primary source entrypoint
              const entryCandidates = [
                pkgData.source,
                'src/index.ts',
                'src/index.tsx',
                'src/index.js',
                'index.ts',
                'index.js',
                pkgData.main,
              ].filter((c): c is string => typeof c === 'string');

              let resolvedEntry = `${pkgDir}/src/index.ts`;
              for (const cand of entryCandidates) {
                const cleanCand = cand.replace(/^\.\//, '');
                if (fs.existsSync(path.join(this.cwd, pkgDir, cleanCand))) {
                  resolvedEntry = `${pkgDir}/${cleanCand}`;
                  break;
                }
              }

              // Map exact package import: import { x } from '@scope/pkg'
              map.set(pkgName, resolvedEntry);
              // Map subpath import: import { x } from '@scope/pkg/utils'
              const srcBase = fs.existsSync(path.join(this.cwd, pkgDir, 'src')) ? `${pkgDir}/src/*` : `${pkgDir}/*`;
              map.set(`${pkgName}/*`, srcBase);
            }
          } catch {
            // ignore individual package.json parse errors
          }
        }
      } catch {
        // ignore glob errors
      }
    }
  }

  /**
   * Crawls workspace files to discover any files that import the target files.
   */
  private async discoverReverseDependencies(
    targets: string[],
    nodes: Map<string, DependencyNode>
  ): Promise<void> {
    const targetSet = new Set(targets);
    const allFiles = await fg(POLYGLOT_GLOB_PATTERN, {
      cwd: this.cwd,
      ignore: DEFAULT_IGNORED_PATTERNS,
      onlyFiles: true,
    });

    for (const candidate of allFiles) {
      const relative = this.toRelative(candidate);
      if (nodes.has(relative) || this.filter.isIgnored(relative)) {
        continue;
      }

      const absPath = path.resolve(this.cwd, relative);
      const content = fs.readFileSync(absPath, 'utf-8');
      const ext = path.extname(relative);
      const imports = this.extractImportsFromFile(content, ext, absPath);

      for (const imp of imports) {
        const resolved = this.resolveImportPath(imp, relative);
        if (resolved && targetSet.has(resolved)) {
          // Candidate imports the target! Add it as a reverse dependency
          const isSkeleton = this.skeleton;
          let nodeContent = content;
          if (isSkeleton) {
            nodeContent = extractSkeleton(nodeContent, ext);
          }
          if (this.redact) {
            nodeContent = redactSecrets(nodeContent, relative);
          }

          const stats = calculateFileStats(nodeContent);
          nodes.set(relative, {
            filePath: relative,
            absolutePath: absPath,
            type: 'dependency',
            depth: 1,
            imports: [resolved],
            importedBy: [],
            isSkeleton,
            content: nodeContent,
            stats,
          });

          const targetNode = nodes.get(resolved);
          if (targetNode && !targetNode.importedBy.includes(relative)) {
            targetNode.importedBy.push(relative);
          }
          break;
        }
      }
    }
  }

  /**
   * Converts an absolute or relative path to a normalized relative workspace path.
   */
  private toRelative(filePath: string): string {
    if (!path.isAbsolute(filePath)) {
      return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    }
    const rel = path.relative(this.cwd, filePath);
    if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
      return filePath.replace(/\\/g, '/');
    }
    return rel.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  /**
   * Helper to identify external packages (e.g. 'react', 'lodash', 'fs', 'node:path').
   */
  private isBareNodeModule(specifier: string): boolean {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('\\')) {
      return false;
    }
    // Check if it matches an alias
    for (const aliasKey of this.aliasMap.keys()) {
      if (aliasKey.endsWith('/*') && specifier.startsWith(aliasKey.slice(0, -2))) {
        return false;
      }
      if (specifier === aliasKey) return false;
    }
    return true;
  }
}

/**
 * Convenience helper to run dependency analysis.
 */
export async function analyzeDependencies(
  targets: string[],
  options: AnalyzerOptions = {}
): Promise<DependencyGraph> {
  const analyzer = new DependencyAnalyzer(options);
  return analyzer.analyze(targets);
}
