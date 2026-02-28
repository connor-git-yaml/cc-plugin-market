# Tasks: Speckit Driver Pro

**Input**: Design documents from `/specs/011-speckit-driver-pro/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Plugin root**: `plugins/speckit-driver-pro/`
- **Agents**: `plugins/speckit-driver-pro/agents/`
- **Templates**: `plugins/speckit-driver-pro/templates/`
- **Scripts**: `plugins/speckit-driver-pro/scripts/`
- **Skills**: `plugins/speckit-driver-pro/skills/speckit-driver-pro/`

---

## Phase 1: Setup (Plugin Directory Structure)

**Purpose**: 创建 Plugin 目录骨架和元数据清单文件

- [x] T001 Create plugin directory structure: `plugins/speckit-driver-pro/` with subdirectories `.claude-plugin/`, `hooks/`, `scripts/`, `skills/speckit-driver-pro/`, `agents/`, `templates/`
- [x] T002 [P] Create plugin manifest in `plugins/speckit-driver-pro/.claude-plugin/plugin.json` with name=speckit-driver-pro, version=1.0.0, description, author, license, keywords, hooks reference per plan.md Plugin 集成设计
- [x] T003 [P] Create hook configuration in `plugins/speckit-driver-pro/hooks/hooks.json` with SessionStart event triggering `./scripts/postinstall.sh` per plan.md Plugin 集成设计

---

## Phase 2: Foundational (Core Sub-Agent Prompts)

**Purpose**: 创建 8 个核心子代理 prompt 文件，这些子代理对应已有 speckit skills（specify、clarify、checklist、plan、tasks、analyze、implement）加上 Driver Pro 特有的 constitution 子代理。所有子代理遵循 plan.md 定义的通用 prompt 框架（角色→输入→执行流程→输出→约束→失败处理）。

**⚠️ CRITICAL**: 主编排器 SKILL.md 依赖这些子代理存在才能完整运行

- [x] T004 [P] Create `plugins/speckit-driver-pro/agents/constitution.md` — Phase 0 宪法检查子代理：读取 constitution.md，检查需求是否违反项目原则，输出 PASS/VIOLATION。参考 sub-agent-contract.md constitution 契约
- [x] T005 [P] Create `plugins/speckit-driver-pro/agents/specify.md` — Phase 2 需求规范子代理：基于 research-synthesis.md 生成 spec.md，高信心歧义自动选择标注 [AUTO-RESOLVED]（FR-019）。参考 .claude/commands/speckit.specify.md + sub-agent-contract.md specify 契约
- [x] T006 [P] Create `plugins/speckit-driver-pro/agents/clarify.md` — Phase 3 需求澄清子代理：检测歧义并在"信任但验证"策略下自动选择推荐答案（FR-006），仅 CRITICAL 决策点交用户。参考 .claude/commands/speckit.clarify.md + sub-agent-contract.md clarify 契约
- [x] T007 [P] Create `plugins/speckit-driver-pro/agents/checklist.md` — Phase 3.5 质量检查表子代理：生成 checklists/requirements.md 并验证规范质量。参考 .claude/commands/speckit.checklist.md + sub-agent-contract.md checklist 契约
- [x] T008 [P] Create `plugins/speckit-driver-pro/agents/plan.md` — Phase 4 技术规划子代理：生成 plan.md + research.md + data-model.md + contracts/，含 Constitution Check 门控。参考 .claude/commands/speckit.plan.md + sub-agent-contract.md plan 契约
- [x] T009 [P] Create `plugins/speckit-driver-pro/agents/tasks.md` — Phase 5 任务分解子代理：按 User Story 优先级生成依赖排序的任务清单。参考 .claude/commands/speckit.tasks.md + sub-agent-contract.md tasks 契约
- [x] T010 [P] Create `plugins/speckit-driver-pro/agents/analyze.md` — Phase 5.5 一致性分析子代理：跨制品一致性检查，输出 CRITICAL/WARNING 级别发现，触发 GATE_ANALYSIS。参考 .claude/commands/speckit.analyze.md + sub-agent-contract.md analyze 契约
- [x] T011 [P] Create `plugins/speckit-driver-pro/agents/implement.md` — Phase 6 实现子代理：按 tasks.md 逐阶段实现代码（Setup→Tests→Core→Integration→Polish），更新 checkbox 进度。参考 .claude/commands/speckit.implement.md + sub-agent-contract.md implement 契约

**Checkpoint**: 8 个核心子代理 prompt 文件就绪，可进入主编排器开发

---

## Phase 3: User Story 1 - 一键启动完整研发流程 (Priority: P1) 🎯 MVP

**Goal**: 创建主编排器 SKILL.md——Driver Pro 的核心，实现"研发总监"角色，统筹 10 个阶段的自治编排流程

**Independent Test**: 在已有 constitution 的项目中触发 `/speckit-driver-pro "添加用户认证"`，验证系统按 10 阶段自动编排，仅在 ≤4 个决策点暂停，最终生成完整制品链

### Implementation for User Story 1

- [x] T012 [US1] Create `plugins/speckit-driver-pro/skills/speckit-driver-pro/SKILL.md` — 主编排器 skill，包含以下核心模块（FR-001, FR-002, FR-006, FR-007, FR-020, FR-021, FR-022, FR-023）:
  - 角色定义："研发总监"，全局决策和质量把控
  - 10 阶段工作流定义（constitution → product-research → tech-research → synthesis → specify → clarify → checklist → plan → tasks → analyze → implement → verify）
  - 子代理委派逻辑：通过 Task tool 的 prompt + model 参数动态委派，读取 agents/*.md 内容作为 prompt
  - Speckit skill 兼容检测：初始化时一次性检测 .claude/commands/speckit.*.md，存在则优先使用（FR-015, research.md 决策 7）
  - 4 道质量门框架（GATE_RESEARCH=ALWAYS_PAUSE, GATE_ANALYSIS=CONDITIONAL, GATE_TASKS=ALWAYS_PAUSE, GATE_VERIFY=CONDITIONAL）（FR-007, data-model.md QualityGate）
  - "信任但验证"自动推进策略：WARNING 自动继续，CRITICAL 暂停（FR-006）
  - 阶段级进度报告：`[N/10] 正在执行...` + 完成摘要（FR-023, orchestrator-contract.md）
  - 子代理失败重试：最多 2 次，仍失败则暂停交用户（FR-022）
  - 中断恢复：扫描已有制品判断恢复点（FR-020, plan.md 中断恢复机制）
  - 选择性重跑：--rerun 参数，后续制品标记 [STALE]（FR-021, plan.md 选择性重跑机制）
  - 产研汇总（Phase 1c）：编排器亲自执行，读取两份调研报告生成 research-synthesis.md（FR-005, research.md 决策 5）
  - 输入参数解析：$ARGUMENTS（需求描述）、--resume、--rerun、--preset（orchestrator-contract.md）
  - 完成报告输出格式（orchestrator-contract.md 正常完成/暂停/恢复模式）

**Checkpoint**: 主编排器 SKILL.md 完成——此时 Plugin 已具备核心编排能力（使用 Phase 2 的内置子代理），可端到端运行完整流程

---

## Phase 4: User Story 2 - 产品调研与技术调研驱动的规范生成 (Priority: P1)

**Goal**: 创建调研子代理和模板，使 Driver Pro 能在规范生成前执行结构化的产品和技术调研

**Independent Test**: 触发 Driver Pro 后，检查 `specs/[feature]/research/` 下生成 product-research.md、tech-research.md、research-synthesis.md，且 synthesis 包含产品×技术交叉矩阵

### Implementation for User Story 2

- [x] T013 [P] [US2] Create `plugins/speckit-driver-pro/agents/product-research.md` — Phase 1a 产品调研子代理（FR-003, FR-004）：市场需求验证、竞品分析（≥3 个）、用户场景验证、MVP 范围建议。支持 WebSearch/Perplexity MCP + Read 工具，Web 不可用时降级为本地分析。参考 sub-agent-contract.md product-research 契约
- [x] T014 [P] [US2] Create `plugins/speckit-driver-pro/agents/tech-research.md` — Phase 1b 技术调研子代理（FR-003, FR-004）：架构方案选型（≥2 个）、依赖库评估、设计模式调研、技术风险清单。必须基于产品调研结论（输入 product-research.md）。参考 sub-agent-contract.md tech-research 契约
- [x] T015 [P] [US2] Create `plugins/speckit-driver-pro/templates/product-research-template.md` — 产品调研报告模板：市场现状、竞品对比表、用户场景验证、差异化机会、MVP 范围建议
- [x] T016 [P] [US2] Create `plugins/speckit-driver-pro/templates/tech-research-template.md` — 技术调研报告模板：架构方案对比表、依赖库评估矩阵、设计模式推荐、技术风险清单、与产品结论的对齐度
- [x] T017 [P] [US2] Create `plugins/speckit-driver-pro/templates/research-synthesis-template.md` — 产研汇总模板（FR-005）：产品×技术交叉分析矩阵、可行性评估、风险评估、最终推荐方案、MVP 范围界定

**Checkpoint**: 调研子代理和模板就绪——触发 Driver Pro 后可完整执行产品调研→技术调研→产研汇总→规范生成的串行流程

---

## Phase 5: User Story 3 - 多语言验证闭环 (Priority: P2)

**Goal**: 创建验证子代理和模板，支持 12+ 种语言/构建系统的自动检测和验证执行

**Independent Test**: 在 TypeScript + Rust 的 Monorepo 中运行，验证阶段自动检测两种语言，分别执行构建/Lint/测试，输出包含两种语言独立结果的验证报告

### Implementation for User Story 3

- [x] T018 [US3] Create `plugins/speckit-driver-pro/agents/verify.md` — Phase 7 验证子代理（FR-008, FR-009, FR-010, FR-016, FR-017, FR-018）：
  - Layer 1 Spec-Code 对齐验证：逐条检查 FR 是否已实现
  - Layer 2 原生工具链验证：18 种语言/构建系统的特征文件检测算法（plan.md 多语言验证矩阵）
  - Monorepo 支持：检测 workspace 配置，递归扫描子项目
  - 工具未安装时优雅降级：标记"工具未安装"不阻断（FR-017）
  - spec-driver.config.yaml 自定义命令覆盖（FR-018）
  - 触发 GATE_VERIFY 质量门
  - 参考 sub-agent-contract.md verify 契约 + plan.md Detection Algorithm
- [x] T019 [P] [US3] Create `plugins/speckit-driver-pro/templates/verification-report-template.md` — 验证报告模板：Layer 1 Spec-Code 对齐表、Layer 2 各语言构建/Lint/测试结果、Monorepo 子项目独立报告、总体摘要（sub-agent-contract.md 验证报告结构）

**Checkpoint**: 验证闭环就绪——实现阶段完成后可自动执行多语言验证并输出结构化报告

---

## Phase 6: User Story 4 - 模型分级配置 (Priority: P2)

**Goal**: 创建配置模板，使用户可通过预设或自定义方式配置每个子代理的模型选择

**Independent Test**: 使用 balanced 预设启动，调研用 Opus、任务分解用 Sonnet；切换 quality-first 后全部用 Opus

### Implementation for User Story 4

- [x] T020 [US4] Create `plugins/speckit-driver-pro/templates/spec-driver.config-template.yaml` — 驱动配置模板（FR-011, FR-012）：三级结构 preset→agents→verification，含 balanced/quality-first/cost-efficient 三套完整预设配置，质量门配置，重试策略配置，进度输出配置。参考 contracts/config-schema.yaml + plan.md 模型分级配置表

**Checkpoint**: 配置系统就绪——首次使用时交互式引导选择预设，后续可在 spec-driver.config.yaml 中精细调整

---

## Phase 7: User Story 5 - Plugin 安装与初始化 (Priority: P3)

**Goal**: 创建安装和初始化脚本，实现开箱即用的安装体验和项目级自适应初始化

**Independent Test**: 在空项目中安装 Plugin 并首次触发，检查 .specify/ 目录正确创建、模板就位、constitution 检查引导

### Implementation for User Story 5

- [x] T021 [P] [US5] Create `plugins/speckit-driver-pro/scripts/postinstall.sh` — 安装后脚本（FR-013）：检查 Claude Code 版本兼容性，输出安装成功消息和使用提示。参考 research.md 决策 8 postinstall.sh 职责
- [x] T022 [P] [US5] Create `plugins/speckit-driver-pro/scripts/init-project.sh` — 项目初始化脚本（FR-014, FR-015）：检查 .specify/ 目录（不存在则创建）、检查 constitution.md（不存在则引导创建）、检查 spec-driver.config.yaml（不存在则交互式引导选择预设）、检测已有 speckit skills（生成 prompt 来源映射）。参考 research.md 决策 8 init-project.sh 职责

**Checkpoint**: 安装和初始化流程就绪——Plugin 可从 marketplace 安装并在任意项目中首次使用

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 文档完善和全局验证

- [x] T023 Create `plugins/speckit-driver-pro/README.md` — Plugin 说明文档：功能概述、安装方法、使用说明（quickstart 摘要）、配置说明、子代理列表、与 speckit skills 的关系、与 reverse-spec 的互补关系
- [x] T024 Validate cross-references: 确认 SKILL.md 中引用的所有 agents/*.md 文件路径正确、spec-driver.config-template.yaml 中的 agent ID 与 agents/ 目录一致、templates/ 中的占位符与 sub-agent 输出格式匹配、hooks.json 中的脚本路径正确
- [x] T025 Validate FR coverage: 逐条检查 spec.md 中 23 条 FR 是否全部在 SKILL.md + agents/ + templates/ + scripts/ 中有对应实现，标记任何遗漏

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖——立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 完成（目录结构必须存在）
- **US1 (Phase 3)**: 依赖 Phase 2 完成（SKILL.md 需要引用核心子代理文件）
- **US2 (Phase 4)**: 依赖 Phase 1 完成（只需目录存在），可与 Phase 2/3 并行
- **US3 (Phase 5)**: 依赖 Phase 1 完成，可与 Phase 2/3/4 并行
- **US4 (Phase 6)**: 依赖 Phase 1 完成，可与 Phase 2/3/4/5 并行
- **US5 (Phase 7)**: 依赖 Phase 1 完成，可与 Phase 2/3/4/5/6 并行
- **Polish (Phase 8)**: 依赖 Phase 1-7 全部完成

### User Story Dependencies

- **US1 (P1)**: 依赖 Phase 2（核心子代理）——这是 MVP 的核心
- **US2 (P1)**: 无跨 Story 依赖——调研子代理和模板独立于其他 Story
- **US3 (P2)**: 无跨 Story 依赖——验证子代理独立
- **US4 (P2)**: 无跨 Story 依赖——配置模板独立
- **US5 (P3)**: 无跨 Story 依赖——脚本独立

### Within Each User Story

- 子代理 prompt 文件可并行创建（不同文件，无依赖）
- 模板文件可与子代理并行创建
- SKILL.md 编写应在核心子代理就绪后进行

### Parallel Opportunities

- Phase 2 的 T004-T011 全部可并行（8 个独立文件）
- Phase 4 的 T013-T017 全部可并行（5 个独立文件）
- Phase 5 的 T018-T019 可并行
- Phase 7 的 T021-T022 可并行
- Phase 4/5/6/7 跨 Story 可并行（都只依赖 Phase 1 的目录结构）

---

## Parallel Example: Phase 2 (Foundational)

```bash
# 8 个核心子代理可同时创建：
Task: "Create constitution sub-agent in plugins/speckit-driver-pro/agents/constitution.md"
Task: "Create specify sub-agent in plugins/speckit-driver-pro/agents/specify.md"
Task: "Create clarify sub-agent in plugins/speckit-driver-pro/agents/clarify.md"
Task: "Create checklist sub-agent in plugins/speckit-driver-pro/agents/checklist.md"
Task: "Create plan sub-agent in plugins/speckit-driver-pro/agents/plan.md"
Task: "Create tasks sub-agent in plugins/speckit-driver-pro/agents/tasks.md"
Task: "Create analyze sub-agent in plugins/speckit-driver-pro/agents/analyze.md"
Task: "Create implement sub-agent in plugins/speckit-driver-pro/agents/implement.md"
```

## Parallel Example: Phase 4 (US2 Research)

```bash
# 5 个调研相关文件可同时创建：
Task: "Create product-research agent in plugins/speckit-driver-pro/agents/product-research.md"
Task: "Create tech-research agent in plugins/speckit-driver-pro/agents/tech-research.md"
Task: "Create product research template in plugins/speckit-driver-pro/templates/product-research-template.md"
Task: "Create tech research template in plugins/speckit-driver-pro/templates/tech-research-template.md"
Task: "Create research synthesis template in plugins/speckit-driver-pro/templates/research-synthesis-template.md"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (3 tasks)
2. Complete Phase 2: Foundational — 8 core sub-agents (8 tasks)
3. Complete Phase 3: US1 — Main orchestrator SKILL.md (1 task, 最关键)
4. **STOP and VALIDATE**: 在测试项目中触发 `/speckit-driver-pro`，验证 10 阶段编排流程（调研阶段使用占位逻辑）
5. 此时 Plugin 已可端到端运行

### Incremental Delivery

1. Setup + Foundational → 核心骨架就绪
2. Add US1 (SKILL.md) → 编排引擎就绪 → **MVP!**
3. Add US2 (调研子代理) → 调研驱动能力上线
4. Add US3 (验证子代理) → 验证闭环上线
5. Add US4 (配置模板) → 模型配置灵活性上线
6. Add US5 (初始化脚本) → 安装体验完善
7. Polish → 文档 + 全局验证

### Parallel Team Strategy

With multiple developers:

1. 团队完成 Setup (Phase 1)
2. 并行分工:
   - Developer A: Phase 2 (Foundational sub-agents) → Phase 3 (US1 SKILL.md)
   - Developer B: Phase 4 (US2 research) + Phase 5 (US3 verify)
   - Developer C: Phase 6 (US4 config) + Phase 7 (US5 scripts) + Phase 8 (Polish)
3. 全部合并后进行端到端验证

---

## FR Coverage Map

| FR | Task(s) | Story |
| ---- | ---- | ---- |
| FR-001 主编排器 | T012 | US1 |
| FR-002 Task tool 委派 | T012 | US1 |
| FR-003 串行调研 | T013, T014 | US2 |
| FR-004 模块并行 | T013, T014 | US2 |
| FR-005 产研汇总 | T012, T017 | US1+US2 |
| FR-006 信任但验证 | T012 | US1 |
| FR-007 ≤4 决策点 | T012 | US1 |
| FR-008 验证子代理 | T018 | US3 |
| FR-009 12+ 语言 | T018 | US3 |
| FR-010 Monorepo | T018 | US3 |
| FR-011 模型预设 | T020 | US4 |
| FR-012 自定义模型 | T020 | US4 |
| FR-013 Plugin 标准结构 | T002, T003 | Setup |
| FR-014 自动初始化 | T022 | US5 |
| FR-015 自包含+兼容 | T012, T022 | US1+US5 |
| FR-016 两层验证 | T018 | US3 |
| FR-017 优雅降级 | T018 | US3 |
| FR-018 自定义验证命令 | T018, T020 | US3+US4 |
| FR-019 自动解决歧义 | T006 | Foundational |
| FR-020 制品持久化+恢复 | T012 | US1 |
| FR-021 选择性重跑 | T012 | US1 |
| FR-022 失败重试 | T012 | US1 |
| FR-023 进度报告 | T012 | US1 |

---

## Notes

- [P] tasks = 不同文件，无依赖，可并行
- [Story] 标签映射任务到特定 User Story 以便追踪
- 本项目是纯声明式 Plugin（Markdown + YAML + Bash），无编译步骤
- SKILL.md（T012）是最关键也最复杂的单一文件，建议预留充分时间
- 每个子代理 prompt 应参考对应的 .claude/commands/speckit.*.md 和 sub-agent-contract.md
- 提交策略：每完成一个 Phase 提交一次
