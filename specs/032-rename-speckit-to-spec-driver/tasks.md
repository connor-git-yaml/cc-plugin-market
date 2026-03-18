# Tasks: 命名规范化 -- speckit 统一重命名为 spec-driver

**Input**: Design documents from `specs/032-rename-speckit-to-spec-driver/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/rename-mapping.md

**Tests**: 本 Feature 不新增测试用例。验证通过现有 `npm test` + `npm run lint` + `grep -r` 残留检测完成。

**Organization**: 任务按 User Story 分组。由于本 Feature 为纯 rename-only 操作，Phase 之间存在部分顺序依赖（先目录/文件重命名，再内容替换），但同一 Phase 内的任务大多可并行。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件，无依赖）
- **[Story]**: 所属 User Story（US1, US2, US3, US4, US5, US6）
- 包含精确文件路径

---

## Phase 1: Setup (预备工作)

**Purpose**: 记录变更前基线快照，确保可回滚

- [x] T001 记录历史 spec 目录的文件哈希基线，执行 `find specs/011-speckit-driver-pro/ specs/015-speckit-doc-command/ -type f -exec md5sum {} \;` 并保存输出到 `specs/032-rename-speckit-to-spec-driver/verification/baseline-hashes.txt`
- [x] T002 [P] 确认当前分支为 `032-rename-speckit-to-spec-driver`，工作区干净，`npm test` 和 `npm run lint` 通过

**Checkpoint**: 基线已记录，可安全开始重命名操作

---

## Phase 2: Foundational (目录与文件重命名 -- git mv 操作)

**Purpose**: 执行所有 git mv 操作。此阶段为阻塞性前置依赖，必须在内容替换之前完成。所有 git mv 操作建议在一次 commit 中完成，以保持 git 对重命名的识别。

**CRITICAL**: 目录和文件重命名必须先于内容替换执行，否则内容替换中的文件路径将失效。

- [x] T003 [P] 重命名 Skill 目录: `git mv plugins/spec-driver/skills/speckit-feature plugins/spec-driver/skills/spec-driver-feature`
- [x] T004 [P] 重命名 Skill 目录: `git mv plugins/spec-driver/skills/speckit-story plugins/spec-driver/skills/spec-driver-story`
- [x] T005 [P] 重命名 Skill 目录: `git mv plugins/spec-driver/skills/speckit-fix plugins/spec-driver/skills/spec-driver-fix`
- [x] T006 [P] 重命名 Skill 目录: `git mv plugins/spec-driver/skills/speckit-resume plugins/spec-driver/skills/spec-driver-resume`
- [x] T007 [P] 重命名 Skill 目录: `git mv plugins/spec-driver/skills/speckit-sync plugins/spec-driver/skills/spec-driver-sync`
- [x] T008 [P] 重命名 Skill 目录: `git mv plugins/spec-driver/skills/speckit-doc plugins/spec-driver/skills/spec-driver-doc`
- [x] T009 [P] 重命名命令文件: `git mv .claude/commands/speckit.analyze.md .claude/commands/spec-driver.analyze.md`
- [x] T010 [P] 重命名命令文件: `git mv .claude/commands/speckit.checklist.md .claude/commands/spec-driver.checklist.md`
- [x] T011 [P] 重命名命令文件: `git mv .claude/commands/speckit.clarify.md .claude/commands/spec-driver.clarify.md`
- [x] T012 [P] 重命名命令文件: `git mv .claude/commands/speckit.constitution.md .claude/commands/spec-driver.constitution.md`
- [x] T013 [P] 重命名命令文件: `git mv .claude/commands/speckit.implement.md .claude/commands/spec-driver.implement.md`
- [x] T014 [P] 重命名命令文件: `git mv .claude/commands/speckit.plan.md .claude/commands/spec-driver.plan.md`
- [x] T015 [P] 重命名命令文件: `git mv .claude/commands/speckit.specify.md .claude/commands/spec-driver.specify.md`
- [x] T016 [P] 重命名命令文件: `git mv .claude/commands/speckit.tasks.md .claude/commands/spec-driver.tasks.md`
- [x] T017 [P] 重命名命令文件: `git mv .claude/commands/speckit.taskstoissues.md .claude/commands/spec-driver.taskstoissues.md`

**Checkpoint**: 6 个 Skill 目录 + 9 个命令文件已重命名。验证: `ls plugins/spec-driver/skills/spec-driver-*/SKILL.md` 返回 6 个文件，`ls .claude/commands/spec-driver.*.md` 返回 9 个文件。

---

## Phase 3: User Story 1 -- Skill 目录与元数据命名统一 (Priority: P1)

**Goal**: 所有 SKILL.md 的 `name` 字段和内部引用使用 `spec-driver-*` 前缀

**Independent Test**: 通过 Skill 触发命令验证所有 6 个 Skill 可通过新名称被发现和执行

### Plugin Skills 内容替换

- [x] T018 [P] [US1] 更新 `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（name 字段 + 内部 10 处引用）
- [x] T019 [P] [US1] 更新 `plugins/spec-driver/skills/spec-driver-story/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（name 字段 + 内部 7 处引用）
- [x] T020 [P] [US1] 更新 `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（name 字段 + 内部 5 处引用）
- [x] T021 [P] [US1] 更新 `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（name 字段 + 内部 11 处引用）
- [x] T022 [P] [US1] 更新 `plugins/spec-driver/skills/spec-driver-sync/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（name 字段 + 内部 8 处引用）
- [x] T023 [P] [US1] 更新 `plugins/spec-driver/skills/spec-driver-doc/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（name 字段 + 内部 27 处引用）

### Codex Skills 内容替换

- [x] T024 [P] [US1] 更新 `.codex/skills/spec-driver-feature/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（6 处引用）
- [x] T025 [P] [US1] 更新 `.codex/skills/spec-driver-story/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（5 处引用）
- [x] T026 [P] [US1] 更新 `.codex/skills/spec-driver-fix/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（2 处引用）
- [x] T027 [P] [US1] 更新 `.codex/skills/spec-driver-resume/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（6 处引用）
- [x] T028 [P] [US1] 更新 `.codex/skills/spec-driver-sync/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（6 处引用）
- [x] T029 [P] [US1] 更新 `.codex/skills/spec-driver-doc/SKILL.md` 中的 `speckit` 引用为 `spec-driver`（27 处引用）

**Checkpoint**: 12 个 SKILL.md 的 name 字段和内部引用全部更新。验证: `grep -r "speckit" plugins/spec-driver/skills/ .codex/skills/` 返回零匹配。

---

## Phase 4: User Story 2 -- 命令文件命名与引用统一 (Priority: P1)

**Goal**: 9 个命令文件的内部引用统一使用 `spec-driver` 命名

**Independent Test**: 通过 `/spec-driver.plan`、`/spec-driver.tasks` 等命令触发路径验证命令文件可正常执行

- [x] T030 [P] [US2] 更新 `.claude/commands/spec-driver.analyze.md` 中的 `speckit` 引用为 `spec-driver`（4 处引用）
- [x] T031 [P] [US2] 更新 `.claude/commands/spec-driver.checklist.md` 中的 `speckit` 引用为 `spec-driver`（2 处引用）
- [x] T032 [P] [US2] 更新 `.claude/commands/spec-driver.clarify.md` 中的 `speckit` 引用为 `spec-driver`（5 处引用）
- [x] T033 [P] [US2] 更新 `.claude/commands/spec-driver.constitution.md` 中的 `speckit` 引用为 `spec-driver`（1 处引用）
- [x] T034 [P] [US2] 更新 `.claude/commands/spec-driver.implement.md` 中的 `speckit` 引用为 `spec-driver`（1 处引用）
- [x] T035 [P] [US2] 更新 `.claude/commands/spec-driver.plan.md` 中的 `speckit` 引用为 `spec-driver`（2 处引用）
- [x] T036 [P] [US2] 更新 `.claude/commands/spec-driver.specify.md` 中的 `speckit` 引用为 `spec-driver`（5 处引用）
- [x] T037 [P] [US2] 更新 `.claude/commands/spec-driver.tasks.md` 中的 `speckit` 引用为 `spec-driver`（2 处引用）
- [x] T038 [P] [US2] 更新 `.claude/commands/spec-driver.taskstoissues.md` 中的 `speckit` 引用（仅文件名已重命名，确认无内部遗留）

**Checkpoint**: 9 个命令文件内部引用全部更新。验证: `grep -r "speckit" .claude/commands/` 返回零匹配。

---

## Phase 5: User Story 3 -- HTML 锚点标记与脚本变量统一 (Priority: P1)

**Goal**: HTML 锚点、脚本变量名、函数名统一使用 `spec-driver` 命名

**Independent Test**: 运行 `bash -n plugins/spec-driver/scripts/init-project.sh` 确认语法正确，`grep "speckit"` 确认无遗留锚点

### 脚本文件替换

- [x] T039 [US3] 更新 `plugins/spec-driver/scripts/init-project.sh` 中的所有 `speckit` 引用（11 处: `HAS_SPECKIT_SKILLS` -> `HAS_SPEC_DRIVER_SKILLS`、`detect_speckit_skills` -> `detect_spec_driver_skills`、`speckit_skills` -> `spec_driver_skills`、注释和用户提示文本）
- [x] T040 [P] [US3] 更新 `plugins/spec-driver/scripts/codex-skills.sh` 中的所有 `speckit` 引用为 `spec-driver`（12 处引用）
- [x] T041 [P] [US3] 更新 `plugins/spec-driver/scripts/postinstall.sh` 中的所有 `speckit` 引用为 `spec-driver`（6 处引用）
- [x] T042 [P] [US3] 更新 `plugins/spec-driver/scripts/scan-project.sh` 中的 `speckit` 引用为 `spec-driver`（1 处引用）
- [x] T043 [P] [US3] 更新 `.specify/scripts/bash/check-prerequisites.sh` 中的 `speckit` 引用为 `spec-driver`（3 处: `/speckit.specify`、`/speckit.plan`、`/speckit.tasks`）

### 脚本语法验证

- [x] T044 [US3] 对所有修改过的脚本执行 `bash -n` 语法检查: `bash -n plugins/spec-driver/scripts/init-project.sh && bash -n plugins/spec-driver/scripts/codex-skills.sh && bash -n plugins/spec-driver/scripts/postinstall.sh && bash -n plugins/spec-driver/scripts/scan-project.sh && bash -n .specify/scripts/bash/check-prerequisites.sh`（依赖 T039-T043）

### HTML 锚点替换

- [x] T045 [P] [US3] 更新 `plugins/spec-driver/README.md` 中的所有 `<!-- speckit:section:* -->` 锚点为 `<!-- spec-driver:section:* -->`（含 `:end` 标记）
- [x] T046 [P] [US3] 更新根目录 `README.md` 中的所有 `<!-- speckit:section:* -->` 锚点为 `<!-- spec-driver:section:* -->`（含 `:end` 标记）

**Checkpoint**: 所有脚本变量/函数名、HTML 锚点更新完毕。验证: `grep -r "speckit" plugins/spec-driver/scripts/ .specify/scripts/` 返回零匹配。

---

## Phase 6: User Story 4 -- 模板与配置文件引用统一 (Priority: P2)

**Goal**: 所有模板、配置元数据和代理文件中的 `speckit` 引用更新为 `spec-driver`

**Independent Test**: 执行一次完整 Feature 工作流，验证生成的产物中命令引用均为 `spec-driver.*`

### Plugin 模板替换

- [x] T047 [P] [US4] 更新 `plugins/spec-driver/templates/specify-base/plan-template.md` 中的 `speckit` 引用为 `spec-driver`（7 处引用）
- [x] T048 [P] [US4] 更新 `plugins/spec-driver/templates/specify-base/tasks-template.md` 中的 `speckit` 引用为 `spec-driver`（1 处引用）
- [x] T049 [P] [US4] 更新 `plugins/spec-driver/templates/specify-base/checklist-template.md` 中的 `speckit` 引用为 `spec-driver`（2 处引用）
- [x] T050 [P] [US4] 更新 `plugins/spec-driver/templates/product-spec-template.md` 中的 `speckit` 引用为 `spec-driver`（3 处引用）

### .specify 模板替换

- [x] T051 [P] [US4] 更新 `.specify/templates/plan-template.md` 中的 `speckit` 引用为 `spec-driver`（7 处引用）
- [x] T052 [P] [US4] 更新 `.specify/templates/tasks-template.md` 中的 `speckit` 引用为 `spec-driver`（1 处引用）
- [x] T053 [P] [US4] 更新 `.specify/templates/checklist-template.md` 中的 `speckit` 引用为 `spec-driver`（2 处引用）

### 配置文件替换

- [x] T054 [P] [US4] 更新 `.claude-plugin/marketplace.json` 中的 `speckit` 引用为 `spec-driver`（2 处引用）
- [x] T055 [P] [US4] 更新 `plugins/spec-driver/.claude-plugin/plugin.json` 中的 `speckit` 引用为 `spec-driver`（1 处引用）

### 代理与契约文件替换

- [x] T056 [P] [US4] 更新 `plugins/spec-driver/agents/sync.md` 中的 `speckit` 引用为 `spec-driver`（6 处引用）
- [x] T057 [P] [US4] 更新 `plugins/spec-driver/agents/constitution.md` 中的 `speckit` 引用为 `spec-driver`（1 处引用）
- [x] T058 [P] [US4] 更新 `plugins/spec-driver/contracts/scan-project-output.md` 中的 `speckit` 引用为 `spec-driver`（2 处引用）

**Checkpoint**: 所有模板和配置文件更新完毕。验证: `grep -r "speckit" plugins/spec-driver/templates/ plugins/spec-driver/agents/ plugins/spec-driver/contracts/ .specify/templates/ .claude-plugin/` 返回零匹配。

---

## Phase 7: User Story 5 -- CLAUDE.md 历史引用更新与迁移文档 (Priority: P2)

**Goal**: 根级文档和产品活文档中的 `speckit` 引用更新，提供迁移指南

**Independent Test**: 查阅 CLAUDE.md 和迁移文档，确认描述清晰、历史 spec 路径未被修改

### 根级文件替换

- [x] T059 [US5] 更新根目录 `CLAUDE.md` 中的描述性 `speckit` 引用为 `spec-driver`（6 处引用），保留 `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 路径引用不变
- [x] T060 [P] [US5] 更新根目录 `README.md` 中的 `speckit` 内容引用为 `spec-driver`（56 处引用，不含已由 T046 处理的 HTML 锚点）
- [x] T061 [P] [US5] 更新 `plugins/spec-driver/README.md` 中的 `speckit` 内容引用为 `spec-driver`（35 处引用，不含已由 T045 处理的 HTML 锚点）
- [x] T062 [P] [US5] 更新 `.claude/settings.local.json` 中的过时路径 `plugins/speckit-driver-pro/` 为 `plugins/spec-driver/`（1 处引用）

### 产品活文档替换

- [x] T063 [US5] 更新 `specs/products/spec-driver/current-spec.md` 中的 `speckit` 引用为 `spec-driver`（约 64 处引用），保留历史 Feature ID 引用（`011-speckit-driver-pro`、`015-speckit-doc-command`）不变
- [x] T064 [P] [US5] 更新 `specs/products/product-mapping.yaml` 中的描述性 `speckit` 文本为 `spec-driver`（2 处 summary 引用），保留历史 Feature `id` 字段不变（`011-speckit-driver-pro`、`015-speckit-doc-command`）

### 迁移文档

- [x] T065 [US5] 在 `plugins/spec-driver/README.md` 的适当位置添加迁移指南段落，说明已有用户如何将自定义 `.claude/commands/speckit.*.md` 命令迁移到 `spec-driver.*.md`（可在 T061 中一并完成，或作为独立追加段落）

**Checkpoint**: 所有文档和配置引用更新完毕。验证: CLAUDE.md 中仅剩 `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 路径中的 `speckit`。

---

## Phase 8: User Story 6 -- 历史 Spec 目录保留与完整性验证 (Priority: P1)

**Goal**: 确认所有变更为 rename-only，历史 spec 目录未被触碰，测试/lint 全部通过

**Independent Test**: `npm test && npm run lint` + `grep -r "speckit"` 排除检测 + 文件哈希对比

### 全量残留检测

- [x] T066 执行全项目 `speckit` 残留检测: `grep -r "speckit" --include="*.md" --include="*.json" --include="*.sh" --include="*.yaml" --include="*.hbs" .`，排除 `specs/[0-9][0-9][0-9]-*/` 目录和 `specs/032-rename-speckit-to-spec-driver/` 自身。期望结果: 仅 `specs/products/product-mapping.yaml` 中的 2 处历史 Feature ID（`011-speckit-driver-pro`、`015-speckit-doc-command`）

### 历史目录完整性检查

- [x] T067 [P] 对比历史 spec 目录的文件哈希与 T001 中记录的基线: `find specs/011-speckit-driver-pro/ specs/015-speckit-doc-command/ -type f -exec md5sum {} \;` 并与 `specs/032-rename-speckit-to-spec-driver/verification/baseline-hashes.txt` 对比。期望结果: 完全一致

### 新旧文件存在性检查

- [x] T068 [P] 验证新 Skill 目录存在: `ls plugins/spec-driver/skills/spec-driver-{feature,story,fix,resume,sync,doc}/SKILL.md`（期望 6 个文件全部存在）
- [x] T069 [P] 验证旧 Skill 目录不存在: `ls plugins/spec-driver/skills/speckit-* 2>&1`（期望: No such file or directory）
- [x] T070 [P] 验证新命令文件存在: `ls .claude/commands/spec-driver.{analyze,checklist,clarify,constitution,implement,plan,specify,tasks,taskstoissues}.md`（期望 9 个文件全部存在）
- [x] T071 [P] 验证旧命令文件不存在: `ls .claude/commands/speckit.* 2>&1`（期望: No such file or directory）

### 测试与 Lint

- [x] T072 执行 `npm test`，确认全部测试通过（依赖 T066 确认无残留后执行）
- [x] T073 执行 `npm run lint`，确认无 lint 错误（依赖 T072 完成后执行）

**Checkpoint**: 全部验证通过，Feature 完成。

---

## FR 覆盖映射表

| 需求 ID | 描述 | 对应任务 |
|---------|------|----------|
| FR-001 | 6 个 Skill 目录重命名 | T003-T008 |
| FR-002 | 9 个命令文件重命名 | T009-T017 |
| FR-003 | 12 个 SKILL.md name 字段更新 | T018-T029 |
| FR-004 | SKILL.md 内部引用更新 | T018-T029 |
| FR-005 | 9 个命令文件内部引用更新 | T030-T038 |
| FR-006 | HTML 锚点标记更新 | T045, T046 |
| FR-007 | `HAS_SPECKIT_SKILLS` 变量名重命名 | T039 |
| FR-008 | `check-prerequisites.sh` 脚本引用更新 | T043 |
| FR-009 | 模板文件引用更新 | T047-T053 |
| FR-010 | `marketplace.json` 引用更新 | T054 |
| FR-011 | `plugin.json` 引用更新 | T055 |
| FR-012 | `README.md` 引用更新 | T060, T061 |
| FR-013 | `CLAUDE.md` 引用更新（保留历史路径） | T059 |
| FR-014 | `codex-skills.sh` 和 `postinstall.sh` 引用更新 | T040, T041 |
| FR-015 | `scan-project.sh` 和 `scan-project-output.md` 引用更新 | T042, T058 |
| FR-016 | `agents/sync.md` 和 `agents/constitution.md` 引用更新 | T056, T057 |
| FR-017 | 历史 spec 目录不可修改 | T067 |
| FR-018 | 变更为 rename-only，无行为变化 | T072, T073 |
| FR-019 | 迁移文档 | T065 |
| FR-020 | `.specify/` 模板和脚本引用更新 | T043, T051-T053 |
| FR-021 | `current-spec.md` 引用更新 | T063 |
| FR-022 | `product-mapping.yaml` 描述更新 | T064 |
| FR-023 | `settings.local.json` 过时路径修正 | T062 |

**覆盖率**: 23/23 FR = 100%

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
  |
  v
Phase 2 (Foundational: git mv) -- BLOCKS Phases 3-7
  |
  +---> Phase 3 (US1: Plugin/Codex Skills) --+
  |                                           |
  +---> Phase 4 (US2: 命令文件) ------[P]----+
  |                                           |
  +---> Phase 5 (US3: 锚点/脚本) ----[P]----+
  |                                           |
  +---> Phase 6 (US4: 模板/配置) ----[P]----+
  |                                           |
  +---> Phase 7 (US5: 文档/迁移) ----[P]----+
  |                                           |
  v                                           v
Phase 8 (US6: 验证) <-- 依赖所有 Phase 3-7 完成
```

### Phase 依赖关系

- **Phase 1 (Setup)**: 无依赖，立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 完成。**阻塞所有后续 Phase**
- **Phase 3-7 (US1-US5)**: 均依赖 Phase 2 完成。Phase 3-7 之间**可并行执行**
- **Phase 8 (US6)**: 依赖 Phase 3-7 全部完成

### User Story 间依赖

- **US1 (Skill 命名)** 和 **US2 (命令文件)**: 完全独立，可并行
- **US3 (锚点/脚本)**: 独立于 US1/US2，可并行
- **US4 (模板/配置)**: 独立于 US1-US3，可并行
- **US5 (文档/迁移)**: T060/T061 (README) 与 T045/T046 (锚点) 操作同一文件但不同区域，建议 T045/T046 先完成后再执行 T060/T061 以避免冲突
- **US6 (验证)**: 依赖所有其他 US 完成

### Story 内部并行机会

- **US1**: T018-T023 (6 个 Plugin SKILL.md) 全部可并行；T024-T029 (6 个 Codex SKILL.md) 全部可并行
- **US2**: T030-T038 (9 个命令文件) 全部可并行
- **US3**: T039-T043 (5 个脚本) 大部分可并行（T044 依赖前面完成）；T045-T046 (锚点) 可并行
- **US4**: T047-T058 (12 个模板/配置/代理文件) 全部可并行
- **US5**: T060-T064 可并行（T059 需特殊处理历史路径保留）
- **US6**: T067-T071 可并行；T072/T073 依赖前面完成

---

## Implementation Strategy

### Recommended: Batch Execution（推荐策略）

由于本 Feature 为纯 rename-only 操作，所有变更确定性极高，建议采用批量执行策略：

1. **Phase 1**: 记录基线（1 分钟）
2. **Phase 2**: 批量执行 15 个 `git mv` 操作，一次 commit（2 分钟）
3. **Phase 3-7**: 按文件区域批量执行文本替换（sed 或逐文件编辑），一次 commit（15 分钟）
4. **Phase 8**: 全量验证（5 分钟）

**预计总耗时**: 约 25 分钟

### Alternative: Story-by-Story（逐 Story 交付）

如需更细粒度的 commit 历史：

1. Phase 1 + Phase 2: 一次 commit（目录/文件重命名）
2. Phase 3 (US1): 一次 commit（Skills 内容替换）
3. Phase 4 (US2): 一次 commit（命令文件内容替换）
4. Phase 5 (US3): 一次 commit（脚本/锚点替换）
5. Phase 6 (US4): 一次 commit（模板/配置替换）
6. Phase 7 (US5): 一次 commit（文档/迁移）
7. Phase 8 (US6): 验证（不产生 commit）

---

## Notes

- [P] 标记 = 不同文件，无依赖，可并行执行
- [USN] 标记 = 映射到 spec.md 中的 User Story N
- 所有文本替换遵循 `contracts/rename-mapping.md` 中定义的映射规则
- 替换时注意条件排除: `specs/[0-9][0-9][0-9]-*/` 目录不可修改
- 替换时注意条件保留: `CLAUDE.md` 和 `product-mapping.yaml` 中的历史 Feature ID/路径
- 每个 Checkpoint 后建议执行一次 `grep -r "speckit"` 局部检测，确认无遗漏
- 最终 Phase 8 的全量验证是质量门控，不可跳过
