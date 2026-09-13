# F290 对抗审查 · 误伤面 / 回归覆盖真伪 / 时序稳定性 / 可验收性

> 审查基线：HEAD `eff3e42f`（对比 `5f34cf13`）。切入角：假设有问题、尝试证伪，聚焦误阻断/误报诚实用户、回归覆盖是否名实相符、锁竞态时序余量、SC 可机械验收性。
> 工作目录：`.claude/worktrees/f290-residuals`；实验全部在 scratchpad 内或对独立内存/临时目录跑，未 `git stash`/`checkout`/`add`/commit，worktree 保持只读。

## 0. 结论先行

**0 CRITICAL / 2 WARNING / 5 INFO。**

F290 的五项改动（doctor 闭包扩容、锁竞态确定性用例、enum 反向守卫、Tier 2 可观测性、resume fix 恢复）在**当前代码状态下没有发现会导致误阻断诚实用户、或让已声明的验收结论失实的问题**。两项 WARNING 都是"防线本身有可被绕过的缝隙"类发现（不是"现在已经错"），已用变异测试实证；五项 INFO 多数指向**前序 F289 遗留**、与本卡改动的语义正确性无关，或纯属文档措辞可以更精确。

---

## 1. 亲跑结果（Bash 实测，非转述）

全部命令加 `perl <scratch>/pt.pl 240 <cmd>` 等效 `timeout 240`；未跑全量 `vitest`。

| 套件 | 结果 | 备注 |
|---|---|---|
| `fix-compliance-card-a-diagnostics.test.mjs` | **21 pass / 0 fail** | 含新增 T0-U6 |
| `fix-compliance-card-b-lock-fingerprint.test.mjs` | **28 pass / 0 fail** | 含新增 T1-C6 / T-S2 |
| `fix-compliance-tier2-continuation.test.mjs` | **24 pass / 0 fail** | 含新增 E4 |
| `judge-snapshot-core.test.mjs` | 31 pass | |
| `judge-snapshot-doctor.test.mjs` | 17 pass | |
| `judge-snapshot-doctor-cli.test.mjs` | 39 pass | |
| `judge-file-set-guard.test.mjs` | 1 pass | |
| `sidechain-file-set-guard.test.mjs`（新） | 2 pass | |
| **judge-snapshot 三套件 + 双守卫合计** | **90 pass / 0 fail** | 31+17+39+1+2=90，**逐字匹配 fix-report §5 claim** |
| 全量 plugin 套件（`node scripts/run-plugin-tests.mjs`，43 文件） | **1945 tests / 1943 pass / 0 fail / 2 skipped** | 自然文件级并发，无 F290 相关红 |
| `npm run build` | exit 0，tsc 零错误 | F290 不触碰任何 `.ts`，此检查对本卡改动**近乎零区分力**（见 §5 caveat） |
| `npm run spec-driver:check:wrappers`（SC-005） | 全 7 项 `"status":"pass"`，`errors:[]` | 含 `codex-skill-wrapper-sha` 9 checked / 0 mismatch |

结论：fix-report §5 给出的量化数字（21/0、28/0、24/0、90/0、build 0）**全部逐一实测复核为真**，非转述。

---

## 2. 误伤面（(a)(b)(c)(d) 逐项）

### (a) `tier2BindingNotice` 三源文案准确性

`TIER2_SOURCE_LABEL`：
```js
resume:    'spec-driver-resume 展开 + fix 目录提名',
witness:   '本会话写入 fix-report.md 见证',
sidechain: '子代理 sidechain 内 fix 展开标记',
```
对照 `detectTier2Binding` 实际判据（`fix-compliance-judge.mjs:296-345`）逐源核实：
- **resume**：判据是"最早一次 resume 展开 + 提名事件存在"——label 准确。
- **witness**：判据是 `collectArtifactWriteWitnesses` 命中，其归一化正则 `ANCHORED_ARTIFACT_PATH_REGEX = /^(specs\/\d+-fix-[a-z0-9-]+)\/fix-report\.md$/`（`fix-compliance-core.mjs:1059`）**只认 `fix-report.md`**——label"本会话写入 fix-report.md 见证"与真实触发条件**逐字一致，未发现反例**。
  - **旁证（INFO，非 F290 引入）**：`detectTier2Binding` 自己的 JSDoc 表格（F289 遗留，`fix-compliance-judge.mjs` 函数注释表）写"(b) 写入见证 | Write / Edit / … `fix-report.md` **或** `verification/verification-report.md`"——但代码里只有一条正则、只认 `fix-report.md`，`verification-report.md` 从未参与 witness 判定。这条文档漂移**在 F290 之前就存在**（F290 未改 `detectTier2Binding` 本体），且 F290 新写的 label 恰好与**代码真实行为**一致（未被这条旧漂移带偏）。建议后续卡顺手订正该 JSDoc 表格，不影响本卡验收。
- **sidechain**：判据是子代理侧标记文件——label"子代理 sidechain 内 fix 展开标记"准确。
- **"implement 委派已豁免"表述**：核对 `judgeCompliance`（`fix-compliance-core.mjs:2052`）：`if (!tier2 && counts.implement < 1) missing.push('delegation:implement')`——`tier2` 参数**只影响这一处**判据，与文案逐字相符，无夸大也无遗漏。

**Tier 1 是否零出现该段**：`tier2Notice` 生成逻辑 `result.tier === 2 ? tier2BindingNotice(...) : null`，Tier 1 恒为 `null`。用真实 CLI 构造一个 Tier 1（真实 `spec-driver-fix` 展开）阻断场景实测 stderr：
```
[FIX-COMPLIANCE] 缺少 implement 类委派：...
诊断: in-flight-undetermined
```
`stderr.includes('识别为 fix 续做')` → `false`；`stderr.includes('见证')` → `false`。**实测证实 Tier 1 零出现**（既有测试 D1 未显式断言这一点，本次补了这个空子，见 §3 覆盖缺口记录）。

### (b) fail-open 事件 `tier` 三态取值——全状态空间实测

`tryAppendFailOpenEvent` 只在 `runHook` 的 `result.transcriptDiagnostics.length > 0` 分支被调用。用真实 CLI 逐一构造并落盘验证：

| 场景 | 触发路径 | 实测 `tier` |
|---|---|---|
| Tier 1 真实 fix 展开 + `mv` 到非规范名 + verify 委派 → `featureDirUnresolvable` fail-open | F224/F230 既有通道 | **`1`**（构造：`SKILL_EXPANSION_LINE` + Write + `mv` + Agent，事件 `diagnostics:["feature-dir-unresolvable","snapshot-stale"]`） |
| Tier 2（resume）+ 同构造 → `featureDirUnresolvable` fail-open | 即 E4 测试本体 | **`2`**（E4 已覆盖并通过） |
| 非 fix + 方言不识别（codex-rollout transcript） | `dialectCode` 非空分支，显式 `tier: null` | **`null`**（用仓内既有 fixture `real-bash-transcript-codex.jsonl` 实测，事件 `diagnostics:["transcript-format-unrecognized","dialect:codex-rollout","snapshot-stale"]`） |
| payload 非法 / 顶层异常兜底 | `main()` 两处 catch，调用 `tryAppendFailOpenEvent` 时**不传** `tier` 实参 | `undefined` → 默认参数收敛为 `null`（代码可推，未见与预期不符） |
| transcript 不可用 / 空 | `evaluate()` 提前 return，返回对象**没有** `tier` 字段 | 同上，`undefined→null` |
| 非 fix + Claude 方言 + 无 Tier2 提名（真健康路径） | `transcriptDiagnostics` 恰为 `[]` | **不会调用** `tryAppendFailOpenEvent`（US5 零落盘语义，非"tier:null 事件"而是"零事件"） |

**未发现误伤/误报**：三态划分与实现完全对应，`null` 语义统一为"层级未知/不适用"，没有把"不知道"误标成具体某一层。

**顺带发现（INFO，非 F290 引入、不影响本卡行为）**：`featureDirUnresolvable` 早退分支（`fix-compliance-judge.mjs:743`）硬编码 `isFix: true` 返回，但当 Tier 2 触发该分支时真实 `tier` 是 `2`——`isFix` 与 `tier` 在这唯一路径上语义不一致。核实其**唯一消费者**是 `runReport` 的 `fixSession` 字段（`--mode report` 展示用），`runHook` 从不读该字段（先看 `transcriptDiagnostics.length>0` 就已经短路返回）。即：这是一个**只影响诊断展示、不影响任何放行/阻断裁决**的既有字段（该分支本身是 F224/F230 遗留，F290 未碰这几行，只是新增的 `tier` 透传路过了它）。不构成 F290 的回归，登记但不建议在本卡内顺手修。

### (c) doctor 对当前已安装快照实测

本机确有真实安装：`~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.5.0`（旧于 F290，也旧于 F276-F289）。直接跑 `node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`：

```
文件明细（12）：
  [mismatch] scripts/fix-compliance-judge.mjs
  ...（5 处 mismatch，均因该快照早于 F276-F290 一系列改动，与本卡无关）
  [missingInSnapshot] scripts/lib/delegation-tool-names.mjs   ← F283 起加入 JUDGE_FILE_SET，非本卡新增
  [missingInSnapshot] scripts/lib/fix-compliance-sidechain-marker.mjs  ← 本卡新增到 DOCTOR_FILE_SET
汇总: 5 mismatch / 5 match / 2 missingInSnapshot
```
exit code = 0（确认 FR-009"drift 恒退出码 0"不受扩集影响，扩容没有意外把 doctor 变成门禁）。`missingInSnapshot` 是独立状态（不与 `mismatch`/`error` 混淆），新增的 sidechain 文件被正确、清晰地报告，**没有被误判成更严重的状态，也没有让整体 CLI 报错**。

**"added-since" 措辞精度核实**：spec K-2 说扩集会让旧快照"显示 `added-since`"，该词只在 `--since <ref>` 增量模式下出现。用两个不同 `--since` 值实测：
- `--since 5f34cf13`（F290 直接父提交，此时 `fix-compliance-sidechain-marker.mjs` 已存在于仓库多个提交）→ sidechain 一行标 **`[pre-existing]`**（基线也是 `missingInSnapshot`，前后状态未变）。
- `--since c63d44ba`（F289 之前）→ sidechain 一行标 **`[added-since]`（基线 missingBoth → 当前 missingInSnapshot，该 ref 下不存在）**，与 K-2 描述逐字对应。

即 K-2 的"显示 added-since"**只在 `--since` 早于该文件被创建的提交时成立**；本次也验证了另一个更接近的 `--since` 值下会显示 `pre-existing`（同样是预期内、非误报的行为，只是标签不同）。K-2 描述本身没有错，但没写清楚这个前提——**INFO 级别，不算 over-claim**（因为它确实存在至少一个真实的 `--since` 取值让"added-since"成立，只是不是所有取值都是）。

**发现（WARNING）**：`judge-snapshot-doctor.mjs` 顶部文件头注释（第 6 行）：
```js
* 比对仓库侧与已安装快照侧的判定器文件（集合以 JUDGE_FILE_SET 的枚举为准），产出四态结果。
```
F290 把实际比对集合改成了 `DOCTOR_FILE_SET`（本文件下方 `import` 与 `checkJudgeSnapshotDrift` 函数体均已改），但这行文件头总览注释**没有同步更新**，现在是**事实性错误**（仍写"以 JUDGE_FILE_SET 的枚举为准"）。本仓库对"如实登记"/注释准确性要求很高，这是一行可当场改掉的小缺陷，建议在合入前顺手订正为 `DOCTOR_FILE_SET`。（`judge-snapshot-doctor.test.mjs` 里 `writeJudgeFiles` 函数上方注释"写入 JUDGE_FILE_SET **8** 个文件"同样是更早就有的过时计数，非本卡引入，一并提及但不单独计分。）

### (d) resume 恢复表 fix 分支准确性

- **Phase 编号/名称**：对照 `spec-driver-fix/SKILL.md` 实际标题 `### Phase 1: 问题诊断 [1/4]` / `Phase 2: 修复规划` / `Phase 3: 代码修复` / `Phase 4: 验证闭环`——resume 表四行的中文名与编号**逐字匹配**，未发现命名或编号错位。
- **"含 Root Cause 节"判据是否有机械依据**：核实 `fix-compliance-core.mjs:319`：`export const ROOT_CAUSE_HEADING_REGEX = /Root Cause/i;`——判定器自身用这条正则（大小写不敏感，且按 F216 C4 排除 fenced code block 内的示例文本）判断诊断是否闭合，`spec-driver-fix/SKILL.md` 模板本身也确实写 `**Root Cause**: {...}`（非"根因追溯"字样）。即该恢复表判据**对应一个真实存在、精确定义的既有机械判据**，不是凭空的自然语言目测标准。
- **"plan.md 存在 + 代码变更存在"是否有机械判据**：`resume` SKILL.md 全文未见对"代码变更存在"给出具体命令（如 `git diff`）。但该措辞**并非本卡新造**——同一文件第 311 行（feature/implement 模式既有表）已用完全相同的短语："`tasks.md + 代码变更存在 → 从 verify (Phase 7) 恢复`"。即：这是全文档统一沿用的既有惯例式表述（本身是给 LLM 编排器读的自然语言判据，非确定性代码），**F290 没有让它变得更模糊，只是照抄了已被接受的写法**。如果认为这条判据不够精确，是全表通病，不是本卡引入的新缺陷。

---

## 3. 回归覆盖真伪

### 3.1 T1-C6（锁竞态确定性用例）—— 两组独立变异测试，均在 scratchpad 隔离进行，未碰 worktree

**方法**：复制 `plugins/spec-driver/scripts` 整树到 scratchpad 两份独立副本，分别做变异，另写一个精简版 harness（逐字复刻 T1-C6 的 A/B 双进程时序：A 读到陈旧锁后延迟 150ms、B 立即接管并持锁 300ms），指向变异后的 `fix-compliance-io.mjs` 跑，不改变、不触碰真实 worktree 文件。

**变异 1（证伪"裸 unlink 也能过"）**：把 B-W1 身份核对+rename 回退逻辑，替换成 fix-report 自己描述的"裸 unlink 接管"（`fs.unlinkSync(lockPath)`，不做任何身份核对）：
```
mutant run 1: final blockCount: 1
mutant run 2: final blockCount: 1
mutant run 3: final blockCount: 1
```
3/3 复现 `blockCount=1`（丢更新），与 fix-report §3 变异清单 M1-c 的预期结论**完全吻合**——证实 T1-C6 的 `assert.equal(..., 2, ...)` 在这条回归下**会真实变红**，不是摆设。（对照组：同一 harness 指向未变异的真实 `fix-compliance-io.mjs`，稳定输出 `2`。）

**变异 2（证伪"测试其实是靠 unreadableButRecent 兜底通过的"）**：在另一份独立副本里把 `unreadableButRecent` 强制改为 `false`（切断这条兜底通路），其余逻辑（含真正的身份核对修复）不变：
```
run 1/2/3: final blockCount: 2
```
3/3 仍然是 `2`——证实 T1-C6 的通过**不依赖** `unreadableButRecent` 分支，是身份核对+rename 回退这条主逻辑本身在起作用。

结论：**T1-C6 是名副其实的回归测试**，既能在身份核对被削弱时变红，通过与否也不依赖旁路兜底。

**时序余量核实**（见 §4 单独一节）：15+ 次实测（含极端双开满载）从未观测到 `lockUnavailable:true` 或 `blockCount≠2`，`150ms` 延迟 + `300ms` 持锁 + `480ms` 重试预算之间有约 260-330ms 的裕量，实测环境下未见被吃穿。

### 3.2 T0-U6（enum → 产出点反向守卫）—— 发现两处名实缝隙（WARNING）

复刻测试内 `producedBy` 三形态判定逻辑单独跑（不改动、不影响真实测试文件），对**当前 20+ 个诊断码**全量分类，结果与 fix-report 描述完全一致（`LEDGER_DIAGNOSTICS` 全走③常量别名、`IN_FLIGHT_DIAGNOSTICS`/`FOREIGN_DIALECT_DIAGNOSTICS` 全走②动态下标、其余全走①`表.键`）。**当前没有任何码处于"零产出"的真实错误状态**——但对**守卫本身的判别力**做了两组变异，发现：

**缺口 1（①"表.键"字符串计数不分代码/注释）**：
```
baseline real occurrences of "STATE_STORAGE_DIAGNOSTICS.lockTakenOver": 2
after removing BOTH real code occurrences (genuine dead producer): 0   → 守卫正确变红（好）
after ALSO leaving a stale comment mentioning the same identifier: 1   → 守卫又变绿（坏：假阴性）
```
即：若未来有人把 `STATE_STORAGE_DIAGNOSTICS.lockTakenOver` 的**真实调用点**删掉，但残留一条提到同一字符串的注释（哪怕只是"2027-01 重构：不再用 XXX，改裸字面量"这种变更说明），T0-U6 **不会** 察觉该码已经零产出——因为 `count()` 只做无差别子串计数，不区分代码语义位置与注释。

**缺口 2（②"表\["动态下标是表级而非键级证据）**：
```
real occurrences of "IN_FLIGHT_DIAGNOSTICS[": 4
after removing ONLY the NO_IN_FLIGHT key's own production site: 3   → 仍 ≥1，守卫认为该码仍"有产出"（坏：假阴性）
```
即：`IN_FLIGHT_DIAGNOSTICS` 表内任一 key 的动态下标产出被删掉，只要**同表其余 key** 还在用 `IN_FLIGHT_DIAGNOSTICS[...]` 语法（哪怕是完全不同的 key），该表下所有 key 都会被判"有产出"——形态②对多 key 表**没有 key 级别的区分力**，只证明"这张表被动态访问过"，不证明"这个码被动态访问过"。

**严重度判断**：两处都是**潜在漏判**（假阴性：真实回归本该报红却没报红），而不是**误伤**（不会让诚实开发者被无端拦下）——因此按误伤面标准不构成阻断项，但直接命中"回归覆盖真伪"："这条守卫将来能不能真的兜住它自称要防的回归"这一问题的答案是**不完全能**，需要如实登记为**WARNING**，不建议在 CRITICAL 里报（当前无实际受害码），但也不应算"未发现问题"。 spec 自己的 K-3 只登记了"出现第四种产出形态会误报（fail-loud，可接受）"这个方向；本次发现的是**相反方向**（既有两种形态各自存在假阴性缝隙），K-3 未覆盖这个方向，建议后续在残留卡里把 comment-strip（参考 T-S2 已经在用的 `.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'')`）与"计数与具体 key 关联"两点一并加固。

---

## 4. 时序稳定性（T1-C6，累计 15+ 次运行）

| 条件 | 次数 | 结果 | 耗时范围 |
|---|---|---|---|
| 单独跑，无额外负载 | 5 | 5/5 pass | 340-350ms |
| 36 个 `yes` 忙循环压满 18 核（load avg 峰值 ~23） | 5 | 5/5 pass | 336-348ms |
| 嵌入全量 43 文件 / 1945 用例并发跑（自然文件级并发） | 1 | pass | 342.7ms |
| **两个完整 43 文件套件同时并发跑（自造极端过载）** | 2（各 1 次）| **2/2 pass** | 367ms / 362ms |

**未观测到 T1-C6 flake。** 计算余量：A 总预算 ≈ 150ms 延迟 + 480ms 重试（60×8ms）= 630ms；B 持锁 300ms；实测总耗时稳定在 335-370ms，距 630ms 硬上限还有 ~260-330ms 裕量，即便在人为制造的双开极端过载下也未见吃紧迹象——`Atomics.wait` 是真实内核睡眠，不参与 CPU 抢占，这是余量稳定的主因。

**旁证发现（INFO，非 F290 范围）**：双开极端过载场景下，其中一次运行触发了一个**与 F290 无关的既有 F288 测试**（`T2-E10`）失败（`actual:1, expected:0` 断言错误）。核实其 `stageRoot()` 用 `fs.mkdtempSync` 生成随机基础目录，排除了路径碰撞可能，判断是该测试自身在"同一 worktree 的完整测试套件对自己跑两份"这种非常规、非 CI 会出现的构造场景下的时序敏感度问题，与 F290 的改动（T1-C6/T-S2/其余四项）**无关**，也不在 F290 spec/fix-report 的任何验收范围内。如实记录，不计入本卡的三档计数。

---

## 5. 可验收性——SC-001~006 逐条机械命令 + 实测值

| SC | 命令 | 实测 |
|---|---|---|
| SC-001 长度/顺序/双守卫/三套件 | `node --test plugins/spec-driver/tests/{judge-snapshot-core,judge-snapshot-doctor,judge-snapshot-doctor-cli,judge-file-set-guard,sidechain-file-set-guard}.test.mjs` | 90/0（§1）；`DOCTOR_FILE_SET.length===12`、`[0]===JUDGE_FILE_SET[0]`、含 sidechain CLI，均由 `judge-snapshot-core.test.mjs` 新增用例钉死并通过 |
| SC-002 T1-C6 确定性 | `node --test plugins/spec-driver/tests/fix-compliance-card-b-lock-fingerprint.test.mjs`（正确代码）+ scratchpad 变异 harness（裸 unlink） | 正确代码终态 2（15+ 次 100% 复现）；变异后终态 1（3/3 复现）——见 §3.1 |
| SC-003 T0-U6 | `node --test plugins/spec-driver/tests/fix-compliance-card-a-diagnostics.test.mjs` + scratchpad 语料变异 | 当前全部有产出点或在 allowlist（21/0）；但 §3.2 指出该守卫本身对**未来**回归有两处假阴性缝隙，SC-003 字面"当前"达成，守卫的**长期可靠性**需 WARNING 登记 |
| SC-004 Tier 2 可观测性 | `node --test plugins/spec-driver/tests/fix-compliance-tier2-continuation.test.mjs`（E4）+ 本次手工构造的 Tier1/非fix fail-open 脚本 | stderr 含"识别为 fix 续做"+源标签+目录（E4 通过）；fail-open 事件 `tier` 三态全部实测核验（§2(b)）；judge-cli/card-a/card-b/tier2 零翻转（21/0、28/0、24/0，判定器改动前后无未预期红） |
| SC-005 wrapper sha 一致 | `npm run spec-driver:check:wrappers` | 全 7 项 pass，`errors:[]`（§1） |
| SC-006 异构对抗 ×2 角 + verify | （本文档即为其中一个角度：误伤面/回归覆盖真伪/时序稳定性/可验收性） | **该 SC 本质是流程级门槛，不由单份报告独立满足**——需另一角度（`review-bypass.md`，已在 verification/ 目录下发现，覆盖绕过面）与 verify 子代理共同收口；就本文档覆盖的四个切入角而言：0 CRITICAL |

**"build 0"claim 的适用性 caveat**：`npm run build` 只跑 `tsc` 编译 `src/` 下的 TypeScript CLI，F290 的全部改动都在 `plugins/spec-driver/**/*.mjs` 与 `*.md`，不在 `tsc` 的编译范围内——这条检查对本卡改动本身**没有实际区分力**（改坏 F290 代码不会让 `npm run build` 变红）。fix-report 引用它作为"验证结果"之一没有算错（确实是 0 错误），但读者不应误以为它验证了 F290 的正确性，真正的验证力来自 vitest/node --test 那几行。

---

## 6. over-claim 检查（fix-report §2 / §4 逐条）

§2（修复描述）：
- "doctor roster 改用 union；新增 sidechain-file-set-guard（闭包相等）"——**核实为真**（§1、§2(c)）。
- "judge-snapshot 三套件长度钉改引 DOCTOR_FILE_SET"——**核实为真**（diff 逐处核对，见正文引用）。
- "T1-C6：… ⟹ 终态 2、丢更新 0（裸 unlink 接管会删掉 B 的活锁 ⟹ 终态 1）"——**核实为真，且已用独立变异测试正向证实两个分支**（§3.1）。
- "T0-U6 三产出形态…"——**核实为真**（分类结果与 fix-report 描述逐一对应），但**未提及**这两种形态各自存在假阴性缝隙——**不算错误陈述**（fix-report 没有声称"守卫无死角"），但也不完整，已在 §3.2 补齐。
- "Tier 2 可观测性…走既有 noticeLine 渲染点，可见诊断码集合不变（T0-U5 不动）"——**核实为真**：`JUDGE_DIAGNOSTICS` 仍是 20 键，F290 未新增任何诊断码，只新增了两个人读文案常量（非诊断码）。
- "resume fix 恢复：…verify 仍须经 Task 委派"——**核实为真**：`judgeCompliance` 的 `tier2` 只豁免 `delegation:implement`，`delegation:verify` 判据不受影响。

§4（如实登记）：
- "trace 钩子…零行为靠「未设环境变量」+ 5s 上限"——**核实为真**（`Number(undefined)=NaN`，`Number.isFinite` 判假直接跳过）。
- "DOCTOR_FILE_SET 扩集后已安装旧快照显示 added-since"——**基本为真，但有前提**（需要 `--since` 早于该文件被创建的提交；用当前最常见的"上一个提交"反而显示 `pre-existing`）——已在 §2(c) 用两组实测厘清，不算 over-claim，建议措辞加一句"取决于 --since 的窗口"。
- "T0-U6 三形态是对现状枚举…第四种产出形态会误报零产出（fail-loud，可接受）"——**核实为真，且方向判断正确**（新形态未识别 → 误报，不是漏报），但 K-3 只登记了"新形态"这一个残余面，**未登记"既有形态内部的假阴性缝隙"这一个方向**（§3.2 两处）——建议本卡或后续卡补登记。
- 其余两条（shell 薄壳不进比对 / per-target 预算与 stop_hook_active 移交 F291）——**核实为真**，未找到反例。

**总体**：fix-report 没有发现方向性错误或夸大声称；主要缺口是**两处已实证的守卫假阴性缝隙未被登记**（K-3 只写了对称的另一半），以及一行过时的文件头注释。

---

## 7. 三档计数与处置建议

- **CRITICAL：0**
- **WARNING：2**
  1. `judge-snapshot-doctor.mjs` 第 6 行文件头注释仍写"以 JUDGE_FILE_SET 的枚举为准"，与 F290 实际改为 `DOCTOR_FILE_SET` 的比对逻辑不符——建议合入前一行改掉（`judge-snapshot-doctor.test.mjs` 内一处过时的"8 个文件"注释可顺手一并订正，非本卡引入但同类）。
  2. T0-U6 反向守卫存在两处已用变异测试证实的假阴性缝隙（①注释可让"删掉真实调用"误判为仍有产出；②同表内任一 key 的动态下标用法可以给该表全部 key "顶包"）——**当前无实际受害码**，不阻断本卡合入，但建议在 fix-report §4 补一条如实登记（呼应 K-3 但方向相反），并作为后续小卡跟进（加注释剥离 + key 级别关联）。
- **INFO：5**
  1. `detectTier2Binding` 的 JSDoc 表格（F289 遗留）声称 witness 源也认 `verification-report.md`，与实际正则不符；F290 新写的 label 文本未受影响（仍准确），仅供后续订正参考。
  2. `featureDirUnresolvable` 早退分支硬编码 `isFix:true`，当 `tier===2` 时与其语义不完全一致；已确认唯一消费者是 report 模式展示字段，不影响任何放行/阻断裁决，且该分支非 F290 改动范围。
  3. resume 表"代码变更存在"判据无字面机械检查命令，但与既有 feature 表（第 311 行）用词完全一致，非 F290 引入的新模糊点。
  4. Tier 1 fail-open 场景下 `tier:1` 目前没有像 E4 那样的专门断言测试（本次由审查方手工构造脚本补充验证，行为正确），建议后续给对称场景也钉一条测试。
  5. 一次人为构造的"同一 worktree 完整套件自我双开"极端压力测试触发了无关的既有 F288 测试 `T2-E10` 偶发失败，与 F290 无关、不在其验收范围内，如实记录。

**结论**：F290 五项改动在误伤面、回归覆盖真伪、时序稳定性、可验收性四个切入角下均**站得住**，可在处理完 2 项 WARNING（均为轻量修复：一行注释 + 一条如实登记，不涉及行为改动）后进入下一步（另一异构角度 + verify 子代理收口）。
