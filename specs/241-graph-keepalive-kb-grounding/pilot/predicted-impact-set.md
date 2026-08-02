# F241 Pilot — M-2 预测影响集（**冻结于 implement 开始之前**）

口径见 [measurement-design.md](measurement-design.md) M-2。
本文件在**任何 implement 代码改动之前**写成；implement 完成后与实际 `git diff --name-only` 比对，
**不允许回改本文件**。

## 采集条件

| 项 | 值 |
|----|-----|
| 图状态 | `freshness: fresh`，`sourceCommit = 2e3a4cd`（= worktree HEAD）|
| 图规模 | 6092 节点 / 8062 边（重建耗时 4.4s）|
| 质量门 | `overallVerdict: pass`，六指标全 pass |
| 工具 | `mcp__plugin_spectra_spectra__impact`，`depth=2`，`direction=upstream`，`minConfidence=0.65` |

## 查询锚点与结果

| 锚点（spec 指明的改动落点） | 结果 | 预测出的受影响文件 |
|------|------|----------|
| `src/mcp/lib/telemetry.ts::withTelemetry` | ✅ 5 direct / 7 transitive | `src/kb-mcp/tools/kb-api-lookup.ts`、`src/kb-mcp/tools/kb-doc-lookup.ts`、`src/kb-mcp/tools/kb-search.ts`、`src/mcp/graph-tools.ts`、`src/mcp/server.ts`、`src/kb-mcp/server.ts`、`src/mcp/index.ts` |
| `src/scaffold-kb/schema-compat.ts::hasProvenanceColumns` | ✅ 1 direct / 2 transitive | `src/scaffold-kb/schema-compat.ts`（同文件）、`src/scaffold-kb/search-core.ts` |
| `src/cli/commands/scaffold-kb.ts::runScaffoldKb` | ⚠️ 0 caller（**已证实为漏报**，见 O-7）| —（实际调用方 `src/cli/index.ts` 未被预测到）|
| `src/scaffold-kb/sqlite-writer.ts` | ⚠️ 0 入边（疑同 O-7，未逐一核实）| — |
| `plugins/spec-driver/scripts/lib/goal-loop-core.mjs::interpretImpact` | ❌ symbol-not-found，fuzzy 空（O-5 结构性）| —（`plugins/**` 整体不在图内）|

## 冻结的预测集（M-2 分子来源）

```
src/kb-mcp/tools/kb-api-lookup.ts
src/kb-mcp/tools/kb-doc-lookup.ts
src/kb-mcp/tools/kb-search.ts
src/kb-mcp/server.ts
src/mcp/graph-tools.ts
src/mcp/server.ts
src/mcp/index.ts
src/mcp/lib/telemetry.ts
src/scaffold-kb/schema-compat.ts
src/scaffold-kb/search-core.ts
```

共 **10 个文件**。

## 预先声明的已知偏置（取数前写，非事后辩解）

1. **预测集偏小且偏 `src/**`**：B4 的改动全部落在 `plugins/spec-driver/**/*.mjs`，
   该目录整体不在图内（O-5），因此**预测集对 B4 部分的贡献恒为 0**。
   M-2 的 coverage 会被这一结构性缺口系统性压低——这是**真实缺陷的度量**，不是测量噪声，
   报告时不得以「排除 plugins 后 coverage 更好看」的方式重新切分。
2. **两类漏报（O-3 / O-7）会进一步压低 coverage**：CLI 入口与回调内调用的 caller 都预测不到。
3. **纯新增文件将从分母中剔除**（按冻结口径）——B4 与 E 都会新增模块，
   这部分不计入 M-2，但**必须在报告里列出被剔除的文件数**，避免「靠新增文件多来抬高 coverage」。
