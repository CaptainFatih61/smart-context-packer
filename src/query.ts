/**
 * In-Memory BM25 Semantic Intent Routing for smart-context-packer
 * Enables natural language and intent queries (e.g., 'jwt authentication middleware')
 * to discover and rank relevant seed target files across the codebase in milliseconds.
 */

export interface CodeDocument {
  path: string;
  symbols: string[];
  content?: string;
}

export interface SearchResult {
  path: string;
  score: number;
  matchedTerms: string[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'function', 'const', 'let', 'var', 'class', 'import', 'export',
  'return', 'default', 'interface', 'type', 'async', 'await', 'public', 'private',
  'protected', 'static', 'readonly', 'implements', 'extends', 'true', 'false',
  'null', 'undefined', 'void', 'string', 'number', 'boolean', 'any', 'object',
  'ts', 'js', 'tsx', 'jsx', 'json', 'py', 'go', 'rs', 'lua', 'vue', 'html', 'css', 'md'
]);

/**
 * Tokenizes text, identifier names, camelCase, snake_case, and file paths.
 */
export function tokenizeCode(text: string): string[] {
  if (!text) return [];

  // Split camelCase and PascalCase: 'jwtAuthService' -> 'jwt Auth Service'
  const expanded = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Split on non-alphanumeric characters (dots, slashes, underscores, hyphens, spaces)
  const rawTokens = expanded.toLowerCase().split(/[^a-z0-9]+/);

  const tokens: string[] = [];
  for (const token of rawTokens) {
    if (token.length >= 2 && !STOP_WORDS.has(token)) {
      tokens.push(token);
    }
  }

  return tokens;
}

export class BM25CodeSearch {
  private k1: number;
  private b: number;
  private documents: Map<string, {
    path: string;
    termFrequencies: Map<string, number>;
    length: number;
  }> = new Map();
  private docFrequencies: Map<string, number> = new Map();
  private totalDocs: number = 0;
  private avgDocLength: number = 0;

  constructor(options?: { k1?: number; b?: number }) {
    this.k1 = options?.k1 ?? 1.5;
    this.b = options?.b ?? 0.75;
  }

  /**
   * Adds or indexes a code document into the BM25 model.
   */
  public addDocument(doc: CodeDocument): void {
    const termFreqs = new Map<string, number>();

    // Field weighting:
    // 1. Path tokens (weight 2.5)
    const pathTokens = tokenizeCode(doc.path);
    for (const t of pathTokens) {
      termFreqs.set(t, (termFreqs.get(t) || 0) + 2.5);
    }

    // 2. Exported symbol tokens (weight 3.5)
    for (const sym of doc.symbols) {
      const symTokens = tokenizeCode(sym);
      for (const t of symTokens) {
        termFreqs.set(t, (termFreqs.get(t) || 0) + 3.5);
      }
    }

    // 3. Body/comment tokens (weight 1.0)
    if (doc.content) {
      const contentTokens = tokenizeCode(doc.content);
      for (const t of contentTokens) {
        termFreqs.set(t, (termFreqs.get(t) || 0) + 1.0);
      }
    }

    let docLen = 0;
    for (const weight of termFreqs.values()) {
      docLen += weight;
    }

    this.documents.set(doc.path, {
      path: doc.path,
      termFrequencies: termFreqs,
      length: docLen
    });

    // Update document frequencies
    for (const term of termFreqs.keys()) {
      this.docFrequencies.set(term, (this.docFrequencies.get(term) || 0) + 1);
    }

    this.totalDocs = this.documents.size;
    let totalLen = 0;
    for (const d of this.documents.values()) {
      totalLen += d.length;
    }
    this.avgDocLength = this.totalDocs > 0 ? totalLen / this.totalDocs : 0;
  }

  /**
   * Searches the codebase for matching files ordered by BM25 relevance score.
   */
  public search(query: string, topK: number = 5): SearchResult[] {
    const queryTokens = tokenizeCode(query);
    if (queryTokens.length === 0 || this.totalDocs === 0) {
      return [];
    }

    const scores: Array<{ path: string; score: number; matchedTerms: string[] }> = [];

    for (const [path, doc] of this.documents.entries()) {
      let score = 0;
      const matchedTerms: string[] = [];

      for (const q of queryTokens) {
        const tf = doc.termFrequencies.get(q) || 0;
        if (tf > 0) {
          matchedTerms.push(q);
          const n = this.docFrequencies.get(q) || 0;
          // BM25 IDF
          const idf = Math.log(1 + (this.totalDocs - n + 0.5) / (n + 0.5));
          // BM25 Term Weight
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.length / (this.avgDocLength || 1)));
          score += idf * (numerator / denominator);
        }
      }

      if (score > 0) {
        scores.push({ path, score, matchedTerms: Array.from(new Set(matchedTerms)) });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}
