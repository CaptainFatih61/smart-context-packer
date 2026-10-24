import fs from 'node:fs';
import path from 'node:path';

export type AgentPreset = 'all' | 'cursor' | 'claude' | 'copilot' | 'windsurf' | 'agent';

export interface InitAgentRulesResult {
  agentRulesPath: string;
  agentRulesCreated: boolean;
  cursorRulesPath: string;
  cursorRulesCreated: boolean;
  created: string[];
  updated: string[];
  paths?: Record<string, string>;
}

export const AGENT_RULES_CONTENT = `# SMART CONTEXT PACKER: AUTONOMOUS AI AGENT DIRECTIVE

You have access to the \`smart-context-packer\` Model Context Protocol (MCP) server.
Before reading raw repository directories or proposing code modifications, you MUST actively use these tools to maintain architectural integrity, avoid hallucinated imports/schemas, and conserve context tokens.

## 🛠️ Mandatory MCP Tool Workflows

### 1. Before Proposing or Writing Any Code
Call \`inspect_dependency_graph\` with the target file(s) you intend to touch:
- **Tool**: \`inspect_dependency_graph\`
- **Arguments**: \`{ "targets": ["path/to/target.ts"] }\`
- **Objective**: Review the ASCII hierarchy tree and directed import/export map to understand incoming and outgoing dependencies.

### 2. When Loading Context for Complex Logic
Call \`pack_context\` to retrieve the exact dependency slice:
- **Tool**: \`pack_context\`
- **Arguments**: \`{ "targets": ["path/to/target.ts"], "depth": 2, "maxTokens": 4000 }\`
- **Objective**: Load target files with full implementations while deeper dependencies are automatically skeletonized, credentials are redacted, and Prisma schemas are selectively extracted.

### 3. Before Reviewing PRs or Iterating on Active Edits
Call \`pack_git_diff\` to bundle the working tree changes and surrounding modules:
- **Tool**: \`pack_git_diff\`
- **Arguments**: \`{ "stagedOnly": false, "depth": 1 }\`
- **Objective**: View the unified git diff patch alongside caller contracts and imported interfaces.

### 4. For High-Level Architectural Awareness
Call \`generate_repo_map\` for a bird's-eye architectural view:
- **Tool**: \`generate_repo_map\`
- **Arguments**: \`{ "maxTokens": 1024 }\`

### 5. For Natural Language Intent Discovery
Call \`search_codebase_intent\` to find relevant seed files from plain English intent:
- **Tool**: \`search_codebase_intent\`
- **Arguments**: \`{ "query": "auth token refresh verification" }\`

## 🚫 Anti-Patterns to Avoid
- DO NOT dump entire directories into context when only specific entrypoints are needed.
- DO NOT invent or assume functions/types without checking their definitions via \`pack_context\`.
- DO NOT manually read 2,000-line \`schema.prisma\` files; let \`smart-context-packer\` extract referenced models automatically.
`;

const CLAUDE_MD_BANNER = `# Project Intelligence with Smart Context Packer (scp)
When analyzing dependencies, investigating bugs, or packaging context, prefer running \`scp\` commands or using the smart-context-packer MCP tools:
- \`scp <file> -c\`: Copy target file + dependency graph slice to clipboard.
- \`scp --diff -c\`: Review uncommitted git changes with surrounding context.
- \`scp -i "<intent>"\`: Search seed files using BM25 semantic intent routing.
- \`scp --repo-map\`: Generate architectural PageRank repo-map.
`;

/**
 * Initializes or updates AI agent rules for Cursor, Antigravity, Claude, Copilot, and Windsurf.
 */
export function initAgentRules(
  workspaceRoot = process.cwd(),
  preset: AgentPreset = 'all'
): InitAgentRulesResult {
  const root = path.resolve(workspaceRoot);
  const created: string[] = [];
  const updated: string[] = [];
  const paths: Record<string, string> = {};

  const writeOrAppend = (relPath: string, content: string, bannerMarker = 'SMART CONTEXT PACKER') => {
    const fullPath = path.join(root, relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const relNorm = relPath.replace(/\\/g, '/');
    paths[relNorm] = fullPath;

    if (fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath, 'utf-8');
      if (!existing.includes(bannerMarker)) {
        fs.writeFileSync(fullPath, existing.trimEnd() + '\n\n' + content, 'utf-8');
        updated.push(relNorm);
      }
    } else {
      fs.writeFileSync(fullPath, content, 'utf-8');
      created.push(relNorm);
    }
    return fullPath;
  };

  // 1. .agent/rules/smart-context-packer.md
  let agentRulesPath = '';
  let agentRulesCreated = false;
  if (preset === 'all' || preset === 'agent') {
    const existsBefore = fs.existsSync(path.join(root, '.agent/rules/smart-context-packer.md'));
    agentRulesPath = writeOrAppend('.agent/rules/smart-context-packer.md', AGENT_RULES_CONTENT);
    agentRulesCreated = !existsBefore;
  }

  // 2. .cursorrules
  let cursorRulesPath = '';
  let cursorRulesCreated = false;
  if (preset === 'all' || preset === 'cursor') {
    const existsBefore = fs.existsSync(path.join(root, '.cursorrules'));
    cursorRulesPath = writeOrAppend('.cursorrules', AGENT_RULES_CONTENT);
    cursorRulesCreated = !existsBefore;
  }

  // 3. CLAUDE.md (Claude Code CLI)
  if (preset === 'all' || preset === 'claude') {
    writeOrAppend('CLAUDE.md', CLAUDE_MD_BANNER + '\n' + AGENT_RULES_CONTENT, 'Smart Context Packer');
  }

  // 4. .github/copilot-instructions.md (GitHub Copilot)
  if (preset === 'all' || preset === 'copilot') {
    writeOrAppend('.github/copilot-instructions.md', AGENT_RULES_CONTENT);
  }

  // 5. .windsurfrules (Windsurf / Cascade)
  if (preset === 'all' || preset === 'windsurf') {
    writeOrAppend('.windsurfrules', AGENT_RULES_CONTENT);
  }

  return {
    agentRulesPath: agentRulesPath || path.join(root, '.agent/rules/smart-context-packer.md'),
    agentRulesCreated,
    cursorRulesPath: cursorRulesPath || path.join(root, '.cursorrules'),
    cursorRulesCreated,
    created,
    updated,
    paths,
  };
}
