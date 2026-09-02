# Phase 4a · Spec 合规审查报告（F276 卡 C）

> 审查对象：`5bb8526b` + `7c7cb8ed`（基线 `e01611b2`）；审查者：spec-driver:spec-review（opus）；主编排器落盘（子代理无 Write）。

## 结论

**PASS（0 CRITICAL）· WARNING 5 项 · INFO 5 项**

卡 C 的机制面与合同一致：`!saved.ok` 已由「等同耗尽放行」反转为 fail-closed + storage-free 反馈计数上界；四条件谓词、`latestFixLineIndex` 基线、基线缺席取 0、diagnostics 上游保留、`releaseDegraded` 终态形态不变、schema 27→28、`routeNonBlock`/`NON_BLOCK_*` 已删且 `nonBlockStopCount` 带回面完整保留。未发现 fix-report/plan 之外的**机制**级行为扩张。全部 WARNING 集中在**诚实登记与制品同步**，无一改变裁决方向。

（限制：本次审查无 Bash，`git diff` 无法亲跑；D7 逐字节 A/B 与变异日志按制品记载采信，未复算。）

| # | 级别 | 位置 | 现象 | 合同依据 | 建议 |
|---|---|---|---|---|---|
| 1 | WARNING | `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs:1175-1179`；`scripts/fix-compliance-judge.mjs:690-691` | 两处 JSDoc 仍写「成本论据已被质疑且未澄清…须回设计层裁决，不得当作已澄清」，而主编排器已于 2026-09-03 裁决并要求改为「每条反馈 = 一次自我阻断往返；不再以启动快照为成本依据」 | `implementation-notes.md` §3 ✅ 裁决段明确「plan §8 ⑧ 与两处注释按此口径同步」；plan §8 ⑧ 已加实现期裁决行 | 按裁决口径改写两处注释（纯注释，零行为） |
| 2 | WARNING | `implementation-notes.md` §「已知偏差」 | C2 实现期对抗审查引出的 4 处**对 plan 明文条款的偏离**只登记在 `verification/implementation-adversarial-c1c2.md`，未进 notes：① `routeBlock` 第 5 参改为有默认值 + 非有限数归 0（plan §4 C2 第 2 条/T028 明写「F238 纪律：无默认值」）；② io `errors[]` 新增 `blocker` 字段、stderr ① 删除对象由「挡路对象」指定（plan R7-7 明写「只允许指向上行 `@` 后那一个文件」）；③ `renderPathSegment` 消毒集扩至 C1/LS/PS/零宽/双向控制 + 512 截断；④ 新增 E-r / E-s(a,b,c) / E-q′ 四组计划外用例 | 该文件自述「恢复方只需读本文件即可知有哪些已知偏差」；审查重点 6 | 把这 4 条 append 进 notes §已知偏差（各一行 + 指向 verification 文件） |
| 3 | WARNING | `implementation-notes.md:8-9` | 覆盖写入文件内部自相矛盾：顶部仍称「C1+C2 代码面完成…**未 commit / 未 add**」，而 §C3 段已写「C1+C2 已提交 `5bb8526b`」 | 同上（覆盖写入、恢复方唯一入口） | 刷新顶部 Phase 段至 C3 完成态 |
| 4 | WARNING | `tasks.md:285` | T033（C2 异构对抗审查）仍为 `[ ]`，但实际已执行（两路、0C，产物 `verification/implementation-adversarial-c1c2.md`）。对比 T023/T037 的 no-op 均有显式登记，此处是纯漏勾 | tasks.md 约定「每 Phase 内…异构对抗审查」逐条勾选 | 勾选 T033 并补一行产物指针 |
| 5 | WARNING | `scripts/fix-compliance-judge.mjs:817` | 补救口 ② 直接内插 `${projectRoot}`（两处），**未过** 本卡新建的 `renderPathSegment`；`err.path` 同源威胁（换行→伪造行）已被 E-q 钉住，projectRoot 段无守护。E-q 的「只允许一行以 `[FIX-COMPLIANCE` 起头」在 projectRoot 含换行时会失守 | plan §7 末行：「新增文本面须**同样核到整条 stderr**」；`renderPathSegment` 自述其为「唯一内容形态不受约束的自由段」——该自述在此不成立 | 二选一：`renderPathSegment(projectRoot)`（1 行、零判定消费）；或在 JSDoc 显式登记「projectRoot 同源未消毒」为残余 |
| 6 | INFO | `scripts/lib/fix-compliance-io.mjs:474` | `@returns` 里 `errors` 元素类型仍为 `{path,stage,code}`，缺 `blocker`（描述行 466 已含） | plan §3 io 行 | 补类型 |
| 7 | INFO | `plugins/` 全域 | 源码内已无任何 `FR-046` 字样（随 `routeNonBlock` JSDoc 一并删除），plan §2 声称「语义迁到 routeBlock 唯一路由」未在代码留下 FR 指针 | plan §2 FR-046 行 | 在 `routeStorageUnavailable` JSDoc 补一句 FR-046 认领点 |
| 8 | INFO | `specs/270-.../spec.md:387-395`、`SC-015` | C3 删除后，FR-046 点 1–5（含 MUST 级「不可擦 backstop」）与 SC-015「三计时器组合上界」在代码侧已零实现。本卡裁决「F270 spec.md 不改」成立（原就零接线），但漂移只登记在 F276 制品 + schema `description`，F270 侧无指针 | plan §11 / 审查重点 7 | 由卡 B 承接；或在 F270 spec 加一行「已随 F276 卡 C 删除，移交卡 B」 |
| 9 | INFO | plan §2 vs `specs/270-.../spec.md` FR-046 | plan 的「FR-046 **第 5 点**」指「save 失败 fail-closed」，而 spec.md 的 FR-046 第 5 点是「不可擦 backstop」——编号不同源（plan 取自已删的 JSDoc 编号），卡 B 交接时易误读 | — | 交接文档标注编号来源 |
| 10 | INFO | `verification/mutation-log.md`、D7 A/B | 变异 harness 与 A/B 对拍脚本落在 `/tmp/f276-mut/`、scratchpad，仓内无复算器，结论不可被后续维护者重放 | F241「数字产物必配重算器」 | 可接受；建议把 harness 收进 `verification/` 或注明一次性 |

## FR 对账表

| FR / 护栏 | 内容 | 状态 | 证据 |
|---|---|---|---|
| FR-046 第 5 点（plan 口径） | save 失败必须 fail-closed，不留「既不计数又不留痕」通道 | **已实现** | `judge.mjs:646` 走 `routeStorageUnavailable`；`:712-725` 闸门 2 = 审计(`blockCount:null`/`degraded:false`) + stderr + `return 2`；E-a/T007 三段断言 |
| R-11 总上界 | `!saved.ok` 分支必须有放行上界 | **已实现** | 闸门 1 `feedbackCount >= BLOCK_LIMIT`（`judge.mjs:701`），复用 FR-006 预算、零新阈值常量；E-a 第 3 次 exit 0 + E-m 钉重展开缩窗 |
| R-12 诊断码闭集 | 净新增 1 码、双向登记 | **已实现** | schema enum 计数实读 = **28**（38–65 行），含 `storage-unavailable-block-budget-exhausted`；E-g 正反双向（撤回码 `storage-unavailable-environmental-release` 不在 enum） |
| R-6 不 brick | 阻断可恢复 + 补救口 | **已实现** | 三条补救口按生效即时性（`judge.mjs:816-820`），② 为两行字面量含两空格缩进；E-n 合规用户 exit 0/stderr 空 |
| R-7 reset | `resetBlockState` 语义不受影响 | **已实现** | 计数器纯 transcript 派生、不落盘（`core.mjs:1196`）；`io.mjs:528` 未改 |
| D7 存储可用逐字节不变 | 退出码/审计/终态/stderr | **已实现（采信）** | `saveBlockState` 两个成功 return 逐字未改（`io.mjs:501/508`）；notes 记 HEAD vs 工作树同窗口 A/B、stderr sha256 逐条相同；C3 段另有 4 轮 `diff` exit 0。方法可信（同窗口、同副本、剔 `updatedAt`），但脚本不在仓内 |
| FR-046 其余 4 点 / FR-012 / FR-026..033 | 锁·幂等·GATE 指纹·PENDING·snapshot-stale | **显式移交**（未被偷实现） | 源码无相关新增；`handoff/README.md`、schema `description:34`、io 注释 311-313 三处登记 |
| 既有相邻向量（预置状态文件 0 往返）/ 配置面 ⑫ | — | **显式移交卡 B** | plan §8 ⑩⑫；stderr ② 已取「由用户决定」措辞（E-a 断言） |
| plan §11 明确不做 | 无 errno 判定分支 / 无 420 兜底 / 不用 `stop_hook_active` / 不动 io 字段集 / 不动 reset / 不改 warn 档 / 新量不进 report | **全部守住** | E-p 剔注释后三文件无 `ENOSPC\|EDQUOT\|EROFS`（仅 `io.mjs:469` 注释内）；`EARLIEST_FIX_ENTRY_DEFER_LIMIT` 与 `assistantEntriesSinceEarliestFix` 用法未被新分支消费（judge:1088-1092 原样）；`stop_hook_active` 仅 `:1032` 既有点；`normalizeState` 字段集不变；warn 分支 `judge:1122-1129` 未动；`runReport`（:1143-1163）**不含**新计数量 |
| TDD 清单 §5 | E-a/b/b′/c/e/g/h/i/j/m/n/o/p/q · U-1..4,7 · P-2/3 | **全部落地** | 用例名逐条命中（judge-cli 3534/3634/3650/3675/3696/3717/3733/3756/3786/3822/3841/3864/3891/3917、`p3-carry`=3170；core 4960-5064；io U-4；f270-real-corpus 143/152/195）；被裁剪项 U-5/U-6/E-d/E-f/E-k/E-l/P-1 确实不存在，字母未重排 |
| 过度实现检测 | — | **无机制级过度实现** | E-r/E-s/E-q′ + `blocker` + `renderPathSegment` 均为本卡新增面的自我加固（对抗审查 IW-1/IW-2/IL-1 驱动），零判定消费、不扩公共 API；唯登记面欠缺（见 WARNING 2） |

**建议处置顺序**：先修 WARNING 1（注释与已落裁决对齐）与 WARNING 5（1 行消毒或显式登记），再补 WARNING 2/3/4 的制品同步；INFO 项可随 T041/T042 收尾一并处理。以上均不需重跑变异清单，但 WARNING 5 若选择改代码，须重跑 E-a/E-q/E-c 三条。
