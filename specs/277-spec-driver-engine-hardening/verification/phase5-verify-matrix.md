# Phase 5 Verify 矩阵对账 — 三段合并（FR-001 ~ FR-068，共 68 行）

状态：已完成（合并分段 C 产出）。本文件**不重新判定**，逐行照抄 `phase5-verify-matrix-part1/2/3.md` 的判定态；证据列做适度精简摘录（保留文件/行号/命令锚点），完整原始证据与命令输出见对应分段文件，不在此二次全文复制。

来源：`phase5-verify-matrix-part1.md`（FR-001~023，17已实现/4未实现·移交/1未执行缺席/1约束型已核验未违反+1类别存疑）、`phase5-verify-matrix-part2.md`（FR-024~046，14已实现/1已裁剪/6约束型已核验未违反/2已违反）、`phase5-verify-matrix-part3.md`（FR-047~068，18已实现/4约束型已核验未违反）。

## 逐行对账表（68 行）

| FR | 类别 | 认领 Phase | 判定态 | 证据摘要（详见对应分段文件） |
|----|------|-----------|--------|---------|
| FR-001 | 实现型 | B | ✅ 已实现 | 两份 `plan-template.md`「FR→Phase 覆盖矩阵」章节 + `plan.md`(T040) + D-1 回放捕获率 4/4(T062) |
| FR-002 | 实现型 | B | ✅ 已实现 | 矩阵节行格式定义第3条(多值/去重) + 两份副本 diff 零输出(T037) |
| FR-003 | 实现型 | B | ✅ 已实现 | `verify.md`「Phase 集合交叉校验」+ `plan.md` T040 产出侧判据 + D-1 误报 0/3(T062) |
| FR-004 | 实现型 | B | ✅ 已实现 | `plan-template.md`「裁剪登记」章节 + 本卡裁剪登记非空(plan.md:385-400)(T037) |
| FR-005 | 实现型 | B | ✅ 已实现 | `verify.md` 五态+约束型三取值+冲突留痕格式全文写入 + `tasks-template.md` 冻结字段(T042/043/053/058/062) |
| FR-006 | 实现型 | B | ✅ 已实现 | `verify.md`「未认领且未登记裁剪⇒未实现」+冲突留痕表 + D-1 SC-004=4/4(T062) |
| FR-007 | 实现型 | B | ✅ 已实现 | `plan-template.md` 矩阵节占位口径原文(T038) |
| FR-008 | 实现型 | D | ✅ 已实现 | `tasks.md` 候选池式触发面(T093)+入池证据三项(T094)+D-2 演示 PASS(T099/114) |
| FR-009 | 实现型 | D | ✅ 已实现 | `tasks.md` 未任务化承诺阻断口径(T095)+同 D-2 验证 PASS |
| FR-010 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交） | plan 矩阵行 411 + `tasks.md:375` + `plan.md:395` 裁剪登记准入口径2明确排除 |
| FR-011 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交） | 同 FR-010，matrix 行 412 |
| FR-012 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交） | 同 FR-010，matrix 行 413 |
| FR-013 | 实现型 | 移交 F27x | ❌ 未实现（已登记移交） | matrix 行 414；依赖 FR-008 已满足但本体仍未实现 |
| FR-014 | 实现型 | C | ✅ 已实现 | `agent-output-discipline.md` 新建(146行)+4份 agents 注入 marker(T070)+`agent-tools:required` 8/8 PASS(T076) |
| FR-015 | 实现型 | A | ✅ 已实现 | specify/plan/tasks.md frontmatter 含 Edit,Bash(grep核实)+`agent-tools:required` PASS(T017/018/019/076) |
| FR-016 | 约束型 | — | ⚠️ 类别存疑（归不通过侧）+ ✅ 已核验未违反（三取值并列，两者不互抵，见下节） | `agent-tools-core.mjs:13-14,73-74,202-203` 三处以「FR-016」「FR-016(ii)」自称承载判定逻辑，与矩阵「本条自身不新造制品」论证矛盾（`phase5-spec-review-a.md` B-1 独立发现并复核确认） |
| FR-017 | 实现型 | A | ✅ 已实现 | `agent-tools-core.mjs` 新建(286行,8条断言)+`repo-maintenance-core.mjs`接线+测试464行(T014/015/076) |
| FR-018 | 实现型 | C | ⛔ 未执行（缺席） | 机制文本已写(T066)，但 matrix 自身指定验证点 D-5(b)(c)「≥3次独立观察」0/3 未达成（`e-d5-interruption-drill.md`） |
| FR-019 | 实现型·SHOULD[可选] | C | ✅ 已实现 | `agent-output-discipline.md`「委派形态分流」节+plan 裁剪登记判实现不裁剪(C-7)(T067) |
| FR-020 | 实现型 | D | ✅ 已实现 | `gate-design-convergence-loop.md` 新建(98行)+4处marker注入+D-3回放(T098,`e-d3-archive.md`) |
| FR-021 | 实现型 | D | ✅ 已实现 | 同上文件「收敛判据:零新增非满N轮」+「止损R_max=3」节(T082/083/098) |
| FR-022 | 实现型 | D | ✅ 已实现 | 同上文件「每轮输入:版本指针」节(T084/098) |
| FR-023 | 实现型 | D | ✅ 已实现 | 同上文件「轮次记录字段」节(4项必备字段)(T084/098；性质诚实登记为人工推演非机械执行) |
| FR-024 | 实现型·SHOULD[可选] | （未认领⇒裁剪） | ✂️ 已裁剪（附理由） | plan 裁剪登记#1 + `tasks.md:425/483`（不占 K=3 MUST 预算，SHOULD 非 MUST） |
| FR-025 | 约束型 | — | ✅ 已核验未违反 | `repo:check` 新鲜实跑 `gate-mounting:effective-config: pass`；fix 缺口 T085 已认领收紧例外条款 |
| FR-026 | 实现型 | B | ✅ 已实现 | 两份 `plan-template.md` 新增「关键量反向普查」等4章节(T037)+`agents/plan.md`填充(T039) |
| FR-027 | 实现型 | B | ✅ 已实现 | `tasks.md:138` T037「普查节须写明可复现检索命令原样写入」 |
| FR-028 | 实现型 | B | ✅ 已实现 | `agents/plan.md` 写入「声明条数==命令实际输出计数」一致性校验+能力边界B-P1(T041) |
| FR-029 | 实现型 | B | ✅ 已实现 | 普查节「不适用」占位口径+形式主义空表判不合格(T038) |
| FR-030 | 实现型 | D | ✅ 已实现 | `agent-output-discipline.md:76`「纪律一:引用原文化」标题实存(T087) |
| FR-031 | 实现型 | D | ✅ 已实现 | 同文件`:104`「纪律二:数量换算式与计数单位」标题实存(T088) |
| FR-032 | 实现型 | D | ✅ 已实现 | 同文件`:122`「纪律三:推断前提的标记契约」标题实存(T089) |
| FR-033 | 实现型 | D | ✅ 已实现 | `verify.md` 写入「每条推断前提须给运行时验证命令并输出PASS/FAIL」(T091) |
| FR-034 | 实现型 | D | ✅ 已实现 | 同模板`:138`「三条纪律全mode强制不降级」+24格逐格核对(T090/100) |
| FR-035 | 约束型 | — | ✅ 已核验未违反 | Constitution 原则IX 21÷21=100%，零 VIOLATION（`implementation-notes.md:109`） |
| FR-036 | 实现型 | C | ✅ 已实现 | `sync-agent-docs.mjs` 新增4个 sectionConfigs key+`docs:sync:agents`幂等(diff零输出)+3个`agent-docs:shared-section` pass(T068-078) |
| FR-037 | 约束型 | — | ❌ 已违反 | 实跑 grep 命中2处非 `node:` 前缀 import（`agent-tools-core.mjs:33`/`validate-gate-mounting.mjs:53-58`），字面判据无例外条款 |
| FR-038 | 约束型 | — | ✅ 已核验未违反 | grep 原始命中2处但读码确认非「mode清单枚举」，强制列表由 `resolveGateMountingEnforcedModes` 函数派生 |
| FR-039 | 约束型 | — | ✅ 已核验未违反（人工核验） | 10条新标题逐条中文核实，无机械判据，按口径明记人工核验 |
| FR-040 | 约束型 | — | ❌ 已违反 | 核验子句(a)「AGENTS.md净增量=0」被 `e-timing-paradox-appendix.md`#1 证伪（实测+704 bytes）；子句(b)仍pass |
| FR-041 | 约束型 | — | ✅ 已核验未违反（范围限定） | 窄范围(本卡制品)零真实命中；广域24命中均属未触碰历史文件 |
| FR-042 | 实现型 | B | ✅ 已实现 | `verify.md` 历史制品兼容分支+外部判据+D-1对F270实跑验证(T044,`d1-f270-matrix-replay.md`) |
| FR-043 | 实现型 | B | ✅ 已实现 | `tasks.md:148`「本卡只落矩阵对账半边prompt层执行口径，可达性半边随FR-010~013移交」(T047) |
| FR-044 | 实现型 | B | ✅ 已实现 | `verify.md`「脚本口径不可达⇒降级prompt口径并留痕」(原则X)+本卡实例(超时降级留痕)(T044) |
| FR-045 | 约束型 | — | ✅ 已核验未违反 | 两份新脚本 catch 分支均显式 `return {status:'fail',...}`，无空结果无pass |
| FR-046 | 实现型 | B | ✅ 已实现 | `tasks.md:161`「8项需求逐项标注表8行全在」换算式8+2=10(T060) |
| FR-047 | 实现型 | B | ✅ 已实现 | `plan.md:430-439`「FR-047去留论证逐条对照」完整2行对照表(T060) |
| FR-048 | 实现型 | E | ✅ 已实现 | `tasks.md:313` T104「repo:sync再生并连带提交」唯一落点+git status核对 |
| FR-049 | 约束型 | — | ✅ 已核验未违反 | GATE暂停点差值代理判据连续多轮=0，`BLOCKED`定义为拒绝启动非可忽略暂停 |
| FR-050 | 约束型 | — | ✅ 已核验未违反 | SC-011=(5+0)÷5=100%(单位:命令条)，5命令各附命令行与原始输出(`e-regression-guardrails.md`) |
| FR-051 | 约束型 | — | ✅ 已核验未违反 | 字面oracle缺席(分支已删除)如实登记未执行(缺席)；替代oracle两时点\|A∩B\|=0均成立(`e-fr051-disjoint.md`) |
| FR-052 | 实现型 | A | ✅ 已实现 | `orchestration-schema.mjs`+`orchestration-resolver.mjs`+`orchestrator.mjs`+`orchestrator-cli.mjs`+对应测试(T002/004-011/028/030-033) |
| FR-053 | 实现型 | A | ✅ 已实现 | `validate-gate-mounting.mjs`新建(12条断言)+`repo-maintenance-core.mjs`接线+测试文件(T012/013/022-024/031/033) |
| FR-054 | 实现型 | B | ✅ 已实现 | `spec-review.md`先判类别→五态/三取值定义+旧值→新值映射表标题(T042/048/049) |
| FR-055 | 实现型 | B | ✅ 已实现 | `spec-review.md`总体合规率两计数单位分列+严重级映射+3份模板互diff均空(T048-052/061) |
| FR-056 | 实现型 | B | ✅ 已实现 | `tasks.md:265`「FR覆盖不变量」+`:233`承诺任务化并列不互顶替(T051/059) |
| FR-057 | 实现型 | B | ✅ 已实现 | `verify.md`兜底例外条款体系(:188/197/199/201/203)，当次重跑grep命中~26行按要求重算(T045) |
| FR-058 | 实现型 | B | ✅ 已实现 | `verify.md:96`「不得回写plan.md类别列」+`:222`+`:561-562`(T046) |
| FR-059 | 实现型 | B | ✅ 已实现 | `verify.md`「交付判定合并律」整节+3份模板互diff均空(T046/052/061/117) |
| FR-060 | 实现型 | B | ✅ 已实现 | 8份SKILL.md均命中MUST裁剪/K=3+`plan.md:999`展示FR原文(T053-057)；本卡MUST裁剪0条空载如实登记 |
| FR-061 | 实现型 | B | ✅ 已实现 | `verify.md:453`双口径公式与简报摘录B逐字一致(T046/080) |
| FR-062 | 实现型 | B | ✅ 已实现 | `verify.md`证据留痕体系贯穿全文+`spec-review.md:69`(T001/030/047/060/062/073/076/086/097/098/100/102) |
| FR-063 | 实现型 | B | ✅ 已实现 | `verify.md:167`(b)统一缺席规则+`:576`历史制品判定分支(T044) |
| FR-064 | 实现型 | D | ✅ 已实现 | `tasks.md:263`固定口径「非承诺检出率声明」两处落点+D-2归档PASS(T096/114) |
| FR-065 | 实现型 | D | ✅ 已实现 | 4份SKILL.md逐字同源(568,570,574等行)+`plan.md:180`交叉引用(T079/081/086/090/097/101) |
| FR-066 | 实现型 | D | ✅ 已实现 | `plan.md:1712` D-8(iii)逐字匹配+`verify.md:231,232,236`能力边界声明机制(T092/120) |
| FR-067 | 约束型 | — | ✅ 已核验未违反 | grep命中数=0(4章节未写入required_sections)(`.artifact.yaml`) |
| FR-068 | 实现型 | A | ✅ 已实现 | `orchestrator-gate-mounting-guard.md`新建(13245字节)+`sync-agent-docs.mjs`注入+5份SKILL命中标记(T010/011/025-029/032/033/102) |

## 约束型三取值表（13 行）

| FR | 取值 | 一句话理由 |
|---|---|---|
| FR-016 | ✅ 已核验未违反（但同时⚠️类别存疑，归不通过侧） | `agent-tools:required` 8条断言全pass；类别存疑另计 |
| FR-025 | ✅ 已核验未违反 | `gate-mounting:effective-config: pass` |
| FR-035 | ✅ 已核验未违反 | 原则IX 21÷21=100% |
| FR-037 | ❌ 已违反 | 2处非 `node:` 前缀 import，字面判据无例外 |
| FR-038 | ✅ 已核验未违反 | 读码确认非枚举反模式，函数派生 |
| FR-039 | ✅ 已核验未违反（人工核验） | 无机械判据，按口径记人工核验 |
| FR-040 | ❌ 已违反 | 核验子句(a)被实测证伪(+704 bytes) |
| FR-041 | ✅ 已核验未违反（范围限定） | 窄范围零命中，广域命中均属历史文件 |
| FR-045 | ✅ 已核验未违反 | 两处catch均显式fail |
| FR-049 | ✅ 已核验未违反 | GATE暂停点差值=0 |
| FR-050 | ✅ 已核验未违反 | SC-011=5÷5=100% |
| FR-051 | ✅ 已核验未违反 | 替代oracle两时点disjoint成立 |
| FR-067 | ✅ 已核验未违反 | grep命中数=0 |

## 不通过侧全部条目（FR 矩阵内部）

| FR | 态 | 证据指针 |
|----|----|---------|
| FR-010 | 未实现（已登记移交 F27x） | plan矩阵行411 / `tasks.md:375` |
| FR-011 | 未实现（已登记移交 F27x） | plan矩阵行412 |
| FR-012 | 未实现（已登记移交 F27x） | plan矩阵行413 |
| FR-013 | 未实现（已登记移交 F27x） | plan矩阵行414 |
| FR-018 | 未执行（缺席） | `e-d5-interruption-drill.md`：D-5(b)(c) 0÷3 |
| FR-037 | 已违反 | `agent-tools-core.mjs:33`/`validate-gate-mounting.mjs:53-58` 非 node: 前缀 import |
| FR-040 | 已违反 | `e-timing-paradox-appendix.md`#1：AGENTS.md +704 bytes |
| FR-016 | 类别存疑 | `phase5-spec-review-a.md` B-1；`agent-tools-core.mjs:13-14,73-74,202-203` 自称承载 |

**报告层面新增不通过项（不与上表 FR 重复）**：`phase5-quality-review.md` CRITICAL（STRUCTURAL_DEBT：`orchestration-schema.mjs` 346→1010行，约65%篇幅职责分叉，未见修复证据）——按简报「报警未处置」口径计入，详见 `verification-report.md` 合并律节。

## 计数汇总

- 三段行数：23 + 23 + 22 = **68**（单位：FR 条，与 `sed -n '165,232p' plan.md` 矩阵行总数一致）
- 实现型合计 = 68 − 13（约束型）= **55**：已实现49（17+14+18）+ 已裁剪1（FR-024）+ 未实现·移交4（FR-010~013）+ 未执行缺席1（FR-018）= 49+1+4+1=55
- 约束型合计 = **13**：已核验未违反11（1+6+4）+ 已违反2（FR-037/040）= 11+2=13
- 类别存疑 = **1**（FR-016，overlay 标注，不额外计入 68 的分母，是「同一行两套结论」）
- 校验：55 + 13 = 68 ✓

## 本文件结论（合并对账层面，非交付判定）

本文件只做三段合并对账，**不做交付判定**——交付判定合并律裁决与双口径下界核算见 `../verification-report.md` 的「Summary」章节。合并对账层面的不通过侧汇总：FR-010/011/012/013（未实现·移交）、FR-018（未执行·缺席）、FR-037/040（已违反）、FR-016（类别存疑）共 **8** 条 FR 落不通过侧；其余 **60** 条落通过侧（49已实现+11已核验未违反）。此外报告层面另有 quality-review 1 项 CRITICAL 未见修复证据，不绑定具体 FR。
