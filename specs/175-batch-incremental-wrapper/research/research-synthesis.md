# 调研汇总 — Feature 175 Batch Incremental Wrapper

**调研模式**: codebase-scan（内部基础设施特性，无需产品/Web 调研；架构主张由主编排器亲自核查）
**核查日期**: 2026-06-06
**事实源**: M7-execution-blueprint.md §4 + 主编排器对 src/ 的逐文件核查

---

## 1. 已核查的架构事实（带 file:line 证据）

### 1.1 仓库"增量"两层未打通（确认）

| 层 | 位置 | 现状 |
|----|------|------|
| F156 `buildIncremental` | `src/knowledge-graph/incremental.ts:337-505` | 只增量重建 UnifiedGraph snapshot；调用点仅 `src/cli/commands/index.ts:209,289`（`spectra index`），**从未进 batch** |
| runBatch incremental | `src/batch/batch-orchestrator.ts:388,470-503` | options 有 `incremental?: boolean`，**默认 `false`** |
| DeltaRegenerator | `src/batch/delta-regenerator.ts:68-198` | 按 skeleton-hash 比对 → directChanges + BFS 传播 propagatedChanges + unchangedTargets；**仅在 `incremental=true` 时启用** |

### 1.2 当前 3-way 重生成决策逻辑（`batch-orchestrator.ts:721-748`，已核查）

```
forceFullRegeneration = force || (incremental && deltaReport.mode === 'full')
shouldUseIncrementalPlan = incremental && !force && deltaReport.mode === 'incremental'

每模块决策：
  if (forceFullRegeneration)      → 总是重生成
  else if (shouldUseIncrementalPlan) → 仅当 sourceTarget ∈ regenerateTargets
  else (当前默认 incremental=false) → 仅当 spec 文件不存在 (!fs.existsSync)
```

**关键洞察**：当前默认路径（incremental=false）的 "skip" 只看 **spec 文件是否存在**，**不感知源码改动**。
源码改了但 spec 文件还在 → 默认路径**不会**重生成 → 产物 stale。
incremental 路径（DeltaRegenerator）才是 skeleton-hash 感知，能正确"改 1 文件只重生成受影响模块、未改全 cache hit"。
→ **这正是 Feature 175 task A（翻转默认）要拿下的主收益。**

### 1.3 命名维度正交性（确认，无类型层冲突）

- `BatchMode = 'full' | 'reading' | 'code-only'`（`src/panoramic/qa/types.ts:16`）= **质量维度**
- `incremental: boolean` + `force: boolean` = **regen 轴**，与 mode 正交，类型层已分离
- mode 三入口引用：CLI `parse-args.ts:782-809`（`--mode`）、runBatch `batch-orchestrator.ts:373-381`、`scripts/baseline-collect.mjs:87,106`（`--mode`）
- 🔴 风险点不在类型层而在 **CLI flag 语义**：M7 设计的 `--full`（regen 轴"显式全量"）与 `--mode full`（质量维度）字面相近；且现有 `--force`（"强制重新生成所有 spec"）语义与"显式全量"高度重叠 → **plan 阶段必须厘清 --force / --full / --no-incremental 三者语义边界**

### 1.4 "3 次全量 AST 重扫" → 实测 2 次主流程全扫（修正）

- `buildModuleGraphForProject(resolvedRoot)` — `batch-orchestrator.ts:447,452`（内部 scanFiles + 逐文件 analyzeFile）
- `collectPythonCodeSkeletons` + `collectTsJsCodeSkeletons` — `batch-orchestrator.ts:1126-1131`（再次全扫，TS/JS 与上一步重复，结果不复用）
- 两者均**不复用** F156 snapshot
- → blueprint 写"3 次"，实测主流程 **2 次全量重扫**（TS/JS 被扫两遍）。**P2 候选**（复用 snapshot 消除冗余），正确性风险高（扫描口径差异：includeOnly /^src/ + tsconfig alias），**建议拆出本 Feature。**

### 1.5 byte-stable 风险点（确认）

| 风险 | 位置 | 级别 |
|------|------|------|
| `generatedAt` ISO 时间戳必变 | graph: `src/panoramic/graph/graph-builder.ts:438`；snapshot: `src/knowledge-graph/persistence.ts:265` | 高（必现） |
| graph 节点/边无显式排序，依赖 Map 迭代顺序 | `graph-builder.ts:401-407,430`（last-write-wins 合并多数据源） | 中（同 Node 版本内稳定，多源合并顺序可能漂移） |
| 跳过模块是否重写 spec 文件 | `batch-orchestrator.ts:732-748` | 低（跳过分支不调任何写函数，mtime 不变 — 已核查无"刷 generatedAt 空写"逻辑） |

→ byte-stable 真实战场在**聚合层**（graph.json 的 generatedAt + 节点排序），不在 *.spec.md。

### 1.6 三处默认值漂移（REFACTOR 目标）

`incremental` 默认值在 3 处独立编码，翻转默认须三处一致，否则漂移：
1. CLI `parse-args.ts:704` — `argv.includes('--incremental')`（flag 存在性，无法区分"未传"与 false）
2. MCP `server.ts:171` — `incremental ?? fileConfig.incremental`（已 defer config）
3. runBatch `batch-orchestrator.ts:388` — `incremental = false`

→ REFACTOR 抽 `resolveRegenPlan`（统一从 CLI flag / MCP arg / config / 代码默认 解析出唯一 regen 计划）。

### 1.7 E2E 测试范式（`tests/e2e/batch-pipeline.e2e.test.ts`，确认可沿用）

- `vi.hoisted` + `vi.mock('@anthropic-ai/sdk')` 模块级拦截 LLM，返回 mock spec markdown
- `mkdtempSync(join(tmpdir(),'spectra-e2e-'))` 系统级唯一临时目录（规避并发 Date.now 竞态）
- 现有用例用预置 fixture（`tests/fixtures/e2e/small-ts-project`），**不 git init**
- ⚠️ F175 增量验证需**新增** git init + 改文件 + 多轮 runBatch 的用例

---

## 2. MVP 范围建议（供 specify 收口）

**纳入本 Feature（P1/P2）**：task A（默认翻转，三入口）、task B（regen 轴 CLI 命名 + 语义厘清）、task C（byte-stable 聚合层归一化）。
**拆出（P2/follow-up，不纳入）**：task D（F156 snapshot 复用消冗余 AST 扫描）— 正确性风险高，单独 Feature 验证。

## 3. openQuestions（移交 plan 阶段拍板，spec 不强行决定）

1. regen 轴 CLI 命名：`--full` vs `--no-incremental`；与现有 `--force` 语义如何切分
2. MCP batch tool `incremental` 默认翻 true 是否可接受（影响 SWE-Bench cohort 3）
3. byte-stable 验收口径：严格 deepEqual（剥时间戳）vs ≤10 nodes 容差
4. baseline-collect / eval 是否同步加 `--full` 防性能基线被 cache 污染
5. task D（snapshot 复用）是否本 Feature 接入（建议否，拆 P2）
