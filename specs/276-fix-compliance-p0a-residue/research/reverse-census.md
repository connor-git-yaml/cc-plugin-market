# 五量反向普查（F276 增量更新版 · plan 硬前置）

> 底版：`specs/270-compliance-evidence-ledger/research/reverse-census.md`（记录的是 **F270 改动前**的状态）。
> 本文件是**当前 HEAD `e01611b2` 的实况**，由独立 Explore 子代理穷举普查、主线程收口。
> 纪律：**护栏表禁止按卡面点名抄**（F270 集成审查元判断）——护栏来自本表的消费点，不来自卡面文字。
>
> 文件缩写：**judge** = `plugins/spec-driver/scripts/fix-compliance-judge.mjs`，**core** = `scripts/lib/fix-compliance-core.mjs`，
> **io** = `scripts/lib/fix-compliance-io.mjs`，**exec** = `scripts/lib/fix-compliance-execution-record.mjs`，
> **lr** = `scripts/lib/ledger-reader.mjs`，**lw** = `scripts/lib/ledger-writer.mjs`，**ifv** = `scripts/lib/in-flight-verdict.mjs`。

## 1. 锚点量（底版说「三个」，实况是**四个**）

产出全部集中在 `detectFixSkillExpansion`（core:596-623）单趟扫描：

| 行 | 量 | 语义 |
|---|---|---|
| core:613 | `earliestFixLineIndex` | **最早**一次 fix 展开行号（首次赋值后不再变） |
| core:614 | `latestFixLineIndex` | **最晚**一次 fix 展开行号（每次 fix 展开覆写） |
| core:615 | `latestFixTimestamp` | 最晚 fix 展开的时间戳（F270 P4 新增，**账本窗口对齐专用**） |
| core:619 | `anchorLineIndex` | 最晚**任意** spec-driver 展开行号（历史主锚点，语义逐字保留） |

### 1a. `anchorLineIndex` —— **生产侧零消费**（底版第 1 节整表作废）

底版记的 5 个窗口消费点已**全部切至 `latestFixLineIndex`**。当前 `anchor.anchorLineIndex` 在 judge 与全部 lib 生产码中**零求值**，只剩：
core:619 产出 / 5 个窗口函数的**形参名**仍叫 `anchorLineIndex`（core:658-663、core:823-828、core:1038-1044、core:1364-1369、exec:220-225）/ 若干注释。
⚠️ 测试侧仍大量把 `anchorLineIndex` 当窗口实参喂进去（core.test:165/172/183/…/1608）——那是**测试自造**的调用形态，与生产实参已不同。

### 1b. `latestFixLineIndex` —— 5+1 个窗口下界

| judge 行 | 接收函数 | 用途 |
|---|---|---|
| :310 | `resolveFeatureDirCandidate` | 锚点后特性目录提名（core:1369 过滤） |
| :449 | `collectArtifactWriteWitnessDirs` | F256 磁盘重锚定的写入见证（core:1044 过滤，**红队命门**） |
| :489 | `extractDelegationsAfter` | 锚点后委派计数（判据主输入，core:663 过滤） |
| :515 | `extractExecutionRecordsAfter` | F216 no-op 执行证据（仅 `closure.hasNoopAnchor`，exec:225 过滤） |
| :572 | `extractInFlightDelegationsAfter` | transcript 派生在途（core:828 过滤） |
| :491 | `readLedgerDelegations({ sinceTs: anchor.latestFixTimestamp })` | **第 6 个窗口**：走 timestamp 而非 lineIndex |

### 1c. `earliestFixLineIndex` —— 两处，均**方向相反**于上表

| 行 | 用途 |
|---|---|
| judge:268 | **isFix 判定改为存在性**：`anchor.earliestFixLineIndex !== null`（F270 病根 iv 修复） |
| judge:303 → core:1119-1121 | 闸门三计量源 `countAssistantEntriesSinceEarliestFixExpansion` |

core:49/564/568/575/1101-1116、judge:135/296/424 三处红字：两基线方向相反、**绝不可合并**。

## 2. `blockCount` / `BLOCK_LIMIT` —— 消费面从底版 ≈9 扩到 ≈26

产出：io:299/302（`normalizeState`）、io:328（`loadBlockState` 契约）、io:368（`saveBlockState` payload）。

| 类别 | 位置 |
|---|---|
| **唯一 `BLOCK_LIMIT` 比较点** | judge:641 `if (count < BLOCK_LIMIT)` |
| 写入 | judge:645（N+1）、judge:695/722（`releaseDegraded` 幂等标记 = BLOCK_LIMIT）、judge:773（routeNonBlock 原样带回）、judge:1039（推迟原样带回） |
| 审计取值 | judge:622（**仅 `enforcement==='block'` 写数值，否则 null**）、:654（阻断 = nextCount）、:729（降级）、:797/805/817（routeNonBlock 恒 null）、:869（defer 终态 null）、:898（fail-open null）、:944（合规留痕 null）、:1049（推迟 null）、:1067（warn null） |
| 文案 | judge:706 `${BLOCK_LIMIT + 1} 次` |
| 下游 | judge:712 `recordWorkflowRun.complianceVerdict.blockCount`；record-workflow-run.mjs:118/255-256 |

## 3. `verificationReport` / `verification-report.md` —— 语义**逐字未变**，仅行号漂移

judge:504-506（读盘；`resolvedPath===null` 时给 `{exists:false,nonEmpty:false}`）→ judge:522（**只传两个布尔，不传 content**）→ core:1809-1810（**唯一判据**）。
core:877-881 `DEFERRABLE_MISSING_KEYS` 含 `verification-report.md`；core:388/407 文案；core:1411 目录反推正则。

🔴 **承重不对称仍在**：提名侧 `ARTIFACT_PATH_REGEX`(core:62) 收 `verification/verification-report.md`，
而**见证侧** `ANCHORED_ARTIFACT_PATH_REGEX`(core:903-934) 与 judge:379-380/410/418 **只查 fix-report.md**——加回见证侧即复活红队绕过链。
⚠️ **对本卡的直接约束**：PENDING 语义（FR-030/031）要读 verification-report.md 的**内容**，
而当前 judge:522 只传布尔。加 content 传参属**新增消费面**，须确认不触碰见证侧不对称。

## 4. `executionRecords`（F216）—— 语义未变，窗口源已切

exec:223-225 定义（只收 `name==='Bash'` 且 `lineIndex > anchor`）→ judge:514-516（**仅 `closure.hasNoopAnchor`**，实参已切 `latestFixLineIndex`）→ judge:524 → core:1823-1825 `classifyReproEvidence`（命令全文精确匹配）。core:26/1873-1874 转口再导出。

## 5. `saveBlockState().ok` —— 3 个检查点 + 1 个不检查，**方向不一致**

| 调用点 | 检查 | 失败方向 |
|---|---|---|
| judge:644-651 `routeBlock` N+1 | ✅ judge:652 | `releaseDegraded(storageUnavailable:true)` —— **fail-closed**（写不进=按已达上限） |
| judge:1038-1043 推迟 `inFlightDeferCount+1` | ✅ judge:1044 | push `state-storage-unavailable` → 落回正常裁决 —— **fail-closed** |
| judge:778 `routeNonBlock` | ✅ judge:780/782 | trigger `nonblock-storage-unavailable` → **exit 0 放行** —— **方向相反** |
| judge:721-724 `releaseDegraded` 幂等标记 | ❌ **不检查** | fire-and-forget（仅在 `!storageUnavailable` 时执行，judge:719） |

🔴 **对本卡的直接约束**：judge:780 目前因零接线不影响生产；**本卡一接线它就变成生产路径上的一条「写不进状态就放行」通道**，必须在 GATE_DESIGN 重审方向。

## 6. `nonBlockStopCount` / `routeNonBlock` / 两个 LIMIT —— **生产零接线**（本卡的处置对象）

- `routeNonBlock` 定义 judge:762 + export；**生产侧调用点零命中**（`runHook` judge:911-1075 全路径无调用）；仅 judge-cli.test:3136/3144/3151/3166/3224 六处测试直接 import。
- `nonBlockStopCount`：io:315-317/376-378 归一与写盘；judge:650/664+688/723/1042 四处「原样带回」**真正执行**；judge:769（唯一 `NON_BLOCK_LIMIT` 比较）/776（+1）/821（文案）**只在 routeNonBlock 内**，故运行时恒 0。
- `NON_BLOCK_LIMIT = BLOCK_LIMIT = 2`（judge:82，🔴 承重不变量 `>= BLOCK_LIMIT`）；`NON_BLOCK_ENTRY_LIMIT = 420`（judge:100）。
- `stop_hook_active === true` 只产出诊断码（judge:975），**不接 routeNonBlock、不计任何计数**；judge:962-971 明确登记「与 spec 必答③/FR-029 相反」。

## 7. `loadBlockState → 改 → saveBlockState` 的 RMW 序列（**全部 4 对**）

| # | load | save | 中间 IO | 备注 |
|---|---|---|---|---|
| 1 | judge:638 | judge:644 | 无 | `routeBlock` 未达上限 |
| 2 | judge:638 | judge:721 | **有**（judge:701 `recordWorkflowRun` 磁盘写） | **跨函数边界**：`routeBlock` load → `releaseDegraded` save，5 个字段靠参数手工透传（judge:649-650/663-664/673-674 → 684-690 → 722-723）。**窗口最宽、最脆** |
| 3 | judge:763 | judge:778 | 无 | `routeNonBlock`（零接线） |
| 4 | judge:1030 | judge:1038 | 无 | 推迟路径 |

无 load 的写：judge:934 `resetBlockState`（删除语义）。
io:355-358 JSDoc：整体覆写、**刻意不做**字段级合并，论据是「每条写入路径都恰好先 load 过一次」——该论断在**单进程内**成立，跨进程即丢更新（见 `baseline-reproduction.md` B-2）。

## 8. `inFlightDeferCount`

io:308-310/370-372 归一；judge:116 `IN_FLIGHT_DEFER_LIMIT = 3`（**非 export**）；
judge:1034 **唯一比较点**（闸门二）；judge:1041 +1；judge:1058 `delegation-in-flight-budget-exhausted`；
带回点 judge:649/663/673/684/722/775/1041。

🔴 **纪律不一致（新发现）**：`releaseDegraded` 解构时 `inFlightDeferCount = 0` **有默认值**（judge:684），
而 `nonBlockStopCount` **刻意无默认值**（judge:688，F238 教训：漏传要 fail-loud 而非静默归零）。
即：任一调用点漏传 `inFlightDeferCount`，推迟预算被**静默清零 = fail-open**，且无任何信号。

## 9. `payload` 被消费的**全部**字段

| 字段 | 消费点 | 语义 |
|---|---|---|
| `transcript_path` | judge:916 / 1123、io:45-51 | 读 transcript；类型校验 |
| `session_id` | judge:916/922/934/941/959/1124 | 账本分文件、状态文件、审计 |
| `stop_hook_active` | judge:975 | `=== true` → `stop-hook-reentry` 诊断码（**纯诊断**） |
| `background_tasks` | ifv:65-81（judge:1012 唯一入口） | 键存在性 + `Array.isArray` 三态 |
| **`last_assistant_message`** | **生产码零命中** | 仅 tests/f270-real-corpus.test.mjs 与两份 fixture 提及 |

其他 Stop 字段（`cwd` / `hook_event_name` / `session_crons` / `permission_mode`）生产码零消费。
项目根一律由 shell 薄壳 `--project-root "$(pwd)"` 提供（stop-fix-compliance-check.sh），**不走 payload**。

PostToolUse 侧（lw，独立通道）消费：`tool_use_id` / `tool_name` / `prompt_id` / `session_id` / `tool_response` / `agent_id`(`hasOwn`) / `agent_type` / `tool_input.subagent_type`。
hooks.json：Stop → stop-task-check.sh + stop-fix-compliance-check.sh（两条独立 matcher）；PostToolUse `Agent|Task` → post-tool-use-ledger.sh。

## 与底版的差异（只列变化项）

| # | 底版（F270 前） | 当前 HEAD | 性质 |
|---|---|---|---|
| 1 | `anchorLineIndex` 是 5 窗口下界 | 5 窗口全切 `latestFixLineIndex`；`anchorLineIndex` **生产零消费** | 底版第 1 节整表作废 |
| 2 | `latestFixLineIndex` 不存在 | 已实现（core:601/614/623） | 新增量 |
| 3 | `latestFixTimestamp` 未预见 | **第 4 个锚点量**，judge:491 唯一消费（账本 `sinceTs`） | 全新 |
| 4 | isFix = `anchor.mode==='fix'` | 改为存在性 `earliestFixLineIndex !== null`（judge:268） | 底版建议已落地 |
| 5 | `.ok` 检查 2 处 | 3 处，且新增的 judge:780 方向**与另两处相反**（放行） | 🔴 本卡承重 |
| 6 | RMW 序列未列 | 4 对；序列 2 跨函数 + 中间夹磁盘写 | 新增结论 |
| 7 | `nonBlockStopCount` 待设计 | 已实现但 `routeNonBlock` **生产零调用** | 本卡处置对象 |
| 8 | backstop 设想「存锚比 delta」 | **已撤销**，改单调量直接比常量（judge:770） | 设计反转 |
| 9 | 重入未提 | 只产诊断码，不接 routeNonBlock、不计数 | 与 FR-029 相反，已登记 |
| 10 | 账本未提 | lw/lr + `ledgerDiagnostics` + hooks.json `Agent\|Task` | 全新子系统 |
| 11 | 合规路径零落盘 | judge:938-953 合规也写审计（FR-024） | 新增落盘点 |
| 12 | 在途三态未提 | ifv 模块 + judge:1012-1022 | 新增 payload 消费 |
| 13 | `verificationReport` 4 点 | 语义逐字未变，行号漂移 | 纯漂移 |
| 14 | `executionRecords` 4 点 | 语义未变，**窗口实参改 `latestFixLineIndex`** | 行号 + 窗口源 |
| 15 | `blockCount` ≈9 点 | ≈26 点 | 消费面扩大 |

## 🔴 普查对本卡的四条硬约束（护栏表的真正来源）

1. **judge:780 方向反转**：接线 `routeNonBlock` 会把「状态写不进 ⇒ exit 0 放行」变成生产路径。必须在 GATE_DESIGN 重审——与 judge:652/1044 的 fail-closed 方向不一致，是接线引入的**新** fail-open 面。
2. **RMW 序列 2 是并发修复的最难点**：跨函数边界、中间夹磁盘写、5 字段手工透传。任何加锁方案必须覆盖它，不能只包 `saveBlockState` 单点（那样锁窗口在 load 之外，丢更新照旧）。
3. **`inFlightDeferCount` 默认值 0 是静默 fail-open**：与 `nonBlockStopCount` 的无默认值纪律相反。并发修复顺带统一（漏传 fail-loud）。
4. **PENDING 需要 verification-report.md 的 content**，而当前 judge:522 只传布尔。新增 content 消费面时须**不触碰**见证侧只查 fix-report.md 的不对称（core:903-934）。
