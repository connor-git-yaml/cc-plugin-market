# Tasks: 故障排查 / 原理说明文档 (Feature 048)

**Input**: Design documents from `/specs/048-troubleshooting-explanation-docs/`
**Prerequisites**: `spec.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖配置约束、错误模式、explanation 证据链以及 registry / barrel 集成。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `src/panoramic/troubleshooting-generator.ts`
- [x] T002 [P] 创建 `templates/troubleshooting.hbs`
- [x] T003 [P] 创建 `tests/panoramic/troubleshooting-generator.test.ts`

## Phase 2: Foundations

- [x] T004 定义 048 的输入 / 输出 / explanation 数据结构
- [x] T005 实现源码 / 配置文件扫描与静态证据收集
- [x] T006 在 `src/panoramic/generator-registry.ts` 和 `src/panoramic/index.ts` 中注册导出 generator

## Phase 3: User Story 1 - 故障排查条目 (P1)

- [x] T007 [P] [US1] 编写单测：混合 fixture 输出至少 5 条 troubleshooting entries
- [x] T008 [P] [US1] 编写单测：重复错误或重复配置键会被合并
- [x] T009 [US1] 实现 ErrorPatternAnalyzer
- [x] T010 [US1] 实现 troubleshooting 条目聚合与 Markdown 主表渲染

## Phase 4: User Story 2 - 配置约束抽取 (P1)

- [x] T011 [P] [US2] 编写单测：环境变量约束能关联源码和 `.env.example`
- [x] T012 [US2] 实现 ConfigConstraintExtractor
- [x] T013 [US2] 将配置约束转为 grounded symptom / causes / recovery steps

## Phase 5: User Story 3 - 原理说明段落 (P2)

- [x] T014 [P] [US3] 编写单测：retry / fallback 证据触发 explanation 段落
- [x] T015 [US3] 实现 recovery 证据增强与 explanation 聚合
- [x] T016 [US3] 在模板中渲染 explanation 段落和 warnings

## Phase 6: Polish & Validation

- [x] T017 运行 `tests/panoramic/troubleshooting-generator.test.ts`
- [x] T018 [P] 运行相关 generator registry 回归
- [x] T019 运行 `npm run lint`
- [x] T020 运行 `npm run build`
