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
