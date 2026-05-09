# Feature Specification: Feature 151 follow-up — 真实 self-dogfood Layer B snapshot 录制 + NFR-1/NFR-5 baseline:diff 性能验证

**Feature Branch**: `159-feat151-baseline-snapshot`
**Created**: 2026-05-09
**Status**: Draft
**Input**: 完成 Feature 151 follow-up #2 (P3 T-016b — 真实 self-dogfood Layer B snapshot 录制) + #3 (Feature 151 SC-006 / NFR-1 / NFR-5 — UnifiedGraph baseline:diff ≤ 10% 性能回归验证)。

---

## 目标摘要

Feature 151（Knowledge Graph + Python LanguageAdapter）于 2026-05-08 ship 到 master 时，**SC-006 / NFR-1 / NFR-5 deferred**：未跑 baseline:diff 验证 UnifiedGraph 的性能 / 成本 / 质量回归是否 ≤ 10%；**SC-004 Layer B 用 minimum-viable handcrafted fixture**（4 节点 / 5 边手工 GraphJSON）作为锚点，未在真实 self-dogfood baseline 上录正式 snapshot。

本 Feature 在 Feature 152 / 153 / 154 / 156 全部已 ship 到 master 之后（当前 master HEAD `cf0a131`），作为 release 前的烟测：

1. **真实 self-dogfood Layer B snapshot 录制**：在当前 master 上跑 self-dogfood 完整 spectra batch（含 LLM），用产生的 `_meta/graph.json` 替换 `tests/integration/graph-mcp-snapshot.test.ts` 中 Layer B 的 MVP fixture，录正式 snapshot 入库。
2. **3 个 baseline target NFR-1 / NFR-5 性能 baseline:diff 验证**：跑 `npm run baseline:collect` 在 micrograd / nanoGPT / self-dogfood 三个固定 baseline 上，对比仓内 git history 中**真实存在**的旧 fixture（详见 §EC-7 旧 fixture 来源 — 三者 commit 各不相同），按 §EC-4 阈值分层判定 perf 回归。
3. **若有 critical regression**：标识根因 + 决定回滚 vs 接受改 spec（更新 Feature 151 verification report 中 SC-006 状态）。

**关键路径属性**：本 Feature 不引入产品代码改动；仅新增 / 替换 fixture + 更新 verification report + 在 `specs/147-.../competitive-evaluation-report.md` 加 §11 NFR baseline:diff 数据。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Layer B snapshot 真实化（Priority: P1）

作为下游 graph MCP tools 消费者（component-view-builder、graph_query 用户、未来 Feature 158+ 开发者），我能在 `tests/integration/graph-mcp-snapshot.test.ts` 看到的 Layer B snapshot 来自真实 self-dogfood 项目（~250 .ts / 17 module）的 graph.json，而不是 4 节点 / 5 边手工 mock；snapshot 反映含 calls 边的 GraphQueryEngine 在真实 degree 排序、真实 budget 截断下的稳定行为，作为 Feature 158+ 的回归 anchor。

**Why this priority**: Feature 151 verification report 明确将 P3 T-016b 列为 follow-up，但用 MVP fixture 时 snapshot 的"真实性"为零 — 任何后续 graph engine 的 degree 排序 / budget 算法变更都不会被 mock fixture 检测到。真实 self-dogfood snapshot 才能成为真正的 calls-enabled 行为 baseline。

**Independent Test**: 跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts`，Layer B 全部 pass；snapshot 文件 `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` 中 `layer-b-graph_query` / `layer-b-graph_god_nodes` 节点 ID 集合源自 self-dogfood 真实代码（出现 `src/panoramic/`、`src/knowledge-graph/`、`src/batch/` 等真实路径），不再是 `src/foo.ts` / `src/bar.ts` mock 路径。

**Acceptance Scenarios**:

1. **Given** 当前 master 在 self-dogfood 上跑完 `npm run baseline:collect -- --target self-dogfood --mode full`，产生 `~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json`，**When** 该 graph.json 被纳入 graph-mcp-snapshot 测试 fixture（路径：`tests/integration/__fixtures__/self-dogfood-graph.json` 或等效位置），**Then** Layer B 测试 `graph_query keyword=batch-orchestrator` 返回的节点中至少出现 1 个真实 src/ 路径节点，且至少 1 条 `calls` relation 边
2. **Given** snapshot 录制完成入库，**When** 重新运行 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts` 二次确认幂等性，**Then** 0 snapshot mismatch
3. **Given** Layer A 测试在替换 fixture 后，**When** 跑 `npx vitest run`，**Then** Layer A 6 个 snapshot 仍然 pass（Layer A 必须 1:1 不受 fixture 切换影响 — 验证 filterOutCallEdges normalizer 在真实数据上同样正确）

---

### User Story 2 — NFR-1 / NFR-5 baseline:diff 验证（Priority: P1）

作为 Spectra 维护者，在 Feature 151 / 152 / 153 / 154 / 156 累计 5 个 feature 合入后，我能拿到一份明确的 baseline:diff 报告，证明 UnifiedGraph 抽象引入对 micrograd / nanoGPT / self-dogfood 三个 baseline 的性能 / 成本 / 质量回归 ≤ 10%（Feature 151 NFR-1 / NFR-5 阈值）。

**Why this priority**: Feature 151 verification 中 SC-006 deferred，理由是"完整 baseline:collect 需 LLM 调用"。本 Feature 主线焦点。SC-006 的"~10% 回归"是 Feature 151 ship 的隐式承诺；不验证就直接 release 4.2.0 等于把 latent regression 推到下游。

**Independent Test**: 跑 `npm run baseline:diff -- <old.json> <new.json>`，对每个 baseline 的 `perf.totalWallMs` / `perf.tokensInputPlusOutput` / `perf.estimatedCostUsd` / `output.graphNodeCount` 计算 delta，确认所有维度 |delta| ≤ 10%（Yellow threshold）。

**Acceptance Scenarios**（与 §EC-4 三档语义对齐；实测结果见 [verification-report.md](./verification/verification-report.md) §SC-3 + [§11](../147-competitor-evaluation-platform/competitive-evaluation-report.md#10)）：

1. **Given** 当前 master 在 micrograd 上跑 `npm run baseline:collect -- --target karpathy/micrograd --mode full`，产出新 fixture，**When** 跑 `npm run baseline:diff -- <旧 fixture from git history> <新 fixture> --mode regression`，**Then** 按 §EC-4 三档判定：green=SC-3 PASS / yellow=SC-3a 接受偏差 / red=SC-3b 写 regression-analysis.md（**实测**：totalWallMs +8.5% green / tokens +15.7% red / cost +10.7% yellow → SC-3b accept-and-spec）
2. **Given** 同样流程在 nanoGPT 上重复，**Then** 按 §EC-4 三档判定（**实测**：totalWallMs +5.9% green / tokens +8.8% yellow / cost +5.7% green → SC-3a 接受偏差）
3. **Given** 同样流程在 self-dogfood 上重复（耗时 ~30 min / cost ~$10）— 跨 9 commits（148~156）跨度大，预计落 yellow / red，**Then** 按 §EC-4 三档判定 + 写 regression-analysis.md（**实测**：totalWallMs +49.1% / tokens +31.3% / cost +28.6% 三项全 red → SC-3b accept-and-spec）
4. **Given** 任一 target 触发 SC-3a (yellow) 或 SC-3b (red)，**Then** 按 §Risk Mitigation 步骤分析根因，写入 `verification/regression-analysis.md` 并决定 accept-and-spec / rollback / hot-fix

---

### User Story 3 — competitive-evaluation-report.md §11 数据更新（Priority: P2）

作为 Spectra release 文档读者（Sprint 3 后续阶段评估者、潜在用户），我能在 `specs/147-.../competitive-evaluation-report.md` 的 §11 看到 Feature 151 + 152 + 153 + 154 + 156 累计后 3 个 baseline 的最新性能数据 + 与上一版（Feature 150 ship 时）的 delta 对比，作为本仓库的 release-time perf signal。

**Why this priority**: §11 之前为空（competitive-evaluation-report 在 Feature 147 sprint 3 D 之后停在 commit-shy spike 结论）；本 Feature 是首次有 release-time NFR perf signal 入文档。

**Independent Test**: 阅读 `specs/147-.../competitive-evaluation-report.md`，§11 章节存在；含 3 个 baseline 的 perf table（旧值 / 新值 / delta% / Yellow-or-Red）+ 一句话结论。

**Acceptance Scenarios**:

1. **Given** 3 个 baseline:diff 已完成，**When** 读 `competitive-evaluation-report.md` §11，**Then** 看到 markdown 表格含 `target | totalWallMs Δ% | tokens Δ% | cost Δ% | graphNodeCount Δ% | verdict` 5 列，3 行（micrograd / nanoGPT / self-dogfood）
2. **Given** §11 添加完毕，**When** 跑 `npm run release:check`，**Then** PASS（不破坏 release contract）

---

## Functional Requirements

- **FR-1**: 必须在当前 master commit（`cf0a131` 或更新）上跑 self-dogfood `npm run baseline:collect -- --target self-dogfood --mode full`，且 `_meta/graph.json` 被持久化到 baseline workspace（`~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json`）
- **FR-2**: 必须将 self-dogfood `graph.json` 拷贝至 `tests/integration/__fixtures__/self-dogfood-graph.json`（或等效仓内固定路径），作为 Layer B 测试的真实 fixture
- **FR-3（Codex I-3 修订）**: 必须修改 `tests/integration/graph-mcp-snapshot.test.ts`：
  - 新增独立 describe 块加载真实 fixture（`fs.readFileSync(...)` + `JSON.parse(...)`），不删除原 MVP_GRAPH_WITH_CALLS（保留作为 Layer A normalizer 正交验证）
  - `graph_query keyword=*` 中的 keyword 改为真实 self-dogfood 中存在的 symbol（首选 `BatchOrchestrator`，fallback `LanguageAdapter`）
  - calls 边断言保持 generic predicate `result.edges.some(e => e.relation === 'calls' && /* W-2 路径限定 */)`，不引入硬编码节点 ID
  - Layer A 测试**保持不变**（spec Assumption-1）：保留 MVP fixture 作为 normalizer 行为正交验证
- **FR-4**: 必须重新生成 snapshot 文件 `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` 中 Layer B 部分（用 `vitest --update`）
- **FR-5**: 必须跑 `npm run baseline:collect -- --targets self-dogfood,karpathy/micrograd,karpathy/nanoGPT --mode full`，更新 `tests/baseline/<project>/spectra/full.json`（3 个 fixture）
- **FR-6**: 必须跑 `npm run baseline:diff -- <旧 fixture> <新 fixture> --mode regression` × 3，每项 metric delta ≤ 10%（PASS / Yellow，退出码 0）
- **FR-7**: 必须将 baseline:diff 输出汇总到 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §11 NFR baseline:diff 表格 + 一句话结论
- **FR-8**: 必须更新 `specs/151-knowledge-graph-python/verification/verification-report.md`：将 SC-006 / NFR-1 / NFR-5 状态从 `⏸ deferred` 改为 `✅ verified` 并附上本 Feature 的 baseline:diff 数据引用
- **FR-9**: 必须保证全 3155+ 单测继续 pass（含本 Feature 改动的 graph-mcp-snapshot.test.ts）
- **FR-10**: 必须保证 `npm run repo:check` + `npm run release:check` + `npm run build` + `tsc --noEmit` 零失败

---

## Key Entities

- **真实 self-dogfood graph.json**：当前 master 跑完 spectra batch 后产生的 `_meta/graph.json`（NetworkX node-link 格式），含真实 src/ 路径节点 + calls 边
- **fixture 文件**：仓内 `tests/integration/__fixtures__/self-dogfood-graph.json`，作为 Layer B 测试的稳定输入
- **baseline fixture（3 项）**：`tests/baseline/{micrograd,nanoGPT,self-dogfood}/spectra/full.json`，schemaVersion 1.1
- **baseline:diff 报告**：`npm run baseline:diff` 的 text 输出 + JSON 输出（用于 §11 表格）
- **regression analysis（条件性）**：`specs/159-feat151-baseline-snapshot/verification/regression-analysis.md`（仅当 |delta| > 10% 时生成）

---

## Edge Cases / Constraints

- **EC-1 — graph.json 体积（Codex W-1 修订：陈旧实测不可用作估算依据）**：现有 `~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json` 是 2026-04-30 跑的旧版本（无 calls 边、extraction skipped、schema 2.0），约 40 KB；**该体积不能用作"含 4 语言 callSites + UnifiedGraph 的真实 self-dogfood graph"的估算依据**。新跑 graph.json 体积预计 100 KB ~ 1 MB（10x ~ 25x 增长来自 callSites 节点 + extraction sources）。实施时实测 graphSizeBytes 后决定：< 500 KB 直接入库；500 KB ~ 2 MB 入库但加 .gitattributes 优化 diff 体验；> 2 MB 考虑字段裁剪（仅保留 nodes/links/graph 必要字段，删除 metadata 中的非验证用字段）或 git lfs
- **EC-2 — snapshot 稳定性（Codex C-3 修订：归一化必须覆盖 inputHash）**：真实 graph.json 中含多个时变字段，fixture 拷贝至仓内时必须**全部归一化**：
  - `graph.generatedAt`（ISO 时间戳）→ 固定为 `"2026-05-09T00:00:00.000Z"`
  - `graph.inputHash`（由 docGraph.generatedAt + architectureIR.generatedAt 参与计算，见 `src/panoramic/graph/graph-builder.ts:412-424`）→ **重算或固定为 `"<normalized>"`**（每次跑都会变，必须归一化）
  - `nodes[].metadata.currentRun`（仅运行时元数据）→ 删除
  - 其它 audit：审查节点 / 边 metadata 中是否还有 timestamp / runId / processId / hash 字段，逐项纳入归一化清单
  - **幂等性硬性验收（spec SC-2）**：归一化脚本写完后必须做"录-重录"测试 —— 跑 vitest --update 一次 → 立即重跑 vitest run 一次 → 0 snapshot mismatch；若有 mismatch，diff snapshot 找漏掉的时变字段，加入归一化清单后回测
- **EC-3 — graph_query keyword 选择**：必须选 self-dogfood 中**结构稳定**的 symbol（如 `BatchOrchestrator` / `LanguageAdapter`），避免选用变动频繁的私有 helper（如未导出 const）

- **EC-3a — Layer B calls 边断言必须限定 src/ 路径（Codex W-2 修订）**：self-dogfood 不是纯 TS 仓库 —— 实测 `tests/fixtures/` 下含 ~29 个 `.py` 文件，且 batch-orchestrator 的 .ts/.py 扫描路径不排除 `tests/fixtures`（见 `src/batch/batch-orchestrator.ts:2108-2121, :2227-2248`）。fixture 中的 .py / .ts 也会被扫到并产出 calls 边，可能导致 Layer B 测试断言"含 calls 边"被 fixtures 误满足。Layer B 测试中 `result.edges.some((e) => e.relation === 'calls')` 必须升级为 `result.edges.some((e) => e.relation === 'calls' && (e.source.startsWith('src/') || e.target.startsWith('src/')))`，确保至少 1 条 calls 边的端点落在产品代码而非 fixture
- **EC-4 — baseline:diff 阈值分层（Codex C-4 修订：消除内部冲突，统一语义与脚本退出码对齐）**：
  - `baseline-diff.mjs` 行为（实证）：green = `|Δ| < yellowMin`，yellow = `[yellowMin, redMin)`，red = `≥ redMin`；脚本退出码：0 = green ∪ yellow（`overall: pass | warn`），1 = red（`overall: fail`）
  - 默认 regression 阈值表（来自 `baseline-diff.mjs:28-34`）：
    - `perf.totalWallMs`：yellowMin=10%, redMin=20%
    - `perf.tokensInputPlusOutput`：yellowMin=5%, redMin=15%（注：collector 写 `tokensInput / tokensOutput` 分开，diff 内部求和为虚拟字段；命名差异已知）
    - `perf.estimatedCostUsd`：yellowMin=10%, redMin=20%
    - `output.graphNodeCount`：yellowMin=10%, redMin=20%, twoSided
    - `output.specSuccessRatio`：yellowBelow=95, redBelow=90
  - **统一三档语义（替代之前的内部冲突表述）**：
    - **green（|Δ| < yellowMin）→ SC-3 PASS**（满足"≤ 10%"承诺）
    - **yellow（yellowMin ≤ |Δ| < redMin）→ SC-3a PASS-with-deviation**（不阻塞，但必须在 §11 显式列出 deltaPct + 接受偏差理由；SC-3 整体仍记 PASS）
    - **red（|Δ| ≥ redMin）→ SC-3b BLOCK**（阻塞，写 `verification/regression-analysis.md`）
  - **指标分类**：
    - **perf 类**（`perf.totalWallMs` / `perf.tokensInputPlusOutput` / `perf.estimatedCostUsd`）：参与 SC-3 验收（按上述三档判定）
    - **output 类**（`output.graphNodeCount` / `output.graphEdgeCount`）：**完全不参与** SC-3 验收 —— 跨 9 个 feature 累计变更（含 UnifiedGraph + 4 语言 callSites）注定大幅增加节点数；仅在 §11 中作 informational signal 列出 deltaPct + "expected breaking change" 标记
    - **质量类**（`output.specSuccessRatio`）：参与 SC-3 验收，但用脚本默认阈值（95%/90%）—— Feature 151~156 不应导致 spec 生成成功率下降
  - **跨度合理性提醒**：micrograd 旧 fixture 来自 commit `8959669`（仅跨 1 commit）→ perf 三档预计落在 green；nanoGPT/self-dogfood 旧 fixture 来自 `0449d2b`（跨 9 commits）→ perf 三档大概率落在 yellow / red。yellow 走 SC-3a 接受偏差路径；red 走 SC-3b 阻塞 → 但根因若是"9 个 feature 累计的合理变化"（不是 Feature 151 单一引入的回归），可在 regression-analysis.md 中标 accept-and-spec 解阻
- **EC-5 — micrograd/nanoGPT 重 clone**：`prepareTarget` 已实现 commit-pin（如不指定 --commit 则用 HEAD），且 `~/.spectra-baselines/{micrograd,nanoGPT}` 已 clone；本 Feature 不强制重 clone（用现有版本即可），新 fixture 中 `meta.targetCommit` 字段会反映实际 SHA
- **EC-6 — N=1 vs N=3 取中位数**：Feature 149 引入了 N=5 重测，但本 Feature 是 release 前烟测，N=1 已足够（baseline:diff `--mode reproducibility` 阈值 ≥ 5% 即 Red — 不适合本场景）。实测取 N=1。
- **EC-7 — old fixture 来源（Codex C-1 修订）**：经 `git log -- tests/baseline/<project>/spectra/full.json` 实证，三个 baseline 旧 fixture 来自不同 commit：
  - **micrograd**：commit `8959669`（Feature 155 M3 — `feat(155): M3 — 集成测试 + 真实 graph acceptance`），M3 期间因 agent-context 集成测试需要重跑了 micrograd baseline；该 fixture 已含 Feature 151 + 152 + 153 + 154 累计变更，跨度仅 1 个 feature（156）
  - **nanoGPT**：commit `0449d2b`（Feature 147 sprint3 A+B — `feat(147 sprint3): Phase A 报告诚实性 + Phase B spec 兑现`），早于 Feature 151；不含任何 callSites 数据；跨度 9 个 feature（148~156）
  - **self-dogfood**：commit `0449d2b`（同 nanoGPT）；不含 callSites + 不含 UnifiedGraph schema；跨度 9 个 feature
  - 取出方式：`git show <commit>:tests/baseline/<project>/spectra/full.json > /tmp/feat-157-diff/old-<project>.json`
  - **跨度差异对 SC-3 的影响**：micrograd 跨度小（1 commit）→ perf delta 预计 ≤10%；nanoGPT/self-dogfood 跨度大（9 commits 累计变更，含 4 语言 callSites + UnifiedGraph + Agent-Context + Incremental）→ perf delta 大概率超 10%（甚至 ≥ 20%）；这不是"回归"，是 9 个 feature 累计的合理变化。SC-3 阈值需按"跨度合理性"分层判定（详见 §EC-4）
- **EC-8 — 实测旧 fixture 关键 metric（用作 plan 阶段预算 / 阈值推导依据）**：
  - micrograd: `totalWallMs=19,440ms (≈19s)`, `tokensInput/Output=null`, `estimatedCostUsd=null`, `graphNodeCount=46`
  - nanoGPT: `totalWallMs=1,254,041ms (≈21min)`, `tokensInput=312,491`, `tokensOutput=88,849`, `estimatedCostUsd=$2.27`, `graphNodeCount=32`
  - self-dogfood: `totalWallMs=1,801,843ms (≈30min)`, `tokensInput=1,649,212`, `tokensOutput=327,543`, `estimatedCostUsd=$9.86`, `graphNodeCount=17`
  - micrograd 因 `tokensInput/Output=null` 在 baseline:diff 中 `perf.tokensInputPlusOutput / perf.estimatedCostUsd` 字段会 severity=`na`（信息缺失）；本 Feature 仅在新 fixture 上**填补这两个 null**作为 follow-up 改进，不阻塞验收

---

## Risks & Assumptions

### Risk-1：ANTHROPIC_API_KEY 前置缺失（HIGH）

**信号**：当前 worktree shell 中 `ANTHROPIC_API_KEY` 未设置（实测 NOT_SET）。

**影响**：spectra batch 跑 LLM 阶段失败 → baseline:collect 整体退出码 ≠ 0 → 无法生成新 fixture。

**Mitigation**：在 implementation 阶段开始前显式向用户确认 API key 已配置（环境变量 / .env / 手动 export），实现阶段优先用 `--dry-run` mode 探测一次，确认能正常调用 LLM。

### Risk-2：跑批耗时超 Bash 工具限制（HIGH）

**信号**：实测旧 fixture self-dogfood `totalWallMs=1,801,843ms ≈ 30 min`、nanoGPT ≈ 21 min；远超 Bash `timeout` 默认 2 min 与最大 10 min。CLAUDE.local.md 中标的"self-dogfood ~10 分钟"已过时。

**影响**：若同步等待会超时；用 `run_in_background=true` 启动则需轮询 / 等待完成通知；3 个 baseline 累计 ≈ 51 分钟。

**Mitigation**：implement 阶段所有 `baseline:collect` 调用都用 `run_in_background=true`；3 个 baseline **串行**而非并发（避免 LLM rate limit 429 + token quota 超耗 + 进程 OOM）；执行时长由跑批日志验证（perfRaw.totalWallMs）；跑批期间编排器可并行做无关工作（如 fixture 归一化脚本编写、§11 模板预填）。

### Risk-3：实际成本超预算（HIGH）

**信号**：实测旧 fixture self-dogfood `estimatedCostUsd=$9.86` / nanoGPT $2.27 / micrograd null（推算 ~$0.5）= 总 ≈ $12.6；**已超用户原始预算 $10**。

**影响**：第一次成功跑就会超预算 $2.6；若 self-dogfood 中途因网络 / 429 失败重 retry，成本会再翻倍至 $20+。

**Mitigation**：
1. 在 implement 启动前**主动向用户披露实测预算 ~$12.6**，等用户确认是否继续
2. 提供 cost-saving 替代方案：(a) 跑 micrograd + nanoGPT 共 ~$2.7 验证 perf delta，self-dogfood 暂用旧 fixture（牺牲 NFR-5 完整性）；(b) self-dogfood 用 `--mode reading` 或 `--mode code-only`（跳过部分 LLM 调用）
3. 第一次跑成功立即 commit 新 fixture，禁止重跑；若失败先 diagnose log（API 报错 / quota / 网络），不盲目 retry
4. 实施时设置 `SPECTRA_LOG_LEVEL=info`（或 verbose）便于第一时间发现失败信号

### Risk-4：性能回归 > 10%（MEDIUM）

**信号**：Feature 151 verification 在 W-4 已标"`.py 三次重复扫描`性能风险"，可能导致 self-dogfood `totalWallMs` 增加。但 Python 文件在 self-dogfood 中占比小（~0%），所以风险点更可能来自 Java（154）/ TS-JS（152）的 callSite 抽取。

**影响**：若 |delta| > 10% 触发 Yellow / Red，需要决定 accept-and-spec 还是 rollback。

**Mitigation**：写明决策路径（§User Story 2 AS-4），允许 accept-and-spec（更新 Feature 151 verification report 标"已知偏差"）；不阻塞 release。

### Assumption-1：self-dogfood 的 LayerA snapshot 不需要切换 fixture

Layer A 的 MVP fixture 已经 sufficient 验证 filterOutCallEdges 行为正确性（4 节点 / 5 边足以暴露 normalizer bug），切换至真实 self-dogfood 反而会让 Layer A snapshot 体积膨胀但价值不增加。本 Feature **保留 Layer A MVP fixture 不变**，仅切换 Layer B。

### Assumption-2：Feature 150 ship 时的 fixture 是合理 baseline

`git show 8959669:tests/baseline/<project>/spectra/full.json` 是 Feature 150 ship 时录制的 fixture；Feature 151 ship 时未重跑，所以"老 fixture"实际反映 Feature 150 时点的状态。本 Feature 跑出的"新 fixture"反映 Feature 151 + 152 + 153 + 154 + 155 + 156 累计变更，是合理对比基线。

### Assumption-3：master 上 4 语言 callSites 已全部 ship（实证）

经过 `git log origin/master --oneline | grep "feat(15[0-9])"` 实证：
- Feature 151（Python callSites）— ship 时间最早
- Feature 152（TS-JS callSites）— commit `5f39571 / 0119625 / c0ec26a / 93a251e / d021592 / 102b4d4`
- Feature 153（Go callSites）— commit `9aca0ed / 1a68cd3 / 1a10def`
- Feature 154（Java callSites）— commit `62bdf7f / d56bf65 / 3950e2c / ef72212 / 8a0210b / b4bc7e3 / 834bb27`
- Feature 155（Agent-Context MCP tools）— commit `8959669 / b74284a / 229f802`
- Feature 156（Incremental + DepGraph shim）— commit `cf0a131`

所以 self-dogfood（纯 TS 项目）跑出的 graph.json **一定会含 calls 边**（来自 TS callSites）；FR-3 中"Layer B fixture 必须含 ≥ 1 条 calls 边"的前提成立。

---

## Success Criteria

| ID | 描述 | 阈值 / 测量 |
|----|------|------------|
| **SC-1** | Layer B snapshot 真实化 | `tests/integration/graph-mcp-snapshot.test.ts` Layer B 测试中 fixture 来源为真实 self-dogfood graph.json，节点 ID 含 ≥ 1 个 `src/` 真实路径，含 ≥ 1 条 `calls` 边 |
| **SC-2** | snapshot 幂等 | 重跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts` 二次，0 snapshot mismatch |
| **SC-3** | 3 baseline **perf 类**回归判定 | `npm run baseline:diff` 对 3 个 baseline 全部得到 `overall: pass | warn`（退出码 0，即非 red）；**绿/黄三档判定**按 §EC-4 的统一三档语义；详见 SC-3a / SC-3b 子项 |
| **SC-3a** | yellow PASS-with-deviation | 任一 perf 项 \|Δ\| ∈ [yellowMin, redMin) 时，§11 表格显式列出 deltaPct + 接受偏差理由（典型如"9 个 feature 累计变更"或"callSites 引入新 LLM 调用"）；verification report 标"已知偏差"，整体 SC-3 仍记 PASS |
| **SC-3b** | red BLOCK | 任一 perf 项 \|Δ\| ≥ redMin 时阻塞 release；写 `verification/regression-analysis.md`，识别根因（git bisect 或 commit-by-commit 排查），决定 rollback / hot-fix / accept-and-spec |
| **SC-3c** | micrograd token/cost null（Codex C-2 修订）| micrograd 旧 fixture（commit 8959669）的 `perf.tokensInput / tokensOutput / estimatedCostUsd` 字段为 `null`，baseline-diff 在 null 字段上返回 `severity: 'na'` 不参与判定。**micrograd SC-3 验收范围明确缩减为 `perf.totalWallMs` 一项**；token/cost 维度的 NFR-5 验收完整在 nanoGPT + self-dogfood 上执行（这两个 fixture 含完整数据）。新跑 micrograd fixture 必然填上 token/cost（spec EC-8），可作为"未来对比基线"，但本 Feature 不阻塞验收 |
| **SC-4** | NFR baseline:diff §11 入文档 | `competitive-evaluation-report.md` §11 含 3 行 markdown 表格 + 一句话结论 |
| **SC-5** | Feature 151 verification 更新 | `specs/151-knowledge-graph-python/verification/verification-report.md` SC-006 / NFR-1 / NFR-5 从 deferred 改为 verified（带本 Feature reference） |
| **SC-6** | 全测试通过 | `npx vitest run` 0 fail |
| **SC-7** | 仓库一致性 | `npm run build` + `npm run repo:check` + `npm run release:check` + `tsc --noEmit` 全部 PASS |

---

## Out of Scope

- 不动产品代码（`src/`）
- 不引入新的 LLM 模型 / SDK 版本变更
- 不重构 baseline-collect.mjs / baseline-diff.mjs（沿用 schemaVersion 1.1）
- 不跑 hono 等 500+ 项目（CLAUDE.local.md 明确 hono 不在常规 bench 范围）
- 不引入新 npm scripts（沿用现有 `baseline:collect` / `baseline:diff` / `eval:report`）
- 不 update Feature 151 之外的 verification report（如 152 / 154）
- 不引入 sqlite / Agent-Context MCP（这些是 Feature 155 / 156 的 scope）

---

## Definition of Done

1. ✅ self-dogfood 完整 spectra batch 跑成功（`_meta/graph.json` 存在）
2. ✅ Layer B fixture 入库（`tests/integration/__fixtures__/self-dogfood-graph.json`）
3. ✅ Layer B snapshot 录制（`__snapshots__/graph-mcp-snapshot.test.ts.snap`）
4. ✅ 3 个 baseline fixture 更新（`tests/baseline/<project>/spectra/full.json`）
5. ✅ 3 份 baseline:diff 报告（`verification/baseline-diff-{micrograd,nanoGPT,self-dogfood}.txt` + JSON）
6. ✅ §11 NFR 数据写入 `competitive-evaluation-report.md`
7. ✅ Feature 151 verification report SC-006 / NFR-1 / NFR-5 状态更新
8. ✅ 全测试 + repo:check + release:check + build 全 PASS
9. ✅ Codex 阶段性对抗审查（每个 phase 结束跑一次，参考 CLAUDE.local.md 约定）
10. ✅ 提交前列 deliverable report 等用户确认 push
