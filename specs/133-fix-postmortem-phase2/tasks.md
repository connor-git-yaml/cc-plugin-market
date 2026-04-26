# Phase 2 Postmortem — 原子任务清单

**Feature**: 133-fix-postmortem-phase2
**Total tasks**: 23（5 批）

> 注：每个 Batch 结束后必须独立 commit + push，不积累跨批改动。

## Batch 1: P0-1 token 提取（5 任务）

### T-001 修改 cli-proxy.ts StreamMessage 类型

**File**: `src/auth/cli-proxy.ts:33-50`
**Action**: 给 `StreamMessage` 接口新增嵌套 `usage?: { input_tokens?, output_tokens?, cache_creation_input_tokens?, cache_read_input_tokens? }`，保留旧顶层字段作为向后兼容
**Verify**: `npx tsc --noEmit src/auth/cli-proxy.ts`

### T-002 修改 parseStreamJsonOutput 解析逻辑

**File**: `src/auth/cli-proxy.ts:243-249`
**Action**: 在 `if (msg.type === 'result')` 分支内，优先从 `msg.usage?.input_tokens / output_tokens` 读取，回落到 `msg.input_tokens / output_tokens`（向后兼容）
**Verify**: 视觉 review；下一步单测验证

### T-003 新增单测 cli-proxy.usage-extraction.test.ts

**File**: `tests/auth/cli-proxy.usage-extraction.test.ts`（新建）
**Action**: 添加 4 个 case：
- case-nested：嵌套 `usage` 字段
- case-top-level：顶层字段（向后兼容）
- case-mixed：嵌套优先于顶层
- case-missing：无任何 token 字段时返回 0（不抛错）
**Verify**: `npx vitest run tests/auth/cli-proxy.usage-extraction.test.ts` 全绿

### T-004 新增真实 SDK 集成测试

**File**: `tests/integration/cli-proxy.real-stream.test.ts`（新建）
**Action**: 用 `describe.skipIf(!process.env['ANTHROPIC_API_KEY'])` 守卫，调用真实 Claude CLI，断言返回的 LLMResponse `inputTokens > 0 && outputTokens > 0`；模型用 Haiku 4.5（最便宜）
**Verify**: 在有 API Key 的本地环境跑过；CI 自动 skip

### T-005 Batch 1 commit + push

**Action**: 跑 `npx vitest run` + `npm run build` 全绿后，commit 并 push
**Commit message**: 见 plan.md Batch 1 commit message
**Verify**: `git log -1` 显示新 commit；`git status` clean

## Batch 2: P0-3 model 升级（4 任务）

### T-006 升级 model-selection.ts 常量

**File**: `src/core/model-selection.ts:6-47`
**Action**: 修改 4 处：
- L6: `DEFAULT_CLAUDE_MODEL` → `'claude-sonnet-4-6'`
- L10: `LOGICAL_CLAUDE_MODEL_MAP.opus` → `'claude-opus-4-7'`
- L22: `PRESET_MODEL_MAP.balanced` → `'sonnet'`
- L43-46: `DEFAULT_CODEX_ALIASES` 中：删除 `'claude-opus-4-6'` 入口或改为 `'claude-opus-4-7'`；新增 `'claude-sonnet-4-6'` 入口；保留旧条目作为兼容
**Verify**: `npx tsc --noEmit src/core/model-selection.ts`

### T-007 更新 model-selection 测试期望

**File**: `tests/core/model-selection.test.ts`
**Action**: 全文 grep `claude-sonnet-4-5-20250929` 替换为 `claude-sonnet-4-6`；`claude-opus-4-1-20250805` 替换为 `claude-opus-4-7`；balanced preset case 期望从 opus 改为 sonnet
**Verify**: `npx vitest run tests/core/model-selection*` 全绿

### T-008 更新 CHANGELOG.md

**File**: `CHANGELOG.md`
**Action**: 在顶部 `## [Unreleased]` 下新增 `### Breaking changes` 节，列出 model 升级 + balanced→sonnet 变更（文案见 plan.md Batch 2）
**Verify**: 视觉 review

### T-009 Batch 2 commit + push

**Action**: 跑 `npx vitest run` + `npm run build` 全绿后，commit 并 push
**Commit message**: 见 plan.md Batch 2 commit message（feat! breaking change）
**Verify**: `git log -1` 显示新 commit

## Batch 3: P1-1 anchor + hyperedge 集成（5 任务）

### T-010 调研 buildKnowledgeGraph 接口签名

**Action**: 读 `src/panoramic/persistence/` 或 `src/panoramic/builders/` 下 buildKnowledgeGraph 函数定义，确认是否已支持 `anchorEdges` / `hyperedges` 参数；如不支持则需扩展接口
**Verify**: 在 fix-report.md 或 plan.md 中已记录调研结果

### T-011 batch-orchestrator 注入 anchor + hyperedge runner

**File**: `src/batch/batch-orchestrator.ts`（约 L905 附近，buildKnowledgeGraph 调用前）
**Action**: 添加 `runAnchorIntegration` 和 `runHyperedgeIntegration` 调用，准备 docChunks（chunkMarkdownFiles）和 codeNodes，把结果合并入 graph 构建参数。降级保护：try/catch + warn 日志
**Verify**: `npx tsc --noEmit src/batch/batch-orchestrator.ts`

### T-012 新增 graphify-mini fixture（最小版）

**Dir**: `tests/fixtures/graphify-mini/`
**Action**: 新增 5 个 Python 文件（如 ingestion.py / parser.py / store.py / query.py / utils.py）+ 1 个 design doc（design/architecture.md）描述 ingestion pipeline；文件大小控制在 ~30 行/个
**Verify**: 文件存在；用 `python -c "import ast; ast.parse(open(p).read())"` 验证 Python 语法正确

### T-013 新增 graph-hyperedges 回归测试

**File**: `tests/batch/graph-hyperedges.regression.test.ts`（新建）
**Action**: 在 graphify-mini fixture 上跑 `runBatch` `mode: 'full'`，断言生成的 graph.json 含 `hyperedges.length >= 1` 和 `edges.filter(e => e.relation === 'references' || e.relation === 'rationale_for').length >= 1`
用 `describe.skipIf(!process.env['ANTHROPIC_API_KEY'])` 守卫
**Verify**: 在有 API Key 的本地环境跑过

### T-014 Batch 3 commit + push

**Action**: 跑 `npx vitest run` + `npm run build` 全绿后，commit 并 push
**Commit message**: 见 plan.md Batch 3 commit message
**Verify**: `git log -1` 显示新 commit

## Batch 4: P0-2 reading 模式真正跳过（5 任务）

### T-015 扩展 READING_SKIP_IDS

**File**: `src/panoramic/batch-project-docs.ts:90-110`
**Action**: 把 `READING_SKIP_IDS` 集合扩展为含全部产品文档层 + 架构推断层（11 个新增 generator id），让 `CODE_ONLY_SKIP_IDS` 直接复用 `[...READING_SKIP_IDS]`
**Verify**: `npx tsc --noEmit src/panoramic/batch-project-docs.ts`

### T-016 batch-orchestrator 在非 full 模式传 skipEnrichment

**File**: `src/batch/batch-orchestrator.ts:671-716`
**Action**: 两处调用 `generateSpec` 时（root 模块路径 L671 + 普通模块路径 L713）添加 `skipEnrichment: effectiveMode !== 'full'`
**Verify**: `npx tsc --noEmit src/batch/batch-orchestrator.ts`

### T-017 更新 batch-project-docs 测试期望

**File**: `tests/panoramic/batch-project-docs.test.ts`
**Action**: 调整 reading 模式 case 的期望 — 验证扩展后的 SKIP_IDS 集合，加 1 个 case 断言 reading 模式不生成 product-overview / architecture-narrative 等
**Verify**: `npx vitest run tests/panoramic/batch-project-docs*` 全绿

### T-018 新增 reading-mode perf 测试

**File**: `tests/batch/reading-mode.perf.test.ts`（新建）
**Action**: 在 graphify-mini fixture 上跑 reading 模式，断言总耗时 < 120_000 ms 且无 product-overview 等产品文档产物
用 `describe.skipIf(!process.env['ANTHROPIC_API_KEY'])` 守卫
**Verify**: 在有 API Key 的本地环境跑过且 < 120s

### T-019 Batch 4 commit + push

**Action**: 跑 `npx vitest run` + `npm run build` 全绿后，commit 并 push
**Commit message**: 见 plan.md Batch 4 commit message
**Verify**: `git log -1` 显示新 commit

## Batch 5: P2-1 sourceKind 显式（4 任务）

### T-020 single-spec-orchestrator 显式传 sourceKind

**File**: `src/core/single-spec-orchestrator.ts:613-624`
**Action**: 在 `generateFrontmatter` 调用对象中追加 `sourceKind: 'canonical'`
**Verify**: `npx tsc --noEmit src/core/single-spec-orchestrator.ts`

### T-021 frontmatter 测试增加 canonical case

**File**: `tests/generator/frontmatter.test.ts`
**Action**: 加 1 个 case：当 input 含 `sourceKind: 'canonical'` 时，frontmatter 输出应显式含 `sourceKind: 'canonical'` 字段
**Verify**: `npx vitest run tests/generator/frontmatter*` 全绿

### T-022 single-spec-orchestrator 测试更新

**File**: `tests/core/single-spec-orchestrator.test.ts`（如存在）
**Action**: 检查是否有 case 期望 frontmatter 不含 sourceKind；如有则改为期望 `sourceKind: 'canonical'`
**Verify**: `npx vitest run tests/core/single-spec-orchestrator*` 全绿

### T-023 Batch 5 commit + push

**Action**: 跑 `npx vitest run` + `npm run build` 全绿后，commit 并 push
**Commit message**: 见 plan.md Batch 5 commit message
**Verify**: `git log -1` 显示新 commit

## 验证阶段（Phase 4）

完成 Batch 5 后进入 Phase 4：

- Phase 4a + 4b（并行）：spec-review + quality-review
- Phase 4c：verify 工具链验证（`npm run build` + `npx vitest run` + `npm run repo:check`）+ 验证证据核查
- GATE_VERIFY 决策

## 端到端验证场景（实施后跑）

按 fix-report.md 已声明：graphify 不在仓库，用 graphify-mini fixture 替代。

**场景 1**：默认 preset
```bash
ANTHROPIC_API_KEY=$KEY node dist/cli/spectra.js batch tests/fixtures/graphify-mini --output-dir /tmp/test-default
```
期望：tokenUsage > 0 / llmModel = sonnet 4.6 / graph.json 含 ≥ 1 hyperedge

**场景 2**：--mode=reading
```bash
ANTHROPIC_API_KEY=$KEY node dist/cli/spectra.js batch tests/fixtures/graphify-mini --mode reading --output-dir /tmp/test-reading
```
期望：耗时 < 120s / 无 product-overview 等

**场景 3**：--budget 5000
```bash
ANTHROPIC_API_KEY=$KEY node dist/cli/spectra.js batch tests/fixtures/graphify-mini --budget 5000 --on-over-budget cancel --output-dir /tmp/test-budget
```
期望：正常完成（Sonnet 用量低于 5000）

3 个场景验证全部通过后，进入 push master 流程。

## 任务依赖图

```
T-001 → T-002 → T-003 → T-004 → T-005 [Batch 1]
                                  ↓
T-006 → T-007 → T-008 → T-009 [Batch 2]
                          ↓
T-010 → T-011 → T-012 → T-013 → T-014 [Batch 3]
                                  ↓
T-015 → T-016 → T-017 → T-018 → T-019 [Batch 4]
                                  ↓
T-020 → T-021 → T-022 → T-023 [Batch 5]
                  ↓
            Phase 4 (review + verify)
                  ↓
            GATE_VERIFY
                  ↓
            完成报告 + 等用户授权 push master
```
