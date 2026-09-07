# 对抗审查 Phase A —— 第二轮修复 delta 复验

**角色**：对抗性审查员（commit ① 前最后一道）
**范围**：核验 β-C1 / β-C2 / δ-C1 / β-W2 / α-W2 三变体 的修复是否**实质**成立；只攻「修复新引入的内容」
**纪律**：只读 + 微探针（scratch 目录 + `--project-root`），不改任何仓内文件

---

## 复验表

| ID | 判定 | 依据 |
|----|------|------|
| β-C1 | **实质已修** | 见下 §β-C1 |
| β-C2 | **实质已修** | 见下 §β-C2 |
| δ-C1 | **仅措辞变动** | 见下 §δ-C1（S2 / S3 / F1 / F2 四份仍能跑通的构造） |
| β-W2 | **实质已修**（覆盖面口径有 over-claim，见 N-2） | 见下 §β-W2 |
| α-W2（三变体） | **实质已修** | 见下 §α-W2 |

---

## 逐条依据

### β-C1 —— 实质已修

**卡在哪一句**：`scripts/lib/namespace-consistency-core.mjs:151`（`if (!fmMatch) return null;`）、`:161`（无 `tools` 键 ⇒ `return null`）、`parseToolsBlockSequence` 的三处 `throw`（`:76` / `:83` / `:87` / `:99`），以及 `scripts/lib/agent-tools-core.mjs:109`
`const equal = tools.length === snapshot.length && tools.every((t, i) => t === snapshot[i]);`（单向集合差 ⇒ 逐字相等）。

**我自己重跑 β 报告全部 12 组构造 + α-W2 三变体**（探针 `scratchpad/r2/p_orig.mjs`，纯函数直调，未改仓内文件）：

```
构造                                   | 解析结果                                    | verify:tools-frozen
M1 删掉 tools: 键                       | null                                       | fail
M2 整个 frontmatter 删掉                 | null                                       | fail
M3 tools: []                           | []                                         | fail
M4 frontmatter 前多一个空行               | null                                       | fail
M4b BOM                                | null                                       | fail
M5 tools 写成 mapping                   | THROW（块序列中出现不可归类的行："  Read: true"） | THROW⇒族 catch fail
T1 块序列中间空序列项                      | THROW（块序列中出现不可归类的行："  -"）         | THROW⇒族 catch fail
T2 块序列中间注释行                        | THROW（被 "  # x" 截断后又出现序列项）          | THROW⇒族 catch fail
T3 块序列中间空行                          | THROW（被 "" 截断后又出现序列项）              | THROW⇒族 catch fail
T4 前 6 项=快照, gap(空行) 后 Write/Edit  | THROW                                      | THROW⇒族 catch fail
T5 前 6 项=快照, gap(注释) 后 Write/Edit  | THROW                                      | THROW⇒族 catch fail
```

12 组**无一 pass**。第二类（T1~T3、T4/T5）从「静默截断 + 集合差恒真」变成解析器 `throw`；第一类（M1~M4b）从 `[]` 变 `null`，两个消费方各自判 fail（`agent-tools-core.mjs:182` `!Array.isArray(verifyTools)` ⇒ fail；`namespace-consistency-core.mjs:296-306` `tools === null` ⇒ 就地 fail + `continue`，check id 集合不变形——实测 `namespace-consistency` 的 5 条 check id 数量不变）。

**两道闸各自独立承重（我另测）**：把 verify.md 的 `tools` 改成快照的**真子集**（V8 少一项）⇒ 逐字相等判 fail；改成**同集乱序**（V1）⇒ fail。即使解析器某天回退成静默截断，护栏侧仍拦得住「截断成真子集」，只有「截断后恰好等于快照」（T4/T5）需要解析器 fail-loud——两者互补，D-24 末段的结论我复核成立。

### α-W2（三变体）—— 实质已修

`TOOLS_KEY_DETECT_RE = /^[ \t]*(["\']?)tools\1[ \t]*:/`（`namespace-consistency-core.mjs:15`）把检测面放宽，取值仍只认 `TOOLS_KEY_CANONICAL_RE = /^tools:(.*)$/`（`:18`），不匹配即 `throw`：

```
b1  tools :（冒号前空格）+ Write/Edit   | THROW（键行不是规范的顶层 "tools:"："tools : ...）  | fail
b2  "tools":（双引号键）+ Write/Edit    | THROW（同上）                                    | fail
b2b 'tools':（单引号键）+ Write/Edit    | THROW（同上）                                    | fail
b3  tools: 后接行内注释再块序列          | THROW（键行取值既不是行内数组也不是空（块序列））      | fail
b1x 诱饵 tools: + tools :（两键）       | THROW（frontmatter 内 "tools" 键出现 2 次）      | fail
b4  第二个键缩进一格                     | THROW（同上，缩进键现在也被计数）                   | fail
```

δ 报告里的 b1 / b2 / b3 三份**全部转红**（b3 此前只被 `namespace-consistency` 的「必须含 mcp__ 工具」副作用兜底，现在由本判据直接判红）。b4（缩进嵌套键）从「计数为 1、静默」变成「计数为 2、throw」。

**残余边界我核对属实且已诚实写下**（`:129-136` 函数 doc）：显式键 `? tools` / 多文档流 / 锚点别名仍走 `null` ⇒ fail，方向安全但是「看不见⇒当作没写」的巧合。我另测 `P5b`（frontmatter 无 tools、正文有）⇒ `null` ⇒ fail，与该口径一致。

### β-C2 —— 实质已修

**卡在哪一句**：`plugins/spec-driver/contracts/orchestration-schema.mjs:208` 新增常量下界 `GATE_MOUNTING_MANDATORY_MODES = Object.freeze(['feature','story','implement'])`，`:220-230` 的 `resolveGateMountingEnforcedModes` **删掉了** `.filter(mode => baseModes[mode] !== undefined)`；`:483-486` 的 `undecidable` 支把「base 段整个读不出」按 `mountedInBase: true` 代入并记 `mandatory-mode-missing`；`lib/orchestration-resolver.mjs:626-641` 的步骤 1.5 发 `error:orchestration.mandatory-mode-missing`。

**我自己重跑 β 报告的 B6 / B7 / B8**（scratch 实验室 `scratchpad/r2lab`：`plugins/` 整树副本 + 空项目根 `r2lab/proj`；工作区未改动）：

```
########## A1（=β 的 B6）base 删 modes.implement 整段 ##########
  eff feature: diag=["error:orchestration.mandatory-mode-missing"]
  eff story:   diag=["error:orchestration.mandatory-mode-missing"]
  eff implement: exit=1
  gb implement GATE_DESIGN: mounted=false in_base=true viol=["mandatory-mode-missing"]
  gb implement GATE_TASKS : mounted=false in_base=true viol=["mandatory-mode-missing"]
  FR053 status = fail | passed 7 / 12
  FR053 failed = [mounting:implement:GATE_DESIGN, mounting:implement:GATE_TASKS,
                  diagnostics:feature, diagnostics:implement, diagnostics:story]

########## B8'（=β 的 B8）base 删 story + 合法 overrides 补回、零挂门 ##########
  eff feature: diag=["error:orchestration.mandatory-mode-missing",
                     "error:orchestration-overrides.gate-mounting-lost"]
  eff story: exit=1（覆盖已被拒、整份回退 base，而 base 里 story 已不存在）
  gb story GATE_DESIGN/GATE_TASKS: mounted=false in_base=true viol=["mandatory-mode-missing"]
  FR053 status = fail | passed 7 / 12
```

原构造的两个致命性质都被翻转：**断言条数恒为 12**（不再 12→9），**FR-068 判据 1 与判据 2 各自独立成立**（`mounted_in_base=true ∧ mounted=false` ⇒ BLOCKED；error diagnostics ⇒ BLOCKED）。任务点名的「两者同时触发时回退到什么」：回退到 **base**（`isFallback: true`），两条 error 并存于 diagnostics，`eff story` 因 base 无该 mode 而 `exit=1` —— 三条命令没有一条能给出「放行」的读数。

**射程下界的另外两种形态我也测了**（结论：不构成新洞）：

| 构造 | 结果 | 判定 |
|---|---|---|
| A2 base 的 `story` 段在但 `phases: []` | zod base 校验不过 ⇒ `error:orchestration.base-invalid` + fallback 桩；FR053 fail 8/12 | 封住（`phases` 有 min(1)） |
| A3 overrides 把 `story` 换成 `phases: []` | 合并结果校验失败 ⇒ `error:orchestration.base-invalid` + 回退 base；FR053 fail 9/12 | 封住 |
| A4 overrides 的 `story.phases` 非数组 | `warning:orchestration-overrides.schema-fallback` ⇒ 覆盖整份被拒、base 生效；FR053 **12/12 pass** | **正确的 pass**（覆盖没生效，什么都没丢） |

### δ-C1 —— 仅措辞变动

**原构造确实被封住了**（我自己跑两份新 fixture）：

```
attack-story-prepend-producers (story)     → diag=["error:orchestration-overrides.gate-mounting-lost"]
                                              isFallback=true，phases 回退成 base 的 5 个
                                              GATE_DESIGN 求值点 = ["specify.gates_after","plan.gates_before"]（恢复）
attack-implement-prepend-plan-early (impl) → 同型，isFallback=true
F3 新名字产出型 phase 占锚点**原索引**        → 同样 gate-mounting-lost（`f.index < candidateIndex` 成立）
F4 新名字产出型放在**两锚点之间**              → 同样 gate-mounting-lost（第二个锚点的 candidateIndex 更大）
```

**但 δ-C1 主张的那条安全属性没有改变**——「项目级 overrides 可让 `GATE_DESIGN` / `GATE_TASKS` 在 `story` 与 `implement` 全程一次都不被求值，而三道防线全绿」**仍然成立**，只是要换一扇门。判据 3b 的过滤器 `collectForeignProducers`（`orchestration-schema.mjs:386-397`）有三个逃逸口，每一个都能原样复现 δ-C1 的运行态结论。按 δ 报告自己对 α-W2 用过的同一把尺（字面构造被封、安全属性未变 ⇒ 仅措辞变动），本条判**仅措辞变动**。

**仍能跑通的构造（scratch 实验室 `scratchpad/r2lab`，工作区未改动）**

`base` 的 `story` 锚点实况（我复核）：`specify`(idx1, `gates_after: [GATE_DESIGN]`, `skip_if_exists: spec.md`)、`plan`(idx2, `gates_before: [GATE_DESIGN]` / `gates_after: [GATE_TASKS]`, `skip_if_exists: plan.md`)；`constitution`(idx0, `agent: null`) 是**唯一**排在锚点之前的 base 名字。

**S2 —— 复用 base 已有名字**（`collectForeignProducers:388` `if (name !== null && baseNameSet.has(name)) return;` ——**只看名字，不看 index、不看数量、不看 agent**）。overrides 里放**两个都叫 `constitution`** 的 phase，分别跑 `specify` / `plan`；四个锚点 phase **逐字照抄 base**：

```
########## S2 两个同名 constitution 分别产出 spec.md / plan.md ##########
  eff story: exit=0 diag=["info:orchestration-overrides.mode-overridden"]
             phases=6 names=["constitution","constitution","specify","plan"]
  gb story GATE_DESIGN: exit=0 mounted=true in_base=true viol=[]
  gb story GATE_TASKS : exit=0 mounted=true in_base=true viol=[]
  FR053 status = pass | passed 12 / 12
  ===== 运行态（Orchestrator 自己的 shouldExecutePhase 逐 phase 求值）=====
  RUN  0.1    constitution     gb=null ga=null
  RUN  0.2    constitution     gb=null ga=null
  SKIP 2      specify          gb=null ga=["GATE_DESIGN"]
  SKIP 3      plan             gb=["GATE_DESIGN"] ga=["GATE_TASKS"]
  RUN  4      implement / RUN  5      verify
  >> GATE_DESIGN 实际求值点 = []
  >> GATE_TASKS  实际求值点 = []
  isFallback = false          ← 覆盖真的生效了，不是被拒后回退
```

三道防线全绿、两道门零求值——与 δ 报告 §δ-C1 的 `storyPrependProducers` **逐位同型**。
`constitution` 在 base 里是 `agent: null` 的 inline 位；3a 不管它（它是锚点的**前驱**，`findOrderBreak` 只枚举 `baseAnchorIndex + 1` 起的后继）；3b 也不管它（名字在 base 里）。**两条子句的并集在「base 名字的前驱位」上有一个洞。**

**S3 —— `implement` 同法**（base 名 `clarify`(idx0) 的 `agent` 由 `clarify` 改成 `plan`，其余五个 phase 逐字照抄）：

```
  eff implement: diag=["info:orchestration-overrides.mode-overridden"] phases=6
  gb implement GATE_DESIGN: mounted=true in_base=true viol=[]
  FR053 status = pass | passed 12 / 12
  SKIP 2  plan  gb=["GATE_DESIGN"]
  >> GATE_DESIGN 实际求值点 = []
  >> GATE_TASKS  实际求值点 = ["analyze.gates_after"]
  isFallback = false
```

与 δ 报告 `implPrependPlanEarly` 的输出**逐字相同**（`GATE_DESIGN = []`、`GATE_TASKS = ["analyze.gates_after"]`）。

**F1 —— `agent: null` 逃逸口**（`isProducerPhase:371` `if (phase.agent === null || phase.agent === undefined) return false;`）。新名字、`agent_mode: inline`、用 `skip_if_exists` 声明自己产出 `spec.md` / `plan.md`：

```
  eff story: diag=["info:orchestration-overrides.mode-overridden"] phases=7
             names=["spec_early_inline","plan_early_inline","constitution","specify"]
  gb story GATE_DESIGN: mounted=true in_base=true viol=[]
  FR053 status = pass | passed 12 / 12
  >> GATE_DESIGN 实际求值点 = []   >> GATE_TASKS 实际求值点 = []   isFallback = false
```

该 phase 还**同时挂了 `GATE_VERIFY`**（任务点名的形态），一样不进 3b 的域。
判据写的理由是「`agent === null`（inline 步骤）……不产出制品」——这句被 **base 自己的配置证伪**：`feature` 的 `research_synthesis`(idx4) / `online_research`(idx5) 都是 `agent: null, agent_mode: inline` 且各自带 `skip_if_exists: research/*.md`，即 base 用 `skip_if_exists` 明确声明「这个 inline phase 会写出这个文件」。
（诚实边界：inline phase 实际写什么由 SKILL 散文驱动，我没有跑真编排器去证明它一定写出 `spec.md`；但配置层的判定确定被绕过，且判据所依赖的那条事实前提是假的。）

**F2 —— `agent_mode: 'gate'` 逃逸口**（`isProducerPhase:373` `return phase.agent_mode !== 'gate';`）。新名字、`agent: specify` / `agent: plan`（**非空**）、`agent_mode: gate`：

```
  eff story: diag=["info:orchestration-overrides.mode-overridden"] phases=7
             names=["spec_early_gate","plan_early_gate","constitution","specify"]
  gb story GATE_DESIGN: mounted=true in_base=true viol=[]
  FR053 status = pass | passed 12 / 12
  >> GATE_DESIGN 实际求值点 = []   >> GATE_TASKS 实际求值点 = []   isFallback = false
```

这是一个**谓词不对称**：schema 对 `(agent, agent_mode)` 没有任何交叉约束（`orchestration-schema.mjs:655-675`，`agent` 可为 null / string / string[]，`agent_mode` 是独立 enum），于是「是不是产出型」这个判断被交给**攻击者可写的 `agent_mode` 字段**，而真正决定跑不跑 agent 的是 `agent` 字段。守卫信 `agent_mode`，执行面读 `agent`。

**修补方向**（三处一起，缺一即留门）：
1. 3b 的域不能按「名字在不在 base 里」筛。改为**按位置与产出能力**筛：锚点之前的**每一个**产出型 phase，都必须在 base 里**同名且同样排在该锚点之前**（即把「foreign」从「名字未定义」改成「(名字, 相对锚点的位置) 这一对在 base 里不存在」）。S2/S3 的 `constitution`/`clarify` 在 base 里虽同名同位，但**`agent` 变了**——故还要加一条：同名 phase 的 `agent` / `agent_mode` 相对 base 不得改变（或至少「不得由非产出型变为产出型」）。
2. `isProducerPhase` 不能把 `agent === null` 当作「不产出」：base 自己的 inline phase 就带 `skip_if_exists`。改判据为「`agent` 非空 **或** `skip_if_exists` 非空」即算产出型（后半句直接对应「这个 phase 声称自己会写出那个文件」）。
3. `agent_mode === 'gate'` 的豁免必须附加 `agent === null` 才成立；或在 schema 层加交叉约束「`agent_mode: gate` ⇒ `agent` 必须为 null」，让守卫与执行面读同一个事实。

### β-W2 —— 实质已修

**卡在哪一句**：`scripts/sync-agent-docs.mjs:35`
`const matches = [...prelude.matchAll(/^SD_MODE=(\S*)\s*$/gm)];` + `:41` `const actual = matches[matches.length - 1][1];` + `:42` `if (actual !== expected)`，
挂载点在 `:120` `preludeGuard: checkSdModeDeclaration`（块 2 entry），求值点在 `:222-223`。

**任务点名的五种取值形态，我逐一重跑**（探针 `scratchpad/r2/p_sd.mjs`，纯函数直调，`targetRelPath` 固定为 `.../spec-driver-story/SKILL.md`，故期望值 = `story`）：

```
基线 SD_MODE=story                      -> PASS(null)
W1  SD_MODE="story"（引号）              -> FAIL「SD_MODE 声明为 ""story""，期望 "story"」
W2  SD_MODE=feature（错 mode，β-W2 原例） -> FAIL「SD_MODE 声明为 "feature"，期望 "story"」   ← 核心构造已封
W3  SD_MODE=story␠（尾空格）              -> PASS(null)（`\s*$` 吸掉尾随空白，正确）
W4  SD_MODE 放在 marker 内                -> FAIL「BEGIN marker 之前没有 SD_MODE=<mode> 声明行」
W5  两处取值不同（前 feature、后 story）    -> PASS(null)  ← 取**最近**的那个
W6  两处取值不同（前 story、后 feature）    -> FAIL「声明为 "feature"」  ← 同上，语义一致
W7  无 SD_MODE                          -> FAIL（缺席）
W8  SD_MODE=（空值）                      -> FAIL「声明为 ""」
W9  缩进的 SD_MODE=story                  -> FAIL（按缺席处理，`^` 不匹配缩进行）
W10 export SD_MODE=story                -> FAIL（同上）
W13 SD_MODE=story;SD_MODE=feature       -> FAIL「声明为 "story;SD_MODE=feature"」
```

W5 / W6 一对说明「取最近」这条语义是真的落地了（`matches[matches.length - 1]`），与守卫散文「由本块之外**紧邻上方**声明的一行给出」以及 shell 里「最后一次赋值生效」三者同向。W1 是**偏严的假红**（`SD_MODE="story"` 是合法 shell），方向安全，记 INFO。

**K14 精确数组确实不变**——我读了 `validateSharedAgentDocs`（`sync-agent-docs.mjs:207-256`）：`checks.push` 每个 section **只推一条** `shared-section:${section.key}`，`preludeGuard` 只参与 `targetResults[].status` 与 `errors`，不产生新 id。实跑本仓：

```
sectionConfigs 条数 = 13 | 带 preludeGuard 的 entry = [ 'orchestrator-gate-mounting-guard' ]
status = pass | checks = 13
check ids = [branch-sync-policy, mainline-focus, context-layering, release-contract,
             repo-maintenance, behavior-rules, code-quality, orchestration-overrides,
             eval-credentials-policy, dogfooding-policy, orchestrator-gate-mounting-guard,
             agent-output-discipline, gate-tasks-scope-cut-acceptance]   （均带 shared-section: 前缀）
errors = []
块2 targets = 5 份 skills/*/SKILL.md，全部 pass
```

`npx vitest run tests/integration/spec-drift-repo-check-regression.test.ts` → **2 passed**（K14 那条含 `expect(added).toEqual([...])` 的断言绿）；
`npx vitest run tests/unit/agent-docs-sd-mode-guard.test.ts` → **9 passed**。

---

## 修复新引入的缺陷

> 说明：本节只收「本轮修复新写的代码 / 新写的口径」带进来的问题。δ-C1 的四份仍能跑通构造（S2 / S3 / F1 / F2）不在此节——它们是**同一个洞没被这次修补覆盖到**，已在 §δ-C1 里按「仅措辞变动」登记，也是本轮唯一的**阻塞项**。

### CRITICAL

#### **[N-1]** 判据 3b 的「产出型」谓词把两个**攻击者可写字段**当作豁免依据，且「foreign」只按名字判——`isProducerPhase` / `collectForeignProducers` 的三个逃逸口各自都能原样复现 δ-C1

**命中位置**
- `plugins/spec-driver/contracts/orchestration-schema.mjs:388`
  `if (name !== null && baseNameSet.has(name)) return;`  ← 只看名字，不看 index / 数量 / agent
- 同文件 `:371` `if (phase.agent === null || phase.agent === undefined) return false;`
- 同文件 `:373` `return phase.agent_mode !== 'gate';`

**构造与输出**：见 §δ-C1 的 S2 / S3 / F1 / F2 四组，四组**全部**满足「三道防线全绿（`viol=[]` / `diag` 只有 info / FR053 12 12）+ `isFallback = false`（覆盖真的生效）+ 运行态 `GATE_DESIGN` 求值点 = `[]`」。

**为什么算「新引入」**：3b 是本轮新写的判据，它的**射程谓词**再次犯了本轮共同根因所反对的那件事——把「要不要检查这个 phase」交给**被检查的那份数据里攻击者可写的字段**（`name` / `agent` / `agent_mode`）。D-26 自己写明「不走『判据 2 升级为 skip_if_exists 不可被前驱满足』那条，是因为那要一张 `agent → 制品` 的映射表，而该表只能从被攻击的数据反推」——3b 换的这条路把依赖从「制品映射表」换成了「三个同样来自被攻击数据的字段」，并没有跳出那个反模式。

**判据所依赖的事实前提之一是假的**：`:367` / `:456` 两处写「`agent === null`（inline 步骤）……不产出制品」。base 自己的配置反证：`feature` 的 `research_synthesis`(idx 4) 与 `online_research`(idx 5) 都是 `agent: null, agent_mode: inline`，且各自带 `skip_if_exists: research/research-synthesis.md` / `research/online-research.md`——base 正是用 `skip_if_exists` 声明「这个 inline phase 会写出这个文件」。

**修补方向**：见 §δ-C1 末尾三条（域按「(名字, 相对锚点位置) 在 base 里存不存在」筛 + 同名 phase 的 `agent` / `agent_mode` 不得相对 base 变成产出型；`skip_if_exists` 非空即算产出型；`agent_mode: gate` 的豁免附加 `agent === null`，或在 schema 层加交叉约束让守卫与执行面读同一个事实）。

### WARNING

#### **[N-2]** D-27 声称「守 5 份源即覆盖 15 份副本，两批 codex 副本已由 `spec-driver-wrappers` 族按 body-sha256 比对」——实测该族**不比对副本自身的字节**，10 份 codex 副本的 `SD_MODE` 行仍然零守护

**命中位置**：`plugins/spec-driver/scripts/validate-wrapper-sources.mjs:110-127`

```js
const shaMatch = content.match(/^- Source SHA256:\s*([0-9a-f]{64})\s*$/m);
...
const actualSha = computeWrapperBodySha256(sourcePath);   // ← 哈希的是 source，不是 wrapper
if (actualSha !== shaMatch[1]) { shaMismatches.push(...) }
```

该族比对的是「**源** SKILL 的 body sha256」与「wrapper **文本里内嵌的那个 sha 字符串**」——它回答的是「源改了而 wrapper 没重生成吗」，**不**回答「wrapper 自身的字节被人改过吗」。改 wrapper 正文而不动那一行内嵌 sha，比对恒过。

**实测**（scratch 副本 `scratchpad/r2wrap`，`plugins/` + `.claude-plugin/` + `.claude/` + `.codex/` 拷贝；工作区未改动）：

```
--- 基线 ---                                   status = pass | errors = []
--- skills-codex/spec-driver-story 的 SD_MODE=story → feature ---   status = pass | errors = []
--- .codex/skills/spec-driver-story 的 SD_MODE=story → feature ---  status = pass | errors = []
```

`codex-plugin-consistency` 族我按源码核对（`scripts/lib/codex-plugin-consistency-core.mjs:230-250`）：只比对 **id 集合 / 数量 / manifest 引用**（`skill-count:*`、`canonical-vs-codex-gap:*`、`checkSkillsReference`），没有任何一处把副本内容与 canonical 内容做比较。

**后果**：`.codex/skills/spec-driver-story/SKILL.md` 正是 Codex 侧实际加载的那一份；它的 `SD_MODE` 被写成 `feature` 时，β-W2 描述的失效（守卫查错 mode、三条命令全 `exit=0`、恒绿）在 Codex 执行路径上原样成立，而新加的 `preludeGuard` 只挂在 `skills/` 的 5 份源上（`sync-agent-docs.mjs:121-128` 的 `targets` 数组）。

**处置建议**（二选一）：(a) 把 `preludeGuard` 的 targets 扩到 15 份（`skills-codex/` 5 份必扩；`.codex/skills/` 是 install-time 产物，可按 optional 处置，缺席不判红、在场即校验）；(b) 若维持只守 5 份，把 D-27 与 `sync-agent-docs.mjs:19-20` 那句「已由 `spec-driver-wrappers` 族比对」**删掉或改成诚实边界**，并在守卫散文残余里登记「codex 两批副本的 per-file 参数当前无守护」。本轮 D-28 的全部工作就是消除这类「把没成立的性质写成已成立」，这一处是同型漏网。

#### **[N-3]** `evaluateGateMountingAgainstBase` 的 `undecidable` 支只在 `baseAnchors.length === 0` 时才被求值——base 该 mode 段读不出、**而 effective 侧结构上恰好挂着**这道门时，答 `mounted: true` 且零违规

**命中位置**：`orchestration-schema.mjs:480-509`。`undecidable` 为真时返回 `mountedInBase: true`（FR-068 (3) 的从严代入，正确），但 `mounted` 取的是 `isGateMountedInMode(effectiveConfig, mode, gateId)`——**纯结构存在性**，即该文件 `:262-276` 自己用 ⚠️ 标注「不得再被任何一道防线单独当判据用」的那个函数。于是「base 段整个读不出 + overrides 把该 mode 补回来、门挂在一个 `conditional` 恒假的幽灵 phase 上」这一组合下，判据 1 的蕴含式 `mounted_in_base ⇒ mounted` 成立、`violations` 为空。

**为什么本轮仍不放行**：resolver 的步骤 1.5 会为「base 缺强制 mode」独立发一条 `error:orchestration.mandatory-mode-missing`（实测 A1 / B8' 均在），判据 2 与 FR-053 (v) 各接一次。即这条**目前由另一条闸门兜住**，不构成可达绕过——故记 WARNING 而不是 CRITICAL。

**风险形态**：与 β-W3 同型——「一整类失效只由一条闸门承担」。判据 1 在这一支上给出的 `mounted: true` 是**纯结构性**的，与它在 `mountedInBase` 正常支上的语义（可达性）不是同一个量；守卫散文判据 1 直接读 `mounted`，读者拿到的是一句肯定性结论。

**修补方向**：`undecidable` 支下 `mounted` 不应回落到结构存在性——要么恒 `false`（配 `mandatory-mode-missing` 违规，即现在 `mountedInEffective === false` 时的行为，把它推广到该支全部），要么在输出面并列一个 `mounted_is_structural_only: true` 标记，让判据 1 有据可依。

### INFO

- **I-1 · D-25 的红灯条数记错**。D-25 写「删 `implement` ⇒ **12 条，恰好 3 条红**」，我实测是 **12 条、5 条红**：多出 `diagnostics:feature` 与 `diagnostics:story`——步骤 1.5 的 `mandatory-mode-missing` 是**每次 resolve 都发**，不分 mode，故三条 `diagnostics:*` 会一起红。方向偏严，不是安全问题；但 D-25 是本卡的留痕依据，数字对不上会被后来者当基线引用。
- **I-2 · 解析器对 CRLF 行尾一律 `throw`**。`TOOLS_KEY_CANONICAL_RE = /^tools:(.*)$/` 的 `.` 匹配 `\r`，于是 `tools:\r` 的取值成了 `"\r"`，`.trim()` 后为空 → 走块序列；而 `tools: [...]\r` 的 `rest` 仍带 `\r`… 实测三种 CRLF 形态（块序列 / 行内数组 / 带 gap）**全部 THROW**：`键行不是规范的顶层 "tools:"："tools:\r"`。方向 fail-closed，但在 `core.autocrlf` 环境下检出即整族红，且报错文案指向「写法不受支持」而非「行尾」，排障会绕远。建议在 `extractFrontmatterTools` 入口先 `content.replace(/\r\n/g, '\n')`。
- **I-3 · `SD_MODE="story"`（引号）被判红**。合法 shell、语义正确，但 `\S*` 把引号一并吃进 `actual`。偏严的假红，不影响安全；若在意可把判据改为先剥一层配对引号。
- **I-4 · 逐字相等护栏对「YAML 语义等价的排版差异」正确地判 pass**：`tools: [Read,  Bash, ...]`（逗号后两个空格）、`[ Read , Bash, ...]`（项内前后空格）、`["Read", Bash, ...]`（项带引号）三者实测均 `pass`。这**不是**洞——判据的对象是解析后的工具项列表，而这三种写法在任何规范 YAML 解析器下都读出同一个列表。任务里「多一个空格应 fail」的预期与实现口径不同，实现口径是对的；文档里「逐字相等」指的是**列表元素逐项相等（含顺序）**，不是文件字节，`agent-tools-core.mjs:13 / :55-59` 的措辞与此一致。
- **I-5 · 冻结快照常量本身有守护**：`tests/unit/agent-tools-core.test.ts:275-285` 用字面量 `toEqual` 钉死 6 项 + `Object.isFrozen`。改常量即该用例红，`git diff` 之外还有一道机器闸门。
- **I-6 · `_runCli` 只在测试可达**：生产调用点 `scripts/lib/repo-maintenance-core.mjs:313` 是 `validateGateMounting({ projectRoot: resolvedRoot })`，不传该参数；全仓 `_runCli` 命中仅 `plugins/spec-driver/tests/validate-gate-mounting.test.mjs:205 / :410` 两处。
- **I-7 · overrides 里的 YAML 行内数组不被 `simple-yaml` 支持**：我第一版攻击 fixture 用 `gates_after: ["GATE_DESIGN"]` 被判 `字段 "modes.story.phases.1.gates_after"：类型错误，期望 array，实际为 string`（读成了字符串）。方向 fail-closed（覆盖整份被拒），但错误文案说「期望 array，实际为 string」而不说「本解析器只支持块序列」，写 overrides 的人会以为自己写错了类型。

---

## 结论

**复验计数**：实质已修 **4**（β-C1 / β-C2 / β-W2 / α-W2 三变体）/ 仅措辞变动 **1**（δ-C1）/ 未修 **0** —— 合计 **5** ✅

**新增 CRITICAL：1**（N-1，与 δ-C1 的「仅措辞变动」是同一条安全属性的两个记法：判据 3b 的产出型谓词有三个逃逸口，S2 / S3 / F1 / F2 四组构造在三道防线全绿的前提下把 `story` / `implement` 的门打到零求值）
**新增 WARNING：2**（N-2 codex 副本覆盖面 over-claim；N-3 `undecidable` 支的 `mounted` 回落到结构存在性，目前另有闸门兜住）
**新增 INFO：7**

**是否可进入提交（审查员意见）**：**不建议现在提交**，理由只有一条——**δ-C1 没有被实质关闭**。

三条 CRITICAL 里 β-C1 / β-C2 我复核为**实质已修**，两者的修法都跳出了根因（射程不再由被守护的数据决定：护栏钉死在 6 项快照上、强制 mode 钉死在常量下界上），我用原报告的全部构造重跑，无一能再跑通。β-W2 的窄断言也确实落地且没动 K14。

δ-C1 不同：新加的 3b 把「要不要检查这个 phase」换了一个来源，但**换到的还是被攻击的那份数据里攻击者可写的字段**。代价是这条修补只封住了「新名字 + 真 agent + 非 gate 模式」这一格，而复用一个 base 已有名字（S2 / S3）、或把 `agent` 写成 `null`（F1）、或把 `agent_mode` 写成 `gate`（F2），三条路各自都能把 δ 报告的运行态结论**逐字复现**——`GATE_DESIGN 实际求值点 = []`、`FR053 12 / 12 pass`、`isFallback = false`。S3 的输出与 δ 报告 `implPrependPlanEarly` 那一段**完全相同**。

这不是「残余可登记不修」的量级：本卡的交付物就是这三道门禁，而 §δ-C1 的口径修订（D-28 把残余 4 收窄为「只剩直接编辑 base 锚点」、守卫散文与合同丙条都写上了 3b）等于把一条**没成立**的性质写进了验收文本——这正是本轮 D-28 想消除的那类 over-claim。按 D-28 自己的标准，要么把 3b 补到能覆盖这四组（修补方向见 §δ-C1 末，三条都不需要新的映射表、不涉架构改动），要么在合同 / 散文 / D-26 里把 3b 的射程诚实收窄为「只覆盖 base 未定义名字的、`agent` 非空的、非 gate 模式的产出型 phase」，并把 S2 / S3 / F1 / F2 作为登记残余写下来。

N-2 建议一并处理（成本：扩 `targets` 数组，或删一句话）。N-3 与 I-1 可登记不修，但 I-1 是留痕数字错，改一行即可。

**已封住的，我明确说封住**：β-C1 的 12 组 + α-W2 的 b1 / b2 / b3 + β-C2 的 B6 / B7 / B8 + δ-C1 的两份新 fixture 与我自己补的 F3（占锚点原索引）/ F4（放在两锚点之间）+ β-W2 的 W2 / W4 / W6 / W7 / W8 / W9 / W10 / W13 + 三个 mode 全失败与单 mode 失败的 CLI 取数形态 + `effectiveConfig: null` 的 12 条全红（β-W4 的注释自此为真）—— 以上逐条实跑，无一能再跑通。

---

## 附：本轮探针清单（全部在 scratch，工作区零改动）

| 探针 | 位置 | 用途 |
|---|---|---|
| `p_parse.mjs` | `scratchpad/r2/` | 解析器三分返回的 15 组新构造（流式跨行 / 标量 / 首行键 / CRLF / 正文 `tools:` / block scalar / 尾部 gap …） |
| `p_orig.mjs` | `scratchpad/r2/` | β 报告 12 组 + α-W2 三变体 + b1x / b2b / b4 原样重跑 |
| `p_guard.mjs` | `scratchpad/r2/` | 逐字相等护栏的 10 种 verify.md 变体（乱序 / 大小写 / 空格 / 引号 / 重复 / 增删） |
| `p_sd.mjs` | `scratchpad/r2/` | `checkSdModeDeclaration` 的 14 种 `SD_MODE` 形态 |
| `p_docs.mjs` | `scratchpad/r2/` | 本仓 `validateSharedAgentDocs` 的 13 条 check id 与 targets |
| `p_cli.mjs` | `scratchpad/r2/` | `tryRunCli` 全失败 / 单 mode 失败 / `effectiveConfig: null` 三种形态 |
| `r2lab/` | `scratchpad/` | `plugins/` 整树副本 + 空项目根；`probe3.sh`（三道防线）+ `runtime.mjs`（`shouldExecutePhase` 逐 phase 求值）+ `fr053.mjs` |
| `r2wrap/` | `scratchpad/` | codex 副本 `SD_MODE` 改坏后 `validateWrapperSources` 的实测读数 |

---

## 结论

**复验计数**：实质已修 **4**（β-C1 / β-C2 / β-W2 / α-W2 三变体）/ 仅措辞变动 **1**（δ-C1）/ 未修 **0** —— 合计 **5** ✅

**新增 CRITICAL：1**（N-1，与 δ-C1 的「仅措辞变动」是同一条安全属性的两个记法：判据 3b 的产出型谓词有三个逃逸口，S2 / S3 / F1 / F2 四组构造在三道防线全绿的前提下把 `story` / `implement` 的门打到零求值）
**新增 WARNING：2**（N-2 codex 副本覆盖面 over-claim；N-3 `undecidable` 支的 `mounted` 回落到结构存在性，目前另有闸门兜住）
**新增 INFO：7**

**是否可进入提交（审查员意见）**：**不建议现在提交**，理由只有一条——**δ-C1 没有被实质关闭**。

三条 CRITICAL 里 β-C1 / β-C2 我复核为**实质已修**，两者的修法都跳出了根因（射程不再由被守护的数据决定：护栏钉死在 6 项快照上、强制 mode 钉死在常量下界上），我用原报告的全部构造重跑，无一能再跑通。β-W2 的窄断言也确实落地且没动 K14。

δ-C1 不同：新加的 3b 把「要不要检查这个 phase」换了一个来源，但**换到的还是被攻击的那份数据里攻击者可写的字段**。代价是这条修补只封住了「新名字 + 真 agent + 非 gate 模式」这一格，而复用一个 base 已有名字（S2 / S3）、或把 `agent` 写成 `null`（F1）、或把 `agent_mode` 写成 `gate`（F2），三条路各自都能把 δ 报告的运行态结论**逐字复现**——`GATE_DESIGN 实际求值点 = []`、`FR053 12 / 12 pass`、`isFallback = false`。S3 的输出与 δ 报告 `implPrependPlanEarly` 那一段**完全相同**。

这不是「残余可登记不修」的量级：本卡的交付物就是这三道门禁，而 §δ-C1 的口径修订（D-28 把残余 4 收窄为「只剩直接编辑 base 锚点」、守卫散文与合同丙条都写上了 3b）等于把一条**没成立**的性质写进了验收文本——这正是本轮 D-28 想消除的那类 over-claim。按 D-28 自己的标准，要么把 3b 补到能覆盖这四组（修补方向见 §δ-C1 末，三条都不需要新的映射表、不涉架构改动），要么在合同 / 散文 / D-26 里把 3b 的射程诚实收窄为「只覆盖 base 未定义名字的、`agent` 非空的、非 gate 模式的产出型 phase」，并把 S2 / S3 / F1 / F2 作为登记残余写下来。

N-2 建议一并处理（成本：扩 `targets` 数组，或删一句话）。N-3 与 I-1 可登记不修，但 I-1 是留痕数字错，改一行即可。

**已封住的，我明确说封住**：β-C1 的 12 组 + α-W2 的 b1 / b2 / b3 + β-C2 的 B6 / B7 / B8 + δ-C1 的两份新 fixture 与我自己补的 F3（占锚点原索引）/ F4（放在两锚点之间）+ β-W2 的 W2 / W4 / W6 / W7 / W8 / W9 / W10 / W13 + 三个 mode 全失败与单 mode 失败的 CLI 取数形态 + `effectiveConfig: null` 的 12 条全红（β-W4 的注释自此为真）—— 以上逐条实跑，无一能再跑通。

---

## 附：本轮探针清单（全部在 scratch，工作区零改动）

| 探针 | 位置 | 用途 |
|---|---|---|
| `p_parse.mjs` | `scratchpad/r2/` | 解析器三分返回的 15 组新构造（流式跨行 / 标量 / 首行键 / CRLF / 正文 `tools:` / block scalar / 尾部 gap …） |
| `p_orig.mjs` | `scratchpad/r2/` | β 报告 12 组 + α-W2 三变体 + b1x / b2b / b4 原样重跑 |
| `p_guard.mjs` | `scratchpad/r2/` | 逐字相等护栏的 10 种 verify.md 变体（乱序 / 大小写 / 空格 / 引号 / 重复 / 增删） |
| `p_sd.mjs` | `scratchpad/r2/` | `checkSdModeDeclaration` 的 14 种 `SD_MODE` 形态 |
| `p_docs.mjs` | `scratchpad/r2/` | 本仓 `validateSharedAgentDocs` 的 13 条 check id 与 targets |
| `p_cli.mjs` | `scratchpad/r2/` | `tryRunCli` 全失败 / 单 mode 失败 / `effectiveConfig: null` 三种形态 |
| `r2lab/` | `scratchpad/` | `plugins/` 整树副本 + 空项目根；`probe3.sh`（三道防线）+ `runtime.mjs`（`shouldExecutePhase` 逐 phase 求值）+ `fr053.mjs` |
| `r2wrap/` | `scratchpad/` | codex 副本 `SD_MODE` 改坏后 `validateWrapperSources` 的实测读数 |
