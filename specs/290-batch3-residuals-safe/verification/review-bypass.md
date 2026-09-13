# F290 对抗审查 · 绕过面 / fail-open 面 / 与 F236 doctor·F288 锁·F287 诊断码合同接缝

> 切入角：绕过面 / fail-open 面 / 契约接缝。审查基线：HEAD `eff3e42f`（对比父提交 `5f34cf13`）。
> 方法：先读 spec/plan/fix-report + 全量 diff，再对四套件+两闭包守卫亲跑，再对五处改动逐条做绕过构造，
> 再对 fix-report §2/§3/§4 的每条可证伪断言做单点变异（改一处、跑对应测试、记录实际红/绿、必要时还原重跑确认零污染）。
> 所有实验在 scratchpad 的 `plugins/spec-driver` 整树拷贝上进行（`adv-f290-a/repo/`），worktree 全程未改动
> （`git status --short` 全程空、HEAD 全程 `eff3e42f`）。

## 0. 结论摘要

**CRITICAL 2 / WARNING 3 / INFO 2**。

一句话结论：**四套件与两闭包守卫在当前代码上确实零翻转（亲跑复核通过）；但 fix-report §3 变异清单里有两条对「安全网是否真被测试钉住」的断言被亲跑证伪（trace 延迟钩子的 5s 上限、allowlist 陈旧检测对当前两个码均是死代码），且 M-c 的测试归因与实际不符——这些不是当前可复现的裁决绕过，而是「声称被钉住、实际没有」的验证空洞，本卡在诚实登记（K-1/K-3）之外还需要修正这三点，否则后续维护者会依赖不存在的安全网。**

## 1. 亲跑结果（必做 1）

在 worktree 原始代码上直接跑（非 mutation 状态）：

| 套件 | 命令 | 结果 | fix-report 声称 |
|---|---|---|---|
| card-a | `node --test tests/fix-compliance-card-a-diagnostics.test.mjs` | **21 pass / 0 fail** | 21/0 ✅一致 |
| card-b | `node --test tests/fix-compliance-card-b-lock-fingerprint.test.mjs` | **28 pass / 0 fail**（含新 T1-C6、T-S2） | 28/0 ✅一致 |
| tier2 | `node --test tests/fix-compliance-tier2-continuation.test.mjs` | **24 pass / 0 fail**（含新 E4） | 24/0 ✅一致 |
| judge-snapshot-core | `node --test tests/judge-snapshot-core.test.mjs` | 31 pass / 0 fail | — |
| judge-snapshot-doctor | `node --test tests/judge-snapshot-doctor.test.mjs` | 17 pass / 0 fail | — |
| judge-snapshot-doctor-cli | `node --test tests/judge-snapshot-doctor-cli.test.mjs` | 39 pass / 0 fail | — |
| judge-snapshot-io | `node --test tests/judge-snapshot-io.test.mjs` | 31 pass / 0 fail | — |
| sidechain-file-set-guard（新） | `node --test tests/sidechain-file-set-guard.test.mjs` | **2 pass / 0 fail** | — |
| judge-file-set-guard（FR-002b，未改动） | `node --test tests/judge-file-set-guard.test.mjs` + `-parser.test.mjs` | 24 pass / 0 fail | — |
| `validate-wrapper-sources.mjs`（SC-005） | `node plugins/spec-driver/scripts/validate-wrapper-sources.mjs` | **exit 0，6 项全 pass** | 一致 |

judge-snapshot 相关四文件合计 118/0；fix-report §5 写「judge-snapshot 三套件 + 双闭包守卫 90/0」——按最贴近的组合（core 31 + doctor 17 + doctor-cli 39 = 87）+ sidechain-guard 2 = 89，与 90 差 1；无论取哪种三文件组合都凑不出恰好 90。**零失败的结论不受影响，但这是一个未对上的计数（INFO-1，见 §5）。**

**结论：SC-001/SC-004/SC-005 的零翻转声称亲跑属实。**

## 2. 绕过 / fail-open 构造（必做 2）

### (a) trace 延迟钩子能否被生产路径触发 → DoS / 时序绕过

**同会话内 `export` 不可行（已被本仓自身注释证伪其反面）**：`fix-compliance-judge.mjs` 现有 STORAGE_UNAVAILABLE 反馈文案第③条明确写着：

> `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<可写目录> claude —— ⚠️ 须重启会话（hook 进程 env 取自启动快照，会话内 export 无效）`

这是本仓自己对同族环境变量钩子（`SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP`）的既有事实登记，同一机制（Node 子进程 env 取自 Claude Code 宿主进程启动时的快照）对新增的 `SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS` 同样成立：**被判方在当前这次 Stop 触发前用 Bash 工具 `export` 该变量，对本次 hook 子进程无效**（Bash 工具子进程与宿主进程是不同进程，即使 Bash 工具内 `export` 生效也不会回灌宿主）。

**但存在一个不需要「同会话生效」的持久化通道**：`.claude/settings.json` 是入库文件（`git ls-files` 确认已跟踪），Claude Code 的 settings schema 支持顶层 `env` 字段用于设置整个会话生效的环境变量（`update-config` skill 的描述亦印证「env vars ("set X=Y")」是 settings.json 的能力）。若某次提交把
```json
{ "env": { "SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS": "5000" } }
```
合入 `.claude/settings.json`，**下一次**会话启动后，该项目内所有 Stop hook 子进程（含 fix-compliance 判定器）都会继承这个值——不需要被判方在当前会话现改，只需要这条改动先落进仓库（供应链/评审疏漏路径，而非当次会话的即时行为）。

**命中后的放大**：`acquireStateLock` 的接管重试循环上限 `LOCK_RETRY_MAX = 60`，每次「判陈旧」分支都会执行 `sleepSync(Math.min(traceDelay, 5000))`。若某个外部并发写入者持续在竞态窗口内重新制造「看起来陈旧」的锁文件（被判方在同一会话内可用 `run_in_background` 启动一个后台脚本达成），单次 `acquireStateLock` 调用理论上限可被推到 `60 × 5000ms = 300s`；即使没有主动并发写入者，单次真实陈旧接管命中 1 次也有确定性的 5s（当前上限）阻塞。

**已知放行后果**：`specs/240-codex-runtime-closeout/plan.md:907` 记录「hook 超时（超 `timeoutSec`）...Claude：超时按放行处理」——即 Claude Code 对超时的 hook 进程按**放行**处理（这是本仓已有的、独立于 F290 的平台事实，非本次改动引入）。若上述延迟把判定器进程的墙钟推过宿主超时阈值，判定器会被杀死，Stop 事件按放行处理，等价于门禁被绕过（不是退出码语义被算错，是进程根本没跑完就被杀，宿主自己兜底成 0）。

**结论**：这不是一个「被判方在当前回合内可自触发」的绕过（同会话 export 无效，本仓自己的既有注释已证伪这条路），但是一个真实存在的**持久化配置面**（settings.json env）+ **可放大的重试循环**组合出的潜在 DoS/fail-open 面，且与 §3 的 M-f 发现（5s 上限本身没有回归测试钉住）叠加后风险上升——上限值可以被未来一次不相关的重构悄悄改大或去掉而无人发现。判 **WARNING**（可达性需要一次持久化配置改动作为前提，非当次会话直接可触发；但一旦具备该前提，二次放大是真实的）。

### (b) 延迟窗口是否让锁更容易被误接管

逐行审查 `acquireStateLock` 的接管分支：`fresh` 判定（是否陈旧）发生在插入延迟**之前**；延迟只出现在「已经判定陈旧」之后、`renameSync` 之前。也就是说延迟不会让一把原本新鲜的锁被误判成陈旧——它只是拉长了「判陈旧」到「实际改名」之间的窗口。窗口内如果真正的持有者释放或被别的等待者正常接管，`identityOk` 核对（`stalePath` 内容的 `lockId` 必须与判陈旧时读到的 `judgedLockId` 一致）会在窗口变长后**同样正确工作**——因为该核对不依赖窗口长度，只依赖「rename 走的和判定时看到的是不是同一把锁」这一逐字节比较。

**用现有回归钉实测**（未做变异，读原始行为）：T1-C6 用 150ms/300ms 的真实延迟验证了这条路径——终态 2、丢更新 0，与 T1-C1/T1-C5（无延迟的 8 进程并发接管）给出的正确性结论一致。窗口拉长没有引入新的误接管路径，identityOk 的正确性与延迟长度无关。

**结论**：判 **无新增缺陷**（不计入三档），机制设计上是安全的；唯一放大的是 (a) 里已经登记的「窗口更长 = 可被恶意占用的墙钟更多」，不是「窗口更长 = 判定变得更容易出错」。

### (c) tier2Notice 路径换行伪造

`tier2BindingNotice(source, candidatePath)`：
```js
const dir = typeof candidatePath === 'string' && candidatePath.length > 0 ? `（目录 ${candidatePath}）` : '';
return `...按「${label}」被识别为 fix 续做${dir}，按续做合同判定...`;
```
`candidatePath` 直接拼进将写入 `process.stderr` 的文案，**没有**调用本仓已有的 `renderPathSegment`（`fix-compliance-judge.mjs:1206`，专门把 C0/DEL 等控制字符折成 `\xNN` 可见转义形，F276 W-1 登记的确切场景：「`err.path` 零消毒 → 单行渲染里一个换行就能长出伪造行（实测可冒充 `GATE_DEGRADED_PREFIX_LINE`）」；`renderPathSegment` 目前只在 `e.blocker`/`e.path`/`projectRoot` 三处 STORAGE_UNAVAILABLE 反馈文案里被调用）。

**逐源审查 `tier2.candidate.path` 能否携带控制字符**（读 `fix-compliance-core.mjs` 全部 `candidate =` 赋值点）：
- resume 源：`resolveFeatureDirCandidate` 内唯一赋值点 `candidate = trackedDir`，前置条件 `FIX_DIR_NAME_REGEX.test(trackedDir)`，正则 `^specs\/\d+-fix-[a-z0-9-]+\/?$`——整串锚定、字符类只含 `[a-z0-9-]`，无法承载换行或其他控制字符。
- witness 源：`dirs[0]`，来自 `normalizeArtifactWritePath` 的 `match[1]`，正则 `ANCHORED_ARTIFACT_PATH_REGEX = /^(specs\/\d+-fix-[a-z0-9-]+)\/fix-report\.md$/`——同样整串锚定 + 同字符类。
- sidechain 源：`main`（同 resolveFeatureDirCandidate，同上）或 `carried`（来自 `fix-compliance-sidechain-marker.mjs:63` 的 `resolveFeatureDirCandidate` 输出，同一函数同一正则）。

**三源在当前代码里都被独立的锚定正则约束为 `[a-z0-9-]` 字符集，无法注入换行/控制字符**——这条路径**当前不可被利用**（与我最初假设的相反，锚定正则起到了事实上的白名单消毒作用，即使它不是 `renderPathSegment`）。

**但这是一个隐性、无自身防御的不变量**：`tier2BindingNotice` 本身对 `candidatePath` **零消毒**，完全依赖调用方三处上游正则「恰好」把字符集卡死；一旦未来新增第四个 Tier 2 绑定源、或任一正则被放宽（例如支持大写/中文特性目录名——这类需求在本仓其他地方出现过），F276 W-1 那类伪造行会在**零告警**的情况下原样复活。回归覆盖上，`grep -rn "tier2BindingNotice\|tier2CandidatePath" tests/*.mjs` **零命中**——没有任何测试提到这两个符号名，E4 测试只用规范的 `FIX_DIR` 常量断言子串包含，从未构造过含控制字符的路径。

**结论**：判 **WARNING**（当前不可利用，但是防御在错误的层级——应该在 `tier2BindingNotice` 自身补 `renderPathSegment(candidatePath)` 一次性消毒，而不是依赖三处上游正则永远不变；且此类"零测试覆盖的隐性不变量"正是 F276 W-1 第一次复活的方式）。

### (d) fail-open 事件加 tier 是否改变裁决

逐一核对 `tryAppendFailOpenEvent` 的三个调用点（`fix-compliance-judge.mjs:1430/1654/1664`）：新参数 `tier = null` 是**末位追加**且带默认值，两个未传新参数的旧调用点（payload-invalid、internal-error 早退）行为逐字不变；`buildAuditEvent`（真正裁决路径的审计写入）完全没有被这次改动触碰，`tier` 字段的读取仍是原来的 `verdict.tier`。`runHook` 里 `result.tier` 在 transcript-unavailable / 空 transcript 两条早退路径下是 `undefined`，`tier === 1 || tier === 2 ? tier : null` 把它正确折叠为 `null`，不抛错、不改变返回码（恒 `return 0`，改动前后一致）。

**结论**：**未发现问题**——加字段是纯加法，不影响任何 route/exit code 判定。

### (e) DOCTOR_FILE_SET 扩集是否让旧快照 pass→fail 并连带阻断

`aggregateStatus`（`judge-snapshot-core.mjs:216`）把非 `match` 的所有文件状态统一折叠成 `'drift'`；`judge-snapshot-doctor-cli.test.mjs` 的「四态-1 drift」用例钉死 **drift 状态下退出码恒为 0**（FR-009 原话「drift 不是失败」）。DOCTOR_FILE_SET 从 11 项扩到 12 项后，旧安装快照缺失第 12 个文件只会在明细里多一行 `missingInSnapshot`/`added-since`，聚合状态从 `in-sync` 变成 `drift`——**仍是退出码 0**，不会连带把任何调用方（`npm run judge:doctor`）的判定升级成硬失败。

**结论**：**未发现问题**，与 K-2 登记一致（"这是预期"）。

## 3. 契约接缝核对（必做 3）

- `JUDGE_FILE_SET.length === 11` 且 FR-002b 守卫（`judge-file-set-guard.test.mjs`）未被本次改动触碰、亲跑仍 pass——**未变**，如实。
- T0-U5（可见诊断码集合）：card-a 套件里 T0-U5 亲跑 pass，可见码集合仍是「改动前可达 buildFeedbackText 的 11 个码」——**未变**。
- schema `tier` 字段：`fix-compliance-verdict-event.schema.json` 在 `git diff 5f34cf13 eff3e42f` 下**零改动**，`tier` 字段（`["integer","null"]`）是 F289 遗留、F290 未碰 schema 本身，只是开始真正往 `null` 之外的分支（fail-open 早退）灌值——**与 spec 描述一致**。
- resume SKILL 编辑位置：`plugins/spec-driver/skills/spec-driver-resume/SKILL.md` 新增的 fix 目录恢复表插在两个 `docs:sync:agents` 生成区块（`gate-mounting-guard` 结束于行 76 附近、`gate-tasks-scope-cut-acceptance` 起于行 381）**之间的自由文本区**，未落入任何「以下区块由...同步，请勿手动编辑」标记内——**符合 plan.md「恢复表段不在同步区块内」的声明**。
- Codex 包装 sha 一致性：`node plugins/spec-driver/scripts/validate-wrapper-sources.mjs` 六项全 pass（`source-skills`/`codex-wrapper-markers`/`codex-plugin-distribution-markers`/`codex-wrapper-runtime-namespace`/`claude-project-overrides`/`plugin-metadata-sync`）——**SC-005 达成**。

**契约接缝：未发现问题。**

## 4. 变异清单复核（必做 4）—— 与 fix-report §3 逐条对照

在 scratchpad 整树拷贝上单点变异、单独跑对应套件、还原后重跑确认零污染。

| 变异 | fix-report §3 声称 | 实测 | 结论 |
|---|---|---|---|
| **M-a** 撤 `identityOk` 核对（裸 unlink 接管替代 rename+身份核对） | T1-C6 红 | **T1-C6 单独红（27 pass / 1 fail），其余 27 例不受影响** | ✅ 属实 |
| **M-b-1** 从 allowlist 删除 `parse-timeout` | T0-U6 红 | **T0-U6 红（20 pass / 1 fail）** | ✅ 属实 |
| **M-b-2** 给 allowlist 码（`parse-timeout`）在 scripts/**/*.mjs 加一个真实产出点（`export const X = 'parse-timeout'` + ≥2 次引用，满足「形态③具名常量」判据） | T0-U6 红（陈旧检测） | **T0-U6 仍是 21 pass / 0 fail，未变红** | ❌ **证伪，见 §5 CRITICAL-2** |
| **M-c** doctor roster 改回 JUDGE_FILE_SET | sidechain 守卫第 2 例 + core.test 红 | 分两种改法实测：<br>① 改 `judge-snapshot-core.mjs` 的 `DOCTOR_FILE_SET` 定义本身（别名回 JUDGE_FILE_SET）→ sidechain 守卫第 2 例红 + core.test 的 F290 断言红，**但 `judge-snapshot-doctor.test.mjs` 17/17 仍全绿**（未被提及）；<br>② 只改 `judge-snapshot-doctor.mjs` 消费处（`DOCTOR_FILE_SET.map`→`JUDGE_FILE_SET.map`，plan.md 里明确把这一文件称为「roster」）→ **sidechain 守卫与 core.test 均 100% 保持绿（33/33），只有 `judge-snapshot-doctor.test.mjs` 红（多个断言 11≠12）** | ⚠️ **归因不准确，见 §5 WARNING-3** |
| **M-d** `tier2Notice` 不下传（`routeBlockEnforcement` 强制置 `null`） | E4 红 | **E4 单独红（23 pass / 1 fail）** | ✅ 属实 |
| **M-e** fail-open 不传 `tier`（省略 `tryAppendFailOpenEvent` 第 6 参） | E4 红 | **E4 单独红（23 pass / 1 fail）** | ✅ 属实 |
| **M-f** trace 钩子上限（`Math.min(traceDelay, 5000)`）去掉，改 `sleepSync(traceDelay)` | T-S2 红 | **T-S2 及全部 28 例均保持绿** | ❌ **证伪，见 §5 CRITICAL-1** |

每项变异后均执行 `diff` 确认还原文件与 `.orig` 备份逐字节一致，再重跑相应套件回到 0 fail，确认变异之间零交叉污染。

## 5. 三档发现

### CRITICAL-1：trace 延迟钩子的 5s 上限没有任何测试钉住（K-1 / SC 声称与实测不符）

- **位置**：`plugins/spec-driver/scripts/lib/fix-compliance-io.mjs:670-671`；回归测试 `plugins/spec-driver/tests/fix-compliance-card-b-lock-fingerprint.test.mjs:584-590`（T-S2）。
- **声称**：spec.md FR-002「仅...注入 **≤5s** 延迟」；spec.md K-1「以...**上限 5s 钉住**，T-S2 源码守卫钉其存在与位置」；fix-report.md §3「M-f trace 钩子上限去掉...⟹ **T-S2 红**」。
- **实测**：T-S2 的三条断言只检查 `linkSync(stagingPath, lockPath)` 存在、`openSync(lockPath,'wx')` 不存在、字符串 `SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS` 出现在源码里——**没有任何一条检查 `Math.min(..., 5000)` 或等价的上限逻辑**。把 `sleepSync(Math.min(traceDelay, 5000))` 改成 `sleepSync(traceDelay)`（即完全去掉上限，延迟值 100% 由外部环境变量决定）后，card-b 全部 28 个用例（含 T-S2、T1-C6）**依然全绿**。
- **影响**：K-1 登记的风险缓释「上限 5s」本身没有回归保护——任何一次未来重构（哪怕是无意的，比如"简化这行代码"）都可能悄悄去掉这个 `Math.min`，而当前测试矩阵不会发出任何信号。结合 §2(a) 的可达性分析（若该环境变量经 `.claude/settings.json` 的 `env` 字段落进生产环境），一旦上限被意外移除，延迟将完全由攻击者/被污染环境控制的环境变量值决定，是判定器 Stop hook 层面一个真实的、无回归保护的 DoS 放大面。
- **建议**：在 T-S2 里补一条对 `Math.min(traceDelay, 5000)`（或功能等价上限）的源码钉，或者（更强）新增一个把环境变量设成超大值（如 `999999`）再实测墙钟耗时 ≤ 一个明确上界的行为级用例。

### CRITICAL-2：enum→产出点反向守卫的「allowlist 陈旧检测」对当前两个允许码是死代码（SC-003 声称与实测不符）

- **位置**：`plugins/spec-driver/tests/fix-compliance-card-a-diagnostics.test.mjs:123-156`（T0-U6）。
- **声称**：spec.md FR-003「allowlist...陈旧亦判红」；spec.md SC-003「给 allowlist 码加一个产出点 ⟹ 红（陈旧检测）」；fix-report.md §3「M-b 删 allowlist 任一码 / **给 allowlist 码加产出点** ⟹ T0-U6 红」。
- **根因**：T0-U6 的判定逻辑是
  ```js
  const entry = codeToEntry.get(code);
  if (!entry) { if (!ALLOWLIST_ZERO_PRODUCER.has(code)) problems.push(...); continue; }  // ← 提前 continue
  const via = producedBy(entry, code);
  if (via && ALLOWLIST_ZERO_PRODUCER.has(code)) problems.push(`${code} 已有产出点...allowlist 陈旧须删`);
  ```
  `producedBy()`（也就是"陈旧检测"真正的判断逻辑）只有在 `entry`（即该码在七张诊断码表里有一个 `TABLE.key = code` 映射）存在时才会被调用。而 `grep -rn "'parse-timeout'\|'nonblock-storage-unavailable'" scripts/*.mjs scripts/lib/*.mjs` **零命中**——这两个码从来没有出现在任何一张诊断码表里，只存在于 schema JSON 的 `enum` 数组和它的 `description` 文字登记里。因此对这两个码，`entry` 恒为 `undefined`，代码在 `producedBy` 被调用**之前**就 `continue` 了——"陈旧检测"分支对它们**永远不可达**。
- **实测**：在 `scripts/lib/` 下新增一个文件 `export const X = 'parse-timeout'; export const _r1 = X; export const _r2 = X;`（满足判据里"形态③：绑定该码的具名常量被引用 ≥2"），T0-U6 依旧 21/21 全绿，没有报告任何"陈旧须删"。
- **影响**：这不是"万一以后有第三个 allowlist 码就会碰到的边界情况"——是**当前唯一的两个 allowlist 成员**的陈旧检测从一开始就不生效。如果未来有人真的开始在某处产出 `parse-timeout` 或 `nonblock-storage-unavailable`（而忘记把它从 allowlist 删除、也没有把它接入七张官方诊断码表），T0-U6 不会发出任何信号，SC-003 声称的"双向"保护事实上只有单向（删码方向）生效。
- **建议**：`producedBy` 式的产出点扫描应该独立于 `codeToEntry.get(code)` 是否存在——对 allowlist 里的码，无论有没有表项都应该直接跑一遍语料扫描（比如直接用具名常量引用形态 ③，或者干脆全文 `grep` 该码字面量出现次数），而不是复用「先查表再查产出点」这条只为非 allowlist 码设计的路径。

### WARNING-1：trace 延迟钩子的持久化可达性 + 重试循环放大（§2(a) 完整分析）

见 §2(a)。同会话 `export` 不可行（本仓自身注释已证伪），但 `.claude/settings.json`（入库文件）的 `env` 字段是一条不需要当次会话配合的持久化通道；命中后经 60 次重试循环理论可放大到 300s，叠加本仓已记录的「Claude hook 超时按放行处理」平台事实，构成潜在 fail-open 放大面。与 CRITICAL-1 叠加后风险上升（上限本身随时可能被无声移除）。

### WARNING-2：`tier2BindingNotice` 未复用 `renderPathSegment`，零测试覆盖控制字符类

见 §2(c)。当前因三处上游正则（`FIX_DIR_NAME_REGEX` / `ANCHORED_ARTIFACT_PATH_REGEX`）把 `[a-z0-9-]` 字符集卡死而不可利用，但防御层级放错了地方（应在 `tier2BindingNotice` 自身兜底），且 `tests/*.mjs` 里搜不到 `tier2BindingNotice`/`tier2CandidatePath` 任何一次提及——F276 W-1 那类问题最初就是在类似"看似不可达、直到某个上游正则被放宽"的场景里发生的。

### WARNING-3：fix-report §3 变异清单对 "M-c" 的测试归因不准确

见 §4 表格 M-c 行。视"doctor roster"具体指代常量定义（`judge-snapshot-core.mjs`）还是消费处（`judge-snapshot-doctor.mjs`，plan.md 原文用语），实测出两种互斥的结果：前者会漏报 `judge-snapshot-doctor.test.mjs`（该文件全程保持绿，未被列入声称的"红"清单）；后者会让声称的两个文件（sidechain 守卫、core.test）**完全不变红**，实际扛住这条回归的是 fix-report 只字未提的 `judge-snapshot-doctor.test.mjs`。无论哪种解读，字面声称都与至少一次实测不符——不影响"总有测试兜底"这个结论，但会误导未来按这张表去定位某次真实回归的维护者。

### INFO-1：fix-report §5 的 "90/0" 与实测计数对不上

`judge-snapshot-core`(31) + `judge-snapshot-doctor`(17) + `judge-snapshot-doctor-cli`(39) = 87；加 `sidechain-file-set-guard`(2) = 89；加 `judge-snapshot-io`(31) 则总数变成 118。找不到一种"三套件 + 双闭包守卫"的组合恰好等于 90。零失败结论不受影响，纯计数口径问题。

### INFO-2：任务简报里 "F287 已有「路径换行伪造文本」登记" 的出处核实

搜索 `specs/287-compliance-card-a-diag-canonical/*.md` 未找到与"路径换行伪造 stderr 行"直接对应的登记；实际匹配的登记（`renderPathSegment` 的引入动机、"实测可冒充 GATE_DEGRADED_PREFIX_LINE"字样）位于 `specs/276-fix-compliance-p0a-residue/implementation-notes.md:92`（W-1）。本报告 §2(c) 按 F276 的实际记录展开分析；如果切入角描述里的 "F287" 另有所指、且与 F276 W-1 是两个不同的登记，需要另行核对，我没有找到第二个独立登记。

## 6. 未发现问题的项目（尝试证伪但未成功）

- (b) 延迟窗口导致误接管：识别用 identityOk 是否随窗口变长而失效——用 T1-C6 的真实延迟数据 + 逐行审查确认不失效，未找到反例。
- (d) fail-open 加 tier 字段改变裁决路径：逐一核对三处调用点与 `runHook` 的两条 undefined-tier 早退分支，未找到反例。
- (e) DOCTOR_FILE_SET 扩集导致旧快照阻断升级：核对 `aggregateStatus` 折叠逻辑与 doctor-cli 的 drift-exit-0 钉子，未找到反例。
- JUDGE_FILE_SET / FR-002b / T0-U5 / schema tier 字段 / resume SKILL 落点 / Codex 包装 sha：五项契约接缝逐条核对，均未找到反例。
