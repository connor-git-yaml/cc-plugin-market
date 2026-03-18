# Feature Specification: 命名规范化 — speckit 统一重命名为 spec-driver

**Feature Branch**: `032-rename-speckit-to-spec-driver`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "将项目中所有 speckit 前缀统一重命名为 spec-driver，消除命名不一致"

---
research_mode: skip
research_skip_reason: "命令行参数指定"
---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Skill 目录与元数据命名统一 (Priority: P1)

作为 Plugin 维护者，我希望 `plugins/spec-driver/skills/` 目录下的所有 Skill 目录名和 `SKILL.md` 的 `name` 字段都使用 `spec-driver-*` 前缀，以便与 `.codex/skills/` 中的命名保持一致，消除新贡献者的困惑。

**Why this priority**: 这是最核心的命名不一致点。Skill 目录名是用户和开发者最常接触的标识符，也是 Skill 触发路径的一部分（如 `/spec-driver:speckit-feature` 中的 `speckit-feature`）。不修复此处，其他引用修复都只是表面。

**Independent Test**: 可以独立测试——重命名 6 个 Skill 目录及其 `SKILL.md` name 字段后，通过 Skill 触发命令验证所有 Skill 仍可正常被发现和执行。

**Acceptance Scenarios**:

1. **Given** `plugins/spec-driver/skills/` 下存在 6 个 `speckit-*` 目录, **When** 执行目录重命名, **Then** 所有目录名变为 `spec-driver-*` 前缀，原有文件内容不丢失
2. **Given** 12 个 SKILL.md 文件（6 个源 + 6 个 Codex 包装）含有 `name: speckit-*`, **When** 更新 name 字段, **Then** 所有 name 字段变为 `spec-driver-*`
3. **Given** SKILL.md 文件中存在对 `speckit-*` Skill 名称的交叉引用, **When** 更新所有内部引用, **Then** 所有 Skill 间引用指向正确的 `spec-driver-*` 名称

---

### User Story 2 - 命令文件命名与引用统一 (Priority: P1)

作为 Plugin 使用者，我希望 `.claude/commands/` 下的命令文件统一使用 `spec-driver.*` 前缀，且所有命令文件内部的交叉引用（如 `/speckit.plan`、`/speckit.tasks`）同步更新，使命令触发路径与品牌命名一致。

**Why this priority**: 命令文件名直接影响用户的日常使用体验（`/speckit.plan` vs `/spec-driver.plan`），是面向终端用户的第一接触点。与 Story 1 并列为 P1，因为 Skill 触发（Story 1）和命令触发（Story 2）是用户交互的两个主要入口。

**Independent Test**: 可以独立测试——重命名 9 个命令文件并更新内部引用后，通过命令触发验证所有命令仍可正常执行。

**Acceptance Scenarios**:

1. **Given** `.claude/commands/` 下存在 9 个 `speckit.*.md` 文件, **When** 执行文件重命名, **Then** 所有文件名变为 `spec-driver.*.md`
2. **Given** 命令文件内部存在 `/speckit.*` 引用, **When** 更新引用, **Then** 所有引用变为 `/spec-driver.*`
3. **Given** SKILL.md 的 Prompt 来源映射中引用 `speckit.{phase}.md`, **When** 更新映射引用, **Then** Prompt 来源映射指向 `spec-driver.{phase}.md`

---

### User Story 3 - HTML 锚点标记与脚本变量统一 (Priority: P1)

作为 Plugin 开发者，我希望所有内部标记（HTML 锚点 `<!-- speckit:section:* -->`）和脚本变量（`HAS_SPECKIT_SKILLS`）统一使用 `spec-driver` 命名，以确保全项目无遗留的旧命名。

**Why this priority**: HTML 锚点标记被解析脚本依赖，用于定位和替换内容段落。脚本变量被 `init-project.sh` 运行时读取。这些是功能性引用，命名不一致会导致运行时行为异常。

**Independent Test**: 可以独立测试——更新锚点标记和变量名后，运行 `bash init-project.sh --json` 验证变量名正确输出，grep 确认无遗留的 `speckit` 锚点。

**Acceptance Scenarios**:

1. **Given** 项目中存在 20+ 处 `<!-- speckit:section:* -->` 锚点, **When** 更新所有锚点, **Then** 锚点格式变为 `<!-- spec-driver:section:* -->`
2. **Given** `init-project.sh` 和 SKILL.md 中使用 `HAS_SPECKIT_SKILLS` 变量, **When** 重命名变量, **Then** 变量名变为 `HAS_SPEC_DRIVER_SKILLS`，脚本输出的 JSON 键名同步更新
3. **Given** `check-prerequisites.sh` 中引用 `speckit.*` 命令, **When** 更新引用, **Then** 引用变为 `spec-driver.*` 命令

---

### User Story 4 - 模板与配置文件引用统一 (Priority: P2)

作为 Plugin 维护者，我希望所有模板文件（`plan-template.md`、`tasks-template.md`、`checklist-template.md` 等）和配置元数据文件（`marketplace.json`、`plugin.json`、`README.md`）中的 `speckit` 引用全部更新为 `spec-driver`，确保生成的产物和对外展示均使用统一品牌名。

**Why this priority**: 模板和配置文件影响的是"下游输出"——即 Plugin 生成的文档中的命令引用、Marketplace 展示页面。虽不影响核心运行时功能，但影响品牌一致性和用户理解。

**Independent Test**: 可以独立测试——更新模板和配置文件后，执行一次完整的 Feature 工作流，验证生成的 plan.md、tasks.md 等产物中的命令引用均为 `spec-driver.*`。

**Acceptance Scenarios**:

1. **Given** `plan-template.md` 等模板中存在 `/speckit.*` 命令引用, **When** 更新模板, **Then** 所有引用变为 `/spec-driver.*`
2. **Given** `marketplace.json` 和 `plugin.json` 中存在 `speckit` 描述和标签, **When** 更新配置, **Then** 描述和标签统一为 `spec-driver`
3. **Given** `README.md`（根目录和 `plugins/spec-driver/`）中存在 `speckit` 引用, **When** 更新文档, **Then** 所有引用变为 `spec-driver`

---

### User Story 5 - CLAUDE.md 历史引用更新与迁移文档 (Priority: P2)

作为已有 Plugin 用户，我希望 `CLAUDE.md` 中的历史 Feature 引用和项目说明中的 `speckit` 命名被更新（保留历史 spec 目录名不变），并希望有清晰的迁移指南，告知我如何将自定义命令从 `speckit.*` 迁移到 `spec-driver.*`。

**Why this priority**: 面向已有用户的迁移体验。不阻塞核心功能，但影响现有用户的升级顺畅程度。

**Independent Test**: 可以独立测试——查阅 CLAUDE.md 和迁移文档，确认描述清晰、迁移步骤可执行。

**Acceptance Scenarios**:

1. **Given** `CLAUDE.md` 中存在 `speckit-driver-pro`、`speckit-doc-command` 等 Feature 名引用, **When** 更新引用（仅限描述性文本，不改 spec 目录名）, **Then** 描述性文本使用 `spec-driver`，历史 spec 目录路径 `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 保持不变
2. **Given** 用户项目中可能已有 `.claude/commands/speckit.*.md` 自定义命令, **When** 查阅迁移文档, **Then** 文档提供明确的文件重命名步骤和内部引用更新检查清单

---

### User Story 6 - 历史 Spec 目录保留与完整性验证 (Priority: P1)

作为项目维护者，我希望确认所有变更严格为 rename-only，无任何行为变化；历史 spec 目录（`specs/011-speckit-driver-pro/`、`specs/015-speckit-doc-command/`）保持原样以保留 git 追溯性；变更完成后所有测试、lint 和 Marketplace 校验均通过。

**Why this priority**: 这是整个重命名操作的安全约束——如果重命名引入了行为变化或破坏了测试，整个 Feature 就失败了。作为 P1 保障所有其他 Story 的正确性。

**Independent Test**: 可以独立测试——在完成所有重命名后运行 `npm test && npm run lint`，并执行 `grep -r "speckit" --include="*.md" --include="*.json" --include="*.sh" --include="*.yaml"` 确认除历史目录外无遗留。

**Acceptance Scenarios**:

1. **Given** 所有重命名变更已完成, **When** 运行 `npm test`, **Then** 全部测试通过
2. **Given** 所有重命名变更已完成, **When** 运行 `npm run lint`, **Then** 无 lint 错误
3. **Given** 所有重命名变更已完成, **When** 在项目根目录执行 `speckit` 关键字搜索（排除 `specs/011-*` 和 `specs/015-*` 和 git 历史）, **Then** 零匹配
4. **Given** `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 存在, **When** 检查这些目录, **Then** 目录名和内容均未被修改

---

### Edge Cases

- **用户自定义命令未迁移**: 用户可能在自己的项目中已有 `.claude/commands/speckit.*.md` 自定义命令。Plugin 升级后，SKILL.md 中的 Prompt 来源映射将查找 `spec-driver.*.md` 而非 `speckit.*.md`，导致自定义命令失效。需在迁移文档中明确说明。
- **部分重命名导致引用断裂**: 如果只完成了部分目录/文件重命名，内部交叉引用可能指向不存在的路径。所有重命名操作必须原子性地一起完成。
- **Git 大小写敏感性**: 在大小写不敏感的文件系统（如 macOS 默认 APFS）上，确保目录重命名不会因大小写问题产生冲突（本次变更不涉及大小写变化，但需注意 `git mv` 行为）。
- **Codex 包装 Skill 同步**: `.codex/skills/spec-driver-*` 已使用新命名，但其 SKILL.md 内部可能仍引用 `speckit`（如 `HAS_SPECKIT_SKILLS`），需同步更新。
- **模板生成的产物兼容性**: 更新模板后，已生成的历史产物（如之前 Feature 的 plan.md）中的命令引用仍为 `speckit.*`，这属于历史数据，不做变更。
- **`codex-skills.sh` 脚本**: 该脚本可能包含 Skill 目录名或 Skill 名称的硬编码引用，需同步更新。
- **`postinstall.sh` 脚本**: 安装后脚本可能引用旧的目录名或命令名，需同步更新。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 将 `plugins/spec-driver/skills/` 下的 6 个 `speckit-*` 目录重命名为对应的 `spec-driver-*` 目录（speckit-feature -> spec-driver-feature, speckit-story -> spec-driver-story, speckit-fix -> spec-driver-fix, speckit-resume -> spec-driver-resume, speckit-sync -> spec-driver-sync, speckit-doc -> spec-driver-doc）[关联: US-1]
- **FR-002**: 系统 MUST 将 `.claude/commands/` 下的 9 个 `speckit.*.md` 文件重命名为对应的 `spec-driver.*.md` 文件 [关联: US-2]
- **FR-003**: 系统 MUST 更新所有 12 个 SKILL.md 文件（6 个 Plugin 源 + 6 个 Codex 包装）的 YAML Front Matter 中 `name` 字段，从 `speckit-*` 更新为 `spec-driver-*` [关联: US-1]
- **FR-004**: 系统 MUST 更新所有 SKILL.md 文件中的内部引用，包括但不限于：`/speckit.plan` -> `/spec-driver.plan`、`/speckit.tasks` -> `/spec-driver.tasks`、`speckit-feature` -> `spec-driver-feature` 等 Skill 名称引用、`speckit.{phase}.md` -> `spec-driver.{phase}.md` 文件名引用 [关联: US-1, US-2]
- **FR-005**: 系统 MUST 更新所有 9 个命令文件中的 `speckit` 内部引用为 `spec-driver` [关联: US-2]
- **FR-006**: 系统 MUST 将所有 `<!-- speckit:section:* -->` HTML 锚点标记更新为 `<!-- spec-driver:section:* -->` [关联: US-3]
- **FR-007**: 系统 MUST 将 `HAS_SPECKIT_SKILLS` 变量名重命名为 `HAS_SPEC_DRIVER_SKILLS`，涉及 `init-project.sh`、SKILL.md 文件中的所有使用点 [关联: US-3]
- **FR-008**: 系统 MUST 更新 `check-prerequisites.sh` 脚本中的 `speckit` 命令引用为 `spec-driver` [关联: US-3]
- **FR-009**: 系统 MUST 更新所有模板文件（`plan-template.md`、`tasks-template.md`、`checklist-template.md`、`product-spec-template.md` 等）中的 `speckit` 引用为 `spec-driver` [关联: US-4]
- **FR-010**: 系统 MUST 更新 `marketplace.json` 的描述和标签中的 `speckit` 引用为 `spec-driver` [关联: US-4]
- **FR-011**: 系统 MUST 更新 `plugin.json` 的标签中的 `speckit` 引用为 `spec-driver` [关联: US-4]
- **FR-012**: 系统 MUST 更新 `README.md`（根目录和 `plugins/spec-driver/`）中的 `speckit` 引用为 `spec-driver` [关联: US-4]
- **FR-013**: 系统 MUST 更新 `CLAUDE.md` 中的描述性 `speckit` 引用为 `spec-driver`，但保留 `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 路径引用不变 [关联: US-5]
- **FR-014**: 系统 MUST 更新 `codex-skills.sh` 和 `postinstall.sh` 脚本中的 `speckit` 引用为 `spec-driver` [关联: US-3]
- **FR-015**: 系统 MUST 更新 `scan-project.sh` 和 `contracts/scan-project-output.md` 中的 `speckit` 引用为 `spec-driver` [关联: US-3]
- **FR-016**: 系统 MUST 更新 `agents/sync.md` 和 `agents/constitution.md` 中的 `speckit` 引用为 `spec-driver` [关联: US-4]
- **FR-017**: 系统 MUST NOT 修改 `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 目录及其内容（历史 Feature 目录保留原名以保证 git 追溯性）[关联: US-6]
- **FR-018**: 系统 MUST 保证所有变更为 rename-only，不引入任何行为变化 [关联: US-6]
- **FR-019**: 系统 SHOULD 在 Plugin README 或 CHANGELOG 中提供迁移指南，说明已有用户如何将自定义 `.claude/commands/speckit.*.md` 命令迁移到 `spec-driver.*.md` [关联: US-5]

### Key Entities

- **Skill 目录**: `plugins/spec-driver/skills/{skill-name}/` 下的目录，包含 SKILL.md 文件，定义 Skill 的触发名、描述和完整 prompt。目录名即 Skill 标识符。
- **命令文件**: `.claude/commands/{command-name}.md` 文件，定义用户可通过 `/{command-name}` 触发的命令。文件名即命令标识符。
- **HTML 锚点标记**: `<!-- spec-driver:section:{section-name} -->` 格式的 HTML 注释，被脚本解析用于定位和替换文档段落。
- **脚本变量**: 如 `HAS_SPEC_DRIVER_SKILLS`，在 Bash 脚本和 SKILL.md prompt 中传递 Plugin 安装状态的布尔标识。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在项目根目录执行 `grep -r "speckit" --include="*.md" --include="*.json" --include="*.sh" --include="*.yaml" --include="*.hbs"`（排除 `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 目录）返回零匹配
- **SC-002**: `npm test` 全部通过，测试通过率 100%
- **SC-003**: `npm run lint` 无错误输出
- **SC-004**: `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/` 目录的文件哈希值与变更前完全一致（未被触碰）
- **SC-005**: 所有 6 个 Skill 可通过新名称（`spec-driver-feature`、`spec-driver-story` 等）被正确发现和触发
- **SC-006**: 所有 9 个命令文件可通过新名称（`/spec-driver.plan`、`/spec-driver.tasks` 等）被正确触发
- **SC-007**: 变更涉及的文件总数与需求中列出的范围一致，无遗漏无多余

## Clarifications

### Session 2026-03-18

#### CL-001 [AUTO-CLARIFIED: 纳入范围 -- 实际文件验证发现遗漏]
**问题**: spec 中未覆盖 `.specify/` 目录下的 `speckit` 引用，但实际项目中存在 3 个文件含有 `speckit` 引用。

**影响文件**:
- `.specify/templates/plan-template.md`（6 处引用：`/speckit.plan`、`/speckit.tasks` 等）
- `.specify/templates/tasks-template.md`（1 处引用：`/speckit.tasks`）
- `.specify/templates/checklist-template.md`（2 处引用：`/speckit.checklist`）
- `.specify/scripts/bash/check-prerequisites.sh`（3 处引用：`/speckit.specify`、`/speckit.plan`、`/speckit.tasks`）

**决策**: 这些文件属于 `.specify/` 独立 Skill 的模板和脚本，与 `plugins/spec-driver/` 下的同名模板是不同的副本。应将其纳入重命名范围。需新增 FR-020。

#### CL-002 [AUTO-CLARIFIED: 纳入范围 -- 实际文件验证发现遗漏]
**问题**: spec 的 FR-008 引用了 `check-prerequisites.sh`，但该文件实际路径为 `.specify/scripts/bash/check-prerequisites.sh`，而非 `plugins/spec-driver/scripts/` 下。`plugins/spec-driver/scripts/` 下不存在 `check-prerequisites.sh`。

**决策**: 修正 FR-008 中的文件路径引用，指向实际存在的 `.specify/scripts/bash/check-prerequisites.sh`。

#### CL-003 [AUTO-CLARIFIED: 纳入范围 -- 实际文件验证发现遗漏]
**问题**: spec 的 FR-010 引用 `marketplace.json` 的路径未明确。实际项目中有两个位置存在 marketplace.json：
- `.claude-plugin/marketplace.json`（根级，含 2 处 `speckit` 引用）
- `plugins/spec-driver/.claude-plugin/marketplace.json`（不存在）

**决策**: FR-010 应指向 `.claude-plugin/marketplace.json`（根级），更正路径引用。

#### CL-004 [AUTO-CLARIFIED: 纳入范围 -- 实际文件验证发现遗漏]
**问题**: spec 未覆盖 `specs/products/spec-driver/current-spec.md` 和 `specs/products/product-mapping.yaml` 中的 `speckit` 引用。`current-spec.md` 含有约 64 处 `speckit` 引用，`product-mapping.yaml` 含有 4 处（其中 2 处为历史 Feature ID）。

**决策**: `current-spec.md` 作为产品活文档（由 speckit-sync 生成），其内容中的 `speckit` 引用应更新为 `spec-driver`。`product-mapping.yaml` 中的 `id: "011-speckit-driver-pro"` 和 `id: "015-speckit-doc-command"` 属于历史 Feature ID，与 `specs/011-*` 和 `specs/015-*` 目录名一致，应保留不变；但 summary 描述性文本中的 `speckit` 应更新。需新增 FR-021 和 FR-022。

#### CL-005 [AUTO-CLARIFIED: 纳入范围 -- 实际文件验证发现遗漏]
**问题**: spec 未覆盖 `.claude/settings.local.json` 中的 `speckit` 引用。该文件含有 1 处旧路径引用 `plugins/speckit-driver-pro/scripts/init-project.sh`（已过时的路径格式）。

**决策**: 该引用是一条 allow-list 规则，引用的是不存在的旧路径。应将其更新为当前正确路径 `plugins/spec-driver/scripts/init-project.sh`（注意此处修正的不是 speckit 到 spec-driver 的命名，而是已过时的旧路径）。纳入重命名范围。需新增 FR-023。

#### CL-006 [AUTO-CLARIFIED: 扩展排除列表 -- 历史 spec 目录需排除更多]
**问题**: FR-017 和 SC-001 中的排除列表仅包含 `specs/011-speckit-driver-pro/` 和 `specs/015-speckit-doc-command/`，但实际上 `specs/` 下大量历史 Feature 的 spec/plan/tasks 文件中含有 `speckit` 引用（如 `specs/013-*`、`specs/014-*`、`specs/016-*`、`specs/017-*`、`specs/018-*`、`specs/019-*`、`specs/020-*`、`specs/021-*`、`specs/022-*` 等，以及 `specs/030-*`）。

**决策**: 所有 `specs/NNN-*/` 目录下的历史制品均属于"已生成的历史产物"（Edge Case 中已提及），不做变更。排除列表应扩展为 `specs/[0-9][0-9][0-9]-*/`（所有历史 Feature spec 目录），而非仅列出 011 和 015。但 `specs/products/` 下的活文档不在排除范围内（见 CL-004）。

#### CL-007 [AUTO-CLARIFIED: 修正计数 -- 命令文件数量不一致]
**问题**: SC-007 中说"8 个命令文件"，但 FR-002 和 US-2 中明确说"9 个 `speckit.*.md` 文件"。实际验证确认确实是 9 个文件（analyze, checklist, clarify, constitution, implement, plan, specify, tasks, taskstoissues）。

**决策**: SC-007 中的"8 个命令文件"为笔误，应修正为"9 个命令文件"。

#### CL-008 [AUTO-CLARIFIED: 纳入范围 -- init-project.sh 中的函数名和注释]
**问题**: FR-007 覆盖了 `HAS_SPECKIT_SKILLS` 变量名，但 `init-project.sh` 中还有函数名 `detect_speckit_skills()`、注释 `# 步骤 5: 检测已有 speckit skills`、结果键 `speckit_skills:found` / `speckit_skills:none`、以及用户提示文本 `speckit skills` 等引用未被明确覆盖。

**决策**: 这些均属于 init-project.sh 中的 `speckit` 引用，应由 FR-014 覆盖（该 FR 已涵盖 init-project.sh）。但需明确：函数名 `detect_speckit_skills` 重命名为 `detect_spec_driver_skills`，结果键 `speckit_skills` 重命名为 `spec_driver_skills`，这属于行为变化（JSON 输出键名变更），需确保下游消费者（SKILL.md prompt 中的解析逻辑）同步更新。

### 新增需求（基于澄清）

- **FR-020**: 系统 MUST 更新 `.specify/templates/` 下的模板文件（`plan-template.md`、`tasks-template.md`、`checklist-template.md`）和 `.specify/scripts/bash/check-prerequisites.sh` 中的 `speckit` 引用为 `spec-driver` [关联: CL-001]
- **FR-021**: 系统 MUST 更新 `specs/products/spec-driver/current-spec.md` 中的 `speckit` 引用为 `spec-driver`，但保留历史 Feature ID 引用（如 `011-speckit-driver-pro`、`015-speckit-doc-command`）不变 [关联: CL-004]
- **FR-022**: 系统 MUST 更新 `specs/products/product-mapping.yaml` 中的描述性 `speckit` 文本为 `spec-driver`，但保留历史 Feature `id` 字段不变 [关联: CL-004]
- **FR-023**: 系统 MUST 更新 `.claude/settings.local.json` 中的过时路径 `plugins/speckit-driver-pro/` 为 `plugins/spec-driver/` [关联: CL-005]

### 修正需求（基于澄清）

- **FR-008 修正**: `check-prerequisites.sh` 的实际路径为 `.specify/scripts/bash/check-prerequisites.sh`，非 `plugins/spec-driver/scripts/` 下 [关联: CL-002]
- **FR-010 修正**: `marketplace.json` 的实际路径为 `.claude-plugin/marketplace.json`（根级） [关联: CL-003]
- **FR-017 修正**: 排除范围应扩展为所有 `specs/[0-9][0-9][0-9]-*/` 历史 Feature 目录（不仅限于 011 和 015） [关联: CL-006]
- **SC-001 修正**: grep 排除范围应扩展为 `specs/[0-9][0-9][0-9]-*/`（所有历史 Feature spec 目录），同时排除 `specs/032-rename-speckit-to-spec-driver/`（本 Feature 自身的 spec 文件） [关联: CL-006]
- **SC-007 修正**: "8 个命令文件"应更正为"9 个命令文件" [关联: CL-007]
