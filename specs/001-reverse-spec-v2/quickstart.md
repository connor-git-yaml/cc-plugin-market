# Quickstart: Reverse-Spec Skill System v2.0

**Date**: 2026-02-10 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## Prerequisites

- Node.js LTS (20.x+)
- npm 9+
- Claude Code CLI (with skill support)
- TypeScript 5.x project with `tsconfig.json`

## Installation

```bash
# Install dependencies
npm install ts-morph tree-sitter tree-sitter-typescript dependency-cruiser handlebars zod

# Dev dependencies
npm install -D vitest @types/node typescript
```

## Project Setup

```bash
# Initialize TypeScript project (if not already)
npm init -y
npx tsc --init

# Create output directories
mkdir -p specs drift-logs templates

# Verify skill files exist
ls skills/reverse-spec/SKILL.md
ls skills/reverse-spec-batch/SKILL.md
ls skills/reverse-spec-diff/SKILL.md
```

## Usage

### Single Module Spec Generation

```bash
# In Claude Code
/reverse-spec src/auth/

# With deep analysis (includes function bodies)
/reverse-spec src/auth/ --deep

# Output: specs/auth.spec.md
```

### Batch Project Processing

```bash
# In Claude Code — full project
/reverse-spec-batch

# Force regenerate all specs
/reverse-spec-batch --force

# Output: specs/*.spec.md + specs/_index.spec.md
```

### Spec Drift Detection

```bash
# In Claude Code
/reverse-spec-diff specs/auth.spec.md src/auth/

# Output: drift-logs/auth-drift-2026-02-10.md
```

## Verification Steps

After implementation, verify the system works by running these checks:

### 1. AST Extraction Accuracy (Constitution I)

```bash
# Run unit tests for AST analyzer
npx vitest run tests/unit/ast-analyzer.test.ts

# Expected: All exported symbols match source code exactly
```

### 2. Pipeline Integration (Constitution II)

```bash
# Run integration test for three-stage pipeline
npx vitest run tests/integration/pipeline.test.ts

# Expected: Pre-processing → Context Assembly → Generation completes
#           No raw source code sent to LLM (only skeleton + context)
```

### 3. Performance (SC-003)

```bash
# Run against 500-file test fixture
npx vitest run tests/unit/ast-analyzer.test.ts --grep "performance"

# Expected: AST parsing + skeleton extraction ≤ 10 seconds
```

### 4. Golden Master (SC-004)

```bash
# Compare generated spec against pre-validated standard
npx vitest run tests/golden-master/

# Expected: 90%+ structural similarity with expected output
```

### 5. Self-Hosting (SC-009)

```bash
# Generate specs for the reverse-spec project itself
npx vitest run tests/self-hosting/self-host.test.ts

# Expected: Valid, coherent specs for all source modules
```

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| AST Parser | ts-morph (primary) + tree-sitter (fallback) | ts-morph for full TS analysis; tree-sitter for error tolerance |
| Dependency Graph | dependency-cruiser + custom Tarjan SCC | Programmatic API + lightweight self-built graph algorithms |
| Template Engine | Handlebars | Non-developer maintainability, partial inheritance, Markdown-safe |
| Secret Detection | Custom regex + entropy scanner | Lightweight, no bloated deps, full control |
| Token Counting | Two-phase (fast estimate → accurate count) | Balance speed (500 files) vs accuracy (budget enforcement) |
| Data Validation | Zod schemas | Runtime validation of all intermediate data structures |
| Testing | Vitest | Fast, TypeScript-native, compatible with golden master pattern |

## File Layout After Implementation

```
reverse-spec/
├── src/
│   ├── core/
│   │   ├── ast-analyzer.ts        # ts-morph AST → CodeSkeleton
│   │   ├── tree-sitter-fallback.ts
│   │   ├── context-assembler.ts   # Skeleton + deps → LLM prompt
│   │   ├── secret-redactor.ts     # Sensitive info redaction
│   │   └── token-counter.ts       # Token budget management
│   ├── graph/
│   │   ├── dependency-graph.ts    # dependency-cruiser wrapper
│   │   ├── topological-sort.ts    # Topo sort + Tarjan SCC
│   │   └── mermaid-renderer.ts    # Mermaid diagram generation
│   ├── diff/
│   │   ├── structural-diff.ts     # CodeSkeleton comparison
│   │   ├── semantic-diff.ts       # LLM behavior change assessment
│   │   └── noise-filter.ts        # Whitespace/comment filtering
│   ├── generator/
│   │   ├── spec-renderer.ts       # Handlebars 9-section rendering
│   │   ├── frontmatter.ts         # YAML frontmatter + versioning
│   │   ├── mermaid-class-diagram.ts
│   │   └── index-generator.ts     # _index.spec.md generation
│   ├── batch/
│   │   ├── batch-orchestrator.ts  # Batch processing orchestration
│   │   ├── progress-reporter.ts   # Terminal progress display
│   │   └── checkpoint.ts          # Breakpoint resume state
│   ├── models/
│   │   ├── code-skeleton.ts       # CodeSkeleton Zod schema
│   │   ├── drift-item.ts          # DriftItem Zod schema
│   │   ├── dependency-graph.ts    # DependencyGraph Zod schema
│   │   └── module-spec.ts         # ModuleSpec + related schemas
│   └── utils/
│       ├── file-scanner.ts        # File discovery + .gitignore
│       └── chunk-splitter.ts      # >5k LOC chunking
├── templates/
│   ├── module-spec.hbs            # 9-section spec template
│   ├── index-spec.hbs             # Architecture index template
│   └── drift-report.hbs           # Drift report template
├── skills/
│   ├── reverse-spec/SKILL.md
│   ├── reverse-spec-batch/SKILL.md
│   └── reverse-spec-diff/SKILL.md
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── golden-master/
│   └── self-hosting/
├── specs/                         # Generated output
└── drift-logs/                    # Drift reports
```
