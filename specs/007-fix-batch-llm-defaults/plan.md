# Implementation Plan: 修复 Batch LLM 调用默认配置

**Branch**: `007-fix-batch-llm-defaults` | **Date**: 2026-02-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/007-fix-batch-llm-defaults/spec.md`

## Summary

修复 batch spec 生成中的三个关键问题：更换默认模型为 Sonnet（更快）、消除系统提示词重复注入 bug、实现基于模型的动态超时策略。这是一个 bug 修复 + 配置优化任务，改动集中在 LLM 调用链路的 3 个文件中。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: @anthropic-ai/sdk（现有）, Node.js child_process（内置）——均为现有依赖，无新增
**Storage**: N/A
**Testing**: vitest
**Target Platform**: Node.js CLI 工具
**Project Type**: single
**Performance Goals**: 单模块 LLM 调用在默认模型下 ≤120s 完成
**Constraints**: 不引入新运行时依赖
**Scale/Scope**: 修改 3 个核心文件 + 对应测试

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. AST 精确性优先 | ✅ PASS | 本次修复不涉及 AST 解析逻辑 |
| II. 混合分析流水线 | ✅ PASS | 保持三阶段流水线不变，仅修复提示词注入位置 |
| III. 诚实标注不确定性 | ✅ PASS | 不涉及标注逻辑 |
| IV. 只读安全性 | ✅ PASS | 不涉及文件写入安全性 |
| V. 纯 Node.js 生态 | ✅ PASS | 无新依赖 |
| VI. 双语文档规范 | ✅ PASS | 不修改系统提示词内容 |

所有门控通过，无违规。

## Project Structure

### Documentation (this feature)

```text
specs/007-fix-batch-llm-defaults/
├── plan.md              # 本文件
├── research.md          # Phase 0 研究
├── contracts/           # Phase 1 接口契约
│   └── llm-config.md
└── tasks.md             # Phase 2 任务分解
```

### Source Code (repository root)

```text
src/
├── core/
│   └── llm-client.ts          # 主要修改：默认模型、提示词去重、动态超时
├── core/
│   └── single-spec-orchestrator.ts  # 移除 templateInstructions 系统提示词注入
└── auth/
    └── cli-proxy.ts           # 同步默认配置

tests/
└── unit/
    └── cli-proxy.test.ts      # 更新已有测试
```

**Structure Decision**: 现有项目结构，仅修改已有文件，不新建目录。

## Root Cause Analysis

### Bug 1: 默认模型太慢

- **位置**: `src/core/llm-client.ts:116` 和 `src/auth/cli-proxy.ts:61`
- **现状**: `process.env['REVERSE_SPEC_MODEL'] ?? 'claude-opus-4-6'`
- **问题**: Opus 模型对 spec 生成任务响应时间 >120s（即使 2 文件的小模块），超过默认超时
- **修复**: 默认模型改为 `claude-sonnet-4-5-20250929`

### Bug 2: 系统提示词重复注入

- **注入点 A**（上下文组装阶段）: `src/core/single-spec-orchestrator.ts:211-214`
  ```typescript
  const systemPrompt = buildSystemPrompt('spec-generation');
  const context = await assembleContext(mergedSkeleton, {
    templateInstructions: systemPrompt,  // ← 嵌入 context.prompt
  });
  ```

- **注入点 B-SDK**（SDK 调用阶段）: `src/core/llm-client.ts:209,231`
  ```typescript
  const systemPrompt = buildSystemPrompt('spec-generation');
  system: systemPrompt,           // ← 再次注入为 system 参数
  messages: [{ content: context.prompt }],  // ← context.prompt 已含 systemPrompt
  ```

- **注入点 B-CLI**（CLI 代理调用阶段）: `src/core/llm-client.ts:302-304`
  ```typescript
  const systemPrompt = buildSystemPrompt('spec-generation');
  const fullPrompt = `${systemPrompt}\n\n---\n\n${context.prompt}`;
  // ← context.prompt 已含 systemPrompt，这里再拼一次
  ```

- **修复策略**: 系统提示词的注入职责统一由 `callLLM` 层处理。`prepareContext` 不再通过 `templateInstructions` 注入系统提示词，而是只组装用户内容（骨架 + 依赖 + 代码片段）。在 `callLLM` 层：
  - SDK 路径：通过 `system` 参数传入系统提示词，`messages` 只包含 `context.prompt`（不含系统提示词）
  - CLI 路径：拼接 `systemPrompt + context.prompt` 一次

### Bug 3: 超时时间不匹配

- **位置**: `src/core/llm-client.ts:120`
- **现状**: 固定 `timeout: 120_000`
- **问题**: Opus 模型需要 >120s，Sonnet 通常 60-90s
- **修复**: 增加 `getTimeoutForModel(model)` 函数，根据模型名称返回合理超时：
  - 包含 `opus` → 300_000ms (5 分钟)
  - 包含 `sonnet` → 120_000ms (2 分钟)
  - 其他/未知 → 180_000ms (3 分钟，保守默认)

## Implementation Strategy

### 改动影响面分析

| 文件 | 改动类型 | 复杂度 |
|------|---------|--------|
| `src/core/llm-client.ts` | 修改默认模型、去除 SDK/CLI 路径的重复提示词、添加动态超时 | 中 |
| `src/core/single-spec-orchestrator.ts` | 移除 `templateInstructions: systemPrompt` | 低 |
| `src/auth/cli-proxy.ts` | 同步默认模型配置 | 低 |
| `tests/unit/cli-proxy.test.ts` | 更新受影响的测试用例 | 低 |

### 关键设计决策

1. **提示词注入职责归属**: 系统提示词由 `callLLM` → `callLLMviaSdk` / `callLLMviaCliProxy` 负责注入。`prepareContext` / `assembleContext` 只负责组装用户内容。这是最自然的职责划分——"说什么"（上下文组装）和"怎么说"（LLM 调用）分离。

2. **动态超时策略**: 基于模型名称的简单模式匹配，而非维护一个完整的模型注册表。这保持了实现简单性，且对未知模型采用保守默认值。

3. **默认模型变更范围**: 仅变更 `getDefaultConfig()` 和 `getDefaultCLIProxyConfig()` 的默认值。环境变量 `REVERSE_SPEC_MODEL` 覆盖机制不变。

## Complexity Tracking

无 Constitution 违规需要说明。
