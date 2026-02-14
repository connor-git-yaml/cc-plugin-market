# Quickstart: 批量 Spec 生成体验优化

**Feature Branch**: `006-batch-progress-timeout`
**Date**: 2026-02-14

## 实现概览

本特性涉及 **6 个文件**的修改，无新增文件（类型和测试除外）。变更按影响范围分为三层：

### 第 1 层: 类型定义（基础）

**文件**: `src/models/module-spec.ts`

- 新增 `StageId`、`StageProgress`、`StageProgressCallback` 类型
- 约 15 行新增代码

### 第 2 层: 核心逻辑（重点）

**文件 A**: `src/core/llm-client.ts`

1. 新增 `RetryEvent`、`RetryCallback` 类型
2. 修改 `callLLM` 签名：新增可选参数 `onRetry?: RetryCallback`
3. 修改 `callLLMviaSdk`：超时错误最多重试 1 次 + 触发 onRetry 回调
4. **Bug 修复** `callLLMviaCliProxy`：
   - 超时错误最多重试 1 次 + 触发 onRetry 回调
   - 修复第 289 行：将 `throw lastError` 改为 `throw new LLMUnavailableError(...)`
5. 约 30 行修改

**文件 B**: `src/core/single-spec-orchestrator.ts`

1. 扩展 `GenerateSpecOptions`：新增 `onStageProgress?: StageProgressCallback`
2. 修改 `prepareContext`：在文件扫描、AST 分析、上下文组装前后触发回调
3. 修改 `generateSpec`：在 LLM 调用、响应解析、渲染写入前后触发回调
4. 将 `onRetry` 从 batch 层传递到 `callLLM`
5. 约 60 行修改

### 第 3 层: 批量编排 + UI（集成）

**文件 C**: `src/batch/progress-reporter.ts`

1. 扩展 `ProgressReporter` 接口：新增 `stage()` 方法
2. 实现 stage 方法的终端输出格式
3. 约 20 行修改

**文件 D**: `src/batch/batch-orchestrator.ts`

1. 构建 `genOptions` 时传入 `onStageProgress` 回调
2. 无需修改错误处理逻辑（降级由 generateSpec 内部处理）
3. 约 10 行修改

**文件 E**: `src/cli/commands/batch.ts`

1. 可选：在 `onProgress` 回调中增加中间状态更新
2. 约 5 行修改

## 关键依赖顺序

```
1. models/module-spec.ts   (StageProgress 类型)
   ↓
2. core/llm-client.ts      (RetryEvent + Bug 修复 + 超时策略)
   ↓
3. core/single-spec-orchestrator.ts  (onStageProgress 回调注入)
   ↓
4. batch/progress-reporter.ts        (stage() 方法)
   ↓
5. batch/batch-orchestrator.ts       (集成连线)
   ↓
6. cli/commands/batch.ts             (进度条更新)
```

## 测试验证

```bash
# 运行所有单元测试
npm test

# 运行特定测试
npx vitest run tests/unit/llm-client.test.ts
npx vitest run tests/unit/progress-reporter.test.ts

# 集成验证（需要 LLM 认证）
npx vitest run tests/integration/batch-progress.test.ts
```

## 风险点

| 风险 | 影响 | 缓解措施 |
| ---- | ---- | -------- |
| prepareContext 签名变更 | 所有调用方需要适配 | 回调参数可选，不传即保持原有行为 |
| callLLM 签名变更 | semantic-diff.ts 也调用 callLLM | 新参数可选，不影响现有调用 |
| CLI 代理错误包装修改 | 改变现有错误传播路径 | 这是 bug 修复，修改后行为更正确 |
