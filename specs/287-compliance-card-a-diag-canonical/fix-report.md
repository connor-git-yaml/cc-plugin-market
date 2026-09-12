# F287 · P0-A 残余卡 A：judge 诊断码 canonical 表 + userFacing 可见面 / PENDING 纯可观测量 / snapshot 三态专码 / 入口守卫收敛

> 模式：spec-driver-fix（主线程实施 + 异构对抗复审 ≥2 切入角 + verify 子代理）。**门禁类改动**（`fix-compliance-*` 判定器链）：
> Codex 配额暂停期走异构对抗档位，commit 显式标注「Codex 审查暂停，异构档位缺席」。
> 输入：`specs/276-fix-compliance-p0a-residue/handoff/`（README 裁决 #4/#5 + `plan-pre-split-design-capital.md` G0 / G3 / G4 段）+ M10 §12.2 W-1（K-1）。

## 1. 问题与证据

| 组 | 现状（改动前，行号按 7615c82a） | 证据 |
|---|---|---|
| G0 | judge 自身产出 16 处诊断码全是**散落字面量**（`'transcript-empty'` … `'internal-error'`），无 canonical 表；`buildFeedbackText` 把传入的 diagnostics **全部**渲染进用户 stderr——任何新码不加区分就进用户面 | `rg "'(transcript-\|state-\|delegation-in-flight\|…)'" fix-compliance-judge.mjs` 16 命中；F276 R2-7 / 第 3 轮 W-4 |
| G3 | 长等待（等用户拍板 / 等审查子代理 / 真人复测）没有成文惯例（F269 现场发明 `PENDING-user`）；判定器对 verification-report 只看 `{exists, nonEmpty}`，未回填项**不可观测** | `judge.mjs:495` 只传两个布尔；190 份真实报告实测 27 份含 PENDING 类标记 |
| G4 | Stop payload 的 `last_assistant_message` 在 `plugins/spec-driver/scripts/` **零消费**（B-4 对照组）；病根 i「主 transcript 懒刷盘」的缺席 / 陈旧在审计流里不可区分 | `rg last_assistant_message plugins/spec-driver/scripts/` 0 命中；F262 实证刷盘滞后 25+ 分钟 |
| K-1 | 入口守卫手写 `fileURLToPath(import.meta.url) === realpathSync(process.argv[1])`，单侧 realpath **无 try**：argv[1] 解析失败即抛（顶层无兜底 → 脚本异常退出），与仓内其它 20+ 入口守卫形态不一（memory「F247 全仓唯一守卫实现」与实况不符） | `judge.mjs:1228`；M10 §12.2 R1 |

**根因（5-Why 收敛）**：F208 → F276 九轮对抗把判据写进了判定器，但**诊断码从未有过 canonical 事实源**（R-12 护栏在 judge 侧不成立），于是每加一个码就多一个漂移面、多一条直通用户 stderr 的噪声通道；PENDING / 快照两个纯可观测量因此一直"没地方登记"而搁置。

## 2. 修复（按设计资本 G0 / G3 / G4 + K-1；范围裁决见 §5）

### G0 · canonical 表 + 可见面白名单（零裁决变更）
- `fix-compliance-judge.mjs` 新增 `JUDGE_DIAGNOSTICS = Object.freeze({ key: {code, userFacing} })`（13 项：11 既有 + 2 新码），**所有产出点改引用 `JUDGE_DIAGNOSTICS.<key>.code`**，judge 源码表外零裸字面量、零模板串。
- 表边界：只收 judge 首发的码。`state-storage-unavailable` 由 io 首发 → io 新增 `STATE_STORAGE_DIAGNOSTICS`，judge 三处复用改引用（不重复登记）；`verification-report-pending` 由 core 首发 → core 新增 `ARTIFACT_DIAGNOSTICS`；ledger / in-flight / dialect 表原样。
- `userFacing` 列按**改动前实际可达 `buildFeedbackText` 与否**如实标注：既有可见 6 码（stop-hook-reentry / delegation-in-flight ×3 / storage-unavailable-block-budget-exhausted / state-storage-unavailable）为 true，其余为 false。
- `USER_FACING_DIAGNOSTIC_CODES` = judge 表 true 项 ∪ io `state-storage-unavailable` ∪ ledger 4 码 ∪ `in-flight-undetermined`（第 3 轮裁决 #4：白名单必须覆盖 judge/io/core/ledger 并集里**改动前可见**的全部码；共 11 个，T0-U5 逐条点名）。`buildFeedbackText` 唯一渲染点按它过滤，全部被过滤时不留空「诊断:」行。
- 可见面**差集 = 仅本卡 3 个新码**（全部不可见）；退出码 / 三计数器 / compliant / stderr 前缀逐字不变（F240 I2 钉死基线五列不变，只有 diagnostics 列多了 G4 的缺席码——见 §3）。

### G3 · PENDING 纯可观测量（FR-032；不改判）
- (a) `skills/spec-driver-fix/SKILL.md` Phase 4 新增「长等待时的验证报告落盘惯例」：先落盘 → 未完项标 `PENDING` 并写明回填触发条件 → 触发后回填。措辞边界：明写判定器**不校验**回填条件（FR-031 已裁剪）。`npm run repo:sync` 再生 `skills-codex/` 与 `.codex/skills/` 副本 + `Source SHA256`。
- (b) `judge.mjs` 增传 `verificationReport.content`；core 新增 `PENDING_MARK_REGEX`（`\bPENDING\b | (?<!等)待用户 | 待回填 | \bDEFERRED\b | ⏸(️)?`——R2-13 的 `(?<!等)` 收窄 + 第 3 轮裁决 #5 **撤回**「同行含 ✅ 不计」、保留 `⏸` 裸形态）与 `countPendingSections(content)`（计数单位 = **节**，标题行不计）；`judgeCompliance` 输出 `pendingSectionCount`（报告缺席 null）并在 >0 时把 `verification-report-pending` 追加进 verdict.diagnostics；`buildAuditEvent` 落 `pendingSectionCount`；schema 新增该属性 + 新码入 enum。**不进 missing、不进 DEFERRABLE_MISSING_KEYS**（T3-U2 / T3-U4 逐字节钉）。
- 判据评估改用**人工真值集 + precision/recall 双报**（裁决 #5 取代恒真的「零翻转」）：`verification/pending-truth-set.md` + 重算器 `pending-truth-recompute.mjs`。187 份真实报告命中 15 份 / 34 节；严格口径 P=0.794 / R≤0.643，宽口径 P=0.971 / R≤0.660（召回上界；缺口主体是未打标记的延期项——正是 (a) 成文的目的）。

### G4 · snapshot 三态专码（FR-033；纯诊断码，不进任何预算桶）
- core 新增 `buildAssistantTextSet(entries)`（每条 assistant 归一化条目的 `textBlocks.join('\n').trim()` 集合）与 `classifySnapshotMessage(msg, set)` 三态（absent / fresh / stale，两侧 trim，**集合归属**而非裸子串 / 尾部相等）。
- judge：`evaluate(…, snapshotInput)` 在 entries 解析后算 `snapshotDiagnostics`；hook 模式传 `payload.last_assistant_message`，report 模式传 null 不校验；两码只走审计通道——经 `judgeCompliance` 透传的 `diagnostics`（verdict.diagnostics）与 `feature-dir-unresolvable` fail-open 早退的落盘——**绝不进 `deferExtraDiagnostics`**（`rg "deferExtraDiagnostics.*snapshot" judge.mjs` 零命中，T4-E5 源码钉），再加 G0 白名单第二道闸。命名与 F236 `judge-snapshot-*` 同名不同物，JSDoc 显式区分。
- 诚实登记：该量度量的是 **harness 刷盘行为**，不是病根 i 残余误伤率；SC 只写"缺席与陈旧在审计流中可区分"。

### K-1 · 入口守卫收敛
- `judge.mjs` 末尾改 `if (isInvokedDirectly(import.meta.url))`（F246 共享实现：两侧 realpath + 失败回退 resolve + search/hash 副本短路），删 `realpathSync` / `fileURLToPath` 手写比对。该 lib 自 F246 起已经在 `JUDGE_FILE_SET` 闭包（经 record-workflow-run），闭包**不扩张**（首稿误加一条重复登记，被 `judge-snapshot-core` 常量钉与 doctor `--since` 三条用例当场抓回——守卫有牙）。

## 3. 红先行 / 守护

- 新增 `tests/fix-compliance-card-a-diagnostics.test.mjs`（20 用例：G0 T0-U1..U5 + T0-E2；G3 T3-U1..U4 + T3-E2/E3；G4 T4-U1/U2 + T4-E1..E6；K-1 ×2）——实现缺失时 import 失败即红（首轮 SyntaxError 红 → 实现后 3 红：K-1 注释含被禁字面量 / G4 集合构造读的是原始 JSON 形态而判定器给的是**归一化条目** / T4-E6 语料没走到 fail-open 早退——三处修后 16/16 绿）。
- 既有 `F240 I2 钉死基线`：五列逐字不变，diagnostics 列按 G4 语义更新（注释登记为零裁决变更证明）；`judge-file-set-guard` / `JUDGE_FILE_SET 常量` / `doctor --since` 三组守卫在首稿重复登记闭包时全部变红，撤回后绿。
- 变异清单（对抗复审 / verify 执行）：M0-a 加未登记码 → T0-U2；M0-b schema 删仍产出的码 → T0-U2；M0-c 产出点改回裸字面量 → T0-U3/U4；**M0-d 过滤器恒真 → T0-E2 + T4-E5（stderr 出现快照码）**；M3-a PENDING 转 missing 键 → T3-U2/U4 + T3-E3；M3-b pendingSectionCount 参与判定 → T3-E3；M3-c 词法退回 `待用户` → T3-U1（等待用户 计入）；M4-a 判据改裸子串 → T4-U1；M4-a′ 删 judge 侧调用点 → T4-E3；M4-b 快照码计入 nonBlockStopCount → T4-E4；M4-c 两码推进 deferExtraDiagnostics → T4-E5。

## 4. 影响范围与边界

- 消费方：审计事件多一个可选属性 `pendingSectionCount` 与 3 个 enum 码；`record-workflow-run.mjs` 只消费 `blockCount`，不受影响；用户 stderr 可见面**零变化**。
- 不做（承接 handoff/README「明确不做」+ 卡 A 范围）：G1 锁 / G2 指纹路由（卡 B）；抬 `IN_FLIGHT_DEFER_LIMIT`；FR-031 裸 PENDING 收紧；`AskUserQuestion` 权威信号；拆 `runHook`；改 hooks.json；触碰见证侧 `ANCHORED_ARTIFACT_PATH_REGEX` 不对称（R-8，T3-U3 钉）。
- T4-M1 触发率：**离线不可测**（本机无真实 Stop payload 录制；陈旧率取决于 harness 刷盘时机）。可测部分（360 份真实 transcript / 49328 条 / 648 MB）：末条是 assistant 仅 1/360（99.7% 不是，与设计 99.8% 一致）；末条 assistant 文本含换行 39/359 = 10.9%（裸子串会失败的形态，与 10.8% 一致）；多 text 块条目 0；payload = 末条文本时集合归属命中 359/359；集合构造 ≤ 1.5 ms/份。**信噪比未验证**，仅满足 FR-033 分码字面要求——禁止读作"残余误伤已可度量"。
- 生效时点（K-11）：本机 Stop hook 跑的是已安装快照，所有验收走 worktree 源码直调；"源码里修好了" ≠ "本机不再误伤"。

## 5. 审查档位

门禁类：主线程自审 + **异构对抗复审 ≥2 切入角**（fail-open / 可见面绕过 + 误伤面 / 合同漂移）+ verify 子代理；Codex 配额暂停期，commit 标注「Codex 审查暂停，异构档位缺席」。结论见 §7 与 `verification/`。

## 6. 工具使用反馈（Dogfooding）

- Spectra MCP：未用——改动面是 `.mjs` 插件脚本（图不覆盖 plugins/ 的调用链，且 `tsc` 对 .mjs 零覆盖），影响面靠 `rg` + `JUDGE_FILE_SET` 守卫。
- Spec Driver：主线程按 fix 骨架推进（用户要求本 session 内直接执行），未调用编排器 SKILL；G3(a) 顺手把 F269 惯例写进了 SKILL。无实质工具反馈，不落账。

## 7. 对抗复审处置（门禁类常设档位：两路异构，Codex 审查暂停、异构档位缺席）

### 7.1 绕过面 / fail-open / 可见面泄漏 / 合同漂移（1C / 5W / 9I）

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| C-1 | CRITICAL（**既有**，F208 起） | Stop payload 总字节 > 65536 ⇒ `readFileSync(0)` 在非阻塞管道上 EAGAIN ⇒ `payload-invalid` ⇒ exit 0；被判方把末条助手消息写长即零成本放行整门禁，留痕仅 sessionId=unknown | **已修**：`readStdinSync` 改 readSync 循环 + EAGAIN 有界等待；回归钉 C-1（真实 `printf \| node` 管道形态、100 KB payload）。主线程实证：HEAD 版同形态 exit 0 + `payload-invalid`，新版 exit 2 + `snapshot-stale` |
| W-1 | WARNING | verification-report ≥ 2^27 行 ⇒ 按行拆分撞 V8 上限 fatal ⇒ wrapper exit 0（HEAD 对同语料 exit 2）；fix-report.md 同类既有面 | **部分修**：`countPendingSections` 超 4M 字符返回 null（T3-U1b / T3-U2 钉，不改判）。fix-report.md 的既有同类面（`classifyClosureForm` 按行拆）**未修，登记 M11**：复现 `yes '' \| head -c 157286400 > fix-report.md` ⇒ SIGTRAP ⇒ wrapper exit 0；修法需先裁决「超限制品」应判什么，且 wrapper 对判定器崩溃兜 exit 0 是 FR-013 既定政策 |
| W-2 | WARNING | T0-U4 只认单引号且前缀表不全：双引号 / `'delegation-' + 'in-flight'` 拼接全绿 | **已修**：剥注释后抓三种引号 + 短前缀 |
| W-3 | WARNING | T0-U5 期望列表与实现同源派生 ledger 四码，上游加码静默进可见面 | **已修**：四码写死字面量 |
| W-4 | WARNING | M3-b / M3-c 只红单元用例：T3-E2/E3 语料恒不合规，PENDING 改判无可观测差 | **已修**：T3-E4 合规 + PENDING 端到端（exit 0 / compliant / count 1）；T3-E2 语料加「等待用户」散文 |
| W-5 | WARNING | `last_assistant_message: ''` 判 stale | **已修**：空串 / 纯空白归 absent（T4-U 钉） |
| I-1 | INFO | codex 方言 fail-open 早退丢快照码 | **已修**（T4-E7） |
| I-4 | INFO | io 五码裸字面量不在任何表；judge 与 io 对 `payload-invalid` 各持一份；schema description 措辞 over-claim | **部分修**：io 新增 `IO_DIAGNOSTICS`（T0-U2 六张表 ⊆ enum）；judge 表删 `payloadInvalid` 改引 io 表；schema enum 零产出码（`parse-timeout` / `nonblock-*`）保留，description 改写如实；enum → 产出点反向守卫仍未交付 |
| I-5 | INFO | `--mode report` stdout 多两字段 | **已修**：CLI 合同表补行 |
| I-6 | INFO | 快照集合在 isFix 前构建（19 MB 非 fix +25 ms） | **不改**：T4-E7 要求早退前已算好；代价可忽略 |
| I-7 | INFO | 纯空白报告 count 0 而 missing 含报告 | **已修**：`exists && nonEmpty` ⇒ null |
| I-2 / I-3 / I-8 | INFO | T0-E2 非端到端；源码正则守卫可被改名绕过；judge-cli 既有 `includes("'delegation-in-flight'")` 恒真 | **登记不改**：实质防线是白名单二道闸（M4-b/M0-d 仍红）；恒真守卫无害、T0-U3 已取代 |
| I-9 | INFO | 副本环境 F256 T007 红 | 非回归 |

### 7.2 误伤面 / 判据质量 / 竞态与性能 / 语义假话（0C / 4W / 10I）

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| W1 | WARNING | 未闭合围栏把后半篇整段吞成 0，与本文件 F228 R3-3 处置相反 | **已修**：`unclosedFrom` 反掩码（T3-U1b） |
| W2 | WARNING | 真值集 #9/#21/#22/#31 按 S 自己的排除规则应判 FP；召回面漏扫「遗留 / 未验证」类标题节（85 个非空） | **已改判 + 补 5 条 FN + 盲区披露**：S precision 0.794 → **0.676**，recall 上界 S 0.643 → **0.548** / B 0.660 → **0.600**；`[E2E_DEFERRED]` / 小写 `pending` 登记为已知 FN 形态 |
| W3 | WARNING | SKILL 把「报告存在且非空」写成放行充分条件 | **已修**：加「其余判据已满足的前提下」限定；`repo:sync` 重算 SHA |
| W4 | WARNING | 字段名 `pendingItemCount` 与「节数」打架；纯空白报告 0 而非 null；标题标记计 0 未登记 | **已修**：改名 `pendingSectionCount`（未发布字段，零迁移）；`exists && nonEmpty`；JSDoc / schema / 合同登记三义 null 与标题规则 |
| I1 | INFO | report 模式 stdout 新字段未进合同 | **已修** |
| I2 / I3 | INFO | 早退不一致 / 空串判 stale | **已修**（同 7.1 I-1 / W-5） |
| I4 | INFO | 表未闭合（io 裸码） | **部分修**（同 7.1 I-4） |
| I5 | INFO | M14（改名变量塞 defer）/ M18（parseError 等价变异）全绿 | **登记**：M14 属装饰性守卫，行为由白名单兜住；M18 等价变异无守护意义 |
| I6 | INFO | 词法边界：`等 待用户` / `期待用户` 计、`MANUAL_PENDING` / 全角不计、setext 标题不切节 | **登记为已知形态**，不扩词表（FR-031 已裁剪、词表越宽超计越多） |
| I7 | INFO | harness 2.1.258 反查：`last_assistant_message` 不截断、末条无 text 则键消失；`fresh` 语义是「∈ transcript 某处」非「已追平」 | **登记**：状态名 fresh 保留，JSDoc 已写明度量的是刷盘行为 |
| I8 / I9 / I10 | INFO | 性能无新竞态面 / 副本噪声 / 双写同步已核 | 无动作 |

### 7.3 移交 M11（本卡不修，带复现）

- fix-report.md ≥ 2^27 行 ⇒ `classifyClosureForm` 按行拆 fatal ⇒ wrapper exit 0（既有；与 W-1 同类）。
- wrapper 对判定器崩溃 / 非 0-2 退出兜成 exit 0 的政策面（FR-013）——崩溃域即放行域。
- schema enum → 产出点的反向守卫；`parse-timeout` / `nonblock-*` 零产出登记。
- `--alt` 重算器分节不做 fence mask、跳过含标记文件（真值集工具面）。

### 7.4 verify 子代理复核回写（PASS）

- WARNING：重算器只扫 `specs/<数字>-*/`，漏 `170a~170e` 与嵌套目录共 6 份报告（3 份含 PENDING 共 6 节）→ **已修**：递归扫描；真值集重算为 196 份 / 19 命中 / 42 节，S precision 0.676 → 0.667、B 0.971 → 0.929，recall 上界 S 0.548 → 0.596 / B 0.600 → 0.639（#35–#40 逐节标注）。
- INFO：§3 用例数 16 → 20（对抗复审后新增 T0-U4 三引号 / T3-U1b / T3-E4 / T4-E7 / C-1）。
