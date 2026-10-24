import fs from 'node:fs';
import path from 'node:path';
import clipboardy from 'clipboardy';
import type { PackOptions, PackResult } from './types.js';
import { DependencyAnalyzer } from './analyzer.js';
import { aggregateTokenStats } from './tokens.js';
import { ContextFormatter } from './formatter.js';
import { getGitModifiedFiles, getGitDiffPatch } from './git.js';
import { calculateBlastRadius } from './blast-radius.js';
import { ProjectMemoryManager } from './memory.js';
import { AstCache } from './cache.js';
import { BM25CodeSearch } from './query.js';
import { generateRepoMap } from './repo-map.js';
import { writeVisualizerReport } from './visualizer.js';
import { TaskManager, type TaskRecord } from './task.js';
import { DependencyManifestResolver } from './dependencies.js';
import fg from 'fast-glob';

export * from './types.js';
export * from './analyzer.js';
export * from './filter.js';
export * from './formatter.js';
export * from './tokens.js';
export * from './git.js';
export * from './prisma.js';
export * from './mcp.js';
export * from './ide.js';
export * from './agent-rules.js';
export * from './cache.js';
export * from './blast-radius.js';
export * from './memory.js';
export type { RedactedFinding, RedactResult } from './redactor.js';
export * from './query.js';
export { calculatePageRank, generateRepoMap } from './repo-map.js';
export * from './visualizer.js';
export * from './task.js';
export * from './dependencies.js';
export * from './hud.js';
export * from './sandbox.js';

/**
 * Main programmatic API to pack dependencies and generate AI context prompts.
 */
export async function packContext(options: PackOptions): Promise<PackResult> {
  const cwd = path.resolve(options.cwd || process.cwd());

  let targets = options.targets ? [...options.targets] : [];
  let gitDiffPatch = options.gitDiffPatch;

  // 1. Resolve active task / plan if specified
  let activeTaskRecord: TaskRecord | null = null;
  let taskDirective: string | undefined;
  if (options.task) {
    const taskMgr = new TaskManager(cwd);
    if (typeof options.task === 'string') {
      activeTaskRecord = taskMgr.createOrSetActiveTask(options.task);
    } else {
      activeTaskRecord = taskMgr.getActiveTask();
    }

    if (activeTaskRecord) {
      taskDirective = TaskManager.formatTaskDirective(activeTaskRecord);
      if (targets.length === 0) {
        targets = taskMgr.discoverTaskSeedFiles(activeTaskRecord.description);
      }
    }
  }

  // 2. Resolve targets from BM25 query if specified
  if (options.query && targets.length === 0) {
    const candidateFiles = fg.sync(['**/*.{ts,tsx,js,jsx,vue,go,rs,py,lua}'], {
      cwd,
      ignore: ['node_modules/**', 'dist/**', '.git/**', 'coverage/**', '.scp/**'],
      absolute: false,
    });
    const searcher = new BM25CodeSearch();
    for (const file of candidateFiles) {
      try {
        const fullPath = path.resolve(cwd, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const ext = path.extname(file);
        const symbols = AstCache.extractExportedSymbols(content, ext);
        searcher.addDocument({ path: file, symbols, content: content.slice(0, 1000) });
      } catch {
        // ignore unreadable files
      }
    }
    const searchResults = searcher.search(options.query, 5);
    targets = searchResults.map((r) => r.path);
  }

  // 3. Resolve git diff/staged targets
  if (options.diff || options.staged) {
    const gitFiles = getGitModifiedFiles(cwd, Boolean(options.staged));
    for (const gf of gitFiles) {
      if (!targets.includes(gf)) {
        targets.push(gf);
      }
    }
    if (!gitDiffPatch) {
      gitDiffPatch = getGitDiffPatch(cwd, Boolean(options.staged));
    }
  }

  if (targets.length === 0) {
    throw new Error('No target files specified and no matching task, query, or modified Git files detected.');
  }

  const analyzer = new DependencyAnalyzer({
    cwd,
    maxDepth: options.depth ?? options.maxDepth ?? 2,
    reverse: options.reverse ?? false,
    skeleton: options.skeleton ?? false,
    redact: options.redact ?? true,
    customAliases: options.customAliases,
    ignorePatterns: options.ignorePatterns,
    diff: options.diff,
    staged: options.staged,
    maxTokens: options.maxTokens,
    noCache: options.noCache,
  });

  const graph = await analyzer.analyze(targets);
  if (gitDiffPatch) {
    graph.gitDiffPatch = gitDiffPatch;
  }

  // Calculate blast radius if requested
  if (options.blastRadius) {
    graph.blastRadius = await calculateBlastRadius(targets, graph, cwd);
  }

  // Inject persistent project memories unless explicitly disabled
  if (options.includeMemory !== false) {
    const memoryManager = new ProjectMemoryManager(cwd);
    const relevantFiles = Array.from(graph.nodes.keys());
    const memories = memoryManager.getRelevantMemories(relevantFiles);
    if (memories.length > 0) {
      graph.memories = memories;
    }
  }

  // Generate architectural repo-map if requested
  let repoMapResult: any;
  if (options.repoMap) {
    const maxMapTokens = typeof options.repoMap === 'number' ? options.repoMap : 1024;
    repoMapResult = generateRepoMap(graph, { maxTokens: maxMapTokens });
    (graph as any).repoMapText = repoMapResult.mapText;
  }

  // Generate interactive HTML visualizer if requested
  let visualizerPath: string | undefined;
  if (options.visualize) {
    const customOut = typeof options.visualize === 'string' ? options.visualize : undefined;
    visualizerPath = writeVisualizerReport(graph, {
      outputPath: customOut,
      blastRadius: graph.blastRadius,
    });
  }

  // Attach task directive if active
  if (taskDirective) {
    (graph as any).taskDirective = taskDirective;
  }

  // Resolve active third-party dependencies unless disabled
  let dependenciesManifestText: string | undefined;
  if (options.includeDeps !== false) {
    const manifestResolver = new DependencyManifestResolver(cwd);
    const fileContents = Array.from(graph.nodes.values()).map((n) => n.content);
    const activeDeps = manifestResolver.resolveActiveDependencies(fileContents);
    if (activeDeps.length > 0) {
      dependenciesManifestText = DependencyManifestResolver.formatManifestSection(activeDeps);
      (graph as any).dependenciesManifest = dependenciesManifestText;
    }
  }

  const stats = aggregateTokenStats(graph, options.maxTokens);

  const formatter = new ContextFormatter({
    format: options.format || 'md',
    treeOnly: options.treeOnly || false,
    includeStatsSummary: options.includeStatsSummary !== false,
    gitDiffPatch,
    repoMapText: repoMapResult?.mapText,
    taskDirective,
    dependenciesManifest: dependenciesManifestText,
    redact: options.redact !== false,
  });

  const formattedPrompt = formatter.format(graph, stats);

  let outputPath: string | undefined;
  if (options.output) {
    outputPath = path.resolve(cwd, options.output);
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, formattedPrompt, 'utf-8');
  }

  let copiedToClipboard = false;
  if (options.copy) {
    try {
      await clipboardy.write(formattedPrompt);
      copiedToClipboard = true;
    } catch (err) {
      if (!options.quiet) {
        console.warn('Warning: Failed to copy to clipboard:', err);
      }
    }
  }

  return {
    formattedPrompt,
    stats,
    graph,
    outputPath,
    copiedToClipboard,
    gitDiffPatch,
    blastRadius: graph.blastRadius,
    memories: graph.memories,
    repoMap: repoMapResult,
    visualizerPath,
    taskDirective,
    dependenciesManifest: dependenciesManifestText,
    cacheStats: analyzer.getCacheStats(),
  };
}
