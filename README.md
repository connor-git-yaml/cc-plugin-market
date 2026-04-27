# CC Plugin Market

<!-- spec-driver:section:badges -->
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![npm version](https://img.shields.io/npm/v/spectra-cli.svg)
![Version](https://img.shields.io/badge/version-4.0.0-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Node.js](https://img.shields.io/badge/Node.js-20.x+-339933)
<!-- spec-driver:section:badges:end -->

<!-- spec-driver:section:description -->
A curated collection of Claude Code plugins for Spec-Driven Development. This repository ships two complementary products that cover the full software development lifecycle — from reverse-engineering existing code into specifications, to orchestrating new feature development through structured workflows.
<!-- spec-driver:section:description:end -->

<!-- spec-driver:section:plugins-overview -->
## Plugins

| Plugin | Type | Description |
| ------ | ---- | ----------- |
| **[Spectra](#spectra)** | CLI + MCP + Skills | Reverse-engineers legacy code into structured Spec documents via AST + LLM hybrid pipeline; builds a persistent knowledge graph, detects architecture communities, and exports to Obsidian Vault or HTML interactive visualization |
| **[Spec Driver](#spec-driver)** | Plugin (Agents + Skills) | Autonomous development orchestrator — automates the full SDD lifecycle with 15 specialized sub-agent prompts, 8 execution modes, orchestration.yaml config, and 6 quality gates |

```text
┌─────────────────────────────────────────────────────────────────┐
│                       CC Plugin Market                          │
│                                                                 │
│  ┌──────────────────────┐     ┌──────────────────────────────┐  │
│  │      Spectra           │     │        Spec Driver           │  │
│  │  (Reverse Engineer)   │     │  (Forward Orchestrator)      │  │
│  │                       │     │                              │  │
│  │  Code → Spec + Graph  │     │  Idea → Spec → Plan → Code  │  │
│  │                       │     │                              │  │
│  │  • generate / batch   │     │  • feature / story / fix     │  │
│  │  • diff / prepare     │     │  • implement / resume        │  │
│  │  • graph / community  │     │  • sync / doc / refactor     │  │
│  │  • export / watch     │     │  • orchestration.yaml        │  │
│  │  • MCP server         │     │                              │  │
│  │  • CLI + Skills       │     │                              │  │
│  └──────────────────────┘     └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```
<!-- spec-driver:section:plugins-overview:end -->

## Project Milestones

| Milestone | Status | Highlights | Docs |
|-----------|--------|------------|------|
| **M-100** Spectra Evolution | ✅ Delivered | reverse-spec → Spectra rebrand · panoramic Phase 1（多语言索引、跨包依赖、LLM 语义增强、多格式输出） | [blueprint](specs/M-100-spectra-evolution/blueprint.md) |
| **M-101** Phase 2 — Reading Platform | ✅ Delivered | 图能力上首屏 · LLM 成本透明（`--budget` / `--dry-run`）· SpecStore + sourceKind · TODO/Open Questions 提取 · graph schema v2.0 + Hyperedges · 自然语言问答 + `graph.html` 交互可视化 · 默认 model 升级 Sonnet 4.6 / Opus 4.7 1M | [blueprint](specs/M-101-phase2-reading-platform/blueprint.md) · [postmortem](specs/M-101-phase2-reading-platform/postmortem.md) |
| **M-102** Phase 3 — TBD | 🟡 Proposal | 候选方向：F6 Graphify 集成 / 大项目实战优化 / spec-driver 平台化深化 / AI for AI（多 runtime） | [proposal](specs/M-102-phase3/proposal.md) |

<!-- spec-driver:section:plugin-installation -->
## Plugin Installation

### Prerequisites

- [Claude Code](https://claude.com/claude-code) CLI installed and authenticated

> Note: Plugin Marketplace commands above are Claude Code specific.  
> For Codex, use the CLI + skill installation flow in the **Codex Support** section below.

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

### Update Plugins

```bash
# Refresh marketplace cache to get latest versions
claude plugin marketplace update cc-plugin-market

# Then reinstall to upgrade
claude plugin install spec-driver@cc-plugin-market --scope project
```

### Uninstall Plugins

```bash
# Remove from current project
claude plugin remove spec-driver --scope project
claude plugin remove spectra --scope project

# Remove from user scope
claude plugin remove spec-driver --scope user
claude plugin remove spectra --scope user
```

### Verify Installation

After installation, the plugin skills become available in Claude Code:

```bash
# List installed plugins
claude plugin list

# Test spec-driver skills
/spec-driver:spec-driver-doc

# Test spectra skills
/spectra src/
```
<!-- spec-driver:section:plugin-installation:end -->

### Codex Support

For Codex, install `spectra` CLI and register spectra skills into `.codex/skills`:

```bash
# Install CLI
npm install -g spectra-cli

# Project-level Codex skills
spectra init --target codex

# Or global Codex skills
spectra init --global --target codex
```

Install both Claude + Codex skills in one command:

```bash
spectra init --global --target both
```

Optional: control npm postinstall target with environment variable:

```bash
SPECTRA_SKILL_TARGET=codex npm install -g spectra-cli
# values: claude | codex | both
```

Spec Driver uses an independent Codex entrypoint (parallel to Spectra):

```bash
# Run from repository root

# Install Spec Driver Codex wrapper skills (project-level)
npm run codex:spec-driver:install

# Install globally
npm run codex:spec-driver:install:global

# Remove
npm run codex:spec-driver:remove
```

Equivalent low-level script commands:

```bash
bash plugins/spec-driver/scripts/codex-skills.sh install
bash plugins/spec-driver/scripts/codex-skills.sh install --global
bash plugins/spec-driver/scripts/codex-skills.sh remove
bash plugins/spec-driver/scripts/codex-skills.sh remove --global
```

Notes:
- Project mode installs to the current git repository root (or current directory when not in a git repo).
- Codex skills are generated from the current `spec-driver-*` source skills with a small Codex runtime adapter block; rerun `install` after upgrading Spec Driver to refresh them.

---

<!-- spec-driver:section:spectra -->
## Spectra

A hybrid AST + LLM pipeline that reverse-engineers source code into structured Spec documents and builds a persistent knowledge graph of architecture relationships. It supports single-module spec generation, full-project batch processing, multi-language projects (TS/JS/Python/Go/Java), panoramic documentation (API, architecture, runtime, event surface, ADR), and multi-format export — including Obsidian Vault with bidirectional links and HTML interactive visualization.

### Features

- **Single Module Spec Generation** (`generate`) — Complete nine-section spec documents; TS/JS interface definitions 100% AST-extracted
- **Batch Project Processing** (`batch`) — Dependency-topology-ordered generation with checkpoint recovery and architecture index; supports `--incremental` to only regenerate affected modules
- **Spec Drift Detection** (`diff`) — AST structural diff + LLM semantic evaluation, three severity levels, automatic noise filtering
- **AST Preprocessing** (`prepare`) — AST analysis + context assembly without LLM calls, no auth required
- **Knowledge Graph** (`graph`) — Builds a unified `_meta/graph.json` merging architecture-ir, doc-graph, and cross-reference-index; confidence labels, NetworkX compatible
- **Community Detection** (`community`) — Louvain community detection on the knowledge graph; outputs `GRAPH_REPORT.md` with community list, God Node hotspots, and anomalous edges
- **Multi-Format Export** (`export`) — Obsidian Vault (bidirectional `[[links]]` + frontmatter + Graph View compatible) and HTML interactive visualization
- **File Watch Incremental Sync** (`watch`) — Monitors source files and incrementally rebuilds specs and graph on change; debounced, graceful SIGINT exit
- **Content Hash Cache** (`cache`) — SHA256 content hashing for sub-30s re-batch on small changes; cache hit rate >90% on typical incremental runs
- **MCP Graph Query Tools** — 5 tools exposed over stdio MCP server: `graph_query` (natural language), `graph_node`, `graph_path`, `graph_community`, `graph_stats`
- **Panoramic Documentation** — 10+ generator types: API surface, runtime, architecture IR, event surface, fault analysis, ADR, quality report, product/UX docs, docs bundle
- **PreToolUse & Post-commit Hooks** (`install`) — Injects architecture summary before Claude Code searches; triggers incremental graph update on git commit
- **Dual Authentication** — API Key direct connection and Claude CLI subscription proxy, auto-detected
- **Hybrid Pipeline** — Three-phase engine (preprocessing → context assembly → generation); raw source code never directly sent to LLM
- **Honest Uncertainty Labeling** — Inferred content marked `[inferred]`, ambiguous code marked `[unclear]`
- **Read-Only Safety** — All commands strictly read-only; writes limited to `specs/`, `_meta/`, and `drift-logs/`

### Getting Started

**Prerequisites:** Node.js 20.x+, and one of:

- **API Key**: Set `ANTHROPIC_API_KEY` environment variable (takes priority)
- **Claude CLI**: Install and log in to Claude Code (`claude auth login`)

**Install globally (recommended):**

```bash
npm install -g spectra-cli
```

After installation, `spectra` CLI is available globally, and skills are auto-registered to Claude Code by default.  
If Codex is detected (`~/.codex` exists), Codex skill registration is also attempted automatically.

**Or from source:**

```bash
git clone https://github.com/connor-git-yaml/cc-plugin-market.git
cd spectra
npm install && npm run build
```

### CLI Usage

```bash
# Single module spec generation
spectra generate src/auth/ --deep

# AST preprocessing only (no LLM, no auth required)
spectra prepare src/auth/ --deep

# Batch spec generation for entire project
spectra batch --force

# Lightweight reading mode — skip product-doc generators, faster batch (F5)
spectra batch --mode=reading

# Pure AST mode — skip all LLM inference (F5)
spectra batch --mode=code-only

# Generate interactive graph.html visualization after batch (F5)
spectra batch --html
spectra batch --mode=reading --html

# Spec drift detection
spectra diff specs/auth.spec.md src/auth/

# Custom output directory
spectra generate src/auth/ --output-dir out/

# Check authentication status
spectra auth-status --verify

# Install skills to current project / globally
spectra init [--global] [--target claude|codex|both]

# Remove installed skills
spectra init --remove [--target claude|codex|both]

# Build persistent knowledge graph (_meta/graph.json)
spectra graph

# Community detection — outputs GRAPH_REPORT.md
spectra community

# Export to Obsidian Vault (bidirectional links + frontmatter + Graph View compatible)
spectra export --format obsidian --output obsidian-vault/

# Export to HTML interactive visualization
spectra export --format html --output docs/graph.html

# Watch for file changes and incrementally sync specs and graph
spectra watch

# Cache management
spectra cache --list
spectra cache --clear
```

### Knowledge Graph & Visualization

Spectra builds a unified knowledge graph (`_meta/graph.json`) from all generated docs and architecture analysis. This graph powers community detection, architecture insights, multi-format export, and MCP real-time queries.

#### Step 1 — Build the Graph

Run after `spectra batch` to merge architecture-ir, doc-graph, and cross-reference-index:

```bash
spectra batch          # generate or refresh all module specs first
spectra graph          # builds _meta/graph.json
```

#### Step 2 — Community Detection & Architecture Insights

```bash
spectra community
```

Outputs `_meta/GRAPH_REPORT.md` containing:
- Detected communities (logical subsystems found by Louvain algorithm)
- God Node hotspots (over-coupled modules)
- Anomalous edges (unexpected cross-boundary dependencies)
- Architecture health summary

#### Step 3 — Export to Obsidian Vault

```bash
spectra export --format obsidian --output obsidian-vault/
```

Each spec becomes an Obsidian note with:
- `[[bidirectional links]]` to related modules
- YAML frontmatter (module, language, spec version, community label)
- Graph View compatible — open the vault in Obsidian and use **Graph View** to visually navigate architecture relationships

Open the exported vault in Obsidian:
1. **File → Open Vault…** → select the `obsidian-vault/` directory
2. Open **Graph View** (Ctrl/Cmd+G) to explore module relationships interactively
3. Use the community labels in the frontmatter to filter by subsystem

#### Step 4 — HTML Interactive Visualization

```bash
spectra export --format html --output docs/graph.html
```

Generates a self-contained HTML file with a D3-force interactive graph:
- Pan, zoom, and click nodes for module details
- Color-coded by community
- No server required — open directly in a browser or host on any static site

#### Continuous Sync

Keep docs and graph fresh automatically:

```bash
# Watch mode — debounced incremental rebuild on file change
spectra watch

# Or install post-commit hook (triggers after every git commit)
spectra install
```

#### MCP Graph Query (Claude Code)

With `spectra mcp-server` running, Claude Code can query the knowledge graph directly:

| Tool | Usage |
|------|-------|
| `graph_query` | Natural language query: "which modules depend on auth?" |
| `graph_node` | Exact node details by module path |
| `graph_path` | Shortest dependency path between two modules |
| `graph_community` | All members and metrics for a detected community |
| `graph_stats` | Global graph statistics (node count, edge count, density) |

These tools are invoked automatically by Claude Code when `spectra install` hooks are active, injecting architecture context before code searches.

---

### Claude Code Skills

```bash
/spectra src/auth/                               # Single module spec
/spectra-batch                                   # Full project batch
/spectra-diff specs/auth.spec.md src/auth/       # Drift detection
```

### Codex Skills

In Codex, after `spectra init --target codex`, these skills are available:

- `spectra`
- `spectra-batch`
- `spectra-diff`

### Architecture

```text
SourceFile(s)
    ↓  [ast-analyzer]                     ← Phase 1: Preprocessing
CodeSkeleton
    ↓  [context-assembler]                ← Phase 2: Context Assembly
    │   + secret-redactor (redaction)
    │   + token-counter (≤100k budget)
    │
    ├── prepare mode → stdout (no auth)
    │
LLM Prompt
    ↓  [llm-client → auth-detector]       ← Phase 3: Generation
    │   ├── API Key → @anthropic-ai/sdk
    │   └── CLI proxy → spawn claude
ModuleSpec → specs/*.spec.md
    ↓  [graph-builder]                    ← Phase 4: Knowledge Graph
_meta/graph.json  (architecture-ir + doc-graph + cross-reference-index)
    ├── spectra community  → _meta/GRAPH_REPORT.md
    ├── spectra export --format obsidian  → obsidian-vault/  (Graph View)
    ├── spectra export --format html      → graph.html  (D3-force interactive)
    └── MCP graph_query / graph_node / graph_path / graph_community / graph_stats
```
<!-- spec-driver:section:spectra:end -->

---

<!-- spec-driver:section:spec-driver -->
## Spec Driver

**Spec Driver** is a Claude Code plugin that serves as an autonomous development orchestrator. It automates the full Spec-Driven Development lifecycle through 14 specialized sub-agent prompts, 5 quality gates, 7 execution modes, shared Project Context resolution, Project Context suggestions, canonical project-context initialization, wrapper source-of-truth contracts, release contracts, and parallel sub-agent dispatch for accelerated execution.

### How It Works

```text
Constitution → Research → Specify → Clarify → Plan → Tasks → Implement → Verify
  (Phase 0)   (Phase 1)  (Phase 2) (Phase 3) (Phase 4) (Phase 5) (Phase 6) (Phase 7)
                 ║                    ║                                        ║
            [RESEARCH_GROUP]   [DESIGN_PREP_GROUP]                      [VERIFY_GROUP]
            product-research   clarify + checklist                     spec-review
                  +                (parallel)                        + quality-review
            tech-research                                              (parallel)
              (parallel)                                                  ↓
                                                                       verify
```

Each phase is handled by a dedicated sub-agent with scoped permissions. The orchestrator manages context passing, quality gates, parallel dispatch, and failure recovery automatically. Independent sub-agents within a phase are dispatched in parallel to reduce total execution time, with automatic serial fallback if parallel dispatch fails.

### Setup

Spec Driver keeps a single workflow source under `plugins/spec-driver/skills/*/SKILL.md`, with parallel installation entrypoints:

- Claude Code: distributed as a plugin and auto-registered when the project is opened in Claude Code
- Codex: install wrapper skills from repository root via `npm run codex:spec-driver:install` (or `npm run codex:spec-driver:install:global`)

Codex wrapper generation is governed by `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`; generated files under `.codex/skills/spec-driver-*/SKILL.md` should be refreshed via install, not edited directly.

To initialize Spec Driver in a new project (Claude Code):

```bash
# Creates .specify/ directory, project-context.yaml, constitution.md, and spec-driver.config.yaml
/spec-driver:spec-driver-feature "your feature description"
# The first run will auto-initialize the project structure
```

### Orchestration Modes

Choose the right mode based on your scenario:

| Scenario | Command | Phases | Human Interaction |
| -------- | ------- | ------ | ----------------- |
| New feature, major requirement | `/spec-driver:spec-driver-feature <desc>` | 10 | ≤5 |
| Mature spec/plan, direct implementation | `/spec-driver:spec-driver-implement [<feature>]` | 6 | ≤2 |
| Feature iteration, requirement change | `/spec-driver:spec-driver-story <desc>` | 5 | ≤2 |
| Bug fix, issue resolution | `/spec-driver:spec-driver-fix <desc>` | 4 | ≤1 |
| Resume interrupted workflow | `/spec-driver:spec-driver-resume` | Variable | 0 |
| Aggregate product specification | `/spec-driver:spec-driver-sync` | 3 | 0 |
| Generate open-source docs | `/spec-driver:spec-driver-doc` | 7 | 2-3 |

#### Feature Mode — Full 10-Phase Orchestration

```bash
/spec-driver:spec-driver-feature "Add user authentication with OAuth2"
/spec-driver:spec-driver-feature --research tech-only "Migrate from Express to Fastify"
```

Supports 6 research modes (`full`, `tech-only`, `product-only`, `codebase-scan`, `skip`, `custom`) with smart recommendation based on requirement analysis.

1. **Constitution** — Validate against project principles
2. **Product Research + Tech Research** — Parallel dispatch in `full` mode (RESEARCH_GROUP)
3. **Research Synthesis** — Product × Technology decision matrix
4. **Specify** — Generate structured requirement specification
5. **Clarify + Checklist** — Parallel dispatch (DESIGN_PREP_GROUP), resolve ambiguities + quality check
6. **Plan** — Technical architecture and implementation design
7. **Tasks + Analyze** — Dependency-ordered task breakdown, cross-artifact consistency analysis
8. **Implement** — Execute tasks with code generation
9. **Spec Review + Quality Review** — Parallel dispatch (VERIFY_GROUP)
10. **Verify** — Build, lint, and test validation

#### Story Mode — Quick 5-Phase

```bash
/spec-driver:spec-driver-story "Add dark mode toggle to settings page"
```

Skips research phases — analyzes existing code context instead. Ideal for iterative changes and requirement updates.

#### Fix Mode — Rapid 4-Phase

```bash
/spec-driver:spec-driver-fix "Login fails when email contains '+' character"
```

Rapid diagnosis → root cause analysis → targeted fix → verification. Auto-syncs specs after fix.

#### Resume Mode — Interrupted Workflow Recovery

```bash
/spec-driver:spec-driver-resume
```

No arguments needed. Automatically scans existing artifacts, detects the breakpoint, and continues from where the workflow was interrupted.

#### Sync Mode — Product Spec Aggregation

```bash
/spec-driver:spec-driver-sync
```

Aggregates individual feature specs from `specs/` into a unified product-level `current-spec.md`. Fully automatic, zero human interaction.

#### Doc Mode — Open-Source Documentation

```bash
/spec-driver:spec-driver-doc
```

Interactive generation of README.md, LICENSE, CONTRIBUTING.md, and CODE_OF_CONDUCT.md with conflict detection and backup.

### Orchestrator Skill Commands

All phases are orchestrated end-to-end by the following skills. To selectively re-run an earlier phase, use `/spec-driver:spec-driver-resume`; to re-plan from scratch, re-invoke `/spec-driver:spec-driver-feature`:

```bash
# Create or update project constitution (single-phase skill)
/spec-driver:spec-driver-constitution

# Full spec-driven flow: specify → clarify → plan → tasks → implement → verify
/spec-driver:spec-driver-feature <需求描述>

# Fast path without research: specify → plan → tasks → implement → verify
/spec-driver:spec-driver-story <需求描述>

# Run only the implement phase (spec.md + plan.md + tasks.md already exist)
/spec-driver:spec-driver-implement

# Resume an interrupted spec-driver run from its last artifact (e.g. plan.md / tasks.md missing)
/spec-driver:spec-driver-resume

# Large-scale refactor: impact analysis → batched planning → iterative implement
/spec-driver:spec-driver-refactor <重构目标>

# Quick bug fix: diagnose → plan → fix → verify
/spec-driver:spec-driver-fix <问题描述>

# Generate README / LICENSE / CONTRIBUTING / CODE_OF_CONDUCT
/spec-driver:spec-driver-doc

# Aggregate feature specs into product-level current-spec.md + catalog
/spec-driver:spec-driver-sync
```

> **v4.0 变更**：9 个原子命令 `/spec-driver.{specify,plan,tasks,implement,clarify,analyze,checklist,constitution,taskstoissues}` 已于 v4.0 删除。完整映射与迁移步骤见 [`docs/migrations/skill-deprecation.md`](docs/migrations/skill-deprecation.md)。

### Sub-Agents

| Agent | Phase | Responsibility | Dispatch | Permissions |
| ----- | ----- | -------------- | -------- | ----------- |
| constitution | 0 | Project principle validation | Serial | Read |
| product-research | 1a | Market needs, competitor analysis | Parallel (RESEARCH_GROUP) | WebSearch, Read, Glob, Grep |
| tech-research | 1b | Architecture options, technology evaluation | Parallel (RESEARCH_GROUP) | WebSearch, Read, Glob, Grep |
| specify | 2 | Structured requirement specification | Serial | Read, Write, Bash |
| clarify | 3 | Ambiguity detection and resolution | Parallel (DESIGN_PREP_GROUP) | Read, Bash |
| checklist | 3.5 | Specification quality checklist | Parallel (DESIGN_PREP_GROUP) | Read, Bash |
| plan | 4 | Technical architecture and design | Serial | Read, Write, Bash |
| tasks | 5 | Task decomposition and dependency ordering | Serial | Read, Write, Bash |
| analyze | 5.5 | Cross-artifact consistency analysis | Serial | Read, Bash |
| implement | 6 | Contract-check mature spec/plan, then implement per task list | Serial | Read, Write, Bash, WebFetch |
| spec-review | 7a | Spec compliance review | Parallel (VERIFY_GROUP) | Read, Glob, Grep |
| quality-review | 7b | Code quality review incl. architecture rationality and readability | Parallel (VERIFY_GROUP) | Read, Glob, Grep |
| verify | 7c | Build, lint, and test validation | Serial (after 7a+7b) | Bash, Read, Write |
| sync | — | Product specification aggregation | Serial | Read, Write, Bash, Glob |

### Generated Artifacts

All artifacts are written to `specs/<feature-id>/`:

| Artifact | Description |
| -------- | ----------- |
| `spec.md` | Structured requirement specification |
| `plan.md` | Technical architecture and implementation plan |
| `tasks.md` | Dependency-ordered task breakdown |
| `research-synthesis.md` | Product × Technology research summary |
| `verification-report.md` | Build/lint/test verification results |
| `current-spec.md` | Aggregated product-level specification (via sync) |

### Configuration

Customize behavior via `spec-driver.config.yaml` in the project root:

```yaml
# Model presets: balanced (default) | quality-first | cost-efficient
preset: balanced

# Optional: override model per agent (keep commented to follow preset by default)
agents:
  # specify:
  #   model: opus
  # implement:
  #   model: sonnet

# Cross-runtime model compatibility (Claude / Codex)
model_compat:
  runtime: auto  # auto | claude | codex
  aliases:
    codex:
      opus: gpt-5.4
      sonnet: gpt-5.4
    claude:
      gpt-5.4: sonnet
      gpt-5: opus
      gpt-5-mini: sonnet
      o3: opus
      o4-mini: sonnet
  defaults:
    codex: gpt-5.4
    claude: sonnet

# Codex service tier
codex:
  service_tier: fast  # fast | standard | flex

# Codex thinking level (use one model + adjust effort)
codex_thinking:
  default_level: xhigh  # low | medium | high | xhigh
  level_map:
    opus: xhigh
    sonnet: medium
    haiku: low

# Gate policy: strict | balanced | autonomous
gate_policy: balanced

# Research mode: auto | full | tech-only | product-only | codebase-scan | skip
research:
  default_mode: auto

# Retry policy
retry:
  max_attempts: 2

# Verification commands (auto-detected if omitted)
verification:
  commands:
    build: "npm run build"
    lint: "npm run lint"
    test: "npm test"
```

**Model presets:**

| Preset | Research/Specify/Plan/Analyze | Clarify/Checklist/Tasks/Implement/Verify |
| ------ | ----------------------------- | ---------------------------------------- |
| `balanced` (default) | Opus | Sonnet |
| `quality-first` | Opus | Opus |
| `cost-efficient` | Sonnet | Sonnet |

When running in Codex, Spec Driver keeps `opus/sonnet` semantics but maps both to `gpt-5.4`; depth is controlled by `codex_thinking` levels (`low` / `medium` / `high` / `xhigh`).

`spectra` CLI (`generate` / `batch` / `diff`) now follows the same model config source:

- Priority: `SPECTRA_MODEL` > `spec-driver.config.yaml agents.specify.model` > `spec-driver.config.yaml preset` > built-in default
- Config discovery: current directory upward search for `spec-driver.config.yaml`, then `.specify/spec-driver.config.yaml`

### Per-Project Orchestration Overrides

Customize phase sequences, gate behaviors, and concurrency per project via `.specify/orchestration-overrides.yaml` — like ESLint `extends` or Docker Compose `override.yml`. Plugin base `orchestration.yaml` stays untouched; you only override what differs.

Typical scenarios:
- High-risk projects: force all gates to `pause` for human approval
- Low-risk projects: auto-skip `GATE_VERIFY` to ship faster
- CI environments: lower `parallel_scheduling.max_concurrent_tasks` to 1

Inspect the merged effective config:

```bash
node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --annotate
```

Full guide: [docs/migrations/orchestration-overrides.md](docs/migrations/orchestration-overrides.md)

### Supported Verification Languages

JS/TS (npm/pnpm/yarn/bun), Rust (Cargo), Go, Python (pip/poetry/uv), Java (Maven/Gradle), Kotlin, Swift (SPM), C/C++ (CMake/Make), C# (.NET), Elixir (Mix), Ruby (Bundler)
<!-- spec-driver:section:spec-driver:end -->

---

<!-- spec-driver:section:project-structure -->
## Project Structure

```text
src/                               # Spectra TypeScript source
├── core/                          # Core analysis pipeline
│   ├── ast-analyzer.ts            # ts-morph AST → CodeSkeleton
│   ├── tree-sitter-fallback.ts    # AST fault-tolerant fallback
│   ├── context-assembler.ts       # Skeleton + deps → LLM prompt
│   ├── llm-client.ts              # Claude API client (retry, parsing)
│   ├── single-spec-orchestrator.ts # Single module generation orchestrator
│   ├── secret-redactor.ts         # Sensitive info redaction
│   └── token-counter.ts           # Token budget management
├── graph/                         # Dependency graph
│   ├── dependency-graph.ts        # dependency-cruiser wrapper
│   ├── topological-sort.ts        # Topological sort + Tarjan SCC
│   └── mermaid-renderer.ts        # Mermaid dependency graph generation
├── diff/                          # Diff engine
│   ├── structural-diff.ts         # CodeSkeleton structural comparison
│   ├── semantic-diff.ts           # LLM behavioral change assessment
│   ├── noise-filter.ts            # Whitespace/comment noise filtering
│   └── drift-orchestrator.ts      # Drift detection orchestrator
├── generator/                     # Spec generation & output
│   ├── spec-renderer.ts           # Handlebars nine-section renderer
│   ├── frontmatter.ts             # YAML frontmatter + versioning
│   ├── mermaid-class-diagram.ts   # Mermaid class diagram generation
│   └── index-generator.ts         # _index.spec.md generation
├── batch/                         # Batch processing
│   ├── batch-orchestrator.ts      # Batch spec generation
│   ├── progress-reporter.ts       # Terminal progress display
│   └── checkpoint.ts              # Checkpoint recovery state
├── models/                        # Zod schema type definitions
├── utils/                         # Utility functions
├── installer/                     # Skill installer/uninstaller
├── auth/                          # Auth detection & proxy
├── mcp/                           # MCP Server
├── cli/                           # CLI entry & subcommands
└── scripts/                       # npm lifecycle scripts

plugins/                           # Claude Code plugins
├── spectra/                       # Spectra MCP plugin
│   ├── contracts/                 # Spectra skill source contracts
│   ├── skills/                    # Canonical spectra skill source
│   └── scripts/                   # Skill sync / validation / lifecycle
└── spec-driver/                   # Spec Driver orchestrator
    ├── .claude-plugin/plugin.json # Plugin metadata
    ├── agents/                    # 14 specialized sub-agent prompts
    │   ├── constitution.md        # Phase 0: Principle validation
    │   ├── product-research.md    # Phase 1a: Market research
    │   ├── tech-research.md       # Phase 1b: Technology evaluation
    │   ├── specify.md             # Phase 2: Requirement specification
    │   ├── clarify.md             # Phase 3: Ambiguity resolution
    │   ├── checklist.md           # Phase 3.5: Quality checklist
    │   ├── plan.md                # Phase 4: Technical planning
    │   ├── tasks.md               # Phase 5: Task decomposition
    │   ├── analyze.md             # Phase 5.5: Consistency analysis
    │   ├── implement.md           # Phase 6: Code implementation
    │   ├── spec-review.md         # Phase 7a: Spec compliance review
    │   ├── quality-review.md      # Phase 7b: Code quality review
    │   ├── verify.md              # Phase 7c: Build/lint/test verification
    │   └── sync.md                # Product spec aggregation
    ├── skills/                    # 7 execution mode definitions
    │   ├── spec-driver-feature/       # Full 10-phase orchestration
    │   ├── spec-driver-implement/     # Mature spec/plan focused delivery
    │   ├── spec-driver-story/         # Quick 5-phase iteration
    │   ├── spec-driver-fix/           # Rapid 4-phase bug fix
    │   ├── spec-driver-resume/        # Interrupted workflow recovery
    │   ├── spec-driver-sync/          # Product spec aggregation
    │   └── spec-driver-doc/           # Open-source doc generation
    ├── contracts/                 # Wrapper source-of-truth contracts
    ├── templates/                 # Report and config templates
    └── scripts/                   # Initialization and scanning scripts

templates/                         # Handlebars output templates
├── module-spec.hbs                # Nine-section spec template
├── index-spec.hbs                 # Architecture index template
└── drift-report.hbs               # Drift report template

src/skills-global/                 # Generated published compatibility mirrors
├── spectra/SKILL.md
├── spectra-batch/SKILL.md
└── spectra-diff/SKILL.md

skills/                            # Generated repo-local compatibility mirrors
├── spectra/SKILL.md
├── spectra-batch/SKILL.md
└── spectra-diff/SKILL.md

tests/                             # Test suite (313 cases)
├── unit/                          # 30 unit test files
├── integration/                   # 7 integration test files
├── golden-master/                 # Golden Master structural similarity tests
└── self-hosting/                  # Self-hosting tests (analyze itself)
```
<!-- spec-driver:section:project-structure:end -->

<!-- spec-driver:section:tech-stack -->
## Tech Stack

### Spectra Stack

| Category | Technology |
| -------- | --------- |
| Language / Runtime | TypeScript 5.x, Node.js LTS (20.x+) |
| AST Engine | [ts-morph](https://github.com/dsherret/ts-morph) (primary), [tree-sitter](https://tree-sitter.github.io/) + tree-sitter-typescript (fallback) |
| Dependency Analysis | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) |
| Template Engine | [Handlebars](https://handlebarsjs.com/) |
| Data Validation | [Zod](https://zod.dev/) |
| Diagram Generation | Mermaid (embedded in Markdown) |
| AI Model | Claude 4.5/4.6 Sonnet/Opus (via Anthropic API or Claude CLI proxy) |
| MCP Integration | [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) |
| Testing | [Vitest](https://vitest.dev/) (unit / integration / golden master / self-hosting) |

### Spec Driver Stack

| Category | Technology |
| -------- | --------- |
| Plugin Format | Markdown prompts + Bash scripts + YAML configuration |
| Runtime | Claude Code sandbox (no external runtime dependencies) |
| Agent System | 14 specialized sub-agent prompts with scoped tool permissions |
| Configuration | YAML (`spec-driver.config.yaml`) with 3 model presets |
| Templates | Markdown templates for research reports, specs, and verification |
<!-- spec-driver:section:tech-stack:end -->

<!-- spec-driver:section:testing -->
## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Type checking
npm run lint
```

The project includes a 4-tier testing system with 313 test cases:

| Tier | Files | Cases | Coverage |
| ---- | ----- | ----- | -------- |
| Unit | 30 | 259 | Individual module functionality |
| Integration | 7 | 40 | End-to-end pipeline + drift detection + CLI e2e |
| Golden Master | 1 | 9 | AST extraction precision ≥ 90% structural similarity |
| Self-Hosting | 1 | 5 | Project analyzes itself for completeness |
<!-- spec-driver:section:testing:end -->

<!-- spec-driver:section:contributing -->
## Contributing

Bug reports and pull requests are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
<!-- spec-driver:section:contributing:end -->

<!-- spec-driver:section:license -->
## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
<!-- spec-driver:section:license:end -->
