# F288 · fix-compliance 卡 B：状态文件并发安全 + 计数幂等（G1）/ GATE 证据指纹路由半边（G2）/ 放行佐证（6b）

> 模式：spec-driver fix（门禁类·串行链：F287 卡 A → **本卡** → 续做/旁链入口卡）。基线 `592f2b73`（rebase 到 `b9a4aa92`）。
> 输入：`specs/276-fix-compliance-p0a-residue/handoff/`（README 第 3 轮裁决 1–6b + `plan-pre-split-design-capital.md` G1/G2 段）。
> 审查档位：门禁 / 判定器类**常设异构对抗**——主线程自审 + 独立子代理 ×2（绕过面 / 误伤与并发面）+ verify 子代理。Codex 审查暂停，异构档位缺席。

## 1. 问题与证据（改动前）

| # | 缺陷 | 证据 |
|---|---|---|
| 1 | 状态文件 4 条 read-modify-write（routeBlock / releaseDegraded / defer / 卡 C 删掉的 routeNonBlock）无互斥；F270 实证同一 Stop 事件 ≥2 个判定器进程（Codex 双注册 / 主线程 + 子代理），`saveBlockState` 的丢更新恰好充当了「每 Stop 只计一次」的去重 | handoff README R2-2 归因链；`baseline-reproduction.md` B-2 / B-9 |
| 2 | 只加锁不定义计数幂等键 ⟹ 一次 Stop 吃两格 `blockCount`，FR-006「2 次补救」降为 1 次，终态文案「3 次不合规尝试后降级」成审计假话 | 同上（R2-2） |
| 3 | GATE 冻结暂停（用户零输入、证据状态不变）每次 Stop 都消耗 `blockCount` ⟹ 两次即降级放行；`nonBlockStopCount` 自 F270 P3 起「只有带回方没有递增方」 | plan G2 B-1 对照组；io normalizeState 注释 |
| 4 | 预置状态文件 `{"blockCount":2,"degradedRecorded":true}` ⟹ `routeBlock` 首个 Stop 0 次往返放行且零终态（状态文件在被判方写域） | 第 5 轮 C-2 → 裁决 6b |
| 5 | `releaseDegraded` 的 `degradedRecorded` 是 read-then-act：两并发判定器都读 false ⟹ 都写终态（R2-8） | plan G1 序列 ② |

## 2. 修复（承接第 3 轮裁决 1–6b，不重开讨论）

### G1 · 锁 + 锁内 RMW + 计数幂等（io + judge）

- **`acquireStateLock` / `releaseStateLock` / `mutateBlockState`**（`fix-compliance-io.mjs`）：锁文件 `<状态目录>/<sid>.lock`，**先写临时文件再 `linkSync` 原子创建**（`openSync 'wx'` 后再写内容会留下「文件已在、内容为空」窗口，等待者读空判陈旧即接管——8 进程实测丢更新，已修）；锁包住 load；有界重试 60 × 8ms（`Atomics.wait`，不忙等）；陈旧锁接管 = pid 不存活 **或** 墙钟 > 300s（覆盖 F273 合盖睡眠冻结），接管走 `rename` 到唯一名再删（两个等待者不会互删对方新锁），落 `state-lock-taken-over`；**不做 `pidStartedAt`**（裁决 2）；内容不可解析但 mtime < 2s 按新鲜。
- **锁不可得（裁决 1）**：删掉级 2 / 级 3——重试耗尽直接**降级为无锁 RMW（= 改动前行为）**+ `state-lock-unavailable`，裁决方向不变；不需要任何跨 Stop 状态。锁只落一个位置（主目录忙不退到 tmp 的另一把锁——那是互斥被打破）；只有主目录本身不可用才退到 tmp。锁只由持有者按 `lockId` unlink；`resetBlockState` 不需要互斥、不删锁（R2-9）。mutator 抛错不向外抛（A-6）。
- **4 条 RMW 全部迁移**：routeBlock / releaseDegraded（`degradedRecorded` test-and-set 进锁内，锁外写终态，R2-8）/ defer 路径（闸门二的读 + `inFlightDeferCount +1` 同一次 mutation）/ 指纹路由。5 字段手工透传与 `inFlightDeferCount = 0` 默认值 fail-open 消失（源码守卫 T-S1）。
- **计数幂等键 = `lastCountedFingerprint`**（状态文件新字段，缺省 null，向后兼容）：与 G2 的路由三分是同一机制两半——同一 Stop 的第 2 个进程看到第 1 个写回的指纹 ⟹ 落入无进展格 ⟹ `blockCount` 增量恰 1（T1-C2 五轮）。

### G2 · 指纹路由半边（judge）

- **指纹四分量**（`computeEvidenceFingerprint`）：`prompt_id` / `sorted(missing)` / 账本委派条目数 / `latestFixLineIndex`（R-5：绝不取 earliest），sha256；**`prompt_id` 缺席 ⟹ 整条指纹路由不生效**，按改动前 `routeBlock` 处理 + `gate-fingerprint-partial`（R2-4，撤回 sentinel）。
- **互斥三分**（`routeByFingerprint`）：`last === null` / `fp === last` ⟹ nonBlock（不计 `blockCount`、`nonBlockStopCount +1`、退出码保持裁决语义 **2**、文案走 `buildFeedbackText`——R2-5 首次 exit 2 也要看到该补什么）；`fp !== last` ⟹ routeBlock 语义。**所有分支同一次锁内 mutation 写回指纹**（R2-3 ①）。指纹只收紧不放宽（D-5）。仅 `enforcement === 'block'` 生效（R2-6：warn 分支在前已 return 0，不写回）。
- **耗尽放行**：`nonBlockStopCount >= NON_BLOCK_LIMIT(=2)` 或 entry ≥ `NON_BLOCK_ENTRY_LIMIT(=420)` ⟹ `releaseDegraded`：终态 `failed`、`complianceVerdict.blockCount` 为**真实计数（number）**（裁决 3）、审计 `degraded:true` + `nonblock-limit-exhausted` / `nonblock-backstop-exhausted`、stderr `[GATE-DEGRADED]`——与 `blockCount` 路径可见性对等且可区分。`NON_BLOCK_LIMIT >= BLOCK_LIMIT` 钉住（放行地板不变：交替投桶只会多吃 exit 2）。
- **死代码注释消灭**：io / judge 的「递增方留给卡 B」「生产零接线」改写为真实接线状态（源码守卫钉 `/生产零接线/` 不出现）。

### 6b · 放行佐证（状态文件不可伪造性的替代物）

- 状态文件不可能真正不可伪造（同一写域、无秘密）。替代物：**任何降级放行都必须有 storage-free 事实支撑**——`countBlockFeedbackEntries`（core）数 transcript 里 harness 回灌的本判定器阻断反馈（`Stop hook feedback:` 起头、单文本块、含 `[FIX-COMPLIANCE]`，窗口 latest），≥ `BLOCK_LIMIT` **或** entry ≥ 420 才允许放行（`releaseCorroborated`）；否则 exit 2 + `state-budget-uncorroborated`、计数不再推进。每条反馈 = 一次真实 exit 2 往返（卡 C 地板论证），预置计数只能换来再被阻断（T6-E1/E2/E3）。
- **预置 `degradedRecorded:true` 抑制不了终态**：`alreadyRecorded` 只在 runs 账本里确有本会话 `failed` 记录时成立（`hasFailedRunRecord`），否则补写。
- 卡 C 的 `!saved.ok` 方向（fail-closed + 反馈计数上界）在所有路由分支保留（`dispatchRoute` 统一走 `routeStorageUnavailable`）。

## 3. 红先行 / 守护

- 新测试 `plugins/spec-driver/tests/fix-compliance-card-b-lock-fingerprint.test.mjs`（**26**，含对抗复审 + verify 后新增 T2-E8/E9/E10 与 T1-C5）：T1-U1~U3 原语；T1-C1 8 进程 +1 = 8（丢更新 0）；**T1-C5 预置陈旧锁 + 8 进程并发接管 = 8（闭合 verify W2「陈旧锁 + 多进程」结构缺口）**；T1-C2 同 payload 双进程 `blockCount` 增量 1（5 轮）；T1-C3 合规 + 活锁 reset 生效；T1-E4 活锁下裁决方向不变 + `state-lock-unavailable`；T1-C4 双进程放行终态恰 1 条；T2-U1 指纹分量（earliest 不参与）；T2-U2 不变量 + 五码 ⊆ enum；T2-U3 佐证计数谓词；T2-E1 冻结暂停 2,2,0 / `blockCount` 全程 0 / nb 1→2→2 / 终态 number / 幂等；T2-E2 有进展 2,2,2,0；T2-E3 `prompt_id` 缺席 = 改动前 + partial；T2-E4 warn 恒 0 零状态；T2-E5 交替桶不更松；T2-E6 存储不可用 nonBlock 路径 exit 2；T2-E7 **420 零回灌仍 exit 2**（对抗复审 C-1：420 不是放行腿）；**T2-E8 指纹锚点 = 最晚 fix 展开接线钉（A-W3）**；**T2-E9 nonBlock 写回不丢既有字段（I-5）**；**T2-E10 mutator 抛错 = internal-error 不冒充存储故障（W-2）**；T6-E1~E3 预置状态 / 无回灌不放行；T-S1 源码守卫（含放行佐证谓词只认 harness 回灌）。
- 既有 `fix-compliance-judge-cli.test.mjs`：`runCli` 增加 **harness 回灌模拟**（exit 2 后按真实形态追加反馈条目到 transcript 影子拷贝，夹具本体不动；影子按原文件内容哈希失效；`harnessFeedback:false` 可关）——静态夹具此前没有这一步，6b 后所有「第 3 次放行」用例都需要它才成立（这是**模型真实 harness 行为**，不是放宽）；F240 I2 基线 diagnostics 列 +`gate-fingerprint-partial`（五列逐字不变）；W7 预装 count=2 须配 2 条回灌；E-b / E-b′ 关闭模拟（钉「伪造条目不计数」）；E-r 忘传面改为 `extraDiagnostics`（counts 已从 evaluate 内派生，忘传面结构性消失）。
- 变异清单（verify 执行）：M1-a 去锁（`acquireStateLock` 恒 acquired:false 且不降级）/ M1-b `link` 改回 `wx`+写 / M1-c 陈旧接管改 unlink / M1-d 写回不带 `...state` / M1-e reset 走锁且锁不可得跳过 / M2-a nonBlock 首行 `return 0` / M2-b nonBlock 不写回指纹 / M2-c 指纹用 earliest / M2-d 指纹路由插到 warn 之前 / M2-e 耗尽终态 blockCount 传 null / M2-f `NON_BLOCK_LIMIT = 1` / M6-a 去掉 `releaseCorroborated` / M6-b `alreadyRecorded` 不查账本 / M6-c 佐证谓词用 includes 不用 startsWith。

## 4. 如实登记（代价 / 残余 / 移交 M11）

- **K-13** `prompt_id` 不可得通道（Codex 方言 / 老 harness）不走指纹去重 ⟹ 退回「一次 Stop 吃两格」——不可消除，只登记。
- **K-14** 并发下每个 Stop 多消耗 N−1 格 `nonBlockStopCount`（第 2 个进程落无进展格）：fail-open 方向（跑道缩短），上界为 `NON_BLOCK_LIMIT`（420 已在对抗复审 C-1 后从**放行**腿降级为 nonBlock 跑道的**耗尽触发**，放行仍须佐证）。verify 须实测该速率。**双注册拆条回灌**下地板 = ceil(2/N) 个 Stop（B-W3；合并回灌才持平）。
- **K-18** test-and-set 成功但锁外终态写抛错 ⟹ 终态缺失；双进程各自有进展同时放行时，第 2 个进程的账本核对与第 1 个的终态 append 之间有微秒级窗口 ⟹ 极小概率重复终态（方向：多写审计，安全）。
- **R-6 harness 不回灌 ⇒ 阻断到底**（对抗复审 C-1 收口后的方向性代价）：删掉 420 assistant-entry 放行腿后，佐证只认 harness 回灌的阻断反馈。**不回灌 hook 反馈的运行环境**（Codex 方言回灌形态未采样 / 某些 headless）在预算耗尽后会被**持续阻断**（每 Stop loud `state-budget-uncorroborated` + 人读提示），逃生口 = `enforcement: warn`——与卡 C storage-unavailable 路径同一口径。这是**刻意选择 fail-closed** 而非保留一条可自泵的放行腿；恢复「诚实 headless 自动有界放行」的候选机制（`stop_hook_active === true` 作 harness 代写的第三条佐证腿，模型不可伪造 + 叠加终态）曾被 F270 P3 判死、需重新裁决，作为决策点上浮用户，**本卡不做**。
- **佐证滞后**：harness 懒刷盘（F262 实证主 transcript 可滞后）会让佐证计数落后于状态文件 ⟹ 诚实用户多吃一次阻断（fail-closed，上界 420 backstop）；只能活捕，不能离线估触发率。
- **自注册 Stop hook 投喂**（卡 C 既有残余）对佐证计数同样有效——但每条 = 一次自己被阻断的往返，压不低地板。
- **锁不是安全边界**：双等待者同时判陈旧的接管窗口极窄（rename 唯一化已收）；判错只退回改动前的无锁行为。
- **锁竞态回归覆盖边界（verify W1/W2）**：T1-C5 已补「预置陈旧锁 + 8 进程并发接管」用例（钉住接管下丢更新 = 0，闭合原「无 陈旧锁 + 多进程」结构缺口）；但 M1-b（`link` vs `openSync('wx')` 原子创建的空内容窗口）与 M1-c（接管身份核对 vs 裸 unlink）的**具体设计点**是微秒级竞态，`unreadableButRecent` 兜底 + 短临界区使其在无生产侧 trace 注入时不可确定性观测——属**回归覆盖薄弱面而非活跃缺陷**（verify 100 轮正确代码 0 丢更新），如实登记，专项 trace 注入用例列 M11。
- **既有 fail-open 崩溃域**（F287 移交）：fix-report.md ≥ 2^27 行 ⟹ V8 fatal ⟹ wrapper exit 0——不在本卡。
- **runId 与 skill 不同源污染 adoption 指标**（F257 登记）——本卡 `releaseDegraded` 沿用 `runId = sessionId`，未改。
- 不做：级 2 / 级 3 三级处置、`pidStartedAt`、G3/G4（卡 A 已 ship）、续做/旁链入口（下一卡）。

## 5. 影响范围

- `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs`（锁原语 + mutate + 字段）、`lib/fix-compliance-core.mjs`（`countBlockFeedbackEntries` + 谓词抽公共）、`fix-compliance-judge.mjs`（路由重写）、schema enum +5 + 两处 description、CLI 合同文档 +1 节 + 退出码表 +3 行；JUDGE_FILE_SET 不变（无新文件）。
- 消费方：审计事件多 5 个可选码；`record-workflow-run` failed 记录的 `blockCount` 现为真实计数；`--mode report` 输出不变。

## 6. 验证（主线程）

- 新套件 **26/0**（T1-C 并发段 3 次重复全绿，verify 独立复跑 3× 25/25——本行 26 含 verify 后追加的 T1-C5）；`npm run test:plugins` **1912/0**（2 skip；rebase 到 b9a4aa92 后含批次 3 其它卡新增用例，早期稿写的 1886 已过期）；judge-cli + card-a + core + io 合计 **924/0**（分项：judge-cli 225 / card-a 20 / core 604 / io 75；924 是四者之和，非 judge-cli 单套件数——verify W4 澄清）。
- 全量 vitest / build / repo:check / release:check：rebase 后跑（push 前复核）。

## 7. 对抗复审处置

门禁 / 判定器类**常设异构对抗**：独立子代理 ×2（绕过面 `a69f5f17` / 误伤与并发面 `ab124be0`）+ verify 子代理。**Codex 审查暂停，异构档位缺席**（可配额恢复后回补）。两路合计 **2C（同一缺陷两角）+ 8W + 大量 I**。

### CRITICAL（两路 C-1 收敛到同一缺陷：放行佐证的 420 assistant-entry 腿）

| # | 发现 | 处置 |
|---|---|---|
| A-C1 | `releaseCorroborated` 的第二条腿 `entryCount >= 420` 落在**被判方产出面**——一个 turn 内 420 次 `Bash true` 即可让首个 Stop 零往返放行；同一常量在 F257 是「≥420 ⇒ 不再给推迟通道」的 **fail-closed** 语义，接成放行腿是方向反转（F278「防线照错方向搭」再现）。端到端实证 base 三次 exit 2 / head 三次 exit 0 | **已修（fail-closed）**：`releaseCorroborated` 删除 entry 腿，只认 harness 回灌反馈 ≥ `BLOCK_LIMIT`；420 只保留为 nonBlock 跑道**耗尽触发**（`routeByFingerprint` 的 `backstop`），耗尽后仍须佐证才放行。源码守卫 T-S1 追加「`releaseCorroborated` 体内不得出现 `NON_BLOCK_ENTRY_LIMIT`/`entryCount`」。T2-E7 重写为「420 + 零回灌 ⇒ 仍 exit 2」 |
| B-C1 | 同一缺陷从误伤角：6b 把「陈旧快照下有界 DoS（2 次）」变成**无界阻断**——F262 实证 harness 懒刷盘可停格滞后 25 分钟，冻结快照下 `assistantEntriesSinceEarliestFix` 不动、backstop 结构性不可达；fix-report 原「上界 420」为假 | **已修 + 如实登记**：删 entry 腿后方向统一为 fail-closed；残余「harness 不回灌的环境（Codex 方言 / 某些 headless）会被阻断到底」如实写入合同与 §4（下），逃生口 = `enforcement: warn`（同卡 C storage-unavailable 口径）。**观测性补强**：uncorroborated 分支 stderr 增加人读提示行「预算已耗尽但缺放行佐证……勿反复重补……请设 enforcement: warn」（T6-E3 钉），避免 headless 用户空烧预算。**未采纳** B 建议的 `stop_hook_active` 第三条佐证腿——它曾被 F270 P3 判死、需重新裁决且属新机制，超本卡范围；作为决策点上浮用户（见 §9） |

### WARNING

| # | 发现 | 处置 |
|---|---|---|
| A-W1 | 「预置 `degradedRecorded:true` 抑制不了终态」只对「只伪造状态文件」成立——`hasFailedRunRecord` 读的账本与状态同写域，同时伪造一条 failed 行即可抑制 | **合同改如实**：新增「终态可见性不是安全边界，放行地板由佐证承担；账本与状态同写域，伪造 failed 行再删可抑制终态」 |
| A-W2 | mutator 抛错走 `routeStorageUnavailable`，文案把代码 bug 说成「路径不可写」，审计无独立码 | **已修**：新增 `routeInternalError`——mutator 抛错 / 未知路由 ⇒ exit 2 + `internal-error`（不冒充存储故障、blockCount null）；佐证 ≥ 2 仍可降级放行（判定器自身 bug 不锁死会话，但放行需真实往返）。T2-E10 端到端钉 |
| A-W3 | M2-c（指纹锚点改 earliest）在 judge-cli 全绿；整条指纹/6b 生产路径在该套件零覆盖 | **已补**：card-b 新增 T2-E8——两次 fix 展开的 transcript 写回的 `lastCountedFingerprint` 必等于按 **latest** 锚计算、不等于按 earliest 计算（接线钉，非纯函数钉） |
| A-W4 / B-W4 | 锁新鲜度不校验 `startedAt ≤ now`、EPERM 视为存活 ⇒ 一个伪造字段让锁永不被接管（有界 DoS +480ms/Stop）；终态 warning「3 次不合规尝试」与真实往返数不符 | **已修**：`pidAlive` EPERM ⇒ 不存活；`fresh` 追加 `startedAt <= now`（T1-U2 补未来时间戳 + pid 1 两形态）。终态默认 warning 去掉「N 次尝试」false-precision（改「达到阻断上限后降级放行」；真实计数在 `complianceVerdict.blockCount`）；nonBlock 耗尽放行首行不再说「已达阻断上限(2 次)」（`blockCount` 可能为 0，改 `nonBlockExhaustionReason`） |
| B-W1 | 锁接管竞态：stat/read 撞 ENOENT（锁刚被别人 rename 走）被判「陈旧」→ rename 掉一把**活锁** ⇒ 双持锁丢更新；「rename 唯一化不互删」声明不成立（µs 窗口，两进程即可触发） | **已修**：接管前 ENOENT ⇒ `vanished`，不接管、重试 link；接管改「记住判陈旧的 `lockId` → rename → 核对 stalePath 内容身份，不符则 rename 回去」。后果本就只是一次丢更新（计数少 1 = 跑道变长，非绕过），现连该窗口一并收 |
| B-W2 | 诚实用户阻断上限从 2 翻到 4：任何用户输入（`prompt_id` 变）都算「有进展」，「持平」只在零用户输入时成立 | **合同改如实**：新增「诚实有进展路径为 `2,2,2,0`（首停恒落 nonBlock），FR-006『2 次补救』口径漂移为『2 次有进展补救 + 1 次首停』」。是否把 `prompt_id` 移出指纹 = 弱化进展检测，**不改**（它是四分量里唯一 harness 代写项） |
| B-W3 | 双注册 + harness 拆条回灌下地板从 3 个 Stop 降到 2；「压不低地板」只在合并回灌成立 | **K 表登记（K-14 扩写）**：拆条形态地板 = ceil(2/N) 个 Stop；「压不低地板」限定合并回灌。真实双注册录制从待调研升为后续必测（handoff 零样本，本卡两种假设下的序列均已跑） |

### INFO（已采纳的）

- I-3（T2-E5 弱钉）→ 改精确序列 `[2,2,2,0,0]`。
- I-5（M1-d 只被并发用例抓）→ 新增 T2-E9 单进程 `inFlightDeferCount` 保持钉。
- I-6 忘传面（`routeBlockEnforcement` 漏传 `result` ⇒ 顶层 catch exit 0）：与既有 IW-1「本文件顶层 catch 会兜 TypeError」同源，已在 JSDoc 登记，不新增守卫（守卫本身也在同一 catch 域内）。
- 其余 INFO（性能 p100 13.5× < 20×、故障面自愈、Codex 方言不受影响、`--mode report` 不暴露 `blockFeedbackCount`）记录为背景，未改。

## 8. 工具使用反馈（dogfooding）

- 本次未用 Spectra MCP：改动集中在三个 .mjs（判定器链），入口与调用链已由 handoff 与源码直读钉死；本 worktree 图 stale。
- Spec Driver：本卡按 fix 骨架手工执行（同批次纪律）；流程反馈见 F284 账本条目（对抗档位缺变异运行器骨架，本卡 verify 同样手搓）。
