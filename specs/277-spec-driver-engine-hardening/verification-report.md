# Verification Report: spec-driver-engine-hardening

**特性分支**: `claude/spec-driver-engine-hardening-26e319`
**验证日期**: 2026-09-07
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 2 (原生工具链)

## Layer 1: Spec-Code Alignment

### 功能需求对齐

> 取值集：实现型 FR 走五态（✅已实现/✂️已裁剪/❌未实现/⛔未执行缺席/⚪未对账），约束型 FR 走三取值（✅已核验未违反/❌已违反/⛔未核验），另有跨两套取值集的第9值 ⚠️类别存疑。本节为 68 行判定态清单（不含「描述」列——本分段未读 spec.md 全文，FR 原文描述不在本次核验范围内，避免转述失真）；**逐条完整证据/命令/输出见** `verification/phase5-verify-matrix.md`（三段合并矩阵，本报告不重复全文）。

**实现型（55 条）判定态清单**：FR-001~009、014、015、017、019~023、026~034、036、042~044、046~048、052~066、068（共 50 条）= ✅ 已实现（附证据）；FR-024 = ✂️ 已裁剪（附理由，SHOULD 非 MUST，不占 K=3 预算）；FR-010/011/012/013 = ❌ 未实现（已登记移交后续卡 F27x）；FR-018 = ⛔ 未执行（缺席）（D-5(b)(c) 独立观察点 0÷3 未达成）。

**约束型（13 条）三取值清单**：FR-025/035/038/039/041/045/049/050/051/067（10 条）+ FR-016（1 条，见下）= ✅ 已核验未违反（11 条）；FR-037（2 处非 `node:` 前缀 import）、FR-040（AGENTS.md 净增量核验子句(a)被实测证伪 +704 bytes）= ❌ 已违反（2 条）；⛔ 未核验：0 条。

**类别存疑（跨两套取值集，第9值，1 条）**：FR-016——矩阵标「约束型」，但本卡新建文件 `scripts/lib/agent-tools-core.mjs:13-14,73-74,202-203` 三处以「FR-016」「FR-016(ii)」自称承载该判定逻辑，与矩阵「本条自身不新造制品」的论证矛盾（`phase5-spec-review-a.md` B-1 独立发现，本段核验复核确认）。归不通过侧（按合并律映射表#10），但**同时**其自身三取值仍为「已核验未违反」——二者并列不互相抵消（`phase5-verify-matrix-part1.md` 已明确该口径）。

**不通过侧全部条目汇总（8 条 FR + 1 项报告层 CRITICAL）**：

| 项 | 态 | 证据指针 |
|----|----|---------|
| FR-010/011/012/013 | 未实现（已登记移交 F27x） | plan矩阵行411-414；`tasks.md:375`；裁剪登记准入口径2明确排除（移交≠裁剪） |
| FR-018 | 未执行（缺席） | `e-d5-interruption-drill.md`：D-5(b)(c) 独立观察 0÷3，机制文本已写但验证点未达成 |
| FR-037 | 已违反 | `agent-tools-core.mjs:33`、`validate-gate-mounting.mjs:53-58` 命中2处非 `node:` 前缀 import，字面判据无例外条款 |
| FR-040 | 已违反 | `e-timing-paradox-appendix.md`#1：AGENTS.md 冻结时24316→验收时25020，净增量 **+704 bytes**（非0）；核验子句(b)预算仍达标 |
| FR-016 | 类别存疑 | `phase5-spec-review-a.md` B-1 + 本段独立复核（`agent-tools-core.mjs` 三处自称） |
| `orchestration-schema.mjs` STRUCTURAL_DEBT | 报警未处置（CRITICAL） | `phase5-quality-review.md`：346→1010行，约65%篇幅为门挂载判据、非 schema 定义，职责分叉；未见修复证据（三份产物均未提及已抽出新文件） |

不属于上表、但下游需留痕关注的 WARNING 级发现（不单独触发合并律态，见 Summary 需修复问题节）：SC-013 桶归属待重算（因 FR-016 类别存疑）、FR-038 核验方式证据强度偏薄、`gate-design-convergence-loop.md` 与 5 处衍生文本「六载体逐字同源」自称不实（`phase5-spec-review-b.md`）、`evaluateGateMountingAgainstBase` 单函数141行、两模块 catch 粒度不一致。

### 缺席态字段（两态分列，各带后果判定）

| 项 | 态 | 不可达原因 | 是否已降级到 prompt 口径 | 后果判定 |
|----|----|-----------|----------------------|---------|
| FR-018（生产可达性检查执行标志判定的独立观察验证点 D-5(b)(c)） | ⛔ 未执行（缺席） | matrix 自身指定验证点要求「≥3次独立观察、全部自发分节落盘」，但本卡所有长文档委派 prompt 均带分段/骨架指令（停摆缓解措施），按独立性规则全部不合格，合格观察数 0÷3 | 否（无外部判据可证其为历史制品，不适用「未对账」豁免） | **计不通过 · 阻断**（`e-d5-interruption-drill.md` 已判 D-5 整体未达成，观察窗口保持开启，由后续卡以正规委派路径回补） |

本次未发现 ⚪「未对账」项——三段矩阵各自的「未对账」计数均为 0（part1/part2/part3 逐段计数节已列明）。

**范围说明（诚实登记，非新增不通过项）**：本分段收到的输入（三段矩阵+工具链+三份审查+八项演示附录）未包含 verify.md 框架中 Layer 1.5「验证铁律合规」/Layer 1.8「残留扫描」/Layer 1.9「文档一致性」的独立产出文件。按 `agents/verify.md`「未被映射的任何状态一律归入不通过侧（默认严格）」的兜底句精神，本报告在 Summary 合并律回溯表中如实标注该缺口，但不代表这些层在 Phase 5 全流程中未被执行——是否属于本次分段 C 职责边界外、由其他并行分段/编排器自己完成，需编排器核实；本分段不越权替其下结论。

### 覆盖率摘要

> 两个计数单位分列、不得相加（实现型 FR 条 / 约束型 FR 条）。

- **总 FR 数**：68（实现型 55 + 约束型 13；换算式 55+13=68，单位：FR 条；三段来源 23+23+22=68 交叉核对一致）
- **实现型 · 已实现（附证据）**：49（17+14+18）
- **实现型 · 已裁剪（附理由）**：1（FR-024，SHOULD，不计入分子，裁剪登记指针=plan 裁剪登记#1）
- **实现型 · 未实现**：4（FR-010~013，已登记移交 F27x）
- **实现型 · 未执行（缺席）**：1（FR-018）
- **实现型分母换算式**：49+1+4+1=55（单位：FR 条）
- **约束型 · 已核验未违反**：11（1+6+4）
- **约束型 · 已违反**：2（FR-037、FR-040）
- **约束型分母换算式**：11+2=13（单位：FR 条，⛔未核验=0）
- **类别存疑（第9值，不计入以上两个分母，overlay 于 FR-016）**：1
- **不通过侧合计（FR 矩阵内，单位：FR 条）**：未实现4 + 未执行(缺席)1 + 已违反2 + 类别存疑1 = **8**
- **覆盖率（实现型口径）**：49 ÷ 55 × 100% = **89.1%**（不含约束型分母，单位：实现型 FR 条；约束型口径下已核验未违反率 = 11 ÷ 13 × 100% = 84.6%，两个百分比分属两个计数单位，不相加不比较）

## Layer 2: Native Toolchain

**检测到**：Node.js/TypeScript monorepo（`package.json` + `plugins/spec-driver/`）；来源 `verification/phase5-verify-toolchain.md`（分段 B，HEAD=`98d19a25`，本分段 C 未重跑，转录其结果）。

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS（exit 0） | `[postbuild:stamp] 盖章: commit=98d19a25 (dirty)`；tsc 零输出=零类型错误 |
| Test（node:test） | `npm run test:plugins` | ✅ PASS | tests 1840 / suites 320 / pass 1838 / fail 0 / skipped 2 |
| Test（vitest） | `npx vitest run` | ✅ PASS | Test Files 548 passed \| 4 skipped(552)；Tests 8179 passed \| 15 skipped \| 12 todo(8206)；Duration 64.98s |
| Repo Check | `npm run repo:check` | ⚠️ warn（exit 0，非失败） | 唯一非 pass 项：`graph-quality:freshness: warn`（图 sourceCommit 落后 HEAD，与已知预存口径一致，非新增回归） |
| Release Check | `npm run release:check` | ⚠️ 信息性 warn（exit 0） | `Release contract valid`；`publish-gap` 判定 indeterminate（npm registry 返回体缺 gitHead 字段，非失败） |

**五命令退出码均为 0**；未出现 `dist_not_built` SKIPPED；两处非阻断 warn 均与已知诚实口径吻合，无新增工具链失败。

**审查报告吸收（供合并律引用，本节仅转录三档计数，裁定见 Summary）**：

| 报告 | 总判定 | CRITICAL | WARNING | INFO |
|------|--------|----------|---------|------|
| `phase5-spec-review-a.md` | NEEDS_FIX | 1 | 2 | 3 |
| `phase5-spec-review-b.md` | PASS（1条WARNING待跟进，非阻断） | 0 | 1 | 0 |
| `phase5-quality-review.md` | NEEDS_IMPROVEMENT | 1 | 2 | 1 |

**冻结值三值并列比对**（矩阵锚点 sha256，仅供参考，终裁在编排器 GATE_VERIFY）：① 编排器注入值、② `tasks.md` 冻结字段、③ 对当前 `plan.md` 矩阵章节现算值——三者逐字完全一致，均为 `3c5aa22b941f35327732f3859d4ac38facf2524db0fbb3124b2e63e11cbbf4a8`（match: yes）。`commit sha` 字段为空，与「不采用冻结 commit」的用户裁定一致。

## Summary

### 交付判定合并律

**逐项回溯表**：

| 子检查 | 原始取值 | 映射后落侧（通过侧/不通过侧+对应合并律态） | 拉红交付？ |
|--------|---------|---------------------------------------|-----------|
| Layer 1 矩阵逐条对账（68 FR） | 8 条不通过：FR-010~013(未实现·移交)／FR-018(未执行缺席)／FR-037,040(已违反)／FR-016(类别存疑)；60 条通过(49已实现+11已核验未违反) | 不通过侧（未实现 / 未执行(缺席) / 已违反 / 类别存疑，命中4种合并律态） | 是 |
| Layer 1 冻结值三值并列比对 | ①编排器注入②`tasks.md`冻结③现算值三者逐字一致(match: yes) | 通过侧（不拉红） | 否 |
| Layer 1 类别列异议 | FR-016 类别存疑成立（`phase5-spec-review-a.md` B-1 独立发现，本段复核确认） | 不通过侧（类别存疑）——与上行 FR-016 同源，不重复计数，单列以满足逐检查项回溯格式 | 是（与矩阵行同源，非新增独立拉红点） |
| Layer 1.5 验证铁律合规 | 本分段收到的输入未含该层独立产出文件 | 输入缺席/范围待核——不代入本次合并判定的分子分母，不据此单独拉红，也不据此判通过 | 存疑（不改变总体结论，其余行已独立足够拉红；范围归属请编排器核实） |
| Layer 1.75/1.8/1.9 | 同上 | 同上 | 存疑（同上） |
| Layer 2 工具链 | 5/5 命令 exit 0（build/test:plugins/vitest/repo:check/release:check）；2 处非阻断 warn | 通过侧（不拉红） | 否 |
| 推断前提实证（D-8 演示 + 推断前提运行时验证） | A-2 缺席(0÷3)／A-4 子陈述被证伪(+704 bytes，主陈述仍PASS)／D-8 整体 4÷5=80% 未通过（严格口径，`implementation-notes.md` Phase E 节 + `tasks.md` T120） | 不通过侧（未执行(缺席) 与 未通过 并存） | 是 |
| 守护项输出引用与核对（11 个 Phase E 产物 + 8 个「最终判定」标题 + 待填/待核扫描） | 11/11 存在，8/8 标题在场，`grep "待填\|待核"` 零命中 | 通过侧（引用完整性本身不拉红） | 否 |
| 三份审查报告 CRITICAL 处置 | `phase5-spec-review-a.md` 1C(FR-016，已并入矩阵行不重复计数) ／ `phase5-spec-review-b.md` 0C ／ `phase5-quality-review.md` 1C（STRUCTURAL_DEBT：`orchestration-schema.mjs` 346→1010行，约65%篇幅为门挂载判据而非 schema 定义，未见修复证据） | 不通过侧（报警未处置——quality-review 该条） | 是 |
| 实现量下界（双口径 SC-013，简报摘录B「实现量下界」章节） | 口径(a) 代理指标 49÷55=89.1%（非简报原生「需求项/8」单位，本分段无该项输入，仅供参考）；口径(b) 60÷68=88.2%（简报原式分母64与本分段实测68不符，判定为简报公式滞后于spec三轮异构对抗后的68-FR版本；即便让分母仍用64、分子取上限61，61÷64=95.3%压线，但该分母已证实与当前矩阵不符不可采信；按当前实测分母68代入，60/68与61/68两种分子取法均<95.3%） | 不通过侧（口径(b) 不成立，两式须同时成立、任一不成立即整体不成立） | 是 |

**合并结论**：**❌ 不通过**，由第 1、3、7、9、10 行共同拉红（矩阵内 8 条 FR 不通过 + D-8 演示未通过 + quality-review CRITICAL 未处置 + 双口径下界口径(b)不成立），多点独立成立，任一均已足以判不通过，不存在单点侥幸。

**兜底句核对**：本次不通过的 4 类合并律态（未实现/未执行缺席/已违反/类别存疑）+ 报警未处置 均在既有取值→合并律态映射表内，未出现「映射表外的新状态」需要触发兜底句的情形；Layer 1.5/1.75/1.8/1.9 的输入缺席已单独标注为「存疑/范围待核」而非强行套用某个既有取值，如实登记不冒充判定。

**「未对账」的两个量核对**：本次矩阵三段计数均为 0 未对账，不涉及「计不通过但不阻断」的特殊处理；FR-018 的「未执行(缺席)」按其定义**计不通过且阻断**，与「未对账」不互相复用。

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 89.1%（实现型 49/55 FR，附证据；约束型另计已核验未违反率 84.6%=11/13，两个计数单位分列不相加） |
| Build Status | ✅ PASS（exit 0，tsc 零类型错误） |
| Lint Status | ✅ PASS（`repo:check`/`release:check` 均 exit 0，仅 2 处已知非阻断 warn） |
| Test Status | ✅ PASS（node:test 1838/1840，2 skipped；vitest 8179/8206 passed，15 skipped/12 todo；均 0 failed） |
| **合并律结论** | **❌ 不通过**（由逐项回溯表第 1/3/7/9/10 行共同拉红） |
| **Overall** | **❌ NEEDS FIX** |

> `Overall = 合并律结论 ∧ 工具链结论`。本次工具链结论本身为 PASS，但合并律结论为不通过 ⇒ `Overall = ❌ NEEDS FIX`，两行取值方向一致（无「合并律不通过但Overall声称READY」的禁止并存情形）。

**不得输出「全部达成」类总括结论**：本次 68 条 FR 中 60 条落通过侧（88.2%），但按合并律「任一子检查落 8 态之一即整体不通过」，5 个独立拉红点已足以否决整体判定；覆盖率高不构成「基本达成」的替代表述。

### 需要修复的问题（如有）

1. **FR-016 类别存疑（CRITICAL，最高优先级）**：`scripts/lib/agent-tools-core.mjs:13-14,73-74,202-203` 三处以「FR-016」「FR-016(ii)」自称承载该判定逻辑，与 plan 矩阵「本条自身不新造制品」的类别判定依据矛盾。需 Phase E 或后续卡正面重新论证（回应"护栏1为何不算承载制品"）或改判为实现型并重算 SC-013 口径(a)(b) 换算式与约束型/实现型分桶计数（13→12 / 55→56），此为**亲自重算**要求，不得援引"预期不影响"的推算结论。
2. **FR-037 已违反**：`agent-tools-core.mjs:33`、`validate-gate-mounting.mjs:53-58` 命中 2 处非 `node:` 前缀 import（仓内既有相对路径 helper，非 npm 包），但 FR-037 字面判据无仓内例外条款。需回 plan/spec 侧裁定是否开例外，或改为 `node:` 兼容写法。
3. **FR-040 已违反**：AGENTS.md 字节预算核验子句(a)「净增量=0」被实测证伪（+704 bytes，来源于 `docs/shared/agent-orchestration-overrides.md` 同步链注入的诊断码）。SC-007 已改判「达成（非空载）」，但需检查 spec/plan/tasks 中是否还有其他处仍使用「空载达成」措辞未同步撤回。
4. **FR-010~013 未实现（已登记移交 F27x）**：需确认后续卡 F27x 是否已建卡跟踪，避免移交声明落空。
5. **FR-018 未执行（缺席）**：D-5(b)(c) 独立观察窗口合格观察 0÷3，本卡所有长文档委派 prompt 均带分段指令导致不满足独立性规则。需后续卡以 `spec-driver:{specify,plan,tasks,implement}` 正规委派路径回补 ≥3 次真实独立观察。
6. **quality-review CRITICAL（STRUCTURAL_DEBT）**：`plugins/spec-driver/contracts/orchestration-schema.mjs` 346→1010 行，约65%篇幅（`evaluateGateMountingAgainstBase` 及~10个辅助函数）实为门挂载可达性判据、非 schema 定义，文件职责已分叉。报告已给出低风险机械重构建议（抽至 `contracts/gate-mounting-predicate.mjs`，三处消费方改 import 路径即可）。**注**：该问题不影响当前功能正确性（`node --check` 全过、fail-closed 方向一致、三轮对抗审查未在判据正确性上留残留），但按 CRITICAL 字面判级仍需处置或经编排器/用户明确降级留痕。
7. **WARNING 级（建议一并处理，非阻断优先级）**：(a) `gate-design-convergence-loop.md` 与 5 处衍生文本（`plan.md:335` + 4份SKILL）自称「逐字同源」但实测不符（表格vs内联句），且不受 `BEGIN/END SHARED SECTION` 标记保护，`docs:sync:agents` 无法感知漂移（`phase5-spec-review-b.md`）；(b) FR-038 核验方式为人工叙述、缺可复制运行的机械验证命令（`phase5-spec-review-a.md`）；(c) `evaluateGateMountingAgainstBase` 单函数141行，超阈值约3倍（`phase5-quality-review.md`）；(d) `agent-tools-core.mjs` 与 `validate-gate-mounting.mjs` 的 catch 错误处理粒度不一致（同上）；(e) SC-013 口径(a)(b)桶归属需在 FR-016 裁定后同步重算留痕。

**异构对抗档位标注**（按 CLAUDE.local.md 现行约定）：本卡属门禁/判定器类改动（`orchestration-schema.mjs`/`validate-gate-mounting.mjs`/gate挂载判据），Codex 对抗审查仍处暂停期，已改用独立子代理异构对抗（本次三路 spec-review×2 + quality-review 各自独立执行、互不透传中间结论）。**Codex 审查暂停，异构档位缺席**，配额恢复后建议回补。

### 未验证项（工具未安装）

- 无缺失工具项。本机 `timeout`/`gtimeout` 均不可用，已按 `verify.md` 降级条款改用 Bash 工具自身超时参数兜底，此降级仅影响包装层，不改变各命令自身的判定结论（`phase5-verify-toolchain.md` 已留痕）。

## GATE_VERIFY 裁决与修复轮（编排器追加 · 2026-09-12）

- 编排器亲自重算：`recomputed=3c5aa22b` / `held=3c5aa22b` / `match=yes`（上文三值只作参考，本项为判定输入）。
- 裁定：G-① FR-016 改判实现型（追加）→ 类别存疑已裁定；G-② FR-037 意图澄清（字面「已违反」不改判）；G-③ quality-review CRITICAL 登记后续卡（报警 → 已处置）；(ii) 措辞修正。全部登记于 `verification/e-timing-paradox-appendix.md` #14 ~ #18 与 §GATE_VERIFY 裁决。
- **修复轮后合并律：仍 fail**（移交 4 + FR-018 缺席为结构性；FR-037 / FR-040 字面已违反）。**总体结果维持 ❌ NEEDS FIX（严格口径）；交付定性 = 部分交付**：已实现 50（含 FR-016 改判）/ 已核验未违反 10 / 移交 4 / 缺席 1 / 已违反 2 / 裁剪 1 = 68（单位：FR 条）。

