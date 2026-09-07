# Phase A 异构对抗审查 — 切入角 α「绕过构造面」

- 审查轮次：Phase A（FR-052 / FR-053 / FR-068 / FR-017 / FR-016）
- 审查员：独立子代理 α（Codex 配额耗尽期替代档位）
- 立场：默认代码有洞，任务是**证伪**
- 工作目录：`.claude/worktrees/vigorous-mahavira-7de572`

## 审查对象清单

| # | 路径 | 关注点 |
|---|------|--------|
| 1 | `plugins/spec-driver/contracts/orchestration-schema.mjs` | 禁改集甲/乙 + diagnostic 级别 |
| 2 | `plugins/spec-driver/lib/orchestration-resolver.mjs` | `validateGateMounting(merged, base)` 丙 |
| 3 | `plugins/spec-driver/lib/orchestrator.mjs` | `buildGateMountingMap()` |
| 4 | `plugins/spec-driver/scripts/orchestrator-cli.mjs` | `cmdGetGateBehavior` 两字段 |
| 5 | `plugins/spec-driver/scripts/validate-gate-mounting.mjs` | FR-053 12 条断言 |
| 6 | `scripts/lib/agent-tools-core.mjs` | FR-017 8 条断言 |
| 7 | `scripts/lib/repo-maintenance-core.mjs` | 两族接线 |
| 8 | `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md` + 5 份 SKILL.md | FR-068 运行时守卫散文 |

## CRITICAL

### **[α-C1]** 挂载判据是纯结构判据，被 `conditional` 恒假的「幽灵门位」整类绕过（三处守护同时失明）

**构造**（scratch 项目根，不碰工作区）：
以 `modes.feature` 整段替换，把 17 个 phase 里**全部** `gates_before` / `gates_after` 中的
`GATE_DESIGN` / `GATE_TASKS` 摘掉，再在序列**最前**插一个 phase：

```yaml
- id: "0.01"
  name: "ghost_gate"
  agent: null
  agent_mode: "gate"
  gates_before: null
  gates_after: ["GATE_DESIGN", "GATE_TASKS"]
  conditional: "never_true_flag == true"   # 上下文里没有该变量 ⇒ 恒假
  skip_if_exists: null
  is_critical: false
```

复现命令（生成器 `scratchpad/mkover.mjs`，mutator `conditionalFalse`）：

```bash
node "$SCR/mkover.mjs" "$SCR/v_conditionalFalse" feature conditionalFalse
node plugins/spec-driver/scripts/orchestrator-cli.mjs get-gate-behavior feature GATE_DESIGN \
  --project-root "$SCR/v_conditionalFalse"
```

**实测输出**（原文）：

```
  "behavior": "always",
  "source": "hard_gate",
  "is_hard_gate": true,
  "mounted": true,
  "mounted_in_base": true
--- diagnostics ---
[{"level":"info","code":"orchestration-overrides.mode-overridden"}]
phases=18
```

FR-053 守护项同轮实测：

```
########## validate-gate-mounting on v_conditionalFalse ##########
status = pass
errors = []
failed = []
total = 12
```

恒假性实证：

```
$ node -e "... evaluateCondition('never_true_flag == true', {})"
never_true_flag == true => false
```

**命中位置**：

- `plugins/spec-driver/contracts/orchestration-schema.mjs:231-239`

  ```js
  export function isGateMountedInMode(config, mode, gateId) {
    const phases = config?.modes?.[mode]?.phases;
    if (!Array.isArray(phases)) return false;
    return phases.some((phase) => {
      const before = Array.isArray(phase?.gates_before) ? phase.gates_before : [];
      const after = Array.isArray(phase?.gates_after) ? phase.gates_after : [];
      return before.includes(gateId) || after.includes(gateId);
    });
  }
  ```

  判据只看「数组里有没有这个字符串」，**完全不看这个 phase 会不会被执行**。

- `plugins/spec-driver/lib/orchestrator.mjs:229-230`（`shouldExecutePhase`）：

  ```js
  if (phase.conditional && !evaluateCondition(phase.conditional, context)) return false;
  ```

  phase 被 `conditional` 判假即整体不执行，其 `gates_after` 自然一次都不被求值。

- `plugins/spec-driver/lib/orchestrator.mjs:309-310`（`evaluateCondition`）：`variable == value` 分支
  对上下文中不存在的变量返回 `String(undefined) === 'true'` ⇒ `false`，恒假成立。

**后果**：本卡的三道防线**同时**判通过——

| 防线 | 判据 | 本构造下 |
|---|---|---|
| FR-052 丙（resolver `validateGateMounting`） | `mounted_in_base ⇒ mounted` | `true ⇒ true` ✅ 通过 |
| FR-068 运行时守卫（SKILL 散文） | 同上 + diagnostics 无 error | 无 error ✅ 通过 |
| FR-053 事后守护（`validate-gate-mounting.mjs`） | effective 侧至少一个 phase 挂载 | ghost phase 满足 ✅ `status = pass` |

即：**项目级 overrides 可以在三道门全绿的情况下，让 GATE_DESIGN / GATE_TASKS 在 feature
全流程中一次都不被求值**。这与被写进 fixture 注释的已知构造（删 phase）是同一个安全属性，
只是从「删掉挂载」换成「挂在一个不会跑的 phase 上」——绕过成本反而更低（不用删任何东西）。

**最小修补方向**：`isGateMountedInMode` 从「结构存在性」升为「可达性」——挂载 phase 必须
`conditional == null`（或至少：至少存在一个挂载该 gate 且 `conditional == null` 的 phase）。
理由与 F259 已登记的反模式同型：判据写成「引用存在」每加一种抑制机制就漏一次；应把判据
钉在「这道门在最坏上下文下仍会被求值」这个语义上。

---

### **[α-C2]** 同一判据被 `skip_if_exists` 恒真的幽灵门位绕过

**构造**：同 α-C1，但幽灵 phase 用 `skip_if_exists: "spec.md"` 代替 `conditional`
（mutator `skipIfExists`）。resume / 二次运行等场景下 `spec.md` 必然已存在。

**实测输出**：

```
  "mounted": true,
  "mounted_in_base": true
--- diagnostics ---
[{"level":"info","code":"orchestration-overrides.mode-overridden"}]
phases=18
########## validate-gate-mounting on v_skipIfExists ##########
status = pass
```

**命中位置**：`plugins/spec-driver/lib/orchestrator.mjs:231-237`

```js
if (phase.skip_if_exists && context.fileExists) {
  const fp = path.join(context.featureDir || '', phase.skip_if_exists);
  if (context.fileExists(fp)) { ...; return false; }
}
```

**后果**：与 α-C1 同级；抑制条件从「上下文变量」换成「制品已存在」，隐蔽性更高
（`spec.md` 存在是正常状态，审阅 YAML 的人不会觉得可疑）。

**最小修补方向**：同 α-C1，挂载 phase 须同时 `conditional == null && skip_if_exists == null`。

---

### **[α-C3]** 判据不含位序，门可被合法地「挂到流程末尾」而失去把关意义

**构造**：摘掉全部真实挂载，把两道门改挂到 `feature` **最后**一个 phase `7c verify`
的 `gates_after`（mutator `mountAtEnd`）。

**实测输出**：

```
  "mounted": true,
  "mounted_in_base": true
--- diagnostics ---
[{"level":"info","code":"orchestration-overrides.mode-overridden"}]
phases=17
########## validate-gate-mounting on v_mountAtEnd ##########
status = pass
```

**命中位置**：同 `orchestration-schema.mjs:231-239`（`phases.some(...)` 不带任何位序约束）。
base 的 `feature` 末 phase 实况：

```json
{ "id": "7c", "name": "verify", "gates_after": ["GATE_VERIFY"],
  "skip_if_exists": "verification/verification-report.md", "is_critical": true }
```

**后果**：`GATE_DESIGN` 的语义是「规范质量门禁——**通过后才能进 plan**」（base 中它同时
以 `3.5.gates_after` 与 `4.plan.gates_before` 挂载）。挂到末尾后 spec / plan / tasks /
implement 全部先跑完，门变成一次事后追认；且该 phase 自带 `skip_if_exists`，
制品存在时连这次追认都不发生（与 α-C2 叠加）。三道防线仍全绿。

**最小修补方向**：把挂载判据的「至少一个」收紧为「与 base 同集合或超集」——
即由「存在性」改为「base 的每个 (phase 语义位置, gate) 对在 effective 中仍存在」，
或至少断言 `GATE_DESIGN` 必须挂在**产出 plan 的 phase 之前**（gates_before 侧）。

## WARNING

### **[α-W1]** 禁改集甲 / 乙与 FR-053 (iii)(iv) 共 4 项守护，全部打在一个**本引擎不可达**的字段上

**构造**：在 scratch 项目根写一份**完全合法**（不触禁改集）的 overrides：

```yaml
version: "1.0"
gates:
  GATE_TASKS:
    default_behavior: on_failure   # 禁改集乙只禁 auto / skip，on_failure 合法
  GATE_DESIGN:
    severity: info                 # severity 不在禁改集内
```

**实测输出**：

```
feature GATE_DESIGN : behavior=always source=hard_gate severity=info is_hard=true mounted=true
feature GATE_TASKS  : behavior=always source=gate_policy severity=critical is_hard=false mounted=true
story   GATE_TASKS  : behavior=always source=gate_policy ...
implement GATE_TASKS: behavior=always source=gate_policy ...
--- effective 里的 default_behavior 实际值 ---
GATE_TASKS: {... "default_behavior":"on_failure" ...}
diagnostics: []
```

即 `default_behavior` 改成 `on_failure` 后，**实际消费的 `behavior` 一个字节都没变**（仍 `always`）。

**命中位置**：`plugins/spec-driver/lib/orchestrator.mjs:134-141`

```js
const policyDefault = getDefaultBehaviorForPolicy(policy, gateId);
if (policyDefault !== null) {
  behavior = policyDefault;
  source = 'gate_policy';
} else {
  behavior = gateDef.default_behavior || 'on_failure';   // ← 唯一消费 default_behavior 的行
  source = 'yaml_default';
}
```

与 `plugins/spec-driver/lib/orchestrator.mjs:325-333`：

```js
function getDefaultBehaviorForPolicy(policy, gateId) {
  if (policy === 'strict') return 'always';
  if (policy === 'autonomous') return 'on_failure';
  const balanced = {
    GATE_RESEARCH:'auto', GATE_DESIGN:'always', GATE_ANALYSIS:'on_failure',
    GATE_TASKS:'always', GATE_IMPLEMENT_MID:'on_failure', GATE_VERIFY:'always',
  };
  return balanced[gateId] || null;
}
```

**穷举证明**：`policy` 只有三种取值形态——`strict` / `autonomous` / 其余（含 `balanced`
与任何非法串）。前两种对**所有** gate 返回非 null；第三种查 `balanced` 表，而
`GATE_DESIGN` 与 `GATE_TASKS` **都在表内**、值非 null。故对这两个 gate，
`policyDefault !== null` 恒成立，`yaml_default` 分支**永不进入**，
`gateDef.default_behavior` 永不被读。全仓补充核对：除本行外，
`default_behavior` 在 `plugins/` / `scripts/` / `src/` 下**再无任何代码消费点**
（其余命中全是 YAML 数据、schema 定义、注释与文档）。

**后果**：

| 守护项 | 判的字段 | 引擎真正读的字段 |
|---|---|---|
| 禁改集甲（`GATE_DESIGN.default_behavior` 整体禁改） | `default_behavior` | 不读 |
| 禁改集乙（`GATE_TASKS.default_behavior` 禁 auto/skip） | `default_behavior` | 不读 |
| FR-053 (iii) `GATE_DESIGN.default_behavior ≠ skip` | `default_behavior` | 不读 |
| FR-053 (iv) `GATE_TASKS.default_behavior ∉ {auto,skip}` | `default_behavior` | 不读 |

四项守护同时守着一个死字段。真正决定暂停与否的是 `behavior`，它由
`hard_gate → user_config → gate_policy` 三层决定，**三层全部来自
`spec-driver.config.yaml`，不在本卡任何守护面内**（见 α-W3）。

这不构成「现在就能绕过」（因为该字段本来也影响不了行为），但它意味着
**SC 口径上「禁改集已封住 GATE_TASKS 被改成不暂停」这句话不成立**——
被封住的是一条本来就不通的路。

**最小修补方向**：把禁改集与 (iii)(iv) 的判定对象从 `effectiveConfig.gates.*.default_behavior`
换成 `get-gate-behavior` 输出的 `behavior`（外加 `source`），即判**引擎实际会用的那个值**；
或者反过来先修 `getDefaultBehaviorForPolicy` 的遮蔽语义，让 `default_behavior` 重新可达。
两条都要走 spec 修订，不能在本卡默默改。

---

### **[α-W2]** `extractFrontmatterTools` 的取值语义不是 YAML 语义，重复 `tools:` 键被静默接受 —— verify 冻结快照护栏可被诱饵行满足

**构造**（`agents/verify.md` 形态，先给一份与冻结快照同集的行内数组当诱饵，
再用块状序列把工具面扩到含 `Write` / `Edit`）：

```yaml
---
model: sonnet
tools: [Read, Bash, Grep, Glob, mcp__plugin_spectra_spectra__detect_changes, mcp__plugin_spectra_spectra__impact]
tools:
  - Read
  - Bash
  - Write
  - Edit
effort: medium
---
```

**实测输出**：

```
解析器看到 : ["Read","Bash","Grep","Glob","mcp__plugin_spectra_spectra__detect_changes","mcp__plugin_spectra_spectra__impact"]
verify:no-added-tools = pass | 相对冻结快照零新增
```

对 `specify.md` 的正向断言同理（诱饵在前、真实声明在后）：

```
specify 攻击体解析器看到 : ["Read","Write","Edit","Bash","Grep","Glob"]
（文件第二行 tools: [Read] 被完全忽略）
```

**命中位置**：`scripts/lib/namespace-consistency-core.mjs:27-51`

```js
const inlineMatch = fmText.match(/^tools:\s*\[([^\]]*)\]/m);
if (inlineMatch) { return ...; }               // 首个**行内**数组，无视文档顺序
const blockMatch = fmText.match(/^tools:\s*\n((?:[ \t]+-[ \t]+\S[^\n]*\n?)+)/m);
if (blockMatch) { return ...; }                // 否则首个块状序列
return [];
```

取值规则是「**行内优先，其次块状，各取第一个**」——这与任何一种 YAML 语义都不同：
符合规范的解析器对重复键要么报错，要么**取最后一个**。实测「块状在前、行内在后」
同样返回行内那份（`["Read"]`），证明它连文档顺序都不看。

**为什么定 WARNING 而不是 CRITICAL（诚实登记）**：绕过成立的另一半是「Claude Code /
Codex 侧的 agent frontmatter 解析器实际取哪一份」，本轮**没有取到该证据**——本仓
`node_modules` 内无 `js-yaml` / `yaml` 可作对照（实测两个 import 均
`ERR_MODULE_NOT_FOUND`），运行时解析器也不在本仓。已确证的部分是：
**守护项的读法必然与任一符合规范的解析器不一致**（后者要么报错要么末键胜出），
因此它对这类文档给出的 `pass` 不构成证据。

**最小修补方向**：`extractFrontmatterTools` 增加「frontmatter 内 `^tools:` 出现次数 > 1
即 throw / 判 fail」的 fail-loud 前置；这条同时惠及 `namespace-consistency` 族。
不要试图去「猜哪份才算数」——歧义文档应当直接判红。

---

### **[α-W3]** FR-068 判据完全不看 `behavior`；`spec-driver.config.yaml` 侧的关门路径无任何守护，且已在 Orchestrator 层就绪、只差一根线

**构造**（Orchestrator 层直接注入 userConfig，模拟「userConfig 接线修好之后」）：

```js
new Orchestrator({ gates: { GATE_TASKS: { pause: 'skip' } } }, mode, {logger})
new Orchestrator({ gates: { GATE_DESIGN: { pause: 'skip' } } }, mode, {logger})
new Orchestrator({ gate_policy: 'autonomous' }, mode, {logger})
```

**实测输出**：

```
gates.GATE_TASKS.pause=skip    feature    DESIGN=always/hard_gate  TASKS=skip/user_config
gates.GATE_TASKS.pause=skip    story      DESIGN=always/gate_policy  TASKS=skip/user_config
gates.GATE_TASKS.pause=skip    implement  DESIGN=always/gate_policy  TASKS=skip/user_config
gates.GATE_DESIGN.pause=skip   story      DESIGN=skip/user_config  TASKS=always/gate_policy
gates.GATE_DESIGN.pause=skip   implement  DESIGN=skip/user_config  TASKS=always/gate_policy
gate_policy=autonomous         story      DESIGN=on_failure/gate_policy  TASKS=on_failure/gate_policy
```

即：`spec-driver.config.yaml` 的 `gates.GATE_TASKS.pause: skip` 可在**三个强制 mode 全部**
把 GATE_TASKS 关成 `skip`；`gates.GATE_DESIGN.pause: skip` 可在 `story` / `implement`
（3 个强制 mode 中的 2 个）把 GATE_DESIGN 关成 `skip`——**恰好就是禁改集甲 / 乙点名要禁的两件事，
换一个文件即可完成**。

**当前是否已经可绕**：机械路径**当前不通**——`orchestrator-cli.mjs:74` 硬传 `{}`：

```js
const orch = new Orchestrator(
  {},                       // ← userConfig 恒空（M10 P1 已登记的「orchestrator-cli userConfig 恒空」）
  mode,
  { logger: silentLogger, ...extra },
  { preloadedConfig: resolverResult.mergedConfig },
);
```

所以今天 `get-gate-behavior` 报的 `behavior` 里，`user_config` 与用户设的 `gate_policy`
都不会出现。**但这条「安全」是另一个 bug 的副产物**：M10 P1 明确要修这个 bug，
修好之日就是禁改集被从旁路绕开之时，且三道防线届时**一条都不会响**——

- FR-052 丙 / FR-068 判据 1：只看 `mounted`，与 `behavior` 无关；
- FR-068 判据 2：`spec-driver.config.yaml` 不经 resolver，不产生任何 diagnostic；
- FR-053 (iii)(iv)：判 `default_behavior`（且该字段本身还不可达，见 α-W1）。

**散文侧的口径缺口**：`templates/orchestrator-gate-mounting-guard.md` 三条判据里
没有任何一条提到 `behavior` / `source`，而 `get-gate-behavior` 的输出里
`behavior` 就排在 `mounted` 前面四行。LLM 执行者最可能的走偏读法是
**「`behavior: skip` 但 `mounted: true` ⇒ 判据 1 通过 ⇒ 放行」**——散文没给它任何
反向指引；同时 5 份 SKILL 的「Gate 决策流程」分支（`skills/spec-driver-feature/SKILL.md:755-771`）
只写了 `always` / `auto` / `on_failure` 三支，**`skip` 落不到任何分支**，
`GATE_DECISION` 未赋值即进入下一步，行为未定义。

**最小修补方向**：在守卫散文加第 4 条判据——对 `g ∈ {GATE_DESIGN, GATE_TASKS}` 断言
`g.behavior !== 'skip'`（`GATE_DESIGN` 在强制 mode 上还应断言 `behavior === 'always'`），
并在 FR-053 断言集里增加同一条打在 `get-gate-behavior` 实际输出上的断言。
这条改动**必须与修 userConfig 接线同批或先于它**，否则接线一修就开了口子。

## INFO

- **[α-I1]** 禁改集命中即整份 overrides 作废：`orchestration-resolver.mjs:430`
  的 `return returnBase(true)` 会连带丢弃同文件里全部合法的 `modes.*` 覆盖。
  另实测把 `GATE_DESIGN.default_behavior` 覆盖成**与 base 完全相同的 `always`**
  也报 `error:orchestration-overrides.gate-field-forbidden`（整体禁改，不比值）。
  方向安全（回退 base），但属可用性锐边，值得在 contract 里写明。

- **[α-I2]** 守卫对自身输入 `$SD_MODE` 无校验。实测 `get-gate-behavior featur GATE_DESIGN`
  / `get-gate-behavior "" GATE_DESIGN` 均 `exit=0`、`success: true`、JSON 可解析、
  `mounted` 与 `mounted_in_base` 皆为 `false` ⇒ 判据 1 空洞成立、判据 3 **不触发**
  （命令没失败、输出不是不可解析、字段也不是取不到）。真正兜住的是第三条命令：
  `effective-orchestration featur` 实测 `exit=1` ⇒ 判据 3 触发 ⇒ BLOCKED。
  结论是**封住了，但靠的是第三条命令的副作用而非判据本身**；若将来有人把三条命令
  精简成两条（去掉 `effective-orchestration`），这条兜底随之消失。

- **[α-I3]** `generateFallbackConfig()` 的 `implement` 模式**不挂载 GATE_DESIGN**
  （实测 `implement DESIGN=false TASKS=true`，`fix` / `resume` 两个都不挂）。
  方向上这让 base 损坏时 FR-053 (i) 必红（正确的 fail-loud），
  但也意味着**兜底配置本身不满足 FR-053 要守的不变量**，值得在 spec 里登记一句。

- **[α-I4]** 两处事实源路径不同源：`repo:check` 侧
  `validate-gate-mounting.mjs:59` 显式传 `--project-root <repoRoot>`；
  而守卫散文给的三条命令**都不带 `--project-root`**，落到
  `orchestrator-cli.mjs:48-53` 的 `process.cwd()`。从子目录发起的编排运行与
  `repo:check` 读的可能是两份不同的 overrides 文件。
  （另：`.specify/orchestration-overrides.yaml` 实测**不在 `.gitignore` 内**
  ——`git check-ignore` exit=1——故它会进 review，这一点减轻了威胁面。）

- **[α-I5]** `orchestration-schema.mjs:495-507` 挂在 `gates` record 上的
  `superRefine` 在 resolver 路径上是**死代码**：步骤 6.5（`:420`）已先返回，
  永远走不到步骤 7 的 `orchestrationOverridesSchema.safeParse`。
  它只对直接调用该 schema 的消费方（当前只有单测）有效。不是缺陷，但
  「schema 层也拦了一道」这句话在生产路径上不成立，避免写进验收口径。

## 已确认封住的构造

逐条给命令与实测输出。scratch 项目根一律在
`…/scratchpad/<name>`，通过 `--project-root` 指向；工作区
`.specify/orchestration-overrides.yaml` 全程未创建（`ls .specify/` 实测无该文件）。

1. **整段替换删门（原 fixture 构造）**
   `cp tests/fixtures/orchestration/attack-feature-drops-gate-design.yaml → $SCR/a1/.specify/` →
   `get-gate-behavior feature GATE_DESIGN --project-root $SCR/a1`
   → stderr 出 `orchestration-overrides.gate-mounting-lost`，
   输出 `mounted: true / mounted_in_base: true`（已回退 base）。**封住**。

2. **变体：保留 phase、只摘 `gates_after` / `gates_before` 里的 `GATE_DESIGN`**
   （mutator `stripDesignRefs`）→ `diagnostics=[{"level":"error","code":"orchestration-overrides.gate-mounting-lost"}]`，
   `phases=17`（base 值，说明已回退）。**封住**。

3. **`story` / `implement` 上的同构造**（6 组实测）：

   ```
   [story / stripDesignRefs]     diagnostics=["error:orchestration-overrides.gate-mounting-lost"]  FR-053 status = fail
   [story / stripTasksRefs]      diagnostics=["error:orchestration-overrides.gate-mounting-lost"]  FR-053 status = fail
   [implement / stripDesignRefs] diagnostics=["error:orchestration-overrides.gate-mounting-lost"]  FR-053 status = fail
   [implement / stripTasksRefs]  diagnostics=["error:orchestration-overrides.gate-mounting-lost"]  FR-053 status = fail
   ```

   **封住**（同批的 `conditionalFalse` 两组 `status = pass`，见 α-C1）。

4. **禁改集甲的取值花样**——`hard_gate_modes: ["feature "]`（尾随空格）/ `["Feature"]`（大小写）/
   `[]`（空数组）/ `default_behavior: always`（与 base 同值），四组实测全部
   `diagnostics: ["error:orchestration-overrides.gate-field-forbidden"]`，
   effective 的 `GATE_DESIGN.hard_gate_modes` 保持 `["feature"]`。
   **封住**——因为甲是**整体禁改**（`forbiddenValues: null`），判定不看值，
   取值层面的花样结构性无效。

5. **gate 键名花样**——`gates.gate_design`（小写）/ `gates."GATE_DESIGN "`（尾随空格键），
   两组实测 `diagnostics: []` 且 `GATE_DESIGN.hard_gate_modes` 未变。
   **封住**：禁改集虽然认不出这些键，但 `mergeOrchestrationConfigs`
   （`orchestration-resolver.mjs:89-121`）只对 `base.gates` 里存在的 gate id 做合并，
   base 里没有的 gate id 被直接忽略（`// overrides 中仅有而 base 没有的 gate 忽略`），
   故这类键既进不了禁改集也改不动任何东西。

6. **base 被直接编辑掉挂载**（把 `plugins/spec-driver` 整树复制到 scratch、
   把 `config/orchestration.yaml` 的 264 / 276 两行 `- GATE_DESIGN` 改成 `- GATE_ANALYSIS`）：

   ```
   get-gate-behavior feature GATE_DESIGN → "mounted": false, "mounted_in_base": false
   effective-orchestration feature       → diagnostics = []
   validate-gate-mounting                → status = fail
     ERR: mounting:feature:GATE_DESIGN：effective 的 feature 至少有一个 phase 挂载 GATE_DESIGN
          —— feature 的 effective phase 序列中没有任何 phase 的 gates_before / gates_after 含 GATE_DESIGN
   ```

   **封住**——但只由 FR-053 承担：FR-068 判据 1 在此空洞成立、判据 2 无 error ⇒ 运行时守卫**放行**。
   这正是守卫散文「残余 2」如实登记的那条路径，实测与登记一致，**无 over-claim**。
   同时回答了任务清单第 3 条的疑问：(i) 打在 effective 上**确实**抓得住 base 直改
   （因为它是绝对存在性形式，不比 base）。

7. **缺 zod 环境**（`SPEC_DRIVER_FORCE_ZOD_MISSING=1`，对删门构造 `vA`）：

   ```
   diagnostics: ["warning:orchestration.zod-unavailable"]   feature phases: 17（base 值）
   get-gate-behavior → mounted: true, mounted_in_base: true
   validate-gate-mounting → status = pass
   ```

   **封住 / 无绕过**：缺 zod 时项目级 overrides **整体不被应用**
   （`orchestration-resolver.mjs:238-259`），攻击者的覆盖同样落不了地；
   守护项此时读的是 base，仍能抓 base 直改（第 6 条已证）。
   降级信号是 `warning` 而非 `error`，因此 FR-068 判据 2 不触发——方向正确，
   因为此时并没有任何未经校验的用户输入生效。

8. **K14「用基线里已有的 id 让新 check 零新增」**
   `tests/integration/spec-drift-repo-check-regression.test.ts:81-94`：
   (b) 对 `baseline.checks` 逐项断言 `byId.get(expected.id)` 必须 `toBeDefined()`
   ——即基线里**没有死 id**，每个都必须仍在当次输出中；
   (c) 断言 `duplicated` 为空数组。
   二者合起来封死该构造：新 check 若复用某基线 id，该 id 必然在当次结果中出现两次
   ⇒ (c) 红；若它复用的是一个「基线有、当次没有」的 id，则 (b) 早已因该 id 缺席而红。
   `aggregateValidation`（`repo-maintenance-core.mjs:177-187`）本身**不做去重**，
   去重责任全在测试侧——但责任是落到位的。**封住**。

9. **verify 冻结快照的顺序 / 空格 / 大小写变体**
   `agent-tools-core.mjs:154`：`added = verifyTools.filter(t => !SNAPSHOT.includes(t))`
   是**集合差**，重排不产生 `added` ⇒ 重排不误报（正确）；
   而 `"Edit "`（尾随空格，实测解析器保留空格：`["Edit ","Bash"]`）与 `edit`（小写）
   都会成为快照外的新项 ⇒ `added` 非空 ⇒ 判 fail。方向 fail-closed。**封住**。
   （残余：`removed` 刻意不判红，属文档化的设计选择，不是漏洞。）

10. **`$SD_MODE` 错拼 / 为空**：见 α-I2，最终 BLOCKED，**封住**（机理见该条）。

## 结论

- **CRITICAL 3 条**（α-C1 / α-C2 / α-C3）
- **WARNING 3 条**（α-W1 / α-W2 / α-W3）
- **INFO 5 条**（α-I1 ~ α-I5）
- **已确认封住 10 组构造**

**最重要的一条发现**：门挂载判据 `isGateMountedInMode`
（`contracts/orchestration-schema.mjs:231-239`）是**纯结构存在性判据**——只问
「某个 phase 的 `gates_before ∪ gates_after` 里有没有这个字符串」，不问那个 phase
会不会被执行。而同一份配置里就有两个现成的 phase 级抑制开关
（`conditional` 与 `skip_if_exists`，`orchestrator.mjs:229-237`）。
于是项目级 overrides 只需把两道门改挂到一个 `conditional` 恒假的幽灵 phase 上，
就能在 **FR-052 丙、FR-068 运行时守卫、FR-053 事后守护三道防线同时判绿**的情况下，
让 `GATE_DESIGN` / `GATE_TASKS` 在 `feature` / `story` / `implement` 全程一次都不被求值
（实测 `diagnostics=[{"level":"info",...}]`、`validate-gate-mounting status = pass`）。
这与本卡 fixture 已登记的「删掉挂门 phase」是同一个安全属性，绕过成本反而更低
——不用删任何东西，改一行 `conditional` 即可，而且改出来的 YAML 在人工 review 时
**看上去两道门都还挂着**。

**是否可进入提交（审查员意见）**：Phase A 对「删掉挂载」这一形态确实封住了
（10 组构造逐条实测），三处判据共用一张表、口径一致、残余登记诚实、
FR-045「判不出⇒判失败」在两个新族里都真实落地——工程质量是好的。
但**判据本身的抽象层次选错了**：它守的是「门的名字还在配置里」，
而需要守的是「门会被求值」。建议 α-C1 ~ α-C3 在本 Phase 内收口
（`isGateMountedInMode` 从存在性升为可达性，至少要求存在一个
`conditional == null && skip_if_exists == null` 的挂载 phase），
α-W3 至少先把 `behavior !== 'skip'` 加进守卫散文与 FR-053 断言集
（它与「修 userConfig 接线」有先后依赖，晚了就是开口子）。
α-W1 涉及 SC 口径修订，可另立卡但**不应在验收文本里保留
「禁改集已封住 GATE_TASKS 被改成不暂停」这一表述**。
