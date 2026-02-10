# Feature Specification: Reverse-Spec Skill System v2.0

**Feature Branch**: `001-reverse-spec-v2`
**Created**: 2026-02-10
**Status**: Draft
**Input**: Build a complete Claude Code AI Agent Skill suite that reverse-engineers legacy source code into structured, machine-readable Spec documents via a hybrid AST static analysis + LLM pipeline, covering single-module generation, batch project processing, and spec drift detection.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Module Spec Generation (Priority: P1)

A developer working with an unfamiliar codebase runs `/reverse-spec src/auth/` in Claude Code. The system scans all TypeScript files in that directory, extracts interface signatures and function skeletons via AST parsing, assembles a focused context for the LLM, and produces a structured `specs/auth.spec.md` document that accurately captures the module's intent, public APIs, business logic, constraints, edge cases, and technical debt — all written in Chinese with English code identifiers preserved. The output follows the mandatory 9-section structure and includes embedded Mermaid class diagrams.

**Why this priority**: This is the foundational capability of the entire project. Without reliable single-module spec generation, batch processing and drift detection cannot function. It delivers immediate standalone value to any developer facing an undocumented codebase.

**Independent Test**: Run `/reverse-spec` against a known TypeScript module (e.g., a subset of `redux` or `lodash`) and verify the output spec matches a pre-validated golden master.

**Acceptance Scenarios**:

1. **Given** a TypeScript directory with 10 files totaling 800 LOC, **When** the user runs `/reverse-spec src/auth/`, **Then** the system produces `specs/auth.spec.md` containing all 9 mandatory sections with every public interface accurately documented from AST extraction (zero LLM-fabricated signatures).
2. **Given** a file containing ambiguous business logic with no comments, **When** the system generates a spec, **Then** inferred intent paragraphs are marked with `[推断]` and a brief rationale.
3. **Given** a source file with syntax errors, **When** the system encounters a parse failure, **Then** it falls back to error-tolerant parsing, extracts as much skeleton as possible, and marks the affected sections with `[SYNTAX ERROR]`.
4. **Given** a target module, **When** spec generation completes, **Then** no source files in the target directory have been modified, created, or deleted (read-only guarantee).
5. **Given** a module with complex class hierarchies, **When** spec generation completes, **Then** the output contains an accurate Mermaid class diagram reflecting the actual inheritance and composition relationships.

---

### User Story 2 - Batch Project Spec Generation (Priority: P2)

A tech lead facing a large monorepo (200+ modules) runs `/reverse-spec-batch` to systematically document the entire codebase. The system constructs a dependency graph via `dependency-cruiser`, determines processing order via topological sort (foundation libraries first, business layers last), generates a `specs/_index.spec.md` architecture overview, and iterates through modules — reading previously generated specs' interface definitions as context instead of re-reading source code — producing a complete set of individual module specs.

**Why this priority**: Batch processing is essential for large-scale adoption but depends on single-module generation (US1) being reliable. It introduces the dependency graph and topological sort capabilities that differentiate v2 from v1, and enables the O(1) context complexity strategy.

**Independent Test**: Run `/reverse-spec-batch` against a multi-module open-source project and verify the generated index correctly maps all modules, the processing order follows dependency topology, and each module spec references its dependencies' interface definitions rather than their source code.

**Acceptance Scenarios**:

1. **Given** a monorepo with modules A (depends on nothing), B (depends on A), and C (depends on A and B), **When** the user runs `/reverse-spec-batch`, **Then** modules are processed in order A → B → C, and module C's spec references interface definitions from A's and B's already-generated specs (not their source code).
2. **Given** a project with modules X and Y in a circular dependency, **When** the batch processor encounters this cycle, **Then** it treats X and Y as a single strongly connected component (SCC) and processes them together.
3. **Given** a batch run that was previously interrupted after completing 5 of 12 modules, **When** the user reruns `/reverse-spec-batch`, **Then** the system detects the 5 existing specs and resumes from module 6 (no redundant regeneration unless `--force` is specified).
4. **Given** batch processing is underway, **When** a module completes, **Then** the system displays real-time progress (e.g., `[3/50] Processing src/auth...`). The user may interrupt via Ctrl+C at any time; the system persists a checkpoint so the next run resumes from the last completed module (no interactive confirmation between modules — SC-005 autonomous guarantee).
5. **Given** a completed batch run, **When** the user opens `specs/_index.spec.md`, **Then** it contains a system purpose summary, architecture pattern description, module map with links to each spec, cross-cutting concerns, and technology stack overview.

---

### User Story 3 - Spec Drift Detection (Priority: P3)

After a sprint of code changes, a developer runs `/reverse-spec-diff specs/auth.spec.md src/auth/` to check whether the specification still reflects reality. The system re-analyzes the current code via AST, performs a structural diff on exported symbols (added/removed/modified), and for behavioral changes (function body logic) asks the LLM whether the code change violates the spec's stated intent. It produces a categorized drift report and offers to update the spec — but only after explicit user confirmation.

**Why this priority**: Drift detection completes the Spec-Driven Development (SDD) lifecycle by closing the feedback loop between code and documentation. It requires both the AST analyzer and a reliable baseline spec, making it naturally the last user-facing feature to build.

**Independent Test**: Generate a spec for a module, make known code modifications (add a function, change a signature, remove an export), and verify the drift report correctly identifies all three change types with appropriate severity levels.

**Acceptance Scenarios**:

1. **Given** a spec documenting function `login(email: string, password: string)` and the code now shows `login(email: string, password: string, rememberMe?: boolean)`, **When** drift detection runs, **Then** the report lists this as a MEDIUM severity modification with the exact signature change.
2. **Given** a spec documenting 5 exported functions and the code now has 6, **When** drift detection runs, **Then** the report lists the new export as a LOW severity addition with its location.
3. **Given** a spec with business rule "passwords must be at least 8 characters" and the code now validates for 12 characters, **When** the LLM semantic diff evaluates this, **Then** it flags a MEDIUM severity behavioral drift in the constraints section.
4. **Given** only whitespace, comment, and import order changes in the code, **When** drift detection runs, **Then** these are filtered as noise and the report shows zero substantive drift.
5. **Given** a completed drift report, **When** the user has not explicitly confirmed an update, **Then** no spec files are modified (read-only until confirmed).

---

### User Story 4 - Hybrid Analysis Pipeline (Priority: P1)

The core engine that powers all three slash commands. When any command triggers code analysis, the system follows a strict three-stage pipeline: (1) **Pre-processing** — use `ts-morph` to parse AST and extract a Skeleton Code containing only exported signatures, no implementation details; (2) **Context Assembly** — compose the LLM prompt from Skeleton + dependency data + core logic snippets (only for complex functions), keeping total context under 100k tokens; (3) **Generation & Enrichment** — LLM fills natural-language descriptions while the toolchain injects Mermaid diagrams. This pipeline ensures structural accuracy (from AST) while leveraging LLM for semantic understanding.

**Why this priority**: This is the technical foundation that every user-facing command depends on. The three-stage pipeline is what distinguishes v2 from v1's pure-LLM approach and enforces Constitution Principle I (AST Accuracy First) and Principle II (Hybrid Pipeline).

**Independent Test**: Feed a known TypeScript module through each pipeline stage independently, verify the skeleton extraction is 100% accurate, the context assembly stays within token budget, and the final enriched output contains no fabricated interfaces.

**Acceptance Scenarios**:

1. **Given** a TypeScript file exporting 3 functions, 2 interfaces, and 1 class, **When** the pre-processing stage runs, **Then** the extracted CodeSkeleton contains exactly 6 exports with correct name, kind, signature, and JSDoc fields — and zero implementation details.
2. **Given** 500 TypeScript files, **When** the pre-processing stage processes all of them, **Then** AST parsing and skeleton extraction completes within 10 seconds.
3. **Given** a module with 50 functions where 5 contain complex business logic, **When** the context assembly stage runs, **Then** the assembled prompt includes skeleton for all 50 but full code snippets only for the 5 complex functions, and total tokens stay under 100k.
4. **Given** an assembled context, **When** the generation stage runs, **Then** all interface definitions in the output exactly match the AST-extracted skeleton (no LLM modifications to signatures), and Mermaid diagrams accurately reflect class relationships.
5. **Given** a file with syntax errors that prevent full `ts-morph` parsing, **When** the pre-processing stage encounters the failure, **Then** it falls back to `tree-sitter` error-tolerant mode and returns a partial skeleton with affected symbols marked `[SYNTAX ERROR]`.

---

### User Story 5 - Dependency Graph & Topological Processing (Priority: P2)

The system constructs a project-wide module dependency graph by scanning all import statements. It uses `dependency-cruiser` to build a directed graph, identifies strongly connected components (circular dependencies), computes a topological sort order for processing, and generates both a JSON structure for programmatic use and Mermaid diagram source for documentation. This graph drives the batch processing order and enables the O(1) context strategy where higher-level modules read lower-level specs instead of source code.

**Why this priority**: The dependency graph is required for batch processing (US2) and provides valuable architectural visualization. It's independent of the AST content analyzer but must be ready before batch mode can function correctly.

**Independent Test**: Run the dependency graph generator against a project with known dependency relationships and verify the JSON structure, topological order, SCC detection, and Mermaid output all match expectations.

**Acceptance Scenarios**:

1. **Given** a project where module A imports from B, and B imports from C, **When** the dependency graph generator runs, **Then** the returned JSON shows edges A→B and B→C, and the topological order is [C, B, A].
2. **Given** modules X and Y that import each other (circular), **When** the generator detects this, **Then** it groups them into an SCC and the returned structure marks them as a combined processing unit.
3. **Given** any project root, **When** the generator completes, **Then** it produces valid Mermaid source code that renders as a dependency diagram.
4. **Given** a monorepo with 200+ modules, **When** the generator runs, **Then** it completes graph construction and topological sort without exceeding reasonable time and memory limits.

---

### User Story 6 - Structured Diff Engine (Priority: P3)

The diff engine compares two CodeSkeleton snapshots (old vs new) representing the same module at different points in time. It performs structural comparison on exported symbols: identifies additions (new exports), removals (deleted exports — breaking changes), and modifications (changed signatures). Each difference is categorized by severity (HIGH for breaking, MEDIUM for logic, LOW for addition) and by category (Interface, Behavior, or Constraint). The engine filters noise (renames, formatting) and returns a structured report. For behavioral changes (function body logic), it delegates to the LLM for semantic evaluation.

**Why this priority**: The diff engine powers drift detection (US3) and is the last piece of the toolchain. It depends on the AST analyzer being stable and on the CodeSkeleton format being finalized.

**Independent Test**: Create two known CodeSkeleton objects with deliberate differences and assert the diff report contains the correct items with correct severities and categories.

**Acceptance Scenarios**:

1. **Given** an old skeleton with function `foo(a: string)` and a new skeleton with `foo(a: string, b: number)`, **When** the diff engine compares, **Then** it returns a modification entry with severity MEDIUM categorized as Interface.
2. **Given** an old skeleton with 5 exports and a new skeleton missing one of them, **When** the engine compares, **Then** it returns a removal entry with severity HIGH categorized as Interface (breaking change).
3. **Given** two identical skeletons, **When** the engine compares, **Then** it returns an empty diff with zero items.
4. **Given** a function body change where the logic differs but the signature is unchanged, **When** the engine detects this, **Then** it delegates to the LLM semantic diff to assess whether the spec's intent is violated.

---

### User Story 7 - Spec Output Format & Template System (Priority: P1)

Every generated spec document follows a standardized format: YAML frontmatter (type, version, generator, source target, related files, confidence level), followed by the 9 mandatory sections in Chinese (意图, 接口定义, 业务逻辑, 数据结构, 约束条件, 边界条件, 技术债务, 测试覆盖, 依赖关系), with embedded Mermaid diagrams and a file inventory appendix. The template system uses `handlebars` or `ejs` to render consistent output from the analysis data, ensuring every spec is machine-readable, cross-referenced, and compatible with the SDD workflow.

**Why this priority**: A consistent, well-structured output format is essential from day one. All three commands produce spec-like documents, and the template system ensures uniformity across single-module, batch, and drift-update outputs.

**Independent Test**: Render the template with known analysis data and verify the output contains correct frontmatter, all 9 sections populated, valid Mermaid blocks, and accurate file inventory.

**Acceptance Scenarios**:

1. **Given** a completed analysis of a module, **When** the template renders the spec, **Then** the output YAML frontmatter contains accurate `type`, `version`, `generated_by`, `source_target`, `related_files`, `last_updated`, and `confidence` fields.
2. **Given** analysis data for a module, **When** the template renders, **Then** all 9 sections appear in order with Chinese headings, and no section is empty (at minimum a "no items found" note).
3. **Given** a module with class hierarchies and dependencies, **When** the template renders, **Then** the spec includes valid Mermaid class diagram and dependency graph blocks that can be rendered by any Mermaid-compatible viewer.
4. **Given** analysis of 15 source files, **When** the template renders the appendix, **Then** the file inventory table lists all 15 files with their LOC counts and primary purposes.

---

### Edge Cases

- What happens when the target path does not exist? The system reports an error with suggested alternatives based on the project structure.
- What happens when a non-TS/JS file is encountered? AST-enhanced mode is used for TS/JS; all other languages degrade to pure-text LLM analysis mode without introducing non-Node.js runtimes.
- What happens when a single file exceeds 5,000 LOC? The chunk-summary strategy activates: split by function, generate micro-specs per chunk, then merge into a single module spec.
- What happens when the `specs/` output directory doesn't exist? The system creates it automatically.
- What happens when a spec already exists for a target? Single-mode (`/reverse-spec`) overwrites by default; batch mode skips unless `--force` is specified.
- What happens when the user provides no arguments to `/reverse-spec`? The system warns about full-project scope and asks for confirmation before proceeding.
- What happens when `dependency-cruiser` encounters unsupported import patterns? The system logs a warning and treats the unresolved import as an external dependency.
- What happens when the Anthropic API is unavailable during the LLM enrichment stage? The system outputs the AST-extracted structural data (skeleton, interfaces) as-is and marks all natural-language sections as `[LLM UNAVAILABLE — pending enrichment]`.
- What happens when the LLM API hits rate limits during batch processing? The system retries with exponential backoff (max 3 attempts, short intervals). If still failing, it degrades the current module to AST-only output and continues. Users can pause and resume from the breakpoint after resolving the issue.

### Out of Scope (v2.0)

- **Code generation or modification**: The system is strictly read-only and analytical; it does not generate, refactor, or modify source code
- **IDE real-time integration**: Live spec drift display in VS Code or other IDEs is deferred to v2.2 roadmap
- **Non-Node.js language AST support**: AST-enhanced analysis is limited to TypeScript/JavaScript; other languages receive degraded pure-LLM analysis only — no Python, Rust, Go, or Java AST parsers
- **Automated test case generation**: The system documents existing code but does not generate test cases, test stubs, or validation code (deferred to v2.1 roadmap)

## Clarifications

### Session 2026-02-10

- Q: How should the system handle sensitive information (API keys, credentials, tokens) found in source code before sending to LLM? → A: Auto-detect and redact common secret patterns (API keys, tokens, credentials) before LLM context assembly
- Q: How are spec document versions managed when regenerated or updated via drift detection? → A: Simple incremental counter (v1, v2, v3...), rely on Git history for detailed change tracking
- Q: How should batch processing report progress and handle observability? → A: Real-time terminal progress output + generate a batch summary log after completion (with success/failure/skipped module list)
- Q: What capabilities are explicitly out-of-scope for v2.0? → A: All excluded: code generation/modification, IDE real-time integration, non-Node.js language AST support, automated test case generation
- Q: How should the system handle LLM API rate limits and per-module failures during batch processing? → A: Exponential backoff retry (max 3 attempts, short intervals), then degrade to AST-only spec and skip; support breakpoint resume so users can fix LLM issues and continue from current progress

## Requirements *(mandatory)*

### Functional Requirements

**Core Pipeline**
- **FR-001**: System MUST extract all exported interfaces, types, classes, and function signatures from TypeScript/JavaScript files using AST parsing (never LLM inference)
- **FR-002**: System MUST follow the three-stage hybrid pipeline (Pre-processing → Context Assembly → Generation & Enrichment) for all code analysis
- **FR-003**: System MUST keep per-file analysis context within 100k tokens by using skeleton code instead of full source
- **FR-004**: System MUST fall back to error-tolerant parsing when the primary parser encounters syntax errors
- **FR-005**: System MUST trigger chunk-summary strategy for files exceeding 5,000 LOC

**Spec Generation (/reverse-spec)**
- **FR-006**: System MUST produce spec documents following the 9-section structure (意图, 接口定义, 业务逻辑, 数据结构, 约束条件, 边界条件, 技术债务, 测试覆盖, 依赖关系)
- **FR-007**: System MUST generate Mermaid class diagrams and dependency graphs and embed them in spec documents
- **FR-008**: System MUST mark uncertain or inferred content with `[推断]`, `[不明确]`, or `[SYNTAX ERROR]` markers with accompanying rationale
- **FR-009**: System MUST include YAML frontmatter with type, version (incremental counter, e.g. v1, v2), generator, source target, related files, confidence level, and last updated date — version increments on each regeneration or drift-confirmed update, with Git history as the authoritative change log

**Batch Processing (/reverse-spec-batch)**
- **FR-010**: System MUST construct a project-wide dependency graph and process modules in topological order (foundation first)
- **FR-011**: System MUST detect circular dependencies and treat strongly connected components as single processing units
- **FR-012**: System MUST support resumable batch processing (skip already-generated specs unless `--force`)
- **FR-013**: System MUST generate an architecture index (`specs/_index.spec.md`) with system purpose, module map, cross-cutting concerns, and technology stack
- **FR-014**: System MUST read previously generated specs' interface definitions (not source code) when processing higher-level modules (O(1) context strategy)
- **FR-015**: System MUST display real-time terminal progress during batch processing (e.g., `[3/50] Processing src/auth...`) and generate a batch summary log upon completion listing all modules with their status (success/failure/skipped)
- **FR-016**: System MUST retry failed LLM API calls with exponential backoff (max 3 attempts, short intervals), then degrade to AST-only spec output and continue processing remaining modules
- **FR-017**: System MUST support breakpoint resume for batch processing — when interrupted or paused due to LLM failures, users can resolve the issue and resume from the last completed module

**Drift Detection (/reverse-spec-diff)**
- **FR-018**: System MUST produce drift reports categorizing differences as HIGH (breaking), MEDIUM (logic), or LOW (addition) severity
- **FR-019**: System MUST perform structural diff on exported symbols (added/removed/modified signatures)
- **FR-020**: System MUST delegate behavioral change assessment (function body logic) to LLM semantic evaluation
- **FR-021**: System MUST filter noise (whitespace, comments, import reordering) from drift reports
- **FR-022**: System MUST NOT update specs from drift reports without explicit user confirmation

**Cross-Cutting**
- **FR-023**: System MUST NOT modify, create, or delete any source code files in the target directory (read-only guarantee)
- **FR-024**: System MUST write output only to `specs/` and `drift-logs/` directories
- **FR-025**: System MUST write all spec prose in Chinese while preserving English for code identifiers, file paths, and type signatures
- **FR-026**: System MUST respect `.gitignore` rules and not analyze ignored files unless explicitly overridden by the user
- **FR-027**: System MUST auto-detect and redact common secret patterns (API keys, tokens, database credentials, private keys) from source code before including it in LLM context assembly

### Key Entities

- **CodeSkeleton**: The AST-extracted structure of a source file — file path, exported symbols (name, kind, signature, JSDoc), and dependency references. This is the core intermediate representation that flows between pipeline stages.
- **DriftItem**: A single difference between a spec and current code — severity level (HIGH/MEDIUM/LOW), category (Interface/Behavior/Constraint), source location, human-readable description, and proposed spec update text.
- **DependencyGraph**: The project-wide module import relationship map — directed edges between modules, topological sort order, identified strongly connected components (circular dependencies), and Mermaid diagram source.
- **ModuleSpec**: The generated specification document for a single module — YAML frontmatter, 9 mandatory Chinese-language sections, embedded Mermaid diagrams, and a file inventory appendix.
- **ArchitectureIndex**: The project-level overview document — system purpose, architecture pattern, module map with links to individual specs, cross-cutting concerns (auth, error handling, logging, config), and technology stack summary.
- **DriftReport**: The output of `/reverse-spec-diff` — summary statistics, additions table, removals table, modifications table, and a recommendation section. Written to `drift-logs/`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can generate a complete, 9-section structured spec from any TypeScript module in a single `/reverse-spec` command invocation
- **SC-002**: 100% of interface definitions in generated specs match source code exactly (zero fabricated signatures verified against AST)
- **SC-003**: 500 files can be preprocessed (AST parsed and skeleton extracted) within 10 seconds
- **SC-004**: Generated specs for a known open-source project (e.g., `redux` subset) match a pre-validated golden master at 90%+ structural similarity
- **SC-005**: Batch processing of a 50-module project completes end-to-end without manual intervention (beyond initial confirmation)
- **SC-006**: Drift detection correctly identifies 95%+ of signature-level changes (additions, removals, modifications) between spec and code
- **SC-007**: All noise (whitespace, comment-only, import reordering changes) is filtered from drift reports with zero false positives
- **SC-008**: The generated `_index.spec.md` accurately reflects the project's module structure and dependency relationships
- **SC-009**: Self-hosting test passes: running `/reverse-spec-batch` on the reverse-spec project itself produces a valid, coherent set of specs

### Assumptions

- Target codebases are primarily TypeScript/JavaScript; non-TS/JS languages receive degraded (pure-LLM) analysis without AST enhancement
- Node.js LTS is available in the execution environment (Claude Code sandbox or local machine)
- The primary AST parser (`ts-morph`) provides sufficient capability for the vast majority of TS/JS codebases; `tree-sitter` is only needed for syntactically broken files
- Users interact with the system through Claude Code slash commands and expect Chinese-language output with English code identifiers
- The Anthropic Claude API (Sonnet/Opus) is available for LLM enrichment steps
- The npm packages `ts-morph`, `dependency-cruiser`, `handlebars`/`ejs`, and `zod` are installable in the target environment
