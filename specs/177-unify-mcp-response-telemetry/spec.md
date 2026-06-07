# Feature 177 — 统一 MCP 工具响应契约 + telemetry 装饰器（17 工具收口）

- **类型**: refactor（成功响应硬兼容；错误 envelope 为**已授权的 breaking change**）
- **模式**: spec-driver-story
- **来源**: M7 step-back review（architecture-review proposedFeatures[0]）；canonical 设计见 `docs/design/M7-stepback-revision.md` §F177
- **前置关系**: F177 是 F176 的前置（telemetry 全覆盖 → F176 token-per-task 第二指标采集完整）
- **并行**: 与 F178 并行（写入路径 disjoint：F177 限定 `src/mcp/`，F178 限定 `src/utils/` + `src/knowledge-graph/` + `src/batch/` + `graph-builder`）

---

## 1. 意图（Intent）

统一 spectra MCP server 17 个工具的**错误响应 envelope** 与 **telemetry 采样覆盖**，消除三处抽象债务：

1. **错误契约分裂**：`src/mcp/graph-tools.ts` 的本地 `buildErrorResponse(err, hint)` 返回 `{ error, hint }`，而 `src/mcp/lib/tool-response.ts` 的 `buildErrorResponse(code, message, hint?, context?)` 返回 `{ code, message, hint?, context? }`。两套不兼容契约导致 MCP 客户端无法用单一路径解析错误码。
2. **telemetry 覆盖盲区**：F158 telemetry 仅覆盖 6/17 工具（agent-context 3 + file-nav 3）。graph_* 6 + prepare/generate/batch/diff/panoramic-query 5 共 **11 工具**零 telemetry，是 F176 token 指标的采集盲区。
3. **样板重复**：`agent-context-tools.ts` 三个 handler 各自复制 `_telStart` / `_telReqSize` / `recordAndReturn` 三段样板（`handleImpact` 内 `recordAndReturn` 出现 6 次），而 file-nav 的 `runFileNavTool` 骨架已收口同类样板。

**对 F176 的价值**：telemetry 覆盖全 17 工具后，F176 的 token-per-task 第二指标采集完整。

### 非目标（Non-Goals）

- **不改 input schema**：所有工具的 Zod 入参 schema、参数名、默认值保持逐字不变。
- **不改工具行为**：成功响应字段（payload 结构）保持逐字节兼容。仅统一**错误** envelope + 补 telemetry。
- **不动 F178 范围**：不触碰 levenshtein / normalizeProjectPath / graph-builder edge 去重（那是 F178）。
- **不改 telemetry JSONL schema**：`TelemetryEntry` 字段不变；仅扩大其发射覆盖面。

---

## 2. 接口定义（Interfaces）

### 2.1 `lib/tool-response.ts` — ErrorCode union 扩展

在既有 12 码（F155 9 + F171 3）基础上新增 graph 专属错误码。grep 现状证据：graph-tools 当前错误语义只有两类——"图谱未构建/加载失败"（默认 hint "运行 spectra graph 先生成图谱"）与"查询执行失败"（engine 抛错）；外加 `graph_hyperedges` 的两处空串入参校验。映射到统一码：

```ts
export type ErrorCode =
  // ...既有 12 码...
  | 'graph-query-failed'   // engine 查询/遍历执行期抛错（getNode/findPath/query/getCommunity/getGodNodes/getHyperedges）
  // 注：'graph-not-built' 已存在于既有 union（F155），graph-tools 复用之；'invalid-input' 复用于空串校验
```

> **设计要求（Codex CRITICAL-1 修订）**：当前 6 个 graph handler 的单个 `catch` 同时包住 `getEngine`（内部 `statSync` + `loadFromFile`，会因缺图/坏图抛错）**和** engine 查询方法（`query`/`getNode`/…），无法靠 error message 内容稳定二分类，且靠 message 猜分类会泄露路径。**因此实现必须拆出 engine 加载边界**：
> - 先 `getEngine(projectRoot)`，其失败（缺图/坏图）→ `graph-not-built`（复用既有码，hint "运行 spectra graph 先生成图谱"）
> - 加载成功后的查询方法异常 → `graph-query-failed`（新增码，message 脱敏取 `err.message` 但不含路径/stack）
> - 不进一步细分（如 `graph-path-not-found`）— YAGNI（宪法原则 III）。缺图/坏图/空串/查询失败各需独立测试。

### 2.2 `withTelemetry(toolName, handler)` — 注册层装饰器

新增注册层装饰器，统一为"无内部采样需求"的工具补 telemetry。签名草案（精确形态由 plan 定）：

```ts
// 位置候选：src/mcp/lib/telemetry.ts（与 recordAndReturn 同模块）
export function withTelemetry<A extends object>(
  toolName: string,
  handler: (args: A) => Promise<ToolResult> | ToolResult,
): (args: A) => Promise<ToolResult>;
```

语义：包裹 handler，入口记 `start` + `requestSize`，出口经 `recordAndReturn` 透传（含错误码提取）。**关键约束（见 EC-1）**：必须与已在 handler 内部自调 `recordAndReturn` 的工具（file-nav 3 + agent-context 3）**互斥**，否则重复发射。

### 2.3 `runAgentContextTool(toolName, args, body)` — agent-context 骨架

对标 `runFileNavTool`，为 impact / context / detect_changes 提供统一骨架：telemetry 采样 + 顶层 internal-error catch + `recordAndReturn` 透传。需支持 body 回传 `responseSummary` / `responseSamples`（agent-context 特有，file-nav 骨架无此参数 → 骨架需比 runFileNavTool 多一层富采样透传）。

### 2.4 server.ts 5 工具错误响应

prepare / generate / batch / diff / panoramic-query 当前返回**纯文本** error（如 `"prepare 失败: <msg>"`），既非 `{error}` 也非 `{code}`。迁移为 `buildErrorResponse(code, message)`，错误码新增/复用：

| 工具 | 现状错误 | 目标 code |
|------|---------|----------|
| prepare | `"prepare 失败: …"` 纯文本 | `internal-error` |
| generate | `"generate 失败: …"` 纯文本 | `internal-error` |
| batch | `"batch 失败: …"` 纯文本 | `internal-error` |
| diff | `"diff 失败: …"` 纯文本 | `internal-error` |
| panoramic-query | catch → `"panoramic-query 失败: …"` 纯文本；**另有** `!result.ok` → `{ error: result.error }`（非 isError） | catch→`internal-error`；`!result.ok`→ `invalid-input`（**须置 isError**，见下） |

> **决策点（Codex WARNING-1 修订）**：5 工具的 catch（prepare/generate/batch/diff + panoramic catch）是顶层**未预期异常**边界 → 统一 `internal-error`（脱敏，不泄漏 stack，符合 F171 FR-014）。
> 但 panoramic-query 的 `!result.ok` 是 query.ts 返回的**预期失败**（缺 `question` 参数 / 非 monorepo operation 等输入驱动失败），**不是异常**。映射到 `internal-error` 会污染 telemetry errorCode 并让客户端无法区分"补参数"与"真故障"。**因此 `!result.ok` → `invalid-input`**（保留 `result.error` 文案到 message，置 `isError: true`）。

---

## 3. 业务逻辑（Behavior）

### 3.1 graph-tools 6 工具迁移

- 删除 `graph-tools.ts:140` 本地 `buildErrorResponse(err, hint)`。
- 6 个 handler 的 `catch (err)` 改用 `lib/tool-response.ts` 的 `buildErrorResponse(code, message, hint?)`：engine 抛错 → `graph-query-failed`（message 脱敏：取 `err.message` 但不含路径/stack；hint 保留"运行 spectra graph 先生成图谱"语义）。
- `graph_hyperedges` 两处空串校验（label / node_id）→ `buildErrorResponse('invalid-input', …)`。
- 经 `withTelemetry` 包裹注册 → 补 telemetry。
- **仅迁移真实 `isError`/throw 路径（Codex WARNING-3）**：`GraphQueryEngine` 的 `findPath`/`getCommunity`/`getNode` 等在"未找到节点/无路径/空社区"时返回**成功 payload**（空数组 / message 字段），**不 throw**。这些 no-result 必须保持成功响应（不得转 `isError`），否则破坏 AC-5。本次只统一 `catch` 抛出的错误与空串校验。

### 3.2 telemetry 全覆盖（17/17）

- **11 个当前无 telemetry 的工具**（graph 6 + server 5）经 `withTelemetry` 注册层装饰获得采样。
- **6 个已有 telemetry 的工具**（file-nav 3 + agent-context 3）保持 handler 内部 `recordAndReturn`（保留 responseSummary/responseSamples 富采样），**不被 withTelemetry 二次包裹**。
- 净效果：每个工具调用恰好发射 **1 行** telemetry JSONL（无遗漏、无重复）。

### 3.3 agent-context 骨架收口

- 引入 `runAgentContextTool`，三 handler 改写为薄 body，消除 `_telStart` / `_telReqSize` 各 3 份 + `recordAndReturn` 散落调用（handleImpact 6 次）。
- 行为零变更：所有现有错误码、warning、success 字段逐字保持。

---

## 4. 数据结构（Data Structures）

- `ErrorCode` union：+1 码（`graph-query-failed`），既有码全保留。
- `TelemetryEntry`：**不变**（字段、可选性、JSONL 行格式全部保持）。
- `ToolResult` envelope：**不变**（`{ content: [{type,text}], isError? }`）；变的是错误时 `text` 内 JSON 的 key（`error`→`code`+`message`）。

---

## 5. 约束条件（Constraints）

- **C-1 向后兼容（硬约束）**：所有工具**成功响应**字段逐字节不变（宪法原则 XIII）。
- **C-2 错误 envelope 是 breaking change（已授权）**：错误响应从 `{error}` / 纯文本 → `{code, message}` 是有意的契约统一，是本 feature 的目的；现有断言旧形态的测试同步更新。
- **C-3 零新增运行时依赖**（宪法原则 VIII/X）：仅复用 `lib/tool-response.ts` + `lib/telemetry.ts`。
- **C-4 脱敏**（F171 FR-014 惯例延续，Codex CRITICAL-2 收窄范围）：**本次新迁移的错误路径（graph 6 + server 5）** 的 message/hint 不得含绝对路径 / stack / raw errno path。
  - **范围说明**：agent-context 三工具现有错误 message 含 `projectRoot`（如 `impact` 的 `graph.json 不存在 (projectRoot=…)`）属 **F177 之前的既有行为**。本 feature 是 behavior-preserve refactor（骨架化不改 message 文案），故**不在本次重新脱敏范围**；agent-context 的 message 脱敏作为已知遗留（见 §7），由后续 feature 评估。`projectRoot` 由客户端入参提供，回显不构成新增信息泄露。
- **C-5 telemetry 静默降级**：`SPECTRA_MCP_TELEMETRY_PATH` 未设置 → no-op；写入失败 → 静默吞，不影响 response（既有 telemetry.ts 行为，装饰器必须保持）。
- **C-6 单次调用恰发 1 行 telemetry**：禁止双发射（withTelemetry 与内部 recordAndReturn 互斥）。
- **C-7 YAGNI**（宪法原则 III）：错误码最小新增；不为假想未来需求预留抽象。

---

## 6. 边界条件（Edge Cases）

- **EC-1 telemetry 双发射**（最高风险）：若 `withTelemetry` 误包裹 file-nav/agent-context（已内部 recordAndReturn），单次调用发 2 行。**护栏**：测试断言每工具每调用 telemetry 行数 == 1；注册层显式区分"装饰器组"（11 工具）与"自采样组"（6 工具）。
- **EC-2 telemetry env 未设**：17 工具全部 no-op，response 不受影响（成功/错误均正常）。
- **EC-3 telemetry 写入失败**（磁盘满/权限）：静默吞，response 正常返回。
- **EC-4 graph engine 抛非 Error 对象**：`buildErrorResponse` message 需 `String(err)` 兜底（既有本地实现已处理，迁移后保持）。
- **EC-5 graph_hyperedges 空串 label/node_id**：返回 `invalid-input` + 明确 message（保留现有中文提示语义）。
- **EC-6 panoramic-query `!result.ok`**：是预期失败而非异常，迁移后必须置 `isError: true`（现状缺失 → 是隐性 bug，顺带修正）+ `code='invalid-input'`（非 `internal-error`，见 §2.4）。
- **EC-9 graph no-result vs error**：`graph_path` 两节点无连通路径、`graph_community` 空社区、`graph_node` keyword 无匹配等 → engine 返回成功 payload，**保持成功响应**（telemetry `errorCode` 缺省，非错误行）。只有 engine `throw` 与空串校验才是错误行。
- **EC-7 errorCode 提取**：`extractErrorCode` 从 `text` JSON 解析 `code` 字段；graph/server 工具迁移后其错误 text 含 `code` → telemetry 的 `errorCode` 字段自动填充（迁移前 graph 的 `{error}` 无 code → telemetry errorCode 恒空，本 feature 顺带修复）。
- **EC-8 detect_changes 已有 `buildErrorResponse(r.code, r.message, …, r.context)`**：agent-context 骨架化时保留 context 透传能力（runAgentContextTool body 返回的 ToolResult 已含 code，骨架不得吞 context）。

---

## 7. 技术债务（Tech Debt / 现状偏差修正）

- **修正 spec 输入中的不准确判断**：原始需求称"`tests/integration/graph-mcp-snapshot.test.ts`（双层 snapshot）response 形态变更需同步"。**实测**：该测试直接调 `GraphQueryEngine`，**不经 MCP handler**，不断言错误 envelope → **不受本次迁移影响**，无需改动。真正断言错误文案的是 `tests/unit/mcp-server.test.ts`（`prepare 失败`/`generate 失败`/`batch 失败`/`diff 失败` 4 处 `toContain`）。
- **顺带修复 EC-6**：panoramic-query `!result.ok` 路径缺 `isError`（隐性 bug）。
- **遗留-1**：server.ts 5 工具是否需比 `internal-error` 更细的错误码留 follow-up（本次 MVP 统一 `internal-error`）。
- **遗留-2（Codex CRITICAL-2）**：agent-context 三工具现有错误 message 含 `projectRoot`，与严格 C-4 脱敏不完全一致。本 feature behavior-preserve，不改文案；agent-context message 脱敏作为后续 feature 评估项（`projectRoot` 系客户端入参回显，非新增泄露，风险低）。

---

## 8. 测试覆盖（Test Coverage）

### TDD 顺序（M7 强制）

- **RED** `test(177)`：契约统一 + telemetry 覆盖测试 scaffolding（先 fail）
  - 断言 17/17 工具错误响应含统一 `code` 字段（无 `{error}` 残留、无纯文本错误残留）
  - 断言 telemetry JSONL 覆盖 17/17 工具（`SPECTRA_MCP_TELEMETRY_PATH` 采集全工具）
  - 断言每工具每次调用恰发 1 行 telemetry（EC-1 双发射护栏）
- **GREEN** `refactor(177)`：统一 MCP 响应契约 + withTelemetry 装饰器
- **REFACTOR** `refactor(177)`：收口 runAgentContextTool 骨架

### 必须更新的现有测试

- `tests/unit/mcp-server.test.ts`：`prepare/generate/batch/diff 失败` 4 处 `toContain('X 失败')` → 改断言 `{code:'internal-error'}` + `isError`
- graph-tools 相关测试若断言 `{error}` 形态 → 改 `{code}`（实扫描确认具体文件，RED 阶段定位）
- `tests/unit/mcp/telemetry.test.ts`：扩展覆盖 withTelemetry 装饰器 + 双发射互斥

### telemetry 17-工具调用矩阵（Codex WARNING-2 + INFO-2 修订，防假绿）

AC-2/AC-3 必须用**注册 handler 捕获**而非只测 `withTelemetry` helper，否则可能漏掉某未包裹工具或未捕获双发射。测试方案：

- 固化 17 工具名常量表（`prepare, generate, batch, diff, panoramic-query, graph_query, graph_node, graph_path, graph_community, graph_god_nodes, graph_hyperedges, impact, context, detect_changes, view_file, search_in_file, list_directory`）；若 server 注册数 ≠ 17 → 测试失败（防注册漂移）。
- 用 fake server（参照 `tests/integration/graph-community-projectroot.test.ts` 的 fake server 模式）捕获每个注册 handler。
- 设 `SPECTRA_MCP_TELEMETRY_PATH` 指向临时文件，逐个调用 17 handler 各一次（用 mock graph / 临时文件覆盖各工具的最小可达路径，错误或成功路径均可，只要触发一次 handler）。
- 断言：① JSONL 总行数 == 实际调用次数（每调用恰 1 行，锁死 EC-1 双发射）；② 每行 `toolName` 落在 17 名单内且 17 名单被全覆盖。

### 验收门槛

- 全量 `npx vitest run` 零失败（现有 3859+ 基线 + 新增/更新用例）
- `npm run build` 类型零错误
- `npm run repo:check` 零回归

---

## 9. 依赖关系（Dependencies）

- **被依赖**：F176（token-per-task 第二指标依赖本 feature 的 telemetry 全覆盖）
- **依赖**：无（建立在已落地的 F155 tool-response / F158 telemetry / F171 file-nav 骨架之上）
- **并行安全**：与 F178 写入路径 disjoint（F177 = `src/mcp/**` + 对应 tests）

---

## 验收标准（Acceptance Criteria）

- **AC-1**：所有 17 工具错误响应含统一 `code` 字段，无 `{error}` 残留、无纯文本错误残留。
- **AC-2**：telemetry JSONL 覆盖 17/17 工具（env 设置时每工具均可采集）。
- **AC-3**：每工具每次调用恰发 1 行 telemetry（无双发射）。
- **AC-4**：现有 3859+ vitest pass（含更新的 mcp-server / graph-tools / telemetry 测试）+ build + repo:check 零回归。
- **AC-5**：成功响应字段逐字节兼容（C-1 硬约束验证）。
- **AC-6**：graph-tools.ts 本地 `buildErrorResponse` 已删除；agent-context 三 handler 经 `runAgentContextTool` 骨架（样板消除可量化：`_telStart`/`_telReqSize` 各从 3 → ≤1）。
- **AC-7**：Codex 阶段性对抗审查 critical 全修。
