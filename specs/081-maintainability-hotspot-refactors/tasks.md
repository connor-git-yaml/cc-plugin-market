# Tasks: 可读性与维护性热点重构

**Input**: Design documents from `/specs/081-maintainability-hotspot-refactors/`  
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`  

**Tests**: 本 Feature 明确要求 targeted unit tests、相关 integration regressions，以及 `npm run lint`、`npm run build`、`npm test`。  

**Organization**: 任务按共享热点基础设施、User Story 和验证阶段分组，确保每个故事可独立推进和回归。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行
- **[Story]**: 所属 User Story（US1-US3）
- 所有路径均为仓库根目录相对路径

---

## Phase 1: Setup (Hotspot Baseline & Skeleton)

**Purpose**: 建立 081 的核心模块落点、测试入口和复杂度基线。

- [x] T001 创建 `plugins/spec-driver/scripts/lib/workflow-registry-core.mjs` 骨架
- [x] T002 [P] 创建 `plugins/spec-driver/scripts/lib/product-quality-core.mjs` 骨架
- [x] T003 [P] 创建 `plugins/spec-driver/scripts/lib/product-scorecard-core.mjs` 骨架
- [x] T004 [P] 在 `tests/unit/workflow-registry-core.test.ts` 创建单测骨架
- [x] T005 [P] 在 `tests/unit/product-quality-core.test.ts` 创建单测骨架
- [x] T006 [P] 在 `tests/unit/product-scorecard-core.test.ts` 创建单测骨架
- [x] T007 [P] 记录四个热点入口文件的基线复杂度到 `specs/081-maintainability-hotspot-refactors/verification/verification-report.md`

**Checkpoint**: 核心模块和测试落点稳定，可开始逐个热点迁移。

---

## Phase 2: Foundational (Shared Hotspot Core)

**Purpose**: 先把热点核心逻辑抽到可复用、可测试的 core modules。

- [x] T008 在 `plugins/spec-driver/scripts/lib/workflow-registry-core.mjs` 中实现 workflow definitions / overrides / golden paths 读取与 registry assembly 骨架
- [x] T009 [P] 在 `plugins/spec-driver/scripts/lib/product-quality-core.mjs` 中实现 document refs / stats / status / conflict / markdown rendering 骨架
- [x] T010 [P] 在 `plugins/spec-driver/scripts/lib/product-scorecard-core.mjs` 中实现 ruleset loading / report assembly / markdown rendering 骨架
- [x] T011 [P] 在 `tests/unit/workflow-registry-core.test.ts` 中补 definitions/override/golden path/markdown 基础用例
- [x] T012 [P] 在 `tests/unit/product-quality-core.test.ts` 中补 required-doc / stats / status / markdown 基础用例
- [x] T013 [P] 在 `tests/unit/product-scorecard-core.test.ts` 中补 ruleset / summary / markdown 基础用例

**Checkpoint**: 三个 core modules 可直接被单测驱动，热点入口可开始变薄。

---

## Phase 3: User Story 1 - 热点生成脚本变薄且更可读 (Priority: P1) 🎯 MVP

**Goal**: 让 `scorecards`、`quality-reports`、`workflow-registry` 三个热点入口文件退回 thin orchestrator 角色。

**Independent Test**: 运行新增 targeted unit tests 与相关 integration tests，确认核心逻辑可小粒度验证，且 CLI / 产物合同不变。

### Tests for User Story 1

- [x] T014 [P] [US1] 运行并必要时调整 `tests/unit/workflow-registry-core.test.ts`
- [x] T015 [P] [US1] 运行并必要时调整 `tests/unit/product-quality-core.test.ts`
- [x] T016 [P] [US1] 运行并必要时调整 `tests/unit/product-scorecard-core.test.ts`
- [x] T017 [P] [US1] 运行并必要时调整 `tests/integration/spec-driver-workflow-registry.test.ts`
- [x] T018 [P] [US1] 运行并必要时调整 `tests/integration/spec-driver-product-quality-reports.test.ts`
- [x] T019 [P] [US1] 运行并必要时调整 `tests/integration/spec-driver-product-scorecards.test.ts`

### Implementation for User Story 1

- [x] T020 [US1] 修改 `plugins/spec-driver/scripts/generate-workflow-registry.mjs`，让入口仅保留参数解析、orchestration 和输出，definitions/overrides/golden paths/markdown 迁入 `workflow-registry-core.mjs`
- [x] T021 [US1] 修改 `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`，让入口仅保留 orchestration，document refs / stats / conflicts / markdown 迁入 `product-quality-core.mjs`
- [x] T022 [US1] 修改 `plugins/spec-driver/scripts/generate-product-scorecards.mjs`，让入口仅保留 orchestration，ruleset loading / report assembly / markdown 迁入 `product-scorecard-core.mjs`
- [x] T023 [US1] 统一三个入口文件中剩余的输出和路径逻辑，确保继续复用 078 shared helpers 而不是新增本地 helper

**Checkpoint**: 三个 `.mjs` 热点入口明显变薄，并且核心逻辑已落到 core modules 中。

---

## Phase 4: User Story 2 - init-project 启动脚本的阶段边界更清楚 (Priority: P1)

**Goal**: 让 `init-project.sh` 的阶段划分、状态探测和输出渲染关系更清晰，同时保持当前 JSON/text 合同。

**Independent Test**: 运行 `spec-driver-init-project`、`init-command` 和 `init-e2e` 回归，确认初始化合同未漂移。

### Tests for User Story 2

- [x] T024 [P] [US2] 运行并必要时调整 `tests/integration/spec-driver-init-project.test.ts`
- [x] T025 [P] [US2] 运行并必要时调整 `tests/unit/init-command.test.ts`
- [x] T026 [P] [US2] 运行并必要时调整 `tests/integration/init-e2e.test.ts`
- [x] T027 [P] [US2] 如 `init-project.sh` 抽出 output/render shell helper，则补针对该 helper 的 focused regression 覆盖

### Implementation for User Story 2

- [x] T028 [US2] 重构 `plugins/spec-driver/scripts/init-project.sh` 的主流程，明确 parse args、directory init、template sync、scorecard sync、status detection、output render、main 阶段函数
- [x] T029 [US2] 将 `init-project.sh` 的 JSON/text 输出渲染与状态探测解耦；必要时新增 `plugins/spec-driver/scripts/lib/init-project-output.sh`
- [x] T030 [US2] 保持 `NEEDS_CONSTITUTION`、`NEEDS_CONFIG`、`HAS_SPEC_DRIVER_SKILLS`、`PROJECT_CONTEXT_MODE`、`SKILL_MAP`、`RESULTS` 合同不变

**Checkpoint**: `init-project.sh` 可读性提升，主流程边界清晰，初始化输出合同保持稳定。

---

## Phase 5: User Story 3 - 热点重构后测试更容易补而不是更难写 (Priority: P2)

**Goal**: 用 targeted unit tests 和更清晰的模块边界证明 081 真正降低了维护成本。

**Independent Test**: 维护者可以直接导入 core module 进行小粒度测试，同时原有 integration regressions 继续通过。

### Tests for User Story 3

- [x] T031 [P] [US3] 为 `workflow-registry-core` 增加针对 override merge 和 markdown rendering 的定向测试
- [x] T032 [P] [US3] 为 `product-quality-core` 增加针对 required-doc / conflicts / summary 的定向测试
- [x] T033 [P] [US3] 为 `product-scorecard-core` 增加针对规则求值摘要或 report assembly 的定向测试
- [x] T034 [P] [US3] 如有新增 shell helper，补 focused assertion 覆盖 dual/legacy/yaml / output render 分支

### Implementation for User Story 3

- [x] T035 [US3] 清理三类热点入口和 `init-project.sh` 中的死代码、重复 helper 和未使用 import/变量
- [x] T036 [US3] 在 `specs/081-maintainability-hotspot-refactors/verification/verification-report.md` 记录热点重构前后行数、内联 helper 数量或职责边界变化
- [x] T037 [US3] 更新 `specs/products/spec-driver/current-spec.md`，记录 081 已落地的热点重构能力

**Checkpoint**: 081 能提供“入口更薄 + 测试更容易写”的明确证据，而不是仅有重构描述。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 完成验证、主线同步与提交准备。

- [x] T038 [P] 运行 `npx vitest run tests/unit/workflow-registry-core.test.ts tests/unit/product-quality-core.test.ts tests/unit/product-scorecard-core.test.ts`
- [x] T039 [P] 运行 `npx vitest run tests/integration/spec-driver-workflow-registry.test.ts tests/integration/spec-driver-product-quality-reports.test.ts tests/integration/spec-driver-product-scorecards.test.ts`
- [x] T040 [P] 运行 `npx vitest run tests/integration/spec-driver-init-project.test.ts tests/unit/init-command.test.ts tests/integration/init-e2e.test.ts`
- [x] T041 [P] 运行 `npm run lint`
- [x] T042 [P] 运行 `npm run build`
- [x] T043 [P] 运行 `npm test`
- [x] T044 执行复杂度检索，记录四个热点入口文件在重构前后的行数和结构变化
- [x] T045 更新 `specs/081-maintainability-hotspot-refactors/verification/verification-report.md`
- [x] T046 提交前执行 `git fetch origin && git rebase origin/master`
- [x] T047 更新任务状态并完成代码提交

---

## FR 覆盖映射

| FR | 覆盖任务 |
|----|----------|
| FR-001 | T007-T010, T020-T030 |
| FR-002 | T010, T016, T019, T022 |
| FR-003 | T009, T015, T018, T021 |
| FR-004 | T008, T014, T017, T020 |
| FR-005 | T024-T030 |
| FR-006 | T020-T023, T029 |
| FR-007 | T017-T019, T024-T026, T039-T043 |
| FR-008 | T028-T030, T046 |
| FR-009 | T011-T013, T031-T034 |
| FR-010 | T017-T019, T024-T026, T038-T043 |
| FR-011 | T007, T020-T030, T036-T037 |
| FR-012 | T007, T044-T045 |
| FR-013 | T036-T037, T045 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Setup，阻塞热点入口迁移
- **US1 (Phase 3)**: 依赖 Foundational 完成
- **US2 (Phase 4)**: 可与 US1 并行推进，但建议在 JS 热点模式稳定后执行
- **US3 (Phase 5)**: 依赖 US1/US2 基本完成后进行清理和证据化
- **Polish (Phase 6)**: 依赖目标故事完成

### User Story Dependencies

- **US1**: MVP，先拿下三类 `.mjs` 热点的薄入口重构
- **US2**: 聚焦 `init-project.sh`，保持 shell 合同稳定
- **US3**: 为后续维护提供 targeted tests 和复杂度证据

### Parallel Opportunities

- Setup 中的 core module 和 unit test skeleton 可并行
- Foundational 中三个 core modules 和对应单测可并行
- US1 中 workflow/quality/scorecard 的 targeted tests 与 integration regressions 可并行
- US2 中 `init-project` 相关三个回归可并行
- Polish 阶段的定向测试、lint、build 和全量测试可顺序或分组执行

### Recommended Implementation Strategy

1. 先收 `workflow-registry`，建立最小热点切分样板
2. 再收 `quality-reports`
3. 再收最复杂的 `scorecards`
4. 最后整理 `init-project.sh` 的阶段边界和输出逻辑
5. 补复杂度对比与 verification report，完成主线验证
