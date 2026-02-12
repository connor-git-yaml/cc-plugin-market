# 实现计划：CLI 全局分发与 Skill 自动注册

**Branch**: `002-cli-global-distribution` | **Date**: 2026-02-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-cli-global-distribution/spec.md`

## Summary

为 reverse-spec 添加全局 CLI 入口和 Skill 自动注册机制。通过 npm `bin` 字段提供 `reverse-spec` 全局命令（支持 `generate`、`batch`、`diff` 子命令），通过 `postinstall`/`preuninstall` lifecycle 脚本自动将 SKILL.md 注册到 `~/.claude/skills/`。CLI 入口调用编译后的 `dist/` 产物，无需 tsx 运行时依赖。本地开发环境的 `npx tsx` 工作流保持不变。

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js LTS (20.x+)
**Primary Dependencies**: ts-morph, tree-sitter, dependency-cruiser, handlebars, zod, @anthropic-ai/sdk（均为现有依赖，无新增运行时依赖）
**Storage**: 文件系统（specs/、drift-logs/ 目录写入）
**Testing**: Vitest（沿用现有测试框架，新增 CLI 相关测试）
**Target Platform**: macOS, Linux（Windows 尽力支持）
**Project Type**: Single project（CLI 工具）
**Performance Goals**: CLI 启动到子命令调度 < 500ms
**Constraints**: 不引入新的运行时依赖（Constitution V）；CLI 入口使用编译后 JS 而非 tsx
**Scale/Scope**: 3 个子命令、3 个全局 SKILL.md、2 个 lifecycle 脚本

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则                  | 状态     | 说明                                                                          |
| --------------------- | -------- | ----------------------------------------------------------------------------- |
| I. AST 精确性优先     | **通过** | CLI 仅为调度层，AST 分析逻辑不变                                              |
| II. 混合分析流水线    | **通过** | CLI 调用现有 orchestrator，流水线不受影响                                      |
| III. 诚实标注不确定性 | **通过** | 不涉及标注逻辑变更                                                            |
| IV. 只读安全性        | **通过** | CLI 写入目标不变（specs/、drift-logs/）；lifecycle 脚本仅操作 ~/.claude/skills/ |
| V. 纯 Node.js 生态   | **通过** | 无新运行时依赖；CLI 入口为编译后的 Node.js 脚本                               |
| VI. 双语文档规范      | **通过** | 生成的 Spec 格式不变；CLI 帮助文本使用中文                                    |

**结论**：全部 6 条原则通过，无违规。

## Project Structure

### Documentation (this feature)

```text
specs/002-cli-global-distribution/
├── plan.md              # 本文件
├── research.md          # Phase 0 研究
├── data-model.md        # Phase 1 数据模型
├── quickstart.md        # Phase 1 快速验证
├── contracts/           # Phase 1 接口契约
│   ├── cli-interface.md
│   └── skill-registrar.md
└── tasks.md             # Phase 2 任务清单（由 /speckit.tasks 生成）
```

### Source Code (repository root)

```text
src/
├── cli/                           # 新增：CLI 入口
│   ├── index.ts                   # bin 入口（#!/usr/bin/env node）
│   ├── commands/
│   │   ├── generate.ts            # generate 子命令
│   │   ├── batch.ts               # batch 子命令
│   │   └── diff.ts                # diff 子命令
│   └── utils/
│       └── error-handler.ts       # 友好错误输出
├── scripts/                       # 新增：lifecycle 脚本
│   ├── postinstall.ts             # 安装后注册 skill
│   └── preuninstall.ts            # 卸载前清理 skill
├── skills-global/                 # 新增：全局版 SKILL.md 模板
│   ├── reverse-spec/SKILL.md
│   ├── reverse-spec-batch/SKILL.md
│   └── reverse-spec-diff/SKILL.md
├── core/                          # 不变
├── batch/                         # 不变
├── diff/                          # 不变
├── generator/                     # 不变
├── graph/                         # 不变
├── models/                        # 不变
└── utils/                         # 不变

skills/                            # 不变：本地开发版 SKILL.md（npx tsx 调用）

tests/
├── unit/
│   ├── cli-commands.test.ts       # 新增：CLI 子命令解析测试
│   └── skill-registrar.test.ts    # 新增：Skill 注册/清理测试
├── integration/
│   └── cli-e2e.test.ts            # 新增：CLI 端到端测试
└── ...                            # 现有测试不变
```

**Structure Decision**: 在现有 `src/` 下新增 `cli/` 和 `scripts/` 两个目录。CLI 是薄调度层，直接调用现有 orchestrator。全局版 SKILL.md 放在 `src/skills-global/` 中随包发布，与本地 `skills/` 保持分离。

## Complexity Tracking

无 Constitution 违规，无需记录偏差。
