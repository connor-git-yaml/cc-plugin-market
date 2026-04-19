# Implementation Plan: Reveal & Cost Transparency

**Branch**: `127-reveal-cost-transparency` | **Date**: 2026-04-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/127-reveal-cost-transparency/spec.md`

## Summary

F1 是表层能力暴露 Feature，不重构架构。目标：
1. 把现有图能力（5 个 MCP 图查询工具 + `_meta/GRAPH_REPORT.md` 的 God Nodes / Surprising Connections）浮到 `specs/README.md` 首屏，并在 SKILL.md 中显式列出。
2. 把 LLM 成本数据（已由 `LLMResponse` 暴露）从单模块 spec frontmatter 一直沉淀到 `batch-summary-*.md` 和 `quality-report.md`，做成可审计的成本链路。
3. 提供 `--dry-run`（仅预估）和 `--budget <N>` 两个 CLI / MCP 参数，支持 CI 预算守护。

技术方案以"薄增强"为原则：所有新字段 optional 向后兼容；渲染层仅新增 section，不改既有 section；LLM 客户端已返回 `inputTokens/outputTokens/duration/model`，无需改底层 SDK。

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20.x+
**Primary Dependencies**: `@anthropic-ai/sdk`（已在用）、`zod`（已在用）、`graphology`（已在用，经由 `GraphQueryEngine`）、`@modelcontextprotocol/sdk`（已在用）
**Storage**: 文件系统（`specs/**.spec.md`、`specs/_meta/graph.json`、`specs/_meta/batch-summary-*.md`、`specs/README.md`、`specs/project/quality-report.md`）
**Testing**: `vitest`（现有测试套件全部通过）
**Target Platform**: CLI（Node.js）+ MCP server
**Project Type**: single（monorepo 共享 `src/` 源码）
**Performance Goals**: dry-run 耗时 ≤ 实际 batch 的 5%（spec SC-004）；对已有 batch 不引入可观测性能退化
**Constraints**: 向后兼容（spec SC-006）— 缺失成本字段的历史 spec 正常读取；批测试套件不改 fixture 全通过
**Scale/Scope**: 单次 batch 最多覆盖 ~200 个模块；成本字段聚合 O(N) 扫描；`_meta/graph.json` 单文件可完整加载

## Constitution Check

- **原则 VIII（源码优先修改 src/**）**：所有改动都在 `src/**`、`plugins/**`、`specs/**`；不触碰 `.claude/commands/**` 包装层（归 F2.5 清理）
- **原则 IX（不新增运行时依赖）**：PASS — 复用现有 `anthropic-sdk`、`zod`、`graphology`
- **原则 X（不绕过质量门）**：PASS — 每阶段 commit 前跑 `npx vitest run` 和 `npm run build`
- **语言规范**：正文中文、标识符英文、frontmatter YAML key 英文（新增 `tokenUsage` / `durationMs` / `llmModel` / `fallbackReason`）
- **边界约束**：严守 F2 领地（`src/batch/batch-orchestrator.ts` 里 `sourceKind` 相关字段不碰）

## Project Structure

### Documentation (this feature)

```text
specs/127-reveal-cost-transparency/
├── spec.md                    # 已存在
├── plan.md                    # 本文件
├── tasks.md                   # Phase 3 产出
├── checklists/
│   └── requirements.md        # 已存在
└── verification/
    └── verification-report.md # Phase 5 产出
```

### Source Code (repository root)

本 Feature 影响 5 条路径：

1. **frontmatter schema + 生成器**
   - `src/models/module-spec.ts` — 扩展 `SpecFrontmatterSchema` 和 `CompletedModuleSchema`
   - `src/generator/frontmatter.ts` — 写入新字段
   - `src/core/single-spec-orchestrator.ts` — 采集 `inputTokens/outputTokens/duration/model/fallbackReason` 并传递
   - `src/generator/spec-renderer.ts`（若 frontmatter 渲染硬编码字段清单，在此同步）
2. **batch 聚合 + 汇总/质量报告**
   - `src/batch/batch-orchestrator.ts` — 采集每个模块的 cost，写回 `state.completedModules`
   - `src/batch/progress-reporter.ts` — `writeSummaryLog` 新增"LLM 成本汇总"
   - `src/panoramic/pipelines/docs-quality-evaluator.ts`（或 quality-report 渲染点）— 新增"LLM 成本与预算"
3. **README 图摘要**
   - `src/batch/batch-readme-generator.ts` — 读 `_meta/graph.json` + `_meta/GRAPH_REPORT.md` 拼"代码核心抽象"+"意外连接"两节 + MCP 工具入口指引
4. **dry-run + budget**
   - `src/batch/batch-orchestrator.ts` — 新增早停/预估分支
   - `src/cli/utils/parse-args.ts`、`src/cli/commands/batch.ts` — `--dry-run`、`--budget <N>`、`--on-over-budget <policy>`
   - MCP 入口（若已有批处理 tool；若无，跳过，延到独立 Feature）
5. **SKILL.md**
   - `plugins/spectra/skills/spectra/SKILL.md`
   - `plugins/spectra/skills/spectra-batch/SKILL.md`
   - 两个文件各增一节"图查询工具（5 个 MCP 工具）"

测试位于 `tests/`（既有 vitest 套件）。新增单测：
- `tests/models/frontmatter-cost.test.ts` 断言新字段 parse/serialize
- `tests/batch/readme-graph-summary.test.ts`
- `tests/batch/cost-aggregation.test.ts`
- `tests/batch/dry-run.test.ts`

## Phase 0: Research

### 已调研点（spec 已覆盖）

- **Token 来源**：`LLMResponse.inputTokens` / `outputTokens` / `duration` / `model` 已由 `src/core/llm-client.ts:39-50` 暴露。不需要重新实现 tokenization
- **图产物**：`_meta/GRAPH_REPORT.md` 由 `src/panoramic/community/graph-report-generator.ts` 生成，`God Nodes` 和 `Surprising Connections` 已经是结构化 section。`_meta/graph.json` 由 `writeKnowledgeGraph` 持久化，含 `metadata.degree`、`metadata.community`
- **5 个 MCP 工具定义**：`src/mcp/graph-tools.ts:77-229`（`graph_query` / `graph_node` / `graph_path` / `graph_community` / `graph_god_nodes`）

### 新研究项（决策）

| 问题 | 决策 | 备选 |
|------|------|------|
| 预估模型 | 用 `estimateFast(context.prompt)` 算 input；output 硬编码 `0.3 * input` 作为首版比率；后续可迭代 | 跑真正 LLM 前置采样（成本高，不做） |
| 预算超限策略值 | 枚举 `continue` / `cheaper-model` / `skip-enrichment` / `cancel` | 自定义 handler（过度工程，不做） |
| 交互 vs 非交互 | 未传 `--on-over-budget` 且 TTY 时走 readline 交互；非 TTY 时必须显式传 policy，否则等同 `cancel` | 强制非交互（不够友好，不做） |
| 二次超限循环防护 | 降级重估后仍超预算时，最多允许再选一次，第二次超限默认 `cancel` | 无限循环（Spec Edge Case 8 禁止） |
| `LLMResponse.duration` 单位 | 保持 ms（现有实现） | 切秒（破坏性，不做） |

### 不做的事

- 不改 LLM SDK 调用方式
- 不改图分析算法（F2 修 128 已涵盖 bundle 污染）
- 不做交互式 `graph.html`
- 不优化 LLM 成本本身（只记录）

## Phase 1: Design & Contracts

### 数据模型（合约）

**SpecFrontmatter 新增（全 optional）**：

```typescript
tokenUsage?: {
  input: number;   // LLMResponse.inputTokens
  output: number;  // LLMResponse.outputTokens
};
durationMs?: number;  // LLMResponse.duration + enrichment duration（总和）
llmModel?: string;    // LLMResponse.model 实际使用的 ID
fallbackReason?: string | null;  // "LLM 不可用" | "被显式跳过" | "context 超限" | null
```

**CompletedModuleSchema 扩展（兼容旧字段 `tokenUsage: number`）**：

```typescript
costMetadata?: {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  llmModel: string;
  fallbackReason: string | null;
};
```

旧 `tokenUsage: z.number().int().nonnegative().optional()` 字段保留用于向后兼容读取历史 checkpoint。

**BatchResult 扩展**：

```typescript
costSummary?: {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  byModule: Array<{ moduleName: string; input: number; output: number; duration: number; model: string }>;
  byGenerator: Array<{ generator: string; input: number; output: number; share: number }>;
  estimated?: { totalInput: number; totalOutput: number };  // dry-run / budget 场景
  actualVsEstimatedDelta?: number;  // 百分比，超 20% 告警
};
```

**BatchOptions 扩展**：

```typescript
dryRun?: boolean;         // FR-011
budget?: number;          // FR-013
onOverBudget?: 'continue' | 'cheaper-model' | 'skip-enrichment' | 'cancel';  // FR-014
```

### 契约产物

- 无新 API 契约。CLI 契约在 `src/cli/commands/batch.ts` 的 help 文本更新
- MCP 契约：现有 5 个图工具已存在，仅在 SKILL.md 显式文档化

### Quickstart

```bash
# 仅预估，不调用 LLM
spectra batch _reference/graphify/worked/example/raw --dry-run

# 正常跑，预算守护 + 非交互策略
spectra batch _reference/graphify/worked/example/raw --budget 5000 --on-over-budget skip-enrichment

# 查看输出
cat specs/README.md                                          # 首屏应有"代码核心抽象"+"意外连接"
head specs/modules/*.spec.md | grep tokenUsage               # frontmatter 应有新字段
cat specs/_meta/batch-summary-*.md | grep "LLM 成本汇总" -A 30
cat specs/project/quality-report.md | grep "LLM 成本与预算" -A 20
```

## Phase 2: Task Breakdown

顶层任务由 `tasks.md` 承载，本 plan 不展开。轮廓：

1. **Schema 扩展**：`SpecFrontmatterSchema` + `CompletedModuleSchema` + 新类型
2. **采集层**：`generateSpec` 返回结构化 `costMetadata`
3. **写入层**：`frontmatter.ts` + renderer
4. **Batch 聚合**：`batch-orchestrator` 收集每模块 costMetadata
5. **README 图摘要**：读 graph.json + GRAPH_REPORT.md 渲染
6. **batch-summary.md**：加 LLM 成本节
7. **quality-report.md**：加 LLM 成本与预算节
8. **SKILL.md**：两个 SKILL.md 加 MCP 工具节
9. **dry-run 分支**：batch-orchestrator 早停 + 预估报告
10. **预算守护**：AST 完成后 gate
11. **CLI**：新增 3 个 flag
12. **测试**：vitest 单测覆盖每个关键路径

## Verification Plan

**Gate 1 — 单元测试**：
- `npx vitest run` 全绿（除 pre-existing `export-command.test.ts` 失败外）
- 新增 ≥ 6 个 test 覆盖 frontmatter schema / 聚合 / dry-run / budget / README

**Gate 2 — 类型检查**：
- `npm run build` 零 error

**Gate 3 — 集成验证**：在 `_reference/graphify/worked/example/raw/` 上跑：
- `spectra batch --dry-run` 产出 `specs/_meta/dry-run-estimate.md`，无 LLM 调用
- `spectra batch --budget 5000 --on-over-budget skip-enrichment` 触发降级
- 正常 `spectra batch` 后：
  - `specs/README.md` 首屏包含"代码核心抽象"+"意外连接"
  - 每个 module spec frontmatter 有 `tokenUsage / durationMs / llmModel`
  - `_meta/batch-summary-*.md` 有"LLM 成本汇总"
  - `project/quality-report.md` 有"LLM 成本与预算"

**Gate 4 — 向后兼容**：
- 既有 batch 测试 fixture 不改，测试全通过（spec SC-006）

## Rollback / Risk

- **R1 — 预估失真**：首版假设 `output ≈ 0.3 * input`，可能偏离 > 30%。缓解：spec SC-004 只要求单模块偏差 ≤ 30%；超出时 quality-report 显式标注"估算可靠性低"
- **R2 — graph.json 缺失**：用户未启用 graph-persistence 时首屏图摘要无数据。缓解：优雅降级展示"图谱未生成，运行 `spectra batch` 后可用"
- **R3 — MCP 批处理 tool 不存在**：若仓库当前没有 `batch` MCP tool，`FR-016` 部分降级为"CLI-only"，在 spec verification 中说明

## Out of Scope

见 spec.md "Out of Scope"。本 plan 额外明确：

- **不做 MCP batch tool 新增**（如果当前不存在）— 留给下一个 Feature
- **不做 graph.html 交互可视化** → F5
- **不做 cost historical DB**（连续多次 batch 的历史成本比较只做"本次 vs 上次"，不做跨次累积）
