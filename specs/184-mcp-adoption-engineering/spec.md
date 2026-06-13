# Feature Specification: F184 — 子代理 MCP 触发率工程（MCP Adoption Engineering）

**Feature Branch**: `184-mcp-adoption-engineering`
**Created**: 2026-06-13
**Status**: Draft
**[无调研基础：方案源自 M7 架构审查 wf_a084e2f1]**

---

## 背景与问题陈述

F176 实测（PUBLISH-REPORT-M7 §4.4/§4.6）揭示了一个关键发现：30 次 run 中有 16 次子代理零 MCP 调用，触发率 1.77/run，未达 SC-002 ≥2 的基线目标。然而数据同时显示，**工具本身质量合格**——使用了 MCP 工具的 run 通过率为 43%，显著高于未使用的 12%；最难任务 V004 上 5 次 MCP 调用产出了全场最强修复结果。

结论：这是 **adoption（采用率）问题而非工具质量问题**。当前编排器可见 17 个工具，但子代理缺乏使用动机和导航线索，导致大量 run 放弃了性能最强的工具路径。

本 feature 从 4 个工程抓手系统性提升子代理 MCP 工具采用率。

---

## 用户故事与测试场景

### 用户故事 1 — view_file fuzzy symbol 解析（Priority: P1）

用户故事：作为使用 Spectra MCP 的子代理，当我通过 `context` 工具获得一个 symbolId 后，用该 symbolId 调用 `view_file` 时，即便 symbolId 存在轻微格式偏差（如大小写、分隔符差异），系统也应自动 fuzzy 解析并返回正确代码片段，而不是硬失败报 symbol-not-found。

**优先级理由**：当前 `context → view_file` 工具链自断——`context` 能 resolve 的 symbolId 传给 `view_file` 却失败，导致子代理放弃后续工具调用。这是直接损害采用率的功能缺陷，修复后可立即恢复宣传的典型工具链路，且不涉及任何跨模块 scope 冲突。

**独立测试**：通过 stdio E2E 测试，向 `view_file` 传入一个已知存在但格式略有偏差的 symbolId（如大小写不一致），验证返回成功响应并携带 `warnings: ['fuzzy-resolved']`。

**验收场景**：

1. **Given** graph 已构建，存在 symbolId `src/mcp/server.ts::createMcpServer`，**When** 调用 `view_file` 传入 symbolId `src/mcp/server.ts::CreateMcpServer`（首字母大写偏差），**Then** 系统 fuzzy resolve 成功，返回对应代码片段，响应含 `warnings: ['fuzzy-resolved']`，HTTP 状态成功
2. **Given** graph 已构建，存在高置信候选（confidence ≥ 0.9），**When** `view_file` fuzzy 解析命中唯一高分候选，**Then** 自动采用该候选，不中断调用链
3. **Given** graph 已构建，fuzzy 解析返回多个候选但无高置信唯一命中（均 < 0.9），**When** 调用 `view_file` 传入模糊 symbolId，**Then** 返回错误响应，错误体 `context.fuzzyMatches` 携带 top-3 候选列表（与 F174 agent-context 约定一致），子代理可据此重试
4. **Given** graph 未构建，**When** 调用 `view_file` 传入 symbolId，**Then** 返回 `graph-not-built` 错误（现有行为不变）

---

### 用户故事 2 — MCP server instructions 注入（Priority: P1）

用户故事：作为使用 Spectra MCP 工具集的子代理，当 MCP server 连接建立时，我能在 server 级别获取一段结构化的工具使用导览，说明 17 个工具的分组与典型调用链路，使我在无明确指令时也有工具使用动机。

**优先级理由**：这是最直接影响子代理是否"开口使用"MCP 工具的入口。instructions 在 server 级别注入，理论上子代理建立连接后即可感知，是零成本提升动机的首选方案。A/B 验证 instructions 是否真实传播到 Task 子代理是本 feature 的核心待答问题。

**独立测试**：通过 SDK 调用 `createMcpServer()`，验证返回的 server 实例在 `getServerInfo()` 或等价接口中携带 `instructions` 字段，内容包含工具分组导览和典型链路描述。

**验收场景**：

1. **Given** MCP server 实例化，**When** 检查 server 配置，**Then** `McpServer` 第二个 `ServerOptions` 构造参数包含非空 `instructions` 字段（SDK 签名见 FR-002 实施位置注记），内容涵盖：17 工具分组概述、典型调用链路（`detect_changes → impact → context → view_file`）、graph-not-built 恢复流
2. **Given** 子代理通过 MCP 协议连接 server，**When** 协议握手完成，**Then** A/B 评测对比组可量化验证 instructions 存在与否对子代理工具调用频次的影响（有结论，正负均可）

---

### 用户故事 3 — server 5 工具 description 补齐（Priority: P1）

用户故事：作为子代理，当我查看 `prepare`、`generate`、`batch`、`diff`、`panoramic-query` 这 5 个 server 工具的 description 时，能看到 4 要素完整说明（what 是什么 / when 何时用 / example 调用示例 / chained-usage 链路位置），从而判断是否在当前场景使用。

**优先级理由**：当前 server 5 工具的 description 只有 2-6 字标签（如 `'AST 预处理 + 上下文组装'`），远低于 file-nav 3 工具已达到的 4 要素标准。description 是子代理决策"是否调用"的主要依据，残缺 description 直接导致工具被忽略。

**独立测试**：读取工具注册代码，验证 server 5 工具的 description 字符串包含 what / when / example / chained-usage 4 个语义要素，并对照 file-nav-tools.ts 中已有范本进行结构比对。

**验收场景**：

1. **Given** MCP server 工具列表，**When** 检查 `prepare` 工具 description，**Then** description 包含：功能说明（what）、使用时机（when）、调用示例（example）、在链路中的位置（chained-usage）
2. **Given** MCP server 工具列表，**When** 对 `generate`、`batch`、`diff`、`panoramic-query` 做同等检查，**Then** 每个工具 description 均满足 4 要素
3. **Given** 现有 F180 44 个 stdio E2E 测试，**When** 改动 description 后运行测试套件，**Then** 全部通过，listTools 17 工具断言零回归

---

### 用户故事 4 — graph 6 工具 description 补 "Use when / chained usage"（Priority: P2）

用户故事：作为子代理，当我查看 `graph_query`、`graph_node`、`graph_path`、`graph_community`、`graph_god_nodes`、`graph_hyperedges` 这 6 个图谱工具的 description 时，能看到"何时使用"和"在链路中的位置"两项说明，便于判断图谱工具在当前任务中的适用性。

**优先级理由**：graph 工具是当前 MCP 工具集中使用率最低的一档，原因之一是 description 缺乏使用场景引导。相比 server 5 工具（P1），graph 工具偏探索性，不是每个任务都需要，故降为 P2。

**独立测试**：验证 graph 6 工具的 description 均包含 "Use when" 和 "chained usage" 两项语义要素。

**验收场景**：

1. **Given** MCP server 工具列表，**When** 检查 graph 6 工具 description，**Then** 每个工具 description 包含：使用时机（Use when）、在哪个工具调用链路中出现（chained-usage）
2. **Given** 现有测试套件，**When** 运行 vitest，**Then** 4250+ 测试零回归

---

### 用户故事 5 — A/B 评测量化改造前后触发率提升（Priority: P2）

用户故事：作为维护者，我要量化改造前后子代理 MCP 工具触发率的提升，以确认本 feature 工程改造的实际效果，并明确 instructions 是否真实传播到 Task 子代理。

**优先级理由**：改造有成本，A/B 量化验证是对 M7 问题修复的交代。但 A/B 本身不阻塞代码改动的交付，故为 P2。

**独立测试**：沿用 F176 telemetry 基线设施，最小规模 2 cohort（改造前/后） × 3-5 个任务 × N=3，出方向性信号。

**验收场景**：

1. **Given** F176 基线（1.77/run，16/30 零调用），**When** 完成 4 个抓手改造后跑 A/B 评测，**Then** 实验组触发率较基线呈方向性提升信号，零调用 run 占比下降（统计显著性判定留待 F188 确证性复测，见 SC-004 诚实性声明）
2. **Given** A/B 评测完成，**When** 分析 instructions cohort 的工具调用日志，**Then** 对"instructions 是否传播到 Task 子代理"给出明确结论（正负均可，但必须有结论）
3. **Given** 用户确认跑批，**When** 执行跑批前，**Then** 已 verify 三件套（`SILICONFLOW_API_KEY` / Claude OAuth / `~/.codex/auth.json`），列出预估成本，等待用户确认后方可执行

---

## Edge Cases

### EC-001：view_file fuzzy — graph-not-built 降级
- **场景**：graph 未构建时调用 `view_file` 传入 symbolId
- **当前行为**：`getCachedGraphData` 返回 null，返回 `graph-not-built` 错误
- **改造后行为**：同现有——fuzzy 路径不绕开 graph-not-built 检查；返回 `graph-not-built` 错误，提示"请先运行 `spectra batch` 生成图谱"
- **关联 FR**：FR-003

### EC-002：view_file fuzzy — 多候选无高置信命中
- **场景**：fuzzy 解析返回多个候选，但无 confidence ≥ 0.9 的唯一命中
- **行为**：不自动采用任何候选，返回错误响应，错误体 `context.fuzzyMatches` 携带 top-3 候选（含 id 和 confidence），引导子代理重试
- **关联 FR**：FR-004

### EC-003：view_file fuzzy — 空/无效 symbolId
- **场景**：传入空字符串或仅含空白字符的 symbolId
- **行为**：`resolveSymbolFuzzy` 对空/空白 query 返回空候选不抛异常；`resolveSymbolRange` 继续走 `canonicalizeSymbolId` 现有路径，返回 `invalid-symbol-id` 错误
- **关联 FR**：FR-003

### EC-004：向后兼容 — 成功与错误 envelope 均不破坏
- **场景**：改造后 `view_file` 成功响应可能新增 `warnings`，错误响应可能在 `context` 中新增 `fuzzyMatches`
- **约束**：成功响应的 `warnings` 仅在有内容时写入（view_file 现有 `symbolId-overrides-lines` warning 已是此行为）；错误响应不新增顶层字段，`fuzzyMatches` 只放 `context` 扩展点——两个 envelope 对不感知新字段的客户端均无感
- **关联 FR**：FR-001, FR-003, FR-004

### EC-005：instructions 传播未知性
- **场景**：`McpServer` 的 `instructions` 字段是否传播到 Task 子代理，SDK 层面当前未经验证
- **行为**：这是 A/B 评测的核心待答问题；无论结论正负，A/B 必须有明确结论。若 instructions 未传播，需记录并评估替代方案（如工具 description 补充成为更重要的兜底）
- **关联 FR**：FR-010, SC-003

### EC-006：graph_node fuzzy — F193 scope 冲突（条件项）
- **场景**：graph_node 工具当前使用 naive keyword substring 匹配，`getNode` 逻辑位于 `src/panoramic/graph/graph-query.ts`，而 F193 正在修改该文件
- **行为**：graph_node fuzzy 为条件项，不纳入当前迭代强制交付范围；plan 阶段选定路径 A 或 B：
  - **(A) MCP handler 层 fuzzy 预解析**：在 `src/mcp/graph-tools.ts` 的 handler 调用 `engine.getNode` 前，先用 `resolveSymbolFuzzy` 把模糊 keyword/id 解析成精确 id，**不碰 graph-query.ts**
  - **(B) 延后到 F193 ship 后单独处理**
- **关键约束**：view_file fuzzy（FR-003，无 scope 冲突）**不得**因 graph_node fuzzy 的 scope 风险被拖延或合并；二者在 plan/tasks 阶段必须明确分列
- **关联 FR**：FR-008

### EC-007：description 改动的 listTools 断言
- **场景**：F180 44 个 stdio E2E 测试中含 listTools 17 工具断言
- **约束**：工具 **名称不得改变**（改名会牵动 agents frontmatter 白名单跨仓同步，M8 已排除）；description 改动不影响工具名称断言，但需验证 description 字段变更不破坏现有断言

### EC-008：resolveSymbolFuzzy autoResolveThreshold 一致性
- **场景**：view_file fuzzy 使用的阈值应与 Feature 174 已建立的 `autoResolve` 语义一致
- **约束**：使用 `resolveSymbolFuzzy` 默认 `autoResolveThreshold: 0.9`，不引入新阈值常量，保持 fuzzy 行为在整个工具集中的一致性

---

## 功能需求

### FR-001 — 响应 schema 向后兼容（成功 + 错误 envelope） [必须] [MUST]
系统 MUST 确保改造后所有工具的响应 schema 保持向后兼容，约束按 envelope 分别陈述：
- **成功响应**：只允许新增字段（如 `warnings`），不修改或删除既有字段；`warnings` 仅在有内容时写入（与现有 file-nav 行为一致）
- **错误响应**：保持既有 `{ code, message, hint?, context? }` envelope 形状不变；新增信息（如 `fuzzyMatches`）只允许放入既有的 `context` 扩展点（即 `context.fuzzyMatches`），不新增顶层字段
- **server 元数据**：`instructions` 是 server 初始化层字段（initialize result），不出现在任何工具响应中
- **YAGNI 标注**：[必须] — 回归防护基础约束，去掉则任何 schema 变更都可能静默破坏现有客户端
- **关联 User Story**：US-1, US-2, US-3, US-4

### FR-002 — MCP server instructions 字段注入 [必须] [MUST]
系统 MUST 在 `createMcpServer()` 中注入非空 `instructions`，内容包含：17 工具分组导览、典型调用链路（`detect_changes → impact → context → view_file`）、graph-not-built 恢复流说明。
- **YAGNI 标注**：[必须] — 这是触发率改善的最轻量入口；去掉则子代理在建立连接时无任何使用动机线索
- **关联 User Story**：US-2
- **实施位置**：`src/mcp/server.ts:40`。⚠️ SDK 签名（已对照本地 @modelcontextprotocol/sdk 1.26.0 .d.ts 核实）：`McpServer(serverInfo: Implementation, options?: ServerOptions)`，`instructions` 属于**第二个 `ServerOptions` 参数**——正确写法 `new McpServer({ name, version }, { instructions })`；写进第一个 serverInfo 对象不会进入 initialize result（Codex C-002）

### FR-003 — view_file 接入 resolveSymbolFuzzy [必须] [MUST]
系统 MUST 在 `resolveSymbolRange`（`src/mcp/file-nav-tools.ts:85`）的 `not-found` 路径接入 `resolveSymbolFuzzy`（`src/knowledge-graph/query-helpers.ts:420`）：
- confidence ≥ 0.9 且唯一高分候选时自动采用，响应携带 `warnings: ['fuzzy-resolved']`
- 无高置信唯一命中时返回错误响应，错误体携带 `fuzzyMatches` top-3 候选
- 使用 `autoResolveThreshold: 0.9`（与 Feature 174 保持一致）
- **YAGNI 标注**：[必须] — 直接修复 context→view_file 工具链自断问题，是触发率改善的关键路径；无此修复则宣传的典型链路不可用
- **关联 User Story**：US-1
- **实施位置**：`src/mcp/file-nav-tools.ts`。**scope 边界精确陈述（Codex W-002）**：对 `src/panoramic/graph/graph-query.ts` 及 F193 在改文件（`src/knowledge-graph/{index,persistence,incremental}.ts`）**零新增编辑**（write scope 干净，已核实 `resolveSymbolFuzzy` 仅依赖 graph-types/confidence-mapper/string-distance）；但 view_file 既有的 `getCachedGraphData` 路径在**运行时**仍经 graph-tools → GraphQueryEngine 触达 graph 加载层——verify 阶段须在 F193 合入 master 后复跑 view_file 相关 E2E 确认 graph load 兼容

### FR-004 — fuzzyMatches 候选结构与位置 [必须] [MUST]
系统 MUST 在 fuzzy 解析失败（无高置信唯一命中）的**错误响应**中携带候选：位置为错误 envelope 的 `context.fuzzyMatches`（复用 `buildErrorResponse` 第 4 参 `context` 扩展点），格式 `Array<{ id: string; confidence: number; matchKind: 'exact'|'path-suffix'|'partial-name'|'levenshtein' }>`（完整 `SymbolCandidate`，含 `matchKind`——Codex Plan W-003），最多 top-3，按 confidence 降序。该位置与格式 MUST 与 F174 在 agent-context 工具（`src/mcp/agent-context-tools.ts:183/315`）已建立的约定逐字段一致（现有 `feature-180-symbol-chain.e2e.test.ts:221` 已断言三字段）——17 工具 symbol 入参语义单一化的一部分。
- **YAGNI 标注**：[必须] — 无候选信息时子代理无法重试，工具链仍然断；候选列表是引导重试的最小必要信息
- **关联 User Story**：US-1, EC-002

### FR-005 — server 5 工具 description 补齐至 4 要素 [必须] [MUST]
系统 MUST 将 `prepare`、`generate`、`batch`、`diff`、`panoramic-query` 5 个工具的 description 补充至包含 what / when / example / chained-usage 4 个语义要素，以 file-nav 3 工具（`src/mcp/file-nav-tools.ts:304-360`）的 description 为格式范本。
- **YAGNI 标注**：[必须] — description 是子代理决策是否调用的主要依据；残缺 description 直接导致工具被忽略
- **关联 User Story**：US-3
- **实施位置**：`src/mcp/server.ts`，各 `server.tool()` 的第二个参数

### FR-006 — 工具名称不变 [必须] [MUST]
系统 MUST 确保 17 个工具的名称与当前注册名完全一致，不做任何改名操作。
- **YAGNI 标注**：[必须] — 改名会触发 agents frontmatter 白名单跨仓同步，M8 已明确排除
- **关联 User Story**：US-3, EC-007

### FR-007 — graph 6 工具 description 补 Use when / chained-usage [应该] [SHOULD]
系统 SHOULD 将 `graph_query`、`graph_node`、`graph_path`、`graph_community`、`graph_god_nodes`、`graph_hyperedges` 6 个工具的 description 补充"Use when"和"chained usage"两项说明。
- **YAGNI 标注**：[可选] — graph 工具是当前零调用的重灾区之一，description 改善有助于提升使用率；但相比 server 5 工具（MUST），graph 工具偏探索性，降为 SHOULD
- **关联 User Story**：US-4
- **实施位置**：`src/mcp/graph-tools.ts`，各 `server.tool()` 的第二个参数

### FR-008 — graph_node fuzzy（条件项，F193 scope 风险） [可能] [MAY]
系统 MAY 在 `src/mcp/graph-tools.ts` 的 graph_node handler 层引入 fuzzy 预解析（路径 A），在调用 `engine.getNode` 前使用 `resolveSymbolFuzzy` 把模糊 keyword/id 解析成精确 id，不碰 `src/panoramic/graph/graph-query.ts`。
- **YAGNI 标注**：[YAGNI-移除（当前迭代）] — F193 正在修改 graph-query.ts；若选路径 B（延后），本 FR 从当前版本移除，记录为"等 F193 ship 后单独处理"
- **移除理由**：避免与 F193 产生 scope 冲突；view_file fuzzy（FR-003）是更高优先级且无冲突的改善点
- **plan 决议点**：路径 A vs 路径 B，plan 阶段根据 F193 进展决议；FR-003 的交付**不得**等待本 FR 决议
- **条件验收口径（Codex W-003）**：两分支验收明确分列——
  - **路径 A（做）**：graph_node handler 层 fuzzy 预解析落地，候选/warnings 约定与 FR-003/FR-004 一致，带单测；计入本 feature 验收
  - **路径 B（延后）**：本 FR 标记 **deferred**，**不计入**本 feature 的 pass 判定；在 plan.md、tasks.md 与 verification report 中各记录一行 deferred 事实 + 后续处理归属（F193 ship 后单独 fix），不允许"默默消失"
- **关联 User Story**：EC-006

### FR-009 — F170d 轻量任务引导强化 [AUTO-RESOLVED: instructions 字段已覆盖大部分预查注入诉求，取最轻量子集] [可能] [MAY]
系统 MAY 在 instructions 字段（FR-002）中包含任务类型到推荐工具集的映射提示（如"代码定位任务 → context + view_file"、"影响面分析 → detect_changes + impact"），作为 F170d 任务→工具匹配引导强化的最轻量实现。
- **AUTO-RESOLVED**：F170d 三选项（①独立 task-routing prompt、②orchestrator 预查注入、③instructions 字段扩充）中，选项③与 FR-002 自然合并，零额外结构复杂度。选项①②在 M8 范围内成本过高，等后续 feature 单独决策。
- **传播失败兜底（Codex W-001）**：若 A/B 得出"instructions 不传播到 Task 子代理"的负结论，本 FR 的任务→工具映射不随之整体失效——关键 chained-usage 引导同时落在各工具 description（FR-005/FR-007）中，而 description 经 tools/list 传播、与 instructions 传播性无关，构成结构性兜底；负结论时 description 升级为主要载体并记入 A/B 报告，选项①②重新进入后续 feature 决策视野
- **YAGNI 标注**：[可选] — 此部分作为 FR-002 instructions 内容的扩充写入，不引入新模块；若 A/B 评测显示 instructions 本身已足够，可不额外区分任务类型映射
- **关联 User Story**：US-2, US-5

### FR-010 — A/B 评测基础设施复用 [应该] [SHOULD]
系统 SHOULD 复用 F176 telemetry 基线设施执行 A/B 评测：
- 最小规模：2 cohort（改造前/改造后） × 3-5 个任务 × N=3
- 跑批前 verify 三件套：`SILICONFLOW_API_KEY` / Claude OAuth / `~/.codex/auth.json`
- 列出预估成本，等用户确认后方可执行
- A/B 结果必须给出 instructions 传播性的明确结论（正负均可）
- **YAGNI 标注**：[必须] — 无量化验证则 feature 改善效果无法确认，M7 问题无法收口
- **关联 User Story**：US-5

### FR-011 — 现有测试套件零回归 [必须] [MUST]
系统 MUST 在所有改动完成后通过：F180 44 个 stdio E2E（尤其 listTools 17 工具断言、F174 fuzzy E2E）、4250+ vitest run 零失败、`npm run build` 零 TypeScript 错误、`npm run repo:check` 57 项全绿。
- **YAGNI 标注**：[必须] — 回归护栏，去掉则无法确认改动未破坏现有功能

---

## Success Criteria

### SC-001 — view_file fuzzy 基本可用
通过 stdio E2E 测试验证：向 `view_file` 传入格式略有偏差的 symbolId（已知存在于 graph，confidence ≥ 0.9），系统返回成功响应，响应体包含正确代码内容和 `warnings: ['fuzzy-resolved']`。

### SC-002 — view_file fuzzy 失败降级可用
通过 stdio E2E 测试验证：向 `view_file` 传入无法高置信解析的模糊 symbolId，系统返回错误响应，错误体包含 `fuzzyMatches` 字段（top-3 候选，按 confidence 降序）。

### SC-003 — instructions 传播性有结论
A/B 评测完成后，对"instructions 字段是否真实传播到 Task 子代理"给出明确结论（正/负/部分传播），结论基于对比 cohort 的工具调用日志，而非猜测。

### SC-004 — 触发率方向性提升信号
A/B 评测**实验组**（含全部改造）的子代理 MCP 工具触发率较**对照组 / F176 基线**（1.77/run，16/30≈53.3% 零调用）呈现方向性提升信号。点估计目标：触发率 ≥ 2.5/run 且零调用 run 占比 ≤ 37%（30-run 口径即 ≤ 11/30）。
⚠️ **诚实性声明（Codex C-001）**：最小规模（2 cohort × 3-5 task × N=3）下本 SC 只判定**方向性信号**，不构成统计显著性结论——不做假设检验/置信区间声明；点估计达标 → 记"信号为正"，未达标 → 记"信号不足"并分析原因。确证性复测（更大规模 + 显著性判定）按 M8 设计划归 **F188**（scope 视本次 A/B 结果定）。

### SC-005 — description 4 要素满格
工具注册代码审查确认：server 5 工具的 description 每条均包含 what / when / example / chained-usage 4 个语义要素，与 file-nav-tools.ts 范本结构一致。

### SC-006 — 全量测试零回归
改造后：vitest run 4250+ 全部通过、npm build 零类型错误、repo:check 57 项全绿、F180 44 个 stdio E2E 无新增失败。

### SC-007 — A/B 成本可控
A/B 跑批实际成本在用户确认前列出预估，SiliconFlow API 实付成本（订阅边际 0）控制在与用户确认的预算范围内。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|----|------|
| **组件总数** | 3 | 改造 server.ts（instructions）、file-nav-tools.ts（fuzzy）、graph-tools.ts（description） |
| **接口数量** | 2 | resolveSymbolRange 内部接口变更（新增 fuzzyMatches 返回路径）、createMcpServer 构造参数扩展 |
| **依赖新引入数** | 0 | resolveSymbolFuzzy 已存在于 src/knowledge-graph/query-helpers.ts（Feature 174 已落地），无新外部依赖 |
| **跨模块耦合** | 低 | file-nav-tools.ts 引用已有 query-helpers.ts 函数；server.ts 修改构造参数；graph-tools.ts 仅改 description 字符串 |
| **复杂度信号** | 无 | 无递归结构、无状态机、无并发控制、无数据迁移 |
| **总体复杂度** | **LOW** | 组件 3 < 阈值 5，接口 2 < 阈值 4，无复杂度信号 |

**GATE_DESIGN 注记**：虽然总体复杂度 LOW，但存在一个需 plan 决议的 scope 风险点（FR-008，graph_node fuzzy 与 F193 的冲突），plan 阶段需明确选路径 A（MCP handler 层 fuzzy 预解析）或路径 B（延后），不影响主线 P1 交付。

---

## 歧义处理

1. **[AUTO-RESOLVED: F170d 三选项取最轻量子集]** — 抓手 4（F170d 任务→工具匹配引导强化）的三个选项（独立 task-routing prompt / orchestrator 预查注入 / instructions 字段扩充）中，选项③自然与 FR-002 合并，成本最低、范围最小。选项①②在当前 M8 范围内代价过高，留 future feature 决策。已在 FR-009 标注。

2. **[AUTO-RESOLVED: graph_node fuzzy 列为条件项，不拍板路径选择]** — graph_node fuzzy 的实现路径（A vs B）因 F193 scope 冲突，无法在 spec 阶段确定。已在 FR-008 和 EC-006 中明确列出两条路径，标注为 plan 决议点，确保 FR-003（view_file fuzzy）不被拖累。

3. **[AUTO-RESOLVED: A/B 改造前 cohort 直接复用 F176 既有数据]** — SC-004 标注"对照组 / F176 基线"、FR-010 写"2 cohort（改造前/改造后）"存在表述歧义：是否需要重跑改造前版本？推荐：直接以 F176 既有数据（1.77/run，16/30 零调用）作为"改造前"对照基线，无需 git checkout 旧 commit 重跑；仅跑"改造后"实验组。理由：F176 已是在相同任务集上、相同测评设施下采集的数据，重跑仅增加成本和配额消耗而不提升结论质量；若任务集或基础设施发生变化（如 F188 更大规模复测），再单独设对照组。

4. **[AUTO-RESOLVED: instructions 及 description 文案语言沿用 file-nav 中文混英文术语格式]** — instructions（FR-002）和 server 5 工具 description（FR-005）的文案语言未在 spec 中明确。现有 file-nav 3 工具 description（`src/mcp/file-nav-tools.ts:307-358`）已建立范本：中文语义主体 + 英文技术标签/示例混合格式（如"按行区间或 symbol 定位查看文件片段 ... Use this tool when: ... Example: ..."）。推荐：instructions 和 description 均沿用该范本格式，保持工具集内一致性；不单独规定纯中文或纯英文。

