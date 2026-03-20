# Research Summary: Batch 全景项目文档套件与架构叙事输出

## 结论

当前缺口不是 generator 本身不存在，而是 `reverse-spec batch` 没有把已注册的项目级 panoramic generators 接入主编排；同时缺少一份专门面向人类阅读的技术架构叙事文档。

## 现状事实

1. `src/panoramic/generator-registry.ts` 已注册 `config-reference`、`data-model`、`workspace-index`、`cross-package-deps`、`api-surface`、`runtime-topology`、`architecture-overview`、`pattern-hints`、`event-surface`、`troubleshooting`。
2. `src/batch/batch-orchestrator.ts` 当前只编排模块级 `generateSpec()`，随后写 `_doc-graph.json`、`_coverage-report.*`、`_delta-report.*`、`_index.spec.md`。
3. `src/panoramic/coverage-auditor.ts` 已经按 applicable generators 统计“应该生成哪些项目级文档”，但 batch 目前并未实际写出这些文件，因此 coverage audit 与真实输出不一致。
4. `templates/architecture-overview.hbs` 已提供系统上下文、部署视图、分层视图、部署单元和模块职责摘要，但它偏结构化视图，不是完整的架构分析叙事。

## 技术判断

- 项目级 panoramic 输出最适合在 batch 末尾统一编排，因为此时已经拥有：
  - 完整的项目扫描结果
  - 模块级 spec
  - doc graph / coverage / delta 所需的上下文
- 新增“架构叙事文档”时，最稳定的事实源应优先选择：
  - `ModuleSpec.sections.intent/businessLogic/dependencies`
  - `baselineSkeleton.exports/members`
  - 已生成的 `architecture-overview` / `runtime-topology` 等结构化输出
- 为保证 `--incremental` 模式质量，项目级输出不能只依赖本次新生成的 `ModuleSpec[]`；还需要复用输出目录中已有的 module spec 事实。

## 实施原则

- 不改变现有模块级 batch 语义，只在后处理阶段补项目级输出。
- 输出文件命名要抽成共享映射，避免 batch 与 coverage audit 再次漂移。
- 架构叙事文档优先 AST / spec 驱动，允许 LLM 质量增强作为后续演进，而不是当前实现的硬依赖。
