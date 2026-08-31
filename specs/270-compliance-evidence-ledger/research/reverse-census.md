# 五量反向普查（plan 硬前置，对抗审查元判断「护栏表按卡面抄=回归根因」的对策）

由 Explore 代理精确普查、主线程收口。文件缩写：**judge** = `plugins/spec-driver/scripts/fix-compliance-judge.mjs`，**core** = `lib/fix-compliance-core.mjs`，**io** = `lib/fix-compliance-io.mjs`，**exec** = `lib/fix-compliance-execution-record.mjs`。

## 1. `anchorLineIndex`（主锚点）—— 5 个窗口下界消费点

产出：core:580 init → **core:596** `detectFixSkillExpansion` 写 `anchorLineIndex: entry.lineIndex`（**最晚一次任意展开**的行号）。

| judge 行 | 接收函数 | 用途（均把它当窗口下界 `lineIndex > anchor`） |
|---|---|---|
| :239 | `resolveFeatureDirCandidate` | 锚点后特性目录提名（过滤 core:1414） |
| :376 | `collectArtifactWriteWitnessDirs` | F256 磁盘重锚定的写入见证目录（过滤 core:1044，**红队命门**） |
| :401 | `extractDelegationsAfter` | 锚点后委派计数（判据主输入，过滤 core:643） |
| :417 | `extractExecutionRecordsAfter` | F216 no-op 执行证据（仅 `hasNoopAnchor`，过滤 exec:244） |
| :470 | `extractInFlightDelegationsAfter` | 在途委派（推迟裁决输入，过滤 core:814） |

闸门三**刻意不用** `anchorLineIndex`，用 `earliestFixLineIndex`（judge:237 → core:1101）；judge:230-235 / core:981 / core:1082 三处注释强调两基线方向相反、**绝不可合并**。

## 2. `blockCount` —— ≈8-9 消费点

io:299/302（`normalizeState` 归一）、io:361（`saveBlockState` payload）、io:321（`loadBlockState`）、judge:536（`routeBlock` 读）、judge:538（`< BLOCK_LIMIT=2` 比较）、judge:540-542（N+1 写）、judge:519/549（`buildAuditEvent`，仅 `enforcement==='block'`）、judge:583/600/609（`releaseDegraded`）、judge:769（推迟路径原样带回）、judge:664/693/778/793（defer/warn/failopen 事件写 null）。

## 3. `verificationReport` / `verification-report.md` —— 4 消费点

judge:406-408（读盘 exists/nonEmpty）、judge:424（传参）、**core:1786-1787**（`judgeCompliance` 唯一判据 `if(!(exists&&nonEmpty)) missing.push`）、core:858（`DEFERRABLE_MISSING_KEYS` 列为可推迟）。
⚠️ 承重不对称：提名侧 `ARTIFACT_PATH_REGEX`(core:62) 收 verification-report.md，但**见证侧** `ANCHORED_ARTIFACT_PATH_REGEX`(core:903-911) 与 `usable()`(judge:262) **只查 fix-report.md**——把 verification-report.md 加回见证侧会复活红队绕过链。

## 4. `executionRecords`（F216）—— 4 消费点

exec:223（`extractExecutionRecordsAfter` 定义，收 `name==='Bash'` 且 `lineIndex>anchor`）、judge:416-418（仅 `hasNoopAnchor` 提取）、judge:426（传参）、core:1800-1802（`judgeCompliance` → `classifyReproEvidence`，需**命令全文精确匹配** `normalizeCommandConservative`）。

## 5. `saveBlockState().ok` —— 2 检查点（均 fail-closed）+ 1 不检查

io:357-378（定义，两级写皆败才 `ok:false`+`state-storage-unavailable`）、**judge:547**（`routeBlock`：`if(saved.ok)` 硬阻断 exit2，否则 judge:554-560「存储不可用=已达上限降级放行」）、**judge:773**（推迟路径：`if(saved.ok)` 推迟 exit0，否则 judge:783「计数写不进=没上界，照常裁决」）、judge:609（`releaseDegraded` 调用但**不检查 `.ok`**，幂等 fire-and-forget）。

## 6. 状态文件与 `normalizeState`（供 FR-046 `nonBlockStopCount` 设计）

`blockCount` 与 `inFlightDeferCount` **同住** BlockCountState 文件，均经 `normalizeState`(io:297) 归一、均由 `saveBlockState` **整体覆写**（io:349-352 注释：非字段级合并，调用方须原样带回）。`normalizeState` 当前归一全部字段：
- `sessionId`(io:301) / `blockCount`(io:299→302) / `degradedRecorded`(io:304) / `inFlightDeferCount`(io:308-310)
- 写盘另附 `updatedAt`(io:366)，但读取端不归一。

---

## 🔴 普查暴露的 plan 核心设计问题：「锚点」是**三个不同的量**

FR-022（病根 iv）说"锚点取最晚一次 **fix** 展开"，但普查显示当前只有**两个**锚点量，而需求实际需要**三个**：

| 量 | 当前实现 | 服务对象 | 本卡该怎么动 |
|---|---|---|---|
| **A. isFix 判定** | `anchor.mode === 'fix'`（judge:201，最晚任意展开的 mode） | 决定会话是否走 fix 判定 | 🔴 **改为存在性**：会话**曾出现过 fix 展开**即 isFix=true（病根 iv 修复；`earliestFixLineIndex !== null` 已是现成信号） |
| **B. 窗口下界 `anchorLineIndex`** | 最晚**任意**展开行号（core:596） | 5 个「锚点之后的 X」窗口 | 🔴 **必须改为「最晚一次 *fix* 展开」行号**（新增第三个量，暂名 `latestFixLineIndex`）。否则 fix 会话尾部一个 doc 展开会把 `anchorLineIndex` 推到 doc 行 → **5 个窗口把 fix 的委派/见证证据全切掉** → 大面积误阻断。这是 FR-022 真正的实现难点，不是改一行 `=== 'fix'` |
| **C. 闸门三基线 `earliestFixLineIndex`** | 最早一次 fix 展开（core:593） | 闸门三单调上界 | ✅ **保持不变**（FR-025 撤销的正是"别动这个"） |

**结论**：`detectFixSkillExpansion` 需在**同一趟**里产出**三个**量（A 的存在性由 `earliestFixLineIndex !== null` 承担、B 新增 `latestFixLineIndex`、C 保持 `earliestFixLineIndex`）。core:1082 的红字警告「不得改 `detectFixSkillExpansion` 主锚点语义，会牵动 F216/F227/F224 全链」正是指 B——所以 B 不是"改 `anchorLineIndex` 语义"，而是**新增一个平行量 `latestFixLineIndex` 并把 5 个窗口下界从 `anchorLineIndex` 切换到它**，`anchorLineIndex` 本身（若还有其他消费）保持不动或一并评估。

> ⚠️ **这条必须进 plan 的 TDD 红先行**：构造「fix 展开 → 委派 implement → 尾部 doc 展开」语料，断言委派证据仍在窗口内（当前实现会漏，改后应命中）。这是病根 iv 修复的**真正验收点**，比"isFix 不翻转"更深一层。

## 7. 对 plan 的其余直接约束

- **FR-046 `nonBlockStopCount`**：加进 `normalizeState`（io:297）第 5 个字段 + `saveBlockState` 原样带回名单（judge 三处 save 调用点 :541/:609/:769 都要带上它）。**但** delta-2 的不可擦 backstop 要求它的耗尽判据挂 `earliestFixLineIndex` 派生的单调量——即 `nonBlockStopCount` 存磁盘用于快路径，真正的放行闸挂 transcript 派生量（与闸门三同构），双写但以不可擦量为准。
- **五量里 `saveBlockState().ok` 的两个 fail-closed 检查点（:547/:773）** 在引入 `nonBlockStopCount` 后要重新审：新计时器的 save 失败也要走同样的 fail-closed（写不进=按已达上限，别给额外放行）。
- **见证侧 vs 提名侧正则不对称**（core:62 vs core:903-911）是既有承重设计，本卡 D-1 不迁见证到账本，故**不碰**——但 tasks 要有一条守卫测试确认没被误动。
