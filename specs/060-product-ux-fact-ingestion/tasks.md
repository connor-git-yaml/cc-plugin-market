# Tasks: 产品 / UX 事实接入 (Feature 060)

**Input**: Design documents from `/specs/060-product-ux-fact-ingestion/`  
**Prerequisites**: `spec.md`, `research/tech-research.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖产品事实聚合单测、batch 集成测试、docs bundle / quality 回归，以及真实样例验证。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `research/tech-research.md`、`plan.md`、`data-model.md`
- [x] T002 [P] 创建 `templates/product-overview.hbs`
- [x] T003 [P] 创建 `templates/user-journeys.hbs`
- [x] T004 [P] 创建 `templates/feature-brief-index.hbs`
- [x] T005 [P] 创建 `templates/feature-brief.hbs`
- [x] T006 [P] 创建 `tests/panoramic/product-ux-docs.test.ts`

## Phase 2: Foundations

- [x] T007 实现 `src/panoramic/product-ux-docs.ts`
- [x] T008 定义 `ProductEvidenceRef`、`ProductOverviewOutput`、`UserJourney`、`FeatureBrief` 与 `ProductFactCorpus`
- [x] T009 实现 current-spec / README / 本地 Markdown / issue / PR / commit 多源事实采集

## Phase 3: User Story 1 - 生成产品概览与用户旅程 (P1)

- [x] T010 [P] [US1] 编写单测：current-spec + README + GitHub 事实生成 overview / journeys
- [x] T011 [US1] 实现 overview 摘要、目标用户、核心场景与任务流提炼
- [x] T012 [US1] 实现 user journeys 生成与 JSON / Markdown 写盘

## Phase 4: User Story 2 - 生成 feature briefs 并接入 bundle / quality (P1)

- [x] T013 [P] [US2] 编写集成测试：batch 输出产品文档并进入 docs bundle / quality
- [x] T014 [US2] 实现 feature brief 索引与多篇 brief 写盘
- [x] T015 [US2] 将 `product-overview`、`user-journeys`、`feature-briefs/index` 接入 `batch-project-docs.ts`
- [x] T016 [US2] 更新 `docs-bundle-orchestrator.ts` 和 `docs-bundle-profiles.ts`
- [x] T017 [US2] 更新 `docs-quality-model.ts` 与 `docs-quality-evaluator.ts`

## Phase 5: User Story 3 - 保守降级与路径冲突修复 (P2)

- [x] T018 [US3] 对 GitHub / current-spec 缺失场景输出 warning 而不是失败
- [x] T019 [US3] 为 `feature-briefs/index.md` 预计算稳定文件名，消除 Handlebars 原型访问 warning
- [x] T020 [US3] 修复 docs bundle 对嵌套路径 flatten 后覆盖 landing page 的问题
- [x] T021 [US3] 更新 docs bundle / quality 回归测试契约

## Phase 6: Validation

- [x] T022 运行 `npx vitest run tests/panoramic/product-ux-docs.test.ts tests/integration/batch-product-ux-docs.test.ts tests/panoramic/docs-quality-evaluator.test.ts tests/integration/batch-doc-bundle-orchestration.test.ts`
- [x] T023 运行 `npx vitest run tests/integration/batch-panoramic-doc-suite.test.ts`
- [x] T024 运行 `npm run lint`
- [x] T025 运行 `npm run build`
- [x] T026 [P] 在当前仓库上运行 060 真实样例验证，确认生成产品概览、用户旅程和 feature briefs
