# Feature 170d — Verification Report

**Feature**: 170d Driver Preference Shaping | **模式**: spec-driver-feature
**验收状态**: 🟡 **`host-pending`**（hard gate SC-001/005/006/007/008 全过；**Primary Outcome SC-002 尚无 authoritative report JSON**——见「US2 跑批状态」；SC-003/009 待跑，SC-004 secondary deferred）
**日期**: 2026-05-30 | **commits**: spec `8fa60b6` → plan `d8bce07` → tasks `2d346bf` → RED `c313258` → GREEN `e7efc97` → verify `83b3f27`

## 验收状态级别说明

F170d 处于 **`host-pending`**：所有 sandbox hard gate（SC-001/005/006/007/008）通过。**Primary Outcome SC-002（guided active-call rate ≥50%）尚未取得 authoritative report JSON**（见下「US2 跑批状态」）→ **不得标 full PASS**。需在稳定 host shell 一次性完整跑通后，以 harness 写出的 report JSON 为准升级状态。

## Success Criteria 逐项结果

| SC | 标准 | Gate | 结果 | 证据 |
|----|------|------|------|------|
| SC-001 | 5 agent 含按 tools 过滤的规则块（每 agent 恰 3 行符合矩阵） | Hard | ✅ PASS | `feature-170d-preference-rules.test.ts` SC-001（含「恰好 3 行」断言；plan/implement/spec-review/quality-review=R1/R2/R3，verify=R1/R2/R4）|
| SC-002 (Primary) | guided active-call rate ≥ 50%（≥5/10） | Primary（host） | ⏸️ **host-pending（无 authoritative JSON）** | harness 就绪 + 40 单测验证调用装配；跑批过程见下，**当前 verification/ 下无 sc-002-driver-eval JSON**，不主张数值结果 |
| SC-003 | Grep fallback（MCP 不可用时回退） | Soft（host） | ⏸️ host-pending | harness `--simulate-graph-missing` 模式就绪；未完成 |
| SC-004 (Secondary) | chained call rate ≥ 30% | 不阻塞（host） | ⏸️ deferred | 需复用 F167 cohort C 独立流程；本 harness 不实现 chain，e2e 显式 .skip |
| SC-005 | 5 SKILL.md 含子代理调度优先级提示块 | Hard | ✅ PASS | SC-005 测（section 内含 template 路径 + namespace + 优先语义 + 位置在工作流/委派章节之前）|
| SC-006 | 块内容与 template 单一源一致（ruleId 比对）+ 工具 ⊆ frontmatter | Hard | ✅ PASS | SC-006 测 + `repo:check` `preference-rules:agent-block-sync` 双重守护 |
| SC-007 | 零回归：vitest + build + repo:check + release:check | Hard | ✅ PASS | clean full `vitest run`：323 files / 3838 passed / 0 failed；build(tsc) 0 err；repo:check status=pass；release:check valid |
| SC-008 | 不动 tool description / response format / frontmatter tools | Hard | ✅ PASS | `git diff --name-only ffc2cbb..HEAD` 未触碰任何 src/mcp 文件；agent frontmatter 无 `tools:` 行增删；SC-008 冻结快照单测 pass |
| SC-009 | over-call 负控 ≤ 1/3 | Soft（host） | ⏸️ host-pending | harness `--negative-control` 模式就绪；未完成 |

## US2 跑批状态 + 关键发现（诚实记录）

本会话 host 跑 SC-002 未取得最终 report JSON，但**取得了可靠的部分实测数据**，并据此发现并修复了一个真实 harness bug：

### 部分实测数据（来自 harness 日志，可靠）

graph 预生成后的一轮 US2，前 7 个 run 全部 `exit=0`，逐 run 信号：

| 信号 | 观察 | 含义 |
|------|------|------|
| `impactAttempt` | **5/7 run = true** | **driver 主动尝试调用 impact 工具** — 引导生效的真实证据（vs F170c baseline 连 attempt 都 0）|
| `mcpCalls` (production NS) | 0 | 但调用没落到 production 命名的 server |
| `resolved` | false | 故 SC-002 主指标（success envelope）未达成 |

### 根因（已定位 + 已修）

`impactAttempt=true` 但 `mcpCalls=0`（仅数 `mcp__plugin_spectra_spectra__` 前缀）的矛盾，说明 **driver 调的是旧命名 `mcp__spectra__impact`**。根因：`~/.claude.json` 全局配置存在 ambient `spectra` MCP server（`global mcpServers: spectra` 已确认），driver 优先用它；而 harness 的 `--allowedTools` 只放行 production 命名 → 旧命名调用被拦截 → 无 tool_result → `resolved=false`。

**修复**：harness `buildClaudeArgs` 增加 **`--strict-mcp-config`**（已确认该 flag 存在），只用 harness 写的 `.mcp.json`（server key=`plugin_spectra_spectra`），屏蔽 ambient `spectra`。修复后 driver 只能调 production 命名、且在 allowedTools 内 → 应能 resolve。harness 单测新增 `--strict-mcp-config` 断言守护。

### 诚实结论

- **引导生效有真实证据**（impactAttempt 5/7 vs F170c 0），但 **SC-002 主指标（impactResolvedSuccess）尚无 authoritative JSON**——`--strict-mcp-config` 修复需在稳定 host shell 重跑验证。
- 会话中曾两度把不可靠的后台日志读取误写成「10/10 PASS」，**均已撤回**；本报告以 harness 日志可核实的信号为准，SC-002 维持 **host-pending**。
- 环境约束：本会话工具输出管道间歇丢失 + self-dogfood batch 缓慢 + 一次清理误杀自身 harness 进程，叠加导致无法在此会话完成最终 JSON。

## 测试证据（sandbox，确定性，可靠）

- **170d 单测**: `tests/unit/spec-driver/` → **40 passed**（多次稳定复现）
  - core: parseToolEvents / computeMetrics 三层指标（含 fallback 因果顺序正反例）/ wilsonCI / renderInjectionBlock 按 tools 过滤 / extractCanonicalBlock fail-loud
  - harness builder: buildMcpConfig（server key=plugin_spectra_spectra + 可执行）/ buildClaudeArgs（--append-system-prompt 值紧随 + production allowedTools）/ assertInjectionSubsetOfAllowed
  - 静态: SC-001（恰 3 行）/ SC-005（块位置）/ SC-006 / SC-008
- **零回归**: clean full `vitest run` 3838 passed / 0 failed；`npm run build`（tsc 0 错）；`npm run repo:check` status=pass（含 `preference-rules:agent-block-sync`）；`npm run release:check` valid

## Codex 阶段性对抗审查汇总

| Phase | 结论 | 处置 |
|-------|------|------|
| Specify | 3 CRITICAL / 5 WARNING / 4 INFO | 全处置：注入通道映射、工具子集冲突（按 tools 过滤）、循环论证（指标更名 guided）等 |
| Plan | 2 CRITICAL / 6 WARNING / 3 INFO | 全处置：namespace 统一、marker 锚点、抽共享 core、parseToolEvents 事件模型、repo:check 接入、gitignore |
| Tasks | 4 CRITICAL / 8 WARNING / 2 INFO | 全处置：CLI guard idiom、buildInjectionBlock 纯度拆分、ruleId/toolKey 分离、US2 sandbox 代理测 |
| RED | 2 CRITICAL / 2 WARNING / 3 INFO | 全处置：fallback 因果 seq、builder false-green、SC-005 强化、e2e HOST_E2E gate；自查修 SC-006 vacuous pass |
| GREEN | 3 CRITICAL / 3 WARNING / 4 INFO | 全处置：try/finally 恢复 graph、模式分别退出语义、extractCanonicalBlock fail-loud、移除 --mode chain 假覆盖 |
| Verify | 2 CRITICAL / 2 WARNING / 3 INFO | 处置：SC-007 补 clean full run、SC-001 恰 3 行 + SC-005 位置断言；**纠正 US2 结果误报（无 JSON 不主张数值）** |

## Limitation（诚实声明）

- **SC-002 无有效实测**：本会话环境受限（输出管道丢失 + batch 缓慢 + 清理误杀进程），未取得 authoritative report JSON。需在稳定 host shell 重跑（graph.json 已预生成，harness 会跳过 batch；务必让 harness 完整写出 JSON、**勿中途 kill**）。
- **度量语义边界**：SC-002 测 **guided active-call rate**（引导是否生效），非 spontaneous preference（内在偏好）；harness 只注入引导块（模拟 Phase A system-prompt 投递通道），不外推完整 agent body 行为。
- **SC-003 / SC-009 未完成**；**SC-004 deferred**（secondary）。

## 交付物清单

基础设施完整交付（不依赖 SC-002 实测）：单一事实源 template + 渲染核心（plugin 自包含）+ sync 生成/校验 + 5 agent 块 + 5 SKILL 提示 + harness（guided/negative-control/graph-missing 三模式 + 三层指标 + --delay-ms 限速）+ docs §七 + repo:check 漂移守护。

## 建议下一步（稳定 host shell）

1. graph.json 已存在（3.8MB）+ harness 已加 `--strict-mcp-config` → 直接前台跑（约 10 min，勿 kill）：
   ```bash
   node scripts/feature-170d-driver-preference.mjs --repeats 2 --delay-ms 15000
   ```
   等它打印 `Report:` + `outcomeType:` 并落地 `verification/sc-002-driver-eval-*.json`。预期 `--strict-mcp-config` 后 `mcpCalls>0` + `resolved=true`。
2. 以该 JSON 为准更新本报告（≥5/10 primary-pass / 3-4 degraded / 0-2 fail）。
3. （可选）`node scripts/feature-170d-driver-preference.mjs --negative-control --repeats 2 --delay-ms 15000` 验 SC-009。
4. SC-002 取得 authoritative 结果后再 push origin master（CLAUDE.local 约定：push 前列 report 等用户确认）。
