# Spectra v4.1 — MapReduce 架构设计

> **状态**：设计定稿，作为 Feature 140 的技术架构基础
> **创建**：2026-04-28
> **配套文档**：[Feature 140 规划](./spectra-v4.1-feature-b-plan.md)（业务范围）
> **本文档定位**：项目级生成器（ADR / narrative / hyperedges）的统一架构，解决"项目规模与模型上下文耦合"的根本问题

---

## 一、设计原则

### 调研结论（4 类系统的共识）

| 系统 | 关键做法 | 我们采用 |
|------|---------|---------|
| Microsoft GraphRAG | Leiden 层级聚类 + 每社区 LLM summary + 多层级 hierarchy（C0-C3）| ✅ 社区聚类思想<br>❌ 多层级 hierarchy（仅用 1 层，避免过度设计）<br>⚠️ 算法用 Louvain（复用现有 `graphology-communities-louvain`，避免新依赖；Leiden 在我们的图规模下边际收益小，详见决策日志 Q13） |
| LangChain MapReduce | Map 用便宜模型 / Reduce 用强模型 / 单层归并 | ✅ Sonnet map / Opus reduce<br>✅ 单层 reduce（不递归）|
| Cursor / Cody | AST 语义切块（按函数/类边界）/ Merkle tree 增量 | ✅ 语义切块（复用现有 module spec 单元）<br>❌ 增量缓存（v4.2 再做）|
| LLMxMapReduce 学术 | Confidence calibration / structured protocols / dedup via MinHash | ✅ Confidence 携带<br>✅ Structured Zod schemas<br>❌ MinHash 自实现（用 LLM 在 reduce 阶段做语义去重）|

### 核心反模式（避开）

1. **固定大 prompt** — 把整个 repo 塞一个 prompt，碰到大项目就崩
2. **跨 chunk 依赖未声明** — 依赖关系全靠 LLM 隐式推断，结果不稳定
3. **Reduce 阶段幻觉级联** — Reduce LLM 没看到原始证据，编造合并结果
4. **Naive merging without alignment** — 不同 chunk 的输出直接拼接，参数干扰
5. **每 cluster 独立处理但完全忽略全局** — Map 阶段缺 shared context

### 设计目标（按优先级）

1. **项目规模解耦**：500 文件项目和 5 文件项目用同一架构；规模只影响 runtime 不影响质量
2. **可在 200k 模型工作**：每个 LLM 调用 input ≤ 100k tokens（默认 Sonnet 4.6 200k 容量内，留 100k 给 output 与缓冲）
3. **失败可观测**：每个 cluster / map / reduce 阶段独立可观测，失败有定位
4. **避免过度设计**：单层 reduce、非递归、不引入 caching/streaming/embeddings 这些可缓的优化

---

## 二、核心抽象：Cluster Orchestrator

新增 `src/panoramic/cluster-orchestrator.ts`，作为所有项目级生成器（ADR / narrative / hyperedges）的统一 dispatch 层。

### 接口

```typescript
// src/panoramic/cluster-orchestrator.ts

export interface ClusterDispatchOptions<TInput, TMapOutput, TReduceOutput> {
  /** Phase A: 输入项 — 通常是 module spec 列表 */
  inputs: TInput[];

  /** Phase A: 聚类策略 */
  clusterStrategy:
    | { kind: 'community'; minSize: 3; maxSize: 15 }   // 优先：复用现有 Louvain 社区检测（src/panoramic/community/）
    | { kind: 'directory' }                              // Fallback：按目录分组
    | { kind: 'single' };                                // 兜底：< minSize 时不聚类

  /** Phase B: shared context — 每个 cluster 都看到的全局信息（避免跨 cluster 依赖丢失） */
  sharedHeader: () => Promise<string>;

  /** Phase B: per-cluster Map 函数 */
  map: {
    fn: (cluster: TInput[], sharedHeader: string) => Promise<TMapOutput>;
    model: 'sonnet' | 'opus';                            // 默认 sonnet（成本/质量平衡）
    maxConcurrency: number;                              // 默认 4
    perCallTimeout: number;                              // 默认 180s
  };

  /** Phase C: 单次 Reduce 函数 */
  reduce: {
    fn: (mapOutputs: TMapOutput[], sharedHeader: string) => Promise<TReduceOutput>;
    model: 'sonnet' | 'opus';                            // 默认 opus（关键合并质量门）
    timeout: number;                                     // 默认 300s
  };

  /** Observability hooks */
  onClusterPlanned?: (clusters: TInput[][]) => void;
  onMapStart?: (clusterIdx: number, size: number) => void;
  onMapComplete?: (clusterIdx: number, output: TMapOutput, telemetry: CallTelemetry) => void;
  onMapFailed?: (clusterIdx: number, error: Error) => void;
  onReduceStart?: (mapOutputCount: number) => void;
  onReduceComplete?: (output: TReduceOutput, telemetry: CallTelemetry) => void;
}

export interface CallTelemetry {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  modelId: string;
}

export interface ClusterDispatchResult<TReduceOutput> {
  finalOutput: TReduceOutput;
  diagnostics: {
    clusterCount: number;
    mapSucceeded: number;
    mapFailed: number;
    mapTotalTokens: { input: number; output: number };
    reduceTokens: { input: number; output: number };
    totalDurationMs: number;
    mergeConfidence: 'high' | 'medium' | 'low';   // 见 §三 评分逻辑
  };
}

export async function clusterDispatch<TIn, TMap, TRed>(
  options: ClusterDispatchOptions<TIn, TMap, TRed>
): Promise<ClusterDispatchResult<TRed>>;
```

### 行为规范

1. **聚类失败 fallback**：community 失败 → directory 失败 → single
2. **Map 失败容忍**：单个 cluster failure 不中断整体；最终 ≥ 50% cluster 成功才算交付（否则 fail-closed）
3. **Reduce 失败重试**：1 次重试，仍失败则 fail-closed（不写产物）
4. **Concurrency 控制**：固定 maxConcurrency=4（避免 Anthropic API 限流；可配）
5. **token 预算**：每 cluster Map call input ≤ 100k tokens（典型 15 模块 × 5k = 75k + shared header 10k = 85k，留缓冲到 100k）；超出时**按 first-fit-decreasing 装箱算法拆分成多个子 cluster**，保证每个模块进入 exactly 1 个子 cluster（零模块丢失）；frontmatter 标 `clusterSplit: <N>`。**禁止用截断尾部方式静默丢弃模块**（违反 §一"项目规模与模型容量解耦"承诺；Codex review 已识别的问题）

### Merge confidence 评分

Reduce 完成后程序化打分（不依赖 LLM 自评）：
- **high**：所有 map output 间无冲突 + Reduce 完成无重试
- **medium**：检测到冲突但 Reduce 解决了 / 或 Reduce 重试 1 次成功
- **low**：> 30% map cluster 失败 / Reduce 重试后仍 borderline 输出

写入产物 frontmatter，让下游消费方知道置信度。

---

## 三、ADR Pipeline 重构（基于 Cluster Orchestrator）

### 数据流

```
项目所有 module specs
        │
        ▼
┌──────────────────────────────────────────┐
│ Phase A: 聚类（程序化，无 LLM）           │
│  复用 src/panoramic/community/ 的         │
│  Louvain 社区检测（现有实现），按图结构分组│
└──────────────────────────────────────────┘
        │
        ▼  K 个 cluster (3-10 modules each)
┌──────────────────────────────────────────┐
│ Phase B: Map (per cluster, parallel x4)   │
│                                           │
│ 每 cluster input：                        │
│  • cluster 内 module specs 全文           │
│  • shared header (~5-10k):                │
│    - README                                │
│    - project-context.yaml                  │
│    - 所有模块 inventory（名字+一句话职责）│
│  • Total: 30-100k tokens                  │
│                                           │
│ Model: sonnet 4.6                          │
│ Output Zod schema:                         │
│   ADRCandidate[] {                         │
│     candidateId, title, summary,           │
│     decision, context, consequences,       │
│     evidenceRefs[{file,lines,snippet}],   │
│     sourceClusterId, confidence: 0-1     }│
└──────────────────────────────────────────┘
        │
        ▼  K 组 candidates (典型每 cluster 1-3 个)
┌──────────────────────────────────────────┐
│ Phase C: Reduce (单次 LLM call)           │
│                                           │
│ Input：                                    │
│  • 所有 K 组 candidates (Zod-serialized)  │
│  • shared header                          │
│                                           │
│ Model: opus 4.7                            │
│ Tasks:                                     │
│  1. 按 title/decision 语义相似度去重      │
│  2. 跨 cluster 出现 → confidence: high   │
│  3. 单 cluster 出现 → confidence: medium │
│  4. 合并 evidenceRefs（保留所有源 cluster）│
│  5. 排除证据不足 (<2 evidenceRefs)        │
└──────────────────────────────────────────┘
        │
        ▼  最终 ADR draft list
┌──────────────────────────────────────────┐
│ Phase D: Evidence 真实性自动校验（程序化）│
│                                           │
│ For each evidenceRef:                      │
│  • file 存在？                             │
│  • line 范围有效？                         │
│  • snippet 字符匹配？(允许 ≤10% 空白差)  │
│ verified: false 的从计数中扣除             │
│ 总有效 evidenceRefs < 2 → 丢弃该 ADR      │
└──────────────────────────────────────────┘
        │
        ▼
   写入 specs/project/docs/adr/
```

### 跨 cluster 决策捕获机制（关键）

ADR 这种"跨 cluster 决策"是 MapReduce 最容易丢的：决策在 cluster A 引入，cluster B 实现，单看任何一个 cluster 都看不出。

**3 层防护**：
1. **Shared header inventory**：每 Map call 的 prompt 看到全 repo 模块 inventory（仅名字+一句话），让 LLM 知道还有哪些模块存在
2. **Reduce LLM = opus**：合并阶段用最强模型，能跨 candidate 识别"这两个 cluster 的 candidate 其实是同一决策的不同侧面"
3. **Confidence 分级**：高置信 = 多 cluster 印证；medium = 单 cluster 局部决策；二者都保留但元数据区分

### 大项目运行时（按 cluster 数估算）

| 项目规模 | 模块数 | Cluster 数 | Map（并行 4） | Reduce | 总耗时 |
|---------|-------|-----------|------------|--------|-------|
| micrograd | 4 | 1（< minSize fallback）| 30s | 60s | ~1.5 min |
| nanoGPT | 15 | 3 | 30s | 60s | ~1.5 min |
| 中型 | 50 | 8 | 60s | 90s | ~2.5 min |
| 大型 | 200 | 25 | 3.5 min | 120s | ~6 min |
| 超大型 | 2000 | 250 | 31 min | 180s | ~35 min |

→ **runtime 线性增长，质量保持稳定**。

---

## 四、Narrative Pipeline 重构（同模式）

```
Phase A: 复用 ADR 阶段的 cluster 划分（避免重新聚类）
Phase B: Map per cluster
  Input: cluster module specs 意图段 + shared header
  Model: sonnet
  Output: cluster mini-narrative (3-5 sentences) + key abstractions list
Phase C: Reduce
  Input: K cluster narratives + shared header  
  Model: sonnet（narrative 不需要 opus，节省成本）
  Output: project narrative (4-6 paragraphs)
Phase D: Critique（独立 LLM 调用）
  Model: sonnet
  Output: { passed, issues[] }
Phase E: Refine（仅 Phase D fail 时）
  Model: sonnet
  Max 1 retry; 仍 fail → confidence: low
Phase F: 程序化 domain-words 校验
  ≥3 个核心抽象名（取自 module spec 接口表头）
```

### 关键设计选择

- **Reduce 用 sonnet 不用 opus**：narrative 综合的认知难度低于 ADR 决策合并
- **Critique 单独 pass**：研究证明独立 LLM critique 比同一 LLM 自评更有效
- **Refine 最多 1 次**：避免无限循环；多次仍 fail 是模型能力问题不是 prompt 问题

---

## 五、Hyperedges Pipeline（轻量改造）

hyperedges 本身就是局部抽取（每 design doc 独立产出 hyperedge），天然适配 MapReduce：

```
Phase A: design doc 收集（README + module specs + .md docs）
Phase B: Map per design doc batch（按 token 预算分组，每组 ≤ 50k）
  Model: sonnet
  Output: hyperedges[]
Phase C: Reduce（单次去重 + 合并）
  Model: sonnet（hyperedges 简单合并，sonnet 足够）
  Output: 最终 hyperedges 列表，去重 by node-set 相似度
```

比 ADR 简单：每 chunk 独立性强，Reduce 主要做去重不做语义合并。

---

## 六、明确不做的事（避免过度设计）

| 不做 | 为什么不做 |
|------|----------|
| **多层级 hierarchy（GraphRAG 的 C0-C3）** | 单层 cluster + reduce 已能解决我们的问题；多层级带来 4x 复杂度但只对 1000+ 节点项目有边际收益 |
| **Recursive reduce**（reduce → reduce → reduce）| Reduce 输出是 final ADR list，没有需要再合并的层级；递归只在多层 hierarchy 才需要 |
| **Embedding-based dedup（MinHash/LSH）** | LLM 在 Reduce 阶段做语义去重，避免再引入 embedding 模型依赖；准确性更高，唯一代价是慢一点（已可接受） |
| **跨 batch 缓存** | v4.2 再做；当前每次 batch 重跑全部，简化状态管理 |
| **Streaming reduce** | 全部 Map 完成再 Reduce 简单可靠；streaming 收益不大但代码复杂度高 |
| **Per-cluster retry with exponential backoff** | 单次 Map 失败就 log + 继续；50% 阈值兜底；简单可观测 |
| **自适应 cluster size** | 固定 minSize=3 / maxSize=15 工作良好；自适应需要太多调参 |
| **GPU 嵌入索引、向量库** | 我们没有 query-time 检索需求；都是 batch 时一次性 LLM 调用 |
| **Confidence learning（基于历史校准）** | 静态规则（多 cluster=high / 单 cluster=medium）即可；学习需要标注数据 |
| **跨 cluster 协调（leader election / 锁）** | Cluster 间完全独立，无共享状态写 |

---

## 七、Cluster Orchestrator 实施顺序

### Phase 0（新增，3-4 人天）— 基础设施先行

只交付 cluster-orchestrator.ts 本身 + 单元测试 + 一个最简单的 demo（不接生产）：

1. 接口定义 + Zod schemas
2. 聚类策略实现（community fallback chain）
3. Map 并发调度（用 `p-limit` 或简单 semaphore）
4. Reduce 调用 + retry
5. Telemetry hooks
6. 单元测试：mock LLM client，验证 dispatch 逻辑（不依赖真实 API）

**目的**：让 Phase 3 的 ADR / narrative / hyperedges 实施都基于稳定的 orchestrator，而不是各自实现 MapReduce。

### Phase 3 实施顺序（更新）

```
3a. hyperedges 接 orchestrator (2-3 天) — 最简单，用作 orchestrator 的真实场景验证
3b. narrative 接 orchestrator + 3-pass critique (4-5 天)
3c. ADR 接 orchestrator + evidence verification (5-7 天) — 最复杂，最后做
```

---

## 八、风险与缓解（MapReduce 特有）

| Risk | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 跨 cluster 决策被丢失（cluster A 引入 / B 实现）| 中 | 高 | (1) shared header 提供全局 inventory；(2) Reduce 用 opus；(3) confidence 分级让用户知道哪些是 single-cluster 决策 |
| Reduce 阶段幻觉级联（合并出原 candidates 不存在的内容）| 中 | 高 | Reduce LLM 收到的是 Zod-validated structured candidates，不是自由文本；evidenceRefs 程序化校验过滤掉 LLM 编造 |
| Cluster 划分不均（某 cluster 30 模块超 token 预算）| 中 | 中 | maxSize=15 硬上限；超出按 first-fit-decreasing 装箱拆分成子 cluster（零模块丢弃，仅 runtime 增加），frontmatter 标 `clusterSplit: <N>` |
| Map 并发过高导致 Anthropic API 429 | 中 | 中 | maxConcurrency=4 默认；可配；遇 429 自动 backoff（标准 SDK 已支持）|
| 单 cluster Map 失败导致整体 ADR 不完整 | 中 | 中 | 50% 成功阈值兜底；< 50% → fail-closed 不写部分产物（避免误导）|
| Cluster 划分本身崩溃（community detection 失败）| 低 | 高 | Fallback chain：community → directory → single；都 fail 才报错 |
| Opus quota 耗尽导致 Reduce 失败 | 低 | 高 | Reduce 重试 1 次，仍失败 → fail-closed + `_PIPELINE_FAILED.md` 标记（沿用 Feature 135 模式）|
| 小项目（<5 模块）走 MapReduce 是 overhead | 中 | 低 | clusterStrategy: 'single' 兜底，跳过 Map 直接喂 Reduce；与原"单 pass"等价 |

---

## 九、与原 Feature 140 规划的差异

### 子能力 1（ADR）— 重写

- 原方案："单 pass + 喂全 repo 上下文 + 强制 opus + evidence 自动校验"
- 新方案：MapReduce（Sonnet map / Opus reduce）+ evidence 自动校验
- 工作量：5-7 → **5-7 人天**（不变；orchestrator 抽出去 Phase 0 了）

### 子能力 2（hyperedges）— 微调

- 原方案：扩展 design doc 来源
- 新方案：**继续扩展 + 走 orchestrator**（统一架构）
- 工作量：2-3 → **2-3 人天**

### 子能力 3（narrative）— 重写

- 原方案：3-pass synthesize → critique → refine
- 新方案：MapReduce + 3-pass critique（在 reduce 输出上跑）
- 工作量：4-5 → **4-5 人天**（不变）

### 子能力 6（context budget）— 简化

- 原方案：1M 默认 + relevance ordering
- 新方案：**100k chunk size 默认**（chunk-bounded，不需要大 budget）；保留 cost breakdown 可观测性
- 工作量：2-3 → **1-2 人天**

### 新增 Phase 0（cluster orchestrator）

- **3-4 人天**

### 总工作量

- 原 Feature 140：18-25 人天
- 重构后：22-30 人天
- 多 4-5 天，换得：
  - 大项目不再崩溃（架构性消除）
  - 默认 200k Sonnet 完全可工作（不再依赖 1M context 模型）
  - Q5/Q9 这两个 high-severity 问题被彻底架构性消除
  - hyperedges/narrative 也受益（统一 orchestrator）

---

## 十、决策日志变更（回滚 + 新增）

| 决策项 | 原决议 | 新决议 |
|-------|-------|-------|
| Q5 默认 context budget | 1M tokens | **100k chunk size**（不再需要大 budget） |
| Q9 ADR 强制 opus | 全 pipeline 强制 | **仅 Reduce 阶段优先 opus**（Map 用 sonnet，节省 + 不依赖 opus 配额）|
| Q11 cluster-orchestrator 单独成 Feature？ | — | **A：不单独**，作为 Feature 140 内部 Phase 0；横向能力当前只服务 v4.1 这批生成器 |
| Q12 Map 阶段并发度上限？ | — | **A：maxConcurrency = 4**（默认，可配；保守避免 Anthropic API 429）|
| Q13 聚类算法用 Leiden 还是 Louvain？ | — | **C：沿用现有 Louvain**（`graphology-communities-louvain`）— Leiden 在我们图规模下边际收益小，避免引入 `igraph-js` 等重依赖 |
| Q14 cluster maxSize？ | — | **15**（B 范围内保守值）+ 配套 chunk budget 100k |
| Q15 `--no-cluster` flag？ | — | **A：不加**，clusterStrategy: 'single' 在 < 5 模块自动兜底，用户层不感知；避免给用户提供踩坑入口 |

---

## 十一、Acceptance（DoD 增加项）

在原 Feature 140 DoD 基础上增加：

9. **MapReduce 架构正确性**
   - cluster-orchestrator.ts 单元测试覆盖 ≥ 90%
   - 4 fixture 上观察：cluster 数符合预期（micrograd=1, nanoGPT=2-4, ky=3-5, empty=0）
10. **大项目可扩展性**
    - 在合成的 100 文件 fixture 上跑 batch 完成 < 10 min（默认 maxConcurrency=4）
    - frontmatter `mergeConfidence` 字段 distribution：≥80% 是 high/medium
11. **跨 cluster 决策捕获**
    - 在 nanoGPT 上：手动验证 ≥1 条 ADR 同时引用 ≥2 个不同 cluster 的 evidence（证明跨 cluster 决策没有被丢）

---

## 十二、Open Questions

**全部已决议**（Q11-Q15 见上方"决策日志变更"）。无待决项，可启动 `/spec-driver-feature`，本架构文档作为 spec.md 的关键技术参考。

---

## 附录：参考资料

1. **Microsoft GraphRAG**: https://microsoft.github.io/graphrag/ — Leiden 层级聚类 + 社区报告
2. **LangChain MapReduceDocumentsChain**: 经典 Map-Reduce 链式合并模式
3. **Cursor 索引架构**: AST-based 语义切块 + Merkle tree 增量
4. **Sourcegraph Cody**: 多 repo + symbol-matched chunks
5. **LLMxMapReduce 论文**: arxiv.org/abs/2506.09991 — confidence-calibrated cross-chunk aggregation
