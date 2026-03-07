# Tasks: sync / doc 文档架构重设计

**Input**: 设计文档来自 `specs/022-sync-doc-redesign/`
**Prerequisites**: `spec.md`（required）, `plan.md`（required）, `research.md`（required）

**Organization**: 任务按 User Story 分组，覆盖 research -> prompt/template redesign -> contract alignment。改动范围以 Markdown Prompt / template / Bash contract 注释为主，无运行时代码变更。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无直接写冲突）
- **[Story]**: 所属 User Story（US1, US2, US3）
- 每条任务都包含精确文件路径

---

## Phase 1: User Story 1 — sync 成为产品级文档单一信息源 (Priority: P1)

**Goal**: 让 `speckit-sync` 生成的 `current-spec.md` 同时承载产品/需求层、技术/架构层，以及供 `speckit-doc` 消费的对外文档摘要层。

**Independent Test**: 检查 `product-spec-template.md`、`agents/sync.md` 与 `speckit-sync/SKILL.md`，确认都明确声明“对外文档摘要（供 speckit-doc 使用）”的存在、边界与质量要求。

### 实现任务

- [x] T001 [US1] 在 `plugins/spec-driver/templates/product-spec-template.md` 中新增“对外文档摘要（供 speckit-doc 使用）”区块，定义 README 电梯陈述、核心价值主张、主要用户与工作流、对外边界字段
- [x] T002 [US1] 在 `plugins/spec-driver/templates/product-spec-template.md` 中补充 handoff 聚合指导，要求基于事实生成、缺失标注 `[待补充]`、推断标注 `[推断]`
- [x] T003 [US1] 在 `plugins/spec-driver/agents/sync.md` 中重定义 `current-spec.md` 的角色，明确其既是产品事实层，也是 `speckit-doc` 的稳定上游输入
- [x] T004 [US1] 在 `plugins/spec-driver/agents/sync.md` 的生成规则中加入“14 个主章节 + 1 个对外文档摘要区块”的要求，并声明不得把内部活规范直接写成 README
- [x] T005 [US1] 在 `plugins/spec-driver/agents/sync.md` 的信息推断规则与质量标准中新增“对外文档摘要”条目，限定最少内容和容错策略
- [x] T006 [US1] 在 `plugins/spec-driver/skills/speckit-sync/SKILL.md` 中更新技能定位、适用场景和完成报告，声明 `sync` 为 `doc` 提供单一事实源

**Checkpoint**: `sync` 相关 3 个文件对“对外文档摘要”的定义、边界和报告字段保持一致。

---

## Phase 2: User Story 2 — doc 消费 sync 产物生成对外文档 (Priority: P1)

**Goal**: 让 `speckit-doc` 在存在 `current-spec.md` 时优先消费其产品语义，同时保持项目元信息扫描作为分发元信息层和降级路径。

**Independent Test**: 检查 `speckit-doc/SKILL.md`，确认它定义了 `current-spec.md` 发现流程、语义源优先级、README 内容源优先级，以及冲突处理原则。

### 实现任务

- [x] T007 [US2] 在 `plugins/spec-driver/skills/speckit-doc/SKILL.md` 的 Step 1 中加入“产品活文档发现”步骤，扫描 `specs/products/*/current-spec.md`
- [x] T008 [US2] 在 `plugins/spec-driver/skills/speckit-doc/SKILL.md` 中定义产品语义源优先级：先取“对外文档摘要”，再回退到 `current-spec.md` 的产品层章节
- [x] T009 [US2] 在 `plugins/spec-driver/skills/speckit-doc/SKILL.md` 中明确区分产品语义、分发元信息、AST 实现证据三类输入职责
- [x] T010 [US2] 在 `plugins/spec-driver/skills/speckit-doc/SKILL.md` 的 README 模板说明中重写 `description` / `features` / `usage` 的内容来源优先级
- [x] T011 [US2] 在 `plugins/spec-driver/skills/speckit-doc/SKILL.md` 的完成报告中新增“语义来源”字段，记录本次生成依赖的事实层

**Checkpoint**: `speckit-doc` 的 prompt 已明确成为“外部表达层”，不再自行发明产品定位和用户价值。

---

## Phase 3: User Story 3 — sync 与 doc 保持分工但共享契约 (Priority: P2)

**Goal**: 不合并 `sync` 与 `doc` 命令，但为两者建立共享的信息架构和 project scan 契约，降低后续漂移。

**Independent Test**: 检查 `research.md` / `spec.md` / `scan-project-output.md`，确认“不合并命令”的决策已固化，且 `scan-project.sh` 输出字段拥有单独契约文档。

### 实现任务

- [x] T012 [US3] 在 `specs/022-sync-doc-redesign/research.md` 中沉淀外部调研结论，明确不合并 `sync` 与 `doc`，而是建立上下游关系
- [x] T013 [US3] 在 `specs/022-sync-doc-redesign/spec.md` 与 `plan.md` 中固化命令边界、输入契约和内容风格要求
- [x] T014 [US3] 新增 `plugins/spec-driver/contracts/scan-project-output.md`，记录 `scan-project.sh` 的输出字段与语义分层
- [x] T015 [US3] 更新 `plugins/spec-driver/scripts/scan-project.sh` 文件头注释，指向新的契约文档路径

**Checkpoint**: 命令边界与共享契约均已文档化，无需把 `sync` / `doc` 粗暴合并成单入口。

---

## Phase 4: Polish & 验证

**Purpose**: 全局一致性检查和静态验证

- [x] T016 [P] 交叉验证：确认 `product-spec-template.md`、`agents/sync.md`、`speckit-sync/SKILL.md` 对“对外文档摘要”的命名与职责完全一致
- [x] T017 [P] 交叉验证：确认 `speckit-doc/SKILL.md` 的语义源优先级与 `scan-project-output.md` 的“分发元信息层”定义一致
- [x] T018 运行静态校验：检查 `scan-project.sh` Bash 语法与新文档引用路径是否正确
- [x] T019 审核工作树 diff，确认未越界修改 `sync/doc` 之外的运行时代码

---

## FR 覆盖映射表

| FR 编号 | 描述 | 覆盖任务 |
|---------|------|---------|
| FR-001 | `sync` 保持原有聚合路径与幂等语义 | T003, T004, T006 |
| FR-002 | `current-spec.md` 区分三类信息层 | T001, T003, T004 |
| FR-003 | 输出对外文档摘要 | T001, T004, T005 |
| FR-004 | 摘要内容必须可追溯 | T002, T005 |
| FR-005 | `doc` 发现并优先消费 `current-spec.md` | T007, T008, T010 |
| FR-006 | 无 `current-spec.md` 时保持降级链路 | T007, T009 |
| FR-007 | 区分产品语义与分发元信息 | T009, T010, T014 |
| FR-008 | `sync` 与 `doc` 保持两个独立命令 | T012, T013 |
| FR-009 | 共享预检逻辑语义对齐 | T013, T014, T015 |
| FR-010 | `scan-project.sh` 输出有独立契约说明 | T014, T015 |
| FR-011 | 用户文档内容风格要求 | T008, T010, T012, T013 |
| FR-012 | 技术文档与 README 不混写 | T003, T004, T009 |
| FR-013 | 冲突时显式提示并按语义/元信息分层处理 | T009, T010 |

**覆盖率**: 13/13 FR = **100%**

---

## Dependencies & Execution Order

- Phase 1 先定义 `sync` 的事实层与 handoff 区块，再让 Phase 2 的 `doc` 消费该契约
- Phase 2 依赖 Phase 1 的命名与字段稳定，否则 README 来源优先级无法对齐
- Phase 3 可与 Phase 1/2 局部并行，但契约文件应在最终验证前落地
- Phase 4 依赖全部前序阶段完成

## Notes

- 本次仅修改 Markdown Prompt、模板与 Bash 注释，不引入新运行时依赖
- 本次明确结论是“**不合并** `speckit-sync` 和 `speckit-doc`”，而是通过 `current-spec.md` 的 handoff 摘要建立上下游
- 验证重点是职责边界、内容源优先级和契约一致性，而不是编译/单元测试
