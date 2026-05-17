# Feature Specification: Eval CLI Infrastructure Uplift (T052 Lift 量化前置)

**Feature Branch**: `166-eval-cli-infra-uplift`
**Created**: 2026-05-17
**Status**: Draft（已过 Specify Phase Codex 对抗审查 round 1：3 CRITICAL + 5 WARNING + 1 INFO 全修；等待 GATE_DESIGN）
**模式**: story（无调研阶段，基于编排器注入的代码上下文摘要）

---

## 背景与动机

Feature 165 在 master HEAD `3532e16` 完成了真实 cohort C 9-run smoke test，**T053 充要标准 ③ + ④ PASS**（detect_changes 真实调用 + changedSymbols 真实非空），但 oracle goldpatch fuzzy match 仅 **2/9 = 22%**，远低于 simulated equivalent 的 **7/9 = 77.8%**（详见 `specs/147-spectra-spec-driver-eval-platform/competitive-evaluation-report.md` §10.5.1.3）。

归因分析（§10.5.1.6）显示，oracle fuzzy match 偏低的根因是 3 项 `scripts/eval-mcp-augmented.mjs` CLI infrastructure 限制，与 Feature 165 的核心问题（graph 注入链路 / consumption signals）无关：

| # | 限制 | 当前实现 | 量化影响（n=9） |
|---|------|---------|----------------|
| 1 | `DEFAULT_TIMEOUT_MS` 30 min 硬上限 | `scripts/eval-mcp-augmented.mjs:82` 写死 `1_800_000` | **3/9** 次运行触发 SIGTERM，driver 未完成 patch |
| 2 | Driver 模型 hardcoded `claude-sonnet-4-6` | `scripts/eval-mcp-augmented.mjs:926` `buildClaudeArgsWithMcp` | Sonnet 4-6 解题能力相对 Opus 4-7 受限，部分任务在合理时间内无法收敛 |
| 3 | `--output-format text` 截断 reasoning trace | `scripts/eval-mcp-augmented.mjs:927-928` hardcode `text` | stdout 仅含最终 assistant 文本，丢失 driver thinking + tool_use / tool_result 事件，导致 `extractConsumptionSignals` 的 `reasoning-trace-mention` 类型实际只能匹配最终文本（漏报严重） |

本 Feature 目标是**前置消除以上 3 项 CLI 限制**，使后续 T052 全量 450 runs 能在不受 CLI infrastructure 干扰的条件下取得稳定的 lift 量化数据。

**本 Feature 不在范围内**（避免范围蔓延）：

- 不跑 T052 全量 450 runs（本 Feature 完成后另立 Feature）
- 不修复 §10.5.1 已有报告内容（保持 master HEAD `3532e16` 报告原文不变）
- 不改 Cohort A / B 的 prompt（仅 buildClaudeArgsWithMcp 影响 driver model + output-format，对所有 cohort 一致生效，但 prompt 内容不变）

---

## User Scenarios & Testing

### User Story 1 — DEFAULT_TIMEOUT_MS 30 min 提升到 45 min（Priority: P1）

作为评估平台维护者，我希望 cohort C（及 A / B）每次运行的硬超时从 30 min 提升到 45 min，使 driver 有充分时间完成需要多步 reasoning 的 SWE-Bench-Lite 任务，而不是被 SIGTERM 截断。

**Why this priority**: §10.5.1 数据显示 3/9 = 33% 的运行因 30 min timeout 触发 SIGTERM，是 oracle fuzzy match 偏低的最主要单因素。

**Independent Test**: 修改 `scripts/eval-mcp-augmented.mjs:82` 的 `DEFAULT_TIMEOUT_MS` 常量为 `2_700_000`（45 min × 60 × 1000），执行 `npx vitest run scripts/`（或 `tests/unit/eval-mcp-augmented*.test.ts`）验证所有现有单测仍 PASS、且没有任何测试硬编码 `1_800_000` 或 `30 * 60 * 1000` 期望值。

**Acceptance Scenarios**:

1. **Given** `scripts/eval-mcp-augmented.mjs:82` 的常量值已修改为 `2_700_000`，**When** `grep -n "1_800_000\|1800000\|30 \* 60 \* 1000" scripts/eval-mcp-augmented.mjs`，**Then** 没有任何残留（除非有显式合理用途且注释说明，如不同上下文的另一独立 timeout）。
2. **Given** 单测目录 `tests/unit/eval-mcp-augmented-*.test.ts`，**When** 执行 `npx vitest run tests/unit/eval-mcp-augmented`，**Then** 全部 PASS，且如果有测试断言 timeout 值则更新到 `2_700_000`。

---

### User Story 2 — Driver 模型从 sonnet-4-6 升级到 opus-4-7（Priority: P1）

作为评估平台维护者，我希望 driver 使用 `claude-opus-4-7` 而非 `claude-sonnet-4-6`，使解题能力提升以减少 driver 在合理时间内无法收敛的概率。

**Why this priority**: §10.5.1.3 oracle 7/9 vs 实际 2/9 的差距表明 driver 解题能力是关键瓶颈。`claude-opus-4-7` 是当前 Claude 4.X 系列最强模型，提升解题能力符合 §10.4.X 的 T052 启动前提要求。

**[NEEDS CLARIFICATION C-001]**: Driver 模型升级目标

用户原始描述中提到 "升级到 `claude-sonnet-4-7` 或 `claude-opus-4-7`"，但 Anthropic Claude 4.X 系列当前最新 Sonnet 仍为 `claude-sonnet-4-6`（无 4-7 版本，详见系统提示 `Opus 4.7: 'claude-opus-4-7', Sonnet 4.6: 'claude-sonnet-4-6', Haiku 4.5: 'claude-haiku-4-5-20251001'`）。

**spec 默认推荐 `claude-opus-4-7`** 作为升级目标（依据：`claude-sonnet-4-7` 不存在；用户两个选项中唯一可用的是 opus-4-7；CLAUDE.md `模型选择策略` 允许"测试场景如 Sonnet 解题能力不足可升 Opus"），但本决策因涉及 **5x cost 影响**（Anthropic 价格：opus-4 $15/$75 per MTok vs sonnet-4-6 $3/$15 per MTok，单次 cohort C run 估算从 ~$0.25 升至 ~$1.25）和 API 配额可用性变化，**MUST 在 GATE_DESIGN 阶段由用户明确确认**，不允许 AUTO-RESOLVED。

GATE_DESIGN 用户选项：

- **A**: 接受推荐（claude-opus-4-7） — 单次 ~$1.25，本 Feature 1 run 验证 ~$1.5 预算
- **B**: 保持 sonnet-4-6（仅修 timeout + stream-json，不改 model） — 单次 ~$0.25，但 oracle fuzzy match 改善预期较弱
- **C**: 自定义其他模型（如 haiku-4-5、claude-sonnet-4-6 with extended thinking 等） — 用户指定

Cost 影响详见 SC-005 / FR-013 / EC-006。

**Independent Test**: 修改 `scripts/eval-mcp-augmented.mjs:926` 的字符串为 `'claude-opus-4-7'`，执行单测验证 `buildClaudeArgsWithMcp` 返回的 `--model` 参数为 `claude-opus-4-7`；执行 `claude --print --model claude-opus-4-7 --max-turns 1 "say hi"` 验证 CLI 接受该模型（需有 ANTHROPIC_API_KEY，本地环境未配置则跳过）。

**Acceptance Scenarios**:

1. **Given** `scripts/eval-mcp-augmented.mjs:926` 已修改为 `'claude-opus-4-7'`，**When** `grep -n "claude-sonnet-4-6\|sonnet-4-6" scripts/eval-mcp-augmented.mjs`，**Then** 没有任何残留（注释中如有历史引用应明确标注 "Feature 166 前的旧默认"）。
2. **Given** `buildClaudeArgsWithMcp({ prompt: 'test' })` 被调用，**When** 检查返回数组，**Then** 包含连续的 `'--model'` 和 `'claude-opus-4-7'` 两个元素。
3. **Given** 至少 1 个新增/更新的单测，**When** 单测对 `buildClaudeArgsWithMcp` 返回值做断言，**Then** 断言 `claude-opus-4-7` 出现且 `claude-sonnet-4-6` 不出现。

---

### User Story 3 — `--output-format` 从 text 改为 stream-json + 新增 parser（Priority: P1）

作为评估平台维护者，我希望 claude CLI 用 `--output-format stream-json` 而非 `text`，并新增一个 stream-json parser，使我能从 driver 完整捕获 thinking（reasoning trace）+ tool_use + tool_result 事件，让 `extractConsumptionSignals` 的 `reasoning-trace-mention` 类型基于完整 reasoning trace 而非最终 stdout 文本进行匹配。

**Why this priority**: 当前 `extractConsumptionSignals` 使用 `stdout` 字符串匹配 reasoning trace（`scripts/eval-mcp-augmented.mjs:453-494`），但 `--output-format text` 模式下 stdout 只含最终 assistant text，driver 中间的 thinking 和 tool_use 完全丢失，导致 `reasoning-trace-mention` 类型实际只能匹配最终输出，漏报严重。

**Independent Test**: 新增 `scripts/lib/parse-claude-stream-json.mjs` parser 模块，提供 `parseClaudeStreamJson(stdout: string) → { events: Array<...>, reasoningTrace: string, toolUses: Array<{tool, args}>, toolResults: Array<{result}> }` 函数；新增至少 10 个单测覆盖：(a) 单条 type=assistant 事件解析、(b) 单条 type=user content array 事件、(c) tool_use 事件、(d) tool_result 事件、(e) malformed JSON 行容错、(f) 空输入、(g) 仅 system init 事件、(h) reasoning trace 字段聚合、(i) tool name 提取、(j) end-to-end 复合 fixture。

**Acceptance Scenarios**:

1. **Given** `scripts/eval-mcp-augmented.mjs:927-928` 已修改为 `'--output-format', 'stream-json'` 并补充 `--verbose` 或必要的 stream-json 前置参数，**When** `grep -n "output-format.*text\|'text'" scripts/eval-mcp-augmented.mjs`（限定 output-format 上下文），**Then** 没有任何残留（claude CLI 文档说 `stream-json` 仅在 `--print` 模式下工作，需同时确保 `--print` 已存在，line 924 已有）。
2. **Given** `scripts/lib/parse-claude-stream-json.mjs` 存在且 export `parseClaudeStreamJson`，**When** 单测 `tests/unit/parse-claude-stream-json.test.ts` 执行，**Then** 至少 10 个测试用例 PASS，覆盖上述 (a)-(j) 场景。
3. **Given** `runOne()` 函数在 cohort C 分支已调用 `parseClaudeStreamJson(runOutcome.stdout)`，**When** 检查 `runResult` 对象，**Then** 包含 `driverEvents` 字段（或合并到 `graphInjection.reasoningTrace`）记录完整 events，且至少含 type=assistant / tool_use / tool_result 三类事件（若 stream-json 输出包含）。
4. **Given** `extractConsumptionSignals` 已适配，**When** 传入 reasoning trace（来自 parser）替代原 stdout 参数，**Then** `reasoning-trace-mention` 类型匹配命中数 ≥ 原 stdout 模式的命中数（同一 fixture 比对），且新增的 thinking 文本能被覆盖到。

---

### User Story 4 — 1 个真实 cohort C run 端到端验证（Priority: P2）

作为评估平台维护者，我希望在完成以上 3 项改动后，跑 1 个真实 cohort C run，端到端验证 stream-json 完整解析 + reasoning trace 捕获 + consumption signals 升级，确认 CLI infrastructure 改动不引入回归。

**Why this priority**: 单测不足以验证 claude CLI stream-json 实际输出格式（与文档可能存在差异）；1 个真实 run（~$0.25）是最小成本的端到端 confidence check，必须做但不需要 9-run smoke 规模。

**Independent Test**: 执行 1 次 `node scripts/eval-mcp-augmented.mjs --group C --task <任一 SWE-L 任务> --repeat 1`，验证：(a) stdout 包含 stream-json 格式（每行 JSON object）；(b) `runResult.driverEvents` 或 `graphInjection.reasoningTrace` 字段非空；(c) `consumptionSignals` 数组中 `reasoning-trace-mention` 类型至少出现 1 次（或合理记录 0 次的原因）；(d) 总成本 ≤ $0.25。

**Acceptance Scenarios**:

1. **Given** 所有 3 项 CLI 改动已落地，**When** 执行 1 次真实 cohort C run，**Then** 命令正常退出（exit 0）且 timeout 未触发。
2. **Given** run 完成，**When** 检查 `tests/baseline/swe-bench-lite/runs/<run>.json`，**Then** 文件存在、JSON 合法、包含 driverEvents / reasoningTrace 字段。
3. **Given** run 完成，**When** 统计 cost（runResult.costUsd 或 telemetry），**Then** ≤ $0.25。
4. **Given** stream-json parser 处理实际 driver 输出，**When** 检查 parser 解析结果，**Then** 没有 malformed JSON 警告，所有事件类型合法。

---

### Edge Cases

- **EC-001 (stream-json 解析失败)**：claude CLI 输出某行 JSON malformed → parser 必须容错跳过坏行，继续处理后续行；记录跳过的行数和位置（`malformedLineCount` 字段）。
- **EC-002 (claude CLI 不支持 stream-json)**：claude CLI v2.1.138 已确认支持 `stream-json`（见 `claude --help` 输出），但若未来 CLI 降级或环境异常，buildClaudeArgsWithMcp 应能通过单测验证参数格式正确；运行时 CLI 拒绝则由 spawnClaudeAndWait 的 stderr 捕获。
- **EC-003 (sonnet-4-6 残留)**：替换为 opus-4-7（或 GATE_DESIGN 用户决策的其他模型）后，必须 `grep -rn "claude-sonnet-4-6\|sonnet-4-6" scripts/ src/ tests/` 检查所有残留；如有 fixture / snapshot 含 sonnet-4-6 字符串，必须同步更新或显式标注理由。
- **EC-004 (timeout 仍超出 45 min)**：极少数任务可能 45 min 仍不够；此情况按 SIGTERM 处理（原有逻辑），但通过 stream-json 已记录的 events 仍可保留供分析，driverEvents 不丢失。
- **EC-005 (向后兼容 fixture)**：tests/baseline/swe-bench-lite/ 下如有历史 fixture 含 sonnet-4-6 / text format 的 claudeArgs 字段 → 仅作为历史记录，不作为正确性断言；本 Feature 仅需保证新 run 写入的 fixture 用新格式。
- **EC-006 (cost 控制)**：1 个真实 cohort C run（验证用）的预算上限取决于 GATE_DESIGN C-001 决策：选 opus-4-7 上限 **$1.5**（5x sonnet 价 + 20% 余量）；选 sonnet-4-6 上限 **$0.25**。若实际超出预算硬上限，verify 阶段视为 SC-005 FAIL；不允许"仅标注"放行。预算计算依据：opus-4 $15/$75 per MTok vs sonnet-4-6 $3/$15 per MTok（5x 比例），原 sonnet-4-6 cohort C 实测 ~$0.25 → opus-4-7 估算 ~$1.25 → 留 20% 余量 → $1.5 硬上限。
- **EC-007 (extractConsumptionSignals 签名兼容)**：函数签名 `extractConsumptionSignals({ changedSymbols, mcpToolCalls, stdout, patchText })` 中的 `stdout` 字段如改名为 `reasoningTrace`，所有调用方需同步更新；保留 stdout 作为参数名（向后兼容）但在调用方传入 reasoning trace 字符串也是合理选项。
- **EC-008 (stream-json 输出超大)**：claude CLI stream-json 模式累计输出可能 > 10 MB（长 reasoning + 多次 tool_use）。parser 必须能处理：按行流式解析（不一次性 `JSON.parse(stdout)`），totalLineCount 字段记录总行数；若超过 100 MB 上限，警告但继续解析（不抛错）。
- **EC-009 (partial last line)**：claude CLI 异常中断（SIGTERM / OOM）可能导致 stdout 最后一行未换行结尾。parser MUST 容错处理 partial 行：按 malformed 处理（jsondown 容错跳过），不影响前面已解析的 events。
- **EC-010 (redacted_thinking content blocks)**：Anthropic SDK assistant event 中可能包含 `type: 'redacted_thinking'` block（encrypted thinking，无法解密）。parser MUST 保留这些 block 在 `events` 数组中（原始 JSON 形式），但 `reasoningTrace` 字符串聚合时 MUST 排除（仅聚合 `type: 'text'` 和 `type: 'thinking'` 中的 `text`/`thinking` 字段）。
- **EC-011 (cohort A/B 共享 buildClaudeArgsWithMcp 切换格式影响)**：`buildClaudeArgsWithMcp` 是所有 cohort 共享的 args 构造器；切到 `stream-json` + `opus-4-7` 后，cohort A / B 也会受影响：(a) 所有 cohort 的 driver 模型一致升级（保证对照公平性，符合实验设计原则），(b) cohort A / B 的 stdout 也会变成 stream-json 格式，但本 Feature 不在 cohort A / B 的 runOne 分支调 parser；如未来 cohort A / B 需要 stream-json 解析，可复用 `parseClaudeStreamJson` 模块（不在本 Feature 范围）。
- **EC-012 (opus-4-7 preflight 失败)**：在第一个真实 run 前 MUST 执行 preflight check（`claude --print --model claude-opus-4-7 --max-turns 1 "ok"`）确认模型可用。若失败（API 401 / model not found / quota exceeded）：(a) 用户在 GATE_DESIGN 已确认选 opus-4-7 → verify 阶段视为 SC-005 FAIL，建议 fallback 到 sonnet-4-6 并标注；(b) 用户在 GATE_DESIGN 选 B（sonnet-4-6）→ 不触发 preflight，无问题。

---

## Requirements

### Functional Requirements

#### 改动 1：DEFAULT_TIMEOUT_MS

- **FR-001 [必须]**: `scripts/eval-mcp-augmented.mjs:82` 的 `DEFAULT_TIMEOUT_MS` 常量值 MUST 从 `1_800_000` 修改为 `2_700_000`（45 min × 60 × 1000）。
- **FR-002 [必须]**: 该常量的注释 MUST 同步更新为反映新值（如 "45 min hard ceiling"）。
- **FR-003 [可选]**: 如果存在其他 timeout 配置（如 SPECTRA_EVAL_TIMEOUT_MS env override），保持原行为不变；本 Feature 仅修改 DEFAULT_TIMEOUT_MS 常量本身。

#### 改动 2：Driver 模型升级（依 GATE_DESIGN C-001 决策）

- **FR-004 [必须]**: `scripts/eval-mcp-augmented.mjs:926` 的 hardcoded 字符串 `'claude-sonnet-4-6'` MUST 修改为 GATE_DESIGN 阶段用户决策的模型字符串（默认推荐 `'claude-opus-4-7'`，详见 User Story 2 NEEDS CLARIFICATION C-001）。
- **FR-005 [必须]**: 至少 1 个单测 MUST 验证 `buildClaudeArgsWithMcp` 返回数组中 `--model` 后跟 GATE_DESIGN 决策的模型字符串（动态适配 implement 时已知的最终决策值）。
- **FR-006 [可选]**: 如未来需要支持 model 切换，可考虑提取为 `EVAL_DRIVER_MODEL` env var 或 constant，但本 Feature **不做**（YAGNI；当前仅 1 个使用点，过早抽象违反 Constitution III）。
- **FR-017 [必须，新增]**: implement 阶段（在跑真实 cohort C run 前）MUST 执行 opus-4-7 preflight check：`claude --print --model <GATE_DESIGN 决策模型> --max-turns 1 --output-format text "ok"`，确认模型可用且 API key 有效。失败处理见 EC-012。

#### 改动 3：stream-json + parser

- **FR-007 [必须]**: `scripts/eval-mcp-augmented.mjs:927-928` 的 `'--output-format', 'text'` MUST 修改为 `'--output-format', 'stream-json'`，并补充必要的前置参数。claude CLI v2.1.138 文档明确：`stream-json` 输出格式要求 `--print` 已存在（line 924 已有）；并且 implement 阶段 MUST 实测确认是否需要 `--verbose` 参数（claude CLI 部分版本要求 stream-json 必须配合 verbose 输出 system init / result events，否则输出退化）。实测结果以 FR-018 验证。
- **FR-008 [必须]**: 新增 `scripts/lib/parse-claude-stream-json.mjs` 模块，export `parseClaudeStreamJson(stdout: string)` 函数，返回结构 `{ events: Array<{ type, ...payload }>, reasoningTrace: string, malformedLineCount: number, totalLineCount: number }`。具体字段（精简 YAGNI 后）：
  - `events`：所有合法 JSON 行的原始对象数组（按出现顺序）；caller 可自行 filter 出 tool_use / tool_result 等。
  - `reasoningTrace`：从所有 `type === 'assistant'` 事件聚合 content 拼接字符串。聚合规则（EC-010）：仅聚合 `message.content[]` 中 `type: 'text'` block 的 `text` 字段和 `type: 'thinking'` block 的 `thinking` 字段；`type: 'redacted_thinking'`（encrypted thinking）和 `type: 'tool_use'`（结构化数据）block 保留在 events 中但不进入 reasoningTrace 拼接。
  - `malformedLineCount`：跳过的坏行数量（EC-001 / EC-009）。
  - `totalLineCount`：stdout 总行数（含空行 + 坏行 + 好行）；用于 sanity check。
- **FR-009 [必须]**: parser MUST 容错跳过 malformed JSON 行（与 `parseTelemetryJsonl` 现有风格一致），跳过的行计入 `malformedLineCount` 但不阻塞后续解析；空行不计入 malformed。
- **FR-010 [必须]**: 新增 `tests/unit/parse-claude-stream-json.test.ts`，至少 10 个测试用例（详见 User Story 3 Independent Test）。补充覆盖：(k) redacted_thinking block 保留在 events 但不进入 reasoningTrace、(l) partial last line（无换行结尾）容错、(m) 超大输出（mock 1 MB stdout）流式按行解析不 OOM。
- **FR-011 [必须]**: `runOne()` 函数在 cohort C 分支（`group === 'C'`）调用 `parseClaudeStreamJson(runOutcome.stdout)`，并将结果挂载到 `runResult` 对象上的 `driverEvents` 字段（结构与 parser 返回值一致）。
- **FR-012 [必须]**: `extractConsumptionSignals` 在 `runOne()` cohort C 分支中的调用 MUST 传入 parser 解析出的 `reasoningTrace`（而非原 `runOutcome.stdout`）作为 `stdout` 参数。函数签名保持向后兼容（参数名仍为 `stdout`，但语义升级为 reasoning trace）。
- **FR-018 [必须，新增]**: implement 阶段 MUST 在 1 个真实 cohort C run 中验证 `--output-format stream-json` 的 CLI 参数矩阵（含 `--strict-mcp-config` + `--mcp-config` + `--print` 组合）兼容性：stdout 必须为每行 JSON 格式（grep 验证）。**`--verbose` 已硬决策加入 buildClaudeArgsWithMcp**（依据 `scripts/eval-task-runner.mjs:224` 既有实证："stream-json 需要 --verbose 才能完整 dump tool_use block"），单测 MUST 断言 `--verbose` 出现在 args 中。

- **FR-019 [必须，新增 Codex C-010 修复]**: `runOne()` cohort C 分支 MUST 从 `driverEvents.events` 中找到 `type === 'result'` 事件，提取 `total_cost_usd`（Anthropic SDK stream-json result event 标准字段），赋给 `realCostUsd`（替换 line 1399-1400 原 `const realCostUsd = null`）。非 cohort C 沿用 null（不变）。这是 SC-005 cost 验证的 ground truth 数据源。

#### 验证

- **FR-013 [必须]**: 跑 1 个真实 cohort C run（任一 SWE-L 任务，repeat=1），验证：(a) stream-json 完整解析（每行 JSON 合法）、(b) `driverEvents` 字段非空（含 events + reasoningTrace）、(c) cost 不超出 EC-006 定义的硬上限（opus-4-7 ≤ $1.5 / sonnet-4-6 ≤ $0.25，依 GATE_DESIGN C-001 决策）、(d) 命令正常退出。
- **FR-014 [必须]**: `npx vitest run` 全量单测 MUST 零失败。基线测试数取自实际跑 rebase 后的 master + 本 Feature 改动后的当前 commit（不绑定旧 HEAD `3532e16` 的硬数字，避免 master 漂移导致虚假回归）。新增至少 13 个 parser 单测（FR-010 覆盖 (a)-(m)）+ 至少 1 个 buildClaudeArgsWithMcp 模型字符串单测。
- **FR-015 [必须]**: `npm run build` MUST 零错误。
- **FR-016 [必须]**: `npm run repo:check` MUST 零警告。

---

### Key Entities

- **DriverEvent**：单条 stream-json 事件，对应 claude CLI 输出的一行 JSON object。字段：`type ∈ {'system', 'assistant', 'user', 'result'}`、`subtype?`、`message?`（含 `content` 数组）、`usage?`、`uuid?`、`session_id?` 等（按 claude CLI stream-json schema）。
- **ParsedClaudeStream**：parser 返回的聚合结构。字段（精简 YAGNI 后）：`events: DriverEvent[]`、`reasoningTrace: string`、`malformedLineCount: number`、`totalLineCount: number`。**不**返回 toolUses / toolResults（caller 可直接从 events 数组 filter；mcpToolCalls 已由 telemetry 路径统计，不需要 parser 重复计算）。
- **ReasoningTrace**：所有 assistant 事件中 `type: 'text'` 和 `type: 'thinking'` content blocks 聚合后的字符串（排除 redacted_thinking 和 tool_use blocks），用于 `extractConsumptionSignals` 的 `reasoning-trace-mention` 类型匹配。
- **ConsumptionSignal**（已存在）：本 Feature 不改其类型定义，但 `evidenceLocation` 字面值含义升级：原 `messages[N].content` 表示 stdout 第 N 行，新含义表示 reasoning trace 中第 N 行（trace 拼接后的 split('\n') 索引）。命名保持兼容。

---

## Success Criteria

- **SC-001 (timeout 升级生效)**：`DEFAULT_TIMEOUT_MS === 2_700_000`，且 `grep -n "1_800_000\|1800000" scripts/eval-mcp-augmented.mjs` 无残留（注释引用除外）。
- **SC-002 (driver 模型升级生效)**：`buildClaudeArgsWithMcp` 输出包含 GATE_DESIGN 决策的模型字符串，`grep -n "claude-sonnet-4-6" scripts/eval-mcp-augmented.mjs` 无残留（注释引用除外）。
- **SC-003 (stream-json + parser 落地)**：`--output-format stream-json` 生效；`scripts/lib/parse-claude-stream-json.mjs` 存在；新单测 ≥ 13 个 PASS（FR-010 覆盖 (a)-(m)）。
- **SC-004 (runOne 集成)**：`runResult.driverEvents` 在 cohort C run 中非空（含 events / reasoningTrace / malformedLineCount / totalLineCount 四字段）；`extractConsumptionSignals` 在 cohort C 路径中用 reasoning trace 替代 stdout。
- **SC-005 (端到端 confidence)**：1 个真实 cohort C run：(a) cost 不超出 EC-006 硬上限（opus-4-7 ≤ $1.5 / sonnet-4-6 ≤ $0.25，依 GATE_DESIGN C-001）、(b) 命令正常退出（exit 0，无 SIGTERM）、(c) parser 解析 malformedLineCount / totalLineCount 比例 < 5%（>= 5% 视为 stream-json 输出格式异常需 fix）。
- **SC-006 (零回归)**：`npx vitest run` 全量零失败（基线测试数取 rebase 后 master HEAD 实测）、`npm run build` 零错误、`npm run repo:check` 零警告。
- **SC-007 (Codex 对抗审查 PASS)**：每个 phase commit 前的 Codex review CRITICAL 全修复，WARNING 有合理理由（commit message 标注）。
- **SC-008 (opus-4-7 preflight)**：如 GATE_DESIGN 选 opus-4-7，跑真实 cohort C run 前 preflight `claude --print --model claude-opus-4-7 --max-turns 1 "ok"` 成功；失败按 EC-012 处理。

---

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：1 个新增模块（`scripts/lib/parse-claude-stream-json.mjs`）+ 1 个新增单测（`tests/unit/parse-claude-stream-json.test.ts`）+ 修改 1 个现有文件（`scripts/eval-mcp-augmented.mjs`） = 总计 **3 个文件**
- **接口数量**：1 个新增 export（`parseClaudeStreamJson()`）+ 1 个修改函数（`buildClaudeArgsWithMcp` 返回值不变但内部 args 变化）+ 1 个修改函数（`runOne` 在 cohort C 分支新增 parser 调用 + `extractConsumptionSignals` 调用方式微调）= 总计 **3 个接口变化**
- **依赖新引入数**：**0**（parser 用 Node 内置 JSON.parse，无新 npm 包）
- **跨模块耦合**：**1 处**（`runOne` → 新 parser 模块；不影响其他 cohort 或 spectra 主线）
- **复杂度信号**：
  - 递归结构：无
  - 状态机：无
  - 并发控制：无
  - 数据迁移：无（fixture 向后兼容由 EC-005 处理）
- **总体复杂度**：**LOW**
  - 组件 < 3 ✅
  - 接口 < 4 ✅
  - 无复杂度信号 ✅
- **GATE_DESIGN 建议**：因 C-001 NEEDS CLARIFICATION（driver 模型升级目标 + cost 影响），**MUST 暂停等待用户决策**；不允许 AUTO_CONTINUE。Codex 对抗审查环节 round 1 已完成（3 CRITICAL + 5 WARNING + 1 INFO 全修复），如 GATE_DESIGN 阶段用户提出新维度需求可触发 round 2。

---

## 假设和依赖

- **假设 A1**：claude CLI v2.1.138（已确认本地版本）`stream-json` 输出 schema 与 Anthropic SDK message schema 一致（`type: 'assistant' | 'user' | 'system' | 'result'`，`message.content: Array<TextBlock | ToolUseBlock | ThinkingBlock | RedactedThinkingBlock>`）。如实际 schema 有差异，FR-008 字段定义可能需要 implement 阶段微调。
- **假设 A2**：`claude --output-format stream-json` 必须配合 `--print`（已确认 line 924 已有 `--print`）。是否需要额外 `--verbose` 由 FR-018 实测决定（不再是无验证断言的软假设）。
- **假设 A3 → 升级为 FR-017 硬验证**：~~`claude-opus-4-7` 在用户的 ANTHROPIC_API_KEY 配额下可用~~ → 替换为 FR-017 preflight check + EC-012 失败处理路径。
- **依赖 D1**：master HEAD `3532e16`（Feature 165 真实 cohort C 9-run smoke 已完成）。本 Feature 必须先 rebase 到 master 最新再开发；rebase 后 vitest 基线测试数以实际跑出来的 PASS 数为准（FR-014 不再硬编码 3676）。
- **依赖 D2**：CLAUDE.local.md 规定每个 phase commit 前 Codex 对抗审查，本 Feature 必须遵守（specify / plan / tasks / implement / verify 五个 phase commit 各一次 codex review）。

---

## Out of Scope（避免范围蔓延）

- ❌ T052 全量 450 runs 实跑（本 Feature 完成后另立 Feature）
- ❌ 修复 §10.5.1 已有报告内容（保持 commit `3532e16` 原文）
- ❌ Cohort A / B prompt 内容改动（注：buildClaudeArgsWithMcp 共享 args，model + output-format 升级会对所有 cohort 一致生效；这是公平对照要求，不视为 scope creep。详见 EC-011）
- ❌ Driver model 抽象为配置项 / env var（FR-006 标注为 [YAGNI 可选]，本 Feature 不做）
- ❌ stream-json parser 扩展到非 cohort C 场景：cohort A / B 的 stdout 会因 buildClaudeArgsWithMcp 共享而变成 stream-json 格式，但 runOne() 只在 cohort C 分支调用 parser；cohort A / B 的 stdout 解析（如未来需要）可复用 `parseClaudeStreamJson` 模块，本 Feature 不做。
- ❌ extractConsumptionSignals 算法本身的改进（如新增 signal 类型）
- ❌ telemetry schema 变更（telemetryPath 等保持原结构）
