# Phase 2 Postmortem — 问题修复报告

**Feature**: 133-fix-postmortem-phase2
**Branch**: claude/angry-northcutt-9c6647
**Date**: 2026-04-26
**Mode**: spec-driver fix（quality-first preset / opus）

## 问题描述

Phase 2（F1/F2/F2.5/F3/F4/F5 已交付）整合后，2154/2155 单元测试全过，但在 graphify 示例项目（5 Python 文件）真实 E2E 跑 `spectra batch --mode=reading --html` 时出现 5 个集成回归 bug：

| ID    | 严重 | 现象 |
|-------|------|------|
| P0-1  | 🔴   | 所有 module spec frontmatter 的 `tokenUsage: { input: 0, output: 0 }`，但 `durationMs` (3-4 分钟)、`llmModel: claude-opus-4-1-20250805` 都正常；`batch-summary.md` / `quality-report.md` 的 LLM 成本节误报"本次 batch 未调用 LLM"。|
| P0-2  | 🔴   | `--mode=reading` 实测耗时 1047s（vs 目标 <120s）；产品文档层（product-overview / user-journeys / architecture-narrative / event-surface / feature-briefs）和模块 spec 的 LLM enrichment 都没真跳过。|
| P0-3  | 🔴   | 用户决策：默认 model 应升级（Sonnet 4.5→4.6, Opus 4.1→4.7 1M），且 `balanced` preset 应映射到 sonnet（不再是 opus）。|
| P1-1  | 🟡   | graph.json 只含 8 条 cross-module 边，缺失 F4 承诺的 `references` / `conceptually_related_to` / `rationale_for` 边类型；hyperedges 数组为 0（已知该项目至少有一条"Full Ingestion Pipeline" hyperedge）。|
| P2-1  | 🟢   | 新生成的 canonical spec frontmatter 不显式写 `sourceKind`（缺省="canonical"行为正确，但用户看不到身份标签）。|

## 5-Why 根因追溯

### P0-1 — tokenUsage 全为 0

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | frontmatter 的 tokenUsage 为何写入 0？ | `costInputTokens / costOutputTokens` 累加值为 0 |
| Why 2 | 累加值为何为 0？ | `llmResponse.inputTokens / outputTokens` 始终为 0 |
| Why 3 | LLMResponse 为何返回 0？ | 用户在订阅 CLI 环境下走 `callLLMviaCliProxy → cliProxyCall`，proxy 解析 stream-json 时 token 字段读取失败 |
| Why 4 | 为何字段读取失败？ | `cli-proxy.ts:243-249` 把 `input_tokens / output_tokens` 当作 `type: "result"` message 的**顶层字段**读，但 Claude CLI 实际嵌套在 `usage.input_tokens / usage.output_tokens` 下 |
| Why 5 | 为何单测没拦住？ | `tests/auth/cli-proxy*.test.ts` 全部用 mock 流，使用了和实现相同的（错误的）顶层字段假设；没有真实 Claude CLI 集成测试覆盖 [ROOT CAUSE REACHED at Why 5] |

**Root Cause**: cli-proxy.ts 的 `StreamMessage` 类型定义和 `parseStreamJsonOutput` 解析逻辑都把 token 字段当作顶层字段，与 Claude CLI 实际 stream-json 输出格式（嵌套在 `usage` 下）不一致；mock 测试使用相同的错误假设导致单测全过却生产失败。

**Root Cause Chain**:
```
frontmatter.tokenUsage=0
  → costInputTokens=0
    → llmResponse.inputTokens=0
      → cli-proxy 解析 result 消息时取 msg.input_tokens 拿到 undefined
        → cli-proxy.ts L33-43 类型 + L243-249 解析逻辑把 token 当顶层字段
          → 但 Claude CLI 实际格式是 {usage: {input_tokens, output_tokens}}（嵌套）
            → mock 测试沿用错误顶层假设
```

旁证：
- `src/core/llm-client.ts:320-321`（SDK 路径）从 `response.usage.input_tokens` 读取 ✅
- `src/auth/codex-proxy.ts:233-235` 从 `event.usage.input_tokens` 读取 ✅
- 只有 `src/auth/cli-proxy.ts:243-249` 错误地从 `msg.input_tokens` 读取 ❌

### P0-2 — reading 模式没真正跳过该跳过的

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | reading 模式总耗时为何 1047s？ | 产品文档层（product-overview 等）+ 模块 spec enrichment 都还在跑 |
| Why 2 | 产品文档为何没跳？ | `READING_SKIP_IDS` 只列了 5 个 generator |
| Why 3 | 缺哪些 generator？ | 缺 `product-overview` `user-journeys` `architecture-narrative` `architecture-overview` `event-surface` `architecture-ir` `pattern-hints` `runtime-topology` `component-view` `dynamic-scenarios` `feature-briefs`（部分已在 CODE_ONLY_SKIP_IDS） |
| Why 4 | 模块 spec enrichment 为何不跳？ | `batch-orchestrator.ts:671-716` 调用 `generateSpec()` 时没有根据 `effectiveMode` 传 `skipEnrichment` |
| Why 5 | F5 spec 为何没拦住？ | F5 spec 主要关注 mode 参数引入和"跳过 Coverage Audit + Docs Bundle"，对"模块 spec enrichment 是否在 reading 模式下跳过"没有显式 SC 校验 [ROOT CAUSE REACHED at Why 5] |

**Root Cause A**: `src/panoramic/batch-project-docs.ts:90-96` 中 `READING_SKIP_IDS` 集合不完整。
**Root Cause B**: `src/batch/batch-orchestrator.ts:671-716` 调用 `generateSpec` 时不传 `skipEnrichment` 也不传 `modelOverride`，导致 reading 模式下模块 spec 仍按 full opus + enrichment 跑。

### P0-3 — 默认 model 过时 + balanced 默认走 Opus

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | balanced preset 为何映射到 opus？ | `PRESET_MODEL_MAP.balanced = 'opus'` 硬编码 |
| Why 2 | 模型 ID 为何是 4.5/4.1 旧版？ | `DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'`、`LOGICAL_CLAUDE_MODEL_MAP.opus = 'claude-opus-4-1-20250805'` |
| Why 3 | 为何不及时升级到 4.6/4.7？ | 历史决策：当 4.5/4.1 是当时最新；后续没建立"Anthropic 发布新版即升级"的同步机制 |
| Why 4 | 为何 balanced 选 opus？ | F1 时定的：质量优先；现在用户重新评估认为 sonnet 已足够强且便宜很多 |

**Root Cause**: `src/core/model-selection.ts:6-25` 的默认/逻辑/preset 映射常量过期。

### P1-1 — graph hyperedges + 新边类型为 0

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | graph.json 中 hyperedges 数组为何为空？ | `runHyperedgeIntegration` 没在 batch 路径中被调用 |
| Why 2 | 为何不被调用？ | `src/batch/batch-orchestrator.ts` 在 `buildKnowledgeGraph` 之前没有调用 `runHyperedgeIntegration`（grep 全仓没有任何调用方） |
| Why 3 | references/conceptually_related_to 为何缺失？ | `runAnchorIntegration` 同样从未被调用 |
| Why 4 | 为何 F4 commit 留下了集成接口但没接通？ | F4 实现了 `runAnchorIntegration` 和 `runHyperedgeIntegration` 作为公开 export，并写了"由 caller 从 SPECTRA_HYPEREDGES_ENABLED env + --hyperedges CLI 合并后传入"的注释，但没在 batch 编排器侧落地 caller |
| Why 5 | 为何没拦住？ | F4 单测验证了集成函数本身的正确性（可以接 mock 调用），但没有 batch E2E 测试验证 graph.json 实际写盘后含有 hyperedges 字段；2154 单测走的全是 mock 路径 [ROOT CAUSE REACHED at Why 5] |

**Root Cause**: `src/batch/batch-orchestrator.ts` 在图谱持久化流程中漏掉了对 `runAnchorIntegration` 和 `runHyperedgeIntegration` 的调用；F4 集成接口已就位但生产路径未接通。

### P2-1 — canonical spec 不显式写 sourceKind

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 新生成的 spec frontmatter 为何没有 sourceKind？ | `single-spec-orchestrator.ts:613-624` 调用 generateFrontmatter 时不传 sourceKind |
| Why 2 | 为何不传？ | F2 / F2.5 设计：缺省 = canonical，让 frontmatter 更紧凑 |
| Why 3 | 为何用户希望显式写？ | 提升可读性 + 让"派生/拷贝"和"原生"在 grep / 视觉扫描时一目了然（不依赖"无字段=canonical"的隐式约定） |

**Root Cause（设计选择）**: F2 选择隐式默认；本次根据用户反馈调整为显式写入。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/auth/cli-proxy.ts` | L33-50 | StreamMessage 类型把 token 当顶层 | 增加 `usage?: { input_tokens?, output_tokens? }` 嵌套类型，向后兼容旧顶层字段 |
| `src/auth/cli-proxy.ts` | L243-249 | parseStreamJsonOutput 读顶层 | 优先从 `msg.usage?.input_tokens` 读，回落到顶层 |
| `src/panoramic/batch-project-docs.ts` | L90-96 | READING_SKIP_IDS 不完整 | 扩展集合至产品文档全跳 |
| `src/batch/batch-orchestrator.ts` | L671-716 | generateSpec 不传 mode 衍生选项 | reading/code-only 时传 `skipEnrichment: true` |
| `src/batch/batch-orchestrator.ts` | L907-952 | 图谱持久化前没调 anchor + hyperedge 集成 | 在 buildKnowledgeGraph 前调用 `runAnchorIntegration` + `runHyperedgeIntegration`，把结果合并入 docGraph 或 graphJson |
| `src/core/model-selection.ts` | L6-25 | DEFAULT/LOGICAL/PRESET 常量过期 | 升级 Sonnet 4.6 / Opus 4.7 1M / balanced→sonnet |
| `src/core/single-spec-orchestrator.ts` | L613-624 | 未显式写 sourceKind | 显式传 `sourceKind: 'canonical'` |

### 类似模式（已评估为安全）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/auth/codex-proxy.ts` | L233-235 | 已正确从 `event.usage.input_tokens` 读取 | ✅ 安全 |
| `src/core/llm-client.ts` | L320-321 | 已正确从 `response.usage.input_tokens` 读取 | ✅ 安全 |
| `src/panoramic/hyperedges/extractor.ts` | L149-150 | 已正确从 `response.usage.input_tokens` 读取 | ✅ 安全 |

### 同步更新清单

- **测试**：必须新增的测试（避免再次出现 mock-only 通过、生产失败的问题）：
  - `tests/auth/cli-proxy.usage-extraction.test.ts`：单测验证 cli-proxy 能从嵌套 `usage` 字段提取 token，且兼容顶层字段（向后兼容）
  - `tests/integration/llm-client.integration.test.ts`：可选真实 SDK 调用（`vi.skipIf(!ANTHROPIC_API_KEY)`），验证完整 token 链路
  - `tests/batch/reading-mode.perf.test.ts`：reading 模式 E2E perf 回归（5 文件 fixture，超 threshold fail）
  - `tests/batch/graph-hyperedges.regression.test.ts`：batch 集成测试，断言 graph.json 含 ≥1 hyperedge + ≥3 条 references/rationale_for 边
  - `tests/core/model-selection.test.ts`：更新 expected model id

- **文档 / 配置**：
  - `CHANGELOG.md`：记 breaking change（默认 model 升级 + balanced→sonnet）
  - `docs/`：若存在涉及 model id 的示例，更新

- **运行时副作用**：
  - balanced→sonnet 后，原本依赖 balanced=opus 的下游测试 fixture（如 `tests/integration/spec-generation.test.ts` 类的 expected llmModel）需相应更新
  - 升级 Opus 4.7 1M 时，若 1M 上下文需要 beta header（`anthropic-beta: context-1m-2024-08-07` 或类似），需在 llm-client SDK 路径里按 model id 动态注入

## 修复策略

### 方案 A（推荐，分 5 批）

按依赖关系排序：

| 批次 | 范围 | 估算改动文件数 | 估算 LoC | 独立验证 |
|------|------|----------------|----------|----------|
| Batch 1 | P0-1 token 提取（`cli-proxy.ts` + 新单测 + 集成测试） | 3 | ~80 | `npx vitest run tests/auth/cli-proxy*` |
| Batch 2 | P0-3 model 升级（`model-selection.ts` + tests + CHANGELOG） | 3 | ~60 | `npx vitest run tests/core/model-selection*` |
| Batch 3 | P1-1 anchor + hyperedge 接通（`batch-orchestrator.ts` 注入两个 runner，加 perf-friendly 默认 flag） | 2 | ~120 | 新建 `graph-hyperedges.regression.test.ts` |
| Batch 4 | P0-2 reading 模式分派（`batch-project-docs.ts` SKIP_IDS 扩展 + `batch-orchestrator.ts` 传 skipEnrichment） | 2 | ~50 | 新建 `reading-mode.perf.test.ts` |
| Batch 5 | P2-1 sourceKind（`single-spec-orchestrator.ts` 一行 + 已有测试更新） | 2 | ~10 | `npx vitest run tests/generator/frontmatter*` |

每批独立 commit + push。每批完成后跑全量 `npx vitest run` 确认零新增失败。

### 方案 B（备选，一次性整合）

合并为一个大 commit。优点：单次 review；缺点：bisect 困难、回滚粒度粗、风险面集中。**不推荐**。

## Spec 影响

| Spec 文件 | 操作 |
|-----------|------|
| `specs/products/spectra/current-spec.md` | 视情况更新（默认 model 描述、reading 模式 SLA 数值） |
| `specs/132-reading-ux/spec.md` | 不动（已交付的历史 spec） |
| `specs/131-anchor-hyperedges-schema/spec.md` | 不动（已交付的历史 spec） |
| `specs/127-reveal-cost-transparency/spec.md` | 不动 |

本次 fix 不直接修改产品级 current-spec.md（会在 Phase 4 sync 阶段由 spec-review 子代理判断是否需要回填）。

## 范围检测

- 受影响源文件：6 个核心源文件 + 5 个新增/更新测试 = ~11 个
- 涉及模块：`auth/`, `core/`, `batch/`, `panoramic/anchoring`+`panoramic/hyperedges`, `generator/`
- 在快速修复模式可控范围内（< 10 模块），**保持 fix 模式继续推进**

## 端到端验证 ⚠ 重要约束

**graphify 示例项目不在仓库中**（`_reference/graphify/worked/example/raw/` 不存在）。

替代验证策略：
1. 创建最小 Python fixture 至 `tests/fixtures/graphify-mini/`（5 个 Python 文件，足够触发 reading 模式 SC-001）
2. 集成测试用此 fixture
3. verification 阶段在该 fixture 上执行 3 个场景（默认 / --mode=reading / --budget 5000），但 **不能保证耗时数字精准复现 1047s 原始症状**
4. 若用户希望严格复现原始 graphify，需用户单独提供 graphify 源（在 verification 阶段以人工 dry-run 方式补做）

## 后续步骤

进入 Phase 2（修复规划）：
1. 输出 plan.md 描述每批的具体改动 + 测试设计
2. 输出 tasks.md 拆分原子任务（每批 4-8 个任务）
3. Phase 2.5 GATE_DESIGN（fix 模式默认 auto-continue，仅展示摘要）
4. Phase 3 实施（5 批，每批独立 commit + push）
5. Phase 4 验证（spec-review + quality-review 并行 → verify）
