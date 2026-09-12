# Phase 5 Verify 矩阵对账 — 分段 1（FR-001 ~ FR-023，共 23 行）

状态：已完成（逐行核验完毕）

## 输入与命令

- 矩阵行：`sed -n '165,187p' specs/277-spec-driver-engine-hardening/plan.md`（FR-001~FR-023，23 行；矩阵冻结未改；边界由 `command grep -n "^| FR-0" plan.md` 核对，FR-001 起 165 行、FR-023 止 187 行）
- tasks.md 认领态：`command grep -nE "→ FR-0(0[1-9]|1[0-9]|2[0-3])( |/|$)" specs/277-spec-driver-engine-hardening/tasks.md`（任务→FR 认领标记行）+ `command grep -nE "认领 FR" specs/277-spec-driver-engine-hardening/tasks.md`（五个 Phase 的「认领 FR」声明清单，用于 Phase 集合交叉校验）
- 落点核验：按矩阵「实现落点」列逐一定向核对（`plan-template.md` 双份、`agent-output-discipline.md`、`agent-tools-core.mjs`、`gate-design-convergence-loop.md`、`specify/plan/tasks/verify.md` 的 `tools` 行），命令原文见各行「证据」列
- verification/ 归档交叉引用：`phase5-spec-review-a.md`（FR-016 类别争议来源 B-1）、`phase5-verify-toolchain.md`（`repo:check`/`agent-tools` 输出）、`e-d2-archive.md` / `e-d3-archive.md` / `e-d5-interruption-drill.md`（D-2/D-3/D-5 演示归档结论）
- 判定态定义与合并律取自简报（verify.md 摘录 A/B），未重读 verify.md 全文
- 姊妹分段 `phase5-verify-matrix-part3.md` 已用简报原生五态符号（`✅`/`❌`/`⛔`/`✂️`/`⚪`）定稿在案，本段沿用同一符号系统

## 逐行对账表

| FR | 类别 | 认领 Phase | 判定态 | 证据 |
|----|------|-----------|--------|------|
| FR-001 | 实现型 | B | ✅ 已实现（附证据） | `.specify/templates/plan-template.md` + `plugins/spec-driver/templates/specify-base/plan-template.md`（各 235 行）均含「## FR → Phase 覆盖矩阵」具名章节（`grep -n "^## FR → Phase 覆盖矩阵"` 两份均命中，章节含"必选区块"框注 + 7 条行格式定义）；`agents/plan.md`（T040，FR-003 交叉校验产出侧判据）；D-1 回放验收（`tasks.md` T062 `[x]`）：捕获率 4÷4=100%，误报 0÷3=0%，命令 `git show 8617ae3e:specs/270-.../{spec,plan}.md` 重建矩阵对比。T037/T039/T062 全 `[x]` |
| FR-002 | 实现型 | B | ✅ 已实现（附证据） | `plan-template.md` 矩阵节行格式定义第 3 条原文（已 grep 确认存在）：「『认领 Phase』列可多值（一条 FR 可被多个 Phase 同时认领，写作 `A,C`）。统计覆盖数时按 FR 去重」；`specify-base/` 与 `.specify/` 两份副本 `diff <(grep '^## ')` 零输出（T037 验收口径）。T037 `[x]` |
| FR-003 | 实现型 | B | ✅ 已实现（附证据） | `agents/verify.md`「Phase 集合交叉校验」节（简报摘录 A:70-77 行，与产出侧同一条判据「矩阵『认领 Phase』列的每一个取值必须 ∈ 该 `plan.md` 实际定义的 Phase 集合」）；`agents/plan.md` T040 写入产出侧判据；D-1 阴性对照（T062:「抽 ≥3 条确有 Phase 认领的 FR，误报 0÷3=0%」）。T040/T062 `[x]` |
| FR-004 | 实现型 | B | ✅ 已实现（附证据） | `plan-template.md`「## 裁剪登记」具名章节（已 grep 确认，含表格式定义 + 5 条准入规则）；本卡 `plan.md:385-400` 自身裁剪登记非空（MUST 裁剪 0÷3=0% + 2 项 SHOULD `[可选]` 处置表，原文已核实）。T037 `[x]` |
| FR-005 | 实现型 | B | ✅ 已实现（附证据） | `agents/verify.md` 五态 + 约束型三取值 + 冲突留痕格式全部写入（简报摘录 A 全文即该节原文，逐字比对一致）；`tasks-template.md` 双份新增冻结字段位（T058，"diff 逐字相同"验收）。**附带说明（非违反）**：矩阵本行（冻结）仍写 5 份 SKILL 集 `{feature,story,implement,fix,resume}`，但 T053 裁定按实测更正为 7 份 `{feature,story,implement,resume,sync,doc,refactor}`（`fix` 移出），该更正以「正文不改、追加留痕」方式记入 `plan.md:345` 修订记录表与 `:1840` 裁定全文——按项目「矩阵冻结禁止无痕改写，修订走追加记录」的既定纪律，此为预期形态非缺陷。T042/T043/T053/T058/T062 全 `[x]` |
| FR-006 | 实现型 | B | ✅ 已实现（附证据） | `agents/verify.md`「未认领且未登记裁剪 ⇒ 自动判『未实现』」规则 + 冲突留痕格式表（简报摘录 A:55-68 行，逐字确认在场）；D-1 演示（T062）按 SC-004=4÷4 验证。T042/T062 `[x]` |
| FR-007 | 实现型 | B | ✅ 已实现（附证据） | `plan-template.md` 矩阵节「没有正式 FR 列表时的占位口径」原文（已 grep 确认）：「本区块必须输出显式的一行『不适用（本次无 FR 列表）』……产出仅有表头、无内容却被标记为已完成的形式主义空表，与漏做同等判为不合格」；T038 同时写入普查节对应占位口径（FR-029）。T038 `[x]` |
| FR-008 | 实现型 | D | ✅ 已实现（附证据） | `agents/tasks.md` 候选池式触发面（T093:「疑似即入池」，禁止措辞白名单实现）+ 入池证据三项（T094：命令原文/原始输出/池内条数三者核对）；D-2 演示（T099 执行，T114 归档）结果：`verification/e-d2-archive.md` 判 **PASS**（强度上限声明逐字在场 3÷3 处；FR-008 禁用口径断言用法 0 处）。T093/T094/T099/T114 全 `[x]` |
| FR-009 | 实现型 | D | ✅ 已实现（附证据） | `agents/tasks.md` 未任务化承诺阻断口径（T095:「存在未被任务化的延期承诺时，tasks 阶段不得被判定为完成」，与 Phase B 的 T051 不变量并列、不互相顶替）；随 FR-008 同一 D-2 演示验证（T099/T114，PASS）。T095 `[x]` |
| FR-010 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交后续卡 F27x） | matrix 行 411 明写「移交 F27x」；`tasks.md:375`「FR-010/011/012/013 共 4 条（plan 矩阵『认领 Phase』列取值移交 F27x）」；`plan.md:395` 裁剪登记准入口径 2：「FR-010~FR-013 不在本登记内……终态是未完成而非已裁剪」；核对 A/B/C/D/E 五份「认领 FR」声明清单，均不含 FR-010~013（未认领确认非静默遗漏，是显式移交登记）。按简报口径「移交后续卡的 FR：留在分母内且计入 `uncovered_fr_ids`」处理 |
| FR-011 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交后续卡 F27x） | 同 FR-010，matrix 行 412 |
| FR-012 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交后续卡 F27x） | 同 FR-010，matrix 行 413；`tasks.md:376`「其残余（一行死 import 洗白）随卡移交，本卡内保持诚实登记不变」 |
| FR-013 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交后续卡 F27x） | matrix 行 414；`tasks.md:385`「一条依赖已就位：FR-013 的『有意的预留 ⇒ 强制派生延期承诺任务』依赖 FR-008，而 FR-008 留本卡（Phase D 的 T093~T095），故 F27x 落地时该实体已存在，后续卡不需要重建它」——依赖前置已满足，但 FR-013 本体仍属未实现（移交） |
| FR-014 | 实现型 | C | ✅ 已实现（附证据） | `templates/agent-output-discipline.md` 新建（146 行，已确认存在，含 9 个具名章节）；经 `sync-agent-docs.mjs` 注入 `agents/{implement,specify,plan,tasks}.md` 各一对 marker（T070，`agents/verify.md` 不加 marker，按 FR-016 处理）；`npm run repo:check` 的 `agent-tools:required`=8÷8 PASS（T076，红转绿；`verification/phase5-verify-toolchain.md` 确认 `repo:check` 整体 `status=warn`，非 pass 仅 1 条 `graph-quality:freshness`，隐含 `agent-tools:required` 全绿）。T064/T070/T076 全 `[x]` |
| FR-015 | 实现型 | A | ✅ 已实现（附证据） | 直接核验当前 frontmatter：`plugins/spec-driver/agents/specify.md:3: tools: [Read, Write, Edit, Bash, Grep, Glob]`；`agents/plan.md:3` 同含 `Edit,Bash`；`agents/tasks.md:3` 同含 `Edit,Bash`（命令 `grep -n "^tools:" plugins/spec-driver/agents/{specify,plan,tasks,verify}.md` 原始输出已核实三份均命中）；`agent-tools:required` 正向 6 条断言 PASS（T076 消账）。T017/T018/T019/T076 全 `[x]` |
| FR-016 | **约束型** | — | ⚠️ 类别存疑（归不通过侧）+ 三取值：✅ 已核验未违反 | 见下「本段约束型三取值」与「类别存疑登记」两节（本行两套结论并列，互不替代：类别存疑是对矩阵「类别」列本身的异议，三取值是在不改判前提下仍按矩阵现有类别给出的核验结论） |
| FR-017 | 实现型 | A | ✅ 已实现（附证据） | `scripts/lib/agent-tools-core.mjs` 新建（286 行，已确认存在，导出 `validateAgentTools`，8 条断言：6 正向 + 1 护栏 + 1 文本）；`scripts/lib/repo-maintenance-core.mjs` 接线 `aggregateValidation('agent-tools', …)`；`tests/unit/agent-tools-core.test.ts` 新建（464 行）。T014/T015/T076 全 `[x]`，repo:check `agent-tools:required` pass 确认（同 FR-014 证据源） |
| FR-018 | 实现型 | C | ⛔ 未执行（缺席） | 机制文本已写入 `agent-output-discipline.md`（T066:「判定『发生了整篇重写』的标志 = 已完成节的字节发生变化」），**但 matrix 自身指定的验证点 D-5(b)(c)「≥3 次独立观察，3÷3=100%」未达成**：`verification/e-d5-interruption-drill.md` 归档结论（引自 `tasks.md:326` T117 留痕原文）——「(b)(c) 合格观察 0 次（本卡所有长文档委派 prompt 均带分段指令，按独立性规则不合格）→『未执行（缺席）』，0÷0 不可算，D-5 整体未达成，观察窗口仍开、后续卡回补」。按 matrix 自身验证点判定，本行归不通过侧 |
| FR-019 | 实现型 · SHOULD `[可选]` | C | ✅ 已实现（附证据） | `agent-output-discipline.md`「## 委派形态分流」具名章节（已 grep 确认存在，:55 起）：按任务时长分流，两侧都是委派，无 inline 替代支路（T067）；plan 裁剪登记表「一、`[可选]` 项逐条处置」判**实现不裁剪**（C-7 去留论证：两条理由指针——dogfooding 账本 `:81`/`:124` 两条 + 边际成本 ≈0 且不增实体）。T067 `[x]` |
| FR-020 | 实现型 | D | ✅ 已实现（附证据） | `plugins/spec-driver/templates/gate-design-convergence-loop.md` 新建（98 行，已确认存在，含「分类：白名单式判据」等 5 个具名章节）；`sync-agent-docs.mjs` 第 4 个 entry + 4 份 SKILL 各一对 marker（T081）；`spec-driver-fix/SKILL.md` 豁免例外条款（T085）；D-3 回放演示（T098）执行，`verification/e-d3-archive.md` 存在「## 最终判定」标题（:318，已由 toolchain 分段确认 11/11 产物文件存在）。T080/T081/T085/T086/T098 全 `[x]` |
| FR-021 | 实现型 | D | ✅ 已实现（附证据） | 同上文件「## 收敛判据：零新增，不是满 N 轮」节（已 grep 确认存在，:43 起，含「上一轮修订产物上没有发现新增 CRITICAL」判据 +「首轮零 CRITICAL 时不得强制追加轮次」反例条款）+「## 止损：`R_max=3`（MUST）」节（:59 起）。D-3 验证（T098）。T082/T083/T098 全 `[x]` |
| FR-022 | 实现型 | D | ✅ 已实现（附证据） | 同上文件「## 每轮的输入：版本指针」节（已 grep 确认存在，:53 起）。D-3 验证（T098）。T084/T098 全 `[x]` |
| FR-023 | 实现型 | D | ✅ 已实现（附证据） | 同上文件「## 轮次记录字段」节（已 grep 确认存在，:75 起，含「必备字段 4 项」换算式与表格）。D-3 验证（T098，**性质诚实登记**：「本演示是人工按新判据逐条推演、不是机械执行，推演者已知期望结论，无法排除向结论倒推」）。T084/T098 全 `[x]` |

## 本段约束型三取值（FR-016）

| FR | 核验方式 | 命令与输出摘要 | 取值 |
|----|---------|----------------|------|
| FR-016 | `agent-tools:required` 守护项的护栏断言 (ii)——`agents/verify.md` 的 `tools` 与钉入 `agent-tools-core.mjs` 的落地时快照逐字相等（含顺序）；文本断言 (iii)——协议文本对 verify 标注「不适用」且附 FR-016 (ii) 独立性口径声明 | 命令 `npm run repo:check 2>&1 \| command grep -n "agent-tools"` 已由分段 B（`phase5-verify-toolchain.md`）跑过；引用其结论：「`npm run repo:check` 退出码 0，非 pass 仅 1 条 `graph-quality:freshness: warn`」——即 `agent-tools:required` 全部 8 条断言（含护栏 1 + 文本 1）均 pass；本段另核 `agents/verify.md:3` 当前 `tools: [Read, Bash, Grep, Glob, mcp__plugin_spectra_spectra__detect_changes, mcp__plugin_spectra_spectra__impact]`（`grep -n "^tools:" plugins/spec-driver/agents/verify.md` 现取）未被本卡改动（无 Write/Edit）；`agent-output-discipline.md:13-27`「不适用场景」节含 FR-016 (ii) 独立性口径声明原文（T064） | ✅ 已核验未违反 |

## 类别存疑登记

| FR | 矩阵标注 | 异议形态 | 落侧 | 所需证据 | 产生判定的命令与输出 |
|----|---------|---------|------|---------|---------------------|
| FR-016 | 约束型，认领 Phase=`—` | 矩阵判定依据（`plan.md:242`）称「FR-016 本条自身不新造制品」（承载制品是 FR-014 的协议块），但本卡新建的可交付文件 `scripts/lib/agent-tools-core.mjs`（`git status` 未跟踪 `??`，286 行）在三处代码位置以「FR-016」「FR-016 (ii)」显式点名自称在实现该判定逻辑——L14 注释「文本 1：协议文本对 verify 标注『不适用』且附 FR-016 (ii) 的独立性口径声明」、L73-74 导出常量 `PROTOCOL_VERIFY_DISCLOSURE_PHRASES` 紧邻注释「FR-016 (ii) 要求的独立性口径声明的短语契约」、L203 断言 title 字符串「协议文本对 verify 标注『不适用』且附 FR-016 (ii) 独立性口径声明」。按 `agents/spec-review.md:158` 判据字面（「是否存在一份本次要新造或改写的制品来承载它？存在即该 FR 应判实现型，凡『存在承载制品』的条款一律判实现型，哪怕其措辞是禁止式」）——本条测的是「制品是否存在」，不是「该制品是否由这条 FR 独占新建」；`agent-tools-core.mjs` 确实存在、确实新建、确实承载 FR-016 的判定逻辑，三项皆成立，与 matrix「不新造制品」论证矛盾。该争议已由 `verification/phase5-spec-review-a.md:30-41`（B-1）独立发现并判 CRITICAL，本行核验独立复核（自跑命令见右列，未采信转录）后予以确认，归入本段类别存疑 | 不通过侧（按合并律映射表 #10：类别存疑 → 不通过侧） | 若坚持约束型：需正面回应「`agent-tools-core.mjs` 的护栏 1 为何不算承载制品」；若改判实现型：需同步重算矩阵计数（约束型 13→12 条，实现型 55→56 条）与 SC-013 口径 (a)(b) 相关换算式并留痕（`phase5-spec-review-a.md` 评估「预期不影响最终 F=61 数值」，但该评估是推算非亲自重算，不能视为已核验） | 判定：「该 FR 是否存在一份本次要新造或改写的制品承载它」结论 = **存在**；产生该结论的命令 `sed -n '10,16p;70,78p;198,208p' scripts/lib/agent-tools-core.mjs`，原始输出（节选）：`14: *   (iii) 文本 1：协议文本对 verify 标注「不适用」且附 FR-016 (ii) 的独立性口径声明` / `73-74 行：/** FR-016 (ii) 要求的独立性口径声明的**短语契约**……*/ export const PROTOCOL_VERIFY_DISCLOSURE_PHRASES = …` / `203: const title = '协议文本对 verify 标注「不适用」且附 FR-016 (ii) 独立性口径声明';` |

## 本段计数

**实现型分母（本段）= 23 − 1（FR-016，约束型，按简报口径移出实现型分母）= 22**（单位：FR 条）

| 判定态 | 条数 | FR 列表 |
|--------|------|---------|
| ✅ 已实现（附证据） | 17 | FR-001,002,003,004,005,006,007,008,009,014,015,017,019,020,021,022,023 |
| ❌ 未实现（已登记移交 F27x） | 4 | FR-010,011,012,013 |
| ⛔ 未执行（缺席） | 1 | FR-018 |
| ✂️ 已裁剪（附理由） | 0 | — |
| ⚪ 未对账 | 0 | — |

换算式：17 + 4 + 1 + 0 + 0 = **22**（与分母一致）

**约束型（本段）= 1 条**（FR-016）

| 取值 | 条数 |
|------|------|
| ✅ 已核验未违反 | 1（FR-016） |
| ❌ 已违反 | 0 |
| ⛔ 未核验 | 0 |

**⚠️ 类别存疑 = 1 条**（FR-016；与约束型三取值并列标注、不重复计入实现型分母，二者是「同一行两套结论」不是两条 FR）

**本段不通过侧汇总**（供 Phase C 合并律参考）：未实现（移交）4 + 未执行（缺席）1 + 类别存疑 1 = **6 条**归不通过侧；已实现 17 + 已核验未违反 1 = **18 条**归通过侧（FR-016 因类别存疑同时贡献 1 条不通过侧计数，其约束型三取值的「已核验未违反」不因此被撤销，二者不互相抵消，均如实列出）。
