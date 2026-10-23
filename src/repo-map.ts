/**
 * Dependency Graph PageRank & Repo-Map Engine for smart-context-packer
 * Computes graph centrality over the codebase dependency topology
 * and renders an ultra-compact, high-density architectural bird's-eye view.
 */

import type { DependencyGraph, RepoMapNode, RepoMapResult } from './types.js';
import { estimateTokens } from './tokens.js';
import { AstCache } from './cache.js';

export interface RepoMapOptions {
  maxTokens?: number;
  dampingFactor?: number;
  maxIterations?: number;
}

function getNodeEntries(graph: DependencyGraph | Record<string, any>): Array<[string, any]> {
  if (graph && 'nodes' in graph && graph.nodes instanceof Map) {
    return Array.from(graph.nodes.entries());
  }
  if (graph && 'nodes' in graph && typeof (graph as any).nodes === 'object') {
    return Object.entries((graph as any).nodes);
  }
  return Object.entries(graph as any);
}

/**
 * Calculates PageRank centrality over a DependencyGraph.
 */
export function calculatePageRank(
  graph: DependencyGraph | Record<string, any>,
  options?: { dampingFactor?: number; maxIterations?: number }
): Map<string, { score: number; inDegree: number; outDegree: number }> {
  const d = options?.dampingFactor ?? 0.85;
  const maxIterations = options?.maxIterations ?? 30;

  const entries = getNodeEntries(graph);
  const nodeKeys = entries.map(([k]) => k);
  const N = nodeKeys.length;

  const result = new Map<string, { score: number; inDegree: number; outDegree: number }>();
  if (N === 0) return result;

  // Build incoming and outgoing adjacency
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();
  const incomingEdges = new Map<string, string[]>();

  for (const node of nodeKeys) {
    inDegreeMap.set(node, 0);
    outDegreeMap.set(node, 0);
    incomingEdges.set(node, []);
  }

  for (const [source, node] of entries) {
    const rawImports: string[] = node.imports || node.rawImports || [];
    // Only count imports that exist in the resolved graph
    const validImports = rawImports.filter((imp: string) => nodeKeys.includes(imp) && imp !== source);
    outDegreeMap.set(source, validImports.length);

    for (const target of validImports) {
      inDegreeMap.set(target, (inDegreeMap.get(target) || 0) + 1);
      incomingEdges.get(target)!.push(source);
    }
  }

  // Initialize scores uniformly
  let scores = new Map<string, number>();
  for (const node of nodeKeys) {
    scores.set(node, 1 / N);
  }

  // Power iteration
  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = new Map<string, number>();
    let sinkWeight = 0;

    for (const node of nodeKeys) {
      if ((outDegreeMap.get(node) || 0) === 0) {
        sinkWeight += scores.get(node) || 0;
      }
    }

    let diff = 0;
    for (const node of nodeKeys) {
      let incomingSum = 0;
      for (const caller of incomingEdges.get(node) || []) {
        const callerOut = outDegreeMap.get(caller) || 1;
        incomingSum += (scores.get(caller) || 0) / callerOut;
      }

      const score = (1 - d) / N + d * (incomingSum + sinkWeight / N);
      newScores.set(node, score);
      diff += Math.abs(score - (scores.get(node) || 0));
    }

    scores = newScores;
    if (diff < 1e-5) break;
  }

  // Normalize scores so sum is 1.0
  let totalScore = 0;
  for (const s of scores.values()) totalScore += s;
  for (const node of nodeKeys) {
    result.set(node, {
      score: totalScore > 0 ? (scores.get(node) || 0) / totalScore : 1 / N,
      inDegree: inDegreeMap.get(node) || 0,
      outDegree: outDegreeMap.get(node) || 0
    });
  }

  return result;
}

/**
 * Generates an ultra-compact architectural Repo-Map fitted into token budget.
 */
export function generateRepoMap(
  graph: DependencyGraph,
  options?: RepoMapOptions
): RepoMapResult {
  const maxTokens = options?.maxTokens ?? 1024;
  const pageRank = calculatePageRank(graph, {
    dampingFactor: options?.dampingFactor,
    maxIterations: options?.maxIterations
  });

  const entries = getNodeEntries(graph);
  const entriesMap = new Map(entries);
  const rankedNodes: RepoMapNode[] = [];
  for (const [path, stats] of pageRank.entries()) {
    const node = entriesMap.get(path);
    const content = node?.content || '';
    const exportedSymbols = node?.exportedSymbols || AstCache.extractExportedSymbols(content, path);
    rankedNodes.push({
      path,
      centralityScore: stats.score,
      inDegree: stats.inDegree,
      outDegree: stats.outDegree,
      exportedSymbols,
    });
  }

  // Sort by centrality score descending, then by in-degree
  rankedNodes.sort((a, b) => {
    if (b.centralityScore !== a.centralityScore) {
      return b.centralityScore - a.centralityScore;
    }
    return b.inDegree - a.inDegree;
  });

  // Build the textual map
  const lines: string[] = [
    '# 🗺️ Codebase Architectural Repo-Map (PageRank Centrality)',
    '<!-- High-density spatial orientation of top architectural hubs and exported signatures -->'
  ];

  for (const node of rankedNodes) {
    const rankPercent = (node.centralityScore * 100).toFixed(1);
    let block = `\n### 📦 \`${node.path}\` (Hub Weight: ${rankPercent}%, Callers: ${node.inDegree}, Deps: ${node.outDegree})`;

    if (node.exportedSymbols.length > 0) {
      const symbolsStr = node.exportedSymbols.map(s => `  - \`${s}\``).join('\n');
      block += `\n**Exports:**\n${symbolsStr}`;
    } else {
      block += `\n*No public exported symbols detected.*`;
    }

    const testText = lines.join('\n') + '\n' + block;
    if (estimateTokens(testText) > maxTokens && lines.length > 2) {
      lines.push('\n*(Repo-map truncated to fit token ceiling)*');
      break;
    }
    lines.push(block);
  }

  const mapText = lines.join('\n');
  return {
    mapText,
    totalTokens: estimateTokens(mapText),
    rankedNodes
  };
}
