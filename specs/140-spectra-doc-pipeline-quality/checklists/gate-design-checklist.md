# GATE_DESIGN 审查 Checklist — Feature 140

> 用户在硬门禁暂停时，按本 checklist 审查 spec.md 是否可以放行进入 plan 阶段。
> 每条验证依据标注 spec.md 或 research 文档中的具体章节/字段。

---

## 1. 范围合规

- [ ] **1.1** `spectra audit` 子命令明确排除在范围外（spec.md §范围边界 → 不在范围，注明"Q8 决议，留 v4.2.0"）
- [ ] **1.2** symbol-level graph 明确排除（spec.md §不在范围，标注"Feature 141 / v4.2.0"）
- [ ] **1.3** 多层级 hierarchy（GraphRAG 的 C0-C3）明确排除（spec.md §不在范围 + research/02 §六）
- [ ] **1.4** Recursive reduce 明确排除（spec.md §不在范围）
- [ ] **1.5** Embedding-based dedup（MinHash/LSH）明确排除（spec.md §不在范围）
- [ ] **1.6** Streaming reduce 明确排除（spec.md §不在范围）
- [ ] **1.7** 自适应 cluster size 明确排除（spec.md §不在范围，注明"固定 minSize=3 / maxSize=15"）
- [ ] **1.8** GPU 嵌入索引 / 向量库明确排除（spec.md §不在范围）
- [ ] **1.9** Confidence learning（基于历史校准）明确排除（spec.md §不在范围）
- [ ] **1.10** `--no-cluster` CLI flag 明确排除（spec.md §不在范围，注明"Q15 决议，< 5 模块自动 single 兜底"）
- [ ] **1.11** 跨 batch 缓存 / 增量更新明确排除（spec.md §不在范围）
- [ ] **1.12** 在范围项与 research/01-feature-plan.md 的业务范围描述一致，无超范围功能悄然混入

---

## 2. 决策一致性

- [ ] **2.1** Q2 决议（hardcoded ADR candidates 全删）：spec.md FR-003 明确描述"删除全部 8 个 hardcoded candidate 函数"，无保留路径
- [ ] **2.2** Q3 决议（evidence 真实性自动校验）：spec.md FR-005 描述程序化校验（file 存在 / 行号 / snippet 字符匹配），无仅依赖 LLM 自评的表述
- [ ] **2.3** Q4 决议（--include-docs 默认值保持 false）：spec.md FR-010 描述行为以 `--include-docs=true` 为条件，未改变默认值
- [ ] **2.4** Q5 决议（100k chunk size，非 1M）：spec.md FR-001 / NFR-002 描述 chunk budget=100k，无"1M 默认 budget"字样
- [ ] **2.5** Q6 决议（旧 ADR 保留 + supersede notice）：spec.md FR-006 描述旧文件保留、frontmatter status 改为 superseded，无删除旧文件的表述
- [ ] **2.6** Q9 决议（仅 Reduce 优先 opus，Map=sonnet）：spec.md FR-004 明确"Map=sonnet / Reduce 优先 opus"，与 research/02 §三一致
- [ ] **2.7** Q10 决议（3-pass critique）：spec.md FR-008 描述 6 阶段（A-F），包含独立 Critique（Phase D）和 Refine（Phase E），与 research/02 §四一致
- [ ] **2.8** Q11 决议（orchestrator 不单独成 Feature，作为 Phase 0）：spec.md §范围边界"在范围"第一条明确描述，未拆分为独立 Feature
- [ ] **2.9** Q12 决议（maxConcurrency=4）：spec.md FR-001 / FR-002 描述 maxConcurrency=4，与 research/02 §二一致
- [ ] **2.10** Q13 决议（沿用 Louvain，不引入 Leiden）：spec.md FR-002 明确"复用现有 graphology-communities-louvain"，依赖表中未出现 Leiden / igraph-js
- [ ] **2.11** Q14 决议（cluster maxSize=15）：spec.md FR-002 描述 minSize=3 / maxSize=15
- [ ] **2.12** Q15 决议（不加 --no-cluster flag）：spec.md §不在范围明确标注，FR-002 描述自动 single 兜底逻辑

---

## 3. 架构对齐

- [ ] **3.1** ADR pipeline 重构使用 clusterDispatch（MapReduce）而非单 pass 大上下文：spec.md FR-003 / FR-004 描述 Map + Reduce 两阶段，无"单 pass 整体喂入"表述
- [ ] **3.2** architecture-narrative pipeline 使用 MapReduce（FR-008 的 Phase A-F）而非单 pass：spec.md FR-008 明确描述 6 阶段；Phase A 复用 ADR cluster 划分
- [ ] **3.3** hyperedges pipeline 接入 cluster orchestrator（不是独立实现各自 MapReduce）：spec.md FR-007 描述走 orchestrator；与 research/02 §五一致
- [ ] **3.4** 三个生成器共享同一 clusterDispatch 函数：spec.md FR-001 描述通用泛型接口 `clusterDispatch<TIn, TMap, TRed>`，FR-003/FR-008/FR-007 均引用此接口
- [ ] **3.5** narrative Reduce 阶段使用 sonnet（非 opus）：spec.md FR-008 描述"Phase C Reduce（sonnet）"，符合 research/02 §四"narrative 不需要 opus"的设计选择
- [ ] **3.6** cluster orchestrator 实施为 Phase 0（先于三个 pipeline 改造）：spec.md 复杂度评估节提及 Phase 0；与 research/02 §七"基础设施先行"一致

---

## 4. DoD 可机器验证

- [ ] **4.1** DoD-1（ADR distinct 率=100%）：可通过 grep/脚本对比 4 fixture 的 ADR 标题集合，判断是否有重复，完全程序化
- [ ] **4.2** DoD-1（evidenceRefs verified=true 占比 ≥90%）：可读取 ADR frontmatter JSON 统计字段，数值比较
- [ ] **4.3** DoD-1（ADR evidenceRefs source/location 真实存在）：程序化校验逻辑在 FR-005 已明确，可断言
- [ ] **4.4** DoD-2（hyperedges.length ≥ 1）：直接 JSON.parse(graph.json).hyperedges.length 判断，程序化
- [ ] **4.5** DoD-3（narrative ≥3 个项目特有技术术语）：可读取 module spec 接口表头构建词表，再 grep narrative，程序化
- [ ] **4.6** DoD-3（narrative 不含模板字符串）：grep 查找"项目子域目录，覆盖 N 个模块"字样，程序化
- [ ] **4.7** DoD-4（--include-docs 日志无"跳过"字样）：grep batch 日志输出，程序化
- [ ] **4.8** DoD-5（graph.html 始终存在）：断言文件路径 `_meta/graph.html` 存在，程序化
- [ ] **4.9** DoD-6（costBreakdown 字段存在）：读取 frontmatter YAML schema 校验，程序化
- [ ] **4.10** DoD-6（contextTruncated=false 在默认 budget 下）：frontmatter 字段布尔值断言，程序化
- [ ] **4.11** DoD-6（--context-budget 5000 触发 contextTruncated=true）：特定参数运行 + 字段断言，程序化
- [ ] **4.12** DoD-7（现有 2232 测试零新增失败）：`npx vitest run` 零新增失败，完全程序化
- [ ] **4.13** DoD-9（cluster 数符合预期范围）：micrograd=1 / nanoGPT=2-4 / ky=3-5 / empty=0，程序化统计
- [ ] **4.14** DoD-10（100 文件 fixture batch < 10 min）：计时断言，程序化
- [ ] **4.15** DoD-11（跨 cluster 决策捕获）：此条标注为"手动验证"，**非程序化**——需确认是否可改为脚本断言"存在 ≥1 条 ADR 的 evidenceRefs 来自 ≥2 个不同 clusterSourceId"

---

## 5. 依赖完整

- [ ] **5.1** Feature 131（hyperedges schema v2.0）已声明为产物依赖：spec.md frontmatter `dependsOn` + §依赖与前置表格，注明"直接复用，不修改 schema"
- [ ] **5.2** Feature 135（v4.0.1 fail-loud hotfix 基础设施）已声明为代码依赖：spec.md frontmatter `dependsOn` + §依赖与前置，注明"沿用 _PIPELINE_DISABLED.md 模式"
- [ ] **5.3** `graphology-communities-louvain`（现有库）已声明为库依赖：spec.md §依赖与前置，注明"复用现有实现，不引入 Leiden"
- [ ] **5.4** `src/panoramic/community/`（现有代码）已声明为代码复用依赖：spec.md §依赖与前置
- [ ] **5.5** `src/core/context-assembler.ts`（改造目标）已声明：spec.md §依赖与前置，注明"改造为 AST 调用图相关性排序 + 截断，不重写"
- [ ] **5.6** `src/batch/batch-orchestrator.ts`（改造目标）已声明：spec.md §依赖与前置
- [ ] **5.7** sindresorhus/ky（外部 fixture）已声明测试依赖及管理方式：spec.md §依赖与前置，注明"通过 git submodule 或 snapshot 管理"

---

## 6. MapReduce 反模式排除

> 验证 research/02-mapreduce-architecture.md §六 的 10 项不做清单在 spec.md 中均有对应排除（通过"不在范围"或 FR/NFR 约束）

- [ ] **6.1** 固定大 prompt（单 pass 全 repo）：NFR-002 约束每 Map call input ≤ 100k tokens，从架构上排除
- [ ] **6.2** 跨 chunk 依赖未声明：FR-001 的 `sharedHeader` 机制提供全局 inventory，排除此反模式
- [ ] **6.3** Reduce 阶段幻觉级联：FR-005 evidence 程序化真实性校验 + Zod 结构化 output（research/02 §三）排除
- [ ] **6.4** Naive merging without alignment：FR-001 Reduce 阶段有 `sharedHeader` 对齐上下文
- [ ] **6.5** 每 cluster 独立处理忽略全局：FR-001 `sharedHeader` 机制覆盖
- [ ] **6.6** 多层级 hierarchy：spec.md §不在范围明确排除
- [ ] **6.7** Recursive reduce：spec.md §不在范围明确排除
- [ ] **6.8** Embedding-based dedup（MinHash/LSH）：spec.md §不在范围明确排除
- [ ] **6.9** Streaming reduce：spec.md §不在范围明确排除
- [ ] **6.10** GPU 嵌入索引 / 向量库：spec.md §不在范围明确排除

---

## 7. 独立可测试性

- [ ] **7.1** US-001（ADR MapReduce）独立可测试：spec.md US-001 明确"cluster orchestrator（Phase 0）和 evidence 校验逻辑（Phase 3c）分别独立可测试；evidence 验证不依赖 LLM"
- [ ] **7.2** US-002（hyperedges）独立可测试：spec.md US-002 明确"designDocAbsPaths 扩展是纯程序化代码，独立于 LLM 调用可单测；integration test 可 mock LLM 验证数据流"
- [ ] **7.3** US-003（narrative）独立可测试：spec.md US-003 明确"3-pass 中每个 pass 是独立 LLM 调用，可分别 mock 测试；domain-words 校验是纯文本匹配"
- [ ] **7.4** US-004（--include-docs）独立可测试：spec.md US-004 明确"日志变更和数据流变更都是独立代码路径修改，无 LLM 依赖，单测即可覆盖"
- [ ] **7.5** US-005（graph.html）独立可测试：spec.md US-005 明确"文件生成逻辑纯程序化，fixture 集成测试直接断言文件存在"
- [ ] **7.6** US-006（token 可观测）独立可测试：spec.md US-006 明确"frontmatter 字段写入和 batch summary 打印是独立功能，可 mock token 计数器分别测试"
- [ ] **7.7** 6 个 US 无循环依赖锁死：Phase 0（orchestrator）先行，Phase 3a（hyperedges）→ Phase 3b（narrative）→ Phase 3c（ADR）的序列保证各 US 可独立交付

---

## 8. 风险覆盖

> 验证 research/02-mapreduce-architecture.md §八 的 8 条风险登记表，spec.md 中有对应缓解措施

- [ ] **8.1** 跨 cluster 决策被丢失：spec.md FR-001 的 `sharedHeader` 机制 + Reduce 用 opus（FR-004）+ confidence 分级（FR-001 diagnostics.mergeConfidence）三层防护
- [ ] **8.2** Reduce 阶段幻觉级联：spec.md FR-005 程序化 evidence 校验（verified 字段）+ Zod 结构化 schema 约束
- [ ] **8.3** Cluster 划分不均（超 token 预算）：spec.md NFR-002 描述 maxSize=15 硬上限 + 超出截断 + clusterTruncated 标记
- [ ] **8.4** Map 并发过高导致 API 429：spec.md FR-001 描述 maxConcurrency=4 默认值（可配）
- [ ] **8.5** 单 cluster Map 失败导致整体不完整：spec.md FR-001 描述"< 50% Map 成功时 fail-closed"阈值兜底
- [ ] **8.6** Cluster 划分崩溃（community detection 失败）：spec.md FR-002 描述三级 fallback chain（community → directory → single）
- [ ] **8.7** Opus quota 耗尽导致 Reduce 失败：spec.md FR-004 描述"Opus 不可用时降级 sonnet + 记录 confidence: medium"+ NFR-004 描述 Reduce 重试 1 次 + fail-closed + _PIPELINE_FAILED.md
- [ ] **8.8** 小项目（<5 模块）走 MapReduce 是 overhead：spec.md FR-002 描述"< 5 模块自动 single 兜底，跳过 Map 直接喂 Reduce"

---

## 审查摘要

| 维度 | 总条数 | 说明 |
|------|--------|------|
| 1. 范围合规 | 12 | 验证 12 个明确排除项在 spec.md 中均有文字记载 |
| 2. 决策一致性 | 12 | 验证 Q2-Q15 关键决议无再议 |
| 3. 架构对齐 | 6 | 验证 6 子能力均用 MapReduce 且共享 orchestrator |
| 4. DoD 可机器验证 | 15 | 其中 DoD-11 需额外确认是否可程序化 |
| 5. 依赖完整 | 7 | 验证 7 个依赖项全部声明 |
| 6. MapReduce 反模式排除 | 10 | 验证 research/02 §六的 10 项不做在 spec.md 有对应 |
| 7. 独立可测试性 | 7 | 验证 6 US 可独立交付 + 无循环依赖 |
| 8. 风险覆盖 | 8 | 验证 research/02 §八的 8 条风险有缓解措施 |
| **合计** | **77** | |

> **放行条件**：全部 77 条通过（4.15 如确认无法程序化需附说明）方可进入 plan 阶段。
