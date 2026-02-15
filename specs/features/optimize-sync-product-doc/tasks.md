# Tasks: 优化 Sync 产品文档质量与结构

**Input**: 设计文档来自 `specs/features/optimize-sync-product-doc/`
**Prerequisites**: plan.md (required), spec.md (required)

**Organization**: 任务按 User Story 分组，支持独立实现和验证。本次修改仅涉及 3 个声明式文件（Markdown + YAML），无编译型代码，因此省略 Setup 和 Foundational 阶段。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1, US2, US3, US4）
- 包含精确文件路径

---

## Phase 1: User Story 1 — 生成结构完整的产品活文档 (Priority: P1)

**Goal**: 将产品文档模板从 7 章节扩展至 14 章节，覆盖行业标准 PRD 完整结构

**Independent Test**: 运行 sync 命令后检查 current-spec.md 是否包含全部 14 个顶级章节且各章节占位符结构完整

### 实现任务

- [x] T001 [US1] 在 `product-spec-template.md` 中新增「目标与成功指标」章节（含产品愿景、KPI 表格占位符、聚合指导注释）— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T002 [P] [US1] 在 `product-spec-template.md` 中新增「用户画像与场景」章节（含目标用户表格、核心使用场景列表、聚合指导注释）— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T003 [P] [US1] 在 `product-spec-template.md` 中新增「范围与边界」章节（含范围内/范围外列表结构、聚合指导注释）— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T004 [P] [US1] 在 `product-spec-template.md` 中新增「非功能需求」章节（按性能/安全/可扩展性/可用性/兼容性分类，含容错注释）— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T005 [P] [US1] 在 `product-spec-template.md` 中新增「设计原则与决策记录」章节（含设计原则列表和类 ADR 格式决策表格）— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T006 [P] [US1] 在 `product-spec-template.md` 中新增「假设与风险」章节（含关键假设表格和风险矩阵表格）— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T007 [P] [US1] 在 `product-spec-template.md` 中新增「术语表」章节（含术语-定义-来源表格，标注真实性优先策略）— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T008 [US1] 修改「当前技术架构」章节：移除「关键设计决策」子节，替换为交叉引用至「设计原则与决策记录」— `plugins/spec-driver/templates/product-spec-template.md`
- [x] T009 [US1] 按行业标准文档流重新排序全部 14 个章节（概述 -> 目标 -> 用户 -> 范围 -> 功能 -> 非功能 -> 架构 -> 设计决策 -> 限制 -> 风险 -> 废弃 -> 变更 -> 术语 -> 附录），确保现有 7 章节占位符不被删除 — `plugins/spec-driver/templates/product-spec-template.md`
- [x] T010 [US1] 验证模板中所有占位符文本使用中文、代码标识符保持英文（双语规范审查）— `plugins/spec-driver/templates/product-spec-template.md`

> **说明**: T001-T007 是新增章节内容，可并行设计但最终需在 T009 中统一组装排序。建议实施策略为：先并行起草各章节内容（T001-T007），再顺序执行调整（T008）和排序组装（T009），最后审查（T010）。由于所有任务修改同一文件，实际执行时应顺序写入以避免冲突。

**Checkpoint**: 模板文件应从 96 行扩展至约 250 行，包含 14 个完整的二级标题章节

---

## Phase 2: User Story 2 — sync 子代理高质量聚合能力 (Priority: P1)

**Goal**: 更新 sync 子代理 prompt，使其能按优化后的 14 章节模板进行高质量内容聚合，支持智能推断和容错标注

**Independent Test**: 对比优化前后 sync 命令产出的 current-spec.md，验证新增章节有实质内容且与增量 spec 信息一致

### 实现任务

- [x] T011 [US2] 在 sync 子代理 prompt 的「4. 生成产品级活文档」中扩展聚合逻辑，从 6 章节覆盖至 14 章节，为每个新增章节提供信息提取来源说明 — `plugins/spec-driver/agents/sync.md`
- [x] T012 [US2] 新增「信息推断规则」段落（位于执行流程之后、约束之前），包含 7 个新章节的推断来源表和推断方法，以及 `[推断]` 标记和 `[待补充]` 容错规则 — `plugins/spec-driver/agents/sync.md`
- [x] T013 [US2] 新增「内容质量标准」段落，包含全部 14 个章节的最低内容要求和容错策略表格（术语表采用真实性优先策略，非功能需求维度为建议性）— `plugins/spec-driver/agents/sync.md`

**Checkpoint**: sync.md 应从 187 行扩展至约 320 行，新增区域 A（聚合指导）、B（推断规则）、C（质量标准）

---

## Phase 3: User Story 3 — 产品映射数据完整性修复 (Priority: P2)

**Goal**: 在 sync prompt 中新增产品名自动修正逻辑和缺失 spec 自动检测机制，确保产品映射与代码库现状一致

**Independent Test**: 检查 sync 子代理 prompt 中是否包含 `speckitdriver` -> `spec-driver` 自动修正规则，以及 013/014 spec 的自动检测逻辑

### 实现任务

- [x] T014 [US3] 在 sync 子代理 prompt 的「2. 产品归属判定」中新增产品名自动修正规则：检测 `speckitdriver` 自动重命名为 `spec-driver`，更新描述至 v3.0.0，写回 product-mapping.yaml — `plugins/spec-driver/agents/sync.md`
- [x] T015 [US3] 在产品归属判定逻辑中新增未映射 spec 自动检测规则：扫描时发现 013、014 等未列入映射的 spec 编号，通过内容分析推断归属并追加 — `plugins/spec-driver/agents/sync.md`

**Checkpoint**: sync.md 的产品归属判定段落应包含自动修正和自动检测两套规则

---

## Phase 4: User Story 4 — 文档质量门控 (Priority: P2)

**Goal**: 在 sync 输出中新增文档质量评估，使用者无需逐章节人工检查即可了解文档完整度

**Independent Test**: 运行 sync 命令后查看输出报告中的质量检查部分，验证其正确报告了各章节的填充状态

### 实现任务

- [x] T016 [US4] 在 sync 子代理 prompt 的「输出」章节新增「文档质量评估」结构，包含每章节的填充状态（完整/部分/待补充/不适用）、总体评分和建议操作 — `plugins/spec-driver/agents/sync.md`
- [x] T017 [US4] 在 SKILL.md 的聚合完成报告模板中新增「文档质量」字段，展示每个产品的章节完整度统计和待补充章节列表 — `plugins/spec-driver/skills/speckit-sync/SKILL.md`

**Checkpoint**: sync 命令输出应包含质量评估信息，SKILL.md 报告模板应新增质量字段

---

## Phase 5: Polish & 交叉验证

**Purpose**: 全局一致性检查和最终验证

- [x] T018 [P] 交叉验证：确认 product-spec-template.md 的 14 个章节标题与 agents/sync.md 中的聚合指导完全一一对应，无遗漏或不匹配 — `plugins/spec-driver/templates/product-spec-template.md` + `plugins/spec-driver/agents/sync.md`
- [x] T019 [P] 交叉验证：确认 agents/sync.md 中的质量评估输出结构与 SKILL.md 中的报告模板格式兼容一致 — `plugins/spec-driver/agents/sync.md` + `plugins/spec-driver/skills/speckit-sync/SKILL.md`
- [x] T020 向后兼容验证：逐项检查原有 7 个章节（产品概述、功能全集、技术架构、已知限制、废弃功能、变更历史、附录）在新模板中均保留，占位符未被删除 — `plugins/spec-driver/templates/product-spec-template.md`

---

## FR 覆盖映射表

> 验证 spec.md 中每条 FR 至少有一个对应任务。

| FR 编号 | 描述 | 覆盖任务 |
|---------|------|---------|
| FR-001 | 新增「目标与成功指标」章节 | T001, T009 |
| FR-002 | 新增「用户画像与场景」章节 | T002, T009 |
| FR-003 | 新增「非功能需求」章节 | T004, T009 |
| FR-004 | 新增「假设与风险」章节 | T006, T009 |
| FR-005 | 新增「范围与边界」章节 | T003, T009 |
| FR-006 | 新增「术语表」章节 | T007, T009 |
| FR-007 | 新增「设计原则与决策记录」章节 | T005, T009 |
| FR-008 | 迁移设计决策 + 交叉引用 | T005, T008, T009 |
| FR-009 | 占位符使用中文（双语规范） | T010 |
| FR-010 | 现有章节向后兼容 | T009, T020 |
| FR-011 | 新增章节聚合指导 | T011 |
| FR-012 | 信息推断规则 | T012 |
| FR-013 | 内容质量标准 | T013 |
| FR-014 | 质量评估输出 | T016 |
| FR-015 | 产品映射维护更新 | T014, T015 |
| FR-016 | 报告新增质量字段 | T017 |

**覆盖率**: 16/16 FR = **100%**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1 - 模板扩展)**: 无前置依赖，可立即开始
- **Phase 2 (US2 - 聚合指导)**: 建议在 Phase 1 之后执行（prompt 需引用模板章节结构），但不严格阻塞
- **Phase 3 (US3 - 映射修正)**: 独立于 Phase 1/2，可并行执行（修改 sync.md 的不同段落）
- **Phase 4 (US4 - 质量门控)**: 建议在 Phase 2 之后执行（质量评估需覆盖完整章节列表）
- **Phase 5 (Polish)**: 依赖所有前序 Phase 完成

### User Story 间依赖

- **US1 -> US2**: 模板章节结构是 prompt 聚合指导的蓝图，US1 优先确定结构后 US2 编写聚合规则
- **US2 -> US4**: 质量评估需基于 US2 中的内容质量标准
- **US3 独立**: 产品映射修正逻辑独立于模板和质量门控

### Story 内部并行机会

- **US1**: T001-T007（7 个新增章节内容起草）可并行设计，但因修改同一文件需顺序写入
- **US2**: T011-T013 需按顺序执行（聚合指导 -> 推断规则 -> 质量标准，逻辑递进）
- **US3**: T014-T015 修改同一文件的同一段落，需顺序执行
- **US4**: T016 与 T017 修改不同文件，可并行执行

### 推荐实施策略

**顺序实施（推荐，单人场景）**:

1. Phase 1: T001 -> T002 -> T003 -> T004 -> T005 -> T006 -> T007 -> T008 -> T009 -> T010
2. Phase 2: T011 -> T012 -> T013
3. Phase 3: T014 -> T015（可与 Phase 2 交叉执行）
4. Phase 4: T016 + T017（T017 可与 T016 并行）
5. Phase 5: T018 -> T019 -> T020

**说明**: 由于 3 个修改文件的总净增量约 400 行，且全部为声明式 Markdown 内容，建议采用顺序实施策略，按 Phase 1 -> 2 -> 3 -> 4 -> 5 的顺序逐步完成。每个 Phase 完成后即可进行阶段性检查。

---

## Notes

- 所有修改文件为声明式 Markdown/YAML，无编译、无测试执行
- 修改文件路径（绝对路径）：
  1. `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/plugins/spec-driver/templates/product-spec-template.md`
  2. `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/plugins/spec-driver/agents/sync.md`
  3. `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/plugins/spec-driver/skills/speckit-sync/SKILL.md`
- 验证方式：运行 `/spec-driver:speckit-sync` 后检查生成的 `current-spec.md` 的章节完整性和内容质量
- FR-015 的产品映射修正通过 sync prompt 中的自动修正逻辑实现，不在本次直接修改 `product-mapping.yaml`
