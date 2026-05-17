# 修复任务 — Feature 167

---

## T-001 修复 parser：truncated 时保留尾部 result event

**文件**: `scripts/lib/parse-claude-stream-json.mjs`
**依赖**: 无
**验收**: F167-SC-001 — `truncated=true` 且 result event 在 50MB 后 → `events` 末位含 result

在 `workingStdout` 解析完毕后，增加 tail scan：
```javascript
// 若截断且 events 中没有 result event，扫描尾部 8KB 补救
const TAIL_SCAN_BYTES = 8 * 1024;
if (truncated && !events.some((e) => e?.type === 'result')) {
  const tail = stdout.slice(-TAIL_SCAN_BYTES);
  for (const line of tail.split('\n').reverse()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === 'result') {
        events.push(parsed);
        break;
      }
    } catch { /* skip */ }
  }
}
```

---

## T-002 修复 eval-mcp-augmented：group-agnostic realCostUsd + is_error

**文件**: `scripts/eval-mcp-augmented.mjs`
**依赖**: T-001（parser 修复后 tail result 可靠）
**验收**: F167-SC-002 + F167-SC-003

### 2a. 提取 driverEventsRaw 到 group-agnostic 路径

将原 `if (group === 'C') { driverEvents = parseClaudeStreamJson(...) }` 改为：
```javascript
// Parse stream-json for ALL groups:
//   - cohort C: 用于 reasoningTrace + consumption signals + realCostUsd
//   - cohort A/B: 仅用于 realCostUsd（防止 stop-loss 5x 低估）
const driverEventsRaw = parseClaudeStreamJson(runOutcome.stdout ?? '');
let driverEvents = null;
if (group === 'C') {
  driverEvents = driverEventsRaw;
}
```

### 2b. 在 realCostUsd 提取前做 is_error 检查

```javascript
// realCostUsd 对所有 group 派生（扩展 FR-019 到 A/B，防 stop-loss 5x 低估）
let realCostUsd = null;
const costResultEvent = driverEventsRaw?.events?.find((e) => e?.type === 'result');
if (costResultEvent) {
  if (costResultEvent.is_error === true) {
    // API 认证失败（如 401）路径：is_error=true + total_cost_usd=0
    // fail-fast：不污染 cumulativeCost，不写 run artifact
    cleanupTempFiles({ cfgPath: mcpConfigPath, telemetryPath, keepTemp: args.keepTemp });
    return {
      ok: false,
      costUsd: 0,
      error: `claude CLI error: is_error=true subtype=${costResultEvent.subtype ?? 'unknown'}`,
    };
  }
  realCostUsd = costResultEvent.total_cost_usd ?? null;
}
```

### 2c. 删除 cohort C 内的原 realCostUsd 块

原 `if (group === 'C' && driverEvents) { const resultEvent = ...; realCostUsd = ... }` 整块删除（已在 group-agnostic 路径处理）。

---

## T-003 新增单测

**文件**: `tests/unit/parse-claude-stream-json.test.ts`
**文件**: `tests/unit/sub-agent-meta.test.ts`
**依赖**: T-001, T-002
**验收**: F167-SC-007（3706+3 PASS）

### 3a. parser 新增用例（2 个）

- `(truncated + result in tail) truncated=true 且 result event 在 50MB 后 → events 末位含 result event`
  - 构造 > 50MB stdout：51 个 1MB assistant 行 + 1 个 result 行（在末尾）
  - 期望 `r.events[r.events.length - 1].type === 'result'`
  - 期望 `r.events[r.events.length - 1].total_cost_usd` 等于 fixture 值

- `(is_error result event) is_error=true result event → 仍保留在 events（parser 不做语义判断）`
  - 构造 `{"type":"result","subtype":"success","is_error":true,"total_cost_usd":0}`
  - 期望 `r.events[0].is_error === true`（parser 层不 filter）

### 3b. sub-agent-meta 新增用例（1 个）

- `(is_error=true NDJSON) auth-failure 路径 stream-json → result event 有 is_error=true`
  - 用 `parseClaudeStreamJson` 解析 auth-failure fixture
  - 验证 `events.find(e => e.type === 'result')?.is_error === true`

---

## T-004 运行单测 + build

```bash
npx vitest run
npm run build
```

期望：零失败 / 零类型错误（不低于 3706+3 PASS）

---

## T-005 SC-005/SC-008 验证：L001 × 1 真实 cohort C run

```bash
node scripts/eval-mcp-augmented.mjs --group C --task SWE-L001-pytest-module-imported-twice-under --repeat 1
```

**观察点**（对照 F166 SC-005/SC-008）：
1. 无 401 / is_error=true（意味着 SC-008 PASS：opus-4-7 API 可用）
2. `runResult.costUsd > 0`（真实 cost，非 0.25）
3. `runResult.driverEvents.reasoningTrace.length > 0`（reasoning trace 解析成功）
4. `runResult.costUsd ≤ 1.5`（SC-005 cost 上限）
5. `exit code 0`，无 parser fatal error

**记录**: 实测 wall clock + cost + reasoning trace snippet + consumption signals 数量

---

## T-006 Phase E-1 determinism：L003 × 3 + L005 × 3 真实 cohort C runs

```bash
# L003 × 3（分 3 次独立 run，不用 --repeat 3，每次单独观察）
node scripts/eval-mcp-augmented.mjs --group C --task SWE-L003-pytest-rewrite-fails-when-first --repeat 3

# L005 × 3
node scripts/eval-mcp-augmented.mjs --group C --task SWE-L005-astropy-ascii-qdp-table-format --repeat 3
```

**观察点**:
1. L003 × 3：`detectChangesCallCount` 是否全部相同（预期 0 syms payload-empty × 3）
2. L005 × 3：`changedSymbolsCount` 是否相同（预期同一 sampleFile × 3）
3. L003/L005 跨 3 次 `graphInjection.sourceHash` 是否一致（graph 注入 deterministic）

**判定**:
- 3/3 一致 → F167-SC-005/006 PASS，T052 可启动
- 仍不一致 → 排查 `prepareWorktree` exit code 检查 / worktree cache（Codex W-1 建议）

---

## T-007 更新文档

### 7a. F166 verification-report SC-005 + SC-008 更新

文件: `specs/166-eval-cli-infra-uplift/verification/verification-report.md`

将 §4 SC-005/SC-008 行从 N/A 更新为 PASS，填入：
- run ID + cost + reasoning trace bytes + consumption signals 命中数
- "T005 真实 run PASS" 标注

### 7b. competitive-evaluation-report §10.5.1.7 新增

文件: `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`

```markdown
##### 10.5.1.7 F166 真实效果实测（2026-05-18，opus-4-7 + 45min timeout）

[实测数据：L001 × 1 run 数据汇总]
- model: claude-opus-4-7（无 401 PASS）
- realCostUsd: $X.XX（≤ $1.5 上限）
- reasoning trace bytes: XXXX
- consumption signals: N/9（type 分布）
- wall clock: X.X min
- SC-005/SC-008: ✅ PASS

**结论**: F166 3 项改造在真实 API 调用路径下验证通过。
```

### 7c. competitive-evaluation-report §10.5.1.8 新增

```markdown
##### 10.5.1.8 Phase E-1 Determinism 独立验证（F167，2026-05-18）

[L003 × 3 + L005 × 3 数据汇总]

**根因总结**: Phase E-1（auth blocker workaround）的不一致是函数直调 vs MCP server 路径的 git state 差异
所致（C-1 worktree 有 patch applied，C-2/C-3 在 startCommit clean state）。真实 cohort C protocol
（prepareWorktree 每次 clean reset to startCommit + graph copy sourceHash deterministic）天然保证 determinism。

**验证结论**: L003 × 3 [N/3 一致] + L005 × 3 [N/3 一致]
→ **T052 Phase E-1 Gap: CLOSED**

**T052 启动前置 Codex C-2 风险备注**:
L005 detect_changes 返回 `functional_models.py`（38 syms，不相关）而非 `qdp.py`（task 目标），
稳定地不相关，非 determinism 问题。T052 运行时，cohort C 在 L005 类任务上会系统性获得无关 grounding，
影响 C vs A 的 lift 可归因性。此问题超出本 Feature scope（detect_changes 调用顺序 F164/F165 已 ship）；
建议 T052 结果解读时单独标注此 confound。
```

---

## T-008 最终验收：vitest + build + repo:check + release:check

```bash
npx vitest run
npm run build
npm run repo:check
npm run release:check
```

期望：3706+3 PASS / 零类型错误 / 零警告
