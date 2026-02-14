# Feature Specification: Batch 模块级聚合与生成质量提升

**Feature Branch**: `005-batch-quality-fixes`
**Created**: 2026-02-14
**Status**: Draft (追溯记录——代码已完成)
**Input**: 追溯记录 4 个已完成提交（4a58c04..fcfddc9）的改动，涵盖 dependency-graph 修复、batch 模块级聚合重构、spec 生成质量提升。

## 背景

在 001-reverse-spec-v2 的初始实现中，`reverse-spec batch` 命令按**文件级**拓扑顺序逐个生成 spec，导致两个问题：

1. **粒度过细**：一个目录下多个文件分别生成独立 spec，缺乏模块级的整体视角
2. **生成质量不稳定**：LLM 系统提示词过于简略，响应解析对章节标题格式要求过于严格（仅匹配固定中文标题），导致部分章节丢失

同时 dependency-cruiser v16.x 升级后 `cruise()` 从同步 API 变为异步 API，造成运行时崩溃。

本特性追溯记录这些已完成的修复和增强，确保 001 的 contracts 文档与代码保持同步。

## User Scenarios & Testing

### User Story 1 - 按模块级聚合生成 batch spec（Priority: P1）

技术负责人对大型项目运行 `reverse-spec batch`。系统将文件按目录聚合为模块（如 `src/auth/` 下所有文件归入 `auth` 模块），按模块级拓扑顺序处理，为每个模块生成一份整体 spec，而非为每个文件单独生成。

**Why this priority**: 模块级聚合是 batch 命令的核心质量改进，直接影响生成结果的可用性和可读性。

**Independent Test**: 对包含 `src/auth/`、`src/core/`、`src/batch/` 等多个子目录的项目运行 `reverse-spec batch`，验证生成的 spec 按目录模块聚合，每个模块一份 spec。

**Acceptance Scenarios**:

1. **Given** 一个项目 `src/` 下有 `auth/`（3 个文件）、`core/`（5 个文件）、`batch/`（4 个文件），**When** 用户运行 `reverse-spec batch`，**Then** 系统生成 3 份模块级 spec（`auth.spec.md`、`core.spec.md`、`batch.spec.md`），每份涵盖模块内所有文件
2. **Given** `src/` 根目录下存在散文件（如 `index.ts`、`config.ts`），**When** batch 处理运行，**Then** 散文件归入 `root` 模块，逐个文件单独生成 spec
3. **Given** 模块 A 依赖模块 B，**When** batch 处理运行，**Then** 模块 B 先于模块 A 处理（模块级拓扑顺序）
4. **Given** 用户自定义分组选项（basePrefix、depth、rootModuleName），**When** 运行 batch，**Then** 系统按自定义规则聚合文件

---

### User Story 2 - 提升 spec 生成质量（Priority: P2）

用户运行 `reverse-spec generate` 或 `reverse-spec batch` 生成 spec。系统通过增强的系统提示词引导 LLM 输出结构化内容（含 Mermaid 图表、表格、详细格式要求），并通过容错的章节标题匹配确保 9 个章节完整解析。

**Why this priority**: 生成质量直接决定 spec 的实用价值。增强提示词和容错解析可显著减少空章节和格式问题。

**Independent Test**: 对一个已知模块运行 `reverse-spec generate`，验证输出包含完整的 9 个章节，每个章节有实质内容，且包含 Mermaid 图表。

**Acceptance Scenarios**:

1. **Given** LLM 返回的章节标题使用英文（如 `## 1. Intent`）而非中文，**When** 系统解析响应，**Then** 仍能正确匹配到对应章节（容错匹配）
2. **Given** LLM 返回的章节标题包含额外标点或空格变体，**When** 系统解析响应，**Then** 通过归一化匹配正确识别章节
3. **Given** LLM 未生成某个章节，**When** 系统检测到缺失，**Then** 用带有改善建议的占位内容填充（而非空标记）
4. **Given** 一个有依赖关系的模块，**When** spec 生成完成，**Then** 输出包含 Mermaid 依赖关系图（除类图外新增）

---

### User Story 3 - dependency-cruiser 兼容性修复（Priority: P3）

用户在安装了 dependency-cruiser v16.x 的环境中运行 `reverse-spec batch`。系统正确处理 `cruise()` 的异步返回值和空结果场景，不会崩溃。

**Why this priority**: 这是基础设施修复，确保依赖图构建在新版本环境下正常工作。

**Independent Test**: 在安装 dependency-cruiser v16.x 的项目中运行 `reverse-spec batch`，验证依赖图正确构建。

**Acceptance Scenarios**:

1. **Given** 项目安装了 dependency-cruiser v16.x（`cruise()` 返回 Promise），**When** `buildGraph()` 被调用，**Then** 系统正确 await 异步结果并构建依赖图
2. **Given** 项目安装了旧版 dependency-cruiser（`cruise()` 返回同步结果），**When** `buildGraph()` 被调用，**Then** 系统正确处理同步结果（向后兼容）
3. **Given** 项目缺少可分析的源文件（cruise 返回空结果），**When** `buildGraph()` 被调用，**Then** 返回空的 DependencyGraph 而非抛出空指针异常

---

### Edge Cases

- `src/` 目录不存在时，`buildGraph()` 扫描项目根目录且使用相对路径 `'.'`
- `buildGraph()` 执行期间 `process.chdir()` 后即使抛出异常也必须恢复原 cwd（finally 块保证）
- `groupFilesToModules()` 收到空 DependencyGraph（零模块）时返回空分组结果
- 模块名中包含特殊字符（如 `@scope/pkg`）时，spec 文件命名需安全处理
- batch 处理中 root 模块的 checkpoint 记录路径与其他模块不同（使用模块名而非文件路径）

### Out of Scope

- batch 命令的并行处理（当前仍为串行）
- LLM 响应的语义验证（仅做格式解析）
- dependency-cruiser 版本的自动检测和提示

## Requirements

### Functional Requirements

- **FR-001**: batch 命令必须将文件按目录聚合为模块，以模块为单位生成 spec
- **FR-002**: 模块分组必须支持自定义 `basePrefix`（默认 `'src/'`）、`depth`（分组深度）和 `rootModuleName`（散文件归属模块名）
- **FR-003**: 模块间的处理顺序必须遵循模块级拓扑排序（基础模块先处理）
- **FR-004**: `src/` 根目录下的散文件必须归入 root 模块，逐个文件单独生成 spec
- **FR-005**: LLM 系统提示词必须包含 9 个章节的详细格式要求，包括 Mermaid 图表模板、表格格式规范
- **FR-006**: 章节标题匹配必须支持中英文变体和大小写/标点容错
- **FR-007**: 缺失章节必须用带改善建议的占位内容填充（而非空标记 `[LLM 未生成此段落]`）
- **FR-008**: spec 生成流水线必须同时生成类图和依赖关系图（如有依赖）
- **FR-009**: `GenerateSpecResult` 必须包含完整的 `ModuleSpec` 对象，供 batch 索引生成使用
- **FR-010**: `buildGraph()` 必须兼容 dependency-cruiser 同步和异步 API
- **FR-011**: `buildGraph()` 在 cruise 返回空结果时必须返回空 DependencyGraph 而非崩溃
- **FR-012**: `buildGraph()` 必须在目标项目目录下执行 cruise，且无论成功或失败都恢复原工作目录
- **FR-013**: `fileInventory` 中的文件路径必须使用基于 `projectRoot` 的相对路径
- **FR-014**: 架构索引生成必须使用实际收集的 `ModuleSpec[]` 数据（而非空数组）

### Key Entities

- **ModuleGroup**: 一组属于同一目录模块的文件集合，包含模块名、目录路径和文件列表
- **ModuleGroupResult**: 分组结果，包含所有模块分组、模块级拓扑顺序和模块间依赖边
- **GroupingOptions**: 分组配置，控制 basePrefix、分组深度和 root 模块命名

## Success Criteria

### Measurable Outcomes

- **SC-001**: batch 生成的 spec 数量与项目中的目录模块数一致（而非文件数），生成的每份 spec 涵盖模块内所有文件
- **SC-002**: 生成的 spec 中 9 个章节完整率达到 95% 以上（即不超过 5% 的章节使用占位内容）
- **SC-003**: 生成的 spec 包含 Mermaid 图表（类图和/或依赖关系图），图表出现率 ≥ 80%
- **SC-004**: `buildGraph()` 在 dependency-cruiser v15.x 和 v16.x 环境下均正常工作，零崩溃
- **SC-005**: batch 处理空项目或无源文件项目时优雅返回空结果，不抛出未处理异常

## Assumptions

- dependency-cruiser v16.x 的 `cruise()` 返回 Promise 是稳定行为，不会在后续版本回退
- `process.chdir()` 在目标项目目录可执行（无权限问题）
- 项目的目录结构遵循 `src/` 前缀约定（或可通过 `basePrefix` 配置覆盖）
- LLM 能理解中英文混合的系统提示词格式要求
