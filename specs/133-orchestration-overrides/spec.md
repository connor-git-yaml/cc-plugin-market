---
feature_id: "133"
branch: "claude/wonderful-chatterjee-22066e"
title: "spec-driver 项目级流程定制（Per-Project Workflow Overrides — 分层 orchestration）"
status: Draft
created_at: "2026-04-26"
spec_version: "1.1"
revised_at: "2026-04-26"
revision_reason: "GATE_DESIGN CL-001/008/010/016 + CHK-008/030"
input_artifacts:
  - research/product-research.md
  - research/tech-research.md
  - research/research-synthesis.md
---

# Feature 133 — spec-driver 项目级流程定制（Per-Project Workflow Overrides）

## 背景与动机

spec-driver 当前采用"全局一刀切"的编排模式：所有项目共享同一套 plugin 内置的 `orchestration.yaml`，无法针对特定项目的风险级别、合规要求或团队流程习惯进行调整。随着 spec-driver 从个人工具走向团队平台，不同项目类型（高风险金融服务、低风险文档仓库、基础库）之间的流程需求差异已成为痛点。

本 Feature 引入**分层 orchestration 架构**：plugin 提供基础配置（base），项目层通过 `.specify/orchestration-overrides.yaml` 按需覆盖。这是 ESLint `extends`、Docker Compose `override.yml`、tsconfig `extends` 链等主流 CLI 工具的标准做法，业界已高度验证。

**核心设计决策均已在产研汇总中锁定（D1-D10），本 spec 的职责是精确表达这些决策，不重新讨论。**

---

## 用户场景与测试

### 用户故事 1 — Gate 行为按项目差异化定制（优先级：P1）

团队 A 开发低风险 CLI 工具，希望 fix 模式的 `GATE_DESIGN` 改为 `auto`（自动通过），避免人工审批摩擦；团队 B 维护高风险金融服务，要求 `GATE_DESIGN` 强制 `always` + `severity: critical`。两个团队共享同一个 plugin，各自在本项目的 `.specify/orchestration-overrides.yaml` 中声明不同的 gate 覆盖，互不影响。

**为何 P1**：gate behavior 差异化是最高频的定制场景（产品调研场景 1），覆盖面广（所有 mode 下的所有 gate 均可覆盖），实现复杂度最低（对象字段合并），是 MVP 核心价值支柱。

**独立测试**：仅实现 gate 字段覆盖（不实现 mode 整段重写），即可让不同 gate 严格程度的项目共存，满足核心差异化需求。

**验收场景**：

1. **Given** 项目 `.specify/orchestration-overrides.yaml` 声明 `gates.GATE_DESIGN.default_behavior: auto`，**When** 运行 `node scripts/orchestrator-cli.mjs effective-orchestration feature`，**Then** 输出的 effective config 中 `gates.GATE_DESIGN.default_behavior` 为 `auto`，其余 gate 字段保持 base 值不变。
2. **Given** overrides 中未声明 `gates.GATE_VERIFY`，**When** 运行任意 orchestration 命令，**Then** `GATE_VERIFY` 的全部字段继承 plugin base 值，overrides 中未声明的 gate 不受影响。

---

### 用户故事 2 — Fix 模式 Phase 序列裁剪（优先级：P1）

Solo Developer 开发低风险 side project，fix 模式的完整 phase 序列（analyze → specify → plan → implement → verify）对高频小修复显得冗余。通过整段重写 fix mode 的 phases 数组，仅保留 specify + implement 两个 phase，降低流程摩擦。其他项目成员使用同一 plugin 时不受影响（各自 override 文件互不干扰）。

**为何 P1**：mode 整段重写是粒度最粗但覆盖面最大的定制能力，满足"大幅裁剪流程"场景（产品调研场景 2、3、5）；与 gate 覆盖共同构成 MVP 最小可行产品。

**独立测试**：在测试目录放置包含 `modes.fix` 整段重写的 overrides 文件，运行 `get-phases fix`，验证返回的 phase 列表与 overrides 一致、不含 base 的额外 phase。

**验收场景**：

1. **Given** overrides 声明 `modes.fix.phases` 为 2 个 phase 的数组，**When** 运行 `node scripts/orchestrator-cli.mjs get-phases fix`，**Then** 返回的 phase 序列与 overrides 声明的 2 个 phase 完全一致，base 的其余 phase 不出现。
2. **Given** overrides 整段重写了 fix mode，**When** 运行 `effective-orchestration fix --diff`，**Then** diff 输出仅展示 `modes.fix` 字段被 overrides 覆盖，其他 mode 无变化。

---

### 用户故事 3 — 无效 overrides 不崩溃工具（优先级：P1）

团队成员手误写入格式错误的 overrides（如 YAML 语法错误或字段名拼错），运行任意 spec-driver 命令时，工具不应崩溃或静默使用错误配置，而应降级到 plugin base 配置并输出清晰的警告，提示用户修正。

**为何 P1**：安全降级是工具可信任性的底线（产品调研验证假设：用户宁愿 fallback 也不希望工具崩溃）；缺少此能力会导致用户不敢使用 overrides 功能。

**独立测试**：构造四种错误 overrides（文件不存在 / YAML 语法错误 / schema 校验失败 / base 不可读），验证各情形下工具行为符合降级策略表。

**验收场景**：

1. **Given** `.specify/orchestration-overrides.yaml` 包含无效 YAML（缺少冒号、缩进错误），**When** 运行任意编排命令，**Then** 命令正常完成（退出码 0），stderr 输出 `[warning]` 级 diagnostic，标注 code `orchestration-overrides.parse-error`，使用 base config 执行。
2. **Given** overrides 通过 YAML 解析但含 Zod schema 不认识的字段，**When** 运行任意编排命令，**Then** 命令正常完成，输出 `[warning]` 级 diagnostic（code: `orchestration-overrides.schema-fallback`），使用 base config。
3. **Given** `.specify/orchestration-overrides.yaml` 不存在，**When** 运行任意编排命令，**Then** 静默使用 base config，不输出任何 diagnostic（非报错场景）。

---

### 用户故事 4 — dry-run 预览 effective config（优先级：P2）

在实际修改 overrides 文件前，团队希望能预览合并后的 effective config，了解哪些字段来自 base、哪些来自 overrides，避免意外覆盖。通过 `effective-orchestration <mode> --annotate` 命令实现，每个顶层字段都标注来源。

**为何 P2**：dry-run 是用户信任 overrides 功能的门槛，但在 gate 覆盖和 mode 重写（P1）可用后，dry-run 才能发挥最大价值；纯 dry-run 本身不创造新的编排能力。

**独立测试**：安装了合法 overrides 的项目下运行 `effective-orchestration feature --annotate --format yaml`，验证输出格式包含 source 注释。

**验收场景**：

1. **Given** 合法 overrides 覆盖了 `modes.fix` 和 `gates.GATE_DESIGN`，**When** 运行 `effective-orchestration feature --annotate`，**Then** stdout 输出带 `# source: base` 或 `# source: overrides` 行内注释的 YAML。
2. **Given** 同上，**When** 运行 `effective-orchestration feature --format json`，**Then** stdout 输出合法 JSON，结构为 `{ config: {...}, fieldSources: {...}, diagnostics: [...] }`。
3. **Given** 同上，**When** 运行 `effective-orchestration feature --diff`，**Then** 仅输出被 overrides 实际改变的字段路径与新旧值，未变更字段不出现在输出中。

---

### 用户故事 5 — 并行调度资源限制调整（优先级：P2）

CI 资源受限的团队希望把 `parallel_scheduling.max_concurrent_tasks` 从 plugin 默认值降低，避免上下文超限或队列饥饿。通过全局字段覆盖（顶层标量后者覆盖前者）实现。

**为何 P2**：是高价值场景（产品调研场景 6），但影响范围小且独立于 mode/gate 覆盖，优先级次于核心 P1 场景。

**验收场景**：

1. **Given** overrides 声明 `parallel_scheduling.max_concurrent_tasks: 1`，**When** 运行 `effective-orchestration feature`，**Then** 输出的 effective config 中 `parallel_scheduling.max_concurrent_tasks` 为 `1`。

---

### 用户故事 6 — repo:check 集成校验（优先级：P2）

项目维护者希望 `npm run repo:check` 也能检查 `.specify/orchestration-overrides.yaml` 的合法性：文件存在时验证其 schema 是否匹配，并在校验失败时输出明确的修复指引，不破坏现有校验链路。

**为何 P2**：提升项目健康度检查完整性，但属于工具链完善，不影响核心 override 功能可用性。

**验收场景**：

1. **Given** 项目有合法 overrides 文件，**When** 运行 `npm run repo:check`，**Then** 检查通过，现有所有校验项不受影响（零回归）。
2. **Given** 项目有非法 overrides 文件（schema 失败），**When** 运行 `npm run repo:check`，**Then** 输出明确的错误指引，整体退出码非零，其他校验项结果不变。

---

### Edge Cases

- **overrides 声明了 base reserved 集合之外的 mode 名**：触发 `orchestration-overrides.schema-fallback` diagnostic（`warning` 级），整体 overrides 降级到 base；MVP 采用 enum 校验，拒绝任何非 `feature | story | implement | fix | resume | sync | doc | refactor` 的 mode 名。（关联：FR-004、FR-007-A、AC-006）
- **overrides 的 `version` 与 base 不一致**：触发专属 diagnostic code `orchestration-overrides.version-mismatch`（`warning` 级），忽略 overrides，回退 base。（关联：FR-007）
- **overrides 文件存在但为空（零字节）**：解析结果为空对象，等效于"无 overrides"，静默使用 base，不输出 diagnostic。（关联：FR-003）
- **`effective-orchestration` 指定的 mode 在合并后不存在**：进程退出码 1，stderr 输出明确错误信息。（关联：FR-011）
- **`--annotate` 与 `--diff` 同时传入**：`--diff` 优先，仅输出差异部分，`--annotate` 被忽略。[推断] [INFERRED]
- **base `orchestration.yaml` 不可读（极端情形）**：base Zod 校验失败，使用 `generateFallbackConfig()` 内置后备配置，输出 `error` 级 diagnostic（code: `orchestration.base-invalid`）。（关联：FR-006）
- **overrides 使用 YAML anchor（`&` / `<<:`）**：`simple-yaml.mjs` 不支持 anchor，解析结果可能不符预期；Zod schema 校验若失败则回退 base + warning；若解析成功（anchor 被静默忽略）则可能产生意外合并结果。文档须明确标注此限制。（关联：NFR-004）
- **overrides 中误写 `parallel_groups` 或其他 MVP 不支持字段**：触发 `orchestration-overrides.unsupported-field` warning，strip 该字段后其余合法字段照常生效，整体 overrides 不因此失效。（关联：FR-022、NFR-003）

---

## 功能需求（Functional Requirements）

### 核心加载与合并

**FR-001** [必须] 系统 MUST 在 `{projectRoot}/.specify/orchestration-overrides.yaml` 存在时，将其内容与 plugin base `orchestration.yaml` 进行合并；文件不存在时静默使用 base，不输出任何 diagnostic。

**FR-002** [必须] 加载序 MUST 严格遵循以下顺序：(1) 读取 plugin base `orchestration.yaml` → (2) 对 base 执行 Zod `orchestrationBaseSchema.safeParse` 校验，失败则触发 `orchestration.base-invalid` error 并使用 `generateFallbackConfig()` → (3) 检查 overrides 文件是否存在 → (4) 存在则用 `simple-yaml.mjs` 解析 → (5) YAML 解析成功则执行深合并 → (6) 对合并结果执行 `orchestrationMergedSchema.safeParse` → (7) 校验通过返回 mergedConfig；校验失败回退 base。

**FR-003** [必须] `resolveOrchestrationConfig({ projectRoot, mode })` 函数 MUST 返回 `{ mergedConfig, fieldSources, diagnostics, isFallback }`，其中 `isFallback: true` 表示因错误降级到 base config。

**FR-004** [必须] 合并语义 MUST 严格遵循以下规则（按字段类型）：

| 字段类型 | 合并语义 |
|---------|---------|
| `modes.<mode>` 整体 | overrides 中存在则**整段替换** base 同名 mode（包括 phases 数组）；`modes` 字段的 key 必须是 base reserved name（enum 校验），否则 schema 校验失败 |
| `gates.<GATE_ID>.<field>` | 对象级**字段合并**（仅 `default_behavior`、`severity`、`hard_gate_modes` 可覆盖） |
| `gates.<GATE_ID>.hard_gate_modes` 数组 | **整段替换**，不做数组 append |
| `parallel_scheduling.*` 顶层标量 | 后者覆盖前者（scalar override） |
| `parallel_groups.*` | **MVP 不支持覆盖**；出现时 strip 该字段并发出 `unsupported-field` warning，不使整体 overrides 失效 |
| overrides 中未声明的任何字段 | 保留 base 值不变 |

**FR-005** [必须] `fieldSources` MUST 记录每个被覆盖路径的来源，取值为 `"base"` 或 `"overrides"`：Mode 级用整段 key（`modes.feature`）；Gate 字段级（`gates.GATE_DESIGN.default_behavior`、`gates.GATE_DESIGN.severity` 等单字段，便于 `--annotate` / `--diff` 精确指出哪个字段被覆盖）；`parallel_scheduling` 字段级。**不**下钻到 phase 数组元素（与 mode 整段替换语义一致）。

### 降级策略

**FR-006** [必须] 降级策略 MUST 精确处理以下错误情形，不同情形对应不同处理方式：

| 错误情形 | 处理方式 | Diagnostic level | Diagnostic code |
|---------|---------|-----------------|-----------------|
| overrides 文件不存在 | 静默使用 base | （无） | （无） |
| YAML 语法错误（`parseYamlDocument` 抛出异常） | 忽略 overrides，使用 base | `warning` | `orchestration-overrides.parse-error` |
| Zod schema 校验失败（`safeParse` 返回 error，含非 reserved mode 名） | 忽略 overrides，使用 base | `warning` | `orchestration-overrides.schema-fallback` |
| overrides `version` 与 base 不一致 | 忽略 overrides，使用 base | `warning` | `orchestration-overrides.version-mismatch` |
| overrides 含 MVP 不支持字段（如 `parallel_groups`） | strip 该字段后继续，其余合法字段生效 | `warning` | `orchestration-overrides.unsupported-field` |
| base `orchestration.yaml` Zod 校验失败（`orchestrationBaseSchema` 未通过） | 使用 `generateFallbackConfig()` 内置后备 | `error` | `orchestration.base-invalid` |
| overrides 通过校验且 mode 名与 base 重名 | warn 但仍生效（用户意图明确，整段替换） | `info` | `orchestration-overrides.mode-overridden` |

**FR-007** [必须] overrides 文件 MUST 包含 `version` 字段；resolver 在 Zod parse 后额外比对 `overrides.version` 与 `base.version`，不一致时发出专属 `orchestration-overrides.version-mismatch` diagnostic（`warning` 级）并忽略 overrides 回退 base（不复用 `schema-fallback` code）。

**FR-007-A** [必须] `orchestrationOverridesSchema` 中 `modes` 字段的 key MUST 使用 Zod enum 校验，合法值为 `feature | story | implement | fix | resume | sync | doc | refactor`（base reserved names）；出现 enum 之外的 mode 名 → `safeParse` 返回 error → 触发 `orchestration-overrides.schema-fallback` → 整体 overrides 降级到 base。二期支持 `extends` 派生时再开放此 enum 限制。

**FR-008** [必须] 任何降级情形 MUST 保留所有 diagnostic 信息并随 `resolveOrchestrationConfig()` 返回值传出，由调用方决定是否向用户呈现；系统不得静默丢弃 diagnostic。

### CLI 子命令

**FR-009** [必须] `orchestrator-cli.mjs` MUST 新增 `effective-orchestration <mode>` 子命令，输出指定 mode 的 effective orchestration config（合并结果）。

**FR-010** [必须] `effective-orchestration` MUST 支持以下选项：

| 选项 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `<mode>` | positional，必填 | — | 从 merged mode 集合中选取 |
| `--annotate` | flag | false | 输出带 `# source: base\|overrides` 行内注释的 YAML，Mode 级和 Gate 级顶层 key 各标注一次 |
| `--diff` | flag | false | 仅输出 overrides 实际改变的字段路径与新旧值 |
| `--format yaml\|json` | enum | `yaml` | `json` 模式下返回 `{ config, fieldSources, diagnostics }` 结构体 |
| `--project-root <path>` | string | `process.cwd()` | 指定项目根目录 |

**FR-011** [必须] `effective-orchestration` MUST 遵循以下退出码约定：`0` = 成功（含 overrides 校验失败但已 fallback）；`1` = 不可恢复错误（如指定的 mode 在合并后不存在）。所有内容输出到 stdout，错误信息输出到 stderr。

**FR-012** [必须] 所有现有 `orchestrator-cli.mjs` 命令（`get-phases`、`get-gate-behavior` 等）MUST 在执行前先调用 `resolveOrchestrationConfig()`，使用 mergedConfig 初始化 Orchestrator，自动感知 overrides；`Orchestrator` 构造函数签名 `(userConfig, mode, context)` MUST 保持不变。

### Schema 与合同沉淀

**FR-013** [必须] 系统 MUST 新增 `plugins/spec-driver/contracts/orchestration-schema.mjs`，同时导出以下三个 Zod schema：
- `orchestrationBaseSchema`：校验 plugin base `orchestration.yaml`，覆盖 `version`、`parallel_scheduling`、`gates.<GATE_ID>`、`parallel_groups.<G>`、`modes.<M>.phases[]` 等字段，与 `plugins/spec-driver/config/orchestration.yaml` 现有结构对齐
- `orchestrationOverridesSchema`：校验项目级 overrides 文件，覆盖 `$schema_version`（string，可选）、`version`（string，必填）、`modes`（enum key，可选）、`gates`（Record，可选）、`parallel_scheduling`（Object，可选）；`modes` key 使用 enum 校验（见 FR-007-A）
- `orchestrationMergedSchema`：校验合并后的 config（或复用 `orchestrationBaseSchema` 对合并结果做最终校验）

三个 schema 共用同一份 Zod 类型定义基础（DRY），schema 升级时只改一处。

**FR-014** [必须] schema MUST 预留二期扩展位：顶层 `$schema_version: "1.0"` 字段（schema 接受）；`modes.<m>.extends?: string` 字段（schema 接受但 MVP resolver 不处理此字段）。

**FR-015** [必须] 系统 MUST 新增 `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`，以人读的形式说明 overrides 文件的 schema 结构、合并语义、各字段用途及示例值（参考 `wrapper-source-of-truth.yaml` 风格）。

### Base Config 校验迁移（GATE_DESIGN CL-016 决策）

**FR-023** [必须] 系统 MUST 将 `plugins/spec-driver/lib/orchestrator.mjs` 中的手写 `validateOrchestrationYaml()` 函数替换为基于 `orchestrationBaseSchema`（Zod）的校验：base config 在加载时执行 `orchestrationBaseSchema.safeParse`，校验失败触发 `orchestration.base-invalid` error 并使用 `generateFallbackConfig()`，替代原有的手写 reject 逻辑。`validateOrchestrationYaml()` 函数被移除或退化为对 `orchestrationBaseSchema.safeParse` 的薄壳调用。

**FR-024** [必须] `orchestrationBaseSchema` MUST 覆盖 base `orchestration.yaml` 现有全部字段集，包括：`version`（string，必填）、`parallel_scheduling`（含 `max_concurrent_tasks`）、`gates.<GATE_ID>`（含 `default_behavior`、`severity`、`hard_gate_modes`、`insertion_point` 等；其中 `default_behavior` 接受 `always`/`auto`/`on_failure`/`skip`，`severity` 接受 `critical`/`non_critical`/`warning`/`info` 全集；`hard_gate_modes` 与 `insertion_point` 可为 `null`）、`parallel_groups.<G>`（含 `members`、`convergence_point`、`fallback_strategy`、`max_concurrent`、`description`）、`modes.<M>`（含 `phases[]`，每个 phase 含 `id`、`name`、`display_name`、`agent`（多态：`null`/`string`/`string[]` — 分别对应 inline / single agent / parallel_group）、`agent_mode`、`gates_before`、`gates_after`、`conditional`、`skip_if_exists`、`is_critical`）。设计原则：先以现有 `orchestration.yaml` 内容为准定义 schema，确保现有文件 100% 通过 Zod 校验，再扩展为 overrides 使用。

**FR-025** [必须] 8 个 SKILL.md 通过 `orchestrator-cli.mjs` 调用编排器的链路（`get-phases` / `get-gate-behavior` / `get-parallel-groups` 等命令）MUST 在 base 校验迁移后行为与迁移前完全一致；`Orchestrator` 类的构造函数签名 `(userConfig, mode, context)` MUST 保持不变；现有 `tests/orchestrator.test.mjs` 全部通过。

### Repo:check 集成

**FR-016** [必须] 系统 MUST 新增 `plugins/spec-driver/scripts/validate-orchestration-overrides.mjs`，导出 `validateOrchestrationOverrides({ projectRoot })`，返回 `{ status: "ok" | "warning" | "error", checks: [...], warnings: [...], errors: [...] }`。

**FR-017** [必须] `validateOrchestrationOverrides()` MUST 接入 `scripts/lib/repo-maintenance-core.mjs` 的 `validateRepository()` 函数末尾（追加 `aggregateValidation` 调用），不得修改其他校验器的行为。

### 测试覆盖

**FR-018** [必须] 系统 MUST 新增 `plugins/spec-driver/tests/orchestration-resolver.test.mjs`，使用 `node:test` 框架，覆盖以下三类测试：
- T1：base + overrides 合并测试（至少覆盖 mode 整段替换、gate 字段合并、parallel_scheduling 覆盖三个场景）
- T2：四种降级路径测试（文件不存在 / YAML 语法错误 / schema 校验失败 / base 不可读）；base 不可读场景通过可选 `_loadBase` 依赖注入参数模拟（不污染函数主签名）
- T3：CLI dry-run 输出测试（`--annotate` 注释格式、`--diff` 差异输出、`--format json` 结构体）

现有 `tests/orchestrator.test.mjs` MUST 在本 Feature 实施后增量补充 base Zod 校验断言（覆盖 base 通过 / base 失败两条路径），确保 base 校验迁移零回归。

### 文档与示例

**FR-019** [必须] 系统 MUST 提供 `plugins/spec-driver/templates/orchestration-overrides.example.yaml`，示范以下三种常见覆盖场景：fix 模式 phases 裁剪 + GATE_DESIGN behavior 调整 + `parallel_scheduling` 收紧。

**FR-020** [应当] 系统 SHOULD 新增 `docs/shared/agent-orchestration-overrides.md` 共享片段，通过 `npm run docs:sync:agents` 同步到 `AGENTS.md` 和 `CLAUDE.md`，说明项目级流程定制约定（内容以 agent 约定为主，精简 1-3 条，不含用户操作指引）。（关联 AC：AC-017）

**FR-021** [应当] `.specify/project-context.yaml` 的 `forbidden_changes` 列表 SHOULD 追加旁注：流程结构覆盖应放 `.specify/orchestration-overrides.yaml`，不进 project-context。（关联 AC：AC-018）

**FR-022** [必须] schema 中 MVP 不支持但二期保留的字段（`parallel_groups`、`modes.<m>.extends`、`phases[].extends` 等）MUST 在 `orchestrationOverridesSchema` 中显式声明为 strip + warning 路径（不宽松通配）；"二期保留字段清单"由 schema 显式维护，resolver 在 parse 前对已知的 strip 字段发出 `orchestration-overrides.unsupported-field` warning。

---

## 非功能需求（Non-Functional Requirements）

**NFR-001 性能**：`resolveOrchestrationConfig()` 全链路（加载 + 解析 + 合并 + Zod 校验）MUST 在 200ms 以内完成（本地文件系统，overrides 文件不超过 200 行）。overrides 在 orchestrator-cli.mjs 初始化时一次性加载缓存，不在每次 phase 执行前重新读取。

**NFR-002 向后兼容**：`Orchestrator` 类的构造函数签名 `(userConfig, mode, context)` MUST 保持不变；所有现有调用方（8 个 SKILL.md、`orchestrator-cli.mjs`、`orchestrator.test.mjs`）无需修改调用方式。不存在 `.specify/orchestration-overrides.yaml` 的项目行为与 Feature 上线前完全一致。

**NFR-003 安全性**：所有 overrides 内容 MUST 经过 Zod schema `safeParse` 严格校验后方可影响系统行为；校验失败 MUST 触发降级而非抛出未捕获异常。顶层未知字段使用 `.strict()` 策略拒绝；对 MVP 不支持但二期保留的字段（`parallel_groups`、`modes.<m>.extends`、`phases[].extends` 等），走 strip + warning 路径（不使整体 overrides 因单一 MVP 未支持字段而全部失效）。strip 字段清单由 schema 显式声明，不是宽松 `.passthrough()` 通配。[AUTO-RESOLVED: `.strict()` 处理顶层真正未知字段，二期保留字段走 strip 路径体验更好，符合 CL-010 GATE_DESIGN 决策]

**NFR-004 可观测性**：每次 `resolveOrchestrationConfig()` 调用 MUST 在返回值的 `diagnostics` 数组中记录加载结果（包含来源文件路径、哪些 mode/gate 被 overrides 影响、是否发生降级）；CLI 在 `--verbose` 或调试日志模式下应展示此信息。`simple-yaml.mjs` 不提供行号这一限制需在用户文档中明确标注。

**NFR-005 可维护性**：`orchestration-resolver.mjs` MUST 以 `project-profile-resolver.mjs` 为范本，采用相同的 Resolver 模式（纯函数 + `createDiagnostic` + `fieldSources`）；不得引入新的外部依赖（`zod` 和 `simple-yaml.mjs` 均已在项目中）。

**NFR-006 单一 schema 源原则**：base config、overrides、merged config 的校验 MUST 共用 `orchestration-schema.mjs` 导出的同一套 Zod 类型定义（DRY）；schema 升级时只需修改一处，禁止在 `orchestrator.mjs` 中重新定义平行的类型约束。

**NFR-007 回归测试覆盖**：8 个 SKILL.md 通过 `orchestrator-cli.mjs` 调用编排器的所有现有命令在 base 校验迁移后不得产生任何行为变化；CI 必须跑 `npm run lint` + `npm run build` + `npx vitest run` 三项，现有 `tests/orchestrator.test.mjs` 不得有任何 FAIL。

---

## 数据契约

### `.specify/orchestration-overrides.yaml` 顶层 Schema

```typescript
// TypeScript 伪类型表示（非实际代码，仅用于说明 schema 结构）
interface OrchestrationOverrides {
  $schema_version?: string;          // 预留，MVP 接受但不处理（如 "1.0"）
  version: string;                   // 必填，resolver 比对 base version，不一致触发 version-mismatch
  modes?: {
    // key 必须是 base reserved enum：feature|story|implement|fix|resume|sync|doc|refactor
    // 非 reserved 名 → schema 校验失败 → schema-fallback fallback
    // 二期支持 extends 派生时再开放 enum 限制
    [modeName in BaseReservedModeName]?: ModeOverride;
  };
  gates?: {
    [gateId: string]: GateOverride;  // 对象级字段合并
  };
  parallel_scheduling?: {
    max_concurrent_tasks?: number;   // 标量覆盖
    [key: string]: unknown;          // 其他标量字段同样覆盖
  };
  // parallel_groups 字段：出现时 strip + warning（unsupported-field），不使整体 overrides 失效
  // 由 schema 显式 strip，不是宽松 passthrough
}

type BaseReservedModeName = "feature" | "story" | "implement" | "fix" | "resume" | "sync" | "doc" | "refactor";

interface ModeOverride {
  extends?: string;     // 预留，MVP schema 接受但 resolver 不处理
  phases: Phase[];      // 必须完整声明（整段替换，无法局部 patch）
  [key: string]: unknown;
}

interface GateOverride {
  default_behavior?: "always" | "auto" | "on_failure" | "skip";  // base 实际使用 always/auto/on_failure；skip 是 overrides 用户场景额外值
  severity?: "critical" | "non_critical";                         // base 实际使用值；schema 出于向前兼容也接受 "warning" | "info"
  hard_gate_modes?: string[];  // 整段替换，非追加
}
```

**关键字段说明**：

| 字段 | 是否必填 | 类型 | 合并语义 | 备注 |
|------|---------|------|---------|------|
| `version` | **必填** | string | resolver 比对，不一致 → `version-mismatch` warning + fallback | 防跨版本误用；不在 Zod schema 层做 refine，在 resolver 层做比对 |
| `modes.*` | 可选 | `enum<feature\|story\|implement\|fix\|resume\|sync\|doc\|refactor>` key | 整段替换 | 非 reserved 名 → schema-fallback；二期支持 extends 派生时再开放 |
| `gates.*` | 可选 | Record | 对象字段合并 | 未声明字段继承 base |
| `parallel_scheduling.*` | 可选 | Object | 标量覆盖 | 仅支持顶层标量 |
| `parallel_groups.*` | **不支持（MVP strip）** | — | strip + unsupported-field warning | 其余合法字段照常生效 |

---

### Base Schema 必须覆盖的字段集

`orchestrationBaseSchema` 需与 `plugins/spec-driver/config/orchestration.yaml` 现有结构对齐，覆盖：

| 字段路径 | 类型 | 说明 |
|---------|------|------|
| `version` | string，必填 | 版本标识 |
| `parallel_scheduling.max_concurrent_tasks` | number | 并发任务上限 |
| `gates.<GATE_ID>.default_behavior` | `"always"\|"auto"\|"on_failure"\|"skip"` | Gate 默认行为；base 现使用 `always`/`auto`/`on_failure`，`skip` 仅用于 overrides 场景 |
| `gates.<GATE_ID>.severity` | `"critical"\|"non_critical"` | Gate 严重级别；schema 出于向前兼容也接受 `"warning"`/`"info"` |
| `gates.<GATE_ID>.hard_gate_modes` | string[] | 强制触发 gate 的 mode 列表 |
| `parallel_groups.<G>.members` | string[] | 并行组成员 |
| `modes.<M>.phases[]` | Phase[] | 每个 mode 的 phase 序列 |
| `modes.<M>.phases[].id` | string | Phase ID |
| `modes.<M>.phases[].agent` | `null \| string \| string[]` | inline / single agent / 并行组（实际多态见现有 `orchestration.yaml`） |
| `modes.<M>.phases[].gates_before` | string[] \| null | phase 前 gate 列表（base 中可为 null） |
| `modes.<M>.phases[].gates_after` | string[] \| null | phase 后 gate 列表（base 中可为 null） |
| `gates.<GATE_ID>.hard_gate_modes` | string[] \| null | base 中可为 null（如 GATE_RESEARCH/GATE_ANALYSIS 等非硬门禁） |
| `gates.<GATE_ID>.insertion_point` | string \| null | 大多数 gate 为 null，仅 GATE_IMPLEMENT_MID 用 `after_task_50_percent` |

设计原则：先以现有 `orchestration.yaml` 为准定义 schema，确保全部 8 个 mode + 6 个 gate + 3 个 parallel_group 100% 通过 Zod 校验，再扩展为 overrides 场景使用。

---

### Schema 三件套关系

```
orchestrationBaseSchema        ← 校验 plugin base orchestration.yaml
         ↑
         │ 共用核心类型定义（DRY）
         ↓
orchestrationOverridesSchema   ← 校验 .specify/orchestration-overrides.yaml
                                  （所有字段可选 + modes key 做 enum 校验）
         ↓
orchestrationMergedSchema      ← 校验合并结果
                                  （可复用 orchestrationBaseSchema 对 merged config 做最终校验）
```

三个 schema 均从 `orchestration-schema.mjs` 导出，共用底层 Zod 类型定义，保证 DRY 原则。

---

### `resolveOrchestrationConfig()` 函数签名与返回值

```typescript
// 函数签名
resolveOrchestrationConfig({
  projectRoot: string;  // 项目根目录，默认 process.cwd()
  mode?: string;        // 可选，用于过滤 fieldSources 输出（不影响合并逻辑）
  _loadBase?: () => Promise<unknown>;  // 可选，测试用依赖注入钩子（默认读取 plugin base 文件）
}): {
  mergedConfig: OrchestratorConfig;  // 最终生效的 orchestration 配置
  fieldSources: FieldSources;        // 各路径来源 map
  diagnostics: Diagnostic[];         // 加载过程中产生的所有诊断
  isFallback: boolean;               // true = 发生降级，mergedConfig 等于纯 base
}
```

### `fieldSources` 数据结构

粒度：Mode 级 + Gate **字段级** + parallel_scheduling 字段级；**不下钻**到 phase 数组元素（mode 整段替换语义下，phase 来源等同所属 mode）。

```typescript
interface FieldSources {
  // Mode 级：key 为 "modes.<modeName>"（整段替换，不下钻）
  "modes.feature"?: "base" | "overrides";
  "modes.fix"?: "base" | "overrides";
  // Gate 字段级：key 为 "gates.<GATE_ID>.<field>"（精确到字段，便于 --annotate / --diff）
  "gates.GATE_DESIGN.default_behavior"?: "base" | "overrides";
  "gates.GATE_DESIGN.severity"?: "base" | "overrides";
  "gates.GATE_DESIGN.hard_gate_modes"?: "base" | "overrides";
  // parallel_scheduling 字段级：key 为 "parallel_scheduling.<field>"
  "parallel_scheduling.max_concurrent_tasks"?: "base" | "overrides";
  "parallel_scheduling.fallback_to_serial_on_failure"?: "base" | "overrides";
  // 其他 canonical 路径同理
  [path: string]: "base" | "overrides" | undefined;
}
```

> 备注：CLI `--annotate` 输出的 YAML 注释会把 Gate 字段级 source 聚合显示在 Gate 节点（`gates.GATE_DESIGN: # source: overrides`），但底层 `fieldSources` 数据结构保留字段级粒度，供 JSON 消费方与 `--diff` 精确定位。

---

### Diagnostic 对象结构

```typescript
interface Diagnostic {
  level: "info" | "warning" | "error";
  code: string;      // 见下方 code 清单
  message: string;   // 中文描述，技术术语保持英文
  details?: {
    field?: string;   // 出错字段路径（如 "modes.fix.phases[1].id"，dot-path 风格，数组用 [N]）
    expected?: unknown;
    got?: unknown;
    fallback_applied?: boolean;
  };
}
```

**Diagnostic code 清单**：

| code | level | 触发情形 | 行为 |
|------|-------|---------|------|
| `orchestration-overrides.parse-error` | `warning` | overrides YAML 语法错误 | 忽略 overrides，使用 base |
| `orchestration-overrides.schema-fallback` | `warning` | overrides Zod schema 校验失败（含非 reserved mode 名） | 忽略 overrides，使用 base |
| `orchestration-overrides.version-mismatch` | `warning` | `overrides.version` 与 `base.version` 不一致 | 忽略 overrides，使用 base |
| `orchestration-overrides.unsupported-field` | `warning` | overrides 含 MVP 不支持但二期保留的字段（如 `parallel_groups`） | strip 该字段后继续校验剩余字段，其余合法字段照常生效 |
| `orchestration-overrides.mode-overridden` | `info` | overrides 中 mode 名与 base 重名，整段替换 | warn 但仍生效 |
| `orchestration.base-invalid` | `error` | base `orchestration.yaml` Zod 校验失败（`orchestrationBaseSchema` 未通过） | 使用 `generateFallbackConfig()` 内置后备 |

注：原 `orchestration.base-unavailable` code 保留用于 base 文件物理不可读（I/O 错误），`orchestration.base-invalid` 为新增 code，专用于 Zod 校验失败场景。

---

### CLI `effective-orchestration` 输入输出契约

**输入**：

```
orchestrator-cli.mjs effective-orchestration <mode>
  [--annotate]
  [--diff]
  [--format yaml|json]
  [--project-root <path>]
```

注：本文统一采用 `# source: base|overrides` 格式（YAML 行内注释）；产研汇总中的 `_source:` 为草稿符号，含义相同，两者均指字段来源标注。

**`--annotate` YAML 输出格式（示意）**：

```yaml
# source: base
modes:
  feature: ...  # source: base
  fix: ...      # source: overrides
# source: base
gates:
  GATE_DESIGN:  # source: overrides
    default_behavior: auto
```

每个 Mode 级和 Gate 级顶层 key 追加一条 `# source: base|overrides` 行内注释，不下钻到 phase 数组元素。

**`--format json` 输出结构**：

```json
{
  "config": { /* 完整 mergedConfig */ },
  "fieldSources": {
    "modes.feature": "base",
    "modes.fix": "overrides",
    "gates.GATE_DESIGN": "overrides"
  },
  "diagnostics": [
    { "level": "info", "code": "orchestration-overrides.mode-overridden", "message": "..." }
  ]
}
```

**`--diff` 输出格式（示意）**：

```
~ modes.fix               overrides → 整段替换（base phases: 5, overrides phases: 2）
~ gates.GATE_DESIGN.default_behavior    base: always → overrides: auto
```

**退出码**：

| 情形 | 退出码 |
|------|-------|
| 成功（含 overrides 校验失败但已 fallback） | 0 |
| 指定的 mode 在合并后不存在 | 1 |
| 其他不可恢复错误 | 1 |

---

## 验收标准（Acceptance Criteria）

以下 AC 均以产研汇总 §5 的 S1-S6 为种子扩展，每条 AC 必须可机械验证。

**AC-001**（源自 S1）：在项目目录放置合法 `.specify/orchestration-overrides.yaml`（fix 模式整段重写为 2 个 phase + GATE_DESIGN behavior 改为 auto），运行 `node scripts/orchestrator-cli.mjs get-phases fix`，返回的 phase 序列与 overrides 声明的 2 个 phase 完全一致，进程退出码 0。

**AC-002**（源自 S2）：运行 `node scripts/orchestrator-cli.mjs effective-orchestration fix --annotate`，stdout 包含 `# source: overrides` 注释（针对 `modes.fix`）和 `# source: overrides` 注释（针对 `gates.GATE_DESIGN`），进程退出码 0。

**AC-003**（源自 S2）：运行 `effective-orchestration fix --format json`，stdout 是合法 JSON，结构包含 `config`、`fieldSources`、`diagnostics` 三个顶层字段，`fieldSources["modes.fix"]` 值为 `"overrides"`。

**AC-004**（源自 S2）：运行 `effective-orchestration fix --diff`，stdout 仅包含被 overrides 实际改变的字段路径（`modes.fix`、`gates.GATE_DESIGN.default_behavior`），未变更的字段（如 `modes.feature`）不出现在输出中。

**AC-005**（源自 S3）：将 overrides 文件写入 YAML 语法错误内容（如 `modes: fix: phases`），运行任意 `orchestrator-cli.mjs` 命令，进程退出码 0，stderr 包含 `[warning]` 和 code `orchestration-overrides.parse-error`，命令正常完成（使用 base config）。

**AC-006**（源自 S3）：将 overrides 文件写入 schema 不认识的字段（如 `unknown_field: value`）或非 reserved mode 名（如 `modes.fxi`），运行任意编排命令，进程退出码 0，stderr 包含 code `orchestration-overrides.schema-fallback`，使用 base config 执行。

**AC-007**（源自 S3）：`.specify/orchestration-overrides.yaml` 不存在时，运行任意编排命令，进程退出码 0，stderr 无任何关于 overrides 的 diagnostic 输出，行为与 Feature 上线前完全一致。

**AC-008**（源自 S4）：合法项目运行 `npm run repo:check`，新的 `validateOrchestrationOverrides` 校验器通过（`status: "ok"`），已有所有校验项无变化（零回归）。

**AC-009**（源自 S4）：非法 overrides 文件（schema 失败）的项目运行 `npm run repo:check`，整体退出码非零，输出包含明确的字段路径错误指引，其他校验项结果不受影响。

**AC-010**（源自 S5）：`tests/orchestration-resolver.test.mjs` 在 `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs` 下通过全部 T1/T2/T3 测试，零失败。

**AC-011**（源自 S6）：`spec-driver-feature`、`spec-driver-fix`、`spec-driver-implement` 等 SKILL.md 文件内容无任何改动，但合法 overrides 生效后，通过 SKILL.md 触发的编排流程使用的是 merged effective config（可通过 `effective-orchestration` 命令交叉验证）。

**AC-012**：`plugins/spec-driver/lib/orchestration-resolver.mjs` 文件存在，导出 `resolveOrchestrationConfig` 函数，签名为 `({ projectRoot, mode })` → `{ mergedConfig, fieldSources, diagnostics, isFallback }`。

**AC-013**：`plugins/spec-driver/contracts/orchestration-schema.mjs` 文件存在，同时导出 `orchestrationBaseSchema`、`orchestrationOverridesSchema`、`orchestrationMergedSchema` 三个 Zod schema。`orchestrationOverridesSchema` 中：`version` 字段必填；`modes` key 为 enum（`feature|story|implement|fix|resume|sync|doc|refactor`）；`gates` / `parallel_scheduling` 字段可选；`parallel_groups` 字段被 strip（不是 reject 整个 schema）；`$schema_version` 和 `modes.<m>.extends` 字段被接受但 resolver 不做特殊处理。

**AC-014**：`plugins/spec-driver/templates/orchestration-overrides.example.yaml` 文件存在，内容包含三个示例场景：fix 模式 phases 裁剪、GATE_DESIGN behavior 调整、`parallel_scheduling.max_concurrent_tasks` 收紧。

**AC-015**：`resolveOrchestrationConfig()` 在无 overrides 文件的项目下调用，返回值 `isFallback: false`，`diagnostics` 数组为空，`fieldSources` 中所有 mode/gate 路径均标注 `"base"`。

**AC-016**：`resolveOrchestrationConfig()` 全链路（含文件 I/O + Zod 校验）在本地文件系统上完成时间不超过 200ms（overrides 文件不超过 200 行）。

**AC-017**（源自 FR-020）：`docs/shared/agent-orchestration-overrides.md` 文件存在，且 `npm run docs:sync:agents` 执行后 `AGENTS.md` 与 `CLAUDE.md` 包含对应片段内容（机械验证：`grep` 关键句，如 `orchestration-overrides.yaml` 字符串）。

**AC-018**（源自 FR-021）：`.specify/project-context.yaml` 的 `forbidden_changes` 列表包含指向 `.specify/orchestration-overrides.yaml` 语义的旁注（机械验证：`grep "orchestration-overrides"` 在该文件中返回结果）。

**AC-019**（源自 FR-023 / CL-016）：`node scripts/orchestrator-cli.mjs validate-config`（或等效 base 校验命令）返回 success，`plugins/spec-driver/config/orchestration.yaml` 全部 8 个 mode + 6 个 gate + 3 个 parallel_group 通过 `orchestrationBaseSchema` Zod 校验，无任何 error 报告。

**AC-020**（源自 FR-023 / CL-016）：`plugins/spec-driver/lib/orchestrator.mjs` 中手写 `validateOrchestrationYaml()` 函数已被移除或退化为 `orchestrationBaseSchema.safeParse` 的薄壳调用（机械验证：`grep "validateOrchestrationYaml"` 在 `orchestrator.mjs` 中返回的定义不包含独立校验逻辑）。

**AC-021**（源自 FR-025 / CL-016）：8 个 SKILL.md 通过 CLI 调用编排器的所有现有命令（`get-phases` / `get-gate-behavior` / `get-parallel-groups`）行为与迁移前一致（机械验证：现有 `tests/orchestrator.test.mjs` 全部通过，零 FAIL）。

**AC-022**（源自 FR-007 / CL-008）：overrides 中 `version` 与 base 不一致时，运行任意编排命令，stderr 包含 code `orchestration-overrides.version-mismatch`（不是 `schema-fallback`），进程退出码 0，使用 base config 执行。

**AC-023**（源自 FR-022 / CL-010）：overrides 中存在 `parallel_groups` 字段，运行任意编排命令，stderr 包含 code `orchestration-overrides.unsupported-field`，进程退出码 0，其余合法 gate / mode 覆盖字段正常生效（不因 `parallel_groups` 使整体 overrides 失效）。

---

## 成功标准（Success Criteria）

**SC-001**：项目团队可在不修改 plugin 任何文件的前提下，通过唯一的 `.specify/orchestration-overrides.yaml` 文件实现 gate 行为差异化和 mode phase 序列裁剪，两个不同项目的 override 文件互不影响。

**SC-002**：overrides 校验失败时，工具始终完成执行（不崩溃、不阻塞）并通过 diagnostic 提供可操作的修复提示，用户无需阅读源码即可定位问题字段。

**SC-003**：`effective-orchestration` 命令的 `--annotate` 输出让用户能在 30 秒内判断任意字段的来源（base 还是 overrides），减少"配置为何不生效"类调试时间。

**SC-004**：8 个 SKILL.md 文件无需任何修改，overrides 自动对所有 mode（feature / story / fix / implement / refactor / resume / sync / doc）生效。

**SC-005**：`npm run repo:check` 在有/无 overrides 文件的项目下均通过，不影响现有 20+ 个校验项的结果（零回归）。

**SC-006**：`tests/orchestration-resolver.test.mjs` 涵盖合并、降级、CLI 三类场景，总测试数不少于 10 个 case，全部通过。

---

## Out of Scope（明确排除，MVP 不实现）

以下功能明确不在本 Feature 范围内，原因逐条说明：

| 排除项 | 排除原因 | 二期路径 |
|-------|---------|---------|
| **Phase patch**（按 phase id 局部 patch 单 phase 内的字段） | phases 数组有序且相互依赖（`gates_before`/`gates_after` 引用），追加/插入会破坏依赖链，需要专用 ID-based merge 逻辑，复杂度中等 | `orchestration-resolver.mjs` 的合并函数可扩展接受 `phase_patches` 字段 |
| **Mode `extends` 派生**（`modes.fix-strict.extends: fix`） | 需要实现 mode 继承解析链，防止循环引用，实现复杂度中等；schema 已预留 `extends` 字段位 | Resolver 在二期识别 `extends` 并展开派生链 |
| **并行组覆盖**（`parallel_groups.*` 内成员调整） | 并行组结构涉及 agent 分配调度，覆盖语义（追加/替换/删除成员）有歧义，复杂度高；MVP 中 `parallel_groups` 出现时 strip + warning | 单独 Feature 评估 |
| **Prompt 级覆盖**（`.specify/agents/<phase>.append.md`） | 属独立能力方向（agent prompt 定制），与 orchestration 结构覆盖是正交的两个维度 | 独立 Feature（产品调研已作为辅助方案 B 记录） |
| **子项目级 override**（monorepo 子包独立 `packages/*/orchestration-overrides.yaml`） | 需要 `projectRoot` 多值检索和优先级链，复杂度中等；MVP 只支持仓库根级粒度 | `resolveOrchestrationConfig` 可扩展支持 `searchPaths` 参数 |
| **任何对 plugin 内文件的反向修改**（`orchestration.yaml` / `agents/` / `SKILL.md`） | Plugin 内文件是 source-of-truth，不允许通过 overrides 机制反向修改，否则破坏版本管理边界 | 不在路线图 |
| **本 Feature 不修改任何 SKILL.md 的 prompt 文本** | SKILL.md 的 prompt 内容是 plugin source-of-truth 的一部分，overrides 通过 resolver 层感知，不需要也不允许修改 prompt 文本；"不改 SKILL.md 文件"约束进一步收紧为"不改 prompt 内容" | 不适用 |
| **override 版本锁定**（声明 override 兼容的 plugin 版本范围） | 需要版本比对和 semver 解析，与 `version` 字段比对是简化替代 | 远期 |
| **可视化 diff**（新旧 effective config 图形化对比） | CLI `--diff` 已覆盖核心文本差异需求；图形化属 UX 增强 | 远期 |

---

## 风险与假设

以下基于产研汇总 R1-R10，从**实现侧"如果没注意到会发生什么"**的视角重新表达：

**R1 — Mode 整段替换语义不直觉（高概率、高影响）**：如果实现时文档和示例不够清晰，用户期望"只覆盖几个 phase 的属性"但发现必须重写整个 phases 数组，会感到挫败甚至误认为是 bug。缓解：spec.md 中 FR-004 显式定义表格；`orchestration-overrides.example.yaml` 示范完整 phases 数组写法；`--diff` 命令输出中标注"整段替换，base phases 数为 N，overrides phases 数为 M"。

**R2 — `simple-yaml.mjs` 不提供行号，错误定位体验差（中概率、中影响）**：如果 overrides 文件校验失败，用户只能看到字段路径（如 `modes.fix.phases[1].id`）但无法定位具体行号。缓解：Zod 错误信息必须内嵌完整字段路径作为替代定位手段；文档明确说明行号不可用的限制；不支持 YAML anchor/merge key 也需文档标注。

**R3 — `repo-maintenance-core.mjs` 改动的高影响回归风险（低概率、高影响）**：该文件是 `repo:check` 核心入口，追加校验器时若接口不完全匹配 `{ status, checks, warnings, errors }` 规范，会导致整个校验链路中断。缓解：新校验器接口必须与 `validateWrapperSources()` 完全一致；同 PR 补 `validateOrchestrationOverrides` 的单元测试；实现前务必确认 `aggregateValidation` 调用方式与已有调用代码完全对称。

**R4 — Override 漂移（中概率、中影响）**：用户整段覆盖某 mode 后，plugin 后续版本对该 mode 的 bug 修复或 phase 优化无法自动继承，形成隐性技术债。缓解：`--annotate` 输出中每个 overrides 来源字段标注"此字段被 overrides 锁定，不继承 plugin 更新"；文档推荐"优先使用 gate 字段覆盖，仅在必要时整段重写 mode"。

**R5 — 测试框架不一致导致 CI 漏跑新测试（中概率、中影响）**：`orchestration-resolver.test.mjs` 使用 `node:test`，若 CI 仅配置了 `vitest run` 而未配置 `node --test`，新测试会被漏跑。缓解：实现前确认 CI 的 test 脚本同时覆盖 `node --test` 路径；同时验证 `npx vitest run` 对 `node:test` 文件的识别行为，必要时在 `package.json` 中追加独立的 `test:node` 脚本。

**R6 — 非法 overrides 不能搞崩工具（已在设计覆盖）**：FR-006 的降级策略已明确处理所有错误情形；实现时切勿在 resolver 内部 throw 未捕获异常，所有错误路径必须返回 `{ ..., isFallback: true, diagnostics: [warning] }`。

**R7 — Mode 名命名冲突（低概率、中影响）**：用户在 overrides 中声明 `modes.feature` 会整段覆盖 base 的 feature mode，可能是意图（场景 2）也可能是误操作；拼写错误（如 `modes.fxi`）此前可能被静默接受。缓解：触发 `orchestration-overrides.mode-overridden` info diagnostic，明确通知用户该 mode 已被整段替换；文档中区分"覆盖已有 mode"和"写错 mode 名"两种用法。

决策（GATE_DESIGN CL-001）：MVP 采纳 enum 校验，拒绝任何 base reserved list 之外的自定义 mode 名（修订版）；"warn 但仍生效" 是上一版本的暂定方案，已被 enum 校验取代。理由：拼写错误（如 `fxi`）立即暴露 + 防御性更强 + 为二期 extends 派生留更清晰的 schema 入口；产研汇总 R7 本已建议 enum 校验，specify 阶段的暂定偏离在 GATE_DESIGN 阶段被修正回原建议。

**R8 — 双校验链路不一致（已通过 CL-016 决策解决）**：详见已解决问题记录。原 R8 中"两套校验逻辑并存形成漂移"风险已通过本 Feature 顺带迁移 base 校验到 Zod 方案消除。

**R9 — Worktree 场景（已确认低风险）**：`.specify/orchestration-overrides.yaml` 纳入 git 跟踪，worktree 共享同一 git index，多 worktree 并行时配置天然一致。无额外风险。

**R10 — 子项目边界误期望（中概率、低影响）**：monorepo 用户可能期望每个子包有独立 overrides，MVP 只支持仓库级粒度。缓解：Out of Scope 章节明确声明；schema 说明文档中标注"V1 仅支持仓库级单一 overrides 文件"。

**R11 — base 校验迁移到 Zod 可能引入与现有 base orchestration.yaml 不兼容的 schema 约束（中概率、高影响）**：如果 `orchestrationBaseSchema` 定义的约束比现有文件结构更严格（如字段类型收紧、必填字段增加），则迁移后 base 文件无法通过 Zod 校验，阻塞所有 spec-driver 命令。缓解：迁移前先以现有 `orchestration.yaml` 为基准设计 schema，**先确保现有文件 100% 通过 Zod 校验**（可通过 `node -e "import('./contracts/orchestration-schema.mjs').then(m => console.log(m.orchestrationBaseSchema.safeParse(yaml)))"` 快速验证），再扩展为 overrides 兼容；测试矩阵必须覆盖 base 单独校验 + base+overrides 合并校验两条路径。

**R12 — 扩大的回归测试面（中概率、中影响）**：base 校验迁移到 Zod 后，新增的 base schema 校验逻辑需要额外的测试覆盖；若测试不足，迁移引入的隐性 bug 可能在生产中才暴露。缓解：在 `tests/orchestrator.test.mjs` 增量补充 base Zod 校验断言（见 AC-021）；CI 必须跑 `npm run lint` + `npm run build` + `npx vitest run` 三项，全部零失败后方可合并；`orchestration-resolver.test.mjs` T2 测试增量覆盖 base 校验失败路径。

---

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：新增 5 个模块（`orchestration-resolver.mjs`、`orchestration-schema.mjs`（含三件套 schema）、`validate-orchestration-overrides.mjs`、`orchestrator-cli.mjs` 新增 case 算作 1 个改造点，`orchestrator.mjs` base 校验迁移算作 1 个改造点）
- **接口数量**：新增 3 个（`resolveOrchestrationConfig()`、`validateOrchestrationOverrides()`、CLI `effective-orchestration` 子命令）；修改 2 个（`orchestrator-cli.mjs` 主命令 dispatcher + `orchestrator.mjs` 的 `validateOrchestrationYaml()` 替换）
- **依赖新引入数**：0（`zod` 和 `simple-yaml.mjs` 均已在项目中）
- **跨模块耦合**：修改 3 个现有文件（`orchestrator-cli.mjs` + `repo-maintenance-core.mjs` + `orchestrator.mjs`）；`orchestrator-cli.mjs` 和 `repo-maintenance-core.mjs` 为追加式修改，`orchestrator.mjs` 为函数替换（将 `validateOrchestrationYaml()` 迁移到 Zod）
- **复杂度信号**：无递归结构；无状态机；无并发控制；无数据迁移；有专用合并函数（`mergeOrchestrationConfigs()`，约 40-50 行，需精确处理 modes/gates 的不同合并语义）；base 校验迁移需要回归测试面扩展
- **总体复杂度**：**MEDIUM**（CL-016 激进方案将 `orchestrator.mjs` 纳入改动范围，组件增至 5 个，接口改动增至 5 个，回归测试面扩大）

工作量估算（基于产研汇总更新）：新增约 530-560 行（原 480 行 + base schema 扩展约 40-50 行 + base 迁移测试增量约 20-30 行），小改约 33 行（`orchestrator-cli.mjs` + `repo-maintenance-core.mjs`），`orchestrator.mjs` 小改（用 Zod schema 替换 `validateOrchestrationYaml()`，净改约 20-30 行）。关键文件清单：

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `lib/orchestration-resolver.mjs` | 新增 | 主 resolver 逻辑 |
| `contracts/orchestration-schema.mjs` | 新增 | 三件套 Zod schema |
| `scripts/validate-orchestration-overrides.mjs` | 新增 | repo:check 校验器 |
| `tests/orchestration-resolver.test.mjs` | 新增 | T1/T2/T3 测试 |
| `contracts/orchestration-overrides-contract.yaml` | 新增 | 人读合同文档 |
| `templates/orchestration-overrides.example.yaml` | 新增 | 示例文件 |
| `scripts/orchestrator-cli.mjs` | 小改 | 追加 effective-orchestration case |
| `scripts/lib/repo-maintenance-core.mjs` | 小改 | 追加 aggregateValidation 调用 |
| `lib/orchestrator.mjs` | 小改 | 用 Zod schema 替换 `validateOrchestrationYaml()` |
| `tests/orchestrator.test.mjs` | 小改 | 增量补充 base Zod 校验断言 |

---

## 已解决问题（原 Open Questions）

**OQ-001 — `--annotate` 的注释粒度**（实现侧决策）：维持 Mode 级和 Gate 级注释粒度，不下钻到 phase 数组元素。理由：Mode 整段替换语义下，phase 级 source 标注提供零增量信息；Phase 2 引入 phase patch 时再扩展。（见 FR-005、CL-005）

**OQ-002 — 双校验链路协作边界**（GATE_DESIGN CL-016 决策）：本 Feature 顺带将 `validateOrchestrationYaml()` 迁移到 Zod schema，使用 `orchestrationBaseSchema` 统一校验 base config，消除双链路漂移风险（R8）。决策选择了 CL-016 选项 B（激进方案），扩大实施范围约 50-80 行，涉及 `orchestrator.mjs` 的小改和 base 回归测试面扩展。（见 FR-023、FR-024、FR-025、R11、R12、AC-019 ～ AC-021）

---

## 修订记录

### v1.1（2026-04-26）— GATE_DESIGN CL-001/008/010/016 + CHK-008/030

| 决策 | 涉及章节 | 修改类型 | 修改内容摘要 |
|------|---------|---------|------------|
| **CL-001**（enum 校验） | Edge Cases、FR-004、FR-007-A、数据契约、R7 | 修改 + 新增 FR | Edge Cases 首条改为 enum 拒绝非 reserved mode 名；FR-004 表格补充 enum 说明；新增 FR-007-A 描述 modes enum 校验；数据契约 `modes.*` 类型从 `Record<string>` 改为 `enum<feature\|story\|...\|refactor>` |
| **CL-008**（version-mismatch 专属 code） | FR-007、FR-006 表格、Diagnostic code 清单、AC-022 | 修改 + 新增 AC | FR-007 从"触发 schema-fallback"改为"触发 version-mismatch"；Diagnostic code 清单新增 `version-mismatch` 行；新增 AC-022 验证专属 code |
| **CL-010**（strip + warning） | NFR-003、FR-004、FR-022、Diagnostic code 清单、Edge Cases、AC-023 | 修改 + 新增 FR + 新增 AC | NFR-003 从严格 `.strict()` 改为"顶层未知字段 .strict()，二期保留字段 strip + warning"；FR-004 表格改 `parallel_groups` 为 strip；新增 FR-022 描述 strip 行为；Diagnostic code 清单新增 `unsupported-field` 行；Edge Cases 新增 `parallel_groups` 条目；新增 AC-023 |
| **CL-016**（base 校验迁移到 Zod） | FR-002、FR-013、FR-023 ～ FR-025、NFR-006、NFR-007、Out of Scope、R8、R11、R12、复杂度评估、AC-019 ～ AC-021、已解决问题 | 修改 + 新增 FR（3条）+ 新增 AC（3条）+ 新增 Risk（2条）| FR-002 加入 base Zod 校验步骤；FR-013 扩展为三件套 schema；新增 FR-023/024/025；新增 NFR-006 DRY 原则 + NFR-007 回归覆盖；Out of Scope 新增"不改 SKILL.md prompt 文本"条目；R8 标注已解决；新增 R11/R12；复杂度升至 MEDIUM；工作量估算更新为 530-560 行；新增 AC-019/020/021；"已解决问题"章节记录 OQ-002 |
| **CHK-008**（FR-020/021 无对应 AC） | FR-020、FR-021、AC-017、AC-018 | 新增 AC（2条）| FR-020/021 添加"关联 AC"引用；新增 AC-017 + AC-018 |
| **CHK-030**（R7 与产研汇总分歧） | R7 | 修改 | R7 末尾追加 GATE_DESIGN 决策记录，说明 enum 校验取代旧版"warn 但仍生效"方案及理由 |
