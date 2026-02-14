# Tasks: 重构为 Claude Code Plugin Marketplace 架构

**Input**: Design documents from `specs/009-plugin-marketplace/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/marketplace-structure.md, contracts/mcp-server.md, quickstart.md

**Tests**: 不新增测试文件。在 Polish 阶段验证全量测试和构建通过。

**Organization**: 4 个 User Story（P1-P4），按优先级分阶段实施。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 安装新依赖，更新 package.json 配置

- [x] T001 安装 `@modelcontextprotocol/sdk` 运行时依赖：`npm install @modelcontextprotocol/sdk`
- [x] T002 更新 `package.json` 的 `files` 字段，在数组中添加 `"plugins/"` 条目，确保 npm publish 时包含 plugin 资产

**Checkpoint**: 依赖安装完毕，package.json 已更新

---

## Phase 2: User Story 1 - 项目具备 Marketplace 基础结构 (Priority: P1)

**Goal**: 在仓库根目录创建 `.claude-plugin/marketplace.json` 和 `plugins/reverse-spec/` 目录骨架

**Independent Test**: 检查 `.claude-plugin/marketplace.json` 存在且格式正确，plugins 数组包含 reverse-spec 条目

- [x] T003 [US1] 创建 `.claude-plugin/marketplace.json` 文件，内容按 `contracts/marketplace-structure.md` 第 1 节规范填写（name: `cc-plugin-market`, owner, metadata, plugins 数组含 reverse-spec 条目指向 `./plugins/reverse-spec`）
- [x] T004 [P] [US1] 创建 `plugins/reverse-spec/` 目录结构骨架：`plugins/reverse-spec/skills/reverse-spec/`、`plugins/reverse-spec/skills/reverse-spec-batch/`、`plugins/reverse-spec/skills/reverse-spec-diff/`、`plugins/reverse-spec/hooks/`、`plugins/reverse-spec/scripts/`（空目录，后续阶段填充内容）
- [x] T005 [US1] 更新 `.gitignore`：确保 `.claude-plugin/` 和 `plugins/` 目录不被忽略（如有必要添加注释说明）

**Checkpoint**: marketplace.json 有效，plugins/reverse-spec/ 目录结构就绪

---

## Phase 3: User Story 2 - reverse-spec 封装为标准 Claude Code Plugin (Priority: P2)

**Goal**: 在 `plugins/reverse-spec/` 中创建完整的 plugin 资产（plugin.json + skills + hooks + .mcp.json）

**Independent Test**: 验证 plugin.json 包含所有必需字段，skills/ 包含 3 个 SKILL.md，.mcp.json 和 hooks.json 格式正确

### Plugin Manifest 和配置文件

- [x] T006 [US2] 创建 `plugins/reverse-spec/plugin.json`，内容按 `contracts/marketplace-structure.md` 第 2 节规范填写（name: `reverse-spec`, version: `2.0.0`, description, author, mcpServers 指向 `./.mcp.json`, hooks 指向 `./hooks/hooks.json`）
- [x] T007 [P] [US2] 创建 `plugins/reverse-spec/.mcp.json`，内容按 `contracts/marketplace-structure.md` 第 4 节规范填写（mcpServers.reverse-spec: command `npx`, args `["reverse-spec", "mcp-server"]`, cwd `${CLAUDE_PLUGIN_ROOT}`）
- [x] T008 [P] [US2] 创建 `plugins/reverse-spec/hooks/hooks.json`，内容按 `contracts/marketplace-structure.md` 第 5 节规范填写（SessionStart hook 调用 `${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh`）
- [x] T009 [P] [US2] 创建 `plugins/reverse-spec/scripts/postinstall.sh`：编写 bash 脚本检查 `reverse-spec` CLI 是否可用，不可用时提示通过 `npx` 使用。添加执行权限（`chmod +x`）

### Skill 文件迁移

- [x] T010 [P] [US2] 将 `src/skills-global/reverse-spec/SKILL.md` 复制到 `plugins/reverse-spec/skills/reverse-spec/SKILL.md`（内容完全一致）
- [x] T011 [P] [US2] 将 `src/skills-global/reverse-spec-batch/SKILL.md` 复制到 `plugins/reverse-spec/skills/reverse-spec-batch/SKILL.md`（内容完全一致）
- [x] T012 [P] [US2] 将 `src/skills-global/reverse-spec-diff/SKILL.md` 复制到 `plugins/reverse-spec/skills/reverse-spec-diff/SKILL.md`（内容完全一致）

**Checkpoint**: plugin 目录包含完整的 plugin.json、3 个 SKILL.md、.mcp.json、hooks.json、postinstall.sh

---

## Phase 4: User Story 3 - reverse-spec CLI 作为 MCP Server 暴露工具能力 (Priority: P3)

**Goal**: 实现 MCP stdio server，注册 prepare/generate/batch/diff 四个工具，通过 `reverse-spec mcp-server` 子命令启动

**Independent Test**: 运行 `node dist/cli/index.js mcp-server`，发送 `initialize` 和 `tools/list` JSON-RPC 请求，验证返回 4 个工具定义

### MCP Server 实现

- [x] T013 [US3] 创建 `src/mcp/server.ts`：使用 `@modelcontextprotocol/sdk` 的 `McpServer` 类创建 server 实例（name: `reverse-spec`, version 从 package.json 读取），注册 4 个工具（`prepare`、`generate`、`batch`、`diff`），每个工具的 inputSchema 和 handler 按 `contracts/mcp-server.md` 第 2 节定义实现。handler 调用现有核心函数（`prepareContext`、`generateSpec`、`runBatch`、`detectDrift`），错误处理返回 `{ isError: true }`
- [x] T014 [US3] 创建 `src/mcp/index.ts`：作为 MCP server 的 stdio 入口，导入 `server.ts` 的 server 实例，使用 `StdioServerTransport` 连接，启动日志写入 stderr（不可写 stdout）

### CLI 子命令集成

- [x] T015 [US3] 修改 `src/cli/utils/parse-args.ts`：在 `subcommand` 类型联合中添加 `'mcp-server'`，在解析逻辑中处理 `mcp-server` 子命令（无额外参数）
- [x] T016 [US3] 创建 `src/cli/commands/mcp-server.ts`：导出 `runMcpServer()` 函数，调用 `src/mcp/index.ts` 的启动逻辑
- [x] T017 [US3] 修改 `src/cli/index.ts`：在命令路由 switch 中添加 `case 'mcp-server'`，调用 `runMcpServer()`

**Checkpoint**: `reverse-spec mcp-server` 子命令可用，MCP 协议握手和工具列表查询正常响应

---

## Phase 5: User Story 4 - 用户可通过 Marketplace 安装 Plugin (Priority: P4)

**Goal**: 提供安装文档，说明从 marketplace 安装 reverse-spec plugin 的完整流程

**Independent Test**: README 或安装文档中包含清晰的 marketplace 添加和 plugin 安装步骤

- [x] T018 [US4] 在 `plugins/reverse-spec/` 目录创建 `README.md`：包含 plugin 简介、功能列表（3 个 skill + MCP server）、安装方式（marketplace 安装 + npm 全局安装两种方式）、使用示例、配置说明

**Checkpoint**: 安装文档完整，用户可按文档完成端到端安装

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 确保所有改动不破坏现有功能，全量测试和构建通过

- [x] T019 运行 `npm run build` 确认 TypeScript 编译通过（含新增 `src/mcp/` 文件）
- [x] T020 运行 `npm run lint` 确认无类型错误
- [x] T021 运行 `npm test` 确认全部现有测试通过
- [x] T022 运行 quickstart.md 场景 1 验证：检查 `.claude-plugin/marketplace.json` 格式正确
- [x] T023 运行 quickstart.md 场景 2 验证：检查 `plugins/reverse-spec/plugin.json` 和 skills/ 文件完整
- [x] T024 运行 quickstart.md 场景 3 验证：启动 MCP server，发送 `initialize` + `tools/list` 请求，确认返回 4 个工具
- [x] T025 运行 quickstart.md 场景 4 验证：确认 `reverse-spec --version` 和 `reverse-spec --help` 仍正常工作

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **US1 (Phase 2)**: 依赖 Phase 1 完成（package.json 更新）
- **US2 (Phase 3)**: 依赖 US1 完成（plugins/ 目录结构就绪）
- **US3 (Phase 4)**: 依赖 Phase 1 完成（@modelcontextprotocol/sdk 已安装）；与 US2 无依赖，可并行
- **US4 (Phase 5)**: 依赖 US2 和 US3 完成（需要 plugin 和 MCP server 都就绪才能写完整文档）
- **Polish (Phase 6)**: 依赖全部 User Story 完成

### User Story Dependencies

- **US1 (P1)**: 基础结构 → 无外部依赖，是 US2 的前置
- **US2 (P2)**: Plugin 封装 → 依赖 US1（目录结构）
- **US3 (P3)**: MCP Server → 依赖 Phase 1（SDK 依赖）；与 US2 独立，可并行
- **US4 (P4)**: 安装文档 → 依赖 US2 + US3（需要完整 plugin 才能写文档）

### Parallel Opportunities

- T004 和 T005 可并行（不同文件）
- T007、T008、T009、T010、T011、T012 全部可并行（不同文件）
- US2 和 US3 可并行（US2 处理 plugin 资产，US3 处理 MCP server 代码）
- T019、T020、T021 可并行（不同命令）
- T022、T023、T024、T025 可并行（不同验证场景）

---

## Parallel Example: User Story 2

```bash
# 在 T006 完成后，以下任务全部可并行：
Task: "创建 plugins/reverse-spec/.mcp.json"          # T007
Task: "创建 plugins/reverse-spec/hooks/hooks.json"    # T008
Task: "创建 plugins/reverse-spec/scripts/postinstall.sh" # T009
Task: "复制 reverse-spec SKILL.md"                     # T010
Task: "复制 reverse-spec-batch SKILL.md"               # T011
Task: "复制 reverse-spec-diff SKILL.md"                # T012
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup（安装依赖）
2. Complete Phase 2: US1（marketplace 结构）
3. **STOP and VALIDATE**: 检查 marketplace.json 格式正确

### Incremental Delivery

1. Setup → US1 → marketplace 结构可验证
2. US2 → plugin 资产完整可验证
3. US3 → MCP server 可启动可验证（可与 US2 并行）
4. US4 → 安装文档完整
5. Polish → 全量验证通过

---

## Notes

- 总计 25 个任务（Setup: 2 + US1: 3 + US2: 7 + US3: 5 + US4: 1 + Polish: 7）
- US2 和 US3 可并行执行（分别处理 plugin 资产和 MCP server 代码）
- SKILL.md 复制任务（T010-T012）保持与 `src/skills-global/` 完全一致，不做内容修改
- MCP server 实现（T013-T014）使用 `@modelcontextprotocol/sdk` 的 `McpServer` + `StdioServerTransport`
- stdout 纯净性是 MCP server 的关键约束：所有日志必须写入 stderr
