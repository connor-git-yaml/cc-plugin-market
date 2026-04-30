# Changelog

本文件记录 cc-plugin-market（Spectra + Spec Driver）仓库的重要变更。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [4.1.1] — 2026-04-30

> **Spectra v4.1.1 LLM 并发优化（Feature 146）** — 替换手写信号量为 p-limit + 默认并发数从 1 提升到 3。Patch release（用户体验变化，非破坏性）。

### Changed — spectra

- **默认并发数 1 → 3**（Feature 146）— `batch-orchestrator` 默认 `concurrency: 3`（之前为 1，串行）。Sonnet 单请求 15-30s，concurrency=3 时大项目（30+ 模块）总耗时下降 ~60-65%。小项目（< 5 模块）无感。
- **p-limit 替换手写信号量**（Feature 146）— 移除 ~30 行手写并发实现（含历史 H2 死锁补丁），替换为 `p-limit ^6.1.0` 的 4 行调用。代码可读性提升 + 修复一些极端场景的死锁风险。
- **三级配置链**（Feature 146）— `BatchOptions.concurrency` > 环境变量 `SPECTRA_CONCURRENCY` > 默认 3。CI 资源紧张时 export `SPECTRA_CONCURRENCY=1` 可恢复串行。

### 影响评估

- **正向**：大项目跑 batch 显著加速；性能默认值更接近 user 实际期望
- **负面（罕见）**：依赖外部 API rate limit 严格的环境（如 Anthropic 1 RPM 测试 key）可能触发限流，需手动设 `SPECTRA_CONCURRENCY=1`
- **建议**：升级后首次跑 batch 观察是否触发 rate limit；若是，env 设 1 串行即可

### 验证

- 全量 vitest 通过
- graphify 测试项目（5 文件）实测 batch 耗时变化（small project 应基本不变）
- micrograd 测试项目（4 文件）实测一致

详见 specs/146-llm-concurrency-optimizer/。

## [v4.1.0] - 2026-04-29

> **Spectra v4.1.0 Python AST 函数级 Graph + Phase 2 Bug 修复** — P0（新功能）：Python 项目 `graph.json` 现在包含函数/类符号节点；P1/P2（bug 修复）：hyperedge 首次运行即生效、debt-scanner 诊断日志增强。
>
> **注**：原 spec 的 P3（dry-run 偏差校准）在 rebase 时发现已由 master `5bb416f` 用 `SYSTEM_PROMPT_TOKENS_PER_MODULE = 6500` 单常量方案抢先修复，本 feature 撤回 P3 改动避免重复实现。

### Added — spectra

- **Python 函数级 Graph（P0）** — `PythonLanguageAdapter` 新增 `extractSymbolNodes(projectRoot)` 方法，遍历所有 `.py` 文件，将 `CodeSkeleton.exports` 中的函数/类转换为 `ExtractionResult` 格式（`kind='component'`，`id={relPath}#{symbolName}`），并生成文件级 `module` 节点和 `contains` containment 边，注入 `buildKnowledgeGraph()` 第四路数据源（FR-001~FR-005）。
- **ExtractionResult kind 类型扩展** — `extraction-types.ts` 的 `ExtractedNodeSchema` 和 `ExtractedNodeKind` 新增 `'component'` 和 `'module'` 枚举值，与 `GraphNode.kind` 对齐（Feature 145 P0 支撑）。
- **Codex 对抗审查衍生改进** — `python-adapter.ts` 解析失败 metadata 标记 + batch-orchestrator 聚合 warn（C001）；`buildDesignDocAbsPaths` 检测嵌套子目录 warn（W002）；`buildDependencyGraph` 失败升 warn 级别（W004）；`extraction-types` 测试覆盖完整 8 种 kind（I002）。

### Fixed — spectra

- **hyperedge 首次运行即生效（P1）** — `batch-orchestrator.ts` 中 `designDocAbsPaths` 构建逻辑改为"磁盘优先"合并策略：先取本轮 `writtenFiles`，再主动扫描 `outputDir/project/` 目录下已存在的 `.md` 文件，去重合并。解决首次运行时 `writtenFiles` 为空导致 hyperedge 被静默跳过的 bug（FR-006/FR-007）。
- **debt-scanner 诊断日志增强（P2）** — `debt-intelligence-pipeline.ts` 诊断日志新增 `openQuestions.length` 和 `ruleCandidates`，便于排查 Open Questions 为空的根因（FR-008/FR-009）。

## [Unreleased]

### Added — Feature 140 Step 5（Phase 2）：--include-docs 数据流打通

- **`extraction-pipeline` 返回类型变更**（`src/extraction/extraction-pipeline.ts`，T21）— `runExtractionPipeline` 返回 `ExtractionPipelineOutput { results, readmeContent? }` 包装对象（之前为 `ExtractionResult[]`）。`includeDocs=true` 时读取 projectRoot 下的 `README.md`（不区分大小写：README.md / readme.md / Readme.md / README.MD 等）全量内容（移除 v4.0.x 旧 5k token 限制），放入 `readmeContent`，供下游 narrative / hyperedge 等 pipeline 作为 shared header 注入。
- **`findReadmePath` 共享导出**（`src/extraction/index.ts`）— 公共导出大小写不敏感的 README 路径定位助手，避免 batch-orchestrator 与 extraction-pipeline 维护两份不同的候选列表（修复 Codex CRITICAL 2 — 候选列表前后不一致漏掉 `README.MD`）。
- **`batch-orchestrator` 早期 README 读取**（`src/batch/batch-orchestrator.ts`，T22）— 在 `generateBatchProjectDocs` 之前共享 `findReadmePath` 做 early read（narrative 在 docs 阶段生成，早于 multimodal extraction-pipeline），透传 `readmeContent` 到 narrative 选项。同时新日志：`include-docs: 已加入 N 份 .md 作为语义上下文（含 README: 是/否）`，替代 v4.0.x 时代误导性的"跳过 .md 文件（不支持）"。
- **`generateBatchProjectDocs` 透传**（`src/panoramic/batch-project-docs.ts`，T24）— `GenerateBatchProjectDocsOptions` 加 `readmeContent?` 字段，传递给 `buildArchitectureNarrative`。
- **`architecture-narrative.readmeExcerpt`**（`src/panoramic/pipelines/architecture-narrative.ts`，T24）— `BuildArchitectureNarrativeOptions` 加 `readmeContent?` 参数；`ArchitectureNarrativeOutput` 加 `readmeExcerpt?` 字段（截断到 1000 chars + `…` 省略号；空白字符串视为不存在）。
- **`templates/architecture-narrative.hbs` 新增 README 摘录段**（修复 Codex CRITICAL 1 — 字段产出但模板从未渲染）— 新增 `## 0. README 摘录` 段，`{{#if readmeExcerpt}}` 守卫，仅在传入 readmeContent 时渲染。
- **hyperedge 集成注入 README 虚拟 DocChunk**（`src/batch/batch-orchestrator.ts`，T26）— 当 `extractedReadmeContent` 存在时，合成虚拟 `DocChunk { filePath: 'README.md', startLine: 1, endLine: lines, headingPath: 'README', text: readmeText, tokenCount: ceil(length/4) }` 并 `unshift` 到 `docChunks` 头部（最高优先级）。让 hyperedge extractor 在 LLM 调用中始终能看到项目顶层叙述，不依赖 designDocAbsPaths 的扫描覆盖度。
- **14 个新增测试**：
  - `tests/extraction/extraction-pipeline.test.ts` 修改 7 处适配新返回类型（`.toEqual([])` → `.results.toEqual([])`，`.length` → `.results.length`）
  - `tests/unit/include-docs-pipeline.test.ts` 新建 12 用例（runExtractionPipeline readmeContent 7 case + buildArchitectureNarrative readmeExcerpt 4 case + renderArchitectureNarrative markdown 渲染断言 case 12-13 锁定 Codex CRITICAL 1）
  - `tests/integration/include-docs-integration.test.ts` 新建 4 用例 + 3 fixture-based `it.todo()`（待 Phase 1a fixture 落地）
- **Codex adversarial review**：1 轮 2 critical + 6 warning，2 critical 全部修复（W1 `readmeExcerpt` silently ignored → 模板加 README 摘录段；W2 候选列表不一致 → 共享 `findReadmePath` 导出）。warning 中的 token 口径漂移、E2E 覆盖盲区、anchor 集成缺失等留 Step 3 / Phase 1a 处理。

### Added — Feature 140 Step 7（Phase 1b）：Context Observability + costBreakdown frontmatter

- **`estimateTokens(text)` 公共导出**（`src/core/token-counter.ts`）— spec FR-012 锁定的简化估算公式（`Math.ceil(text.length / 3.5)`），供 Feature 140 cluster orchestrator FFD 装箱、context-assembler costBreakdown 等场景统一口径。与既有 `estimateFast`（CJK-aware，2.5/3.8 分母）保留并存：内部裁剪决策走 `estimateFast` 求精准，对外报告走 `estimateTokens` 求一致。
- **`AssembledContext.tokenBreakdown` 三层聚合字段**（`src/core/context-assembler.ts`）— 新增非可选字段 `tokenBreakdown: { contextAssembly, promptTemplate, sourceFile }`：
  - `contextAssembly` 聚合 6 类跨模块输入（dependencies / snippets / codeSlices / readmeContext / callerContext / knowledgeFiles）的裁剪后 token 数
  - `promptTemplate` = LLM prompt 模板 instructions
  - `sourceFile` = 目标模块 skeleton
- **`SpecFrontmatter.costBreakdown` + `contextTruncated` 字段**（`src/models/module-spec.ts`）— 新增可选字段（向后兼容旧 spec）：
  - `costBreakdown: { contextAssembly, promptTemplate, sourceFile, llmReasoning }` — input 端 3 层 + LLM output token，供观测每模块在 LLM 调用中的实际消耗
  - `contextTruncated: boolean` — context 是否因 budget 被裁剪
  - 配套 `CostBreakdownSchema` Zod 校验
- **`generateFrontmatter` 透传**（`src/generator/frontmatter.ts`）— `FrontmatterInput` 接受 `costBreakdown` / `contextTruncated`，仅在传入时写入（保持向后兼容）。
- **`single-spec-orchestrator.ts` 接通**（`src/core/single-spec-orchestrator.ts`）— `assembleContext` 后从 `context.tokenBreakdown` 提取，`llmReasoning = costInputTokens 累加 output`；LLM 降级（`llmDegraded=true`）时跳过 `costBreakdown` 写入（避免 AST-only 路径产生误导观测），但 `contextTruncated` 仍如实反映本次 budget 决策。
- **batch-orchestrator Top 5 token 消费模块**（`src/batch/batch-orchestrator.ts`，FR-013）— 步骤 6 之前新增聚合：从 `collectedModuleSpecs[].frontmatter.costBreakdown.contextAssembly` 排序取 Top 5，按"千分位 + en-US locale"格式打到 `process.stderr`：
  ```
  Top 5 input token 消费模块：
    1. src/foo/big-module: 12,400 tokens
    2. src/bar/medium-module: 8,300 tokens
    ...
  ```
  缺失字段（mock / AST-only / 旧 cache）的模块自动跳过；聚合失败 try/catch 兜底，不阻断主流程。
- **16 个新增单元测试**：
  - `tests/unit/context-assembler-token.test.ts` 新建 11 用例（estimateTokens 公式 / 三层聚合数据流 / 裁剪后精确断言 / 公式同源比值稳定性 / NaN 防御 / 向后兼容）
  - `tests/unit/frontmatter-generator.test.ts` +5 用例（costBreakdown 4 字段 / contextTruncated true/false / AST-only 边界值）
- **TS 类型契约修复**：3 个老 mock（`single-spec-orchestrator.test.ts` / `enrichment-cost-accounting.test.ts`）补充 `tokenBreakdown` 字段，让 mock 与 TS 类型一致；删除 source 中的运行时 fallback（type lie）— 测试 mock 必须按 TS 类型完整提供该字段，由编译期捕获不合规 mock。
- **Codex adversarial review**：1 轮 4 warning 全部修复（W1 `estimateTokens` 调用一致性 / W2 `toLocaleString('en-US')` locale 锁定 / W3 case 9 精确比值断言 / W4 删除 type lie fallback + 更新 mock）。

### Added — Feature 140 Step 6（Phase 1c）：graph.html 始终生成 + 极小图 banner

- **`graph.html` 默认生成**（`src/batch/batch-orchestrator.ts`）— FR-011 / US-005：移除 `if (options.generateHtml)` opt-in 条件，改为 `?? true` 默认生成。CLI 不传 `--html` 也会产出 `_meta/graph.html`，与既有 `_meta/graph.json` / `_meta/GRAPH_REPORT.md` 输出一致性对齐。调用方仍可显式传 `generateHtml: false` 跳过。
- **`--no-html` CLI flag**（`src/cli/utils/parse-args.ts` + `src/cli/index.ts` help）— CI / 资源紧张场景显式 opt-out 路径；与 `--html` 同时出现时 `--no-html` 优先（与 git `--no-*` 系列约定一致）。
- **极小图 banner 注入**（`src/panoramic/exporters/html-template.ts`）— 节点数 < 3 时在 `graph.html` 顶部注入说明 banner（"This project has too few cross-module references for meaningful visualization. Run with --include-docs to add semantic context."），样式 `position: fixed` 浮动顶部（避开 body flex 布局），`role="alert"` 提升可访问性，#FFF3CD 警告色与 #FFC107 边框。
- **export 入口同步**（`src/panoramic/exporters/html-exporter.ts`）— `generateHtml(graphJson, communityResult, godNodes)` 也透传 `nodeCount`，使 `spectra export --format html` 在小图场景同样注入 banner（修复 batch / export 入口不一致）。
- **`GraphHtmlOptions.nodeCount` 字段**（`src/panoramic/qa/types.ts`）— 可选字段，未传时不显示 banner（向后兼容）。
- **18 个新单元测试**：`tests/panoramic/html-template.test.ts` +9（banner 文案 / 阈值边界 0/1/2/3/30 / 未传兼容 / 警告色 / role / NaN 防御 / position fixed 布局）；`tests/panoramic/html-exporter.test.ts` +2（export 入口 banner 一致性）；`tests/unit/parse-args-html-flag.test.ts` 新建 6（--html / --no-html / 双向冲突 / 反序）；`tests/integration/graph-html-generation.test.ts` 新建 4 契约 + 4 fixture-based `it.todo()`（待 Phase 1a fixture 落地后填充）。
- **Codex adversarial review**：双轮 0 critical + 4 warning（W1 CLI help / W1 `--no-html` / W2 banner flex layout 错位 / W3 export 入口不一致 / 反序测试缺失），全部修复并落测。

### Added — Feature 140 Phase 0：Cluster Orchestrator 基础设施

- **`src/panoramic/cluster-orchestrator.ts`**（新建，~600 行）— Spectra v4.1.0 MapReduce 统一调度层。提供 `clusterDispatch<TInput, TMapOutput, TReduceOutput>()` 通用接口，作为下游 ADR / narrative / hyperedges 三个 pipeline 的基础设施（Phase 3 全部阻塞于此 Phase）。覆盖 spec FR-001、FR-002、FR-014。
  - **Phase A 聚类策略三级 fallback chain**：community（复用 Louvain）→ directory（path.dirname 分组）→ single（兜底）；显式 `directoryFallback` 字段强制类型化降级路径
  - **Phase A.5 First-Fit-Decreasing 装箱**：cluster 超 maxSize=15 或超 tokenBudget=85k 时按 module token 大小降序装箱拆分；**保证零模块丢失**（Codex review 已修的设计 bug 不退化）；巨型 input 通过 `diagnostics.oversizedInputs` 量化报告
  - **Phase B 并发 Map**：`p-limit(maxConcurrency=4)` + `perCallTimeout=180s`（默认）；单 cluster 失败容忍；`< 50% Map 成功` → fail-closed
  - **Phase C 单次 Reduce + 1 次重试**：`timeout=300s`；重试仍失败 → fail-closed（finalOutput=null + diagnostics.failClosedReason='reduce-failed'）
  - **6 个 telemetry hooks**：`onClusterPlanned / onMapStart / onMapComplete / onMapFailed / onReduceStart / onReduceComplete` + `safeInvokeHook` 包裹（同时处理同步抛错 + async hook 的 rejected Promise）
  - **`mergeConfidence` 程序化打分**：high（0 失败 + 0 重试）/ medium（0-30% 失败 OR 1 重试成功）/ low（> 30% 失败）
  - **AbortSignal 透传**：`MapOptions.fn` / `ReduceOptions.fn` 可选 `signal: AbortSignal` 参数；超时时 controller.abort 触发，caller 转发给 SDK 可真正取消 in-flight LLM 调用
  - **fail-closed 边界**：5 种 fail-closed 路径（clustering-failed / shared-header-failed / map-below-threshold / reduce-failed / 成功）每条都填充完整 diagnostics（含 clusterCount / clusterSplits / oversizedInputs）
- **38 个单元测试**（tests/panoramic/cluster-orchestrator-{clustering,dispatch,telemetry}.test.ts）— 覆盖：
  - 聚类策略 fallback chain（5 case + 2 边界）
  - FFD 装箱（合规不拆 / 超 maxSize / 超 budget / 大小不均 / 无 truncated 字段 / 巨型 input / tokenBudget=0 / 组合用例）
  - Map 并发上限 + 单 cluster 失败继续 + Map < 50% 成功 fail-closed + Map 超时
  - Reduce 重试 1 次成功 + 重试仍失败 + Reduce 超时
  - 6 个 telemetry hook 触发时机 + mergeConfidence 三态判定
  - sharedHeader 抛错 fail-closed + 同步 hook 抛错（含 onMapFailed）+ async hook rejected Promise + AbortSignal 透传 + oversizedInputs 量化
- **覆盖率**：cluster-orchestrator.ts **93.61% lines / 100% functions / 89.74% branches**（≥ 90% 目标达成）
- **Codex adversarial review**：双轮对抗审查共发现 5 个 critical/warning，全部修复（async hook rejection 处理 / FFD 巨型 input / directoryFallback 类型化 / withTimeout AbortSignal / 测试盲区补充）

### Added — Feature 140 设计阶段定稿（已合入 master）

- **Feature 140 设计阶段定稿**（specs/140-spectra-doc-pipeline-quality/）— Spectra v4.1.0 文档生产线质量重构的完整设计制品（spec.md / plan.md / tasks.md / 77 项 GATE_DESIGN checklist）。基于 MapReduce 架构（cluster orchestrator + Sonnet map + Opus reduce + first-fit-decreasing 装箱），解决 v4.0.1 fail-loud 临时治理掩盖的 6 类质量问题：ADR hallucinate / hyperedges 无效 / narrative template 化 / --include-docs 半实现 / graph.html 不一致 / context 不可观测。Codex adversarial review 已捕捉 2 个设计阶段 bug 并修复（HIGH: ADR migrate 谓词 OR 误用；MEDIUM: 超大 cluster 截断丢模块）。
- **MapReduce 架构权威设计文档**（docs/spectra-v4.1-mapreduce-architecture.md）+ **三 Feature 路线图**（docs/spectra-v4-hotfix-roadmap.md）+ **Feature 136→140 业务规划 v3**（docs/spectra-v4.1-feature-b-plan.md）。
- **Feature 141 路线规划**（symbol-level graph，留 v4.2.0）— 把图谱粒度从模块文件级降到代码符号级（class/function/method），让 God Nodes 识别真实代码核心抽象。

Feature 140 余下 8 步（Phase 1-4 共 46 任务，约 19-26 人天）按 step-by-step delivery 推进；待全部完成后由 user 决定何时升 v4.1.0 → v4.2.0 minor release。


## [4.0.1] — 2026-04-27

> **Spectra v4.0.1 信任修复** — 修复 v4.0.0 实测中发现的 4 类 bug，全部采用"临时治理"策略：禁用错误默认行为 + 补全 WARNING 可观测性 + 修正文档和版本字符串。不含架构改动（留 v4.1）。

### Fixed — spectra

- **ADR pipeline 临时禁用（Bug 1）** — v4.0.0 ADR pipeline 生成的内容存在 hallucination（evidence 与决策不实际绑定）。v4.0.1 默认禁用 ADR pipeline（`enableAdr: false`），需用 CLI `--enable-adr` 显式开启。末尾打印可见 hint 提醒用户。ADR 彻底修复（evidence-binding 重构）计划在 v4.1 完成。

- **`--hyperedges` 静默无效补 WARNING（Bug 2）** — 当 `mode != full` 或 budget gate 触发 skip-enrichment 时，hyperedge 集成被静默跳过但无任何提示，导致用户误以为功能正常运行。修复：`!semanticIntegrationAllowed` 分支从 `logger.info` 升级为 `logger.warn`；用户显式 opt-in `--hyperedges` 但条件不满足时向 stderr 打印可见 WARNING；`designDocAbsPaths` 为空时补充操作建议；batch summary 末尾新增 hyperedge 状态行。

- **`generatedBy` 版本字符串回归（Bug 3）** — `src/generator/frontmatter.ts`、`src/generator/index-generator.ts`、`src/spec-store/spec-store.ts` 三处均硬编码 `generatedBy: 'spectra v3.0'`，导致所有生成文档的 frontmatter 版本信息与实际版本不符。修复：新增 `getSpectraVersionString()` 辅助函数，通过 `createRequire(import.meta.url)` 动态读取 `package.json.version`；三处调用统一替换；`scripts/check-plugin-sync.sh` 新增 grep 检查规则，防止回归。

- **`--mode reading` help 文字误导（Bug 4）** — 原帮助文字将 reading 模式描述为"轻量，跳过产品文档层"，未说明模块级 LLM 仍然运行，导致用户误以为 reading 是快速模式。修复：`--mode` 选项帮助文字补充三档时间预估和特征说明（full/reading/code-only）；reading 模式在 TTY 终端打印 hint，明确指向更快的 `--mode code-only`。

- **中和遗留 hallucinated ADR 文件（Codex adversarial review 追加）** — 从 v4.0.0 升级到 v4.0.1 后，先前批次写入的 `docs/adr/adr-*.md` 和 `index.md` 仍保留在磁盘上，用户可能误以为是当前批次产物。修复：ADR pipeline 禁用时（`enableAdr: false`），若检测到遗留 `docs/adr/` 目录，自动写入 `_PIPELINE_DISABLED.md` 警告标记并改写 `index.md` 为 supersede notice，明确标注这些文件来自先前批次且已知存在 hallucination；不删除用户文件（保守策略）。

- **hyperedge 成功路径可见性修复（Codex adversarial review 追加）** — `--hyperedges` opt-in 时 batch summary 末尾的 hyperedge 数量状态行使用 `logger.info`，而默认 logger level=warn，在生产环境完全不可见。修复：用户显式 opt-in `--hyperedges` 时，无论 count 是 0 还是 > 0，均改用 `process.stderr.write` 强制输出并同时 `logger.warn`；count=0 时补充 `"LLM 未返回有效候选；可在 graph.json 验证"` 的上下文提示。

## [4.0.0] — 2026-04-27

> **Phase 2 Reading Platform Milestone Release** — 同时升级 Spectra v3.0.1 → v4.0.0 + Spec Driver v3.11.2 → v4.0.0。`balanced` preset / 默认 Claude 模型 / 编排器入口 三处 BREAKING，详见各 `### ⚠️ BREAKING` 节。

### 🎯 Milestone — M-101 Phase 2 Reading Platform Delivered

把 Spectra 从"分层文档生成器"演进为"可查询、可视化、可按场景伸缩的代码阅读平台"。本 Milestone 由 7 个 Feature + 2 个 Postmortem Fix 组成（详见 [M-101 blueprint](specs/M-101-phase2-reading-platform/blueprint.md) / [postmortem](specs/M-101-phase2-reading-platform/postmortem.md)）：

- **F1 Reveal & Cost Transparency** — README 首屏图摘要 + `tokenUsage` frontmatter + `--budget` / `--dry-run` / `--on-over-budget`
- **F2 Harden** — `SpecStore` 抽象 + `sourceKind` 元数据 + dev 热重载 + 依赖方向 audit CLI
- **F2.5 Rationalize** — 删除 9 个遗留原子 skill，spec-driver 单入口（[migration](docs/migrations/skill-deprecation.md)）
- **F3 Debt Intelligence** — `technical-debt.md` + 代码 TODO 扫描 + design-doc Open Questions 提取
- **F4 Anchor + Hyperedges** — `graph.json` schema v2.0（`references` / `conceptually_related_to` / `rationale_for` 边 + Hyperedges）+ chunked markdown embedding 函数级语义锚定
- **F5 Reading UX** — `--mode=reading` / `--mode=code-only` 轻量模式 + MCP `panoramic-query` 自然语言问答（RAG）+ `graph.html` D3 交互可视化
- **附带产出 Feature 133 (orchestration-overrides)** — spec-driver 项目级流程定制（分层 orchestration，[migration](docs/migrations/orchestration-overrides.md)）

**度量**：89 Phase 2 commits · 6,895 行新 src 代码（6 模块）· +571 测试（1,625 → 2,196）· 默认 LLM 成本下降 ~5x。

**Postmortem 7 教训**已写入 [M-101 postmortem](specs/M-101-phase2-reading-platform/postmortem.md) 作为 Phase 3 准入参考。Phase 3 候选方向见 [M-102 proposal](specs/M-102-phase3/proposal.md)。

### Changed — spectra ⚠️ BREAKING

- **默认 Claude 模型升级（Feature 133 P0-3）** — 升级到最新发布的 Sonnet 4.6 / Opus 4.7 1M 系列：
  - `DEFAULT_CLAUDE_MODEL`: `claude-sonnet-4-5-20250929` → **`claude-sonnet-4-6`**（2026-02-17 发布，含 1M context）
  - 逻辑名 `opus`: `claude-opus-4-1-20250805` → **`claude-opus-4-7`**（2026-04-16 发布，1M context 默认可用，无需 beta header）
  - **`balanced` preset 改为映射到 `sonnet`**（旧映射 `opus`），与 `cost-efficient` 等价；`quality-first` 仍指 `opus`
  - `DEFAULT_CODEX_ALIASES` 同步新增最新模型映射，保留历史条目作向后兼容
- **影响**：未显式 pin model 的项目下次运行会切换到新模型。`balanced` preset 用户的实际 LLM 调用从 Opus 切到 Sonnet（成本 $5/$25 → $3/$15 per MTok，速度更快）
- **建议**：希望保留旧行为的用户在 `spec-driver.config.yaml` 显式指定：
  ```yaml
  preset: quality-first    # 强制使用 Opus
  # 或
  agents:
    specify:
      model: claude-opus-4-1-20250805    # 显式 pin 旧版 Opus
  ```
- 调研依据：见 `specs/133-fix-postmortem-phase2/research/online-research.md`

### Fixed — spectra

- **Phase 2 收尾清理（Fix 134，5 个偏差，patch）** — Phase 2 集成回归测试在 graphify 示例项目发现 Fix 133 残留 4 个偏差，端到端验证再暴露 1 个隐藏架构 bug：
  - **(1) `spec-driver.config.yaml` 覆盖 sonnet 默认** — yaml 锁死 `preset: quality-first` + 10 个 agent 显式 `model: opus`，覆盖了 Fix 133 P0-3 的 sonnet 默认；dogfood 跑 spec-driver 流程时仍是 `claude-opus-4-7`。修复：`preset: quality-first → balanced`、10 个 `model: opus → sonnet`、首行注释同步。
  - **(2) `tokenUsage.input` 异常低（5 模块累计 input=30 vs output=35,759）** — Fix 133 P0-1 修了 output 提取，但 input 路径只读 `input_tokens` 主字段，漏了 prompt caching 时主输入会进 `cache_read_input_tokens` 的语义。修复：`src/auth/cli-proxy.ts` + `src/core/llm-client.ts` 累加 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`（任一缺失 fallback 0）；新增 7 个单测覆盖累加场景 + 向后兼容 + null 字段 + 边界。
  - **(3) reading 模式 499s 仍超 SC-001 < 120s** — Fix 133 P0-2 已跳过产品文档 + 模块 spec 的 LLM enrichment，但模块 spec 主调用仍走默认 model（受用户配置影响）。修复（方向 A）：提取 `src/batch/model-override-decision.ts` 纯函数 helper，决策矩阵 `isSmallModule || budgetCheaperModelAll || effectiveMode !== 'full'` 任一为真即强制 sonnet override，与默认 model 解耦；新增 8 个单测覆盖决策矩阵。
  - **(4) CLI batch help 字符串遗漏 `--hyperedges`** — Fix 133 已实现 `--hyperedges` flag 解析（`src/cli/utils/parse-args.ts:701`）+ batch handler 接入（`src/cli/commands/batch.ts:58`），但 `src/cli/index.ts:44` 的 batch help 字符串没列出，用户 `spectra batch --help` 看不到。修复：help 字符串追加 `[--hyperedges]` + 选项详情说明（仅 `mode=full` 生效 + env 等价路径）。注：项目用自定义 parse-args（非 commander），按实际架构修复。
  - **(5) `sonnetModelId` 真 bug（graphify E2E 暴露）** — `batch-orchestrator.ts:584` 用 `resolveReverseSpecModel({ agentId: 'specify-sonnet' })` 取 sonnet override 模型 ID，但 `'specify-sonnet'` 在 yaml agents 表不存在，会 fallback 到 preset；当用户配置 `quality-first` 时 sonnetModelId 实际是 opus，破坏小模块/budget 降级/reading 模式 强制 sonnet 的设计意图。**仅修偏差 1 yaml preset 不够**——当 spectra batch 跑外部项目（如 graphify）时，`loadDriverConfig` 向上搜父目录找 yaml，可能仍是旧 `quality-first`。修复（架构层）：新增 `getCanonicalSonnetModelId(runtime)` helper（`src/core/model-selection.ts`），直接从 `LOGICAL_*_MODEL_MAP` 取 `sonnet`，不依赖 yaml；batch-orchestrator 探测 `detectAuth().preferred.provider` 解析 runtime 后调用。新增 3 个单测覆盖 helper（含 yaml 存在 quality-first 时仍返回 sonnet）。
  - 验证：vitest 全量 2197 passed | 1 skipped，零新增失败；端到端在 graphify 示例项目（21 Python 模块）验证（reading 模式生成的 spec frontmatter `llmModel: claude-sonnet-4-6` ✓、`tokenUsage.input` ≈ 28892（之前 5 模块累计 30）✓、`spectra batch --help \| grep --hyperedges` 可见 ✓）。

- **CLI proxy token 提取（Feature 133 P0-1）** — Phase 2 集成回归发现：所有 module spec frontmatter 的 `tokenUsage` 全为 0，但 LLM 真调用了。根因是 `src/auth/cli-proxy.ts` 的 `StreamMessage` 类型把 `input_tokens / output_tokens` 当作 `type=result` message 的顶层字段，但 Claude CLI 实际嵌套在 `usage.*` 下；mock-only 测试沿用相同错误假设导致 2154 单测全过却生产失败（cost-summary 因此误报"未调用 LLM"）。
  - 修复：StreamMessage 接口新增嵌套 `usage` 字段，保留旧顶层字段作向后兼容；`parseStreamJsonOutput` 在 `type=result` 分支优先读 `msg.usage.*`，回落顶层
  - 新增 3 个单测 case + 1 个真实 SDK 集成测试（`vi.skipIf(!ANTHROPIC_API_KEY)` 守卫）
  - 下游影响：`frontmatter.tokenUsage` 在 CLI proxy 路径下恢复非零值；`batch-summary.md` / `quality-report.md` 的"未调用 LLM"误报自动消失

### Removed — spec-driver ⚠️ BREAKING

- **9 个遗留原子命令** `/spec-driver.{specify,plan,tasks,implement,clarify,analyze,checklist,constitution,taskstoissues}` 已从 `.claude/commands/` 删除。这些命令由 spec 032 从 speckit 重命名继承而来，但功能长期落后于 `plugins/spec-driver/skills/spec-driver-*/` 下的编排器 Skill，且两套零代码依赖、互不调用，长期造成命令面板混乱与维护双倍负担。
- 所有旧原子命令的能力均已被编排器 Skill 覆盖。迁移映射、使用示例与升级步骤详见 [`docs/migrations/skill-deprecation.md`](docs/migrations/skill-deprecation.md)。

### Changed — spec-driver

- **prompt_source fallback 下线（BREAKING 伴生）** — `spec-driver-implement` / `spec-driver-story` / `spec-driver-resume` 三个编排器 skill 的 `prompt_source` 逻辑不再探测 `.claude/commands/spec-driver.{phase}.md` 或 `.codex/commands/spec-driver.{phase}.md`，所有 phase prompt 统一从 `$PLUGIN_DIR/agents/{phase}.md` 加载。用户通过放置这些 override 文件定制 prompt 的能力被移除（v3.x 隐含机制），唯一定制路径为编辑 `plugins/spec-driver/agents/{phase}.md` 后重装插件。移除理由：删除原子命令后仍保留 fallback 会导致残留 override 文件 silently shadow 新流程（由 Codex adversarial review 识别）
- `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` — `claudeProjectOverrides.entries` 清空（9 条 → 0 条），`note` 改写为"Kept for directory structure only ... will be ignored by the runtime"，与上述 fallback 下线保持一致
- `contracts/runtime-boundary-contract.yaml` — `claude.requiredFiles` 移除 `.claude/commands/spec-driver.implement.md`
- `plugins/spec-driver/skills/spec-driver-{constitution,implement,resume,story}/SKILL.md` 与 `plugins/spec-driver/agents/constitution.md` — 所有 `/spec-driver.constitution` 引用改为 `/spec-driver:spec-driver-constitution`
- `plugins/spec-driver/scripts/codex-skills.sh` — 移除 `spec-driver-constitution` 的 source_command 特殊分支；`write_wrapper_source_contract` 中移除"Project overrides"说明行
- `.codex/skills/spec-driver-{constitution,implement,resume,story}/SKILL.md` — 通过 `npm run codex:spec-driver:install` 从更新后的 source SKILL 再生
- `README.md` — "Individual Phase Commands" 段替换为"Orchestrator Skill Commands"，列出 9 个编排器 skill 入口，段末指向迁移指南
- `plugins/spec-driver/README.md` — 修正 `/spec-driver.constitution` 提示为新格式；保留历史 speckit→spec-driver 映射表并为 9 个 `/spec-driver.{phase}` 行加标注"已于 v4.0 弃用"，表下补充 v4.0 变更说明
- `.specify/scripts/bash/check-prerequisites.sh` — 错误提示从 `/spec-driver.specify/plan/tasks` 改为 `/spec-driver:spec-driver-feature`（缺特性目录）与 `/spec-driver:spec-driver-resume`（特性目录已在、仅缺 plan/tasks）
- `plugins/spec-driver/scripts/lib/init-project-output.sh` — constitution 缺失提示改为 `/spec-driver:spec-driver-constitution`
- `plugins/spec-driver/templates/specify-base/{plan,tasks,checklist}-template.md` — 注释中对原子命令的具名引用改为中性描述（如"plan phase"、"tasks phase"、"checklist phase"）
- `tests/integration/runtime-boundary-contract.test.ts` — 移除对已删除合同条目的 `writeFileSync` setup
- `tests/integration/spec-driver-wrapper-source-truth.test.ts` — `cpSync('.claude/commands')` 改为 `mkdirSync`（空目录满足 entries=[] 合同）

### Added

- `docs/migrations/skill-deprecation.md` — 完整迁移指南：背景说明、9 条旧→新映射表、使用示例对比、如何确认旧命令消失、Codex 用户说明、自定义 override 清理建议、FAQ、相关合同变更
- `CHANGELOG.md` — 本文件

### Added — spectra（F5 Reading UX，Minor 功能新增）

- **轻量模式**：`spectra batch --mode=<full|reading|code-only>` — `reading` 模式跳过 5 个产品文档层 generator（ADR 推断、产品概述、故障排查、数据模型、质量评估），`code-only` 模式额外跳过 8 个架构推断层；冷启动目标 < 300s，热启动目标 < 60s（FR-001 ~ FR-008）
- **自然语言问答**：MCP `panoramic-query` 工具新增 `natural-language` operation — 支持 5 类典型问题（调用关系、调用路径、设计决策、技术债、流程归属），采用 Graph-first BFS + embedding 精排 + LLM 组装的 B+C 混合架构，100% Citation 覆盖（specPath + lineRange + excerpt 三字段），budget-gate record-only 模式不阻断问答（FR-009 ~ FR-017）
- **交互式图谱可视化**：`spectra batch --html` 在 `_meta/graph.html` 生成单文件离线交互图谱，包含力导向布局（< 2000 节点）、大图静态模式（≥ 2000 节点 + 横幅警告）、搜索/过滤、节点点击跳转 Spec 文件、Hyperedge 超边凸包可视化，零 CDN 引用（FR-018 ~ FR-024）
- `src/panoramic/qa/`：新增 8 个模块（graph-retriever、rag-reranker、debt-context、citation、prompt-builder、llm-caller、index、types）
- `plugins/spectra/skills/spectra/SKILL.md`、`plugins/spectra/skills/spectra-batch/SKILL.md`：更新 MCP 工具说明，记录 `natural-language` operation 和 `--mode` 参数

### 相关 Spec — F5 Reading UX

- `specs/132-reading-ux/`（spec.md / plan.md / tasks.md / perf-baseline.md / qa-coverage-report.md / risk-regression.md / browser-verification.md）

### 影响评估

- 用户手工调用 `/spec-driver.specify` 等旧命令将得到 "command not found"，需按迁移指南改为对应编排器入口
- 用户项目 `.claude/commands/` 下的自定义 `spec-driver.*.md` 覆盖文件**不会被自动清理**，建议参照迁移指南手动处理
- Codex 用户不受影响：`$spec-driver-*` 入口保持原状，所有功能通过编排器 Skill 继续提供
- Spectra 插件、仓库发布流程（`npm run repo:check` / `npm run release:sync`）、已有 spec/plan/tasks 制品均不受影响

### 相关 Spec

- `specs/129-fix-remove-atomic-skills/`（fix-report.md / plan.md / tasks.md / spec-review.md / quality-review.md / verification/verification-report.md）

### 后续 Release PR 待办

此 `[Unreleased]` 条目为 **major version bump** 预备（按 SemVer，删除公共命令是 BREAKING）。具体版本号（建议 spec-driver 4.0.0）与 `contracts/release-contract.yaml` 同步更新将在独立 release PR 中通过 `npm run release:sync` 执行。
