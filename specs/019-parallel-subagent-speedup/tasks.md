# Tasks: Parallel Subagent Speedup

**Input**: Design documents from `specs/019-parallel-subagent-speedup/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md

**Tests**: 本需求为纯 Markdown prompt 修改，无自动化测试框架。验证通过手动执行 speckit-feature/story/fix 流程观察并行行为。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 阅读现有 SKILL.md 文件，确认改动范围，建立变更基线

- [x] T001 阅读并确认三个待修改文件的当前内容和结构：`plugins/spec-driver/skills/speckit-feature/SKILL.md`、`plugins/spec-driver/skills/speckit-story/SKILL.md`、`plugins/spec-driver/skills/speckit-fix/SKILL.md`
- [x] T002 阅读并确认两个无需修改的文件：`plugins/spec-driver/skills/speckit-doc/SKILL.md`、`plugins/spec-driver/skills/speckit-sync/SKILL.md`（确认不存在可并行化的 Task 委派）

---

## Phase 2: User Story 1 - 验证闭环三并行 (Priority: P1) -- MVP

**Goal**: 在 Feature/Story/Fix 三个模式的验证闭环阶段，将 spec-review 和 quality-review 改为并行委派，verify 在两者完成后串行启动，形成 `parallel(spec-review, quality-review) -> verify -> GATE_VERIFY` 依赖链

**Independent Test**: 执行任意模式（Feature/Story/Fix）流程至验证阶段，观察编排器是否在同一消息中同时发出 spec-review 和 quality-review 两个 Task 调用，verify 在两者完成后才启动

### Implementation for User Story 1

- [x] T003 [P] [US1] 在 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 中新增"并行执行策略"段落（在工作流定义之前，约第 110 行附近），说明并行调度方式、回退规则、完成报告标注格式。内容包括三个并行组列表（VERIFY_GROUP、RESEARCH_GROUP、DESIGN_PREP_GROUP）
- [x] T004 [P] [US1] 在 `plugins/spec-driver/skills/speckit-story/SKILL.md` 中新增"并行执行策略"段落（在工作流定义之前），说明并行调度方式和回退规则。内容仅包括 VERIFY_GROUP 一个并行组
- [x] T005 [P] [US1] 在 `plugins/spec-driver/skills/speckit-fix/SKILL.md` 中新增"并行执行策略"段落（在工作流定义之前），说明并行调度方式和回退规则。内容仅包括 VERIFY_GROUP 一个并行组
- [x] T006 [P] [US1] 重写 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 中 Phase 7a + 7b 段落（约第 530-538 行）：将串行的 Phase 7a（spec-review）和 Phase 7b（quality-review）合并为一个并行调度块 "Phase 7a+7b: Spec 合规审查 + 代码质量审查（并行）"，添加并行调度指令（同一消息发出两个 Task）、等待汇合逻辑、并行回退说明。保留 Phase 7c（verify）串行读取 7a/7b 报告的逻辑不变
- [x] T007 [P] [US1] 重写 `plugins/spec-driver/skills/speckit-story/SKILL.md` 中 Phase 5a + 5b 段落（约第 213-221 行）：将串行的 Phase 5a（spec-review）和 Phase 5b（quality-review）合并为并行调度块 "Phase 5a+5b: Spec 合规审查 + 代码质量审查（并行）"，添加并行调度指令、等待汇合、回退说明。保留 Phase 5c（verify）不变
- [x] T008 [P] [US1] 重写 `plugins/spec-driver/skills/speckit-fix/SKILL.md` 中 Phase 4a + 4b 段落（约第 214-222 行）：将串行的 Phase 4a（spec-review）和 Phase 4b（quality-review）合并为并行调度块 "Phase 4a+4b: Spec 合规审查 + 代码质量审查（并行）"，添加并行调度指令、等待汇合、回退说明。保留 Phase 4c（verify）不变

**Checkpoint**: 验证闭环并行化完成。三个模式的 VERIFY_GROUP 均已改造为 parallel(spec-review, quality-review) -> verify -> GATE_VERIFY

---

## Phase 3: User Story 2 - 调研阶段并行 (Priority: P2)

**Goal**: 在 Feature 模式的 `--research full` 下，将 product-research 和 tech-research 改为并行启动，Phase 1c（产研汇总）作为汇合点

**Independent Test**: 执行 Feature 模式 `--research full`，观察 product-research 和 tech-research 是否在同一消息中并行启动

### Implementation for User Story 2

- [x] T009 [US2] 重写 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 中 Phase 1a + 1b 段落（约第 293-314 行）：将 `full` 模式下的串行 Phase 1a（product-research）和 Phase 1b（tech-research）重组为并行调度块 "Phase 1a+1b: 产品调研 + 技术调研（并行）"。具体改动：(1) 添加 `full` 模式执行条件下的并行调度指令；(2) 移除 Phase 1b 中"full 模式下串行依赖，必须在产品调研完成后执行"的说明；(3) 将 full 模式归入"独立执行"分支（tech-research 不传入 product-research.md 路径）；(4) 添加等待汇合逻辑（验证两份 .md 均已生成）；(5) 添加并行回退说明（回退到串行时先 product-research 再 tech-research，串行模式下可选传入 product-research.md 路径）。保留 Phase 1c（产研汇总）逻辑不变，保留 tech-only/product-only/codebase-scan/skip/custom 模式逻辑不变

**Checkpoint**: 调研阶段并行化完成。Feature full 模式下 RESEARCH_GROUP 已改造为 parallel(product-research, tech-research) -> Phase 1c

---

## Phase 4: User Story 3 - Clarify + Checklist 并行 (Priority: P2)

**Goal**: 在 Feature 模式 Phase 3 中，将 clarify 和 checklist 改为并行委派，GATE_DESIGN 在两者完成后执行

**Independent Test**: 执行 Feature 模式至 Phase 3，观察 clarify 和 checklist 是否并行启动

### Implementation for User Story 3

- [x] T010 [US3] 重写 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 中 Phase 3 + Phase 3.5 段落（约第 422-428 行）：将串行的 Phase 3（clarify）和 Phase 3.5（checklist）合并为并行调度块 "Phase 3: 需求澄清 + 质量检查表（并行）"。具体改动：(1) 在同一消息中同时发出 clarify 和 checklist 两个 Task 调用；(2) 添加汇合处理逻辑（clarify 有 CRITICAL → 同时展示两者结果给用户决策；checklist 有未通过项 → 回到 specify/clarify 修复；两者正常 → 继续 GATE_DESIGN）；(3) 添加并行回退说明（先 clarify 再 checklist）。GATE_DESIGN 硬门禁逻辑完全不变

**Checkpoint**: DESIGN_PREP_GROUP 并行化完成。Feature 模式 Phase 3 已改造为 parallel(clarify, checklist) -> GATE_DESIGN

---

## Phase 5: User Story 4 - 并行失败串行回退 + 完成报告 (Priority: P1)

**Goal**: 在三个模式的 SKILL.md 中添加回退机制说明和完成报告中的执行模式标注

**Independent Test**: 检查三个 SKILL.md 的并行执行策略段落是否包含完整的回退规则，完成报告是否包含"执行模式"段落

### Implementation for User Story 4

- [x] T011 [P] [US4] 在 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 的完成报告模板（约第 559-615 行）中添加"执行模式"段落，列出 Phase 1a+1b（并行/回退:串行）、Phase 3+3.5（并行/回退:串行）、Phase 7a+7b（并行/回退:串行）、Phase 7c（串行）的执行模式标注
- [x] T012 [P] [US4] 在 `plugins/spec-driver/skills/speckit-story/SKILL.md` 的完成报告模板（约第 242-267 行）中添加"执行模式"段落，列出 Phase 5a+5b（并行/回退:串行）、Phase 5c（串行）的执行模式标注
- [x] T013 [P] [US4] 在 `plugins/spec-driver/skills/speckit-fix/SKILL.md` 的完成报告模板（约第 243-274 行）中添加"执行模式"段落，列出 Phase 4a+4b（并行/回退:串行）、Phase 4c（串行）的执行模式标注
- [x] T014 [US4] 在 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 的"选择性重跑机制"段落（约第 649 行附近）添加 `--rerun` 与并行组交互的说明："`--rerun` 重跑以子代理为最小单元。如指定 `--rerun spec-review`，仅重跑 spec-review，不触发并行组中的 quality-review"

**Checkpoint**: 回退机制和完成报告标注完成。US4 验收标准满足

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 全局一致性检查和验证

- [x] T015 全局一致性审查：检查三个 SKILL.md 的"并行执行策略"段落格式是否一致（并行调度方式、回退规则、完成报告标注的措辞应统一）
- [x] T016 确认 `plugins/spec-driver/skills/speckit-doc/SKILL.md` 和 `plugins/spec-driver/skills/speckit-sync/SKILL.md` 未被修改（FR-011: Doc 和 Sync 模式无需并行化修改）
- [x] T017 端到端验证：阅读三个修改后的 SKILL.md 完整内容，确认所有并行调度块、回退说明、完成报告标注、`--rerun` 说明的逻辑一致性和正确性

---

## FR Coverage Map (FR 覆盖映射表)

| FR | 描述 | 对应任务 |
|----|------|---------|
| FR-001 | 验证闭环 parallel(spec-review, quality-review) -> verify -> GATE_VERIFY | T006, T007, T008 |
| FR-002 | 所有并行子代理完成后才执行 GATE 汇合检查 | T006, T007, T008, T009, T010 |
| FR-003 | Feature full 模式 product-research 和 tech-research 并行 | T009 |
| FR-004 | 并行模式 tech-research 以独立模式运行 | T009 |
| FR-005 | Feature Phase 3 clarify 和 checklist 并行 | T010 |
| FR-006 | 并行调度异常时自动回退串行 + 回退日志 | T003, T004, T005, T006, T007, T008, T009, T010 |
| FR-007 | 完成报告标注并行/回退执行模式 | T011, T012, T013 |
| FR-008 | 仅修改 SKILL.md，不修改子代理 prompt | T001-T017（全局约束） |
| FR-009 | 并行子代理失败时不中断其他，等待所有完成后统一处理 | T006, T007, T008, T009, T010 |
| FR-011 | Doc/Sync 模式不修改 | T002, T016 |
| FR-012 | 并行化不改变门禁行为语义 | T006, T007, T008, T009, T010 |
| FR-013 | `--rerun` 以单个子代理粒度执行 | T014 |

**FR 覆盖率**: 12/12 = 100%（FR-010 为现有重试机制，不在本需求改动范围内）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **US1 (Phase 2)**: 依赖 Setup 完成。T003/T004/T005（并行执行策略段落）是 T006/T007/T008（验证闭环并行化）的前置
- **US2 (Phase 3)**: 依赖 T003 完成（speckit-feature 的并行执行策略段落已添加）。可与 US1 的 T007/T008 并行
- **US3 (Phase 4)**: 依赖 T003 完成。可与 US2 并行
- **US4 (Phase 5)**: 依赖 US1/US2/US3 完成（需在所有并行化改造完成后添加完成报告和 rerun 说明）
- **Polish (Phase 6)**: 依赖所有 User Story 完成

### User Story Dependencies

- **US1 (P1)**: 无 Story 间依赖。改动涉及三个文件，三个文件的改动可并行
- **US2 (P2)**: 与 US1 共享 speckit-feature SKILL.md 文件，但改动段落不重叠（US1 改 Phase 7，US2 改 Phase 1），可并行
- **US3 (P2)**: 与 US1/US2 共享 speckit-feature SKILL.md 文件，但改动段落不重叠（US3 改 Phase 3），可并行
- **US4 (P1)**: 依赖 US1/US2/US3，因完成报告和 rerun 说明需基于最终的并行化结构

### Within Each User Story

- 并行执行策略段落 → 验证闭环/调研/设计并行块 → 完成报告标注
- 同一文件的不同段落改动在实践中建议串行执行以避免合并冲突

### Parallel Opportunities

- T003, T004, T005 可并行（三个不同文件的"并行执行策略"段落）
- T006, T007, T008 可并行（三个不同文件的验证闭环重写）
- T011, T012, T013 可并行（三个不同文件的完成报告修改）
- T009 和 T010 作用于同一文件（speckit-feature SKILL.md）不同段落，建议串行

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup（T001-T002）
2. Complete Phase 2: US1 验证闭环三并行（T003-T008）
3. **STOP and VALIDATE**: 执行 Feature/Story/Fix 流程测试验证闭环并行行为
4. 此时三个模式的验证阶段均已并行化，覆盖最广、收益最高

### Incremental Delivery

1. Setup → Foundation ready
2. US1（验证闭环并行）→ 验证 → 三个模式均加速
3. US2（调研并行）→ 验证 → Feature full 模式调研加速
4. US3（Clarify+Checklist 并行）→ 验证 → Feature 模式设计准备加速
5. US4（回退+报告）→ 验证 → 完整可观测性
6. Polish → 全局一致性确认

### Recommended: Incremental

本需求为纯 Prompt 修改，建议按 Story 优先级顺序逐步交付，每个 Story 完成后手动验证。US1 为 MVP，US2/US3 可并行推进（不同段落），US4 收尾。

---

## Notes

- 所有任务均为 Markdown prompt 文本编辑，无代码编译、无测试框架、无 npm 依赖
- 变更范围严格限制在 3 个 SKILL.md 文件内（FR-008）
- 每个并行调度块必须包含"并行回退"说明（FR-006）
- 门禁逻辑（GATE_VERIFY / GATE_DESIGN / GATE_RESEARCH）完全不变（FR-012）
- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
