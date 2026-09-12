# Phase 5 Verify 矩阵对账 — 分段 3（FR-047 ~ FR-068，共 22 行）

状态：已完成（22 ÷ 22 行对账 + 4 条约束型三取值 + 计数节均已填；执行子代理在收尾回复阶段停摆，编排器于 2026-09-07 核对行数 22 = 232 − 211 + 1 与计数换算式后置为完成，未改任何判定）

## 输入与命令

- 矩阵行：`sed -n '211,232p' specs/277-spec-driver-engine-hardening/plan.md`（FR-047~FR-068，22 行，矩阵冻结未改）
- tasks.md 认领态：`awk '/^- \[[ x]\] T[0-9]+/ {...FR-0[0-9]+提取...}' specs/277-spec-driver-engine-hardening/tasks.md | command grep -E "FR-0(4[789]|5[0-9]|6[0-8])\b"`
- 代码/测试落点：`command grep -rnE "FR-0(4[789]|5[0-9]|6[0-8])\b" plugins/spec-driver scripts tests --include='*.mjs' --include='*.ts' --include='*.md'`
- 逐条散文落点用 `command grep -n` 定向核验（见各行「证据」列命令）
- 判定态定义与合并律取自简报（verify.md 摘录，未重读 verify.md 全文）

## 逐行对账表

| FR | 类别 | 认领 Phase | 判定态 | 证据 |
|----|------|-----------|--------|------|
| FR-047 | 实现型 | B | ✅ 已实现（附证据） | `plan.md:430-439`「三、FR-047 要求的去留论证逐条对照（第 3 项/第 5 项）」完整 2 行对照表：第 3 项 `GATE_DESIGN` 收敛循环（`:434`「不可实现，判必须，完整实现（Phase D）」）、第 5 项委派时长分流（`:435`，与 FR-019 对照，结论一致处置不同并留痕理由）。T060 `[x]` |
| FR-048 | 实现型 | E | ✅ 已实现（附证据） | `tasks.md:313` T104「`npm run repo:sync` 再生并连带提交（**FR-048 的唯一落点**）」：改动后跑 repo:sync + `git status --porcelain` 核对两分发目录 diff 仅含受影响集 S；T101 `:268` 验证点 3 交叉引用 FR-048。T104 `[x]` |
| FR-049 | 约束型 | — | ✅ 已核验未违反 | 见下「本段约束型三取值」 |
| FR-050 | 约束型 | — | ✅ 已核验未违反 | 见下「本段约束型三取值」 |
| FR-051 | 约束型 | — | ✅ 已核验未违反 | 见下「本段约束型三取值」 |
| FR-052 | 实现型 | A | ✅ 已实现（附证据） | `orchestration-schema.mjs`（禁改集甲乙丙，17/19/84/179/187/192/247/271/487/535/537/570/696/700/955 行）+ `orchestration-resolver.mjs`（417/523/535/619/624/649 行，`validateGateMounting()`）+ `orchestrator.mjs`（156/228/238 行，`mounted` 字段）+ `orchestrator-cli.mjs`（131/139/143/144 行）+ `orchestrator.test.mjs`（403-634 多组用例）+ `orchestration-resolver.test.mjs`（912-1322 多组，含 T5 系列负向断言）。T002/T004-T011/T028/T030-T033 全 `[x]` |
| FR-053 | 实现型 | A | ✅ 已实现（附证据） | 新建 `plugins/spec-driver/scripts/validate-gate-mounting.mjs`（12 条断言）+ `repo-maintenance-core.mjs:436-437`（`aggregateValidation('gate-mounting', …)` 接线，注释明写「与 FR-068 运行时第一道闸分工，二者缺一不可」）+ `validate-gate-mounting.test.mjs`（含 (i) 红灯构造用例）。T012/T013/T022-T024/T031/T033 全 `[x]` |
| FR-054 | 实现型 | B | ✅ 已实现（附证据） | `spec-review.md:54-62`（先判类别→实现型五态/约束型三取值定义，"两套取值不得混用"）+ `:78-82`（"旧值→新值显式映射表"标题）+ `:121-133`（FR 状态表 + 超范围实现观察章节）。T042/T048/T049 全 `[x]` |
| FR-055 | 实现型 | B | ✅ 已实现（附证据） | `spec-review.md:113-119`（总体合规率：实现型/约束型两计数单位分列不得相加）+ `:138,149,158,162`（严重级映射：CRITICAL 扩为不通过侧 5 取值 + 类别误标 / WARNING 改绑证据完整性 / INFO 改称超范围实现观察，"三行触发条件全部迁到新取值上"）+ 3 份 `verification-report-template.md` 互 `diff` 均空（逐字相同）+ `spec-review.artifact.yaml:9`（章节名由「过度实现检测」改写留痕）。T048/T049/T050/T052/T061 全 `[x]` |
| FR-056 | 实现型 | B | ✅ 已实现（附证据） | `agents/tasks.md:265`「**FR 覆盖不变量**：每条未被裁剪登记的实现型 FR 至少有一个对应任务…类别为『约束型』的 FR 一律不要求任务…裁剪是本不变量的合法例外，不是违规」+ `:233`（与承诺任务化"并列不得互相顶替"）。**注**：矩阵证据列写的落点是 `:51`/`:78`，实测该行号区间内容已非本题（后续编辑致行号漂移），内容改落于 `:233`/`:265`，语义要求仍满足。T051/T059 全 `[x]` |
| FR-057 | 实现型 | B | ✅ 已实现（附证据） | `verify.md` 兜底例外条款体系：`:188`「本文件散布着若干『优雅降级/不阻断/继续其他/跳过』型兜底条款…不得援引到下列四类检查项」+ `:197`「例外条款（唯一口径）」+ `:199`（为何第 4 类须单列）+ `:201`（射程边界诚实登记）+ `:203`（复核计数口径：命中须拆三类+自指行扣除）。`grep -nE '不阻断\|跳过\|继续\|优雅降级\|不标记为失败'` 当次重跑命中约 26 行（2026-09-03 基线 11 行，已按 FR-057 要求"验收时重跑并按当次输出重算"，不视为退化）。T045 `[x]` |
| FR-058 | 实现型 | B | ✅ 已实现（附证据） | `verify.md:96`「本子代理不得回写 plan.md 的类别列」+ `:222`「结论只写入验证报告，不回填 spec.md/plan.md」+ `:561-562`「不得以『本子代理持有 Bash、可用 sed -i 回填』化解」。T046 `[x]` |
| FR-059 | 实现型 | B | ✅ 已实现（附证据） | `verify.md` 自身含「交付判定合并律」整节（简报摘录 B 逐字取自该节：任一子检查落 8 态之一 ⇒ 交付整体判不通过 + 既有取值→合并律态显式映射表）+ 3 份 `verification-report-template.md` 互 `diff` 均空。T046/T052/T061/T117 全 `[x]`（T123 未勾选，为跨 FR 元核对任务，非 FR-059 专属认领，见下方冲突留痕说明） |
| FR-060 | 实现型 | B | ✅ 已实现（附证据） | 8 份 `SKILL.md`（feature/story/implement/resume/sync/doc/refactor/fix）均命中「MUST 裁剪」/「K = 3」/「K=3」；`agents/plan.md:999`「该 FR 的**原文**——不是摘要、不是结论转述」（展示 FR 原文子要求）。T053-T057 全 `[x]`。**本卡自身 MUST 裁剪 0 条**（仅 1 条 SHOULD `[可选]` 项 FR-024 被裁），按矩阵要求该闸门在本卡内**空载**，如实记「本次无 MUST 裁剪，接受点未触发」而非「已接受」 |
| FR-061 | 实现型 | B | ✅ 已实现（附证据） | `verify.md:453`「不得与 SC-013 的双口径混用（两个量、三个计数单位，均不得相加）：本字段是单轮的 FR 覆盖率统计，SC-013 是交付级实现量下界且为双口径——`M ÷ 8`（需求项）与 `F ÷ 64`（FR 条）」，双口径公式与简报摘录 B「实现量下界」章节逐字一致。T046/T080 全 `[x]` |
| FR-062 | 实现型 | B | ✅ 已实现（附证据） | `verify.md` 证据留痕体系贯穿全文（`:77` 五态定义"不可达原因"必附、`:142-151` 三值比对"命令与其原始输出"、`:173/183` "未执行(缺席)"判据、`:197-199` 四类检查项命令留痕）+ `spec-review.md:69`「无命令与原始输出的抽检结论按未执行计，不得记通过」+ plan.md 本表自身「取数命令与实跑输出」小节即为该条在 plan 侧首次自证（plan.md 原文明写）。T001/T030/T047/T060/T062/T073/T076/T086/T097/T098/T100/T102 全 `[x]`（T123 未勾选，同 FR-059 说明） |
| FR-063 | 实现型 | B | ✅ 已实现（附证据） | `verify.md:167`「(b) 统一缺席规则（一切『缺席』形态共用同一条）」+ `:576`「`spec.md` 缺席须按『统一缺席规则』走：先判是否历史制品⇒属历史判『未对账』不阻断、不属历史则 fail-loud 判『未执行（缺席）』并阻断」。T044 `[x]` |
| FR-064 | 实现型 | D | ✅ 已实现（附证据） | `tasks.md:263` T096「原样写入固定口径：『本演示只证明该检查在 F270 语料上非恒空，不构成对承诺检出率的任何声明』」两处落点（候选池段落 + T099 D-2 演示结论处）+ 禁止条款（不得把 `FR-008` 口径为「延期承诺已被覆盖」）；`tasks.md:323` T114 归档判 PASS（强度上限声明逐字在场 3÷3 处；`FR-008` 禁用口径断言用法 0 处）。T096/T114 全 `[x]` |
| FR-065 | 实现型 | D | ✅ 已实现（附证据） | `spec-driver-fix/SKILL.md:568,570,574`（(i)判定结论须与依据同处附命令原文与原始输出 /(ii)门禁类改动升格强制、命中面 14 条(路径13+语义1)与 `gate-design-convergence-loop.md` 分类表同源 /(iii)判不出按成立处理）+ `doc/SKILL.md:855,857,861`、`refactor/SKILL.md:247,249,253`、`sync/SKILL.md:469,471,475` 四份逐字同源；`agents/plan.md:180`「四份 SKILL 承载的是条件格触发条件的三项约束…各判各的量」交叉引用确认落点意图。T079/T081/T086/T090/T097/T101 全 `[x]` |
| FR-066 | 实现型 | D | ✅ 已实现（附证据） | `plan.md:1712` D-8(iii) 逐字匹配「核对三处分母口径：V-1~V-3 未混入分母、**B-1/B-2 两条能力边界声明均未计入分母**、**A-3 的命令与陈述同一命题**」+ `verify.md:231,232,236`「能力边界声明」机制（恒真命题归入该桶且不计入实证分母，判据="任何输入下都取真"）。T092/T120 全 `[x]` |
| FR-067 | 约束型 | — | ✅ 已核验未违反 | 见下「本段约束型三取值」 |
| FR-068 | 实现型 | A | ✅ 已实现（附证据） | `templates/orchestrator-gate-mounting-guard.md`（13245 字节，2026-09-07 落盘）+ `sync-agent-docs.mjs:127-128`（注入配置 `key: 'orchestrator-gate-mounting-guard'`）+ 5 份 SKILL（feature/fix/implement/resume/story）命中「门禁挂载守卫」标记；`resume/SKILL.md:93-104` 完整落地三条判据（挂载蕴含式 / diagnostics 无 error / 判不出⇒从严，含 `mounted_in_base` 判不出按 `true` 代入）+ `:104`「`BLOCKED` 的语义（这一条不打折）：`BLOCKED` = 拒绝启动本次运行」。T010/T011/T025-T029/T032/T033/T102 全 `[x]` |

## 本段约束型三取值（FR-049 / 050 / 051 / 067）

### FR-049（不加重 GATE 交互负担）—— ✅ 已核验未违反

- **核验方式**：本卡新增 GATE 暂停点差值须为 0；`AskUserQuestion`/`暂停`/`mcp__` 字面量代理判据在多轮 Phase 收口中重复核验。
- **证据**（沿用 Phase 收口既有产物内已含命令与原始输出，非本子代理重复实跑）：
  - `verification/fix-phaseBD-summary.md:29`：「FR-049 代理判据：`AskUserQuestion` 0、`mcp__` 0、`暂停` 命中 1 文件 = `agents/verify.md` **被删除的旧行**…新文本用『停下』，SKILL 射程 0 文件 ⇒ PASS」
  - `verification/phaseD-a-summary.md:90,93`：`git diff -G'AskUserQuestion' --stat -- 'plugins/spec-driver/skills/*/SKILL.md'` → 空输出；「暂停/AskUserQuestion 两个字面量在新增文本中零出现」
  - `verification/phaseD-c-summary.md:8`：`npm run repo:check` status=warn（仅 graph-quality:freshness）；「FR-049 代理判据 `暂停`·`AskUserQuestion`·`mcp__` 各 0 文件」
  - `command grep -n "BLOCKED" plugins/spec-driver/skills/spec-driver-resume/SKILL.md` → `:104`「`BLOCKED` 的语义（这一条不打折）：`BLOCKED` = **拒绝启动本次运行**」，未见「暂停询问是否忽略后继续」式绕过表述
- **结论**：GATE 暂停点差值代理判据连续多轮 = 0（1 处命中系旧行删除，非新增）；`BLOCKED` 定义为拒绝启动而非可忽略暂停。未违反。

### FR-050（五护栏零失败或已归因）—— ✅ 已核验未违反

- **核验方式**：SC-011 = 5 ÷ 5，五条命令各附命令行与原始输出；满载假红须走 FR-050 三条件归因。
- **证据**：`specs/277-spec-driver-engine-hardening/verification/e-regression-guardrails.md:75-138`
  - T112 SC-011 汇总原文：「换算式：（零失败命令数 5 + 已归因假红命令数 0）÷ 命令总数 5 = **100%**，单位：命令条。分母 5 = vitest 1 + test:plugins 1 + build 1 + repo:check 1 + release:check 1」
  - 逐命令表含 T109 `npm run build` → exit 0 等 5 行
  - **诚实口径照录**（`:134`）：「历史红次登记（不计入 SC-011，仅留痕）…这两次红跑**未做 FR-050 三条件的正式归因记录**（当时以清净窗口重跑全绿收口，未逐条比对失败文件与 B 的交集、未登记 flaky 清单）；它们**不进入 SC-011 的分子或分母**——SC-011 只计终态五命令」
- **结论**：五条命令终态零失败，历史满载假红未做正式归因且诚实地不计入分子分母。未违反。

### FR-051（与 F276 disjoint）—— ✅ 已核验未违反

- **核验方式**：先证明 oracle 取得成功再判 \|A ∩ B\| = 0；取不到即判「未执行（缺席）」。
- **证据**：`specs/277-spec-driver-engine-hardening/verification/e-fr051-disjoint.md`
  - **字面 oracle 缺席**（`## 1`）：`git rev-parse --verify --quiet claude/f276-compliance-handoff-fixes-9a9fe1` 等 4 条命令均 exit=1（分支已按交付后删除约定移除）→ 按 T103 字面口径**如实判「未执行（缺席）」**，不默认放行
  - **替代 oracle E-①**（`## 2`）：A := `git diff --name-only e01611b2..26a3b15f`（54 文件，F276 认领集超集）；两时点分列：T103 时点 B_pre（再生前，103 文件，去 wrapper 目录）与 T105 时点 B（再生后，119 文件全量）
  - `comm -12 <(A|sort) <(B_pre|sort)` → **0**；`comm -12 <(A|sort) <(B|sort)` → **0**
  - 已知接触点交叉验证：`git diff --name-only e01611b2..26a3b15f | command grep -c 'scripts/lib/repo-maintenance-core.mjs\|scripts/sync-agent-docs.mjs\|scripts/lib/agent-tools-core.mjs'` → **0**
  - **裁定**（`## 4`）：「字面口径：未执行（缺席）——本产物不把字面项记 PASS。替代口径：PASS（\|A∩B\|=0，A 为超集）」
- **结论**：字面 oracle 缺席与替代 oracle 通过两个时点如实分列，未违反（替代口径 disjoint 成立，字面口径诚实记缺席不默认放行）。

### FR-067（登记性条目：4 章节不得写入 required_sections）—— ✅ 已核验未违反

- **核验方式**：`grep -rn 'FR → Phase 覆盖矩阵\|裁剪登记\|关键量反向普查\|推断前提登记' plugins/spec-driver/agents/*.artifact.yaml` 命中数须 = 0。
- **本子代理原样重跑**：
  ```
  $ command grep -rn 'FR → Phase 覆盖矩阵\|裁剪登记\|关键量反向普查\|推断前提登记' plugins/spec-driver/agents/*.artifact.yaml
  （无输出，exit 1）
  ```
- **spec/plan 登记核对**：`command grep -n "FR-067" specs/277-spec-driver-engine-hardening/spec.md specs/277-spec-driver-engine-hardening/plan.md` → plan.md `:231` 矩阵行本身即为登记（核验方式原文写明命中数=0 与两条残余风险：章节在机械层无强制点 / `required_sections` 当前无消费方）
- **结论**：4 个具名章节实测命中数 = 0，与核验方式声明一致。未违反。

## 类别存疑登记

本段 4 条约束型 FR（FR-049/050/051/067）逐条核对「是否存在一份本次要新造或改写的制品承载它」：四条均为纯核验/禁止式条款（GATE 暂停点差值比对、五命令零失败判定、文件集 disjoint 判定、required_sections 命中数判定），其核验载体只有 `verification/*.md` 系列报告——按简报口径「本子代理自己产出的 verify 报告与 `[GATE]` 日志行不构成承载制品」，四条均**不成立**类别存疑。**本段类别存疑 = 0 条**。

## 本段计数

- 本段矩阵行总数：**22**（FR-047~FR-068，`232-211+1=22`，单位：FR 条）
- 实现型：**18** 条（FR-047/048/052/053/054/055/056/057/058/059/060/061/062/063/064/065/066/068）
  - ✅ 已实现（附证据）：**18**
  - ✂️ 已裁剪：0　❌ 未实现：0　⛔ 未执行（缺席）：0　⚪ 未对账：0
- 约束型：**4** 条（FR-049/050/051/067）
  - ✅ 已核验未违反（附核验方式）：**4**
  - ❌ 已违反：0　⛔ 未核验：0
- ⚠️ 类别存疑：**0** 条
- 换算式校验：18 + 4 = 22（单位：FR 条），与本段矩阵行总数一致
- 不通过侧合计（本段）：**0** 条（合并律 8 态中未命中任何一态：未实现/未通过/未执行(缺席)/未对账/报警未处置/已违反/未核验/类别存疑 均为 0）
