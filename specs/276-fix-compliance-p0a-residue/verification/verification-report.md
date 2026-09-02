# 验证报告（F276 卡 C）

> Phase 4c · 工具链验证 + 验证证据核查。审查对象：`5bb8526b`（C1+C2）+ `7c7cb8ed`（C3）+ 工作树未提交的 4a/4b 审查修补；基线 `e01611b2`。
> 全部命令在 worktree 根 `/Users/connorlu/.../atomic-write-defects-fix-5606c8` 下亲跑；**未修改任何源文件**（收尾 `git status` 仍为改动前的 7 个 modified + 1 个 untracked）。

## 结论

**PASS** —— 承重验证 `npm run test:plugins` 亲跑 1729/1727/0/2 exit 0；两组端到端复现（存储可用对照组 / 两级占位 fail-closed 上界）逐条实测成立；M-1 / M-11 / M-14 三条变异按日志重放全部复现（含「唯一守护点」的负向对照）；D7 存储可用面 4 轮 A/B 独立复算与 `implementation-notes` 记载的 sha256 逐位相同；4a/4b 共 10 条 WARNING 全部已修。**唯一新增观察**：plan §4 C3 的「`routeNonBlock|NON_BLOCK_` 在 plugins/ 零命中」退出判据现为 **1 命中**（4a INFO-7 修补新写的一行 JSDoc 提及了已删函数名），属注释面、零行为，登记为 INFO 而非 FAIL。

## 工具链验证

| 项 | 执行方 | 结果 |
|---|---|---|
| `npm run test:plugins` | **本代理亲跑** | **tests 1729 / pass 1727 / fail 0 / skipped 2 / todo 0，suites 302，duration 57.4s，退出码 0**；`✖` 计数 0 |
| `npm run build`（tsc） | 主编排器并行执行 | 见交付报告。⚠️ 承重性说明：本卡三处源码改动全在 `.mjs`，tsc 对其**零覆盖**，构建不是本卡的行为阻断面 |
| `npx vitest run` | 主编排器并行执行 | 见交付报告（本代理按运行时约束不并发跑，避免双 vitest 写坏快照） |
| `npm run repo:check` | 主编排器并行执行 | 见交付报告 |
| `npm run release:check` | 主编排器并行执行 | 见交付报告 |

计数对账：4b 报告记 C3 时点为 1721/1719/0/2；本轮 4a/4b 修补新增 `findPathBlocker` 直调探针 **8 条**（`fix-compliance-io.test.mjs`），1721 + 8 = **1729** ✓，与实测一致。

## 端到端复现

复现脚本 `scratchpad/e2e.mjs`，对 `/tmp` 内新建 fixture 直调
`node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode hook --project-root <tmp>`（payload 由 stdin 送入）。

### (a) 存储可用 ⟹ 首次 Stop exit 2 且不走存储不可用分支

```
=== (a) 存储可用 · 首次 Stop ===
exit = 2
首行 = [FIX-COMPLIANCE] 未建立特性目录：请按 specs/NNN-fix-<short-name>/ 约定创建特性目录并落盘诊断制品
首行以 [FIX-COMPLIANCE] 起头 : true
stderr 全文含 STORAGE-UNAVAILABLE token : false
状态文件存在 : true
```

✅ 首行以 `[FIX-COMPLIANCE] ` 起头、**全文不含** `[FIX-COMPLIANCE][STORAGE-UNAVAILABLE]`（R4-9 的 token 不得渗漏到正常路径），状态文件正常落盘。

### (b) 两级占位 ⟹ 2,2,0 + 上界诊断码

构造：主路径把状态文件本身 `<root>/.specify/runs/.fix-compliance-state/b1.json` **造成目录**（⟹ `write EISDIR`）＋ `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 指向一个文件（⟹ `mkdir ENOTDIR`）。每次 exit 2 后按 harness 形态（`type:'user'` + `isMeta:true` + `userType:'external'` + 字符串 content = `Stop hook feedback:\n[bash ${CLAUDE_PLUGIN_ROOT}/hooks/stop-fix-compliance-check.sh]: <stderr>`）追加进 transcript。

```
Stop#1 exit = 2   首行含 token 起头 : true
  [FIX-COMPLIANCE][STORAGE-UNAVAILABLE] 阻断计数无法持久化，本次按裁决自身语义阻断（连续 2 次后降级放行）；⚠️ 这不是制品问题，模型无法修复：请向用户报告下方路…
Stop#2 exit = 2   首行含 token 起头 : true
Stop#3 exit = 0   首行 = [FIX-COMPLIANCE][GATE-DEGRADED] 已达阻断上限(2 次)，本次降级放行——…
退出码序列 = 2,2,0
审计事件数 = 3
  diagnostics = ["in-flight-undetermined","state-storage-unavailable"]                                        blockCount = null  degraded = false
  diagnostics = ["in-flight-undetermined","state-storage-unavailable"]                                        blockCount = null  degraded = false
  diagnostics = ["in-flight-undetermined","storage-unavailable-block-budget-exhausted","state-storage-unavailable"]  blockCount = 2  degraded = true
终态记录数 = 1
含 storage-unavailable-block-budget-exhausted : true
```

✅ 序列 `2,2,0`；✅ 首行 token 起头；✅ 第 3 次审计 diagnostics 含 `storage-unavailable-block-budget-exhausted`；✅ 阻断两次的 `blockCount` 为 `null` / `degraded:false`（plan §4 C2 闸门 2）；✅ **上游诊断码 `in-flight-undetermined` 三次都被保留**——R4-6「不得硬编码单元素数组丢弃上游」在生产路径上实测成立。

> 🔴 构造纠错留痕：本代理第一次把**父目录** `.fix-compliance-state` 建成目录（那正是正常状态目录），判定器走了普通阻断路径、退出码同为 `2,2,0` 但首行是 `[FIX-COMPLIANCE] ` 而非 token、诊断码无 `state-storage-unavailable`。**`2,2,0` 这个序列本身不能作为「走了存储不可用分支」的证据**——必须同时核首行 token 与 diagnostics，否则会得到假阳性。

## FR / SC 对照

### plan §2 FR → Phase 覆盖矩阵

| FR / 护栏 | plan 声称处置 | 本次核验 | 判定 |
|---|---|---|---|
| FR-046 第 5 点（plan 口径：save 失败 fail-closed） | ✅ 认领（C2） | (b) 复现：两级写失败 ⟹ exit 2 + 审计留痕（`blockCount:null`/`degraded:false`），无「既不计数又不留痕」通道 | **达成** |
| FR-046 其余 4 点 | ⛔ 移交卡 B | 源码内无对应实现；`routeStorageUnavailable` JSDoc（judge:697）已写明「其余各点属显式移交面，见 handoff/README.md」 | **移交（未偷实现，未冒充达成）** |
| FR-012 / FR-026..029 / FR-030..033 | ⛔ 移交卡 A/B | 未见相关新增 | **移交** |
| 既有相邻向量（预置状态文件 ⟹ 0 往返） | ⛔ 移交卡 B | 本卡未修，plan §8 ⑩ / fix-report 均显式登记 | **移交** |
| R-11（任何不计数的裁决须有放行上界） | ✅ 认领 | (b) 第 3 次 exit 0 经反馈计数触顶；M-3 类阈值面由既有 E-a 守 | **达成** |
| R-12（诊断码闭集双向登记） | ✅ 净新增 1 码 | `node` 实读 `properties.diagnostics.items.enum.length` = **28**；含 `storage-unavailable-block-budget-exhausted` = true；含撤回码 `storage-unavailable-environmental-release` = **false** | **达成** |

### plan §7 回归护栏

| # | 判据 | 本次核验 | 判定 |
|---|---|---|---|
| R-6 | Stop hook 不可 brick 会话 | (b) 最坏路径 2 次往返后收敛为 exit 0；`E-n`（合规用户两级不可写仍 exit 0）在 test:plugins 全绿内 | **达成** |
| R-7 | `resetBlockState` 清零语义不受影响 | 计数器纯 transcript 派生不落盘；既有 reset 用例全绿 | **达成** |
| R-11 / R-12 | 同上 | 同上 | **达成** |
| D7 | 存储可用时逐字节不变 | 见下「护栏核查 · D7」，独立 4 轮 A/B `diff` exit 0 | **达成** |
| — | errno 不进任何判定分支 | E-p 源码守卫实跑（见下）+ (b) 中 `EISDIR`/`ENOTDIR` 与白名单三码走同一条路 | **达成** |
| — | `nonBlockStopCount` 不得当放行预算 | C3 只删递增方（本就零接线），带回面保留；`p3-carry` 在 test:plugins 内绿 | **达成** |

### fix-report §SC 对照（F270 未达成 5 项 + 本卡）

| SC | fix-report 登记 | 本次核验 | 判定 |
|---|---|---|---|
| SC-004 | 未达成，本卡未动 → 卡 B | 源码无 GATE 机制新增 | **未达成（诚实登记，非达成）** |
| SC-011 | 未达成，本卡未动 | 全仓仍零耗时断言 | **未达成** |
| SC-012 | 未达成，本卡未动 | 未见改动 | **未达成** |
| SC-014 | 由「假达成」更正为「未实现」（死代码已删） | `routeNonBlock` 确已删除，不再有测试绿着的死代码 | **未达成（口径已从假达成更正，属诚实化）** |
| SC-015 | 未达成，`NON_BLOCK_ENTRY_LIMIT` 随死代码删除 | 常量已删 | **未达成** |
| 本卡新增 | `!saved.ok` 反转 + 上界；2,2,0；A/B 逐字节不变 | 三项均由本报告独立实测复现 | **达成（卡 C 范围内）** |
| F270 移交的另 5 项 | 未认领，保持移交 | 未见相关新增 | **移交** |

⚠️ 口径守住：上表 5 条「未达成 / 移交」在 fix-report 与本报告中均**未被写成达成**；本卡对外可声称达成的只有「卡 C 范围内的 `!saved.ok` 收口」这一项。

## 变异重放

在 `/tmp` 副本（`scratchpad/mut/`，`plugins/` + `specs/208-*` + 软链 node_modules）上重放，工作树源码全程未被改动。

> 副本基线预存 1 条失败：`F256 T007 · 真实 F254 transcript 截断回放`（依赖副本未拷贝的 `specs/254-*` 资产）。该失败在施加任何变异**之前**即存在，与本次重放无关；工作树全量 `test:plugins` 该用例为绿。故三条重放一律用 `--test-name-pattern` 定域。

| # | 变异 | 日志声称变红 | 实际重放结果 |
|---|---|---|---|
| **M-1** | `!saved.ok` 改回直接 `releaseDegraded` | E-a（第 1 次由 2 变 0） | ✅ **复现**。E-a 变红，断言消息 `存储写不进必须 fail-closed，不得放行：[FIX-COMPLIANCE][GATE-DEGRADED] 已达阻断上限(2 次)，本次降级放行…`——即首次 Stop 由 2 掉到 0，与日志逐字一致 |
| **M-11** | 窗口基线 `latestFixLineIndex` → `earliestFixLineIndex` | E-m（**唯一**守护点；E-a / E-i 抓不到） | ✅ **复现，且负向对照成立**：同一轮里 `E-a` ✔ / `E-i` ✔ / `E-m` ✖（1 fail / 3 tests）。「E-m 是 M-11 唯一守护点」这一承重结论**独立坐实**，不是推演 |
| **M-14** | 删 `routeBlock` 第 5 参默认值与非有限数归一（还原成无默认值解构） | E-r（日志记「实得 `status=0`」） | ✅ **复现**。E-r 变红，断言消息 `忘传第 5 参必须仍然阻断（缺席按 0 记 = fail-closed），实得 0：0 !== 2`——**日志记的 `status=0` 逐字坐实**（顶层 `catch{return 0}` 把 TypeError 兜成静默放行）。还原后重跑 E-r ✔（1 pass / 0 fail），副本 judge 与工作树 `diff` 逐字节一致 |

## 护栏核查

| 项 | 方法 | 结果 |
|---|---|---|
| **D7 存储可用 A/B** | `git archive e01611b2` 解到 `/tmp` 作基线副本，对**同构造** fixture 各跑 **4 轮** Stop，归一化 projectRoot 后取 stderr sha256 + 退出码 + 审计 `blockCount/degraded/diagnostics` 序列 + 终态条数，两侧 `diff` | ✅ **`diff` exit 0**。工作树侧：退出码 `2,2,0,0`；stderr sha256 `c58749410a769b16`（阻断）/ `1d55be1227b432ee`（降级）；审计 4 条 `1/false`,`2/false`,`2/true`,`2/true` 全带 `in-flight-undetermined`；终态 1 条。🔴 **两个 sha256 前缀与 `implementation-notes.md` §6.1 记载的 `c5874941…` / `1d55be12…` 逐位相同**——制品记载的 A/B 结论获得**独立复算**，不是采信 |
| **E-p 三文件 errno 字面量** | 对 judge / core / io 三文件 grep `ENOSPC\|EDQUOT\|EROFS`，剔除 `//` / `*` / `/*` 起头行 | ✅ **剔注释后三文件均零命中**。含注释总命中：judge 0 / core 0 / io **1**（`io.mjs:480` 一行 JSDoc 续行，写的是「`EROFS` 绕过——软链跟随让 errno 变成被判方可选的输入」的撤回留痕，正是 R6-12 要求**必须允许**保留的解释性注释） |
| **schema enum 长度** | `node` 实读 `properties.diagnostics.items.enum.length`（路径实为 `specs/208-fix-mode-process-compliance/contracts/...`，非 plan 写的 `specs/208-.../`简写目录名） | ✅ **28**；正向含新码 true；反向不含撤回码 true；三个 `nonblock-*` 码按 C3 裁决保留（已登记零产出残余） |
| **`routeNonBlock` / `NON_BLOCK_` 残留** | `grep -rnE 'routeNonBlock\|NON_BLOCK_' plugins/ scripts/ src/` | ⚠️ **1 命中**（非 0）：`fix-compliance-judge.mjs:697`，内容为 ` * F270 的 \`routeNonBlock\` 连同其 FR-046 JSDoc 已随卡 C3 删除，源码内不再有别的 FR-046 指针`。这是**本轮 4a INFO-7 修补新写入的注释**，纯文档、零行为、零导出、零调用。但它使 plan §4 C3 的机械退出判据（字面零命中）**不再成立**——见下「未能确证 / 新增观察」 |
| 4b W-1 JSDoc 归位 | 核 judge.mjs 符号顺序 | ✅ `PATH_SEGMENT_RENDER_LIMIT`(739) 有独立 why 注释；`renderPathSegment` JSDoc → 函数(767) 紧邻；`buildStorageUnavailableFeedback` JSDoc(783) → 函数(813) 紧邻。悬空已消除 |
| 工作树只读性 | 收尾 `git status --short` | ✅ 仍为审查前的 7 modified + `specs/276-.../` untracked，与 Phase 4c 开始时一致 |

## 4a/4b WARNING 处置

### 4a spec-review（5 WARNING）

| # | 内容 | 处置 | 证据 |
|---|---|---|---|
| 1 | 两处 JSDoc 仍写「成本论据被质疑且未澄清」 | **已修** | `core.mjs:1175-1183` 与 `judge.mjs:690-694` 均改写为 2026-09-03 裁决口径（「每条反馈 = 一次自我阻断往返；热重载只改准备成本不改地板」），见 `git diff HEAD` |
| 2 | C2 实现期 4 处对 plan 明文条款的偏离未进 notes | **已修** | `implementation-notes.md` §6 新增，逐条列 ①IW-1 默认值反转 ②IW-2/IM-1 `blocker` ③IL-1 消毒集 ④计划外用例 E-r/E-s/E-q′，各带指向 `verification/implementation-adversarial-c1c2.md` 的依据 |
| 3 | notes 顶部自相矛盾（称未 commit vs §C3 称已提交） | **已修** | `implementation-notes.md:8-13` 刷新为「C1+C2 已提交 5bb8526b、C3 已提交 7c7cb8ed，当前 4a/4b 修补未 commit」并加了「下方各 Phase 段保留写作时点快照口径」的免歧义说明 |
| 4 | T033 漏勾 | **已修** | `tasks.md:285` 现为 `[x] **T033**（已执行：两路 0C，产物 verification/implementation-adversarial-c1c2.md）` |
| 5 | 补救口 ② 的 `projectRoot` 未过 `renderPathSegment` | **已修** | `judge.mjs:829` 两处内插均改为 `${renderPathSegment(projectRoot)}`（`git diff` 可见）；D7 A/B 复算确认对正常 projectRoot 是恒等映射，stderr sha256 未变 |

INFO 6（`errors` 类型补 `blocker`）、INFO 7（补 FR-046 认领点）亦已一并处理；INFO 8/9/10 属移交/可接受项，按报告建议未改。

### 4b quality-review（5 WARNING）

| # | 内容 | 处置 | 证据 |
|---|---|---|---|
| 1 | 两段 JSDoc 锚定错位（悬空） | **已修** | 见上「护栏核查 · 4b W-1 JSDoc 归位」实测符号顺序 |
| 2 | 两处类型声明漏 `blocker` 字段 | **已修** | `io.mjs:485-486` `saveBlockState` `@returns` 与 `judge.mjs:701-703` `routeStorageUnavailable` `@param opts.errors` 均补 `blocker:string\|null` |
| 3 | 默认值口径反转未进偏差登记 + 未标注 fix-report:111 给卡 A/B 的处方已被推翻 | **已修（两半都做了）** | ① notes §6 ① 登记 IW-1；② `fix-report.md:111` 行尾追加 `⚠️ 卡 C 实证反转（2026-09-03，IW-1）：…卡 A/B 接手本处方前须按此重审` |
| 4 | mutation-log 数字口径对不齐（M-5/M-9 无说明；表头 10 条 vs 表内 12 行） | **已修** | `mutation-log.md:5-9` 现为精确口径「M-1..M-12 中实际存在的 10 条在工作树上跑并逐字节还原；M-5/M-9 已随 plan R4-1/R5-13 撤回、从未跑过、编号不重排；M-13/M-14 在 /tmp 副本上跑，不进工作树 sha256 还原校验」；表内 M-5/M-9 两行各自写明撤回依据 |
| 5 | `findPathBlocker` 零直接单元覆盖（4 条降级分支） | **已修，且修出一个真缺陷** | `fix-compliance-io.test.mjs` 新增 `F276 卡 C · findPathBlocker 降级分支` describe **8 条**（含正向对照、悬空软链、首个存在节点是目录、相对路径 + 400 段有界收敛、含 NUL 路径、软链→目录、软链→文件、非字符串/空串）。🔴 探针过程中挖出**生产可达的反向盲区**：原 `lstatSync`（不跟随）会把「指向目录的有效软链」判为非目录 ⟹ stderr 说「删除挡路对象 `/tmp`」，改为 `statSync`（跟随）；notes §6.1 ⑪ 登记为本轮**唯一行为改动**（落在 stderr 文案面，`blocker` 零判定消费，判定语义仍零改动） |

INFO 6（先截原串再转义）已修并同步 E-q′ 断言为 `512+2×5=522` + 无残片钉；INFO 7（fixture README ①③ 标注）已修；INFO 8/9 属已妥当处置/无需处置。

**小结：4a 5 条 + 4b 5 条 = 10 条 WARNING 全部「已修」，无「已登记但未处理」项。**

## 未能确证项

| 项 | 状态 | 原因 |
|---|---|---|
| `npm run build` / `npx vitest run` / `npm run repo:check` / `npm run release:check` | `[INCONCLUSIVE]`（本代理侧） | 按运行时约束由主编排器并行执行，本代理**未亲跑**，以避免并发双 vitest 写坏快照。结论以交付报告为准；本代理不对这四项作任何断言 |
| `routeNonBlock\|NON_BLOCK_` 零命中判据 | **新增观察（INFO）** | 实测 **1 命中**（`judge.mjs:697` 一行注释，本轮 4a INFO-7 修补引入）。行为面零影响，但 plan §4 C3 的机械退出判据字面上不再成立。二选一即可收口：把该注释里的函数名改为不可 grep 命中的写法（如「F270 的非阻断路由函数」），或把 plan/tasks 的判据口径改为「剔除注释行后零命中」（与 E-p 同纪律）。**本代理不改源码，只登记** |
| M-2..M-10 / M-12 / M-13 变异 | `[INCONCLUSIVE]` | 任务只要求抽样 M-1 / M-11 / M-14 三条重放，其余按 `mutation-log.md` 记载采信、未复算 |
| harness 反馈条目形态漂移的可发现性 | 已知残余（非本轮缺陷） | plan R7-10 已如实登记「P-2 是冻结快照，harness 换形态它照绿，无自动可发现性」。本报告不将其写成已守护 |
| 本机 Stop hook 生效时点 | 已登记 | fix-report 记 `judge:doctor` 3 mismatch / 7 match，本机跑的是已安装快照 4.4.0，本卡改动须等发版 + 插件缓存更新才在本机 hook 生效；本卡全部验收走 worktree 源码直调，本报告的两组端到端复现亦然 |

## 工具使用反馈

- **Spectra MCP**：本次**未使用**。本卡的验证面是「亲跑命令 + 端到端复现 + 变异重放 + 字面量守卫」，需要的是可执行证据而非结构化调用链；符号定位由既有制品（plan/notes 已给出精确行号）与单次 `grep` 即可闭合，调 `impact` / `context` 不会改变任何判定。另需注意本卡改动全在 `.mjs` 脚本面，本仓图谱对 `.mjs` 的覆盖历来是弱项（见 F243），此处调用性价比低。
- **Spec Driver 流程**：无阻塞问题。一处值得记的观察——本代理构造 (b) 复现时首次把**父目录**当成占位对象，得到了「退出码序列 `2,2,0` 但走的是普通阻断路径」的假阳性；这说明**退出码序列本身不足以判别走了哪条分支**，必须同时核首行 token 与审计 diagnostics。既有 E-a 用例正是这么写的（断言首行 + 挡路对象 + diagnostics），设计上没有这个坑；坑在「按自然语言描述临时复现」的场景。已在本报告「端到端复现」段留痕。
