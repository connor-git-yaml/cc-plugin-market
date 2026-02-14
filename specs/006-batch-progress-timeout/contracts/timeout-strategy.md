# Contract: 超时重试策略优化

**Feature Branch**: `006-batch-progress-timeout`
**Date**: 2026-02-14

## 概述

优化 LLM 调用的超时重试策略，实现快速失败，并修复 CLI 代理路径的错误包装不一致问题。

## Bug 修复: CLI 代理错误包装不一致

### 问题

`callLLMviaCliProxy`（llm-client.ts:289）在重试耗尽后直接 `throw lastError`，抛出原始的 `LLMTimeoutError`。而 `callLLMviaSdk`（llm-client.ts:251）总是包装为 `LLMUnavailableError`。

这导致 `generateSpec` 无法捕获 CLI 代理路径的超时错误进行降级（只捕获 `LLMUnavailableError`），最终模块被标记为 `failed`。

### 修复

将 `callLLMviaCliProxy` 的最终 throw 统一为：

```typescript
// 修改前 (llm-client.ts:289)
throw lastError ?? new LLMUnavailableError('CLI 代理调用失败');

// 修改后
throw new LLMUnavailableError(
  `${maxAttempts} 次尝试后仍无法访问 CLI 代理: ${lastError?.message}`,
);
```

## 超时快速失败策略

### 当前行为

| 层级 | 最大尝试次数 | 适用于 | 总超时 |
| ---- | ------------ | ------ | ------ |
| LLM 层 | 3 | 所有可重试错误 | ~366s |
| 模块层 | 3 | 所有错误 | ~1098s |

### 修改后行为

| 层级 | 最大尝试次数 | 适用于 | 总超时 |
| ---- | ------------ | ------ | ------ |
| LLM 层（超时） | 2 | LLMTimeoutError | ~246s |
| LLM 层（其他） | 3 | 429、5xx | ~366s |
| 模块层 | 不变（3） | 非降级错误 | - |

### 实现细节

在 `callLLMviaSdk` 和 `callLLMviaCliProxy` 的重试循环中，根据错误类型动态计算最大尝试次数：

```typescript
// 伪代码
const maxAttempts = 3;

for (let attempt = 0; attempt < maxAttempts; attempt++) {
  try {
    return await apiCall();
  } catch (error) {
    const classified = classifyError(error);

    // 超时错误：最多重试 1 次（共 2 次尝试）
    if (classified instanceof LLMTimeoutError && attempt >= 1) {
      break;
    }

    if (!isRetryableError(classified) || attempt === maxAttempts - 1) {
      break;
    }

    // 触发 onRetry 回调
    onRetry?.({
      attempt: attempt + 1,
      maxAttempts,
      errorType: getErrorType(classified),
      delay: getRetryDelay(attempt),
    });

    await sleep(getRetryDelay(attempt));
  }
}
```

### onRetry 回调集成

在重试循环中，每次即将重试时触发回调：

```typescript
export async function callLLM(
  context: AssembledContext,
  config?: Partial<LLMConfig>,
  onRetry?: RetryCallback,
): Promise<LLMResponse>
```

回调在 `sleep()` 之前触发，让调用方能在等待期间输出进度信息。

## 自动降级增强

### 当前降级范围

`generateSpec` 中仅捕获 `LLMUnavailableError`（single-spec-orchestrator.ts:240），降级为 AST-only。

### 修改后降级范围

保持不变——因为修复 CLI 代理错误包装后，所有重试耗尽的情况都会抛出 `LLMUnavailableError`，现有降级逻辑已能正确工作。无需扩大捕获范围。

### 降级后的 batch 状态

当 `generateSpec` 成功降级（返回而非抛出），batch-orchestrator 应将该模块记录为 `degraded` 状态。当前代码已通过检查 `result.confidence === 'low' && result.warnings.some(w => w.includes('降级'))` 实现（batch-orchestrator.ts:163-165）。

## 超时时间对比

| 场景 | 修改前 | 修改后 | 改善 |
| ---- | ------ | ------ | ---- |
| SDK + 全超时 | ~366s + 模块重试 = ~1098s | ~246s + 降级 = ~246s | 77% 减少 |
| CLI 代理 + 全超时 | ~366s + 模块重试 = ~1098s（且无降级） | ~246s + 降级 = ~246s | 77% 减少 + 修复降级 |
| 最坏情况 | ~18 分钟（模块报 failed） | ~4 分钟（模块报 degraded） | 满足 SC-002（≤5 分钟） |
