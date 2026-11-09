import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  tokenizeIdentifier,
  extractFileSymbolsAndRationales,
  buildKnowledgeGraph,
  loadOrBuildKnowledgeGraph,
  generateGraphReport,
  explainEntity,
  traceShortestPath,
  queryKnowledgeGraph,
} from '../src/knowledge-graph.js';
import { ProjectMemoryManager } from '../src/memory.js';

describe('Graphify Knowledge Graph Engine (src/knowledge-graph.ts)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-kg-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('tokenizes camelCase, PascalCase, and snake_case identifiers accurately', () => {
    const tokens = tokenizeIdentifier('AuthTokenRefreshValidator_v2');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('token');
    expect(tokens).toContain('refresh');
    expect(tokens).toContain('validator');
  });

  it('extracts classes, interfaces, functions, methods, inheritance, and # WHY: rationales', () => {
    const code = `
// WHY: TokenService must remain stateless so horizontal scaling works without sticky sessions.
export interface TokenVerifier {
  verifyToken(raw: string): boolean;
}

export class JwtAuthEngine extends BaseEngine implements TokenVerifier {
  public verifyToken(raw: string): boolean {
    return validateSignature(raw);
  }
}

export function validateSignature(input: string): boolean {
  return input.length > 10;
}
`;
    const extracted = extractFileSymbolsAndRationales(code, 'src/auth/jwt.ts');

    const names = extracted.symbols.map((s) => s.name);
    expect(names).toContain('TokenVerifier');
    expect(names).toContain('JwtAuthEngine');
    expect(names).toContain('JwtAuthEngine.verifyToken');
    expect(names).toContain('validateSignature');

    expect(extracted.rationales.length).toBeGreaterThanOrEqual(1);
    expect(extracted.rationales[0]!.text).toContain('TokenService must remain stateless');

    const jwtClass = extracted.symbols.find((s) => s.name === 'JwtAuthEngine');
    expect(jwtClass?.extendsName).toBe('BaseEngine');
    expect(jwtClass?.implementsNames).toContain('TokenVerifier');
  });

  it('builds a full multi-relational Knowledge Graph with Louvain communities, God Nodes, and Surprising Connections', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'billing'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, 'src', 'auth', 'session.ts'),
      `// WHY: SessionManager enforces strict JWT rotation on privilege elevation.
export class SessionManager {
  public createSession(userId: string) {
    return verifyUser(userId);
  }
}
export function verifyUser(id: string) {
  return id.startsWith('usr_');
}
`,
      'utf-8'
    );

    fs.writeFileSync(
      path.join(tmpDir, 'src', 'billing', 'invoice.ts'),
      `import { SessionManager } from '../auth/session.js';
// RATIONALE: BillingEngine validates active session before issuing ledger mutations.
export class BillingEngine {
  public issueInvoice(userId: string) {
    const mgr = new SessionManager();
    return mgr.createSession(userId);
  }
}
`,
      'utf-8'
    );

    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'ARCHITECTURE.md'),
      `# Payment & Session Architecture
The \`BillingEngine\` coordinates with \`SessionManager\` to guarantee zero unauthorized ledger writes.
`,
      'utf-8'
    );

    const kg = await buildKnowledgeGraph(tmpDir, { persist: true });

    expect(kg.nodes.length).toBeGreaterThan(5);
    expect(kg.edges.length).toBeGreaterThan(5);
    expect(kg.edges.some((e) => e.confidence === 'EXTRACTED')).toBe(true);
    expect(kg.edges.some((e) => e.confidence === 'INFERRED')).toBe(true);
    expect(Object.keys(kg.communities).length).toBeGreaterThanOrEqual(1);
    expect(kg.godNodes.length).toBeGreaterThan(0);

    // Verify persistence on disk
    expect(fs.existsSync(path.join(tmpDir, '.scp', 'graph.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.scp', 'GRAPH_REPORT.md'))).toBe(true);

    const report = generateGraphReport(kg);
    expect(report).toContain('# Graph Report -');
    expect(report).toContain('## Core Abstractions (God Nodes)');
    expect(report).toContain('## Detected Communities (Louvain Subsystems)');

    // Explain entity
    const explained = explainEntity(kg, 'SessionManager');
    expect(explained.found).toBe(true);
    expect(explained.formattedExplanation).toContain('Node: SessionManager (class)');
    expect(explained.formattedExplanation).toContain('SessionManager enforces strict JWT rotation');

    // Shortest path between BillingEngine and verifyUser
    const pathRes = traceShortestPath(kg, 'BillingEngine', 'verifyUser');
    expect(pathRes.found).toBe(true);
    expect(pathRes.hops).toBeGreaterThanOrEqual(1);
    expect(pathRes.formattedPath).toContain('Shortest path');

    // Query knowledge graph (BFS & DFS)
    const bfsRes = queryKnowledgeGraph(kg, 'how does BillingEngine validate session', { mode: 'bfs', budget: 1500 });
    expect(bfsRes.subgraphNodes.length).toBeGreaterThan(0);
    expect(bfsRes.formattedOutput).toContain('Traversal: BFS');

    const dfsRes = queryKnowledgeGraph(kg, 'SessionManager verifyUser', { mode: 'dfs', budget: 1500 });
    expect(dfsRes.subgraphNodes.length).toBeGreaterThan(0);
    expect(dfsRes.formattedOutput).toContain('Traversal: DFS');

    // Cached loadOrBuildKnowledgeGraph
    const loaded = await loadOrBuildKnowledgeGraph(tmpDir);
    expect(loaded.nodes.length).toBe(kg.nodes.length);
  });

  it('tracks self-improving work memory outcomes (useful, dead_end, corrected)', () => {
    const mem = new ProjectMemoryManager(tmpDir);

    const e1 = mem.add({
      pattern: 'src/auth/**',
      content: 'Use SessionManager for stateless token verification',
      outcome: 'useful',
    });
    expect(e1.uses).toBe(1);
    expect(e1.score).toBe(0.8);

    // Re-adding the same useful pattern increments uses and score
    const e1Updated = mem.add({
      pattern: 'src/auth/**',
      content: 'Use SessionManager for stateless token verification',
      outcome: 'useful',
    });
    expect(e1Updated.id).toBe(e1.id);
    expect(e1Updated.uses).toBe(2);
    expect(e1Updated.score).toBe(0.85);

    // Record a dead_end attempt
    mem.add({
      pattern: 'src/auth/**',
      content: 'Tried storing raw JWTs in localStorage — vulnerable to XSS',
      outcome: 'dead_end',
      question: 'Can we store raw JWT in localStorage?',
    });

    // Record a corrected assumption
    mem.add({
      pattern: 'src/billing/**',
      content: 'Assumed BillingEngine talks directly to DB',
      outcome: 'corrected',
      correction: 'BillingEngine delegates session check to SessionManager first',
    });

    const lessons = mem.getWorkMemoryLessons();
    expect(lessons.preferredSources.length).toBe(1);
    expect(lessons.preferredSources[0]!.uses).toBe(2);
    expect(lessons.deadEnds.length).toBe(1);
    expect(lessons.corrections.length).toBe(1);
  });
});
