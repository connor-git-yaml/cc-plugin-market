# Implementation Plan: 项目级 Skill 初始化与自包含 Skill 架构

**Branch**: `003-skill-init` | **Date**: 2026-02-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-skill-init/spec.md`

## Summary

为 reverse-spec CLI 新增 `init` 子命令，支持将 Claude Code skill 按项目级或全局级安装。每个安装的 skill 仅包含一个 SKILL.md 文件，其中内联三级降级逻辑（全局 CLI → npx → 安装提示），无需额外脚本文件。同时重构现有 postinstall/preuninstall 脚本以复用 init 核心逻辑，消除代码重复。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: 无新增运行时依赖。仅使用 Node.js 内置模块（`fs`, `path`, `os`, `url`）
**Storage**: 文件系统写入（`.claude/skills/` 项目级, `~/.claude/skills/` 全局级）
**Testing**: vitest (unit + integration)，现有 175 个测试用例
**Target Platform**: macOS/Linux（bash 内联降级逻辑），Windows 不在本期范围
**Project Type**: single（扩展现有 CLI 模块）
**Performance Goals**: init 操作 < 5 秒完成 3 个 skill 文件的安装
**Constraints**: 无新增运行时依赖；不修改用户 `.gitignore`；现有 `skills/` 开发目录不受影响
**Scale/Scope**: 3 个 skill 文件的安装/移除，CLI 新增 1 个子命令 + 2 个选项

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则                   | 状态      | 说明                                                                                                                                                       |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. AST 精确性优先      | N/A       | init 命令不涉及代码分析                                                                                                                                    |
| II. 混合分析流水线     | N/A       | init 命令不涉及代码分析                                                                                                                                    |
| III. 诚实标注不确定性  | N/A       | init 命令不生成 Spec 文档                                                                                                                                  |
| IV. 只读安全性         | JUSTIFIED | init 写入 `.claude/skills/`，非 `specs/` 或 `drift-logs/`。但 init 是用户主动触发的安装操作，非分析操作。该原则防止分析过程修改源代码，init 不分析代码      |
| V. 纯 Node.js 生态     | PASS      | 仅使用 Node.js 内置模块，无新增依赖                                                                                                                        |
| VI. 双语文档规范       | PASS      | CLI 输出使用中文（FR-014），SKILL.md 遵循双语规范                                                                                                           |

**GATE 结果**: PASS（1 个 JUSTIFIED 偏差，已记录理由）

## Project Structure

### Documentation (this feature)

```text
specs/003-skill-init/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── cli-interface.md # init 子命令 CLI 接口契约
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── index.ts                  # [修改] 新增 init 子命令分发
│   ├── commands/
│   │   ├── generate.ts           # [不变]
│   │   ├── batch.ts              # [不变]
│   │   ├── diff.ts               # [不变]
│   │   └── init.ts               # [新增] init 子命令入口
│   └── utils/
│       ├── parse-args.ts         # [修改] 新增 init 子命令解析 + --global/--remove 选项
│       └── error-handler.ts      # [不变]
├── installer/
│   ├── skill-installer.ts        # [新增] 核心安装/卸载逻辑（共享模块）
│   └── skill-templates.ts        # [新增] SKILL.md 模板内容（内联降级逻辑）
├── scripts/
│   ├── postinstall.ts            # [修改] 重构为调用 skill-installer
│   └── preuninstall.ts           # [修改] 重构为调用 skill-installer
├── skills-global/                # [不变] 保留现有全局 SKILL.md（作为参考）
│   ├── reverse-spec/SKILL.md
│   ├── reverse-spec-batch/SKILL.md
│   └── reverse-spec-diff/SKILL.md
└── ...                           # 其他模块不变

tests/
├── unit/
│   ├── skill-installer.test.ts   # [新增] 安装核心逻辑测试
│   ├── init-command.test.ts      # [新增] init 命令测试
│   └── skill-registrar.test.ts   # [修改] 适配新的 installer 模块
└── integration/
    └── init-e2e.test.ts          # [新增] init 端到端测试
```

**Structure Decision**: 新增 `src/installer/` 模块封装安装/卸载核心逻辑，供 `init` 命令和 `postinstall`/`preuninstall` 脚本共享。SKILL.md 模板内容作为 TypeScript 字符串常量存储在 `skill-templates.ts` 中（内嵌降级逻辑），而非从磁盘读取 `skills-global/` 目录。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| IV. 只读安全性：init 写入 `.claude/skills/` | `init` 是用户主动触发的安装操作，目标目录是 Claude Code 的 skill 配置目录，非用户源代码。用户明确请求安装。 | 不写入文件则无法实现 skill 安装功能，这是本 feature 的核心价值 |
