# Contract: Progress Reporter 阶段级进度报告

**Feature Branch**: `006-batch-progress-timeout`
**Date**: 2026-02-14

## 概述

扩展现有 `ProgressReporter` 接口，新增 `stage()` 方法，支持模块内阶段级进度事件的终端输出。

## 接口变更

### ProgressReporter.stage()

```typescript
/** 报告模块内阶段进度 */
stage(modulePath: string, progress: StageProgress): void;
```

#### 行为约定

1. 当 `progress.duration` 为 `undefined` 时，输出阶段开始信息
2. 当 `progress.duration` 有值时，输出阶段完成信息和耗时
3. 输出格式统一使用 2 空格缩进（与现有 `complete()` 的缩进一致）

#### 输出格式

```
阶段开始:  "  → {message}"
阶段完成:  "  ✓ {stage}完成 ({duration}ms)"
```

#### 示例输出序列

```
[3/49] 正在处理 shared...
  → 文件扫描中...
  ✓ 文件扫描完成 (15ms)
  → AST 分析中 (42 个文件)...
  ✓ AST 分析完成 (320ms)
  → 上下文组装中...
  ⚠ 上下文 token 数较大 (85,000)，可能影响质量
  ✓ 上下文组装完成 (45ms)
  → LLM 调用中...
  ↻ 重试 2/2 (超时)...
  ⚠ LLM 不可用，降级为 AST-only
  ✓ LLM 调用完成 (降级) (242000ms)
  → 响应解析中...
  ✓ 响应解析完成 (5ms)
  → 渲染写入中...
  ✓ 渲染写入完成 (12ms)
  ⚠️ shared — degraded (242397ms)
```

## GenerateSpecOptions.onStageProgress

### 回调签名

```typescript
onStageProgress?: (progress: StageProgress) => void;
```

### 触发点

在 `generateSpec()` 函数内部的 6 个关键位置触发：

| 触发点 | 阶段 | 位置（相对于 generateSpec 函数体） |
| ------ | ---- | -------------------------------- |
| scanFiles 前后 | `scan` | prepareContext 内部 |
| analyzeFiles 前后 | `ast` | prepareContext 内部 |
| assembleContext 前后 | `context` | prepareContext 内部 |
| callLLM 前后 | `llm` | generateSpec 主体 |
| parseLLMResponse 前后 | `parse` | generateSpec 主体 |
| renderSpec + writeFile 前后 | `render` | generateSpec 主体 |

### prepareContext 的回调传递

由于 `prepareContext` 是独立函数，需要将 `onStageProgress` 传递进去。方式：在 `GenerateSpecOptions` 中添加回调，`prepareContext` 从 options 中读取并调用。

## 集成方式

### batch-orchestrator → generateSpec

```typescript
// batch-orchestrator.ts 中构建 genOptions 时：
const genOptions: GenerateSpecOptions = {
  outputDir: 'specs',
  projectRoot: resolvedRoot,
  deep: true,
  onStageProgress: (progress) => {
    reporter.stage(moduleName, progress);
  },
};
```

### 非 batch 调用（CLI generate 命令）

对于单模块 `generate` 命令，`onStageProgress` 不传递（可选参数），保持现有行为不变。
