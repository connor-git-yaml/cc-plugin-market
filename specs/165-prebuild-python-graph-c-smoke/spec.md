# Feature Specification: Pre-build Python Graph & Cohort C Smoke Test

**Feature Branch**: `165-prebuild-python-graph-c-smoke`
**Created**: 2026-05-15
**Status**: Draft (Codex adversarial review applied — round 1)
**模式**: story（无调研阶段，基于编排器注入的代码上下文摘要）

---

## 背景与动机

Feature 162 Pilot 27 已完成 27/27 成功落地，Feature 164 修复了 Cohort C 的 `mcpToolCallCount` 统计路径（9/9 mcpCalls > 0）。然而，9/9 次运行均返回 `graph-not-built`——目标仓库（pytest / astropy / sympy）从未预先生成 spectra graph，导致 Cohort C（grounding augmentation）无法真实注入语义载荷。

本 Feature 目标是：

1. 为三个 SWE-Bench-Lite Python 仓库预生成 spectra graph（LLM full panoramic 模式）
2. 在 Cohort C 9-run smoke test 中将 graph 注入到 worktree，使 `detect_changes` 能真实返回 `changedSymbols` 语义载荷
3. 将 smoke 结果写入 §10.5.1 并更新 §10.4 战略结论，给出 T052 全量建议

**重要判定（多重强调以避免误读）**：

- **T053 = smoke test，不是 lift gate**。在 n=9 的样本规模下，±11pp 的结果差异完全在 LLM 方差范围内，**不具备统计显著性**。
- **T053 通过的唯一充要标准**：
  1. graph 必须真实生成（schema 合法 + callSites 非空）；
  2. graph 必须真实注入到 Cohort C 每次运行的 worktree；
  3. driver 必须真实调用 `detect_changes` 且 `changedSymbols` 真实非空；
  4. driver 后续行为 trace 中可观察到对 `changedSymbols` 的消费（或合理记录"未消费"作为后续分析依据）。
- **以上 4 条同时成立 = T053 通过；任一不成立 = T053 失败，不允许以"fallback 已记录"为由通过**。
- **§10.4 中给出的 T052 建议必须限定为"是否具备 T052 的操作前提"，不得作为 lift 显著性结论**。

---

## User Scenarios & Testing

### User Story 1 — 为三个 Python 仓库预生成 spectra graph（Priority: P1）

作为评估平台维护者，我希望在 `~/.spectra-baselines/{pytest,astropy,sympy}/` 目录下生成可供 Cohort C 消费的 spectra graph 文件，使后续 smoke test 能提供真实的语义 grounding 载荷，而不是始终返回 `graph-not-built`。

**Why this priority**: 没有预生成 graph，Cohort C 的 grounding augmentation 永远是空载荷，T053 smoke test 无从验证注入效果；这是整个 Feature 的前提条件。

**Independent Test**: 对三个仓库各自触发 spectra 生成，验证 `~/.spectra-baselines/<repo>/specs/_meta/graph.json` 存在、文件非空、schema 合法（包含 `nodes`/`links`/`callSites` 字段且 `callSites` 长度 > 0），且不出现在本仓库 `git status` 中。

**Acceptance Scenarios**:

1. **Given** `~/.spectra-baselines/pytest/` 已 clone 且本仓库 `dist/cli/index.js` 已通过 `npm run build` 构建，**When** 执行 `spectra batch . --mode full --budget 5 --concurrency 3 --on-over-budget cancel --no-html`（cwd=`~/.spectra-baselines/pytest/`），**Then** `~/.spectra-baselines/pytest/specs/_meta/graph.json` 存在、非空、schema 合法、`callSites.length > 0`、且记录了 `spectraVersion=4.1.1`。
2. **Given** astropy 和 sympy 仓库同样完成 graph 生成（命令格式同上，`--budget` 分别为 10），**When** 检查三个仓库的 graph 文件，**Then** 三者均存在、均 schema 合法、均含非空 `callSites`、均记录 spectraVersion。
3. **Given** LLM 生成过程中累计成本达到对应仓库 `--budget` 上限（spectra 内置 budget gate 触发 `--on-over-budget cancel`），**When** 触发预算上限，**Then** spectra batch 主动中止当前仓库 build，标记该仓库为 `graph-build-failed`，不产生半成品 graph 文件；已完成的其他仓库不受影响。
4. **Given** 三个仓库的 graph 生成完成，**When** 运行 `git status`，**Then** `~/.spectra-baselines/` 路径下没有任何文件出现在本仓库 tracked changes 中（baseline 仓库位于 home 目录，与本仓库工作区物理隔离，但需显式验证）。

---

### User Story 2 — Cohort C smoke test 注入 graph 并完成 9 次运行（Priority: P1）

作为评估平台维护者，我希望在 Cohort C（grounding augmentation cohort）的 9 次 SWE-Bench-Lite 运行中，每次运行前将对应仓库的 `graph.json` 注入到 worktree 的正确路径，使 `detect_changes` 真实返回非空 `changedSymbols` 语义载荷，并验证 driver 行为是否消费该载荷。

**Why this priority**: 这是验证 grounding payload 能否真实注入并被 driver 消费的核心验证点；没有这一步，Feature 没有任何有效产出。

**Independent Test**: 执行 Cohort C 9-run smoke test，检查每次运行的 telemetry 记录，确认：(a) `graphInjection.status === 'success'`；(b) `detectChangesCallCount >= 1`；(c) 至少一次 `detect_changes` 响应的 `changedSymbolsCount > 0`；(d) 无任何一次出现 `graph-not-built` 错误码。

**Acceptance Scenarios**:

1. **Given** 三个仓库的 graph.json 已预生成且 schema 合法，**When** 触发 Cohort C 9 次运行（SWE-L001/003/005 各 3 次），**Then** 每次运行的 worktree 中 `specs/_meta/graph.json` 存在（atomic 复制成功），且 telemetry 包含 `graphInjection: {status: 'success', sourcePath, destPath, sourceHash, spectraVersion, graphSchemaVersion}`。
2. **Given** Cohort C 运行完成，**When** 统计 telemetry，**Then** 9 次运行全部满足：`detectChangesCallCount >= 1` ∧ 至少一次 `changedSymbolsCount > 0` ∧ 无 `graph-not-built` ∧ 无 `graph-schema-mismatch` ∧ 无 `payload-empty` 错误码。
3. **Given** Cohort A / B 对照组未注入 graph，**When** Cohort C 注入完成，**Then** Cohort A / B 的运行（若同任务重新触发）前置断言确认 worktree 中无 `specs/_meta/graph.json`（如已存在视为污染，需 fail fast）；本 Feature 不重跑 A / B，但断言机制 MUST 落地以保护未来对照。
4. **Given** graph 注入成功且 driver 调用了 detect_changes 返回非空 changedSymbols，**When** driver 后续行为 trace 显示其未对 changedSymbols 做任何引用 / 派生（payload 注入但 driver 不消费），**Then** smoke test **不算失败**——T053 通过标准为"注入成功 + driver 调用 + 收到非空载荷"，"driver 是否消费"作为独立观察项写入 §10.5.1 driver behavior trace 子节。
5. **Given** 9 次运行中有一次 `detect_changes` 返回 `changedSymbolsCount = 0`，**Then** 此次 smoke 视为 **payload-empty 失败**，T053 整体不通过。

---

### User Story 3 — 填写 §10.5.1 smoke 结果并更新 §10.4 战略结论（Priority: P1）

作为项目决策者，我希望在 `competitive-evaluation-report.md` 的 §10.5.1 中看到完整的 smoke 数据（含 3-5 个真实 `detect_changes` 响应样本和 driver 行为 trace），并在 §10.4 中获得明确的 T052 全量（450 runs）启动前提建议（**非 lift 结论**），以便做出下一步资源分配决策。

**Why this priority**: 报告是本 Feature 的唯一对外可见产出；没有报告更新，图谱预生成和 smoke 运行的业务价值无法传达给决策者。

**Independent Test**: 打开 `competitive-evaluation-report.md`，验证 §10.5.1 章节存在且包含 smoke 摘要、至少 3 个真实 `detect_changes` 响应摘录、driver 行为描述；§10.4 包含对 T052 的明确建议、T053 定位声明、以及"smoke 数据不构成 lift 显著性"声明。

**Acceptance Scenarios**:

1. **Given** Cohort C 9 次运行完成，**When** 撰写 §10.5.1，**Then** 章节包含：(a) 运行摘要表（注入成功率、`detectChangesCallCount` 平均值、`changedSymbolsCount` 分布、无 `graph-not-built` / `graph-schema-mismatch` / `payload-empty` 出现）；(b) 3-5 个 `detect_changes` 真实原始响应摘录（节选 `changedSymbols` 子集 + 完整 errorCode）；(c) driver 行为 trace 子节（是否调用 `mcp__spectra__context` 顺手查 symbol、patch 路径是否引用 changedSymbols、与 F164 broken 时随机猜测的对比）。
2. **Given** §10.5.1 数据完整，**When** 更新 §10.4，**Then** 战略结论明确给出 T052 是否具备启动**操作前提**（注入合同稳定、telemetry 可信、graph schema 一致），并显式说明本数据**不构成** lift 显著性证据（n=9，方差 dominate）；T052 启动决策权归用户。
3. **Given** 报告更新完成，**When** 检查 §10.4 中 T053 的定位描述，**Then** 明确注明"T053 为 smoke test 而非 lift gate，n=9 样本不具备统计显著性"，避免被后续读者误读为定量声明。
4. **Given** smoke test 中任一 SC 失败（如 1/9 出现 `graph-schema-mismatch`），**When** 撰写 §10.5.1，**Then** 章节如实记录失败次数和 errorCode 分类，**不允许选择性过滤**；§10.4 中标记"T053 失败，T052 启动前提不具备"。

---

### User Story 4 — 保持现有测试与构建零回归（Priority: P2）

作为平台维护者，我希望本 Feature 的改动不破坏现有的 3635 条 vitest 测试、TypeScript 构建和 repo:check，以确保 eval pipeline 的稳定性不受影响。

**Why this priority**: 回归防护是交付质量的底线，优先级低于核心功能交付，但必须在交付前验证。

**Independent Test**: 执行 `npx vitest run` + `npm run build` + `npm run repo:check`，全部零失败。

**Acceptance Scenarios**:

1. **Given** Feature 165 改动完成，**When** 运行 `npx vitest run`，**Then** 全部 ≥3635 条测试通过，零新增失败。
2. **Given** TypeScript 编译，**When** 运行 `npm run build`，**Then** 零类型错误、零编译错误。
3. **Given** 仓库同步检查，**When** 运行 `npm run repo:check`，**Then** 零错误。

---

### Edge Cases

**EC-001（关联 US1 / FR-001 / FR-002）**：graph build 部分失败——三个仓库中某一个 spectra batch 抛出异常 / 超时 / 触发 budget cancel。
处理方式：标记该仓库为 `graph-build-failed`；**该仓库对应的 task fixture（如 pytest 仓库的 SWE-L001）的 3 次 Cohort C 运行视为 T053 整体失败**，不允许以"其他两个 repo 成功"为由声称 T053 通过；§10.5.1 明确记录哪个仓库失败 + 失败 errorCode；§10.4 战略结论标记 T053 失败。

**EC-002（关联 US2 / FR-003 / FR-014）**：Cohort C 9 次运行中部分 worktree 注入失败——可能是 graph 注入路径错误或文件复制失败。
处理方式：每 run telemetry 必须显式写入 `graphInjection.status = 'failed'` + errorCode；该 run 视为 T053 单次失败；累计任一失败 = T053 整体失败；不允许 fallback 路径下声称通过。

**EC-003（关联 US1 / FR-008）**：LLM panoramic 生成成本超过约定预算（默认 spectra `--budget` flag + `--on-over-budget cancel`）。
处理方式：依赖 spectra 内置 budget gate，主动 cancel 当前仓库 build；编排器在跑批前显式设置 `--budget` 上限（建议 pytest 5 / astropy 10 / sympy 10，合计 25，超额风险已 cover）；执行后人工核对实际成本，超出 $25 上限则在 §10.5.1 记录"成本超支"作为风险信号，但不阻断报告完成。

**EC-004（关联 US2 / US3 / FR-007）**：driver 收到非空 `changedSymbols` 后行为无变化（payload 注入成功但 driver 不消费）。
处理方式：此情景**不构成 smoke test 失败**——T053 通过标准为"注入 + 调用 + 非空载荷"。在 §10.5.1 driver behavior trace 子节如实描述 driver 行为；在 §10.4 中将此作为 T052 的"操作前提具备但语义价值待证"信号，启动决策权归用户。

**EC-005（关联 US1 / FR-005）**：graph.json 意外进入本仓库 git 追踪。
处理方式：交付前 `git status` 明确确认无 graph 文件出现在 tracked changes 中；如已追踪则执行 `git rm --cached` + 补充 gitignore 规则后重新提交；本 Feature 默认 graph 位于 `~/.spectra-baselines/` 物理隔离区，理论上不可能被追踪，但需显式验证。

**EC-006（关联 FR-011 / FR-014）**：graph.json 由旧版 spectra 生成，与当前 MCP tool runtime 期望的 schema 版本不匹配。
处理方式：每次 graph build 后记录 `spectraVersion` 和 `graphSchemaVersion` 到 graph.json 文件本身（或随附 sidecar metadata）；注入前 Cohort C runner 比对当前 spectra 版本，不匹配时写入 `graphInjection.errorCode = 'graph-schema-mismatch'`，该 run 视为 T053 失败。

**EC-007（关联 FR-012）**：driver 因为 prompt 或上下文不当，9 次中有 N 次未调用 `mcp__spectra__detect_changes`（`detectChangesCallCount = 0`）。
处理方式：该 run 视为 T053 单次失败（不算 graph 问题，但 grounding 验证目的未达成）；累计任一失败 = T053 整体失败；§10.5.1 记录 driver 拒绝调用次数及 prompt 诊断信号。

**EC-008（关联 FR-014）**：Cohort A / B 运行前置断言发现 worktree 中已有 `specs/_meta/graph.json`（之前 Cohort C 运行残留）。
处理方式：worktree path 段已按 (taskId, tool) 隔离，残留属严重 bug；A / B runner 触发断言失败 fail fast，停止当前 task，不污染对照组；本 Feature 实际不重跑 A / B，但断言机制 MUST 在代码中实现以保护未来对照。

---

## Requirements

### Functional Requirements

**FR-001**：系统 MUST 为 pytest / astropy / sympy 三个仓库各生成一个 schema 合法的 `specs/_meta/graph.json` 文件，存放于对应的 `~/.spectra-baselines/<repo>/` 目录下；每个 graph.json 必须包含 `nodes`、`links`、`callSites` 三个字段且 `callSites.length > 0`。`[必须]`
> 可追踪：US1、EC-001

**FR-002**：graph 生成 MUST 使用 spectra CLI 的 LLM full panoramic 模式，具体命令格式为：`spectra batch . --mode full --budget <USD> --concurrency 3 --on-over-budget cancel --no-html`（cwd 为对应 baseline 仓库根目录）。预先必须执行 `npm run build` 生成 `dist/cli/index.js`。具体 budget 上限：pytest 5 / astropy 10 / sympy 10（合计 25，含 25% 余量）。`[必须]`
> 可追踪：US1
> [AUTO-RESOLVED: 编排器已明确指定 LLM full（含 callSites 语义增强），理由是 grounding payload 富度优先；AST-only fast path 因 callSites 可能为空被排除]

**FR-003**：Cohort C 的每次 task 运行，在 LLM 调用前 MUST 使用 atomic copy（临时文件 + 原子 rename）将对应仓库的 `graph.json` 复制到当次 worktree 的 `specs/_meta/graph.json` 路径；Cohort A / B MUST NOT 注入 graph，且 A / B runner MUST 前置断言 worktree 中无 `specs/_meta/graph.json`，发现残留即 fail fast。`[必须]`
> 可追踪：US2、EC-002、EC-008

**FR-004**：Feature 164 修复的 `graph-not-built` fallback 路径 MUST 保留，作为 graph 文件损坏或复制失败时的防御性降级。`buildGroupCPrompt` 中"预期失败"措辞需软化为"通常 graph 存在；若返回 graph-not-built 才走 fallback"。**但 fallback 路径下的 run MUST 在 telemetry 中标记 `graphInjection.status = 'failed'`，且该 run 视为 T053 单次失败，不允许以"fallback 已记录"为由通过 T053**。`[必须]`
> 可追踪：US2、EC-002

**FR-005**：生成的 graph.json 文件 MUST 不出现在本仓库 `git status` 的 tracked changes 中。由于 baseline 位于 `~/.spectra-baselines/` 与本仓库工作区物理隔离，理论上无需修改本仓库 `.gitignore`；如发现追踪，则交付前 `git rm --cached` 并补充 `.gitignore` 规则。`[必须]`
> 可追踪：US1、EC-005

**FR-006**：`competitive-evaluation-report.md` 的 §10.5.1 MUST 新建并包含：(a) smoke 运行摘要表（注入成功率、`detectChangesCallCount` 平均值、`changedSymbolsCount` 分布、各 errorCode 计数）；(b) 至少 3 个真实 `detect_changes` 原始响应摘录（节选 `changedSymbols` 子集 + errorCode）；(c) driver 行为 trace 子节（含与 F164 broken 时随机猜测的对比）；(d) T053 通过/失败判定结论（按 4 条充要标准逐一勾选）。`[必须]`
> 可追踪：US3

**FR-007**：§10.4 战略结论 MUST 包含三段声明：(a) T053 通过 / 失败 / 部分失败的判定；(b) 对 T052 全量 450 runs 是否具备"操作前提"（注入合同稳定、telemetry 可信、graph schema 一致）的明确建议，但 **MUST NOT** 以本 Feature 的 9-run 数据声称 lift 显著性；(c) "T053 为 smoke test 而非 lift gate，n=9 不具备统计显著性"的显式声明。`[必须]`
> 可追踪：US3

**FR-008（Round 3 补充时间预算来源）**：LLM graph 生成成本通过 spectra CLI `--budget` flag 强制控制（pytest 5 / astropy 10 / sympy 10，spectra 内置 budget gate 触发 cancel）；总成本上限 SHOULD 不超过 $25。

**成本预算来源依据**：pytest 51 MB / astropy 235 MB / sympy 242 MB Python 代码体积，参考 CLAUDE.local.md Baseline 测试中"self-dogfood ~250 .ts / 17 module ~$6"和"karpathy/nanoGPT 15 .py / 1.5k LOC ~$0.40"两个 anchor 推算 — pytest budget 5（含 5x 余量）/ astropy & sympy budget 10（含 2x 余量）。

**时间预算来源依据**：参考用户需求原文"pytest ~5min wall + astropy ~30min wall + sympy ~30min wall = ~65min 一次性"，以及 §10.4 line 580 实测数据"Feature 162 pilot 27 A+B 137min wall + C cohort 46min rerun"。本 Feature graph build 总时间预算 ≤90min（含 1.4x 余量；超过则记录 "time-budget-exceeded" 风险信号，不阻断）。

**校准要求**：graph build 前 MUST 执行 spectra `--dry-run` 预估当前仓库实际 token 量和墙钟时间；若 dry-run 估算 cost > 对应仓库 `--budget` 或 wall > 60min（单仓库），MUST 调整 budget 或终止并标记 `graph-build-failed`。

**软约束**：累计实际成本若超过 $25 或总 wall 超过 90min，在 §10.5.1 记录风险信号，但不阻断报告完成（不构成 T053 失败标准）。`[必须]`
> 可追踪：US1、EC-003

**FR-009**：Feature 交付后，`npx vitest run` MUST 全部通过（≥3635 条），`npm run build` 和 `npm run repo:check` MUST 零错误。`[必须]`
> 可追踪：US4

**FR-010**：smoke test MUST 严格限于 SWE-L001 / SWE-L003 / SWE-L005 三个 task fixture（各 3 次，共 9 次），不扩大也不缩小样本范围；扩大 / 缩小均需独立 spec 决策。`[必须]`
> 可追踪：US2

**FR-011（新增 — Codex C-02/C-04 + Round 2 + Round 3 修复）**：graph.json 文件 MUST 内嵌或随附 `spectraVersion` 和 `graphSchemaVersion` 元数据；Cohort C runner MUST 在两个时机执行校验：

- **(a) 注入前（source 文件校验）**：(1) schema 合法性 — `nodes`、`links`、`callSites` 字段存在；(2) `callSites.length > 0`；(3) `source.graphSchemaVersion === runtimeExpectedGraphSchemaVersion`（runtime 期望版本由 MCP server 在 startup 时报告，或 fallback 到 baseline-runner 启动时通过 `spectra --version` 探测）。
- **(b) 复制完成后（dest 文件二次校验）**：atomic rename 完成后 MUST 重新读取 destPath，并比对：(1) `destHash === sourceHash`（确认 atomic copy 完整性）；(2) `dest.graphSchemaVersion === runtimeExpectedGraphSchemaVersion`（确认 dest 文件未被外部进程篡改）。

**错误码表（标准化定义）**：

| errorCode | 触发条件 |
|-----------|---------|
| `graph-not-built` | Feature 164 fallback 路径，graph.json 不存在或无法读取（防御性降级） |
| `graph-schema-mismatch` | (a) 阶段 source schema 缺字段，或 graphSchemaVersion 与 runtime 期望版本不一致 |
| `payload-empty` | (a) 阶段 `callSites.length === 0`；或 detect_changes 响应 `changedSymbolsCount === 0` |
| `copy-integrity-failed` | (b) 阶段 destHash !== sourceHash，或 dest.graphSchemaVersion 校验失败 |

任一时机不通过即记录对应 errorCode，该 run 视为 T053 失败。`[必须]`
> 可追踪：US1、US2、EC-006

**FR-012（新增 — Codex C-03 + Round 2 + Round 3 修复）**：每次 Cohort C run 的 telemetry MUST 显式记录 `detectChangesCallCount`、各次 `changedSymbolsCount`、`mcpToolCalls` 完整列表（含 `toolName` + `status` + `bytes`）。driver 行为 trace MUST 记录结构化的 `consumptionSignals` 数组，每个 signal 包含字段 `{signalType, matchedSymbol?, matchedFilePath?, evidenceLocation, evidenceTextSnippet}`，可机械化识别三类信号：

| signalType | 识别规则（机械化） | 必填字段 |
|------------|-------------------|---------|
| `patch-diff-literal` | git patch diff 文本中正则匹配 `changedSymbols[].symbolName` 或 `.filePath` | `matchedSymbol` 或 `matchedFilePath`、`evidenceLocation = "patch:line N"` |
| `derived-mcp-call` | detect_changes 调用后的 mcpToolCalls 中出现 `mcp__spectra__context` / `mcp__spectra__impact`，且其 `arguments.symbolId` 或 `arguments.filePath` 匹配 changedSymbols | `matchedSymbol`、`evidenceLocation = "mcpToolCalls[idx]"` |
| `reasoning-trace-mention` | driver 的 thinking / message text 中正则匹配 `changedSymbols[].symbolName` 或 `.filePath`，或包含明确的因果短语（如"根据 detect_changes"、"按照 changedSymbols"） | `matchedSymbol` 或 `matchedFilePath`、`evidenceLocation = "messages[idx].content"`、`evidenceTextSnippet`（≤120 chars） |

`consumptionSignals.length > 0` 即视为"消费"；为空则记录 `consumptionStatus: 'payload-injected-but-not-consumed'`（不构成 T053 失败，但需在 §10.5.1 显式列出该 run 的现象作为后续 Feature 输入信号）。**注：reasoning-trace-mention 的"因果短语"列表可在实施阶段由人工或简单 LLM 二次判读补充，spec 提供初始 mechanical pattern 不要求 100% 精确召回**。`[必须]`
> 可追踪：US2、US3、EC-007

**FR-013（新增 — Codex W-01 修复）**：每次 Cohort C run 在 LLM 调用前 MUST 写入结构化 telemetry `graphInjection: {status: 'success'|'failed', sourcePath, destPath, sourceHash, spectraVersion, graphSchemaVersion, errorCode?}`，无论成功还是失败都必须写。`[必须]`
> 可追踪：US2、EC-002

**FR-014（新增 — Codex C-05 修复 + 第二轮 PARTIAL 修复）**：Cohort C 注入 MUST 使用 atomic copy 模式（写临时文件 → atomic rename → fsync）；**注入时机合同**：MUST 在 `prepareWorktree` 完成（返回 worktree path）之后、`runTask` LLM 调用之前的独立 hook 中执行，**不修改 baseline-runner 的 `prepareWorktree` 内部**（baseline-runner 是共享合同，保持不变），而是在 `scripts/eval-mcp-augmented.mjs` 的 Cohort C 分支中调用 prepareWorktree 后追加注入步骤。并发 task 之间 worktree 已按 (taskId, tool) 隔离（baseline-runner 现有合同），本 Feature 不引入新并发。Cohort A / B runner MUST 前置断言 worktree 中无 `specs/_meta/graph.json`，发现即 fail fast 避免污染。`[必须]`
> 可追踪：US2、EC-008

---

## Success Criteria

### Measurable Outcomes

**SC-001**：pytest / astropy / sympy 三个仓库的 `specs/_meta/graph.json` 全部存在、schema 合法（`nodes`/`links`/`callSites` 字段存在且 `callSites.length > 0`）、`spectraVersion` 和 `graphSchemaVersion` 元数据记录完整、且 `graphSchemaVersion === runtimeExpectedGraphSchemaVersion`（与本仓库当前 MCP server 运行时期望版本匹配）；均不出现在本仓库 `git status` tracked changes 中。

**SC-002**：Cohort C 9 次运行中，全部满足：(a) `graphInjection.status === 'success'`；(b) `detectChangesCallCount >= 1`；(c) 至少一次 `changedSymbolsCount > 0`；(d) `graphSchemaVersion` 与 runtime expected 版本一致（FR-011 校验通过）；(e) 无 `graph-not-built` / `graph-schema-mismatch` / `payload-empty` / `copy-integrity-failed` errorCode。任一未满足即 SC-002 失败。

**SC-003**：`competitive-evaluation-report.md` §10.5.1 章节新增完整，包含：(a) 运行摘要表（4 项关键指标）；(b) ≥3 个真实 `detect_changes` 响应摘录；(c) driver 行为 trace 子节（含 F164 对比）；(d) T053 通过/失败判定。§10.4 包含 T052 操作前提建议、T053 定位声明、不构成 lift 显著性声明三段。

**SC-004**：本 Feature 交付后，`npx vitest run` 显示 ≥3635 条通过，零失败；`npm run build` 零错误；`npm run repo:check` 零错误。

**SC-005**：总 LLM 成本（graph 生成 + smoke 运行合计）软目标 ≤ $25；超支不阻断交付，但 §10.5.1 必须记录实际成本。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|-----|------|
| **组件总数** | 3 | (1) `eval-mcp-augmented.mjs` 修改 — graph injection + schema 校验 + telemetry contract；(2) `competitive-evaluation-report.md` §10.5.1 / §10.4 报告填写；(3) 新增 graph build 脚本（包装 spectra batch 命令 + 预算控制） |
| **接口数量** | 3 | (1) `prepareWorktree` 之后注入点（atomic copy + schema validate）；(2) telemetry `graphInjection` 结构化字段；(3) Cohort A/B 前置断言（无 graph 残留） |
| **依赖新引入数** | 0 | 无新外部依赖；spectra CLI 已存在 |
| **跨模块耦合** | 否 | 仅修改 `scripts/eval-mcp-augmented.mjs` + 新增 `scripts/baselines/build-swe-l-graphs.sh`（或等效）+ 报告文档；不触及 spec-driver 插件内核或 spectra 内核 |
| **复杂度信号** | 1 | atomic copy + schema validate 引入轻量"操作正确性"复杂度（非递归 / 状态机 / 并发），但需在测试中显式覆盖 |
| **总体复杂度** | **MEDIUM** | 组件 3、接口 3、有 1 个复杂度信号（atomic copy + schema validate） |

**判定依据**：本 Feature 主要工作是：(1) 在 `~/.spectra-baselines/<repo>/` 跑 spectra batch CLI；(2) 在 Cohort C 运行逻辑中插入注入点（含 schema 校验 + telemetry contract + atomic copy）；(3) 撰写报告章节。复杂度从初版 LOW 升级为 MEDIUM 因为 Codex review 揭示了 schema 校验、telemetry contract、Cohort A/B 隔离断言等增量合同。**GATE_DESIGN 不建议自动通过**——schema、telemetry、并发隔离的精细程度需要人工审查（gate_policy=balanced + severity=critical 自动触发暂停展示）。

---

## Codex Adversarial Review 处置记录

### Round 1（6 critical + 4 warning + 2 info）

| 编号 | 等级 | 处置 | 修复位置 |
|------|------|------|---------|
| C-01 | critical | 修：FR-002 明确 CLI 合同 + npm run build 前置 | FR-002 |
| C-02 | critical | 修：FR-001 / FR-011 增加 schema + callSites > 0 + spectraVersion | FR-001、FR-011 |
| C-03 | critical | 修：FR-012 明确 detectChangesCallCount / changedSymbolsCount / consumption trace | FR-012 |
| C-04 | critical | 修：EC-006 + FR-011 引入 graphSchemaVersion 比对 | EC-006、FR-011 |
| C-05 | critical | 修：FR-014 atomic copy + Cohort A/B 前置断言 | FR-014、EC-008 |
| C-06 | critical | 修：EC-001 / EC-002 / FR-004 明确 fallback 不等于 T053 通过 | EC-001、EC-002、FR-004 |
| W-01 | warning | 修：FR-013 telemetry contract（每 run 写入 graphInjection）| FR-013 |
| W-02 | warning | 修：FR-007 限定 §10.4 为 T052 操作前提，不是 lift 推荐 | FR-007 |
| W-03 | warning | 接受软约束：FR-008 通过 spectra `--budget` flag 强制，超支为风险信号不阻断 | FR-008 |
| W-04 | warning | 修：FR-005 改为"本仓库 tracked changes 中" | FR-005 |
| I-01 | info | 修：FR-010 改为 MUST `[必须]` | FR-010 |
| I-02 | info | 修：复杂度评估 MEDIUM + 显式人工审查 | 复杂度评估 |

### Round 2（1 critical PARTIAL + 3 warning PARTIAL）

| 编号 | 等级 | 处置 | 修复位置 |
|------|------|------|---------|
| C-04 PARTIAL | critical | 修：FR-011 增加 (a) source 注入前 schema + version 比对 (b) dest atomic-rename 后 destHash === sourceHash + version 二次校验 + 新增 errorCode `copy-integrity-failed`；SC-001/SC-002 纳入 graphSchemaVersion 校验 | FR-011、SC-001、SC-002 |
| C-03 PARTIAL | warning | 修：FR-012 增加第三类 reasoning trace 消费证据；三类全无显式标注 "payload-injected-but-not-consumed"（非 T053 失败标准，但需在 §10.5.1 记录） | FR-012 |
| C-05 PARTIAL | warning | 修：FR-014 明确注入时机合同（prepareWorktree 完成后、runTask LLM 调用前的独立 hook），不修改 baseline-runner 内部 | FR-014 |
| W-03 PARTIAL | warning | 修：FR-008 增加预算来源依据（pytest/astropy/sympy 与 CLAUDE.local.md baseline 项目的 anchor 推算）+ dry-run calibration 要求 | FR-008 |

### Round 3（4 PARTIAL — 详细化修复）

| 编号 | 等级 | 处置 | 修复位置 |
|------|------|------|---------|
| FR-011 PARTIAL | critical | 补：dest 二次校验 graphSchemaVersion + 新增标准化错误码表（4 种 errorCode 触发条件） | FR-011 |
| FR-012 PARTIAL | warning | 补：consumptionSignals 结构化字段（signalType/matchedSymbol/matchedFilePath/evidenceLocation/evidenceTextSnippet）+ 三类信号的机械化识别规则表 | FR-012 |
| FR-008 PARTIAL | warning | 补：时间预算来源依据（用户需求 65min + §10.4 实测 137min/46min anchor）+ 90min 总上限 + 单仓库 60min 校准触发 | FR-008 |
| SC-001 PARTIAL | warning | 补：升级为 `graphSchemaVersion === runtimeExpectedGraphSchemaVersion` 匹配断言 | SC-001 |
