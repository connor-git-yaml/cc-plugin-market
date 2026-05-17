# 修复规划 — Feature 167

**特性**: SC-005/SC-008 + Phase E-1 determinism gaps + Stop-loss 5x 低估修复
**模式**: spec-driver-fix（4 阶段）

---

## §1. 问题总览

本 Feature 修复 3 个 gap（其中 1 个含 Codex 追加 bug）：

| # | 问题 | 类型 | 影响 |
|---|------|------|------|
| G1 | SC-005/SC-008 未实测真实 API 路径 | 验证缺口 | T052 启动依赖 |
| G2 | Phase E-1 non-determinism 原因未正式关闭 | 验证缺口 | T052 启动依赖 |
| G3 | cohort A/B stop-loss 5x 低估 | Code bug | T052 启动前必须修 |
| G4 | 50MB size guard 截断丢失 result event（Codex C-1）| Code bug | G3 修复的前提条件 |
| G5 | is_error=true 未检查（Codex C-3）| Code bug | SC-005 验证准确性 |

---

## §2. 架构决策

### 2.1 parser 修复：tail result 保留

**问题**: `parseClaudeStreamJson` 超 50MB 截取头部，丢失尾部 `result` event（含 `total_cost_usd`）。

**决策**: 保留头部 50MB 用于 reasoning trace 分析；同时无论是否截断，优先在尾部 8KB 扫描 `result` event。尾部扫到后 push 到 `events` 数组末位。

**边界**: 若尾部 8KB 内找不到 result event（极端场景），行为与修复前一致（result 缺失 → realCostUsd = null → fallback to DRY_RUN_COST_PER_RUN_USD）。

### 2.2 eval-mcp-augmented 修复：group-agnostic realCostUsd + is_error

**决策**:
1. 将 `parseClaudeStreamJson` 调用提到 group 判断之前，所有 group 均解析 stream-json
2. 从 `driverEventsRaw` 提取 `costResultEvent`；若 `is_error === true` → fail-fast 返回 `{ok:false, error: ...}`
3. cohort C 仍用 `driverEvents = driverEventsRaw`（reasoning trace + consumption signals）
4. cohort A/B 仅用于 realCostUsd 提取，不用 driverEvents（不影响 A/B 的 graphInjection / extractConsumptionSignals 逻辑）

**影响范围**:
- `realCostUsd` 提取逻辑从 L1433 移前 ~50 行（移到 telemetry 解析之前）
- 原有 `if (group === 'C' && driverEvents)` 内的 realCostUsd 块删除（已在 group-agnostic 路径处理）
- 返回值 `costUsd: realCostUsd ?? DRY_RUN_COST_PER_RUN_USD` 不变，但 A/B 现有真实值

### 2.3 验证策略（G1 + G2）

在配置了 claude.ai OAuth 的当前 worktree 跑真实 cohort C run：
- **SC-005 / SC-008**: SWE-L001 × 1 real run（验证 opus-4-7 + 45min timeout + parser，cost ≤ $1.5）
- **Phase E-1 determinism**: SWE-L003 × 3 + SWE-L005 × 3 real runs（各 3 次输出一致性验证）

总 budget 上限：1+1+3+3 = 8 runs；opus-4-7 预估 $0.3-1.5/run → $3-8 total（含范围内）。

**注**: Codex C-2 (grounding 语义，L005 检测 functional_models.py 非 qdp.py) 超出本 Feature scope，在 §10.5.1.8 和 T052 启动决策中文档化为 risk，不修改 detect_changes 调用逻辑。

---

## §3. 变更清单

### 3.1 代码变更

| 文件 | 变更 | 行数估计 |
|------|------|--------|
| `scripts/lib/parse-claude-stream-json.mjs` | tail result 扫描（truncated 时）| +12 行 |
| `scripts/eval-mcp-augmented.mjs` | group-agnostic parseClaudeStreamJson + is_error check + realCostUsd 重构 | +8 / -5 行 |

### 3.2 测试变更

| 文件 | 变更 |
|------|------|
| `tests/unit/parse-claude-stream-json.test.ts` | 新增 2 用例：(1) truncated + result 在 tail → preserved；(2) is_error=true result event → 仍保留在 events（parser 层不做语义判断）|
| `tests/unit/sub-agent-meta.test.ts` | 新增 1 用例：is_error=true 的 NDJSON 输入 → realCostUsd 提取返回 null |

### 3.3 文档变更

| 文件 | 变更 |
|------|------|
| `specs/167-.../fix-report.md` | 已存在（Phase 1 产物，Codex C-1/C-3 追加）|
| `specs/166-.../verification/verification-report.md` | §SC-005 + §SC-008 从 N/A 更新为实测数据 |
| `specs/147-.../competitive-evaluation-report.md` | 新增 §10.5.1.7（F166 真实效果）+ §10.5.1.8（determinism 确认）|

---

## §4. 验收标准

| SC | 描述 | 目标 |
|----|------|------|
| F167-SC-001 | parser tail result 保留 | truncated + result 在尾 → events 末位含 result |
| F167-SC-002 | is_error=true fail-fast | result.is_error=true → runOne 返回 {ok:false} |
| F167-SC-003 | cohort A/B realCostUsd 派生 | A/B run 时 result.costUsd = stream-json total_cost_usd（非 0.25）|
| F167-SC-004 | L001 × 1 真实 run PASS | opus-4-7 无 401 + cost ≤ $1.5 + parser 无 fatal error + SC-005 PASS |
| F167-SC-005 | L003 × 3 deterministic | 3/3 runs detect_changes 输出一致（payload-empty 均为 0 syms）|
| F167-SC-006 | L005 × 3 deterministic | 3/3 runs detect_changes 输出一致（同 sampleFile 同 changedSymbolsCount）|
| F167-SC-007 | vitest 零失败 + build 零错误 | 基于现有 3706 PASS 基线 + F167 新增 3 个 |
| F167-SC-008 | repo:check + release:check 零警告 | 维持 master 同水位 |

---

## §5. 不修改项

- `scripts/eval-task-runner.mjs` L221,235,547,560 的 `claude-sonnet-4-6` 字面值（F166 scope 外残留，不影响 T052）
- `detect_changes {"baseRef":"HEAD~1"}` 的调用逻辑（F164/F165 已 ship，C-2 超出 scope）
- T052 全量 450 runs 实际启动（独立决策点）

---

## §6. 执行顺序

1. 修复 `parse-claude-stream-json.mjs`（tail result 保留）
2. 修复 `eval-mcp-augmented.mjs`（group-agnostic realCostUsd + is_error）
3. 新增单测（3 个 test case）
4. 跑 `npx vitest run` 确认零失败
5. 跑 L001 × 1 真实 cohort C run（SC-005/SC-008 验证）
6. 跑 L003 × 3 + L005 × 3 真实 cohort C runs（Phase E-1 determinism）
7. 更新文档（§10.5.1.7 + §10.5.1.8 + verification-report SC-005/008）
8. 跑 `npm run build` + `npm run repo:check` + `npm run release:check`
