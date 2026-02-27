# Tasks: Feature 模式灵活调研路由

**Input**: Design documents from `/specs/018-flexible-research-routing/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md

**Tests**: 本特性为纯 Prompt 工程项目（修改 Markdown 和 YAML 文件），无单元测试。验收标准侧重"运行模式时行为是否正确"。

**Organization**: 任务按 User Story 分组，支持独立实现和测试。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1, US2, US3, US4, US5）
- 包含精确文件路径

## Path Conventions

本特性修改 4 个现有文件，不新增文件：

```text
plugins/spec-driver/
├── skills/speckit-feature/
│   └── SKILL.md                          # 主编排器
├── agents/
│   └── tech-research.md                  # 技术调研子代理
└── templates/
    └── driver-config-template.yaml       # 配置模板

driver-config.yaml                         # 项目实例配置
```

---

## Phase 1: Setup（配置基础设施）

**Purpose**: 为调研模式路由提供配置支撑，不改变任何运行时行为

- [x] T001 [P] 在 `plugins/spec-driver/templates/driver-config-template.yaml` 的 `agents:` 段之后、`verification:` 段之前新增 `research:` 配置段，包含 `default_mode: auto` 和 `custom_steps: []` 字段及完整注释说明（~15 行）
  - **文件**: `plugins/spec-driver/templates/driver-config-template.yaml`
  - **验收**: 配置模板中存在 `research:` 顶级段，`default_mode` 默认值为 `auto`，注释列出所有有效模式值（auto, full, tech-only, product-only, codebase-scan, skip, custom）
  - **复杂度**: 低

- [x] T002 [P] 在 `driver-config.yaml` 的 `agents:` 段之后、`verification:` 段之前同步新增 `research:` 配置段（`default_mode: auto`、`custom_steps: []`）
  - **文件**: `driver-config.yaml`
  - **验收**: 项目实例配置中存在 `research:` 段，字段与模板一致
  - **复杂度**: 低

**Checkpoint**: 配置基础设施就绪，现有流程行为不受影响。

---

## Phase 2: Foundational（阻塞性前置依赖）

**Purpose**: 解除 tech-research 子代理对 product-research.md 的硬依赖——所有非 `full` 模式的 Story 都依赖此变更

**CRITICAL**: US1 和 US2 中的 `tech-only`、`custom` 模式均依赖此阶段完成

- [x] T003 修改 `plugins/spec-driver/agents/tech-research.md` 角色描述，将"负责基于产品调研结论执行"改为"负责基于产品调研结论（如有）或需求描述执行"
  - **文件**: `plugins/spec-driver/agents/tech-research.md`
  - **变更位置**: 第 5 行角色描述
  - **验收**: 角色描述中不再硬性要求产品调研结论存在
  - **复杂度**: 低

- [x] T004 修改 `plugins/spec-driver/agents/tech-research.md` 输入定义，将 product-research.md 从"必须"改为"如存在则读取，不存在则基于需求描述执行"
  - **文件**: `plugins/spec-driver/agents/tech-research.md`
  - **变更位置**: 第 10 行输入列表
  - **验收**: 输入定义明确标注 product-research.md 为可选输入
  - **复杂度**: 低

- [x] T005 修改 `plugins/spec-driver/agents/tech-research.md` 执行流程第 1 步，增加条件分支：有 product-research.md 则读取提取产品方向，无则基于需求描述和代码上下文提取核心技术问题
  - **文件**: `plugins/spec-driver/agents/tech-research.md`
  - **变更位置**: 第 22-25 行（"理解产品方向"步骤）
  - **验收**: 步骤标题改为"理解产品方向 / 需求上下文"，包含明确的 if/else 分支逻辑
  - **复杂度**: 中

- [x] T006 修改 `plugins/spec-driver/agents/tech-research.md` 约束段，将"必须基于产品调研结论"改为"基于产品调研结论（如有）或需求描述"
  - **文件**: `plugins/spec-driver/agents/tech-research.md`
  - **变更位置**: 第 74 行约束列表
  - **验收**: 约束文本不再强制要求产品调研前置
  - **复杂度**: 低

- [x] T007 修改 `plugins/spec-driver/agents/tech-research.md` 失败处理段，将"product-research.md 不存在 → 返回失败"改为"进入独立模式"降级策略
  - **文件**: `plugins/spec-driver/agents/tech-research.md`
  - **变更位置**: 第 88 行失败处理
  - **验收**: 失败处理明确说明无 product-research.md 时进入独立模式，基于需求描述执行，报告中标注"[独立模式]"
  - **复杂度**: 低

**Checkpoint**: tech-research 子代理可在无 product-research.md 时独立运行，为 `tech-only`/`custom` 模式提供支撑。

---

## Phase 3: User Story 2 — 调研模式预设与执行 (Priority: P1)

**Goal**: 在 SKILL.md 编排器中实现 6 种调研模式的条件路由，使每种模式执行且仅执行该模式定义的调研步骤

**Independent Test**: 分别以 `full`、`tech-only`、`product-only`、`codebase-scan`、`skip` 模式执行 Feature 流程，验证每种模式执行了且仅执行了对应的调研步骤，后续阶段正常运行

> **注**: US2 排在 US1 之前实现，因为模式预设是推荐机制的基础——先有模式定义和条件路由，才能实现智能推荐。

### Implementation for User Story 2

- [x] T008 [US2] 在 SKILL.md "Phase 1a: 产品调研" 之前新增 "调研模式确定（Phase 0.5）" 段落框架，定义确定优先级描述（CLI > Config > 推荐），暂不实现推荐逻辑（留给 US1），硬编码默认为 `full`
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 0 和 Phase 1a 之间（约第 136 行之后）
  - **验收**: 存在"调研模式确定"段落，描述了三层优先级，默认值为 `full`
  - **复杂度**: 中

- [x] T009 [US2] 重构 SKILL.md 的 Phase 1a/1b/1c 为条件执行逻辑，根据 `research_mode` 变量决定执行哪些调研步骤，定义 6 种模式到步骤的映射表
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 1a (第 137-142 行)、Phase 1b (第 145-149 行)、Phase 1c (第 153-168 行) 整体重构
  - **验收**: 存在模式-步骤映射表（`full` → [1a,1b,1c]、`tech-only` → [1b]、`product-only` → [1a]、`codebase-scan` → [scan]、`skip` → []、`custom` → [config 中指定]），未命中的步骤输出 "[已跳过]" 标注
  - **复杂度**: 高

- [x] T010 [US2] 在 SKILL.md 中新增 `codebase-scan` 步骤定义，复用 Story 模式的代码库上下文扫描逻辑（读取 README.md/CLAUDE.md、Grep/Glob 扫描、汇总为上下文摘要字符串，不写入磁盘）
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 1a-1c 条件执行逻辑之后
  - **验收**: `codebase-scan` 步骤描述完整，明确说明不调用子代理、不写入磁盘、通过上下文注入传递结果
  - **复杂度**: 中

- [x] T011 [US2] 重构 SKILL.md 的 GATE_RESEARCH 为模式感知的分级门禁：`full` 展示 synthesis 摘要（现有行为）、`tech-only`/`product-only` 展示单份报告摘要、`codebase-scan` 展示扫描摘要、`skip` 跳过门禁、`custom` 展示实际制品摘要
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 1c 质量门 1（GATE_RESEARCH）段落（约第 159-168 行）
  - **验收**: GATE_RESEARCH 逻辑包含对 6 种模式的条件分支，`skip` 模式明确跳过门禁，非 `full` 模式提供"切换到 full 模式"选项
  - **复杂度**: 高

- [x] T012 [US2] 修改 SKILL.md 的 Phase 2（需求规范）和 Phase 4（技术规划）的上下文注入块，根据 `research_mode` 动态调整注入的调研制品路径，追加模式提示
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 2（第 172-176 行）和 Phase 4（第 216-220 行）
  - **验收**: specify 和 plan 阶段的上下文注入包含 research_mode 条件分支，6 种模式各有对应的注入内容；无 research-synthesis.md 时传入实际可用制品路径或"调研模式: skip"标记
  - **复杂度**: 中

- [x] T013 [US2] 修改 SKILL.md 的"阶段→进度编号映射"表和进度输出逻辑，实现固定分母（10）+ 跳过标注策略（被跳过步骤显示 "[已跳过 - 调研模式: {mode}]"）
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: 阶段→进度编号映射段落（约第 396-409 行）
  - **验收**: 进度编号映射表追加了跳过标注说明；不同模式下分母固定为 10，跳过步骤的编号保留但附加 "[已跳过]" 标注
  - **复杂度**: 低

- [x] T014 [US2] 修改 SKILL.md 的完成报告段，根据 `research_mode` 动态调整"生成的制品"列表，未执行的调研步骤对应制品标注为 "[已跳过]"
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: 完成报告段落（约第 297-328 行）
  - **验收**: 完成报告中的制品列表包含 research_mode 条件分支，`skip` 模式下调研制品全部标注 "[已跳过]"，`tech-only` 模式下仅 tech-research.md 标注为生成
  - **复杂度**: 中

**Checkpoint**: 6 种调研模式的条件路由、门禁适配、上下文注入和进度显示全部就绪。`full` 模式行为与当前版本 100% 一致（向后兼容）。

---

## Phase 4: User Story 1 — 编排器智能推荐调研模式 (Priority: P1)

**Goal**: 编排器基于需求描述文本特征推荐最合适的调研模式，用户一键确认或选择替代

**Independent Test**: 分别输入"开发一个面向企业的 SaaS 定价模块"、"将项目从 CommonJS 迁移到 ESM"、"给 CLI 增加 --verbose 参数"，验证推荐结果分别为 `full`、`tech-only`、`codebase-scan`/`skip`

### Implementation for User Story 1

- [x] T015 [US1] 在 SKILL.md "调研模式确定（Phase 0.5）" 段落中实现智能推荐逻辑：定义关键词-模式映射规则（full: 产品信号 >= 2 个、tech-only: 技术信号 >= 1 且无产品信号、product-only: 市场信号且无技术信号、codebase-scan: 短描述+增量功能、skip: 极短描述+trivial 变更、默认 full）
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 0.5 "调研模式确定" 段落中的智能推荐部分
  - **验收**: 推荐逻辑包含完整的关键词列表和启发式规则，覆盖 spec.md FR-003 中列出的所有信号类型（新产品方向、技术选型/迁移、小型增量功能、市场验证），无法判断时回退到 `full`
  - **复杂度**: 高

- [x] T016 [US1] 在 SKILL.md "调研模式确定（Phase 0.5）" 段落中实现交互展示格式：输出推荐模式+推荐理由+完整可选模式列表（1-6 编号），等待用户确认或选择替代
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 0.5 "调研模式确定" 段落中的交互展示部分
  - **验收**: 交互格式包含推荐模式名、推荐理由文本、6 种模式的编号列表（含一行说明），支持直接回车确认推荐模式
  - **复杂度**: 中

**Checkpoint**: 智能推荐引擎就绪，用户可在交互中确认或覆盖推荐模式。

---

## Phase 5: User Story 3 — 配置文件支持调研模式默认值 (Priority: P2)

**Goal**: 团队可在 driver-config.yaml 中配置默认调研模式，统一调研策略

**Independent Test**: 在 driver-config.yaml 中设置 `research.default_mode: tech-only`，执行 Feature 模式，验证编排器推荐的默认模式为 `tech-only` 而非智能推荐结果

### Implementation for User Story 3

- [x] T017 [US3] 在 SKILL.md "调研模式确定（Phase 0.5）" 段落中实现配置文件读取逻辑：从已加载的 driver-config.yaml 中读取 `research.default_mode`，当值为非 `auto` 的有效模式时作为默认模式（优先于智能推荐但低于 CLI 参数）
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 0.5 "调研模式确定" 段落中的配置优先级部分
  - **验收**: 配置读取逻辑正确处理三种情况——(1) 有效非 auto 值：使用配置值 (2) `auto` 或未配置：回退到智能推荐 (3) 无效值：输出警告并回退到 `auto`，警告文本包含有效值列表
  - **复杂度**: 中

- [x] T018 [US3] 在 SKILL.md "初始化阶段 > 3. 配置加载" 中补充对 `research` 配置段的解析说明，确保向后兼容（配置段不存在时默认 `auto`）
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: 初始化阶段第 3 步（约第 47-49 行）
  - **验收**: 配置加载逻辑明确说明 `research` 段为可选，不存在时默认 `{default_mode: "auto", custom_steps: []}`
  - **复杂度**: 低

**Checkpoint**: 配置默认值生效，未配置 `research` 段时行为与升级前完全一致。

---

## Phase 6: User Story 4 — 命令行参数覆盖调研模式 (Priority: P2)

**Goal**: 开发者可通过 `--research <mode>` 直接指定调研模式，跳过推荐和交互

**Independent Test**: 执行 `/spec-driver:speckit-feature --research skip "给 CLI 增加 --verbose 参数"`，验证直接跳过调研，无推荐和选择交互

### Implementation for User Story 4

- [x] T019 [US4] 在 SKILL.md "输入解析" 表格中新增 `--research <mode>` 参数行，在"解析规则"中追加无效模式名的错误处理逻辑
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: 输入解析表格（约第 23-28 行）和解析规则（约第 29 行）
  - **验收**: 输入解析表格包含 `--research <mode>` 行，说明字段列出有效模式值；解析规则说明无效值时输出错误提示并回退到推荐交互
  - **复杂度**: 低

- [x] T020 [US4] 在 SKILL.md "调研模式确定（Phase 0.5）" 段落中实现 CLI 参数最高优先级逻辑：当 `--research` 参数存在且值有效时，直接使用该模式，跳过配置读取和智能推荐，不展示交互选择
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 0.5 "调研模式确定" 段落顶部
  - **验收**: CLI 参数优先级最高，有效值时直接确定模式无需交互；无效值时输出错误提示（含有效值列表）并回退到推荐交互
  - **复杂度**: 中

- [x] T021 [US4] 修改 SKILL.md "触发方式" 段落，新增 `--research <mode>` 参数示例
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: 触发方式代码块（约第 13-17 行）
  - **验收**: 触发方式示例中包含 `--research` 参数用法
  - **复杂度**: 低

**Checkpoint**: 三层模式确定机制完整（CLI > Config > 推荐），命令行可直接指定模式实现全自动化执行。

---

## Phase 7: User Story 5 — 自定义调研步骤组合 (Priority: P3)

**Goal**: 高级用户可通过 `custom` 模式自定义调研步骤组合

**Independent Test**: 在 driver-config.yaml 中配置 `research.default_mode: custom` + `research.custom_steps: [product-research, codebase-scan]`，执行 Feature 模式，验证仅执行产品调研和代码扫描

### Implementation for User Story 5

- [x] T022 [US5] 在 SKILL.md "调研模式确定（Phase 0.5）" 的模式-步骤映射表中完善 `custom` 模式逻辑：从 `config.research.custom_steps` 读取步骤列表，映射到对应的 Phase，处理空列表或无效步骤名的警告和回退
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 0.5 模式-步骤映射表中的 `custom` 条目
  - **验收**: `custom` 模式从配置读取步骤列表，支持 4 种有效步骤（product-research, tech-research, codebase-scan, synthesis），无效步骤名输出警告并忽略，空列表回退到 `full`
  - **复杂度**: 中

- [x] T023 [US5] 在 SKILL.md 条件执行逻辑中完善 `custom` 模式下 `synthesis` 步骤的依赖检查：当 custom_steps 包含 `synthesis` 但缺少 product-research 和 tech-research 输出时，输出警告并跳过 synthesis
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 1c 条件执行逻辑
  - **验收**: `synthesis` 步骤在缺少前置制品时优雅降级——输出警告、跳过步骤、不报错中断
  - **复杂度**: 中

**Checkpoint**: `custom` 模式支持完整的自定义步骤组合，包含边界情况处理。

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 跨 Story 的适配、安全记录和 `--rerun` 兼容

- [x] T024 修改 SKILL.md "选择性重跑机制" 段落，使 `--rerun research` 重新进入调研模式选择流程（Phase 0.5），而非直接重跑上次模式
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: 选择性重跑机制段落（约第 362-371 行）
  - **验收**: `--rerun research` 触发时重新进入 Phase 0.5 模式确定流程，用户可选择不同的调研模式
  - **复杂度**: 低

- [x] T025 在 SKILL.md 中补充调研跳过决策记录逻辑：当 `research_mode` 为 `skip` 时，在 spec.md 头部元数据中记录 `research_mode: skip` 和 `research_skip_reason: {原因}`
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 0.5 模式确定完成后、Phase 2 需求规范之前
  - **验收**: `skip` 模式下 spec.md 头部包含决策记录字段，记录跳过原因（用户选择/命令行参数/配置默认）
  - **复杂度**: 低

- [x] T026 在 SKILL.md 中确认 GATE_DESIGN 在所有调研模式下保持启用，补充显式说明"GATE_DESIGN 不因调研模式变化而受影响"
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **变更位置**: Phase 3.5 设计门禁段落（约第 190-212 行）
  - **验收**: GATE_DESIGN 段落包含显式说明，确认其在所有调研模式下保持硬门禁行为
  - **复杂度**: 低

- [x] T027 整体校对 SKILL.md 修改后的一致性：检查所有进度编号引用、制品路径引用、模式名拼写，确保无遗漏和矛盾
  - **文件**: `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - **验收**: 全文无断裂的进度编号引用，所有 6 种模式名拼写一致（`full`, `tech-only`, `product-only`, `codebase-scan`, `skip`, `custom`），无相互矛盾的逻辑
  - **复杂度**: 中

- [x] T028 整体校对 tech-research.md 修改后的一致性：确认独立模式下执行流程第 6 步"产品-技术对齐度评估"自然降级为"需求-技术对齐度评估"
  - **文件**: `plugins/spec-driver/agents/tech-research.md`
  - **验收**: 第 6 步在无产品调研时的行为有明确描述或可从上下文合理推导
  - **复杂度**: 低

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|----------|
| FR-001 | 6 种调研模式定义 | T009 |
| FR-002 | 每种模式的输出制品集合 | T009, T014 |
| FR-003 | 智能推荐逻辑 | T015 |
| FR-004 | 推荐展示与交互确认 | T016 |
| FR-005 | 向后兼容（无 research 配置段时默认 full） | T018, T001, T002 |
| FR-006 | driver-config.yaml 新增 research 配置段 | T001, T002, T017 |
| FR-007 | 后续阶段上下文注入适配 | T012 |
| FR-008 | tech-research 软依赖降级 | T003, T004, T005, T006, T007 |
| FR-009 | GATE_RESEARCH 模式感知分级门禁 | T011 |
| FR-010 | 进度显示跳过标注 | T013 |
| FR-011 | `--research <mode>` 命令行参数 | T019, T020, T021 |
| FR-012 | 调研跳过决策记录 | T025 |
| FR-013 | GATE_DESIGN 在所有模式下保持启用 | T026 |
| FR-014 | 完成报告动态适配 | T014 |
| FR-015 | `--rerun research` 重新进入模式选择 | T024 |

**FR 覆盖率**: 15/15 = 100%

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1 (Setup)**: 无依赖，可立即开始。T001 和 T002 可并行
- **Phase 2 (Foundational)**: 无依赖，可与 Phase 1 并行。T003-T007 修改同一文件需串行
- **Phase 3 (US2)**: 依赖 Phase 2 完成（`tech-only` 模式需要 tech-research 软依赖降级）
- **Phase 4 (US1)**: 依赖 Phase 3 中的 T008（模式确定框架）
- **Phase 5 (US3)**: 依赖 Phase 1（配置段存在）和 Phase 4 中的 T015/T016（推荐逻辑存在）
- **Phase 6 (US4)**: 依赖 Phase 3 中的 T008（模式确定框架）
- **Phase 7 (US5)**: 依赖 Phase 3 中的 T009（模式-步骤映射表）和 Phase 1（custom_steps 配置）
- **Phase 8 (Polish)**: 依赖所有 User Story Phase 完成

### User Story 间依赖

- **US2 (模式预设与执行)** → 基础，无依赖（除 Phase 2 Foundational）
- **US1 (智能推荐)** → 依赖 US2 的模式确定框架
- **US3 (配置默认值)** → 依赖 Phase 1 Setup + US1 推荐逻辑
- **US4 (命令行参数)** → 依赖 US2 的模式确定框架
- **US5 (自定义步骤)** → 依赖 US2 的模式-步骤映射表

### Story 内部并行机会

- **Phase 1**: T001 和 T002 可并行（不同文件）
- **Phase 3 (US2)**: T013 和 T014 可在 T009 完成后并行（修改 SKILL.md 不同段落）
- **Phase 4-6**: US1(T015-T016)、US4(T019-T021) 可在 T008 完成后并行
- **Phase 7 (US5)**: T022 和 T023 需串行（T023 依赖 T022 的 custom 模式逻辑）
- **Phase 8**: T024-T026 可并行（修改 SKILL.md 不同段落），T027/T028 需在所有修改完成后执行

### 推荐实现策略

**Incremental Delivery（推荐）**:

1. Phase 1 (Setup) + Phase 2 (Foundational) → 配置就绪 + tech-research 降级就绪
2. Phase 3 (US2) → 6 种模式条件路由就绪 → 可手动测试各模式
3. Phase 4 (US1) → 智能推荐就绪 → 核心体验完整
4. Phase 5 (US3) + Phase 6 (US4) → 配置和 CLI 覆盖就绪 → Power user 体验完整
5. Phase 7 (US5) → 自定义模式就绪 → 长尾需求覆盖
6. Phase 8 (Polish) → 一致性校对、决策记录、rerun 适配 → 交付质量达标

**MVP 范围**: Phase 1 + Phase 2 + Phase 3 (US2) — 完成后即可使用 6 种模式（手动在 Phase 0.5 中指定），但缺少推荐和 CLI 覆盖。

---

## Notes

- [P] 任务 = 不同文件或同文件不同段落，无依赖
- [USN] 标记映射到 spec.md 中的 User Story 编号
- 每个 User Story 完成后应可独立验证
- 本特性为纯 Prompt 工程项目，验收通过手动端到端测试
- 所有变更仅涉及 4 个文件，不新增文件
- SKILL.md 预估从 ~410 行增加到 ~530 行（增加 ~120 行），仍在合理范围内
- 优先确保 `full` 模式行为与当前版本 100% 一致（向后兼容基线）
