# F277 · Phase E · T118 / D-6 引用原文化抽查（只读验收演示）

- 任务原文：`specs/277-spec-driver-engine-hardening/tasks.md` 第 327 行（T118）
- 执行者：Phase E 验证子代理（只读演示；全程零 git 写操作、零既有文件改动；本文件为新建产物）
- 被检对象：本 spec 自身（`spec.md`）+ 最近一份 fix-report（取法见 §输入与命令清单）
- 性质：**implement 后回跑，受时序悖论影响**；被检对象含本 spec 自身（**自证循环**，见末节）
- 记法约定：下文命令原文中的 `$W` = 本 worktree 根目录绝对路径（在 §输入与命令清单 内定义一次）；**所有结论同处附命令原文 + 原始输出片段（FR-062）**，无命令与输出的结论一律按「未执行（缺席）」计

## 输入与命令清单
- **执行时点**（`date`）：`Mon Sep  7 20:38:40 CST 2026`
- **worktree 根**：`W=/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572`；`git -C "$W" rev-parse --short HEAD` → `d86fa332`；`git -C "$W" status --short` 仅列 `??` 的 `verification/e-d*.md` 新建文件、无 `M` 项（本演示全程只读，未做任何 git 写操作）
- **grep 身份**：`command -v grep` → `grep`；`command grep --version | head -1` → `grep (BSD grep, GNU compatible) 2.6.0-FreeBSD`；`type grep | head -1` → `grep is a shell function from /Users/connorlu/.claude/shell-snapshots/snapshot-zsh-1788702108542-7qmme0.sh`（ugrep 包装，故本文命令原文一律写 `command grep`）
- **语料 1**：`$W/specs/277-spec-driver-engine-hardening/spec.md`，`wc -l` → `1071`（行）
- **语料 2（最近一份 fix-report）取法**：`(cd "$W" && ls -t specs/*/fix-report.md | head -5)` 原始输出（取第 1 行）：

  ```
  specs/276-fix-compliance-p0a-residue/fix-report.md
  specs/275-fix-codex-doctor-hook-trust/fix-report.md
  specs/274-fix-global-setup-cross-worktree-freshness/fix-report.md
  specs/273-fix-load-flaky-graph-bootstrap-deadlines/fix-report.md
  specs/269-fix-ci-birpc-false-red/fix-report.md
  ```

  `ls -t` 按 mtime 排序，worktree 内 mtime = checkout 时刻、不等于成文时刻，故并列登记：按编号最大取亦为 276，两种取法一致。`wc -l -c` → `308` 行 / `33342` bytes。该文件成文 commit `26a3b15f`（`git log -1 --format='%h %ci'` → `2026-09-03 03:18:54 +0800`），**早于引用原文化纪律落地 commit `4255212c`（`2026-09-07 15:48:31 +0800`）**——此事实只作背景登记，不构成豁免（见 §最终判定）
- **文档级索引表**：`$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md`，`wc -l` → `490`（行）；spec.md 顶部 L11-L27 为其总索引表
- **抽样随机源**：`python3 -c "import random,time; s=int(time.time()); random.seed(s); print('seed', s, 'sample', sorted(random.sample(range(1,13),3)))"` → `seed 1788784859 sample [1, 6, 10]`（总体 = H-1..H-12；H-13 已由 spec 自身重归类为「非历史引用」，不入抽样总体；**实跑 `git show` 的那 1 条按事先定下的规则取三者中编号最小者 = H-1**）
- **本节之外每个结论同处再列其命令原文与原始输出片段**；本演示未执行 `npx vitest` / `npm run test:plugins` / `npm run build` / `npm run repo:check`

## 步骤 (1) 全量结构扫描

### (1a) 形式 (a) 侧——「有历史引用而无内联 `git show` 代码块」的段落数（单位：段落）
**定义（可机械复核）**：「采用形式 (a) 的历史引用段落」= 段内含围栏代码块且块内出现 `git show` 的段落；违规 = 有历史引用但无此类内联块的段落。对 spec.md：

```
$ command grep -n '^```' "$W/specs/277-spec-driver-engine-hardening/spec.md"
（无输出；exit=1）
$ command grep -c '^```' "$W/specs/277-spec-driver-engine-hardening/spec.md"
0
$ awk '/^```/{if(inb){if(hit)print "block "start"-"NR" contains git show"; inb=0; hit=0}else{inb=1;start=NR;hit=0};next} inb && /git show/{hit=1}' "$W/specs/277-spec-driver-engine-hardening/spec.md"
（无输出）
$ command grep -n "git show" "$W/specs/277-spec-driver-engine-hardening/spec.md" | cut -d: -f1 | tr '\n' ' '
11 13 15 16 17 18 19 20 21 22 23 24 25 26 27 41 116 120 149 184 190 194 213 263 283 323 503 627 669 709 787
```

读法：spec.md **零个围栏代码块**（`grep -c` = 0，单位：围栏行），31 处 `git show` 提及全部是行内反引号（总索引表 L13-L27 的「主出处」列 + 指针格式说明 / 演示描述），无一是形式 (a) 的内联原文块。

**结论（spec.md，形式 (a) 侧）**：采用形式 (a) 的历史引用段落总数 N₁ₐ(spec) = **0**（单位：段落）；违规段落数 = **0**（单位：段落）。分母为 0，按 SC-014 自身口径记「**不适用**（本文档无采用形式 (a) 的引用段落）」，**不写成 0% 或 100%**。本侧对 spec.md 的判定：✅（空载）。fix-report 语料的形式 (a) 侧见 §(1c)。

### (1b) 形式 (b) 侧——「被引史实未被索引表收录 / 首次引用处无 §H-n 指针」的史实数（单位：史实条）
**判据分两个子型**：(b-i) 被引史实未被 `evidence/historical-citations.md` 索引表收录；(b-ii) 已收录史实的首次引用处无 §H-n 指针。分母 N₁ᵦ = 索引表收录史实总数，**由扫描现取**。

**步骤 1 · 全部 §H-n 指针（父任务指定命令原文）**：

```
$ command grep -n "H-[0-9]\+" "$W/specs/277-spec-driver-engine-hardening/spec.md" | wc -l
      54
$ command grep -nE "H-[0-9]+" "$W/specs/277-spec-driver-engine-hardening/spec.md" | wc -l        # BRE \+ 与 ERE + 交叉核对
      54
$ command grep -n "H-[0-9]\+" "$W/specs/277-spec-driver-engine-hardening/spec.md" | cut -c1-90   # 前 3 行样例（54 行全文过长，行号全表见下一条命令）
11:**历史引用原文索引（13 条）**：本 spec 引用的历史结论一律按 FR-0
15:| H-1 | F270：病根 iii / v（连同 PENDING FR-030..032、snapshot-stale FR-033，�
16:| H-2 | F270：`routeNonBlock` 生产零调用点、全仓只有测试直接 import，�
$ command grep -on "H-[0-9]\+" "$W/specs/277-spec-driver-engine-hardening/spec.md" | tr '\n' ' '   # 每处出现（行号:指针）
11:H-1 11:H-13 11:H-13 11:H-13 11:H-13 15:H-1 16:H-2 17:H-3 18:H-4 19:H-5 20:H-6 21:H-7 22:H-8 23:H-9 24:H-10 25:H-11 26:H-12 27:H-13 50:H-1 75:H-1 75:H-3 75:H-2 87:H-1 99:H-2 101:H-9 111:H-4 141:H-3 149:H-3 168:H-5 184:H-6 185:H-7 186:H-8 194:H-6 227:H-11 269:H-9 306:H-3 308:H-3 310:H-3 312:H-12 318:H-13 323:H-3 432:H-9 463:H-10 521:H-1 551:H-13 552:H-1 552:H-3 552:H-2 554:H-2 588:H-13 627:H-8 627:H-13 650:H-13 665:H-1 665:H-3 665:H-2 671:H-1 681:H-2 688:H-3 696:H-13 711:H-6 722:H-13 825:H-2 970:H-2 970:H-2 970:H-2 972:H-1 972:H-3
```

**步骤 2 · 索引表条目（N₁ᵦ 现取）**：

```
$ command grep -n "^### H-" "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md"
35:### H-1 · F270：病根 iii / v 未被任何 Phase 认领，verify 却口径「已达成」
78:### H-2 · F270：`routeNonBlock` 是只被测试引用的死代码
107:### H-3 · F270：spec 阶段三轮异构对抗，每轮在上轮修订里发现新 CRITICAL
153:### H-4 · F270：两次口头叮嘱「先落盘」都被忽略
179:### H-5 · F270：手工 reverse-census 可直接作为模板
206:### H-6 · F272：一次结论转述是错的，且差点进入 master
263:### H-7 · F272：同一个数字验收量被四次算错
295:### H-8 · F264：Codex hooks 双注册根源是未经运行时验证的推断前提
320:### H-9 · F259：判据写成值枚举 ⇒ 每加一个值漏一次
355:### H-10 · F266：confirmed-zero 须测量正向证据
374:### H-11 · F186 / F238：`codex-wrapper-block-sync` 门禁教训
408:### H-12 · F229 / F256 / F257 皆为 fix 形态
431:### H-13 · F170d harness 按目标 agent 的 tools 过滤注入
$ command grep -n "^### H-" "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md" | wc -l
      13
$ (cd "$W" && command grep -c '^| H-' specs/277-spec-driver-engine-hardening/spec.md)   # SC-014 写明的 N₁ᵦ 取数命令
13
```

**N₁ᵦ = 13**（单位：史实条；两条命令同值，与 2026-09-02 记录值 13 相同——本次为现取、非照抄）。其中 H-13 已被 spec 自身重归类为「非历史引用」（spec L11：真正的历史引用为 13 − 1 = 12 条），分母仍按 SC-014 口径取索引表收录数 13。

**步骤 3 · 子型 (b-ii)：13 条史实各自首次引用处是否带指针**

```
$ command grep -on "H-[0-9]\+" "$W/specs/277-spec-driver-engine-hardening/spec.md" | awk -F: '!seen[$2]++{print $2" 首现行 "$1}' | sort -t- -k2 -n
H-1 首现行 11
H-2 首现行 16
H-3 首现行 17
H-4 首现行 18
H-5 首现行 19
H-6 首现行 20
H-7 首现行 21
H-8 首现行 22
H-9 首现行 23
H-10 首现行 24
H-11 首现行 25
H-12 首现行 26
H-13 首现行 11
$ for n in 1 2 3 4 5 6 7 8 9 10 11 12 13; do printf "H-%s: " "$n"; command grep -on "H-${n}\([^0-9]\|$\)" "$W/specs/277-spec-driver-engine-hardening/spec.md" | cut -d: -f1 | awk '$1>27' | sort -un | tr '\n' ' '; echo; done   # 总表之外的正文指针
H-1: 50 75 87 521 552 665 671 972
H-2: 75 99 552 554 665 681 825 970
H-3: 75 141 149 306 308 310 323 552 665 688 972
H-4: 111
H-5: 168
H-6: 184 194 711
H-7: 185
H-8: 186 627
H-9: 101 269 432
H-10: 463
H-11: 227
H-12: 312
H-13: 318 551 588 627 650 696 722
```

读法：13 条史实的首次出现全部落在 spec 顶部总索引表（L11-L27），该表每行自带 §H-n 与 `git show <sha>:<path>` 指针；且每条在正文另有 ≥ 1 处指针。子型 (b-ii) 违规 = **0**（单位：史实条）。指针可解析性另核：

```
$ sed -n '15,27p' "$W/specs/277-spec-driver-engine-hardening/spec.md" | command grep -oE 'git show [0-9a-f]{8}:[^` ]+' | while read -r _ _ ref; do printf "%s -> " "$ref"; if git -C "$W" cat-file -e "$ref" 2>/dev/null; then echo OK; else echo MISSING; fi; done
8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md -> OK
8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md -> OK
e01611b2:docs/design/dogfooding-feedback-ledger.md -> OK
e01611b2:docs/design/dogfooding-feedback-ledger.md -> OK
e01611b2:docs/design/dogfooding-feedback-ledger.md -> OK
e01611b2:docs/design/dogfooding-feedback-ledger.md -> OK
e01611b2:docs/design/dogfooding-feedback-ledger.md -> OK
befa5d4d:specs/264-fix-codex-hooks-distribution/fix-report.md -> OK
dfe6c479:specs/259-fix-callgraph-false-edge-guardrail/fix-report.md -> OK
3871dc04:specs/266-honest-graph-quality-gate/tasks.md -> OK
bc129d4b:specs/238-codex-wrapper-completeness/tasks.md -> OK
8d78efd7:specs/270-compliance-evidence-ledger/research/nine-round-lessons.md -> OK
e01611b2:plugins/spec-driver/templates/preference-rules.md -> OK
```

13 ÷ 13 = 100% 可解析（单位：指针条）。

**步骤 4 · 子型 (b-i)：spec 中被引史实是否都已被索引收录**——先取全部历史 Feature 编号提及，再对每处提及标注该行有无 §H-n 指针，对无指针行逐条判其史实是否已被某 H-n 覆盖：

```
$ command grep -oE "F[0-9]{3}[a-z]?" "$W/specs/277-spec-driver-engine-hardening/spec.md" | sort | uniq -c | sort -k2
   9 F170d
   2 F186
   1 F203
   1 F208
   2 F229
   3 F238
   2 F256
   2 F257
  13 F259
   1 F262
   4 F264
   2 F266
  92 F270
   1 F271
  12 F272
   1 F275
  42 F276
   3 F277
   1 F278
$ for f in F270 F272 F264 F259 F266 F186 F238 F229 F256 F257 F170d; do echo "--- $f ---"; awk -v f="$f" 'index($0,f){hp=($0 ~ /H-[0-9]/)?"H-ptr:Y":"H-ptr:N"; print NR" "hp}' "$W/specs/277-spec-driver-engine-hardening/spec.md" | tr '\n' ';'; echo; done
--- F270 ---
15 H-ptr:Y;16 H-ptr:Y;17 H-ptr:Y;18 H-ptr:Y;19 H-ptr:Y;33 H-ptr:N;34 H-ptr:N;35 H-ptr:N;36 H-ptr:N;37 H-ptr:N;40 H-ptr:N;50 H-ptr:Y;75 H-ptr:Y;87 H-ptr:Y;99 H-ptr:Y;101 H-ptr:Y;111 H-ptr:Y;141 H-ptr:Y;143 H-ptr:N;147 H-ptr:N;149 H-ptr:Y;155 H-ptr:N;162 H-ptr:N;168 H-ptr:Y;172 H-ptr:N;278 H-ptr:N;306 H-ptr:Y;308 H-ptr:Y;368 H-ptr:N;459 H-ptr:N;521 H-ptr:Y;522 H-ptr:N;552 H-ptr:Y;554 H-ptr:Y;570 H-ptr:N;572 H-ptr:N;583 H-ptr:N;608 H-ptr:N;658 H-ptr:N;665 H-ptr:Y;667 H-ptr:N;669 H-ptr:N;670 H-ptr:N;671 H-ptr:Y;672 H-ptr:N;676 H-ptr:N;677 H-ptr:N;680 H-ptr:N;681 H-ptr:Y;685 H-ptr:N;687 H-ptr:N;688 H-ptr:Y;689 H-ptr:N;788 H-ptr:N;825 H-ptr:Y;924 H-ptr:N;956 H-ptr:N;968 H-ptr:N;970 H-ptr:Y;971 H-ptr:N;972 H-ptr:Y;988 H-ptr:N;1039 H-ptr:N;
--- F272 ---
20 H-ptr:Y;21 H-ptr:Y;38 H-ptr:N;41 H-ptr:N;42 H-ptr:N;184 H-ptr:Y;185 H-ptr:Y;194 H-ptr:Y;711 H-ptr:Y;716 H-ptr:N;
--- F264 ---
22 H-ptr:Y;46 H-ptr:N;186 H-ptr:Y;627 H-ptr:Y;
--- F259 ---
23 H-ptr:Y;101 H-ptr:Y;269 H-ptr:Y;432 H-ptr:Y;436 H-ptr:N;
--- F266 ---
24 H-ptr:Y;463 H-ptr:Y;
--- F186 ---
227 H-ptr:Y;
--- F238 ---
25 H-ptr:Y;227 H-ptr:Y;
--- F229 ---
26 H-ptr:Y;312 H-ptr:Y;
--- F256 ---
26 H-ptr:Y;312 H-ptr:Y;
--- F257 ---
26 H-ptr:Y;312 H-ptr:Y;
--- F170d ---
27 H-ptr:Y;318 H-ptr:Y;551 H-ptr:Y;588 H-ptr:Y;627 H-ptr:Y;650 H-ptr:Y;696 H-ptr:Y;
```

未入索引的编号（F203 / F208 / F262 / F271 / F275 / F278）与在途编号 F276 的上下文另以 `command grep -noE ".{0,110}F(203|208|262|271|275|278)([^0-9]|$).{0,110}"` 取出（原始输出：L39 F271 账本 `:81` 行 / L149 F208 / L658 F278 / L786 「近 13 个 feature F262–F275」/ L1067 F203；F275 仅出现在 L786 区间标签内）。**F276 的 42 处提及全部是「并行在途 Feature 的文件集 disjoint」约束（FR-051 / SC-012 / A-1 等），索引自述第 3 条已把在途 Feature 排除出历史引用口径，本演示沿用；F277 为自指。**

**无指针行的逐行人工判定（47 行；命令 `sed -n "${ln}p" spec.md | command grep -oE ".{0,150}F(270|272|…)([^0-9]|$).{0,150}"` 取上下文，原始输出过长不复制，判定依据写在「理由」列）**：

| 判定 | 行 | 理由 |
|---|---|---|
| 已覆盖（同一史实后续引用；首引在 L11-27 总表带指针） | 33 `:133` / 87 / 459 / 570 / 924 / 671-672 | H-1（静默裁剪 CRITICAL-7；「13 达成 / 真达成 6」在 H-1 片段 B） |
| 已覆盖 | 278 / 522 / 583 / 676-681 / 825 / 968 / 970-971 | H-2（`routeNonBlock` 语料） |
| 已覆盖 | 35 `:115` / 143 / 147 / 155 / 162 / 685-689 / 988 | H-3（三轮轨迹 22C / 4C / delta-2；片段 B 内含「违反 F208「不 brick 会话」」，故 L149 的 F208 亦被覆盖） |
| 已覆盖 | 37 `:113` / 608 | H-4（同行前半句「6 次委派死 5 次」+ 两次叮嘱被忽略） |
| 已覆盖 | 36 `:117` / 172 | H-5 |
| 已覆盖 | 41 `:52` | H-6 |
| 已覆盖 | 42 `:68` / 716 | H-7 |
| 已覆盖 | 46 | H-8（M10 文档转引「F264 根因」） |
| 已覆盖 | 436 | H-9 |
| 非历史引用（排除） | 667 / 669 / 670 / 677 / 680 | D-1 / D-2 演示的语料取用说明，史实由 H-1 / H-2 承载 |
| 非历史引用（排除） | 786 / 788 | 本 spec §1.1-1.2 自行测量的样本区间标签（F262–F275）与 FR 数（F270 49 条），有自己的取数命令，非结论转述 |
| 非历史引用（排除） | 956 | 指 F270 spec 的 FR-012 编号，定位用 |
| **未收录（违规 V1）** | **368 / 658 / 1039** | F270「闸门判据被自家 hook / 链路 / 路径恒满足」反模式，三处引用，索引零命中 |
| **未收录（违规 V2）** | **658** | F278「防线照错方向搭」，索引零命中 |
| **未收录（违规 V3）** | **34** `:135` | F270「跨 phase『留给下一阶段』承诺无跟踪」（与 H-2 相邻但非同一史实），索引零命中 |
| **未收录（违规 V4）** | **38** `:60` | F272「纯文档短任务同样中断、stall 检测 600s 期间磁盘零产出」，索引零命中 |
| **未收录（违规 V5）** | **39** `:81` | F271「宿主反复休眠时长时后台子代理结构性不可靠（4 次 Task 死亡）」，索引零命中 |
| **未收录（违规 V6）** | **40** `:124` | F270「子代理死亡率随任务长度强相关、短任务稳定可用」（H-4 覆盖的是 `:113` 条目，非此条），索引零命中 |
| 边界 B1（严口径计违规、宽口径排除） | 1067 | 「F203 修订 #2 既有口径的接线」——引用的是既有口径的出处而非结论转述 |

**关键词级复核（V1-V6 / B1 在索引中确为零命中）**：

```
$ for kw in "恒满足" "照错方向" "承诺无跟踪" "纯文档短任务" "F271" "随任务长度" "F203" "F278"; do echo "$kw spec=$(command grep -c "$kw" "$W/specs/277-spec-driver-engine-hardening/spec.md") index=$(command grep -c "$kw" "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md")"; done
恒满足 spec=3 index=0
照错方向 spec=1 index=0
承诺无跟踪 spec=1 index=0
纯文档短任务 spec=1 index=0
F271 spec=1 index=0
随任务长度 spec=1 index=0
F203 spec=1 index=0
F278 spec=1 index=0
```

**结论（spec.md，形式 (b) 侧）**：子型 (b-i) 违规史实数 = **6**（V1 ~ V6；含边界 B1 则 7）；子型 (b-ii) 违规 = 0。换算式：形式 (b) 违规史实数 ÷ 索引表收录史实总数 = **6 ÷ 13 = 46.2%**（严口径；7 ÷ 13 = 53.8% 含边界），单位：史实条。**≠ 0%，本侧判 ❌。** 成因判断（非借口）：索引表成于 2026-09-02、以 572 行的 spec 为对象；V1-V6 所在的账本映射表（L29-46，spec 自述为「更正」新增）与 L368 / L658 / L1039 均落在其后的 R1-R3 修订与 GATE_DESIGN 批准后追加段中，索引未随之扩充——这正是 D-6 结构扫描要抓的漂移形态。

### (1c) fix-report 语料的两侧扫描
`R="$W/specs/276-fix-compliance-p0a-residue/fix-report.md"`（取法见 §输入与命令清单）。该文档**无文档级索引表、无 §H-n 指针**，故其全部历史引用只能落在形式 (a) 侧；形式 (b) 侧对它记「不适用」。

```
$ wc -l -c "$R"
     308   33342 …/specs/276-fix-compliance-p0a-residue/fix-report.md
$ command grep -n "git show" "$R"
（无输出）
$ command grep -n '^```' "$R"
163:```
166:```
$ awk '/^```/{if(inb){if(hit)print "block "start"-"NR" contains git show"; inb=0; hit=0}else{inb=1;start=NR;hit=0};next} inb && /git show/{hit=1}' "$R"
（无输出——唯一的围栏块 L163-166 不含 git show）
$ command grep -n "H-[0-9]\+" "$R"
（无输出）
$ command grep -oE "F[0-9]{3}[a-z]?" "$R" | sort | uniq -c | sort -k2
   4 F208
   1 F211
   1 F216
   1 F231
   2 F236
   1 F238
   1 F248
   4 F257
   1 F262
   2 F267
   3 F269
  24 F270
   1 F273
   1 F275
   5 F276
$ command grep -onE "F[0-9]{3}[a-z]?" "$R" | command grep -v ":F276" | cut -d: -f1 | sort -un | tr '\n' ' '
5 11 13 14 18 21 47 61 71 80 82 111 114 120 122 123 175 178 186 197 205 209 211 214 215 220 241 242 243 247 255 260 267 270 281 285 286 287 288 289 300 303 306
$ command grep -onE "F[0-9]{3}[a-z]?" "$R" | command grep -v ":F276" | cut -d: -f1 | sort -un | wc -l
      43
$ awk '/F[0-9][0-9][0-9]/{gs=($0 ~ /git show/)?"git-show:Y":"git-show:N"; hp=($0 ~ /H-[0-9]/)?"H-ptr:Y":"H-ptr:N"; print NR": "gs" "hp}' "$R" | sort | uniq -c   # 47 行（含 4 行只提 F276 自指）全部为 git-show:N H-ptr:N
     47 …: git-show:N H-ptr:N   ← 汇总写法；逐行原始输出（47 行）已实跑，全部为 "git-show:N H-ptr:N"
```

**43 个非自指段落的逐段判定**（上下文由 `sed -n "${ln}p" "$R" | command grep -oE ".{0,110}F(2[0-9]{2}|1[0-9]{2})([^0-9]|$).{0,110}"` 取出；Y = 引用了历史 Feature 的结论 / 实测 / 裁决，P = 路径、标题标签或程序性指令，B = 方法论先例引用（边界））：

| 判定 | 行（段） | 引用要点（摘） |
|---|---|---|
| Y | 5 | F270（`8617ae3e`）落了账本主链，但其集成态整体 review… |
| Y | 11 | 病根 v：F270 零实现 |
| Y | 13 | F269「报告先落盘 + PENDING + 回填」惯例未成文 |
| Y | 14 | F275 实证的新形态 |
| Y | 18 | F270 变异 M9 证实：首行改 `return 0` 只红 5 个直接 import 的单元测试 |
| Y | 47 | plan 阶段静默裁剪范围（F270 CRITICAL-7） |
| Y | 61 | F270 `research/harness-field-probe.md:204` 已核实「更普遍的并发源是单会话内部…」（有路径:行号与引文，**无 `git show <sha>` 指针**） |
| Y | 71 | F208「Stop hook 不可 brick 会话」 |
| Y | 80 | F270 换成 harness 权威 `background_tasks` 后风险源已消除 |
| Y | 82 | 「先落盘 PENDING 报告」只存在于操作习惯里（F269 现场发明） |
| Y | 111 | 无默认值 fail-loud（F238 纪律） |
| Y | 114 | F270 已建的从 canonical 表派生的同步守卫 |
| Y | 120 | F270 P-7 实测 8 进程 × 60KB 零撕裂 |
| Y | 122 | F267 已修的 TS 侧原子写 |
| Y | 175 | F208 research D2 的裁决「存储不可用 ⟹ …」 |
| Y | 178 | F257 第九轮 / F270 三轮对抗都把 `ok:false` 当环境态跳过 |
| Y | 197 | F262 实证 25+ min 懒刷盘 |
| Y | 205 / 220 / 260 | F270 移交的另 5 项（FR-043/044、FR-010、FR-011、W-9、在途相关性过滤） |
| Y | 209 / 214 / 215 | F270 未达成的 5 项 / F270 移交项（SC 对照表） |
| Y | 241 | F273 已实证的宿主休眠冻结 |
| Y | 242 | 复发 F257 缺陷 2「更安静那条成为首选绕过面」 |
| Y | 243 | F269 惯例写进 SKILL |
| Y | 247 | 撞 F208 非 brick |
| Y | 255 | F270「重大-5」尚未修 |
| Y | 270 | F270 over-claim 的根因对策 |
| Y | 281 | R-1 F270 `agent_id` 键存在性判据、writer / reader 谓词对称 |
| Y | 285 / 286 / 287 / 288 / 289 | R-5 F257 闸门三取「最早」/ R-6 F208 三档语义 / R-7 F211 补救清零 / R-8 F216 no-op 证据门 / R-9 F231 光杆命令判据 |
| Y | 300 | F270 实证单轮不够 |
| B | 21 / 123 / 186 | 「F248/F267 先例：每条先证再修」（方法论）/「F236 判定器快照」（制品标签）/「按 F257 四要素登记」（方法论） |
| P | 211 / 267 / 303 / 306 | 表头「F270 口径」/「F270 的 spec.md 不改」（指令）/ 标题「生效时点（F236）」/「连 F270 的 ledger-*.mjs 都还不在其中」（现状观察） |

换算式：Y 36 + B 3 + P 4 = 43 段（单位：段落），与命令计数 43 一致。

**结论（fix-report，形式 (a) 侧）**：采用形式 (a) 的历史引用段落总数 N₁ₐ(fix-report) = **36**（严口径；机械上界 43），其中带内联 `git show` 原文块的 = **0**，违规段落数 = **36**。换算式：36 ÷ 36 = **100%**（严口径）；43 ÷ 43 = 100%（机械上界口径）；即便只计带引号或带实测数值的具体发现（L5 / 18 / 47 / 61 / 71 / 120 / 175 / 197 / 242 / 300 共 10 段），也是 10 ÷ 10 = 100%——**任何口径下违规数均 ≠ 0**，本侧判 ❌。形式 (b) 侧：不适用（无索引表、0 指针）。

### (1d) 步骤 (1) 计数换算式（两个单位分别写、不相加）
| 侧 | 语料 | 违规数 | 分母 | 换算式 | 单位 | 判定 |
|---|---|---|---|---|---|---|
| 形式 (a) | spec.md | 0 | N₁ₐ(spec) = 0 | 分母 0 → 不适用（不写百分比） | 段落 | ✅（空载） |
| 形式 (a) | fix-report（F276） | 36 | N₁ₐ(fix) = 36 | 36 ÷ 36 = **100%** | 段落 | ❌ |
| 形式 (a) | 两份语料合计（同单位可合） | 0 + 36 = 36 | 0 + 36 = 36 | 36 ÷ 36 = **100%** | 段落 | ❌ |
| 形式 (b) | spec.md | 6（含边界 B1 则 7） | N₁ᵦ = 13 | 6 ÷ 13 = **46.2%**（7 ÷ 13 = 53.8%） | 史实条 | ❌ |
| 形式 (b) | fix-report（F276） | — | 无索引表 | 不适用 | 史实条 | — |

**两个单位（段落 / 史实条）分别成立、不相加。** 期望输出「两侧违规数均 = 0」：**不成立**（形式 (a) 侧 36 ≠ 0；形式 (b) 侧 6 ≠ 0）。

## 步骤 (2) 抽样内容核对

### (2a) 抽法（随机、可复现）
- 总体：H-1 ~ H-12（12 条；H-13 已由 spec L11 重归类为「非历史引用 → 推断前提 A-5」，不入总体）
- 命令原文与原始输出（seed 取自执行时刻 epoch 秒，事后可用同一 seed 复现）：

  ```
  $ python3 -c "import random,time; s=int(time.time()); random.seed(s); print('seed', s, 'sample', sorted(random.sample(range(1,13),3)))"
  seed 1788784859 sample [1, 6, 10]
  ```

- 抽中：**H-1 / H-6 / H-10**。实跑 `git show` 比对的那 1 条按**抽样前**写定的规则取编号最小者 = **H-1**（规则见 §输入与命令清单，非事后挑选）。

### (2b) 三条抽样逐条核对（指针 → 索引条目 → 逐字片段在场）
先由 spec 引用处的 §H-n 指针取到 `evidence/historical-citations.md` 的条目（条目行区间来自 §(1b) 步骤 2 的 `grep -n "^### H-"` 输出），再机械核「是否带 `git show <sha>:<path>` 指针 + 是否带围栏原文块」，最后人工核片段在场：

```
$ for r in "35,77" "206,262" "355,373"; do echo "--- 索引 L$r ---"; sed -n "${r}p" "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md" | command grep -c 'git show [0-9a-f]\{8\}:' | sed 's/^/含 git show <sha>:<path> 指针的行数: /'; sed -n "${r}p" "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md" | command grep -c '^```' | sed 's/^/围栏行数: /'; done
--- 索引 L35,77 ---
含 git show <sha>:<path> 指针的行数: 2
围栏行数: 4
--- 索引 L206,262 ---
含 git show <sha>:<path> 指针的行数: 3
围栏行数: 6
--- 索引 L355,373 ---
含 git show <sha>:<path> 指针的行数: 1
围栏行数: 4
```

| 抽样 | spec 引用处（指针行） | 索引条目 | `git show <sha>:<path>` 指针 | 逐字片段 | 结论 |
|---|---|---|---|---|---|
| H-1 | L15（总表）、L50 / L87 / L521 / L552 / L665 / L671 / L972 | L35-77 | 出处 A `8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md`（L159-171）；出处 B `8617ae3e:specs/270-compliance-evidence-ledger/tasks.md`（L166-172） | 2 块（12 行 + 7 行），围栏 4 行 = 2 块 | 片段在场 ✅ |
| H-6 | L20（总表）、L184 / L194 / L711 | L206-262 | 出处 A `e01611b2:docs/design/dogfooding-feedback-ledger.md`（L45-52）；出处 B `125bfdb3:specs/272-test-guard-asset-cleanup/verified-facts.md`（L83-96）| 3 块（8 + 12 + 5 行），围栏 6 行 = 3 块 | 片段在场 ✅ |
| H-10 | L24（总表）、L463 | L355-373 | 出处 A `3871dc04:specs/266-honest-graph-quality-gate/tasks.md`（L280）；出处 B 同 commit `tasks.md`（L325，条目内以「同 commit」指代、未重复写 `git show`，故指针行计 1） | 2 块（各 1 行），围栏 4 行 = 2 块 | 片段在场 ✅ |

换算式：带原文片段的抽样条数 ÷ 抽样条数 = 3 ÷ 3 = 100%，单位：抽样条。

### (2c) 其中 1 条实跑 `git show <sha>:<path>` 比对片段与原文
**H-1 · 出处 A**（索引条目 L41-58；条目自述 L58：「为压到 12 行，上段省去了原文中包住那 4 行命中数的一对 ``` 围栏行，其余逐字未改」）：

````
$ git -C "$W" show 8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md | sed -n '159,171p'
## CRITICAL-7 · 范围在 plan 阶段静默收缩（所有 over-claim 的结构性根源）

卡面 5 个病根、spec 49 条 FR，而 plan 的 6 个 Phase **没有为病根 iii、病根 v、PENDING（FR-030..032）、snapshot-stale（FR-033）安排任何 Phase**，且 `plan.md §8`「spec 与代码现状矛盾记录」**也没登记这次裁剪**。

实测命中数（plan / tasks / 生产码）：
```
FR-012 (竞态)         → 0 / 0 / 0
FR-026 (GATE)         → 0 / 0 / 0
FR-030 (PENDING)      → 0 / 0 / 0
FR-033 (snapshot-stale)→ 0 / 0 / 0
```

**这就是「勾了但没做」的机制**：plan 静默裁掉范围 → tasks 按裁剪后的 plan 写 → **SC/commit 却按未裁剪的 spec 口径报**。三者对不上而无人对账。
$ git -C "$W" show 8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md | sed -n '159,171p' > h1A-git.txt; sed -n '45,55p' "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md" > h1A-idx.txt; diff h1A-git.txt h1A-idx.txt; echo "diff exit=$?"
6d5
< ```
11d9
< ```
diff exit=1
````

读法：diff 仅差原文中的两行围栏，与条目自述的省略**逐字吻合**，其余 11 行逐字一致 → **一致 ✅**。

**H-1 · 出处 B**（索引条目 L60-71，标注 L166-172）：

```
$ git -C "$W" show 8617ae3e:specs/270-compliance-evidence-ledger/tasks.md | sed -n '166,172p' > h1B-git.txt; sed -n '64,70p' "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md" > h1B-idx.txt; diff h1B-git.txt h1B-idx.txt; echo "diff exit=$?"
0a1,2
> ### SC 诚实口径（更正 P6 自查与 commit 里的「13 达成」）
> 
6,7d7
< 
< ### 结构性根因（供后续卡引以为戒）
diff exit=1
$ git -C "$W" show 8617ae3e:specs/270-compliance-evidence-ledger/tasks.md | command grep -n "SC 诚实口径"
164:### SC 诚实口径（更正 P6 自查与 commit 里的「13 达成」）
$ git -C "$W" show 8617ae3e:specs/270-compliance-evidence-ledger/tasks.md | sed -n '164,170p' > h1B-git2.txt; diff h1B-git2.txt h1B-idx.txt; echo "diff exit=$?"
diff exit=0
```

读法：片段 7 行在原文 **L164-170 逐字在场**（diff exit=0）；索引条目标注的区间「L166-172」**偏差 2 行**（定位指针失准，内容无失真）。判：**片段与原文一致 ✅；行号标注 ⚠️**——按 T121「追加而非改写」口径，建议在冻结后修订记录里把该条目的 L166-172 更正为 L164-170，本演示不改索引文件。

**附加核对（超出任务「实跑 1 条」的要求，只增证据不改判定）**：

```
$ git -C "$W" show e01611b2:docs/design/dogfooding-feedback-ledger.md | sed -n '45,52p' > h6A-git.txt; sed -n '218,225p' "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md" > h6A-idx.txt; diff h6A-git.txt h6A-idx.txt; echo "diff exit=$?"
diff exit=0
$ git -C "$W" show 3871dc04:specs/266-honest-graph-quality-gate/tasks.md | sed -n '280p' > h10A-git.txt; sed -n '362p' "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md" > h10A-idx.txt; diff h10A-git.txt h10A-idx.txt; echo "diff exit=$?"
diff exit=0
```

H-6 出处 A（8 行）、H-10 出处 A（1 行）均逐字一致。换算式：实跑比对一致的条数 ÷ 实跑条数 = 3 ÷ 3 = 100%（任务只要求 1 ÷ 1），单位：抽样条；行号标注偏差 1 处（H-1 出处 B），单位：定位标注处，**与片段一致性分开计**。

## 通过条件逐字复核
tasks.md L327（T118）通过条件原文：「**两步都成立**。只做抽样即为双标——FR-001 对覆盖矩阵明写「不允许抽样」，同一份 spec 内对本项只做抽样核验不成立（FR-030 / SC-014a）。任一条缺片段即失败；实跑比对不一致即失败……**能力边界**：结构扫描只验「原文片段在场」，不验其内容是否与转述相符；内容正确性靠抽样人工核对，二者互补而非替代。**本演示的被检对象含本 spec 自身（自证循环）**。」期望输出原文：「(1) 两侧违规数均 = 0（换算式：形式 (a) 违规段落数 ÷ 采用形式 (a) 的历史引用段落总数 = 0 ÷ N₁ₐ = 0%；形式 (b) 违规史实数 ÷ 索引表收录史实总数 = 0 ÷ N₁ᵦ = 0%；两个分母均由扫描现取、不写死——N₁ᵦ 于 2026-09-02 实测为 13）；(2) 抽样 3 条全部带原文片段且实跑比对一致。」

| # | 条件（逐字要点） | 结果 | 证据位置 |
|---|---|---|---|
| 1 | 两步都执行（不得只做抽样） | ✅ 步骤 (1) 全量扫描 + 步骤 (2) 抽样均已执行，各附命令与原始输出 | §(1a)-(1d)、§(2a)-(2c) |
| 2 | (1) 形式 (a) 侧违规段落数 = 0（0 ÷ N₁ₐ） | ❌ spec：N₁ₐ = 0 → 不适用；fix-report：36 ÷ 36 = 100%（单位：段落） | §(1a)、§(1c)、§(1d) |
| 3 | (1) 形式 (b) 侧违规史实数 = 0（0 ÷ N₁ᵦ） | ❌ 6 ÷ 13 = 46.2%（单位：史实条；N₁ᵦ = 13 现取，与 2026-09-02 记录值相同） | §(1b)、§(1d) |
| 4 | (2) 抽样 3 条全部带原文片段 | ✅ 3 ÷ 3 = 100%（单位：抽样条） | §(2b) |
| 5 | (2) 实跑比对一致 | ✅ H-1 出处 A / B 内容逐字一致（附加 H-6 / H-10 亦一致，3 ÷ 3）；⚠️ H-1 出处 B 行号标注偏差 2 行（定位失准、内容无失真，单独计 1 处） | §(2c) |
| 6 | 「任一条缺片段即失败」 | ✅ 抽样内无缺片段 | §(2b) |
| 7 | 「实跑比对不一致即失败」 | ✅ 无不一致 | §(2c) |
| 8 | 「两步都成立」 | ❌ 步骤 (2) 成立、步骤 (1) 不成立 | 第 2、3 行 |
| 9 | 能力边界与自证循环声明在产物末尾写明 | ✅ | 末节 |

## 能力边界与自证循环声明
- **结构扫描只验「在场」**：形式 (a) 侧只看「围栏块内有无 `git show`」；形式 (b) 侧只看「史实是否被索引收录 + 首引处有无指针 + 指针对象可解析」，**不验**索引条目的片段内容是否与 spec 的转述相符（索引自报的 5 条「有偏差」是索引作者核的，本演示未复核那 13 条转述）。
- **抽样内容核对覆盖 3 ÷ 13 = 23.1%**（单位：史实条），实跑 `git show` 比对 3 条（任务要求 1 条）；其余 10 条索引片段与原文是否逐字一致**未验**。
- **「历史引用」的识别含人工判定**：spec 无指针行 47 行、fix-report 43 段的 Y / B / P 分类与 V1-V6 判定是读段后的人工结论；为此同时给出机械上界口径（fix-report 43 ÷ 43、spec 含边界 7 ÷ 13），两口径结论同向（均 ≠ 0）。反向漏检（机械与人工都没识别出的引用）未量化。
- **自证循环**：被检对象是本 spec 与本 spec 自建的索引表；本演示的失败结论**不构成**该检查在他人产物上同样有效的证据，只说明它在本卡语料上非恒空、抓到了索引成文后追加段落的漂移。
- **时序悖论 / 机械执行数 = 0（单位：演示条）**：本演示由验证子代理以 shell 命令 + 人工判定执行，**未调用**任何 implement 阶段落成的 FR-030 扫描器；产物中一切「已扫描」均指本文所列命令的实跑，不得口径为「扫描器已机械执行」。
- **语料时点**：fix-report（F276，`26a3b15f`，2026-09-03）成文早于纪律落地（`4255212c`，2026-09-07）。本演示按任务原文期望输出如实判失败、未做豁免；是否把纪律落地前的制品排除出 D-6 / SC-014 语料，属编排器 / 用户裁决，本产物不替代。
- 本演示未执行 `npx vitest` / `npm run test:plugins` / `npm run build` / `npm run repo:check`；全程零 git 写操作、零既有文件改动。

## 最终判定
**D-6 / T118：❌ 未通过**（两步中步骤 (1) 不成立）。

- 步骤 (1)：形式 (a) 侧 fix-report 36 ÷ 36 = 100% 违规（单位：段落；spec 自身 N₁ₐ = 0 不适用）；形式 (b) 侧 spec 6 ÷ 13 = 46.2% 违规（单位：史实条）。两个单位分别成立、不相加。
- 步骤 (2)：抽样 3 ÷ 3 带片段；实跑比对 3 ÷ 3 一致（任务要求 1）；附 1 处行号标注偏差（H-1 出处 B：索引写 L166-172，实为 L164-170）。
- **关键发现**：① spec 在索引成文（2026-09-02，572 行）之后追加的账本映射表（L29-46）与 L368 / L658 / L1039 引入了 6 条未入索引的史实（F270「闸门判据被自家 hook 恒满足」×3 处、F278「防线照错方向搭」、账本 `:135` / `:60` / `:81` / `:124` 四条），索引未随修订扩充；② 最近一份 fix-report 零 `git show` 原文块（成文早于纪律）；③ 索引 H-1 出处 B 的行号区间偏 2 行。
- **处置建议（不在本演示内执行）**：按 T121「追加而非改写」口径，在 `verification/` 的冻结后修订记录里登记上述 6 条待补索引条目与 1 处行号更正，不改 spec 冻结正文与索引文件；SC-014 (a) 的达成判定由编排器合并律统一收口，本产物只提供分子 6 / 分母 13 的实测。

---

## 补索引后的复扫（2026-09-07）

**前置动作**：按上节「处置建议」的「追加而非改写」口径，已在 `evidence/historical-citations.md` 末尾追加 H-14 ~ H-19（对应 V1 ~ V6，每条内联 `git show <sha>:<path> | sed -n …` 命令原文与原始输出片段）、一节「勘误」（H-1 出处 B 行号 L166-172 → L164-170，H-1 原文未动）与一节「补索引后的汇总」；索引表末尾追加 6 行。spec.md / plan.md / tasks.md 未动；零 git 写操作；未跑 vitest / test:plugins / build。

**关键词级复扫（原样重跑 §(1b) 的命令，`W` 为本 worktree 根，HEAD `d86fa332`）**：

```
$ for kw in "恒满足" "照错方向" "承诺无跟踪" "纯文档短任务" "F271" "随任务长度" "F203" "F278"; do echo "$kw spec=$(command grep -c "$kw" "$W/specs/277-spec-driver-engine-hardening/spec.md") index=$(command grep -c "$kw" "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md")"; done
恒满足 spec=3 index=10
照错方向 spec=1 index=7
承诺无跟踪 spec=1 index=5
纯文档短任务 spec=1 index=5
F271 spec=1 index=5
随任务长度 spec=1 index=5
F203 spec=1 index=0
F278 spec=1 index=9
```

**分母现取**：

```
$ command grep -c '^### H-' "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md"
19
$ command grep -c '^| H-' "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md"
19
$ command grep -c '^```' "$W/specs/277-spec-driver-engine-hardening/evidence/historical-citations.md"
96
```

**逐条复核（V1 ~ V6 → H-14 ~ H-19）**：

| 违规项 | 补入条目 | 关键词命中（index） | 指针对象可解析 | 片段现跑比对 |
|---|---|---|---|---|
| V1 F270「恒满足」（spec L368 / L658 / L1039） | H-14 | 0 → 10 | `git show 8617ae3e:specs/270-compliance-evidence-ledger/verification/integrated-review.md` L336-341 / L349-355 | 一致 |
| V2 F278「照错方向」（L658） | H-15 | 0 → 7（`F278` 0 → 9） | `git show 058c7012:specs/278-honest-tooling-patches/verification/orchestrator-verification.md` L161-162；`git show 26a3b15f:specs/276-fix-compliance-p0a-residue/plan.md` L565 | 一致 |
| V3 F270 承诺无跟踪（L34，账本 `:135`） | H-16 | 0 → 5 | `git show e01611b2:docs/design/dogfooding-feedback-ledger.md` L134-135 | 一致 |
| V4 F272 纯文档短任务（L38，账本 `:60`） | H-17 | 0 → 5 | 同上 L53-60 | 一致 |
| V5 F271（L39，账本 `:81`） | H-18 | 0 → 5 | 同上 L80-81 | 一致 |
| V6 F270 随任务长度（L40，账本 `:124`；另补登 L51） | H-19 | 0 → 5 | 同上 L123-124 | 一致 |
| B1 F203（边界，L1067） | 未补 | 0 → 0 | —— | —— |

片段现跑比对方法：以 awk 从索引文件「## 补索引（2026-09-07」起按围栏抽出 9 块（H-14 ×2、H-15 ×2、H-16 ~ H-19 各 1、勘误 1），逐块与条目所写命令的现跑输出 `diff`，**9 ÷ 9 输出为空**（单位：片段块）。账本行号口径已在索引前言登记：spec 映射表的 `:NNN` 只与 `e01611b2` 版账本对得上，HEAD 版同条目统一漂移 +73，四条逐字 diff 为空。

**换算式（形式 (b) 侧，spec.md）**：
- 不含边界 B1：形式 (b) 违规史实数 ÷ 索引表收录史实总数 = **0 ÷ 19 = 0%**（单位：史实条；N₁ᵦ 现取 = 19，换算式 13 + 6 = 19）。**本侧由 ❌ 转 ✅。**
- 含边界 B1：**1 ÷ 19 = 5.3%**——`F203 spec=1 index=0` 仍为零命中；B1 不在本次 6 条回填范围内（首扫判「严口径计违规、宽口径排除」），如实保留为非零残余，是否补录待编排器裁决。
- 形式 (a) 侧（fix-report 36 ÷ 36 = 100%）本次未触及，结论不变；D-6 / T118 的「两步都成立」总判定因此**仍不成立**（步骤 (1) 形式 (a) 侧未收口），本节只更新形式 (b) 侧的分子。

**本次复扫的能力边界**：与首扫相同——关键词命中只证「在场」，内容一致性靠 9 块 diff（覆盖 9 ÷ 9 新增片段，对既有 H-1 ~ H-13 未重跑）；H-14 / H-15 的引号短语在原 Feature 制品中逐字不可得（`git log --all -S` / `git grep` 零命中已内联于条目），以语义等价原句入索引，H-14 因此计「⚠️ 有偏差（引用形式）」；H-1 出处 B 行号偏差以勘误节登记、原文未改。本节由验证子代理以 shell 命令实跑，未调用 FR-030 扫描器。
