---
feature: 176
artifact: host-runbook
created: 2026-06-09
updated: 2026-06-10
purpose: host shell（非 sandbox worktree）执行 F176 评测的逐步可复制流程
status: 步骤 0-2 已完成（spike PASS_SUBAGENT 2026-06-10）；步骤 3-6 就绪待执行
---

# F176 Host Runbook

> ⚠️ **为什么必须 host 跑**：sandbox worktree 内 `claude --print` 返回 `401 Invalid authentication credentials`（Claude Max OAuth 走 macOS Keychain，sandbox 不可达）。所有 claude-driven 步骤（spike / smoke / full）都必须在 host shell 跑。
>
> 工作目录（host）：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/suspicious-sinoussi-d41c88`

## 步骤 0 — build + 版本门禁 ✅（已完成，重跑前如有新 commit 须重做）

```bash
node scripts/build-spectra-stamped.mjs
# 期望末行: [build:stamped] ✅ 版本门禁通过：OK：build 源 <commit> 含 F177+F181
```

门禁原理：`spectra --version` 对本地 build 和 npm 旧版**都报 v4.2.0**，无法区分；门禁验 F177/F181 sentinel commit 祖先 + **dist 树 sha256 内容指纹**（重 tsc 不重盖章会被识破）+ src 非 stale。**注意：盖完章后任何 `git commit` 都会让 meta.commit 过期 → 跑 smoke/full 前重跑本步骤。**

## 步骤 1 — 凭据 preflight ✅（已验证）

```bash
grep -c "^export SILICONFLOW_API_KEY=" .env.local      # 期望 1（jury GLM/Kimi 唯一真实扣费源）
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text   # 期望: ok
```

F176 driver=claude-opus-4-7（Claude Max OAuth），**不用 codex**。

## 步骤 2 — 🔴 cohort 3 spike ✅ **PASS_SUBAGENT（2026-06-10）**

已完成：`verification/spike-result.md` status=PASS_SUBAGENT —— `--print` 下 Task 子代理真实调用
`mcp__plugin_spectra_spectra__context` 并取回结构化数据（parent_tool_use_id 强归因 + tool_result 校验）。
判定语义（收紧后）：PASS_SUBAGENT（解锁）/ PASS_DRIVER_ONLY（不解锁，调 prompt 重跑）/ FAIL（FR-A-007c 升级）/ ERROR_INFRA（修鉴权/超时重跑）。

> 注意：spike 用的是 **global-stock plugin（旧 build）**，只证明 Q1 传播链路；F177-F181 build 接线（Q2）由下方 smoke 的版本门禁 + 本地 plugin 收口。

## 步骤 3 — 🆕 禁用全局 spectra plugin（cohort 3 数据有效性前提）

cohort 3 用 `--plugin-dir` 注入**本地 F177-F181 build** 的 "spectra" plugin；若全局同名 plugin 并存，实际加载哪个 build 有歧义 → 版本审计失真（codex CRITICAL）。runner/batch 默认 **hard-fail**。

```bash
# 在 claude 交互式里禁用（或编辑 ~/.claude.json 的 enabledPlugins）：
claude plugin disable spectra    # 若该命令不可用：claude → /plugin → disable spectra
# 评测完成后恢复：claude plugin enable spectra
```

> 不想禁用时可 `--allow-global-spectra`（batch）/ `F176_ALLOW_GLOBAL_SPECTRA=1`（单 run）显式放行，但 cohort3 的版本归属将不可证，报告须标注。

## 步骤 4 — Verified 数据集 import + oracle smoke + 预注册冻结

```bash
pip install datasets   # 若未装（sandbox 无此库，故 import 是 host 步骤）

# 4a. Verified 子集 import（repos/min-date 按可解性挑；先小 limit 试）
python3 scripts/swe-bench-fixture-import.py \
  --dataset princeton-nlp/SWE-bench_Verified \
  --task-prefix SWE-V --dataset-tag verified --fixtures-subdir swe-bench-verified \
  --repos <owner/repo,...> --min-date 2024-01-01 --max-patch-files 3 --limit 10 \
  --output-dir tests/baseline/swe-bench-verified/fixtures/

# 4b. oracle 可执行性 smoke（T-A2 C-1）：对 ≥3 个导入 task 装依赖跑 oracle 命令，
#     确认 FAIL_TO_PASS 测试在 goldpatch 后转绿；通过率 ≥8/10 才允许冻结预注册。

# 4c. 冻结预注册（FR-A-002b，--full 的硬前提）：
#     把实际 10 个 task id 填 verification/preregistration.md frontmatter taskIds，
#     算 hash 填 taskSetHash，frozen 改 true：
node --input-type=module -e "
import { computeTaskSetHash } from './scripts/lib/preregistration-check.mjs';
console.log(computeTaskSetHash(['SWE-V001-...','SWE-V002-...']));  // ← 替换为实际 id
"
# 冻结后 git commit preregistration.md（git 历史是 anti-tamper 锚）
```

## 步骤 5 — smoke（5 cohort × 1 task × N=1；SC-001 闸门）

```bash
node scripts/swe-bench-verified-cohort-batch.mjs --smoke
# 入口校验：spike=PASS_SUBAGENT + 版本门禁 + 凭据 + 无全局 spectra（hard-fail 任一不满足）
# 期望: [batch] smoke PASS ✅ → verification/smoke-result.md
#   断言1: 5/5 runs success（无 broken）
#   断言2: cohort3 mcpToolCallCount > 0
# smoke 默认 --skip-jury（省成本）；产物含 smoke-result.md（回传 sandbox agent）
```

smoke FAIL → 看 smoke-result.md 的 broken 明细；cohort3 mcp=0 → 按 spec FR-A-007c 分流（回报 sandbox agent）。

## 步骤 6 — full（150 runs，N=3；先冻结预注册）

```bash
node scripts/swe-bench-verified-cohort-batch.mjs --full
# = 10 task × 5 cohort × N=3；每 run: runner → fixture 归位 Verified 路径 → jury（opus+GLM+Kimi）
# 每 6 runs 配额检查点：默认打印人工提醒（可配 --quota-check-cmd "<cmd>" 自动判）
# ≥60% weekly → Ctrl-C 或 --on-quota=pause 自动写 checkpoint 退出，隔日续：
node scripts/swe-bench-verified-cohort-batch.mjs --full --resume
# 完成输出: aggregate/cohort-aggregate.json + lift/c3_vs_c4/tokenRatio 摘要
```

预算提示：实付 ≈ 仅 SiliconFlow jury token（~$15-30 / 150 runs × 2 judge）；driver/judge1 走订阅边际 $0；Claude Max 周配额是真实约束（150 × opus run）。

## 步骤 7 — verify + 报告

```bash
node scripts/verify-feature-176.mjs        # SC-001..008 逐条断言（拒 synthetic）
# 然后把 aggregate/cohort-aggregate.json + smoke-result.md 回传 sandbox agent，
# 由其写 PUBLISH-REPORT-M7.md + PUBLISH-REPORT.md §11（含 falsification 如实记录）
# 最后：claude plugin enable spectra（恢复全局 plugin）
```
