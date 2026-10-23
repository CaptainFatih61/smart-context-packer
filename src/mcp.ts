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

export const MCP_TOOLS = [
  {
    name: 'pack_context',
    description:
      'Analyze local dependency graph and package entry files and dependencies into an AI-directive prompt (Markdown/XML)',
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
        includeDiff: {
          type: 'boolean',
          description: 'Include uncommitted Git working tree diff',
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
    name: 'inspect_dependency_graph',
    description:
      'Inspect visual directory tree and dependency relationships without file contents',
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
                version: '1.3.0',
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

          if (toolName === 'pack_context') {
            const targets = (args.targets as string[]) || [];
            const depth = typeof args.depth === 'number' ? args.depth : 2;
            const skeleton = Boolean(args.skeleton);
            const maxTokens = typeof args.maxTokens === 'number' ? args.maxTokens : undefined;
            const includeDiff = Boolean(args.includeDiff);
            const format: OutputFormat = args.format === 'xml' ? 'xml' : 'md';
            const effectiveCwd = resolveEffectiveCwd(targets, args.cwd as string | undefined);

            const packResult = await packContext({
              cwd: effectiveCwd,
              targets,
              depth,
              skeleton,
              maxTokens,
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
            const effectiveCwd = resolveEffectiveCwd(targets, args.cwd as string | undefined);

            const packResult = await packContext({
              cwd: effectiveCwd,
              targets,
              reverse,
              treeOnly: true,
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
