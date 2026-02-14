# Contract: LLM 配置与调用接口变更

**Feature**: 007-fix-batch-llm-defaults
**Date**: 2026-02-14

## 1. `getDefaultConfig()` 变更

### 现状

```typescript
function getDefaultConfig(): LLMConfig {
  return {
    model: process.env['REVERSE_SPEC_MODEL'] ?? 'claude-opus-4-6',
    timeout: 120_000,
    // ...
  };
}
```

### 目标

```typescript
function getDefaultConfig(): LLMConfig {
  const model = process.env['REVERSE_SPEC_MODEL'] ?? 'claude-sonnet-4-5-20250929';
  return {
    model,
    timeout: getTimeoutForModel(model),
    // ...
  };
}
```

## 2. 新增 `getTimeoutForModel()` 函数

```typescript
/**
 * 根据模型名称返回合理的超时时间
 */
export function getTimeoutForModel(model: string): number {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes('opus')) return 300_000;   // 5 分钟
  if (lowerModel.includes('sonnet')) return 120_000;  // 2 分钟
  if (lowerModel.includes('haiku')) return 60_000;    // 1 分钟
  return 180_000;                                      // 3 分钟（保守默认）
}
```

### 超时值依据

| 模型族   | 超时值     | 依据                                    |
| -------- | ---------- | --------------------------------------- |
| Opus     | 300,000ms  | 实测 spec 生成 >120s，留足余量          |
| Sonnet   | 120,000ms  | 实测 spec 生成 ~90s，留 30% 余量        |
| Haiku    | 60,000ms   | 响应极快，60s 足够                      |
| 未知     | 180,000ms  | 保守默认，介于 Sonnet 和 Opus 之间      |

## 3. `getDefaultCLIProxyConfig()` 变更

### 现状

```typescript
export function getDefaultCLIProxyConfig(): CLIProxyConfig {
  return {
    model: process.env['REVERSE_SPEC_MODEL'] ?? 'claude-opus-4-6',
    timeout: 120_000,
    maxConcurrency: 3,
  };
}
```

### 目标

```typescript
export function getDefaultCLIProxyConfig(): CLIProxyConfig {
  const model = process.env['REVERSE_SPEC_MODEL'] ?? 'claude-sonnet-4-5-20250929';
  return {
    model,
    timeout: getTimeoutForModel(model),
    maxConcurrency: 3,
  };
}
```

注意：`getTimeoutForModel` 需从 `llm-client.ts` 导出，供 `cli-proxy.ts` 导入使用。

## 4. 系统提示词注入去重

### 职责划分

| 层级                      | 职责                                    | 系统提示词处理 |
| ------------------------- | --------------------------------------- | -------------- |
| `prepareContext`          | 组装用户内容（骨架 + 依赖 + 代码片段） | 不注入         |
| `assembleContext`         | token 预算内裁剪并拼接                  | 不注入         |
| `callLLMviaSdk`           | SDK API 调用                            | `system` 参数  |
| `callLLMviaCliProxy`      | CLI 子进程调用                          | prompt 前置    |

### `prepareContext` 变更

```typescript
// 移除:
const systemPrompt = buildSystemPrompt('spec-generation');
const context = await assembleContext(mergedSkeleton, {
  codeSnippets,
  templateInstructions: systemPrompt,  // ← 删除此行
});

// 改为:
const context = await assembleContext(mergedSkeleton, {
  codeSnippets,
  // templateInstructions 不再传入系统提示词
});
```

### `callLLMviaSdk` 保持不变

已正确通过 `system` 参数注入系统提示词。

### `callLLMviaCliProxy` 保持不变

已正确通过 `fullPrompt = systemPrompt + context.prompt` 拼接。

## 5. 测试要求

- 验证默认模型为 `claude-sonnet-4-5-20250929`
- 验证 `getTimeoutForModel` 对各模型族返回正确超时值
- 验证 CLI 代理默认配置同步
- 确保现有 242 个测试全部通过
