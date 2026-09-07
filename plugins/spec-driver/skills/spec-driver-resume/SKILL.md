---
name: spec-driver-resume
description: "恢复中断的 Spec-driver 研发流程 — 扫描已有制品并从断点继续编排"
disable-model-invocation: false
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]
# 编排器=opus：resume 是所有中断流程的唯一恢复入口，承接 fix/story/feature/implement 的子代理委派链。
# F176 实测：sonnet 编排器会无视"委派硬约束"（MUST 委派仍 inline 化，0 Task），opus 元指令服从性是
# 委派契约在恢复路径成立的前提；阶段子代理模型仍由 config.agents.* 控制，不受此行影响。
model: opus
effort: medium
---

# Spec Driver — 中断恢复

你是 **Spec Driver** 的恢复编排器。你的职责是扫描已有的特性制品文件，确定中断点，并从断点继续执行后续编排阶段。

## 触发方式

```text
/spec-driver:spec-driver-resume
/spec-driver:spec-driver-resume --preset <balanced|quality-first|cost-efficient>
```

**说明**: 此命令无需需求描述参数，自动扫描当前特性目录的已有制品。不接受 `--rerun` 和 `--sync` 参数。如需选择性重跑某个阶段，请使用 `/spec-driver:spec-driver-feature --rerun <phase>`。

**边界**:

- `resume` 用于“中断流程恢复”
- `implement` 用于“成熟 `spec.md + plan.md` 的聚焦实施”
- 如果目录已具备成熟 `spec/plan` 且用户目标明确为直接实施，可建议切换到 `/spec-driver:spec-driver-implement`，但不得隐式替换入口

---

## 初始化阶段

在进入恢复流程之前，执行以下精简初始化（5 步）：

### 0. 插件路径发现

在执行任何脚本或读取插件文件前，确定插件根目录：

```bash
if [ -f .specify/.spec-driver-path ]; then
  PLUGIN_DIR=$(cat .specify/.spec-driver-path)
else
  PLUGIN_DIR="plugins/spec-driver"
fi
```

后续所有 `$PLUGIN_DIR/` 引用均通过上述路径发现机制解析。

### 1. 项目环境检查

运行 `bash "$PLUGIN_DIR/scripts/init-project.sh" --json`，解析 JSON 输出获取：`NEEDS_CONSTITUTION`（是否需要创建项目宪法）、`NEEDS_CONFIG`（是否需要创建配置文件）、`HAS_SPEC_DRIVER_SKILLS`（是否存在已有 spec-driver skills）、`SKILL_MAP`（已有 skill 列表）。

### 2. Constitution 处理

如果 `NEEDS_CONSTITUTION = true`：暂停，提示用户先运行项目宪法入口创建项目宪法（Claude: `/spec-driver:spec-driver-constitution`；Codex: `$spec-driver-constitution`）。如果 constitution 存在：继续。

### 3. 配置加载

- 如果 `NEEDS_CONFIG = true`：交互式引导用户选择预设（balanced/quality-first/cost-efficient），从 `$PLUGIN_DIR/templates/spec-driver.config-template.yaml` 复制模板到项目根目录，应用选择的预设
- 如果配置已存在：读取并解析 spec-driver.config.yaml
- 如果 `--preset` 参数存在：临时覆盖预设
- 解析 `model_compat` 和 `codex_thinking` 配置（可选）；缺失时使用 run 模式定义的默认跨运行时映射与思考等级映射

### 3.5 门禁挂载守卫

以下区块由 `npm run docs:sync:agents` 从 `plugins/spec-driver/templates/orchestrator-gate-mounting-guard.md` 同步，请勿手动编辑区块内容。

```bash
SD_MODE=resume
```

<!-- BEGIN SHARED SECTION: orchestrator-gate-mounting-guard -->
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
<!-- END SHARED SECTION: orchestrator-gate-mounting-guard -->

### 4. 项目上下文注入（project-context，可选）

运行统一 resolver：

```bash
node "$PLUGIN_DIR/scripts/resolve-project-context.mjs" --project-root . --json
```

解析输出 JSON，并设置：

- `project_context_block = result.projectContextBlock`
- `project_context_diagnostics = result.diagnostics`
- `project_context_reference_missing = result.referenceSummary.missing`

行为约束：

- `.specify/project-context.yaml` 是 canonical source
- `.specify/project-context.md` 仅作为 legacy fallback
- 若 `.yaml` 与 `.md` 并存，resolver 只读取 `.yaml`，并在 diagnostics 中返回迁移 warning
- 若 diagnostics 中包含 `[参考路径缺失]`，不中断流程，但必须在阶段总结与最终报告中列为风险项
- 若无 project-context 文件，resolver 返回 `projectContextBlock = "未配置"`

### 4.5 在线调研策略解析（project-context 扩展）

为降低“恢复执行时越过在线调研证据门禁”的风险，从 resolver 输出读取：

- `online_research_required = result.onlineResearch.required`
- `online_research_min_points = result.onlineResearch.minPoints`
- `online_research_max_points = result.onlineResearch.maxPoints`
- `online_research_preferred_tools = result.onlineResearch.preferredTools`

### 5. Prompt 来源映射

```text
对于 phase ∈ [specify, clarify, checklist, plan, tasks, analyze, implement]:
  prompt_source[phase] = "$PLUGIN_DIR/agents/{phase}.md"

# 以下阶段始终使用 Plugin 内置版本：
prompt_source[constitution] = "$PLUGIN_DIR/agents/constitution.md"
prompt_source[product-research] = "$PLUGIN_DIR/agents/product-research.md"
prompt_source[tech-research] = "$PLUGIN_DIR/agents/tech-research.md"
prompt_source[verify] = "$PLUGIN_DIR/agents/verify.md"
```

**注意**: resume 不执行"特性目录准备"步骤，因为目录已存在是恢复的前提条件。

---

## 无可恢复制品检查

在执行恢复扫描之前，检查是否存在可恢复的特性目录：

```text
if 当前项目 specs/ 下无任何特性目录（NNN-xxx 格式）:
  输出错误提示:
  """
  [错误] 未找到可恢复的特性目录。

  恢复命令需要一个已有的特性目录（specs/NNN-xxx/），其中包含至少一个编排制品文件。

  建议：
  - 使用 /spec-driver:spec-driver-feature <需求描述> 启动新的研发流程
  """
  终止流程

if 特性目录存在但无任何制品文件:
  输出错误提示:
  """
  [错误] 特性目录 {feature_dir} 中未找到任何编排制品。

  恢复需要至少一个已生成的制品文件（如 spec.md、plan.md 等）。

  建议：
  - 使用 /spec-driver:spec-driver-feature <需求描述> 启动新的研发流程
  """
  终止流程
```

若检测到目录已具备成熟 `spec.md + plan.md`，但用户目标明显是“直接实施而非恢复断点”，输出提示：

```text
[提示] 当前目录已具备成熟 spec/plan，更适合使用:
/spec-driver:spec-driver-implement {feature_dir}

resume 仍可继续使用，但其目标是从中断点恢复，而不是聚焦实施。
```

如果存在多个特性目录，提示用户选择要恢复的目录。

---

## 在线调研证据恢复检查（前置硬门禁）

在确定 `feature_dir` 后、恢复点判定前执行：

```text
if online_research_required:
  1. 检查 {feature_dir}/research/online-research.md 是否存在
  2. 若存在，解析 points_count / skip_reason：
     - points_count < online_research_min_points → BLOCKED
     - points_count > online_research_max_points → BLOCKED
     - points_count == 0 且 skip_reason 为空 → BLOCKED
  3. 若文件不存在或校验失败:
     - 记录 [恢复修正] online-research 缺失/无效
     - 强制恢复点不高于 Phase 1d（在线调研补充）
     - 不允许直接进入 Phase 2 及之后阶段
```

---

## 中断恢复机制

### 结构化断点恢复（优先路径）

如果 `{feature_dir}/execution-state.json` 存在，优先基于结构化断点精确恢复：

```text
1. 读取 execution-state.json，解析以下字段：
   - last_completed: 最后完成的 task ID
   - in_progress: 当前正在执行的 task ID（中断点）
   - discovered_issues: 执行过程中发现的问题列表
   - pending_decisions: 需要人工决策的待定项
   - modified_files: 已修改的文件路径列表

2. 精确恢复逻辑：
   - 从 in_progress 对应的 task 恢复执行
   - 读取 tasks.md 中该 task 及后续 task 的定义
   - 已完成的 task（last_completed 之前的）跳过，不重新执行
   - modified_files 用于验证已完成 task 的产物是否完好

3. 问题与决策处理：
   - discovered_issues 非空时，在恢复前展示给用户：
     """
     [恢复] 上次执行中发现以下问题:
     {issues 列表}
     是否已解决？(Y/n)
     """
   - pending_decisions 非空时，逐项请求用户决策后再继续

4. 输出恢复信息：
   [恢复] 基于 execution-state.json 精确恢复
   上次中断点: task {in_progress}（{task 描述}）
   已完成: {last_completed} 之前的 {N} 个 task
   待执行: {剩余 task 数} 个 task
   已修改文件: {modified_files 数量} 个
   {if discovered_issues: "未解决问题: {count} 个"}
   {if pending_decisions: "待定决策: {count} 个"}
```

### execution-state.json 格式规范

```json
{
  "version": "1.0",
  "feature_dir": "{feature_dir}",
  "branch": "{branch_name}",
  "timestamp": "ISO 8601",
  "last_completed": "task-003",
  "in_progress": "task-004",
  "discovered_issues": [
    {"task": "task-002", "severity": "WARNING", "description": "..."}
  ],
  "pending_decisions": [
    {"task": "task-004", "question": "...", "options": ["A", "B"]}
  ],
  "modified_files": [
    "src/foo.ts",
    "src/bar.ts"
  ]
}
```

### 制品文件回退恢复（无 execution-state.json 时）

如果 `execution-state.json` 不存在，回退到基于制品文件存在性的恢复逻辑：

<!-- Phase 编号参考 spec-driver-feature SKILL.md，如有变更需同步更新 -->
扫描 `{feature_dir}` 下的制品文件，从后向前确定恢复点：

```text
verification-report.md 存在    → 流程已完成
tasks.md + 代码变更存在        → 从 verify (Phase 7) 恢复
tasks.md 存在                  → 从 analyze (Phase 5.5) 恢复
plan.md 存在                   → 从 tasks (Phase 5) 恢复
spec.md 存在且有 Clarifications → 从 checklist (Phase 3.5) 恢复
spec.md 存在                   → 从 clarify (Phase 3) 恢复
research-synthesis.md 存在     → 从 specify (Phase 2) 恢复
online-research.md 缺失/无效且 online_research_required=true → 从在线调研补充（Phase 1d）恢复
product/tech-research.md 存在  → 从对应阶段恢复
无制品                         → 从头开始
```

输出恢复信息：

```text
[恢复] {execution-state.json 存在 ? "基于结构化断点精确恢复" : "基于制品文件推断恢复点"}
从 Phase {N} ({阶段名}) 继续...

已有制品:
  ✅ {已完成的制品列表}
  ⏳ {待生成的制品}
{if execution-state.json 不存在: "[提示] 未找到 execution-state.json，使用制品文件推断恢复点，精度较低"}
```

---

## 恢复后执行流程

<!-- BEGIN delegation-contract (generated from templates/delegation-contract.md; do not edit) -->
> **委派硬约束（不可豁免 · 由 `templates/delegation-contract.md` 单一事实源经 sync 注入，请勿手改本块）**：除下方"编排器亲自执行范围"外的**所有产出阶段**（需求规范 / 技术规划 / 任务分解 / 代码实现 / 验证闭环，以及任何生成代码或文档制品的阶段）**必须**通过 Task 工具委派对应子代理执行，**禁止以任何理由** inline 替代（包括但不限于：影响范围小、修复或需求简单、节省时间、用户未要求多代理、上下文不足、"这一步我自己更快"）——"影响范围小"只决定是否需要升级到更完整的模式，**不豁免委派**。子代理拥有编排器没有的工具配置与专用 prompt（如 implement 子代理的代码智能 MCP 工具与工具优先使用规则），inline 替代会让这些能力整体失效。
>
> **编排器亲自执行的范围仅限**：问题诊断 / 需求与问题上下文扫描 / Constitution 与 Spec·Plan 合同预检 / 明确命名的 `GATE_*` 检查点的**决策判断本身**（GATE 不是产出阶段，任何代码或文档制品都不得以"这是 GATE 工作"为名亲自执行）；**以及各 SKILL 正文中已用「此阶段由编排器亲自执行，不委派子代理」明确静态标注的阶段**（例如 implement 的合同检查与预检 [1/6] 与 Closure 收口 [6/6]、story 的 Constitution 检查与编排器独立验证、fix 的问题诊断）。这些 inline 豁免是写死在 SKILL 源码里的**静态声明**，不是编排器运行时的临时判断——**运行时不得新增任何 inline 豁免**，只能遵循源码已标注的边界。
>
> **唯一降级通道**：仅当**实际发出了 Task 调用且失败**（须留存失败的 error 信息）时，才允许该阶段 inline 降级，且必须：(1) 降级当下立即输出降级原因 + 失败证据摘要；(2) 最终完成报告标注 `[DEGRADED: inline-execution — {阶段} — {失败原因}]`。未实际尝试 Task 而直接 inline = 违反本约束，不存在其他豁免。
<!-- END delegation-contract -->

从恢复点继续执行后续阶段（读取已有制品，不重新生成）。恢复后的每个阶段按以下模式执行：(1) 输出进度提示 "[N/10] 正在执行 {阶段中文名}..." → (2) 读取子代理 prompt 文件 → (3) 构建上下文注入块 → (4) 通过 Task tool 委派子代理 → (5) 解析返回 → (6) 检查质量门 → (7) 输出完成摘要。

**上下文注入块模板**（追加到每个子代理 prompt 末尾）：

```markdown
---
## 运行时上下文（由主编排器注入）

**特性目录**: {feature_dir}
**特性分支**: {branch_name}
**前序制品**: {已完成阶段的制品路径列表}
**配置**: {相关配置片段}
**恢复模式**: 从 Phase {N} 恢复
**项目上下文**: {project_context_block}
---
```

各阶段的详细编排逻辑（子代理调用、质量门触发、完成报告）与 `/spec-driver:spec-driver-feature` 一致，请参考 run 技能的工作流定义。

恢复模式下同样必须执行 feature 模式定义的 `GATE_RESEARCH` 在线调研硬门禁，不得因“已有部分制品”跳过。

### GATE_TASKS 裁剪接受口径

以下区块由 `npm run docs:sync:agents` 从 `plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md` 注入，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: gate-tasks-scope-cut-acceptance -->
**`GATE_TASKS` 裁剪接受口径（由 `templates/gate-tasks-scope-cut-acceptance.md` 单一事实源经 `npm run docs:sync:agents` 注入，请勿手改本块）**

「已裁剪」不是无准入门槛的合法终态。标注为 `[必须]` 或 MUST 的项要裁剪，必须在 `GATE_TASKS` 这一道**既有**门上被**显式接受**；本块规定该门停下时展示什么、接受什么、以及门没停下时怎么判。**本块不新增任何门、不改 `gate_policy` 到 `behavior` 的映射、不改 `orchestration.yaml` 的 gate 定义。**

## 何时触发

**触发条件 = 本次 `plan.md` 的裁剪登记中，MUST / `[必须]` 项条数非空。**

判据**复用该门既有的 `on_failure` 语义、不新造判据**：`GATE_TASKS` 的既有口径是「检查任务分解是否有明显问题：有 → 停下；无 → 自动继续」。本块把「**MUST / `[必须]` 裁剪登记非空**」定义为该判据下的「有明显问题」之一。

**三条 policy 路径逐条列全（防某条路径静默放行）**：

| `gate_policy` | 该门解析出的 `behavior` | 本块的落点 |
|---|---|---|
| `strict` | `always` | 门无条件停下，接受动作在这一次**既有**的门内交互中完成 |
| `balanced` | `always` | 同上 |
| `autonomous` | `on_failure` | MUST 裁剪登记非空即命中上述既有判据，门**同样**停下并完成接受 |

**`autonomous` 一行与直觉相反，一律以实测映射为准**：它并不意味着「自动继续」，只意味着「有问题才停」，而 MUST 裁剪非空按本块定义就是「有问题」。

**`fix` 模式下本条结构性不可达**：`GATE_TASKS` 实际挂载 **7 ÷ 8** 个模式（`feature` / `story` / `implement` / `resume` / `sync` / `doc` / `refactor`），**`fix` 零挂载**（换算式 7 ÷ 8 = 87.5%，单位：模式）。`GATE_TASKS.applicable_modes` 虽含 8 个模式，**但那不是挂载证据**——配置健康 ≠ 执行在场。故 `fix` 下发生 MUST 裁剪时按下文「门不停时的判定」一律记「未接受」；确需在 `fix` 下裁剪 MUST 项的，**须改走带编号的移交卡**，**不得**为此在 `fix` 补挂新门。

## 展示什么与接受什么

**单列成组**：被裁剪的 MUST / `[必须]` 项必须**单独列成一组**呈现，**不得**与 `[可选]` 项的裁剪混在同一份清单里一并放行，也**不得**以「plan 里已写理由」替代本次的显式接受。

**每条必须展示的四项**（缺一即该条未被有效展示）：

1. 被裁剪的 FR 编号**与其强度标注**（`MUST` / `[必须]` / `[可选]`）；
2. 该 FR 的**原文**——**不是摘要、不是结论转述**。给用户看的裁剪清单不能比内部引用更松：内部引用历史内容尚且要求附原文片段，此处更不能只给一句概括；
3. 裁剪理由；
4. 接受该裁剪的 gate 时点。

**接受粒度按组规模分档，K 由 spec 钉死为 3**：

- 被裁剪的 MUST / `[必须]` 项 **≤ 3 条** ⇒ 可**整组接受**；
- **> 3 条** ⇒ **必须逐条接受**，不得整组放行。

换算式：整组接受的上限条数 = **3**（单位：FR 条）；判据为「被裁剪 MUST 项条数 ≤ 3」。**分档理由**：长清单是主路径而非边界情况，组规模无上界时用户只能整组批准或整组拒绝，而整组拒绝要退回 plan 重做、代价远高于批准，构成严格占优路径。

**逐条接受在同一次门内交互中以多选形式完成，不增加门停下的次数。** 逐条接受改变的是**同一次交互内的粒度**（一次多选 vs 一次是非），不是门停下的**次数**；实现上落成单次多选，**禁止**拆成 N 次分别停下。这是与「本次改动不得新增任何用户确认点、不得加重 GATE 交互负担」的相容口径。

**留痕**：接受结论须与上述四项同处记录，使「哪一条被裁、凭什么被接受、在哪个时点被接受」可逐条回溯。

**强度上限（不得被总括为「已解决」）**：K 以内的整组接受**仍然存在信息损失**——3 条 MUST 项一并放行时，用户对其中任一条的单独异议在产物上无法与「三条都同意」区分。本口径把无上界的长清单收敛为有上界的短清单，**没有**消除批量语义。凡把本块口径为「裁剪已逐条经用户确认」，在 ≤ 3 条的路径上即为 over-claim。

**累计上界**：全卡累计已接受裁剪达 **3 条**后，再出现任何一条 MUST 裁剪一律**不得**经本块接受，须改走带编号的移交卡——移交不走裁剪通道。

## 门不停时的判定

**该门的 `behavior` 被解析为 `auto` 或 `skip` 时，门不会停下。此时不得因「门没停」而视为已接受。**

已知路径两条：`user_config` 把该门的 `pause` 覆盖为 `auto`；或 `.specify/orchestration-overrides.yaml` 把该门的 `default_behavior` 覆盖为 `auto` / `skip`（四级优先级为 `user_config > hard_gate > gate_policy > yaml_default`）。

**处置（fail-loud，不静默接受）**：被裁剪的 MUST 项一律记「**未接受**」。该态按交付判定的合并律归入**不通过**侧，交付整体判**不通过**。产物中出现「未接受」而交付仍被口径为「通过 / 全部达成」的，判 over-claim。

**`fix` 的零挂载同此处置**：`fix` 下该门根本不在 phase 序列上，接受点结构性不可达 ⇒ MUST 裁剪**一律**记「未接受」，走同一条不通过判定。

**判不出时从严**：`behavior` 取不到、gate 查询失败、或裁剪登记本身读不出来时，一律按「未接受」处理，不得按「大概停过了」放行。

## 冻结值字段格式

本门同时是 `plan.md` 覆盖矩阵**冻结值**的取值时点。冻结值的**字段位**落在 `tasks.md` 的模板里，**格式定义在本块**——两处不得互相复制。

**计算**：冻结对象是 `plan.md` 的 `## FR → Phase 覆盖矩阵` 整节；先规范化（CRLF → LF、去行尾空白、折叠连续空行、去首尾空行），再取 sha256。

**字段位须记录的七项**：

| 字段 | 填写口径 |
|---|---|
| 冻结对象 | 被哈希的章节名与规范化规则 |
| 规范化 sha256 | 由**编排器**在本门时点计算并写入 |
| 表行数 | 附计数单位（如「以 `\| FR-0` 开头的表行」） |
| 冻结时点 | 日期 + 「本门用户授权后由编排器写入」 |
| commit sha | **可选**，与哈希**同处并列**；流程此时尚未 commit 时留空并写明留空 |
| 冻结后修订 | 矩阵正文禁无痕改写；如需修订，以带时间戳的追加记录置于矩阵章节**之外** |
| 复算命令 | **命令原文**原样写入，使任何人可独立复算 |

**编排器动作（四步，缺任一步即冻结值链断在编排器侧）**：

| # | 时点 | 动作 |
|---|------|------|
| 1 | 本门通过后（**立即**，不得延后到实现阶段） | 按上述规范化规则计算 `plan.md` `## FR → Phase 覆盖矩阵` 整节的 sha256 |
| 2 | 紧接第 1 步 | 把该哈希连同其余六项字段写入 `tasks.md` 的冻结字段位 |
| 3 | 写入后 | **本会话持有该哈希**（连同时点与表行数），直到本次流程结束 |
| 4 | 委派 verify 时 | 把持有的三项（哈希 + 时点 + 表行数）作为**冻结值注入块**写进 verify 的委派 prompt 显式清单 |

**第 3 / 4 步是整条链的承重段**：第 4 步缺席时，verify 拿不到 ① 注入值，按其判定态定义该项判「未执行（缺席）」并归入不通过侧；而第 3 步缺席时，编排器在 `GATE_VERIFY` 无持有值可比对，`held` 记 `absent`。**「委派 prompt 里没写冻结值」与「verify 自己声称三值一致」在产物上完全同形**——把第 4 步留在散文旁注而不进委派清单，等于没有这一步。

**注入**：冻结值由**编排器持有**并注入 verify 的运行时上下文，锚定介质是编排器发给 verify 的 prompt 文本。**磁盘上的 `tasks.md` 不是独立性依据**——持有 `Bash` 的一方可以连矩阵带哈希一并原地改写。

**判定权**：三值（编排器注入值 / `tasks.md` 制品读到的值 / 对当前 `plan.md` 矩阵的现算值）一律**只作参考**；判定权在编排器于 `GATE_VERIFY` 的**亲自重算**并与自己持有的注入值比对。注入值缺席即判「未执行（缺席）」，**不得**因另两值一致而判通过。

**取不到 commit sha 时的口径**：留空并写明留空，**禁止**用「最近一个含 tasks 制品的 commit」或「当前 `HEAD`」这类现推值顶替。
<!-- END SHARED SECTION: gate-tasks-scope-cut-acceptance -->

以下区块由 `npm run docs:sync:agents` 从 `plugins/spec-driver/templates/gate-verify-matrix-recompute.md` 注入，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: gate-verify-matrix-recompute -->
**`GATE_VERIFY` 矩阵冻结值重算（由 `templates/gate-verify-matrix-recompute.md` 单一事实源经 `npm run docs:sync:agents` 注入，请勿手改本块）**

冻结值链的**唯一外部锚**是编排器在 `GATE_VERIFY` 的**亲自重算**——verify 子代理持有 `Bash`，磁盘上的 `plan.md` 与 `tasks.md` 都在它的写面之内，同一次推理可连矩阵带哈希一并原地改写；它改不了的只有编排器发给它的 prompt 文本，以及编排器自己算出来的那个数。**本块把该重算写进编排器的可执行口径**：委派清单一项、门决策前置一步、日志行三个字段位。**本块不新增门、不新增任何需要用户拍板的中断点、不改 `gate_policy` 到 `behavior` 的映射、不改 `orchestration.yaml` 的 gate 定义**——它只规定这一道**既有**门在做决策之前必须先算什么、日志里必须留下什么。

## (a) verify 委派 prompt 的显式清单加一项

委派 verify 子代理时，prompt 的显式清单**必须包含**：

> **`GATE_TASKS` 冻结值注入块** —— 三项齐全：**规范化 sha256** + **冻结时点** + **表行数（含计数单位）**。

- 该注入块的产生者是编排器在 `GATE_TASKS` 通过后执行的四步动作（见共享块 `gate-tasks-scope-cut-acceptance.md` 的「冻结值字段格式」一节）。
- **不在清单里就等于没有**：委派拼装是逐项照抄清单的，写在别处的旁注不会被拼进去。清单缺该项时，verify 拿不到 ① 注入值，按其判定态定义该项判「**未执行（缺席）**」并归入不通过侧。
- **本会话无持有值时照样要写**：写「冻结值注入块：`absent`（原因：{本 mode 不挂 `GATE_TASKS` / `resume` 会话未取到冻结字段 sha / 其他}）」。**留空与写 `absent` 不等价**——前者与「忘了拼」同形。

## (b) `GATE_VERIFY` 决策的前置步骤（在取 `behavior` 之前先算）

**顺序固定：先重算、再取 `behavior`、最后决策。** 把重算放到决策之后，就只剩一个记录动作，无法影响结论。

**第 1 步 · 重算**（命令原文，逐字照抄，把 `<plan.md>` 换成本次 `plan.md` 的实际路径）：

```bash
python3 -c "import re,hashlib;t=open('<plan.md>',encoding='utf-8').read();s=re.search(r'(?ms)^## FR → Phase 覆盖矩阵\n(.*?)(?=^## )',t).group(1);n='\n'.join(l.rstrip() for l in s.replace('\r\n','\n').split('\n'));n=re.sub(r'\n{3,}','\n\n',n).strip('\n')+'\n';print(hashlib.sha256(n.encode()).hexdigest())"
```

该命令实现的规范化与冻结时点**同一套**：CRLF → LF、去行尾空白、折叠连续空行、去首尾空行后补一个换行，再取 sha256。**两处不得各写一套**——规范化规则不同则两个哈希必然不等，重算会恒报不一致。

**第 2 步 · 比对**：把第 1 步的输出与**本会话持有的 `GATE_TASKS` 注入值**比对，得出三个字段：

| 字段 | 取值 | 口径 |
|---|---|---|
| `recomputed` | `{sha8}` | 第 1 步输出的**前 8 位**；命令报错或章节取不到时记 `error` |
| `held` | `{sha8}` 或 `absent` | 本会话持有值的前 8 位；**无持有值记 `absent`** |
| `match` | `yes` / `no` / `absent` | 两值相等记 `yes`，不等记 `no`，**任一侧为 `absent` 或 `error` 记 `absent`** |

**`absent` 的三种合法来源（须在 `reason` 里写明是哪一种）**：

1. 本 mode 不挂 `GATE_TASKS`（如 `fix`），本会话从来没有过冻结值；
2. `resume` 会话取不到冻结字段的 commit sha（缺 sha，或 `git cat-file -e <sha>` 失败）；
3. 重算命令本身失败（`plan.md` 不存在、矩阵章节取不到、`python3` 不可用）。

**`match=absent` ⇒ 矩阵对账记「未执行（缺席）」**并归入合并律的不通过侧。**不得**因「本 mode 本来就没有冻结值」而把该项记为通过——「没有可比的」与「比过了且一致」是两件事，前者是缺席不是达标。

**第 3 步 · 取 `behavior` 并决策**（既有流程不变），随后按 (c) 输出日志行。

## (c) 日志行模板（扩三个字段位）

```text
[GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | merge={pass|fail} | recomputed={sha8|error} | held={sha8|absent} | match={yes|no|absent} | reason={理由}
```

- `merge` 取自 verify 返回摘要里的**合并律结论**（`pass` / `fail`）；返回摘要没有该结论时记 `fail` 并在 `reason` 写明「合并律结论缺席」——**缺结论按不通过处理**，与「判不出从严」同向。
- **三个新字段位不是可选装饰**：**没有字段位的要求等于没有要求**，日志行模板是编排器唯一会照抄的东西。缺字段位时，「算了并比对了」与「一步没做而 verify 自报三值一致」在日志上完全同形。
- `reason` 在 `match=no` 时**必须**写明差异：重算值、持有值、以及「矩阵在哪个阶段被改过」的判断。

## (d) 决策必须消费上面两个结论

**`merge=fail` 或 `match=no` ⇒ 不得 `AUTO_CONTINUE`。**

- 这一条**优先于 `behavior` 的 `auto`**：`behavior=auto` 只说明这道门在无异常时不停下，它**不构成**对「合并律判不通过」或「重算与持有值不一致」的放行依据。
- `match=absent` 时按上文归为「未执行（缺席）」⇒ 计入合并律不通过侧 ⇒ 由 `merge=fail` 承接，同样不得 `AUTO_CONTINUE`。
- **本条不改变门是否停下的 `behavior` 语义**：它改变的是**决策取值**——`decision` 不得取 `AUTO_CONTINUE`，转入该门既有的处置路径（展示制品与结论，等用户裁决）。**这是既有交互，不是新增的中断点。**

**为什么这一条必须写在编排器侧而不是 verify 侧**：verify 的判定态定义里已有「① 缺席 ⇒ 判『未执行（缺席）』」，那条 fail-loud 反过来给了 verify 一个**造假动机**——不自写 ①，本项就必红。三值全部由 verify 自读、自算、自报，人工在门内看到的是它自报的一致，没有任何独立读数可对。**编排器的重算是这条链上唯一一个不落在 verify 写面内的读数。**
<!-- END SHARED SECTION: gate-verify-matrix-recompute -->

### 运行事件记录（066）

恢复模式完成或暂停后，追加一条本地 run summary：

```bash
node "$PLUGIN_DIR/scripts/record-workflow-run.mjs" --project-root "{project_root}" \
  --workflow-id "spec-driver-resume" \
  --run-id "{branch_name}" \
  --result "{success|partial|paused|failed}" \
  --rerun \
  --artifact "{feature_dir}/spec.md"
```

如能确定恢复起点或卡点，补充 `--rerun-phase "{phase}"` 与 `--gate-pause`；不得记录完整 prompt 正文。

---

## 模型选择

从 spec-driver.config.yaml 读取模型配置：

```text
1. --preset 命令行参数（临时覆盖，最高优先级）
2. spec-driver.config.yaml 中的 agents.{agent_id}.model（仅当该子代理显式配置时生效）
3. 当前 preset 的默认配置
```

模型名在 Task 调度前按 run 模式的“运行时兼容归一化”执行一次转换：
- `model_compat.runtime` 决定按 `claude` 或 `codex` 映射（`auto` 为默认）
- Codex 下默认把 `opus/sonnet/haiku` 归一化到 `model_compat.defaults.codex`（或更细粒度的 `model_compat.aliases.codex`）配置的模型；未显式配置时由 Codex CLI 自身决定当前默认模型，并使用 `codex_thinking` 选择思考等级（`medium|high|xhigh`）
- 若映射后模型不可用，回退到 `model_compat.defaults.{runtime}` 并记录 `[模型回退]`

配置文件路径: `$PLUGIN_DIR/templates/spec-driver.config-template.yaml`（模板）或项目根目录 `spec-driver.config.yaml`（用户配置）。
