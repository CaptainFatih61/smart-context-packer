import path from 'node:path';
import fg from 'fast-glob';
import type { DependencyGraph, BlastRadiusResult, RiskLevel } from './types.js';

const TEST_FILE_PATTERNS = [
  '**/*.test.{ts,tsx,js,jsx,mjs,cjs,py,dart}',
  '**/*.spec.{ts,tsx,js,jsx,dart}',
  '**/*_test.{go,py,rs,dart}',
  '**/test_*.py',
  '**/*Test.{java,kt,cs,php}',
  '**/*Tests.{java,kt,cs,php}',
  'tests/**/*',
  '**/__tests__/**/*',
];

/**
 * Checks whether a given relative file path is a unit test or specification file across languages.
 */
export function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.includes('.test.') ||
    normalized.includes('.spec.') ||
    normalized.includes('_test.') ||
    normalized.includes('test_') ||
    normalized.endsWith('test.cs') ||
    normalized.endsWith('tests.cs') ||
    normalized.endsWith('test.java') ||
    normalized.endsWith('tests.java') ||
    normalized.endsWith('test.kt') ||
    normalized.endsWith('test.php') ||
    normalized.startsWith('tests/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/test/') ||
    normalized.includes('/__tests__/')
  );
}

/**
 * Performs Blast-Radius impact analysis and risk scoring.
 */
export async function calculateBlastRadius(
  targets: string[],
  graph: DependencyGraph,
  cwd: string
): Promise<BlastRadiusResult> {
  const callersSet = new Set<string>();
  const testFilesSet = new Set<string>();

  const toRel = (p: string) => {
    const rel = path.isAbsolute(p) ? path.relative(cwd, p) : p;
    return rel.replace(/\\/g, '/');
  };

  const normalizedTargets = targets.map(toRel);

  // 1. Trace reverse callers (fan-in) from graph nodes
  const queue = [...targets];
  const visited = new Set<string>(targets);
  for (const t of normalizedTargets) {
    visited.add(t);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.nodes.get(current) || graph.nodes.get(toRel(current));
    if (!node) continue;

    for (const caller of node.importedBy) {
      const relCaller = toRel(caller);
      if (!visited.has(caller) && !visited.has(relCaller)) {
        visited.add(caller);
        visited.add(relCaller);
        callersSet.add(relCaller);
        queue.push(caller);
      }
    }
  }

  // 2. Discover workspace test files and check which ones exercise the targets or callers
  let workspaceTestFiles: string[] = [];
  try {
    workspaceTestFiles = await fg(TEST_FILE_PATTERNS, {
      cwd,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    });
  } catch {
    workspaceTestFiles = [];
  }

  const allAffectedFiles = new Set([...targets, ...callersSet]);

  for (const testFile of workspaceTestFiles) {
    const normalizedTest = testFile.replace(/\\/g, '/');
    const testNode = graph.nodes.get(normalizedTest);

    if (testNode) {
      // If test file is in graph, check its dependencies
      const touchesTarget = testNode.imports.some((imp) => allAffectedFiles.has(imp));
      if (touchesTarget || allAffectedFiles.has(normalizedTest)) {
        testFilesSet.add(normalizedTest);
      }
    } else {
      // Heuristic: filename mapping (e.g., foo.test.ts covers foo.ts)
      const baseName = path.basename(testFile).replace(/(\.test|\.spec)\.[^.]+$/, '');
      const matchesTarget = targets.some((t) => {
        const targetBase = path.basename(t).replace(/\.[^.]+$/, '');
        return targetBase === baseName;
      });
      if (matchesTarget) {
        testFilesSet.add(normalizedTest);
      }
    }
  }

  // Add any callers that are already test files
  for (const caller of callersSet) {
    if (isTestFile(caller)) {
      testFilesSet.add(caller);
    }
  }

  // 3. Identify untested targets
  const impactedTests = Array.from(testFilesSet).sort();
  const callers = Array.from(callersSet).filter((c) => !isTestFile(c)).sort();

  const untestedTargets = normalizedTargets.filter((target) => {
    const targetBase = path.basename(target).replace(/\.[^.]+$/, '');
    const hasDirectTest = impactedTests.some((tf) => {
      const testBase = path.basename(tf).replace(/(\.test|\.spec)\.[^.]+$/, '');
      return testBase === targetBase;
    });
    return !hasDirectTest;
  });

  // 4. Calculate Risk Score (0.0 to 10.0)
  let rawScore = 1.0;

  // Caller volume factor (up to +5.0)
  rawScore += Math.min(5.0, callers.length * 1.0);

  // Dependency graph size / depth complexity factor (up to +2.5)
  const nonTargetCount = Math.max(0, graph.nodes.size - targets.length);
  rawScore += Math.min(2.5, nonTargetCount * 0.2);

  // Test coverage gap factor
  if (untestedTargets.length > 0) {
    rawScore += Math.min(4.0, untestedTargets.length * 2.0);
  } else if (impactedTests.length > 0) {
    // Reward having verified test coverage
    rawScore = Math.max(1.0, rawScore - 1.0);
  }

  const riskScore = Number(Math.min(10.0, Math.max(1.0, rawScore)).toFixed(1));

  let riskLevel: RiskLevel = 'LOW';
  if (riskScore >= 7.0 || callers.length >= 4) {
    riskLevel = 'HIGH';
  } else if (riskScore >= 4.0 || callers.length >= 2) {
    riskLevel = 'MEDIUM';
  }

  // 5. Generate human-readable summary
  const summaryParts: string[] = [];
  summaryParts.push(
    `Risk Level ${riskLevel} (${riskScore}/10): ${callers.length} downstream caller(s) impacted.`
  );
  if (impactedTests.length > 0) {
    summaryParts.push(`${impactedTests.length} unit test suite(s) mapped.`);
  }
  if (untestedTargets.length > 0) {
    summaryParts.push(
      `Warning: ${untestedTargets.length} target(s) [${untestedTargets.join(', ')}] have no mapped unit tests.`
    );
  }

  return {
    targets: normalizedTargets,
    callers,
    fanInCallers: callers,
    impactedTests,
    untestedTargets,
    riskScore,
    score: riskScore,
    riskLevel,
    level: riskLevel,
    summary: summaryParts.join(' '),
  };
}
