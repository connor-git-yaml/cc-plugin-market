# Tasks: 架构模式提示与解释

**Input**: Design documents from `/specs/050-pattern-hints-explanation/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本 Feature 明确要求覆盖一组“045 架构概览输入 -> 050 模式提示输出”测试和一组“LLM / 弱依赖降级”测试，并通过 `npm run lint`、相关 `vitest` 用例和 `npm run build`。

**Organization**: 任务按共享基础设施、User Story 和验证阶段分组，确保每个故事可独立验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行
- **[Story]**: 所属 User Story（US1-US5）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 为 050 建立共享 pattern model、知识库、generator、模板和测试骨架。

- [x] T001 创建 `src/panoramic/pattern-hints-model.ts`，定义 050 共享 pattern hint 模型骨架
- [x] T002 [P] 创建 `src/panoramic/pattern-knowledge-base.ts` 骨架，导出知识库与规则 helper
- [x] T003 [P] 创建 `src/panoramic/pattern-hints-generator.ts` 骨架，导出 `PatternHintsGenerator`
- [x] T004 [P] 创建 `templates/pattern-hints.hbs` 模板骨架
- [x] T005 [P] 创建 `tests/panoramic/pattern-hints-generator.test.ts` 测试骨架与 fixture helper

**Checkpoint**: 新增文件骨架存在，编译层面不因缺文件直接失败。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 定义共享模型、知识库规则、输入输出契约和附录渲染策略，作为所有 User Story 的共同基础。

- [x] T006 在 `src/panoramic/pattern-hints-model.ts` 中实现 `PatternHintsModel`、`PatternHint`、`PatternAlternative`、`PatternEvidenceRef`、`PatternHintStats`
- [x] T007 [P] 在 `src/panoramic/pattern-knowledge-base.ts` 中实现 `PatternKnowledgeBaseEntry`、`PatternSignalRule` 与首批模式定义
- [x] T008 [P] 在 `src/panoramic/pattern-hints-generator.ts` 中定义 `PatternHintsInput` / `PatternHintsOutput`
- [x] T009 [P] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 base overview render + appendix render 的拼接 helper
- [x] T010 修改 `specs/050-pattern-hints-explanation/contracts/pattern-hints-output.md` 与实现保持一致

**Checkpoint**: 共享模型和输入输出契约稳定，User Story 实现可开始。

---

## Phase 3: User Story 1 - 在架构概览中输出模式提示附录 (Priority: P1) 🎯 MVP

**Goal**: 基于 045 架构概览生成至少一个 pattern hint，并将其以附录方式追加到架构概览文档中。

**Independent Test**: 通过包含 Compose + workspace + cross-package 的 fixture 运行 `extract -> generate -> render`，验证输出是单份架构概览文档，且包含 pattern hints 附录。

### Tests for User Story 1

- [x] T011 [P] [US1] 编写组合测试：`tests/panoramic/pattern-hints-generator.test.ts` 覆盖 045 架构概览输入到 050 模式提示输出
- [x] T012 [P] [US1] 编写 render 测试：验证 Markdown 同时包含架构概览正文与“架构模式提示”附录标题
- [x] T013 [P] [US1] 编写 no-match 测试：当无模式过阈值时输出明确结论

### Implementation for User Story 1

- [x] T014 [US1] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 `extract()`，组合调用 `ArchitectureOverviewGenerator`
- [x] T015 [US1] 在 `src/panoramic/pattern-knowledge-base.ts` 中实现基础规则评估，生成首批 pattern hints
- [x] T016 [US1] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 `generate()`，构造 `PatternHintsModel`
- [x] T017 [US1] 在 `templates/pattern-hints.hbs` 中实现附录模板，渲染模式摘要与 no-match 结论
- [x] T018 [US1] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 `render()`，拼接 045 正文与 050 附录

**Checkpoint**: User Story 1 可独立生成“架构概览 + 模式提示附录”，是 050 的 MVP。

---

## Phase 4: User Story 2 - 证据链与 why/why-not explanation (Priority: P1)

**Goal**: 保证 pattern hints 具备 evidence、alternatives 和至少一个 why/why-not explanation。

**Independent Test**: 固定一组存在竞争模式的 fixture，验证输出中的高置信度模式包含 matched evidence、competing alternatives 和 why/why-not explanation。

### Tests for User Story 2

- [x] T019 [P] [US2] 编写 evidence 测试：每个已识别模式都保留来源于 045 结构化输出的证据链
- [x] T020 [P] [US2] 编写 explanation 测试：至少 1 个模式包含“为何判定 / 为何不是其他模式”的说明
- [x] T021 [P] [US2] 编写 alternatives 测试：竞争模式会出现在 `competingAlternatives` 中而不是被静默丢弃

### Implementation for User Story 2

- [x] T022 [US2] 在 `src/panoramic/pattern-hints-model.ts` 中补充 evidence / alternative / explanation 字段与 helper
- [x] T023 [US2] 在 `src/panoramic/pattern-knowledge-base.ts` 中实现 matched signals、counter-signals 与 alternatives 组装
- [x] T024 [US2] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 why/why-not explanation 生成逻辑

**Checkpoint**: 050 的模式提示不再是标签列表，而是可解释、可复核的判断结果。

---

## Phase 5: User Story 3 - 输入不完整或 LLM 不可用时的降级输出 (Priority: P2)

**Goal**: 在缺少部分架构版块、弱依赖不可用或 `useLLM=true` 但模型不可用时，仍能生成可审查结果。

**Independent Test**: 对“只有 system + layered”“无高置信度模式”“useLLM=true 但 explanation 增强不可用”三类场景运行生成器，验证 warning 与 no-match / fallback 行为。

### Tests for User Story 3

- [x] T025 [P] [US3] 编写降级测试：缺少 deployment view 时仍生成 pattern hints，并降低相关模式置信度
- [x] T026 [P] [US3] 编写 fallback 测试：`useLLM=true` 但模型不可用时不抛异常
- [x] T027 [P] [US3] 编写 warning 测试：缺失弱依赖或缺失 section 时在结构化输出和 Markdown 中均可见

### Implementation for User Story 3

- [x] T028 [US3] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 section-aware confidence downgrade 与 warnings 聚合
- [x] T029 [US3] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 `useLLM=true` 的 explanation 增强与安全降级
- [x] T030 [US3] 在 `templates/pattern-hints.hbs` 中实现 warnings、missing reason 与 no-match 渲染

**Checkpoint**: 050 在真实项目输入不完整时仍能静默降级，不阻断主文档。

---

## Phase 6: User Story 4 - Registry 发现与主流程调用 (Priority: P2)

**Goal**: 让 `PatternHintsGenerator` 被现有 panoramic 工具链发现和调用。

**Independent Test**: 调用 `bootstrapGenerators()` 后查询 `pattern-hints`，并验证具备 045 信号的上下文可被 `filterByContext()` 返回。

### Tests for User Story 4

- [x] T031 [P] [US4] 编写 registry 测试：`bootstrapGenerators()` 后可通过 `pattern-hints` id 查询
- [x] T032 [P] [US4] 编写适用性测试：具备 architecture-overview 信号的上下文能发现该 generator

### Implementation for User Story 4

- [x] T033 [US4] 修改 `src/panoramic/generator-registry.ts` 注册 `PatternHintsGenerator`
- [x] T034 [US4] 在 `src/panoramic/pattern-hints-generator.ts` 中实现 `isApplicable()` 逻辑

**Checkpoint**: 050 已接入 registry，可被 panoramic 主流程发现。

---

## Phase 7: User Story 5 - 维护可演进的知识库与共享输出 (Priority: P2)

**Goal**: 将 050 的共享结构与知识库边界稳定下来，供后续新增模式或其他消费方直接复用。

**Independent Test**: 验证 `PatternHintsModel` 不包含模板字段，且 barrel export 与知识库 helper 可直接导入。

### Tests for User Story 5

- [x] T035 [P] [US5] 编写共享模型测试：`PatternHintsModel` 不包含 Markdown / Handlebars 字段
- [x] T036 [P] [US5] 编写 barrel export 测试：`src/panoramic/index.ts` 导出 generator、model 与 knowledge-base helper
- [x] T037 [P] [US5] 编写知识库扩展测试：新增模式定义时无需修改 045 共享模型

### Implementation for User Story 5

- [x] T038 [US5] 在 `src/panoramic/index.ts` 中导出 `PatternHintsGenerator`、共享模型类型与 knowledge-base helper
- [x] T039 [US5] 在 `src/panoramic/pattern-knowledge-base.ts` 中补充可扩展注释和默认模式目录

**Checkpoint**: 050 可在不改动 045 模型的前提下持续新增模式规则。

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 全量验证、更新任务状态、准备实现与提交。

- [x] T040 [P] 运行 `npx vitest run tests/panoramic/pattern-hints-generator.test.ts`
- [x] T041 [P] 运行相关 panoramic 回归测试：`architecture-overview` / `runtime-topology` / `generator-registry`
- [x] T042 [P] 运行 `npm run lint`
- [x] T043 [P] 运行 `npm run build`
- [x] T044 记录并修正分析阶段发现的问题，确保 spec / plan / tasks 与实现范围一致
- [x] T045 提交前执行 `git fetch origin && git rebase origin/master`
- [x] T046 更新本文件任务状态并完成代码提交

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001, FR-002 | T003, T014, T016, T033, T034 |
| FR-003, FR-004 | T011-T018 |
| FR-005, FR-006, FR-007 | T019-T024 |
| FR-008, FR-009, FR-013, FR-014 | T025-T030 |
| FR-010, FR-011 | T001, T002, T006-T010, T035-T039 |
| FR-012 | T026, T029, T044 |
| FR-015 | T031-T038 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成，阻塞所有 User Story
- **User Stories (Phase 3-7)**: 都依赖 Foundational 完成
- **Polish (Phase 8)**: 依赖所有目标故事完成

### User Story Dependencies

- **US1**: MVP，最先落地
- **US2**: 依赖 US1 的基本 pattern output 与 appendix render
- **US3**: 依赖 US1 / US2 的基础结构
- **US4**: 可在核心实现稳定后接入
- **US5**: 与 US4 可并行收尾，但依赖共享模型和知识库已基本成型

### Parallel Opportunities

- Setup 中的模型、知识库、模板和测试骨架任务可并行
- Foundational 中的 model / contract / render helper 任务可并行
- 同一 User Story 下的多个测试任务可并行
- Registry/export 和知识库扩展任务在核心实现完成后可并行收尾

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "编写组合测试：tests/panoramic/pattern-hints-generator.test.ts 覆盖 045 架构概览输入到 050 模式提示输出"
Task: "编写 render 测试：验证 Markdown 同时包含架构概览正文与架构模式提示附录"
Task: "编写 no-match 测试：当无模式过阈值时输出明确结论"

# Launch independent setup work together:
Task: "创建 src/panoramic/pattern-hints-model.ts"
Task: "创建 src/panoramic/pattern-knowledge-base.ts"
Task: "创建 templates/pattern-hints.hbs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational
3. 完成 Phase 3: User Story 1
4. **STOP and VALIDATE**: 先验证“045 正文 + 050 附录”的主交付形态

### Incremental Delivery

1. 在 MVP 稳定后补齐 US2 的 evidence / why-not explanation
2. 再补齐 US3 的降级与 optional LLM explanation
3. 最后接入 US4 / US5 的 registry 与可扩展知识库边界
