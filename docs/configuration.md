# Spec Driver Configuration

Two complementary configuration files for project-level customization:

| File | Purpose | When to use |
|------|---------|-------------|
| **`spec-driver.config.yaml`** | Model selection, preset, retry, verification commands | Choose Sonnet vs Opus, set Codex aliases, customize verify commands |
| **`.specify/orchestration-overrides.yaml`** | Phase sequences, gate behaviors, parallel concurrency | Customize SDD workflow itself (which phases run, when gates pause) |

Both are project-root files. The resolver auto-discovers them — **no flags required** for any `/spec-driver:*` skill.

---

## 1. Model Configuration (`spec-driver.config.yaml`)

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
      opus: gpt-5.4
      sonnet: gpt-5.4
    claude:
      gpt-5.4: sonnet
      gpt-5: opus
      gpt-5-mini: sonnet
      o3: opus
      o4-mini: sonnet
  defaults:
    codex: gpt-5.4
    claude: sonnet

# Codex service tier
codex:
  service_tier: fast  # fast | standard | flex

# Codex thinking level (use one model + adjust effort)
codex_thinking:
  default_level: xhigh  # low | medium | high | xhigh
  level_map:
    opus: xhigh
    sonnet: medium
    haiku: low

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

### Model presets

| Preset | Research/Specify/Plan/Analyze | Clarify/Checklist/Tasks/Implement/Verify |
| ------ | ----------------------------- | ---------------------------------------- |
| `balanced` (default) | **Sonnet 4.6** | **Sonnet 4.6** |
| `quality-first` | **Opus 4.7 1M** | **Opus 4.7 1M** |
| `cost-efficient` | Sonnet | Sonnet |

> **v4.0 default model upgrade**: `balanced` preset previously mapped to Opus; since v4.0 it maps to Sonnet 4.6 (cost reduction ~5x with comparable quality for SDD scenarios). Explicit pinning preserved via `quality-first`.

When running in Codex, Spec Driver keeps `opus/sonnet` semantics but maps both to `gpt-5.4`; depth is controlled by `codex_thinking` levels (`low` / `medium` / `high` / `xhigh`).

`spectra` CLI (`generate` / `batch` / `diff`) follows the same model config source:

- Priority: `SPECTRA_MODEL` > `spec-driver.config.yaml agents.specify.model` > `spec-driver.config.yaml preset` > built-in default
- Config discovery: current directory upward search for `spec-driver.config.yaml`, then `.specify/spec-driver.config.yaml`

---

## 2. Per-Project Orchestration Overrides (`.specify/orchestration-overrides.yaml`)

Customize phase sequences, gate behaviors, and concurrency per project. Like ESLint `extends` or Docker Compose `override.yml`. Plugin base `config/orchestration.yaml` stays untouched; you only override what differs. The resolver auto-detects the file and merges on every `/spec-driver:*` skill invocation.

### How it works

```
Plugin base                       Project override (optional)         Resolver auto-merges
plugins/spec-driver/              .specify/orchestration-overrides    on every skill call
  config/orchestration.yaml       .yaml
        │                                  │                                  │
        │  modes / gates /                 │  Write only the diff             │  /spec-driver:spec-driver-feature
        │  parallel_scheduling             │                                  │  /spec-driver:spec-driver-fix
        ▼                                  ▼                                  ▼
                                  ┌────────────────────────┐
                                  │  Effective Configuration  │ ← all skills run against this
                                  └────────────────────────┘
```

### Supported override fields

| Path | Merge semantic | Use case |
|------|---------------|----------|
| `modes.<mode>.phases` | Full replace | Add / remove / replace phase sequence for a mode |
| `gates.<GATE_ID>` | Field-level merge | Override `default_behavior` / `severity` / `hard_gate_modes` per gate |
| `parallel_scheduling.<field>` | Scalar replace | Tune `max_concurrent_tasks` etc. |

### 4-step workflow

**Step 1** — Create the file in your project root:

```bash
mkdir -p .specify
touch .specify/orchestration-overrides.yaml
```

**Step 2** — Write your overrides (see scenarios below).

**Step 3** — Run any `/spec-driver:*` skill. The resolver auto-merges:

```
/spec-driver:spec-driver-fix  Fix login OAuth callback
```

**Step 4** — Verify your overrides took effect:

```bash
ORCH_CLI=~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.0.0/scripts/orchestrator-cli.mjs
node $ORCH_CLI effective-orchestration <mode> --annotate
```

The `--annotate` mode marks each field with `# source: base` or `# source: project-override`, so you can see at a glance what's overridden.

### Real scenarios

#### A. High-compliance project — force every gate to require human approval

```yaml
version: "1.0"

gates:
  GATE_DESIGN:
    default_behavior: always   # base: auto → always (always trigger gate)
    severity: critical
  GATE_VERIFY:
    default_behavior: always
    severity: critical
  GATE_IMPLEMENT_MID:
    default_behavior: always
    severity: critical
```

#### B. Low-risk project — auto-pass `GATE_VERIFY` when toolchain is green

```yaml
version: "1.0"

gates:
  GATE_VERIFY:
    default_behavior: auto    # base: always → auto (skip when zero failures)
```

#### C. CI resource-constrained — serialize all parallel work

```yaml
version: "1.0"

parallel_scheduling:
  max_concurrent_tasks: 1     # base: 3 → 1 (no parallel spec-review/quality-review)
```

#### D. Strip a phase from a mode — minimal `fix` flow

```yaml
version: "1.0"

modes:
  fix:
    phases:                    # full replace: drop spec-review / quality-review subphases
      - id: diagnose
        name: Diagnose
      - id: plan
        name: Plan
      - id: implement
        name: Implement
      - id: verify
        name: Verify
```

### Strict enum values (writing wrong values silently falls back to base)

| Field | Allowed values |
|-------|---------------|
| `default_behavior` | `always` / `auto` / `on_failure` / `skip` |
| `severity` | `critical` / `non_critical` / `warning` / `info` |

⚠️ Writing `pause`, `error`, or other non-listed values triggers a `orchestration-overrides.schema-fallback` warning — the override is **silently discarded** and base behavior is used. Always use the exact strings above.

### Troubleshooting

If the override seems not to take effect:

```bash
# Inspect diagnostics in JSON mode
node $ORCH_CLI effective-orchestration <mode> --format json | jq '.diagnostics'
```

- `[]` → override is fully active
- `level: warning, code: orchestration-overrides.schema-fallback` → enum value is wrong; the message points to the offending field

### Full reference

- User guide: [`migrations/orchestration-overrides.md`](migrations/orchestration-overrides.md) — full migration / scenario examples
- Schema contract: [`../plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`](../plugins/spec-driver/contracts/orchestration-overrides-contract.yaml)
- Feature spec: [`../specs/133-orchestration-overrides/spec.md`](../specs/133-orchestration-overrides/spec.md)

---

## Supported Verification Languages

Spec Driver auto-detects build/lint/test commands for:

JS/TS (npm/pnpm/yarn/bun), Rust (Cargo), Go, Python (pip/poetry/uv), Java (Maven/Gradle), Kotlin, Swift (SPM), C/C++ (CMake/Make), C# (.NET), Elixir (Mix), Ruby (Bundler)

Override via `verification.commands.{build,lint,test}` in `spec-driver.config.yaml`.

## See Also

- [Spec Driver Modes](spec-driver-modes.md) — 8 modes detailed
- [Repository Architecture](repository-architecture.md)
- [Main README](../README.md)
