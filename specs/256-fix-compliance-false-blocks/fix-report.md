# 问题修复报告 — fix 依从性判定器两处误报盲区

## 问题描述

spec-driver 的 Stop hook `hooks/stop-fix-compliance-check.sh`（薄壳，真实判定在
`plugins/spec-driver/scripts/fix-compliance-judge.mjs` + `lib/fix-compliance-core.mjs`）
在 2026-08-04 的 F254 交付中出现两类误报阻断：

1. **盲区 1**：特性目录因 Feature 编号撞号被 `git mv` 重编（251→252→253→254）后，判定器仍按
   transcript 里的旧路径撞磁盘核验，报「未建立特性目录」+「缺少诊断报告」，而制品实际齐备。
2. **盲区 2**：verify/review 子代理在后台在途执行期间，主线程每次 stop 都被拦截，报
   「缺少验证报告」+「缺少 verify 类委派」，属流程摩擦而非真实烂尾。

## 证据基线（本次诊断的取证方式）

不依赖复述，直接取 F254 交付 worktree 的**审计事件**与**原始 transcript** 复现：

- 审计事件：`.claude/worktrees/serene-taussig-2c33c3/.specify/runs/2026-08.jsonl`
- 原始 transcript：`~/.claude/projects/-Users-...-serene-taussig-2c33c3/f3f2fe3b-5458-4dbe-8dab-cb9fb6e3966a.jsonl`（649 条，2.3 MB）

12 条 `fix-compliance-verdict` 事件中，误报聚成两个签名：

| 签名 | missing | closureForm | 次数 | 归属 |
|------|---------|-------------|------|------|
| A | `feature-dir`, `fix-report.md` | undetermined | 5 | 盲区 1 |
| B | `verification-report.md`, `delegation:verify` | repair | 2（+4 次降级放行） | 盲区 2 |

用 `--mode report` 对真实 transcript 回放，签名 A 逐字复现：

```
missing: ["feature-dir","fix-report.md"], delegationCounts: {implement:1, verify:3, other:3}
```

## 5-Why 根因追溯 — 盲区 1（重编号后按旧路径误报）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何报「未建立特性目录」？ | 候选解析出 `specs/251-fix-graph-scope-extensions`，磁盘上该目录不存在（实为 `254-`） |
| Why 2 | 候选为何停在 251？ | `resolveFeatureDirCandidate` 的改名跟随（F224 FR-001）未产生任何改名事件 |
| Why 3 | 改名事件为何为 0？ | 三次重编都是复合命令：`cd "<worktree>" && git mv specs/251-... specs/252-... && FILES=(...)`；`scanRenameCommandEvents` 对三条均返回 `[]` |
| Why 4 | 复合命令为何不被跟随？ | F231 第 5 轮把改名跟随判据收窄为「整条命令必须就是一条光杆 `mv`/`git mv`」，`prep && mv` 明确列为已知限界，方向刻意 fail-closed |
| Why 5 | 为何 F227 的候选历史兜底没救回？ | `candidates` 历史只记录「曾被合法提名过」的路径，本次只有 251 一个，且它已随重编从磁盘消失 → `usable()` 全假，兜底空转 |

**[ROOT CAUSE REACHED at Why 5]**

**Root Cause**：特性目录的定位**只有 transcript 一条事实源**——候选必须由 transcript 里的写入提名
或可被静态识别的改名命令推导。当重编号以复合命令完成（F231 为关闭 fail-open 而刻意不跟随的形态），
transcript 侧的候选就永久停在已消失的旧路径，判定器没有任何**磁盘侧**的重新锚定手段，
于是拿死路径撞核验，把「目录改了名」误判为「目录不存在」。

**Root Cause Chain**：报未建立特性目录 → 候选=251 已从磁盘消失 → 改名事件 0 →
复合命令不满足 F231 光杆白名单（有意的 fail-closed）→ 候选历史仅含同一死路径 →
**判定器缺少 transcript 之外的目录重锚定通道**

## 5-Why 根因追溯 — 盲区 2（在途委派被判烂尾）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何报「缺少 verify 类委派」？ | 该 stop 时点 `counts.verify === 0`（截断回放实测：仅 plan/tasks/implement 三条委派） |
| Why 2 | verify 工作明明在跑，为何没被计数？ | 该轮 verify/复审工作是**通过 `SendMessage` 恢复后台子代理**执行的，不是新的 `Agent` 调用 |
| Why 3 | `SendMessage` 为何不算委派？ | `DELEGATION_TOOL_NAMES` 只有 `{Agent, Task}`；`SendMessage` 完全不在抽取面内 |
| Why 4 | 就算不算委派，为何要判不合规？ | 判定器把「此刻尚未看到收口证据」等价于「本次会话烂尾」，二值化，没有第三态 |
| Why 5 | 为何没有第三态？ | F208 判据设计假设 stop 时点=会话终态；但后台委派使 stop 成为**中途停顿**，会话仍有未回收的在途工作 |

**[ROOT CAUSE REACHED at Why 5]**

**Root Cause**：判定器把 stop 一律当作会话终态做二值判定（合规 / 不合规），缺少
「**判定时机未到**」这一第三态；同时委派抽取面漏掉了 `SendMessage` 这一后台子代理驱动方式，
使「已派工、结果未回」的中途停顿被误分类为「零 verify 委派的烂尾」。

**Root Cause Chain**：报缺少 verify 委派 → 该轮 verify 经 SendMessage 恢复后台代理执行 →
SendMessage 不在委派白名单 → 且判定器无「在途」概念 → **中途停顿被当作终态判定**

## 关键取证：在途委派在 wire format 上的真实形态

原始 transcript 实测（全量 649 条）：后台 Agent 0 个、同步 Agent 7 个、`SendMessage` 7 个、
`<task-notification>` 用户消息 10 条。F254 的复审全部走 `SendMessage` → 后台恢复：

```
SendMessage(to: "ad602324a1dd9715a") → tool_result:
  {"success":true,"message":"Agent \"ad602324a1dd9715a\" had no active task;
   resumed from transcript in the background with your message. You'll be notified when ..."}
```

完成信号是后续 user 文本块里的 `<task-notification>`，其中 `task-id` = 该子代理 id、
`tool-use-id` = 原始 Agent 调用 id。

**这直接证伪了任务描述里建议的检测方式**：「已发出但尚无对应 tool_result 的 Task 调用」
在 F254 完全不成立——`SendMessage` 立刻拿到了 ack tool_result，在途性体现在
**尚未到达的 task-notification**，而非缺失的 tool_result。仅按「缺 tool_result」实现会 0 命中。

### 检测判据（对全部 6 次误报 stop 逐点验证）

按下述三条规则原型化并在真实 transcript 上按时间戳截断回放：

- 同步 `Agent`/`Task`：停在 transcript 末条且无配对 tool_result → 在途（覆盖 transcript 截断）
- 后台 `Agent`/`Task`（`run_in_background === true`）：**自身有非错误 tool_result 回执**且无
  `<tool-use-id>` 匹配的通知 → 在途
- `SendMessage(to: A)`：**自身有非错误 tool_result 回执**且 A 的最后一次派发晚于 A 的最后一次
  `<task-id>` 通知 → 在途

后两条的"自身须有非错误回执"是同一道有效性门槛（修复轮补齐，初稿只给规则 3 设了）：
不设它，一次被拒或未被受理的派发即可让门禁永久推迟。

| stop 时点 | 在途数 | 归属签名 | 检测器行为 |
|-----------|--------|----------|------------|
| 16:32:26 | 1 | B | 命中 → 放行 |
| 16:33:41 | 1 | B | 命中 → 放行 |
| 16:48:49 | 1 | B | 命中 → 放行 |
| 03:03:46 | 0 | A | 不命中 |
| 03:05:02 | 0 | A | 不命中 |
| 03:07:22 | 0 | A | 不命中 |

计数口径说明（诊断初稿曾把 16:48 记为 2，实现阶段实测订正为 1）：`SendMessage` 在途按
**agent 去重取末次派发**（同一 agent 连派多条只算一次在途），而非逐次派发计数。判定路由只看
集合是否非空，故该口径差异不影响任何裁决；上表已按最终实现口径修正。

**两处修复正交，互不遮蔽**：在途检测器在盲区 1 的三个 stop 上恒为 0，不会把盲区 1 悄悄"顺手治好"
而掩盖其真实修复；盲区 1 的目录兜底也不参与盲区 2 的判定。二者可独立测试、独立回归。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | `evaluate()` 磁盘兜底段 | 候选不可用时仅回溯 `candidates` 历史 | 追加 short-name 磁盘兜底（盲区 1） |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | `runHook()` 路由 | 不合规即进 `routeBlock` | 在途且两道闸门通过时推迟为 warn，不消耗阻断预算（盲区 2） |
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | `DELEGATION_TOOL_NAMES` 附近 | 委派抽取面无在途概念 | 新增在途委派纯函数 + 可推迟缺口白名单（盲区 2） |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | featureDir 组 | 无按 short-name 枚举目录的能力 | 新增只读目录枚举（盲区 1） |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | BlockCountState 组 | 状态只有 `blockCount` 一个预算 | 新增分列字段 `inFlightDeferCount`（盲区 2 有界化；缺字段按 0 向后兼容） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `fix-compliance-core.mjs` | `scanRenameCommandEvents` | 光杆命令白名单 | **安全，刻意不动**——F231 已三次实测证伪放宽路线（执行证据／结构黑名单／结构白名单），本次改从磁盘侧兜底，不回头放宽 bash 解析 |
| `fix-compliance-judge.mjs` | F227 `usable()` 兜底 | 候选历史回溯 | 保留，新兜底串接在其后，不改其语义 |
| `fix-compliance-core.mjs` | `VERIFY_ROLE_REGEX` | 「复审」「复核」不命中「审查」 | **本次不改**：属角色词表宽度取舍，与两处盲区无因果关系；放宽词表会同时放宽合规判据，应独立立项 |

### 同步更新清单

- 调用方：`evaluate()` / `runHook()` 为判定链路唯一消费点，无外部调用方
- 测试：`fix-compliance-core.test.mjs`（在途纯函数）、`fix-compliance-io.test.mjs`（目录枚举）、
  `fix-compliance-judge-cli.test.mjs`（两条端到端复现用例 + fixture）
- 文档：`contracts/fix-compliance-judge-cli.md` 场景表 + 「在途判据」节（含两道闸门与实测数据）、
  `contracts/fix-compliance-verdict-event.schema.json` 的 `diagnostics` enum 需加
  `delegation-in-flight` 与 `delegation-in-flight-budget-exhausted` 两个诊断码、
  `specs/208.../spec.md` 的 FR-015 行为矩阵需登记这条非阻断出口
- 合同：新增诊断码必须与 schema enum 同步（既有合同同步用例会遍历校验）

## 修复策略

### 方案 A（推荐）：磁盘侧重锚定 + 在途第三态

**盲区 1 — short-name 磁盘兜底**（落在 judge 的磁盘层，core 保持纯函数）：
在既有 F227 候选历史兜底之后串接一级：候选仍不可用且 `ambiguous === false` 时，
取候选的 short-name（`specs/NNN-fix-<short>` 的 `<short>` 段），在 `specs/` 下枚举
`NNN-fix-<same-short>` 形态的目录，取**磁盘存在且含 `fix-report.md`** 者中编号最大的一个。

单调性论证（沿用 F227 已确立的不变量）：
- 仅在主候选**不可用**时介入 → 健康路径逐字不变
- `ambiguous === true` 时完全不介入 → F224 降级通道逐字保留
- 只可能把「改动前阻断」转为「改动后放行」，绝不产生新的误阻断

安全边界：要求 short-name **完全相等**，不做模糊匹配，候选无法漂移到无关特性；
沿用与 F227 相同的 `usable()` 谓词（须含 `fix-report.md`）。

已知限界（如实登记，非本次消除）：这把 F227「已知限界一」（冒用磁盘上已存在且制品齐全的
历史目录）从"必须精确提名该目录"放宽到"提名同 short-name 的任一编号"。这是**已被用户接受的
同一类限界**的边际扩大，不是新开的攻击面：冒用者原本直接提名目标目录即可达成同样效果，
无需借道本兜底。

**盲区 2 — 在途 = 判定时机未到**：
新增 core 纯函数按上述三条规则求"在途委派"。`runHook` 中：verdict 不合规 **且** 存在在途委派
**且两道闸门均通过**时，不进 `routeBlock`，改为
(1) 落审计事件并附诊断码 `delegation-in-flight`，(2) stderr 输出 warn 级缺口清单，(3) exit 0，
(4) **不递增阻断计数**。

#### 安全论证（初稿版本已被证伪，此为修订后的如实版本）

> ⚠️ **初稿的论证是错的，此处保留原文以便追溯**：初稿写「每个在途委派最终都会回收通知，
> 届时主线程再次 stop 时在途集合已空，门禁照常按完整判据裁决」，并据此断言推迟无需上界。
> 三路独立对抗审查各自收敛到同一个 CRITICAL，取证后确认该前提在真实数据上**不成立**。

实测取证（实扫本机 `~/.claude/projects` 全部 2466 份 transcript）：

| 指标 | 实测值 | 对论证的影响 |
|------|--------|------------|
| `run_in_background: true` 派发总数 | 202 次 | — |
| 其中**从未**收到匹配 `<tool-use-id>` 完成通知者 | **43 次（21.3%）** | 「通知必达」不是平台保证，反例自然发生率两成 |
| 不合规 fix 会话中 `missing` 为 `["feature-dir","fix-report.md"]` 却因在途被推迟者 | 9/174（5.2%） | 这类缺口子代理回收再多次也补不上，推迟纯属延误 |
| Agent 派发总数 / 其中未显式写 `run_in_background` 者 | 1293 次 / 29.2% | 当前检测面偏窄（见「已知限界」），欠触发方向 fail-closed |

第一行数据直接证伪初稿论证：**单条永不回收的后台派发即可让门禁永久放行**，且该形态无需刻意构造，
两成的自然发生率意味着它迟早会撞上。因此推迟必须**有界**，并且必须只对**在途工作真能关闭的缺口**生效。

修订后的实际设计与其成立条件：

- **闸门一 · 可推迟性**：`missing` 非空且**每一项**都属于 `{delegation:implement, delegation:verify,
  delegation:noop-verify, verification-report.md}`（`DEFERRABLE_MISSING_KEYS`）。取全称而非存在——
  只要混进一项子代理关不掉的缺口，推迟就等不到缺口自愈。
- **闸门二 · 次数预算**：会话级 `inFlightDeferCount < IN_FLIGHT_DEFER_LIMIT(3)`，且 +1 持久化成功后
  才推迟。上限取 3 是因为本 Feature 取证的 F254 会话共 3 次 stop 命中在途（见上方「检测判据」表
  签名 B 三行），既覆盖真实停顿，又使"永不回收"的派发最多推迟 3 次。
- **持久化失败即不推迟**：维持不了计数就没有上界，方向 fail-closed，与 `routeBlock` 里
  "存储不可用等同已达上限"的既有取舍同源。
- **有效性门槛对齐**：后台派发与 `SendMessage` 派发**都**要求自身已获非错误 `tool_result` 回执。
  初稿只给规则 3 设了这道门槛，规则 2 没设 —— 于是一次 `is_error` 的后台派发就能关闭门禁。

**修订后的准确表述**：本分支在「证据可能到齐、且缺口确实可由在途工作关闭」的前提下把判定推迟
**有限次**；两道闸门任一不满足即恢复完整裁决，故不存在永久免于裁决的会话。不消耗阻断预算仍是此
语义的必要组成（否则在途停顿会白白烧掉 2 次预算，使真正需要阻断时已降级放行），
但它必须与独立的推迟预算配套，而不是取代上界。

**已知限界（如实登记，本次刻意不消除）**：规则 2 只认显式 `run_in_background === true`，
而运行时的 Agent 契约是"缺省即后台"（29.2% 的派发未显式写该字段）。不放宽的理由：欠触发方向是
fail-closed（多阻断、不误放行）；F254 实际机制走的是 `SendMessage`（规则 3）已被覆盖；
放宽会把推迟面从 202 次派发扩到 1293 次的 29%，与刚有界化的推迟通道同轴叠加。
顺序约束：**先有界化，再考虑放宽**。

### 方案 B（备选，不采纳）：放宽改名跟随 / 放宽角色词表

盲区 1 改为让 `scanRenameCommandEvents` 接受复合命令中的 `mv`；盲区 2 改为把 `SendMessage`
并入 `DELEGATION_TOOL_NAMES` 并放宽 `VERIFY_ROLE_REGEX`。

不采纳理由：前者正是 F231 用十余轮对抗、三条路线实测证伪后**刻意关闭**的方向，重开即重开
fail-open；后者把"派了工"与"收了工"混为一谈——`SendMessage` 计入委派会让「派一条消息」
直接顶替「验证闭环已完成」，反而削弱判据。方案 A 把两者分别落在磁盘侧与时机侧，
不触碰任何既有合规判据的宽度。

## Spec 影响

- 需要更新的 spec：`specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md`
  （场景表补两条），`contracts/fix-compliance-verdict-event.schema.json`（diagnostics enum 补
  `delegation-in-flight`）
- 不新增 FR：两处均为既有 FR-004/FR-006/FR-007 判定链路的误报收窄，不扩张判定职责
