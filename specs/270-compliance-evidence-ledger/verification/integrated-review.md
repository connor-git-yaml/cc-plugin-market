# F270 集成态整体 review（六 Phase 全 commit 后）

**时点**：2026-09-01，7 commit 全部落地后（`06801f80..8a07b5ad`），**push 前**。
**动机**：per-phase 对抗只审各自 delta，**跨 phase 集成态无人审过**。本轮补这一层。
**执行**：主线程独立实跑 + 三路异构对抗子代理（fail-open / 病根覆盖 / 回归合同）。
**纪律**：所有 CRITICAL 均由**主线程亲自实跑复现**，不采信子代理的纸面结论。

**结论先行**：证据源换代的核心交换（用"可写账本"换实时性）依赖两个兜底——(a) 账本条目来自 harness 真实 hook、(b) 补充事件留痕可审计。**两条同时破了**，且新增一个用户可见的污染面。**不可按现状 push。**

---

## 发现总表

| # | 严重度 | 问题 | 首报 | 主线程复现 |
|---|---|---|---|---|
| 0 | 🔴 CRITICAL | **范围在 plan 阶段静默收缩** → 病根 iii/v + PENDING + snapshot-stale 无 Phase、无任务、无代码，而 SC/commit 按未裁剪口径报 | 对抗B | ✅ |
| 1 | 🔴 CRITICAL | `agent_id` 归属过滤缺失 → 子代理内部委派记到主会话合规账 | 对抗A | ✅ |
| 2 | 🔴 CRITICAL | 采集器击穿 F240 US5 零落盘 → 污染用户每个项目 | 对抗C | ✅ |
| 3 | 🔴 CRITICAL | 账本翻转合规时审计零留痕（唯一补偿控制失效） | 主线程/A/C **三方独立命中** | ✅ |
| 4 | 🔴 CRITICAL | 病根 iii 原样存活；US3 四个 `[必须]` FR 全空，任务却已勾选 | 主线程/A/C 三方命中 | ✅ |
| 5 | 🟠 重大 | `background_tasks` 无相关性过滤 → 无关后台任务换 3 次放行 | 对抗A | ✅ |
| 5b | 🔴 CRITICAL | **病根 v（状态竞态）零实现**，且本次往同一竞态覆写里再加字段 + 采集器放大并发面 | 对抗B | ✅ |
| 6 | 🟠 | FR-043/044 活性自检未实现（`ledgerResult.state` 构造但从不读） | A/C | 代码核实 |
| 7 | 🟠 | FR-010 `ledger-entry-corrupt` 未实现；坏行被静默吞 | A/C | 代码核实 |
| 8 | 🟠 | FR-011 超限读取侧零处理 → 残账本照常裁决 | 对抗C | 代码核实 |
| 9 | 🟠 | 账本 `noopVerify` 缺键在 core 回退里**自动选入** verify，非弃权 | 对抗C | 待验 |
| 10 | 🟡 | F240 硬禁令未进 D-1 决策视野（知情同意问题） | 对抗C | 文档核实 |
| 11 | 🟡 | SC-011 性能口径 under-report 2.4× | 主线程 | ✅ |

---

## CRITICAL-1 · `agent_id` 归属过滤缺失（不需伪造的 fail-open）

**位置**：`ledger-reader.mjs:98-112` 消费侧（全文 `agent_id` **零命中**），对照 `ledger-writer.mjs:100-101` 采集侧已透传。

**事实链**：
1. `research/harness-field-probe.md` P-2 直证：PostToolUse **对子代理内部工具同样触发**，且 `session_id` 与主线程**同值** → 子代理工具调用写进**同一个账本文件**；
2. P-3/C-4：`agent_id` **仅子代理调用时出现**，主线程整键缺席（结构性判据）；
3. writer 为此专门透传并有测试钉（`f270-real-corpus.test.mjs:49-58`）；
4. **reader 一视同仁全部计入 `delegations`**。

**实跑复现**（主 transcript：fix 展开 → 制品齐 → 主线程**只派一次** `general-purpose`，从未派 implement/verify）：

```
A 无账本            → exit 2  「缺少 implement 类委派：代码修复必须经 Task 委派
                                 implement 子代理执行（禁止编排器行内修改）」
B 账本两条带 agent_id → exit 0  放行
```

**不需要伪造任何字节**。触发它的是本仓常规行为：主线程派一个 `general-purpose`，该子代理在自己工作里再派一个名字含 `review`/`verify` 的助手。判定器于是把"会话树里有人派过"当成"主线程走了两阶段收口"——**F208 门禁的整个语义（禁止编排器行内修改）在这一支上失效**。

**spec 层断裂**：`spec.md:310` **FR-021 `[必须]`** 明文要求「`agent_id` 键缺席 MUST 被解释为主线程」。`grep FR-021 plan.md tasks.md` → **零命中**，该必须项从未落到任务卡。测试只钉采集侧，**消费侧零断言** → 采集半边全绿掩盖消费半边缺席。

**补充**（对抗A A3）：窗口只比 `hookTs`，不看子代理何时启动 → 跨过锚点继续跑的子代理，其内部委派同样落进窗口。transcript 侧"锚点后才算"的时序约束在账本侧无对应物。

---

## CRITICAL-2 · 采集器击穿 F240 US5「健康路径零落盘」

**位置**：`hooks/hooks.json:34-43`（`"matcher": ""` 匹配所有工具）+ `ledger-writer.mjs:126-133`（无任何「曾 fix 展开」闸门）

**实跑复现**（全新空目录，从未用过 spec-driver，单次 `Read`）：
```
空目录初始: 0 项
单次 Read 后: ./.specify/runs/.fix-compliance-ledger/plain-qa.jsonl
```

**后果**：装了插件的用户，在**每一个项目、每一次工具调用**都被写盘；纯问答会话也不例外。

**F270 自己的 spec 警告过这件事**：`spec.md:600` 明确写全称落盘义务「**会在无关用户项目里创建 `.specify/`**」——但该收窄只应用到了**判定器**的 FR-024，**没有应用到同一张卡新增的采集器**。`spec.md:320` 还声称「US5 不变量**保持不变**」。

**测试结构性失明**：US5 的两组守卫（`judge-cli.test.mjs:1425-1443`、`:3048-3059`）只跑 `fix-compliance-judge.mjs`，对姊妹采集器完全看不见。其断言文案「健康路径不得凭空创建 `.specify/`」正是采集器现在做的事。

---

## CRITICAL-3 · 账本翻转合规时审计零留痕（三方独立命中）

**位置**：`judge.mjs:912-919` 合规早退的 `buildAuditEvent` **不传** `extraDiagnostics`；而 `deferExtraDiagnostics`（含 `ledgerDiagnostics`）在 `:984` 才构造——**在该早退之后**。

**实跑 A/B**（唯一变量＝账本文件是否存在）：

| 组 | hook exit | compliant | 审计 diagnostics |
|---|---|---|---|
| A 无账本 | **2** | false | `[]` |
| B 账本补 verify | **0** | true | `[]` ← 丢失 |

对照：补充后**仍不合规**时诊断反而正常落盘。**可见性与安全重要性完全反相关。**

**为什么是 CRITICAL**：D-1 方向 X 接受「账本可写、只防疏忽」这一下界，其**唯一补偿控制**就是补充事件留痕（`judge:474-481` 自述「不再零留痕」「可事后审计」，schema 已登记该码）。留痕在唯一要紧的路径失效 ⟹ 伪造通过与诚实通过在审计流里**逐字节相同**。

**三重错位**：注释声称 ✅ / 实现未做 ❌ / 测试零覆盖（全仓 `tests/` grep `ledger-supplemented-role` **零命中**；恰好存在的 `:3268` 用例只断言 exit 0）。
讽刺点：这条注释本身就是 P4 对抗修 over-claim 时写的，**修出的新注释又是 over-claim**。

**修法已验证**（/tmp 副本，A 组零副作用）：
```js
// judge.mjs:917
        degraded: false,
        extraDiagnostics: result.ledgerDiagnostics || [],   // ← 新增
```

---

## CRITICAL-4 · 病根 iii 原样存活；US3 四个 `[必须]` FR 全空

**实跑复现**（GATE 暂停态：已派 implement、停在等用户拍板、证据零进展）：
```
stop#1 exit=2 blockCount=1    stop#2 exit=2 blockCount=2
stop#3 exit=0 ← 降级放行，门禁事实上关闭      stop#4 exit=0
nonBlockStopCount 全程 0
```
与卡面 §4 病根 iii 描述**一字不差**，改动前后行为**完全一致**。

**根因**：`routeNonBlock`（`judge:740`）**生产零调用点**，全仓只有测试直接 import（`judge-cli.test.mjs:3131-3225`）→ `nonBlockStopCount` 恒 0，两个 LIMIT 从不参与判定。

| FR | 要求 | 实际 |
|---|---|---|
| FR-026 | 无进展期间反复 Stop 不误阻断、不烧预算 | 未实现，实测烧穿 |
| FR-027 | GATE Stop 不判不合规 + 专属诊断码 | 未实现 |
| FR-028 | GATE 不计 `blockCount` | 未实现，实测 0→1→2 |
| FR-029 | 陈旧/undetermined/**重入** 不计 `blockCount` | 未实现 |
| SC-004 | GATE 期间 `blockCount` **0 增量** | **未达成** |

**跨 phase 承诺断链**：`tasks.md:67` T311 **已勾 `[x]`**，但其主体（重入接入 routeNonBlock）被 P3 对抗**正确撤销**，附带承诺「GATE 指纹通道随 P4 落」——**P4 做的是账本接入，从未接**。无人回头检查被推给下一 phase 的承诺。

**P3 撤销倒掉了不该倒的**：该撤的是「重入必放行」，不该撤的是「重入不计数」。现在重入照常烧 `blockCount`，与 FR-029 明文相反。

**不是能顺手补的一行**：FR-026 已记录两个候选识别信号均被取证排除（`gatePauses` 非实时且实测恒 `[]`；`last_assistant_message` 文本启发式命中已证伪路线 #21）。只剩 A-4 指纹去重一条路，spec 有设计、代码无实现，成本 ≈ 一个完整 Phase。**属范围决策。**

---

## 重大-5 · `background_tasks` 判在途丢掉全部锚定与相关性过滤

**位置**：`judge.mjs:975-983` + `in-flight-verdict.mjs:65-82`（判据＝纯"数组非空"）

harness 的 `Gw` 过滤器只看 `status ∈ {running,pending}`，收录类型含 `local_bash`（后台 Bash）、`monitor_mcp`、`session_crons` 等，**与"是否有委派在途"无关**。被取代的 `extractInFlightDelegationsAfter`（`core.mjs:759-773`）有三重硬化：只认 `Agent/Task/SendMessage`、必须 `lineIndex > anchor`、必须有非错误回执。**新判据三条全无。**

**实跑**（同一 transcript/制品，唯一差别是 `background_tasks`）：
```
无后台任务:         stop#1=2  stop#2=2  stop#3=0  stop#4=0
一个 npm run dev:   stop#1=0  stop#2=0  stop#3=0  stop#4=2
```

**非对抗场景自然触发**：任何人跑着 dev server / watch / `tail -f` 做修复，门禁自动松三格。对抗视角下触发成本从"发一次带回执的后台 Agent 派发"降到"一条 `sleep`"，且从 21.3% 概率性变成确定性。

闸门一/闸门三仍有效（实测 `entryCount=404→exit 0`、`434→exit 2`，420 封顶生效），故未评 CRITICAL。

---

## CRITICAL-6 · 病根 v（状态竞态）完全未实现，且本次**加重**了它

**位置**：`fix-compliance-io.mjs:364-391` `saveBlockState` 仍是裸 `fs.writeFileSync` —— 无锁、无 `O_EXCL`、无 atomic rename、无 CAS；4 个调用点全是 `loadBlockState → 改 → saveBlockState` 的裸 read-modify-write。JSDoc 还重申「整体覆写…**刻意不**做 read-modify-write 合并」。

**核实**：`FR-012` 在 `tasks.md` **零命中**（无任务、无测试、无代码）。本次唯一相关改动是**往同一个竞态覆写里再加一个字段** `nonBlockStopCount`。

**为何本次加重**：`research/harness-field-probe.md:204` 自己记着「实测表明**更普遍的并发源在单个 Claude 会话内部**（主线程 + 多子代理），与 Codex 是否双注册无关」——而 P5 新增的 `matcher: ""` 采集器让**每次工具调用**（含所有子代理的）都写盘，并发写入面显著变大。

---

## CRITICAL-7 · 范围在 plan 阶段静默收缩（所有 over-claim 的结构性根源）

卡面 5 个病根、spec 49 条 FR，而 plan 的 6 个 Phase **没有为病根 iii、病根 v、PENDING（FR-030..032）、snapshot-stale（FR-033）安排任何 Phase**，且 `plan.md §8`「spec 与代码现状矛盾记录」**也没登记这次裁剪**。

实测命中数（plan / tasks / 生产码）：
```
FR-012 (竞态)         → 0 / 0 / 0
FR-026 (GATE)         → 0 / 0 / 0
FR-030 (PENDING)      → 0 / 0 / 0
FR-033 (snapshot-stale)→ 0 / 0 / 0
```

**这就是「勾了但没做」的机制**：plan 静默裁掉范围 → tasks 按裁剪后的 plan 写 → **SC/commit 却按未裁剪的 spec 口径报**。三者对不上而无人对账。

### Over-claim 清单（逐条已核实）

1. **`judge.mjs:934` 注释「spec 必答③前提被推翻，**spec 侧已留痕修订**」— 假**。`git diff 06801f80..HEAD -- spec.md` = **0 行**，spec.md 自初始 docs commit 后一字未改。spec 必答③ 至今仍写着「`stop_hook_active===true` 时判定器**不得再次产生阻断、必须放行**」+「计入 `nonBlockStopCount`」，而实现做的**正好相反**（重入纯诊断、照常阻断、不计任何计数）。FR-029 同样未修订。
2. **`tasks.md` T311 `[x]`「FR-046：重入接入 routeNonBlock」— 与代码矛盾**（已撤线）。T307/T309 同样描述已撤销的 `firstNonBlockEntryBaseline` 锚设计，而 `judge:83/731` 的承重 JSDoc 仍在讲那套设计。
3. **commit `0dc64002` 标题「证据源换代**闭环**」— 实际是单维度补充**（只增不减的 roleClass 补齐）。注释已被 P4 对抗逼着改如实，但 commit 标题未改。
4. **commit `d92e1424` 标题「解锁计时器」— 生产中是死的**（正文诚实写了"预算照旧"，但标题与卡面"取代次数预算"口径对不上）。
5. **`plan.md:35` Constitution 原则 IV 检查栏打勾「snapshot-stale 分家、PENDING 计数 ✅」— 纸面通过**，两者各**零行代码**。
6. **commit `8a07b5ad`「15 SC：13 达成 + 3 部分」— 严重偏乐观**。

### SC 诚实口径重算（对抗B 逐条核实）

| 判定 | SC |
|---|---|
| **真达成 6** | SC-003 / 005 / 006 / 007 / 010 / 013 |
| **部分 4** | SC-001（阈值未动）/ SC-002（真实语料只覆盖一态）/ SC-008（vitest 侧未复跑）/ SC-009（`last_assistant_message` 那条测的是无消费者的字段；账本消费那条只跑写侧纯函数） |
| **未达成/假达成 5** | SC-004（无 GATE 机制）/ SC-011（**全仓零耗时断言**；实测全链 63ms > spec 建议 ≤50ms）/ SC-012（哨兵只写不读、两态生产产出相同）/ SC-014（**假达成**：靠死代码 + 测试直调）/ SC-015（backstop 长在死代码里，换桶矩阵语料 P6 未做） |

我在 P6 自查与 commit 里报的「13 达成」应更正为 **6 真达成 / 4 部分 / 5 未达成**。

### 变异测试结论（守护力实证，对抗B 执行）

| 变异 | 结果 | 含义 |
|---|---|---|
| M1 还原 `anchor.mode==='fix'` | **红**（端到端） | 病根 iv 守护成立 |
| M2 五窗口回退 `anchorLineIndex` | **红**（端到端） | 同上 |
| M3 undetermined 坍缩进 no-in-flight | **27 个红** | 三态守护很强 |
| M5 `ledgerSupplement = []` | **红** | 账本接线守护成立 |
| **M9 `routeNonBlock` 首行 `return 0`** | **只多 5 个红，全部是直接 import 的单元测试，零端到端失败** | **死代码铁证** |

---

## 其余 WARNING（子代理报告，主线程按代码核实，未逐条实跑）

- **W-6 FR-043/044 活性自检未实现**：`ledgerResult.state` 在 `judge:479-485` 构造后**再无消费点** → 「账本缺席（采集器挂了）」与「账本存在但无委派」行为完全相同。P1 写的 `ledger-open` 哨兵被 reader `:74` 的 `continue` 跳过。`spec.md:358` FR-044 原文：「二者坍缩即把 F245 的静默失效重演一遍」。方向 fail-closed，但采集器整条挂掉时门禁**零信号**——正是 F245 病根形态。
- **W-7 FR-010 未实现**：坏行只 `corruptCount += 1`，而 `corruptCount` 被判定器丢弃；`ledger-entry-corrupt` 码全仓不存在（实现的 `ledger-entry-conflict` 描述的是另一件事）。验收场景 5 不可达。
- **W-8 FR-011 超限读取侧零处理**：writer 达 1MB 停写只记自诊断（判定链无人读），reader 无超限感知 → 残账本照常补充委派，与「MUST NOT 以残账本裁决」相反。
- **W-9 账本 `noopVerify` 缺键 ≠ 弃权**：reader `:110-111` 注释称「刻意不产 `noopVerify`」，但 `core.mjs:1777` 回退是 `(d.noopVerify === undefined && cls === 'verify')` → **省略该键自动选入 verify 回退**。对抗C 实测一条纯账本 verify 委派即满足 `delegation:noop-verify`。（F216 核心复现证据门仍走 transcript 执行记录，未受影响。）
- **W-10 知情同意问题**：F240 `spec.md:150` 有硬禁令「**MUST NOT** 以 `.specify/runs/` 作为主信号源替代 transcript」，`:148` 论证其不构成可信安全边界。F270 spec 全文引用 F240 仅 `:320`/`:600` 两处且都只谈 US5，**从未引用这条禁令**。用户对 D-1 的拍板是在该禁令未被摆上桌的情况下做出的 → 建议补显式豁免留痕。
- **W-11 SC-011 口径 under-report 2.4×**：记的 18ms 只是 node 冷启，实测端到端 43–45ms（两方独立测得一致）。300 次工具调用 ≈ 13 秒阻塞叠加。

## INFO

- `firstNonBlockEntryBaseline` 幽灵字段（`judge:1006` 恒写 `undefined`，io 层 P3 后已删该字段）
- 账本 `ok` / `prompt_id` / `agent_id` 均写入但从不读取
- `ledger-reader.mjs:115` 成功路径漏带 `windowUndetermined`（JSDoc 声明了，当前无消费者）
- 去重先于窗口过滤（`:81-99`）：同 id 两条 hookTs 分居窗内外时，窗内条可能被折叠（方向 fail-closed）
- F264 陈旧计数注释：`codex-hooks-schema.mjs:18`「5 条一条不缺」、`:471`「5/5 完全对齐」应为 6；`codex-hooks-event-gate.test.ts:401` 测试名「五条」但断言 `toHaveLength(6)`
- project root 口径不一致：`post-tool-use-ledger.sh:48` 用 `$(pwd)`，`postinstall.sh:29` 用 `${CLAUDE_PROJECT_DIR:-$(pwd)}`

---

## 经变异测试核实**未**被破坏的保证（对抗C 执行）

| 保证 | 结论 | 变异 |
|---|---|---|
| F208 三层语义 | 完好（`judgeCompliance` 层结构零改动） | — |
| F211 remediation reset | 完好 | — |
| F216 no-op 证据门 | **未重蹈否决理由**（F216 否决的是**替代**账本，F270 是纯补充，只增不减） | — |
| F231 光杆命令判据 | 零改动 | — |
| F257 闸门三取**最早** | 完好，红字注释原样在 | 改 `anchorLineIndex` → **红** ✅ |
| JUDGE_FILE_SET 闭包 | 完好，10 项，传递闭包已覆盖 | 删任一新模块 → **红** ✅ |
| F264 双处登记 | 完好，两表均 6 条 | — |
| saveBlockState 整体覆写 | 完好，4 个调用点全带回 `nonBlockStopCount` | 各删一处 → **均红** ✅ |

另核实：`sanitizeSessionId` 挡住账本文件名路径穿越；账本落点被仓库 `.gitignore:55` + F207 `SPEC_DRIVER_GITIGNORE_ENTRIES` 双重覆盖，不会误入 commit。

对抗A 明确报告**找不到 CRITICAL 的面**（不为凑数升格）：账本读取全部异常分支（坏 JSON / 空文件 / 200KB 单行 / 非串 `tool_name` / NUL 字节 / 账本是目录）**全部正确 fail-closed 无一崩溃**；`background_tasks` 五种改型均按三态规约正确处置；窗口对齐两支均正确。

---

## 结论与建议

**站得住**：P2 锚点三分（病根 iv 真修，实测有效）、三态 `undetermined` 不坍缩、采集器薄壳恒 exit 0 且静默、闸门三封顶、账本补充为保守并集、九项既有保证经变异测试全部存活。

**核心交换未成立**：换代用「承认账本可伪造」换实时性，代价由两件事兜底 —— (a) 账本条目来自 harness 真实 hook、(b) 补充事件留痕可审计。实测 **(a) 缺 `agent_id` 维度（FR-021 从未落到任务卡）、(b) 恰在放行路径失效**。两条同时破 ⟹ 存在一条**不需伪造、不留审计痕迹、把 exit 2 变 exit 0** 的路径，**比已登记接受的下界更低**。

**病根覆盖诚实口径**（对抗B 逐个变异核实）：

| 病根 | 判定 |
|---|---|
| i transcript 滞后 | **半修** — 只换了「委派」一维；另 4 个证据窗口（F257 见证 / F216 执行记录 / 目录提名 / transcript 派生在途）与锚点本身仍只读 transcript，而 `plan.md:54` 自己承认「滞后伤的是尾部，而见证/执行记录恰恰也在尾部，这部分收益确实损失了」 |
| ii 预算耗尽 | **半修** — `IN_FLIGHT_DEFER_LIMIT=3` **一行未动**，仍在合取里；改善的只是"假在途不再烧预算" |
| iii GATE 暂停 | **未修** — 无任何指纹计算，方案函数是死代码 |
| iv isFix 锚点 | **已修** — M1/M2 双端到端变异均红，守护到位 |
| v 状态竞态 | **未修** — 且本次加重 |

**push 前必须处置**：
1. **CRITICAL-1**（`agent_id` 过滤）— FR-021 的直译，reader 逐条 `if (Object.hasOwn(entry,'agent_id')) continue;` + 消费侧断言
2. **CRITICAL-2**（US5 击穿）— 给 writer 加「曾 fix 展开」闸门或收窄 matcher；US5 守卫需覆盖采集器
3. **CRITICAL-3**（审计留痕）— 一行 + 断言测试（修法已验证）
4. **CRITICAL-4**（病根 iii）— **范围决策**：(a) 补做指纹去重通道（≈一个 Phase），或 (b) 诚实降级：标记未实现、移交后续卡、撤回 T311 勾选、修正 SC 自查与 commit 叙述。**不可维持「勾了但没做」的现状。**
5. **重大-5**（在途相关性）— 需结构性判据收窄（注意 `type` 是展示别名 T-1，不能照抄；候选是 `agent_type` 键存在性）

W-6/7/8 三条 FR 未实现应一并处置或显式降级。W-10 建议补 D-1 豁免留痕。

---

# 处置记录（同日，用户裁决「按三步走」）

## 已修三条（会造成实际伤害的）

| # | 修法 | 位置 | 修前 → 修后（实跑） |
|---|---|---|---|
| CRITICAL-1 | reader 剔除带非空串 `agent_id` 的条目；全部条目都带则落 `ledger-agent-id-inversion-suspected`（FR-021 后半：落诊断不改判） | `ledger-reader.mjs` | 子代理内部委派：**exit 0 → exit 2** |
| CRITICAL-2 | writer 最前置 `isSpecDriverProject`（`.specify/` 已存在才写，采集器绝不自建）；matcher `""`→`"Agent|Task"` | `ledger-writer.mjs` / `hooks.json` | 空目录单次工具调用：**建 `.specify/` → 0 项** |
| CRITICAL-3 | 合规早退的 `buildAuditEvent` 传 `extraDiagnostics: result.ledgerDiagnostics` | `judge.mjs:917` | 翻转合规的审计：**`[]` → `["ledger-supplemented-role"]`** |

设计要点：
- `agent_id` 判据取 **非空串**——`null`/`0`/`''`/`false` 等改型不臆断为子代理，按主线程保留（与 in-flight 三态「形状异常不猜方向」同纪律），可观测性由翻转诊断兜底。
- US5 闸门置于 `isClaudeShape` **之前**：`appendSelfdiag` 自身也 `mkdirSync`，方言跳过与写失败两条兜底路径若在闸门之后就会穿透它。
- matcher 收窄的依据是 D-1——账本只承担委派证据，reader 本就只消费 `DELEGATION_TOOL_NAMES={Agent,Task}`，全量触发是纯开销（43–63ms/次且阻塞）并放大病根 v 的并发面。

## 自查抓到的新引入缺陷（修分歧引入新分歧，本卡第四次）

新诊断码 `ledger-agent-id-inversion-suspected` 会经 `ledgerDiagnostics` 直通审计事件，而
`fix-compliance-verdict-event.schema.json` 的 diagnostics 是 **`additionalProperties:false` 的闭集
enum**——漏登记即合同漂移（`fix-compliance-core.mjs:517` 明文要求新增码必须同步该 schema）。
实跑确认该码确实落进审计事件后补入 enum，并新增**合同同步守卫**（reader 导出的全部诊断码 ⊆
schema enum），与既有 `FOREIGN_DIALECT_DIAGNOSTICS` 同步用例同源纪律。

## 端到端验证（真实 hook 脚本 + 真实判定器，非单元桩）

```
① transcript 零委派（模拟异步滞后）      → exit=2
② 真实 hook 采集 2 次主线程委派          → 账本 3 行（1 哨兵 + 2 条目）
③ 账本补齐后重判                         → exit=0        ← 账本能力完好
④ 审计留痕 compliant:true, diagnostics:["ledger-supplemented-role"]
⑤ 同样两条委派但带 agent_id（子代理内部）→ exit=2        ← 归属过滤生效
```
一条链路同时证明「功能保留」与「缺陷修复」，且 ③④⑤ 分别对应三处修复。

**验证构造教训**：首次跑该链路时 ③ 失败——原因是我把 transcript 的 fix 展开时间戳造成了**未来
时间**（`2026-09-01`），而真实 hook 写的 `hookTs` 取当前系统时钟（`2026-08-31`），必然小于窗口
下界被滤掉；另有 `$RANDOM` 撞号触发 `ledger-entry-conflict`。是**验证构造缺陷**而非代码缺陷，
但它顺带实证了 `ledger-reader.mjs` JSDoc 里登记的承重假设（hookTs 与 transcript timestamp 是
两个独立时钟源的裸词法比较）是真实可触发的风险面。

## 回归基线

- `npm run test:plugins`：**1673 tests / 1671 pass / 0 fail**（改前 1661/1659，新增 12 个用例）
- `npx vitest run`：**7894 passed / 0 fail / exit 0**（与改前逐字一致；`onTaskUpdate` 超时是
  F235/F269 已登记的 birpc 噪声，exit 0 即非真红）
- `npm run build` 通过；`npm run repo:check` 仅预存 `graph-quality:freshness` warn
- 改动范围：生产码 5 文件 +108/−14，零 `src/` 改动

## 未修的按用户裁决移交后续卡

病根 iii（FR-026..029）/ 病根 v（FR-012）/ PENDING（FR-030..032）/ snapshot-stale（FR-033）/
FR-043/044 活性自检 / FR-010 坏行码 / FR-011 超限 / 在途相关性过滤 / W-9 账本 `noopVerify` 回退语义。
逐条状态见 `tasks.md` Phase 7；SC 诚实口径已更正为 **6 真达成 / 4 部分 / 5 未达成**；
`plan.md §8` 已补登「范围在 plan 阶段静默收缩」这一结构性根因。

**新登记的连带影响**：matcher 收窄后，坍塌会话（fix 展开但零委派）不再产生账本文件 → 「账本缺席」
与「账本存在但无委派」两态在该场景下不可区分。当前无影响（两者都产出空 delegations、判定一致），
但后续实现 FR-044 时不能依赖账本文件的存在性做活性判据，需改用 SessionStart 侧哨兵或等价机制。

---

# 修复的对抗审查（第二轮，commit 前）

门禁类改动按仓规必须过异构对抗。两路审查**这三处修复本身**——结果是**修复里又有三个真问题**
（本卡第五次「修分歧引入新分歧」，这次是修复引入的）。

## 对抗 D-CRITICAL-1 · US5 闸门在生产接线下恒为真（我选错了判据）

`scripts/postinstall.sh:40` 在 **SessionStart**（`hooks.json` 里 matcher 为空＝每个项目每次会话）
无条件 `mkdir -p "$PROJECT_DIR/.specify"`。SessionStart 必然早于任何 PostToolUse ⟹
`isSpecDriverProject()` 初版判据「`.specify/` 存在」在装了插件的**任何**项目里恒为真，
**闸门对它自己描述的病灶零效力**。

主线程复现：
```
干净项目 + 真实 postinstall.sh → 目录 [.specify app.js]
再跑采集器 → .specify/runs/.fix-compliance-ledger/s.jsonl  🔴 照落
```

**为什么我的测试全绿也没发现**：US5 那组用 `mkdtemp` 干净目录直接调 `appendLedgerEntry`，
**从不执行 postinstall.sh**。这正是本仓 F274 已登记的教训「参数化测试全绿≠生产接线有守护，
须接线断言」——我 memory 里就有这条，仍然犯了一遍。

**修**：判据换成「`.specify/` 里除 `.spec-driver-path` 外还有别的条目」（`project-context.yaml` /
`templates/` / `runs/` … 由 init 或流程自身产出，postinstall 不产）。
**并补生产接线断言**：测试里真的跑一遍 `postinstall.sh` 再验闸门仍拦得住 —— 已绿。

如实登记：判定器自身的 fail-open 路径（畸形 payload → `payload-invalid` 审计）同样会在非
spec-driver 项目建 `.specify/`，不在本次范围内；采集器侧减污染靠闸门 + matcher 收窄两者叠加。

## 对抗 D-CRITICAL-2 · 审计留痕只补了两条翻转路径中的一条

账本把裁决翻成 exit 0 有**两条**路径，我只补了「合规」那条。另一条：`evaluate()` 的
`featureDirUndetermined && hasVerifyClassDelegation` 早退——而 `hasVerifyClassDelegation` 算的是
`delegations` ＝ transcript **＋账本补充**，账本一条 verify 就能把该谓词翻成 true，走
`tryAppendFailOpenEvent` 降级放行，**不带 `ledgerDiagnostics`**。

对抗 D 实跑：零委派 + `git mv` 到非规范目录 + 账本补 verify → `exit 2 → exit 0`、stderr 全空、
审计事件与「真派了 verify 又改名」的诚实降级**逐字节相同**。

而我在 `judge:939-941` 写的注释断言「『不再零留痕』由这一行兑现」——在这条路径上是**假的**，
又一次承重面 over-claim。

**修**：早退返回带 `ledgerDiagnostics`；`runHook` 的 `tryAppendFailOpenEvent` 合并该数组。配 e2e 断言。
（范围如实：这条路径修前修后都是 exit 0，**不是新增绕过**，是我声明的不变量未成立。）

## 对抗 D-WARNING-1 · `agent_id` 判据对上游形状变更 fail-open

我写的是**值判定** `typeof === 'string' && length > 0`，而同段注释自称的 C-4 是**键存在性**
「`agent_id` 键整体缺席＝主线程」。二者不等价，且探针实测姊妹字段 `agent_type` 正是 `a ?? ""`
（空串而非缺席）语义。对抗 D 实跑五形：

```
agent_id:"a1"（当前实测形） → 剔除✅ 翻转诊断响  exit=2
agent_id:""                 → 保留❌ 诊断不响    exit=0  ← CRITICAL-1 复活
agent_id:null               → 保留❌ 诊断不响    exit=0
改挂 agentId 驼峰 / 嵌套     → 保留❌ 诊断不响    exit=0
```
翻转诊断挂 `subagentSkipped === delegationSeen`，在「一条都没命中」（正是失效场景）时
**结构性不可能触发** ⟹ 等于新增了一个会静默退回病灶态的判据。

**我把自己引用的纪律用反了**：in-flight 三态的 `undetermined` 落在**保守**分支，而这里的
「形状异常 ⇒ 按主线程保留」落在**放行**分支，方向恰好相反。

**修**：判据改 `Object.hasOwn(entry, 'agent_id')` 存在性判定，测试从「非串按主线程保留」
**反转**为「键存在即剔除，值形状不参与」。安全上界由对抗 D I-1 实证：账本是纯补充源、委派判定
只做 `count >= 1` 的单调判断，故「剔多了」的最坏后果 ＝ 等于没有账本 ＝ F270 之前的基线，
**不会**产生高于基线的误阻断 —— 宁可多剔，不可漏剔。
（这同时推翻了我原来的假设：我以为「形状异常按主线程保留」是保守方向，实际是放行方向。）

## 对抗 D-WARNING-3 · report 模式不暴露 `ledgerDiagnostics`（已一并修）

与 C-2 叠加后，`feature-dir-unresolvable` 那条路上账本翻转在审计与 report **双盲**，事后无任何
取证入口。已按 `inFlightDelegations` 等事实字段的先例透传进 report，配断言。

## 对抗 D 确认的正面结论

- **9 场景 HEAD/工作区差分矩阵：零个场景从 exit 2 变 exit 0**，两处行为变化都是 exit 0→2（收紧）：
  子代理内派委派（S3）、零委派+改名+子代理账本（S6）。三处修复**未引入任何新绕过**。
- 崩溃面：新代码不可抛（`isSpecDriverProject` 全体在 try 内、`typeof`/`hasOwn` 无抛点、
  `result.ledgerDiagnostics || []` 在 try 内）；10 条畸形条目（`__proto__` 注入 / NUL / 200KB
  `subagent_type`）全部不抛，1ms 内完成，无 ReDoS。
- matcher 口径核对**通过**：`ledger-reader.mjs` 与 `fix-compliance-core.mjs` 的
  `DELEGATION_TOOL_NAMES` 均为 `{Agent, Task}`，未漏采集委派工具名。
- 回归面：ledger 两文件 36/36、judge-cli 205/0、codex-hooks 三组 98 pass（matcher 改动未造成
  Codex 侧生成物漂移）。

## 对抗 D-WARNING-2 · matcher 收窄的代价未登记（已补登）

收窄后零委派会话不再产生账本文件 ⟹ 「文件不存在＝采集器可能没装」与「仅哨兵＝采集器活着但本段
无委派」两态坍缩，而**零委派会话正是 F208 要抓的坍塌会话本体**；`AskUserQuestion`（病根 iii 仅存
的权威信号之一）也不再进账本。当前无判定影响（两态都产出空 delegations），但后续实现 FR-043/044
时不能依赖账本文件存在性做活性判据。已补登进上文「新登记的连带影响」与
`codex-hooks-schema.mjs` 注释（此前只写了性能理由）。

## 对抗 E（回归面 + 变异测试）· 三个 CRITICAL，全是边界没闭合

对抗 E 的核心方法是变异测试与真实管线探针，抓到的三条都不是「新绕过」，而是**我的修复只做了半边**。

### E-C1 · writer / reader 的 `agent_id` 谓词不对称 —— 消费侧单独加固无效

我把 reader 改成 `Object.hasOwn` 存在性判定，**writer 没改**：`ledger-writer.mjs:100` 仍是
`typeof payload.agent_id === 'string'`。主线程实证 `buildLedgerEntry`：

| `payload.agent_id` | 落盘条目含 `agent_id` 键？ |
|---|---|
| `"agent_abc"` / `""` | ✅ 有 → reader 剔除 |
| `null` / `0` / `false` / `{}` | ❌ **键被抹掉** → reader 判为主线程 |

⟹ reader 新守的六形态里只有两种能穿过 writer，`null` 一类**根本到不了 reader**。
「宁可多剔」在真实管线上被上游谓词反转成「漏剔」，CRITICAL-1 病灶对这些形态完整复活且零诊断。

**教训**：谓词不对称时，**严的那侧被松的那侧决定**。测试没抓到是因为 reader 的六形态用例走
`writeRaw` 直写 JSONL **绕开 writer**，而唯一的 writer→reader 端到端用例不带 `agent_id` ——
整条链上没有把两个谓词接起来的断言。

**修**：writer 改 `Object.hasOwn` 并把 `undefined` 归一为 `null`（`JSON.stringify` 会丢掉值为
`undefined` 的键，那会在落盘时抹掉「键存在」这一承重事实）。**新增六形态经真实管线的端到端守卫**。

### E-C2 · US5 闸门被三条向量**自举打开**，且不可逆

第二版判据「`.specify/` 里除 `.spec-driver-path` 外还有别的条目」被实证击穿：

| 向量 | 构造 | 后果 |
|---|---|---|
| ① 采集器自伤 | 一次非 JSON stdin → `main()` 的 parse-error 分支调 `appendSelfdiag`，**不经过闸门**，自己 `mkdirSync` 建出 `.specify/runs/` | 判据翻永真 |
| ② 判定器开采集器的闸 | 一次畸形 Stop payload → judge fail-open 写 `.specify/runs/<month>.jsonl` | 同上 |
| ③ 判据过宽 | `.DS_Store`（Finder 进过该目录即可） | 同上 |

**一旦绕开不可逆**——第一次落盘就把闸门焊死在开。我在第二版注释里已经写到「判定器也会建
`.specify/`」，却把它归为「不在本次范围内」，**没意识到它打开的正是我新加的这道闸门**。

**修**：判据改**白名单**（只认 `project-context.yaml` / `templates` / `memory` / `scripts` 等
init 与流程本身的产物，运行态 `runs/` 与系统文件一律不算）；`appendSelfdiag` 内部也加闸门
（兜底路径不能比主路径宽）。三条向量各配守卫。

### E-C3 · 「账本不判 no-op」的承诺被 `undefined` 语义端到端推翻

`ledger-reader.mjs` 注释逐字写着「`noopVerify` **刻意不产**……账本委派不判 no-op」，而消费侧
`fix-compliance-core.mjs:1777` 的判据是
`d.noopVerify === true || (d.noopVerify === undefined && cls === 'verify')`
—— **`undefined` 不是中立值，它恰好是回退分支的触发条件**。「刻意不产」于是让每条账本 verify
都计进 `noopVerifyCount`：

```
无账本      missing = ["delegation:noop-verify","noop:repro-fields"]
账本 1 条 verify  missing = ["noop:repro-fields"]      ← 委派要求被一行 JSONL 关掉
```

F216 no-op 合同的委派半边从「harness 背书的 transcript tool_use」降到「会话自身可写的一行
JSONL」，而承重注释宣称的正好相反。全仓正反两向零测试。

**修**：账本委派显式产 `noopVerify: false` —— 弃权的正确编码是 `false`，不是省略。配 e2e。

### 对抗 E 的 WARNING（全部已处置）

| # | 问题 | 处置 |
|---|---|---|
| W-1 | matcher 收窄**零守护**（M4 变异 0 红），且收窄理由陈述失实（称全量触发是「纯开销」，实则它同时是活性哨兵的落地基质） | 导出 `DELEGATION_TOOL_NAMES` 并加**派生式** matcher 同步守卫；补登代价（见下）|
| W-2 | 诊断码闭集守卫是**硬编码白名单**，只能抓「删已知项」，抓不到「加新项漏登记」——正是它声称要防的方向（M7b 变异 0 红）| 建 `LEDGER_DIAGNOSTICS` canonical 表，守卫改**从表派生**（与 `FOREIGN_DIALECT_DIAGNOSTICS` 同源纪律）|
| W-3 | 真实语料主验收对 `agent_id` **零覆盖**（fixture `grep -c agent_id` = 0），`if` 半边从未执行，而用例名声称覆盖 | 从 101 份真实录制库取一条**真实子代理条目**脱敏入库；用例改为双分支硬断言；如实登记「子代理内部再派子代理」形态本仓无真实样本（4 条委派全是主线程派）|
| W-4 | defer 成功路径丢 `ledgerDiagnostics`（账本影响力唯一仍不可见的审计路径）| 并入；配 e2e，并**实跑确认真的走到 defer 分支**后把测试的 if/else 兜底改成硬断言 |
| W-5 | 翻转诊断只有单元守护（M6 只红 1 条单元，零端到端）| 加端到端断言（翻转码抵达审计事件）|
| W-6 | 我的注释自证伪：称「spec.md 在本卡全部 commit 里改动 0 行」，而同一 changeset 就给它加了 21 行 | 改为准确表述（「自初始 docs commit 起、直到六个 Phase 全部落地为止一字未改；该矛盾已在集成 review 中补记进 §0-pre」）|
| W-7 | spec FR-001「每次工具调用」与 matcher 收窄直接冲突；tasks T501 仍标「matcher 空」 | 两处均补修订登记 |
| W-8 | 判据过宽 | 见 E-C2 白名单 |

### 对抗 E 确认未破坏的既有保证

- **JUDGE_FILE_SET 仍完整**：`judge-file-set-guard.test.mjs` 用 `resolveStaticImportClosure` **派生**
  真实闭包并 `deepStrictEqual`（非硬编码），本轮零新增 import。`hooks.json` 不在该集是正确的
  （不进判定器 import 闭包）。
- **F264 双处登记未失配**：两表键都是**脚本后缀**，判定链全程不经过 `matcher`，`collectHandlers`
  打平时也不携带它 ⟹ matcher 改动结构上不影响该链路。两表仍 6/6。
- **`beforeEach` 预置 `.specify/` 未掩盖语义**：删掉它 → 8 条既有用例**响亮变红**（非静默变绿）；
  方言跳过守卫独立成立。
- **F208/F240 US5 判定器侧全绿**：新闸门只加在采集器，`runHook` 的「非 fix 会话零接触放行」逐字未动。

### 变异测试对照（守卫牙齿，第三轮后重测）

| 变异 | 对抗 E 实测（修前） | 本轮修后 |
|---|---|---|
| M4 matcher 还原成 `""` | **0 红**（完全失明） | **1 红**（派生守卫） |
| M7b 新增诊断码不登记 schema | **0 红**（完全失明） | **1 红**（canonical 表派生） |
| M1 删 `agent_id` 归属过滤 | 4 红（含 CLI 端到端） | 保持 + 新增真实管线六形态守卫 |
| M2/M15 删闸门 / 判据退回 | 4 红 / 1 红 | 保持 + 新增三条自举向量守卫 |
| M3/M13/M14/M16 各审计路径 | 各 1 红（端到端） | 保持 |
| M6 删翻转诊断 | 1 红（**仅单元**） | 新增端到端断言 |

## 最终基线（三轮修复后）

- `npm run test:plugins`：**1688 tests / 1686 pass / 0 fail**（改前 1661/1659，累计新增 27 用例）
- `npx vitest run`：**7894 passed / 0 fail / exit 0**（与改前逐字一致）
- `npm run build` 通过；`repo:check` 仅预存 `graph-quality:freshness` warn；`release:check` valid

新增守护清单（全部经变异验证有牙齿）：
- `agent_id` 归属过滤：单元六形态 + **真实管线 writer→reader 六形态** + CLI 端到端 + 真实录制语料双分支
- US5 闸门：函数级 + CLI 进程级 + **真跑 postinstall.sh 的生产接线断言** + **三条自举向量**
- 审计留痕：合规路径 / `feature-dir-unresolvable` 路径 / **defer 路径**（实跑确认真走到该分支）/ report 可见性
- 合同同步：诊断码 ⊆ schema enum（**从 canonical 表派生**）、matcher ⊆ `DELEGATION_TOOL_NAMES`（**派生**）
- no-op 弃权：账本委派显式 `noopVerify:false` 的单元 + e2e
