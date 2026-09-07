# F277 spec.md 历史引用原文核实清单

**产出时间**：2026-09-02
**基线 commit**：`e01611b2`（= 核实当时的 HEAD = origin/master）
**被核对文件**：`specs/277-spec-driver-engine-hardening/spec.md`（572 行）
**核对依据**：本 Feature 第 6 项纪律 US-6(a)「引用原文化」——引用历史内容必须附 `git show <sha>:<path>` 取得的原文片段，禁止只写结论转述。

## 本清单的性质与已知边界

1. **这是纪律对自身的 dogfood**。第 2 轮对抗实测本 spec 引用了 13 条历史结论、**零条**附原文（`grep -c '^\`\`\`' spec.md` = 0，单位：代码块围栏行）。本清单补的就是这批缺失的原文。
2. **本清单不修改 `spec.md`**。它是并行编辑中的文件，本清单只作为其证据附件存在；把原文回填进 spec.md 正文是后续步骤。
3. **枚举口径**：只收「对**历史** Feature 结论的引用」。并行进行的 F276 在 spec.md 中被提及 20 次（L180 / L192 / L279 / L368 / L392~L398 / L535 / L558），但它是**在途的同期 Feature**、不是历史结论，其事实以实时 `git diff` 为准而非 `git show` 历史原文，故不列入 H-n；本 Feature 自身（F277，L1 / L9）同理不列入。
4. **与第 2 轮审查的条数差异**：本次枚举同样得 **13 条**，但**构成不同**。第 2 轮点名的 **F176**（sonnet 编排器对「MUST 委派」0 服从）与 **F245 / F257**（新门禁自己 fail-open）在当前 spec.md 中**检索不到**（实测 `grep -c 'F176' spec.md` = 0、`grep -c 'F245' spec.md` = 0；F257 仅以「fix 形态举例」出现于 L235，不承载「fail-open」结论）。本清单以当前磁盘文本为准，另行补入第 2 轮未点名的三条：H-5（F270 reverse-census 手工版可作模板）、H-12（F229 / F256 / F257 皆为 fix 形态）、H-13（F170d harness 按 agent tools 过滤注入）。`spec.md` 未被 git 追踪（`specs/277-*` 在 `git status` 中为 `??`），无法用 git 历史复核第 2 轮所见版本，故差异原因不可考。

## 索引表

| 编号 | spec.md 引用处（行号） | 引用要点 | 状态 |
|---|---|---|---|
| H-1 | L13 / L50 / L360 / L441-446 | F270：病根 iii / v 未被任何 Phase 认领，verify 却口径「已达成」 | ⚠️ 有偏差 |
| H-2 | L62 / L217 / L361 | F270：`routeNonBlock` 是只被测试引用的死代码，测试全绿、验收通过 | ✅ 准确 |
| H-3 | L106 / L108 / L458 / L461 | F270：spec 阶段三轮异构对抗，每轮都在上一轮的修订里发现新 CRITICAL | ⚠️ 有偏差 |
| H-4 | L74 / L402 | F270：两次口头叮嘱「先落盘」都被忽略 | ✅ 准确 |
| H-5 | L119 / L123 | F270：手工 reverse-census 可直接作为模板 | ✅ 准确 |
| H-6 | L135 / L145 / L483 | F272：一次结论转述是错的，且差点进入 master | ✅ 准确 |
| H-7 | L136 / L488 | F272：同一个数字验收量被四次算错 | ✅ 准确 |
| H-8 | L137 | F264：Codex hooks 双注册根源是一条从未被运行时验证的推断前提 | ✅ 准确 |
| H-9 | L64 / L212 / L291 | F259：判据写成值枚举 ⇒ 每加一个值漏一次 | ⚠️ 有偏差（引用形式）|
| H-10 | L302 | F266：confirmed-zero 须测量正向证据 | ✅ 准确 |
| H-11 | L176 | F186 / F238：`codex-wrapper-block-sync` 门禁教训 | ⚠️ 有偏差（归因）|
| H-12 | L235 | F229 / F256 / F257 皆为 fix 形态（fix 是门禁类改动主战场） | ✅ 准确 |
| H-13 | L241 / L431 / L468 | F170d harness `--append-system-prompt` 注入时按目标 agent 的 tools 过滤 | ⚠️ 有偏差（非历史引用，应重归类）|

---

### H-1 · F270：病根 iii / v 未被任何 Phase 认领，verify 却口径「已达成」

- **spec.md 引用处**：
  - L13「F270 实证——spec 写明的病根 iii / v 从未被任何 Phase 认领，plan 既不实现也不登记裁剪，verify 阶段却仍被口径为「已达成」。这是 over-claim 的**结构性根源**」
  - L50「输出必须点名「病根 iii 与病根 v 未被任何 Phase 认领，且 plan 中无对应裁剪登记」」
  - L360（SC-004）「换算式：病根 iii 1 条 + 病根 v 1 条 = 2 条，单位：FR 条」
- **原文出处 A**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md`（L159-171）
- **原文片段 A（逐字，12 行）**：

```
## CRITICAL-7 · 范围在 plan 阶段静默收缩（所有 over-claim 的结构性根源）

卡面 5 个病根、spec 49 条 FR，而 plan 的 6 个 Phase **没有为病根 iii、病根 v、PENDING（FR-030..032）、snapshot-stale（FR-033）安排任何 Phase**，且 `plan.md §8`「spec 与代码现状矛盾记录」**也没登记这次裁剪**。

实测命中数（plan / tasks / 生产码）：
FR-012 (竞态)         → 0 / 0 / 0
FR-026 (GATE)         → 0 / 0 / 0
FR-030 (PENDING)      → 0 / 0 / 0
FR-033 (snapshot-stale)→ 0 / 0 / 0

**这就是「勾了但没做」的机制**：plan 静默裁掉范围 → tasks 按裁剪后的 plan 写 → **SC/commit 却按未裁剪的 spec 口径报**。三者对不上而无人对账。
```

> 说明：为压到 12 行，上段省去了原文中包住那 4 行命中数的一对 ` ``` ` 围栏行，其余逐字未改。

- **原文出处 B（「已达成」口径的落点）**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/tasks.md`（L166-172）
- **原文片段 B（逐字，7 行）**：

```
### SC 诚实口径（更正 P6 自查与 commit 里的「13 达成」）

| 判定 | SC | 计 |
|---|---|---|
| **真达成** | SC-003 / 005 / 006 / 007 / 010 / 013 | **6** |
| **部分** | SC-001（`IN_FLIGHT_DEFER_LIMIT` 一行未动）/ SC-002（真实语料只覆盖非空数组一态）/ SC-008 / SC-009（`last_assistant_message` 那条测的是无消费者的字段；账本消费那条只跑写侧纯函数） | **4** |
| **未达成/假达成** | SC-004（无 GATE 机制）/ SC-011（全仓零耗时断言；实测全链 43–63ms > 建议 ≤50ms）/ SC-012（活性自检未实现）/ SC-014（**假达成**：靠零接线函数 + 测试直调）/ SC-015（backstop 长在零接线函数里） | **5** |
```

- **核对结论**：**转述基本准确，有一处口径偏差**。
  - 准确的部分：「病根 iii / v 未被任何 Phase 认领」「plan 既不实现也不登记裁剪」逐字对应原文 A 第 3 行；「over-claim 的结构性根源」是原文 A 标题的原话；SC-004 换算式里「病根 iii 1 条 + 病根 v 1 条」与原文 A 的命中表（FR-026 = 病根 iii、FR-012 = 病根 v）一致。
  - **偏差**：spec.md 写「**verify 阶段**却仍被口径为『已达成』」。原文归因的是「**SC/commit** 却按未裁剪的 spec 口径报」（原文 A 第 12 行）与「更正 **P6 自查**与 commit 里的『13 达成』」（原文 B 第 1 行）——即 Phase 6 的自查与 commit 叙述，不是一个名为 verify 的独立阶段（F270 的 6 个 Phase 中并无 `verify` phase）。另外原文的口径数是「13 达成」而非一个笼统的「已达成」。转述把落点从「P6 自查 + commit」平移到「verify 阶段」，方向无误但落点不精确。
  - 补充：原文 A 记录的未认领项实为 **4 组**（病根 iii、病根 v、PENDING FR-030..032、snapshot-stale FR-033），spec.md 只取其中 2 组。SC-004 把捕获率写作 `2 ÷ 2 = 100%` 是**以自己选取的 2 条为分母**，不是以 F270 真实未认领全集（4 组）为分母；若按原文全集计，捕获率为 `2 ÷ 4 = 50%`。这是一处**分母收窄**，建议在 spec.md 中显式声明口径。

### H-2 · F270：`routeNonBlock` 是只被测试引用的死代码

- **spec.md 引用处**：
  - L62「F270 的 `routeNonBlock` 是只被测试引用的死代码，测试全绿、验收通过，缺陷却毫发无伤地穿过了整条流程」
  - L217「它正是 F270 的 `routeNonBlock` 当时可以给出的说法」
  - L361（SC-005）「报警集合中 `routeNonBlock` 的命中数 ÷ 应命中数 = 1 ÷ 1 = 100%」
- **原文出处**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md`（L103、L113、L200）
- **原文片段（逐字，3 段共 5 行）**：

```
## CRITICAL-4 · 病根 iii 原样存活；US3 四个 `[必须]` FR 全空
```

```
**根因**：`routeNonBlock`（`judge:740`）**生产零调用点**，全仓只有测试直接 import（`judge-cli.test.mjs:3131-3225`）→ `nonBlockStopCount` 恒 0，两个 LIMIT 从不参与判定。
```

```
| **M9 `routeNonBlock` 首行 `return 0`** | **只多 5 个红，全部是直接 import 的单元测试，零端到端失败** | **死代码铁证** |
```

- **旁证（「测试全绿、验收通过」的落点）**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/tasks.md`（L155）

```
| **病根 iii** GATE 暂停（FR-026/027/028/029 四个 `[必须]`） | **未实现** | 实测 GATE 暂停态反复 Stop 仍 0→1→2 后降级放行，与改动前逐字一致。方案函数 `routeNonBlock` 生产零接线。spec 已记录两个候选识别信号均被取证排除，只剩 A-4 指纹去重一条路，成本 ≈ 一个 Phase |
```

- **核对结论**：**转述准确**。「只被测试引用」= 原文「生产零调用点，全仓只有测试直接 import」；「测试全绿」有 M9 变异实验的正面证据（把首行改成 `return 0` 只多 5 个红且全是直接 import 的单元测试、零端到端失败）；「验收通过」对应 H-1 原文片段 B 中 SC-014 被更正前的「假达成：靠零接线函数 + 测试直调」。三处均可逐字对上。

### H-3 · F270：spec 阶段三轮异构对抗，每轮在上轮修订里发现新 CRITICAL

- **spec.md 引用处**：
  - L106「实证语料是 F270 spec 阶段的三轮异构对抗，**每一轮都在上一轮的修订里发现了新的 CRITICAL**——这说明单轮放行对这类改动是结构性不足」
  - L108（US-4 独立测试方法）「第一轮结束时存在 CRITICAL，判「不放行」；第二轮修订后仍发现新 CRITICAL，判「不放行」；**第三轮零新 CRITICAL，判「放行」**。回放结论与该 Feature 的真实历史轨迹一致即通过」
  - L458 / L461（D-3 演示）「输入语料：F270 spec 阶段的三轮异构对抗记录」「三轮回放结论与 F270 真实历史轨迹逐轮一致」
- **原文出处 A**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md`（L114-115，条目所属分组为 `### F270 · 2026-08-31`）
- **原文片段 A（逐字，2 行）**：

```
- [流程顺畅][spec-driver GATE] **GATE_DESIGN 无"多轮对抗迭代"的一等表达**：本卡 spec 经历 3 路对抗(22C)→delta 复审(4C)→delta-2 微型对抗，每轮都在**上一轮的修订里**发现新缺陷（FR-025 复活已证伪实现 / FR-046 全称放行 / FR-024 空集条款）。这正是九轮史"修分歧引入新分歧"在 spec 阶段的复现，但 story 模式的 GATE_DESIGN 是单点通过/暂停，没有"对抗-修订-再对抗"的循环结构，全靠主线程手动编排。改进方向：门禁/判定器类改动的 GATE 应内建"delta 复审直到零新 CRITICAL"的收敛循环，而非单轮
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（门禁类 GATE 内建「对抗-修订-再对抗至零新 CRITICAL」收敛循环）
```

- **原文出处 B（第三轮 delta-2 的实际产出）**：`git show 8d78efd7:specs/270-compliance-evidence-ledger/spec.md`（L362 / L366 / L368）
- **原文片段 B（逐字，3 段节录；每段仅取起首至该轮发现的定性处）**：

```
  1. 引入一个**独立于 `blockCount` 的有界解锁计数器**（暂名 `nonBlockStopCount`）。🔴 **承重不变量（delta-2 Q3，MUST，不留给 plan 自由裁量）**：`nonBlockStopCount` 的阈值 **MUST ≥ `BLOCK_LIMIT`**。
```

```
  5. 🔴 **不可擦 backstop（delta-2 额外发现，MUST）**：`nonBlockStopCount` 若与 `blockCount` 同住可擦的 `.specify/runs/.fix-compliance-state/`（被判方每 Stop 前 `rm -rf` 即清零），则「计时器保证最终放行」为假——会话被 brick 在 exit 2 循环（违反 F208「不 brick 会话」）。
```

```
  ⚠️ **组合跑道登记（delta-2 Q1）**：三计时器（`blockCount`≤2 / `inFlightDeferCount`≤3 / `nonBlockStopCount`≥2）互不感知、无共享上界，会话最坏「非终态跑道」= 三者容量**之和 ≈7 次 Stop**（非本条自述的「与 BLOCK_LIMIT 同量级 ~2」）。
```

- **原文出处 C（轮次口径与「修分歧的那一轮也可能引入新分歧」）**：`git show 8d78efd7:specs/270-compliance-evidence-ledger/verification/adversarial-review-disposition.md`（L180）与同 commit `spec.md`（L469）
- **原文片段 C（逐字，2 行）**：

```
单路 delta 复审（只审 12 项修订的新文本与新组合，不重审已认定充分项）报 **4 CRITICAL / 6 WARNING**，印证了九轮史「修分歧的那一轮也可能引入新分歧」。全部已处置：
```

```
**GATE_DESIGN 建议**（delta W-5 对账后更新）：**需人工审查**（已完成，见附录 B / 处置文档）。理由：MEDIUM-HIGH 复杂度 + 门禁类（fail-open 风险）+ 九轮史逃逸面。`[NEEDS CLARIFICATION]` #1 已闭合（FR-026 结果性 + A-4 指纹去重）；#2（账本隔离清理策略）留 plan 裁决。经三路对抗（22C）+ delta 复审（4C），全部 CRITICAL 已处置或转化为 plan 前置。
```

- **核对结论**：**L106 的转述准确；L108 / L461 的回放剧本与原文冲突，属转述有偏差**。
  - **准确的部分（L106）**：「三轮」= 原文「3 路对抗(22C)→delta 复审(4C)→delta-2 微型对抗」共三轮；「每一轮都在上一轮的修订里发现了新的 CRITICAL」是原文「每轮都在**上一轮的修订里**发现新缺陷」的逐字同义转述；「单轮放行结构性不足」对应原文改进方向「而非单轮」。连 spec.md 用的收敛判据措辞「对抗-修订-再对抗至零新 CRITICAL」都直接沿用了账本处置行的原话。
  - **偏差（L108 / L461）**：spec.md 把回放剧本写成「第三轮零新 CRITICAL，判『放行』」，并要求「回放结论与 F270 真实历史轨迹逐轮一致」。但原文 A 明写**每轮**（含第三轮 delta-2）都发现新缺陷，原文 B 三段是 delta-2 这一轮的三项新发现（其中两项标 `MUST`、一项是承重不变量、一项是 F208「不 brick 会话」被违反的 backstop 缺陷），按任何合理的严重度映射都不属于「零新 CRITICAL」。**因此 F270 的真实轨迹是「三轮全部有新发现」，而不是「第三轮收敛」**——按 spec.md 自己定的通过条件（逐轮一致），D-3 演示会**判不通过**。
  - 附带口径问题：原文 C 的「经三路对抗（22C）+ delta 复审（4C），全部 CRITICAL 已处置」这句写在 spec.md 里，其自身**早于 delta-2**（它没有把 delta-2 计入），是 F270 内部的一处未回改口径，不宜作为「第三轮零 CRITICAL」的依据。
  - 另一处轻微失配：原文第一轮是「**3 路**对抗」（同轮三个并行审查路径），spec.md L112 的验收场景写「第一轮异构对抗返回 2 条 CRITICAL」——数字为示例、非引用 F270，不构成失真，但「轮」与「路」两个计数单位在 spec.md 中未加区分，建议明确。

### H-4 · F270：两次口头叮嘱「先落盘」都被忽略

- **spec.md 引用处**：
  - L74「而不是每次委派时口头叮嘱——F270 两次口头叮嘱都被忽略，说明叮嘱不是可执行的约定」
  - L402「推断理由：F270 已两次证伪「口头叮嘱有效」，因此本卡改走「写进 agent 正文 + 补齐 `Edit` 工具」的路线」
- **原文出处**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md`（L112，分组 `### F270 · 2026-08-31`；该行由 `8d78efd7` 引入）
- **原文片段（逐字，1 行；因原行过长，此处取承载该结论的后半句起）**：

```
改进方向：①spec-driver 派发子代理时**强制"先落盘骨架再逐节 Edit"**协议（写进 agents/*.md 的输出纪律，而非靠 prompt 临时叮嘱——本卡两次在 prompt 里叮嘱仍被子代理忽略"Write in one shot"而死）；②编排器对"判定/收口"类必须主线程做的判断，与"可分发的机械填充"更早分层，减少把承重设计塞进易死子代理
```

- **同行前半句（补全语境，逐字）**：

```
- [流程顺畅][spec-driver 子代理编排] **长会话中子代理结构性高死亡**：本卡 spec/plan 阶段 6 次委派子代理死 5 次，全部 API 错误（宿主休眠 ×1 + 连接中断 ×4），且**均在"读完材料准备动笔"阶段零产出死亡**。被迫 specify 修订与 plan 全改主线程 inline（委派合同的合法降级，已标 DEGRADED）。
```

- **旁证（F270 spec.md 自述的降级留痕）**：`git show 8d78efd7:specs/270-compliance-evidence-ledger/spec.md`（L7）

```
**Revision note**: 三路异构对抗审查（22C/21W）后按处置文档 §3 清单修订；修订由主编排器 inline 执行 `[DEGRADED: inline-execution — specify 修订 — 3 次子代理均死于 API 错误（宿主休眠 ×1 / 连接中断 ×2），零产出，error 证据在案]`
```

- **核对结论**：**转述准确**。「两次口头叮嘱都被忽略」逐字对应「本卡两次在 prompt 里叮嘱仍被子代理忽略"Write in one shot"而死」；「叮嘱不是可执行的约定」对应原文「而非靠 prompt 临时叮嘱」；spec.md 提的对策「写进 `agents/*.md`」也逐字来自原文「写进 agents/\*.md 的输出纪律」。**注意一处措辞精度**：原文说的是「在 prompt 里叮嘱」（即委派 prompt 的书面文字），spec.md 称之为「口头叮嘱」——本仓语境下二者同指「非制度化的临时嘱托」，但字面上 F270 的叮嘱是写在 prompt 里的、并非口头，若要严格按原文引用宜写「prompt 内临时叮嘱」。

### H-5 · F270：手工 reverse-census 可直接作为模板

- **spec.md 引用处**：
  - L119「F270 的手工版可直接作为模板。」
  - L123「以 F270 的手工 reverse-census 为模板，对本 Feature **自身**被修改的关键量跑一次真实普查」
- **原文出处 A（改进方向的原始记录）**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md`（L116，分组 `### F270 · 2026-08-31`）
- **原文片段 A（逐字，2 行）**：

```
- [信息完整性][spec-driver 反向普查] **护栏表按卡面点名抄=回归根因**（本卡对抗审查的元判断）：spec 初稿的"不回退清单"是按卡面点名的护栏抄的，非按改动影响面反向普查，结果三处最重回归全落在未点名的护栏上（F257 闸门三基线 / F240 US5 零落盘 / F208 非 brick）。改进方向：plan 阶段应有**强制的"关键量反向普查"步骤**（列出被改量的全部消费点），本卡是主线程手动补的（reverse-census.md），应成为 spec-driver-plan 的标准产物
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（plan 阶段强制「关键量反向普查」标准产物）
```

- **原文出处 B（被称为「手工版」的那份产物确实在库）**：`git show 8d78efd7:specs/270-compliance-evidence-ledger/research/reverse-census.md`（L60 为例）

```
- **FR-046 `nonBlockStopCount`**：加进 `normalizeState`（io:297）第 5 个字段 + `saveBlockState` 原样带回名单（judge 三处 save 调用点 :541/:609/:769 都要带上它）。**但** delta-2 的不可擦 backstop 要求它的耗尽判据挂 `earliestFixLineIndex` 派生的单调量——即 `nonBlockStopCount` 存磁盘用于快路径，真正的放行闸挂 transcript 派生量（与闸门三同构），双写但以不可擦量为准。
```

- **原文出处 C（普查的五个关键量清单，佐证「关键量」口径）**：`git show 8d78efd7:specs/270-compliance-evidence-ledger/spec.md`（L469 末句）

```
**plan 第一步 MUST 执行审查要求的五量反向普查**（`anchorLineIndex`/`blockCount`/`verificationReport`/`executionRecords`/`saveBlockState().ok`），再进 tasks。
```

- **核对结论**：**转述准确**。「手工版」= 原文「本卡是主线程手动补的（reverse-census.md）」；「可直接作为模板」= 原文「应成为 spec-driver-plan 的标准产物」+ 账本处置行「plan 阶段强制『关键量反向普查』标准产物」。spec.md L121 的「反向普查管『做的人有没有做全』」也对应原文「结果三处最重回归全落在未点名的护栏上」。**一处口径提醒**：原文的五量是**函数与状态字段**（`anchorLineIndex` / `blockCount` / `verificationReport` / `executionRecords` / `saveBlockState().ok`），而 spec.md L119 把关键量定义为「常量、字段名、键名、枚举值、配置项」——F270 原文里的 `saveBlockState().ok` 是**函数返回值**，不在这五类之内。这是一次**外延收窄**，若照 spec.md 的定义执行，F270 那份模板里的一项将落到范围之外。

### H-6 · F272：一次结论转述是错的，且差点进入 master

> **本条是第 2 轮审查特别点名的「可能本身就是一条不可核的转述」。核实结果：可核，原始记录在库，两处独立留痕。**

- **spec.md 引用处**：
  - L135「实证语料：F272 中一次结论转述是错的，且差点进入 master。」
  - L145「**Given** 一份 fix-report 引用了「F272 中某检查曾被判定为无效」这一历史结论」
  - L483「（这正是 F272 那次错误转述的形态——结论转述失真且差点进入 master）」
- **原文出处 A（账本条目，即 F277 这条纪律的直接上游）**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md`（L45-52，分组 `### F272`；该行由 `125bfdb3` 引入）
- **原文片段 A（逐字，8 行）**：

```
- [信息完整性][spec-driver 制品链] **事实基线文档的"结论转述"缺可核验证据**：`verified-facts.md`
  引用 `git show <commit>` 做论据时只写结论（"src 侧断言是 `> 0`、tests 侧被弱化成 `>= 0`"）
  未附原文片段。该结论**是错的**——两侧断言逐字相同（都是 `toBeGreaterThanOrEqual(0)`），
  差异只在 it 名。若按字面执行"修回 `> 0`"会引入确定性红用例（全 mock 管线下 `Date.now()-t0`
  确定性返回 0，实测连续 5 次全 0ms）。这个错误是靠批 A 子代理"全量用例必须绿"的硬判据顺带
  暴露的，判据写宽一点就会直接进 master。改进方向：verified-facts 类"开工前实证"文档引用
  历史内容做论据时，必须附 `git show` 的实际输出片段而非结论转述
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（verified-facts 类文档引用历史内容必附 git show 原文片段）
```

- **原文出处 B（错误发生地的自我更正留痕）**：`git show 125bfdb3:specs/272-test-guard-asset-cleanup/verified-facts.md`（L83-96）
- **原文片段 B（逐字，12 行）**：

```
### ⚠️ 本节曾有一处错误，已被批 A 的变异验证纪律抓出并更正

**原写**（错误）：「src 侧用例名与断言是「durationMs > 0」，`tests/` 侧被弱化成「>= 0」（恒真），
应在 `tests/` 侧修回。」

**实证更正**（`git show 1b9a7113:src/panoramic/qa/__tests__/index.test.ts` 与当前 `tests/` 侧原文对照）：

| | it 名 | 断言 |
|---|---|---|
| src 侧（已删的陈旧副本）| 「应包含 durationMs 字段（**> 0**）」 | `expect(result.durationMs).toBeGreaterThanOrEqual(0)` |
| `tests/` 侧（在维护的那份）| 「应包含 durationMs 字段（**>= 0**）」 | `expect(result.durationMs).toBeGreaterThanOrEqual(0)` |

**两侧断言逐字相同**。差异只在 it 名——`tests/` 侧其实是把名字**改对了**（让名实相符），
不是"弱化"。我把它读反了。
```

- **原文片段 B 续（「差点进入 master」的机制，逐字，5 行）**：

```
**而且「修回 `> 0`」这条指令本身会制造确定性红**：批 A 实测，在全 mock 管线下
`answerQuestion` 的 `Date.now() - t0` **确定性返回 0**（连续 5 次独立运行全部 0ms，
`[info] qa: ... total_ms=0` 日志印证），不是环境抖动。按字面执行会往 `tests/panoramic/qa`
引入一条恒红用例（已实测复现 `84 passed | 1 failed`）。批 A **拒绝执行该字面指令、
保持文件原状并把裁决上交**，是正确处置。
```

- **核对结论**：**转述准确，且本条完全可核**（对第 2 轮质疑的直接回应）。
  - 「一次结论转述是错的」逐字对应原文 A「该结论**是错的**」与原文 B「我把它读反了」；错误的具体内容（`> 0` vs `>= 0`，两侧实为逐字相同的 `toBeGreaterThanOrEqual(0)`）在两处原文中一致。
  - 「差点进入 master」对应原文 A「判据写宽一点就会直接进 master」——**注意这是一个反事实陈述**：实际发生的是批 A 子代理凭「全量用例必须绿」的硬判据把它拦下了（原文 B：「批 A **拒绝执行该字面指令**」），错误从未真的接近 master 分支；原文说的是「若判据更宽则会进 master」。spec.md 的「差点进入 master」是对该反事实的合理压缩，方向无误，但严格讲原文并未声称它已经走到 master 门口。
  - **L145 的验收场景措辞与原文不符**：该场景把被引结论写成「F272 中某检查曾被判定为无效」。F272 那次错误转述的**内容**是断言强度对比（`> 0` vs `>= 0`），不是「某检查被判定为无效」。这是一个虚构的示例句而非引用，作为 Given 语料尚可，但它与 L135 / L483 指向同一史实时会让读者误以为原文如此，建议改写为与原文一致的示例。

### H-7 · F272：同一个数字验收量被四次算错

- **spec.md 引用处**：
  - L136「实证语料：F272 中同一个数字验收量被四次算错。」
  - L488「本仓已有「同一数字验收量被四次算错」的实证，F272」
- **原文出处 A**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md`（L61-68，分组 `### F272`；该行由 `125bfdb3` 引入）
- **原文片段 A（逐字，8 行）**：

```
- [流程顺畅][spec-driver spec/tasks] **数字类验收量在多轮修订下反复算错**：本卡的 todo 计数
  被改了**四次**（8 → 7 → 9 → 12），每次都因跨项交互未纳入换算：第一次是纯算术错
  （13+7+1=21 剩 7 却写 8）；第二次漏了 ⑦-B1 把 2 条占位断言转为 `it.todo`；第三次漏了
  对抗审查要求恢复的 3 条 empty-project todo。同期 `inventory-item7.md` 的"35 条"也因
  单位口径不一致（坐标条目 vs 断言行数）被上下游各算错一次。改进方向：spec/tasks 里的
  可观测数量一律写成**换算式 + 各项来源**（如 `21 − 10 − 1 + 2 = 12`），禁止写裸数字；
  且必须显式声明**计数单位**
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（spec/tasks 可观测数量必写换算式+计数单位）
```

- **原文出处 B（收敛后的换算式与计数单位实物）**：`git show 125bfdb3:specs/272-test-guard-asset-cleanup/spec.md`（L221 末句）与同 commit `inventory-item7.md`（L48）

```
换算式：21（⑥ 基线）− 10（⑥ 删除）− 1（⑥ 转普通注释）+ 2（⑦-B1 新转入）= 12（全仓总数；基线值 21 见 `verification/baseline-before.md`）。
```

```
> **计数单位说明（重要，避免下游再算错）**：本节所有「条」= **坐标条目**（一行
```

- **核对结论**：**转述准确**。「同一个数字验收量被四次算错」逐字对应原文 A「本卡的 todo 计数被改了**四次**（8 → 7 → 9 → 12）」；spec.md L141 举的换算式范式「上限 − 当前 max = 余量」与原文 A 的改进方向「换算式 + 各项来源（如 `21 − 10 − 1 + 2 = 12`）」同形；spec.md 强调的「计数单位」也逐字来自原文 A 末句「且必须显式声明**计数单位**」，并在原文 B 的 `inventory-item7.md` 中有实物对应。
  - **一处精度提醒**：原文写的是「被**改了**四次（8 → 7 → 9 → 12）」——箭头只跨 3 次修订，四次是把初值算错也计入（第一次即纯算术错 `13+7+1=21 剩 7 却写 8`）。spec.md 的「被四次算错」与原文「被改了四次」在计数口径上一致（初值错 + 3 次修订未纳入跨项交互），无失真；但若下游要复用这个数字，应引用原文的序列而不是裸「四次」。

### H-8 · F264：Codex hooks 双注册根源是未经运行时验证的推断前提

- **spec.md 引用处**：L137「实证语料：F264 的 Codex hooks 双注册根源，就是一条从未被运行时验证过的推断前提。」
- **原文出处**：`git show befa5d4d:specs/264-fix-codex-hooks-distribution/fix-report.md`（L48-53）
- **原文片段（逐字，6 行）**：

```
| Why 5 | 为何未被现有机制捕获？ | 全部门禁（`validate-codex-hooks.mjs` / `codex-plugin-consistency` / `repo:check`）都只看**我方磁盘产物的一致性**，没有任何一处去问"Codex 运行时实际注册了几条"；`hooks/list` 这条 RPC 在 F240 的 `_grounding.md` 里被记载为"探测入口"却从未真正跑过 |

**Root Cause**：把"Codex plugin **manifest** 无 hooks 字段"错误外推为"Codex 不读插件包内 hooks"，
于是在插件已经自带（且真实生效）的 hooks 之外，又造了一条全局合并器注册路径；两条路径都活着且互不去重。

**Root Cause Chain**：Stop hook 跑两遍 / BLOCK_LIMIT 一次烧尽 → `hooks/list` 10 条同名重复 →
包内 hooks 与全局 hooks.json 双注册 → 合并器路线基于"Codex 不读插件 hooks"前提 →
该前提由"manifest 无 hooks 字段"外推而来 → 从未用运行时注册视图（`hooks/list`）验证过前提。
```

- **旁证（Why 4，前提是如何被外推出来的；逐字，1 行）**：同文件 L45

```
| Why 4 | 该判定为何不成立？ | F213 的实测口径是**读 manifest schema**（两份第三方 `plugin.json` 均无 `hooks` 字段）——由此推出"manifest 不支持 hooks 字段"是对的，但被**外推**成"Codex 不读插件 hooks"。Codex 的插件 hooks 走**目录约定**（`<pluginRoot>/hooks/hooks.json`），根本不经 manifest 字段声明 |
```

- **核对结论**：**转述准确**。「双注册根源」逐字对应「包内 hooks 与全局 hooks.json 双注册」；「从未被运行时验证过的推断前提」逐字对应链条末句「从未用运行时注册视图（`hooks/list`）验证过前提」，而「推断」的性质由 Why 4 的「被**外推**成」与 Root Cause 的「错误外推」双重印证。spec.md 由此导出的对策（「verify 必须至少给出一条**运行时口径**的验证命令来实证或证伪该前提」）也与原文 Why 5 的诊断——门禁「都只看我方磁盘产物的一致性，没有任何一处去问『Codex 运行时实际注册了几条』」——严格同向：原文批评的正是缺少运行时口径。三层（前提、外推、缺运行时验证）均可逐字对上。

### H-9 · F259：判据写成值枚举 ⇒ 每加一个值漏一次

- **spec.md 引用处**（三处，全部以「本仓 F259 已登记」的口吻直接引作反模式）：
  - L64「本仓 F259 已登记「判据写成值枚举 ⇒ 每加一个值漏一次」这一反模式」
  - L212（FR-008）同句
  - L291（FR-057）「点名式表述会随本节今后新增条款每加一条漏一条，与本仓 F259 已登记的「判据写成值枚举 ⇒ 每加一个值漏一次」是同一反模式」
- **原文出处 A**：`git show dfe6c479:specs/259-fix-callgraph-false-edge-guardrail/fix-report.md`（L26 / L29-34）
- **原文片段 A（逐字，7 行）**：

```
| Why 4 | 为何 F242 的闸没覆盖它？ | F242 的闸建在 `buildImportIndex` 第一遍的 `if (imp.importType === 'dynamic') continue;` —— 判据用的是**具体 importType 值**而非「specifier 是路径字面量」这一真正的前提。`commonjs-require` 与 dynamic 共享同一前提却不在名单内 |

**Root Cause**：兜底别名的**成立前提是"specifier 是点分模块名"（Python 语义）**，而闸的判据写成了
「importType ≠ dynamic」这一**具体值枚举**。TS/JS 的 `require()` specifier 是**路径字面量**，`lastSeg`
恒为文件扩展名（`js`/`mjs`/`json`…），既无意义又会无条件覆写同名静态绑定。

**Root Cause Chain**：假边 → `js` 别名被覆写 → require 恒无绑定名恒进兜底 → 闸按 importType 枚举而非
按「specifier 形态」判定 → 兜底前提未断言化 + 无同名 collision 样本。
```

- **原文出处 B（对策：改存在性判定，不再列举值）**：`git show dfe6c479:specs/259-fix-callgraph-false-edge-guardrail/plan.md`（L80、L84）
- **原文片段 B（逐字，2 行）**：

```
**不采用**继续列举 `importType !== 'dynamic' && importType !== 'commonjs-require'` 这种值枚举
```

```
`imp.importType === undefined`。理由（均已用 Grep + Read 核实源码逐路径确认，非推测）：
```

- **核对结论**：**转述准确，但引号内那句是本仓的概括口径、不是 F259 的字面原文**。
  - 语义完全对得上：「判据写成值枚举」逐字对应原文 A「闸的判据写成了「importType ≠ dynamic」这一**具体值枚举**」；「每加一个值漏一次」是对原文「`commonjs-require` 与 dynamic 共享同一前提却不在名单内」这一实际发生的漏项，以及原文 B「不采用继续列举 …… 这种值枚举」的准确概括——F259 正是因为多出一个 `commonjs-require` 值而漏了一次，对策也正是弃用枚举改判「字段是否存在」。
  - **需要标注的是**：`「判据写成值枚举 ⇒ 每加一个值漏一次」` 这个带引号的短句在 F259 的制品中**逐字检索不到**（`grep -rn '每加一个值' specs/259-*/` 无结果），它是本仓记忆/复盘层对 F259 的**提炼句**。spec.md 三处都写成「本仓 F259 已**登记**」，读者会理解为 F259 有此原话。建议改为「本仓自 F259 提炼的反模式」，或改引原文 A 的「判据用的是**具体 importType 值**而非……这一真正的前提」。这属于**引用形式**问题，不是事实失真。

### H-10 · F266：confirmed-zero 须测量正向证据

- **spec.md 引用处**：L302（FR-062）「「没跑」与「跑了且干净」在产物上完全同形（本仓 F266 已登记「confirmed-zero 须测量正向证据」的同形教训）」
- **原文出处 A**：`git show 3871dc04:specs/266-honest-graph-quality-gate/tasks.md`（L280，对抗发现 A4 行）
- **原文片段 A（逐字，1 行）**：

```
| A4 | `confirmed-zero` 建立在零证据上：无记账 / 记账不自洽都被编码成同一个 `null` 并被 `Math.max(0,…)` 洗白 | `graph-honesty.ts` 新增四态 `CoverageAssessment`（unaccounted / inconsistent / gap / measured-zero），confirmed-zero 需三项正向证据 | `mcp-graph-honesty.test.ts` describe `F266-A4`（S1/S2/S4 + 对照，6 用例） |
```

- **原文出处 B（同形折叠的第二次实证与收紧条件）**：同 commit `tasks.md`（L325，D2 行）
- **原文片段 B（逐字，1 行）**：

```
| D2 | WARNING | `measured-zero` 的记账在场性是全图 OR（1 个合法节点代表 500 个模块）；且生产端 `?? 0` 把「没抽取」与「抽到 0」折叠成同一磁盘值，全零图被判 `confirmed-zero` | `graph-honesty.ts`：三条件收紧（全模块记账 + 自洽 + Σ>0），`unaccounted` 细分 `no-accounting` / `partial-accounting` / `all-zero` 并带 `accountedModules/totalModules` | `mcp-graph-honesty.test.ts`「D2：全零记账」「D2：1 合法 + 499 缺失」「D2：正向证据齐备仍可达」 |
```

- **核对结论**：**转述准确**。「confirmed-zero 须测量正向证据」逐字对应原文 A 的处置列「confirmed-zero 需三项正向证据」；spec.md 用它支撑的论点——「没跑」与「跑了且干净」在产物上同形——正是原文 A/B 描述的缺陷形态：原文 A 是「无记账 / 记账不自洽都被编码成同一个 `null`」，原文 B 是「`?? 0` 把「没抽取」与「抽到 0」折叠成同一磁盘值」。两者都是**缺席态与干净态在返回面上不可区分**，与 spec.md 的「同形」用法严格同构。原文 B 的三条件（全模块记账 + 自洽 + Σ>0）也印证了「正向证据」的具体含义。

### H-11 · F186 / F238：`codex-wrapper-block-sync` 门禁教训

- **spec.md 引用处**：L176（Edge Case 9）「改动了 `plugins/spec-driver/**` 下的 SKILL 或 agents，但未运行 `npm run repo:sync` 并连带提交 `.codex/skills/**` 侧的再生产物 → `delegation-contract:codex-wrapper-block-sync` 门禁失败（F186 / F238 已有教训）……该链路是单向再生，手改 `.codex/skills/**` 无效。」
- **原文出处 A（F238：`repo:sync` 是唯一同步通道，裸 install 不重写 tracked 目录）**：`git show bc129d4b:specs/238-codex-wrapper-completeness/tasks.md`（L170、L323）
- **原文片段 A（逐字，2 行）**：

```
- [x] T3.11 `npm run repo:sync` 重新生成 tracked `plugins/spec-driver/skills-codex/`（C6 要求：`extract-wrapper-body.mjs` 改动后 tracked 旧 sha 与新 helper 重算结果不一致，裸 install 不会重写 tracked 目录，必须走 `repo:sync` 才能同步，否则 `codex-plugin-distribution-markers` 检查必红）
```

```
- [x] T5.10 `npm run repo:sync` 重生 `.codex/skills` 与 `skills-codex` 镜像，同步 T5.8 的 FR-303 改动到两份分发镜像（**硬依赖 Slice 3 已完成**：`repo:sync` 会一并重写 tracked `skills-codex/`，若 Slice 3 的 wrapper 产物链改动尚未合并，本任务提前执行会用旧 wrapper 源覆盖，产生虚假的"已同步"状态）
```

- **原文出处 B（F186：body sha256 指纹门禁的由来）**：`git show be59c638:specs/186-distribution-reliability-npm-4-3-0/fix-report.md`（L38）与同 commit `plan.md`（L71、L91）
- **原文片段 B（逐字，3 行）**：

```
| `plugins/spec-driver/scripts/validate-wrapper-sources.mjs` | `validateWrapperMarkers` L62-126 | header-only 校验 | 写入并比对 source body sha256（见决策）|
```

```
### T2 — wrapper body sha256 指纹校验（方案 A）
```

```
   - 比对不一致 → 追加 fail 条目 `wrapper body sha256 不匹配（期望 X，实际 Y）`
```

- **旁证（门禁 id 在产品代码中确实存在，本 worktree 实测）**：`plugins/spec-driver/scripts/sync-delegation-contract.mjs:130` 为 `id: 'codex-wrapper-block-sync',`；`plugins/spec-driver/tests/delegation-contract.test.mjs:182` 有该 id 的漂移用例。
- **核对结论**：**转述准确，但两个 F 的贡献面需要区分**。
  - 准确的部分：「未跑 `repo:sync` 会导致门禁失败」「该链路是单向再生，手改无效」都有 F238 原文直接支撑——原文 A 明写「裸 install 不会重写 tracked 目录，**必须走 `repo:sync`** 才能同步，否则……检查必红」，以及提前执行会「产生虚假的『已同步』状态」，正是「手改 / 乱序改无效」的实证。
  - **需区分之处**：spec.md 把 `codex-wrapper-block-sync` 这个具体门禁 id 与「F186 / F238 已有教训」并列，容易读成该 id 出自这两卡。实际情况是：**F186 立的是 wrapper body sha256 指纹校验**（原文 B，门禁落点为 `validate-wrapper-sources.mjs` / `codex-plugin-distribution-markers`），**F238 撞的是 tracked 镜像不同步**（原文 A，报红的门禁 id 是 `codex-plugin-distribution-markers`）；而 `delegation-contract:codex-wrapper-block-sync` 是 `sync-delegation-contract.mjs` 里另一条针对 delegation-contract 块的漂移检测。三者同属「单向再生 + 漂移门禁」这一族，教训相通，但**不是同一个门禁 id**。建议 spec.md 或改引与该 id 同源的出处，或把括注改为「（同族教训见 F186 wrapper body sha256 / F238 tracked 镜像同步）」。这属于**归因精度**问题，Edge Case 9 要求的行为本身无误。

### H-12 · F229 / F256 / F257 皆为 fix 形态

- **spec.md 引用处**：L235（FR-025）「`fix` 恰是本仓门禁类改动的主战场（F229 / F256 / F257 皆为 fix 形态）——因此 FR-020~FR-024 的收敛循环在 `fix` 上目前**没有强制执行点**」
- **原文出处 A（九轮链的完整枚举，F229 / F256 / F257 皆在列）**：`git show 8d78efd7:specs/270-compliance-evidence-ledger/research/nine-round-lessons.md`（L1-4）
- **原文片段 A（逐字，4 行）**：

```
# F224→F257 九轮对抗的承重教训（主线程收口版）

来源：对 `specs/2NN-fix-*` 的 `fix-report.md` / `spec.md` 全量通读提炼（执行由子代理完成，**本文件的取舍与结论由主线程收口**）。
九轮对抗链实际为 **F224 → F225 → F227 → F228 → F229 → F230 → F231 → F256 → F257**。
```

- **原文出处 B（三卡在 F270 内被并列为「必改文件」的同一族）**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/spec.md`（L401）
- **原文片段 B（逐字，1 行）**：

```
- **FR-049** `[必须]`（审查 C-W4）：新增诊断码 MUST 同步 `specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json` 的**闭合 enum**（`additionalProperties: false`；F224/F256/F257 三轮均把它列为必改文件）。
```

- **旁证（三卡确为 fix mode 产物，本 worktree 实测目录清单）**：`specs/229-fix-placeholder-unpaired-brace/`、`specs/256-fix-compliance-false-blocks/`、`specs/257-fix-compliance-failopen-closeout/` 三者的文件集均为 `fix-report.md plan.md tasks.md verification`——**有 `fix-report.md`、无 `spec.md`**，正是 `spec-driver-fix` 模式的产物签名（`feature`/`story` 模式产 `spec.md`）。
- **核对结论**：**转述准确**。三卡属于同一条门禁对抗链（原文 A 的九轮枚举含 F229 / F256 / F257），且原文 A 的取材范围写明是 `specs/2NN-**fix**-*` 的 `fix-report.md`，与「皆为 fix 形态」一致；本 worktree 的目录实测（有 `fix-report.md`、无 `spec.md`）给出独立的第二重证据。spec.md 由此推出的结论——`fix` 的 `GATE_DESIGN` 默认豁免使 US-4 收敛循环在主战场上没有强制执行点——其前半段（豁免）在同一行里已附 `SKILL.md:382-384` 的实测行号，属本 worktree 现状核实，不属历史引用范畴。

### H-13 · F170d harness 按目标 agent 的 tools 过滤注入

- **spec.md 引用处**：
  - L241（FR-028）「其二，同处第 3 项声明的 F170d harness（`scripts/feature-170d-driver-preference.mjs`）「`--append-system-prompt` 注入时读取本块并按目标 agent 的 tools 过滤」」
  - L431（V-1）与 L468（D-6）复述同一条，作为「`tools` 键未被盘点的第 2 个消费方」
- **原文出处**：**不是 git 历史，而是本 worktree 当前文件**——`plugins/spec-driver/templates/preference-rules.md:1-9`（该文件在 `e01611b2` 中已 tracked，可用 `git show e01611b2:plugins/spec-driver/templates/preference-rules.md` 复核）
- **原文片段（逐字，9 行）**：

```
# Preference Rules — 工具优先使用规则（单一事实源，M7 F170d）

> **本文件是 spec-driver「工具优先使用规则」引导文案的 canonical source。**
>
> 消费方（三处，禁止各自手写漂移）：
> 1. **5 个 sub-agent**（`agents/{plan,implement,verify,spec-review,quality-review}.md`）——由 `scripts/sync-preference-rules.mjs --write` 按各 agent frontmatter `tools` **过滤渲染**后嵌入 `<!-- BEGIN preference-rules -->` / `<!-- END preference-rules -->` 之间。
> 2. **5 个主编排器 SKILL.md**——「子代理调度时的工具优先级提示」块引用本文件路径。
> 3. **F170d harness**（`scripts/feature-170d-driver-preference.mjs`）——`--append-system-prompt` 注入时读取本块并按目标 agent 的 tools 过滤。
```

- **核对结论**：**转述准确（逐字），但引用形式与本纪律不匹配，应重新归类**。
  - 内容上是**逐字摘抄**：spec.md L241 的引号内容与原文第 3 项一字不差，「按各 agent frontmatter `tools` **过滤渲染**」也与原文第 1 项一字不差。
  - **归类问题**：这条不是「历史 Feature 的结论」，而是**当前仓内一份 tracked 文件的自述声明**。US-6(a) 要求的是对**历史内容**附 `git show <sha>:<path>`；对当前文件，正确的核实方式是直接 Read 现文件（本条已做），并注意 spec.md 自己在同处已诚实登记「该缺口必须在 plan 的 reverse-census 章节被补全并复核计数，**不得因『spec 已提及』而视为已处置**」。
  - **一处未核实的延伸**：spec.md 把这两处称为「`tools` 键的消费方」，依据是 `preference-rules.md` 的**自述**。自述文件说「消费方三处」不等于代码实际只有三处、也不等于这两个脚本确实按 `tools` 过滤——`scripts/sync-preference-rules.mjs` 与 `scripts/feature-170d-driver-preference.mjs` 的实际实现本次**未核**。按 H-8（F264）刚刚登记的教训（「从未用运行时口径验证过前提」），这条自述本身就是一条待实证的推断前提，宜在 spec.md 中标 `[推断]` 并交给 reverse-census 用检索命令与计数核实。

---

## 汇总

### 附原文覆盖率

- **换算式**：附原文条数 ÷ 引用总条数 = **13 ÷ 13 = 100%**，计数单位：**引用条（H-n，按史实去重，不按 spec.md 出现次数）**。
- 若改按 spec.md 的**出现次数**计（同一史实在多处被引用各计一次），分母为 **30 处**，换算式：`4（H-1）+ 3（H-2）+ 4（H-3）+ 2（H-4）+ 2（H-5）+ 3（H-6）+ 2（H-7）+ 1（H-8）+ 3（H-9）+ 1（H-10）+ 1（H-11）+ 1（H-12）+ 3（H-13）= 30`。本清单对每条史实只取一次原文并在小节内列出全部引用处，覆盖率同为 **30 ÷ 30 = 100%**，计数单位：**引用出现处**。

  > **自查留痕（本条曾算错一次）**：此处初稿写的是「29 处」，与逐项换算式相加的结果 30 不符——初稿只写了结果数字、没有把 13 个加数展开，错误因此未在写作当下暴露。改成上面这个逐项换算式后一算即现。这恰是 H-7（F272 同一数字验收量被四次算错）与 US-6(b) 要求「必写换算式 + 计数单位」的**当场再现**，故如实留痕而不静默改数。
- **本清单的代码块围栏行数**：`grep -c '^\`\`\`' historical-citations.md` = **78**，即 39 个原文片段块（78 ÷ 2 = 39，单位：围栏行 / 代码块）。对照第 2 轮实测 `spec.md` 的同一命令结果为 **0**。

### 三类核对结论分布

| 结论 | 条数 | 编号 |
|---|---|---|
| **转述准确** | **8** | H-2 / H-4 / H-5 / H-6 / H-7 / H-8 / H-10 / H-12 |
| **转述有偏差** | **5** | H-1 / H-3 / H-9 / H-11 / H-13 |
| **未找到原文** | **0** | —— |

- **换算式**：8 + 5 + 0 = 13 条，与引用总条数一致，单位：引用条。
- 准确率换算式：8 ÷ 13 = **61.5%**，单位：引用条。

### 五条偏差的严重度排序（供 spec.md 修订取用）

| 编号 | 偏差性质 | 严重度 | 后果 |
|---|---|---|---|
| **H-3** | **事实冲突**：spec.md 的 D-3 回放剧本写「第三轮零新 CRITICAL 判放行」，但 F270 原文明写第三轮（delta-2）也发现新缺陷（含 2 项 `MUST`、1 项违反 F208「不 brick 会话」的 backstop 缺陷） | 🔴 高 | 按 spec.md 自定的通过条件「三轮回放结论与 F270 真实历史轨迹逐轮一致」，**D-3 演示会判不通过**；且它是仅有的 3 个外部对照之一，D-3 失效会把外部对照数从 3 降到 2（3 ÷ 8 = 37.5% → 2 ÷ 8 = 25%） |
| **H-1** | **分母收窄 + 落点平移**：真实未认领项为 4 组，spec.md 只取 2 组并把捕获率写成 `2 ÷ 2 = 100%`；「verify 阶段」应为「P6 自查 + commit」 | 🟠 中 | SC-004 的 100% 是自选分母的产物；按原文全集应为 `2 ÷ 4 = 50%`。与本 spec 自己的 US-6(b) 换算式纪律直接冲突 |
| **H-11** | **归因不精确**：`delegation-contract:codex-wrapper-block-sync` 这个门禁 id 并非出自 F186 / F238；F186 立的是 wrapper body sha256、F238 撞的是 `codex-plugin-distribution-markers` | 🟡 低 | Edge Case 9 要求的行为无误，仅括注归因需改写 |
| **H-9** | **引用形式**：`「判据写成值枚举 ⇒ 每加一个值漏一次」` 在 F259 制品中逐字检索不到，是本仓提炼句，但 spec.md 三处均写作「F259 已**登记**」 | 🟡 低 | 语义无失真；措辞宜改为「自 F259 提炼」或改引原文原句 |
| **H-13** | **归类错误**：这不是历史 Feature 结论，而是当前 tracked 文件的**自述**；且该自述所声明的两个消费方的实际实现本次未核 | 🟡 低 | 应移出「历史引用」类；其「消费方三处」是一条待实证的推断前提，宜标 `[推断]` 并交 reverse-census 用检索命令核实（正是 H-8 刚登记的教训形态） |

### 对本卡纪律本身的一条反馈

本次核实**没有一条「未找到原文」**，说明本仓的账本 + specs 制品链对历史结论的可追溯性是够的；真正的失效不在「查不到」，而在**查得到却没查**——13 条引用在 spec.md 中零附原文，其中 5 条一核就露出偏差，最重的 H-3 直接推翻了一个外部对照演示的通过判定。这与 H-6（F272）记录的形态完全同型：**转述看起来合理、方向也对，错的是细节，而细节恰是判定要用的那部分**。
