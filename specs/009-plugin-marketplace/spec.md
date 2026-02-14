# Feature Specification: 重构为 Claude Code Plugin Marketplace 架构

**Feature Branch**: `009-plugin-marketplace`
**Created**: 2026-02-14
**Status**: Draft
**Input**: 将 reverse-spec 项目重构为 Claude Code Plugin Marketplace 架构：1) 项目整体变为 plugin marketplace，包含 .claude-plugin/marketplace.json，可容纳多个 plugin；2) 将现有 reverse-spec 功能（CLI + Skills）封装为第一个 Claude Code Plugin，遵循官方 plugin 规范（.claude-plugin/plugin.json + skills/ + hooks/ + .mcp.json）；3) 保留现有 npm CLI 能力作为 MCP stdio server 的后端；4) 新增 marketplace 分发能力，用户可通过 /plugin marketplace add 和 /plugin install 安装

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 项目具备 Marketplace 基础结构 (Priority: P1)

作为项目维护者，我希望将当前 reverse-spec 仓库转变为一个 Claude Code Plugin Marketplace，使仓库根目录包含 `.claude-plugin/marketplace.json` 清单文件，能够声明和管理多个 plugin。这样我就有了一个统一的分发平台，未来可以持续添加新的 Claude Code Plugin。

**Why this priority**: Marketplace 是整个架构的根基。没有 marketplace.json 和对应的目录结构，后续的 plugin 封装和分发都无法进行。这是所有其他 User Story 的前置条件。

**Independent Test**: 在仓库根目录检查 `.claude-plugin/marketplace.json` 文件存在且格式正确（包含 `name`、`owner`、`plugins` 数组），且 plugins 数组中至少包含一个 reverse-spec plugin 条目。

**Acceptance Scenarios**:

1. **Given** 仓库根目录，**When** 检查 `.claude-plugin/marketplace.json`，**Then** 文件存在且包含合法的 marketplace 声明（name、owner、metadata、plugins 数组）
2. **Given** marketplace.json 的 plugins 数组，**When** 查看条目，**Then** 包含 reverse-spec plugin 的条目，指向 `plugins/reverse-spec/` 子目录
3. **Given** 仓库根目录，**When** 检查 `plugins/` 目录结构，**Then** 存在 `plugins/reverse-spec/` 子目录，作为第一个 plugin 的根目录

---

### User Story 2 - reverse-spec 封装为标准 Claude Code Plugin (Priority: P2)

作为 Claude Code 用户，我希望 reverse-spec 的所有能力（generate、batch、diff 三个 skill + CLI 工具链）被封装为一个标准的 Claude Code Plugin，遵循官方 plugin 规范（plugin.json + skills/ + hooks/）。这样我可以通过 Claude Code 的原生 plugin 安装机制来使用 reverse-spec，而不是手动 npm 安装。

**Why this priority**: 这是核心功能迁移——将现有的 skill 和 CLI 能力从当前的自定义安装方式迁移到官方 plugin 架构。Marketplace 结构（P1）就绪后，这是最核心的价值交付。

**Independent Test**: 在 `plugins/reverse-spec/` 目录中检查 `plugin.json` 格式正确，`skills/` 目录包含三个 skill SKILL.md 文件，且 plugin.json 中正确声明了 skills、hooks 和 mcpServers。

**Acceptance Scenarios**:

1. **Given** `plugins/reverse-spec/plugin.json`，**When** 验证其结构，**Then** 包含 `name: "reverse-spec"`、`version`、`description`、`author` 字段，以及 `skills`、`hooks`、`mcpServers` 声明
2. **Given** `plugins/reverse-spec/skills/` 目录，**When** 列出内容，**Then** 包含 `reverse-spec/SKILL.md`、`reverse-spec-batch/SKILL.md`、`reverse-spec-diff/SKILL.md` 三个 skill 文件
3. **Given** plugin.json 中的 hooks 声明，**When** 检查 postinstall hook，**Then** 存在一个 postinstall hook 用于在安装时完成必要初始化（如依赖安装）
4. **Given** plugin.json 中的 mcpServers 声明，**When** 检查 MCP server 配置，**Then** 声明了一个 stdio 类型的 MCP server，command 指向 reverse-spec CLI

---

### User Story 3 - reverse-spec CLI 作为 MCP Server 暴露工具能力 (Priority: P3)

作为 Claude Code 中的 AI 助手，我希望能通过 MCP（Model Context Protocol）调用 reverse-spec 的 prepare、generate、batch、diff 等工具，而不仅仅依赖 Skill 中的 bash 命令执行。这样 AI 助手可以获得结构化的工具输入输出，提升准确性和可靠性。

**Why this priority**: MCP Server 是 plugin 能力的深层集成。Skill 提供了用户触发的工作流，而 MCP Server 让 AI 助手能够以程序化方式调用工具。这是提升 plugin 使用体验的重要增强，但不是核心功能的前提。

**Independent Test**: 启动 reverse-spec 的 MCP stdio server，通过 MCP 协议发送 `tools/list` 请求，验证返回包含 `prepare`、`generate`、`batch`、`diff` 四个工具定义。

**Acceptance Scenarios**:

1. **Given** reverse-spec CLI 以 `mcp-server` 子命令启动，**When** 发送 MCP `initialize` 请求，**Then** 返回正确的 MCP 协议握手响应
2. **Given** MCP server 已初始化，**When** 发送 `tools/list` 请求，**Then** 返回至少包含 `prepare`、`generate`、`batch`、`diff` 四个工具的列表，每个工具包含 name、description 和 inputSchema
3. **Given** MCP server 已初始化，**When** 通过 `tools/call` 调用 `prepare` 工具并传入有效的目标路径，**Then** 返回该模块的 AST 骨架 JSON 数据

---

### User Story 4 - 用户可通过 Marketplace 安装 Plugin (Priority: P4)

作为 Claude Code 终端用户，我希望能通过标准的 marketplace 安装流程来安装 reverse-spec plugin。具体来说，先将 marketplace 仓库添加为源，再从中选择并安装 plugin。安装完成后，`/reverse-spec` 等 skill 命令立即可用。

**Why this priority**: 分发和安装是 marketplace 的最终用户体验。虽然对功能本身不是必需的（P2 已经可以手动复制 plugin 目录使用），但这是 marketplace 架构的完整闭环。

**Independent Test**: 在一个全新的项目中，依次运行 marketplace 添加和 plugin 安装命令，验证 `/reverse-spec` skill 命令可用且能正常执行。

**Acceptance Scenarios**:

1. **Given** 一个全新的项目目录，**When** 用户运行 marketplace 添加命令指向本仓库 URL，**Then** 仓库被注册为 marketplace 源
2. **Given** marketplace 已添加，**When** 用户运行 plugin 安装命令选择 reverse-spec，**Then** plugin 文件被复制到项目的 `.claude/plugins/reverse-spec/` 目录
3. **Given** plugin 已安装，**When** 用户在 Claude Code 中输入 `/reverse-spec`，**Then** skill 被正确识别并执行

---

### Edge Cases

- 当用户在没有 Node.js 环境的机器上安装 plugin 时，MCP server 无法启动——skill 应仍然可用（降级为纯 skill 模式，通过 bash 调用 npx）
- 当 marketplace.json 中 plugin 版本与已安装版本相同时，安装命令应提示"已是最新版"而非重复安装
- 当用户同时安装了旧版 npm 全局 reverse-spec 和新版 plugin reverse-spec 时，plugin 版本应优先
- 当 plugin.json 中声明的 skill 文件缺失时，应给出清晰的错误提示而非静默忽略
- 当 marketplace 仓库不可达（网络问题）时，应缓存上次成功获取的 plugin 列表

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 在仓库根目录维护 `.claude-plugin/marketplace.json` 文件，遵循 Claude Code Marketplace 规范，包含 `name`、`owner`、`plugins` 数组
- **FR-002**: 系统 MUST 将所有 plugin 源码组织在 `plugins/<plugin-name>/` 子目录下，每个 plugin 目录自包含其所有资源
- **FR-003**: 系统 MUST 为 reverse-spec plugin 提供符合官方规范的 `plugin.json`，包含 `name`、`version`、`description`、`author`、`skills`、`hooks`、`mcpServers` 声明
- **FR-004**: 系统 MUST 将现有三个 skill（reverse-spec、reverse-spec-batch、reverse-spec-diff）的 SKILL.md 文件迁移到 plugin 的 `skills/` 目录下
- **FR-005**: 系统 MUST 保留现有 npm CLI 发布能力（`reverse-spec` 命令行工具），使其既可独立使用也可作为 MCP server 后端
- **FR-006**: 系统 MUST 为 reverse-spec CLI 新增 `mcp-server` 子命令，启动 MCP stdio server
- **FR-007**: MCP server MUST 暴露至少 `prepare`、`generate`、`batch`、`diff` 四个工具，每个工具包含符合 JSON Schema 的 inputSchema
- **FR-008**: plugin.json 中的 `mcpServers` MUST 声明一个 stdio 类型的 MCP server，command 指向 `npx reverse-spec mcp-server`
- **FR-009**: 系统 MUST 提供 postinstall hook，在 plugin 安装时自动执行必要的初始化步骤（如检查 Node.js 环境、安装 npm 依赖）
- **FR-010**: 系统 MUST 提供 marketplace 安装文档，说明用户如何通过标准流程将 plugin 安装到目标项目
- **FR-011**: 系统 MUST 将现有的 `src/installer/` 模块（postinstall/preuninstall 脚本、skill 安装逻辑）迁移为 plugin hooks，保持安装行为一致

### Key Entities

- **Marketplace**: 仓库级别的 plugin 集合声明，包含名称、所有者、plugin 列表
- **Plugin**: 一个自包含的 Claude Code 扩展单元，包含 skill、hook、MCP server 等组件
- **Skill**: plugin 中用户可调用的工作流定义（SKILL.md 文件）
- **Hook**: plugin 生命周期事件的处理脚本（如 postinstall、preuninstall）
- **MCP Server**: plugin 暴露给 AI 助手的工具集合，通过 Model Context Protocol 通信

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 仓库包含合法的 `.claude-plugin/marketplace.json`，可被 Claude Code 识别为 marketplace 源
- **SC-002**: `plugins/reverse-spec/plugin.json` 通过 Claude Code 的 plugin 验证，包含完整的 skill、hook、MCP server 声明
- **SC-003**: 现有三个 skill 的功能在 plugin 架构下完全等价——用户使用 `/reverse-spec`、`/reverse-spec-batch`、`/reverse-spec-diff` 的体验不变
- **SC-004**: MCP server 正确响应 `tools/list` 和 `tools/call` 请求，返回结构化数据
- **SC-005**: 从全新项目安装 reverse-spec plugin 的端到端流程可在 5 分钟内完成
- **SC-006**: 现有 npm CLI 命令（`reverse-spec prepare/generate/batch/diff`）在重构后仍然正常工作
- **SC-007**: 所有现有测试在重构后仍然通过

## Assumptions

- Claude Code 的 plugin 系统已支持 `plugin.json`、skills/、hooks/、mcpServers 等标准组件
- MCP stdio server 通过 stdin/stdout 与 Claude Code 通信，使用 JSON-RPC 协议
- marketplace.json 遵循 Claude Code 官方规范，plugins 数组中的 source 字段指向 plugin 子目录的相对路径
- 现有 npm 包发布流程（`npm publish`）保持不变，plugin 安装方式是新增的分发渠道而非替代
- 用户的 Claude Code 版本支持 plugin marketplace 功能

## Scope Boundaries

### In Scope

- 创建 marketplace.json 和 plugins/ 目录结构
- 将现有 skill（3 个 SKILL.md）迁移到 plugin 目录
- 创建 plugin.json 声明文件
- 将现有 installer 逻辑（postinstall/preuninstall）转换为 plugin hooks
- 新增 MCP stdio server 子命令
- 实现 MCP server 的 tool 注册和调用逻辑（prepare、generate、batch、diff）
- 更新 package.json 的 files 字段以包含新的 plugin 目录
- 提供安装文档和使用说明

### Out of Scope

- 实现 Claude Code 端的 marketplace 添加/安装命令（这是 Claude Code 本身的功能）
- 开发第二个 plugin（marketplace 结构支持多 plugin，但本次只迁移 reverse-spec）
- 实现 plugin 的自动版本更新机制
- 实现 plugin 签名或安全验证
- 修改 reverse-spec 的核心算法逻辑（AST 分析、LLM 调用等）
- Web UI 或 GUI 管理界面
