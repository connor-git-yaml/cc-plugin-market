# 问题修复报告 — F276 fix-compliance P0-A 残余收口

## 问题描述

F270（`8617ae3e`）落了门禁证据源换代的账本主链，但其**集成态整体 review**
（`specs/270-compliance-evidence-ledger/verification/integrated-review.md`）核实出：范围在 plan 阶段
**静默收缩**，四组 `[必须]` FR 零 Phase、零任务、零代码，由用户裁决移交后续卡。本卡收这四组：

1. **病根 iii** — GATE 暂停等用户拍板被当收口尝试：与卡面描述一字不差、改动前后行为完全一致；
   US3 四个 `[必须]` FR（FR-026..029）全空。
2. **病根 v** — block/defer 状态 `load → modify → save` 无锁：F270 零实现，且往同一竞态覆写里
   **又加了一个字段**（`nonBlockStopCount`），账本采集器放大并发面。
3. **PENDING / in-flight 语义** — F269「报告先落盘 + PENDING + 回填」惯例未成文、判定器不显式支持；
   含 F275 实证的新形态：主线程**合法等待后台审查子代理**时被 block。
4. **snapshot-stale 专码**（FR-033）— 陈旧快照与「证据缺失」无诊断区分。

**附带处置**：T311 遗留的 `routeNonBlock` 及 `NON_BLOCK_LIMIT` / `NON_BLOCK_ENTRY_LIMIT`
是**生产零接线死代码**（F270 变异 M9 证实：首行改 `return 0` 只红 5 个直接 import 的单元测试、
零端到端失败）——本卡必须接上或删除，禁止保持「测试绿着的死代码」。

## 开工实证（F248/F267 先例：每条先证再修）

四组缺陷**全部**已跑成可复现事实，见 `research/baseline-reproduction.md`。摘要：

| 组 | 复现结论 | 复现率 |
|---|---|---|
| 病根 iii | GATE 暂停态连续 Stop → `blockCount` 0→1→2，第 3 次降级放行；`nonBlockStopCount` **全程 0** | 确定性 |
| 病根 v | 同 sessionId 并发 2 个判定器 → 最终 `blockCount` = **1**（串行应为 2），一次阻断被静默吞掉 | **3/3** |
| in-flight | 后台子代理在途 → 前 3 次正确推迟，**第 4 次起 exit 2** | 确定性 |
| snapshot-stale | `last_assistant_message` 生产码零消费；审计 diagnostics 闭集 **27** 码中无任何陈旧度码 | 静态实证 |

同时完成 **五量反向普查增量更新**（plan 硬前置）：`research/reverse-census.md`。
普查推翻了底版 3 条事实（`anchorLineIndex` 已变成生产零消费、新增第 4 个锚点量 `latestFixTimestamp`、
backstop 设计已反转），并**新挖出 4 条本卡承重约束**（见该文件末节），护栏表据此产出而**非**按卡面点名抄。

---

## 5-Why 根因追溯

### 组 1 · 病根 iii（GATE 暂停误判）

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | GATE 暂停期间反复 Stop 为何烧光 `BLOCK_LIMIT`？ | `runHook` 里所有不合规裁决**只有一条路由** `routeBlock`（judge:1075），它无条件 `blockCount+1` |
| Why 2 | 为何没有第二条路由？ | `routeNonBlock`（FR-046 解锁计时器）**已实现但生产零调用点**（普查 §6 确认；`nonBlockStopCount` 运行时恒 0） |
| Why 3 | 实现了为何不接？ | 它原定两个入口：重入（P3 对抗证伪后**撤线**）与 GATE 指纹去重（P3 附带承诺「随 P4 落」，而 P4 实际做的是账本接入） |
| Why 4 | 跨 phase 承诺为何断链？ | plan 阶段**静默裁剪**范围（F270 CRITICAL-7）：病根 iii 无任何 Phase 认领，tasks 却把 T311 勾成 `[x]` |
| Why 5 | 为何未被机制捕获？ | (a) 无 **FR → Phase 覆盖矩阵**做对账；(b) `routeNonBlock` 的测试**直接 import 函数**，端到端零覆盖 —— 测试全绿结构性掩盖零接线 |

**Root Cause**：判定器对不合规态**只有「计数阻断」一条路由**，「证据状态无进展的重复 Stop」与
「真实不合规的反复尝试」在路由层不可区分；FR-046 设计的第二条路由造好了却从未接线，
而 phase 间的承诺转移没有对账机制，使断链在制品层不可见。

### 组 2 · 病根 v（状态竞态）

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 并发双判定器为何丢计数？ | `saveBlockState` 是裸 `fs.writeFileSync` **整体覆写**（io:345），4 个调用点全是无锁 read-modify-write |
| Why 2 | 为何刻意无锁？ | io:355-358 JSDoc 明文「**刻意不做** read-modify-write 合并」，理由是「让谁负责保住哪个字段可审计」 |
| Why 3 | 该理由为何不够？ | 它只考虑了**单进程内的字段归属可审计性**，其论据「每条写入路径都恰好先 load 过一次」在单进程成立、**跨进程即丢更新** |
| Why 4 | 为何未修正并发模型？ | F270 `research/harness-field-probe.md:204` 已核实「更普遍的并发源是**单会话内部**主线程+多子代理」，但 FR-012 在 plan/tasks **零命中**（同 CRITICAL-7 的静默裁剪），本次还往同一覆写里加了第 5 个字段 |
| Why 5 | 为何未被捕获？ | 全仓**零并发测试**：io 测试全是单进程顺序调用；守护测试钉的是「字段原样带回」（单进程语义），与失效维度（跨进程原子性）**正交** |

**Root Cause**：状态文件的并发模型被假设为串行，实际是多进程并发；「整体覆写 + 调用方带回」
用并发正确性换取了字段归属可审计性，而**测试维度与失效维度正交**，使这笔交换的代价结构性不可见。

🔴 **本卡的承重推论（初稿方向已按实证更正）**：组 1 的修复会让 `nonBlockStopCount` 成为真正参与
判定的量。初稿写「并发抹平它 ⟹ 计时器永不耗尽 ⟹ **无界放行**」——`research/baseline-reproduction.md`
B-7 探针**证伪了这个方向**：计时器耗尽与否决定的是「**何时**放行」，抹平的后果是
**无界阻断**（仅受 `NON_BLOCK_ENTRY_LIMIT=420` 这条不可擦 backstop 封顶）。
**G1 先于 G2 的结论不变，论据换成 F208「Stop hook 不可 brick 会话」**：并发抹平会把一次合法停顿
拖成最多 ~420 个 assistant entry 的连续阻断。（K-2 的「总上界」在此由 420 backstop 独立保住。）

### 组 3 · PENDING / in-flight 语义

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 合法等待后台审查子代理为何被 block？ | 实测前 3 次正确推迟，第 4、5 次 exit 2 |
| Why 2 | 第 4 次为何阻断？ | 闸门二 `IN_FLIGHT_DEFER_LIMIT = 3`（judge:116）耗尽 |
| Why 3 | 为何 3 不够？ | 该额度是按**被取代的旧信号**（transcript 派生的假在途，21.3% 通知不达）的风险定的；F270 换成 harness 权威 `background_tasks` 后风险源已消除，**额度一行未动** |
| Why 4 | 为何未随信号换代重估？ | 病根 ii 只做半修（换信号、不动预算）；且预算是**不分态**的单一常量，无法给「权威在途」与「派生在途」不同额度 |
| Why 5 | 为何未被捕获？ | 测试只钉「耗尽后恢复裁决」，无**时长维度**语料；且「先落盘 PENDING 报告」这条自愈路径只存在于人的操作习惯里（F269 现场发明），判定器与 SKILL **都没成文**，故唯一出路是烧预算 |

**Root Cause**：「等待在途」的放行额度按**不可信信号**的风险定成固定小常量，信号源换代成
harness 权威字段后未按新可信度重估；同时缺少把长等待转化为**合规态**的自愈路径
（PENDING 惯例未成文），使预算成为唯一出口。

### 组 4 · snapshot-stale 专码

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 陈旧快照为何与证据缺失不可区分？ | 判定器全仓**零消费** `last_assistant_message`，无任何陈旧度判据（普查 §9） |
| Why 2 | 为何零消费？ | FR-033 在 plan/tasks 零命中（同静默裁剪） |
| Why 3 | 这维度为何最容易被裁掉？ | 它**不改变退出码**（陈旧与缺失在当下都判不合规），收益只在事后审计的**可区分性**，在「退出码是否正确」的验收口径下不可见 |
| Why 4 | 事后可区分性为何重要？ | 病根 i（transcript 滞后）只被**半修**（只换委派一维，其余 4 个证据窗口仍读 transcript）；滞后造成的误阻断在审计流里与真实不合规**逐字节相同** ⟹ 残余误伤率不可度量 ⟹ 无法判断病根 i 该不该继续修 |
| Why 5 | 为何未被捕获？ | 审计事件 schema 的 diagnostics 是**闭集 enum**，缺码不会报错、只会「没有这个码」；无任何测试断言「陈旧态必须有独立码」 |

**Root Cause**：判定器对「我读到的 transcript 是否落后于 harness 当前状态」**没有任何可观测量**，
使病根 i 的残余误伤在审计流中不可度量、不可归因，也就无法为后续决策提供依据。

---

## 影响范围扫描

### 同源问题（需同步处置）

| 文件 | 位置 | 模式 | 修复动作 |
|---|---|---|---|
| `scripts/lib/fix-compliance-io.mjs` | `saveBlockState` :364-390 | 无锁整体覆写 | 引入**带锁的 RMW 原语**；`saveBlockState` 保留为底层写，新增互斥入口 |
| `scripts/fix-compliance-judge.mjs` | RMW 对 ①:638→644 ②:638→721 ③:763→778 ④:1030→1038 | 4 条无锁 load-modify-save | **全部**迁到新原语；②跨函数 + 中间夹 `recordWorkflowRun` 磁盘写，是最难的一条 |
| `scripts/fix-compliance-judge.mjs` | :684 vs :688 | `inFlightDeferCount` 有默认值 0（漏传 = **静默清零 = fail-open**），`nonBlockStopCount` 刻意无默认值 | 统一为**无默认值 fail-loud**（F238 纪律） |　⚠️ **卡 C 实证反转（2026-09-03，IW-1）**：在 `main` 顶层 `catch { return 0 }` 兜底下，「无默认值＝忘传即炸」等价于「忘传即放行」；同一调用链上正确方向是**有默认值 + 非法值按 fail-closed 归一**。卡 A/B 接手本处方前须按此重审。
| `scripts/fix-compliance-judge.mjs` | :780 | `routeNonBlock` 的 `!saved.ok` → **exit 0 放行**，与 :652 / :1044 的 fail-closed **方向相反** | 接线前必须重审方向（普查硬约束 1） |
| `scripts/fix-compliance-judge.mjs` | :762 `routeNonBlock` + :82 / :100 两常量 | 生产零接线死代码 | 接线（GATE 指纹 + 陈旧类），消灭死代码 |
| `specs/208-.../contracts/fix-compliance-verdict-event.schema.json` | diagnostics enum | 闭集，新增码漏登记即合同漂移 | 新码同步入 enum + 走 F270 已建的**从 canonical 表派生**的同步守卫 |

### 类似模式（已评估）

| 文件 | 位置 | 模式 | 评估 |
|---|---|---|---|
| `scripts/lib/ledger-writer.mjs` | :68/:228/:238 | 并发追加账本 | **安全**：`appendFileSync`(O_APPEND) 对常规文件多进程原子（F270 P-7 实测 8 进程 × 60KB 零撕裂）。本卡把它列为**验收项**实测复核，不改实现 |
| `scripts/lib/fix-compliance-io.mjs` | :163 `appendAuditEvent` | 并发追加审计 | 同上，`appendFileSync` 单行，安全 |
| `src/utils/atomic-write.ts` | — | F267 已修的 TS 侧原子写 | **不复用**：跨 `src/` ↔ `plugins/` 边界，且 judge 的 `JUDGE_FILE_SET` 闭包不含 src。插件侧自建原语 |
| `scripts/lib/judge-snapshot-*.mjs` | — | F236 判定器快照 | 与本卡的 `snapshot-stale` **同名不同物**（那是插件安装快照漂移，这是 transcript 快照陈旧）。命名须显式区分，避免语义撞车 |

### 同步更新清单

- **调用方**：`releaseDegraded` 的 **2** 个生产入口（judge:660 / 670；659 是注释行）随字段透传纪律统一而改签名；该函数**未 export**，测试无直接依赖 ⟹ 变更面小
- **测试**：需新增**并发维度**（多进程真跑，非单进程模拟）、**GATE 指纹端到端**（非直接 import routeNonBlock）、
  **PENDING 语料**、**snapshot-stale 双态**；`routeNonBlock` 现有 5 个单元测试须补端到端配对
- **文档**：`plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 增补 PENDING 惯例 → 必须 `npm run repo:sync` 重生 Codex 包装并重算 `Source SHA256`
- **契约**：审计事件 schema diagnostics enum；`LEDGER_DIAGNOSTICS` 同源纪律的兄弟表（judge 侧新码）

---

## 🔴 范围裁决 2 · 拆三卡（用户拍板 2026-09-02，**取代下文「五批」口径**）

> 下文「修复策略 / 五批」「范围裁决（2026-09-01）」「回归护栏」三节是**拆卡前**的诊断记录，
> 作为卡 A / 卡 B 的设计资本原样保留（见 `handoff/`），**不再是 F276 的交付范围**。

### 拆卡证据（不是偏好）

| 量 | 值 |
|---|---|
| GATE_DESIGN 异构对抗轮次 | **3 轮 / 6 路**（每轮绕过面 + 误伤面） |
| 累计 CRITICAL | **22**（8 + 8 + 6），**每轮都在上轮的修订里挖出新洞**，第 3 轮仍 6 条 |
| 拆卡前 plan 规模 | **978 行 / 5 Phase / 7 个新诊断码 / 1 个进程间互斥原语 / 1 处 schema 语义扩张 / 19 条风险 / ~45 条钉** |
| 元判断 | 第 3 轮两路**独立**给出「范围已超 fix 模式」结论，误伤面给出三卡拆法 |

**拍板**：拆三卡，F276 只交 **卡 C**；卡 A / 卡 B 移交 milestone 排期。

### 三卡边界

| 卡 | 范围 | 模式 | 状态 |
|---|---|---|---|
| **卡 C（本卡 F276）** | `saveBlockState().ok===false` 的 **fail-open 收口**（既有一步完全绕过，主线程实跑复现）+ 附带处置 `routeNonBlock` 死代码 | fix | **进行中** |
| **卡 A** | G0 诊断码 canonical 表（含 `userFacing` 列）+ G3 PENDING 惯例与可观测性 + G4 `snapshot-stale` 专码 —— 纯可观测性，不碰并发 | fix | 移交，输入见 `handoff/` |
| **卡 B** | G1 锁 + **计数幂等**（R2-2 判定二者不可分）+ G2 路由半边（Design X 指纹去重、`routeNonBlock` 重写、warn 门控） | feature/implement | 移交，输入见 `handoff/` |

### 卡 C · 问题定义

**症状**（主线程实跑，/tmp 副本，唯一变量＝状态文件位置是否被目录占位）：

```
A 正常首次 Stop:                      exit 2
B 主路径 + tmpdir 两级均被目录占位:      exit 0  "[GATE-DEGRADED] 已达阻断上限(2 次)，本次降级放行"
```

两条 `mkdir` 即让 fix 会话**首次 Stop 放行**。零成本、确定性、**改动前就存在**（不是本卡引入）。

### 卡 C · 5-Why

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 首次 Stop 为何 exit 0？ | `routeBlock` 在 `saved.ok===false` 时直接走 `releaseDegraded(storageUnavailable:true)`（judge:661-668），退出码 0 |
| Why 2 | 为何存储失败被映射为放行？ | F208 research D2 的裁决「存储不可用 ⟹ 无法可靠维持计数 ⟹ 等同已达上限降级放行」——把「计数写不进」当成了「计数已耗尽」 |
| Why 3 | 该裁决为何成立过？ | 前提是「两级存储（projectRoot + tmpdir）同时不可写只会是环境事故，被判方不可自诱发」 |
| Why 4 | 该前提为何不成立？ | 状态目录 `.specify/runs/.fix-compliance-state/` 在 projectRoot 下、tmpdir 路径可推导，**两者都在被判方写域**；`mkdir <statePath>` 让 `writeFileSync` 抛 EISDIR，与「环境事故」在 `tryWriteState` 的 `catch {}` 里**不可区分** |
| Why 5 | 为何未被既有机制捕获？ | (a) `fix-compliance-judge-cli.test` 只把「`ok:false` ⟹ exit 0」当**合同**钉住，从未按「被判方能否触发」做变异；(b) F257 第九轮 / F270 三轮对抗都把 `ok:false` 当环境态跳过（第 2 轮对抗 C-A 归因：**载体复用而不重做失效方向论证**）；(c) 护栏 R-11「总上界」只查了计数桶，没查「不计数的分支」 |

**Root Cause**：`saveBlockState` 失败被当作「预算耗尽」而非「预算**不可知**」，且失败条件落在被判方写域内。
**Root Cause Chain**：exit 0 → `releaseDegraded(storageUnavailable)` → D2「写不进＝耗尽」→ 「不可自诱发」假前提 → 状态路径在被判方写域 → 无变异测试 + 对抗跳过。

### 卡 C · 修复设计（要点，细节进 plan；**按第 4 轮对抗修订**，见 `verification/gate-design-adversarial-round4.md`）

- **方向**：`!saved.ok` ⟹ **保持本次裁决自身语义**（不合规即 exit 2）；`releaseDegraded` 不再是「写不进」的直接后果。
- **不设任何 errno 判定分支**（第 4 轮曾裁决 errno 白名单，当轮即被主线程探针证伪：`ln -s /` 让 macOS 密封卷返回 EROFS、`writeFileSync` 跟随软链 ⟹ 两级同为「环境性」errno ⟹ 0 成本绕过复活）。errno 只进 stderr 与审计。诚实 ENOSPC/EROFS 双故障 ⟹ **可恢复的阻断**（stderr 明示补救口），按 F257 四要素登记为残余。
- **上界（不依赖任何可写路径）**：harness 在阻断后把 Stop hook 的 stderr **以 `type:'user'` 条目**回灌进 transcript
  （本机 324 份 / 29 条命中样本形态一致：`isMeta:true`、`userType:'external'`、字符串 content 以 `Stop hook feedback:` 开头；9 条 assistant 条目含同串被 `role==='user'` 正确排除）。
  被判方**无法在带内伪造 `type:'user'` 条目**（改文件属已接受下界）。判定器 stderr 首行打稳定 token，
  用「**最晚**一次 fix 展开（`latestFixLineIndex`）之后、含该 token 的 user 反馈条目数」作**每 Stop 计数器**（第 5 轮 R5-1：本计数器缩窗＝fail-closed，与闸门三方向相反，故不沿用 earliest；合规 reset 后新一段以新展开开头 ⟹ 窗口自然重置），达到 `BLOCK_LIMIT`（=2，与 FR-006 同一预算）即 `releaseDegraded`。
  **效果**：存储故障下的地板＝**每段 fix 展开 2 次 Stop 往返**（× compaction 次数；诚实多轮重展开每段重吃 2 次——第 6 轮 R6-1 如实登记的误伤代价，可接受：每段起点是用户主动动作、每次阻断带可执行 stderr）；被判方的绕过成本从 **0** 抬到 **2 次往返**，段内其余回合摊销为 0（被判方无新增收益）。
- **不设 420 兜底**（第 4 轮 R4-1：`assistantEntriesSinceEarliestFix` 由被判方自产、可自泵，析取兜底会让长会话的绕过成本回到 0）；**不用 `stop_hook_active` 兜底**（判定器 `:962-975` 与 nine-round-lessons §3 已实证「惩罚动作生成豁免」被击穿）。
- **可见面**：stderr 主消费者是**模型**——首行「token + 环境故障，非制品问题，模型无法修复；请向用户报告」；两级路径 + `stage errno`；补救按**生效即时性**排序：① 修路径（chmod/释放磁盘/清占位，下一次 Stop 立即生效）② 在 `<projectRoot>/spec-driver.config.yaml`（或 `.specify/spec-driver.config.yaml`）写入 `fix_compliance:` 下 `enforcement: warn`（配置每次 Stop 重读，立即生效；顶层误写 `enforcement:` 无效且零诊断——第 6 轮 R6-2）③ `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<dir>` **须重启会话**（hook env 是 CC 启动快照，会话内 export 无效——第 5 轮 R5-3）；最后才是 `buildFeedbackText`。诊断合并 upstream 去重。
- **可发现性**：真实语料探针进 `f270-real-corpus.test.mjs`（反馈形态漂移时变红 / 语料缺席 skip）。
- **附带处置**：`routeNonBlock` + `NON_BLOCK_LIMIT` + `NON_BLOCK_ENTRY_LIMIT` 生产零接线（变异实证）—— **删除**（最后一个独立提交），`nonBlockStopCount` 状态字段保留给卡 B（io 层不动）。
- **既有相邻向量（不在本卡，移交卡 B）**：预置状态文件 `{"blockCount":2,"degradedRecorded":true}` ⟹ 0 次往返 + 零终态——状态文件在被判方写域，改动前就存在（第 2 轮 I-B / 第 5 轮 C-2）；本卡只保证 **`!saved.ok` 分支不再提供 0 次往返路径**，不得写成「不存在 0 次往返路径」。
- **诚实登记的残余**：同一段内（无重展开）修好存储→合规→再坏 ⟹ 0 次往返（该段已付 2 次，被判方无新增收益）；`.specify/runs/` 是状态目录的父目录，审计/终态与状态同生共死（诚实故障下第 3 次放行可能零终态零审计）；compaction 换文件 ⟹ 计数器归零；自注册 Stop hook 可投喂计数器（成本 = 重启 + 往返，多 hook 倍率无样本，最坏地板 1）；反馈通道滞后（F262 实证 25+ min 懒刷盘）⟹ 计数器欠计 = 更多往返（方向 fail-closed）。
- **不做**：锁 / 指纹 / 诊断码表 / PENDING / snapshot-stale —— 全部移交，见三卡表。

### 卡 C · 明确不做（取代下文旧口径）

- 病根 iii / 病根 v / PENDING 语义 / snapshot-stale 专码 → **移交卡 A、卡 B**
- errno 判定分支（黑名单「猜自诱发」可换手法击穿；白名单「环境性」被 `ln -s /`→EROFS 击穿，均已实测）——errno 只进 stderr 与审计
- `state-storage-unavailable` 路径的**终态记录**形态改动——放行时仍走既有 `releaseDegraded` 终态（不改 contract）
- F270 移交的另 5 项（FR-043/044、FR-010、FR-011、W-9、在途相关性过滤）保持移交

---

## SC 对照（F270 未达成的 5 项 + 本卡；如实登记，禁止静默）

| SC | F270 口径 | 本卡（F276 卡 C）后的真实状态 | 去向 |
|---|---|---|---|
| SC-004 | GATE 期间 `blockCount` 0 增量 —— **未达成**（无 GATE 机制） | **未达成，本卡未动**（拆卡后属病根 iii / Design X 路由半边） | **卡 B** |
| SC-011 | 全链耗时断言 —— 未达成（全仓零耗时断言；实测 63ms > 建议 50ms） | **未达成，本卡未动**；本卡新增计数趟实测 0.066ms（构造最坏 1.52ms），未引入新的耗时面 | 保持移交（F270 移交项） |
| SC-012 | 哨兵只写不读、两态生产产出相同 —— 未达成 | **未达成，本卡未动** | 保持移交（F270 移交项） |
| SC-014 | 解锁计时器终态可见性 —— **假达成**（靠死代码 `routeNonBlock` + 测试直调） | **由「假达成」更正为「未实现」**：死代码已删（7c7cb8ed），不再有"测试绿着的死代码"制造达成假象；重写随 Design X 路由半边移交 | **卡 B** |
| SC-015 | backstop 换桶矩阵 —— 未达成（backstop 长在死代码里） | **未达成**：`NON_BLOCK_ENTRY_LIMIT` 随死代码删除；卡 B 重做时**不得**复用「assistant 条目计数作 backstop」（本卡第 4 轮实证可自泵） | **卡 B** |
| **本卡新增** | — | `saveBlockState().ok===false` 由 0 成本放行反转为 fail-closed + 反馈计数上界：两级占位 ⟹ Stop 序列 **2,2,0**（主线程实跑）；存储可用面 A/B 对拍逐字节不变；`test:plugins` 1721/1719/0/2（基线 1688/1686，净 +33 减 −5 死代码用例） | 达成（卡 C 范围内） |

**F270 移交的另 5 项**（FR-043/044 活性自检、FR-010 坏行码、FR-011 超限、W-9 账本 `noopVerify` 回退、在途相关性过滤）：**未认领，保持移交**。

## 生效时点（judge:doctor，2026-09-03 实跑）

`npm run judge:doctor` → **3 mismatch / 7 match**（mismatch 恰为本卡改的 `fix-compliance-judge.mjs` / `fix-compliance-core.mjs` / `fix-compliance-io.mjs`）。
本机 Stop hook 跑的是已安装快照 `4.4.0`，本卡改动**须等下次发版 + 插件缓存更新**才在本机 hook 生效；
本卡全部验收走 worktree 源码直调，不依赖本机 hook。

---

## 修复策略

> 🔴 **本节已按 GATE_DESIGN 第 1 轮异构对抗全面改写**（两路 8 个 CRITICAL，其中 3 条推翻初稿承重前提）。
> 逐条处置见 `verification/gate-design-adversarial-round1.md`。初稿版本的差异也记在那里，不在此重复。
> 两处**用户已拍板**的范围裁决（见下 §范围裁决）已并入。

### 五批，G0 前置、G1 严格先行

| 批 | 范围 | 核心手法 |
|---|---|---|
| **G0** 诊断码 canonical 表（对抗新增前置） | judge | judge 侧诊断码目前是**散落字面量**（`:246/531/693/783-784/975/1057/1060-1061/1135/1145`），**无 canonical 表** ⟹ 护栏 R-12 在本卡范围内**不成立**，新码漏登记不会被任何守卫抓到。先建 `JUDGE_DIAGNOSTICS` 表、收编既有码、守卫**从表派生**（与 `LEDGER_DIAGNOSTICS` / `FOREIGN_DIALECT_DIAGNOSTICS` 同源纪律），再加新码 |
| **G1** 并发安全（病根 v / FR-012） | io + judge 4 条 RMW | 互斥 RMW 原语：`O_EXCL` 锁 + 有界重试 + **pid 存活校验为主、墙钟兜底 ≥60s** 的陈旧接管（墙钟单独判据会被 F273 已实证的宿主休眠冻结击穿 ⟹ 持锁者仍活着却被接管 = 比不加锁更坏）。**锁必须包住 load**；**临界区不裹 IO**（`recordWorkflowRun` / `appendAuditEvent` 放锁外）。🔴 **锁不可得走独立返回态 → `return 2` + 专码，绝不复用 `saveBlockState().ok=false`**——后者现有映射是「存储不可用＝已达上限」→ **exit 0**，而锁文件在被判方写域内，`touch` 一个即首次 Stop 放行。`resetBlockState` **作为一次 mutation 走同一把锁**，锁文件**只由持有者 unlink**（撤回初稿「reset 顺手删锁」的建议）。不变量：**锁的可得性不得改变裁决方向** |
| **G2** GATE 指纹（病根 iii / FR-026..029 + FR-046 接线） | judge | 指纹 = `(prompt_id, 缺失集合, 账本条目数, 锚点位置)`，四分量全部由判定器自算或取 harness 字段，**禁止任何文本启发式**（A-4 已证伪，K-7 裁决）。**Design X**：无历史指纹 ⟹ 视为「无进展」走非计数路由（初稿的 Design Y 会让冻结暂停多吃一次 exit 2，且 `blockCount` 增量 1 ≠ 卡面要求的 0）。**前置改造**：`routeNonBlock` 现状**无条件 return 0**（B-7 实测），必须先重写返回契约——未耗尽 → 按裁决自身语义 `return 2`；耗尽 → 终态可见放行 `return 0`，且**可见性 ≥ `releaseDegraded`**（终态 result / degraded 标注对齐 + 专属 trigger 码 + loud stderr；否则复发 F257 缺陷 2「更安静那条成为首选绕过面」）。**指纹只用于收紧**（指纹变化才允许重置计数），不可用于放宽 |
| **G3** PENDING 自愈路径（FR-030 / FR-032） | SKILL + judge | **不动任何预算**（用户拍板）。(a) 把 F269「报告先落盘 + PENDING 标注 + 回填触发条件」惯例写进 `spec-driver-fix` SKILL —— 长等待因此变成**合规态**，不必烧预算；(b) 判定器识别 PENDING 节并**落诊断码 + 未回填项计数**（FR-032，**纯可观测性、不改判**）。**FR-030 已 de facto 满足**（现判据 `exists && nonEmpty`，含 PENDING 的报告本就通过）。**FR-031（裸 PENDING 按缺失）本卡显式裁剪**，三条理由见对抗处置 D-3 |
| **G4** snapshot-stale（FR-033） | judge | **纯诊断码，不改路由、不进任何预算桶**（两路对抗独立命中：接路由既是已证伪路线 #21 的反向同型，又会吃光 G2 的 `NON_BLOCK_LIMIT=2` 预算而**静默抵消 G2**）。判据用**集合归属** `last_assistant_message ∈ { assistant 条目 textBlocks.join("\n").trim() }`，**绝不**用裸子串或「尾部相等」（真实语料实测：末行非 assistant **99.8%**、裸子串失败 **10.8%**）。键缺席 ⟹ 另一个码。FR-033 只要求两态分配不同诊断码，纯诊断码**完整满足** |

**排序**：G0 → G1 → G2 → G3 ∥ G4。
G0 是所有新码的守卫前提；G1 是 G2 的安全前提（并发抹平会把合法停顿拖成最多 ~420 entry 的连续阻断，撞 F208 非 brick）；
G2 的返回契约重写与**任何** `routeNonBlock` 接线 MUST 同一提交（先加端到端变异钉：「非计数类裁决在计时器未耗尽时退出码必须为 2」）。

### 范围裁决（用户已拍板，2026-09-01）

| 决策点 | 拍板 | 后果 |
|---|---|---|
| 病根 iii 的「无假 block」 | **只做指纹去重，缺口显式登记** | 冻结暂停的 `blockCount` 零增量可达成（Design X），但 agent 在暂停期间仍会被 exit 2 推回——「停下来等用户」这层危害**未修**。唯一自洽的修法是 A-4 列为可选增强的 `AskUserQuestion` 权威信号（伪造代价＝真的停下等人，与绕过目的自相矛盾），属跨卡面，**移交后续卡** |
| 「合法等待后台子代理被 block」 | **不动预算，只做 PENDING 自愈路径** | 不抬 `IN_FLIGHT_DEFER_LIMIT`（抬它会把一条已登记的、确定性的、零成本自诱发的放行通道从 3 次放大到 N 次——`background_tasks` 判据是纯「数组非空」，一条 `sleep` 即可触发，F270「重大-5」尚未修）。**在途相关性过滤保持 F270 的移交状态** |

### 明确不做（范围边界，显式登记）

- **`AskUserQuestion` 权威信号增强**（见上表）
- **F270 移交的另 5 项**：FR-043/044 活性自检、FR-010 坏行码、FR-011 超限、W-9 账本 `noopVerify` 回退语义、**在途相关性过滤** —— 不在本卡四组内，保持移交状态，SC 对照里逐条报真实状态（禁止静默）
- **FR-031** 裸 PENDING 收紧（对抗 D-3，附语料证据与再做的前置条件）
- **闸门三 420 重标定**：本机独立复测 P95=392、越阈 2.9%，距阈值仅 7%——登记为后续卡输入，本卡不动预算故既有论据仍成立
- **病根 i 的其余 4 个证据窗口**：仍读 transcript，本卡只给它加**可观测量**（G4），不换载体

## Spec 影响

需要更新的 spec：**F270 的 `spec.md` 不改**（它是 F270 的历史事实源）。本卡在
`specs/276-fix-compliance-p0a-residue/` 下自建 plan/tasks，并在 plan 中产出
**FR → Phase 覆盖矩阵**（FR-012 / 026..033 / 046 逐条认领或**显式登记裁剪**）——
这是 F270 over-claim 的根因对策，本卡不得重犯。

`plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 需增补 PENDING 惯例（G3），
属**受控生成链**：改后必须 `npm run repo:sync` 重生 Codex 包装并重算 `Source SHA256`。

---

## 回归护栏（来自反向普查，非卡面抄录）

| # | 不可回退的判据 | 守护点 | 本卡的风险面 |
|---|---|---|---|
| R-1 | F270 `agent_id` 键存在性判据，**writer / reader 谓词对称** | lw:112-113 `hasOwn` ↔ lr 剔除 | 不触碰；变异守卫已在 |
| R-2 | US5 白名单闸门（`.specify/` 白名单，非「存在即真」） | lw `isSpecDriverProject` + 三条自举向量守卫 | G1 若新增锁文件落在 `.specify/`，**不得**成为闸门白名单项（否则自举打开采集器闸门） |
| R-3 | 审计留痕三路径（合规早退 / `feature-dir-unresolvable` / defer）带 `ledgerDiagnostics` | judge:951 / 早退 / :1049 | G2 新增第 4 条放行路径（`routeNonBlock`）**必须**同样带 `ledgerDiagnostics` |
| R-4 | 账本委派显式 `noopVerify: false`（`undefined` 是回退触发条件，不是中立值） | lr | 不触碰 |
| R-5 | **F257 闸门三取「最早」fix 展开** —— judge:95-100 红字「不要改回去」 | `earliestFixLineIndex`（普查 §1c） | G2 的指纹含「锚点位置」，**必须用 `latestFixLineIndex`**，绝不可误取 earliest 或把两者合并 |
| R-6 | F208 三档语义 + **Stop hook 不可 brick 会话** | 全链 | G1 加锁**必须有界**（超时即降级），锁死会话是比丢更新更坏的失效 |
| R-7 | F211 补救清零（`resetBlockState` 删文件即全量清零） | judge:934 / io:396 | G1 新增锁文件 / G2 新增指纹字段必须一并被 reset 覆盖（**新增状态字段无需改 reset** 的性质不得破坏） |
| R-8 | F216 no-op 证据门（`hasNoopAnchor` 独立触发、命令全文精确匹配） | judge:514-516 / core:1823 | G3 改 `verificationReport` 传参时**不得**触碰见证侧只查 fix-report.md 的不对称 |
| R-9 | F231 光杆命令判据 | core | 零改动 |
| R-10 | `JUDGE_FILE_SET` 闭包（派生式，非硬编码） | judge-file-set-guard 测试 | G1 若新增 lib 文件，闭包自动扩张——须确认守卫仍绿 |
| R-11 | **总上界必须存在**（K-2）：任何「不计数」裁决必须同时规定放行路径 | — | G2/G4 新增两类非计数裁决，**均须**落在 `nonBlockStopCount` + `NON_BLOCK_ENTRY_LIMIT` 双闸门内；`NON_BLOCK_LIMIT >= BLOCK_LIMIT` 不变量不得破 |
| R-12 | 诊断码闭集 enum ⊆ canonical 表（从表派生的同步守卫） | schema + 守卫测试 | G2/G4 新增码必须同步，且守卫须能抓「加新码漏登记」方向 |

---

## 审查档位

**常设异构对抗**（2026-09-01 起不随 Codex 配额变化）：每 phase ≥2 个独立子代理、≥2 切入角
（**误伤面**：合法暂停/等待被 block；**绕过面**：伪装暂停/伪造在途逃判定），要求**归因而非仅列现象**；
对抗实验在 /tmp 副本。`GATE_DESIGN` 走「对抗 → 修订 → 再对抗至零新 CRITICAL」循环（F270 实证单轮不够）。
commit 标注「Codex 审查暂停，异构档位缺席」。

## 生效时点（F236）

`npm run judge:doctor` 当前 `status: drift`（4 mismatch / 2 match / **4 missingInSnapshot**）——
本机 Stop hook 跑的是已安装快照 `4.4.0`，连 F270 的 `ledger-*.mjs` 都还不在其中。
本卡改动**在本机 hook 上不会立即生效**，须等下次发版 + 插件缓存更新。
故所有验收走 **worktree 源码直调**（`--project-root` 指向 /tmp 副本），不依赖本机 hook 行为。
