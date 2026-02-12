# 功能规格：CLI 全局分发与 Skill 自动注册

**功能分支**: `002-cli-global-distribution`
**创建日期**: 2026-02-12
**状态**: Draft
**输入**: 用户描述: "添加 CLI 全局分发机制，支持 npm install -g 后在任何项目中使用 /reverse-spec 系列命令"

## 用户场景与测试 *(mandatory)*

### User Story 1 - 全局安装并在其他项目中使用 (Priority: P1)

作为一名开发者，我希望通过一条 `npm install -g` 命令安装 reverse-spec，然后在任何项目目录中直接使用 `reverse-spec` CLI 和 `/reverse-spec` Claude Code skill，无需手动复制文件或配置路径。

**Why this priority**: 这是核心价值——消除跨项目使用的手动障碍。如果用户无法全局安装和调用，其他所有功能都无意义。

**Independent Test**: 在一个全新的项目目录中运行 `reverse-spec generate src/`，验证能正确生成 spec 文件。

**Acceptance Scenarios**:

1. **Given** 用户已执行 `npm install -g reverse-spec`，**When** 用户在任意 TypeScript 项目目录运行 `reverse-spec generate src/auth/`，**Then** 系统在该项目的 `specs/` 目录生成对应的 `.spec.md` 文件
2. **Given** 用户已全局安装 reverse-spec，**When** 用户在非 TypeScript 项目目录运行 `reverse-spec generate`，**Then** 系统通过纯 LLM 模式提供降级分析
3. **Given** 用户已全局安装 reverse-spec，**When** 用户运行 `reverse-spec --version`，**Then** 系统显示当前安装版本

---

### User Story 2 - Skill 自动注册到 Claude Code (Priority: P2)

作为一名 Claude Code 用户，我希望全局安装 reverse-spec 后，`/reverse-spec`、`/reverse-spec-batch`、`/reverse-spec-diff` 三个 skill 自动出现在 Claude Code 中可用，无需手动复制 SKILL.md 文件。

**Why this priority**: 这是无缝体验的关键环节——CLI 只解决命令行调用，skill 注册解决 Claude Code 内的集成。

**Independent Test**: 全局安装后打开 Claude Code，输入 `/reverse-spec` 验证 skill 被识别并可触发。

**Acceptance Scenarios**:

1. **Given** 用户执行 `npm install -g reverse-spec`，**When** 安装完成，**Then** `~/.claude/skills/` 目录下出现 `reverse-spec/SKILL.md`、`reverse-spec-batch/SKILL.md`、`reverse-spec-diff/SKILL.md` 三个文件
2. **Given** skill 已自动注册，**When** 用户在 Claude Code 中输入 `/reverse-spec src/`，**Then** skill 被正确触发并调用全局 `reverse-spec` CLI 命令
3. **Given** 用户之前已手动安装过旧版本的 skill，**When** 用户全局安装新版本，**Then** 旧版 SKILL.md 被覆盖更新，不产生重复

---

### User Story 3 - 干净卸载 (Priority: P3)

作为一名开发者，我希望卸载 reverse-spec 时自动清理所有注册的 skill 文件，不留下垃圾文件。

**Why this priority**: 良好的卸载体验是软件分发的基本礼仪，但不阻塞核心功能。

**Independent Test**: 执行 `npm uninstall -g reverse-spec` 后检查 `~/.claude/skills/` 确认相关目录已删除。

**Acceptance Scenarios**:

1. **Given** 用户已全局安装 reverse-spec 且 skill 已注册，**When** 用户执行 `npm uninstall -g reverse-spec`，**Then** `~/.claude/skills/reverse-spec/`、`~/.claude/skills/reverse-spec-batch/`、`~/.claude/skills/reverse-spec-diff/` 目录被删除
2. **Given** 用户在 `~/.claude/skills/` 中有其他非 reverse-spec 的 skill，**When** 卸载 reverse-spec，**Then** 其他 skill 不受影响

---

### User Story 4 - 本地开发向后兼容 (Priority: P3)

作为 reverse-spec 的贡献者，我希望在项目根目录内仍然可以通过 `npx tsx` 直接调用源代码进行开发和调试，不受全局 CLI 模式影响。

**Why this priority**: 保护现有开发者工作流，但对最终用户无直接影响。

**Independent Test**: 在 reverse-spec 项目根目录执行 `npx tsx -e "import { analyzeFile } from './src/core/ast-analyzer.js'; ..."`，验证仍然正常工作。

**Acceptance Scenarios**:

1. **Given** 用户在 reverse-spec 项目根目录，**When** 用户通过 `npx tsx` 直接调用 `src/` 下的模块，**Then** 功能与全局安装前完全一致
2. **Given** reverse-spec 项目的 `skills/` 目录中存在本地 SKILL.md，**When** 用户在项目内使用 Claude Code，**Then** 本地 skill 优先于全局 skill 被触发

---

### Edge Cases

- 用户在没有 `tsconfig.json` 的非 TypeScript 项目中运行 CLI 时，系统应给出清晰的提示并降级到纯 LLM 模式
- 用户没有设置 `ANTHROPIC_API_KEY` 时运行需要 LLM 的命令，系统应给出明确的错误信息
- `~/.claude/` 目录不存在时，安装脚本应自动创建 `~/.claude/skills/` 路径
- 用户以 root 权限全局安装时（`sudo npm install -g`），skill 注册路径仍应指向当前用户的 `~/.claude/skills/`
- 多版本并存：如果用户同时在项目本地和全局安装了不同版本，CLI 应报告版本信息以便调试
- Windows、macOS、Linux 三平台的 `~/.claude/` 路径差异处理

## 需求 *(mandatory)*

### 功能需求

- **FR-001**: 系统必须提供名为 `reverse-spec` 的全局 CLI 命令，支持 `generate`、`batch`、`diff` 三个子命令
- **FR-002**: `reverse-spec generate <target> [--deep]` 子命令必须对指定文件或目录执行单模块 spec 生成，输出到当前项目的 `specs/` 目录
- **FR-003**: `reverse-spec batch [--force]` 子命令必须对当前项目执行批量 spec 生成，支持断点恢复
- **FR-004**: `reverse-spec diff <spec-file> <source>` 子命令必须执行 spec 漂移检测，输出到当前项目的 `drift-logs/` 目录
- **FR-005**: `reverse-spec --version` 必须显示当前安装版本号
- **FR-006**: `reverse-spec --help` 必须显示所有子命令及其用法说明
- **FR-007**: 全局安装时（`npm install -g`）必须通过 lifecycle 脚本自动将三个 SKILL.md 文件注册到 `~/.claude/skills/` 目录
- **FR-008**: 全局卸载时（`npm uninstall -g`）必须通过 lifecycle 脚本自动清理已注册的 SKILL.md 文件
- **FR-009**: 注册到全局的 SKILL.md 必须使用 `reverse-spec` CLI 命令（而非 `npx tsx` 相对路径）调用分析流水线
- **FR-010**: CLI 命令在当前目录不包含可分析文件时，必须给出友好的错误提示
- **FR-011**: CLI 命令必须支持 `--output-dir` 选项覆盖默认输出目录
- **FR-012**: 本地 `skills/` 目录中的 SKILL.md 必须保留原有的 `npx tsx` 调用方式，确保开发环境向后兼容

### 关键实体

- **CLI 命令**: 全局入口点，解析子命令和选项，调度到对应的编排器（orchestrator）
- **Skill 注册器**: 负责将 SKILL.md 文件复制到用户全局 Claude Code skill 目录的安装/卸载脚本
- **全局 SKILL.md**: 与本地版本不同的 SKILL.md 变体，使用全局 CLI 命令而非相对路径调用
- **版本信息**: 从 package.json 读取的版本号，供 CLI 和 SKILL.md 使用

## 成功标准 *(mandatory)*

### 可衡量成果

- **SC-001**: 用户从零开始到在新项目中成功生成第一个 spec，整个流程（安装 + 运行）可在 5 分钟内完成
- **SC-002**: 全局安装后，三个 skill 在 Claude Code 中 100% 可被发现和触发
- **SC-003**: 卸载后，`~/.claude/skills/` 中的 reverse-spec 相关文件 100% 被清理
- **SC-004**: CLI 在无 `ANTHROPIC_API_KEY` 或无 `tsconfig.json` 环境下运行时，100% 给出有意义的错误信息而非崩溃
- **SC-005**: 全局安装不影响现有项目本地开发工作流——所有 148 个现有测试在全局安装后仍然全部通过
- **SC-006**: CLI 支持 macOS 和 Linux 两个主要平台（Windows 为尽力支持）

## 假设

- 用户已安装 Node.js 20.x+ 和 npm
- 用户已安装 Claude Code CLI 并可使用 skill 功能
- `~/.claude/` 是 Claude Code 在 macOS/Linux 上的标准配置目录
- npm lifecycle scripts（postinstall、preuninstall）在全局安装时正常执行
- 用户的 `$HOME` 环境变量已正确设置
