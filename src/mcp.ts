import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { packContext } from './index.js';
import { getGitModifiedFiles } from './git.js';
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
import { DependencyAnalyzer } from './analyzer.js';
import { TaskManager } from './task.js';
import { DependencyManifestResolver } from './dependencies.js';
import { sandboxOutput } from './sandbox.js';

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
        depth: {
          type: 'number',
          description: 'Dependency traversal depth (default: 2, 0 for target modified files only)',
        },
        skeleton: {
          type: 'boolean',
          description: 'Strip function/class bodies of dependencies to save tokens',
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
                version: '2.2.0',
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

            const files = await fg(
              ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,py,go,rs,java,c,cpp,cs,php,rb,swift,kt,sql,prisma}'],
              {
                cwd: effectiveCwd,
                ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/.scp/**', '**/build/**'],
                dot: false,
              }
            );

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
            const depth = typeof args.depth === 'number' ? args.depth : 2;
            const skeleton = Boolean(args.skeleton);
            const maxTokens = typeof args.maxTokens === 'number' ? args.maxTokens : undefined;
            const blastRadius = Boolean(args.blastRadius);
            const noCache = Boolean(args.noCache);
            const includeMemory = args.includeMemory !== undefined ? Boolean(args.includeMemory) : true;
            const format: OutputFormat = args.format === 'xml' ? 'xml' : 'md';
            const effectiveCwd = resolveEffectiveCwd([], args.cwd as string | undefined);

            const modifiedFiles = getGitModifiedFiles(effectiveCwd, stagedOnly);
            if (modifiedFiles.length === 0) {
              return {
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: `<!-- SMART CONTEXT PACKER: AI DIRECTIVE -->\n\nNo ${
                        stagedOnly ? 'staged' : 'uncommitted modified or untracked'
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
              maxTokens,
              blastRadius,
              noCache,
              includeMemory,
              diff: !stagedOnly,
              staged: stagedOnly,
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
              const discovered = fg.sync(['**/*.{ts,tsx,js,jsx,vue,go,rs,py,lua}'], {
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

            const candidateFiles = fg.sync(['**/*.{ts,tsx,js,jsx,vue,go,rs,py,lua}'], {
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
