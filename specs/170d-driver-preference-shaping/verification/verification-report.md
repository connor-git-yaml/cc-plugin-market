# Feature 170d — Verification Report

**Feature**: 170d Driver Preference Shaping | **模式**: spec-driver-feature
**验收状态**: 🟢 **`primary-pass`**（SC-002 host 实测 **8/10 = 80%**，outcomeType=primary-pass；hard gate SC-001/005/006/007/008 全过；soft gate **SC-009 over-call 0/6 PASS**；**SC-003 fallback-fail（暴露真实 limitation，见下，soft 不阻塞）**；SC-004 secondary deferred）
**日期**: 2026-05-30 | **commits**: spec `8fa60b6` → plan `d8bce07` → tasks `2d346bf` → RED `c313258` → GREEN `e7efc97` → verify `83b3f27` → fix `d340b53` → docs `93fa84f`

## 验收状态级别说明

F170d 达到 **`primary-pass`**：Primary Outcome SC-002（guided active-call rate ≥50%）host 实测 **8/10（80%）**，point estimate 远超 50% 门槛，落在 spec 🟢 strong signal 区间（7-10/10），harness 判定 `primaryPassGate=true / outcomeType=primary-pass`。所有 hard gate（SC-001/005/006/007/008）通过。

> **诚实标注**：Wilson 95% CI = [49.0%, 94.3%]，**下界 49.0% 略低于 50%**。这是 N=10 小样本的正常特征——point estimate 与 count 判定（8/10 ≥ 5/10）均明确 pass，但若要求「总体率 ≥50% 有 95% 置信」则下界紧贴阈值，更大 N 才能收窄。本验收按 spec 定义的 **count-based gate（≥5/10）+ point estimate（≥50%）** 判 pass，CI 作为辅助统计如实记录。

## Success Criteria 逐项结果

| SC | 标准 | Gate | 结果 | 证据 |
|----|------|------|------|------|
| SC-001 | 5 agent 含按 tools 过滤的规则块（每 agent 恰 3 行符合矩阵） | Hard | ✅ PASS | `feature-170d-preference-rules.test.ts` SC-001（含「恰好 3 行」断言；plan/implement/spec-review/quality-review=R1/R2/R3，verify=R1/R2/R4）|
| SC-002 (Primary) | guided active-call rate ≥ 50%（≥5/10） | Primary（host） | ✅ **PASS（8/10 = 80%）** | host 实测 N=10（driver=claude-sonnet-4-6，--append-system-prompt 注入 implement 渲染块，--strict-mcp-config）：impactResolvedSuccessRate 8/10，Wilson [49.0%,94.3%]，primaryPassGate=true。report JSON（gitignored）`sc-002-driver-eval-2026-05-30T10-04-54-062Z.json`。vs F170c baseline 0/10 |
| SC-003 | Grep fallback（MCP 不可用时回退） | Soft（host） | ⚠️ **fallback-fail（真实 limitation）** | host 实测 `--simulate-graph-missing` N=5：graph 移走后 driver 仍调 impact（mcpCalls 1-2，4/5 attempt），**grep=0/5、fallback=0/5**——未观察到预期的「impact 失败→回退 Grep」。outcomeType=fallback-fail。诊断见下。JSON `sc-002-driver-eval-2026-05-30T13-29-49-305Z.json` |
| SC-004 (Secondary) | chained call rate ≥ 30% | 不阻塞（host） | ⏸️ deferred | 需复用 F167 cohort C 独立流程；本 harness 不实现 chain，e2e 显式 .skip |
| SC-005 | 5 SKILL.md 含子代理调度优先级提示块 | Hard | ✅ PASS | SC-005 测（section 内含 template 路径 + namespace + 优先语义 + 位置在工作流/委派章节之前）|
| SC-006 | 块内容与 template 单一源一致（ruleId 比对）+ 工具 ⊆ frontmatter | Hard | ✅ PASS | SC-006 测 + `repo:check` `preference-rules:agent-block-sync` 双重守护 |
| SC-007 | 零回归：vitest + build + repo:check + release:check | Hard | ✅ PASS | clean full `vitest run`：323 files / 3838 passed / 0 failed；build(tsc) 0 err；repo:check status=pass；release:check valid |
| SC-008 | 不动 tool description / response format / frontmatter tools | Hard | ✅ PASS | `git diff --name-only ffc2cbb..HEAD` 未触碰任何 src/mcp 文件；agent frontmatter 无 `tools:` 行增删；SC-008 冻结快照单测 pass |
| SC-009 | over-call 负控 ≤ 1/3 | Soft（host） | ✅ **PASS（soft-pass，0/6）** | host 实测 `--negative-control` N=6（3 non-caller-analysis task × 2）：driver **0/6 调 MCP**（全 Grep/Read），overCallRate=0 ≤ 阈值 2，outcomeType=soft-pass。JSON `sc-002-driver-eval-2026-05-30T13-16-34-905Z.json` |

## US2 实测结果（SC-002，host shell + Claude Max OAuth）

graph.json 预生成（4997 nodes）+ harness `--strict-mcp-config` 后，一次性完整跑通 N=10：

| 指标 | 值 |
|------|-----|
| impactAttemptRate | **8/10** |
| impactResolvedSuccessRate（= SC-002 主指标） | **8/10（80%）** |
| fallbackAfterImpactFailureRate | 0/10 |
| Wilson 95% CI | [49.0%, 94.3%]（下界紧贴 50%，见上诚实标注） |
| outcomeType | **primary-pass** |
| driver / 注入 | claude-sonnet-4-6 / `--append-system-prompt`（implement 渲染块，sha256 `f66af464ac63e7e0…`） |
| namespace | `plugin_spectra_spectra`（= production，与 allowedTools 一致）+ `--strict-mcp-config` |
| 对照 baseline | F170c spontaneous **0/10** |

### 逐 run 信号（authoritative，来自 report JSON）

| run | task | mcpCalls | resolved | grep | 说明 |
|-----|------|---------|----------|------|------|
| 1 | T1-canonicalizeSymbolId | 3 | ✅ | 5 | impact + grep 混用 |
| 2 | T2-handleDetectChanges | 2 | ✅ | 3 | |
| 3 | T3-bfsTraverse | 1 | ✅ | 2 | |
| 4 | T4-getCachedGraphData | 0 | ❌ | 8 | **driver 选纯 Grep，未调 impact** |
| 5 | T5-computeRiskTier | 1 | ✅ | 2 | |
| 6 | T1-canonicalizeSymbolId | 1 | ✅ | 2 | |
| 7 | T2-handleDetectChanges | 1 | ✅ | 1 | |
| 8 | T3-bfsTraverse | 1 | ✅ | 2 | |
| 9 | T4-getCachedGraphData | 0 | ❌ | 3 | **同 T4，driver 再次选纯 Grep** |
| 10 | T5-computeRiskTier | 2 | ✅ | 15 | |

**观察**：2 个未达成 run **都是 T4-getCachedGraphData**（repeat 1 + 2 一致）。driver 对该 task 系统性偏好纯 Grep——可能因 task 描述（cache 失效逻辑 + 新增可选参数向后兼容性）更像"读单文件内部实现"而非"caller analysis"，引导的任务匹配触发较弱。其余 4 个 task（8 run）全部 resolved。这是真实的 driver 行为信号，非 harness 缺陷。

### `--strict-mcp-config` 修复确认有效

- **修复前**（上一轮）：`mcpCalls=0` 全 10 run，`resolved=false`——driver impactAttempt=true 但工具调用没接到 production server。
- **修复后**（本轮）：`mcpCalls` = 3/2/1/0/1/1/1/1/0/2（8/10 run >0），`resolved` 8/10。
- **结论**：`--strict-mcp-config`（强制只用 harness 的 `.mcp.json`，server key=`plugin_spectra_spectra`）经 host 重跑**确认是有效修复**。注：上一轮误把根因归到「ambient spectra server」已撤回；真正机制是 strict 模式确保 driver 只能用 harness 注册的 production-命名 server（之前非 strict 下工具调用未落到该 server）。

## Soft gate 实测结果（SC-003 + SC-009，host shell）

### SC-003 — Grep fallback（`--simulate-graph-missing`，N=5）⚠️ fallback-fail

graph.json 临时移走（harness exit 1 后 try/finally 已恢复 graph.json，3.8MB 完好，无 .f170d-bak 残留），模拟 graph-not-built。真实 JSON `13-29-49-305Z`：

| run | task | impactAttempt | resolved | fallback | grep | mcpCalls |
|-----|------|--------------|----------|----------|------|---------|
| 1 | T1-canonicalizeSymbolId | true | ❌ | ❌ | 0 | 1 |
| 2 | T2-handleDetectChanges | true | ❌ | ❌ | 0 | 2 |
| 3 | T3-bfsTraverse | true | ❌ | ❌ | 0 | 1 |
| 4 | T4-getCachedGraphData | false | ❌ | ❌ | 0 | 0 |
| 5 | T5-computeRiskTier | true | ❌ | ❌ | 0 | 1 |

**结果**：`grepRuns=0/5`、`fallback=0/5`、`resolved=0/5` → outcomeType=**fallback-fail**（harness exit 1）。**未观察到预期的「impact 失败 → 回退 Grep」行为**。

**诊断（真实 limitation，不粉饰）**：4/5 run driver 仍发起 impact 调用（mcpCalls 1-2），但既没 resolve（graph 缺失，符合预期）也没回退 Grep（grep=0）。可能原因：
- (a) MCP server 在 graph.json 缺失时返回的**不是** graph-not-built error envelope，而是空/降级响应，driver 接受后未触发 fallback；
- (b) driver 在单次 impact 无果后直接结束该 task，未尝试 Grep（本 harness 单 task 单轮，无"必须完成任务"压力）；
- (c) SC-003 测试设计假设过强——真实 graph-not-built 应在 batch 未跑时整体缺失，而本模拟仅移走 graph.json 文件，MCP server 行为可能与真实 not-built 不同。

**处置**：SC-003 是 **soft gate，不阻塞 Primary 验收**。此为真实信号，记为 follow-up：需进一步确认 MCP server 的 graph-missing 响应契约（impact handler 在 graph 缺失时是否返回 `code: graph-not-built`），再决定是 harness 测试设计问题还是引导 fallback 文案需加强。**不改为 pass。**

### SC-009 — over-call 负控（`--negative-control`，N=6）

3 个 non-caller-analysis task（N1 readme 大小写 / N2 TODO 清单 / N3 版本号查找）× 2 repeat：

| 指标 | 值 |
|------|-----|
| over-call（调 MCP 的 run） | **0/6** |
| overCallRate | 0 |
| soft gate 阈值 | ≤ 2 |
| 每 run | exit=0，impactAttempt=false，mcpCalls=0（全 Grep/Read） |
| outcomeType | **soft-pass** |

**结论**：引导是 **SHOULD（精准定向）** 而非 blunt force——caller-analysis 任务多数调 MCP（SC-002 8/10），非 caller-analysis 任务 0% 调 MCP（SC-009 0/6）。验证 SHOULD 文案不导致 over-call（spec EC-2）。

## 测试证据（sandbox，确定性，可靠）

- **170d 单测**: `tests/unit/spec-driver/` → **40 passed**（多次稳定复现）
  - core: parseToolEvents / computeMetrics 三层指标（含 fallback 因果顺序正反例）/ wilsonCI / renderInjectionBlock 按 tools 过滤 / extractCanonicalBlock fail-loud
  - harness builder: buildMcpConfig（server key=plugin_spectra_spectra + 可执行）/ buildClaudeArgs（--append-system-prompt 值紧随 + production allowedTools + --strict-mcp-config）/ assertInjectionSubsetOfAllowed
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
| Verify | 2 CRITICAL / 2 WARNING / 3 INFO | 处置：SC-007 补 clean full run、SC-001 恰 3 行 + SC-005 位置断言；纠正会话中 US2 结果误报（最终以 host JSON 为准）|

## Limitation（诚实声明）

- **Wilson CI 下界 49.0% < 50%**：point + count 判定 pass，但 N=10 小样本下 CI 下界紧贴阈值。若需更强统计置信，可加跑至 N=20+ 收窄区间（非验收必需，spec gate 已满足）。
- **T4-getCachedGraphData 系统性未触发**：2/10 未达成 run 全集中于该 task，driver 对"读单文件内部实现"型描述偏好 Grep。说明引导是**任务匹配触发**而非无条件强制（符合 SHOULD 设计；与 SC-009 over-call 负控意图一致）。
- **度量语义边界**：SC-002 测 **guided active-call rate**（引导是否生效），非 spontaneous preference（内在偏好）。80% 表示「引导经 system-prompt 投递后，Sonnet 4.6 在多数 caller-analysis 任务上遵循引导改用 MCP」，**不外推**「模型内在偏好被改变」，也**不外推**「完整 agent body 共存其它 spec-driver 指令时同样 80%」（harness 只注入引导块，模拟 Phase A system-prompt 投递通道；N=10）。
- **SC-003 fallback-fail（真实 limitation）**：`--simulate-graph-missing` 下未观察到 driver impact-失败→回退-Grep（grep=0/5）。soft gate 不阻塞验收，但记为 follow-up：需确认 MCP server 在 graph 缺失时的响应契约（是否返回 graph-not-built error envelope）。详见上 SC-003 段诊断。
- **SC-004 deferred**（secondary）：chained call rate 需 F167 cohort C 独立流程，不阻塞本 feature 验收。（SC-009 over-call 0/6 已通过；SC-003 见上 fallback-fail。）

## 交付物清单

单一事实源 template + 渲染核心（plugin 自包含）+ sync 生成/校验 + 5 agent 块 + 5 SKILL 提示 + harness（guided/negative-control/graph-missing 三模式 + 三层指标 + --delay-ms 限速 + --strict-mcp-config）+ docs §七 + repo:check 漂移守护。SC-002 80%（vs F170c 0%）验证 prompt 层引导设计有效；为未来 driver model 升级保留 leverage。

## 验收结论

**F170d Primary + 全部 hard gate 通过，达成验收**：Primary SC-002（8/10 primary-pass）+ 全部 hard gate（SC-001/005/006/007/008）+ soft gate SC-009（over-call 0/6 soft-pass）。**SC-003（Grep fallback）为 fallback-fail**——soft gate 不阻塞验收，但暴露真实 limitation（MCP graph-missing 响应契约待确认），记为 follow-up。SC-004（secondary chained call）deferred。

**诚实总评**：核心价值（prompt 层引导让 driver 改用 MCP）已由 SC-002 80%（vs F170c 0%）+ SC-009 精准定向 0/6 双向验证。SC-003 的 fallback 路径未达预期，是这次实测发现的真实缺口，不掩盖。

## 建议下一步

1. rebase 最新 master + 重跑确定性验证（vitest/build/repo:check/release:check）。
2. （可选）补一次 Codex 对抗审查覆盖 `--strict-mcp-config` 这处 host-fix（GREEN 实质代码已过 codex 审查；此 flag 修复因环境不稳当时为目视自审）。
3. 列 deliverable report 等用户明确确认 → push origin master（CLAUDE.local 约定）。
