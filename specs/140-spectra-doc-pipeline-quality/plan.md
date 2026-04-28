---
type: plan
featureId: "140"
title: "Spectra v4.1.0 文档生产线质量重构 — 实施计划"
status: draft
createdAt: "2026-04-27"
dependsOn:
  - featureId: "131"
    description: "hyperedges schema v2.0（已完成，直接复用）"
  - featureId: "135"
    description: "v4.0.1 fail-loud 基础设施（已合入 master）"
estimatedEffort: "22-30 人天"
targetVersion: "4.1.0"
authorities:
  spec: "specs/140-spectra-doc-pipeline-quality/spec.md"
  techArchitecture: "specs/140-spectra-doc-pipeline-quality/research/02-mapreduce-architecture.md"
  productPlan: "specs/140-spectra-doc-pipeline-quality/research/01-feature-plan.md"
---

# Feature 140 实施计划 — Spectra v4.1.0 文档生产线质量重构

## 架构概览

本 Feature 的技术架构权威文档为 `research/02-mapreduce-architecture.md`，不在此复制。以下仅列出关键模块清单及其职责边界。

### 新增模块

| 模块 | 路径 | 职责 |
|------|------|------|
| Cluster Orchestrator | `src/panoramic/cluster-orchestrator.ts` | MapReduce 统一调度层：聚类 → 并发 Map → Reduce + telemetry hooks |
| ADR MapReduce Pipeline | `src/panoramic/pipelines/adr-decision-pipeline.ts`（重构） | 删除 8 个 hardcoded candidate 函数，改为接入 cluster orchestrator |
| Evidence Verifier | `src/panoramic/pipelines/adr-evidence-verifier.ts`（新增） | 程序化校验 evidenceRef 的 file 存在性 / 行号有效性 / snippet 匹配 |
| Narrative MapReduce Pipeline | `src/panoramic/pipelines/architecture-narrative.ts`（重构） | MapReduce + 3-pass critique loop（synthesize → critique → refine） |
| Hyperedge Orchestrated Pipeline | `src/batch/batch-orchestrator.ts`（改造） | 扩展 designDocAbsPaths + 接入 orchestrator + graph.html 强制生成 |
| Cross-Project Isolation Tests | `tests/integration/cross-project-isolation.test.ts`（新增） | 4 fixture 跨项目隔离断言 |

### 改造模块

| 模块 | 路径 | 改造内容 |
|------|------|---------|
| Context Assembler | `src/core/context-assembler.ts` | AST 调用图相关性排序 + costBreakdown 字段输出 + 超 budget 截断 |
| Extraction Pipeline | `src/extraction/extraction-pipeline.ts` | --include-docs 路径打通：返回 markdown 内容供下游消费 |
| Batch Orchestrator | `src/batch/batch-orchestrator.ts` | 移除 graph.html 跳过条件 + include-docs 日志修正 + designDocAbsPaths 扩展 |
| CI Workflow | `.github/workflows/` | 新增或扩展 4 fixture 跨项目隔离断言 |

---

## Phase 拆分

```
Phase 0 ──────────── Cluster Orchestrator 基础设施（3-4 人天）
    │
    ├─── Phase 1 ─── 独立基础设施，与 Phase 0 并行（4-5 人天）
    │        ├── 1a: 测试 fixture 集 + CI 跨项目隔离框架
    │        ├── 1b: Context Quality & Observability（costBreakdown）
    │        └── 1c: graph.html 始终生成
    │
    └─── Phase 2 ─── 依赖 Phase 1（3-4 人天）
             └── 2a: --include-docs 数据流打通

Phase 3 ─── 依赖 Phase 0 + Phase 2（12-15 人天）
    ├── 3a: hyperedges 接 orchestrator（最简，先做）
    ├── 3b: narrative MapReduce + 3-pass critique
    └── 3c: ADR MapReduce + evidence verification（最复杂，最后）

Phase 4 ─── 集成验收 + release（1-2 人天）
    ├── 4a: 4 fixture 跨项目隔离测试全绿
    ├── 4b: 3 个 fresh 项目端到端验证
    └── 4c: v4.1.0 release:sync + tag
```

---

### Phase 0 — Cluster Orchestrator 基础设施

**目标**：交付独立、可测试的 cluster orchestrator，作为 Phase 3 三个生成器的统一 MapReduce dispatch 层。Phase 3 所有子任务都基于稳定的 orchestrator 接口展开。

**前置依赖**：无（Phase 0 是所有 Phase 的前置）

**子任务**：
- 0a：`ClusterDispatchOptions<TIn, TMap, TRed>` 接口定义 + Zod schema（含聚类策略三级 fallback）
- 0b：聚类策略实现 — community（复用 `src/panoramic/community/` 的 Louvain）→ directory → single fallback chain
- 0c：Map 并发调度（`p-limit` 或 semaphore，maxConcurrency=4，per-call timeout=180s）
- 0d：Reduce 调用 + 1 次重试 + fail-closed 逻辑（< 50% Map 成功时不写产物）
- 0e：Telemetry hooks（`onClusterPlanned` / `onMapStart` / `onMapComplete` / `onMapFailed` / `onReduceStart` / `onReduceComplete`）
- 0f：单元测试（mock LLM client，覆盖率目标 ≥ 90%）

**工作量估算**：3-4 人天

**验收标准（FR 引用）**：
- FR-001：`clusterDispatch<TIn, TMap, TRed>()` 函数可用，接口合规
- FR-002：聚类策略三级 fallback 经单测验证（community 失败 → directory 失败 → single）
- FR-014：所有 telemetry hooks 在正确时机触发（mock 验证）
- NFR-005：`cluster-orchestrator.ts` 行覆盖率 ≥ 90%

---

### Phase 1 — 独立基础设施（与 Phase 0 并行）

**目标**：建立测试基础设施和两个独立修复项（不依赖 orchestrator），为 Phase 3 的质量断言提供验证框架。

**前置依赖**：无（与 Phase 0 并行）

**子任务**：

**1a — 测试 fixture 集 + CI 框架**：
- 建立 4 个 fixture 目录：micrograd / nanoGPT / sindresorhus/ky（git submodule 或 snapshot）/ empty-project
- 新增 `tests/integration/cross-project-isolation.test.ts`（骨架，断言后续 Phase 填充）
- 在 `.github/workflows/` 中配置跨项目隔离 CI workflow

**1b — Context Quality & Observability**：
- 改造 `src/core/context-assembler.ts`：按 AST 调用图相关性排序（本模块 import 的模块优先）+ 超 budget 截断 + token 计数（chars / 3.5 粗算）
- module spec frontmatter 写入 `costBreakdown`（contextAssembly / promptTemplate / sourceFile / llmReasoning）+ `contextTruncated: bool`
- batch summary 新增"Top 5 input token 消费模块"输出

**1c — graph.html 始终生成**：
- `src/batch/batch-orchestrator.ts`：找到 `exportGraphHtml` 的条件跳过处，移除跳过条件
- 极小图（< 3 节点）注入 banner 字符串

**工作量估算**：4-5 人天（1a 约 2 天，1b 约 2 天，1c 约 0.5-1 天）

**验收标准（FR 引用）**：
- FR-011：4 fixture batch 后 `_meta/graph.html` 存在；极小图含 banner
- FR-012：module spec frontmatter 含 `costBreakdown` 字段；`contextTruncated` 字段存在
- FR-013：batch summary 打印 Top 5 token 消费模块列表
- FR-015：4 个 fixture 目录建立完毕；CI workflow 骨架通过

---

### Phase 2 — --include-docs 数据流打通

**目标**：消除"日志说跳过、实际行为不一致"的矛盾，打通 `--include-docs` 的完整数据链路。

**前置依赖**：Phase 1（fixture 基础设施，供集成测试使用）

**子任务**：
- 2a-i：`src/extraction/extraction-pipeline.ts` 扩展：`--include-docs=true` 时返回 markdown 内容（README 全量，其他 .md 作为 kind:doc 图节点）
- 2a-ii：`src/panoramic/pipelines/architecture-narrative.ts` 消费 README 内容（移除原 5k token 限制）
- 2a-iii：`src/batch/batch-orchestrator.ts` 修正日志：去掉"跳过 .md 文件（不支持）"，改为"include-docs: 已加入 N 份 .md 作为语义上下文"
- 2a-iv：集成测试验证 --include-docs 开关前后 context assembler 输入差异

**工作量估算**：3-4 人天

**验收标准（FR 引用）**：
- FR-010：日志无"跳过"字样；README 内容出现在 narrative context 中
- DoD-4：启用 `--include-docs` 后日志不出现"跳过 .md 文件（不支持）"

---

### Phase 3 — MapReduce 应用层（三个生成器接入 Orchestrator）

**目标**：将 ADR / narrative / hyperedges 三个生成器改造为 MapReduce 架构，根治 6 类质量问题中的核心 3 类。

**前置依赖**：Phase 0（cluster orchestrator 稳定）+ Phase 2（--include-docs 数据流，供 narrative 和 hyperedges 消费）

**Phase 3 内部子任务顺序（3a → 3b → 3c，前后依赖，不并行）**：

**3a — Hyperedges 接 Orchestrator（2-3 人天）**：
- 扩展 `designDocAbsPaths` 计算：README（始终）+ `docs/**/*.md`（--include-docs 时）+ `specs/modules/*.spec.md` + `.specify/project-context.*`
- hyperedge extractor 接入 cluster orchestrator（Map per design doc batch，Reduce 去重）
- 集成测试：micrograd / nanoGPT / ky 三个 fixture 上 `graph.json.hyperedges.length >= 1`

**3b — Narrative MapReduce + 3-pass critique（4-5 人天）**：
- narrative pipeline 改造为 6 阶段：Phase A 复用 ADR cluster 划分 → Phase B Map per cluster（sonnet，输出 mini-narrative + key abstractions）→ Phase C Reduce（sonnet）→ Phase D Critique（独立 sonnet 调用）→ Phase E Refine（仅 Phase D fail，最多 1 次）→ Phase F 程序化 domain-words 校验（≥3 个核心抽象名）
- 删除"项目子域目录" 6 行占位表格 + file-system 元数据 template-fill 路径
- frontmatter 写入 `critiqueResult` 摘要（Phase D 通过也保留）
- 集成测试：4 fixture narrative 含 ≥3 个项目特有抽象名；snapshot 确认无模板字符串

**3c — ADR MapReduce + Evidence Verification（5-7 人天）**：
- 前置：grep 全 monorepo 确认 8 个旧 ADR 标题无 downstream 依赖（决策点 3）
- 删除全部 8 个 hardcoded candidate 函数（`buildStreamJsonProtocolCandidate` 等），`buildAdrCandidates()` 改为单一 `clusterDispatch` 调用入口
- ADR Map 阶段：sonnet，输出 `ADRCandidate[]`（含 evidenceRefs、sourceClusterId、confidence）
- ADR Reduce 阶段：优先 opus（不可用时降级 sonnet + `confidence: medium`）；跨 cluster 语义去重 + evidenceRefs 合并
- 新增 `adr-evidence-verifier.ts`：程序化校验 file 存在 / 行号有效 / snippet 匹配（≤10% 空白差）；verified=true 占比 < 2 条 → ADR 丢弃
- 对存量旧 ADR：frontmatter status 改为 `superseded`，追加 `supersededBy` 字段（沿用 Feature 135 `_PIPELINE_DISABLED.md` 模式）
- frontmatter 写入 `generatedByModel: { map: <modelId>, reduce: <modelId> }`
- 集成测试：4 fixture ADR 标题 distinct 率 = 100%；verified=true 占比 ≥ 90%

**工作量估算**：12-15 人天（3a: 2-3 天 / 3b: 4-5 天 / 3c: 5-7 天，顺序执行）

**验收标准（FR 引用）**：
- FR-003：8 个 hardcoded candidate 函数不存在；grep 验证无 `buildStreamJsonProtocol` 等函数名
- FR-004：ADR Map 调用使用 sonnet，Reduce 调用使用 opus；frontmatter `generatedByModel` 字段存在
- FR-005：evidenceRef 校验逻辑覆盖文件不存在 / 行号越界 / snippet 不匹配场景；4 fixture verified=true 占比 ≥ 90%
- FR-006：存量旧 ADR status=superseded；`supersededBy` 字段存在
- FR-007：新项目首次 batch 后 `graph.json.hyperedges.length >= 1`
- FR-008：narrative 4-6 段 + critiqueResult 摘要 + domain-words 校验通过
- FR-009：旧模板路径不存在；narrative 无"项目子域目录，覆盖 N 个模块"字样
- DoD-9：cluster 数符合预期（micrograd=1, nanoGPT=2-4, ky=3-5, empty=0）
- DoD-11：nanoGPT 上 ≥1 条 ADR 同时引用 ≥2 个不同 cluster 的 evidence

---

### Phase 4 — 集成验收 + Release

**目标**：全量验收 DoD 11 条，准备 v4.1.0 发布。

**前置依赖**：Phase 3（所有生成器改造完毕）

**子任务**：
- 4a：跨项目隔离测试全绿（4 fixture CI 断言：ADR distinct 100% / narrative 含领域词 / hyperedges ≥ 1 / evidence verified ≥ 90%）
- 4b：在 3 个 fresh 项目上端到端验证（无 hallucination + 全功能产出 + CHANGELOG 耗时说明准确）
- 4c：100 文件合成 fixture 上跑 batch < 10 min（NFR-001 大项目可扩展性）
- 4d：`npx vitest run` 零新增失败；pre-existing 2 个版本号失败明确标注
- 4e：`npm run release:sync` + v4.1.0 tag + CHANGELOG 更新（含 batch 耗时增加说明 +60-120s）

**工作量估算**：1-2 人天

**验收标准（FR 引用）**：
- FR-015：CI workflow 4 fixture 全部通过
- NFR-001：100 文件合成 fixture batch < 10 min
- NFR-003：现有 2232 测试零新增失败
- NFR-004：fail-closed 行为通过端到端验证（失败时有 `_PIPELINE_FAILED.md`）
- DoD-1 ~ DoD-11：全部可机器验证的验收项通过

---

## 关键技术决策

以下决策来自 Q1-Q15 决议日志（`research/01-feature-plan.md` §决策日志 + `research/02-mapreduce-architecture.md` §十），**禁止重新决议**。

| 决策 | 结论 | 对应 Phase / 模块 |
|------|------|-----------------|
| Q2：ADR hardcoded candidates | 全删（8 个函数） | Phase 3c / `adr-decision-pipeline.ts` |
| Q3：evidence 真实性校验 | 程序化自动校验（file / line / snippet 三重验证）| Phase 3c / `adr-evidence-verifier.ts` |
| Q4：--include-docs 默认值 | 保持 false | Phase 2 / `batch-orchestrator.ts` |
| Q5：context budget | 100k chunk size（MapReduce chunk-bounded，非大 budget 方案）| Phase 0 / cluster orchestrator |
| Q6：旧 ADR 处理 | 保留文件 + frontmatter status=superseded + supersededBy 字段 | Phase 3c |
| Q7：LLM 成本约束 | 不作约束，质量优先（README 全量、Opus reduce 均基于此）| 全局 |
| Q8：spectra audit 子命令 | 本 Feature 不做，留 v4.2.0 | 不在范围 |
| Q9：ADR 模型策略 | Map=sonnet / Reduce 优先 opus（不可用时降级 sonnet + confidence:medium）| Phase 3c / cluster orchestrator 配置 |
| Q10：narrative 3-pass | synthesize → critique → refine（Phase D fail 时最多 1 次 refine）| Phase 3b / `architecture-narrative.ts` |
| Q11：orchestrator 独立成 Feature | 否，作为 Feature 140 Phase 0 内部模块 | Phase 0 |
| Q12：Map 并发度 | maxConcurrency=4（可配，默认保守避免 API 429）| Phase 0 / cluster orchestrator |
| Q13：聚类算法 | 沿用 Louvain（`graphology-communities-louvain`，不引入 Leiden / igraph-js）| Phase 0 / community fallback chain |
| Q14：cluster maxSize | 15（配套 100k chunk budget，留 ~15% 缓冲）| Phase 0 / cluster orchestrator |
| Q15：--no-cluster flag | 不加；< 5 模块自动走 single 策略，用户层不感知 | Phase 0 / cluster orchestrator |

---

## 风险与缓解

以下 11 项风险来自架构文档 §八"风险与缓解"和规划文档 §七"风险登记表"：

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| 跨 cluster 决策被丢失（cluster A 引入 / B 实现）| 中 | 高 | 3 层防护：shared header 全局 inventory + Reduce 用 opus + confidence 分级 |
| Reduce 阶段幻觉级联（合并出原 candidates 不存在内容）| 中 | 高 | Reduce input 为 Zod-validated structured candidates；evidenceRefs 程序化校验过滤 |
| Cluster 划分不均（某 cluster 超 token 预算）| 中 | 中 | maxSize=15 硬上限；超出按 spec 大小截断尾部 + `clusterTruncated: true` |
| Map 并发过高触发 Anthropic API 429 | 中 | 中 | maxConcurrency=4；遇 429 依赖标准 SDK backoff |
| 单 cluster Map 失败导致 ADR 不完整 | 中 | 中 | 50% 成功阈值兜底；< 50% fail-closed 不写部分产物 |
| 聚类本身崩溃（community detection 失败）| 低 | 高 | fallback chain：community → directory → single；都 fail 才报错 |
| Opus quota 耗尽导致 Reduce 失败 | 低 | 高 | Reduce 重试 1 次；仍失败 fail-closed + `_PIPELINE_FAILED.md`（沿用 Feature 135 模式）|
| 小项目（< 5 模块）走 MapReduce 是 overhead | 中 | 低 | clusterStrategy: single 自动兜底，与原单 pass 等价 |
| Critique LLM 假阳性（narrative Pass D 误判不合格）| 中 | 低 | Phase 1 在 4 fixture 上观测 critique 分布；prompt 校准 |
| 8 个旧 ADR 标题有 downstream consumer 依赖 | 低 | 高 | Phase 3c 启动前 grep 全 monorepo（决策点 3）；如有 → 评估保留兼容层 |
| 大上下文 batch latency 显著增加（+60-120s）| 高 | 中 | 架构性接受；CHANGELOG 明确说明；提供 `--context-budget` 供用户压缩 |

---

## 不在范围

以下项目明确排除在本 Feature 之外（来自 spec.md §范围边界）：

- **`spectra audit` 子命令**：留 v4.2.0（Q8 决议）
- **symbol-level graph**：Feature 141 / v4.2.0
- **跨 batch 缓存 / 增量更新**：留 v4.2.0
- **多层级 hierarchy**（GraphRAG C0-C3）：架构文档 §六 明确排除，单层 reduce 已满足需求
- **Recursive reduce**：单层已够，递归只在多层 hierarchy 才需要
- **Embedding-based dedup（MinHash/LSH）**：Reduce 阶段 LLM 语义去重已足够
- **Streaming reduce**：全量 Map 后统一 Reduce，简单可靠
- **自适应 cluster size**：固定 minSize=3 / maxSize=15
- **GPU 嵌入索引 / 向量库**：无 query-time 检索需求
- **Confidence learning**：静态规则（多 cluster=high / 单 cluster=medium）已满足
- **`--no-cluster` CLI flag**：< 5 模块自动 single 兜底（Q15 决议），用户层不感知

---

## 回归与兼容性

### 与 Feature 131 的兼容（hyperedges schema v2.0）

- Feature 131 提供的 `hyperedges` schema v2.0 直接复用，不修改 schema 定义
- Phase 3a（hyperedge pipeline 改造）输出结构必须符合 schema v2.0 的字段约束
- 集成测试读取 `graph.json.hyperedges` 时使用 Feature 131 定义的 Zod schema 做验证

### 与 Feature 135 的兼容（v4.0.1 fail-loud 基础设施）

- Feature 135 引入的 `_PIPELINE_DISABLED.md` / `_PIPELINE_FAILED.md` 标记格式继续沿用（FR-006 旧 ADR supersede notice + NFR-004 fail-closed 标记）
- Feature 135 的 WARNING 路径在本 Feature 中被真正修复替代，但保留 fail-closed 写标记的行为
- 现有 2232 个测试零新增失败（NFR-003）：改造涉及 5+ 个模块，实施时需在每个子任务完成后局部跑测试，Phase 4 全量验证

### CLI 接口兼容性

- `--include-docs` / `--hyperedges` / `--mode` 等现有 flag 语义不变
- `--include-docs` 的内部数据流修改（打通 extraction 结果到 narrative pipeline），外部接口和默认值（false）不变
- 新增 `--context-budget <N>` 参数为纯新增，不影响现有调用

---

## 时间分配总览

| Phase | 描述 | 工作量 | 关键路径 |
|-------|------|-------|---------|
| Phase 0 | Cluster Orchestrator 基础设施 | 3-4 人天 | **是**（Phase 3 全部依赖）|
| Phase 1 | 独立基础设施（fixture / context / graph.html）| 4-5 人天 | 否（与 Phase 0 并行）|
| Phase 2 | --include-docs 数据流打通 | 3-4 人天 | 否（依赖 Phase 1）|
| Phase 3a | Hyperedges 接 Orchestrator | 2-3 人天 | 是（Phase 3 的验证先导）|
| Phase 3b | Narrative MapReduce + 3-pass critique | 4-5 人天 | 是 |
| Phase 3c | ADR MapReduce + evidence verification | 5-7 人天 | 是（最复杂）|
| Phase 4 | 集成验收 + release | 1-2 人天 | 是（收尾）|
| **合计** | | **22-30 人天** | |
