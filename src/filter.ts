import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export const DEFAULT_IGNORED_PATTERNS = [
  'node_modules/**',
  'dist/**',
  '.git/**',
  '.next/**',
  '.turbo/**',
  'build/**',
  'out/**',
  'coverage/**',
  '.cache/**',
  '**/*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.webp',
  '**/*.ico',
  '**/*.mp3',
  '**/*.mp4',
  '**/*.wav',
  '**/*.ogg',
  '**/*.zip',
  '**/*.tar',
  '**/*.gz',
  '**/*.pdf',
  '**/*.exe',
  '**/*.dll',
  '**/*.so',
  '**/*.dylib',
  '**/*.woff',
  '**/*.woff2',
  '**/*.ttf',
  '**/*.eot',
  '**/.DS_Store',
  '**/Thumbs.db',
];

export class FileFilter {
  private ig: Ignore;

  constructor(workspaceRoot: string, customPatterns: string[] = []) {
    const createIgnore = (typeof ignore === 'function'
      ? ignore
      : (ignore as unknown as { default: () => Ignore }).default) as () => Ignore;
    this.ig = createIgnore();

    // 1. Add built-in defaults
    this.ig.add(DEFAULT_IGNORED_PATTERNS);

    // 2. Read workspace .gitignore if present
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
        this.ig.add(gitignoreContent);
      } catch {
        // Silently continue if .gitignore cannot be read
      }
    }

    // 3. Add any user custom patterns
    if (customPatterns.length > 0) {
      this.ig.add(customPatterns);
    }
  }

  /**
   * Checks whether a relative file path matches ignore criteria.
   */
  public isIgnored(relativeFilePath: string): boolean {
    const normalized = relativeFilePath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized === '.') return false;
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) {
      return false;
    }
    return this.ig.ignores(normalized);
  }
}

/**
 * Redacts secrets, tokens, API keys, and connection strings.
 */
export function redactSecrets(content: string, filePath = ''): string {
  if (!content) return content;

  let result = content;

  // 1. Anthropic Keys (sk-ant-...)
  result = result.replace(/sk-ant-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_ANTHROPIC_KEY]');

  // 2. OpenAI Keys (sk-..., sk-proj-...)
  result = result.replace(/sk-(?!ant-)(?:proj-)?[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_OPENAI_KEY]');

  // 3. GitHub Tokens (ghp_..., gho_..., github_pat_...)
  result = result.replace(/(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g, '[REDACTED_GITHUB_TOKEN]');
  result = result.replace(/github_pat_[a-zA-Z0-9_]{40,}/g, '[REDACTED_GITHUB_PAT]');

  // 4. AWS Access Key ID
  result = result.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]');

  // 5. Stripe Keys (sk_live_..., rk_live_..., sk_test_..., rk_test_...)
  result = result.replace(/\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/g, '[REDACTED_STRIPE_LIVE_KEY]');
  result = result.replace(/\b(?:sk|rk)_test_[0-9a-zA-Z]{24,}\b/g, '[REDACTED_STRIPE_TEST_KEY]');

  // 6. Slack Tokens (xoxb-..., xoxp-..., xoxa-...)
  result = result.replace(/\bxox[baprs]-[0-9a-zA-Z\-]{10,48}\b/g, '[REDACTED_SLACK_TOKEN]');

  // 7. JWT Tokens (3 base64url segments)
  result = result.replace(/\beyJ[A-Za-z0-9-_]{10,}\.eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b/g, '[REDACTED_JWT_TOKEN]');

  // 8. PEM Private Key Blocks
  result = result.replace(
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    '-----BEGIN PRIVATE KEY-----\n[REDACTED_PRIVATE_KEY]\n-----END PRIVATE KEY-----'
  );

  // 6. Database Connection URLs with Passwords (postgres, mysql, mongodb, redis, etc.)
  result = result.replace(
    /([a-zA-Z0-9+]+:\/\/[a-zA-Z0-9_\-\.%]+:)([^@/\s]+)(@[a-zA-Z0-9_\-\.]+)/g,
    '$1[REDACTED]$3'
  );

  // 7. Generic .env style key=value assignments containing sensitive keywords
  const sensitiveEnvPattern =
    /(^[ \t]*(?:export[ \t]+)?(?:[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|AUTH|CREDENTIALS|API_KEY)[A-Z0-9_]*)[ \t]*=[ \t]*)(['"]?)(?:(?!\2).)+(\2)/gim;
  result = result.replace(sensitiveEnvPattern, '$1$2[REDACTED]$2');

  // If the file is specifically a .env file, also mask any values that look like secrets
  const isEnvFile = path.basename(filePath).startsWith('.env');
  if (isEnvFile) {
    result = result.replace(
      /(^[ \t]*(?:export[ \t]+)?[A-Za-z0-9_]+[ \t]*=[ \t]*)(['"]?)(?:(?!\2)[^\r\n])+(\2)/gm,
      (match, prefix, quote, _p3) => {
        // Leave comments and non-sensitive flags alone
        if (prefix.toLowerCase().includes('port') || prefix.toLowerCase().includes('env') || prefix.toLowerCase().includes('host')) {
          return match;
        }
        return `${prefix}${quote}[REDACTED]${quote}`;
      }
    );
  }

  return result;
}

/**
 * Strips function bodies and templates while preserving signatures, types, and exports.
 */
export function extractSkeleton(content: string, ext: string): string {
  if (!content) return content;

  const normalizedExt = ext.toLowerCase();

  // Vue & Svelte SFC handling: keep scripts, collapse template & style
  if (normalizedExt === '.vue' || normalizedExt === '.svelte') {
    let stripped = content;
    stripped = stripped.replace(
      /<template[\s\S]*?<\/template>/gi,
      '<template>\n  <!-- [Template omitted for token efficiency in skeleton mode] -->\n</template>'
    );
    stripped = stripped.replace(
      /<style[\s\S]*?<\/style>/gi,
      '/* [Styles omitted in skeleton mode] */'
    );
    // Skeletonize the script contents
    stripped = stripped.replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, open, code, close) => {
      return `${open}\n${extractCodeSkeleton(code)}\n${close}`;
    });
    return stripped;
  }

  // Lua handling
  if (normalizedExt === '.lua') {
    return extractLuaSkeleton(content);
  }

  // Python handling
  if (normalizedExt === '.py') {
    return extractPythonSkeleton(content);
  }

  // Ruby handling
  if (normalizedExt === '.rb') {
    return extractRubySkeleton(content);
  }

  // TS, JS, TSX, JSX, Go, Rust, C#, Java, Kotlin, C/C++, PHP, Dart, Swift
  return extractCodeSkeleton(content);
}

/**
 * Strips method bodies for Ruby code while preserving class/module definitions.
 */
function extractRubySkeleton(code: string): string {
  const lines = code.split(/\r?\n/);
  const result: string[] = [];
  let inDef = false;
  let defIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const indent = line.search(/\S|$/);

    if (inDef) {
      if (trimmed === 'end' && indent === defIndent) {
        result.push(`${' '.repeat(indent + 2)}# [Implementation omitted for token efficiency]`);
        result.push(line);
        inDef = false;
        continue;
      }
      continue;
    }

    if (/^def\s+[a-zA-Z0-9_!?.]+/.test(trimmed)) {
      result.push(line);
      inDef = true;
      defIndent = indent;
      continue;
    }

    result.push(line);
  }
  return result.join('\n');
}

/**
 * Strips function bodies for Python code while preserving def/class signatures and docstrings.
 */
function extractPythonSkeleton(code: string): string {
  const lines = code.split(/\r?\n/);
  const result: string[] = [];
  let inDef = false;
  let defIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const indent = line.search(/\S|$/);

    if (inDef) {
      if (trimmed.length > 0 && indent <= defIndent) {
        inDef = false;
      } else {
        continue;
      }
    }

    if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      result.push(line);
      const indentStr = ' '.repeat(indent + 4);
      result.push(`${indentStr}pass  # [Implementation omitted for token efficiency]`);
      inDef = true;
      defIndent = indent;
      continue;
    }

    result.push(line);
  }
  return result.join('\n');
}

/**
 * Strips implementation bodies for TS/JS, Go, Rust, C#, Java, Kotlin, C/C++, PHP, Dart, and Swift code.
 */
function extractCodeSkeleton(code: string): string {
  const lines = code.split(/\r?\n/);
  const result: string[] = [];
  let inFunctionBody = false;
  let braceDepth = 0;
  let bodyStartDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Preserve comments, imports, exports, interfaces, type aliases, and enums
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('import(') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('export interface ') ||
      trimmed.startsWith('type ') ||
      trimmed.startsWith('interface ') ||
      trimmed.startsWith('use ') ||
      trimmed.startsWith('using ') ||
      trimmed.startsWith('package ') ||
      trimmed.startsWith('#include ') ||
      trimmed.startsWith('mod ')
    ) {
      if (!inFunctionBody) {
        result.push(line);
        continue;
      }
    }

    // Check for start of a function or method body across C-style languages
    const isFunctionHeader =
      /^(?:export\s+)?(?:async\s+)?(?:function\b|const\s+[a-zA-Z0-9_$]+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>)/.test(
        trimmed
      ) ||
      /^(?:(?:public|private|protected|internal|static|async|override|readonly|virtual|final|abstract|suspend)\s+)+[a-zA-Z0-9_<>[\]?]+\s+[a-zA-Z0-9_$]+\s*\([^)]*\)/.test(
        trimmed
      ) ||
      /^(?:(?:public|private|protected|static|async|override|readonly)\s+)+[a-zA-Z0-9_$]+\s*\([^)]*\)/.test(
        trimmed
      ) ||
      /^(?:func\s+(?:\([^)]+\)\s+)?[a-zA-Z0-9_]+\s*\([^)]*\))/.test(trimmed) || // Go / Swift func
      /^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+[a-zA-Z0-9_]+/.test(trimmed) || // Rust fn
      /^(?:fun\s+[a-zA-Z0-9_]+)/.test(trimmed); // Kotlin fun

    if (!inFunctionBody && isFunctionHeader && line.includes('{')) {
      inFunctionBody = true;
      bodyStartDepth = countBraces(line);
      braceDepth = bodyStartDepth;

      // Extract up to the opening brace
      const openBraceIdx = line.indexOf('{');
      const signature = line.substring(0, openBraceIdx + 1);
      result.push(`${signature} /* [Implementation omitted for token efficiency] */`);

      // Check if it closed on the same line
      const cleanedHeader = stripStringsAndComments(line);
      const lineCloses = (cleanedHeader.match(/\}/g) || []).length;
      const lineOpens = (cleanedHeader.match(/\{/g) || []).length;
      if (lineCloses >= lineOpens) {
        result[result.length - 1] += ' }';
        inFunctionBody = false;
        braceDepth = 0;
      }
      continue;
    }

    if (inFunctionBody) {
      const cleanedLine = stripStringsAndComments(line);
      const lineOpens = (cleanedLine.match(/\{/g) || []).length;
      const lineCloses = (cleanedLine.match(/\}/g) || []).length;
      braceDepth += lineOpens - lineCloses;

      if (braceDepth <= 0) {
        inFunctionBody = false;
        braceDepth = 0;
        result.push('}');
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Strips implementation bodies for Lua code.
 */
function extractLuaSkeleton(code: string): string {
  const lines = code.split(/\r?\n/);
  const result: string[] = [];
  let inFunction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    const isLuaFunc = /^(?:local\s+)?function\s+[a-zA-Z0-9_.:]+\s*\(.*?\)/.test(trimmed);

    if (!inFunction && isLuaFunc) {
      if (trimmed.endsWith('end')) {
        result.push(line);
      } else {
        inFunction = true;
        result.push(`${line} -- [Implementation omitted]`);
      }
      continue;
    }

    if (inFunction) {
      if (trimmed === 'end') {
        inFunction = false;
        result.push('end');
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

function countBraces(str: string): number {
  const cleaned = stripStringsAndComments(str);
  const opens = (cleaned.match(/\{/g) || []).length;
  const closes = (cleaned.match(/\}/g) || []).length;
  return opens - closes;
}

/**
 * Strips single-line comments, inline block comments, string literals, and regex literals
 * from a line of code so brace counting ({ / }) is never fooled by strings or comments.
 */
export function stripStringsAndComments(line: string): string {
  if (!line) return '';
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inBlockComment = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const next = line[i + 1];

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === '/' && next === '/') {
        break; // Rest of line is single-line comment
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    if (ch === '\\') {
      i++; // Skip escaped char inside string
      continue;
    }

    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      out += ch;
    }
  }

  return out;
}

/**
 * Performs smart middle-out slicing on massive files to respect token budgets
 * while keeping essential imports, exports, and top-level signatures.
 */
export function sliceMassiveFile(content: string, maxLines = 400): string {
  if (!content) return content;
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) return content;

  const headLines = Math.floor(maxLines * 0.4);
  const tailLines = Math.floor(maxLines * 0.2);
  const omitted = lines.length - headLines - tailLines;

  const result: string[] = [
    ...lines.slice(0, headLines),
    `\n/* ... [smart-context-packer: ${omitted} intermediate lines omitted to fit token budget] ... */\n`,
    ...lines.slice(lines.length - tailLines),
  ];

  return result.join('\n');
}

/**
 * Extracts a map of { importSpecifier -> Set of imported symbol names (or '*' if wildcard/default/side-effect) }
 * from source code. Used by the AST Dead-Code Slicing (Tree-Shaking) engine.
 */
export function extractNamedImportsMap(code: string, ext: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!code) return map;

  const normalizedExt = ext.toLowerCase();

  const addSymbols = (specifier: string, syms: string[]) => {
    if (!map.has(specifier)) {
      map.set(specifier, new Set());
    }
    const set = map.get(specifier)!;
    for (const s of syms) {
      if (s) set.add(s);
    }
  };

  // Python: from .utils import a, b as c
  if (normalizedExt === '.py') {
    const clean = code.replace(/#.*$/gm, '');
    const fromRegex = /\bfrom\s+([a-zA-Z0-9_.]+)\s+import\s+(?:\(([\s\S]*?)\)|([^\r\n]+))/g;
    let m: RegExpExecArray | null;
    while ((m = fromRegex.exec(clean)) !== null) {
      const spec = m[1]!;
      const rawList = (m[2] || m[3] || '').trim();
      if (rawList === '*') {
        addSymbols(spec, ['*']);
      } else {
        const syms = rawList
          .split(',')
          .map((part) => part.trim().split(/\s+as\s+/i)[0]!.trim())
          .filter(Boolean);
        addSymbols(spec, syms);
      }
    }
    return map;
  }

  // Rust: use crate::utils::{foo, bar}; or use crate::utils::foo;
  if (normalizedExt === '.rs') {
    const clean = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const useBraceRegex = /\buse\s+((?:crate|super|self)::[a-zA-Z0-9_:]+)::\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = useBraceRegex.exec(clean)) !== null) {
      const spec = m[1]!;
      const syms = m[2]!
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean);
      addSymbols(spec, syms);
    }
    return map;
  }

  // TS / JS / JSX / TSX / Vue / Svelte
  const cleanCode = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // Named imports: import { a, type b, c as d } from './spec' or export { a, b } from './spec'
  const namedRegex =
    /\b(?:import|export)\s+(?:type\s+)?(?:([a-zA-Z0-9_$]+)\s*,\s*)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = namedRegex.exec(cleanCode)) !== null) {
    const defaultImport = match[1];
    const namedBlock = match[2]!;
    const specifier = match[3]!;
    const symbols: string[] = [];

    if (defaultImport) {
      symbols.push('*'); // Default import requires keeping default export
    }

    const parts = namedBlock.split(',');
    for (const part of parts) {
      const cleanedPart = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]!
        .trim();
      if (cleanedPart) {
        symbols.push(cleanedPart);
      }
    }
    addSymbols(specifier, symbols);
  }

  // Namespace or default-only imports: import * as ns from './spec' or import Foo from './spec'
  const defaultOrNsRegex =
    /\bimport\s+(?:type\s+)?(?:\*\s+as\s+[a-zA-Z0-9_$]+|[a-zA-Z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultOrNsRegex.exec(cleanCode)) !== null) {
    addSymbols(match[1]!, ['*']);
  }

  // Side-effect import: import './spec' or export * from './spec'
  const wildcardRegex = /\b(?:import\s+['"]([^'"]+)['"]|export\s+\*\s+from\s+['"]([^'"]+)['"])/g;
  while ((match = wildcardRegex.exec(cleanCode)) !== null) {
    addSymbols((match[1] || match[2])!, ['*']);
  }

  return map;
}

/**
 * Symbol-Level Tree-Shaking (Dead-Code Slicing) Engine.
 * Prunes unreferenced exported functions, classes, types, and constants from a dependency file,
 * keeping ONLY the symbols requested in `usedSymbols` (plus any internal helpers they call in the same file).
 */
export function treeShakeCode(content: string, usedSymbols: string[], ext: string): string {
  if (!content || !usedSymbols || usedSymbols.length === 0 || usedSymbols.includes('*')) {
    return content;
  }

  const normalizedExt = ext.toLowerCase();
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go'].includes(normalizedExt)) {
    return content;
  }

  const lines = content.split(/\r?\n/);

  interface CodeBlock {
    symbolName?: string;
    isExported: boolean;
    startLine: number;
    endLine: number;
    text: string;
  }

  const blocks: CodeBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Match top-level declaration in TS/JS/Rust/Go/Python
    const tsMatch = trimmed.match(
      /^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([a-zA-Z0-9_$]+)/
    );
    const pyMatch = normalizedExt === '.py' ? trimmed.match(/^(?:async\s+)?(?:def|class)\s+([a-zA-Z0-9_]+)/) : null;
    const rsMatch =
      normalizedExt === '.rs'
        ? trimmed.match(/^(pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|type|const)\s+([a-zA-Z0-9_]+)/)
        : null;
    const goMatch =
      normalizedExt === '.go'
        ? trimmed.match(/^(?:func\s+(?:\([^)]+\)\s+)?|type\s+|const\s+|var\s+)([a-zA-Z0-9_]+)/)
        : null;

    let symbolName: string | undefined;
    let isExported = false;

    if (tsMatch && tsMatch[2]) {
      isExported = Boolean(tsMatch[1]);
      symbolName = tsMatch[2];
    } else if (pyMatch && pyMatch[1] && line.search(/\S|$/) === 0) {
      isExported = !pyMatch[1].startsWith('_');
      symbolName = pyMatch[1];
    } else if (rsMatch && rsMatch[2]) {
      isExported = Boolean(rsMatch[1]);
      symbolName = rsMatch[2];
    } else if (goMatch && goMatch[1]) {
      isExported = /^[A-Z]/.test(goMatch[1]);
      symbolName = goMatch[1];
    }

    if (symbolName) {
      const startIdx = i;
      let endIdx = i;

      if (normalizedExt === '.py') {
        const baseIndent = line.search(/\S|$/);
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j]!;
          if (!nextLine.trim()) continue;
          if (nextLine.search(/\S|$/) <= baseIndent) break;
          endIdx = j;
        }
      } else {
        // Brace or semicolon tracking
        let braceDepth = 0;
        let seenBrace = false;
        let parenDepth = 0;
        for (let j = i; j < lines.length; j++) {
          const cleaned = stripStringsAndComments(lines[j]!);
          const opens = (cleaned.match(/\{/g) || []).length;
          const closes = (cleaned.match(/\}/g) || []).length;
          const pOpens = (cleaned.match(/\(/g) || []).length;
          const pCloses = (cleaned.match(/\)/g) || []).length;

          if (opens > 0) seenBrace = true;
          braceDepth += opens - closes;
          parenDepth += pOpens - pCloses;
          endIdx = j;

          if (seenBrace && braceDepth <= 0 && parenDepth <= 0) {
            break;
          }
          if (!seenBrace && parenDepth <= 0 && cleaned.trim().endsWith(';')) {
            break;
          }
        }
      }

      blocks.push({
        symbolName,
        isExported,
        startLine: startIdx,
        endLine: endIdx,
        text: lines.slice(startIdx, endIdx + 1).join('\n'),
      });
      i = endIdx + 1;
      continue;
    }

    blocks.push({
      isExported: false,
      startLine: i,
      endLine: i,
      text: line,
    });
    i++;
  }

  // Determine retained symbols (transitive closure within the same file)
  const retainedSymbols = new Set<string>(usedSymbols);
  let added = true;
  while (added) {
    added = false;
    for (const b of blocks) {
      if (b.symbolName && retainedSymbols.has(b.symbolName)) {
        // Check if this block's code references any other symbol declared in this file
        for (const candidate of blocks) {
          if (
            candidate.symbolName &&
            !retainedSymbols.has(candidate.symbolName) &&
            new RegExp(`\\b${candidate.symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(b.text)
          ) {
            retainedSymbols.add(candidate.symbolName);
            added = true;
          }
        }
      }
    }
  }

  const outputLines: string[] = [];
  let prunedCount = 0;
  const prunedNames: string[] = [];

  for (const b of blocks) {
    if (b.symbolName) {
      if (retainedSymbols.has(b.symbolName)) {
        outputLines.push(b.text);
      } else {
        prunedCount++;
        prunedNames.push(b.symbolName);
      }
    } else {
      // Keep imports and file-level headers
      outputLines.push(b.text);
    }
  }

  if (prunedCount > 0) {
    outputLines.push(
      `\n/* [smart-context-packer tree-shaker: pruned ${prunedCount} unused symbol(s): ${prunedNames.slice(0, 8).join(', ')}${prunedNames.length > 8 ? '...' : ''}] */`
    );
  }

  return outputLines.join('\n');
}

