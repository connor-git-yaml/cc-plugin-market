# 问题修复报告（F257 fix 依从性门禁两处 fail-open 收口）

## 问题描述

M9 F240-F256 大批次的 7 维对抗审查（wf_7c4e7d8a，16 确认 / 19 证伪）在 fix 依从性门禁链上确认两处 fail-open，均由 F256 引入或未闭合，两条都带独立复现证据：

1. **缺陷 1（主）**：`plugins/spec-driver/scripts/fix-compliance-judge.mjs:220-233` —— F256 新增的 short-name 磁盘重锚定不校验目录是否属于本次会话。本会话零产出时，判定器可静默改用磁盘上同 short-name 的另一编号旧 feature 目录完成合规判定 → `compliant:true` → runHook 合规早退（judge.mjs:504-509，在任何 `appendAuditEvent` 之前）→ exit 0 且事后零审计线索。
2. **缺陷 2（次）**：`fix-compliance-judge.mjs:530-540` + `lib/fix-compliance-io.mjs:321-332` —— `IN_FLIGHT_DEFER_LIMIT=3` 的唯一上界存放在被 gitignore、位于 projectRoot 下的 `.specify/runs/.fix-compliance-state/<sessionId>.json`；每轮删除该目录即可让推迟预算永久归零，形成"永不裁决"的静默通道。

附带一项独立小问题（`tests/integration/repo-maintenance-sync-check.test.ts` 的整目录拷贝把门禁绑死在 `.claude/worktrees` 体积上），一并纳入本 fix 避免散落。

---

## 5-Why 根因追溯

### 缺陷 1：磁盘重锚定缺会话归属校验

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 本会话零产出为何仍 exit 0？ | `evaluate()` 把 `resolvedPath` 重锚定到磁盘上另一编号的旧 feature 目录，该目录制品齐全 → `compliant:true / missing:[]` |
| Why 2 | 为何会重锚定到旧目录？ | judge.mjs:229 按 short-name 枚举 `specs/NNN-fix-<short>` 全部同名目录，`.filter(usable)` 后取编号最大的可用者；本会话新编号目录无制品恰被 `usable()` 剔掉，只剩旧目录必然中选 |
| Why 3 | 为何 `usable()` 拦不住？ | `usable()` 只判"目标目录含 `fix-report.md`"——这是**制品存在性**判据，不是**会话归属**判据。"这个目录是不是本会话产出的"这一信息从未参与判断 |
| Why 4 | 为何整段缺归属判据？ | F256 把 F227 的「提名≠判据，磁盘核验才采信」原则误推成「磁盘核验可以**替代**提名」。F227 的原意是磁盘核验作为**追加**约束（先提名、再核验），F256 的兜底段却让"提名同 short-name 的任一编号"就足以采信另一个从未被提名的具体目录。short-name 是特性语义标识，跨编号、跨会话、跨人都可能重复，不蕴含归属 |
| Why 5 | 为何未被现有机制捕获？ | (a) F256 测试只覆盖正向场景（重编号后新目录有制品），缺"磁盘存在同 short-name 的**非本会话**目录"的反向用例；(b) F256 注释已如实登记这条限界，但把它判为"被接受限界的边际扩大"，理由是"冒用者原本直接提名目标目录即可达成同样效果"——**该理由只对主动冒用成立**，真正的失效模式是**无意**的：本会话老老实实提名了自己的新编号目录、磁盘上恰好存在同 short-name 的历史目录，判定器就静默采信了别人的产物，被判方全程没有任何"冒用"动作 |

**Root Cause（缺陷 1）**：磁盘重锚定用「制品存在性 ∧ short-name 字面相等」替代了「会话归属」，而这两个条件都不蕴含归属；失败方向是静默放行且合规早退发生在审计落盘之前，事后零线索。

**Root Cause Chain**：本会话零产出仍 exit 0 → resolvedPath 被重锚定到旧目录 → 采信闸门只有 usable() → usable() 只判制品存在不判归属 → 归属判据被 short-name 相等冒充 → 反向用例缺席 + 限界评估把「无意踩中」误算成「主动冒用等价」

### 缺陷 2：推迟预算寄存在可被抹除的本地状态

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 每轮先删状态文件为何能 N≫3 轮全 exit 0？ | judge.mjs:533 `loadBlockState` 每轮读到初始态 → `inFlightDeferCount=0 < 3` → 推迟通道恒开 |
| Why 2 | 为何 `loadBlockState` 读到初始态？ | io.mjs:321-332 对文件缺失/JSON 损坏/字段类型不符**一律静默回落**初始态，无完整性校验、无仅追加语义、无"曾经存在过"的记录 |
| Why 3 | 为何该回落语义被认为可接受？ | 它是为 `blockCount` 设计的：blockCount 归零只让被判方**多挨** 2 次阻断，失效方向 fail-closed（对被判方不利），删状态毫无收益 |
| Why 4 | 为何复用到 `inFlightDeferCount` 就破了？ | F256 把新的 `inFlightDeferCount` 挂进同一状态载体，但它的归零方向是 **fail-open**（多推迟 = 多放行）。同一存储、同一回落语义、**相反的失效方向**——载体的安全论证没有随字段语义一起重新做 |
| Why 5 | 为何未被现有机制捕获？ | (a) F256 推迟通道的测试全部在固定状态文件上跑，未模拟状态被删；(b) `specs/208-*/contracts/fix-compliance-judge-cli.md` 的断言写成无条件形式「两道闸门任一不满足即恢复完整裁决，故不存在『永久免于裁决』的会话」，该断言从未针对"状态可被抹除"这条路径被检验；(c) 推迟通道比既有 blockCount 篡改杠杆更安静——降级放行会打 `[GATE-DEGRADED]` + `degraded=true` + 写 `record-workflow-run` 终态，推迟通道只打 `[WARN]`、`degraded=false`、**不写终态记录**，事后审计看起来就是"还有子代理在跑" |

**Root Cause（缺陷 2）**：把一个 fail-open 方向的预算，寄存在与 fail-closed 预算共用、位于被判方可写且被 gitignore 的目录下、删除后静默归零的本地状态里；上界因此可被一条无恶意的"清理本地运行态"动作抹除。

**Root Cause Chain**：删状态即全放行 → loadBlockState 静默回落 0 → 该回落为 fail-closed 的 blockCount 而设 → inFlightDeferCount 失效方向相反却复用同一载体 → 载体安全论证未随字段语义重做 → 测试与 contract 断言均未覆盖"状态被抹除"路径

### 附带项：集成测试拷贝面绑死 worktree 体积

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `repo-maintenance-sync-check.test.ts` 为何在全量并行下超时？ | `beforeEach` 用 `cpSync(recursive)` 整目录拷 `.claude`，本轮实测 `.claude/` 2.7GB / 6 个 worktree |
| Why 2 | 为何 `.claude` 会有 GB 级内容？ | `.claude/worktrees/` 是本仓库 worktree 的实际落点，随并行 feature 数线性增长 |
| Why 3 | 为何整目录拷？ | 测试只需 `rules` / `settings*.json` / `skills`，但拷贝语句按目录粒度写，未做子路径排除 |
| Why 4 | 为何第二次复发？ | 上一轮修复按"当时的体积"缓解而非按"拷贝面"根治，`worktrees` 仍在拷贝范围内 |

**复现位置约束（实测核实）**：`REPO_ROOT = resolve('.')` 取的是 cwd。在 **worktree 内**跑该测试时 `.claude/` 仅 36K（worktree 的 `.claude` 不含 worktrees 子树），**不可复现**；只有在**主仓库**跑时 `.claude/` = 2.6GB（其中 `.claude/worktrees` 2.6GB）才触发。而主仓库正是交付前跑全量门禁的位置——失效时机恰好落在最关键的一步。

**Root Cause（附带项）**：拷贝面把一个体积无上界、与被测主题无关的运行态目录（`.claude/worktrees`）纳入沙箱构造，使测试耗时与 worktree 数量耦合。

---

## 影响范围扫描

### 同源问题（需同步评估 / 修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | L220-233 | short-name 磁盘重锚定，采信闸门仅 `usable()` | **本次修复主体**：追加会话归属证据要求 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | L530-540 | 推迟预算唯一上界依赖 `loadBlockState` | **本次修复主体**：补一条不依赖本地状态的上界 |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | L321-332 | `loadBlockState` 静默回落初始态 | 视 plan 定稿：或保留（blockCount 语义不变）并在 judge 层加无状态上界 |
| `specs/208-*/contracts/fix-compliance-judge-cli.md` | 「不存在永久免于裁决的会话」断言 | 无条件断言已被实测证伪 | **必须同真**：兑现断言或改为如实描述 + 登记限界 |
| `tests/integration/repo-maintenance-sync-check.test.ts` | L54-70 | `copyTree(projectRoot, '.claude')` | 排除 `worktrees` 子目录 |

### 类似模式（已评估，本次不改）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `fix-compliance-judge.mjs` | L196-204 | F227 候选历史兜底 `history[i]` | **安全**：候选历史全部来自本会话 transcript 提名，天然带会话归属证据，与缺陷 1 的"从未被提名的磁盘目录"性质不同 |
| `fix-compliance-io.mjs` | `blockCount` 字段 | 状态删除后归零 | **安全**：归零方向 fail-closed（被判方多挨阻断），删除对被判方无收益 |
| `fix-compliance-io.mjs` | `degradedRecorded` 字段 | 状态删除后归零 | **安全**：归零导致重复写终态记录，方向为"审计更多"而非"审计更少" |
| `fix-compliance-io.mjs` | tmpdir fallback 状态路径 | 第二存储位点 | **待 plan 评估**：`tmpStatePath` 不在 projectRoot 下，`rm -rf .specify/runs/...` 抹不掉它——但它同样会被系统级 tmp 清理，不足以单独充当上界 |

### 同步更新清单

- **判定器闭包**：若增删判定器文件，必须同步 `lib/judge-snapshot-core.mjs` 的 `JUDGE_FILE_SET`（当前 7 项），否则 FR-002b 守卫测试红
- **Contract**：`specs/208-*/contracts/fix-compliance-judge-cli.md` 的推迟通道断言必须与实现同真
- **测试**：`plugins/spec-driver/tests/fix-compliance-*.test.mjs` 需补两个缺陷各自的红先行用例 + F256 正向互补用例（同会话目录重编号仍 exit 0）
- **本机门禁生效说明**：本机 Stop hook 跑的是已安装快照（F236 实证），改完 judge 后须 `npm run judge:doctor` 确认漂移状态，并明确"修复要在下次 plugin 发版后才对本机门禁生效"

---

## 修复策略

### 缺陷 1

**方案 A（推荐）— 会话归属证据门槛**
磁盘重锚定命中的目录路径，必须在本会话 transcript 的 fix 锚点之后**以路径字面出现过**（写入/创建/命令文本均可）。理由：
- F256 真正要修的场景（复合命令 `cd … && git mv specs/251-fix-foo specs/254-fix-foo && …` 重编号）里，新目录路径**必然出现在本会话命令文本中**，该场景不被打回；
- 缺陷 1 的失效场景里，旧目录 `specs/100-fix-foo` 从未在本会话出现，重锚定被拒 → 落回不合规 → exit 2 + 审计落盘；
- 方向是**必要条件收窄**（更严），只可能把"改动前放行"转为"改动后阻断"，不引入新的 fail-open；
- 与 F231 已证伪的三条路线（执行证据 / 结构黑名单 / 结构白名单）不同：本方案不解析命令结构、不判断命令是否被执行，只做"路径字面是否在本会话出现"的存在性检查。

**方案 B（备选，更保守）— 取消跨编号重锚定**
本会话提名目录不可用时直接判不合规并给 next-step。代价：把 F256 修的重编号真场景打回误报。

### 缺陷 2

**方案 A（推荐）— 追加不依赖本地状态的上界**
从 transcript 派生一条"在途委派陈旧度"上界，与现有 `IN_FLIGHT_DEFER_LIMIT` **并联取严**：自最早在途委派的 `lineIndex` 之后，若主线程已产生超过阈值的轮次仍未回收，则不再推迟。该上界纯由 transcript（不在 projectRoot、被判方不经手）派生，`rm -rf .specify/runs` 抹不掉。同时把推迟事件的审计可见性提到与降级放行同档（写 `record-workflow-run` 终态或等价记录），使"推迟"不再是零终态痕迹的静默通道。

**方案 B（备选）— 仅修 contract 断言**
把断言改为如实描述 + 登记限界。不推荐单独采用：它让文档与实现同真，但不消除 fail-open 本身。**无论采用哪个方案，contract 断言都必须改到与最终实现同真**。

### ⚠️ Phase 1 对抗审查落账：上述方案 A（两条）均被实跑证伪，已改定稿

审查档位：**Codex 配额耗尽期（2026-08-03 起）替代档位——独立子代理异构对抗 ×2 切入角**（fail-open 独立盘点 / 加固方案绕过构造），Codex 异构档位缺席。

#### 缺陷 1 方案 A（"路径字面在 transcript 出现过"）—— 证伪，弃用

红队在判定器副本上实装该加固后构造：本会话零产出、提名一个磁盘不存在的新编号目录，仅追加一句 assistant 正文「参考同类历史修复 `specs/254-fix-alpha` 的收口方式」→ 加固版仍 `exit 0 / compliant:true`；删掉这句话的对照组 `exit 2`（证明加固已生效，被绕过的是判据本身）。变体（绝对路径 + 尾斜杠、纯 `Read` 工具、引号包裹的 `grep`）全部 exit 0。

**根因**：assistant 文本块与工具输入全在被判方自由生成域内，"提及过"这一门槛没有安全下界。附带证伪：若用 `includes()` 实现，提及 `specs/254-fix-alpha-retry` 即命中 `specs/254-fix-alpha`（子串越界）。

**定稿改为方案 A′ —— 写入见证门槛**：磁盘重锚定命中的目录，必须在本会话 fix 锚点之后存在一条针对**该目录下被核验制品本身**（`fix-report.md` / `verification/verification-report.md`）的 `Write` / `Edit` 工具调用，且其 `tool_result` 非 error。

- 为何有下界：`tool_result` 由 harness 产生，被判方无法伪造成功回执；而要真拿到该回执就必须**真的写了那份制品**——伪造该证据与满足合同同价。相较之下"路径被提及"伪造成本为零。
- 为何 F256 真场景不被打回：复合命令重编号后，主线程后续必然把 fix-report / verification-report **写进新目录**，写入见证天然存在 → 仍 exit 0。
- 为何不是 F231 已证伪的"执行证据"路线：F231 证伪的是「用 tool_result 判断某条 **mv 改名命令**是否执行成功」；此处不解析任何命令、不判改名事件，只做「本会话是否写过该目录的制品」这一正向存在性判定。实施前须复读 F231 fix-report 复核边界。
- 残余限界（如实登记）：写入内容质量不在本判据管辖内（属既有判据强度问题）；且**红队实证：不经过重锚定通道，直接提名磁盘上完好的旧目录并用 `cat X > /dev/null` 满足 `BASH_WRITE_INDICATOR_REGEX` 即可 exit 0**——这是 F227「已知限界一」，本次修复不消除它，缺陷 1 的修复价值在于消除**无意误判**（本会话提名自己的新编号、磁盘恰有同名旧目录时被静默采信），而非阻止主动冒用。

#### 缺陷 2 方案 A（"在途委派陈旧度"）—— 证伪，弃用

红队实装后跑 8 轮 × 4 策略（每轮先删状态文件）：
- 开局发一次后台委派 / 每轮新发后台委派 → 加固生效（`[0,0,0,2,2,2,2,2]` / `[0,0,2,2,…]`）
- **每轮向同一 agent 再发一条 `SendMessage`** → **8 轮全 0**，陈旧度恒 0
- **每轮结尾挂一条未消费的同步 `Agent`** → **8 轮全 0**，陈旧度恒 0

**根因（结构性，换阈值无用）**：`findPendingSendMessageResumptions` 以 `to` 为键只保留**最后一次**派发行号，`findPendingBackgroundDelegations` 之外的这条规则每轮被刷新；`findTrailingUnresolvedSyncDelegation` 按设计只看末条，其 lineIndex 恒等于 transcript 末行。任何以「最早在途项行号」为基准的量都可被回退。

**定稿改为方案 A″ —— 单调不可回退的量**：上界改按 **fix 锚点之后的主线程轮次总数**计量（攻击者只能增不能减，要继续推迟就必须继续产生轮次），与既有 `IN_FLIGHT_DEFER_LIMIT` **并联取严**。阈值需实测标定（既不误伤真实等待场景，又能在有限轮内收敛），标定过程写入 plan。同时把推迟通道的审计可见性提到与降级放行同档（写 `record-workflow-run` 终态或等价记录），消除"零终态痕迹"属性。

#### Phase 2 主线程收口修正（plan 定稿后由编排器核验发现，非子代理结论）

编排器核验 plan 时以真实 fixture 为准复核判据，发现并修正两处承重缺陷（详见 `plan.md` 的「主线程收口修正 C1 / C2」）：

- **C1**：A′ 原合同要求见证目录与重锚定目标**同编号**，会把 F256 的核心正向用例（`fix-compliance-judge-cli.test.mjs` L1633-1680，T006）整个打回——该用例写的是旧编号目录制品、改名后对新目录零写入，与 plan 声称的"可接受边缘误阻断（类 X）"不是同一回事，它就是 F256 要修的场景本身。修正为**short-name 家族级见证**，两向互补合同同时满足。
- **C2**：类 X 定义随之收窄为"本会话对该 short-name 家族任一目录都无成功制品写入"。
- **实施代价登记**：既有测试 helper `TOOL_USE`（同文件 L38）不产生 `id` 与配对 `tool_result`，而见证合同要求两者。保留该要求（它是安全下界来源），改为在 implement 阶段为重锚定相关用例补齐——**不得**为省事放弃该要求，否则 `tool_use` 可被凭空伪造而不执行。

#### Phase 2 对抗审查（角度 B · 误阻断与回归面）：两条核心声明被真实语料实测证伪

审查方在系统临时目录复刻判定器 before/after，按 plan §3 实装 A′ 后跑**真实 transcript** A/B，非纸面推演。

**证伪 1 — 新增误阻断不止「类 X」，另有「类 Y · 委派写制品」**

| 事实 | 证据 |
|---|---|
| 子代理 transcript 被拆到**独立** `agent-*.jsonl` 文件，Stop hook 的 `payload.transcript_path` 只指向主会话文件 | 本机 2256 份主会话 `.jsonl` 中含内联 `"isSidechain":true` 的：**0 份**；独立 `agent-*.jsonl`：1296 份 |
| 子代理写制品是受支持的工作流形态，不是异常 | 子代理文件内命中 `specs/NNN-fix-*/{fix-report.md,verification/verification-report.md}` 的 `Write`/`Edit` 共 **71 次**，覆盖 11 个特性目录；`plugins/spec-driver/agents/implement.md` 的 `tools:` 明确含 `Write, Edit` |
| 真实会话被误阻断 | 全语料 A/B（148 份真实 fix 会话，report 模式对比）：**2 份**由 `compliant:true` 翻转为 `false`，`missing:['feature-dir','fix-report.md']` |
| 其中一份正是 F256 的取证会话本身 | `f3f2fe3b`（F254 graph-scope-extensions 三度重编）锚点后全部写入都打在 `specs/251-…`、改名后零写入——**F256 当初就是为放行这份会话而生的** |
| plan §9.1 的 T-1b 互补用例**无法暴露**这一点 | T-1b fixture 人为补了一次"改名后 Write 到新目录（带成功回执）"，与真实会话不同构 |

主线程补充判断：本报告上文的**收口修正 C1（short-name 家族级见证）救得了 `f3f2fe3b`**（它写过同 short-name 的 251 目录），但**救不了 `94c01a2c`**（F243 会话：主 transcript 只见证到 `specs/242-…`，目标是 `specs/243-fix-mjs-graph-coverage`，short-name 不同）。故 C1 修正是必要的但**不充分**——写入见证这一判据族与"子代理落盘"这一受支持形态存在结构性张力。

**证伪 2 — 阈值 200 与标定公式双双被实测打穿**

实测 149 份真实 fix 会话锚点后 assistant entry 数分布：`N=149 / P50=61 / P75=76 / P90=244 / P95=286 / P99=409 / max=647 / min=1`；`≥200` 者 17 份（**11.4%**）。

> 🔴 **第 4 轮审查更正（保留上行原文以存档，但其数字不可再用于论证阈值）**：上面那组是**旧口径**
> （以最晚锚点 `anchorLineIndex` 为基线的"锚点后计数"）的分布，而最终落地的闸门三比较的是
> `countAssistantEntriesSinceEarliestFixExpansion`（以**最早** fix 展开为基线）。两者不是同一个量。
> 用实际生效口径在同一语料重取数（两方独立复现、逐位一致）：
> `N=149 / P50=61 / P75=77 / P90=244 / P95=286 / **P99=647** / **max=801** / min=1`，`≥420` 者 **2** 份。
> 故 **420 落在约 P98.7，不是"覆盖 P99"**。取值仍维持 420（按新口径 P99=647 上调会显著削弱闸门，
> 而两份越阈会话经复算都不因此受实际影响：801 那份 `missing=[feature-dir, fix-report.md]` 不可推迟、
> 647 那份 `compliant=true` 已合规早退）。⚠️ 标定语料是活的——本行记录的 `max=647` 已被 801 超过，
> 复核须重跑取数。下文第 1/2/3 条的结论在新口径下的变化：① 200 仍低于 P90=244、误伤仍是 17 份（11.4%）；
> ② 公式基数由 409 变为 647；③ **620 在新口径下也非"仅差一份"——`≥620` 同为 2 份**。

1. 占位值 200 **低于 P90(244)**，违反 plan §4.3 步骤 3 自设的「阈值须 ≥ P99」下界近 3 倍；且 §4.3 只写了 `TODO(calibration)`，**无任何机械守卫**防止占位值被带上线。
2. 公式结果 `ceil(max(409,60)×1.5/10)×10 = **620**`，与占位值差 3.1 倍（触发 plan 自设的「差距超 2× 须解释」条款）。
3. 公式结果 **620 仍 < 实测 max=647**——用 P99 当下界 + ×1.5 余量的设计，在本语料上仍会误伤最长的那份真实 fix 会话（分布长尾极重，P50→max 跨 10.6 倍）。
4. **620 ≈ 10 倍中位会话长度**：闸门三字面"有界"成立，但实际约束力接近于无——攻击者可在约十个正常 fix 会话的篇幅内持续每轮删状态、持续推迟。R10 的措辞若不带上这个量级，读者会严重高估其强度。
5. 方法论问题：标定语料是**单机 149 份样本**，而阈值是随 plugin 发版进所有用户环境的硬编码常量，plan 未讨论外推有效性。

**其余结论（WARNING / INFO，已核实，implement 阶段须落实）**

- **W1**：§4.4「不设幂等标记、单会话最多写 3 条 paused 终态」的论证前提错误——攻击者每轮删状态时 `countBudgetLeft` 恒真，每轮都会写一条终态，上界是"阈值内能塞下多少次 stop"而非 3。方向仍是"多写审计"（安全），但论证须与 R10 同真，且这构成一条被判方可主动放大同步 Stop hook 落盘量的通道。
- **W2**：至少 2 条漏网变异——(a) 向 `ARTIFACT_WRITER_TOOL_NAMES` 增补 `'Read'`（"读过即算见证"，实测真实会话 Read 触及制品 15 次）全部 17 条用例仍绿；(b) 把 `POST_ANCHOR_ENTRY_DEFER_LIMIT` 改成极大值等价于删除闸门三，无任何变异覆盖。建议 export 常量并补数量级断言。
- **W3**：§5.1「无新放行出口」**经核实成立**（`.filter` 收窄、`&&` 取严、`recordDeferTerminal` 的 catch 不改控制流、`runReport` 确不触达）。但 `main()` 顶层 `catch { return 0 }`（L615-626）会把新代码的运行期异常静默转成放行——§8 必须显式写明 `witnessAbsent` 的声明位置与初值，否则误放进 `if` 块内会产生 `ReferenceError` → exit 0。
- **W4**：诊断码误落 `transcriptDiagnostics` 的风险**已被 T-1a 覆盖**（低于 plan 的担忧程度）；但 schema enum 同步用例（`fix-compliance-judge-cli.test.mjs:1591-1600`）是逐码硬编码断言，新增诊断码不会被自动守住，须落实扩展。
- **I1**：「short-name 分支与 F224 分支互斥」**经核实成立**（L195 要求 `ambiguous===false`，L239 要求 `true`）；「`--mode report` 零落盘」成立。「F216 不受影响」结论方向对，但"等于 F256 之前的行为"措辞不精确——实跑 after 的 `missing=['feature-dir','fix-report.md']`，F256 之前同场景是 `['fix-report.md']`。
- **I2 / I3**：`file_path` 字段名与 §3.4 的 `resultByToolUseId` 配对写法**均在真实语料上验证有效**（140/149 会话成功建立见证，233 次主线程制品写入，配对无系统性失配）。
- **I4**：`isError: block.is_error === true`（core L446）——缺省字段按**成功**处理，与真实 wire format 一致；须在 JSDoc 点明，防后人误改成 `isError === false` 导致大规模误阻断。

#### Phase 2 对抗审查（角度 A · 绕过构造面）：又两条 CRITICAL

**CRITICAL-1 · 原 A′（同编号见证）的采信正支结构性不可达 ⇒ 等价于静默删除 F256**

演绎证明：见证条件用 `ANCHORED_ARTIFACT_PATH_REGEX` **全串**匹配 `input.file_path`，提名条件用 `ARTIFACT_PATH_REGEX` **子串**匹配同一字段，且二者由 `resolveFeatureDirCandidate` L1156 的同一个守卫喂入 ⟹ **见证集合 ⊂ 提名集合** ⟹ 被见证目录必进 `candidateHistory` ⟹ judge L196-202 的 F227 历史兜底（在短名分支**之前**、用**同一个** `usable()` 谓词）先手命中 ⟹ 「能进入短名分支」⟺「历史中无一可用」⟹ `usableMatches ∩ witnessed = ∅`。

实跑佐证：576 组排列穷举（3 写入目标 × 2 制品 × 2 路径形态 × 4 改名命令 × 3 时序 × 4 磁盘布局）插桩 `witnessMatches.length > 0` —— **0 次命中**。且 plan §9.1 的 T-1b 在「短名分支整体关闭」的变体上**仍 exit 0**，证明它根本没走短名分支 ⇒ **T-1b 是假绿，M1 变异也不会让它转红**。

> **主线程判断（承重）**：该不可达证明**只对同编号见证成立**。本报告上文的**收口修正 C1（short-name 家族级见证）**破掉它——被见证的目录（如 `specs/251-fix-foo`）自身**可以不可用**（已被 `git mv` 移走），F227 兜底因此不命中、流程进入短名分支，而家族见证（short-name `foo` 在见证集合内）仍成立 ⟹ 采信 `specs/254-fix-foo`，正支可达。⚠️ 两位审查方都是在 C1 修正**写入之前**派出的，故其结论基于原始 A′。**该推理必须由 implement 阶段以实测证伪/证实，不得凭推理落地**：验收硬要求是「关闭短名分支的对照变体上 T-1b 必须转红」，否则仍是假绿。

**CRITICAL-2 · 闸门三的计量基线可被会话内合法推后 ⇒ 单调性失效**

`countPostAnchorAssistantEntries` 的单调性依赖"锚点固定"，但锚点取的是 `detectFixSkillExpansion` 的**最晚一次**展开，而 agent 自己调 `Skill(spec-driver-fix)` 即可把锚点推到末尾、同时保持 `isFix=true`，计数归零。

实跑（每轮均删状态文件，`RT_ENTRY_LIMIT=10` 等比缩放）：

| 组 | 每轮 exit code | postAnchorAssistantEntries |
|---|---|---|
| 对照（不重展开） | `0 0 2 2 2 2 2 2` | 4→7→10→…→25 |
| **攻击（每轮重展开）** | **`0` ×30（30/30）** | **恒 4** |

每轮成本约 3 个 entry：① 重新 `Skill(spec-driver-fix)`；② 对制品做一次 `Write` 重提名（否则 `missing` 混入 `feature-dir` 变不可推迟）；③ 末条挂未消费同步 `Agent`。⇒ contract §6.3 草稿的「任一会话在推迟通道内停留次数有限」**为假**，R10 的有界化结论失效。plan §4.1 只登记了 compaction，**漏了锚点本身可移动**。

**修法（定稿）**：闸门三的计量基线改用**锚点无关的单调量**——transcript 内 assistant entry **总数**，或以「**最早**一次 fix 展开」作为闸门三专用基线。⚠️ **不得改动 `detectFixSkillExpansion` 的主锚点语义**（会牵动 F216/F227 全链）。

**其余（implement 须落实）**

- **W-A1 见证不绑定终态**：`Write` 拿到成功回执后 `git checkout --` 回滚，或先 `Read` 再写回逐字节相同内容——磁盘零变化、回执为真，见证仍成立（F227「终态存在性 ≠ 历史事件」的镜像）。C1 修正让正支可达后**这条即变承重**，须如实登记为残余（伪造成本仍高于 F227 限界一，不构成新的最廉价路径）。
- **W-A3 `tool_use.id` 复用击穿配对**：`Write(目标制品, id='X')` 得 `is_error:true` → 任意无关工具复用 `id='X'` 得成功回执 → 见证成立。且 §3.2 合同「存在某条 toolResultBlock」与 §3.4 Map「后写覆盖」语义**不同真**。**定稿**：改取「该 id 的**全部**回执均非 error」，合同与实现同步改。
- **I-A2 配对表建表面收窄**：`normalizeTranscriptEntry` 会把 assistant envelope 内的 `tool_result` 也收进 `toolResultBlocks`，实测 assistant 自带 tool_result 即可发证。当前 wire format 下模型无法产出该块型，属纵深防御——建议配对表**只从非 assistant envelope 建**。
- **I-A1 §3.3 路径归一化表经实测稳固，不需改**：`//`、`..` 中段、`./`、尾随空格、`Specs/` 大小写、`specs/254-fix-Alpha`、跨仓绝对路径 7/7 全 fail-closed；正例 3/3 命中；全角与 NFD 变体因 `[a-z0-9-]` 字符类天然不匹配。
- **I-A4 一条顾虑经实测证伪**：sidechain assistant entry 并不主导闸门三计数——149 份 fix 会话锚点后 13564 条 assistant entry 中仅 76 条（**0.6%**）带 `isSidechain:true`。
- **I-A5 回归对照成立**：F224 伪造光杆 `mv` 通道、健康合规会话零落盘、坍塌会话 exit 2 三项在 base 与补丁上一致；**§5.1「无新 `return 0`」经两位审查方独立核实成立**。
- **I-A6 §4.4 审计提档确实有效**：攻击组 5 轮产生 5 条 `result:'paused'` 的 `workflow-run-summary` + 5 条 verdict 事件 ⇒ CRITICAL-2 的永久放行**不是零痕迹**，只是退出码恒 0。

#### Phase 3 实施实测：C1 假设被证实，但成立条件比纸面推理窄（新增残余 R11）

主线程 Phase 2 的 C1 修正曾声称「家族级见证救得了真实会话 `f3f2fe3b`」，并要求 implement 阶段实测而非凭推理落地。**实测结果：直接跑会红。**

取证（探针直读该真实 transcript）：四次合格写入全部存在、`id` 齐全、回执非 error、落在 user envelope——

```
line 132 Write toolu_01C664… /Users/…/worktrees/serene-taussig-2c33c3/specs/251-fix-graph-scope-extensions/fix-report.md
line 282/338/381 Edit（同路径）
```

**唯一不满足的是绝对路径前缀**：该会话 `cwd` 是 `worktrees/serene-taussig-2c33c3`，而回放时 projectRoot 是沙箱路径，归一化按设计 fail-closed 拒收 projectRoot 之外的写入（正是安全性质本身）。这是**测试夹具的跨仓错位，不是生产误阻断**——生产上 hook 的 projectRoot 恒等于会话 cwd。修法：给 `truncateRealTranscriptAt` 加可选 `replayRoot`，把 transcript 自身 `cwd` 字段的原始根串整体替换为回放根。改根后三条全绿。

⇒ **C1 假设由实测证实，成立条件是「会话根与判定根一致」**。

**新增残余 R11**：若 hook 被以异于会话 cwd 的 `--project-root` 调用（或项目中途被移动/改名），以**绝对路径**写下的制品见证会静默落空 → 误阻断。方向 fail-closed、补救成本低（补一次相对路径写入即恢复），已写进 contract。

#### Phase 3 对抗审查（第三轮红队 · 绕过构造面）：本次改动**引入**一条 CRITICAL，已修

**CRITICAL-1 · 见证制品类与采信谓词不同源 ⇒ 用 `verification-report.md` 白嫖见证**

见证正则 `ANCHORED_ARTIFACT_PATH_REGEX` 收 `fix-report.md` **和** `verification/verification-report.md` 两类，而采信闸门 `usable(dir)` **只查 `fix-report.md`**。攻击者据此写一份 1 字节的 `verification-report.md` 到一个全新编号目录 → **拿到见证、但该目录不 usable** → F227 历史兜底只挑 usable 者故不选它 → 控制流照旧进入短名分支 → `witnessedShortNames.has(shortName)` 成立 → 重锚定到磁盘上本会话从未触碰的旧目录 → `compliant:true` → 合规早退（在任何 `appendAuditEvent` 之前）→ exit 0 零审计。

| 场景 | exit | verdict |
|---|---|---|
| S1 攻击：Write 垃圾 `verification-report.md` 到 999 | **0** | `compliant:true, missing:[], diagnostics:[]` |
| **W1 攻击变体**：同上 + 写完 rollback，磁盘上 999 完全不存在 | **0** | 同上，磁盘零痕迹、审计零事件 |
| W2 用 `Edit` 代替 `Write` / W5 绝对路径见证 | 0 | 同上 |
| S2 对照：同构但回执 `is_error:true` | 2 | `feature-dir-witness-absent` |
| S3 对照：写非制品文件 | 2 | `missing:[feature-dir, fix-report.md]` |
| S4 对照：写 `fix-report.md` 空壳 | 2 | 空壳成可用主候选，被拦 |

四条对照全 exit 2，排除构造错误。**W1 与本次要消除的失效模式完全同形**（零产出 + 静默放行 + 事后零线索）。

🔴 **本轮最值得记的教训**：漏洞不在实现，而在**实现注释里那段看起来很严密的演绎证明**——它把「属于 `candidateHistory`」当成了「`usable`」，而 576 组穷举恰好没覆盖破绽形态，于是**形式证明与实证互相背书出了一个假结论**。⇒ 判定器类改动中，凡靠「集合包含 ⟹ 某分支先手命中」论证不可达之处，**必须单独验证被包含方是否满足该分支的额外谓词**。

**修法（已执行）**：见证的制品类收窄为**只认 `fix-report.md`**，与 `usable()` 谓词同源。F256 正向场景不受损（真实场景里旧目录本来就写过 `fix-report.md`，只是被 `git mv` 移走故不 usable）。

🔴 **收窄后必须如实登记的残余（不得写成"已消除"）**：「Write `fix-report.md` 拿回执 → 立即删掉」仍能拿到见证（W1 已实证）。即原先登记为边角限界的「**见证不绑定终态**」（判据看 transcript 历史、制品判据看磁盘终态，二者时间解耦——F227「终态存在性 ≠ 历史事件」的镜像）**升级为承重逃逸面**。收窄只是把攻击成本从"写一份垃圾"提到"写一份垃圾再删掉"。

**WARNING-1 · 新增扫描把最坏耗时翻倍至 ~20s（同步 Stop hook）**

`countAssistantEntriesSinceEarliestFixExpansion` 对 user 文本块再跑一遍 `SKILL_EXPANSION_REGEX`，其 `([^\n]+?)\/skills\/` 惰性量词遇到重复的 `Base directory for this skill:` 诱饵前缀 + 长文本时退化为 O(K×N)。A/B（8.1MB transcript，4000 个诱饵 + 末尾真展开）：`HEAD 10188ms → WORKING 19785ms`。正常形态无问题（14.1MB / 2 万次 Write+回执 = 184ms；30MB / 20 万条回执 = 22ms；200 万字符 `file_path` = 34ms，锚定正则确无灾难性回溯）。

基数是既有的（HEAD 已 10s），但本 diff **成倍放大**，且 `break outer` 早退在诱饵位于真展开之前时完全失效。JSDoc 写「无嵌套量词」为真，但据此推出的性能安全结论为假。**已修**：改为一次扫描同时产出最早/最晚展开，消除第二遍。可达性诚实登记：诱饵须落在 **user role** 文本块，审查方未构造出 agent 自主注入 user-role 文本的路径 ⇒ 更像可用性/DoS 面而非主动绕过面。

**经实跑确认成立的防线（构造失败，非未尝试）**：`tool_use.id` 全称判据双向均 exit 2（重复 id 击穿失败）；回执表只从非 assistant envelope 建（W4 exit 2）；缺回执 fail-closed（W8 exit 2）；见证须在 fix 展开之后（W7 exit 2）；相邻 short-name 不串味（W6b exit 2）；`..` 段拒收（W9 exit 2）；闸门三边界精确（418 → 推迟 exit 0，503 → 裁决 exit 2，证明是 AND 非 OR）；连续 6 轮删状态 6/6 exit 0，与注释「把永久免于裁决降级为约 140 轮内免于裁决」**完全一致、无 over-claim**；闸门三基线攻击构造失败（两函数同正则同 role 过滤，构造不出"主锚点认得出而基线认不出"的输入）。

**CRITICAL-2（既有面，非本 diff 引入，归入另案）**：会话末尾展开**另一个** spec-driver 技能（如 `spec-driver-implement`）即令 `isFix=false`、整体卸载门禁，连三道闸门都不进（实跑 exit 0；对照不展开 exit 2）。这与上文 N2 同族。审查方诚实登记：只在判定器层面实证（伪造 user-role 展开文本即生效），**未**端到端验证 Claude Code 在 agent 自调 `Skill()` 时是否真会注入该 user 文本。建议另开 fix 卡先做端到端验证；若成立，闸门三注释里"删状态文件是最安静通道"的说法需修订。

#### 🔴 超出本 Feature 范围的新发现（不在本次修复，建议另开 fix）

对抗审查角度 1 独立盘点判定器全路径，另发现 3 条 **CRITICAL**，均**不在**本任务指定的两条缺陷内：

| 编号 | 缺陷 | 证据 | 处置 |
|------|------|------|------|
| N1 | **空 / 被截断的 transcript → exit 0 且零审计**：`readTranscriptEntries` 对"文件存在但无非空行"返回空 entries 且无诊断 → `isFix=false` → runHook 在 `appendAuditEvent` 之前早退，`.specify/runs/` 根本不被创建 | 实跑：空文件 / 纯空白文件均 exit 0，零落盘 | **建议另开 fix**。判定器行为已验证；"宿主是否会重写被截断的 transcript"未验证 |
| N2 | **锚点可被后续 skill 展开翻转 → exit 0 且零审计**：`detectFixSkillExpansion` 取**最晚一次**展开且不区分 mode，fix 会话收尾调一次 `Skill(spec-driver:spec-driver-sync)` 即令 `anchor.mode='sync'` → `isFix=false` → 同上零审计早退 | 实跑 exit 0，零落盘 | **建议另开 fix**。成本仅一次工具调用，且形态完全无恶意（"修完顺手跑个 sync"） |
| N3 | 伪造光杆 `mv` → `feature-dir-unresolvable` 降级放行 | 实跑 exit 0，磁盘零制品 | **已是 F224 登记的「已知限界二」**，代码注释已标注"已另开独立跟进项"，非新发现 |

N1 / N2 的共同结构缺陷与本 Feature 同源——**runHook 的早退发生在审计落盘之前**，凡从这两条出去的会话事后完全不可见。审查方给出的最小收口建议：把 `!isFix` 早退中「transcript 里**曾经**出现过 fix 锚点、但最终锚点不是 fix」这一子情形改为必须落审计事件，并给 `entries.length === 0` 一个独立诊断码；该判别是肯定命题，不破坏 US5「健康的非 fix 会话零落盘」。

未纳入本次的理由：范围由任务显式指定为两条 fail-open + 一项附带；N1/N2 触及 runHook 早退语义与 US5 零落盘契约，与本次两条改动不同轴，混做会让验证面翻倍且互相掩盖。

其余 WARNING 级发现（状态文件可自助改写、存储不可用即降级、20MB transcript 越限、委派判据纯文本 Goodhart）均为**既有面**，非本次引入，一并记录待后续分流。

#### Phase 4 三份独立审查：补登记四条残余（生产逻辑零行为改动）

三份审查（spec-review / quality-review / verify）一致确认**两条安全判据本身经核实成立**，
未发现新的绕过面；问题集中在"代码里已登记、canonical 制品未登记"的文档同步面。
以下四条此前只落在 contract 与代码注释里，**本报告（canonical 制品）漏登**，现补齐：

| 编号 | 残余 | 方向 | 处置 |
|------|------|------|------|
| **类 X-b** | **制品经 `Bash` 写入 → 误阻断**：提名侧与见证侧在**两个维度上不对称**——工具集上提名侧 `resolveFeatureDirCandidate` 接受 Bash 写入（`hasBashWriteIndicator`：`>` / `>>` / `<<` / `tee`），见证侧只接受 `Write` / `Edit`；制品类上提名侧的 `ARTIFACT_PATH_REGEX` 还收 `verification/verification-report.md`，见证侧只收 `fix-report.md`。第 4 轮实跑复现：`cat > specs/251-fix-bar/fix-report.md <<'EOF'` 写制品 → 委派齐全 → 复合命令 `git mv` 重编到 254 → 磁盘 254 制品齐备，结果由 `compliant:true` 翻转为 `compliant:false, missing:[feature-dir, fix-report.md], diagnostics:[feature-dir-witness-absent]`。**流程完全无恶意** | fail-closed | 🔴 **取舍不是 bug，不得为它放宽见证判据**：收 Bash 会让 `cat X > /dev/null` 零成本发证（= F227 已知限界一形态），见证退化为"格式"；收 `verification-report.md` 则直接复活第 3 轮红队实证的绕过链。补救：对家族内任一目录的 `fix-report.md` 做一次 `Write`/`Edit` |
| **类 X 形态 3** | **会话中途重新展开 fix skill → 见证恒空**：见证窗口下界用 `anchor.anchorLineIndex`（**最晚**展开），与闸门三刻意取**最早**展开作基线**方向相反**。故中途再次 `Skill(spec-driver-fix)` 时，此前对制品的**合法** `Write` 落到新窗口外 → `feature-dir-witness-absent` | fail-closed | 🔴 **不对称是刻意的、两侧各自 fail-closed**：见证用最晚锚点 ⟹ 重展开只**收窄**见证（更难放行）；闸门三用最早展开 ⟹ 重展开无法清零计数（更难推迟）。若把见证窗口也改成最早展开，锚点前的陈旧写入会重新计入见证，放宽的是**放行**方向 |
| **R11-b** | **见证路径归一化的 symlink / realpath 分歧 → 见证恒空**：`normalizeArtifactWritePath` 按 core **零 I/O** 契约做纯字符串前缀剥离、不做 `realpath`，而提名侧是**子串**匹配、完全不看根。故 `projectRoot` 与 `file_path` 在软链层面不同源时（macOS 的 `/tmp` ↔ `/private/tmp`、`/var` ↔ `/private/var`，或项目挂软链下）**提名成立而见证恒空** → 误阻断。语料中确有 `cwd=/private/var/folders/...` 形态的会话 | fail-closed | **不修**：引入 `realpath` = 引入 fs I/O，破坏 core 零 I/O 契约（判定器跑在**同步** Stop hook 上，该契约承重）。生产风险已被压低——`stop-fix-compliance-check.sh` 以 `--project-root "$(pwd)"` 调用、与会话 cwd 同源；代价有界（`BLOCK_LIMIT=2`）。与 R11 同源，触发面从"判定根错位"扩到"软链不同源" |
| **adoption 指标污染** | **`recordDeferTerminal` 的 `runId` 与 fix skill 不同源**：判定器写 `runId = sessionId`，而 `skills/spec-driver-fix/SKILL.md` 收尾用 `--run-id "{branch_name}"`；`generate-adoption-insights.mjs` 的 `dedupeRunEvents` 按 `(workflowId, runId)` 去重 ⟹ 落在**不同 key**。每个发生过推迟的 fix 会话会额外贡献一条独立的 `paused` run（同会话内多次推迟被折叠为 1 条，取最晚者），使 `totalRuns` 上浮、`successRate = success / totalRuns` 被下压 | 指标失真（非安全面） | **不修**：`releaseDegraded`（F208）早有同样写法，**非本次新引入的模式**；但降级放行罕见、推迟是常规路径，量级不同故显式登记。改 `runId` 要同时动 adoption 脚本与 skill 的 `--run-id` 契约，超出本次范围。**闭合方向二选一**：① `runId` 与 skill 对齐；② adoption 侧排除判定器写入的合成终态 |

另需接续登记：上文 **CRITICAL-2**（会话末尾展开另一个 spec-driver 技能 → `isFix=false` → 门禁整体卸载）
**属既有面、非本次引入**，与 N2 同族，已列为独立跟进项；它直接影响闸门三"约 140 轮"这个量级该怎么读——
若该路径端到端成立，则"删状态文件是最安静通道"的说法需修订。已同步登记进 contract 的已知限界。

Phase 4 另修正的三处文档失真（不涉及判据变更）：contract 里"同编号版本结构性不可达 / 576 组穷举"
的演绎理由（已被第 3 轮实证证伪、代码侧早已删除）、contract 里"闸门三自带基线扫描 / 不得合并"
（与实现相反，照做会回滚性能修复）、以及常量由 `POST_ANCHOR_ENTRY_DEFER_LIMIT` 改名为
`EARLIEST_FIX_ENTRY_DEFER_LIMIT`（旧名精确指向已被证伪的错误语义；**取值仍为 420**）。

### 附带项

`copyTree` 增加子路径排除能力，`.claude` 拷贝时排除 `worktrees`（`cpSync` 的 `filter` 选项即可），使耗时与 worktree 数量解耦。

---

## Spec 影响

需要更新的 spec / contract：

- `specs/208-fix-compliance/contracts/fix-compliance-judge-cli.md`：推迟通道的无条件断言必须与实现同真（**必改**）
- `specs/256-fix-compliance-false-blocks/`：F256 已登记的限界条目需回指本 Feature 的收口结论（如实登记，非改写历史）
- 本 Feature 自身的 `plan.md` / `tasks.md` / `verification/verification-report.md`（后续阶段产出）

---

## 严重度判定（如实登记）

- **缺陷 1：high / major，不是 critical。** 触发前置条件是磁盘上存在同 short-name 不同编号的 fix 目录；本仓当前 **81** 个 `NNN-fix-*` 目录的 short-name **实测无一重复**（`ls specs | grep -E '^[0-9]+-fix-' | sed -E 's/^[0-9]+-fix-//' | sort | uniq -d` 输出为空），前置条件尚未成立。但失败方向是静默放行、且正是 F208 要拦的"声称修好了但零产出"形态，故必须收口。
- **缺陷 2：high。** 无需任何前置条件，一条 `rm -rf .specify/runs/.fix-compliance-state` 即触发，且可作为无恶意的"清理本地运行态"动作自然发生。
- **附带项：low（工程稳定性）。** 不影响判定正确性，只影响门禁可用性（超时假红），但同根因已第二次复发。
