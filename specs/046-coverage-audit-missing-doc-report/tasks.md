# Tasks: 覆盖率审计与缺失文档报告 (Feature 046)

**Input**: Design documents from `/specs/046-coverage-audit-missing-doc-report/`
**Prerequisites**: `spec.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖 CoverageAuditor、断链扫描、generator coverage 和 batch 集成。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `src/panoramic/coverage-auditor.ts` 骨架
- [x] T002 [P] 创建 `templates/coverage-report.hbs`
- [x] T003 [P] 创建 `tests/panoramic/coverage-auditor.test.ts`
- [x] T004 [P] 创建 `tests/integration/batch-coverage-report.test.ts`

## Phase 2: Foundations

- [x] T005 扩展 044 的 spec metadata 解析，补充 `confidence`
- [x] T006 扩展 `DocGraphSpecNode` 或等价结构，使 auditor 可读取 linked/confidence/status 事实
- [x] T007 在 `src/panoramic/index.ts` 中导出 auditor 相关类型/实现

## Phase 3: User Story 1 - 模块 coverage 审计 (P1)

- [x] T008 [P] [US1] 编写单测：已文档化模块统计正确
- [x] T009 [P] [US1] 编写单测：缺文档模块统计正确
- [x] T010 [P] [US1] 编写单测：未互链模块归类为 `missing-links`
- [x] T011 [US1] 实现模块 coverage 聚合与 summary 统计

## Phase 4: User Story 2 - 断链 / 低置信度诊断 (P1)

- [x] T012 [P] [US2] 编写单测：dangling spec links 识别正确
- [x] T013 [P] [US2] 编写单测：low-confidence spec 识别正确
- [x] T014 [US2] 实现 spec Markdown 链接扫描与 dangling links 诊断
- [x] T015 [US2] 实现 low-confidence / missing-links 分类

## Phase 5: User Story 3 - generator coverage + batch 集成 (P2)

- [x] T016 [P] [US3] 编写单测：applicable generators 的 coverage 统计正确
- [x] T017 [P] [US3] 编写 batch 集成测试：输出 `_coverage-report.md` 与 `_coverage-report.json`
- [x] T018 [US3] 实现 generatorId -> 默认输出文件名映射
- [x] T019 [US3] 在 `src/batch/batch-orchestrator.ts` 中接入 CoverageAuditor

## Phase 6: Polish & Validation

- [x] T020 运行 `tests/panoramic/coverage-auditor.test.ts`
- [x] T021 [P] 运行 `tests/integration/batch-coverage-report.test.ts`
- [x] T022 [P] 运行与 044 相关的回归测试
- [x] T023 运行 `npm run lint`
- [x] T024 运行 `npm run build`
