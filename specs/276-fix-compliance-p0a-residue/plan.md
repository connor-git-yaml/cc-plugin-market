# 修复规划 — F276 卡 C · `saveBlockState().ok===false` fail-open 收口

> **范围唯一来源**：`fix-report.md` §「🔴 范围裁决 2 · 拆三卡」。该节以下的「修复策略 / 五批 / 回归护栏」
> 是拆卡前口径，已随 `handoff/` 移交卡 A / 卡 B，**不是本卡输入**。
> **模式**：fix（精简规划）。目标：最小、可证伪、**不新增任何阈值常量**。

## 1. 一句话方案

`routeBlock` 在 `!saved.ok` 时不再无条件 `releaseDegraded`，改为**一律 fail-closed，不设任何 errno 判定分支**：

- **任何两级写入失败**（无论 errno 是 `ENOSPC` / `EROFS` / `EDQUOT` 还是 `EISDIR` / `EACCES` / …）
  ⟹ **按本次裁决自身语义 exit 2**；
- 放行上界改挂**不依赖任何可写路径**的 storage-free 计数器——数 transcript 里 harness 回灌的
  `Stop hook feedback:` user 条目中含稳定 token 的条数（**窗口基线＝`latestFixLineIndex`，
  即最晚一次 fix 展开**，方向论证见 §9 第 8 条），达到 `BLOCK_LIMIT`（复用 FR-006 同一预算）
  即走既有 `releaseDegraded` 终态。**这是本分支唯一的上界。**
- errno **只进 stderr 与审计**，不参与任何分支判定（黑名单形态 R2 被换手法击穿、白名单形态 R4 被
  `ln -s /` → `EROFS` 击穿，论证见 §9 第 3 条）。

附带删除生产零接线的 `routeNonBlock` 死代码。

**地板不变量**（🔴 **R7-8 措辞更正**）：存储故障用户（含诚实的磁盘满 / 只读挂载）与正常用户在
**同一段 fix 展开内**的代价形态是——**同段内首次触顶前 2 次 Stop 往返，其后回合 0 次，摊销 2/N**
（详 §8 ⑨）。**不得再写「同一段内完全相同的 2 次」**——那是 R6-10 判死的比较句翻版。
被判方经 `!saved.ok` 的绕过成本从 **0 次** 抬到 **每段首次触顶前 2 次 Stop 往返**。

🔴 **口径限定（R7-5，禁止再写无限定的"最短完全绕过 = 2"）**：该数字只限 **`!saved.ok` 机制面**。
被判方另有一条 **1 次往返**的**配置面**路径——读完第 1 次阻断 stderr 的补救口 ② 即可自写
`fix_compliance:` / `enforcement: warn`，第 2 次 Stop 在 warn 分支 `return 0`。该机制**既有**、
已公开文档化（`docs/configuration.md:61`）、落在**被判方写域**、与 `!saved.ok` 无关
⟹ 同 ⑩ 判例**不在卡 C 修**，登记见 **§8 ⑫**，显式**移交卡 B**。

🔴 **诚实代价的精确上界（R6-1，禁止再写"所有存储故障用户经历相同的 2 次往返"）**：反馈计数是
**每段窗口**的（基线 `latestFixLineIndex`，§9 第 8 条），故会话总代价 =
**2 × fix 展开段数（× compaction 次数）**，不是全局常数 2。该代价经裁决**可接受**——每段的起点
都是用户主动展开 `/spec-driver-fix` 的动作、每次阻断都带可执行 stderr 补救口，换来的是关闭
`!saved.ok` 上的 0 次往返口。误伤方向登记见 **§8 ⑪**（与绕过方向的 ⑨ 分列，不得合并）。

🔴 **精确表述（R5-2，禁止再写"不存在 0 次往返路径"）**：正确口径是
「**`!saved.ok` 分支不再提供 0 次往返路径**」。预置状态文件
`{"blockCount":2,"degradedRecorded":true}` ⟹ 0 往返 + 零终态，是**改动前就存在的相邻向量**
（状态文件落在被判方写域，与 `!saved.ok` 无关，第 2 轮 I-B 表已列为既有 0 成本项），
本卡不修，显式登记并**移交卡 B**（§2 矩阵、§8 ⑩、§11）。

诚实故障用户的补救口在 stderr **按生效即时性排序**明示（§4 C2 第 4 条）。

## 2. FR → Phase 覆盖矩阵（F270 over-claim 的根因对策，逐条认领或显式移交）

| FR | 内容 | 本卡处置 | 落点 |
|---|---|---|---|
| **FR-046 第 5 点** | save 失败必须 fail-closed，不给「既不计数又不留痕」的通道 | ✅ **认领**（改在 `routeBlock` 侧；原文写在 `routeNonBlock` JSDoc，但 `routeNonBlock` 本卡删除，语义迁到 routeBlock 唯一路由） | C2 |
| FR-046 其余 4 点 | 解锁计时器路由（不计 blockCount / 未耗尽按自身语义 / 耗尽终态可见 / 不可擦 backstop） | ⛔ **移交卡 B**（含 `routeNonBlock` 重写与接线）；本卡只删死代码，`nonBlockStopCount` 状态字段**保留** | — |
| FR-012 / FR-026..029 / FR-030 / FR-031 / FR-032 / FR-033 | 锁与计数幂等 · GATE 指纹去重 · PENDING 惯例与收紧 · `snapshot-stale` 专码 | ⛔ **其余 FR 一律移交**（卡 A / 卡 B）；逐条落点与理由见 `handoff/README.md` | — |
| **既有相邻向量** | 预置状态文件 `{"blockCount":2,"degradedRecorded":true}` ⟹ 0 往返 + 零终态 | ⛔ **不在本卡**（R5-2）：状态文件在被判方写域、与 `!saved.ok` 无关、**改动前就存在**；与状态文件完整性 / 锁 / 幂等同属一域 ⟹ **移交卡 B** | §8 ⑩ |
| **R-11 护栏** | 「任何不计数的裁决必须同时规定放行路径」（总上界必须存在） | ✅ **本卡在 `!saved.ok` 分支上建立上界**（此前该分支根本不计数、也无上界——它是直接放行） | C2 |
| R-12 护栏 | 诊断码闭集 enum 与产出同步 | ✅ 本卡新增 **1 码**，按 `:2918` 写法**双向**登记（登记必产出 / 产出必登记） | C2 |

## 3. 变更面盘点（Codebase Reality Check）与影响评估

| 目标文件 | LOC | 本卡改动 | 已知 debt / 牵连 |
|---|---|---|---|
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 1160 | +≈60 / −≈95（`routeStorageUnavailable` 新分支 + 1 码 + 透传；删 `routeNonBlock` 及 2 常量 + JSDoc） | 净 **减行**；`routeNonBlock` 删后 `:962` 历史注释、`nonblock-*` 三码指针需同步 |
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 1877 | +≈35（token 常量 2 个 + `countStorageUnavailableBlockFeedback`） | 纯新增，零既有函数改签名（**基线取 `detectFixSkillExpansion` 已算出的 `latestFixLineIndex`，core:600-625 同一趟产出，零额外扫描**）；🔴 **不新增任何 errno 集合常量或谓词**（R4-2 白名单本轮撤回，见 §9 第 3 条） |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | 417 | +≈14（`saveBlockState` 内两处 try/catch 收集 `{path: err.path, stage, code}`；失败分支附 `errors[]`） | 🔴 **`tryWriteState` 签名不变**（R4-10：errno 在 `saveBlockState` 内收集，不外扩签名）；🔴 **`path` 取 `err.path` 而非状态文件路径**（R7-7：Node 在 mkdir / write 两处均填 `err.path`，mkdir 时它是**父目录位置的挡路物**、write 时才是状态文件本身；取错即让 stderr 指向错误对象）；**成功分支返回对象逐字不变**（D7）；`errors[]` **只为 stderr / 审计可观测性**，零判定消费（`stage` 同样零消费，R5-11） |
| `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | 3507 | 改 2 条既有合同钉 + 删 5 条 + 新增 ≈14 条（含 E-m / E-n 端到端与 E-o / E-p 源码守卫） | 见 §5「牵连」 |
| `plugins/spec-driver/tests/fix-compliance-core.test.mjs` | — | +4 条单元（U-1 / U-2 / U-3 / U-7） | 计数器谓词与基线缺席方向 |
| `plugins/spec-driver/tests/fix-compliance-io.test.mjs` | 606 | +2 条（U-4：errno / `errors[]` 含 `stage`） | — |
| `plugins/spec-driver/tests/f270-real-corpus.test.mjs` | — | +2 条（P-2 入库 fixture 谓词 · P-3 脱敏完整性） | **P-1 随 R6-6 砍掉**（CI 恒 skip / 本机 650MB 全量读 / 选中集为空时静默绿）；**P-2 / P-3 走入库 fixture，CI 恒执行**（R5-4） |
| `plugins/spec-driver/tests/fixtures/fix-compliance/real-stop-hook-feedback-entries.jsonl` | 新增 | **4** 条脱敏真实条目（命中 1 / `tool_result` 型 user 1 / assistant 含串 1 / **真实 skill 展开条目正文含 token 1**，R6-4） | 见 §5「真实语料探针」的脱敏字段清单 |
| `plugins/spec-driver/tests/fixtures/fix-compliance/README.md` | 189 | +1 行索引（照 §「F270 真实录制语料」表格式） | 入库 fixture 无索引即孤儿 |
| `specs/208-.../contracts/fix-compliance-verdict-event.schema.json` | 69 | enum 27 → **28**；`blockCount` description 补一句 | 闭集合同，漏登记即漂移 |

**影响评估**：直接改动 10 文件（3 源码 + 4 测试 + 1 新 fixture + 1 fixture README + 1 schema）、零跨包
（全在 `plugins/spec-driver/` + 其 contracts）、无数据迁移
（状态文件 schema 不变、`nonBlockStopCount` 保留）、无公共 API 变更（`routeNonBlock` 是 export
但**生产零接线**，仅 5 个单元测试 import——已用变异实证）。**风险等级：MEDIUM**——不因文件数
（<10），而因**改的是门禁裁决方向**：改错方向即把 fail-open 换成会话 brick。故按 §4 分 3 批、
每批独立可验证，且以 `E-c`（存储可用对照组逐字节不变）作为承重回归。

`JUDGE_FILE_SET` 闭包（R-10）：不新增 lib 文件 → 闭包不扩张，守卫测试不受影响。

## 4. Phase 划分（C1 → C2 → C3；R4-10 定序）

### C1 · core 计数器 + token 常量 + io errno（**无任何 errno 谓词**）

1. core 新增导出：
   - `HOOK_FEEDBACK_PREFIX = 'Stop hook feedback:'`
   - `STORAGE_UNAVAILABLE_FEEDBACK_TOKEN = '[FIX-COMPLIANCE][STORAGE-UNAVAILABLE]'`
   - `countStorageUnavailableBlockFeedback(entries, latestFixLineIndex)`：数满足
     `lineIndex > baseline && role === 'user' && textBlocks.length === 1 &&
     textBlocks[0].startsWith(HOOK_FEEDBACK_PREFIX) && textBlocks[0].includes(TOKEN)` 的条目数。
     风格与 `countAssistantEntriesSinceEarliestFixExpansion`（core:1119）一致：**单趟 O(entries)、零正则**
     （判定器跑在同步 Stop hook 上）。
   - 🔴 **窗口基线是 `latestFixLineIndex`（最晚一次 fix 展开），不是 `earliestFixLineIndex`**（R5-1）：
     `detectFixSkillExpansion`（core:600-625）已在**同一趟**里把 earliest / latest 两个基线一次写定，
     取 latest 零额外扫描。**不得照抄闸门三的 earliest 约定——两者方向相反**，方向论证见 §9 第 8 条。
     由 **E-m** 钉住（合规 reset 后重展开 fix、再坏 ⟹ 第 1 次 Stop 仍 exit 2）。
   - 🔴 **基线缺席（null / 未传 / 非数字）⟹ 返回 `0`，不是 `-1` 全量计数**（R5-6）：本计数器的
     `-1` 基线 ⟹ 全量计数 ⟹ 更容易触顶 ⟹ **放行方向**，与 `countAssistantEntriesSinceEarliestFixExpansion`
     的 `-1`（那里全量计数是 fail-closed）方向相反，**不得照抄**。由 **U-7** 钉住。
   - 🔴 **不新增 errno 集合常量、不新增 errno 谓词**：R4-2 曾在此加 `ENVIRONMENTAL_STORAGE_ERRNOS` /
     `isEnvironmentalStorageFailure`，本轮**整体撤回**（§9 第 3 条）。core 侧新增面仅为上述 3 项。
2. io：🔴 **`tryWriteState` 签名不变**（仍返回 `boolean`，R4-10）——errno 在 `saveBlockState` 内
   **两处 try/catch 各自收集**：写主路径 / 写 tmp 各包一层 `try { ... } catch (err) { codes.push(err && err.code) }`
   风格的收集点，两级皆败时返回 **附加** `errors:[{path,stage,code},{path,stage,code}]`
   （`err.code` 非串取 null；`stage:'mkdir'|'write'` 标出是建目录还是写文件时炸的，R5-11）。
   🔴 **`path` 一律取 `err.path`，不得取传进来的状态文件路径**（R7-7）：`tryWriteState` 的 mkdir
   建的是 `dirname(filePath)`，此时挡路的是**父目录位置的那个文件**（如 `.specify/runs` 本身是个文件），
   而状态文件路径指向的是别的对象 ⟹ 渲染错对象会诱导消费者对**审计与终态所在的目录**下手。
   Node 在 mkdir / write 两处均填 `err.path`，直接透传即可。
   🔴 `stage` **与 `code` 同为零判定消费**——只进 stderr 渲染（`主路径: mkdir EEXIST @ <err.path>`）与审计。
   🔴 成功的两个 return 逐字不变（D7）。`errors` **只进 stderr 解释与审计可观测性，
   零判定消费**——判定侧不得读 `saved.errors` 的任何字段做分支（§9 第 3 条）。
3. **退出判据**（机械）：`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
   plugins/spec-driver/tests/fix-compliance-io.test.mjs` 全绿；且 `git diff` 中
   `fix-compliance-judge.mjs` **零改动** ⟹ 端到端退出码矩阵与 HEAD 逐字相同（`npm run test:plugins` 全绿即证）。

### C2 · judge 方向反转 + 上界 + stderr + schema（依赖 C1）

1. `evaluate`：在计算 `assistantEntriesSinceEarliestFix` 的**同一处**（judge:302）算
   `storageUnavailableFeedbackCount`——🔴 但**传的是 `expansion.latestFixLineIndex`**，
   不是同处那个 `earliestFixLineIndex`（R5-1；两个基线同来自 `detectFixSkillExpansion` 的同一次调用）。
   按既有「事实字段透传」先例并入**主 return**（judge:574-578）。
   🔴 **所有 `verdict:null` 返回点**（`judge:235` / `:245` / `:290` / `:563`，含非 fix、
   `feature-dir-unresolvable` 等）**一律不加**——它们 `verdict:null`，runHook 早退，永不触达 `routeBlock`
   （R6-13：早退点是 **4 处**，前稿写「前两个 return」漏数两处，会诱导实现期只核前两处）。
   `assistantEntriesSinceEarliestFix` 的既有透传与用法**一律不动**（本卡不再消费它，R4-1）。
2. `runHook` 把 `storageUnavailableFeedbackCount` 传给 `routeBlock`（第 5 参用具名对象，F238 纪律：**无默认值**）。
3. `routeBlock` 的 `!saved.ok` 分支改走新私有函数 `routeStorageUnavailable(…, { feedbackCount, errors, extraDiagnostics })`：
   🔴 **该函数只有两个闸门，且都不看 errno**（R4-2 白名单本轮撤回）：
   - **闸门 1（唯一上界＝反馈计数）**：`feedbackCount >= BLOCK_LIMIT` ⟹
     `releaseDegraded(..., { storageUnavailable:true, ... })`（**既有终态，形态不改**），
     `extraDiagnostics` push `storage-unavailable-block-budget-exhausted`。
   - **闸门 2（否则一律 fail-closed）**：`appendAuditEvent`（`blockCount:null`、`degraded:false`、
     `extraDiagnostics` 含 `state-storage-unavailable`，try 包裹）＋ stderr ＋ **return 2**。
     🔴 `saved.errors` 的 errno **在此不产生任何分支**——`ENOSPC` / `EROFS` / `EDQUOT` 与
     `EISDIR` / `EACCES` 走**同一条路**（`ln -s /` 可让两级同为 `EROFS`，见 §9 第 3 条）。
   - 🔴 `diagnostics` 合并须**保留上游**：两条路径一律
     `[...new Set([...extraDiagnostics, '<本次码>'])]`，不得像初稿那样硬编码 `['state-storage-unavailable']`
     把上游（如在途预算耗尽）诊断码丢弃（R4-6）。
4. stderr 形状（**首行必须以 token 起头**，与计数器同源）。
   🔴 **stderr 的主消费者是模型，不是人**：若动作行 + 双路径指引全指向「补制品」，
   模型会把预算烧光在一个它结构上修不了的问题上，而人不知情。故「这不是制品问题」这句
   **并进首行、与 token 同一行**（第 5 轮误伤面第 4 项，随 R5-3 一并收口：单独成行会被只读首行的消费者漏掉），
   `buildFeedbackText` 放最后（R4-5）。
   🔴 **补救口按「生效即时性」排序**（R5-3；前稿把须重启会话的环境变量当唯一补救口，是**假补救口**——
   hook 进程 env 来自 CC 启动快照，会话内 `export` 到不了，POSIX 语义，且与 §8 ⑧「hook 配置启动快照」
   本是同一事实，前稿自相矛盾）：
   ```
   [FIX-COMPLIANCE][STORAGE-UNAVAILABLE] 阻断计数无法持久化，本次按裁决自身语义阻断（连续 2 次后降级放行）；⚠️ 这不是制品问题，模型无法修复：请向用户报告下方路径不可写，勿反复重试补制品
   主路径: <stage> <code> @ <err.path>；回落: <stage> <code> @ <err.path>
   补救（按生效快慢）：① 修好上述路径 —— 下一次 Stop 立即生效；按上行的 <code> 对应处置：EEXIST|ENOTDIR ⟹ 删除上行 @ 后那一个文件（⚠️ 只删那一个文件，勿删 .specify/runs 目录）；EACCES ⟹ chmod u+w 其父目录；其余 code ⟹ 请向用户报告该错误码
   ② 由用户决定是否降级门禁：在 <projectRoot>/spec-driver.config.yaml（或 <projectRoot>/.specify/spec-driver.config.yaml）写入下面两行 —— 配置每次 Stop 重读，下一次 Stop 即生效
   fix_compliance:
     enforcement: warn
   ③ SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<可写目录> claude —— ⚠️ 须重启会话（hook 进程 env 取自启动快照，会话内 export 无效）
   <buildFeedbackText(verdict.missing, { diagnostics: mergedDiagnostics })>
   ```
   🔴 **上块的 `fix_compliance:` / `  enforcement: warn` 是两行字面量，第二行缩进两空格**（R7-6）：
   转写成自然语言（前稿的「写入 `fix_compliance:` 段，其下一行 `enforcement: warn`」）会**丢缩进**
   ⟹ 模型照写出无缩进两行 ⟹ YAML 解析成 `fix_compliance: null` + 顶层 `enforcement`
   ⟹ 回到 `undefined ⟹ block` 且**零诊断**，正是 R6-2 要关的那张口。此处必须是渲染出的字面两行，
   不是对格式的描述。（本文件用 3 空格代码块缩进，实际渲染的第二行缩进为**两空格**。）
   🔴 **① 的 code 对应表是纯渲染映射，零判定消费**（R6-3）：前稿把 `chmod u+w` 写成唯一动作，
   而 R5-11 主线程实跑钉住的三条 errno（`EISDIR` / `EEXIST` / `ENOTDIR`）**无一适用** chmod，
   且它渲染的是**文件路径**、该 chmod 的是**父目录** ⟹ 是与 R5-3 同类的**假补救口**。
   映射只改 stderr 文本形态，`saved.errors` 的 `stage` / `code` 仍**不进任何分支**（§9 第 3 条不变）。
   🔴 **静态映射不得写 `ENOSPC` 明文**（R7-1）：前稿的 `ENOSPC ⟹ 释放磁盘` 是写死在模板里的
   **字面量**，与源码守卫 **E-p**（judge / core / io 三文件不含 `ENOSPC` / `EDQUOT` / `EROFS` 字面量）
   **互斥** ⟹ 正确实现必红 ⟹ 实现者更可能去削弱 E-p ⟹ **M-8' 失守**、errno 白名单可重新藏回
   （F278「防线照错方向搭」同型）。终版口径：**运行时 `err.code` 照原样渲染**（它是取到什么打什么，
   不是模板里的字面量，E-p 不命中）；**静态映射只保留两条**——`EEXIST|ENOTDIR` ⟹ 删除 `@` 后那一个文件、
   `EACCES` ⟹ `chmod u+w` 父目录；**其余 code 一律走「请向用户报告该错误码」**，不为任何具名码单列动作行。
   ⚠️ `EEXIST` / `ENOTDIR` / `EACCES` 三个码**可以**留在模板里——E-p 只禁 `ENOSPC` / `EDQUOT` / `EROFS`
   三个**环境性**码（它们正是被撤回的白名单成员）；这三个是自诱发码，与白名单无关。
   🔴 **① 的删除对象必须由 `@ <err.path>` 指定，且明写"勿删 `.specify/runs` 目录"**（R7-7）：
   `tryWriteState` mkdir 的是 `dirname(filePath)`，挡路物是**父目录位置的那个文件**；若行内仍渲染状态文件路径，
   模型可能把「删占位物」升格成 `rm -rf .specify/runs` ⟹ **审计与终态同在该目录下 ⟹ 毁证据**。
   故 ① 只允许指向「上行 `@` 后**那一个**文件」，并显式给出禁删目录。理由与 R6-3 判死 chmod 臂同构。
   🔴 **② 必须给出文件名与嵌套层级**（R6-2）：前稿只写点号式 `fix_compliance.enforcement: warn|off`，
   既没给文件名也没给嵌套。本仓两处默认配置文件**均不存在** ⟹ 用户须**新建**；若照点号写法在
   YAML 顶层误写成 `enforcement: warn`，则 `fix_compliance` 缺失 ⟹ 走 `undefined ⟹ block`
   **且零诊断** ⟹ 又一个假补救口（与 R5-3 同类）。两处路径来自 `findConfigFile`（`fix-compliance-io.mjs:112-118`）：
   `<projectRoot>/spec-driver.config.yaml` 优先，`<projectRoot>/.specify/spec-driver.config.yaml` 其次——主线程已核实。
   ②「配置每次 Stop 重读」是主线程核实过的事实（`findConfigFile` 每进程调用一次，非启动快照）；
   ③ 明写「须重启」而不是含糊写成"可临时绕开"。`<stage>` 即 io 收集的 `'mkdir'|'write'`（R5-11）。
   🔴 **② 一律写成「用户动作」，不得写成对模型的操作指令**（R7-5）：stderr 的主消费者是模型，
   而 ② 恰好把「文件名 + 嵌套 + 生效时点」三件事一次性告诉了**被判方**——它读完第 1 次阻断即可自写配置，
   第 2 次 Stop 走 warn 分支 `return 0` ⟹ **1 次往返**的配置面绕过。该机制既有、已公开文档化
   （`docs/configuration.md:61`）、落在被判方写域、与 `!saved.ok` 无关 ⟹ 同 ⑩ 判例**不在卡 C 修**
   （登记 §8 ⑫，移交卡 B）。本卡能做的只是措辞收口：写成「**由用户决定是否**降级门禁：…写入下面两行」，
   而不是「（你）在 X 写入 Y」。⚠️ 这只降低诱导性，**不构成防线**——不得据此声称该路径已被关闭。
   （`mergedDiagnostics` 即第 3 条的 `[...new Set([...extraDiagnostics, 'state-storage-unavailable'])]`，
   不得在此处重新硬编码单元素数组——那正是 R4-6 丢弃上游诊断码的入口。）
   `state-storage-unavailable` 保持用户可见（第 3 轮 N3-2 / W-4 不回退）。
   实现须把「新增路径行不污染锚点」的核验**扩到整条 stderr**（已核两条正则对状态路径不命中，
   但第 4 轮引入的环境变量行 / errno 行、第 5 轮引入的 `stage` 段与 ①②③ 补救行都是新文本面）。
5. schema：enum 补 **1 码**。**换算式（R4-2 撤回后重算）**：schema 实数 `N = 27`（已用 `node -e` 读出）；
   本卡初稿新增 2 码（+2），R4-1 删去 `storage-unavailable-entry-budget-exhausted`（−1），
   R4-2 新增的 `storage-unavailable-environmental-release` 随白名单**本轮一并撤回**（−1）
   ⟹ 净新增为 **1** 码（仅 `storage-unavailable-block-budget-exhausted`），
   故 `enum.length` 改前 `=== 27` → 改后 `=== 28`，用 `node -e` 读
   `properties.diagnostics.items.enum.length` 机械核对，不靠目测。
   `blockCount` 的 description 补「存储不可用阻断分支亦为 null（预算不可知）」。
6. **退出判据**：`npm run test:plugins` 全绿；端到端 **E-a / E-b / E-b′ / E-c / E-e / E-g / E-h / E-i / E-j /
   E-m / E-n**、**E-o**（运行时不变量 + 注册集核对，R6-5/R6-11）与源码守卫 **E-p** 全绿
   （E-d / E-f / E-k 已于前轮删除，**E-l 本轮随 R5-13 删除**，
   其守护职责由源码守卫 E-p 接管）；
   §6 变异清单逐条实跑并记录变红用例（不接受「应该会红」的推演）。

### C3 · 删死代码（🔴 **本卡最后一个独立提交**）

> R4-10：C3 是纯删除、零行为改动，与 C1/C2 的行为面正交。**保留**（用户原卡明令删死代码），
> 但**必须最后单独提交**——这样 C2 的行为回归若变红，责任面不被删代码的 diff 稀释。

- 删 `routeNonBlock`（judge:735-823）、`NON_BLOCK_LIMIT`（:82）、`NON_BLOCK_ENTRY_LIMIT`（:100）及其 JSDoc。
- 删测试：`routeNonBlock 单元（零接线期合同）` describe（4 条）+ `delta-2 定时雷：NON_BLOCK_LIMIT ≥ BLOCK_LIMIT`（1 条）。
- 改测试：`F270 P3 · saveBlockState 带回合同`（`p3-carry`）**必须保留**——用例目的是「`routeBlock` 整体覆写
  不得抹平 `nonBlockStopCount`」，与死代码无关。改用 `saveBlockState(tmp,'p3-carry',{blockCount:0,
  degradedRecorded:false, inFlightDeferCount:0, nonBlockStopCount:1})` 直接造数（新增 io import）。
- `routeBlock` / `releaseDegraded` / defer 分支里「原样带回 `nonBlockStopCount`」的注释与行为**一律不动**（D6）。
- 注释指针同步（**零行为改动**）：judge:962 历史叙述去掉对已删函数的引用；io:373-375 与 normalizeState:311-313
  按 R5-10 改写为——「`nonBlockStopCount` **当前只有原样带回方、没有递增方**；带回逻辑属**不可删面**
  （`routeBlock` / `releaseDegraded` / defer 分支整体覆写时不得抹平，合同钉见 `p3-carry`）；
  递增方留给卡 B 接线。🔴 **该字段不可单独作为任何放行预算**，除非卡 B 同时定义它的不可伪造性——
  它落在被判方可写的状态文件里，直接当预算即等于送出一条 0 成本绕过。」
  （前稿「本字段当前无生产写入方，保留给卡 B 接线」漏掉了"带回方存在"与"不可作预算"两点，
  会诱导卡 B 把它当现成预算用。）
- schema 的 3 个 `nonblock-*` 码 **保留不删**：删了卡 B 要再加回（合同 churn），且本仓尚无
  「enum ⊆ 已产出码」的全局反向守卫（那是卡 A 的 G0 canonical 表范围）。
  🔴 残余显式登记：删除后这 3 码成为「登记但零产出」，本卡**刻意不加**全量反向守卫，否则立即自伤。
- **退出判据**：全仓 `rg -n 'routeNonBlock|NON_BLOCK_LIMIT|NON_BLOCK_ENTRY_LIMIT' plugins/ scripts/ src/`
  零命中（specs/ 与 docs/ 历史记录不算）；`npm run test:plugins` 全绿。

> C2 与 C3 都改 `fix-compliance-judge-cli.test.mjs` 的不同区段——若并行执行须最后串行合并。
> 🔴 提交顺序按 R4-10 定为 **C1 → C2 → C3**（C3 是纯删除，作最后一个独立提交），
> 与前稿建议的 C1 → C3 → C2 相反：行为面先落地并验证，删代码的 diff 不得混进行为回归的责任面。

## 5. TDD 清单

**单元**（`node --test` 直调 core/io）
- **U-1** `countStorageUnavailableBlockFeedback`：真实形状（`type:'user'`、`isMeta:true`、
  `userType:'external'`、**字符串 content**）计数正确；`lineIndex <= baseline` 的不计。
- **U-2** 反例集：`role==='assistant'` 且文本含 token → 0；`textBlocks.length === 2`（数组 content 两块）→ 0；
  首行不是 `Stop hook feedback:` 但含 token → 0；含 `[FIX-COMPLIANCE] ` 普通阻断反馈（无 token）→ 0。
- **U-3** token 不被既有前缀误匹配：`PREFIX_BLOCK/WARN/DEGRADED` 三条渲染文本 **均不含** token（断言 `includes` 为假）。
  🔴 **并断言 `startsWith` 条件的承重性**（R5-14）：`startsWith(HOOK_FEEDBACK_PREFIX)` 不是防御性冗余，
  它承的重是——**技能展开注入的 user 单文本块恒以 `Base directory for this skill:` 起头（实测）**，
  故被判方自写的 SKILL 正文里即便原样抄进 token，那段文本**永远不在 offset 0**，`startsWith` 必假。
  换成 `includes(PREFIX)` 即失去这一层，被判方在自写 SKILL 里塞 `Stop hook feedback:` 就能投喂计数器。
  用例：构造首块以 `Base directory for this skill:` 起头、正文含 `Stop hook feedback:` + token 的 user 条目 ⟹ 计 0。
  🔴 **形态稳定性实证（R6-6，P-1 砍掉后这条实证改由本注释承载）**：子代理实扫本机 **324 份** jsonl /
  44174 行 / 1.8s，横跨 **六个 harness 版本 `2.1.219 → 2.1.247`**，命中谓词的条目形态 **29/29 一致**
  （单文本块 + `Stop hook feedback:` 起头）。这说明谓词依赖的形态在可观测的版本跨度内稳定，
  但**不是**形态永不漂移的保证。🔴 **可发现性口径（R7-10）**：**harness 形态漂移无自动可发现性**——
  P-2 是**冻结快照**，只守我方谓词对该快照的回归，harness 换了形态它照绿。**已接受为残余**；
  重录时点（何时该重新录制 fixture）见 `handoff/README.md`。**不得**再写成「可发现性由 P-2 提供」。
  🔴 **触发面附记（R6-14）**：本分支的两级默认状态路径 `.specify/runs/.fix-compliance-state` 与
  `$TMPDIR/spec-driver-fix-compliance` **均在被判方写域**，`touch` 出同名文件占位即可造出两级不可写，
  **不需要 env 注入**；E-a / U-4 用 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 只是**测试复现手段**，
  不得据此以为"必须能改 env 才触发得了"而低估该分支的可达性。
- **U-4** io：两级皆败 → `ok:false` 且 `errors` 两项，每项含 `path` / `stage` / `code`（`code` 为字符串 errno）。
  🔴 **`path` 必须等于 `err.path`**（R7-7）：文件占位（`stage:'mkdir'`）那一项断言 `path` 指向
  **父目录位置的挡路文件**（即 `dirname(状态文件路径)`），而非状态文件路径本身；
  目录占位（`stage:'write'`）那一项断言 `path` 指向状态文件路径。二者取值不同，正是本条的守护点。
  🔴 **按主线程实跑值断言**（R5-11，不写平台猜测）：**目录占位** ⟹ `stage:'write'` + `code:'EISDIR'`；
  **文件占位** ⟹ `stage:'mkdir'` + `code:'EEXIST'`；**`SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 指向一个文件**
  ⟹ `stage:'mkdir'` + `code:'ENOTDIR'`。两级任一成功 → 返回对象**不含** `errors` 键（成功面逐字不变）。
- **U-7**（R5-6 方向钉）基线缺席：`countStorageUnavailableBlockFeedback(entries, null)` /
  `(entries, undefined)` / `(entries, 'x')` 三种非数字入参，即便 `entries` 含 10 条命中条目，
  **一律返回 `0`**。存在理由：若照抄 `countAssistantEntriesSinceEarliestFixExpansion` 取 `-1`，
  基线缺席就变成全量计数 ⟹ 更容易触顶 ⟹ **放行方向**；本计数器的方向与它相反。
  🔴 **当前生产不可达，本条是前瞻钉（R6-13）**：`isFix ⟺ earliestFixLineIndex ≠ null ⟺ latestFixLineIndex ≠ null`，
  且四个 `verdict:null` 早退点（`judge:235/245/290/563`）全在 `routeBlock` 之前 return ⟹ 生产路径上
  `latestFixLineIndex` 不会以 `null` 抵达计数器。保留该用例是为了把**纯函数的方向合同**钉死，
  防止后续卡新增调用点时照抄错方向；**不得**因"当前不可达"把它当冗余删掉。
  🔴 与 P-2 的分工：U-7 只管 `null` / `undefined` / 非数字 ⟹ `0`；**数字基线（含 `-1`）⟹ 计其后条目**
  是同一纯函数合同的另一半，由 **P-2** 写死 `-1` 显式基线来钉（R6-4）。
- 字母 **U-5 / U-6** 空缺：U-6（白名单谓词 `isEnvironmentalStorageFailure`）随 R4-2 撤回而删除，
  **字母不重排**（同 E-* 的交叉引用纪律）。

**端到端**（一律 `runCli` 真进程；两级不可写用 `.specify/runs/.fix-compliance-state` 文件占位 +
`SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 指向一个文件，同 judge-cli.test:463-474 既有手法）
- **E-a**（主验收；两级不可写 ⟹ 走 fail-closed 分支，**与 errno 取值无关**）两级占位 ⟹
  第 1、2 次 Stop **exit 2**，stderr **首行**同时含 token 起头**与**「这不是制品问题，模型无法修复」
  （R5-3 并行同一行，断言在**首行**上做而非全文）、含两级路径 + `stage` + errno（断言 errno
  **存在且非空**，不硬钉某一值——平台差异 `EISDIR`/`ENOTDIR`/`EACCES`）、含 ①②③ 三条补救口、
  含 missing 动作行；
  🔴 **路径行断言含 `@ ` 段**（R7-7）：断言两级路径行各含 `'@ '` 后跟一个非空路径
  （证明渲染的是 `err.path` 而不是传进去的状态文件路径）。
  🔴 **补救口 ② 的断言必须同时覆盖两段**（R6-2，缺任一段即等于放过"假补救口"）：
  **(a) 文件名段**——含 `spec-driver.config.yaml`，且含 `.specify/` 回落路径；
  **(b) 嵌套段**——🔴 **断言改用正则**（R7-6）：`/fix_compliance:\s*\n\s{2,}enforcement:\s*(warn|off)/`
  ——它同时钉住「两行」与「第二行有缩进」两件事；**不接受**只断言点号式 `fix_compliance.enforcement`
  字符串（前稿漏嵌套层级），也**不接受**分别 `includes('fix_compliance:')` 与
  `includes('enforcement: warn')`（那对"无缩进两行"这一 R7-6 的失效形态零守护力）；
  ③ 行另断言含 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 与「须重启」字样；
  ① 行断言至少含一条 code 对应处置，且含「勿删 `.specify/runs`」字样（R6-3 / R7-7）。
  每次阻断后**按真实形状往 transcript 追加 `type:'user'` 反馈条目**（字符串 content = `Stop hook feedback:\n[<cmd>]: ` + 本次 stderr）；
  第 3 次 **exit 0** + 终态记录（`workflow-run-summary`）+ 审计事件含 `storage-unavailable-block-budget-exhausted`。
  🔴 **前稿的「同周期跑 2 次 CLI」记录本轮删除**（R6-8）：harness 不在该环内——CLI 连调两次只测出
  判定器自身可重入，对 §8 ⑧「多 hook 的 stderr 是否被 harness 合并成 1 条 user 条目」**零信息量**，
  留着会让人误以为该未知已被观测。该观测**登记移交** `handoff/README.md`「⑧ 自注册 hook 投喂面」，
  正确的取证形态是**真实双注册运行**（本机语料中含 2+ hook 段的条目为 **0**，仍无样本）。
  🔴 **用 env 只是复现手段**（R6-14）：两级默认状态路径本就在被判方写域（详见 U-3 附记），
  E-a 用 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 是为了在 tmp 侧稳定造错，不代表触发该分支需要 env 注入。
- **E-b**（伪造反例）把**同一 token** 写进 assistant text 条目 ×3 ⟹ 不计数，第 3 次仍 **exit 2**。
- **E-b′**（🔴 **`startsWith` 条件的唯一端到端守护点**，守 **M-4**）：注入 3 条 `type:'user'`、
  **单文本块**、首块以 `Base directory for this skill:` 起头、正文含 token 的条目 ⟹ 不计数 ⟹
  第 3 次 Stop 仍 **exit 2**。`role` 无法先行排除（它就是 `user`），故 `startsWith` 是唯一拦截点。
  🔴 **诱饵必须取「非 `spec-driver-*` 的真实 skill 展开」**（R7-4，如 `/skills/defuddle` 的展开条目）：
  - 若诱饵含 `spec-driver-fix` 展开 ⟹ 它会把 `latestFixLineIndex` **推到诱饵之后** ⟹ 窗口自塌、
    计数恒 0 ⟹ 用例**即便删掉 `startsWith` 条件也照绿**（**假绿**，M-4 失守）；
  - 若诱饵含**其他** `spec-driver-*` mode 展开 ⟹ 改写 `anchor.mode` ⟹ 走非 fix 路径 ⟹ **假红**。
  - `SKILL_EXPANSION_REGEX` 只匹配 `spec-driver-([a-z]+)`，故非 `spec-driver-*` 的真实 skill 展开
    **不命中**、`earliest`/`latest` 两个基线均不动——这是**唯一可写形态**。
  ⚠️ 主编排器的 fixture 备料已用 `spec-driver-fix` 展开，**须换掉**（同 P-2 ④）。
- **E-c**（承重对照组）存储可用：与改动前退出码序列 `2,2,0` 逐字相同、stderr 前缀相同、审计事件
  `diagnostics` 集合相同、终态记录条数相同 —— **必须与 HEAD 版本同窗口 A/B 实跑对拍**，不接受纸面比对。
  🔴 **追加断言：三次 stderr 全文均不含 token**（R4-9）——token 一旦渗漏到正常路径，被判方
  `rm -rf` 状态目录后即可让计数器自带 2 条"历史反馈"，地板从 2 掉到 0。
- **E-e**（单级失败）只占位主路径、tmpdir 可写 ⟹ 走 tmpdir，退出码/审计/终态与存储可用**完全相同**（不误触新分支）；
  🔴 **同样断言 stderr 全文不含 token**（R4-9）。
- **E-g** schema 双向守卫（照 `:2918` 写法，**1 码一条**）：`storage-unavailable-block-budget-exhausted`
  enum 已登记 ∧ judge 源码含该字面量。🔴 **反向**：断言 enum 中**不含**
  `storage-unavailable-environmental-release`（撤回码不得偷偷回流）。
- **E-h** `p3-carry` 保留并通过（`routeBlock` 整体覆写不抹平 `nonBlockStopCount`）。
- **E-i**（基线锚，守 M-6）在 fix 展开**之前**注入 2 条历史反馈条目（含 token 的 `type:'user'` 条目）
  ⟹ 首次 Stop 仍 **exit 2**（不被会话前的历史条目提前喂饱）。
- **E-j**（审计/终态与状态同生共死，R4-4）`chmod 0o500 .specify/runs` + tmpdir 占位 ⟹ 断言**实际行为**：
  退出码序列（`2,2,0`）成立，且**终态记录条数 = 0、审计条数 = 0**——把「审计与状态不同路径、
  同时失效概率低」这条已被证伪的假设换成实测钉子；判定不因审计缺席而改变，进程不崩。
  🔴 **必须带 root skip 守卫**（R5-8）：root 下 `chmod 0o500` 不产生写失败，用例会**静默失真**（假绿）。
  照抄 `plugins/spec-driver/tests/ledger-writer.test.mjs:251` 的写法——
  `it('…', { skip: process.getuid?.() === 0 ? 'root' : false }, …)`；并照该文件在 `finally` 里 `chmod 0o755` 复原。
- **E-m**（🔴 **窗口基线换向的直接回归钉**，R5-1）：一次会话内走完
  「存储坏 ⟹ 2 次 exit 2 ⟹ 第 3 次放行 ⟹ 修好存储 + 合规裁决 reset ⟹ **重新展开一次 `/spec-driver-fix`**
  ⟹ 再把存储弄坏」，断言**重展开后的第 1 次 Stop 仍 exit 2**（不因会话前半段已攒够 2 条反馈而秒放行）。
  存在理由：`blockCount` 可被合规 reset，而反馈计数是会话级、**不可 reset**；若基线仍取
  `earliestFixLineIndex`，付过 2 次往返的会话在重展开后会得到 **0 次往返**的放行（绕过面 C-1）。
  改用 `latestFixLineIndex` 后重展开即缩窗、计数归零。守 **M-11**。
- **E-n**（🔴 **误伤面：不可写但合规**，R5-9）：两级不可写（同 E-a 的占位手法）+ 会话**制品齐全合规** ⟹
  断言 **exit 0**、**stderr 为空**、**stderr 全文不含 token**。存在理由：fail-closed 方向反转后，
  最容易走样的实现是把「存储写不进」提到合规判定之前当作无条件阻断 ⟹ 合规用户被 brick（守 R-6）；
  且合规路径一旦渗漏 token，被判方即可用"合规一次"白攒一条反馈计数（同 E-c / E-e 的渗漏面）。
  同样带 **root skip 守卫**（写法同 E-j）。

**投喂面守卫与源码守卫**（`fix-compliance-judge-cli.test.mjs`，照既有 `:2918` 写法；E-p 用 `fs.readFileSync` 做字面量检查）
- **E-o**（🔴 **投喂面守卫**，R5-5；本轮按 R6-5 / R6-11 **整体重写**）：守护面不是「judge 自己的 stderr」，
  而是「**本周期所有阻断型 hook 的 stderr 合并体**」——harness 把它们一起回灌进同一条 user 条目。
  🔴 **措辞降级**：本用例不再自称「源码级合同」，实际钉的是 **运行时不变量 + 注册集核对** 两件事：
  - **(a) 注册集核对**（R6-5）：**解析 `plugins/spec-driver/hooks/hooks.json`** 取出全部
    `hooks[].hooks[].command` 的脚本路径集合，逐个断言源码中不含 `STORAGE_UNAVAILABLE_FEEDBACK_TOKEN` 字面量。
    🔴 **必须解析 hooks.json，不得用 `hooks/*.sh` glob**——已核实注册集里有
    `scripts/postinstall.sh`（SessionStart，**不在 `hooks/` 目录下**），glob **≠** 注册集；
    反过来 glob 也可能扫到未注册的孤儿脚本，两边都失真。
  - **(b) 运行时不变量**（R6-11）：**以 token 命名一个 `specs/` 子目录**（内含带未完成条目的 `tasks.md`），
    真跑 `bash plugins/spec-driver/hooks/stop-task-check.sh`，断言 **exit 0**（非 judge 的 Stop hook 不阻断）。
    🔴 **必须 `cwd` = 临时 fixture 根，且断言 stderr 含该目录名**（R7-2）：`stop-task-check.sh:8` 用的是
    **相对 glob** `specs/*/tasks.md`，在仓根或默认 cwd 下跑，token 目录**永不被扫到** ⟹ 断言恒绿
    （与 R6-11 同型的假绿）。写法固定为——fixture 布局 `<tmp>/specs/<token-name>/tasks.md`
    （`<token-name>` 即以 token 命名的目录），`spawnSync('bash', [<脚本绝对路径>], { cwd: <tmp> })`；
    **先断言 stderr 含该目录名**（证明它确实被扫到，否则整条用例无意义），**再**断言 exit 0。
  - 🔴 **登记边界，不追加防线（R7-3）**：Stop hook 的阻断形态除 exit 2 外，还有
    **stdout JSON `decision:"block"` + exit 0** 一路，(b) 只断退出码**抓不到**它。
    本仓 Stop hook 当前**未使用**该形态，故按已知边界**登记**；追加 stdout 解析属于为无现实威胁加防线，
    不做。若将来仓内出现 JSON 决策型 Stop hook，须回来补 (b) 的断言面。
  存在理由与**前稿守卫搭错面的更正**：`hooks/stop-task-check.sh:18` 会把 `specs/*/tasks.md` 的**目录名**
  回显到 stderr（`[提醒] 未完成任务: <NAME>(<n>)`），而目录名**由被判方选定**——它今天 `exit 0`（非阻断）故无害，
  但任何一次改成阻断型，被判方建一个叫 `[FIX-COMPLIANCE][STORAGE-UNAVAILABLE]` 的 specs 子目录即 0 成本投喂。
  🔴 前稿只钉「源码不含 token 字面量」，而该威胁下**源码永远不含 token**（token 来自被判方选的目录名，
  不是脚本里的字面量）⟹ 守卫**恒绿**、对自陈威胁零守护力（F278「防线可能照错方向搭」再现）。
  改法是把威胁的真正开关——「该 hook 是否阻断」——直接钉成 (b) 的运行时断言；
  (a) 保留是为了守住另一个正交面：**注册集内任何脚本都不得自己生产 token**。
- **E-p**（🔴 **errno 白名单撤回的回归钉**，R5-13 取代已删的 E-l）：断言
  `fix-compliance-judge.mjs` / `fix-compliance-core.mjs` / `fix-compliance-io.mjs` 三文件源码中
  **不出现 `ENOSPC` / `EDQUOT` / `EROFS` 任一字面量**（stderr 只渲染运行时取到的 `err.code`，
  正确实现无需硬编码任何 errno 名）。
  🔴 **必须先剔除注释行再做字面量检查**（R6-12）：把撤回理由写进 JSDoc / 行注释
  （如「`ENOSPC` 白名单已撤回，见 §9 第 3 条」）是**正当且被鼓励**的留痕，若不排除注释即**假红**，
  逼着实现期删掉解释性注释。剔除面按行处理：`//` 起头行、`/* … */` 块内行、`*` 起头的 JSDoc 续行。
  🔴 **守护力如实化（R6-12，登记而非修补）**：本用例只杀**三个具名码的抄回形态**，
  以下变体**不变红**——`'E' + 'ROFS'` 之类的拼接、按 `err.errno` 数值比较、
  以及改用 `EPERM` / `ELOOP` 等**本卡未列**的码（`ln -s a b; ln -s b a` 可带内造两级 `ELOOP`）。
  故 **M-8'** 的守护范围随之收窄（见 §6），**不得**把 E-p 说成"杀掉任意 errno 放行分支"。
  存在理由：原 E-l 用 `ln -s /` 造两级 `EROFS`，而该构造**依赖 macOS 密封系统卷（SSV）**——
  在 Linux CI 上得不到 `EROFS`，守护力**为零**（R5-13：与其留一条只在维护者本机成立的用例，
  不如把"不得再加 errno 放行分支"直接钉在源码面上，CI 恒执行、平台无关）。守 **M-8'**。

> 字母 **E-d**（420 兜底）随 R4-1 删除、**E-f**（errno 进 stderr）随 R4-10 并入 E-a 删除、
> **E-k**（errno 白名单三臂）随白名单撤回删除、**E-l**（`ln -s /` 两级 `EROFS`）随 R5-13 删除
> （其守护职责改由源码守卫 **E-p** 承担）；
> 剩余字母**不重排**，以免与前五轮对抗记录的交叉引用漂移。

**真实语料探针**（`plugins/spec-driver/tests/f270-real-corpus.test.mjs`，R4-3）
- **P-1 本轮删除**（🔴 R6-6，字母**不重排**）：原设计扫 `~/.claude/projects/**/*.jsonl` 做本机漂移侦测，
  三条否决理由：**(i) CI 上语料恒缺席 ⟹ 永远 skip**，零常绿守护力；**(ii)** 本机全量读约 **650MB**，
  为一条 skip 用例付这个代价不成比例；**(iii)** 谓词选中集为空时该用例**静默变绿**——
  正是"harness 换了形态"这一它本要侦测的场景下最先失效。P-2 的入库 fixture 接手的是
  **我方谓词对冻结快照的回归守护**——🔴 **不是**形态漂移的可发现性（R7-10）：
  **harness 形态漂移在本卡无自动可发现性，已接受为残余**；漂移只能由维护者在**下次录制**时人工发现，
  重录时点与判断依据记在 `handoff/README.md`，fixture 的 `version` 字段给出录制版本锚。
  一手实证（324 份 / 六个 harness 版本形态一致）改记在 **U-3** 注释里，不随用例一起消失。
  🔴 **移交登记**：「多 hook 同周期的反馈是否合并成 1 条」在本机语料中**仍无样本**（含 2+ hook 段的条目为 0），
  连同"何时该重新录制 fixture"一并**登记移交** `handoff/README.md`（调研指针，非本卡验收项）。
- **P-2**（🔴 **CI 恒执行的形态守卫**，R5-4）入库脱敏 fixture
  `plugins/spec-driver/tests/fixtures/fix-compliance/real-stop-hook-feedback-entries.jsonl`，**4 条真实条目**：
  ① 命中项（`type:'user'` + 单文本块 + 以 `Stop hook feedback:` 起头 + 含 token）、
  ② `tool_result` 型 user 条目（反伪造排除对象）、③ assistant 条目且正文含同串、
  🔴 **④ 真实 skill 展开条目**（`type:'user'`、单文本块、**首块以 `Base directory for this skill:` 起头**、
  正文里注入 token 与 `Stop hook feedback:` 串）——**R6-4 新增**。
  🔴 **④ 的骨架必须取「非 `spec-driver-*` 的真实 skill 展开」**（R7-4，如 `/skills/defuddle`）：
  `SKILL_EXPANSION_REGEX` 只匹配 `spec-driver-([a-z]+)`——含 `spec-driver-fix` 会推走 `latestFixLineIndex`
  （窗口自塌 ⟹ 假绿）、含其他 mode 会改 `anchor.mode`（⟹ 假红）；非 `spec-driver-*` 的展开两个基线都不动，
  是**唯一可写形态**。⚠️ 主编排器备料的第 4 条用的是 `spec-driver-fix` 展开，**落库前须换掉**。
  🔴 **④ 是「真实骨架 + 注入正文」，不是原样的真实条目**（R7-9）：骨架（envelope 字段、单文本块、
  `Base directory for this skill:` 前缀）取自真实录制，正文里的 token 与 `Stop hook feedback:` 串是
  **人工注入**的对抗构造。README 保留清单必须标注这一点，否则下次重录时注入正文会被当噪声删掉。
  断言 `countStorageUnavailableBlockFeedback(entries, -1)` 对该 fixture **命中 1 / 排除 3**。
  🔴 **④ 是 `startsWith` 条件在本探针下的唯一守护点**（R6-4）：①②③ 三条**都不经过 `startsWith` 判定**
  即被前置条件排除（② 非单文本块、③ 非 user 角色），故前稿的 P-2 对 `startsWith(HOOK_FEEDBACK_PREFIX)`
  **零守护力**——删掉该条件 fixture 仍是"命中 1"。加入 ④ 后，删条件即变成"命中 2"，用例才真的变红。
  🔴 **调用写死显式基线 `-1`**（R6-4）：这是**纯函数合同的另一半**——数字基线 ⟹ 计其后全部条目
  （fixture 里所有条目的 `lineIndex` 均 > -1，故窗口不参与本探针的判定，只留形态面）；
  `null / undefined / 非数字 ⟹ 0` 的那一半由 **U-7** 钉。**不得**在此传 `null` 图省事——那会让整条用例恒为 0 而假绿。
  脱敏字段（**替换值**）：`sessionId` / `uuid` / `parentUuid` / `promptId` / `cwd` / 一切绝对路径 /
  用户名 / `gitBranch` / 时间戳。
  🔴 **必须原样保留**（脱敏只改值内容不改值种类，沿用本目录既有约束）：`Stop hook feedback:` 前缀、
  `[<cmd>]: ` **段结构**（🔴 R6-7：该段内容本身是绝对路径，与"替换一切绝对路径"直接冲突 ⟹
  正确口径是**保留段结构、替换其中的路径值**，不是"原样保留整段"）、`Base directory for this skill:` 前缀（④）、
  `content` 的类型（字符串 vs 数组）、**块数**、harness `version` 字段——
  **前 5 项**正是计数器谓词（`textBlocks.length === 1 && startsWith(PREFIX) && includes(TOKEN)`）
  所依赖的形态面，一旦被脱敏抹平 P-2 就退化成自证；**第 6 项 `version`** 保留是为了下次形态漂移时
  能一眼看出这份 fixture 录自哪个 harness 版本（本机实测跨度 `2.1.219 → 2.1.247`，见 U-3）。
- **P-3**（脱敏完整性连带守卫，R5-4）照 `f270-real-corpus.test.mjs:112-118` 的既有写法，
  对 `real-stop-hook-feedback-entries.jsonl` 断言不残留真实用户名 / 真实 session_id / `/Users/` 绝对路径。
  🔴 **与 P-2 保留清单的相容性（R6-7）**：`[<cmd>]: ` 段里跟的**就是**一条绝对路径，
  若按前稿"原样保留该段"执行，P-3 必然与 P-2 互斥（一个要求留、一个要求删）。
  终版口径统一为「**保留段结构、替换路径值**」——`[<cmd>]: ` 这个字面前缀与其后有值的形态保留，
  路径值本身替换为脱敏占位。两条用例因此可同时为真；实现时若发现二者仍冲突，说明脱敏抹到了段结构，属实现缺陷。
- **README 索引**：在 `plugins/spec-driver/tests/fixtures/fix-compliance/README.md` 补 1 行
  （照该文件 §「F270 真实录制语料」的三列表格式：fixture / 采集事件 / 用途），并注明本 fixture 的
  「保留字段」清单——入库 fixture 无索引即孤儿，下一个维护者不知道哪些字段不许动。
  🔴 该清单须逐项写明是**保留值**还是**保留段结构、替换值**（R6-7），否则下一个维护者会在
  `[<cmd>]: ` 段上重演 P-2 与 P-3 互斥那次误解。
  🔴 清单须另标注 **④ 是「真实骨架 + 注入正文」**（R7-9）：其 envelope 与 `Base directory for this skill:`
  前缀取自真实录制、正文的 token 与 `Stop hook feedback:` 串是**人工注入的对抗构造**，
  **重录时不得当噪声删掉**；并注明骨架取自**非 `spec-driver-*` 的 skill**（R7-4，换成
  `spec-driver-*` 会让 P-2 假绿或假红）。
- `judge:doctor` 侧探针（判定器版本 vs 已安装快照漂移的自动发现）**不进本卡**，登记移交**卡 A**。

**牵连（既有合同钉必须改写，不是删）**
- `judge-cli.test:463` 「state-storage-unavailable → 降级放行」：**这条正是把 fail-open 钉成合同的那条**
  （5-Why 的 Why5a）。改写为「首次 exit 2 + token stderr」，并保留其审计断言。
  ⚠️ 该用例用**目录占位**造两级失败 ⟹ 主线程实跑得到 `stage:'write'` + `EISDIR`（R5-11）；
  但无论 errno 为何都落同一条 fail-closed 分支，改写方向成立——断言里**不得**新增任何 errno 值判定。
- `judge-cli.test:2277` 「存储不可用 → 不推迟」：承重断言「未推迟就不得发在途诊断码」**保留**；
  把 `stderr.startsWith('[FIX-COMPLIANCE][GATE-DEGRADED] ')` 改为 token 首行 + `status===2`。
- `judge-cli.test:3161` 注释称「tmpdir 不可注入故不在 CLI 级强造两级全失败」——**该陈述已被 :467-473 自证不成立**
  （`SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 可注入）；随 C3 删除该 describe 一并消失，新用例不得沿用此错误前提。

## 6. 变异清单（每条**点名**至少一条端到端用例变红，实跑记录）

| # | 变异 | 必须变红 |
|---|---|---|
| M-1 | `!saved.ok` 改回直接 `releaseDegraded`（还原缺陷） | **E-a**（第 1 次由 2 变 0） |
| M-2 | 计数器去掉 `role === 'user'` 条件 | **E-b**（assistant 侧伪造被计数 → 第 3 次由 2 变 0） |
| M-3 | `>= BLOCK_LIMIT` 改 `> BLOCK_LIMIT` | **E-a**（第 3 次不放行，由 0 变 2） |
| M-4 | 删 `startsWith(HOOK_FEEDBACK_PREFIX)` 条件 | **E-b′**（`type:'user'` 单文本块、首块以 `Base directory for this skill:` 起头、正文含 token ⟹ 不计数 ⟹ 第 3 次 Stop 仍 exit 2；`role` 无法先行排除，`startsWith` 是唯一守护点）+ P-2 ④ + U-3（主编排器订正：原点名 E-b 为 assistant 伪造，被 `role` 先行排除，抓不到本变异）。🔴 **诱饵形态是承重前提（R7-4）**：E-b′ 与 P-2 ④ 的诱饵**必须是非 `spec-driver-*` 的真实 skill 展开**（如 `/skills/defuddle`）——`SKILL_EXPANSION_REGEX` 只匹配 `spec-driver-([a-z]+)`：含 `spec-driver-fix` 会推走 `latestFixLineIndex` ⟹ 窗口自塌、删条件也照绿（**假绿**，本变异漏网）；含其他 mode 会改 `anchor.mode` ⟹ **假红**。诱饵选错即本行守护点全部失效 |
| M-6 | 计数器去掉 `lineIndex > baseline` | **E-i**（在 fix 展开**之前**注入 2 条历史反馈条目 → 首次 Stop 由 2 变 0） |
| M-7 | stderr 首行去掉 token（保留原因行） | **E-a**（下一次 Stop 数不到反馈 → 第 3 次由 0 变 2） |
| M-8' | 🔴 **降级措辞（R6-12）**：本条杀的是**「三具名码抄回形态」的 errno 放行分支**，**不是**"任意 errno 放行分支"——在 `routeStorageUnavailable` 前置一条「errno ∈ `{ENOSPC,EDQUOT,EROFS}` ⟹ `releaseDegraded`」（还原 R4-2 白名单；退化形态取「只对 `EROFS` 放行」），三码以**明文字面量**出现 | **E-p**（剔注释行后，三文件出现 `EROFS` 字面量即红）。⚠️ **E-a 抓不到**——目录占位实跑得 `write EISDIR`，不命中放行分支；⚠️ 原钉 **E-l 已删**（`ln -s /` → `EROFS` 依赖 macOS SSV，Linux CI 上守护为零，R5-13）；**E-p 是该变异当前唯一的守护点，平台无关、CI 恒执行**。🔴 **明确不覆盖的变体（登记，不追加防线）**：字符串拼接（`'E'+'ROFS'`）、按 `err.errno` 数值比较、以及改用 `EPERM` / `ELOOP` 等未列码——`ln -s a b; ln -s b a` 可带内造两级 `ELOOP`；本卡**无此分支**，故是"守护力有边界"而非"已知漏洞"，追加内容启发式检测即回到被判死的方向 |
| M-10 | 上界命中后不 push `storage-unavailable-block-budget-exhausted` | **E-a**（第 3 次审计事件缺该码）；登记面另由 **E-g** 的 schema 双向守卫（judge 源码须含该字面量）兜住 |
| M-11 | **窗口基线改回 `earliestFixLineIndex`**（还原 R5-1 前的取值） | **E-m**（合规 reset + 重展开 fix 后的第 1 次 Stop 由 2 变 0）。⚠️ **E-a / E-i 都抓不到**——两者都是单段会话，earliest 与 latest 取值相同；E-m 是该变异的**唯一**守护点 |
| M-12 | 基线缺席时 `return 0` 改回 `-1` 全量计数（照抄 `countAssistantEntriesSinceEarliestFixExpansion`） | **U-7**（三种非数字入参下由 0 变 10） |

## 7. 回归护栏表

| # | 不可回退的判据 | 本卡风险面 | 守护点 |
|---|---|---|---|
| R-6 | F208 **Stop hook 不可 brick 会话** | 方向反转后最坏路径必须仍收敛 | 上界可达性推演：**所有 `!saved.ok` 走同一条路——每段 fix 展开 2 次 Stop 往返后经反馈计数放行**（**E-a**；会话总量 = 2 × 段数 × compaction 次数，R6-1，误伤方向登记见 §8 ⑪）；**合规用户即便两级不可写也不被阻断**（**E-n**：exit 0 / stderr 空）；errno 不分叉由源码守卫 **E-p** 钉住。🔴 残余 1：该上界**依赖反馈条目形态存在**，形态漂移则该分支无上界——🔴 **该漂移无自动可发现性（R7-10）**：P-2 是冻结快照，只守我方谓词对该快照的回归，harness 换形态它照绿；**已接受为残余**，只能由维护者在**下次录制**时人工发现，重录时点见 `handoff/README.md`（**P-1 已随 R6-6 删除**，理由见 §5；本机形态实证改记在 **U-3** 注释）。**不得**写成「可发现性由 P-2 提供」。🔴 残余 2（**双故障**，F257 四要素登记见 §8 ①'）：存储与 transcript 回灌通道**同时**失效时计数器永不累加 ⟹ 阻断**可恢复但上界是用户动作而非计数**（修好存储 / 改 `fix_compliance.enforcement` / 重启带 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP`），stderr 已按生效即时性明示三条补救口 |
| R-7 | F211 补救清零（`resetBlockState` 删文件即全量清零） | 新计数器**不落盘**，reset 语义不受影响；「新增状态字段无需改 reset」的性质保持 | 既有 reset 用例不改仍绿 |
| R-11 | 总上界必须存在 | 本卡在此前**唯一没有上界**的分支上建立上界（原为直接放行） | **E-a**（唯一上界＝反馈计数，**每段** 2 次往返后放行）+ **E-m**（合规 reset + 重展开 fix 后**仍付满 2 次**，不留 0 次往返口子）。🔴 **精确口径（R5-2）**：本行钉的是「**`!saved.ok` 分支不再提供 0 次往返路径**」，**不是**「全局不存在 0 次往返路径」——预置状态文件的相邻向量属既有面、移交卡 B（§8 ⑩）。🔴 上界形态**不随 errno 分叉**——任何按 errno 提前放行的分支都会在此重开 0 次往返口子（M-8' 专杀，守护点 E-p） |
| R-12 | 诊断码闭集 enum ⊆ 产出 | 新增 **1 码**（`storage-unavailable-block-budget-exhausted`；`storage-unavailable-environmental-release` 随白名单撤回，**不登记不产出**） | **E-g** 双向守卫 + 换算式 27→28（推导见 §4 C2 第 5 条） |
| — | **存储可用时逐字节不变**（D7） | 全部既有退出码序列 / 审计事件 / 终态记录 | **E-c** 同窗口 A/B 对拍 + `npm run test:plugins` 全绿 |
| — | warn 档天然不经 `routeBlock` | warn 在 judge:1065 先行 `return 0`，**结构性**不受影响 | 既有 warn 用例（含 :2264）不改仍绿。🔴 这同时是 stderr 补救口 ② 成立的结构依据（`enforcement: warn\|off` 下一次 Stop 即生效） |
| — | **`nonBlockStopCount` 不得被当作放行预算**（R5-10） | C3 保留该字段但删掉唯一（零接线的）递增方 ⟹ 只剩"原样带回方"；卡 B 接线时若直接拿它当预算，即等于把预算放进被判方可写的状态文件里，复活 0 成本伪造 | C3 交接注释写死「只有带回方、无递增方；带回属不可删面；**不可单独作预算，除非同时定义不可伪造性**」；本卡 **E-h**（`p3-carry`）只钉"整体覆写不抹平"，**不**赋予该字段任何判定语义 |
| — | 反馈条目不得污染锚点/提名 | 已核实：`buildFeedbackText` 全文不含 `Base directory for this skill:`（`SKILL_EXPANSION_REGEX` 不命中）；其 `specs/NNN-fix-<name>/` 是字面 `NNN`，而 `ARTIFACT_PATH_REGEX` 要求 `\d+`（不命中）。🔴 新增文本面须**同样核到整条 stderr**，不止 `buildFeedbackText`——第 4 轮引入的 errno 行、第 5 轮引入的 `stage` 段与 ①②③ 三条补救行，以及**第 7 轮引入的两个新文本面**：`@ <err.path>` 渲染出的**真实路径**（R7-7）与 ② 的**两行字面量** `fix_compliance:` / `  enforcement: warn`（R7-6，取代前稿的点号式）——两者都须与 `SKILL_EXPANSION_REGEX` / `ARTIFACT_PATH_REGEX` 逐条核对 | 新增断言：注入反馈条目后 `--mode report` 的 `fixSession` 与锚点派生量不变 |

## 8. 风险登记（F257 四要素：形态 / 方向 / 可自愈 / 上界）

| # | 形态 | 方向 | 可自愈 | 上界 |
|---|---|---|---|---|
| ① | **任何 `!saved.ok`**（含诚实 `ENOSPC` 磁盘满 / `EROFS` 只读挂载 / `EDQUOT` 配额，也含 `EACCES` / `EISDIR` / `EEXIST` / `ENOTDIR`）用户被阻断——**不再按 errno 分流**（白名单已被 `ln -s /` → `EROFS` 击穿，§9 第 3 条） | fail-closed | ✅ **三条补救口按生效即时性**（R5-3，与 stderr 同序）：① 修好路径（`chmod u+w` / 释放磁盘 / 清占位）→ 下一次 Stop 立即生效；② 由用户在配置文件写入 `fix_compliance:` 与其下缩进两空格的 `enforcement: warn`（两行字面量，R7-6） → 配置每次 Stop 重读，下一次 Stop 生效；③ `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<dir> claude` → **须重启会话**（hook 进程 env 取自 CC 启动快照，会话内 `export` 到不了，与 ⑧ 同一事实）。🔴 ① 的动作按运行时 `<stage> <code> @ <err.path>` 渲染，**静态映射只保留两条**（R7-1，与 §4 C2 第 4 条同步）：`EEXIST\|ENOTDIR` ⟹ 删除上行 `@` 后**那一个**文件（**勿删 `.specify/runs` 目录**，R7-7）、`EACCES` ⟹ `chmod u+w` 父目录；**其余 code 一律「请向用户报告该错误码」**。🔴 **模板不得出现 `ENOSPC` 明文**——那与源码守卫 **E-p** 互斥（正确实现必红 ⟹ 逼实现者削弱 E-p ⟹ M-8' 失守）；`code` 是运行时打印值，不是模板字面量。② 须写全文件名与嵌套、且为**两行字面量**（R6-2 / R7-6），措辞取**用户动作**式（R7-5） | 🔴 **每段 fix 展开 2 次 Stop 往返**后经反馈计数放行；会话总量 = **2 × fix 展开段数（× compaction 次数）**，**不是**全局常数 2（R6-1；前稿"所有存储故障用户经历相同的 2 次往返"已被自证不实）。＝所有人地板，**无 errno 例外路径** |
| ①' | **双故障**：存储不可用 **且** transcript 回灌通道同失效（如同一磁盘写满 ⟹ harness 写不进反馈条目）⟹ 计数器永不累加、闸门 1 永不命中 | fail-closed | ✅ 补救口同 ①（①② 下一次 Stop 生效、③ 须重启）（**可恢复的阻断**，非 brick） | 🔴 **上界是用户动作而非计数**——本形态下计数上界不可达，如实登记为残余，不追加防线（追加即回到被击穿的 errno 分流方向） |
| ③ | **用户把含 token 的反馈原文粘回对话**（R5-12 改写：前稿只当"自伤/无害"，低估了它确实能命中谓词） | 自伤（可能提前放行） | ✅ | 🔴 **两路结论并列登记**：**(a) 理论上**——若粘贴物整条 envelope 为 `type:'user'`、单文本块、且首块以 `Stop hook feedback:` 起头，则**命中谓词**，至多 2 条即跳过整个地板（不是前稿说的"至多提前 1 次"）。**(b) 绕过面实测**——Claude Code UI 的粘贴物以 `[FIX-COMPLIANCE]` 起头、**无 `Stop hook feedback:` 包装** ⟹ 通常不命中；要凑齐 `startsWith` 只能改 transcript 文件（即退化为 ⑤）。**裁决：已接受，不加防线**——加防线要么误伤真实回灌条目，要么落回内容启发式；且方向是用户自伤（用户主动粘贴导致自己少受一次阻断），对被判方无独立收益 |
| ④ | 存储不可用时审计与终态**必然同时缺席**：`.specify/runs/` 是状态目录 `.specify/runs/.fix-compliance-state` 的**父目录**，`appendAuditEvent`（月度审计文件）与 `recordWorkflowRun`（终态记录）都写在它下面 | 可观测性缺失，不改裁决 | ⚠️ 不自愈（该次事件永久丢失） | 🔴 **更正**：前稿「与状态目录不同路径、同时失效概率低」是**事实错误**——三者同生共死。诚实故障（父目录不可写）下审计条数 = 终态条数 = 0；try/catch 兜底不崩、判定不变。**E-j 实测钉**（不是概率推演） |
| ⑤ | transcript 文件篡改（直接改 jsonl 伪造 user 反馈条目） | 绕过 | — | **已接受下界**（与 F270 D-1 同源），只登记指针，不重复论证 |
| ⑥ | 存储先坏后好：坏时 2 次阻断 + 好后 `blockCount` 从 0 起 → 单会话最坏 4 次 Stop 往返 | fail-closed | ✅ | **4 次**，仍有界；不引入新常量修正（属过度设计） |
| ⑦ | **compaction / transcript 换文件** ⟹ 计数器归零（存储仍坏则重吃 2 次）；若 fix skill 展开痕迹未随迁则 `isFix=false`、判定器整体失效 | **双向**（前者 fail-closed、后者 fail-open） | ❌ 不自愈 | **每次 compact 重置**——上界不是全局常数而是「2 × compact 次数」。不新增跨文件状态修正（那要引入本卡明确不做的持久化面） |
| ⑧ | **自注册 Stop hook 投喂计数器**（含"多 hook 同周期是否合并成 1 条反馈"这一**无样本**未知，R5-7 并入本行） | 绕过 | — | 成本 = **重启 + N 次 Stop 往返**（hook 配置启动快照，会话中途不生效——与 ① 补救口 ③ 同一事实）；最坏地板取 **1 次往返**；仍高于已接受的 ⑤（0 成本），按残余登记、不追加防线。详见 `handoff/README.md`「⑧ 自注册 hook 投喂面」。🔴 **本轮删掉前稿的"由 E-a 同周期跑 2 次 CLI 补观测"**（R6-8）：harness 不在该环内，CLI 连调两次对"是否合并成 1 条"**零信息量**，留着等于把未知伪装成已观测；正确取证需**真实双注册运行**，本机语料中含 2+ hook 段的条目为 **0**，**仍无样本**，整体移交 handoff。守卫侧由 **E-o** 承担（注册集核对 + 非 judge 的 Stop hook 恒 exit 0 的运行时不变量，R6-5/R6-11） | **实现期裁决（2026-09-03）**：成本依据改为「反馈条目只在真实 exit 2 时写入 ⟹ 每条投喂 = 一次自我阻断往返，热重载只改准备成本不改地板；预付会被新的 fix 展开作废」；「启动快照」不再作为成本论据（hook 配置可能被 watcher 热重载，未实跑证实）。 |
| ⑨ | **同段内的 reset 不对称**（R5-1 换基线后的剩余面）：在**同一段 fix 展开内**（无重展开）走「坏 ⟹ 2 次阻断 ⟹ 放行 ⟹ 修好存储 ⟹ 合规裁决 reset `blockCount` ⟹ 再把存储弄坏」，因反馈计数是会话级、窗口未重置 ⟹ 该段后续首个 Stop **0 次往返**放行 | 绕过 | ❌（会话级计数不可 reset，只随重展开或换会话归零） | 🔴 **上界＝每段 2 次往返**：窗口基线换成 `latestFixLineIndex` 后，被判方想清窗口只能**重展开 fix**，而重展开即缩窗、计数归零 ⟹ 再付 2 次（**E-m** 钉住）。🔴 **比较句按 R6-10 更正**（前稿"与诚实用户地板相同"是 over-claim）：正确口径是「**每段 2 次；段内回合数不设限，摊销成本随段长下降**」——存储可用者每次合规 reset 后都要重付 2 次，存储坏者付满 2 次后该段其余回合成本为 0 ⟹ 摊销为 2/N。上界数字（每段 2 次）不变，收益差别只体现在摊销面，仍不足以构成新绕过。🔴 **口径限定（R7-5）**：本行的「最短完全绕过 = 2」只限 **`!saved.ok` 机制面最短 = 2**，**不是**全局最短——配置面另有 **1 次往返**的既有路径（⑫），移交卡 B。🔴 **不加任何可擦的 reset 锚**：锚可擦 ⟹ 擦掉即计数变多 ⟹ **放行方向**，比现在更坏 |
| ⑩ | **既有相邻向量**（R5-2，**非本卡引入**）：被判方直接预置状态文件 `{"blockCount":2,"degradedRecorded":true}` ⟹ 0 次往返 + **零终态记录** | 绕过 | — | 🔴 **改动前就存在**（第 2 轮 I-B 表已列为既有 0 成本项），与 `!saved.ok` 分支**无关**——状态文件落在被判方写域。**不在卡 C 范围**（卡 C 只修 `!saved.ok`），显式**移交卡 B**（与状态文件完整性 / 锁 / 幂等同域）。本条的存在即是「不得再写"不存在 0 次往返路径"」这条措辞纪律的依据（§1 / §7 R-11） |
| ⑪ | 🔴 **诚实用户的重复代价**（R6-1 新增，**误伤方向**）：存储长期不可用的诚实用户，**每重新展开一次 `/spec-driver-fix` 就重付 2 次 Stop 往返**（窗口基线是 `latestFixLineIndex`，重展开即缩窗、计数归零）；叠加 ⑦ 的 compaction 重置 ⟹ 会话总代价 = **2 × fix 展开段数 × compaction 次数** | **误伤**（fail-closed 的代价面） | ✅ 三条补救口同 ①（① 修好路径 / ② 配置 `enforcement: warn` / ③ 重启带 env），任一生效后该段起不再重付 | 🔴 **本条与 ⑨ 分列、不得合并**（⑨ 是**绕过方向**、被判方主动利用；⑪ 是**误伤方向**、诚实用户被动承担），二者数值同源（每段 2 次）但方向相反，合并登记会掩盖其中一侧。**裁决：代价可接受**——每段起点是用户主动动作、每次阻断都带可执行 stderr 补救口，换来关闭 `!saved.ok` 的 0 次往返口；**不追加跨段记忆**（那要引入本卡明确不做的持久化面，且任何可擦的跨段锚都是放行方向，同 §9 第 8 条末条） |
| ⑫ | 🔴 **配置面 1 次往返（R7-5 新增，非本卡引入）**：stderr 补救口 ② 把「文件名 + 嵌套 + 生效时点」一次性告知**模型**（stderr 的主消费者），被判方读完**第 1 次**阻断即可自写 `fix_compliance:` / `  enforcement: warn`，第 2 次 Stop 在 warn 分支 `return 0` ⟹ **1 次往返** | 绕过 | — | 🔴 **机制既有、已公开文档化（`docs/configuration.md:61`）、落在被判方写域、与 `!saved.ok` 无关** ⟹ 同 ⑩ 判例**不在卡 C 修**，显式**移交卡 B**（与"被判方可写域内的门禁开关"同域）。本卡只做**措辞收口**：② 一律写成**用户动作**（「由用户决定是否…写入…」）而非对模型的操作指令——⚠️ 这只降低诱导性、**不构成防线**。🔴 因此 §1 / §8 ⑨ 的「最短完全绕过 = 2」必须限定为「**`!saved.ok` 机制面**最短 = 2」；删掉 ② 不是选项（它是 ① 之外**唯一**对诚实故障用户即时生效的补救口，删了即把 ⑪ 的误伤面变成无出口） |

> **编号说明**：原 ②「反馈形态缺席 → 退化为 420 兜底」随 R4-1 删除兜底而整体失效（该兜底可被
> 廉价工具调用**自泵**过阈，反而复活 0 次绕过）。其底层残余——**反馈形态漂移则该分支无上界**——
> 不消失，已并入 §7 的 R-6 守护点；🔴 **该漂移无自动可发现性（R7-10）**——§5 **P-2** 是冻结快照，
> 只守我方谓词对该快照的回归，**不侦测 harness 形态漂移**，已接受为残余
> （**P-1 已随 R6-6 删除**：CI 恒 skip / 本机 650MB 全量读 / 选中集为空时静默绿）；
> 其一手实证改记在 **U-3** 注释，「何时重录 fixture」与「多 hook 是否合并」一并移交 handoff。
> 编号**不重排**，以保持与五轮对抗记录的交叉引用（如 round4 引用「plan §8④」）。
> **①'** 是白名单撤回后浮现的双故障残余（原被白名单「顺手放行」而不可见），
> 取撇号后缀而非新数字，同样为不重排。
> **⑨ / ⑩** 为第 5 轮新增：⑨ 是换基线（earliest→latest）后的**剩余**面，⑩ 是**既有**相邻向量
> （本卡不引入、不修复、显式移交），二者性质不同，不得合并登记。
> **⑪** 为第 6 轮新增（R6-1）：它与 ⑨ **数值同源、方向相反**——⑨ 记绕过方、⑪ 记被误伤的诚实方，
> 分列是为了让"每段重付 2 次"这笔诚实代价在登记面上可见，**不得**因为数字相同就并进 ⑨。
> **⑫** 为第 7 轮新增（R7-5）：它是**配置面**（既有、被判方写域）而非 `!saved.ok` 机制面的绕过，
> 与 ⑩ 同判例、同去向（移交卡 B）；单列而不并进 ⑩ 是因为触发入口不同——⑩ 靠预置状态文件、
> ⑫ 靠**本卡新增的 stderr 补救口 ② 主动告知**，后者是本卡引入的**诱导性**（虽非新机制），须可见。

## 9. 关键实现决策（防止实现期走样）

1. **不新增阈值常量**：唯一上界复用 `BLOCK_LIMIT`（FR-006 同一预算）。新增常量只有 2 个**字符串**
   token（全非阈值）；R4-2 曾新增的 errno 集合常量**本轮撤回**（第 3 条）。🔴 **不再消费 `EARLIEST_FIX_ENTRY_DEFER_LIMIT`**（R4-1）：
   `assistantEntriesSinceEarliestFix` 只数 assistant 条目、**全在被判方产出面**，廉价工具调用即可把它
   推过 420 再占位目录 ⟹ 首次 Stop `feedbackCount=0` 但兜底已耗尽（析取）⟹ exit 0，**0 次绕过原样复活**；
   且本机 P95=392 已贴阈，每 ~34 个会话白送一次。这与 R2-10 判死 420 时是同一个错，不得再犯。
2. **token 单一来源**：定义在 core（stderr 生产方 judge 与消费方计数器 import 同一常量），
   杜绝「改了 stderr 忘改计数器」的静默失效。已核验 token 不是 `PREFIX_BLOCK/WARN/DEGRADED` 任一渲染串的子串
   （三者后接空格，token 后接 `[STORAGE-UNAVAILABLE]`），且计数用 `startsWith(前缀) && includes(token)` 双条件。
3. 🔴 **errno 不进判定**（本轮终裁，两次实证后收窄）：
   - **黑名单**（"这些 errno 是自诱发的 ⟹ fail-closed，其余放行"）**已被换手法击穿**（R2）：漏一个
     可诱发 errno（换手法造 `EPERM` / `ELOOP` / 新平台码）就直接送出 0 次绕过。
   - **白名单**（"两级皆 ∈ `{ENOSPC, EDQUOT, EROFS}` ⟹ 放行"）**已被 `ln -s /` 击穿**（R4，主线程实跑探针）：
     `ln -s / <tmp>/.fix-compliance-state` 后 `mkdirSync(recursive)` 成功、`writeFileSync` **跟随软链**
     写到 macOS 密封系统卷根目录 ⟹ 对任何用户返回 `EROFS`。被判方只需**两条 `ln -s /`**（primary 一条 +
     `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 指向的一条）即让两级同为 `EROFS` ⟹ 白名单放行 ⟹
     **0 成本绕过原样复活**。「环境性 errno 带内不可诱发」这条前提被证伪。
   - **因此本卡不再在该方向叠任何判据**：`!saved.ok` **一律 fail-closed**，上界只有一个——
     反馈条目计数 ≥ `BLOCK_LIMIT`；errno 只进 stderr 与审计，判定侧不读 `saved.errors`。
   - **E-p 是该撤回的回归钉**（源码守卫：judge / core / io 三文件不含 `ENOSPC` / `EDQUOT` / `EROFS`
     任一字面量），**M-8' 专杀"加回任意 errno 放行分支"这一变异**。
     🔴 原钉 **E-l 已于本轮删除**（R5-13）：它靠 `ln -s /` 造两级 `EROFS`，而该构造**依赖 macOS 密封系统卷**，
     在 Linux CI 上得不到 `EROFS` ⟹ 守护力为零；改成源码面守卫后平台无关、CI 恒执行。
     教训归档：F278「防线可能照错方向搭」在此再现一次——白名单的"失效方向是阻断"这个论证**只在
     errno 不可被被判方选择时成立**，而软链跟随让 errno 变成了**被判方可选的输入**。
4. **不改终态形态**：耗尽后仍走既有 `releaseDegraded`（`recordWorkflowRun` + `[GATE-DEGRADED]` stderr + 幂等语义），
   只多两个 trigger 码 —— contract 不变（明确不做之一）。
5. **errno 的唯一用途是 stderr 解释与审计可观测性**：任何按 errno 分流的判定——黑名单形态
   （`EISDIR` vs `EACCES` 走不同分支）与白名单形态（环境性 errno 放行）——**均已实测被击穿**，
   一律禁止。🔴 与 fix-report「errno 不进判定分支」的表述**本轮回归一致**（R4-2 的白名单更正已撤回）。
6. **性能**：计数器为独立单趟 O(entries)、零正则，与既有计数器同量级；🔴 绝不可为「统一」把它塞进
   `detectFixSkillExpansion` 再加一遍正则扫描（F257 第 3 轮实测：多扫一趟把最坏耗时翻倍，判定器跑在**同步** Stop hook 上）。
7. **`record-workflow-run.mjs:255`** 只在 `typeof blockCount === 'number'` 时保留该键——阻断分支的审计
   `blockCount: null` 不进终态记录，而放行走 `releaseDegraded`（传 `BLOCK_LIMIT` 数字），终态形态不变。
8. 🔴 **计数窗口基线取 `latestFixLineIndex`（方向论证，R5-1；实现期最易被"统一成 earliest"改错的一处）**：
   - **本计数器的方向**：窗口变窄 ⟹ 数到的反馈条目变少 ⟹ **更晚**放行 ⟹ **fail-closed**。
     被判方重新展开 fix 只会缩窗、把自己的计数清零，**只能给自己多招阻断**，没有收益。
   - **闸门三（在途推迟）用 `earliest` 是因为它的方向相反**：那里窗口变窄 ⟹ 计数变少 ⟹
     **推迟预算复活** ⟹ **fail-open**，所以必须钉在一次写定、不可被推前的最早锚上。
     🔴 **护栏 R-5「窗口不可被推前」只约束闸门三，不约束本计数器**——两者对"缩窗"的安全方向相反，
     **照抄 earliest 就是把防线搭反**（F278「防线可能照错方向搭」的同类）。
   - **与 reset 语义一致**：诚实的多 feature 会话每段都以一次新的 `/spec-driver-fix` 展开开头，
     `latest` 基线随之前移 ⟹ 窗口自然重置，和 `blockCount` 被合规裁决 reset 的节奏对齐；
     若用 `earliest`，`blockCount` 可 reset 而反馈计数不可 reset，两者不对称即产出 ⑨ 那条 0 往返路径。
   - **两个基线同源、零额外开销**：`detectFixSkillExpansion`（core:600-625）在**同一趟**里把
     `earliestFixLineIndex` / `latestFixLineIndex` 一次写定，取哪个都不多扫一遍。
   - 🔴 **不加任何可擦的 reset 锚**：可擦的锚一旦被擦 ⟹ 窗口变大 ⟹ 计数变多 ⟹ **放行方向**，
     比现状更坏。窗口只由"重展开 fix"这一个不可伪造的自伤动作推进。
   - 回归钉 **E-m**，变异 **M-11**；基线缺席方向另由 **U-7** / **M-12** 钉住（缺席取 `0` 而非 `-1`）。

## 10. 验证命令与时点

| 时点 | 命令 | 判据 |
|---|---|---|
| 每批收尾（承重） | `npm run test:plugins` | 零失败；判定器全部端到端在此 |
| 单点迭代 | `node --test plugins/spec-driver/tests/fix-compliance-{judge-cli,core,io}.test.mjs`（可加 `--test-name-pattern`） | 零失败 |
| C2 收尾 | 变异清单 **10 条**（M-1..M-4、M-6、M-7、M-8'、M-10、M-11、M-12）逐条实跑 | 每条**记录实际变红的用例名**，不写「任一用例」；M-8' 钉 **E-p**、M-11 钉 **E-m**、M-12 钉 **U-7** |
| 提交前 | `npx vitest run` | 零失败（本卡不改 `src/`，此项为回归网） |
| 提交前 | `npm run build` | 类型检查零错误 |
| 提交前 | `npm run repo:check` | 通过（未改 SKILL/生成链，`repo:sync` 预期无 diff；若有 diff 说明触到了受控生成链，须停下核实） |
| 发版相关 | `npm run release:check` | 通过（本卡不改 release contract，仅作回归） |
| 对抗审查 | 每 phase ≥2 独立子代理 × ≥2 切入角（**误伤面**：诚实存储故障用户被 brick；**绕过面**：伪造反馈条目 / 提前放行） | 循环至零新 CRITICAL；commit 标注「Codex 审查暂停，异构档位缺席」 |

🔴 **生效时点（F236）**：本机 `judge:doctor` 为 `drift`，Stop hook 跑的是已安装快照 4.4.0，
本卡改动**在本机 hook 上不会立即生效**，须等下次发版 + 插件缓存更新。
故**所有验收走 worktree 源码直调**（`node plugins/spec-driver/scripts/fix-compliance-judge.mjs
--mode hook --project-root <tmp 副本>`），不依赖本机 hook 行为；不得用「本机 Stop hook 表现」当证据。

## 11. 明确不做（原样承接 fix-report §卡 C）

- 病根 iii / 病根 v（锁）/ PENDING 语义 / snapshot-stale 专码 → 移交卡 A、卡 B
- **状态文件预置向量**（`{"blockCount":2,"degradedRecorded":true}` ⟹ 0 往返 + 零终态）→ **移交卡 B**（R5-2）。
  它是**改动前就存在的相邻向量**（状态文件在被判方写域，与 `!saved.ok` 无关），本卡只修 `!saved.ok`；
  与状态文件完整性 / 锁 / 幂等同属一域，拆开修必然重复设计。登记见 §2 矩阵与 §8 ⑩
- **errno 判定分支**（黑 / 白名单**两种形态均已实测被击穿**，一并不做）：黑名单（按 `EISDIR` vs
  `EACCES` 猜"是否自诱发"）可换手法造新 errno 绕过（R2）；白名单（两级皆 ∈ `{ENOSPC, EDQUOT, EROFS}`
  ⟹ 放行）可用两条 `ln -s /` 让两级同为 `EROFS` 绕过（R4 主线程实跑）。
  🔴 **本轮撤回上一轮的白名单更正**：errno **只进 stderr 解释与审计可观测性，不进任何判定分支**；
  `!saved.ok` 一律 fail-closed，上界只有反馈条目计数。论证见 §9 第 3 条，回归钉为 **E-p**
  （源码守卫；原 **E-l** 因依赖 macOS SSV、Linux CI 守护为零，已随 R5-13 删除）
- `state-storage-unavailable` 路径的**终态记录形态**改动 —— 放行仍走既有 `releaseDegraded` 终态
- F270 移交的另 5 项（FR-043/044、FR-010、FR-011、W-9、在途相关性过滤）保持移交
- `IN_FLIGHT_DEFER_LIMIT` / `EARLIEST_FIX_ENTRY_DEFER_LIMIT` 的**重标定**（420 距 P95=392 仅 7%，
  登记为后续卡输入）。🔴 R4-1 后本卡**既不复用也不改动** `EARLIEST_FIX_ENTRY_DEFER_LIMIT`——
  它在既有推迟分支的用法原样保留，本卡新分支完全不消费它
- 新计数量**不进 `--mode report` 输出**：report 不施加任何闸门，加它只扩测试面；卡 A/B 需要离线复核时再补
- 不建 `JUDGE_DIAGNOSTICS` canonical 表（G0，卡 A 范围）；本卡 **1 个**新码
  （`storage-unavailable-block-budget-exhausted`）按既有 `:2918` **逐码**双向守卫登记
  （🔴 R7-11 订正：前稿写"2 个新码"与 §4 C2 第 5 条的换算式、§7 R-12 及 E-g 均矛盾——
  `storage-unavailable-environmental-release` 随白名单撤回，**不登记不产出**）
