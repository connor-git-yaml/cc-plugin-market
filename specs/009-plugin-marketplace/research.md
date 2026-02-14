# Research: 重构为 Claude Code Plugin Marketplace 架构

**Feature Branch**: `009-plugin-marketplace`
**Date**: 2026-02-14

---

## 研究主题总览

| # | 主题 | 状态 | 决策 |
|---|------|------|------|
| R1 | Claude Code Plugin 目录结构与 plugin.json schema | 已解决 | 采用官方规范，plugin 根目录包含 skills/、hooks/、.mcp.json |
| R2 | marketplace.json schema 与分发机制 | 已解决 | 仓库根目录 `.claude-plugin/marketplace.json`，plugins 数组引用子目录 |
| R3 | MCP stdio server 实现方案 | 已解决 | 使用 `@modelcontextprotocol/sdk` 的 `McpServer` + `StdioServerTransport` |
| R4 | 现有 installer 到 plugin hooks 的迁移策略 | 已解决 | 保留 npm postinstall 能力 + 新增 plugin hooks 双通道 |
| R5 | Skill 文件双源问题（模板常量 vs 物理文件） | 已解决 | plugin 模式下仅使用物理 SKILL.md 文件，模板常量保留用于 npm 全局安装 |
| R6 | 项目目录重组策略 | 已解决 | 新增 `plugins/reverse-spec/` 目录；src/ 保持不变 |

---

## R1: Claude Code Plugin 目录结构与 plugin.json Schema

### 决策

采用 Claude Code 官方 plugin 规范。每个 plugin 是一个独立目录，包含 `plugin.json` manifest 和组件子目录。

### 核心发现

**plugin.json 字段**（唯一必填字段是 `name`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | kebab-case，无空格，最长 64 字符 |
| `version` | string | 否 | semver 格式 |
| `description` | string | 否 | 功能描述 |
| `author` | object | 否 | `{ name, email, url }` |
| `skills` | string/array | 否 | skill 目录路径，补充默认 `skills/` |
| `hooks` | string/object | 否 | hooks 配置路径或内联 JSON |
| `mcpServers` | string/object | 否 | MCP server 配置路径或内联 JSON |
| `homepage` | string | 否 | 文档链接 |
| `repository` | string | 否 | Git 仓库 URL |
| `license` | string | 否 | SPDX 标识符 |
| `keywords` | array | 否 | 搜索关键字 |

**plugin 目录结构**：

```
plugins/reverse-spec/
├── plugin.json               # manifest（必须）
├── skills/                   # skill 目录（默认位置，自动发现）
│   ├── reverse-spec/
│   │   └── SKILL.md
│   ├── reverse-spec-batch/
│   │   └── SKILL.md
│   └── reverse-spec-diff/
│       └── SKILL.md
├── hooks/
│   └── hooks.json            # hook 配置
├── scripts/
│   ├── postinstall.sh        # 安装后脚本
│   └── preuninstall.sh       # 卸载前脚本
└── .mcp.json                 # MCP server 声明
```

**关键约束**：
- 路径必须以 `./` 开头，相对于 plugin 根目录
- 使用 `${CLAUDE_PLUGIN_ROOT}` 引用 plugin 安装后的绝对路径
- 自定义路径**补充**默认目录，不替代

### 替代方案

- ~~将 plugin.json 放在 `.claude-plugin/` 内~~ — 不符合规范，`.claude-plugin/` 仅在 marketplace 仓库根目录层使用
- ~~使用 package.json 替代 plugin.json~~ — Claude Code 不读取 package.json 作为 plugin manifest

---

## R2: marketplace.json Schema 与分发机制

### 决策

在仓库根目录创建 `.claude-plugin/marketplace.json`，使用相对路径 `source` 指向 `plugins/` 子目录。

### 核心发现

**marketplace.json 结构**：

```json
{
  "name": "cc-plugin-market",
  "owner": {
    "name": "Connor Lu"
  },
  "metadata": {
    "description": "Claude Code Plugin Marketplace — 多 plugin 集合仓库",
    "version": "1.0.0",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "reverse-spec",
      "source": "./plugins/reverse-spec",
      "description": "通过 AST 静态分析 + LLM 混合流水线逆向生成 Spec 文档",
      "version": "2.0.0",
      "category": "documentation",
      "tags": ["spec", "ast", "reverse-engineering", "documentation"]
    }
  ]
}
```

**安装流程**（Claude Code 端实现，Out of Scope 但需了解）：

1. 用户执行：`/plugin marketplace add <repo-url>`
2. Claude Code 克隆仓库，解析 `.claude-plugin/marketplace.json`
3. 用户执行：`/plugin install reverse-spec`
4. Claude Code 复制 `plugins/reverse-spec/` 到目标项目的 `.claude/plugins/reverse-spec/`
5. Claude Code 解析 `plugin.json`，注册 skills、启动 MCP servers、注册 hooks

**source 类型**：
- 相对路径（本次使用）：`"./plugins/reverse-spec"`
- GitHub：`{ "source": "github", "repo": "owner/repo" }`
- Git URL：`{ "source": "url", "url": "https://..." }`

### 替代方案

- ~~每个 plugin 独立仓库~~ — 增加管理复杂度，不适合初期只有一个 plugin 的情况
- ~~marketplace.json 放在仓库根目录（不在 .claude-plugin/ 内）~~ — 不符合官方规范

---

## R3: MCP stdio Server 实现方案

### 决策

使用 `@modelcontextprotocol/sdk` 官方 SDK，创建 `src/mcp/` 模块，通过 `McpServer` + `StdioServerTransport` 实现。CLI 新增 `mcp-server` 子命令作为入口。

### 核心发现

**依赖**：
- `@modelcontextprotocol/sdk` (v1.26.0)：官方 TypeScript SDK
- `zod`（已有依赖）：用于定义 tool inputSchema

**Server 创建模式**：

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "reverse-spec",
  version: "2.0.0",
});

// 注册工具
server.registerTool("prepare", {
  description: "AST 预处理 + 上下文组装",
  inputSchema: {
    targetPath: z.string().describe("目标文件或目录路径"),
    deep: z.boolean().optional().describe("深度分析"),
  },
}, async ({ targetPath, deep }) => {
  const result = await prepareContext(targetPath, { deep });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

// 启动
const transport = new StdioServerTransport();
await server.connect(transport);
```

**关键陷阱**：
- **stdout 禁止非协议输出**：stdio transport 中 stdout 仅用于 JSON-RPC。所有日志必须写入 stderr。现有代码中的 `console.log()` 不会影响 MCP server，因为 MCP 子命令有独立入口，不走 CLI 的输出路径。
- **错误处理**：工具执行错误应返回 `{ content: [...], isError: true }`，不应抛出 JSON-RPC protocol error。
- **工具名约束**：仅允许 A-Z、a-z、0-9、`_`、`-`、`.`，1-128 字符。

**Plugin 中声明 MCP server**（`.mcp.json`）：

```json
{
  "mcpServers": {
    "reverse-spec": {
      "command": "npx",
      "args": ["reverse-spec", "mcp-server"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

### 替代方案

- ~~FastMCP 框架~~ — 额外依赖，官方 SDK 已足够简洁
- ~~直接实现 JSON-RPC 协议~~ — 不必要的低层实现，SDK 已封装
- ~~HTTP SSE transport~~ — plugin 场景使用 stdio 即可，HTTP 适用于远程服务

### 风险

- `@modelcontextprotocol/sdk` 是新增运行时依赖，违反 Constitution V（纯 Node.js 生态 + 核心库限定）。但 MCP SDK 是纯 Node.js npm 包，且是 Claude Code 官方生态的一部分，需要在 Complexity Tracking 中记录此偏差。

---

## R4: 现有 Installer 到 Plugin Hooks 的迁移策略

### 决策

保留 npm 发布通道的 postinstall/preuninstall 脚本（向后兼容），同时在 plugin 目录新增 hooks 配置，实现双通道安装。

### 核心发现

**当前安装流程**：
1. `npm install -g reverse-spec` 触发 `dist/scripts/postinstall.js`
2. postinstall 将 3 个 SKILL.md 写入 `~/.claude/skills/`
3. `npm uninstall -g reverse-spec` 触发 preuninstall 清理

**Plugin 安装流程**（新增）：
1. 用户通过 marketplace 安装 plugin
2. Claude Code 复制 plugin 目录到 `.claude/plugins/reverse-spec/`
3. Claude Code 读取 `plugin.json`，自动发现 `skills/` 目录中的 SKILL.md
4. 如有 hooks，执行 postinstall hook（如 `npm install` 安装 CLI 依赖）

**hooks.json 配置**：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh"
          }
        ]
      }
    ]
  }
}
```

注意：Claude Code plugin hooks 不支持独立的 "postinstall" 生命周期事件。最接近的是 `SessionStart` hook，在每次会话开始时检查依赖状态。或者依赖 plugin 的 MCP server 配置来自动启动 npx。

### 替代方案

- ~~完全废弃 npm 安装通道~~ — 破坏现有用户的工作流
- ~~将 CLI 依赖内嵌到 plugin 目录~~ — 增加仓库体积，违反关注点分离

---

## R5: Skill 文件双源问题

### 决策

**Plugin 模式**使用 `plugins/reverse-spec/skills/` 目录下的物理 SKILL.md 文件。**npm 全局安装模式**继续使用 `src/installer/skill-templates.ts` 中的常量模板。两套 SKILL.md 内容必须保持同步。

### 核心发现

**当前状态**：
- `src/skills-global/reverse-spec/SKILL.md` — 物理文件，npm publish 时包含
- `src/installer/skill-templates.ts` — 相同内容以常量形式嵌入（用于 postinstall 写入）

**Plugin 模式下**：
- `plugins/reverse-spec/skills/reverse-spec/SKILL.md` — plugin 目录的物理文件
- Claude Code 自动发现 `skills/` 目录，无需运行安装脚本

**同步策略**：
- Plugin 模式的 SKILL.md 从 `src/skills-global/` 复制（构建时或手动同步）
- 长期目标：单一源头（plugin 目录），npm 安装时从 plugin 目录读取

### 替代方案

- ~~只保留模板常量，plugin 目录不放 SKILL.md~~ — 违反 plugin 规范，skills/ 目录必须包含 SKILL.md
- ~~彻底移除模板常量~~ — 破坏 npm 全局安装流程

---

## R6: 项目目录重组策略

### 决策

在仓库根目录新增 `plugins/reverse-spec/` 目录存放 plugin 资产。`src/` 目录结构保持不变。新增 `src/mcp/` 目录存放 MCP server 实现。

### 核心发现

**新增目录结构**：

```
reverse-spec/                       # 仓库根目录（即 marketplace）
├── .claude-plugin/
│   └── marketplace.json            # marketplace 清单
├── plugins/
│   └── reverse-spec/               # 第一个 plugin
│       ├── plugin.json             # plugin manifest
│       ├── skills/                 # 3 个 skill SKILL.md
│       │   ├── reverse-spec/
│       │   ├── reverse-spec-batch/
│       │   └── reverse-spec-diff/
│       ├── hooks/
│       │   └── hooks.json
│       ├── scripts/
│       │   └── postinstall.sh
│       └── .mcp.json               # MCP server 声明
├── src/                            # 保持不变
│   ├── mcp/                        # 新增：MCP server 实现
│   │   ├── server.ts               # McpServer 初始化 + tool 注册
│   │   └── index.ts                # stdio server 入口
│   ├── cli/                        # 保持不变（新增 mcp-server 子命令路由）
│   ├── core/                       # 保持不变
│   ├── batch/                      # 保持不变
│   ├── diff/                       # 保持不变
│   └── ...
└── package.json                    # 更新 files 字段
```

**不变的部分**：
- 所有 `src/` 下的核心业务逻辑模块
- 测试目录结构
- npm 发布流程
- CLI 入口和大部分命令

**变更的部分**：
- 新增 `.claude-plugin/marketplace.json`
- 新增 `plugins/reverse-spec/` 目录及内容
- 新增 `src/mcp/` 目录（2 个文件）
- `src/cli/index.ts` 添加 `mcp-server` 子命令路由
- `src/cli/utils/parse-args.ts` 添加 `mcp-server` 子命令解析
- `package.json` 更新 `files` 字段包含 `plugins/`
- `package.json` 新增 `@modelcontextprotocol/sdk` 依赖

### 替代方案

- ~~将 src/ 移入 plugins/reverse-spec/~~ — 破坏现有构建和测试流程，变更过大
- ~~使用 monorepo (workspaces) 管理 plugin~~ — 增加不必要的构建复杂度

---

## 信息来源

- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference)
- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Tools Specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Build an MCP Server Tutorial](https://modelcontextprotocol.io/docs/develop/build-server)
