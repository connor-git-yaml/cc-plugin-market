# Implementation Plan: 重构为 Claude Code Plugin Marketplace 架构

**Branch**: `009-plugin-marketplace` | **Date**: 2026-02-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/009-plugin-marketplace/spec.md`

## Summary

将 reverse-spec 项目重构为 Claude Code Plugin Marketplace 架构。核心工作包括：1) 在仓库根目录创建 marketplace 清单（`.claude-plugin/marketplace.json`）；2) 在 `plugins/reverse-spec/` 目录下封装完整的 Claude Code Plugin（plugin.json + skills/ + hooks/ + .mcp.json）；3) 新增 MCP stdio server 子命令，使用 `@modelcontextprotocol/sdk` 暴露 prepare/generate/batch/diff 四个工具；4) 保留现有 npm CLI 和测试不变。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: ts-morph, dependency-cruiser, handlebars, zod, @anthropic-ai/sdk（现有）+ @modelcontextprotocol/sdk（新增）
**Storage**: 文件系统（`specs/`、`drift-logs/`、`plugins/` 目录写入）
**Testing**: vitest（现有，无新增测试框架）
**Target Platform**: Claude Code Plugin 生态 + npm CLI
**Project Type**: single（CLI + Plugin 混合）
**Performance Goals**: MCP server 启动时间 < 2 秒；工具调用延迟不增加（透传到现有核心函数）
**Constraints**: 保持现有 242 个测试全部通过；不修改核心业务逻辑；stdout 在 MCP 模式下仅输出 JSON-RPC
**Scale/Scope**: 新增 ~10 个文件（plugin 资产 + MCP server），修改 ~5 个现有文件

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. AST 精确性优先 | ✅ 通过 | 核心 AST 分析逻辑不变，MCP server 仅透传调用 |
| II. 混合分析流水线 | ✅ 通过 | 三阶段流水线保持不变，MCP 工具映射到现有函数 |
| III. 诚实标注不确定性 | ✅ 通过 | 不涉及变更 |
| IV. 只读安全性 | ✅ 通过 | 新增的 plugin 目录是静态资产，MCP server 调用现有写入逻辑（仅 `specs/`、`drift-logs/`） |
| V. 纯 Node.js 生态 | ⚠️ 偏差 | 新增 `@modelcontextprotocol/sdk` 依赖——见 Complexity Tracking |
| VI. 双语文档规范 | ✅ 通过 | SKILL.md 和 plugin 文档遵循中文正文 + 英文标识符规范 |

**Post-Design Re-check**: 所有原则仍然满足。偏差 V 已在 Complexity Tracking 中记录。

## Project Structure

### Documentation (this feature)

```text
specs/009-plugin-marketplace/
├── spec.md                    # 功能规范
├── plan.md                    # 本文件
├── research.md                # Phase 0 研究输出
├── data-model.md              # Phase 1 数据模型
├── quickstart.md              # Phase 1 集成验证
├── contracts/
│   ├── marketplace-structure.md  # marketplace 和 plugin 结构契约
│   └── mcp-server.md            # MCP server 工具定义契约
├── checklists/
│   └── requirements.md        # spec 质量检查清单
└── tasks.md                   # Phase 2 任务列表（/speckit.tasks 生成）
```

### Source Code (repository root)

```text
# 新增文件（plugin 资产）
.claude-plugin/
└── marketplace.json                    # marketplace 清单

plugins/
└── reverse-spec/                       # Plugin 根目录
    ├── plugin.json                     # plugin manifest
    ├── skills/
    │   ├── reverse-spec/SKILL.md       # 从 src/skills-global/ 复制
    │   ├── reverse-spec-batch/SKILL.md
    │   └── reverse-spec-diff/SKILL.md
    ├── hooks/
    │   └── hooks.json                  # SessionStart hook
    ├── scripts/
    │   └── postinstall.sh              # 环境检查脚本
    └── .mcp.json                       # MCP server 声明

# 新增文件（MCP server 实现）
src/mcp/
├── server.ts                           # McpServer 初始化 + 4 个 tool 注册
└── index.ts                            # stdio server 入口（#!/usr/bin/env node）

# 修改文件
src/cli/index.ts                        # 添加 'mcp-server' 子命令路由
src/cli/utils/parse-args.ts             # 添加 'mcp-server' 到子命令枚举
package.json                            # 添加 @modelcontextprotocol/sdk 依赖 + files 字段
```

**Structure Decision**: 保持 `src/` 作为主源码目录，新增 `plugins/` 存放 plugin 静态资产，新增 `src/mcp/` 存放 MCP server 代码。这样保持了现有构建流程不变，同时满足 Claude Code plugin 规范。

## Complexity Tracking

> **Constitution V 偏差: 新增 @modelcontextprotocol/sdk 依赖**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 新增 `@modelcontextprotocol/sdk` 非核心库依赖 | MCP Server 是 Claude Code Plugin 的核心集成方式，官方 SDK 是唯一推荐的实现途径 | 手动实现 JSON-RPC 2.0 协议增加大量样板代码且容易出错；该 SDK 是纯 Node.js npm 包，属于 Claude Code 官方生态 |
