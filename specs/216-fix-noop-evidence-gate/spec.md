---
feature: fix-noop-evidence-gate
feature_number: 216
branch: claude/f216-noop-evidence-gate-85136d
status: Draft
created: 2026-07-20
input: "F216 fix 模式方向误读修复：no-op 出口的可执行证据门（V008 病根，对 GStack 剩余差距的全部结构性部分）"
research_basis: specs/216-fix-noop-evidence-gate/research/tech-research.md
---

# Feature Specification: fix 模式 no-op 出口可执行证据门

## 概述

F212 收官评测显示 c3（spec-driver+Spectra）以 81.8% 未超 GStack 90.9%，扣除双方共同的坟场任务后，**真实差距的全部结构性部分 = V008×2**。V008 的病理取证明确：fix 流程的"先核实是否已修"步骤把代码 base 态误读为"已历史修复"，产出一个**穿着 F208 合规外衣的自信 no-op**——流程制品齐全、结构化出口完整、fix-report 引用 `contains.py:50` 断言"已修正"，但两个 run 的 patch **零源码改动**、MCP 调用 ×0（从未进入代码分析）。对照组裸 opus 因为没有这个"先核实"流程步骤，反而 V008 3/3。**结论：流程步骤本身制造了这类失败，且 prompt 层（F206-R3 三版加固被"流程遗弃"绕过）与依从层（F208 坍塌率降到 0/29 但 V008 纹丝不动）都够不到"方向误读"。**

本 feature 的目标是给 no-op 出口加一道**可执行证据门**：把"问题是否已修复"这一方向判断，从可以被自信文本断言满足，转化为必须携带**结构化复现证据 + 主 transcript 可见的真实执行痕迹**才放行的机械门禁。该门的能力边界必须诚实声明——它核验的是"复现命令是否真被执行、执行是否得到约定的 PASS 判定、fix-report 声明是否与执行记录逐条配对"，**不核验**"复现命令在语义上是否真的对应 issue 症状"，也**不宣称**能从退出码机械判定"bug 是否存在"（详见「能力边界声明」）。抗绕过能力的真正分界线，在于判据是否配对主 transcript 侧 Bash `tool_use`/`tool_result` 的真实执行记录，而非仅解析 fix-report.md 静态文本；本门把绕过成本从"可被纯文本断言绕过"抬高到"必须伪造一次真实且结果自洽的命令执行"，但不声称杜绝一切绕过。

本 spec 不写实现代码。三个机制变体（A-strict / A+结构化报告骨架 / A+替代证据例外）的选型分析是核心交付，最终推荐供 GATE_DESIGN 拍板。

---

## 机制选型分析（GATE_DESIGN 拍板核心交付）

调研关键洞察（tech-research §4/§7 与风险 #1）：**候选 A（red-repro-first）与候选 B（双向对账合同）的 judge 侧落点高度重合**——都要在 no-op 分支新增"结构化证据字段级校验"。真正分界不在校验器形态，而在**判据是否配对主 transcript 侧 Bash `tool_use`/`tool_result` 的真实执行记录**。任何只解析 fix-report.md 静态文本的判据都会重演 V008（假证据填充）。故本 spec 不再用含混的"A vs B / 回退 A+B"框架，而是以"是否要求真实执行 + 是否开替代证据例外"为轴，收敛为三个变体。

### 变体 1 · A-strict（纯执行证据，无例外）

no-op 放行**必须**携带一条被主 transcript 记录的真实 Bash 复现命令执行，且得到约定 PASS 判定；不设任何"无法构造复现"的替代通道。
- parser/匹配成本：低——只需一条 ExecutionRecord 的存在性 + PASS 判定。
- 审计/测试成本：低。
- 弱点：EC-003（环境依赖缺失、无法构造可执行 repro）场景被一刀切堵死，产生假阳性摩擦，可能把合法 no-op 逼成绕过。

### 变体 2 · A+结构化报告骨架（推荐）

A-strict 的执行内核 + fix-report `## 判定依据` 采用**逐声明对账行**骨架（吸收候选 B 的对账思想）：每条症状/结论项逐条绑定一条 ExecutionRecord。任一绑定为红 / INCONCLUSIVE / 相互冲突 → no-op 不成立。
- parser/匹配成本：中——需解析逐声明行并逐条配对执行记录。
- 审计/测试成本：中——按声明行给多缺失合并反馈。
- 优势：既保留 A 的可执行内核（抗绕过），又用 B 的对账结构承载多症状（W5），与现有 `## 判定依据` 章节基建贴合、与 M10 TDD 引擎化前移战略一致。

### 变体 3 · A+替代证据例外

在变体 2 基础上，为 EC-003（无法构造可执行 repro）开一条**受控替代证据通道**：允许以历史修复 commit 定位 + 代码路径现状摘录等非执行证据收口，但须显式标注"替代证据"并接受更弱的机械核验。
- parser/匹配成本：高——需额外定义替代证据类型枚举与各自核验规则。
- 审计/测试成本：高——替代通道本身是新的绕过面，需专门 fixture 防"滥用例外"。
- 风险：例外通道若判据过宽，会重新打开 V008 式文本自证缺口。

### 推荐结论

**推荐变体 2（A+结构化报告骨架）**。理由：(1) 抗绕过分界线上最优——中间产物是"一次真实命令执行"，天然对应主 transcript Bash 痕迹可配对核验；(2) 逐声明对账行解决多症状绑定（W5）且贴合既有 `## 判定依据` 基建；(3) 与 M10 TDD 引擎化前移战略一致。

> **✅ GATE_DESIGN 已拍板（2026-07-20）**：采用**变体 2**；Q2 决议为**不开**替代证据例外通道（EC-003 场景一律按缺证据阻断）；Q3 决议为**沿用 fail-open**（见「判定材料不可用」节）。

---

## User Scenarios & Testing

### User Story 1 - 无证据的自信 no-op 被拦下并被要求补复现（Priority: P1）

作为依赖 fix 流程质量的用户，当 fix 会话在"看似已修复"情形下产出零源码改动的 no-op、且 fix-report 只有自信文本断言（引用行号但无任何主 transcript 可见的真实复现执行）时，我希望这个 no-op 出口被证据门拦下，而不是被当作合法收口放行。

**Why this priority**: 这是 V008 病根的直接修复，是 GStack 剩余结构性差距的全部；不解决此项本 feature 无意义，构成 MVP。

**Independent Test**: 基于 F212 已知片段（PUBLISH-REPORT-M8.md L40 引用原文）构造合成 fixture（非原始回放，原始 transcript 已丢失），复刻"自信引用行号但无执行痕迹"输入，喂给 judge report 模式，断言判定为不合规（block 档 exit 2）且反馈文本包含"要求产出 repro"的 next-step 指引。

**Acceptance Scenarios**:

1. **Given** fix-report 含 `## 判定依据` 章节、正文非空非占位符、且委派了 1 次核实子代理，但章节内无逐声明复现执行绑定、主 transcript 无对应 Bash 执行痕迹，**When** judge 在 block 档判定该 no-op 出口，**Then** 判定为不合规、返回阻断（exit 2），反馈文本明确指出"缺可执行复现证据，请先产出并执行复现命令再据实收口"。
2. **Given** 同上无证据 no-op，**When** 用户在阻断后阅读反馈，**Then** 反馈包含具体 next-step（要求产出 repro 的形态说明），而非仅"不合规"。

---

### User Story 2 - 带真实证据的合法 no-op 正常放行（Priority: P1）

作为处理"确实无需改动"（历史已修复 / 误报）问题的用户，当我诚实产出并执行了复现命令、结果得到约定 PASS 判定时，我希望这个 no-op 收口被证据门正常放行，不产生新的假阳性摩擦。

**Why this priority**: 与 US1 互为一体——证据门若把合法 no-op 也堵死就是把出口废掉；二者共同构成 MVP 的正确性边界。

**Independent Test**: 用"诚实执行了复现命令 + 主 transcript 有对应 Bash tool_use/tool_result 痕迹 + 得到 PASS 判定"的 fixture 喂给 judge，断言判定为合规、放行（exit 0）。

**Acceptance Scenarios**:

1. **Given** fix-report `## 判定依据` 逐声明绑定复现执行记录、主 transcript 存在对应 Bash 执行痕迹且得到约定 PASS 判定，**When** judge 判定该 no-op，**Then** 判定为合规、放行（exit 0），不产生阻断。
2. **Given** 一个真有 bug、走完整修复路径（含源码改动）的 fix 会话，**When** judge 判定，**Then** 证据门不介入（仅作用于 no-op 分支），修复路径零新增摩擦。

---

### User Story 3 - 阻断→反馈→补 repro→放行闭环（Priority: P2）

作为迭代修复的用户，当我的首次 no-op 被证据门拦下后，我希望按反馈补上复现证据再次收口时能被放行，形成可自愈的闭环，而不是被无限阻断或被迫绕过机制。

**Why this priority**: 保证机制可用性与用户体验；MVP 靠 US1+US2 的判据正确性即成立，闭环是其自然结果，故 P2。

**Independent Test**: 见 SC-003a（确定性 fixture 序列闭环，入门禁）与 SC-003b（手工 headless smoke，非门禁）。

**Acceptance Scenarios**:

1. **Given** 首次无证据 no-op 被阻断，**When** 用户补充主 transcript 可见的复现执行记录后再次触发收口判定，**Then** 判定转为合规、放行。
2. **Given** 连续无证据 no-op，**When** 达到 F208 有界降级阈值（第 3 次），**Then** 走既有降级放行路径并审计记录"证据缺失降级放行"（见 FR-009）。

---

## Functional Requirements

- **FR-001** [必须] 系统 MUST 在 `spec-driver-fix/SKILL.md` 的 Phase 1 no-op 出口分支新增强制步骤：下"无需代码改动"结论前，Phase 1 编排器 MUST **亲自经 Bash 工具执行**一个复现命令（使其在主 transcript 可见），并将命令与执行结果作为判定依据。verify 类子代理仅复核"无需改动"结论、**不承担**复现执行（子代理 sidechain 是独立文件，主 transcript 看不见其内部 Bash）。非 Bash 工具执行的复现属 MVP 不支持（见 EC-007 与能力边界）。（US1、US2、W7）
- **FR-002** [必须] fix-report 的 `## 判定依据` 章节 MUST 采用**逐声明对账行**结构：逐条列出 issue 的症状/结论项，每条 MUST 绑定一条复现执行记录（ExecutionRecord，见 FR-016）；任一绑定记录为红 / INCONCLUSIVE / 相互冲突时，no-op 不成立。模板 MUST 明确此为硬要求而非自然语言提示。（US1、US2、W5）
- **FR-003** [必须] fix-compliance-judge 的 no-op 分支 MUST 在现有"章节非空 + 非占位符 + ≥1 次核实委派"判据之外，新增"逐声明复现证据字段"校验：判定依据章节缺少可执行复现证据绑定时判为不合规。（US1）
- **FR-004** [必须] judge 的 no-op 证据校验 MUST 与主 transcript 侧 Bash `tool_use`/`tool_result` 执行记录**配对核验**（配对与匹配规则见 FR-016），确认 fix-report 声称的复现命令确有对应的真实执行记录；仅有文本字样、主 transcript 无对应执行痕迹的，MUST 判为不合规（抗假证据填充，风险 #1 核心缓解）。（US1、EC-001）
- **FR-005** [必须] 当 no-op 因缺可执行证据被 block 档拦下时，系统 MUST 输出结构化反馈文本，包含明确 next-step 指引："先产出并经 Bash 执行复现命令证明症状是否存在，再据实收口"。反馈内容 MUST 由 FR-019 定义的 missing key → MISSING_ACTION_TEXT 映射生成。（US1、W10）
- **FR-006** [必须] 当 no-op 每条声明均绑定真实执行的复现记录、且各记录得到约定 PASS 判定、且主 transcript 有对应痕迹时，judge MUST 判为合规并放行（exit 0），不得对合法 no-op 产生假阳性阻断。（US2）
- **FR-007** [必须] 证据门 MUST 仅作用于 no-op 出口（`closureForm === 'no-op'` 分支）；对含源码改动的完整修复收口路径 MUST 零介入、零新增摩擦。（US2）
- **FR-008** [必须] 证据门 MUST 完整兼容 F208 判定合同的 off/warn/block 三档语义：**off 档在任何 transcript 读取前零接触直接放行；warn 与 block 档执行相同的证据判定逻辑，二者判定结果一致；差异仅在于——只有 block 档进入 `routeBlock()` 与阻断计数变更，warn 档只落审计事件 + stderr 提示、恒放行、绝不 bump 计数**。新证据门是 no-op 出口的**追加要求**而非对既有判定合同的重写。（回归护栏、W8）
- **FR-009** [必须] 证据门 MUST 兼容 F208 有界降级（第 3 次放行）与 F211 补救清零：证据缺失导致的阻断**计入 F208 既有共享阻断预算（`BLOCK_LIMIT`，不分桶、合同不变）**；第 3 次判定走既有 `releaseDegraded()` 放行；降级放行时 MUST 在审计事件中复用 missing[] 结构标注"证据缺失降级放行"（不新造自由文本字段）。合规判定后 MUST 沿用 F211 无条件清零阻断计数。（US3、EC-006、W9）
- **FR-010** [必须] warn 档下证据缺失 MUST 通过 stderr `[FIX-COMPLIANCE][WARN]` 前缀表达"no-op 缺可执行复现证据"，但不阻断、不计数——保持 warn 档"提示不阻断"语义（判定逻辑与 block 一致，仅动作不同，见 FR-008）。（EC-005、W8）
- **FR-011** [必须] 对不含新证据字段的旧版本 fix-report（新判据引入前生成），judge MUST 有明确的向后兼容行为：MUST 按缺证据处理（在 block 档判不合规），且此判定不得因解析异常而崩溃或误伤非 no-op 路径。（EC-004）
- **FR-012** [必须] 改动 `spec-driver-fix/SKILL.md` 后，系统 MUST 通过 `npm run repo:sync` 重生 F213 双写链（`.codex/skills/spec-driver-fix/SKILL.md` 与 `plugins/spec-driver/skills-codex/spec-driver-fix/SKILL.md`）并重算内嵌 `Source SHA256`，`npm run repo:check` / wrapper sha 门禁 MUST 保持绿；MUST NOT 手改生成产物，MUST NOT 触碰 A2 wrapper 生成机制本身。（回归护栏）
- **FR-013** [SHOULD] 系统 SHOULD 提供合成 fixture，基于 F212 已知片段复刻"自信引用行号但零执行痕迹"形态，补入 `plugins/spec-driver/tests/fixtures/fix-compliance/`，作为该失败形态的长期回归锚点（现有 fixture 集缺此形态）。（SC-001）
- **FR-014** [必须] no-op 证据判定 MUST 采用**受控断言模型**而非退出码符号判读：**废弃"退出码 0/非 0 = 绿/红"的机械符号解读**；no-op 放行仅当复现命令为"断言期望行为"形态且得到约定的 PASS 判定；非零退出、超时、字段缺失、工具错误一律判为 `INCONCLUSIVE`（不满足 no-op 证据、block 档阻断），机械上**不宣称**"bug 存在"或"bug 不存在"的事实结论。（US1、US2、EC-002、C2）
- **FR-015** [MAY] 系统 MAY 在反馈文本中给出复现命令的形态示例（如按语言/框架的断言骨架），降低用户补 repro 的门槛。（US1，体验增强，非 MVP 必需）
- **FR-016** [必须] 系统 MUST 定义 `ExecutionRecord` 数据合同，字段至少含：`id`（Bash tool_use.id）、`name`、`command`、定位信息（`tool_use` 行与 `tool_result` 行）、`is_error`、输出摘要。**配对规则** = 主 transcript 中 fix 锚点之后的 Bash `tool_use.id ↔ tool_result.tool_use_id`。**命令对应规则** = 对 fix-report 声称命令与 transcript 记录命令做**保守规范化后精确比对**：仅归一化首尾空白与换行，**不去引号**（引号变化改变 shell 语义，去引号会误判等价）。缺 result / result 报错 / 命令不匹配 / 输出不匹配 MUST 用不同的稳定 missing 枚举区分（见 FR-019）。**注**：现有 transcript 归一化器不保留上述字段，本 feature **含数据模型扩展**（io 归一化层需扩展以保留 ExecutionRecord 字段）。（C1、FR-004）
- **FR-017** [必须] 实现 FR-016 前，MUST 先用**真实 Bash transcript fixture** 锚定退出码 / `is_error` / tool_use / tool_result 的权威字段路径（不同 CLI 版本 transcript schema 可能不一致），以此为准编写解析器，禁止凭假设字段路径实现。（C2、FR-014）
- **FR-018** [必须] 当 fix-report 双锚点同现（`Root Cause` 表格 + `## 判定依据`，现取严为 repair）时，MUST 同时满足 repair 合同**与** no-op 证据合同，堵"加个标题切换分支"的绕门路径。**纯 repair 形态下的零源码改动伪装（声称已修但 patch 无 diff）不在本门覆盖范围**——Stop hook 时点的机械 zero-diff 检测不可靠（提交/暂存状态未知），此项进能力边界声明与 EC-008。（C4）
- **FR-019** [必须] 系统 MUST 定义 canonical missing keys，定稿为 6 键互斥穷尽集合（plan 审查后按 FR-016 逐类区分合同收严）：`noop:repro-fields`（对账行缺失/malformed）/ `noop:repro-command-mismatch`（无任一记录命令匹配，含全无 Bash）/ `noop:repro-result-missing`（有 tool_use 无配对 tool_result）/ `noop:repro-tool-error`（is_error）/ `noop:repro-output-mismatch`（有配对记录但无合法 PASS sentinel）/ `noop:repro-contradiction`（集合内 PASS/FAIL 冲突或声明与记录冲突）。**每个 key MUST 有对应的 MISSING_ACTION_TEXT 反馈映射**（漏配即测试失败——`buildFeedbackText` 会静默过滤未注册 key）；多缺失时 MUST 合并全部列出；降级审计复用 missing[] 结构（不造自由文本字段）。（W10、FR-005、FR-009、FR-016）

---

## 能力边界声明（诚实边界）

本证据门是**结构化 + 主 transcript 执行痕迹配对核验门**，不是事实核验器。它能机械核验：fix-report 是否含逐声明结构化复现字段（形态）；主 transcript 是否存在与所声称命令保守规范化后精确匹配的 Bash `tool_use`/`tool_result` 执行记录（执行确曾发生）；执行是否得到约定 PASS 判定（受控断言模型）。

它**不能**核验：
- 复现命令在**语义上是否真的对应** issue 描述的症状（模型仍可执行一个与真实症状无关、约定必 PASS 的命令来制造合规痕迹）；
- 报告声明的症状集合**是否覆盖** issue 的全部症状（声明集合完整性是语义边界，W5）；
- 复现命令是否**只读无副作用**（SKILL 合同要求复现命令只读、禁改源码/状态，但机械核验副作用超能力边界，W6，见 EC-009）；
- "已修复"因果推理链的事实真实性；退出码不作方向符号判读（FR-014）；
- 纯 repair 形态下的零源码改动伪装（Stop hook 时点 zero-diff 检测不可靠，FR-018，见 EC-008）；
- 非 Bash 工具执行的复现（MVP 不支持，FR-001，见 EC-007）；
- 判定材料不可用（transcript 缺失/超大/损坏）时的残余绕过窗口（fail-open 现状，见下节 Q3）。

本门把 V008 的抗绕过下限从"可被纯文本断言绕过"提升到"必须伪造一次真实且结果自洽、且能与主 transcript 配对的命令执行"，显著抬高绕过成本，但**不声称**杜绝一切绕过。剩余语义核验属 M10 TDD 引擎化范围。此边界须在 plan 与最终制品中保留，禁止 over-claim。

---

## 判定材料不可用时的行为（GATE_DESIGN 待决 Q3）

F208 现状对判定材料异常一律 **fail-open**（放行）：transcript 缺失 / 超大（>20MB）/ 全损坏 / 末行截断 / 坏行静默跳过时，Stop hook 直接 `exit 0`。这与本证据门存在冲突——上述任一情形下证据门实际失效（无从配对执行痕迹即无从判不合规），构成绕过窗口。两个选项供 GATE_DESIGN 拍板：

- **(a) 沿用 fail-open + 能力边界声明残余风险（推荐）**：理由——"Stop hook 不可 brick 会话"是 F208 既定产品约束，fail-closed 会把解析器任何脆弱性变成"卡死用户会话"。残余绕过窗口写入能力边界，接受。
- **(b) no-op 会话受控 fail-closed / 独立证据账本**：仅对 no-op 收口在材料不可用时 fail-closed，或维护独立证据账本绕开主 transcript 依赖。成本：新增材料完整性判定与账本读写；新风险：解析器脆弱性直接转化为会话阻断、与 F208 fail-open 保险语义冲突。

> **✅ GATE_DESIGN Q3 已拍板（2026-07-20）**：采用 **(a) 沿用 fail-open**，残余绕过窗口写入能力边界声明并保留审计可追溯。

---

## Edge Cases

- **EC-001 假证据填充**：fix-report 声称"已执行复现命令"但主 transcript 无对应 Bash 执行痕迹 → 按 FR-004/FR-016 配对核验失败，`noop:repro-command-mismatch` 判不合规、block 档阻断。风险 #1 直接护栏。
- **EC-002 执行了但结果 INCONCLUSIVE**：复现命令确被执行但非零退出/超时/工具错误/输出字段缺失 → 按 FR-014 判 `INCONCLUSIVE`，不满足 no-op 证据、block 档阻断；机械上不宣称 bug 存在或不存在。
- **EC-003 无法构造 repro**：症状因环境依赖缺失无法在当前工作树构造可执行复现 → **GATE_DESIGN Q2 已拍板不开替代证据通道**：此形态 no-op 不成立、按缺证据阻断，反馈提示可转真实修复或补可执行复现。
- **EC-004 旧版本 fix-report 向后兼容**：无新证据字段的旧报告 → 按 FR-011 在 block 档按缺证据判不合规，解析器容错不崩溃、不误伤非 no-op 路径。
- **EC-005 warn 档证据缺失表达**：warn 档 no-op 缺证据 → 按 FR-010 仅 stderr 提示、不阻断不计数（判定逻辑与 block 一致）。
- **EC-006 降级放行时证据缺失审计**：连续无证据 no-op 触发 F208 第 3 次共享预算降级放行 → 按 FR-009 放行但审计事件复用 missing[] 标注"证据缺失降级放行"，可事后追溯。
- **EC-007 非 Bash 工具执行**：复现经非 Bash 工具（如自定义 MCP 工具）执行 → MVP 不支持机械配对，按缺主 transcript Bash 痕迹处理（能力边界，FR-001）。
- **EC-008 纯 repair 形态零源码改动伪装**：仅 `Root Cause` 形态、声称已修但 patch 无实际 diff → 本门不覆盖（Stop hook 时点 zero-diff 检测不可靠，FR-018 / 能力边界）。
- **EC-009 复现命令副作用**：复现命令实际改动了源码/状态（非只读）→ SKILL 合同禁止，但机械核验副作用超能力边界，仅靠合同约束（W6 / 能力边界）。
- **EC-010 判定材料不可用**：transcript 缺失 / >20MB / 全损坏 / 末行截断 / 坏行 → **GATE_DESIGN Q3 已拍板沿用 fail-open 放行**；残余绕过窗口入能力边界声明（见上节）。

---

## Success Criteria

- **SC-001** 基于 F212 已知片段构造的**合成回归**（非原始回放，原始 transcript 已丢失）：同样"看似已修"情形下，无可执行证据的 no-op 被证据门拦下并给出"要求产出 repro"的 next-step；带真实执行证据的 no-op 正常放行。**验证方式**：`fix-compliance-core.test.mjs` / `fix-compliance-judge-cli.test.mjs` 新增单测 + 新合成 fixture（FR-013）。
- **SC-002** 正向路径回归：真 bug 修复流程零新增摩擦，合法 no-op 收口不被误伤。**验证方式**：现有 fix 判定器全套单测全绿 + `compliant-full.jsonl` / `compliant-noop.jsonl`（含新增"诚实执行复现证据"变体）fixture 通过。
- **SC-003a** 确定性同 session 闭环（入门禁）：judge report 模式 + fixture 序列（阻断→补证据→放行）逐步断言退出码与反馈。**验证方式**：`fix-compliance-judge-cli.test.mjs` 新增序列用例，入 `npx vitest run`。
- **SC-003b** 手工 headless 模型 smoke（非门禁）：沿 F208 T029 `spike-fix-compliance-e2e.mjs` 扩展 scenario，真实小样模型（默认 haiku，单次 <$0.05）仅验证 hook 线路与退出码转发。**验证方式**：手工运行，不计入 CI。
- **SC-004** F208 判定合同不回归：off/warn/block 三档、有界降级第 3 次放行、F211 补救清零全部保持既有语义；MUST 覆盖档位切换场景——block→warn→block、block→off→block、warn 下合规清零旧计数。**验证方式**：F208 既有退出码矩阵/有界化/fail-open 单测 + 新增档位切换单测全绿。
- **SC-005** wrapper 同步链保持绿：改 SKILL.md 后 `.codex/skills/` 与 `skills-codex/` 双写重生、`Source SHA256` 重算匹配。**验证方式**：`npm run repo:sync` 后 `npm run repo:check` + `wrapper-sha256.test.ts` 零失败。
- **SC-006** 全量门禁零失败：`npx vitest run` + `npm run build` + `npm run repo:check` 全绿（TDD 先红后绿）。**验证方式**：CI 全量门禁。

---

## Out of Scope

- 真实 V008×N 评测复测（留下一轮评测批，本 feature 只做 fixture 回放，不烧评测钱）。
- M10 TDD 引擎化全量卡（本 feature 仅是其 fix 模式的证据门切片；"复现命令与症状语义是否真相关"的事实核验不在本范围）。
- A2 wrapper 生成机制本身（只按既有链路 `repo:sync` 重生，不改生成器）。
- Codex runtime 的 transcript 消费（真实 Codex rollout 为 `custom_tool_call` 格式、与 Claude envelope 不同构；本期判定合同仅覆盖 Claude Stop-hook transcript，Codex 适配待 M9 A3 hook 接线；本期仅做 schema 差异记录）。
- 评测链 `scripts/eval*`（不触碰）。
- 纯 repair 形态零源码改动检测（EC-008，能力边界外）；复现命令副作用机械核验（EC-009）；非 Bash 工具执行复现（EC-007）。
- 具体客户 / 公司 / 行业绑定信息（通用定位红线，产物一律做通用化抽象）。

---

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：5——(1) SKILL.md no-op 分支合同（逐声明 + 亲执行）、(2) io 归一化层扩展（保留 ExecutionRecord 字段，数据模型扩展）、(3) judge 编排层（no-op 分支路由与反馈拼装）、(4) core 判据层（逐声明配对 + 受控断言 + missing 枚举）、(5) 合成回归 fixture。较初版上调（初版低估了 io 归一化扩展与数据合同）。
- **接口数量**：约 4-6——`ExecutionRecord` 数据合同、`judgeCompliance` no-op 分支扩展、transcript→ExecutionRecord 配对函数、missing key→MISSING_ACTION_TEXT 映射、反馈文本拼装扩展、逐声明解析锚点。
- **依赖新引入数**：0（复用现有 transcript 解析、章节锚点、fixture 测试三层骨架）。
- **跨模块耦合**：中高——SKILL.md（source-of-truth，触发 wrapper 双写链）+ io 归一化 + core 判据三层协同修改，均在 F208 既有链路内。
- **复杂度信号**：命中 1 个——**跨制品一致性 / 交叉核验**（fix-report 逐声明 ↔ 主 transcript 执行记录配对）。无递归、无独立新状态机（复用 F208 blockState）、无并发、无数据迁移（新增字段向后兼容，非破坏性迁移）。
- **总体复杂度**：**MEDIUM-HIGH**。判定依据：组件 5 个（触及 HIGH 阈值 >5 的临界）、接口 4-6 个、1 个复杂度信号；核心风险不在规模而在判据抗绕过强度（风险 #1）、合法 no-op 不误伤（风险 #2）与 io 归一化扩展的向后兼容。建议 GATE_DESIGN 重点审查：Q2（是否开替代证据例外通道）、Q3（判定材料不可用 fail-open vs fail-closed）、以及"证据充分性最小判据"的边界定义。
