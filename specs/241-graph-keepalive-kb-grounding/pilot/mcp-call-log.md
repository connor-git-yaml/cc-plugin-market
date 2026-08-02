# F241 Pilot — Spectra MCP 调用逐次记账（M-1 原始数据）

口径见 [measurement-design.md](measurement-design.md) M-1。**调用当下即记，不事后补。**
类别：`hit` / `fuzzy-hit` / `miss-structural` / `miss-empty`

## 分段 0：口径冻结前的探索性调用（诚实标注，**不计入** M-1 分母）

这些发生在 measurement-design.md 冻结之前，属于摸底。单列以免污染正式样本。

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 0-1 | `goal-loop-core.mjs::interpretImpact` | impact | `miss-structural` | fuzzyMatches 空；根因见 O-5（.mjs 不在图）|
| 0-2 | `src/kb-mcp/tools/kb-search.ts::kbSearch` | impact | （见 0-3）| symbol-not-found，但给出 3 个 fuzzy 候选 |
| 0-3 | `src/kb-mcp/tools/kb-search.ts::executeKbSearch` | impact | `fuzzy-hit`（结果存疑）| 按 0-2 的 fuzzy 候选纠正后精确解析成功，但返回 `directCallers: 0` 与 grep 结果矛盾（见 O-3）|

分段 0 小结：3 次调用 → 1 structural miss、1 fuzzy-hit（且结果可疑）。
图当时为 **stale**（`236de66` vs HEAD `2e3a4cd`），且返回体**不带任何 stale 标记**。

## 分段 1：正式样本（口径冻结后）

图状态：`fresh` @ `2e3a4cd`，6092 节点 / 8062 边，质量门 `pass`。

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 1-1 | `src/mcp/lib/telemetry.ts::withTelemetry` | impact | `hit` | 5 direct / 7 transitive，路径链正确 |
| 1-2 | `src/scaffold-kb/schema-compat.ts::hasProvenanceColumns` | impact | `hit` | 1 direct / 2 transitive，正确 |
| 1-3 | `src/scaffold-kb/sqlite-writer.ts` | impact | `miss-empty`（**存疑**）| 模块级 target 0 入边；疑同 O-7 形态，未逐一核实 → 按口径本应人工核对确认「确实该为空」，此处**未能确认**，报告时按可疑计 |
| 1-4 | `src/cli/commands/scaffold-kb.ts::runScaffoldKbCommand` | impact | （见 1-5）| symbol-not-found，给出 3 个 fuzzy 候选 |
| 1-5 | `src/cli/commands/scaffold-kb.ts::runScaffoldKb` | impact | `fuzzy-hit`（**结果错误**）| 按 fuzzy 纠正后精确解析成功，但返回 0 caller —— grep 证实 `src/cli/index.ts:223` 确有调用（O-7）|

**分段 1 中间小结（5 次调用）**：`hit` 2 / `fuzzy-hit` 1 / `miss-empty(存疑)` 1 / 未计类 1（1-4 并入 1-5）。

> **口径执行中发现的问题（如实记录，不回改定义）**：M-1 的四分类假设「精确解析成功 = 结果可用」，
> 但 1-3 / 1-5 暴露了第五种状态——**解析成功、返回非错误、但内容是错的**。
> 按冻结口径它们会被计入 `fuzzy-hit`/`miss-empty`，从而**高估**命中率。
> 报告 M-1 时必须同时给出「其中经交叉核对被证实为错误结果的次数」，
> 不得只报四分类数字。这条写进最终报告的「口径缺陷」节。

### 分段 1 续：plan 子代理的调用（编排器代记，来源=plan 子代理报告 + plan.md 附录）

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 1-6 | `src/kb-mcp/tools/kb-search.ts::executeKbSearch` | impact | `miss-empty`（**已证错误**）| 复现 O-3（0 caller 而实际有）|
| 1-7 | `goal-loop-core.mjs::interpretImpactResult` | context | `miss-structural` | 复现 O-5（.mjs 不在图）|
| 1-8 | `src/scaffold-kb/search-core.ts::searchKbCore` | impact | `hit`（**部分漏报**）| 返回 directCallers:2，grep 交叉核对实际 ≥4（scaffold-kb.ts / kb-search.ts / kb-api-lookup.ts 等）——见 O-8 |

### 分段 1 续：implement 批 1 子代理的调用（continuous capture，当下即记）

图状态：`fresh` @ `6950b08`。

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 1-9 | `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs::attemptLocalGraphBuild` | impact | `miss-structural` | 迁移前查 caller。symbol-not-found + fuzzyMatches 空。grep 交叉核对：同文件 `:576` 有生产调用、`tests/unit/graph-bootstrap-status.test.ts` 9 处引用 —— **确有调用方但图完全查不到**，D6「`.mjs` 结构性封顶为 0」在本 feature 主战场上的第一手复现 |
| 1-10 | `plugins/spec-driver/scripts/lib/goal-loop-core.mjs::parsePreservedConfigStates` | context | `miss-structural` | 写 `git-change-classifier` 前查解析范式。symbol-not-found + fuzzyMatches 空。grep 交叉核对：`goal-loop-cli.mjs:276` 有生产调用。同 O-5 |

> **批 1 的结构性事实（进报告）**：B4 接线代码 100% 落在 `plugins/**/*.mjs`，因此本批**每一次**
> 面向自身改动面的 MCP 查询都必然是 `miss-structural`。这不是采样偏置，是 O-5 的确定性后果。

### 分段 1 续：implement 批 2 子代理的调用（continuous capture，当下即记）

图状态：`fresh` @ `fd9af7f`。

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 1-11 | `src/kb-mcp/tools/kb-search.ts::executeKbSearch` | impact | `miss-empty`（**已证错误**）| 改 no-hit 挂点 1 前查影响面。`affected:[]`；grep 交叉核对同文件 `:147` `registerKbSearchTool` 确有生产调用 + 两个测试文件引用 —— **O-3 第三次复现**（0-3 / 1-6 之后），且这次图是 fresh，排除 stale 因素 |
| 1-12 | `src/kb-mcp/tools/kb-api-lookup.ts::executeKbApiLookup` | impact | `miss-empty`（**已证错误**）| 改挂点 2a/2b 前查影响面。`affected:[]`；grep 交叉核对同文件 `:256` `registerKbApiLookupTool` 确有生产调用 —— 与 1-11 同形态：**同文件内 `export function` 被同文件另一函数调用，这条边在图里缺失**（O-7 的更精确刻画）|
| 1-13 | `src/kb-mcp/lib/kb-locator.ts::loadKbContext` | impact | `hit`（**部分漏报**）| 为挂点补 `KbHandle.dbPath` 前查影响面。`directCallers:1`（`kb-mcp/index.ts::startKbMcpServer`）；grep 交叉核对生产调用方实为 **2**（漏掉 `src/cli/commands/scaffold-kb.ts:38`）+ 5 个测试文件 —— O-8 复现 |
| 1-14 | `src/cli/commands/scaffold-kb.ts::runQuery` | impact | `miss-structural` | 改挂点 3 前查影响面。symbol-not-found，fuzzy 三候选均非目标。根因：`runQuery` 是**模块内非 export 函数**，图只收 export symbol → file-private 函数结构性不可查（O-5 的 TS 侧同构形态）；grep 核对同文件 `:167` 有真实调用 |
| 1-15 | `src/cli/commands/scaffold-kb.ts::runScaffoldKb` | impact | `miss-empty`（**已证错误**）| 改 op dispatch（T045）前查影响面。`affected:[]`；grep 核对 `src/cli/index.ts:223` 确有生产调用。**与 1-5 同一 target、同一错误**，但两次分处 `fresh@2e3a4cd` 与 `fresh@fd9af7f` 两版图 → O-7 是**稳定缺陷**，不是建图抖动 |
| 1-16 | `executeKbSearch` | impact | （重复 1-11，M-3 包）| 0 caller 已证错误 |
| 1-17 | `executeKbApiLookup` | impact | （重复 1-12，M-3 包）| 0 caller 已证错误 |
| 1-18 | `loadKbContext` | impact | （重复 1-13，M-3 包）| 1 caller 部分漏报 |
| 1-19 | `tokenizer.ts::tokenize` | context | `hit` | 4 callers；图快照早于批 2 新增调用方，相对快照非错 |
| 1-20 | `src/scaffold-kb/tokenizer.ts::tokenize` | impact | `hit` | M-3 整改：抽 `normalizeUnicode` 前查 `tokenize` 上游 blast radius。`directCallers:4 / transitive:7`（`matchEntities` / `extractKeywords` / `sanitizeQuery` / `normalizeForIndex` → `executeKbApiLookup` / `searchKbCore` / `buildChunksDbBytes`）；与 grep 交叉核对一致，据此判定「纯提取重构、零行为变化」，并由全量 6139 用例覆盖这些消费方 |

### 分段 1 续：implement 批 3 子代理的调用（continuous capture，当下即记）

图状态：`fresh` @ `bc3bfb5`（**批 2 新增代码首次进入图快照**）。

| # | target | 工具 | 类别 | 备注 |
|---|--------|------|------|------|
| 1-21 | `src/kb-mcp/tools/kb-search.ts::executeKbSearch` | impact | `miss-empty`（**已证错误**）| T063 改 payload 前查影响面。`affected:[]`；grep 核对同文件 `:162` `registerKbSearchTool` 确有生产调用 —— O-7 **第四次**复现，跨到第三版图（`fresh@bc3bfb5`）仍同错 |
| 1-22 | `src/kb-mcp/tools/kb-api-lookup.ts::executeKbApiLookup` | impact | `miss-empty`（**已证错误**）| T064 改 payload 前查影响面。`affected:[]`；grep 核对同文件 `:282` 确有生产调用。与 1-21 同形态 |
| 1-23 | `src/scaffold-kb/nohit-recorder.ts::recordNoHit` | impact | `hit`（**部分漏报**）| **批 2 新代码入图覆盖检验**。`directCallers:2`（`executeKbSearch` / `executeKbApiLookup`）——批 2 新模块本体 + 其跨文件被调边**已正确建图**，说明「新写模块能否被图覆盖」答案是**能**；漏的两处（`documentFallback` / `runQuery`）均为 file-private 非 export 函数，属 O-5 已知结构性盲区，非新形态 |
| 1-24 | `src/scaffold-kb/schema-compat.ts::hasProvenanceColumns` | context | `hit` | T056 直接 import 前查 360°。`callers:[provenanceSelectFragment]` / `callees:[queryRows]` / `imports:[sqlite-engine]`，与 grep 完全一致。**这是对 O-7 的反证**：同文件 export→export 调用在此**建了边** |

> **O-7 的形态收窄（批 3 新增观测，进报告）**：1-24 证明「同文件两个 export 互调」本身**会**建边。
> 1-11/1-12/1-21/1-22 四次 `miss-empty` 的真实共因是调用点位于**嵌套箭头函数闭包内**
> （`withTelemetry('kb_search', async (args) => executeKbSearch(...))`），调用未归属到外层
> export symbol。O-7 应由「同文件 export 互调不建边」修正为「**嵌套闭包内的调用不归属其外层 symbol**」——
> 这是一个更窄、更可行动的缺陷描述（对应的修法是 callee 归属沿 AST 向上找最近的 named symbol，
> 而非在遇到函数表达式时中断）。
