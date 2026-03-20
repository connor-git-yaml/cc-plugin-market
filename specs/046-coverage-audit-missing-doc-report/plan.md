# Implementation Plan: 覆盖率审计与缺失文档报告

## 目标

在 044 的基础上补齐 coverage audit，将 batch 已掌握的事实统一转成：
- 用户可读的缺失文档报告
- 结构化 JSON 审计结果
- 后续 049 可直接复用的模块 / generator coverage 统计

## 范围

- 新增 `CoverageAuditor`
- 新增 `coverage-report.hbs`
- 扩展 044 的 spec metadata 读取，补充 `confidence`
- 在 batch 中接入 coverage audit 产物写入
- 补 unit / integration tests

## 非目标

- 不实现 049 的差量传播逻辑
- 不新增新的 CLI / MCP 命令
- 不改造 DocumentGenerator 接口增加 outputPath 契约

## 设计

### 1. CoverageAuditor

- 新文件：`src/panoramic/coverage-auditor.ts`
- 输入：
  - `projectRoot`
  - `outputDir`
  - `ProjectContext`
  - `DocGraph`
  - `ModuleGroup[]`
- 输出：
  - summary
  - module coverage entries
  - generator coverage entries
  - dangling link diagnostics
  - JSON serializable audit object

### 2. 规则

- 模块 coverage 基准：`ModuleGroup[]`
- documented：存在对应 spec
- missing-doc：该模块无 spec owner
- missing-links：spec 存在但未互链
- dangling-links：spec 中存在指向不存在 `*.spec.md` 的链接
- low-confidence：spec frontmatter 的 `confidence` 为 `low`

### 3. generator coverage

- 复用 `buildProjectContext()` + `GeneratorRegistry.filterByContext()`
- 维护 generatorId -> 默认输出文件名映射
- 统计 `expectedCount / generatedCount / missingCount`
- 模块级 `module-spec` 作为单独 coverage bucket

### 4. batch 集成

- 044 的 `DocGraph` 生成之后立即调用 `CoverageAuditor`
- 写出：
  - `_coverage-report.md`
  - `_coverage-report.json`
- `BatchResult` 新增 coverage report 路径

## 文件变更

### 新增

- `src/panoramic/coverage-auditor.ts`
- `templates/coverage-report.hbs`
- `tests/panoramic/coverage-auditor.test.ts`
- `tests/integration/batch-coverage-report.test.ts`

### 修改

- `src/panoramic/doc-graph-builder.ts`
- `src/panoramic/index.ts`
- `src/batch/batch-orchestrator.ts`
- 相关 batch / template / renderer tests
