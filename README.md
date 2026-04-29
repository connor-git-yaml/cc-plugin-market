# CC Plugin Market

<!-- spec-driver:section:badges -->
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![npm version](https://img.shields.io/npm/v/spectra-cli.svg)
![Version](https://img.shields.io/badge/version-4.1.1-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Node.js](https://img.shields.io/badge/Node.js-20.x+-339933)
<!-- spec-driver:section:badges:end -->

<!-- spec-driver:section:description -->
**Two complementary Claude Code plugins for Spec-Driven Development**: reverse-engineer existing code into structured specs + queryable knowledge graph (**Spectra**), and orchestrate new feature development through 8-mode autonomous workflows (**Spec Driver**).
<!-- spec-driver:section:description:end -->

## Table of Contents

- [What's inside](#whats-inside)
- [Project Milestones](#project-milestones)
- [Quick Start](#quick-start)
- [Spectra](#spectra)
  - [Highlights](#spectra-highlights)
  - [🤖 How AI Coding Assistants Use Spectra](#-how-ai-coding-assistants-use-spectra)
- [Spec Driver](#spec-driver)
  - [Highlights](#spec-driver-highlights)
- [Plugin Installation](#plugin-installation)
- [Documentation](#documentation)
- [Contributing](#contributing) · [License](#license)

<!-- spec-driver:section:plugins-overview -->

## What's inside

| Plugin | One-liner |
| ------ | --------- |
| **[Spectra](#spectra)** | Code → Spec + Knowledge Graph + MCP query tools (AI assistants get persistent architecture memory) |
| **[Spec Driver](#spec-driver)** | Idea → Spec → Plan → Code (autonomous SDD orchestrator with 8 modes + project-level workflow overrides) |

```text
┌──────────────────────────┐    ┌──────────────────────────────┐
│      Spectra              │    │       Spec Driver            │
│  (Reverse Engineer)       │    │  (Forward Orchestrator)      │
│                           │    │                              │
│  Code → Spec + Graph      │    │  Idea → Spec → Plan → Code  │
│  + MCP for AI assistants  │    │  + Per-project overrides     │
└──────────────────────────┘    └──────────────────────────────┘
```
<!-- spec-driver:section:plugins-overview:end -->

## Project Milestones

| Milestone | Status | Highlights | Docs |
|-----------|--------|------------|------|
| **M-100** Spectra Evolution | ✅ Delivered | reverse-spec → Spectra rebrand · panoramic Phase 1（多语言索引、跨包依赖、LLM 语义增强、多格式输出） | [blueprint](specs/M-100-spectra-evolution/blueprint.md) |
| **M-101** Phase 2 — Reading Platform | ✅ Delivered | Graph schema v2.0 + Hyperedges · LLM cost transparency · SpecStore + sourceKind · TODO/Open Questions extraction · Natural language Q&A + interactive `graph.html` · Default model upgrade to Sonnet 4.6 / Opus 4.7 1M | [blueprint](specs/M-101-phase2-reading-platform/blueprint.md) · [postmortem](specs/M-101-phase2-reading-platform/postmortem.md) |
| **M-102 / M-103** Phase 3 | 🟡 In Progress | Python AST function-level graph (v4.1) · E2E fixture infrastructure · large-project baseline · LLM concurrency optimizer | [proposal](specs/M-102-phase3/proposal.md) |

## Quick Start

```bash
# 1. Install Spectra CLI globally
npm install -g spectra-cli

# 2. Add the marketplace to Claude Code
claude plugin marketplace add cc-plugin-market https://github.com/connor-git-yaml/cc-plugin-market.git

# 3. Install both plugins (user-scope, available across all projects)
claude plugin install spectra@cc-plugin-market --scope user
claude plugin install spec-driver@cc-plugin-market --scope user

# 4. In any project, generate a Spec + Knowledge Graph
cd your-project/
spectra batch --mode reading --html       # ~2-5 min for typical project

# 5. Use Spec Driver for new features (in Claude Code)
/spec-driver:spec-driver-feature  Add OAuth2 login flow
```

After step 4, AI coding assistants (Claude Code, Cursor, Codex with MCP) can query your codebase architecture via 6 MCP tools — **see [How AI Coding Assistants Use Spectra](#-how-ai-coding-assistants-use-spectra) below**.

---

<!-- spec-driver:section:spectra -->

## Spectra

A hybrid AST + LLM pipeline that reverse-engineers source code into structured Spec documents and builds a persistent knowledge graph of architecture relationships. Multi-language (TS/JS/Python/Go/Java), multi-format export (Markdown / Obsidian Vault / interactive `graph.html`), MCP-queryable.

### Spectra Highlights

- 📝 **9-section module specs** — AST-extracted intent / interface / data / dependencies / quality / lifecycle / etc. (TS/JS interface 100% AST-extracted)
- 🌐 **Knowledge graph schema v2.0** — `references` / `conceptually_related_to` / `rationale_for` edges + multi-node hyperedges
- 🔍 **6 MCP query tools** — natural language graph queries that AI assistants can call directly
- 📊 **Interactive `graph.html`** — D3-force visualization with hyperedge convex hulls (self-contained, no server)
- 💰 **LLM cost transparency** — `--dry-run` cost preview + `--budget N` enforcement + `tokenUsage` in every spec frontmatter
- ⚡ **Lightweight modes** — `--mode reading` (skip product docs) / `--mode code-only` (skip all LLM, AST-only)
- 🚧 **Technical debt extraction** — TODO/FIXME/HACK code comments + design-doc Open Questions
- 🔄 **Continuous sync** — `spectra watch` (file watcher) or `spectra install` (post-commit hook)
- 🌍 **Multi-language** — TS/JS (ts-morph) + Python (AST + tree-sitter) + Go/Java/Rust (tree-sitter)
- 🎯 **Honest uncertainty** — `[inferred]` / `[unclear]` labels; raw source never sent directly to LLM
- 🔐 **Read-only safety** — writes limited to `specs/`, `_meta/`, `drift-logs/`

### 🤖 How AI Coding Assistants Use Spectra

The big idea: **Spectra builds a persistent architecture knowledge graph once, then any MCP-aware AI assistant queries it on demand** — no re-reading the entire codebase every session.

```text
   ┌─────────────────────┐      Step 1: Build once
   │   Your codebase     │      ───────────────────
   │   (any language)    │      $ spectra batch --html --hyperedges
   └──────────┬──────────┘             ↓
              │
              ▼
   ┌─────────────────────┐
   │  specs/             │      Persistent artifacts:
   │   ├── modules/      │      • 9-section module specs
   │   ├── project/      │      • technical-debt.md
   │   └── _meta/        │      • graph.json (schema v2.0)
   │       ├── graph.json│      • graph.html (D3 interactive)
   │       └── graph.html│      • GRAPH_REPORT.md (communities + god nodes)
   └──────────┬──────────┘
              │            Step 2: AI queries via MCP
              │            ─────────────────────────
              ▼
   ┌────────────────────────────────────────────────┐
   │  Claude Code / Cursor / Codex / Aider / ...    │
   │                                                 │
   │  User: "Where is auth handled?"                 │
   │                                                 │
   │  AI calls MCP graph_query("auth")               │
   │       ↓                                         │
   │  Returns: relevant module specs + dependencies  │
   │       ↓                                         │
   │  AI answers with cited specs + line numbers    │
   └────────────────────────────────────────────────┘
```

#### MCP query tools (6 + natural-language Q&A)

| Tool | Purpose | Example call |
|------|---------|-------------|
| `graph_query` | Keyword + BFS subgraph traversal | `graph_query({ question: "auth module", budget: 30 })` |
| `graph_node` | Single node details + neighbors | `graph_node({ id: "src/auth/login.ts" })` or `{ keyword: "login" }` |
| `graph_path` | Shortest dependency path between two nodes | `graph_path({ source: "cli/main.ts", target: "db/connection.ts" })` |
| `graph_community` | All members of a detected community | `graph_community({ communityId: "c-0" })` |
| `graph_god_nodes` | Top-degree hub nodes (core abstractions) | `graph_god_nodes({ topK: 10 })` |
| `graph_hyperedges` | Multi-node participation patterns | `graph_hyperedges({ filter: "ingestion" })` |

Plus the higher-level `panoramic-query` MCP tool with `natural-language` operation (Phase 2 F5):

```typescript
panoramic-query({
  operation: "natural-language",
  question: "What calls storage directly? What's the shortest path from parser to processor?",
  projectRoot: "."
})
// → Returns RAG-style answer with cited spec excerpts + line numbers + graph context
```

This is **AI-for-AI architecture memory**: the AI never has to re-read your codebase from scratch.

#### Why this matters

- **Token economics** — Querying a 50K-token graph instead of re-reading 500K LOC saves 90%+ tokens per session
- **Cross-session memory** — `_meta/graph.json` persists between Claude Code sessions; AI can ask "what changed since last time?"
- **Multi-IDE compatible** — Same MCP server works for Claude Code, Cursor, Codex, Aider, OpenCode, etc.
- **Hook-driven freshness** — `spectra install` registers a post-commit hook that incrementally rebuilds the graph; AI always queries the latest

#### Trigger via auto-injection (PreToolUse hook)

When `spectra install` is active, Claude Code's PreToolUse hook automatically injects relevant architecture summary **before** the AI runs `Grep` / `Glob` searches — so the AI knows the answer is in `specs/modules/auth.spec.md` before fanning out to read 30 source files.

📚 **Full details**: [`docs/spectra-cli-reference.md`](docs/spectra-cli-reference.md)

<!-- spec-driver:section:spectra:end -->

---

<!-- spec-driver:section:spec-driver -->

## Spec Driver

**Spec Driver** is a Claude Code plugin that serves as an autonomous development orchestrator. Automates the full Spec-Driven Development lifecycle through 14 specialized sub-agents, 6 quality gates, 8 execution modes, and project-level workflow overrides.

### Spec Driver Highlights

- 🎼 **8 execution modes** — `feature` / `implement` / `story` / `fix` / `refactor` / `resume` / `sync` / `doc`
- 🔬 **Parallel sub-agent dispatch** — RESEARCH_GROUP, DESIGN_PREP_GROUP, VERIFY_GROUP run in parallel; auto-fallback to serial
- 🚦 **6 quality gates** — `GATE_RESEARCH` / `GATE_DESIGN` / `GATE_ANALYSIS` / `GATE_TASKS` / `GATE_IMPLEMENT_MID` / `GATE_VERIFY`
- 🔧 **Per-project workflow overrides** — `.specify/orchestration-overrides.yaml` (like ESLint extends or Docker Compose override)
- 🎯 **Multi-runtime model compat** — Same configs work in Claude (Sonnet/Opus) and Codex (gpt-5.4 + thinking levels)
- 🛡️ **Quality reviews** — `spec-review` (compliance) + `quality-review` (architecture/readability) + `verify` (build/lint/test)

### Mode selection (TL;DR)

| Scenario | Command |
| -------- | ------- |
| New feature, major requirement | `/spec-driver:spec-driver-feature <desc>` |
| Mature spec/plan, just implement | `/spec-driver:spec-driver-implement` |
| Iterative change | `/spec-driver:spec-driver-story <desc>` |
| Bug fix | `/spec-driver:spec-driver-fix <desc>` |
| Large refactor | `/spec-driver:spec-driver-refactor <target>` |
| Resume interrupted work | `/spec-driver:spec-driver-resume` |
| Aggregate product spec | `/spec-driver:spec-driver-sync` |
| Generate open-source docs | `/spec-driver:spec-driver-doc` |

📚 **Full details**: [`docs/spec-driver-modes.md`](docs/spec-driver-modes.md) — all phases, sub-agents, generated artifacts.
📚 **Project-level workflow customization**: [`docs/configuration.md#per-project-orchestration-overrides`](docs/configuration.md#2-per-project-orchestration-overrides-specifyorchestration-overridesyaml) — override phases / gates / parallelism per project.

> **v4.0 Breaking Change**: The 9 atomic commands (`/spec-driver.specify` etc.) have been removed. See [migration guide](docs/migrations/skill-deprecation.md).

<!-- spec-driver:section:spec-driver:end -->

---

<!-- spec-driver:section:plugin-installation -->

## Plugin Installation

### Prerequisites

- [Claude Code](https://claude.com/claude-code) CLI installed and authenticated
- Node.js 20.x+

> Note: Plugin Marketplace commands are Claude Code specific.
> For Codex, use the CLI + skill installation flow in the [Codex section](#codex-support) below.

### Add the Marketplace

```bash
claude plugin marketplace add cc-plugin-market https://github.com/connor-git-yaml/cc-plugin-market.git
```

### Install Plugins

```bash
# Install to current project (recommended — scoped to this project only)
claude plugin install spec-driver@cc-plugin-market --scope project
claude plugin install spectra@cc-plugin-market --scope project

# Or install for current user (available across all projects)
claude plugin install spec-driver@cc-plugin-market --scope user
claude plugin install spectra@cc-plugin-market --scope user
```

### Update / Uninstall

```bash
# Refresh marketplace cache then reinstall to upgrade
claude plugin marketplace update cc-plugin-market
claude plugin install spec-driver@cc-plugin-market --scope <scope>

# Uninstall
claude plugin remove spec-driver --scope <scope>
claude plugin remove spectra --scope <scope>
```

### Verify

```bash
claude plugin list                                # list installed plugins
/spec-driver:spec-driver-doc                      # test spec-driver
/spectra src/                                     # test spectra
```

<!-- spec-driver:section:plugin-installation:end -->

### Codex Support

<details>
<summary>📦 Install for Codex (CLI + skills)</summary>

For Codex, install `spectra` CLI and register skills into `.codex/skills`:

```bash
# Install CLI
npm install -g spectra-cli

# Project-level Codex skills
spectra init --target codex

# Or global Codex skills
spectra init --global --target codex

# Install both Claude + Codex skills in one command
spectra init --global --target both

# Optional: control npm postinstall target with env var
SPECTRA_SKILL_TARGET=codex npm install -g spectra-cli   # values: claude | codex | both
```

Spec Driver uses an independent Codex entrypoint (parallel to Spectra):

```bash
# Run from repository root
npm run codex:spec-driver:install                 # project-level
npm run codex:spec-driver:install:global          # global
npm run codex:spec-driver:remove                  # remove

# Equivalent low-level scripts
bash plugins/spec-driver/scripts/codex-skills.sh install [--global]
```

Notes:
- Project mode installs to the current git repository root (or current directory when not in a git repo).
- Codex skills are generated from the current `spec-driver-*` source skills with a small Codex runtime adapter block; rerun `install` after upgrading Spec Driver.

</details>

---

## Documentation

- 📘 **[Spectra CLI Reference](docs/spectra-cli-reference.md)** — full command list, knowledge graph workflows, architecture pipeline diagram
- 🎼 **[Spec Driver Modes](docs/spec-driver-modes.md)** — 8 modes detailed, sub-agents, generated artifacts, quality gates
- ⚙️ **[Configuration](docs/configuration.md)** — model presets (`spec-driver.config.yaml`) + project-level orchestration overrides (`.specify/orchestration-overrides.yaml`)
- 🏛️ **[Repository Architecture](docs/repository-architecture.md)** — `src/` layout, tech stack, testing, sync contracts
- 🤝 **[Contributor Guide](docs/contributor-guide.md)** — full contribution flow
- 📜 **[Migration Guides](docs/migrations/)** — v4.0 atomic skill removal, orchestration overrides
- 🎯 **[Project Milestones](specs/)** — M-100 / M-101 / M-102+ blueprints and postmortems

<!-- spec-driver:section:contributing -->

## Contributing

Bug reports and pull requests are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [`docs/contributor-guide.md`](docs/contributor-guide.md) for full guidelines including the `repo:check` validation requirements.

<!-- spec-driver:section:contributing:end -->

<!-- spec-driver:section:license -->

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

<!-- spec-driver:section:license:end -->
