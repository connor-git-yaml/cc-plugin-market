# F270 P3 在途三态 + 解锁计时器 · 异构对抗审查留痕

门禁类第十轮，异构对抗 ×2 切入角（fail-open / fail-closed）。**Codex 审查暂停，异构档位缺席。**

## 结论概览

| 路 | 初判 | 发现 | 处置后 |
|---|---|---|---|
| A · fail-open | **净扩大**（2 CRITICAL） | C-1 重入砍预算+静默；C-2 backstop 锚可擦 | 两条全修 → 复判净收窄 |
| B · fail-closed | 三态方向对、净减误伤；但 warn 档 4 处回归 + 静默滑过 | C-1 与 A-C2 同发现（**双路独立命中**）；C-2 warn 劫持 | 随重入撤线连根消失 |

**主线程收口判定：全部 CRITICAL 已修，P3 终版相对改动前 fail-open 持平偏收窄、误伤净减小。**

## CRITICAL 处置明细

### A-C1 · 重入无条件放行把阻断预算从 2 砍到 1（✅ 已修：**重入撤销提前放行**）

对抗实跑序列：改动前「2 次 exit 2 + failed 终态」→ 初版改动后「**1 次 exit 2 + 零终态零 stderr**」。
🔴 归因（对抗给出，主线程核实无误）：
- 惩罚动作（exit 2）本身生成豁免（下一次 Stop 即重入）——最坏形态的 self-inducible；
- 其唯一声称的收益（防阻断死循环）在既有 `BLOCK_LIMIT=2` 下**本就不存在**——exit 2 已被有界化，第 3 次走 `releaseDegraded`，循环天然终止。收益为零、净损一格预算。
- **spec 必答③「重入必放行」的前提被实现层证据推翻**（本卡第四次"上一轮裁决被下一轮证伪"）。

**修法**：重入不改变任何路由——裁决/预算/终态与非重入逐字一致（=改动前行为），仅把 `stop-hook-reentry` 诊断码并入审计（纯可观测性增量）。回归钉：真实序列 exit2→重入 exit2→第三次 degraded（`p3-re` 测试）。

**连带消失**（B 路发现，全部随撤线解除）：
- B-C2 warn 档被守卫劫持的 4 处回归（破零落盘 / 吞 `[WARN]` 提示 / enforcement 串档 / 误写终态）；
- B-W1 重入静默滑过（"agent 被 exit 2 打断后什么都不做再 Stop 即静默结束"）；
- B-W2 单条继续链阻断上限被降到 1 次。

### A-C2 ≡ B-C1 · backstop 锚存可擦文件（✅ 已修：**单调量直接比常量，不存锚**）

**双路独立命中同一发现**：初版 `entryDelta = entryCount − firstNonBlockEntryBaseline`，锚存 gitignore 状态文件 → `rm -rf` 一次同时打掉快路径与 backstop（delta = 单调量 − 可擦锚 = **整体可擦**），JSDoc"不可擦"为假——delta-2 声称已修的擦库 brick 面原样存活。
🔴 归因：把"单调不可擦"的性质错记在**增量**上，而增量的减数可擦。正确形态就在同文件闸门三（`entryCount < 常量`，不存锚）。

**修法**：`backstopExhausted = entryCount >= NON_BLOCK_ENTRY_LIMIT`（与闸门三同形）；`firstNonBlockEntryBaseline` 字段全链撤除（io/judge/测试，不留死字段）。代价如实登记：上界按"整个 fix 会话长度"而非"首次 nonBlock 起"计——对兜底语义可接受。回归钉：擦库后 backstop 仍触发终态（`rnb-3` 测试）。

## WARNING 处置

| 项 | 处置 |
|---|---|
| A-W（未耗尽分支零 stderr = 最安静通道） | ✅ 补 loud stderr（`[WARN] <reason>：本次放行（解锁计时器 N/M）`），F257 缺陷 2 教训 |
| B-必答④（三态码无条件进用户文案 → 每次降级见 `诊断: in-flight-none` 内部码噪声） | ✅ 收窄：仅 `undetermined`（异常态）进 warn/block 文案；in-flight 码走推迟成功审计；no-in-flight 平凡态不进文案 |
| B-必答①残余（`background_tasks` 只收 running/pending，"子代理已完成未消费"时序窗不可见） | ✅ 登记进 `in-flight-verdict.mjs` JSDoc（有界/瞬时/相对 21.3% 假在途净收窄，不读作零误伤） |
| B-INFO（releaseDegraded 新字段默认值会静默抹平） | ✅ 改 required 无默认（F238 教训） |
| A-W2/W3（耗尽终态 `paused`+`degraded:false` 弱于既有 / 无幂等标记） | ⏳ **登记随 P4**：routeNonBlock 当前零接线（重入撤线后），耗尽通道的终态口径与幂等随 P4 GATE 指纹接入一起定 |
| A-W1（计量缺席方向与闸门三相反） | ✅ backstop 常量化后缺席→不触发 backstop、仅剩快路径——已在 JSDoc 登记为接线前提，P4 接入时按裁决类语义定向 |

## 对抗确认「等价/更强」的部分（不重复报）

- **三态权威覆盖（Q2）**：no-in-flight 不推迟=fail-closed 更强；in-flight 恒造在途进推迟但**三闸门逐条确认未被绕开**（合取原样）。等价。
- **undetermined 退回（Q4）**：表达式与改动前逐字相同，老 harness 行为等价；schema/基线已同步，无判定翻转。
- **必答②带回合同**：4 处 save 调用点全部原样带回（B 按磁盘态复核确认；主线程自查曾先于对抗抓到全漏并修复+钉死）。
- **bt=[] 误伤窗（B-必答①）**：烧 blockCount 有界、补救现实、相对 21.3% 长期假在途是**净减小**。

## 交叉验证价值记录

- backstop 锚可擦由**两路独立命中**（A 从绕过面、B 从 over-claim 面）——异构档位第 N 次实证。
- B 路主动声明"diff 快照陈旧、按磁盘态审"并确认带回已修——审查方自校准。
- 主线程在对抗返回**前**自查抓到带回全漏 bug（4 处 save 调用点 grep 实证 0 带回）——自查与对抗互为冗余层。
