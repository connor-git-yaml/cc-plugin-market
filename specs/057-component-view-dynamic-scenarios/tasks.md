# Tasks: 组件视图与动态链路文档

**Input**: Design documents from `/specs/057-component-view-dynamic-scenarios/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本 Feature 明确要求覆盖 component 识别、dynamic scenario 主链路、batch 集成与降级行为，并通过 `npm run lint`、相关 `vitest` 用例和 `npm run build`。

**Organization**: 任务按共享基础设施、User Story 和验证阶段分组，确保每个故事可独立验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行
- **[Story]**: 所属 User Story（US1-US3）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 为 057 建立共享 helper、模型、模板和测试骨架。

- [ ] T001 创建 `src/panoramic/stored-module-specs.ts` 骨架，定义 stored module spec 读取与基础类型
- [ ] T002 [P] 创建 `src/panoramic/component-view-model.ts` 骨架，定义 component / scenario 共享模型
- [ ] T003 [P] 创建 `src/panoramic/component-view-builder.ts` 骨架
- [ ] T004 [P] 创建 `src/panoramic/dynamic-scenarios-builder.ts` 骨架
- [ ] T005 [P] 创建 `templates/component-view.hbs`
- [ ] T006 [P] 创建 `templates/dynamic-scenarios.hbs`
- [ ] T007 [P] 创建 `tests/panoramic/component-view-builder.test.ts` 测试骨架
- [ ] T008 [P] 创建 `tests/panoramic/dynamic-scenarios-builder.test.ts` 测试骨架

**Checkpoint**: 新增文件骨架存在，代码库对 057 文件路径有稳定落点。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 抽出 stored module spec 共享读取能力，稳定共享模型和证据语义，阻塞后续所有 User Story。

- [ ] T009 在 `src/panoramic/stored-module-specs.ts` 中实现递归扫描 `*.spec.md`、frontmatter 解析、baseline skeleton 提取
- [ ] T010 [P] 修改 `src/panoramic/architecture-narrative.ts` 复用 `stored-module-specs.ts`，避免 duplicate parser 逻辑
- [ ] T011 在 `src/panoramic/component-view-model.ts` 中实现 `ComponentEvidenceRef`、`ComponentDescriptor`、`ComponentRelationship`、`ComponentViewModel`
- [ ] T012 [P] 在 `src/panoramic/component-view-model.ts` 中实现 `DynamicScenarioStep`、`DynamicScenario`、`DynamicScenarioModel`
- [ ] T013 [P] 在 `src/panoramic/component-view-builder.ts` / `src/panoramic/dynamic-scenarios-builder.ts` 中实现名称分类、test-noise 降权、confidence helper
- [ ] T014 [P] 对齐 `specs/057-component-view-dynamic-scenarios/contracts/component-dynamic-output.md` 与共享模型语义

**Checkpoint**: 057 的共享 helper、证据模型和排序基础稳定，User Story 可开始实现。

---

## Phase 3: User Story 1 - 输出关键组件视图 (Priority: P1) 🎯 MVP

**Goal**: 生成包含关键组件、组件分组、职责、关系和 Mermaid 图的 component view。

**Independent Test**: 使用 `ArchitectureIR` + stored module specs fixture 运行 component builder，验证关键组件识别和组件关系输出。

### Tests for User Story 1

- [ ] T015 [P] [US1] 编写 component 识别测试：`tests/panoramic/component-view-builder.test.ts` 覆盖 `Query`、`Client`、`Transport`、`Parser` 类型识别
- [ ] T016 [P] [US1] 编写排序测试：验证 `Test*` / `test_*` 符号被降权，关键实现组件优先保留
- [ ] T017 [P] [US1] 编写渲染测试：验证 `component-view` Markdown 包含摘要、关键组件、关系说明和 Mermaid block

### Implementation for User Story 1

- [ ] T018 [US1] 在 `src/panoramic/component-view-builder.ts` 中实现基于 `ArchitectureIR` + stored module specs 的组件聚合
- [ ] T019 [US1] 在 `src/panoramic/component-view-builder.ts` 中实现分组、关系映射和 Mermaid component diagram 生成
- [ ] T020 [US1] 在 `templates/component-view.hbs` 中实现 component view 模板，渲染关键组件、分组、关系和 warning

**Checkpoint**: User Story 1 可独立输出完整 `component-view.md/.json/.mmd`，是 057 的 MVP。

---

## Phase 4: User Story 2 - 输出可讲述的动态场景链路 (Priority: P1)

**Goal**: 输出包含 ordered steps、参与者、hand-off 和 evidence 的 dynamic scenarios。

**Independent Test**: 用带 `query -> transport -> parser` 信号的 fixture 运行 scenario builder，验证至少 1 条 request/control 主链路。

### Tests for User Story 2

- [ ] T021 [P] [US2] 编写主链路测试：`tests/panoramic/dynamic-scenarios-builder.test.ts` 覆盖 `query()` -> transport -> parser 场景
- [ ] T022 [P] [US2] 编写降级测试：缺失 runtime/event 证据时仍输出保守步骤并降低 confidence
- [ ] T023 [P] [US2] 编写渲染测试：验证 `dynamic-scenarios` Markdown 包含 ordered steps、participants、evidence 和 warning

### Implementation for User Story 2

- [ ] T024 [US2] 在 `src/panoramic/dynamic-scenarios-builder.ts` 中实现入口点识别、participants 构建和 ordered step 推断
- [ ] T025 [US2] 在 `src/panoramic/dynamic-scenarios-builder.ts` 中实现 runtime/event/test 弱信号增强与 confidence 聚合
- [ ] T026 [US2] 在 `templates/dynamic-scenarios.hbs` 中实现动态场景模板，渲染场景摘要、步骤和 outcome

**Checkpoint**: User Story 2 可独立输出 `dynamic-scenarios.md/.json`，并解释核心主链路。

---

## Phase 5: User Story 3 - 批量项目文档套件保持兼容 (Priority: P2)

**Goal**: 将 057 接入 batch 项目级文档套件，且不破坏现有项目文档和 ADR pipeline。

**Independent Test**: 运行现有 batch fixture，验证原有输出保留，同时新增 `component-view.*` 与 `dynamic-scenarios.*`。

### Tests for User Story 3

- [ ] T027 [P] [US3] 修改 `tests/integration/batch-panoramic-doc-suite.test.ts`，断言新增 `component-view.md/.json/.mmd`
- [ ] T028 [P] [US3] 修改 `tests/integration/batch-panoramic-doc-suite.test.ts`，断言新增 `dynamic-scenarios.md/.json`
- [ ] T029 [P] [US3] 修改 `tests/panoramic/architecture-narrative.test.ts`，验证共享 stored-module helper 重构后 narrative 不回归

### Implementation for User Story 3

- [ ] T030 [US3] 修改 `src/panoramic/batch-project-docs.ts`，在 `architecture-narrative` 后接入 057 builder 与 `writeMultiFormat()`
- [ ] T031 [US3] 修改 `src/panoramic/index.ts`，导出 057 的共享模型与 builder helper，供 059 复用
- [ ] T032 [US3] 在 `src/panoramic/batch-project-docs.ts` 中实现 057 失败降级与 warning 汇总，保证 ADR pipeline 与其他项目文档不受阻断

**Checkpoint**: 057 已成为 batch 项目级文档的一部分，且现有链路保持兼容。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 完成验证、真实样例检查、主线同步与提交准备。

- [ ] T033 [P] 运行 `npx vitest run tests/panoramic/component-view-builder.test.ts`
- [ ] T034 [P] 运行 `npx vitest run tests/panoramic/dynamic-scenarios-builder.test.ts`
- [ ] T035 [P] 运行 `npx vitest run tests/panoramic/architecture-narrative.test.ts tests/panoramic/architecture-ir-generator.test.ts tests/panoramic/event-surface-generator.test.ts`
- [ ] T036 [P] 运行 `npx vitest run tests/integration/batch-panoramic-doc-suite.test.ts`
- [ ] T037 [P] 运行 `npm run lint`
- [ ] T038 [P] 运行 `npm run build`
- [ ] T039 以 `claude-agent-sdk-python` 或等价 fixture 做一次真实 / 准真实验证，并将结果记录到 `specs/057-component-view-dynamic-scenarios/verification/verification-report.md`
- [ ] T040 提交前执行 `git fetch origin && git rebase origin/master`
- [ ] T041 更新任务状态并完成代码提交

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001 | T011, T018, T030 |
| FR-002 | T005, T017, T019, T020, T030 |
| FR-003 | T006, T023, T026, T030 |
| FR-004 | T015-T020 |
| FR-005 | T009, T010, T018, T024 |
| FR-006 | T013, T016, T018 |
| FR-007 | T021-T026 |
| FR-008 | T021, T024, T025 |
| FR-009 | T022, T025, T032 |
| FR-010 | T027, T028, T030, T032 |
| FR-011 | T029, T030, T032, T036 |
| FR-012 | T011, T012, T023, T031 |
| FR-013 | T030, T037, T038, T040 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成，阻塞所有 User Story
- **User Stories (Phase 3-5)**: 都依赖 Foundational 完成
- **Polish (Phase 6)**: 依赖所有目标故事完成

### User Story Dependencies

- **US1**: MVP，最先落地
- **US2**: 依赖 US1 的 component outputs
- **US3**: 依赖 US1 / US2 的结构和模板稳定后再集成到 batch

### Parallel Opportunities

- Setup 中的模板与测试骨架任务可并行
- Foundational 中的 helper、共享模型和 contract 对齐任务可并行
- US1 / US2 内的测试任务可并行
- Polish 阶段的各类定向测试与 lint/build 可并行安排

### Recommended Implementation Strategy

1. 先完成 shared helper 与模型，确保 057 与 `architecture-narrative` 共用同一份 stored spec 读取逻辑
2. 再交付 `component-view` 作为 MVP
3. 在 `component-view` 稳定后叠加 `dynamic-scenarios`
4. 最后接回 batch，做真实项目验证与提交
