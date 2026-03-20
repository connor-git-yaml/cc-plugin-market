# Feature Specification: Batch 全景项目文档套件与架构叙事输出

**Feature Branch**: `053-panoramic-batch-doc-suite`  
**Created**: 2026-03-20  
**Status**: Implemented  
**Input**: User description: "把 panoramic 项目级生成器真正接进 reverse-spec batch，并补一份像架构分析文一样可读的技术架构说明"

---

## User Scenarios & Testing

### User Story 1 - Batch 自动产出项目级全景文档 (Priority: P1)

作为维护者，我希望在执行 `reverse-spec batch` 后，除了模块级 `*.spec.md` 外，还能自动得到适用于当前项目的 `data-model`、`config-reference`、`api-surface`、`runtime-topology`、`architecture-overview` 等项目级文档，而不是只看到 `_index`、`_doc-graph` 和 `_coverage-report`。

**Why this priority**: 这是当前 E2E 的核心缺口；项目级 panoramic generators 已实现，但主编排没有接通，导致输出不完整。

**Independent Test**: 对包含 API、配置、数据模型、Docker/Compose 的 fixture 执行 `reverse-spec batch`，验证输出目录中自动出现对应的 `.md/.json/.mmd` 文档文件。

**Acceptance Scenarios**:

1. **Given** 一个包含 Express 路由、模型定义、配置文件和 Docker Compose 的项目，**When** 运行 `reverse-spec batch`，**Then** 输出目录中自动生成适用的项目级 panoramic 文档，而不是只生成模块 spec。
2. **Given** 一个只适用部分 generator 的项目，**When** 运行 `reverse-spec batch`，**Then** 系统只生成适用的项目级文档，并跳过不适用的 generator。

---

### User Story 2 - 输出一份人类可读的架构叙事文档 (Priority: P1)

作为阅读者，我希望 batch 结果里有一份类似“源码架构分析”的文档，用自然语言讲清楚系统定位、目录结构、关键模块、关键类和关键方法，而不是只能在若干结构化 Markdown 之间来回跳。

**Why this priority**: 当前结构化输出对机器和局部查阅友好，但对人快速建立整体认知仍然不够直观。

**Independent Test**: 对单包项目运行 `reverse-spec batch`，验证输出目录中存在 `architecture-narrative.md/.json`，且正文至少覆盖项目结论、仓库结构、关键模块、关键类型/类、关键方法/函数五类内容。

**Acceptance Scenarios**:

1. **Given** 一个没有 Docker/Compose、也不是 Monorepo 的单包项目，**When** 运行 `reverse-spec batch`，**Then** 仍然会生成 `architecture-narrative.md`，不会因为 `architecture-overview` 不适用而完全缺失项目级说明。
2. **Given** 一个包含清晰导出符号和模块职责的项目，**When** 查看 `architecture-narrative.md`，**Then** 文档会列出关键模块、关键类/类型和关键方法/函数，并标注推断性质而不是伪装成确定事实。

---

### User Story 3 - 批处理结果与覆盖率口径保持一致 (Priority: P2)

作为维护者，我希望 batch 输出、CLI 日志和 coverage audit 对“哪些项目级文档应该生成、实际生成了哪些文件”使用同一套命名和统计口径，这样验收结果不会互相打架。

**Why this priority**: 当前 coverage audit 已经把很多 generator 标记为 expected，但 batch 并未实际生成对应文件，导致报告和现实不一致。

**Independent Test**: 在同一个 fixture 上执行 `reverse-spec batch`，验证 `_coverage-report.json` 中 applicable project generators 的 `generatedCount` 与输出目录中文件实际存在情况一致。

**Acceptance Scenarios**:

1. **Given** 一个适用 `architecture-overview`、`runtime-topology`、`api-surface` 的项目，**When** 执行 batch，**Then** coverage audit 中这些 generator 的 `generatedCount` 应与实际写出的文件数一致。
2. **Given** batch 成功生成项目级 panoramic 文档，**When** CLI 打印结果摘要，**Then** 用户能看到项目级文档总数或关键路径，而不是只能看到 `_index`、`_doc-graph` 和 `_coverage-report`。

---

## Edge Cases

- 当 batch 处于 `--incremental` 模式且只有少量模块重生成时，项目级文档仍必须基于全量可见事实生成，不能只反映本次变更的模块。
- 当项目没有 Docker/Compose、没有 workspace、没有 API schema 时，系统必须只跳过不适用的 generator，而不是整体放弃项目级输出。
- 当某个 project generator 自身失败时，batch 必须记录 warning 并继续生成其他项目级文档和模块 spec，避免单点失败拖垮整次批处理。
- 当模块 spec 来自旧批次且只有 Markdown 文件时，架构叙事生成必须采用保守解析或降级摘要，而不是生成空白文档。
- 当生成器支持 Mermaid 视图时，batch 需要稳定产出 `.mmd`，但没有 Mermaid 视图的生成器不得写出空 `.mmd` 文件。

## Requirements

### Functional Requirements

- **FR-001**: `runBatch()` MUST 在模块级 spec 生成完成后构建一次完整 `ProjectContext`，并通过 `GeneratorRegistry.filterByContext()` 发现适用的项目级 panoramic generators。
- **FR-002**: batch MUST 自动执行适用的项目级 generators，并将结果写入当前 `outputDir`，无需用户额外调用单独命令。
- **FR-003**: 项目级输出 MUST 使用稳定文件名映射；相同 generator 在 batch、coverage audit 和 CLI 摘要中的文件名口径必须一致。
- **FR-004**: batch MUST 为项目级 generator 至少输出 Markdown 与 JSON；当 generator 提供 Mermaid 视图时，还 MUST 输出 `.mmd`。
- **FR-005**: 系统 MUST 新增 `architecture-narrative` 输出，且它不依赖 Docker/Compose 或 Monorepo 前提；只要 batch 至少拥有一份模块 spec，就必须可生成。
- **FR-006**: `architecture-narrative` MUST 至少包含以下版块：整体结论、仓库结构/目录地图、关键模块、关键类/类型、关键方法/函数、架构观察或约束说明。
- **FR-007**: `architecture-narrative` MUST 优先复用现有事实源：`ModuleSpec.sections`、`baselineSkeleton.exports/members`、`ProjectContext` 与已生成的 panoramic 结构化输出；无法确定时必须显式标注 `[推断]` 或低置信度说明。
- **FR-008**: batch MUST 能在 `--incremental` 模式下基于“当前重生成的 module spec + 输出目录已有 module spec”生成完整的项目级文档与架构叙事，而不是仅覆盖本次命中的模块。
- **FR-009**: `BatchResult` MUST 暴露项目级文档路径列表或等价摘要信息，CLI MUST 在 batch 完成后打印项目级输出摘要。
- **FR-010**: 现有模块级 spec 生成、`_index.spec.md`、`_doc-graph.json`、`_coverage-report.*` 与 `_delta-report.*` 语义 MUST 保持兼容，不得因为新增项目级文档而退化。

### Key Entities

- **BatchPanoramicDoc**: 单个项目级文档输出单元，包含 generatorId、baseName、写出的文件路径列表与可能的 warning。
- **ArchitectureNarrativeDocument**: 面向人类阅读的技术架构说明文档，聚合项目结论、模块地图、关键符号、关键方法和结构化文档证据。
- **NarrativeModuleInsight**: 从单个 module spec 与 baseline skeleton 提炼出的模块级摘要，包括职责、代表导出、关键方法、依赖线索与推断标记。

## Success Criteria

- **SC-001**: 对包含 API、配置、数据模型和 Docker Compose 的 fixture 执行一次 `reverse-spec batch` 后，输出目录中自动出现适用的 panoramic 项目级文档 Markdown/JSON，以及存在 Mermaid 视图时的 `.mmd` 文件。
- **SC-002**: 对单包项目执行 `reverse-spec batch` 后，输出目录中存在 `architecture-narrative.md`，并且文档正文同时包含“关键模块”“关键类/类型”“关键方法/函数”三类内容。
- **SC-003**: 对同一个 fixture 执行 batch 后，`_coverage-report.json` 中 applicable project generators 的 `generatedCount` 与输出目录实际存在文件一致，不再出现“expected=1, generated=0 但实现其实已经存在”的口径错位。
- **SC-004**: 在 `--incremental` 模式下，批处理仍能生成完整的项目级文档套件和 `architecture-narrative`，且内容不会只反映本次重生成的模块。
