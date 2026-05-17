# Verification Report — Feature 166 Eval CLI Infrastructure Uplift

**Feature Branch**: `166-eval-cli-infra-uplift`
**Status**: 部分交付（partial delivery，依 EC-012 用户决策 A）
**日期**: 2026-05-18
**关联 commit**: 7d1b663 (spec) + efa49a1 (plan+tasks) + ba1de40 (implement)
**关联制品**: [spec.md](../spec.md) / [plan.md](../plan.md) / [tasks.md](../tasks.md)
**Codex Verify Phase 审查**: round 1 0 CRITICAL + 5 WARNING + 3 INFO 全修

---

## §1. 单测 / 构建 / 仓库一致性验证

### 1.1 vitest 全量结果

```bash
$ npx vitest run
Test Files  313 passed | 2 skipped (315)
     Tests  3706 passed | 5 skipped | 20 todo (3731)
   Duration  36.10s (transform 7.49s, collect 58.73s, tests 217.26s)
```

- **PASS: 3706**（master HEAD `3532e16` 基线 + 本 Feature 新增 30 用例）
- **FAIL: 0** ✅
- 新增测试用例（按 Feature 166 范围）：
  - `tests/unit/parse-claude-stream-json.test.ts`：19 用例（FR-010 (a)-(m) 13 个 + thinking block / 空行 / 非 string / 合法非 event / size guard / 短输入 6 个）
  - `tests/unit/eval-mcp-augmented-prompt.test.ts`：+8 用例（FR-004 / FR-007 / FR-018 / 结构性断言 / dry-run snapshot 替代）
  - `tests/unit/sub-agent-meta.test.ts`：+3 用例（Codex W-2 修复回归覆盖 — NDJSON 输入 / array tool_result content / 降级路径）

### 1.2 build

```bash
$ npm run build
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> spectra-cli@4.1.1 build
> tsc
(no output — tsc 零错误)
EXIT 0
```

✅ tsc 零类型错误

### 1.3 repo:check

```bash
$ npm run repo:check
[repo-check] status=pass
- agent-docs:* (8 项): all pass
- marketplace:* (2 项): all pass
- spec-driver-wrappers:* (4 项): all pass
- spectra-skills:* (3 项): all pass
- runtime-boundaries:* (3 项): all pass
- release-contract:* (16 项): all pass
- orchestration-overrides:overrides-file-exists: pass
EXIT 0
```

✅ 全 41 项 pass

---

## §2. preflight check 结果（T-008）

### 2.1 基础可用性（preflight 1，--output-format text）

```bash
$ claude --print --model claude-opus-4-7 --max-turns 1 --output-format text "say hi only"
Failed to authenticate. API Error: 401 Invalid authentication credentials
```

❌ **FAIL**：worktree 环境内未配置 `ANTHROPIC_API_KEY`

### 2.2 stream-json + verbose 输出格式（preflight 2，FR-018 / Codex W-008）

```bash
$ claude --print --model claude-opus-4-7 --max-turns 1 --output-format stream-json --verbose "say hi briefly"
```

API 401 失败，但 CLI 在 **auth-failure 路径**下仍输出 NDJSON 格式：

| 事件类型 | 出现次数 | 关键字段（auth-failure 路径） |
|---------|---------|------------------------------|
| `type: 'system'` `subtype: 'hook_started'` | 3 | session_id + hook_id + uuid（hooks 正常调度，与 API 无关） |
| `type: 'system'` `subtype: 'hook_response'` | 3 | hook_id + exit_code + outcome |
| `type: 'system'` `subtype: 'init'` | 1 | model: "claude-opus-4-7" + session_id + tools + mcp_servers（CLI 端 model 字符串合法） |
| `type: 'system'` `subtype: 'api_retry'` | 1 | error_status: 401 |
| `type: 'assistant'` | 1 | **synthetic** error message（非真实 driver reasoning，content 为 "Failed to authenticate..."） |
| `type: 'result'` `subtype: 'success'` `is_error: true` | 1 | total_cost_usd: 0（401 路径无消费）+ usage 字段存在但全 0 + modelUsage: {} |

**仅 auth-failure 路径下的部分验证**（Codex W-1 修正：不可作为 SC-005 等效证据）：

- ✅ NDJSON 每行均为合法 JSON object（验证 parser 在 CLI hook/init/error 路径下的 schema 假设）
- ✅ `result` event 存在 `total_cost_usd` 字段（仅证明字段存在；真实 cost > 0 路径未验证）
- ✅ `model: "claude-opus-4-7"` 被 CLI 接受（CLI 端 model 字符串合法；API 端可用性未验证）
- ✅ `--verbose` 启用后 system + hook + init + assistant + result 5 类事件齐全（FR-018 + W-003 决策的格式假设在 auth-failure 路径下成立）

**未验证项**（auth-failure 路径无法覆盖）：
- ❌ 真实 driver reasoning（含 thinking blocks + tool_use blocks）的 NDJSON schema
- ❌ 真实 tool_result content（如 plugin.json 回显）的 NDJSON schema（W-2 修复仅 unit test 覆盖）
- ❌ realCostUsd 派生路径在 `total_cost_usd > 0` 时的运行时正确性（line 1419-1428）
- ❌ 长 reasoning（45 min worst case）下 stdout 是否超过 50 MB size guard

### 2.3 preflight 结论

按 EC-012 处理：
- 部分验证：仅 auth-failure 路径下的 NDJSON 形态（FR-018 静态格式断言部分支持）
- ❌ API 不可达 → 不能跑 T-009 真实 run → 触发 EC-012

**用户决策（EC-012）**: 选 A — 跳过 SC-005 / SC-008，部分交付。

---

## §3. T-009 真实 cohort C run

⏭️ **跳过**（按 EC-012 用户决策 A，worktree 环境无 ANTHROPIC_API_KEY）

**部分代偿**（仅 auth-failure 路径的 NDJSON 形态验证）:
- preflight 2 收集到 **auth-failure 路径下** 的 stream-json + verbose 输出样本（synthetic assistant + 0-cost result）
- parser 单测 19 用例覆盖所有解析路径（含 size guard 51 MB / partial line / redacted_thinking / 大体积 1000 行 mock）。注：parser 实现是 line-based（`stdout.split('\n')` + 逐行 `JSON.parse`），不是真正的 incremental stream parser；mock 1000 行验证算法正确性，**真实流式 / 超大单行 / 长 reasoning 边界由 verify 真实 run 覆盖**
- realCostUsd 派生逻辑 line 1421-1428 仅做 **静态 code review** 验证（events.find + total_cost_usd 字段提取 + 类型校验），**运行时正确性未验证**

**未覆盖的实际数据**:
- 真实 driver reasoning（含 thinking blocks + tool_use blocks）的 NDJSON schema（spec 假设 A1）
- 真实 tool_result content（如 plugin.json 回显）的 NDJSON schema 在 reasoning-trace-mention 命中上的效果
- 真实 cohort C run 的实际 cost（预算 ≤ $1.5 上限未实测）
- consumption signals 数量与 165 baseline 的对比（reasoning-trace-mention 是否真实增多）
- driver 长 reasoning 时 stream-json 输出实际大小（是否触发 50 MB size guard）
- realCostUsd `total_cost_usd > 0` 路径运行时正确性

**后续行动**:
- 后续在配置了 ANTHROPIC_API_KEY 的环境（host 或 CI）跑 1 个真实 SWE-L001 cohort C run 补 SC-005 验证
- 后续在 T052 全量 450 runs 启动时验证 stop-loss + cost 累加是否准确

---

## §4. SC 对照检查表

| SC | 描述 | 状态 | 证据 |
|----|------|------|------|
| **SC-001** | DEFAULT_TIMEOUT_MS = 2_700_000 (45 min) | ✅ PASS | `scripts/eval-mcp-augmented.mjs:84`（Codex INFO 修正：行号已变为 84） + `grep -n "1_800_000\|1800000" scripts/eval-mcp-augmented.mjs` 无结果 |
| **SC-002** | buildClaudeArgsWithMcp 用 GATE_DESIGN 决策的 claude-opus-4-7 | ✅ PASS（**scope 内**） + ⚠️ scope 外残留 | line 926 `'claude-opus-4-7'` + 单测 FR-004 验证 PASS。**Scope 外残留**（Codex W-5 修正）：`scripts/eval-task-runner.mjs:221, 235, 547, 560` 仍有 `claude-sonnet-4-6` 字面值，这是 runner 模块（非 mcp-augmented），**不在 Feature 166 scope 内**；如未来 T052 启动需统一 driver model，需独立 Feature 处理 runner |
| **SC-003** | stream-json parser + 新单测 ≥13 个 | ✅ PASS | `scripts/lib/parse-claude-stream-json.mjs` (line-based parser，非 incremental stream) + 19 用例 PASS。注：(m) 1000 行 mock 验证算法正确性 + size guard 51 MB test 验证大体积截断；真正流式增量解析未实现（YAGNI） |
| **SC-004** | runOne cohort C 注入 driverEvents + extractConsumptionSignals 用 reasoningTrace | ✅ PASS | import line 50 + `scripts/eval-mcp-augmented.mjs:1330-1333` driverEvents 注入（Codex INFO 修正：行号 1330 非 1314） + line 1388-1395 reasoningTrace 替换 stdout + runResult line 1472-1474 driverEvents 字段 |
| **SC-005** | 真实 cohort C run cost ≤ $1.5 + 命令正常退出 + parser 解析无 fatal error | ⏭️ **N/A**（**部分代偿**） | EC-012 触发：worktree 无 API key；用户决策跳过。**部分代偿**（Codex W-1 修正：不可作为等效证据）：preflight 2 仅在 **auth-failure 路径**验证 NDJSON 形态；真实 cost > 0 / driver reasoning schema / consumption signals 数量均未实测 |
| **SC-006** | vitest 零失败 + build 零错误 + repo:check 零警告 | ✅ PASS | 3706 PASS（rebase 后实测基线，详见 §1.1）/ tsc 零错误 / repo:check status=pass |
| **SC-007** | 每 phase Codex 对抗审查 CRITICAL 全修，WARNING 有合理理由 | ✅ PASS | 4 phase × N round Codex review 共 7 CRITICAL + 24 WARNING + 8 INFO，CRITICAL 全修 + WARNING 16 修 + 8 记录原因（详见 §5） |
| **SC-008** | opus-4-7 preflight PASS | ⏭️ **N/A** | EC-012 触发：API 401（环境无 ANTHROPIC_API_KEY，非 model 不可用）；用户决策跳过 |

**汇总**: 6/8 PASS + 2/8 N/A（用户接受的部分交付状态）+ SC-002 含 scope 外 runner 残留警告

---

## §5. Codex review 历史汇总

### 5.1 Specify Phase（commit 7d1b663 前）

| 类别 | 数量 | 处置 |
|------|------|------|
| CRITICAL | 3 | 全修（cost 矛盾 / cohort A/B 共享 args / opus-4-7 可用性） |
| WARNING | 5 | 全修（CLI 参数矩阵 / redacted_thinking / EC 不足 / C-001 应改 NEEDS CLARIFICATION / 3676 PASS 基线漂移） |
| INFO | 1 | YAGNI 保留（parser 字段精简） |

### 5.2 Plan + Tasks Phase（commit efa49a1 前）

| 类别 | 数量 | 处置 |
|------|------|------|
| CRITICAL | 2 | 全修（T-009 task 候选错 / realCostUsd ground truth 缺失） |
| WARNING | 10 | 9 修 + 1 INFO 化（W-001 parser schema 保持宽松 YAGNI） |
| INFO | 1 | 保留（单 commit 接受） |

### 5.3 Implement Phase（commit ba1de40 前）

| 类别 | 数量 | 处置 |
|------|------|------|
| CRITICAL | 2 | 全修（OOM size guard / spawn error fail-fast） |
| WARNING | 4 | 2 修（NDJSON parseSubAgentSelfReport 回归 / totalLineCount 含空行）+ 2 记录（dry-run cost / 1MB 单行 + realCostUsd unit test） |
| INFO | 5 | 全部记录 YAGNI / 风险 |

### 5.4 Verify Phase（本 report commit 前）

待执行（T-011）。

### 5.5 累计

- **CRITICAL: 7 全修 ✅**
- **WARNING: 19 共 16 修 + 3 记录**（W-1 cost 估算 dry-run 不修；W-4 1MB 单行 + realCostUsd unit test 部分不修）
- **INFO: 7 全部记录** YAGNI

---

## §6. 已知限制 / 未消除风险（用于 T052 启动前判断）

### 6.1 部分交付带来的未验证项

1. **真实 cohort C run cost 上限未实测** — `EC-006` 定义 opus-4-7 ≤ $1.5 硬上限，但本 Feature 没在真实环境跑过 → T052 启动前**必须**先跑 1 个真实 run 验证。
2. **driverEvents 实际产生的体积未实测** — parser 加了 50 MB size guard，但真实 45 min driver 输出多大未知 → T052 启动后监控 truncated 字段。
3. **consumption signals 在 reasoningTrace 模式下的命中率未对比** — 与 165 §10.5.1 baseline 的 13/9 signals 对比缺失 → T052 启动前对比。

### 6.2 已识别但未修的风险

1. **dry-run cost 估算 $0.25 vs 真实 ~$1.25** + **cohort A/B stop-loss 始终低估 5x** （Codex Implement W-1 + Verify W-3 修正）：
   - dry-run 仅做流程演练不影响生产
   - stop-loss `cumulativeCost += result.costUsd` (line 1629) 中 `result.costUsd = realCostUsd ?? 0.25` (line 1459)
   - `realCostUsd` 仅在 cohort C 分支派生 (line 1434+)，**cohort A/B 永远 fallback 到 0.25**
   - 在 cohort C 单 cohort 跑批：累加值准确（用 realCostUsd）
   - 在 cohort A+B+C 混合跑批：cohort A/B 每次按 0.25 计入，cohort C 按真实 ~$1.25 计入；stop-loss 在 A/B 密集场景下**低估约 5x**（应是 ~$1.25 算成 ~$0.25）
   - **T052 全量 450 runs 启动前必须**：(a) 把 cohort A/B 也接 realCostUsd 派生（最小改动）；或 (b) 升级 DRY_RUN_COST_PER_RUN_USD 到 1.25 适配 opus model；或 (c) 引入 per-cohort cost estimate 配置
2. **parser 1 MB 单行未单测** （Codex Implement W-4）：size guard 51 MB test 覆盖了 51 个 1MB lines 累计场景；单行 1 MB 极端情况（如 driver 一次输出超大 thinking）未直接覆盖。Risk 在 verify 阶段真实 run 中实测。
3. **realCostUsd 派生无 runOne 级 unit test** （Codex Implement W-4）：runOne 整体难以 unit-test（需 spawn）。由 verify 真实 run 端到端覆盖（**本 Feature 跳过 → 后续 follow-up**）。
4. **dry-run 用户预算 preview UX 偏 5x** （Codex Verify INFO 新增）：args.dryRun=true 时输出的 cost preview 仍是 $0.25（DRY_RUN_COST_PER_RUN_USD），但实际跑 opus-4-7 是 ~$1.25。如用户依赖 dry-run preview 做预算决策，会误判 5x。修复路径：(a) 把 DRY_RUN_COST_PER_RUN_USD 升级到 1.25；或 (b) 按 model 字符串动态切换 dry-run cost。本 Feature 不修（YAGNI；用户已通过 EC-006 spec 知晓真实 cost ~$1.25）。
5. **45 min timeout 调度成本上升** （Codex Verify INFO 新增）：timeout 30→45 min 意味着 T052 全量 450 runs 最坏 wall-clock 上升 ~50%（13500 min → 20250 min ≈ 14 天 vs 9.4 天 single-threaded）。T052 spec 需评估并行调度策略（如 cohort 并发跑、跨机器分发）。

### 6.3 后续 Feature 必须做的事

1. 在配置了 API key 的环境跑 1 个 cohort C run 补 SC-005 / SC-008 验证
2. 调整 stop-loss budget 适配 opus-4-7 cost（DRY_RUN_COST_PER_RUN_USD 升级 / 单独 stop-loss budget 配置）
3. T052 全量 450 runs 启动（独立 Feature spec），需要 ~$562 (450 × $1.25) 预算
4. 如未来 cohort A/B 也需要 stream-json driver events 解析，复用 `parseClaudeStreamJson` 模块

---

## §7. 结论与建议

### 7.1 本 Feature 完成度（Codex Verify W-2 修正）

- **代码改动**：✅ FR-001 / FR-002 / FR-004 / FR-005 / FR-007 / FR-008 / FR-009 / FR-011 / FR-012 / FR-019 + 部分 FR-006 (YAGNI) 已落地；**FR-013 / FR-017 / FR-018 的运行时验证依 EC-012 defer**（worktree 无 API key）
- **单测覆盖**：✅ 新增 30 个测试用例全 PASS，全量回归 3706 PASS / 0 fail
- **静态验证**：✅ build / repo:check / Codex 7 CRITICAL 全修
- **端到端验证**：⏭️ **跳过**（按 EC-012 用户决策 A）；preflight 2 仅在 auth-failure 路径下验证了 NDJSON 形态（不可作为 SC-005 等效证据）

### 7.2 是否可 push 到 origin master

**建议**：等待用户在 deliverable report 中明确确认后 push（符合 CLAUDE.local.md "PUSH Origin Master 前列 Report 等待用户确认" 约定）。

代码层面：3 commit 已 rebase 到 master HEAD `3532e16` 上线性，无冲突。

### 7.3 T052 全量启动前置条件

启动 T052 全量 450 runs（**独立 Feature，尚未创建 spec**）前建议完成：

1. ✅ 本 Feature 3 项 CLI 改动落地（已完成）
2. ⏳ 1 个真实 cohort C SWE-L001 run 验证（本 Feature 跳过；建议未来 T052 spec 将其列为第 1 个 task）
3. ⏳ stop-loss budget 调整适配 opus-4-7 cost（独立 Feature 或 T052 spec 包含，详见 §6.2 #1）
4. ⏳ Cost 预算评估（450 × ~$1.25 ≈ $562 + buffer，决策是否启动）
5. ⏳ Wall-clock 调度策略评估（详见 §6.2 #5：450 runs × 45 min = 14 天 single-threaded）
6. ⏳ 如果 T052 全量也跑 cohort A/B，需先解决 stop-loss 低估问题（§6.2 #1）
