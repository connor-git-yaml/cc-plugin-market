# Feature Specification: 覆盖率审计与缺失文档报告

**Feature Branch**: `046-coverage-audit-missing-doc-report`
**Created**: 2026-03-20
**Status**: Implemented
**Input**: User description: "推进 046，基于 044 的 DocGraph 实现 coverage audit"

---

## User Scenarios & Testing

### User Story 1 - 模块覆盖率审计 (Priority: P1)

作为维护者，我希望 batch 完成后能直接看到“哪些模块已有文档、哪些模块缺文档、哪些模块只有文档但互链缺失”，这样我可以马上定位文档覆盖缺口，而不用手工比对源码和 `specs/`。

**Independent Test**: 对一个包含“已文档化模块 + 缺文档模块 + 未互链模块”的 fixture 运行 batch 审计，验证覆盖率统计和模块状态分类正确。

### User Story 2 - 断链 / 缺链 / 低置信度诊断 (Priority: P1)

作为维护者，我希望审计报告能区分“缺少文档”“缺少交叉引用”“存在断链”“低置信度文档”四类问题，这样我可以按优先级修复，而不是只看到一个模糊的 coverage 百分比。

**Independent Test**: 对一组已有 spec 人工写入一个无效 `*.spec.md#...` 链接，并包含一个 `confidence: low` 的 spec，验证审计报告能同时列出 dangling links 和 low-confidence 项。

### User Story 3 - 按 generator 类型和模块层级统计 (Priority: P2)

作为实现后续 049 的开发者，我希望 coverage audit 还能按 generator 类型和模块层级给出统计，这样后续做差量重生成时可以复用这份统计结构。

**Independent Test**: 在 registry 中启用适用 generators，并对 batch 结果生成审计，验证报告中包含 generator coverage 表和按层级聚合的模块统计。

---

## Edge Cases

- `force=false` 跳过的旧 spec 仍应纳入 coverage 统计，但不能被偷偷重写
- 断链检查只针对指向 `*.spec.md` 的 Markdown 链接，普通外链不计入问题
- 一个模块可能同时存在多个问题；报告需要保留 `issues[]`，不能只存单一状态
- project-level generator 目前没有统一 outputPath 接口，046 需要以约定映射维护默认输出文件名

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `CoverageAuditor`，输入至少包含 `DocGraph`、`ModuleGroup[]`、`ProjectContext`、输出目录路径。
- **FR-002**: 系统 MUST 以 batch 的 `ModuleGroup` 作为“应文档化模块”的统计基准。
- **FR-003**: 系统 MUST 将模块状态至少分为 `documented`、`missing-doc`、`missing-links`、`dangling-links`、`low-confidence` 五类，并允许同一模块记录多个 issue。
- **FR-004**: 系统 MUST 计算模块覆盖率百分比：`已文档化模块数 / 应文档化模块总数`。
- **FR-005**: 系统 MUST 输出缺失文档模块列表，并包含模块名、层级、相关源码文件。
- **FR-006**: 系统 MUST 基于 044 的 `unlinkedSpecs` 或等价事实输出“缺少交叉引用”的文档列表。
- **FR-007**: 系统 MUST 扫描 spec Markdown 中指向 `*.spec.md` 的链接，并识别不存在目标文件的 dangling links。
- **FR-008**: 系统 MUST 识别 `confidence: low` 的 spec，并在审计中单独归类。
- **FR-009**: 系统 MUST 结合 `GeneratorRegistry.filterByContext()` 输出适用 generator 的 coverage 统计。
- **FR-010**: 系统 MUST 为 project-level generator 使用稳定的默认输出文件名映射，并据此判断是否已生成文档。
- **FR-011**: 系统 MUST 在 batch 输出目录中写入 `_coverage-report.md` 和 `_coverage-report.json`。
- **FR-012**: 系统 MUST 将审计结果接入 `BatchResult`，至少暴露 Markdown 报告路径。

### Success Criteria

- **SC-001**: 对包含缺文档、缺互链、断链和低置信度四类问题的 fixture，审计报告能正确分类并列出对应条目。
- **SC-002**: 报告中模块 coverage 百分比与 fixture 期望值完全一致。
- **SC-003**: 报告中存在 generator coverage 表，且对当前项目适用的 generator 给出 `expected / generated / missing` 统计。
- **SC-004**: `runBatch()` 完成后输出目录中同时存在 `_doc-graph.json`、`_coverage-report.md`、`_coverage-report.json`。
