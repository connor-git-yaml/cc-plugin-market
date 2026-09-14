---
status: f291a-shipped-as-plan-1prime (M11 卡 B, 2026-09-15) / f291b-not-implemented
owner: M11
depends_on: F288 (状态模型) / F289 (Tier 2 绑定) / F290 (残余收口)
baseline: 3596acee
f291a_status: shipped (M11 卡 B · 方案①′，见 §「M11 卡 B 实施记录」；方案①复合文件已被两轮异构对抗证伪)
f291b_ruling: "暂不实施（2026-09-14 主线程代用户判断·可翻案）"
---

# F291 设计稿（已设计、**刻意未交付**）：per-target 阻断预算（a）+ stop_hook_active 第三佐证腿（b）

两项都来自 M10 §12.4「批次 3 收官追加」的 M11 债务。本文把设计做完并附**实测证据**，供下一轮按正规卡走 spec → implement → 异构对抗 → verify。**本轮刻意不随发布交付**，理由见各节「为何不在本轮交付」。

## F291a · per-target 阻断预算

### 问题（F289 delta 复审 CRITICAL，已实测复现）
`blockCount` / 降级状态按 **session** 持久（`<状态目录>/<sid>.json`）。同会话 Fix-A 付满 2 次真实阻断后，**全新** Fix-B
首次评估即满足「blockCount ≥ 上限 + 佐证够」⟹ **0 往返降级放行**（resume / witness / 指纹路由三构造均复现）。
Tier 1 因证据窗口随新 fix 展开前移而免疫；Tier 2 的绑定锚点不随新目标前移，故暴露。
**现状登记**：M10 §12.4 残余 9 + F289 spec §7 残余 9（如实登记为 per-session 语义，未声称已修）。

### 候选设计与取舍（三选一，均已推演）
| 方案 | 做法 | 否决/选中理由 |
|---|---|---|
| ① 复合键文件 | 状态与锁按 `<sid>__<dirhash>` 键控；io 签名不变（`sanitizeSessionId` 白名单让复合键原样通过，故 io 只当它是不透明键） | **选中**（单一事实源、语义最直白）；代价见下「实测爆炸半径」 |
| ② session 文件内 `targets` 映射 + 顶层镜像 | 路径仍 `<sid>.json`，内部分桶，顶层字段镜像当前目标 | **否决**：顶层镜像 = 双事实源，正是 F262「投影剔空键击穿 RAW 槽」的同型结构 |
| ③ 单 `targetKey` + 目标切换即清零 | 状态里记一个 targetKey，与当前目标不符即视作全新（计数归零） | **否决**：honest 用户在同会话内**交替**处理两个 fix 时每次切换都清零 ⟹ blockCount 永不到上限 ⟹ **永远拿不到降级逃生口** = 永久误阻断 |

### 选中方案（①）的完整设计
- `stateKeyFor(sessionId, targetDir)` → `targetDir` 为空/不可定位时回落纯 `sessionId`（不可定位无法分目标记账，退回改动前语义）。
- `dirhash` = 目标目录 sha256 前 8 位。
- `loadBlockState(root, key, legacyKey)` / `resetBlockState(root, key, legacyKey)`：复合键文件缺席时**回落读 legacy `<sid>.json`**
  （兼容改造前状态文件 + 保「预置伪造计数」红队构造原语义）；reset **连带清 legacy**，否则回落会读回旧计数使清零失效。
- `mutateBlockState(root, key, mutator, legacyKey)` 透传；`routeBlock` / `routeByFingerprint` 经 `counts.legacyStateKey` 拿回落键。
- judge 侧四处状态调用改用复合键：两条路由 mutation、合规 `resetBlockState`、defer 分支 mutation；`evaluate` 增返回 `targetDir = resolvedPath`。
- 锁路径同键推导 ⟹ **同目标**并发判定器仍抢同一把锁（互斥不变），**不同目标**互不排斥（本就应独立）。

### 实测爆炸半径（本轮已实现并跑过，随后**整体撤销**）
实现后跑受影响套件：**card-b 24/4、judge-cli 219/6、card-a 20/1**（撤销后基线复核 card-b 28/0、judge-cli 225/0、
card-a 21/0、tier2 25/0 ⟹ 失败确由本改动引入，非预存）。把测试助手 `readState` 改为按 `<sid>*` glob 并优先复合键后，
仍余 **8 项**失败，根因两类：
1. **预置锁/状态路径失配**（card-b `T1-E4` 活锁、`T2-E6` 存储不可用）：用例预置 `<sid>.lock` / 占位 `<sid>.json`，
   复合键把锁移到 `<sid>__<hash>.lock` ⟹ 预置的「活锁」不再碰撞。**危险点：这类用例会静默地不再测它自称要测的东西。**
2. **session 级计数轨迹断言**（judge-cli `block→warn→block`、`block→off→block`、真实 transcript 差分对照、
   解锁计时器计数不被抹平、上游翻转诊断进审计、C-1 stdin >64KB）——其中多条属 **F240 基线套件**。

### 为何不在本轮交付
- M10 §12.4 该条债务的原文即写着「**独立立卡，禁在已交付安全门上同 session 叠改**」——本轮实测把这条约束从判断升级为**证据**。
- 要让 8 项失败转绿，必须改写 F240 基线套件与锁用例里的安全断言；F290 一卡的 4 个 CRITICAL **全部**是「声称有守护、实测没有」，
  在同一会话内再对这批断言做机械改写，正是该失败模式最容易复发的位置。
- 该残余的利用前提是**攻击者先在同会话付满 2 次真实阻断**，且本门是合规**推动**而非硬安全边界；
  在用户即将发布前用高风险改动换这个收益，方向不对。
- **下一轮执行要点**：先把两类受影响用例改造成「按 stateKeyFor 推导路径」而非写死 `<sid>`，再上复合键；
  锁用例须显式断言「预置的是**当前键**的锁」，避免静默失效。

## M11 卡 B 实施记录（2026-09-15）：方案① 被两轮异构对抗证伪，改为方案①′「会话文件内按目标分桶」

方案①（复合键文件 `<sid>__<dirhash>`）按上文实现并让六套 fix-compliance 套件全绿后，两路异构对抗（fail-open 面 / 误伤面）各出 3–4 个 CRITICAL，
全部由受控 A/B（同一棵树只换受审文件，`git show HEAD:` 旧判定器对照）实跑成立：

| # | 发现 | 方向 | 处置 |
|---|---|---|---|
| A-C1 | `sha256` 前 8 位 = 32 bit 可离线碰撞（4.4 min），且 Tier 2 sidechain 标记 `candidatePath` 读侧零校验，`specs/<垃圾>/../302-fix-b` 撞 A 的键 | fail-open | 桶键改为**规范化的目录字面量**（`path.posix.normalize` + `FIX_DIR_NAME_REGEX`），标记读侧规范化 |
| A-C2 / B-C1 | 裸 sid 兜底文件由判定器自己产生（无提名轮次），legacy 回落让它成为每个目标的「万能捐赠者」：三轮裸 Stop 后 A/B/C 首次评估全 0 往返放行 | fail-open（残余，HEAD 同型） | 无目标轮次用 `__no-target__` 桶；**删除 legacy 回落**；改造前顶层计数不迁移（fail-closed 迁移） |
| B-C2 | 合规清零只清当前目标 + legacy，兄弟桶残留：B 合规后回到 A 首次评估 0 往返放行 | fail-open（**新回归**） | 单文件整份删除 = 全部目标桶清零 |
| B-C3 | 逐轮合法改名（光杆 `mv`）/ 复合 `git mv` 重编号（F256 重锚定）键逐轮漂移，8 轮零自愈 | 永久 fail-closed（方案③被否决的同型） | 桶键取**提名身份**（跨 F256 稳定）；核心 `resolveFeatureDirCandidate` 登记被跟随的改名事件 `renames[]`，桶沿改名链迁移（**不**沿候选历史——首版按候选历史迁移当场复现跨目标捐赠） |
| A-C3 | `inFlightDeferCount`（闸门二，会话属性）被按目标放大 N 倍，上界退化到闸门三 420 | fail-open | 留在会话顶层 |
| A-W2 / B-W6 | 审计事件 / report 看不到目标与桶键 | 可观测性 | 事件加 `targetDir` / `budgetKey`（schema 已加），`--mode report` 透传 |
| B-C4 / A-I5 | `targetDir` 取 `resolvedPath` 还是 `candidate.path` 零测试 | 承重开关 | 桶键 = `candidate.path` 优先、被判目录进 lineage；E5b 语料钉住 |

回归语料（`tests/fix-compliance-f291a-per-target.test.mjs`，10 例）：Tier 2 跨目标、无目标桶不捐赠、改造前文件不迁移、兄弟桶不残留、
同目标 8 轮自愈、逐轮 `mv` 改名 `[2,2,2,0]`、逐轮复合 `git mv` 重编号 `[2,2,2,0]`、推迟预算会话级、sidechain 非规范拼写折回、report / 审计字段。
方案①的「实测爆炸半径」一节（下方保留作历史）描述的 8 项失败在方案①′下不存在：状态文件与锁路径没变，锁 / 存储不可用用例无需改锚。

## F291b · stop_hook_active 第三佐证腿（裁决：**暂不实施** · 2026-09-14 · 可翻案）

> **裁决（主线程代用户判断）**：本轮不实施，也不进 M11 首批。三条理由分别对应下文「为何需要拍板」的三点：
> (1) 它反转 F270 P3 的既有裁决，属策略变更而非缺陷修复；(2) `stop_hook_active` 在 headless 环境下的取值语义**未实测**，
> 在未测前提上放松 fail-closed 门违反 F264「harness 字段行为须本机实测」纪律；(3) R-6 已有 `enforcement: warn` 逃生口，
> 本提案是便利性放松而非修 live 漏洞。**重开条件**：R-6 出现真实用户投诉（harness 不回灌反馈的环境阻断到底），
> 且先完成本机 + 至少一种 headless（`claude --print` / SDK）的 Stop payload 实录，确认 `stop_hook_active` 只在真实重入为 true。
> **数据点（2026-09-14，Claude Code 2.1.270，`claude --print --plugin-dir` 裸探针 + F245 spike 重跑）**：自然收口 `stop_hook_active=false`；被 `exit 2` 阻断后的重入为 `true`（判定器记 `stop-hook-reentry`）。`--print` 模式满足「只在真实重入为 true」；SDK 模式未测。前置条件之一已部分满足，裁决仍为暂不实施（另两条理由不变）。


F288 C-1 删掉「最早 fix 展开后 assistant entry ≥ 420」这条放行佐证腿（它落在被判方产出面：420 次工具调用即可 0 往返放行）。
删后残余 **R-6**：harness **不回灌** hook 反馈的环境（Codex 方言 / 某些 headless / SDK 懒刷盘）预算耗尽后**阻断到底**，
逃生口只有 `fix_compliance.enforcement: warn`。

**提案**：`预算耗尽 && payload.stop_hook_active === true ⟹ releaseCorroborated 成立`（harness 写、被判方不可伪造），且照常写终态。

**为何需要拍板、不自动做**：
1. **反转既有裁决**：F270 spec §244 明写「`stop_hook_active===true` 时判定器**不得再次产生阻断、必须放行**」，
   而实现**刻意做了相反**（重入只落 `stop-hook-reentry` 诊断、照常阻断）；`specs/270-.../verification/integrated-review.md:175`
   把「spec 说放行 / 实现阻断」登记为已知背离。本提案等于采纳当年被实现否决的那侧语义。
2. **放松 fail-closed 门**：`stop_hook_active` 的语义是「本次 Stop hook 是上一次 Stop hook 触发的重入」，
   **不严格等价于**「发生过一次真实阻断往返」；它在目标 headless 环境里是否只在真实重入为 true **未实测**
   （违反 F264「harness 字段行为须本机实测」纪律）。
3. **残余已有逃生口**：`enforcement: warn` 可用，故本提案是**便利性**放松而非修 live 漏洞。

**若批准的实施要点**：`releaseCorroborated` 增第三腿（仅在预算耗尽分支参与）；`routeBlockEnforcement` 从 payload 取值进 counts；
终态文案区分「重入佐证放行」；`stopHookReentry` 码语义从纯诊断升为可佐证。**前置**：本机 + 至少一种 headless
（`claude --print` / SDK）实录 Stop payload，确认 `stop_hook_active` 只在真实重入为 true、且 headless 下确会重入
（否则该腿在 headless 永不触发 = 白做）；红先行须含「payload 由 harness 写、被判方改不到」的通道确认。
