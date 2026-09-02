# F276 改动前基线的可复现实证

> 纪律沿用 F270 `research/root-cause-reproduction.md`：**先把每条移交缺陷跑成可复现事实，再设计修法**。
> 本文件的每张表都是 verify 阶段的**对照组**——改动后必须翻转（或显式登记为未修）。
>
> 采集环境：Node v24.14.0 · HEAD `e01611b2`（= `origin/master`）· 判定器为 **worktree 源码**
> （非已安装快照，见文末「生效时点」）。复现脚本见 `verification/repro/`。

---

## B-1 🔴 病根 iii：GATE 暂停被当收口尝试（**原样复现**）

**语料**：fix 展开 → `Write` fix-report.md → `Agent(spec-driver:implement)` → assistant 文本
`[GATE] GATE_DESIGN | decision=PAUSE …等待用户选择`。制品：fix-report.md 已落盘（含 Root Cause），
verification-report.md **未落盘**（正是 GATE 暂停时的真实状态）。`background_tasks: []`（无在途）。

同一份 transcript、同一 sessionId，连续 4 次 Stop（第 2 次起 `stop_hook_active:true`）：

| Stop | exit | `blockCount` | `nonBlockStopCount` | stderr |
|---|---|---|---|---|
| 1 | **2** | 0 → **1** | 0 | `[FIX-COMPLIANCE]` 阻断 |
| 2 | **2** | 1 → **2** | 0 | 同上 |
| 3 | 0 | 2 | 0 | `[GATE-DEGRADED]` 已达阻断上限，**降级放行** |
| 4 | 0 | 2 | 0 | 同上 |

`--mode report`：`missing = ["artifact:placeholder","verification-report.md","delegation:verify"]`。

**事实**：
1. 与卡面病根 iii 描述**一字不差**——GATE 暂停期间证据状态毫无进展，却把 `BLOCK_LIMIT=2`
   两格预算全部烧掉，第 3 次起门禁**事实上关闭**（此后真实收口检查再也拦不住任何东西）。
2. `nonBlockStopCount` **全程 0** —— `routeNonBlock` 生产零调用点的直接观测证据。
3. 「输出一句 GATE 文案」对判定**毫无影响**（文本不进任何判据）——这是当前的**正确**性质，
   本卡的修法必须保持它（禁止复活 A-4 已证伪的文本启发式）。

---

## B-2 🔴 病根 v：状态竞态丢更新（**100% 复现，非偶发**）

**构造**：同一 `session_id`、同一 transcript（不合规态），**并发** N 个判定器进程。

| 并发数 | 退出码 | 最终 `blockCount` | 串行等价值 |
|---|---|---|---|
| 2（跑 3 轮，3/3 同结果） | `[2,2]` | **1** | 应为 2 |
| 6 | `[2,2,2,2,2,0]` | 2 | ≤2（受 `BLOCK_LIMIT` 封顶，观测不到全貌） |

**事实**：两个进程各自 `loadBlockState()` 读到 0 → 各自 `saveBlockState(1)` → 后写覆盖先写，
**一次阻断被静默吞掉**。`saveBlockState` 是裸 `fs.writeFileSync` 整体覆写（`fix-compliance-io.mjs:345`），
4 个调用点全是无锁 read-modify-write。

**为什么 N=2 才是干净证据**：`BLOCK_LIMIT=2` 会把 N=6 的结果封顶到 2，掩盖丢更新；
必须取 N=2 才能让「串行 2 / 并发 1」的差值暴露出来。

**方向性**：本次观测到的丢更新方向是**少计**（fail-closed，多阻断一轮）。但同一竞态在
`defer` / `releaseDegraded` / 未来 `nonBlockStopCount` 三条写入路径上是**双向**的——
任一路径用陈旧快照整体覆写，都会把别的计数器**回退**，即**任何有界预算都能被并发延长**。

🔴 **本条的初稿方向写反了，已按 B-7 的实证更正**：初稿写「`nonBlockStopCount` 被并发抹平 ⟹
解锁计时器永不耗尽 ⟹ **无界放行**」。B-7 实测证伪——抹平的后果是计时器**永不耗尽**，
而计时器耗尽与否在**阻断语义**的接线下决定的是「何时放行」，故真实方向是
**无界阻断**（仅受 `NON_BLOCK_ENTRY_LIMIT=420` 这条不可擦 backstop 封顶）。
**G1 先于 G2 的结论不变，但论据换成 F208「Stop hook 不可 brick 会话」**：
并发抹平会把一次合法停顿拖成最多 ~420 个 assistant entry 的连续阻断。

---

## B-3 🟠 在途等待后台子代理：**在途判定生效，但预算 3 次即耗尽**（F275 形态）

**构造**：不合规态（缺 `verification-report.md` + `delegation:verify`，两者**都在**
`DEFERRABLE_MISSING_KEYS` 内），`background_tasks` 恒为一个 `status:"running"` 的后台审查子代理。

| Stop | exit | `blockCount` | `inFlightDeferCount` |
|---|---|---|---|
| 1 | 0 | 0 | 1 |
| 2 | 0 | 0 | 2 |
| 3 | 0 | 0 | **3**（闸门二耗尽） |
| 4 | **2** | 1 | 3 |
| 5 | **2** | 2 | 3 |
| 6 | 0 | 2 | 3 | `[GATE-DEGRADED]` 降级放行 |

**归因（回答卡面「`background_tasks` 三态已入判定器，评估为何未覆盖该场景」）**：
三态判定本身**是生效的**——前 3 次确实识别为在途并放行。覆盖失效点**不在信号，在预算**：
`IN_FLIGHT_DEFER_LIMIT = 3` 是按**被取代的旧信号**（transcript 派生的假在途，21.3% 通知不达）
的风险定的额度；F270 换成 harness 权威 `background_tasks` 后，「假在途长期挂起」这一风险源
已被消除，而额度**一行未动**（F270 集成 review 自记「病根 ii 半修」）。于是真实长时后台审查
（本仓常设异构对抗档位每 phase 都要派）必然在第 4 次 Stop 被阻断。

---

## B-4 🟠 snapshot-stale：**全仓零消费面**

```
grep -rn "snapshot-stale|last_assistant_message|lastAssistantMessage" plugins/ (排除 tests/)
→ 零命中
```
审计事件 schema 的 diagnostics 闭集 enum（`specs/208-.../contracts/fix-compliance-verdict-event.schema.json`）
共 28 个码，**无** `snapshot-stale`、无任何陈旧度码。即：「transcript 快照落后于 harness 当前状态」
这件事在判定器里**没有任何可观测量**，陈旧误阻断与真实不合规在审计流里逐字节相同。

---

## B-5 附带确认：`routeNonBlock` 死代码（承接 F270 变异 M9）

`plugins/spec-driver/scripts/fix-compliance-judge.mjs:70-76` 的 JSDoc **自述**「当前生产零接线」，
且 F270 变异实验（首行改 `return 0`）只红 5 个直接 import 的单元测试、**零端到端失败**。
B-1 的 `nonBlockStopCount` 全程 0 是同一事实的运行时观测。

---

## 生效时点（F236 护栏）

```
npm run judge:doctor → status: drift（4 mismatch / 2 match / 4 missingInSnapshot）
snapshotPath: ~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.0
```
**本机 Stop hook 跑的是已安装快照 4.4.0**，其中连 F270 的 `ledger-*.mjs` / `in-flight-verdict.mjs`
都还是 `missingInSnapshot`。故本卡（与 F270 一样）的改动**在本机 Stop hook 上不会立即生效**，
须等下一次发版 + 插件缓存更新。所有验收因此走 **worktree 源码直调**（`--project-root` 指向 /tmp 副本），
不依赖本机 hook 行为。

---

## B-6 🔴 **现场实证**：本卡自己的编排器在等待后台对抗子代理时被 block

**时点**：F276 Phase 1 收口后、Phase 2 之前。主线程刚派出 2 个后台异构对抗子代理
（`general-purpose`，误伤面 / 绕过面各一），正在**合法等待**其完成，此时轮次结束触发 Stop。

**判定器给出**（本机已安装快照 `4.4.0`，非 worktree 源码）：
```
[FIX-COMPLIANCE] 缺少验证报告 / 缺少 implement 类委派 / 缺少 verify 类委派
```
即 **exit 2 阻断**。

**为什么这条比 B-3 的构造实验更有价值**：
1. 它**不是构造的**——是本卡在正常流程里自然撞上的，被判方就是编排器本人；
2. 它**同时**命中本卡的三组缺陷：
   - **组 3（in-flight）**：主线程确有 2 个在途后台子代理，属「合法等待」，判定器却按「没走完就想停」处置；
   - **组 1（病根 iii 同型）**：这是**流程中段的合法停顿**（等子代理 ≈ 等用户拍板），与 GATE 暂停是同一类误伤，
     区别只在等的是子代理还是人；
   - **组 4（snapshot-stale）**：无任何诊断码能区分「真的没派委派」与「派了但 transcript/信号未反映」。
3. 它顺带证实了**生效时点**结论：跑的是 `4.4.0` 快照，其中连 F270 的 `in-flight-verdict.mjs` 都
   `missingInSnapshot`（见文末），故 **F270 已落的 `background_tasks` 三态在本机根本没生效**——
   这解释了为什么在途判定完全没起作用，而不是三态判据本身失效。

**对本卡的两条直接输入**：
- 组 3 的修法不能只调预算档位：**还要覆盖「已安装快照落后于源码」这个长期常态**下的行为
  （本机 hook 与 worktree 源码永远差一个发版周期）——这是 F236 护栏的现实后果，须在 verify 里如实登记，
  不得把「源码里修好了」读成「本机不再误伤」。
- 组 1 的边界因此更清楚：**「合法停顿」不止 GATE 一种**（等用户 / 等后台子代理 / 等外部审批），
  A-4 选「证据状态无进展」这个**否定式**判据而非枚举合法场景，在本次现场实证里再次被证明是对的方向
  ——本次停顿同样是「证据状态无进展」，同一条判据可覆盖，无需为它单独打补丁。

---

## B-7 🔴 `routeNonBlock` **无条件返回 0** —— 解锁计时器根本不参与退出码

> 这是主线程为**证伪自己 fix-report 初稿的一条论断**而跑的探针，结果连带推翻了 G2 的接线前提。

直接 import `routeNonBlock` 逐场景观测（`--project-root` 指向 /tmp 空目录）：

| 场景 | `entryCount` | 计数变化 | **返回值** |
|---|---|---|---|
| A 正常累计，不抹平 | 10 | 1 → 2 → 3 → **4**（越过 `NON_BLOCK_LIMIT=2` 继续涨） | 0 / 0 / 0 / **0** |
| B 每轮抹平状态目录（模拟并发覆写 / `rm -rf`） | 10 | 恒 1 | **0** ×4 |
| C 抹平 + 触发 backstop | **420** | — | **0** ×2 |
| D 计量缺席 | `null` | — | **0** |

**事实**：`NON_BLOCK_LIMIT` / `NON_BLOCK_ENTRY_LIMIT` 两个阈值**只切换审计 trigger 与终态记录**
（`nonblock-limit-exhausted` / `nonblock-backstop-exhausted` / `nonblock-storage-unavailable`），
**对退出码零影响**——耗尽与未耗尽都是 `return 0`。

**归因**：该函数的 JSDoc 自述「@returns 恒 0（当前接入的裁决类均为放行语义；**阻断语义类接入时由调用方先行 exit 2**）」。
它是为「重入」这一**放行语义**类设计的，而重入入口已被 P3 对抗撤销，于是它以「只服务放行语义」的形态被留了下来。

**对 G2 的直接后果（初稿设计前提被推翻）**：
GATE 指纹无进展是**阻断语义**类（spec FR-046 第 2 点：「计时器未耗尽前照常按裁决类自身语义处理」）。
把它直接接到现状的 `routeNonBlock` 上 ⟹ **每次指纹稳定即无条件 exit 0**，
而「指纹稳定」是被判方**零成本自诱发**的（不调工具、不发新消息即可），
等于送出一条比改动前（2 次 exit 2 后才降级放行）**更松**的一步绕过——正是 spec delta 复审 C-1
判死的「攻击面 A」。**G2 必须先重写 `routeNonBlock` 的返回契约**（未耗尽→按自身语义返回 2、
耗尽→终态可见放行返回 0），而不是「把 GATE 接到现成函数上」。

**顺带**：`stderr` 与审计文案当前一律写「本次放行」，接入阻断语义类后会**说假话**，须一并改。

---

## B-8 ✅ 正面对照：账本并发写**未**损坏（验收项预跑，不改实现）

8 进程 × 25 条真实 `Agent` payload 并发写同一账本文件：

```
{"进程数":8,"每进程条数":25,"期望条目":200,"实际行数":202,"坏行":0,
 "唯一id数":200,"末尾换行完整":true,"单条约":"172B"}
```

**结论**：`appendFileSync`(O_APPEND) 在常规文件上多进程原子——**零撕裂、零坏 JSON、id 无丢失**
（202 = 200 条目 + 2 条 `ledger-open` 哨兵，哨兵在文件创建竞争下被写了两次，属幂等噪声不影响解析）。

**含义**：病根 v 的竞态**只在状态文件**（`saveBlockState` 的整体覆写），**不在账本**。
G1 的修复范围据此收窄为状态文件一处，账本侧**不改实现**、只作回归对照。

---

## B-9 ✅ G1 原语可行性与开销（/tmp 原型，未动仓库）

原型：`O_EXCL`（`fs.openSync(path,'wx')`）锁文件 + 有界重试 + 陈旧锁超时接管，
**锁内**完成 `load → mutate → write`；同步 hook 里没有 `await`，睡眠用
`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)`（**同步睡眠、不烧 CPU**，
初版用 `while(Date.now()<end){}` 忙等会在竞争下空转 CPU）。

8 进程并发对同一状态文件各做一次 `n += 1`：

| 模式 | 期望 n | 实际 n | 丢更新 | 单进程耗时 ms（min/max） |
|---|---|---|---|---|
| 无锁 | 8 | 7 →（复跑）8 | **1 → 0** | 0.12 / 0.22 |
| 加锁 | 8 | **8** | **0** | 0.28 / **24.3** |

**如实登记两点**：
1. **无锁臂在微基准上是 flaky 的**（两次跑分别丢 1 / 丢 0）——竞争窗口在微基准里太窄。
   **不要**拿这条当病根 v 的证据；病根 v 的可靠证据是 B-2 的 CLI 级复现（3/3 确定性）。
2. **加锁的尾延迟是真实代价**：8 路竞争下最坏 24ms。对照 F270 实测判定器端到端 43–63ms，
   属同量级、可接受；但**重试上限与睡眠步长必须显式设界**（原型取 60 × 8ms ≈ 480ms 上限），
   超界即降级，绝不允许无限等待（F208 非 brick）。真实场景的竞争度是 2（Codex 双注册），
   不是 8，故典型代价约一个睡眠步长。

**对 G1 的设计输入**：锁必须**包住 load**（只包 write 等于没包）；`resetBlockState` 删状态文件时
须一并清理锁文件；锁文件落点**不得**进 US5 白名单（否则自举打开采集器闸门，重蹈 F270 E-C2）。
