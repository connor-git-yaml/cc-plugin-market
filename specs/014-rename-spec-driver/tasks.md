# Tasks: Spec-Driver 重命名 v3.0.0

**Input**: Design documents from `specs/014-rename-spec-driver/`
**Prerequisites**: plan.md (required), spec.md (required)

**Tests**: 本特性无单元测试。验证通过全文搜索（grep）确认零残留匹配。

**Organization**: 任务按 plan.md 的 9 个执行阶段组织，User Story 1（plugin 内部文件）和 User Story 2（外部配置文件）作为 P1 优先交付，User Story 3（迁移文档）和 User Story 4（agents 路径一致性）作为 P2 在后续阶段完成。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 所属 User Story（US1, US2, US3, US4）
- 每个任务包含精确文件路径和替换规则编号

## Path Conventions

- **Plugin 根目录**: `plugins/spec-driver/`
- **外部配置**: `.claude/settings.json`, `CLAUDE.md`（项目根目录）
- 所有路径相对于项目根 `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/`

---

## Phase 1: 元数据精确替换（R01-R06, R26）

**Purpose**: 替换具有唯一上下文的精确值字段，不会出现歧义匹配

- [x] T001 [P] [US1] 更新 plugin.json 的 name 和 version 字段：`"name": "speckitdriver"` -> `"name": "spec-driver"`，`"version": "2.0.0"` -> `"version": "3.0.0"` — `plugins/spec-driver/.claude-plugin/plugin.json` (R01, R02)
- [x] T002 [P] [US1] 更新 postinstall.sh 的元数据变量和安装标记：`PLUGIN_NAME="Speckitdriver"` -> `PLUGIN_NAME="Spec Driver"`，`PLUGIN_VERSION="2.0.0"` -> `PLUGIN_VERSION="3.0.0"`，`.speckitdriver-installed` -> `.spec-driver-installed`，脚本头注释 `# Speckitdriver - ` -> `# Spec Driver - ` — `plugins/spec-driver/scripts/postinstall.sh` (R03, R04, R05, R26)
- [x] T003 [P] [US2] 更新 settings.json 的 plugin 注册 key：`"speckitdriver@cc-plugin-market"` -> `"spec-driver@cc-plugin-market"` — `.claude/settings.json` (R06)

**Checkpoint**: 元数据字段全部更新完成，plugin.json 版本号为 3.0.0

---

## Phase 2: SKILL.md frontmatter 替换（R07-R11）

**Purpose**: 更新 5 个 SKILL.md 的 frontmatter `name` 字段，使技能触发名称与目录名一致

- [x] T004 [P] [US1] 更新 speckit-feature/SKILL.md frontmatter：`name: run` -> `name: speckit-feature` — `plugins/spec-driver/skills/speckit-feature/SKILL.md` (R07)
- [x] T005 [P] [US1] 更新 speckit-story/SKILL.md frontmatter：`name: story` -> `name: speckit-story` — `plugins/spec-driver/skills/speckit-story/SKILL.md` (R08)
- [x] T006 [P] [US1] 更新 speckit-fix/SKILL.md frontmatter：`name: fix` -> `name: speckit-fix` — `plugins/spec-driver/skills/speckit-fix/SKILL.md` (R09)
- [x] T007 [P] [US1] 更新 speckit-resume/SKILL.md frontmatter：`name: resume` -> `name: speckit-resume` — `plugins/spec-driver/skills/speckit-resume/SKILL.md` (R10)
- [x] T008 [P] [US1] 更新 speckit-sync/SKILL.md frontmatter：`name: sync` -> `name: speckit-sync` — `plugins/spec-driver/skills/speckit-sync/SKILL.md` (R11)

**Checkpoint**: 所有 5 个 SKILL.md 的 frontmatter name 字段与目录名一致

---

## Phase 3: 品牌名替换（R12-R14）— US1 + US4

**Purpose**: 按长度递减顺序替换产品品牌名，避免短串替换破坏长串匹配

**执行顺序**: 先替换 `Speckit Driver Pro`（最长），再替换 `Speckitdriver`（较短）

### 3a. 替换 `Speckit Driver Pro` -> `Spec Driver`（R12）

- [x] T009 [US1] 替换 speckit-sync/SKILL.md 中的 `Speckit Driver Pro` -> `Spec Driver`（约 3 处） — `plugins/spec-driver/skills/speckit-sync/SKILL.md` (R12)

### 3b. 替换 `Speckitdriver` -> `Spec Driver`（R14）— SKILL.md 文件

- [x] T010 [P] [US1] 替换 speckit-feature/SKILL.md 正文中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/skills/speckit-feature/SKILL.md` (R14)
- [x] T011 [P] [US1] 替换 speckit-story/SKILL.md 正文中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/skills/speckit-story/SKILL.md` (R14)
- [x] T012 [P] [US1] 替换 speckit-fix/SKILL.md 正文中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/skills/speckit-fix/SKILL.md` (R14)
- [x] T013 [P] [US1] 替换 speckit-resume/SKILL.md 正文中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/skills/speckit-resume/SKILL.md` (R14)
- [x] T014 [P] [US1] 替换 speckit-sync/SKILL.md 正文中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/skills/speckit-sync/SKILL.md` (R14)

### 3c. 替换 `Speckitdriver` -> `Spec Driver`（R14）— agents 文件

- [x] T015 [P] [US4] 替换 agents/analyze.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/analyze.md` (R14)
- [x] T016 [P] [US4] 替换 agents/checklist.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/checklist.md` (R14)
- [x] T017 [P] [US4] 替换 agents/clarify.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/clarify.md` (R14)
- [x] T018 [P] [US4] 替换 agents/constitution.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/constitution.md` (R14)
- [x] T019 [P] [US4] 替换 agents/implement.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/implement.md` (R14)
- [x] T020 [P] [US4] 替换 agents/plan.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/plan.md` (R14)
- [x] T021 [P] [US4] 替换 agents/product-research.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/product-research.md` (R14)
- [x] T022 [P] [US4] 替换 agents/specify.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/specify.md` (R14)
- [x] T023 [P] [US4] 替换 agents/sync.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/sync.md` (R14)
- [x] T024 [P] [US4] 替换 agents/tasks.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/tasks.md` (R14)
- [x] T025 [P] [US4] 替换 agents/tech-research.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/tech-research.md` (R14)
- [x] T026 [P] [US4] 替换 agents/verify.md 中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/agents/verify.md` (R14)

### 3d. 替换 `Speckitdriver` -> `Spec Driver`（R14）— 其他文件

- [x] T027 [P] [US1] 替换 README.md 中的 `# Speckitdriver` 标题 -> `# Spec Driver` 以及正文中其他 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/README.md` (R13, R14)
- [x] T028 [P] [US1] 替换 init-project.sh 头注释中的 `Speckitdriver` -> `Spec Driver` 以及 `# Speckitdriver - ` -> `# Spec Driver - ` — `plugins/spec-driver/scripts/init-project.sh` (R14, R26)
- [x] T029 [P] [US1] 替换 spec-driver.config-template.yaml 注释中的 `Speckitdriver` -> `Spec Driver` — `plugins/spec-driver/templates/spec-driver.config-template.yaml` (R14)
- [x] T030 [P] [US1] 替换 product-spec-template.md 中的 `Speckitdriver` -> `Spec Driver`（如有） — `plugins/spec-driver/templates/product-spec-template.md` (R14)

**Checkpoint**: 所有文件中 `Speckit Driver Pro` 和 `Speckitdriver` 品牌名已替换为 `Spec Driver`

---

## Phase 4: 命令格式替换（R15-R19）— US1

**Purpose**: 替换旧命令触发格式为新格式，按命令长度递减顺序避免部分匹配

**执行顺序**: resume（最长）-> story -> sync -> run -> fix

**注意**: README.md 中 v2.0.0 迁移说明表格内的旧命令引述（`/speckitdriver:*`）作为历史记录保留，不替换。对 README.md 采用逐行精确编辑。

### 4a. SKILL.md 文件中的命令替换

- [x] T031 [P] [US1] 替换 speckit-feature/SKILL.md 中的命令引用：`/speckitdriver:run` -> `/spec-driver:speckit-feature`，以及相关的 `/speckitdriver:story`、`/speckitdriver:fix`、`/speckitdriver:resume`、`/speckitdriver:sync` 交叉引用 — `plugins/spec-driver/skills/speckit-feature/SKILL.md` (R15-R19)
- [x] T032 [P] [US1] 替换 speckit-story/SKILL.md 中的命令引用：`/speckitdriver:story` -> `/spec-driver:speckit-story`，以及相关交叉引用 — `plugins/spec-driver/skills/speckit-story/SKILL.md` (R15-R19)
- [x] T033 [P] [US1] 替换 speckit-fix/SKILL.md 中的命令引用：`/speckitdriver:fix` -> `/spec-driver:speckit-fix`，以及相关交叉引用 — `plugins/spec-driver/skills/speckit-fix/SKILL.md` (R15-R19)
- [x] T034 [P] [US1] 替换 speckit-resume/SKILL.md 中的命令引用：`/speckitdriver:resume` -> `/spec-driver:speckit-resume`，以及相关交叉引用 — `plugins/spec-driver/skills/speckit-resume/SKILL.md` (R15-R19)
- [x] T035 [P] [US1] 替换 speckit-sync/SKILL.md 中的命令引用：`/speckitdriver:sync` -> `/spec-driver:speckit-sync`，以及相关交叉引用 — `plugins/spec-driver/skills/speckit-sync/SKILL.md` (R15-R19)

### 4b. 脚本文件中的命令替换

- [x] T036 [US1] 替换 postinstall.sh 中的所有命令引用：`/speckitdriver:run` -> `/spec-driver:speckit-feature`，`/speckitdriver:story` -> `/spec-driver:speckit-story`，`/speckitdriver:fix` -> `/spec-driver:speckit-fix`，`/speckitdriver:resume` -> `/spec-driver:speckit-resume`，`/speckitdriver:sync` -> `/spec-driver:speckit-sync` — `plugins/spec-driver/scripts/postinstall.sh` (R15-R19)

### 4c. README.md 中的命令替换（逐行精确编辑，豁免迁移表）

- [x] T037 [US1] 替换 README.md 正文（非迁移表区域）中的命令引用：将所有 `/speckitdriver:*` 替换为对应的 `/spec-driver:speckit-*` 新格式。保留 v2.0.0 迁移说明表格中的旧命令引述不变 — `plugins/spec-driver/README.md` (R15-R19)

**Checkpoint**: 所有命令触发格式已更新为 `/spec-driver:speckit-*` 新格式

---

## Phase 5: 路径前缀替换（R20-R21）— US1 + US4

**Purpose**: 替换文件中引用的 plugin 目录路径前缀和安装命令

### 5a. agents 文件中的路径前缀替换

- [x] T038 [P] [US4] 替换 agents/sync.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/agents/sync.md` (R20)
- [x] T039 [P] [US4] 替换 agents/tech-research.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/agents/tech-research.md` (R20)
- [x] T040 [P] [US4] 替换 agents/product-research.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/agents/product-research.md` (R20)
- [x] T041 [P] [US4] 替换 agents/verify.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/agents/verify.md` (R20)

### 5b. SKILL.md 文件中的路径前缀替换

- [x] T042 [P] [US1] 替换 speckit-feature/SKILL.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/skills/speckit-feature/SKILL.md` (R20)
- [x] T043 [P] [US1] 替换 speckit-story/SKILL.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/skills/speckit-story/SKILL.md` (R20)
- [x] T044 [P] [US1] 替换 speckit-fix/SKILL.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/skills/speckit-fix/SKILL.md` (R20)
- [x] T045 [P] [US1] 替换 speckit-resume/SKILL.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/skills/speckit-resume/SKILL.md` (R20)
- [x] T046 [P] [US1] 替换 speckit-sync/SKILL.md 中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` — `plugins/spec-driver/skills/speckit-sync/SKILL.md` (R20)

### 5c. README.md 中的路径和安装命令替换

- [x] T047 [US1] 替换 README.md 正文中的 `plugins/speckitdriver/` -> `plugins/spec-driver/` 和 `claude plugin install speckitdriver` -> `claude plugin install spec-driver` — `plugins/spec-driver/README.md` (R20, R21)

**Checkpoint**: 所有路径前缀和安装命令已更新

---

## Phase 6: 外部文件更新（R22）— US2

**Purpose**: 更新 plugin 目录外部的项目级配置文件

- [x] T048 [US2] 更新 CLAUDE.md 中功能性引用：`speckitdriver 的方式` -> `spec-driver 的方式`。保留所有 `011-speckit-driver-pro` 历史特性编号不变 — `CLAUDE.md` (R22)

**Checkpoint**: 外部配置文件更新完成

---

## Phase 7: 新增内容（R23-R25, R27）— US1 + US3

**Purpose**: 更新 README.md 的目录结构描述、新增 v3.0.0 迁移说明、更新 agents/sync.md YAML 示例

- [x] T049 [US1] 更新 README.md 中的目录结构描述：将旧的 `plugins/speckitdriver/` 目录树替换为新的 `plugins/spec-driver/` 目录树，旧 skill 目录名（`run/`、`story/`、`fix/`、`resume/`、`sync/`）更新为新名（`speckit-feature/`、`speckit-story/`、`speckit-fix/`、`speckit-resume/`、`speckit-sync/`） — `plugins/spec-driver/README.md` (R24, R25)
- [x] T050 [US3] 在 README.md 的 v2.0.0 迁移说明之后新增 v3.0.0 迁移说明段落，包含完整的旧命令到新命令映射表（5 种模式全覆盖） — `plugins/spec-driver/README.md` (R23)
- [x] T051 [US4] 更新 agents/sync.md 中 YAML 示例的产品键名：`speckitdriver:` -> `spec-driver:` — `plugins/spec-driver/agents/sync.md` (R27)

**Checkpoint**: README.md 目录结构和迁移说明已更新，sync.md YAML 示例已更新

---

## Phase 8: 残留清扫

**Purpose**: 对前 7 个阶段可能遗漏的零散引用执行最终扫描和补充替换

- [x] T052 执行全文搜索 `grep -ri "speckitdriver" plugins/spec-driver/` 并排除迁移说明区域，检查是否有遗漏的旧引用。如发现残留，逐个修复
- [x] T053 执行全文搜索 `grep -i "Speckit Driver Pro" plugins/spec-driver/`，检查是否有遗漏的旧品牌名。如发现残留，逐个修复
- [x] T054 检查 `plugins/spec-driver/scripts/init-project.sh` 中是否有未被前序任务覆盖的 `speckitdriver` 残留引用并修复

**Checkpoint**: 所有文件中无非预期的旧引用残留

---

## Phase 9: 全量验证

**Purpose**: 系统性验证所有替换结果符合 Success Criteria

- [ ] T055 [P] 验证 SC-001: `grep -ri "speckitdriver" plugins/spec-driver/` 排除迁移说明后应返回 0 匹配
- [ ] T056 [P] 验证 SC-002: `grep -i "Speckit Driver Pro" plugins/spec-driver/` 排除迁移说明后应返回 0 匹配
- [ ] T057 [P] 验证 SC-003: `grep "speckitdriver" .claude/settings.json` 应返回 0 匹配
- [ ] T058 [P] 验证 SC-004: 检查 5 个 SKILL.md 的 frontmatter `name` 字段与目录名一致（speckit-feature、speckit-story、speckit-fix、speckit-resume、speckit-sync）
- [ ] T059 [P] 验证 SC-005: 读取 plugin.json 确认 `name` 为 `"spec-driver"` 且 `version` 为 `"3.0.0"`
- [ ] T060 [P] 验证 SC-006: `grep "speckitdriver" CLAUDE.md` 排除 `011-speckit-driver-pro` 后应返回 0 匹配
- [ ] T061 正向验证: `grep -r "spec-driver" plugins/spec-driver/` 和 `grep -r "Spec Driver" plugins/spec-driver/` 在预期位置出现
- [ ] T062 统计验证 SC-007: 确认总计更新约 25 个文件、约 110+ 处引用

---

## FR 覆盖映射表

| FR 编号 | 需求描述 | 覆盖任务 |
|---------|---------|---------|
| FR-001 | plugin.json name + version | T001 |
| FR-002 | 5 个 SKILL.md frontmatter name | T004-T008 |
| FR-003 | SKILL.md 命令触发格式 | T031-T035 |
| FR-004 | SKILL.md 产品名 | T009-T014 |
| FR-005 | agents 路径前缀 | T038-T041 |
| FR-006 | agents 角色名 | T015-T026 |
| FR-007 | postinstall.sh 安装标记 + 命令 | T002, T036 |
| FR-008 | postinstall.sh PLUGIN_NAME + VERSION | T002 |
| FR-009 | init-project.sh 头注释 | T028, T054 |
| FR-010 | README.md 命令/目录/安装命令 | T027, T037, T047, T049 |
| FR-011 | README.md v3.0.0 迁移说明 | T050 |
| FR-012 | settings.json plugin key | T003 |
| FR-013 | CLAUDE.md 功能性引用 | T048 |
| FR-014 | spec-driver.config-template.yaml 产品名 | T029 |
| FR-015 | product-spec-template.md 引用 | T030 |
| FR-016 | SKILL.md 路径引用 | T042-T046 |
| FR-017 | speckit-sync/SKILL.md 品牌名 | T009 |

**覆盖率**: 17/17 FR = **100%**

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1（元数据精确替换）**: 无依赖，可立即开始
- **Phase 2（frontmatter 替换）**: 无依赖，可与 Phase 1 并行
- **Phase 3（品牌名替换）**: 无依赖，可与 Phase 1-2 并行。但 Phase 3a 必须在 3b 之前（先长后短）
- **Phase 4（命令格式替换）**: 建议在 Phase 3 之后（避免品牌名替换影响命令字符串的可读性），但技术上无硬依赖
- **Phase 5（路径前缀替换）**: 无硬依赖，可与 Phase 3-4 并行
- **Phase 6（外部文件更新）**: 无依赖，可与 Phase 1-5 并行
- **Phase 7（新增内容）**: 建议在 Phase 3-5 对 README.md 的替换完成之后执行，避免新增内容被后续替换意外修改
- **Phase 8（残留清扫）**: 依赖 Phase 1-7 全部完成
- **Phase 9（全量验证）**: 依赖 Phase 8 完成

### User Story 间依赖

- **US1（plugin 内部文件）** 和 **US2（外部配置文件）**: 完全独立，可并行
- **US3（迁移文档）**: 依赖 US1 中 README.md 的正文替换先完成（Phase 3-5），再新增迁移说明（Phase 7）
- **US4（agents 路径一致性）**: 完全独立于其他 Story，可并行

### Story 内部并行机会

- **US1**: Phase 1 的 T001、T002 可并行；Phase 2 的 T004-T008 全部可并行；Phase 3 的同类文件替换可并行；Phase 4 的 T031-T035 可并行
- **US2**: T003 和 T048 可并行（不同文件）
- **US4**: T015-T026（agents 品牌名）全部可并行；T038-T041（agents 路径）全部可并行

### 推荐实现策略

**批量执行策略**（适合本任务特性）：

由于这是纯文本替换任务，无代码逻辑依赖，推荐按文件分组批量执行：

1. **第一批**（Phase 1-2，并行）: 元数据字段 + frontmatter — 8 个任务
2. **第二批**（Phase 3，按序）: 品牌名替换（先 R12 后 R14）— 22 个任务，其中同阶段内可大量并行
3. **第三批**（Phase 4-6，并行）: 命令格式 + 路径前缀 + 外部文件 — 18 个任务
4. **第四批**（Phase 7）: 新增内容 — 3 个任务
5. **第五批**（Phase 8-9）: 清扫 + 验证 — 11 个任务

**MVP 范围**: US1（plugin 内部文件全量更新）+ US2（外部配置同步）= Phase 1-6，交付后 plugin 即可正常加载使用。

---

## Notes

- [P] 标记 = 不同文件、无依赖，可并行执行
- 对同一文件的多个阶段替换（如 README.md 涉及 Phase 3/4/5/7），建议按阶段顺序串行处理该文件
- README.md 是替换最密集的文件（23 处），Phase 4c 和 Phase 7 需要特别注意迁移表豁免
- 历史特性编号（`011-speckit-driver-pro`）在任何文件中均不可修改
- 每完成一个 Phase 建议执行一次 `grep` 验证，及时发现遗漏
