# CC Plugin Market

<!-- speckit:section:badges -->
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![npm version](https://img.shields.io/npm/v/reverse-spec.svg)
![Version](https://img.shields.io/badge/version-2.0.0-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Node.js](https://img.shields.io/badge/Node.js-20.x+-339933)
<!-- speckit:section:badges:end -->

<!-- speckit:section:description -->
A curated collection of Claude Code plugins for Spec-Driven Development. This repository ships two complementary products that cover the full software development lifecycle — from reverse-engineering existing code into specifications, to orchestrating new feature development through structured workflows.
<!-- speckit:section:description:end -->

<!-- speckit:section:plugins-overview -->
## Plugins

| Plugin | Type | Description |
| ------ | ---- | ----------- |
| **[reverse-spec](#reverse-spec)** | CLI + MCP + Skills | Reverse-engineers legacy code into structured Spec documents via AST + LLM hybrid pipeline |
| **[Spec Driver](#spec-driver)** | Plugin (Agents + Skills) | Autonomous development orchestrator — automates the full SDD lifecycle with 14 specialized sub-agent prompts and 6 execution modes |

```text
┌─────────────────────────────────────────────────────────────────┐
│                       CC Plugin Market                          │
│                                                                 │
│  ┌──────────────────────┐     ┌──────────────────────────────┐  │
│  │    reverse-spec       │     │        Spec Driver           │  │
│  │  (Reverse Engineer)   │     │  (Forward Orchestrator)      │  │
│  │                       │     │                              │  │
│  │  Code → AST → Spec    │     │  Idea → Spec → Plan → Code  │  │
│  │                       │     │                              │  │
│  │  • generate / batch   │     │  • speckit-feature           │  │
│  │  • diff / prepare     │     │  • speckit-story             │  │
│  │  • MCP server         │     │  • speckit-fix               │  │
│  │  • CLI + Skills       │     │  • speckit-resume/sync/doc   │  │
│  └──────────────────────┘     └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```
<!-- speckit:section:plugins-overview:end -->

<!-- speckit:section:plugin-installation -->
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
claude plugin install reverse-spec@cc-plugin-market --scope project

# Or install for current user (available across all projects)
claude plugin install spec-driver@cc-plugin-market --scope user
claude plugin install reverse-spec@cc-plugin-market --scope user
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
claude plugin remove reverse-spec --scope project

# Remove from user scope
claude plugin remove spec-driver --scope user
claude plugin remove reverse-spec --scope user
```

### Verify Installation

After installation, the plugin skills become available in Claude Code:

```bash
# List installed plugins
claude plugin list

# Test spec-driver skills
/spec-driver:speckit-doc

# Test reverse-spec skills
/reverse-spec src/
```
<!-- speckit:section:plugin-installation:end -->

### Codex Support

For Codex, install `reverse-spec` CLI and register reverse-spec skills into `.codex/skills`:

```bash
# Install CLI
npm install -g reverse-spec

# Project-level Codex skills
reverse-spec init --target codex

# Or global Codex skills
reverse-spec init --global --target codex
```

Install both Claude + Codex skills in one command:

```bash
reverse-spec init --global --target both
```

Optional: control npm postinstall target with environment variable:

```bash
REVERSE_SPEC_SKILL_TARGET=codex npm install -g reverse-spec
# values: claude | codex | both
```

Spec Driver uses an independent Codex entrypoint (parallel to reverse-spec):

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
- Global mode writes wrappers with absolute source paths. If this repository path changes, rerun `install`.

---

<!-- speckit:section:reverse-spec -->
## reverse-spec

A hybrid AST + LLM pipeline that reverse-engineers legacy source code into structured, nine-section Spec documents. TypeScript/JavaScript projects benefit from AST-enhanced precise analysis, while other languages are supported via LLM-only fallback mode.

### Features

- **Single Module Spec Generation** (`generate`) — Complete nine-section spec documents; TS/JS interface definitions 100% AST-extracted
- **Batch Project Processing** (`batch`) — Dependency-topology-ordered generation with checkpoint recovery and architecture index
- **Spec Drift Detection** (`diff`) — AST structural diff + LLM semantic evaluation, three severity levels, automatic noise filtering
- **AST Preprocessing** (`prepare`) — AST analysis + context assembly without LLM calls, no auth required
- **MCP Server** — Model Context Protocol server for IDE integration
- **Dual Authentication** — API Key direct connection and Claude CLI subscription proxy, auto-detected
- **Hybrid Pipeline** — Three-phase engine (preprocessing → context assembly → generation); raw source code never directly sent to LLM
- **Honest Uncertainty Labeling** — Inferred content marked `[inferred]`, ambiguous code marked `[unclear]`
- **Read-Only Safety** — All commands strictly read-only; writes limited to `specs/` and `drift-logs/`

### Getting Started

**Prerequisites:** Node.js 20.x+, and one of:

- **API Key**: Set `ANTHROPIC_API_KEY` environment variable (takes priority)
- **Claude CLI**: Install and log in to Claude Code (`claude auth login`)

**Install globally (recommended):**

```bash
npm install -g reverse-spec
```

After installation, `reverse-spec` CLI is available globally, and skills are auto-registered to Claude Code by default.  
If Codex is detected (`~/.codex` exists), Codex skill registration is also attempted automatically.

**Or from source:**

```bash
git clone https://github.com/connor-git-yaml/cc-plugin-market.git
cd reverse-spec
npm install && npm run build
```

### CLI Usage

```bash
# Single module spec generation
reverse-spec generate src/auth/ --deep

# AST preprocessing only (no LLM, no auth required)
reverse-spec prepare src/auth/ --deep

# Batch spec generation for entire project
reverse-spec batch --force

# Spec drift detection
reverse-spec diff specs/auth.spec.md src/auth/

# Custom output directory
reverse-spec generate src/auth/ --output-dir out/

# Check authentication status
reverse-spec auth-status --verify

# Install skills to current project / globally
reverse-spec init [--global] [--target claude|codex|both]

# Remove installed skills
reverse-spec init --remove [--target claude|codex|both]
```

### Claude Code Skills

```bash
/reverse-spec src/auth/                          # Single module spec
/reverse-spec-batch                              # Full project batch
/reverse-spec-diff specs/auth.spec.md src/auth/  # Drift detection
```

### Codex Skills

In Codex, after `reverse-spec init --target codex`, these skills are available:

- `reverse-spec`
- `reverse-spec-batch`
- `reverse-spec-diff`

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
```
<!-- speckit:section:reverse-spec:end -->

---

<!-- speckit:section:spec-driver -->
## Spec Driver

**Spec Driver** (v3.1.0) is a Claude Code plugin that serves as an autonomous development orchestrator. It automates the full Spec-Driven Development lifecycle through 14 specialized sub-agent prompts, 5 quality gates, 6 execution modes, and parallel sub-agent dispatch for accelerated execution.

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

To initialize Spec Driver in a new project (Claude Code):

```bash
# Creates .specify/ directory, constitution.md, and spec-driver.config.yaml
/spec-driver:speckit-feature "your feature description"
# The first run will auto-initialize the project structure
```

### Orchestration Modes

Choose the right mode based on your scenario:

| Scenario | Command | Phases | Human Interaction |
| -------- | ------- | ------ | ----------------- |
| New feature, major requirement | `/spec-driver:speckit-feature <desc>` | 10 | ≤5 |
| Feature iteration, requirement change | `/spec-driver:speckit-story <desc>` | 5 | ≤2 |
| Bug fix, issue resolution | `/spec-driver:speckit-fix <desc>` | 4 | ≤1 |
| Resume interrupted workflow | `/spec-driver:speckit-resume` | Variable | 0 |
| Aggregate product specification | `/spec-driver:speckit-sync` | 3 | 0 |
| Generate open-source docs | `/spec-driver:speckit-doc` | 6 | 2-3 |

#### Feature Mode — Full 10-Phase Orchestration

```bash
/spec-driver:speckit-feature "Add user authentication with OAuth2"
/spec-driver:speckit-feature --research tech-only "Migrate from Express to Fastify"
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
/spec-driver:speckit-story "Add dark mode toggle to settings page"
```

Skips research phases — analyzes existing code context instead. Ideal for iterative changes and requirement updates.

#### Fix Mode — Rapid 4-Phase

```bash
/spec-driver:speckit-fix "Login fails when email contains '+' character"
```

Rapid diagnosis → root cause analysis → targeted fix → verification. Auto-syncs specs after fix.

#### Resume Mode — Interrupted Workflow Recovery

```bash
/spec-driver:speckit-resume
```

No arguments needed. Automatically scans existing artifacts, detects the breakpoint, and continues from where the workflow was interrupted.

#### Sync Mode — Product Spec Aggregation

```bash
/spec-driver:speckit-sync
```

Aggregates individual feature specs from `specs/` into a unified product-level `current-spec.md`. Fully automatic, zero human interaction.

#### Doc Mode — Open-Source Documentation

```bash
/spec-driver:speckit-doc
```

Interactive generation of README.md, LICENSE, CONTRIBUTING.md, and CODE_OF_CONDUCT.md with conflict detection and backup.

### Individual Phase Commands

Each phase can also be run independently for fine-grained control:

```bash
# Create or update project constitution
/speckit.constitution

# Generate requirement specification from description
/speckit.specify

# Clarify ambiguities in the current spec
/speckit.clarify

# Generate quality checklist
/speckit.checklist

# Create implementation plan
/speckit.plan

# Generate dependency-ordered tasks
/speckit.tasks

# Run cross-artifact consistency analysis
/speckit.analyze

# Execute implementation plan
/speckit.implement
```

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
| implement | 6 | Code generation per task list | Serial | Read, Write, Bash, WebFetch |
| spec-review | 7a | Spec compliance review | Parallel (VERIFY_GROUP) | Read, Glob, Grep |
| quality-review | 7b | Code quality review | Parallel (VERIFY_GROUP) | Read, Glob, Grep |
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
      opus: gpt-5
      sonnet: gpt-5-mini
    claude:
      gpt-5: opus
      gpt-5-mini: sonnet
  defaults:
    codex: gpt-5
    claude: sonnet

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

When running in Codex, model names are normalized via `model_compat` before each Task dispatch, so existing `opus/sonnet` configs remain compatible.

`reverse-spec` CLI (`generate` / `batch` / `diff`) now follows the same model config source:

- Priority: `REVERSE_SPEC_MODEL` > `spec-driver.config.yaml agents.specify.model` > `spec-driver.config.yaml preset` > built-in default
- Config discovery: current directory upward search for `spec-driver.config.yaml`, then `.specify/spec-driver.config.yaml`

### Supported Verification Languages

JS/TS (npm/pnpm/yarn/bun), Rust (Cargo), Go, Python (pip/poetry/uv), Java (Maven/Gradle), Kotlin, Swift (SPM), C/C++ (CMake/Make), C# (.NET), Elixir (Mix), Ruby (Bundler)
<!-- speckit:section:spec-driver:end -->

---

<!-- speckit:section:project-structure -->
## Project Structure

```text
src/                               # reverse-spec TypeScript source
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
├── reverse-spec/                  # reverse-spec MCP plugin
└── spec-driver/                   # Spec Driver orchestrator (v3.1.0)
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
    ├── skills/                    # 6 execution mode definitions
    │   ├── speckit-feature/       # Full 10-phase orchestration
    │   ├── speckit-story/         # Quick 5-phase iteration
    │   ├── speckit-fix/           # Rapid 4-phase bug fix
    │   ├── speckit-resume/        # Interrupted workflow recovery
    │   ├── speckit-sync/          # Product spec aggregation
    │   └── speckit-doc/           # Open-source doc generation
    ├── templates/                 # Report and config templates
    └── scripts/                   # Initialization and scanning scripts

templates/                         # Handlebars output templates
├── module-spec.hbs                # Nine-section spec template
├── index-spec.hbs                 # Architecture index template
└── drift-report.hbs               # Drift report template

skills/                            # Local skills (via npx tsx)
├── reverse-spec/SKILL.md
├── reverse-spec-batch/SKILL.md
└── reverse-spec-diff/SKILL.md

tests/                             # Test suite (313 cases)
├── unit/                          # 30 unit test files
├── integration/                   # 7 integration test files
├── golden-master/                 # Golden Master structural similarity tests
└── self-hosting/                  # Self-hosting tests (analyze itself)
```
<!-- speckit:section:project-structure:end -->

<!-- speckit:section:tech-stack -->
## Tech Stack

### reverse-spec Stack

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
<!-- speckit:section:tech-stack:end -->

<!-- speckit:section:testing -->
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
<!-- speckit:section:testing:end -->

<!-- speckit:section:contributing -->
## Contributing

Bug reports and pull requests are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
<!-- speckit:section:contributing:end -->

<!-- speckit:section:license -->
## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
<!-- speckit:section:license:end -->
