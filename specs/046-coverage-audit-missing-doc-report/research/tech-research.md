# Feature 046 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-20

---

## 1. 现有基础

- 044 已实现：
  - `DocGraph`
  - `missingSpecs`
  - `unlinkedSpecs`
  - `_doc-graph.json`
- batch 已经在一个位置同时掌握：
  - 文件级依赖图
  - 模块分组
  - `collectedModuleSpecs`
  - 输出目录路径
- `GeneratorRegistry.filterByContext()` 已提供“哪些 generator 适用于当前项目”的统一入口

## 2. 设计决策

1. **046 不重复扫描源码事实**
   - 直接消费 044 的 `DocGraph`
   - 缺文档统计回到 batch 的 `ModuleGroup` 聚合，而不是沿用文件级 `missingSpecs` 直接暴露给用户

2. **root 散文件单独拆成 coverage target**
   - batch 实际为 root 散文件逐个生成 spec
   - 如果仍按 `root` 聚合为一个模块，coverage 百分比会失真

3. **断链单独扫描 Markdown**
   - `DocGraph` 只知道“可达关系事实”，不知道磁盘上是否存在陈旧的手写链接
   - 046 需要额外扫描 `*.md` 中指向 `*.spec.md` 的链接来诊断 dangling links

4. **generator coverage 用约定映射落地**
   - 当前 `DocumentGenerator` 接口没有统一 `outputPath`
   - 因此 046 用稳定映射维护默认文件名：
     - `data-model.md`
     - `config-reference.md`
     - `workspace-index.md`
     - `cross-package-analysis.md`
     - `api-surface.md`
     - `runtime-topology.md`

## 3. 接入点

- 新增 `src/panoramic/coverage-auditor.ts`
- batch 在 044 `DocGraph` 写出后、index 生成前调用 auditor
- 输出：
  - `_coverage-report.md`
  - `_coverage-report.json`

## 4. 风险

- `GeneratorRegistry` 的 `isApplicable()` 包含同步和异步两类实现；046 必须走 `filterByContext()`，不能自己手写同步过滤
- 部分 generator 的适用性判断依赖 `ProjectContext.detectedLanguages` 的当前语义；046 不应私自修正这些 generator 的业务逻辑，只负责如实审计
- 断链检查当前采用“目标文件存在 + anchor 存在”的保守规则，足以覆盖 044 生成的 spec 链接
