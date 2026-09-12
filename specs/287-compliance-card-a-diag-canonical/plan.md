# F287 plan（卡 A：G0 + G3 + G4 + K-1）

设计资本：`specs/276-fix-compliance-p0a-residue/handoff/plan-pre-split-design-capital.md` §G0 / §G3 / §G4 + README 裁决 #4（白名单覆盖并集、差集逐条点名）、#5（`⏸️?`、撤回 ✅ 同行过滤、真值集 P/R 双报）。

| # | 步骤 | 落点 | 验收 |
|---|---|---|---|
| P0 | 红先行：卡 A 测试文件（G0/G3/G4/K-1 共 16 例） | `plugins/spec-driver/tests/fix-compliance-card-a-diagnostics.test.mjs` | 实现缺失 import 失败即红 |
| P1 | G0：`JUDGE_DIAGNOSTICS` + `USER_FACING_DIAGNOSTIC_CODES` + 产出点改引用 + `buildFeedbackText` 过滤；io `STATE_STORAGE_DIAGNOSTICS` | `fix-compliance-judge.mjs` / `fix-compliance-io.mjs` | 表外零裸字面量；可见面 11 码逐条点名 |
| P2 | G3：SKILL 惯例成文 + `repo:sync`；core `PENDING_MARK_REGEX` / `countPendingSections` / `ARTIFACT_DIAGNOSTICS`；judge 传 content；schema | `skills/spec-driver-fix/SKILL.md` / `fix-compliance-core.mjs` / verdict-event schema | T3-*；`repo:check` 0 |
| P3 | G4：core 集合构造 + 三态；judge `evaluate(…, snapshotInput)` 只走审计通道 | 同上 | T4-*；`rg deferExtraDiagnostics.*snapshot` 零命中 |
| P4 | K-1：入口守卫 → `isInvokedDirectly` | `fix-compliance-judge.mjs` | K-1 ×2；闭包守卫绿（不扩张） |
| P5 | 真值集 + 重算器 + 语料统计 | `verification/pending-truth-set.md`、`pending-truth-recompute.mjs` | P/R 双报；T4-M1 可测部分登记 |
| P6 | 异构对抗复审 ≥2 角 + verify 子代理 | `verification/` | CRITICAL 清零；变异清单逐条红 |
| P7 | 门禁 + rebase master + ff push | — | `test:plugins` 0 fail（真正门禁）+ vitest / build / repo:check / release:check |

不做：G1 / G2（卡 B）；抬预算；FR-031；`AskUserQuestion`；拆 `runHook`；改 hooks；触碰见证侧不对称。
