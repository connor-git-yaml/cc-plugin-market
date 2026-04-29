# Repository Architecture

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
│   ├── budget-gate.ts             # Dry-run + cost budget (F1)
│   ├── cost-summary.ts            # Token usage aggregation (F1)
│   ├── model-override-decision.ts # Model selection logic
│   ├── progress-reporter.ts       # Terminal progress display
│   ├── delta-regenerator.ts       # Incremental regeneration
│   └── checkpoint.ts              # Checkpoint recovery state
├── panoramic/                     # Panoramic doc + graph (Phase 1+2)
│   ├── anchoring/                 # F4: function-level semantic anchoring
│   ├── hyperedges/                # F4: multi-node hyperedge extraction
│   ├── builders/doc-graph-builder # Schema v2.0 graph builder
│   ├── exporters/html-template    # F5: graph.html D3 visualization
│   ├── pipelines/                 # ADR / debt-intelligence / docs-bundle / ...
│   └── qa/                        # F5: natural language Q&A (RAG)
├── debt-scanner/                  # F3: TODO + design-doc Open Questions
├── spec-store/                    # F2: unified SpecStore abstraction
├── adapters/                      # Multi-language adapters (TS/Python/Go/Java)
│   └── python-adapter.ts          # F-Python: AST-based symbol extraction (v4.1)
├── models/                        # Zod schema type definitions
├── utils/                         # Utility functions
├── installer/                     # Skill installer/uninstaller
├── auth/                          # Auth detection & proxy
├── mcp/                           # MCP Server (graph_query / _node / _path / _community / _god_nodes / _hyperedges)
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
    ├── skills/                    # 8 execution mode definitions
    │   ├── spec-driver-feature/       # Full 10-phase orchestration
    │   ├── spec-driver-implement/     # Mature spec/plan focused delivery
    │   ├── spec-driver-story/         # Quick 5-phase iteration
    │   ├── spec-driver-fix/           # Rapid 4-phase bug fix
    │   ├── spec-driver-refactor/      # Large-scale refactor
    │   ├── spec-driver-resume/        # Interrupted workflow recovery
    │   ├── spec-driver-sync/          # Product spec aggregation
    │   └── spec-driver-doc/           # Open-source doc generation
    ├── contracts/                 # Wrapper source-of-truth + orchestration overrides
    ├── config/                    # Base orchestration.yaml (modes / gates / parallel)
    ├── templates/                 # Report and config templates
    └── scripts/                   # Initialization, orchestrator-cli, validation

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

specs/                             # Feature specifications + Milestone blueprints
├── M-100-spectra-evolution/       # Phase 1 milestone
├── M-101-phase2-reading-platform/ # Phase 2 milestone (delivered)
├── M-102-phase3/                  # Phase 3 proposal
├── M-103-*/                       # Phase 3 work-in-progress
└── <NNN>-<feature>/               # Individual feature specs

tests/                             # Test suite (2,196+ cases)
├── unit/                          # Unit tests (modular)
├── integration/                   # End-to-end pipeline tests
├── batch/                         # Batch orchestration tests
├── panoramic/                     # Phase 2 panoramic + graph tests
├── golden-master/                 # AST extraction precision ≥ 90%
└── self-hosting/                  # Self-hosting tests (analyze itself)
```

## Tech Stack

### Spectra Stack

| Category | Technology |
| -------- | --------- |
| Language / Runtime | TypeScript 5.x, Node.js LTS (20.x+) |
| AST Engine | [ts-morph](https://github.com/dsherret/ts-morph) (TS/JS), [tree-sitter](https://tree-sitter.github.io/) (Python and others), Python `ast` module (v4.1+) |
| Dependency Analysis | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) |
| Template Engine | [Handlebars](https://handlebarsjs.com/) |
| Data Validation | [Zod](https://zod.dev/) |
| Diagram Generation | Mermaid (embedded in Markdown), D3-force (graph.html) |
| Embedding (F4) | [@xenova/transformers](https://github.com/xenova/transformers.js) (local) |
| AI Model | Claude 4.6 Sonnet / Claude 4.7 Opus 1M (via Anthropic API or Claude CLI proxy) |
| MCP Integration | [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) |
| Testing | [Vitest](https://vitest.dev/) (unit / integration / golden master / self-hosting) |

### Spec Driver Stack

| Category | Technology |
| -------- | --------- |
| Plugin Format | Markdown prompts + Bash scripts + YAML configuration |
| Runtime | Claude Code sandbox (no external runtime dependencies) |
| Agent System | 14 specialized sub-agent prompts with scoped tool permissions |
| Configuration | YAML (`spec-driver.config.yaml`) with 3 model presets + `.specify/orchestration-overrides.yaml` for project-level overrides |
| Schema Validation | [Zod](https://zod.dev/) (orchestration overrides + gate definitions) |
| Templates | Markdown templates for research reports, specs, and verification |

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Type checking
npm run lint
```

The project includes a 4-tier testing system with **2,196+ test cases** (Phase 2 + ongoing Phase 3 additions):

| Tier | Coverage |
| ---- | -------- |
| Unit | Individual module functionality (largest tier) |
| Integration | End-to-end pipeline + drift detection + CLI e2e + LLM token extraction (real SDK fixtures) |
| Golden Master | AST extraction precision ≥ 90% structural similarity |
| Self-Hosting | Project analyzes itself for completeness |

## Repository sync contracts

Several scripts maintain consistency across the repo:

| Script | Purpose |
|--------|---------|
| `npm run repo:check` | Aggregate validation (release contract + plugin sync + skill mirrors + agent docs) |
| `npm run repo:sync` | One-shot sync of all controlled artifacts |
| `npm run release:check` | Validate `contracts/release-contract.yaml` |
| `npm run release:sync` | Propagate release contract to plugin.json / package.json / README badges / postinstall scripts |
| `npm run docs:sync:agents` | Sync `docs/shared/*.md` to `AGENTS.md` and `CLAUDE.md` shared sections |

See `docs/contributor-guide.md` for full contribution flow.

## See Also

- [Main README](../README.md)
- [Spectra CLI Reference](spectra-cli-reference.md)
- [Spec Driver Modes](spec-driver-modes.md)
- [Configuration](configuration.md)
