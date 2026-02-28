# Feature Specification: Spec-Driver 重命名 v3.0.0

**Feature Branch**: `feat/rename-spec-driver`
**Created**: 2026-02-15
**Status**: Draft
**Input**: User description: "将 speckitdriver plugin 重命名为 spec-driver（v3.0.0），同步更新所有文件中的旧引用"

[无调研基础] 本规范基于代码上下文分析直接生成，未经过调研阶段。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Plugin 内部文件引用全量更新 (Priority: P1)

作为 spec-driver plugin 的维护者，我希望 plugin 内部所有文件（SKILL.md、agents/*.md、scripts/*.sh、plugin.json、README.md）中的旧名称引用（`speckitdriver`、`Speckitdriver`、`Speckit Driver Pro`）和旧命令格式（`/speckitdriver:run` 等）全部更新为新名称（`spec-driver`、`Spec Driver`）和新命令格式（`/spec-driver:speckit-feature` 等），使得 plugin 安装后用户看到的所有文档和提示信息均反映最新的命名体系。

**Why this priority**: 这是重命名的核心工作。如果内部引用不一致，用户会看到混乱的命令提示和文档描述，导致无法正确使用 plugin。这是 MVP 的最小可行交付。

**Independent Test**: 在 plugin 目录下执行全文搜索 `speckitdriver`（不区分大小写）和 `Speckit Driver Pro`，结果应为零匹配。同时搜索新名称 `spec-driver` 和 `Spec Driver` 应在预期位置出现。

**Acceptance Scenarios**:

1. **Given** plugin 目录 `plugins/spec-driver/` 下存在 23 个包含旧引用的文件，**When** 执行全量重命名更新，**Then** 所有 110+ 处旧引用均被替换为对应的新值，且文件内容语义不变
2. **Given** SKILL.md 的 frontmatter 中 `name` 字段为旧值（如 `name: run`），**When** 更新 frontmatter，**Then** `name` 字段更新为新值（如 `name: speckit-feature`），且 `description` 字段中的旧命令引用同步更新
3. **Given** `plugin.json` 中 `name` 为 `"speckitdriver"` 且 `version` 为 `"2.0.0"`，**When** 更新元数据，**Then** `name` 变为 `"spec-driver"` 且 `version` 变为 `"3.0.0"`
4. **Given** `postinstall.sh` 中安装标记文件路径为 `.speckitdriver-installed`，**When** 更新脚本，**Then** 路径变为 `.spec-driver-installed` 且脚本中所有命令提示更新为新格式
5. **Given** `README.md` 中包含旧目录结构描述和 v2.0.0 迁移说明，**When** 更新文档，**Then** 目录结构反映新的 `plugins/spec-driver/` 路径和 `speckit-*` 技能名，迁移说明新增 v3.0.0 部分

---

### User Story 2 - 外部配置文件引用同步 (Priority: P1)

作为项目开发者，我希望 plugin 目录外部的配置文件（`.claude/settings.json`、`CLAUDE.md`）中对旧 plugin 名称的引用也同步更新，使得 Claude Code 能正确识别和加载重命名后的 plugin。

**Why this priority**: `settings.json` 中的 plugin 注册名直接决定 plugin 能否被 Claude Code 加载。如果不更新，重命名后 plugin 将无法被识别，属于阻断性问题。

**Independent Test**: 验证 `.claude/settings.json` 中 `enabledPlugins` 的 key 从 `speckitdriver@cc-plugin-market` 变为 `spec-driver@cc-plugin-market`。验证 `CLAUDE.md` 中无 `speckitdriver` 残留引用（历史特性编号引用如 `011-speckit-driver-pro` 除外，这些是历史记录不应修改）。

**Acceptance Scenarios**:

1. **Given** `.claude/settings.json` 包含 `"speckitdriver@cc-plugin-market": true`，**When** 更新配置，**Then** 变为 `"spec-driver@cc-plugin-market": true`
2. **Given** `CLAUDE.md` 第 55 行包含 `使用 speckitdriver 的方式执行需求变更`，**When** 更新文档，**Then** 变为 `使用 spec-driver 的方式执行需求变更`
3. **Given** `CLAUDE.md` 中存在历史特性编号引用（如 `011-speckit-driver-pro`），**When** 检查更新范围，**Then** 历史特性编号保持不变（它们是已完成特性的标识符，不应修改）

---

### User Story 3 - 命令格式迁移文档 (Priority: P2)

作为已安装旧版 plugin 的用户，我希望 README.md 中包含从 v2.0.0 到 v3.0.0 的迁移说明，使我能快速了解命令变更并开始使用新版本。

**Why this priority**: 迁移文档虽非功能性需求，但对现有用户的升级体验至关重要。没有迁移指引，用户会困惑于命令名称变化。

**Independent Test**: 阅读 README.md 的迁移说明部分，确认包含完整的旧命令到新命令映射表，且覆盖所有 5 种模式。

**Acceptance Scenarios**:

1. **Given** README.md 已有 v2.0.0 迁移说明（从 `speckit-driver-pro` 到 `speckitdriver`），**When** 新增 v3.0.0 迁移说明，**Then** 文档中包含完整的 v2.0.0 → v3.0.0 命令映射表，覆盖 run→speckit-feature、story→speckit-story、fix→speckit-fix、resume→speckit-resume、sync→speckit-sync 全部 5 种模式
2. **Given** 用户查看 README.md，**When** 阅读安装说明，**Then** 看到的安装命令为 `claude plugin install spec-driver`

---

### User Story 4 - agents 子代理引用路径一致性 (Priority: P2)

作为 spec-driver 的编排流程执行者（主编排器），我希望所有 agents/*.md 子代理文件中引用的模板路径和 plugin 名称均为最新值，使得编排流程中读取的路径能正确定位到实际文件。

**Why this priority**: agents 中的路径引用（如 `plugins/speckitdriver/templates/...`）如果未更新，编排器在运行时将无法找到模板文件，导致流程执行失败。但由于路径在 SKILL.md 主编排器中也有映射逻辑，实际影响取决于运行时解析方式。

**Independent Test**: 在 `plugins/spec-driver/agents/` 目录下搜索 `plugins/speckitdriver/`，结果应为零匹配。所有模板路径引用应指向 `plugins/spec-driver/`。

**Acceptance Scenarios**:

1. **Given** `verify.md` 中引用 `plugins/speckitdriver/templates/verification-report-template.md`，**When** 更新路径，**Then** 变为 `plugins/spec-driver/templates/verification-report-template.md`
2. **Given** `sync.md` 中引用 `plugins/speckitdriver/agents/sync.md` 和 `plugins/speckitdriver/templates/product-spec-template.md`，**When** 更新路径，**Then** 所有路径前缀变为 `plugins/spec-driver/`
3. **Given** 12 个 agents/*.md 文件中存在 `Speckitdriver` 角色名引用，**When** 更新角色名，**Then** 所有实例变为 `Spec Driver`

---

### Edge Cases

- **旧安装标记文件残留**: 用户升级后，`~/.claude/.speckitdriver-installed` 旧标记文件仍存在，`postinstall.sh` 使用新标记 `.spec-driver-installed`，首次运行新版本时应正常显示安装成功信息（不受旧标记影响）
- **部分更新场景**: 如果更新过程中断（如只更新了部分文件），文件间引用可能不一致。应确保更新操作的原子性——所有文件在同一次变更中完成更新
- **代码块内的旧引用**: SKILL.md 和 agents/*.md 中的代码块（如 ````text` 和 ````markdown` 块）内的路径和命令引用也需要更新，不能只更新正文文本
- **正则替换的边界**: `speckitdriver` 出现在复合词中（如 `.speckitdriver-installed`）时，替换逻辑需精确匹配完整的旧值-新值对，避免部分替换导致损坏
- **历史 spec 编号保留**: `CLAUDE.md` 中 `011-speckit-driver-pro` 等历史特性编号不应被修改，它们是已完成特性的永久标识
- **spec-driver.config-template.yaml 中的注释**: 模板文件注释中如包含旧产品名 `Speckit Driver Pro`，也需更新为 `Spec Driver`

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 将 `plugins/spec-driver/.claude-plugin/plugin.json` 中的 `name` 字段从 `"speckitdriver"` 更新为 `"spec-driver"`，`version` 从 `"2.0.0"` 更新为 `"3.0.0"` — *关联: US1*
- **FR-002**: 系统 MUST 将所有 5 个 SKILL.md 文件的 frontmatter `name` 字段更新为新的技能名（`speckit-feature`、`speckit-story`、`speckit-fix`、`speckit-resume`、`speckit-sync`） — *关联: US1*
- **FR-003**: 系统 MUST 将所有 SKILL.md 文件正文中的旧命令触发格式（如 `/speckitdriver:run`）替换为新格式（如 `/spec-driver:speckit-feature`），覆盖正文和代码块 — *关联: US1*
- **FR-004**: 系统 MUST 将所有 SKILL.md 文件正文中的旧产品名（`Speckitdriver`、`Speckit Driver Pro`）替换为新产品名 `Spec Driver` — *关联: US1*
- **FR-005**: 系统 MUST 将 12 个 `agents/*.md` 文件中的旧路径前缀 `plugins/speckitdriver/` 替换为 `plugins/spec-driver/` — *关联: US4*
- **FR-006**: 系统 MUST 将 12 个 `agents/*.md` 文件中的旧角色名 `Speckitdriver` 替换为 `Spec Driver` — *关联: US4*
- **FR-007**: 系统 MUST 将 `postinstall.sh` 中的安装标记路径从 `.speckitdriver-installed` 更新为 `.spec-driver-installed`，且所有命令提示更新为新格式 — *关联: US1*
- **FR-008**: 系统 MUST 将 `postinstall.sh` 中的 `PLUGIN_NAME` 变量从 `"Speckitdriver"` 更新为 `"Spec Driver"`，`PLUGIN_VERSION` 从 `"2.0.0"` 更新为 `"3.0.0"` — *关联: US1*
- **FR-009**: 系统 MUST 将 `init-project.sh` 文件头注释中的旧产品名更新为新产品名 — *关联: US1*
- **FR-010**: 系统 MUST 将 `README.md` 中所有旧命令、旧目录结构、旧安装命令更新为新值 — *关联: US1, US3*
- **FR-011**: 系统 MUST 在 `README.md` 中新增 v3.0.0 迁移说明，包含完整的旧命令到新命令映射表 — *关联: US3*
- **FR-012**: 系统 MUST 将 `.claude/settings.json` 中的 `"speckitdriver@cc-plugin-market"` 更新为 `"spec-driver@cc-plugin-market"` — *关联: US2*
- **FR-013**: 系统 MUST 将 `CLAUDE.md` 中功能性引用（如"使用 speckitdriver 的方式"）更新为新名称，同时保留历史特性编号引用不变 — *关联: US2*
- **FR-014**: 系统 MUST 将 `spec-driver.config-template.yaml` 中的旧产品名引用更新为新名称 — *关联: US1*
- **FR-015**: 系统 MUST 将 `product-spec-template.md` 中的旧引用（如有）更新为新名称 — *关联: US1*
- **FR-016**: 系统 SHOULD 在所有 SKILL.md 中将旧路径引用 `plugins/speckitdriver/scripts/init-project.sh` 更新为 `plugins/spec-driver/scripts/init-project.sh` — *关联: US1, US4*
- **FR-017**: 系统 SHOULD 在 `sync.md` 的 SKILL.md 中将旧品牌名 `Speckit Driver Pro` 的完成报告标题更新为 `Spec Driver` — *关联: US1*

### Key Entities

- **Plugin 元数据 (plugin.json)**: 定义 plugin 的唯一标识名、版本号、描述信息，是 Claude Code Plugin Marketplace 识别和加载 plugin 的核心配置
- **SKILL 注册信息 (SKILL.md frontmatter)**: 定义技能的触发名称，直接决定用户输入的斜杠命令格式
- **安装标记文件 (~/.claude/.{name}-installed)**: 控制 postinstall 脚本是否输出首次安装提示，避免重复输出
- **Plugin 注册表 (settings.json)**: Claude Code 的全局 plugin 启用/禁用配置，key 格式为 `{name}@{source}`

### 引用变更完整映射表

| 类别 | 旧值 | 新值 | 影响文件数 |
|------|------|------|-----------|
| Plugin 名称 | `speckitdriver` | `spec-driver` | 1 (plugin.json) |
| Plugin 版本 | `2.0.0` | `3.0.0` | 2 (plugin.json, postinstall.sh) |
| 产品显示名 | `Speckitdriver` / `Speckit Driver Pro` | `Spec Driver` | ~20 |
| 命令: 完整流程 | `/speckitdriver:run` | `/spec-driver:speckit-feature` | ~10 |
| 命令: 快速需求 | `/speckitdriver:story` | `/spec-driver:speckit-story` | ~5 |
| 命令: 快速修复 | `/speckitdriver:fix` | `/spec-driver:speckit-fix` | ~5 |
| 命令: 中断恢复 | `/speckitdriver:resume` | `/spec-driver:speckit-resume` | ~5 |
| 命令: 规范聚合 | `/speckitdriver:sync` | `/spec-driver:speckit-sync` | ~5 |
| 路径前缀 | `plugins/speckitdriver/` | `plugins/spec-driver/` | ~15 |
| 安装标记 | `.speckitdriver-installed` | `.spec-driver-installed` | 1 (postinstall.sh) |
| settings.json key | `speckitdriver@cc-plugin-market` | `spec-driver@cc-plugin-market` | 1 |
| SKILL frontmatter name: run | `run` | `speckit-feature` | 1 |
| SKILL frontmatter name: story | `story` | `speckit-story` | 1 |
| SKILL frontmatter name: fix | `fix` | `speckit-fix` | 1 |
| SKILL frontmatter name: resume | `resume` | `speckit-resume` | 1 |
| SKILL frontmatter name: sync | `sync` | `speckit-sync` | 1 |
| 安装命令 | `claude plugin install speckitdriver` | `claude plugin install spec-driver` | 1 (README.md) |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在整个 `plugins/spec-driver/` 目录下执行不区分大小写的全文搜索 `speckitdriver`，返回结果为 0 匹配（排除 v3.0.0 迁移说明中对旧命令的引述）
- **SC-002**: 在整个 `plugins/spec-driver/` 目录下执行全文搜索 `Speckit Driver Pro`，返回结果为 0 匹配（排除迁移说明中的历史引述）
- **SC-003**: `.claude/settings.json` 中不包含 `speckitdriver` 字样
- **SC-004**: 所有 5 个 SKILL.md 的 frontmatter `name` 字段与其所在目录名一致（`speckit-feature`、`speckit-story`、`speckit-fix`、`speckit-resume`、`speckit-sync`）
- **SC-005**: `plugin.json` 中 `name` 为 `"spec-driver"` 且 `version` 为 `"3.0.0"`
- **SC-006**: `CLAUDE.md` 中功能性引用使用新名称 `spec-driver`，且历史特性编号（如 `011-speckit-driver-pro`）保持不变
- **SC-007**: 总计更新文件数约 25 个（23 个 plugin 内部文件 + settings.json + CLAUDE.md），总计更新引用约 110+ 处
