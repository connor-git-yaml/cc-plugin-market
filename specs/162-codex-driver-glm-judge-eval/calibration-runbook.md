---
feature_id: 162
phase: B2
artifact: calibration-runbook
status: deferred-to-api-key-available
generated_at: 2026-05-10
---

# Feature 162 Phase B2 — GLM judge calibration runbook

> **当前状态**：T039 / T040 / T041 标记 `[DEFERRED-TO-API-KEY-AVAILABLE]`。
> 实施代码（T036/T037/T038）已落地并通过 dry-run + 单元测试。本 runbook 记录 ops
> 在 `SILICONFLOW_API_KEY` + `codex CLI` 就绪后的实跑流程。
>
> **2026-05-10 修订（Codex 对抗审查 C-1/C-2/C-3/C-4/W-1/W-2/W-3 修复后）**：
>
> 1. **三组 IoU 评估**（FR-022 字面"GLM vs Codex"合同）：
>    - `IoU(GLM_pass, oracle_pass)` ≥ 0.7 — FR-022 GLM 达标主判定
>    - `IoU(Codex_pass, oracle_pass)` — 旧 Codex baseline，记录用
>    - `IoU(GLM_pass, Codex_pass)` — GLM 与旧 Codex 一致性，FR-022 字面对比
> 2. **真实 oracle**（C-2）：driver patch 与 fixture goldpatch.diff 通过 token
>    multiset Jaccard 实测比对；阈值 0.6（与 `eval-diff-fuzzy-match.mjs` 默认对齐）。
>    refusal 输出直接判 oracle_fail（拒答不视为功能修复）。
> 3. **records 完整性硬校验**（C-3）：必须 15/15 records 全 valid（含 GLM score、
>    Codex score 与 oracle 全部就位）。任一缺失则 round 失败（退出码 2），不进入
>    阈值评估。
> 4. **共享 prompt**（C-4）：calibration runner 与生产 jury 共用
>    `scripts/lib/judge-prompt-builder.mjs::buildAdversarialPrompt`，杜绝 prompt 漂移。
> 5. **dry-run 受控随机性**（W-1）：mock 引入 driver 80/20 翻转 + judge ±1.5 噪声
>    （固定 seed 1），让 dry-run IoU/Pearson 落在 [0.7, 0.95] 区间，证明 wiring 真实。
>
> **2026-05-10 iter-2 修订（Codex C-5 + C-6 critical 修复）**：
>
> 6. **integrity 校验扩展**（C-5）：`validateRecordsIntegrity` 现把 `oracleFails`
>    纳入 invalid 判定。当 15 条 records 全为 oracle 异常（method:'exception' /
>    confidence=0 / 'driver-failed' / 'degraded-goldpatch-missing'）时，calibration
>    必须返回 invalid 并退出码 2，不允许在零有效 oracle 数据上跑阈值评估。
> 7. **fallback 2-judge fail-closed**（C-6）：fallback 路径强制 Opus + Kimi 一致
>    同意制，仅当两 judge 同时打 pass（score ≥ 5）才视为 final pass：
>    - `extractFallbackFailClosedPassSet` 仅在双 pass 加入 set
>    - `annotateFallbackConsensus` 给 record.judges 加 `disagreement` (boolean)
>      与 `tieBreakResult` ('pass' | 'fail-closed') 字段
>    - 任一 judge 缺失 score / 打 fail / 两者分歧 → fail-closed（不计 pass）
>    - 阈值评估改用 fail-closed set 计算 `IoU(Fallback_failClosed, oracle)`，
>      不再用 codex baseline 单点 IoU
>    - artifact `metrics.iouFallbackFailClosed` + `metrics.fallbackDisagreementCount`
>      暴露给 ops 排查

## 1. 前置条件

实跑 calibration 需要：

- [ ] **SILICONFLOW_API_KEY** 已配置（GLM-5.1 + Kimi-K2.6 judges 依赖 SiliconFlow）
- [ ] **claude CLI** 已登录 Claude Max subscription（Opus judge 走此通道，无需 ANTHROPIC_API_KEY）
- [ ] **codex CLI** 已登录 ChatGPT Pro subscription（driver gpt-5.5 + 旧 Codex baseline judge 走此通道）
- [ ] 仓库构建通过：`npm run build` 退出码 0
- [ ] Phase A + B1 验证已通过（T023, T034 closed）

预算（C-1 修复后含 Codex baseline judge，每 run 多 1 个 LLM 调用）：

| Round | LLM 调用 | 预估成本 |
|-------|---------|---------|
| Round 1 (rubric v1) | 5 fixture × 3 runs × (1 driver + 3 judges + 1 codex baseline) = 75 calls | ~$6 |
| Round 2 (rubric v2, 若触发) | 同上 | ~$6 |
| Round 3 (rubric v3, 若触发) | 同上 | ~$6 |
| Fallback 2-judge 重测 | 5 × 3 × (1 driver + 2 judges + 1 codex baseline) = 60 calls | ~$4 |

## 2. T039 — 实跑 Round 1

```bash
# 验证 key 就绪
node scripts/calibrate-glm-judge.mjs --api-key-check
# 期望：退出码 0，输出 "SILICONFLOW_API_KEY present — calibration ready."

# 实跑 calibration round 1
SILICONFLOW_API_KEY=sk-... node scripts/calibrate-glm-judge.mjs --rubric-version v1
```

预期输出关键指标（plan §2.5.5 阈值；C-1 修订后含三组 IoU）：

| 指标 | 阈值 | FR | 含义 |
|------|------|----|------|
| `IoU(GLM_pass, oracle_pass)` | ≥ 0.70 | FR-022 | GLM judge 与真实 oracle 的一致度（主判定） |
| `IoU(Codex_pass, oracle_pass)` | 记录用 | — | 旧 Codex baseline（不参与阈值，比较参考） |
| `IoU(GLM_pass, Codex_pass)` | 记录用 | FR-022 字面 | GLM 与 Codex judge 一致度 |
| `Pearson(GLM_score, oracle_pass)` | ≥ 0.60 | FR-023 | GLM 评分与 oracle 的线性相关 |
| `Refusal IoU(detected, expected)` | ≥ 0.50 | FR-024 | 拒答 surface 检测准确度 |

artifact 写入 `specs/162-codex-driver-glm-judge-eval/calibration-result.json`，含（W-2 修复）：

- `records[]` — 15 条 (fixture × run) 数据点，每条含：
  - `fixtureId`, `runId`, `startedAt`, `finalizedAt`, `expectedOutcome`
  - `driverPatch` — driver 完整产出（C-2 oracle 实测对象）
  - `driverTokens`
  - `oracle: { passed, confidence, method, similarity, error? }` — C-2 实测结果
  - `judges: { glm, codex, kimi, opus }` — 每 slot 含 `{ judge, score, rationale, rawResponse, refusalDetected, ok, error? }`
  - `driverRefusalDetected`
  - `error: { phase, message } | null`
- `errors[]` — 阶段失败明细（重复在 records[].error，便于快速浏览）
- `integrity` — C-3 records 完整性校验结果（valid + 各阶段失败计数）
- `metrics` — 三组 IoU + Pearson + refusal IoU
- `passed` — bool

## 3. T040 — 阈值未达：调整 rubric + 重跑

若 Round 1 任一阈值未达：

### 3.1 IoU pass 失败 → 调整 jury rubric

编辑 `scripts/calibrate-glm-judge.mjs` 中 `buildJudgePrompt`，明确：

- pass 标准：driver patch 在功能上修复了原 issue（不需要风格完美）
- fail 标准：patch 不修复 issue 或引入新 bug
- score 锚点：8-10 = pass + clean、5-7 = pass + 有瑕疵、0-4 = fail

### 3.2 Pearson 失败 → 调整 score 粒度指令

要求 judge 按 0/2/4/6/8/10 锚点打分（避免全打 5），在 prompt 中加 score anchor 示例。

### 3.3 Refusal IoU 失败 → 调整 REFUSAL_PATTERNS

编辑 `REFUSAL_PATTERNS` regex 数组，覆盖 driver 实际拒答语 surface（运行后看 records[].driverPatch
前 500 字符确认）。

修改完成后：

```bash
# Round 2
SILICONFLOW_API_KEY=sk-... node scripts/calibrate-glm-judge.mjs --rubric-version v2
```

若 Round 2 仍未达 → Round 3 (`--rubric-version v3`)；3 轮均未达 → 触发 fallback。

## 4. T041 — Fallback 2-judge 路径（C-6 iter-2 fail-closed）

3 轮 rubric 调整仍未达 → 启用回退（DEFAULT_JUDGES = Opus + Kimi，移除 GLM）：

```bash
SILICONFLOW_API_KEY=sk-... node scripts/calibrate-glm-judge.mjs --use-fallback-jury
```

### 4.1 fail-closed 一致同意制（C-6 修订）

fallback 路径**不再用 codex baseline 单点判定**，改为 Opus + Kimi 一致同意制：

| Opus | Kimi | final | 字段 |
|------|------|-------|------|
| pass (≥5) | pass (≥5) | **pass** | `disagreement: false`, `tieBreakResult: 'pass'` |
| pass | fail | fail-closed | `disagreement: true`, `tieBreakResult: 'fail-closed'` |
| fail | pass | fail-closed | `disagreement: true`, `tieBreakResult: 'fail-closed'` |
| fail | fail | fail-closed | `disagreement: false`, `tieBreakResult: 'fail-closed'` |
| 缺 score | * | fail-closed | `tieBreakResult: 'fail-closed'` |

阈值评估指标改为 `IoU(Fallback_failClosed, oracle) ≥ 0.7`。`metrics.fallbackDisagreementCount`
暴露分歧数：分歧高 → 说明两 judge 标准不一，需调 rubric；分歧 0 但 IoU 仍不达 → 说明
fallback 整体 too 严，需 spec 升级 FR-025 退出条件。

### 4.2 回退确认达标后的手动同步

1. 更新 `scripts/eval-judge-jury.mjs` 中 `DEFAULT_JUDGES` 数组，移除 GLM-5.1
2. 更新 `scripts/eval-judge-jury.mjs` 注释，记录回退理由 + 时间 + commit hash + 3 轮调整数据
3. 更新 `scripts/eval-judge-jury.mjs` `TIE_BREAK = 'fail-closed'`（2-judge 一致同意制）
4. commit 改动 + 重跑 vitest 确保零回归（`npx vitest run`）

## 5. 验证清单（验收 T039/T040/T041 完成）

- [ ] `calibration-result.json` 存在且 `passed: true`
- [ ] artifact `metrics` 三个阈值均达标（或 fallback 路径达标）
- [ ] vitest 全量回归零失败：`npx vitest run`
- [ ] `npm run build` 退出码 0
- [ ] tasks.md T039/T040/T041 状态从 `DEFERRED` 改为 `DONE` 并记录 calibration round 数 + 最终
      jury 配置（NEW 或 FALLBACK）

## 6. 故障排查

| 现象 | 可能原因 | 处置 |
|------|---------|------|
| 退出码 73 | `SILICONFLOW_API_KEY` 缺失 | 检查环境变量；参考 §1 |
| `errors[]` 大量 driver 失败 | codex CLI 未登录 / 配额耗尽 | `codex login`；检查 ChatGPT Pro 状态 |
| `errors[]` 大量 GLM/Kimi 失败 | SiliconFlow rate limit | 减并发、retry、或换 key |
| Pearson = 0 但 records 完整 | 所有 jury 给同分（zero variance） | 先看 records，可能 rubric prompt 太弱；调 §3.2 |
| Refusal IoU = 0 但 expected refusal 存在 | REFUSAL_PATTERNS 未匹配 driver 拒答语 | 看 records 中 fixture=SWE-L007 的 driverPatch；按 §3.3 调 regex |

## 7. 关联文档

- spec.md FR-022 / FR-023 / FR-024 / FR-025 / FR-026
- plan.md §2.5.1-§2.5.6 + §0.1（5 frozen fixture）+ §0.3（IoU/Pearson 粒度）
- tasks.md T036-T042
- `calibration-fixture-list.json` — 5 frozen fixture id（不允许换）
