# Phase D-a 摘要（T079–T086 · 收敛循环共享块 4）

> 状态：**已完成** · 2026-09-07 · 执行者：代码实现子代理
> 范围仅 D-a（T079–T086）；D-b（T087–T097）/ D-c（T098–T101）未做。
> 硬约束遵守情况：未用 `Agent` 工具、未用任何 `mcp__*` 工具、未 `git stash` / `git checkout` / 切分支、未 `git commit`；全程在 worktree `vigorous-mahavira-7de572` 内。

## 一、任务进度（8 ÷ 8 全部完成，单位：任务）

| 任务 | 状态 | 落地物 |
|------|------|--------|
| T079 | ✅ 核对通过 | plan 三处 13 / 15 逐字一致；作用域关系与裁定 D-④ 三处同步均核实 |
| T080 | ✅ 登记（不重判） | 裁定 D-③ 已定「甲 = 共享块 4」，本条按结论执行 |
| T081 | ✅ | 块 4 §分类：白名单式判据（5 条命中面 + 判不出从严 + 留痕两项） |
| T082 | ✅ | 块 4 §收敛判据：零新增、禁固定轮数、逐条对照、「轮 / 路」分列 |
| T083 | ✅ | 块 4 §止损：`R_max = 3` MUST + 承重项预先声明时点 + 放行 / 止损可区分 |
| T084 | ✅ | 块 4 §每轮输入（版本指针）+ §轮次记录字段（4 / 7 两口径分列） |
| T085 | ✅ | `spec-driver-fix/SKILL.md` 默认豁免处加例外条款（不新增门、不新增中断点） |
| T086 | ✅ | 射程外 4 个 mode 逐条登记（plan 追加式修订记录 + notes） |

## 二、改动清单

**新建 1 份**
- `plugins/spec-driver/templates/gate-design-convergence-loop.md`（**87** 行，单位：手写行）—— 块 4 单一事实源，含 6 个具名节：分类判据 / 收敛判据 / 每轮输入 / 止损 / 轮次记录字段 / 单次门内交互闭环。

**修改 5 份（源）**
- `scripts/sync-agent-docs.mjs`：`sectionConfigs` **append** 第 4 个 entry `gate-design-convergence-loop`（`targets` = feature / story / implement / fix 四份 SKILL），按 K14 排序契约追加到数组末尾，未动既有 13 个 entry。
- `plugins/spec-driver/skills/spec-driver-{feature,story,implement,fix}/SKILL.md`：各加一对 marker + 引导行；`fix` 另加 T085 例外条款。

**机器再生 8 份（`repo:sync` 产出，保留）**
- `.codex/skills/spec-driver-{feature,story,implement,fix}/SKILL.md` **4** + `plugins/spec-driver/skills-codex/spec-driver-{feature,story,implement,fix}/SKILL.md` **4**。换算式：本段射程 4 份 SKILL × 2 条分发链 = **8**（单位：wrapper 文件）。

**制品**
- `specs/277-spec-driver-engine-hardening/plan.md`：**追加式**新增小节「Phase D 段 D-a 追加登记（T086）」，未改任何既有正文。
- `specs/277-spec-driver-engine-hardening/implementation-notes.md`：偏差账本续编 **D-38 / D-39 / D-40 / D-41**；「已完成任务 ID」与「下一步」两处最小更新（覆盖写四项留给 D-c 的 T101）。
- `specs/277-spec-driver-engine-hardening/tasks.md`：T079–T086 勾选。
- `spec.md` **未改**（护栏遵守）；`repo-check-baseline.json` **未改**；`.snap` **未改**；`agents/verify.md` frontmatter **未触碰**。

## 三、锚点（`grep -n` 现取，未照抄 plan 快照）

`GATE_DESIGN` 命中行数现取值 `feature` **8** / `story` **14** / `implement` **7** / `fix` **12**（单位：命中行），与 plan 快照 2 / 8 / 1 / 6 **全部不符**，差额四式同为 **+6**（Phase A 块 2 注入所致，见偏差 D-38）。marker 实际落点：

| SKILL | 落点段 | 依据 |
|---|---|---|
| `feature` | `## Gate 决策流程（动态）` 段末 | 该 SKILL 无独立设计门禁小节，`GATE_DESIGN` 由通用 gate 决策流程求值 |
| `story` | `### Phase 2.5: 设计门禁 [GATE_DESIGN]` 段末 | 该门的专属小节 |
| `implement` | `### Phase 2: Plan Review / 计划审查 [2/6]` 段末 | `orchestration.yaml` 中 `GATE_DESIGN` 是 implement phase `2`（plan）的 `gates_before` |
| `fix` | `### Phase 2.5: 设计门禁 [GATE_DESIGN]` 段末（T085 例外条款之后） | 该门的专属小节 |

## 四、验证记录（命令原文 + 原始输出摘要）

**1) T079 三项核对**

```bash
grep -n '共 13 个文件 / 15 个改动位' plan.md
grep -n '合计 = 1+1+1+1+1+4+3+1 = 13 个文件\|合计 = 15 个改动位' plan.md
```
输出：`:1607` 标题命中；`:1621` 文件式命中；`:1630` 改动位式命中；§修订记录第 3 行（裁定 D-⑤）同载 13 / 15。**三处逐字一致 ✅**。

- **核对 (2) 两个作用域的关系（不是直接比较）**：plan §Project Structure 的「直接修改 **36** 个文件」是**全卡**按目录逐个枚举的口径（`:38` / `:1206`），Phase D 的 **13** 是**本 Phase 内**的口径；13 ⊄ 36 的差集不构成不一致，两者不得相减也不得互相冒充。**✅**
- **核对 (3) 裁定 D-④ 三处同步**：矩阵 `FR-065` 行（`:229`）列有 `agents/plan.md` ✅；Phase D 落点表第 **15** 行（`:1645`）已纳入 ✅；§Project Structure（`:1134`）标记为 `[A][B][C][D]`，含 `[D]` ✅。

**2) 注入闭环与幂等（块 4）**

```bash
npm run docs:sync:agents          # 第一跑
# → Synced shared guidance sections into AGENTS.md and CLAUDE.md (4 updated)
# 快照 4 份目标 SKILL
npm run docs:sync:agents          # 第二跑
# → (0 updated)
diff <快照> <现盘>                 # 4 份逐字节
```
四份 **identical**，逐字节 diff 零输出。**幂等 ✅**。

**3) `repo:check`（`repo:sync` + 定向回退之后）**

```bash
npm run repo:check                 # exit=0
grep -cE '^- [a-z0-9:-]+: (pass|fail|warn)$' <日志>   # → 94
```
- check id 总数 **94**（93 → 94，单位：check id）✅，与 plan 裁定 D-③ 的连带重算一致。
- `agent-docs:shared-section:gate-design-convergence-loop: **pass**` ✅（第 4 个共享块 check，自动派生、零行新守护代码）。
- 既有 13 个 `agent-docs:shared-section:*` 全 pass，**零回归** ✅。
- `spec-driver-wrappers:*` **6 项全 pass**（含 `codex-wrapper-runtime-namespace`，即散文内无 `mcp__` 字面量）✅。
- 非 pass 仅 **1** 项：`graph-quality:freshness: warn`（图产物 stale，`sourceCommit` 64b1d72f 与 HEAD 4255212c 不一致；既有状态，与本段零关系）。

**4) FR-049 三条代理判据（全部零输出 ✅）**

```bash
git diff -G'暂停'            --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   # 空
git diff -G'AskUserQuestion' --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   # 空
git diff --stat -- plugins/spec-driver/config/orchestration.yaml                 # 空
```
块 4 与 T085 例外条款全程用「门停下」「门内交互」「需要用户拍板的中断点」等等价措辞，`暂停` / `AskUserQuestion` 两个字面量在新增文本中**零出现**（D-10 / D-17 的第三次再现，性质同为**代理判据的已知副作用，不是 FR-049 被规避**——真实语义「不新增门、不新增中断点、全部轮次只走一次门内交互」由块 4 正文与 T085 例外条款正文承担，可人工复核）。

**5) T086 的实测依据**

```bash
sed -n '39,55p' plugins/spec-driver/config/orchestration.yaml
```
`GATE_DESIGN.applicable_modes` 原始输出 **7** 项：`feature / story / implement / fix / resume / sync / doc`，**不含 `refactor`**。

```bash
grep -n 'GATE_DESIGN' plugins/spec-driver/skills/spec-driver-{sync,doc,refactor}/SKILL.md ; echo "exit=$?"
```
三条命令**均零匹配行、exit=1**。`resume` 段的 `GATE_` 命中行仅 `- GATE_TASKS` / `- GATE_VERIFY` 两条。

**6) Phase B 改动完好性（要求「保留 Phase B 改动」的收口证据）**

`docs:sync:agents` 首跑输出 `(4 updated)`——即**只更新了我加 marker 的 4 份 SKILL**，`plugins/spec-driver/agents/*.md` 未被回刷；`repo:sync` 前后 `preference-rules:agent-block-sync` 与 `delegation-contract:*` 均为 pass（无待同步项）。`git diff --numstat` 现取，Phase B 的 12 份文件改动全部在盘：

```
138  7  .specify/templates/plan-template.md
 44  1  .specify/templates/tasks-template.md
 64  9  .specify/templates/verification-report-template.md
 73  3  plugins/spec-driver/agents/plan.md
  3  1  plugins/spec-driver/agents/spec-review.artifact.yaml
 56 26  plugins/spec-driver/agents/spec-review.md
 18  3  plugins/spec-driver/agents/tasks.md
200  1  plugins/spec-driver/agents/verify.md
101  0  plugins/spec-driver/templates/specify-base/plan-template.md
 28  0  plugins/spec-driver/templates/specify-base/tasks-template.md
 64  9  plugins/spec-driver/templates/specify-base/verification-report-template.md
 64  9  plugins/spec-driver/templates/verification-report-template.md
```

**7) 注入一致性（4 个目标位逐份等长）**

四份 SKILL 的 marker 区间正文行数**各为 87**，与模板 `wc -l` 的 **87** 逐份相等（单位：行）——机器注入无截断、无重复。

**未跑**：`npx vitest run` / `npm run test:plugins` / `npm run build`（按简报留给 D-c 的 T101）。

## 五、⚠️ 交给 D-c 的必办项与已知红灯

1. **K14 断言当前为红，T101 必办**：`tests/integration/spec-drift-repo-check-regression.test.ts:144-150` 的 `added` 清单仍是 **13** 项，第 `:150` 行留着注释「Phase D 落地后在此追加：`agent-docs:shared-section:gate-design-convergence-loop`（块 4 · 裁定 D-③）」。块 4 已落地，磁盘侧 check id 已达 **14**，故该断言**现在必红**（实际 14 ≠ 期望 13）——这是**预期红、不是回归**，须由 T101 按裁定 I-1 把清单更新为 14（新项位次在既有 3 个 `shared-section` 之后、`spec-driver-wrappers:*` 之前）后再跑全量。
2. **`graph-quality:freshness: warn` 属既有 stale 图**，与本段无关，T101 的「预期全绿，仅 freshness warn」口径成立。
3. **P-6 的机器注入侧上界已被击穿**（见偏差 D-41），T101 复判时须按两个单位分列如实标注 FAIL，不得合并成「大致符合」。

## 六、偏差与残余（已入 `implementation-notes.md` 账本，编号 D-38 ~ D-41）

- **D-38**：plan 的 `GATE_DESIGN` 锚点命中数快照已陈旧（现取值四式各 +6，源自 Phase A 块 2 注入）。按 T081 的「不得照抄快照」执行，plan 快照不回改。
- **D-39**：`repo:sync` 顺带重刷 **19** 份无关再生制品（`specs/products/**` 17 + `.specify/project-context.suggestions.{md,yaml}` 2），与 D-13 / D-18 **逐份计数一致**，第 **3** 次再现。已用 `git show HEAD:<path> > <path>` 定向回退 19 份（**未用 `git checkout`**），实跑计数器输出「定向回退份数 = 19」；只保留 **8** 份 wrapper。回退后 `repo:check` 94 项 exit=0，无一项因此转红。
- **D-40**：FR-023「必备字段 **4** 项」与轮次记录「完整字段 **7** 项」是两个口径，块 4 内**分列写出**并标「不得相加、不得互相冒充」。**「对抗方标识」这一项没有 FR 出处**，来源是编排器 D-a 简报，**不得**被引用为某条 FR 的达成证据。
- **D-41**：推断前提 **P-6** 的机器注入侧上界（160 ~ 240 注入行）被 D-a 单段击穿——实测 87 × 4 = **348** 注入行，超出 **108** 行；手写侧 **139** 行，Phase D 未完，须收口时按全 Phase 合计复判。三处分项估值低估的逐项归因已登记；**不为迁就上界压缩块 4 正文**（被删掉的会是反规避子句）。

**本段的残余风险（不得口径为已覆盖）**：块 4 的收敛循环散文只覆盖 **4 ÷ 6 = 66.7%** 的相关 mode（分母 = `applicable_modes` 7 项 − 零挂载的 `resume` 1 项 = **6**，单位：mode；分子 = 块 4 `targets` **4**）。`sync` / `doc` 两个 mode 在矩阵第 3 行是**条件格**、门有挂载但 SKILL 全文无 `GATE_DESIGN` 段，条件成立时的收敛循环完全依赖编排器当次是否记得调用 FR-020 —— **与本卡病根 (i) 同型，只是范围更窄**。凡把块 4 口径为「收敛循环已覆盖全部挂载 `GATE_DESIGN` 的 mode」即 over-claim。

## 七、审查档位声明

本段改动触及 `plugins/spec-driver/scripts/**` 的消费方（`scripts/sync-agent-docs.mjs`）与门禁判据散文，按块 4 自己的白名单式判据**判为门禁类**（命中第 5 条：本判据失效即收敛循环整条不执行、门照常放行 = 失效即静默放行）。按仓规，**Codex 对抗审查暂停中（配额耗尽），异构档位在本段内缺席**——D-a 段只做实现与自验，对抗审查由编排器在 commit ② 前统一组织；本文件不构成「已通过对抗审查」的声明。
