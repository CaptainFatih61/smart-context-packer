import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { packContext } from './index.js';
import { renderTerminalSummary } from './tokens.js';
import { startMcpServer } from './mcp.js';
import { initVsCodeTasks } from './ide.js';
import { initAgentRules } from './agent-rules.js';
import { AstCache } from './cache.js';
import { ProjectMemoryManager } from './memory.js';
import type { OutputFormat } from './types.js';

const program = new Command();

program
  .name('scp')
  .description(
    '📦 smart-context-packer: AI-optimized dependency graph context packer for LLM coding assistants'
  )
  .version('2.0.0', '-v, --version', 'Output current version')
  .argument('[targets...]', 'Target entry file(s) or directories to analyze and pack')
  .option('-d, --depth <number>', 'Dependency traversal depth (default: 2)', '2')
  .option('-r, --reverse', 'Include reverse dependencies (files importing target)', false)
  .option('-s, --skeleton', 'Strip function/class bodies of dependencies to type signatures', false)
  .option('-m, --max-tokens <number>', 'Auto-skeletonize dependencies to fit token budget')
  .option('-b, --blast-radius', 'Perform blast-radius impact analysis and risk scoring', false)
  .option('-f, --format <format>', 'Output format: md (Markdown) or xml (XML)', 'md')
  .option('-o, --output <file>', 'Output file path (default: .context-pack.md)', '.context-pack.md')
  .option('-c, --copy', 'Copy packed prompt directly to system clipboard', false)
  .option('--diff', 'Automatically discover uncommitted modified & untracked Git files and attach diff patch', false)
  .option('--staged', 'Automatically discover staged Git files and attach staged diff patch', false)
  .option('--no-cache', 'Disable SHA-256 AST caching')
  .option('--clear-cache', 'Clear local .scp/cache.json AST cache', false)
  .option('--add-memory <pattern:note>', 'Store persistent project memory note linked to file pattern')
  .option('--list-memory', 'List all persistent project memories stored in .scp/memory.json', false)
  .option('--mcp', 'Launch Model Context Protocol (MCP) JSON-RPC 2.0 stdio server', false)
  .option('--init-agent', 'Generate .agent/rules/smart-context-packer.md and .cursorrules for AI coding assistants', false)
  .option('--init-vscode', 'Initialize or update .vscode/tasks.json with SCP Command Palette tasks', false)
  .option('--stdout', 'Print packed context prompt directly to standard output', false)
  .option('--tree-only', 'Generate only hierarchy tree and dependency map without file bodies', false)
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

      // 3. Handle Memory operations
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

      // 4. Handle Agent Rules initialization
      if (options.initAgent) {
        const result = initAgentRules(process.cwd());
        console.log('');
        console.log(pc.green('✔ ') + pc.bold(pc.white('Agent Rules Initialized Successfully!')));
        console.log(pc.gray(`  Agent Rules:  `) + pc.cyan(result.agentRulesPath));
        console.log(pc.gray(`  Status:       `) + pc.yellow(result.agentRulesCreated ? 'Created new file' : 'Updated existing file'));
        console.log(pc.gray(`  Cursor Rules: `) + pc.cyan(result.cursorRulesPath));
        console.log(pc.gray(`  Status:       `) + pc.yellow(result.cursorRulesCreated ? 'Created new file' : 'Updated existing file'));
        console.log('');
        console.log(pc.white('AI coding assistants will now autonomously call ') + pc.cyan(pc.bold('smart-context-packer')) + pc.white(' MCP tools!'));
        console.log('');
        return;
      }

      // 5. Handle VS Code tasks generation
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

      // 6. Validate targets when not in diff/staged mode
      const hasExplicitTargets = Array.isArray(targets) && targets.length > 0;
      if (!hasExplicitTargets && !options.diff && !options.staged) {
        console.error(pc.red('Error: Please specify target file(s) or use --diff / --staged to pack modified Git files.'));
        console.error(pc.gray('Run "scp --help" for available options.'));
        process.exit(1);
      }

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

      const format: OutputFormat = options.format.toLowerCase() === 'xml' ? 'xml' : 'md';
      const shouldSaveFile = !options.stdout;
      const outputFile = shouldSaveFile ? options.output : undefined;
      const noCache = options.cache === false || options.noCache === true;

      const result = await packContext({
        targets,
        depth: parsedDepth,
        reverse: options.reverse,
        skeleton: options.skeleton,
        maxTokens: parsedMaxTokens,
        blastRadius: options.blastRadius,
        noCache,
        diff: options.diff,
        staged: options.staged,
        format,
        output: outputFile,
        copy: options.copy,
        redact: options.redact,
        treeOnly: options.treeOnly,
        quiet: options.quiet,
      });

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
          })
        );
        console.log('');
        if (outputFile) {
          console.log(
            pc.green('✔') +
              pc.white(' Prompt saved to ') +
              pc.cyan(pc.bold(path.resolve(process.cwd(), outputFile)))
          );
        }
        if (result.copiedToClipboard) {
          console.log(
            pc.green('✔') +
              pc.white(' Copied to clipboard! Ready to paste into ChatGPT, Claude, Cursor, or Gemini.')
          );
        }
        console.log('');
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('');
      console.error(pc.red(pc.bold('✖ Packing Failed:')) + ' ' + pc.white(msg));
      console.error('');
      process.exit(1);
    }
  });

program.parse(process.argv);
