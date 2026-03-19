# Implementation Plan: 文档图谱与交叉引用索引

## 目标

在不新增新的用户命令的前提下，为现有 batch/spec 渲染链路补上文档图谱与自动互链能力，并为 046 复用提供稳定的序列化输出。

## 范围

- 新增文档图谱构建模块
- 新增交叉引用索引转换模块
- 扩展 `ModuleSpec` 结构与模板
- 在 batch 完成模块 spec 收集后接入 044
- 输出 doc-graph 调试 JSON

## 非目标

- 不实现 CoverageAuditor（046）
- 不实现新的 panoramic `DocumentGenerator`
- 不改造 CLI 参数面

## 设计

### 1. 新增基础设施模块

- `src/panoramic/doc-graph-builder.ts`
  - 输入：
    - `DependencyGraph`
    - `ModuleSpec[]`
    - 既有 spec metadata（从磁盘解析）
  - 输出：
    - sourceToSpec 映射
    - sameModuleRefs / crossModuleRefs
    - missingSpecs / unlinkedSpecs
    - JSON serializable `DocGraph`

- `src/panoramic/cross-reference-index.ts`
  - 将 `DocGraph` 转换为每个 `ModuleSpec` 的结构化交叉引用区块
  - 仅负责渲染前增强，不做 coverage 判定

### 2. 扩展 ModuleSpec

- `src/models/module-spec.ts`
  - 新增交叉引用相关 schema/type
- `templates/module-spec.hbs`
  - 新增稳定 anchor：`module-spec`
  - 新增“附录：关联 Specs”区块
  - 新增互链标记 comment，供磁盘扫描识别 linked/unlinked

### 3. batch 集成

- `src/batch/batch-orchestrator.ts`
  - 在 `collectedModuleSpecs` 收集完成后构建 DocGraph
  - 对当前 run 中的 `ModuleSpec` 注入 CrossReferenceIndex
  - 重渲染这些 spec 到磁盘
  - 写出 doc-graph 调试 JSON

## 文件变更

### 新增

- `src/panoramic/doc-graph-builder.ts`
- `src/panoramic/cross-reference-index.ts`
- `tests/panoramic/doc-graph-builder.test.ts`
- `tests/panoramic/cross-reference-index.test.ts`
- `tests/integration/batch-doc-graph.test.ts`

### 修改

- `src/models/module-spec.ts`
- `src/generator/spec-renderer.ts`
- `templates/module-spec.hbs`
- `src/batch/batch-orchestrator.ts`
- 相关 render / index / orchestrator tests

## 验证策略

1. 先用 unit test 锁定：
   - sourceTarget / relatedFiles 映射
   - missing/unlinked 判定
   - same-module / cross-module 引用分类
2. 再用 render test 锁定模板输出：
   - anchor
   - 关联 spec 区块
   - 自动标记
3. 最后做 batch 集成验证：
   - fixture 项目生成 spec
   - 输出 doc-graph JSON
   - spec 中有互链
