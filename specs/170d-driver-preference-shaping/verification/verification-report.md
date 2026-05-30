# Feature 170d — Verification Report

**Feature**: 170d Driver Preference Shaping | **模式**: spec-driver-feature
**验收状态**: 🟡 **`host-pending`**（确定性 hard gate SC-001/005/006/008 全过；SC-007 conditional pass = 确定性测试全绿、LLM-live flaky 待额度复跑；SC-002 主指标待 host shell 实测）
**日期**: 2026-05-30 | **commits**: spec `8fa60b6` → plan `d8bce07` → tasks `2d346bf` → RED `c313258` → GREEN `9ad96bc`

## 验收状态级别说明

按 spec 验收状态矩阵，F170d 当前处于 **`host-pending`**：所有 sandbox 可验的 hard gate（SC-001/005/006/007/008）通过，但 **Primary Outcome SC-002（guided active-call rate ≥50%）需 host shell + Claude Max OAuth 实测**，尚未执行 → **不得标 full PASS**。host 实测后升级为 `primary-pass`（≥50%）或 `degraded`（<50%）。

## Success Criteria 逐项结果

| SC | 标准 | Gate | 结果 | 证据 |
|----|------|------|------|------|
| SC-001 | 5 agent 含按 tools 过滤的规则块（每 agent 3 行符合矩阵） | Hard | ✅ PASS | `feature-170d-preference-rules.test.ts` SC-001（5 个 agent，plan/implement/spec-review/quality-review=R1/R2/R3，verify=R1/R2/R4）|
| SC-002 (Primary) | guided active-call rate ≥ 50%（≥5/10） | Primary（host） | ⏸️ **host-pending** | harness 就绪；单测**仅验证调用装配**（namespace/flag/注入块/三层指标计算），**不代表 SC-002 主指标已验证**；真实 driver 行为待 host 跑 |
| SC-003 | Grep fallback（MCP 不可用时回退） | Soft（host） | ⏸️ host-pending | harness `--simulate-graph-missing` 模式就绪 |
| SC-004 (Secondary) | chained call rate ≥ 30% | 不阻塞（host） | ⏸️ deferred | 需复用 F167 cohort C 独立流程；本 harness 不实现 chain，e2e 显式 .skip 标注 |
| SC-005 | 5 SKILL.md 含子代理调度优先级提示块 | Hard | ✅ PASS | SC-005 测（section 内含 template 路径 + namespace + 优先语义，防关键词 stuffing）|
| SC-006 | 块内容与 template 单一源一致（ruleId 比对）+ 工具 ⊆ frontmatter | Hard | ✅ PASS | SC-006 测 + `repo:check` `preference-rules:agent-block-sync` 双重守护 |
| SC-007 | 零回归：vitest + build + repo:check + release:check | Hard | 🟡 **conditional pass** | 确定性部分全绿：build(tsc) 0 err、repo:check status=pass、release:check valid、170d 40 单测 pass；full vitest = **1 failed / 3834 passed**，唯一失败为 LLM-live rate-limit 测试（非确定性，详见下「已知 flaky」）。**full-green vitest 待 API 额度恢复复跑确认** |
| SC-008 | 不动 tool description / response format / frontmatter tools | Hard | ✅ PASS | `git diff --name-only 8fa60b6..9ad96bc` **未触碰任何 src/mcp 文件**（无 description/response 改动）；agent frontmatter **无 `tools:` 行增删**；SC-008 冻结快照单测 pass |
| SC-009 | over-call 负控 ≤ 1/3 | Soft（host） | ⏸️ host-pending | harness `--negative-control` 模式 + 3 个 non-caller-analysis task 就绪 |

## 测试证据

- **170d 单测**: `tests/unit/spec-driver/` → **40 passed**（harness 纯函数 19 + 静态结构 21）
  - core: parseToolEvents / computeMetrics 三层指标（含 fallback 因果顺序正反例）/ wilsonCI / renderInjectionBlock 按 tools 过滤（R1/R2 不被 tool collide）
  - harness builder（US2 机制代理测）: buildMcpConfig（server key=plugin_spectra_spectra + 可执行）/ buildClaudeArgs（--append-system-prompt 值紧随 + production allowedTools）/ assertInjectionSubsetOfAllowed / extractCanonicalBlock fail-loud
  - 静态: SC-001/005/006/008
- **确定性零回归**: `npm run build`（tsc 0 错）；`npm run repo:check` status=pass（新增 `preference-rules:agent-block-sync` 通过）；`npm run release:check` valid
- **SC-008 diff 证据**: `git diff --name-only 8fa60b6..9ad96bc` 改动文件仅 = 5 agent（各 +16 行 marker 块）+ 5 SKILL + docs + lib/sync/core/harness/repo-maintenance + tests + .gitignore；**无 src/mcp、无 frontmatter tools 改动**
- **import 安全**: harness 被 vitest import 不执行 main（CLI guard endsWith）

### 已知 flaky（LLM-live，rate-limit 依赖；判定为环境性，非确定性回归）

full `vitest run` 的失败集中在 **LLM-live 测试** `tests/panoramic/qa/qa-integration.test.ts`（jury claude-sonnet-4-6）+ image-extractor vision API，失败信息字面为 **API rate limit**。这些测试 pass/fail **随 API 额度实时波动**：同一测试在额度可用时 10/10 pass、额度耗尽时部分 Citation 断言 fail（codex 复核时实测 7 pass / 3 fail）。

**判定为环境性而非本 feature 回归**，依据：(1) 本 feature diff **不触碰** panoramic/qa 任何文件（见 SC-008 diff 证据）；(2) 失败均来自 LLM jury / vision API 的 rate-limit，非断言逻辑错误；(3) 失败数量随额度波动，非确定性。

**诚实边界**：当前环境 API 持续 rate-limited，**无法在本环境复现 full-green vitest**。SC-007 因此标 conditional pass——确定性测试全绿，full-green 待 API 额度恢复后复跑确认。这也是 SC-002 host 实测不宜此刻在本环境进行的同一约束。

## Codex 阶段性对抗审查汇总

| Phase | 结论 | 处置 |
|-------|------|------|
| Specify | 3 CRITICAL / 5 WARNING / 4 INFO | 全处置：C-1 注入通道映射、C-2 工具子集冲突（按 tools 过滤）、C-3 循环论证（指标更名 guided）、W-1~5、I-1/4 |
| Plan | 2 CRITICAL / 6 WARNING / 3 INFO | 全处置：C-1 namespace 统一、C-2 marker 锚点、W-3 抽共享 core、W-4 parseToolEvents 事件模型、W-5 repo:check 接入点、W-6 gitignore |
| Tasks | 4 CRITICAL / 8 WARNING / 2 INFO | 全处置：C-1 CLI guard idiom、C-2 buildInjectionBlock 纯度拆分、C-3 ruleId/toolKey 分离、C-4 US2 sandbox 代理测 |
| RED | 2 CRITICAL / 2 WARNING / 3 INFO | 全处置：C-1 fallback 因果 seq、C-2 builder false-green、W-1 SC-005 强化、W-2 e2e HOST_E2E gate；自查修 SC-006 vacuous pass |
| GREEN (Implement) | 3 CRITICAL / 3 WARNING / 4 INFO | 全处置：C-1 try/finally 恢复 graph、C-2 模式分别退出语义、C-3 extractCanonicalBlock fail-loud；W-3 移除 --mode chain 假覆盖；W-1/W-2 接受并记录；4 INFO 确认设计正确 |

## 未达成 / Limitation（诚实声明）

- **SC-002 主指标未实测**：当前 `host-pending`。需 host shell + Claude Max OAuth + `npm run build` + spectra batch 生成 graph 后跑 `node scripts/feature-170d-driver-preference.mjs --repeats 2`。执行环境当前 API rate-limited，不宜在 sandbox 跑。
- **度量语义边界**：SC-002 测 **guided active-call rate**（引导是否生效），非 spontaneous preference（内在偏好）。即使 ≥50%，结论限定为「prompt 层引导能驱动 driver 改用 MCP」，不外推「模型内在偏好被改变」，也不外推「完整 agent body 共存其它指令时同样有效」（harness 只注入引导块，模拟 Phase A system-prompt 投递通道）。
- **SC-004 deferred**：chained call 需 F167 cohort C 独立流程，secondary 不阻塞。

## 交付物清单

基础设施完整交付（无论 SC-002 实测结果）：单一事实源 template + 渲染核心 + sync 生成/校验 + 5 agent 块 + 5 SKILL 提示 + harness（3 模式 + 三层指标）+ docs + repo:check 漂移守护。为未来 driver model 升级（Opus 5 等）保留 leverage。

## 建议下一步

1. host shell 跑 SC-002（`--repeats 2`，N=10）→ 按 count 判定（≥5 primary-pass / 3-4 degraded / 0-2 fail），升级本报告状态。
2. 视结果决定是否启用降级方案（阈值 25% / SHOULD→MUST / 记 limitation）。
3. SC-002 达标后再 push origin master（CLAUDE.local 约定：push 前列 report 等用户确认）。
