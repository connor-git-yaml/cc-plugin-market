# Tasks: 跨包依赖分析 (Feature 041)

**Input**: Design documents from `/specs/041-cross-package-deps/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md (required)

**Tests**: spec.md 中 SC-005 明确要求全部单元测试通过（`npm test` 退出码 0），因此本任务分解包含完整测试任务。

**Organization**: 任务按 User Story 分组，支持独立实现和增量交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1-US5）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup

**Purpose**: 创建新增文件骨架，确保编译通过

- [x] T001 创建 `src/panoramic/cross-package-analyzer.ts` 空模块骨架，导出 `CrossPackageAnalyzer` 类（仅包含类声明和 id/name/description 属性，方法体暂留 `throw new Error('Not implemented')`）
- [x] T002 [P] 创建 `templates/cross-package-analysis.hbs` 空模板文件，包含 Handlebars 基本结构占位
- [x] T003 [P] 创建 `tests/panoramic/cross-package-analyzer.test.ts` 测试文件骨架，包含 describe block 和跳过的占位测试

**Checkpoint**: 三个新文件存在，`npx tsc --noEmit` 编译通过

---

## Phase 2: Foundational (数据类型定义)

**Purpose**: 定义 CrossPackageInput、CrossPackageOutput 及辅助类型，为后续所有 User Story 提供数据基础

**CRITICAL**: 所有 User Story 的实现都依赖这些类型定义

- [x] T004 在 `src/panoramic/cross-package-analyzer.ts` 中定义并导出 `CrossPackageInput` 接口（包含 projectName、workspaceType、packages、graph 字段），类型引用 `WorkspacePackageInfo`（从 workspace-index-generator.ts 导入）和 `DependencyGraph`（从 models/dependency-graph.ts 导入）
- [x] T005 在 `src/panoramic/cross-package-analyzer.ts` 中定义并导出 `CrossPackageOutput` 接口（包含 title、generatedAt、projectName、workspaceType、mermaidDiagram、levels、topologicalOrder、hasCycles、cycleGroups、stats 字段）
- [x] T006 [P] 在 `src/panoramic/cross-package-analyzer.ts` 中定义并导出辅助类型：`TopologyLevel`（level + packages）、`CycleGroup`（packages + cyclePath）、`DependencyStats`（totalPackages + totalEdges + rootPackages + leafPackages）

**Checkpoint**: 所有新增类型定义完成，`npx tsc --noEmit` 编译通过

---

## Phase 3: User Story 1 & 2 - 依赖拓扑图 + 循环依赖检测 (Priority: P1) -- MVP

**Goal**: 交付核心价值——从 Monorepo 子包列表构建依赖图、检测循环依赖、生成带循环标注的 Mermaid 拓扑图，并通过 Handlebars 模板渲染为 Markdown 文档。

**Why combined**: US1（拓扑图）和 US2（循环检测）同为 P1 优先级，且在 `generate()` 方法中紧密耦合（Mermaid 图的循环标注依赖 SCC 检测结果）。将二者合并为一个 Phase 避免重复实现和人为拆分 `generate()` 逻辑。

**Independent Test**: 对包含 3+ 子包且有内部依赖的测试 fixture 运行 extract -> generate -> render 全流程，验证输出 Markdown 包含合法 Mermaid graph TD 图，节点/边正确，循环依赖被正确检测和标注。

### Tests (先写测试，确认失败)

- [x] T007 [P] [US1] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `isApplicable` 测试：monorepo 上下文返回 true、single 上下文返回 false
- [x] T008 [P] [US1] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `extract` 测试：使用 3 包线性依赖 fixture（A->B->C），验证返回的 `CrossPackageInput` 中 graph.modules 有 3 个节点、graph.edges 有 2 条边、edge 方向正确
- [x] T009 [P] [US1] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `extract` 边界测试：自依赖被过滤、不存在的依赖被过滤、无依赖场景下 edges 为空
- [x] T010 [P] [US1] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `generate` 正常依赖图测试：3 包线性依赖，验证 hasCycles=false、mermaidDiagram 包含 `graph TD`、所有节点和正确方向的边
- [x] T011 [P] [US2] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `generate` 循环依赖测试：A->B->C->A 循环，验证 hasCycles=true、cycleGroups 包含完整循环路径、mermaidDiagram 包含虚线边标注
- [x] T012 [P] [US2] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `generate` 多组独立循环测试：A<->B 和 C<->D 两组循环，验证 cycleGroups.length === 2 且分别列出
- [x] T013 [P] [US1] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `render` 测试：验证输出为非空字符串、包含 Mermaid 代码块、包含文档标题

**Checkpoint**: 所有测试编写完成并确认失败（红灯）

### Implementation

- [x] T014 [US1] 在 `src/panoramic/cross-package-analyzer.ts` 中实现 `isApplicable(context)` 方法：返回 `context.workspaceType === 'monorepo'`
- [x] T015 [US1] 在 `src/panoramic/cross-package-analyzer.ts` 中实现 `extract(context)` 方法：实例化 `WorkspaceIndexGenerator` 调用其 `extract(context)` 获取 `WorkspaceInput`，然后将 `packages[]` 转换为 `DependencyGraph`（构建 GraphNode[] 和 DependencyEdge[]，过滤自依赖和不存在的依赖，计算 inDegree/outDegree）
- [x] T016 [US1][US2] 在 `src/panoramic/cross-package-analyzer.ts` 中实现 `generate(input)` 方法：调用 `detectSCCs(graph)` 获取 SCC、调用 `topologicalSort(graph)` 获取拓扑结果、标记循环边的 `isCircular`、构建 `CycleGroup[]`、调用 `buildCrossPackageMermaid()` 生成 Mermaid 图、计算 `DependencyStats`、按 level 分组构建 `TopologyLevel[]`、返回 `CrossPackageOutput`
- [x] T017 [US1][US2] 在 `src/panoramic/cross-package-analyzer.ts` 中实现内部辅助函数 `buildCrossPackageMermaid(graph, sccNodeSet, sccEdgeSet)`：生成 `graph TD` 头部、为每个包添加节点（复用 `sanitizeMermaidId()`）、SCC 内部节点添加 `:::cycle` 样式类、正常边用 `-->` 实线、循环边用 `-.->` 虚线 + `|cycle|` 标签、添加 `classDef cycle` 样式定义和 `linkStyle` 红色指令
- [x] T018 [US1] 在 `src/panoramic/cross-package-analyzer.ts` 中实现 `render(output)` 方法：加载 `templates/cross-package-analysis.hbs`、编译并执行 Handlebars 模板、返回 Markdown 字符串
- [x] T019 [US1][US2] 在 `templates/cross-package-analysis.hbs` 中编写完整 Handlebars 模板：包含 YAML frontmatter、依赖拓扑图区块（Mermaid 代码块）、循环依赖检测区块（条件渲染警告或"未检测到"声明）、拓扑排序层级表格、统计摘要表格

**Checkpoint**: US1+US2 测试全部通过（绿灯），`npm test` 相关用例通过

---

## Phase 4: User Story 3 - 依赖统计信息 (Priority: P2)

**Goal**: 在文档中展示 root 包列表、leaf 包列表和总依赖边数，帮助维护者快速评估依赖复杂度。

**Independent Test**: 对已知依赖关系的 Monorepo fixture 运行分析，验证 root/leaf 包列表和总依赖数与预期一致。

**Note**: 统计信息的计算逻辑已在 Phase 3 的 T016（`generate()` 方法）中实现（DependencyStats 的 rootPackages/leafPackages/totalEdges），此 Phase 仅需补充验证测试。

### Tests

- [x] T020 [P] [US3] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写统计信息测试：3 包线性依赖（A->B->C），验证 stats.rootPackages=['A']（A 无入度）、stats.leafPackages=['C']（C 无出度）、stats.totalEdges=2、stats.totalPackages=3
- [x] T021 [P] [US3] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写无依赖场景统计测试：3 个独立包，验证所有包同时出现在 rootPackages 和 leafPackages 中、totalEdges=0
- [x] T022 [P] [US3] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写单包场景统计测试：仅 1 个子包，验证 rootPackages=['A']、leafPackages=['A']、totalEdges=0

**Checkpoint**: US3 统计信息测试全部通过

---

## Phase 5: User Story 4 - 拓扑排序与层级展示 (Priority: P2)

**Goal**: 在文档中展示子包的拓扑排序结果和层级信息，帮助理解构建顺序和依赖深度。

**Independent Test**: 对已知依赖关系的 fixture 运行分析，验证拓扑排序顺序正确（被依赖方排在依赖方之前）。

**Note**: 拓扑排序和层级分组逻辑已在 Phase 3 的 T016（`generate()` 方法）中实现，此 Phase 仅需补充验证测试。

### Tests

- [x] T023 [P] [US4] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写拓扑排序测试：3 包线性依赖（A->B->C），验证 topologicalOrder 中 C 在 B 之前、B 在 A 之前（叶子优先）
- [x] T024 [P] [US4] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写层级分组测试：验证 levels 数组中 level 0 包含 C（leaf）、最高层包含 A（root），层级数与依赖深度一致

**Checkpoint**: US4 拓扑排序测试全部通过

---

## Phase 6: User Story 5 - GeneratorRegistry 注册 (Priority: P2)

**Goal**: 将 CrossPackageAnalyzer 注册到 GeneratorRegistry，使其可被 `reverse-spec batch` 自动发现和调用。

**Independent Test**: 调用 `bootstrapGenerators()` 后通过 `GeneratorRegistry.getInstance().get('cross-package-deps')` 获取实例。

### Tests

- [x] T025 [P] [US5] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写注册测试：`bootstrapGenerators()` 后通过 `get('cross-package-deps')` 获取实例，验证 id 为 `'cross-package-deps'`
- [x] T026 [P] [US5] 在 `tests/panoramic/cross-package-analyzer.test.ts` 中编写 `filterByContext` 测试：monorepo 上下文下 CrossPackageAnalyzer 出现在过滤结果中、single 上下文下不出现

### Implementation

- [x] T027 [US5] 修改 `src/panoramic/generator-registry.ts`：在 `bootstrapGenerators()` 函数中添加 `registry.register(new CrossPackageAnalyzer())` 和对应的 import 语句 `import { CrossPackageAnalyzer } from './cross-package-analyzer.js'`
- [x] T028 [US5] 修改 `src/panoramic/index.ts`：添加 `CrossPackageAnalyzer` 类的导出，以及 `CrossPackageInput`、`CrossPackageOutput`、`TopologyLevel`、`CycleGroup`、`DependencyStats` 类型的导出

**Checkpoint**: US5 注册测试全部通过，`npm test` 全量测试通过

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 收尾清理、全量验证、文档更新

- [x] T029 [P] 运行 `npm test` 全量测试，确认所有测试通过（退出码 0）
- [x] T030 [P] 运行 `npm run lint` 代码检查，修复所有 lint 错误
- [x] T031 验证 Handlebars 模板渲染输出的 Markdown 格式正确性：Mermaid 代码块可被解析、YAML frontmatter 格式正确、表格对齐正确
- [x] T032 [P] 检查所有新增文件的中文注释完整性，确保符合项目代码注释规范

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|----------|
| FR-001 | 实现 DocumentGenerator 接口，遵循四步生命周期 | T001, T014, T015, T016, T018 |
| FR-002 | isApplicable 判断 monorepo | T007, T014 |
| FR-003 | 复用 WorkspaceIndexGenerator.extract() | T015 |
| FR-004 | WorkspacePackageInfo[] 转 DependencyGraph | T008, T009, T015 |
| FR-005 | 复用 detectSCCs() 检测循环依赖 | T011, T012, T016 |
| FR-006 | 复用 topologicalSort() 计算拓扑排序 | T023, T024, T016 |
| FR-007 | 生成 Mermaid graph TD 依赖拓扑图 | T010, T013, T017 |
| FR-008 | 循环依赖边使用红色虚线样式 | T011, T017 |
| FR-009 | 循环依赖警告区块列出循环路径 | T011, T012, T019 |
| FR-010 | 无循环时声明"未检测到循环依赖" | T010, T019 |
| FR-011 | 统计 root/leaf 包和总依赖数 | T020, T021, T022, T016 |
| FR-012 | 使用 Handlebars 模板渲染 Markdown | T013, T018, T019 |
| FR-013 | bootstrapGenerators() 注册实例 | T025, T027 |
| FR-014 | id 为 'cross-package-deps' | T001, T025 |
| FR-015 | 复用 sanitizeMermaidId() | T017 |
| FR-016 | 拓扑排序展示层级信息 | T024, T016, T019 |
| FR-017 | SCC 节点特殊颜色样式（MAY） | T017 |

**FR 覆盖率**: 17/17 = **100%**

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1 (Setup)**: 无依赖，可立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1（需要文件骨架存在）
- **Phase 3 (US1+US2 MVP)**: 依赖 Phase 2（需要类型定义），**阻塞后续所有 Phase**
- **Phase 4 (US3)**: 依赖 Phase 3（统计信息在 generate() 中计算）
- **Phase 5 (US4)**: 依赖 Phase 3（拓扑排序在 generate() 中计算）
- **Phase 6 (US5)**: 依赖 Phase 3（需要完整的 CrossPackageAnalyzer 实现）
- **Phase 7 (Polish)**: 依赖所有前置 Phase 完成

### User Story 间依赖

- **US1 + US2**: 紧密耦合，合并在 Phase 3 中实现（Mermaid 图 + 循环标注不可分离）
- **US3**: 依赖 US1 的 extract() + generate() 基础设施，但 stats 计算逻辑独立
- **US4**: 依赖 US1 的 extract() + generate() 基础设施，但拓扑排序逻辑独立
- **US5**: 依赖完整的 CrossPackageAnalyzer 实现，但注册逻辑独立
- **US3、US4、US5 互相独立**，可并行实现

### Story 内部并行机会

- Phase 1: T001、T002、T003 全部独立可并行（不同文件）
- Phase 2: T004/T005 顺序执行（同一文件），T006 可与 T005 并行
- Phase 3 Tests: T007-T013 全部可并行（同一文件内不同 describe block，但实际操作同一文件需顺序）
- Phase 3 Impl: T014 -> T015 -> T016/T017 -> T018，核心实现链为顺序（同一文件，方法间有依赖）；T019 可与 T016/T017 并行（不同文件）
- Phase 4/5/6 Tests: 各 Phase 内部测试可并行
- Phase 6 Impl: T027 和 T028 可并行（不同文件）

### 推荐实现策略

**MVP First（推荐）**:
1. Phase 1 + Phase 2 -> 基础就绪
2. Phase 3 (US1+US2) -> **核心价值交付，可独立验证**
3. Phase 4 + Phase 5 + Phase 6（并行推进）-> 补齐 P2 能力
4. Phase 7 -> 收尾

---

## 任务总览

| 指标 | 值 |
|------|------|
| 总任务数 | 32 |
| User Stories 覆盖 | 5/5 (US1-US5) |
| 新增文件 | 3 (`cross-package-analyzer.ts`, `cross-package-analysis.hbs`, `cross-package-analyzer.test.ts`) |
| 修改文件 | 2 (`generator-registry.ts`, `index.ts`) |
| 可并行任务占比 | 56% (18/32) |
| MVP 范围 | Phase 1-3 (T001-T019, 19 个任务) |

---

## Notes

- [P] 标记的任务涉及不同文件或无数据依赖，可并行执行
- [USN] 标记表明任务归属的 User Story，用于追踪
- 每个 Phase 完成后建议运行 `npm test` 验证，确保增量正确
- Commit 粒度建议：每完成一个 Phase 提交一次
- 避免：跨 Phase 乱序实现、跳过测试先写实现
