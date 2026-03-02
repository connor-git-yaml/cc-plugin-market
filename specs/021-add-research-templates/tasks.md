# Tasks: 调研模板纳入 specify-base 同步体系

**Input**: Design documents from `specs/021-add-research-templates/`
**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: 本功能通过手动验证（模板同步幂等性 + 子代理条件加载），无自动化测试任务。

**Organization**: 任务按 User Story 分组，Phase 2 为基础设施（US3），Phase 3-5 为增量交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: 确认变更范围，无需创建新项目结构（本功能在现有目录中操作）

- [x] T001 确认 `plugins/spec-driver/templates/specify-base/` 目录存在且包含当前 6 个基础模板；确认 `plugins/spec-driver/templates/` 根目录下存在 4 个调研模板源文件（`product-research-template.md`、`tech-research-template.md`、`research-synthesis-template.md`、`verification-report-template.md`）

---

## Phase 2: User Story 3 - specify-base 包含完整调研模板 (Priority: P1)

**Goal**: 将 4 个调研模板的基准版本纳入 `plugins/spec-driver/templates/specify-base/` 目录，作为同步机制的"单一事实源"

**Independent Test**: 检查 `plugins/spec-driver/templates/specify-base/` 目录，验证其中包含 10 个模板文件（6 个基础 + 4 个调研），且调研模板内容与 plugin 根目录下的对应模板一致

### Implementation for User Story 3

- [x] T002 [P] [US3] 复制 `plugins/spec-driver/templates/product-research-template.md` 到 `plugins/spec-driver/templates/specify-base/product-research-template.md`（内容完全一致）
- [x] T003 [P] [US3] 复制 `plugins/spec-driver/templates/tech-research-template.md` 到 `plugins/spec-driver/templates/specify-base/tech-research-template.md`（内容完全一致）
- [x] T004 [P] [US3] 复制 `plugins/spec-driver/templates/research-synthesis-template.md` 到 `plugins/spec-driver/templates/specify-base/research-synthesis-template.md`（内容完全一致）
- [x] T005 [P] [US3] 复制 `plugins/spec-driver/templates/verification-report-template.md` 到 `plugins/spec-driver/templates/specify-base/verification-report-template.md`（内容完全一致）

**Checkpoint**: specify-base 目录应包含 10 个模板文件，4 个新增调研模板与源模板内容一致

---

## Phase 3: User Story 1 - 调研模板自动同步到项目级目录 (Priority: P1)

**Goal**: 扩展 TypeScript 同步器和 Bash 初始化脚本的模板列表，使调研模板在同步流程中自动复制到 `.specify/templates/`

**Independent Test**: 在一个全新项目中首次运行 Spec Driver 流程，验证 `.specify/templates/` 目录下同时出现 6 个基础模板和 4 个调研模板

### Implementation for User Story 1

- [x] T006 [P] [US1] 修改 `src/utils/specify-template-sync.ts` 第 10-17 行的 `REQUIRED_TEMPLATES` 常量数组，在 `'agent-file-template.md'` 之后新增 4 项：`'product-research-template.md'`、`'tech-research-template.md'`、`'research-synthesis-template.md'`、`'verification-report-template.md'`（含中文注释 `// 调研模板（FR-001: 纳入同步体系）`）
- [x] T007 [P] [US1] 修改 `plugins/spec-driver/scripts/init-project.sh` 第 46-53 行的 `REQUIRED_SPECIFY_TEMPLATES` Bash 数组，在 `"agent-file-template.md"` 之后新增 4 项：`"product-research-template.md"`、`"tech-research-template.md"`、`"research-synthesis-template.md"`、`"verification-report-template.md"`（含中文注释 `# 调研模板（纳入同步体系）`）

**Checkpoint**: TypeScript `REQUIRED_TEMPLATES` 数组从 6 项扩展为 10 项；Bash `REQUIRED_SPECIFY_TEMPLATES` 数组从 6 项扩展为 10 项。两者列表完全一致。同步函数的循环逻辑无需修改，自动遍历扩展后的数组。FR-003（幂等保护）和 FR-009（同步结果返回）由现有逻辑保证

---

## Phase 4: User Story 2 - 子代理优先使用项目级调研模板 (Priority: P1)

**Goal**: 修改 product-research、tech-research 子代理 prompt 和编排器 SKILL.md，实现"项目级 `.specify/templates/` 优先，plugin 内置路径回退"的条件加载指令

**Independent Test**: 修改项目级 `.specify/templates/product-research-template.md` 的内容（如新增一个自定义章节），运行产品调研子代理，验证生成的调研报告使用了自定义章节结构

### Implementation for User Story 2

- [x] T008 [P] [US2] 修改 `plugins/spec-driver/agents/product-research.md` 第 10 行：将 `- 使用模板：\`plugins/spec-driver/templates/product-research-template.md\`` 替换为 `- 使用模板：优先读取 \`.specify/templates/product-research-template.md\`（项目级），若不存在则回退到 \`plugins/spec-driver/templates/product-research-template.md\`（plugin 内置）`；同时在"执行流程"第 5 步"MVP 范围建议"与第 6 步"生成报告"之间插入步骤 5.5"加载报告模板"，内容为条件加载指令（检查 `.specify/templates/product-research-template.md` 是否存在，存在用项目级，不存在回退 plugin 内置）
- [x] T009 [P] [US2] 修改 `plugins/spec-driver/agents/tech-research.md` 第 11 行：将 `- 使用模板：\`plugins/spec-driver/templates/tech-research-template.md\`` 替换为 `- 使用模板：优先读取 \`.specify/templates/tech-research-template.md\`（项目级），若不存在则回退到 \`plugins/spec-driver/templates/tech-research-template.md\`（plugin 内置）`；同时在"执行流程"第 6 步"产品-技术对齐度评估"与第 7 步"生成报告"之间插入步骤 6.5"加载报告模板"，内容为条件加载指令（检查 `.specify/templates/tech-research-template.md` 是否存在，存在用项目级，不存在回退 plugin 内置）
- [x] T010 [P] [US2] 修改 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 第 374 行 Phase 1c 段落：将 `读取 product-research.md + tech-research.md + \`plugins/spec-driver/templates/research-synthesis-template.md\`` 替换为 `读取 product-research.md + tech-research.md，加载产研汇总模板（优先读取 \`.specify/templates/research-synthesis-template.md\`，若不存在则回退到 \`plugins/spec-driver/templates/research-synthesis-template.md\`）`

**Checkpoint**: 3 个 Markdown prompt 文件均包含"项目级优先、plugin 回退"的条件加载指令。未配置项目级模板时回退行为与变更前一致（FR-008 向后兼容）

---

## Phase 5: User Story 4 - 验证报告模板可项目级定制 (Priority: P2)

**Goal**: 修改 verify 子代理 prompt，实现验证报告模板的"项目级优先、plugin 回退"加载

**Independent Test**: 修改项目级 `.specify/templates/verification-report-template.md`，运行 verify 子代理，验证生成的验证报告使用了自定义模板

### Implementation for User Story 4

- [x] T011 [US4] 修改 `plugins/spec-driver/agents/verify.md` 第 14 行：将 `- 使用模板：\`plugins/spec-driver/templates/verification-report-template.md\`` 替换为 `- 使用模板：优先读取 \`.specify/templates/verification-report-template.md\`（项目级），若不存在则回退到 \`plugins/spec-driver/templates/verification-report-template.md\`（plugin 内置）`；同时修改第 7 步"生成验证报告"处，在"按模板写入"之前追加条件加载说明：`**加载报告模板**: 检查 \`.specify/templates/verification-report-template.md\` 是否存在，如存在则使用项目级模板，否则使用 \`plugins/spec-driver/templates/verification-report-template.md\``

**Checkpoint**: verify 子代理 prompt 包含条件加载指令，与 Phase 4 中其他子代理的模式一致

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 验证变更的完整性和一致性

- [x] T012 [P] 检查 10 个模板文件名在三处定义的一致性：`REQUIRED_TEMPLATES`（TypeScript）、`REQUIRED_SPECIFY_TEMPLATES`（Bash）、`plugins/spec-driver/templates/specify-base/` 目录内容。三者列表必须完全匹配
- [x] T013 [P] 验证幂等同步行为：在 `.specify/templates/` 中已存在自定义调研模板的情况下重新运行同步，确认不覆盖已有文件
- [x] T014 验证向后兼容：删除 `.specify/templates/` 中的调研模板后，确认子代理回退到 plugin 内置路径正常工作

---

## FR Coverage Map

| FR | 描述 | 覆盖任务 |
|----|------|----------|
| FR-001 | 调研模板纳入 REQUIRED_TEMPLATES | T006, T007 |
| FR-002 | specify-base 包含 4 个调研模板基准版本 | T002, T003, T004, T005 |
| FR-003 | 幂等复制（已存在不覆盖） | T006, T007（现有同步逻辑保证）, T013 |
| FR-004 | product-research 条件加载 | T008 |
| FR-005 | tech-research 条件加载 | T009 |
| FR-006 | 编排器 research-synthesis 条件加载 | T010 |
| FR-007 | verify 条件加载 | T011 |
| FR-008 | 项目级不存在时回退 plugin 内置 | T008, T009, T010, T011, T014 |
| FR-009 | 同步结果返回 copied/missing | T006, T007（现有返回逻辑自动适用） |
| FR-010 | 与现有基础模板行为一致 | T002-T005, T006-T007, T008-T011, T012 |

**FR 覆盖率**: 10/10 (100%)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖，确认环境
- **Phase 2 (US3)**: 依赖 Phase 1 完成。创建 specify-base 基准模板，是 Phase 3 同步机制的前提
- **Phase 3 (US1)**: 依赖 Phase 2 完成。同步机制需要 specify-base 中存在模板文件才能正确工作
- **Phase 4 (US2)**: 依赖 Phase 2 完成（子代理需要知道模板路径）。与 Phase 3 无强依赖，可并行
- **Phase 5 (US4)**: 依赖 Phase 2 完成。与 Phase 3/4 无强依赖，可并行
- **Phase 6 (Polish)**: 依赖 Phase 2-5 全部完成

### User Story Dependencies

- **US3 (specify-base)**: 无 Story 依赖。是 US1 和 US2/US4 的基础设施前提
- **US1 (同步扩展)**: 依赖 US3（specify-base 中需要有模板文件）
- **US2 (子代理条件加载)**: 依赖 US3（子代理回退路径需要模板存在）。与 US1 无强依赖
- **US4 (verify 定制)**: 依赖 US3。与 US1/US2 无强依赖

### Parallel Opportunities

- **Phase 2 内部**: T002, T003, T004, T005 可完全并行（4 个独立文件复制）
- **Phase 3 内部**: T006, T007 可并行（TypeScript 和 Bash 是不同文件）
- **Phase 4 内部**: T008, T009, T010 可并行（3 个不同 Markdown 文件）
- **Phase 3 + Phase 4 + Phase 5**: Phase 2 完成后，Phase 3/4/5 可并行启动（不同文件，无交叉依赖）
- **Phase 6 内部**: T012, T013 可并行

### Recommended Strategy

**MVP First**: 本功能变更量小（4 个文件复制 + 2 个列表扩展 + 4 个 prompt 修改），建议按 Phase 顺序线性执行，总计约 14 个任务，单人可在一次会话内完成。

---

## Notes

- 所有新增文件均为 Markdown 模板的纯文本复制，无需代码生成
- TypeScript 和 Bash 的修改均为常量数组扩展，不涉及逻辑变更
- 子代理 prompt 修改为 Markdown 文本编辑，不涉及运行时代码
- 向后兼容由现有同步逻辑的幂等设计保证：目标文件存在则跳过，不存在则从 specify-base 复制
