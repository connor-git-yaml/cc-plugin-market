# Feature Specification: 修复 Batch 单语言非 TS/JS 依赖图选择

**Feature Branch**: `052-batch-singlelang-graph`  
**Created**: 2026-03-20  
**Status**: Draft  
**Input**: User description: "先做 batch-orchestrator 这个吧"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 纯 Python/Go/Java 项目 batch 能正常分模块 (Priority: P1)

作为在纯 Python、Go 或 Java 项目中使用 `reverse-spec batch` 的开发者，我希望 batch 编排器能正确识别模块并继续执行，而不是返回 0 个模块，导致后续 panoramic 文档能力无法复用 batch 流程。

**Why this priority**: 这是 Phase 2 的明确前置 blocker。若纯非 TS/JS 项目仍返回 0 模块，API Surface 和 Architecture Overview 等后续能力在 Python/Go/Java 项目上会直接失效。

**Independent Test**: 在纯 Python/Go/Java 临时项目中预创建模块 spec，使 `runBatch()` 走 skip 分支；验证 `totalModules > 0` 且不会错误返回空图。

**Acceptance Scenarios**:

1. **Given** 项目只包含 Python 源文件，**When** 运行 `runBatch(projectRoot)`，**Then** 系统 MUST 通过语言适配器或目录图兜底构建可分组依赖图，返回至少 1 个模块
2. **Given** 项目只包含 Go 或 Java 源文件，**When** 运行 `runBatch(projectRoot)`，**Then** 系统 MUST 不再依赖 `dependency-cruiser` 的 TS/JS 图结果作为唯一输入
3. **Given** 单语言非 TS/JS 语言适配器未实现 `buildDependencyGraph()`，**When** batch 编排器构图，**Then** 系统 MUST 回退到目录图兜底，而不是返回空模块集合

---

### User Story 2 - 现有 TS/JS 和多语言路径不回归 (Priority: P2)

作为维护者，我希望这次修复只影响单语言非 TS/JS 路径，不破坏纯 TS/JS 项目现有的 `dependency-cruiser` 行为，也不影响多语言项目的分语言构图流程。

**Why this priority**: batch 已经承载现有主流程，修复不能通过扩大分支判断带来 TS/JS 或多语言回归。

**Independent Test**: 保留现有单元测试并运行 batch-orchestrator 相关集成测试，验证单语言 TS/JS 仍走原路径、多语言逻辑仍通过。

**Acceptance Scenarios**:

1. **Given** 项目只包含 TypeScript/JavaScript 文件，**When** 运行 `runBatch(projectRoot)`，**Then** 系统 MUST 继续使用现有 `buildGraph()` 结果
2. **Given** 项目包含两种及以上语言，**When** 运行 `runBatch(projectRoot)`，**Then** 系统 MUST 继续走现有多语言分组和图合并逻辑

### Edge Cases

- 当文件扫描发现 0 种受支持语言时，系统应维持现有空图行为，不引入异常
- 当 `options.languages` 过滤后仅保留单一非 TS/JS 语言时，系统仍应选择该语言的 adapter/fallback 图，而不是回退到 TS/JS 空图
- 当语言适配器实现了 `buildDependencyGraph()` 但构图失败时，系统应退回 `buildFallbackGraph()`，保持宽容策略

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 在 `runBatch()` 中区分三条构图路径：纯 TS/JS、单语言非 TS/JS、多语言
- **FR-002**: 系统 MUST 在检测到单语言非 TS/JS 项目时，优先使用对应语言适配器的 `buildDependencyGraph()`；若未实现或失败，则使用目录图兜底
- **FR-003**: 系统 MUST 仅在纯 TS/JS 项目中直接采用 `buildGraph()` 的结果作为主依赖图
- **FR-004**: 系统 MUST 保持多语言项目现有的 `groupFilesByLanguage -> per-language graph -> mergeGraphsForTopologicalSort` 流程不变
- **FR-005**: 系统 MUST 为该回归补充自动化测试，覆盖至少一个纯非 TS/JS 项目 batch 不再返回 0 模块的场景

### Key Entities

- **Batch Graph Selection**: `runBatch()` 在文件扫描后，根据检测语言数和语言类型选择主依赖图来源的决策逻辑
- **Fallback Dependency Graph**: 当语言适配器没有原生依赖图能力或构图失败时，基于目录结构和最小骨架生成的兜底图

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 纯 Python 临时项目执行 `runBatch()` 时，`totalModules` 大于 0，且不再出现“0 模块”回归
- **SC-002**: batch-orchestrator 相关单元/集成测试全部通过，不引入 TS/JS 或多语言回归
- **SC-003**: 修复后不新增运行时依赖，也不改变 CLI/MCP 的 batch 调用接口
