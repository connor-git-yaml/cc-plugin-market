# F241 Pilot 基线观测（对照组：现状 = 无 B4 接线）

采集时间：2026-08-03（本 feature 自身的 spec 阶段，作为 pilot 载体）
worktree HEAD：2e3a4cd / 分支 claude/f241-keepalive-kb-grounding-54ef99

## O-1 图 freshness 现状：stale，且消费侧完全无感

`spectra graph-quality --json` 实测（只读）：

| 指标 | 值 | 状态 |
|------|-----|------|
| duplicateCanonicalId | 0 组 | pass |
| containsCoverage | 5096/5096 = 1.0 | pass |
| orphanRatio | offending 0（allNodeZeroDegree 2.12%）| pass |
| danglingEdges | 0 | pass |
| legacyAndIgnoredNodes | 0 | pass |
| **freshness** | **stale**（recorded `236de66` vs HEAD `2e3a4cd`）| **warning** |
| overallVerdict | pass-with-warnings | — |

**关键观察**：F217 质量门六项里五项 pass，唯一告警就是 freshness=stale。
但 **MCP 工具侧（impact / context）在 stale 图上照常返回结果，返回体内没有任何
freshness / stale 标记**——消费方（goal_loop、implement 子代理、人）无从得知
自己拿到的影响面是过期的。这就是 B4③ 「stale 必须记 degraded reason」的实证缺口。

## O-2 grounding 命中率基线（symbol 解析）

本次 spec 阶段实际发起的 Spectra MCP 调用与命中情况：

| # | target | 结果 | 备注 |
|---|--------|------|------|
| 1 | `goal-loop-core.mjs::interpretImpact` | ❌ symbol-not-found，fuzzyMatches **空** | §7.5.4 已登记盲区：`plugins/**/*.mjs` 整体不在图内 |
| 2 | `src/kb-mcp/tools/kb-search.ts::kbSearch` | ❌ symbol-not-found，但给出 3 个 fuzzyMatches | 名字猜错，fuzzy 提供了可用候选 |
| 3 | `src/kb-mcp/tools/kb-search.ts::executeKbSearch` | 见下 | 按 fuzzy 候选纠正后重试 |

**基线结论（诚实标注）**：
- 对 `src/**` TypeScript：symbol 名猜错时 fuzzyMatches 能救回来（1 次往返代价）
- 对 `plugins/**/*.mjs`：**结构性 0 命中**，fuzzyMatches 也为空 → 只能退回 Grep/Read
- 本 feature 的改动面**横跨** `src/**`（轨道 E）与 `plugins/**/*.mjs`（B4 goal_loop 侧），
  因此是检验 grounding 覆盖缺口的合适载体

## O-3 impact 漏报同文件内联回调 caller（待 fresh 图复核）

`impact(src/kb-mcp/tools/kb-search.ts::executeKbSearch)` 返回
`affected: [], directCallers: 0, riskTier: "low"`。

但 `src/kb-mcp/tools/kb-search.ts:147` 确实存在调用方：
`withTelemetry('kb_search', async (args) => executeKbSearch(ctx, args as KbSearchParams))`
——同文件内、包在 inline arrow callback 里。

**两种可能，尚未区分**：(a) 图 stale（记录于 236de66）导致的过期数据；
(b) AST 抽取对「call expression 实参位置的 arrow function 体内调用」漏建 calls 边。
→ 本 feature 重建图后必须复核；若 (b) 成立则是 grounding 覆盖的真实缺陷，
   且正是「impact 说低风险其实有 caller」这类**误导性**降级（比 no-hit 更危险）。

**注意这条本身就是 O-1 的后果链**：stale 图上 impact 不带任何 freshness 标记，
使用者无法判断 `directCallers: 0` 该不该信。

## O-4 既有 telemetry 基础设施盘点（对 E① 的约束）

`src/mcp/lib/telemetry.ts`（F158 / F171 / F177）已提供：
- `writeTelemetry`（JSONL append）、`recordAndReturn`、`withTelemetry` 注册层装饰器
- 每次 handler 调用恰写 1 行（F177 锁死双发射不变量，telemetry.ts:112）

**但对 coverage-gap 有三个硬缺口**：
1. **默认不采集**：仅当 env `SPECTRA_MCP_TELEMETRY_PATH` 非空才写（telemetry.ts:40-41），
   这是评测用途；生产路径下 no-hit 事件根本没落盘 → 无数据可聚合
2. **不记录 query**：`TelemetryEntry` 只有 requestSize/responseSize/durationMs/errorCode
   （telemetry.ts:18-32），没有查询词 → 就算有数据也**无法**产出"缺什么文档"的 backlog
3. **no-hit 不是错误**：空结果走正常返回、无 errorCode，现有字段区分不出
   "命中 0 条" 与 "命中 5 条"（`responseSummary` 存在但 `withTelemetry` 不传，telemetry.ts:133）

→ E① 必须新增"记录 query 词"的能力，而这恰恰是**脱敏红线**所在：查询串可能含敏感信息。
  两者是同一处设计的正反面，不能分开决策。

## O-5 §7.5.4「plugins/**/*.mjs 不在图内」根因定位：扩展名缺口，非目录排除

M9 §7.5.4 把这条登记为「覆盖面盲区」但未定位根因。本轮取证：

| 事实 | 证据 |
|------|------|
| `plugins/` 下有 **84 个 `.mjs`**，`.ts/.js/.cjs` 各 0 个 | `find plugins -name "*.mjs" -not -path "*/node_modules/*" \| wc -l` |
| `plugins/` **未被 gitignore** | `git check-ignore` 无命中 |
| `plugins/` **不在** `TSJS_SKELETON_IGNORE_DIRS` | source-discovery.ts:385-389 |
| 图中 `plugins/` 前缀节点 = **0**；按扩展名分布 `{ts:5839, py:159, go:40, java:50}`，**`.mjs` 一个都没有** | 直接解析 specs/_meta/graph.json（6088 节点）|
| **根因**：`walkTsJsFiles` 的扩展名白名单只收 `.ts/.tsx/.js/.jsx` | source-discovery.ts:509-514 |

**结论**：这不是「插件目录被有意排除」，而是 TS/JS walker 的扩展名集合漏了 `.mjs`（与 `.cjs`）。
仓内所有 `.mjs` 代码（spec-driver 插件全部脚本 + core 纯函数）因此结构性不可查询。

**对本 feature 的直接影响**：B4 的 goal_loop 接线全部落在 `plugins/spec-driver/scripts/lib/*.mjs`，
pilot 要测的 grounding 命中率在这部分**结构性封顶为 0**（O-2 已实测）。
→ 是否在 F241 内纳入 `.mjs`，是 spec 阶段必须拍板的开放问题（见 spec Open Questions）。

---

## O-3 复核结论（fresh 图上重测）：**确认为真缺陷，不是 staleness**

重建图后（4.4s，节点 6092 / 边 8062，`freshness: fresh` @ `2e3a4cd`，`overallVerdict: pass`）重测：

- `impact(executeKbSearch)` 仍 → `directCallers: 0, riskTier: "low"`
- `context(executeKbSearch)` → `callers: []`，但 `callees` 有 6 条（出边正常）
- 直接查 graph.json 原始 links：`executeKbSearch` 入边**只有 1 条 `contains`**，零 `calls` 入边

**根因锁定**（kb-search.ts:137-148）：
```ts
server.tool('kb_search', DESC, {…},
  withTelemetry('kb_search', async (args) => executeKbSearch(ctx, args as KbSearchParams)));
```
图里确实建了 `registerKbSearchTool → withTelemetry`（实参位置的**直接**调用被抓到），
但**没有** `registerKbSearchTool → executeKbSearch`——调用抽取器**不下钻实参里箭头函数的函数体**。

**危害等级高于 no-hit**：no-hit 会让人退回 Grep（自知无知）；
而这里 `impact` 自信地回答「0 caller / 低风险」，**使用者不知道自己被误导**。
F219 记忆里的同构教训：「forEachChild 不枚举 token 是漏报根因」——又一次遍历覆盖缺口。

**对 F241 spec 的直接约束**：B4③ 原文是「goal_loop 仅在 graph freshness 通过后消费 impact」。
本条实证说明 **freshness 通过 ≠ impact 可信**——图可以既 fresh 又漏边。
spec 必须避免 over-claim「fresh 就可信」，degraded reason 词汇表要能表达
「图是新的，但覆盖面本身有已知缺口」这一态。

**处置**：调用抽取器修复**不在 F241 范围内**（属 Spectra AST 抽取面，另开）。本轮只登记 + 约束 spec 措辞。

## O-6 `graphAvailability` 与 `freshness` 不是独立维度（实测）

spec FR-003 把两者当作独立输入维度并声称穷举 `3×3×4×2×2 = 144` 组合。实测 `spectra graph-quality --json --graph <path>`：

| 图状态 | freshness.state | overallVerdict | exit |
|--------|-----------------|----------------|------|
| 文件不存在 | `unknown-provenance` | `cannot-assess` | 2 |
| 文件存在但 JSON 损坏 | `unknown-provenance` | `cannot-assess` | 2 |
| 正常（重建后） | `fresh` | `pass` | 0 |

**含义**：`graphAvailability ∈ {missing, corrupt}` 时 `freshness` **必然**是 `unknown-provenance`，
`{missing,corrupt} × {fresh,dirty,stale}` 共 6 类组合在现实中**不可达**。

**对矩阵的影响（好消息）**：FR-003 把 `graphAvailability` 判定（行 3-6）排在 `freshness` 判定（行 7-11）**之前**，
所以 missing/corrupt 先被截住，不会误落到行 11 —— **求值顺序恰好救了这个耦合**。

**需要修正的是措辞而非逻辑**：spec 不应暗示 144 组合都是可达状态。
穷举 144 组合作为**防御性单测**是有价值的（保证无 `undefined`/无 throw），
但必须显式标注其中 6 类为 unreachable-by-construction，避免后人误以为它们是真实场景而据此改动求值顺序
——**一旦有人把 freshness 判定挪到 graphAvailability 之前，这 6 类立刻变成真 bug**。
建议在单测里给这 6 类加显式注释锁住该不变量。

## O-7 第二类调用漏报形态：动态 `await import()` 解构（fresh 图上实测）

采集 M-2 预测集时又撞到一例，形态与 O-3 **不同**：

- `impact(src/cli/commands/scaffold-kb.ts::runScaffoldKb)` → `directCallers: 0, riskTier: "low"`
- 但 `src/cli/index.ts:222-223` 明确调用它：
  ```ts
  const { runScaffoldKb } = await import('./commands/scaffold-kb.js');
  await runScaffoldKb(command);
  ```

`src/scaffold-kb/sqlite-writer.ts`（模块级 target）同样返回 0 入边，疑似同源，未逐一核实。

**至此已实证两类不同的 calls 边漏建形态**：
1. **O-3**：实参位置 arrow function **函数体内**的调用
2. **O-7**：经 **动态 `await import()` 解构**取得的符号的调用

两者失败模式相同且都属**误导型**：`impact` 自信返回「0 caller / 低风险」。
CLI 命令分发在本仓大量使用 O-7 这个形态（`src/cli/index.ts` 的整个 switch 都是 lazy import），
意味着**所有 CLI 命令入口函数**在图里可能都显示为「无调用方」。

**对比同轮的正确案例**（说明抽取器并非全面失效）：
- `impact(src/mcp/lib/telemetry.ts::withTelemetry)` → 5 direct / 7 transitive，路径链完整正确
- `impact(src/scaffold-kb/schema-compat.ts::hasProvenanceColumns)` → 1 direct / 2 transitive，正确

→ 缺口是**特定语法形态**的，不是普遍性失效。这提高了修复的可行性，也提高了「不修就长期误导」的代价。

**处置**：仍不在 F241 范围内（属 Spectra AST 抽取面），与 O-3 合并为同一个 follow-up。

## O-8 第三类形态：hit 但**部分漏报**（plan 子代理发现，编排器 grep 复核）

`impact(src/scaffold-kb/search-core.ts::searchKbCore)` 返回 `directCallers: 2`，
但 grep 交叉核对实际调用方 ≥ 4：`src/cli/commands/scaffold-kb.ts:55-56`、
`src/kb-mcp/tools/kb-search.ts:66/70`、`src/kb-mcp/tools/kb-api-lookup.ts`。

**与 O-3/O-7 的区别**：不是零命中，是**计数低估**——最难被使用者察觉的形态
（有结果就更不会怀疑）。M-1 四分类把它计成 `hit`，报告时必须在「口径缺陷」节
连同 1-3/1-5 一起给出「经交叉核对证实低估/错误的 hit 数」。
详细归因见 plan.md 附录；处置同 O-3/O-7：并入既有 follow-up 卡范围，本 feature 不修。
