# API 契约更新：图模块

**Feature**: 005-batch-quality-fixes
**更新对象**: `specs/001-reverse-spec-v2/contracts/graph-module.md`
**涉及文件**: `src/graph/dependency-graph.ts`

---

## 修改：dependency-graph

**文件**：`src/graph/dependency-graph.ts`

### `buildGraph(projectRoot: string, options?: GraphOptions): Promise<DependencyGraph>`

**行为更新**（补充原描述）：

| 变更项 | 之前 | 之后 |
|--------|------|------|
| cruise 调用方式 | 同步调用，传绝对路径 | 先 chdir 到项目目录，传相对路径 `'src'` 或 `'.'` |
| cruise API 兼容 | 假设同步返回 | `instanceof Promise` 检测，兼容 v15.x 同步和 v16.x 异步 |
| 空结果处理 | 无防护（空指针崩溃） | 返回空 DependencyGraph |
| cwd 管理 | 无 | `process.chdir()` + `finally` 恢复原 cwd |

**新增行为**：

1. **chdir 管理**：调用 `cruise()` 前执行 `process.chdir(resolvedRoot)`，在 `finally` 块中恢复 `process.chdir(originalCwd)`。即使 cruise 抛出异常也保证恢复。
2. **异步兼容**：`cruiseResult = cruisePromise instanceof Promise ? await cruisePromise : cruisePromise`
3. **空结果防护**：当 `cruiseResult?.output` 为 falsy 时，返回空的 DependencyGraph：

```typescript
{
  projectRoot: resolvedRoot,
  modules: [],
  edges: [],
  topologicalOrder: [],
  sccs: [],
  totalModules: 0,
  totalEdges: 0,
  analyzedAt: new Date().toISOString(),
  mermaidSource: '',
}
```

4. **相对路径**：无 `src/` 目录时传入 `['.']` 而非 `[resolvedRoot]`

**新增错误场景**（补充原错误列表）：

- cruise 返回空 output — 返回空 DependencyGraph（不抛出异常）

**保证**（补充）：

- 无论成功或失败，`process.cwd()` 在函数返回后与调用前一致
- 兼容 dependency-cruiser v15.x（同步）和 v16.x（异步）
