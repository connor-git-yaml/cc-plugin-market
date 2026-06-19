# Domain Knowledge Scaffold Guide (`scaffold-kb`)

> Feature 190 (MVP) + Feature 192 (API entity layer, third-party ingest, conflict arbitration).
> A how-to for **building a vendor documentation knowledge base, packaging it as a Claude Code
> plugin, and querying it open-box** — so an AI assistant can cite vendor docs as well as code.

## When to use this

Spectra already turns the **source-code side** of a project into a queryable knowledge graph
(17 MCP tools). `scaffold-kb` complements it on the **documentation side**: API references,
quick-starts, error-code tables, version changelogs. The target shape is generic:

- A **vendor** (any SDK / PaaS / library author) builds a KB from their public docs once.
- They **package it into a Claude Code plugin** and publish it to a marketplace.
- An **integrator** installs the plugin and queries the SDK's docs open-box — and can layer
  **project-specific** knowledge on top in a writable project KB.

Throughout this guide, "vendor", "integrator", and "some SDK" are generic roles — substitute
your own. (The repo ships two demo fixtures, `plugins/demo-kb-zh/` and `plugins/demo-kb-en/`,
built from a public open-source SDK's docs purely as representative examples.)

## 1. Build the KB

```bash
# From a local documentation directory…
spectra scaffold-kb build --dir path/to/docs --output kb/

# …or from an llms.txt URL
spectra scaffold-kb build --llms-txt https://example.com/llms.txt --output kb/
```

This produces a self-contained `kb/`:

| Artifact | Contents |
|----------|----------|
| `doc-graph.json` | Document-structure graph (titles, summaries, cross-references) |
| `chunks.sqlite` | FTS5 full-text index over doc chunks |
| `api-entities.json` | Structured API entities — signature / params / deprecation / since-version (F192) |

Useful flags:

- `--lang <code>` — tokenizer hint. **CJK doc sets need this**: SQLite's `unicode61` tokenizer
  does not word-segment Chinese, and `trigram` fails on symbols shorter than 3 chars. Pick the
  language that matches your docs so short error codes and dotted API symbols (`a.b.formatter`)
  stay searchable.
- `--sdk-version <ver>` — stamps the KB with the SDK version it represents (flows into evidence provenance).
- `--no-llm` — heuristic-only build; skips the optional LLM entity-extraction pass.

Source documents should start with a `# Title` first line so `scaffold-kb` can extract the doc title.

## 2. Package as a plugin

Lay the KB out as a Claude Code plugin so integrators get it open-box. Minimal structure
(mirrors the shipped demo fixtures):

```text
my-sdk-kb/
├── .claude-plugin/
│   └── plugin.json          # name / version / description / license
├── .mcp.json                # registers the KB MCP server
└── kb/                      # the scaffold-kb build output
    ├── doc-graph.json
    ├── chunks.sqlite
    └── api-entities.json
```

`.mcp.json` wires the server to the packaged KB via `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "my-sdk-kb": {
      "command": "spectra",
      "args": ["scaffold-kb", "serve", "--vendor-kb", "${CLAUDE_PLUGIN_ROOT}/kb"]
    }
  }
}
```

The vendor KB ships **read-only** (frozen at package time). Publish the plugin to a marketplace
the same way as any other Claude Code plugin (see the main [README](../README.md#plugin-installation)).

## 3. Query open-box (integrator)

Once the plugin is installed, the KB MCP server exposes three tools (reusing the Spectra MCP
`{code}` response contract + per-call telemetry):

| Tool | Use it when |
|------|-------------|
| `kb_search` | You have an SDK / error-code question → returns doc chunks tagged `[KB-EVIDENCE]` with source/version |
| `kb_api_lookup` | Before writing a call → look up an entity's signature / params / deprecation / since-version |
| `kb_doc_lookup` | You need to navigate doc structure → by doc id or title keyword |

Typical chain: hit an unfamiliar API or error code → `kb_search` for sourced chunks → confirm
the interface with `kb_api_lookup` → `kb_doc_lookup` if you need surrounding structure.

> **Untrusted-evidence boundary.** KB results are consumed as *untrusted evidence*: every
> result carries a source/version trace and a token cap (defense against prompt injection from
> doc content). `kb_api_lookup` validates params and deprecation **against the docs**
> (evidence-grade) — it is "what the docs say", **not** a check against the actually-installed
> SDK code or version.

You can also do a one-shot CLI query (handy for scripting or a quick check), which previews
exactly what would be injected:

```bash
spectra scaffold-kb query --requirement "how do I paginate list results?" \
  --vendor-kb kb/ --top-k 5 --format markdown
```

`--probe` is a separate availability check: it emits only a sentinel line and exits without
running the query — use it to detect whether the query path is wired, not to preview output.

## 4. Layer project-specific knowledge

Integrators maintain a **writable project KB** alongside the read-only vendor KB. Ingest pages,
files, or meeting notes into it:

```bash
spectra scaffold-kb ingest --url https://internal-wiki/... --project-kb .spectra-kb/ --yes
spectra scaffold-kb ingest --file adapter-notes.md --project-kb .spectra-kb/ --dry-run
spectra scaffold-kb ingest --minutes meeting-notes.md --project-kb .spectra-kb/ --yes
```

Serve both layers together so queries join across them:

```bash
spectra scaffold-kb serve --vendor-kb kb/ --project-kb .spectra-kb/
```

When the vendor docs and project notes disagree, the integrator always sees both with
provenance — nothing is silently dropped. For `kb_search` this means both layers are merged and
the result carries a **freshness hint** (which copy is newer) when the same doc appears in both;
structured conflict **arbitration** (picking/flagging a recommended value) is at the API-entity
level via `kb_api_lookup`.

> Ingest from URLs goes through an SSRF-guarded fetcher (protocol allow-list + IP-literal checks
> + per-hop redirect re-validation); office-document parsing is streaming + zip-bomb guarded.
> Use `--dry-run` first to preview what would be added.

## Boundaries & non-goals (MVP)

- KB content is **evidence**, not ground truth — always check the source/version trace.
- `kb_api_lookup` entities are extracted from docs, not from compiled SDK code.
- Document↔source-symbol anchoring (joining a doc entity to a Spectra graph symbol) is future
  work, converging with the AST-anchored drift engine.

## See Also

- [Spectra CLI Reference — Domain Knowledge Scaffold](spectra-cli-reference.md#domain-knowledge-scaffold-scaffold-kb-feature-190192)
- Demo fixtures: `plugins/demo-kb-zh/` · `plugins/demo-kb-en/` (each ships a `FIXTURE.md` describing its source)
