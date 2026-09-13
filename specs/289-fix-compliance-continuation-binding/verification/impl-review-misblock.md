# F289 implement 阶段异构对抗复审——误伤面 / 真实语料 / 并发 / 性能 / 可验收性

> 切入角：误伤面（误阻断诚实用户）/ 真实语料分布 / 并发与竞态 / 性能 / 可验收性。审查基线：HEAD `587a0fe2`。
> 默认「假设有问题、尝试证伪」。全部实验在 scratchpad 隔离进行，`git status` 复核：本 worktree 除本文件外零改动。

## ① 亲跑

- `node --test plugins/spec-driver/tests/fix-compliance-tier2-continuation.test.mjs` → **20/20 pass**（U1-U5/A1-A5/B1-B3/C1-C5/D1-D2）。
- 抽样重跑既有回归面（`fix-compliance-judge-cli` + `fix-compliance-card-a-diagnostics` + `fix-compliance-card-b-lock-fingerprint` 三套合计 273 用例）→ **271 pass / 0 fail / 2 skip**（skip 与本卡无关），Tier 1 零翻转声称在这三套上成立。
- 未重跑全量 `test:plugins`/`vitest`（fix-report 已声称 1902/0、8226/0）；本轮聚焦 F289 新增面 + 直接依赖它的既有面，未见异常。

## ② 误阻断构造表

| # | 构造 | 命令/脚本 | 实测结果 | 判定 |
|---|---|---|---|---|
| M1 | resume 真续做但提名落到非 fix 目录（feature/story 续做，写 `specs/305-add-widget/plan.md`） | `harness.mjs` Probe 1 | `status:0`，`.specify` 目录零创建 | 符合预期，US4 零误阻断成立（`ARTIFACT_PATH_REGEX` 硬编码要求 `-fix-`，feature 目录天然不触发提名） |
| M2 | (b) 见证锚点（首条见证行，非 -1）+ 合法 in-flight verify（已派发未回执，`background_tasks` 标 running） | `harness.mjs` Probe 2 | `status:0`，stderr 走 `[FIX-COMPLIANCE][WARN]` 推迟提示，非阻断前缀 | **C-2 i 对 (b) 源确认修复有效**：短会话下合法在途 verify 能正常推迟 |
| M3 | (c) sidechain-only 无见证、**长会话**（500 assistant turns）+ 合法 in-flight verify | Probe 3 | `status:2`，`missing:["feature-dir","fix-report.md"]` | 阻断，但**归因与 spec §7 误阻断2 不同**（见 CRITICAL-2） |
| M4 | (a) resume **真实早锚**（非 -1）+ 长会话（500 turns）+ 合法 in-flight verify | Probe 4 | `status:2`，`missing:["verification-report.md"]` | **实测推翻 spec 原话「有见证行/真实行时锚为真实行，无此问题」**——真实锚一样会耗尽闸门三 420 预算（见 CRITICAL-2） |
| M5 | 账本 sinceTs 真实介入：witness 锚带真实 timestamp，账本一条在锚前(应排除)+一条在锚后(应补充) | Probe 5 / 5b | 5：`status:0, missing:[]`（账本补充生效）；5b（仅锚前条目）：`status:2, missing:["delegation:verify"]`（正确排除） | 通过：sinceTs 真实介入在有真实行时确实工作 |
| M6 | -1 回落（sidechain-only 无见证）+ 账本里已有一条时间戳在锚后的 verify 条目 | Probe 6 | `status:2`，`diagnostics` 含 `ledger-window-undetermined`，missing 未被账本填平 | 通过：-1 回落时账本补充确实被禁用，如实登记 |
| M7 | **SHORT 会话**（2 轮）sidechain fix 展开但子代理/主线程均**从未提名**任何目录 | Probe 3b | `status:2`，`missing:["feature-dir","fix-report.md"]`，**与会话长度无关**（2 轮与 500 轮同样触发） | **CRITICAL-1**：真正触发条件是候选形状 `{path:null, ambiguous:false}`，不是闸门三/会话长度 |
| M8 | 对照：(a) resume 走**光杆 mv 到非规范名**（ambiguous:true）+ 已完成的 verify 委派 | Probe 3c | `status:0`，`diagnostics:["feature-dir-unresolvable"]`（F224 宽松早退） | 确认 (a) 的 `ambiguous:true` 形态走宽松通道，与 M7 的 `ambiguous:false` 硬阻断形成**不对称** |
| M9 | 旧 fix 目录顺手改 typo：real corpus 统计 `specs/*-fix-*` 缺 verification-report / 缺 Root Cause 比例 | `git ls-tree` + `git show` 全量扫描（84 个历史 fix 目录） | 缺 verification-report：**21/84 = 25.0%**；缺 Root Cause 标题：**2/84 = 2.4%** | spec §7 误阻断1「约 1/4」「少量」**逐字核实为真**，非 over-claim |

### CRITICAL-1 详情（新发现，spec/fix-report 均未登记）

`fix-compliance-judge.mjs` 的 `detectTier2Binding` 中，(a) resume 分支显式要求 `hasNomination(candidate)` 才 push 命中（spec A-C2 已加固的判据）；但 **(c) sidechain 分支没有对称的 `hasNomination` 门**——只要 `markers.length > 0` 就无条件 push 一个 hit，即使 `main`（主 transcript 提名）与 `carried`（标记携带的提名）双双为空，candidate 退化为 `{path:null, ambiguous:false, candidates:[]}`。

这个形状**不满足** `featureDirUndetermined = resolvedPath===null && candidate.ambiguous===true` 的判据（因为 `ambiguous` 是 `false` 不是 `true`），因此**绕过了 F224 既有的宽松早退通道**（该通道只需 `hasVerifyClassDelegation` 即可 exit 0），直接落入 `judgeCompliance` 的硬性 `missing:['feature-dir','fix-report.md']`——这两个键**不在** `DEFERRABLE_MISSING_KEYS` 白名单里，因此 `isDeferrableMissingSet` 恒假，`hasInFlight && isDeferrableMissingSet(...)` 短路，**在途推迟逻辑被完全跳过**，无论闸门三预算是否充足、无论会话多短、无论是否有其他货真价实的在途工作。

触发条件极低：**任意一次 sidechain 内 `/spec-driver:spec-driver-fix` 展开、且该子代理在被 SubagentStop 捕获前尚未来得及写出 `fix-report.md`**（如：诊断阶段被打断、上下文耗尽、任务被拆成"先探查再落盘"两步）即可满足。Probe 3b 证明这在一个仅 2 轮的会话里就能复现，与 spec §7 描述的"超长会话"完全无关。

- 影响范围：仅当 (a)/(b) 均未命中、(c) 是唯一命中源时触发（`primary` 选择逻辑：`real.length>0 ? real[0] : hits[0]`——本例 `real=[]` 因为该 hit 的 `anchorLineIndex=-1`，故直接取 `hits[0]`）。
- 伤害有界：仍受 `BLOCK_LIMIT=2` 自愈保护（2 次阻断后 `releaseDegraded` 放行），不会永久卡死会话，但每次触发都会**多消耗 2 次無意义的 Stop 往返**，且用户看到的 stderr 提示（"未建立特性目录…请按 specs/NNN-fix-<short-name>/ 约定创建"）具有误导性——用户并未忘记建目录，是**子代理还没来得及建**。
- 与既有设计的不一致：(a) 源已经因为 A-C2 对抗复审专门加了 `hasNomination` 门来防止"退化提名"绕过判定；(c) 源的退化提名（更彻底：完全没有提名，而非 ambiguous）反而没有对称加固，判据的两侧不对称。
- 真实语料现状：624 份 sidechain transcript 中，`isMeta===true` 的 `spec-driver-fix` 展开命中数为 **0**（见③），故此路径**尚未在生产中被真实触发过**——它是一个尚未暴光的潜伏 gap，不是已经发生的事故；随着 F289 一旦上线鼓励"把整段 fix 流程委派进 sidechain"，触发概率会从 0 变为非零。
- 建议修法方向（仅供参考，未改代码）：sidechain 分支比照 (a) 做 `hasNomination` 判断，`main`/`carried` 均空时应构造 `{path:null, ambiguous:true, candidates:[]}`（而非 `ambiguous:false`），使其和"光杆 mv"一样落入 F224 既有宽松通道，与 M8 的行为对齐。

## ③ 真实语料分位数表（只读 `~/.claude/projects/`，n 见下）

| 指标 | 样本量 | 结果 |
|---|---|---|
| 主 transcript resume 展开命中 | 386 | **0 命中**（与 spec 残余7"383份0命中"一致，语料略增长） |
| 主 transcript fix 展开命中（Tier1 isFix） | 386 | 26 命中 |
| 主 transcript 行数分位数 | 386 | p50=14, p90=162, p99=3387, max=6922 |
| sidechain fix 展开命中（**不带** requireMeta，模拟 B-C1 修复前） | 624 | 1 命中（即 spec 登记的"唯一命中=父prompt引用诱饵"） |
| sidechain fix 展开命中（**带** requireMeta=true，实际上线行为） | 624 | **0 命中**——B-C1 的 isMeta 门在真实语料上把 1 条误报压到 0，修复生效 |
| 以上 0 个命中中，nominated / null-candidate(CRITICAL-1 触发形状) | 0 | 均为 0（因为本来就 0 命中，CRITICAL-1 在真实语料中尚无正例，见 CRITICAL-1 附注） |
| sidechain transcript 体积 | 624 | bytes: p50=402,695 p90=936,339 p99=1,784,706 max=2,431,844（全部 ≪ 20MB 上限） |
| sidechain transcript 行数 | 624 | p50=103 p90=259 p99=492 max=814 |
| `recordSidechainFixMarker()` 单趟耗时（**全量** 624 份真实 transcript，非抽样） | 624 | **p50=1.020ms p90=2.239ms p99=4.192ms max=4.790ms** |
| 同一指标，仅前 60 份（目录序，非随机）子样本 | 60 | p50=0.804ms p90=1.223ms **p99=1.815ms** max=1.815ms |
| 单最大真实文件（2.43MB/814行）重跑 20 次 | 20 | min=4.590ms p50=4.827ms max=6.169ms |
| 合成"命中并写标记"全路径（483行/436KB，模拟 p99 体量） | 20 | min=0.496ms p50=0.545ms max=1.833ms |
| 历史 `specs/*-fix-*` 目录（`origin/master`）缺 verification-report | 84 | 21/84 = 25.0% |
| 同上，缺 Root Cause 标题 | 84 | 2/84 = 2.4% |

**分母偏差提示**：60 份子样本（`find` 目录序，非随机）测得 p99=1.815ms，而**全量 624 份**测得 p99=4.192ms、**单最大文件**测得均值 ~4.8ms——小样本/非随机序会明显低估尾部（低估 >2×）。若验证报告只报一个未注明 N 与抽样方法的 "p99≤10ms"，读者无法判断该数字覆盖了多少真实尾部；建议固定写"全量 624 份真实语料，p99=4.19ms，max=4.79ms"这一具体表述。两个数字都在 10ms 预算内（≥2× 余量），**SC-005 的性能声称本身站得住**，只是分母表述不够精确。

## ④ 并发 / 竞态

| 场景 | 方法 | 结果 |
|---|---|---|
| 40 个并发进程写**同一** sidechain 标记文件（同 session+agent） | 真并发 `spawn`（非 spawnSync 顺序执行） | 40/40 exit 0；终态文件是合法 JSON，未观测到损坏 |
| 200 次并发标记写 + 同时高频 `listSidechainMarkers` 读（same session） | 定时器每 2ms 读一次，读到 11 次样本 | 0 次抛异常、0 次返回畸形结构（`try/catch` per-file 按设计吞掉半写） |
| 主 Stop（15 并发，状态文件锁路径）与 SubagentStop 标记写（15 并发）同目录混跑 | 真并发 | 全部 Stop exit ∈ {0,2}（无崩溃/挂起）；15 个标记写全部 exit 0 |

**结论**：`writeSidechainMarker`/`saveBlockState` 的落盘用**直接 `fs.writeFileSync`**（无临时文件 + rename 的原子替换模式），理论上不是 POSIX 原子写；但 40+200+15 规模的压测下**未复现**任何损坏或崩溃——小 JSON（远小于典型文件系统块大小）在本机 APFS 上单次 `write()` 系统调用即可完成，实际风险低于理论担忧。即使发生半写，`listSidechainMarkers` 的 per-file `try/catch` 会把畸形文件当"缺席"跳过——**方向是漏绑（favors 用户，不误阻断）**，不是误判为合法数据。标记文件与状态文件（`<sid>.json` vs `<sid>.sidechain.<agent>.json`）文件名不重叠，未发现互踩。K-5（worktree 隔离下 projectRoot 是否同源）本轮未做多进程 worktree 级实测，维持 spec 既有"登记待探针"结论。

## ⑤ 可验收性

- SC-001/002/003/004 的机械可验性没有异议（存在具体命令/断言可执行）。
- SC-005「≤10ms @ 真实 p99」：**性能声称成立**（见③），但验证报告若要真正"机械可验"，分母需明确写"N=624 全量真实 sidechain 语料"，而不是抽样片段——本轮亲测抽样方法差异可致 p99 读数 >2× 偏差。
- SC-001「三源 × {放行/阻断/自愈} ≥ 9 条」的字面覆盖：实测 20 个新测试里，**自愈（连续 2 次阻断后降级放行）只在 (a) resume 源下测了一次（A3）**，(b)/(c) 源没有独立的自愈用例。由于降级机制（`BLOCK_LIMIT`/`blockFeedbackCount`）是三源共享、不按 `tier2Source` 分支的同一段代码，一次验证可合理外推到三源——但**字面上不构成 9 条独立验证**，只有 7 个不同格子被直接测过（(a):3/3，(b):2/3，(c):2/3）。建议要么在验证报告里显式说明"自愈机制与来源正交，(a) 的验证可代表三源"，要么补两条轻量测试把字面覆盖补满。
- **ledger sinceTs 机制（FR-006 的核心，spec 称为 C-2 已修复的两处关键行为之一）在 20 个新测试里零覆盖**——见⑥ CRITICAL-2 与变异测试结果。
- SC-006 "implement 阶段 ×2 角 + verify 子代理复核 PASS" 尚待本轮之外的另一角度与 verify 子代理产出，本文档只覆盖误伤面这一角。

## ⑥ CRITICAL / WARNING / INFO

**CRITICAL（2）**

1. **sidechain 无提名退化绕开 F224 宽松通道，硬阻断且不可推迟**（见②③详述）。触发门槛极低（短会话可复现），与 (a) 源的 `hasNomination` 加固不对称，spec/fix-report 均未登记此形态。真实语料 0 正例（新基建尚未被真实使用触发），但功能一旦被使用即会出现。
2. **spec §7"误阻断2"对长会话风险的归因有误，且两个核心"已修复"机制（闸门三真实锚点、账本 sinceTs 真实时间戳）在 20 个新测试里都可以被完整撤销而不掉任何一个测试**：
   - Probe 4 实测：**(a) resume 的真实早锚**（非 -1）一样会在长会话（500 轮）下耗尽闸门三 420 预算而硬阻断合法 in-flight verify——与 spec 原文"有见证行/真实行时锚为真实行，无此问题"矛盾。真正决定"是否受长会话影响"的是"锚点是否在会话早期"，而三源的锚点（resume 展开、首条见证、sidechain 回落）**通常都在会话早期**，"是否为 -1"这个维度本身不是长会话问题的关键分野。
   - 变异测试：把 `effective` 的 `earliestFixLineIndex`/`latestFixLineIndex` 强制改回 `-1`（即撤销 C-2 对闸门三窗口的整个修复）→ **20/20 测试仍全过**。把 `readLedgerDelegations` 的 `sinceTs` 强制改成 `null`（即撤销 C-2 对账本窗口的整个修复）→ **20/20 测试仍全过**（且全仓搜索确认 F289 测试文件里**没有任何一处引用账本/ledger**）。这两处正是 fix-report §7 C-2 一栏宣称"已改"且被两路 spec 阶段异构对抗列为 CRITICAL 的修复点，实现确实改了（我独立构造的 Probe 2/4/5/5b/6 证明生产代码行为正确），但**回归测试完全没有钉住它**——下一次重构（哪怕是"看起来无害的简化"）可以悄悄撤销这两个修复而不被任何自动化测试发现。

**WARNING（2）**

1. SC-001 字面"三源×3档≥9条"与实测 7 个直接覆盖格子的差距（(b)/(c) 缺独立自愈用例）——机制共享、可以论证外推，但字面表述与实测不完全对应，建议在验证报告注明或补测试。
2. SC-005 的"真实 p99"分母未在文档中写明具体 N 与抽样方法；本轮证明非随机小样本（60/624）会把 p99 低估 >2×，虽然两个读数都在预算内，但文档如实写清分母能避免未来复核者用更小/更偏的样本得出误导性结论。

**INFO（2）**

1. `writeSidechainMarker`/`saveBlockState` 用非原子 `fs.writeFileSync` 直写目标路径；40/200/15 规模并发压测未复现损坏，失败方向即使触发也是"漏绑"（fail-open，不误阻断），风险按登记接受，无需本卡处理。
2. spec §7 误阻断1 的"约1/4缺verification-report、少量缺Root Cause"两个具体数字经 84 个历史 fix 目录全量核实**精确成立**（21/84=25.0%，2/84=2.4%），非 over-claim。

## ⑦ 没构造出来的清单

- 未能在 worktree 隔离（`isolation:"worktree"`）场景下实测主 Stop 与 SubagentStop 的 `projectRoot` 是否真的同源（K-5）——需要真实调度两个隔离的子代理会话，超出本次只读语料 + 单机并发压测的可行范围，维持"登记待探针"。
- 未构造出 K-6（他会话植入 `<victimSid>.sidechain.x.json` 造成 DoS）的端到端复现——代码审查已确认 `listSidechainMarkers` 无任何超越"文件名+`sessionId`字段一致"的权限校验，逻辑上可行，但构造"另一会话"级别的跨会话写入超出本次单进程测试范畴，未做实跑，只做静态确认。
- 未能在真实语料中找到 CRITICAL-1（sidechain 无提名退化）或 CRITICAL-2（长会话闸门三耗尽）的**真实历史正例**——两者都是本轮通过合成 transcript 构造出来的潜伏缺陷，624 份真实 sidechain 语料里目前 0 次 `isMeta` 真实 fix 展开，尚不构成"已发生的事故"证据，只构成"设计/测试盲区"证据。
- 未重新验证 SC-004（hooks 分发 / Codex 归属表）与 SC-006（implement 阶段另一切入角 + verify 子代理复核）——不在本次"误伤面"授权范围内，留给同批次另一角。
- 未跑 `npm run build` / `npm run repo:check` / 全量 `vitest`/`test:plugins`——本次只读 + 抽样回归复核范围内的既有面均通过，全量交给正式提交前的验证阶段。

---

**三档计数：CRITICAL 2 / WARNING 2 / INFO 2**

**一行结论**：实现基本兑现了 spec 阶段 C-1/C-2 对 (a)/(b) 源的修复承诺（真实语料与合成用例均验证有效），但发现一个未登记的 CRITICAL 级误阻断缺口（sidechain 无提名退化绕开 F224 宽松通道，短会话即可触发，与 (a) 源加固不对称）和一个测试覆盖缺口（C-2 两处核心修复——闸门三真实锚点、账本 sinceTs——可被完整撤销而 20 个新测试零感知），均建议在合入前处置或至少显式登记与补测。
