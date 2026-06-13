# Tasks: F184 — 子代理 MCP 触发率工程（MCP Adoption Engineering）

**Input**: `specs/184-mcp-adoption-engineering/spec.md` + `plan.md` + `data-model.md` + `implementation-notes.md`
**Branch**: `184-mcp-adoption-engineering`
**Date**: 2026-06-13

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|---------|
| FR-001 | 响应 schema 向后兼容 | T010, T013, T017 |
| FR-002 | instructions 字段注入 | T001, T002, T003 |
| FR-003 | view_file 接入 resolveSymbolFuzzy | T011, T012, T013 |
| FR-004 | fuzzyMatches 候选结构与位置 | T012, T013 |
| FR-005 | server 5 工具 description 补齐 4 要素 | T004（测试）, T007（实现） |
| FR-006 | 工具名称不变 | T017（回归门约束） |
| FR-007 | graph 6 工具 description 补 Use when/chained-usage | T005（测试）, T006（实现） |
| FR-008 | graph_node fuzzy（条件项） | T018（deferred 记录） |
| FR-009 | 任务→工具轻量映射（instructions 扩充） | T001（断言）, T003（实现） |
| FR-010 | A/B 评测 | T019 |
| FR-011 | 现有测试套件零回归 | T017 |

> **FR 覆盖映射修订（Codex Tasks 审查）**：FR-005/FR-007 原映射把 server 与 graph 的测试/实现任务错配（T005 实为 graph 测试、T007 实为 server 实现），已按"FR-005=T004+T007（server）/ FR-007=T005+T006（graph）"更正；FR-009 补 T003（实现）并要求 T001 断言任务→工具映射关键词。

### SC / EC 覆盖映射（analyze 阶段补全，按内容追踪）

| SC | 覆盖任务 | | EC | 覆盖任务 |
|----|---------|-|----|---------|
| SC-001 view_file fuzzy 基本可用 | T008, T009 | | EC-001 graph-not-built 降级 | T008 |
| SC-002 fuzzy 失败降级 | T008, T009 | | EC-002 多候选无高置信 | T008, T009 |
| SC-003 instructions 传播性有结论 | T002, T019 | | EC-003 空/无效 symbolId | T008 |
| SC-004 触发率方向性提升 | T019 | | EC-004 向后兼容双 envelope | T013 |
| SC-005 description 4 要素满格 | T004, T007 | | EC-005 instructions 传播未知 | T002, T019 |
| SC-006 全量测试零回归 | T016 | | EC-006 graph_node F193 冲突 | T018 |
| SC-007 A/B 成本可控 | T019 | | EC-007 description listTools 断言 | T014 |
| | | | EC-008 autoResolveThreshold 一致 | T012 |

---

## Phase 1: US2 — MCP Server Instructions 注入（Priority: P1）

**目标**：在 `createMcpServer()` 中通过 `ServerOptions` 第二参数注入 17 工具导览，子代理连接后即可感知使用动机线索（FR-002/FR-009）。

**独立测试**：单测断言 server 构造时含 instructions；stdio E2E 断言 `client.getInstructions()` 非空 + 含典型链路串 + graph-not-built 恢复流关键词。

### 测试先行（TDD：先写，确认红，再实现）

- [ ] T001 [US2] 写单测 `tests/unit/mcp/server-instructions.test.ts`（新建）：断言 `createMcpServer()` 构造时 `McpServer` 第二参数含非空 `instructions`，含 `"detect_changes → impact → context → view_file"` 链路串，含 `"graph-not-built"` 关键词，长度 ≤ 1600 字符（`instructions.length <= 1600` 断言）；**FR-009 断言（Codex Tasks 修订）**：额外断言 instructions 含 ≥ 2 个任务→工具映射关键词（如同时含 "impact" 与 "影响面"/"blast"、含 "context" 与 "定位"/"调用" 之类映射线索），确保 FR-009 内容真实落地而非虚绿；运行确认红（TOOL_GUIDE 常量未写时失败）

- [ ] T002 [US2] 写 stdio E2E `tests/e2e/feature-184-instructions.e2e.test.ts`（新建）：`describe('用户故事: MCP server instructions 经 stdio 协议握手传播', ...)`，`spawnMcpClient()` 后断言 `handle.client.getInstructions()` 非空 + 含 `"detect_changes → impact → context → view_file"` + 含 `"graph-not-built"`；运行确认红（实现前失败）

### 实现

- [ ] T003 [US2] 在 `src/mcp/server.ts` 顶部新增 `TOOL_GUIDE` 常量（5 个分组、典型链路、graph-not-built 恢复流、任务→工具轻量映射）；在 `createMcpServer()` 第 40 行修改为 `new McpServer({ name, version }, { instructions: TOOL_GUIDE })`；文本总长度 ≤ 1600 字符；弱化"17 工具"硬编码计数（改用分组描述），加注释提醒工具增减时同步更新

**Checkpoint**：T001 / T002 全绿；stdio 协议层传播已验证（≠ Task 子代理模型上下文——A/B 才答这题）

---

## Phase 2: US3/US4 — 工具 Description 补齐（Priority: P1/P2）

**目标**：server 5 工具补齐 4 要素、graph 6 工具补 Use when/chained-usage，提升工具可发现性（FR-005/FR-007）；Task A/B/C 可并行（改不同文件）。

**独立测试**：单测断言 4 要素关键词 + 字符长度 [100, 500]；F180 44 个 E2E 全通过（工具名称不变约束）。

### 测试先行

- [ ] T004 [P] [US3] 写单测 `tests/unit/mcp/description-completeness.test.ts`（新建）：断言 server 5 工具（`prepare/generate/batch/diff/panoramic-query`）的 description 含 `"Use this tool when"`、`"Example"`、`"Typical chained usage"` 关键词；每条 description ≥ 3 个 use-case bullet；每条长度 ∈ [100, 500] 字符；工具名称列表为 17 个（与 `ALL_17_TOOLS` 一致）；运行确认红

- [ ] T005 [P] [US4] 在同文件 `tests/unit/mcp/description-completeness.test.ts` 追加 graph 6 工具断言（`graph_query/graph_node/graph_path/graph_community/graph_god_nodes/graph_hyperedges`）：含 `"Use when"` 关键词，含 `→` 或 `->` chained-usage 示例，长度 ∈ [100, 500] 字符；运行确认红

### 实现（[P] 因改不同文件，T006 与 T003 可并行；T006 不改 handler/schema）

- [ ] T006 [P] [US4] 扩充 `src/mcp/graph-tools.ts` 中 graph 6 工具（`graph_query/graph_node/graph_path/graph_community/graph_god_nodes/graph_hyperedges`）的 description：补 "Use when" + "Typical chained usage" 两段，各参照 plan.md 中的 chained-usage 定位（`graph_query: batch→graph_query`、`graph_node: graph_query→graph_node` 等）；每条长度 ∈ [100, 500]；不动 handler/schema；不改工具名称

- [ ] T007 [US3] 扩充 `src/mcp/server.ts` 中 server 5 工具（`prepare/generate/batch/diff/panoramic-query`）的 description：补齐 4 要素（`{功能简述} / Use this tool when: ≥3 bullet / Example: input+output / Typical chained usage: ≥1 chain`）；以 `src/mcp/file-nav-tools.ts:307-358` 为格式范本；各工具 chained-usage 定位（`prepare→generate / batch→context/impact / batch→diff / batch→panoramic-query`）；每条长度 ∈ [100, 500]；不动 handler/schema；不改工具名称

**Checkpoint**：T004 / T005 全绿；`npx vitest run tests/unit/mcp/description-completeness.test.ts` 通过

---

## Phase 3: US1 — view_file fuzzy Symbol 解析（Priority: P1）

**目标**：修复 `context → view_file` 工具链自断——接入 `resolveSymbolFuzzy`，confidence ≥ 0.9 唯一命中时自动 resolve，失败时返回 top-3 候选（FR-003/FR-004）。

**独立测试**：单测覆盖 5 个分支（autoResolved 成功/失败带候选/graph-not-built/空 symbolId/fuzzy 跨文件 mismatch）；stdio E2E 基于 micrograd fixture 验证协议层端到端行为。

**依赖**：Phase 1/2 完成后进行（避免多文件并行改动混淆 debug）

### 测试先行

- [ ] T008 [US1] 写单测 `tests/unit/mcp/view-file-fuzzy.test.ts`（新建）——mock `getCachedGraphData` 返回合成 micrograd 图（参考 `feature-174` 中 `makeMicrogradGraph` 模式）：
  - SC-001：`resolveSymbolFuzzy` autoResolved=true，唯一高分候选 → `resolveSymbolRange` 返回 `{ ok: true, fuzzyResolved: true, file, start, end }`
  - SC-002：autoResolved=false，多候选 → `resolveSymbolRange` 返回 `{ ok: false, result.context.fuzzyMatches top-3 }`，含 matchKind 三字段
  - EC-001：`getCachedGraphData` 返回 null → `graph-not-built`（现有行为不变）
  - EC-003：空 symbolId `''` → `canonicalizeSymbolId` 走 invalid 路径 → `invalid-symbol-id`（fuzzy 分支不触发）
  - W-002：`path='a.ts'`、symbolId fuzzy 解析到 `sub/b.ts::foo` → fileMismatch 校验 → `invalid-input`（验证 fuzzy-resolved file 也过 fileMismatch 校验）
  - 运行确认红（fuzzy 分支未实现时失败）

- [ ] T009 [US1] 写 stdio E2E `tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts`（新建）：`describe('用户故事: view_file fuzzy symbol resolve 经 stdio JSON-RPC 链路行为成立', ...)`；扩展 `feature-180-symbol-chain.e2e.test.ts` 已建的 `micrograd/nn.py#MLP` graph.json fixture：
  - SC-002（E2E）：用裸名 `'MLP'` 调 view_file → 期望 `symbol-not-found` + `context.fuzzyMatches[0].confidence ≈ 0.85 < 0.9`（proven 来自 symbol-chain.e2e:205）
  - SC-001（E2E）：用唯一 path-suffix 近似（如去 `micrograd/` 前缀的 `engine.py::Value.relu` 类形态——feature-174 已证 path-suffix 该形态 confidence=0.9）→ 期望成功响应 + `warnings` 含 `'fuzzy-resolved'`（用 `arrayContaining` 断言，禁 `toEqual`）
  - **⚠️ T009 前置 probe + 兜底（Codex Tasks CRITICAL，防 fixture 无 ≥0.9 唯一候选导致死锁）**：implement 时先对真实 micrograd graph.json fixture 跑 probe——枚举几个候选 query 看是否存在"唯一且 confidence ≥ 0.9"的 auto-resolve 命中。三级兜底，按序取第一个可行项：
    1. fixture 天然有唯一高分候选 → 直接用
    2. 无 → **允许 patch fixture graph.json**（feature-180 已有 patch MLP lineRange 先例）造一个唯一 path-suffix/partial-name 高分场景（不算臆造串：patch 的是真实 symbol 的图数据）
    3. 仍不行 → SC-001 auto-resolve 分支**退化由 T008 单测 mock 覆盖**（feature-174 已证 mock 图 `"Value.__add__"` autoResolved≥0.9 可行），E2E 仅保留 SC-002 失败带候选 + 一条 fuzzy-resolved 成功路径（用 patch 后的 fixture）。在 T009 完成说明里记录最终选了哪级及原因。
  - 运行确认红

### 实现

- [ ] T010 [US1] 扩展 `src/mcp/file-nav-tools.ts` 中 `resolveSymbolRange` 的返回类型（`data-model.md` 定义）：`ok: true` 分支新增可选 `fuzzyResolved?: boolean` 字段；该字段为内部传递信号，供 `handleViewFile` push `'fuzzy-resolved'` 到 warnings 数组

- [ ] T011 [US1] 在 `src/mcp/file-nav-tools.ts` 顶部 import 行追加 `resolveSymbolFuzzy`（与 `canonicalizeSymbolId, findNode, moduleFileFromId` 同行或紧邻行）；路径：`src/knowledge-graph/query-helpers.ts:420`；**scope 边界**：对 `src/panoramic/graph/graph-query.ts` 及 F193 改动文件（`src/knowledge-graph/{index,persistence,incremental}.ts`）零新增编辑

- [ ] T012 [US1] 在 `src/mcp/file-nav-tools.ts` 的 `resolveSymbolRange` 函数（第 85 行）的 `not-found` 分支（`canon.reason === 'not-found'`）接入 fuzzy 逻辑（镜像 `agent-context-tools.ts:169-188`）：
  - 调用 `resolveSymbolFuzzy(graphData, symbolId, { projectRoot })`
  - autoResolved=true 且 `candidates[0]` 存在：用 `candidates[0].id` 调 `findNode(graphData, resolvedId)` 拿 `metadata.lineRange` + `sourceFile`，返回 `{ ok: true, file, start, end, fuzzyResolved: true }`
  - 无高置信唯一命中：返回 `buildErrorResponse('symbol-not-found', ..., ..., { fuzzyMatches: fuzzy.candidates.slice(0, 3) })`（直接 slice，保留完整 `SymbolCandidate { id, confidence, matchKind }`，禁裁字段）
  - 在 `handleViewFile`（第 169 行后）中：`if (sym.fuzzyResolved) warnings.push('fuzzy-resolved')`（复用已有 `warnings` 局部数组）

- [ ] T013 [US1] 向后兼容核验（FR-001/FR-004 约束）：代码审查确认——成功响应 `warnings` 仅在 `warnings.length > 0` 时写入（复用现有模式）；错误响应 `fuzzyMatches` 只进 `context` 扩展点，不新增顶层字段；`matchKind` 已在 `fuzzyMatches` 元素中（三字段：id/confidence/matchKind）；warnings 断言在测试中用 `toContain`/`arrayContaining`，不用 `toEqual`

**Checkpoint**：T008 / T009 全绿；`context → view_file` 典型工具链不再自断

---

## Phase 4: 回归 & 验收门

**目标**：确认所有改动不破坏现有功能（FR-006/FR-011）。

### 回归测试

- [ ] T014 [P] 运行 F180 44 个 stdio E2E：`npx vitest run tests/e2e/feature-180`——重点核查 listTools 17 工具名称断言零回归（EC-007 约束：工具名称不变）

- [ ] T015 [P] 运行 F174 既有 fuzzy E2E：`npx vitest run tests/e2e/feature-174-symbol-fuzzy-match.e2e.test.ts`——确认 view_file fuzzy 改动不影响 agent-context 工具的 fuzzy 路径

- [ ] T016 运行全量测试 + 构建门：`npx vitest run`（目标 4250+ 全通过）→ `npm run build`（零 TypeScript 错误）→ `npm run repo:check`（57 项全绿）；任一失败停止，修复后重跑。**description 改动专项核查（Codex Tasks 修订）**：T007/T006 改 description 后，确认 `tests/unit/mcp-server.test.ts`（仅断言工具名，不断 description 内容——已核实）、`tests/unit/mcp/response-contract.test.ts`（`_description` 忽略参数——已核实）无 hardcode description 内容匹配；若全量 run 出现 description 相关失败，优先定位这两个文件

### Codex 对抗审查 + 提交

- [ ] T017 每次 `git commit` 前：通过 Agent tool 启动 `codex:codex-rescue` 子代理，对本次改动（`src/mcp/server.ts` / `src/mcp/file-nav-tools.ts` / `src/mcp/graph-tools.ts` + 测试文件）执行对抗性审查（adversarial review）；critical/bug/边界遗漏修复后重跑测试；风格建议记录在 commit message；**提交用显式路径 `git add` 列举文件，禁用 `git add -A`，排除 `specs/src.spec.md` 再生噪声**。**codex 不可用兜底（Codex Tasks 修订 + 已知 codex-rescue 偶发 stall）**：后台启动 + 有界等待 + 一次重试；若仍不可用，主线程按同一"挑战为先/找漏洞"模板自审并在 commit message 记录降级原因，不因子代理不可用卡住交付

**Checkpoint**：全量测试零失败，Codex 审查无 critical 项，可进入交付流程

---

## Phase 5: FR-008 Deferred 记录

**目标**：明确 FR-008 不计入本 feature 验收，留痕供后续处理（spec W-003 三处留痕约定）。

- [ ] T018 **[FR-008 DEFERRED 记录任务——不写代码]**：**完成判定（Codex Tasks 修订）**：在固定产物 `specs/184-mcp-adoption-engineering/verification-report.md`（由 T021 创建，T018 `depends_on: T021`）中写明一行：`FR-008（graph_node fuzzy）deferred，不计入本 feature pass 判定`；后续处理归属：F193 ship 到 master 后，作为独立 fix 在 `src/mcp/graph-tools.ts` handler 层实现（仅对 `id` 参数 not-found 路径加 fuzzy 兜底，keyword substring 语义保持不变，不碰 `graph-query.ts`）；理由：路径 A 语义风险（需处理 getNode null 分支 + snapshot 测试更新）> 收益；F184 主线价值不依赖 graph_node fuzzy。三处留痕已齐：plan.md（审查修订节）+ tasks.md（本任务）+ verification-report.md（本任务写入）

---

## Phase 6: A/B 评测（Priority: P2，异步，用户确认后执行）

**目标**：量化改造后子代理 MCP 工具触发率，明确 instructions 传播性结论（FR-010/SC-003/SC-004）。

**前置条件**：所有代码改动稳定、T016 全绿、已 push 到目标分支后执行。

- [ ] T019 **[A/B 评测——需用户确认才执行]** 复用 F176 telemetry 基线设施：执行前 verify 三件套（`grep -c "^export SILICONFLOW_API_KEY=" .env.local` 输出 1 / `claude --print --model claude-haiku-4-5` 返回 ok / `ls ~/.codex/auth.json` 存在）；列出预估成本（SiliconFlow API 实付，订阅边际 0）；**等用户明确确认后方可执行跑批**；规模：1 实验组（改造后）× 3-5 个任务 × N=3（直接以 F176 1.77/run 既有数据为对照基线，无需重跑改造前版本）；结果必须给出 instructions 传播性明确结论（正/负/部分传播），基于工具调用日志而非猜测；SC-004 口径：点估计触发率 ≥ 2.5/run 且零调用 run 占比 ≤ 37% → 记"信号为正"，未达标 → 记"信号不足"并分析原因（最小规模只判方向性信号，不做假设检验，确证性复测归 F188）

---

## Phase 7: Polish — 收尾

**目标**：自用反馈闭环（dogfooding 四维度），确保改动交付规范。

- [ ] T020 收尾"工具使用反馈"节（dogfooding 四维度）：在交付报告末尾追加 MCP 可用性（连接/工具调用是否正常）、返回信息是否够用（字段/上下文/next-step 提示）、Spec Driver 流程顺畅度（gate/phase/产物）、结果准确性（fuzzy match/graph 数据）；无遇到问题时显式写"无"，不省略

- [ ] T021 **[bridging 任务，Codex Tasks 修订]** 在 verify 阶段创建固定产物 `specs/184-mcp-adoption-engineering/verification-report.md`：汇总 FR-001~FR-011 验收结论（逐条 PASS/DEFERRED + 证据）、回归门结果（vitest/build/repo:check）、A/B 评测结论（若已跑）；T018 的 FR-008 deferred 留痕写入此文件。被 T018 依赖（`T018 depends_on T021`）

---

## 依赖与执行顺序

### Phase 依赖

- **Phase 1（T001-T003）**: 无依赖，立即开始；T001/T002 测试先写（TDD 红），T003 实现
- **Phase 2（T004-T007）**: 与 Phase 1 可并行（不同文件）；T006（graph-tools.ts）与 T003（server.ts）可并行；T007 可在 T003 完成后同文件串行处理
- **Phase 3（T008-T013）**: 建议在 Phase 1/2 稳定后进行（避免多文件改动混淆 debug）；T010/T011 可并行（导入+返回类型）；T012 依赖 T010/T011
- **Phase 4（T014-T017）**: 依赖 Phase 1/2/3 全部完成；T014/T015 可并行
- **Phase 5（T018）**: 无代码依赖，随时可标注
- **Phase 6（T019）**: 依赖全部代码稳定 + 用户确认
- **Phase 7（T020）**: 最终收尾

### User Story 间依赖

- US2（instructions）、US3（server 5 description）、US4（graph 6 description）相互独立（改不同位置），可并行
- US1（view_file fuzzy）不依赖其他 US，但建议串行排后以减少多文件混淆
- US5（A/B 评测）依赖所有 US 代码稳定

### Story 内并行机会

- Phase 1：T001 单测 [P] T002 stdio E2E（不同文件）
- Phase 2：T004 单测 [P] T005 单测（同文件不同 describe 块，实现时顺序处理）；T006 graph-tools [P] T007 server.ts
- Phase 3：T008 单测 [P] T009 E2E（不同文件）；T010 类型扩展 [P] T011 import 新增
- Phase 4：T014 F180 E2E [P] T015 F174 E2E

### 推荐实现策略（单人顺序，MVP First）

```
TDD 流程：T001 + T002（写测试确认红）
           → T003（instructions 实现，确认 T001/T002 绿）
           → T004 + T005（description 单测确认红）
           → T006 [P] T007（description 实现，确认 T004/T005 绿）
           → T008 + T009（fuzzy 单测+E2E 确认红）
           → T010 + T011（类型+import）→ T012（fuzzy 逻辑）→ T013（向后兼容核验）
           → T014 [P] T015 [P] T016（回归门）
           → T017（Codex 审查 + 提交）
           → T018（deferred 记录）
           → T019（等用户确认后跑 A/B）
           → T020（收尾反馈）
```

---

## 实现约束汇总（implementation-notes.md 硬约束，不可漏）

| 约束 | 来源 | 执行任务 |
|------|------|---------|
| instructions 长度 ≤ 1600 字符，加长度断言 | Codex W-004 | T001, T003 |
| instructions 弱化"17"硬编码计数 | implementation-notes.md | T003 |
| `new McpServer({ name, version }, { instructions })` 第二参数 | FR-002 / Codex C-002 | T003 |
| stdio E2E 验证 instructions 协议层传播（不可砍） | Codex C-002 | T002 |
| E2E 测试一律基于 micrograd fixture，禁用臆造串 | Codex C-001 | T008, T009 |
| SC-001 query 具体串需 implement 时实测微调 | Codex C-001 | T009 |
| fuzzyMatches 元素含 matchKind（完整 SymbolCandidate） | Codex W-003 | T012 |
| warnings 断言用 arrayContaining，禁 toEqual | Codex W-005 | T008, T009 |
| fuzzy-resolved file 也过 fileMismatch 校验 | Codex W-002 | T008, T012 |
| description 每条长度 ∈ [100, 500]（feature-170c 契约） | implementation-notes.md | T004, T005, T006, T007 |
| scope 边界：不碰 graph-query.ts 及 F193 文件 | FR-003 | T011, T012 |
| 提交用显式路径 git add，排除 specs/src.spec.md | 仓库约定 | T017 |
| FR-008 deferred 三处留痕（plan/tasks/verification） | Codex W-001 | T018 |
| A/B 跑批等用户确认，列预估成本 | FR-010 / CLAUDE.local.md | T019 |
