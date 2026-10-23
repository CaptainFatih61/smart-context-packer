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
  DEFAULT_IGNORED_PATTERNS,
} from './filter.js';
import { calculateFileStats } from './tokens.js';
import { locatePrismaSchema, extractRelevantPrismaSchema } from './prisma.js';

const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.mjs',
  '.cjs',
  '.json',
  '.lua',
];

export class DependencyAnalyzer {
  private cwd: string;
  private maxDepth: number;
  private reverse: boolean;
  private skeleton: boolean;
  private redact: boolean;
  private filter: FileFilter;
  private aliasMap: Map<string, string>;

  constructor(options: AnalyzerOptions = {}) {
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.maxDepth = options.maxDepth !== undefined ? options.maxDepth : 2;
    this.reverse = options.reverse || false;
    this.skeleton = options.skeleton || false;
    this.redact = options.redact !== false;
    this.filter = new FileFilter(this.cwd, options.ignorePatterns || []);
    this.aliasMap = this.loadTsConfigAliases(options.customAliases);
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
    const queue: Array<{ filePath: string; depth: number; parent?: string }> = [];

    for (const target of normalizedTargets) {
      queue.push({ filePath: target, depth: 0 });
    }

    // 2. Breadth-First-Search dependency traversal
    while (queue.length > 0) {
      const current = queue.shift()!;
      const { filePath, depth, parent } = current;

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
      const ext = path.extname(filePath);

      // Extract raw import specifiers
      const rawSpecifiers = this.extractImportsFromFile(rawContent, ext, absolutePath);

      // Resolve local filesystem imports
      const resolvedImports: string[] = [];
      for (const specifier of rawSpecifiers) {
        const resolvedPath = this.resolveImportPath(specifier, filePath);
        if (resolvedPath) {
          if (!this.filter.isIgnored(resolvedPath)) {
            resolvedImports.push(resolvedPath);
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
          queue.push({ filePath: dep, depth: depth + 1, parent: filePath });
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

    // 3. Vue Single File Components: extract script sections
    let codeToParse = content;
    if (normalizedExt === '.vue') {
      codeToParse = this.extractVueScripts(content);
    }

    // 4. TypeScript / JavaScript / JSX
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

    return map;
  }

  /**
   * Crawls workspace files to discover any files that import the target files.
   */
  private async discoverReverseDependencies(
    targets: string[],
    nodes: Map<string, DependencyNode>
  ): Promise<void> {
    const targetSet = new Set(targets);
    const allFiles = await fg('**/*.{ts,tsx,js,jsx,vue,lua}', {
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
    const rel = path.isAbsolute(filePath)
      ? path.relative(this.cwd, filePath)
      : filePath;
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
