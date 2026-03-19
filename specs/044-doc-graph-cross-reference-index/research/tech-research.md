# Feature 044 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-20

---

## 1. 现有链路中的最佳接入点

- `src/core/single-spec-orchestrator.ts` 已经负责单模块 `ModuleSpec` 生成与首次渲染，但它只知道“当前模块”，不知道全项目依赖关系
- `src/batch/batch-orchestrator.ts` 已经同时拥有：
  - 文件级 `DependencyGraph`
  - 聚合后的模块顺序
  - `collectedModuleSpecs`
- 因此 044 最合适的接入点是 batch 收集完成后，而不是新增独立 CLI 或独立 generator

## 2. 现有数据结构的约束

- `src/models/dependency-graph.ts` 的节点和边都是**文件级**事实，不是目录级模块
- `src/batch/module-grouper.ts` 只是为了 batch 排序把文件图聚合成目录模块
- `src/models/module-spec.ts` 当前没有任何交叉引用字段，也没有可供稳定跳转的 anchor
- `templates/module-spec.hbs` 当前无法表达“相关 Spec”区块

这意味着 044 不能只复用模块分组结果，而必须自己基于：
- `ModuleSpec.frontmatter.relatedFiles`
- `ModuleSpec.frontmatter.sourceTarget`
- 文件级依赖边

来做“文件 -> spec”的真实归属判断。

## 3. 核心设计决策

1. **044 不实现为新的 panoramic generator**
   - 蓝图把 044 定义为共享基础设施，而不是新的最终文档类型
   - 生成器式接入会重复做 extract/render，而 batch 后处理只需做一次共享抽取

2. **拆成两层**
   - `DocGraphBuilder`: 统一构建 `sourceToSpec / references / missingSpecs / unlinkedSpecs`
   - `CrossReferenceIndex`: 将图谱投影为单个 `ModuleSpec` 可渲染结构

3. **same-module 与 cross-module 的判断基于 spec 归属**
   - `fromSpecPath === toSpecPath` → `same-module`
   - `fromSpecPath !== toSpecPath` → `cross-module`

4. **当前模块内部链接使用稳定自链接**
   - 模板新增 `<a id="module-spec"></a>`
   - 同模块关联统一跳到 `#module-spec`

5. **旧 spec 的 linked/unlinked 通过模板标记识别**
   - 新模板输出 `<!-- cross-reference-index: auto ... -->`
   - 磁盘扫描时带标记即视为已互链，否则视为 `unlinked`

## 4. 路径与归属策略

- 优先级：
  1. `sourceTarget` 精确匹配
  2. `relatedFiles` 精确匹配
  3. `sourceTarget/` 最长前缀匹配
- 这样可以覆盖三类场景：
  - 单文件 spec
  - 目录模块 spec
  - root 散文件与目录模块并存

## 5. batch 集成策略

- batch 结束模块处理后：
  1. 扫描输出目录中的既有 spec 元数据
  2. 用 `collectedModuleSpecs` 覆盖本次 run 中同路径 spec 的旧状态
  3. 构建 `DocGraph`
  4. 为当前 run 的 spec 注入 `CrossReferenceIndex`
  5. 重渲染当前 run 的 spec
  6. 写出 `_doc-graph.json`

这样可以同时满足：
- 新 spec 立即获得互链
- 跳过生成的旧 spec 仍可作为可链接目标
- 后续 046 直接复用 JSON 图谱

## 6. 风险与边界

- `force=false` 时，未重写的旧 spec 仍可能保持 `unlinked` 状态；这是预期行为，不应偷偷改写用户未要求重生成的文档
- 输出路径目前依赖 `ModuleSpec.outputPath`，因此 044 必须同时兼容 batch 的绝对路径和测试中的相对路径
- `DependencyGraph` 仍是文件级图，044 不负责目录级 coverage 聚合，这部分留给 046
