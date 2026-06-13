# 🅓 性能根因诊断报告 — code-only 构建 27.5min / CPU 11%

**方法**: 静态代码阅读（未跑 27min profiled run — 见「为何不跑实测」）| **日期**: 2026-06-13

## 结论速览

| 项 | 结论 |
|----|------|
| 根因定位 | **code-only 模式并非「纯 AST / 无 LLM」**：仍对每个单元调 `generateSpec`（sonnet spec-gen LLM），仅跳过 enrichment（第二次 LLM）。27min 是 LLM 网络等待主导，与实测 CPU 11%（145s user CPU / 27min wall ≈ 99% idle）一致——典型 I/O-bound（等 LLM API），非 CPU-bound 图构建 |
| CLI 宣传「<30s」误导 | code-only 的 SC-001 设计目标是 <120s（batch-orchestrator.ts:873 注释），但该目标只在「模块数少 × 跳过 enrichment」假设下成立；自用仓（~250 .ts）单元数 × sonnet 延迟 / concurrency 摊出 27min |
| 是否本 feature 修 | **否，分流**（FR-014）：真正的修复（新增纯 AST graph-only 路径）会动 `batch-orchestrator.ts`——F182 在飞护栏文件。记录发现，等 F182 完全 settle 后独立 fix 立项 |
| 对 US1 的影响 | **27min 已不在 dogfooding 关键路径上**：🅑 bootstrap 让新 worktree 直接 copy 图（不重建），首次开箱无需跑 batch。性能优化降级为「锦上添花」 |

## 证据链（code-only 执行路径）

1. **code-only 仍做 per-unit LLM spec-gen**：`batch-orchestrator.ts:875`
   ```ts
   skipEnrichment: isSmallModule || budgetSkipEnrichmentAll || effectiveMode !== 'full',
   ```
   仅 `skipEnrichment`（跳过第二次 enrichment LLM）；spec-gen 主 LLM 调用（`generateSpec`，L915/L960）照常执行，`modelOverride` 强制 sonnet（L879）。→ code-only ≠ 无 LLM。

2. **并发本身正常**：`batch-orchestrator.ts:1106` 统一走 `pLimit(concurrency=3)`，未见信号量退化为 1 的结构。故 27min 不是「并发被串行化」，而是「单元数 × sonnet 单次延迟（15-30s）/ 3」的自然摊销。

3. **wall vs CPU 比印证 LLM-bound**：145s user CPU / 27min wall。若为 CPU-bound 图构建（AST 解析），CPU 利用率应接近 100%；11% 说明绝大部分时间在等网络（LLM API），与 per-unit sonnet 调用吻合。

4. **无纯 AST graph-only 快路径**：
   - `spectra graph`（cli/commands/graph.ts:192）只从 **已有 specs + architectureIR + crossRef** 构建，**不含 unifiedGraph 代码节点**（symbol/call），且不跑 AST → 产出的图缺 MCP impact/context 所需的代码节点。
   - 完整代码图（含 15701 代码节点）只能由 `spectra batch` 产出（其 AST→buildUnifiedGraph 是快的，但与慢的 per-unit LLM spec-gen 纠缠在同一流程）。

## 待实测确认的假设（本次未跑）

- **单元粒度假设**：若 code-only 在 root 分支按 **file 粒度**（L909 `for file of group.files`）而非 module 粒度展开，~250 文件 × ~20s / 3 ≈ 28min，恰好吻合实测。精确粒度需 profiled run 确认。
- 该假设不影响「分流」结论：无论粒度，根因都是 per-unit LLM 调用，修复都需动 batch-orchestrator。

## 为何不跑 27min 实测

1. 修复已确定分流（动 F182 护栏文件），实测仅能精化粒度假设，不改变结论；
2. 预算：27min batch + LLM 调用成本，性价比低；
3. 静态证据链已足以定位根因方向（LLM-bound，非空等 sleep / 非并发退化）。

## 分流建议（独立 fix 候选，待 F182 settle）

**新增真正的 graph-only 快路径**：`spectra batch --mode graph-only`（或新命令），只跑 AST → `buildUnifiedGraph` → `writeKnowledgeGraph`（注入 unifiedGraph 源），**完全跳过 per-unit LLM spec-gen**。预期 <30s（纯 AST，CPU-bound），真正兑现 CLI 宣传。

- 影响文件：`batch-orchestrator.ts`（mode 分派）——F182 护栏，须等其 settle。
- 价值：除 bootstrap 外，给「主仓首次建图」「无缓存 worktree」一条快路径。
- 与本 feature 关系：🅑 bootstrap 已解 US1 燃眉；此项是正交优化，不阻塞 F193 验收。

## 移交备忘（来自任务书）

- `regen-plan.ts::resolveSourceTarget` call 边 recall 缺口（impact 报 0 callers，grep 实测 2 个跨文件调用方：delta-regenerator.ts:250 / batch-orchestrator.ts:750）→ graph-accuracy 域 fix 候选，留给 F191 全期 review 归档。
