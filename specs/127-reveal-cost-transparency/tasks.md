# Tasks: Reveal & Cost Transparency (F1)

**Branch**: `127-reveal-cost-transparency` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## 执行顺序

按依赖拓扑排序：Schema → 采集 → 写入 → 聚合 → 渲染 → CLI → SKILL.md → 验证。每个顶层任务完成后 `git add` + 提交；**不等所有任务做完才 commit**。

## Top-level Tasks

- [ ] **T1 — 扩展 SpecFrontmatter + CompletedModule Schema**
  - 文件：`src/models/module-spec.ts`
  - 在 `SpecFrontmatterSchema` 末尾追加 4 个 optional 字段：`tokenUsage`（含 `input`/`output` 对象）、`durationMs`（number）、`llmModel`（string）、`fallbackReason`（nullable string）
  - 在 `CompletedModuleSchema` 追加 `costMetadata` optional object；保留旧 `tokenUsage: number` 字段做向后兼容读取
  - 新增类型：`CostMetadataSchema` + `CostMetadata`
  - 单测：`tests/models/frontmatter-cost.test.ts` 验证 optional 字段可缺失、可解析、可序列化

- [ ] **T2 — GenerateSpecResult 扩展 + costMetadata 采集**
  - 文件：`src/core/single-spec-orchestrator.ts`
  - 扩展 `GenerateSpecResult` 接口：新增 `costMetadata: CostMetadata`
  - 在 `generateSpec` 中采集 `LLMResponse.inputTokens/outputTokens/duration/model`；enrichment 调用的 duration 累加到 `durationMs`
  - LLM 降级时写 `fallbackReason`（"LLM 不可用" / "context 超限" / 等），token 字段置 0
  - 保留原 `tokenUsage: number` 字段（二者都返回）
  - 单测：覆盖 LLM 成功、LLM 降级、enrichment 失败三条路径

- [ ] **T3 — frontmatter.ts 写入新字段**
  - 文件：`src/generator/frontmatter.ts`
  - 扩展 `FrontmatterInput` 接口新增 4 个字段（optional）
  - `generateFrontmatter` 将新字段写入 SpecFrontmatter（仅在传入值时设置）
  - 文件：`src/core/single-spec-orchestrator.ts` — 在调用 `generateFrontmatter` 时传递 costMetadata
  - 文件：`src/generator/spec-renderer.ts`（如 frontmatter 用 Handlebars / 硬编码字段清单，在此同步输出）
  - 单测：确认 frontmatter YAML 输出包含新字段且可被 Zod 再解析回 object

- [ ] **T4 — Batch 聚合成本**
  - 文件：`src/batch/batch-orchestrator.ts`
  - 采集 `GenerateSpecResult.costMetadata`，写回 `state.completedModules[i].costMetadata`
  - 在 `runBatch` 末尾聚合：`totalInputTokens`、`totalOutputTokens`、`totalDurationMs`、按模块 / 按生成器分组
  - 按生成器分组：`generator = result.costMetadata.llmModel || 'ast-only'`
  - 扩展 `BatchResult.costSummary`
  - 单测：`tests/batch/cost-aggregation.test.ts` 覆盖正常聚合、降级模块混入、零成本

- [ ] **T5 — batch-summary.md 加"LLM 成本汇总"节**
  - 文件：`src/batch/progress-reporter.ts`
  - `writeSummaryLog` 接收新参数 `costSummary?: CostSummary`
  - 若存在：追加 `## LLM 成本汇总` 节（总 input / output tokens、总耗时、按模块分组明细表从高到低、按生成器分组）
  - 向后兼容：`costSummary` 未传时不改变原输出
  - 文件：`src/batch/batch-orchestrator.ts` — 调用 `writeSummaryLog` 时传入 costSummary
  - 单测：验证 section 生成、无数据时跳过

- [ ] **T6 — quality-report.md 加"LLM 成本与预算"节**
  - 文件：`src/panoramic/pipelines/docs-quality-evaluator.ts`（或 quality-report 渲染点）
  - 接收 costSummary，渲染小节：总成本、按生成器占比、tokens/kLOC 性价比
  - 若预估值存在且偏差 > 20%：加 `⚠ 估算偏差超 20%`
  - 文件：`src/batch/batch-orchestrator.ts` — 把 costSummary 传给 quality 生成入口
  - 单测：断言 section 存在性 + 偏差告警

- [ ] **T7 — README.md 加图摘要（God Nodes + Surprising Connections）**
  - 文件：`src/batch/batch-readme-generator.ts`
  - `generateBatchReadme` 新增输入：`outputDir`（已有）下读 `_meta/graph.json` 和 `_meta/GRAPH_REPORT.md`
  - 从 graph.json `nodes[].metadata.degree` 取 top 5 作为"代码核心抽象"
  - 从 `GRAPH_REPORT.md` 解析"Surprising Connections"表格取前 3 条
  - 插入位置：在"产品与使用"之后、"架构与接口"之前
  - 每条带链接到 `specs/_meta/GRAPH_REPORT.md#god-nodes` / `#surprising-connections`
  - 在"架构与接口"末尾追加"### 图查询能力"小节，列出 5 个 MCP 工具名称和一句话用途，指向 SKILL.md
  - 优雅降级：graph.json 或 GRAPH_REPORT.md 缺失时展示"图谱未生成，运行 `spectra batch` 后可用"
  - 单测：`tests/batch/readme-graph-summary.test.ts` 覆盖有图 / 无图两条路径

- [ ] **T8 — SKILL.md 补全 MCP 图查询工具文档**
  - 文件：`plugins/spectra/skills/spectra-batch/SKILL.md`
  - 文件：`plugins/spectra/skills/spectra/SKILL.md`
  - 各追加一节"图查询工具（MCP）"：列出 5 个工具（`graph_query` / `graph_node` / `graph_path` / `graph_community` / `graph_god_nodes`），每个含名称、一句话用途、典型调用参数示例、预期输出形态示例
  - 验证：Grep 确认两个 SKILL.md 都含 `graph_god_nodes` 等 5 个工具名

- [ ] **T9 — BatchOptions 新增 dryRun / budget / onOverBudget + 预估模型**
  - 文件：`src/batch/batch-orchestrator.ts`
  - `BatchOptions` 新增 `dryRun?: boolean`、`budget?: number`、`onOverBudget?: 'continue'|'cheaper-model'|'skip-enrichment'|'cancel'`
  - 新增内部 helper `estimateBatchCost(processingOrder, moduleGroups)`：遍历模块，对每个模块的 AST 上下文用 `estimateFast` 算 input tokens；output 用 `Math.round(input * 0.3)`
  - 若 `dryRun`：在 AST + 模块分组完成后，直接写 `_meta/dry-run-estimate.md`（含每模块/每生成器预估、总预估、预估假设 "output ≈ 0.3 × input"）并早停；**不**生成 spec 文件
  - 单测：`tests/batch/dry-run.test.ts` 验证未调用 LLM、报告生成、无 spec 文件写入

- [ ] **T10 — 预算守护 gate**
  - 文件：`src/batch/batch-orchestrator.ts`
  - 非 dryRun 下若传了 `budget`：AST 完成后先跑 `estimateBatchCost`，与 budget 比较
  - 超预算时调用 handler：
    - TTY + 未传 `onOverBudget`：通过 `readline` 提示选择 4 个 policy
    - 非 TTY 未传 policy：视为 `cancel`（返回 BatchResult with `costSummary.estimated` 和 note，**不**跑 LLM）
    - `continue`：照跑
    - `cheaper-model`：将全局 `modelOverride` 设为 sonnet，重新估算；若仍超预算，最多再提示 1 次（Edge Case 8）
    - `skip-enrichment`：全局设 `skipEnrichment = true`，重新估算
    - `cancel`：立即返回，不跑 LLM
  - 记录到 `costSummary.estimated`，正常完成后对比 actual 与 estimated，偏差 > 20% 设 `actualVsEstimatedDelta`
  - 单测：覆盖 4 个 policy + 非 TTY 默认 cancel + 二次超限

- [ ] **T11 — CLI 参数 `--dry-run` / `--budget` / `--on-over-budget`**
  - 文件：`src/cli/utils/parse-args.ts`
  - `batch` 子命令解析 3 个新 flag；`--budget <N>` 复用 `extractPositionalArgs` 的带值选项白名单（已含 `--budget`）
  - `--on-over-budget` 需追加到带值选项白名单
  - 新增 `CLICommand` 字段：`dryRun?: boolean`、`batchBudget?: number`、`onOverBudget?: string`
  - 文件：`src/cli/commands/batch.ts`
  - 把 3 个 flag 传入 `runBatch`
  - 文件：help 文本（同文件或独立 help）更新
  - 单测：`tests/cli/parse-args.test.ts` 加若干用例

- [ ] **T12 — 全量验证**
  - `npx vitest run` 全绿（除 pre-existing `export-command.test.ts`）
  - `npm run build` 零 error
  - 在 `_reference/graphify/worked/example/raw/` 上手动跑三个场景：
    1. `spectra batch --dry-run` → 产出 `_meta/dry-run-estimate.md`，无 spec 文件
    2. `spectra batch --budget 100 --on-over-budget cancel` → 立即返回
    3. 正常 `spectra batch` → 产物含所有新字段
  - 把证据（输出样例）写入 `specs/127-reveal-cost-transparency/verification/verification-report.md`

## 阶段 Commit 点

| 阶段 | 合并 Commit 范围 | 建议 message |
|------|------------------|--------------|
| A | T1 | `feat(127): extend frontmatter schema with cost fields` |
| B | T2 + T3 | `feat(127): capture and persist LLM cost metadata per spec` |
| C | T4 + T5 + T6 | `feat(127): aggregate batch cost + summary/quality report sections` |
| D | T7 + T8 | `feat(127): surface graph capabilities in README + SKILL.md` |
| E | T9 + T10 + T11 | `feat(127): dry-run + budget enforcement CLI` |
| F | T12 | `docs(127): verification report for F1 Reveal & Cost Transparency` |

## 依赖说明

- T2/T3 依赖 T1（schema 先行）
- T4 依赖 T2（需要 costMetadata 返回）
- T5/T6 依赖 T4（需要聚合后的 costSummary）
- T7 / T8 彼此独立，也独立于成本链
- T9/T10/T11 彼此强相关，放一起提交
- T12 在所有任务完成后
