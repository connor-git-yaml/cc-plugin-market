# Phase 5 Verify 矩阵对账 — 分段 2（FR-024 ~ FR-046，共 23 行）

## 输入与命令

- 矩阵行范围：`sed -n '188,210p' specs/277-spec-driver-engine-hardening/plan.md`（FR-024 ~ FR-046，矩阵冻结不改）。
- 证据源：`tasks.md` §FR→Task 结构化表（`grep -n "^| FR-0" tasks.md`，行 425-448）+ §约束型 FR 核验点章节（`tasks.md:341-395`）+ 逐条 Task 勾选状态核对（T037-T101 区间，全部 `[x]`）+ `implementation-notes.md`（T031 原则 IX 复跑记录）+ `verification/phase5-verify-toolchain.md`（5 条命令新鲜实跑记录、e-timing-paradox-appendix.md #1 摘录）。
- 本段额外实跑证据（本子代理自己执行，非转录）：`npm run repo:check`（新鲜跑一次，`gate-mounting:effective-config: pass`）；`grep -nE "^\s*import\b" scripts/lib/agent-tools-core.mjs plugins/spec-driver/scripts/validate-gate-mounting.mjs`；`grep -n -e "'feature'" ... plugins/spec-driver/scripts/validate-gate-mounting.mjs`；`grep -rnE 'plan §[0-9]' specs/277-.../ plugins/spec-driver/`（广域 + 窄范围两次）；`grep -n -A6 'catch' scripts/lib/agent-tools-core.mjs plugins/spec-driver/scripts/validate-gate-mounting.mjs`；`grep -nE '^#{2,4} '` 对两份新模板取标题清单。
- HEAD：本次对账未重新核实 HEAD sha（分段 B 报告已记 `98d19a25`，本段未见工作区改动提示，视为同一基线）。

## 逐行对账表

| FR | 矩阵类别 | 认领 Phase | 判定态 | 证据 |
|---|---|---|---|---|
| FR-024 | 实现型 · SHOULD `[可选]`，矩阵标「裁剪」 | （未认领⇒裁剪） | ✂️ **已裁剪（附理由）** | 裁剪登记指针 = plan §裁剪登记 第 1 条；tasks.md:425「本卡唯一裁剪项，不占 FR-060 的 K=3 MUST 预算」；tasks.md:483 换算式「认领 50 + 裁剪 1（FR-024）= 51」。**GATE_TASKS 接受留痕不适用**：FR-024 为 SHOULD 非 MUST，plan/tasks 两处均明写「不占 K=3 MUST 预算」，故 MUST 裁剪接受口径（单列成组/K=3 分档）对本条不生效，无需另核接受留痕 |
| FR-025 | **约束型** | — | ✅ **已核验未违反** | 核验方式=`validate-gate-mounting.mjs` 12 条断言+mode矩阵文本核对+fix缺口处置。命令 `npm run repo:check`（本子代理新鲜实跑）输出：`gate-mounting:effective-config: pass`、`agent-docs:shared-section:orchestrator-gate-mounting-guard: pass`，整体 `status=warn`（唯一 warn 项为 `graph-quality:freshness`，与本条无关）。fix 缺口处置：tasks.md:252 T085 `[x]` 已在 `spec-driver-fix/SKILL.md` 显式认领收紧例外条款 → FR-020 |
| FR-026 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:138 T037 `[x]`：两份 `plan-template.md`（`plugins/spec-driver/templates/specify-base/` + `.specify/templates/`）各新增 `## 关键量反向普查` 等 4 具名章节；tasks.md:140 T039 `[x]`：`plugins/spec-driver/agents/plan.md` 填充口径同步 |
| FR-027 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:138 T037 `[x]` 原文：「普查节须写明『每行的可复现检索命令原样写入』（FR-027）」 |
| FR-028 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:142 T041 `[x]`：`agents/plan.md` 写入「声明条数==命令实际输出计数」一致性校验与不一致时的阻断口径，并写明能力边界（B-P1，判据覆盖不了「该申报的关键量是否都申报了」） |
| FR-029 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:139 T038 `[x]`：普查节写入「不适用（本次无关键量变更）」占位口径，且同时要求标注「形式主义空表与漏做同等判不合格」 |

| FR-030 | 实现型 | D | ✅ **已实现（附证据）** | tasks.md:254 T087 `[x]`；落点核实：`plugins/spec-driver/templates/agent-output-discipline.md:76`「### 纪律一：引用原文化」标题实存（本子代理 `grep -nE '^#{2,4} '` 实测） |
| FR-031 | 实现型 | D | ✅ **已实现（附证据）** | tasks.md:255 T088 `[x]`；落点核实：同文件 `:104`「### 纪律二：数量换算式与计数单位」标题实存 |
| FR-032 | 实现型 | D | ✅ **已实现（附证据）** | tasks.md:256 T089 `[x]`；落点核实：同文件 `:122`「### 纪律三：推断前提的标记契约」标题实存；并核对 Phase B 的 T037 模板结构与本节口径一致 |
| FR-033 | 实现型 | D | ✅ **已实现（附证据）** | tasks.md:258 T091 `[x]`：`plugins/spec-driver/agents/verify.md` 写入「每条登记的推断前提，verify 必须至少给出一条运行时口径验证命令并输出 PASS/FAIL」，且与 T044（FR-044）复核两处口径不打架 |
| FR-034 | 实现型 | D | ✅ **已实现（附证据）** | tasks.md:257 T090 `[x]` + tasks.md:267 T100 `[x]`（24 格全「强制」逐格核对）；落点核实：同模板文件 `:138`「### 适用范围声明：三条纪律全 mode 强制，不随 mode 降级」标题实存 |
| FR-035 | **约束型** | — | ✅ **已核验未违反** | 核验方式=Constitution 原则 IX 逐条对照（21 条断言：8+12+1）。tasks.md:94 T031 `[x]`；`implementation-notes.md:109` 原文：「原则 IX 由 13÷21=61.9% 升至 **21÷21=100%**（单位：断言条）」，8 条 agent-tools 断言「全部找到同语义原文，**零 VIOLATION**」（`implementation-notes.md:101-109`，D-11 消账段） |

| FR-036 | 实现型 | C | ✅ **已实现（附证据）** | tasks.md T068-T078（9 项）全 `[x]`。本子代理实测 `scripts/sync-agent-docs.mjs` 的 `sectionConfigs` 含 4 个新 key：`orchestrator-gate-mounting-guard`(:127) / `agent-output-discipline`(:147) / `gate-tasks-scope-cut-acceptance`(:164) / `gate-design-convergence-loop`(:192)；T073 `[x]` 记录 `npm run docs:sync:agents` 后 `git diff --exit-code` 零输出（幂等）+ `repo:check` 3 个 `agent-docs:shared-section:*` 全 pass |
| FR-037 | **约束型** | — | ❌ **已违反** | 核验方式=两份新脚本全部 import 行须为 `node:` 前缀，命中任一非 `node:` 前缀即判已违反（tasks.md:344）；spec.md:339 原文「只允许 import node: 内置模块，零 npm 依赖」。本子代理实跑 `grep -nE "^\s*import\b" scripts/lib/agent-tools-core.mjs plugins/spec-driver/scripts/validate-gate-mounting.mjs`：命中 2 处非 `node:` 前缀——`agent-tools-core.mjs:33` `from './namespace-consistency-core.mjs'`；`validate-gate-mounting.mjs:53-58` 多行 import `from '../contracts/orchestration-schema.mjs'`。**两处均为仓内既有 helper 模块（非 npm 包），但 FR-037 原文未开「仓内相对路径」例外**，按其自身「命中任一即违反」的字面判据应判已违反；是否降级为可接受例外需回 plan/spec 侧裁定 |
| FR-038 | **约束型** | — | ✅ **已核验未违反** | 核验方式=强制 mode 清单须从 `GATE_DESIGN.hard_gate_modes` 派生、禁写字面量枚举（判据是存在性判定不是值枚举）。本子代理实跑 `grep -n -e "'feature'" -e "'story'" ... plugins/spec-driver/scripts/validate-gate-mounting.mjs`：命中 2 处（`:68` `HARD_GATE_ASSERTION={gateId:'GATE_DESIGN',mode:'feature'}` 单点断言；`:251` `tryRunCli(['effective-orchestration','feature',...])` bootstrap 任取一 mode 取 resolver 配置，注释明写「resolver 与 mode 无关」）。经读码确认：实际强制 mode 列表由 `:253` `resolveGateMountingEnforcedModes(effectiveConfig)` 派生（`:55` import 自 `orchestration-schema.mjs`，源头 `GATE_DESIGN.hard_gate_modes`），2 处命中均非「mode 清单枚举」用途，非 F259 反模式。**原始 grep 非空，结论基于人工读码**，供下游复核 |
| FR-039 | **约束型** | — | ✅ **已核验未违反（人工核验）** | 核验方式=章节标题/散文中文、术语英文，判读无机械判据（tasks.md:345 明写「须如实登记为人工核验」）。本子代理实跑 `grep -nE '^#{2,4} '` 取两份新模板全部标题（10 条：适用场景/不适用场景/分节写作与逐节Edit口径/中断幸存与按段续写/委派形态分流/轻量三纪律/纪律一二三/适用范围声明/何时触发/展示什么与接受什么/门不停时的判定/冻结值字段格式），逐条为中文；术语（mode/FR/GATE_TASKS 等）保持英文，人工判读一致 |
| FR-040 | **约束型** | — | ❌ **已违反**（核验方式子句级） | FR-040 原文断言「本卡对该预算的影响按定义为 0」，核验方式两个子句：(a) `wc -c AGENTS.md` 净增量=0 bytes；(b) `worktree-local-state:agents-byte-budget`=pass。`verification/e-timing-paradox-appendix.md` 记录表 #1（`phase5-verify-toolchain.md` 转录）：子句 (a) **已被证伪**——实测 24316→25020（**+704 bytes**，非 0），来源系本卡 commit ① 经既有共享段 `docs/shared/agent-orchestration-overrides.md` 同步链注入 2 行诊断码（**非** FR-036 新增 4 entry 所致，新 entry 的 targets 确实不含 AGENTS.md，该窄命题仍成立）；子句 (b) **仍 pass**（25020≤32768 且 704≤8452）。`phase5-verify-toolchain.md` 已将 SC-007 改判「达成（非空载）」。**按 FR-040 字面「影响按定义为 0」的核心断言与其核验子句 (a) 均不成立，判已违反；SC-007 数值门禁本身未被突破留痕以供合并律取舍** |
| FR-041 | **约束型** | — | ✅ **已核验未违反（范围限定说明）** | 核验方式=`grep -rnE 'plan §[0-9]' specs/277-.../ plugins/spec-driver/` 命中数=0。本子代理实跑：**窄范围**（本卡核心制品：spec/plan/tasks/implementation-notes.md + 2 份新模板 + 两份 `plan-template.md`）命中 1 处——`spec.md:229`，但该行文本本身即是在**定义**该禁则时引用的坏例「plan §8」（原文：「任何制品中出现『plan §N』式引用视为悬空引用」），系规则定义文本自身，非实际悬空引用实例。**广域**（整个 `plugins/spec-driver/` 树）命中 24 个文件，经核对**均为本卡未触碰的历史既有文件**（`git status` 改动清单不含它们），引用的是各自历史 Feature 自己 plan.md 的有效编号章节（如 `codex-runtime-doctor-core.mjs` 引用「plan §8.7」，非本卡的 `plan.md`）。判定基于「FR-041 约束对象为本卡制品」的范围解释，非机械广域零命中 |
| FR-042 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:145 T044 `[x]`：`agents/verify.md` 历史制品兼容分支+外部判据（plan.md 首个 commit 时间/模板版本戳，判不出按不成立走 fail-loud）。运行时实证：T062 D-1 回放对**历史** `plan.md`（F270）实跑外部判据，产出 `verification/d1-f270-matrix-replay.md`（428 行，`implementation-notes.md:11` 记「通过：捕获 4÷4、误报 0÷5」） |
| FR-043 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:148 T047 `[x]` 原文：「FR-043——本卡只落**矩阵对账半边**的 prompt 层执行口径，并显式写明可达性半边随 FR-010~013 移交 F27x、其在本卡内的缺席**不计未完成**」 |
| FR-044 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:145 T044 `[x]`：「脚本口径不可达⇒首选降级到 prompt 口径并留痕，两口径皆不可得才判『未执行（缺席）』」（宪法原则 X）。**运行时实例**：`verification/phase5-verify-toolchain.md:9`「超时保护降级：本机 timeout/gtimeout 均不可用...按 verify.md:342 降级条款跳过 shell 层超时包装...此降级只影响包装层，不改变各命令自身判定结论」——同一 Phase 5 执行过程中真实触发并留痕的降级实例 |
| FR-045 | **约束型** | — | ✅ **已核验未违反** | 核验方式=两份新脚本逐个 catch 分支不得返回空结果或 pass。本子代理实跑 `grep -n -A6 'catch' scripts/lib/agent-tools-core.mjs plugins/spec-driver/scripts/validate-gate-mounting.mjs`：`agent-tools-core.mjs:253` catch 显式 `return {status:'fail',...}`（注释「catch 分支禁止返回空结果或 pass」）；`validate-gate-mounting.mjs:275` catch 同样显式 `return {status:'fail',...}`（注释「取不到事实本身就是失败信号」）。唯一例外 `readTextOrNull`(:128) 只对 `ENOENT` 返回 null、其余错误 `throw`，属「不存在」与「读不动」分离设计，不属违规 |
| FR-046 | 实现型 | B | ✅ **已实现（附证据）** | tasks.md:161 T060 `[x]` 原文：「核对该章节的『8 项需求逐项〈必须/可选〉标注表』**8 行全在**（FR-046）」，换算式「8+2=10 行（单位：登记行）」 |

## 本段约束型三取值（FR-025 / 035 / 037 / 038 / 039 / 040 / 041 / 045）

| FR | 三取值 | 一句话理由 |
|---|---|---|
| FR-025 | ✅ 已核验未违反 | `repo:check` 新鲜实跑 `gate-mounting:effective-config: pass` |
| FR-035 | ✅ 已核验未违反 | 原则 IX 21÷21=100%，零 VIOLATION（implementation-notes.md:109） |
| FR-037 | ❌ 已违反 | 2 处非 `node:` 前缀 import（本地相对路径），字面判据无例外条款 |
| FR-038 | ✅ 已核验未违反 | 原始 grep 命中 2 处但读码确认非「mode 清单枚举」，强制列表实由函数派生 |
| FR-039 | ✅ 已核验未违反（人工核验） | 10 条新标题逐条中文，术语英文，无机械判据按口径记人工核验 |
| FR-040 | ❌ 已违反 | 核验子句 (a)「净增量=0」被 e-timing-paradox-appendix.md #1 证伪（实为 +704 bytes） |
| FR-041 | ✅ 已核验未违反（范围限定） | 窄范围（本卡制品）零真实命中；广域 24 命中均属本卡未触碰的历史文件 |
| FR-045 | ✅ 已核验未违反 | 两处 catch 均显式 `fail`，无空结果无 pass |

**本段小计**：✅ 已核验未违反 6 ／ ❌ 已违反 2 ／ ⛔ 未核验 0（共 8 行，换算式 6+2+0=8）

## 类别存疑登记

本段 23 行中**无类别存疑**——23 行的「类别」标注（15 实现型 + 8 约束型）经逐行核对均成立：15 实现型行每行都能指向一份本次新造/改写的制品（模板章节、`.mjs` 脚本、`verify.md`/`plan.md` 段落等）；8 约束型行（FR-025/035/037/038/039/040/041/045）规定的均为「不得发生某事」或「整体保持某种性质」，逐行核对均无 Phase 认领实现、也不可能裁剪，三项测试同时成立，类别标注未见偏离。

## 本段计数

**实现型（15 行）**：FR-024/026/027/028/029/030/031/032/033/034/036/042/043/044/046。
- ✅ 已实现（附证据）：14（FR-026/027/028/029/030/031/032/033/034/036/042/043/044/046）
- ✂️ 已裁剪（附理由）：1（FR-024）
- ❌ 未实现 / ⛔ 未执行（缺席） / ⚪ 未对账：0
- 换算式：14 + 1 + 0 = **15**（单位：FR 条）

**约束型（8 行）**：FR-025/035/037/038/039/040/041/045。
- ✅ 已核验未违反：6（FR-025/035/038/039/041/045）
- ❌ 已违反：2（FR-037/040）
- ⛔ 未核验：0
- 换算式：6 + 2 + 0 = **8**（单位：FR 条）

**类别存疑**：0。

**本段合计**：15 + 8 = **23**（单位：FR 条，= plan.md 矩阵 FR-024~046 行数，`sed -n '188,210p' plan.md` 现取核对一致）。

**本段不通过侧汇总**（供 Phase C 合并律引用）：FR-037（已违反）、FR-040（已违反）共 **2** 条；其余 21 条落通过侧（14 已实现 + 1 已裁剪 + 6 已核验未违反）。FR-037/FR-040 均属「核验方式字面判据 vs 代码实质」的边界案例，证据已在上表逐条附命令与输出，供下游裁定是否需要回 plan/spec 修订核验方式或开例外条款。
