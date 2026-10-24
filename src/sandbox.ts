import { execSync } from 'node:child_process';
import { estimateTokensForText } from './tokens.js';

export interface SandboxResult {
  command?: string;
  originalLines: number;
  sandboxedLines: number;
  originalTokens: number;
  sandboxedTokens: number;
  tokensSaved: number;
  compressionRatio: number;
  output: string;
}

/**
 * Sandboxes and compresses tool, test, and build outputs to preserve AI context windows.
 */
export function sandboxOutput(rawOutput: string, maxLines = 60): SandboxResult {
  if (!rawOutput) {
    return {
      originalLines: 0,
      sandboxedLines: 0,
      originalTokens: 0,
      sandboxedTokens: 0,
      tokensSaved: 0,
      compressionRatio: 0,
      output: '',
    };
  }

  const lines = rawOutput.split(/\r?\n/);
  const origTokens = estimateTokensForText(rawOutput);

  // If already compact, keep as-is
  if (lines.length <= maxLines) {
    return {
      originalLines: lines.length,
      sandboxedLines: lines.length,
      originalTokens: origTokens,
      sandboxedTokens: origTokens,
      tokensSaved: 0,
      compressionRatio: 0,
      output: rawOutput,
    };
  }

  const isTestOutput =
    rawOutput.includes('FAIL') ||
    rawOutput.includes('AssertionError') ||
    rawOutput.includes('Tests:') ||
    rawOutput.includes('passed') ||
    rawOutput.includes('failed');

  let filteredLines: string[] = [];

  if (isTestOutput) {
    // Preserve failure blocks and summaries, filter out passing test lines
    let inFailureBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (
        trimmed.startsWith('FAIL') ||
        trimmed.startsWith('×') ||
        trimmed.startsWith('AssertionError') ||
        trimmed.includes('Error:')
      ) {
        inFailureBlock = true;
      }

      if (
        trimmed.startsWith('Test Files') ||
        trimmed.startsWith('Tests:') ||
        trimmed.startsWith('Ran all test suites') ||
        trimmed.startsWith('PASS') ||
        trimmed.startsWith('✓')
      ) {
        inFailureBlock = false;
      }

      // Always keep failure blocks and summary lines
      if (
        inFailureBlock ||
        trimmed.startsWith('FAIL') ||
        trimmed.startsWith('×') ||
        trimmed.startsWith('Test Files') ||
        trimmed.startsWith('Tests:') ||
        trimmed.includes('Duration') ||
        i < 5 // keep top 5 lines for context
      ) {
        filteredLines.push(line);
      }
    }
  } else {
    // General verbose output: head + middle omission + tail
    const headCount = Math.floor(maxLines * 0.4);
    const tailCount = Math.floor(maxLines * 0.6);
    const omittedCount = lines.length - headCount - tailCount;

    if (omittedCount > 0) {
      filteredLines = [
        ...lines.slice(0, headCount),
        `\n... [smart-context-packer sandbox: ${omittedCount} repetitive lines omitted for token efficiency] ...\n`,
        ...lines.slice(lines.length - tailCount),
      ];
    } else {
      filteredLines = lines;
    }
  }

  const resultText = filteredLines.join('\n').trim();
  const sandboxedTokens = estimateTokensForText(resultText);
  const tokensSaved = Math.max(0, origTokens - sandboxedTokens);
  const ratio = origTokens > 0 ? (tokensSaved / origTokens) * 100 : 0;

  return {
    originalLines: lines.length,
    sandboxedLines: filteredLines.length,
    originalTokens: origTokens,
    sandboxedTokens,
    tokensSaved,
    compressionRatio: Number(ratio.toFixed(1)),
    output: resultText,
  };
}

/**
 * Executes a shell command and returns sandboxed compressed output.
 */
export function runSandboxedCommand(command: string, cwd = process.cwd()): SandboxResult {
  let raw = '';
  try {
    raw = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const errorObj = err as { stdout?: string; stderr?: string; message?: string };
    raw = (errorObj.stdout || '') + '\n' + (errorObj.stderr || errorObj.message || '');
  }

  const res = sandboxOutput(raw);
  res.command = command;
  return res;
}
