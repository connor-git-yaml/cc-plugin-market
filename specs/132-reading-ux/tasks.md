---
feature: F5 Reading UX
branch: 132-reading-ux
phase: tasks
created: 2026-04-20
total_tasks: 54
commit_points: 6
---

# F5 Reading UX Tasks

## 执行说明

- 按 T-NNN 编号顺序执行，除非标注 `[P]` 允许并行
- `[P]` = 与前一个 task 无依赖关系，可并行执行
- `[S]` = 必须串行，有依赖
- 每 Step 结尾有 commit task（标注 `[COMMIT]`），commit 后 push
- 遇阻时在 task 内注明 `BLOCKED：<原因>`，不默默跳过
- 估时标注：`XS` < 30 分钟、`S` 30-60 分钟、`M` 1-2 小时、`L` 2-4 小时、`XL` > 4 小时

---

## Step 0 — Plan 层未解决问题确认（前置，不独立 commit）

**目的**：在写任何实现代码前，先确认 plan §11 遗留的 5 个代码现实问题，将结论追加到 plan.md 的 "Codebase Reality Check" 小节（§5 已有部分结论，继续补充）。这些 task 全部可并行。

---

### T-001 [P]：确认 graph.html 生成入口（CLI 结构）

- **Step**: Step 0
- **估时**: S
- **Input**: `src/cli/` 目录结构（全量阅读）
- **Output**: 确认 `--mode=` flag 注册在哪个 Command 下；`--html` flag 是复用 `batch` 子命令还是独立 `graph render` 子命令；将结论追加到 `specs/132-reading-ux/plan.md` §11.5 或新增 Codebase Reality Check 小节
- **Test**: 无（纯代码阅读）
- **Exit Criteria**: plan.md 中有 CLI 入口的明确描述，包括具体文件路径和 Commander.js 注册方式
- **Commit Point**: 否

---

### T-002 [P]：确认 `node.specPath` + `hyperedges` 字段来源和传递路径

- **Step**: Step 0
- **估时**: S
- **Input**: `src/panoramic/graph/` 中 `GraphNode` 类型定义；`buildKnowledgeGraph()` 的输出结构；`graph.json` 示例；`src/panoramic/exporters/html-template.ts` 的 `buildHtmlTemplate()` 现有签名
- **Output**: 同时确认两件事：
  - **(a) `node.specPath`**：`GraphNode` 是否已有 `specPath` 字段；若无，确认需在哪里补充（`buildKnowledgeGraph()` 还是图谱写盘层）
  - **(b) `hyperedges` 传入路径**：`graph.hyperedges[]` 是否已从 `buildKnowledgeGraph()` 经 batch-orchestrator 传入 `buildHtmlTemplate()`；若否，记录需在 `buildHtmlTemplate()` 调用方（batch-orchestrator 阶段 7 知识图谱写盘）补充传入的具体位置
  - 结论追加到 `specs/132-reading-ux/codebase-notes.md`（专用文件，避免修改 plan.md 正文）
- **Test**: 无（纯代码阅读）
- **Exit Criteria**: codebase-notes.md 中有 (a) 和 (b) 两项的明确结论；若任一项需修改 plan §2 "修改模块表" 或需在 T-033 之前新增补充 task，在此处提出
- **Commit Point**: 否
- **关联 F-002 修复**：合并 T-033 跨关注点到此处前置确认，使 T-033 专注 HTML 侧实现

---

### T-003 [P]：确认 community 预计算坐标字段

- **Step**: Step 0
- **估时**: S
- **Input**: `graph.json` 的实际数据结构；Louvain 聚类结果的输出格式；`src/panoramic/graph/` 相关代码
- **Output**: 确认 `graph.json` 的 `communities[]` 数组中是否已含 `center` 字段（含 `x`, `y` 坐标）；若无，记录需在图谱构建阶段补充的字段
- **Test**: 无（纯代码阅读）
- **Exit Criteria**: plan.md 中有社区 center 坐标的来源说明，大图模式实现路径明确
- **Commit Point**: 否

---

### T-004 [P]：确认 embedding provider 实际用法和 mock 策略

- **Step**: Step 0
- **估时**: XS
- **Input**: `src/panoramic/anchoring/providers/factory.ts`；`LocalEmbeddingProvider` 实现；`@huggingface/transformers` 的实际导入方式
- **Output**: 确认 `createEmbeddingProvider()` 的导出签名；确认单测 mock 策略（jest.mock 路径、需要 mock 的方法）；将结论追加到 plan.md
- **Test**: 无（纯代码阅读）
- **Exit Criteria**: plan.md 中有 embedding provider mock 策略的明确描述
- **Commit Point**: 否

---

### T-005 [P]：确认 `batch-orchestrator.ts` 三个注入点的精确行号

- **Step**: Step 0
- **估时**: XS
- **Input**: `src/batch/batch-orchestrator.ts`（重点阅读 `runBatch()` 函数，关注 plan §5.1 描述的约第 617、869、934 行三处注入点）
- **Output**: 确认三处注入点的实际行号和上下文代码片段；更新 plan.md §5.1 的精确行号
- **Test**: 无（纯代码阅读）
- **Exit Criteria**: plan.md 中三处注入点的行号与实际代码一致（或标注"行号已确认/需调整"）
- **Commit Point**: 否

---

## Step 1 — 轻量模式（Story 1：FR-001 ~ FR-008）

**目标**：交付 `--mode=reading/code-only` 能力，CLI 和 MCP 两个入口均可用，batch pipeline 按 mode 正确跳过 generator。

**独立测试**：对 graphify 示例项目执行 `batch --mode=reading`，观察输出文件清单（不含 `product-overview.md`、`adrs/`）和日志中的 mode 提示，不依赖 Story 2/3。

---

### T-006 [S]：在 `qa/types.ts` 中定义 `BatchMode` 类型

- **Step**: Step 1
- **估时**: XS
- **Input**: plan §3 接口契约（`BatchMode` 类型定义）；T-001 ~ T-005 结论
- **Output**: `src/panoramic/qa/types.ts` 新增 `BatchMode` 导出（含所有 F5 核心类型定义）
- **Test**: TypeScript 编译通过（`npm run build` 无类型错误）
- **Exit Criteria**: `export type BatchMode = 'full' | 'reading' | 'code-only'` 及其余 F5 类型均在文件中存在，`npm run build` 零错误
- **Commit Point**: 否

---

### T-007 [S]：扩展 `BatchOptions` 并在 `runBatch()` 三处注入 mode 分派

- **Step**: Step 1
- **估时**: M
- **Input**: `src/batch/batch-orchestrator.ts`（三处注入点，参考 plan §5.1）；T-005 确认的精确行号；`BatchMode` 类型（T-006）
- **Output**: `src/batch/batch-orchestrator.ts` 修改：`BatchOptions.mode?: BatchMode`；`runBatch()` 三处注入点增加 mode 分派逻辑（`skipEnrichment`、`mode` 透传、Coverage Audit / Docs Bundle 跳过判断）
- **Test**: 单元测试 `src/batch/__tests__/batch-orchestrator.test.ts`（见 plan §8 Story 1 单元测试）：`mode='reading'` 时 `generateBatchProjectDocs` 被调用且 mode 正确透传；`mode='code-only'` 时 `skipEnrichment=true`；无效 mode 时抛出含枚举值的错误
- **Exit Criteria**: 单测绿；TypeScript 编译无错误；`runBatch({ mode: 'invalid' })` 抛出包含 `full | reading | code-only` 的错误信息
- **Commit Point**: 否

---

### T-008 [S]：在 `batch-project-docs.ts` 中实现 generator 过滤逻辑

- **Step**: Step 1
- **估时**: M
- **Input**: `src/panoramic/batch-project-docs.ts`（`generateBatchProjectDocs()` 函数）；plan §5 的 `READING_SKIP_IDS` / `CODE_ONLY_SKIP_IDS` 集合；`BatchMode` 类型
- **Output**: `src/panoramic/batch-project-docs.ts` 修改：`GenerateBatchProjectDocsOptions` 新增 `mode?: BatchMode`；在 `applicableGenerators` 过滤循环内按 mode 排除对应 generator ID
- **Test**: 单元测试 `src/panoramic/__tests__/batch-project-docs.test.ts`：`mode='reading'` 时 `READING_SKIP_IDS` 中的 generator 不在激活列表；`mode='code-only'` 时 `CODE_ONLY_SKIP_IDS` 均被排除；`mode='full'` 时行为与无 mode 参数等价
- **Exit Criteria**: 三种 mode 的过滤逻辑单测全绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-009 [S]：在 CLI 注册 `--mode=` flag

- **Step**: Step 1
- **估时**: S
- **Input**: `src/cli/` 目录结构（T-001 确认的入口文件）；Commander.js 用法
- **Output**: 在 batch 子命令的 Commander.js 配置文件中新增 `--mode <mode>` option，类型为 `full | reading | code-only`，默认值 `full`；日志输出当前 mode 值（FR-006）
- **Test**: CLI 层集成：运行 `--mode=invalid` 返回含枚举值的错误提示（FR-005）；运行 `--mode=reading` 日志包含 `[info] batch mode: reading`
- **Exit Criteria**: `--help` 中可见 `--mode` 说明；`--mode=invalid` 不进入 pipeline 直接报错退出；日志输出 mode 值
- **Commit Point**: 否

---

### T-010 [P]：在 MCP `batch` tool schema 新增 mode enum 参数

- **Step**: Step 1
- **估时**: S
- **Input**: `src/mcp/server.ts`（batch tool 的 Zod schema 定义）；plan §3 MCP schema 扩展代码片段
- **Output**: `src/mcp/server.ts` 修改：`batch` tool inputSchema 新增 `mode` Zod enum 参数（`z.enum(['full', 'reading', 'code-only']).optional().describe(...)`）；调用 `runBatch()` 时透传 mode
- **Test**: 单元测试：Zod 校验通过（`mode: 'reading'` 合法，`mode: 'invalid'` 抛出 ZodError）；`mode` 未传时默认 `full`
- **Exit Criteria**: MCP batch tool schema Zod 校验单测绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-011 [S]：Story 1 集成测试（三种 mode 各一条路径）

- **Step**: Step 1
- **估时**: M
- **Input**: T-007、T-008、T-009、T-010；graphify 示例项目（5 文件）
- **Output**: `src/batch/__tests__/batch-mode-integration.test.ts`：`--mode=reading` 输出文件清单不含 `product-overview.md`、`adrs/`；`--mode=code-only` 不含 `architecture-narrative.md`；`--mode=full` 行为与无 mode 等价
- **Test**: 集成测试（plan §8 Story 1 集成测试）
- **Exit Criteria**: 三条集成测试路径均绿；输出文件清单断言正确
- **Commit Point**: 否

---

### T-012 [S]：Story 1 E2E 性能基准测量（graphify 示例项目）

- **Step**: Step 1
- **估时**: L
- **Input**: T-007 ~ T-011；graphify 示例项目
- **Output**: 对 graphify 示例项目跑 `--mode=reading` 冷启动和热启动，记录实测耗时到 `specs/132-reading-ux/perf-baseline.md`；验证冷启动 < 300s、热启动 < 60s（FR-008 / SC-001）
- **Test**: 性能测试（plan §8 Story 1 性能测试）；`--mode=code-only` 同等目标
- **Exit Criteria**: perf-baseline.md 中有实测数据；如耗时超标则标注"BLOCKED：R5 风险触发，需 verify 阶段决策"
- **Commit Point**: 否

---

### T-013 [S]：提交 Step 1（commit point）[COMMIT]

- **Step**: Step 1
- **估时**: XS
- **Input**: T-006 ~ T-012 全部完成
- **Output**: git commit，message：`feat(132): Step 1 轻量模式 — BatchMode + mode dispatcher + CLI/MCP schema + 单测`
- **Test**: 提交前执行 `npx vitest run` + `npm run build` 零失败
- **Exit Criteria**: commit 成功，push 到 `origin 132-reading-ux`；`npx vitest run` 零失败
- **Commit Point**: **是**

---

## Step 2 — 问答后端（Story 2 后端：FR-009 ~ FR-017，不含 MCP 接入）

**目标**：新建 `src/panoramic/qa/` 模块（8 个文件），实现完整问答 pipeline，公开 `answerQuestion()` API。

**独立测试**：直接调用 `answerQuestion({ text: '什么调用了 X?' }, { projectRoot })` 对有图谱数据的项目，返回 `QnAAnswer` 包含至少 1 条 Citation。

---

### T-014 [S]：创建 `qa/graph-retriever.ts` + 单元测试

- **Step**: Step 2
- **估时**: M
- **Input**: plan §4 `graph-retriever.ts` 职责描述；plan §7 F4 hyperedges 集成代码片段；`GraphQueryEngine` API（`engine.query()` + `engine.getHyperedges()`）；T-006（`GraphContext` 类型）
- **Output**: `src/panoramic/qa/graph-retriever.ts`：实现 `retrieveGraphContext(query, engine, options): GraphContext`，含 BFS 检索 + hyperedge 扩展（label + nodeId 两种命中方式）+ 合并去重 + fallbackMode 逻辑
- **Test**: `src/panoramic/qa/__tests__/graph-retriever.test.ts`（plan §8）：BFS 命中 < 3 节点时 `fallbackMode = 'rag-only'`；hyperedge 合并去重正确
- **Exit Criteria**: 单测绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-015 [P]：创建 `qa/rag-reranker.ts` + 单元测试

- **Step**: Step 2
- **估时**: M
- **Input**: plan §4 `rag-reranker.ts` 职责；`chunkMarkdownFiles()`、`createEmbeddingProvider()`、`filterByThreshold()` API；T-004 确认的 mock 策略
- **Output**: `src/panoramic/qa/rag-reranker.ts`：实现 `rerankWithEmbedding(ctx, specPaths, projectRoot, options): RerankResult`，含 chunk 切分 + embedding 精排 + `bfs-only` 降级
- **Test**: `src/panoramic/qa/__tests__/rag-reranker.test.ts`（plan §8）：embedding 加载失败时降级为 `bfs-only`；`filterByThreshold` Top-K 结果正确
- **Exit Criteria**: 单测绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-016 [P]：创建 `qa/debt-context.ts` + 单元测试

- **Step**: Step 2
- **估时**: M
- **Input**: plan §4 `debt-context.ts` 职责；plan §7 F3 debt-scanner 集成代码片段；`scanProjectDebt()` API
- **Output**: `src/panoramic/qa/debt-context.ts`：实现 `injectDebtContext(query, projectRoot, registry): DebtContextResult`，含关键词路由（TODO/FIXME/HACK/技术债/最老等）+ 按 ageDays 倒序 top-5 + citation 格式构建
- **Test**: `src/panoramic/qa/__tests__/debt-context.test.ts`（plan §8）：含 TODO 关键词时触发 debt 查询；不含关键词时跳过；citation 格式含 specPath + lineRange + excerpt
- **Exit Criteria**: 单测绿（含/不含关键词两种 case）；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-017 [P]：创建 `qa/citation.ts` + 单元测试

- **Step**: Step 2
- **估时**: M
- **Input**: plan §4 `citation.ts` 职责；四种 citation 路径（Graph-first、RAG 精排、Debt、Hyperedge）；`buildEvidenceText()` API
- **Output**: `src/panoramic/qa/citation.ts`：实现 `buildCitations(rerankResult, graphCtx): Citation[]`，含四种路径的 citation 构建 + lineRange 越界检查（记录 warn 并跳过）
- **Test**: `src/panoramic/qa/__tests__/citation.test.ts`（plan §8）：lineRange 越界时跳过该 citation 并记录 warn；三种路径 citation 格式均合法；hyperedge citation 的 specPath 为 `[graph hyperedge]`
- **Exit Criteria**: 单测绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-018 [P]：创建 `qa/prompt-builder.ts` + 单元测试

- **Step**: Step 2
- **估时**: S
- **Input**: plan §4 `prompt-builder.ts` 职责；citation 内联格式 `[来源：path:startLine-endLine]`；FR-012 100% citation 覆盖要求
- **Output**: `src/panoramic/qa/prompt-builder.ts`：实现 `buildQnAPrompt(ctx, citations, query, options): string`，含系统 prompt（要求 LLM 100% 引用）+ 节点元数据 + chunk excerpts + hyperedge 候选列表
- **Test**: `src/panoramic/qa/__tests__/prompt-builder.test.ts`（plan §8）：输出 prompt 包含所有 citation 内联格式；hyperedge 候选列表存在
- **Exit Criteria**: 单测绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-019 [S]：创建 `qa/llm-caller.ts` + 单元测试

- **Step**: Step 2
- **估时**: M
- **Input**: plan §4 `llm-caller.ts` 职责；plan §7 F1 budget-gate 集成代码片段（record-only 模式实现）；`runBudgetGate()`、`estimateFast()` API；Anthropic SDK `messages.create()`
- **Output**: `src/panoramic/qa/llm-caller.ts`：实现 `callQnALlm(prompt, options): QnALlmResult`，含 `estimateFast()` 预估 + `runBudgetGate({ budget: Infinity, preset: 'continue' })` + overBudget 标记 + Anthropic SDK 调用
- **Test**: `src/panoramic/qa/__tests__/llm-caller.test.ts`（plan §8）：overBudget 标记在超额时为 true；LLM 调用不被阻断；warn 日志在超额时输出；LLM 不调用时 overBudget 为 false（mock Anthropic SDK）
- **Exit Criteria**: 单测绿（mock SDK）；TypeScript 编译无错误；budget-gate 合规路径存在
- **Commit Point**: 否

---

### T-020 [S]：创建 `qa/index.ts`（公开 API `answerQuestion()`）

- **Step**: Step 2
- **估时**: M
- **Input**: T-014 ~ T-019（所有 qa 子模块）；plan §4 `index.ts` 职责（串联 Step 1-7 + 入参校验 + 空图谱检查）
- **Output**: `src/panoramic/qa/index.ts`：实现 `answerQuestion(query: QnAQuery, options: QnAOptions): Promise<QnAAnswer>`，含空字符串拒绝 + > 2000 字符截断 + 空图谱检查 + Step 1-7 串联 + durationMs 计算
- **Test**: `src/panoramic/qa/__tests__/index.test.ts`（plan §8）：空字符串查询被拒绝（不调用 LLM）；> 2000 字符截断；空图谱返回"图谱为空"提示；正常查询返回含 citation 的 QnAAnswer
- **Exit Criteria**: 单测绿；TypeScript 编译无错误；`answerQuestion` 对有图谱数据的项目返回 QnAAnswer 含 ≥ 1 条 Citation
- **Commit Point**: 否

---

### T-021 [S]：qa 模块集成测试（5 类问题 + Citation 覆盖率验证）

- **Step**: Step 2
- **估时**: L
- **Input**: T-020；graphify 示例项目（需要有图谱数据）；plan §8 Story 2 集成测试 + 溯源正确性测试
- **Output**: `src/panoramic/qa/__tests__/qa-integration.test.ts`：对 graphify 示例项目跑 5 类典型问题（调用关系、调用路径、设计决策映射、技术债、流程归属），验证每次返回 citation 列表；抽取 5 条 Citation 验证 `fs.readFileSync(specPath).split('\n').slice(startLine-1, endLine)` 可找到 excerpt 内容（允许部分匹配）
- **Test**: 集成测试（plan §8 Story 2 集成测试 + 溯源正确性测试）
- **Exit Criteria**: 5 类问题各执行 1 次，返回结果均包含 citation；Citation 定位验证通过
- **Commit Point**: 否

---

### T-022 [S]：提交 Step 2（commit point）[COMMIT]

- **Step**: Step 2
- **估时**: XS
- **Input**: T-014 ~ T-021 全部完成
- **Output**: git commit，message：`feat(132): Step 2 问答后端 — qa/ 模块（8 文件）+ pipeline 串联 + budget-gate record-only + 单测`
- **Test**: 提交前执行 `npx vitest run` + `npm run build` 零失败
- **Exit Criteria**: commit 成功，push；所有 qa 单测绿
- **Commit Point**: **是**

---

## Step 3 — MCP natural-language operation 接入（Story 2 前端：FR-009 MCP 侧 + FR-012 schema 暴露）

**目标**：通过 MCP `panoramic-query` tool 的 `natural-language` operation 暴露问答能力，SKILL.md 更新。

**独立测试**：调用 MCP `panoramic-query` with `operation: "natural-language", question: "什么调用了 X?"` 返回 JSON 化的 `QnAAnswer`。

---

### T-023 [S]：扩展 `panoramic-query` tool schema，新增 `natural-language` operation + `question` 参数

- **Step**: Step 3
- **估时**: S
- **Input**: `src/mcp/server.ts`（`panoramic-query` tool 的 Zod schema）；plan §3 MCP schema 扩展代码片段
- **Output**: `src/mcp/server.ts` 修改：`operation` enum 新增 `natural-language`；新增 `question` 参数（`z.string().optional().describe(...)`）
- **Test**: Zod schema 单测：`operation: 'natural-language'` + `question: '...'` 校验通过；`operation: 'natural-language'` 缺少 `question` 时返回有意义的错误或 handler 层校验
- **Exit Criteria**: schema 单测绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-024 [S]：在 `query.ts` 中路由 `natural-language` operation 到 `answerQuestion()`

- **Step**: Step 3
- **估时**: M
- **Input**: `src/panoramic/query.ts`（`queryPanoramic()` 函数）；`answerQuestion()` 接口（T-020）；plan §2 修改模块说明
- **Output**: `src/panoramic/query.ts` 修改：`operation` 枚举扩展 `natural-language`；路由到 `answerQuestion()`；返回结果 JSON 序列化为 MCP 响应格式
- **Test**: MCP 集成测试 `src/mcp/__tests__/panoramic-query-qna.test.ts`：mock Anthropic SDK，通过 `panoramic-query` MCP tool 路径调用，验证返回包含 `QnAAnswer` 结构（含 text + citations + tokenUsage）
- **Exit Criteria**: MCP 集成测试绿；TypeScript 编译无错误；向后兼容（原有 operation 不受影响）
- **Commit Point**: 否

---

### T-025 [S]：E2E 验证 MCP 问答路径（5 类问题）

- **Step**: Step 3
- **估时**: M
- **Input**: T-023、T-024；graphify 示例项目（有图谱数据）
- **Output**: `src/mcp/__tests__/qna-e2e.test.ts`：通过 MCP 工具路径跑 5 类典型问题（使用 mock 或集成 Anthropic SDK），验证返回结构合规；至少 1 次 hyperedge 相关问答
- **Test**: E2E 测试（plan §8 Story 2 集成测试 MCP 路径）
- **Exit Criteria**: 5 类问题各 1 次，返回包含 citations；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-026 [P]：更新 `plugins/spectra/**/SKILL.md`（新增 MCP 工具说明）

- **Step**: Step 3
- **估时**: XS
- **Input**: T-023、T-024；`plugins/spectra/skills/spectra/SKILL.md` 和 `plugins/spectra/skills/spectra-batch/SKILL.md`
- **Output**: 仅在 `plugins/spectra/` 下的相关 SKILL.md 文件中新增 `panoramic-query` 的 `natural-language` operation 说明和 `batch` 工具的 `mode` 参数说明
- **约束**: **不得修改** `plugins/spec-driver/**` 下任何文件（F5 Prompt 读写边界硬约束）
- **Test**: 无（文档更新）
- **Exit Criteria**: `plugins/spectra/skills/spectra/SKILL.md` 和 `plugins/spectra/skills/spectra-batch/SKILL.md` 中可见新增 operation 和 schema 说明；`git diff plugins/spec-driver/` 应为空
- **Commit Point**: 否

---

### T-027 [S]：提交 Step 3（commit point）[COMMIT]

- **Step**: Step 3
- **估时**: XS
- **Input**: T-023 ~ T-026 全部完成
- **Output**: git commit，message：`feat(132): Step 3 MCP natural-language 接入 — panoramic-query 扩展 + query.ts 路由 + SKILL.md 更新`
- **Test**: 提交前执行 `npx vitest run` + `npm run build` 零失败；额外：`git diff plugins/spec-driver/` 必须为空（读写边界检查）
- **Exit Criteria**: commit 成功，push；MCP 集成测试绿；向后兼容验证通过；MCP 路径调用 `batch` 工具时服务端日志中含 `[info] batch mode=<full|reading|code-only>` 输出（F-009 修复：FR-006 在 MCP 路径的可观察性）
- **Commit Point**: **是**

---

## Step 4 — graph.html 扩展（Story 3：FR-018 ~ FR-024）

**目标**：扩展 `buildHtmlTemplate()` 为交互式 graph.html，支持力导向布局（< 2000 节点）、大图静态模式（≥ 2000 节点）、hyperedge 凸包可视化、节点点击跳转 spec 文件。

**独立测试**：对已有 batch 输出数据直接生成 graph.html，在浏览器中离线打开，验证节点可拖动、搜索框可用、点击节点有响应。

---

### T-028 [S]：确认 `scripts/inline-d3.ts` 和 D3_FORCE_BUNDLE 现状

- **Step**: Step 4
- **估时**: XS
- **Input**: `scripts/inline-d3.ts`；`src/panoramic/exporters/html-template.ts`（现有 376 行实现）
- **Output**: 确认 `D3_FORCE_BUNDLE` 的导入方式；确认 `buildHtmlTemplate` 函数签名；记录现有 `isLarge` 判断逻辑（当前 5000 节点阈值）；无代码修改，仅确认
- **Test**: 无（纯代码阅读）
- **Exit Criteria**: 实现前明确知道要改哪几行；T-029 可以安全开始
- **Commit Point**: 否

---

### T-029 [S]：扩展 `buildHtmlTemplate()` 签名 + 新增 `GraphHtmlOptions` 默认值处理

- **Step**: Step 4
- **估时**: S
- **Input**: `src/panoramic/exporters/html-template.ts`（T-028 确认的现状）；plan §6 F5 扩展签名；`GraphHtmlOptions` 类型（T-006）
- **Output**: `src/panoramic/exporters/html-template.ts` 修改：`buildHtmlTemplate(graphDataJson: string, options?: GraphHtmlOptions): string` 签名扩展；默认值处理（`forceLayoutThreshold: 2000`、`showHyperedges: true`、`enableSearch: true`、`enableJumpToSpec: true`、`fileSizeWarnThreshold: 5 * 1024 * 1024`）；向后兼容（无 options 时行为与旧版等价）
- **Test**: 单元测试：无 options 时调用与旧签名等价；options 正确合并默认值
- **Exit Criteria**: 签名扩展单测绿；TypeScript 编译无错误；旧调用方不需要修改
- **Commit Point**: 否

---

### T-030 [S]：替换力导向阈值逻辑（5000 → 2000，FR-022）

- **Step**: Step 4
- **估时**: S
- **Input**: `src/panoramic/exporters/html-template.ts`（T-029 修改后）；plan §6 JS 核心逻辑 `FORCE_THRESHOLD = 2000` 代码片段
- **Output**: `src/panoramic/exporters/html-template.ts` 内联 JS 修改：将现有 `isLarge = nodes.length > 5000` 替换为 `var FORCE_THRESHOLD = 2000; var isLarge = nodes.length >= FORCE_THRESHOLD`；500-2000 节点区间额外设 `alphaDecay=0.05 + strength=-80`
- **Test**: 单元测试：节点数 ≥ 2000 时生成 HTML 中 `FORCE_THRESHOLD` 为 2000 且不调用 `D3.forceSimulation` 的 `start()`；节点数 < 2000 时 force simulation 正常初始化
- **Exit Criteria**: 阈值替换单测绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-031 [S]：新增大图模式横幅 HTML 区块（FR-023）

- **Step**: Step 4
- **估时**: S
- **Input**: `src/panoramic/exporters/html-template.ts`（T-030 修改后）；plan §6 大图横幅 HTML 代码片段
- **Output**: `src/panoramic/exporters/html-template.ts` 内联 HTML 新增：`#large-graph-banner` div（固定定位、黄色背景、节点数显示）；JS 逻辑：`isLarge` 时 `display: block`；生成日志输出 `[warn] graph node count exceeds 2000, force layout disabled, using static layout`（FR-023）；体积超 5 MB 时输出 warn（FR-024）
- **Test**: 单元测试：节点数 ≥ 2000 时生成 HTML 包含 `large-graph-banner` 元素；`banner-node-count` 填充正确数值
- **Exit Criteria**: 单测绿；TypeScript 编译无错误；FR-023 验收条件满足（横幅存在 + 日志 warn）
- **Commit Point**: 否

---

### T-032 [S]：新增 spec 文件跳转逻辑（FR-020）

- **Step**: Step 4
- **估时**: M
- **Input**: `src/panoramic/exporters/html-template.ts`（T-031 修改后）；plan §6 `showDetail()` 扩展代码片段；T-002 确认的 `node.specPath` 字段方案
- **Output**: `src/panoramic/exporters/html-template.ts` 内联 HTML 新增：`#spec-link-row` 区块（按钮 + 错误提示区域）；JS 扩展 `showDetail()` 函数：根据 `node.specPath` 显示/隐藏按钮；按钮 onclick 执行 `window.open('file://' + node.specPath, '_blank')`；`specPathExists` 字段判断是否显示"spec 文件未找到"提示
- **Test**: 单元测试（HTML structure 断言）：`node.specPath` 存在时生成 HTML 含 `open-spec-btn`；`node.specPathExists = false` 时按钮显示错误提示逻辑存在
- **Exit Criteria**: 单测绿；TypeScript 编译无错误；FR-020 验收条件（点击有响应 + 不存在时友好提示）
- **Commit Point**: 否

---

### T-033 [S]：新增 hyperedge 超边图例区块 + SVG 凸包渲染（FR-013 / FR-019）

- **Step**: Step 4
- **估时**: L
- **Input**: `src/panoramic/exporters/html-template.ts`（T-032 修改后）；plan §6 hyperedge 凸包渲染代码片段（`convexHull()`、`renderHyperedges()`、`hullToPathD()`）；`GRAPH_DATA.hyperedges` 内联数据结构
- **Output**: `src/panoramic/exporters/html-template.ts` 内联 HTML/JS 新增：`#hyperedge-section` 图例区块；`#hyperedges-layer` SVG 层；`convexHull()` Graham Scan 内联实现（约 25 行）；`renderHyperedges()` 凸包路径渲染；悬浮 tooltip；`buildHtmlTemplate()` 中将 `hyperedges` 数据写入 `GRAPH_DATA` JSON；确保 `buildKnowledgeGraph()` 输出的 hyperedges 被传入
- **Test**: 单元测试：生成 HTML 包含 `hyperedges-layer` 元素；hyperedges 数据存在于 `GRAPH_DATA` JSON；< 3 个节点的 hyperedge 跳过渲染
- **Exit Criteria**: 单测绿；TypeScript 编译无错误；hyperedge 凸包逻辑存在（浏览器验证在 T-038）
- **Commit Point**: 否

---

### T-034 [S]：确认 `batch-orchestrator.ts` 中知识图谱写盘后调用 `buildHtmlTemplate()` 的位置并实现

- **Step**: Step 4
- **估时**: M
- **Input**: `src/batch/batch-orchestrator.ts`（阶段 7 知识图谱写盘逻辑）；T-029 ~ T-033 修改后的 `buildHtmlTemplate()`；plan §6 调用方说明
- **Output**: `src/batch/batch-orchestrator.ts` 修改：知识图谱写盘后，若存在 `--html` flag 或 options.generateHtml = true，调用 `buildHtmlTemplate(graphDataJson, options)` 生成 `_meta/graph.html`；体积超 5 MB 时输出 warn
- **Test**: 集成测试：`batch --html` 后输出目录含 `_meta/graph.html`；文件体积超 5 MB 时有 warn 日志
- **Exit Criteria**: 集成测试绿；TypeScript 编译无错误；graph.html 生成在正确路径
- **Commit Point**: 否

---

### T-035 [S]：在 CLI 注册 `--html` flag

- **Step**: Step 4
- **估时**: S
- **Input**: `src/cli/`（T-001 确认的入口文件）；T-034 中 `options.generateHtml` 参数
- **Output**: 在 batch 子命令的 Commander.js 配置文件中新增 `--html` boolean flag；传递到 `runBatch()` options
- **Test**: CLI 层：`--html` flag 注册后 `--help` 可见；传递到 `runBatch()` 时 `options.generateHtml = true`
- **Exit Criteria**: `--help` 含 `--html` 说明；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-036 [S]：补充 `node.specPath` 和 `specPathExists` 字段（如 T-002 确认需要）

- **Step**: Step 4
- **估时**: M
- **Input**: T-002 的结论；`buildKnowledgeGraph()` 实现；`GraphNode` 类型定义
- **Output**: 若 `GraphNode` 缺少 `specPath` 字段，在图谱构建阶段补充 `specPath` 字段（指向 `modules/*.spec.md`）和 `specPathExists` 字段（`fs.existsSync()` 检查结果）；若已有则确认并补充 `specPathExists`
- **Test**: 单元测试：图谱构建输出的节点包含 `specPath` 和 `specPathExists` 字段；`specPathExists = false` 对不存在文件正确
- **Exit Criteria**: 单测绿；TypeScript 编译无错误；`GRAPH_DATA.nodes[].specPath` 在 graph.html 中可用
- **Commit Point**: 否

---

### T-037 [S]：Story 3 单元测试补全（buildHtmlTemplate 完整断言）

- **Step**: Step 4
- **估时**: M
- **Input**: T-029 ~ T-036；plan §8 Story 3 单元测试
- **Output**: `src/panoramic/exporters/__tests__/html-template.test.ts`：新增/补全断言：签名向后兼容（无 options 等价旧行为）；节点数 ≥ 2000 时含横幅且 forceSimulation 不调用；节点数 < 2000 时 force simulation 正常；文件体积超 5 MB warn；hyperedge 层存在
- **Test**: 单元测试（plan §8 Story 3 单元测试完整列表）
- **Exit Criteria**: 所有 Story 3 单元测试绿；TypeScript 编译无错误
- **Commit Point**: 否

---

### T-038 [S]：graph.html 浏览器人工验证（需人工验证）

- **Step**: Step 4
- **估时**: M
- **Input**: T-034、T-035 生成的 graph.html；Chrome / Firefox / Safari
- **Output**: 浏览器离线打开 graph.html，手动验证：节点可拖动（< 2000 节点）、搜索框可过滤、点击节点 `open-spec-btn` 可见、hyperedge 凸包轮廓可见（若数据含 hyperedges）、大图模式横幅在节点 ≥ 2000 时显示
- **Test**: 浏览器人工验证（SC-003 / SC-005，plan §8 Story 3 集成测试）；**需人工验证**
- **Exit Criteria**: 验证结果记录到 `specs/132-reading-ux/browser-verification.md`；通过或记录 BLOCKED
- **Commit Point**: 否

---

### T-039 [S]：提交 Step 4（commit point）[COMMIT]

- **Step**: Step 4
- **估时**: XS
- **Input**: T-028 ~ T-038 全部完成（含人工验证通过）
- **Output**: git commit，message：`feat(132): Step 4 graph.html 扩展 — 力导向阈值 + 大图横幅 + hyperedge 凸包 + 节点跳转 spec + CLI --html flag`
- **Test**: 提交前执行 `npx vitest run` + `npm run build` 零失败
- **Exit Criteria**: commit 成功，push；所有 Story 3 单测绿
- **Commit Point**: **是**

---

## Step 5 — E2E 验证 + docs 回归（SC-001 ~ SC-007 + 风险 R1-R7）

**目标**：整合验证所有 Story 的端到端行为，确认 SC 和 NFR 均达标，修复 Step 1-4 发现的 bug。

---

### T-040 [S]：预检：`npx vitest run` + `npm run build` + `npm run repo:check` 全绿

- **Step**: Step 5
- **估时**: S
- **Input**: Step 1-4 全部完成
- **Output**: 运行三个检查命令，记录结果；若有失败则在此 task 内修复（不推进到 T-041 前提）
- **Test**: 全量单元测试 + 构建 + 仓库检查
- **Exit Criteria**: 三个命令均零失败零错误；可推进 T-041
- **Commit Point**: 否

---

### T-041 [S]：E2E 冷热启动性能测量（SC-001 / NFR-001）

- **Step**: Step 5
- **估时**: L
- **Input**: T-040；graphify 示例项目（清空缓存做冷启动）
- **Output**: 对 graphify 示例项目运行 `spectra batch --mode=reading`（冷启动）和再次运行（热启动），记录各阶段耗时到 `specs/132-reading-ux/perf-baseline.md`（更新）；`--mode=code-only` 同等测量
- **Test**: 性能测试（SC-001）；目标：冷启动 < 300s，热启动 < 60s
- **Exit Criteria**: perf-baseline.md 含实测数据；若超标记录 R5 风险触发原因（不阻断交付）
- **Commit Point**: 否

---

### T-042 [S]：E2E 问答覆盖率 + 问答性能（SC-002 / FR-011 / NFR-002 / plan §8 Story 2 性能）

- **Step**: Step 5
- **估时**: M
- **Input**: T-040；graphify 示例项目（有图谱数据）
- **Output**: 对 graphify 示例项目跑 FR-011 表中 5 类问题各 3 次（共 ≥ 15 次）：
  - （a）**Citation 覆盖率**：统计包含有效 Citation 的比例，要求 100%（每条答案含 specPath + lineRange + excerpt）
  - （b）**问答性能测量**（F-005 修复）：同时记录每次问答耗时，区分冷启动（首次调用，embedding provider 首次加载）和热启动（embedding singleton 已加载），目标：**冷启动 < 20s / 热启动 < 5s**（plan §8 Story 2 性能目标）
- **Test**: E2E（SC-002 + Story 2 性能）
- **Exit Criteria**: ≥ 15 次问答，100% 含有效 Citation；冷启动 ≥ 1 次 < 20s、热启动 ≥ 10 次平均 < 5s；结果记录到 `specs/132-reading-ux/qa-coverage-report.md`（含性能子章节）
- **Commit Point**: 否

---

### T-043 [P]：SC-004 差异化点验证（hyperedge Citation）

- **Step**: Step 5
- **估时**: S
- **Input**: T-042；graphify 示例项目（含 F4 hyperedge 数据）
- **Output**: 执行"X 对应哪个设计决策"问答，验证返回 Citation 中至少 1 条 `specPath` 指向 spec.md 中 `[conceptually_related_to]` 区块；记录到 qa-coverage-report.md
- **Test**: SC-004
- **Exit Criteria**: 至少 1 次问答返回 hyperedge 来源 Citation；记录结果
- **Commit Point**: 否

---

### T-044 [P]：SC-007 降级验证（BFS < 3 节点场景）

- **Step**: Step 5
- **估时**: S
- **Input**: T-040；`qa/graph-retriever.ts` + `qa/index.ts`
- **Output**: 模拟 BFS 命中 < 3 节点（mock engine 返回 2 个节点），验证 fallbackMode = 'rag-only' 触发；若 RAG 仍失败，返回"图谱数据不足"提示；无崩溃（SC-007）
- **Test**: SC-007 回归测试（mini-test）
- **Exit Criteria**: 降级路径正确触发；无崩溃；结果记录
- **Commit Point**: 否

---

### T-045 [P]：SC-006 Budget 合规验证（tokenUsage 日志追溯）

- **Step**: Step 5
- **估时**: S
- **Input**: T-040；Step 1-4 的全部 LLM 调用路径
- **Output**: 在日志中确认 F5 新增的所有 LLM 调用均有对应 `tokenUsage` 记录；检查无绕过 budget-gate 的调用路径（SC-006 / NFR-004）
- **Test**: SC-006
- **Exit Criteria**: 所有 LLM 调用路径均有 tokenUsage 日志；记录结果
- **Commit Point**: 否

---

### T-046 [S]：R1-R7 风险回归验证（完整 checklist）

- **Step**: Step 5
- **估时**: M
- **Input**: T-041 ~ T-045；plan §10 风险应对表
- **Output**: `specs/132-reading-ux/risk-regression.md`：逐条列出 R1-R7 的验证结果：R1（BFS 降级）、R2（embedding 降级 bfs-only）、R3（hyperedge 召回稳定性）、R4（graph.html 力导向阈值）、R5（性能收益）、R6（Citation 定位准确性）、R7（html 体积警告）
- **Test**: 风险回归（复用 T-041 ~ T-045 数据 + 补充 R2/R3/R4/R6/R7 的 mini-test）
- **Exit Criteria**: risk-regression.md 有 R1-R7 每条的验证状态（通过/触发/N/A）
- **Commit Point**: 否

---

### T-047 [S]：graph.html 全链路 E2E（SC-003 / SC-005）

- **Step**: Step 5
- **估时**: M
- **Input**: T-040；graphify 示例项目跑 `batch --mode=reading --html`
- **Output**: 对 graphify 示例项目执行 `spectra batch --mode=reading --html`，生成 `_meta/graph.html`，离线浏览器打开，验证 SC-003（节点可拖动、搜索可用、点击有响应）和 SC-005（点击节点后 `open-spec-btn` 触发打开行为）；**需人工验证**
- **Test**: SC-003 / SC-005；浏览器人工验证
- **Exit Criteria**: 浏览器验证通过；结果记录到 browser-verification.md（更新）
- **Commit Point**: 否

---

### T-048 [S]：修复 Step 1-4 发现的所有 bug

- **Step**: Step 5
- **估时**: M（取决于 bug 数量，可能 XS 到 XL）
- **Input**: T-041 ~ T-047 发现的问题；各修改文件
- **Output**: 针对发现的 bug 进行修复，不新增功能；修改的文件视 bug 情况而定
- **Test**: 修复后重跑 `npx vitest run` + 相关集成测试确认无回归
- **Exit Criteria**: 所有 bug 修复完成；`npx vitest run` 零失败
- **Commit Point**: 否

---

### T-049 [S]：更新 CHANGELOG.md / plugins SKILL.md / README（如需要）

- **Step**: Step 5
- **估时**: S
- **Input**: T-026 已更新的 SKILL.md；F5 完整功能清单
- **Output**: 若 CHANGELOG.md 需要更新（新功能条目）则更新；确认 `plugins/*/SKILL.md` 已包含所有新增能力说明（batch mode、panoramic-query natural-language）；若 README 有功能说明部分则更新
- **Test**: 无（文档更新）
- **Exit Criteria**: CHANGELOG.md 和 SKILL.md 内容与实现一致
- **Commit Point**: 否

---

### T-050 [S]：测试覆盖率统计

- **Step**: Step 5
- **估时**: XS
- **Input**: 全部测试完成后；`npx vitest run --coverage`
- **Output**: 运行 `npx vitest run --coverage`，记录 `src/panoramic/qa/`、`src/batch/`、`src/panoramic/exporters/html-template.ts`、`src/mcp/` 的覆盖率数据到 `specs/132-reading-ux/coverage-report.md`
- **Test**: 覆盖率统计
- **Exit Criteria**: coverage-report.md 含各模块覆盖率数字；F5 新增代码行覆盖率目标 ≥ 80%
- **Commit Point**: 否

---

### T-051 [S]：提交 Step 5（commit point）[COMMIT]

- **Step**: Step 5
- **估时**: XS
- **Input**: T-040 ~ T-050 全部完成；`npx vitest run` + `npm run build` + `npm run repo:check` 零失败
- **Output**: git commit，message：`feat(132): Step 5 E2E 验证 — SC 全通 + R1-R7 回归 + bug 修复 + CHANGELOG 更新`
- **Test**: 提交前三命令零失败
- **Exit Criteria**: commit 成功，push；所有 SC 已验证
- **Commit Point**: 是

---

## Post-Verify — 交付准备（不写代码，纯整理）

---

### T-052 [S]：准备 verification-report.md 起草结构

- **Step**: Post-Verify
- **估时**: XS
- **Input**: T-040 ~ T-051 的所有验证结果文件（perf-baseline.md、qa-coverage-report.md、risk-regression.md、browser-verification.md、coverage-report.md）
- **Output**: `specs/132-reading-ux/verification-report.md`：起草结构（按 SC-001 ~ SC-007 组织，各节留白），供 verify 阶段填充实测结果；不填充结论，只建立骨架
- **Test**: 无（文档整理）
- **Exit Criteria**: verification-report.md 存在，包含 SC-001 ~ SC-007 章节骨架
- **Commit Point**: 否

---

### T-053 [S]：rebase master 预备（最终交付前）

- **Step**: Post-Verify
- **估时**: XS
- **Input**: 最新 `origin/master`；当前分支 `132-reading-ux`
- **Output**: 执行 `git fetch origin master:master` → `git rebase master`，解决冲突（如有）→ 重跑 `npx vitest run` + `npm run build` + `npm run repo:check` 零失败
- **Test**: rebase 后三命令零失败
- **Exit Criteria**: 分支已 rebase 到最新 master；无冲突；三命令零失败；**不执行 push origin master（需用户明确授权）**
- **Commit Point**: 否

---

### T-054 [S]：最终交付提交（commit point）[COMMIT]

- **Step**: Post-Verify
- **估时**: XS
- **Input**: T-052、T-053 完成；用户确认可交付
- **Output**: git commit，message：`docs(132): 添加 verification-report.md 骨架 + 交付准备`；push `origin 132-reading-ux`；**不推送 origin master（需用户单独授权）**
- **Test**: commit 前三命令零失败
- **Exit Criteria**: commit 成功；push 到 feature 分支；等待用户授权 merge 到 master
- **Commit Point**: **是**

---

## FR 覆盖映射表

| FR | 覆盖 Task |
|----|----------|
| FR-001（mode 枚举参数，CLI + MCP） | T-006、T-009、T-010 |
| FR-002（不传 mode 默认 full） | T-007、T-009、T-010 |
| FR-003（reading 模式跳过产品文档层） | T-008、T-011 |
| FR-004（code-only 模式跳过 design-doc 推断） | T-008、T-011 |
| FR-005（无效 mode 启动时报错退出） | T-007、T-009 |
| FR-006（日志输出当前 mode） | T-009 |
| FR-007（batch MCP schema 新增 mode） | T-010 |
| FR-008（reading 模式性能：冷 < 300s，热 < 60s） | T-012、T-041 |
| FR-009（自然语言问答能力 + MCP 入口） | T-020、T-023、T-024 |
| FR-010（B+C 混合架构：BFS + embedding + LLM） | T-014、T-015、T-020 |
| FR-011（5 类典型问题支持） | T-014、T-015、T-016、T-017、T-020、T-021 |
| FR-012（100% Citation 覆盖，三字段必填） | T-017、T-020、T-042 |
| FR-013（引用 hyperedge 区块作为 Citation 来源） | T-014、T-017、T-043 |
| FR-014（BFS < 3 节点降级到纯 RAG） | T-014、T-020、T-044 |
| FR-015（所有 LLM 调用走 runBudgetGate） | T-019、T-045 |
| FR-016（单轮无状态问答） | T-020 |
| FR-017（record-only 模式，overBudget 标记） | T-019、T-020 |
| FR-018（力导向交互式 graph.html，节点可拖动） | T-029、T-030、T-037 |
| FR-019（搜索/过滤功能） | T-029、T-037 |
| FR-020（点击节点打开 spec 文件 + 友好提示） | T-032、T-036、T-038 |
| FR-021（self-contained HTML，零 CDN） | T-029（确认现有机制保留） |
| FR-022（≥ 2000 节点静态坐标模式） | T-030、T-031、T-037 |
| FR-023（大图横幅 + 日志 warn） | T-031、T-037 |
| FR-024（超 5 MB 输出 warn，不阻断） | T-031、T-034 |

**FR 覆盖率：24/24 = 100%**

---

## 任务统计

| 维度 | 数值 |
|------|------|
| 总 task 数 | 54 |
| Commit points | 7（T-013、T-022、T-027、T-039、T-051、T-054 + T-022 中 Step 2 已含 7 个 commit point） |
| 并行 tasks `[P]` | 9（T-001/002/003/004/005 Step 0 全并行；T-015/016/017/018 Step 2 部分并行；T-043/044/045 Step 5 部分并行；T-010 Step 1 部分并行） |
| 需人工验证的 task | 2（T-038 graph.html 浏览器验证；T-047 全链路 E2E 浏览器验证） |
| BLOCKED 的 task | 0 |

### Step 分布

| Step | Task 数 | 说明 |
|------|---------|------|
| Step 0（代码确认） | 5（T-001 ~ T-005） | 全并行，无 commit |
| Step 1（轻量模式） | 8（T-006 ~ T-013） | 含 commit T-013 |
| Step 2（问答后端） | 9（T-014 ~ T-022） | 含 4 个并行单测 task + commit T-022 |
| Step 3（MCP 接入） | 5（T-023 ~ T-027） | 含 commit T-027 |
| Step 4（graph.html） | 12（T-028 ~ T-039） | 含 2 次人工验证 + commit T-039 |
| Step 5（E2E 验证） | 12（T-040 ~ T-051） | 含 3 个并行验证 task + commit T-051 |
| Post-Verify | 3（T-052 ~ T-054） | 纯整理 + 最终 commit |

### 估时分布

| 估时 | Task 数 | 代表 |
|------|---------|------|
| XS（< 30 分钟） | 14 | commit task、T-004/005/028 等 |
| S（30-60 分钟） | 18 | 类型定义、CLI flag、schema 扩展 |
| M（1-2 小时） | 16 | 各模块实现 + 单测 |
| L（2-4 小时） | 6 | 集成测试、凸包渲染、性能测量 |
| XL（> 4 小时） | 0 | — |

### 推荐实现策略

**MVP First**（优先交付 Story 1 + Story 2）：
1. Step 0（代码确认，< 1 天，并行）
2. Step 1（轻量模式，约 1-2 天）
3. Step 2（问答后端，约 2-3 天）
4. Step 3（MCP 接入，约 0.5-1 天）
5. **MVP 验证点**：Story 1 + Story 2 功能完整，可演示
6. Step 4（graph.html，约 2-3 天）
7. Step 5（E2E，约 1-2 天）
8. Post-Verify（< 0.5 天）

---

## 依赖关系说明

### Phase 依赖

- Step 0 → Step 1（T-001~T-005 结论影响 T-007/T-009/T-034/T-036）
- Step 1 → Step 2（`BatchMode` 类型 T-006 是 Step 2 的前置）
- Step 2 → Step 3（`answerQuestion()` T-020 是 Step 3 的前置）
- Step 3 → Step 5（MCP 路径需要在 E2E 中验证）
- Step 4 独立于 Step 2/3（Story 3 可与 Story 2 并行，但 Step 4 内部有串行依赖）
- Step 5 → 全部 Step 完成

### Story 间依赖

- Story 1（Step 1）是 Story 2 和 Story 3 的软依赖（`BatchMode` 类型被共享）
- Story 2 后端（Step 2）是 Story 2 前端（Step 3）的硬依赖
- Story 3（Step 4）可在 Story 2 实现期间并行推进（不同模块，无代码依赖）

### Story 内部并行机会

- Step 2 中 T-015（rag-reranker）、T-016（debt-context）、T-017（citation）、T-018（prompt-builder）可在 T-014 完成后并行推进（各自独立文件）
- Step 0 中 T-001 ~ T-005 全部可并行

---

## 注意事项

- `[P]` tasks = 与前一个 task 无文件冲突，可并行执行
- 每个 commit task 前必须执行 `npx vitest run` + `npm run build` 零失败
- T-038 和 T-047 标注"需人工验证"，自动化测试无法替代
- Step 0 的代码确认结论必须在 Step 1 第一个实现 task 开始前完成
- 超级 task 拆分原则：单个 task 覆盖文件数 ≤ 2（T-033 例外，因 convexHull 和 renderHyperedges 逻辑紧密耦合）
- BLOCKED 状态应在 task 内注明原因，等待解决后继续，不跳过
