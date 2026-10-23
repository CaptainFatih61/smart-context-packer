export type NodeType = 'target' | 'dependency';
export type OutputFormat = 'md' | 'xml';

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
}

export interface TokenStats {
  totalTokens: number;
  totalLines: number;
  totalChars: number;
  pct128k: number;
  pct200k: number;
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
}

export interface PackOptions extends AnalyzerOptions, FormatterOptions {
  targets?: string[];
  output?: string;
  copy?: boolean;
  quiet?: boolean;
}

export interface PackResult {
  formattedPrompt: string;
  stats: TokenStats;
  graph: DependencyGraph;
  outputPath?: string;
  copiedToClipboard: boolean;
  gitDiffPatch?: string;
}
