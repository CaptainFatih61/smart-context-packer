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

  // 5. PEM Private Key Blocks
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

  // Vue SFC handling: keep scripts, collapse template & style
  if (normalizedExt === '.vue') {
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

  // TS, JS, TSX, JSX
  return extractCodeSkeleton(content);
}

/**
 * Strips implementation bodies for TS/JS code.
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
      trimmed.startsWith('interface ')
    ) {
      if (!inFunctionBody) {
        result.push(line);
        continue;
      }
    }

    // Check for start of a function or method body
    const isFunctionHeader =
      /^(?:export\s+)?(?:async\s+)?(?:function\b|const\s+[a-zA-Z0-9_$]+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>)/.test(
        trimmed
      ) ||
      /^(?:(?:public|private|protected|static|async|override|readonly)\s+)+[a-zA-Z0-9_$]+\s*\([^)]*\)/.test(
        trimmed
      );

    if (!inFunctionBody && isFunctionHeader && line.includes('{')) {
      inFunctionBody = true;
      bodyStartDepth = countBraces(line);
      braceDepth = bodyStartDepth;

      // Extract up to the opening brace
      const openBraceIdx = line.indexOf('{');
      const signature = line.substring(0, openBraceIdx + 1);
      result.push(`${signature} /* [Implementation omitted for token efficiency] */`);

      // Check if it closed on the same line
      const lineCloses = (line.match(/\}/g) || []).length;
      const lineOpens = (line.match(/\{/g) || []).length;
      if (lineCloses >= lineOpens) {
        result[result.length - 1] += ' }';
        inFunctionBody = false;
        braceDepth = 0;
      }
      continue;
    }

    if (inFunctionBody) {
      const lineOpens = (line.match(/\{/g) || []).length;
      const lineCloses = (line.match(/\}/g) || []).length;
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
  const opens = (str.match(/\{/g) || []).length;
  const closes = (str.match(/\}/g) || []).length;
  return opens - closes;
}
