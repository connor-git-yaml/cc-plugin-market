# Implementation Plan: Batch 模块级聚合与生成质量提升

**Branch**: `005-batch-quality-fixes` | **Date**: 2026-02-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-batch-quality-fixes/spec.md`

**Note**: 本计划为追溯记录——代码已完成（提交 4a58c04..fcfddc9），目的是让 001 的 contracts 文档与实现保持同步。

## Summary

对 reverse-spec 的 batch 处理流程进行三方面改进：(1) 将文件级拓扑排序重构为模块级聚合，以目录为单位生成 spec；(2) 增强 LLM 系统提示词和响应解析的容错性，提升 spec 生成质量；(3) 修复 dependency-cruiser v16.x 异步 API 兼容性和空结果防护。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: ts-morph（AST）、dependency-cruiser（依赖图）、handlebars（模板）、zod（验证）、@anthropic-ai/sdk（LLM）——均为现有依赖，无新增运行时依赖
**Storage**: 文件系统（specs/ 目录写入）
**Testing**: vitest（现有）
**Target Platform**: macOS, Linux
**Project Type**: Single project（CLI 工具）
**Performance Goals**: batch 处理按模块级聚合后，spec 数量减少（模块数 < 文件数），总处理时间不增加
**Constraints**: 无新增运行时依赖；仅使用 Node.js 内置模块（child_process、fs、path）和现有 npm 依赖
**Scale/Scope**: 单用户 CLI 工具，支持 200+ 模块的项目

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
| ---- | ---- | ---- |
| I. AST 精确性优先 | PASS | 不涉及 AST 提取逻辑变更；module-grouper 基于已有 DependencyGraph 数据聚合 |
| II. 混合分析流水线 | PASS | 三阶段流水线不变；增强的系统提示词属于"生成与增强"阶段的改进 |
| III. 诚实标注不确定性 | PASS | 不涉及标注机制变更 |
| IV. 只读安全性 | PASS | 仅写入 specs/ 目录，不修改源文件 |
| V. 纯 Node.js 生态 | PASS | 无新增运行时依赖，仅使用现有 npm 包和 Node.js 内置模块 |
| VI. 双语文档规范 | PASS | 增强的系统提示词进一步强化了中文章节标题和英文代码标识符的格式要求 |

所有原则通过，无违规需要记录。

## Project Structure

### Documentation (this feature)

```text
specs/005-batch-quality-fixes/
├── plan.md              # 本文件
├── spec.md              # 功能规格（已完成）
├── research.md          # Phase 0 研究
├── data-model.md        # Phase 1 数据模型
├── quickstart.md        # Phase 1 快速验证
├── checklists/
│   └── requirements.md  # 需求检查清单（已完成）
└── contracts/           # Phase 1 API 契约更新
    ├── batch-module.md  # 更新 001 batch 契约
    ├── graph-module.md  # 更新 001 graph 契约
    ├── llm-client.md    # 更新 001 LLM 客户端契约
    ├── core-pipeline.md # 更新 001 核心流水线契约
    └── generator.md     # 更新 001 生成器契约
```

### Source Code (repository root)

```text
src/
├── batch/
│   ├── batch-orchestrator.ts     # 修改：模块级聚合处理逻辑
│   ├── module-grouper.ts         # 新增：文件→模块分组与模块级拓扑排序
│   ├── checkpoint.ts             # 未修改
│   └── progress-reporter.ts      # 未修改
├── core/
│   ├── llm-client.ts             # 修改：系统提示词增强 + 章节匹配容错
│   └── single-spec-orchestrator.ts # 修改：新增依赖图 + moduleSpec 字段
├── generator/
│   └── mermaid-dependency-graph.ts # 新增：Mermaid 依赖关系图生成
├── graph/
│   └── dependency-graph.ts       # 修改：异步 API 适配 + 空结果防护
└── cli/
    └── commands/
        └── batch.ts              # 微调：传递 grouping 选项

tests/
└── unit/
    ├── module-grouper.test.ts    # 新增：模块分组测试
    └── llm-client.test.ts        # 微调：适配提示词变更
```

**Structure Decision**: 遵循现有项目的模块化结构。新增 `module-grouper.ts` 放入 `src/batch/` 目录（分组逻辑属于 batch 编排的一部分）；新增 `mermaid-dependency-graph.ts` 放入 `src/generator/`（与现有 `mermaid-class-diagram.ts` 并列）。

## 设计方案

### 1. 模块级聚合（US1 核心）

```text
文件级 DependencyGraph
  ↓ groupFilesToModules(graph, options)
模块级分组 ModuleGroupResult
  ↓ moduleOrder（Kahn 拓扑排序）
按模块顺序处理
  ↓ generateSpec(dirPath)  ← 传目录而非单个文件
模块级 spec
```

分组规则：

1. 自动检测 `basePrefix`（>80% 文件在 `src/` 下 → `'src/'`）
2. 以 `basePrefix` 后第 `depth` 级目录作为模块名
3. `basePrefix` 根目录下的散文件归入 `rootModuleName`（默认 `'root'`）
4. root 模块的文件逐个单独处理

### 2. LLM 响应解析增强（US2）

```text
现有：SECTION_TITLES = [['intent', ['意图']]]
改为：SECTION_TITLES = [['intent', ['意图', 'Intent', 'Purpose', '目的', '概述']]]

匹配算法：
  归一化标题 → toLowerCase() → 移除标点/空格
  双向包含检查：normalizedTitle.includes(t) || t.includes(normalizedTitle)
```

### 3. 系统提示词增强（US2）

`buildSystemPrompt('spec-generation')` 从简短描述（约 20 行）扩展为详细的格式要求（约 80 行），包括：

- 9 个章节的固定标题格式（`## N. 章节名`）
- 每个章节的具体格式要求（表格、Mermaid 模板、列表格式）
- 不确定性标注规则
- 禁止偷懒的明确指令

### 4. dependency-cruiser 兼容性（US3）

```text
buildGraph():
  1. process.chdir(resolvedRoot)     ← 新增
  2. cruise(['src'], options)        ← 使用相对路径 'src' 而非绝对路径
  3. cruiseResult instanceof Promise
     ? await cruiseResult            ← v16.x 异步
     : cruiseResult                  ← v15.x 同步
  4. finally: process.chdir(originalCwd)  ← 恢复 cwd
  5. if (!output) → 返回空 DependencyGraph  ← 空结果防护
```

## Complexity Tracking

无 Constitution 违规，无需记录。
