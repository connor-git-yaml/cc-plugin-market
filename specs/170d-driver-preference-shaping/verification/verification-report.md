# Feature 170d — Verification Report

**Feature**: 170d Driver Preference Shaping | **模式**: spec-driver-feature
**验收状态**: 🟢 **`primary-pass`**（SC-002 host 实测 **8/10 = 80%**，outcomeType=primary-pass；hard gate SC-001/005/006/007/008 全过；SC-003/009 见下，SC-004 secondary deferred）
**日期**: 2026-05-30 | **commits**: spec `8fa60b6` → plan `d8bce07` → tasks `2d346bf` → RED `c313258` → GREEN `e7efc97` → verify `83b3f27` → fix `d340b53` → docs `93fa84f`

## 验收状态级别说明

F170d 达到 **`primary-pass`**：Primary Outcome SC-002（guided active-call rate ≥50%）host 实测 **8/10（80%）**，point estimate 远超 50% 门槛，落在 spec 🟢 strong signal 区间（7-10/10），harness 判定 `primaryPassGate=true / outcomeType=primary-pass`。所有 hard gate（SC-001/005/006/007/008）通过。

> **诚实标注**：Wilson 95% CI = [49.0%, 94.3%]，**下界 49.0% 略低于 50%**。这是 N=10 小样本的正常特征——point estimate 与 count 判定（8/10 ≥ 5/10）均明确 pass，但若要求「总体率 ≥50% 有 95% 置信」则下界紧贴阈值，更大 N 才能收窄。本验收按 spec 定义的 **count-based gate（≥5/10）+ point estimate（≥50%）** 判 pass，CI 作为辅助统计如实记录。

## Success Criteria 逐项结果

| SC | 标准 | Gate | 结果 | 证据 |
|----|------|------|------|------|
| SC-001 | 5 agent 含按 tools 过滤的规则块（每 agent 恰 3 行符合矩阵） | Hard | ✅ PASS | `feature-170d-preference-rules.test.ts` SC-001（含「恰好 3 行」断言；plan/implement/spec-review/quality-review=R1/R2/R3，verify=R1/R2/R4）|
| SC-002 (Primary) | guided active-call rate ≥ 50%（≥5/10） | Primary（host） | ✅ **PASS（8/10 = 80%）** | host 实测 N=10（driver=claude-sonnet-4-6，--append-system-prompt 注入 implement 渲染块，--strict-mcp-config）：impactResolvedSuccessRate 8/10，Wilson [49.0%,94.3%]，primaryPassGate=true。report JSON（gitignored）`sc-002-driver-eval-2026-05-30T10-04-54-062Z.json`。vs F170c baseline 0/10 |
| SC-003 | Grep fallback（MCP 不可用时回退） | Soft（host） | ⏸️ host-pending（OAuth 受阻） | harness `--simulate-graph-missing` 模式就绪；补跑尝试遇 Claude OAuth 401，需 `claude /login` 重授权后再跑 |
| SC-004 (Secondary) | chained call rate ≥ 30% | 不阻塞（host） | ⏸️ deferred | 需复用 F167 cohort C 独立流程；本 harness 不实现 chain，e2e 显式 .skip |
| SC-005 | 5 SKILL.md 含子代理调度优先级提示块 | Hard | ✅ PASS | SC-005 测（section 内含 template 路径 + namespace + 优先语义 + 位置在工作流/委派章节之前）|
| SC-006 | 块内容与 template 单一源一致（ruleId 比对）+ 工具 ⊆ frontmatter | Hard | ✅ PASS | SC-006 测 + `repo:check` `preference-rules:agent-block-sync` 双重守护 |
| SC-007 | 零回归：vitest + build + repo:check + release:check | Hard | ✅ PASS | clean full `vitest run`：323 files / 3838 passed / 0 failed；build(tsc) 0 err；repo:check status=pass；release:check valid |
| SC-008 | 不动 tool description / response format / frontmatter tools | Hard | ✅ PASS | `git diff --name-only ffc2cbb..HEAD` 未触碰任何 src/mcp 文件；agent frontmatter 无 `tools:` 行增删；SC-008 冻结快照单测 pass |
| SC-009 | over-call 负控 ≤ 1/3 | Soft（host） | ⏸️ host-pending（OAuth 受阻） | harness `--negative-control` 模式就绪；补跑尝试遇 Claude OAuth 401，需 `claude /login` 重授权后再跑 |

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
- **SC-003 / SC-009 本轮未单独跑**：均为 soft gate，建议后续补（harness 模式已就绪）。**SC-004 deferred**（secondary）。

## 交付物清单

单一事实源 template + 渲染核心（plugin 自包含）+ sync 生成/校验 + 5 agent 块 + 5 SKILL 提示 + harness（guided/negative-control/graph-missing 三模式 + 三层指标 + --delay-ms 限速 + --strict-mcp-config）+ docs §七 + repo:check 漂移守护。SC-002 80%（vs F170c 0%）验证 prompt 层引导设计有效；为未来 driver model 升级保留 leverage。

## 建议下一步

1.（soft gate 补全，OAuth 恢复后）先 `claude /login` 重授权（本轮补跑遇 401），再 host shell 跑：
   ```bash
   node scripts/feature-170d-driver-preference.mjs --negative-control --repeats 2 --delay-ms 15000   # SC-009
   node scripts/feature-170d-driver-preference.mjs --simulate-graph-missing --repeats 1 --delay-ms 15000  # SC-003
   ```
   两者均为 soft gate，不阻塞 Primary 验收；harness 已就绪（graph-missing 模式有 try/finally 保证 graph.json 恢复）。
2. rebase 最新 master + 重跑确定性验证 → 列 deliverable report 等用户确认 → push origin master（CLAUDE.local 约定）。
