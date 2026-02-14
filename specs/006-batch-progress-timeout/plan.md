# Implementation Plan: 批量 Spec 生成体验优化

**Branch**: `006-batch-progress-timeout` | **Date**: 2026-02-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-batch-progress-timeout/spec.md`

## Summary

为批量 spec 生成流程添加模块内细粒度进度报告，并优化大模块的超时重试策略。主要变更集中在三个层面：(1) 扩展 ProgressReporter 接口以支持阶段级事件通知；(2) 在 single-spec-orchestrator 的各阶段插入进度回调；(3) 在 batch-orchestrator 中区分超时错误并实现快速失败 + 自动降级。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: ts-morph（AST）、dependency-cruiser（依赖图）、handlebars（模板）、zod（验证）、@anthropic-ai/sdk（LLM）——均为现有依赖，无新增运行时依赖
**Storage**: 文件系统（specs/ 目录写入）
**Testing**: Vitest（现有测试框架）
**Target Platform**: CLI 工具（Node.js 终端）
**Project Type**: single
**Performance Goals**: 大模块从开始处理到出结果（含降级）最大耗时不超过 5 分钟（当前最坏 ~18 分钟）
**Constraints**: 不引入新的运行时依赖；进度信息以 console.log 纯文本输出，不引入终端 UI 库
**Scale/Scope**: 影响 batch 处理流程中的 4-5 个文件，新增约 150-250 行代码

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则                  | 状态    | 说明                                                         |
| --------------------- | ------- | ------------------------------------------------------------ |
| I. AST 精确性优先     | ✅ 通过 | 不涉及 AST 数据的生成或修改，仅在 AST 分析阶段添加进度回调  |
| II. 混合分析流水线    | ✅ 通过 | 不改变三阶段流水线结构，仅在各阶段间插入进度事件             |
| III. 诚实标注不确定性 | ✅ 通过 | 降级为 AST-only 输出时保留 `[推断]` 标记                     |
| IV. 只读安全性        | ✅ 通过 | 仅写入 specs/ 目录，不修改源代码                             |
| V. 纯 Node.js 生态    | ✅ 通过 | 无新增依赖，仅使用 console.log 进行进度输出                  |
| VI. 双语文档规范      | ✅ 通过 | 进度信息使用中文，代码标识符保持英文                         |

**GATE 结果**: ✅ 全部通过，无违规项

## Project Structure

### Documentation (this feature)

```text
specs/006-batch-progress-timeout/
├── spec.md              # 需求规格
├── plan.md              # 本文件
├── research.md          # Phase 0 研究产出
├── data-model.md        # Phase 1 数据模型
├── quickstart.md        # Phase 1 快速实现指南
├── contracts/           # Phase 1 接口契约
│   ├── progress-reporter.md
│   └── timeout-strategy.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 任务列表（由 /speckit.tasks 生成）
```

### Source Code (repository root)

```text
src/
├── batch/
│   ├── batch-orchestrator.ts    # 修改：超时区分 + 降级逻辑 + 阶段回调
│   └── progress-reporter.ts     # 修改：新增 stage() 方法
├── core/
│   ├── single-spec-orchestrator.ts  # 修改：各阶段注入进度回调
│   └── llm-client.ts               # 修改：超时重试策略优化 + 重试事件回调
├── cli/
│   └── commands/
│       └── batch.ts             # 修改：进度条中间更新
└── models/
    └── module-spec.ts           # 修改：新增 StageProgress 类型

tests/
├── unit/
│   ├── progress-reporter.test.ts    # 新增：阶段进度报告测试
│   └── llm-client.test.ts          # 修改：超时重试策略测试
└── integration/
    └── batch-progress.test.ts       # 新增：batch 进度集成测试
```

**Structure Decision**: 遵循现有目录布局，不新增目录。变更集中在 `batch/`、`core/`、`cli/commands/` 三个现有目录中，新增类型定义放在 `models/module-spec.ts`。
