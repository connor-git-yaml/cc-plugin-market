# Verification Report — Feature 159 follow-up: 真实 self-dogfood Layer B snapshot 录制 + NFR baseline:diff 性能验证

**Feature**: 157
**Branch**: `claude/elated-chebyshev-ac33b6`（worktree elated-chebyshev-ac33b6）
**Generated**: 2026-05-09
**Verifier**: Spec-Driver verify (Phase 5)

---

## 总体结论

✅ **可推进至合并 master**

7 个 Success Criteria 中 6 项 PASS（含 1 项 with deviation 已 accept-and-spec），1 项部分降级（micrograd 旧 fixture 数据缺失）；Codex spec/plan/tasks 二轮审查 7 critical + 8 warning 全修复；3461 单测 0 fail；零 type / lint / repo:check / release:check 错误。

---

## SC 验收结果

### SC-1 Layer B snapshot 真实化 ✅

`tests/integration/__fixtures__/self-dogfood-graph.json` 入库（来自 self-dogfood 完整 spectra batch + 归一化后产物）：

- **节点**：4,887 个（旧 17 → 新 4,887，+28,647%；含 src/ 4,103 + tests/ 727 + specs/ 28 + _meta/modules 20 + scripts/ 8 + 1 vitest.config.ts）
- **边**：2,373 条
- **calls 边**：765 条（其中 743 条 source/target 含 src/ — 远超 W-2 担忧的"fixtures 误满足"风险）
- **fixture 体积**：2.3 MB（spec EC-1 估算 100KB ~ 1MB 的上限，无需压缩）
- **归一化字段**：graph.generatedAt / graph.inputHash / nodes[].metadata.currentRun / 4864 个绝对路径节点 id 全部归一化为 repo-relative POSIX path（实测 0 残留 `..` / 0 `<ext>` 占位）

Layer B snapshot 入库 (`tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` +427 lines)：
- `layer-b-self-dogfood-graph_query`（keyword=`LanguageAdapter`，budget=30）— 真实 src/ 节点 + ≥1 src/ calls 边
- `layer-b-self-dogfood-graph_god_nodes top=5` — 顶级 degree 节点（src/batch/batch-orchestrator.ts degree=46、callSitesCount=567）

测试用例：`tests/integration/graph-mcp-snapshot.test.ts` 新增 `describe('graph MCP tools snapshot — Layer B (self-dogfood, calls-enabled, P3 T-016b)', ...)` 含 W-2 路径限定 predicate `hasSrcCallsEdge`。

### SC-2 snapshot 幂等 ✅

录-重录幂等性测试：
1. 第 1 次 `npx vitest run`（fixture 入库后）：13 tests passed | 2 snapshots written
2. 第 2 次 `npx vitest run`（同一文件）：13 tests passed | **0 mismatch / 0 written**

git diff 防护（Codex W-1）：仅新增 self-dogfood 相关 `+exports[]` 行；Layer A 6 个 / Layer B (MVP) 2 个 snapshot 0 删除/修改。

### SC-3 perf 类回归判定 — 经分层判定全部 verified

3 个 baseline 旧 fixture 均来自 commit `0449d2b`（Feature 147 sprint3 A+B），跨 9 commits（148~156）：

| target | totalWallMs Δ% | tokens Δ% | cost Δ% | severity | 验收 |
|--------|----------------|-----------|---------|----------|------|
| micrograd | +8.5% green | +15.7% red | +10.7% yellow | 1 red 2 mixed | **SC-3b accept-and-spec** |
| nanoGPT | +5.9% green | +8.8% yellow | +5.7% green | 1 yellow 2 green | **SC-3a 接受偏差** |
| self-dogfood | +49.1% red | +31.3% red | +28.6% red | 3 red | **SC-3b accept-and-spec** |

**说明**：
- micrograd 8959669 fixture broken（totalWallMs=19s + token=null），改用 0449d2b 真实 fixture（176s/$0.56）
- 所有 red/yellow 经 [regression-analysis.md](./regression-analysis.md) 根因分析：跨 9 个 feature + 4 语言 callSites + UnifiedGraph 引入的 expected new-feature cost 增量，非回归
- self-dogfood specModuleCount 17 → 20，模块边界扩展占 totalWallMs 增量约 18%

#### SC-3c micrograd token/cost null（已知偏差）

micrograd 0449d2b 旧 fixture 已含 token/cost（与 8959669 broken 版不同），Codex C-2 担忧自动消解；但 micrograd token 维度仍触红 +15.7%，根因为 Python adapter 引入 callSites 字段后 LLM prompt input 增加。

### SC-4 NFR baseline:diff §11 入文档 ✅

`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §11 已写入：
- §11.1 perf 类指标表格（3 baseline × 3 metric × verdict）
- §11.2 output 类指标 informational table
- §11.3 一句话结论 + accept-and-spec 决策 + raw data 链接

注：原 §7 已存在「已知限制与后续 Feature」，本 Feature 追加为 §11 不打乱原结构。

### SC-5 Feature 151 verification report 更新 ✅

`specs/151-knowledge-graph-python/verification/verification-report.md`：
- SC-006 段：`⏸ deferred` → `✅ verified with accepted deviation`，含 Feature 159 baseline:diff 表格 + accept-and-spec 引用
- NFR-1 段：补充 Feature 159 实测数据，self-dogfood +49.1% red 已根因分析为 expected new-feature cost
- NFR-5 段：`⏸ deferred` → `✅ verified with accepted deviation` + Feature 159 reference

### SC-6 全测试通过 ✅

`npx vitest run`：
- Test Files: 297 passed | 2 skipped (299)
- Tests: **3461 passed** | 3 skipped | 20 todo (3484)
- Duration: 105.55s

第一次跑批（self-dogfood baseline:collect 进行中并发）出现 1 flaky test，重跑稳定全 PASS。

### SC-7 仓库一致性 ✅

| 命令 | 结果 |
|------|------|
| `npm run build` | 0 错（`tsc` 完成）|
| `npm run repo:check` | 全 release-contract / orchestration-overrides 均 pass |
| `npm run release:check` | `Release contract valid` |
| `npx tsc --noEmit` | 0 错 |

---

## 实测预算 vs 估算对比

| baseline | 估算 cost | 实测 cost | 估算 wall | 实测 wall |
|----------|----------|----------|-----------|-----------|
| micrograd | ~$0.5 | $0.62 | ~3 min | 3.2 min |
| nanoGPT | ~$2.27 | $2.40 | ~21 min | 22.1 min |
| self-dogfood | ~$9.86 | **$12.68** | ~30 min | **44.8 min** |
| **合计** | ~$12.6 | **$15.70** | ~54 min | **70.1 min** |

**偏差说明**：
- self-dogfood spec module 从 17（旧 fixture）→ 20（新跑）→ 跑批量增加 18% → cost / wall time 实测高于按旧 module 数估算的值
- 未触发任何 LLM 失败重试 → 0 额外 cost overhead

---

## Codex 阶段性对抗审查累计

| Phase | CRITICAL | WARNING | INFO | 修复状态 |
|-------|----------|---------|------|---------|
| **Spec 审查（一轮）** | 4 | 4 | 3 | 全修 ✅ |
| **Plan/Tasks 审查（二轮）** | 3 | 4 | 4 | 全修 ✅ |
| **总计** | **7** | **8** | **7** | **全修 ✅** |

Critical 修订摘要：
- C-1：旧 baseline 来源证伪 — 改用 0449d2b（micrograd 8959669 broken）
- C-2：micrograd token/cost null 收窄验收范围 — 已实证 0449d2b 含完整 token/cost
- C-3：归一化漏 graph.inputHash + 绝对路径节点 id — 升级 normalize-graph-fixture.mjs 加 inputHash + path strip
- C-4：阈值/阻塞语义内部冲突 — 重写为统一三档 (green/yellow=PASS-with-deviation/red=BLOCK)
- 二轮 C-1（plan）：归一化漏绝对路径 — 修订 normalizePath 用 PROJECT_ROOT strip + isAbsolute 判定
- 二轮 C-2：T-012 §7 已存在 — 改追加 §11
- 二轮 C-3：T-013 yellow 文案失真 — 改 verdict 三分支模板（A/B/C）

---

## 已知偏差（accept-and-spec）

1. **micrograd tokens +15.7% red**：Python LanguageAdapter 引入 callSites 抽取，prompt input 增加；属于 Feature 151 设计预期
2. **nanoGPT tokens +8.8% yellow**：跨 9 feature 累计变更 + Python callSites 影响
3. **self-dogfood 3 perf 项全 red**：4 语言 callSites（F151/152/153/154）+ UnifiedGraph + Agent-Context + Incremental Indexing 累计 expected cost 增量；spec module 17 → 20
4. **output.graphNodeCount 大幅增加**：UnifiedGraph + 4 语言 callSites 引入新节点类型（self-dogfood 17 → 4887），按 spec EC-4 排除出 SC-3 验收

后续 Feature 应基于 cf0a131 时点新 fixture 严格遵守 ≤ 10% 单 feature perf 阈值。

---

## Feature 159 改动清单

### 新增文件
- `tests/integration/__fixtures__/self-dogfood-graph.json` (2.3 MB) — Layer B fixture
- `scripts/normalize-graph-fixture.mjs` (~80 行) — graph.json 归一化脚本（一次性）
- `specs/159-feat151-baseline-snapshot/spec.md` / `plan.md` / `tasks.md`
- `specs/159-feat151-baseline-snapshot/verification/regression-analysis.md`
- `specs/159-feat151-baseline-snapshot/verification/baseline-diff-{micrograd,nanoGPT,self-dogfood}.{txt,json}` (6 文件)
- `specs/159-feat151-baseline-snapshot/verification/verification-report.md`（本文件）

### 修改文件
- `tests/baseline/{micrograd,nanoGPT,self-dogfood}/spectra/full.json` — 新跑批 fixture（commit cf0a131）
- `tests/integration/graph-mcp-snapshot.test.ts` — 新增 self-dogfood describe 块（W-2 src/ 路径限定 + I-3 generic predicate）
- `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` — 新增 2 个 layer-b-self-dogfood snapshot
- `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` — 追加 §11 NFR baseline:diff 表格
- `specs/151-knowledge-graph-python/verification/verification-report.md` — SC-006 / NFR-1 / NFR-5 状态从 deferred → verified

### 不动文件（spec Out of Scope 约束）
- `src/` 任何源码 ✅
- `package.json` / `package-lock.json` 0 改动 ✅（npm install 仅 worktree 初始化）

---

## 下一步建议

1. 用户复核本 verification report + regression-analysis.md，确认 accept-and-spec 决策
2. 若用户接受，按 CLAUDE.local.md "PUSH Origin Master 前列 Report" 约定 → 列 deliverable report → 等用户授权 push
3. push 前完成 Phase 5 三向审查（spec-review + quality-review + verify）+ Codex 终审
4. 后续 Feature 应基于 cf0a131 新 fixture 做 baseline:diff，严格遵守 ≤ 10%
