---
feature: 176
phase: Specify — Codex 对抗审查记录
date: 2026-06-08
reviewers: Codex (gpt-5.x via codex-rescue) + Claude (main thread self-adversarial)
note: 本记录同时作为 FR-C-007"两模型重叠 + 独有盲点"分类的真实样例，供最终报告引用
---

# F176 Spec 阶段对抗审查 — 两模型重叠 + 独有

> 第一次 Codex 调用 stalled（空输出 23min，codex CLI turn 卡死）；重试成功返回。两路独立审查（Codex / Claude）结果交叉分类如下。全部 finding 已在 spec 修订中处置。

## A. 两模型重叠（高置信 — Codex 与 Claude 都独立指出）

| # | Finding | 档位 | spec 处置 |
|---|---------|------|----------|
| O-1 | cohort 3 spectra 版本门禁只"记录 commit"不可证伪，旧 binary 也能产 MCP call → smoke 误通过 | CRITICAL | FR-A-004b + SC-001b：smoke 主动验 F177-F181 marker/祖先链，失败 hard-fail |
| O-2 | falsification(lift<1.5×) 可被 task selection / 重跑规避 | CRITICAL | FR-A-002b：预注册 10 task id+seed+筛选规则，跑满 150，禁后剔除，重跑设上限 |
| O-3 | OAuth 下 token-per-completed-task 无明确数据来源 → 纸面数字 | CRITICAL | FR-B-003a：取 claude stream-json usage，缺失标 TOKENS-UNAVAILABLE 剔除，不冒充 |
| O-4 | N=3 repeat worktree 串扰未覆盖 | WARNING | FR-A-006/006b：每 repeat 独立 worktree，path 含 repeatIndex，验无共享 dirty state |
| O-5 | judge 无 blinding（claude judge 与 driver 同源偏好） | WARNING | FR-A-008b：anonymizeFixture 隐藏 cohort/tool/repeat 元数据 + blinding hash |
| O-6 | cohort prompt confound 只声明未审计 → over-claim 风险 | WARNING | FR-A-003/003b：保存 effective prompt+hash+diff；lift 表述为 product-bundle directional |
| O-7 | SC-006/SC-007 是纸面声明，无可复核 artifact/规则 | WARNING | SC-006→m8-fix-candidates.md；SC-007→forbidden-claims-checklist.md 禁用词扫描 |

## B. Claude 独有（Codex 盲点）

| # | Finding | 档位 | spec 处置 |
|---|---------|------|----------|
| C-only-1 | **oracle vs LLM-jury 真值角色混淆**：F158 用 functional oracle 定 pass/fail 且刻意不用 LLM judge；milestone §3 又写 3-judge jury。spec 未分离二者职责 → pass-rate 真值来源不明（最根本的 validity 问题） | CRITICAL（自评） | FR-A-001b：pass/fail=functional oracle；jury 仅质量/grounding 叠加层不覆盖 pass/fail；Run/Jury 实体与 Edge Cases 同步澄清 |
| C-only-2 | SuperPowers/GStack 版本未 pin（复现性） | INFO | 并入 FR-A-004 审计记录精神（实现期记录 cohort4/5 版本）|

> C-only-1 用读 `eval-task-finalize.mjs`(runPrimaryOracle) + `eval-judge-jury.mjs`(质量评分) 的事实确认，非推测。

## C. Codex 独有（Claude 盲点）

| # | Finding | 档位 | spec 处置 |
|---|---------|------|----------|
| X-only-1 | blinding **hash** 机制（不仅隐藏，还要留可审计指纹） | WARNING | 并入 FR-A-008b（记录 blinding hash）|
| X-only-2 | FR-C-003"对标 Augment 3×/Anthropic -98.7%"实现时可能脱离 FR-C-004 限定口径 | INFO | FR-C-003 内联 code-execution-with-MCP 限定，防口径漂移 |

## 结论

- 处置原则（CLAUDE.local.md）：全部为真实设计缺陷 / 边界遗漏 → spec 阶段即修，无"风格偏好"档跳过项。
- 3 条 CRITICAL（重叠）+ 1 条 CRITICAL（Claude 独有 oracle/jury）均已落 FR/SC，可被 verify 阶段证实。
- 价值佐证：两模型重叠 7 条印证高置信；各自独有共 4 条印证单审查有盲点 —— 直接支撑 FR-C-007 报告分类法。
