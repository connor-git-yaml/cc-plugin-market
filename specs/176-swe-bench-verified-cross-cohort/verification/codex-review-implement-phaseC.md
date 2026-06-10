---
feature: 176
phase: Implement（Phase C — cohort3 派发 + T-D1 repeat 隔离 + T-E1 batch 编排）— Codex 对抗审查记录
date: 2026-06-10
reviewers: Codex (codex-rescue) + Claude (main-thread)
scope: scripts/eval-task-runner.mjs（共享 runner 接入 cohort3）+ scripts/swe-bench-verified-cohort-batch.mjs（新增）
---

# F176 Phase C 对抗审查 — 处置记录

> Codex：1 CRITICAL + 2 WARNING + 4 INFO（其中 3 条 INFO 为"已验证无问题"确认项）。全处置。

| 档位 | finding | 处置 + 验证 |
|------|---------|------------|
| 🔴 C-1 | runner 对全局 spectra plugin 只 warn → cohort3 实际加载哪个 build 有歧义，版本审计字段失真（"必须 F177-F181"前提被绕过）| runner cohort3 preflight **hard-fail**（`F176_ALLOW_GLOBAL_SPECTRA=1` 显式放行口）；batch smoke/full 同规则（--allow-global-spectra 透传 env）；host-runbook 写明禁用全局 spectra 步骤 |
| 🟡 W-1 | cohort3 graph 生成后 git add/commit 未检查状态 → 失败时 graph 以未提交状态进 agent run，污染 diff/uncommitted 指标 | add/commit 检查 status + 注入 git identity + commit 后断言 `status --porcelain` clean，任一失败 throw |
| 🟡 W-2 | `assembleTaskFixture`：(a) `recordedArgs` 用 filter 删"等于末位"的所有项，cohort3 无位置 prompt 时会误删 allowedTools 值；(b) `meta.model` 硬编码 sonnet，cohort3 实际 opus-4-7 | (a) 改 `promptViaStdin ? 全保留 : slice(0,-1)`（只删真正的末位 prompt）；(b) `meta.model` 从实际 `--model` 值提取 |
| ℹ️ I-1 | buildClaudeArgs 调用方均对象参数、promptViaStdin 语义正确（已验证）；建议补大 prompt stdin 测试 | 确认；spawn 级 stdin 测试需 mock claude binary，记 follow-up 不阻塞 |
| ℹ️ I-2 | COHORT3_ALLOWED_TOOLS 覆盖 spec-driver-fix 必需工具（已验证）；Task 子代理可用有 spike 佐证 | 确认；smoke 是权威验证 |
| ℹ️ I-3 | 版本门禁在 worktree 准备后才查，失败浪费准备时间 | 前移到 prepareWorktree 之前（fail-fast）|
| ℹ️ I-4 | `--repeat-index abc` → rNaN 路径 | parseArgs 校验 ≥1 整数 |

## Claude 自审（与 codex 并行发现）
- batch resume 与 quota-store 合同不匹配：classifyRuns 只认 `run-*.json` 文件名 + finalized 条目用 `id` 字段 → state 文件改 `run-<runId>.json` + done-set 用 `f.id`（单测闭环验证）。
- `runPrimaryOracle` 不区分"环境不可用 vs 测试失败" → batch 层 `classifyOracle` 三分类（exit 126/127 全环境信号→unavailable，混合→保守 fail），落实 FR-A-001b。

## 验证
- 208/208（12 测试文件：6 个 F176 新增 + 6 个共享 runner 回归）
- batch --dry-run smoke(5)/full(15/task) 计划输出正确；全量 vitest 见 commit
