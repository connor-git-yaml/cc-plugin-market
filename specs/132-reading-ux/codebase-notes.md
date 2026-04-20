---
feature: F5 Reading UX
branch: 132-reading-ux
phase: implement
subphase: step-0-codebase-notes
created: 2026-04-20
---

# F5 Implement — Codebase Reality Check（Step 0）

## T-001：graph.html 生成入口 CLI 结构

**结论**：`--mode=` flag 需要注册在 `src/cli/commands/batch.ts` 的 batch 子命令下。

**入口结构**：
- CLI 主入口：`src/cli/index.ts`（使用自定义参数解析器，非 Commander.js）
- batch 子命令处理：`src/cli/commands/batch.ts`（第 15 行 `runBatchCommand`）
- **参数解析器**：`src/cli/utils/parse-args.ts`（第 640 行 `if (sub === 'batch')` 分支）

**关键发现**：本项目不使用 Commander.js，而是使用自定义 `parseArgs()` 函数（`src/cli/utils/parse-args.ts`）。`CLICommand` 接口（第 7 行）定义所有 flag 字段，batch 分支在第 640-711 行手动解析各 flag，最终返回 `CLICommand` 对象。

**`--html` flag 的现状**：graph.html 生成入口目前通过 `spectra export --format html` 暴露（`src/cli/commands/export.ts`），不是通过 batch 命令。T-034/T-035 需要在 batch 子命令下新增 `--html` flag，调用路径为：batch.ts → runBatch() options.generateHtml。

**T-009 注册位置**：
1. `src/cli/utils/parse-args.ts`：在 `CLICommand` 接口新增 `batchMode?: string` 字段；在 batch 分支（第 640 行）解析 `--mode <value>` 选项
2. `src/cli/commands/batch.ts`：在 `runBatch()` 调用时透传 `mode: command.batchMode`

## T-002：node.specPath + hyperedges 传入路径

### (a) node.specPath

**结论**：`GraphNode` 类型（`src/panoramic/graph/graph-types.ts` 第 53 行）目前**不含** `specPath` 字段。

当前 `GraphNode` 接口只有：
- `id: string`
- `kind: 'module' | 'package' | ... | 'diagram'`
- `label: string`
- `metadata: Record<string, unknown>`

`specPath` 相关信息可能存储在 `metadata` 字段中，但接口级别无明确定义。T-036 需要在 `GraphNode` 接口中补充 `specPath?: string` 和 `specPathExists?: boolean` 字段，并在 `buildKnowledgeGraph()` 的图构建阶段填充。

### (b) hyperedges → buildHtmlTemplate 传入路径

**结论**：`hyperedges` **尚未传入** `buildHtmlTemplate()`。

当前传递路径：
- `buildKnowledgeGraph()` 返回 `GraphJSON`（含 `hyperedges?: Hyperedge[]` 字段，第 167 行）
- 调用方：`src/batch/batch-orchestrator.ts` 第 910 行 `const graphJson = buildKnowledgeGraph({...})`
- `writeKnowledgeGraph(graphJson, resolvedOutputDir)` 写盘 graph.json（第 927 行）
- `buildHtmlTemplate(graphDataJson: string): string`（`src/panoramic/exporters/html-template.ts` 第 23 行）只接受 JSON 字符串，**目前不被 batch-orchestrator 调用**

**补充传入的具体位置**：T-034 需要在 `batch-orchestrator.ts` 的第 927-931 行（知识图谱写盘后）添加调用 `buildHtmlTemplate(JSON.stringify(graphJson), options)` 的逻辑。T-033 扩展 `buildHtmlTemplate()` 接受 options 后，`GRAPH_DATA` JSON 中已包含 hyperedges 数据（由 `buildKnowledgeGraph()` 提供），无需额外处理。

**对 plan §2 的补充**：`buildHtmlTemplate` 目前**不在** batch-orchestrator 的调用链中，需要 T-034 新增调用点。这与 plan §2 描述一致。

## T-003：community.center 预计算坐标

**结论**：`CommunityInfo` 类型（`src/panoramic/community/community-detector.ts` 第 22 行）**不含** `center` 坐标字段。

当前 `CommunityInfo` 接口仅有：
- `id: number`
- `nodes: string[]`（社区内节点 ID 列表）
- `coreNodes: string[]`（度数最高的前 3 个节点）
- `cohesion: number`

`graph.json` 的 `communities[]` 数组（如果有）来源于 community 分析写盘，也不含 `center` 字段。

**对 Step 4 的影响**：大图静态模式（T-031）的 community 预计算坐标需要在 Step 4 实现时，从节点当前 x/y 坐标推算社区中心（取社区内各节点坐标均值），而不能直接从 `graph.json` 读取预计算的 `center` 字段。T-028 时需再次确认 `html-template.ts` 中现有的坐标处理逻辑。

## T-004：embedding provider 实际用法

**结论**：实际使用的是 `@huggingface/transformers`（非 `@xenova/transformers`）。

- 工厂函数：`src/panoramic/anchoring/providers/factory.ts`，`createEmbeddingProvider()` 导出（第 47 行）
- 默认 provider：`local`（`LocalEmbeddingProvider`，`src/panoramic/anchoring/providers/local-provider.ts`）
- 实际依赖：`@huggingface/transformers`（local-provider.ts 中 lazy import）
- OpenAI provider：`src/panoramic/anchoring/providers/openai-provider.ts`（备选）

**单测 mock 策略**（Step 2 T-015 参考）：
- mock 路径：`../../panoramic/anchoring/providers/factory.js`（Vitest 使用 `vi.mock`）
- mock 的方法：`createEmbeddingProvider`，返回一个实现了 `embed(texts: string[]): Promise<number[][]>` 的 mock 对象
- 降级场景 mock：`createEmbeddingProvider` 抛出 Error，验证 `rag-reranker.ts` 降级为 `bfs-only`

## T-005：batch-orchestrator 三个注入点

**结论**：实际行号与 plan §5.1 描述有偏差，以下为精确行号。

### 注入点 1：模块 spec 生成 `skipEnrichment`（plan 描述约第 617 行）

**实际位置**：第 621 行
```typescript
skipEnrichment: isSmallModule || budgetSkipEnrichmentAll,
```

**F5 修改方案**：
```typescript
skipEnrichment: isSmallModule || budgetSkipEnrichmentAll || options.mode === 'code-only',
```

### 注入点 2：`generateBatchProjectDocs` 调用处（plan 描述约第 869 行）

**实际位置**：第 869-873 行
```typescript
projectDocsResult = await generateBatchProjectDocs({
  projectRoot: resolvedRoot,
  outputDir: projectDir,
  specsRootDir: resolvedOutputDir,
});
```

**F5 修改方案**（新增 `mode` 透传）：
```typescript
projectDocsResult = await generateBatchProjectDocs({
  projectRoot: resolvedRoot,
  outputDir: projectDir,
  specsRootDir: resolvedOutputDir,
  mode: options.mode ?? 'full',
});
```

### 注入点 3：Coverage Audit（plan 描述约第 934 行）

**实际位置**：第 933-949 行
```typescript
try {
  const coverageAuditor = new CoverageAuditor();
  // ...
```

**实际位置**：Docs Bundle 在第 974-983 行
```typescript
try {
  const docsBundleResult = orchestrateDocsBundle({
  // ...
```

**F5 修改方案**（在两处 try 块前各加 mode 判断）：
```typescript
if ((options.mode ?? 'full') === 'full') {
  try {
    const coverageAuditor = new CoverageAuditor();
    // ... 行 933-949 内容
  }
}
// ...
if ((options.mode ?? 'full') === 'full') {
  try {
    const docsBundleResult = orchestrateDocsBundle({
    // ... 行 974-983 内容
  }
}
```

### T-006 放置位置决策

**结论**：`BatchMode` 应放在 `src/batch/batch-orchestrator.ts` 中（或独立 `src/batch/types.ts`），而非 `src/panoramic/qa/types.ts`。

**理由**：
1. `BatchMode` 控制 batch pipeline 的运行范围，是 batch 模块的核心概念，与 qa 模块无关
2. `batch-orchestrator.ts` 的 `BatchOptions` 需要 `mode?: BatchMode`，如果类型在 qa/ 模块，会产生 batch 模块依赖 qa 模块的奇异耦合
3. plan §3 将 `BatchMode` 放在 `src/panoramic/qa/types.ts` 是为了"F5 所有核心类型定义"集中管理，但 `BatchMode` 语义上更接近 batch 而非 qa

**实施方案**：在 `src/panoramic/qa/types.ts` 中定义 `BatchMode`（遵循 tasks.md T-006 的 Output 要求），但在 `src/batch/batch-orchestrator.ts` 中 import 自 qa/types.ts。这样既满足 tasks.md 规定的文件路径，又允许 batch-orchestrator 按需 import。

## Step 1 实施启动前置条件检查

- [x] T-001：CLI 入口确认 — 使用自定义 parseArgs，非 Commander.js；`--mode=` flag 需在 parse-args.ts 的 batch 分支新增
- [x] T-002：`node.specPath` 不存在于当前 GraphNode（需 T-036 补充）；hyperedges 尚未传入 buildHtmlTemplate（需 T-034 实现）
- [x] T-003：`communities[].center` 字段不存在（大图模式 Step 4 需推算）
- [x] T-004：embedding provider 为 `@huggingface/transformers`，mock 路径已确认
- [x] T-005：三个注入点精确行号已确认（621、869-873、933 + 974）
- [x] 所有 5 项代码确认完成
- [x] 无阻塞问题（T-002/T-003 发现的缺失字段不影响 Step 1 实现，属于 Step 4 范围）
