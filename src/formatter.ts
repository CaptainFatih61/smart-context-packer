import path from 'node:path';
import type {
  DependencyGraph,
  DependencyNode,
  FormatterOptions,
  TokenStats,
} from './types.js';

export const AI_PREFLIGHT_DIRECTIVE = `<!-- ============================================================================== -->
<!--                      SMART CONTEXT PACKER: AI DIRECTIVE                        -->
<!-- ============================================================================== -->
<!-- CRITICAL PRE-FLIGHT INSTRUCTIONS FOR AI CODING ASSISTANT:                      -->
<!-- 1. CAREFULLY INSPECT the visual directory tree and dependency graph below.     -->
<!-- 2. ANALYZE all imported symbols, types, and architectural boundaries BEFORE    -->
<!--    proposing or generating any code changes.                                   -->
<!-- 3. PRESERVE existing conventions, naming styles, and strict typing.            -->
<!-- 4. DO NOT invent or hallucinate modules not present in the workspace.          -->
<!-- ============================================================================== -->`;

export class ContextFormatter {
  private options: FormatterOptions;

  constructor(options: FormatterOptions = {}) {
    this.options = {
      format: options.format || 'md',
      treeOnly: options.treeOnly || false,
      includeStatsSummary: options.includeStatsSummary !== false,
      ...options,
    };
  }

  /**
   * Formats the dependency graph into a ready-to-use AI context prompt.
   */
  public format(graph: DependencyGraph, stats?: TokenStats): string {
    const isXml = this.options.format === 'xml';

    if (isXml) {
      return this.formatXml(graph, stats);
    }

    return this.formatMarkdown(graph, stats);
  }

  /**
   * Formats context as Markdown.
   */
  private formatMarkdown(graph: DependencyGraph, stats?: TokenStats): string {
    const sections: string[] = [];

    // 1. Directive Header
    sections.push(AI_PREFLIGHT_DIRECTIVE);
    sections.push('');

    // 2. Summary stats header
    sections.push('# Context Pack');
    sections.push(`- **Target(s)**: ${graph.targets.map((t) => `\`${t}\``).join(', ')}`);
    sections.push(`- **Total Files Packed**: ${graph.nodes.size}`);
    if (stats) {
      sections.push(
        `- **Total Lines**: ${stats.totalLines.toLocaleString()} | **Estimated Tokens**: ~${stats.totalTokens.toLocaleString()} (${stats.pct128k}% of 128k, ${stats.pct200k}% of 200k)`
      );
    }
    sections.push('');

    // 3. ASCII Directory Tree
    sections.push('## Project Hierarchy');
    sections.push('```text');
    sections.push(renderAsciiTree(graph));
    sections.push('```');
    sections.push('');

    // 4. Dependency Map
    sections.push('## Dependency Graph Map');
    sections.push('```text');
    sections.push(renderDependencyMap(graph));
    sections.push('```');
    sections.push('');

    if (graph.circularWarnings.length > 0) {
      sections.push('> [!WARNING]');
      sections.push('> **Circular Dependencies Detected:**');
      for (const cw of graph.circularWarnings) {
        sections.push(`> - \`${cw.from}\` ⇄ \`${cw.to}\``);
      }
      sections.push('');
    }

    // 5. Git Diff Patch (if present)
    const diffPatch = graph.gitDiffPatch || this.options.gitDiffPatch;
    if (diffPatch) {
      sections.push('## Git Diff Patch');
      sections.push('```diff');
      sections.push(diffPatch.trimEnd());
      sections.push('```');
      sections.push('');
    }

    // 6. Blast-Radius & Impact Analysis (if present)
    const blastRadius = graph.blastRadius || this.options.blastRadius;
    if (blastRadius) {
      sections.push('## 💥 Blast-Radius & Impact Analysis');
      sections.push(`- **Risk Level**: \`${blastRadius.riskLevel}\` (${blastRadius.riskScore}/10)`);
      sections.push(`- **Risk Score**: ${blastRadius.riskScore}/10`);
      sections.push(`- **Summary**: ${blastRadius.summary}`);
      if (blastRadius.callers.length > 0) {
        sections.push(
          `- **Impacted Callers (${blastRadius.callers.length})**: ${blastRadius.callers
            .map((c) => `\`${c}\``)
            .join(', ')}`
        );
      } else {
        sections.push('- **Impacted Callers**: None (isolated component / entrypoint)');
      }
      if (blastRadius.impactedTests.length > 0) {
        sections.push(
          `- **Mapped Test Files (${blastRadius.impactedTests.length})**: ${blastRadius.impactedTests
            .map((t) => `\`${t}\``)
            .join(', ')}`
        );
      } else {
        sections.push('- **Mapped Test Files**: None detected in workspace');
      }
      if (blastRadius.untestedTargets.length > 0) {
        sections.push('> [!WARNING]');
        sections.push(
          `> **Untested Risk Alert:** The following target files have no directly mapped unit test suites:`
        );
        for (const ut of blastRadius.untestedTargets) {
          sections.push(`> - \`${ut}\``);
        }
      }
      sections.push('');
    }

    // 7. Persistent Project Memory (.scp/memory.json)
    const memories = graph.memories || this.options.memories;
    if (memories && memories.length > 0) {
      sections.push('## 🧠 Persistent Project Memory (.scp/memory.json)');
      sections.push(
        'The following historical architectural decisions and gotchas are linked to the files in this pack:'
      );
      for (const m of memories) {
        sections.push(`- **[\`${m.pattern}\` | ${m.category}]**: ${m.content}`);
      }
      sections.push('');
    }

    // 8. Architectural Repo-Map (if present)
    const repoMapText = (graph as any).repoMapText || this.options.repoMapText;
    if (repoMapText) {
      sections.push(repoMapText);
      sections.push('');
    }

    // 9. Active Task Directive (if present)
    const taskDirective = (graph as any).taskDirective || this.options.taskDirective;
    if (taskDirective) {
      sections.push(taskDirective);
      sections.push('');
    }

    // 10. External Frameworks & Dependencies (if present)
    const dependenciesManifest = (graph as any).dependenciesManifest || this.options.dependenciesManifest;
    if (dependenciesManifest) {
      sections.push(dependenciesManifest);
      sections.push('');
    }

    // 9. File Contents (unless treeOnly)
    if (!this.options.treeOnly) {
      sections.push('## Packed Files');
      sections.push('');

      for (const [filePath, node] of graph.nodes) {
        const lang = detectLanguage(filePath);
        const tags: string[] = [];
        if (node.type === 'target') tags.push('TARGET');
        else tags.push(`DEP: depth ${node.depth}`);
        if (node.isSkeleton) tags.push('SKELETON');

        sections.push(`### File: \`${filePath}\` (${tags.join(', ')})`);
        sections.push('```' + lang);
        sections.push(node.content.trimEnd());
        sections.push('```');
        sections.push('');
      }
    }

    return sections.join('\n');
  }

  /**
   * Formats context as structured XML.
   */
  private formatXml(graph: DependencyGraph, stats?: TokenStats): string {
    const xml: string[] = [];

    xml.push('<?xml version="1.0" encoding="UTF-8"?>');
    xml.push('<context_pack generator="smart-context-packer">');
    xml.push('  <directive>');
    xml.push(
      '    Read and inspect all files, dependencies, and hierarchy before responding or suggesting code edits.'
    );
    xml.push('  </directive>');

    if (stats) {
      xml.push('  <metadata>');
      xml.push(`    <total_files>${graph.nodes.size}</total_files>`);
      xml.push(`    <total_lines>${stats.totalLines}</total_lines>`);
      xml.push(`    <estimated_tokens>${stats.totalTokens}</estimated_tokens>`);
      xml.push('    <targets>');
      for (const t of graph.targets) {
        xml.push(`      <target>${escapeXml(t)}</target>`);
      }
      xml.push('    </targets>');
      xml.push('  </metadata>');
    }

    xml.push('  <hierarchy>');
    xml.push(`<![CDATA[\n${renderAsciiTree(graph)}\n]]>`);
    xml.push('  </hierarchy>');

    xml.push('  <dependency_map>');
    xml.push(`<![CDATA[\n${renderDependencyMap(graph)}\n]]>`);
    xml.push('  </dependency_map>');

    const diffPatch = graph.gitDiffPatch || this.options.gitDiffPatch;
    if (diffPatch) {
      xml.push('  <git_diff>');
      xml.push(`<![CDATA[\n${diffPatch}\n]]>`);
      xml.push('  </git_diff>');
    }

    const blastRadius = graph.blastRadius || this.options.blastRadius;
    if (blastRadius) {
      xml.push(
        `  <blast_radius risk_level="${blastRadius.riskLevel}" risk_score="${blastRadius.riskScore}">`
      );
      xml.push(`    <summary>${escapeXml(blastRadius.summary)}</summary>`);
      xml.push(`    <callers>${blastRadius.callers.map(escapeXml).join(',')}</callers>`);
      xml.push(
        `    <impacted_tests>${blastRadius.impactedTests.map(escapeXml).join(',')}</impacted_tests>`
      );
      xml.push(
        `    <untested_targets>${blastRadius.untestedTargets.map(escapeXml).join(',')}</untested_targets>`
      );
      xml.push('  </blast_radius>');
    }

    const memories = graph.memories || this.options.memories;
    if (memories && memories.length > 0) {
      xml.push('  <project_memory>');
      for (const m of memories) {
        xml.push(
          `    <memory id="${escapeXml(m.id)}" pattern="${escapeXml(m.pattern)}" category="${m.category}">${escapeXml(
            m.content
          )}</memory>`
        );
      }
      xml.push('  </project_memory>');
    }

    const repoMapText = (graph as any).repoMapText || this.options.repoMapText;
    if (repoMapText) {
      xml.push('  <repo_map>');
      xml.push(`<![CDATA[\n${repoMapText}\n]]>`);
      xml.push('  </repo_map>');
    }

    const taskDirective = (graph as any).taskDirective || this.options.taskDirective;
    if (taskDirective) {
      xml.push('  <task_directive>');
      xml.push(`<![CDATA[\n${taskDirective}\n]]>`);
      xml.push('  </task_directive>');
    }

    const dependenciesManifest = (graph as any).dependenciesManifest || this.options.dependenciesManifest;
    if (dependenciesManifest) {
      xml.push('  <dependencies_manifest>');
      xml.push(`<![CDATA[\n${dependenciesManifest}\n]]>`);
      xml.push('  </dependencies_manifest>');
    }

    if (!this.options.treeOnly) {
      xml.push('  <files>');
      for (const [filePath, node] of graph.nodes) {
        xml.push(
          `    <file path="${escapeXml(filePath)}" type="${node.type}" depth="${node.depth}" is_skeleton="${node.isSkeleton}" lines="${node.stats.lines}" tokens="${node.stats.estimatedTokens}">`
        );
        xml.push(`<![CDATA[\n${node.content}\n]]>`);
        xml.push('    </file>');
      }
      xml.push('  </files>');
    }

    xml.push('</context_pack>');
    return xml.join('\n');
  }
}

/**
 * Builds an ASCII tree of the packed files.
 */
export function renderAsciiTree(graph: DependencyGraph): string {
  interface TreeNode {
    name: string;
    node?: DependencyNode;
    children: Map<string, TreeNode>;
  }

  const root: TreeNode = { name: '.', children: new Map() };

  // Populate hierarchical structure
  for (const [filePath, depNode] of graph.nodes) {
    const parts = filePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLeaf = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          node: isLeaf ? depNode : undefined,
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }
  }

  const lines: string[] = ['.'];

  function walk(treeNode: TreeNode, prefix: string) {
    const entries = Array.from(treeNode.children.values());
    // Sort directories first, then files alphabetically
    entries.sort((a, b) => {
      const aIsDir = a.children.size > 0;
      const bIsDir = b.children.size > 0;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]!;
      const isLast = i === entries.length - 1;
      const branch = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');

      let tag = '';
      if (item.node) {
        if (item.node.type === 'target') {
          tag = ' [TARGET]';
        } else if (item.node.isSkeleton) {
          tag = ` [DEP: depth ${item.node.depth}, SKELETON]`;
        } else {
          tag = ` [DEP: depth ${item.node.depth}]`;
        }
      }

      lines.push(`${prefix}${branch}${item.name}${tag}`);
      if (item.children.size > 0) {
        walk(item, nextPrefix);
      }
    }
  }

  walk(root, '');
  return lines.join('\n');
}

/**
 * Builds a visual dependency map showing which file imports which.
 */
export function renderDependencyMap(graph: DependencyGraph): string {
  const lines: string[] = [];

  for (const [filePath, node] of graph.nodes) {
    if (node.imports.length > 0) {
      const impList = node.imports.map((imp) => `"${imp}"`).join(', ');
      lines.push(`${filePath} -> imports -> [${impList}]`);
    } else {
      lines.push(`${filePath} -> (no local imports)`);
    }
  }

  return lines.join('\n');
}

/**
 * Infers markdown code block language from file extension.
 */
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    case '.vue':
      return 'vue';
    case '.json':
      return 'json';
    case '.lua':
      return 'lua';
    case '.md':
      return 'markdown';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.html':
      return 'html';
    case '.css':
      return 'css';
    case '.prisma':
      return 'prisma';
    default:
      if (filePath.includes('.prisma')) return 'prisma';
      return '';
  }
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convenience helper to format context.
 */
export function formatContext(
  graph: DependencyGraph,
  options: FormatterOptions = {},
  stats?: TokenStats
): string {
  const formatter = new ContextFormatter(options);
  return formatter.format(graph, stats);
}
