# Spec Driver Orchestration Modes

Detailed reference for the 8 execution modes of Spec Driver. See [main README](../README.md#spec-driver) for high-level overview.

## How the orchestrator works

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

## Mode selection guide

| Scenario | Command | Phases | Human Interaction |
| -------- | ------- | ------ | ----------------- |
| New feature, major requirement | `/spec-driver:spec-driver-feature <desc>` | 10 | ≤5 |
| Mature spec/plan, direct implementation | `/spec-driver:spec-driver-implement [<feature>]` | 6 | ≤2 |
| Feature iteration, requirement change | `/spec-driver:spec-driver-story <desc>` | 5 | ≤2 |
| Bug fix, issue resolution | `/spec-driver:spec-driver-fix <desc>` | 4 | ≤1 |
| Large-scale refactor | `/spec-driver:spec-driver-refactor <target>` | 5 | 0 |
| Resume interrupted workflow | `/spec-driver:spec-driver-resume` | Variable | 0 |
| Aggregate product specification | `/spec-driver:spec-driver-sync` | 3 | 0 |
| Generate open-source docs | `/spec-driver:spec-driver-doc` | 7 | 2-3 |

## Mode details

### Feature Mode — Full 10-Phase Orchestration

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

### Implement Mode — Mature Spec Direct Implementation

```bash
/spec-driver:spec-driver-implement 072-spec-driver-implement
```

6-phase focused delivery: Intake → Plan Review → Task Refinement → Implementation → Verification → Closure. **Requires existing `spec.md` + `plan.md`**, skips full research chain. Falls back to `feature` or `story` if input is incomplete.

### Story Mode — Quick 5-Phase

```bash
/spec-driver:spec-driver-story "Add dark mode toggle to settings page"
```

Skips research phases — analyzes existing code context instead. Ideal for iterative changes and requirement updates.

### Fix Mode — Rapid 4-Phase

```bash
/spec-driver:spec-driver-fix "Login fails when email contains '+' character"
```

Rapid diagnosis → root cause analysis → targeted fix → verification. Auto-syncs specs after fix.

### Refactor Mode — Large-Scale Refactoring

```bash
/spec-driver:spec-driver-refactor --target src/parsers "Split into core and extensions"
/spec-driver:spec-driver-refactor --target CodeSkeleton --dry-run "Rename to ASTNode"
```

5-phase batched refactoring: Impact Analysis → Batch Planning → Iterative Implement + intermediate verification → Full residual scan → Final verification.

- `--target`: refactor target (file path, directory, module name, or concept)
- `--batch-size`: max files per batch (default 10)
- `--dry-run`: only run impact analysis + batch planning, skip implementation

### Resume Mode — Interrupted Workflow Recovery

```bash
/spec-driver:spec-driver-resume
```

No arguments needed. Automatically scans existing artifacts, detects the breakpoint, and continues from where the workflow was interrupted.

### Sync Mode — Product Spec Aggregation

```bash
/spec-driver:spec-driver-sync
```

Aggregates individual feature specs from `specs/` into a unified product-level `current-spec.md`. Fully automatic, zero human interaction. Also generates `.specify/project-context.suggestions.yaml` from governance/usage feedback.

### Doc Mode — Open-Source Documentation

```bash
/spec-driver:spec-driver-doc
```

Interactive generation of README.md, LICENSE, CONTRIBUTING.md, and CODE_OF_CONDUCT.md with conflict detection and backup.

### Constitution Mode — Project Principle Setup

```bash
/spec-driver:spec-driver-constitution
```

Single-phase skill to create or update the project constitution at `.specify/memory/constitution.md`.

## Sub-Agents

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
| refactor-plan | refactor 1-2 | Impact analysis + batched planning | Serial | Read, Bash, Glob, Grep |
| sync | — | Product specification aggregation | Serial | Read, Write, Bash, Glob |

## Generated Artifacts

All artifacts are written to `specs/<feature-id>/`:

| Artifact | Description |
| -------- | ----------- |
| `spec.md` | Structured requirement specification |
| `plan.md` | Technical architecture and implementation plan |
| `tasks.md` | Dependency-ordered task breakdown |
| `research-synthesis.md` | Product × Technology research summary |
| `verification-report.md` | Build/lint/test verification results |
| `current-spec.md` | Aggregated product-level specification (via sync) |

## Quality gates

| Gate | Triggered after | Default behavior | Severity |
| ---- | --------------- | ---------------- | -------- |
| `GATE_RESEARCH` | Research synthesis | `auto` | `non_critical` |
| `GATE_DESIGN` | Plan + checklist | `auto` (`always` in feature mode) | `critical` |
| `GATE_ANALYSIS` | Analyze | `on_failure` | `non_critical` |
| `GATE_TASKS` | Tasks | `always` | `non_critical` |
| `GATE_IMPLEMENT_MID` | Mid-implementation (>5 tasks) | `on_failure` | `non_critical` |
| `GATE_VERIFY` | Verify | `always` | `critical` |

Customize gate behavior per project via [orchestration overrides](configuration.md#per-project-orchestration-overrides).

## Selective re-run

```bash
/spec-driver:spec-driver-feature --rerun plan         # re-run plan phase only
/spec-driver:spec-driver-feature --preset quality-first "..."   # temp model preset override
```

## v4.0 Breaking Changes

The 9 atomic commands (`/spec-driver.specify` etc.) have been removed in v4.0. See [migration guide](migrations/skill-deprecation.md).

## See Also

- [Spec Driver Configuration](configuration.md) — model presets + per-project orchestration overrides
- [Repository Architecture](repository-architecture.md)
- [Main README](../README.md)
