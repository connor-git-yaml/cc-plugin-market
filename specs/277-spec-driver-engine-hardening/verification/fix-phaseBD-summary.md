# B + D 对抗修订 · 摘要（实现子代理停摆后由编排器补录，2026-09-07）

## 一、处置表（ε）
| ID | 处置 | 落点（编排器核实） |
|---|---|---|
| ε-C1 步骤 8 未经合并律路由 | 本轮已修 | `agents/verify.md` 步骤 8 改「合并律判不通过 ⇒ GATE_VERIFY 停下；合并律通过 ∧ 工具链全绿 ⇒ READY」（`grep -c '合并律判不通过\|合并律通过'` = 2）；三份 verification-report-template `Overall = 合并律 ∧ 工具链`（各 1 处，三份 diff 一致）；返回摘要加合并律结论行 |
| ε-C2 7 态与既有四套词表零交集 | 本轮已修 | verify.md 增「既有取值 → 态」映射表（`EVIDENCE_MISSING` 等 6 处）；兜底句改「未被本表映射的任何状态（既有或新增）一律归不通过侧」 |
| ε-W1 FR-057 例外条款自指 | 本轮已修 | 自指行单列并从兜底型计数扣除（命中 M = a + b + c） |
| ε-W2 plan.md 序号互斥 | 本轮已修 | 序号统一，保留「mode 分层矩阵」限定语 |
| ε-W3 required_sections 判据集 ≠ 漂移风险集 | 登记不修 | FR-067 已裁定 required_sections 无消费方；写为残余 |
| ε-W4 候选池无落点 | 本轮已修 | 两份 `tasks-template.md` 增 `## 延期承诺候选池`（各 1 处）；`tasks.artifact.yaml` optional 加节名 |
| ε-I1 返回摘要缺合并律结论 | 本轮已修 | 同 C-1 |
| ε-I2 / I3 / I4 | 登记 / 无需动作 | I2：`full_required_kinds=[]` 默认跳过校验属 goal_loop 既有 opt-in 设计（F204），不在 FR-057 射程，登记 |

## 二、处置表（γ · W/I 因审查子代理停摆缺席，仅 C1–C3）
| ID | 处置 | 落点 |
|---|---|---|
| γ-C1 冻结值锚在编排器侧两端未接线 | 本轮已修 | 新建块 5 `templates/gate-verify-matrix-recompute.md`；`sync-agent-docs.mjs` 第 5 个 entry（共 15）；8 份 SKILL GATE_VERIFY 段各一对 marker（`grep -l` = 8）；日志行模板含 `recomputed=/held=/match=/merge=`；块 3 补「计算 → 写冻结字段 → 持有 → 注入」编排器动作（`grep -c '持有\|注入'` = 6） |
| γ-C2 白名单漏散文引擎三目录 | 本轮已修 | 块 4 白名单 +3 路径（`agents/** skills/** templates/**`，4 → 7 条），第 5 条改「逻辑不论载体」；`agents/plan.md` (ii) 同步（1 处） |
| γ-C3 约束型四重免检、verify 禁改判 | 本轮已修 | plan.md 与两份 plan-template 改「不得静默改判」并开放「类别存疑」异议（verify.md 8 处、plan.md 1 处）；合并律 7 → 8 态；`agents/spec-review.md` 增「类别列取值抽检 / 类别误标」（6 处） |

## 三、改动清单
新建 1：`templates/gate-verify-matrix-recompute.md`。修改：`agents/{verify,plan,spec-review,tasks}.md`、`tasks.artifact.yaml`、`spec-review.artifact.yaml`、`templates/{gate-tasks-scope-cut-acceptance,gate-design-convergence-loop}.md`、三份 `verification-report-template.md`、两份 `plan-template.md`、两份 `tasks-template.md`、`scripts/sync-agent-docs.mjs`、8 份 `skills/*/SKILL.md`、`tests/integration/spec-drift-repo-check-regression.test.ts`（K14 14 → 15）。再生 16 份 wrapper（8 × 2）；`specs/products` 与 `project-context.suggestions.*` 零 diff；`README.md` / `postinstall.sh` / `plugin.json` 相对 HEAD 零 diff（仅 mtime）。

## 四、变异体 / 反向核对
实现子代理在此步前停摆，**本轮变异体核对缺席**；由编排器安排的 delta 复验（`adversarial-phaseBD-delta-{a,b}.md`）承担反向核对。

## 五、收口验证（编排器亲自跑，`scratchpad/fixBD-closeout.log`，起跑 load 0.99）
`npm run build` 0 / `npm run test:plugins` 1840·1838 pass·0 fail / `npx vitest run` 8179 passed·0 failed·64.8 s / `npm run repo:check` status=warn 仅 `graph-quality:freshness`，check id **95** / `docs:sync:agents` 二跑 0 updated / FR-049 代理判据：`AskUserQuestion` 0、`mcp__` 0、`暂停` 命中 1 文件 = `agents/verify.md` **被删除的旧行**（`- … GATE_VERIFY 触发暂停`），新文本用「停下」，SKILL 射程 0 文件 ⇒ PASS。

## 六、偏差与残余风险
- 实现子代理在填 summary 与收口前停摆（与 Phase B/D 同型），本文件由编排器按盘上事实补录；变异体核对缺席，交 delta 复验。
- γ 的 W/I/结论缺席（审查子代理停摆），本轮只覆盖其 C1–C3。
- FR-065 手写副本 × 4、白名单手写副本对 × 1（块 4 ↔ plan.md (ii)）均无机器守护（登记）。
- 块 5 落到 prompt 层，编排器是否真的重算只能由日志行字段位 + verify 三值参考交叉核对，无机械执行点。
