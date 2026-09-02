# GATE_DESIGN 对抗第 2 轮 · 处置记录

**对象**：第 1 轮修订后的设计（`plan.md`）。两路独立子代理（绕过面 / 误伤面），只报**新**问题。
**结果**：**8 个新 CRITICAL**（绕过面 4 + 误伤面 4）+ 12 个 WARNING/INFO。
**其中 1 条由主线程亲自实跑复现**（C-A），2 条由子代理给出可复现的大样本实测（G3 计数、G4 集合归属）。
**判定：本轮不通过，必须修订后再跑第 3 轮**（卡面规定 GATE_DESIGN 走「对抗-修订-再对抗至零新 CRITICAL」）。

> 第 1 轮的 D-1..D-8 已处置，本轮不重复。本文件只记**新**结论与主线程裁决。

---

## 一、主线程亲自实跑复现的 CRITICAL

### R2-1 🔴 `ok:false` 是**自诱发**的 ⟹ 首次 Stop 即 exit 0（既有缺陷，本卡触碰同一路径）

**来源**：绕过面 C-A。**主线程实跑复现**（/tmp 副本，唯一变量＝状态文件位置是否被目录占位）：

```
A 正常首次 Stop:        {"exit":2}
B 主路径+tmpdir 两级均被目录占位: {"exit":0, "[GATE-DEGRADED] 已达阻断上限(2 次)，本次降级放行"}
```

构造成本 = 两条 `mkdir`。**零成本、确定性、改动前就存在。**

**归因**：第 1 轮 D-1 只把「存储不可用不可自诱发」这条**错误前提**从锁文件上摘掉，
**没有回头复核它在 `ok:false` 自己身上是否成立**——而状态目录（`.specify/runs/…`，projectRoot 下）
与锁文件在**同一个写域**。这正是本仓登记过的「载体复用而不重做失效方向论证」。
`plan.md` 反而把该前提固化成设计依据。

**裁决**：**修，纳入 G1**。修法**不采纳**子代理建议的 errno 分类（EISDIR vs EACCES 可被换别的方式打），
改用本仓既有的**不可擦 backstop** 同构形态：

> `saveBlockState` 两级写失败 ⟹ **保持本次裁决自身语义（不合规即 exit 2）**，
> 放行上界挂 transcript 派生的单调量 `assistantEntriesSinceEarliestFix`（与闸门三 / `NON_BLOCK_ENTRY_LIMIT` 同源）。

既 fail-closed 又不 brick（F208），把这条绕过的成本从 **0** 抬到 **~420 个 assistant entry**。
errno 只进诊断码做可观测性，**不参与判定分支**。
**范围登记**：这是本卡**新增**的处置项（既有 fail-open，第 2 轮对抗实测发现），
纳入理由＝它直接破坏护栏 **R-11「总上界必须存在」**，且本卡正在改的就是这条 `!saved.ok` 路径。

---

## 二、改变设计结构的 CRITICAL

### R2-2 🔴 **G1 与 G2 不可分离**：只加锁会让「一次 Stop 吃两格预算」（误伤面 N-1，本轮最重）

**归因链**（主线程复核成立）：
1. 生产并发源经 F270 实证是「**同一个 Stop 事件 → ≥2 个判定器进程 → 同一 `session_id`**」
   （Codex 双注册 / 单会话内主线程+子代理）；
2. `saveBlockState` 的**丢更新此前恰好充当了「每 Stop 只计一次」的去重**；
3. G1 只修写原子性、**没定义计数的幂等键** ⟹ 加锁后两个进程串行各 +1，
   `blockCount` 一次 Stop 从 1 跳到 2 ⟹ `BLOCK_LIMIT=2` 在**第 2 次 Stop** 就耗尽；
4. 后果三条：① FR-006「同会话至多 2 次阻断」实际降为 **1 次**，诚实用户少一次补救机会；
   ② `judge:707` 的终态文案写死「在 **3** 次不合规尝试后降级放行」，而用户实际只被阻断 1 次
   ——**审计流里留下一句可证伪的假话**；③ 并发度 >2 时跳得更多。

**这条同时把 plan 的 G1 退出判据判为错**：`plan.md:239` 把「N=2 并发 ⟹ 最终 `blockCount`=2」
当作正确答案（`baseline-reproduction.md` B-2 的「串行等价值」列同样）——**那是把缺陷钉成合同**。
正确断言是「**同一 payload 的 2 个并发判定器 ⟹ `blockCount` 增量 = 1**」。

**裁决：重划 G1 / G2 边界**（不是打补丁）：

| 批 | 新边界 |
|---|---|
| **G1** | 并发安全 **+ 计数幂等**：锁 + **锁内 test-and-set**「本次证据状态指纹是否已计过数」，指纹相同 ⟹ **不重复 +1**。即 `lastCountedFingerprint` 与 Design X 的**计数半边**在 G1 落地 |
| **G2** | 在幂等键之上加**路由半边**：不计数的那些走哪条路由（`routeNonBlock`）、上界是什么（`nonBlockStopCount` + 420 backstop）、终态怎么可见、返回契约重写 |

**理由**：幂等键与「无进展去重」在语义上是同一个机制的两半——同一 Stop 的两个进程与
同一用户轮内的两次无进展 Stop，**在证据状态上不可区分，也不应被区分**。
分成两批实现会让 G1 单独落地时**净变差**（N-1），违反「每个 Phase 落地后都不得劣化」的基本要求。

### R2-3 🔴 Design X 的 `null` 是**吸收态**，且退出判据在坏实现下恒真（绕过面 C-B ＋ 误伤面 N-9 双路命中）

`plan.md:274-275` 只规定「有进展 ⟹ `routeBlock` **并写回指纹**」，**没规定** `routeNonBlock` 路径写不写。
不写 ⟹ `lastCountedFingerprint` 永不脱离 `null` ⟹ 每轮命中 `=== null` 析取 ⟹
**`routeBlock` 在任何新会话中结构性不可达**、`blockCount` 恒 0。
而 `plan.md:310` 的退出判据写「`blockCount` **全程 0**」——**一个完全跑坏的实现 100% 满足它**
（F231「全绿是反指标」原样重演）。且规则本身二义：`last=null` 时两条子句同时成立。

**裁决**：
1. 明写「**所有**路由分支（含 `routeNonBlock`）MUST 在同一次锁内 mutation 写回本次指纹」；
2. 第一条子句改为 `last !== null && fp === last ⟹ 无进展`（消除二义）；
3. 退出判据改**双向**：「冻结语料 `blockCount` 全程 0 **且** 有进展语料 `blockCount` 达 2」——
   单向断言无法证伪坏实现；
4. 补变异 **M2-h**：删掉 `routeNonBlock` 的指纹写回 ⟹ 有进展语料的端到端钉必须变红。

### R2-4 🔴 `prompt_id` 缺席时用 sentinel＝把失效维度伪装成有效维度（绕过面 C-C）

四分量在冻结窗口内三项天然恒定，唯一由外部扰动的是 `prompt_id`。用 sentinel 补齐 ⟹
在缺该字段的通道（Codex 方言 / 老 harness）上**整个平台**指纹恒定 ⟹ `blockCount` 恒 0。
被判方不需要伪造字段，**只需选平台**。这违反 **F224「fail-open 必须按维度收窄，不得整体短路」**。

**裁决**：**撤回 sentinel 兜底**（主线程上一轮的方向也错了，一并更正）。改为**降级不承重**：

> `prompt_id` 不可得 ⟹ 本次 Stop **不走指纹去重**，按 `routeBlock` 处理（＝改动前行为）+ 落 `gate-fingerprint-partial`。

补端到端钉「缺 `prompt_id` 的 payload ⟹ `blockCount` 正常推进」+ 变异 M2-i。
⚠️ 与 R2-2 的交互：幂等键在该通道上同样失效 ⟹ 该通道退回「一次 Stop 吃两格」。
**须显式登记**：Codex 双注册 + 无 `prompt_id` 的组合下，N-1 的代价不可消除，只能诚实登记。

### R2-5 🔴 `routeNonBlock` 的阻断分支丢掉 missing 指引（误伤面 N-2）

`routeBlock` 的阻断文案走 `buildFeedbackText(verdict.missing)`（`judge:656`），含逐项动作行 + 双路径指引；
`routeNonBlock` 两条 stderr 都是**裸模板串**。Design X 下这条路径覆盖**100% 的不合规首次 Stop**，
**包括全部诚实会话** ⟹ 用户拿到一次 exit 2 却看不到该补什么。

**裁决**：`routeNonBlock` 的阻断语义分支 MUST 复用 `buildFeedbackText`；
补端到端钉「首次 exit 2 的 stderr 含 missing 动作行」。

### R2-6 🔴 warn 档保护缺失（误伤面 N-3）

`grep -n "warn" plan.md` → **0 命中**。既有推迟逻辑插在 warn 分支（`judge:1066-1072`）**之前**；
G2 若照抄该插入点，`semanticExitCode=2` 会让 **warn 档返回 2**，直接推翻 F208 三档语义（warn 恒 exit 0）。

**裁决**：G2 明写「指纹路由**仅在 `enforcement==='block'`** 下生效」，并补反向钉
「`warn` + 指纹无进展 ⟹ exit 0」。

### R2-7 🔴 新增诊断码的**用户可见面**无规则（误伤面 N-4）

唯一渲染点是 `judge:731`（`releaseDegraded` → `buildFeedbackText(..., {diagnostics})`）＋
`routeNonBlock` 的裸串打印。按 plan 现状至少 5 个新码会进用户 stderr，其中
`snapshot-stale` 可能 >90% 恒真、`state-lock-taken-over` 是纯内务事件（用户零可动作）。
`judge:1021-1027` 正是 F270 P3 为此做的收窄，**plan 未复用该纪律**。

**裁决**：G0 的 canonical 表**加一列 `userFacing:boolean`**；`buildFeedbackText` 只渲染
`userFacing===true` 的码；补守卫钉（新码默认 `false`，要设 `true` 必须显式）。
G4 两码只入 `buildAuditEvent` 的 `extraDiagnostics`，**不入** `deferExtraDiagnostics`（绕过面 I-A）。

---

## 三、采纳的 WARNING（改设计但不重划边界）

| # | 来源 | 结论与裁决 |
|---|---|---|
| R2-8 | 误伤面 N-5 | `degradedRecorded` 是 **read-then-act**（`judge:697` `shouldWriteTerminal = storageUnavailable \|\| !alreadyRecorded`），plan「幂等标记本就最后写赢」**不成立**——两个并发判定器都读到 `false` ⟹ **都写终态**。裁决：把「读 + 置 `true`」合进**同一次锁内 test-and-set**，返回 `wasAlreadyRecorded`，`recordWorkflowRun` 依返回值在锁外执行 |
| R2-9 | 误伤面 N-7 | 级 2「锁不可得 ⟹ 不持久化」把 **reset 也跳过** ⟹ F211 补救清零失效（护栏 R-7 实际守不住）。裁决：**reset 是幂等删除、无 RMW，不需要互斥** ⟹ 锁不可得时走**无锁 unlink** |
| R2-10 | 误伤面 N-8 ＋ 绕过面 W-A | 级 3 触发条件 `entryCount >= 420` 与闸门三 `< 420` **靠常量巧合互斥**；且 W-c 复测 P95=392 已提议重标定 420 ⟹ 任一方向下调即打开「持锁 + 无锁 RMW ⟹ 无界推迟放行」。且 97% 会话够不到级 3。裁决：级 3 触发条件改为**与会话长度解耦**的量（连续 `lockUnavailable` 次数 N=3），420 只作最终兜底；并把序关系 `NONLOCK_DEGRADE_ENTRY_LIMIT >= EARLIEST_FIX_ENTRY_DEFER_LIMIT` 写成**断言**+变异 |
| R2-11 | 绕过面 W-B | D-5 可见性对齐漏了 `complianceVerdict.blockCount`——**主线程复核**：`record-workflow-run.mjs:255` 只在 `typeof === 'number'` 时保留该键，`routeNonBlock` 传 `null` ⟹ **键整个消失**，完整绕过与合法暂停在终态记录里同形。裁决：耗尽放行传数值（`NON_BLOCK_LIMIT`）+ 断言 |
| R2-12 | 绕过面 C-D | 锁的 pid 存活是**存在性判据冒充归属判据**（§3 #25 同型）。**但**两路都确认长期占锁是**阻断方向**、对被判方是净损失。裁决：降为 WARNING——锁内容加 `lockId` + 进程启动时刻做归属校验（`bootId` 不做，成本不成比例），墙钟兜底阈值抬到 **300s**（覆盖 F273 实证的 ~5min 合盖冻结）；**安全性不押在该判据上**，真正的保证是「锁不可得不改变裁决方向 + 有界收敛」 |
| R2-13 | 误伤面 N-6 | `pendingItemCount` 实测**超计 2–4×**：判据集在 190 份报告上命中 **27 份 / 81 行**，其中「**等**待用户」类交付散文 16/81 = 19.8%、同行已标 ✅/已完成 15/81 = 18.5%。裁决：`待用户` 改 `(?<!等)待用户`；同行含 ✅/已完成/已回填 一律不计；**计数单位改「节」而非「命中行」**；T3-E1 语料从 12 份扩到判据实际触发的 **27 份** |
| R2-14 | 绕过面 W-C | 变异清单**自我违反** plan 自己立的规矩（「每条变异必须点名至少一条端到端用例变红」）：6 条只点名单元用例，2 条写「任一 `-E`」不算点名，M4-a 是 F270-M9 同形（helper 对但生产未接线仍会变红）。裁决：逐条补齐点名；G0 若确因零行为变更无法配 `-E`，**显式登记豁免与理由**；M4-a 追加「删 judge 侧调用点 ⟹ T4-E3 变红」 |

## 四、经实测**确证站得住**的设计（不改）

| 项 | 实测 | 结论 |
|---|---|---|
| **G4 集合归属判据** | 859 份 transcript / **53716 条 assistant 条目**：多 text 块 **0**、空 text 块 **0**、末条多类型块 **0** ⟹ `textBlocks.join("\n").trim()` 与 harness 构造 `Jc(content,"\n").trim()` **逐字节同构** | 完全刷盘时误判率 **0%**（对比裸子串 10.8%）。D-2 的改法正确 |
| **G4 耗时** | 17.07MB / 6600 entries：既有 parse 57.6ms，**G4 集合构造+归属 0.91ms** | 占端到端 43–63ms 的 **<2%**，用户不可感知。「拖慢同步 hook」的担忧**被实测否定** |
| **G4 键缺席态** | 末条 assistant 无 text 块 **81/857 = 9.5%** ⟹ harness `p = … \|\| void 0` 落**键缺席** | 正确归入 `snapshot-message-absent`，不是 stale。方向正确 |
| **G3 不改判** | `core:1809-1810` 判据是 `exists && nonEmpty`，加 `content` 传参不触碰它 | 成立；计数错的是**数值**不是**判定** |
| 锁重试参数 | 480ms 上界 / 8ms 步长，N=2 下 20× 余量 | 参数本身不会误降级 |
| R-2 锁文件落点 | `.specify/` **直接子项**判据不命中 `*.lock` | 不会自举打开采集器闸门 |
| G0 派生守卫方向 | 能抓「加新码漏登记」——F270 硬编码守卫抓不到的方向 | 成立 |
| 代码块内误计数 | 81 行命中中围栏内 **0 行** | 审查者自己的怀疑被自己的数据推翻 |

## 五、移交后续卡的新增登记

- **本机最大 transcript 17.07MB，距 `MAX_TRANSCRIPT_BYTES=20MB` 仅 15%**（超限即 fail-open 放行）——后续卡输入。
- **闸门三 420 重标定**：本机复测 P95=392、越阈 2.9%（第 1 轮 W-c 已登记，本轮再获一处依赖）。
- **`payload.transcript_path` 的写权未复核**（绕过面末条自陈「本轮受只读约束未实测，不作为确证」）：
  若该 JSONL 可被被判方截断/重写，则所有 transcript 派生的「不可擦 backstop」（闸门三 /
  `NON_BLOCK_ENTRY_LIMIT` / R2-1 新增的兜底）**共享同一个未验证前提**。
  **裁决：第 3 轮单独立题实测**——这条若成立，影响面大于本轮全部 CRITICAL。
