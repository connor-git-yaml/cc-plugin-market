# Phase 5 spec-review 子代理（第 2 路）— 八项需求落点与约束条款合规

## 输入与命令

- 角色 prompt：`plugins/spec-driver/agents/spec-review.md`（179 行，已读，按其 CRITICAL/WARNING/INFO 分级框架输出）
- 实现区间：`26a3b15f..98d19a25`（`git diff --stat` 131 files changed, 29417(+)/319(-)）
- 检查范围：用户任务卡八项需求落点 + 三条回归护栏条款 + 交付诚实口径；不整读 `spec.md`/`plan.md`/SKILL.md，全程用 `command grep -n` / `sed -n` 定位取段
- 工具调用数（本节起）：约 16 次（Write 骨架 1 + Read agent prompt 1 + investigation Bash ~11 + Edit 若干），在 ≤30 预算内

## A. 八项需求落点抽检

**(1) plan 强制 FR→Phase 覆盖矩阵 + 裁剪登记 + verify 矩阵驱动自动判 — PASS**
落点：`agents/plan.md:270`(`### 一、FR → Phase 覆盖矩阵`)、`:292`(`### 二、裁剪登记`)；`templates/specify-base/plan-template.md:66,90` 同步有骨架章节。verify 侧：`agents/verify.md:105`「未认领且未登记裁剪⇒自动判「未实现」」、`:109-126`「冲突留痕格式…交付判定按矩阵取值走不通过」、`:129-164`「冻结值三值并列比对（矩阵锚点）」。措辞与落点均与任务卡描述一致。

**(2)「随 Phase N 落」承诺→显式任务 + 可达性检查（可达性半边移交声明）— PASS**
`agents/tasks.md:219-237`「延期承诺的候选池式任务化」——触发面翻转为「疑似即入池」、判不出按从严入池、未任务化阻断走 `GATE_TASKS`。`agents/verify.md:193`「生产可达性检查」小节 + `:213`「生产可达性检查半边不在本文件射程内，随其对应需求整体移交后续带编号卡；其在本文件内的缺席不计未完成」——与任务卡括注「可达性半边已移交后续卡，不得判缺失」逐字对应，未见 over-claim（`verify.md:213` 同处显式禁止「对账与可达性两半都已落地」措辞）。

**(3) GATE_DESIGN 内建「对抗-修订-再对抗至零新 CRITICAL」收敛循环 — WARNING（六载体逐字同源自检不通过其一）**
共享块 `templates/gate-design-convergence-loop.md`（98 行）机制完整：分类白名单（14 命中面=13 路径+1 语义）、`零新增，不是满N轮`、`R_max=3`、止损/守承重项三条件、轮次记录 4/7 字段、「全部轮次在同一次门内交互之前闭环」（不新增中断点）。注入范围核实：`agents/plan.md` + 7×`skills/*/SKILL.md` + 7×`skills-codex/*/SKILL.md` 均含 `<!-- BEGIN/END SHARED SECTION: gate-design-convergence-loop -->`。

但按任务卡指定命令做「六载体逐字同源」抽检时发现分歧：
```
command grep -o "路径条 \*\*13\*\*：.*单位：命中条。" <file> | shasum
plan.md                          → 6209d21c... (非空)
skills/{fix,doc,refactor,sync}/SKILL.md → 6209d21c...（4 份与 plan.md 一致）
templates/gate-design-convergence-loop.md → da39a3ee...（空串哈希，即该文件全文 98 行不含此片段）
```
共享块内对应处是**表格 14 行 + 独立换算式**「命中面 **14** 条 = 路径条 **13** + 语义条 1（单位：命中条）。」（`gate-design-convergence-loop.md:21`附近）；`plan.md:335` 与 4 份 SKILL 的衍生段落是**内联逗号枚举句**「路径条 13 + 语义条 1，单位：命中条。」（无加粗、括号改逗号），且该段**自称**「**与共享块 `templates/gate-design-convergence-loop.md` 的分类表逐字同源，两处不得各写一套**」——自我描述与实测不符：两处并非逐字同源，是两种不同文本形态（表格 vs 内联句）各写一套。
风险点：该 5 处重复文本**不在任何 `BEGIN/END SHARED SECTION` 标记内**（`plan.md` 全文仅有 `preference-rules`、`agent-output-discipline` 两处标记；`skills/spec-driver-fix/SKILL.md` 中该段落落在 `gate-design-convergence-loop` END(:562) 与下一标记 `gate-verify-matrix-recompute` BEGIN(:671) 之间的未标记区间），不受 `npm run docs:sync:agents` 保护——共享块表格未来若变动（如新增第 15 条命中面），5 处硬编码副本不会自动同步，形成静默漂移风险。当前数值本身一致（14=13+1），非功能性错误，故判 WARNING 而非 CRITICAL。

**(4) plan 阶段 reverse-census 标准产物 — PASS**
`agents/plan.md:299`（`### 三、关键量反向普查`）+ `templates/specify-base/plan-template.md:104`（`## 关键量反向普查`），落点与措辞一致。

**(5) agents/*.md「先落盘骨架再逐节 Edit」一等协议 + 委派按时长分流 — PASS**
共享块 `templates/agent-output-discipline.md`（146 行）。注入范围精确核实为**仅** `specify.md`/`plan.md`/`tasks.md`/`implement.md` 四份（`grep -rl "agent-output-discipline" plugins/spec-driver/agents/` 命中恰好这四份，不含 `verify.md`）——与任务卡「分段协议只落在 specify/plan/tasks/implement 四份」一致。`verify.md` 的排除理由与独立性声明**内嵌在共享块自身的「不适用场景」节**（`agent-output-discipline.md:13-26`：「verify 持有 `Bash`……其独立性一律登记为未取得」），随四份宿主文件可见，不在 `verify.md` 正文重复；`verify.md` 本身未见「骨架」字样及该模板名引用，与四份宿主形成干净分离，未见误注入或遗漏。委派分流：`agent-output-discipline.md:55-70`「委派形态分流……按任务时长分流，不按任务类型分流」，且明文「不存在『由编排器 inline 完成』这一支」，与 `delegation-contract.md:22/:26` 交叉引用一致。

**(6) verified-facts 历史引用必附 git show 原文 — PASS**
`agent-output-discipline.md:76-98`「纪律一：引用原文化」——两种合规形式（内联原文 / 指针+具名证据条目 `evidence/*.md`）、「验收必须全量、不得抽样」、`N_a`/`N_b` 现取不写死。

**(7) 可观测数量必写换算式+单位 — PASS**
`agent-output-discipline.md:104-114`「纪律二：数量换算式与计数单位」——换算式/计数单位/**计数集合口径**三项缺一不合格（含「在场且算对但集合错」失效形态的显式防御）；跨单位禁止运算条款俱全。

**(8) 推断前提显式登记 + verify 至少一条运行时命令 — PASS**
`agent-output-discipline.md:122-136`「纪律三：推断前提的标记契约」（`[推断]`标记复用宪法既定标记、「已核实」非自助豁免桶）+ `agents/verify.md:215-236`「推断前提的逐条运行时实证」——「每条登记的推断前提，本子代理必须至少给出一条『运行时口径』的验证命令，并输出其实跑结论（PASS/FAIL）」，与任务卡描述完全对应，且显式排除「按设计应当如此」类静态论证。

## B. 回归护栏条款

**B1. skills-codex 连带提交计数 — PASS**
```
git diff --name-only 26a3b15f..98d19a25 | command grep -c "skills-codex\|\.codex/skills"
→ 16
```
明细：8×`.codex/skills/*/SKILL.md` + 8×`plugins/spec-driver/skills-codex/*/SKILL.md`，与预期值 16 相符，`repo:sync` 再生已连带提交，未见遗漏。

**B2. 不得加重 GATE 交互负担（FR-049 代理判据）— PASS**
```
git diff 26a3b15f..98d19a25 -- plugins/spec-driver/skills plugins/spec-driver/templates plugins/spec-driver/agents | command grep -c '^+.*暂停'  → 0
同范围 | command grep -c 'AskUserQuestion'                                                                        → 0
```
两计数均为 0，未新增暂停点或用户拍板中断点；与 §A(3) 中 `gate-design-convergence-loop.md`「全部轮次在同一次门内交互之前闭环……本块不新增门、不新增中断点」的自述一致，autonomous/balanced 语义未见改动。

**B3. 与 F276 判定器文件 disjoint — PASS（含诚实的字面口径缺席登记）**
`specs/277-spec-driver-engine-hardening/verification/e-fr051-disjoint.md` 存在。T103 字面 oracle（F276 分支 ref）本地/远端均不可解析（分支已按交付后删除约定删除）→ 诚实登记该字面项「未执行（缺席）」，未默认放行；改用替代 oracle（master 区间 `e01611b2..26a3b15f`，为 F276 认领集超集）：T103（再生前，B_pre=103 文件）与 T105（再生后，B=119 文件）两个时点 `|A ∩ B| = 0` 均成立，disjoint 结论稳定。处置方式与本卡「判不出⇒从严，替代口径须留痕理由」的一贯纪律相符。

## C. 交付诚实口径

**implementation-notes.md Phase E（E-4 节，约 line 1183-1186）严格口径**：
「八项演示终态（严格口径）：D-1 ✅ / D-2 ✅ / D-3 ✅ / D-4 ✅ / D-5 部分（(a) ✅、(b)(c) 缺席）/ D-6 ❌ / D-7 ❌ / D-8 ❌（4÷5）……但按 spec 严格口径不得改判为通过」——与用户任务卡预告的「已知诚实口径」逐字一致。

**tasks.md T113~T120 逐条核对（line 322-329）— PASS，与各 `verification/e-d*.md` 最终判定完全一致**：
| 任务 | 演示 | checkbox | 结论栏文字 | 与 e-d*.md 一致？ |
|---|---|---|---|---|
| T113 | D-1 | [x] | PASS（(a)4÷4/(b)0÷5/(c)冲突成立）| 一致 |
| T114 | D-2 | [x] | PASS（强度上限声明逐字在场）| 一致 |
| T115 | D-3 | [x] | PASS（两语料逐轮一致）| 一致 |
| T116 | D-4 | [x] | 通过（缺口注入 M1/M2 均报出）| 一致 |
| T117 | D-5 | [x] | **部分**——(a) pass，(b)(c) 0 次→缺席，整体未达成 | 一致 |
| T118 | D-6 | [x] | **❌ 未通过（严格口径）**——6÷13=46.2% 未入索引 | 一致 |
| T119 | D-7 | [x] | **❌ 未通过（严格口径，唯一失败点）**——字节预算 +704 | 一致 |
| T120 | D-8 | [x] | **❌ 未通过（4÷5=80%）**——A-2 缺席 | 一致 |

未见「T118/T119/T120 打勾却在结论栏写『已达成』」这类 checkbox 与文字矛盾的 over-claim；checkbox `[x]` 在此处的语义经上下文确认为「验证任务已执行完毕」而非「验证结果为通过」，两者在 T117-T120 的行文中被清楚区分（如实登记不通过结论），未见混淆或掩盖。

**T121（时序悖论回跑违规追加处置，触发面 5 条：D-4/D-5/D-6/D-7/D-8）checkbox 为 `[ ]`（未勾选）**——核对 `verification/e-timing-paradox-appendix.md`（12 行记录表 + 处置动作 #13）确认其核心处置内容已完整落盘（各条附「发现时点/发现者/原取值/新取值/处置/执行方式」）；`[ ]` 未勾选原因是 D-5 (b)(c) 独立观察窗口仍未回补（「观察窗口保持开启，后续卡以正规委派路径回补 ≥3 次」）——**判 PASS，方向为保守/诚实（宁可少标已完成，不多标）**，未见把仍留有开放尾项的任务标记为已完成的 over-claim。

## D. 三档结论

- **CRITICAL：0 个**
- **WARNING：1 个**
  1. `plugins/spec-driver/agents/plan.md:335` 及 `plugins/spec-driver/skills/{spec-driver-fix,spec-driver-doc,spec-driver-refactor,spec-driver-sync}/SKILL.md`（对应行约 :570 起）的「(ii) 门禁/判定器/安全类改动一律升格为强制」段落，自称「与共享块 `templates/gate-design-convergence-loop.md` 的分类表逐字同源」，但实测该共享块全文 98 行不含此段对应文本（共享块用表格+独立换算式，5 处衍生文本用内联逗号枚举句，加粗/标点均不同）；且该 5 处重复文本不受任何 `BEGIN/END SHARED SECTION` 标记保护，`npm run docs:sync:agents` 无法感知其漂移。当前数值内容一致（14=13路径+1语义），不影响现有门禁行为，但违反了该段自身宣称的「两处不得各写一套」，且属门禁类改动、依本仓惯例应从严对待。**建议修复**：要么把该 5 处替换为对共享块的引用指针（不复述具体数字/枚举），要么为其新增独立的 `templates/*.md` 源文件并纳入 `sync-agent-docs.mjs` 的 `sectionConfigs`，使其获得与其余共享块同等的同步保护。
- **INFO：0 个**

## E. 总判定

**PASS（1 条 WARNING 待跟进，非阻断）**

八项需求落点全部找到且措辞与 spec/任务卡描述一致（(1)(2)(4)(5)(6)(7)(8) 共 7 项无保留通过；(3) 收敛循环机制本身完整且正确注入，仅其「六载体逐字同源」自检暴露 1 处文档级漂移风险，不影响当前功能正确性）。三条回归护栏条款（skills-codex 连带提交=16、GATE 交互负担新增=0、与 F276 判定器文件 disjoint）全部通过，且 disjoint 检查在字面 oracle 缺席时正确走了「诚实登记+替代 oracle+留痕理由」而非默认放行。交付诚实口径核验显示 `implementation-notes.md` Phase E 节与 `tasks.md` T113~T120 对八项验收演示的最终判定（D-1~D-4 ✅ / D-5 部分 / D-6/D-7/D-8 ❌）完全一致，未发现「产物写 ❌ 而结论栏/checkbox 声称已达成」的 over-claim；T121 保持未勾选亦是保守方向的诚实登记。

**建议**：WARNING 项建议在本卡收尾前或移交后续卡时处理，优先级低于任何 CRITICAL，但因涉及门禁类文档的自我一致性声明失实，不宜无限期搁置。
