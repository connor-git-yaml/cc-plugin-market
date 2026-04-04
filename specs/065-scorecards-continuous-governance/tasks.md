# Tasks: Scorecards 与持续治理报告 (Feature 065)

**Input**: Design documents from `/specs/065-scorecards-continuous-governance/`  
**Prerequisites**: `spec.md`, `plan.md`

**Tests**: 需要覆盖 scorecard helper、init-project scorecards 目录、workflow registry 对 sync artifacts 的刷新，以及 `lint` / `build` 验证。

## Phase 1: Setup

- [x] T001 创建 `spec.md`、`plan.md`、`tasks.md`
- [x] T002 [P] 创建默认 ruleset `plugins/spec-driver/scorecards/default-governance.yaml`
- [x] T003 [P] 创建 scorecard helper `plugins/spec-driver/scripts/generate-product-scorecards.mjs`
- [x] T004 [P] 创建 `tests/integration/spec-driver-product-scorecards.test.ts`

## Phase 2: Foundations

- [x] T005 实现 scorecard rule DSL 读取与 merge
- [x] T006 实现 6 个首批 evaluator
- [x] T007 实现 `scorecard-report.md/.json` 与 `scorecard-index.yaml` 写盘
- [x] T008 实现 `entity.yaml` / `catalog-index.yaml` 的 scorecard 摘要回写

## Phase 3: User Story 1 - 持续治理评分 (P1)

- [x] T009 [US1] 让 `reverse-spec` 与 `spec-driver` 都可输出 scorecard report
- [x] T010 [US1] 复用 `quality-report.json` 作为 docs-coverage/docs-conflicts 证据
- [x] T011 [US1] 复用 `verification-report.md` 作为 verification-freshness 证据

## Phase 4: User Story 2 - Git 管理的规则与初始化入口 (P1)

- [x] T012 [US2] 更新 `init-project.sh`，创建 `.specify/scorecards/` 并导入默认 ruleset
- [x] T013 [US2] 更新 `tests/integration/spec-driver-init-project.test.ts`

## Phase 5: User Story 3 - sync / workflow 接入 (P2)

- [x] T014 [US3] 更新 `spec-driver-sync` 技能与 agent，纳入 scorecard helper
- [x] T015 [US3] 更新 `plugins/spec-driver/workflows/spec-driver-sync.yaml`
- [x] T016 [US3] 刷新 `workflow-index.md/.json`
- [x] T017 [US3] 刷新产品实体与 catalog 摘要

## Phase 6: Validation

- [x] T018 运行 `npx vitest run tests/integration/spec-driver-product-scorecards.test.ts tests/integration/spec-driver-workflow-registry.test.ts tests/integration/spec-driver-init-project.test.ts tests/integration/spec-driver-product-entity-catalog.test.ts`
- [x] T019 运行 `npm run lint`
- [x] T020 运行 `npm run build`
- [x] T021 在当前仓库执行 scorecard helper，生成真实 `scorecard-report` 与 `scorecard-index`
