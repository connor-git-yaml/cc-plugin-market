# Feature 181 — import-resolver 单一权威收口 · 残留扫描报告（Phase 4/5）

全仓扫描两套 resolver 的全部调用点与已删除标识符，确认单一权威收口无遗漏。

## 扫描范围
`src/` + `tests/` + `scripts/` + `plugins/`（`.ts/.mjs/.js`）。

## 1. 已删除死代码标识符 — 零代码引用 ✅

| 标识符 | 全仓代码引用 | 结论 |
|--------|------------|------|
| `resolveImportsForFile` | 0 | ✅ 已删（含测试块） |
| `detectImportType` | 0 | ✅ 已删（含测试块 + code-skeleton.ts:126 注释修正） |
| `ResolveTsJsImportOptions` | 0 | ✅ 已删（随旧 core resolveTsJsImport） |
| `loadTsconfigAliases` | 0 | ✅ 已删（module-derivation，被 buildTsConfigContext 取代） |
| 旧 `ImportType` 类型 import | 0 | ✅ 已删（仅 ImportSemanticType / ModuleImportType 存留，与本次无关） |

## 2. `resolveTsJsImport` 单一权威 ✅

- **定义**：唯一在 `src/core/import-resolver.ts:220`（返回 ResolveResult）。
- **生产消费**：
  - AST 路径（ast-analyzer / tree-sitter-analyzer / tree-sitter-fallback）经 `resolveTsJsImportToAbsolute` 封装调用（同目录 `./import-resolver.js`）。
  - batch 路径 `batch-orchestrator.ts` 从 `core/import-resolver.js` import `resolveTsJsImport` + `findNearestTsConfig` + `buildTsConfigContext`。
  - module-derivation 经 `buildTsConfigContext` + `analyzeFileInternal(tsConfigContext)`。
- **kg/import-resolver.ts**：已无 TS resolver，仅剩 `resolvePythonImport`（下行 import core 的 `ResolveResult`/`toPosix`/`isInsideProjectRoot`，方向 kg→core 干净，无环）。
- `ResolveResult` 在 kg 保留 1 行 `export type` re-export（back-compat：`resolvePythonImport` 返回该类型，历史下游可能从 kg 路径 import）。

## 3. 层级方向 ✅
- `core/import-resolver.ts` 仅 import `node:fs` / `node:path` / `ts-morph`，不依赖 kg。
- `knowledge-graph/*`、`batch/*`、`adapters/*` 下行 import core。无 core→kg 反向 runtime import，无循环依赖（Codex INFO#5 已证）。

## 4. 注释/文档同步 ✅
- `models/code-skeleton.ts:126`：失真注释（"由 detectImportType 派生"）→ 改为"各 analyzer 行内派生"。
- `tree-sitter-analyzer.ts` postProcess 注释：`resolveTsJsImport` → `import-resolver`（实际调 `resolveTsJsImportToAbsolute`）。
- `core/import-resolver.ts` 顶部注释：移除对已删 `loadTsconfigAliases` 的引用。

## 结论
**残留数 = 0**。两套 resolver 已收口为单一权威 `core/import-resolver.ts`；死代码全部删除；无 dangling import；无层级倒置/循环依赖。
