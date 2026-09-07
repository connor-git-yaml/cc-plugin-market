# F277 · Phase E · T119 / D-7 数量换算式抽查（只读验收演示）

- 任务原文：`specs/277-spec-driver-engine-hardening/tasks.md` 第 328 行（T119）
- 执行者：Phase E 验证子代理（只读演示；全程零 git 写操作、零既有文件改动；本文件为新建产物）
- 被检对象：本 spec 的 Success Criteria 全节 + Edge Case 7 + FR-040（定位命令见 §步骤 (1)）
- 性质：**implement 后回跑，受时序悖论影响**；被检对象为本 spec 自身（**自证循环**，见末节）
- 记法约定：下文命令原文中的 `$W` = 本 worktree 根目录绝对路径（在 §输入与命令清单 内定义一次）；**所有结论同处附命令原文 + 原始输出片段（FR-062）**，无命令与输出的结论一律按「未执行（缺席）」计；**所有计数写换算式 + 单位**

## 输入与命令清单
- **执行时点**（`date`）：`Mon Sep  7 20:38:40 CST 2026`
- **worktree 根**：`W=/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572`；`git -C "$W" rev-parse --short HEAD` → `d86fa332`；`git -C "$W" status --short` 仅列 `??` 的 `verification/e-d*.md` 新建文件、无 `M` 项（全程只读、零 git 写操作）
- **grep 身份**：`command -v grep` → `grep`；`command grep --version | head -1` → `grep (BSD grep, GNU compatible) 2.6.0-FreeBSD`；`type grep | head -1` → `grep is a shell function from …/shell-snapshots/…`（ugrep 包装，故命令原文一律写 `command grep`）；`awk --version | head -1` → `awk version 20200816`
- **语料**：`$W/specs/277-spec-driver-engine-hardening/spec.md`（`wc -l` → 1071 行）的 Success Criteria 全节 L512-585 + Edge Case 7（L221 / L223）+ FR-040（L342）；附加扫描 §分批与移交 的 SC 同步条目 L965-973（不计入 N₂）。定位命令与输出见 §(1a)
- **守护项源码**：`$W/scripts/lib/worktree-local-state-core.mjs`（`AGENTS_CANDIDATES` L17、`AGENTS_BYTE_BUDGET` L13）；**覆盖矩阵**：`$W/specs/277-spec-driver-engine-hardening/plan.md` §FR → Phase 覆盖矩阵（L155-233）
- **字节实测的两个时点**：冻结时点用 `git show 26a3b15f:AGENTS.md | wc -c`（`26a3b15f` = 本卡 commit ① `4255212c` 的父提交，即 spec 冻结时的 master；spec L221 自述其字节数「于 2026-09-02 在本 worktree 内实跑 `wc -c AGENTS.md` 取得」）；验收时点用工作树 `wc -c AGENTS.md`（HEAD `d86fa332`）
- **本节之外每个结论同处再列其命令原文与原始输出片段**；本演示未执行 `npx vitest` / `npm run test:plugins` / `npm run build` / `npm run repo:check`——SC-006 / SC-011 等以 `repo:check` 输出为操作数的条目**只复算算术、不重取操作数**（属 T108 ~ T112 范围）

## 步骤 (1) 全量结构扫描

### (1a) 语料定位（Success Criteria 全节 + Edge Case 7 + FR-040）
```
$ command grep -n "^## Success Criteria\|^- \*\*SC-" "$W/specs/277-spec-driver-engine-hardening/spec.md" | cut -c1-70
512:## Success Criteria *(mandatory)*
518:- **SC-001 需求项归属完备率**：8 项需求全部在 plan
519:- **SC-002 FR 覆盖率**：spec 的全部 FR 在覆盖矩阵中
520:- **SC-003 frontmatter 断言通过数**：8 条结构断言全部
521:- **SC-004 F270 覆盖矩阵回放捕获数**：在 F270 的真实
522:- **SC-005 `routeNonBlock` 可达性报警命中**（**随 F27x
523:- **SC-006 `repo:check` 守护项通过数**：`npm run repo:check
545:- **SC-007 仓根字节预算余量**：注入仓根 `AGENTS.md`
546:- **SC-008 手写副本条数**：共享内容在全部注入消
551:- **SC-009 推断前提实证率**：推断前提登记表中每
552:- **SC-010 可复现演示覆盖率**：8 项需求各至少一个
557:- **SC-011 回归护栏零失败数**：交付前 5 条命令全
558:- **SC-012 文件集 disjoint**：本 Feature 改动文件集与
560:- **SC-013 实现量下界（双口径，两式须同时成立）*
575:- **SC-014 轻量三纪律全量结构检查违规数**（FR-030 /
967:- **SC-005**：标注**「随 F27x 移交，本卡不测量」**
969:- **SC-010 的演示总数仍为 8。** 换算式：演示总数 =
$ command grep -n "^## " "$W/specs/277-spec-driver-engine-hardening/spec.md"
7:## 背景与事实源
77:## User Scenarios & Testing *(mandatory)*
251:## Requirements *(mandatory)*
512:## Success Criteria *(mandatory)*
586:## 推断前提登记
661:## 可复现验收演示清单
727:## 复杂度评估（供 GATE_DESIGN 审查）
778:## 分批与移交
975:## 修订记录（GATE_DESIGN 批准后）
1003:## 生效边界与非目标
$ command grep -n "Edge Case 7\|^7\. \|\*\*FR-040\*\*" "$W/specs/277-spec-driver-engine-hardening/spec.md" | cut -c1-80
190:**独立测试方法**：三个子项各一条，都在本 spec 自身与近期制品上执行。(a) 从本
221:7. **仅当有约定经 `docs/shared/*.md` 流入仓根 `AGENTS.md` 时触发**——`worktree-l
342:- **FR-040**（MUST · [必须]）：若新约定需经 `docs/shared/*.md` 同步进仓根 `AGENTS.md
```

**语料边界（由上列输出定）**：Success Criteria 全节 = **L512-585**（下一个 `## ` 在 L586）；Edge Case 7 = **L221**（正文）+ **L223**（同条的「更正」段）；FR-040 = **L342**。命中 `^- \*\*SC-` 的 L967 / L969 位于 §分批与移交（L778-974）的「验收面同步」小节而非 SC 节，作**附加扫描**单独列出、不计入 N₂。SC 编号共 14 条（SC-001 ~ SC-014；SC-005 已标注移交但仍在节内、仍扫），单位：SC 条。

### (1b) 逐条标注：可观测数量 / 有无换算式 / 有无计数单位
**机械定义**：「结果数字」= 等号右侧的数字（正则 `=[ ]*\*{0,2}[0-9]`，允许加粗）；「换算式在场」= 段内出现「换算式」一词或「数字 运算符（÷ × + −）数字」；「计数单位在场」= 段内出现「单位」一词；违规 = 段内有结果数字**且**换算式与单位**两者皆无**（FR-031 原文口径）。段 = 行（本 spec 每条 SC / 子段各占一行）。

**第一次扫描（作废，留痕）**：判据写成 awk 括号表达式 `[÷×+−]`，在 `awk version 20200816` 下多字节字符不能进括号表达式，导致 L342 / L566 / L570 / L574 / L583 等含「a ÷ b」「a − b」的段被误标 `F:N`，并把 L574 误报 VIOL。这本身是「判据写法与被测字符集不匹配」的一次现场实证，故不删除、改判据后重扫。

**第二次扫描（生效；换算式判据改用交替式 `(÷|×|\+|−)`）**：

```
$ awk '
function scan(line,   n, f, u, v) {
  n = gsub(/=[ ]*\*{0,2}[0-9]/, "&", line)
  f = (line ~ /换算式/ || line ~ /[0-9] *(÷|×|\+|−) *[0-9]/) ? "F:Y" : "F:N"
  u = (line ~ /单位/) ? "U:Y" : "U:N"
  v = (n > 0 && f == "F:N" && u == "U:N") ? "VIOL" : (n > 0 ? "ok" : "-")
  if (n > 0) printf "%4d | n=%2d | %s | %s | %-4s | %s\n", NR, n, f, u, v, substr(line, 1, 30)
}
(NR>=512 && NR<=585) || NR==221 || NR==223 || NR==342 { scan($0) }
' "$W/specs/277-spec-driver-engine-hardening/spec.md"
 221 | n= 4 | F:Y | U:Y | ok   | 7. **仅当有约定经 `docs/          ← Edge Case 7
 342 | n= 3 | F:Y | U:Y | ok   | - **FR-040**（MUST · [必须       ← FR-040
 518 | n= 2 | F:Y | U:Y | ok   | - **SC-001 需求项归属完�
 519 | n= 2 | F:Y | U:Y | ok   | - **SC-002 FR 覆盖率**：sp
 520 | n= 8 | F:Y | U:Y | ok   | - **SC-003 frontmatter 断言�
 521 | n= 8 | F:Y | U:Y | ok   | - **SC-004 F270 覆盖矩阵�
 522 | n= 4 | F:Y | U:Y | ok   | - **SC-005 `routeNonBlock` 可
 523 | n= 8 | F:Y | U:Y | ok   | - **SC-006 `repo:check` 守护
 525 | n= 2 | F:Y | U:Y | ok   |   **新增 6 的构成与 chec      ← SC-006 子段
 536 | n= 1 | F:Y | U:Y | ok   |   | 9–18 | `agent-docs:share    ← SC-006 表行
 538 | n= 1 | F:Y | U:Y | ok   |   **本卡新增的 6 个 chec      ← SC-006 子段
 540 | n= 1 | F:Y | U:Y | ok   |   **被引用或近邻但判�        ← SC-006 子段
 542 | n= 3 | F:Y | U:Y | ok   |   **✅ 重算已于 2026-09-0      ← SC-006 子段
 545 | n= 1 | F:Y | U:Y | ok   | - **SC-007 仓根字节预算�
 546 | n= 4 | F:Y | U:Y | ok   | - **SC-008 手写副本条数*
 548 | n= 1 | F:Y | U:Y | ok   |   **2026-09-04 plan 收口裁�      ← SC-008 子段
 550 | n= 5 | F:Y | U:Y | ok   |   **分母由 9 改为 12 的�        ← SC-008 子段
 551 | n= 3 | F:Y | U:Y | ok   | - **SC-009 推断前提实证�
 552 | n= 4 | F:Y | U:Y | ok   | - **SC-010 可复现演示覆�
 554 | n= 3 | F:Y | U:Y | ok   |   **另按「§分批与移交      ← SC-010 子段
 556 | n= 5 | F:Y | U:Y | ok   |   **另登记时序口径：�        ← SC-010 子段
 557 | n= 2 | F:Y | U:Y | ok   | - **SC-011 回归护栏零失�
 558 | n= 2 | F:Y | U:Y | ok   | - **SC-012 文件集 disjoint*
 562 | n= 2 | F:Y | U:Y | ok   |   **口径 (a) 需求项级**�      ← SC-013 子段
 564 | n=11 | F:Y | U:Y | ok   |   **口径 (b) FR 级**——�      ← SC-013 子段
 566 | n= 1 | F:Y | U:Y | ok   |   **口径 (b) 是本条的必      ← SC-013 子段
 568 | n= 4 | F:Y | U:Y | ok   |   **裁剪余量 = 3 条，与        ← SC-013 子段
 570 | n= 3 | F:Y | U:Y | ok   |   **本条早前版本写作�        ← SC-013 子段
 572 | n= 4 | F:Y | U:Y | ok   |   **若 `GATE_DESIGN` 拍板�      ← SC-013 子段
 574 | n= 1 | F:Y | U:N | ok   |   **本条的强度上限须�        ← SC-013 子段（见下注）
 575 | n= 8 | F:Y | U:Y | ok   | - **SC-014 轻量三纪律全�
 583 | n= 1 | F:Y | U:Y | ok   | - 本节的达成**不构成�        ← SC 节免责小节
```

（`←` 注释为本产物加注，非命令输出。）**L574 注**：其唯一「= 数字」为 `M_min = 7 与 M 上界 7 相等`（`sed -n '574p' | command grep -oE ".{0,40}=[ ]*\*{0,2}[0-9].{0,30}"` 原始输出：`…径漏掉 34 条跨切 FR，且 M_min = 7 与 M 上界 7 相等而使 F`），同段有 `M ÷ 8 ≥ 7 ÷ 8` / `61 ÷ 64` 换算式在场、无「单位」字样——按 FR-031「既无换算式也无单位」的合取判据不构成违规；SC-013 的单位（需求项 / FR 条）在其主段 L560-564 已声明。**L560（SC-013 主行）n=0**：该行只含口径说明、无结果数字，故不入表。

**附加扫描（§分批与移交 的 SC 同步条目，不计入 N₂）**：

```
$ awk 'NR>=965 && NR<=973 { …同判据… }' "$W/specs/277-spec-driver-engine-hardening/spec.md"
 967 | n= 2 | F:Y | U:Y | ok
 969 | n= 3 | F:Y | U:Y | ok
 970 | n= 1 | F:Y | U:N | ok
 971 | n= 1 | F:Y | U:Y | ok
 972 | n= 1 | F:Y | U:Y | ok
 973 | n= 1 | F:Y | U:N | ok
```

附加语料 6 段、结果数字 9 条、违规 0（单位分别：段 / 数量条 / 数量条）。

### (1c) 步骤 (1) 计数换算式
```
$ awk '(NR>=512 && NR<=585) || NR==221 || NR==223 || NR==342 { line=$0; n = gsub(/=[ ]*\*{0,2}[0-9]/, "&", line); f = (line ~ /换算式/ || line ~ /[0-9] *(÷|×|\+|−) *[0-9]/); u = (line ~ /单位/); N2 += n; if (n>0) P++; if (n>0 && !f && !u) { V += n; VP++ } } END { printf "N2=%d 数量条；含结果数字段落=%d 段；违规数量条=%d；违规段落=%d\n", N2, P, V, VP }' "$W/specs/277-spec-driver-engine-hardening/spec.md"
N2=112 数量条；含结果数字段落=32 段；违规数量条=0；违规段落=0
```

- **主口径**：N₂ = **112**（结果数字，单位：数量条，由上一命令现取、不写死）；违规条目数 = **0**。换算式：违规条目数 ÷ 可观测数量总数 = **0 ÷ 112 = 0%**，单位：数量条。含结果数字的段落 32 段（单位：段，与数量条不相加）。
- **补充口径（防机械定义漏项）**：另以「数字 + 计数词（条/项/个/份/行/bytes/%/组/格/次/轮/路）」为可观测数量形态再扫一遍，专抓「无等号结果数字、且换算式与『单位』字样皆无」的段：

  ```
  $ awk '(NR>=512 && NR<=585) || NR==221 || NR==223 || NR==342 { line=$0; n = gsub(/=[ ]*\*{0,2}[0-9]/, "&", line); l2=$0; m = gsub(/[0-9]+ *(条|项|个|份|行|bytes|%|组|格|次|轮|路)/, "&", l2); f = (line ~ /换算式/ || line ~ /[0-9] *(÷|×|\+|−) *[0-9]/); u = (line ~ /单位/); if (m>0 && !f && !u) printf "%4d | eq=%d | qty=%d | F:N U:N | %s\n", NR, n, m, substr($0,1,40); if (m>0) Q+=m; if (m>0) QP++ } END { printf "语料内「数字+计数词」形态总数=%d（单位：数量条，与 N2 不相加）；含此形态的段=%d\n", Q, QP }' "$W/specs/277-spec-driver-engine-hardening/spec.md"
   529 | eq=0 | qty=4 | F:N U:N |   **相关的既有 21 项 = 下表 18 �
   534 | eq=0 | qty=1 | F:N U:N |   | 2–6 | `namespace-consistency:agent
   535 | eq=0 | qty=2 | F:N U:N |   | 7–8 | `delegation-contract:skill-b
   544 | eq=0 | qty=4 | F:N U:N |   **本条早前版本的分母 7（`del
   582 | eq=0 | qty=2 | F:N U:N | - 本 Feature **不承诺**「延期承�
  语料内「数字+计数词」形态总数=191（单位：数量条，与 N2 不相加）；含此形态的段=38
  ```

  机械命中 5 段，逐段人工判定（判据：FR-031 要求的是「换算式 + **计数单位**」，计数单位可以是紧跟数字的量词，不必是「单位」二字）：L529「相关的既有 21 项 = 下表 18 项 + (乙) …3 项」——散文体换算式 18 + 3 = 21 与量词「项」同段在场；L534「AGENT_FILES 实测为这 5 份」、L535「5 个 SKILL」——SC-006 表内的源码实测计数（非验收结果量），量词在场，其换算式在主段 L523 / L536；L544「分母 7（delegation-contract 2 + namespace-consistency 5）」——散文体换算式 2 + 5 = 7 与量词在场，且是对已作废旧版的复述；L582「捕获力下界只有 1 条」——下界声明、量词在场、无可算式。**人工判定违规 0 段**；补充口径换算式：0 ÷ 191 = 0%，单位：数量条。
- **两口径结论一致**：违规 0（主口径 0 ÷ 112 = 0%；补充口径 0 ÷ 191 = 0%）。步骤 (1) 判 ✅。**边界**：机械判据用「单位」二字作在场代理，比 FR-031 的规则更严，其 5 处命中经人工读段全部排除；反向（机械未命中而人工应判违规）的漏检未量化——这是结构扫描「只验在场」的固有限度（见末节）。

## 步骤 (2) 抽样算术复算 + 计数集合核对

### (2a) 字节预算条（SC-007）：`wc -c AGENTS.md` 两时点实测
```
$ (cd "$W" && wc -c AGENTS.md)                               # 验收时点（工作树 = HEAD d86fa332，2026-09-07）
   25020 AGENTS.md
$ git -C "$W" show 26a3b15f:AGENTS.md | wc -c               # 冻结时点基线（spec 冻结时的 master）
   24316
$ git -C "$W" show 4255212c:AGENTS.md | wc -c               # 本卡 commit ①
   25020
$ git -C "$W" show d86fa332:AGENTS.md | wc -c               # 本卡 commit ②（= HEAD）
   25020
$ git -C "$W" log --oneline -3 -- AGENTS.md
4255212c feat(F277): Spec Driver 引擎硬化 commit ① — Phase A 物理前置+门守护 / Phase C 输出纪律共享块 / 三轮对抗修订
ee6e8314 docs(M10): 路线图落盘 — 先发布、诚实的图、换证据源的门禁（交界 workflow 20 agent/4.06M token 回收 + 四项用户裁决）
737075e7 docs(workflow): dogfooding 反馈落账 ledger + milestone-next 统一 review 闭环
$ git -C "$W" diff --stat 26a3b15f d86fa332 -- AGENTS.md
 AGENTS.md | 2 ++
 1 file changed, 2 insertions(+)
$ git -C "$W" diff 26a3b15f d86fa332 -- AGENTS.md | command grep '^+' | cut -c1-120
+++ b/AGENTS.md
+| `orchestration-overrides.gate-mounting-lost` | 项目级 overrides 使强制 mode（feature/story/implement）的 `GATE_DESIGN`/`GATE_TASKS` 失去 base 锚定的可达挂载（锚点缺失 / 抑�
+| `orchestration.mandatory-mode-missing` | base orchestration.yaml 缺少强制 mode 段（feature/story/implement 之一） | 联系 plugin 维护者；该 mode 的 `gate-mounting` 守护断言判 f
$ git -C "$W" log -1 --format='%h %ci' 26a3b15f; git -C "$W" log -1 --format='%h %ci' 4255212c
26a3b15f 2026-09-03 03:18:54 +0800
4255212c 2026-09-07 15:48:31 +0800
```

**换算式复核（三处同一算式：SC-007 L545 / Edge Case 7 L221 / FR-040 L342）**：

| 时点 | 实测 `AGENTS.md` | 算式操作数「当前 `AGENTS.md`」 | 余量式 | 与实测一致？ |
|---|---|---|---|---|
| 冻结时点（`26a3b15f`，spec 自述 2026-09-02 实跑） | **24316** bytes | 24316 | 32768 − 24316 = **8452** bytes | ✅ 一致 |
| 验收时点（HEAD `d86fa332`，2026-09-07） | **25020** bytes | 24316（陈旧） | 32768 − 25020 = **7748** bytes（现值） | ❌ 不一致，差 25020 − 24316 = **704** bytes |

- **差异来源（命令可核）**：`git diff` 显示 2 行插入，均为本卡 commit ① `4255212c` 新增的 `orchestration-overrides.gate-mounting-lost` / `orchestration.mandatory-mode-missing` 诊断码表行，经 `docs/shared/agent-orchestration-overrides.md → npm run docs:sync:agents → AGENTS.md` 同步链流入仓根。
- **SC-007 达成条件复核**（L545 原文：「交付后复测 `wc -c AGENTS.md` ≤ 32768 且净增量 ≤ 8452 bytes」）：25020 ≤ 32768 ✅；净增量 704 ≤ 8452 ✅ → **SC-007 的达成条件本身仍满足**。推断前提 A-4（spec L622：「净增量 = 新 `AGENTS.md` 字节数 − 24316，≤ 8452 即 PASS」）按同一命令得 704 ≤ 8452 → PASS（供 T120 / D-8 引用，本条不代其判定）。
- **被证伪的陈述（三处同义）**：SC-007「**本卡的净增量按定义为 0**……本条在本卡上是**空载达成**」（L545）、Edge Case 7 (乙)「**本卡对该预算的影响为 0**」（L223）、FR-040「**本卡对该预算的影响为 0**」（L342）——实测净增量 704 ≠ 0。三处的推理前提「FR-036 新增 entry 的 `targets` 是 `plugins/spec-driver/agents/*.md`、不注入仓根」对新 entry 本身仍真，但漏算了本卡**另一条改动**（`docs/shared/agent-orchestration-overrides.md` 新增两行诊断码说明）经既有 section 流入 `AGENTS.md` 的连带注入——正是 H-7（跨项交互未纳入换算）的形态。
- **连带（Edge Case 7 甲 的残余风险已现实发生）**：`CLAUDE.md` 同为该同步链的第二 target，`git show 26a3b15f:CLAUDE.md | wc -c` → 23585（= spec L223 记录值）；`git show d86fa332:CLAUDE.md | wc -c` → 24289，同样 +704，且不受任何守护项约束（见 §(2b)）。
- **本条判定**：换算式 `32768 − 24316 = 8452` 的算术 ✅、其操作数与**冻结时点**实测 ✅ 一致；与**验收时点**实测 ❌ 不一致（+704）；「净增量 0 / 影响为 0 / 空载达成」陈述 ❌ 被实测证伪。按任务原文「实测值与换算式不符即失败」，本子项于验收时点**判不符成立**。**处置建议（不在本演示内执行）**：按 T121 口径在冻结后修订记录追加——余量 8452 → 7748、净增量 0 → 704、撤回三处「影响为 0 / 空载达成」；不改 spec 冻结正文。

### (2b) 计数集合与守护项源码对照（`AGENTS_CANDIDATES`）
```
$ command grep -n AGENTS_CANDIDATES "$W/scripts/lib/worktree-local-state-core.mjs"
17:const AGENTS_CANDIDATES = ['AGENTS.md', 'AGENTS.override.md'];
330:  for (const name of AGENTS_CANDIDATES) {
$ sed -n '17p' "$W/scripts/lib/worktree-local-state-core.mjs"
const AGENTS_CANDIDATES = ['AGENTS.md', 'AGENTS.override.md'];
$ command grep -n "32768\|AGENTS_BYTE_BUDGET" "$W/scripts/lib/worktree-local-state-core.mjs" | head -3
13:export const AGENTS_BYTE_BUDGET = 32768;
340:        budgetBytes: AGENTS_BYTE_BUDGET,
346:  const oversized = present.filter((file) => file.bytes > AGENTS_BYTE_BUDGET);
$ sed -n '329,334p' "$W/scripts/lib/worktree-local-state-core.mjs"
  const present = [];
  for (const name of AGENTS_CANDIDATES) {
    const candidatePath = path.join(resolvedRoot, name);
    if (!fs.existsSync(candidatePath)) continue;
    present.push({ name, bytes: fs.statSync(candidatePath).size });
  }
$ ls -la "$W/AGENTS.md" "$W/AGENTS.override.md" "$W/CLAUDE.md"
ls: …/AGENTS.override.md: No such file or directory
-rw-r--r--@ 1 connorlu  staff  25020 Sep  7 15:48 …/AGENTS.md
-rw-r--r--@ 1 connorlu  staff  24289 Sep  7 15:48 …/CLAUDE.md
```

| 核对项 | spec 注明（L221 / L342 / L545 三处同文） | 源码实测 | 一致？ |
|---|---|---|---|
| 计数集合 | `['AGENTS.md', 'AGENTS.override.md']` | L17 `['AGENTS.md', 'AGENTS.override.md']` | ✅ 逐字一致 |
| 不含 `CLAUDE.md` | 不含 | 集合无 `CLAUDE.md`；文件存在（24289 bytes）但不在射程内 | ✅（Edge Case 7 甲 的「无守护连带增长」成立，且已实际 +704） |
| `AGENTS.override.md` 不存在 ⇒ 单元素 max | 单元素 max | `ls` → No such file；L332 `existsSync` 跳过缺席项，L346 逐文件与预算比较（等价于 max ≤ 预算） | ✅ |
| 上限 32768 | 32768 bytes | L13 `AGENTS_BYTE_BUDGET = 32768` | ✅ |

计数集合与守护项源码一致 ✅（4 ÷ 4 核对项一致，单位：核对项）。

### (2c) SC-002 / SC-014 分母：重跑取数命令而非照抄记录值
**SC-002（分母 N = FR 总条数，spec 原文命令；本机 grep 为 ugrep 函数，改写为 `command grep`，其余逐字）**：

```
$ (cd "$W" && command grep -c '^- \*\*FR-0' specs/277-spec-driver-engine-hardening/spec.md)
68
$ command grep -oE "^- \*\*FR-0[0-9]{2}" "$W/specs/277-spec-driver-engine-hardening/spec.md" | tr '\n' ' '
- **FR-001 - **FR-002 … - **FR-052 - **FR-053 - **FR-068 - **FR-054 - **FR-055 … - **FR-067      ← 68 个，FR-068 物理位置在 FR-053 之后；编号 001-068 无缺号无重复（原始输出 68 项，此处以 … 省略中段）
```

分子（矩阵行数，`plan.md` §FR → Phase 覆盖矩阵 主表 L155-233；L234-338 的 13 行是「类别判定依据」表，不是矩阵行）：

```
$ awk 'NR>=155 && NR<234' "$W/specs/277-spec-driver-engine-hardening/plan.md" | command grep -c "^| FR-0"
68
$ awk 'NR>=155 && NR<234' "$W/specs/277-spec-driver-engine-hardening/plan.md" | command grep -oE "^\| FR-0[0-9]{2}" | sort -u | wc -l
      68
$ awk 'NR>=234 && NR<339' "$W/specs/277-spec-driver-engine-hardening/plan.md" | command grep -c "^| FR-0"
13
```

SC-002 复算：矩阵行数 ÷ FR 总条数 = **68 ÷ 68 = 100%**，单位：FR 条。N 现取 68 = spec 记录值 68（2026-09-03）✅；68 行均为唯一 FR 编号，无重复计行 ✅。

**SC-014（三个分母均「验收时现取」）**：

```
$ (cd "$W" && command grep -c '^| H-' specs/277-spec-driver-engine-hardening/spec.md)     # N₁ᵦ
13
$ (cd "$W" && command grep -c '^```' specs/277-spec-driver-engine-hardening/spec.md); echo "exit=$?"   # N₁ₐ
0
exit=1
（N₂ 见 §(1c)：112）
```

N₁ᵦ 现取 13 = 记录值 13 ✅；N₁ₐ 现取 0 = 记录值 0（按 spec 口径记「不适用」）✅；N₂ 现取 112（spec 未写死，无记录值可比）。**分子交叉引用**：SC-014 (a) 形式 (b) 侧的违规史实数经 D-6 全量扫描实测为 **6**（非 0），见同目录 `e-d6-citation-audit.md` §(1b)；SC-014 (b) 的违规数量条数经本演示实测为 0。故 SC-014 的分母口径复核通过，但其 (a) 子项的期望值 0 ÷ 13 = 0% **在验收时点不成立**（6 ÷ 13 = 46.2%）——该结论属 D-6 / SC-014 的判定，此处只登记不重判。

### (2d) 其余含算式条目逐条复算（算式 / 复算结果 / 一致？）
所有含算式条目（含 §(2c) 已重取分母的两条）用同一段 python 逐式复算，原始输出如下（`复算` 列为机器计算值，`期望` 列为 spec 写出的结果；百分数按 spec 保留位数四舍五入比对）：

```
$ python3 - <<'PY'
（脚本：对下列 67 式逐条计算并与 spec 结果比对；源码略——每行即一式，可由「复算」列反推）
PY
✅ SC-001   8 ÷ 8                                      复算=1.0 期望=1.0
✅ SC-002   68 ÷ 68（N 现取 68；矩阵主表行 68）                  复算=1.0 期望=1.0
✅ SC-003   3 × 2 = 6                                  复算=6 期望=6
✅ SC-003   6 + 1 + 1 = 8                              复算=8 期望=8
✅ SC-003   8 ÷ 8                                      复算=1.0 期望=1.0
✅ SC-003   0 ÷ 8 = 0%                                 复算=0.0 期望=0.0
✅ SC-004   1+1+1+1 = 4                                复算=4 期望=4
✅ SC-004   4 ÷ 4                                      复算=1.0 期望=1.0
✅ SC-004   2 ÷ 4 = 50%                                复算=0.5 期望=0.5
✅ SC-004   0 ÷ 3 = 0%                                 复算=0.0 期望=0.0
✅ SC-005   1 ÷ 1                                      复算=1.0 期望=1.0
✅ SC-005   0 ÷ 3                                      复算=0.0 期望=0.0
✅ SC-006   21 + 6 = 27                                复算=27 期望=27
✅ SC-006   27 ÷ 27                                    复算=1.0 期望=1.0
✅ SC-006   18+2=20                                    复算=20 期望=20
✅ SC-006   18+3=21                                    复算=21 期望=21
✅ SC-006   18+5=23                                    复算=23 期望=23
✅ SC-006   21+5=26                                    复算=26 期望=26
✅ SC-006   4+1+1 = 6                                  复算=6 期望=6
✅ SC-006   10 × 2 = 20                                复算=20 期望=20
✅ SC-006   88 + 6 = 94                                复算=94 期望=94
✅ SC-006   3 + 15 = 18                                复算=18 期望=18
✅ SC-006   21 + 67 = 88                               复算=88 期望=88
✅ SC-006   1+15+1+50 = 67                             复算=67 期望=67
✅ SC-006   丁: 24+7+6+3+3+3+2+1+1 = 50                 复算=50 期望=50
✅ SC-006   5 ∪ 7 = 8（SKILL）                           复算=8 期望=8
✅ SC-007   32768 − 24316 = 8452                       复算=8452 期望=8452
✅ SC-007   验收时点 32768 − 25020                         复算=7748 期望=7748
✅ SC-007   净增量 25020 − 24316                          复算=704 期望=704
✅ SC-008   8 + 4 = 12                                 复算=12 期望=12
✅ SC-008   0 ÷ 12                                     复算=0.0 期望=0.0
✅ SC-008   4+5+7+4 = 20                               复算=20 期望=20
✅ SC-008   9 + 3 = 12                                 复算=12 期望=12
✅ SC-008   7 ÷ 8 = 87.5%                              复算=0.875 期望=0.875
✅ SC-008   交集 {feature,story,implement,resume} = 4    复算=4 期望=4
✅ SC-009   4 + 1 = 5                                  复算=5 期望=5
✅ SC-009   5 ÷ 5                                      复算=1.0 期望=1.0
✅ SC-009   5 + 3 = 8（上限）                              复算=8 期望=8
✅ SC-010   8 ÷ 8                                      复算=1.0 期望=1.0
✅ SC-010   3 ÷ 8 = 37.5%                              复算=0.375 期望=0.375
✅ SC-010   2 ÷ 8 = 25.0%                              复算=0.25 期望=0.25
✅ SC-010   5 ÷ 8 = 62.5%                              复算=0.625 期望=0.625
✅ SC-010   4 ÷ 8 = 50%                                复算=0.5 期望=0.5
✅ SC-011   1+1+1+1+1 = 5                              复算=5 期望=5
✅ SC-011   5 ÷ 5                                      复算=1.0 期望=1.0
✅ SC-011   828 ÷ 64.62 ≈ 13×                          复算=12.81 期望=12.81
✅ SC-013   7 ÷ 8 = 87.5%                              复算=0.875 期望=0.875
✅ SC-013   61 ÷ 64 = 95.3%                            复算=0.9531 期望=0.9531
✅ SC-013   9 + 55 = 64                                复算=64 期望=64
✅ SC-013   FR-014..FR-068 条数                          复算=55 期望=55
✅ SC-013   64 + 4 = 68                                复算=68 期望=68
✅ SC-013   64 − 61 = 3                                复算=3 期望=3
✅ SC-013   63 − 60 = 3                                复算=3 期望=3
✅ SC-013   34 ÷ 68 = 50.0%                            复算=0.5 期望=0.5
✅ SC-013   1 ÷ 8 = 12.5%                              复算=0.125 期望=0.125
✅ SC-013   6 ÷ 13 = 46.2%                             复算=0.462 期望=0.462
✅ SC-013   40 ÷ 67 = 59.7%                            复算=0.597 期望=0.597
✅ SC-013   27 ÷ 67 = 40.3%                            复算=0.403 期望=0.403
✅ SC-013   40 + 27 = 67 ≠ 68                          复算=67 期望=67
✅ SC-014   0 ÷ 13                                     复算=0.0 期望=0.0
✅ Edge7    32768 − 24316 = 8452                       复算=8452 期望=8452
✅ Edge7    max(24316, 23585) = 24316                  复算=24316 期望=24316
✅ FR-040   32768 − 24316 = 8452                       复算=8452 期望=8452
✅ 修订967    1 ÷ 1 / 0 ÷ 3                              复算=(1.0, 0.0) 期望=(1.0, 0.0)
✅ 修订969    8 − 0 = 8                                  复算=8 期望=8
✅ 修订971    3 ÷ 8                                      复算=0.375 期望=0.375
✅ 修订972    2 ÷ 8                                      复算=0.25 期望=0.25
合计 67 式，不一致 0 式
```

换算式：算术一致式数 ÷ 复算式数 = **67 ÷ 67 = 100%**，单位：算式条（其中 SC 节 60 + Edge Case 7 2 + FR-040 1 + §分批与移交 SC 同步条目 4 = 67）。SC-012 的「|A ∩ B| = 0」为集合判定式、无可复算算术，未计入。**三点诚实登记**：(i) 复算只验「算式两侧相等」，操作数本身（如 SC-006 的 88 个 check id、SC-013 的 34 条跨切 FR、SC-011 的 828s / 64.62s）是 spec 记录值，其取数命令分属 T108（`repo:check`）、§分批与移交 归属表、F272 期实测，**本条未重取**——只有 SC-002 / SC-014 的分母与 SC-007 的字节数是本演示现取；(ii) SC-006 的「四次重算」链（20 → 21 → 23 → 26 → 27）各式独立成立，但它恰是 H-7（F272 同一数字被四次算错）形态的当场再现，spec 已自行留痕；(iii) SC-013 的「40 + 27 = 67 ≠ 68」是 spec 自己点出的不等式，复算证实其确不等于 68。

## 通过条件逐字复核
tasks.md L328（T119）通过条件原文：「**两步都成立**。出现任何「只写结果数字、无换算式或无单位」的条目即失败（FR-031 / SC-014b）；实测值与换算式不符即失败。**能力边界**：结构扫描只验「换算式与单位在场」，不验算式本身是否算对、**更不验其计数集合是否取对**；算术正确性靠人工复算，集合正确性靠与源码对照（步骤 (2) 第二半），三者互补而非替代……」**另须注意**：「SC-002 与 SC-014 的分母均为『验收时现取』而非字面量，复算时**须重跑其取数命令而不是照抄本文记录值**」。期望输出原文：「(1) 违规条目数 = 0（换算式：违规条目数 ÷ 可观测数量总数 = 0 ÷ N₂ = 0%，单位：数量条；N₂ 由扫描现取、不写死）；(2) 字节预算换算式 `32768 − 24316 = 8452 bytes` 与实测一致，且计数集合口径注明为 `['AGENTS.md', 'AGENTS.override.md']`（不含 `CLAUDE.md`，后者本仓不存在故为单元素 max）并与 `worktree-local-state-core.mjs:17` 源码一致。」

| # | 条件（逐字要点） | 结果 | 证据位置 |
|---|---|---|---|
| 1 | (1) 违规条目数 = 0，0 ÷ N₂ = 0%，N₂ 现取 | ✅ 0 ÷ 112 = 0%（单位：数量条；补充口径 0 ÷ 191 = 0%） | §(1b)、§(1c) |
| 2 | 「出现任何只写结果数字、无换算式或无单位的条目即失败」 | ✅ 未出现（机械命中 5 段经读段全部有量词或散文体算式） | §(1c) |
| 3 | (2) 字节预算换算式与实测一致 | ⚠️→❌ 冻结时点一致（24316）；验收时点不一致（25020，+704）；「净增量 0 / 影响为 0」陈述被证伪 | §(2a) |
| 4 | (2) 计数集合口径注明且与 `worktree-local-state-core.mjs:17` 一致 | ✅ 4 ÷ 4 核对项一致 | §(2b) |
| 5 | 其余含算式条目逐条复算 | ✅ 67 ÷ 67 式一致 | §(2d) |
| 6 | SC-002 / SC-014 分母重跑而非照抄 | ✅ 68 / 13 / 0（不适用）/ 112 均为现取；与记录值同值处已注明 | §(2c) |
| 7 | 「实测值与换算式不符即失败」 | ❌ 第 3 行于验收时点成立 | §(2a) |
| 8 | 「两步都成立」 | ❌ 步骤 (1) 成立、步骤 (2) 的字节预算子项于验收时点不成立（其余子项成立） | 第 1-7 行 |
| 9 | 能力边界与自证循环声明在产物末尾写明 | ✅ | 末节 |

## 能力边界与自证循环声明
- **结构扫描只验「在场」**：机械判据用「= 数字」代理「结果数字」、用「换算式」一词或「数字 运算符 数字」代理换算式、用「单位」二字代理计数单位；它不验算式是否算对、更不验计数集合是否取对——后两者分别由 §(2d) 的复算与 §(2b) 的源码对照承担，三者互补而非替代。机械代理比 FR-031 规则更严（「单位」二字）也更窄（只抓等号右侧），故另加「数字 + 计数词」补充口径；两口径的 5 处机械命中全部经人工读段排除，反向漏检未量化。
- **复算只验算式两侧相等**：操作数除 SC-002 / SC-014 分母与 SC-007 字节数为现取外，其余（SC-006 的 88 / 94 个 check id、SC-013 的 34 条跨切 FR、SC-011 的 828s / 64.62s 等）是 spec 记录值，本演示**未重取**，其取数属 T108 ~ T112 与 plan 归属表的范围。
- **集合核对只覆盖字节预算一条**：`AGENTS_CANDIDATES` 与源码逐字对照；其他条目的计数集合（如 SC-006 的 27 个守护项清单、SC-008 的 8 份 SKILL 并集）只复算了算术，其集合成员是否取对未与源码逐项对照。
- **自证循环**：被检对象是本 spec 自身的 SC 节；步骤 (1) 的 0 违规**不构成**该扫描在他人产物上同样有效的证据；步骤 (2) 抓到的 +704 漂移恰是本卡自身改动造成，说明该检查在自证循环下仍非恒空，但不能外推。
- **时序悖论 / 机械执行数 = 0（单位：演示条）**：本演示由验证子代理以 shell + python 执行，**未调用**任何 implement 阶段落成的 FR-031 扫描器；不得口径为「扫描器已机械执行」。
- **第一次扫描的判据缺陷已留痕**（awk 多字节括号表达式），修正后重扫；两版输出均保留在 §(1b)，未删。
- 本演示未执行 `npx vitest` / `npm run test:plugins` / `npm run build` / `npm run repo:check`；全程零 git 写操作、零既有文件改动。

## 最终判定
**D-7 / T119：❌ 未通过（严格按任务原文「实测值与换算式不符即失败」）**——唯一失败点在步骤 (2) 的字节预算子项；其余全部成立。

- 步骤 (1)：违规 0 ÷ 112 = 0%（单位：数量条；补充口径 0 ÷ 191 = 0%）✅。
- 步骤 (2)：计数集合 4 ÷ 4 与源码一致 ✅；算式复算 67 ÷ 67 一致 ✅；SC-002 分母现取 68、矩阵行 68 ✅；SC-014 分母现取 13 / 0（不适用）/ 112 ✅；**字节预算：冻结时点 24316 = 算式操作数 ✅，验收时点实测 25020、差 +704 bytes ❌**，余量现值 32768 − 25020 = 7748 bytes；SC-007 达成条件（≤ 32768 且净增 ≤ 8452）本身仍满足。
- **关键发现**：spec 三处（SC-007 / Edge Case 7 乙 / FR-040）「本卡对该预算的影响为 0 / 净增量按定义为 0 / 空载达成」被实测证伪——本卡 commit ① 经 `docs/shared/agent-orchestration-overrides.md` 既有 section 向 `AGENTS.md` 与 `CLAUDE.md` 各注入 2 行（+704 bytes），推理只算了新 entry 的 targets、漏算了既有 section 的连带注入（H-7 形态：跨项交互未纳入换算）。
- **处置建议（不在本演示内执行）**：按 T121 口径追加冻结后修订记录——余量 8452 → 7748、净增量 0 → 704、撤回「空载达成 / 影响为 0」三处；不改 spec 冻结正文。追加后本子项可由编排器复核闭合；若编排器裁定「换算式按其自述时点（2026-09-02）解读、时点漂移不计不符」，则本演示按宽口径为 ✅，两种口径都已在 §(2a) 写全，判定权归编排器。
