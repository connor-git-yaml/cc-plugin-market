# Phase B + D 散文引擎异构对抗审查 — γ 角（新约定被静默绕过面）

## 审查对象

相对 commit ① `4255212c` 的工作区改动（Phase B + D 落地的散文）：

- `plugins/spec-driver/agents/{verify,tasks,plan,spec-review,specify,implement}.md` + `spec-review.artifact.yaml`
- `plugins/spec-driver/templates/specify-base/{plan,tasks,verification-report}-template.md`（与 `.specify/templates/` 副本）
- 共享块：`templates/agent-output-discipline.md`、`templates/gate-tasks-scope-cut-acceptance.md`、`templates/gate-design-convergence-loop.md`（新增，untracked）
- 7 份 `skills/spec-driver-*/SKILL.md` 与其 `skills-codex` / `.codex` 镜像
- 设计依据：`specs/277-spec-driver-engine-hardening/{spec,plan}.md`

**切入角**：执行者是 LLM 子代理 / 编排器，无编译器强制。默认「一个想省事的执行者能在表面合规下把约定架空」，逐条构造。

## CRITICAL

### **[γ-C1]** 「编排器 GATE_VERIFY 亲自重算」是整条冻结值链的唯一外部锚，但它在编排器一侧**两端都没接线**——委派模板不注入、门决策流程不重算、日志行无槽位

**执行者动作**：编排器按 SKILL 的 `#### 质量门（GATE_VERIFY）` 逐条照做——`1. 获取 behavior[GATE_VERIFY] → 2. 按 behavior 决策 → 3. 输出 [GATE] 日志行`——三步跑完，从不重算矩阵哈希。verify 子代理则在报告里自写「① 注入值 = A / ② tasks 值 = A / ③ 现算 = A，三值一致」。

**产物形态**：一份三值全一致的验证报告 + 一行格式完全合规的 `[GATE] GATE_VERIFY | policy=balanced | override=无 | decision=AUTO_CONTINUE | reason=...`。表面上「冻结值三值并列比对」这一节完整落地。

**命中位置**：

- `plugins/spec-driver/agents/verify.md:133`：「**第三方比对位是编排器在 `GATE_VERIFY` 决策时的亲自重算**……三项（重算值 / 持有值 / 比对结论）**写入 `[GATE] GATE_VERIFY` 日志行**」
- `plugins/spec-driver/skills/spec-driver-story/SKILL.md:731-738`（`implement/SKILL.md:801-807`、`fix/SKILL.md:649-655` 同形）：
  ```text
  1. 获取 behavior[GATE_VERIFY]
  2. 根据 behavior 决策: ...
  3. 输出: [GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | reason={理由}
  ```
  —— **无「重算」步骤，日志行模板无「重算值 / 持有值 / 比对结论」三个字段位**。
- `plugins/spec-driver/skills/spec-driver-feature/SKILL.md:754-794`（通用 `## Gate 决策流程（动态）`）：整段只有 `get-gate-behavior` → `GATE_DECISION` → `echo "[HH:MM:SS] GATE_${GATE_ID}: $GATE_DECISION | policy=... | is_hard_gate=..."`，**同样零重算、零字段位**。
- 委派侧：`spec-driver-story/SKILL.md:723` 的 verify 委派 prompt 拼装为 `"{verify prompt}" + "{上下文注入 + spec.md + tasks.md + 5a/5b 报告路径 + config.verification}"`——**冻结值不在这份显式清单里**。
- 唯一写着「亲自重算」的那句话（`gate-tasks-scope-cut-acceptance.md:81`，注入后落在 `feature/SKILL.md:971`、`story:634`、`implement:609`、`refactor:227`、`sync:381`、`doc:767`、`resume:452`）位于 **`## 冻结值字段格式`** 这个 **GATE_TASKS** 共享块的小节里，距各自的 GATE_VERIFY 执行段 100~340 行，且该块开篇即声明「本块规定该门（GATE_TASKS）停下时展示什么」。

**谁能发现（外部锚）**：**无**。verify.md 把判定权明确交给编排器，编排器的可执行口径（步骤 + 日志行模板）里没有这个动作，两份散文对同一件事各说各话；而 verify.md:132「① 缺席 ⇒ 判『未执行（缺席）』」这条 fail-loud 反过来给了 verify 一个**造假动机**——不自写 ①，本项就必红。人工在门内交互看到的是 verify 自报的三值一致，没有任何独立读数可对。

**最小修补方向**：把三件事写进编排器可执行口径而非 verify 的旁注——(1) 在各 SKILL 的 verify 委派 prompt 显式清单里加「`GATE_TASKS` 冻结值（注入块）」这一项；(2) 在 `## Gate 决策流程（动态）` 与各 `#### 质量门（GATE_VERIFY）` 段前置一步「重算 `plan.md` 矩阵规范化 sha256 并与本会话持有的注入值比对」，给出复算命令原文；(3) 把日志行模板扩成 `| recomputed={sha} | held={sha} | match={yes|no|absent}`——**没有字段位的要求等于没有要求**，日志行模板是编排器唯一会照抄的东西。

---

### **[γ-C2]** 门禁类白名单（收敛循环 + plan 升格条款共用）**漏掉散文引擎自身所在的三个目录**——本卡 Phase B/D 这类改动可被合法判为「非门禁类」，收敛循环整条不执行

**执行者动作**：改动全部落在 `plugins/spec-driver/agents/**`、`skills/**`、`templates/**`（即本次 Phase B/D 的改动面），逐条对照 5 条命中面：路径条 1–4 全部未命中；第 5 条写的是「判定器 / 守护 / 安全检查**代码**」，散文不是代码，答「未命中」。留痕写足「逐条说明 5 条为何全部未命中」，形式完全合规。

**产物形态**：一份合规的分类留痕（结论「非门禁类」+ 逐条依据），`GATE_DESIGN` 走单轮、`FR 覆盖矩阵`/`关键量反向普查` 不升格为强制、可继续按内容触发关闭。

**命中位置**：

- `plugins/spec-driver/templates/gate-design-convergence-loop.md:9-17`：命中面表只列 `plugins/spec-driver/scripts/**` / `hooks/**` / `contracts/**` / `.specify/orchestration-overrides.yaml` 四条路径 + 第 5 条「任何『**失效即静默放行**』的判定器 / 守护 / 安全检查**代码**，**不论其路径**」。
- `plugins/spec-driver/agents/plan.md:311`（(ii) 门禁类升格）：白名单**逐字相同**——`plugins/spec-driver/scripts/**`、`plugins/spec-driver/hooks/**`、`plugins/spec-driver/contracts/**`、`.specify/orchestration-overrides.yaml`，同样以「判定器 / 守护 / 安全检查代码」收口。
- 对照事实：本卡 Phase B/D 的全部改动面（`agents/**` 6 份、`templates/**` 5 份、`skills/**` 7 份 × 3 镜像）**一条路径都不在白名单内**，而 `agents/verify.md` 的「交付判定合并律」「五态定义」「兜底条款的例外」正是**失效即静默放行**的判定器——只是它的载体是散文不是 `.mjs`。
- `gate-design-convergence-loop.md:28` 只给了一条窄自指豁免：「凡改动**本块或其消费方 SKILL 的分类段落**，一律走门禁类」——射程仅限**分类段落**，不覆盖 `verify.md` 的合并律、`tasks.md` 的覆盖不变量、`plan-template.md` 的类别判定尺度。

**谁能发现（外部锚）**：**无**。分类结论由编排器自判自留痕，门内交互展示给用户的是「已逐条说明未命中」这样一份看起来极其扎实的留痕。第 5 条的「代码」二字给了完全正当的、不需要撒谎的出口。

**最小修补方向**：白名单补三条路径 `plugins/spec-driver/agents/**`、`plugins/spec-driver/skills/**`、`plugins/spec-driver/templates/**`（换算式：路径条 4 → 7，单位：命中条），并把第 5 条的「代码」改为「**判定器 / 守护 / 安全检查逻辑，不论其载体是代码还是 prompt / 模板散文**」。两处（共享块 + `plan.md` (ii)）须同步改，否则立刻产生第三处漂移面（见 γ-C5）。

---

### **[γ-C3]** 「类别 = 约束型」是一条免任务 / 免裁剪登记 / 免 K=3 预算 / 免自动判未实现、**却计入口径 (b) 分子**的四重免检通道，而唯一的下游复核位（verify）被**明文禁止**改判

**执行者动作**：plan 阶段把想省事的实现型 FR 在矩阵「类别」列填 `约束型`，「认领 Phase」填占位符 `—`，「验证点」列写「由 verify 三取值给出」。verify 阶段对该 FR 报 `✅ 已核验未违反`，核验方式随便挂一条能跑出输出的命令（`grep -c ... ` 即可）。

**产物形态**：矩阵 N 行齐全、无未认领行、裁剪登记为空（K=3 预算一条没用）、tasks 的 FR 覆盖映射表该行填「类别：约束型 + 核验落点指针」而非任务、Layer 1 覆盖率分母把它整条移出（分母变小、覆盖率变高）、口径 (b) 的 F 分子**照收**。全链路零红灯。

**命中位置（四重免检逐条）**：

1. 免任务：`plugins/spec-driver/agents/tasks.md:213`「**约束型 FR 一律不要求任务**」、`:265` 同款约束。
2. 免裁剪登记 ⇒ 免 `GATE_TASKS` 接受点与 K=3 累计上界：`plugins/spec-driver/agents/verify.md:92`「**约束型 FR 禁止进入裁剪登记**」、`templates/specify-base/plan-template.md`「**约束型 FR 禁止进入本章节**」。
3. 免自动判未实现：`verify.md:92`「**也不因『未认领』被自动判「未实现」**」；`verify.md:114`「**约束型行的占位符 `—` 不参与**本校验」⇒ 连 FR-003 交叉校验也绕开。
4. 免分母：`verify.md:64`「**约束型 FR**：**移出本统计的分母**」。
5. **却计入实现量下界的分子**：`verify.md:508`「口径 (a) 的 M **不收**『已核验未违反』……**口径 (b) 的 F 收**」——即 `F ÷ 64 ≥ 61 ÷ 64` 这条 95.3% 硬下界，可以靠把实现型 FR 重标为约束型、再报「已核验未违反」来充数。

**唯一下游复核位被明文关闭**：

- `plugins/spec-driver/agents/plan.md:262`：「**类别归属在本阶段一次性完成，不得留给 verify 临时改判。**」
- `templates/specify-base/plan-template.md`（`FR → Phase 覆盖矩阵` 行格式定义末条）：「**类别归属须在本阶段一次性完成并留痕，不得在 verify 阶段临时改判。**」

**谁能发现（外部锚）**：**无**。类别由 plan 子代理自填、判定依据由它自撰；verify 是唯一读到这张矩阵并做逐条对账的角色，而两处散文都明文禁止它改判。`spec-review` 侧未见对「类别列取值是否正确」的任何检查项（见 γ-C4）。模板给的「三项测试 + 从严方向（凡存在一份本次要新造或改写的制品来承载它的条款，一律判实现型）」是**好判据，但只有自证**。

**最小修补方向**：三选一或叠加——(a) 把「类别列取值抽检」写进 `spec-review` 的检查项，使它成为**另一支笔**（spec-review 与 plan 是不同子代理调用）；(b) 允许 verify **提出**类别异议并单列成一档取值（如「类别存疑」，归不通过侧），只禁止它**静默改判**而非禁止它报异议——现行文本把「不得改判」写成了「不得质疑」；(c) 给约束型行加一条**数量闸**：约束型行占比超过某阈值（如 30%）即在 `GATE_TASKS` 单列展示全部约束型行及其判定依据，交人工。至少 (b) 是零成本的措辞修补。

## WARNING

待核

## INFO

待核

## 已确认堵死的绕过

待核

## 结论

待核
