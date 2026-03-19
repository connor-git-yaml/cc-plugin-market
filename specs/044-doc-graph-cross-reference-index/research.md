# Research Summary: 文档图谱与交叉引用索引

## 调研模式

- mode: `tech-only`
- reason: 当前需求是 Phase 2 的内部基础设施能力，主要涉及现有 `ModuleSpec`、批处理编排和渲染模板的技术整合，不需要额外的产品调研。

## 结论

1. 044 不应实现为新的 `DocumentGenerator`。蓝图将其定义为共享基础设施，交付物是 `DocGraphBuilder` 与 `CrossReferenceIndex`，而不是新的终端文档类型。
2. 文档图谱的最佳输入不是单一来源：
   - “源码模块/引用”来自现有 `DependencyGraph`
   - “模块 -> spec 映射”来自 `ModuleSpec.frontmatter.sourceTarget` 与 `outputPath`
   - “是否已互链”需要从 on-disk spec Markdown 读取一个稳定标记
3. 交叉引用的最佳注入点不是 LLM 输出，而是 `ModuleSpec -> renderSpec()` 之间的结构化阶段。这样可以避免污染 LLM prompt，也能保证 Claude/Codex provider 行为一致。
4. 044 需要为 046 预留共享结果，因此除了给 spec 渲染链接，还必须输出可序列化的图谱 JSON。

## 现有代码观察

### 1. Spec 渲染链路

- `src/core/single-spec-orchestrator.ts`
  - 构建 `ModuleSpec`
  - 调用 `renderSpec(moduleSpec)`
  - 写入 `*.spec.md`
- `src/generator/spec-renderer.ts`
  - 当前只负责 Handlebars 渲染和 baseline comment 注入
- `templates/module-spec.hbs`
  - 当前没有“关联 Spec”区块，也没有稳定锚点可供别的 spec 链接

### 2. 批处理链路

- `src/batch/batch-orchestrator.ts`
  - 已收集 `collectedModuleSpecs`
  - 已持有文件级 `DependencyGraph`
  - 已有 `groupFilesToModules()` 的模块聚合结果
  - 在 `_index.spec.md` 写入前有一个天然的 044 接入点

### 3. 图粒度

- `DependencyGraph.modules` 是文件级节点
- `groupFilesToModules()` 将文件级图聚合为目录/模块级分组
- 但 root 散文件在 batch 中可能仍是“单文件一个 spec”，因此 044 不能只依赖模块目录分组，必须支持“目录 spec + 单文件 spec”混合映射

### 4. ProjectContext 与已有 spec

- `src/panoramic/project-context.ts` 已能发现 `existingSpecs`
- 因为 batch 存在 skip 路径，044 需要能够从磁盘读取已有 spec 的最小元信息，而不是只看当前内存里的 `ModuleSpec[]`

## 设计决策

### A. DocGraphBuilder 是纯基础设施模块

新增 `src/panoramic/doc-graph-builder.ts`，职责：

- 从 `DependencyGraph + ModuleSpec[] + on-disk spec metadata` 构建统一图谱
- 产出：
  - `sourceToSpec` 映射
  - `sameModuleRefs`
  - `crossModuleRefs`
  - `missingSpecNodes`
  - `unlinkedSpecNodes`
- 提供 JSON/debug 输出能力，供 046 直接复用

### B. CrossReferenceIndex 是渲染前增强器

新增 `src/panoramic/cross-reference-index.ts`，职责：

- 将 DocGraph 转为每个 `ModuleSpec` 的结构化链接索引
- 给 `ModuleSpec` 注入：
  - 同模块引用链接（自链接 + 内部引用计数/样例）
  - 跨模块引用链接（目标 spec 路径 + 稳定 anchor）
- 不负责统计缺口，不负责 coverage 结论

### C. 稳定 anchor 方案

修改 `templates/module-spec.hbs`：

- 在标题前加入稳定锚点，例如 `<a id="module-spec"></a>`
- 新增“关联 Spec”区块
- 在有交叉引用时写入隐藏标记，例如 `<!-- cross-reference-index: auto -->`

这样 DocGraphBuilder 在扫描已生成 spec 时可以可靠判断“已互链”还是“未互链”。

### D. 同模块引用的定义

同模块引用不是文件链接，而是“多个文件级 import 最终归并到同一份模块 spec”的自链接摘要。

原因：

- 当前最终产物是模块级 spec，不是文件级 spec
- 对目录模块而言，多个内部文件互相 import 时，唯一稳定的文档目标仍然是当前模块 spec 自身

## 风险

1. root 散文件模块与目录模块并存时，映射规则容易错配。
2. `module-spec.hbs` 增加区块后，需要同步修正 golden tests / render tests。
3. 如果 doc graph 只在 batch 中构建，单模块 generate 路径不会自动带交叉链接；需要明确本 Feature 的覆盖边界。

## 实施建议

1. 先实现纯函数化 DocGraphBuilder，并用单元测试锁定映射规则。
2. 再实现 CrossReferenceIndex 和模板扩展。
3. 最后在 batch 中接入：构图 -> 注入链接 -> 重渲染 spec -> 写 doc-graph debug JSON。
