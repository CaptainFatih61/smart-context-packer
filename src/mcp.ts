import readline from 'node:readline';
import { packContext } from './index.js';
import type { OutputFormat } from './types.js';

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
        includeDiff: {
          type: 'boolean',
          description: 'Include uncommitted Git working tree diff',
        },
        format: {
          type: 'string',
          enum: ['md', 'xml'],
          description: 'Output prompt format: md (Markdown) or xml',
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
      },
      required: ['targets'],
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
                version: '1.2.0',
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
            const includeDiff = Boolean(args.includeDiff);
            const format: OutputFormat = args.format === 'xml' ? 'xml' : 'md';

            const packResult = await packContext({
              targets,
              depth,
              skeleton,
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

            const packResult = await packContext({
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
