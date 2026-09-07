# GATE_DESIGN 对抗收敛循环 — 第 3 轮（止损模式）· beta 路：B-3 / B-4 / B-5

**产物版本指针**：`specs/277-spec-driver-engine-hardening/spec.md` @ **840 行**（R2 段 3b 落盘后）
**轮次**：R3（`R_max = 3` 上限轮），按 FR-021 止损条款**只守承重项，不追零新增**
**承重项来源**：`gate-design/round-2-findings.md:52-65`「承重项清单」，R3 不得增删
**本路守护范围**：B-3（死锁与冲突收编）/ B-4（门不可被三行 YAML 关掉）/ B-5（物理前置）
**对抗档位**：异构内部对抗（Codex 配额耗尽，异构档位缺席标注见 commit message）

## B-3

**承重项**：死锁与冲突收编 · **覆盖 FR**：FR-054 ~ FR-058
**守护判据（逐字抄自清单）**：裁剪登记 → `GATE_TASKS`、状态词表、verify 兜底段是否仍存在两条路都违规的路径

**判定：失守**（新增 CRITICAL 2 条）

### B-3-C1 —— 约束型 FR 在「裁剪登记 → `GATE_TASKS`」链上是一个未被收编的三重互锁

R1-C10 攻的是「已裁剪 FR × 100% FR 覆盖」这一条死锁，FR-056 把不变量改写为「每条**未被裁剪登记**的 FR 至少有一个对应任务；已登记裁剪的 FR 不要求任务」，**那一条确实堵住了**。但这个例外**只开给「已登记裁剪」这一类**，而本 spec 在 Edge Case 17 / FR-005 里**新造了一个明文禁止进入裁剪登记的类别**——约束型 / 负向 FR——例外对它是关闭的。

**逐条现行原文**：

- `spec.md:263`（FR-005）：「**约束型 / 负向 FR 单列一类**……这类 FR……**没有任何 Phase 会「认领实现」它、也不可能「裁剪」它**，因此**不走「认领 / 裁剪」二分**，改走「已核验未违反（附核验方式）/ 已违反 / 未核验」三取值……**约束型 FR 禁止进入裁剪登记**」；同句点名**本 spec 自己的 FR-016 / FR-049 / FR-050 / FR-051 即属此类**。
- `spec.md:262`（FR-004）：「**任何**在矩阵中标为「未认领」的 FR，必须在 plan 的「裁剪登记」具名章节中出现并写明裁剪理由；存在未认领且未登记裁剪的 FR 时，**plan 不得被判定为可进入下一 Phase**。」——**无任何类别限定**。
- `spec.md:261`（FR-003）：「矩阵「认领 Phase」列的**每一个取值**必须 ∈ 该 `plan.md` 实际定义的 Phase 集合；**取值不在集合内的行一律判为失去认领，与从未被认领同等处理**。」——**无任何类别限定**，且这是本卡自称的「机械交叉校验」。
- `spec.md:264`（FR-006）：「未被任何 Phase 认领且未登记裁剪的 FR，verify **必须自动判为「未实现」**。」——**无任何类别限定**。
- `spec.md:359`（FR-056）：「每条**未被裁剪登记**的 FR 至少有一个对应任务；已登记裁剪的 FR 不要求任务」——例外条件是「已登记裁剪」，不是「非实现型」。

**攻击路径（对本卡自己的 plan 必然发生，不是边界情况）**：取 FR-050（约束型，「交付前五条命令零失败或已归因」）。plan 产出矩阵时，它的「认领 Phase」列只有两种填法：

| 填法 | 走到哪 | 违规点 |
|---|---|---|
| **(a) 填 `N/A` / 留空 / 填「约束型不适用」** | 该取值 ∉ `plan.md` 的 Phase 集合 ⇒ FR-003 判**失去认领**「与从未被认领同等处理」⇒ FR-004 强制它进裁剪登记 ⇒ **FR-005 明文禁止它进裁剪登记** | 进 ⇒ 违 FR-005（且 `spec.md:243` 逐字定性为「**等于用合规动作解除约束**」）；不进 ⇒ 违 FR-004，**plan 不得进入下一 Phase**；同时 FR-006 在 verify 侧把它**自动判「未实现」**——这恰是 Edge Case 17 立项要治的病，**FR-006 正文一字未改** |
| **(b) 填一个真实 Phase 名** | 绕过 FR-003 / FR-004 / FR-006 | 直接违 FR-005「没有任何 Phase 会认领实现它 / 不走认领 / 裁剪二分」，且是 `spec.md:243` 逐字点名的失败形态：「执行者为消除误判，最省事的做法是**给它们编造一个认领 Phase**或塞进裁剪登记——**前者污染矩阵**，后者等于用合规动作解除约束」 |

**两条路都违规。** 形态与 R1-C10 被判为 CRITICAL 的那条**结构同型**（「造也违规、不造也违规，且不得靠执行者临场取舍化解」——`spec.md:359` 自己的措辞），只是被卡住的对象从「已裁剪 FR」换成了「约束型 FR」。

**再叠一层 `GATE_TASKS`**：即使执行者走 (b) 把它算作已认领，FR-056 的不变量仍要求「未被裁剪登记的 FR 至少有一个对应任务」。约束型 FR 不在裁剪登记里 ⇒ 必须造任务 ⇒ 造出来的是一条「核验没做某事」的任务；而 `spec.md:468`（SC-013）与 `spec.md:474` 明写「约束型 FR 的『已核验未违反』**不计入 M**——它证明的是没做某事，不是实现量」，`spec.md:795` 明写「空载成立的约束**不得被计为实现量**」。于是 `tasks.md` 的 FR→Task 映射表把它记为**有任务**，而矩阵把它记为**非实现量**，两张表对同一条 FR 给出相反的账面——这正是 FR-056 用「矩阵自相矛盾」为由否掉的那种写法。

**为什么 FR-054 ~ FR-058 五条都收不掉它**：FR-054 / FR-055 只处理**状态词表**（verify 三值 × spec-review 五值的并集映射），FR-056 只处理**裁剪例外**，FR-057 只处理 **verify 兜底例外**，FR-058 只处理**回填落点**。**没有任何一条把「FR 类别」这个新维度贯穿进 `agents/tasks.md` 的不变量或 FR-004 / FR-006 的兜底规则**——类别只写进了 FR-005 与 Key Entities（`spec.md:419`），而三条兜底规则的正文都是无类别限定的全称句。

### B-3-C2 —— FR-057 的例外条款射程只到两节，`verify.md` 的跳过型兜底有两条在两节之外，且其逐行点名禁令使其不可补

`spec.md:360`（FR-057）现行原文两处约束互相夹击：

1. 范围：「`plugins/spec-driver/agents/verify.md` 的**「约束」与「失败处理」两节**必须写入显式例外条款」+「例外条款**必须与被例外的兜底条款同节相邻**——**两节各写一处**，不得只写在文件别处而给『就近解读』留出空间」。
2. 写法：「其范围表述必须是「**本节**全部降级 / 不阻断 / 继续 / 跳过型条款」这类**面向条款类别**的写法，**不得写成对上述行的逐行点名**」。

**实地普查 `plugins/spec-driver/agents/verify.md`（全文 311 行）后的跳过 / 降级型兜底清单**，FR-057 列出的 5 行（`:302` / `:303` / `:309` / `:310` / `:311`，另提 `:308`）**逐条核对属实、行号准确**，但**漏了两条同型条款，且这两条都不在那两节里**：

| 行 | 逐字原文 | 所在节 | 在 FR-057 射程内？ |
|---|---|---|---|
| `verify.md:152` | `b. 未安装 → 标记"工具未安装"，跳过（不阻断）` | **Layer 2 正文** `2.4. **执行验证**`（起于 `:149`） | ❌ 否——既不在「约束」(`:299`) 也不在「失败处理」(`:306`) |
| `verify.md:163` | `若 timeout 命令不可用（macOS 未安装 coreutils），使用 gtimeout 作为降级替代；若两者均不可用，跳过超时保护并在报告中注明` | 同上，Layer 2 正文 | ❌ 否 |

**攻击路径**：FR-057 要保护的三类检查（FR 覆盖矩阵对账 / 生产可达性检查 / 推断前提实证）在本卡里**全部是命令类检查**——FR-062 要求矩阵对账结论附命令原文与原始输出，FR-033 / FR-066 要求推断前提走「运行时口径命令」。命令类检查的不可达形态第一现场就是 `:152` 的「`which <tool>` 查不到 ⇒ 标『工具未安装』⇒ 跳过（不阻断）」。执行者只要把不可达归到 `:152`（而不是 `:302`），FR-057 的例外条款**在文本上够不着**：例外写的是「**本节**全部……」，`:152` 不在本节；而 FR-057 又**明文禁止逐行点名**，执行者也无法通过点名 `:152` 来补。**本卡的 fail-loud 收口被同一文件、两节之外的旧条款整体抵消**——与 `spec.md:360` 自己描述的后果逐字相同：「执行者按任意一条都能自证合规」。

**这不是措辞洁癖**：FR-057 之所以禁止逐行点名，是为了防「今后新增条款每加一条漏一条」（它自引 F259 反模式）。但它**同时**把射程锚死在两节上——于是它对**节内**的未来新增免疫，对**节外**的既有条款却结构性失明。两条约束合起来造出的盲区，`:152` / `:163` 已经坐在里面。

### 附带发现（同属 B-3 覆盖面 · 已判定不单列 CRITICAL，登记备查）

1. **FR-055 的「一维映射表」表达不了类别相关的映射。** `spec.md:358` 要求「一张**旧值 → 新值的显式映射表**」逐条覆盖 5 个旧取值。但新词表按 `spec.md:419` 是**两套**（实现型五态 / 约束型三取值），旧值「已实现」在实现型下映射到「已实现（附证据）」、在约束型下映射到「已核验未违反」——**映射不是旧值的函数，还依赖 FR 类别**。一张旧值→新值的表在结构上写不出来；执行者按字面交付一张一维表，就把类别维度丢了（并直接喂养 B-3-C1）。
2. **「过度实现」在新词表下没有落脚的判定态。** `spec-review.md:56-59` 现行把它作为**每条 FR 四选一的判定**之一（`:80` 的报告表格同）；FR-055 把它降为「独立的观察项而非判定态」。于是一条被判「过度实现」的 FR 在新体系里应取哪一个判定态，spec 未规定；而 FR-055 又要求「不得因该观察项存在而使对应 FR 计入通过」。五态中能承载「实现了且超了」的取值**不存在**。不计 CRITICAL 的理由：可由「已实现（附证据）+ 观察项」自然消解，属欠规定而非互锁。
3. **FR-056 对 `GATE_TASKS` 强制力的描述偏强。** `spec.md:359` 称该不变量「由 `plugins/spec-driver/config/orchestration.yaml:78-80`（`description` / `default_behavior: always` / `severity: critical`）把守的 `GATE_TASKS` 挂起」——三行行号与取值**核对属实**；但同一 gate 的 `:81` 为 **`hard_gate_modes: null`**，故 `plugins/spec-driver/lib/orchestrator.mjs:120-122` 算出 `isHardGate = false`，于是 `:133` 的 `gate_policy` 分支先于 yaml 默认值生效，而 `:295` 的 `if (policy === 'autonomous') return 'on_failure'` 会把 GATE_TASKS 降为 `on_failure`。即：**在 `autonomous` 策略下这道门根本不会 `always` 暂停**，死锁不会以「挂起」的形态显形，只会以「制品自相矛盾但流程照走」的形态沉默通过。这**不削弱** B-3-C1（互锁在制品合同层，与是否暂停无关），但使 FR-056 的现状陈述在 `autonomous` 下不成立。

### 与上轮对照

| 项 | 结论 |
|---|---|
| **R1-C09**（verify / spec-review 状态词表冲突、`spec-review.md:130`「无法验证不标记为未实现」与 FR-006 方向相反） | **已堵死**。FR-054 统一取值集并把归并方向钉为「一切不确定态归入不通过侧」，FR-055 点名 `:123` / `:130` 为「归并方向的既有反例，必须按 FR-054 重写方向，**仅换取值名而保留原方向判本条未完成**」——原攻击卡在这一句上 |
| **R1-C10**（已裁剪 FR × 100% FR 覆盖两条路都违规） | **对「已裁剪」这一类已堵死**（FR-056 的例外 + `tasks.md:51` / `:78` 两处同改）；**B-3-C1 是同一形态在「约束型 FR」这一新类别上的复发**，攻击面不同（一个是本卡放宽的类别，一个是本卡新造且明文禁止放宽的类别），按 FR-021 口径计**新增** |
| **R1-C12**（verify 兜底条款整体抵消 fail-loud 收口） | **对两节内的 5 行已堵死**（FR-057 的面向类别写法 + 同节相邻要求）；**B-3-C2 是射程之外的复发**，按 FR-021 口径计**新增** |

### 收口指向（不属本轮职责，仅记）

- B-3-C1：把「FR 类别」提升为**兜底规则的前置判别**——FR-003 / FR-004 / FR-006 / FR-056 四条的全称句各加一个类别分支（约束型 FR 的「认领 Phase」列取值集单列，不参与 Phase 集合交叉校验，不触发 FR-004 的裁剪登记强制，不触发 FR-006 的自动判未实现，不触发 FR-056 的任务强制）。
- B-3-C2：把 FR-057 的射程从「两节」改为「**全文件**的降级 / 不阻断 / 继续 / 跳过 / 不标记为失败型条款」，例外条款落在文件级的显著位置（不与「同节相邻」冲突的做法是：文件级一处 + 两节各一处指针），并把「不标记为失败」补进类别词表。

## B-4

**承重项**：门不可被三行 YAML 关掉 · **覆盖 FR**：FR-052 / FR-053
**守护判据（逐字抄自清单）**：override 是否仍有任一路径使 `GATE_DESIGN` 在 feature 下 skip / 非硬门禁

**判定：失守**（新增 CRITICAL 1 条 · 已实跑复现，非纸面推演）

### 攻击路径（可复现构造）

R1-C02 攻的是 `gates.GATE_DESIGN` 这一条路，FR-052（schema 禁改）+ FR-053（effective 配置守护项）把它堵住了。但**这道门的触发不由 `gates.*` 决定，而由 `modes.<mode>.phases[].gates_after` 决定**，而 `modes.*` 在 overrides 里是**整段替换**语义，且**不在 FR-052 的禁改集、也不在 FR-053 的断言集内**。

复现步骤（本轮实跑，产物在 scratchpad `b4proj/`，未落入仓内）：

1. 在任一 `<projectRoot>/.specify/orchestration-overrides.yaml` 写入（**完全不碰 `gates:` 块**）：

```yaml
version: "1.0"
modes:
  feature:
    name: feature
    description: "去掉 3.5 门禁的 feature 流程"
    phases:
      - { id: "2", name: specify, display_name: 需求规范, agent: specify, agent_mode: single, gates_before: null, gates_after: null, conditional: null, skip_if_exists: null, is_critical: true }
      - { id: "4", name: plan,    display_name: 技术规划, agent: plan,    agent_mode: single, gates_before: null, gates_after: null, conditional: null, skip_if_exists: null, is_critical: true }
```

2. `node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration feature --format json --project-root <projectRoot>` 的实际输出：

- `diagnostics` **只有一条、级别 `info`**：`orchestration-overrides.mode-overridden` — 「mode "feature" 已被项目级 overrides 整段替换」。**没有 error、没有拒绝。**
- `config.modes.feature.phases` = `[{id:"2",name:"specify",gates_after:null},{id:"4",name:"plan",gates_after:null}]` —— base 的 **phase 3.5 `gate_design`（`plugins/spec-driver/config/orchestration.yaml:257-264`，其 `gates_after: [GATE_DESIGN]`）已整体消失**。
- `config.gates.GATE_DESIGN` **逐字不变**：`default_behavior: "always"` / `hard_gate_modes: ["feature"]` / `applicable_modes` 含 `feature`。

3. `node …/orchestrator-cli.mjs get-gate-behavior feature GATE_DESIGN --project-root <projectRoot>` 实际输出：`{"behavior":"always","source":"hard_gate","is_hard_gate":true,"severity":"critical"}`。

**后果**：FR-053 的三条断言（`feature ∈ hard_gate_modes` / `default_behavior ≠ skip` / `feature ∈ applicable_modes`）**在这条路径下全部 PASS**，FR-052 的禁改字段**一个都没被触碰**（无 diagnostic 可拒），而 `GATE_DESIGN` 在 feature 下**一次都不会被求值**——`plugins/spec-driver/skills/spec-driver-feature/SKILL.md:337-339` 的暂停判定入口逐字为：

> ```
>    GATE_ID="{phase.associated_gate}"
>    if [ -n "$GATE_ID" ]; then
>      GATE_BEHAVIOR=$(node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" get-gate-behavior feature $GATE_ID)
> ```

gate 由 **phase 派生**；没有 phase 携带它，`$GATE_ID` 为空，`get-gate-behavior` 根本不被调用，`SKILL.md:706` 的 `if [ "$is_hard_gate" == "true" ]` 分支永远进不去。

**这比「skip」更强**：`default_behavior: skip` 至少还留在 gate 定义上、能被 FR-053 断言看见；删 phase 使门**在配置上仍然健康、在执行上不存在**——守护项与 CLI 会**双双报告它是一道完好的硬门禁**（第 3 步实跑输出即为此）。这正是本仓 F270 已登记过的「闸门判据被自家链路恒满足」形态。

### 使这条路成立的四处实测

| # | 落点 | 原文 | 作用 |
|---|---|---|---|
| 1 | `plugins/spec-driver/contracts/orchestration-schema.mjs:242` | `phases: z.array(phaseSchema).min(0),` | override 的 phases **允许为空数组**（`.min(0)`），删光所有 phase 都过 schema |
| 2 | `plugins/spec-driver/contracts/orchestration-schema.mjs:290` | `feature: modeOverrideSchema.optional(),` | `modes.feature` 是 schema 显式允许的覆盖 key |
| 3 | `plugins/spec-driver/lib/orchestration-resolver.mjs:74-78` | `if (modeDef !== undefined && modeDef !== null) { / 整段替换：不继承 base 该 mode 的任何字段 / mergedModes[modeKey] = modeDef;` | 无任何「gate phase 必须幸存」的校验 |
| 4 | `plugins/spec-driver/lib/orchestration-resolver.mjs:491-499` | `createDiagnostic('info', 'orchestration-overrides.mode-overridden', …)` | 级别写死 `'info'`，不构成拒绝，也不提 gate |

### 附带发现（同属 B-4 覆盖面，登记不单列 CRITICAL）

**FR-053 的第三条断言打在一个零消费方的字段上。** 全仓 `applicable_modes` 的出现处只有 `contracts/orchestration-schema.mjs:149/157/159`（schema 声明）、`lib/orchestrator-fallback.mjs:16-21`（后备数据）与 `config/orchestration.yaml`（数据本身）——**没有任何读取它做判定的代码**。暂停链上实际被消费的只有 `plugins/spec-driver/lib/orchestrator.mjs:119-147` 的 `buildGateBehaviorMap`：`:120-122` 读 `hard_gate_modes`、`:138` 读 `default_behavior`、`:144` 透出 `severity`。这与 FR-052 自己给出的排除理由（`spec.md:352`：「`severity` 在 gate 决策链上无消费方……把它一并禁改属越界收紧」）**同型**——按同一把尺，`applicable_modes` 也无消费方，却被 FR-053 写成三分之一的断言强度。它不是漏洞，但它使 FR-053 的「3 条断言」在**实际拦截力**上只有 2 条。

**用户级 `spec-driver.config.yaml` 的 `gates.GATE_DESIGN.pause` 这条路已被硬门禁优先级挡住**（`orchestrator.mjs:126-131`：`if (isHardGate) { behavior='always' } else if (userGates[gateId]?.pause)`），只要 `hard_gate_modes` 含 `feature` 就进不去 `userGates` 分支——这一条**守住了**，FR-052/053 覆盖有效。

### 与上轮对照

| 项 | 结论 |
|---|---|
| **R1-C02**（`gates.GATE_DESIGN` 三行 override 关门） | **已堵死**。攻击点 `default_behavior: skip` 与 `hard_gate_modes` 整段替换二者均在 FR-052 禁改集内，且 FR-053 在 effective 配置上补了 base 直接编辑这条路 |
| 本条 | **新增**。`modes.feature` 整段替换删 gate phase 与 R1-C02 不共享攻击面（一个改 `gates.*`，一个改 `modes.*`），按 FR-021 口径判不出对应关系，计新增 |

### 收口指向（不属本轮职责，仅记）

守护判据须从「gate 定义健康」改为「**gate 在 mode 的执行序列上可达**」：对 effective 配置断言 `∃ phase ∈ modes.feature.phases, GATE_DESIGN ∈ (phase.gates_after ∪ phase.gates_before)`；并把 `modes.<mode>` 的整段替换在丢失 base 中 `is_critical` gate phase 时降为 error diagnostic。

## B-5

**承重项**：物理前置 · **覆盖 FR**：FR-015 / FR-016 / FR-017
**守护判据（逐字抄自清单）**：三个 agent 的 `Edit`+`Bash` 是否成为独立可验收项且不随协议正文移交

**判定：失守**（判据两半各判 · 后半守住、前半失守 · 新增 CRITICAL 1 条）

### 判据后半「不随协议正文移交」——**守住**

原攻击（W-B3 的延伸面：把物理前置和它服务的协议正文捆在一起，一并推后）现在卡在三处逐字条款上：

- `spec.md:776`（§分批与移交 · 三条不可让步的边界 第 1 条）：「**`FR-015` 不得随协议正文一起移交。** 它是三份 frontmatter 各加两个 token，成本≈0，却是 FR-027 / FR-028 / FR-030 全部命令类纪律的物理前置。移交它等于让后续卡也做不成。」——**独立成条，且明文限定为「两种边界下都成立」**（`spec.md:774`）。
- `spec.md:680`（边界 A）：核心集 = FR-001 ~ FR-009 + **FR-014 ~ FR-067**，FR-015 / 016 / 017 全在内；移交组只有 FR-010 ~ FR-013（`spec.md:682`）。
- `spec.md:738`（边界 B）：核心集表单列一组「**物理前置 | FR-015 / FR-016 / FR-017（3 条）**」；而移交表 `spec.md:756` 的「分节输出协议 + 第三条注入链」组是 **FR-014 / FR-018 / FR-019 / FR-036**——**协议正文被移交、物理前置被留下，恰是本判据要的那条分界线**。

另外 `spec.md:283`（FR-015 正文）有一句同向的锁：「本条是 FR-014 / FR-027 / FR-028 / FR-030 的共同物理前置，**不得与它们合并交付或以「纪律已写」为由跳过**。」

**结论：这一半守住。** 两个已知边界下都不可能出现「协议走了、Edit/Bash 留在后续卡」的账面。

### 判据前半「独立可验收项」——**失守**

#### B-5-C1 —— FR-017 的 8 条断言是本 spec 里唯一一组**零证据级要求**的机械检查，「没跑」与「跑了且全 PASS」在产物上完全同形

FR-015 的验收对象就是 FR-017 的 8 条断言（`spec.md:285` / SC-003 `spec.md:436` / D-5(a) `spec.md:585`），三处是同一集合。而本 spec 自己在 FR-062 里把「证据级留痕」定成了硬标准，并**逐一点名了它覆盖的三处**——`spec.md:379` 逐字：

> 「**另外两处由各自条款单点覆盖，本条不重复规定**：生产可达性检查已由 FR-010 覆盖（其「本次零新增导出符号必须附产生该结论的命令与原始输出」即同一标准）；**延期承诺候选池的入池步已由 FR-008 覆盖**……**本条只补矩阵对账这一处缺口**。」

即 FR-062 自己点名的证据级覆盖面恰有三处：矩阵对账（本条）、可达性（FR-010，已随组移交）、候选池入池（FR-008）。**FR-017 的 8 条断言不在其中任何一处。**

**把范围放大到全 spec，结论更不利**：另有 `spec.md:303-304`（FR-027 / FR-028 · reverse-census 的「检索命令原样留痕 + 与实际输出计数核对」，即 FR-062 的标准源）、`spec.md:347`（FR-050 · 满载假红归因「必须附命令与其原始输出」，无记录一律计失败）、`spec.md:385`（FR-065 (i) · 触发条件声明须附命令与原始输出，「仅有声明而无依据的关闭视为未做判定」）同样带证据级要求。**在本 spec 里，凡是「执行者自己说做了」的地方几乎都被要求附命令与原始输出——唯独 FR-017 这一组没有。**

**换算式**：附 FR-062 级证据留痕要求的断言数 ÷ FR-017 断言总数 = **0 ÷ 8 = 0%**，单位：断言条。（唯一沾边的是护栏那 1 条要求「与交付前基线逐项比对，**基线须原样写入产物**」——`spec.md:436` / `:585`；但那是**基线**，不是「产生结论的命令与其原始输出」，且**基线由被检方 verify 自己取得并写入**，与结论同源，不构成第三方证据。）

**而 FR-062 给出的立论理由逐字适用于这 8 条**（`spec.md:379`）：

> 「理由：prompt 层执行路径对产出物**无任何证据级要求**，「没跑」与「跑了且干净」在产物上完全同形（本仓 F266 已登记「confirmed-zero 须测量正向证据」的同形教训……）」

FR-017 的执行者正是 prompt 层的 verify 子代理，产物正是一份散文 `verification-report`。verify 在报告里敲下「8 条断言全 PASS」与它真的读了四份 frontmatter 并逐项比对，**产物逐字可以一模一样**。本卡把这条判据应用到了三个地方，唯独漏在自己的 **SC-003**——那是全 spec 唯一一条声称「机械」的结构断言组，也是 B-5 这个承重项的全部落地面。

**叠加两处使洞不能自愈**：

1. **FR-057 的兜底例外不覆盖它。** `spec.md:360` 的例外**只**开给三类检查——「FR 覆盖矩阵对账、生产可达性检查、推断前提实证」。frontmatter 结构断言不在名单内 ⇒ `plugins/spec-driver/agents/verify.md:302`「工具未安装不阻断：优雅降级」与 `:152`「未安装 → 标记"工具未安装"，跳过（不阻断）」对它**照常适用**。护栏那条断言要取「交付前基线」需要 `git show`（即 `Bash`）；`Bash` 不可用时 verify 有明文授权「跳过（不阻断）」，而 FR-057 的例外够不着。
2. **`repo:check` 侧对口守护数为 0。** 见下节实地核实。

**这一条与 R1-C01 不是同一件事，不构成重复追打**：R1-C01 攻的是「用『verify 无 Write/Edit』当独立性证据」，FR-016 已把判据改写为两项可执行义务 + 诚实声明（`spec.md:284`），并在 `spec.md:484` 把 verify 独立性诚实登记为**未取得且本卡不取得**——那是**已登记的残余风险**。本条攻的是另一个量：**即便接受 verify 不独立这一登记，FR-017 仍然可以要求它交出证据**（FR-062 对矩阵对账做的正是这件事——同样是 verify 跑、同样不独立，但要求附命令与原始输出）。同一份 spec 里，对矩阵对账要证据、对 frontmatter 断言不要，**这是遗漏而不是取舍**。

### 实地核实：`repo:check` 对 FR-015 / FR-016 (i) 的机械覆盖 = 0

| 守护项 | 源码 | 覆盖 FR-015 的三份文件？ | 断言 `Edit` / `Bash` 在场？ |
|---|---|---|---|
| `namespace-consistency:agent-frontmatter-*` | `scripts/lib/namespace-consistency-core.mjs:89-95`：`const AGENT_FILES = ['plan.md','implement.md','verify.md','spec-review.md','quality-review.md'];` | **只覆盖 `plan.md` 1 份**——`specify.md` / `tasks.md` **不在册** | **否**。`:133-134` 逐字 `const tools = extractFrontmatterTools(content); const mcpTools = tools.filter((t) => t.startsWith('mcp__'));`，后续 `:137` / `:148` 的两个判定分支只看 `mcpTools`——`Edit` / `Bash` / `Write` 被 `extractFrontmatterTools`（`:22-34`）取到后**在 `:134` 整体滤掉** |
| `preference-rules:agent-block-sync` | `plugins/spec-driver/scripts/sync-preference-rules.mjs:29`：`const AGENTS = ['plan','implement','verify','spec-review','quality-review'];` | 同上，**只覆盖 `plan.md`** | **否**。`plugins/spec-driver/lib/preference-rules.mjs:52-57` 的 `parseFrontmatterTools` 用 `new RegExp(NS + '\\w+', 'g')` 对 `tools:` 行做匹配后 `return m[1].match(re) ?? []`（`NS` 为 mcp namespace 前缀）——**只回收 mcp namespace 前缀项**，`Edit` / `Bash` 结构性不可见 |

**换算式**：对 `Edit` / `Bash` 在场做出断言的 `repo:check` 守护项数 ÷ 相关守护项数 = **0 ÷ 8**（`agent-frontmatter-*` 5 + `preference-rules:agent-block-sync` 1，加 SC-006 表里同族的 2 项，取 SC-006 `spec.md:447-448` 的第 1–6 行口径）= **0%**，单位：守护项。目标文件维度：受任一守护项**在册**的 FR-015 目标文件数 ÷ FR-015 目标文件数 = **1 ÷ 3 = 33.3%**（只有 `plan.md`），单位：agent 文件；而其中断言对口的 = **0 ÷ 3 = 0%**。

**连带**：`FR-016 (i)` 的护栏（`spec.md:284` 自称「这是本条**真正能测到**的量」）在机械层同样测不到——给 `agents/verify.md` 的 `tools` 加一个 `Write`，`agent-frontmatter-verify` 因 `:134` 的 `mcp__` 过滤**不会报**，`preference-rules:agent-block-sync` 因 `parseFrontmatterTools` 的 namespace 过滤**也不会报**。该护栏的唯一执行者仍是持有 `Bash`、写面未封闭的 verify 自己，且比对基线也由它自写。

**口径公允性说明**：`spec.md:448` 已如实写出「`AGENT_FILES` 实测为这 5 份（**不含 `specify.md` / `tasks.md`**）」，`spec.md:456` 也已核实 `parseFrontmatterTools` 只收 mcp 前缀——**事实层没有 over-claim**。缺的是**结论**：这两处实测只被用作 SC-006 的分母相关性理由，没有被推到「⇒ FR-015 / FR-016 (i) 在 `repo:check` 层零覆盖 ⇒ 8 条断言必须自带证据」这一步。

### 附带发现（同属 B-5 覆盖面 · 已判定不单列 CRITICAL，登记备查）

1. **「三条不可让步的边界」只点名 FR-015，不点名 FR-017。** `spec.md:776` 保护的是物理前置本身，但**验证物理前置的那组断言（FR-017）不在不可让步清单上**。两个已知边界下 FR-017 都留核心集，故当前无害；但 `spec.md:731` 明写边界 B「保留供 `GATE_DESIGN` 拍板」，而 `spec.md:729` 又提示 GATE 会看到一个被重算过的第三组数字——若 GATE 拍出第三种边界并移交 FR-017，则 FR-015 留下、无人验证，且**移交不走 FR-060 裁剪通道**（`spec.md:778` Q6 硬约束），没有任何闸门会问一句。收口成本≈0：把 FR-017 补进 `spec.md:774` 那三条即可。
2. **D-5 把 8 条确定性断言与一个未证实的行为前提绑进同一个演示的通过条件。** `spec.md:588` 的判定通过条件逐字为「三段全部成立，**且（b）(c) 的 ≥ 3 次独立观察全部自发分节落盘**」——(a) 的 8 条断言是确定性的（读四份 frontmatter），(b)(c) 依赖推断前提 A-2（子代理自发遵守协议）。A-2 被证伪时 D-5 整体不通过。**不计 CRITICAL 的理由**：`spec.md:509` 已显式解耦结论——「若被证伪：US-3 退化为「只解决了工具能力对齐（FR-015 / FR-017 仍成立），未解决行为遵守」」，且 SC-003 是独立成条的验收面，不随 D-5 的通过与否变化。
3. **SC-013 括注与边界 B 表的 FR 清单不一致，spec 已自行登记。** `spec.md:472` 写「需求项 5 只留 FR-015」，`spec.md:738` 的边界 B 表留的是三条；`spec.md:767` 已把该差异作为核对留痕写出并说明 M 取值不受影响、更正留给 GATE 拍板。**属已登记项，不追。**

### 与上轮对照

| 项 | 结论 |
|---|---|
| **R1 W-B3**（只补 `Edit` 是治了一半，缺 `Bash` 使命令类纪律仍不可执行） | **已堵死**。`spec.md:283` 明写「**同时补入 `Edit` 与 `Bash`**」并逐条给出缺 `Bash` 的三个下游（FR-030 的 `git show` / FR-027 / FR-028 的复跑计数），且加了「不得与它们合并交付」的锁；FR-017 的正向断言相应写成 3 × 2 = 6 条 |
| **R1-C01**（用「`tools` 无 `Write`/`Edit`」为独立性背书） | **已堵死**。`spec.md:285` 明文禁用该断言，`spec.md:284` 改为「护栏 + 诚实声明」两项可执行义务，`spec.md:484` 把独立性诚实登记为未取得且本卡不取得 |
| **B-5-C1** | **新增**。攻击的是「这组断言自身有无证据要求」，与 R1-C01 的「用错断言做独立性证据」不共享攻击面；按 FR-021 口径判不出对应关系，计新增 |

### 收口指向（不属本轮职责，仅记）

- 把 FR-062 的证据标准平移到 FR-017：8 条断言各附产生该结论的命令原文与其**原始输出**（如 `sed -n '1,5p' plugins/spec-driver/agents/specify.md` 的实际输出行），无命令与输出者按 FR-005 计「未执行（缺席）」——与矩阵对账同口径。
- 把 frontmatter 结构断言补进 FR-057 的例外类别名单（当前只有三类）。
- 成本最低的机械收口：`scripts/lib/namespace-consistency-core.mjs` 的 `AGENT_FILES` 补 `specify.md` / `tasks.md`，并在 mcp namespace 断言之外加一条「`tools` 必含 `Edit` 与 `Bash`」的正向断言 + 一条 `verify.md` 工具项白名单断言——这会把 B-5 的验收从 prompt 层搬到 `repo:check` 层，同时一并解掉 FR-016 (i) 的自证问题。
- 把 FR-017 补进 `spec.md:774` 的「三条不可让步的边界」。

## 结论

### 三项判定

| # | 承重项 | 判定 | 本项新增 CRITICAL | 一句话 |
|---|---|---|---|---|
| **B-3** | 死锁与冲突收编（FR-054 ~ 058） | **失守** | **2** | 约束型 FR 在 FR-003 / 004 / 005 / 006 / 056 之间构成新的三重互锁（两条路都违规，且本卡自己的 4 条约束型 FR 必然撞上）；FR-057 的例外射程只到两节，`verify.md:152` / `:163` 的跳过型兜底在射程外且因其逐行点名禁令不可补 |
| **B-4** | 门不可被三行 YAML 关掉（FR-052 / 053） | **失守** | **1** | `modes.feature` 整段替换删掉 `gates_after: [GATE_DESIGN]` 的 phase，即可让门在 feature 下一次都不被求值，而 FR-052 的禁改字段一个未碰、FR-053 的三条断言全部 PASS——**已实跑复现** |
| **B-5** | 物理前置（FR-015 / 016 / 017） | **失守**（判据后半「不随协议正文移交」守住，前半「独立可验收项」失守） | **1** | FR-017 的 8 条断言是全 spec 唯一一组零证据级要求的机械检查（0 ÷ 8 附「命令原文 + 原始输出」），而 FR-062 自己的立论「『没跑』与『跑了且干净』在产物上完全同形」逐字适用；`repo:check` 侧对口守护 0 ÷ 8 |

### 换算式

- **守住数 ÷ 承重项数 = 0 ÷ 3 = 0%**，单位：承重项。
- （细分口径，不改上式）B-5 的守护判据含两半，其中「不随协议正文移交」一半守住：**守住的判据半数 ÷ 判据半数总计 = 1 ÷ 4 = 25.0%**，单位：判据半（B-3 记 1 半、B-4 记 1 半、B-5 记 2 半）。**上式为准，本式仅供 GATE 判断失守深度**——B-5 不因其后半守住而升格为「守住」。
- **承重项内新增 CRITICAL 条数 = B-3 2 + B-4 1 + B-5 1 = 4 条**，单位：CRITICAL 条。
- **承重项内登记但不单列 CRITICAL 的附带发现 = B-3 3 + B-4 1 + B-5 3 = 7 条**，单位：附带条（B-4 节另有 1 段是「守住」确认——用户级 `spec-driver.config.yaml` 的 `gates.GATE_DESIGN.pause` 被 `orchestrator.mjs:126-131` 的硬门禁优先级挡住——**不是发现，不计入这 7 条**）。

### 与前两轮的收敛态

- **R1 的三条对应项（R1-C02 / R1-C09 / R1-C10 / R1-C12 / R1-C01 / W-B3）逐条复核，全部实质已修**，本轮**没有一条是旧洞未修**：R1-C02 卡在 FR-052 禁改集；R1-C09 卡在 FR-055 对 `spec-review.md:123` / `:130` 的方向重写要求；R1-C10 卡在 FR-056 的裁剪例外 + `tasks.md:51` / `:78` 两处同改；R1-C12 卡在 FR-057 的面向类别写法；R1-C01 卡在 FR-017 对负向断言的明文禁用；W-B3 卡在 FR-015 的「同时补入 `Edit` 与 `Bash`」。
- **4 条新增全部是「修补后新暴露的相邻面」**，形态高度一致：**本卡为堵一个洞而新造的类别 / 例外 / 断言集，其自身没有被同一把尺量一遍**——约束型 FR 类别没被贯穿进兜底规则（B-3-C1）、兜底例外的射程没被贯穿到整份文件（B-3-C2）、门的禁改集没被贯穿到门的调用面（B-4）、证据级留痕没被贯穿到自己的核心断言组（B-5-C1）。这与 R2 已登记的收敛特征（「每轮都在上轮修订里发现新洞」）同向。

### 非承重「登记不追」清单

按止损纪律，本轮**未主动搜索**承重项覆盖面之外的问题；下列 2 条系核实承重项时顺带撞见，登记备查，**本轮不追、不计入上述任何计数**：

1. **`spec.md:452` 的 `repo:check` check id 总数 88 是 2026-09-02 的单次实跑值，本轮未复跑。** 该数是 SC-006 分母核验式「相关 18 + 不相关 70 = 88」与交付后核对式「88 + 2 = 90」的共同基数；期间若有守护项增减，两式同时失真。属 SC-006 面，承重项 B-6 之外。
2. **base 与 fallback 的 gate 适用面不一致（仓内既有，不属本卡范围）。** `plugins/spec-driver/config/orchestration.yaml` 的 `GATE_TASKS`（`:74-78`）与 `GATE_VERIFY` 的 `applicable_modes` 均含 `refactor`，而 `plugins/spec-driver/lib/orchestrator-fallback.mjs:19` / `:21` 的同名后备定义**均不含 `refactor`**；`hard_gate_modes` 亦为 `null`（yaml）vs `[]`（fallback）。**今天无实害**——`applicable_modes` 全仓零消费方（见 B-4 附带），`null` 与 `[]` 在 `orchestrator.mjs:120-122` 的 `Array.isArray(...) && includes(...)` 下等价；但一旦有人按 FR-053 把 `applicable_modes` 接成真判据，base 与 fallback 会给出不同答案。

### 本轮方法论留痕

- **实跑而非纸面**：B-4 的构造在 scratchpad 的独立 `projectRoot` 上真实跑通（`effective-orchestration` + `get-gate-behavior` 两条命令的原始输出已抄入 B-4 节），未在仓内落任何文件；B-3 / B-5 的判定基于对现行 spec 原文与仓内源码的逐行核对，行号已逐条复核（FR-057 点名的 `verify.md:302/303/308/309/310/311`、FR-055 点名的 `spec-review.md:56-59/80/115-117/123/130`、FR-056 点名的 `tasks.md:51/78` 与 `orchestration.yaml:78-80` **全部核对属实**）。
- **本报告只写 B-3 / B-4 / B-5**，未改 `spec.md`，未做任何 git 状态变更。
