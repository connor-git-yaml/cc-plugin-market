# API 契约：批处理模块

**模块**：`src/batch/`
**覆盖**：FR-012、FR-015、FR-016、FR-017

---

## batch-orchestrator

**文件**：`src/batch/batch-orchestrator.ts`

### `runBatch(projectRoot: string, options?: BatchOptions): Promise<BatchResult>`

按拓扑顺序编排全项目规格生成。

**参数**：
- `projectRoot` — 项目根目录
- `options.force` — 即使规格已存在也重新生成（默认：`false`）
- `options.onProgress` — 进度回调
- `options.maxRetries` — 每个模块的 LLM 最大重试次数（默认：`3`）
- `options.checkpointPath` — 检查点状态文件路径（默认：`specs/.reverse-spec-checkpoint.json`；Constitution IV：必须位于 `specs/` 或 `drift-logs/` 内）

**返回**：
```typescript
interface BatchResult {
  totalModules: number;
  successful: string[];
  failed: FailedModule[];
  skipped: string[];        // 已存在（未使用 --force）
  degraded: string[];       // 降级为仅 AST 模式
  duration: number;         // 总耗时（毫秒）
  indexGenerated: boolean;
  summaryLogPath: string;   // 写入 specs/（Constitution IV）
}
```

**行为**：
1. 构建 DependencyGraph → 拓扑排序
2. 检查是否存在检查点（如有则恢复 — FR-017）
3. 按拓扑顺序处理模块：
   - 如规格已存在且未设置 `force` 则跳过（FR-012）
   - 读取依赖规格以获取 O(1) 上下文（FR-014）
   - AST 分析 → 上下文组装 → LLM 生成 → 渲染 → 写入
   - LLM 失败时：指数退避重试 × 3，然后降级为仅 AST 模式（FR-016）
   - 每个模块完成后保存检查点
4. 生成 `_index.spec.md`
5. 写入批处理摘要日志（FR-015）
6. 成功后清理检查点

**约束**：
- Constitution IV：仅写入 `specs/` 和 `drift-logs/`
- 进度显示：`[N/Total] Processing src/module...`（FR-015）

---

## progress-reporter

**文件**：`src/batch/progress-reporter.ts`

### `createReporter(total: number): ProgressReporter`

创建终端进度报告器。

```typescript
interface ProgressReporter {
  start(modulePath: string): void;     // [3/50] Processing src/auth...
  complete(modulePath: string, status: 'success' | 'failed' | 'skipped' | 'degraded'): void;
  finish(): BatchSummary;              // 最终摘要
}
```

### `writeSummaryLog(summary: BatchSummary, outputPath: string): void`

写入包含所有模块状态的批处理摘要日志（FR-015）。

---

## checkpoint

**文件**：`src/batch/checkpoint.ts`

### `loadCheckpoint(checkpointPath: string): BatchState | null`

加载已有检查点以恢复执行。未找到时返回 `null`。

### `saveCheckpoint(state: BatchState, checkpointPath: string): void`

每个模块完成后原子写入检查点状态（FR-017）。

### `clearCheckpoint(checkpointPath: string): void`

批处理成功完成后删除检查点。

**保证**：
- 检查点是符合 `BatchState` 模式的有效 JSON
- 原子写入（先写临时文件再重命名）防止数据损坏
- 恢复时正确跳过已完成的模块并重试失败的模块
