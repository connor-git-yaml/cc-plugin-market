---
feature: 176
phase: Plan — Codex 对抗审查记录
date: 2026-06-08
reviewers: Codex (codex-rescue) + Claude (main-thread, 读 eval infra 取证)
---

# F176 Plan 阶段对抗审查 — 处置记录

> Codex 返回 2 CRITICAL + 3 WARNING + 1 INFO；Claude 自审另出 2 处事实修正。全部已落 plan/spec 修订。

## Codex 发现 → 处置

| 档位 | finding | 处置 |
|------|---------|------|
| 🔴 CRITICAL | KD-3 把"sub-agent 见 plugin MCP"当既定事实，但同段又承认可能跑不通；与 SC-001/002 冲突 | **FR-A-007b + plan §3.2.0 spike gate**：150 runs 前先证非交互 sub-agent 能调 `mcp__plugin_spectra_spectra__*`，未过不进全量 |
| 🔴 CRITICAL | fallback("记录发现不降级") 与 SC 5/5-success 冲突 → 失败即死锁 | **FR-A-007c + plan §5 决策树**：按根因分流（harness 问题修 harness / 产品限制→M8+升级用户拍板），绝不静默过 SC |
| 🟡 WARNING | driver 凭据矛盾：spec 既写 Codex OAuth 又写 opus-4-7 | **spec 关键前提表修正**：F176 driver=claude-opus-4-7（Claude Max OAuth），不用 codex；token 走 claude stream-json |
| 🟡 WARNING | KD-1"build dist 必含 F177-F181"证据不足（分支≠master） | **plan KD-1 强化**：版本门禁记录 build source commit + tree-dirty，stale/非预期祖先链 hard-fail |
| 🟡 WARNING | fixture 路径 spec(`tests/baseline/tasks/...`) vs plan(`swe-bench-verified/...`) 不一致 | **统一**为 `tests/baseline/swe-bench-verified/tasks/<task>/<cohort>/r<i>/full.json`，导出 shared constant 给 importer/batch/report/verify（spec FR-A-006 + plan §3.7 同步）|
| ℹ️ INFO | "一键跑" vs 每 6 runs 交互询问 配额，无人值守会卡 | **plan §3.7**：默认 `--on-quota=pause`+`--resume`（非交互），交互仅 `--interactive-quota` |

## Claude 自审（读 eval-task-runner 源码取证，codex 未覆盖）

| finding | 证据 | 处置 |
|---------|------|------|
| 既有 cohort 硬编码 `--model claude-sonnet-4-6`，F176 须 opus-4-7 | buildClaudeArgs baseArgs/mcpArgs | **KD-7**：覆盖为 `--model claude-opus-4-7` |
| 仅 mcp-pull 走 stream-json，其余 cohort `--output-format text`→token=null | parseStreamJsonUsage 注释"其他 cohort cost/tokens 仍 null" | **KD-7**：全 cohort 改 stream-json，token 才对每 cohort 可得（落实 FR-B-003a）|

## 价值佐证（供报告 FR-C-007）

- Plan 阶段：codex 抓住"把最高风险当事实"+ "fallback 死锁"两条 feature 级 CRITICAL（Claude 自审偏重实现取证、未上升到验收死锁）；Claude 取证补出 model/stream-json 两处必改事实。两路互补，再次印证"重叠高置信 + 独有补盲"。
- 最高技术风险（cohort3 wiring）已从"plan 隐含假设"显式降为"spike 前置 gate + 失败升级路径"，这是本轮 review 最关键的结构改进。
