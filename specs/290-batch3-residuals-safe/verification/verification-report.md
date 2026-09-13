# F290 · verify 子代理独立核验报告

> 核验对象：HEAD `387a9635`（已含两轮异构对抗处置：绕过面 `review-bypass.md` 基线 `eff3e42f` / 误伤面 `review-misblock.md` 基线 `eff3e42f`）。
> 方法：先等主线程门禁标记，再亲读 spec/plan/fix-report/两份 review + 全量 diff，再对 fix-report §5 数字逐一实测，
> 再对两轮 CRITICAL 的修复逐个做变异复现（本次重点），再独立找新缝隙，再抽查误伤面，再核 SC-001~006，最后做 over-claim 检查。
> 变异方法：全部在 scratchpad 的 `plugins/spec-driver`（+`specs/208-fix-mode-process-compliance` 相对路径依赖）整树拷贝上进行
> （`f290-verify-work/repo/`），每次变异前 `cp` 备份、变异后跑对应套件、`cp` 还原、`diff` 确认逐字节一致。worktree 全程未改动
> （`git status --short` 全程空、HEAD 全程 `387a9635`），未使用 `git stash`/`git checkout <path>`/`git add`/commit/push。

## 0. 结论摘要

**CRITICAL 2 / WARNING 3 / INFO 4**（本轮 verify 新发现，不含已被两轮对抗审查发现且已修复的历史项）。

**两轮 CRITICAL 是否真修好：PASS**——fix-report §3/§6 声称的两个 CRITICAL（trace 延迟钩子 5s 上限无回归覆盖 / allowlist 陈旧检测对当前两码是死代码）及其配套 WARNING（tier2 文案零消毒 / T0-U6 两处假阴性缝隙），本次逐一变异复现，**全部**在当前代码上正确变红，计数与 fix-report 声称逐字吻合（27/1、20/1、24/1）。

但本轮 verify **独立**发现 2 项与原 CRITICAL **同一性质**（"声称有安全网、实测没有"）的**新**缺口，均已用零技巧的直接构造实测确认（详见 §4）：T0-U6 的"剥注释"只剥独立整行注释、不剥行尾注释；T0-U6 形态③"别名引用 ≥2 次"不要求任何一次引用是真实产出调用。这两项不影响"两轮 CRITICAL 已修好"这一事实判断（它们是**新**发现，不是回归），但说明 FR-003 反向守卫的假阴性面尚未收敛完。

## 1. 门禁标记（主线程，如实转述）

等待 `f290-gate.done`，约 1 分钟后出现（未超时）。`f290-gate.log` 内容：

| 项 | 结果 |
|---|---|
| build | pass（`[postbuild:stamp] 盖章: commit=387a9635`，与 HEAD 一致）|
| test:plugins | pass 1944 / fail 0 |
| vitest | Test Files 556 passed \| 4 skipped (560)；Tests 8248 passed \| 15 skipped \| 12 todo (8275) |
| repo:check | status=warn |
| release:check | 合同校验通过；`[publish-gap]` 警告：npm registry 返回体缺 `gitHead`，领先量无法判定（与 F290 代码改动无关，发布环境既有信号）|
| wrappers | claude-project-overrides: pass；plugin-metadata-sync: pass |

`repo:check warn` 明细（本次另跑 `npm run repo:check` 核实）：唯一 warn 是 `graph-quality:freshness`——"图产物已 stale（source-commit 与当前 HEAD 不一致）"，其余全部 pass，含 `gate-mounting`/`orchestrator-model`/`namespace-consistency`/`graph-quality` 其余五项等。此 warn 属预期（F290 未跑 `spectra batch` 重建图，fix-report §7 亦如实登记"本 worktree 图 stale"），非本卡逻辑缺陷。

## 2. 亲跑结果（必做 1）—— fix-report §5 数字逐一核对

全部命令用 `perl pt.pl 240 <cmd>`（`alarm()` 实现的 `timeout 240` 等价物，macOS 无 GNU timeout）；未跑全量 vitest（门禁已跑）。

| 套件 | 命令 | 实测 | fix-report §5 声称 |
|---|---|---|---|
| card-a | `node --test tests/fix-compliance-card-a-diagnostics.test.mjs` | **21 pass / 0 fail** | 21/0 ✅ |
| card-b | `node --test tests/fix-compliance-card-b-lock-fingerprint.test.mjs` | **28 pass / 0 fail** | 28/0 ✅ |
| tier2 | `node --test tests/fix-compliance-tier2-continuation.test.mjs` | **25 pass / 0 fail** | 25/0 ✅ |
| judge-snapshot-core | `node --test tests/judge-snapshot-core.test.mjs` | 31 pass / 0 fail | — |
| judge-snapshot-doctor | `node --test tests/judge-snapshot-doctor.test.mjs` | 17 pass / 0 fail | — |
| judge-snapshot-doctor-cli | `node --test tests/judge-snapshot-doctor-cli.test.mjs` | 39 pass / 0 fail | — |
| judge-file-set-guard | `node --test tests/judge-file-set-guard.test.mjs` | 1 pass / 0 fail | — |
| sidechain-file-set-guard（新） | `node --test tests/sidechain-file-set-guard.test.mjs` | 2 pass / 0 fail | — |
| **judge-snapshot 三套件+双守卫合计** | 31+17+39+1+2 | **= 90 / 0 fail** | **90/0 ✅（五个被加数逐一核对：core 31 / doctor 17 / doctor-cli 39 / judge-file-set-guard 1 / sidechain-guard 2，与 §5 口径逐字一致）** |
| judge-cli | `node --test tests/fix-compliance-judge-cli.test.mjs` | 227 tests / 225 pass / 0 fail / 2 skipped | — |
| core | `node --test tests/fix-compliance-core.test.mjs` | 604 pass / 0 fail | — |
| io | `node --test tests/fix-compliance-io.test.mjs` | 75 pass / 0 fail | — |
| ledger-reader | `node --test tests/ledger-reader.test.mjs` | 22 pass / 0 fail | — |
| ledger-writer | `node --test tests/ledger-writer.test.mjs` | 23 pass / 0 fail | — |
| **judge-cli+core+io+ledger 合计** | 225+604+75+22+23 | **= 949** | **任务书要求核对的"949"——该数字未在 fix-report 原文字面出现，是这五个套件 pass 计数之和；实测精确复现为 949，视为该反向推导下的真值校验，成立** |

**"0 fail" 结论全部属实**。全部数字逐一核对为真，唯一需要澄清的是 "949" 不是 fix-report 原文引用，而是任务书要求的可推导合成计数（已如实标注、非文过饰非）。

**顺带核实（超出必做但影响后续判断）**：`npm run test:plugins`（43 文件全量）实测 **1946 tests / 1944 pass / 0 fail / 2 skipped**，而 fix-report §5 写"1945 tests"——见 §7 WARNING-2（原因：该数字是round 1（`eff3e42f`）的旧测量值，round 2 新增 E5 后总数 +1 未同步更新；不影响"0 fail"结论）。

## 3. 两轮 CRITICAL 复核（必做 2，本次重点）—— 7 个变异逐一复现

方法：scratchpad 整树拷贝上单点变异 → 跑对应套件 → 记录 → `cp` 还原 → `diff` 确认逐字节一致 → 重跑确认恢复零失败。

| # | 变异 | 命中套件 | 实测结果 | 断言消息 | 判定 |
|---|---|---|---|---|---|
| (a) | 去 `Math.min(traceDelay, LOCK_TRACE_DELAY_MAX_MS)` 上限，改 `sleepSync(traceDelay)` | card-b T-S2 | **27 pass / 1 fail** | "睡眠必须经上限常量夹取" | ✅ 应红实测红 |
| (b) | 去 `traceApplied` 一次性闭锁（保留上限） | card-b T-S2 | **27 pass / 1 fail** | "trace 延迟须每次 acquireStateLock 仅生效一次" | ✅ 应红实测红 |
| (c) | 给 allowlist 码 `parse-timeout` 加真实产出点（新文件 `export const X='parse-timeout'` + 2 次引用） | card-a T0-U6 | **20 pass / 1 fail** | "parse-timeout 已在源码出现字面量产出点（1 处），allowlist 陈旧须删" | ✅ 应红实测红 |
| (d) | 删 `STATE_STORAGE_DIAGNOSTICS.lockTakenOver` 真实产出点（io.mjs 唯一产出行），只留一条**行首**变更说明注释提及同一标识符 | card-a T0-U6 | **20 pass / 1 fail** | "state-lock-taken-over（STATE_STORAGE_DIAGNOSTICS.lockTakenOver）零产出点且不在 allowlist" | ✅ 应红实测红（剥注释生效） |
| (e) | 删 `IN_FLIGHT_DIAGNOSTICS[IN_FLIGHT_STATES.NO_IN_FLIGHT]` 唯一产出点（in-flight-verdict.mjs），保留同表其余 2 个 key 的动态下标产出 | card-a T0-U6 | **20 pass / 1 fail** | "in-flight-none（IN_FLIGHT_DIAGNOSTICS.no-in-flight）零产出点且不在 allowlist" | ✅ 应红实测红（key 级生效，未被同表其他 key 顶包） |
| (f) | 去 `tier2BindingNotice` 里的 `renderPathSegment(candidatePath)`，还原为裸拼接 | tier2 E5 | **24 pass / 1 fail** | 断言内容为含真实换行的伪造文案原样输出（"文案不得含真实换行"） | ✅ 应红实测红 |
| (g) | 撤 `identityOk` 核对，rename+身份核对+回退整段改裸 `fs.unlinkSync(lockPath)` 接管 | card-b T1-C6 | **27 pass / 1 fail** | "身份核对必须防止 A 删掉 B 的活锁：丢更新 = 0"（实测 `1 !== 2`，终态确为 1）| ✅ 应红实测红 |

**每次变异后**均执行 `diff <备份> <变异后还原>` 确认逐字节一致，并重跑对应套件确认恢复到 0 fail（均已确认，详见操作记录；本报告不逐条贴还原日志，结论：**7/7 全部还原干净**）。

补充复现（超出必做 7 项，用于交叉验证 fix-report §3/§6 其余可证伪断言）：

| 补充变异 | 命中 | 实测 | 备注 |
|---|---|---|---|
| 从 allowlist 删除 `parse-timeout`（M-b-1 方向） | card-a T0-U6 | 20/1，"已入 schema enum 但不在任何码表且不在 allowlist" | 与 fix-report 一致 |
| M-c-1：`DOCTOR_FILE_SET` 定义本身改回 `JUDGE_FILE_SET` 别名 | sidechain-guard 1/2 fail + core.test 30/1 fail；**doctor.test.mjs 17/17 全绿**（未受影响） | 与 fix-report §3 订正后条目（W-3 处置）逐字吻合 |
| M-d：`tier2Notice` 强制置 null（不下传） | tier2 | **24 pass / 1 fail**（非 fix-report §3 写的 "23/1"）| 见 §7 WARNING-3：round 2 加 E5 后总数由 24→25，§3 的 23/1 是 round 1 遗留旧值未同步 |
| M-e：`tryAppendFailOpenEvent` 省略第 6 参 `tier` | tier2 | **24 pass / 1 fail**（非 "23/1"）| 同上，同一处 staleness |

## 4. 独立找新缝隙（必做 3）—— 发现 2 项新 CRITICAL

### 4.1 CRITICAL-新1：`stripComments` 只剥独立整行注释，不剥行尾注释

`plugins/spec-driver/tests/fix-compliance-card-a-diagnostics.test.mjs` 的剥注释实现：
```js
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
```
第二段正则 `^\s*\/\/.*$` 要求 `//` 前只能有空白——即只剥"**整行都是注释**"的行，对**行尾**（同行先有真代码、后跟 `// 说明`）的 `//` 注释**完全不生效**（正则 `^\s*` 无法越过前面的真代码字符匹配到行首）。

**实测 1（TABLE_LEVEL_ONLY 形态）**：把 `fix-compliance-judge.mjs` 里 `FOREIGN_DIALECT_DIAGNOSTICS` 唯一产出点
```js
const dialectCode = dialect === 'codex-rollout' ? 'dialect:codex-rollout' : null; // 变异：去掉唯一的 FOREIGN_DIALECT_DIAGNOSTICS[dialect] 产出点
```
（真实产出点已删，仅剩**行尾**注释提及同一子串）——card-a **21/21 全绿**，T0-U6 未察觉。对照组：把同一段注释挪到独立一行（非行尾）——**立即 20/1 变红**（见下 4.1 对照）。

**实测 2（form① `表.键` 形态，直接对照 §3 已验证的 (d)）**：把 `fix-compliance-io.mjs` 里
```js
if (!diagnostics.includes(STATE_STORAGE_DIAGNOSTICS.lockTakenOver)) diagnostics.push(STATE_STORAGE_DIAGNOSTICS.lockTakenOver);
```
改为
```js
if (!diagnostics.includes('state-lock-taken-over')) diagnostics.push('state-lock-taken-over'); // 不再用 STATE_STORAGE_DIAGNOSTICS.lockTakenOver 是因为...
```
（真实产出点已删，仅剩**行尾**注释）——card-a **21/21 全绿**。而 §3 的 (d) 变异（同样的删除，但注释是**独立一行**放在代码**上方**）会正确变红（20/1，见 §3）。两者唯一差异是注释是否与代码同行，结果从"应红"变成"绿"。

**结论**：这不是"新形态未覆盖"（K-3 已预期的方向），而是**已声称修复的 W-2 缺口 1（"计数前剥注释"）本身留了一个后门**——只要把变更说明写成行尾注释（这是本仓库自身代码里大量存在的写法，例如 io.mjs 原文里 `diagnostics.push(LEDGER_CORRUPT_ENTRY); // 同 id 不同内容：可疑，落诊断` 就是行尾注释），删掉真实产出点后顺手留一句行尾说明，T0-U6 不会报警。**该剥离逻辑对 corpus 是全局共享的（三种形态都读同一份 `corpus` 变量），因此三种形态理论上同等暴露**——本报告对形态①和 TABLE_LEVEL_ONLY 形态做了实测确认，形态③因与 4.2 共用同一 corpus 未单独重复实测，但代码路径分析确认无形态专属的例外处理。

**对照组（证明是行位置而非剥离机制整体失效）**：
```js
// 变更说明：不再直接引用 STATE_STORAGE_DIAGNOSTICS.lockTakenOver，已改用裸字面量
if (!diagnostics.includes('state-lock-taken-over')) diagnostics.push('state-lock-taken-over');
```
——独立一行注释放在代码**上方** ⟹ **20/1 正确变红**（即 §3 的 (d)）。两次变异删除的产出代码完全相同，唯一变量是注释的物理位置（行尾 vs 独立行），结果一红一绿。

### 4.2 CRITICAL-新2：形态③"别名引用 ≥2 次"不要求任何一次引用是真实产出调用

`producedBy` 对形态③的判据：
```js
const alias = corpus.match(new RegExp(`export const (\\w+) = '${escapeRe(code)}'`));
if (alias && (corpus.match(new RegExp(`\\b${alias[1]}\\b`, 'g')) || []).length >= 2) return `常量 ${alias[1]}`;
```
只统计标识符**出现次数** ≥2，不区分这些出现是"真实 push/emit 调用"还是"纯声明性引用"（定义本身、注册进查找表等）。

**实测（零注释技巧，纯结构缺陷）**：`LEDGER_CORRUPT_ENTRY`（值 `'ledger-entry-conflict'`，fix-report 自称 "LEDGER_DIAGNOSTICS 全走③常量别名"）原有 4 次引用：① 定义 `export const LEDGER_CORRUPT_ENTRY = '...'`；② 表映射 `corruptEntry: LEDGER_CORRUPT_ENTRY`；③④ 真实业务逻辑里的 `!diagnostics.includes(...)` 与 `diagnostics.push(...)`（唯一真实产出点，位于 `ledger-reader.mjs`）。把 ③④ 整段替换为无 `LEDGER_CORRUPT_ENTRY` 引用的等价逻辑（该诊断码永久不会再被 push），只保留 ①②：
- `card-a T0-U6`：**21/21 全绿**（`\bLEDGER_CORRUPT_ENTRY\b` 仍计 2 次：定义 + 表映射，满足"≥2"阈值，`producedBy` 判定"有产出"）。
- 对照：`ledger-reader.test.mjs`（该文件自身的功能测试）**正确检测到回归**（22 tests → 21 pass / 1 fail）。

**结论**：T0-U6 对形态③给出的"产出点担保"是**虚假**的——一个诊断码即使被永久性地从所有真实 push/emit 逻辑中移除，只要保留其定义和"登记进某个查找表"这两处纯声明性引用，T0-U6 依然判定"已产出"。这不需要任何注释诡计，是**纯粹的正常代码删除**就能触发的假阴性，且**受影响面 = 整个 LEDGER_DIAGNOSTICS 表**（该表全部诊断码按 fix-report 自陈均走形态③）。该回归**确实被 `ledger-reader.test.mjs` 自身的功能测试捕获**（说明整体测试矩阵并非对此类回归零覆盖），但 T0-U6 本身作为"enum→产出点反向守卫"未能履行其在 spec FR-003 里承诺的职责。

### 4.3 K-4 / `FOREIGN_DIALECT_DIAGNOSTICS` 表级残余：如实覆盖，且当前不可利用（澄清性发现，非缺陷）

清空该表唯一产出点（不留任何注释）：`FOREIGN_DIALECT_DIAGNOSTICS[dialect]` → 裸字面量 `'dialect:codex-rollout'`，**T0-U6 正确变红**（20/1，"dialect:codex-rollout（FOREIGN_DIALECT_DIAGNOSTICS.codex-rollout）零产出点且不在 allowlist"）。

原因：`FOREIGN_DIALECT_DIAGNOSTICS = Object.freeze({ 'codex-rollout': 'dialect:codex-rollout' })` **当前只有 1 个 key**，"表级证据"退化为"该表唯一 key 的证据"，两者外延重合，故当前**不存在**"删掉某 key、被同表其他 key 顶包"的真实场景。K-4 描述的风险（"该表内单 key 产出被删时守卫不报红"）是一个**结构性设计限制**的诚实登记，成立的前提是该表**未来**新增第二个 dialect/key——K-4 措辞本身没有断言"当前已可被利用"，故不构成 over-claim，但建议在 K-4 补一句"（当前仅 1 key，风险在新增第二 key 时才激活）"以避免误读为现存漏洞。

### 4.4 trace 钩子墙钟实测

用真实（未变异）代码 + 极端环境变量值（`SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS=999999999`）直接调用 `acquireStateLock`（预置陈旧锁强制走接管分支）：

| 场景 | 实测墙钟 |
|---|---|
| 单次陈旧锁接管 | **1008ms** |
| 对抗性场景：后台每 3ms 用不同 `lockId` 持续重写陈旧锁（模拟持续制造陈旧锁的并发写入者，逼迫重试循环反复命中"陈旧"分支） | **1011ms** |

两次实测均落在"上限 1000ms + 若干毫秒函数自身开销"的预期区间，**未观测到 60× 放大**——确认 W-1 的"每次 acquireStateLock 调用最多生效一次"闭锁，在持续对抗性陈旧锁重建下依然成立，不仅是（a）(b) 变异测试的源码钉，也有真实行为级数据支撑。

## 5. 误伤面抽查（必做 4）

- **Tier 1 stderr 是否零出现绑定文案**：`counts.tier2Notice: result.tier === 2 ? tier2BindingNotice(...) : null`（`fix-compliance-judge.mjs:1094`）——**结构性保证**（非采样观测）：`tier2Notice` 的赋值本身就是以 `result.tier === 2` 为唯一入口条件的三元表达式，`result.tier` 只有 `isFix ? 1 : 2` 一处赋值来源（`tier` 恒为 1 或 2 或由更早的 `return {tier:null,...}` 早退），Tier 1 路径**在类型层面**不可能进入 `tier2BindingNotice` 调用。比抽样测试更强的保证。
- **fail-open `tier` 三态**：`tier = isFix ? 1 : 2`（仅在 `isFix` 为真或 `tier2` 非空时可达）；非 fix 且无 Tier2 绑定（含方言 fail-open 早退）在函数早退处显式 `tier: null`；`tryAppendFailOpenEvent` 两处兜底调用（payload-invalid / internal-error）不传第 6 参、默认值收敛为 `null`。三态赋值路径逐一读码确认，与 review-misblock.md §2(b) 的真实 CLI 实测结果（1 / 2 / null）一致。
- **`tier2` 参数唯一消费点**：`grep tier2 fix-compliance-core.mjs` 只命中 1 处（`if (!tier2 && counts.implement < 1) missing.push('delegation:implement')`）——确认"只豁免 implement 委派"无夸大，`delegation:verify` 判据不受影响。
- **`tier2BindingNotice` 三源标签 vs `detectTier2Binding`/`collectArtifactWriteWitnesses` 实际判据**：
  - `ARTIFACT_WRITER_TOOL_NAMES = Set(['Write','Edit'])`（`fix-compliance-core.mjs:1029`，显式注释"why 不收 Bash"）——确认 witness 源**只认 Write/Edit**，不认 Bash，与 F290 订正后的 JSDoc 表格（"仅 Write/Edit 写 fix-report.md + 成功回执"）逐字一致。
  - `ANCHORED_ARTIFACT_PATH_REGEX = /^(specs\/\d+-fix-[a-z0-9-]+)\/fix-report\.md$/`（`fix-compliance-core.mjs:1059`）——只认 `fix-report.md`，不认 `verification-report.md`，同样与订正后 JSDoc 一致（订正前的旧 JSDoc 声称"或 verification-report.md"，F290 本次已同步改掉，diff 确认改动落在 `fix-compliance-judge.mjs` 的函数头注释表格）。

**误伤面：未发现新问题**，全部结构性确认与两份既有 review 的观测结论一致。

## 6. 可验收性（必做 5）—— SC-001~006

| SC | 机械命令 | 实测值 | 判断 |
|---|---|---|---|
| SC-001 | `node -e 'import("...judge-snapshot-core.mjs").then(m=>console.log(m.DOCTOR_FILE_SET.length, m.DOCTOR_FILE_SET[0]===m.JUDGE_FILE_SET[0], m.DOCTOR_FILE_SET.some(f=>f.includes("sidechain-marker"))))'` | `12 true true`；`new Set(DOCTOR_FILE_SET).size===12`（无重复）；judge-snapshot 三套件+双守卫 90/0（§2） | **字面达成，且实质有效**——非空洞：M-c-1/M-c-2 两种改法分别精准命中不同套件，证明三套件+双守卫合围无死角 |
| SC-002 | card-b T1-C6（正确代码）+ 变异 (g)（裸 unlink） | 正确代码终态 2（`loadBlockState(...).blockCount===2`）；变异后 `1 !== 2`（实测终态 1）| **字面达成，实质有效** |
| SC-003 | card-a T0-U6 + 变异 (c)(d)(e) + 删 allowlist | 当前 21/0；四个方向变异全部正确变红 | **字面"当前"达成，但见 §4：长期可靠性不完整**——存在两处（剥注释按行位置区分对待、形态③不校验产出真实性）可构造"真实零产出仍判绿"的反例，SC-003 的"双向"保护不是无死角的 |
| SC-004 | tier2 E4/E5 + 结构性 tier 三态确认 | stderr 含"识别为 fix 续做"+源标签+目录（E4/E5 pass）；judge-cli/card-a/card-b/tier2 零翻转（225/21/28/25 均 0 fail）| **字面达成，实质有效** |
| SC-005 | `node plugins/spec-driver/scripts/validate-wrapper-sources.mjs`；`npm run repo:check` | wrapper 6/6 pass；repo:check 除既有 `graph-quality:freshness` warn 外全 pass，**无新增失败** | **字面达成，实质有效** |
| SC-006 | 两份 review（`review-bypass.md` 2C/3W/2I，`review-misblock.md` 0C/2W/5I）+ 本次 verify | 两轮 CRITICAL 均确认修复（§3）；**但本次 verify 独立发现 2 项新 CRITICAL（§4）** | **该 SC 字面达成有条件**——"CRITICAL 清零"仅对两轮**已发现**的 CRITICAL 成立；verify 作为第三道独立检查，其存在的意义正是补两轮遗漏，本次确实补出 2 项，说明 SC-006 的"清零"不能理解为"该功能面已无 CRITICAL 级问题"，只能理解为"两轮对抗审查各自发现的 CRITICAL 都已处置" |

## 7. over-claim 检查（必做 6）

逐条核对 fix-report §2/§3/§4/§5/§6：

**§2（修复描述）**：六条描述性断言（doctor 闭包/锁竞态/enum 反向守卫/Tier2 可观测性/resume 恢复）核实全部属实（详见 §2/§3/§5/§6 各表的交叉验证）。**发现一处表述与最终态不符**：

- **WARNING-1**：§2 第二条"锁竞态确定性用例"写"可注入 **≤5s** 延迟"，§4"如实登记"第一条写"5s 上限"——均为 **round 1（`eff3e42f`）的旧值**。round 2 的 C-1/W-1 处置已把上限从 5000 降到 **1000ms**（§6 CRITICAL-1/WARNING-1 disposition 表格正确写着"上限 5000→1000ms"），但 §2/§4 的原文没有同步更新，**spec.md 的 FR-002（"≤5s 延迟"）与 K-1（"上限 5s"）同样未同步**（round 2 对 spec.md 的唯一改动是新增 K-4，未碰 FR-002/K-1 原文）。**方向**：文档描述的保护比实际更弱（说 5s，实际 1s），不是"实际更弱、文档说更强"的危险方向，且不影响任何机器可读判据（T-S2 断言的是 `<=1000`，不是读 spec 文本）——**判 WARNING（文档陈旧，非行为缺陷）**。

**§3（红先行变异清单）**：

- M-a/M-b-1/M-b-2/M-f/M-g/M-h/M-i 逐一复现，计数与 §3 描述完全一致。
- **WARNING-2**：M-d（"tier2Notice 不下传 ⟹ E4 红（23/1）"）与 M-e（"fail-open 不传 tier ⟹ E4 红（23/1）"）——实测均为 **24 pass / 1 fail**，而非 23/1。原因与 §2 同源：round 2 新增 E5 后 tier2 套件总数从 24 变成 25，M-d/M-e 的计数是 round 1 遗留旧值，未随 round 2 改动同步刷新。**方向判断正确（仍确实红），仅分母/计数陈旧**——判 WARNING。
- M-c 已在 round 2 按 WARNING-3 拆成 M-c-1/M-c-2 两条，本次复现两者归因均准确（§3 表格）。

**§4（如实登记）**：五条逐一核实，除已在 WARNING-1 指出的"5s"陈旧措辞外，其余（K-2 前提说明、K-3 方向、shell 薄壳口径、F291 移交范围）均未找到反例。K-4 的 `FOREIGN_DIALECT_DIAGNOSTICS` 残余登记：如实且方向正确，本次补充确认"当前不可利用，风险在未来新增第二 key 时才激活"（§4.3），非 over-claim。

**§5（验证数据）**：

- **WARNING-3**（已在 §2 表格标注）："plugin 全量 1945 tests / 0 fail"实测为 **1946 tests / 1944 pass / 0 fail / 2 skipped**，差 1 源于 round 2 新增 E5 未同步更新此总数。"0 fail"结论本身不受影响。
- "90/0"的五个被加数口径本次逐一核实为真（§2 表格），消除了 `review-bypass.md` INFO-1 遗留的"89 vs 90"歧义——**确认 fix-report 的口径正确，绕过面复核用的三文件组合选择有误（未包含 judge-file-set-guard 与 sidechain-guard 两个独立守卫文件）**。
- "build 0 对本卡近乎零区分力"的自我提示准确、未夸大验证力度。

**§6（对抗复审处置）**：

- CRITICAL-1/CRITICAL-2 的处置描述与代码改动逐字对应（§3 diff 交叉核实）。
- "27/1、20/1、24/1"等全部计数本次逐一复现为真（§3 表格）。
- WARNING-1/2/3、误伤 W-1/W-2 的处置描述与代码 diff 逐字对应；INFO-1"90"口径澄清属实；INFO 关于 JSDoc 表格订正（"F289 遗留，F290 顺手订正"）核实：diff 确认 `fix-compliance-judge.mjs` 函数头 JSDoc 表格第 (b) 行确实被本次改写，内容与实际代码行为一致。

**总体**：fix-report 没有方向性错误或功能性夸大声称；发现的 3 处 WARNING 全部是"round 2 增补后，round 1 遗留的具体计数/措辞未同步刷新"这一种模式（5s→1s 未同步、1945→1946 未同步、23/1→24/1 未同步），性质相同、建议合并成一次"数字/措辞刷新"收尾即可修复，不构成行为层面的 over-claim。

## 8. 三档发现汇总（本轮 verify）

**CRITICAL：2**（均为本轮独立新发现，非两轮已披露 CRITICAL 的回归）

1. `fix-compliance-card-a-diagnostics.test.mjs` 的 `stripComments` 只剥离独立整行 `//` 注释，不剥离行尾 `//` 注释——对 form①（`表.键`）与 TABLE_LEVEL_ONLY 形态均已实测证实：真实产出点删除后仅留一条行尾说明注释，T0-U6 仍判绿（21/21）；同一删除若注释改放独立一行则正确变红（20/1）。三种形态共享同一份剥离后 `corpus`，无形态专属例外，风险面覆盖 FR-003 全部诊断码。
2. T0-U6 形态③（"具名常量别名引用 ≥2 次"）不要求任一引用是真实产出调用——`LEDGER_CORRUPT_ENTRY` 的唯一真实 `push()` 产出点被整段删除、仅保留定义+表映射两处纯声明性引用后，T0-U6 仍判绿（21/21），而 `ledger-reader.test.mjs` 自身功能测试正确捕获该回归（21/1）。受影响面 = 整个 `LEDGER_DIAGNOSTICS` 表（fix-report 自陈该表全走形态③）。

**WARNING：3**（均为文档/计数陈旧，非行为缺陷）

1. fix-report §2/§4 与 spec.md FR-002/K-1 仍写"≤5s 延迟"/"5s 上限"，未同步 round 2 C-1 处置后的实际值 **1000ms**（代码、T-S2 断言、§6 disposition 表格三方一致确认为 1000ms）。
2. fix-report §3 的 M-d/M-e 变异计数写"23/1"，round 2 新增 E5 后 tier2 套件总数由 24→25，当前实测应为 **24/1**。
3. fix-report §5"plugin 全量 1945 tests"未同步 round 2 新增 E5 后的总数，当前实测为 **1946 tests / 1944 pass / 0 fail / 2 skipped**。

**INFO：4**

1. 任务书要求核对的"949"不是 fix-report 原文数字，是 judge-cli(225)+core(604)+io(75)+ledger-reader(22)+ledger-writer(23) 五套件 pass 之和的推导值，实测精确复现，如实注明其非直接引用性质。
2. K-4 登记的 `FOREIGN_DIALECT_DIAGNOSTICS` 表级残余如实且方向正确，本次补充澄清：该表当前只有 1 个 key，风险在未来新增第二个 key 时才真正激活，当前删除其唯一产出点仍会被正确判红。
3. fix-report §3 M-c 经 round 2 拆分为 M-c-1/M-c-2 后的归因描述，本次复现两者均准确（含"doctor.test.mjs 全程保持绿"这一细节）。
4. 误伤面四项结构性核对（Tier1 stderr 结构性零出现绑定文案 / fail-open tier 三态 / tier2 唯一消费点 / witness 三源判据与订正后 JSDoc 一致）均未发现偏差，且部分核对方式（类型层面的赋值路径追踪）强于单纯的采样式 CLI 实测。

## 9. 结论

- **两轮对抗审查提出的 2 个 CRITICAL 是否真修好：PASS**。C-1（trace 延迟钩子 5s 上限/一次性闭锁零覆盖）与 C-2（allowlist 陈旧检测对当前两码是死代码）及其配套 WARNING（tier2 文案零消毒、T0-U6 两处已知假阴性）均已用零技巧的直接变异复现验证，全部按声称的计数（27/1、20/1、24/1）正确变红，7/7 应红全部真红，无一空头承诺。
- **但**本轮 verify 独立发现 2 项**同等严重级别**的新 CRITICAL（§4.1/§4.2），说明 FR-003 反向守卫的假阴性面尚未完全收敛，建议开一张后续小卡（`stripComments` 增加对行尾注释的剥离 + 形态③要求至少一次引用满足"产出上下文"特征，如出现在 `.push(`/`.includes(`/`return` 等调用位置）一并处理，而不是继续在本卡内追加。
- 3 项 WARNING 均为同一模式（round 2 增补后遗留的计数/措辞未刷新），建议下次改动时统一过一遍数字校对。

**报告路径**：`specs/290-batch3-residuals-safe/verification/verification-report.md`
