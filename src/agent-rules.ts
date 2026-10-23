import fs from 'node:fs';
import path from 'node:path';

export interface InitAgentRulesResult {
  agentRulesPath: string;
  agentRulesCreated: boolean;
  cursorRulesPath: string;
  cursorRulesCreated: boolean;
  created: string[];
  updated: string[];
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

## 🚫 Anti-Patterns to Avoid
- DO NOT dump entire directories into context when only specific entrypoints are needed.
- DO NOT invent or assume functions/types without checking their definitions via \`pack_context\`.
- DO NOT manually read 2,000-line \`schema.prisma\` files; let \`smart-context-packer\` extract referenced models automatically.
`;

/**
 * Initializes or updates AI agent rules for Cursor, Antigravity, Claude, and Copilot.
 */
export function initAgentRules(workspaceRoot = process.cwd()): InitAgentRulesResult {
  const root = path.resolve(workspaceRoot);
  const created: string[] = [];
  const updated: string[] = [];

  // 1. .agent/rules/smart-context-packer.md
  const agentRulesDir = path.join(root, '.agent', 'rules');
  const agentRulesFile = path.join(agentRulesDir, 'smart-context-packer.md');

  if (!fs.existsSync(agentRulesDir)) {
    fs.mkdirSync(agentRulesDir, { recursive: true });
  }

  const relativeAgentFile = path.relative(root, agentRulesFile).replace(/\\/g, '/');
  const agentRulesCreated = !fs.existsSync(agentRulesFile);
  fs.writeFileSync(agentRulesFile, AGENT_RULES_CONTENT, 'utf-8');
  if (agentRulesCreated) {
    created.push(relativeAgentFile);
  } else {
    updated.push(relativeAgentFile);
  }

  // 2. .cursorrules
  const cursorrulesFile = path.join(root, '.cursorrules');
  const relativeCursorFile = path.relative(root, cursorrulesFile).replace(/\\/g, '/');
  let cursorRulesCreated = false;

  if (fs.existsSync(cursorrulesFile)) {
    const existingContent = fs.readFileSync(cursorrulesFile, 'utf-8');
    if (!existingContent.includes('SMART CONTEXT PACKER')) {
      const mergedContent = existingContent.trimEnd() + '\n\n' + AGENT_RULES_CONTENT;
      fs.writeFileSync(cursorrulesFile, mergedContent, 'utf-8');
      updated.push(relativeCursorFile);
    }
  } else {
    cursorRulesCreated = true;
    fs.writeFileSync(cursorrulesFile, AGENT_RULES_CONTENT, 'utf-8');
    created.push(relativeCursorFile);
  }

  return {
    agentRulesPath: agentRulesFile,
    agentRulesCreated,
    cursorRulesPath: cursorrulesFile,
    cursorRulesCreated,
    created,
    updated,
  };
}
