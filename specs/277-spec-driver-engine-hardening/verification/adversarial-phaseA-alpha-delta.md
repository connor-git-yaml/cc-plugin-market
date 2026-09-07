# Phase A 对抗复验（α delta 轮）

- 角色：对抗性审查员（异构档位 · Codex 配额暂停期）
- 任务：核验实现方对 α 报告 3 条 CRITICAL + α-W2 的修复是否**实质**成立；只攻「修复新引入的内容」
- 工作目录：`.claude/worktrees/vigorous-mahavira-7de572`
- 纪律：只读 + 微探针。全部构造落在 scratch 项目根并经 `--project-root` 指向；
  工作区 `.specify/orchestration-overrides.yaml` 全程未创建；未跑 `repo:check` / `vitest` / `test:plugins` / `repo:sync`；
  未改任何仓内文件（本报告除外），未 `git stash` / `git checkout`。

---

## α 条目复验表

| α ID | 判定 | 依据（卡在哪一句 / 或仍能跑通的构造） |
|------|------|------|
| **α-C1** `conditional` 恒假幽灵门位 | **实质已修** | 卡在 `contracts/orchestration-schema.mjs:415-417` 的 `suppressorMatches`（`c.conditional === anchor.conditional && c.skipIfExists === anchor.skipIfExists`）→ 违规经 `lib/orchestration-resolver.mjs:631` 的 `validateGateMounting(merged, baseConfig)` 拒绝并整份回退 base。实跑：`diagnostics=['error:orchestration-overrides.gate-mounting-lost']`、`phases=17`（base 值）、FR-053 `status=fail` |
| **α-C2** `skip_if_exists` 恒真幽灵门位 | **实质已修** | 同一行判据（`skipIfExists` 侧）；实跑输出与 C1 逐位相同 |
| **α-C3** 门挂到序列末尾 | **实质已修** | 卡在 `:403` `missing-anchor`（原锚点 `gate_design` / `plan` 已不含该 gate）与 `:437` `findOrderBreak` 的 `order-broken`；实跑同上 |
| **α-W2** 重复 `tools:` 键 | **仅措辞变动** | α 报告里的**字面**构造（两行 `^tools:`）现在 throw；但同类构造 `tools :`（键名与冒号间加一个空格）与 `"tools":`（引号键）**两道守护项全绿**，而合规解析器（PyYAML 6.0.3）读到 `Write` / `Edit`。构造与输出见 §α-W2 复验 |

**换算**：实质已修 **3** / 仅措辞变动 **1** / 未修 **0**（3+1+0 = 4）。

### α-C1 / α-C2 / α-C3 复验实跑

生成器沿用 α 的 `scratchpad/mkover.mjs`（mutator `conditionalFalse` / `skipIfExists` / `mountAtEnd`），
scratch 项目根 `$SCR/d_<mutator>`。

```
$ node "$SCR/mkover.mjs" "$SCR/d_<m>" feature <m>
$ node plugins/spec-driver/scripts/orchestrator-cli.mjs get-gate-behavior feature GATE_DESIGN --project-root "$SCR/d_<m>"
$ node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration feature --format json --project-root "$SCR/d_<m>"

########## conditionalFalse ##########
mounted= True mounted_in_base= True
violations= []
diagnostics= ['error:orchestration-overrides.gate-mounting-lost']
phases= 17
########## skipIfExists ##########   （逐位相同）
########## mountAtEnd ##########      （逐位相同）
```

FR-053 事后守护（直调 `validateGateMounting({projectRoot})`）：

```
##### FR-053 on d_conditionalFalse #####
status = fail | passed = 9 / 12
failed = ["diagnostics:feature","diagnostics:implement","diagnostics:story"]
##### d_skipIfExists / d_mountAtEnd #####   （逐位相同）
```

对照 α 修订前实测（`status = pass`、`diagnostics=['info:mode-overridden']`、`phases=18/18/17`），
三条 CRITICAL 的原构造**均已封住**。`mounted=true` 是回退 base 后的诚实值（同 D-4 口径），
判红由 `error` 级 diagnostic 与 FR-053 `diagnostics:*` 三条断言承担，不是 fail-open。

### 顺带复验：任务清单点名的其余绕过形态（**全部封住**）

| 构造（mutator） | 实测 diagnostics | FR-053 | 结论 |
|---|---|---|---|
| `name` 大小写变体（`gate_design` → `Gate_Design`） | `error:gate-mounting-lost` | fail 9/12 | **封住**（`:401` 严格 `===` 比名，missing-anchor） |
| `name` 尾随空格（`"gate_design "`） | `error:gate-mounting-lost` | fail 9/12 | **封住**（同上） |
| 删掉锚点之后的**全部** phase（`truncateAfterAnchor`） | `error:gate-mounting-lost` | fail 9/12 | **封住**（`findOrderBreak` 把「base 后继在 effective 缺席」也计破坏，`:352-354`） |
| 位序交换 `gate_design` ↔ `plan` | `error:gate-mounting-lost` | fail 9/12 | **封住**（`order-broken`） |
| 同名同侧诱饵放**末尾**、真锚点改恒假（`dupNameDecoyEnd`） | `error:gate-mounting-lost` | fail 9/12 | **封住**（诱饵位序破坏，无 witness） |
| 同名同侧诱饵放**原位**、真锚点改恒假并挪到末尾（`dupNameDecoyFront`） | `info:mode-overridden`（放行） | pass 12/12 | **不是绕过**——`shouldExecutePhase` 模拟实测求值点仍为 `["gate_design.gates_after","plan.gates_before"]`，诱饵是一处真实可达且位序正确的挂载，与 `:418-421` 的 witness 语义一致 |

### α-W2 复验（**仍能跑通**）

四份攻击体放在 `$SCR/w2/`，`verify.md` 形态；对照解析器用 PyYAML 6.0.3（本机 `python3` 自带，
α 当时因 `node_modules` 无 `js-yaml`/`yaml` 而未取到该证据，本轮补上）。

```
$ node "$SCR/w2/probe_w2.mjs" b1.md b2.md b3.md b4.md      # 仓内解析器 + agent-tools 护栏
b1.md    parsed=["Read","Bash","Grep","Glob","mcp__plugin_spectra_spectra__detect_changes","mcp__plugin_spectra_spectra__impact"]  no-added-tools=pass
b2.md    parsed=["Read","Bash","Grep","Glob","mcp__plugin_spectra_spectra__detect_changes","mcp__plugin_spectra_spectra__impact"]  no-added-tools=pass
b3.md    parsed=[]  no-added-tools=pass
b4.md    parsed=["Read","Bash",...]                                                        no-added-tools=pass

--- 合规解析器（PyYAML 6.0.3）对同批文件的结论 ---
b1.md    PyYAML tools = ['Read', 'Bash', 'Write', 'Edit']
b2.md    PyYAML tools = ['Read', 'Write', 'Edit']
b3.md    PyYAML tools = ['Read', 'Bash', 'Write', 'Edit']
b4.md    PyYAML ERROR: ParserError: while parsing a block mapping
```

四份攻击体的差别只在第二个键怎么写：

- **b1** —— 诱饵行内数组 + `tools :`（键名与冒号之间一个空格）后接块状序列。YAML 里 `tools :` 的键**就是** `tools`，
  但计数正则 `/^tools:/gm`（`namespace-consistency-core.mjs:41`）匹配不到它 ⇒ `toolsKeyCount === 1` ⇒ 不 throw。
- **b2** —— 诱饵 + `"tools":`（引号键）。同理计数为 1。
- **b3** —— **只有一个** `tools:` 键，但后面跟一个行内注释再换行接块状序列：
  ```yaml
  tools:   # 与冻结快照保持同步
    - Read
    - Bash
    - Write
    - Edit
  ```
  行内正则要求 `\[`、块状正则要求 `^tools:\s*\n`，注释使两者**都不匹配** ⇒ 解析器返回 `[]` ⇒
  `agent-tools-core.mjs:154` 的 `added = verifyTools.filter(...)` 为空 ⇒ 护栏判 `pass`。
  这一份**根本没有重复键**，本轮新增的计数判据结构性无法覆盖。
- **b4** —— 第二个键缩进一格。PyYAML 直接 ParserError（真解析器拒收），仓内解析器静默判 pass。

两道守护项的联合结论（scratch 仓根 `$SCR/w2root_<v>`，含 `plugins/spectra/.claude-plugin/plugin.json` 与 `.mcp.json`）：

```
### b1 ###  namespace-consistency status = pass（agent-frontmatter-verify pass）
            agent-tools verify:no-added-tools = pass | 相对冻结快照零新增
### b2 ###  namespace-consistency status = pass（agent-frontmatter-verify pass）
            agent-tools verify:no-added-tools = pass | 相对冻结快照零新增
### b3 ###  namespace-consistency status = fail（verify.md 未找到任何 mcp__ 工具）
            agent-tools verify:no-added-tools = pass | ...删减（不判红）：[Read, Bash, Grep, Glob, mcp__...]
```

- **b1 / b2 是干净绕过**：两族守护项全绿，而合规解析器读到 `Write` + `Edit`。
- **b3 被 `namespace-consistency` 兜住**，但兜住它的是「受保护 agent 必须含 `mcp__` 工具」这条
  与本议题无关的既有断言（`namespace-consistency-core.mjs:112-118` 的 `AGENT_FILES` 恰好含 `verify.md`），
  属**副作用兜底**，不是本轮判据的功劳；对不在 `AGENT_FILES` 内的 agent 该兜底不存在。

α 报告里的**字面**构造确实已被封（原样喂进去 `THROW: frontmatter 内 "tools:" 键出现 2 次…`），
但 α-W2 主张的那条安全属性——「守护项的读法必然与任一符合规范的解析器不一致，
因此它对这类文档给出的 `pass` 不构成证据」——**未被改变**。故判**仅措辞变动**。

---

## 修复新引入的缺陷

### CRITICAL

#### **[δ-C1]** 位序规则只比对 **base 已有的 phase 名**：在锚点之前插一个**新名字**的产出型 phase，即可让 `story` / `implement` 的两道门**零求值**，而三道防线全绿

新引入的判据 3（`findOrderBreak`，`orchestration-schema.mjs:332-351`）实现的是
「**base 中位于锚点之后的每个 phase 名**，在 effective 里索引仍更大」。它只枚举 `baseNames`——
effective 里**新增的、base 没有的 phase 名**完全不进入这个循环。而判据 2 只比对锚点自己的
`conditional` / `skip_if_exists` 是否与 base 逐字相等，管不到「别的 phase 把这个锚点的
`skip_if_exists` 条件提前满足了」。

`base` 的锚点实况（D-21 表已登记，本轮复核一致）：`story` 的 3 个 GATE_DESIGN / GATE_TASKS 锚点
**全部**带 `skip_if_exists`（`specify` → `spec.md`，`plan` → `plan.md`），`implement` 的 GATE_DESIGN
唯一锚点带 `skip_if_exists: plan.md`。于是只要在序列**最前**插入产出这些制品的 phase，锚点
一个字都不用改，就会在运行时被 `shouldExecutePhase` 整体跳过。

**构造**（`scratchpad/mkdelta.mjs`，mutator `storyPrependProducers`；`modes.story` 整段替换，
**锚点 phase 逐字保持 base 原样**，只在最前面加两个新 phase）：

```yaml
- id: "0.001"
  name: "spec_early"
  display_name: "spec_early"
  agent: "specify"
  agent_mode: "single"
  gates_before: null
  gates_after: null
  conditional: null
  skip_if_exists: null
  is_critical: false
- id: "0.002"
  name: "plan_early"
  agent: "plan"
  ...
# 其后是 base 的 constitution / specify / plan / implement / verify 五个 phase，一字未改
```

**三道防线实测（全绿）**：

```
$ bash "$SCR/probe.sh" "$SCR" storyPrependProducers story
########## storyPrependProducers ##########
  GATE_DESIGN mounted= True in_base= True viol= []
  GATE_TASKS  mounted= True in_base= True viol= []
  diagnostics= ['info:orchestration-overrides.mode-overridden']
  phases= 7 names[:4]= ['spec_early', 'plan_early', 'constitution', 'specify']   ← 覆盖已生效，未回退
  FR-053 status = pass | passed = 12 / 12
  FR-053 failed = []
```

**运行态实证**（用 Orchestrator 自己的 `shouldExecutePhase` 逐 phase 求值，
agent 为 `specify` / `plan` / `tasks` 的 phase 跑完记为产出对应制品）：

```
===== story · base 对照组 =====
RUN  1   constitution   gb=[] ga=[]
RUN  2   specify        gb=[] ga=["GATE_DESIGN"]
RUN  3   plan           gb=["GATE_DESIGN"] ga=["GATE_TASKS"]
RUN  4   implement      gb=[] ga=[]
RUN  5   verify         gb=[] ga=["GATE_VERIFY"]
>> GATE_DESIGN 实际求值点 = ["specify.gates_after","plan.gates_before"]
>> GATE_TASKS  实际求值点 = ["plan.gates_after"]

===== story · storyPrependProducers =====
RUN  0.001 spec_early   gb=[] ga=[]
RUN  0.002 plan_early   gb=[] ga=[]
RUN  1     constitution gb=[] ga=[]
SKIP 2     specify      gb=[] ga=["GATE_DESIGN"]
SKIP 3     plan         gb=["GATE_DESIGN"] ga=["GATE_TASKS"]
RUN  4     implement    gb=[] ga=[]
RUN  5     verify       gb=[] ga=["GATE_VERIFY"]
>> GATE_DESIGN 实际求值点 = []
>> GATE_TASKS  实际求值点 = []
```

`implement` 模式同法（mutator `implPrependPlanEarly`，只需一个 `plan_early`）：

```
########## implPrependPlanEarly ##########
  GATE_DESIGN mounted= True in_base= True viol= []
  diagnostics= ['info:orchestration-overrides.mode-overridden']   phases= 7
  FR-053 status = pass | passed = 12 / 12
>> GATE_DESIGN 实际求值点 = []
>> GATE_TASKS  实际求值点 = ["analyze.gates_after"]
```

`feature` 模式（mutator `prependProducers`）不能做到零求值（`gate_design` / `analyze` 两个锚点
`skip_if_exists` 本就为 null，必执行），但仍把 GATE_DESIGN 的求值点从 2 个砍到 1 个，
且那 1 次发生在 `plan.md` / `tasks.md` **已经写好之后**：

```
SKIP 4   plan    gb=["GATE_DESIGN"]     ← 被 plan_early 产出的 plan.md 跳过
SKIP 5   tasks
>> GATE_DESIGN 实际求值点 = ["gate_design.gates_after"]     （base 对照组为 2 个）
```

**命中位置**：

- `plugins/spec-driver/contracts/orchestration-schema.mjs:333`
  ```js
  for (let i = baseAnchorIndex + 1; i < baseNames.length; i += 1) {
  ```
  循环上界是 `baseNames.length`——**effective 新增的 phase 不在这个域内**，
  它们插在哪儿、跑什么 agent、产出什么制品，本判据一概看不见。
- 同文件 `:415-417`（判据 2）只做锚点自身两个字段的逐字比对，
  对「抑制条件被**别处**满足」结构性失明。
- `plugins/spec-driver/scripts/validate-gate-mounting.mjs:110`
  ```js
  const liveAnchors = anchors.filter(a => a.conditional === null);
  ```
  FR-053 的收紧只看 `conditional`（D-21 已说明理由：一并要求 `skip_if_exists === null`
  会把干净仓库判红），故它对本构造同样全绿。

**后果**：与 α-C1 / α-C2 **同一条安全属性**——项目级 overrides 可让 `GATE_DESIGN` / `GATE_TASKS`
在 `story`（两道门）与 `implement`（GATE_DESIGN）全程一次都不被求值，且

| 防线 | 本构造下 |
|---|---|
| FR-052 丙（resolver `findLostGateMountings`） | `violations = []` ✅ 放行 |
| FR-068 运行时守卫（判据 1「`mounted_in_base ⇒ mounted`」/ 判据 2「无 `error` diagnostic」） | `true ⇒ true` ✅ / 只有 `info` ✅ 放行 |
| FR-053 事后守护 | `status = pass`、12/12 ✅ |

**绕过成本比 α 的三条更低**：不碰任何锚点、不删任何 phase、不写任何 `conditional`。
人工 review 看到的 YAML diff 是「在流程最前面加了一个预处理步骤」，两道门在文件里
逐字完好；而 D-21 表格里那句「story 的锚点全部带 `skip_if_exists`」正是这条路径的钥匙。

**最小修补方向**（两条，任一即可闭合，建议同上）：

1. **判据 3 的位序域从 base 名扩到 effective 全序列**：断言「effective 中任何**产出型** phase
   （`agent` 非 null）都不得排在锚点之前，除非 base 里也有同名 phase 排在它之前」——
   即位序不变量由「base 名的相对次序」升为「锚点之前不得出现新的产出」。
2. **判据 2 从「锚点自身逐字相等」升为「锚点的 `skip_if_exists` 在 effective 序列上仍不可被前驱满足」**：
   对每个带 `skip_if_exists: X` 的锚点，断言 effective 中排在它之前的 phase 的产出集不含 `X`
   （产出集可由 `agent` → 制品的既有映射派生，`base` 自己的 `skip_if_exists` 值就是这张表）。

不建议的修法：把 FR-053 (i) 一并要求 `skip_if_exists === null`——D-21 的变异体 M2 已实证
会把未改动的仓库判红，那是 base 的既有形状，不是本卡该改的事。

---

### WARNING

#### **[δ-W1]** `mounted` 字段被新公式重载成**两种语义**，第二支答的正是 α 已证「不构成证据」的纯结构存在性；CLI 的字段注释只描述了第一支

新公式（`orchestration-schema.mjs:386-388`）：

```js
if (baseAnchors.length === 0) {
  return { mountedInBase: false, mounted: isGateMountedInMode(effectiveConfig, mode, gateId), ... };
}
```

`isGateMountedInMode` 自己的 doc 写着「**纯结构存在性判据，不得再被任何一道防线单独当判据用**」
（`:228-234`），而这一支把它的返回值直接放进对外字段 `mounted`。

**构造**：`refactor` 在 base 里对 `GATE_DESIGN` **零锚点**（实测 8 个 mode 的锚点数：
`feature 2/2`、`story 2/1`、`implement 1/1`、`fix 1/0`、`resume 0/1`、`sync 1/1`、`doc 1/1`、`refactor 0/2`）。
对 `modes.refactor` 整段替换，最前面插一个 `conditional: "never_true == true"` 的
幽灵 phase 挂 `GATE_DESIGN`：

```
$ node plugins/spec-driver/scripts/orchestrator-cli.mjs get-gate-behavior refactor GATE_DESIGN --project-root "$SCR/n_refactor_ghost"
refactor/GATE_DESIGN mounted= True mounted_in_base= False viol= []
$ ... effective-orchestration refactor --format json
diagnostics= ['info:orchestration-overrides.mode-overridden']
```

即 CLI 对一道**永远不会被求值**的门答 `mounted: true`。

**命中位置**：`plugins/spec-driver/scripts/orchestrator-cli.mjs:131-134` 的字段注释

```
// FR-052：该 gate 在本 mode 的 **effective** phase 序列中是否**与 base 锚定且可达**
// ——同名同侧仍挂、无新增抑制条件、位序保持。
```

这段话对 `mountedInBase === false` 的那一支是**不成立**的：那一支既没有锚定，也不判可达。
D-20 把这一支称为「诚实」，成立的部分是「它诚实回答了结构上挂没挂」；不成立的部分是
**字段名与注释都没有携带这个分支信息**，而 FR-068 守卫散文的判据 1 是直接读 `mounted` 的。
残余 3 谈的是 `behavior`，残余 2 谈的是 base 被直接编辑，**没有一条覆盖本条**。

严重级定 WARNING 而非 CRITICAL：FR-068 判据 1 在前件为假时空洞成立，本条不构成判据被绕过；
真实风险是**人 / LLM 执行者读到 `mounted: true` 得出「门在场」的结论**——这正是 α-C1 之所以
成为 CRITICAL 的那个误读，只是换到了另一支上。

**最小修补方向**：把该支的返回值改名（如 `structurallyPresent`）或让 `mounted` 在该支返回 `null`
并由消费方按「判不出」处置；同时把 CLI 注释与守卫散文改成分支表述。改动只涉及输出面与散文，
不动判据本身。

#### **[δ-W2]** 新增的重复键 fail-loud 自称「歧义文档一律判红」，实际检测面只覆盖 `^tools:` 这一种行首字面形态——口径宽于实现

`namespace-consistency-core.mjs:41` 的计数只认 `/^tools:/gm`。而 D-22 与该函数的新 doc 都写
「歧义文档一律判红——不猜『哪一份才算数』」。§α-W2 的 b1 / b2 / b3 三份实测反例说明：
`tools :`、`"tools":`、以及**单键 + 行内注释**这三种形态都拿不到红灯，其中 b3 连重复键都没有。

这不是「修得不彻底」这一句就够——**新写的口径本身是 over-claim**，而 F270 已登记过
「范围在实现阶段静默收缩 = over-claim 结构性根源」。若本轮不扩检测面，
D-22 的「歧义文档一律判红」与函数 doc 的同句都应改成
「**行首无修饰的重复 `tools:` 键**判红；其余歧义形态未覆盖」，并把 b1/b2/b3 登记为残余。

**最小修补方向**（按代价从低到高）：
1. 计数正则放宽为 `/^\s*["']?tools["']?\s*:/gm`，同时把行内 / 块状两个取值正则同步放宽；
2. 取值失败（两个正则都不匹配）但 frontmatter 里确实出现过 `tools` 键时 **throw**，
   堵掉 b3 那条「解析成空数组 ⇒ 护栏零新增 ⇒ pass」的路；
3. 根治是别再手写 frontmatter 词法——但那要引依赖，与 FR-037 冲突，需走 spec。

---

### INFO

#### **[δ-I1]** 判据 2 是「逐字相等」而不是「不强于 base」，把**放宽抑制条件**（更安全的方向）也判红，且 detail 文案与事实相反

构造（mutator `weakerSuppressor`）：把 `feature.plan` 的 `skip_if_exists: "plan.md"` 改成 `null`
——这让 GATE_DESIGN 的 `plan.gates_before` 锚点**更容易**被求值。实测被拒并整份回退 base：

```
[suppressor-added] phase "plan" 的抑制条件强于 base：conditional null → null，
skip_if_exists "plan.md" → null（该 phase 不被执行时，挂在它上面的 GATE_DESIGN 一次都不会被求值）
```

方向是 fail-closed，不构成安全问题；但 (a) 项目无法经 overrides 把门**收紧**，
(b) 消息说「抑制条件强于 base」而实际是弱于 base，会误导排障的人。
建议判据改为偏序（`null` 弱于任意非 null；非 null 之间仍要求逐字相等），
或至少把文案改成「抑制条件与 base 不一致」。

#### **[δ-I2]** 守卫散文「残余 4」的声明范围窄于实际洞

残余 4 的原文只覆盖「**base 里的锚点被直接编辑加上 `skip_if_exists`**」。本轮复核该条**属实**——
把 `config/orchestration.yaml:266` 的 `skip_if_exists: null` 改成 `skip_if_exists: spec.md` 后：

```
CLI mounted= True in_base= True viol= []
FR-053 status = pass | passed 12 / 12
GATE_DESIGN 实际求值点（spec.md 已存在时）= ["plan.gates_before"]     ← gate_design 锚点被跳过
```

但 δ-C1 证明**同一类失效经项目级 overrides 也可达，且不需要碰 base、不需要碰锚点**。
残余 4 现有措辞会让读者以为「只要 base 文件进人工复核就兜住了」，而 overrides 文件的
review 强度与 base 完全不同。建议残余 4 扩写为
「凡使锚点的 `skip_if_exists` 被满足的改动——无论改 base 锚点本身，还是在 effective 序列
里插入产出该制品的前驱 phase——两道守护都不覆盖」，并在 δ-C1 修好后删除后半句。

#### **[δ-I3]** `dupNameDecoyFront` 一类同名重复被放行是**正确**的，但配置里出现两个同名 phase 时 `buildFirstIndexByName` 取最小索引、`candidates` 取全集，两处口径不同，值得在 doc 里写一句

`:314-320` 的 `buildFirstIndexByName` 对重名取**首个**索引（从严，更易判出位序破坏），
而 `:399-401` 的 `candidates` 取**全部**同名同侧锚点、`:418` 取任一 witness（从宽）。
两处方向相反是有意的且都正确（前者判后继位置、后者找见证），实测 `dupNameDecoyFront`
的运行态求值点与 base 一致，无绕过；但函数 doc 只解释了后者，前者的「从严」注释
（`:312`）没说它与 witness 语义的关系。纯文档项。

---

## 结论

- **α 条目复验**：实质已修 **3**（α-C1 / α-C2 / α-C3）/ 仅措辞变动 **1**（α-W2）/ 未修 **0** ——合计 4 ✅
- **新增 CRITICAL：1**（δ-C1）
- **新增 WARNING：2**（δ-W1 / δ-W2）
- **新增 INFO：3**（δ-I1 / δ-I2 / δ-I3）
- 顺带复验的 6 组「新引入面」构造中 **5 组封住、1 组（`dupNameDecoyFront`）经运行态实证不是绕过**

**最重要的一条**：修订把判据从「门的名字还在不在」升到「base 锚点还可不可达」是**方向正确的**，
三条 CRITICAL 的原构造逐条实测封住。但新判据的**可达性模型只覆盖了锚点自己的两个抑制开关**，
没覆盖「抑制条件被序列里**别的 phase** 提前满足」；而位序规则的枚举域是 **base 已有的 phase 名**，
新增 phase 结构性不可见。二者叠加，使 α-C1 / α-C2 的**同一条安全属性**在 `story` / `implement`
两个强制 mode 上以更低成本复现——`GATE_DESIGN` / `GATE_TASKS` 零求值，三道防线全绿
（`viol=[]` / `info:mode-overridden` / FR-053 12 ÷ 12 pass）。这与 F259 已登记的反模式同型：
**判据每增加一种「门为什么没被求值」的机制就漏一次**，应把不变量钉在「这道门在最坏的 effective
序列下仍会被求值」这个语义上，而不是逐条枚举抑制机制。

**提交意见**：**建议 δ-C1 在本 Phase 内收口后再提交**。理由是本卡的交付物正是这三道门禁，
把一条与 α-C1/C2 同级、成本更低、且**已由本轮实跑证实**的绕过随新门禁一起入库，
就是本仓多次被罚过的「刚上线的门禁带着已知绕过入库」模式（D-22 自己写下的那句话）。
δ-W2 的口径修正是**零代码**的（改 D-22 与函数 doc 两句 + 登记 b1/b2/b3 残余），无论是否扩检测面都应随同批做。
δ-W1 / δ-I1 / δ-I2 / δ-I3 可登记不修，但 δ-I2 的残余 4 扩写建议随 δ-C1 一并处理。

**审查员诚实登记**：本轮是异构内部对抗（Codex 配额暂停期档位），
**Codex 异构档位缺席**；本报告的「封住」结论只覆盖列出的构造，不构成穷举证明。
运行态判据一律用 Orchestrator 自己的 `shouldExecutePhase` 作 oracle
（与修订代码注释「该 phase 不被执行时，挂在它上面的 gate 一次都不会被求值」同源）；
SKILL 散文实际怎么消费 phase 序列不在本轮观测范围内。
