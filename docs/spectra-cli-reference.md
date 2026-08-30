# Spectra CLI Reference

Full command reference for `spectra` CLI. See [main README](../README.md) for high-level overview.

## Commands

```bash
# Single module spec generation
spectra generate src/auth/ --deep

# AST preprocessing only (no LLM, no auth required)
spectra prepare src/auth/ --deep

# Batch spec generation for entire project
spectra batch --force

# Lightweight reading mode — skip product-doc generators, faster batch (F5)
spectra batch --mode=reading

# Pure AST mode — skip enrichment layer (still calls per-module spec-gen LLM)
spectra batch --mode=code-only

# Graph-only mode — pure AST, zero LLM, no auth required, <2min scale (F195)
# Builds call graph + knowledge graph → graph.json only; skips ALL spec-gen LLM.
# Fastest way to bootstrap a graph in a fresh worktree.
spectra batch --mode=graph-only

# Generate interactive graph.html visualization after batch (F5)
spectra batch --html
spectra batch --mode=reading --html

# Enable LLM hyperedge extraction (opt-in, requires --mode=full)
spectra batch --hyperedges
SPECTRA_HYPEREDGES_ENABLED=true spectra batch --mode=full   # env equivalent

# Enable ADR pipeline (disabled by default in v4.0.1+ pending evidence-binding refactor)
spectra batch --enable-adr

# Spec drift detection (single-spec structural/semantic diff)
spectra diff specs/auth.spec.md src/auth/

# Graph quality gates — six machine-checked indicators (F217)
# duplicate-canonical-id / contains-coverage / orphan-ratio / dangling-edge /
# legacy-ignored / freshness (graph sourceCommit vs HEAD; stale is explicit, never silent).
# Runs inside repo:check as its own check family; exit 0 = pass.
spectra graph-quality [--graph <path>] [--json] [--output <path>] [--format json|text]
spectra graph-quality --status [--json]   # freshness/status probe only

# Custom output directory
spectra generate src/auth/ --output-dir out/

# Check authentication status
spectra auth-status --verify

# Install skills to current project / globally
spectra init [--global] [--target claude|codex|both]

# Remove installed skills
spectra init --remove [--target claude|codex|both]

# Merge cached architecture IR + generated specs into _meta/graph.json.
# NOT a rebuild: it does not parse source. Refuses to overwrite a richer existing graph
# (fewer nodes, fewer edges, or fewer `calls` edges) and exits 1; pass --force to override.
spectra graph [--directed] [--force]

# Community detection — outputs GRAPH_REPORT.md
spectra community

# Export to Obsidian Vault (bidirectional links + frontmatter + Graph View compatible)
spectra export --format obsidian --output-dir obsidian-vault/

# Export to HTML interactive visualization (writes <output-dir>/graph.html)
spectra export --format html --output-dir docs/

# Watch for file changes and incrementally sync specs and graph
spectra watch

# Cache management
spectra cache stats
spectra cache clear

# Dry-run cost estimation (Phase 2 F1)
spectra batch --dry-run
spectra batch --budget 50000 --on-over-budget cancel   # CI-friendly budget gate

# Domain knowledge scaffold — build / query a vendor doc knowledge base (F190/F192)
spectra scaffold-kb build (--dir <path> | --llms-txt <url>) [--output <kb/>] [--sdk-version <ver>] [--lang <code>] [--no-llm]
spectra scaffold-kb ingest (--url <url> | --file <path> | --minutes <path>) [--project-kb <path>] [--yes|--dry-run] [--no-llm]
spectra scaffold-kb serve --vendor-kb <path> [--project-kb <path>]
spectra scaffold-kb query --requirement "<need>" --vendor-kb <path> [--top-k N] [--max-inject-chars N] [--format markdown|json] [--probe]
spectra scaffold-kb coverage-gap [--format markdown|json]
spectra scaffold-kb version --package <name> [--project-root <path>] [--sdk-version <ver>] [--format markdown|json]
spectra scaffold-kb status (--vendor-kb <path> | --project-kb <path>) [--format markdown|json]

# Natural-language Q&A over the knowledge graph (no graph rebuild; reads specs/_meta/graph.json)
spectra query "<question>" [--budget <N>] [--format json|text]

# UnifiedGraph index — writes .spectra/unified-graph.json (NOT specs/_meta/graph.json).
# Consumed by panoramic / IDE tooling. To fix a `graph-not-built` MCP error you want
# `spectra batch --mode graph-only` instead — see Exit Codes / Troubleshooting below.
spectra index [--watch] [--incremental] [--caller-depth <N>] [--project-root <dir>]

# Panoramic analyses over cached architecture IR
spectra panoramic <cross-package|architecture-ir|overview> [--json] [--project-root <dir>]

# Dependency-direction audit (layering violations); snapshot + compare for regression gating
spectra direction-audit [--graph <path>] [--output <path>] [--format json|text]
spectra direction-audit --snapshot <path>
spectra direction-audit --compare-snapshot <path>

# Start the MCP stdio server (exposes the 18 MCP tools to Claude Code / Cursor / Codex)
spectra mcp-server

# Version (includes build commit suffix when build metadata is present — F186)
spectra --version
```

## Knowledge Graph & Visualization

Spectra builds a unified knowledge graph (`_meta/graph.json`) from all generated docs and architecture analysis. This graph powers community detection, architecture insights, multi-format export, and MCP real-time queries.

### Step 1 — Build the Graph

```bash
spectra batch                    # full run: specs + graph (writes _meta/graph.json itself)
spectra batch --mode graph-only  # graph only: pure AST, zero LLM, no auth, <2min
```

`spectra batch` **already writes the graph** — there is no second "now build the graph" step.
The former two-step recipe (`spectra batch` then `spectra graph`) is gone: `spectra graph` merges
only the cached architecture IR, already-generated `.spec.md` files and the cross-reference index —
a strict subset of what `batch` puts in the graph — so running it after `batch` degrades the graph.
Since F266 that overwrite is refused by an information-loss guard and the command exits 1
(see `spectra graph` below).

> **Graphs built before F271 carry no symbol line numbers.** Any `specs/_meta/graph.json`
> produced by 4.5.0 or earlier lacks `metadata.lineRange` on symbol nodes, so
> `view_file(symbolId)` cannot slice to the symbol (it returns the default window and warns
> `lineRange-unavailable`) and `context` reports no `definition` line numbers. Rebuild with
> `spectra batch --mode graph-only` (pure AST, zero LLM, no auth, <2min) to activate both.
> Member nodes (`Class.method`) and regex-fallback symbols stay absent by design — the
> underlying extraction has no trustworthy span for them.

### Step 2 — Community Detection & Architecture Insights

```bash
spectra community
```

Outputs `_meta/GRAPH_REPORT.md` containing:
- Detected communities (logical subsystems found by Louvain algorithm)
- God Node hotspots (over-coupled modules)
- Anomalous edges (unexpected cross-boundary dependencies)
- Architecture health summary

### Step 3 — Export to Obsidian Vault

```bash
spectra export --format obsidian --output-dir obsidian-vault/
```

Each spec becomes an Obsidian note with:
- `[[bidirectional links]]` to related modules
- YAML frontmatter (module, language, spec version, community label)
- Graph View compatible — open the vault in Obsidian and use **Graph View** to visually navigate architecture relationships

Open the exported vault in Obsidian:
1. **File → Open Vault…** → select the `obsidian-vault/` directory
2. Open **Graph View** (Ctrl/Cmd+G) to explore module relationships interactively
3. Use the community labels in the frontmatter to filter by subsystem

### Step 4 — HTML Interactive Visualization

```bash
spectra export --format html --output-dir docs/   # writes docs/graph.html
# or generate inline during batch:
spectra batch --html
```

Generates a self-contained HTML file with a D3-force interactive graph:
- Pan, zoom, and click nodes for module details
- Color-coded by community
- Hyperedge convex hull overlays (when `--hyperedges` opt-in active)
- No server required — open directly in a browser or host on any static site

### Continuous Sync

Keep docs and graph fresh automatically:

```bash
# Watch mode — debounced incremental rebuild on file change
spectra watch

# Install the PreToolUse auto-injection hook (Claude Code), and add --git for the
# git post-commit hook. The hook runs `spectra batch --mode graph-only` in the
# background after each commit that touches code -- a full pure-AST rebuild (zero LLM,
# no auth), not an incremental parse. It is killed after 180s.
spectra install          # PreToolUse hook only
spectra install --git    # also installs the post-commit graph-rebuild hook
```

**Where the hook's diagnostics go.** Everything — stdout, stderr, the timeout notice and a
non-zero exit code — is *appended* to `<git-dir>/spectra-post-commit.log`, one `=== run <UTC ts> ===`
header per run. Appending (rather than truncating) is what keeps a failed run's marker alive when a
second commit follows seconds later; the file is rotated to `spectra-post-commit.log.old` once it
grows past 200 KB. Nothing is printed to the terminal: the hook's subshell detaches from git's
stdout/stderr on purpose, because keeping those descriptors open blocks any consumer that reads
commit output until EOF (command substitution, CI runners, IDEs) for as long as the rebuild takes.
Silence on the terminal is the price of not blocking the commit — check the log file to see whether
a rebuild succeeded.

**One rebuild at a time.** A rebuild takes a lock at `<git-dir>/spectra-rebuild.lock` (an atomic
`mkdir`). If another rebuild is still running — the timeout window is 180s — the new hook run logs
`skipped: another rebuild in progress` and exits instead of racing it: two concurrent rebuilds would
overwrite the same `graph.json` last-writer-wins, and the resulting staleness is already covered by
the freshness advisory on every MCP response. A lock left behind by a killed process is reclaimed
after 4 minutes — the reclaiming run first *renames* the stale lock to a private path, so only one
racer can ever claim it.

**Commits that arrive during a rebuild are not dropped.** A run that yields the lock also touches
`<git-dir>/spectra-rebuild-requested`. When the lock holder finishes, it sees that marker and runs
one more rebuild pass, so a burst of commits (a rebase replay, for instance) ends with a graph built
from the *last* commit's tree rather than the first one's. The holder runs at most two passes per
invocation; beyond that it logs a line and leaves the remaining staleness to the freshness advisory.

**Upgrading an existing install.** The hook segment is replaced as a whole between its
`# --- spectra begin/end ---` markers and is *not* rewritten retroactively. If you installed the
hook before F266 you still have the old segment (which ran `spectra graph`, a non-rebuild).
Re-running `spectra install --git` is idempotent and will *skip* an already-installed segment, so
migrate explicitly: `spectra install --remove --git && spectra install --git`.

### Worktree Bootstrap & Keepalive (Feature 193)

In a **multi-worktree workflow** (one git worktree per feature), each new worktree starts
without a `specs/_meta/graph.json`, so the 18 Spectra MCP tools (`impact` / `context` / …)
are unavailable until a graph exists. Since Feature 193, graph node/edge ids and the
incremental snapshot are **relative + POSIX-normalized**, making the graph portable across
worktrees. This enables two things:

**1. Open-box bootstrap (no rebuild).** The worktree-init hook copies the graph (and the
`.spectra/unified-graph.json` snapshot, when present) from the primary repo:

```bash
# Run inside a fresh worktree — copies graph + snapshot from the primary repo if absent.
# copy-if-absent + atomic: never overwrites a worktree's locally-evolved graph.
bash scripts/sync-worktree-local-state.sh
```

After this the MCP tools work immediately against the copied graph. A
`specs/_meta/graph-bootstrap-status.json` state file records how the graph got there
(`bootstrapSource`: `primary-copy` | `local-build` | `none` | `unknown`) plus the embedded
source commit and worktree HEAD observed at bootstrap time. Freshness itself is **computed
live** on every run (by delegating to `spectra graph-quality --json`, which reads the graph's
own embedded `graph.sourceCommit`) — the state file never caches a stale boolean. `stale` and
`unknown-provenance` print a non-blocking hint; `fresh` and `dirty` stay silent.

Pass `--attempt-build` (Codex-managed worktrees) to fall back to `spectra batch --mode
graph-only` when the graph can neither be copied from the primary repo nor already exists
locally; failures never block the rest of the sync.

> Superseded (Feature 239): the former `specs/_meta/.graph-source-commit` sidecar is gone —
> it was only written when a copy actually happened and recorded the *primary repo's HEAD*
> rather than the graph's true origin, so locally rebuilt graphs always carried wrong
> provenance. Any leftover sidecar is deleted on the next sync.

> The bootstrap only works once the **primary repo's graph is itself in the relative-id
> format** (i.e. rebuilt with Feature 193+). A pre-F193 absolute-id graph copied in is
> detected at load time and reported as `graph-format-stale` (with a rebuild hint) rather
> than silently returning wrong results — rebuild the primary once with `spectra batch`.

**2. Keepalive (staying fresh).** To keep the bootstrapped graph fresh as you edit,
activate one of the existing refresh paths:

```bash
spectra install --git  # post-commit hook → full pure-AST graph rebuild after each commit
# or
spectra watch          # debounced incremental rebuild on file save
```

The two paths differ: the post-commit hook shells out to `spectra batch --mode graph-only`,
which re-parses the whole tree from scratch on every code commit (no snapshot involved).
`spectra watch` is the incremental one — because the snapshot is portable (relative
`fileHashes` keys), its incremental updates resume correctly in the new worktree, and when no
snapshot was bootstrapped the first run safely falls back to a full reindex.

## Spec Drift Anchors (repo-level, Feature 219)

Beyond single-spec `spectra diff`, the repo ships an **AST-anchored spec drift** toolchain:
pin a spec's code references to canonical symbol IDs, then mechanically detect when the
anchored symbols drift (normalized-AST fingerprint — formatting-insensitive; identifier /
literal / control-flow changes flip the anchor to `stale`).

```bash
# Create / refresh anchors from a reference manifest (atomic lock write)
npm run drift:link -- --manifest <path> [--refresh [--id <id>]]

# Re-check all persisted anchors (exact canonical-ID match, no fuzzy re-resolution)
npm run drift:check -- [--strict]

# Remove one anchor by id
npm run drift:unlink -- <id>
```

State lives in a versioned lock file; `drift:check` also runs inside `repo:check` as its own
check family (stale/orphaned anchors surface as warnings by default; `--strict` hard-fails —
CI-friendly). Renames are honestly reported as `orphaned` (rename-follow is a later phase).

## Domain Knowledge Scaffold (`scaffold-kb`, Feature 190/192)

While the knowledge graph above captures the **source-code side** of a project, `scaffold-kb`
captures the **vendor-documentation side** (API reference, quick-start, error-code tables,
version changelogs) — so an AI assistant can cite vendor docs as well as code.

It builds a self-contained knowledge base under `kb/` (`doc-graph.json` document-structure
graph + `chunks.sqlite` FTS5 full-text layer; F192 adds `api-entities.json` for structured
API lookup), which a vendor can **package into a Claude Code plugin** and ship to integrators.

### Build a KB from docs

```bash
# From a documentation directory…
spectra scaffold-kb build --dir path/to/docs --output kb/

# …or from an llms.txt URL
spectra scaffold-kb build --llms-txt https://example.com/llms.txt --output kb/
```

`--no-llm` skips the optional LLM entity-extraction pass (heuristic-only). `--lang <code>`
hints the tokenizer (CJK doc sets need this — `unicode61` does not word-segment Chinese).

### Serve as an MCP server

```bash
spectra scaffold-kb serve --vendor-kb kb/ [--project-kb .spectra-kb/]
```

This exposes three KB MCP tools (reusing the Spectra MCP `{code}` contract + telemetry):

| Tool | Purpose |
|------|---------|
| `kb_search` | Full-text search over doc chunks (vendor + project KB joined); returns chunks tagged with `[KB-EVIDENCE]` source/version provenance |
| `kb_doc_lookup` | Document navigation by doc id / title keyword (title / summary / cross-references) |
| `kb_api_lookup` | Structured API entity lookup by name (signature / params / deprecation / since-version) |

> **Untrusted-evidence boundary**: KB content is consumed as *untrusted evidence* — every
> result carries a source/version trace and a token cap. `kb_api_lookup` validates params and
> deprecation **against the docs** (evidence-grade), not against the actually-installed SDK
> code/version. Treat it as "what the docs say", not a code-level guarantee.

### Ingest project-level knowledge

```bash
# Add a web page / office file / meeting-notes into the writable project KB
spectra scaffold-kb ingest --url https://… --project-kb .spectra-kb/ --yes
spectra scaffold-kb ingest --file vendor-spec.docx --project-kb .spectra-kb/ --dry-run
spectra scaffold-kb ingest --minutes notes.md --project-kb .spectra-kb/ --yes
```

Three source kinds: `--url` (SSRF-guarded fetch), `--file` (office `docx/pptx/pdf` via
`office-parser`, or Markdown), `--minutes` (free-form notes). Always **preview → confirm**:
a bare run or `--dry-run` only previews; `--yes` commits. `--project-kb` defaults to `.spectra/kb`.
Exit codes: `0` success/preview · `1` all sources failed (nothing committed) · `2` partial success.

The **vendor KB is read-only** (frozen at package time); the **project KB is read-write**
(maintained by integrators). `kb_search` joins both layers and adds a freshness hint when the
same doc appears in both (both results are always shown — no silent pick); structured conflict
arbitration is at the API-entity level via `kb_api_lookup`.

> Full how-to (build → package as a plugin → integrator open-box query): see
> [Domain Knowledge Scaffold Guide](scaffold-kb-guide.md).

## Architecture

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
    └── MCP graph_query / graph_node / graph_path / graph_community / graph_god_nodes / graph_hyperedges
```

## v4.1.0 Performance & Behavior Notes

> Spectra v4.1.0 (Feature 140) refactored the doc pipeline to a MapReduce architecture (cluster orchestrator + Sonnet map + Opus reduce). Behavior changes user-visible during `spectra batch`:

### Batch latency

- **Medium-sized projects (10-30 modules)**: end-to-end batch increases by **60-120s** vs. v4.0.x. The new pipeline runs 3 LLM rounds (Map → Reduce → Critique) for each of ADR / hyperedges / architecture-narrative, in exchange for grounded outputs and resilience on large projects.
- **Small projects (< 5 modules)**: latency is roughly unchanged (clustering falls back to `single` strategy; only one Map call per pipeline).
- **Large projects (50+ modules)**: latency scales linearly with cluster count rather than module count, because Map runs cluster-parallel (`p-limit(maxConcurrency=4)`). Previously, large projects could hit context-window limits in monolithic LLM calls; v4.1.0 resolves this via the FFD packing.
- Inspect `_meta/cost-summary.md` (or watch `process.stderr` during batch) for the **Top 5 input-token consumer modules** — useful for spotting accidentally bloated context.

### ADR generation behavior

- ADR pipeline is **opt-in** via `--enable-adr` (unchanged from v4.0.1).
- When enabled, **0 ADRs is now a possible outcome** — v4.1.0 generates ADR candidates only from real evidence (file paths + line ranges + snippet match), not from keyword matching against hardcoded templates. Previous v4.0.x output of "always 4 ADRs" was the hallucination bug this release fixes. With v4.1.0, 0 ADRs can mean either: (a) the project genuinely has too little verifiable decision-evidence in code/comments, or (b) a failure mode triggered (Reduce model unavailable, evidence verification rejected all candidates, etc.). Both cases currently surface the same stderr warning (`ADR LLM 路径 fail-closed (reason: <reason>)`); a future release will distinguish them. Check the warning's `reason` field when present, and inspect the generated `docs/adr/index.md` — it lists no drafts in either case, but stderr will indicate why.
- Each ADR's frontmatter now contains `generatedByModel: { map, reduce }` (full provenance — Sonnet model for Map / Opus or Sonnet-fallback model for Reduce). The verified evidence list is rendered in the body under `## Evidence`, where each ref shows `source`, `location`, and an `(UNVERIFIED: <reason>)` annotation when programmatic file/line/snippet validation fails.
- Older v4.0.x ADRs in `docs/adr/*.md` are auto-migrated: `status` set to `superseded` + `supersededAt: 4.1.0`. Files are not deleted.

### `graph.html` defaults

- `graph.html` is now **always generated** by `spectra batch` (previously opt-in via `--html`). Use `--no-html` to skip. This aligns the batch output set with `graph.json` and `GRAPH_REPORT.md`, which were always generated.
- For very small projects (< 3 nodes), the rendered `graph.html` shows a banner explaining that the graph has too few cross-module references to be meaningful, and recommends rerunning with `--include-docs`.

### Module spec frontmatter

Each generated `*.spec.md` now includes (when LLM was actually called):

```yaml
costBreakdown:
  contextAssembly: <input tokens consumed by cross-module context>
  promptTemplate: <input tokens of the prompt template itself>
  sourceFile: <input tokens of the target module's skeleton>
  llmReasoning: <output tokens generated>
contextTruncated: <boolean — whether context-assembler trimmed inputs to fit budget>
```

Use this to debug "why is module X so expensive" — typically the `contextAssembly` line tells the story.

## Authentication

Three modes, auto-detected (priority ordered dynamically by runtime):

| Mode | Setup | Use case |
|------|-------|----------|
| **API Key** | `export ANTHROPIC_API_KEY=sk-...` | Direct SDK access |
| **Claude Code CLI** | `claude auth login` | Claude subscription, no API key required (CLI proxy) |
| **Codex CLI** | `codex login` | Codex subscription login state (CLI proxy) |

Verify with `spectra auth-status --verify`.

## Version & build metadata

`spectra --version` reports the package version with a **build commit suffix** when build
metadata (`.spectra-build-meta.json`) is present (Feature 186) — this lets you tell two
binaries of the same package version apart (e.g. a stale global install vs. a fresh build).
In a dev environment that has not run the build-stamping step, it gracefully falls back to the
bare version string.

## Exit Codes

By convention `spectra` sets `process.exitCode` and lets the process drain rather than calling
`process.exit()`. The exceptions are the long-running commands, which must terminate an active
event loop: `spectra watch` (`cli/commands/watch.ts`) and `spectra mcp-server`
(`cli/commands/mcp-server.ts`) both call `process.exit()` on shutdown. (The hook script emitted
by `hooks/hook-installer.ts` also contains a `process.exit(0)`, but that lives inside an embedded
`node -e` snippet run by the hook — it is not the `spectra` CLI process.)

The global convention is **0 = success, 1 = target/input error *or* "check did not pass",
2 = fatal / cannot proceed**, with one documented exception (row 7).

| # | Code | Meaning | Where |
|---|------|---------|-------|
| 1 | `0` | Success | — |
| 2 | `1` | Target path does not exist / invalid target (`TARGET_ERROR`) | `error-handler.ts` (`EXIT_CODES.TARGET_ERROR`); used by `prepare`, `diff`, and `index` |
| 2b | `1` | **Check did not pass** — reusing `TARGET_ERROR` as a gate signal, *not* a path error: `spectra diff` exits 1 when it detects HIGH **or MEDIUM** drift (only-LOW exits 0), and `spectra direction-audit` exits 1 when a compared snapshot shows new/increased layering violations | `cli/commands/diff.ts`, `cli/commands/direction-audit.ts` |
| 3 | `2` | LLM / API error (`API_ERROR`) | `error-handler.ts` (`EXIT_CODES.API_ERROR`) |
| 4 | `2` | Catch-all for any unclassified error (shares `API_ERROR` despite the name) | `error-handler.ts` — final `return` of the error handler |
| 5 | `2` | Uncaught fatal error at the top level | `cli/index.ts` |
| 6 | `2` | Index execution failed (`spectra index`, full or incremental) | `cli/commands/index.ts` |
| 7 | `2` | Succeeded **with gaps** — some sources failed, successful parts were still written | `cli/commands/scaffold-kb.ts` |
| 8 | `3` | Budget gate cancelled the run (`BUDGET_EXCEEDED`) — lets CI distinguish "0 modules, fine" from "stopped by budget" | `error-handler.ts` (`EXIT_CODES.BUDGET_EXCEEDED`); `spectra batch --budget N --on-over-budget cancel` |

### Known exception — `spectra graph-quality`

`graph-quality` uses its own, **independent** semantic domain and its 1/2 direction is the
**reverse** of the table above:

| `overallVerdict` | Exit code |
|---|---|
| `pass` / `pass-with-warnings` | `0` |
| `fail-strong-invariant` (a real quality failure) | `1` |
| `cannot-assess` (the gate could not evaluate the graph at all) | `2` |

This is intentional and **not** normalised: the behaviour is locked in by Feature 266 tests,
and within `graph-quality` the ordering reads as "worse evidence ⇒ higher code" (a failure you
can trust is more actionable than a verdict you cannot compute). Script against
`graph-quality`'s codes using this table, not the global convention.

## See Also

- [Knowledge Graph & MCP Tools (in main README)](../README.md#-how-ai-coding-assistants-use-spectra)
- [Domain Knowledge Scaffold Guide](scaffold-kb-guide.md) — build & ship a vendor KB plugin
- [Spec Driver Configuration](configuration.md)
- [Repository Architecture](repository-architecture.md)
