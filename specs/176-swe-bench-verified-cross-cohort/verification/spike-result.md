---
feature: 176
artifact: spike-result
status: PASS_SUBAGENT
source: host(local-build)
generatedAtIso: 2026-06-09T16:19:36.270Z
---

# cohort 3 plugin-MCP spike 结果

- **status**: PASS_SUBAGENT
- **pluginMcpCallCount**: 1
- **taskCallCount（spawn 的子代理数）**: 0
- **driverMcpCallCount**: 0
- **subagentAttributable（plugin 调用在 Task 之后）**: true
- **globalSpectraPluginPresent（命名冲突风险）**: true
- **spectraSource（spike 实际用的 plugin）**: global-stock(可能旧build；仅验 Q1 传播)
- **claudeVersion**: 2.1.158 (Claude Code)
- **source**: host(local-build)  ← synthetic/dry-run 不算真实验收 PASS（交接合同 C-3）
- **exitStatus**: 0  **exitSignal**: n/a
- **rootCause**: plugin MCP 调用带 parent_tool_use_id（子代理上下文）1 次 → 子代理可达 plugin MCP（强归因）

## claude stderr 样本（诊断关键，截断末 1500）
```
(空)
```

## stdout 样本（截断）
```
{"type":"system","subtype":"hook_started","hook_id":"b387731a-7f7b-4982-a764-44e815a131b2","hook_name":"SessionStart:startup","hook_event":"SessionStart","uuid":"6408f2b8-4463-4431-8518-6f3dd10a9671","session_id":"b8a61b5e-627b-4c96-84b6-16ea8c5fefcb"}
{"type":"system","subtype":"hook_started","hook_id":"d4594adb-defd-47b0-b5b6-b3daf1afc7bc","hook_name":"SessionStart:startup","hook_event":"SessionStart","uuid":"48f86dcd-4714-4374-afb9-4015ec16a0d5","session_id":"b8a61b5e-627b-4c96-84b6-16ea8c5fefcb"}
{"type":"system","subtype":"hook_started","hook_id":"94598ac7-9883-45d3-9c17-3d982fc3977b","hook_name":"SessionStart:startup","hook_event":"SessionStart","uuid":"658cb42d-58d8-4742-a45a-65a560c2068b","session_id":"b8a61b5e-627b-4c96-84b6-16ea8c5fefcb"}
{"type":"system","subtype":"hook_response","hook_id":"d4594adb-defd-47b0-b5b6-b3daf1afc7bc","hook_name":"SessionStart:startup","hook_event":"SessionStart","output":"","stdout":"","stderr":"","exit_code":0,"outcome":"success","uuid":"ed594343-af6d-43b3-acbd-6e74a3b9510b","session_id":"b8a61b5e-627b-4c96-84b6-16ea8c5fefcb"}
{"type":"system","subtype":"hook_response","hook_id":"b387731a-7f7b-4982-a764-44e815a131b2","hook_name":"SessionStart
```

## 判定（状态语义）
| status | 含义 | 下一步 |
|--------|------|--------|
| PASS_SUBAGENT | Task 子代理 + plugin MCP 都出现 → sub-agent 可达 plugin MCP（cohort3 真命题成立）| 解锁 Phase C |
| PASS_DRIVER_ONLY | 只有 driver 调到 plugin MCP，未 spawn 子代理 → 未证明 sub-agent | 调 prompt 重跑 / 查 transcript，**不解锁** |
| FAIL | 无 plugin-namespace 调用 → wiring 不通 | 走 FR-A-007c 升级（区分 harness/产品）|
| ERROR_INFRA | 401/超时/进程崩溃 → 非 wiring 问题 | 先修鉴权/超时再重跑，**不判 wiring** |

**当前判定**：✅ sub-agent 可达 plugin-namespace MCP → cohort 3 设计可行，解锁 Phase C。

> ⚠️ synthetic / dry-run 结果不写本文件（交接合同 C-3）；本文件存在即代表 host 真实跑过。

---

## 附：判据收紧后的回放校验（2026-06-10，codex CRITICAL 修复）

Codex 审查指出原判据缺陷：「plugin 调用被发起 ≠ 成功返回」（tool_result 可能 error/空但仍判 PASS）。
修复后判据：PASS_SUBAGENT 须同时满足 ①调用带 parent_tool_use_id（子代理上下文）②≥1 次 tool_result
非 error 且非空 ③result 事件 success。

将本次 **真实 host stdout 日志**（spike-diag/spike-stdout.log，非 synthetic）回放进收紧后 parser：

| 指标 | 值 |
|------|-----|
| pluginCallCount | 1 |
| subagentPluginCallCount（parent_tool_use_id 归因）| 1 |
| **pluginResultOkCount（tool_result 真实返回）** | **1**（error 0）|
| resultEvent | subtype=success, is_error=false |
| **收紧后判定** | **PASS_SUBAGENT（维持）** |

tool_result 实证：`tool_use_id=toolu_01LgemVMARJA1on6ELZLVBBt` 的返回含真实 `definition/callers/...`
结构化数据（src/math.ts::add 被 multiply 调用，置信度 0.95）。

另两处 codex 修复同步落地：`source` 字段不再与 `spectraSource` 矛盾（source 只表达 host vs synthetic）；
`rootCause` 措辞按 taskCallCount 条件化。⚠️ 注意：本 PASS 用的是 **global-stock plugin（旧 build）**，
只证明 Q1 传播链路；**F177-F181 build 的接线（Q2）由 Phase C 的版本门禁 + smoke 验证**，勿混淆。
