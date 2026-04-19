---
feature: F3 Debt Intelligence — 技术债引擎
phase: implement
branch: 130-debt-intelligence
---

# F3 实施笔记

记录 plan.md 之外的偏差、取舍与边界发现。

## 1. LLM 客户端抽象（偏离 plan.md §2 / §3.2）

**计划**：`llm-topic-inferrer.ts` 直接引用 `src/core/llm-client.ts` 的 `callLLM`。

**实际**：引入轻量 `SimpleLLMClient` 接口（位于
`src/debt-scanner/design-docs/llm-topic-inferrer.ts`）并在
`src/debt-scanner/llm-clients.ts` 提供两个实现：
- `AnthropicLLMClient`：生产用，直接包装 `@anthropic-ai/sdk`
- `StubLLMClient`：测试用

**理由**：
- 现有 `callLLM` 以 `AssembledContext`（含固定 spec-generation system prompt）为输入契约，不适配 JSON 分类任务。
- 新抽象可注入，保证单元测试与集成测试（T12）完全不依赖网络。
- 零额外运行时依赖（Anthropic SDK 已在 dependencies 中）。

## 2. batch-orchestrator 集成点

插入位置：`generateDocsQualityReport` 之后、`writeSummaryLog` 之前。

**好处**：quality-report.md 此时已生成，patcher 可以直接追加 "## 技术债" 节；同一批次 cost summary 在 writeSummaryLog 之前重新聚合，包含 debt tokenUsage。

**取舍**：未提前到 `generateBatchProjectDocs` 之后，避免 quality-report 还未生成时就无效追加。

## 3. CodeSkeleton.symbols 实际字段名为 `exports`

**计划**：plan.md §3.1 引用 `CodeSkeleton.symbols`。

**实际**：字段名为 `exports`（`src/models/code-skeleton.ts`），每项含 `startLine`/`endLine`。symbol-resolver 基于此实现，选择范围最小的 export 作为 enclosing 符号近似值。

## 4. Adapter extractComments 的共享实现

**计划**：每个 adapter 独立实现。

**实际**：Python/Go/Java 三个 tree-sitter 后端共用 `src/adapters/tree-sitter-comment-extractor.ts` 的辅助工具；只是 grammar 名称 + 注释节点类型不同。

**理由**：避免三处粘贴复制，保持行为一致性。AC-1.2（字符串字面量内 "TODO" 不被误识别）依赖于 tree-sitter grammar 天然将 string 与 comment 分开的特性，对三种语言都适用。

TS/JS adapter 单独用 ts-morph 实现（和共享工具用不同的后端）。

## 5. LLM candidate 对齐策略

`inferOpenQuestionTopics` 让 LLM 在每条结果里 echo `key` 字段（文档路径 + snippet），便于回填。因为 snippet 在 makeSnippet 时可能被截断，生产实现要求 LLM 原样回传 `key`。测试用 StubLLMClient 手动构造 key，验证回填正确。

## 6. 代码债务密度（densityPerKloc）

计算方式：`codeEntries.length / totalLoc * 1000`，其中 `totalLoc` 是扫描过的所有源文件行数之和（来自 `scanCodeComments` 的累加）。

## 7. 年龄分布桶 [<30, 30-90, 90-180, >180]

`renderSummary` 使用独立计算（与 metrics 的 oldestAgeDays 解耦），确保桶边界明确。

## 8. 测试 include 范围调整

`vitest.config.ts` unit 项目 include 列表添加 `tests/utils/**/*.test.ts` 与 `tests/debt-scanner/**/*.test.ts`，原先两条路径未覆盖。

## 9. 诚实降级路径总览

| 场景 | 行为 | fallbackReason |
|------|------|----------------|
| 无 llmClient | 跳过 LLM，仅显式命中进入结果 | no-llm-client |
| dryRun=true | 跳过 LLM | dry-run |
| budget 不足 | 跳过 LLM | budget-exhausted |
| LLM 调用异常 | 捕获，降级为 budget-exhausted | budget-exhausted |
| adapter 无 extractComments | 跳过文件并计数 | — |
| 非 git repo 或未 commit | 所有 blame 返回 uncommitted/0 | — |

## 10. 验收情况

- T1-T14 全部完成
- `npx vitest run`：191 test files / 1841 tests 全部 pass（包括原先标记为 flaky 的 `tests/cli/export-command.test.ts`）
- `npm run build`：零类型错误
- `npm run repo:check` / `npm run release:check`：pass
- AC-1.1~AC-1.5：通过 adapter 扩展 + AST 识别 + git-blame fallback 实现
- AC-2.1~AC-2.7：doc-discoverer + rule-detector + llm-topic-inferrer + 全降级路径实现
- AC-3.1~AC-3.4：report-builder / quality-report-patcher / readme-indexer 实现
- AC-4.1~AC-4.3：quality-report-patcher 实现；AC-4.4 跨 batch 差值未实现（符合 spec 的可选条款）
