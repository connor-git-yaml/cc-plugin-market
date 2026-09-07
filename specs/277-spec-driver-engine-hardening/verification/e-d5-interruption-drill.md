# T117 · D-5 中断幸存与按段续写演练（三段汇总）

> 本文件只做三段汇总与通过条件逐条复核。(a) 由 `repo:check` 的 `agent-tools:required` 守护项机器执行，本文件只跑该命令并把命令原文与原始输出写入，不由演示执行者自读自判；(b)(c) 的观察只能来自 `verification/d5-observations.md` 的已登记记录，禁止编造、禁止凑数、禁止四舍五入。

## 执行体与输入语料

| 段 | 执行体 | 输入语料 | 本条（T117）动作 |
|---|---|---|---|
| (a) 8 条 frontmatter / 协议文本断言 | `npm run repo:check` 的 `agent-tools:required` 守护项（实现 `scripts/lib/agent-tools-core.mjs`，入口 `scripts/repo-check.mjs`，`package.json:35` `"repo:check": "node scripts/repo-check.mjs"`） | `plugins/spec-driver/agents/{specify,plan,tasks,verify}.md` 的 frontmatter `tools`；`plugins/spec-driver/templates/agent-output-discipline.md`（146 行） | 只跑该命令并把命令原文与原始输出写入；**不自读自判** |
| (b)(c) ≥ 3 次独立观察 | T077 开启的观察窗口（`tasks.md:212`，状态 `- [x]`）→ 观察记录文件 `verification/d5-observations.md`（48 行） | 窗口内被派发的长文档子代理的真实产出（须满足三条观察纪律） | 只汇总已登记观察；**不补造观察** |

**窗口时点与当前时点（命令原文与原始输出）**：

```bash
sed -n '11p;13p' specs/277-spec-driver-engine-hardening/verification/d5-observations.md | cut -c1-160
git rev-parse HEAD
git log --oneline -3
```

```
| 开启时点 commit（`git rev-parse HEAD` 现取） | `e01611b266bd0bdb0df71757f51e1c8442679921` |
| 说明 | 本卡 Phase C 的改动此刻尚未 commit（编排器统一提交），故上表 sha 是**窗口开启当下的 HEAD**，即块 1 落盘前的最后一个 commit；块 1 的实际生效点是编排器的 commit ①。两者的差别须在 Phase E 汇总时如实写明，不得把窗口开启时点改写成事后的交付 sha。 |
d86fa332a15a1099d32c9057e6409352547c2fc0
d86fa332 feat(F277-P2): Phase B + D 落地 — verify 五态合并律 + GATE_TASKS 冻结值三值链 + 收敛循环/三纪律共享块 + ε/γ/delta 对抗修订
4255212c feat(F277): Spec Driver 引擎硬化 commit ① — Phase A 物理前置+门守护 / Phase C 输出纪律共享块 / 三轮对抗修订
26a3b15f docs+test(F276-C): Phase 4 审查修补 + 制品入库 — 8 轮对抗记录 / 移交包 / dogfooding 账本
```

按 `d5-observations.md:13` 的要求如实写明：窗口开启时点 = `e01611b2`（块 1 落盘前的最后一个 commit）；块 1（输出纪律共享块）的实际生效点 = 编排器 commit ① `4255212c`；本归档时点 HEAD = `d86fa332`（commit ②）。窗口开启时点**未被改写**为事后的交付 sha。

**观察记录现状（命令原文与原始输出）**：

```bash
sed -n '46,48p' specs/277-spec-driver-engine-hardening/verification/d5-observations.md
```

```
## 观察记录

**（待编排器填写；当前 0 条。）**
```

已登记观察 = **0** 条（单位：观察次）。

## 通过条件逐字复核

### 通过条件原文（tasks.md T117 逐字引用 spec）

`specs/277-spec-driver-engine-hardening/tasks.md:326`（T117）所引通过条件（逐字）：

> 「三段全部成立，**且（b）(c) 的 ≥ 3 次独立观察全部自发分节落盘**。换算式：自发分节落盘次数 ÷ 独立观察次数 = 3 ÷ 3 = 100%，单位：观察次；出现 1 次一次性长 Write 即判本演示未达成并**如实记录比例（如 2/3），不得四舍五入为通过**——N=1 区分不了「协议生效」与「这次子代理碰巧这么写」。（a）中任一断言 FAIL 时交付整体判不通过（FR-017；执行者为 `repo:check`，阻断经 FR-050 与 FR-059 合并律，不依赖 verify 自判）；（c）中已完成节字节发生变化即判定为「发生了整篇重写」，本演示不通过（FR-018）。」

(a) 的定义（`tasks.md:326`，逐字节录）：「**(a) 8 条 frontmatter / 协议文本断言**——**由 `repo:check` 的 `agent-tools:required` 守护项机器执行，本条只跑该命令并把命令原文与其原始输出写入产物，不由演示执行者自读自判**（该守护项同样产出于 implement，故 (a) 亦落入时序悖论）：`agents/{specify,plan,tasks}.md` 的 `tools` 各断言「含 `Edit`」与「含 `Bash`」（3 × 2 = **6** 条正向）+ `agents/verify.md` 的 `tools` **与钉入守护项源码的落地时快照逐字相等**（**1** 条护栏）+ 协议文本对 verify 标注「不适用」**且**该处附有 FR-016 (ii) 独立性口径声明（**1** 条文本断言，缺声明即 FAIL）= **8**（单位：断言条）；**不得再使用「断言 `verify` 的 `tools` 不含 `Write` / `Edit`」作为独立性证据**」。

(b)(c) 的定义（`tasks.md:326`，逐字节录）：「汇总 **T077** 在 Phase C 开启的观察窗口所积累的 **≥ 3 次独立观察**（不同文档、不同会话的真实长文档生成；**委派 prompt 中不得提及分节协议、骨架、逐节 Edit 或任何等价要求**；**不得为凑数在 Phase E 集中造 3 次**）」。

汇总口径（`d5-observations.md:42`–`:44`，逐字）：「换算式：**自发分节落盘次数 ÷ 独立观察次数 = 3 ÷ 3 = 100%**（单位：观察次），N ≥ 3 为下界。」「出现 **1 次**一次性长 Write 即判 D-5 未达成，并**如实记录比例（如 2/3）**」「观察次数不足 3 次时判「未执行（缺席）」，**不得**以「已建立窗口」替代观察本身。」

### (a) 8 条 frontmatter / 协议文本断言（守护项机器执行）

#### (a-1) 命令原文与原始输出

**T117 指定的命令（原文）与原始输出**（2026-09-07，HEAD `d86fa332`，工作区含本卡未提交改动）：

```bash
npm run repo:check 2>&1 | command grep -n "agent-tools"
```

```
99:- agent-tools:required: pass
```

（`command grep` 退出码 0 = 有命中；命中 1 行，位于 `repo:check` 文本输出的第 99 行。）

**同次 `repo:check` 的整体退出码与末尾**（完整输出落盘于本会话 scratchpad `repo-check-full.log`，末 5 行逐字）：

```
- gate-mounting:effective-config: pass

warnings:
  - [graph-quality] 图产物已 stale（source-commit）：source-commit：图记录的 sourceCommit（64b1d72f3f037cc104eb69d10ed9ee78f181f631）与当前 HEAD（d86fa332a15a1099d32c9057e6409352547c2fc0）不一致。请重新运行 `spectra batch --mode graph-only` 重建图。
EXIT=0
```

`npm run repo:check` 退出码 **0**；唯一 warning 属 `graph-quality` 族（本地图产物陈旧），与 `agent-tools` 族无关，只登记不处置。

**守护项的断言级输出（机器输出，非人工判读）**——用 `repo-check.mjs` 自带的 `--json` 取同一守护项的 `evidence`：

```bash
node scripts/repo-check.mjs --json > "$SCRATCH/repo-check.json"
node -e 'const s=JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")));const i=s.indexOf("agent-tools");console.log(s.slice(Math.max(0,i-200),i+1800))' "$SCRATCH/repo-check.json"
```

原始输出（JSON 字符串中含 `agent-tools` 的 2000 字节切片，逐字；切片首尾各带一段相邻守护项的文本）：

```
udget","title":"AGENTS 文档字节数在 Codex 预算内（按 max 不按 sum）","status":"pass","evidence":{"budgetBytes":32768,"files":[{"name":"AGENTS.md","bytes":25020}],"largest":"AGENTS.md","largestBytes":25020}},{"id":"agent-tools:required","title":"spec-driver 子代理 tools 面的 8 条断言","status":"pass","evidence":{"assertions":[{"id":"tools:specify:Edit","kind":"required-tool","title":"agents/specify.md 的 tools 含 Edit","status":"pass","detail":"tools = [Read, Write, Edit, Bash, Grep, Glob]"},{"id":"tools:specify:Bash","kind":"required-tool","title":"agents/specify.md 的 tools 含 Bash","status":"pass","detail":"tools = [Read, Write, Edit, Bash, Grep, Glob]"},{"id":"tools:plan:Edit","kind":"required-tool","title":"agents/plan.md 的 tools 含 Edit","status":"pass","detail":"tools = [Read, Write, Edit, Bash, Grep, Glob, mcp__plugin_spectra_spectra__context, mcp__plugin_spectra_spectra__impact]"},{"id":"tools:plan:Bash","kind":"required-tool","title":"agents/plan.md 的 tools 含 Bash","status":"pass","detail":"tools = [Read, Write, Edit, Bash, Grep, Glob, mcp__plugin_spectra_spectra__context, mcp__plugin_spectra_spectra__impact]"},{"id":"tools:tasks:Edit","kind":"required-tool","title":"agents/tasks.md 的 tools 含 Edit","status":"pass","detail":"tools = [Read, Write, Edit, Bash, Grep, Glob]"},{"id":"tools:tasks:Bash","kind":"required-tool","title":"agents/tasks.md 的 tools 含 Bash","status":"pass","detail":"tools = [Read, Write, Edit, Bash, Grep, Glob]"},{"id":"verify:tools-frozen","kind":"guard","title":"agents/verify.md 的 tools 与冻结快照逐字相等","status":"pass","detail":"与冻结快照逐字相等：[Read, Bash, Grep, Glob, mcp__plugin_spectra_spectra__detect_changes, mcp__plugin_spectra_spectra__impact]"},{"id":"protocol:verify-not-applicable-disclosure","kind":"text","title":"协议文本对 verify 标注「不适用」且附 FR-016 (ii) 独立性口径声明","status":"pass","detail":"plugins/spec-driver/templates/agent-output-discipline.md 含全部 6 条短语契约"}],"passed":8,"total":8}},{"id":"gate-mounting:effective-config","title":"GATE_DESIGN / GATE_TASKS 在 effective 配置上的 12
```

守护项自报：`"passed":8,"total":8`，8 条断言 `status` 全为 `"pass"`（换算式 8 ÷ 8 = 100%，单位：断言条；分子分母均由守护项输出给出，非本归档计数）。

#### (a-2) 8 条断言的定义（引自 `scripts/lib/agent-tools-core.mjs`）

换算式（`scripts/lib/agent-tools-core.mjs:11`，逐字）：「断言集共 8 条（换算式 6 + 1 + 1 = 8，单位：断言条；与 SC-003 的分母同源）」——

| 组 | 条数 | 定义出处（行号 + 逐字） | 求值代码 | 守护项输出中的断言 id |
|---|---|---|---|---|
| (i) 正向 | **6** | `:12`「`specify` / `plan` / `tasks` 三份 agent × `Edit` / `Bash` 两个工具」；`:38` `REQUIRED_TOOL_AGENTS = Object.freeze(['specify', 'plan', 'tasks'])`；`:46` `REQUIRED_TOOLS = Object.freeze(['Edit', 'Bash'])`；`:42`–`:44`「`Edit` 撑 FR-014 的「逐节 Edit 填充」；`Bash` 撑 FR-027 / FR-028 / FR-030……只补 `Edit` 是治了一半」 | `:155`–`:176`（双层 `for`，3 × 2 = 6；`tools` 取不到时 `:161`–`:166`「判不出⇒判失败」） | `tools:specify:Edit` / `tools:specify:Bash` / `tools:plan:Edit` / `tools:plan:Bash` / `tools:tasks:Edit` / `tools:tasks:Bash` |
| (ii) 护栏 | **1** | `:13`「`agents/verify.md` 的 `tools` 与冻结快照**逐字相等**（含顺序）」；`:16`–`:17`「(ii) 的比对源**是钉在本文件里的落地时快照**，不是运行时自取——运行时自取会让「当前值 == 当前值」恒真」；快照 `:61`–`:68` `VERIFY_TOOLS_FROZEN_SNAPSHOT = ['Read', 'Bash', 'Grep', 'Glob', 'mcp__plugin_spectra_spectra__detect_changes', 'mcp__plugin_spectra_spectra__impact']`（6 项） | `:107`–`:119` `diffAgainstFrozenSnapshot`（`equal = tools.length === snapshot.length && tools.every((t, i) => t === snapshot[i])`，新增 / 删减 / 改序三类都判红）；`:178`–`:198` | `verify:tools-frozen` |
| (iii) 文本 | **1** | `:14`「协议文本对 verify 标注「不适用」**且**附 FR-016 (ii) 的独立性口径声明」；事实源 `:71` `PROTOCOL_TEXT_SOURCE = 'plugins/spec-driver/templates/agent-output-discipline.md'`；短语契约 `:78`–`:85` `['不适用', '不得为其新增任何工具项', '持有 Bash', '写能力未在工具层封闭', '自律', '未取得']`（6 条）+ `:88` 主语锚 `'verify.md'`；`:93`–`:95` 比对前去 `*` / 反引号 / `_` | `:200`–`:223`（`ok = hasSubject && missing.length === 0`；事实源缺席 `:204`–`:208` 判 fail） | `protocol:verify-not-applicable-disclosure` |

6 + 1 + 1 = **8**（单位：断言条）；守护项输出的 8 个 id 与上表一一对应（8 ÷ 8）。

**显式不用的断言**（`:23`–`:24`，逐字）：「(iii) 明确**不使用**「断言 verify 的 tools 不含 Write / Edit」：该断言在现状下恒真、且测的是与独立性无关的量（verify 实测持有 `Bash`，写能力并未封闭）。」——与 `tasks.md:326`「不得再使用……作为独立性证据」一致。

**失效方向**（`:253`–`:268`，FR-045）：`validateAgentTools` 的 `catch` 分支返回 `status: 'fail'` 并附「工具面守护项内部错误（判不出⇒判失败，不放行）」，不返回空结果或 pass；`:270`–`:285` 任一断言 fail ⇒ 族 `status: 'fail'`，`errors` 逐条列出。

#### (a-3) 判定

**判定：✅ (a) 成立——以守护项输出为准**：`agent-tools:required: pass`，守护项自报 `"passed":8,"total":8`（8 ÷ 8 = 100%，单位：断言条），零 FAIL；`npm run repo:check` 退出码 0。**本归档未自读 frontmatter 自判任何一条**。

**附 · 输入事实的现取（只为可追溯，不参与判定；判定权在守护项）**：

```bash
for a in specify plan tasks verify; do echo "== plugins/spec-driver/agents/$a.md"; command grep -n "^tools:" plugins/spec-driver/agents/$a.md; done
command grep -n "verify.md" plugins/spec-driver/templates/agent-output-discipline.md | cut -c1-300
```

```
== plugins/spec-driver/agents/specify.md
3:tools: [Read, Write, Edit, Bash, Grep, Glob]
== plugins/spec-driver/agents/plan.md
3:tools: [Read, Write, Edit, Bash, Grep, Glob, mcp__plugin_spectra_spectra__context, mcp__plugin_spectra_spectra__impact]
== plugins/spec-driver/agents/tasks.md
3:tools: [Read, Write, Edit, Bash, Grep, Glob]
== plugins/spec-driver/agents/verify.md
3:tools: [Read, Bash, Grep, Glob, mcp__plugin_spectra_spectra__detect_changes, mcp__plugin_spectra_spectra__impact]
15:**`agents/verify.md`：本协议对它不适用，且不得为其新增任何工具项。**
19:verify 的 `tools` 无 `Write` / `Edit`，但它**持有 `Bash`**——而 `Bash` 本身就是一条完整的写路径（`sed -i` 即可改写 `plan.md` 的覆盖矩阵，再对着自己刚改过的矩阵判「已实现」，整条对账链在同一次推理内闭环）。因此**写能力未在�
136:**回填分工**：本节各条的实证结论由 verify 阶段逐条实跑给出（运行时口径与同一命题判据见 `agents/verify.md`），verify **只把 PASS / FAIL 输出到验证报告**、**不回填** `spec.md` / `plan.md`。
```

**时序悖论登记**（`tasks.md:326` 逐字：「该守护项同样产出于 implement，故 (a) 亦落入时序悖论」）：守护项与被检对象（三份 agent 的 `tools`、协议文本）由同一卡的 implement 一并产出；(a) 的 pass 证明的是「守护项在当前仓库态上全绿」，**不构成**该守护项在他人产物上同样有效的证据（与 D-4 的自证循环声明同形）。

### (b) ≥ 3 次独立观察全部自发分节落盘

**判定：❌ 未执行（缺席）——合格观察 0 次，演示未达成。**

**已登记观察数（命令原文与原始输出，见「执行体与输入语料」节同一命令）**：`d5-observations.md:48`「**（待编排器填写；当前 0 条。）**」⇒ 观察次数 = **0**（单位：观察次）。

**缺席原因（如实登记，来源分列）**：

1. **编排器告知**（本条委派 prompt 原文，逐字）：「本卡内所有长文档委派 prompt 都带了显式「骨架先落盘 / 分段 Edit」指令作为停摆缓解，按 T117「委派 prompt 中不得提及分节协议」的独立性规则全部不合格」。按 `d5-observations.md:21`–`:22` 观察纪律 1（逐字：「**委派 prompt 中不得提及**分节协议 / 骨架 / 逐节 `Edit` / 「先落盘再填」/ 「不要一次性写完」或任何等价要求。一旦提示，测到的就只是「被明确要求时能做到」，与本 Story 的命题（协议注入后子代理**自发**遵守）自相矛盾。」），这些委派**全部不构成合格观察**（不计入分子也不计入分母）。
2. **盘面旁证**（本归档能核到的委派简报，命令原文与原始输出）：

```bash
command grep -n "骨架\|逐节 Edit\|先落盘\|分段 Edit" \
  specs/277-spec-driver-engine-hardening/verification/phaseD-brief.md \
  specs/277-spec-driver-engine-hardening/verification/fix-phaseBD-brief.md \
  specs/277-spec-driver-engine-hardening/verification/fix-round3-brief.md | cut -c1-200
```

```
specs/277-spec-driver-engine-hardening/verification/phaseD-brief.md:6:> **返回通道可能丢失**：每段收口时把摘要 Write 到 `verification/phaseD-<段>-summary.md`。**首个动作必须�
specs/277-spec-driver-engine-hardening/verification/phaseD-brief.md:13:- T081–T084：内容**写进新建模板** `plugins/spec-driver/templates/gate-design-convergence-loop.md`（不是直接改 4 
specs/277-spec-driver-engine-hardening/verification/phaseD-brief.md:27:- T098 D-3：`verification/d3-gate-design-convergence-replay.md`（**先 Write 骨架**）：语料一 = F270 spec 阶段三轮�
specs/277-spec-driver-engine-hardening/verification/phaseD-brief.md:28:- T099 D-2 承诺任务化子项：`verification/d2-f270-commitment-pool.md`（先 Write 骨架）：`git show 8617ae3e:specs/270
specs/277-spec-driver-engine-hardening/verification/fix-phaseBD-brief.md:4:> **首个动作**：Write `verification/fix-phaseBD-summary.md` 骨架。必读：`verification/adversarial-phaseBD-epsilon.
```

入库的两份委派简报（Phase D、fix-phaseBD）各含显式「骨架」指令（5 处命中，单位：命中行；`fix-round3-brief.md` 零命中但其对应产出亦未被登记为观察）。d3 / d2 两份长文档正是在「**先 Write 骨架**」的明示下产出的——它们**不是**自发分节的证据。
3. **本归档自身**：本条（T113 / T114 / T115 / T117）的委派 prompt 同样带有「先落盘骨架再逐节填」的硬约束（硬约束 2），故本归档四个文件的产出过程**也不构成合格观察**，不得被后续回补时误计。

**换算式**：自发分节落盘次数 ÷ 独立观察次数 = **0 ÷ 0**（单位：观察次）——分母为 0，**不可算**；观察次数 0 < 下界 3，按 `d5-observations.md:44` 判「**未执行（缺席）**」，**不得以「已建立窗口」替代观察本身**。不存在可记录的比例（不是 0/3、不是 2/3，是 0/0）；不四舍五入、不凑数。

**窗口状态**：观察窗口自 `e01611b2` 开启后**仍开着**（`d5-observations.md` 未关闭、`观察记录` 段仍为 0 条）；后续卡在满足三条纪律（prompt 不提示 / 不同文档与会话 / 附字节比对命令与输出）的前提下产生的合格观察，可回补到 `d5-observations.md` 并重算本段（N ≥ 3 为下界）。

### (c) 已完成节字节不变（无整篇重写）

**判定：❌ 未执行（缺席）——(c) 的被判对象是 (b) 的合格观察，(b) 为 0 次，故字节比对 0 次。**

判据（`d5-observations.md:25`，逐字）：「每次观察须记录**骨架与已完成节的字节比对结果**（判据同块 1 §中断幸存与按段续写：判定标志是**字节**变化，不是行数、不是相似度、不是语义等价），并附产生该结论的**命令原文与原始输出**。」通过条件（`tasks.md:326`）：「（c）中已完成节字节发生变化即判定为「发生了整篇重写」，本演示不通过（FR-018）。」

**现状**：`d5-observations.md` 记录格式表（`:29`–`:38`）中「字节比对命令与原始输出」「已完成节字节是否变化」两列**无任何一行填写**（0 行，单位：观察记录行）。没有比对命令、没有原始输出 ⇒ 按 FR-005「无命令与原始输出者计未执行（缺席）」。

**不得替代的两件事**：本归档四个文件自身虽按「骨架 → 逐节 Edit」产出，但其委派 prompt 明示了该协议（见 (b) 第 3 条），**不得**把本归档的产出过程当作 (c) 的样本；也**不得**用 (a) 的 pass（工具在场）推断 (c)（工具被自发使用且未重写）——两者测的是不同的量。

**换算式**：已完成节字节不变的观察次数 ÷ 合格观察次数 = **0 ÷ 0**（单位：观察次），不可算；随 (b) 回补后重算。

## 性质与边界登记

1. **(a) 是机器执行、非人工判读**：判定权在 `repo:check` 的 `agent-tools:required` 守护项；本归档只运行命令并抄录原始输出（文本行 + `--json` 断言级 evidence）。8 的分子分母均由守护项输出给出。
2. **(a) 落入时序悖论 + 自证循环**：守护项、三份 agent 的 `tools`、协议文本均由本卡 implement 产出；pass 证明「当前仓库态全绿」，不证明守护项对他人产物有效，也不证明协议**被遵守**（(a) 测工具在场，(b)(c) 才测行为）。
3. **(a) 的护栏比对源是钉死的快照**（`agent-tools-core.mjs:16`–`:21`）：改 `VERIFY_TOOLS_FROZEN_SNAPSHOT` 即主动放宽护栏，须走 spec 修订；逐字相等（含顺序）严格强于 FR-017 (ii) 的「不得新增」。
4. **(b)(c) 是行为观察，只能来自窗口内的真实委派**：本卡窗口期的全部长文档委派都带了协议明示（停摆缓解），故合格观察为 0；这不是「协议无效」的证据，也不是「协议有效」的证据——是**无证据**。N = 0 与 N = 1 一样区分不了「协议生效」与「碰巧这么写」。
5. **不得凑数**（`d5-observations.md:23`–`:24`、`tasks.md:326`）：不得为凑数在 Phase E 集中造 3 次，不得把同一文档的 3 次续写记作 3 次；本归档未造任何观察。
6. **窗口开启时点如实**：`e01611b2`（块 1 落盘前最后一个 commit），块 1 生效点 `4255212c`，本归档 HEAD `d86fa332`；未把窗口开启时点改写为交付 sha。
7. **本归档产出过程自身不是样本**：委派 prompt 含协议明示（硬约束 2），产出的四个文件不得被后续回补时误计入 (b)(c)。
8. **`repo:check` 的 warn 态**：本次整体 `status: "warn"` 来自 `graph-quality` 族（本地图产物 sourceCommit 陈旧），与 `agent-tools` 族无关，只登记。

## 最终判定

| 段 | 判定 | 换算式（单位） | 证据锚点 |
|---|---|---|---|
| (a) 8 条 frontmatter / 协议文本断言 | ✅ 成立（以守护项输出为准） | 8 ÷ 8 = 100%（断言条，守护项自报 `passed: 8, total: 8`）；`npm run repo:check` exit 0 | 本文件 (a-1) 命令原文与原始输出（文本行 `99:- agent-tools:required: pass` + `--json` 断言级 evidence） |
| (b) ≥ 3 次独立观察全部自发分节落盘 | ❌ 未执行（缺席） | 0 ÷ 0（观察次），不可算；0 < 3 | `d5-observations.md:48`「当前 0 条」；委派简报「骨架」命中 5 行；编排器告知 |
| (c) 已完成节字节不变 | ❌ 未执行（缺席） | 0 ÷ 0（观察次），不可算 | `d5-observations.md:29`–`:38` 比对列 0 行填写 |

**T117 · D-5 三段汇总判定：部分——(a) 以守护项输出为准（pass，8 ÷ 8 断言条），(b)(c) 未执行（缺席）。**

按通过条件「三段全部成立，**且**（b）(c) 的 ≥ 3 次独立观察全部自发分节落盘」，**D-5 演示整体未达成**（换算式 0 ÷ 0 不可算，观察次数 0 < 下界 3）。如实记录：不是 2/3，不是 0/3，是 **0/0**；不四舍五入、不以 (a) 的 pass 或「已建立窗口」替代 (b)(c)。

**回补路径（不改变本次判定）**：观察窗口仍开着；后续卡产生的合格观察（满足 `d5-observations.md:21`–`:25` 三条纪律、不同文档与会话、附字节比对命令与原始输出）登记到 `d5-observations.md` 后，可对 (b)(c) 重算并另出一份汇总；本文件作为「窗口期内 0 次合格观察」的时点记录保留，不回改。

**归档时的附带发现（2 条，单位：发现条；只登记不修改既有文件）**：
1. 本卡窗口期的长文档委派全部带协议明示（停摆缓解），使 (b)(c) 在本卡内结构性不可测——「停摆缓解」与「自发性观察」两个目标在同一批委派上互斥，后续卡若要回补须专门留出不提示的委派。
2. `repo:check` 文本输出只给族级 `pass`，断言级证据须走 `--json`；T117 (a) 的「命令原文 + 原始输出」若只抄文本行，看不到 8 条各自的 `status`——本归档两者都抄了。
