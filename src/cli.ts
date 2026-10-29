import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { packContext } from './index.js';
import { renderTerminalSummary } from './tokens.js';
import { startMcpServer } from './mcp.js';
import { initVsCodeTasks } from './ide.js';
import { initAgentRules, type AgentPreset } from './agent-rules.js';
import { AstCache } from './cache.js';
import { ProjectMemoryManager } from './memory.js';
import { TaskManager } from './task.js';
import { runSandboxedCommand } from './sandbox.js';
import type { OutputFormat } from './types.js';

const program = new Command();

program
  .name('scp')
  .description(
    '📦 smart-context-packer: AI-optimized dependency graph context packer for LLM coding assistants'
  )
  .version('2.3.0', '-v, --version', 'Output current version')
  .argument('[targets...]', 'Target entry file(s) or directories to analyze and pack')
  .option('-d, --depth <number>', 'Dependency traversal depth (default: 2)', '2')
  .option('-r, --reverse', 'Include reverse dependencies (files importing target)', false)
  .option('-s, --skeleton', 'Strip function/class bodies of dependencies to type signatures', false)
  .option('--tree-shake', 'Prune unreferenced exported symbols from dependencies (AST Dead-Code Slicing)', false)
  .option('-m, --max-tokens <number>', 'Auto-skeletonize dependencies to fit token budget')
  .option('-b, --blast-radius', 'Perform blast-radius impact analysis and risk scoring', false)
  .option('-i, --query <intent>', 'Semantic intent or keyword query to discover target files (BM25)')
  .option('-t, --task <description>', 'Active task description to inject plan checklist and auto-route seed files')
  .option('--task-list', 'List recorded tasks in .scp/tasks.json', false)
  .option('--task-done <id>', 'Mark task or checklist item completed in .scp/tasks.json')
  .option('--repo-map [tokens]', 'Generate architectural PageRank repo-map of key hubs')
  .option('--visualize [path]', 'Generate interactive HTML canvas visualizer report')
  .option('-f, --format <format>', 'Output format: md (Markdown) or xml (XML)', 'md')
  .option('-o, --output <file>', 'Output file path (default: .context-pack.md)', '.context-pack.md')
  .option('-c, --copy', 'Copy packed prompt directly to system clipboard', false)
  .option('--diff', 'Automatically discover uncommitted modified & untracked Git files and attach diff patch', false)
  .option('--staged', 'Automatically discover staged Git files and attach staged diff patch', false)
  .option('--commit <ref>', 'Pack files modified in a specific Git commit, branch, or range (e.g. HEAD~2..HEAD)')
  .option('--pr <target>', 'Pack files modified in a Pull Request number, URL, or branch')
  .option('-w, --watch', 'Watch packed files and dependencies for changes and live-reload context pack', false)
  .option('--no-cache', 'Disable SHA-256 AST caching')
  .option('--clear-cache', 'Clear local .scp/cache.json AST cache', false)
  .option('--add-memory <pattern:note>', 'Store persistent project memory note linked to file pattern')
  .option('--list-memory', 'List all persistent project memories stored in .scp/memory.json', false)
  .option('--mcp', 'Launch Model Context Protocol (MCP) JSON-RPC 2.0 stdio server', false)
  .option(
    '--init-agent [preset]',
    'Generate AI coding rules (all, cursor, claude, copilot, windsurf, opencode, codex, continue, zed, clinerules, aider, jetbrains)',
    false
  )
  .option('--init-vscode', 'Initialize or update .vscode/tasks.json with SCP Command Palette tasks', false)
  .option('--sandbox <command>', 'Execute shell command and compress verbose output for AI context windows')
  .option('--stdout', 'Print packed context prompt directly to standard output', false)
  .option('--tree-only', 'Generate only hierarchy tree and dependency map without file bodies', false)
  .option('--no-deps', 'Disable automatic framework and dependency version manifest')
  .option('--no-redact', 'Disable automatic secret and token redaction')
  .option('-q, --quiet', 'Suppress terminal summary report and banners', false)
  .action(async (targets: string[], options) => {
    try {
      // 1. Handle MCP Server mode
      if (options.mcp) {
        startMcpServer();
        return;
      }

      // 2. Handle AST Cache clearing
      if (options.clearCache) {
        const cache = new AstCache(process.cwd());
        cache.clear();
        console.log('');
        console.log(pc.green('✔ ') + pc.bold(pc.white('AST Cache cleared successfully! (.scp/cache.json)')));
        console.log('');
        return;
      }

      // 3. Handle Sandbox command execution
      if (options.sandbox) {
        const cmd = String(options.sandbox);
        const result = runSandboxedCommand(cmd, process.cwd());
        if (options.stdout) {
          process.stdout.write(result.output + '\n');
        } else {
          console.log('');
          console.log(pc.cyan(pc.bold(`🛡️ Sandboxed Output: ${cmd}`)));
          console.log(
            pc.gray(
              `Lines: ${result.sandboxedLines}/${result.originalLines} | Tokens Saved: ${result.tokensSaved} (${result.compressionRatio}% reduction)`
            )
          );
          console.log(pc.gray('─'.repeat(60)));
          console.log(result.output);
          console.log(pc.gray('─'.repeat(60)));
        }
        return;
      }

      // 4. Handle Task list & completion operations
      if (options.taskList) {
        const taskMgr = new TaskManager(process.cwd());
        const tasks = taskMgr.listTasks();
        if (tasks.length === 0) {
          console.log('');
          console.log(pc.yellow('ℹ No active tasks found in .scp/tasks.json.'));
          console.log(pc.gray('  Start a task using: scp --task "Implement user authentication"'));
          console.log('');
          return;
        }
        console.log('');
        console.log(pc.cyan(pc.bold('🎯 Recorded Tasks (.scp/tasks.json):')));
        console.log('');
        for (const t of tasks) {
          const statusColor = t.status === 'completed' ? pc.green : pc.yellow;
          console.log(`  • [${pc.cyan(t.id)}] ${statusColor(t.status.toUpperCase())}: ${pc.white(t.description)}`);
          for (const item of t.items) {
            const mark = item.completed ? pc.green('✔') : pc.gray('○');
            console.log(`      ${mark} [${pc.gray(item.id)}] ${item.text}`);
          }
        }
        console.log('');
        return;
      }

      if (options.taskDone) {
        const id = String(options.taskDone);
        const taskMgr = new TaskManager(process.cwd());
        const itemDone = taskMgr.completeItem(id);
        if (!itemDone) {
          taskMgr.completeTask(id);
        }
        console.log('');
        console.log(pc.green('✔ ') + pc.bold(pc.white(`Task/Item [${id}] marked as completed!`)));
        console.log('');
        return;
      }

      // 5. Handle Memory operations
      if (options.listMemory) {
        const memoryManager = new ProjectMemoryManager(process.cwd());
        const memories = memoryManager.load();
        if (memories.length === 0) {
          console.log('');
          console.log(pc.yellow('ℹ No persistent project memories found in .scp/memory.json.'));
          console.log(pc.gray('  Add one using: scp --add-memory "src/auth/**:Always validate JWT expiration"'));
          console.log('');
          return;
        }
        console.log('');
        console.log(pc.cyan(pc.bold('🧠 Persistent Project Memories (.scp/memory.json):')));
        console.log('');
        for (const m of memories) {
          console.log(
            `  • [${pc.cyan(m.id)}] ${pc.magenta(m.category.toUpperCase())} (${pc.yellow(m.pattern)}): ${pc.white(
              m.content
            )}`
          );
        }
        console.log('');
        return;
      }

      if (options.addMemory) {
        const memArg = String(options.addMemory);
        const firstColon = memArg.indexOf(':');
        if (firstColon === -1) {
          console.error(
            pc.red('Error: --add-memory requires "pattern:note" format (e.g. "src/mcp.ts:Never use console.log")')
          );
          process.exit(1);
        }
        const pattern = memArg.slice(0, firstColon).trim();
        const content = memArg.slice(firstColon + 1).trim();
        const memoryManager = new ProjectMemoryManager(process.cwd());
        const entry = memoryManager.add({ pattern, content, category: 'architecture' });
        console.log('');
        console.log(
          pc.green('✔ ') + pc.bold(pc.white(`Project memory saved [${entry.id}] linked to "${pattern}"`))
        );
        console.log('');
        return;
      }

      // 6. Handle Agent Rules initialization
      if (options.initAgent !== false && options.initAgent !== undefined) {
        const preset: AgentPreset = typeof options.initAgent === 'string' ? (options.initAgent as AgentPreset) : 'all';
        const result = initAgentRules(process.cwd(), preset);
        console.log('');
        console.log(pc.green('✔ ') + pc.bold(pc.white(`Universal Agent Rules Initialized! (Preset: ${preset})`)));
        for (const file of result.created) {
          console.log(pc.gray('  Created: ') + pc.cyan(file));
        }
        for (const file of result.updated) {
          console.log(pc.gray('  Updated: ') + pc.yellow(file));
        }
        console.log('');
        console.log(pc.white('AI coding assistants will now autonomously call ') + pc.cyan(pc.bold('smart-context-packer')) + pc.white(' MCP tools!'));
        console.log('');
        return;
      }

      // 7. Handle VS Code tasks generation
      if (options.initVscode) {
        const result = initVsCodeTasks(process.cwd());
        console.log('');
        console.log(pc.green('✔ ') + pc.bold(pc.white('VS Code Tasks Configured Successfully!')));
        console.log(pc.gray(`  Location: `) + pc.cyan(result.tasksPath));
        console.log(pc.gray(`  Status:   `) + pc.yellow(result.created ? 'Created new file' : 'Updated existing file'));
        console.log('');
        console.log(pc.white('Ready to use! Open Command Palette in VS Code with ') + pc.cyan(pc.bold('Ctrl+Shift+P')) + pc.white(' -> ') + pc.cyan(pc.bold('Tasks: Run Task')) + ':');
        console.log(pc.gray('  • SCP: Pack Active File + Dependencies (Copy to Clipboard)'));
        console.log(pc.gray('  • SCP: Pack Active File (Skeleton Mode -> Clipboard)'));
        console.log(pc.gray('  • SCP: Pack Git Diff + Dependencies (Copy to Clipboard)'));
        console.log('');
        return;
      }

      // 8. Execute Context Packing
      const parsedDepth = parseInt(options.depth, 10);
      if (isNaN(parsedDepth) || parsedDepth < 0) {
        console.error(pc.red(`Error: Invalid depth value "${options.depth}". Must be a non-negative integer.`));
        process.exit(1);
      }

      let parsedMaxTokens: number | undefined;
      if (options.maxTokens !== undefined) {
        parsedMaxTokens = parseInt(options.maxTokens, 10);
        if (isNaN(parsedMaxTokens) || parsedMaxTokens <= 0) {
          console.error(pc.red(`Error: Invalid max-tokens value "${options.maxTokens}". Must be a positive integer.`));
          process.exit(1);
        }
      }

      let repoMapOpt: boolean | number | undefined;
      if (options.repoMap !== undefined && options.repoMap !== false) {
        if (typeof options.repoMap === 'string') {
          const num = parseInt(options.repoMap, 10);
          repoMapOpt = isNaN(num) ? true : num;
        } else {
          repoMapOpt = true;
        }
      }

      let visualizeOpt: boolean | string | undefined;
      if (options.visualize !== undefined && options.visualize !== false) {
        visualizeOpt = typeof options.visualize === 'string' ? options.visualize : true;
      }

      const format: OutputFormat = options.format.toLowerCase() === 'xml' ? 'xml' : 'md';
      const shouldSaveFile = !options.stdout;
      const outputFile = shouldSaveFile ? options.output : undefined;
      const noCache = options.cache === false || options.noCache === true;

      const runPack = async () =>
        packContext({
          targets,
          depth: parsedDepth,
          reverse: options.reverse,
          skeleton: options.skeleton,
          treeShake: options.treeShake,
          maxTokens: parsedMaxTokens,
          blastRadius: options.blastRadius,
          query: options.query,
          task: options.task,
          includeDeps: options.deps !== false,
          repoMap: repoMapOpt,
          visualize: visualizeOpt,
          noCache,
          diff: options.diff,
          staged: options.staged,
          commit: options.commit,
          pr: options.pr,
          format,
          output: outputFile,
          copy: options.copy,
          redact: options.redact,
          treeOnly: options.treeOnly,
          quiet: options.quiet,
        });

      const result = await runPack();

      if (options.stdout) {
        process.stdout.write(result.formattedPrompt);
        return;
      }

      if (!options.quiet) {
        console.log('');
        console.log(
          renderTerminalSummary(result.graph, result.stats, {
            file: outputFile,
            clipboard: result.copiedToClipboard,
            maxTokens: parsedMaxTokens,
          })
        );
        console.log('');
        if (outputFile) {
          console.log(pc.green('✔ ') + pc.bold(pc.white(`Prompt saved to ${path.resolve(outputFile)}`)));
        }
        if (result.copiedToClipboard) {
          console.log(pc.green('✔ ') + pc.bold(pc.white('Copied to clipboard! Ready to paste into ChatGPT, Claude, Cursor, or Gemini.')));
        }
        if (result.visualizerPath) {
          console.log(pc.green('✔ ') + pc.bold(pc.cyan(`Interactive Visualizer generated at ${result.visualizerPath}`)));
        }
        console.log('');
      }

      // 9. Handle live Watch Mode (-w, --watch)
      if (options.watch) {
        console.log(pc.cyan('👀 Watch mode active: monitoring dependency graph for changes... (Press Ctrl+C to stop)'));
        let debounceTimer: NodeJS.Timeout | null = null;
        const watchers: fs.FSWatcher[] = [];

        const setupWatchers = (files: string[]) => {
          while (watchers.length > 0) {
            try {
              watchers.pop()?.close();
            } catch {
              // ignore
            }
          }
          for (const relFile of files) {
            const abs = path.resolve(process.cwd(), relFile);
            if (fs.existsSync(abs)) {
              try {
                const w = fs.watch(abs, () => {
                  if (debounceTimer) clearTimeout(debounceTimer);
                  debounceTimer = setTimeout(async () => {
                    try {
                      const updated = await runPack();
                      const timeStr = new Date().toLocaleTimeString();
                      console.log(
                        pc.green(`↻ [${timeStr}]`) +
                          pc.white(` Re-packed ${updated.graph.nodes.size} files (~${updated.stats.totalTokens.toLocaleString()} tokens)`)
                      );
                      setupWatchers(Array.from(updated.graph.nodes.keys()));
                    } catch (e) {
                      console.error(pc.red(`Watch reload error: ${e instanceof Error ? e.message : String(e)}`));
                    }
                  }, 150);
                });
                watchers.push(w);
              } catch {
                // ignore individual file watch error
              }
            }
          }
        };

        setupWatchers(Array.from(result.graph.nodes.keys()));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('');
      console.error(pc.red(`Error: ${msg}`));
      console.error('');
      process.exit(1);
    }
  });

export { program };

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  program.parse();
}
