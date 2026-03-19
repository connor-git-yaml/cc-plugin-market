# Research: Batch 单语言非 TS/JS 依赖图选择

## 结论

- `runBatch()` 当前在扫描语言之前就无条件执行 `buildGraph(resolvedRoot)`，这条路径依赖 `dependency-cruiser`，本质只适用于 TS/JS。
- 纯 Python/Go/Java 项目虽然能被 `scanFiles()` 正确识别，但由于 `isMultiLang === false`，不会进入 per-language graph 分支，最终仍使用最初的 TS/JS 空图。
- 当前 registry 中只有 `ts-js` adapter 实现了 `buildDependencyGraph()`；Python/Go/Java 需要落到现有 `buildFallbackGraph()` 目录图兜底。这说明修复重点不是“新增适配器能力”，而是“修正单语言图选择入口”。

## 证据

1. `src/batch/batch-orchestrator.ts`
   - 先执行 `const graph = await buildGraph(resolvedRoot);`
   - 后面只在 `isMultiLang` 时才构建 per-language graph
2. `src/adapters/ts-js-adapter.ts`
   - 唯一实现 `buildDependencyGraph()`
3. `src/adapters/python-adapter.ts` / `go-adapter.ts` / `java-adapter.ts`
   - 仅实现文件分析与术语映射，无原生项目级依赖图
4. `src/batch/batch-orchestrator.ts` 内部 `buildFallbackGraph()`
   - 已具备对任意语言组生成目录图的兜底能力，但当前单语言非 TS/JS 分支没有触发

## 修复策略

1. 先扫描文件和语言，再决定主图来源
2. 图选择逻辑拆为三类：
   - 纯 TS/JS：保留 `buildGraph()` 现有逻辑
   - 单语言非 TS/JS：直接取该语言 group，优先调用 adapter 的 `buildDependencyGraph()`，失败或缺失则 `buildFallbackGraph()`
   - 多语言：保留现有 per-language graph + merge 逻辑
3. 为纯 Python 项目补一个回归测试，验证 `runBatch()` 不再返回 0 模块

## 不做的事

- 不在本 feature 中为 Python/Go/Java 新增专用依赖图分析器
- 不重写 `groupFilesToModules()` 或多语言拓扑合并逻辑
- 不调整 batch 对外接口和返回结构
