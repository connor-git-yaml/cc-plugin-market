# Research: 批量 Spec 生成体验优化

**Feature Branch**: `006-batch-progress-timeout`
**Date**: 2026-02-14

## 研究任务 1: 超时失败根因分析

### 决定

大模块"总是失败"的根本原因是 **CLI 代理路径和 SDK 路径在错误包装上的不一致**，以及 **超时重试链路过长**。

### 分析

#### 两条调用路径的错误处理差异

| 路径 | 重试后最终抛出 | 位置 |
| ---- | -------------- | ---- |
| SDK（callLLMviaSdk） | `new LLMUnavailableError(...)` — 总是包装 | llm-client.ts:251 |
| CLI 代理（callLLMviaCliProxy） | `lastError`（原始错误） — 直接抛出 | llm-client.ts:289 |

**关键发现**: `callLLMviaCliProxy` 在 3 次重试耗尽后直接 `throw lastError`，即抛出原始的 `LLMTimeoutError`。而 `generateSpec` 只捕获 `LLMUnavailableError` 进行降级（single-spec-orchestrator.ts:240）。这意味着：

- **SDK 路径**: timeout → 3 次重试 → `LLMUnavailableError` → `generateSpec` 捕获 → 降级为 AST-only ✅
- **CLI 代理路径**: timeout → 3 次重试 → `LLMTimeoutError` → `generateSpec` 未捕获 → 抛到 batch → **标记为 failed** ❌

这是导致用户报告"总是失败"的直接原因——用户使用的是 CLI 代理认证方式。

#### 超时链路的时间计算

```
单次 LLM 调用超时时间：120 秒（默认 cfg.timeout）

LLM 层重试（llm-client.ts 内部，3 次尝试）：
  第 1 次：120s + 0s 延迟 = 120s
  第 2 次：120s + 2s 延迟 = 122s
  第 3 次：120s + 4s 延迟 = 124s
  小计：366 秒（~6 分钟）

模块级重试（batch-orchestrator.ts，3 次尝试，无延迟）：
  3 × 366s = 1098 秒（~18 分钟）

用户报告的实际值：747 秒（~12.5 分钟）
→ 约等于 2 轮完整模块级重试
```

### 备选方案

| 方案 | 描述 | 拒绝原因 |
| ---- | ---- | -------- |
| A. 仅修复错误包装一致性 | CLI 代理路径也包装为 LLMUnavailableError | 不解决超时链路过长的问题，6 分钟等待仍然太久 |
| B. 减少所有错误的重试次数 | 将 LLM 层重试从 3 降为 1 | 对速率限制等可恢复错误过于激进 |
| **C. 修复错误包装 + 超时类错误快速失败** | 统一错误包装 + 超时仅重试 1 次 | **采纳** |

### 采纳方案

**方案 C**: 两处修复并行推进

1. **修复 `callLLMviaCliProxy` 的错误包装**：统一为 `LLMUnavailableError`，与 SDK 路径保持一致
2. **超时类错误快速失败**：在 LLM 层对 `LLMTimeoutError` 仅重试 1 次（其他可重试错误保持 3 次）
3. **模块级重试区分错误类型**：当 `generateSpec` 因超时降级为 AST-only 后，直接标记为 `degraded`（而非再次重试）

优化后的最坏超时时间：120s × 2 次 LLM 尝试 + 6s 延迟 = ~246s（~4 分钟），远低于 5 分钟目标

---

## 研究任务 2: 进度回调注入模式

### 决定

采用**独立回调参数**模式，在 `GenerateSpecOptions` 中新增可选的 `onStageProgress` 回调，在 `callLLM` 中新增可选的 `onRetry` 回调参数。

### 分析

#### generateSpec 的调用点

| 调用位置 | 文件 | 行号 |
| -------- | ---- | ---- |
| Batch - root 文件 | batch-orchestrator.ts | 154 |
| Batch - 普通模块 | batch-orchestrator.ts | 160 |
| CLI generate 命令 | cli/commands/generate.ts | 37-41 |

所有调用都通过 `GenerateSpecOptions` 对象传参，新增可选属性完全向后兼容。

#### callLLM 的回调参数设计

| 方案 | 优点 | 缺点 |
| ---- | ---- | ---- |
| 扩展 LLMConfig | 统一参数 | 污染配置接口 |
| **独立回调参数** | 关注点分离 | 签名新增参数 |

采用独立参数 `onRetry?: (event: RetryEvent) => void`，保持 LLMConfig 为纯配置对象。

### 备选方案

无需记录——方案选择明确，独立回调参数是业界通用实践。

---

## 研究任务 3: 进度阶段划分

### 决定

将 `generateSpec` 的处理流程划分为 6 个可报告阶段。

### 阶段定义

| 阶段 ID | 名称 | 触发时机 | 输出示例 |
| ------- | ---- | -------- | -------- |
| `scan` | 文件扫描 | scanFiles 开始前 | `→ 文件扫描中...` |
| `ast` | AST 分析 | analyzeFiles 开始前 | `→ AST 分析中 (12 个文件)...` |
| `context` | 上下文组装 | assembleContext 开始前 | `→ 上下文组装中...` |
| `llm` | LLM 调用 | callLLM 开始前 | `→ LLM 调用中...` |
| `parse` | 响应解析 | parseLLMResponse 开始前 | `→ 响应解析中...` |
| `render` | 渲染写入 | renderSpec 开始前 | `→ 渲染写入中...` |

每个阶段完成时追加耗时信息：`  ✓ AST 分析完成 (320ms)`

### 额外事件

| 事件 | 触发时机 | 输出示例 |
| ---- | -------- | -------- |
| `warn` | 上下文 token 超出阈值 | `  ⚠ 上下文 token 数较大 (85,000)，可能影响质量` |
| `retry` | LLM 重试 | `  ↻ 重试 2/3 (超时)...` |
| `wait` | 速率限制退避 | `  ⏳ 速率限制，等待 4s...` |
| `degrade` | 降级为 AST-only | `  ⚠ LLM 不可用，降级为 AST-only` |

---

## 研究任务 4: 测试策略

### 决定

使用 Vitest + `vi.mock()` / `vi.fn()` 模式，新增单元测试覆盖进度回调和超时重试策略。

### 现有测试模式

- 框架：Vitest 3.0.4
- Mock 方式：`vi.mock()` + `vi.mocked()` + `vi.fn()`
- 现有 llm-client.test.ts 仅覆盖纯函数（parseLLMResponse、buildSystemPrompt），不涉及网络调用
- 超时配置：单元测试 30s，集成测试 60s

### 新增测试计划

| 测试文件 | 覆盖范围 |
| -------- | -------- |
| tests/unit/progress-reporter.test.ts（新增） | stage() 方法调用、输出格式验证 |
| tests/unit/llm-client.test.ts（扩展） | 超时重试次数限制、onRetry 回调触发 |
| tests/integration/batch-progress.test.ts（新增） | 端到端进度输出验证 |
