# 技术调研报告: 多语言混合项目支持（Feature 031）

**特性分支**: `031-multilang-mixed-project`
**调研日期**: 2026-03-18
**调研模式**: 离线
**产品调研基础**: 无（独立模式，直接基于需求描述和代码上下文）

## 1. 调研目标

**核心问题**:
- 问题 1: 如何让 `batch-orchestrator` 在扫描阶段自动检测项目中存在的多种编程语言，并按语言分组构建各自的依赖图？
- 问题 2: 当模块跨越语言边界时（如 TS 模块通过 FFI/REST/gRPC 调用 Go 模块），spec 中如何标注语言边界？
- 问题 3: 架构索引（`_index.spec.md`）如何展示多语言分布信息？
- 问题 4: MCP 工具（`prepare`/`batch`）如何增强以支持多语言检测与过滤？
- 问题 5: 对不支持语言的文件如何输出友好的聚合警告？

**需求 MVP 范围**:
- `batch-orchestrator` 按语言分组扫描 + 分组构建依赖图
- 架构索引增加语言分布章节
- MCP `prepare` 返回检测到的语言列表；`batch` 支持 `--languages` 过滤
- `scanFiles` 输出不支持语言的警告（含具体跳过的语言和文件数）

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: 扫描时语言分流（Language-Grouped Pipeline） | 方案 B: 统一扫描 + 后置语言分组（Post-Scan Grouping） |
|------|-----------------------------------------------------|-------------------------------------------------------|
| 概述 | 在 `scanFiles` 阶段即按 LanguageAdapterRegistry 分流，返回 `Map<adapterId, string[]>`；`batch-orchestrator` 对每个语言组独立构建依赖图、独立执行 module-grouper，最后合并拓扑排序结果 | 沿用现有 `scanFiles` 单一返回 `string[]`，batch-orchestrator 在拿到全量文件后，基于 Registry.getAdapter() 按语言分组，再对每组调用各自 adapter 的 `buildDependencyGraph`（若有），最终合并为统一的 moduleOrder |
| 性能 | 一次遍历即完成分流和统计，无需二次遍历文件列表 | 需要对 scanFiles 返回的文件列表做二次分组遍历（O(n)，n 为文件数，代价极低） |
| 可维护性 | `scanFiles` 返回类型变化（`ScanResult.files` 从 `string[]` 变为 `Map<string, string[]>`），是 **breaking change**，影响 `single-spec-orchestrator`、`batch-orchestrator`、MCP 工具所有调用方 | `scanFiles` 返回类型不变，仅新增 `ScanResult.languageStats` 字段；分组逻辑内聚在 batch-orchestrator 中，影响面极小 |
| 学习曲线 | 调用方需理解新的 Map 结构返回值 | 现有 API 不变，新增的分组逻辑是 batch-orchestrator 内部实现 |
| 社区支持 | N/A（内部架构） | N/A（内部架构） |
| 适用规模 | 适合超大型项目（>10000 文件），分流在遍历时完成 | 适合绝大多数项目（<10000 文件），二次遍历开销可忽略 |
| 与现有项目兼容性 | 需要重构 `single-spec-orchestrator.ts` 和所有 MCP 工具的 scanFiles 调用点 | 仅需在 `batch-orchestrator.ts` 中新增分组逻辑；`scanFiles` 向后兼容 |

### 推荐方案

**推荐**: 方案 B — 统一扫描 + 后置语言分组（Post-Scan Grouping）

**理由**:
1. **向后兼容**: `scanFiles` 的返回类型不变（`ScanResult.files` 仍为 `string[]`），只新增 `languageStats` 可选字段。`single-spec-orchestrator` 和现有 MCP 工具无需修改。
2. **影响面最小**: 核心变更集中在 `batch-orchestrator.ts` 和 `index-generator.ts`，不需要重构已稳定的文件扫描器和单文件编排器。
3. **实现简洁**: 二次分组遍历的时间复杂度 O(n) 对于实际项目规模（通常 <5000 文件）完全可以接受，不构成瓶颈。
4. **渐进式扩展**: 未来如需优化超大项目的扫描性能，可以在不改变外部 API 的情况下将分流逻辑下沉到 `walkDir` 内部。

### 方案 B 详细设计

#### 2.1 `scanFiles` 增强

在 `ScanResult` 中新增语言统计字段：

```typescript
export interface ScanResult {
  files: string[];
  totalScanned: number;
  ignored: number;
  unsupportedExtensions?: Map<string, number>;
  // 新增
  languageStats?: Map<string, { adapterId: string; fileCount: number; extensions: string[] }>;
}
```

在 `walkDir` 中，对每个匹配文件通过 `Registry.getAdapter()` 获取适配器 ID，累加到 `languageStats`。扫描完成后，如果 `unsupportedExtensions` 非空，输出聚合警告（此功能已部分实现，需增强为包含具体语言名称）。

#### 2.2 `batch-orchestrator` 多语言分组

```
runBatch(projectRoot, options)
  ├── scanFiles(projectRoot)  // 返回所有支持语言的文件 + languageStats
  ├── groupFilesByLanguage(files)  // 新函数：Map<adapterId, string[]>
  ├── for each (adapterId, langFiles) of languageGroups:
  │     ├── adapter.buildDependencyGraph?(projectRoot)  // 如果适配器支持
  │     │   └── 否则构建 lightweight graph（仅用目录结构推断拓扑）
  │     ├── groupFilesToModules(graph)
  │     └── 标注 languageBoundary 到 ModuleGroup
  ├── mergeDependencyGraphs(graphs)  // 合并多语言图
  ├── detectCrossLanguageBoundaries(mergedGraph)  // 检测跨语言边界
  ├── 按合并拓扑排序逐模块生成 spec
  └── generateIndex(specs, mergedGraph, languageStats)  // 增强索引
```

#### 2.3 轻量级依赖图构建（无 dependency-cruiser 的语言）

对于 Python、Go、Java 等当前未实现 `buildDependencyGraph` 的适配器，提供基于目录结构的轻量级依赖图：

```typescript
function buildDirectoryGraph(files: string[], projectRoot: string): DependencyGraph {
  // 1. 按目录层级构建节点（每个文件为一个 GraphNode）
  // 2. 通过 CodeSkeleton.imports 中的 isRelative + moduleSpecifier 推断本地依赖边
  // 3. 返回简化的 DependencyGraph（无 SCC，拓扑排序基于目录层级）
}
```

这保证了即使某语言没有专门的依赖分析工具（如 `dependency-cruiser` 仅支持 JS/TS），仍能生成有意义的模块拓扑。

#### 2.4 跨语言边界标注

在 `ModuleSpec` 的 frontmatter 中增加可选字段：

```typescript
export interface SpecFrontmatter {
  // ... 现有字段
  language?: string;           // 新增：模块主要语言（如 'typescript'）
  crossLanguageRefs?: string[]; // 新增：跨语言引用（如 ['go:services/auth', 'python:scripts/deploy']）
}
```

检测策略：通过扫描模块的 import 路径中是否引用了属于其他语言组的路径来推断跨语言边界。

#### 2.5 架构索引增强

在 `ArchitectureIndex` 中新增：

```typescript
export interface ArchitectureIndex {
  // ... 现有字段
  languageDistribution?: LanguageDistribution[];  // 新增
}

export interface LanguageDistribution {
  language: string;      // 语言标识（如 'typescript'）
  adapterId: string;     // 适配器 ID
  fileCount: number;     // 文件数
  locTotal: number;      // 总行数
  moduleCount: number;   // 模块数
  percentage: number;    // 文件占比（%）
}
```

在 `index-spec.hbs` 模板中增加"语言分布"章节：

```handlebars
## 语言分布

| 语言 | 文件数 | 代码行数 | 模块数 | 占比 |
|------|--------|---------|--------|------|
{{#each languageDistribution}}
| {{language}} | {{fileCount}} | {{locTotal}} | {{moduleCount}} | {{percentage}}% |
{{/each}}
```

#### 2.6 MCP 工具增强

**`prepare` 工具**：返回结果中增加 `detectedLanguages` 字段：
```typescript
// prepare 返回
{
  skeletons: [...],
  mergedSkeleton: {...},
  context: {...},
  filePaths: [...],
  detectedLanguages: ['typescript', 'python', 'go']  // 新增
}
```

**`batch` 工具**：增加 `languages` 参数：
```typescript
server.tool('batch', '批量 Spec 生成', {
  projectRoot: z.string().optional(),
  force: z.boolean().default(false),
  languages: z.array(z.string()).optional()  // 新增：过滤语言
    .describe('仅处理指定语言（如 ["typescript", "python"]）'),
}, async ({ projectRoot, force, languages }) => {
  const root = projectRoot ?? process.cwd();
  const result = await runBatch(root, { force, languages });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

## 3. 依赖库评估

### 评估矩阵

| 库名 | 用途 | 版本 | 许可证 | 评级 | 说明 |
|------|------|------|--------|------|------|
| dependency-cruiser | JS/TS 依赖图 | ^16.8.0 | MIT | 现有依赖 | 仅支持 JS/TS 生态 |
| web-tree-sitter | 多语言 AST 解析 | ^0.24.7 | MIT | 现有依赖 | 已用于 Python/Go/Java 的 AST 分析 |
| ts-morph | TS/JS 精确 AST | ^24.0.0 | MIT | 现有依赖 | TS/JS 主分析器 |
| zod | Schema 验证 | ^3.24.1 | MIT | 现有依赖 | 用于新增的 LanguageDistribution 等类型验证 |

### 推荐依赖集

**核心依赖**: 无新增依赖。

本特性完全基于现有依赖实现：
- **dependency-cruiser**: 继续作为 JS/TS 的依赖图构建工具
- **web-tree-sitter**: 通过 AST 解析各语言的 import 语句，为非 JS/TS 语言构建轻量级依赖图
- **zod**: 验证新增的数据结构（如 `LanguageDistribution`）

**可选依赖（未来考虑）**:
- `@aspect-build/rules_py`（Python 依赖分析）: 如需 Python 项目的精确依赖图，可考虑引入专用工具，但当前 Phase 不需要
- `go/packages`（Go 依赖分析）: 同上，Go 生态有 `go list -json` 命令行工具可调用，但 MVP 阶段用 AST import 推断即可

### 与现有项目的兼容性

| 现有依赖 | 兼容性 | 说明 |
|---------|--------|------|
| dependency-cruiser ^16.8.0 | 兼容 | 继续用于 JS/TS，无变化 |
| web-tree-sitter ^0.24.7 | 兼容 | 已支持 Python/Go/Java，无需升级 |
| ts-morph ^24.0.0 | 兼容 | TS/JS 主分析器不变 |
| @modelcontextprotocol/sdk ^1.26.0 | 兼容 | MCP 工具参数扩展向后兼容 |
| handlebars ^4.7.8 | 兼容 | 索引模板增加 section 即可 |
| zod ^3.24.1 | 兼容 | 新增 Schema 定义 |

## 4. 设计模式推荐

### 推荐模式

1. **Strategy 策略模式**（已有，扩展使用）: `LanguageAdapter` 接口本身就是策略模式的实现。每个语言适配器封装了该语言的分析策略（AST 分析、降级分析、依赖图构建、术语映射）。本特性的核心在于让 `batch-orchestrator` 能够根据检测到的语言动态选择正确的适配器策略来构建依赖图。

2. **Composite 组合模式**（新引入）: 用于合并多语言依赖图。`CompositeDependencyGraph` 将多个语言各自的 `DependencyGraph` 组合为一个统一的图结构，对外暴露与单语言图相同的接口（`modules`, `edges`, `topologicalOrder` 等）。batch-orchestrator 和 index-generator 无需感知底层是单语言还是多语言。

3. **Observer/Event 观察者模式**（增强使用）: 现有的 `onStageProgress` 回调本质上是观察者模式。在多语言场景下扩展 `StageId` 枚举，增加 `'lang-detect'`（语言检测阶段）和 `'lang-graph'`（语言级依赖图构建阶段），让调用方能感知多语言处理进度。

4. **Null Object 空对象模式**: 对于未实现 `buildDependencyGraph` 的适配器（如 PythonLanguageAdapter、GoLanguageAdapter），用 `buildDirectoryGraph()` 提供一个"基于目录结构的最小有效依赖图"，避免在 batch-orchestrator 中到处写 `if (adapter.buildDependencyGraph)` 的判断。

### 应用案例

- **VS Code 的多语言扩展系统**: VS Code 通过 Language Server Protocol 为每种语言注册独立的 server，每个 server 内部管理该语言的分析逻辑。reverse-spec 的 `LanguageAdapter` + `LanguageAdapterRegistry` 与此思路一致——Registry 相当于 VS Code 的扩展激活系统。
- **SonarQube 多语言分析**: SonarQube 在扫描阶段先按文件扩展名分流，再调用各语言的 analyzer plugin。其架构索引报告中包含"语言分布"饼图，与本特性的 `languageDistribution` 字段一致。
- **dependency-cruiser 自身**: 虽然 dependency-cruiser 目前仅支持 JS/TS/CoffeeScript，但其内部也使用了类似的适配器模式（transpiler 可插拔），为不同变体（TSX、JSX、CoffeeScript）提供不同的解析前端。

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | **dependency-cruiser 仅支持 JS/TS 生态**：Python/Go/Java 没有等价的依赖分析工具，轻量级 directory graph 精度有限 | 高 | 中 | 使用 AST import 解析结合目录结构推断的 `buildDirectoryGraph` 作为兜底方案；在 spec 中标注 `confidence: 'medium'` 表明依赖图精度有限。未来可通过调用 `go list -json`、`pip show`、`mvn dependency:tree` 等 CLI 命令增强精度 |
| 2 | **跨语言依赖检测困难**：TS 调用 Python（如通过 subprocess/REST API）在 AST import 中不可见 | 高 | 中 | MVP 阶段仅标注"同项目中存在多种语言"，不尝试精确检测跨语言调用关系。在 spec 中增加"语言边界"提示，引导人工审查 |
| 3 | **模块分组跨语言冲突**：同一目录下既有 `.ts` 又有 `.py` 文件（如 monorepo），`module-grouper` 可能将不同语言文件分到同一个模块 | 中 | 中 | 在 `module-grouper` 中增加语言感知分组策略：同一目录下不同语言的文件分到不同的子模块（如 `services[ts]` 和 `services[py]`） |
| 4 | **merged skeleton 的 `language` 字段歧义**：`mergeSkeletons` 当前取第一个 skeleton 的 language，多语言模块时会丢失其他语言信息 | 中 | 低 | 如果一个模块内有多种语言，`mergeSkeletons` 设置 `language` 为主要语言（文件数最多的），并在 `parseErrors` 中记录 "multi-language module" 提示 |
| 5 | **`BatchOptions.languages` 过滤参数与现有 `force` 参数的交互逻辑复杂度** | 低 | 低 | 在 `runBatch` 开头将 `languages` 过滤逻辑集中处理：先用 `scanFiles` 获取全量文件，再根据 `languages` 参数过滤，保持后续流程不变 |
| 6 | **架构索引模板变更的向后兼容**：新增的 `languageDistribution` section 在 Handlebars 模板中如果数据为空会渲染出空表格 | 低 | 低 | 使用 `{{#if languageDistribution}}...{{/if}}` 条件渲染，数据为空时不展示该 section |

## 6. 产品-技术对齐度

### 覆盖评估

| MVP 功能 | 技术方案覆盖 | 说明 |
|---------|-------------|------|
| batch-orchestrator 自动检测项目中存在的语言 | 完全覆盖 | `scanFiles` 新增 `languageStats` 字段，通过 `LanguageAdapterRegistry.getAdapter()` 按扩展名统计 |
| 按语言分组构建各自的依赖图 | 完全覆盖 | batch-orchestrator 中新增 `groupFilesByLanguage()`，对 JS/TS 用 dependency-cruiser，其他语言用 `buildDirectoryGraph()` 兜底 |
| 跨语言模块的 spec 中标注语言边界 | 部分覆盖 | frontmatter 增加 `language` 和 `crossLanguageRefs` 字段。但跨语言调用（如 REST/FFI）无法通过 AST 自动检测，需人工补充 |
| 架构索引增加语言分布信息 | 完全覆盖 | `ArchitectureIndex` 新增 `languageDistribution` 数组，`index-spec.hbs` 增加"语言分布"表格 |
| MCP `prepare` 返回检测到的语言列表 | 完全覆盖 | `PrepareResult` 新增 `detectedLanguages: string[]` |
| MCP `batch` 支持 `--languages` 过滤参数 | 完全覆盖 | batch 工具的 zod schema 新增 `languages: z.array(z.string()).optional()`，`BatchOptions` 同步增加 `languages` 字段 |
| `scanFiles` 输出被忽略文件的警告 | 完全覆盖 | 现有的 `unsupportedExtensions` 统计和 `console.warn` 已实现基础版本。需增强为按语言名称聚合（如"跳过 12 个 .rs 文件（Rust, 不支持）"） |
| 对 TS + Python + Go 混合项目能分别生成各语言模块的 spec | 完全覆盖 | 语言分组后各组独立走 `module-grouper` → `single-spec-orchestrator` 流水线 |

### 扩展性评估

本方案具备良好的扩展性：

1. **新增语言支持**: 只需实现新的 `LanguageAdapter` 并在 `bootstrapAdapters()` 中注册，无需修改 batch-orchestrator 或 index-generator。
2. **精确依赖图升级**: 当 Python/Go 的 adapter 实现了 `buildDependencyGraph` 后，`batch-orchestrator` 自动使用精确版本替代 `buildDirectoryGraph` 兜底方案（通过 `adapter.buildDependencyGraph?.()` 判断）。
3. **跨语言调用检测**: 未来可引入基于配置文件（如 `.reverse-spec.yaml` 中声明跨语言边界）或 LLM 辅助分析的方式，无需修改核心流水线。
4. **语言特定的 noise-filter**: 每个 LanguageAdapter 可以扩展 `getNoisePatterns()` 方法，返回该语言特有的噪音过滤规则。

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| AST 精确性优先 | 兼容 | 对有 AST 支持的语言（TS/Python/Go/Java）均通过 tree-sitter 或 ts-morph 进行精确解析 |
| 混合分析流水线（预处理 -> LLM -> 验证） | 兼容 | 多语言模块仍遵循三阶段流水线，language terminology 参数化保证 LLM prompt 适配目标语言 |
| 只读安全性 | 兼容 | 所有新增逻辑均为只读分析，不修改源文件 |
| 纯 Node.js 生态（web-tree-sitter WASM） | 兼容 | 无新增运行时依赖，轻量级依赖图通过纯 Node.js 实现 |
| 不支持语言降级为 LLM 模式 | 兼容 | `scanFiles` 已通过 `unsupportedExtensions` 过滤不支持的语言文件，不会进入 LLM 流水线 |

## 7. 结论与建议

### 总结

Feature 031（多语言混合项目支持）在现有架构基础上可以平滑实现，无需引入新的运行时依赖。核心技术路线为：

1. **`scanFiles` 轻量增强**：在现有 `unsupportedExtensions` 统计基础上，新增 `languageStats` 字段记录各语言文件分布，增强不支持语言的警告信息。
2. **`batch-orchestrator` 语言分组**：在扫描后按 `LanguageAdapterRegistry.getAdapter()` 将文件分组，对每组调用对应 adapter 的 `buildDependencyGraph`（如有）或兜底的 `buildDirectoryGraph`，最终合并为统一拓扑排序。
3. **`ArchitectureIndex` 增加语言分布**：新增 `languageDistribution` 字段和模板 section。
4. **MCP 工具增强**：`prepare` 返回 `detectedLanguages`，`batch` 新增 `languages` 过滤参数。

关键技术决策：
- 选择方案 B（Post-Scan Grouping），向后兼容，影响面最小
- 对无 dependency-cruiser 支持的语言，用 AST import 推断 + 目录结构构建轻量级依赖图
- 跨语言边界 MVP 阶段仅做标注，不尝试精确检测跨语言调用

### 对产研汇总的建议

- 建议 1: 本特性的核心价值在于让 reverse-spec 能处理真实世界的多语言 monorepo 项目。优先保证"各语言模块独立生成 spec"的基本功能，跨语言调用检测可作为后续迭代目标。
- 建议 2: 最大的技术风险是非 JS/TS 语言缺乏精确的依赖图工具，建议在验收标准中明确"非 JS/TS 语言的依赖图精度为 medium，基于目录结构推断"。
- 建议 3: `module-grouper` 的语言感知分组是本特性实现复杂度最高的部分，建议优先实现，并编写充分的单元测试（包含同目录多语言文件的场景）。
- 建议 4: 预计影响文件列表（按变更量排序）：
  1. `src/batch/batch-orchestrator.ts` — 核心变更（语言分组 + 分组依赖图构建 + 合并逻辑）
  2. `src/batch/module-grouper.ts` — 语言感知分组策略
  3. `src/generator/index-generator.ts` — 新增 `languageDistribution`
  4. `src/utils/file-scanner.ts` — 新增 `languageStats` 统计
  5. `src/mcp/server.ts` — MCP 工具参数增强
  6. `src/models/module-spec.ts` — Schema 扩展
  7. `src/models/dependency-graph.ts` — 可能新增 `language` 字段到 `GraphNode`
  8. `templates/index-spec.hbs` — 增加"语言分布"section
  9. `src/core/single-spec-orchestrator.ts` — frontmatter 增加 `language` 字段
  10. 新增 `src/graph/directory-graph.ts` — 轻量级依赖图构建函数
