# Tasks: 借鉴 Superpowers 行为约束模式与增强人工控制权

**Input**: Design documents from `/specs/017-adopt-superpowers-patterns/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, quickstart.md

**Tests**: 本特性为纯 Markdown/YAML/Shell 变更，不含 TypeScript 代码，不需要自动化测试。验证通过手动在三种模式 x 三种策略下运行完整流程完成。

**Organization**: 任务按 User Story 优先级分组，支持增量交付。每个 Story 完成后可独立验证。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（如 US1, US2, US3）
- 所有文件路径相对于仓库根目录

---

## Phase 1: Setup（配置基础设施）

**Purpose**: 扩展配置文件结构，为所有 User Story 提供共享的配置基础

- [x] T001 在 `plugins/spec-driver/templates/spec-driver.config-template.yaml` 的 `quality_gates` 章节之后新增 `gate_policy` 配置段（含注释说明三级策略 strict/balanced/autonomous，默认 balanced）和 `gates` 配置段（含注释示例展示每个门禁的 pause 可选值 always/auto/on_failure），参考 plan.md "8. spec-driver.config-template.yaml" 章节的完整 YAML 内容
- [x] T002 在 `spec-driver.config.yaml`（项目根目录实例）的 `quality_gates` 章节之后同步新增 `gate_policy: balanced` 和 `gates` 注释示例，保持与模板一致

**Checkpoint**: 配置结构就绪，编排器和子代理可读取新配置字段

---

## Phase 2: Foundational（阻塞性前置依赖）

**Purpose**: 创建两个新增子代理文件，这是 US-1（验证铁律）和 US-3（双阶段审查）的前置依赖

**CRITICAL**: Phase 3-5 的编排器集成依赖此阶段的子代理文件存在

- [x] T003 [P] 创建 `plugins/spec-driver/agents/spec-review.md`——Spec 合规审查子代理。内容包括：角色定义（Spec 合规审查员）、输入（spec.md + tasks.md + 源代码）、工具权限（Read/Glob/Grep 只读）、执行流程（从 spec.md 提取所有 FR → 逐条检查实现状态 → 检测过度实现）、输出格式（逐条 FR 状态表：FR 编号 | 描述 | 状态[已实现/部分实现/未实现/过度实现] | 证据/说明 + 总体合规率 + 偏差清单 + 过度实现检测）、问题分级（CRITICAL: FR 未实现 / WARNING: 部分实现 / INFO: 过度实现）、约束（只读、不修改源代码）。参考 plan.md "3. spec-review.md" 章节
- [x] T004 [P] 创建 `plugins/spec-driver/agents/quality-review.md`——代码质量审查子代理。内容包括：角色定义（代码质量审查员）、输入（plan.md + spec.md + 源代码）、工具权限（Read/Glob/Grep 只读）、执行流程（四维度评估：设计模式合理性、安全性[OWASP Top 10]、性能[N+1/内存泄漏]、可维护性[函数长度/注释/命名]）、输出格式（四维度评估表 + 问题清单[CRITICAL/WARNING/INFO | 位置 | 描述 | 修复建议] + 总体评级[EXCELLENT/GOOD/NEEDS_IMPROVEMENT/POOR]）、对纯 Markdown/YAML/Shell 项目标注"不适用"维度的降级处理、约束（只读）。参考 plan.md "4. quality-review.md" 章节

**Checkpoint**: 两个新增子代理文件就绪，编排器可在 Phase 7 中调用

---

## Phase 3: User Story 1 — 验证铁律：杜绝未验证的完成声明 (Priority: P1)

**Goal**: 实现子代理在声称完成前必须运行验证命令并提供证据，验证子代理二次核查证据真实性

**Independent Test**: 在有构建/测试命令的项目中运行完整流程，检查实现阶段返回中是否包含实际运行的验证命令输出（而非"should pass"推测）；验证阶段报告中应包含"验证铁律合规"章节

### 实现

- [x] T005 [US1] 修改 `plugins/spec-driver/agents/implement.md`——在"进度追踪"（第 5 节）之后、"Phase 完成验证"（第 6 节）之前插入新的"验证铁律"章节（第 5.5 节）。内容包括：(1) 铁律规则声明——使用 MUST/NEVER 大写强调，要求声称完成前在当前执行上下文中运行验证命令；(2) "excuse vs reality"对照表——左列列出禁止的推测性表述（"should pass""looks correct""tests will likely pass""代码看起来没问题"），右列列出要求的实际证据格式（"运行 npm test，输出: 23 tests passed""运行 npm run build，退出码 0"）；(3) 完成声明模板——要求包含命令名称、退出码、输出摘要三要素；(4) 无可用验证工具的降级处理——标注"无可用验证工具"不阻断流程。参考 plan.md "1. implement.md" 章节和 quickstart.md "验证铁律"段落
- [x] T006 [US1] 修改 `plugins/spec-driver/agents/verify.md`——在现有"Layer 1: Spec-Code 对齐验证"和"Layer 2: 原生工具链验证"之间插入"验证证据检查"步骤（新增 Layer 1.5）。内容包括：(1) 检查 implement 子代理返回消息中是否包含实际运行的验证命令输出文本（非引用性描述）；(2) 检测推测性表述的规则列表（"should pass""looks correct"等触发 EVIDENCE_MISSING 标记）；(3) 在验证报告中新增"验证铁律合规"章节——包含铁律合规状态（COMPLIANT/EVIDENCE_MISSING/PARTIAL）和缺失的验证类型（构建/测试/Lint）。同时将 Layer 1 的逐条 FR 检查标注为"精简版"（详细逐条检查已移至 spec-review.md），verify.md 仅保留 checkbox 级 FR 覆盖率统计。参考 plan.md "2. verify.md" 章节

**Checkpoint**: 验证铁律的 Prompt 层（Layer 1）和 verify 子代理核查层（Layer 3）就绪

---

## Phase 4: User Story 3 — 双阶段代码审查：Spec 合规 + 代码质量分离 (Priority: P1)

**Goal**: 将验证阶段拆分为三个子调用（7a: Spec 合规审查 → 7b: 代码质量审查 → 7c: 工具链验证），输出两份独立审查报告

**Independent Test**: 在有明确 spec.md 的项目中运行完整流程，验证阶段应输出两份独立报告——Spec 合规报告（逐条 FR 状态）和代码质量报告（四维度评估），且质量门合并三份报告结果决策

### 实现

- [x] T007 [US3] 修改 `plugins/spec-driver/skills/speckit-feature/SKILL.md`——将现有 "Phase 7: 验证闭环 [10/10]" 拆分为三个子调用。具体变更：将当前 Phase 7 的单次 Task 调用替换为三步编排：(1) Phase 7a: 读取 `plugins/spec-driver/agents/spec-review.md` prompt，调用 Task 执行 Spec 合规审查（注入 spec.md + tasks.md 路径）；(2) Phase 7b: 读取 `plugins/spec-driver/agents/quality-review.md` prompt，调用 Task 执行代码质量审查（注入 plan.md + spec.md 路径）；(3) Phase 7c: 读取现有 `verify.md` prompt，调用 Task 执行工具链验证 + 验证证据核查（注入 7a/7b 报告路径）。三步完成后合并结果：任一报告有 CRITICAL → 按 GATE_VERIFY 行为决策。参考 plan.md "5d. Phase 7" 章节
- [x] T008 [US3] 修改 `plugins/spec-driver/skills/speckit-story/SKILL.md`——将现有 "Phase 5: 验证闭环 [5/5]" 拆分为三个子调用（与 T007 相同的 7a/7b/7c 结构），适配 story 模式的上下文注入（代码上下文摘要替代 research-synthesis.md）。GATE_VERIFY 决策逻辑与 feature 模式一致
- [x] T009 [US3] 修改 `plugins/spec-driver/skills/speckit-fix/SKILL.md`——将现有 "Phase 4: 验证闭环 [4/4]" 拆分为三个子调用（与 T007 相同的 7a/7b/7c 结构），适配 fix 模式的上下文注入（fix-report.md 替代 plan.md 作为 quality-review 的输入）。GATE_VERIFY 决策逻辑与 feature 模式一致

**Checkpoint**: 三种模式的验证阶段均已拆分为双阶段审查 + 工具链验证

---

## Phase 5: User Story 2 — 门禁粒度增强：三级策略满足不同场景 (Priority: P1)

**Goal**: 编排器在每个质量门根据 gate_policy + gates 配置决定暂停/自动继续行为，并输出格式化决策日志

**Independent Test**: 分别使用 strict/balanced/autonomous 策略运行同一流程，验证 strict 下所有门禁暂停、balanced 下仅 GATE_DESIGN/GATE_TASKS/GATE_VERIFY 暂停、autonomous 下仅 CRITICAL 时暂停

### 实现

- [x] T010 [US2] 修改 `plugins/spec-driver/skills/speckit-feature/SKILL.md`——在"初始化阶段"的"3. 配置加载"步骤之后新增"4. 门禁配置加载"步骤（原"4. Prompt 来源映射"后移为第 5 步）。新增内容：(1) 读取 gate_policy 字段（默认 balanced）；(2) 读取 gates 字段（默认空）；(3) 仅为 feature 模式存在的 5 个门禁构建行为表（balanced 默认值：GATE_RESEARCH=auto, GATE_ANALYSIS=on_failure, GATE_DESIGN=always, GATE_TASKS=always, GATE_VERIFY=always；strict 全部 always；autonomous 全部 on_failure）；(4) 门禁级 gates 配置覆盖全局策略。参考 plan.md "5a. 初始化阶段" 的门禁行为表构建逻辑。**注意**: story 模式仅有 3 个门禁（GATE_DESIGN/TASKS/VERIFY），fix 模式仅有 2 个（GATE_DESIGN/VERIFY），各模式仅构建其实际存在的门禁行为
- [x] T011 [US2] 修改 `plugins/spec-driver/skills/speckit-feature/SKILL.md`——改造现有的四个质量门（GATE_RESEARCH、GATE_ANALYSIS、GATE_TASKS、GATE_VERIFY）加入策略条件分支。每个质量门的现有逻辑替换为：(1) 获取 behavior[GATE_X]；(2) always → 暂停展示结果等待用户选择；auto → 自动继续仅日志记录；on_failure → 检查结果有 CRITICAL 则暂停否则自动继续；(3) 输出格式化决策日志 `[GATE] GATE_X | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | reason={理由}`。参考 plan.md "5c. 各质量门" 章节
- [x] T012 [P] [US2] 修改 `plugins/spec-driver/skills/speckit-story/SKILL.md`——在初始化阶段新增门禁配置加载（与 T010 相同逻辑），改造 GATE_TASKS 和 GATE_VERIFY 两个质量门加入策略条件分支（与 T011 相同模式）。Story 模式仅有 GATE_TASKS 和 GATE_VERIFY 两个质量门
- [x] T013 [P] [US2] 修改 `plugins/spec-driver/skills/speckit-fix/SKILL.md`——在初始化阶段新增门禁配置加载（与 T010 相同逻辑），改造 GATE_VERIFY 质量门加入策略条件分支（与 T011 相同模式）。Fix 模式仅有 GATE_VERIFY 一个质量门

**Checkpoint**: 三种模式的所有质量门均支持三级策略配置，门禁决策日志可追溯

---

## Phase 6: User Story 4 — 设计硬门禁：规范未批准禁止实现 (Priority: P1)

**Goal**: 在 spec.md 生成后新增 GATE_DESIGN 暂停点，feature 模式下不可绕过，确保设计方案必须经人工批准

**Independent Test**: 分别在 strict/balanced/autonomous 策略下运行 feature 模式，验证 spec.md 生成后系统均暂停等待确认，不自动跳过

**依赖**: T010-T011（门禁配置加载逻辑必须先就绪）

### 实现

- [x] T014 [US4] 修改 `plugins/spec-driver/skills/speckit-feature/SKILL.md`——在 "Phase 3: 需求澄清 [6/10]"（含 Phase 3.5 质量检查表）之后、"Phase 4: 技术规划 [7/10]" 之前插入 "Phase 3.5: 设计门禁 [GATE_DESIGN]" 章节。此位置确保用户审批的是已澄清的完整 spec 而非初稿。内容包括：(1) 此阶段由编排器亲自执行，不委派子代理；(2) 检查运行模式——feature 模式强制暂停（不检查配置，硬门禁）；(3) 暂停时展示 spec.md 关键摘要（User Stories 数量、FR 数量、成功标准）；(4) 等待用户选择：A) 批准继续 → 进入 Phase 4（技术规划），B) 修改需求 → 重跑 Phase 2/3（需求规范/澄清），C) 中止流程；(5) 输出门禁决策日志 `[GATE] GATE_DESIGN | mode=feature | policy={gate_policy} | decision=PAUSE | reason=硬门禁，feature 模式不可跳过`。参考 plan.md "5b. Phase 3 后" 章节

**Checkpoint**: Feature 模式的设计硬门禁就绪，不受任何策略配置影响

---

## Phase 7: User Story 5 — Story 模式差异化：设计硬门禁的智能豁免 (Priority: P2)

**Goal**: Story/Fix 模式默认跳过 GATE_DESIGN，用户可通过配置覆盖豁免行为

**Independent Test**: 在 story 模式下运行流程验证默认不暂停；然后配置 `gates.GATE_DESIGN.pause: always` 后再次运行验证暂停生效；fix 模式行为与 story 一致

**依赖**: T014（GATE_DESIGN 逻辑模式已建立）

### 实现

- [x] T015 [US5] 修改 `plugins/spec-driver/skills/speckit-story/SKILL.md`——在 "Phase 2: 需求规范 [2/5]"（spec.md 生成后、澄清之前）插入 "Phase 2.5: 设计门禁 [GATE_DESIGN]" 章节。内容包括：(1) 此阶段由编排器亲自执行；(2) 检查 gates.GATE_DESIGN.pause 配置——如果为 "always" 则暂停（展示 spec 摘要 + 等待用户选择），否则自动继续（默认豁免）；(3) 输出门禁决策日志 `[GATE] GATE_DESIGN | mode=story | policy={gate_policy} | decision={PAUSE|AUTO_CONTINUE} | reason={配置覆盖|story 模式默认豁免}`
- [x] T016 [P] [US5] 修改 `plugins/spec-driver/skills/speckit-fix/SKILL.md`——在 "Phase 2: 修复规划 [2/4]"（plan.md 生成后、tasks.md 生成前）插入 "Phase 2.5: 设计门禁 [GATE_DESIGN]" 章节。逻辑与 T015 相同——默认豁免，仅 gates.GATE_DESIGN.pause = "always" 时暂停。决策日志中 mode=fix

**Checkpoint**: Story/Fix 模式的设计门禁智能豁免就绪

---

## Phase 8: User Story 6 — 零配置开箱体验与高级自定义 (Priority: P2)

**Goal**: 确保未配置新字段时行为与升级前一致，init-project.sh 引导新增门禁策略选项

**Independent Test**: 在未修改配置的项目中升级后运行流程，验证行为无变化；添加 `gate_policy: strict` 后验证所有门禁暂停

**依赖**: T001-T002（配置结构）、T010-T013（门禁逻辑）

### 实现

- [x] T017 [US6] 修改 `plugins/spec-driver/scripts/init-project.sh`——在 `check_config()` 函数之后新增 `check_gate_policy()` 函数，检测现有配置中是否包含 gate_policy 字段。在 JSON 输出中新增 `HAS_GATE_POLICY` 字段。在文本输出中：如果缺少 gate_policy，输出提示信息"未配置门禁策略，使用默认值 balanced"。不修改现有配置文件（保持向后兼容），仅在新建配置时从模板复制包含 gate_policy 的版本
- [ ] T018 [US6] 审查 `plugins/spec-driver/skills/speckit-feature/SKILL.md`、`plugins/spec-driver/skills/speckit-story/SKILL.md`、`plugins/spec-driver/skills/speckit-fix/SKILL.md` 中的门禁配置加载逻辑（T010/T012/T013 产出），确认以下向后兼容行为：(1) gate_policy 未配置时默认 balanced；(2) gates 未配置时使用 gate_policy 对应的默认行为表；(3) 无法识别的门禁名称输出警告但不阻断（FR-021）；(4) 无法识别的 gate_policy 值输出警告并回退到 balanced

**Checkpoint**: 零配置向后兼容验证通过

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 一致性检查、文档更新、最终验证

- [ ] T019 [P] 审查 `plugins/spec-driver/agents/spec-review.md`（T003 产出）和 `plugins/spec-driver/agents/quality-review.md`（T004 产出）的 prompt 格式一致性——确保两者的输出格式均包含问题分级（CRITICAL/WARNING/INFO），且与 GATE_VERIFY 的决策逻辑（任一 CRITICAL 触发暂停）兼容
- [ ] T020 [P] 审查三个编排器 SKILL.md 中的进度编号映射表（speckit-feature 的"阶段→进度编号映射"表），确认新增的 GATE_DESIGN 阶段是否需要调整编号（Phase 2.5 共享 [5/10] 编号，不增加总阶段数）
- [ ] T021 运行 quickstart.md 验证——按照 `specs/017-adopt-superpowers-patterns/quickstart.md` 中的"开发顺序建议"和"核心概念"描述，逐项检查所有任务产出是否覆盖了 quickstart 中提到的每个概念（验证铁律、三级门禁策略、门禁级配置、设计硬门禁、双阶段审查）

---

## FR 覆盖映射表

| FR | 描述 | Task ID |
|----|------|---------|
| FR-001 | 实现子代理必须运行验证命令并将输出作为完成证据 | T005 |
| FR-002 | 拒绝不包含新鲜验证证据的推测性完成声明 | T005, T006 |
| FR-003 | 验证子代理二次核查验证证据 | T006 |
| FR-004 | 验证证据缺失时提供明确错误信息 | T006 |
| FR-005 | 验证阶段拆分为 Spec 合规审查 + 代码质量审查 | T003, T004, T007, T008, T009 |
| FR-006 | Spec 合规审查逐条检查 FR 实现状态 | T003 |
| FR-007 | 代码质量审查四维度评估 | T004 |
| FR-008 | 两项审查各自输出独立结构化报告（CRITICAL/WARNING/INFO） | T003, T004, T019 |
| FR-009 | 支持两项审查并行执行 | T007（注释说明 balanced/autonomous 模式建议并行） |
| FR-010 | 三级门禁策略 strict/balanced/autonomous | T001, T010, T011, T012, T013 |
| FR-011 | balanced 作为默认策略，向后兼容 | T001, T002, T010, T018 |
| FR-012 | 每个门禁独立配置，门禁级优先于全局策略 | T001, T010, T011 |
| FR-013 | 门禁决策格式化日志 | T011, T012, T013, T014, T015, T016 |
| FR-014 | spec.md 后设计门禁暂停点 | T014 |
| FR-015 | feature 模式设计门禁不受配置影响 | T014 |
| FR-016 | feature 模式设计门禁默认启用 | T014 |
| FR-017 | story/fix 模式设计门禁默认豁免 | T015, T016 |
| FR-018 | 用户可配置覆盖 story/fix 的设计门禁豁免 | T015, T016 |
| FR-019 | 配置向后兼容 | T001, T002, T017, T018 |
| FR-020 | 约定优于配置，单字段切换 | T001, T010 |
| FR-021 | 无法识别的配置字段/值输出警告不阻断 | T018 |
| FR-022 | 不引入新运行时依赖 | 全局约束（本特性全部为 Markdown/YAML/Shell 变更） |

**覆盖率**: 22/22 FR = 100%

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖——可立即开始
- **Phase 2 (Foundational)**: 无依赖——可与 Phase 1 并行（不同文件）
- **Phase 3 (US-1 验证铁律)**: 依赖 Phase 2（T003/T004 子代理文件需存在供 verify.md 引用）
- **Phase 4 (US-3 双阶段审查)**: 依赖 Phase 2（需要 spec-review.md 和 quality-review.md 存在）
- **Phase 5 (US-2 门禁粒度)**: 依赖 Phase 1（需要配置结构就绪）
- **Phase 6 (US-4 设计硬门禁)**: 依赖 Phase 5（T010-T011 门禁加载逻辑必须先就绪）
- **Phase 7 (US-5 模式差异化)**: 依赖 Phase 6（T014 GATE_DESIGN 逻辑模式已建立）
- **Phase 8 (US-6 零配置)**: 依赖 Phase 1 + Phase 5（配置和门禁逻辑就绪后审查兼容性）
- **Phase 9 (Polish)**: 依赖所有前序 Phase

### User Story Dependencies

- **US-1 (验证铁律)** 和 **US-3 (双阶段审查)**: 互相独立，可并行实现
- **US-2 (门禁粒度)**: 独立于 US-1/US-3，但 Phase 5 中修改的 SKILL.md 文件与 Phase 4 (US-3) 有部分重叠（speckit-feature SKILL.md），建议 US-3 先完成
- **US-4 (设计硬门禁)**: 依赖 US-2（门禁配置加载逻辑）
- **US-5 (模式差异化)**: 依赖 US-4（GATE_DESIGN 逻辑模式）
- **US-6 (零配置)**: 依赖 US-2（门禁逻辑就绪后验证兼容性）

### Story 内部并行机会

- Phase 1: T001 和 T002 操作不同文件，可并行
- Phase 2: T003 和 T004 操作不同文件，可并行
- Phase 4: T008 和 T009 操作不同文件，可并行（T007 需先完成以建立模式）
- Phase 5: T012 和 T013 操作不同文件，可并行（T010-T011 需先完成以建立模式）
- Phase 7: T015 和 T016 操作不同文件，可并行
- Phase 9: T019 和 T020 互相独立，可并行

### Recommended Execution Strategy

**推荐实施策略: 增量交付 (Incremental)**

1. Phase 1 + Phase 2 并行 → 配置和子代理基础就绪
2. Phase 3 (US-1) → 验证铁律独立可验证 → **第一个交付增量**
3. Phase 4 (US-3) → 双阶段审查集成 → **第二个交付增量**
4. Phase 5 (US-2) → 门禁策略可配置 → **第三个交付增量**
5. Phase 6 (US-4) + Phase 7 (US-5) 串行 → 设计硬门禁 + 模式差异化 → **第四个交付增量**
6. Phase 8 (US-6) + Phase 9 (Polish) → 兼容性验证和收尾 → **最终交付**

**MVP 范围**: Phase 1-6 (US-1 ~ US-4, 全部 P1)，共 14 个核心任务
**完整范围**: Phase 1-9 (US-1 ~ US-6 + Polish)，共 21 个任务

---

## Notes

- [P] 任务 = 不同文件、无依赖，可并行执行
- [USN] 标记映射任务到具体 User Story
- 所有变更限于 Markdown prompt + YAML 配置 + Shell 脚本，不涉及 TypeScript 代码
- 每个 Phase Checkpoint 后可独立验证该阶段产出
- 修改 SKILL.md 文件时需特别注意保持现有阶段编号和结构的连贯性
- 本特性为 MVP 第一批（Prompt 层），Hooks 层（PreToolUse/PostToolUse）作为后续独立特性交付
- hooks/ 目录内文件属于 MVP 第二批，本次不实现
- Edge Case "中途切换门禁策略"在 MVP 中不实现——配置在初始化时一次性加载，中途切换需重启流程
- GATE_ANALYSIS 在 balanced 模式下默认为 on_failure（CRITICAL 时暂停），保持与现有行为一致
