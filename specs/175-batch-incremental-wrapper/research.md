# 技术决策研究 — F175 Batch Incremental Wrapper

**生成于**: 2026-06-06（plan 阶段）  
**来源**: spec.md GATE_DESIGN 决议 + codebase 现场扫描 + research-synthesis.md

---

## Decision 1：`--full` 与 `--force` 的语义边界

**问题**：OQ-1 决议采用新增 `--full` flag，但 `--force` 已存在且语义高度重叠（"强制重新生成所有 spec"）。如何切分？

**Decision**：`--full` 定义为 regen 轴全量逃生口（绕 cache + 绕 DeltaRegenerator）；`--force` 作为 `--full` 的向后兼容别名，两者在 `resolveRegenPlan` 内合并为 `full=true`。`--force` 永久保留，不废弃。

**Rationale**：
1. `--force` 现有语义（"强制重新生成所有 spec"）与 `--full` 完全等价，合并不引入歧义。
2. `baseline-collect.mjs`、CI 脚本等外部调用者使用 `--force`；废弃会导致翻转后这些脚本静默走增量路径，基线数据失真。
3. 向后兼容是 Constitution XIII 的明确要求。

**Alternatives 排除**：
- **废弃 `--force`，只保留 `--full`**：破坏 Constitution XIII，外部脚本静默失效，排除。
- **`--force` 保留原语义，`--full` 引入新语义**：两个 flag 语义高度重叠会导致混淆，且 `--force` 历史语义本就是"全量"，没有必要区分。排除。

---

## Decision 2：MCP `incremental` 默认值翻转方案

**问题**：OQ-2 决议 MCP 同步翻转。具体如何修改 MCP schema，使翻转对现有调用方透明？

**Decision**：在 `server.ts` 中，`incremental` 参数保持 `z.boolean().optional()`（不改类型），但在 `resolveRegenPlan` 中 `undefined` 的语义从 `false` 改为 `true`。同时新增 `full: z.boolean().optional()` 参数。现有调用方传 `incremental: false` 的可显式 opt-out。

**Rationale**：
- `optional()` 语义上 `undefined = 未传`，由 `resolveRegenPlan` 决定默认值，MCP schema 无需改类型。
- 新增 `full` 参数为 SWE-Bench cohort 3 等评测提供显式全量入口。

**Alternatives 排除**：
- **改 `incremental` 为 `z.boolean().default(true)`**：MCP SDK 对 `default` 的序列化行为不一致，可能导致工具描述 JSON 变化，影响调用方反射。用 `resolveRegenPlan` 在应用层处理更安全。

---

## Decision 3：byte-stable 口径 — 严格 deepEqual（OQ-3）

**问题**：SC-003 验收是严格 deepEqual 还是容差模式？

**Decision**：严格 deepEqual（方案 A）。具体操作：比较前剥 `generatedAt`，节点/边按确定性 key 排序，`inputHash` 通过稳定化的内容 hash 计算（不含时间戳）。

**Rationale**：
- 容差（≤10 nodes）掩盖潜在 bug，且"10 nodes"无合理上限根据。
- `normalizeGraphForWrite` 在写盘边界统一归一化，使方案 A 可达。
- 仅有一处无法归一化的非确定性：`generatedAt` 时间戳，其在比较时显式剥除即可。

**Alternatives 排除**：
- **容差方案 B**：掩盖 bug，且容差值难以界定，排除。

---

## Decision 4：baseline-collect.mjs 是否默认加 `--full`（OQ-4）

**问题**：翻转默认后，`baseline-collect.mjs` 是否需要显式加 `--full` 防止 cache 污染？

**Decision（W-3 修订：与 plan.md 统一为"显式加 `--full`"）**：`baseline-collect.mjs` **显式加 `--full`**（防御性）；`eval-task-runner.mjs` **不改**。

- **`baseline-collect.mjs` 加 `--full`**：虽然 `runBatchAndCapture` 跑前已 `fs.rmSync(outputDir,…)`（`:761-762`，在 `:802` 调 batch 前）→ 无历史 spec → DeltaRegenerator 天然退化全量（EC-006），"今天"不加也能跑全量。但 baseline 是长期 perf 回归 guard（Feature 143），全量语义不应隐式依赖"outputDir 跑前被清"这一实现细节；显式 `--full` 使"基线永远全量"自文档化、与清理逻辑解耦，并省去一次无谓的 DeltaRegenerator plan 扫描开销。改动量 ~1 行（`runBatchAndCapture` args 加 `'--full'` + dry-run 校验路径 `:486` 同步）。
- **`eval-task-runner.mjs` 不改**：走 `--mode code-only`（**无任何 LLM**），且在临时/新 clone worktree 无历史 spec → 退化全量；cache 污染既不影响 LLM cost 也无基线对比语义，加 `--full` 无收益。记录为已评估。

**Rationale**：baseline 的正确性价值 > 1 行改动成本；eval 因 code-only + 临时目录无须改。这与 plan.md「OQ-4 决议」「Impact Assessment」「文件树」三处一致（消除原 research/plan 矛盾，W-3）。

---

## Decision 5：项目级聚合 fast-path 不做（OQ-5）

**问题**：无改动时，项目级聚合（debt pipeline、`_index.spec.md`）是否加 fast-path 跳过？

**Decision**：不做。SC-002 门禁口径锁定为"无模块级 LLM 调用"，项目级开销作为已知 cost。

**Rationale**：
- fast-path 需要判断"所有模块 cache hit"状态，引入新的状态管理复杂度，违反 YAGNI（Constitution III）。
- 项目级聚合的 LLM 开销（若有）远小于模块级，不影响 SC-002 的门禁达成。
- 后续若需要可单独 Feature 处理。

---

## Decision 6：`resolveSourceTarget` 共享函数放置位置

**问题**：FR-019 要求 DeltaRegenerator 和 runBatch 使用同一 target 解析逻辑，放在哪里？

**Decision**：放入 `src/batch/regen-plan.ts`（与 `resolveRegenPlan` 同文件），避免引入第三个文件。

**Rationale**：
- `regen-plan.ts` 已作为 batch 层的共享工具模块引入，`resolveSourceTarget` 属于同一职责范畴（regen 决策辅助）。
- `DeltaRegenerator`（`delta-regenerator.ts`）和 `batch-orchestrator.ts` 都在 `src/batch/` 包内，无循环依赖。

---

## Decision 7：`normalizeGraphForWrite` 调用位置

**问题**：byte-stable 归一化应在 `buildKnowledgeGraph` 内还是在调用方（`batch-orchestrator.ts`）？

**Decision**：在 `batch-orchestrator.ts` 中，社区分析后、`writeKnowledgeGraph` 前调用 `normalizeGraphForWrite`。`buildKnowledgeGraph` 内部不归一化。

**Rationale**：
- FR-007 要求归一化发生在 "batch 追加 semantic edges 之后"（`:1365-1367`），而 semantic edges 在 `buildKnowledgeGraph` 返回后追加，在 graph-builder 内归一化无法覆盖这些边。
- 写盘边界调用保证归一化覆盖完整边集，是唯一正确位置。

---

## 未解项（无，所有 OQ 已决议）

所有 OQ-1 至 OQ-5 均已在 GATE_DESIGN 或本 plan 阶段完成决议，无遗留开放问题。
