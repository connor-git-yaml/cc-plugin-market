---
feature: 176（产品 fix，FR-A-007c-b 分支：先修产品 wiring 再跑）
phase: 产品 prompt 修复 — spec-driver-fix SKILL.md 委派硬约束 — Codex 对抗审查记录
date: 2026-06-10
reviewers: Codex (codex-rescue) + Claude (main-thread)
scope: plugins/spec-driver/skills/spec-driver-fix/SKILL.md（+ repo:sync 再生 wrappers）
user_decision: smoke 取证后用户拍板"先修产品再评测"（三选一升级，2026-06-10）
---

# spec-driver-fix 委派硬约束 — 审查处置记录

## 修复内容
- 诊断（host 实测，cohort3 单 run 取证）：skill 真实展开后模型自判"影响范围小"把 Phase 2/3/4 全 inline、0 次 Task 派发 → F170a/d/c 整条 spectra 集成链（挂在子代理上）不触达。SWE-Bench Verified 类 1 文件修复 100% 复现。
- 修复：SKILL.md「4 阶段快速修复流程」新增**委派硬约束** block + Phase 3 强化行（恢复既有设计意图，非新增行为）。

## Codex 审查（2 CRITICAL + 3 WARNING + 2 INFO）→ 处置

| 档位 | finding | 处置 |
|------|---------|------|
| 🔴 C-1 | "Task 不可用（环境受限）"无证据门槛，可常态化逃逸 | **唯一降级通道**收紧：必须实际发出 Task 且失败 + 留存 error 证据 + 降级当下立即输出原因；未尝试即 inline = 违约 |
| 🔴 C-2 | Phase 3"不得亲自改代码"与 DEGRADED 通道冲突 | Phase 3 行改为"除非走唯一降级通道（实际 Task 失败 + 留证）"显式衔接 |
| 🟡 W-1 | "GATE 检查点"边界可被包装逃逸 | 限定为"明确命名的 `GATE_*` 的**决策判断本身**，任何代码/文档产出不得以 GATE 为名亲自执行" |
| 🟡 W-2 | [DEGRADED] 仅最终报告标注，滥用成本低 | 并入 C-1：降级当下立即输出 + 报告标注含阶段与失败原因 |
| 🟡 W-3 | 逃逸理由列举不穷尽 | 改"禁止以**任何理由**"+ 列举仅作示例（含"用户未要求多代理/上下文不足"）|
| ℹ️ I-1 | 与未读阶段定义的潜在矛盾 | 已核：Phase 1/问题上下文扫描/GATE 亲自执行为既有设计，硬约束显式列出三者，无矛盾 |
| ℹ️ I-2 | 交互式使用强制派发成本上升 | **接受的 trade-off**：4 阶段委派是 SKILL 既定设计（工作流定义 172 行从来如此），collapse 才是 bug；不开"交互模式豁免"否则回到 collapse。成本影响留 M8 观察（若交互用户反馈派发过重，再设计显式 lite 模式而非默许逃逸 |

## 验证
- repo:sync 后 codex wrapper 含硬约束 ✓；repo:check pass ✓；全量 vitest 4237 全绿 ✓
- 行为验证 = cohort3 单 run 探针（Task>0 且 mcpToolCallCount>0）→ smoke（见 host 执行记录）

## 附录：第二轮迭代（probe2 证伪 prompt 路线 → frontmatter model 修正）
- probe2（硬约束生效后）实测：约束**确认进入上下文**（首轮 cache 36650 vs 旧 35952，+698 ≈ 新增 block 体积），sonnet 编排器**仍然 0 派发**且复述被禁理由（"1个文件"）→ prompt 强度路线对 sonnet 证伪。
- 根因升级：SKILL frontmatter `model: sonnet` 与文档化模型策略相悖（agent-code-quality 共享段："诊断阶段（fix-report 5-Why）使用 Opus（spec-driver-fix 已默认如此）"）——frontmatter 才是实际生效层，文档声称的默认从未落地。修正 `model: opus`（带注释）。
- probe3（opus 编排器）实测：**mcpToolCalls=4（impact×3 + context×1），全部 parent_tool_use_id 归因子代理，w3Flag=false** → 委派链 + F170a/d/c 全链路端到端打通。结论：委派契约成立的前提是编排器用 opus；sonnet 编排器即使面对 MUST 也会 collapse（已记 m8：若要 sonnet 编排器省成本，需 hook 级机制强制而非 prompt）。
- 连带数据层修正（host 实测字段形态）：fixture 的 oracle 结果实际落盘在 `taskExecution.primaryOracle` 且 `details` 是 JSON 字符串 → batch 的 readOracleResult 权威路径 + classifyOracle 字符串解析（真实 fixture 回归：control→pass / probe3→fail ✓）。

## 附录 2：Verify 阶段报告终审（2026-06-12）
- Codex 终审结论：**0 CRITICAL**（150/150、lift、cohort 分布、超时、token 等数字主线与 host 事实全部一致）+ 4 WARNING（措辞诚实度）+ 3 INFO（internal-cohort-only 合规 / 偏离披露到位 / 可审计性可补强）。
- 4 项 WARNING 全部采纳修订：① TL;DR 明示"SC-002 未达标（1.77<2，verify 12/13）"，机制成立与验收未过分层陈述；② "决定性调节变量/反超"降级为"fixture-level 假设性信号（n=3，待规模化验证）"，并精确为"c2 2/3 反超、c3 1/3 打平"；③ 产品定位建议全部标注"M8 待验假设"，不作已验结论固化；④ §11 验收行补"最终 12/13 PASS，SC-002 未达标"。
- 修订后复扫：禁用词 0 违规、SC-005 锚点口径 9/9、verify 12/13 稳定。
