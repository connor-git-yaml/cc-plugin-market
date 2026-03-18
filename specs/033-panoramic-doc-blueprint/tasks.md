# Tasks: 全景文档化 Milestone 蓝图

**Input**: Design documents from `specs/033-panoramic-doc-blueprint/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, contracts/blueprint-structure.md

**Organization**: 任务按 User Story 分组，支持增量交付。本 Feature 的交付物是纯 Markdown 文档（blueprint.md），不涉及代码实现。每个任务对应蓝图文档中的一个章节或子章节的编写工作。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同章节，无内容依赖）
- **[Story]**: 所属 User Story（US1-US6）
- 所有任务的目标文件为 `specs/033-panoramic-doc-blueprint/blueprint.md`

## Path Conventions

- **交付物**: `specs/033-panoramic-doc-blueprint/blueprint.md`（单一 Markdown 文件）
- **参考来源**: `specs/033-panoramic-doc-blueprint/research/tech-research.md`、`spec.md`、`data-model.md`、`contracts/blueprint-structure.md`

---

## Phase 1: Setup（文档框架搭建）

**Purpose**: 创建 blueprint.md 文件骨架，按 contracts/blueprint-structure.md 定义的 9 章结构初始化

- [x] T001 创建 `specs/033-panoramic-doc-blueprint/blueprint.md` 文件，写入文档头部元信息（版本 1.0.0、创建日期、状态 Draft）和 9 个章节的占位标题，严格遵循 `contracts/blueprint-structure.md` 的顶层结构定义

---

## Phase 2: Foundational（共享前置内容）

**Purpose**: 编写"概览与目标"和"编号映射表"两个基础章节，它们是所有后续章节的引用基础

**注意**: 后续所有 User Story 章节都会引用编号映射表中的 specs 编号（034-050），因此本阶段必须先完成

- [x] T002 编写第 1 章"概览与目标"，从 spec.md User Story 1 提炼全景文档化 Milestone 的愿景、范围（4 个 Phase / 17 个 Feature）和目标陈述 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 1 章
- [x] T003 [P] 编写第 2 章"编号映射表"，从 `data-model.md` 编号映射章节复制 specs 编号（034-050）与调研编号（F-000~F-016）的对照表，确保正文后续章节统一使用 specs 编号作为主标识符 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 2 章

**Checkpoint**: 文档骨架和基础引用信息就绪，后续章节可按 User Story 并行编写

---

## Phase 3: User Story 1 — 蓝图全景浏览（Priority: P1）

**Goal**: 交付 Phase 分解与 Feature 详情章节（第 4 章）和 MVP 范围定义章节（第 3 章），使读者能够全景了解 17 个 Feature 的划分、排期和 MVP 边界

**Independent Test**: 任何不了解项目背景的开发者，阅读第 1-4 章后应能回答"全景文档化包含哪些能力"和"按什么顺序实施"

### Implementation for User Story 1

- [x] T004 [US1] 编写第 3 章"MVP 范围定义"，明确标注 MVP 为 Phase 0 + Phase 1 共 8 个 Feature（034-041），从 spec.md FR-004/FR-005 和 tech-research.md 第 10 节合并 MVP 选择理由（技术依赖 + OctoAgent 验证价值双维度） — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 3 章
- [x] T005 [US1] 编写第 4.1 节"Phase 0: 基础设施层"，包含阶段目标描述和 Feature 034/035/036 的标准卡片（名称、描述、工作量、依赖、交付物、验证标准），从 plan.md 第 17 个 Feature 概要设计章节和 tech-research.md 提取信息，按 `contracts/blueprint-structure.md` Feature 卡片格式编写 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.1 节
- [x] T006 [P] [US1] 编写第 4.2 节"Phase 1: 核心能力层"，包含阶段目标描述和 Feature 037/038/039/040/041 的标准卡片，格式同 T005 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.2 节
- [x] T007 [P] [US1] 编写第 4.3 节"Phase 2: 增强能力层"，包含阶段目标描述和 Feature 042/043/044/045/046 的标准卡片，格式同 T005 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.3 节
- [x] T008 [P] [US1] 编写第 4.4 节"Phase 3: 高级能力层（实验性）"，包含阶段目标描述和 Feature 047/048/049/050 的标准卡片，格式同 T005。所有 Feature 必须标注"实验性"标签（FR-021） — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.4 节
- [x] T009 [US1] 编写各 Phase 的工作量汇总表，汇总每个 Phase 的 Feature 数量、预估工作量范围和累计工作量（含 MVP 小计行），附加在第 4 章末尾 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4 章尾部

**Checkpoint**: 第 1-4 章完成，读者可全景浏览所有 Feature 和 MVP 范围

---

## Phase 4: User Story 2 — 依赖关系追踪（Priority: P1）

**Goal**: 交付依赖关系章节（第 5 章），包含 Mermaid 有向图、依赖矩阵表格和并行分组说明

**Independent Test**: 可从依赖信息中验证任意一个 Feature 的前置依赖是否在同一或更早 Phase 中，且无循环依赖

### Implementation for User Story 2

- [x] T010 [US2] 编写第 5.1 节"依赖关系有向图"，将 plan.md 中的 Mermaid 依赖图（specs 编号版）转写为 blueprint.md 格式，确保节点使用 specs 编号（034-050）标识，标注强/弱依赖关系 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 5.1 节
- [x] T011 [US2] 编写第 5.2 节"依赖矩阵表格"，按 `contracts/blueprint-structure.md` 依赖矩阵格式，逐行列出 17 个 Feature 的强依赖、弱依赖和可并行 Feature 列表 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 5.2 节
- [x] T012 [US2] 编写第 5.3 节"并行分组"，从 plan.md 并行分组分析表格提取各 Phase 内的并行分组信息，标注最大并行度和推荐启动顺序 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 5.3 节
- [x] T013 [US2] 执行 DAG 验证：检查第 5.1 节依赖图中无环、无跨 Phase 反向依赖（FR-009），在第 5 章末尾添加"DAG 验证结果"声明 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 5 章尾部

**Checkpoint**: 依赖关系三视图（图+表+并行分组）完成，可独立验证依赖合理性

---

## Phase 5: User Story 3 — Feature 验证标准查阅（Priority: P1）

**Goal**: 确保第 4 章中每个 Feature 卡片的验证标准满足质量要求——至少 2 条、可观测、可转化为 Given-When-Then 格式

**Independent Test**: 逐条检查 17 个 Feature 的验证标准，确认每条都描述了可判定通过/不通过的预期结果

### Implementation for User Story 3

- [x] T014 [US3] 审阅并完善 Feature 034-036（Phase 0）的验证标准，确保每个 Feature 至少 2 条验证标准，每条描述可观测的预期结果且可直接转化为 Given-When-Then 格式（FR-010/FR-011） — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.1 节中的验证标准字段
- [x] T015 [P] [US3] 审阅并完善 Feature 037-041（Phase 1）的验证标准，标准同 T014 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.2 节中的验证标准字段
- [x] T016 [P] [US3] 审阅并完善 Feature 042-046（Phase 2）的验证标准，标准同 T014 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.3 节中的验证标准字段
- [x] T017 [P] [US3] 审阅并完善 Feature 047-050（Phase 3）的验证标准，标准同 T014 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 4.4 节中的验证标准字段

**Checkpoint**: 全部 17 个 Feature 的验证标准通过质量检查，可作为后续 spec Acceptance Scenarios 的基础

---

## Phase 6: User Story 4 — 核心抽象接口契约预览（Priority: P2）

**Goal**: 交付核心抽象接口契约概要章节（第 6 章），为 Phase 0 实施者提供设计参照

**Independent Test**: 审查接口契约概要，确认描述了接口名称、核心方法、职责边界，且与 tech-research.md 推荐设计一致

### Implementation for User Story 4

- [x] T018 [P] [US4] 编写第 6.1 节"DocumentGenerator"接口契约概要，从 tech-research.md 第 2.4 节提取接口职责和核心方法（isApplicable / extract / generate / render），按 `contracts/blueprint-structure.md` 核心抽象格式编写，包含职责描述、方法表格和设计说明 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 6.1 节
- [x] T019 [P] [US4] 编写第 6.2 节"ArtifactParser"接口契约概要，提取核心方法（parse / parseAll + filePatterns），格式同 T018 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 6.2 节
- [x] T020 [P] [US4] 编写第 6.3 节"ProjectContext"接口契约概要，提取核心属性（projectRoot、packageManager、workspaceType、detectedLanguages 等），格式同 T018 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 6.3 节
- [x] T021 [P] [US4] 编写第 6.4 节"GeneratorRegistry"接口契约概要，提取核心方法（register / get / list / filterByContext），格式同 T018 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 6.4 节
- [x] T022 [US4] 交叉验证第 6 章接口契约概要与 tech-research.md 推荐设计的一致性（FR-014），确保接口名称、核心方法、职责划分无偏差，如有差异在设计说明中标注理由 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 6 章

**Checkpoint**: 核心抽象接口契约概要完成，Phase 0 实施者有明确的设计参照

---

## Phase 7: User Story 5 — 风险识别与缓解策略查阅（Priority: P2）

**Goal**: 交付风险清单章节（第 7 章），包含至少 5 项关键技术风险及其缓解策略

**Independent Test**: 检查每项风险都有概率/影响评估和可操作的缓解策略，且策略关联到具体 Feature 或 Phase

### Implementation for User Story 5

- [x] T023 [US5] 编写第 7 章"风险清单"，从 tech-research.md 第 7 节提取关键技术风险，按 `contracts/blueprint-structure.md` 风险条目格式编写表格（风险描述、概率、影响、缓解策略、关联 Feature/Phase），确保至少 5 项风险（FR-015）且每项缓解策略关联到具体 Feature 或 Phase（FR-016） — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 7 章
- [x] T024 [US5] 补充 spec.md Edge Cases 中提到的额外风险项：Feature 工作量超预估时的拆分/降级策略、接口迭代兼容性策略、Feature 编号取消/合并处理策略，以风险条目格式追加到第 7 章表格 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 7 章

**Checkpoint**: 风险清单覆盖 tech-research.md 识别的风险和 spec.md 边界情况

---

## Phase 8: User Story 6 — OctoAgent 验证计划查阅（Priority: P2）

**Goal**: 交付 OctoAgent 验证计划章节（第 8 章），为每个 Phase 定义验证里程碑

**Independent Test**: 检查每个 Phase 的验证里程碑都有明确的验证操作和预期产出

### Implementation for User Story 6

- [x] T025 [P] [US6] 编写第 8.1 节"Phase 0 验证里程碑"，从 tech-research.md 第 6 节推导 Phase 0 完成后的 OctoAgent 验证目标（接口定义可编译、Mock Generator 通过测试），按 `contracts/blueprint-structure.md` 验证计划格式编写 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 8.1 节
- [x] T026 [P] [US6] 编写第 8.2 节"Phase 1 验证里程碑"，定义 Phase 1 完成后对 OctoAgent 的验证目标（SKILL.md 解析、behavior YAML 解析、配置手册生成、Monorepo 索引等），格式同 T025 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 8.2 节
- [x] T027 [P] [US6] 编写第 8.3 节"Phase 2 验证里程碑"，定义 Phase 2 完成后的验证目标（API 文档、部署文档、交叉引用、架构概览、完整性审计），格式同 T025 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 8.3 节
- [x] T028 [P] [US6] 编写第 8.4 节"Phase 3 验证里程碑"，定义 Phase 3 完成后的验证目标（事件流/状态机、FAQ、增量重生成、架构模式检测），标注实验性质和验证计划可能调整，格式同 T025 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 8.4 节

**Checkpoint**: 4 个 Phase 的 OctoAgent 验证里程碑完成

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 补充维护章节、整体质量检查和 FR 覆盖验证

- [x] T029 编写第 9.1 节"变更日志"，创建初始变更日志条目（v1.0.0 — 蓝图初始版本），定义变更日志的条目格式 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 9.1 节
- [x] T030 [P] 编写第 9.2 节"蓝图更新触发条件"，从 spec.md FR-020 提取更新策略（Phase 级更新，非 Feature 级），说明更新时应记录的内容（工作量偏差、依赖调整、范围变更） — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 9.2 节
- [x] T031 [P] 编写第 9.3 节"Feature 编号管理策略"，从 spec.md Edge Cases 提取编号处理规则（Feature 取消/合并时保留空缺 vs 重新编号的策略），以及 Phase 3 Feature 提前的条件评估方法 — 写入 `specs/033-panoramic-doc-blueprint/blueprint.md` 第 9.3 节
- [x] T032 整体文档质量检查：验证 blueprint.md 的章节完整性（9 章全部填充）、17 个 Feature 卡片格式一致性（8 字段全部填写）、Mermaid 图语法正确性、内部交叉引用的一致性 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md` 全文
- [x] T033 FR 覆盖验证：逐条检查 spec.md 21 条 Functional Requirements（FR-001 至 FR-021），确认每条 FR 在 blueprint.md 中有对应内容，输出覆盖检查结果记录到第 9 章末尾或作为注释 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md`
- [x] T034 Success Criteria 验证：逐条检查 spec.md 6 条 SC（SC-001 至 SC-006），确认 blueprint.md 满足所有可衡量的成功标准 — 修改 `specs/033-panoramic-doc-blueprint/blueprint.md`（如有不满足项则补充内容）

---

## FR 覆盖映射表

| FR 编号 | 描述 | 对应 Task |
|---------|------|----------|
| FR-001 | 4 个 Phase 划分 | T005, T006, T007, T008 |
| FR-002 | 17 个 Feature 编号分配（034-050） | T005, T006, T007, T008 |
| FR-002a | specs 编号为主标识符，调研编号仅映射表 | T003, T005, T006, T007, T008 |
| FR-003 | Feature 卡片必填信息 | T005, T006, T007, T008 |
| FR-004 | MVP 范围 = Phase 0 + Phase 1 | T004 |
| FR-005 | MVP 选择理由 | T004 |
| FR-006 | 依赖关系有向图（Mermaid） | T010 |
| FR-007 | 依赖矩阵表格 | T011 |
| FR-008 | 并行分组标注 | T012 |
| FR-009 | 无跨 Phase 反向依赖 | T013 |
| FR-010 | 每个 Feature 至少 2 条验证标准 | T014, T015, T016, T017 |
| FR-011 | 验证标准可转化为 Given-When-Then | T014, T015, T016, T017 |
| FR-012 | 4 个核心抽象接口契约概要 | T018, T019, T020, T021 |
| FR-013 | 接口方法列表但不含完整 TS 类型 | T018, T019, T020, T021 |
| FR-014 | 与调研报告推荐设计一致 | T022 |
| FR-015 | 至少 5 项关键风险 | T023 |
| FR-016 | 缓解策略关联 Feature/Phase | T023, T024 |
| FR-017 | OctoAgent 分 Phase 验证计划 | T025, T026, T027, T028 |
| FR-018 | 每 Phase 至少 1 个验证里程碑 | T025, T026, T027, T028 |
| FR-019 | 单一 blueprint.md 文件 | T001 |
| FR-020 | 版本信息和变更日志 | T029, T030 |
| FR-021 | Phase 3 标注"实验性" | T008 |

**覆盖率**: 21/21 FR = 100%

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖，立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 完成（文档骨架就绪）
- **Phase 3 (US1 — 全景浏览)**: 依赖 Phase 2 完成（编号映射表作为引用基础）
- **Phase 4 (US2 — 依赖关系)**: 依赖 Phase 3 中 T005-T008 完成（Feature 卡片已编写，依赖图引用 Feature 名称）
- **Phase 5 (US3 — 验证标准)**: 依赖 Phase 3 中 T005-T008 完成（验证标准是 Feature 卡片的一部分，需先有初稿再审阅完善）
- **Phase 6 (US4 — 核心抽象)**: 依赖 Phase 2 完成（独立于 Phase 3-5，仅需编号映射表）
- **Phase 7 (US5 — 风险清单)**: 依赖 Phase 3 和 Phase 4 完成（风险需引用 Feature 和依赖信息）
- **Phase 8 (US6 — 验证计划)**: 依赖 Phase 3 完成（验证计划引用 Phase 和 Feature 信息）
- **Phase 9 (Polish)**: 依赖 Phase 3-8 全部完成

### User Story Dependencies

- **US1 (P1)**: 核心主干，Phase 3-5 和 Phase 7-8 都依赖其交付物
- **US2 (P1)**: 依赖 US1（Feature 卡片编写完成后才能编写依赖章节）
- **US3 (P1)**: 依赖 US1（Feature 卡片初稿完成后进行验证标准审阅）
- **US4 (P2)**: 独立于 US1-US3，仅依赖 Foundational 阶段
- **US5 (P2)**: 依赖 US1 和 US2（风险需引用 Feature 和依赖信息）
- **US6 (P2)**: 依赖 US1（验证计划引用 Phase 和 Feature 信息）

### Parallel Opportunities

- **Phase 2**: T002 和 T003 可并行（概览与映射表无内容依赖）
- **Phase 3 (US1)**: T006、T007、T008 可并行（不同 Phase 的 Feature 卡片编写），T005 先完成作为格式模板
- **Phase 4 与 Phase 5**: 两者都依赖 US1 的 Feature 卡片，可并行执行
- **Phase 6 (US4)**: 与 Phase 3-5 可并行执行（仅依赖 Phase 2）
- **Phase 6 内部**: T018、T019、T020、T021 四个接口章节可全部并行
- **Phase 8 (US6)**: T025、T026、T027、T028 四个 Phase 验证里程碑可全部并行
- **Phase 9**: T029、T030、T031 可并行

### Recommended Execution Order

```
Phase 1 (T001)
    |
Phase 2 (T002 || T003)
    |
    +---> Phase 3 US1 (T004 → T005 → T006 || T007 || T008 → T009)
    |         |
    |         +---> Phase 4 US2 (T010 → T011 → T012 → T013)
    |         |
    |         +---> Phase 5 US3 (T014 || T015 || T016 || T017)
    |         |
    |         +---> Phase 8 US6 (T025 || T026 || T027 || T028)
    |
    +---> Phase 6 US4 (T018 || T019 || T020 || T021 → T022)
    |
    [US1 + US2 完成后]
    +---> Phase 7 US5 (T023 → T024)
    |
    [全部完成后]
    +---> Phase 9 Polish (T029 || T030 || T031 → T032 → T033 → T034)
```

---

## Implementation Strategy

### MVP First（US1 Only）

1. 完成 Phase 1 + Phase 2: 文档骨架 + 基础内容
2. 完成 Phase 3: 全部 17 个 Feature 卡片和 MVP 范围
3. **STOP and VALIDATE**: 检查文档是否已足够回答"包含哪些能力"和"按什么顺序实施"
4. 此时 blueprint.md 已具备核心参考价值

### Incremental Delivery（推荐）

1. Phase 1-3 (Setup + Foundational + US1) → 全景浏览可用
2. + Phase 4 (US2) → 依赖关系可追踪
3. + Phase 5 (US3) → 验证标准已审阅
4. + Phase 6 (US4) → 核心抽象有设计参照
5. + Phase 7-8 (US5 + US6) → 风险和验证计划完备
6. + Phase 9 (Polish) → 文档质量达标，FR 100% 覆盖验证

### Parallel Execution Strategy

最大并行度 = 2 个独立 Story 同时编写：
- Track A: US1 → US2 → US5（主干 + 依赖 + 风险）
- Track B: US4 → US6 → US3（核心抽象 + 验证计划 + 验证标准审阅）
- 合并后: Polish

---

## Notes

- 所有任务的目标文件为单一 `specs/033-panoramic-doc-blueprint/blueprint.md`
- 由于是单文件编写，标记 [P] 的任务指内容上无依赖、可独立起草，但最终需合并写入同一文件
- tech-research.md 是核心信息来源，大部分章节内容从中提取并转换格式
- Feature 卡片必须严格遵循 `contracts/blueprint-structure.md` 定义的 8 字段标准格式
- specs 编号（034-050）为文档中的主标识符，调研编号仅在第 2 章映射表中出现
