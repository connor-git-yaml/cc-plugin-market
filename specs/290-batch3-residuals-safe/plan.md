# F290 plan

| FR | 落点 | 要点 |
|---|---|---|
| FR-001 | `lib/judge-snapshot-core.mjs`（+SIDECHAIN_FILE_SET / DOCTOR_FILE_SET）、`judge-snapshot-doctor.mjs`（roster）、`tests/sidechain-file-set-guard.test.mjs`（新）、judge-snapshot 三套件长度钉 | JUDGE_FILE_SET 不动；union 保序保入口 |
| FR-002 | `lib/fix-compliance-io.mjs` 接管分支 trace 钩子；card-b T1-C6 / T-S2 | 时序：A 延迟 150 < B 持锁 300 < 150+480 重试预算 |
| FR-003 | card-a T0-U6 | 三形态解析 + allowlist 双向 |
| FR-004 | `fix-compliance-judge.mjs`：`tryAppendFailOpenEvent(tier)`、`evaluate.tier2CandidatePath`、`tier2BindingNotice`、`dispatchRoute` 三 arm；tier2 E4 | 走既有 `noticeLine` 渲染点，不动可见码集合 |
| FR-005 | `skills/spec-driver-resume/SKILL.md` 恢复表；`repo:sync` 再生 `.codex/skills` 与 `skills-codex` 包装 | 恢复表段不在同步区块内 |

取舍：不把 sidechain CLI 塞进 JUDGE_FILE_SET（会破 FR-002b「闭包完全相等」守卫与 11 长度钉、且判定器确实不 import 它）；改为并列集 + union 给 doctor。
