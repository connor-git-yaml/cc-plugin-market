# F290 · 批次 3 残余收口（安全面）

> 模式：spec-driver fix（门禁 / 判定器类：常设异构对抗 ×2 角 + verify 子代理；Codex 审查暂停，异构档位缺席）。基线 `5f34cf13`。
> 范围：M10 §12.4 M11 债务中五项**可加性、无裁决改动**的残余；per-target 预算与 `stop_hook_active` 拆 F291。

## 1. 问题与证据

见 spec §1（五项：检测侧不在 doctor 闭包 / 锁身份竞态零回归覆盖 / 无 enum 反向守卫 / Tier 2 绑定原因不可见 + fail-open 事件无 tier / resume 不认 fix 目录）。

## 2. 修复

- **检测侧 doctor 闭包**：`SIDECHAIN_FILE_SET`（sidechain CLI 真实 BFS 闭包 8 项）+ `DOCTOR_FILE_SET = JUDGE ∪ SIDECHAIN`（12 项，保序保入口）；doctor roster 改用 union；新增 `sidechain-file-set-guard`（闭包相等）；judge-snapshot 三套件长度钉改引 `DOCTOR_FILE_SET`（positional `JUDGE_FILE_SET[k]` 引用不变）。`JUDGE_FILE_SET` 不动（判定器确实不 import 检测侧 CLI，FR-002b 守卫要求完全相等）。
- **锁竞态确定性用例**：io 接管分支加 test-only 环境钩子（读 holder 判陈旧 → rename 之间可注入延迟，**上限 1000ms 且每次 acquireStateLock 仅生效一次**，未设即零行为）；card-b T1-C6：A 延迟 150ms、B 接管后持锁 300ms（150 < 300 < 150+480 重试预算）⟹ A 的 rename 经身份核对撤回、等 B 释放后取锁，终态 2；裸 unlink 接管会删 B 活锁 ⟹ 终态 1。T-S2 钉原子创建只经 staging+linkSync（M1-b）。
- **enum→产出点反向守卫**：card-a T0-U6 三产出形态（`表.键` / 表动态下标 / 绑定码的具名常量被引用 ≥2）；allowlist `nonblock-storage-unavailable`、`parse-timeout` 双向（零产出未登记 ⟹ 红；登记码有产出 ⟹ 红）。首跑即暴露三种形态并存（LEDGER 用常量别名、IN_FLIGHT 用动态下标），故守卫按形态枚举而非单一 `表.键`。
- **Tier 2 可观测性**：`tryAppendFailOpenEvent(…, tier)` + transcript 级 fail-open 传 `result.tier`；`evaluate.tier2CandidatePath`；`tier2BindingNotice(source, dir)` 经 `counts.tier2Notice` 进 `dispatchRoute` 三阻断 arm（与 UNCORROBORATED_NOTICE 叠加）。走既有 `noticeLine` 渲染点，可见诊断码集合不变（T0-U5 不动）。
- **resume fix 恢复**：恢复点表增 fix 目录六行 + 「Phase 4 verify 仍须 Task 委派」注（Tier 2 (a) 源续做证据）；`repo:sync` 再生 `.codex/skills` 与 `skills-codex` 包装（body sha）。

## 3. 红先行 / 守护

新增：sidechain-file-set-guard（2）、core.test 常量断言（1）、card-b T1-C6 + T-S2（2）、card-a T0-U6（1）、tier2 E4（1）。改：judge-snapshot 三套件钉引 DOCTOR_FILE_SET（零翻转 90/0）。
变异清单（**全部经对抗复审或主线程亲跑实证**，红的套件逐条标注）：
- M-a 撤 `identityOk` 核对（裸 unlink 接管）⟹ **T1-C6 红**（27/1）。
- M-b-1 从 allowlist 删 `parse-timeout` ⟹ **T0-U6 红**（20/1）。
- M-b-2 给 allowlist 码加真实产出点 ⟹ **T0-U6 红**（20/1；C-2 修复后才成立，修复前为死代码）。
- M-c-1 改 `DOCTOR_FILE_SET` **定义**（别名回 JUDGE_FILE_SET）⟹ **sidechain 守卫第 2 例 + core.test F290 断言红**。
- M-c-2 只改 doctor **消费处** roster（`DOCTOR_FILE_SET.map`→`JUDGE_FILE_SET.map`）⟹ **`judge-snapshot-doctor.test.mjs` 红**（11≠12），守卫与 core.test 保持绿（早稿把两者混为一条，已拆）。
- M-d `tier2Notice` 不下传 ⟹ **E4 红**（24/1；E5 加入后套件总数 25，早稿写 23/1 为 round 1 遗留）。
- M-e fail-open 不传 `tier` ⟹ **E4 红**（24/1，同上）。
- M-f-1 trace 钩子去 `Math.min` 上限 ⟹ **T-S2 红**（27/1；C-1 修复后才成立）。M-f-2 去一次性闭锁 ⟹ **T-S2 红**（27/1）。
- M-g 去 `renderPathSegment` 消毒 ⟹ **E5 红**（24/1）。
- M-h 删真实产出点只留提及同名标识符的注释 ⟹ **T0-U6 红**（剥注释后计数 0）。M-i 删 `IN_FLIGHT_STATES.NO_IN_FLIGHT` 的 key 级产出点 ⟹ **T0-U6 红**（key 级断言生效）。

## 4. 如实登记

- trace 钩子是生产代码里的 test-only 分支（K-1）：零行为靠「未设环境变量」+ **1000ms 上限 + 每次调用仅一次**（W-1 收窄）+ T-S2 三项断言钉。
- DOCTOR_FILE_SET 扩集后**已安装旧快照**在 doctor 显示 `added-since`（预期，F246/F270 同形态）。
- T0-U6 三形态是对现状枚举（K-3）：第四种产出形态会误报零产出（fail-loud 方向）。
- 两侧 shell 薄壳仍不进 doctor 比对（既有口径）。
- **T0-U6 残余（误伤面 W-2 修复后的诚实上限）**：`FOREIGN_DIALECT_DIAGNOSTICS` 产出形态为运行时键控 `表[dialect]`，**静态上不可能有 key 级证据**，故该表保留表级证据——同表某 key 的产出被删时该守卫仍判「有产出」。已在测试内与 spec K-4 标注；根治需产出侧改为显式 `表.键` 形态（行为改动，不在本卡）。
- 未做：per-target 预算 / `stop_hook_active`（F291；后者是**反转 F270 P3 既有裁决**的策略变更，另附提案待拍板）。

## 5. 验证（主线程）

card-a 21/0（+T0-U6）、card-b 28/0（+T1-C6/T-S2）、tier2 **25/0**（+E4/E5）、judge-snapshot 三套件 + 双闭包守卫 **90/0**（口径 = core 31 + doctor 17 + doctor-cli 39 + judge-file-set-guard 1 + sidechain-guard 2，误伤面独立复核逐字一致）；plugin 全量 **1946 tests / 1944 pass / 0 fail / 2 skipped**（verify 实测；早稿 1945 为 E5 加入前的 round 1 值）；build 0（**注**：F290 不碰任何 `.ts`，build 对本卡近乎零区分力，门禁价值由 plugin 套件 + 双守卫承担）；repo:check warn（既有 publish-gap / graph-freshness）。全量门禁与 judge-cli/core/io/ledger 零翻转见 §6。

## 6. 对抗复审处置

异构对抗 ×2 角（绕过面 `a8961144` / 误伤与回归面 `afe167df`，基线冻结 `eff3e42f`）。合计 **2C / 5W / 7I**，全部处置于下。**两条 CRITICAL 都不是运行期绕过，而是我自己在 §3 变异清单里写的「安全网被测试钉住」断言被亲跑证伪**——即「声称有保护、实测没有」的验证空洞，这类恰是本仓最该抓的一类假绿。

### CRITICAL（2，均已修 + 变异实证）

| # | 发现 | 处置（已变异实证变红） |
|---|---|---|
| 绕过 C-1 | §3 声称「M-f 钩子去 5s 上限 ⟹ T-S2 红」**为假**：T-S2 只断言环境变量名出现，上限与夹取逻辑零覆盖（去掉 `Math.min` 全 28 例仍绿） | T-S2 改为钉三件：① 上限常量 `LOCK_TRACE_DELAY_MAX_MS ≤ 1000`；② 睡眠必经 `Math.min(traceDelay, 常量)`；③ 一次性闭锁 `traceApplied` 三处齐全。**实测**：去上限 ⟹ 27/1 红；去闭锁 ⟹ 27/1 红 |
| 绕过 C-2 | §3 声称 allowlist「双向」**对当前两个码为假**：`nonblock-storage-unavailable` / `parse-timeout` 均不在任何码表 ⟹ `!entry` 分支直接 `continue`，**永远走不到**产出点扫描，给它们加真实产出点也不变红（陈旧检测是死代码） | 不在码表的码改为扫**裸字面量**产出点：allowlist 码一旦出现 `'<code>'` / `"<code>"` 即判 allowlist 陈旧。**实测**：给 `parse-timeout` 加 `export const … = 'parse-timeout'` + 引用 ⟹ T0-U6 20/1 红 |

### WARNING（5）

| # | 发现 | 处置 |
|---|---|---|
| 绕过 W-1 | trace 钩子虽**同会话 export 无效**（hook 进程 env 取自宿主启动快照，本仓 STORAGE_UNAVAILABLE 文案已登记该事实），但 `.claude/settings.json` 的 `env` 字段可**持久化**到下次会话所有 hook 子进程；叠加接管重试上限 `LOCK_RETRY_MAX=60`，最坏 60×5s=300s，越过宿主 hook 超时后「超时按放行处理」等价门禁绕过 | **双重收窄**：上限 5000→**1000ms**（T1-C6 只需 150ms）+ **每次 `acquireStateLock` 最多生效一次**（`traceApplied` 闭锁）⟹ 最坏放大 1s，不足以越过超时。两者均由 T-S2 钉住（见 C-1） |
| 绕过 W-2 | `tier2BindingNotice` 把 `candidatePath` **零消毒**拼进 stderr，安全性完全依赖三处上游锚定正则恰好把字符集卡死在 `[a-z0-9-]`；F276 W-1「路径里一个换行就能长出伪造行、可冒充 `GATE_DEGRADED_PREFIX_LINE`」正是这样复活的；且 `grep tier2BindingNotice tests/` 零命中 | 在 `tier2BindingNotice` **自身**调用既有 `renderPathSegment` 一次性消毒（防线回到正确层级，不再依赖上游不变）；导出该纯函数并新增 **E5**：换行伪造路径 ⟹ 无真实换行、折成 `\x0a`、无行首伪造前缀。**实测**：去消毒 ⟹ E5 24/1 红 |
| 绕过 W-3 | §3 的 M-c 归因不准：只改 doctor 消费处（plan 称「roster」）时红的是 `judge-snapshot-doctor.test.mjs`，**不是** sidechain 守卫 + core.test；后者只在改 `DOCTOR_FILE_SET` 定义本身时红 | §3 变异清单 M-c 拆为两条并各自标注真实红的套件（已订正，见下） |
| 误伤 W-1 | `judge-snapshot-doctor.mjs` 文件头注释仍写「集合以 JUDGE_FILE_SET 的枚举为准」——F290 改集合后成**事实性错误**；`judge-snapshot-doctor.test.mjs` 的 `writeJudgeFiles` 注释「8 个文件」亦为更早遗留的过时计数 | 两处注释均已订正（头注释改为 `DOCTOR_FILE_SET` 并说明 = JUDGE ∪ SIDECHAIN；测试注释改为「全部文件，长度由常量派生，勿写死」） |
| 误伤 W-2 | T0-U6 两处**假阴性**缝隙（与 spec K-3 登记的误报方向相反）：① 形态①按裸子串计数、**不分代码与注释**——删真实调用点只留一条提及同名标识符的注释即恢复绿；② 形态②`表[` 是**表级**证据，删掉某 key 自己的产出点后同表其他 key 的动态访问仍让它判「有产出」 | ① 计数前**先剥注释**（与 T-S2 同口径）；② 凡能拿到 key→常量名映射的表（`IN_FLIGHT_DIAGNOSTICS` via `IN_FLIGHT_STATES`）改**key 级**断言 `表[常量.KEY]`、**不再表级兜底**；完全运行时键控的 `FOREIGN_DIALECT_DIAGNOSTICS`（产出形态 `表[dialect]`）静态上不可能有 key 级证据，保留表级并在测试内与 spec K-4 如实标注。**实测**：注释残留形态 ⟹ 20/1 红；删 `IN_FLIGHT_STATES.NO_IN_FLIGHT` 产出点 ⟹ 20/1 红 |

### INFO（7，采纳要点）

- 绕过 INFO-1「90/0 对不上（算得 89）」：**经误伤面独立复核为我方正确**——31(core)+17(doctor)+39(doctor-cli)+1(judge-file-set-guard)+2(sidechain-guard) = **90**，逐字匹配 §5；绕过面取的三文件组合不同故差 1。§5 已补明该口径的五个被加数，消除歧义。
- 误伤面复核确认：Tier 1 **零出现**绑定文案（实测 stderr 无「识别为 fix 续做」）；fail-open `tier` 三态实测 1 / 2 / null 与设计一致；`tier2` 参数只影响 `delegation:implement` 一处（文案「implement 已豁免」无夸大）；resume 表 Phase 编号/名称与 fix SKILL 逐字一致，「含 Root Cause 节」对应既有机械判据 `ROOT_CAUSE_HEADING_REGEX`；「代码变更存在」措辞是全表既有惯例（非本卡新造模糊）。
- `detectTier2Binding` 的 JSDoc 表格（**F289 遗留**）仍写 (b) 见证含 `verification-report.md`，而代码只认 `fix-report.md`——F290 新写的 label 与**代码真实行为**一致未被带偏；该 JSDoc 漂移已顺手订正（不改行为）。
- K-2「显示 added-since」只在 `--since` 早于该文件创建提交时成立，其他取值显示 `pre-existing`——两者皆预期内，K-2 已补该前提。
- `npm run build` 对本卡近乎零区分力（F290 不碰任何 `.ts`），门禁价值由 plugin 套件 + 双守卫承担（已在 §5 注明）。

### verify 子代理（第三轮）—— 2 新 CRITICAL + 3 WARNING，均已处置

verify 先用 **7 个变异**逐一复现两轮对抗的 CRITICAL 修复：**7/7 应红全部真红**（27/1、20/1、24/1 计数逐字吻合）⟹ **「两轮 CRITICAL 真修好」判 PASS，无空头承诺**。但它**独立**发现 2 项同性质（「声称有安全网、实测没有」）的**新**缺口，都在我 round 2 刚写的 T0-U6 里：

| # | 发现 | 处置（已变异实证变红） |
|---|---|---|
| verify C-新1 | round 2 的「剥注释」用 `^\s*\/\/.*$`，**只剥整行注释、不剥行尾注释**——而行尾注释是本仓主流写法（`diagnostics.push(X); // 说明`）。删掉真实产出点后只留一句**行尾**说明，T0-U6 恢复绿（21/21）；同一删除把注释挪到独立行则正确红（20/1）。三形态共享同一 corpus，风险面 = FR-003 全部码 | 改为**状态机整体剥离**（行 + 块注释，字符串/模板态保留），并在 code 态处理 `\` 转义——否则 `/^https?:\/\//` 这类正则的 `\/\/` 会被误当行注释起点而**过剥**（本仓实有 3 处）。另加**过剥自检**：剥离后三个已知真实产出点必须仍在，否则 fail-loud。**实测**：form① 行尾注释形态 ⟹ 20/1 红；`FOREIGN_DIALECT` 表级行尾注释形态 ⟹ 20/1 红（消息逐字「零真实产出点」） |
| verify C-新2 | 形态③「别名引用 ≥2 次」**不要求任一引用是真实产出调用**——「定义 + 登记进表」这两处**纯声明性**引用天然就有 2 次。把 `LEDGER_CORRUPT_ENTRY` 唯一的 `push()` 产出点整段删除后 T0-U6 仍绿（受影响面 = 整个 `LEDGER_DIAGNOSTICS` 表，该表全走形态③）；该回归仅被 `ledger-reader.test.mjs` 自身功能测试捕获，反向守卫失职 | 形态③改为**非声明性引用 ≥1**：剔除「定义行 `export const X =`」「纯表登记行 `key: X,`」「import/export 说明符行」后仍须有引用。**实测**：删 `LEDGER_CORRUPT_ENTRY` 全部真实使用、只留定义 + 表登记 ⟹ 20/1 红 |

**3 项 WARNING 全为同一模式**（round 2 增补后 round 1 的具体数字/措辞未同步刷新，方向均是「文档说的保护比实际更弱」，非危险方向）：① §2/§4 与 spec FR-002/K-1 仍写「≤5s / 5s 上限」，实际已降为 **1000ms**；② §3 的 M-d/M-e 计数「23/1」，E5 加入后应为 **24/1**；③ §5「plugin 全量 1945 tests」应为 **1946 tests / 1944 pass / 0 fail / 2 skipped**。**三处已逐一刷新**（本节之外的原文均已改）。

**INFO 采纳**：`FOREIGN_DIALECT_DIAGNOSTICS` 当前**只有 1 个 key**，故删其唯一产出点现在确实会红（已实测）；K-4 登记的表级残余**要到该表新增第二个 key 时才真正激活**——K-4 措辞已按此精确化。verify 另确认「949」非 fix-report 原文数字而是五套件 pass 之和的推导值（实测精确复现），以及误伤面四项结构性核对零偏差。

## 7. 工具使用反馈（dogfooding）

- 未用 Spectra MCP：改动面为判定器/doctor/测试 .mjs + SKILL 散文，符号面已由前两卡直读钉死；本 worktree 图 stale。
- Spec Driver：手工 fix 骨架；`repo:sync` 对 SKILL 编辑的包装再生正常，`_generated` 噪声按既定规则回退。
