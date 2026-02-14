# API 契约：批处理模块

**模块**：`src/batch/`
**覆盖**：FR-012、FR-015、FR-016、FR-017

---

## module-grouper

**文件**：`src/batch/module-grouper.ts`

### `groupFilesToModules(graph: DependencyGraph, options?: GroupingOptions): ModuleGroupResult`

将文件级依赖图聚合为模块级分组。

**参数**：

- `graph` — `buildGraph()` 输出的 DependencyGraph
- `options.basePrefix` — 分组基准目录前缀（默认：自动检测，>80% 在 `src/` 下则 `'src/'`）
- `options.depth` — basePrefix 后取几级目录（默认：`1`）
- `options.rootModuleName` — 根目录散文件的模块名（默认：`'root'`）

**返回**：

```typescript
interface ModuleGroupResult {
  groups: ModuleGroup[];       // 按模块分组的结果
  moduleOrder: string[];       // 模块级拓扑排序（叶子模块优先）
  moduleEdges: Array<{ from: string; to: string }>;  // 模块间聚合依赖边
}

interface ModuleGroup {
  name: string;      // 模块名称（如 'auth'、'core'）
  dirPath: string;   // 模块目录路径（如 'src/auth'）
  files: string[];   // 模块内文件路径（已排序）
}

interface GroupingOptions {
  basePrefix?: string;      // 分组基准目录前缀（默认自动检测）
  depth?: number;           // 分组深度（默认 1）
  rootModuleName?: string;  // 根目录散文件模块名（默认 'root'）
}
```

**行为**：

1. 自动检测 `basePrefix`（>80% 文件在 `src/` 下 → `'src/'`；`lib/` 同理；否则 `''`）
2. 将每个文件按 `basePrefix` + `depth` 级目录分配到模块
3. `basePrefix` 根目录下的散文件归入 `rootModuleName`
4. 构建模块间依赖边（从文件级边聚合，去重，忽略模块内部依赖）
5. 使用 Kahn 算法对模块进行拓扑排序（叶子模块优先；循环依赖的模块追加到末尾）

**保证**：

- 每个文件恰好属于一个模块
- 模块间边的方向表示依赖关系（from 依赖 to，to 先处理）
- 拓扑排序处理循环依赖（追加到末尾而非报错）

---

## batch-orchestrator

**文件**：`src/batch/batch-orchestrator.ts`

### `runBatch(projectRoot: string, options?: BatchOptions): Promise<BatchResult>`

按模块级拓扑顺序编排全项目规格生成。

**参数**：

- `projectRoot` — 项目根目录
- `options.force` — 即使规格已存在也重新生成（默认：`false`）
- `options.onProgress` — 进度回调
- `options.maxRetries` — 每个模块的 LLM 最大重试次数（默认：`3`）
- `options.checkpointPath` — 检查点状态文件路径（默认：`specs/.reverse-spec-checkpoint.json`；Constitution IV：必须位于 `specs/` 或 `drift-logs/` 内）
- `options.grouping` — 模块分组选项（`GroupingOptions`，传递给 `groupFilesToModules()`）

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

1. 构建 DependencyGraph
2. 调用 `groupFilesToModules(graph, options.grouping)` 将文件聚合为模块级分组
3. 检查是否存在检查点（如有则恢复 — FR-017）
4. 按模块级拓扑顺序（`moduleOrder`）处理模块：
   - 如规格已存在且未设置 `force` 则跳过（FR-012）
   - **root 模块**：散文件逐个调用 `generateSpec(filePath, { deep: true })`
   - **其他模块**：调用 `generateSpec(dirPath, { deep: true })`，传入目录路径
   - 收集每个模块的 `result.moduleSpec` 到 `collectedModuleSpecs` 数组
   - LLM 失败时：指数退避重试（最多 `maxRetries` 次），仍失败则标记为 `failed`（`degradedToAstOnly: false`）（FR-016 部分实现：AST 降级逻辑尚未完成）
   - 每个模块完成后保存检查点
5. 生成 `_index.spec.md`：`generateIndex(collectedModuleSpecs, graph)`（使用实际 ModuleSpec 数据）
6. 写入批处理摘要日志（FR-015）
7. 成功后清理检查点

**约束**：

- Constitution IV：仅写入 `specs/` 和 `drift-logs/`
- 进度显示：`[N/Total] Processing src/module...`（FR-015）
- checkpoint 中模块的 `path` 字段使用模块名（如 `'auth'`）而非文件路径

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
