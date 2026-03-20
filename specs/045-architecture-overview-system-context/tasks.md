# Tasks: 架构概览与系统上下文视图

**Input**: Design documents from `/specs/045-architecture-overview-system-context/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本 Feature 明确要求至少覆盖一组“043 + 040 + 041 联合组合”测试和一组“部分输入缺失”的降级测试，并通过 `npm run lint`、相关 `vitest` 用例和 `npm run build`。

**Organization**: 任务按共享基础设施、User Story 和验证阶段分组，确保每个故事可独立验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行
- **[Story]**: 所属 User Story（US1-US5）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 为 045 建立共享 view model、generator、模板和测试骨架。

- [x] T001 创建 `src/panoramic/architecture-overview-model.ts`，定义 045/050 共享架构视图模型骨架
- [x] T002 [P] 创建 `src/panoramic/architecture-overview-generator.ts` 骨架，导出 `ArchitectureOverviewGenerator`
- [x] T003 [P] 创建 `templates/architecture-overview.hbs` 模板骨架
- [x] T004 [P] 创建 `tests/panoramic/architecture-overview-generator.test.ts` 测试骨架与 fixture helper

**Checkpoint**: 新增文件骨架存在，编译层面不因缺文件直接失败。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 定义共享结构、上游输入契约和 Mermaid 视图渲染 helper，作为所有 User Story 的共同基础。

- [x] T005 在 `src/panoramic/architecture-overview-model.ts` 中实现 `ArchitectureOverviewModel`、`ArchitectureViewSection`、`ArchitectureViewNode`、`ArchitectureViewEdge`、`ArchitectureEvidence`
- [x] T006 [P] 在 `src/panoramic/architecture-overview-model.ts` 中实现模块职责、部署单元、统计与 availability helper
- [x] T007 [P] 在 `src/panoramic/architecture-overview-generator.ts` 中定义 `ArchitectureOverviewInput` / `ArchitectureOverviewOutput`
- [x] T008 [P] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 Mermaid 文本构建 helper（system-context / deployment / layered）
- [x] T009 修改 `specs/045-architecture-overview-system-context/contracts/architecture-overview-output.md` 与实现保持一致

**Checkpoint**: 共享模型和输入输出契约稳定，User Story 实现可开始。

---

## Phase 3: User Story 1 - 生成全局架构概览文档 (Priority: P1) 🎯 MVP

**Goal**: 生成包含系统上下文、部署视图、分层视图和模块职责摘要的综合文档。

**Independent Test**: 通过包含 compose + workspace + cross-package 的 fixture 运行 `extract -> generate -> render`，验证文档出现三种视图与职责摘要。

### Tests for User Story 1

- [x] T010 [P] [US1] 编写组合测试：`tests/panoramic/architecture-overview-generator.test.ts` 覆盖 043 + 040 + 041 联合组合输出
- [x] T011 [P] [US1] 编写 render 测试：验证 Markdown 包含系统上下文、部署视图、分层视图和职责摘要标题
- [x] T012 [P] [US1] 编写 Mermaid 测试：验证输出包含三个 Mermaid fenced code block 或等价结构

### Implementation for User Story 1

- [x] T013 [US1] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 `extract()`，组合调用 `RuntimeTopologyGenerator`、`WorkspaceIndexGenerator`、`CrossPackageAnalyzer`
- [x] T014 [US1] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 `generate()`，构造 `ArchitectureOverviewModel`
- [x] T015 [US1] 在 `templates/architecture-overview.hbs` 中实现架构概览模板，渲染三类视图与摘要区块
- [x] T016 [US1] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 `render()`，接入 `architecture-overview.hbs`

**Checkpoint**: User Story 1 可独立生成完整架构概览，是可演示的 MVP。

---

## Phase 4: User Story 2 - 与 043 / 041 输出保持一致 (Priority: P1)

**Goal**: 保证 045 的系统/容器关系和包级依赖关系与上游结构化输出一致。

**Independent Test**: 固定一组 runtime topology 与 cross-package fixture，验证 045 模型中的关系边与上游数据一致。

### Tests for User Story 2

- [x] T017 [P] [US2] 编写一致性测试：部署视图中的服务 / 容器 / image / target stage 与 `RuntimeTopology` 对齐
- [x] T018 [P] [US2] 编写一致性测试：分层视图中的包级依赖、levels、cycle group 与 `CrossPackageOutput` 对齐
- [x] T019 [P] [US2] 编写 evidence 测试：结构化模型中保留关系来源证据，供 050 复用

### Implementation for User Story 2

- [x] T020 [US2] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 deployment view 映射，直接消费 `RuntimeTopology`
- [x] T021 [US2] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 layered view 映射，直接消费 `WorkspaceOutput` / `CrossPackageOutput`
- [x] T022 [US2] 在 `src/panoramic/architecture-overview-model.ts` 中补充 evidence / relationship helper，保证一致性与可追溯性

**Checkpoint**: 045 的结构化视图可作为可信总览，不引入新的事实漂移。

---

## Phase 5: User Story 3 - 输入不完整时的降级输出 (Priority: P2)

**Goal**: 在缺少 runtime 或 workspace/cross-package 输入时，仍能生成部分可用文档。

**Independent Test**: 对“只有 runtime”“只有 workspace”“只有 cross-package 不可单独成立但 workspace 可用”三类最小场景运行生成器，验证 warning 与 missing section 行为。

### Tests for User Story 3

- [x] T023 [P] [US3] 编写降级测试：缺少 runtime topology 时仍生成 system-context / layered 版块
- [x] T024 [P] [US3] 编写降级测试：缺少 workspace / cross-package 时仍生成 deployment 版块
- [x] T025 [P] [US3] 编写 warning 测试：缺失输入在输出模型和 Markdown 中均可见

### Implementation for User Story 3

- [x] T026 [US3] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 availability / warning 聚合逻辑
- [x] T027 [US3] 在 `templates/architecture-overview.hbs` 中实现 missing section 与 warning 渲染

**Checkpoint**: 045 在真实项目形态不完整时仍能静默降级。

---

## Phase 6: User Story 4 - Registry 发现与调用 (Priority: P2)

**Goal**: 让 `ArchitectureOverviewGenerator` 被现有 panoramic 工具链发现和调用。

**Independent Test**: 调用 `bootstrapGenerators()` 后查询 `architecture-overview`，并验证适用上下文可被 `filterByContext()` 返回。

### Tests for User Story 4

- [x] T028 [P] [US4] 编写 registry 测试：`bootstrapGenerators()` 后可通过 `architecture-overview` id 查询
- [x] T029 [P] [US4] 编写适用性测试：具备 runtime 或 monorepo 信号的上下文能发现该 generator

### Implementation for User Story 4

- [x] T030 [US4] 修改 `src/panoramic/generator-registry.ts` 注册 `ArchitectureOverviewGenerator`
- [x] T031 [US4] 在 `src/panoramic/architecture-overview-generator.ts` 中实现 `isApplicable()` 逻辑

**Checkpoint**: 045 已接入 registry，可被 panoramic 主流程发现。

---

## Phase 7: User Story 5 - 为 050 预留结构化架构模型 (Priority: P2)

**Goal**: 将 045 的共享结构边界稳定下来，供 050 直接复用。

**Independent Test**: 验证 `generate()` 输出中的 `ArchitectureOverviewModel` 不依赖模板字段，且 barrel export 可直接导入。

### Tests for User Story 5

- [x] T032 [P] [US5] 编写共享模型测试：`ArchitectureOverviewModel` 不包含 Markdown / Handlebars 字段
- [x] T033 [P] [US5] 编写 barrel export 测试：`src/panoramic/index.ts` 导出 generator 与共享 model/types/helper

### Implementation for User Story 5

- [x] T034 [US5] 在 `src/panoramic/index.ts` 中导出 `ArchitectureOverviewGenerator` 与共享模型类型 / helper
- [x] T035 [US5] 在 `src/panoramic/architecture-overview-model.ts` 中补充 050 所需的结构化字段与 helper 注释

**Checkpoint**: 050 可以直接消费 045 的结构化输出，而不是重新拼装视图模型。

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 全量验证、更新任务状态、准备实现与提交。

- [x] T036 [P] 运行 `npx vitest run tests/panoramic/architecture-overview-generator.test.ts`
- [x] T037 [P] 运行相关 panoramic 回归测试：`runtime-topology` / `workspace-index` / `cross-package` / `generator-registry`
- [x] T038 [P] 运行 `npm run lint`
- [x] T039 [P] 运行 `npm run build`
- [x] T040 记录并修正分析阶段发现的问题，确保 spec / plan / tasks 与实现范围一致
- [x] T041 提交前执行 `git fetch origin && git rebase origin/master`
- [x] T042 更新本文件任务状态并完成代码提交

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001, FR-002 | T002, T013, T014, T030, T031 |
| FR-003, FR-011 | T010-T016 |
| FR-004, FR-005 | T017-T022 |
| FR-006 | T023-T027 |
| FR-007, FR-008, FR-012 | T001, T005-T008, T019, T032-T035 |
| FR-009, FR-010 | T028-T034 |
| FR-013 | T015, T027, T040 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成，阻塞所有 User Story
- **User Stories (Phase 3-7)**: 都依赖 Foundational 完成
- **Polish (Phase 8)**: 依赖所有目标故事完成

### User Story Dependencies

- **US1**: MVP，最先落地
- **US2**: 依赖 US1 的基本 generator 与 view model
- **US3**: 依赖 US1 / US2 的基础结构
- **US4**: 可在核心实现稳定后接入
- **US5**: 与 US4 可并行收尾，但依赖共享模型已基本成型

### Parallel Opportunities

- Setup 中的骨架与测试骨架任务可并行
- Foundational 中的 helper / contract 对齐任务可并行
- 同一 User Story 下的多个测试任务可并行
- Registry/export 任务在核心实现完成后可并行收尾
