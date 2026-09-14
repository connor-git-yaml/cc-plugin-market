# 实施计划：簇④ 引擎 / CLI 小补合集（M11 卡 C）

## Constitution Check

原则 VIII（源码改动走 spec-driver）：本批在 `/goal` 授权下由主线程直接实现，制品按最小集补齐（本文件 + spec + tasks + verification）。原则 IX / X 无涉。
本节引用的 FR 全部登记在下方矩阵（FR-001 ~ FR-014）。

## FR → Phase 覆盖矩阵

| FR | 类别 | Phase | 落点 |
|---|---|---|---|
| FR-001 | 实现型 | A | `plugins/spec-driver/scripts/orchestrator-cli.mjs` |
| FR-002 | 实现型 | A | `scripts/lib/worktree-local-state-core.mjs`、story / feature SKILL |
| FR-003 | 实现型 | B | `plugins/spec-driver/scripts/check-fr-matrix.mjs`、`agents/plan.md` |
| FR-004 | 实现型 | B | 同上、`agents/verify.md` |
| FR-005 | 实现型 | C | `templates/gate-class-mandatory-upgrade.md`、`scripts/sync-agent-docs.mjs` |
| FR-006 | 实现型 | A | `plugins/spec-driver/lib/orchestration-output-serializer.mjs` |
| FR-007 | 实现型 | C | `agents/verify.md` |
| FR-008 | 实现型 | C | `templates/gate-design-convergence-loop.md` |
| FR-009 | 实现型 | D | `plugins/spec-driver/scripts/sync-merge-engine.mjs` |
| FR-010 | 实现型 | D | 同上 |
| FR-011 | 实现型 | D | 同上、`lib/sync-validator.mjs`、`lib/sync-fr-floor.mjs` |
| FR-012 | 实现型 | D | `lib/spec-directory-index.mjs`、catalog / quality / scorecard core |
| FR-013 | 实现型 | D | `lib/sync-product-mapping.mjs` |
| FR-014 | 实现型 | E | `tests/**` |

## 裁剪登记

无（14 项全部实现；对抗审查 W-11 的「feature 模式同型步骤」已补，I-1 的分层索引已补）。

## 审查

两路异构对抗（sync 引擎侧 / CLI-序列化-散文侧）：3C + 6W + 8I / 3C + 11W + 8I，处置见 `verification/verification-report.md`。
