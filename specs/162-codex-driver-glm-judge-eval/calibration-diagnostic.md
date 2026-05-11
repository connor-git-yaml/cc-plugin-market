# Feature 162 — Calibration v1 实测诊断报告

> Run at: 2026-05-11
> Driver: `codex:gpt-5.5` (medium reasoning, ChatGPT Pro subscription)
> Jury: `[claude-cli:claude-opus-4-7, siliconflow:Pro/zai-org/GLM-5.1, siliconflow:Pro/moonshotai/Kimi-K2.6]` + Codex baseline
> Result: ❌ Records integrity FAIL（Opus 0/15 + GLM 0/15 + Kimi 0/15 + Codex 12/15 + driver truncation 3/15）
> Resolution: 1 已修 + 2 仍 deferred

## 实测原始结果

```
records collected: 15 / 15 expected
errors: 3 (driver truncation)
GLM 失败: 12 个
Codex 成功: 12 个
oracle 异常: 0 个
```

per-record summary（首例 SWE-L001/run-1）：

| Judge slot | model | result | error |
|-----------|-------|--------|-------|
| opus | claude-cli:claude-opus-4-7 | ❌ fail | `claude CLI failed (status=1, killed=false): [WARN] Fast mode is not available in the Agent SDK. Using Opus 4.6.\n` |
| glm | siliconflow:Pro/zai-org/GLM-5.1 | ❌ fail | `Cannot find package 'openai' imported from scripts/lib/llm-backend-dispatcher.mjs` |
| kimi | siliconflow:Pro/moonshotai/Kimi-K2.6 | ❌ fail | `Cannot find package 'openai' imported from scripts/lib/llm-backend-dispatcher.mjs` |
| codex baseline | codex:gpt-5.5 | ✅ success | rawResponse 含完整 JSON `{score, rationale, issues}` |

## 3 个根本原因

### Cause 1: openai npm 包缺失（已修）

**症状**：GLM + Kimi 全部 fail（30/30 calls 都报 `Cannot find package 'openai'`）。

**根因**：worktree 的 `node_modules/openai` 目录缺失（typical for fresh worktree clone）。`scripts/lib/llm-backend-dispatcher.mjs` 的 `handleSiliconflow` + `handleOpenai` handler 用 `import OpenAI from 'openai'` 加载 OpenAI SDK，缺包则全部 fail。

**已修复**：`npm install openai --no-audit --no-fund` 装好（312 packages added）。`package.json` 内 `"openai": "^6.35.0"` 依赖已声明，但 node_modules 此前缺。

**重跑 v2 应可消除 GLM/Kimi 失败**。

---

### Cause 2: claude CLI OAuth keychain unlock（spec session 内不可解）

**症状**：Opus judge 全部 fail（15/15 calls 都报 `claude CLI failed (status=1)`）。

**根因**：用户的 Claude CLI OAuth credentials 存在 macOS keychain item `Claude Code-credentials`（已确认存在）。但 dispatcher 通过 `child_process.spawn('claude', ...)` 启动子进程时，子 shell 没继承 keychain 解锁状态（macOS 安全机制：non-interactive spawn 不能弹窗 prompt 用户输 password unlock keychain）。

**dispatcher 复现**：
```
$ echo 'Reply with just OK.' | claude --print --model claude-opus-4-7 \
    --output-format json --permission-mode plan
{"is_error":true,"api_error_status":401,"result":"Failed to authenticate. API Error: 401 Invalid authentication credentials"}
```

**stderr WARN 消息**："Fast mode is not available in the Agent SDK" 是 claude CLI 的 fallback warning（无害，与 401 无直接关联）；status=1 来自 Anthropic API 的 401 Auth fail。

**resolution path（任一可解）**：

**Option A**（最快）— 用户提供 `ANTHROPIC_API_KEY`：
```bash
# 用户在 IDE 主 terminal 中
export ANTHROPIC_API_KEY="sk-ant-..."  # 从 console.anthropic.com 拿
# 然后让 agent 重跑 calibration v2
```

**Option B**（OAuth）— 用户在 IDE 主 terminal unlock keychain，让子进程能读：
```bash
# 在 IDE 主 terminal（不是 Claude Code agent 子 shell）
claude  # 触发 OAuth 流程，用户首次输 Claude.ai 凭据
# Claude Code agent 重启后子进程应能继承 OAuth state
# 但这要求重启 Claude Code session
```

**Option C**（保守）— 接受 Opus 0/15，先 spec FR-025 fallback 路径用 `--use-fallback-jury`（仅 Opus + Kimi）：
- 但 fallback 仍含 Opus，问题仍在。
- **真正的"绕开 Opus" fallback** 需要修 spec FR-025 / DEFAULT_JUDGES，临时改 [GLM, Kimi, Codex baseline] 3-judge —— 违反 spec FR-020 当前合同，需 spec 修订。

---

### Cause 3: codex driver `finishReason=length` truncation（设计 trade-off）

**症状**：3/15 driver call 报 `finishReason=length`（SWE-L001/run-2, SWE-L003/run-2, SWE-L003/run-3）。spec FR-014 retry matrix 把 truncation 标 `0 retry, partial=true, fail`。

**根因**：codex CLI medium reasoning 在 SWE-Bench-Lite 复杂 fixture 上消耗大量 reasoning tokens，留给最终 output 的 token 不够，被截断。`driverTokens=28203` 累计（含 reasoning + output）。

**codex CLI 调研**：
- `codex exec` CLI 的 `-c key=value` 配置不暴露 `model_max_output_tokens` 或类似 key（试过 `~/.codex/config.toml` 内只有 `model`/`model_reasoning_effort`/`personality` 三个 model-level 配置）
- 没找到 codex CLI 暴露 max_output_tokens 的方式

**resolution path**：

**Option A**（违 spec）— 把 reasoning_effort 从 medium 降到 low：
- 违反 spec FR-012（明确 `model_reasoning_effort=medium`）
- 需 spec 修订

**Option B**（接受 ~20% fail rate）— 把 truncation 视为 driver 真实失败：
- 现状：calibration runner records integrity 严格 `successfulRecords.length === 15`
- 需放宽到 ≤ 90% 成功率（如 `successfulRecords.length >= 12`）
- 需 plan iter-2 W-3 决议修订
- 但这影响 Pearson 统计功效（n=12 时 r≥0.6 的 p ≈ 0.04，仍可用）

**Option C**（增 retry）— RM-3 truncation 改 1 retry：
- 违反 spec FR-014 retry matrix（明确 truncation 0 retry）
- 需 spec 修订

**Option D**（codex 内部）— 改 `~/.codex/config.toml` 加可能的 max_output 相关 key 试：
- 调研未发现该 key 存在
- 需 codex CLI upstream 文档确认

## 当前 commit 内容

本 commit 包含：
- `npm install openai` 后的 `package-lock.json` 更新（git diff 应显示 openai 依赖项实装）
- `specs/162-.../calibration-result.json` v1 partial result（**作为诊断 artifact**，已写盘）
- `specs/162-.../calibration-diagnostic.md` 本文件
- `scripts/pilot-27-batch.sh` Pilot 27 runs 跑批脚本（待 calibration PASS 后触发）

**不**包含：
- DEFAULT_JUDGES / dispatcher 改动（无代码层 fix）
- spec / plan / tasks 修改
- 新 vitest case

## DEFERRED 项汇总

| Task | 状态 | Resolution |
|------|------|----------|
| T039 calibration 完整 PASS | ⏭️ DEFERRED-AUTH | 需用户提供 ANTHROPIC_API_KEY 或在 IDE 主 terminal unlock keychain |
| T039 driver truncation 0/15 | ⏭️ DEFERRED-SPEC-DECISION | 需 spec FR-012/FR-014/W-3 修订接受 ≤ 20% fail rate，或者 codex CLI 找到 max_output 配置 |
| T040 阈值判定 + rubric 调整 | ⏭️ DEFERRED | 依赖 T039 完整 PASS |
| T041 fallback 触发 | ⏭️ DEFERRED | 同 T040 |
| T050 pilot 27 runs | ⏭️ DEFERRED | 依赖 T039 / T050 启动条件 |
| T052 全量 450 runs | ⏭️ DEFERRED | 同 T050；多 calendar week + ~$15 |
| T053-T058 §10.x 报告填入 | ⏭️ DEFERRED | 依赖实测数据 |
| Smoke D Test 3 success | ⏭️ DEFERRED | 用户跑 `claude plugin update spec-driver` |

## 下次启动 calibration v2 的步骤

```bash
# 1. 设置 SiliconFlow key（已完成，~/.config/spectra/siliconflow.key）
export SILICONFLOW_API_KEY="$(cat ~/.config/spectra/siliconflow.key)"

# 2. 设置 Anthropic API key（待用户提供）
export ANTHROPIC_API_KEY="sk-ant-..."  # 从 console.anthropic.com

# 3. 验证 dispatcher 可调通 4 backend：
node -e "import('./scripts/lib/llm-backend-dispatcher.mjs').then(async m => {
  const r = await m.callBackend({ model: 'claude-cli:claude-opus-4-7',
    prompt: 'Reply OK', options: { timeoutMs: 30000 } });
  console.log('opus:', r.ok, r.text?.slice(0, 50));
})"

# 4. 跑 calibration v2
node scripts/calibrate-glm-judge.mjs --rubric-version v2

# 预期：
# - GLM 15/15 success（openai 包已装）
# - Kimi 15/15 success（同上）
# - Opus 15/15 success（ANTHROPIC_API_KEY 可绕开 keychain）
# - Codex baseline 15/15 success（已 demo）
# - driver: 仍有 ~3/15 truncation（除非接受 ≤ 80% 阈值或 spec 修订）
```

## 决策点

为继续 calibration → pilot → 全量 450 runs 链路：

**用户决策**：
- (D1) 是否提供 ANTHROPIC_API_KEY（解 Cause 2）
- (D2) 是否接受 driver truncation ≤ 20% fail rate 阈值放宽（解 Cause 3 — 需修 plan iter-2 W-3 + records integrity 校验逻辑）
- (D3) 是否在本 session 内继续，还是 commit 当前 partial + push branch + 让 ops 后续 session 完成

**主线程建议**：
- 立即 commit 当前 v1 partial（diagnostic artifact）+ push branch backup
- 用户决策 (D1) + (D2) 后再续跑 v2，或留给后续 session
