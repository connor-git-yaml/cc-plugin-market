# Tasks: ADR 决策流水线 (Feature 058)

**Input**: Design documents from `/specs/058-adr-decision-pipeline/`  
**Prerequisites**: `spec.md`, `research/tech-research.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖 ADR pipeline 单测、batch 集成测试，以及 lint/build 回归。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `research/tech-research.md`、`plan.md`、`data-model.md`
- [x] T002 [P] 创建 `templates/adr-draft.hbs`
- [x] T003 [P] 创建 `templates/adr-index.hbs`
- [x] T004 [P] 创建 `tests/panoramic/adr-decision-pipeline.test.ts`

## Phase 2: Foundations

- [x] T005 实现 `src/panoramic/adr-decision-pipeline.ts`
- [x] T006 定义 `AdrEvidenceRef`、`AdrDraft`、`AdrIndexOutput`、`AdrCorpus`
- [x] T007 实现多源证据采集：narrative / pattern-hints / spec / current-spec / git / source-path

## Phase 3: User Story 1 - 自动生成 ADR 草稿与索引 (P1)

- [x] T008 [P] [US1] 编写单测：current-spec / registry / fallback 信号生成 ADR 草稿
- [x] T009 [P] [US1] 编写单测：CLI transport / JSON protocol 信号生成 ADR 草稿
- [x] T010 [US1] 实现候选决策规则与草稿渲染
- [x] T011 [US1] 输出 `docs/adr/index.md/.json` 与 ADR 草稿 `.md/.json`

## Phase 4: User Story 2 - 证据化的 ADR 结构 (P1)

- [x] T012 [US2] 让 ADR 草稿固定包含 `Decision / Context / Consequences / Alternatives / Evidence`
- [x] T013 [US2] 在草稿中加入 `status=proposed`、`confidence`、`sourceTypes` 与 `inferred`

## Phase 5: User Story 3 - Batch 集成与兼容性 (P2)

- [x] T014 [P] [US3] 更新 `tests/integration/batch-panoramic-doc-suite.test.ts`
- [x] T015 [US3] 将 ADR pipeline 接入 `src/panoramic/batch-project-docs.ts`
- [x] T016 [US3] 导出 `src/panoramic/index.ts` 桶文件接口

## Phase 6: Validation

- [x] T017 运行 `npx vitest run tests/panoramic/adr-decision-pipeline.test.ts tests/integration/batch-panoramic-doc-suite.test.ts`
- [x] T018 运行 `npm run lint`
- [x] T019 运行 `npm run build`
- [x] T020 [P] 使用既有 `claude-agent-sdk-python` 输出目录验证 ADR pipeline 至少产出 2 篇草稿
