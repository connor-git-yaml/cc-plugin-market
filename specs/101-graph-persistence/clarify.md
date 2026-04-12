---
type: clarify
feature: 101-graph-persistence
date: 2026-04-12
questions_count: 5
---

# 需求澄清：graph-persistence

## Q1: 三数据源节点 ID 冲突时的合并策略不完整

**欠规范区域**: FR-101-02「节点去重策略」— 仅描述了"同一 `filePath`"的合并逻辑，但三个数据源的节点 ID 体系各自不同：`ArchitectureIRElement` 使用 `element.id`（任意字符串），`DocGraphSpecNode` 使用 `specPath`（文件路径），`CrossReferenceLink` 中的端点 ID 格式未明确定义。

**问题**: 当两个来源的节点指向同一实体但 ID 格式不同时（例如 `ArchitectureIRElement.id = "cli-module"` vs `DocGraphSpecNode.specPath = "src/cli/index.ts"`），`filePath` 字段作为合并 key 是否足够？`ArchitectureIRElement` 是否一定携带 `filePath` 属性？若某节点没有 `filePath`（如 `external-system` 类型），去重 key 如何确定？

**建议答案**: 明确规定：（1）`ArchitectureIRElement` 必须有 `filePath` 字段才参与去重，否则以 `element.id` 为唯一 key 独立存入；（2）`CrossReferenceLink` 的端点用 `fromModule`/`toModule` 的文件路径作为节点 ID；（3）去重 Map 的 key 统一为 `filePath`（优先）或 `id`（fallback），并在 `metadata` 中保留 `sourceId` 字段记录原始 ID。

**影响**: 不澄清会导致 `buildKnowledgeGraph()` 产生重复节点（同一模块出现两次），下游 Feature 102 社区检测算法的图结构不正确；或反之，本应独立的 external-system 节点被错误合并。

---

## Q2: `--directed` 标志对边去重和方向语义的影响未定义

**欠规范区域**: FR-101-02「函数签名」中 `directed?: boolean` 参数和 FR-101-04「CLI 接口」的 `--directed` 标志仅说明"是否生成有向图，默认 false"，但未定义有向/无向模式下的边处理差异。

**问题**: 在无向图模式（默认）下，若数据源同时存在 `A→B` 和 `B→A` 两条边（例如两个模块互相 import），是否视为重复边需要合并为一条？若合并，合并后的 `confidence` 取哪条？另外，`ArchitectureIRRelationship` 中 `'contains'` 关系具有天然方向性，在无向图模式下是否仍保留方向语义？

**建议答案**: 明确规定：（1）无向图模式下，`source`/`target` 对按字典序标准化（`min(source,target)` 作为 source），相同 `(source,target,relation)` 三元组仅保留 `confidenceScore` 最高的一条边；（2）有向图模式下保留全部边，不去重；（3）`contains` 等语义强制有向的关系，即使在无向图模式下，也在 `metadata` 中保留 `originalDirection` 字段供消费方参考。

**影响**: 不澄清会导致无向图中出现冗余的双向边，使 Feature 102 的社区检测算法将两个互相依赖的模块计算为双倍权重，产生偏斜的社区结构。

---

## Q3: graph.json 格式版本演进策略缺失

**欠规范区域**: 数据模型「GraphJSON」章节及 NFR-101-02「兼容性」—— 对 `ArchitectureIRRelationship` 向后兼容有明确说明，但对 `graph.json` 文件本身的版本演进完全没有规定。

**问题**: 若 Feature 102/105/107 需要在 `GraphNode` 或 `GraphEdge` 中新增字段（或 `graph.graph` 元数据中新增必填字段），现有 `graph.json` 文件在新版本 Spectra 读取时如何处理？`GraphJSON` 是否需要 `schemaVersion` 字段？旧版本 graph.json 与新版本消费方之间的兼容策略是什么（全量重建 vs 迁移 vs 忽略未知字段）？

**建议答案**: 在 `graph.graph` 元数据中新增 `schemaVersion: string` 字段（当前值 `"1.0"`），供 Feature 102/105/107 在读取时做版本检测。规定消费方策略：（1）`schemaVersion` 缺失或低于最低兼容版本时，触发全量重建而非报错；（2）`GraphNode`/`GraphEdge` 中未知字段一律忽略（宽松读取）；（3）`graph.json` 的 Zod Schema（当前 DocGraph 采用方案 B 跳过，但 graph.json 作为跨 Feature 合同应优先建立）。

**影响**: 不澄清会导致 Feature 102/105 直接硬读旧格式的 graph.json 而崩溃；或每次格式变更都需要手动清理 `_meta/` 目录，无法做到平滑升级。

---

## Q4: 大型项目内存使用策略未定义（>5000 节点场景）

**欠规范区域**: NFR-101-01「性能」— 以 5,000 节点 / 10,000 边为基准，目标是"< 10 秒"和"< 5 MB"，但没有定义超出该规模时的行为策略，也未说明三个数据源全部加载到内存的峰值内存预算。

**问题**: （1）当节点数超过 5,000 时（如大型 monorepo），是否有内存上限保护？是直接 OOM 还是有 streaming/分批处理降级？（2）`buildKnowledgeGraph()` 同时持有三份数据源的完整内存副本 + 正在构建的 `GraphJSON`，在极端情况下峰值内存可能是输入数据的 3-4 倍，是否可接受？（3）`spectra graph` CLI 命令独立运行时如何加载数据源——是重新解析项目文件还是依赖缓存？

**建议答案**: 在 NFR 中补充：（1）明确当前版本仅保证 ≤10,000 节点场景的性能目标，超出规模时降级为警告提示而非错误；（2）`buildKnowledgeGraph()` 允许在构建完成后立即 GC 中间对象（节点 Map 等），不保留对原始数据源的引用；（3）CLI 独立运行时优先读取 Feature 100 cache manifest 中的缓存产物，无缓存时走完整解析路径；（4）>10,000 节点的流式/分块处理留给 Future Work（Feature 112 或专项 perf track）。

**影响**: 不澄清会导致大型 monorepo 用户在运行 `spectra batch` 时触发 Node.js 堆溢出；或者 CLI 独立命令因找不到数据源而只能生成空图，与用户预期严重不符。

---

## Q5: 增量更新 vs 全量重建的触发条件未定义

**欠规范区域**: FR-101-03「cache manifest 集成」— 提到"在 cache manifest 中记录 graph.json 的输入 hash，供增量构建判断是否需要重新生成图"，但仅停留在"记录 hash"层面，没有定义何时跳过重建、何时强制重建的完整判断逻辑。

**问题**: （1）hash 是否覆盖三个数据源（`DocGraph` + `ArchitectureIR` + `CrossReferenceIndex`）的联合摘要，还是分别记录各自的 hash？（2）若只有 `DocGraph` 变更而 `ArchitectureIR` 未变，是全量重建还是仅更新 doc-graph 相关的节点和边？（3）`--directed` 标志变化是否触发重建？（4）hash 匹配时完全跳过 `buildKnowledgeGraph()` 调用，还是仅跳过写盘？

**建议答案**: 明确规定：（1）`inputHash` 为三个数据源内容摘要的联合 SHA-256（拼接后取前 16 位），任一数据源变化都触发全量重建（不做局部增量，留给 Feature 112）；（2）`directed` 参数值也纳入 hash 计算的 key 空间（`hash(sources + directed)`）；（3）hash 匹配时完全跳过 `buildKnowledgeGraph()` 和写盘，直接复用现有 `graph.json`，在 batch 日志中输出 `[graph] cache hit, skipping rebuild`；（4）当 `graph.json` 文件不存在时，无论 hash 是否匹配都强制重建。

**影响**: 不澄清会导致两种极端错误：（a）hash 逻辑实现不一致，导致数据源变更后 graph.json 未更新（陈旧图），下游 Feature 102 使用过期数据；（b）每次 batch 都全量重建，失去 Feature 100 cache 的性能收益，与"利用 Feature 100 预留字段"的设计意图矛盾。
