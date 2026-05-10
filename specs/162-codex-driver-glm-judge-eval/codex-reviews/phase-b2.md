# Codex 对抗审查 — Phase: B2 (GLM judge calibration runner + Pearson + 双 judge 对比)

> Feature: 162
> Reviewed at: 2026-05-10
> Subagent: codex:codex-rescue
> Final status: ✅ 4 轮 review（含 1 误判反驳）后 critical/warning 全清

## 审查轮次概要

| 轮次 | Critical | Warning | Info | 阻断 commit |
|------|---------:|--------:|-----:|------------|
| iter-1 | 4 | 3 | 4 | 是 |
| iter-2 | 1（C-3 部分修 + C-6 新发现） | 0（W-1/W-2/W-3 全清） | 0 | 是 |
| iter-3 | 1（C-5 codex 误判，主线程反驳） | 0 | 0 | 否 |
| iter-3 主线程实测 | 0 | 0 | 0 | 否 |

## iter-1 finding 处置（4C+3W+4I）

| 编号 | 主题 | 处置 |
|-----|------|------|
| C-1 | Calibration 对比对象错误（应 GLM vs 旧 Codex judge） | 修：runner Promise.all 同时调 GLM + Codex baseline judge；artifact 记录 glm_score + codex_score + 3 组 IoU + Pearson(GLM, oracle) |
| C-2 | Oracle 被 expectedOutcome 替代 | 修：实现 runOracle 函数，与 fixture goldpatch.diff 实测 token Jaccard（threshold 0.6，与 eval-diff-fuzzy-match 对齐）；degraded path 用 string-level 比对 + confidence 0.5；refusal 直接判 oracle_fail；记录 method 字段 |
| C-3 | 缺少 15 数据点硬门禁 | 修：validateRecordsIntegrity 强制校验 records.length===15 + 每条含 GLM/Codex score；fallback 例外不要求 GLM slot；不达则 exit 非 0 |
| C-4 | Calibration prompt 与生产 jury prompt 脱节 | 修：抽 buildAdversarialPrompt 到 scripts/lib/judge-prompt-builder.mjs；eval-judge-jury 改 import；runner 也用共享版本；新增 vitest case byte-identical 验证 |
| W-1 | dry-run 自确认 mock | 修：Mulberry32 PRNG（seed=1），driver 80/20 翻转 expected 输出，judge score base 6.5/3.5 ±1.5 noise；实测 IoU=0.90 / Pearson=0.78（合理 [0.7, 0.95]） |
| W-2 | record schema 缺 driverPatch | 修：新增 driverPatch + oracle.confidence/method/similarity + judges.<slot>.rawResponse/refusalDetected + error + integrity 字段 |
| W-3 | fallback 跳过 SILICONFLOW_API_KEY 检查 | 修：juryNeedsSiliconflow 函数；fallback path 含 Kimi (siliconflow:*) → 仍校验 SILICONFLOW_API_KEY |
| I-1~I-4 | Pearson 算法 / SciPy 等价 / DEFERRED 处置 | 接受 |

## iter-2 残留 + 新发现处置

| 编号 | 主题 | 处置 |
|-----|------|------|
| C-3 残留 | oracleFails 单独不触发 invalid | 修：validateRecordsIntegrity 行 887 invalid 条件加 oracleFails > 0；oracleFails 计 4 种异常方法（exception / driver-failed / degraded-goldpatch-missing / confidence===0）；新增 vitest case "15 条 record 全为 oracle 异常时返回 invalid" |
| C-6 critical 新发现 | fallback jury Opus/Kimi 单点判定漏洞 | 修：extractFallbackFailClosedPassSet + annotateFallbackConsensus；fallback IoU 计算改用 fail-closed pass set（Opus AND Kimi 都 pass 才视为 pass，分歧时 fail）；artifact 含 disagreement + tieBreakResult 字段；新增 vitest case 验证 |

## iter-3 主线程裁决：C-5 codex 误判

### Codex iter-3 finding

> C-5: ❌ | scripts/calibrate-glm-judge.mjs:859 | driver error 后 continue（oracleFails 未纳入 invalid 判断）

### 主线程实测反驳

代码现状（行 845-893）：

```js
function validateRecordsIntegrity(records, { expectGlm }) {
  ...
  let glmFails = 0, codexFails = 0, oracleFails = 0;
  for (const r of records) {
    if (r.error) {
      if (r.error.phase === 'driver') codexFails += 1;
      else oracleFails += 1;       // ← line 859
      continue;                    // ← line 860 (skip rest of loop body)
    }
    // 个别 GLM/Codex/Oracle 评估
    if (!r.oracle || r.oracle.method === 'exception' || r.oracle.method === 'driver-failed' || r.oracle.confidence === 0) {
      oracleFails += 1;            // ← line 880-883
    }
  }
  // C-5：oracleFails > 0 也直接 invalid
  if (glmFails > 0 || codexFails > 0 || oracleFails > 0) {  // ← line 887
    return { valid: false, ... };
  }
  return { valid: true, ... };
}
```

**Codex 误读**：以为 `continue` (line 860) 跳过了 invalid 判断。但 invalid 判断在 for loop 之后（line 887），不受 continue 影响。oracleFails 在 continue 之前已经累加。

**主线程实测证据**：

```
节点直接调用 validateRecordsIntegrity，输入 15 条 record 全为 method:'exception'：
> valid: false
> reason: Calibration round records 不完整：GLM 失败 0 个 / Codex 失败 0 个 / oracle 异常 15 个，不达 plan iter-2 W-3 统计功效要求（需 15/15 全部 valid）
> oracleFails: 15
```

**Vitest 覆盖**：

```
tests/unit/calibrate-glm-judge-integrity-fallback.test.ts:144
"15 条 record 全为 oracle 异常（method:'exception'）时返回 invalid"
expect(integrity.oracleFails).toBe(15);  ← 已 PASS
```

### 主线程裁决：**C-5 已修，codex iter-3 误判**

裁决依据：
1. validateRecordsIntegrity 函数 line 887 invalid 条件已含 `oracleFails > 0`
2. for-loop 中 line 859 + line 880-883 双路径都累加 oracleFails
3. continue 仅跳过 loop 内剩余检查，不影响 loop 之后的 invalid 判断
4. 主线程节点实测 + 10/10 vitest case 全 pass，覆盖 oracle 全 exception 触发 invalid 场景
5. codex iter-3 行号误指 line 859（实际 invalid 判断在 line 887）

按 CLAUDE.local.md 约定，**真实 bug → 立即修；codex 误判（行号指错 + 没读到 line 887 的 invalid 条件）→ 文档标记主线程反驳**。

## 最终结论

- **critical 清零** + **warning 清零**
- 主线程裁决：**Phase B2 ready for commit；可进入 Phase C / verify**

## 关键产出（Phase B2 全文件清单）

| 文件 | 行数 | 角色 |
|-----|-----:|------|
| scripts/lib/pearson.mjs | 65 | 零依赖 Pearson correlation (two-pass / Welford-style) |
| scripts/lib/judge-prompt-builder.mjs | ~50 | C-4 共享 prompt builder |
| scripts/calibrate-glm-judge.mjs | ~1100 | calibration runner（dry-run + api-key-check + 双 judge + oracle 实测 + integrity + fallback fail-closed）|
| tests/unit/eval-pearson.test.ts | 73 | 5 case + SciPy 等价对比 |
| tests/unit/eval-judge-jury-prompt-builder.test.ts | ~50 | 3 case prompt 一致性 |
| tests/unit/calibrate-glm-judge-integrity-fallback.test.ts | ~250 | 10 case integrity + fallback fail-closed |
| specs/162-.../calibration-runbook.md | ~150 | ops runbook（实跑路径 + DEFERRED 触发指引）|
| specs/162-.../calibration-result.json | ~50 | dry-run artifact |

总计：~1800 行实施代码 + 测试，0 新依赖。

## 关键架构决策（Phase C / verify 阶段须遵守）

通过 4 轮对抗审查倒逼出的实施决策：

1. **Calibration 双 judge 同跑**：GLM + 旧 Codex baseline 同时调用，3 组 IoU + Pearson(GLM, oracle)
2. **真实 oracle**：runOracle 函数 token Jaccard threshold 0.6，与 eval-diff-fuzzy-match 对齐
3. **Records integrity 硬门禁**：records.length === 15 + GLM/Codex score 必须 present + oracleFails 任一异常即 invalid
4. **Prompt builder 共享**：buildAdversarialPrompt 抽到 lib，runner 与生产 jury 同源
5. **Dry-run 受控随机**：Mulberry32 PRNG seed=1，driver 80/20 翻转，judge score ±1.5 noise；预期 IoU 0.7-0.95（不为 1.0）
6. **Fallback fail-closed**：Opus AND Kimi 都 pass 才视为 pass，分歧时 fail（不再单点判定）
7. **API key 检查路径**：juryNeedsSiliconflow 函数判定，含 Kimi/GLM 任一即需 SILICONFLOW_API_KEY

## DEFERRED 项

| Task | 状态 | 触发条件 |
|------|------|---------|
| T039 实跑 calibration | DEFERRED-TO-API-KEY-AVAILABLE | ops 准备 SILICONFLOW_API_KEY，跑 `node scripts/calibrate-glm-judge.mjs --rubric-version v1` |
| T040 阈值判定 + rubric 调整 | 同 T039 | 依赖 T039 实测结果 |
| T041 回退到 2-judge | 同 T039 | 依赖 T039/T040 |

详见 `calibration-runbook.md`。
