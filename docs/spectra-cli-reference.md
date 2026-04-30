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

# Pure AST mode — skip all LLM inference (F5)
spectra batch --mode=code-only

# Generate interactive graph.html visualization after batch (F5)
spectra batch --html
spectra batch --mode=reading --html

# Enable LLM hyperedge extraction (opt-in, requires --mode=full)
spectra batch --hyperedges
SPECTRA_HYPEREDGES_ENABLED=true spectra batch --mode=full   # env equivalent

# Enable ADR pipeline (disabled by default in v4.0.1+ pending evidence-binding refactor)
spectra batch --enable-adr

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

# Dry-run cost estimation (Phase 2 F1)
spectra batch --dry-run
spectra batch --budget 50000 --on-over-budget cancel   # CI-friendly budget gate
```

## Knowledge Graph & Visualization

Spectra builds a unified knowledge graph (`_meta/graph.json`) from all generated docs and architecture analysis. This graph powers community detection, architecture insights, multi-format export, and MCP real-time queries.

### Step 1 — Build the Graph

```bash
spectra batch          # generate or refresh all module specs first
spectra graph          # builds _meta/graph.json
```

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

### Step 4 — HTML Interactive Visualization

```bash
spectra export --format html --output docs/graph.html
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

# Or install post-commit hook (triggers after every git commit)
spectra install
```

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

Two modes, auto-detected:

| Mode | Setup | Use case |
|------|-------|----------|
| **API Key** | `export ANTHROPIC_API_KEY=sk-...` | Direct API access, takes priority |
| **Claude CLI proxy** | `claude auth login` | Subscription-based, no API key required |

Verify with `spectra auth-status --verify`.

## See Also

- [Knowledge Graph & MCP Tools (in main README)](../README.md#-how-ai-coding-assistants-use-spectra)
- [Spec Driver Configuration](configuration.md)
- [Repository Architecture](repository-architecture.md)
