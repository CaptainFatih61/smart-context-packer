import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { packContext } from './index.js';
import { renderTerminalSummary } from './tokens.js';
import type { OutputFormat } from './types.js';

const program = new Command();

program
  .name('scp')
  .description(
    '📦 smart-context-packer: AI-optimized dependency graph context packer for LLM coding assistants'
  )
  .version('1.0.0', '-v, --version', 'Output current version')
  .argument('<targets...>', 'Target entry file(s) or directories to analyze and pack')
  .option('-d, --depth <number>', 'Dependency traversal depth (default: 2)', '2')
  .option('-r, --reverse', 'Include reverse dependencies (files importing target)', false)
  .option('-s, --skeleton', 'Strip function/class bodies of dependencies to type signatures', false)
  .option('-f, --format <format>', 'Output format: md (Markdown) or xml (XML)', 'md')
  .option('-o, --output <file>', 'Output file path (default: .context-pack.md)', '.context-pack.md')
  .option('-c, --copy', 'Copy packed prompt directly to system clipboard', false)
  .option('--stdout', 'Print packed context prompt directly to standard output', false)
  .option('--tree-only', 'Generate only hierarchy tree and dependency map without file bodies', false)
  .option('--no-redact', 'Disable automatic secret and token redaction')
  .option('-q, --quiet', 'Suppress terminal summary report and banners', false)
  .action(async (targets: string[], options) => {
    try {
      const parsedDepth = parseInt(options.depth, 10);
      if (isNaN(parsedDepth) || parsedDepth < 0) {
        console.error(pc.red(`Error: Invalid depth value "${options.depth}". Must be a non-negative integer.`));
        process.exit(1);
      }

      const format: OutputFormat = options.format.toLowerCase() === 'xml' ? 'xml' : 'md';
      const shouldSaveFile = !options.stdout;
      const outputFile = shouldSaveFile ? options.output : undefined;

      const result = await packContext({
        targets,
        depth: parsedDepth,
        reverse: options.reverse,
        skeleton: options.skeleton,
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
