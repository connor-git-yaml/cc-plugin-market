---
feature: 176
artifact: host-runbook
created: 2026-06-09
purpose: host shell（非 sandbox worktree）执行 F176 评测的逐步可复制流程
status: spike 段就绪；smoke/full 段待 cohort 3 派发（Phase C）落地后补全
---

# F176 Host Runbook

> ⚠️ **为什么必须 host 跑**：sandbox worktree 内 `claude --print` 返回 `401 Invalid authentication credentials`（Claude Max OAuth 走 macOS Keychain，sandbox 不可达）。所有 claude-driven 步骤（spike / smoke / full）都必须在 host shell 跑。
>
> 工作目录（host）：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/suspicious-sinoussi-d41c88`

## 步骤 0 — build + 版本门禁（必做，cohort 3 用本地 F177-F181 build）

```bash
# 带 commit 盖章的 build（生成 dist/.spectra-build-meta.json）
node scripts/build-spectra-stamped.mjs
# 期望末行: [build:stamped] ✅ 版本门禁通过：OK：build 源 <commit> 含 F177+F181
```

版本门禁原理：`spectra --version` 对本地 build 和 npm 旧版**都报 v4.2.0**，无法区分；门禁改验 F177/F181 sentinel commit 是 build 源 commit 的祖先 + dist 非 stale。旧 npm binary 缺 build-meta → 被挡下。

## 步骤 1 — 凭据 preflight

```bash
# SiliconFlow（jury GLM/Kimi 唯一真实扣费源）
grep -c "^export SILICONFLOW_API_KEY=" .env.local      # 期望 1
# Claude Max OAuth（driver + judge1；F176 driver=claude-opus-4-7，不用 codex）
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text   # 期望: ok
```

## 步骤 2 — 🔴 cohort 3 spike（硬 GATE，决定 cohort 3 是否成立）

验证 `claude --print` 下 spec-driver workflow 的 sub-agent 能否真实调用 plugin-namespace 的 spectra MCP（`mcp__plugin_spectra_spectra__*`）。

```bash
# 真实跑（需 claude OAuth；约 5-20 min，消耗少量 Claude Max 配额）
node scripts/spike-cohort3-plugin-mcp.mjs
# 产物: specs/176-.../verification/spike-result.md
```

判读 `spike-result.md`：

| status | 含义 | 下一步 |
|--------|------|--------|
| **PASS**（pluginMcpCallCount > 0）| sub-agent 能调 plugin MCP → cohort 3 可行 | 解锁 Phase C（cohort 3 派发），继续后续 smoke/full |
| **FAIL**（pluginMcpCallCount = 0）| sub-agent 未调到 plugin MCP | 走 spec FR-A-007c 根因分流（见下）|

**spike FAIL 时的根因隔离**（再跑一次用 stock 已装 plugin，排查是“传播”还是“build 接线”问题）：

```bash
node scripts/spike-cohort3-plugin-mcp.mjs --stock-plugin
```

- stock 也 FAIL（且 driverCallCount=0）→ **产品能力限制**：plugin MCP 不传播到 `--print` sub-agent。记 `verification/m8-fix-candidates.md`，cohort 3 当前形态无法满足 SC-002/003 → **回报 sandbox agent 升级用户拍板**（先修产品 wiring M8 / cohort 3 降范围 / M7 带 known-limitation 交付）。
- local FAIL 但 stock 有 plugin 调用 → **本地 build 接线问题**（harness scope 内，修 .mcp.json/plugin-dir 重试）。

> 把 `spike-result.md` 回传给 sandbox agent，由其据真实结果决定继续 Phase C 还是走升级路径。**synthetic / dry-run 结果不算 PASS。**

## 步骤 3 — Verified 数据集 import + 预注册冻结

importer 已参数化（同一脚本，Lite 默认不变；传 Verified 参数即切数据集）：

```bash
pip install datasets   # 若未装（sandbox 无此库，故 import 是 host 步骤）

# Verified 子集 import（repos/min-date 按可解性挑；先小 limit 试）
python3 scripts/swe-bench-fixture-import.py \
  --dataset princeton-nlp/SWE-bench_Verified \
  --task-prefix SWE-V --dataset-tag verified --fixtures-subdir swe-bench-verified \
  --repos <owner/repo,...> --min-date 2024-01-01 --max-patch-files 3 --limit 10 \
  --output-dir tests/baseline/swe-bench-verified/fixtures/

# oracle 可执行性 smoke（T-A2 C-1）：对 ≥3 个导入 task 装依赖跑 runPrimaryOracle，
# 通过率 ≥ 阈值（≥8/10）才允许冻结预注册；否则换 task。

# 冻结预注册：把实际 10 个 task id 填 verification/preregistration.md，
# 用 computeTaskSetHash 算 taskSetHash，frozen 改 true（见该文件内联说明）
```

## 步骤 4 — smoke（5 cohort × 1 task × N=1）  〔待 Phase C-E〕

```bash
# node scripts/swe-bench-verified-cohort-batch.mjs --smoke
# 期望: 5/5 success + cohort3 mcpCallCount>0 + 版本门禁过
```

## 步骤 5 — full（150 runs，N=3）  〔待 Phase C-E〕

```bash
# node scripts/swe-bench-verified-cohort-batch.mjs --full --on-quota=pause
# 配额 ≥60% weekly 时自动写 checkpoint 退出；隔日 --resume 续跑
# node scripts/swe-bench-verified-cohort-batch.mjs --full --resume
```

## 步骤 6 — 报告 + verify  〔待 Phase F〕

```bash
# node scripts/verify-feature-176.mjs   # 逐条 SC 断言（拒 synthetic）
# 然后 sandbox agent 从结果 fixture 写 PUBLISH-REPORT-M7.md
```
