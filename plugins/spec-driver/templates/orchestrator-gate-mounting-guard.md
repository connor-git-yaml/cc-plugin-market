**门禁挂载运行时守卫（不可豁免 · 由 `templates/orchestrator-gate-mounting-guard.md` 单一事实源经 `npm run docs:sync:agents` 注入，请勿手改本块）**

**本块作用的模式**：由本块**之外**紧邻上方声明的一行 `SD_MODE=<mode>` 给出。本块只消费 `$SD_MODE`，不内嵌任何 mode 字面量、不内嵌 phase 序列、不内嵌 gate 策略——这样同一段话才能被 5 个编排器 SKILL 共用而不产生手写副本。

**执行时机**：紧接「门禁配置加载」查询到 gate 行为**之后**、进入**任何产出阶段之前**（`specify` / `plan` / `tasks` / `implement` / `verify` 一律不得先启动）。守卫未通过时不写入任何制品。

**取事实（三条命令原样跑，不得以推理或记忆替代实际输出）**：

```bash
# $SD_MODE 由本块之外的那一行给出
GATE_DESIGN_JSON=$(node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" get-gate-behavior "$SD_MODE" GATE_DESIGN)
GATE_TASKS_JSON=$(node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" get-gate-behavior "$SD_MODE" GATE_TASKS)
EFFECTIVE_JSON=$(node "$PLUGIN_DIR/scripts/orchestrator-cli.mjs" effective-orchestration "$SD_MODE" --format json)
```

**判据（对 `g ∈ {GATE_DESIGN, GATE_TASKS}` 各判一次，再加一次 diagnostics 判定）**：

1. **挂载蕴含式** —— 对每个 `g` 断言 **`g.mounted_in_base === true ⇒ g.mounted === true`**。两个字段由 `get-gate-behavior` 并列输出。蕴含式成立即通过，**不成立即 `BLOCKED`**。
   - **`mounted` 的语义（分两支，不得混读）**：`mounted_in_base === true` 时它是 **「与 base 锚定且可达」**——base 里每个挂载该 gate 的 `(phase 名, gates_before / gates_after 侧)` 锚点，在 effective 里须**同名同侧仍挂、无新增抑制条件（`conditional` / `skip_if_exists` 不得强于 base）、锚点自身身份未变、位序保持**，四条全满足才为 `true`。「身份未变」指锚点的 `agent` 与 base 逐字相等，`gates_after` 侧的锚点连 `agent_mode` 一并相等——`gates_after` 锚点的 phase 体在门求值**之前**跑，换掉它等于让门事后追认一段新的产出；`gates_before` 锚点的 phase 体在该门求值**之后**才跑，故该侧不钉 `agent_mode`。「位序保持」含两条子句：base 中位于锚点之后的 phase 仍在其后，**且锚点之前只能是 base 同段的子序列**（按 `(name, agent, agent_mode)` 三元组的多重集比对，可删、不可增、不可改）——锚点前多出任何一个会写出 `spec.md` / `plan.md` 的 phase，锚点一个字都不用改就能让它的 `skip_if_exists` 被提前满足，运行时整段被跳过。判据**不去判断某个 phase 是不是「产出型」**：那要读它自己的 `name` / `agent` / `agent_mode`，而这三个字段正由被守护的那份覆盖提供，据此分类等于让被检查方决定要不要检查自己（实测三个逃逸口各自都能把两道门打到零求值而三道防线全绿）。`mounted_in_base === false` 时它退化为**纯结构存在性**（「effective 里有没有哪个 phase 的 `gates_*` 数组含这个名字」），**那一支的 `true` 不构成「门在场且会被求值」的证据**，只用于诚实透出，不参与本判据（前件为假，蕴含式空洞成立）。
   - **`mounted_in_base` 的语义**：base 侧有没有这样的锚点。**例外**：强制模式（`feature` / `story` / `implement`）在 base 里**整段缺席**时，它按「判不出⇒从严」代入 `true`（见判据 3），而 `mounted` 恒为 `false` 并记 `mandatory-mode-missing`——锚点无从取得时「相对 base 失去了什么」判不出，不得用「effective 结构上挂没挂」这个另一个量来充数。
   - **它不是「门的名字还在配置里」**：只问结构存在性会被三类构造整类绕过——把门改挂到 `conditional` 恒假的 phase、改挂到 `skip_if_exists` 恒真的 phase、或改挂到序列末尾。三者都不删任何东西，改出来的 YAML 在人工复核时**看上去两道门都还挂着**，而执行上一次都不会被求值。
   - `mounted` 为 `false` 时，`get-gate-behavior` 的 **`mounting_violations`** 逐条给出是哪个锚点、以哪一种方式失效（`missing-anchor` / `suppressor-added` / `anchor-tuple-changed` / `order-broken` / `pre-anchor-phase-not-in-base` / `mandatory-mode-missing`），报出 `BLOCKED` 时须原样附上这份清单。
   - 该判据与「项目级 overrides 不得使本模式的 effective phase 序列**失去**任何可达的挂载」逐字同型（「失去」= 相对 base 的减少），因此在 base 本就不挂载该 gate 的模式上**不误伤**：前件为假时蕴含式成立，不产生假阻断。
   - 只查 `.specify/orchestration-overrides.yaml` 的 `gates:` 块**不足以**发现这类失效——把 `modes.<mode>` 整段替换、完全不碰 `gates:` 块，即可让门在执行上一次都不被求值，而 gate 字段本身照常完好。故本条必须打在 **effective phase 序列**上，不打在 overrides 文件文本上。
2. **diagnostics 无 `error`** —— `EFFECTIVE_JSON` 的 `diagnostics` 数组中不得有 `level === "error"` 的条目；有一条即 `BLOCKED`。base 配置损坏而走 fallback 时三处返回各自带一条 `error` 级 diagnostic，本条即是那条路径的闸门。
3. **判不出⇒从严** —— `mounted` / `mounted_in_base` 任一取不到、上述任一命令调用失败（非零退出码或输出不是可解析 JSON）、或 `diagnostics` 取不到时，**一律按 `BLOCKED` 处理**，不得按「大概没问题」放行。
   - **`mounted_in_base` 判不出时一律按 `true` 代入，绝不按 `false`**：按 `false` 会让蕴含式空洞成立、等价 fail-open，方向与本守卫相反。该情形同时命中本条而判 `BLOCKED`，两条口径同向、不冲突。

**`BLOCKED` 的语义（这一条不打折）**：`BLOCKED` = **拒绝启动本次运行**。必须做到：

- 立即停止，报出「哪个 mode、哪个 gate、缺哪一项」三要素，并附上取到的原始字段值与实际跑过的命令；
- **不得提供「批准继续」「忽略并继续」「确认后继续」之类的任何放行选项**——本守卫**不是**一个可由用户当场放行的检查点。把它实现成「先问用户是否忽略挂载缺失、答是就继续」即为**已违反本块**，也违反「本次改动不得新增任何需要用户拍板的中断点」这条约束；
- 不写入任何制品、不进入任何产出阶段；
- 唯一处置方向是**修好再重新启动**：定位到那条使挂载丢失的覆盖（通常在 `.specify/orchestration-overrides.yaml`）或那条 `error` 级 diagnostic，改掉之后重新发起本次运行。

**与提交 / CI 侧守护项的分工（两者缺一不可，不得互相顶替）**：

- 本块是**第一道闸**，判的是「**本次运行**」，在每次编排器启动时求值；
- `npm run repo:check` 的门挂载守护项是**事后**守护，判的是「**仓库状态**」，在提交 / CI 时求值。它对每个强制模式 × 每个 gate `g ∈ {GATE_DESIGN, GATE_TASKS}` 断言 **effective 侧至少有一个 `conditional` 为 `null` 的 phase 挂载 `g`**——刻意保持**绝对**形式，不改为本块的 base 锚定相对形式；并另行断言 `feature` 下 `GATE_DESIGN` 的 `is_hard_gate` 为 `true`、两个 gate 的 `default_behavior` 未被改成放行取值、以及每个强制模式的 diagnostics 无 `error` 级条目；
- **强制模式集的射程有常量下界**：`{feature, story, implement}` 钉在源码里，再并上 `GATE_DESIGN.hard_gate_modes` 的派生增量——**只扩不缩**。早前版本把整份清单交给被守护的那份配置去决定（按 `modes` 键过滤），于是从配置里删掉 `modes.implement` 整段会让断言数从 12 静默变成 9 并报 `pass`；配置整份取不到时同样掉到 9。射程必须由源码决定，不能由被检查的数据决定；配置里缺席的强制模式一律判 `fail`，断言**不会因此消失**；
- **为什么事后守护那条只收紧到 `conditional`、不一并要求 `skip_if_exists` 为 `null`**：base 自身的 `story` / `implement` 两个模式里，挂载 `GATE_DESIGN` 的 phase **全部**带 `skip_if_exists`（这是合法编排事实：制品已在盘时那段产出本就不跑）。一并要求会把未被改动的仓库判红。`skip_if_exists` 侧只能相对 base 收紧（「不得强于 base」），那由本块的判据 1 承担；
- **为什么缺一不可**：`.specify/orchestration-overrides.yaml` 是项目本地文件，`repo:check` 不保证在某次编排器运行之前跑过——只有事后守护项时，一次删掉挂门 phase 的运行可以从头跑到尾、事后才红；只有本块时，被直接改坏的 base 配置逃得掉（见下方残余 2）。

**五条残余（如实登记，不得口径为「已覆盖」）**：

1. **`refactor` 模式不在本块的消费方之列**：`skills/spec-driver-refactor/SKILL.md` 确有「门禁配置加载（通过编排器查询）」小节，但 `refactor` 不在本守卫点名的 5 个编排器 SKILL 内，也不在强制模式集 `{feature, story, implement}` 内，且 `GATE_DESIGN.applicable_modes` 实测不含它（属「门本身未挂载」这一类既有编排事实，本次改动不动它）。故它是**一个有「门禁配置加载」小节却不受本守卫覆盖的编排入口**。
2. **本判据对「base 配置被直接编辑掉挂载」是盲的**：那种情形下 `mounted_in_base` 会同步变假，蕴含式空洞成立，本块判通过。该路径**只**由上述 `repo:check` 侧的事后守护项承担（这正是它的挂载断言坚持绝对形式的原因），而那一条覆盖到的是「锚点被删掉」与「锚点被加上 `conditional`」两种形态，**不覆盖残余 4**。把本块口径成「挂载已被运行时机械封堵」即为 over-claim。
   - **一个曾经的缺口已闭合，不得再按旧口径读**：「把整个 `modes.<强制 mode>` 段从 base 删掉」这一形态早前**两道守护同时静默**（事后守护少转两圈、报 `pass`；本块的蕴含式因 `mounted_in_base` 变假而空洞成立）。现在它由两处接住：base 侧发 `error` 级 `orchestration.mandatory-mode-missing`（本块判据 2 接），且事后守护的射程有常量下界、该模式的三条断言判 `fail` 而不是消失。
3. **本块完全不看 `behavior`**：判据 1 / 2 / 3 里没有任何一条读 `get-gate-behavior` 输出的 `behavior` 与 `source`，而这两个字段才决定门被求值时会不会真的停下来等人。`behavior` 由 `hard_gate → user_config → gate_policy` 三层决定，三层的输入**全部来自 `spec-driver.config.yaml`**，该文件不经 overrides resolver、不产生任何 diagnostic，本块与 `repo:check` 侧守护项都够不着它。当前这条路机械上走不通（编排器 CLI 向 Orchestrator 硬传空 userConfig），但那是另一个已登记缺陷的副产物——**它被修好之日，就是这条旁路被打开之时**。读到 `behavior` 为放行取值而 `mounted` 为 `true` 时，判据 1 会通过；此时应报出该事实供人判断，不得据此得出「门在场且会停」的结论。
4. **本判据对「base 里的锚点被直接加上 `skip_if_exists`」是盲的**：判据 1 比的是 effective 相对 base 的偏离，base 自己被改则两侧同步变化、蕴含式空洞成立；而 `repo:check` 侧的绝对形式只收紧到 `conditional`（理由见上）。这条路径当前**两道守护都不覆盖**，只由 base 配置文件进入人工复核这一条承担。
   - **射程说明**：同一类失效的另一半——「不碰 base 锚点，改在 effective 序列里让锚点之前多跑一段」——**已被判据 1 的位序子句闭合**（记 `pre-anchor-phase-not-in-base`；同名副本、复用 base 名字换 `agent`、`agent: null` 的 inline 步骤、`agent_mode: gate` 但 `agent` 非空四种形态均在内），锚点自身被换成另一个 agent 则记 `anchor-tuple-changed`。残余 4 现在只剩「直接编辑 base 锚点」这一条；两者的 review 强度不同（overrides 文件与 base 文件的复核强度不同），不得因前者已闭合而推断后者也已覆盖。
5. **`get-gate-behavior` 的输出面不带降级标记**：base 配置缺席 / YAML 语法损坏 / 过不了 schema 三种形态下，引擎实际跑的是内置后备配置，而两条 `get-gate-behavior` 对这份后备配置**自锚定**，照答 `success: true` / `mounted: true` / `mounted_in_base: true` / `behavior: always`——它答的是「相对这份后备桩没丢挂载」，不是「相对真正的 base 没丢」。整个 base 损坏类**只由判据 2 一条闸门承担**，而判据 2 依赖第三条命令 `effective-orchestration` 的输出。**故上面三条命令不得精简为两条**：删掉第三条，这一整类失效会变成静默放行，而两条 `get-gate-behavior` 的输出面上看不出任何异样。（`$SD_MODE` 拼错时的兜底同样压在这条命令上。）
