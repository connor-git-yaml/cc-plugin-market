# Feature 046 调研结论

**调研模式**: tech-only
**日期**: 2026-03-20
**结论**: 046 应直接复用 044 的 `DocGraph` 作为事实底座，在 batch 结束阶段追加 `CoverageAuditor`，输出用户可读的覆盖率审计报告与结构化 JSON。模块统计应基于 batch 的 `ModuleGroup` 聚合，而不是直接暴露文件级 `missingSpecs`。

## 关键发现

- 044 已经提供 `DocGraph`、`missingSpecs`、`unlinkedSpecs` 和 `_doc-graph.json`
- `GeneratorRegistry.filterByContext()` 已能判断哪些 project-level generator 在当前项目中“应当适用”
- 当前代码库没有现成的 coverage audit 或断链扫描实现
- `runBatch()` 已掌握：
  - `groupResult.groups`
  - `processingOrder`
  - `collectedModuleSpecs`
  - `resolvedOutputDir`

## 设计结论

1. 046 不新建 CLI；直接接入 `runBatch()`
2. 新增 `CoverageAuditor`
3. 输出两个文件：
   - `_coverage-report.md`
   - `_coverage-report.json`
4. 审计分三层：
   - 模块 coverage
   - spec 断链 / 缺链 / 低置信度
   - generator coverage（按 registry 适用项统计）
