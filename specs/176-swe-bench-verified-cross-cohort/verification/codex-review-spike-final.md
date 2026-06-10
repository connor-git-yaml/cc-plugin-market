---
feature: 176
phase: Implement（spike 终版 — 4 轮 host 调试 + PASS）— Codex 对抗审查记录
date: 2026-06-10
reviewers: Codex (codex-rescue) + Claude (main-thread, 真实日志回放验证)
---

# F176 spike 终版对抗审查 — 处置记录

> 背景：spike 经 4 轮 host 调试达成 **PASS_SUBAGENT**（plugin MCP 调用带 parent_tool_use_id，
> 子代理可达 plugin-namespace MCP）。期间修了 4 个真实 bug：①--allowedTools variadic 吃位置
> prompt→stdin；②/401/ 正则被 UUID 子串误伤→权威 result 事件；③顺序启发→parent_tool_use_id
> 强归因；④同名 plugin 冲突规避。Codex 对终版再审：1 CRITICAL + 4 WARNING + 2 INFO。

| 档位 | finding | 处置 + 验证 |
|------|---------|------------|
| 🔴 C-1 | PASS_SUBAGENT 只验"调用被发起"，未验 tool_result 真实成功（MCP 返回 error/空时仍 success result → 误放行）| parser 跟踪 plugin tool_use id → 匹配 tool_result：`is_error!==true 且 content 非空` 才计 ok；PASS_SUBAGENT 增加 `pluginResultOkCount>0` 必要条件；子代理调用但 0 成功 → 判 FAIL。**真实 host 日志回放：ok=1/error=0，PASS 维持**（tool_result 实证含 definition/callers 真实数据）|
| 🟡 W-1 | result 缺失 → ERROR_INFRA 保守漏判 | 按设计保守（不误放行），保留 |
| 🟡 W-2 | parent_tool_use_id 某些形态缺失 → 漏判成 PASS_DRIVER_ONLY | 保守方向（不误放行）；PASS_DRIVER_ONLY 本就不解锁 Phase C，保留 |
| 🟡 W-3 | rootCause 固定写"未见 Task"（taskCallCount>0 时语义失真）| 措辞条件化（区分"见 Task 但 plugin 不在其上下文" vs "未见 Task"）|
| 🟡 W-4 | `source` 字段由 --stock-plugin flag 推导，与实际用全局 plugin 的默认分支矛盾（本次 PASS 即矛盾：source=local-build 而 spectraSource=global-stock）| source 改只表达 host vs synthetic；plugin 来源唯一看 spectraSource；spike-result 附注明确 PASS≠F177-F181 build 已接通（Q2 留 Phase C 版本门禁+smoke）|
| ℹ️ I-1 | spawnSync 不管 claude 衍生后台进程（假设性）| 记录，不改 |
| ℹ️ I-2 | mkdtemp 临时目录无清理 | OS tmp 自清理，记录不改 |

## 判定语义（修复后）
PASS_SUBAGENT（解锁 Phase C）⇔ ①子代理上下文 plugin 调用 ≥1 ②tool_result 成功 ≥1 ③result=success。
PASS_DRIVER_ONLY / FAIL / ERROR_INFRA 均不解锁。漏判方向全部保守（宁可少放行）。

## spike 最终结论（host 实跑 + 回放双确认）
- **Q1（plugin-namespace MCP 传播到 --print 子代理）：成立** —— cohort 3 设计可行，Phase C 解锁。
- **Q2（F177-F181 build 接线）：未由 spike 覆盖**（本次用 global-stock plugin）→ Phase C 用
  writeLocalSpectraPluginDir + 版本门禁 + host-runbook 禁用全局 plugin 指引收口，smoke 权威验证。
- 附带产品信号（dogfooding）：MCP context 工具返回含 nextStepHint 且子代理能按 hint 链式思考 —— F170c 设计在真实子代理场景生效。
