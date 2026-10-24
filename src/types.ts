export type NodeType = 'target' | 'dependency';
export type OutputFormat = 'md' | 'xml';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type MemoryCategory = 'architecture' | 'gotcha' | 'convention' | 'bugfix';

export interface FileStats {
  lines: number;
  characters: number;
  estimatedTokens: number;
}

export interface DependencyNode {
  /** Relative path from workspace root */
  filePath: string;
  /** Normalized absolute path */
  absolutePath: string;
  /** Role in the packing context */
  type: NodeType;
  /** Distance from target (0 for target, 1+ for dependencies) */
  depth: number;
  /** Relative paths of local files imported by this node */
  imports: string[];
  /** Relative paths of files that import this node */
  importedBy: string[];
  /** Whether the body has been skeletonized to save tokens */
  isSkeleton: boolean;
  /** Processed content ready for output */
  content: string;
  /** Per-node stats */
  stats: FileStats;
  /** Top-level exported symbols for index search */
  exportedSymbols?: string[];
}

export interface CircularWarning {
  from: string;
  to: string;
}

export interface DependencyGraph {
  /** Entry target file paths (relative) */
  targets: string[];
  /** Map of relative file path -> DependencyNode */
  nodes: Map<string, DependencyNode>;
  /** Circular dependency relationships detected during traversal */
  circularWarnings: CircularWarning[];
  /** Workspace root directory */
  rootCwd: string;
  /** Missing / unresolvable local relative import paths */
  missingDependencies: string[];
  /** Unified Git diff patch if diff/staged mode was enabled */
  gitDiffPatch?: string;
  /** Blast-radius impact analysis if requested */
  blastRadius?: BlastRadiusResult;
  /** Linked project memories matched for this pack */
  memories?: MemoryEntry[];
}

export interface BlastRadiusResult {
  targets: string[];
  callers: string[];
  fanInCallers?: string[];
  impactedTests: string[];
  untestedTargets: string[];
  riskScore: number;
  score?: number;
  riskLevel: RiskLevel;
  level?: RiskLevel;
  summary: string;
}

export interface MemoryEntry {
  id: string;
  pattern: string;
  category: MemoryCategory;
  content: string;
  createdAt: string;
  tags?: string[];
}

export interface ProjectMemory {
  version: string;
  memories: MemoryEntry[];
}

export interface CacheEntry {
  hash: string;
  mtimeMs: number;
  rawImports: string[];
  exportedSymbols: string[];
  stats: FileStats;
}

export interface CacheStore {
  version: string;
  entries: Record<string, CacheEntry>;
}

export interface CodebaseIndexEntry {
  filePath: string;
  lines: number;
  estimatedTokens: number;
  exportedSymbols: string[];
  hasTests: boolean;
}

export interface AnalyzerOptions {
  /** Workspace root (defaults to process.cwd()) */
  cwd?: string;
  /** Max dependency depth (default: 2, 0 = targets only) */
  maxDepth?: number;
  /** Alias for maxDepth */
  depth?: number;
  /** If true, discovers files in workspace that import the target file */
  reverse?: boolean;
  /** If true, replaces function/class bodies of dependencies with type signatures */
  skeleton?: boolean;
  /** If true, masks sensitive keys and tokens (default: true) */
  redact?: boolean;
  /** Custom path aliases, e.g. { "@/*": "src/*" } */
  customAliases?: Record<string, string>;
  /** Files or glob patterns to ignore */
  ignorePatterns?: string[];
  /** If true, includes all uncommitted modified and untracked files */
  diff?: boolean;
  /** If true, includes only staged git files */
  staged?: boolean;
  /** Maximum token budget. Automatically skeletonizes deeper dependencies until within budget */
  maxTokens?: number;
  /** If true, bypasses and does not read from SHA-256 AST cache */
  noCache?: boolean;
}

export interface TokenStats {
  totalTokens: number;
  totalLines: number;
  totalChars: number;
  pct128k: number;
  pct200k: number;
  /** True if deeper dependencies were skeletonized to fit within maxTokens */
  budgetOptimized?: boolean;
  /** Number of tokens saved through automatic budget skeletonization */
  tokensSavedByBudget?: number;
  fileBreakdown: Array<{
    filePath: string;
    tokens: number;
    lines: number;
    isSkeleton: boolean;
  }>;
}

export interface FormatterOptions {
  format?: OutputFormat;
  treeOnly?: boolean;
  includeStatsSummary?: boolean;
  /** Optional unified Git diff patch to append */
  gitDiffPatch?: string;
  /** Optional blast-radius analysis to format */
  blastRadius?: BlastRadiusResult;
  /** Optional persistent project memories to inject */
  memories?: MemoryEntry[];
  /** Optional architectural repo-map text to inject */
  repoMapText?: string;
  /** Optional active task directive text to inject */
  taskDirective?: string;
  /** Optional active external framework dependencies manifest */
  dependenciesManifest?: string;
  /** If true, redacts sensitive API keys and tokens (default: true) */
  redact?: boolean;
}

export interface RepoMapNode {
  path: string;
  centralityScore: number;
  inDegree: number;
  outDegree: number;
  exportedSymbols: string[];
}

export interface RepoMapResult {
  mapText: string;
  totalTokens: number;
  rankedNodes: RepoMapNode[];
}

export interface PackOptions extends AnalyzerOptions, Omit<FormatterOptions, 'blastRadius' | 'memories' | 'repoMapText' | 'taskDirective' | 'dependenciesManifest'> {
  targets?: string[];
  output?: string;
  copy?: boolean;
  quiet?: boolean;
  /** If true, performs blast-radius analysis, test mapping, and risk scoring */
  blastRadius?: boolean;
  /** If false, disables automatic persistent project memory injection (default: true) */
  includeMemory?: boolean;
  /** Natural language or keyword intent query to discover seed target files (BM25) */
  query?: string;
  /** Generates PageRank architectural repo-map (boolean or max token count, e.g. 1024) */
  repoMap?: boolean | number;
  /** Generates interactive HTML canvas visualizer report (boolean or custom output file path) */
  visualize?: boolean | string;
  /** Active task description to inject plan checklist and auto-route seed files */
  task?: string | boolean;
  /** If false, suppresses automatic external framework dependency version manifest (default: true) */
  includeDeps?: boolean;
  /** If true, shows context HUD budget breakdown (default: true in interactive CLI) */
  hud?: boolean;
}

export interface PackResult {
  formattedPrompt: string;
  stats: TokenStats;
  graph: DependencyGraph;
  outputPath?: string;
  copiedToClipboard: boolean;
  gitDiffPatch?: string;
  blastRadius?: BlastRadiusResult;
  memories?: MemoryEntry[];
  repoMap?: RepoMapResult;
  visualizerPath?: string;
  taskDirective?: string;
  dependenciesManifest?: string;
  cacheStats?: {
    hits: number;
    misses: number;
  };
}
