# Feature Specification: Spectra MCP Tool Description + Response 优化

**Feature Branch**: `170c-mcp-tool-description-response`
**Created**: 2026-05-28
**Status**: Draft
**Feature 编号**: F170c
**Milestone**: M7（第二个 Feature，F170a 已 ship）

---

## 背景与动机

F170a 修复了协同部署阻塞 Bug（master HEAD 4e17e70）。然而 Stage 7b 实测数据揭示更深层问题：`impact` 工具的 driver 主动调用率约为 0%，`context` 工具调用率仅 67%，根因是现有 tool description（30-50 字）缺乏 "Use this tool when" 引导、无示例、无工具链提示，导致 driver LLM 不知道何时调用这些工具。本 Feature 通过升级 tool description（Phase A）和扩展 response format（Phase B）两条线并行提升 driver 主动调用率，全程保持向后兼容硬约束。

---

## User Scenarios & Testing

### User Story 1 — Tool Description 含 4 要素（优先级：P1）

作为一个 MCP driver（LLM agent），我需要每个 Spectra MCP tool 的 description 明确告诉我「什么时候应该调用它」「调用示例是什么」「调用后下一步做什么」，这样我才能在正确的时机主动选择正确的工具，而不是被强制 push。

**Why this priority**：这是 description 升级的基础合格线。driver 能读到 description 之后才能做出主动调用决策，是 User Story 2（impact 主动调用率提升）的前提条件。任何一个 tool 的 description 不满足 4 要素，User Story 2 目标均不可达。

**Independent Test**：直接解析已注册的 3 个 agent-context tool 的 description 字符串，静态断言内容结构，无需启动 driver，无网络依赖，可完全离线运行。

**Acceptance Scenarios**：

1. **Given** Spectra MCP server 已启动并注册了 `detect_changes`、`context`、`impact` 三个 agent-context 工具，**When** 解析每个工具的 description 文本，**Then** 每个 description 必须满足以下**统一的 4 要素验收口径**：(a) 长度位于 100-500 字符区间（含上下限；**implement 阶段修订**：从初始 100-300 放宽到 100-500，因为中英混合 + 多行 4 要素结构在 300 字符内难以充分表达每个要素，500 是符合 Anthropic 推荐"长 description 优于短"原则的合理上限），(b) 第一行或首段为"核心功能一句话描述"的 lead-in 文本（非独立要素，作为 use-case 段的前导上下文，不进入计数；但若该 lead-in 缺失或长度 < 10 字符则视为整个 description 不达标），(c) 包含 "Use this tool when" 段落并枚举 ≥ 3 个 use-case 场景，(d) 包含 "Example" 段落，含 input 示例与关键 output 字段示例对，(e) 包含 "Typical chained usage" 段落并至少给出 1 个 chained usage 示例。**口径说明**：FR-001/002/003 列出的"核心功能一句话描述 + 4 要素"是描述结构语义；SC-001 与本验收 1 是其测试投影，本验收 1 中 (a)-(e) 全数达标即视为满足 FR-001/002/003。

2. **Given** `impact` 工具当前 description 仅约 30-50 字且无场景引导，**When** 升级后重新解析，**Then** 满足验收 1 的全部 5 项 (a)-(e)，且其 chained usage 示例必须显式包含标准链路 `detect_changes → impact → context`。

3. **Given** F170c Phase A 升级范围仅限 `detect_changes` / `context` / `impact` 三个 agent-context tool（FR-004 修订后已收敛），**When** 解析这 3 个工具的 description，**Then** 每个均满足验收 1 的 (a)-(e)，且测试报告必须按工具维度独立报出哪个 description 哪个要素不达标，禁止整体 pass/fail 掩盖局部问题。

---

### User Story 2 — Driver 主动调用 `impact` 工具率 ≥ 50%（优先级：P1，**Primary Outcome**）

作为产品负责人，我需要真实 LLM driver 在面对需要评估改动影响的任务时，能够「主动」（active call）调用 `impact` 工具，从而使工具链实际发挥作用，而不只是形式上存在。

**Why this priority**：F162-F169 实测显示 `impact` 主动调用率约 0%，这是 M7 最高优先级待解决问题。此 Story 是整个 F170c 的核心业务目标，验证 description 升级是否真正改变了 driver 行为。**本 Story 的 primary acceptance 不可以被 stop-loss 改写为 pass gate**：未达 primary 阈值的 secondary 阈值仅用于 limitation 记录，不构成 Feature 验收通过条件。

**Active Call 判定规则（必须满足全部）**：
- (a) 工具调用记录中 source 字段为 `tool_use`（driver LLM 自发发起），不是 `protocol_push` / `system_inject` / `harness_force`；
- (b) 任务 prompt 文本不含 `impact` / `mcp__plugin_spectra_spectra__impact` 这两个字面字符串（避免 prompt 显式指名诱导）；
- (c) 调用参数 `target` 字段满足**全部**以下条件（响应 codex C-3 二轮 review，强化幻觉过滤）：
  - (c1) 非空 symbol ID 字符串；
  - (c2) 能由当前 workspace symbol index 成功 resolve（即对应 src 中真实存在的 symbol，可通过 Spectra 自身的 symbol lookup 验证）；
  - (c3) 调用未因 invalid target 进入 handler error 路径（即调用得到 success path response，而非异常 response）；
- (d) 同一个 task run 内重复调用 `impact` 仅计 1 次（避免循环灌水）。

**Independent Test**：启动真实 driver（`claude --print` + Spectra MCP），构造 N=10 个需要 impact 评估的任务（5 task × 2 repeat），按上述 Active Call 判定规则统计合规 run 数量。

**Acceptance Scenarios**：

1. **Primary Pass Gate**：**Given** Spectra MCP 已加载升级后 description 的工具，**When** driver 收到一个「即将修改某函数，请评估影响范围」类任务（无显式指令要求调用 impact），**Then** ≥ 50% 的 run（即 N=10 次中 ≥ 5 次）满足 Active Call 全部 4 条判定规则。**未达此阈值视为 Feature 验收不通过**，必须返工 description 或重审 task fixture。

2. **Secondary Limitation Record**：**Given** primary 未达 50%（实际调用率在 25%-50% 区间），**When** 触发 stop-loss，**Then** 仍必须在 verification report 中记录为「limitation/降级」并附统计置信区间说明（N=10 + Wilson score interval），**不可作为 Feature 通过的等价 pass gate**。同时编排器必须在最终 deliverable report 中显式标注 `STATUS: DEGRADED — primary outcome not met`。

3. **Cost Stop-Loss**：**Given** 整个 E2E 测试集的 LLM API 实付超过 $10，**When** 系统检测到超额，**Then** 立即停止跑，记录"成本 stop-loss 触发"为 limitation，不强制继续 N=10。本场景视为 Feature 验收暂停（待预算扩展或减小 N 重测），不视为通过。

---

### User Story 3 — Response 新增 `topImpacted` 排名与 `nextStepHint`（优先级：P1）

作为 MCP driver，当我调用 `impact`、`detect_changes`、`context` 工具后，我希望 response 包含排序后的关键受影响节点（topImpacted）和下一步建议（nextStepHint），这样我能更高效地决定下一步调用哪个工具，而不是在 50+ 个平等结果中盲目选择。

**Why this priority**：Response format 升级是 Phase B 的核心，与 description 升级共同驱动 driver 行为改进。`topImpacted` 排名直接解决 impact 返回 50+ 等权重结果导致 driver 无法优先聚焦的问题；`nextStepHint` 将工具链提示内嵌到 response，强化工具组合使用的引导性。

**Independent Test**：直接调用内部 `handleImpact` 函数，传入模拟的大型 graph（n≥50 callers），断言 response 结构符合预期，无需 driver，完全单测级别。

**Producer/Consumer 合同（解决 spec/impl 二义性）**：

**Tool × Path 字段矩阵（响应 codex C-6 二轮 review）**——明确每个 tool 在每个 path 下应产出的新字段集合，**禁止跨 tool 污染**：

| Tool | success path 新增字段 | enrichment degraded fallback | handler error 新增字段 |
|------|---------------------|---------------------------|----------------------|
| `impact` | `topImpacted`（≤5）、`nextStepHint`（非空 ≥5 字符）、`_enrichmentDegraded` 缺失 | `topImpacted: []`、`nextStepHint: ""`、`_enrichmentDegraded: true` | 无（按升级前格式） |
| `detect_changes` | `riskTier`（enum）、`topImpacted`（≤5）、`nextStepHint`（非空 ≥5 字符）、`_enrichmentDegraded` 缺失 | `riskTier: "low"`、`topImpacted: []`、`nextStepHint: ""`、`_enrichmentDegraded: true` | 无（按升级前格式） |
| `context` | `topRelevantCallers`（≤3）、`nextStepHint`（非空 ≥5 字符）、`_enrichmentDegraded` 缺失 | `topRelevantCallers: []`、`nextStepHint: ""`、`_enrichmentDegraded: true` | 无（按升级前格式） |

**关键约束**：
- `riskTier` **只**属于 `detect_changes`，不可出现在 `impact` 或 `context` 的 response 中；
- `topImpacted` 属于 `impact` 和 `detect_changes`，**不**属于 `context`；
- `topRelevantCallers` **只**属于 `context`；
- `nextStepHint` 和 `_enrichmentDegraded` 属于全部 3 个 tool。

**Producer 合同（生产 response 的 MCP handler）**：在 success path，按上述矩阵 success path 列**MUST 总是产出**对应字段——不允许 producer 出于"字段是 optional"理由静默 omit。
**Schema 合同（Zod / JSON Schema）**：所有新字段标注为 optional，意味着 **consumer**（旧客户端、旧解析器）允许这些字段缺失，不报错。
**Enrichment Degraded 路径**（主流程成功 + ranking/hint/riskTier 计算抛异常被 try-catch 兜底）：producer 返回上述 degraded fallback 列对应的 fallback 值，并增加 `_enrichmentDegraded: true` 标志。
**Handler Error 路径**（主流程抛异常）：错误 response 结构与升级前完全一致，**不**新增任何 M7 字段（保持 FR-013 错误路径不变约束）。

**Acceptance Scenarios**：

1. **Success Path — Impact 主流程**：**Given** `handleImpact` 接收到一个有 50+ 受影响节点的 graph 数据且 BFS 正常完成，**When** 函数执行完毕，**Then** response 中 `topImpacted` 数组长度 ∈ [1, 5]，`topImpacted[0].score` 是所有 `topImpacted` 中的最高值（降序排列），`nextStepHint` 字段为非空字符串（长度 ≥ 5 字符），`_enrichmentDegraded` 字段缺失或为 false。

2. **Success Path — DetectChanges**：**Given** `handleDetectChanges` 主流程与 enrichment 全部成功，**When** 解析 response，**Then** response 中新增 `riskTier`（值为 "low" | "medium" | "high" 之一）、`topImpacted`（长度 ∈ [0, 5]）、`nextStepHint`（非空字符串）字段必须全部存在，且原有 `changedSymbols` 字段完整保留（按 FR-012 字段名/类型/嵌套层级不变）。

3. **Success Path — Context**：**Given** `handleContext` 主流程与 enrichment 全部成功，**When** 解析 response，**Then** response 中新增 `topRelevantCallers`（长度 ∈ [0, 3]）和 `nextStepHint`（非空字符串）字段必须存在，且原有 `callers`、`callees`、`imports` 字段完整保留。

4. **Edge — 受影响节点 0/1**：**Given** impact 的受影响节点数量为 0 或 1，**When** 调用 `handleImpact`，**Then** `topImpacted` 返回实际节点（长度 ∈ [0, 1]）；`nextStepHint` 仍返回有意义的引导文本（如「受影响范围为空，建议检查 symbol ID 是否正确」/「仅 1 个直接调用方，建议直接调 context 查看上下文」），不返回空字符串、不返回 null。

5. **Enrichment Degraded — Impact**：**Given** `handleImpact` 主流程 BFS 完成但 ranking 计算抛异常（被 try-catch 兜底），**When** 解析 response，**Then** `topImpacted` 为空数组、`nextStepHint` 为空字符串、新增 `_enrichmentDegraded: true` 标志，且主流程的 `affected` / `summary` 字段完整。**注意**：按 Tool × Path 字段矩阵，`handleImpact` 不产出 `riskTier` 字段（响应 codex C-6 修订）。

6. **Enrichment Degraded — DetectChanges**：**Given** `handleDetectChanges` 主流程成功但 enrichment 计算抛异常，**When** 解析 response，**Then** `riskTier` 为 "low" fallback、`topImpacted` 为空数组、`nextStepHint` 为空字符串、新增 `_enrichmentDegraded: true` 标志，且主流程的 `changedSymbols` / `summary` 字段完整。

7. **Enrichment Degraded — Context**：**Given** `handleContext` 主流程成功但 enrichment 计算抛异常，**When** 解析 response，**Then** `topRelevantCallers` 为空数组、`nextStepHint` 为空字符串、新增 `_enrichmentDegraded: true` 标志，且主流程的 `definition` / `callers` / `callees` / `imports` 字段完整。

8. **Handler Error — Impact**：**Given** `handleImpact` 主流程抛异常（如 target symbol 不存在），**When** error 处理器返回 response，**Then** 错误 response 结构与升级前完全一致，不包含 `topImpacted` / `nextStepHint` / `_enrichmentDegraded` 等任何 M7 新字段。同理 `handleDetectChanges` 不含 `riskTier`、`handleContext` 不含 `topRelevantCallers`。

---

### User Story 4 — Driver 自然完成 detect_changes → impact/context 工具链（优先级：P2，**Secondary Outcome**）

作为产品负责人，我希望 driver 在面对真实 SWE-Bench-Lite 类任务时，能自然地完成 `detect_changes → impact` 或 `detect_changes → context` 的**有序**多步工具调用链，而不是只调用单个工具，从而证明 description 的 chained usage 引导起到了实际作用。

**Why this priority**：这是对 User Story 1-3 组合效果的端到端验证，复用 F167 cohort C setup。本 Story 与 US2 互补但样本量较小，不作为 primary pass gate；不达 chain 阈值时记为 limitation，不阻塞 Feature 验收。

**Chained Call 合规判定（必须满足全部）**：
- (a) **顺序约束**：在同一 task run 的 stream-json call sequence 中，存在一对 `(t_a, t_b)`，使得 `t_a` 是 `detect_changes` 的 tool_use event 时间戳，`t_b` 是 `impact` 或 `context` 的 tool_use event 时间戳，且 `t_a < t_b`；
- (b) **不同工具**：调用的工具名严格不同（同名工具的两次调用不算 chain）；
- (c) **同源 task**：t_a 和 t_b 必须属于同一个 task 的 sub-conversation，不跨越多个独立 task 拼接；
- (d) **active call**（响应 codex W-4 二轮 review，独立 prompt exclusion 覆盖三个工具名）：
  - (d1) 两次调用 source 字段均为 `tool_use`，不是 `protocol_push` / `system_inject` / `harness_force`；
  - (d2) 任务 prompt 文本**完全不**含以下三组字面字符串（任一出现即视为 prompt 显式诱导，整个 chain 不计合规）：
    - `detect_changes` 或 `mcp__plugin_spectra_spectra__detect_changes`；
    - `impact` 或 `mcp__plugin_spectra_spectra__impact`；
    - `context` 或 `mcp__plugin_spectra_spectra__context`。

**Independent Test**：跑 1 个真实 SWE-Bench-Lite cohort C run（复用 F167 setup，**N=3 task 而不是 N=1**，以避免单次 LLM 随机性导致假阳/假阴），解析 stream-json MCP call sequence，按上述合规规则统计 chain。

**Acceptance Scenarios**：

1. **Secondary Pass Signal**：**Given** 真实 SWE-Bench-Lite cohort C run 完成（N=3 task），**When** 按 Chained Call 合规规则解析 stream-json，**Then** 至少 1/3 task 出现 ≥ 1 个合规 chain（即 chain rate ≥ 33%，相当于用户 prompt 中提到的 ≥ 30% 阈值）。未达此阈值仅记 limitation，不阻塞 Feature 验收。

2. **Backward Compatibility — Fixture 重跑**：**Given** F162-F169 的既有 cohort C eval fixture，**When** 使用升级后的工具版本重跑 1 个 fixture（N=3 repeat），**Then** 原有 eval fixture 格式的解析仍正常工作，无格式兼容性错误（旧 response 字段全部存在且按原结构可解析）；新增字段为 optional 不影响 lenient parser；如 fixture 使用 Zod `.strict()` 或 `additionalProperties: false`，应同步识别为兼容性破坏并独立报错（参见 FR-014 扩展约束）。

---

### Edge Cases

**向后兼容场景（覆盖 FR-011/012/013/014）**

- 旧版客户端（F162-F169 时期）使用 lenient parser 解析 `impact` response 时忽略未知字段——必须确认 JSON schema **不**使用 `additionalProperties: false`、Zod schema **不**使用 `.strict()` 模式。
- 旧版客户端使用 strict parser（含 `additionalProperties: false` 或 Zod `.strict()`）解析升级后 response 时**会**报错——这是预期行为，不视为兼容性违规；但 SC-005(d) 必须独立断言此场景在 lenient mode 下不报错（避免误把"应该报错的场景"误判为"违规"）。
- `detect_changes` 的原有 `changedSymbols` 字段必须保持原有数据结构，即使新增 `riskTier` 字段与其语义相关，也不允许将 `riskTier` 内嵌至 `changedSymbols[i]` 中。
- 所有 tool 的 input schema 不变；既有 Zod schema 已存在字段的 `.optional()` / `.nullable()` 标注不允许变更（FR-014 末段约束）。

**大 graph 性能场景**

- 当 impact BFS 遍历结果超过 100 个节点时，`topImpacted` 的排名计算不得引入超过 100ms 额外延迟（相对于不做排名的基准执行时间）；基准测量协议（warmup × 3 + measurement × 10 + report median）见 SC-007。
- 当受影响节点为 0 时，`topImpacted` 应返回空数组（非 null），`nextStepHint` 应返回有意义的引导文本（如「受影响范围为空，建议检查 symbol ID 是否正确」）；当节点数为 1 时，`nextStepHint` 应建议「仅 1 个直接调用方，建议直接调 context 查看上下文」（参见 US3 scenario 4）。

**LLM driver 行为方差场景**

- User Story 2 中 N=10 的样本量较小，LLM 随机性可能导致单次测试结果不稳定——但 spec 明确规定 SC-002 50% 是 **primary pass gate**；落入 25%-50% 区间的 secondary 阈值**仅作为 limitation 记录**，不构成等价 pass gate（参见 US2 修订）。
- driver 可能调用 `impact` 但 source 字段为 `protocol_push` 而非 `tool_use`——按 US2 Active Call 判定规则 (a)，此类调用**不**计入合规调用数。
- driver 可能因 task prompt 歧义调用 impact 但传入无效 target 参数（如空字符串）——按 US2 Active Call 判定规则 (c)，此类调用**不**计入合规调用数。
- 同一个 task run 内 driver 重复调用 `impact`（如循环），按 US2 Active Call 判定规则 (d) 仅计 1 次。

**Response 三路径场景（覆盖 FR-013 + producer/consumer 合同）**

- **success 路径**：所有 M7 新字段必须存在（FR-006/007/008/009 producer 合同）。
- **enrichment degraded 路径**：主流程成功 + ranking/hint 计算抛异常被 try-catch 兜底——新字段保留但取 fallback 值，并附 `_enrichmentDegraded: true`（参见 US3 scenario 5）。
- **handler error 路径**：主流程抛异常——错误 response 完全不含 M7 新字段，与升级前格式逐字段一致（参见 US3 scenario 6 + SC-005(c)）。

**description 升级完整性场景**

- 按 FR-004 修订，`graph-tools.ts` 中的**任何**工具**完全不在 F170c 升级范围**内（不允许任何例外）。SC-001 仅断言 3 个 agent-context tool（`detect_changes` / `context` / `impact`），不涵盖 graph-tools。
- 若 SC-001 测试中任一 description 4 要素任一项不达标，测试**必须独立报出哪个 tool 的哪个要素不达标**，不允许整体 pass/fail 掩盖局部问题。

---

## Requirements

### Functional Requirements

**Phase A：Tool Description 升级**

- **FR-001**：`detect_changes` 工具的 description MUST 升级为 100-500 字，包含核心功能一句话描述、"Use this tool when"（≥3 场景）、"Example"（含 input 和关键 output）、"Typical chained usage" 四个要素。`[必须]`

- **FR-002**：`context` 工具的 description MUST 升级为 100-500 字，包含与 FR-001 相同的 4 要素结构。`[必须]`

- **FR-003**：`impact` 工具的 description MUST 升级为 100-500 字，包含与 FR-001 相同的 4 要素结构，其 chained usage 示例 MUST 包含 `detect_changes → impact → context` 这条标准链路。`[必须]`

- **FR-004**：本 Feature 升级 description 的 graph-tools 工具清单**严格为 0 个**——即 Phase A description 升级范围**仅限**于 agent-context-tools 中的 3 个工具（`detect_changes` / `context` / `impact`）。`graph-tools.ts` 中**任何**工具（包括但不限于 `graph_query` / `graph_node` / `graph_path` / `graph_path_bfs` 等）的 description 与 response **完全不在 F170c 范围内**，不允许通过任何"例外"路径在本 Feature 中修订。如未来发现需要升级 graph-tools，必须作为**独立的新 Feature 提案**单独立项，**不**通过 F170c 的 spec amendment 或隐式扩展纳入。`[必须]`（响应 codex C-2 二/三轮 review：彻底移除任何"包装层例外"残留，确保 spec 边界硬收敛）

- **FR-005**：所有升级后的 description MUST 使用技术人员可理解的自然语言，不允许出现 JSON schema 格式或代码块作为 description 主体内容（示例字段内可出现 JSON 片段，但 description 整体必须是可读文本）。`[必须]`

**Phase B：Response Format 扩展**

- **FR-006**：`impact` 工具 success path response MUST 总是产出 `topImpacted` 字段（producer 侧硬约束；类型：数组，长度 ∈ [0, 5]，按 score 降序排列，每项含 id 和 score）。schema 侧（Zod / JSON Schema）声明为 optional，以兼容旧 consumer 解析。`[必须]`

- **FR-007**：`impact` 工具 success path response MUST 总是产出 `nextStepHint` 字段（非空字符串，长度 ≥ 5 字符）；schema optional。enrichment degraded 路径下允许为空字符串 `""` 但字段不可缺失。`[必须]`

- **FR-008**：`detect_changes` 工具 success path response MUST 总是产出 `riskTier`（枚举："low" | "medium" | "high"；enrichment 失败 fallback 为 "low"）、`topImpacted`（与 FR-006 同合同）、`nextStepHint`（与 FR-007 同合同）三个字段；schema optional。`[必须]`

- **FR-009**：`context` 工具 success path response MUST 总是产出 `topRelevantCallers`（数组，长度 ∈ [0, 3]，按 plan 阶段定义的综合排序公式排序——US3 W-3 推迟到 plan）和 `nextStepHint` 字段；schema optional。`[必须]`

- **FR-010**：`nextStepHint` 的文本内容 SHOULD 使用中文（与项目 language convention 一致），无需支持 i18n 多语言切换。`[必须]` [AUTO-RESOLVED: 按项目 CLAUDE.md 默认中文文档约定推断，不引入 i18n 复杂度]

**向后兼容硬约束**

- **FR-011**：所有工具的 input schema MUST 保持不变，不允许新增、删除或修改任何 input 参数的类型、名称或是否必填属性。`[必须]`

- **FR-012**：所有工具 response 的原有字段 MUST 完整保留，包括字段名称、类型、结构，不允许重命名或改变嵌套层级。`[必须]`

- **FR-013**：所有工具的错误处理路径 MUST 完全保持升级前结构。具体语义分三层：
  - **handler error 路径**（主流程抛异常）：错误 response 完全不包含 `topImpacted` / `nextStepHint` / `riskTier` / `topRelevantCallers` / `_enrichmentDegraded` 等任何 M7 新字段，按升级前格式返回；
  - **enrichment degraded 路径**（主流程成功 + enrichment 计算抛异常被兜底）：新字段保留但取 fallback 值（`topImpacted: []` / `nextStepHint: ""` / `riskTier: "low"` / `topRelevantCallers: []`），同时增加 `_enrichmentDegraded: true` 标志；
  - **success 路径**：按 FR-006/007/008/009 producer 合同总是产出新字段。`[必须]`

- **FR-014**：新增字段的 schema 约束 MUST 覆盖以下全部兼容性面：
  - Zod schema **不**使用 `.strict()` 模式（避免 unknown key 报错）；
  - 导出的 JSON schema **不**使用 `additionalProperties: false`；
  - response Zod 类型导出的 TypeScript 类型必须保持新字段为 optional（`field?: T` 而非 `field: T | undefined`），以兼容旧 type consumer；
  - 既有 Zod schema 任何已存在的字段 `.optional()` / `.nullable()` 标注不允许变更。`[必须]`

**共享工具模块**

- **FR-015**：`buildTopImpactedRanking` 和 `generateNextStepHint` 逻辑 SHOULD 提取为共享工具函数，供 3 个 agent-context tool handler 复用，避免重复实现。`[必须]`（需要跨 3 个 handler 复用才有实用价值）

- **FR-016**：当受影响节点总数超过 100 时，排名计算的额外延迟 MUST 不超过 100ms（相对基准执行时间）。`[必须]`

- **FR-017**：`graph-tools` 中的其他工具（如 `graph_query` / `graph_node` / `graph_path` 等）description 升级**不在 F170c 范围内**（与 FR-004 修订口径一致）。如未来需要升级，应作为独立 Feature 提案，**不**通过 F170c 的隐式扩展或排期延迟方式纳入。`[YAGNI-移除]`（响应 codex C-2 三轮 review：移除"MAY 视排期决定"残留含糊语义）

### Key Entities

- **TopImpacted**：表示受影响节点的排名条目，关键属性为 `id`（symbol 标识符）和 `score`（影响程度评分）。数组按 `score` 降序排列，最多取前 5 项。**评分公式与同分 tiebreaker 规则推迟到 plan 阶段定义**（响应 codex W-2）。

- **TopRelevantCaller**：表示 context 工具返回的关键调用方条目，按"调用频率 + 距离"综合排序，最多取前 3 项。**综合排序公式（频率权重、距离权重、tiebreaker）推迟到 plan 阶段定义**（响应 codex W-3）。

- **nextStepHint**：单个中文字符串（FR-010），内嵌到 response 中，引导 driver 下一步调用哪个工具及传入什么参数。success 路径下长度 ≥ 5 字符；enrichment degraded 路径下允许为空字符串 `""` 但字段不可缺失（FR-013）。**参考文本模板**（如 impact 的「建议接下来调 context for {top.id}」、context 的「若改 callee，建议调 impact for {definition.id}」）推迟到 plan 阶段定义（响应 codex I-2 / Producer/Consumer 合同）。

- **riskTier**：枚举值（"low" | "medium" | "high"），附加在 `detect_changes` response 中，表示本次检测到的改动风险等级。**enrichment 失败 fallback 为 "low"**（FR-008 + 响应 codex W-1）。等级评估公式（基于 changedSymbols 数量、callers 数量等）推迟到 plan 阶段定义。

- **_enrichmentDegraded**（response 顶层 optional flag）：当主流程成功但 enrichment 计算（ranking / hint / riskTier）抛异常被兜底时，此字段为 `true`，否则缺失。用于 producer 显式信号"主流程数据可信，新增字段为 fallback 值"，避免与 handler error 混淆（FR-013）。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**：3 个 agent-context tool（`detect_changes`、`context`、`impact`）的 description 均通过静态结构解析测试。每个 description 必须满足以下**5 项硬约束**（与 US1 验收 1 的 (a)-(e) 完全一致，响应 codex C-1 三轮 review）：(a) 长度位于 100-500 字符区间，(b) 第一行或首段为"核心功能一句话描述"的 lead-in 文本（长度 ≥ 10 字符，缺失或过短即视为整个 description 不达标），(c) 含 "Use this tool when" 段且至少枚举 3 个 use-case 场景，(d) 含 "Example" 段且含 input/output 示例，(e) 含 "Typical chained usage" 段且至少 1 个 chained 示例（`impact` 必含 `detect_changes → impact → context`）。**任一 description 任一项不达标即 SC-001 不通过**。（对应 User Story 1 / FR-001/002/003/005）

- **SC-002 (Primary)**：E2E 真实 driver 测试（N=10 runs，5 task × 2 repeat）中，按 US2 Active Call 4 条判定规则统计，合规 run 数量 ≥ 5/10（50%）。**未达此阈值视为 Feature 验收不通过**。降级到 secondary 阈值 ≥ 25% 仅记 limitation，不构成等价 pass gate。同时报告须附 Wilson score 95% 置信区间。（对应 User Story 2，baseline: F167 ~0%）

- **SC-003**：`handleImpact` / `handleDetectChanges` / `handleContext` 单测分别覆盖**3 个路径**（success / enrichment degraded / handler error），每路径断言对应的 producer 合同（FR-006/007/008/009 + FR-013）：
  - success 路径：新字段全部存在且符合范围约束（topImpacted 长度 ≤ 5、降序、首项最高；nextStepHint 非空长度 ≥ 5；riskTier ∈ enum）；
  - enrichment degraded 路径：新字段存在但取 fallback 值，附 `_enrichmentDegraded: true`；
  - handler error 路径：错误 response 不含任何 M7 新字段。（对应 User Story 3 + FR-013）

- **SC-004 (Secondary)**：真实 SWE-Bench-Lite cohort C run（**N=3 task**，避免 N=1 假阳/假阴）中，按 US4 Chained Call 合规规则解析，chain rate ≥ 33%（即 ≥ 1/3 task 出现 ≥ 1 个合规 chain）。**未达此阈值仅记 limitation**，不阻塞 Feature 验收。（对应 User Story 4）

- **SC-005 (向后兼容 — 多维快照验收)**：
  - **(a) Input schema snapshot**：使用 Zod schema 序列化为 JSON snapshot，对比升级前快照逐字段一致（字段名/类型/required/nullable 完全相同）；
  - **(b) Success response 旧字段 snapshot**：对每个 tool 的 success response 抽取所有旧字段（不含 M7 新字段），与升级前 snapshot 逐字段比较；
  - **(c) Error response snapshot**：对每个 tool 的 handler error response 整体 snapshot 与升级前完全一致；
  - **(d) Strict parser regression fixture**：构造一份模拟「旧客户端使用 `additionalProperties: false` 或 Zod `.strict()`」的 fixture，断言新 response 在 lenient mode（去掉 strict 后）解析通过；
  - **(e) F162-F169 cohort C eval fixture**：使用升级后的工具版本重跑 1 个 fixture（N=3 repeat），无格式兼容性错误；
  - **(f) Response schema metadata 断言**（响应 codex C-5 二轮 review，覆盖 FR-014 4 项约束）：
    - (f1) 导出的每个 response Zod schema 必须**不**含 `.strict()` 调用（grep / AST 断言）；
    - (f2) 导出的每个 response JSON Schema 必须**不**含 `"additionalProperties": false`（JSON 比较断言）；
    - (f3) 新增字段对应的 TypeScript 类型为 `field?: T` 而非 `field: T | undefined`（编译时类型断言 + tsc 类型快照）；
    - (f4) 既有 response Zod schema 字段的 `.optional()` / `.nullable()` 标注必须与升级前 snapshot 完全一致（schema metadata diff 断言）。
  （向后兼容验收，对应 FR-011/012/013/014）

- **SC-006**：现有全量 vitest 测试（3729 条）在升级后继续 100% pass，`npm run build` 零类型错误，`npm run repo:check` 和 `npm run release:check` 零回归。（零回归验收）

- **SC-007**：大 graph 性能测试（n≥100 节点）中，`topImpacted` 排名计算的额外延迟 ≤ 100ms（相对无排名基准）。基准测量协议（warmup × 3 + measurement × 10 + report median）由 plan 阶段定义。（对应 FR-016）

---

## 复杂度评估（供 GATE_DESIGN 审查）

### 组件总数
新增或修改的组件/模块（FR-004 修订后 graph-tools 完全不在范围）：
- `src/mcp/agent-context-tools.ts`（修改）：3 个 tool 的 description 升级 + 3 个 handler 的 success/degraded/error 三路径 response 扩展
- `src/mcp/graph-tools.ts`：**本 Feature 不修改**（FR-004 修订后已硬收敛；如未来需修改须作为独立新 Feature 提案，不通过 F170c 任何 amendment 路径）
- `src/mcp/lib/response-helpers.ts`（新增）：`buildTopImpactedRanking` / `generateNextStepHint` / `assessRiskTier` / `buildTopRelevantCallers` 共享纯函数
- `tests/e2e/feature-170c-*.e2e.test.ts`（新增）：E2E 测试文件（覆盖 SC-001/002/004）
- `tests/unit/mcp/agent-context-tools-handlers.test.ts`（新增或扩展）：handler 三路径单测（覆盖 SC-003）
- `tests/unit/mcp/lib/response-helpers.test.ts`（新增）：helper 纯函数单测（覆盖 SC-007 性能基准 + ranking 正确性 + tiebreaker 由 plan 定义后断言）

**组件总数：5**（1 必改 + 1 新增 + 3 新增测试文件，graph-tools 不计）

### 接口数量
新增或修改的接口/类型契约：
- `ImpactResponse`：新增 `topImpacted`、`nextStepHint`、`_enrichmentDegraded` 三个 optional 字段
- `DetectChangesResponse`：新增 `riskTier`、`topImpacted`、`nextStepHint`、`_enrichmentDegraded` 四个 optional 字段
- `ContextResponse`：新增 `topRelevantCallers`、`nextStepHint`、`_enrichmentDegraded` 三个 optional 字段
- `TopImpacted`（新增类型）
- `TopRelevantCaller`（新增类型）
- helper 函数签名：`buildTopImpactedRanking` / `generateNextStepHint` / `assessRiskTier` / `buildTopRelevantCallers`（4 个新公开 API）

**接口数量：5（类型） + 4（helper 函数） = 9**（响应 codex W-8）

### 依赖新引入数
无新增外部 npm 依赖。排名计算和提示生成逻辑使用标准 JS/TS 数组操作实现。

**依赖新引入数：0**

### 跨模块耦合
修改了 `agent-context-tools.ts` 现有模块的 response 接口（新增 optional 字段），新增 `response-helpers.ts` 模块被 3 个 handler 引用。`graph-tools.ts` **不**修改（FR-004 修订后已收敛）。

**跨模块耦合：LOW-MEDIUM（1 个现有模块新增 optional 字段 + 1 个新增 helper 模块被复用，无外部条件依赖）**

### 复杂度信号
- 递归结构：否
- 状态机：否（producer 三路径状态由 try-catch 实现，非显式 state machine）
- 并发控制：否
- 数据迁移：否
- LLM 行为方差（SC-002 / SC-004 统计性质）：**是**（影响 stop-loss 设计、显著性测试、置信区间报告）
- 多维兼容性快照（SC-005 6 维快照）：**是**（实现简单但测试设计与维护复杂度较高）

**复杂度信号数：2**（均为测试/验收层面，非实现层面）

### 总体复杂度：**MEDIUM**

> 判定依据修订（响应 codex W-8 二轮 review，统一数字口径）：
> - 实现层面：组件数 **5**（1 必改 src 模块 + 1 新增 helper + 3 测试文件）、接口数 **9**（5 类型 + 4 helper 函数）、无新依赖、跨模块耦合 LOW-MEDIUM——**实现复杂度 LOW**；
> - 测试层面：3 个 SC（SC-002 / SC-004 / SC-005）涉及**真实 LLM driver run + SWE-Bench-Lite fixture + 6 维 snapshot 兼容性验收**，测试构造与执行复杂度均显著高于 unit test 维度——**测试复杂度 MEDIUM-HIGH**；
> - LLM 行为方差和 stop-loss / primary-vs-secondary 区分引入 spec 解读复杂度——**2 个测试/验收层面信号**；
> - 综合判定为 **MEDIUM**。
>
> **GATE_DESIGN 建议**：保留 auto 模式，但**编排器必须在 PAUSE 决策中包含 SC-002 / SC-005 兼容性快照设计的人工 review**，以避免实现层"小改"误导验收设计"也小"的认知错配。
