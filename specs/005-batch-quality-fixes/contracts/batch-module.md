# API 契约更新：批处理模块

**Feature**: 005-batch-quality-fixes
**更新对象**: `specs/001-reverse-spec-v2/contracts/batch-module.md`
**涉及文件**: `src/batch/batch-orchestrator.ts`, `src/batch/module-grouper.ts`（新增）

---

## 新增：module-grouper

**文件**：`src/batch/module-grouper.ts`（新增）

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

## 修改：batch-orchestrator

**文件**：`src/batch/batch-orchestrator.ts`

### 变更摘要

| 变更项 | 之前 | 之后 |
|--------|------|------|
| 处理粒度 | 文件级拓扑排序 | 模块级拓扑排序 |
| 排序来源 | `topologicalSort(graph)` | `groupFilesToModules(graph, options)` |
| 处理单位 | 单个文件路径 | 模块目录路径（root 模块除外） |
| spec 命名 | `path.basename(filePath)` → `file.spec.md` | `moduleName.spec.md` |
| 索引生成 | `generateIndex([], graph)` | `generateIndex(collectedModuleSpecs, graph)` |
| `BatchOptions` | 无 `grouping` 字段 | 新增 `grouping?: GroupingOptions` |

### `runBatch(projectRoot: string, options?: BatchOptions): Promise<BatchResult>`

**行为更新**（替换原描述的步骤 1-3）：

1. 构建 DependencyGraph（不变）
2. **新增**：调用 `groupFilesToModules(graph, options.grouping)` 聚合为模块
3. **新增**：按 `moduleOrder` 遍历模块（而非按 `topologicalSort` 的文件顺序）
4. 对于每个模块：
   - **root 模块**：散文件逐个调用 `generateSpec(filePath)`
   - **其他模块**：调用 `generateSpec(dirPath)`，传入目录路径
   - 收集 `result.moduleSpec` 到 `collectedModuleSpecs` 数组
5. 生成架构索引：`generateIndex(collectedModuleSpecs, graph)`（使用实际 ModuleSpec 数据）
6. 写入摘要日志（不变）
7. 清理检查点（不变）

**新增约束**：

- checkpoint 中模块的 `path` 字段使用模块名（如 `'auth'`）而非文件路径
- `generateSpec()` 调用时 `deep: true` 以获取更丰富的上下文
