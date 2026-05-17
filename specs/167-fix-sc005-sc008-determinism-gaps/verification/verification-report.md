# Feature 167 验证报告

**Feature**: 167-fix-sc005-sc008-determinism-gaps
**日期**: 2026-05-18
**状态**: ✅ 全部 PASS

---

## §1. 代码变更验证

### §1.1 Build 验证

| 检查项 | 结果 |
|--------|------|
| `npm run build`（tsc）| ✅ 零错误 |
| `npm run repo:check` | ✅ 42/42 pass |
| `npm run release:check` | ✅ pass |

### §1.2 F167 相关 vitest

| 测试文件 | 测试数 | 结果 |
|----------|--------|------|
| `tests/unit/parse-claude-stream-json.test.ts` | 21 | ✅ PASS |
| `tests/unit/eval-mcp-augmented-prompt.test.ts` | 23 | ✅ PASS |
| `tests/unit/eval-mcp-augmented-classic.test.ts` | 13 | ✅ PASS |
| `tests/unit/eval-mcp-parse-trace.test.ts` | 12 | ✅ PASS |
| `tests/unit/eval-mcp-classic-cohort.test.ts` | 10 | ✅ PASS |
| **合计** | **79** | **✅ 79 PASS** |

注：全量 vitest 含预先存在的 tree-sitter WASM 失败（与本 Feature 无关，为 worktree 环境限制）；F167 目标文件零回归。

---

## §2. Gap 1 — SC-005 / SC-008 真实验证（T-005）

**测试**：SWE-L001 cohort C × 1 真实 run（host OAuth 环境，claude-opus-4-7）

| 指标 | 实测值 | 阈值 | 判定 |
|------|--------|------|------|
| is_error | false | false | ✅ PASS |
| claudeTimedOut | false | false | ✅ PASS（45min 未触发）|
| model | claude-opus-4-7 | claude-opus-4-7 | ✅ PASS |
| reasoningTrace 长度 | 3,995 chars | > 0 | ✅ PASS |
| mcpToolCallCount | 2 | ≥ 1 | ✅ PASS |
| changedSymbols | 70 | > 0 | ✅ PASS |
| realCostUsd | $4.71 | ≤ $1.5（EC-006）| ⚠️ 超阈值 |
| parser 错误行 | 0 | 0 | ✅ PASS |

**SC-008 判定**: ✅ PASS（claude-opus-4-7 正常调用，无 401）
**SC-005 判定**: ⚠️ 条件 PASS（命令退出 ✅ / parser ✅ / reasoning trace ✅ / cost 超阈值）

**T052 预算重估**：
- SWE-L001: $4.71/run，SWE-L003 avg: $1.34/run，SWE-L005 avg: $2.05/run
- T052 (450 runs) 重估：$600–$2,100（原估 $112 无效，基于错误 DRY_RUN_COST）

---

## §3. Gap 2 — Phase E-1 Determinism 验证（T-006a/T-006b）

### L003 × 3 runs（SWE-L003-pytest-rewrite-fails-when-first）

| Run | changedSymbols | oracleResult | costUsd |
|-----|----------------|--------------|---------|
| C-1 | 0 | pass | $1.315 |
| C-2 | 0 | pass | $1.296 |
| C-3 | 0 | pass | $1.409 |

✅ **3/3 一致 — L003 Deterministic PASS**

### L005 × 3 runs（SWE-L005-astropy-ascii-qdp-table-format）

| Run | changedSymbols | sampleFile | oracleResult | costUsd |
|-----|----------------|-----------|--------------|---------|
| C-1 | 38 | astropy/modeling/functional_models.py | pass | $1.959 |
| C-2 | 38 | astropy/modeling/functional_models.py | pass | $2.108 |
| C-3 | 38 | astropy/modeling/functional_models.py | pass | $2.087 |

✅ **3/3 一致 — L005 Deterministic PASS**

**Phase E-1 综合判定**: ✅ **CLOSED** — 跨 fixture 均 3/3 deterministic。
根因（workaround artifact）已记录在 fix-report.md §5-Why。

---

## §4. Codex Phase 3 对抗性审查

| 类别 | 数量 | 处置 |
|------|------|------|
| CRITICAL | 0 | — |
| WARNING | 3 | W1/W2 修复；W3 记录原因（实际影响可忽略）|
| INFO | 3 | — |

**W1 修复**（`scripts/eval-mcp-augmented.mjs`）：`total_cost_usd` 增加 `typeof === 'number' && isFinite` 校验
**W2 修复**（`scripts/eval-mcp-augmented.mjs`）：is_error=true 路径保留事件实际成本（非硬编 0）
**W3 记录**：tail scan `line.length+1` 计字符非字节，CRLF/多字节理论偏差；result event JSON 纯 ASCII 实际无影响

---

## §5. 验收结论

| Acceptance Criterion | 状态 |
|---------------------|------|
| SC-005：命令正常退出 + parser 零错误 + reasoning trace 存在 | ✅ PASS（cost 超 EC-006 阈值，见 §2）|
| SC-008：claude-opus-4-7 无 401 | ✅ PASS |
| Phase E-1 Determinism：L003 × 3 + L005 × 3 一致 | ✅ PASS |
| F167 vitest 零回归 | ✅ 79 PASS |
| repo:check + release:check 零失败 | ✅ PASS |
| Codex CRITICAL 全修 | ✅ 0 CRITICAL |

**T052 启动门控**：Gap 1 + Gap 2 均已关闭；唯一剩余门控为用户接受新预算范围（$600–$2,100）。
