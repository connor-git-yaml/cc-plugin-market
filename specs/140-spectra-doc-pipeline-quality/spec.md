---
type: feature
featureId: "140"
title: "Spectra v4.1.0 文档生产线质量重构"
status: draft
createdAt: "2026-04-28"
estimatedEffort: "22-30 人天"
targetVersion: "4.1.0"
dependsOn:
  - featureId: "131"
    description: "hyperedges schema v2.0"
  - featureId: "135"
    description: "v4.0.1 fail-loud hotfix 基础设施"
authorities:
  productPlan: "research/01-feature-plan.md"
  techArchitecture: "research/02-mapreduce-architecture.md"
  roadmapContext: "research/00-roadmap-context.md"
---

# Feature 140 — Spectra v4.1.0 文档生产线质量重构

## 背景与目标

### 问题陈述

Feature 135（v4.0.1）通过 fail-loud 机制将文档生成中的错误暴露为可观测 WARNING，属于临时治理手段。然而 WARNING 路径掩盖的 6 类结构性质量问题并未修复：

1. **ADR hallucination**：ADR pipeline 有 8 个 hardcoded candidate 函数，候选触发条件为关键词匹配，任何足够大的项目都会偶然命中，产出的 ADR 是 Spectra 自身架构的模板套壳，与被分析项目无关。
2. **hyperedges 失效**：`runHyperedgeIntegration` 触发条件 `designDocAbsPaths.length > 0` 在新项目不满足，导致首次 batch 无 hyperedge 产出。
3. **architecture-narrative 模板化**：当前 narrative 存在"项目子域目录，覆盖 N 个模块 / N 个文件"的固定模板句，不反映被分析项目的真实技术本质。
4. **--include-docs 半实现**：CLI 链路已实现，但 spec 生成路径不消费 extraction 结果；日志显示"跳过 .md 文件"，语义与实际行为矛盾。
5. **graph.html 不一致**：batch 输出有时因图复杂度阈值跳过 `exportGraphHtml`，导致 `_meta/graph.html` 不始终存在。
6. **context 不可观测**：大上下文生成时，用户无法感知实际 token 消耗、context 是否被截断、哪些模块是输入大户。

### 根本原因

以上 6 类问题共享同一根本原因：**项目规模与模型上下文容量的耦合**——当项目文件数增加时，单 pass 大上下文方案要么因超出模型上下文窗口而崩溃，要么因 token 压缩裁剪而丢失关键信息。

### 解决方向

本 Feature 采用 **MapReduce 架构**（基于 `src/panoramic/cluster-orchestrator.ts`），将大项目分解为独立 cluster，通过 Map 并发 + Reduce 合并的方式实现项目规模与质量的解耦。3 个主要生成器（ADR / narrative / hyperedges）共享同一 orchestrator，保证架构一致性与后续维护成本可控。

> 技术架构权威文档：`research/02-mapreduce-architecture.md`
> 业务范围与决策日志权威文档：`research/01-feature-plan.md`

---

## 用户故事与验收场景

### US-001：ADR 基于真实证据生成（P1）

**角色**：使用 Spectra 分析自有项目的工程师

**描述**：作为一名工程师，我希望 Spectra 生成的 ADR 能引用项目中真实存在的代码/文档片段作为证据，而不是套用通用的架构决策模板，以便我能信任 ADR 内容并用于团队决策记录。

**优先级理由**：ADR hallucination 是当前最严重的质量问题，直接损害用户对 Spectra 输出的信任。

**独立可测试性**：cluster orchestrator（Phase 0）和 evidence 校验逻辑（Phase 3c）分别独立可测试；evidence 验证是纯程序化逻辑，不依赖 LLM。

**验收场景**：
```gherkin
Given 一个中等规模的 TypeScript 项目（如 sindresorhus/ky）
When 执行 spectra batch --mode full
Then 所有生成的 ADR 满足：
  - 每条 ADR frontmatter 包含 ≥2 条 evidenceRefs
  - 每条 evidenceRef 含 file / location / snippet / verified 字段
  - verified=true 的 evidenceRefs 占所有 evidenceRefs 的 ≥90%
  - frontmatter generatedByModel 字段记录实际使用的模型
  - ADR 标题与项目代码中实际存在的技术概念相关

Given 一个空项目（仅 README）
When 执行 spectra batch --mode full
Then ADR 输出数量为 0（fail-closed，不输出无证据 ADR）
  且 _meta/ 目录中存在 _PIPELINE_FAILED.md 或 _PIPELINE_DISABLED.md 说明

Given 4 个不同的 fixture 项目（micrograd / nanoGPT / ky / empty）
When 分别执行 spectra batch
Then 各项目的 ADR 标题集合互不相交（distinct 率 = 100%）
```

---

### US-002：新项目首次 batch 产出 hyperedges（P1）

**角色**：使用 Spectra 分析新建项目的工程师

**描述**：作为一名工程师，我希望在首次执行带 `--hyperedges` 参数的 batch 命令时就能在 graph.json 中看到 hyperedges，而不是每次都得到空列表，以便我能利用 hyperedge 信息理解模块间的多边关系。

**优先级理由**：hyperedges 功能在新项目上完全失效，与功能文档描述不符，属于 P1 级别的功能缺失。

**独立可测试性**：`designDocAbsPaths` 扩展逻辑是纯程序化代码，独立于 LLM 调用可单测；integration test 可 mock LLM 响应验证数据流。

**验收场景**：
```gherkin
Given 一个尚未有 module specs 的新项目（含 README.md）
When 执行 spectra batch --hyperedges --mode full（首次运行）
Then graph.json 的 hyperedges 字段长度 ≥ 1

Given 一个启用了 --include-docs 的项目（含 docs/ 目录）
When 执行 spectra batch --hyperedges --include-docs
Then hyperedge extractor 消费 README + docs/**/*.md 内容
  且 graph.json.hyperedges.length ≥ 1

Given micrograd / nanoGPT / ky 三个 fixture
When 分别执行 spectra batch --hyperedges --mode full
Then 每个 fixture 的 graph.json.hyperedges.length ≥ 1
```

---

### US-003：architecture-narrative 反映项目真实技术本质（P1）

**角色**：使用 Spectra 生成项目文档的工程师

**描述**：作为一名工程师，我希望 Spectra 生成的 architecture-narrative 包含项目特有的技术术语和设计取舍描述，而不是"该项目包含 N 个模块，覆盖 1 个子域"这类模板化句子，以便我能将 narrative 直接用于新成员 onboarding 文档。

**优先级理由**：模板化 narrative 是 Spectra 输出中用户最直接感知的质量问题，影响产品可信度。

**独立可测试性**：3-pass 流程（synthesize / critique / refine）中每个 pass 是独立 LLM 调用，可分别 mock 测试；程序化 domain-words 校验是纯文本匹配，完全独立测试。

**验收场景**：
```gherkin
Given 一个 TypeScript 项目（如 sindresorhus/ky）
When 执行 spectra batch --mode full
Then architecture-narrative 满足：
  - 包含 ≥3 个来自该项目 module spec 接口表头的核心抽象名
  - 不包含"项目子域目录，覆盖 N 个模块 / N 个文件"字样
  - narrative 长度在 4-6 段之间
  - frontmatter 含 critique 摘要字段（即使 Pass 2 通过）

Given 4 个不同 fixture 项目
When 分别生成 architecture-narrative
Then 各项目的 narrative 均包含该项目特有的技术术语
  且不出现相同的模板句子
```

---

### US-004：--include-docs 行为与日志一致（P2）

**角色**：启用了 --include-docs 参数的工程师

**描述**：作为一名工程师，我希望启用 `--include-docs` 后，batch 日志能准确反映实际处理了哪些 .md 文件，而不是显示"跳过 .md 文件（不支持）"，以便我能判断文档是否真正影响了生成结果。

**优先级理由**：日志误导用户，虽不影响核心功能，但造成信任损失，P2 优先修复。

**独立可测试性**：日志变更和数据流变更都是独立的代码路径修改，无 LLM 依赖，单测即可覆盖。

**验收场景**：
```gherkin
Given 含有 README.md 和 docs/ 目录的项目
When 执行 spectra batch --include-docs
Then 日志输出包含"include-docs: 已加入 N 份 .md 作为语义上下文"
  且不包含"跳过 .md 文件（不支持）"

Given 执行 spectra batch（不加 --include-docs）
When batch 完成
Then 日志不处理任何 .md 文件
  且 README.md 内容不进入 context assembler
```

---

### US-005：batch 输出始终包含 graph.html（P2）

**角色**：使用 Spectra 可视化功能的工程师

**描述**：作为一名工程师，我希望每次执行 batch 后 `_meta/graph.html` 文件都存在，即使项目模块数量较少，以便我能始终通过浏览器查看项目的模块关系图。

**优先级理由**：输出不一致性损害用户体验，P2 修复。

**独立可测试性**：文件生成逻辑纯程序化，fixture 集成测试直接断言文件存在。

**验收场景**：
```gherkin
Given 任意 fixture 项目（包括仅含 1-2 个模块的极小项目）
When 执行 spectra batch
Then _meta/graph.html 文件存在于输出目录

Given 极小项目（< 3 个模块之间无有效图边）
When 执行 spectra batch
Then graph.html 存在
  且 HTML 内容含 banner："This project has too few cross-module references for meaningful visualization."
```

---

### US-006：context token 消耗可观测（P2）

**角色**：需要了解 Spectra 运行成本的工程师

**描述**：作为一名工程师，我希望每个生成的 module spec 的 frontmatter 中包含 token 消耗分解信息，以及 batch summary 中能看到 token 消耗最多的前 5 个模块，以便我能了解实际 LLM 调用成本并在需要时使用 `--context-budget` 调整。

**优先级理由**：可观测性是本次架构升级的重要质量保证手段，P2 实现。

**独立可测试性**：frontmatter 字段写入和 batch summary 打印是独立功能，可 mock token 计数器分别测试。

**验收场景**：
```gherkin
Given 任意项目执行 spectra batch
When batch 完成
Then 每个 module spec frontmatter 包含 costBreakdown 字段（含 contextAssembly / promptTemplate / sourceFile / llmReasoning）
  且 frontmatter 包含 contextTruncated 字段（bool）
  且 batch summary 打印"Top 5 input token 消费模块"列表

Given 4 个 fixture 项目使用默认 budget (100k chunk size)
When 分别执行 spectra batch
Then 所有 cluster Map call 的 contextTruncated = false

Given nanoGPT fixture 执行 spectra batch --context-budget 5000
When batch 完成
Then 存在 contextTruncated = true 的 module spec
  且该模块的实际 contextAssembly 降至 ≤ 10k tokens
```

---

## 范围边界

### 在范围（本 Feature 交付）

- `src/panoramic/cluster-orchestrator.ts`：新增 MapReduce 调度层（Phase 0）
- ADR pipeline 重构：删除 8 个 hardcoded candidate 函数，改为 MapReduce + evidence 自动校验
- architecture-narrative pipeline 重构：MapReduce + 3-pass critique loop
- hyperedges pipeline 改造：扩展 design doc 来源 + 接入 cluster orchestrator
- `--include-docs` 数据流打通：extraction 结果真正进入 narrative 生成路径
- `graph.html` 始终生成：移除跳过条件，极小图显示 banner
- Context 可观测性：`costBreakdown` frontmatter 字段 + batch summary Top 5
- 测试 fixture 集：micrograd / nanoGPT / sindresorhus/ky / empty-project
- CI 跨项目隔离测试（`.github/workflows/`）
- CHANGELOG + 文档更新（batch 耗时增加说明）
- v4.1.0 release 准备（release:sync + tag）

### 不在范围（明确排除）

- **`spectra audit` 子命令**（Q8 决议）：留 v4.2.0
- **symbol-level graph**（Feature 141 / v4.2.0）：不在本 Feature
- **跨 batch 缓存 / 增量更新**（留 v4.2.0）
- **多层级 hierarchy**（GraphRAG 的 C0-C3）：架构文档 §六 明确排除
- **Recursive reduce**：单层 Reduce 已满足需求
- **Embedding-based dedup（MinHash/LSH）**：Reduce 阶段 LLM 语义去重
- **Streaming reduce**：全量 Map 后统一 Reduce
- **自适应 cluster size**：固定 minSize=3 / maxSize=15
- **GPU 嵌入索引 / 向量库**：无 query-time 检索需求
- **Confidence learning（基于历史校准）**：静态规则已满足
- **`--no-cluster` CLI flag**（Q15 决议）：< 5 模块自动 single 兜底

---

## 功能性需求（Functional Requirements）

### FR-001：Cluster Orchestrator 基础设施 [必须]

**级别**：MUST

**描述**：系统必须提供 `clusterDispatch<TIn, TMap, TRed>()` 函数，实现 Phase A（聚类）→ Phase B（并发 Map）→ Phase C（Reduce）的 3 阶段 pipeline。

**输入**：`ClusterDispatchOptions` 含输入项列表、聚类策略、shared header 生成函数、Map 函数（含模型配置与超时）、Reduce 函数（含模型配置与超时）、observability hooks。

**输出**：`ClusterDispatchResult` 含最终产物 + diagnostics（clusterCount / mapSucceeded / mapFailed / totalTokens / durationMs / mergeConfidence）。

**验证方式**：单元测试 mock LLM client，验证聚类策略 fallback chain（community → directory → single）、Map 并发度 ≤ maxConcurrency=4、Reduce 重试 1 次、< 50% Map 成功时 fail-closed。

**追踪 US**：US-001 / US-002 / US-003

**必要性理由**：去掉后 3 个生成器各自实现 MapReduce，代码重复且行为不一致。

---

### FR-002：聚类策略三级 fallback [必须]

**级别**：MUST

**描述**：聚类执行顺序为：(1) community（复用现有 `graphology-communities-louvain`，minSize=3 / maxSize=15）→ (2) directory（按目录分组）→ (3) single（不聚类，整体作为 1 个 cluster）。任一策略失败自动降级到下一级。

**输入**：module spec 列表 + 当前项目 dependency graph。

**输出**：cluster 列表（`TInput[][]`），每 cluster 长度 ∈ [minSize, maxSize] 或 single 时无限制。

**验证方式**：单元测试分别 mock Louvain 失败、目录分组失败，断言最终走 single 不报错。

**追踪 US**：US-001 / US-002 / US-003

**必要性理由**：无 fallback 则 Louvain 偶发失败导致整个 pipeline 中断。

---

### FR-003：删除全部 hardcoded ADR candidate 函数 [必须]

**级别**：MUST

**描述**：删除 `src/panoramic/pipelines/adr-decision-pipeline.ts` 中的全部 8 个 hardcoded candidate 函数（含 `buildStreamJsonProtocolCandidate` 等）和基于关键词匹配的候选触发逻辑。改为通过 cluster orchestrator 调用 LLM 发现 ADR 候选。

**输入**：被删除（不再有 hardcoded 候选）。

**输出**：`buildAdrCandidates()` 成为单一入口，调用 `clusterDispatch` 执行 Map/Reduce。

**验证方式**：代码审查确认 8 个函数不存在；grep 项目源代码无 `buildStreamJsonProtocol` 等函数名；4 fixture 上跑 batch 后 ADR 标题集合 distinct 率 = 100%。

**追踪 US**：US-001

**必要性理由**：hardcoded 候选是 ADR hallucination 的直接根因，不删除则 hallucination 问题无法根本解决。

---

### FR-004：ADR Map 阶段使用 Sonnet，Reduce 阶段优先 Opus [必须]

**级别**：MUST

**描述**：ADR pipeline 的 Map 阶段（每 cluster 独立候选发现）使用 sonnet 模型；Reduce 阶段（跨 cluster 候选合并去重）优先使用 opus 模型。Opus 不可用时降级 sonnet 并记录 `confidence: medium`。

**输入**：`ClusterDispatchOptions.map.model = 'sonnet'`，`ClusterDispatchOptions.reduce.model = 'opus'`。

**输出**：ADR frontmatter 含 `generatedByModel` 字段，格式为 `{ map: <modelId>, reduce: <modelId> }`。

**验证方式**：集成测试 mock 模型响应，断言 Map 调用使用 sonnet、Reduce 调用使用 opus；4 fixture batch 后检查 frontmatter `generatedByModel` 字段存在。

**追踪 US**：US-001

**必要性理由**：Q9 决议（仅 Reduce 阶段优先 opus）。

---

### FR-005：ADR evidenceRef 自动真实性校验 [必须]

**级别**：MUST

**描述**：对每条 ADR 的每个 evidenceRef，程序化校验：(1) `source` 文件存在；(2) `location` 行号范围有效；(3) `snippet` 与文件实际内容字符匹配（允许 ≤10% 空白差异）。校验结果写入 `verified: boolean` 字段。

**输入**：LLM 输出的 ADR draft（含 evidenceRefs 列表）+ 项目文件系统。

**输出**：每个 evidenceRef 追加 `verified` 字段；通过 validation gate：有效 evidenceRefs（verified=true）< 2 条的 ADR 从最终产物中移除（fail-closed）。

**验证方式**：单元测试覆盖：文件不存在 / 行号越界 / snippet 不匹配 / 空白差超 10% 等场景；集成测试断言 4 fixture 上 verified=true 占比 ≥ 90%。

**追踪 US**：US-001

**必要性理由**：Q3 决议（evidence 真实性自动校验）；去掉则 Reduce 阶段仍可能产出幻觉 evidence。

---

### FR-006：旧 ADR 添加 supersede notice [必须]

**级别**：MUST

**描述**：对升级前已存在的 hallucinated ADR（8 个 hardcoded candidate 对应的旧产物），沿用 Feature 135 的 `_PIPELINE_DISABLED.md` 模式，在旧 ADR 文件头部追加 supersede notice，标注其由 v4.1.0 重新生成的版本替代。不删除旧文件。

**输入**：存量 ADR 文件（含旧格式 frontmatter）。

**输出**：旧 ADR 文件保留，frontmatter status 改为 `superseded`，追加 `supersededBy` 字段指向新 ADR。

**验证方式**：集成测试：在含旧 ADR 的 fixture 上跑 batch，断言旧 ADR 文件存在且 status=superseded。

**追踪 US**：US-001

**必要性理由**：Q6 决议（保留旧 ADR + supersede notice）。

---

### FR-007：hyperedge design doc 来源扩展 [必须]

**级别**：MUST

**描述**：`designDocAbsPaths` 计算逻辑扩展为按优先级合并：(1) 根目录 README.md（始终包含）；(2) `docs/**/*.md`（`--include-docs` 启用时）；(3) `specs/modules/*.spec.md`（当前 batch 产物，每次 batch 后存在）；(4) `.specify/project-context.{yaml,md}`。

**输入**：项目根目录结构 + `--include-docs` 标志位。

**输出**：`designDocAbsPaths` 包含上述合并来源；hyperedge extractor 收到非空输入。

**验证方式**：单元测试 mock 文件系统，断言各来源按优先级合并；integration test 断言新项目首次 batch 后 `graph.json.hyperedges.length >= 1`。

**追踪 US**：US-002

**必要性理由**：去掉则新项目首次 batch 的 hyperedge 失效问题无法修复。

---

### FR-008：architecture-narrative 走 MapReduce + 3-pass critique [必须]

**级别**：MUST

**描述**：narrative pipeline 执行 6 个阶段：Phase A 复用 ADR cluster 划分（避免重新聚类）→ Phase B Map per cluster（sonnet，输出 cluster mini-narrative + key abstractions）→ Phase C Reduce（sonnet，合并为 4-6 段 narrative）→ Phase D Critique（独立 sonnet 调用，输出 `{passed: bool, issues: []}`）→ Phase E Refine（仅 Phase D fail 时，最多 1 次，sonnet）→ Phase F 程序化 domain-words 校验（≥3 个核心抽象名）。

**输入**：module spec 列表 + project-context.yaml + README（启用 --include-docs 时）。

**输出**：narrative 文本（4-6 段）+ frontmatter 含 `critiqueResult`（即使 Pass D 通过也保留摘要）。Phase F 不达标 → fail-closed（不写盘）。

**验证方式**：集成测试：4 fixture 上 narrative 均含 ≥3 个项目特有抽象名；snapshot 测试确认无模板字符串；mock Critique 失败场景断言 Refine 被触发且最多 1 次。

**追踪 US**：US-003

**必要性理由**：Q10 决议（3-pass critique）；去掉则 narrative 模板化问题无法保证修复。

---

### FR-009：删除 narrative 模板填充路径 [必须]

**级别**：MUST

**描述**：删除当前"项目子域目录 6 行占位表格"的生成逻辑和整个 file-system 元数据 template-fill 路径。

**输入**：无（被删除的代码路径）。

**输出**：narrative 生成唯一路径为 MapReduce pipeline。

**验证方式**：代码审查确认旧模板路径不存在；4 fixture 上断言 narrative 不含"项目子域目录，覆盖 N 个模块"字样。

**追踪 US**：US-003

**必要性理由**：不删除旧路径则新旧路径并存，产物不可预测。

---

### FR-010：--include-docs 数据流打通 [必须]

**级别**：MUST

**描述**：`--include-docs=true` 时：README.md 全量内容（不再限制 5k tokens，Q4/Q7 决议）进入 architecture-narrative pipeline 和 hyperedge extractor 的 input context；其他 .md 进入 extraction-pipeline 作为图节点（kind: doc）。日志从"跳过 .md 文件（不支持）"改为"include-docs: 已加入 N 份 .md 作为语义上下文"。

**输入**：`--include-docs` 标志位 + 项目 .md 文件列表。

**输出**：extraction results 被 architecture-narrative 生成器消费；batch 日志含 include-docs 统计行。

**验证方式**：集成测试对比 `--include-docs` 开关前后的 context assembler 输入；断言日志无"跳过"字样；断言 README 内容出现在 narrative 的 context 中。

**追踪 US**：US-004

**必要性理由**：去掉则 --include-docs 功能描述与实际行为的矛盾持续存在。

---

### FR-011：graph.html 始终生成 [必须]

**级别**：MUST

**描述**：`batch-orchestrator.ts` batch 末尾始终调用 `exportGraphHtml`，移除当前基于图复杂度阈值的跳过条件。极小图（< 3 节点）生成的 HTML 内嵌说明 banner。

**输入**：batch 执行完成事件。

**输出**：`_meta/graph.html` 始终存在于 batch 输出目录。

**验证方式**：4 fixture 上 batch 后断言 `_meta/graph.html` 文件存在；极小图场景断言 HTML 含 banner 字符串。

**追踪 US**：US-005

**必要性理由**：去掉则输出不一致性问题持续存在。

---

### FR-012：module spec frontmatter 包含 costBreakdown [必须]

**级别**：MUST

**描述**：每个生成的 module spec frontmatter 包含以下字段：
```yaml
costBreakdown:
  contextAssembly: <N>    # cross-module context tokens
  promptTemplate: <N>     # template tokens
  sourceFile: <N>         # 主文件 tokens
  llmReasoning: <N>       # output tokens
contextTruncated: <bool>  # 是否触发 budget 截断
```
token 计数使用粗算（chars / 3.5）。

**输入**：context assembler 执行过程中的 token 统计。

**输出**：frontmatter YAML 含以上字段。

**验证方式**：unit test mock token 计数器；4 fixture batch 后验证 frontmatter schema 合规；默认 budget 下 `contextTruncated=false`；`--context-budget 5000` 下 nanoGPT 的 bench.py spec `contextTruncated=true`。

**追踪 US**：US-006

**必要性理由**：去掉则 context 可观测性目标无法实现。

---

### FR-013：batch summary 输出 Top 5 token 消费模块 [SHOULD]

**级别**：SHOULD

**描述**：batch 执行完成后的 summary 输出"Top 5 input token 消费模块"列表（格式：模块名 + contextAssembly token 数），作为可观测性信号。

**输入**：各 module spec 的 costBreakdown.contextAssembly 汇总。

**输出**：batch summary 打印 5 条排序条目。

**验证方式**：integration test 断言 batch 完成后 stdout 含"Top 5"相关输出；mock 6 个模块的 token 计数，断言正确排序取 Top 5。

**追踪 US**：US-006

**必要性理由（可选标注）**：去掉后核心 costBreakdown 功能仍可用，但用户感知 token 消耗的体验受影响。

---

### FR-014：cluster orchestrator telemetry hooks [必须]

**级别**：MUST

**描述**：cluster orchestrator 提供完整 observability hooks：`onClusterPlanned` / `onMapStart` / `onMapComplete` / `onMapFailed` / `onReduceStart` / `onReduceComplete`，每个 Map/Reduce 调用完成时回传 `CallTelemetry`（inputTokens / outputTokens / durationMs / modelId）。

**输入**：`ClusterDispatchOptions` 中配置 hooks。

**输出**：hooks 在对应阶段被调用；`ClusterDispatchResult.diagnostics` 汇总 token 统计。

**验证方式**：单元测试验证各 hook 在正确时机被调用（mock LLM）；断言 diagnostics 字段计算正确。

**追踪 US**：US-001 / US-002 / US-003 / US-006

**必要性理由**：去掉则 cluster 级别失败无法定位，违反"失败可观测"设计目标。

---

### FR-015：测试 fixture 集 + CI 跨项目隔离测试 [必须]

**级别**：MUST

**描述**：新增或维护 4 个测试 fixture（micrograd / nanoGPT / sindresorhus/ky / empty-project）；在 `.github/workflows/` 中配置跨项目隔离断言：ADR 标题集合 distinct 率 = 100%、module spec 含 ≥3 个项目特有标识符、narrative 含领域词、hyperedges ≥ 1（非空 fixture）、evidence verified=true 占比 ≥ 90%。

**输入**：4 个 fixture 项目目录（snapshot 管理）。

**输出**：CI workflow 每 PR 跑全部 4 fixture；断言通过率 = 100%。

**验证方式**：CI 日志显示 4 fixture 全部通过；手动模拟断言失败场景（如 ADR 标题重复）确认 CI 报错。

**追踪 US**：US-001 / US-002 / US-003

**必要性理由**：去掉则跨项目隔离（hallucination 根本检验）无自动验证。

---

## 非功能性需求（Non-Functional Requirements）

### NFR-001：大项目 batch latency 线性增长

**描述**：batch 总耗时随项目模块数线性增长，不受单模型上下文窗口限制崩溃。参考基准：100 文件合成 fixture 在默认 maxConcurrency=4 下 batch 完成 < 10 分钟。

**注意**：由于引入 MapReduce + 3-pass critique，中等规模项目（15 模块）的 batch 耗时相比 v4.0.x 预计增加 60-120 秒，CHANGELOG 中明确说明。

**验证方式**：在 100 文件合成 fixture 上计时 batch 执行，断言 < 10 min。

---

### NFR-002：每个 LLM 调用 input ≤ 100k tokens（保证全模块覆盖，不静默丢弃）

**描述**：cluster orchestrator 保证每个 Map call 的 input token 数 ≤ 100k（chunk budget 100k，支持在 Sonnet 4.6 的 200k 上下文内工作，留 100k 给 output 与缓冲）。

**超大 cluster 处理（基于 Codex review finding 2 修正）**：cluster 经初始 Louvain 划分后若 token 总和超 100k，**必须按确定性算法拆分成多个子 cluster**，每个子 cluster ≤ 100k。**禁止用"按 spec 大小排序截断尾部"等方式静默丢弃模块**——这会违反"项目规模与模型容量解耦"的核心承诺（架构文档 §一）。拆分策略：按模块 spec 大小贪心装箱（first-fit decreasing），保证每个模块进入 exactly 1 个子 cluster，**零模块丢失**。子 cluster 在 Reduce 阶段与同源 cluster 的输出一并合并去重。frontmatter 仅标注 `clusterSplit: <count>`（记录拆分数量），不再使用 `clusterTruncated` 字段。

**验证方式**：(1) 单元测试构造超 100k 的合成 cluster，断言所有模块都出现在拆分后的某个子 cluster 中（Set 等价性）；(2) 集成测试断言 batch 产物覆盖所有源模块的 ADR/narrative/hyperedge 引用，无任何模块被静默丢弃。

---

### NFR-003：向后兼容

**描述**：现有 2232 个测试零新增失败（已知 pre-existing 2 个版本号失败除外，处理方式在实施阶段决定）。CLI 接口兼容：`--include-docs` / `--hyperedges` / `--mode` 等现有 flag 语义不变（仅 `--include-docs` 的内部数据流修改，外部接口不变）。

**验证方式**：`npx vitest run` 零新增失败；CLI flag 文档与实现一致性审查。

---

### NFR-004：失败可观测与 fail-closed

**描述**：任何生成阶段失败时：(1) 不产出部分/空的产物文件；(2) 在 `_meta/` 目录写入 `_PIPELINE_FAILED.md` 标记（沿用 Feature 135 模式）；(3) 日志包含失败定位信息（cluster 编号 / 阶段名 / 错误类型）。Reduce 失败重试 1 次，仍失败则 fail-closed。

**验证方式**：单元测试模拟 Map/Reduce 失败，断言失败标记文件生成且无部分产物。

---

### NFR-005：cluster orchestrator 单元测试覆盖率 ≥ 90%

**描述**：`src/panoramic/cluster-orchestrator.ts` 的单元测试行覆盖率 ≥ 90%，使用 mock LLM client，不依赖真实 API。

**验证方式**：`npx vitest run --coverage` 报告 cluster-orchestrator.ts 覆盖率。

---

## 依赖与前置

| 依赖 | 类型 | 说明 |
|------|------|------|
| Feature 131（已完成）| 产物依赖 | hyperedges schema v2.0；本 Feature 直接复用，不修改 schema |
| Feature 135（已合入 master）| 代码依赖 | fail-loud 基础设施（`_PIPELINE_DISABLED.md` 模式、WARNING 路径）；本 Feature 把 WARNING 路径换为真正修复，沿用 fail-closed 标记格式 |
| `graphology-communities-louvain`（已存在）| 库依赖 | 复用现有 Louvain 社区检测实现；不引入 Leiden / igraph-js 等新依赖（Q13 决议）|
| `src/panoramic/community/`（已存在）| 代码复用 | cluster orchestrator 的聚类策略复用此目录现有实现 |
| `src/core/context-assembler.ts`（已存在）| 改造目标 | 改造为"按 AST 调用图相关性排序 + 超 budget 截断"，不重写 |
| `src/batch/batch-orchestrator.ts`（已存在）| 改造目标 | 修改 graph.html 生成条件 + --include-docs 日志 + designDocAbsPaths |
| sindresorhus/ky（外部 fixture）| 测试依赖 | ~30 文件纯 TS 开源库，Q1 决议选定；通过 git submodule 或 snapshot 管理 |

---

## 决策日志摘要

Q1-Q15 全部已在规划阶段固化（见 `research/01-feature-plan.md` §决策日志 + `research/02-mapreduce-architecture.md` §十 决策日志变更）。**禁止重新决议**，各 spec / plan / tasks 阶段直接引用决策结果作为约束。

关键决策速查：

| 决策 | 结论 |
|------|------|
| Q2 ADR hardcoded candidates | 全删 |
| Q3 evidence 真实性校验 | 自动校验（程序化）|
| Q4 --include-docs 默认值 | 保持 false |
| Q5 context budget | 100k chunk size（MapReduce chunk-bounded）|
| Q6 旧 ADR 处理 | 保留 + supersede notice |
| Q7 LLM 成本约束 | 不作为约束，质量优先 |
| Q8 spectra audit 子命令 | 本 Feature 不做，留 v4.2 |
| Q9 ADR 模型策略 | Map=sonnet / Reduce 优先 opus |
| Q10 narrative 3-pass | 是（synthesize → critique → refine）|
| Q11 orchestrator 独立 Feature | 否，作为 Phase 0 |
| Q12 Map 并发度 | maxConcurrency=4 |
| Q13 聚类算法 | 沿用 Louvain（不引入 Leiden）|
| Q14 cluster maxSize | 15 |
| Q15 --no-cluster flag | 不加，< 5 模块自动 single |

---

## DoD（Definition of Done）

以下 11 条均为硬性验收，每条可机器验证。前 8 条来自 `research/01-feature-plan.md` §八，后 3 条来自 `research/02-mapreduce-architecture.md` §十一：

1. **ADR 不再 hallucinate**：4 fixture ADR 标题集合 distinct 率 = 100%；所有 ADR 含 ≥2 条 verified=true evidenceRefs；所有 evidenceRefs source/location 经自动校验真实存在；frontmatter `generatedByModel` 字段存在。
2. **hyperedges 真正生效**：micrograd / nanoGPT / ky fixture 上 `--hyperedges --mode full` 后 `graph.json.hyperedges.length >= 1`。
3. **architecture-narrative 含领域词**：4 fixture narrative 含 ≥3 个项目特有技术术语；不含"项目子域目录，覆盖 N 个模块 / N 个文件"字样；frontmatter 含 `critiqueResult` 摘要。
4. **--include-docs 无矛盾日志**：启用后日志不出现"跳过 .md 文件（不支持）"。
5. **graph.html 始终生成**：4 fixture batch 输出均含 `_meta/graph.html`。
6. **Context Quality 可观测**：所有 module spec frontmatter 含 `costBreakdown` 字段；batch summary 含"Top 5 input token 消费模块"；默认 budget=100k 下 4 fixture `contextTruncated=false`；`--context-budget 5000` 在 nanoGPT 上触发 `contextTruncated=true`。
7. **回归测试**：现有 2232 测试零新增失败（已知 pre-existing 失败明确标注）。
8. **CI 跨项目隔离测试**：`.github/workflows/` 中 4 fixture 断言全部通过。
9. **MapReduce 架构正确性**：cluster-orchestrator.ts 单元测试覆盖率 ≥ 90%；4 fixture cluster 数符合预期（micrograd=1, nanoGPT=2-4, ky=3-5, empty=0）。
10. **大项目可扩展性**：100 文件合成 fixture 上 batch 完成 < 10 min（maxConcurrency=4）；frontmatter `mergeConfidence` distribution ≥80% 为 high/medium。
11. **跨 cluster 决策捕获**：在 nanoGPT 上手动验证 ≥1 条 ADR 同时引用 ≥2 个不同 cluster 的 evidence。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数量 / 状态 |
|------|------------|
| 组件总数（新增）| 5（cluster-orchestrator / ADR MapReduce pipeline / narrative MapReduce pipeline / hyperedge 改造 / evidence verifier）|
| 接口数量（新增或修改）| 7（ClusterDispatchOptions / ClusterDispatchResult / CallTelemetry / ADRCandidate schema / narrative phase schema / hyperedge extractor 入参扩展 / batch summary output）|
| 依赖新引入数 | 0（全部复用现有依赖：Louvain / context-assembler / community/ 目录）|
| 跨模块耦合 | 是（修改 batch-orchestrator / extraction-pipeline / context-assembler / narrative pipeline / adr pipeline ≥5 个模块）|
| 复杂度信号 | 并发控制（Map maxConcurrency）/ 状态机（3-pass critique loop / fallback chain）|
| **总体复杂度** | **HIGH** |

**判定理由**：组件数 = 5（≤5 不超 HIGH 阈值），但接口数 = 7（> 8 边界略低），且存在 2 个复杂度信号（并发控制 + 状态机），触发 HIGH 条件。

**GATE_DESIGN 建议**：鉴于 HIGH 复杂度，建议在 plan 阶段对 cluster-orchestrator Phase 0 进行独立的技术设计审查，确认接口定义稳定后再启动 Phase 3 的并行实施。
