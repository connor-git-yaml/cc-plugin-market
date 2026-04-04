# Tasks: 产品实体目录与 Catalog 生成 (Feature 063)

**Input**: Design documents from `/specs/063-product-entity-catalog/`  
**Prerequisites**: `spec.md`, `plan.md`

**Tests**: 需要覆盖 Catalog helper 集成测试，以及 `lint` / `build` 验证。

## Phase 1: Setup

- [x] T001 创建 `spec.md`、`plan.md`、`tasks.md`
- [x] T002 [P] 创建 `plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`
- [x] T003 [P] 创建 `tests/integration/spec-driver-product-entity-catalog.test.ts`

## Phase 2: Foundations

- [x] T004 实现 `product-mapping.yaml` 读取与 `current-spec.md` 元数据提取
- [x] T005 实现 `entity.yaml` 与 `catalog-index.yaml` YAML 写盘
- [x] T006 实现 repo metadata、quality report 与 workflowRefs 推断

## Phase 3: User Story 1 - 生成实体目录 (P1)

- [x] T007 [P] [US1] 编写集成测试：两个产品都生成 entity 与 catalog-index
- [x] T008 [US1] 为 `reverse-spec` 与 `spec-driver` 生成真实 `entity.yaml`
- [x] T009 [US1] 在当前仓库根生成真实 `catalog-index.yaml`

## Phase 4: User Story 2 - 接入 sync 主流程 (P1)

- [x] T010 [US2] 更新 `plugins/spec-driver/skills/spec-driver-sync/SKILL.md`
- [x] T011 [US2] 更新 `.codex/skills/spec-driver-sync/SKILL.md`
- [x] T012 [US2] 更新 `plugins/spec-driver/agents/sync.md`，明确后置 helper 边界

## Phase 5: User Story 3 - unknown / inferred 降级 (P2)

- [x] T013 [P] [US3] 编写集成测试：缺失 `current-spec.md` 时输出 warning 与 `unknown`
- [x] T014 [US3] 实现缺失 owner / lifecycle / quality report 时的显式降级

## Phase 6: Validation

- [x] T015 运行 `npx vitest run tests/integration/spec-driver-product-entity-catalog.test.ts`
- [x] T016 运行 `npm run lint`
- [x] T017 运行 `npm run build`
- [x] T018 在当前仓库执行 helper，确认生成 `reverse-spec/entity.yaml`、`spec-driver/entity.yaml` 与 `catalog-index.yaml`
