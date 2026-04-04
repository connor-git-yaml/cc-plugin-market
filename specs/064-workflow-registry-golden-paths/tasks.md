# Tasks: Workflow Registry 与 Golden Paths (Feature 064)

**Input**: Design documents from `/specs/064-workflow-registry-golden-paths/`  
**Prerequisites**: `spec.md`, `plan.md`

**Tests**: 需要覆盖 workflow registry helper、override 限制、init-project 覆盖目录，以及 `lint` / `build` 验证。

## Phase 1: Setup

- [x] T001 创建 `spec.md`、`plan.md`、`tasks.md`
- [x] T002 [P] 创建 `plugins/spec-driver/workflows/*.yaml`
- [x] T003 [P] 创建 `plugins/spec-driver/workflows/golden-paths.yaml`
- [x] T004 [P] 创建 `plugins/spec-driver/scripts/generate-workflow-registry.mjs`
- [x] T005 [P] 创建 `tests/integration/spec-driver-workflow-registry.test.ts`

## Phase 2: Foundations

- [x] T006 实现 workflow definition 读取与 normalization
- [x] T007 实现 `.specify/workflows/*.yaml` metadata-only 覆盖规则
- [x] T008 实现 `workflow-index.md/.json` 写盘
- [x] T009 实现 golden path 汇总输出

## Phase 3: User Story 1 - 六个入口的 workflow definitions (P1)

- [x] T010 [US1] 为 `feature/story/fix/resume/sync/doc` 定义 YAML 合同
- [x] T011 [US1] 在当前仓库生成真实 `workflow-index.md/.json`

## Phase 4: User Story 2 - metadata-only 覆盖 (P1)

- [x] T012 [P] [US2] 编写 override 测试：允许 metadata，禁止 entryCommand 覆盖
- [x] T013 [US2] 更新 `init-project.sh`，预创建 `.specify/workflows/`
- [x] T014 [US2] 更新 `tests/integration/spec-driver-init-project.test.ts`

## Phase 5: User Story 3 - golden paths 与文档消费 (P2)

- [x] T015 [US3] 生成 3 条 golden paths
- [x] T016 [US3] 更新 `spec-driver-doc` source / codex skill，使其发现 `workflow-index`
- [x] T017 [US3] 更新 063 entity helper，优先引用真实 workflow definitions
- [x] T018 [US3] 刷新 `specs/products/spec-driver/entity.yaml` 与 `catalog-index.yaml`

## Phase 6: Validation

- [x] T019 运行 `npx vitest run tests/integration/spec-driver-workflow-registry.test.ts tests/integration/spec-driver-init-project.test.ts tests/integration/spec-driver-product-entity-catalog.test.ts`
- [x] T020 运行 `npm run lint`
- [x] T021 运行 `npm run build`
- [x] T022 在当前仓库执行 helper，确认生成 `workflow-index.md/.json`
