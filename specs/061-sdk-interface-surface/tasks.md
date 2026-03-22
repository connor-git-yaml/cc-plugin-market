# Tasks: SDK / Library Interface Surface (Feature 061)

**Input**: Design documents from `/specs/061-sdk-interface-surface/`  
**Prerequisites**: `spec.md`, `plan.md`

**Tests**: 需要覆盖 generator 单测、quality/docs-bundle 规则测试、batch 集成测试、真实样例验证。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `spec.md`、`plan.md`、`tasks.md`
- [x] T002 [P] 创建 `templates/interface-surface.hbs`
- [x] T003 [P] 创建 `tests/panoramic/interface-surface-generator.test.ts`

## Phase 2: Foundations

- [x] T004 实现 `src/panoramic/interface-surface-generator.ts`
- [x] T005 定义 `InterfaceSurfaceModule`、`InterfaceSurfaceSymbol`、`InterfaceSurfaceOutput`
- [x] T006 将 `interface-surface` 接入 `output-filenames.ts`、`generator-registry.ts` 与 `src/panoramic/index.ts`

## Phase 3: User Story 1 - 生成 SDK / library 接口文档 (P1)

- [x] T007 [P] [US1] 为 Python / Node library fixture 编写 generator 单测
- [x] T008 [US1] 从 stored module specs 聚合公开模块、公开符号与关键方法
- [x] T009 [US1] 对低信号路径降权，优先 entrypoint / core 模块

## Phase 4: User Story 2 - 修正 library / SDK quality gate (P1)

- [x] T010 [P] [US2] 更新 `tests/panoramic/docs-quality-evaluator.test.ts`
- [x] T011 [US2] 在 `docs-quality-evaluator.ts` 中拆分 `http-api` / `library-sdk` 规则
- [x] T012 [US2] 确保 `api-surface` 不再作为 SDK 项目的必需缺失项

## Phase 5: User Story 3 - Bundle 接口消费视图兼容 API 与 SDK (P2)

- [x] T013 [P] [US3] 更新 `tests/panoramic/docs-bundle-orchestrator.test.ts`
- [x] T014 [US3] 扩展 `api-consumer` profile 与 docs bundle 元数据
- [x] T015 [US3] 添加 library / SDK batch 集成测试

## Phase 6: Validation

- [x] T016 运行 `npx vitest run tests/panoramic/interface-surface-generator.test.ts tests/panoramic/docs-quality-evaluator.test.ts tests/panoramic/docs-bundle-orchestrator.test.ts tests/integration/batch-interface-surface.test.ts tests/integration/batch-panoramic-doc-suite.test.ts`
- [x] T017 运行 `npm run lint`
- [x] T018 运行 `npm run build`
- [x] T019 [P] 用 `claude-agent-sdk-python` 真实样例验证 `interface-surface` 产出与 quality gate 改善
