# F270 P4 账本接入委派判定 · 异构对抗审查留痕

门禁类第十轮，异构对抗 ×2 切入角（fail-open 账本伪造面 / fail-closed 回退误伤面）。**Codex 审查暂停，异构档位缺席。**

## 结论概览

| 路 | 判定 | 关键 |
|---|---|---|
| A · fail-open | **无超出已接受边界的新 CRITICAL**；2 WARNING（实现弱于 spec 承诺） | 委派下界降到"写一行 JSON"是 D-1 用户拍板接受；但 FR-008 未实现+注释 over-claim、null-窗口兜底方向反了 |
| B · fail-closed | **无 CRITICAL，误伤面单调 ≤0** | 并集只增不减、账本缺席严格等价、诊断不改判、坏行优雅降级；2 WARNING（时钟偏差退回基线 / 跨源格式假设） |

**主线程收口：两路 WARNING 全修，P4 相对改动前 fail-open 面在已接受边界内、误伤面严格非增。**

## A 路（fail-open）WARNING 处置

### WARNING-1 · FR-008「矛盾取严」未实现 + 注释 over-claim（✅ 已修）
🔴 对抗核实：我的接入是**纯并集**（账本补 transcript 未覆盖的 roleClass，只增不减），但注释谎称"矛盾交叉由 ledgerDiagnostics 登记"——实际 `ledgerDiagnostics` 只有账本内去重冲突码，**无 transcript vs 账本的矛盾检测**，且经 `deferExtraDiagnostics` 只进审计不改 verdict。**门禁 over-claim 是承重面上的假话**（本仓 F257/F266 反复点名）。

**修法**：
- 注释改**如实**——本实现是 D-1 下更保守的**补充语义**（非 FR-008 的"替代+取严"强形态）；账本作补充只减少误阻断，不引入"可写载体压过 harness 背书"的替代逻辑。
- 补**真诊断**：`ledgerSupplement` 非空即落 `ledger-supplemented-role`——"账本补了 transcript 没有的角色"这唯一有安全意义的事件从此可事后审计（不阻断，因补充方向帮合规用户，但不再零留痕）。

> 主线程诚实记录：此 WARNING 我在对抗返回**前**自查已察觉（grep 确认注释与实现不符），对抗独立确认并给出精确定性。

### WARNING-2 · null-timestamp 兜底方向反了（✅ 已修）
🔴 `latestFixTimestamp=null`（老 transcript 无 timestamp 字段）时，初版 reader **关闭时间过滤 → 返回整会话账本委派**。多修复会话里 fix#1 真派的 verify 会越过 fix#2 锚点补进 fix#2 空 transcript → 坍塌的 fix#2 被**诚实数据跨周期洗白**（非伪造，是设计 bug）。

**修法**：reader 在 `sinceTs===null` 时返回 `windowUndetermined:true` + **空委派** + `ledger-window-undetermined` 诊断——"窗口画不出来就不用账本补充"，判定器退回纯 transcript（fail-closed 侧）。同纪律扩展：条目 `hookTs` 缺省/非串也**保守剔除**（定位不了不采信）。回归钉：`s6`（null→空）+ `s6b`（无 hookTs→剔除）。

## B 路（fail-closed）WARNING 处置

### B-④ · 时钟偏差可能切合规证据（✅ 有界，已随 WARNING-2 收敛）
对抗核实**有界性**：偏差致 `hookTs < sinceTs` 切掉的只是**补充项**，该事件的 transcript 委派仍在主源计数；合规开发者被阻断当且仅当 transcript 也缺（正是账本要覆盖的滞后场景）——此时**退化到 P4 前基线，非低于基线的新回归**。

### B-脆性 · 跨源时间戳格式承重假设（✅ 已加守卫）
`hookTs < sinceTs` 是两个独立来源时间戳的**裸字符串词法比较**，依赖两端同为 ISO8601 UTC-Z（`…Z`）。实测（P-12）transcript 与 writer hookTs 均满足，但无守卫。**修法**：ledger-reader.mjs 注释显式登记该承重假设 + 测试加格式断言钉（hookTs 匹配 `…Z` 正则 + 词法序断言）——未来 harness 改偏移量形/异精度会被该钉抓住。

## B 路确认「单调安全」的核实（不重复报）

- **① 账本缺席严格等价**：`ledgerSupplement=[]` → `delegations` 与旧 `extractDelegationsAfter` 逐一相等；空并集无副作用。所有存量会话（Codex/老会话/未装采集器/被 clean）零回归。
- **② normalizeTranscriptEntry 加 timestamp 无形状回归**：全测试无整体 deepEqual，断言全字段级；parseError 分支加 `timestamp:null` 不触碰既有断言。
- **⑥ 坏行/哨兵优雅降级**：全坏行→空委派→纯 transcript；仅 ledger-open 哨兵→空→不影响 transcript。
- **加固核实**：`ledgerDiagnostics` 经 `deferExtraDiagnostics` 只走推迟路径的审计/stderr，**不进 judgeCompliance 的 missing[]、不改判**——坏账本/双注册的 `ledger-entry-conflict` 绝不阻断合规开发者。"误伤面≤0"闭合。

## 关键交叉验证

- **WARNING-2（跨周期洗白）由 A/B 双路独立触及**（A 从伪造面的 null-窗口、B 从 fail-open 敞口）——异构档位再次实证。
- **注释 over-claim 由主线程自查 + 对抗 A 双重命中**——自查与对抗互为冗余层，门禁 over-claim 未漏网。
- D-1「账本可写=只防疏忽」是用户拍板的**设计前提**，两路均正确地把"伪造成本降到写一行 JSON"归为已接受边界、不计 CRITICAL，只审"实现是否弱于 spec 承诺"——审查方对边界的自校准准确。
