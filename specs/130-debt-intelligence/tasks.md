---
feature: F3 Debt Intelligence — 技术债引擎
phase: tasks
branch: 130-debt-intelligence
total_tasks: 14
parallelizable: [T3-T6]
---

# F3 任务分解

每个任务标注：优先级 / 预估 LoC（源+测试）/ 依赖关系。

## T1 — 新增 types 与 git-blame utility 【P1，~150 LoC】
**依赖**：无
**产物**：
- `src/debt-scanner/types.ts` — CodeDebtEntry / OpenQuestionEntry / DebtReport / DebtDiagnostics / DebtMetrics / CommentRegion
- `src/utils/git-blame.ts` — getLineBlame + 文件级缓存
- `tests/utils/git-blame.test.ts` — uncommitted fallback、porcelain 解析、缓存命中
**验收**：`npx vitest run tests/utils/git-blame.test.ts` 零失败

## T2 — LanguageAdapter.extractComments 接口扩展 【P1，~40 LoC】
**依赖**：T1（CommentRegion 类型）
**产物**：
- `src/adapters/language-adapter.ts` 新增 `extractComments?(filePath): Promise<CommentRegion[]>`
- 更新接口注释
**验收**：`npm run build` 零错误

## T3 — TypeScript adapter extractComments 实现 【P1，~120 LoC】 [并行]
**依赖**：T2
**产物**：
- `src/adapters/ts-js-adapter.ts` 实现 extractComments（ts-morph SourceFile + getLeadingCommentRanges + getTrailingCommentRanges，去重按 pos）
- `tests/adapters/ts-js-extract-comments.test.ts` — fixture：含行注释/块注释/字符串里的 "TODO"/JSDoc
**验收**：所有字符串字面量内的"TODO"不被提取

## T4 — Python adapter extractComments 实现 【P1，~100 LoC】 [并行]
**依赖**：T2
**产物**：
- `src/adapters/python-adapter.ts` 实现（tree-sitter-python query `(comment) @c`）
- `tests/adapters/python-extract-comments.test.ts`
**验收**：docstring 不被识别为 `comment`（Python AST 把 docstring 当 `string`，天然排除）

## T5 — Go adapter extractComments 实现 【P1，~80 LoC】 [并行]
**依赖**：T2
**产物**：
- `src/adapters/go-adapter.ts` 实现（tree-sitter-go `(comment) @c`）
- `tests/adapters/go-extract-comments.test.ts`

## T6 — Java adapter extractComments 实现 【P1，~100 LoC】 [并行]
**依赖**：T2
**产物**：
- `src/adapters/java-adapter.ts` 实现（tree-sitter-java `(line_comment) @c (block_comment) @c`）
- `tests/adapters/java-extract-comments.test.ts`

## T7 — 代码注释债务核心模块 【P1，~250 LoC】
**依赖**：T1、T2（至少 TS adapter 实现）
**产物**：
- `src/debt-scanner/comments/debt-classifier.ts` — 正则分类 + severity 映射
- `src/debt-scanner/comments/symbol-resolver.ts` — 利用 `CodeSkeleton.symbols` 找最近 enclosing symbol（按行范围）
- `src/debt-scanner/comments/index.ts` — `scanCodeComments(files, adapters, gitBlame)` 主函数
- `tests/debt-scanner/debt-classifier.test.ts`
- `tests/debt-scanner/symbol-resolver.test.ts`
**验收**：
- TODO/FIXME/HACK/XXX/NOTE 分类正确
- 带括号的 `TODO(connor):` 正常解析
- 多行块注释内的多个 TODO 各自独立

## T8 — Design-doc 发现与规则命中 【P1，~200 LoC】
**依赖**：T1
**产物**：
- `src/debt-scanner/design-docs/doc-discoverer.ts` — glob README/architecture/notes/design (case-insensitive, 一级子目录)
- `src/debt-scanner/design-docs/markdown-sections.ts` — heading tree + paragraph（简化实现，不依赖重型解析器）
- `src/debt-scanner/design-docs/rule-detector.ts` — 显式标记（TBD/待定/open question/tradeoff）+ 问号结尾段落识别
- `src/debt-scanner/design-docs/index.ts` — `detectOpenQuestions(projectRoot)` 返回候选
- `tests/debt-scanner/doc-discoverer.test.ts`
- `tests/debt-scanner/rule-detector.test.ts`
**验收**：graphify 示例的 notes.md 被识别出 ≥ 3 个 open question 候选

## T9 — LLM 主题推断与 budget 集成 【P1，~180 LoC】
**依赖**：T8
**产物**：
- `src/debt-scanner/design-docs/llm-topic-inferrer.ts` — 批量 prompt + JSON response 解析 + budget 检查
  - 注入 `LLMClient`（默认用 `src/core/llm-client.ts` 的 `callLLM`）
  - 每次 batch 调用前估算 token；若 `budgetLimit` 提供且估算 > 剩余 budget，降级为 `fallbackReason='budget-exhausted'`
  - `dryRun === true` → 跳过 LLM 调用，`fallbackReason='dry-run'`
- `tests/debt-scanner/llm-topic-inferrer.test.ts` — 用 StubLLMClient 测试
**验收**：StubLLMClient 返回 mock JSON，主题被正确赋值；dry-run 路径不调用 client

## T10 — Report builder + quality-report patcher + readme indexer 【P2，~250 LoC】
**依赖**：T7、T8、T9
**产物**：
- `src/debt-scanner/aggregator/report-builder.ts` — 生成 technical-debt.md（frontmatter + 概要 + 明细 + 引用）
- `src/debt-scanner/aggregator/quality-report-patcher.ts` — 追加 "## 技术债" 节（幂等：已存在则替换）
- `src/debt-scanner/aggregator/readme-indexer.ts` — specs/README.md "质量审计" 节插入链接（若存在）
- `src/debt-scanner/index.ts` — 暴露 `scanProjectDebt`
- `tests/debt-scanner/report-builder.test.ts` — 空状态 / 少量 / 大量 / 排序稳定
- `tests/debt-scanner/quality-report-patcher.test.ts` — 已存在节替换 / 不存在文件跳过
- `tests/debt-scanner/readme-indexer.test.ts`
**验收**：
- 空状态输出"未识别出技术债"
- 代码债务条目按 (severity, age desc, file, line) 稳定排序

## T11 — Pipeline 入口与 batch-orchestrator 集成 【P1，~150 LoC】
**依赖**：T10
**产物**：
- `src/panoramic/pipelines/debt-intelligence-pipeline.ts` — `generateDebtIntelligence(options)`
- `src/batch/batch-orchestrator.ts` 修改：
  - `BatchOptions` 新增 `enableDebtIntelligence?: boolean`（默认 true）
  - `BatchResult` 新增 `debt?: DebtPipelineResult`
  - `runBatch` 在 docs bundle 之后调用 `generateDebtIntelligence`
  - cost summary 集成 debt 的 tokenUsage
- `tests/panoramic/pipelines/debt-intelligence-pipeline.test.ts`
**验收**：集成测试 runBatch 对 tmp fixture 跑通，输出 technical-debt.md 且 BatchResult.debt 非 undefined

## T12 — 集成测试：graphify 示例（正向） 【P1，~120 LoC】
**依赖**：T11
**产物**：
- `tests/integration/debt-on-graphify.test.ts`：
  - 目标：`_reference/graphify/worked/example/raw/`
  - 断言：
    - `<tmpSpecsDir>/project/technical-debt.md` 存在
    - 读取并断言 open questions ≥ 3
    - 如果 graphify 示例源文件中含 TODO（需验证），代码债务条目存在
  - LLM 使用 StubLLMClient（避免真实 API 依赖）
**验收**：该测试通过

## T13 — 集成测试：诚实降级（空状态） 【P1，~80 LoC】
**依赖**：T11
**产物**：
- `tests/integration/debt-empty-project.test.ts`：tmp dir，仅 `hello.ts` 无注释 + 无 .md
- `tests/integration/debt-no-design-doc.test.ts`：tmp dir，`foo.ts` 含 TODO，无任何 .md
**验收**：两个测试通过，输出文档包含"未识别出技术债"或"未识别出开放问题"对应文案

## T14 — 全量回归 + repo:check + release:check 【P1，~0 LoC】
**依赖**：T1-T13 全部完成
**产物**：无代码变更，仅运行验证
**验收**：
- `npx vitest run` 零新增失败（pre-existing `export-command.test.ts` 失败允许）
- `npm run build` 零错误
- `npm run repo:check` 零告警
- `npm run release:check` 零告警

---

## 并行执行策略

- T3/T4/T5/T6 可并行（4 个 adapter 的实现互不依赖），但实际由 implement agent 按顺序完成更稳妥
- 其它 tasks 按依赖链串行

## 退出标准

- 全部任务的 tests 通过
- 代码行数实际 ≤ 计划（+30% 容差）
- 3 个集成测试（graphify、empty、no-design-doc）全绿
- Implement agent 返回时附一份变更文件清单 + 每个 task 的完成状态

## 可控性提醒

如 T10-T11 实际实现偏离 plan.md（如 quality-report-patcher 需要更复杂的 AST 处理），implement agent 必须在 implementation-notes.md 中记录偏离原因 + 新方案，不允许静默重构。
