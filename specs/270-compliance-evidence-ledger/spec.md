# Feature Specification: fix-compliance 门禁证据源换代（会话证据账本）

**Feature Branch**: `claude/compliance-evidence-ledger-0f0e5e`
**Feature ID**: F270（M10 卡面 P0-A）
**Created**: 2026-08-31
**Status**: Revised after adversarial review (GATE_DESIGN passed with user ruling D-1=方向X, D-2=story)
**Revision note**: 三路异构对抗审查（22C/21W）后按处置文档 §3 清单修订；修订由主编排器 inline 执行 `[DEGRADED: inline-execution — specify 修订 — 3 次子代理均死于 API 错误（宿主休眠 ×1 / 连接中断 ×2），零产出，error 证据在案]`
**Input**: 把 fix-compliance 门禁的证据源从「官方明言会异步滞后的 transcript」换成「PostToolUse hook 侧实时写入的会话证据账本」，并用 harness 原生的 `background_tasks` 字段判「在途」，取代现有基于次数预算（`IN_FLIGHT_DEFER_LIMIT` / `BLOCK_LIMIT`）的猜测式有界放行。

## 0. 事实源与前提登记

本规范的所有 harness 行为类断言均以下列事实源为准，**不得以文档推断或历史卡面记载替代**（F264 教训）：

| 编号 | 事实源 | 角色 |
|---|---|---|
| S-1 | `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-A、§2 裁决 4/5、§9 交付纪律 | 卡面 SSoT：病根 i–v、方向、必答①–⑤、护栏 |
| S-2 | `research/harness-field-probe.md` | 本机活体探针 + 二进制反查实测报告，约束 **C-1..C-13**、陷阱 **T-1/T-2**、直证 **P-1..P-5**、二进制 **B-1..B-4** |
| S-3 | `research/pre-change-baseline.md` | 开工前基线：测试数、`judge:doctor` **既有 drift**、两个生效时点 |

**卡面被实测修正的两处**，本规范一律以 S-2 为准：

1. 卡面「方向」写的账本条目形状 `{tool_use_id, tool_name, tool_input 摘要, ts}` 中的 **`ts` 并不存在于 PostToolUse payload**（S-2 §1.3 / C-1）。时间戳必须由 hook 进程侧自打，语义是「hook 执行时刻」，与工具实际调用时刻存在不可消除的偏差。
2. 卡面病根 v 把状态竞态归因于「Codex 双注册」。实测（S-2 P-5 / C-13）表明**更普遍的并发源在单个 Claude 会话内部**（主线程 + 多子代理，实测交错 13 次、跨主/子最小相邻间隔 554ms），与 Codex 是否双注册无关。本规范不把竞态处置写成「Codex 特有场景」。

**继承的 PENDING 项**（S-2 §3.3，回填前不得当作既成事实）：

- ~~**PENDING-1**：真实 Stop payload 样本尚未取得~~ → ✅ **已回填**（S-2 §3.13 P-12，2026-08-31）：外推被证实，全部字段与推断一致。
- **PENDING-2**：`toolUseContext` 缺席（→ `background_tasks` 与 `session_crons` 两键整体消失）的真实触发条件未观测到。设计按「可能发生」处理（C-2 三态）。

**开工前既有状态**（S-3，验收时不得计入本次引入）：`npm run test:plugins` = 1585 tests / 0 fail / 2 skipped（含结构性 skip）；`repo:check` 带 1 个预存 `graph-quality` stale warning；**`npm run judge:doctor` 当前即为 `drift`**（4 mismatch + `is-invoked-directly.mjs` missingInSnapshot，快照版本 4.4.0）。

## 待解决的问题（病根）

来自卡面 S-1 §4 P0-A，本规范逐条对应：

| 病根 | 描述 | 本规范对应 |
|---|---|---|
| i | transcript 陈旧（官方明言异步滞后，Stop 时缺当前轮是结构性常态）→ 每会话 2 次假 block 后 `releaseDegraded` 恒放行 | US1 / FR-001..FR-012 |
| ii | 子代理默认后台 → 每次委派触发 Stop，`IN_FLIGHT_DEFER_LIMIT=3` 在 diagnose→plan→fix→verify 四次委派即耗尽 | US2 / FR-013..FR-021 |
| iii | GATE 暂停等用户拍板被当收口尝试误阻断，烧光 `BLOCK_LIMIT` 后人工门禁被绕过 | US3 / FR-026..FR-029 |
| iv | `isFix` 取**最晚任意** `spec-driver-*` 展开——会话尾部展开 sync/doc 即整体跳过判定且零落盘（绕过面） | US3 / FR-022..FR-025 |
| v | block/defer 状态 `load→modify→save` 无锁整体覆写，并发互相覆写 | US1 / FR-010..FR-012 |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 会话证据账本实时采集（Priority: P1）

作为使用 Spec Driver fix 流程的开发者，我希望门禁判定依据的是**本会话此刻真实发生过的工具调用**，而不是一份 harness 承诺会异步滞后、Stop 时常常缺当前轮的 transcript 快照。为此，每次工具调用后由一个独立的采集器把该次调用的结构化摘要实时追加到会话证据账本；会话结束时门禁在**委派证据**维度读账本（D-1 裁决：账本承担委派证据与在途判定；锚点、见证、执行记录仍走 transcript——职责切分见附录 A-6 修正 1）。

**Why this priority**：这是整张卡的地基。病根 i 与 v 直接由它解决，US2/US3/US4 的判定都建立在「有一份不滞后的证据」之上。没有 US1，其余改动仍在旧抽象上打第十个补丁（S-1 §2 裁决 4）。

**Independent Test**：单独实现 US1 即可交付价值——在真实会话中触发若干工具调用，检查账本文件按调用逐条出现、条目可被独立解析、包含本轮 `prompt_id` 与工具标识；同时验证账本采集失败时会话不受任何影响（恒 `exit 0`、无 blocking error 注入）。

**Acceptance Scenarios**：

1. **Given** 账本采集器已注册且会话正常运行，**When** 主线程连续调用 `Write` 与 `Bash`，**Then** 账本按调用顺序新增两条可解析条目，各自携带 `tool_use_id`、`tool_name`、`tool_input` 摘要、`prompt_id`、hook 侧时间戳。
2. **Given** 主线程同时派出 2 个子代理且三方工具调用交错发生，**When** 会话结束读取账本，**Then** 所有条目均完整无截断、无相互覆写，且子代理条目带 `agent_id`、主线程条目**不含** `agent_id` 键。
3. **Given** 账本目录不可写（磁盘只读 / 权限拒绝），**When** 任意工具被调用，**Then** 采集器静默降级并以 `exit 0` 结束，agent 上下文**不出现**任何 `hook blocking error` 文本（C-10 / P-4）。
4. **Given** 账本对本次会话完全缺失，**When** Stop 触发判定，**Then** 判定结果与本需求变更前的行为等价（不得因「账本空」而恒阻断，Constitution 原则 XIII）。
5. **Given** 账本中存在一条被截断的残缺记录，**When** Stop 读取账本，**Then** 该条被跳过、其余条目照常消费，并落 `ledger-entry-corrupt` 诊断码。

---

### User Story 2 - 在途判定改用 harness 原生三态（Priority: P1）

作为在一次 fix 流程中会连续派发 diagnose / plan / implement / verify 四个以上子代理的开发者，我希望门禁能准确知道「此刻确实还有后台任务在跑」，而不是靠一个写死的次数预算猜测；预算耗尽后门禁不应因为"猜不动了"而降级放行或误阻断。

**Why this priority**：病根 ii 的结构性解法。`background_tasks` 是 harness 权威语义（S-2 B-3：只收录 `status ∈ {running, pending}` 且未被前台化的条目 ⟹ **数组非空 ⟺ 存在真实在途后台任务**），可直接取代 `IN_FLIGHT_DEFER_LIMIT` 的猜测。与 US1 独立：即使账本未落地，在途判定改造本身也能消除四次委派即耗尽的失效。

**Independent Test**：构造三类 Stop payload（`background_tasks` 非空 / 存在且为空数组 / 键整体缺席），分别驱动判定器，断言三种不同的判定分支与诊断码，且第三态不与前两态坍缩。

**Acceptance Scenarios**：

1. **Given** Stop payload 的 `background_tasks` 为非空数组，**When** 判定器判在途，**Then** 判为 `in-flight`，输出人类可读诊断说明「在等什么」，**不消耗阻断预算 `blockCount`**，但**照常消耗在途推迟预算**（in-flight 态可用放宽阈值，但推迟仍有界——delta 复审 C-2）。
2. **Given** `background_tasks` 存在且为 `[]`，**When** 判定器判在途，**Then** 判为 `no-in-flight`，按正常收口判据裁决，不推迟。
3. **Given** payload 中 `background_tasks` 与 `session_crons` 两键**整体缺席**，**When** 判定器判在途，**Then** 判为 `undetermined` 并落独立诊断码，**不得**当作 `no-in-flight` 处理（否则恢复成误 block，即要修的病根本身）。
4. **Given** 一次 fix 流程连续派发 5 个以上子代理，**When** 每次委派触发 Stop，**Then** 每次都能正确识别在途，**不出现**「第 4 次起预算耗尽」的行为翻转。
5. **Given** `background_tasks` 条目的 `type` 取值为规范未收录的字符串（含空格，如 `"MCP task"`），**When** 判定器生成诊断，**Then** 该值仅出现在人类可读文案中、判定结论不因其取值改变（C-8 / T-1）。

---

### User Story 3 - 锚点与 GATE 暂停语义修正（Priority: P1）

作为流程使用者，我希望：(a) 会话尾部展开一次 `spec-driver-sync` 或 `-doc` 不会让整个 fix 判定被跳过；(b) 流程停在 GATE 等我拍板时，门禁能识别这是「等待用户」而不是「一次失败的收口尝试」，从而不消耗阻断预算、不把人工门禁挤掉。

**Why this priority**：病根 iii 与 iv。iv 是**主动可触发的绕过面**（展开另一个 mode 即整体跳过判定且零落盘），属安全性质；iii 会导致人工门禁被自身机制废掉。二者都与证据源无关、可独立验证，故与 US1/US2 并列 P1。

**Independent Test**：iv 用「同一会话内先展开 fix、后展开 sync」的语料驱动判定器，断言仍按 fix 判定；iii 用处于 GATE 暂停态的会话语料驱动，断言判为「等待用户」且预算与阻断计数不变。

**Acceptance Scenarios**：

1. **Given** 会话内先展开 `spec-driver-fix`、随后展开 `spec-driver-sync`，**When** Stop 判定，**Then** 判定器仍按 fix 模式执行完整判定（不跳过、不静默放行）。
2. **Given** 会话内仅展开过非 fix 的 `spec-driver-*` 模式，**When** Stop 判定，**Then** 判定器按非 fix 处理并如实落盘该判断依据。
3. **Given** 同一会话内出现多次 fix 展开，**When** 判定器确定锚点，**Then** 取**最晚一次 fix 展开**作为判定锚点（卡面 FR-007 口径），而非最晚一次任意展开。
4. **Given** 流程当前处于 GATE 暂停（等待用户拍板），**When** Stop 触发，**Then** 判定为「等待用户」，落专属诊断码，**不消耗**阻断预算、**不**按不合规裁决走 warn/block。
5. **Given** 用户拍板后流程继续并真实收口，**When** Stop 再次触发，**Then** 判定按正常收口判据裁决，且此前的 GATE 暂停未污染任何计数。

---

### User Story 4 - 陈旧交叉校验与诊断码分家（Priority: P2）

作为排查门禁误判的维护者，我希望判定器能区分三件本质不同的事：「证据缺失」「取到了证据但判定为陈旧」「根本无法交叉校验」。当前它们混在同一批诊断码里，导致每次误判都要重新做一遍取证。

**Why this priority**：诊断质量而非门禁正确性，故 P2。但它是 US1/US2 落地后可观测性的必要补充，也是 Constitution 原则 IV（诚实标注不确定性）的直接体现。

**Independent Test**：构造 `last_assistant_message` 三态语料（缺席 / 存在且与账本一致 / 存在且判定陈旧），断言产生三种不同诊断码，`snapshot-stale` 专码只在第三种出现。

**Acceptance Scenarios**：

1. **Given** payload 含 `last_assistant_message` 且与 transcript 尾部/账本对照判定为陈旧，**When** 判定器输出诊断，**Then** 落 `snapshot-stale` 专码。
2. **Given** payload **不含** `last_assistant_message` 键，**When** 判定器输出诊断，**Then** 落一个**区别于** `snapshot-stale` 的「无法交叉校验」诊断码（C-3），不得把「探测不到」说成「探测到陈旧」。
3. **Given** transcript 与账本对**委派证据**给出不一致的记载，**When** 判定器裁决，**Then** 按 FR-008 修订版处理——transcript 尾部缺证方向以账本为准；账本有而 transcript 完整区段无 ⟹ 落矛盾诊断码并取更严一侧——且诊断中如实登记该不一致。（🔴 原文「以账本为主、transcript 次级」已随 FR-008 的 D-1 改写同步修正）

---

### User Story 5 - 真实会话录制 fixture 作为主验收语料（Priority: P2）

作为审查者，我希望本次门禁改动的关键验收跑在**真实录制的会话语料**上，而不是继续在 49 份里 46 份手工合成、字段残缺（无 uuid/timestamp/parentUuid、伪造 skill 路径）的 fixture 上自证。

**Why this priority**：卡面必答④。它决定了本次改动的证据强度：手工合成语料无法暴露 harness 真实字段的缺席/形状问题，而这正是本卡全部病根所在。列 P2 因为它服务于验收而非功能本身。

**Independent Test**：新增录制语料入库后，指定的一组 acceptance 在该语料上独立跑通，并能在移除合成语料的情况下仍覆盖三态在途判定与账本消费主路径。

**Acceptance Scenarios**：

1. **Given** 一次真实的 Claude Code 会话，**When** 录制归档，**Then** 产出的 fixture 同时包含 PostToolUse 账本条目序列与 Stop payload 全字段（含 `stop_hook_active`、`background_tasks`、`session_crons`、`last_assistant_message` 的真实取值或真实缺席）。
2. **Given** 录制语料含真实路径、真实 session/prompt 标识，**When** 入库前脱敏，**Then** 按现有 `tests/fixtures/fix-compliance/README` 的脱敏规则处理，且脱敏后仍保留字段**存在性与形状**（缺席仍缺席、空数组仍为空数组）。
3. **Given** 主验收语料已入库，**When** 跑验收，**Then** 三态在途判定、账本条目消费、`stop_hook_active` 重入防护三组 acceptance 至少各有一条跑在该真实语料上。

---

### User Story 6 - 长异步验证的 PENDING 语义成文（Priority: P3）

作为需要等待真实 CI（30 分钟以上）才能完成验收的开发者，我希望「报告先落盘 + 真实验收节标 PENDING + 完成后回填」这一 F269 现场发明的做法被写成规范并被判定器显式支持，避免未来门禁严格化后把长异步流程直接卡死。

**Why this priority**：卡面必答⑤。它是防御性条款——当前不成文时靠人现场发明，一旦 US1–US3 让门禁变严，长异步流会第一个撞墙。列 P3 因为它不改变当前判定结果，只是把既有惯例固化。

**Independent Test**：构造一份含 PENDING 标记的 verification-report，分别在「PENDING 项有明确回填条件与责任人」与「PENDING 项为无条件占位」两种形态下驱动判定器，断言前者算合规、后者不算。

**Acceptance Scenarios**：

1. **Given** verification-report 已落盘且某验收节标注 PENDING 并写明回填触发条件，**When** Stop 判定，**Then** 判为合规（长异步在途属预期形态），并在诊断中登记存在未回填项。
2. **Given** verification-report 的 PENDING 项没有任何回填条件说明，**When** Stop 判定，**Then** **不**判为合规（PENDING 不得作为逃逸口）。
3. **Given** PENDING 项已回填为真实结论，**When** Stop 再次判定，**Then** 按回填后的实际结论裁决，且不因历史上曾标 PENDING 而降级。

---

### Edge Cases

以下逐条来自 S-2 实测，**全部必须有对应 acceptance**：

**在途判定（C-2）**
- `background_tasks` / `session_crons` **键整体缺席**（`toolUseContext` 为空时两者同生共死）vs **存在且为空数组** —— 两态**不得坍缩**，须映射到 `undetermined` 与 `no-in-flight` 两个不同结论与诊断码。
- `background_tasks` 条目的 `type` 是**展示别名**（`subagent` / `shell` / `"MCP task"` 含空格），来自二进制内部映射表，随时可能改 —— 不可承重，仅进人类可读诊断，且须容忍未知值（C-8 / T-1）。
- 判定器若未来增挂或改挂到 **SubagentStop**，`background_tasks` **包含触发它的子代理自身**（实测条目 `id` == payload `agent_id`、`status:"running"`）—— 必须按 `agent_id` 剔除自身，否则恒判在途 → 恒推迟 → 门禁静默失效（C-9 / T-2）。本规范将其登记为已知边界，防止后人扩展踩中。

**账本采集（C-1 / C-10 / C-12 / C-13）**
- 账本条目**无 harness 时间戳**（payload 里 `/time|ts|date|stamp/i` 零命中）—— 须 hook 侧自打，语义显式声明为「hook 执行时刻」。
- 账本 hook **必须恒 `exit 0`**：实测 PostToolUse 返回非零**不阻断工具**（PostToolUse 发生在工具执行之后，无法回滚），但会向 agent 注入 `hook blocking error` 反馈 —— 一个坏掉的账本会把整个会话上下文淹没，且这是被判方可观测、可被诱导触发的噪声通道（C-10 / P-4）。
- **多进程并发追加**：hook 每次触发都是独立 OS 进程；主线程内部工具串行，但主线程 ↔ 子代理、子代理 ↔ 子代理天然并发（实测交错 13 次、最小间隔 554ms）。账本须**单条一次写完 + `O_APPEND`**，或每条一文件；**绝不可**「读全量 → 改 → 整体覆写」（那正是现有 `tryWriteState` 的模式、也正是病根 v）（C-13 / P-5）。
- 账本文件**损坏 / 部分写入 / 体积膨胀** —— 残缺条目跳过并落诊断码；体积须有上限与超限时的诚实降级（不得静默截断后当完整证据用）。
- **Codex 方言**：Codex 原生读插件 `hooks/hooks.json`，新增的 PostToolUse handler 也会在 Codex 侧注册，但其 PostToolUse payload 形状与 Claude 不同 —— 采集脚本须对未知形状容错并静默跳过（与 C-10 合流）；Codex 会话的 Stop 仍走方言 `indeterminate` 语义（C-12）。

**证据归属（C-4）**
- 主线程 vs 子代理：`agent_id` **字段缺席即主线程**，这是**结构性**判据而非启发式（实测主线程调用时该键整体缺席，不是 `null`、不是空串）。
- `prompt_id` 在主线程与其派出的子代理之间**共享同值**，可作「本轮」的分组键（harness 原生，强于「最晚一次 fix 展开」的文本锚）。

**交叉校验（C-3）**
- `last_assistant_message` **缺席**（无 assistant 消息时键被 JSON 丢弃）vs **取到且判定陈旧** —— 须不同诊断码；`snapshot-stale` 专码只用于后者。

**生效时点（C-7 / S-3）**
- `.claude/settings.local.json` 的 hooks 段**热加载**（注入后下一次工具调用即生效）；插件 `hooks/hooks.json` + `scripts/**` 走**已安装快照、不热加载**。本机自验必须显式区分「用 settings.local.json 临时挂载验证逻辑正确性」与「插件分发路径的真实生效」，**不得用前者的绿冒充后者**（否则复刻 F236）。

## 必答裁决 *(mandatory，卡面 spec 阶段必答①–⑤)*

### 必答① 账本威胁模型

**被判方与采集器的关系**。账本由 PostToolUse hook 进程写入，该进程与被判方（Claude 会话中的 agent）是**不同的 OS 进程**，agent 无法直接干预其写入路径。但被判方拥有 `Bash` 与文件写工具，**具备直接读写账本文件的能力**；且实测（C-10 / P-4）表明 hook 的 stderr **会进入被判方上下文**，被判方能观察到采集器的存在、位置与失败行为。

> **因此本规范明确否定任何"隐蔽性"假设**：不得把"被判方不知道有账本"当作防御的一部分。

**三层可达的防御，以及各自能挡什么**：

| 层 | 机制 | 能挡 | 挡不住 |
|---|---|---|---|
| L1 | **hook 进程独立写入** | 正常流程下证据不经被判方之手产生；被判方"什么都不做"即被如实记录 | 被判方事后主动改写账本文件 |
| L2 | **结构与序列校验**（条目 schema、`tool_use_id` 唯一性、hook 侧时间戳单调性、`prompt_id` 分组一致性） | 粗糙的手工伪造与拼接：schema 不合、id 重复、时间戳倒挂、`prompt_id` 与本轮不符者被判残缺并落诊断码 | 严格按 schema 构造、时间戳与 id 自洽的**精心伪造** |
| L3 | **与 harness 字段交叉**（Stop payload 的 `background_tasks` / `last_assistant_message` / `stop_hook_active` / `prompt_id` 等被判方**不能改写**的字段与账本对照） | 账本与 harness 事实矛盾的伪造（如账本声称无在途但 `background_tasks` 非空） | harness 字段本身不覆盖的事实（如"某次 Edit 到底改了什么"），交叉只能证伪不能证实 |

**诚实结论（不得 over-claim）**：本机制**只防"疏忽不合规"，不防"蓄意伪造"**。一个明确意图绕过门禁的 agent，具备写入账本文件的能力，可以构造出通过 L2 且不与 L3 冲突的伪造证据。

**推论（写入产品定位）**：fix-compliance 门禁的定位是**「防流程走漏」**——防止正常工作的 agent 因遗忘、上下文丢失、异步滞后而漏掉收口步骤；**不是「对抗恶意 agent」**的安全边界。任何以本门禁作为安全控制的下游主张都属 over-claim。相应地，本次改动**不引入**加密签名、只读挂载、外部可信存储等对抗蓄意伪造的机制——它们与门禁定位不匹配，且会大幅抬高复杂度与运行时依赖（违反 Constitution 原则 X）。

**残余风险登记**：被判方可删除或清空账本文件。此时行为退化为「账本缺席」，按 FR-009 走与变更前等价的回退路径（**不是恒阻断**），即攻击者可通过删账本把门禁退回改动前的强度——**不会比现状更弱，但也不会更强**。此为本设计已知且接受的边界。

### 必答② 与 F227 候选历史 / F257 三道闸门的关系（保留 / 改造 / 废除表）

**裁决总原则**：账本是**新增的主证据源**，不是磁盘与 transcript 证据的替代品。凡在「账本缺席 / 残缺 / `undetermined`」时仍需要给出判定的路径，其既有兜底**一律保留**（Constitution 原则 XIII）。只有当某机制的存在理由是「猜测在途/陈旧」，而该猜测已被 harness 权威字段取代时，才废除。

| # | 机制 | 现状位置 | 裁决 | 理由 / 账本缺席时的回退路径 |
|---|---|---|---|---|
| 1 | **F227 候选目录历史倒序遍历**（`resolveFeatureDirCandidate` + `usable(dir)` 谓词 + `ambiguous===false` 守卫下的倒序遍历） | core `:1344`；judge `:262/:268/:269-275` | **保留（不改判据）** | 它解决的是「特性目录被幽灵覆写后终态存在性≠历史事件」，与证据源新旧无关。账本不记录目录解析历史，无法取代。F227 的 `ambiguous===false` 守卫不可删（历史结论）。 |
| 2 | **F256 短名磁盘重枚举第二层兜底**（`listFeatureDirCandidatesByShortName` + `.filter(usable)` 取末项） | judge `:371-393`；io `:212` | **保留（不改判据）** | 它是对「重编号走复合命令导致 F231 光杆白名单不跟随」的磁盘侧兜底，属目录解析面而非证据时效面。账本同样不覆盖。 |
| 3 | **F257 写入见证**（`collectArtifactWriteWitnessDirs`，工具白名单 `{Write,Edit}` + 要求成功回执；未命中落 `feature-dir-witness-absent`） | judge `:375-379`；core `:1019-1054/:891` | 🔴 **保留（不迁账本，D-1 裁决）** | ~~改造（主源换代，判据不变）~~ ← **该裁决被对抗审查证伪后经用户拍板撤销**：见证的安全下界是 **harness 成功回执**（core `:885-893`「要拿到成功回执就必须真的写了那份制品——伪造证据与满足合同同价」），而账本 schema（FR-002）无 `tool_response`；PostToolUse 在工具执行后触发，**失败的 Write 同样产出账本条目**——迁账本即把下界从「真的写成功过」废除为「发起过一次调用」（审查 C-C3，可直达 F257 第 3 轮红队实跑的零审计 fail-open 链）。见证继续走 transcript，判据与诊断码原样不动。 |
| 4 | **F257 闸门一：可推迟性白名单**（`isDeferrableMissingSet` + `DEFERRABLE_MISSING_KEYS` = `delegation:implement` / `delegation:verify` / `delegation:noop-verify` / `verification-report.md`） | judge `:759`；core `:854-876` | **保留** | 它回答的是「哪些缺失项在语义上允许推迟」，是**语义**判据，与在途探测手段正交。`background_tasks` 只能说"有东西在跑"，不能说"跑的正是这个缺失项"。废除它会把任何在途都变成万能推迟理由。必答⑤的 PENDING 语义在此闸门内扩展（见 FR-030..FR-032）。 |
| 5 | **F257 闸门二：次数预算 `IN_FLIGHT_DEFER_LIMIT=3`** | judge `:77/:764` | 🔴 **保留（收窄触发面）— 裁决已修正** | ~~条件废除（in-flight 态不参与合取）~~ ← **被两路对抗审查独立证伪后撤销**：闸门二 MUST 在**所有在途态**下保留在合取中；`in-flight` 态 MAY 放宽阈值（数值留 plan）但 MUST NOT 移出合取。归因（附录 B-4）：`background_tasks` 非空可被一条 `Bash(run_in_background)` **恒定诱发**——它不可**伪造**但可**制造**；放行判据需要的性质是「不可诱发」而非「不可伪造」。且原废除论证的承重前提（「#6 闸门三仍在合取中」）曾被原 FR-025 拆掉——组合层安全须整体验算，不能逐行自圆其说（审查 C-C2 归因）。 |
| 6 | **F257 闸门三：会话长度预算 `EARLIEST_FIX_ENTRY_DEFER_LIMIT=420`** | judge `:134/:765`；计量 core `:1096-1104` | 🔴 **保留（锚点绝不改）— 裁决已修正，见附录 B-1** | 它防的是「无限推迟」——不依赖在途探测的独立上界，必须保留（"有界化≠消除"）。~~计量锚点须随病根 iv 改为最晚一次 fix 展开~~ ← **该裁决已撤销**：`EARLIEST_FIX_` 是**承重命名**，基线必须保持**最早**一次 fix 展开。改成最晚锚点正是 F257 第 4 轮**实测证伪**的错误语义（每轮重新展开 fix 即令计数归零，**30/30 全 exit 0**），judge `:95-100` 有红字注释明写「**不要改回去**」。 |
| 7 | **`BLOCK_LIMIT=2` + `releaseDegraded` 恒放行** | judge `:61/:576-618` | **改造（收窄触发面，不废除）** | 现状问题是**陈旧 transcript 与 GATE 暂停都在烧同一个预算**，两会话即降级放行 ⟹ 门禁事实上默认关闭。裁决：(a) 因「证据陈旧 / 无法交叉校验 / 在途 `undetermined`」产生的裁决**不计入** `blockCount`；(b) GATE 暂停**不计入**（US3）；(c) 保留 `BLOCK_LIMIT` 与 `releaseDegraded` 作为**真实不合规反复阻断**时的最终有界降级，防止把用户永久锁死。 |
| 8 | **F211 补救清零**（合规即 `resetBlockState` 返回 0） | judge `:723-726` | **保留（护栏，不回退）** | 卡面明列护栏。 |
| 9 | **状态文件 `load→modify→save` 整体覆写**（`tryWriteState` 裸 `writeFileSync`） | io `:335-343`；judge `:535/:609/:760` | **改造（病根 v）** | 无锁整体覆写在实测的多进程并发下会互相覆写。裁决：状态更新须为并发安全形态；**账本本身绝不可复用该模式**（C-13）。具体机制留 plan。 |

**废除项的回退论证汇总**：本表唯一被削弱的是 #5（闸门二）。其在 `undetermined` 态下**完整保留**；在 harness 字段可用态下被更强的权威判据取代，且 #4 与 #6 两道闸门仍在合取中，"无限推迟"的上界不依赖 #5 存在。因此账本或 harness 字段缺席时，合取闸门集合与变更前**等价**。

### 必答③ `stop_hook_active` 重入防护

**实测事实**（S-2 B-1 + §3 直证）：`stop_hook_active` 由构造代码直接以字面量写入，**无条件存在**，不受 `toolUseContext` / assistant 消息影响；实测取值为**布尔** `false`（非字符串）。这是当前 payload 中少数可以无条件依赖的字段（C-5）。

**语义**：`stop_hook_active === true` 表示本次 Stop 是**由上一次 Stop hook 的继续动作再次触发**的，即处于重入语境。

**判据（本规范采纳）**：

- 判定器读取 `stop_hook_active`，仅接受**布尔真值**为重入信号；非布尔类型一律按"非重入"处理并落诊断（防止未来 harness 改型时静默误判）。
- `stop_hook_active === true` 时，判定器**不得再次产生阻断**（`exit 2`），必须放行，避免与 harness 形成阻断循环。该次判定仍**如实落盘诊断**，登记"因重入放行"。
- 该次放行**不计入** `blockCount`，但**计入** `nonBlockStopCount`（FR-046）——即重入放行本身有次数上界，防止"每次 exit 2 后跟一个重入回合"成为无限放行通道（delta C-1 / 攻击面 A）。`nonBlockStopCount` 耗尽后按正常裁决走，此时若真不合规仍会阻断，但计时器保证不锁死。
- 重入放行**不清零**已有补救状态（不与 F211 补救清零混淆——F211 的清零条件是"实际合规"，重入不是合规证据）。

**上界（审查 A-C5 补 + delta C-1 统一）**：重入放行计入 FR-046 的 `nonBlockStopCount`（不再是单独的上界计数器，避免多个平行计时器互相不感知）；超界后按正常裁决走。原设计中它是全规范唯一无任何上界的放行通道。
**观测证据升级（P-12 回填）**：~~`stop_hook_active` 的观测证据全部来自 SubagentStop~~ → 已捕获**真实主线程 Stop** payload，`stop_hook_active` 为布尔 `false`、`agent_id` 键缺席（`research/harness-field-probe.md` §3.13），判据可承重。其"为真的时间窗口"仍未测量（需真实阻断后继续的会话），上界要求即为此兜底。

### 必答④ fixture 语料：真实会话录制

**现状**：`tests/fixtures/fix-compliance/` 共 49 个 `.jsonl` + 1 `.txt` + README，其中**真实录制仅 3 份**（`real-bash-transcript-claude.jsonl`（采于 CC 2.1.215）、`real-claude-session-title-only.jsonl`、`real-bash-transcript-codex.jsonl`），其余为手工合成（无 `uuid`/`timestamp`/`parentUuid`，skill 路径伪造为 `/w/...`，特性目录统一 `specs/301-fix-sample-bug`）。另有一份**仓库外**真实会话回放被硬编码引用（`tests/fix-compliance-judge-cli.test.mjs:1768-1772` 指向 `~/.claude/projects/...`，本机不存在即 skip）——这份**不算入库语料**，本次不依赖它。

**录什么**：新增至少一组**成对**的真实录制语料，覆盖一次真实 fix 流程会话：

1. **PostToolUse 账本序列**：该会话内按真实顺序产生的全部账本条目，须**同时包含主线程条目（无 `agent_id`）与子代理条目（有 `agent_id` / `agent_type`）**，并保留真实的交错顺序（这是 C-13 并发面的唯一真实证据）。
2. **Stop payload 全字段**：至少一份真实 Stop（**PENDING-1**：真实 Stop 样本尚未取得，须在本需求实施期间补录；在补录完成前，相关 acceptance 标 PENDING，**不得**用 SubagentStop 样本冒充 Stop 样本），字段须完整保留 `stop_hook_active`、`background_tasks`、`session_crons`、`last_assistant_message`、`prompt_id`、`transcript_path` 的**真实取值或真实缺席**。
3. 尽可能补录一份 `background_tasks` **存在且为空数组** 的 Stop 样本（区别于非空样本），以真实语料覆盖 C-2 的第二态。

**怎么脱敏**：沿用现有 `tests/fixtures/fix-compliance/README` 的脱敏规则（不新造规则）。附加两条不可违反的约束：

- **保留字段存在性与形状**：缺席的键脱敏后仍缺席（不得补成 `null` 或空串）；空数组仍是空数组；布尔仍是布尔。脱敏只替换**值的内容**，不改变**值的种类**。
- **保留序列与相对时序**：条目顺序与主/子交错关系不得重排；时间戳可整体平移但不得改变先后与相邻关系。

**放哪**：`tests/fixtures/fix-compliance/` 下，文件名以既有 `real-` 前缀标识真实录制（与合成语料一眼可辨），并在该目录 README 中登记录制环境（Claude Code 版本号——本机为 **2.1.220**、录制日期、脱敏项清单）。

**"主验收语料"意味着什么**：以下 acceptance **必须**跑在真实录制语料上，不接受仅在合成语料上通过：

- US2 的三态在途判定（`in-flight` / `no-in-flight` / `undetermined`）—— 至少 `in-flight` 与 `no-in-flight` 两态跑真实语料；`undetermined` 允许合成（PENDING-2：真实触发条件未观测）。
- US1 的账本条目消费主路径与主/子归属判别（`agent_id` 缺席即主线程）。
- 必答③的 `stop_hook_active` 重入防护（真实取值类型验证）。
- US4 的 `last_assistant_message` 缺席 vs 陈旧两态**至少一态**跑真实语料。

合成语料继续保留，承担损坏、截断、Codex 方言、极端边界等**难以真实录制**的场景。

### 必答⑤ 长异步验证的 in-flight / PENDING 语义

**背景**：F269 在需要等待真实 CI（30 分钟以上）时现场发明了「验证报告先落盘 + 真实验收节标 PENDING + 完成后回填」的做法。该惯例此前不成文，判定器也不认识 PENDING——一旦 US1–US3 让门禁变严，长异步流会被直接卡死（要么等不到就阻断，要么被迫写假结论）。

**成文的惯例（写入流程规范）**：

1. 当某条验收依赖**外部长异步过程**（真实 CI、跨会话人工验证、需要用户在 host shell 执行的步骤）时，允许在验证报告中把该节标为 **PENDING**。
2. PENDING 节**必须**写明三件事：(a) 在等什么（具体的外部过程）；(b) **回填触发条件**（何种可观测事件发生后可以回填）；(c) 回填前**不得**宣称该项已达成的显式声明。
3. 报告的其余部分照常落盘并给出真实结论——**PENDING 不传染**，未 PENDING 的验收项按常规判定。
4. 回填时用真实结论替换 PENDING 文本；回填后该项按实际结论裁决，**不因曾标 PENDING 而降级或豁免**。

**判定器的显式支持（本规范要求）**：

- 判定器识别验证报告中的 PENDING 标记，并把「含合规 PENDING 项的报告」视为 **`verification-report.md` 已存在**的一种合法形态——即它**满足** F257 闸门一白名单里的 `verification-report.md` 项，不因存在 PENDING 而判缺失。
- **合规 PENDING** 的判据：PENDING 节写明了回填触发条件。满足则判为合规，并在诊断中登记「存在 N 个未回填项」（Constitution 原则 IV：诚实标注而非隐藏）。
- **不合规 PENDING**：无回填条件说明的裸 PENDING 占位。此类**不**满足验证报告要求，按缺失处理——防止 PENDING 变成新的逃逸口（F257 的教训：任何非必要形态约束或宽松放行都会成为逃逸面）。
- PENDING 与 `background_tasks` 在途是**两个正交概念**：前者是"报告里承认有事没做完"（跨会话、跨小时），后者是"此刻有后台任务在跑"（会话内、秒级）。二者不得互相替代，也不共用诊断码。

## Requirements *(mandatory)*

> **必要性标注**（YAGNI 检验）：`[必须]` = 去掉后核心需求无法实现；`[可选]` = 去掉后核心仍可实现但体验/可维护性受损。本轮无 `[YAGNI-移除]` 项被降级保留在正文——被判定为当前迭代不需要的候选见「已知边界与诚实缺席」末节。

### 账本采集（US1 · 病根 i / v）

- **FR-001** `[必须]`：系统 MUST 在每次工具调用完成后，由 PostToolUse 事件触发的独立采集器向**本会话的证据账本**追加一条结构化记录。
- **FR-002** `[必须]`：账本条目 MUST 至少包含：`tool_use_id`、`tool_name`、`tool_input` 摘要、`prompt_id`、`session_id`、hook 侧生成的时间戳；当且仅当 payload 提供时 MUST 包含 `agent_id` / `agent_type`。
- **FR-003** `[必须]`：账本条目的时间戳 MUST 由 hook 进程生成，且其语义 MUST 在规范与产物中显式声明为「hook 执行时刻」而非「工具调用时刻」（C-1）。
- **FR-004** `[必须]`：采集器 MUST 在任何失败路径下以退出码 0 结束，且 MUST NOT 向 stdout/stderr 输出会被 harness 转成 `hook blocking error` 的内容（C-10）。
- **FR-005** `[必须]`：采集器失败 MUST 可被事后诊断（写入独立的自诊断通道），但该通道 MUST NOT 进入被判方上下文。
- **FR-006** `[必须]`：账本写入 MUST 在多进程并发追加下不丢条目、不产生交织损坏（单条一次写完 + 追加语义，或每条一文件）（C-13）。
- **FR-007** `[必须]`：账本写入 MUST NOT 采用「读全量 → 修改 → 整体覆写」模式（该模式即病根 v）。
- **FR-008** `[必须]` 🔴 **【已改写 — D-1 裁决 + 审查 A-C4】**：~~判定器 MUST 以账本为主证据源，transcript 降为次级佐证；二者冲突时以账本为准~~
  **改为**：判定器 MUST 以账本为**委派证据**的主源；transcript 保持**锚点、F257 写入见证、F216 执行记录**的主源地位（职责切分表见附录 A-6 修正 1）。账本相对 transcript 的优先**仅适用于「transcript 尾部缺证」方向**（滞后是有方向的性质，只解释尾部缺失）；若「账本有某委派、transcript 在**该委派 hook 时间戳所对应的 transcript 区段已落盘**却无对应 `tool_use`」，判定器 MUST 落矛盾诊断码并**取更严的一侧**（按证据不足处理），MUST NOT 无条件采信账本——交叉只能证伪不能证实（必答① L3），无条件优先会关掉唯一的证伪能力。
  🔴 **delta C-3 · 「完整区段」的可判定定义留 plan 定钉**：判据须能机械判定「transcript 某处是否已落盘」。候选 oracle：账本条目 hook 时间戳 vs transcript 尾行 `timestamp`——但该时间戳在被判方生成域内（必答①），故此 oracle 只能**保守**用于「证伪」（transcript 明显更新仍无该 tool_use → 矛盾），不得用于「证实」（时间戳落在尾部就采信）。plan MUST 给出可判定定义或**明确承认该维度无证伪能力**并据此调低下游主张。
  🔴 **delta C-3 · 委派证据下界下降的显式登记**（补必答②遗漏的对比）：D-1 方向 X 把委派证据主源从 transcript `tool_use`（**harness 写入、被判方不经手**）换成账本条目（**被判方可写的文本行**）。用必答②#3 判见证的同一把尺子量：委派证据的安全下界**确实下降**了一档——从「harness 背书」降到「hook 独立记录 + 被判方事后可改写」。这与必答①「只防疏忽不防蓄意」的总定位一致（账本文件可被 Bash 改写是已登记残余风险），但**此前只在通用条款里被笼统覆盖，未做委派维度的专项对比**。现显式登记：委派证据在账本上的下界 = 「疏忽不合规必被记录」，不含「蓄意伪造可被阻止」。FR-008 的方向性优先 + 与 transcript 的矛盾交叉是**唯一**的补偿性证伪手段，其强度受上一条 oracle 可判定性限制。
- **FR-009** `[必须]`：账本缺席时，判定器 MUST 回退到变更前的证据路径，判定结果 MUST 与变更前等价；系统 MUST NOT 因账本为空/缺失而产生阻断（Constitution 原则 XIII）。
- **FR-010** `[必须]`：账本中不满足条目 schema 或被截断的记录 MUST 被跳过而非使整个账本失效，并 MUST 落 `ledger-entry-corrupt` 诊断码。
- **FR-011** `[必须]`（审查 A-C6/B-C8 补方向）：账本 MUST 有体积上限；超限时 MUST 落显式诊断码。账本**任何不可用形态**（超限 / 损坏 / 部分缺失）的裁决强度 MUST NOT 弱于「账本完全缺席」态——统一回退 transcript 路径（与 FR-009 同向），MUST NOT 以残账本裁决，也 MUST NOT 因此产生阻断或放行的额外偏移。仓内同型先例（`transcript-too-large` → 直接 return 0）**不得**照抄到账本上。
- **FR-012** `[必须]`：block/defer 状态的更新 MUST 在多进程并发下不互相覆写（病根 v）。
- **FR-013** `[必须]` 🔴 **【升格改写 — 审查 A-C3/B-C6】**：~~[可选] 按 prompt_id 分组读取~~
  **改为**：账本委派证据 MUST 有**归属窗口**：委派条目 MUST 通过 **hook 侧时间戳与锚点条目的 `timestamp`**（实测 transcript 锚点行带 `timestamp`）对齐到「最晚一次 fix 展开之后」，锚点前的条目 MUST NOT 计入本次判定。归属判据须独立论证，不得靠「在账本里」顺带成立（九轮史 M4）。
  MUST NOT 用 `prompt_id` 做证据**过滤**：fix 流程横跨多个用户轮次（每次 GATE 拍板都换 `prompt_id`，P-12 直证），按 `prompt_id` 过滤会切掉前序轮次的委派证据造成系统性误阻断。`prompt_id` 仅用于 A-4 指纹与诊断分组。

### 在途判定（US2 · 病根 ii）

- **FR-014** `[必须]`：判定器 MUST 依据 Stop payload 的 `background_tasks` 判在途，且 MUST 实现**三态**：`in-flight`（数组存在且非空）/ `no-in-flight`（数组存在且为空）/ `undetermined`（键缺席）（C-2）。
- **FR-015** `[必须]`：`undetermined` 态 MUST NOT 被坍缩进其余两态中的任何一个，且 MUST 拥有独立诊断码。
- **FR-016** `[必须]` 🔴 **【已改写 — delta 复审 C-2】**：~~判为 `in-flight` 时 MUST NOT 消耗 `IN_FLIGHT_DEFER_LIMIT` 类次数预算~~
  **改为**：判为 `in-flight` 时，系统 MUST NOT 消耗**阻断预算 `blockCount`**（在途推迟不是不合规阻断，与 `judge:74`「刻意与 blockCount 分列计数」一致）。**但 MUST 照常消耗在途推迟预算 `inFlightDeferCount`**——否则闸门二的合取项 `inFlightDeferCount < IN_FLIGHT_DEFER_LIMIT` 恒真、形式在合取里实质是常量 true，等价于 FR-019 明令禁止的「移出合取」，K-2 的「无限推迟上界消失」不闭合。原文「不消耗在途预算」正是这个空转 bug 的来源。
- **FR-017** `[必须]`：在途判定的承重判据 MUST 仅使用结构性事实（键是否存在、数组是否非空）；`type` / `description` / `agent_type` 等文案字段 MUST NOT 影响判定结论（C-8 / T-1）。
- **FR-018** `[可选]`：判定器 SHOULD 在人类可读诊断中说明「在等什么」（引用 `type` / `description`），且 MUST 容忍未知取值与含空格取值。
- **FR-019** `[必须]` 🔴 **【已改写 — 必答②#5 裁决修正】**：~~次数预算仅在 `undetermined` 态参与~~
  **改为**：`IN_FLIGHT_DEFER_LIMIT` 次数预算 MUST 在**所有在途态**下保留在推迟合取中；`in-flight` 态 MAY 采用放宽的阈值（数值留 plan），但 MUST NOT 将其移出合取。理由：`background_tasks` 非空可被被判方一条 `Bash(run_in_background)` 恒定诱发（不可伪造 ≠ 不可诱发），无上界的推迟通道会复活「无限推迟」（附录 B-4）。
- **FR-020** `[必须]`：`session_crons` 与 `background_tasks` 的**同生共死**特性 MUST 被显式处理——不得因只检查其中一个键而误判另一个的可用性。
- **FR-021** `[必须]`（改写，与 FR-013 对齐）：`agent_id` 键缺席 MUST 被解释为「主线程」（结构性判据，非启发式，C-4）；该假设若被上游翻转（主线程也带 `agent_id`），判定器 MUST 落诊断而非静默改判（审查 B-W5）。`prompt_id` MUST NOT 作为证据过滤键（见 FR-013）。

### 锚点（US3 · 病根 iv）

- **FR-022** `[必须]`：判定器确定 fix 判定锚点时 MUST 取**最晚一次 `spec-driver-fix` 展开**，MUST NOT 取「最晚一次任意 `spec-driver-*` 展开」。
- **FR-023** `[必须]`（审查 C-W7 补登记）：会话内存在 fix 展开时，后续任何非 fix 模式展开 MUST NOT 导致整体跳过 fix 判定。
  **随附登记的新增误阻断形态**（按 F257 纪律，每个新增误阻断形态须登记）：「fix 收口后接 `spec-driver-sync`/`doc` 的会话，此后每次 Stop 仍按 fix 判定」——本仓标准流程即会命中。定性：方向 fail-closed、可通过补齐/保留制品自愈；FR-046（不计数必放行）+ A-4 指纹去重共同保证该形态不会锁死会话。如实登记为 FR-023 的已知代价。
- **FR-024** `[必须]` 🔴 **【适用域已收窄 — 见附录 B-2】**：~~判定器对「本会话是否属 fix 语境」的判断结果 MUST 落盘~~
  **改为**（delta 复审 C-4 二次修正）：**当且仅当**「会话内**曾出现过 fix 展开**（`earliestFixLineIndex !== null`）」时，该会话的**最终裁决**（含**合规早退**、非 fix 早退、在途推迟——所有当前在 `appendAuditEvent` 之前 return 的路径）MUST 落审计事件。
  ⚠️ 上一轮把条件写成「曾出现 fix 展开**但最终锚点非 fix**」是**后置不可达条件**：FR-022/023 实施后（`core:580-600` 实证 `latest.mode` 取最晚任意展开、`earliestFixLineIndex` 取最早 fix 展开），「曾 fix 且最终锚点非 fix」的会话已改走**正常 fix 判定**、不再是黑洞——该 MUST 永不触发。且 A-3 点名的黑洞是**两条**：`!isFix` 早退（judge `:719`）与**合规早退**（judge `:723-725`，`resetBlockState` 后 return，从未被任何 FR 覆盖）。收窄成「曾 fix 展开」即同时覆盖两条，其中合规早退是真正一直漏的那条。
  **不适用于**从未出现过 fix 展开的会话——F240 US5「健康路径零落盘」不变量**保持不变**（本机 2676 份 transcript 实扫背书；`judge:718-719`、`core:204-218`）。「曾 fix 展开」是这两个全称命题（本次落盘 / US5 不落盘）的正确分界。
- **FR-025** 🔴 **【已撤销 — 见附录 B-1】**：~~会话长度预算（`EARLIEST_FIX_ENTRY_DEFER_LIMIT`）的计量锚点 MUST 随 FR-022 同步改为最晚一次 fix 展开口径。~~
  **改为**：`EARLIEST_FIX_ENTRY_DEFER_LIMIT` 的计量基线 **MUST 保持「最早一次 fix 展开」不变**，**MUST NOT** 随 FR-022 改动。FR-022 只改**判定主锚点**（`anchorLineIndex`），闸门三的基线是**另一个独立的量**（`earliestFixLineIndex`），二者的方向不对称是 F257 刻意设计，不是待对齐的疏漏。

### GATE 暂停（US3 · 病根 iii）

- **FR-026** `[必须]` 🔴 **【已改为结果性要求 — 见附录 A-6 修正 2 / B-3】**：~~判定器 MUST 能**识别**「流程处于 GATE 暂停、等待用户拍板」这一状态~~
  **改为**：判定器 MUST 保证——会话在**证据状态无进展**期间反复触发 Stop 时，**不产生误阻断、不消耗任何有界放行预算**。
  理由：原表述是**手段性**要求，而附录 A-4 已取证排除仅有的两个候选识别信号（`record-workflow-run.gatePauses` 非实时、实测恒 `[]`；`last_assistant_message` 文本启发式**直接命中已证伪路线 #21**）。若照原文硬做，实现者只剩已被九轮史判死的文本启发式一条路，等于送出「输出一句 GATE 文案即免于计数」的绕过。结果性表述同时被「指纹去重」与「场景识别」两条路径满足，不把实现锁死在一条**尚无可用信号**的路上。
- **FR-027** `[必须]`：GATE 暂停状态下的 Stop MUST NOT 被裁决为不合规收口尝试，MUST 落专属诊断码。
- **FR-028** `[必须]`：GATE 暂停产生的裁决 MUST NOT 计入 `blockCount`，MUST NOT 消耗任何有界放行预算。
- **FR-029** `[必须]`（delta C-1 对齐解锁计时器）：因「证据陈旧 / 无法交叉校验 / 在途 `undetermined` / 重入」产生的裁决 MUST NOT 计入 `blockCount`（`BLOCK_LIMIT` 与 `releaseDegraded` 仅对**真实不合规反复阻断**生效，必答②#7），但 MUST 计入 `nonBlockStopCount`（FR-046）——**不计 `blockCount` ≠ 立即放行**，这类态在计时器耗尽前照常按本身语义裁决、耗尽后终态可见放行。

### PENDING 语义（US6 · 必答⑤）

- **FR-030** `[必须]`：判定器 MUST 识别验证报告中的 PENDING 标记，并把含**合规 PENDING** 的报告视为 `verification-report.md` 已存在的合法形态。
- **FR-031** `[必须]`：合规 PENDING 的判据 MUST 是「PENDING 节写明回填触发条件」；无回填条件的裸 PENDING 占位 MUST 按缺失处理。
- **FR-032** `[必须]`：判为合规 PENDING 时，诊断 MUST 登记未回填项数量（原则 IV）。

### 诊断与交叉校验（US4）

- **FR-033** `[必须]`：`last_assistant_message` **缺席** 与 **取到且判定陈旧** MUST 分配不同诊断码；`snapshot-stale` 专码 MUST 仅用于后者（C-3）。
- **FR-034** `[必须]`：判定器 MUST 保留现有全部诊断码语义；新增诊断码 MUST NOT 复用既有码表示不同含义。
- **FR-035** `[必须]`：Codex 方言会话的 Stop MUST 保持 `indeterminate` 语义；Codex 侧 PostToolUse 的未知 payload 形状 MUST 被静默跳过（C-12）。
- **FR-036** `[可选]`：判定器 SHOULD 在诊断中标明本次判定使用的证据源（账本 / transcript / 混合），便于事后归因。

### 分发、护栏与语料（横切）

- **FR-037** `[必须]`：新增的 owned hook 脚本 MUST 同时登记到 `scripts/lib/codex-hooks-schema.mjs` 的 `OWNED_HOOK_SCRIPT_SUFFIXES`（`:100-106`）与 `OWNED_HOOK_EXPECTED_EVENT`（`:120-126`）；F264 的「恒 5 条」验收口径与相关断言/文档 MUST 一并更新为 6 条（C-11）。
- **FR-038** `[必须]`（审查 C-W2 补全）：判定链新增的源文件 MUST 加入 `JUDGE_FILE_SET`（`scripts/lib/judge-snapshot-core.mjs:16-25`）。数量口径：**7 + 新增判定链模块数**（plan 定稿；预计 +2：账本读取模块、在途判定模块；**采集器 hook 脚本不在判定器 import 闭包内、不入 SET**）。同步点全集（漏一处即红）：`tests/judge-snapshot-core.test.mjs:344` **与 `:362`** 两处 `length === 7`、`tests/judge-snapshot-doctor-cli.test.mjs:28` 的**独立硬编码 JUDGE_FILE_SET 副本**（不 import 常量）、`tests/judge-snapshot-doctor.test.mjs:60` 的「7 个文件」注释。
- **FR-039** `[必须]`：本需求 MUST 新增真实会话录制 fixture 作为主验收语料，且必答④列出的 acceptance MUST 跑在该语料上。
- **FR-040** `[必须]`：账本采集器与判定器 MUST 只使用 Node.js 内置模块与 bash，MUST NOT 引入任何 npm 运行时依赖（Constitution 原则 X）。
- **FR-041** `[必须]`：验收 MUST 显式区分「`settings.local.json` 热加载路径的逻辑验证」与「插件快照分发路径的真实生效」，MUST NOT 用前者的通过冒充后者（F236 / C-7）。
- **FR-042** `[可选]`：若判定器未来增挂 SubagentStop，实现 MUST 按 `agent_id` 剔除自身条目——本条作为**已知边界**写入规范与代码注释，当前迭代**不实现**增挂（C-9 / T-2）。

### 对抗审查后新增（附录 B / 处置文档 §3，2026-08-31）

- **FR-043** `[必须]`（原附录 A-2，提正文）：**采集器活性自检**——系统 MUST 提供一种不依赖账本内容本身的方式，判断「采集器在本会话是否曾成功写入过」，且该自检 MUST 有测试覆盖（F245 根因之一即零测试）。自检 MUST 按运行时分派（审查 C-W8）：Codex 会话（方言已识别）下账本恒空是**正常永久态**，MUST NOT 报异常；Claude 会话下账本恒空才是 F245 型静默失效信号。
- **FR-044** `[必须]`（原附录 A-2，提正文）：判定器 MUST 区分「**账本缺席**（采集器可能没装/没生效）」与「**账本存在但锚点后无委派条目**（采集器活着，本段确实无委派）」两态——二者坍缩即把 F245 的静默失效重演一遍。前者走 FR-009 回退；后者按真实证据缺失参与正常裁决。
- **FR-045** `[必须]`（原附录 A-3，提正文；delta 复审 C-4 修正）：审计黑洞收口——适用域**与 FR-024 修订版一致**（「曾出现 fix 展开」即触发，覆盖合规早退 + 非 fix 早退两条黑洞）；`entries.length === 0`（空 transcript）MUST 落独立诊断码而非静默早退。此条与 FR-024 是同一收口的两面（FR-024 定"何时落"，FR-045 定"空 transcript 特例"），实现时合并处理。
- **FR-046** 🔴 **【已重写 — delta 复审 C-1，根因修复】**：~~任何不计入 `blockCount` 的裁决 MUST 同时放行~~ ← 该全称规则被 delta 复审证伪：它与 A-4 指纹去重 / 必答③重入组合后，把「一次 exit 2 + 一个零工具调用回合」变成放行（最短绕过从变更前的 2 次 exit 2 缩到 1 次），且新放行通道不写终态、比 `releaseDegraded` 更安静（复现 F257 缺陷 2「更安静的放行成为首选绕过面」）。
  **改为（解锁计时器主线）**：`blockCount` 之所以不能被"不计数"直接绕过，是因为它同时是 `releaseDegraded` 的**唯一解锁计时器**。修法是**解耦**而非"不计数即放行"：
  1. 引入一个**独立于 `blockCount` 的有界解锁计数器**（暂名 `nonBlockStopCount`）。🔴 **承重不变量（delta-2 Q3，MUST，不留给 plan 自由裁量）**：`nonBlockStopCount` 的阈值 **MUST ≥ `BLOCK_LIMIT`**。理由：被判方**完全控制一次裁决落进哪个桶**（零工具回合→指纹无进展桶、`Bash(run_in_background)`→in-flight 桶、exit2 后续→重入桶，三者均 self-inducible）。若任一"非不合规"桶的阈值低于 `BLOCK_LIMIT`，被判方就把真实不合规裁决塞进那个**阈值最小的桶**，使放行地板 = `min(阈值)+1` 跌破诚实 `blockCount` 地板（=`BLOCK_LIMIT`+1=3），变成**比变更前更坏**的绕过。硬化为 MUST 后，任何桶的放行地板都不低于诚实地板。
  2. 因「证据陈旧 / 无法交叉校验 / 在途 `undetermined` / 重入 / 指纹无进展」产生的裁决 MUST NOT 计入 `blockCount`（避免真实不合规的额度被这些非不合规态烧掉），但 MUST **计入 `nonBlockStopCount`**。
  3. 这类裁决在 `nonBlockStopCount` **未耗尽**前**照常按其本身语义裁决**（该阻断的仍 exit 2，不锁死是因为有计时器在走）；**耗尽后**走与 `releaseDegraded` **同规格的终态可见放行**（写 `recordWorkflowRun` 终态，不走安静通道）。
  4. 由此：不锁死、不早放行（要累积到阈值 ≥ `BLOCK_LIMIT`）、可观测（终态可见）。攻击面 A 的「1 次即放行」不再成立（最短放行从 1 抬到 `nonBlockStopCount 阈值`+1 ≥ 3）。
  5. 🔴 **不可擦 backstop（delta-2 额外发现，MUST）**：`nonBlockStopCount` 若与 `blockCount` 同住可擦的 `.specify/runs/.fix-compliance-state/`（被判方每 Stop 前 `rm -rf` 即清零），则「计时器保证最终放行」为假——会话被 brick 在 exit 2 循环（违反 F208「不 brick 会话」）。故 `nonBlockStopCount` 的耗尽判据 MUST 挂到一个**单调不可擦量**（如 gate3 的 `assistantEntriesSinceEarliestFix`，transcript 派生、擦不掉），与现有 gate3 为 `inFlightDeferCount` 兜底的手法同构（`judge:79-84`）。第 4 点的「保证最终放行」是**有条件**的，条件即此 backstop。
  覆盖 FR-027/028/029、必答③重入、A-4 指纹去重全部「不计入 blockCount」场景——它们统一改为「不计 `blockCount`、计 `nonBlockStopCount`」。
  ⚠️ **组合跑道登记（delta-2 Q1）**：三计时器（`blockCount`≤2 / `inFlightDeferCount`≤3 / `nonBlockStopCount`≥2）互不感知、无共享上界，会话最坏「非终态跑道」= 三者容量**之和 ≈7 次 Stop**（非本条自述的「与 BLOCK_LIMIT 同量级 ~2」）。有界但下游不得按「~2-3 次即收口」推理——SC 增设组合上界断言（SC-015）。
- **FR-047** `[必须]`（审查 B-C2 + delta W-3 修正）：「**账本存在但条目不全**」MUST 独立成态，该态 MUST 回退 transcript 路径（与 FR-009 同向），MUST NOT 以残账本裁决。
  **触发路径校正**：`.specify/runs/` 被 `git clean` 清理、hook matcher 覆盖不全、会话中途磁盘转不可写属本态；~~`/resume` 更换 `session_id`~~ **不属本态**——它使新会话账本**文件不存在** = FR-009 的「完全缺席」态（delta W-3 指出的误分类，已改归 FR-009）。
  **oracle（delta W-3 补，不再留白给 plan）**：「条目不全」的判据 MUST 挂到 **FR-043 活性自检 + 「transcript 有 `tool_use` 而账本无对应条目」的交叉检查**——即用 transcript 作为账本完整性的外部基准。无此 oracle 则「不全」不可判定。plan 定具体阈值，但判据来源在此钉死。
- **FR-048** `[必须]`（审查 B-W2 + 九轮史 #25；delta W-6 修去重键）：账本条目重复 `tool_use_id` 的处理 MUST 是「去重后校验一致性」——内容一致的重复（hook 叠装 / 双注册场景，F264 实测存在）静默去重；内容**不一致**的重复才落 `ledger-entry-conflict` 类诊断。MUST NOT 见重复即判整本残缺。
  🔴 **去重键不用 `tool_input` 摘要**（delta W-6）：摘要经截断，两次真实不同的委派若截断后相同会被**静默折叠**（fail-closed 误伤，且抖动指纹的「账本条目数」分量）。去重键 MUST 用 `tool_use_id` + **判定输入字段的全值稳定哈希**（对委派证据即 `subagent_type` 全值，不截断），而非摘要。摘要仅用于人类可读展示与体积控制，不参与去重相等判定。
- **FR-049** `[必须]`（审查 C-W4）：新增诊断码 MUST 同步 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json` 的**闭合 enum**（`additionalProperties: false`；F224/F256/F257 三轮均把它列为必改文件）。若新码由新的 lib 模块发出，合同同步守卫 MUST NOT 照抄「只读 judge 单文件源码」的既有模板（会写出永远失败的守卫）。

### Key Entities

- **会话证据账本（Session Evidence Ledger）**：一次 Claude 会话内、由 PostToolUse 采集器实时追加的工具调用记录集合。按 `session_id` 界定归属，按 `prompt_id` 可分组为「用户轮」（仅用于诊断分组与 A-4 指纹，**不用于证据过滤**）。~~是判定器的主证据源~~ → **是委派证据的主源**（D-1 裁决：F257 见证与 F216 执行记录不迁账本，见附录 A-6 修正 1 更新表）。
- **账本条目（Ledger Entry）**：一次工具调用的结构化摘要。关键属性：`tool_use_id`（主键，用于去重/幂等）、`tool_name`、`tool_input` 摘要、`prompt_id`、`session_id`、hook 侧时间戳；可选 `agent_id` / `agent_type`（**缺席即主线程**）。
- **在途判定结论（In-Flight Verdict）**：三态之一 —— `in-flight` / `no-in-flight` / `undetermined`。来源于 Stop payload 的 `background_tasks` 键的存在性与非空性。
- **诊断码（Diagnostic Code）**：判定过程中如实登记的机器可读原因标识。现有全集：`payload-invalid` / `transcript-path-absent` / `transcript-unavailable` / `transcript-too-large` / `config-degraded` / `state-storage-unavailable` / `transcript-format-unrecognized` / `dialect:codex-rollout` / `feature-dir-witness-absent` / `feature-dir-unresolvable` / `delegation-in-flight` / `delegation-in-flight-budget-exhausted` / `delegation-in-flight-entry-budget-exhausted` / `parse-timeout`（审查 C-W4 指出原清单漏此码，源自 F208 FR-013）/ `internal-error`。本需求新增账本类、在途三态类、GATE 暂停类、`snapshot-stale` 与「无法交叉校验」类，具体码名留 plan 定义；**新增码 MUST 同步 verdict-event schema 闭合 enum（FR-049）**。
- **验证报告 PENDING 项（Pending Verification Item）**：验证报告中标注为待外部长异步过程完成的验收节。合规形态必须含回填触发条件。

## 护栏与不回退清单 *(mandatory)*

以下为本次改动**不得触碰或必须同步**的项，任何实现方案违反其一即判不通过：

| 编号 | 护栏 | 判据 |
|---|---|---|
| G-1 | **F208 三档语义不回退** | `ENFORCEMENT_VALUES = block\|warn\|off`（core `:35`，解析 `:1830-1842`，消费 judge `:709`/`:791-798`/`:801`）是**配置档**而非判定结果档。本次不得把判定结果三态与之混淆或合并。 |
| G-2 | **F211 补救清零不回退** | 合规即 `resetBlockState` 返回 0（judge `:723-726`）保持。 |
| G-3 | **F216 no-op 证据门不回退** | `closure.hasNoopAnchor && fixReport.exists`（core `:1799`）、证据抽取（judge `:416-418`）、分类主体与 sentinel 四态（`fix-compliance-execution-record.mjs:196-213/:298-328`）保持。 |
| G-4 | **F231 光杆命令判据不回退** | `scanRenameCommandEvents`（core `:1206-1258`）的三条判据——含换行整条拒绝、只接受光杆 `mv`/`git mv`、操作数恰为 2——保持。 |
| G-5 | **F227 `ambiguous===false` 守卫不可删** | judge `:268` 保持。 |
| G-6 | **`JUDGE_FILE_SET` 同步** | 7 → **7+新增判定链模块数**（预计 9），四处同步点全改：core.test `:344`/`:362` 两处 `length===7`、doctor-cli.test `:28` 独立硬编码副本、doctor.test `:60` 注释（FR-038 修订版；审查 C-W2 指出原「8」与复杂度表自述的 3 新增组件未对账）。 |
| G-7 | **F264 双处登记** | `OWNED_HOOK_SCRIPT_SUFFIXES` + `OWNED_HOOK_EXPECTED_EVENT` 同时登记；「恒 5 条」口径改 6 条（FR-037）。 |
| G-8 | **F236 生效时点** | 改完必须跑 `npm run judge:doctor` 并在报告中说明生效时点。**基线已是 drift**（S-3 §2），验收判据是「本次引入文件相对基线的增量」，不得把 drift 本身当本次引入。 |
| G-9 | **零运行时依赖** | 只用 Node 内置模块 + bash（FR-040）。 |
| G-10 | **异构对抗档位** | 本卡属门禁/判定器类改动，Codex 配额恢复前须走独立子代理异构对抗（≥2 切入角），并在 commit message / 报告中标注「Codex 审查暂停，异构档位缺席」。 |

## Constitution 对齐

`.specify/memory/constitution.md` 四条须显式对齐：

- **原则 X 零运行时依赖**：账本采集器与判定器只使用 Node.js 内置模块与 bash，**禁止引入任何 npm 包**（含 JSON schema 校验库、文件锁库）。结构校验与并发安全须用内置能力达成（FR-040）。这也是必答①拒绝引入签名/可信存储方案的理由之一。
- **原则 XIII 向后兼容**（承诺范围已限定 — 审查 C-C7）：该原则在本卡的承诺是**组件级**的：**账本相关判定路径**在账本缺席时与变更前等价（FR-009/FR-047），**绝不能出现「账本空 ⟹ 恒阻断」**——那会在插件快照未同步的机器上（S-3 已实测本机即此状态）立刻炸开。锚点/GATE/PENDING/重入等改造**有意改变行为**（它们就是要修的病根），不在此承诺范围内，各按新语义验收（SC-007 修订版）。原「整体完全一致」表述把组件级不变量误写成了系统级承诺，已修正。
- **原则 IV 诚实标注不确定性**：三态在途判定的 `undetermined`（FR-014/015）、`last_assistant_message` 缺席 vs 陈旧分家（FR-033）、PENDING 未回填项计数（FR-032）、本规范 §0 的 PENDING-1/PENDING-2 登记，都是该原则的直接落地。判定器**不得**把"探测不到"表述成"探测到了某个结论"。
- **原则 XI 质量门控不可绕过**：病根 iii（GATE 暂停烧光预算后人工门禁被绕过）与病根 iv（展开另一 mode 即整体跳过判定）都是**门控被自身机制绕过**的实例，FR-022..FR-029 是对该原则的修复。同时 FR-031 明确禁止 PENDING 成为新的逃逸口。
- **原则 IX（hooks 只承载硬约束、不承载编排决策）**：新增的 PostToolUse handler **只做证据采集**——它读取 payload、生成一条结构化记录、追加落盘，**不做任何流程判断**（不决定是否阻断、不决定下一步做什么、不改变工具行为，且实测 PostToolUse 在工具执行之后触发，结构上也无法回滚工具）。全部判定逻辑仍集中在 Stop 侧判定器。因此它属「证据采集」而非「编排决策」，与原则 IX 不冲突。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：在一次连续派发 ≥5 个子代理的 fix 流程会话中，门禁**零次**出现「预算耗尽导致的行为翻转」（既无误阻断，也无降级恒放行）。当前基线：第 4 次委派即耗尽 `IN_FLIGHT_DEFER_LIMIT=3`。**验收口径（delta C-2）**：目标是在途推迟阈值对真实 5+ 委派流程**足够**（放宽后覆盖），**不是**取消推迟上界——上界仍在（防无限推迟），只是标高到真实流程不会误撞。
- **SC-002**：在真实录制语料上，在途判定的三种输入形态（`background_tasks` 非空 / 空数组 / 键缺席）产出**三个互不相同**的判定结论与诊断码，无坍缩。
- **SC-003**：会话内先展开 `spec-driver-fix` 后展开任意其他 `spec-driver-*` 模式时，fix 判定**仍然执行且有落盘**——即卡面标注的绕过面（病根 iv）在验收语料上**不可复现**。
- **SC-004**：GATE 暂停期间的任意次数 Stop 触发后，`blockCount` 与在途推迟计数**保持为 0 增量**。
- **SC-005**：账本采集器在全部失败注入场景（目录不可写、磁盘满、payload 畸形、Codex 方言 payload）下，均以退出码 0 结束且会话上下文中**零条** `hook blocking error`。
- **SC-006**：在模拟主线程 + ≥2 子代理并发追加的场景下，账本条目**零丢失、零交织损坏**（写入条数 == 读出可解析条数）。
- **SC-007** 🔴（口径已修正 — 审查 B-C5/C-C7）：~~删除账本后判定结论与变更前基线逐条一致~~ → 删除/清空账本后，**账本相关判定路径**（委派证据消费、依赖账本的在途部分）的回退行为与变更前等价（原则 XIII 的组件级验证）；锚点（FR-022/023）、GATE/指纹（FR-026..028）、PENDING（FR-030/031）、重入（必答③）等**与账本无关的改造**按各自新语义单独验收——它们本就设计为账本缺席时也生效（US2/US3「与证据源无关」），原「整体逐条一致」口径与之自相矛盾、不可达。
- **SC-008**（补基线 — 审查 C-W3；delta W-4 补 vitest 基线数）：**`npx vitest run` 与 `npm run test:plugins` 双基线**零新增失败。基线数：`test:plugins` = 1585 tests / 0 fail / 2 skipped（本阶段实测）；`npx vitest run` 基线 **MUST 在 plan/implement 阶段实跑一次取当前值**（M10 体检记 7894/0 但那是更早快照，不作承重基线——delta W-4 指出参照值缺失）。理由：F264「恒 5 条」的断言面在 TS 测试（`tests/unit/codex-hooks-installer.test.ts` ≥9 处、`codex-hooks-event-gate.test.ts:399`），只跑 `.mjs` 的 test:plugins 结构上看不见会红的那一半。
- **SC-009**：必答④列出的四组 acceptance 中，至少**各有一条**跑在真实录制语料上，且该语料在 README 中登记了录制环境与脱敏项。
- **SC-010**：`npm run repo:check` 与 `validate-codex-hooks` 通过；Codex hook 条目数从 5 变为 **6** 且无重复注册（F264 口径更新验证）。⚠️ 验收方式：用 `--codex-home <隔离目录>` 对**真实安装产物**跑——对 canonical `hooks.json` 跑 `--target` 的基线本来就是 fail（`${CLAUDE_PLUGIN_ROOT}` 未展开致 owned 识别为 0，`research/pre-change-baseline.md` §4.1），不得当验收判据。
- **SC-011**（新增，性能锚点 — 九轮史 §5 #4 点名要求；delta W-4 补阈值）：① 账本体积上限有**明确数值**（plan 定，建议 ≤1MB/会话）；② Stop 侧账本读取在**满上限账本**上的耗时 **MUST < 明确阈值**（plan 定，建议 ≤200ms，因判定器跑在同步 Stop hook 上）——是**阈值 pass/fail**，不是"有测试即可"；③ 采集器单次开销**MUST < 明确阈值**（plan 定，建议 ≤50ms；node 冷启动实测 18ms，真实脚本预计 25–35ms，实现后实测回填并与阈值比对）。PostToolUse hook 已实测**阻塞**后续工具调用（P-9），采集器耗时 1:1 叠加到每次调用。
- **SC-012**（新增，配 FR-043/044）：活性自检在「采集器故意致瘫（改坏 hook 命令）」的注入场景下**能报出失效**，且在 Codex 方言会话上**不误报**；「账本缺席」与「账本存在但锚点后无委派」两态在验收语料上产出不同诊断码。
- **SC-013**（新增，配 FR-024/045；delta 复审 C-4 修正因果链）：**任何曾出现 fix 展开的会话**（含合规早退语料、`research/root-cause-reproduction.md` R-1 语料 B、在途推迟语料）在改动后**均有审计落盘**（对照组 R-2：当前合规/非fix早退零落盘）；从未 fix 展开的健康路径语料**仍零落盘**（US5 回归）；空 transcript 语料落独立诊断码。
- **SC-014**（新增，delta W-1 + delta-2 Q3 — 降级放行可观测性不回退且不混淆）：`nonBlockStopCount` 耗尽后的终态放行 MUST 写 `recordWorkflowRun` 终态事件（与现有 `releaseDegraded` 同规格），使「门禁被降级放行」信号在 adoption/审计中**不消失**；且终态记录 MUST **标注触发计时器**（`blockCount-degraded` vs `nonBlockStopCount-exhausted`），不得把「2 次真实阻断」与「2 次零工具/陈旧回合」记成同一句（否则 SC-014「可见」满足但审计语义失真）。验收：分别构造耗尽 `blockCount` 与耗尽 `nonBlockStopCount` 的两份语料，断言终态记录的触发标注不同。
- **SC-015**（新增，delta-2 Q1 — 组合跑道有界）：在被判方主动「换桶」（交替制造不合规/在途/零工具回合）的最坏语料上，会话的非终态 Stop 次数 MUST 有界且 ≤ 三计时器容量之和；断言会话**最终必落终态放行、不永久推迟也不永久阻断**（backstop 不可擦量保证，见 FR-046 点 5）。

## 已知边界与诚实缺席

**本规范明确不做的事**：

1. **不对抗蓄意伪造**（必答①）。删账本可把门禁退回改动前强度，此为已知且接受的边界。
2. **不增挂 SubagentStop**。C-9/T-2 的自身剔除要求作为已知边界写入，但本迭代判定器挂载点不变（仍为 Stop）。理由：增挂会显著扩大验证面，且 `background_tasks` 在 SubagentStop 语境下含自身，误判代价是**门禁静默失效**——属高风险低收益（YAGNI）。
3. **不实现"工具调用真实时刻"**。harness payload 无时间戳（C-1），hook 侧时间戳是唯一可得，偏差不可消除，只做诚实声明不做补偿估算。
4. **不为账本引入外部存储或加密**（原则 X + 必答①推论）。
5. **不修复 `judge:doctor` 的既有 drift**（S-3 §2）。它先于本需求存在且涉及插件安装同步，超出本卡范围。

**方向 X（D-1 裁决）明确放弃的收益（如实登记，供未来另立卡）**：

1. **病根 i 在见证与 no-op 执行记录两条链上未解决**：transcript 尾部陈旧照旧影响 F257 见证与 F216 执行记录（这两类证据恰在会话尾部）。D-1 权衡：迁账本会废除它们的安全下界（成功回执 / 命令全文比对），代价大于收益。
2. **审查 B-I3 的净收益随之放弃**：账本可见子代理内部 Write/Edit，本可修复「子代理写制品 → 主 transcript 不可见 → 见证缺席误阻断」的既有误伤形态——见证不读账本就拿不到这个修复。该既有误伤维持现状。

**继承的 PENDING（回填前不得当作既成事实）**：

- ~~**PENDING-1**：真实 Stop payload 样本待补录~~ → ✅ **已回填**（2026-08-31，`research/harness-field-probe.md` §3.13 P-12）：真实主线程 Stop 直证 `stop_hook_active` 布尔、`background_tasks` 非空数组（含当时在跑的子代理）、`session_crons` 空数组、`agent_id` 键缺席。必答③判据的观测证据升级完成。
- **PENDING-2**：`toolUseContext` 缺席的真实触发条件未观测，`undetermined` 态的验收允许用合成语料，并标注「真实触发路径未证」。
- **PENDING-3**（新增）：`stop_hook_active === true` 的**时间窗口**未测量（需真实阻断后继续的会话）；必答③的重入上界即为此兜底。
- **PENDING-4**（新增）：「GATE 暂停 → 用户拍板 → 计数恢复」的端到端时序未在真实 fix 会话验证（`prompt_id` 随用户消息改变已直证 P-12，但完整链路留 implement 阶段验证）。

**[NEEDS CLARIFICATION]**：

1. ~~**[NEEDS CLARIFICATION: GATE 暂停的可靠识别信号未确定]**~~ → ✅ **已闭合**（附录 A-4 取证 + FR-026 结果性改写）：两个候选信号均被取证排除（`gatePauses` 非实时、文本启发式命中已证伪路线 #21）；主方案改为「证据状态指纹去重」（无需识别 GATE 场景），FR-026 已改为结果性要求。`AskUserQuestion` 权威信号列为可选增强（plan 阶段实测其是否触发 PostToolUse 后方可采纳）。
2. **[NEEDS CLARIFICATION: 账本文件的会话隔离与清理策略未定]** —— 账本按 `session_id` 分文件还是单文件混存、保留多久、何时清理，现有材料未给出约束。现有状态文件放在 `.specify/runs/.fix-compliance-state/<sanitizedSessionId>.json`（tmpdir 回落），账本可参照但**未经裁决**；清理策略缺失会导致 FR-011 的体积上限被反复触发。

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|---|---|---|
| **组件总数** | **3 新增** | ① PostToolUse 账本采集脚本（hook handler）；② 账本读写/校验模块；③ 在途三态判定模块。其余为既有模块改造（judge / core / io / hooks.json / codex-hooks-schema / judge-snapshot-core）。 |
| **接口数量** | **5–6**（delta W-5 对账后下调） | 账本条目 schema（对外契约）、账本读取接口、在途三态判定接口、PENDING 解析接口、`nonBlockStopCount` 解锁计时器接口；外加 `OWNED_HOOK_*` 两处登记与 `JUDGE_FILE_SET` 一处，属清单类非接口。~~「写入见证的账本回退接口」~~（D-1 撤销，见证不迁账本）、~~「GATE 暂停识别接口」~~（FR-026 改结果性，A-4 指纹去重无需识别接口）**已移除**。 |
| **依赖新引入数** | **0** | 原则 X 硬约束，只用 Node 内置 + bash。 |
| **跨模块耦合** | **是** | 需修改 ≥2 个现有模块的接口：`fix-compliance-judge.mjs`、`fix-compliance-core.mjs`、`fix-compliance-io.mjs`、`hooks/hooks.json`、`codex-hooks-schema.mjs`、`judge-snapshot-core.mjs` + 对应测试断言。 |
| **复杂度信号** | **2 个命中** | ✅ **并发控制**（C-13 多进程并发追加 + 病根 v 状态竞态）；✅ **状态机**（在途三态 × enforcement 三档 × 重入 × GATE 暂停 × PENDING 的判定状态空间）。❌ 无递归结构；❌ 无数据迁移（账本为新增，无历史数据需迁移；旧状态文件格式不变）。 |
| **总体复杂度** | **MEDIUM-HIGH**（D-1 后重评，原 HIGH） | 方向 X 收窄使 F257 见证与 F216 执行记录的**载体换代分析整块消失**（原三大 CRITICAL 风险源之一），账本消费面从「四类证据」缩为「委派一类」；但并发控制与状态机两信号仍在，门禁类「失效即静默放行」的性质不变，九轮史逃逸面风险不变。原 `[NEEDS CLARIFICATION]` #1 已由 A-4/FR-026 修订版闭合（结果性要求 + 指纹去重主方案），#2（账本隔离清理策略）留 plan 裁决。 |

**GATE_DESIGN 建议**（delta W-5 对账后更新）：**需人工审查**（已完成，见附录 B / 处置文档）。理由：MEDIUM-HIGH 复杂度 + 门禁类（fail-open 风险）+ 九轮史逃逸面。`[NEEDS CLARIFICATION]` #1 已闭合（FR-026 结果性 + A-4 指纹去重）；#2（账本隔离清理策略）留 plan 裁决。经三路对抗（22C）+ delta 复审（4C），全部 CRITICAL 已处置或转化为 plan 前置。**plan 第一步 MUST 执行审查要求的五量反向普查**（`anchorLineIndex`/`blockCount`/`verificationReport`/`executionRecords`/`saveBlockState().ok`），再进 tasks。

---

## 附录 A · 主线程收口补充（编排器裁决）

> 本节由**编排器主线程**在 spec 生成后补入，来源是第四份事实源 **S-4 = `research/nine-round-lessons.md`**（F224→F257 九轮对抗的教训提炼）。
> 这些内容不改动上文任何裁决，只补三处**缺口**并给出一处 `[NEEDS CLARIFICATION]` 的取证结论。标注为编排器裁决，供对抗审查检验、plan 阶段消费。

### A-1 🔴 必须正面回应：「独立证据账本」曾在 F216 被评估并**否决**

`specs/216-*/spec.md:149-152` 的 GATE_DESIGN Q3 明确列出选项 (b)「维护**独立证据账本**绕开主 transcript 依赖」并**否决**。本需求若不回应这次已记录的设计裁决，就是在无视基座。逐条回应：

| 当年否决理由 | 今天的判定 | 依据 |
|---|---|---|
| ① **成本**：新增材料完整性判定 + 账本读写 | **仍然成立**，不否认。但收益侧已变：F224→F257 九轮证明「在同一抽象上继续打补丁」的成本更高，且第十轮绕过可预期 | 卡面 S-1 §2 裁决 4 |
| ② **新风险**：解析器脆弱性**直接转化为会话阻断** | **已被本次实测否证** —— PostToolUse 返回非零**不阻断工具**（S-2 P-4/C-10）；采集器恒 `exit 0`，读取侧按行独立解析、坏行跳过计数（C-13/P-7）。脆弱性不再转化为阻断 | S-2 |
| ③ 与 F208「**Stop hook 不可 brick 会话**」的 fail-open 保险语义**冲突** | **不再冲突** —— 账本是**新增主证据源而非替代**；缺席/残缺一律回退到变更前路径（FR-009 / 原则 XIII），fail-open 保险语义原样保留 | 必答② 裁决表 |

> ⚠️ **措辞纪律**：F216 否决的是"独立证据账本"，**未**针对"hook 侧实时账本"这一具体形态；也**未找到**任何文档否决过后者。既不得把 F216 当作对本方案的否决而回避，也不得假装它不存在。

### A-2 🔴 新增功能需求：**采集器活性自检**（源自 F245 教训）

`specs/245-*/fix-report.md:5,23`：`post-tool-use-format.sh` 因 payload 取值缺陷**自 F084 起从未生效**、且**零测试覆盖**，直到 F245 才被发现。

本需求把账本作为**地基**，一旦采集器静默失效，失效链是：
**采集器不写 → 账本恒空 → 判定器按「账本缺席」回退 → 门禁静默退回改动前强度 → 没有任何人会发现。**

这与 F245 完全同型，且后果更重（那次坏的是格式化，这次坏的是门禁地基）。

> **裁决**：「采集器活性可被观测」是**功能需求**，不是运维建议。至少须满足：
> (a) 存在一种**不依赖账本内容本身**的方式判断"采集器在本会话是否曾成功写入过"；
> (b) 判定器区分「**账本缺席**（可能采集器没装/没生效）」与「**账本存在但本轮无条目**（采集器活着，只是这轮没有工具调用）」——**这两者当前会坍缩成同一态**，坍缩即等于把 F245 的静默失效重演一遍；
> (c) 该自检本身要有测试覆盖（F245 的根因之一正是零测试）。
> 具体形态留 plan。此需求**并入 US1**，编号建议 FR-043（活性自检）与 FR-044（缺席/空账本分家）。

### A-3 建议一并收口：F257 明确留下的**审计黑洞**（与本需求同轴）

`specs/257-*/fix-report.md:7,285-291`：`runHook` 的**合规早退**与 **`!isFix` 早退**都发生在 `appendAuditEvent` **之前**，从这两条路径出去的会话**事后完全不可见**。审查方当时给的最小收口建议（① 曾出现过 fix 锚点但最终锚点非 fix 必须落审计；② `entries.length === 0` 独立诊断码）**未纳入 F257**，理由是"与当次改动不同轴"。

> **裁决**：**F270 与之同轴**——病根 iv 正是「锚点被后续展开翻转导致整体跳过判定且**零落盘**」。只修锚点而不补审计，等于修好了判据却留着"跳过判定不留痕"的黑洞，下一轮仍然查不出问题。建议纳入本卡，编号建议 FR-045。

### A-4 `[NEEDS CLARIFICATION] #1`（GATE 暂停识别信号）的取证结论与裁决建议

**已排除的两个候选**（编排器亲自取证）：

1. ❌ **`record-workflow-run` 的 `gatePauses` 字段**：实测该字段属 `workflow-run-summary` 事件，是**流程结束时一次性写入**的汇总（本机 `.specify/runs/2026-08.jsonl` 实测取值恒为 `[]`）。GATE 暂停**发生当时不落盘**，故**不能**作实时信号。
2. ❌ **`last_assistant_message` 的文本启发式**（匹配 "GATE"/"等待用户选择" 等）：直接命中已证伪路线 **S-4 表 2 #21**——「assistant 文本块全在**被判方自由生成域**内，'提及过'**没有安全下界**」，以及根因模式 **M1**「判据里任何非必要形态约束＝逃逸面」。采纳它等于送出一条"输出一句 GATE 文案即免于计数"的绕过。**不得采用。**

**编排器建议的主方案 —— 用「证据状态指纹去重」替代「场景识别」**：

病根 iii 的实际伤害是**烧光 `BLOCK_LIMIT`**，而非"没认出 GATE"。GATE 暂停的本质是「会话停在原地、证据状态没有任何进展」。因此**无需识别 GATE 这个特定场景**，只需：

> 对同一 `session_id`，若本次裁决的**证据状态指纹**与上一次被计数的裁决**完全相同**，则该次裁决**不重复计入 `blockCount`**、改计入 `nonBlockStopCount`（FR-046；**不是立即放行**，计时器耗尽前照常按本身语义裁决），仍如实落审计与诊断。
>
> **指纹 = (`prompt_id`, 缺失集合, 账本条目数, 锚点位置)**

🔴 **delta 复审 C-1 揭示的两难，及其解**：指纹含「账本条目数」⟹ 去重**只在零工具调用的回合**才触发（有任何工具调用则条目数变、指纹变、照常计数）。这看似两头落空——GATE 暂停期间若 agent 调了工具就不去重（病根 iii 未覆盖），零工具调用回合去重又曾被 FR-046 旧版直接翻成放行（攻击面 A）。**FR-046 重写后此两难消解**：去重命中只是「不计 `blockCount`、计 `nonBlockStopCount`」，既不锁死也不立即放行；而病根 iii 的真正伤害（烧光 `BLOCK_LIMIT`）由「GATE 暂停不计 `blockCount`」直接挡住，**不依赖指纹去重恰好命中**。指纹去重退化为一个附加的粗粒度保护，不再是承重的唯一防线。

**为什么指纹里含 `prompt_id`**（实测 P-10 推论 3）：本会话 110 次工具调用（含全部子代理）**共享同一个 `prompt_id`**，因为用户只发过一条消息 —— 即 `prompt_id` 的粒度是「**一次用户消息**」而非「一次 Stop 回合」。于是：

> **`prompt_id` 未变 ⟺ 用户尚未介入。**

这是一个 **harness 原生、被判方不可伪造**的信号（由 harness 写入 payload，不在被判方生成域内，因而不落入已证伪路线 #21 的陷阱）。指纹含它之后，语义精确为：

> 「**在同一次用户消息之内**，证据状态毫无进展的重复 Stop，不重复计入 `blockCount`。」

这正是 GATE 暂停等待用户期间发生的事，而**无需识别 GATE 这个场景**。一旦用户真的介入（回答了 GATE 提问），`prompt_id` 改变 → 指纹改变 → 计数恢复正常，**不会被永久豁免**——这一条同时堵住了"指纹恒定即永久免于计数"的逃逸口。

> ✅ **已直证（P-12 回填，2026-08-31，delta W-2 更新）**：捕获到两个不同 `prompt_id`（`29b262ce` → `ac6ec233`），确认「用户发新消息时 `prompt_id` 改变」。**仍待验的只是端到端时序**（PENDING-4：GATE 暂停 → 用户拍板 → 计数恢复的完整链路），非字段行为本身。

**为什么这比场景识别更好**（归因，而非偏好）：
- 场景识别要**枚举**"哪些停顿是合法的"（GATE 暂停、等用户输入、等外部审批……），而 **M1/S-4 的九轮史反复证明形态枚举追不上真实写法**；指纹去重是**否定式**判据——「没有进展就不额外计数」，无需枚举合法场景。
- 它同时覆盖了**卡面未列举**的同类误伤（用户中途离开、连续多次无进展 Stop），而不必为每种再打一个补丁。
- 它不引入任何被判方可自由生成的信号：缺失集合与账本条目数都是判定器自己算出来的。

**可选增强（需先验证）**：若编排器在 GATE 暂停时改用 `AskUserQuestion` 工具提问，则该调用会成为账本里的一条结构性记录，可作为**权威**的"正在等用户"信号。
- 🟢 该信号有一个**罕见的好性质**：伪造它的代价是**真的停下来等人**——而绕过门禁的目的恰恰是"不停下来继续跑"。**伪造与目的自相矛盾**，故它不构成可用的逃逸口。
- ⚠️ **[推断，未直证]** `AskUserQuestion` 是否触发 PostToolUse 尚未实测（本次实测覆盖了 Bash/Read/Edit/ListAgents，触发点看似统一于工具执行链路，但**未对该工具直接验证**）。plan 阶段须实测确认后方可承重。
- ⚠️ 成本：需改动 SKILL 让 GATE 暂停走 `AskUserQuestion`，属**跨卡面**改动（触及 spec-driver SKILL 文本），须评估是否超出本卡范围。

> **裁决**：以「证据状态指纹去重」为**主方案**（不依赖任何待验证前提，可独立交付）；`AskUserQuestion` 信号列为**可选增强**，仅在 plan 阶段实测确认且范围允许时采纳。据此，`[NEEDS CLARIFICATION] #1` 由"阻塞项"降级为"已有可行主方案，增强项待验证"。

### A-6 🔴 FR 修正两处（编排器审阅发现）

#### 修正 1：FR-008 的「以账本为准」**过于笼统**，与 C-14 冲突

FR-008 现写「判定器 MUST 以账本为**主证据源**，transcript 降为**次级佐证**；二者冲突时**以账本为准**」。

**问题**：实测 C-14（`research/harness-field-probe.md` P-6）已确证——**isFix 锚点（`Base directory for this skill:`）是注入到 user 消息里的文本，不是工具调用，PostToolUse 账本永远采集不到它**（本会话 transcript 实读：该文本出现在 `type=user / isMeta=true` 的条目，line 6）。因此在锚点这一维度上「以账本为准」是**空指令**——账本里没有可用于比较的事实；若实现按字面执行，锚点判定会退化。

**修正为按维度切分**（本表即 FR-008 的正确读法，plan MUST 按此实现）：

| 证据维度 | 主源 | 次源 | 冲突处置 |
|---|---|---|---|
| **isFix 锚点**（会话属哪个 spec-driver mode） | **transcript（唯一源，不可替代）** | 无 | 不存在冲突；transcript 不可读时保持现有 `indeterminate`/fail-open 语义，**不得**因账本存在就认为锚点已知 |
| **委派证据**（`delegation:implement`/`verify` 等） | **账本**（P-11 实证 `Agent` 工具触发 PostToolUse，`tool_input` 含 `subagent_type`） | transcript | 按 FR-008 修订版的**方向性**优先：仅 transcript 尾部缺证方向账本优先；账本有而 transcript 完整区段无 ⟹ 矛盾诊断 + 取更严一侧 |
| **F257 写入见证** 🔴 D-1 裁决 | **transcript（保持不动）** | 无 | ~~账本（取代）~~ ← 撤销：见证安全下界=harness 成功回执，账本 schema 无 `tool_response`，失败的 Write 同样产出账本条目，迁移即废除下界（审查 C-C3） |
| **F216 执行记录** 🔴 D-1 裁决 | **transcript（保持不动）** | 无 | ~~账本（取代）~~ ← 撤销：需命令**全文**精确比对 + 完整输出 + use↔result 配对 + `ambiguous` 歧义信号，最后者被账本主键去重设计**结构性消灭**（审查 C-C4） |
| **在途判定** | **`background_tasks`（harness 权威字段）** | 无 | 三态（FR-014） |

> 🟢 **这个切分与滞后特性互补**：transcript 的异步滞后伤的是**尾部（当前轮）**，而锚点位于**会话早期**（实测 line 6 / 共 321 行），通常早已落盘；真正受滞后伤害的尾部收口证据正是账本接管的部分。因此方案不是"绕开不可靠的源"，而是**让每类证据用它可靠的那一段**。
>
> ⚠️ **推论**：`transcript-unavailable` / `transcript-path-absent` 等诊断码**不得**因账本上线而废除（FR-034 已要求保留全部现有诊断码语义，此处给出其中一条的**具体理由**）。

#### 修正 2：FR-026 应从**手段性**要求改为**结果性**要求

FR-026 现写「判定器 MUST 能**识别**『流程处于 GATE 暂停、等待用户拍板』」——这是**手段**。而 A-4 的取证结论是：两个候选识别信号均不可用（`gatePauses` 非实时、文本启发式命中已证伪路线 #21），主方案「证据状态指纹去重」**恰恰不需要识别 GATE 这个场景**。

> **建议改写**：FR-026 → 「判定器 MUST 保证：会话在**证据状态无进展**期间反复触发 Stop 时，不产生误阻断、不消耗任何有界放行预算」。
> 理由：结果性要求同时被「指纹去重」与「场景识别」两条路径满足，不把实现锁死在一条**尚无可用信号**的路径上；且它覆盖了卡面未列举的同类误伤（用户离开、连续无进展 Stop），符合九轮史 M1「不要枚举形态」的教训。
> FR-027（专属诊断码）与 FR-028（不计 `blockCount`）**保持不变**，它们本就是结果性的。

## 附录 B · 异构对抗审查后的 FR 修订留痕（GATE_DESIGN）

> 三路异构对抗审查（fail-open / fail-closed / 回归面）共报 **22 CRITICAL / 21 WARNING**，三路总评一致为「净扩大」。完整处置见 `verification/adversarial-review-disposition.md`。
> 本节只记录**已落笔**的三处修订；其余 17 项修订待用户就「账本承担哪几类证据」（处置文档 §2 D-1）拍板后一次性落地。

### B-1 · FR-025 撤销（三路共识 · 最高置信）

原 FR-025 要求闸门三的计量基线随 FR-022 改为「最晚一次 fix 展开」。**三路独立**指出这**逐字等于** F257 第 4 轮**实测证伪**的实现：

> `fix-compliance-judge.mjs:95-100` 原文：「名字里的 `EARLIEST_FIX_` 是**承重的，不是修饰**……以最晚锚点为基线时攻击组每轮重新 `Skill(spec-driver-fix)` 展开即可令计数归零，**30/30 全 exit 0**……**不要改回去。**」
> `fix-compliance-core.mjs:1082`：「**绝不可**为『统一』把两个基线合并成一个。」

**归因（采纳 C 路）**：规范在「锚点」这一**单一概念层**做裁决，但代码里锚点是**两个刻意异向的量**——`anchorLineIndex`（最晚，服务 F216/F227/F224 的证据窗口）与 `earliestFixLineIndex`（最早，服务闸门三的单调上界）。病根 iv 诊断正确，但修法向下传播时把两个量当成了同一个。**方向不对称是 F257 刻意设计，不是待对齐的疏漏。**

**连带**：既有回归钉子 `judge-cli.test.mjs:2784`、`core.test.mjs:4625/:4699` 本会直接变红——这几条测试正是为防止此类回退而写的，它们**成功拦下了本次设计错误**。

### B-2 · FR-024 适用域收窄（主线程自引缺陷）

附录 A-3 的原始建议**带前置条件**（「曾出现过 fix 锚点但最终锚点非 fix 必须落审计」），但转写为 FR-024 时**前提丢失**，扩成对所有会话的**全称**落盘义务，与 F240 US5「健康路径零落盘」（全称否定，有 2676 份实扫背书）直接互斥，且会在无关用户项目里创建 `.specify/`。

**归因**：规范层的**量词漂移**——把一个**条件分支的审计**泛化成了**全称义务**。这是主线程在 A-3 → FR-024 转写中引入的，不是 specify 子代理的问题。

### B-3 · FR-026 由手段性改结果性

见 A-6 修正 2 与上方 FR-026 正文。核心：A-4 已证伪仅有的两个候选识别信号，继续要求「MUST 能识别」会把实现逼向已被判死的文本启发式。

### B-4 · 尚未落笔但已确认的最重两项（待 D-1 定向）

- **闸门组合上界消失**（A+C 共识）：FR-019 摘除闸门二 + B-1 前的 FR-025 + 闸门一只是语义谓词 ⟹ 三闸门全失守。且必答②#5 废除闸门二的正当性原文「#4 与 #6 两道闸门仍在合取中」，其承重前提**被规范自身的 FR-025 拆掉**。修法方向：闸门二在 `in-flight` 态**保留在合取中**。
  **关键归因（采纳 A 路）**：`background_tasks` 非空可被被判方**一条 `Bash(run_in_background)` 恒定诱发**——它不可**伪造**，但可**制造**。**放行判据需要的性质是「不可诱发」，不是「不可伪造」**；九轮史把该字段归入「被判方无法回退」的质变类，那个结论只对 **fail-closed** 用法成立。
- **「不计数」≠ 中性操作**（B+C 共识）：`blockCount` 同时是**唯一的解锁计时器**，不计数 ⟹ `releaseDegraded` 永不可达 ⟹ 会话锁死，违反 F208「Stop hook 不可 brick 会话」。修法方向：**任何不计入 `blockCount` 的裁决必须同时放行**。

### A-5 供对抗审查重点检验的四处（编排器指定）

1. 必答②裁决表中每一条「**改造**」——按 S-4 根因模式 **M5**（载体/通道复用不重做安全论证），改造处最易把 fail-open 与 fail-closed 的失效方向搞反。
2. 新增的**每一条放行通道**（`undetermined` 态、重入放行、GATE/指纹去重不计数、合规 PENDING、账本缺席回退）——逐条问：**它能否被单独触发以免于阻断？**
3. 账本条目的**归属判据**——按 **M4**（存在性冒充归属），"在账本里"不等于"属于本轮本次 fix"。
4. 真实录制语料的**必要性论证**——按 **M6**「全绿在这里是反指标」，合成 fixture 只能验证"实现符合我们的理解"。
