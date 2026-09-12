# Phase 5 — spec-review 子代理（第 1 路）：覆盖矩阵 / 类别列 / SC over-claim

角色 prompt：`plugins/spec-driver/agents/spec-review.md`（178 行，已读全文）。本路按其「问题分级标准」（CRITICAL=不通过侧或类别误标；WARNING=判定成立但证据/核验方式不完整；INFO=独立观察项）出具结论。工具预算硬顶 30 次，本报告消耗 25 次（其中 1 次为本文件的落盘写入）。

## 输入与命令

- `specs/277-spec-driver-engine-hardening/plan.md`：`command grep -n "^## FR → Phase 覆盖矩阵\|^## 裁剪登记" plan.md` → 矩阵起 155 行、裁剪登记起 385 行；矩阵以 `sed -n '155,250p'` 分两段取全（FR-001~FR-068，含表头说明与「类别判定依据」表前段 FR-016~FR-045 的逐条理由）。
- `specs/277-spec-driver-engine-hardening/spec.md`：`command grep -n "^- \*\*FR-0" spec.md | wc -l` → **68**；`command grep -n "^## " spec.md` 定位 Success Criteria 区间 512~585 行，`sed -n '512,586p'` 取全（因单次输出超 46KB 被落盘到本地临时文件后用 Read 取回，内容完整）。
- `specs/277-spec-driver-engine-hardening/tasks.md`：`command grep -n "T125\|T126"` 确认交付任务未勾选（Phase E 尚未提交，属预期状态，非缺陷）。
- 类别列抽检的独立代码核验（不采信 plan 自撰理由，逐条重新在源码里找证据）：
  - `command grep -n "verify\.md\|verify\b" scripts/lib/agent-tools-core.mjs`（FR-016）
  - `command grep -rn "agents-byte-budget\|byte-budget" scripts/lib/*.mjs plugins/spec-driver/**/*.mjs`（FR-040）
  - `command grep -n "FR-025\|FR-052\|FR-053" plugins/spec-driver/scripts/validate-gate-mounting.mjs`（FR-025）
  - `command grep -rn "agent-docs:" scripts/ plugins/spec-driver/scripts/` + `sed -n '175,190p;415,445p' scripts/lib/repo-maintenance-core.mjs` + `command grep -n "validateSharedAgentDocsSafely(\|'agent-docs'" scripts/lib/repo-maintenance-core.mjs`（FR-036/014/020/068 的 check id 拼接机制追踪，见下）
  - `ls -la` 确认 6 份关键新制品文件（`validate-gate-mounting.mjs`、`agent-output-discipline.md`、`validate-gate-mounting.test.mjs`、`agent-tools-core.mjs`、`agent-tools-core.test.ts`、`repo-check-agent-docs-fallback.test.ts`）均非空、体量合理。

## A. 矩阵结构核对

**结论：PASS。**

- **行数 == N**：矩阵含 FR-001 至 FR-068 连续无缺号（两段 `sed` 输出手工核对序列完整，重叠行 FR-061 两段一致），共 **68 行**，与 `spec.md` 现取 `N = 68`（命令见上）逐字一致；矩阵表头注释自身也现取同一命令得 68，三方（spec 现算、矩阵行数、表头自证）互相印证。
- **三列非空**：抽查的全部行「类别 / 认领 Phase / 验证点」均非空；约束型行的「认领 Phase」列统一填占位符 `—`（如 FR-016/025/035/037-041/045/049-051/067），符合矩阵表头注释声明的约定。
- **移交行**：`FR-010`～`FR-013` 四行、且恰好四行，认领 Phase 列均填 `移交 F27x`，与用户拍板边界 A（核心 64 / 移交 4）一致；这 4 行的「类别」列仍标『实现型』（移交≠约束型，未被误标进约束型桶）。
- **内部自洽的双重计数核验**：矩阵正文下方「类别判定依据」表标题自称「判为约束型的 13 条」，实际列出的行（FR-016/025/035/037/038/039/040/041/045/049/050/051/067）逐一清点确为 13 条，与矩阵中标『约束型』的行集合完全重合（68 − 13 约束型 − 4 移交 = 51 行以外，另有 1 行 FR-024 为「实现型 · SHOULD」但因未认领而走裁剪，认领 Phase 列填「（未认领⇒裁剪）」，不计入移交也不计入约束型）。三个子集合彼此不重叠、并集覆盖 68 行，结构自洽。

## B. 类别列抽检

**抽检对象**：约束型行总数 13 ≥ 3，按规则抽样（未全核）。实抽 **8 条约束型**（FR-016 / FR-025 / FR-035 / FR-037 / FR-038 / FR-039 / FR-040 / FR-041 / FR-045，共 9 条，超过 ≥5 下限），其中 **FR-016 / FR-025 / FR-040 三条做了独立代码核验（不采信 plan 自撰理由）**，其余 6 条仅复核 plan 自身「类别判定依据」表的论证是否自洽（未逐条重新在源码找反例，超出预算范围，如实登记为未做独立核验）。另抽 **3 条实现型**（FR-017 / FR-036 / FR-052+FR-053）核实其验证点确有落地制品。

### B-1. CRITICAL：FR-016 类别标注与实现代码自身的注释相互矛盾

- 矩阵行：FR-016｜类别=**约束型**｜认领 Phase=`—`｜实现落点=「（无实现落点；护栏对象为 `agents/verify.md:3`，本卡不得改动该行）」。
- plan.md「类别判定依据」表对 FR-016 的论证：「其两项义务分别是『不得为 verify.md 新增任何工具项』（纯禁止）与『协议文本须附诚实口径声明』——后者的承载制品是 FR-014 的协议块（已由 Phase C 认领），**本条自身不新造制品**」。
- 独立代码核验（`command grep -n "verify\.md\|verify\b" scripts/lib/agent-tools-core.mjs`，本卡新建文件）实测输出（节选，行号为原始输出）：
  - `13: *   (ii)  护栏 1：agents/verify.md 的 tools 与冻结快照逐字相等（含顺序）`
  - `14: *   (iii) 文本 1：协议文本对 verify 标注「不适用」且附 FR-016 (ii) 的独立性口径声明`
  - `202:    const id = 'protocol:verify-not-applicable-disclosure';`
  - `203:    const title = '协议文本对 verify 标注「不适用」且附 FR-016 (ii) 独立性口径声明';`
- **该文件是本卡新建的可交付文件**（`git status` 未跟踪新文件；`ls -la` 确认存在，12646 bytes），其内部逻辑（「护栏 1」断言 + `protocol:verify-not-applicable-disclosure` 断言）**在源码注释里直接以「FR-016」「FR-016 (ii)」点名自己在实现什么**。按本子代理角色 prompt（`agents/spec-review.md:68`）的判据原文：「是否存在一份本次要新造或改写的制品来承载它？存在即该 FR 应判实现型——凡『存在承载制品』的条款一律判实现型，哪怕其措辞是禁止式」——本条测试的是「是否存在承载制品」，不是「该制品是否由这条 FR 独占新建」；agent-tools-core.mjs 确实存在、确实新建、确实承载 FR-016 的判定逻辑，三项都成立。plan 用「不新造制品」（着眼于「谁的名义新建了文件」）回避判据本身问的问题（「制品是否存在」），是同一份文件里代码自证与散文判定相互矛盾的实例。
- **数值影响评估（诚实登记，非降级理由）**：重分类预期不翻转 FR-016 的最终 PASS 结论（该护栏断言已随 FR-017 的 8 条断言一起判 PASS，SC-003 = 8÷8 已覆盖它）；需求项 5「完整实现」的结论也不依赖 FR-016 计数（矩阵该行本就注明「FR-016 为约束型，填『—』」，不参与需求项 5 的完整性判定）。但矩阵「约束型 13 条 / 实现型 55 条」的分桶会变为「12 / 56」，SC-013 口径 (a)(b) 的桶归属需要重算并留痕（约束型转实现型后，义务由『已核验未违反』升为『已实现（附证据）』——该证据事实上已具备，预期不影响最终 F=61 的数值，但「预期不影响」是本子代理的推算，不能替代 Phase E 或后续 fix 卡的亲自重算）。
- **判级**：CRITICAL（按规则字面）。**建议处置**：Phase E 或后续卡对 FR-016 的类别判定重新走一遍「类别判定依据」表的论证，若坚持约束型，需正面回应「agent-tools-core.mjs 的护栏 1 为何不算承载制品」而非仅以「本条自身不新造」带过；若改判实现型，需同步重算矩阵计数与 SC-013 相关换算式并留痕（预期数值不变，但必须实证）。

### B-2. 独立核验：FR-025、FR-040 类别标注成立（负面对照，未发现问题）

- **FR-025**（约束型；核验方式引用 FR-053 的 12 条断言）：`command grep -n "FR-025\|FR-052\|FR-053" plugins/spec-driver/scripts/validate-gate-mounting.mjs` 实测只命中 `FR-053`（文件头注释「FR-053 —— repo:check 侧的门挂载与门字段事后守护」）与 `FR-052`（丙，一处设计对照注释），**零命中 FR-025**——与 FR-016 形成鲜明对照：验证脚本自己承认在实现 FR-052/FR-053，从未自称在实现 FR-025。plan 的论证（「其机械落点 FR-052/FR-053 各自是独立的实现型条款，本条不重复承载」）与代码自证一致，类别标注成立。
- **FR-040**（约束型；核验方式引用 `worktree-local-state:agents-byte-budget`）：`command grep -rn "agents-byte-budget|byte-budget"` 定位到 `scripts/lib/worktree-local-state-core.mjs:338/357`——**该文件不在本卡改动文件集内**（不在 git status 的 M/??清单中，`sed -n '320,365p'` 确认其 `AGENTS_CANDIDATES` 逻辑与本卡 FR-036 的新 entry 无关联，纯粹复用既有基础设施）。plan 自身在 SC-007 里也如实写明「本卡对该预算的影响按定义为 0……本条在本卡上是空载达成」——代码证据、plan 陈述、矩阵类别三者一致，类别标注成立。

### B-3. 仅复核 plan 自身论证、未做独立代码反证的 6 条（FR-035/037/038/039/041/045）

plan「类别判定依据」表对这 6 条的论证模式一致：均主张「无制品，裁剪即等于允许违反宪法条款」，且核验方式栏写的是一次性 `grep` 人工核对而非持久化守护脚本。逐条论证内部自洽、未发现与 FR-016 同类的「代码自称在实现某约束型 FR」矛盾。**如实登记本轮未做的部分**：未对 `validate-gate-mounting.mjs` 是否真的从 `GATE_DESIGN.hard_gate_modes` 派生强制 mode 清单（而非硬编码字面量，FR-038 的具体要求）做独立 grep 核验，超出本轮预算，建议 Phase E 另立检查点核实。

### B-4. 实现型验证点抽检（3 条，均 PASS）

- **FR-017**：`scripts/lib/agent-tools-core.mjs`（12646 bytes）+ `tests/unit/agent-tools-core.test.ts`（22421 bytes）均存在且非空；`repo-maintenance-core.mjs:429-434` 确认 `aggregateValidation('agent-tools', validateAgentTools(...))` 已接线。
- **FR-052/FR-053**：`plugins/spec-driver/scripts/validate-gate-mounting.mjs`（15761 bytes，文件头注释自称「FR-053」）+ `plugins/spec-driver/tests/validate-gate-mounting.test.mjs`（25214 bytes）均存在；`repo-maintenance-core.mjs:438-444` 确认 `aggregateValidation('gate-mounting', await validateGateMounting(...))` 已接线（且有 `await` 遗漏会导致静默假通过的显式注释警示）。
- **FR-036**：追踪 check id 拼接链路以核实 SC-006「`agent-docs:shared-section:*` 四个新 check id」的可信度——`scripts/sync-agent-docs.mjs:308` 内部 check id 为 `` `shared-section:${section.key}` ``（不含 `agent-docs:` 前缀）；`repo-maintenance-core.mjs:297-299` 以 `aggregateValidation('agent-docs', validateSharedAgentDocsSafely(resolvedRoot), ...)` 调用，`aggregateValidation`（`repo-maintenance-core.mjs:177-186`）对每条 check 执行 `namespaceCheck(prefix, check)` 做前缀拼接。**两段拼起来，最终 check id 确为 `agent-docs:shared-section:<section.key>`**，与 plan 矩阵和 SC-006 的表述逐字一致——本条最初怀疑是「前缀只存在于注释、代码里缺失」的假警报，追到 `aggregateValidation` 调用点后确认拼接链完整，判 PASS（过程记录以警示后续审查者：**仅在单个文件内 grep 一个字符串不足以下结论，必须追踪到最终拼接/消费点**）。

## C. 裁剪登记与移交行

**结论：PASS。**

- **MUST 裁剪 = 0 条**：`裁剪登记` 章节顶部换算式「已裁剪的 MUST 项数 ÷ FR-060 上限 K = 0 ÷ 3 = 0%」，且显式要求 `GATE_TASKS` 接受点须记「本次无 MUST 裁剪，接受点未触发」而非「已接受」——矩阵中未见任何『实现型』MUST 行的认领 Phase 写作裁剪（唯一裁剪项 FR-024 明确标注为 `SHOULD · [可选]`）。
- **SHOULD 裁剪 = 1 条（FR-024）**：矩阵行「FR-024｜实现型 · SHOULD [可选]｜认领 Phase=（未认领⇒裁剪）」与「裁剪登记」章节「一、[可选]项逐条处置」表 #1 FR-024=裁剪，两处口径一致；该表同时列 #2 FR-019=**实现**（非裁剪），矩阵对应行认领 Phase=**C**，两处同样一致，未见「一边写裁剪一边写实现」的口径分裂。
- **GATE_TASKS 接受点留痕**：裁剪登记章节第四节显式登记「MUST 裁剪 0 条 + MUST 移交 4 条」为诚实口径，并警告「把裁剪登记只有 1 条且是可选项口径为『本卡 MUST 全交付』即为 over-claim」——该自我提醒本身即是良好实践,未发现与之矛盾的下游转述。
- **移交 4 行口径一致性**：裁剪登记章节「两条准入口径」第 2 条明写「FR-010~FR-013 不在本登记内……凡把这 4 条写进本章节即为口径失真」；矩阵中这 4 行确实不在裁剪登记章节的任何表格内，而是各自标「移交 F27x」，spec.md 与 plan.md 两处对这 4 条的表述均未见「已覆盖」字样（均使用「移交」「未完成态」用语）。口径一致，未发现失真。

## D. SC over-claim 核对

**方法**：spec.md 的 Success Criteria 区段（512~585 行）**实测只有 SC-001 至 SC-014 共 14 条**（`grep`/`sed` 全文核对，非抽样）——**与本轮任务简报所称「16 条 SC」不符**，登记为 INFO（简报转述误差，非 spec 缺陷；spec.md 自身章节内未见「16」这一计数声明）。

逐条通读（不重复已知并已登记的缺口——D-6/D-7/D-8 未达成、D-5 部分、AGENTS.md 非空载 +704 bytes 均已按简报口径登记在 `verification/e-timing-paradox-appendix.md`，此处不重复标记）：

- **正面发现**：spec.md 本身在 SC-006 / SC-007 / SC-010 / SC-013 上的自我防范措辞异常详尽——每条都预先声明「这不构成对 XX 的证据」「上界不是实测值」「引用时须区分两个量」，并在章节末「本节明确不测量什么（防 over-claim）」单列 5 条免责声明（含「不承诺保证消费面无遗漏」「不承诺杜绝 over-claim」「不构成 verify 独立性的取得」等）。这是良好实践，登记为 INFO，供后续 Feature 的 spec 撰写参考。
- **SC-006 check id 拼接链路**：见 B-4，追踪到 `aggregateValidation` 与 `namespaceCheck` 后确认 `agent-docs:shared-section:*` 四个 check id 的拼接机制真实存在，SC-006 关于这 4 个 id 的描述有命令与代码路径支撑，非空谈。**未独立复算 SC-006 的最终分母 88→94（`npm run repo:check | grep -c '^- '`）**——该命令预计耗时较长且输出巨大，超出本轮预算，如实登记为未执行，建议 Phase E 亲自重跑并核对。
- **SC-013 关联风险（WARNING，见下）**：B-1 的 FR-016 类别误标若成立，SC-013 口径 (a)(b) 的桶归属（约束型「已核验未违反」桶 vs 实现型「已实现（附证据）」桶）需要重算；本子代理评估预期最终数字（M=7、F=61）不变，但这是推算而非 plan/verify 亲自重算的结果，不能视为已核验。
- **FR-038 核验方式偏薄弱（WARNING）**：约束型 FR 的核验方式栏要求「须附产生该结论的命令原文与其原始输出」，但 FR-038（「新增脚本不得内嵌 phase 序列/mode 定义/gate 策略/prompt 模板文本」，核验方式含「须从 `GATE_DESIGN.hard_gate_modes` 派生而非硬编码」）在 plan 正文里的核验方式是叙述性人工核对，未见一条可直接复制运行、能机械验证「派生而非硬编码」这一具体断言的命令。本轮也未独立补做（见 B-3），如实登记为该条目自身证据强度不足，非本子代理已证伪。
- **未发现的类别**：未发现「只有结论数字、无换算式或计数单位」的 SC 条目（每条均按 FR-031 自身要求写了换算式+单位）；未发现与 Phase E 严格口径直接矛盾、且尚未登记的新增缺口。

## E. 三档结论

- **CRITICAL：1 个**
  1. FR-016 类别列可能误标（矩阵标约束型，`scripts/lib/agent-tools-core.mjs:13-14,202-203` 的护栏断言自称在实现「FR-016 (ii)」）——见 B-1。数值影响评估为低（预期不翻转任何最终结论），但按 spec-review.md 的判据字面（`agents/spec-review.md:158`：「类别列取值抽检」判出类别误标即 CRITICAL，无数值影响的例外条款），如实按字面报告，处置权交编排器/用户。
- **WARNING：2 个**
  1. SC-013 口径 (a)(b) 的桶归属因 FR-016 潜在重分类而需要重算留痕，本子代理的「预期数值不变」是推算非实证——见 D。
  2. FR-038 的核验方式在 plan 正文中是人工叙述而非可复制运行的命令，证据强度不足以支撑「已核验未违反」的严格判定——见 D。
- **INFO：3 个**
  1. Success Criteria 实测 14 条（SC-001~SC-014），与本轮任务简报所称「16 条」不符，简报转述误差非 spec 缺陷。
  2. spec.md 的 over-claim 自我防范措辞（SC-006/007/010/013 及章节末 5 条免责声明）质量突出，值得作为后续 Feature 撰写参考记录。
  3. 6 条约束型 FR（FR-035/037/038/039/041/045）的类别判定本轮仅复核 plan 自撰论证的内部自洽性，未逐条做独立代码反证（预算所限），如实登记为抽检深度的边界，不构成「已核验通过」的满格证据。

## F. 总判定

**NEEDS_FIX**（因 1 项 CRITICAL 存在）。

范围限定：本判定仅覆盖本路审查对象（FR→Phase 覆盖矩阵结构、类别列抽检、裁剪登记/移交行、SC over-claim），不代表 Phase 5 全部审查路线的总裁决——需与其余并行审查路线（逐条 FR 状态判定、代码实现质量等）的结论合并后由编排器给出整体结论。核心待办：FR-016 类别归属需 Phase E 或后续 fix 卡正面重新论证或改判并重算 SC-013 相关换算式；其余发现均为登记性质，不构成阻断交付的独立理由。
