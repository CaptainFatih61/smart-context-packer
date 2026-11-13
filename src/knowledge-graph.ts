import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import fg from 'fast-glob';
import type {
  EdgeConfidence,
  GodNodeEntry,
  KnowledgeEdge,
  KnowledgeEdgeRelation,
  KnowledgeGraphData,
  KnowledgeNode,
  KnowledgeNodeKind,
  SuggestedQuestion,
  SurprisingConnection,
} from './types.js';
import { DependencyAnalyzer, POLYGLOT_GLOB_PATTERN } from './analyzer.js';
import { stripStringsAndComments } from './filter.js';
import { ProjectMemoryManager, type WorkMemoryLessons } from './memory.js';

const GRAPH_SCHEMA_VERSION = 1;

const BUILTIN_NOISE_LABELS = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'any',
  'unknown',
  'never',
  'void',
  'null',
  'undefined',
  'Promise',
  'Array',
  'Record',
  'Map',
  'Set',
  'Error',
  'Date',
  'RegExp',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'str',
  'int',
  'float',
  'bool',
  'bytes',
  'list',
  'dict',
  'tuple',
  'Optional',
  'Union',
  'Callable',
  'Path',
  'String',
  'Int',
  'Double',
  'Float',
  'Bool',
  'UUID',
  'URL',
  'Data',
  'constructor',
  'toString',
  'valueOf',
  'init',
  'main',
  'add',
  'get',
  'set',
  'has',
  'delete',
  'clear',
  'push',
  'pop',
  'shift',
  'unshift',
  'slice',
  'splice',
  'split',
  'join',
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'findIndex',
  'some',
  'every',
  'includes',
  'indexOf',
  'startsWith',
  'endsWith',
  'replace',
  'replaceAll',
  'match',
  'matchAll',
  'exec',
  'test',
  'trim',
  'toLowerCase',
  'toUpperCase',
  'charAt',
  'from',
  'keys',
  'values',
  'entries',
  'assign',
  'freeze',
  'stringify',
  'parse',
  'resolve',
  'reject',
  'then',
  'catch',
  'finally',
  'log',
  'warn',
  'error',
  'info',
  'debug',
  'assert',
  'expect',
  'describe',
  'it',
  'beforeEach',
  'afterEach',
]);

export interface BuildKnowledgeGraphOptions {
  targets?: string[];
  includeDocs?: boolean;
  includeTests?: boolean;
  maxFiles?: number;
  persist?: boolean;
  outputDir?: string;
}

export interface QueryKnowledgeGraphOptions {
  mode?: 'bfs' | 'dfs';
  budget?: number;
  maxSeeds?: number;
  cwd?: string;
}

export interface QueryKnowledgeGraphResult {
  expandedTokens: string[];
  vocabSize: number;
  seedNodes: KnowledgeNode[];
  subgraphNodes: KnowledgeNode[];
  subgraphEdges: KnowledgeEdge[];
  formattedOutput: string;
  estimatedTokens: number;
}

export interface ShortestPathResult {
  found: boolean;
  fromNode?: KnowledgeNode;
  toNode?: KnowledgeNode;
  hops: number;
  weakestConfidence?: EdgeConfidence;
  weakestScore?: number;
  steps: Array<{
    from: KnowledgeNode;
    to: KnowledgeNode;
    edge: KnowledgeEdge;
    direction: 'forward' | 'reverse';
  }>;
  formattedPath: string;
}

export interface ExplainEntityResult {
  found: boolean;
  node?: KnowledgeNode;
  communityLabel?: string;
  outgoing: Array<{ edge: KnowledgeEdge; target: KnowledgeNode }>;
  incoming: Array<{ edge: KnowledgeEdge; source: KnowledgeNode }>;
  rationales: KnowledgeNode[];
  formattedExplanation: string;
}

/**
 * Splits camelCase, PascalCase, snake_case, and kebab-case strings into lowercase word tokens.
 */
export function tokenizeIdentifier(text: string): string[] {
  if (!text) return [];
  const rawWords = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return rawWords.filter((w) => w.length >= 2);
}

function getGitHeadCommit(cwd: string): string | undefined {
  try {
    const out = execSync('git rev-parse HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500,
    })
      .toString('utf-8')
      .trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function makeNodeId(filePath: string, kind: KnowledgeNodeKind, label: string, line?: number): string {
  const normFile = filePath.replace(/\\/g, '/');
  if (kind === 'file') {
    return `file:${normFile}`;
  }
  const cleanLabel = label.replace(/\s+/g, '_');
  return line ? `${kind}:${normFile}:${cleanLabel}:L${line}` : `${kind}:${normFile}:${cleanLabel}`;
}

interface ExtractedSymbol {
  name: string;
  kind: KnowledgeNodeKind;
  line: number;
  endLine: number;
  extendsName?: string;
  implementsNames: string[];
  parentClass?: string;
  bodyText: string;
}

function collectHtmlScriptLineIndices(lines: string[]): Set<number> {
  const activeLines = new Set<number>();
  let inScript = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inScript) {
      const openMatch = line.match(/<script\b([^>]*)>/i);
      if (openMatch) {
        const afterOpenIdx = (openMatch.index ?? 0) + openMatch[0].length;
        const closeIdx = line.toLowerCase().indexOf('</script>', afterOpenIdx);
        if (closeIdx !== -1) {
          if (line.slice(afterOpenIdx, closeIdx).trim()) {
            activeLines.add(i);
          }
        } else {
          if (line.slice(afterOpenIdx).trim()) {
            activeLines.add(i);
          }
          inScript = true;
        }
      }
      continue;
    }

    const closeIdx = line.toLowerCase().indexOf('</script>');
    if (closeIdx !== -1) {
      if (line.slice(0, closeIdx).trim()) {
        activeLines.add(i);
      }
      inScript = false;
    } else {
      activeLines.add(i);
    }
  }

  return activeLines;
}

const JS_TEMPLATE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.htm', '.vue', '.svelte']);

function collectTemplateLiteralInteriorLines(lines: string[], activeScriptLines: Set<number> | null): Set<number> {
  const interiorLines = new Set<number>();
  const braceStack: number[] = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    if (activeScriptLines && !activeScriptLines.has(i)) continue;
    const line = lines[i]!;

    const startsInTemplateText = braceStack.length > 0 && braceStack[braceStack.length - 1] === 0;
    if (startsInTemplateText) {
      interiorLines.add(i);
    }

    let quote: "'" | '"' | null = null;
    let prevSigChar = '';

    for (let j = 0; j < line.length; j++) {
      const ch = line[j]!;
      const next = line[j + 1];
      const top = braceStack[braceStack.length - 1];
      const inTemplateText = braceStack.length > 0 && top === 0;

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          j++;
        }
        continue;
      }

      if (inTemplateText) {
        if (ch === '\\') {
          j++;
          continue;
        }
        if (ch === '`') {
          braceStack.pop();
          prevSigChar = '`';
          continue;
        }
        if (ch === '$' && next === '{') {
          braceStack[braceStack.length - 1] = 1;
          j++;
          prevSigChar = '{';
          continue;
        }
        continue;
      }

      if (quote) {
        if (ch === '\\') {
          j++;
          continue;
        }
        if (ch === quote) {
          quote = null;
          prevSigChar = ch;
        }
        continue;
      }

      if (ch === '/' && next === '/') {
        break;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        j++;
        continue;
      }
      if (ch === '/' && (!prevSigChar || '=(,[!&|?:;{}'.includes(prevSigChar))) {
        let inClass = false;
        let k = j + 1;
        for (; k < line.length; k++) {
          const rc = line[k]!;
          if (rc === '\\') {
            k++;
            continue;
          }
          if (rc === '[') {
            inClass = true;
          } else if (rc === ']') {
            inClass = false;
          } else if (rc === '/' && !inClass) {
            break;
          }
        }
        if (k < line.length) {
          j = k;
          prevSigChar = '/';
          continue;
        }
      }

      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }

      if (ch === '`') {
        braceStack.push(0);
        continue;
      }

      if (braceStack.length > 0 && top !== undefined && top > 0) {
        if (ch === '{') {
          braceStack[braceStack.length - 1] = top + 1;
          prevSigChar = '{';
          continue;
        }
        if (ch === '}') {
          braceStack[braceStack.length - 1] = top - 1;
          prevSigChar = '}';
          continue;
        }
      }

      if (!/\s/.test(ch)) {
        prevSigChar = ch;
      }
    }
  }

  return interiorLines;
}

/**
 * Extracts structured symbols (classes, interfaces, functions, methods, types) and rationale comments from a source file.
 */
export function extractFileSymbolsAndRationales(
  content: string,
  filePath: string
): {
  symbols: ExtractedSymbol[];
  rationales: Array<{ text: string; line: number }>;
} {
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === '.html' || ext === '.htm';
  const lines = content.split(/\r?\n/);
  const activeScriptLines = isHtml ? collectHtmlScriptLineIndices(lines) : null;
  const templateInteriorLines = JS_TEMPLATE_EXTS.has(ext)
    ? collectTemplateLiteralInteriorLines(lines, activeScriptLines)
    : null;
  const symbols: ExtractedSymbol[] = [];
  const rationales: Array<{ text: string; line: number }> = [];

  // 1. Extract Rationale Comments (# WHY:, // WHY:, // NOTE:, # NOTE:, // IMPORTANT:, @rationale)
  const rationaleRegex = /(?:\/\/|#|\*)\s*(?:WHY|NOTE|IMPORTANT|RATIONALE|ADR|RFC)\s*:\s*(.+)$/i;
  for (let i = 0; i < lines.length; i++) {
    if (activeScriptLines && !activeScriptLines.has(i)) continue;
    if (templateInteriorLines?.has(i)) continue;
    const match = rationaleRegex.exec(lines[i]!);
    if (match && match[1]) {
      const text = match[1].trim();
      if (text.length >= 6) {
        rationales.push({ text: text.slice(0, 240), line: i + 1 });
      }
    }
  }

  // 2. Markdown Document Concept Extraction
  if (ext === '.md' || ext === '.mdx') {
    for (let i = 0; i < lines.length; i++) {
      const m = /^(#{1,3})\s+(.+)$/.exec(lines[i]!.trim());
      if (m && m[2]) {
        const heading = m[2].replace(/[`*_~]/g, '').trim();
        if (heading.length >= 3 && heading.length <= 90) {
          const endLine = Math.min(lines.length, i + 25);
          symbols.push({
            name: heading,
            kind: 'concept',
            line: i + 1,
            endLine,
            implementsNames: [],
            bodyText: lines.slice(i, endLine).join('\n'),
          });
        }
      }
    }
    return { symbols, rationales };
  }

  // 3. Polyglot Code Symbol Extraction
  let currentClass: { name: string; endLine: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (activeScriptLines && !activeScriptLines.has(i)) continue;
    if (templateInteriorLines?.has(i)) continue;
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    if (currentClass && i + 1 > currentClass.endLine) {
      currentClass = null;
    }

    // Class / Struct / Trait / Record declaration
    const classMatch = trimmed.match(
      /^(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|abstract\s+|final\s+|sealed\s+|partial\s+)*(?:class|struct|trait|record|actor)\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*<[^>]*>)?(?:\s+(?:extends|:)\s+([A-Za-z0-9_$.]+))?(?:\s+implements\s+([A-Za-z0-9_$,\s<>]+))?/
    );
    if (classMatch && classMatch[1]) {
      const name = classMatch[1];
      const extendsName = classMatch[2]?.split('.').pop();
      const implementsNames = classMatch[3]
        ? classMatch[3]
            .split(',')
            .map((s) => s.replace(/<[^>]*>/g, '').trim())
            .filter(Boolean)
        : [];
      const endLine = estimateBlockEnd(lines, i, ext);
      currentClass = { name, endLine };
      symbols.push({
        name,
        kind: 'class',
        line: i + 1,
        endLine,
        extendsName,
        implementsNames,
        bodyText: lines.slice(i, endLine).join('\n'),
      });
      continue;
    }

    // Interface / Protocol declaration
    const ifaceMatch = trimmed.match(
      /^(?:export\s+)?(?:public\s+|internal\s+)?(?:interface|protocol)\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*<[^>]*>)?(?:\s+extends\s+([A-Za-z0-9_$,\s<>]+))?/
    );
    if (ifaceMatch && ifaceMatch[1]) {
      const name = ifaceMatch[1];
      const extendsList = ifaceMatch[2]
        ? ifaceMatch[2]
            .split(',')
            .map((s) => s.replace(/<[^>]*>/g, '').trim())
            .filter(Boolean)
        : [];
      const endLine = estimateBlockEnd(lines, i, ext);
      symbols.push({
        name,
        kind: 'interface',
        line: i + 1,
        endLine,
        extendsName: extendsList[0],
        implementsNames: extendsList.slice(1),
        bodyText: lines.slice(i, endLine).join('\n'),
      });
      continue;
    }

    // Type / Enum declaration
    const typeMatch = trimmed.match(
      /^(?:export\s+)?(?:public\s+)?(?:type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/
    );
    if (typeMatch && typeMatch[1]) {
      const name = typeMatch[1];
      const endLine = estimateBlockEnd(lines, i, ext);
      symbols.push({
        name,
        kind: 'type',
        line: i + 1,
        endLine,
        implementsNames: [],
        bodyText: lines.slice(i, endLine).join('\n'),
      });
      continue;
    }

    // Function declaration (TS/JS/Python/Go/Rust/PHP/Ruby/Lua)
    const fnMatch =
      trimmed.match(
        /^(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:function\*?|def|func|fn|fun)\s+(?:\([^)]+\)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[<(]/
      ) ||
      trimmed.match(
        /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/
      );
    if (fnMatch && fnMatch[1]) {
      const name = fnMatch[1];
      if (!BUILTIN_NOISE_LABELS.has(name)) {
        const endLine = estimateBlockEnd(lines, i, ext);
        const isMethod = currentClass !== null && i + 1 <= currentClass.endLine && ext === '.py';
        symbols.push({
          name: isMethod ? `${currentClass!.name}.${name}` : name,
          kind: isMethod ? 'method' : 'function',
          line: i + 1,
          endLine,
          parentClass: isMethod ? currentClass!.name : undefined,
          implementsNames: [],
          bodyText: lines.slice(i, endLine).join('\n'),
        });
      }
      continue;
    }

    // Class Method declaration (TS/JS/C#/Java/Kotlin/C++/PHP/Dart)
    if (currentClass && i + 1 <= currentClass.endLine) {
      const methodMatch = trimmed.match(
        /^(?:public|private|protected|internal|static|async|override|virtual|readonly|\s)+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\([^;]*\{?$/
      );
      if (methodMatch && methodMatch[1]) {
        const mName = methodMatch[1];
        if (
          !['if', 'for', 'while', 'switch', 'catch', 'constructor', 'return', 'new'].includes(mName)
        ) {
          const endLine = estimateBlockEnd(lines, i, ext);
          symbols.push({
            name: `${currentClass.name}.${mName}`,
            kind: 'method',
            line: i + 1,
            endLine,
            parentClass: currentClass.name,
            implementsNames: [],
            bodyText: lines.slice(i, endLine).join('\n'),
          });
        }
      }
    }
  }

  return { symbols, rationales };
}

function estimateBlockEnd(lines: string[], startIdx: number, ext: string): number {
  const maxScan = Math.min(lines.length, startIdx + 200);
  if (ext === '.py') {
    const startIndent = lines[startIdx]!.search(/\S|$/);
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < maxScan; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      const curIndent = line.search(/\S|$/);
      if (curIndent <= startIndent) break;
      endIdx = i;
    }
    return endIdx + 1;
  }

  let braceCount = 0;
  let seenBrace = false;
  for (let i = startIdx; i < maxScan; i++) {
    const cleaned = stripStringsAndComments(lines[i]!);
    const opens = (cleaned.match(/\{/g) || []).length;
    const closes = (cleaned.match(/\}/g) || []).length;
    if (opens > 0) seenBrace = true;
    braceCount += opens - closes;
    if (seenBrace && braceCount <= 0) {
      return i + 1;
    }
    if (!seenBrace && cleaned.trim().endsWith(';')) {
      return i + 1;
    }
  }
  return Math.min(lines.length, startIdx + 15);
}

/**
 * Deterministic Louvain-style Modularity Community Clustering.
 * Partitions nodes into cohesive subsystems, splits oversized communities (>25%),
 * and computes per-community cohesion density.
 */
export function clusterCommunities(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[]
): {
  communities: Record<number, string[]>;
  cohesionScores: Record<number, number>;
  communityLabels: Record<number, string>;
} {
  if (nodes.length === 0) {
    return { communities: {}, cohesionScores: {}, communityLabels: {} };
  }

  const sortedNodeIds = nodes.map((n) => n.id).sort();
  const nodeMap = new Map<string, KnowledgeNode>(nodes.map((n) => [n.id, n]));

  // Build weighted undirected adjacency
  const adj = new Map<string, Map<string, number>>();
  const degree = new Map<string, number>();
  for (const id of sortedNodeIds) {
    adj.set(id, new Map());
    degree.set(id, 0);
  }

  let totalWeight = 0;
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    const w = e.confidence === 'AMBIGUOUS' ? 0.4 : e.confidence === 'INFERRED' ? 0.8 : 1.0;
    const uMap = adj.get(e.source)!;
    const vMap = adj.get(e.target)!;
    uMap.set(e.target, (uMap.get(e.target) || 0) + w);
    vMap.set(e.source, (vMap.get(e.source) || 0) + w);
    degree.set(e.source, (degree.get(e.source) || 0) + w);
    degree.set(e.target, (degree.get(e.target) || 0) + w);
    totalWeight += w;
  }

  // Initial seed: group nodes from the same file together to respect file locality, then run modularity passes
  const fileGroupMap = new Map<string, number>();
  const nodeComm = new Map<string, number>();
  let nextComm = 0;

  for (const id of sortedNodeIds) {
    const n = nodeMap.get(id)!;
    const key = n.sourceFile || id;
    if (!fileGroupMap.has(key)) {
      fileGroupMap.set(key, nextComm++);
    }
    nodeComm.set(id, fileGroupMap.get(key)!);
  }

  const m2 = Math.max(1, totalWeight * 2);

  // Greedy Louvain modularity optimization passes
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;

    // Precompute community total weights
    const commTot = new Map<number, number>();
    for (const id of sortedNodeIds) {
      const c = nodeComm.get(id)!;
      commTot.set(c, (commTot.get(c) || 0) + (degree.get(id) || 0));
    }

    for (const id of sortedNodeIds) {
      const currentComm = nodeComm.get(id)!;
      const ki = degree.get(id) || 0;
      const neighbors = adj.get(id)!;
      if (neighbors.size === 0) continue;

      // Calculate weights to neighboring communities
      const commWeights = new Map<number, number>();
      commWeights.set(currentComm, 0);
      for (const [nb, w] of neighbors.entries()) {
        const nbComm = nodeComm.get(nb)!;
        commWeights.set(nbComm, (commWeights.get(nbComm) || 0) + w);
      }

      // Remove id from currentComm
      commTot.set(currentComm, (commTot.get(currentComm) || 0) - ki);

      let bestComm = currentComm;
      let bestGain = 0;

      const candidateComms = Array.from(commWeights.keys()).sort((a, b) => a - b);
      for (const cand of candidateComms) {
        const kIn = commWeights.get(cand) || 0;
        const sigmaTot = commTot.get(cand) || 0;
        const gain = kIn - (sigmaTot * ki) / m2;
        if (gain > bestGain + 1e-6) {
          bestGain = gain;
          bestComm = cand;
        }
      }

      commTot.set(bestComm, (commTot.get(bestComm) || 0) + ki);
      if (bestComm !== currentComm) {
        nodeComm.set(id, bestComm);
        moved = true;
      }
    }

    if (!moved) break;
  }

  // Group into raw communities
  const rawGroups = new Map<number, string[]>();
  for (const id of sortedNodeIds) {
    const c = nodeComm.get(id)!;
    if (!rawGroups.has(c)) rawGroups.set(c, []);
    rawGroups.get(c)!.push(id);
  }

  // Sort communities by size descending so Community 0 is the largest
  const sortedGroups = Array.from(rawGroups.values()).sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return (a[0] || '').localeCompare(b[0] || '');
  });

  const communities: Record<number, string[]> = {};
  const cohesionScores: Record<number, number> = {};
  const communityLabels: Record<number, string> = {};

  for (let cid = 0; cid < sortedGroups.length; cid++) {
    const members = sortedGroups[cid]!;
    communities[cid] = members;

    for (const memberId of members) {
      const node = nodeMap.get(memberId);
      if (node) node.community = cid;
    }

    // Calculate cohesion score: ratio of internal edges to possible internal connections
    const memberSet = new Set(members);
    let internalEdges = 0;
    for (const u of members) {
      const nbs = adj.get(u);
      if (!nbs) continue;
      for (const [v] of nbs.entries()) {
        if (memberSet.has(v)) internalEdges++;
      }
    }
    internalEdges = internalEdges / 2;
    const nCount = members.length;
    const maxEdges = (nCount * (nCount - 1)) / 2;
    const cohesion = nCount <= 1 ? 1.0 : Number(Math.min(1.0, internalEdges / Math.max(1, Math.min(maxEdges, nCount * 3))).toFixed(2));
    cohesionScores[cid] = cohesion;

    // Hub-based deterministic label: prefer highest-degree non-file/non-rationale symbol
    const symbolMembers = members
      .map((id) => nodeMap.get(id)!)
      .filter((n) => n && n.kind !== 'file' && n.kind !== 'rationale');

    const pool = symbolMembers.length > 0 ? symbolMembers : members.map((id) => nodeMap.get(id)!).filter(Boolean);
    pool.sort((a, b) => {
      const degDiff = (b.degree || 0) - (a.degree || 0);
      if (degDiff !== 0) return degDiff;
      return a.id.localeCompare(b.id);
    });

    const hub = pool[0];
    communityLabels[cid] = hub ? hub.label.replace(/\(\)$/, '') : `Community ${cid}`;
  }

  return { communities, cohesionScores, communityLabels };
}

/**
 * Computes God Nodes (the most connected core abstractions, excluding file-level hubs and noise).
 */
export function computeGodNodes(nodes: KnowledgeNode[], topN = 10): GodNodeEntry[] {
  const candidates = nodes.filter(
    (n) =>
      n.kind !== 'file' &&
      n.kind !== 'rationale' &&
      !BUILTIN_NOISE_LABELS.has(n.label) &&
      (n.degree || 0) > 0
  );

  candidates.sort((a, b) => {
    const d = (b.degree || 0) - (a.degree || 0);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });

  return candidates.slice(0, topN).map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    sourceFile: n.sourceFile,
    sourceLocation: n.sourceLocation,
    degree: n.degree || 0,
    community: n.community,
  }));
}

/**
 * Computes Surprising Connections (cross-community, cross-directory, or inferred/ambiguous bridges).
 */
export function computeSurprisingConnections(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  topN = 8
): SurprisingConnection[] {
  const nodeMap = new Map<string, KnowledgeNode>(nodes.map((n) => [n.id, n]));
  const surprises: SurprisingConnection[] = [];

  for (const edge of edges) {
    if (edge.relation === 'contains' || edge.relation === 'defines') continue;
    const u = nodeMap.get(edge.source);
    const v = nodeMap.get(edge.target);
    if (!u || !v) continue;
    if (u.sourceFile === v.sourceFile && edge.relation !== 'rationale_for') continue;

    let score = 0;
    const reasons: string[] = [];

    // 1. Confidence weight
    if (edge.confidence === 'AMBIGUOUS') {
      score += 3;
      reasons.push('ambiguous resolution — requires human verification');
    } else if (edge.confidence === 'INFERRED') {
      score += 2;
      reasons.push('inferred cross-file coupling');
    } else {
      score += 1;
    }

    // 2. Cross-community bridge
    if (u.community !== undefined && v.community !== undefined && u.community !== v.community) {
      score += 3;
      reasons.push(`bridges Community ${u.community} ↔ Community ${v.community}`);
    }

    // 3. Cross top-level directory or doc↔code
    const topDirU = u.sourceFile.includes('/') ? u.sourceFile.split('/')[0] : '.';
    const topDirV = v.sourceFile.includes('/') ? v.sourceFile.split('/')[0] : '.';
    if (topDirU !== topDirV) {
      score += 2;
      reasons.push(`crosses subsystem boundaries (${topDirU} ↔ ${topDirV})`);
    }

    if ((u.kind === 'concept' && v.kind !== 'concept') || (v.kind === 'concept' && u.kind !== 'concept')) {
      score += 2;
      reasons.push('links documentation concept to code implementation');
    }

    if (score >= 3) {
      surprises.push({
        source: u.id,
        target: v.id,
        sourceLabel: u.label,
        targetLabel: v.label,
        sourceFile: u.sourceFile,
        targetFile: v.sourceFile,
        relation: edge.relation,
        confidence: edge.confidence,
        surpriseScore: score,
        reasons,
      });
    }
  }

  surprises.sort((a, b) => b.surpriseScore - a.surpriseScore);
  return surprises.slice(0, topN);
}

/**
 * Generates Suggested Architectural Questions interleaved across signal categories.
 */
export function generateSuggestedQuestions(
  nodes: KnowledgeNode[],
  _edges: KnowledgeEdge[],
  communities: Record<number, string[]>,
  communityLabels: Record<number, string>,
  cohesionScores: Record<number, number>,
  godNodes: GodNodeEntry[],
  surprises: SurprisingConnection[],
  limit = 7
): SuggestedQuestion[] {
  const questions: SuggestedQuestion[] = [];

  // 1. Bridge / God Node questions
  for (const god of godNodes.slice(0, 2)) {
    const commName = god.community !== undefined ? communityLabels[god.community] || `Community ${god.community}` : 'core';
    questions.push({
      type: 'bridge',
      question: `How does "${god.label}" (${god.sourceFile}) coordinate ${god.degree} connections across "${commName}"?`,
      relatedNodes: [god.label],
    });
  }

  // 2. Surprising / Cross-community questions
  for (const s of surprises.slice(0, 2)) {
    questions.push({
      type: s.confidence === 'AMBIGUOUS' ? 'ambiguous' : 'inferred',
      question: `Why does "${s.sourceLabel}" (${s.sourceFile}) connect to "${s.targetLabel}" (${s.targetFile}) via [${s.relation}] (${s.reasons.join(', ')})?`,
      relatedNodes: [s.sourceLabel, s.targetLabel],
    });
  }

  // 3. Low cohesion community questions
  for (const [cidStr, score] of Object.entries(cohesionScores)) {
    const cid = Number(cidStr);
    const members = communities[cid] || [];
    if (members.length >= 5 && score < 0.25) {
      const label = communityLabels[cid] || `Community ${cid}`;
      questions.push({
        type: 'low_cohesion',
        question: `Should subsystem "${label}" (cohesion=${score}, ${members.length} nodes) be decoupled into smaller modules?`,
        relatedNodes: [label],
      });
    }
  }

  // 4. Isolated exported symbol check
  const isolatedSymbols = nodes.filter(
    (n) => (n.kind === 'class' || n.kind === 'function') && (n.degree || 0) <= 1
  );
  if (isolatedSymbols.length > 0) {
    const sample = isolatedSymbols.slice(0, 2).map((n) => n.label);
    questions.push({
      type: 'isolated',
      question: `Are isolated symbols like ${sample.map((s) => `"${s}"`).join(', ')} external public entrypoints or dead code?`,
      relatedNodes: sample,
    });
  }

  return questions.slice(0, limit);
}

/**
 * Builds the full Graphify Knowledge Graph across the workspace or target files.
 */
export async function buildKnowledgeGraph(
  cwd = process.cwd(),
  options: BuildKnowledgeGraphOptions = {}
): Promise<KnowledgeGraphData> {
  const rootCwd = path.resolve(cwd);
  const maxFiles = options.maxFiles || 500;
  const includeDocs = options.includeDocs !== false;

  const patterns = [POLYGLOT_GLOB_PATTERN];
  if (includeDocs) {
    patterns.push('**/*.md');
  }

  let candidateFiles: string[] = [];
  if (options.targets && options.targets.length > 0) {
    for (const t of options.targets) {
      const full = path.resolve(rootCwd, t);
      if (fs.existsSync(full)) {
        if (fs.statSync(full).isDirectory()) {
          const sub = await fg(patterns, {
            cwd: full,
            ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/.scp/**', '**/build/**'],
          });
          for (const s of sub) {
            candidateFiles.push(path.relative(rootCwd, path.join(full, s)).replace(/\\/g, '/'));
          }
        } else {
          candidateFiles.push(path.relative(rootCwd, full).replace(/\\/g, '/'));
        }
      }
    }
  } else {
    const baseIgnore = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/.scp/**', '**/build/**'];
    const workspaceIgnore =
      options.includeTests === true
        ? baseIgnore
        : [
            ...baseIgnore,
            'tests/**',
            'test/**',
            '__tests__/**',
            '**/fixtures/**',
            '**/*.test.*',
            '**/*.spec.*',
            '**/*_test.*',
            '**/test_*.*',
          ];
    candidateFiles = await fg(patterns, {
      cwd: rootCwd,
      ignore: workspaceIgnore,
    });
  }

  candidateFiles = Array.from(new Set(candidateFiles.map((f) => f.replace(/\\/g, '/')))).slice(0, maxFiles);

  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const nodeById = new Map<string, KnowledgeNode>();

  const addNode = (node: KnowledgeNode): KnowledgeNode => {
    if (!nodeById.has(node.id)) {
      node.degree = 0;
      nodeById.set(node.id, node);
      nodes.push(node);
    }
    return nodeById.get(node.id)!;
  };

  const edgeKeySet = new Set<string>();
  const addEdge = (
    source: string,
    target: string,
    relation: KnowledgeEdgeRelation,
    confidence: EdgeConfidence,
    confidenceScore: number
  ) => {
    if (source === target) return;
    if (!nodeById.has(source) || !nodeById.has(target)) return;
    const key = `${source}|${target}|${relation}`;
    if (edgeKeySet.has(key)) return;
    edgeKeySet.add(key);
    edges.push({ source, target, relation, confidence, confidenceScore });
    const sNode = nodeById.get(source)!;
    const tNode = nodeById.get(target)!;
    sNode.degree = (sNode.degree || 0) + 1;
    tNode.degree = (tNode.degree || 0) + 1;
  };

  // Track symbol declarations across workspace for cross-file resolution
  const symbolsByShortName = new Map<string, KnowledgeNode[]>();
  const fileSymbolRecords = new Map<
    string,
    {
      fileNodeId: string;
      content: string;
      extractedSymbols: Array<{ node: KnowledgeNode; meta: ExtractedSymbol }>;
    }
  >();

  // Pass 1: Extract File Nodes, Symbol Nodes, and Rationale Nodes
  for (const relFile of candidateFiles) {
    const absPath = path.resolve(rootCwd, relFile);
    let content = '';
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    const fileLabel = path.basename(relFile);
    const fileNode = addNode({
      id: makeNodeId(relFile, 'file', fileLabel),
      label: relFile,
      kind: 'file',
      sourceFile: relFile,
      sourceLocation: 'L1',
    });

    const { symbols, rationales } = extractFileSymbolsAndRationales(content, relFile);
    const extractedForFile: Array<{ node: KnowledgeNode; meta: ExtractedSymbol }> = [];

    for (const sym of symbols) {
      const symNode = addNode({
        id: makeNodeId(relFile, sym.kind, sym.name, sym.line),
        label: sym.name,
        kind: sym.kind,
        sourceFile: relFile,
        sourceLocation: `L${sym.line}`,
      });

      // File defines/contains symbol (EXTRACTED, 1.0)
      addEdge(
        fileNode.id,
        symNode.id,
        sym.kind === 'concept' ? 'documents' : 'defines',
        'EXTRACTED',
        1.0
      );

      extractedForFile.push({ node: symNode, meta: sym });

      const bareName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
      if (!BUILTIN_NOISE_LABELS.has(bareName) && bareName.length >= 3) {
        if (!symbolsByShortName.has(bareName)) {
          symbolsByShortName.set(bareName, []);
        }
        symbolsByShortName.get(bareName)!.push(symNode);
      }
    }

    // Link methods to their enclosing class within the same file
    for (const item of extractedForFile) {
      if (item.meta.parentClass) {
        const parent = extractedForFile.find(
          (x) => x.meta.kind === 'class' && x.meta.name === item.meta.parentClass
        );
        if (parent) {
          addEdge(parent.node.id, item.node.id, 'contains', 'EXTRACTED', 1.0);
        }
      }
    }

    // Add rationale nodes (# WHY: / // NOTE:) and attach to nearest enclosing/subsequent symbol or file
    for (const rat of rationales) {
      const ratLabel = rat.text.length > 48 ? `${rat.text.slice(0, 45)}...` : rat.text;
      const ratNode = addNode({
        id: makeNodeId(relFile, 'rationale', `rationale_L${rat.line}`, rat.line),
        label: `WHY: ${ratLabel}`,
        kind: 'rationale',
        sourceFile: relFile,
        sourceLocation: `L${rat.line}`,
        rationaleText: rat.text,
      });

      const targetSym = extractedForFile.find(
        (s) => Math.abs(s.meta.line - rat.line) <= 5 || (rat.line >= s.meta.line && rat.line <= s.meta.endLine)
      );
      addEdge(ratNode.id, targetSym ? targetSym.node.id : fileNode.id, 'rationale_for', 'EXTRACTED', 1.0);
    }

    fileSymbolRecords.set(relFile, {
      fileNodeId: fileNode.id,
      content,
      extractedSymbols: extractedForFile,
    });
  }

  // Pass 1.5: Resolve file-level imports using DependencyAnalyzer on code files
  const codeFiles = candidateFiles.filter((f) => !f.endsWith('.md') && !f.endsWith('.mdx'));
  const importedFilesBySource = new Map<string, Set<string>>();

  if (codeFiles.length > 0) {
    try {
      const depAnalyzer = new DependencyAnalyzer({ cwd: rootCwd, maxDepth: 1 });
      const depGraph = await depAnalyzer.analyze(codeFiles);
      for (const [srcFile, depNode] of depGraph.nodes.entries()) {
        const normSrc = srcFile.replace(/\\/g, '/');
        const srcRec = fileSymbolRecords.get(normSrc);
        if (!srcRec) continue;

        if (!importedFilesBySource.has(normSrc)) {
          importedFilesBySource.set(normSrc, new Set());
        }

        for (const impFile of depNode.imports) {
          const normImp = impFile.replace(/\\/g, '/');
          importedFilesBySource.get(normSrc)!.add(normImp);
          const tgtRec = fileSymbolRecords.get(normImp);
          if (tgtRec) {
            addEdge(srcRec.fileNodeId, tgtRec.fileNodeId, 'imports', 'EXTRACTED', 1.0);
          }
        }
      }
    } catch {
      // Fallback if analyzer encounters isolated non-code targets
    }
  }

  // Pass 2: Resolve Symbol-to-Symbol Relationships (inherits, implements, calls, uses, documents)
  for (const [relFile, record] of fileSymbolRecords.entries()) {
    const importedFiles = importedFilesBySource.get(relFile) || new Set<string>();

    // Markdown concept references to code symbols
    if (relFile.endsWith('.md') || relFile.endsWith('.mdx')) {
      for (const { node: conceptNode, meta } of record.extractedSymbols) {
        const inlineCodeRefs = meta.bodyText.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]{2,})`/g);
        for (const m of inlineCodeRefs) {
          const refName = m[1]!;
          const candidates = (symbolsByShortName.get(refName) || []).filter((c) => c.kind !== 'concept');
          if (candidates.length === 1) {
            addEdge(conceptNode.id, candidates[0]!.id, 'documents', 'INFERRED', 0.85);
          }
        }
      }
      continue;
    }

    for (const { node: symNode, meta } of record.extractedSymbols) {
      // 1. Explicit inheritance (extends / implements) -> EXTRACTED (1.0)
      if (meta.extendsName) {
        const targets = symbolsByShortName.get(meta.extendsName) || [];
        const best = targets.find((t) => importedFiles.has(t.sourceFile) || t.sourceFile === relFile) || targets[0];
        if (best) {
          addEdge(symNode.id, best.id, 'inherits', 'EXTRACTED', 1.0);
        }
      }
      for (const implName of meta.implementsNames) {
        const targets = symbolsByShortName.get(implName) || [];
        const best = targets.find((t) => importedFiles.has(t.sourceFile) || t.sourceFile === relFile) || targets[0];
        if (best) {
          addEdge(symNode.id, best.id, 'implements', 'EXTRACTED', 1.0);
        }
      }

      // 2. Call & Type Usage resolution inside symbol body
      const cleanedBody = stripStringsAndComments(meta.bodyText);
      const callMatches = cleanedBody.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{2,})\s*\(/g);
      const seenIdentifiers = new Set<string>();

      for (const m of callMatches) {
        const calledName = m[1]!;
        const selfBare = meta.name.includes('.') ? meta.name.split('.').pop()! : meta.name;
        if (calledName === selfBare || BUILTIN_NOISE_LABELS.has(calledName)) continue;
        if (seenIdentifiers.has(calledName)) continue;
        seenIdentifiers.add(calledName);

        const candidates = (symbolsByShortName.get(calledName) || []).filter(
          (c) => c.id !== symNode.id && c.kind !== 'concept'
        );
        if (candidates.length === 0) continue;

        // Priority A: Candidate is in the same file -> EXTRACTED (1.0)
        const sameFileCand = candidates.find((c) => c.sourceFile === relFile);
        if (sameFileCand) {
          addEdge(symNode.id, sameFileCand.id, 'calls', 'EXTRACTED', 1.0);
          continue;
        }

        // Priority B: Candidate is in an explicitly imported file -> INFERRED (0.85)
        const importedCands = candidates.filter((c) => importedFiles.has(c.sourceFile));
        if (importedCands.length === 1) {
          addEdge(symNode.id, importedCands[0]!.id, 'calls', 'INFERRED', 0.85);
          continue;
        }

        // Priority C: Unique symbol across the entire workspace -> INFERRED (0.75)
        if (candidates.length === 1) {
          addEdge(symNode.id, candidates[0]!.id, 'calls', 'INFERRED', 0.75);
          continue;
        }

        // Priority D: Multiple candidates across unimported files -> AMBIGUOUS (0.20)
        if (importedCands.length > 1) {
          addEdge(symNode.id, importedCands[0]!.id, 'calls', 'AMBIGUOUS', 0.2);
        }
      }

      // 3. Type / Interface / Class reference (`new Foo` or `: FooType`)
      const typeRefs = cleanedBody.matchAll(/(?:\bnew\s+|:\s*)([A-Z][A-Za-z0-9_$]{2,})\b/g);
      for (const m of typeRefs) {
        const refType = m[1]!;
        if (refType === meta.name || BUILTIN_NOISE_LABELS.has(refType)) continue;
        const candidates = (symbolsByShortName.get(refType) || []).filter(
          (c) => c.id !== symNode.id && (c.kind === 'class' || c.kind === 'interface' || c.kind === 'type')
        );
        if (candidates.length === 0) continue;

        const sameOrImported = candidates.filter(
          (c) => c.sourceFile === relFile || importedFiles.has(c.sourceFile)
        );
        if (sameOrImported.length === 1) {
          const isSame = sameOrImported[0]!.sourceFile === relFile;
          addEdge(symNode.id, sameOrImported[0]!.id, 'uses', isSame ? 'EXTRACTED' : 'INFERRED', isSame ? 1.0 : 0.85);
        } else if (candidates.length === 1) {
          addEdge(symNode.id, candidates[0]!.id, 'uses', 'INFERRED', 0.65);
        }
      }
    }
  }

  // Pass 3: Louvain Community Detection & Cohesion Scoring
  const { communities, cohesionScores, communityLabels } = clusterCommunities(nodes, edges);

  // Pass 4: God Nodes, Surprising Connections & Suggested Questions
  const godNodes = computeGodNodes(nodes, 10);
  const surprisingConnections = computeSurprisingConnections(nodes, edges, 8);
  const suggestedQuestions = generateSuggestedQuestions(
    nodes,
    edges,
    communities,
    communityLabels,
    cohesionScores,
    godNodes,
    surprisingConnections,
    7
  );

  const graphData: KnowledgeGraphData = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    builtAt: new Date().toISOString(),
    builtAtCommit: getGitHeadCommit(rootCwd),
    rootCwd,
    nodes,
    edges,
    communities,
    communityLabels,
    cohesionScores,
    godNodes,
    surprisingConnections,
    suggestedQuestions,
  };

  if (options.persist !== false) {
    const outDir = options.outputDir ? path.resolve(rootCwd, options.outputDir) : path.resolve(rootCwd, '.scp');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const graphJsonPath = path.join(outDir, 'graph.json');
    fs.writeFileSync(graphJsonPath, JSON.stringify(graphData, null, 2), 'utf-8');

    const memMgr = new ProjectMemoryManager(rootCwd);
    const lessons = memMgr.getWorkMemoryLessons();
    const reportMd = generateGraphReport(graphData, lessons);
    fs.writeFileSync(path.join(outDir, 'GRAPH_REPORT.md'), reportMd, 'utf-8');
  }

  return graphData;
}

/**
 * Loads `.scp/graph.json` from disk if present, otherwise builds it on the fly.
 */
export async function loadOrBuildKnowledgeGraph(
  cwd = process.cwd(),
  options: BuildKnowledgeGraphOptions & { forceRebuild?: boolean } = {}
): Promise<KnowledgeGraphData> {
  const rootCwd = path.resolve(cwd);
  const graphJsonPath = path.resolve(rootCwd, options.outputDir || '.scp', 'graph.json');

  if (!options.forceRebuild && fs.existsSync(graphJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8')) as KnowledgeGraphData;
      if (raw && raw.schemaVersion === GRAPH_SCHEMA_VERSION && Array.isArray(raw.nodes)) {
        return raw;
      }
    } catch {
      // Rebuild if corrupted
    }
  }

  return buildKnowledgeGraph(rootCwd, options);
}

/**
 * Generates the Graphify-compatible GRAPH_REPORT.md audit trail.
 */
export function generateGraphReport(
  graph: KnowledgeGraphData,
  lessons?: WorkMemoryLessons
): string {
  const projectLabel = path.basename(graph.rootCwd) || 'Project';
  const dateStr = graph.builtAt.slice(0, 10);

  const totalEdges = Math.max(1, graph.edges.length);
  const extCount = graph.edges.filter((e) => e.confidence === 'EXTRACTED').length;
  const infEdges = graph.edges.filter((e) => e.confidence === 'INFERRED');
  const ambCount = graph.edges.filter((e) => e.confidence === 'AMBIGUOUS').length;

  const extPct = Math.round((extCount / totalEdges) * 100);
  const infPct = Math.round((infEdges.length / totalEdges) * 100);
  const ambPct = Math.round((ambCount / totalEdges) * 100);
  const infAvg =
    infEdges.length > 0
      ? (infEdges.reduce((acc, e) => acc + e.confidenceScore, 0) / infEdges.length).toFixed(2)
      : null;

  const commCount = Object.keys(graph.communities).length;

  const lines: string[] = [
    `# Graph Report - ${projectLabel} (${dateStr})`,
    '',
    '## Summary',
    `- **Topology**: ${graph.nodes.length} nodes · ${graph.edges.length} edges · ${commCount} communities`,
    `- **Confidence Audit**: ${extPct}% EXTRACTED (${extCount}) · ${infPct}% INFERRED (${infEdges.length}${infAvg ? `, avg score: ${infAvg}` : ''}) · ${ambPct}% AMBIGUOUS (${ambCount})`,
  ];

  if (graph.builtAtCommit) {
    lines.push(`- **Built from commit**: \`${graph.builtAtCommit.slice(0, 8)}\``);
  }

  // God Nodes
  if (graph.godNodes.length > 0) {
    lines.push('', '## Core Abstractions (God Nodes)');
    for (const g of graph.godNodes) {
      const commLabel =
        g.community !== undefined ? graph.communityLabels[g.community] || `Community ${g.community}` : 'Unassigned';
      lines.push(
        `- **\`${g.label}\`** (${g.kind} in \`${g.sourceFile}\` ${g.sourceLocation || ''}) — **Degree: ${g.degree}** · Community: *${commLabel}*`
      );
    }
  }

  // Communities
  if (commCount > 0) {
    lines.push('', '## Detected Communities (Louvain Subsystems)');
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const [cidStr, memberIds] of Object.entries(graph.communities)) {
      const cid = Number(cidStr);
      const label = graph.communityLabels[cid] || `Community ${cid}`;
      const cohesion = graph.cohesionScores[cid] ?? 1.0;
      const symbolLabels = memberIds
        .map((id) => nodeMap.get(id))
        .filter((n): n is KnowledgeNode => Boolean(n && n.kind !== 'file' && n.kind !== 'rationale'))
        .slice(0, 8)
        .map((n) => `\`${n.label}\``);
      const preview = symbolLabels.length > 0 ? symbolLabels.join(', ') : `${memberIds.length} node(s)`;
      lines.push(`- **Community ${cid}: ${label}** (Cohesion: \`${cohesion}\`, ${memberIds.length} nodes) — ${preview}`);
    }
  }

  // Surprising Connections
  if (graph.surprisingConnections.length > 0) {
    lines.push('', '## Surprising Cross-Boundary Connections');
    for (const s of graph.surprisingConnections) {
      lines.push(
        `- **\`${s.sourceLabel}\`** (\`${s.sourceFile}\`) **--[${s.relation} · ${s.confidence}]-->** **\`${s.targetLabel}\`** (\`${s.targetFile}\`) _(score: ${s.surpriseScore}: ${s.reasons.join('; ')})_`
      );
    }
  }

  // Suggested Questions
  if (graph.suggestedQuestions.length > 0) {
    lines.push('', '## Suggested Architectural Questions');
    for (const q of graph.suggestedQuestions) {
      lines.push(`- **[${q.type.toUpperCase()}]** ${q.question}`);
    }
  }

  // Work-Memory Lessons (Self-improving feedback loop)
  if (
    lessons &&
    (lessons.preferredSources.length > 0 || lessons.deadEnds.length > 0 || lessons.corrections.length > 0)
  ) {
    lines.push('', '## Work-Memory Lessons');
    if (lessons.preferredSources.length > 0) {
      lines.push('', '**Preferred sources** — corroborated by past sessions; start here:');
      for (const p of lessons.preferredSources.slice(0, 10)) {
        lines.push(`- \`${p.pattern}\` (${p.uses}× useful, score=${p.score}): ${p.content}`);
      }
    }
    if (lessons.deadEnds.length > 0) {
      lines.push('', "**Known dead ends** — questions/paths that led nowhere; don't re-derive:");
      for (const d of lessons.deadEnds.slice(0, 10)) {
        const refs = d.relatedNodes.length > 0 ? ` -> ${d.relatedNodes.map((n) => `\`${n}\``).join(', ')}` : '';
        lines.push(`- "${d.question}"${refs} (${d.content})`);
      }
    }
    if (lessons.corrections.length > 0) {
      lines.push('', '**Prior corrections**:');
      for (const c of lessons.corrections.slice(0, 10)) {
        lines.push(`- \`${c.pattern}\`: ${c.correction}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Finds the best matching KnowledgeNode for a search term (label, symbol name, or file path).
 */
export function findBestMatchingNode(
  graph: KnowledgeGraphData,
  term: string
): KnowledgeNode | undefined {
  const clean = term.trim();
  if (!clean) return undefined;
  const lower = clean.toLowerCase();

  // 1. Exact ID or exact label match (prefer non-file symbols first if exact symbol name is queried)
  const exactSymbol = graph.nodes.find(
    (n) => n.kind !== 'file' && (n.label.toLowerCase() === lower || n.id.toLowerCase() === lower)
  );
  if (exactSymbol) return exactSymbol;

  const exactAny = graph.nodes.find(
    (n) =>
      n.label.toLowerCase() === lower ||
      n.id.toLowerCase() === lower ||
      n.sourceFile.toLowerCase() === lower
  );
  if (exactAny) return exactAny;

  // 2. Token overlap + substring scoring
  const queryTokens = tokenizeIdentifier(clean);
  let bestNode: KnowledgeNode | undefined;
  let bestScore = 0;

  for (const node of graph.nodes) {
    let score = 0;
    const labelLower = node.label.toLowerCase();
    const fileLower = node.sourceFile.toLowerCase();

    if (labelLower.includes(lower)) score += 6;
    if (fileLower.includes(lower)) score += 3;

    const nodeTokens = new Set([...tokenizeIdentifier(node.label), ...tokenizeIdentifier(node.sourceFile)]);
    for (const qt of queryTokens) {
      if (nodeTokens.has(qt)) score += 3;
      else if (labelLower.includes(qt)) score += 1;
    }

    if (node.kind !== 'file' && node.kind !== 'rationale') {
      score += 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  return bestScore > 0 ? bestNode : undefined;
}

/**
 * Explains a single node/concept in the Knowledge Graph (`graphify explain` equivalent).
 */
export function explainEntity(graph: KnowledgeGraphData, query: string): ExplainEntityResult {
  const node = findBestMatchingNode(graph, query);
  if (!node) {
    return {
      found: false,
      outgoing: [],
      incoming: [],
      rationales: [],
      formattedExplanation: `Could not find any entity matching "${query}" in the knowledge graph.`,
    };
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing: Array<{ edge: KnowledgeEdge; target: KnowledgeNode }> = [];
  const incoming: Array<{ edge: KnowledgeEdge; source: KnowledgeNode }> = [];
  const rationales: KnowledgeNode[] = [];

  for (const edge of graph.edges) {
    if (edge.source === node.id) {
      const target = nodeMap.get(edge.target);
      if (target) outgoing.push({ edge, target });
    } else if (edge.target === node.id) {
      const source = nodeMap.get(edge.source);
      if (source) {
        if (edge.relation === 'rationale_for' && source.kind === 'rationale') {
          rationales.push(source);
        } else {
          incoming.push({ edge, source });
        }
      }
    }
  }

  const commLabel =
    node.community !== undefined
      ? `${node.community} (${graph.communityLabels[node.community] || `Community ${node.community}`})`
      : 'None';

  const lines: string[] = [
    `Node: ${node.label} (${node.kind})`,
    `  Source:    ${node.sourceFile}${node.sourceLocation ? ` ${node.sourceLocation}` : ''}`,
    `  Community: ${commLabel}`,
    `  Degree:    ${outgoing.length + incoming.length}`,
  ];

  if (rationales.length > 0) {
    lines.push('', `Rationales (${rationales.length}):`);
    for (const r of rationales) {
      lines.push(`  * [${r.sourceLocation || ''}] ${r.rationaleText || r.label}`);
    }
  }

  lines.push('', `Connections (${outgoing.length + incoming.length}):`);
  for (const { edge, target } of outgoing.slice(0, 40)) {
    lines.push(
      `  --> ${target.label} (${target.sourceFile}) [${edge.relation}] [${edge.confidence}]`
    );
  }
  for (const { edge, source } of incoming.slice(0, 40)) {
    lines.push(
      `  <-- ${source.label} (${source.sourceFile}) [${edge.relation}] [${edge.confidence}]`
    );
  }

  return {
    found: true,
    node,
    communityLabel: commLabel,
    outgoing,
    incoming,
    rationales,
    formattedExplanation: lines.join('\n'),
  };
}

/**
 * Traces the shortest path between any two concepts/symbols/files (`graphify path A B` equivalent).
 */
export function traceShortestPath(
  graph: KnowledgeGraphData,
  fromQuery: string,
  toQuery: string
): ShortestPathResult {
  const fromNode = findBestMatchingNode(graph, fromQuery);
  const toNode = findBestMatchingNode(graph, toQuery);

  if (!fromNode || !toNode) {
    return {
      found: false,
      fromNode,
      toNode,
      hops: 0,
      steps: [],
      formattedPath: `Could not resolve endpoints: from="${fromQuery}" (${fromNode ? fromNode.label : 'not found'}), to="${toQuery}" (${toNode ? toNode.label : 'not found'}).`,
    };
  }

  if (fromNode.id === toNode.id) {
    return {
      found: true,
      fromNode,
      toNode,
      hops: 0,
      weakestConfidence: 'EXTRACTED',
      weakestScore: 1.0,
      steps: [],
      formattedPath: `Shortest path (0 hops): ${fromNode.label} (${fromNode.sourceFile})`,
    };
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<
    string,
    Array<{ neighbor: string; edge: KnowledgeEdge; direction: 'forward' | 'reverse' }>
  >();

  for (const n of graph.nodes) {
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    adj.get(e.source)?.push({ neighbor: e.target, edge: e, direction: 'forward' });
    adj.get(e.target)?.push({ neighbor: e.source, edge: e, direction: 'reverse' });
  }

  // BFS for shortest path
  const queue: string[] = [fromNode.id];
  const visited = new Set<string>([fromNode.id]);
  const parentMap = new Map<
    string,
    { prev: string; edge: KnowledgeEdge; direction: 'forward' | 'reverse' }
  >();

  let found = false;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === toNode.id) {
      found = true;
      break;
    }
    for (const item of adj.get(curr) || []) {
      if (!visited.has(item.neighbor)) {
        visited.add(item.neighbor);
        parentMap.set(item.neighbor, {
          prev: curr,
          edge: item.edge,
          direction: item.direction,
        });
        queue.push(item.neighbor);
      }
    }
  }

  if (!found) {
    return {
      found: false,
      fromNode,
      toNode,
      hops: 0,
      steps: [],
      formattedPath: `No path found between "${fromNode.label}" (${fromNode.sourceFile}) and "${toNode.label}" (${toNode.sourceFile}).`,
    };
  }

  const steps: ShortestPathResult['steps'] = [];
  let cursor = toNode.id;
  while (cursor !== fromNode.id) {
    const step = parentMap.get(cursor)!;
    steps.unshift({
      from: nodeMap.get(step.prev)!,
      to: nodeMap.get(cursor)!,
      edge: step.edge,
      direction: step.direction,
    });
    cursor = step.prev;
  }

  const rankMap: Record<EdgeConfidence, number> = {
    EXTRACTED: 3,
    INFERRED: 2,
    AMBIGUOUS: 1,
  };
  let weakestConfidence: EdgeConfidence = 'EXTRACTED';
  let weakestScore = 1.0;

  const chainParts: string[] = [steps[0]!.from.label];
  for (const s of steps) {
    if (rankMap[s.edge.confidence] < rankMap[weakestConfidence]) {
      weakestConfidence = s.edge.confidence;
    }
    if (s.edge.confidenceScore < weakestScore) {
      weakestScore = s.edge.confidenceScore;
    }
    const arrow =
      s.direction === 'forward'
        ? `--${s.edge.relation} [${s.edge.confidence}]-->`
        : `<--${s.edge.relation} [${s.edge.confidence}]--`;
    chainParts.push(`${arrow} ${s.to.label}`);
  }

  const formattedPath = [
    `Shortest path (${steps.length} hop${steps.length === 1 ? '' : 's'}, weakest confidence: ${weakestConfidence} [${weakestScore}]):`,
    `  ${chainParts.join(' ')}`,
  ].join('\n');

  return {
    found: true,
    fromNode,
    toNode,
    hops: steps.length,
    weakestConfidence,
    weakestScore,
    steps,
    formattedPath,
  };
}

/**
 * Constrained Vocabulary Expansion + BFS/DFS Subgraph Traversal (`graphify query` equivalent).
 */
export function queryKnowledgeGraph(
  graph: KnowledgeGraphData,
  question: string,
  options: QueryKnowledgeGraphOptions = {}
): QueryKnowledgeGraphResult {
  const mode = options.mode || 'bfs';
  const tokenBudget = options.budget || 2000;
  const charBudget = tokenBudget * 4;
  const maxSeeds = options.maxSeeds || 3;

  // Step 0: Extract vocabulary from graph labels and constrain query tokens
  const vocab = new Set<string>();
  for (const n of graph.nodes) {
    for (const tok of tokenizeIdentifier(n.label)) {
      if (tok.length >= 2 && tok.length <= 30) vocab.add(tok);
    }
  }

  const rawQueryTokens = tokenizeIdentifier(question);
  const expandedTokens: string[] = [];
  for (const qt of rawQueryTokens) {
    if (vocab.has(qt)) {
      if (!expandedTokens.includes(qt)) expandedTokens.push(qt);
    } else {
      // Check prefix/stem match in actual graph vocabulary
      for (const v of vocab) {
        if ((qt.length >= 4 && v.startsWith(qt)) || (v.length >= 4 && qt.startsWith(v))) {
          if (!expandedTokens.includes(v)) expandedTokens.push(v);
        }
      }
    }
  }

  const activeTokens = expandedTokens.slice(0, 12);

  // Score start nodes
  const scored: Array<{ score: number; node: KnowledgeNode }> = [];
  for (const n of graph.nodes) {
    const labelTokens = new Set(tokenizeIdentifier(n.label));
    const labelLower = n.label.toLowerCase();
    let score = 0;
    for (const t of activeTokens) {
      if (labelTokens.has(t)) score += 3;
      else if (labelLower.includes(t)) score += 1;
    }
    if (n.kind !== 'file') score *= 1.2;
    if (score > 0) {
      scored.push({ score, node: n });
    }
  }

  scored.sort((a, b) => b.score - a.score || (b.node.degree || 0) - (a.node.degree || 0));
  const seedNodes = scored.slice(0, maxSeeds).map((s) => s.node);

  if (seedNodes.length === 0) {
    return {
      expandedTokens: activeTokens,
      vocabSize: vocab.size,
      seedNodes: [],
      subgraphNodes: [],
      subgraphEdges: [],
      formattedOutput: `Query expanded to (from graph vocab, ${vocab.size} tokens): [${activeTokens.join(', ')}]\nNo matching nodes found in knowledge graph for: "${question}".`,
      estimatedTokens: 25,
    };
  }

  // Build undirected neighbor lookup
  const neighbors = new Map<string, string[]>();
  for (const n of graph.nodes) neighbors.set(n.id, []);
  for (const e of graph.edges) {
    neighbors.get(e.source)?.push(e.target);
    neighbors.get(e.target)?.push(e.source);
  }

  const subgraphNodeIds = new Set<string>();

  if (mode === 'dfs') {
    const visited = new Set<string>();
    const stack: Array<{ id: string; depth: number }> = seedNodes
      .slice()
      .reverse()
      .map((n) => ({ id: n.id, depth: 0 }));

    while (stack.length > 0) {
      const { id, depth } = stack.pop()!;
      if (visited.has(id) || depth > 6) continue;
      visited.add(id);
      subgraphNodeIds.add(id);
      for (const nb of neighbors.get(id) || []) {
        if (!visited.has(nb)) {
          stack.push({ id: nb, depth: depth + 1 });
        }
      }
    }
  } else {
    let frontier = new Set<string>(seedNodes.map((n) => n.id));
    for (const id of frontier) subgraphNodeIds.add(id);
    for (let step = 0; step < 3; step++) {
      const nextFrontier = new Set<string>();
      for (const id of frontier) {
        for (const nb of neighbors.get(id) || []) {
          if (!subgraphNodeIds.has(nb)) {
            subgraphNodeIds.add(nb);
            nextFrontier.add(nb);
          }
        }
      }
      frontier = nextFrontier;
    }
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const subgraphNodes = Array.from(subgraphNodeIds)
    .map((id) => nodeMap.get(id)!)
    .filter(Boolean);

  // Rank subgraph nodes by relevance to query tokens + degree
  subgraphNodes.sort((a, b) => {
    const relA = activeTokens.filter((t) => a.label.toLowerCase().includes(t)).length;
    const relB = activeTokens.filter((t) => b.label.toLowerCase().includes(t)).length;
    if (relB !== relA) return relB - relA;
    return (b.degree || 0) - (a.degree || 0);
  });

  const subgraphEdges = graph.edges.filter(
    (e) => subgraphNodeIds.has(e.source) && subgraphNodeIds.has(e.target) && e.source !== e.target
  );

  // Check work-memory overlay for preferred sources
  let preferredPatterns = new Set<string>();
  if (options.cwd || graph.rootCwd) {
    try {
      const memMgr = new ProjectMemoryManager(options.cwd || graph.rootCwd);
      const lessons = memMgr.getWorkMemoryLessons();
      preferredPatterns = new Set(lessons.preferredSources.map((p) => p.pattern));
    } catch {
      // ignore
    }
  }

  const lines: string[] = [
    `Query expanded to (from graph vocab, ${vocab.size} tokens): [${activeTokens.join(', ')}]`,
    `Traversal: ${mode.toUpperCase()} | Start: [${seedNodes.map((n) => n.label).join(', ')}] | ${subgraphNodes.length} nodes, ${subgraphEdges.length} edges`,
  ];

  for (const n of subgraphNodes) {
    const isPref = preferredPatterns.has(n.sourceFile) || preferredPatterns.has(n.label);
    const prefTag = isPref ? ' [PREFERRED SOURCE]' : '';
    const ratSuffix = n.kind === 'rationale' && n.rationaleText ? ` note="${n.rationaleText}"` : '';
    lines.push(
      `  NODE ${n.label} (${n.kind}) [src=${n.sourceFile} loc=${n.sourceLocation || 'L1'}]${prefTag}${ratSuffix}`
    );
  }

  for (const e of subgraphEdges) {
    const u = nodeMap.get(e.source);
    const v = nodeMap.get(e.target);
    if (u && v) {
      lines.push(
        `  EDGE ${u.label} --${e.relation} [${e.confidence} ${e.confidenceScore}]--> ${v.label}`
      );
    }
  }

  let output = lines.join('\n');
  if (output.length > charBudget) {
    output =
      output.slice(0, charBudget) +
      `\n... (truncated at ~${tokenBudget} token budget — increase budget for more)`;
  }

  return {
    expandedTokens: activeTokens,
    vocabSize: vocab.size,
    seedNodes,
    subgraphNodes,
    subgraphEdges,
    formattedOutput: output,
    estimatedTokens: Math.ceil(output.length / 4),
  };
}
