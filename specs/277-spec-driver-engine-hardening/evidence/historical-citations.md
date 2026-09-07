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
| H-14 | L368 / L658 / L1039 | F270：US5 闸门在生产接线下恒为真——判据被自家 SessionStart hook 恒满足（补索引 2026-09-07，= e-d6 V1） | ⚠️ 有偏差（引用形式）|
| H-15 | L658 | F278：防线照着想错的方向搭——fail-open 方向被注释写反（补索引 2026-09-07，= e-d6 V2） | ✅ 准确（引号句为 F276 转引句式，见条目）|
| H-16 | L34（账本 `:135`） | F270：跨 phase「留给下一阶段」承诺无跟踪机制（补索引 2026-09-07，= e-d6 V3） | ✅ 准确 |
| H-17 | L38（账本 `:60`） | F272：纯文档短任务同样中断，stall 检测 600s 期间磁盘零产出（补索引 2026-09-07，= e-d6 V4） | ✅ 准确 |
| H-18 | L39（账本 `:81`） | F271：宿主反复休眠时长时后台子代理结构性不可靠（4 次 Task 死亡）（补索引 2026-09-07，= e-d6 V5） | ✅ 准确 |
| H-19 | L40（账本 `:124`）/ L51 | F270（implement）：子代理死亡率随任务长度强相关，短任务稳定可用（补索引 2026-09-07，= e-d6 V6） | ✅ 准确 |

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

---

## 补索引（2026-09-07 · D-6 引用原文化抽查 V1 ~ V6 回填）

- **触发**：`verification/e-d6-citation-audit.md`（2026-09-07）的结构扫描发现 spec.md 在本索引成文（2026-09-02，以 572 行的 spec 为对象）之后追加的账本映射表（L29-46）与 L368 / L658 / L1039 引入了 6 条未入索引的史实（该文件表中的 V1 ~ V6）。本节按「追加而非改写」口径回填为 H-14 ~ H-19：**既有 H-1 ~ H-13 正文与上方「汇总」节的数字一字未动**（它们是 2026-09-02 的时点值），补索引后的数字见文末「补索引后的汇总」；索引表只在末尾追加了 6 行。
- **对象版本**：spec.md 行号以当前磁盘文本为准（HEAD `d86fa332`；spec.md 自 `4255212c` 起已被 git 追踪，1054 行）。
- **账本行号口径**：spec 映射表的 `:NNN` 指账本条目的 `↳ **处置**` 行（spec L29 自述），且经实测只与 **`e01611b2`** 版的 `docs/design/dogfooding-feedback-ledger.md` 对得上——该版 L60 / L81 / L124 / L135 四行全是「↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**」，而 HEAD `d86fa332` 版同四行已漂成别的条目（L60「图产物已 stale…」/ L81「编排器给返工子代理钉死…」/ L124「历史内容做论据时…」/ L135「被改了四次…」）。故 H-16 ~ H-19 的原文一律取 `git show e01611b2:docs/design/dogfooding-feedback-ledger.md`，并附 HEAD 版同条目的行号对照与逐字 diff 结果（四条均一致，行号统一漂移 +73）。
- **对应关系**：V1 → H-14、V2 → H-15、V3 → H-16、V4 → H-17、V5 → H-18、V6 → H-19。每条末尾新增「本卡如何使用」一项（H-1 ~ H-13 无此项，为本次补索引新增的字段，不回填旧条目）。

### H-14 · F270：US5 闸门在生产接线下恒为真——判据被自家 SessionStart hook 恒满足

- **spec.md 引用处**：
  - L368「守护面与 CLI 会双双报告它是一道完好的硬门禁——即本仓 F270 已登记的「闸门判据被自家链路恒满足」形态」
  - L658「本仓已登记的同型反模式是「闸门判据被自家 hook 恒满足」（F270）与「防线照错方向搭」（F278）：三者共同点是**机制存在、位置错**」
  - L1039「相对形式在强制 mode 上结构性恒真（F270「闸门被自家路径恒满足」反模式）」
- **原文出处 A**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md | sed -n '336,341p'`（L336-341，节标题为「对抗 D-CRITICAL-1」）
- **原文片段 A（逐字，6 行）**：

```
## 对抗 D-CRITICAL-1 · US5 闸门在生产接线下恒为真（我选错了判据）

`scripts/postinstall.sh:40` 在 **SessionStart**（`hooks.json` 里 matcher 为空＝每个项目每次会话）
无条件 `mkdir -p "$PROJECT_DIR/.specify"`。SessionStart 必然早于任何 PostToolUse ⟹
`isSpecDriverProject()` 初版判据「`.specify/` 存在」在装了插件的**任何**项目里恒为真，
**闸门对它自己描述的病灶零效力**。
```

- **原文出处 B（「测试全绿也没发现」与修法）**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md | sed -n '349,355p'`（L349-355）
- **原文片段 B（逐字，7 行）**：

```
**为什么我的测试全绿也没发现**：US5 那组用 `mkdtemp` 干净目录直接调 `appendLedgerEntry`，
**从不执行 postinstall.sh**。这正是本仓 F274 已登记的教训「参数化测试全绿≠生产接线有守护，
须接线断言」——我 memory 里就有这条，仍然犯了一遍。

**修**：判据换成「`.specify/` 里除 `.spec-driver-path` 外还有别的条目」（`project-context.yaml` /
`templates/` / `runs/` … 由 init 或流程自身产出，postinstall 不产）。
**并补生产接线断言**：测试里真的跑一遍 `postinstall.sh` 再验闸门仍拦得住 —— 已绿。
```

- **措辞溯源（「恒满足」不在 F270 制品中）**：
  - `git log --all --oneline -S"恒满足" -- specs/270-compliance-evidence-ledger docs` → **无输出**（F270 制品与 `docs/` 在任何 commit 都未出现「恒满足」三字）。
  - `git log --all --oneline -S"恒满足"`（无路径过滤）→ 仅 2 个 commit：`4255212c`（本 spec 自身入库）与 `5ded38e5`（F240 plan L474「我方安装路径…恒满足」，语义无关）。
  - `git show e01611b2:docs/design/dogfooding-feedback-ledger.md | command grep -n -E "postinstall|SessionStart|接线断言|自举"` → 无输出：此史实**未落账**，只存在于 F270 的 integrated-review 制品。
- **核对结论**：**转述准确（机制、方向、归属均对得上），引用形式有偏差**。
  - 准确的部分：三处转述的共同内核「判据被自家的某个前置机制无条件满足 ⇒ 门在配置上健康、在执行上零效力」逐点对应原文 A：SessionStart hook（自家 `postinstall.sh`）无条件 `mkdir -p .specify` ⇒ `isSpecDriverProject()` 的「`.specify/` 存在」判据在装了插件的任何项目里恒为真 ⇒「闸门对它自己描述的病灶零效力」。L658「机制存在、位置错」的概括与原文 A「SessionStart 必然早于任何 PostToolUse」的时序论证同向；L368「守护面与 CLI 双双报告它是一道完好的硬门禁」与原文 B「测试全绿也没发现」同型。
  - **偏差（引用形式，与 H-9 同型）**：三处均以引号句写作「F270 已登记的「…恒满足」」，但「恒满足」与「自家链路 / 自家 hook / 自家路径」三种措辞在 F270 制品中**逐字检索不到**（上列三条命令零命中），原文用词是「**在生产接线下恒为真**」「在装了插件的**任何**项目里恒为真」；且三处引号内文字互不相同，读者无法据引号回查。宜改写为「自 F270 对抗 D-CRITICAL-1 提炼」或改引原句。
  - 邻近但**非同一史实**的条目：同文件 L449「E-C2 · US5 闸门被三条向量**自举打开**，且不可逆」讲的是修后判据可被主动自举，与本条的「恒为真」是前后两轮不同缺陷，不得合并引用。
- **本卡如何使用**：作为 L368「禁改集从字段扩到挂载」与 L1039 FR-053「断言打在 effective 上、绝对形式收紧」的反面样本——本卡要求门的存在性断言不得建立在会被自家 resolver 整份回退、或被自家 hook 预置而恒真的判据上，正是这条史实的直接迁移。

### H-15 · F278：防线照着想错的方向搭——fail-open 方向被注释写反

- **spec.md 引用处**：
  - L658「本仓已登记的同型反模式是「闸门判据被自家 hook 恒满足」（F270）与「防线照错方向搭」（F278）：三者共同点是**机制存在、位置错**，静态阅读检不出，只有把执行顺序摆出来才暴露」
- **原文出处 A**：`git show 058c7012:specs/278-honest-tooling-patches/verification/orchestrator-verification.md | sed -n '161,162p'`（L161-162；附录 A.1「项④ 首轮被判「不能上线」（3 CRITICAL），已返工」表的 C-1b / C-2 两行）
- **原文片段 A（逐字，2 行）**：

```
| C-1b | 代码注释把 fail-open 的**方向写反了**（说会「谎报成本次新引入」）。实际 `deriveDelta` 要求 `baselineStatus==='match'` 才可能出 `introduced`，被强转成 missing 的基线**永远出不了 introduced**，只会出 `pre-existing`/`resolved` —— 真实方向是**替本次改动开脱**，而防线正是照着想错的方向搭的 | **已修**（注释改正） |
| C-2 | fail-open 方向零测试守护：4 个 fail-open 向变异体全部 0 红（含「把 `introduced` 一律改判 `unchanged`」）。根因是 S3/S4 两条 E2E 都以 `当前 match` 收尾，**从没有用例产出过 `introduced` 行** | **已修**：补基线不可读 / 真实 introduced / spawn 失败三类用例；16 变异体杀 15 |
```

- **原文出处 B（引号句「防线（可能）照错方向搭」在本仓的首次登记处）**：`git show 26a3b15f:specs/276-fix-compliance-p0a-residue/plan.md | sed -n '565p'`（L565）
- **原文片段 B（逐字，1 行）**：

```
     **照抄 earliest 就是把防线搭反**（F278「防线可能照错方向搭」的同类）。
```

- **措辞溯源**：
  - `git grep -n "照错方向" 058c7012` → **无输出**；`git log -1 --format=%B 058c7012`（F278 的 commit message）亦无此四字。F278 原句是原文 A 的「防线正是照着想错的方向搭的」。
  - `git log --all --oneline -S"照错方向"` → 仅 `26a3b15f`（F276-C）与 `4255212c`（本 spec 入库）。`git grep -n "照错方向" 26a3b15f` 命中 5 处，全在 F276 制品：`specs/276-fix-compliance-p0a-residue/plan.md` L171 / L372 / L548 / L565 与 `verification/gate-design-adversarial-round7.md` L7；其中 L171 与 round7 L7 的写法是「F278「防线照错方向搭」同型」，与 spec L658 引号句逐字相同。
- **核对结论**：**转述准确**。
  - 内容上：spec L658 把它归为「机制存在、位置错」——原文 A 的 C-1b 正是「防线（注释所声称的 fail-open 守护）存在，但按想错的方向搭」，C-2 进一步证实该方向**零测试守护**（4 个 fail-open 向变异体全 0 红）；「静态阅读检不出，只有把执行顺序摆出来才暴露」对应原文「实际 `deriveDelta` 要求 `baselineStatus==='match'` 才可能出 `introduced`」这一执行路径级论证。归属 F278 无误。
  - 引用形式备注：引号句「防线照错方向搭」是 **F276 plan 的转引句式**（原文 B 及 L171 / round7 L7），F278 原句为「防线正是照着想错的方向搭的」；两者语义一致、仅措辞压缩，且 spec 写的是「本仓已登记」而非「F278 原文」，本仓（F276 制品）确已以该句式登记，故不计偏差。
- **本卡如何使用**：与 H-14 并列为 L658「L-1（已证伪 · 时序前提）」的两个同型对照——为产出物指定批准点时先核对 phase 序列时序（FR-060 接受点由 `GATE_DESIGN` 改钉 `GATE_TASKS`），可迁移教训「时序为假时它不报错，只是永远走不到成功路径」即从此二例归纳。

### H-16 · F270：跨 phase「留给下一阶段」承诺无跟踪机制

- **spec.md 引用处**：
  - L34（账本映射表 `:135` 行）「F270（集成 review） | 跨 phase「留给下一阶段」承诺无跟踪 → 「随 Phase N 落」生成归属 Phase N 的显式任务；verify 增「新增导出符号生产可达性」检查 | **2**」
  - 派生而非转述（不计引用处，仅供回查）：L97（US-2 描述「随 Phase N 落」「留待 Phase N 接线」这类延期承诺）、FR-008 ~ FR-013。
- **原文出处**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md | sed -n '134,135p'`（L134-135；条目所属分组为 L129 `### F270 · 2026-09-01（集成 review 追加，第 3 次落账）`；L135 即 spec 映射表所指的 `↳ **处置**` 行）
- **原文片段（逐字，2 行）**：

```
- [流程顺畅][spec-driver 阶段划分] **跨 phase 的「留给下一阶段」承诺无跟踪机制**：P3 的任务卡写「GATE 指纹去重通道预留同路由（随 P4 落）」，P4 实际做的是账本接入、从未接 GATE，而 T311 仍被勾成 `[x]`，导致 `routeNonBlock` 及其两个阈值常量成为**生产零接线的死代码**，其单元测试反而制造了「已达成」假象（变异实验：函数首行改 `return 0` 只红 5 个直接 import 的用例，零端到端失败）。改进方向：tasks 里凡出现「随 Phase N 落」的承诺，应生成一条归属 Phase N 的显式任务，否则该 phase 完成时无从检查。另建议 `spec-driver-verify` 增加「新增导出符号的生产可达性」检查——从真实入口正向追调用链，只被测试 import 的导出应报警。
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（「随 Phase N 落」承诺生成归属 Phase N 的显式任务 + verify 增「新增导出符号生产可达性」检查）
```

- **HEAD 对照**：`git show d86fa332:docs/design/dogfooding-feedback-ledger.md | sed -n '207,208p'`——同条目在 HEAD 版位于 L207-208；实跑 `diff <(git show e01611b2:docs/design/dogfooding-feedback-ledger.md | sed -n '134,135p') <(git show d86fa332:docs/design/dogfooding-feedback-ledger.md | sed -n '207,208p')` 输出为空（逐字一致），仅行号漂移 +73。
- **核对结论**：**转述准确**。spec L34 的「跨 phase「留给下一阶段」承诺无跟踪」= 原文加粗标题；箭头后的「「随 Phase N 落」生成归属 Phase N 的显式任务；verify 增「新增导出符号生产可达性」检查」= L135 处置行括注逐字。与 H-2（`routeNonBlock` 死代码）共用同一账本条目作旁证，但 H-2 引的是「死代码 + 测试全绿」这一结果，本条引的是「承诺无跟踪」这一机制成因，e-d6 判「与 H-2 相邻但非同一史实」成立。
- **本卡如何使用**：需求项 2「承诺任务化与生产可达性检查」（US-2 / FR-008 ~ FR-013、FR-064）的唯一账本来源；mode 分层矩阵第 2 行（L483）与移交口径（L801「移交 4 条：FR-010 ~ FR-013」）均以此条为出发点。

### H-17 · F272：纯文档短任务同样中断，stall 检测 600s 期间磁盘零产出

- **spec.md 引用处**：
  - L38（账本映射表 `:60` 行）「F272 | 纯文档短任务同样中断、stall 检测 600s 期间磁盘零产出 → 「先落盘骨架再逐节 Edit」+ 纯文档小任务放宽 inline 降级 | **5**」
  - 派生而非转述（不计引用处，仅供回查）：L111（US-3 描述「先落盘骨架，再逐节 Edit 填充」写进 `agents/*.md`）、FR-014、L606（A-2 推断前提）。
- **原文出处**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md | sed -n '53,60p'`（L53-60；条目所属分组为 L31 `### F272 · 2026-08-31`；L60 即 spec 映射表所指的 `↳ **处置**` 行）
- **原文片段（逐字，8 行）**：

```
- [流程顺畅][spec-driver 编排] **子代理在本机休眠 / stall 下的高中断率**：本卡 5 个子代理
  非正常结束——2 次 `API Error: Your computer went to sleep mid-response`（tasks 分解、
  批 C-⑦ 实施）、3 次 `Agent stalled: no progress for 600s`（其中 tasks.md checkbox 同步
  连续 3 次失败，最后触发委派合同的 inline 降级通道）。已登记的教训是"长 transcript 恢复
  高死亡率"，本卡实证**另一类**：纯文档编辑的短任务同样会中断，且 stall 检测要 600s 才触发、
  期间磁盘零产出。改进方向：①派活 prompt 显式要求"尽快落盘、分段 Write 而非最后一次性写"；
  ②编排器侧对纯文档类小任务放宽 inline 降级门槛（三次 Task 失败的成本远高于 inline 完成）
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（子代理「先落盘骨架再逐节 Edit」输出纪律 + 纯文档小任务放宽 inline 降级）
```

- **HEAD 对照**：`git show d86fa332:docs/design/dogfooding-feedback-ledger.md | sed -n '126,133p'`——同条目在 HEAD 版位于 L126-133；两版逐字 diff 输出为空，行号漂移 +73。
- **核对结论**：**转述准确**。「纯文档短任务同样中断」= 原文第 5 行「纯文档编辑的短任务同样会中断」；「stall 检测 600s 期间磁盘零产出」= 第 5-6 行「stall 检测要 600s 才触发、期间磁盘零产出」；箭头后的两项处置 = L60 处置行括注逐字。一处措辞来源需注意：「先落盘骨架再逐节 Edit」出自 **处置行**（milestone-next 的归纳），账本条目正文自己的改进方向写的是「尽快落盘、分段 Write 而非最后一次性写」——spec 引的是处置行，未失真。原文的量化依据「5 个子代理非正常结束 = 2 次休眠 + 3 次 stall」（换算式 2 + 3 = 5，单位：子代理次）spec 未转述，无失真。
- **本卡如何使用**：需求项 5「委派协议：先落盘骨架再逐节 Edit」（US-3 / FR-014、FR-019）的三条账本来源之一（另两条为 H-18、H-19）；本条提供「纯文档短任务也会死」这一反例，使 FR-019 的按时长分流不能把「短 = 安全」当成前提。

### H-18 · F271：宿主反复休眠时长时后台子代理结构性不可靠（4 次 Task 死亡）

- **spec.md 引用处**：
  - L39（账本映射表 `:81` 行）「F271 | 宿主反复休眠时长时后台子代理结构性不可靠（4 次 Task 死亡）→ 委派按任务时长分流 | **5**」
- **原文出处**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md | sed -n '80,81p'`（L80-81；条目所属分组为 L75 `### F271 · 2026-08-31`；L81 即 spec 映射表所指的 `↳ **处置**` 行）
- **原文片段（逐字，2 行）**：

```
- [流程顺畅度][spec-driver 编排] 宿主机反复休眠时长时后台子代理结构性不可靠：本卡 specify ×2、implement 收口 ×2 共 4 次 Task 死于「computer went to sleep / 600s 看门狗」，两次遗留半成品工作树需主线程盘点接手；~10-17 min 的审查型子代理全部存活。改进方向：编排器对 >15 min 的实现型委派考虑分段化（每段自包含可恢复），或在派发前探测宿主电源管理状态
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（委派按任务时长分流：长文档生成分段落盘或 inline，短分析正常委派；再现：F272③/F270）
```

- **HEAD 对照**：`git show d86fa332:docs/design/dogfooding-feedback-ledger.md | sed -n '153,154p'`——同条目在 HEAD 版位于 L153-154；两版逐字 diff 输出为空，行号漂移 +73。
- **核对结论**：**转述准确**。「宿主反复休眠时长时后台子代理结构性不可靠」= 原文首句（原文为「宿主机」，spec 省一字）；「4 次 Task 死亡」= 「specify ×2、implement 收口 ×2 共 4 次 Task 死于…」，换算式 2 + 2 = 4，单位：Task 次，与原文一致；「委派按任务时长分流」= L81 处置行括注。原文还有一条 spec 未引的正面数据——「~10-17 min 的审查型子代理全部存活」，它与 H-19 的「短任务稳定可用」互为佐证。
- **本卡如何使用**：需求项 5 的账本来源之二（spec L39 映射表明示）；本条原文的改进方向（对 >15 min 的实现型委派分段化 / 派发前探测宿主电源状态）是 FR-019「长文档生成走分段落盘的委派形态」的账本依据之一。

### H-19 · F270（implement）：子代理死亡率随任务长度强相关，短任务稳定可用

- **spec.md 引用处**：
  - L40（账本映射表 `:124` 行）「F270（implement） | 子代理死亡率随任务长度强相关、短任务稳定可用 → 委派策略按任务时长显式分流 | **5**」
  - L51「**根源 (ii)：子代理死亡率与任务长度强相关。** 长文档一次性生成的委派方式，把「整篇产出」押注在一次不可中断的会话上，中断即全损」（e-d6 表未列此行；本条补登，为同一史实的第二处引用）
- **原文出处**：`git show e01611b2:docs/design/dogfooding-feedback-ledger.md | sed -n '123,124p'`（L123-124；条目所属分组为 L120 `### F270 · 2026-09-01（implement 阶段追加，接 08-31 spec/plan 反馈）`；L124 即 spec 映射表所指的 `↳ **处置**` 行）
- **原文片段（逐字，2 行）**：

```
- [流程顺畅][spec-driver 子代理编排] **子代理死亡率随任务长度强相关，但短任务稳定可用**：spec/plan 阶段 6 委派死 5（长任务），implement 阶段改用"短任务形态"子代理（对抗审查、探针，各 <5min）后**存活率接近 100%**（P2/P3/P4 各 2 路对抗 + 环境探针全部完成）。而 implement 的**生产代码红先行+实现**仍全部主线程 inline（判定器接线是承重设计，本就该主线程收口）。改进方向：spec-driver 的委派策略应显式区分"长文档生成"（易死，需分段落盘协议或主线程 inline）与"短分析/审查"（稳定，正常委派）——按任务时长而非任务类型分流。
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（委派策略按任务时长显式分流；再现：F271②/F272③）
```

- **HEAD 对照**：`git show d86fa332:docs/design/dogfooding-feedback-ledger.md | sed -n '196,197p'`——同条目在 HEAD 版位于 L196-197；两版逐字 diff 输出为空，行号漂移 +73。
- **与 H-4 的边界**：H-4 引的是同 Feature 上一分组（e01611b2 L112-113，即 `:113`）的「6 次委派死 5 次 + 两次叮嘱被忽略」；本条是 implement 阶段的**追加落账**（`:124`），新增的信息是「短任务形态存活率接近 100%」这一对照组，故 e-d6 判「H-4 覆盖的是 `:113` 条目，非此条」成立。
- **核对结论**：**转述准确**。L40 的「子代理死亡率随任务长度强相关、短任务稳定可用」= 原文加粗标题（顿号替换「，但」）；「委派策略按任务时长显式分流」= L124 处置行括注逐字；L51「根源 (ii)」是同一史实的因果化改写（「长文档一次性生成…中断即全损」对应原文「"长文档生成"（易死，需分段落盘协议或主线程 inline）」），未引入原文没有的数字。原文的量化依据「6 委派死 5」「各 <5min」「存活率接近 100%」spec 均未转述，无失真。
- **本卡如何使用**：需求项 5 的账本来源之三，也是 spec L51「根源 (ii)」的出处；FR-019「按任务时长分流」的「长 / 短」二分直接沿用原文「按任务时长而非任务类型分流」。

## 勘误（2026-09-07）

- **对象**：H-1「原文出处 B」的行号标注。H-1 正文写 `git show 8617ae3e:specs/270-compliance-evidence-ledger/tasks.md`（**L166-172**），实为 **L164-170**（偏 2 行；片段 B 的 7 行内容逐字无误，只是定位失准）。按「追加而非改写」口径，H-1 原文不动，勘误登记于此。发现者：`verification/e-d6-citation-audit.md` §(2c)（2026-09-07）。
- **实证命令与原始输出**：`git show 8617ae3e:specs/270-compliance-evidence-ledger/tasks.md | awk 'NR>=164 && NR<=172 {print NR": "$0}'`

```
164: ### SC 诚实口径（更正 P6 自查与 commit 里的「13 达成」）
165: 
166: | 判定 | SC | 计 |
167: |---|---|---|
168: | **真达成** | SC-003 / 005 / 006 / 007 / 010 / 013 | **6** |
169: | **部分** | SC-001（`IN_FLIGHT_DEFER_LIMIT` 一行未动）/ SC-002（真实语料只覆盖非空数组一态）/ SC-008 / SC-009（`last_assistant_message` 那条测的是无消费者的字段；账本消费那条只跑写侧纯函数） | **4** |
170: | **未达成/假达成** | SC-004（无 GATE 机制）/ SC-011（全仓零耗时断言；实测全链 43–63ms > 建议 ≤50ms）/ SC-012（活性自检未实现）/ SC-014（**假达成**：靠零接线函数 + 测试直调）/ SC-015（backstop 长在零接线函数里） | **5** |
171: 
172: ### 结构性根因（供后续卡引以为戒）
```

- **读法**：H-1 片段 B 的首行「### SC 诚实口径…」在 L164、末行「未达成/假达成」在 L170，共 7 行（164 ~ 170，换算式 170 − 164 + 1 = 7，单位：行）；索引所写的 L166-172 会漏掉本节标题并把下一节标题「### 结构性根因」误纳入。

## 补索引后的汇总（2026-09-07）

- **附原文覆盖率（补索引后）**：附原文条数 ÷ 引用总条数 = **19 ÷ 19 = 100%**，计数单位：引用条（H-n，按史实去重）。换算式：13（2026-09-02 既有）+ 6（H-14 ~ H-19）= 19；分母现取命令 `command grep -c '^### H-' historical-citations.md` = 19，索引表行数 `command grep -c '^| H-' historical-citations.md` = 19，二者一致。
- **按 spec.md 出现处计**：既有 30 处 + 新增 `3（H-14：L368 / L658 / L1039）+ 1（H-15：L658）+ 1（H-16：L34）+ 1（H-17：L38）+ 1（H-18：L39）+ 2（H-19：L40 / L51）= 9` 处 = **39 处**，覆盖率 39 ÷ 39 = 100%，单位：引用出现处（L658 同时承载 H-14 与 H-15 两条史实，按史实各计一次）。
- **代码块围栏行数**：`command grep -c '^\`\`\`' historical-citations.md` = **96**，即 48 个原文片段块；换算式：78（既有）+ 18（新增 9 块 × 2 围栏行）= 96，单位：围栏行。
- **新增 9 块的逐字校验**：以 awk 从「## 补索引（2026-09-07」起按围栏抽出 9 块，与各自「原文出处」所写命令的现跑输出逐一 `diff`，**9 ÷ 9 输出为空**（单位：片段块）；实跑于 2026-09-07，HEAD `d86fa332`。
- **三类核对结论分布（补索引后）**：转述准确 8 + 5（H-15 / H-16 / H-17 / H-18 / H-19）= **13**；转述有偏差 5 + 1（H-14，引用形式）= **6**；未找到原文 0 + 0 = **0**。换算式：13 + 6 + 0 = 19，单位：引用条。准确率 13 ÷ 19 = **68.4%**（2026-09-02 为 8 ÷ 13 = 61.5%）。
- **「原文不可得」条目数**：0 ÷ 6 = 0%。但如实登记两处**措辞级**不可得：H-14 的「恒满足」与 H-15 的「照错方向」两个引号短语在各自 Feature 的制品与 commit message 中逐字检索不到（查找命令与零输出已内联于条目），可得的是语义等价的原句；两条均已附原句片段，不计入「原文不可得」。
- **本次未做**：未回填 H-1 ~ H-13 正文（勘误只登记不改写）；未处理 e-d6 边界项 B1（spec L1067「F203 修订 #2 既有口径的接线」，e-d6 判「严口径计违规、宽口径排除」，不在本次 6 条范围内，关键词 `F203` 在本文件仍为 0 命中）。
