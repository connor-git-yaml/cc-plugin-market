# Feature 041 技术决策研究

**Feature**: 跨包依赖分析 (cross-package-deps)
**日期**: 2026-03-19
**调研模式**: tech-only

---

## Decision 1: WorkspacePackageInfo[] 到 DependencyGraph 的转换策略

**决策**: 在 CrossPackageAnalyzer.extract() 中直接构建 DependencyGraph 对象，复用现有 `DependencyGraph` Zod Schema 定义的类型结构。

**理由**:
- `DependencyGraph` 已定义 `modules: GraphNode[]`、`edges: DependencyEdge[]`、`sccs: SCC[]` 等字段，与包级依赖关系完全对应
- `detectSCCs()` 和 `topologicalSort()` 均接受 `DependencyGraph` 类型参数，直接复用无需适配层
- 每个 `WorkspacePackageInfo` 映射为一个 `GraphNode`（`source = name`），每条内部依赖映射为一条 `DependencyEdge`（`from = pkg.name, to = dep`）

**替代方案**:
- A: 引入新的 `PackageDependencyGraph` 中间类型 -- 拒绝，因为增加不必要的类型冗余，且需要额外适配图算法
- B: 不构建完整 DependencyGraph，直接在 generate() 中手动实现 SCC 检测 -- 拒绝，违背 FR-005 "复用 detectSCCs()" 的要求

---

## Decision 2: extract() 中复用 WorkspaceIndexGenerator 的方式

**决策**: 在 CrossPackageAnalyzer.extract() 内部实例化 `WorkspaceIndexGenerator` 并调用其 `extract()` 方法获取 `WorkspaceInput`（包含 packages 列表）。

**理由**:
- `WorkspaceIndexGenerator.extract()` 已实现完整的 workspace 检测逻辑（npm/pnpm/uv 三种类型），包括 glob 展开、子包元信息提取、内部依赖匹配
- 复用而非复制，确保两个 Generator 对同一项目的子包列表保持一致
- `WorkspaceInput.packages` 中的 `dependencies` 字段已包含 workspace 内部依赖名称列表，是构建 DependencyGraph 所需的全部信息

**替代方案**:
- A: 通过 GeneratorRegistry.get('workspace-index') 获取实例 -- 拒绝，因为引入了对 Registry 初始化顺序的隐式依赖
- B: 将 workspace 解析逻辑提取为独立的 utility 函数 -- 理想方案但超出 041 范围，属于未来重构项

---

## Decision 3: Mermaid 循环边标注方案

**决策**: 对 SCC 内部的边使用 `-.->` 虚线箭头 + `style` 指令设置红色，SCC 内部节点使用 `:::cycle` class 标注红色背景。

**理由**:
- Mermaid `graph TD` 原生支持 `-.->` 虚线箭头语法和 `classDef` 自定义样式
- 红色虚线（`stroke:red`）+ 红色背景（`fill:#ffcccc`）提供双重视觉信号，满足 FR-008 和 FR-017
- 需要先运行 SCC 检测，构建 "SCC 内部节点集合" 和 "SCC 内部边集合"，在 Mermaid 生成阶段根据集合判断

**替代方案**:
- A: 仅使用边标签 `-->|cycle|` 标注 -- 拒绝，视觉区分度不足，不满足 FR-008 的"红色虚线"要求
- B: 使用 Mermaid `subgraph` 将 SCC 包围 -- 拒绝，嵌套 subgraph 对多组独立 SCC 场景渲染效果不佳

---

## Decision 4: 拓扑排序层级展示格式

**决策**: 在文档中以表格形式展示层级信息（Level 0 / Level 1 / ...），每层列出对应的子包名称列表。

**理由**:
- `topologicalSort()` 已返回 `levels: Map<string, number>`，直接按 level 分组即可
- 表格形式清晰展示构建顺序和包的深度，用户可直观理解"哪些包可并行构建"
- Level 数值越小越接近底层（无依赖），越大越接近顶层（最终消费者）

**替代方案**:
- A: 仅列出拓扑排序的线性顺序 -- 拒绝，丢失了层级（可并行度）信息
- B: 使用 Mermaid 分层布局替代表格 -- 拒绝，Mermaid graph TD 已隐含层级，重复渲染无额外价值

---

## Decision 5: Handlebars 模板与 040 模板的关系

**决策**: 新建独立模板 `templates/cross-package-analysis.hbs`，不复用 `templates/workspace-index.hbs`。

**理由**:
- 040 模板面向"索引/清单"场景（按目录分组列出子包），041 模板面向"分析报告"场景（拓扑图、循环检测、统计信息），结构差异大
- 独立模板避免了条件分支导致的模板膨胀，两个 Generator 各自维护自己的模板，关注点分离
- 041 模板需要包含：循环依赖警告区块、统计摘要、拓扑排序层级表——这些在 040 模板中不存在

**替代方案**:
- A: 扩展 040 模板，用 `{{#if hasCycles}}` 条件块 -- 拒绝，两个 Generator 的 Output 类型不同，模板数据结构不兼容

---

## Decision 6: 统计信息（root/leaf 包）的计算位置

**决策**: 在 `generate()` 步骤中计算，基于构建的 DependencyGraph 的 `GraphNode.inDegree` 和 `outDegree`。

**理由**:
- `GraphNode` 已有 `inDegree` 和 `outDegree` 字段，root 包 = `inDegree === 0`，leaf 包 = `outDegree === 0`
- 在 `generate()` 中计算是因为此时已有完整的 DependencyGraph（含边信息），可准确计算度数
- 计算逻辑简单（遍历节点过滤），无需额外依赖

**替代方案**:
- A: 在 extract() 中计算 -- 拒绝，extract() 负责数据提取而非分析，职责分离不当
- B: 在 render() 中通过 Handlebars helper 计算 -- 拒绝，模板中不应包含业务逻辑

---

## Decision 7: 自依赖和无效依赖的处理

**决策**: 在构建 DependencyGraph 时静默过滤，不产生错误。

**理由**:
- spec.md Edge Cases 明确要求：自依赖应忽略，不视为循环依赖；不存在的内部依赖应忽略
- 过滤逻辑在 `extract()` 构建 edges 时实现：`if (dep !== pkg.name && packageNameSet.has(dep))`
- `WorkspaceIndexGenerator.extract()` 已对外部依赖做了过滤（仅保留 `allPackageNames.has(depName)` 的），但未过滤自依赖，需在 041 中补充

**替代方案**: 无合理替代方案，spec 明确要求此行为。
