# GATE_DESIGN 对抗收敛循环 — 第 3 轮（上限轮 · 止损模式）

**产物版本指针**：spec.md @ 840 行（R2 修订四段 + 分批章节后）
**模式**：`R_max = 3` 已达（FR-021 止损条款），**只守承重项**；承重项清单 B-1~B-6 于 R3 启动前预先落盘于 `round-2-findings.md` 末节（2026-09-03），本轮未增删
**执行**：两路并行、边查边落盘（`round-3-alpha.md` 293 行 / `round-3-beta.md` 260 行），零中断
**结论**：**承重项 0 ÷ 6 = 0% 守住**（单位：承重项）；承重项内新增 CRITICAL **9 条**（α 5 + β 4 = 9）。按止损条款，承重项失守**不得登记为残余放行**，须修补后做修订核验（非新一轮攻击）再进 GATE_DESIGN 决策。
**收敛态**：R1 的 20 条与 R2 的 16 条对应项经两路逐条复核**全部实质已修**；9 条新增全部是「为堵上一轮的洞而新造的类别 / 例外 / 断言集 / 接受点，自身没被同一把尺量过」的相邻面（β 报告命名为同一形态）。

## 编排器亲自复现（不照单全收子代理结论）

| 断言 | 复现方法 | 结果 |
|---|---|---|
| R3-α-C01 `GATE_DESIGN` 早于 `plan` | 读 `config/orchestration.yaml` feature 段：phase `3.5 gate_design`（`gates_after: [GATE_DESIGN]`）在 phase `4 plan`（`gates_before: [GATE_DESIGN]`）之前；story 的 GATE_DESIGN 亦在 plan 之前（本 SKILL Phase 2.5 → Phase 3） | **属实** |
| R3-β B-4 整段替换删门 | scratch 项目根：`generate-template feature` → 数字 id 加引号 → 删 3.5 块 + phase 4 `gates_before` 置 null → 存 `.specify/orchestration-overrides.yaml` → `get-phases feature` 输出 **16** 个 phase（base 为 17，少的正是 3.5 gate_design）；`get-gate-behavior feature GATE_DESIGN` 仍返回 `is_hard_gate: true, behavior: always`；`effective-orchestration` diagnostics 仅 1 条 **info**（`mode-overridden`）。**更正（2026-09-04，A1 段 D-7）**：复现脚本当时还打印了「挂载 GATE_DESIGN 的 phase = []」——该行**不是证据**，因 `get-phases` 的输出本就不含 `gates_before/after` 字段，任何配置下都恒得空集；有效证据是 phase 计数 16 ≠ 17 与 `effective-orchestration --format json` 的 phase 内容 | **属实**（守护面与执行面脱节；证据行已更正） |
| R3-α-C04 `.specify/runs/` 在 verify 写面内 | `.gitignore:55` = `.specify/runs/`；`git ls-files .specify/runs` = 0 | **属实** |
| 附带（非承重，既有 bug）| `generate-template feature` 原样存为 override ⇒ schema-fallback：`phases.1.id` 等 4 处「期望 string，实际 number」（`0.5/3.5/5.5/6.5` 未加引号）——模板不能 round-trip 自家 schema | 记 dogfooding 账本，不在本卡范围 |

## 九条 CRITICAL 与编排器拍板的结构性修法（R3 修订指令）

| ID | 承重项 | 缺陷 | 修法（主线程拍板） |
|---|---|---|---|
| R3-α-C01 | B-1 | FR-060 把 MUST 裁剪接受点钉在 `GATE_DESIGN`，而该门在三个强制 mode 下结构性早于 plan，永远看不到裁剪登记；FR-049 又堵死补门 | 接受点移到 plan 之后确实存在的 **`GATE_TASKS`**（8 mode 皆挂载、always/critical）。行为**复用既有 on_failure 语义**：MUST 裁剪登记非空 = 「任务分解有明显问题」⇒ balanced 下 GATE_TASKS 暂停展示原文并接受；autonomous 下 auto 继续但裁剪记「未接受」⇒ FR-059 合并律判交付不通过（fail-loud）。不新增门、不改 policy 语义；FR-049 加一句说明此非新增确认点 |
| R3-α-C02 | B-1 | 8 需求项分区只覆盖 34 ÷ 67 FR；核心集 33 条（含反稀释机制自身）无归属，全裁 SC-001/013 仍达成 | SC-013 改**双口径**：(a) 需求项级 M ÷ 8 ≥ 7 ÷ 8；(b) **FR 级**：核心集已实现（或约束型已核验）÷ 63 ≥ **60 ÷ 63 = 95.2%**。§分批 增 FR→需求项/跨切 归属表覆盖全部 67 条（跨切 = 落点纪律 / YAGNI / 护栏 / 登记，由 (b) 覆盖） |
| R3-α-C05 | B-6 | M_min = 7 = M 上界 ⇒ 等式 ⇒ FR-060 无成功路径 | 由 C02 的 FR 级下界给出 **3 条**裁剪余量（63 − 60 = 3，与 FR-060 的 K = 3 对齐）：「需求项完整」定义为其实现型 MUST FR 全部已实现或经 FR-060 接受裁剪且全卡累计 ≤ 3 条；超出 ⇒ 走移交卡 |
| R3-α-C03 | B-2 | 锚住的是原件，判定消费的是 verify 自报读数，无第三方比对 | **编排器在 GATE_VERIFY 决策时亲自重算** plan.md 矩阵哈希并与自己持有的注入值比对（GATE 决策本身属编排器亲自执行范围），结果写入 GATE 日志；verify 报告的三值降为参考 |
| R3-α-C04 | B-2 | resume 兜底把锚来源换回 verify 可写的 `.specify/runs/`，触发条件由 verify 自述 | 删除 `.specify/runs/` 来源；resume 下**只认** GATE_TASKS 后的 commit 对象（`git show <sha>:<tasks path>`），由 resume 的编排器（新会话）取值注入，非 verify 自述；无 commit ⇒ 缺席 ⇒ 未执行。SHOULD：GATE_TASKS 通过后编排器立即 commit plan.md + tasks.md（冻结 commit） |
| R3-β-C1 | B-3 | 约束型 FR 类别未贯穿 FR-003/004/006/056 兜底全称句 ⇒ 新三重互锁（本卡自己 4 条约束型 FR 必撞） | FR-001 矩阵加「类别」列；FR-003/004/006/056 全称句加「实现型」限定；约束型 FR：不入认领行、不入裁剪登记、GATE_TASKS 不要求任务、只走 FR-005 三取值 |
| R3-β-C2 | B-3 | FR-057 例外射程只到两节，`verify.md:152/:163` 跳过型兜底在射程外且逐行点名被自己禁止 | 射程改为**检索命令圈定**：`grep -nE '不阻断|跳过|继续|优雅降级|不标记为失败'` 对 `agents/verify.md` 的全部命中行（命令 + 输出写入产物），非节名 |
| R3-β-C3 | B-4 | `modes.feature` 整段替换删掉挂门 phase ⇒ 门不被求值；FR-052 禁改字段未碰、FR-053 三断言全 PASS | FR-052 禁改集从「字段」扩到「挂载」：override 不得使强制 mode 的 effective phase 序列失去挂载 GATE_DESIGN 的 phase；resolver 校验缺失 ⇒ **error** 级 diagnostic + 回退 base。FR-053 断言改在 **effective phase 序列**上（存在挂载 phase ∧ is_hard_gate ∧ diagnostics 无 error）。**运行时**：SKILL 门禁配置加载步骤发现未挂载 / error ⇒ BLOCKED。附：`get-gate-behavior` 与挂载脱节登记为既有缺陷并在本卡修（返回 `mounted`） |
| R3-β-C4 | B-5 | FR-017 的 8 条断言零证据级留痕、只在 verify prompt 口径跑，「没跑」与「跑了」同形 | 8 条断言落为 **`repo:check` 守护项**（扩展 `namespace-consistency` 或新增 `agent-tools:required`：specify/plan/tasks 的 `tools` ⊇ {Edit, Bash}；verify 的 `tools` 冻结），机器执行、外部于 verify；verify 只引用该守护项最近输出（附命令 + 输出） |

## 非承重「登记不追」（两路合计 6 条，原文见各报告结论节）
假认领零成本不可见（能力边界内）/ §自洽检查关键词表是值枚举 / SC-002 重算命令 `FR-0` 前缀在 FR-100 后静默漏计（余量 32 条）/ 矩阵第 2 行区间不含 FR-064（已裁定以 SC-013 为准）/ SC-006 的 88 为单次实跑值未复跑 / base 与 fallback 的 gate `applicable_modes` 不一致（既有，零消费方）。

## 后续
R3 修订（两段）→ 修订核验（R2-D1 式逐条表，非新攻击）→ `GATE_DESIGN` 决策（PAUSE 呈报：承重项修法、分批边界 63/4 vs 40/27、GATE_TASKS on_failure 复用、冻结 commit）。

## R3 修订处置状态

| 段 | 内容 | 状态 |
|---|---|---|
| α（B-1/B-2/B-6） | FR-060 接受点 → `GATE_TASKS`（复用既有 on_failure 判据）/ SC-013 双口径 (a) 7 ÷ 8 ∧ (b) 60 ÷ 63 / FR→需求项·跨切归属表（N₁ 34 + N₂ 33 = 67，核心集内跨切 33）/ FR-005 编排器 GATE_VERIFY 亲自重算 + resume 只认 commit 对象 + 冻结 commit SHOULD / 矩阵第 2 行、SC-013 括注消账 | ✅ 已落（spec 899 行） |
| β（B-3/B-4/B-5） | 约束型贯穿 FR-001/003/004/006/056（含 4 条约束型 FR 纸面推演 4 ÷ 4 不再死锁）/ FR-057 射程改检索命令圈定（基线 11 命中行，兜底型 8 + 非兜底 3）/ FR-052 禁改集三项（GATE_DESIGN 字段 + **GATE_TASKS default_behavior 禁 auto/skip** + 挂载禁改）/ FR-053 断言 3 → 12 条（含唯一能抓整段替换的挂载断言，剔除零消费方的 applicable_modes）/ **FR-068** 运行时 BLOCKED（落点 4 ÷ 5 SKILL 有具名小节，resume 无）/ FR-017 落 `agent-tools:required` 新 family（`AGENT_FILES` 扩展路线实测被否：会造 2 个必红 check） | ✅ 已落（spec 974 行；FR 68；SC-002 N=68；SC-006 21 项 / 88+3=91；核心集 64 ÷ 68 = 94.1%；SC-013(b) 61 ÷ 64 = 95.3%，余量 3 = K） |

**α 段纠正编排器一处误判**：实测 `lib/orchestrator.mjs:293-301` 的 policy → behavior 映射为 `strict ⇒ always`、**`balanced ⇒ always`**、**`autonomous ⇒ on_failure`**（非 `auto`）。故 MUST 裁剪非空时 balanced / autonomous 下 `GATE_TASKS` **均暂停**；唯一不暂停路径是 behavior 被解析为 `auto`（user_config `gates.GATE_TASKS.pause: auto` 或 override）——fail-loud 分支（记「未接受」⇒ FR-059 判不通过）挂在该路径。方向更严，spec 已按实测写。
**α 段登记的外溢**：接受点搬到 `GATE_TASKS` 后，`GATE_TASKS`（`hard_gate_modes: null`）的 `default_behavior` 可被 `gateOverrideSchema` 三行改 `auto`/`skip` ⇒ 接受点静默关闭；FR-052 禁改集原只盖 `GATE_DESIGN` → 交 β 段把 `GATE_TASKS` 纳入射程。

**β 段诚实登记（须在 GATE_DESIGN 呈现）**：
- 源文件由 17 → **21**（新增 `orchestration-resolver.mjs` / `orchestrator.mjs` / `orchestrator-cli.mjs` / 新建 `agent-tools-core.mjs`）；代码文件 3 → **7 = 本仓中位数**。**R2 可实施性给分批边界 A 的支撑之一「代码面低于 p25」已失效**，边界 A 现落在代码面中位数、总文件数 p50–p75。
- SC-010 受时序悖论影响的演示 4 ÷ 8 → **5 ÷ 8 = 62.5%**（D-5(a) 现依赖 implement 期产出的守护项）。
- FR-068 的强度上限：落在 prompt 层、无机械执行点。
- 边界 B 的 40 + 27 = 67 ≠ 68：FR-068 不在任一组，GATE 拍板前须裁定归属（编排器建议：入核心集，它是 B-4 的运行时守卫）。
- β 未处置登记：「把 FR-017 补进三条不可让步的边界」（收敛不扩写）。

## R3 修订核验（`round-3-verify.md`，2026-09-03）

**实质已修 9 / 仅措辞 0 / 未修 0**（9 + 0 + 0 = 9，单位：条）；**承重项守住 6 ÷ 6 = 100%**（单位：承重项）；仍成立攻击构造 **0 条**。核验方独立复跑 5 处关键事实（policy 映射 / 9 处挂载行号 / FR-057 grep 11 行 / FR 68 与归属表各恰一次 / `.specify/runs` 仅剩留痕）与 spec 一致。

核验顺带登记 6 条新问题（**不计入收敛计数**，收尾清理处置）：
| # | 问题 | 处置 |
|---|---|---|
| 1 | `GATE_TASKS` 在 fix mode 零挂载（实测 7 ÷ 8），spec 三处写「8 mode 全挂载」——把 `applicable_modes` 当挂载证据，是 β-C3 要收口的混淆在 C01 修法里复发 | 修正 + fix 条件格 fail-loud（MUST 裁剪一律未接受 ⇒ 不通过） |
| 2 | 三处「63」漏随核心集 64 重算 | 修正 |
| 3 | resume 分支 `<sha>` 取法未指定 | 补：sha 记于 tasks.md 冻结字段 |
| 4 | SC-013 (b) 分子漏「已裁剪（经 FR-060 接受）」 | 修正 |
| 5 | 类别列由 plan 自判无第三方校验（口径 (b) 稀释通道） | 登记残余，GATE_VERIFY 人工抽查，留后续卡 |
| 6 | FR-057 射程正则自身是值枚举（F259 同形） | 登记：正则 + 人工通读并列，漏网即扩 |

## 本轮收敛态总结（供 GATE_DESIGN）
- 三轮轨迹：R1 20 → R2 16 → R3 9（承重项内）→ 修订核验 0 仍成立。**未达「零新增」**；按 FR-021 止损条款于 `R_max = 3` 转守承重项，承重项全部守住。
- 三轮共同形态（β 报告命名）：每轮新洞都是「为堵上一轮的洞新造的类别 / 例外 / 断言集 / 接受点，自身没被同一把尺量过」。这与 F270 三轮语料同向，是 FR-021 止损条款存在的实证依据，也是本卡对第 3 项「至零新 CRITICAL」措辞的诚实修正（无上界判据在其参考语料 F270 上也从未收敛）。

## GATE_DESIGN 决策（2026-09-04）

`[GATE] GATE_DESIGN | mode=story | policy=balanced | hard_gate=否 | decision=PAUSE → 用户批准继续`

| 议题 | 用户拍板 |
|---|---|
| 分批边界 | **边界 A：核心集 64 / 移交 4（FR-010~013 → 后续卡 F27x production-reachability-check）**；FR-068 入核心集；诚实口径：代码文件 7 = 本仓中位数，总文件数 p50–p75 |
| 编排器行为变更 | 接受 (1) MUST 裁剪接受点 = `GATE_TASKS`（复用既有 on_failure）/ (2) 编排器 `GATE_VERIFY` 亲自重算矩阵哈希 / (3) 运行时 BLOCKED（FR-068）；**不采用 (4) 冻结 commit** → resume 下矩阵对账记「未执行（缺席）」 |
| GATE 决策 | **A) 批准继续** → Phase 3 |

## 对抗收敛轮次记录终态（FR-023 / Key Entities 必备字段）

| 字段 | 值 |
|---|---|
| 门禁类分类判定 | 本卡属门禁 / 判定器类（改 `GATE_DESIGN` 判据、verify 判定器、override schema）；分类依据留痕于 round-1 首节 |
| 轮次数 | 3（R1 / R2 / R3），每轮 3 路（R2 首次三路全被中断，重跑后完成） |
| 每轮新增 CRITICAL 计数 | 20 / 16 / 9（R3 只计承重项内） |
| 每轮输入产物版本指针 | R1: spec.md @ 465 行；R2: @ 572 行；R3: @ 840 行；修订核验: @ 974 行；GATE 决策: @ 985 行 |
| 与上轮对照 | R2 对 R1：17 实质已修 / 3 仅措辞 / 0 未修；R3 对 R2：对应项全部实质已修，9 条全为新增（修补新暴露相邻面） |
| 是否进入止损模式 | **是**（`R_max = 3` 达上限仍有新 CRITICAL） |
| 承重项清单 + 预先声明时点 | B-1~B-6，2026-09-03 R3 启动前落盘于 round-2-findings.md 末节 |
| 终态 | 承重项 6 ÷ 6 守住（修订核验 9 ÷ 9 实质已修，仍成立构造 0）；非承重残余 6 + 6 = 12 条登记不追 |
| 对抗方标识 | 全部为 general-purpose 子代理（opus），每轮每路独立 prompt、不共享编排器思路；Codex 配额耗尽，异构档位缺席（commit message 标注） |
