# Phase E · FR-051 文件集 disjoint 取证（T103 前置 + T105 终判）

- 生成时点：2026-09-07 20:40，HEAD = `d86fa332`（commit ② 之后，再生产物已连带提交）
- 执行者：编排器亲自（验证类任务，不委派）
- 任务原文：`tasks.md` T103 / T105；判据：FR-051

## 1. 字面 oracle 及其缺席

T103 字面口径要求以 F276 分支 ref `claude/f276-compliance-handoff-fixes-9a9fe1` 取认领文件集 A。实跑：

```text
$ git fetch origin && git branch -a --list '*f276*'
（空输出）
# exit=0
```
```text
$ git rev-parse --verify --quiet claude/f276-compliance-handoff-fixes-9a9fe1
（空输出）
# exit=1
```
```text
$ git rev-parse --verify --quiet origin/claude/f276-compliance-handoff-fixes-9a9fe1
（空输出）
# exit=1
```
```text
$ git ls-remote --heads origin | command grep -i f276
（空输出）
# exit=1
```

**结论**：分支 ref 本地与远端均不可解析 → 按 T103 字面判「**未执行（缺席）**」，不得默认放行。**缺席原因**（可核）：F276 卡 C 已于 2026-09-03 以 rebase + ff push 交付 master（`26a3b15f`），分支按「交付后立即删除」约定删除；本卡 commit ① 已 rebase 到该 commit 之上。

## 2. 替代 oracle（编排器裁定 E-①，比字面口径更宽）

A := master 上「本卡基线 `e01611b2` → 本卡 rebase 基点 `26a3b15f`」之间落地的**全部**改动集。它是 F276 认领集的**超集**（区间还含 F278 / F279 / T063 三个非 F276 commit）：超集与 B 交集为空 ⇒ F276 认领集与 B 交集必空。

```text
$ git merge-base --is-ancestor e01611b2 26a3b15f && echo ancestor=yes
ancestor=yes
```
```text
$ git log --oneline e01611b2..26a3b15f
26a3b15f docs+test(F276-C): Phase 4 审查修补 + 制品入库 — 8 轮对抗记录 / 移交包 / 验证报告 / dogfooding 账本
5f1f1192 refactor(F276-C3): 删除 fix-compliance 判定器零接线死代码 routeNonBlock + NON_BLOCK_LIMIT / 
ffb90609 fix(F276-C): fix-compliance 判定器 !saved.ok 由「等同已达上限放行」反转为 fail-closed + 反馈计数上界（既有 
7acf8ae8 feat(F279): 护栏比较器检测面拓宽 — kind/label + metadata 递归路径 + graph.graph 四维收口
e1105e8b docs(T063/SC-013): 第二轮两层 PASS + SC-013 三段复测闭合 — T039 仅剩桌面版本号补填
058c7012 feat(F278): 诚实工具面四小补 — impact 新符号 hint / 护栏 metadata-key 档 / --init 再生审计 / judge:
```

| 集合 | 命令 | 计数（单位：文件） |
|---|---|---|
| A | `git diff --name-only e01611b2..26a3b15f` | **54** |
| B_pre（T103 时点 = 再生前：去掉两处 wrapper 目录） | `git diff --name-only 26a3b15f..HEAD \| command grep -v '^\.codex/skills/\|^plugins/spec-driver/skills-codex/'` | **103** |
| B（T105 时点 = 再生后，commit ② 全量） | `git diff --name-only 26a3b15f..HEAD` | **119** |
| A ∩ B_pre | `comm -12 <(A \| sort) <(B_pre \| sort)` | **0** |
| A ∩ B | `comm -12 <(A \| sort) <(B \| sort)` | **0** |

换算式：B − B_pre = 16 = 8 × 2 分发目录（单位：wrapper 文件），与 T102 现取的 |S| = 8 一致。

A 中 F276 判定器相关文件（供人工对照，命令 `git diff --name-only e01611b2..26a3b15f | command grep -i 'compliance\|judge'`）：

```text
$ git diff --name-only e01611b2..26a3b15f | command grep -i 'compliance\|judge'
plugins/spec-driver/scripts/fix-compliance-judge.mjs
plugins/spec-driver/scripts/judge-snapshot-doctor.mjs
plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
plugins/spec-driver/scripts/lib/fix-compliance-io.mjs
plugins/spec-driver/tests/fix-compliance-core.test.mjs
plugins/spec-driver/tests/fix-compliance-io.test.mjs
plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
plugins/spec-driver/tests/fixtures/fix-compliance/README.md
plugins/spec-driver/tests/fixtures/fix-compliance/real-stop-hook-feedback-entries.jsonl
plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs
specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json
specs/276-fix-compliance-p0a-residue/fix-report.md
specs/276-fix-compliance-p0a-residue/handoff/README.md
specs/276-fix-compliance-p0a-residue/handoff/plan-pre-split-design-capital.md
specs/276-fix-compliance-p0a-residue/implementation-notes.md
specs/276-fix-compliance-p0a-residue/plan.md
specs/276-fix-compliance-p0a-residue/research/baseline-reproduction.md
specs/276-fix-compliance-p0a-residue/research/reverse-census.md
specs/276-fix-compliance-p0a-residue/tasks.md
specs/276-fix-compliance-p0a-residue/verification/gate-design-adversarial-round1.md
specs/276-fix-compliance-p0a-residue/verification/gate-design-adversarial-round2.md
specs/276-fix-compliance-p0a-residue/verification/gate-design-adversarial-round4.md
specs/276-fix-compliance-p0a-residue/verification/gate-design-adversarial-round5.md
specs/276-fix-compliance-p0a-residue/verification/gate-design-adversarial-round6.md
specs/276-fix-compliance-p0a-residue/verification/gate-design-adversarial-round7.md
specs/276-fix-compliance-p0a-residue/verification/implementation-adversarial-c1c2.md
specs/276-fix-compliance-p0a-residue/verification/mainline-adversarial-pass1.md
specs/276-fix-compliance-p0a-residue/verification/mutation-log.md
specs/276-fix-compliance-p0a-residue/verification/quality-review-report.md
specs/276-fix-compliance-p0a-residue/verification/spec-review-report.md
specs/276-fix-compliance-p0a-residue/verification/verification-report.md
```

T103 登记的 3 个已知接触点（`scripts/lib/repo-maintenance-core.mjs` / `scripts/sync-agent-docs.mjs` / `scripts/lib/agent-tools-core.mjs`）在 A 中的命中数：

```text
$ git diff --name-only e01611b2..26a3b15f | command grep -c 'scripts/lib/repo-maintenance-core.mjs\|scripts/sync-agent-docs.mjs\|scripts/lib/agent-tools-core.mjs'
0
```

## 3. 两时点并列（T103 vs T105）

| 时点 | B 取法 | \|A ∩ B\| | 结论 |
|---|---|---|---|
| T103（再生前） | B_pre = B 去 wrapper 目录（103 文件） | 0 | 替代口径 disjoint 成立 |
| T105（再生后，commit ② `d86fa332`） | B 全量（119 文件） | 0 | 替代口径 disjoint 成立；再生产物（16 wrapper）未落入 A |

二者一致，无差异来源需登记。

## 4. 裁定与诚实口径

- **字面口径**：「未执行（缺席）」——分支 ref 已不存在，本产物**不把字面项记 PASS**。
- **替代口径**：PASS（|A ∩ B| = 0，A 为超集）。另有旁证：commit ① 落地前已在 `26a3b15f` 之上 rebase 且全量验证全绿（`scratchpad/post-rebase-verify.log`：build 0 / test:plugins 1840·1838·0 / vitest 8179 passed / repo:check 93 ids warn-only）。
- **FR-051 意图**（不覆写并行方文件、冲突时 FR-051 优先）在替代口径下满足；字面 oracle 的缺席源于交付时序（F276 先落地），不是本卡跳过取证。
