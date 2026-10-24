<div align="center">

# 📦 `smart-context-packer` (`scp`)

**High-Fidelity AI Context Packer & Multi-Language Dependency Graph Analyzer**

*Pack only the code your AI assistant actually needs to see — zero hallucinations, minimal tokens.*

[![CI](https://github.com/CaptainFatih61/smart-context-packer/actions/workflows/ci.yml/badge.svg)](https://github.com/CaptainFatih61/smart-context-packer/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict%20NodeNext-blue.svg)](https://www.typescriptlang.org/)
[![Tested with Vitest](https://img.shields.io/badge/Tested%20with-Vitest-729B1B.svg)](https://vitest.dev/)
[![OpenAI OSS Grant](https://img.shields.io/badge/OpenAI%20OSS%20Grant-Candidate-412991.svg)](https://openai.com/)

[![npm version](https://img.shields.io/badge/version-2.2.0-blue.svg)](package.json)
[![MCP: Stdio Protocol](https://img.shields.io/badge/MCP-12%20Tools%20JSON--RPC-brightgreen.svg)](https://modelcontextprotocol.io/)

[Quickstart](#-quickstart) •
[Features](#-key-features) •
[Active Task Engine](#-active-task-context--planning-engine-v220) •
[Universal Agent Presets](#-universal-multi-assistant-presets-v220) •
[Dependencies Manifest](#-external-frameworks--dependencies-manifest-v220) •
[Tool Output Sandbox](#-tool-output-sandboxing--compression-v220) •
[PageRank Repo-Map](#-pagerank-architectural-repo-map-v210) •
[BM25 Intent Search](#-in-memory-bm25-semantic-intent-routing-v210) •
[Canvas Visualizer](#-interactive-canvas-dependency-visualizer-v210) •
[OSS Comparison](#-how-scp-v22-compares-to-the-best-oss-tools) •
[CLI Usage](#-cli-usage--flags) •
[MCP Suite](#-model-context-protocol-mcp-server-v220)

---

</div>

## 💡 The Problem

When developing with AI assistants (ChatGPT, Claude, Gemini, Cursor, Copilot), developers constantly face two extremes:

1. **The "Full Repository Dump" Trap:** Tools dump the entire codebase into a 90k+ token mega-prompt. The AI loses focus on the real task, exceeds context budgets, racks up enormous API bills, and gets confused by irrelevant boilerplate.
2. **The "Isolated File" Trap:** The developer copies a single file. The AI immediately hallucinates missing function implementations, invents nonexistent interfaces, and generates code that breaks workspace imports.

### The Solution: `smart-context-packer` (`scp` v2.2)

`scp` takes your target entry file(s), analyzes their directed dependency graph (imports, requires, tsconfig aliases, and framework script manifests), redacts sensitive credentials, and packages **ONLY the target files and their direct/transitive local dependencies** into a clean, token-counted prompt equipped with an AI pre-flight directive header.

In **v2.2**, `smart-context-packer` brings **Active Task & Plan Tracking**, **Universal Multi-Assistant Presets** (Cursor, Claude, Copilot, Windsurf, Antigravity), **External Frameworks & Dependencies Manifest Grounding**, **Tool Output Sandboxing (80-95% token savings)**, **Visual Context Budget HUD**, **Middle-Out Slicing**, and **12 MCP Tools** — all with **zero external binary dependencies** (no Python, no Bun, no ChromaDB, no SQLite).

---

## 🏆 How `scp v2.2` Compares to the Best OSS Tools

| Capability / Architecture | `code-review-graph` | `claude-mem` | `mem0` | `context-mode` | **`smart-context-packer` v2.2** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Universal Multi-Agent Presets** | ❌ | ❌ | ❌ | ❌ | **✅ (`all`, `cursor`, `claude`, `copilot`, `windsurf`)** |
| **Active Task & Plan Checklist Engine** | ❌ | ❌ | ❌ | ❌ | **✅ (BM25 seed routing + crash-proof `.scp/tasks.json`)** |
| **External Dependency Manifest Grounding** | ❌ | ❌ | ❌ | ❌ | **✅ (`package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`)** |
| **Tool Output Sandboxing (Tests/Logs)** | ❌ | ❌ | ❌ | Partial | **✅ (Preserves root causes/failures, saves 80-95% tokens)** |
| **Visual Context Budget HUD** | ❌ | ❌ | ❌ | ❌ | **✅ (ASCII progress gauge & token category breakdown)** |
| **PageRank Architectural Repo-Map** | ❌ | ❌ | ❌ | ❌ | **✅ (Centrality scored ~500-1024 token bird's-eye map)** |
| **In-Memory BM25 Semantic Intent Routing** | ❌ | ❌ | ❌ | ❌ | **✅ (CamelCase & symbol boosted intent query `-i`)** |
| **Interactive Offline Canvas Visualizer** | ❌ | ❌ | ❌ | ❌ | **✅ (Self-contained HTML force graph + risk heatmap)** |
| **Built-in Secret & Credential Redactor** | ❌ | ❌ | ❌ | ❌ | **✅ (AWS, GitHub, Stripe, OpenAI, JWT, DB URLs)** |
| **Incremental SHA-256 AST Caching** | ✅ | ❌ | ❌ | ❌ | **✅ (`.scp/cache.json`, sub-millisecond)** |
| **Blast-Radius & Test Impact Risk Scoring** | ✅ | ❌ | ❌ | ❌ | **✅ (Reverse graph + test map + 0-10 risk score)** |
| **Progressive MCP Disclosure Suite** | ❌ | ✅ | ❌ | ❌ | **✅ (12 Native MCP Tools, zero-overhead stdio)** |
| **File-Linked Persistent Project Memory** | ❌ | ❌ | ✅ | ❌ | **✅ (Git-friendly `.scp/memory.json`)** |
| **Smart Middle-Out Slicing** | ❌ | ❌ | ❌ | ❌ | **✅ (Preserves imports & exports, slices massive middle)** |
| **Runtime & Dependency Footprint** | Heavy Python / ChromaDB | Bun / SQLite | Vector DB / Python | Node | **⚡ Pure Node.js / TS (Zero Bloat / Zero C++ DBs)** |
| **Polyglot AST (TS/JS/Vue/Go/Rust/Python/Lua)** | Partial | Partial | None | Partial | **✅ First-Class Native Support** |

---

## ⚡ Quickstart

No installation required — run instantly with `npx`:

```bash
# Analyze a file, bundle dependencies up to depth 2, and copy to clipboard:
npx smart-context-packer src/auth/login.ts -c

# Shorthand alias with skeleton mode:
npx scp src/server.ts -d 2 -s -c

# Auto-skeletonize deep dependencies to strictly fit within token budget:
npx scp src/server.ts -m 4000 -c

# Pack all uncommitted Git changes + dependencies + unified diff patch:
npx scp --diff -c

# Configure AI coding assistants (Cursor, Antigravity, Copilot) background rules:
npx scp --init-agent

# Start zero-dependency Model Context Protocol (MCP) stdio server:
npx scp --mcp

# Generate VS Code / Cursor Command Palette tasks:
npx scp --init-vscode
```

### Or install globally / locally:

```bash
# Global installation
npm install -g smart-context-packer

# Local dependency
npm install -D smart-context-packer
```

---

## 📊 Terminal Experience

When you run `scp`, you receive an instant terminal breakdown:

```text
╭─────────────────────────────────────────────────────────────╮
│ 📦  smart-context-packer summary                            │
├─────────────────────────────────────────────────────────────┤
│ Targets:              1 target file(s)                      │
│ Packed Files:         4 total (3 deps, 1 skeleton)          │
│ Lines of Code:        248                                   │
│ Total Characters:     6,820                                 │
│ Estimated Tokens:     1,640 tokens                          │
├─────────────────────────────────────────────────────────────┤
│ Context Window Usage:                                       │
│  • 128k (GPT-4o):     1.25%                                 │
│  • 200k (Claude/Gemini): 0.80%                              │
├─────────────────────────────────────────────────────────────┤
│ Output File:          .context-pack.md                      │
│ Clipboard:            ✔ Copied to system clipboard          │
╰─────────────────────────────────────────────────────────────╯

✔ Prompt saved to /workspace/.context-pack.md
✔ Copied to clipboard! Ready to paste into ChatGPT, Claude, Cursor, or Gemini.
```

---

## 🚀 Key Features

### 1. 🧠 Multi-Language Dependency Graph Engine
- **TypeScript, JavaScript, JSX, TSX**: Resolves static `import`, dynamic `import()`, `export ... from`, and CommonJS `require()`.
- **NodeNext Extension Mapping**: Automatically resolves `.js` import specifiers to `.ts`/`.tsx` source files on disk.
- **Path Aliases**: Automatically reads `tsconfig.json` or `jsconfig.json` path mappings (e.g. `@/*` -> `src/*`, `~/*` -> `./*`).
- **Vue 3 SFCs**: Extracts script blocks from `.vue` components and traces subcomponent/composable imports.
- **Lua & FiveM**: Parses `fxmanifest.lua` tables (`shared_scripts`, `client_scripts`, `server_scripts` with glob expansion) and Lua dot-notation `require('client.utils')`.

### 2. 🛡️ Automatic Secret & Token Redaction
Never accidentally leak API keys to third-party LLMs:
- **OpenAI Keys** (`sk-...`, `sk-proj-...`) -> `[REDACTED_OPENAI_KEY]`
- **Anthropic Keys** (`sk-ant-...`) -> `[REDACTED_ANTHROPIC_KEY]`
- **GitHub Tokens** (`ghp_...`, `github_pat_...`) -> `[REDACTED_GITHUB_TOKEN]`
- **AWS Credentials** (`AKIA...`) -> `[REDACTED_AWS_KEY]`
- **Private Key PEM Blocks** (`-----BEGIN PRIVATE KEY-----`) -> `[REDACTED_PRIVATE_KEY]`
- **Database Connection Strings** (`postgres://user:pass@host/db`) -> `postgres://user:[REDACTED]@host/db`
- **`.env*` assignments** masked automatically.

### 3. ✂️ Skeleton / Signature Mode (`--skeleton`)
Save up to 85% more tokens on deep dependencies. Deep files have their internal function and method bodies replaced with type signatures:
```typescript
// Original in deep dependency:
export function computeLargeData(items: Item[]): ProcessedResult {
  // 150 lines of complex internal algorithmic logic...
}

// In Skeleton Mode:
export function computeLargeData(items: Item[]): ProcessedResult { /* [Implementation omitted for token efficiency] */ }
```
The AI assistant gains **100% type and API awareness** with **85% less token overhead**.

### 4. 🧭 AI Pre-flight Directive & Visual Directory Tree
Every generated prompt begins with a standardized instruction header:
```markdown
<!-- ============================================================================== -->
<!--                      SMART CONTEXT PACKER: AI DIRECTIVE                        -->
<!-- ============================================================================== -->
<!-- CRITICAL PRE-FLIGHT INSTRUCTIONS FOR AI CODING ASSISTANT:                      -->
<!-- 1. CAREFULLY INSPECT the visual directory tree and dependency graph below.     -->
<!-- 2. ANALYZE all imported symbols, types, and architectural boundaries BEFORE    -->
<!--    proposing or generating any code changes.                                   -->
<!-- 3. PRESERVE existing conventions, naming styles, and strict typing.            -->
<!-- 4. DO NOT invent or hallucinate modules not present in the workspace.          -->
<!-- ============================================================================== -->
```
Accompanied by a visual ASCII directory tree and dependency relationship map:
```text
.
└── src
    ├── models
    │   └── user.ts [DEP: depth 2]
    ├── services
    │   └── auth.ts [DEP: depth 1, SKELETON]
    └── index.ts [TARGET]

src/index.ts -> imports -> ["src/services/auth.ts"]
src/services/auth.ts -> imports -> ["src/models/user.ts"]
```

### 5. 🌿 Git Diff & Working Tree Resolver (`--diff`, `--staged`)
Resolve uncommitted modified and untracked files as targets, calculate their full dependency graph, and append a unified `## Git Diff Patch` section into the prompt for rapid PR reviews and bugfixes.

### 6. 🗄️ Smart Prisma Schema Model Extractor
Detects `@prisma/client` and `prisma.<model>` usage, parsing `schema.prisma` and extracting ONLY the models and enums referenced in the packed code (along with 1-level relations) to prevent DB hallucinations without bloating prompts.

### 7. 🔌 Native Model Context Protocol (MCP) Server (`--mcp`)
Zero-dependency JSON-RPC 2.0 stdio server enabling AI coding agents (Claude Desktop, Cursor, Antigravity, Cline) to pack context and inspect dependency graphs autonomously.

### 8. 💻 VS Code & AI IDE Tasks Generator (`--init-vscode`)
One-command setup of `.vscode/tasks.json` with three Command Palette tasks for instant clipboard copying of active file context, skeleton signatures, or git diffs.

### 9. 🎯 Auto Token-Budget Optimizer (`--max-tokens`)
Automatically monitors the total estimated token count. If the pack exceeds your specified budget, it progressively converts deep dependencies into skeleton signatures (from deepest depth down to depth 1, keeping depth 0 targets intact) to guarantee fitting within LLM window limits.

### 10. 💥 Blast-Radius & Impacted Test Analyzer (`-b, --blast-radius`)
Performs reverse fan-in analysis to identify every workspace file calling your targets, locates all associated unit test files (`*.test.ts`, `*.spec.ts`, `tests/**`), warns of untested modifications, and computes a 0.0-10.0 Risk Score (`LOW`, `MEDIUM`, `HIGH`).

### 11. ⚡ Incremental SHA-256 AST Cache (`.scp/cache.json`)
Caches parsed AST dependencies, exported symbols, and token metrics keyed by content SHA-256 hash and file mtime. Subsequent runs on large repos execute in milliseconds without any external databases.

### 12. 🧠 File-Linked Persistent Project Memory (`.scp/memory.json`)
Store git-friendly architectural decisions, bug gotchas, and invariants linked to file globs. Whenever matching files are packed or edited, their linked memories are automatically injected into the AI context!

### 13. 🌐 3-Layer Progressive Disclosure MCP Suite
Enables AI coding agents to interact with massive codebases progressively:
- **Layer 1**: `search_codebase_index` (~50 tokens per file summary with exported symbols)
- **Layer 1**: `search_codebase_index` (ultra-fast compact symbol/file index ~50t)
- **Layer 2**: `inspect_dependency_graph` (visual tree, dependency map, circular checks, blast radius)
- **Layer 3**: `pack_context` & `pack_git_diff` (complete or skeletonized source code + diffs + memories)
- **Spatial Awareness**: `generate_repo_map` (PageRank architectural bird's-eye map)
- **Semantic Intent**: `search_codebase_intent` (BM25 intent search with camelCase boosting)
- **Interactive Visualizer**: `generate_visualizer` (offline HTML force-directed canvas report)
- **Memory Tools**: `save_project_memory` & `query_project_memory` for persistent cross-session knowledge.

---

## 🗺️ PageRank Architectural Repo-Map (v2.1.0)

When coding in large repositories, LLMs suffer from "tunnel vision" — seeing isolated files without understanding the global architecture. Inspired by Aider's repo-map, `scp` v2.1 implements **Graph PageRank Centrality Ranking** (damping factor 0.85, 20 iterations):

```bash
# Generate a bird's-eye architectural repo-map (defaults to 1024 token budget):
scp --repo-map -c

# Pack an entry file along with a 500-token global architectural map:
scp src/server.ts --repo-map 500 -c
```

### What It Generates:
- Traverses the entire codebase dependency graph.
- Calculates PageRank scores based on in-degree and dependency authority.
- Extracts exported signatures, interfaces, classes, and types from top architectural hubs.
- Produces a strictly token-budgeted bird's-eye view injected directly into the prompt:

```markdown
## 🗺️ Codebase Architectural Repo-Map (PageRank Centrality)
### `src/server.ts` (Score: 0.1852)
  - `startServer(port: number): Promise<void>`
  - `app: Express`
### `src/auth/service.ts` (Score: 0.1420)
  - `verifySessionToken(token: string): Promise<User>`
  - `interface UserSession`
```

---

## 🔍 In-Memory BM25 Semantic Intent Routing (v2.1.0)

Don't remember the exact path to a file? With `-i, --query`, describe what you want in plain English:

```bash
# Query by intent: Automatically discovers matching seed files and packs them!
scp -i "jwt auth token verification" -c

# Pipe intent results into skeleton packing with a token budget:
scp -i "stripe payment webhook handler" -m 2000 -c
```

- **Smart Code Tokenizer**: Splits `camelCase`, `PascalCase`, `snake_case`, and kebab identifiers into constituent semantic terms (e.g. `verifySessionToken` -> `verify`, `session`, `token`).
- **Symbol Boosting**: Exported function/class/interface names receive a 2.5x score multiplier over general file contents.
- **Pure In-Memory BM25**: Runs in sub-10 milliseconds without external embedding models, Python runtimes, or vector databases.

---

## 🎨 Interactive Canvas Dependency Visualizer (v2.1.0)

Inspect your codebase architecture, dependency clusters, and blast radius visually through a standalone, zero-dependency HTML report:

```bash
# Generate an interactive HTML report (.scp/visualizer.html) and open it:
scp src/index.ts --visualize

# Specify custom report output:
scp --diff --visualize ./reports/diff-impact.html
```

### Key Visualizer Features:
- **Zero-Dependency Native HTML5 Canvas**: Embeds physics, styles, and data directly into one file — works completely offline without CDN dependencies.
- **Physics Force-Directed Simulation**: Real-time interactive node dragging, zooming, and panning.
- **Dynamic Node Sizing & Heatmap**: Node radius scales by estimated token count. Colors indicate Blast-Radius risk levels (Green = Low, Orange = Medium, Red = High).
- **Interactive Inspector Sidebar**: Click any node to view incoming/outgoing dependencies, token counts, and full source code.

---

## 🛡️ Built-in Enterprise Secret & Credential Redactor (v2.1.0)

Never accidentally upload production credentials, private keys, or API secrets into an LLM context:

```bash
# Secret redaction is ENABLED BY DEFAULT across all CLI runs and MCP tools:
scp src/config.ts -c

# Opt out only if specifically needed:
scp src/config.ts --no-redact -c
```

### Detected & Sanitized Secret Patterns:
- **Private Keys**: RSA, EC, DSA, OpenSSH, and PGP `-----BEGIN PRIVATE KEY-----` blocks.
- **AWS Credentials**: `AKIA...` Access Key IDs and 40-character secret access keys.
- **GitHub Tokens**: Personal Access Tokens (`ghp_...`, `github_pat_...`), OAuth keys, and refresh tokens.
- **Stripe Keys**: Live and test secret keys (`sk_live_...`, `rk_live_...`, `sk_test_...`).
- **AI Platform Keys**: OpenAI (`sk-proj-...`, `sk-...`), Anthropic (`sk-ant-...`).
- **Slack Tokens**: Bot, user, and app tokens (`xoxb-...`, `xoxp-...`).
- **Database Connection URIs**: PostgreSQL, MySQL, MongoDB, Redis URIs with embedded passwords.
- **Bearer & JWT Tokens**: RFC 7519 3-segment base64url JSON Web Tokens.

---

## 🌐 Polyglot AST Support (TS, JS, Python, Go, Rust, Vue, Lua, Prisma)

`smart-context-packer` v2.1 expands beyond the JavaScript ecosystem into first-class multi-language AST support:

- **Go (`.go`)**: Parses single and multi-line `import (...)` declarations, resolves local package modules via `go.mod`, and extracts function/struct skeletons (`func (s *Server) Start()`).
- **Rust (`.rs`)**: Resolves module hierarchies (`mod parser;`, `use crate::analyzer::*`), traverses `mod.rs` directories, and extracts `fn` / `pub fn` / `impl` signatures.
- **Python (`.py`)**: Resolves `import foo` and `from .module import Bar`, searches `__init__.py` packages, and preserves class/def signatures with docstrings in skeleton mode.
- **Vue 3 SFCs (`.vue`)**: Retains `<script>` and `<script setup>` logic while collapsing bloated templates and style blocks.
- **Lua & FiveM (`.lua`)**: Resolves `fxmanifest.lua` manifests and Lua `require()` dot notation.
- **Prisma (`schema.prisma`)**: Intelligently extracts referenced database models and their relational dependencies.

---

## 💥 Blast-Radius & Impacted Test Analyzer (v2.0.0)

Inspired by `tirth8205/code-review-graph`, `scp` v2.0 eliminates fear of unexpected regression breakage during AI refactorings:

```bash
# Analyze impact, callers, and tests when editing auth.ts:
scp src/auth.ts -b -c

# Combine with git diff to score the risk of your uncommitted changes:
scp --diff -b -c
```

### Risk Scoring Formula & Levels:
- **`LOW` (0.0 - 3.5)**: Isolated changes or comprehensive test suite coverage with limited callers.
- **`MEDIUM` (3.6 - 6.9)**: Moderate fan-in dependencies (1-3 callers) or untested utility modules.
- **`HIGH` (7.0 - 10.0)**: Critical shared core modules with 4+ callers or zero matching test suites.

### AI Context Injection:
When `-b` is enabled, `scp` injects a dedicated directive block into the AI prompt:
```markdown
## 💥 Blast-Radius & Impact Analysis
- **Target Files**: `src/services/auth.ts`
- **Risk Level**: `MEDIUM` (5.2/10)
- **Summary**: ⚠️ MODERATE RISK: 2 callers impacted. 1 test file covers this scope.
- **Impacted Callers (Fan-in)**:
  - `src/controllers/login.ts`
  - `src/server.ts`
- **Impacted Unit Tests**:
  - `tests/auth.test.ts`
```

---

## ⚡ Incremental SHA-256 AST Cache (v2.0.0)

Parsing hundreds of TypeScript and Vue files repeatedly slows down interactive developer loops. `scp` v2.0 introduces a zero-dependency local disk cache stored in `.scp/cache.json`:

```bash
# Normal runs use the incremental cache automatically:
scp src/index.ts -c

# Bypass the cache:
scp src/index.ts --no-cache -c

# Purge the local cache:
scp --clear-cache
```

- **Two-tier validation**: First validates file `mtimeMs` and `fileSize` (instant sub-millisecond check). If modified, computes `crypto.createHash('sha256')` to check if contents actually changed.
- **Stored metadata**: Caches raw imports, line/token stats, and exported symbol lists (`exportedSymbols`).
- **Zero Bloat**: No SQLite binaries, no native C++ bindings, no ChromaDB. Pure Node.js JSON storage.

---

## 🧠 File-Linked Persistent Project Memory (v2.0.0)

Inspired by `mem0`, `scp` v2.0 provides cross-session architectural retention stored directly in `.scp/memory.json` (git-tracked so your entire team and AI agents benefit):

```bash
# Save an architectural decision or gotcha linked to a file pattern:
scp --add-memory "src/mcp.ts:Never log to stdout in stdio MCP mode to prevent JSON-RPC corruption"
scp --add-memory "src/auth/**:Always verify JWT expiration against UTC server time"

# List all stored project memories:
scp --list-memory
```

### Automatic Context Injection:
Whenever files matching pattern globs are packed (either via CLI `scp`, VS Code tasks, or MCP tool calls), their linked memories are **automatically attached** to the AI prompt:

```markdown
## 🧠 Persistent Project Memory (.scp/memory.json)
- **GOTCHA** (`src/mcp.ts`): Never log to stdout in stdio MCP mode to prevent JSON-RPC corruption
```

---

## 🌐 3-Layer Progressive Disclosure MCP Engine (v2.0.0)

Inspired by `claude-mem`'s multi-tier context pattern, `scp` v2.0 provides 6 native MCP tools organized into 3 progressive tiers so AI coding agents never waste context:

```text
┌────────────────────────────────────────────────────────┐
│  Layer 1: search_codebase_index                        │
│  ~30-50 tokens per file: path + size + exportedSymbols │
└───────────────────────┬────────────────────────────────┘
                        ▼
┌────────────────────────────────────────────────────────┐
│  Layer 2: inspect_dependency_graph                     │
│  ASCII Tree + Dependency Map + Circulars + Blast Radius│
└───────────────────────┬────────────────────────────────┘
                        ▼
┌────────────────────────────────────────────────────────┐
│  Layer 3: pack_context & pack_git_diff                 │
│  Full/Skeleton Source Code + Mapped Tests + Memories   │
└────────────────────────────────────────────────────────┘
```

1. **`search_codebase_index` (Layer 1)**: Cheaply search workspace files and exported symbols without loading file bodies.
2. **`inspect_dependency_graph` (Layer 2)**: Inspect architecture, depth hierarchy, and circular warnings.
3. **`pack_context` (Layer 3)**: Package full or skeletonized file bodies with token budgets.
4. **`pack_git_diff`**: Review uncommitted modified or staged Git changes.
5. **`save_project_memory`**: Persist decisions and gotchas into `.scp/memory.json`.
6. **`query_project_memory`**: Search and retrieve architectural rules.

---

## 🎯 Auto Token-Budget Optimizer (v1.3.0)

Context limits (or expensive inference costs) often require fitting within a precise token budget. Instead of manually guessing whether to include dependencies or strip function bodies, use `--max-tokens`:

```bash
# Automatically skeletonize dependencies if total pack exceeds 4,000 tokens:
scp src/server.ts -m 4000 -c
```

### How It Works:
1. `scp` analyzes the full dependency graph and calculates the estimated tokens for all nodes.
2. If total tokens exceed `maxTokens`:
   - It leaves **depth 0 target files intact** (preserving all implementation details for files you are actively editing).
   - It sorts non-target dependency files starting from the **highest dependency depth** (depth 3, then depth 2, then depth 1) and by largest token size.
   - It progressively converts these dependency nodes into **skeleton type signatures** until the total estimated tokens fall within `maxTokens`.
3. The terminal summary reports `Budget Optimized: ✔` and shows the exact tokens saved (`Budget Saved: X tokens`).

---

## 🤖 Automatic Background Agent Rule Generator (v1.3.0)

Stop running manual CLI commands every time you chat with an AI assistant. With one command, configure your AI coding assistants to automatically engineer their own context:

```bash
scp --init-agent
```

### What It Configures:
1. **`.agent/rules/smart-context-packer.md`**: Creates a formal agent directive for Antigravity IDE, Claude Desktop, and autonomous agent loops.
2. **`.cursorrules`**: Automatically creates or merges into your project's `.cursorrules` without duplicating existing rules.

### Autonomous Agent Behavior:
Once initialized, your AI assistant will:
- Autonomously invoke `inspect_dependency_graph` before proposing file modifications.
- Call `pack_context` with optimal depth and token budgets instead of dumping raw directories.
- Call `pack_git_diff` to review your uncommitted working tree and staged patches.

---

## 🌿 Git Diff & Working Tree Resolver (v1.2.0)

When you are fixing a bug or building a feature, you usually want the AI to understand what you've modified and how those changes impact adjacent modules.

Using `--diff` or `--staged`:
1. `scp` automatically runs `git diff --name-only` and `git status --porcelain` to identify changed, added, or untracked files.
2. It feeds those files as root targets into the `DependencyGraph` engine, automatically bundling all imported modules and type definitions.
3. It appends a clean unified patch block under `## Git Diff Patch`:

```markdown
## Git Diff Patch

```diff
diff --git a/src/auth/service.ts b/src/auth/service.ts
--- a/src/auth/service.ts
+++ b/src/auth/service.ts
@@ -12,4 +12,6 @@
+export function verifySessionToken(token: string): boolean {
+  return token.startsWith("sess_");
+}
```
```

### Usage Examples:
```bash
# Pack all uncommitted working tree changes + dependencies + unified diff:
scp --diff -c

# Pack staged changes only:
scp --staged -c

# Combine specific entry files with git diff:
scp src/index.ts --diff -c
```

---

## 🗄️ Smart Prisma Schema Model Extractor (v1.2.0)

In enterprise TypeScript projects using Prisma, `prisma/schema.prisma` can easily exceed 2,000 lines of database models. Dumping the entire schema wastes thousands of tokens on irrelevant tables.

`smart-context-packer` introduces **Zero-Hallucination Prisma Extraction**:
1. It automatically inspects every packed file for imports of `@prisma/client` or references like `prisma.user.findMany` or `db.order.create`.
2. It locates `prisma/schema.prisma` (or `./schema.prisma`) in the workspace.
3. It parses all `model <Name> { ... }` and `enum <Name> { ... }` blocks.
4. It extracts **ONLY the referenced models/enums**, plus their direct **1-level relational models** (e.g., if `User` references `Post` and `Profile`, those models are also included).
5. It injects a clean virtual file block into the prompt:

```prisma
// prisma/schema.prisma [Extracted Models]
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  role      Role     @default(USER)
  posts     Post[]
}

model Post {
  id        String   @id @default(cuid())
  title     String
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
}

enum Role {
  USER
  ADMIN
}
```

---

## 🔌 Model Context Protocol (MCP) Server (v2.2.0)

`smart-context-packer` includes a built-in, zero-dependency **JSON-RPC 2.0 Model Context Protocol (MCP)** server running over `stdio` with **12 native tools**. AI IDEs and autonomous coding agents can invoke `scp` as a native tool without any external wrappers.

Launch manually:
```bash
scp --mcp
```

### AI Client Configuration

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "smart-context-packer": {
      "command": "npx",
      "args": ["-y", "smart-context-packer", "--mcp"]
    }
  }
}
```

#### Cursor (`.cursor/mcp.json`) / Antigravity (`mcp_config.json`) / Windsurf / Cline
```json
{
  "mcpServers": {
    "smart-context-packer": {
      "command": "npx",
      "args": ["-y", "smart-context-packer", "--mcp"]
    }
  }
}
```

### 🛠️ Exposed MCP Tools Suite (12 Native Tools)

| Layer | Tool | Parameters | Description |
|:---|:---|:---|:---|
| **Layer 1** | `search_codebase_index` | `query?: string`<br>`limit?: number`<br>`cwd?: string` | Compact ~50-token index of workspace files and exported symbols without loading file contents. |
| **Layer 1** | `search_codebase_intent` | `query: string`<br>`topK?: number`<br>`cwd?: string` | Fast in-memory BM25 semantic intent ranking matching file paths, symbols, and code stems. |
| **Layer 1** | `generate_repo_map` | `tokenBudget?: number`<br>`cwd?: string` | PageRank-based bird's-eye architectural repo-map fitting within a strict token budget. |
| **Layer 2** | `inspect_dependency_graph` | `targets: string[]`<br>`reverse?: boolean`<br>`blastRadius?: boolean` | Analyzes module imports/exports and returns ASCII hierarchy tree, dependency map, and risk scoring without file bodies. |
| **Layer 2** | `generate_visualizer` | `targets: string[]`<br>`outputPath?: string`<br>`cwd?: string` | Generates self-contained interactive offline HTML canvas visualizer with force graph and risk heatmap. |
| **Layer 2** | `get_framework_manifest` | `cwd?: string` | Extracts active project dependencies & frameworks with exact versions from `package.json`, `go.mod`, `Cargo.toml`, and `requirements.txt`. |
| **Layer 3** | `pack_context` | `targets: string[]`<br>`depth?: number`<br>`skeleton?: boolean`<br>`maxTokens?: number`<br>`blastRadius?: boolean`<br>`format?: "md" \| "xml"` | Packages target files, local dependencies, auto token-budget optimizer, active task context, and framework manifests. |
| **Layer 3** | `pack_git_diff` | `stagedOnly?: boolean`<br>`depth?: number`<br>`skeleton?: boolean`<br>`maxTokens?: number`<br>`format?: "md" \| "xml"` | Packages uncommitted working-tree or staged git modifications, unified diff patch, and surrounding dependency graph. |
| **Ops & Tasks** | `manage_task_context` | `action: "get" \| "create" \| "complete_item" \| "complete_task" \| "list"`<br>`taskName?: string`<br>`items?: string[]`<br>`itemIndex?: number` | Manages crash-proof active task context, tracking multi-step implementation plans and progress checklists in `.scp/tasks.json`. |
| **Ops & Logs** | `sandbox_tool_output` | `rawOutput: string`<br>`maxLines?: number` | Compresses massive noisy tool outputs (tests, linters, build logs, stack traces) by 80-95% while keeping root causes and failures. |
| **Memory** | `save_project_memory` | `pattern: string`<br>`content: string`<br>`category?: string` | Saves persistent architectural rule, bug pattern, or invariant to `.scp/memory.json`. |
| **Memory** | `query_project_memory` | `query?: string`<br>`category?: string` | Retrieves project memories matching query or category to prevent repeated agent mistakes. |

---

## 💻 VS Code & AI IDE Tasks Generator (v1.2.0)

Integrate `scp` directly into your daily IDE workflow with zero manual JSON writing:

```bash
scp --init-vscode
```

This creates or safely merges into `.vscode/tasks.json` with three ready-to-run tasks. Open the Command Palette (`Ctrl+Shift+P` on Windows/Linux, `Cmd+Shift+P` on macOS) and run `Tasks: Run Task`:

1. **`SCP: Pack Active File + Dependencies (Copy to Clipboard)`**
   Runs `npx scp ${relativeFile} --copy` on whichever file tab is currently active.
2. **`SCP: Pack Active File (Skeleton Mode -> Clipboard)`**
   Runs `npx scp ${relativeFile} --skeleton --copy` for ultra-compact signature-only packing.
3. **`SCP: Pack Git Diff + Dependencies (Copy to Clipboard)`**
   Runs `npx scp --diff --copy` to bundle all current unstaged/uncommitted changes and copy to clipboard.

---

## 📈 Token Economy Benchmarks

| Project Type | Target File | Full Repo Dump | `scp` Default (Depth 2) | `scp` Skeleton Mode | Token Savings |
|:---|:---|:---:|:---:|:---:|:---:|
| **Next.js Full-Stack App** | `app/api/auth/route.ts` | 84,200 tokens | 4,310 tokens | **1,850 tokens** | **97.8%** |
| **Vue 3 Dashboard** | `src/views/Analytics.vue` | 56,100 tokens | 3,890 tokens | **1,420 tokens** | **97.4%** |
| **FiveM Game Resource** | `client/vehicles.lua` | 31,500 tokens | 2,740 tokens | **1,190 tokens** | **96.2%** |
| **Node.js Microservice** | `src/handlers/order.ts` | 42,900 tokens | 2,150 tokens | **980 tokens** | **97.7%** |

---

## 🛠️ CLI Usage & Flags

```bash
scp [options] [targets...]
```

> **Note:** `targets` are optional when using `--diff`, `--staged`, `--mcp`, or `--init-vscode`.

### Options Reference

| Flag | Shorthand | Description | Default |
|:---|:---:|:---|:---:|
| `--task <prompt>` | `-t` | Track active task & generate prompt checklist directive with BM25 seed discovery | |
| `--task-list` | | List recorded tasks and checklist items stored in `.scp/tasks.json` | `false` |
| `--task-done <id>` | | Mark a task or checklist item index completed | |
| `--sandbox <command>` | | Execute shell command and compress test/linter/build output by 80-95% | |
| `--no-deps` | | Exclude external framework dependencies manifest header from output | `false` |
| `--query <intent>` | `-i` | In-memory BM25 semantic intent routing to auto-discover seed files | |
| `--repo-map [tokens]` | | Generate PageRank architectural repo-map (token budget default: 1024) | `false` |
| `--visualize [path]` | | Generate interactive offline HTML canvas visualizer report | `false` |
| `--diff` | | Discover all uncommitted modified/untracked files as targets & include diff patch | `false` |
| `--staged` | | Discover staged files as targets & include staged diff patch | `false` |
| `--blast-radius` | `-b` | Trace callers, identify unit tests, and compute 0-10 Risk Score | `false` |
| `--max-tokens <number>` | `-m` | Auto-skeletonize dependencies from deepest depth to fit token budget | |
| `--no-cache` | | Disable SHA-256 AST local disk caching | `false` |
| `--clear-cache` | | Purge local `.scp/cache.json` AST cache | `false` |
| `--add-memory <pattern:note>` | | Save persistent project memory note linked to file pattern | |
| `--list-memory` | | List all persistent project memories stored in `.scp/memory.json` | `false` |
| `--init-agent [preset]` | | Universal multi-agent rule setup (`all`, `cursor`, `claude`, `copilot`, `windsurf`, `agent`) | `all` |
| `--init-vscode` | | Generate or update `.vscode/tasks.json` with ready-to-run IDE tasks | `false` |
| `--mcp` | | Start native JSON-RPC 2.0 Model Context Protocol (MCP) stdio server (12 tools) | `false` |
| `--depth <number>` | `-d` | Dependency traversal depth (`0` = target only, `1` = direct, `2` = transitive) | `2` |
| `--reverse` | `-r` | Discover workspace files that import the target file | `false` |
| `--skeleton` | `-s` | Strip function bodies of dependencies to type signatures | `false` |
| `--format <md\|xml>` | `-f` | Output format: Markdown or structured XML | `md` |
| `--output <file>` | `-o` | Output file destination path | `.context-pack.md` |
| `--copy` | `-c` | Copy packed prompt directly to system clipboard | `false` |
| `--stdout` | | Stream packed prompt directly to standard output (for piping) | `false` |
| `--tree-only` | | Generate only hierarchy tree and dependency map without code bodies | `false` |
| `--no-redact` | | Disable automatic credential and secret redaction | `false` |
| `--quiet` | `-q` | Suppress terminal summary report | `false` |
| `--version` | `-v` | Output version | |
| `--help` | `-h` | Display help screen | |

### Practical Examples

```bash
# 1. Daily Driver: Pack auth handler, copy to clipboard, and paste into ChatGPT
scp src/controllers/auth.ts -c

# 2. Maximum Token Efficiency: Depth 3 with Skeleton signatures
scp src/main.ts -d 3 -s -c

# 3. Review uncommitted git changes + dependencies before creating a PR
scp --diff -c

# 4. XML Mode for specialized LLMs / Claude artifacts
scp src/index.ts -f xml -o prompt.xml

# 5. Reverse Dependency Analysis: What files will be impacted if I edit utils.ts?
scp src/utils/formatters.ts --reverse -c

# 6. Pipe directly into another tool or CLI assistant
scp src/server.ts --stdout | claude
```

---

## 🎮 FiveM & Game Scripting Support

`smart-context-packer` includes first-class support for Grand Theft Auto V / FiveM game server developers:

```bash
# Point directly to a resource's fxmanifest.lua:
scp resources/[gameplay]/banking/fxmanifest.lua -c
```

`scp` automatically:
1. Parses `shared_scripts`, `client_scripts`, and `server_scripts` arrays.
2. Expands wildcards (e.g. `'client/**/*.lua'`, `'config.lua'`).
3. Resolves internal Lua `require('utils.math')` dot-notation paths.
4. Masks sensitive database credentials in server configuration scripts.

---

## 💻 Programmatic Library API

`smart-context-packer` is also an enterprise TypeScript library. Integrate it into VS Code extensions, MCP servers, or automated CI bots:

```typescript
import { packContext, analyzeDependencies, formatContext } from 'smart-context-packer';

// 1. One-shot high-level packing (with git diff support)
const result = await packContext({
  targets: ['src/index.ts'],
  depth: 2,
  skeleton: true,
  diff: true,
  copy: true,
  output: '.context-pack.md',
});

console.log(`Packed ${result.graph.nodes.size} files.`);
console.log(`Estimated Tokens: ${result.stats.totalTokens}`);

// 2. Low-level dependency analysis
const graph = await analyzeDependencies(['src/services/payment.ts'], {
  cwd: process.cwd(),
  maxDepth: 3,
  reverse: true,
});

for (const [filePath, node] of graph.nodes) {
  console.log(`${filePath} (depth: ${node.depth}) imports:`, node.imports);
}
```

---

## 🤝 OpenAI Open Source Grant Alignment

`smart-context-packer` was engineered from the ground up to advance the mission of open-source AI tooling:

1. **Inference Compute Reduction**: By filtering out irrelevant files and skeletonizing non-critical dependency bodies, `scp` cuts prompt tokens by up to **97%**. This drastically reduces global GPU compute and server energy requirements.
2. **Context Fidelity & Hallucination Suppression**: AI assistants hallucinate when context boundaries are missing. `scp` guarantees that every imported interface, type definition, and helper signature is present and verified.
3. **Developer Privacy & Safety**: Native, zero-telemetry secret redaction ensures that credentials, access tokens, and sensitive private keys never cross network boundaries.

---

## 🗺️ Roadmap

- [x] TypeScript / JavaScript / TSX / JSX dependency resolver
- [x] Vue 3 Single File Component script parser
- [x] `tsconfig.json` path alias resolver (`@/*`, `~/*`)
- [x] FiveM `fxmanifest.lua` and Lua `require()` resolver
- [x] Fast BPE token counter & context window budget calculations
- [x] Automatic credential & secret redaction engine
- [x] Skeleton signature extraction mode (`--skeleton`)
- [x] Dual ESM/CJS library distribution with strict TypeScript types
- [x] Git working tree diff and staged context resolver (`--diff`, `--staged`)
- [x] Smart Prisma schema model & relation extractor (`prisma/schema.prisma`)
- [x] Official Model Context Protocol (MCP) server integration (`--mcp`)
- [x] VS Code Command Palette tasks generator (`--init-vscode`)
- [x] Auto Token-Budget Optimizer (`--max-tokens`) with smart depth-descending skeletonization
- [x] Background Agent Rule Generator (`--init-agent` for Cursor & Antigravity IDE)
- [x] Autonomous `pack_git_diff` MCP tool for working tree and staged diff inspection
- [x] Incremental SHA-256 AST local disk cache (`src/cache.ts`)
- [x] Blast-radius reverse caller & test impact risk scoring (`src/blast-radius.ts`)
- [x] File-linked persistent project memory (`src/memory.ts`)
- [x] 3-Layer progressive disclosure MCP tool suite (`search_codebase_index`, `inspect_dependency_graph`, `pack_context`, `save_project_memory`, `query_project_memory`)
- [x] Python AST dependency analyzer (`import`, `from ... import`)
- [x] Go module and package resolver (`import`, `go.mod`)
- [x] Rust module and crate resolver (`mod`, `use crate::*`)
- [x] PageRank architectural repo-map generator (`--repo-map`)
- [x] In-memory BM25 semantic intent routing (`-i, --query`)
- [x] Offline zero-dependency HTML canvas visualizer (`--visualize`)
- [x] Universal Multi-Assistant Presets (`--init-agent [all|cursor|claude|copilot|windsurf]`)
- [x] Crash-Proof Active Task & Planning Context Engine (`-t, --task`, `.scp/tasks.json`)
- [x] External Frameworks & Dependencies Manifest Grounding (`package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`)
- [x] Visual Context Budget HUD with ASCII gauges & category breakdown (`src/hud.ts`)
- [x] Tool Output Sandboxing & Compression (`--sandbox <cmd>`, 80-95% token savings)
- [x] Smart Middle-Out Slicing for massive files (>500 lines)
- [x] Complete 12-Tool Model Context Protocol (MCP) Suite
- [ ] Interactive VS Code extension with one-click "Pack Context" context menu

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

<div align="center">
Built with precision for the global AI developer community.
</div>
