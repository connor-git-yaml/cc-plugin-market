# 问题修复报告 — Feature 167

**Feature**: 167-fix-sc005-sc008-determinism-gaps
**关联背景**: F165 + F166 已 ship，留下两个 T052 启动前的 known gap
**日期**: 2026-05-18

---

## 问题描述

Feature 166 的 3 项 CLI 改造（45min timeout + claude-opus-4-7 + reasoning trace parser）在 worktree sandbox 中无 `ANTHROPIC_API_KEY` 导致 401，触发 EC-012 部分交付：
- SC-005 / SC-008 标记为 N/A（未实测 API 可用性、真实 cost、reasoning trace schema）
- Phase E-1（F165 §10.5.1.3）记录了 detect_changes 跨 run 不 deterministic（L003: 8/0/0；L005: qdp.py vs functional_models.py）

T052 全量 450 runs 启动前需要补齐以上两个 gap 的 **实测验证数据**。

附加 code bug（F166 §6.2 #1，T052 启动前必须修）：cohort A/B 的 `realCostUsd` 未从 stream-json 事件派生，stop-loss 累加值只计 `DRY_RUN_COST_PER_RUN_USD = $0.25`，而 opus-4-7 实际 ~$1.25/run → stop-loss 5x 低估。

---

## 5-Why 根因追溯

### Gap 1: SC-005/SC-008 N/A

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | SC-005/SC-008 为何未验证？ | EC-012 触发：worktree sandbox env 中 `claude` CLI 返回 401 |
| Why 2 | Worktree 为何无法通过认证？ | spec-driver plugin 创建的 worktree 为隔离 sandbox，`~/.claude/settings.json` OAuth 认证在某些 worktree 中不被继承 |
| Why 3 | F166 为何未提前检测认证状态？ | 验证计划假设 worktree 会继承 host OAuth；没有做 auth-preflight 前置 gate |
| Why 4 | 为何没有 host-env fallback 路径？ | 验证流程没有区分"worktree sandbox"和"host shell"两种运行场景 |
| Why 5 | 为何未被测试体系捕获？ | unit test 用 mock 覆盖 CLI spawn，无法检测 auth 配置在 subprocess 中的传播 |

**Root Cause**: F166 CLI 验证 100% 在 worktree sandbox 中执行，该 sandbox 恰好未继承 host OAuth，导致 API 调用全部 401。auth-preflight gate 缺失，EC-012 被用作 bypass 而不是修复触发器。

**Root Cause Chain**: 401 症状 → worktree env 无 auth → sandbox 隔离了 OAuth config → 验证计划无 auth-preflight → unit test 屏蔽了 spawn 级别的 auth 检测

**已验证（2026-05-18）**: 当前 `silly-bouman-7aac0b` worktree 运行 `claude auth status` 返回 `loggedIn: true / authMethod: claude.ai / apiProvider: firstParty`，`claude-haiku-4-5` 实测返回 "OK" → 当前 worktree 可执行真实 API 调用。

---

### Gap 2: Phase E-1 Determinism

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | L003/L005 detect_changes 为何跨 run 不一致？ | Phase E-1 workaround 直接 import `handleDetectChanges` 函数并调用，绕过 MCP server JSON-RPC 路径 |
| Why 2 | 直接调用为何导致不一致？ | `handleDetectChanges` 调用 `git diff HEAD~1`；C-1 worktree 可能有 patch-applied 状态（HEAD 不同），C-2/C-3 在 `startCommit` clean state → diff 输出不同 → changedSymbols 不同 |
| Why 3 | Worktree git 状态为何不同？ | Phase E-1 workaround 不是每次从 `startCommit` 创建新 worktree；同一 worktree 可能在 C-1 run 后有遗留 patch commit，影响 C-2/C-3 的 HEAD~1 解析 |
| Why 4 | 真实 cohort C protocol 为何未复现？ | 真实 protocol 每次 `prepareWorktree` 从 `startCommit` 创建独立 worktree，driver 在 clean state 下调用 detect_changes；graph.json 是固定快照 copy → 输入完全 deterministic |
| Why 5 | 为何未在 F165 时修复？ | Phase E-1 是 auth-blocker workaround 的产物；F165 #2 真实 run（2026-05-17）已证明真实 protocol 9/9 一致，但未作 formal 3×3 determinism 测试记录 |

**Root Cause**: Phase E-1 不一致是 **auth-blocker workaround artifact**，不是真实 cohort C protocol 的 bug。真实 protocol 通过 `prepareWorktree` 保证每次 clean git state，detect_changes 结果完全由 (graph.json snapshot × clean startCommit diff) 决定，两者均 deterministic。

**Root Cause Chain**: 8/0/0 症状 → C-1 vs C-2/C-3 git state 不同 → Phase E-1 workaround 重用了 non-clean worktree → auth-blocker 迫使使用 workaround → 真实 protocol 从未有此问题

**已有强证据（F165 §10.5.1.4 §10.5.1 "Phase E-1 对比"）**:
- 真实 cohort C protocol (2026-05-17 #2): L005 9/9 一致 `functional_models.py (38 syms)` — "Phase E-1 跨 cohort 不一致问题**在真实 protocol 下未复现**"
- L003: 真实 run 3/3 payload-empty（一致）
- 本 Feature 通过 3×3 独立重测正式关闭此 gap

---

### Bug 3: Stop-Loss 5x 低估（cohort A/B）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | cohort A/B stop-loss 为何低估 5x？ | `cumulativeCost += result.costUsd ?? 0`；cohort A/B 的 `result.costUsd = null ?? DRY_RUN_COST_PER_RUN_USD = 0.25` |
| Why 2 | cohort A/B 为何 costUsd 是 0.25？ | `realCostUsd` 派生逻辑在 `if (group === 'C' && driverEvents)` 条件内，A/B 不进此分支 |
| Why 3 | driverEvents 为何不解析 A/B？ | `driverEvents = parseClaudeStreamJson(...)` 在 `if (group === 'C')` 内，A/B 的 stdout 从未解析 |
| Why 4 | F166 为何只做 cohort C？ | F166 spec FR-019 明确 "cohort C 专用"；A/B 未使用 stream-json 输出做任何后续分析 |
| Why 5 | 为何影响 T052？ | 若 T052 跑 A/B/C 混合 450 runs，cohort A/B 每次按 $0.25 计而实际 ~$1.25，stop-loss 在 A/B 密集时低估 5x，可能超预算 |

**Root Cause**: `buildClaudeArgsWithMcp` 对**所有** cohort 均使用 `--output-format stream-json`，但 `parseClaudeStreamJson` 和 `realCostUsd` 派生只在 cohort C 执行。修复：将 realCostUsd 派生提取到 group-agnostic 路径。

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `scripts/eval-mcp-augmented.mjs` | L1332 `if (group === 'C')` driverEvents parse | realCostUsd 派生只限 C | 提取 `parseClaudeStreamJson` 到 group-agnostic 路径，A/B 也派生 realCostUsd |
| `scripts/eval-mcp-augmented.mjs` | L1434 `if (group === 'C' && driverEvents)` | realCostUsd 计算门控 | 移出 group===C 条件（或 A/B 复用相同 resultEvent 提取逻辑） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `scripts/eval-mcp-augmented.mjs` | L1459 `costUsd: realCostUsd ?? DRY_RUN_COST_PER_RUN_USD` | A/B fallback to 0.25 | 修复后 A/B 有 realCostUsd → fallback 只在解析失败时触发（保险兜底，安全） |
| `scripts/eval-mcp-augmented.mjs` | L1171 `costUsd: DRY_RUN_COST_PER_RUN_USD` | dry-run 路径永远 0.25 | **安全**：dry-run 场景没有真实 LLM 消费，0.25 是意图内的估算 |
| `scripts/eval-task-runner.mjs` | L221,235,547,560 | `claude-sonnet-4-6` 字面值 | F166 Codex SC-002 known residual：runner 模块不在 scope，T052 仅 mcp-augmented；安全 |

### 同步更新清单

- **代码**: `scripts/eval-mcp-augmented.mjs` — realCostUsd 提取重构（约 10 行）
- **测试**: `tests/unit/eval-mcp-augmented.test.ts` — 验证 cohort A/B dry-run cost 仍是 0.25；real-run costUsd 来自 stream-json
- **文档**: `specs/166-eval-cli-infra-uplift/verification/verification-report.md` — §SC-005/008 从 N/A 更新为实测 PASS
- **文档**: `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` — 新增 §10.5.1.7 + §10.5.1.8

---

## 修复策略

### 方案 A（推荐）— 最小化实现：提取 realCostUsd 到 group-agnostic 路径

在 `parseClaudeStreamJson` 调用后立即提取 `resultEvent.total_cost_usd`，作用于所有 group：

```javascript
// Before line 1328: parse stream-json for ALL groups（cost tracking + cohort C reasoning trace）
const driverEventsRaw = parseClaudeStreamJson(runOutcome.stdout ?? '');

// Cohort C 才需要完整 driverEvents（reasoning trace + events 注入）
let driverEvents = null;
if (group === 'C') {
  driverEvents = driverEventsRaw;
}

// realCostUsd 对所有 group 派生（FR-019 扩展到 A/B，防止 stop-loss 5x 低估）
const costResultEvent = driverEventsRaw?.events?.find((e) => e?.type === 'result');
let realCostUsd = costResultEvent?.total_cost_usd ?? null;
```

这样 cohort A/B 的 `realCostUsd` 也从真实 stream-json 派生，stop-loss 累加准确。

**优点**: 最小代码变更（约 6 行 diff）；不改变 A/B 的 driverEvents/reasoningTrace 逻辑；fallback to DRY_RUN_COST_PER_RUN_USD 只在解析失败时触发（保险）。

### 方案 B（备选）— 提升 DRY_RUN_COST_PER_RUN_USD 到 $1.25

```javascript
const DRY_RUN_COST_PER_RUN_USD = 1.25; // opus-4-7 实测 ~$1.25
```

**缺点**: dry-run cost preview 不准（应该是 0.25 用于 preview）；真实 run 中若 stream-json 解析失败，fallback 会过度消耗 stop-loss budget。不推荐。

---

## Spec 影响

- **不需要**更新 spec.md（F166 已落地，本 Feature 是验证补充）
- 需要更新的文档：
  - `specs/166-eval-cli-infra-uplift/verification/verification-report.md` §4（SC-005/SC-008）
  - `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §10.5.1.7 + §10.5.1.8

---

## Codex Phase 3 对抗性审查结论（2026-05-18）

| 类别 | 发现 | 处置 |
|------|------|------|
| CRITICAL | 0 | — |
| WARNING 1 | `total_cost_usd` 缺类型校验，string/object 可能污染 cumulativeCost | **修复**：加 `typeof rawCost === 'number' && isFinite` 校验 |
| WARNING 2 | is_error=true 路径硬编 `costUsd:0`，若事件含非零成本会被丢弃 | **修复**：保留事件实际 errCost（通常为 0，但非零时正确传递）|
| WARNING 3 | tail scan 用 `line.length + 1` 计字符非字节，CRLF/多字节偏差 | **记录**（result event JSON 纯 ASCII，实际不影响；修复成本高于收益）|
| INFO 1 | T-001 测试的 result offset ~53MB，确实在 50MB 截断点之后，测试有效 | — |
| INFO 2 | A/B cohort 通过 buildClaudeArgsWithMcp 使用 stream-json，realCostUsd 派生正确 | — |
| INFO 3 | cleanupTempFiles 不含 git restore，但 prepareWorktree 随机 segment 隔离，无跨 run 污染风险 | — |

---

## 已知风险

1. **L001 cohort C run 时间不确定**：F165 基线 L001 平均 7.1 min wall clock（sonnet, 30min timeout）；F166 改 opus-4-7 + 45min timeout，实际时长可能 10-20 min/run → 单次 cost 可能 $0.8-2.0
2. **L005 cohort C run cost**：L005 astropy + 不相关 grounding → driver 可能花更多 token 分析再 reject → $0.5-1.5/run
3. **Budget 风险**：1 × L001 + 3 × L003 + 3 × L005 = 7 runs；worst case ~$1.5 + $0.5×3 + $1.5×3 = $7.5；best case ~$0.8 + $0.2×3 + $0.5×3 = $3.9
4. **Phase E-1 若仍不一致**：需检查 `prepareWorktree` startCommit 在多次调用时是否有 cache/state leak（unlikely，已有 F163 修复）
