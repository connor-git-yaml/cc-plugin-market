# Phase B/D delta 复验 B —— γ-C1 / γ-C2

审查档位：独立子代理异构对抗（Codex 配额耗尽，异构档位；本轮为 delta 复验，只读 + 微探针，未跑任何 `npm` / `npx`）
范围：γ 轮 C1 / C2 两条原缺陷的修复实质性
原缺陷来源：`specs/277-spec-driver-engine-hardening/verification/adversarial-phaseBD-gamma.md:17-39`（C1）、`:43-58`（C2）

## 复验表

| ID | 判定 | 依据 |
|----|------|------|
| γ-C1 | **实质已修**（三条接线中 2 条完整落地、1 条以「就近散文」而非「字面清单」落地；留 2 处残余，见下） | 见 §γ-C1 逐项 |
| γ-C2 | **实质已修**（白名单 4 → 7 路径条 + 语义条载体扩至散文；5 处载体逐字同源已机械验证；本卡改动面确认命中）；另暴露 2 组同源缺口（`lib/**` 与 5 类仓内载体仍在白名单外） | 见 §γ-C2 逐项 |

---

## γ-C1 逐项

原缺陷：「编排器亲自重算」是冻结值链唯一外部锚，但**编排器一侧两端都没接线**——委派模板不注入、门决策不重算、日志行无字段位。

修复形态：新建第 5 个共享块 `plugins/spec-driver/templates/gate-verify-matrix-recompute.md`（63 行），`sectionConfigs` append 第 15 个 entry（`scripts/sync-agent-docs.mjs:220-233`），注入**全部 8 份**编排器 SKILL。

### (a) 8 份 SKILL 是否各多了「重算 → 比对 → 日志字段位」+ `SD_MODE` 行 —— **是（重算三件套）/ 不适用（`SD_MODE`）**

**注入完整性（机械验证）**：以 `syncSection` 逐份重算比对，块 5 的 8 个 target 全部 `IN-SYNC`（`feature` / `story` / `implement` / `fix` / `resume` / `sync` / `doc` / `refactor`），块 4 的 4 个 target 亦全部 `IN-SYNC`；`sectionConfigs` 总数 15。三件套在每份中均在场：

- 重算：`## (b) ... 第 1 步 · 重算`（命令原文 fenced，逐字照抄口径）；
- 比对：`第 2 步 · 比对` + `recomputed` / `held` / `match` 三字段口径表 + `absent` 三种合法来源；
- 日志字段位：`## (c) 日志行模板（扩三个字段位）`，8 份各一行，如 `spec-driver-fix/SKILL.md:713`：
  `[GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | merge={pass|fail} | recomputed={sha8|error} | held={sha8|absent} | match={yes|no|absent} | reason={理由}`

**注入位置**（γ-C1 的「距 GATE_VERIFY 执行段 100~340 行」是原缺陷的一半病因，此项已改善）：

| mode | 块 5 BEGIN 行 | 紧邻上文 | 评价 |
|---|---|---|---|
| `fix` / `story` / `implement` | 665 / 758 / 828 | 各自 `#### 质量门（GATE_VERIFY）` 三步 fenced block 的**下一段** | 就近，达标 |
| `refactor` | 332 | `**质量门（GATE_VERIFY）**: 根据 behavior[GATE_VERIFY] 决策。` 的下一段 | 就近，达标 |
| `feature` | 895 | 块 4 END（块 4 本身紧接 `## Gate 决策流程（动态）` 的 fenced block） | 同节内，距 `echo` 约 100 行 |
| `resume` / `sync` / `doc` | 470 / 399 / 785 | 块 3 END | 三者无独立 `#### 质量门（GATE_VERIFY）` 段，`sync-agent-docs.mjs:211-212` 已就此**显式留痕**，非隐瞒 |

**`SD_MODE` 行 —— 判定「不适用，且该不适用有正当且已留痕的理由」**：

- 探针：块 5 源文件 `grep -c SD_MODE` = **0**（块 2 源文件 = 6）。块 5 无任何 per-file 参数，故不挂 `preludeGuard`、不需 `SD_MODE`。
- 该裁定在 `scripts/sync-agent-docs.mjs:214-217` 有显式理由：「给没有参数的块加 per-file 参数守卫，只会要求 `sync` / `doc` / `refactor` 三份 SKILL 补一行无消费方的 `SD_MODE`，否则守卫必红」。**核对成立**。
- 既有 `SD_MODE` 面（块 2，5 个 target）复核：`feature=feature` / `story=story` / `implement=implement` / `fix=fix` / `resume=resume`，**各文件恰 1 行**，取值 = 目录名去 `spec-driver-` 前缀，与 `checkSdModeDeclaration`（`scripts/sync-agent-docs.mjs:37-56`）的期望一致；其余 4 份（`doc` / `refactor` / `sync` / `constitution`）计数 0，符合 targets 定义。

### (b) 块 5 复算命令与 tasks.md 冻结字段复算命令是否同一算法 —— **是，且已机械证明（非仅描述一致）**

- 字节级：块 5 `gate-verify-matrix-recompute.md:22` 的 fenced 命令（301 字符）把 `<plan.md>` 替换为实际路径后，与 `tasks.md:37` 冻结字段表「复算命令」行反引号内的字符串（338 字符）**逐字节相同**（node 探针：`identical: true`，首差位置扫描无输出）。
- 语义级：两处规范化规则同为 CRLF→LF、`rstrip` 去行尾空白、`\n{3,}→\n\n` 折叠、`strip('\n')+'\n'`，再 sha256；块 5:25 另有一句反漂移约束「**两处不得各写一套**——规范化规则不同则两个哈希必然不等，重算会恒报不一致」。
- 实跑（对当前 `plan.md` 各跑一次）：
  - tasks.md 版本 → `3c5aa22b941f35327732f3859d4ac38facf2524db0fbb3124b2e63e11cbbf4a8`
  - 块 5 版本（同一字符串，仅路径替换）→ `3c5aa22b941f35327732f3859d4ac38facf2524db0fbb3124b2e63e11cbbf4a8`
  - `tasks.md:32` 冻结值 → `3c5aa22b941f...bbf4a8`
  - **三值一致**⇒ 算法同一，且矩阵自 `GATE_TASKS` 冻结以来未被改写。

### (c) `held` 来源与「verify 能改 tasks.md ⇒ held 可被改」 —— **已收口，但收口条款分散在块 3 / verify.md，块 5 自身未复述禁止项**

- 块 5:32 定义 `held` = 「**本会话持有值**的前 8 位；无持有值记 `absent`」——持有介质是编排器自身会话上下文，落在 verify 写面之外。
- 块 3 `gate-tasks-scope-cut-acceptance.md` 本轮新增的**编排器四步动作表**（算 → 写 → 持有 → 委派注入）把第 3 步「本会话持有该哈希…直到本次流程结束」写成显式动作，并附一句 **「磁盘上的 `tasks.md` 不是独立性依据——持有 `Bash` 的一方可以连矩阵带哈希一并原地改写」**。
- `resume` 分支：块 5:38 的 `absent` 来源 2 = 「`resume` 会话取不到冻结字段的 commit sha（缺 sha，或 `git cat-file -e <sha>` 失败）」⇒ **只认 commit 对象，否则缺席**；完整取法（`git show <sha>:<tasks 制品路径>`、禁「最近一个含 tasks 制品的 commit」/「当前 `HEAD`」、禁「退回只比对磁盘两值」）在 `plugins/spec-driver/agents/verify.md:145-151`，块 5 不复制符合 FR-036 单一事实源。
- 覆盖面核对：块 3 targets 不含 `fix`（`fix` 零挂 `GATE_TASKS`），块 5 targets 含 `fix`；`fix` 下 `held` 恒由块 5:37 的 `absent` 来源 1（「本 mode 不挂 `GATE_TASKS`」）承接，**无覆盖空洞**。
- 残余（见 R-2 之外的次要项）：块 5 未逐字禁止「在无持有值时改从工作区 `tasks.md` 现读一个值充当 `held`」。最近的禁止语在块 3（7 份在场）与 verify.md（子代理侧）。`fix` 那份**只有块 5、没有块 3**，故该禁止语在 `fix` 的 SKILL 全文中缺席——但 `fix` 下 `held` 恒 `absent`，无可读之值，实害为零。记 INFO。

### (d) 委派 prompt 清单是否真加了「冻结值注入块」 —— **未字面加入；只在块 5 (a) 以要求形式存在** ⇒ 残余 R-2

块 5:7-13 的 `## (a)` 写明「委派 verify 子代理时，prompt 的**显式清单必须包含** `GATE_TASKS` 冻结值注入块」，并自陈判据「**不在清单里就等于没有**：委派拼装是逐项照抄清单的，写在别处的旁注不会被拼进去」。

但各 SKILL 里**真正被照抄的那份字面清单一处未改**（全部 8 份实测）：

- `spec-driver-story/SKILL.md:739`：`prompt: "{verify prompt}" + "{上下文注入 + spec.md + tasks.md + 5a/5b 报告路径 + config.verification}"`
- `spec-driver-implement/SKILL.md:811`：同上
- `spec-driver-fix/SKILL.md:644`：`"{上下文注入 + fix-report.md + tasks.md + 4a/4b 报告路径 + config.verification}"`
- `spec-driver-refactor/SKILL.md:323`：`"{上下文注入: impact-report, refactor-plan, residual-report}"`
- `feature` / `resume` / `sync` / `doc`：无 `"{verify prompt}"` 字面装配行

并且**顺序倒置**：`story` 的委派在 `:739`，要求出现在 `:762` 附近（块 5 (a)）——按文档执行顺序，编排器读到「清单要加一项」时委派已经发出。`fix`（644 → 668）、`implement`（811 → 831）、`refactor`（323 → 335）同形。

### (e) `match=no` / `merge=fail` ⇒ 不得 AUTO_CONTINUE 与既有 `always/auto/on_failure` 文案是否冲突 —— **无逻辑冲突（已声明优先级），但形成两套字面口径** ⇒ 残余 R-1

块 5 `## (d)`（:57-61）显式声明优先级：「这一条**优先于 `behavior` 的 `auto`**」「本条不改变门是否停下的 `behavior` 语义：它改变的是**决策取值**——`decision` 不得取 `AUTO_CONTINUE`，转入该门既有的处置路径」。逻辑上自洽、方向 fail-closed，与「判不出从严」同向。

冲突点在**字面**而非逻辑：`fix:660` / `story:753` / `implement:823` 的 `#### 质量门（GATE_VERIFY）` fenced 三步块**原样未动**，其内仍是

```text
2. 根据 behavior 决策:
   - auto → 自动继续（仅在日志中记录结果）
3. 输出: [GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | reason={理由}
```

即同一份文件内，同一条日志行有**两套字面模板**（旧的在编号执行步骤里、新的在其下方的共享块里），同一个 `auto` 有**两套字面处置**。

---

## γ-C2 逐项

### 两处白名单是否逐字一致 —— **是，且已扩为 5 处，全部机械验证逐字相同**

- 块 4 `gate-design-convergence-loop.md:9-18` 命中面表：路径条 **7**（`scripts/**`、`hooks/**`、`contracts/**`、`.specify/orchestration-overrides.yaml`、`agents/**`、`skills/**`、`templates/**`）+ 语义条 1，换算式 `8 = 7 + 1`（单位：命中条）。
- 语义条第 8 行原文：`任何「**失效即静默放行**」的判定器 / 守护 / 安全检查**逻辑，不论其载体是代码还是 prompt / 模板散文**，**不论其路径**` ——「代码」已按 γ-C2 修补方向改为「载体」措辞。
- 5 处载体的白名单判据段（`grep -n 'plugins/spec-driver/agents/\*\*'` 定位）：`agents/plan.md:335`、`skills/spec-driver-fix/SKILL.md:564`、`doc:857`、`refactor:249`、`sync:471`——node 探针取「白名单式命中面判据 … 被判为门禁 / 判定器 / 安全类时」之间的片段，**5 份全部 `IDENTICAL`，各 451 字符**；路径集合与块 4 表**逐字且同序一致**（探针输出 `true`）。
- ε-W-2 的「mode 分层矩阵」限定语已在 5 份中回补（`mode 分层矩阵第 1 项 … 与第 4 项 … 在全部 mode 下升格为强制`）。
- 唯一措辞差：块 4 语义条尾部有 `**不论其路径**`，5 份副本无。5 份自称「与共享块的分类表**逐字同源**」，此处严格说不是逐字。实害为零（语义条本就与路径无关），记 INFO-1。
- 连带计数已同步：`tests/integration/spec-drift-repo-check-regression.test.ts:148-171` 的 `added` 数组实测 **15 项**，块 5 的 `agent-docs:shared-section:gate-verify-matrix-recompute` 在 `agent-docs` 族内排第 5、即 `sectionConfigs` 的 append 末位，K14 排序契约成立。

### 第 5 条「逻辑不论载体」后本卡 Phase B/D 改动面是否命中 —— **命中，且是多重命中**

本卡工作区改动 63 项，逐条对照：`plugins/spec-driver/agents/*.md`（6 份）→ 第 5 条；`plugins/spec-driver/templates/**`（8 份含两个新建块）→ 第 7 条；`plugins/spec-driver/skills/**`（8 份）→ 第 6 条；`plugins/spec-driver/scripts/**` → 第 1 条；`plugins/spec-driver/contracts/**` → 第 3 条。**γ-C2 描述的「路径条全部未命中」逃逸路径已被物理堵死**。

### 还有哪些能承载判定器散文的路径仍在白名单外

按「这段逻辑坏掉时，本该被它拦下的东西会不会照常通过」逐条判，列出并给处置意见：

| # | 路径 | 承载什么 | 是否应补 | 依据 |
|---|---|---|---|---|
| G-1 | `plugins/spec-driver/lib/**` | `orchestrator.mjs` / `orchestration-resolver.mjs` / `orchestrator-fallback.mjs` / `delegation-contract.mjs` / `preference-rules.mjs` —— **门挂载判定本体**：`mounted` / `mounted_in_base` / `mounting_violations` 三个字段的**产生者**（`lib/orchestrator.mjs:238-239`、`lib/orchestration-resolver.mjs:535-536`） | **强烈应补（本表最高优先）** | 白名单收了 `scripts/**`，而 `scripts/orchestrator-cli.mjs:15-17` 只是 `import … from '../lib/…'` 的薄壳；把壳列入白名单、把引擎排除在外，正是块 4 自己那句「判据写成值枚举的形态，每加一个新值就漏一次」所警告的形态。FR-052 / FR-053 / FR-068 的实现全在 `lib/` |
| G-2 | `plugins/spec-driver/config/orchestration.yaml` | gate 定义本体：`applicable_modes` / `default_behavior` / phase 序列 | **强烈应补** | 白名单收了**覆盖文件** `.specify/orchestration-overrides.yaml`（第 4 条），却没收**被覆盖的 base**。删一个 mode 的 `GATE_DESIGN` 挂载、或把 `default_behavior` 改 `skip`，是最直接的关门方式，且零路径命中 |
| G-3 | 仓根 `scripts/**`（尤其 `scripts/lib/*-core.mjs`） | `repo:check` 守护本体：`repo-maintenance-core.mjs`、`namespace-consistency-core.mjs`、`agent-tools-core.mjs`、`graph-quality-core.mjs`、`sync-agent-docs.mjs` | **应补** | 第 1 条只写 `plugins/spec-driver/scripts/**`。本卡自己就改了 `scripts/sync-agent-docs.mjs` 并新建 `scripts/lib/agent-tools-core.mjs`——两者失效即整族守护静默通过 |
| G-4 | `.specify/templates/**` | `plan-template.md`（「约束型 FR 禁止进入本章节」）、`tasks-template.md`（冻结值字段位，6 处命中）、`verification-report-template.md` | **应补** | T058 的原子组把 canonical 与项目副本绑成一对，但只有 canonical（`plugins/spec-driver/templates/**`）在白名单内；只改副本零路径命中。另 `.specify/project-context.yaml` 同理 |
| G-5 | `plugins/spec-driver/skills-codex/**` + `.codex/skills/**` | 与 `skills/**` 同一份判定散文（`spec-driver-fix` 镜像实测各 4 处命中「recomputed / 路径条 7 / 失效即静默放行」） | **应补，或把第 6 条 glob 放宽为 `plugins/spec-driver/skills*/**`** | `skills/**` 不匹配 `skills-codex/`；`.codex/` 整个在 `plugins/` 之外。缓解因素：存在 `codex-plugin-consistency` 漂移守护，只改镜像会被判漂移——但那是**另一族**守护，不是本白名单的射程 |
| G-6 | `docs/shared/**` + `AGENTS.md` / `CLAUDE.md` | 仓库级行为规则（含「门禁类改动须走异构对抗档位」这条**元规则**） | 建议补 `docs/shared/**` | 关掉这条元规则等于关掉块 4 治理的整个循环。优先级低于 G-1~G-4（它是策略层不是单次判定器），但同属「失效即静默放行」 |

**换算式建议**：路径条 **7 → 12**（+ `plugins/spec-driver/lib/**`、`plugins/spec-driver/config/**`、仓根 `scripts/**`、`.specify/templates/**`、`plugins/spec-driver/skills-codex/**` 与 `.codex/skills/**` 合一条；单位：命中条），命中面 **8 → 13**。**五处载体必须同批改**（块 4 + `plan.md:335` + `fix:564` / `doc:857` / `refactor:249` / `sync:471`），否则立刻造出第六处漂移面。

**共同缓解**：以上六组全部落在语义条 8 的射程内（判据「坏掉时本该被拦下的会不会照常通过」对它们逐条答「会」），故是**漏一道路径闸**而非**完全无闸**。这也是本节全部记 WARNING / INFO 而非 CRITICAL 的理由。

---

## 新引入缺陷

> 说明：以下 R-1 / R-2 是本次修复**动作本身**造成或未消解的残余；G-1~G-6 已在上表登记，属**同源但不在 γ-C2 射程内**的既有面，不重复计入本节。

### **[R-1]** WARNING（本节最高）· 同一份 SKILL 内出现**两套字面 `[GATE] GATE_VERIFY` 日志模板**与**两套 `auto` 处置**，旧的那套在编号执行步骤内

**构造**：编排器执行 `spec-driver-story` 的 Phase 5c，读到 `:743` 的 `#### 质量门（GATE_VERIFY）`，照抄其 fenced block 的 `3. 输出:` 模板，产出
`[GATE] GATE_VERIFY | policy=balanced | override=无 | decision=AUTO_CONTINUE | reason=三份报告无 CRITICAL`。
形式完全合规（它就是本文件里写着的模板），但无 `recomputed` / `held` / `match` / `merge` 四个字段位——**恰是块 5:52 自己描述的失效形态**：「缺字段位时，『算了并比对了』与『一步没做而 verify 自报三值一致』在日志上完全同形」。同理 `behavior=auto` 时照抄 `- auto → 自动继续（仅在日志中记录结果）`，绕过 (d) 的 `match=no ⇒ 不得 AUTO_CONTINUE`。

**命中位置**：`spec-driver-fix/SKILL.md:653-661`、`spec-driver-story/SKILL.md:746-754`、`spec-driver-implement/SKILL.md:816-824`（三份 fenced 三步块）。`refactor:328` 的一句话版同理但无字面模板可抄，风险较低；`feature:793` 的 `echo "[HH:MM:SS] GATE_${GATE_ID}: …"` 是**全 gate 通用**行，不应加 `GATE_VERIFY` 专属字段，不在本条射程。

**为何不判 CRITICAL**：新模板就在其下方 4~10 行，且 (c) 明写「三个新字段位不是可选装饰」、(d) 明写「优先于 `behavior` 的 `auto`」；顺序读完即可正确解析。

**修补方向**（三份文件，共享块之外的手写区，可直接 Edit）：把 `3. 输出:` 那一行的模板替换为块 5 (c) 的扩展模板，或在 fenced block 内加一行指针 `# 字段位与 auto 的例外见下方共享块 gate-verify-matrix-recompute (c)(d)`；并在 `- auto → 自动继续` 后缀 `（例外见下方共享块 (d)：merge=fail 或 match=no 时不得 AUTO_CONTINUE）`。**不要**改共享块本体去迁就它。

### **[R-2]** WARNING · 委派清单**字面未改**，且「要加一项」的要求出现在委派动作**之后**

**构造**：编排器执行 `spec-driver-implement` Phase 5c，读到 `:811` 的 `Task(… prompt: "{verify prompt}" + "{上下文注入 + spec.md + tasks.md + 5a/5b 报告路径 + config.verification}" …)`，逐项照抄该清单发出委派——清单里没有冻结值注入块，于是没拼。二十行后才读到块 5 (a) 的「必须包含」。此时委派已发出，编排器的合理处置是继续（重发一次 verify 成本高且无口径要求），于是 verify 拿不到 ①，按 verify.md:141 判「未执行（缺席）」⇒ 本项恒红。

**自相矛盾点**：块 5:12 自己写着「**不在清单里就等于没有**：委派拼装是逐项照抄清单的，写在别处的旁注不会被拼进去」——而这条修复**正是**把要求写在了那份清单之外。

**命中位置**：`story:739`、`implement:811`、`fix:644`、`refactor:323`（4 份有字面装配行且一处未改）；`feature` / `resume` / `sync` / `doc` 无字面装配行，不适用。

**为何不判 CRITICAL**：失败方向是 **fail-closed**（缺席 ⇒ 判未执行 ⇒ 归不通过侧），不构成静默放行；代价是本项恒红而非被绕过。

**修补方向**：4 份的字面装配行各加一项，如 `+ "{GATE_TASKS 冻结值注入块：sha256 + 冻结时点 + 表行数（无持有值写 absent 及原因）}"`；同时把块 5 (a) 首句改为「本要求的落点是各 SKILL 的字面装配行，本节只定义其内容与缺席口径」，消除「要求与落点分家」。

### **[INFO-1]** 5 份白名单副本自称与块 4「逐字同源」，但块 4 语义条尾部的 `**不论其路径**` 未随同

**位置**：块 4 `gate-design-convergence-loop.md:17` vs `agents/plan.md:335`（及 4 份 SKILL 副本）。实害为零（语义条定义上即与路径无关），但「逐字同源」是本卡自己立的反漂移判据，字面不符会让后续核对者得出错误结论。**修补**：5 份补上该两词，或把自述改为「与块 4 分类表同源（语义条为等价改写）」。

### **[INFO-2]** 块 5 未复述「不得从工作区 `tasks.md` 现读值充当 `held`」，而 `fix` 那份**只挂块 5、不挂块 3**

`fix` 的 SKILL 全文中因此没有块 3 那句「磁盘上的 `tasks.md` 不是独立性依据」。实害为零——`fix` 零挂 `GATE_TASKS`，`held` 恒走块 5:37 的 `absent` 来源 1。记录以防日后 `fix` 挂载面变化时该缺口被激活。

---

## 结论

**实质已修 2 / 仅措辞 0 / 未修 0**（N+M+K = 2）。

两条原缺陷的**核心机制**都真正落地、且经机械探针而非文本阅读确认：γ-C1 的外部锚已从「verify 的旁注」变成编排器可执行口径（重算命令原文 + 固定顺序 + 4 个日志字段位 + `match=no ⇒ 不得 AUTO_CONTINUE`），8 份注入全 `IN-SYNC`，两处复算命令逐字节同一且实跑三值一致（`3c5aa22b…`，矩阵未被改写）；γ-C2 的白名单已由 4 路径条扩为 7、语义条由「代码」改为「不论其载体是代码还是 prompt / 模板散文」，5 处载体逐字同源（451 字符全等、路径同序），本卡 Phase B/D 改动面确认多重命中，原逃逸路径物理关闭。

**提交意见：可提交，但建议先做 R-1 的三处一行修补**——R-1 让「编排器唯一会照抄的东西」在同一份文件里仍存在一份无字段位的旧模板，正是 γ-C1 病因的残留形态，修补成本是三份 SKILL 各改一行；R-2（fail-closed，代价是本项恒红）与 G-1 / G-2（`lib/**` 与 `config/orchestration.yaml` 未进白名单，但落在语义条射程内）建议随本卡登记为残余、按「追加而非改写」落进 `verification/`，不阻断本次提交。
