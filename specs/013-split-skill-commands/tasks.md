# Tasks: 拆分 Speckit Driver Pro 技能命令

**Input**: 设计文档来自 `specs/013-split-skill-commands/`
**Prerequisites**: plan.md (required), spec.md (required), research.md

**Organization**: 任务按 User Story 组织。本特性为纯 Markdown 文件重构，零代码变更、零新增依赖。所有操作均为 `plugins/speckit-driver-pro/skills/` 目录内的文件创建和删除。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（操作不同文件，无依赖）
- **[Story]**: 所属 User Story（如 US1, US2, US3）
- 每个任务包含确切文件路径

## Path Conventions

```text
plugins/speckit-driver-pro/
├── skills/
│   ├── run/SKILL.md         # [新建] 主编排技能 ~350 行
│   ├── resume/SKILL.md      # [新建] 中断恢复技能 ~150 行
│   ├── sync/SKILL.md        # [新建] 产品规范聚合技能 ~120 行
│   └── speckit-driver-pro/  # [删除] 旧单体技能 706 行
│       └── SKILL.md
├── agents/                  # [不变] 12 个子代理 prompt
├── hooks/                   # [不变] 生命周期钩子
├── scripts/                 # [不变] 初始化脚本
└── templates/               # [不变] 文档模板
```

---

## Phase 1: Setup（准备工作）

**Purpose**: 分析旧技能文件结构，创建新技能目录骨架

- [x] T001 分析 `plugins/speckit-driver-pro/skills/speckit-driver-pro/SKILL.md` 的内容结构，按 plan.md 的"内容归属映射"表标注各行范围归属（run/resume/sync），确认行号映射准确性
- [x] T002 创建三个新技能目录结构：`plugins/speckit-driver-pro/skills/run/`、`plugins/speckit-driver-pro/skills/resume/`、`plugins/speckit-driver-pro/skills/sync/`
- [x] T003 检查 Plugin 所有组件文件（`agents/`、`hooks/`、`scripts/`、`templates/`、`.claude-plugin/`）中是否存在对 `skills/speckit-driver-pro/` 路径的硬编码引用，记录检查结果

**Checkpoint**: 目录结构就绪，内容归属映射已确认，无意外路径依赖

---

## Phase 2: US1 — 独立执行产品规范聚合 (Priority: P1) — MVP

**Goal**: 创建 sync/SKILL.md，使 `/speckit-driver-pro:sync` 可独立完成产品规范聚合流程

**Independent Test**: 在 Claude Code 中输入 `/speckit-driver-pro:sync`，验证规范聚合流程（扫描 specs/ -> 合并 -> 生成 current-spec.md）可独立完成

### Implementation for US1

- [x] T004 [US1] 编写 `plugins/speckit-driver-pro/skills/sync/SKILL.md` 的 frontmatter 配置块：`name: sync`、`description: "聚合功能规范为产品级活文档 -- 将 specs/ 下的增量 spec 合并为 current-spec.md"`、`disable-model-invocation: false`
- [x] T005 [US1] 从旧 SKILL.md（L493-L577）提取产品规范聚合模式的完整 3 步流程（扫描 -> 聚合 -> 报告），写入 `plugins/speckit-driver-pro/skills/sync/SKILL.md` 的主体内容
- [x] T006 [US1] 在 sync/SKILL.md 中添加 specs/ 目录为空或不存在时的错误提示逻辑（给出明确提示而非静默失败）
- [x] T007 [US1] 在 sync/SKILL.md 中添加 sync 专用的触发方式段落（仅包含 `/speckit-driver-pro:sync`，不含 run/resume 相关命令）
- [x] T008 [US1] 验证 sync/SKILL.md 中所有模板路径引用（如 `plugins/speckit-driver-pro/templates/product-spec-template.md`、`plugins/speckit-driver-pro/agents/sync.md`）与拆分前一致
- [x] T009 [US1] 验证 sync/SKILL.md 总行数控制在 ~120 行（NFR-001），且不包含任何编排流程、初始化或恢复逻辑（FR-010 自包含验证）

**Checkpoint**: `/speckit-driver-pro:sync` 可独立执行产品规范聚合，验证拆分方案可行性

---

## Phase 3: US2 — 通过独立命令启动完整研发流程 (Priority: P1)

**Goal**: 创建 run/SKILL.md，使 `/speckit-driver-pro:run` 可执行完整的 10 阶段编排流程

**Independent Test**: 在 Claude Code 中输入 `/speckit-driver-pro:run <需求描述>`，验证 10 阶段编排流程可完整执行

### Implementation for US2

- [x] T010 [US2] 编写 `plugins/speckit-driver-pro/skills/run/SKILL.md` 的 frontmatter 配置块：`name: run`、`description: "执行 Spec-Driven Development 完整研发流程（10 阶段编排：调研-规范-规划-实现-验证）"`、`disable-model-invocation: true`
- [x] T011 [US2] 编写 run/SKILL.md 的触发方式段落，仅包含 run 相关命令：`/speckit-driver-pro:run <需求描述>`、`/speckit-driver-pro:run --rerun <phase>`、`/speckit-driver-pro:run --preset <name>`，不含 `--resume` 和 `--sync`
- [x] T012 [US2] 编写 run/SKILL.md 的输入解析段落，包含需求描述、`--rerun <phase>` 和 `--preset <name>` 参数解析，移除 `--resume` 和 `--sync` 参数
- [x] T013 [US2] 从旧 SKILL.md（L36-L97）提取完整的初始化阶段（含环境检查、Constitution 处理、配置加载、prompt 来源映射、特性目录准备全部 5 步），写入 run/SKILL.md
- [x] T014 [US2] 从旧 SKILL.md（L99-L457）提取完整的 10 阶段编排工作流定义（Phase 0 - Phase 7，含质量门 1-4），写入 run/SKILL.md
- [x] T015 [US2] 从旧 SKILL.md（L458-L491）提取完成报告模板段落，写入 run/SKILL.md
- [x] T016 [US2] 从旧 SKILL.md（L580-L609）提取子代理失败重试机制段落，写入 run/SKILL.md
- [x] T017 [US2] 从旧 SKILL.md（L642-L663）提取选择性重跑机制（`--rerun <phase>`）段落，写入 run/SKILL.md
- [x] T018 [US2] 从旧 SKILL.md（L666-L706）提取完整的模型选择逻辑（含 preset 决策表）和阶段进度编号映射段落，写入 run/SKILL.md
- [x] T019 [US2] 验证 run/SKILL.md 中所有子代理 prompt 路径引用（如 `plugins/speckit-driver-pro/agents/{phase}.md`）、模板路径引用、脚本路径引用（如 `plugins/speckit-driver-pro/scripts/init-project.sh`）与拆分前一致
- [x] T020 [US2] 验证 run/SKILL.md 总行数控制在 ~350 行（NFR-001），且不包含中断恢复机制或产品规范聚合模式（FR-010 自包含验证）

**Checkpoint**: `/speckit-driver-pro:run` 可执行完整的 10 阶段编排流程，功能与拆分前等价

---

## Phase 4: US3 — 通过独立命令恢复中断的研发流程 (Priority: P1)

**Goal**: 创建 resume/SKILL.md，使 `/speckit-driver-pro:resume` 可扫描已有制品并从断点恢复执行

**Independent Test**: 在某功能编排流程中断后，输入 `/speckit-driver-pro:resume`，验证可从断点继续执行

### Implementation for US3

- [x] T021 [US3] 编写 `plugins/speckit-driver-pro/skills/resume/SKILL.md` 的 frontmatter 配置块：`name: resume`、`description: "恢复中断的 Speckit 研发流程 -- 扫描已有制品并从断点继续编排"`、`disable-model-invocation: true`
- [x] T022 [US3] 编写 resume/SKILL.md 的触发方式段落，仅包含 resume 相关命令：`/speckit-driver-pro:resume`、`/speckit-driver-pro:resume --preset <name>`
- [x] T023 [US3] 从旧 SKILL.md（L36-L88）提取精简的初始化逻辑（环境检查 + Constitution 处理 + 配置加载 + prompt 来源映射，共 4 步），写入 resume/SKILL.md。注意：不包含"特性目录准备"步骤（L90-L97）
- [x] T024 [US3] 从旧 SKILL.md（L610-L638）提取完整的中断恢复机制（制品扫描、恢复点确定、恢复执行流程），写入 resume/SKILL.md
- [x] T025 [US3] 在 resume/SKILL.md 中添加模型选择的配置加载部分（仅读取 spec-driver.config.yaml 中的模型配置），不复制 run 中的完整 preset 决策表
- [x] T026 [US3] 在 resume/SKILL.md 中添加无可恢复制品时的错误提示逻辑（检测到无制品时，给出明确提示并建议使用 `/speckit-driver-pro:run` 启动新流程）
- [x] T027 [US3] 验证 resume/SKILL.md 中所有路径引用（子代理 prompt、脚本、配置模板）与拆分前一致
- [x] T028 [US3] 验证 resume/SKILL.md 总行数控制在 ~150 行（NFR-001），且不包含选择性重跑逻辑、产品规范聚合模式或特性目录准备步骤（FR-005、FR-010 自包含验证）

**Checkpoint**: `/speckit-driver-pro:resume` 可从断点恢复执行，功能与拆分前的 `--resume` 参数等价

---

## Phase 5: US5 + US4 — 迁移闭环与功能可发现性验证 (Priority: P1)

**Goal**: 通过 Strangler Fig 模式验证新技能，删除旧技能目录，验证命令可发现性

**Independent Test**: `/speckit-driver-pro:` 补全菜单仅显示 run、resume、sync 三个命令，旧命令不再可用

### Strangler Fig 验证（共存期）

- [x] T029 [US4] 验证 Strangler Fig 共存期：确认 `/speckit-driver-pro:` 补全菜单同时显示四个技能（run、resume、sync 和旧的 speckit-driver-pro），每个新技能的 description 正确显示
- [x] T030 [US4] 逐一验证三个新技能的功能正确性：sync 可执行聚合、run 可启动编排流程、resume 可恢复中断流程

### 删除旧技能目录

- [x] T031 [US5] 再次检查 Plugin 所有组件文件（`agents/`、`hooks/hooks.json`、`scripts/init-project.sh`、`scripts/postinstall.sh`、`templates/`、`.claude-plugin/plugin.json`、`README.md`、`spec-driver.config.yaml`）中无对 `skills/speckit-driver-pro/` 的引用
- [x] T032 [US5] 删除旧技能目录 `plugins/speckit-driver-pro/skills/speckit-driver-pro/`（含其下的 SKILL.md）
- [x] T033 [US5] 验证删除后 `agents/`、`hooks/`、`scripts/`、`templates/`、`.claude-plugin/` 目录及其内容不受影响

### 最终验证

- [x] T034 [US4] 验证 `/speckit-driver-pro:` 补全菜单仅显示 run、resume、sync 三个命令，旧的 `/speckit-driver-pro:speckit-driver-pro` 不再可用
- [x] T035 [US4] 验证三个命令的 description 在补全菜单中各自独立显示且语义清晰

**Checkpoint**: 迁移完成，新旧命令无共存，Plugin 整体功能正常

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 文档更新、最终质量检查

- [x] T036 [P] 更新 `plugins/speckit-driver-pro/README.md`，反映新的三技能架构（run/resume/sync），说明迁移路径
- [x] T037 [P] 检查三个新 SKILL.md 中的 Markdown 格式、标题层级、列表缩进是否一致
- [x] T038 验证三个技能在同一 Claude Code 会话中连续调用时各自独立加载（Edge Case: 上下文残留检查）
- [x] T039 运行 `specs/013-split-skill-commands/quickstart.md` 验证，确保文档中的操作步骤与实际实现一致

---

## FR 覆盖映射表

| FR | 描述 | 覆盖任务 |
|----|------|---------|
| FR-001 | 创建 run/SKILL.md，包含完整编排逻辑 | T010, T011, T012, T013, T014, T015, T016, T017, T018 |
| FR-002 | 创建 resume/SKILL.md，包含精简初始化和恢复机制 | T021, T022, T023, T024, T025, T026 |
| FR-003 | 创建 sync/SKILL.md，包含产品规范聚合流程 | T004, T005, T006, T007 |
| FR-004 | 每个 SKILL.md 配置正确的 frontmatter | T004, T010, T021 |
| FR-005 | --rerun 归属 run，resume 不含重跑 | T012, T017, T028 |
| FR-006 | resume 无制品时给出明确提示 | T026 |
| FR-007 | sync 空目录时给出明确提示 | T006 |
| FR-008 | 删除旧技能目录 | T032 |
| FR-009 | 删除不影响其他组件 | T031, T033 |
| FR-010 | 三个技能各自自包含 | T009, T020, T028 |
| FR-011 | 路径引用与拆分前一致 | T008, T019, T027 |
| FR-012 | Strangler Fig 迁移模式 | T029, T030 |
| FR-013 | sync description 使用具体技术术语 | T004 |

**NFR 覆盖**:

| NFR | 描述 | 覆盖任务 |
|-----|------|---------|
| NFR-001 | SKILL.md 行数控制 200-350 行 | T009, T020, T028 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖，可立即开始
- **Phase 2 (US1-sync)**: 依赖 Phase 1 完成（目录结构就绪）
- **Phase 3 (US2-run)**: 依赖 Phase 1 完成（目录结构就绪）
- **Phase 4 (US3-resume)**: 依赖 Phase 1 完成（目录结构就绪）
- **Phase 5 (US5+US4-迁移闭环)**: 依赖 Phase 2、3、4 全部完成（三个技能就绪后才能验证和删除旧技能）
- **Phase 6 (Polish)**: 依赖 Phase 5 完成（迁移闭环后才能做最终文档和验证）

### User Story Dependencies

- **US1 (sync)、US2 (run)、US3 (resume)**: 三者可并行实现（操作不同文件，无依赖）
- **US4 (可发现性)**: 依赖 US1+US2+US3 全部完成
- **US5 (删除旧技能)**: 依赖 US4 验证通过

### 每个 User Story 内部

- Frontmatter 编写 -> 主体内容提取 -> 边界条件处理 -> 路径引用验证 -> 行数/自包含验证
- 严格串行：每步依赖前一步的输出

### Parallel Opportunities

- **Phase 2、3、4 可并行**：sync/run/resume 三个技能操作不同文件，无交叉依赖
- **Phase 1 内部**: T002（创建目录）和 T003（检查引用）可并行
- **Phase 6 内部**: T036 和 T037 可并行

```text
Phase 1 (Setup)
    │
    ├──────────┬──────────┐
    ▼          ▼          ▼
Phase 2    Phase 3    Phase 4
(sync)     (run)      (resume)
    │          │          │
    └──────────┴──────────┘
               │
               ▼
         Phase 5 (验证+删除)
               │
               ▼
         Phase 6 (Polish)
```

---

## Implementation Strategy

### MVP First（推荐）

1. 完成 Phase 1: Setup
2. 完成 Phase 2: US1 (sync) -- sync 最轻量，验证拆分可行性最快
3. **STOP and VALIDATE**: 验证 `/speckit-driver-pro:sync` 独立可用
4. 继续 Phase 3 + Phase 4: 并行完成 run 和 resume
5. 完成 Phase 5: 验证 + 删除旧技能
6. 完成 Phase 6: Polish

### Incremental Delivery

1. Setup -> sync 就绪 -> 验证 sync 独立可用（MVP!）
2. 添加 run -> 验证 run 独立可用
3. 添加 resume -> 验证 resume 独立可用
4. Strangler Fig 验证 -> 删除旧技能 -> 最终验证
5. 每个 Story 增量交付，不破坏已有 Story

---

## Summary

| 指标 | 值 |
|------|---|
| 总任务数 | 39 |
| User Story 覆盖 | 5/5 (US1-US5) |
| FR 覆盖 | 13/13 (100%) |
| NFR 覆盖 | 1/1 (100%) |
| 可并行率 | 54%（Phase 2/3/4 全部可并行，Phase 6 内部部分可并行） |
| 变更文件数 | 5（3 个新建 SKILL.md + 1 个删除旧目录 + 1 个 README 更新） |
| 代码变更 | 0 行（纯 Markdown 文件重构） |

---

## Notes

- [P] 任务 = 操作不同文件，无依赖
- [USN] 标记将任务映射到具体 User Story，支持追踪
- 每个 User Story 可独立完成和测试
- 本特性为纯 Markdown 文件重构，无编译、测试、部署步骤
- 完成每个任务后建议 commit，保留回滚点
- 在 Phase 5 的 Strangler Fig 共存期间，旧技能仍可用作回滚后备
