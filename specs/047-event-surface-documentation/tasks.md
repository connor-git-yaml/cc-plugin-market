# Tasks: 事件面文档 (Feature 047)

**Input**: Design documents from `/specs/047-event-surface-documentation/`
**Prerequisites**: `spec.md`, `plan.md`, `data-model.md`

**Tests**: 需要覆盖事件模式抽取、payload 摘要、registry 集成和状态附录。

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 创建 `src/panoramic/event-surface-generator.ts`
- [x] T002 [P] 创建 `templates/event-surface.hbs`
- [x] T003 [P] 创建 `tests/panoramic/event-surface-generator.test.ts`

## Phase 2: Foundations

- [x] T004 定义 047 的输入 / 输出 / 聚合数据结构
- [x] T005 实现项目源码扫描与事件候选文件收集
- [x] T006 在 `src/panoramic/generator-registry.ts` 和 `src/panoramic/index.ts` 中注册导出 generator

## Phase 3: User Story 1 - 事件通道 inventory (P1)

- [x] T007 [P] [US1] 编写单测：`emit/on` 模式正确识别 publisher / subscriber
- [x] T008 [P] [US1] 编写单测：`publish/subscribe/consume` 模式正确识别 kind
- [x] T009 [US1] 实现 TS/JS AST 事件模式抽取
- [x] T010 [US1] 实现 channel 聚合与 Markdown 主表渲染

## Phase 4: User Story 2 - 消息结构摘要 (P1)

- [x] T011 [P] [US2] 编写单测：对象字面量 payload 正确提取字段
- [x] T012 [P] [US2] 编写单测：非对象 payload 回退为表达式摘要
- [x] T013 [US2] 实现 payload summary / message fields 聚合

## Phase 5: User Story 3 - 可选状态附录 (P2)

- [x] T014 [P] [US3] 编写单测：状态命名模式触发低置信附录
- [x] T015 [US3] 实现低置信状态附录 Mermaid 生成
- [x] T016 [US3] 在模板中标注 `[推断]` 与置信度

## Phase 6: Polish & Validation

- [x] T017 运行 `tests/panoramic/event-surface-generator.test.ts`
- [x] T018 [P] 运行相关 generator registry 回归
- [x] T019 运行 `npm run lint`
- [x] T020 运行 `npm run build`
