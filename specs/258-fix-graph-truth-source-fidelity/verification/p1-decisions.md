# P1 带证据裁决与落定记录（F258）

范围：plan §3.8 候选改良裁决（T025）、§12 中由 P1 落定的项、T003 的 current-spec 核查结论。
验证二进制口径：全程 `node dist/cli/index.js`（本 worktree 基线 `19bff52a`）；PATH 上的
`~/.volta/bin/spectra` 实测为 `v4.4.0 (0ae3eb7)`，**未使用**。

---

## T025 — plan §3.8「symlink-to-dir 条目同时登记为 dirPrefix」：**不纳入**

### 裁决

**不纳入。** KL-5 保持原样登记（`gitignore-oracle.ts` 文件头 + R1-8 钉桩测试不变）。

### 支撑证据

**证据 1（前提部分成立，但只覆盖 KL-5 的一个真子集）**

plan §3.8 的观察在本仓成立——`_reference` 确实以**无尾斜杠的文件条目**出现在预取清单里：

```
$ ls -ld _reference
lrwxr-xr-x  _reference -> /Users/connorlu/.../cc-plugin-market/_reference
$ git ls-files --others --ignored --exclude-standard --directory | grep -i reference
_reference
```

但该前提**只在"symlink 自身被忽略规则直接命中"时成立**。构造反例（规则命中的是 symlink 的
**目标**而非 symlink 本身）：

```
.gitignore = "ignored_dir"，ln -s ignored_dir link_to_ign
$ git ls-files --others --ignored --exclude-standard --directory
  ignored_dir/            ← link_to_ign 根本不在清单里
```

⇒ 该改良对这一类 KL-5 形态**零效果**。它修的是 KL-5 的一个严格子集，剩下的部分保持原样静默。
**对一个静默失败模式做部分修复，比登记一条完整的已知限制更难推理**——之后谁都说不清"这个
symlink 形态到底判不判得了"。

**证据 2（成本不是拦路虎——刻意不拿成本当理由）**

实测本仓预取清单 13 条（8 条文件型 / 5 条目录型），对全部文件型条目做 `lstat` + `statSync`
判定"是否 symlink 指向目录"耗时 **1 ms**，其中 symlink-指向目录 3 条。成本可忽略。
故本裁决**不以性能为由**（那会是个站不住的弱论证）。

**证据 3（决定性理由：它会造出第三个与两个 git oracle 都不同解的 oracle）**

`git check-ignore -q -- '_reference/foo.ts'` 实测 **exit 128**——git 明确**拒答**，理由是
"路径规格位于符号链接之后"。把 symlink 登记成 dirPrefix，等于替 git 发明一个它拒绝给出的答案。
而本 fix 的整个立论就是"事实源在某条路径上被悄悄换成了别的东西"——再加一个自造 oracle 属于
同形缺陷，方向相反而已。

**证据 4（在可达输入上收益为零）**

两个 walk 消费方都在发问**之前**就跳过 symlink：

- `src/utils/file-scanner.ts::walkDir`：`if (entry.isSymbolicLink()) continue;`
- `src/batch/generic-language-skeleton-collector.ts::walkFiles`：symlink-to-dir 的 Dirent
  既非 `isDirectory()`（Dirent 反映 lstat）也非 `isFile()` ⇒ 落到 `if (!entry.isFile()) continue`

⇒ 正常采集**不会产出** symlink 目录之下的图节点，改良所改变的答案落在"到不了消费方"的路径上。
T032 fixture 里那条 `sub/c.ts` 是刻意"先建图、再把真目录换成 symlink"人为造出来的，不是采集器
能自然产出的形态。

### 若未来要重新评估，需要先成立的条件

1. 出现一个**会下钻 symlink 目录**的采集器（届时 KL-5 从"不可达"变成"可达"）；
2. 且能给出一个不与 `git check-ignore` 的 exit 128 相冲突的语义定义。

---

## T003 / T076 — `current-spec.md` 是否需要同步：**无需同步**

核查命令与结果：

```
$ grep -niE "gitignore|check-ignore|ls-files|忽略规则|ignoredPath|coverage scope|覆盖面|事实源" \
    specs/products/spectra/current-spec.md
（零命中）

$ 同上 specs/products/spec-driver/current-spec.md
（9 处命中，全部是 "current-spec.md 作为产品事实源 → 对外文档" 这一无关语义；
  无任何一处记载 gitignore 判定口径或 coverage scope 判据）
```

结论：两份 `current-spec.md` **均未记载** gitignore 事实源口径或 coverage scope 判据，
本 fix 不产生 spec 同步需求。（`specs/src.spec.md` 与 `specs/_meta/` 按约定不改。）

---

## §12「现在不知道」中由 P1 落定的项

| item | 落定结论 | 依据 |
|---|---|---|
| 3（`[CLEANUP]` 是否触发，file-scanner 侧） | **触发**。`git diff --stat` 实数 `139 insertions(+), 10 deletions(-)` ⇒ 净增 **+129 行**，原文件 503 LOC > 500 | 见下方 T005 记录 |
| 7（`nextSteps` 机读 token 字面值） | **`[ignore-undeterminable]`**（沿用报告内既有的 `[source-commit]` 等方括号前缀风格） | 生产者 `graph-quality.ts::IGNORE_UNDETERMINABLE_TOKEN`；消费者 `graph-quality-core.mjs` 同名常量；跨侧逐字相等由 `graph-quality-core.test.ts` 断言双向钉住 |
| 8（L2 预算默认值） | **`DEFAULT_L2_BUDGET_MS = 1500`**，不引入新环境变量，可经 `opts.l2BudgetMs` 注入 | 实测 `git check-ignore` **5.09 ms/次**（200 次 1019 ms）⇒ 1500 ms ≈ 295 个不同离盘路径；对下游 `graph-bootstrap-status.mjs::DEFAULT_FRESHNESS_DEADLINE_MS = 5000` 留 3.5 s 余量 |
| 9（symlink→dirPrefix 改良） | **不纳入**（本文件上半部分） | 四条证据 |
| 10（新 check 与 `repo:check` 早退分支冲突） | **无冲突**。新 check 放在"报告解析成功 + exit-code 一致性校验通过 + 非 cannot-assess"之后；5 条早退分支（graph 缺失 / dist 未构建 / spawn 失败 / JSON 解析失败 / exit 不一致 / cannot-assess）均在其之前 `return` | `graph-quality-core.test.ts > 早退分支不误报：cannot-assess / dist 未构建 两条路径都不产出该 check` |
| 1 / 2（本仓 0 离盘 filePart） | 与实测一致，见 T033 记录 | — |

---

## T005 — `[CLEANUP]` 两遍法实数记录（不接受"预计"）

第一遍（草稿：把三态 oracle 直接写进 `file-scanner.ts`，随后撤销）：

```
$ git diff --stat src/utils/file-scanner.ts
 src/utils/file-scanner.ts | 149 ++++++++++++++++++++++++++++++++++++++++++----
 1 file changed, 139 insertions(+), 10 deletions(-)
$ git diff --numstat src/utils/file-scanner.ts
139	10	src/utils/file-scanner.ts
```

判定：原文件 **503 LOC > 500** 且实测净增 **129 行 > 50** ⇒ **触发 `[CLEANUP]`**。
（该草稿尚未含 T022 的契约注释重写，故 129 是下界。）

第二遍：撤销草稿（`git show HEAD:src/utils/file-scanner.ts >` 还原，未使用任何 git 写操作）→
纯搬运 → 搬运后先跑全绿 → 再重放功能改动。

**搬运边界**（严格按 plan §1，未扩大）：新建 `src/utils/gitignore-oracle.ts`，只移动
`parseGitignore` / `globToRegex` / `GitIgnoredIndex` / `readGitIgnoredIndex` /
`createGitIgnoredLookup` / `createGitignoreFilter`；`file-scanner.ts` 保留
`export { createGitignoreFilter } from './gitignore-oracle.js';` 使 4 个既有 import 点零改动；
`scanFiles` 本体一行未动。

纯搬运态验证（零行为变化）：

```
$ npx tsc --noEmit -p tsconfig.json   → exit 0
$ npx vitest run tests/unit/file-scanner.test.ts \
    src/panoramic/graph/quality/ignore-oracle.test.ts \
    tests/integration/gitignore-collector-freshness-consistency.test.ts
  Test Files  3 passed (3)
       Tests  56 passed (56)
```

⚠️ **未达成的部分（如实说明）**：plan/tasks 要求搬运落**独立 commit**。本次执行被编排器明令
"全程不做任何 git 写操作（不 commit / add / stash / checkout）"，故无法产出两个 commit。
已做的替代是：搬运态**单独跑过一次全绿并留证**（上方输出），功能改动在其之后叠加。
若需要"搬运 diff 与行为 diff 可分离"的 review 体验，需由编排器在提交时拆分。

---

## T012 — R1-10（worktree 一致性）先红步骤不适用的理由

R1-10 按预期**开箱即绿**（worktree 内 `git ls-files` / `git check-ignore` 的 cwd 基准与主仓
同解，本 fix 未触碰该维度）。按 D8 条款如实记录：**本条是"锁定不回退"的回归护栏，不是缺陷的
再现用例**，其价值在于未来若有人把 walkBase / cwd 基准改错，它会立刻变红。故 TDD 的"先看到红"
步骤对它不适用，不是被略过。

同类情况：R1-8（KL-5）、R1-9（KL-6）、R1-5（KL-1）三条**钉住已知限制实际行为**的用例同样开箱
即绿——它们断言的就是"原病在该形态上原样保留"，先红本就不该发生。

---

## 修复前 / 修复后 对照（T032 fixture 上实跑，判别力来源）

`createGitignoreFilter` 是 L0/L1 薄壳（不做存在性探测、不起子进程），其对离盘路径的答案
**就是修复前的口径**，故可在同一 fixture 上直接对照：

| 路径 | 修复前（仅预取查表） | 修复后（三态） | git 权威 |
|---|---|---|---|
| `foo.gen.ts` | `not-ignored` ❌ | `ignored` ✅ | IGNORED |
| `legacy/old.ts` | `ignored` | `ignored` | IGNORED |
| `src/a.ts` | `not-ignored` | `not-ignored` | NOT-IGNORED |
| `src/ghost.ts` | `not-ignored` | `not-ignored` | NOT-IGNORED |
| `sub/c.ts` | `not-ignored`（静默） ❌ | `undeterminable` + 计数出声 ✅ | exit 128（拒答） |

`legacy/old.ts` 修复前后同为 `ignored`，是因为 `legacy/` 目录仍在盘上、被 `--directory` 折叠成
dirPrefix 而"恰好"命中——这正说明**只用本仓/单一样本会得出"没坏"的错误结论**，真正的判别项是
`foo.gen.ts`（无 dirPrefix 可蹭）与 `sub/c.ts`（第三态）。

---

## T071 / T072 — `BEHAVIOR_VERSION` 双向差分实证（plan §10.5）

两侧口径：`createGitignoreFilter`（L0/L1 薄壳，不做存在性探测、不起子进程）**逐字保留了修复前的
walk 过滤语义**，故可在同一进程内直接对拍"修复前 vs 修复后"，无需保留一份旧 dist。
两侧都用本 worktree 的 `dist/`（`npm run build` 产出），**未使用** PATH 上的全局 `spectra`。

判据 = **被采集的文件集合是否变化**，即对每个 walk 会发问的路径比较
`修复前 isIgnored` 与 `修复后 verdict === 'ignored'`。

### (a) 本仓差分（确认向）— 无分歧

```
询问路径总数: 4646
采集判定分歧数（前 ignored? vs 后 ignored?）: 0
落 undeterminable 的路径数: 0
drain: {"count":0,"samples":[],"budgetExhausted":false}
```

### (b) 构造反例仓差分（证伪向）— **一度成功证伪，已改实现而非弱化实证**

已尝试的形态清单：

| 形态 | 结果 |
|---|---|
| ① `EACCES`（`chmod 0444 dir`：有 r 无 x ⇒ readdir 可列名、lstat 抛 EACCES） | **发现分歧** ⇒ 见下 |
| ① `EACCES`（`chmod 000 dir`） | 无分歧（readdir 也失败，walk 根本枚举不到） |
| ① `ELOOP`（自指 symlink 环） | 无分歧（该路径离盘，walk 不会发问） |
| ② 嵌套未注册 git 仓（KL-1，`subrepo/a.gen.ts` 在盘） | 无分歧（两侧同为 not-ignored） |
| ③ 在盘 symlink 穿越（KL-5，`link_to_ign/f.ts`） | 无分歧（两侧同为 not-ignored） |
| 对照：离盘且规则命中（`ghost.gen.ts`） | 前 not-ignored / 后 ignored —— **这正是缺陷 1 的修复本身**；离盘路径按定义不会被采集（walk 只对存在的 dirent 发问），故不改变采集集合 |

**被证伪的那条**（形态 ①，`chmod 0444`）：

```
路径                   | 修复前      | 修复后
  weird/secret.log    | ignored     | undeterminable   <<< 分歧！采集集合会变
```

即：`weird/secret.log` **命中预取清单**（git 说它 ignored），但 `lstat` 抛 EACCES。若 L3 只按
errno 三分直接给 `undeterminable`，消费方按 not-ignored 处理 ⇒ **该文件会被采集**，而修复前
是被跳过的 ⇒ 采集集合变化 ⇒ `gitignore-interpretation` 责任项触发 ⇒ 必须 bump。

这条同时**证伪了 plan §3.1a 自己的论证**——原文写"走 L3 出口后，消费方按 not-ignored 处理
= 与旧行为逐字节一致"，该断言在"路径命中预取清单"时不成立。

**处置（未弱化实证口径）**：不缩小 fixture 形态、不只跑 (a)。改的是**实现**——L3 分支先查一次
内存预取清单，命中则返回 `ignored`（= 修复前答案），未命中才落 `undeterminable`。查内存表既非
"当离盘"也非"转 L2"，不违反 L3 的两条硬约束；且清单条目是 git 自己给出的**肯定**答复。
并补一条承重回归测试钉住该不变量：
`tests/unit/gitignore-oracle.test.ts > L3 前置查预取清单：EACCES 但命中预取清单的路径仍判 ignored（采集集合逐字节不变）`。

修实现后复跑形态 ①：

```
  weird/secret.log    | 前: ignored     | 后: ignored        | 采集集合分歧: false
  weird/keep.ts       | 前: not-ignored | 后: undeterminable | 采集集合分歧: false
  => 采集集合分歧数: 0
```

### 裁决

(a) 与 (b) 两条**均已跑完且最终均无采集集合分歧** ⇒ **`BEHAVIOR_VERSION` 保持 2，不 bump**；
`collector-fingerprint.formatVersion` 保持 1。核对两文件零改动：

```
$ git status --porcelain src/panoramic/graph/collector-fingerprint.ts src/collector-surface.ts
（空）
```

残余风险（沿用 plan §7 登记）：忘记 bump 没有任何运行时守护会抓到；本次的守护是上面那条
"采集集合逐字节不变"回归测试，它只覆盖已想到的形态。

---

## T033 — 本仓实跑（**零信息量护栏**，不得当作缺陷 1 的验收证据）

```
$ node dist/cli/index.js batch --mode graph-only
  节点: 7527 | 边: 12658 | 耗时: 5.1s
$ node dist/cli/index.js graph-quality --json --graph specs/_meta/graph.json   → exit 0
  duplicateCanonicalId  pass / containsCoverage pass / orphanRatio pass
  danglingEdges pass / legacyAndIgnoredNodes pass / freshness dirty
  overallVerdict: pass
  ignoredPathNodeIds 数量: 0
  不可判 nextSteps 条目: 0
  nodes: 7527 | distinct fileParts: 1292 | OFF-DISK: 0
```

**显式声明：本条恒绿、零判别力。** 本仓 OFF-DISK filePart 为 **0**，而离盘是缺陷 1 的唯一触发
条件 ⇒ 该实跑无论实现好坏都会全绿。缺陷 1 的真正验收在 T032 的可控 fixture。
（plan §12 item 1/2 预测 nodes 6092 / fileParts 996 / OFF-DISK 0；本次重建后为 7527 / 1292 /
**OFF-DISK 仍为 0** —— 节点数差异来自 worktree 当前含本 fix 新增文件与并行 P2 改动，
**关键不变量 OFF-DISK=0 与预测一致**。）

`specs/_meta/` 由 `.gitignore:80` 覆盖且未被 git 跟踪，重建图不污染任何入库产物：

```
$ git ls-files --error-unmatch specs/_meta/graph.json  → NOT TRACKED
$ git status --porcelain specs/_meta/                  → （空）
```

---

## T032 — 可控 fixture 验收（缺陷 1 的**唯一**有判别力验收）

构造步骤（全程真实建图，无手工注入节点）：

1. `git init` fixture 仓，`.gitignore` **先为空**，建 `src/a.ts` / `legacy/old.ts` /
   `foo.gen.ts` / `src/ghost.ts` / `sub/c.ts`；
2. **只提交 `.gitignore` 与 `src/a.ts`**，其余保持 untracked
   （⚠️ 第一次构造时把它们也 `git add` 了，结果 tracked 豁免让 git 正当地答 not-ignored、
   `ignoredPathNodeIds` 为空——**是 fixture 错了不是实现错了**，已修正并记录）；
3. `node dist/cli/index.js batch --mode graph-only` 建图 ⇒ 5 个 filePart 全部入图；
4. 制造离盘：删 `legacy/old.ts` / `foo.gen.ts` / `src/ghost.ts`；把 `sub/` 换成指向
   `ignored_dir` 的 symlink（使 `sub/c.ts` 成为 symlink 穿越后的离盘路径）；
   写入 `.gitignore = legacy/ + *.gen.ts + ignored_dir/`；
5. **不重建**，直接 `node dist/cli/index.js graph-quality --json`。

逐条真/假阳性判定（"git 权威"列 = 现场跑 `git check-ignore` 取的答案）：

```
ignoredPathNodeIds = ["foo.gen.ts","foo.gen.ts::generated","legacy/old.ts","legacy/old.ts::oldFn"]

  foo.gen.ts       | 门标记: true  | git 权威: IGNORED      | ✅ 一致
  legacy/old.ts    | 门标记: true  | git 权威: IGNORED      | ✅ 一致
  src/a.ts         | 门标记: false | git 权威: NOT-IGNORED  | ✅ 一致
  src/ghost.ts     | 门标记: false | git 权威: NOT-IGNORED  | ✅ 一致
  sub/c.ts         | 门标记: false | git 权威: EXIT-128     | ✅ 一致（不可判 ⇒ 不计入 + 出声）

[ignore-undeterminable] 1 个节点路径的忽略判定不可判（symlink 穿越 / submodule / 仓外 /
越界 / 权限受限），已按未忽略处理，未计入 ignoredPathNodeIds；样本：sub/c.ts。
（同一文案同时出现在 stdout 报告的 nextSteps 与 stderr）
```

**结论：零假阳性、零假阴性。** 命中规则的离盘节点正确进门、未命中的不进、不可判的不进且计数出声。
