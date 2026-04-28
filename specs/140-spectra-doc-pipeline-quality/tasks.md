---
featureId: "140"
title: "Spectra v4.1.0 文档生产线质量重构 — 任务清单"
status: draft
createdAt: "2026-04-28"
totalTasks: 55
phases: 5
estimatedEffort: "22-30 人天"
---

# Feature 140 — 任务清单

> **权威参考**：spec.md（6 US / 15 FR）、research/01-feature-plan.md（规划）、research/02-mapreduce-architecture.md（架构）
> **实施策略**：Phase 0 → Phase 1（可并行各子任务）→ Phase 2 → Phase 3（3a → 3b → 3c 串行）→ Phase 4

---

## FR 覆盖映射表

| FR | 描述 | 任务 ID |
|----|------|---------|
| FR-001 | Cluster Orchestrator 基础设施 | T01-T09 |
| FR-002 | 聚类策略三级 fallback | T03, T07 |
| FR-003 | 删除全部 hardcoded ADR candidate 函数 | T33, T34 |
| FR-004 | ADR Map sonnet / Reduce 优先 opus | T35, T36 |
| FR-005 | ADR evidenceRef 自动真实性校验 | T37, T38, T39 |
| FR-006 | 旧 ADR 添加 supersede notice | T40, T41 |
| FR-007 | hyperedge design doc 来源扩展 | T27, T28 |
| FR-008 | narrative MapReduce + 3-pass critique | T29, T30, T31, T32 |
| FR-009 | 删除 narrative 模板填充路径 | T29 |
| FR-010 | --include-docs 数据流打通 | T21, T22, T23 |
| FR-011 | graph.html 始终生成 | T18, T19 |
| FR-012 | costBreakdown frontmatter 字段 | T15, T16, T17 |
| FR-013 | batch summary Top 5 token 消费模块 | T17 |
| FR-014 | telemetry hooks | T05, T08 |
| FR-015 | 测试 fixture 集 + CI 跨项目隔离测试 | T10, T11, T12, T13, T14, T46, T47 |

---

## Phase 0 — Cluster Orchestrator 基础设施（3-4 人天）

> 目标：交付稳定的 `cluster-orchestrator.ts`，作为 Phase 3 三个生成器的统一 MapReduce dispatch 层。Phase 3 全部阻塞于此 Phase 完成。

- [ ] T01: 创建 src/panoramic/cluster-orchestrator.ts — 接口类型定义
  - **影响文件**: `src/panoramic/cluster-orchestrator.ts`（新建）
  - **FR 关联**: FR-001, FR-014
  - **实施细节**: 导出 `ClusterDispatchOptions<TInput, TMapOutput, TReduceOutput>`、`ClusterDispatchResult<TReduceOutput>`、`CallTelemetry` 接口；导出 `clusterDispatch` 函数签名；使用 Zod 定义 `callTelemetrySchema`；字段严格按架构文档 §二 接口定义
  - **验收**: `npx tsc --noEmit` 零错误；接口含 `sharedHeader / map / reduce / onClusterPlanned / onMapStart / onMapComplete / onMapFailed / onReduceStart / onReduceComplete`；`ClusterDispatchResult.diagnostics` 含 `mergeConfidence: 'high' | 'medium' | 'low'`
  - **预估**: 0.5 人天

- [ ] T02: 实现 cluster-orchestrator.ts — Phase A 聚类策略
  - **前置任务**: T01
  - **影响文件**: `src/panoramic/cluster-orchestrator.ts`
  - **FR 关联**: FR-001, FR-002
  - **实施细节**: 实现三级 fallback chain：`community`（复用 `src/panoramic/community/` 的 Louvain 实现，minSize=3 / maxSize=15）→ `directory`（按文件目录 path.dirname 分组）→ `single`（整体 1 cluster）；每级捕获异常后降级；cluster 超过 maxSize=15 时**按 first-fit-decreasing 装箱算法拆分成多个子 cluster**（每个 ≤ 15 模块，零模块丢失），frontmatter 标 `clusterSplit: <N>`。**禁止用截断尾部静默丢弃模块**（Codex review finding 2）
  - **验收**: 单元测试（T07）mock Louvain 失败后正确降级 directory；mock directory 失败后降级 single；cluster 划分结果符合 minSize/maxSize 约束；超 maxSize=15 的输入拆分后所有源模块仍出现在某个子 cluster 中（Set 等价性断言）
  - **预估**: 1 人天

- [ ] T03: 实现 cluster-orchestrator.ts — Phase B Map 并发调度
  - **前置任务**: T02
  - **影响文件**: `src/panoramic/cluster-orchestrator.ts`
  - **FR 关联**: FR-001, FR-002
  - **实施细节**: 使用 `p-limit`（现有依赖）或等效 semaphore 实现 `maxConcurrency=4` 并发控制；每个 cluster 独立调用 `options.map.fn(cluster, sharedHeader)`；超时 `perCallTimeout=180s`（使用 `Promise.race` + `setTimeout`）；单个 cluster 失败 log + 继续；<50% 成功时 fail-closed（不写产物）
  - **验收**: 单元测试（T08）验证：并发度不超 4、单个失败继续、<50% 成功触发 fail-closed
  - **预估**: 0.5 人天

- [ ] T04: 实现 cluster-orchestrator.ts — Phase C Reduce + 重试
  - **前置任务**: T03
  - **影响文件**: `src/panoramic/cluster-orchestrator.ts`
  - **FR 关联**: FR-001
  - **实施细节**: 调用 `options.reduce.fn(mapOutputs, sharedHeader)`；超时 `timeout=300s`；失败重试 1 次；仍失败 → fail-closed，写 `_PIPELINE_FAILED.md`（沿用 Feature 135 格式）；Reduce 完成后计算 `mergeConfidence`（high：无冲突 + 无重试；medium：有冲突或重试 1 次成功；low：>30% map 失败或 borderline）
  - **验收**: 单元测试（T08）验证：Reduce 失败重试 1 次；仍失败时 `finalOutput` 为 null 且 diagnostics 正确
  - **预估**: 0.5 人天

- [ ] T05: 实现 cluster-orchestrator.ts — Telemetry hooks 集成
  - **前置任务**: T04
  - **影响文件**: `src/panoramic/cluster-orchestrator.ts`
  - **FR 关联**: FR-014
  - **实施细节**: 在正确时机调用所有 6 个 hooks：`onClusterPlanned(clusters)`（聚类完成后）、`onMapStart(idx, size)`（每 cluster 开始前）、`onMapComplete(idx, output, telemetry)`（每 cluster 成功后）、`onMapFailed(idx, error)`（每 cluster 失败后）、`onReduceStart(count)`、`onReduceComplete(output, telemetry)`；`CallTelemetry` 中 `durationMs` 用 `Date.now()` 差值，`inputTokens/outputTokens` 来自 LLM response usage 字段
  - **验收**: 单元测试（T09）断言各 hook 在正确时机被调用，调用次数与 cluster 数一致
  - **预估**: 0.5 人天

- [ ] T06: 实现 cluster-orchestrator.ts — token 预算装箱拆分（修复 Codex review finding 2）
  - **前置任务**: T02
  - **影响文件**: `src/panoramic/cluster-orchestrator.ts`
  - **FR 关联**: FR-001
  - **实施细节**: 每 cluster 在喂入 map.fn 前，估算 token 数（chars / 3.5 粗算）；shared header 始终完整包含且预留固定额度（默认 15k）；剩余预算 ≤ 85k；若 cluster 模块 token 总和超剩余预算 → **first-fit-decreasing 装箱算法**：(1) 按 module spec token 大小降序排序；(2) 顺序放入子 bin，每 bin 容量 = 剩余预算；(3) 不能放入现有 bin 时新建 bin。结果：原 cluster 拆成 N 个子 cluster，每个 ≤ 100k 总预算，**零模块丢失**。frontmatter 标 `clusterSplit: <N>`。**禁止截断**
  - **验收**: 单元测试构造超 100k token 的 cluster，断言：(1) 拆分后所有源模块仍出现在某个子 cluster 中（Set 等价性）；(2) 每个子 cluster 总 token ≤ 100k；(3) shared header 在每个子 cluster 中完整保留；(4) 不出现 clusterTruncated: true 字段
  - **预估**: 0.5 人天

- [ ] T07: 单元测试 — 聚类策略 fallback chain
  - **前置任务**: T02
  - **影响文件**: `src/panoramic/__tests__/cluster-orchestrator-clustering.test.ts`（新建）
  - **FR 关联**: FR-002
  - **实施细节**: 测试用例：(1) Louvain 成功 → community clusters；(2) Louvain 抛异常 → fallback directory；(3) directory 失败 → fallback single；(4) 输入 < minSize=3 → single；(5) cluster maxSize=15 超限时拆分成多个子 cluster（first-fit-decreasing），断言所有源模块仍存在于某个子 cluster 中（Set 等价性）
  - **验收**: `npx vitest run` 全 5 用例通过；覆盖 fallback chain 的所有分支；用例 5 显式断言无模块丢失
  - **预估**: 0.5 人天

- [ ] T08: 单元测试 — Map 并发调度 + Reduce 重试
  - **前置任务**: T03, T04
  - **影响文件**: `src/panoramic/__tests__/cluster-orchestrator-dispatch.test.ts`（新建）
  - **FR 关联**: FR-001, FR-002
  - **实施细节**: mock LLM client（不依赖真实 API）；测试用例：(1) 正常流程 3 cluster 并发 ≤4；(2) 1/3 cluster map 失败 → 继续；(3) <50% 成功 → fail-closed，无产物；(4) Reduce 失败 → 重试 1 次成功；(5) Reduce 重试仍失败 → fail-closed
  - **验收**: 全部测试通过；mock LLM 不依赖真实 API key
  - **预估**: 0.5 人天

- [ ] T09: 单元测试 — Telemetry hooks + mergeConfidence 计算
  - **前置任务**: T05
  - **影响文件**: `src/panoramic/__tests__/cluster-orchestrator-telemetry.test.ts`（新建）
  - **FR 关联**: FR-014
  - **实施细节**: 测试用例：(1) 所有 hook 在正确时机被调用（使用 jest.fn() / vi.fn()）；(2) mergeConfidence=high 条件（无冲突 + 无重试）；(3) mergeConfidence=medium 条件（重试 1 次成功）；(4) mergeConfidence=low 条件（>30% map 失败）；(5) diagnostics 字段聚合正确（totalTokens、durationMs）
  - **验收**: 全部测试通过；`npx vitest run --coverage` 报告 cluster-orchestrator.ts 行覆盖率 ≥90%
  - **预估**: 0.5 人天

---

## Phase 1 — 测试 Fixture + 可观测性 + graph.html（4-5 人天）

> 目标：建立测试基础设施（T10-T14），完成 context 可观测性（T15-T17），修复 graph.html 始终生成（T18-T20）。各子组可并行。
> **前置**: Phase 0 完成后可立即启动；T10-T14（fixture）/ T15-T17（observability）/ T18-T20（graph.html）三组相互独立。

### 1a — 测试 Fixture 集

- [ ] T10: 创建 fixture 目录结构 + micrograd / empty-project fixture
  - **影响文件**: `tests/fixtures/micrograd/`（新建）、`tests/fixtures/empty-project/`（新建）
  - **FR 关联**: FR-015
  - **实施细节**: micrograd fixture 含 4 个 Python 文件快照（engine.py / nn.py / __init__.py / README.md），snapshot 管理（不依赖网络）；empty-project 仅含 README.md（最小合法项目）；每个 fixture 目录含 `fixture-meta.json`（记录来源版本 / 文件数 / 语言）
  - **验收**: 目录结构存在；`fixture-meta.json` 合规；Vitest 可正确 resolve fixture 路径
  - **预估**: 0.5 人天

- [ ] T11: 创建 nanoGPT fixture
  - **影响文件**: `tests/fixtures/nanoGPT/`（新建）
  - **FR 关联**: FR-015
  - **实施细节**: 15 个 Python 文件快照（model.py / train.py / bench.py / data/ 下 4 文件等），确保模块间有真实 import 关系；snapshot 管理；fixture-meta.json 含 `modules: 15`
  - **验收**: 目录存在；bench.py 在 fixture 中真实存在（用于 FR-012 `--context-budget 5000` 测试断言）
  - **预估**: 0.5 人天

- [ ] T12: 创建 sindresorhus/ky fixture
  - **影响文件**: `tests/fixtures/ky/`（新建）
  - **FR 关联**: FR-015
  - **实施细节**: ~30 TypeScript 文件快照（仅 src/ 目录：core.ts / types.ts / utils.ts / index.ts 等），确保有清晰跨模块 import；fixture-meta.json 含 `language: 'typescript', modules: ~30`；提取时剔除 test/ 和 node_modules
  - **验收**: src/ 目录 TS 文件 ≥ 20；有跨模块 import 关系；Spectra 能对其执行 batch（无语法错误）
  - **预估**: 0.5 人天

- [ ] T13: 创建跨项目隔离集成测试文件
  - **影响文件**: `tests/integration/cross-project-isolation.test.ts`（新建）
  - **FR 关联**: FR-015
  - **实施细节**: 5 个断言套件：(1) ADR 标题集合 distinct 率 = 100%（各 fixture ADR 标题集合互不相交）；(2) module spec 含 ≥3 个项目特有 identifier；(3) narrative 含领域词（≥3 个接口表头抽象名）；(4) hyperedges ≥1（micrograd/nanoGPT/ky）；(5) evidence verified=true 占比 ≥90%；使用 mock LLM response fixture（不依赖真实 API）
  - **验收**: `npx vitest run tests/integration/cross-project-isolation.test.ts` 编译通过（初始状态可预期失败，Phase 4 集成完成后应全绿）
  - **预估**: 1 人天

- [ ] T14: 配置 CI workflow — 跨项目隔离测试
  - **影响文件**: `.github/workflows/fixture-isolation.yml`（新建）
  - **FR 关联**: FR-015
  - **实施细节**: workflow 触发条件：每 PR + push main；matrix strategy：4 个 fixture 并行 job；每 job 执行 `npx vitest run tests/integration/cross-project-isolation.test.ts --fixture <name>`；失败时 upload artifact（失败 fixture 产物）；整体失败信号：任一 fixture 的断言失败
  - **验收**: workflow YAML 语法合规（`gh workflow list` 可识别）；job 名称清晰（fixture-isolation / micrograd / nanoGPT / ky / empty）
  - **预估**: 0.5 人天

### 1b — Context 可观测性（US-006）

- [ ] T15: 修改 src/core/context-assembler.ts — token 计数与 costBreakdown 计算
  - **影响文件**: `src/core/context-assembler.ts`（修改）
  - **FR 关联**: FR-012
  - **实施细节**: 新增 `estimateTokens(text: string): number`（返回 `Math.ceil(text.length / 3.5)`）；在 assembleContext 执行过程中分段统计：`contextAssembly`（cross-module context）、`promptTemplate`（template tokens）、`sourceFile`（主文件 tokens）；返回值追加 `tokenBreakdown: { contextAssembly, promptTemplate, sourceFile }` 字段；超出 `contextBudget` 时按相关性顺序截断（本模块 import > 同目录 > 其他），并返回 `truncated: true`
  - **验收**: 单元测试（T16）通过；现有 context-assembler 相关测试零新增失败
  - **预估**: 0.5 人天

- [ ] T16: 单元测试 — context-assembler token 计数 + 截断
  - **前置任务**: T15
  - **影响文件**: `src/core/__tests__/context-assembler-token.test.ts`（新建）
  - **FR 关联**: FR-012
  - **实施细节**: 测试用例：(1) `estimateTokens` 粗算正确（chars/3.5）；(2) 默认 budget=100k 下 4 fixture 全 cluster 不触发截断；(3) `--context-budget 5000` 下超限 → `truncated=true`，实际 contextAssembly ≤10k；(4) 截断时保留 import 强相关模块，丢弃其他；(5) `tokenBreakdown` 各字段之和与总 token 数一致（允许 ±5%）
  - **验收**: 全部测试通过；mock 文件系统，不依赖真实项目
  - **预估**: 0.5 人天

- [ ] T17: 修改 module spec 写入逻辑 — frontmatter costBreakdown 字段 + batch summary Top 5
  - **影响文件**: `src/panoramic/pipelines/module-spec-writer.ts`（或等效文件，修改）、`src/batch/batch-orchestrator.ts`（修改）
  - **FR 关联**: FR-012, FR-013
  - **实施细节**: module spec frontmatter 新增字段（Zod schema 扩展）：`costBreakdown: { contextAssembly, promptTemplate, sourceFile, llmReasoning }` + `contextTruncated: boolean`；`llmReasoning` 来自 LLM response usage.outputTokens；batch 完成后在 batch-orchestrator 中聚合所有模块的 `contextAssembly`，按降序取 Top 5，打印到 stdout（格式："Top 5 input token 消费模块：\n  1. <moduleName>: <N> tokens\n..."）
  - **验收**: 4 fixture batch 后每个 module spec frontmatter 含合规 `costBreakdown`；stdout 含"Top 5 input token 消费模块"字符串；`npx vitest run` 零新增失败
  - **预估**: 1 人天

### 1c — graph.html 始终生成（US-005）

- [ ] T18: 修改 src/batch/batch-orchestrator.ts — 移除 graph.html 跳过条件
  - **影响文件**: `src/batch/batch-orchestrator.ts`（修改）
  - **FR 关联**: FR-011
  - **实施细节**: 找到当前 `exportGraphHtml` 调用处的复杂度阈值条件判断（通常形如 `if (graph.nodeCount > threshold)`）；移除跳过条件，改为无条件调用 `exportGraphHtml`；传入图节点数量用于 banner 判断
  - **验收**: `grep -n 'exportGraphHtml\|skipGraph\|complexity' src/batch/batch-orchestrator.ts` 确认无跳过分支
  - **预估**: 0.5 人天

- [ ] T19: 修改 graph HTML 生成器 — 极小图 banner
  - **影响文件**: `src/panoramic/export-graph-html.ts`（或等效文件，修改）
  - **FR 关联**: FR-011
  - **实施细节**: 在 HTML 模板中，当 `nodeCount < 3` 时在图容器顶部插入 banner div：`"This project has too few cross-module references for meaningful visualization. Run with --include-docs to add semantic context."`；banner 样式需清晰（建议 `background: #FFF3CD; border: 1px solid #FFC107; padding: 12px; margin: 8px;`）
  - **验收**: 集成测试（T20）断言 empty-project fixture 的 graph.html 含该 banner 字符串；且非极小图不含 banner
  - **预估**: 0.5 人天

- [ ] T20: 集成测试 — graph.html 始终生成
  - **前置任务**: T18, T19
  - **影响文件**: `tests/integration/graph-html-generation.test.ts`（新建）
  - **FR 关联**: FR-011
  - **实施细节**: 测试用例：(1) micrograd fixture（4 模块）→ `_meta/graph.html` 文件存在；(2) empty-project（0 模块）→ graph.html 存在 + 含 banner 字符串；(3) ky fixture（~30 模块）→ graph.html 存在 + 不含 banner；使用 mock batch 输出，不需要真实 LLM
  - **验收**: 全部测试通过；fixture 路径可解析
  - **预估**: 0.5 人天

---

## Phase 2 — --include-docs 路径打通（3-4 人天）

> 目标：消除 --include-docs 语义矛盾，打通数据流。依赖 Phase 1 fixture 可选（可并行但 fixture 先行有利）。

- [ ] T21: 修改 src/extraction/extraction-pipeline.ts — 返回 markdown 内容供下游消费
  - **影响文件**: `src/extraction/extraction-pipeline.ts`（修改）
  - **FR 关联**: FR-010
  - **实施细节**: `--include-docs=true` 时：(1) README.md → 单独提取全量内容，放入返回值 `extractionResult.readmeContent: string`（不截断，移除旧 5k 限制）；(2) 其他 .md → 提取为图节点（kind: doc），放入 `extractionResult.docNodes`；修改函数返回类型追加这两个字段；不改变 `--include-docs=false` 时的行为
  - **验收**: 单元测试（T23）通过；现有 extraction-pipeline 测试零新增失败；`grep -n '5000\|5k' src/extraction/extraction-pipeline.ts` 确认无旧 token 限制
  - **预估**: 0.5 人天

- [ ] T22: 修改 src/batch/batch-orchestrator.ts — 修复日志 + 传递 readmeContent
  - **前置任务**: T21
  - **影响文件**: `src/batch/batch-orchestrator.ts`（修改）
  - **FR 关联**: FR-010
  - **实施细节**: 找到"跳过 .md 文件（不支持）"日志输出位置，改为"include-docs: 已加入 N 份 .md 作为语义上下文"（N 来自 docNodes.length + (readmeContent ? 1 : 0)）；将 `readmeContent` 传递给 architecture-narrative pipeline 和 hyperedge extractor 调用链；不改变 `--include-docs=false` 时的代码路径
  - **验收**: `grep -n '跳过 .md\|skip.*md\|不支持' src/batch/batch-orchestrator.ts` 无命中；新日志格式包含"include-docs: 已加入"
  - **预估**: 0.5 人天

- [ ] T23: 单元测试 — --include-docs 数据流
  - **前置任务**: T21, T22
  - **影响文件**: `tests/unit/include-docs-pipeline.test.ts`（新建）
  - **FR 关联**: FR-010
  - **实施细节**: 测试用例：(1) `--include-docs=true` → `readmeContent` 非空、含 README 全量内容；(2) `--include-docs=true` → 日志含"include-docs: 已加入 N 份"、不含"跳过"；(3) `--include-docs=false` → `readmeContent` 为 undefined、日志无任何 .md 处理日志；(4) README 全量内容（>5k tokens）不被截断（检查字符串长度）；mock 文件系统，不需要真实项目
  - **验收**: 全部测试通过；覆盖开关前后两个代码路径
  - **预估**: 0.5 人天

- [ ] T24: 修改 src/panoramic/pipelines/architecture-narrative.ts — 消费 readmeContent
  - **前置任务**: T22
  - **影响文件**: `src/panoramic/pipelines/architecture-narrative.ts`（修改）
  - **FR 关联**: FR-010
  - **实施细节**: 函数签名新增可选参数 `readmeContent?: string`；当 `readmeContent` 存在时，将其作为 shared header 的一部分注入 Map prompt（放在 project-context.yaml 后、模块 inventory 前）；无 readmeContent 时行为不变（向后兼容）
  - **验收**: 单元测试验证 readmeContent 存在时出现在 map prompt 的 sharedHeader 中；不存在时 prompt 结构不变
  - **预估**: 0.5 人天

- [ ] T25: 集成测试 — --include-docs 开关前后对比
  - **前置任务**: T23, T24
  - **影响文件**: `tests/integration/include-docs-integration.test.ts`（新建）
  - **FR 关联**: FR-010
  - **实施细节**: 使用 ky fixture（含 README.md）；mock LLM client 记录调用的 prompt 内容；对比 `--include-docs=true` vs `false`：前者的 narrative map prompt 含 README 文本，后者不含；断言日志无"跳过"字样
  - **验收**: 测试通过；mock LLM 不依赖真实 API
  - **预估**: 0.5 人天

- [ ] T26: 修改 hyperedge extractor 调用 — 传入 readmeContent
  - **前置任务**: T22
  - **影响文件**: `src/panoramic/pipelines/hyperedge-pipeline.ts`（或等效调用位置，修改）
  - **FR 关联**: FR-007, FR-010
  - **实施细节**: hyperedge extractor 调用时，将 `readmeContent` 作为 design doc 来源之一（优先级最高，始终在 designDocAbsPaths 计算前注入）；`--include-docs=false` 时 README 仍通过 FR-007 的扩展路径包含（详见 T27）
  - **验收**: 单元测试（T28）断言 hyperedge Map prompt 中含 README 内容（`--include-docs=true` 时）
  - **预估**: 0.5 人天

---

## Phase 3 — MapReduce 应用到 3 个生成器（12-15 人天）

> 目标：将 Phase 0 的 orchestrator 应用到 hyperedges（3a）→ narrative（3b）→ ADR（3c）三个生成器。
> **前置**: Phase 0（T01-T09）全部完成；Phase 2（T21-T26）完成后可启动 3a/3b；3c 建议在 3a/3b 完成后启动。

### Phase 3a — Hyperedges 接 Orchestrator（US-002，2-3 人天）

- [ ] T27: 修改 src/batch/batch-orchestrator.ts — 扩展 designDocAbsPaths 计算逻辑
  - **前置任务**: T02（Phase 0 完成）
  - **影响文件**: `src/batch/batch-orchestrator.ts`（修改）
  - **FR 关联**: FR-007
  - **实施细节**: 找到 `designDocAbsPaths` 计算位置（研究文档 §二 提及 line 1041-1060）；按优先级合并：(1) 根目录 README.md（始终包含，用 fs.existsSync 检查）；(2) `docs/**/*.md`（仅 `--include-docs=true` 时，使用 glob）；(3) `specs/modules/*.spec.md`（当前 batch 产物，每次 batch 后存在）；(4) `.specify/project-context.{yaml,md}`；结果去重 + 过滤不存在文件
  - **验收**: 单元测试（T28）mock 文件系统断言各来源按优先级合并；新项目（仅 README）的 `designDocAbsPaths.length >= 1`
  - **预估**: 0.5 人天

- [ ] T28: 单元测试 — designDocAbsPaths 扩展逻辑
  - **前置任务**: T27
  - **影响文件**: `tests/unit/design-doc-paths.test.ts`（新建）
  - **FR 关联**: FR-007
  - **实施细节**: 测试用例：(1) 仅 README → paths length=1；(2) README + docs/ → length>1（--include-docs=true）；(3) README + module specs → length>1；(4) project-context.yaml 存在时加入；(5) 文件不存在时被过滤；所有用例 mock fs，不读真实文件系统
  - **验收**: 全部测试通过
  - **预估**: 0.5 人天

- [ ] T29: 修改 hyperedge pipeline — 接入 cluster orchestrator
  - **前置任务**: T27, T05（telemetry hooks）
  - **影响文件**: `src/panoramic/pipelines/hyperedge-pipeline.ts`（修改）
  - **FR 关联**: FR-007
  - **实施细节**: 将 design doc 列表按 token 预算分组（每组 ≤50k tokens）；调用 `clusterDispatch`，`clusterStrategy: { kind: 'single' }`（hyperedge 每 design doc 独立，天然分组）；Map fn：对每组 design doc 调用现有 hyperedge LLM 提取逻辑；Reduce fn：单次去重合并（by node-set 相似度，sonnet 即可）；注册 telemetry hooks 用于日志
  - **验收**: 集成测试（T30）在 3 个非空 fixture 上断言 `graph.json.hyperedges.length >= 1`
  - **预估**: 1 人天

- [ ] T30: 集成测试 — hyperedge 新项目首次 batch
  - **前置任务**: T29
  - **影响文件**: `tests/integration/hyperedge-first-run.test.ts`（新建）
  - **FR 关联**: FR-007
  - **实施细节**: 使用 micrograd / nanoGPT / ky fixture；mock LLM response（固定返回含 hyperedge 的 Zod-valid JSON）；断言：(1) `graph.json.hyperedges.length >= 1`（3 个 fixture 各自独立）；(2) empty-project fixture → hyperedges = []（无内容可提取）；(3) `--include-docs=true` 时 ky fixture hyperedges 更多（含 README 内容）
  - **验收**: 全部断言通过；mock LLM
  - **预估**: 1 人天

### Phase 3b — architecture-narrative MapReduce + 3-pass（US-003，4-5 人天）

- [ ] T31: 删除 narrative 旧模板填充路径
  - **前置任务**: T02（Phase 0 完成）
  - **影响文件**: `src/panoramic/pipelines/architecture-narrative.ts`（修改）
  - **FR 关联**: FR-009
  - **实施细节**: 找到"项目子域目录"6 行占位表格生成代码和 file-system 元数据 template-fill 路径；整段删除；确保删除后编译无错（依赖项一并清理）；不删除 `architecture-narrative.hbs` 模板（render 层保留）
  - **验收**: `grep -rn '项目子域目录\|subDomain.*table\|templateFill' src/panoramic/pipelines/architecture-narrative.ts` 无命中；`npx tsc --noEmit` 零错误
  - **预估**: 0.5 人天

- [ ] T32: 实现 narrative pipeline Phase A+B — Map 阶段（cluster mini-narrative）
  - **前置任务**: T31, T24（readmeContent 注入）
  - **影响文件**: `src/panoramic/pipelines/architecture-narrative.ts`（修改）
  - **FR 关联**: FR-008
  - **实施细节**: Phase A：复用 ADR cluster 划分（通过参数传入，避免重新聚类）；Phase B Map fn：每 cluster 输入 = cluster module specs 意图段 + shared header（README + project-context + 全模块 inventory）；输出 Zod schema：`{ clusterNarrative: string, keyAbstractions: string[] }`；model: sonnet；通过 `clusterDispatch` 调用
  - **验收**: 单元测试（T35）mock LLM 断言 Map fn 被调用 K 次（K = cluster 数），输出 Zod schema 合规
  - **预估**: 1 人天

- [ ] T33: 实现 narrative pipeline Phase C+D+E — Reduce + Critique + Refine
  - **前置任务**: T32
  - **影响文件**: `src/panoramic/pipelines/architecture-narrative.ts`（修改）
  - **FR 关联**: FR-008
  - **实施细节**: Phase C Reduce fn：合并 K 个 cluster mini-narratives 为 4-6 段 narrative；model: sonnet；Phase D Critique：独立 LLM 调用（sonnet），输入 draft + module specs，输出 `{ passed: boolean, issues: string[] }`；Phase E Refine：仅 Phase D passed=false 时执行；输入 draft + issues；model: sonnet；最多 1 次；仍 fail → `confidence: low`；最终产物 frontmatter 含 `critiqueResult: { passed, issues }`（即使 passed=true 也保留摘要）
  - **验收**: 单元测试（T35）通过；mock Critique 返回 fail 时断言 Refine 被触发且最多 1 次
  - **预估**: 1.5 人天

- [ ] T34: 实现 narrative pipeline Phase F — 程序化 domain-words 校验
  - **前置任务**: T33
  - **影响文件**: `src/panoramic/pipelines/architecture-narrative.ts`（修改）
  - **FR 关联**: FR-008
  - **实施细节**: 从所有 module spec 的接口表头提取核心抽象名（用正则匹配 `## Interface` / `## API` 段落后的函数/类/接口名）；校验 narrative 中是否出现 ≥3 个；不达标 → 强制走 Phase E Refine（即使 Phase D passed=true）；Refine 后仍不达标 → fail-closed（不写盘 narrative，写 `_PIPELINE_FAILED.md`）；记录实际命中的抽象名到 frontmatter `domainWordsFound: string[]`
  - **验收**: 单元测试（T35）验证：抽象名提取正则命中 ≥3 个时通过；<3 个时触发 Refine；Refine 后仍 <3 个则 fail-closed 不写文件
  - **预估**: 0.5 人天

- [ ] T35: 单元测试 — narrative 3-pass pipeline
  - **前置任务**: T32, T33, T34
  - **影响文件**: `src/panoramic/__tests__/narrative-pipeline.test.ts`（新建）
  - **FR 关联**: FR-008, FR-009
  - **实施细节**: 测试用例：(1) 正常流程：Map → Reduce → Critique(passed=true) → 程序化校验通过 → 写盘；(2) Critique fail → Refine 触发 → 最多 1 次；(3) 程序化 domain-words < 3 → 强制 Refine；(4) Refine 后仍 < 3 → fail-closed；(5) 产物 frontmatter 含 `critiqueResult + domainWordsFound`；(6) narrative 不含"项目子域目录"字样（snapshot 测试）；mock LLM
  - **验收**: 全部测试通过；mock LLM 不依赖真实 API
  - **预估**: 1 人天

- [ ] T36: 集成测试 — narrative 4 fixture 领域词验证
  - **前置任务**: T35
  - **影响文件**: `tests/integration/narrative-domain-words.test.ts`（新建）
  - **FR 关联**: FR-008, FR-009
  - **实施细节**: 对 4 fixture 分别 mock LLM 返回真实风格 narrative（包含各项目特有抽象名）；断言：(1) narrative 含 ≥3 个该项目特有技术术语；(2) 不含"项目子域目录，覆盖 N 个模块"字样；(3) 长度在 4-6 段；(4) frontmatter 含 critiqueResult；(5) 4 fixture narrative 的模板句不重复（各自唯一）
  - **验收**: 全部断言通过
  - **预估**: 0.5 人天

### Phase 3c — ADR MapReduce + Evidence Verification（US-001，5-7 人天）

> 注意：Phase 3a 启动前执行"决策点 3"grep 检查：`grep -rn 'buildStreamJsonProtocol\|hardcoded candidate\|adr.*template' src/` 确认无 downstream 依赖。

- [ ] T37: 删除 ADR hardcoded candidate 函数
  - **前置任务**: T02（Phase 0 完成）
  - **影响文件**: `src/panoramic/pipelines/adr-decision-pipeline.ts`（修改）
  - **FR 关联**: FR-003
  - **实施细节**: 删除全部 8 个 hardcoded candidate 函数（含 `buildStreamJsonProtocolCandidate` 等）和基于关键词匹配的候选触发逻辑；保留 `buildAdrCandidates` 函数名作为唯一入口，内部改为调用 `clusterDispatch`；保留 `adr-draft.hbs` / `adr-index.hbs` 模板（render 层不变）
  - **验收**: `grep -n 'buildStreamJsonProtocol\|hardcoded\|keyword.*match' src/panoramic/pipelines/adr-decision-pipeline.ts` 无命中；`npx tsc --noEmit` 零错误
  - **预估**: 0.5 人天

- [ ] T38: 实现 ADR Map 阶段 prompt + Zod schema
  - **前置任务**: T37
  - **影响文件**: `src/panoramic/pipelines/adr-decision-pipeline.ts`（修改）、`src/panoramic/schemas/adr-candidate.schema.ts`（新建）
  - **FR 关联**: FR-003, FR-004
  - **实施细节**: 定义 `ADRCandidate` Zod schema（candidateId / title / summary / decision / context / consequences / evidenceRefs[{file, lines, snippet}] / sourceClusterId / confidence: 0-1）；Map fn：每 cluster 输入 = cluster module specs + shared header（README + project-context + 全模块 inventory）；model: sonnet；prompt 要求 LLM 发现 ≥2 条 evidenceRefs、不同文件；输出严格 validate 为 `ADRCandidate[]`
  - **验收**: `adr-candidate.schema.ts` 编译通过；单元测试（T42）验证 Map 调用使用 sonnet
  - **预估**: 1 人天

- [ ] T39: 实现 ADR Reduce 阶段 prompt + mergedByModel 字段
  - **前置任务**: T38
  - **影响文件**: `src/panoramic/pipelines/adr-decision-pipeline.ts`（修改）
  - **FR 关联**: FR-004
  - **实施细节**: Reduce fn：输入 = 所有 cluster candidates（Zod-serialized）+ shared header；model: opus（优先）/ sonnet（降级时记 `confidence: medium`）；prompt 任务：语义去重 / 跨 cluster candidate 合并 evidenceRefs / 排除 <2 evidenceRefs 的 candidate；输出写入 frontmatter `generatedByModel: { map: <modelId>, reduce: <modelId> }`；opus 降级时 log warning
  - **验收**: 单元测试（T42）断言 Map 调用 sonnet、Reduce 调用 opus；frontmatter `generatedByModel` 字段结构正确
  - **预估**: 1 人天

- [ ] T40: 实现 evidenceRef 自动真实性校验
  - **前置任务**: T39
  - **影响文件**: `src/panoramic/pipelines/adr-evidence-verifier.ts`（新建）
  - **FR 关联**: FR-005
  - **实施细节**: 导出 `verifyEvidenceRefs(evidenceRefs: EvidenceRef[], projectRoot: string): VerifiedEvidenceRef[]`；对每条 evidenceRef 程序化校验：(1) `source` 文件存在（`fs.existsSync`）；(2) `location` 行号范围有效（解析 "L42-58" 格式，检查文件行数）；(3) `snippet` 与文件实际内容字符匹配（允许 ≤10% 空白差异：normalize whitespace 后 Levenshtein 距离 / snippet.length ≤ 0.1）；返回每条追加 `verified: boolean`；validation gate：有效 evidenceRefs（verified=true）< 2 条的 ADR 从产物中移除
  - **验收**: 单元测试（T41）通过；纯程序化，无 LLM 依赖
  - **预估**: 1 人天

- [ ] T41: 单元测试 — evidenceRef 真实性校验
  - **前置任务**: T40
  - **影响文件**: `src/panoramic/__tests__/adr-evidence-verifier.test.ts`（新建）
  - **FR 关联**: FR-005
  - **实施细节**: 测试用例：(1) 文件不存在 → `verified: false`；(2) 行号越界（>文件总行数）→ `verified: false`；(3) snippet 精确匹配 → `verified: true`；(4) snippet 空白差 ≤10% → `verified: true`；(5) snippet 差 >10% → `verified: false`；(6) 0 条 verified=true → ADR 被丢弃；(7) ≥2 条 verified=true → ADR 保留；mock 文件系统
  - **验收**: 全部测试通过；无 LLM 依赖
  - **预估**: 0.5 人天

- [ ] T42: 单元测试 — ADR MapReduce dispatch
  - **前置任务**: T38, T39, T41
  - **影响文件**: `src/panoramic/__tests__/adr-pipeline-mapreduce.test.ts`（新建）
  - **FR 关联**: FR-003, FR-004, FR-005
  - **实施细节**: 测试用例：(1) Map 调用 sonnet、Reduce 调用 opus；(2) Map 输出每 candidate ≥2 evidenceRefs；(3) Reduce 合并跨 cluster candidates；(4) evidenceRef 校验 gate：verified <2 的 ADR 不进入最终产物；(5) empty-project → ADR 列表为空（fail-closed）；mock LLM + mock fs
  - **验收**: 全部测试通过；mock LLM 不依赖真实 API
  - **预估**: 0.5 人天

- [ ] T43: 实现 FR-006 — 旧 ADR supersede notice（修复 Codex review finding 1）
  - **前置任务**: T37（删除 hardcoded 函数后才需处理旧 ADR）
  - **影响文件**: `src/panoramic/pipelines/adr-migration.ts`（新建）、`src/batch/batch-orchestrator.ts`（修改）
  - **FR 关联**: FR-006
  - **实施细节**: 新建 `adr-migration.ts`，导出 `migrateOldAdrs(adrDir: string, currentBatchAdrPaths: Set<string>): void`。**legacy 判定谓词必须用 AND，且排除当前批次产物**：旧 ADR = `frontmatter.generatedByModel` 字段缺失 **AND** `frontmatter.status !== 'superseded'` **AND** 文件路径**不在** `currentBatchAdrPaths` 集合内。(1) 满足全部条件 → frontmatter `status` 改为 `superseded` + 追加 `supersededAt: "4.1.0"`；(2) 不删除文件；(3) 在 batch-orchestrator 的 ADR 生成完成后、传入新批次 ADR 路径集合调用 `migrateOldAdrs`。**禁止用 OR 连接谓词**（OR 会让新生成的 proposed/accepted 状态 ADR 被误判为旧 ADR 立即 supersede 自己，是 Codex review 已识别的高危逻辑 bug）
  - **验收**: 集成测试（T44）断言旧 ADR 被 supersede 且新生成 ADR **不被 supersede**
  - **预估**: 1 人天

- [ ] T44: 集成测试 — 旧 ADR supersede + 新 ADR 生成（含 anti-regression assertion）
  - **前置任务**: T43
  - **影响文件**: `tests/integration/adr-supersede.test.ts`（新建）
  - **FR 关联**: FR-006
  - **实施细节**: 准备含旧格式 ADR 的 fixture（模拟 v4.0.x 产出，无 generatedByModel 字段）；执行 mock batch；断言：(1) 旧 ADR 文件仍存在且 status=superseded；(2) 新 ADR 含 generatedByModel 字段；(3) **关键 anti-regression**：新生成 ADR 在 migrate 后 frontmatter.status **保持 proposed/accepted**，绝不能被改成 superseded（防止 Codex review 已识别的谓词逻辑 bug 复现）；(4) 旧 ADR 文件路径不在 currentBatchAdrPaths 时才被处理
  - **验收**: 全部断言通过；特别是 anti-regression 断言（新 ADR 不被 supersede）
  - **预估**: 0.5 人天

- [ ] T45: 集成测试 — ADR 4 fixture 跨项目 distinct 率
  - **前置任务**: T42, T41
  - **影响文件**: `tests/integration/adr-cross-fixture.test.ts`（新建）
  - **FR 关联**: FR-003, FR-005, FR-015
  - **实施细节**: 对 4 fixture 分别 mock LLM 返回各项目特有 ADR candidate（标题与各项目技术术语绑定）；mock fs 返回真实文件内容用于 evidence 校验；断言：(1) 各 fixture ADR 标题集合互不相交（distinct 率 = 100%）；(2) 所有 ADR verified=true 的 evidenceRefs 占比 ≥90%；(3) frontmatter generatedByModel 字段存在；(4) empty-project fixture → ADR 为空
  - **验收**: 全部断言通过
  - **预估**: 0.5 人天

---

## Phase 4 — 集成验收 + Release（1-2 人天）

> 目标：全量验收、版本发布。**前置**: Phase 0-3 全部完成。

- [ ] T46: 全量跑 4 fixture DoD 验收脚本
  - **前置任务**: T29, T35, T44（Phase 3 全部完成）
  - **影响文件**: `scripts/validate-feature-140-dod.ts`（新建）
  - **FR 关联**: FR-001 到 FR-015 全部
  - **实施细节**: 脚本依次验证 DoD 11 条：(1) ADR distinct 率 = 100%；(2) hyperedges ≥1；(3) narrative 含领域词；(4) 无"跳过"日志；(5) graph.html 存在；(6) costBreakdown frontmatter；(7) Top 5 输出；(8) 回归测试零失败；(9) cluster orchestrator 覆盖率 ≥90%；(10) 100 文件 batch < 10min；(11) 跨 cluster 决策捕获；输出 pass/fail 表格
  - **验收**: 脚本可执行（`npx ts-node scripts/validate-feature-140-dod.ts`）；前 9 条可自动验证；10-11 条需手动记录
  - **预估**: 0.5 人天

- [ ] T47: 跨项目隔离测试全绿确认
  - **前置任务**: T13, T14（CI workflow + 测试文件）
  - **影响文件**: `.github/workflows/fixture-isolation.yml`（确认）
  - **FR 关联**: FR-015
  - **实施细节**: 在本地 `npx vitest run tests/integration/cross-project-isolation.test.ts` 全绿；确认 CI workflow 触发 + 全部 4 fixture job 通过；手动模拟 ADR 标题重复场景确认 CI 报错
  - **验收**: CI 日志显示 4 fixture 全部通过；故意注入重复标题时 CI 报错
  - **预估**: 0.5 人天

- [ ] T48: 回归测试 — 现有 2232 测试零新增失败
  - **前置任务**: 所有 Phase 0-3 任务完成
  - **影响文件**: 无新文件（执行现有测试套件）
  - **FR 关联**: NFR-003
  - **实施细节**: 执行 `npx vitest run`；对比 baseline（2232 测试）；识别并记录新增失败（与 pre-existing 失败区分）；如有新增失败：定位根因、修复或标注为 known issue；pre-existing 2 个版本号失败明确标注在 KNOWN_ISSUES.md
  - **验收**: `npx vitest run` 输出零新增失败；pre-existing 失败已标注
  - **预估**: 0.5 人天

- [ ] T49: 更新 CHANGELOG.md — v4.1.0 条目
  - **前置任务**: T48
  - **影响文件**: `CHANGELOG.md`（修改）
  - **FR 关联**: 无（文档任务）
  - **实施细节**: 新增 v4.1.0 段落，包含：(1) Breaking Changes：ADR 格式变更（hardcoded candidates 移除）；(2) Features：6 大子能力各一条；(3) Performance：MapReduce 耗时说明（中等规模项目 batch +60-120s，换取大项目不崩）；(4) 已知限制：opus quota 影响 ADR Reduce 质量；格式严格按现有 CHANGELOG 风格
  - **验收**: CHANGELOG.md 头部为 v4.1.0；条目包含 6 大功能点；含耗时增加说明
  - **预估**: 0.5 人天

- [ ] T50: 更新 release contract + 执行 release:sync
  - **前置任务**: T49
  - **影响文件**: `contracts/release-contract.yaml`（修改）
  - **FR 关联**: 无（发布任务）
  - **实施细节**: 更新 `version: "4.1.0"`；更新 `releaseDate`；更新 marketplace entry 描述（6 大改进）；执行 `npm run release:sync` 同步到 plugin.json / marketplace.json；执行 `npm run release:check` 零错误；执行 `npm run repo:check` 零错误
  - **验收**: `npm run release:check` + `npm run repo:check` 零错误；plugin.json version=4.1.0
  - **预估**: 0.25 人天

- [ ] T51: 在 3 个 fresh 项目上手动验证无 hallucination
  - **前置任务**: T45, T46
  - **影响文件**: 无新文件（手动验证）
  - **FR 关联**: FR-003, FR-005, DoD-11
  - **实施细节**: 选 3 个与 fixture 不同的真实开源项目（建议：fastify / zod / vite 各选 src/ 子目录）；手动执行 `spectra batch --mode full`；验证：(1) ADR 标题引用该项目真实代码概念；(2) evidenceRefs source 文件实际存在于项目；(3) narrative 含项目特有术语；(4) 在 nanoGPT 上验证 ≥1 条 ADR 同时引用 ≥2 个不同 cluster 的 evidence；记录验证结果到 `specs/140-spectra-doc-pipeline-quality/manual-validation-log.md`
  - **验收**: 手动验证日志存在；3 个项目均无 hallucination ADR；nanoGPT 跨 cluster 决策捕获验证通过（DoD-11）
  - **预估**: 0.5 人天

- [ ] T52: 打 v4.1.0 git tag
  - **前置任务**: T50, T51
  - **影响文件**: 无（git 操作）
  - **FR 关联**: 无
  - **实施细节**: 确认 master 分支干净；`git tag -a v4.1.0 -m "Spectra v4.1.0 — 文档生产线质量重构"`；`git push origin v4.1.0`（需用户明确授权）
  - **验收**: `git tag -l v4.1.0` 命中；GitHub releases 页面可见该 tag
  - **预估**: 0.1 人天

---

## 补充任务 — 跨 Phase 保障

- [ ] T53: TypeScript 类型检查守护 — 全量 tsc 零错误
  - **影响文件**: 无新文件（CI 检查任务）
  - **FR 关联**: NFR-003
  - **实施细节**: 在 `.github/workflows/` 中确认已有（或新增）`npm run build`（含 `tsc --noEmit`）的 CI step；确保 Phase 0-3 所有新文件引入后无类型错误；特别关注 `ClusterDispatchOptions` 泛型的传播是否正确
  - **验收**: CI `npm run build` 步骤绿色；`npx tsc --noEmit` 本地零错误
  - **预估**: 持续（每个 Phase 完成后检查）

- [ ] T54: 100 文件合成 fixture 可扩展性测试
  - **前置任务**: T29, T35（Phase 3a/3b 完成后）
  - **影响文件**: `tests/fixtures/synthetic-100/`（新建）
  - **FR 关联**: NFR-001, DoD-10
  - **实施细节**: 生成 100 个合成 module spec 文件（脚本生成，每个 ~200 行，含跨模块 import 关系）；执行 `spectra batch --mode full`（mock LLM，固定响应时间 200ms 模拟真实延迟）；计时断言 < 10min（600s）；记录 cluster 数符合预期（~10-20 个）
  - **验收**: batch 在 mock LLM 下完成时间 < 10min；cluster 数合理
  - **预估**: 0.5 人天

- [ ] T55: 更新 Spectra 用户文档 — batch 耗时说明 + --context-budget 用法
  - **前置任务**: T50
  - **影响文件**: `docs/spectra-batch-guide.md`（修改，或等效用户文档文件）
  - **FR 关联**: NFR-001
  - **实施细节**: 新增章节"v4.1.0 性能说明"：(1) MapReduce 架构带来的耗时变化（中等项目 +60-120s）；(2) `--context-budget <N>` 用法（使用 200k context 模型时设 `--context-budget 150000`）；(3) ADR 生成变化（从模板改为证据驱动，可能 0 ADR 是正常结果）；语言中文，技术术语英文
  - **验收**: 文档中存在"v4.1.0"章节；含 `--context-budget` 示例命令；含 batch 耗时说明
  - **预估**: 0.25 人天

---

## 依赖与并行策略

```
Phase 0（T01-T09，串行）
  └──> Phase 1（T10-T20，3 组并行）
       ├── 1a: T10-T14（fixture 集）
       ├── 1b: T15-T17（observability）
       └── 1c: T18-T20（graph.html）
  └──> Phase 2（T21-T26，部分串行）
       T21 → T22 → T23（串行）
       T24、T26 依赖 T22（可并行）
       T25 依赖 T23+T24
  └──> Phase 3（T27-T45，跨组串行）
       3a: T27 → T28 → T29 → T30（串行）
       3b: T31 → T32 → T33 → T34 → T35 → T36（串行）
       3c: T37 → T38 → T39 → T40 → T41 → T42 → T43 → T44 → T45（串行）
       3a 最简单先做，3b 可与 3a 完成后立即并行启动 3c
  └──> Phase 4（T46-T55，大部分串行）
       T46-T48（并行验证）→ T49 → T50 → T51 → T52
       T53（持续守护，贯穿全程）
       T54（3a/3b 完成后可提前执行）
       T55（T50 后执行）
```

**推荐策略**：Phase 0 完成后立即启动 Phase 1 全部 3 组 + Phase 2；Phase 3 按 3a → 3b → 3c 串行（每个用作 orchestrator 的真实场景验证）；Phase 4 在 Phase 3c 完成后执行。

---

*总计 55 个任务，按 5 Phase 分组（Phase 0 / 1 / 2 / 3 / 4），覆盖 15 FR 和 5 NFR。*
