# Verification Report: Feature 214 图拓扑 canonical ID 收敛

**特性分支**: `claude/graph-topology-canonical-id-1de3ab`
**验证对象 commit**: `3e551a8`（feat(214): Trusted Live Graph 底座）
**验证日期**: 2026-07-20
**验证范围**: SC-001 ~ SC-005 独立实跑验证（不引用 implement 侧任何"已达标"声明，所有命令均在本轮验证会话中真实执行）

## SC-005（全量三件套 + baseline）

| 检查项 | 命令 | 退出码 | 关键数字 | 判定 |
|--------|------|--------|----------|------|
| Build | `npm run build` | 0 | tsc 零错误；postbuild 盖章 commit=3e551a82 | ✅ PASS |
| Test | `npx vitest run` | 0 | 439 passed / 4 skipped（443 files）；5145 tests passed / 18 skipped / 21 todo（无 failed） | ✅ PASS |
| Repo Check | `npm run repo:check` | 0 | 全部 45 项子检查 pass（含 agent-docs、release-contract、namespace-consistency 等） | ✅ PASS |

**已知 flaky 定性**：本轮全量 `npx vitest run` 一次跑通零失败，watch-command / batch-orchestrator-incremental / community-analysis perf / cli-e2e --version 四项已知 flaky 用例本轮**未触发失败**，无需隔离重跑定性。

**baseline:diff 现实（如实记录，非美化）**：

implement 侧 `T035-attribution-report.md` 记录 3 个固定 baseline 项目（micrograd / nanoGPT / self-dogfood）经 `baseline:diff` 比对：
- micrograd / nanoGPT：`baseline:diff` **exit 1**（非 exit 0）。触发原因逐项归因：(1) `graphNodeCount` 下降越过启发式阈值 = SC-005 allowlist 类(2) canonical ID 收敛导致的 `#`→`::` 成对重复节点消除（micrograd 5 对、nanoGPT 11 对，本轮已用 `graph-semantic-diff` 独立复现，见下）；(2) `tokensInputPlusOutput` 变化 = full batch LLM 单次采样随机性（CLAUDE.local.md 已知偏差，本 feature 零 LLM 提示词/参数改动，无因果）。
- self-dogfood：`baseline:diff` exit 0（green）。
- **该 exit 1 弱化解释（"perf 启发式告警须逐项归因，非要求 diff 命令 exit 0"）为 implement 侧口径，尚未经用户在 GATE_VERIFY 环节裁定是否接受**——本报告仅如实转述该现实与归因证据，不代表本轮验证已替用户做出"可接受"的最终判断。

**语义层复核（本轮独立重跑，非引用）**：

对 micrograd 项目，用当前 worktree 编译产物 `dist/cli/index.js` 在 `~/.spectra-baselines/micrograd` 现场重建 graph-only 图（`rm -rf specs/_meta && node dist/cli/index.js batch --mode graph-only`，产出 33 节点 / 37 边），与 `specs/214-graph-topology-canonical-id/verification/old-graphs/micrograd.graph.json`（旧图快照，38 节点/14 边）做 `graph-semantic-diff.mjs`：

```
[类1] contains 边增量: new contains 总计 28（module→symbol 7 / class→member 21）；相对 old 新增 module→symbol +2 / class→member +21，旧 contains 缺失 0
[类2] canonical ID 字面变化 + 重复消除: 纯 '#' 节点 old 5 → new 0；duplicate-pair old 5 → new 0（消除 5）
[类3] 非 contains 耦合边: old 9 → new 9，变化节点数 0
[PASS] 全部差异归因到三类 allowlist（无未归因节点/边/ID/度数差异）
```

exit 0，数字与 implement 侧 `T035-attribution-report.md` 完全一致，独立复现成功。

**NFR-004 性能（本轮独立重测）**：

在 `~/.spectra-baselines/micrograd` 用当前 worktree 编译产物做 3 次冷启动（每次 `rm -rf .spectra specs/_meta`）：`230ms / 222ms / 218ms`，p50 = **222ms**，显著优于 implement 侧记录的 245ms，均 ≤ 旧基准 240ms×1.5=360ms 阈值。**PASS，无劣化**。

self-dogfood 侧性能数字取自编排器此前已完成的 `verify_independent` 独立测量（trace.md 19:18:00）：graph-only warm p50≈4.7s vs 旧 3.2s（**+45%**），归因为新增 contains 边（4880 条，边数 2.7x）过 normalize/序列化/portable 扫描逻辑；处于 ×1.5 阈值（4.8s）内（4.7≤4.8），判定 PASS-WITH-NOTE——**如实记录该 +45% 增幅，不美化为"无劣化"**，是否可接受留待 GATE_VERIFY 用户裁定。

**判定：SC-005 = PASS-WITH-NOTE**（三件套本轮独立零失败通过；baseline:diff micrograd/nanoGPT exit 1 已逐项归因且本轮独立复现语义层数字一致，但该弱化解释与 self-dogfood +45% 性能增幅需 GATE_VERIFY 用户显式确认后方可视为完全达标）。

## SC-001（graph.json 无 `#`/`::` 语义重复节点）

命令：`node scripts/graph-semantic-diff.mjs --dup-check specs/_meta/graph.json`（self-dogfood 图，2026-07-20 19:17 生成，晚于本次验证的 commit 时间戳，视为新鲜）

```
[dup-check] 节点总数: 5735
duplicate-pair count: 0
[dup-check] PASS: duplicate-pair count = 0
```

退出码 0。**判定：SC-001 = PASS**。

## SC-002/SC-003（三层转换合同 + module→symbol contains 覆盖）守护测试

命令：
```
npx vitest run tests/unit/knowledge-graph/contains-edges.test.ts tests/unit/knowledge-graph/snapshot-roundtrip.test.ts \
  tests/unit/panoramic/graph/graphjson-roundtrip.test.ts tests/integration/graph-equivalence-matrix.test.ts \
  tests/unit/knowledge-graph/module-derivation.test.ts
```

结果：5 files passed，**28/28 tests passed**，退出码 0。

**判定：SC-002/SC-003 = PASS**。

## SC-004（MCP 四工具查询输入合同 E2E）

命令：`npx vitest run tests/e2e/feature-214-mcp-layered-query.e2e.test.ts`

结果：1 file passed，**11/11 tests passed**，退出码 0。

**判定：SC-004 = PASS**。

## F193/F182/F183 回归抽验

命令：
```
npx vitest run tests/unit/knowledge-graph/relativize.test.ts tests/unit/knowledge-graph/snapshot-portability.test.ts \
  tests/unit/graph/cross-worktree-byte.test.ts tests/unit/knowledge-graph/incremental-contains.test.ts \
  tests/unit/panoramic/graph/legacy-id-stale.test.ts
```

结果：5 files passed，**40/40 tests passed**，退出码 0。无回归。

## 总体判定

| SC | 判定 |
|----|------|
| SC-001（重复节点消除） | ✅ PASS |
| SC-002/SC-003（contains 覆盖 + 三层转换合同） | ✅ PASS |
| SC-004（MCP 查询合同） | ✅ PASS |
| SC-005（三件套 + baseline 归因） | ⚠️ PASS-WITH-NOTE（细节见上，待 GATE_VERIFY 裁定） |
| F193/F182/F183 回归 | ✅ PASS（无回归） |

**READY FOR REVIEW（附条件）**：SC-001~004 与全部回归抽验均无条件通过；SC-005 的三件套（build/test/repo:check）本轮独立零失败通过，但 baseline:diff 对 micrograd/nanoGPT 的 exit 1（已逐项归因，本轮独立复现语义数字一致）以及 self-dogfood graph-only 冷启动 +45% 性能劣化（阈值内但方向为劣化）需在 GATE_VERIFY 环节由用户明确确认"可接受"，而非由验证子代理单方面判定为无条件 PASS。

## 遗留事项清单

1. **GATE_VERIFY 待用户裁定项**：micrograd/nanoGPT `baseline:diff` exit 1（perf 启发式告警口径 vs 强制 exit 0）、self-dogfood graph-only 冷启动 +45%（4.7s vs 3.2s，阈值内）——两项均已有充分归因证据（本报告 + `T035-attribution-report.md`），但属"预期变化是否可接受"的产品判断，不属于验证子代理职权范围。
2. **入库 fixture 待跑**：T040 提及的 3 个 perf anchor fixture（`tests/baseline/{self-dogfood,micrograd,nanoGPT}/spectra/full.json`）入库尚未在本轮验证中复核（属 full batch 采集，超出本轮验证命令范围，非阻断项）。
3. **测试信号**：本轮全量 vitest 439 files / 5145 tests 零失败，已知 flaky 用例未触发，无需额外处置。
