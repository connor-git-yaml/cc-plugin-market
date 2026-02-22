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
| **[Spec Driver](#spec-driver)** | Plugin (Agents + Skills) | Autonomous development orchestrator — automates the full SDD lifecycle with 12 sub-agents and 6 execution modes |

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

After installation, `reverse-spec` CLI is available globally, and `/reverse-spec` skills are auto-registered in Claude Code.

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
reverse-spec init [--global]

# Remove installed skills
reverse-spec init --remove
```

### Claude Code Skills

```bash
/reverse-spec src/auth/                          # Single module spec
/reverse-spec-batch                              # Full project batch
/reverse-spec-diff specs/auth.spec.md src/auth/  # Drift detection
```

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

**Spec Driver** (v3.1.0) is a Claude Code plugin that serves as an autonomous development orchestrator. It automates the full Spec-Driven Development lifecycle through 12 specialized sub-agents, 4 quality gates, and 6 execution modes.

### How It Works

```text
Constitution → Research → Specify → Clarify → Plan → Tasks → Implement → Verify
  (Phase 0)   (Phase 1)  (Phase 2) (Phase 3) (Phase 4) (Phase 5) (Phase 6) (Phase 7)
```

Each phase is handled by a dedicated sub-agent with scoped permissions. The orchestrator manages context passing, quality gates, and failure recovery automatically.

### Setup

Spec Driver is distributed as a Claude Code plugin. It is included in this repository under `plugins/spec-driver/` and is registered automatically when the project is opened in Claude Code.

To initialize Spec Driver in a new project:

```bash
# Creates .specify/ directory, constitution.md, and driver-config.yaml
/spec-driver:speckit-feature "your feature description"
# The first run will auto-initialize the project structure
```

### Orchestration Modes

Choose the right mode based on your scenario:

| Scenario | Command | Phases | Human Interaction |
| -------- | ------- | ------ | ----------------- |
| New feature, major requirement | `/spec-driver:speckit-feature <desc>` | 10 | ≤4 |
| Feature iteration, requirement change | `/spec-driver:speckit-story <desc>` | 5 | ≤2 |
| Bug fix, issue resolution | `/spec-driver:speckit-fix <desc>` | 4 | ≤1 |
| Resume interrupted workflow | `/spec-driver:speckit-resume` | Variable | 0 |
| Aggregate product specification | `/spec-driver:speckit-sync` | 3 | 0 |
| Generate open-source docs | `/spec-driver:speckit-doc` | 6 | 2-3 |

#### Feature Mode — Full 10-Phase Orchestration

```bash
/spec-driver:speckit-feature "Add user authentication with OAuth2"
```

1. **Constitution** — Validate against project principles
2. **Product Research** — Market needs, competitor analysis
3. **Tech Research** — Architecture options, technology evaluation
4. **Research Synthesis** — Product × Technology decision matrix
5. **Specify** — Generate structured requirement specification
6. **Clarify + Checklist** — Resolve ambiguities, quality check
7. **Plan** — Technical architecture and implementation design
8. **Tasks + Analyze** — Dependency-ordered task breakdown, cross-artifact consistency analysis
9. **Implement** — Execute tasks with code generation
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

| Agent | Phase | Responsibility | Permissions |
| ----- | ----- | -------------- | ----------- |
| constitution | 0 | Project principle validation | Read |
| product-research | 1a | Market needs, competitor analysis | WebSearch, Read, Glob, Grep |
| tech-research | 1b | Architecture options, technology evaluation | WebSearch, Read, Glob, Grep |
| specify | 2 | Structured requirement specification | Read, Write, Bash |
| clarify | 3 | Ambiguity detection and resolution | Read, Bash |
| checklist | 3.5 | Specification quality checklist | Read, Bash |
| plan | 4 | Technical architecture and design | Read, Write, Bash |
| tasks | 5 | Task decomposition and dependency ordering | Read, Write, Bash |
| analyze | 5.5 | Cross-artifact consistency analysis | Read, Bash |
| implement | 6 | Code generation per task list | Read, Write, Bash, WebFetch |
| verify | 7 | Build, lint, and test validation | Bash, Read, Write |
| sync | — | Product specification aggregation | Read, Write, Bash, Glob |

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

Customize behavior via `driver-config.yaml` in the project root:

```yaml
# Model presets: balanced (default) | quality-first | cost-efficient
preset: balanced

# Override model per agent
agents:
  specify:
    model: opus
  implement:
    model: sonnet

# Quality gates
quality_gates:
  auto_continue_on_warning: true
  pause_on_critical: true

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
    ├── agents/                    # 12 specialized sub-agent prompts
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
    │   ├── verify.md              # Phase 7: Build/lint/test verification
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

tests/                             # Test suite (231 cases)
├── unit/                          # 19 unit test files
├── integration/                   # 4 integration test files
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
| Agent System | 12 specialized sub-agents with scoped tool permissions |
| Configuration | YAML (`driver-config.yaml`) with 3 model presets |
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

The project includes a 4-tier testing system with 231 test cases:

| Tier | Files | Cases | Coverage |
| ---- | ----- | ----- | -------- |
| Unit | 19 | 187 | Individual module functionality |
| Integration | 4 | 30 | End-to-end pipeline + drift detection + CLI e2e |
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
