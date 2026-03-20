# Technical Research: 增量差量 Spec 重生成

## 现有基座

### 1. skeleton hash 已存在

- `src/core/single-spec-orchestrator.ts` 在生成 spec 时把合并骨架哈希写入 frontmatter
- `src/generator/frontmatter.ts` 已定义 `skeletonHash`

这意味着 049 可以直接复用既有 spec 作为“上次快照”，无需另建缓存文件。

### 2. DocGraph 已能做 source -> spec owner 映射

- `src/panoramic/doc-graph-builder.ts` 的 `resolveSpecForSource()` 已支持 `sourceTarget`、`relatedFiles`、`prefix` 三层匹配
- 044/046 已验证旧 spec 和当前 run 的混合图谱可以稳定工作

这意味着 049 的“受影响源码文件映射到受影响 spec”可以复用现有 044 模型。

### 3. batch 当前缺的是“沿用旧 spec”的装配层

当前 `runBatch()` 只收集本次新生成的 `ModuleSpec[]`。一旦只重生成部分模块，后续 `_index.spec.md`、`_doc-graph.json`、`_coverage-report.*` 会缺失未重生成模块，因此必须补“旧 spec 摘要扫描”。

## 设计结论

### Decision 1: 增量模式入口放在 batch CLI

采用 `reverse-spec batch --incremental`，而不是新增独立子命令。

理由：
- 049 本质上是 batch 的调度增强
- 与 `--force` / `--output-dir` 共享现有入口最自然
- 更容易复用 checkpoint、summary、coverage、index 的既有管线

### Decision 2: 直接变更按 sourceTarget 粒度比较 skeletonHash

对普通模块，sourceTarget 为目录（如 `src/api`）；对 root 散文件，sourceTarget 为单文件路径（如 `src/entry.ts`）。

理由：
- 与已有 spec frontmatter 合同一致
- 能覆盖目录模块与 root 散文件两种生成方式

### Decision 3: 级联传播按“文件反向依赖 -> spec owner”做，而不是仅按模块边

理由：
- 模块级边在 `root` 场景过粗，容易把无关散文件一起误判
- 文件级反向遍历更贴近真实影响范围
- 最终仍通过 doc graph owner resolution 汇总到 spec 粒度，契合 044

### Decision 4: 旧 spec 只解析最小摘要，不回构完整 ModuleSpec

旧 spec 摘要至少包含：
- `sourceTarget`
- `relatedFiles`
- `version`
- `confidence`
- `skeletonHash`
- `linked`
- `intentSummary`
- `outputPath`

理由：
- 049/044/046/index 只需要这些字段
- 避免为“未重生成文档”伪造完整 `ModuleSpec`

### Decision 5: 不确定时扩大重生成范围

保守策略如下：
- 旧 spec frontmatter 损坏 -> 重生成对应 sourceTarget
- 无法解析 skeleton hash -> 重生成对应 sourceTarget
- 无法从 source file 反查 owner -> 回退当前 file 所属 sourceTarget

不采用“静默忽略变化”的激进策略，避免漏更新。
