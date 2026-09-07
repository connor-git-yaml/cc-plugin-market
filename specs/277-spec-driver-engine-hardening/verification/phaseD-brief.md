# Phase D 实现简报（编排器 · 2026-09-07）· 分三段串行派发

> 执行者：代码实现子代理（角色等同 `plugins/spec-driver/agents/implement.md`）。**禁止使用 `Agent` 工具与任何 `mcp__*` 工具**。
> 项目根：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572`；禁 `git stash` / `git checkout` / 切分支；**不要 `git commit`**（commit ② = B + D，由编排器在对抗审查后执行）。
> 基线：commit ① `4255212c` + 工作区 Phase B 改动（13 文件，已由编排器核实勾选 T034–T062）。开工前 `git status --short` 看现状，**保留 Phase B 改动**。
> **返回通道可能丢失**：每段收口时把摘要 Write 到 `verification/phaseD-<段>-summary.md`。**首个动作必须是一次落盘**（哪怕只是先建 summary 骨架），前两位同事都在「读完再写」阶段被 600 s watchdog 停摆。
> 必读：`tasks.md` `## Phase D` 全文；`implementation-notes.md`（D-1~D-3x、D-B1；尤其 D-10/D-17 FR-049 代理判据词避让、D-13/D-18 repo:sync 定向回退、D-16、D-19「块 1 的 `## 轻量三纪律` 留空待 D」）；`plan.md` Phase D 落点表 + 裁定 D-③（收敛循环走共享块 4）/ D-④ / D-⑤；`spec.md` FR-008/009/020~023/025/030~034/064~066 与 `## 修订记录`（含 FR-021 止损 MUST、K14 逐 Phase 更新）。
> 通用护栏：共享块 marker 内容不手改（改源模板后跑 `npm run docs:sync:agents`，幂等判据 = 快照→二跑→逐字节 diff 为空）；`agents/verify.md` frontmatter 一字不动；散文禁 `mcp__` 字面量、禁 `暂停`/`AskUserQuestion` 字面（FR-049 代理判据，用「门停下」等措辞）；数量必写换算式 + 单位；本环境 `grep` 是 `ugrep` function（原生用 `command grep`）；SKILL 变动触发 wrapper sha ⇒ `npm run repo:sync` 后逐份甄别、用 `git show HEAD:<path> > <path>` 定向回退无关再生产物（只保留本卡 SKILL 的 wrapper）；每任务勾选 tasks.md；`implementation-notes.md` 覆盖写四项（保留偏差账本区，续编）；不改 `spec.md`；`plan.md` 只允许追加式修订记录；`repo-check-baseline.json` 禁改；不改 `.snap`。

## D-a · T079–T086（收敛循环共享块 4）
- T079：仅核对 plan 落点表已是「13 个文件 / 15 个改动位」（裁定 D-⑤），勾选留痕。
- T080：裁定已定为 **甲 = 共享块 4**（plan §修订记录 裁定 D-③），本条只登记不重判。
- T081–T084：内容**写进新建模板** `plugins/spec-driver/templates/gate-design-convergence-loop.md`（不是直接改 4 份 SKILL）：FR-020 白名单式门禁类分类判据（判不出按门禁类）；FR-021 收敛判据 = 本轮在上一轮修订产物上零新增 CRITICAL，禁固定轮数，「新增」= 逐条与上轮对照、判不出按新增；**`R_max = 3` 止损条款（MUST）**：达上限仍有新 CRITICAL ⇒ 转守**预先落盘**的承重项清单、其余登记残余、不得放行也不无限循环；FR-022 每轮输入 = 上一轮修订产物并记版本指针；FR-023 轮次记录必备字段（轮次数 / 每轮新增计数 / 与上轮对照 / 输入版本指针 / 承重项清单含预先声明时点 / 是否进入止损 / 对抗方标识）；**收敛循环在单次 GATE 停下之前闭环（FR-021，与 FR-049 相容）**。可直接以本卡 `gate-design/round-{1,2,3}-findings.md` 为格式范本。
- `scripts/sync-agent-docs.mjs` **append** 第 4 个 entry `{ key: 'gate-design-convergence-loop', sourcePath: 'plugins/spec-driver/templates/gate-design-convergence-loop.md', targets: feature/story/implement/fix 四份 SKILL }`；四份 SKILL 的 GATE_DESIGN 段末各加一对 `<!-- BEGIN/END SHARED SECTION: gate-design-convergence-loop -->`（锚点 `grep -n` 现取）；`npm run docs:sync:agents` 注入 + 幂等；`npm run repo:check` 确认 `agent-docs:shared-section:gate-design-convergence-loop: pass`，check id 93 → **94**。
- T085：`plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 既有「否则 → 自动继续（fix 模式默认豁免）」处加例外：本次改动按 FR-020 判为门禁类时，收敛循环仍在门内执行且其结论进入 GATE 日志（不新增门，不新增确认点）。
- T086：登记射程外 4 个 mode：refactor / resume = 门未挂载（既有编排事实）；sync / doc = SKILL 无 GATE_DESIGN 段、mode 矩阵条件格，条件成立时由编排器按 FR-020 在门内执行，散文缺席为残余。写进 notes 与 plan 追加式修订记录。
- 收口：`npm run repo:sync` → 定向回退无关产物 → 只保留 4 份 SKILL × 2 分发链 = 8 份 wrapper；摘要 Write 到 `verification/phaseD-a-summary.md`。**不跑全量测试**（留给 D-c）。

## D-b · T087–T097（轻量三纪律 + 承诺任务化 + FR-065）
- T087–T090：填 `plugins/spec-driver/templates/agent-output-discipline.md` 的 `## 轻量三纪律` 节（D-19 留空处）：FR-030 引用原文化两种合规形式（内联 `git show` 原文块 / 指向同 feature 目录 `evidence/*.md` 具名条目 + sha:path 指针）；FR-031 数量换算式 + 计数单位同处写出，仅给结果数字判不合格；FR-032 `[推断]`/`[INFERRED]` 复用宪法标记、每条附理由、「已核实」桶须附原始输出片段；FR-034 适用范围声明 = 全部 8 mode 强制不降级（与 spec §mode 分层矩阵第 6/7/8 行逐格一致）。改后 `docs:sync:agents` 重注入 4 份 agent + 幂等。
- T091–T092：`agents/verify.md` 写入 FR-033（每条登记的推断前提至少一条**运行时口径**验证命令，只能得「无法判定」的视为该条未通过，结论只在 verification-report 输出不回填）与 FR-066（命令须与陈述同一命题；不可证伪条目归能力边界声明、不进分母）。
- T093–T096：`agents/tasks.md` 写入 FR-008 候选池式触发面（禁措辞白名单；凡提及未来 Phase 编号/未来时态承诺一律入池，逐条显式排除并留痕，无留痕排除视为未处置）+ 入池步证据三项（命令原文 / 原始输出 / 池内条数；空池亦附）+ FR-009 阻断口径（存在未任务化承诺 ⇒ tasks 阶段不得判完成）+ FR-064 强度上限声明（裁定 D-① 择 (b)：诚实登记捕获力下界 1、不测漏报率）。
- T097：`skills/spec-driver-{fix,doc,refactor,sync}/SKILL.md` 写入 FR-065 条件格三项约束（声明「无 FR 列表 / 无关键量 / 无代码改动」须同处附判定命令与输出；门禁类改动升格为强制；判不出按成立）——写在共享块 marker 之外。
- 收口：`repo:sync` 定向回退；摘要 Write 到 `verification/phaseD-b-summary.md`。不跑全量测试。

## D-c · T098–T101（回放 + 核对 + 收口）
- T098 D-3：`verification/d3-gate-design-convergence-replay.md`（**先 Write 骨架**）：语料一 = F270 spec 阶段三轮（`evidence/historical-citations.md` §H-3 原文；3 路 → delta → delta-2，每轮都有新发现 ⇒ 逐轮判「不放行」，第三轮达 R_max 转止损而非放行；区分「轮」与「路」）；语料二 = 本卡 R1 20 → R2 16 → R3 9（承重项内）→ 核验 0，止损模式承重项 6 ÷ 6 守住；反例 = 首轮零 CRITICAL 直接放行（构造一次纯文档改动样本）。三项各附依据与换算式。
- T099 D-2 承诺任务化子项：`verification/d2-f270-commitment-pool.md`（先 Write 骨架）：`git show 8617ae3e:specs/270-compliance-evidence-ledger/plan.md` 全文入候选池（凡提及未来 Phase 编号 / 未来时态承诺），逐条判定并留痕，输出候选池全表 + 对照 `…:tasks.md` 的任务化命中；缺失条数 > 0 证明捕获力；按 FR-064 (b) 写明下界 1、不测漏报率。
- T100：块 1 适用范围声明与 spec §mode 分层矩阵第 6/7/8 行逐格核对（8 列全强制），不一致即 FR-034 未达成。
- T101 收口：**裁定 I-1**：`tests/integration/spec-drift-repo-check-regression.test.ts` 的 `added` 清单 13 → **14**（加 `agent-docs:shared-section:gate-design-convergence-loop`，位次在既有 3 个 shared-section 之后、`spec-driver-wrappers:*` 之前；注释表标「终值」）；然后**串行** `npm run build` → `npm run test:plugins` → `npx vitest run` → `npm run repo:check`（起跑前负载 1-min < 8 且无其他测试进程；预期全绿，仅 `graph-quality:freshness: warn`；check id **94**）；摘要 Write 到 `verification/phaseD-c-summary.md`；`implementation-notes.md` 覆盖写（当前 Phase「Phase D 完成 · commit ② 前」/ 已完成 / 下一步 Phase E T102 / 偏差续编）。
