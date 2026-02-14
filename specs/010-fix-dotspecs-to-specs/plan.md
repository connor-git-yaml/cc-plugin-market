# Implementation Plan: 统一 spec 输出目录引用（.specs → specs）

**Branch**: `010-fix-dotspecs-to-specs` | **Date**: 2026-02-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-fix-dotspecs-to-specs/spec.md`

## Summary

将项目中所有 `.specs` 目录引用统一改回 `specs`。这是 Feature 008 引入的 `.specs` 隐藏目录的逆操作。涉及源代码默认路径常量、SKILL.md 模板、CLI 输出消息、MCP server schema、plugin 资产和设计文档。纯字符串替换，无功能变更。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: 无新增依赖
**Storage**: 文件系统（`specs/`、`drift-logs/` 目录写入）
**Testing**: vitest（现有测试套件）
**Target Platform**: Node.js CLI + Claude Code Plugin
**Project Type**: single
**Constraints**: 纯字符串替换，不得引入功能变化

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. AST 精确性优先 | ✅ 通过 | 不涉及 AST 或 LLM 逻辑 |
| II. 混合分析流水线 | ✅ 通过 | 不修改流水线结构 |
| III. 诚实标注不确定性 | ✅ 通过 | 不涉及 |
| IV. 只读安全性 | ✅ 通过 | Constitution 原文即为 `specs/` 和 `drift-logs/`，改回一致 |
| V. 纯 Node.js 生态 | ✅ 通过 | 无新增依赖 |
| VI. 双语文档规范 | ✅ 通过 | 不涉及 |

## Project Structure

### Documentation (this feature)

```text
specs/010-fix-dotspecs-to-specs/
├── spec.md
├── plan.md              # This file
├── research.md
├── quickstart.md
└── checklists/
    └── requirements.md
```

### Source Code (affected files)

```text
src/
├── core/single-spec-orchestrator.ts    # 默认 outputDir 常量
├── batch/batch-orchestrator.ts         # 硬编码路径（4 处）
├── batch/checkpoint.ts                 # DEFAULT_CHECKPOINT_PATH
├── mcp/server.ts                       # zod schema default
├── cli/commands/batch.ts               # 输出消息
├── installer/skill-templates.ts        # Skill 模板字符串（4 处）
├── skills-global/reverse-spec/SKILL.md
└── skills-global/reverse-spec-batch/SKILL.md

plugins/reverse-spec/
├── skills/reverse-spec/SKILL.md
├── skills/reverse-spec-batch/SKILL.md
└── README.md

CLAUDE.md
.gitignore
```

## Complexity Tracking

> 无 Constitution 违规，此表留空。
