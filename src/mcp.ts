import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { packContext } from './index.js';
import { getGitModifiedFiles, getGitCommitFiles } from './git.js';
import type { OutputFormat } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the effective workspace root directory for MCP tool calls.
 */
export function resolveEffectiveCwd(targets: string[], requestedCwd?: string): string {
  if (requestedCwd && fs.existsSync(requestedCwd)) {
    return path.resolve(requestedCwd);
  }

  // 1. If any target is an absolute path, find the nearest project root
  for (const t of targets) {
    if (path.isAbsolute(t) && fs.existsSync(t)) {
      let cur = fs.statSync(t).isDirectory() ? t : path.dirname(t);
      while (cur && cur !== path.dirname(cur)) {
        if (fs.existsSync(path.join(cur, 'package.json')) || fs.existsSync(path.join(cur, '.git'))) {
          return cur;
        }
        cur = path.dirname(cur);
      }
      return path.dirname(t);
    }
  }

  // 2. Check if targets exist relative to process.cwd()
  if (targets.length > 0 && targets.some((t) => fs.existsSync(path.resolve(process.cwd(), t)))) {
    return process.cwd();
  }

  // 3. If process.cwd() is inside a git repo or project root, use process.cwd()
  if (fs.existsSync(path.join(process.cwd(), '.git')) || fs.existsSync(path.join(process.cwd(), 'package.json'))) {
    return process.cwd();
  }

  // 4. Fallback: check if targets exist relative to package root (parent of dist/src)
  const pkgRoot = path.resolve(__dirname, '..');
  if (targets.some((t) => fs.existsSync(path.resolve(pkgRoot, t)))) {
    return pkgRoot;
  }

  // 5. Fallback: if pkgRoot is git repo or has package.json
  if (fs.existsSync(path.join(pkgRoot, '.git')) || fs.existsSync(path.join(pkgRoot, 'package.json'))) {
    return pkgRoot;
  }

  return process.cwd();
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

import fg from 'fast-glob';
import { AstCache } from './cache.js';
import { ProjectMemoryManager } from './memory.js';
import { generateRepoMap } from './repo-map.js';
import { BM25CodeSearch } from './query.js';
import { DependencyAnalyzer, POLYGLOT_GLOB_PATTERN } from './analyzer.js';
import { TaskManager } from './task.js';
import { DependencyManifestResolver } from './dependencies.js';
import { sandboxOutput } from './sandbox.js';
import { calculateBlastRadius } from './blast-radius.js';
import { stripStringsAndComments } from './filter.js';
import { estimateTokensForText } from './tokens.js';

/**
 * Surgically extracts the exact lines of a symbol declaration and body from source code.
 */
export function extractSymbolFromCode(
  content: string,
  symbolName: string,
  ext: string
): {
  found: boolean;
  startLine?: number;
  endLine?: number;
  signature?: string;
  codeSnippet?: string;
  estimatedTokens?: number;
} {
  const lines = content.split(/\r?\n/);
  const normalizedExt = ext.toLowerCase();

  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declRegex = new RegExp(
    `\\b(?:function\\*?|class|interface|type|enum|record|trait|struct|def|func|fun|var|const|let)\\s+${escaped}\\b|\\b${escaped}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|function)|(?:public|private|protected|static|override|virtual|abstract|async)\\s+.*\\b${escaped}\\s*\\(`,
    'i'
  );

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (declRegex.test(lines[i]!)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    const fallbackRegex = new RegExp(`\\b${escaped}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (fallbackRegex.test(line) && (line.includes('{') || line.includes(':') || line.includes('('))) {
        startIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) {
    return { found: false };
  }

  const startLine = startIdx + 1;
  const signature = lines[startIdx]!.trim();

  // Python indent-based block
  if (normalizedExt === '.py') {
    const startIndent = lines[startIdx]!.search(/\S|$/);
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      const curIndent = line.search(/\S|$/);
      if (curIndent <= startIndent) {
        break;
      }
      endIdx = i;
    }
    const snippet = lines.slice(startIdx, endIdx + 1).join('\n');
    return {
      found: true,
      startLine,
      endLine: endIdx + 1,
      signature,
      codeSnippet: snippet,
      estimatedTokens: Math.ceil(snippet.length / 4),
    };
  }

  // Ruby / Lua end-based block
  if (normalizedExt === '.rb' || normalizedExt === '.lua') {
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (/^(?:def|class|module|function|if|while|do)\b/.test(trimmed)) {
        depth++;
      }
      if (/^end\b/.test(trimmed)) {
        depth--;
        if (depth <= 0) {
          endIdx = i;
          break;
        }
      }
    }
    const snippet = lines.slice(startIdx, endIdx + 1).join('\n');
    return {
      found: true,
      startLine,
      endLine: endIdx + 1,
      signature,
      codeSnippet: snippet,
      estimatedTokens: Math.ceil(snippet.length / 4),
    };
  }

  // Brace-delimited blocks (TS, JS, C#, Java, Go, Rust, C++, PHP, Dart, Swift)
  let braceCount = 0;
  let seenBrace = false;
  let endIdx = startIdx;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const cleaned = stripStringsAndComments(line);
    const opens = (cleaned.match(/\{/g) || []).length;
    const closes = (cleaned.match(/\}/g) || []).length;

    if (opens > 0) seenBrace = true;
    braceCount += opens - closes;

    if (seenBrace && braceCount <= 0) {
      endIdx = i;
      break;
    }

    if (!seenBrace && (cleaned.trim().endsWith(';') || (i > startIdx && !line.startsWith(' ')))) {
      endIdx = i;
      break;
    }
  }

  const snippet = lines.slice(startIdx, endIdx + 1).join('\n');
  return {
    found: true,
    startLine,
    endLine: endIdx + 1,
    signature,
    codeSnippet: snippet,
    estimatedTokens: estimateTokensForText(snippet),
  };
}

/**
 * Audits text content for credential leaks and token density warnings.
 */
export function auditContextContent(content: string): {
  safe: boolean;
  leaksFound: number;
  details: Array<{ type: string; description: string; line?: number; sample?: string }>;
  totalTokens: number;
  lineCount: number;
  oversizedWarning: boolean;
  recommendations: string[];
} {
  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const totalTokens = Math.ceil(content.length / 4);
  const details: Array<{ type: string; description: string; line?: number; sample?: string }> = [];

  const leakRules: Array<{ type: string; regex: RegExp; description: string }> = [
    {
      type: 'OPENAI_API_KEY',
      regex: /\bsk-[a-zA-Z0-9]{20,}T3BlbkFJ[a-zA-Z0-9]{20,}\b|\bsk-proj-[a-zA-Z0-9_\-]{32,}\b|\bsk-(?!ant-|live_|test_)[a-zA-Z0-9]{32,64}\b/,
      description: 'OpenAI API Secret Key',
    },
    {
      type: 'ANTHROPIC_API_KEY',
      regex: /\bsk-ant-[a-zA-Z0-9_\-]{20,}\b/,
      description: 'Anthropic API Secret Key',
    },
    {
      type: 'AWS_ACCESS_KEY',
      regex: /\b(AKIA[0-9A-Z]{16})\b/,
      description: 'AWS Access Key ID',
    },
    {
      type: 'GITHUB_TOKEN',
      regex: /\b(gh[pousr]_[a-zA-Z0-9]{36,255}|github_pat_[a-zA-Z0-9_]{22,82})\b/,
      description: 'GitHub Personal/OAuth Access Token',
    },
    {
      type: 'STRIPE_SECRET_KEY',
      regex: /\b(sk_live_[0-9a-zA-Z]{24,}|rk_live_[0-9a-zA-Z]{24,})\b/,
      description: 'Stripe Live Secret Key',
    },
    {
      type: 'SLACK_TOKEN',
      regex: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/,
      description: 'Slack Bot/User Access Token',
    },
    {
      type: 'PRIVATE_KEY',
      regex: /-----BEGIN\s+(?:[A-Z0-9 ]+\s+)?PRIVATE\s+KEY-----/,
      description: 'Asymmetric Private Encryption Key',
    },
    {
      type: 'DATABASE_PASSWORD_URI',
      regex: /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|mariadb):\/\/[^:\s]+:([^@\s]+)@/i,
      description: 'Database connection string containing raw password',
    },
    {
      type: 'JWT_BEARER_TOKEN',
      regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
      description: 'JSON Web Token (JWT)',
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const rule of leakRules) {
      const match = rule.regex.exec(line);
      if (match) {
        const fullMatch = match[0];
        const masked = fullMatch.length > 8 ? `${fullMatch.slice(0, 4)}...${fullMatch.slice(-3)}` : '***';
        details.push({
          type: rule.type,
          description: rule.description,
          line: i + 1,
          sample: masked,
        });
      }
    }
  }

  const oversizedWarning = lineCount > 400 || totalTokens > 8000;
  const recommendations: string[] = [];

  if (details.length > 0) {
    recommendations.push(
      'Redact or remove hardcoded credentials before submitting this context to LLM APIs.'
    );
  }
  if (oversizedWarning) {
    recommendations.push(
      `Context is large (${totalTokens} tokens, ${lineCount} lines). Consider using --skeleton or --max-tokens to optimize context density.`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push('Context is clean and within standard token density boundaries.');
  }

  return {
    safe: details.length === 0 && !oversizedWarning,
    leaksFound: details.length,
    details,
    totalTokens,
    lineCount,
    oversizedWarning,
    recommendations,
  };
}

export const MCP_TOOLS = [
  {
    name: 'search_codebase_index',
    description:
      'Search compact ~50-token index of workspace files and exported symbols without loading file contents (Layer 1 Progressive Disclosure)',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword to filter file paths and exported symbol names',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of file entries to return (default: 50)',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'inspect_dependency_graph',
    description:
      'Inspect visual directory tree, dependency relationships, and circular warnings without file contents (Layer 2 Progressive Disclosure)',
    inputSchema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target entry file(s) to inspect',
        },
        reverse: {
          type: 'boolean',
          description: 'Discover files in workspace that import the targets',
        },
        blastRadius: {
          type: 'boolean',
          description: 'Include blast-radius impact analysis, impacted tests, and risk scoring',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
      required: ['targets'],
    },
  },
  {
    name: 'pack_context',
    description:
      'Analyze local dependency graph and package entry files and dependencies into an AI-directive prompt (Layer 3 Progressive Disclosure)',
    inputSchema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target entry file(s) or directories to analyze and pack',
        },
        depth: {
          type: 'number',
          description: 'Dependency traversal depth (default: 2, 0 for target only)',
        },
        skeleton: {
          type: 'boolean',
          description: 'Strip function/class bodies of dependencies to save tokens',
        },
        treeShake: {
          type: 'boolean',
          description: 'Prune unreferenced exported symbols from dependencies (AST Dead-Code Slicing)',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum token budget; automatically skeletonizes deep dependencies to fit',
        },
        blastRadius: {
          type: 'boolean',
          description: 'Include blast-radius impact analysis, impacted unit tests, and risk scoring',
        },
        includeDiff: {
          type: 'boolean',
          description: 'Include uncommitted Git working tree diff',
        },
        noCache: {
          type: 'boolean',
          description: 'Bypass SHA-256 AST cache',
        },
        includeMemory: {
          type: 'boolean',
          description: 'Inject persistent project memories from .scp/memory.json (default: true)',
        },
        format: {
          type: 'string',
          enum: ['md', 'xml'],
          description: 'Output prompt format: md (Markdown) or xml',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
      required: ['targets'],
    },
  },
  {
    name: 'pack_git_diff',
    description:
      'Pack uncommitted Git changes (working tree or staged) along with their local dependency graph and diff patch into an AI-directive prompt',
    inputSchema: {
      type: 'object',
      properties: {
        stagedOnly: {
          type: 'boolean',
          description: 'Package only staged git changes instead of all uncommitted modifications (default: false)',
        },
        commit: {
          type: 'string',
          description: 'Optional Git commit hash, branch, or range (e.g. "HEAD~2..HEAD", "main...feature")',
        },
        pr: {
          type: 'string',
          description: 'Optional Pull Request number, URL, or branch to package changes for',
        },
        depth: {
          type: 'number',
          description: 'Dependency traversal depth (default: 2, 0 for target modified files only)',
        },
        skeleton: {
          type: 'boolean',
          description: 'Strip function/class bodies of dependencies to save tokens',
        },
        treeShake: {
          type: 'boolean',
          description: 'Prune unreferenced exported symbols from dependencies (AST Dead-Code Slicing)',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum token budget; automatically skeletonizes deep dependencies to fit',
        },
        blastRadius: {
          type: 'boolean',
          description: 'Include blast-radius impact analysis, impacted unit tests, and risk scoring',
        },
        noCache: {
          type: 'boolean',
          description: 'Bypass SHA-256 AST cache',
        },
        includeMemory: {
          type: 'boolean',
          description: 'Inject persistent project memories from .scp/memory.json (default: true)',
        },
        format: {
          type: 'string',
          enum: ['md', 'xml'],
          description: 'Output prompt format: md (Markdown) or xml',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'save_project_memory',
    description:
      'Store persistent architectural decisions, bug root causes, gotchas, or rules in .scp/memory.json linked to file patterns',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob or file pattern to link this memory to (e.g. "src/mcp.ts", "src/auth/**", "*.test.ts")',
        },
        content: {
          type: 'string',
          description: 'Architectural decision, gotcha, or pattern note to persist',
        },
        category: {
          type: 'string',
          enum: ['architecture', 'gotcha', 'decision', 'rule'],
          description: 'Category of memory note (default: architecture)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
      required: ['pattern', 'content'],
    },
  },
  {
    name: 'query_project_memory',
    description:
      'Query stored architectural memories and gotchas from .scp/memory.json by file path or search keyword',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'File path or glob pattern to find matching memories for',
        },
        query: {
          type: 'string',
          description: 'Keyword search inside memory note contents',
        },
        category: {
          type: 'string',
          enum: ['architecture', 'gotcha', 'decision', 'rule'],
          description: 'Filter by memory category',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'generate_repo_map',
    description:
      'Generate an ultra-compact PageRank architectural repo-map showing top key hubs and exported signatures (global spatial orientation)',
    inputSchema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional entry target files. If omitted, uses primary project files.',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum token budget for the repo-map (default: 1024)',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'search_codebase_intent',
    description:
      'Search codebase using in-memory BM25 semantic intent routing over files, exported symbols, and documentation (e.g. "jwt token verification")',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language or keyword search query',
        },
        topK: {
          type: 'number',
          description: 'Maximum number of ranked matching files to return (default: 5)',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'generate_visualizer',
    description:
      'Generate an interactive, offline zero-dependency HTML canvas visualizer report of the dependency graph and blast radius',
    inputSchema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target entry files to visualize',
        },
        outputPath: {
          type: 'string',
          description: 'Optional custom HTML output file path (defaults to .scp/visualizer.html)',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
      required: ['targets'],
    },
  },
  {
    name: 'manage_task_context',
    description:
      'Manage crash-proof active task context, tracking multi-step implementation plans and progress checklists in .scp/tasks.json',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'create', 'complete_item', 'complete_task', 'list'],
          description:
            'Task action to perform: "get" active task, "create" a new task, "complete_item", "complete_task", or "list" all tasks',
        },
        taskName: {
          type: 'string',
          description: 'Name/title of task (required for "create")',
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of checklist steps for the new task (optional for "create")',
        },
        itemIndex: {
          type: 'number',
          description: '0-based index of checklist item to mark completed (required for "complete_item")',
        },
        taskId: {
          type: 'string',
          description: 'Optional task ID to target; defaults to currently active task',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'get_framework_manifest',
    description:
      'Extract active project dependencies and frameworks with exact resolved versions from package.json, go.mod, Cargo.toml, requirements.txt to prevent API hallucinations',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'sandbox_tool_output',
    description:
      'Compress massive noisy tool outputs (tests, linters, build logs, stack traces) by up to 95% while keeping root causes, failures, and file locations',
    inputSchema: {
      type: 'object',
      properties: {
        rawOutput: {
          type: 'string',
          description: 'Raw stdout/stderr text output from a command, test run, or build tool',
        },
        maxLines: {
          type: 'number',
          description: 'Maximum lines to retain (defaults to 100)',
        },
      },
      required: ['rawOutput'],
    },
  },
  {
    name: 'extract_symbol_definition',
    description:
      'Surgically extract the exact declaration, signature, and body lines of a specific function, class, interface, or type without loading the entire file (Layer 4 Surgical Fetch)',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Relative or absolute path to the source file',
        },
        symbolName: {
          type: 'string',
          description: 'Name of the function, class, interface, type, or method to extract',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
      required: ['filePath', 'symbolName'],
    },
  },
  {
    name: 'get_impacted_tests',
    description:
      'Identify unit and integration test files directly or transitively affected by changes to target files or git diff (test blast-radius analysis)',
    inputSchema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Target file paths to analyze (if omitted, analyzes uncommitted/staged git changes)',
        },
        stagedOnly: {
          type: 'boolean',
          description: 'If true, only analyzes staged git files when targets are omitted',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
    },
  },
  {
    name: 'audit_context_leak',
    description:
      'Audit a context block, prompt, file, or tool output for accidental secret leaks (API keys, private keys, passwords) and token bloat before sending to an LLM',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Source code, prompt text, or tool output to audit for leaks and bloat',
        },
        contextText: {
          type: 'string',
          description: 'Alias for content: prompt text or source code to audit',
        },
        filePath: {
          type: 'string',
          description: 'Optional file path to load and audit directly from disk',
        },
        cwd: {
          type: 'string',
          description: 'Workspace root directory (defaults to current project root)',
        },
      },
    },
  },
];

/**
 * Lightweight, zero-dependency Model Context Protocol (MCP) JSON-RPC 2.0 Server.
 */
export class McpServer {
  private stdin: NodeJS.ReadableStream;
  private stdout: NodeJS.WritableStream;

  constructor(stdin = process.stdin, stdout = process.stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
  }

  /**
   * Dispatches and responds to incoming JSON-RPC 2.0 requests.
   */
  public async handleMessage(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id !== undefined ? request.id : null;

    // Notifications (no id) do not expect a response
    if (request.id === undefined && request.method === 'notifications/initialized') {
      return null;
    }

    try {
      switch (request.method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'smart-context-packer',
                version: '2.4.0',
              },
            },
          };
        }

        case 'ping': {
          return {
            jsonrpc: '2.0',
            id,
            result: {},
          };
        }

        case 'tools/list': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: MCP_TOOLS,
            },
          };
        }

        case 'tools/call': {
          const params = (request.params || {}) as {
            name: string;
            arguments?: Record<string, unknown>;
          };
          const toolName = params.name;
          const args = params.arguments || {};

          if (toolName === 'search_codebase_index') {
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);
            const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
            const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';

            const files = await fg([POLYGLOT_GLOB_PATTERN], {
              cwd: effectiveCwd,
              ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/.scp/**', '**/build/**'],
              dot: false,
            });

            const cache = new AstCache(effectiveCwd);
            const results: Array<{ filePath: string; lines: number; tokens: number; symbols: string[] }> = [];

            for (const file of files) {
              const fullPath = path.resolve(effectiveCwd, file);
              const relPath = path.normalize(file).replace(/\\/g, '/');

              let symbols: string[] = [];
              let lines = 0;
              let tokens = 0;

              const cached = cache.get(fullPath);
              if (cached && cached.exportedSymbols) {
                symbols = cached.exportedSymbols;
                tokens = cached.stats.estimatedTokens;
                lines = cached.stats.lines;
              } else {
                try {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  lines = content.split('\n').length;
                  tokens = Math.ceil(content.length / 4);
                  symbols = AstCache.extractExportedSymbols(content, path.extname(fullPath));
                } catch {
                  continue;
                }
              }

              if (query) {
                const matchPath = relPath.toLowerCase().includes(query);
                const matchSymbol = symbols.some((s) => s.toLowerCase().includes(query));
                if (!matchPath && !matchSymbol) {
                  continue;
                }
              }

              results.push({
                filePath: relPath,
                lines,
                tokens,
                symbols,
              });

              if (results.length >= limit) {
                break;
              }
            }

            const header =
              `<!-- SMART CONTEXT PACKER: CODEBASE INDEX (Layer 1 Progressive Disclosure) -->\n` +
              `Workspace: ${effectiveCwd}\n` +
              `Matched: ${results.length} files${query ? ` (filter: "${query}")` : ''}\n\n`;

            const entriesText = results
              .map((r) => {
                const symText =
                  r.symbols.length > 0
                    ? ` [exports: ${r.symbols.slice(0, 10).join(', ')}${r.symbols.length > 10 ? '...' : ''}]`
                    : '';
                return `- \`${r.filePath}\` (${r.lines} lines, ~${r.tokens} tokens)${symText}`;
              })
              .join('\n');

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: header + entriesText,
                  },
                ],
              },
            };
          }

          if (toolName === 'pack_context') {
            const targets = (args.targets as string[]) || [];
            const depth = typeof args.depth === 'number' ? args.depth : 2;
            const skeleton = Boolean(args.skeleton);
            const treeShake = Boolean(args.treeShake);
            const maxTokens = typeof args.maxTokens === 'number' ? args.maxTokens : undefined;
            const blastRadius = Boolean(args.blastRadius);
            const noCache = Boolean(args.noCache);
            const includeMemory = args.includeMemory !== undefined ? Boolean(args.includeMemory) : true;
            const includeDiff = Boolean(args.includeDiff);
            const format: OutputFormat = args.format === 'xml' ? 'xml' : 'md';
            const effectiveCwd = resolveEffectiveCwd(targets, args.cwd as string | undefined);

            const packResult = await packContext({
              cwd: effectiveCwd,
              targets,
              depth,
              skeleton,
              treeShake,
              maxTokens,
              blastRadius,
              noCache,
              includeMemory,
              diff: includeDiff,
              format,
              quiet: true,
            });

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: packResult.formattedPrompt,
                  },
                ],
              },
            };
          }

          if (toolName === 'inspect_dependency_graph') {
            const targets = (args.targets as string[]) || [];
            const reverse = Boolean(args.reverse);
            const blastRadius = Boolean(args.blastRadius);
            const effectiveCwd = resolveEffectiveCwd(targets, args.cwd as string | undefined);

            const packResult = await packContext({
              cwd: effectiveCwd,
              targets,
              reverse,
              treeOnly: true,
              blastRadius,
              quiet: true,
            });

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: packResult.formattedPrompt,
                  },
                ],
              },
            };
          }

          if (toolName === 'pack_git_diff') {
            const stagedOnly = Boolean(args.stagedOnly);
            const commit = args.commit ? String(args.commit) : undefined;
            const pr = args.pr ? String(args.pr) : undefined;
            const depth = typeof args.depth === 'number' ? args.depth : 2;
            const skeleton = Boolean(args.skeleton);
            const treeShake = Boolean(args.treeShake);
            const maxTokens = typeof args.maxTokens === 'number' ? args.maxTokens : undefined;
            const blastRadius = Boolean(args.blastRadius);
            const noCache = Boolean(args.noCache);
            const includeMemory = args.includeMemory !== undefined ? Boolean(args.includeMemory) : true;
            const format: OutputFormat = args.format === 'xml' ? 'xml' : 'md';
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);

            const modifiedFiles = commit
              ? getGitCommitFiles(effectiveCwd, commit)
              : getGitModifiedFiles(effectiveCwd, stagedOnly);
            if (!pr && modifiedFiles.length === 0) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `<!-- SMART CONTEXT PACKER: AI DIRECTIVE -->\n\nNo ${
                        commit ? `changes in commit ${commit}` : stagedOnly ? 'staged' : 'uncommitted modified or untracked'
                      } Git files were detected in workspace: ${effectiveCwd}.\nWorking tree is clean.`,
                    },
                  ],
                },
              };
            }

            const packResult = await packContext({
              cwd: effectiveCwd,
              targets: modifiedFiles,
              depth,
              skeleton,
              treeShake,
              maxTokens,
              blastRadius,
              noCache,
              includeMemory,
              diff: !stagedOnly && !commit && !pr,
              staged: stagedOnly,
              commit,
              pr,
              format,
              quiet: true,
            });

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: packResult.formattedPrompt,
                  },
                ],
              },
            };
          }

          if (toolName === 'save_project_memory') {
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);
            const memoryManager = new ProjectMemoryManager(effectiveCwd);
            const entry = memoryManager.add({
              pattern: String(args.pattern),
              content: String(args.content),
              category: (args.category as any) || 'architecture',
              tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
            });

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `✔ Stored memory [${entry.id}] (${entry.category.toUpperCase()}) linked to pattern "${entry.pattern}":\n"${entry.content}"`,
                  },
                ],
              },
            };
          }

          if (toolName === 'query_project_memory') {
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);
            const memoryManager = new ProjectMemoryManager(effectiveCwd);
            const results = memoryManager.query({
              pattern: args.pattern ? String(args.pattern) : undefined,
              query: args.query ? String(args.query) : undefined,
              category: args.category ? (String(args.category) as any) : undefined,
            });

            if (results.length === 0) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `No matching project memories found in .scp/memory.json for workspace: ${effectiveCwd}`,
                    },
                  ],
                },
              };
            }

            const text = results
              .map(
                (m) =>
                  `- [${m.id}] **${m.category.toUpperCase()}** (\`${m.pattern}\`): ${m.content}${
                    m.tags && m.tags.length > 0 ? ` [tags: ${m.tags.join(', ')}]` : ''
                  }`
              )
              .join('\n');

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `<!-- SMART CONTEXT PACKER: PROJECT MEMORY -->\nFound ${results.length} memory note(s):\n\n${text}`,
                  },
                ],
              },
            };
          }

          if (toolName === 'generate_repo_map') {
            const rawTargets = Array.isArray(args.targets) ? args.targets.map(String) : [];
            const effectiveCwd = resolveEffectiveCwd(rawTargets, args.cwd as string | undefined);
            const maxTokens = typeof args.maxTokens === 'number' ? args.maxTokens : 1024;

            let targets = rawTargets;
            if (targets.length === 0) {
              const discovered = fg.sync([POLYGLOT_GLOB_PATTERN], {
                cwd: effectiveCwd,
                ignore: ['node_modules/**', 'dist/**', '.git/**', 'coverage/**', '**/*.test.*', '**/*.spec.*'],
                absolute: false,
              });
              targets = discovered.slice(0, 30);
            }

            if (targets.length === 0) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: 'No code files detected to construct repo-map.' }],
                },
              };
            }

            const analyzer = new DependencyAnalyzer({ cwd: effectiveCwd, maxDepth: 2, noCache: false });
            const graph = await analyzer.analyze(targets);
            const repoMapResult = generateRepoMap(graph, { maxTokens });

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: repoMapResult.mapText }],
              },
            };
          }

          if (toolName === 'search_codebase_intent') {
            const query = String(args.query || '');
            const topK = typeof args.topK === 'number' ? args.topK : 5;
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);

            const candidateFiles = fg.sync([POLYGLOT_GLOB_PATTERN], {
              cwd: effectiveCwd,
              ignore: ['node_modules/**', 'dist/**', '.git/**', 'coverage/**'],
              absolute: false,
            });

            const searcher = new BM25CodeSearch();
            for (const file of candidateFiles) {
              try {
                const fullPath = path.resolve(effectiveCwd, file);
                const content = fs.readFileSync(fullPath, 'utf-8');
                const ext = path.extname(file);
                const symbols = AstCache.extractExportedSymbols(content, ext);
                searcher.addDocument({ path: file, symbols, content: content.slice(0, 1000) });
              } catch {
                // ignore
              }
            }

            const results = searcher.search(query, topK);
            if (results.length === 0) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `No relevant files found matching intent query: "${query}"` }],
                },
              };
            }

            const text = results
              .map(
                (r, i) =>
                  `${i + 1}. \`${r.path}\` (Score: ${r.score.toFixed(2)}) — matched: [${r.matchedTerms.join(', ')}]`
              )
              .join('\n');

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `<!-- SMART CONTEXT PACKER: BM25 INTENT SEARCH -->\nTop ${results.length} matches for "${query}":\n\n${text}`,
                  },
                ],
              },
            };
          }

          if (toolName === 'generate_visualizer') {
            const rawTargets = Array.isArray(args.targets) ? args.targets.map(String) : [];
            const effectiveCwd = resolveEffectiveCwd(rawTargets, args.cwd as string | undefined);
            const customOut = args.outputPath ? String(args.outputPath) : undefined;

            const packResult = await packContext({
              cwd: effectiveCwd,
              targets: rawTargets,
              visualize: customOut || true,
              blastRadius: true,
              quiet: true,
            });

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `✔ Interactive Visualizer generated successfully!\nReport file: ${packResult.visualizerPath}`,
                  },
                ],
              },
            };
          }

          if (toolName === 'manage_task_context') {
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);
            const taskMgr = new TaskManager(effectiveCwd);
            const action = String(args.action || 'get');

            if (action === 'create') {
              const description = String(args.taskName || args.description || 'Untitled Task');
              const items = Array.isArray(args.items) ? args.items.map(String) : [];
              const task = taskMgr.createOrSetActiveTask(description, items);
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `✔ Active task created successfully!\nID: ${task.id}\nObjective: ${task.description}\nSteps: ${task.items.length}\nCreated at: ${task.createdAt}`,
                    },
                  ],
                },
              };
            }

            if (action === 'complete_item') {
              const target =
                args.itemIndex !== undefined
                  ? `step_${Number(args.itemIndex) + 1}`
                  : String(args.itemText || args.identifier || '');
              const ok = taskMgr.completeItem(target);
              if (!ok) {
                return {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text: 'No active task or valid item found to complete.' }],
                  },
                };
              }
              const active = taskMgr.getActiveTask();
              const remaining = active ? active.items.filter((i) => !i.completed).length : 0;
              const total = active ? active.items.length : 0;
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `✔ Task step marked completed in task "${active?.description || ''}".\nRemaining open steps: ${remaining}/${total}`,
                    },
                  ],
                },
              };
            }

            if (action === 'complete_task') {
              const taskId = args.taskId ? String(args.taskId) : undefined;
              const targetTask = taskId ? taskMgr.listTasks().find((t) => t.id === taskId) : taskMgr.getActiveTask();
              const desc = targetTask?.description || 'Active task';
              const ok = taskMgr.completeTask(taskId);
              if (!ok) {
                return {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text: 'No active task found to mark complete.' }],
                  },
                };
              }
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `✔ Task "${desc}" marked as completed!` }],
                },
              };
            }

            if (action === 'list') {
              const tasks = taskMgr.listTasks();
              if (tasks.length === 0) {
                return {
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [{ type: 'text', text: 'No tasks registered in this workspace yet.' }],
                  },
                };
              }
              const text = tasks
                .map((t) => {
                  const status = t.status === 'in_progress' ? '🔄 IN PROGRESS' : '✅ COMPLETED';
                  const doneCount = t.items.filter((i) => i.completed).length;
                  return `- [${t.id}] **${t.description}** (${status}) — ${doneCount}/${t.items.length} steps`;
                })
                .join('\n');
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `<!-- SMART CONTEXT PACKER: TASK LIST -->\n\n${text}` }],
                },
              };
            }

            // Default action: 'get'
            const active = taskMgr.getActiveTask();
            if (!active) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: 'No active task currently in progress.' }],
                },
              };
            }

            const directive = TaskManager.formatTaskDirective(active);
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: directive }],
              },
            };
          }

          if (toolName === 'get_framework_manifest') {
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);
            const resolver = new DependencyManifestResolver(effectiveCwd);
            const manifestMap = resolver.loadWorkspaceManifest();
            const entries = Array.from(manifestMap.values());

            if (entries.length === 0) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `No package manifest found or no dependencies detected in workspace: ${effectiveCwd}`,
                    },
                  ],
                },
              };
            }

            const text = entries
              .map((e) => `- **${e.name}**: \`${e.version}\` (${e.source})`)
              .join('\n');

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `<!-- SMART CONTEXT PACKER: ACTIVE FRAMEWORKS & DEPENDENCIES -->\n\nDetected ${entries.length} workspace dependencies:\n\n${text}`,
                  },
                ],
              },
            };
          }

          if (toolName === 'sandbox_tool_output') {
            const raw = String(args.rawOutput || '');
            const maxLines = typeof args.maxLines === 'number' ? args.maxLines : 100;
            const res = sandboxOutput(raw, maxLines);

            const header = `<!-- TOOL OUTPUT SANDBOX (Saved ${res.compressionRatio}% tokens: ${res.originalTokens} → ${res.sandboxedTokens}) -->\n\n`;
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: header + res.output,
                  },
                ],
              },
            };
          }

          if (toolName === 'extract_symbol_definition') {
            const filePath = String(args.filePath || '');
            const symbolName = String(args.symbolName || '').trim();
            const effectiveCwd = resolveEffectiveCwd([filePath], args.cwd as string | undefined);
            const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(effectiveCwd, filePath);
            const relPath = path.relative(effectiveCwd, fullPath).replace(/\\/g, '/');

            if (!fs.existsSync(fullPath)) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `Error: File not found: "${filePath}" in workspace ${effectiveCwd}`,
                    },
                  ],
                },
              };
            }

            const rawContent = fs.readFileSync(fullPath, 'utf-8');
            const ext = path.extname(fullPath);
            const res = extractSymbolFromCode(rawContent, symbolName, ext);

            if (!res.found || !res.codeSnippet) {
              const exported = AstCache.extractExportedSymbols(rawContent, ext);
              const hint = exported.length > 0 ? `\nAvailable exported symbols in this file: ${exported.join(', ')}` : '';
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `Symbol "${symbolName}" was not found in ${relPath}.${hint}`,
                    },
                  ],
                },
              };
            }

            // Check if this symbol is exported and locate workspace files that import this file
            const exported = AstCache.extractExportedSymbols(rawContent, ext);
            const isExported = exported.includes(symbolName);
            let callersSection = '';

            if (isExported) {
              try {
                const analyzer = new DependencyAnalyzer({
                  cwd: effectiveCwd,
                  reverse: true,
                  maxDepth: 1,
                });
                const graph = await analyzer.analyze([relPath]);
                const node = graph.nodes.get(relPath);
                const callers = node?.importedBy || [];
                if (callers.length > 0) {
                  callersSection = `\n\n**Referenced By (${callers.length} caller${callers.length > 1 ? 's' : ''}):**\n` +
                    callers.map((c) => `- \`${c}\``).join('\n');
                }
              } catch {
                // ignore reverse lookup errors
              }
            }

            const lang = ext.replace(/^\./, '') || 'ts';
            const header = `<!-- SURGICAL SYMBOL DEFINITION: ${symbolName} (${relPath}:${res.startLine}-${res.endLine}, ~${res.estimatedTokens} tokens) -->\n\n`;
            const formatted = `${header}\`\`\`${lang}\n// File: ${relPath}:${res.startLine}-${res.endLine}\n${res.codeSnippet}\n\`\`\`${callersSection}`;

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: formatted,
                  },
                ],
              },
            };
          }

          if (toolName === 'get_impacted_tests') {
            const rawTargets = Array.isArray(args.targets) ? (args.targets as string[]) : [];
            const stagedOnly = Boolean(args.stagedOnly);
            const effectiveCwd = resolveEffectiveCwd(rawTargets, args.cwd as string | undefined);

            let targets = rawTargets;
            if (targets.length === 0) {
              targets = getGitModifiedFiles(effectiveCwd, stagedOnly);
            }

            if (targets.length === 0) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `<!-- NO IMPACTED TESTS -->\nWorking tree is clean and no target files were specified for test impact analysis.`,
                    },
                  ],
                },
              };
            }

            const analyzer = new DependencyAnalyzer({
              cwd: effectiveCwd,
              reverse: true,
              depth: 3,
            });
            const graph = await analyzer.analyze(targets);
            const blast = await calculateBlastRadius(targets, graph, effectiveCwd);

            // Determine test runner
            let runner = 'npm test';
            if (fs.existsSync(path.join(effectiveCwd, 'package.json'))) {
              try {
                const pkg = JSON.parse(fs.readFileSync(path.join(effectiveCwd, 'package.json'), 'utf-8'));
                const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
                if (allDeps.vitest) {
                  runner = 'npx vitest run';
                } else if (allDeps.jest) {
                  runner = 'npx jest';
                }
              } catch {
                // ignore
              }
            } else if (fs.existsSync(path.join(effectiveCwd, 'pytest.ini')) || fs.existsSync(path.join(effectiveCwd, 'requirements.txt'))) {
              runner = 'pytest';
            } else if (fs.existsSync(path.join(effectiveCwd, 'go.mod'))) {
              runner = 'go test';
            } else if (fs.existsSync(path.join(effectiveCwd, 'Cargo.toml'))) {
              runner = 'cargo test';
            }

            const impactedTests = blast.impactedTests;
            const suggestedCmd = impactedTests.length > 0
              ? `${runner} ${impactedTests.join(' ')}`
              : `${runner}`;

            const lines = [
              `<!-- TEST BLAST RADIUS: ${blast.riskLevel} (${blast.riskScore}/10) -->`,
              '',
              `### 🧪 Impacted Tests Analysis`,
              `- **Targets Analyzed**: ${targets.map((t) => `\`${t}\``).join(', ')}`,
              `- **Risk Level**: \`${blast.riskLevel}\` (Score: ${blast.riskScore}/10)`,
              `- **Impacted Callers**: ${blast.callers.length}`,
              `- **Impacted Test Suites (${impactedTests.length})**:`,
            ];

            if (impactedTests.length > 0) {
              for (const test of impactedTests) {
                lines.push(`  • \`${test}\``);
              }
              lines.push('');
              lines.push(`**Suggested Verification Command:**`);
              lines.push('```bash');
              lines.push(suggestedCmd);
              lines.push('```');
            } else {
              lines.push('  *(No unit tests directly or transitively cover these target files)*');
              if (blast.untestedTargets.length > 0) {
                lines.push('');
                lines.push(`⚠️ **Untested Targets**: ${blast.untestedTargets.map((u) => `\`${u}\``).join(', ')}`);
                lines.push('Consider adding unit tests to prevent regressions in these modules.');
              }
            }

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: lines.join('\n'),
                  },
                ],
              },
            };
          }

          if (toolName === 'audit_context_leak') {
            let content = String(args.content || args.contextText || '');
            if (!content && args.filePath) {
              const effectiveCwd = resolveEffectiveCwd([String(args.filePath)], args.cwd as string | undefined);
              const fullPath = path.isAbsolute(String(args.filePath))
                ? String(args.filePath)
                : path.resolve(effectiveCwd, String(args.filePath));
              if (fs.existsSync(fullPath)) {
                content = fs.readFileSync(fullPath, 'utf-8');
              }
            }
            const audit = auditContextContent(content);

            const lines = [
              `<!-- CONTEXT LEAK & DENSITY AUDIT -->`,
              '',
              `### 🛡️ Context Safety & Token Density Audit`,
              `- **Safety Status**: ${audit.safe ? '✅ SAFE' : '⚠️ ATTENTION REQUIRED'}`,
              `- **Potential Leaks Detected**: ${audit.leaksFound}`,
              `- **Total Lines**: ${audit.lineCount}`,
              `- **Estimated Tokens**: ${audit.totalTokens} tokens`,
              `- **Oversized Block (>400 lines / >8k tokens)**: ${audit.oversizedWarning ? '⚠️ YES' : 'No'}`,
              '',
            ];

            if (audit.details.length > 0) {
              lines.push('#### 🚨 Detected Secret / Token Leaks:');
              for (const d of audit.details) {
                lines.push(`- **Line ${d.line || '?'}**: \`${d.type}\` - ${d.description} (Sample: \`${d.sample || '***'}\`)`);
              }
              lines.push('');
            }

            lines.push('#### 💡 Recommendations:');
            for (const r of audit.recommendations) {
              lines.push(`- ${r}`);
            }

            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: lines.join('\n'),
                  },
                ],
              },
            };
          }

          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Tool not found: ${toolName}`,
            },
          };
        }

        default: {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          };
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: `Internal error: ${msg}`,
        },
      };
    }
  }

  /**
   * Starts reading JSON-RPC requests from standard input.
   */
  public start(): void {
    const rl = readline.createInterface({
      input: this.stdin,
      terminal: false,
    });

    let buffer = '';

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Handle Content-Length framing if present
      if (trimmed.startsWith('Content-Length:')) {
        return; // Wait for following empty line / content
      }

      buffer += trimmed;

      try {
        const parsed = JSON.parse(buffer) as JsonRpcRequest;
        buffer = '';
        const response = await this.handleMessage(parsed);
        if (response) {
          this.sendResponse(response);
        }
      } catch {
        // Line might be incomplete chunk; keep in buffer until valid JSON
      }
    });

    this.stdin.on('data', async (chunk: Buffer) => {
      const str = chunk.toString('utf-8');
      if (str.includes('Content-Length:')) {
        const parts = str.split(/\r?\n\r?\n/);
        if (parts.length > 1 && parts[1]) {
          try {
            const parsed = JSON.parse(parts[1].trim()) as JsonRpcRequest;
            const response = await this.handleMessage(parsed);
            if (response) {
              this.sendResponse(response);
            }
          } catch {
            // Buffer handled by readline
          }
        }
      }
    });
  }

  private sendResponse(response: JsonRpcResponse): void {
    const json = JSON.stringify(response);
    this.stdout.write(json + '\n');
  }
}

/**
 * Starts the stdio MCP server process.
 */
export function startMcpServer(): void {
  // Ensure no console.log pollution on stdout
  const server = new McpServer(process.stdin, process.stdout);
  server.start();
}
