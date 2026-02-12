# Feature Specification: 项目级 Skill 初始化与自包含 Skill 架构

**Feature Branch**: `003-skill-init`
**Created**: 2026-02-10
**Status**: Draft
**Input**: 在 002-cli-global-distribution 基础上增量添加项目级 Skill 初始化命令和自包含 Skill 架构

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 项目级 Skill 安装 (Priority: P1)

用户在某个项目目录下运行 `reverse-spec init`，将 reverse-spec 系列 skill 安装到当前项目的 `.claude/skills/` 目录中。安装完成后，用户在该项目中使用 Claude Code 时可直接调用 `/reverse-spec`、`/reverse-spec-batch`、`/reverse-spec-diff` 命令，无需全局安装。

**Why this priority**: 这是本功能的核心价值——让用户可以按项目粒度控制 skill 安装，解决「只有全局安装一种方式」的痛点。即使只实现这一个故事，用户已经获得了完整的项目级 skill 使用能力。

**Independent Test**: 在任意项目中运行 `reverse-spec init`，验证 `.claude/skills/` 下出现 3 个 skill 目录，每个包含自带内联降级逻辑的 SKILL.md，且 Claude Code 能识别并调用这些 skill。

**Acceptance Scenarios**:

1. **Given** 用户在项目根目录下且 `.claude/skills/` 不存在, **When** 运行 `reverse-spec init`, **Then** 自动创建 `.claude/skills/` 并安装 3 个 skill（reverse-spec、reverse-spec-batch、reverse-spec-diff），每个 skill 目录包含内嵌降级逻辑的 SKILL.md
2. **Given** 用户已安装过 skill, **When** 再次运行 `reverse-spec init`, **Then** 覆盖更新已有 skill 文件并提示已更新
3. **Given** 安装完成, **When** 用户在 Claude Code 中输入 `/reverse-spec src/auth/`, **Then** Claude Code 能找到并执行该 skill

---

### User Story 2 - 自包含 Skill 架构 (Priority: P1)

每个安装的 SKILL.md 自包含运行所需的一切：在 bash 代码块中直接内联降级逻辑，智能寻找 `reverse-spec` 的执行方式（全局 CLI → npx → 安装提示）。这样 skill 不强依赖全局 PATH 中存在 `reverse-spec` 命令，且每个 skill 目录仅需一个 SKILL.md 文件，无需额外脚本。

**Why this priority**: 与 US1 紧密耦合。如果 SKILL.md 仍然直接硬编码 `reverse-spec` CLI 调用，项目级安装将在未全局安装的环境中失败。自包含架构是项目级安装可靠工作的前提。

**Independent Test**: 在未全局安装 reverse-spec 的项目中，通过 `reverse-spec init` 安装 skill，验证 SKILL.md 内联的降级逻辑能通过 `npx reverse-spec` 执行。

**Acceptance Scenarios**:

1. **Given** skill 已安装到项目中且 reverse-spec 已全局安装, **When** Claude Code 执行 skill, **Then** SKILL.md 内联逻辑优先调用全局 `reverse-spec` CLI
2. **Given** skill 已安装到项目中且 reverse-spec 未全局安装, **When** Claude Code 执行 skill, **Then** SKILL.md 内联逻辑降级到 `npx reverse-spec` 执行
3. **Given** skill 已安装但 reverse-spec 既未全局安装也无法通过 npx 获取, **When** Claude Code 执行 skill, **Then** 输出友好的安装提示信息并指导用户如何安装

---

### User Story 3 - 全局模式安装 (Priority: P2)

用户可通过 `reverse-spec init --global` 将 skill 安装到全局位置 `~/.claude/skills/`，效果等同于现有的 `npm install -g` 后的 postinstall 行为，但无需全局安装 npm 包本身。

**Why this priority**: 提供了除 `npm install -g` 之外的另一种全局安装途径，增加灵活性。但核心价值（项目级安装）已由 US1 覆盖。

**Independent Test**: 运行 `reverse-spec init --global`，验证 `~/.claude/skills/` 下出现 3 个 skill 目录。

**Acceptance Scenarios**:

1. **Given** `~/.claude/skills/` 不存在, **When** 运行 `reverse-spec init --global`, **Then** 创建目录并安装 3 个 skill
2. **Given** `~/.claude/skills/` 已有其他 skill, **When** 运行 `reverse-spec init --global`, **Then** 仅添加/更新 reverse-spec 系列 skill，不影响其他 skill

---

### User Story 4 - 移除已安装的 Skill (Priority: P2)

用户可通过 `reverse-spec init --remove` 移除当前项目中已安装的 skill，或通过 `reverse-spec init --remove --global` 移除全局安装的 skill。

**Why this priority**: 清理功能是安装功能的自然补充，但不阻塞核心使用流程。

**Independent Test**: 安装 skill 后运行 `reverse-spec init --remove`，验证 `.claude/skills/` 下对应目录被清理。

**Acceptance Scenarios**:

1. **Given** 项目中已安装 skill, **When** 运行 `reverse-spec init --remove`, **Then** 删除 3 个 skill 目录并输出确认信息
2. **Given** 项目中未安装任何 skill, **When** 运行 `reverse-spec init --remove`, **Then** 输出「无需清理」提示，退出码为 0
3. **Given** 全局已安装 skill, **When** 运行 `reverse-spec init --remove --global`, **Then** 清理 `~/.claude/skills/` 中的 reverse-spec skill 目录

---

### User Story 5 - postinstall 重构 (Priority: P3)

`npm install -g reverse-spec` 的 postinstall 脚本重构为调用 `init --global` 的核心逻辑，消除 postinstall.ts 和 init 命令之间的代码重复。preuninstall 脚本同理重构为调用 `--remove --global` 的核心逻辑。

**Why this priority**: 纯内部代码质量改善，对用户行为无可观察影响。可以在 US1-US4 完成后再做。

**Independent Test**: 在全局安装/卸载时验证行为不变：postinstall 仍然注册 3 个 skill，preuninstall 仍然清理 3 个 skill。

**Acceptance Scenarios**:

1. **Given** 重构后的代码, **When** 执行 `npm install -g .`, **Then** postinstall 行为与重构前完全一致（3 个 skill 注册到 `~/.claude/skills/`）
2. **Given** 重构后的代码, **When** 执行 `npm uninstall -g reverse-spec`, **Then** preuninstall 行为与重构前完全一致

---

### Edge Cases

- **内联 bash 在 Windows 上的兼容性**: SKILL.md 中的 bash 代码块在 Windows 环境下可能需要 WSL 或 Git Bash 支持
- **npx 不在 PATH 中**: 某些环境中 npx 可能不可用，内联降级逻辑应优雅处理此情况
- **目标目录只读**: 用户可能对 `.claude/skills/` 或 `~/.claude/skills/` 没有写权限，应提供友好错误信息
- **reverse-spec 版本不匹配**: 全局安装的 CLI 版本与 skill 内容版本不匹配时的行为
- **部分安装失败**: 3 个 skill 中部分安装成功部分失败时，应报告状态但不回滚已成功的安装
- **符号链接和硬链接**: `.claude/skills/` 可能是符号链接，应正确处理
- **并发运行**: 多个终端同时运行 `reverse-spec init` 不应导致文件损坏

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `reverse-spec init` 子命令 MUST 将 3 个 skill（reverse-spec、reverse-spec-batch、reverse-spec-diff）安装到当前工作目录下的 `.claude/skills/` 中
- **FR-002**: 每个安装的 skill 目录 MUST 仅包含一个 SKILL.md 文件（无需额外脚本文件）
- **FR-003**: SKILL.md 中的 bash 代码块 MUST 内联三级降级寻找策略：(1) 全局 `reverse-spec` CLI → (2) `npx reverse-spec` → (3) 友好安装提示
- **FR-004**: SKILL.md MUST 在 bash 代码块中直接内联降级逻辑来执行 CLI 命令，而非依赖外部包装脚本或硬编码全局命令
- **FR-005**: `--global` 选项 MUST 将 skill 安装到 `~/.claude/skills/` 而非当前项目目录
- **FR-006**: `--remove` 选项 MUST 删除对应位置的 reverse-spec skill 目录
- **FR-007**: `--remove` 与 `--global` MUST 可组合使用，删除全局安装的 skill
- **FR-008**: 安装过程 MUST 在目标目录不存在时自动创建
- **FR-009**: 安装过程中的单个 skill 失败 MUST NOT 阻止其他 skill 的安装
- **FR-010**: 安装完成后 MUST 输出安装摘要（成功/失败/跳过的 skill 列表）
- **FR-011**: postinstall.ts MUST 重构为调用与 `init --global` 相同的核心安装逻辑
- **FR-012**: preuninstall.ts MUST 重构为调用与 `init --remove --global` 相同的核心卸载逻辑
- **FR-013**: 现有的本地开发 `skills/` 目录（使用 `npx tsx` 调用方式）MUST NOT 受到影响
- **FR-014**: 所有用户可见的输出消息 MUST 使用中文
- **FR-015**: `reverse-spec init` MUST NOT 修改项目的 `.gitignore` 文件，是否将安装的 skill 文件纳入版本控制由用户自行决定

### Key Entities

- **Skill Pack**: 一组可安装的 skill 集合（当前包含 3 个 skill），每个 skill 仅由一个 SKILL.md 文件构成（内嵌降级逻辑）。Skill Pack 是安装和移除的最小单位集合。
- **Inline Fallback（内联降级逻辑）**: SKILL.md 中 bash 代码块内嵌的三级寻找策略，作为 skill 与实际 CLI 之间的适配层。负责智能寻找 `reverse-spec` 命令的可用执行方式，屏蔽安装方式差异。
- **Install Target（安装目标）**: skill 安装的目标位置，分为项目级（`.claude/skills/`）和全局级（`~/.claude/skills/`）两种。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 用户在任意项目中运行 `reverse-spec init` 后，在 5 秒内完成 3 个 skill 的安装，且 Claude Code 能立即识别并调用这些 skill
- **SC-002**: 未全局安装 reverse-spec 的环境中，通过 SKILL.md 内联的降级策略，skill 仍能成功执行（通过 npx），命令启动延迟不超过 10 秒
- **SC-003**: `reverse-spec init --remove` 能完全清理所有已安装的 skill 文件，不留残留文件或空目录
- **SC-004**: postinstall/preuninstall 重构后，现有的 `npm install -g` / `npm uninstall -g` 全局安装流程行为保持 100% 一致
- **SC-005**: 所有新增功能覆盖 ≥ 90% 的单元测试和集成测试用例
- **SC-006**: 现有的 175 个测试用例全部通过，无回归

## Clarifications

### Session 2026-02-12

- Q: 项目级安装的 skill 文件应如何处理 Git 版本控制？ → A: 不干预——`init` 仅安装文件，不修改 `.gitignore`，由用户自行决定版本控制策略
- Q: SKILL.md 中如何调用 reverse-spec CLI（独立包装脚本 / 预处理语法 / 内联）？ → A: 在 SKILL.md 的 bash 代码块中直接内联降级逻辑，无需额外脚本文件

## Assumptions

- Claude Code 的 skill 系统支持在 SKILL.md 中通过 bash 代码块执行命令
- 目标用户环境中 Node.js ≥ 20.x 已安装（提供 npx 能力）
- `.claude/skills/` 是 Claude Code 识别项目级 skill 的标准目录路径
- `~/.claude/skills/` 是 Claude Code 识别全局 skill 的标准目录路径
- SKILL.md 中的 bash 代码块在 macOS/Linux 环境下运行，Windows 支持作为后续增强考虑但不在本期范围内
