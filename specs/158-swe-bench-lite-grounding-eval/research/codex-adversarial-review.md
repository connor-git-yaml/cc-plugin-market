# Codex Adversarial Review — Phase 1 调研

**审查对象**：`tech-research.md` + `online-supplement.md`  
**Codex 模型**：GPT-5.4（codex:codex-rescue 子代理）  
**日期**：2026-05-09

## CRITICAL（3 项）

| # | 问题 | 处置 |
|---|------|------|
| C-1 | 两份报告架构决策互斥（Node 方案 B vs Python orchestrator） | **进入 GATE_DESIGN 用户决断**；本次 review 后用 AskUserQuestion 让用户在 2 条路径中收口 |
| C-2 | claude --print + MCP 是 path-critical 单点死穴，缓解只有"提前 spike" | **已 spike 解除**：见 [spike-claude-print-mcp.md](spike-claude-print-mcp.md)，sonnet 4.6 在 --print 模式下稳定调 MCP tool，cost \$0.136 / 8.36s |
| C-3 | 预算估算基于 micrograd（\$0.55），django 量级可能 \$15-25/batch；10 task × N=3 = 30 batch setup 可能击穿 \$50 | **进入用户决断**：micrograd-style 简化 task vs SWE-Bench Lite 真实 instance 是预算量级核心选择 |

## WARNING（6 项）

| # | 问题 | 处置 |
|---|------|------|
| W-1 | N=3 重测 + 10 task 的统计功效不足以区分 20pp lift，95% CI 重叠 | **specify phase 必须明确**：先做 power analysis，目标 lift ≥ 30pp（更宽松）或扩 N 到 5-10 |
| W-2 | "MCP pull lift > 0" 没有 alternative hypothesis，confound（token / 时间也带 lift） | **specify phase**：加 token-budget-controlled 子实验；记录 tool call trace 量化"哪些 lift 来自 graph 知识" |
| W-3 | "裸 Claude Code"不裸（Grep/Read/Glob 已强），MCP 边际收益可能小 | **缓解**：spike 已证 stream-json 含 tool_use block；可显式记录"agent 用过 spectra tool 几次"; 没用过的 task 视为 W-3 触发 |
| W-4 | SWE-Bench FAIL_TO_PASS oracle 对 agent 不友好（agent 不知道 oracle expectation） | **specify phase**：明确选小型 task（明确改某个函数签名 + 已知 test），避免大型 monorepo 模糊任务 |
| W-5 | docker + Python 是大量复杂度，与 Node-only 仓库异构 | **缓解**：spike 已证 Node-only 路径可行；推荐方案 B 不引入 Python / docker |
| W-6 | Sprint 3 Phase 5 grounding lift = 0 原始数据未披露 | **已查**：n=3 task（tanh/fix-bug/extract-const）× 4 对照组 × cross-LLM jury（sonnet+opus 双 judge），原始数据在 `~/.spectra-baselines/micrograd-output/grounding-*/`，结论可信但样本量 small；F158 应用 functional oracle（不靠 LLM judge）做差异化 |

## INFO（3 项）

| # | 问题 | 处置 |
|---|------|------|
| I-1 | SWE-Bench Lite 11 个 repo 都是 Python，4 语言能力只测 1 维 | spec 中明确 scope = Python；多语言 lift 验证作为 follow-up（Feature 158+） |
| I-2 | MCP-Atlas 用 Opus 4.5 跑 62.3% pass，本 Feature 用 Sonnet | spec 不直接引用 MCP-Atlas 数字做 baseline，用本仓 Sprint 3 grounding lift = 0 作为对照起点 |
| I-3 | 7 个决策建议缺 sequencing | spike → 架构决断 → power analysis → fixture 选型，spec 按此顺序 |

## Specify Phase 必答 5 问

| Q | 状态 | 答案 |
|---|------|------|
| Q1 claude --print + MCP 是否兼容？ | **已答** | 是。spike 通过。 |
| Q2 micrograd-style vs SWE-Bench docker？ | **待用户决断** | 通过 GATE_RESEARCH 让用户在 AskUserQuestion 决断 |
| Q3 Node 扩展 vs Python orchestrator？ | **已倾向** | Node-only（spike 已证可行；与既有 eval 链路一致；W-5 缓解） |
| Q4 统计功效 N_task × N_repeats？ | **specify phase 处理** | 用 bootstrap / 二项分布 power analysis 计算 |
| Q5 Sprint 3 grounding lift = 0 是否可信？ | **已答** | n=3 × 4 × jury 双 judge 实测；样本量 small 但 honest report；F158 用 functional oracle 提供 stronger evidence |
