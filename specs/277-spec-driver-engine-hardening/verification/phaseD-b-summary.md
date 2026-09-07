# Phase D-b 摘要（T087–T097 · 轻量三纪律 + 承诺任务化 + FR-065）

> 状态：**已完成** · 2026-09-07 · 执行者：代码实现子代理
> 范围仅 D-b（T087–T097）；D-a（T079–T086）已完成见 `phaseD-a-summary.md`，**D-c（T098–T101）未做**。
> 硬约束遵守情况：未用 `Agent` 工具、未用任何 `mcp__*` 工具、未 `git stash` / `git checkout` / 切分支、未 `git commit`；全程在 worktree `vigorous-mahavira-7de572` 内。
> **不跑全量测试**（`npx vitest run` / `npm run test:plugins` / `npm run build` 均留给 D-c 的 T101）。

## 一、任务进度（11 ÷ 11 全部完成，单位：任务）

| 任务 | 状态 | 落地物 |
|------|------|--------|
| T087 | ✅ | 块 1 §轻量三纪律 · **纪律一：引用原文化**（两种合规形式 (a)/(b) + 索引表写法 + 全量结构检查 + 两单位不得相加 + 能力边界） |
| T088 | ✅ | 块 1 · **纪律二：数量换算式与计数单位**（含**第三项「计数集合口径」** + 全量口径 `0 ÷ N` + 跨单位禁运算 + 能力边界） |
| T089 | ✅ | 块 1 · **纪律三：推断前提标记契约**（复用 `[推断]`/`[INFERRED]` + 「已核实」非自助豁免桶 + 三桶分母 + 模板一致性义务 + 回填分工）；并完成两份 `plan-template.md` 的逐条核对（结论：一致，未回改，见偏差 D-45） |
| T090 | ✅ | 块 1 · **适用范围声明**（3 行 × 8 mode = 24 格全强制 + 与条件格的分界 + 「唯一落点」反误判条款） |
| T091 | ✅ | `agents/verify.md` 新增 `#### 推断前提的逐条运行时实证`（FR-033） |
| T092 | ✅ | `agents/verify.md` 新增 `#### 证实 / 证伪命令必须与陈述同一命题`（FR-066，含三处分母核对） |
| T093 | ✅ | `agents/tasks.md` 执行流程新增第 **6** 步 · 候选池式触发面（FR-008） |
| T094 | ✅ | 同步 · 入池步证据三项 + 空池同样须附命令与输出 + 残余缺口登记 |
| T095 | ✅ | 同步 · 未任务化承诺的阻断口径（FR-009）+ `## 约束` 段新增「延期承诺任务化不变量」 |
| T096 | ✅ | 同步 · FR-064 强度上限声明（裁定 D-① 择 **(b)**，固定口径原样写入）+ 禁止条款 + 不补漏报率的理由 |
| T097 | ✅ | FR-065 三项约束写入 `spec-driver-{fix,doc,refactor,sync}/SKILL.md` **4 份**（marker 之外）+ `agents/plan.md` **1 份** plan 侧变体（裁定 D-④ 第 15 落点） |

## 二、改动清单

**源文件修改 8 份**

| 路径 | 净增行 | 内容 |
|---|---|---|
| `plugins/spec-driver/templates/agent-output-discipline.md` | **+72**（写 73 / 删占位 1） | 块 1 `## 轻量三纪律` 由留空填满：4 个具名子节 |
| `plugins/spec-driver/agents/verify.md` | **+25** | T091 的 11 行 + T092 的 14 行；**frontmatter 一字未动**（与 `HEAD` 前 6 行 `diff` 为空） |
| `plugins/spec-driver/agents/tasks.md` | **+22**（marker 区间外净增） | 新第 6 步 + `## 约束` 1 条；旧步骤 6/7 原地重编号为 7/8（净 0） |
| `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` | **+15** | FR-065 三项约束（在 `gate-design-convergence-loop` END marker 之后） |
| `plugins/spec-driver/skills/spec-driver-doc/SKILL.md` | **+15** | 同上（在 `gate-tasks-scope-cut-acceptance` END marker 之后） |
| `plugins/spec-driver/skills/spec-driver-refactor/SKILL.md` | **+15** | 同上 |
| `plugins/spec-driver/skills/spec-driver-sync/SKILL.md` | **+15** | 同上 |
| `plugins/spec-driver/agents/plan.md` | **+22** | FR-065 的 plan 侧变体（含三问判定命令表） |

手写侧换算式（单位：手写行）：`72 + 25 + 22 + 15×4 + 22 = **201**`。

**机器再生 4 份 agent（`docs:sync:agents` 重注入，保留）**
`plugins/spec-driver/agents/{implement,specify,plan,tasks}.md` 的块 1 marker 区间各由 74 行刷新为 **146** 行。注入侧换算式（单位：注入行）：块 1 增量 `72 × 4 = **288**`。

**机器再生 8 份 wrapper（`repo:sync` 产出，保留）**
`.codex/skills/spec-driver-{fix,doc,refactor,sync}/SKILL.md` **4** + `plugins/spec-driver/skills-codex/spec-driver-{fix,doc,refactor,sync}/SKILL.md` **4**。换算式：本段射程 4 份 SKILL × 2 条分发链 = **8**（单位：wrapper 文件）；其中 `fix` 的 **2** 份与 D-a 重叠（本段是二次更新），**本段新进入改动集的是 6 份**——两个数各自独立、不得相减。

**制品**
- `implementation-notes.md`：偏差账本续编 **D-42 / D-43 / D-44 / D-45 / D-46**；「已完成任务 ID」补 `T087–T097`、「下一步」整段改为 D-c（覆盖写四项仍留给 T101）。
- `plan.md`：**追加式**新增「Phase D 段 D-b 追加登记（T097）」，`git diff --numstat` = **127 added / 0 deleted**（含 D-a 的追加），**零删除即证明既有正文未被改动**。
- `tasks.md`：T087–T097 勾选；Phase D 未勾选项**只剩 T098–T101**。
- `spec.md` **未改**（`git diff --numstat` 零条目）；`repo-check-baseline.json` **未改**；`.snap` **未改**。

## 三、验证记录（命令原文 + 原始输出摘要）

**1) 块 1 注入闭环与幂等**

```bash
npm run docs:sync:agents      # 第一跑 → Synced ... (4 updated)
# 快照 4 份 agent 到 /tmp/_dbsnap
npm run docs:sync:agents      # 第二跑 → Synced ... (0 updated)
diff <快照>/<a>.md plugins/spec-driver/agents/<a>.md   # 4 份
```
四份输出 `implement / specify / plan / tasks: identical`，逐字节 diff **零输出**。**幂等 ✅**
T097 改完 `agents/plan.md` 后**复跑第三次**，仍为 `(0 updated)`——证明新节落在 marker 之外、不被注入覆盖。

**2) 注入完整性（4 个目标位逐份等长）**

```bash
wc -l plugins/spec-driver/templates/agent-output-discipline.md     # 146
# 各 agent 的 marker 区间正文行数 = END 行号 − BEGIN 行号 − 1
```
`implement` 34→181、`specify` 15→162、`plan` 34→181、`tasks` 15→162，区间正文行数**各为 146**，与模板 **146** 逐份相等（单位：行）——无截断、无重复。

**3) FR-065 四份副本逐字节一致 + 落在 marker 之外**

```bash
grep -n 'BEGIN SHARED SECTION\|END SHARED SECTION\|^### mode 条件格触发条件的三项约束$' <4 份 SKILL>
diff /tmp/_fr065.md <各份提取的 14 行>
```
新节行号 `fix:553`（END marker 551）/ `doc:772`（770）/ `refactor:232`（230）/ `sync:386`（384）——**四份全部在 marker 之后、区间之外 ✅**；`diff` 四份**全 identical ✅**。`agents/plan.md` 的新节起于 `318`，块 1 marker 区间为 `34-181`，同样在区外 ✅。

**4) `repo:sync` 与定向回退**

```bash
git status --porcelain > before ; npm run repo:sync ; git status --porcelain > after ; diff before after
```
差集 **25** 项 = 应保留 6（doc/refactor/sync × 2 分发链）+ 应回退 **19**（`specs/products/**` 17 + `.specify/project-context.suggestions.{md,yaml}` 2）。

```bash
while read -r p; do git show "HEAD:$p" > "$p"; done < /tmp/_revert.txt
```
实跑计数器输出「**定向回退份数 = 19（未用 `git checkout`）**」，与 D-13 / D-18 / D-39 **逐份计数一致**（第 4 次再现，见偏差 D-43）。

**5) `repo:check`（回退后 + 全部制品落盘后，跑了两次）**

```bash
npm run repo:check                                          # exit=0（两次）
grep -cE '^- [a-z0-9:-]+: (pass|fail|warn)$' <日志>          # → 94（两次）
```
- check id 总数 **94** ✅（与裁定 D-③ 的连带重算及 T101 的预期值一致，单位：check id）。
- 14 个 `agent-docs:shared-section:*` **全 pass**，含 `agent-output-discipline` 与 `gate-design-convergence-loop` ✅。
- `spec-driver-wrappers:*` **6 项全 pass**，含 `codex-wrapper-runtime-namespace`（即散文内无 `mcp__` 字面量）✅。
- `preference-rules:agent-block-sync` / `delegation-contract:{skill,codex-wrapper}-block-sync` 全 pass ✅（Phase B 改动完好，未被回刷）。
- 非 pass 仅 **1** 项：`graph-quality:freshness: warn`（图 `sourceCommit` `64b1d72f` ≠ HEAD `4255212c`，既有 stale 图，与本段零关系）。

**6) FR-049 三条代理判据（全部零输出 ✅）**

```bash
git diff -G'暂停'            --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   # 空
git diff -G'AskUserQuestion' --stat -- 'plugins/spec-driver/skills/*/SKILL.md'   # 空
git diff --stat -- plugins/spec-driver/config/orchestration.yaml                 # 空
```
FR-065 块全程用「升格为强制」「不接受内容触发式关闭」「判不出按成立」等措辞，两个禁字面量在新增文本中**零出现**（D-10 / D-17 的第四次再现，性质同为**代理判据的已知副作用，不是 FR-049 被规避**）。块 1 与 `agents/{verify,tasks,plan}.md` 的新增文本亦经 `grep -c 'mcp__\|AskUserQuestion'` 复核，输出**均为 0**。

**7) T089 的模板逐条核对（8 项，单位：口径条）**

```bash
for f in .specify/templates/plan-template.md plugins/spec-driver/templates/specify-base/plan-template.md; do
  sed -n "$(grep -n '推断前提登记' "$f" | head -1 | cut -d: -f1),+45p" "$f"; done
```
两份该章节**逐字相同**；与纪律三比对 **8** 项：**7 项字面一致**，第 6 项（「仅凭静态论证不足以进桶」）**靠蕴含成立**（模板门槛「只写命令而无原始输出片段者退回」蕴含之）。判「一致、无需回改模板」，该蕴含推理已如实登记为偏差 **D-45**。

**8) 护栏核验**

```bash
git diff --numstat -- specs/277-spec-driver-engine-hardening/spec.md     # 零条目
git status --porcelain | grep -c 'repo-check-baseline.json\|\.snap'      # 0
diff <(git show HEAD:plugins/spec-driver/agents/verify.md | sed -n '1,6p') <(sed -n '1,6p' plugins/spec-driver/agents/verify.md)
```
`spec.md` 未改 ✅；`repo-check-baseline.json` / `.snap` 未改 ✅；`verify.md` frontmatter **identical** ✅。

## 四、⚠️ 交给 D-c 的必办项与已知红灯

1. **K14 断言当前为红，T101 必办（预期红、不是回归）**：`tests/integration/spec-drift-repo-check-regression.test.ts:144-150` 的 `added` 清单仍是 **13** 项，`:150` 留着「Phase D 落地后在此追加」注释。块 4 已落地、磁盘侧 check id 已达 **14**，故该断言现在必红。须按**裁定 I-1** 更新为 **14**（新项位次在既有 3 个 `shared-section` 之后、`spec-driver-wrappers:*` 之前）后再串行跑 `build` → `test:plugins` → `vitest run` → `repo:check`。
2. **`graph-quality:freshness: warn` 属既有 stale 图**，T101 的「预期全绿，仅 freshness warn」口径成立。
3. **P-6 复判须两单位分列**：注入侧 Phase D 累计 **636** 行、上界 240，**已可判 FAIL**（超 396 行）；手写侧累计 **340** 行、区间 262~405，**仍在界内**但 D-c 未落，须按全 Phase 合计复判。**不得合并成一个「大致符合」**（见偏差 D-42）。
4. **T100 的逐格核对已具备输入**：块 1 §适用范围声明写的 8 个 mode 列顺序为 `feature / story / implement / fix / doc / refactor / sync / resume`，与 spec §mode 分层矩阵表头**同序**；但 T100 要求的「行号现取 + `sed -n` 取原文 + 24 格逐格断言」**本段未执行**，不得据本段声称 FR-034 已核对。
5. **T096 的第二处落点未落**：FR-064 固定口径的**两处**落点中，`agents/tasks.md` 一处已落；另一处（T099 的 D-2 演示结论处）随 D-c 执行。

## 五、偏差与残余（已入 `implementation-notes.md` 账本，编号 D-42 ~ D-46）

- **D-42**：P-6 注入侧越界扩大——Phase D 累计注入 **636** 行 vs 上界 **240**，超 **396**；手写侧 **340** 仍在界内。处置同 D-41：不回改 plan、不为迁就上界压缩正文、收口按两单位分列复判。另复核 **SC-008「手写副本数 0」**：块 1 / 块 4 两条注入链上零手写副本，**但 FR-065 确有 4 份手写副本（见 D-44）——两者是不同的量，不得互相冒充**。
- **D-43**：`repo:sync` 顺带重刷 **19** 份无关再生制品，**第 4 次再现**、逐份计数一致；已定向回退（`git show HEAD:<path> > <path>`，未用 `git checkout`）。
- **D-44**：**FR-065 是手写副本 × 4，无机器守护**——不能走共享块，因为新增第 5 个 `sectionConfigs` entry 会把 check id 由 94 推到 **95**，与裁定 I-1 给 T101 定死的「14 / 94」直接冲突。4 份**当前逐字节一致**，但漂移后 `repo:check` **不会转红**；方向与 FR-036「禁止各 SKILL 手写副本」**相反**，属被 check id 冻结约束倒逼出的形态。**凡把 FR-065 口径为「已有守护」即为 over-claim。**
- **D-45**：T089 的模板一致性核对 **8 项中 7 项字面一致、1 项靠蕴含成立**，据此判「无需回改模板」；该判定依赖一次蕴含推理而非字面比对，如实登记。
- **D-46**：T092 的「三处分母核对」写成**桶级通用形式**，未钉本卡的 `V-1~V-3` / `B-1`、`B-2` / `A-3` 编号——理由是该文件是可复用 prompt，钉死编号会在下一个 feature 上恒假，且模板用 `P-n`、本卡 spec 用 `A-n` 两套编号并存。本卡三处具体核对由 D-c / Phase E 承担；两侧**不得互相顶替**。

**本段的残余风险（不得口径为已覆盖）**

1. **FR-065 的 4 份副本无漂移守护**（D-44），这是本段最实的残余。
2. **块 1 三条纪律只落到「写作要求」层，没有任何机械检查**：全量结构检查的口径（`0 ÷ N_a` / `0 ÷ N_b` / `0 ÷ N`）写在散文里，**本卡未落地任何执行它的脚本或 check id**——执行完全依赖每次调用是否照做，**与本卡病根 (i) 同型**。凡把三条纪律口径为「已有全量结构检查」即为 over-claim：在场的是**口径**，不是**检查器**。
3. **FR-008 的捕获力下界仍是 1 条、不测漏报率**（裁定 D-① 择 (b) 的直接后果），且入池触发面**仍是措辞驱动的、形态覆盖率未测量**——两条残余**互补且分列**，已在 `agents/tasks.md` 内就地写明，**不得合并成一句「已知有局限」**。

## 六、审查档位声明

本段改动触及 `GATE_DESIGN` 分类判据的消费面（FR-065 的门禁类升格条款）与 `agents/{verify,tasks,plan}.md` 的判定散文，按块 4 的白名单式判据**判为门禁类**（命中「失效即静默放行」一条：FR-065 失效 ⇒ 覆盖矩阵与 reverse-census 两项主结构可被一句自述整体关掉、门照常放行）。按仓规，**Codex 对抗审查暂停中（配额耗尽），异构档位在本段内缺席**——D-b 段只做实现与自验，对抗审查由编排器在 commit ② 前统一组织；**本文件不构成「已通过对抗审查」的声明**。
