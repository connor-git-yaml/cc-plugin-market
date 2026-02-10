<!--
  Sync Impact Report
  ==================
  Version change: N/A → 1.0.0 (initial ratification)
  Modified principles: N/A (first version)
  Added sections:
    - Core Principles (6 principles, expanded from 5-slot template)
    - Technology Stack Constraints (new section)
    - Quality Standards (new section)
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ no update needed (generic Constitution Check gate)
    - .specify/templates/spec-template.md ✅ no update needed (generic structure)
    - .specify/templates/tasks-template.md ✅ no update needed (generic phases)
    - .specify/templates/checklist-template.md ✅ no update needed (generic)
    - .specify/templates/agent-file-template.md ✅ no update needed (generic)
  Follow-up TODOs: None
-->

# Reverse-Spec Skill System Constitution

## Core Principles

### I. AST Accuracy First (NON-NEGOTIABLE)

All structural data (interface signatures, type definitions, exported symbols,
dependency relationships) MUST originate from static analysis (AST parsing).
LLM inference MUST NOT produce or fabricate structural data.

- Interface definitions MUST match source code at 100% fidelity, extracted by
  `ts-morph` or an equivalent AST tool
- Function signatures, class structures, and type aliases MUST be read directly
  from syntax tree nodes
- LLM is ONLY responsible for filling natural-language paragraphs such as
  "intent description" and "business logic interpretation"
- Any output violating this principle is treated as a defect and MUST be
  corrected before release

### II. Hybrid Analysis Pipeline

All code analysis MUST follow a three-stage pipeline:
Pre-processing → Context Assembly → Generation & Enrichment.
Raw source code MUST NOT be fed directly to the LLM.

- **Pre-processing**: AST scan extracts Skeleton Code (signatures only, no
  implementation details)
- **Context Assembly**: Prompt = Skeleton + dependency data + core logic
  snippets (complex functions only)
- **Generation & Enrichment**: LLM fills textual descriptions; toolchain
  injects Mermaid diagrams
- Per-file analysis context MUST NOT exceed 100k tokens

### III. Honest Uncertainty Marking

Information that cannot be deterministically extracted from code MUST be
explicitly marked. Inferred content MUST NOT be presented with certainty.

- Speculated intent MUST carry the `[推断]` or `[INFERRED]` marker
- Ambiguous or unreadable code MUST carry the `[不明确]` marker
- Syntactically broken code MUST carry the `[SYNTAX ERROR]` marker and trigger
  error-tolerant parsing mode
- Every marker MUST include a brief rationale

### IV. Read-Only Safety

All reverse-spec tools (`/reverse-spec`, `/reverse-spec-batch`,
`/reverse-spec-diff`) MUST be purely read-only operations.
Target source code MUST NOT be modified.

- Analysis MUST NOT write, delete, or rename source files
- Write operations are ONLY permitted to `specs/` and `drift-logs/` directories
- Drift reports MUST require explicit user confirmation before triggering any
  spec update
- `.gitignore` rules MUST be respected; ignored files MUST NOT be analyzed
  unless the user explicitly overrides

### V. Pure Node.js Ecosystem

All runtime dependencies MUST belong to the npm ecosystem.
Python, Rust, or other non-Node.js runtimes MUST NOT be introduced.

- Core libraries are limited to: `ts-morph` (AST), `dependency-cruiser`
  (dependency graph), `handlebars`/`ejs` (templating), `zod` (validation)
- MUST run in Claude Code sandbox or local Node.js environment without
  additional setup
- For non-TS/JS target projects, degrade gracefully to pure-text LLM analysis
  mode without introducing other language runtimes
- AST parsing of 500 files MUST complete within 10 seconds

### VI. Bilingual Documentation Standard

All generated Spec documents MUST use Chinese for prose content and MUST
preserve English for code identifiers.

- **Chinese**: all descriptions, explanations, analyses, summaries, table
  content, comments
- **English**: code identifiers (function names, class names, variable names),
  file paths, type signatures, code blocks
- **Section headings**: Chinese (e.g., `## 1. 意图`, `## 2. 接口定义`)
- **Frontmatter**: English YAML key names
- All Specs MUST follow the 9-section structure: 意图, 接口定义, 业务逻辑,
  数据结构, 约束条件, 边界条件, 技术债务, 测试覆盖, 依赖关系

## Technology Stack Constraints

| Category | Constraint |
|----------|-----------|
| **Runtime** | Node.js (LTS) |
| **AST Engine** | `ts-morph` (primary), `tree-sitter` (error-tolerant fallback) |
| **Dependency Analysis** | `dependency-cruiser` |
| **Template Engine** | `handlebars` or `ejs` |
| **Data Validation** | `zod` |
| **Diagram Generation** | Mermaid (embedded in Markdown) |
| **AI Model** | Claude 4.5/4.6 Sonnet/Opus (via Anthropic API) |
| **Target Code** | TS/JS preferred (AST-enhanced); other languages degrade to pure LLM mode |

## Quality Standards

### Output Quality Gates

Every generated Spec MUST pass the following self-checks before release:

- [ ] All public interfaces are documented
- [ ] No `[推断]` marker exists without an accompanying rationale
- [ ] All technical debt items have a severity rating
- [ ] Edge case table is non-empty
- [ ] File inventory matches the set of actually analyzed files
- [ ] Frontmatter `related_files` field is accurate

### Large-Scale Codebase Handling

- Targets exceeding 50 files or 5,000 LOC MUST enable incremental mode
- Batch processing MUST use dependency-topological ordering
  (Level 0 foundation → Level N business layer)
- When processing Level N modules, read Level 0 Spec interface definitions
  instead of source code (O(1) context complexity)
- Circular dependencies MUST be treated as strongly connected components (SCC)
  and processed as a single module
- Files exceeding 5,000 LOC MUST trigger the chunk-summary strategy

## Governance

- This constitution is the supreme authority governing all reverse-spec tool
  development and output
- Any modification to core principles MUST be documented, version-bumped, and
  accompanied by an impact assessment
- Version numbering follows Semantic Versioning: MAJOR (principle removal or
  redefinition), MINOR (new principle or expansion), PATCH (wording or
  clarification)
- All PRs and code reviews MUST verify compliance with this constitution
- Complexity deviations MUST be justified in the plan document's Complexity
  Tracking section

**Version**: 1.0.0 | **Ratified**: 2026-02-10 | **Last Amended**: 2026-02-10
