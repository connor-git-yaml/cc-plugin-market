# Feature 159 Tasks — 执行清单

**Feature**: 159-feat151-baseline-snapshot
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## 任务总览

16 个任务分 5 大块：A（前置）、B（小型 baseline 跑批）、C（大型 baseline 跑批）、D（snapshot + diff + report）、E（验收 + 提交）。

```text
T-001 ── T-002 ── T-003*       (Block A，编排器侧 + 用户授权 gate)
                   ↓
T-004 ── T-005 ── T-006        (Block B + C，跑批，串行)
                   ↓
T-007 ── T-008 ── T-009 ── T-010   (Block D-1，Layer B snapshot)
                                   ↓
                            T-011 ── T-012 ── T-013   (Block D-2，diff + report)
                                              ↓
                                       T-014 ── T-015 ── T-016   (Block E，验收提交)

* T-003 是用户授权 gate，必须人工确认
```

---

## Block A — 前置 build + 环境校验

### T-001 — npm run build 生成 dist
- **类型**：环境前置，不消耗 LLM
- **依赖**：无
- **执行**：`npm run build`
- **验证**：`test -f dist/cli/index.js && echo "BUILD OK"`
- **失败处理**：build 报错 → 修 ts/lint 错（按错误类型决定，本 Feature 不应该触发，因为不动 src/）

### T-002 — 认证校验 via auth-status --verify（Codex W-3 修订 + skip-batch 误用修订）
- **类型**：环境前置，~$0.001 cost
- **依赖**：T-001
- **关键修订**：
  - **API key 不是必需**：`src/core/llm-client.ts` 错误消息显示三条 fallback 路径（API_KEY / Claude CLI / Codex CLI），任一可用即 PASS。当前 worktree shell ANTHROPIC_API_KEY=NOT_SET，但 Claude CLI 已登录验证通过 → 跑批可以走 Claude CLI 子进程通道
  - **不调用 `baseline-collect.mjs --skip-batch`**：实测 skip-batch 会写空 skeleton fixture 覆盖现有数据（已恢复），不是"只验证脚本可执行"
- **执行步骤**（最小化）：
  1. `node dist/cli/index.js auth-status --verify`
- **验证**：
  - 输出含至少一条 "✓ ... 已验证可用" 行（API_KEY / Claude CLI / Codex CLI 任一）
  - "当前使用: Claude CLI (子进程)" 或等价 fallback 提示（说明 spectra 知道走哪条路径）

### T-003 — 用户预算授权 gate + 跨度差异告知（人工，Codex C-1 + W-4 修订）
- **类型**：人工 gate
- **依赖**：T-002
- **执行**：编排器输出 plan §5 Block A T-003 的预算明细（含跨度差异 + N=3 选项），等待用户回复 `continue` / `continue+repeat` / `partial` / `abort`
- **决策树**：
  - `continue` → T-004（N=1）→ T-005 → T-006，预算 ~$12.6
  - `continue+repeat` → T-004（micrograd N=3）→ T-005 → T-006，预算 ~$13.6（Codex W-4：micrograd LOC 小，N=3 更稳）
  - `partial` → T-004 + T-005，跳过 T-006（self-dogfood 不跑）；进入 T-007 时用 4-30 旧版 graph.json 作为归一化输入；FR-3 Layer B fixture 必须含 calls 边的要求会失败 → SC-1 降级（standby 标记）
  - `abort` → 编排器停止，写 `verification/abort-reason.md` 记录用户中止
- **跨度提醒（Codex C-1 修订）**：编排器必须在预算授权前明确告知 "nanoGPT/self-dogfood 旧 fixture 来自 0449d2b（Feature 147 sprint3 A+B），跨 9 commits → SC-3 在这两个 baseline 上大概率落 yellow/red"
- **风险**：
  - `partial` 模式：牺牲 SC-1（Layer B 含 calls 边）和 SC-3 中 self-dogfood 这一行
  - `continue+repeat` 模式：budget +$1，但 micrograd 的 NFR 数据更可信

---

## Block B — 小型 baseline 跑批（串行）

### T-004 — baseline:collect micrograd（N=1 默认，N=3 可选）
- **类型**：跑批
- **耗时/cost**：N=1 ~3 min ~$0.5；N=3 ~9 min ~$1.5
- **依赖**：T-003 (continue / continue+repeat / partial)
- **执行（N=1，默认）**：
  ```bash
  node scripts/baseline-collect.mjs --target karpathy/micrograd --mode full
  # 用 run_in_background=true（即使 ~3 min 也用 background 避免 Bash 超时风险）
  ```
- **执行（N=3，Codex W-4 选项 — 用户选 continue+repeat 时）**：
  ```bash
  for i in 1 2 3; do
    node scripts/baseline-collect.mjs --target karpathy/micrograd --mode full \
      --output ~/.spectra-baselines/micrograd-output/spectra-full-run$i
    cp ~/.spectra-baselines/micrograd-output/spectra-full-run$i/_meta/batch-summary-*.md \
       /tmp/feat-157-micrograd-run$i.md
  done
  # 编排器解析 3 个 batch-summary 取 totalWallMs / tokens / cost 中位数，落到 fixture
  # 注：当前 baseline-collect.mjs 不支持 --repeats，需手动跑 3 次 + 后处理；
  #     若实施时发现复杂度高，可降级为 N=1 + 在 verification report 中标"micrograd N=1 单次"
  ```
- **验证**：
  - exit code = 0
  - stdout 含 `[baseline] fixture written: tests/baseline/micrograd/spectra/full.json`
  - `tests/baseline/micrograd/spectra/full.json` 文件存在 + schemaVersion=1.1
  - `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` 存在
  - **C-2 关键**：新 fixture 的 `perf.tokensInput / tokensOutput / estimatedCostUsd` **不为 null**（旧 fixture 是 null，新跑应该有）
- **失败处理**：429 → 等 60s 重试一次；其它错误 → diagnose log + 报告用户

### T-005 — baseline:collect nanoGPT
- **类型**：跑批，~21 min，~$2.27
- **依赖**：T-004
- **执行**：
  ```bash
  node scripts/baseline-collect.mjs --target karpathy/nanoGPT --mode full
  # run_in_background=true 必须
  ```
- **验证**：同 T-004（替换 project 名）
- **失败处理**：同 T-004

---

## Block C — self-dogfood 跑批

### T-006 — baseline:collect self-dogfood
- **类型**：跑批，~30 min，~$9.86
- **依赖**：T-005
- **执行**：
  ```bash
  node scripts/baseline-collect.mjs --target self-dogfood --mode full
  # run_in_background=true 必须；编排器期间做 T-007 草稿 / §11 模板
  ```
- **验证**：
  - exit code = 0
  - `tests/baseline/self-dogfood/spectra/full.json` 更新
  - `~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json` 更新
  - 新 graph.json 含 calls 边（`grep -c '"relation": "calls"'` ≥ 1）
- **失败处理**：
  - 429 → 不重试（成本太高），diagnose 报用户
  - 中途网络中断 → 不重试，diagnose 报用户

---

## Block D-1 — Layer B snapshot 录制

### T-007 — graph.json 归一化（Codex C-3 修订）
- **类型**：编排器侧，无 LLM
- **依赖**：T-006
- **执行**：
  1. 写 `scripts/normalize-graph-fixture.mjs`（plan §5 Block D T-007 给出代码模板，含 inputHash 归一化）
  2. 跑：
     ```bash
     mkdir -p tests/integration/__fixtures__
     node scripts/normalize-graph-fixture.mjs \
       ~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json \
       tests/integration/__fixtures__/self-dogfood-graph.json
     ```
- **验证**：
  - `tests/integration/__fixtures__/self-dogfood-graph.json` 存在
  - `node -e "const g=require('./tests/integration/__fixtures__/self-dogfood-graph.json'); console.log(g.graph.generatedAt, g.graph.inputHash)"` 输出固定 `'2026-05-09T00:00:00.000Z' '<normalized>'`
  - 节点 metadata 中无 `currentRun` 字段
  - 文件体积合理（< 2 MB；spec EC-1 给出分级处理）
- **C-3 幂等性硬性测试**（在 T-009 之后回到此 T-007 验证）：
  - 跑 vitest --update 一次（T-009）→ 立即重跑 vitest run（T-010 第 1 次）→ 0 mismatch
  - 若 mismatch，diff snapshot 找出漏掉的时变字段 → 加入归一化脚本 → 回到 T-007 重做归一化 + T-009 重录

### T-008 — 改 tests/integration/graph-mcp-snapshot.test.ts Layer B 部分（Codex W-2 + I-3 修订）
- **类型**：编排器侧，代码改动
- **依赖**：T-007
- **执行**：
  - 在文件顶部 import fs/path（如未 import）
  - 加载 SELF_DOGFOOD_GRAPH 常量（plan §5 Block D T-008 给出完整代码模板）
  - 新增 describe block：`graph MCP tools snapshot — Layer B (self-dogfood, calls-enabled, P3 T-016b)`，含 2 个 it 块（graph_query keyword + graph_god_nodes top=5）
  - **保留**原 `graph MCP tools snapshot — Layer B (calls-enabled, 首版基线)` describe 块**不 rename**（避免 vitest snapshot key 变更，Codex plan/tasks #6 关注）；原 2 个 Layer B (MVP) snapshot 保持不变
  - 在 keyword 选择上：先选 `BatchOrchestrator`，若 graph 中无此节点（unlikely），fallback `LanguageAdapter`，最后 fallback `panoramic`
  - **Codex W-2 关键**：calls 边断言必须限定端点至少有一端落在 `src/` 路径（避免 `tests/fixtures/*.py` 中的 calls 边误满足）；具体实现见 plan T-008 代码模板中的 `hasSrcCallsEdge` predicate
  - **Codex I-3 关键**：predicate 名用 `hasSrcCallsEdge` 而非陈旧的 `assertHasCallsEdge`；保持 generic predicate 形态而非硬编码节点 ID
- **验证**：tsc --noEmit 通过；vitest 单测语法正确（不一定要先跑 vitest）

### T-009 — vitest --update 录新 Layer B snapshot
- **类型**：编排器侧
- **依赖**：T-008
- **执行**：
  ```bash
  npx vitest run tests/integration/graph-mcp-snapshot.test.ts --update
  ```
- **验证**：
  - exit code = 0
  - `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` 中含 `layer-b-self-dogfood-graph_query` / `layer-b-self-dogfood-graph_god_nodes` 两个新 snapshot
  - 新 snapshot 中至少出现 1 个 `src/` 真实路径节点

### T-010 — vitest run 全测试 0 fail（含 snapshot match + 幂等性）
- **类型**：编排器侧
- **依赖**：T-009
- **执行**：
  ```bash
  npx vitest run        # 第 1 次：录完后立即跑
  npx vitest run        # 第 2 次：幂等性验证（SC-2）
  ```
- **验证**：
  - 两次 exit code 都是 0
  - 两次 0 snapshot mismatch
  - 全 3155+ 单测 pass
  - Layer A 6 个 snapshot 仍然 1:1 match（验证 spec Assumption-1）
- **失败处理**：snapshot mismatch → 找到时变字段 → 加入 T-007 归一化清单 → 回 T-007 重做

---

## Block D-2 — baseline:diff + report

### T-011 — baseline:diff × 3（Codex C-1 修订：每 baseline 旧 fixture 来自不同 commit）
- **类型**：编排器侧，无 LLM
- **依赖**：T-010（fixture 锁定 + 测试 pass 后才做 diff）
- **执行**：
  ```bash
  mkdir -p /tmp/feat-157-diff

  # micrograd 旧 fixture 来自 commit 8959669（Feature 155 M3）— 跨 1 commit
  git show 8959669:tests/baseline/micrograd/spectra/full.json \
    > /tmp/feat-157-diff/old-micrograd.json

  # nanoGPT 和 self-dogfood 旧 fixture 来自 commit 0449d2b（Feature 147 sprint3 A+B）— 跨 9 commits
  git show 0449d2b:tests/baseline/nanoGPT/spectra/full.json \
    > /tmp/feat-157-diff/old-nanoGPT.json
  git show 0449d2b:tests/baseline/self-dogfood/spectra/full.json \
    > /tmp/feat-157-diff/old-self-dogfood.json

  for project in micrograd nanoGPT self-dogfood; do
    cp tests/baseline/$project/spectra/full.json /tmp/feat-157-diff/new-$project.json
    npm run baseline:diff -- /tmp/feat-157-diff/old-$project.json /tmp/feat-157-diff/new-$project.json \
      > specs/159-feat151-baseline-snapshot/verification/baseline-diff-$project.txt 2>&1 || true  # 非 0 退出码也保留输出
    npm run baseline:diff -- /tmp/feat-157-diff/old-$project.json /tmp/feat-157-diff/new-$project.json --format json \
      > specs/159-feat151-baseline-snapshot/verification/baseline-diff-$project.json 2>&1 || true
  done
  ```
- **验证**：
  - 3 个 .txt 文件存在
  - 3 个 .json 文件存在 + JSON.parse 不报错
  - text 文件含 `overall: pass | warn | fail`
  - **schema 兼容性**：旧 fixture（schemaVersion=1.1）与新 fixture（schemaVersion=1.1）major 版本一致 → diff 不报 schema-mismatch
- **决策**（Codex C-4 统一三档语义）：
  - 全 PASS（perf 类全 green）→ SC-3 ✅
  - 任一 yellow（perf 类）→ SC-3a，§11 中显式列出 deltaPct + 接受偏差理由（典型："9 个 feature 累计变更"或"callSites 引入新 LLM 调用"），整体 SC-3 仍 PASS
  - 任一 red（perf 类）→ SC-3b，编排器**主动暂停**，写 `verification/regression-analysis.md` 含根因分析（git bisect 思路），等用户决策 rollback / hot-fix / accept-and-spec
  - **跨度合理性**：nanoGPT/self-dogfood 跨 9 commits，预计落 yellow/red；不要立即视为"Feature 151 引入回归"——优先在 regression-analysis 中识别"哪个 feature 贡献最大 delta"
- **C-2 关键**：micrograd 因旧 fixture token/cost null，diff 在这两项上输出 `severity: 'na'`，SC-3 micrograd 实际仅基于 totalWallMs；这一限制在 §11 + verification report 中显式标注

### T-012 — 写 §11 NFR baseline:diff 表格
- **类型**：编排器侧
- **依赖**：T-011
- **执行**：
  - 编排器解析 3 份 diff JSON
  - 提取每个 project 的 perf.totalWallMs / perf.tokensInputPlusOutput / perf.estimatedCostUsd / output.graphNodeCount 的 deltaPct + severity
  - 在 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 末尾追加 §11 markdown 表格（plan §5 Block D T-012 给出模板）
  - 一句话结论：基于 3 个 verdict 总结
- **验证**：
  - §11 章节 markdown 表格完整（3 行 × 5 列）
  - `npm run release:check` PASS（不破坏 release contract）

### T-013 — 改 Feature 151 verification report
- **类型**：编排器侧
- **依赖**：T-012
- **执行**：
  - 在 `specs/151-knowledge-graph-python/verification/verification-report.md` 中找到 SC-006 / NFR-1 / NFR-5 三处 `⏸ deferred`
  - 替换为 `✅ verified（Feature 159 follow-up 录制）` + Feature 159 reference
  - 保留原说明（"完整 baseline:collect 需 LLM 调用"等）但加注 "已在 Feature 159 follow-up 中跑完"
- **验证**：
  - SC-006 / NFR-1 / NFR-5 三处状态符号已更新
  - 原文档其它部分未被破坏（diff 只影响 3 处段落）

---

## Block E — 验收 + 提交

### T-014 — 仓库一致性
- **类型**：编排器侧
- **依赖**：T-013
- **执行**：
  ```bash
  npm run build
  npm run repo:check
  npm run release:check
  npx tsc --noEmit
  ```
- **验证**：4 条命令全 exit 0

### T-015 — 写 verification report
- **类型**：编排器侧
- **依赖**：T-014
- **执行**：写 `specs/159-feat151-baseline-snapshot/verification/verification-report.md`，包含：
  - SC-1 ~ SC-7 验收数据 + 实测证据（命令 + 输出片段）
  - Codex 阶段性审查累计表（每 phase 的 critical / warning / info 修复状态）
  - NFR-1 / NFR-5 baseline:diff 结论
  - 已知偏差 / accept-and-spec 项（如 SC-3a 触发的 yellow）
- **验证**：文档完整 + 引用所有 verification artifacts

### T-016 — Phase 5 三向审查 + Codex 终审
- **类型**：编排器调度（spec-driver-story Phase 5）
- **依赖**：T-015
- **执行**：
  - **并行启动** spec-review + quality-review（VERIFY_GROUP）
  - 等两者完成后启动 verify（依赖 5a/5b 报告）
  - **再启动 Codex 终审**（对累计变更做最后一次对抗审查）
- **验证**：
  - spec-review report 0 critical / 0 warning（或 warning 已修）
  - quality-review report 0 critical / 0 warning
  - verify report PASS（含工具链验证 + SC 数据复核）
  - Codex 终审 0 critical（warning 修或合理理由保留）
- **失败处理**：任一审查发现 critical → 修复 → 重跑该 phase 验证

---

## Codex 阶段性对抗审查 schedule（按 CLAUDE.local.md）

| 阶段 | 触发时机 | 审查 prompt 焦点 |
|------|---------|-----------------|
| **spec** | spec.md 完成后（已启动） | spec 完整性 / 阈值合理性 / 时变字段审计 / 预算前提 |
| **plan** | plan.md 完成后 | 跑批策略 / 归一化逻辑 / fixture 路径 / 失败处理预案 |
| **tasks** | tasks.md 完成后 | 任务分解可执行性 / 依赖关系 / 验证标准 |
| **implement** | T-016 之前 | 代码改动正确性 / snapshot 录制是否齐全 / Layer A/B 隔离 |
| **verify** | T-016 末尾 | 全部 SC 是否真实达成 / verification report 是否纸面声称 |

每 phase 审查使用 `Agent(subagent_type='codex:codex-rescue')` 启动，结论按 critical/warning/info 三档处置。

---

## 完成定义（Definition of Done）

参见 [spec.md §Definition of Done](./spec.md)，共 10 项；本 tasks.md 的 T-001 ~ T-016 完成即覆盖全部 10 项。
