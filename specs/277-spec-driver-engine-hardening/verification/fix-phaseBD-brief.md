# B + D 对抗修订 · 实现简报（编排器拍板 · 2026-09-07 · commit ② 前）

> 执行者：代码实现子代理（角色等同 `plugins/spec-driver/agents/implement.md`）。**禁止 `Agent` 与 `mcp__*` 工具**。项目根 `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572`；禁 `git stash` / `git checkout` / 切分支；**不要 `git commit`**。
> **首个动作**：Write `verification/fix-phaseBD-summary.md` 骨架。必读：`verification/adversarial-phaseBD-epsilon.md`（ε：C-1/C-2/W-1~W-4/I-1~I-4）与 `verification/adversarial-phaseBD-gamma.md`（γ：C1~C3 及其 W/I）；`implementation-notes.md`（D-10/D-17 FR-049 代理判据词避让、D-13/D-18 repo:sync 定向回退、D-44 FR-065 手写副本）；`spec.md` `## 修订记录`。
> 通用护栏：共享块正文只改**源模板**再 `npm run docs:sync:agents`（幂等 = 快照→二跑→逐字节 diff 为空）；`agents/verify.md` frontmatter 一字不动；散文禁 `mcp__`、`暂停`、`AskUserQuestion` 字面（用「门停下」等）；数量必写换算式 + 单位；本环境 `grep` 是 `ugrep` function（原生用 `command grep`）；SKILL 变动 ⇒ `npm run repo:sync` 后定向回退无关再生产物（`git show HEAD:<path> > <path>`，只留本卡 SKILL 的 wrapper）；`repo-check-baseline.json` 禁改；不改 `.snap`；tasks.md 不新增编号，在 Phase B/D 段末各追加一行「对抗修订（ε/γ）」；`implementation-notes.md` 覆盖写四项并续编偏差；`spec.md`/`plan.md` 只允许**追加式修订记录**（编排器授权本轮追加，改动口径逐行登记）。

## 一、ε-C1 + γ-C1（同根：交付结论与冻结值锚在编排器侧没接线）
1. `agents/verify.md` 步骤 8「触发质量门」改写：**合并律判不通过 ⇒ GATE_VERIFY 停下（NEEDS FIX）**；构建/测试失败 ⇒ 同；仅 Lint 警告 ⇒ 记录不停；**合并律通过 ∧ 工具链全部通过 ⇒ READY FOR REVIEW**。返回摘要模板加「合并律结论」行（ε-I-1）。三份 `verification-report-template.md`（`templates/`、`templates/specify-base/`、`.specify/templates/`）的 `总体结果` 表写明 `Overall = 合并律 ∧ 工具链`，禁止 `合并律 ❌` 与 `Overall ✅` 并存。
2. **新建共享块 5** `plugins/spec-driver/templates/gate-verify-matrix-recompute.md`，`scripts/sync-agent-docs.mjs` **append** entry（key `gate-verify-matrix-recompute`，targets = 8 份 SKILL feature/story/implement/fix/resume/sync/doc/refactor 的 GATE_VERIFY 段，锚点 `grep -n` 现取，marker 之外可加 1 行 `SD_MODE=<mode>`，沿用 `preludeGuard`）。内容：(a) verify 委派 prompt 显式清单加「`GATE_TASKS` 冻结值注入块（哈希 + 时点 + 表行数）」；(b) GATE_VERIFY 决策**前置步骤**：编排器重算 `plan.md` `## FR → Phase 覆盖矩阵` 规范化 sha256（命令原文逐字给出：`python3 -c "import re,hashlib;t=open('<plan.md>',encoding='utf-8').read();s=re.search(r'(?ms)^## FR → Phase 覆盖矩阵\n(.*?)(?=^## )',t).group(1);n='\n'.join(l.rstrip() for l in s.replace('\r\n','\n').split('\n'));n=re.sub(r'\n{3,}','\n\n',n).strip('\n')+'\n';print(hashlib.sha256(n.encode()).hexdigest())"`）并与本会话持有值比对；无持有值（如 `fix` 无 GATE_TASKS、或 resume 无冻结字段 sha）⇒ `absent` ⇒ 矩阵对账记「未执行（缺席）」；(c) 日志行模板扩为 `[GATE] GATE_VERIFY | policy=… | decision=… | merge={pass|fail} | recomputed={sha8} | held={sha8|absent} | match={yes|no|absent} | reason=…`；(d) 决策消费合并律：`merge=fail` 或 `match=no` ⇒ 不得 AUTO_CONTINUE。
3. 块 3 `gate-tasks-scope-cut-acceptance.md` 的「冻结值字段格式」节补**编排器动作**：GATE_TASKS 通过后计算哈希 → 写 tasks.md 冻结字段 → 本会话持有 → 委派 verify 时注入。
4. 连带：check id 94 → **95**（`agent-docs:shared-section:gate-verify-matrix-recompute`）；K14 清单 14 → **15**（append 在 `gate-design-convergence-loop` 之后、`spec-driver-wrappers:*` 之前，注释表改终值 15）；SC-006 27 → **28**；注入点 20 + 8 = **28**；spec/plan 修订记录各追加一行。

## 二、ε-C2（合并律与既有四套词表零交集）
`agents/verify.md` 合并律节补一张「既有取值 → 7 态」映射表并**逐值**给侧：Layer 1.5 `COMPLIANT`→通过侧 / `PARTIAL`→未通过 / `EVIDENCE_MISSING`→未执行（缺席）；Layer 1.8 `RESIDUAL_FOUND`→报警未处置；Layer 1.9 `DOC_DRIFT`→报警未处置；Layer 2 `PASS`→通过侧 / `FAIL`→未通过 / `SKIPPED`→未执行（缺席）（smoke 轮 `dist_not_built` 例外按既有 goal_loop 口径记预期缺席，仍进不通过侧但不阻断——写明）/ `UNKNOWN`→未执行（缺席）。兜底句改为「**未被本表映射的任何状态（既有或新增）一律归入不通过侧**」。三份 verification-report-template 的逐项回溯表第 3 列改「映射后落侧」。

## 三、ε-W1 / W-2 / W-4
- W-1：FR-057 例外节末加一句：`grep` 命中中属**例外条款自身**（自指）的行在产物中单列「例外条款自指 N 行」并从兜底型计数扣除，换算式写成「命中 M = 兜底型 a + 伪阳性 b + 自指 c」。
- W-2：`agents/plan.md` 同节两处对「关键量反向普查」的序号统一（保留 SKILL 副本的「mode 分层矩阵」限定语）。
- W-4：两份 `tasks-template.md`（canonical + `.specify/templates/`）新增 `## 延期承诺候选池` 节（命令原文 / 原始输出 / 池内条数 / 逐条判定与留痕 / 空池亦附命令），与 `agents/tasks.md` 第 6 步一一对应；`tasks.artifact.yaml` 的 optional_sections 加该节名（required 不加，FR-067）。

## 四、γ-C2（门禁类白名单漏散文引擎）
块 4 `gate-design-convergence-loop.md` 命中面表补三条路径 `plugins/spec-driver/agents/**`、`plugins/spec-driver/skills/**`、`plugins/spec-driver/templates/**`（路径条 4 → 7，单位：条），第 5 条改「判定器 / 守护 / 安全检查**逻辑，不论其载体是代码还是 prompt / 模板散文**」；`agents/plan.md` (ii) 门禁类升格白名单**逐字同步**（两处必须 `diff` 一致，登记为手写副本对 + 无守护残余）。

## 五、γ-C3（约束型四重免检）
- (b) `agents/plan.md` 与两份 `plan-template.md` 的「类别归属…不得在 verify 阶段临时改判」改为「**不得静默改判**；verify 可对类别提出异议并单列取值「**类别存疑**」（归不通过侧），异议须附「该 FR 是否存在一份本次要新造/改写的制品承载它」的判定与命令」；`agents/verify.md` 五态/三取值节加「类别存疑」进合并律不通过侧（合并律 7 态 → **8 态**，映射表与三份模板同步；spec 修订记录登记）。
- (a) `agents/spec-review.md` 检查项加「类别列取值抽检」：对矩阵约束型行 ≥ 3 条（或全部，若 < 3）核「是否存在承载制品」，不成立即报 CRITICAL「类别误标」。

## 六、计数更正（编排器实测，`{ git diff --name-only 26a3b15f HEAD; git status --short | awk '{print $2}'; } | sort -u | grep -vE '^specs/277|^\.codex/|skills-codex/'`）
本卡触及源文件 **66**（md 28 + yaml 20 + mjs 12 + ts 6 = 66，单位：文件；yaml 含 14 份 attack/valid fixture）；代码面（mjs + ts）**18**；再生 wrapper 8 × 2 = 16（+ 块 5 后 8 份 SKILL 全覆盖仍 16）。spec §分批·§复杂度与 plan §Project Structure 中的「源文件 36/37」「代码文件 11/12」是预估，改为实测并附命令；spec/plan 修订记录各追加一行说明「预估 → 实测」。

## 七、收口
docs:sync 幂等；repo:sync 定向回退；**串行** build → test:plugins → vitest → repo:check（预期全绿，仅 `graph-quality:freshness: warn`，check id 95）；FR-049 三判据 + `mcp__` 零输出；notes/tasks 留痕；摘要写入 `verification/fix-phaseBD-summary.md` 并回复（含 ε/γ 全部 W/I 的处置表：本轮修 / 登记）。
