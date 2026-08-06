# P3 阶段决策与实测记录（缺陷 2 base-ref 硬失败 + 契约收口 + `[CLEANUP]` 搬运）

范围：`plugins/spec-driver/scripts/{graph-consumption-cli.mjs, lib/graph-consumption-inputs.mjs(新),
lib/git-change-classifier.mjs}` + 对应测试 + canonical `SKILL.md` 与 `repo:sync` 再生镜像。
**未触碰** P1 的 `src/**`（唯一例外见下方"P1 遗留缺口"）与 P2 的 `graph-consumption-decision.mjs`。

---

## `[CLEANUP]` 第二遍搬运（T037，编排器批准挪到 P3 执行）

### 为什么在 P3 做

P2 的判定（`verification/p2-decisions.md`）已确认触发：基线 784 LOC > 500，P2 实测净增 +92 > 50。
第二遍未在 P2 执行的两个理由都在 P3 消解：搬运清单里的 `runGit` / `collectChangeSet` 正是 P3 要
重写的两个函数，先搬后改会白搬一次；且 P3 还会继续改该文件。

### 执行顺序（"搬运态"与"行为态"可区分，替代无法落 commit 的两遍法）

本 agent 被禁止 git 写操作，无法落独立的搬运 commit。替代做法：**先只做纯搬运并单独跑一次
全绿留证**，再在搬运后的结构上叠加行为改动。两段的符号清单见交付报告，供编排器拆成两个 commit。

纯搬运态的全绿证据（尚未写任何 P3 红用例、尚未改任何行为时）：

```
$ npm run test:plugins   → ℹ tests 1501 / ℹ pass 1501 / ℹ fail 0
$ npx vitest run         → Test Files 523 passed | 4 skipped (527)
                           Tests 7138 passed | 18 skipped | 21 todo (7177)
```

### 搬运边界（按 plan §1 写死的清单，加上其**独占私有依赖**）

| 搬运项 | plan 清单内 | 说明 |
|---|---|---|
| `runGit` | ✅ | |
| `collectChangeSet` | ✅ | |
| `collectGraphAvailability` | ✅ | |
| `deriveScopeSurfacesFromFingerprint` | ✅ | |
| `collectCoverageScope` | ✅ | |
| `verifiedSourceCommitOf` | ❌（超出清单） | `collectGraphAvailability` 的私有判据实现；不搬则新文件要反向 import CLI，形成环。改为在新文件 export，CLI 侧 import 复用 |
| `FINGERPRINT_SURFACE_KEYS` / `SUPPORTED_FINGERPRINT_FORMAT_VERSION` / `FINGERPRINT_MATCH_SEMANTICS` | ❌（超出清单） | `deriveScopeSurfacesFromFingerprint` 的独占常量。前两个是跨语言合同测试的锚点，故 CLI 侧做 **re-export** 保持 `tests/unit/graph-scope-extensions-contract.test.ts` 的 import 路径不变 |

**留在 CLI 未搬**（刻意不扩大边界）：`readVerifiedSourceCommit`（属"刷新后重读"流程而非输入采集）、
`resolveScopeSource` / `warnMalformedFingerprint` / `mergeScopeSurfaces`（P2 引入的决策侧包装）。

RG-006 下限清单已追加新文件（`graph-consumption-cli.test.mjs::RG006_MINIMUM_AUDITED_FILES`），
新文件同时由 `resolveImportClosure(CLI_PATH)` 自动纳入被审集合。

### 搬运后的行数

```
$ git diff --numstat plugins/spec-driver/scripts/graph-consumption-cli.mjs
83  172   （净 -89，相对基线 784 → 搬运后 695）
$ wc -l plugins/spec-driver/scripts/lib/graph-consumption-inputs.mjs   →  218（搬运态）
```

---

## 锚点可解析性探测：**偏离 plan §4.2 的命令，理由如实登记**

plan §4.2 / §12 item 4 写的是 `git rev-parse --verify --quiet <ref>^{commit}`。**实现改用
`git cat-file -e <ref>^{commit}`**，原因是一条硬门禁：

`graph-consumption-cli.test.mjs` 的 RG-006 扫描 ② 对 `resolveImportClosure(CLI_PATH)` 闭包内
**除 canonical `graph-bootstrap-status.mjs` 外的每个文件**，在 strip 注释后断言不含
`rev-parse` / `currentHead` / `worktreeHead` 三个 token（它们是"自行拿 sourceCommit 比 HEAD 复算
freshness"的文本代理）。新的 inputs 模块属该闭包，按 plan 原样实现会直接把这道门禁打红。

三条候选处置与裁决：

| 候选 | 裁决 | 理由 |
|---|---|---|
| 放宽 RG-006 扫描 ②（加白名单） | **否** | 为一条与 freshness 完全无关的需求去放宽一道承重门禁，代价远高于收益；白名单一旦开口就会长 |
| 拼接字符串规避 token（`'rev' + '-parse'`） | **否** | 这是纯粹的门禁规避，本仓明令禁止 |
| 换语义等价命令 `git cat-file -e <ref>^{commit}` | **采纳** | 它回答的正是"这个 ref 能否 peel 成本地存在的 commit 对象"，与预检语义逐字对应 |

实测退出码谱（git 2.53.0，T054）：

| ref 形态 | `rev-parse --verify --quiet` | `cat-file -e` | `cat-file -e --end-of-options` |
|---|---|---|---|
| 可达 sha / `HEAD` | 0 | 0 | 0 |
| 悬空 sha（`deadbeef…`） | 1 | 128 | 128 |
| 含空格（`no such ref`） | 1 | 128 | 128 |
| `-` 开头（`--help` / `-x`） | 1 | **129**（选项解析错误，打印用法） | 128 |
| 空串 | 1 | 128 | 128 |

两条命令的码值不同，但**判据同为"非 0 即不可解析"**，故收口口径不变。`-` 开头形态在 JS 侧
**进程边界之前**就被显式拒绝（不依赖 `--end-of-options` 的 git 版本支持度，也断掉"参数被当选项
解释"这条注入面），因此实现里没有用 `--end-of-options`。

---

## D5 三条硬要求的落地形态

| 要求 | 落地形态 | 证据 |
|---|---|---|
| **abort 不消耗刷新预算** | 实现侧：abort 收口在 `collectGraphAvailability` / `checkFreshness` **之前**，一次刷新都不发生（`countBuildSpawns === 0` 且**整个** fake-spectra 调用日志为空）。散文侧：`SKILL.md` 三处调用点统一改写为「`RC == 3` 的调用不计入预算消耗」，并把步骤 2 的预算记账口径明确为"预算记的是**发生过一次刷新尝试**，不是**调用过一次 decide**" | 红用例 R2-5① |
| **恢复口径** | (a) 显式传 `--base-ref <可达 ref>` 重跑；(b) 编排器**显式**重记 `phase_start_ref` 并在 trace / iteration log 留一条可审计记录。两条都写进 abort payload 的 `hint`（红用例断言 `hint` 同时含 `--base-ref` 与 `phase_start_ref` 两个字面 token），并在 SKILL 三处调用点逐处展开。红线澄清为「禁的是**自行 + 静默**重记，(b) 的**显式 + 留痕 + 声明覆盖面损失**允许——差别是可审计性、不是动作本身」。**CLI 刻意不做自动重记**：自动重记就是把红线要防的事做成默认行为 | 红用例 R2-1（hint 断言）+ R2-5②（恢复路径真的能出决策） |
| **payload 无 `degradedReason`/`fallbackHint`** | abort payload 是 12 键封闭集，两个键都不在其中；SKILL 三处调用点全部改为记 `DECISION.error` / `DECISION.hint`，并显式写明「记了就是一行 undefined」 | 红用例 R2-5③（`deepEqual(Object.keys().sort(), ABORT_OUTPUT_KEYS)`） |

---

## `AUDIT_SCHEMA_VERSION` 3 → 4：连锁面逐处核对（INFO-1）

| # | 位置 | 处理 |
|---|---|---|
| 1 | `graph-consumption-cli.mjs` `kind:'decision'` 事件 | 引用常量，随 bump 自动生效；同批新增 `baseRefResolution` / `worktreeStatusReadFailed` 两字段 |
| 2 | `graph-consumption-cli.mjs` `decide` payload | 同上 |
| 3 | `graph-consumption-cli.mjs` `caveat-annotation` 事件 | 引用常量，随 bump 自动生效（**本处即 INFO-1 提示的第三处**，已核） |
| 4（新） | `graph-consumption-cli.mjs` `kind:'decide-aborted'` 事件与 abort payload | 本次新增，同样引用常量 |

测试侧两处钉死 3 的断言已改为 4：`graph-consumption-cli.test.mjs:1029`（decision 事件）与
`:1084`（caveat-annotation 事件）。另新增一条独立断言（Part 2d）同时覆盖 payload 与事件。

全仓复核"有没有第四处硬编码字面量"：

```
$ grep -rn "schemaVersion" plugins/spec-driver/scripts/ plugins/spec-driver/tests/graph-consumption-cli.test.mjs \
    plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs | grep -v AUDIT_SCHEMA_VERSION
# 命中的全部是其他模块自己的 SCHEMA_VERSION 常量（sync-merge / fix-compliance-judge /
# graph-bootstrap-status 等），graph-consumption 链路内**零**硬编码版本号
```

**无入库 audit fixture** 这一事实不变：漏改不会被 fixture 抓到，只能靠上述三处常量引用 +
两处显式断言 + 本节人工核对清单。如实登记为残余风险。

---

## P3 新发现（不在 plan 预期内，如实登记）

### 发现 1：`--base-ref` 缺取值会**静默降级成"没给锚点"**（与附带项 6.2 同形）

`parseFlags` 对"下一个 token 以 `--` 开头或缺省"置 `true`；旧读法 `typeof flags['base-ref'] ===
'string' ? … : null` 于是把 `--base-ref --format json` 这类手滑当成"压根没传 `--base-ref`"，
照常出决策并标 `baseRefMissing:true`。**调用方明明声称了锚点，我们却当它没说过**——与本 fix 要
消灭的"base-ref 坏了还照常给结论"是同一种病，只是发生在参数解析层。

- P2 的 T043 同形核查把 `--base-ref` 判为"安全"，那次只核了**类型强制转换**面
  （`Number(true) === 1` 那一类），没核**语义丢失**面。该结论在本 fix 的新契约下不再成立。
- 修法：与 6.2 同形的类型闸门，`--base-ref` / `--base-ref-from-trace` 缺取值 ⇒ **exit 2**（用法错误）。
  取 2 而非 3：命令行本身写错了，责任在编排层，语义不是"锚点不可达"；SKILL 对 `RC == 2` 的
  处置正是"停下修调用"，与责任方一致。
- 该缺口是被 T054 的红用例**实测**撞出来的（原用例用 `--not-a-ref` 作 `-` 开头形态，结果发现它
  根本走不到 abort），不是纸面推演。红用例已拆成两条：`-x`（单横线，走 abort/exit 3）与
  `--base-ref` 缺值（走 exit 2）。

### 发现 2：P1 漏改一处门禁（本 P3 代为修复）

P1 在 `scripts/lib/graph-quality-core.mjs` 新增了 `ignore-undeterminable` check（D4 要求的
`nextSteps` 消费者），但没更新 `tests/integration/spec-drift-repo-check-regression.test.ts:110`
那条"相对基线新增的 check MUST 精确等于某清单"的断言 —— 该断言正是为"新族接入必须显式落账"
设计的，它**正确地**红了：

```
AssertionError: expected [ …(7) ] to deeply equal [ 'spec-drift:anchors-status', …(5) ]
+   "graph-quality:ignore-undeterminable",
```

处置：把新 check id 加进清单**并补上它的落账注释**（说明它属图质量族、故按族追加顺序排最前）。
这是补账不是放宽——清单仍是精确等值断言。

---

## plan 说了但做不到 / 未覆盖的部分（如实登记）

| 项 | 状态 |
|---|---|
| `baseRefResolution: 'diff-failed'` 的专用红用例 | ~~未写~~ → **已补**（对抗复审 A-W1 推动）。构造方式是删掉 HEAD 的松散 tree 对象：commit 对象仍在故预检通过，diff 读不到树而 exit 128。详见下方 T068 节 |
| exit 3 的机械保障 | **未做**（plan §0 明确排除）。全仓 SKILL 现仍无任何 `$?` 检查的机械校验；本次新增的 `RC=$?` 处置能否被遵守，100% 取决于散文被读。残余风险原样保留，不假装已解决 |
| `--format text` 下的 abort 渲染 | abort payload **不随 `--format text` 变形**，恒输出 JSON；人读通道由 stderr 的 `[error]` 行承担。理由写在代码注释：人读渲染器按决策形状写（outcome/matchedRule/caveats），abort 一个都没有 |

---

## T068 P3 对抗复审：两个独立子代理、两个不同切入角

> **Codex 审查暂停（配额耗尽），异构档位缺席**。本轮为 CLAUDE.local.md 暂停期替代档位：
> 独立子代理 × 2，各自**只**拿到一个切入角、互不知道对方存在，且 prompt 用"证伪"措辞、
> 不给实现思路。按暂停期约定，本批含门禁/判定器类改动（RG-006 被审集合扩容、
> `classifyChangeSet` fail-loud 门、新退出码 3），commit message 须显式标注档位缺席。

| 角 | 切入面 | 结论 |
|---|---|---|
| A | fail-open 面 / 静默降级面 | 2 CRITICAL / 2 WARNING / 6 INFO（含零发现登记） |
| B | 合同破坏面 / 搬运事故面 / 版本连锁面 | 0 CRITICAL / 5 WARNING / 5 INFO |

两角的**具体查证动作**均已要求列出，且各自跑了 ≥3 次实跑验证（A：11 种 ref 形态对拍 +
spawnSync maxBuffer 溢出实测 + SKILL 调用点逐字重放；B：程序化逐字节比对搬运纯度 +
RG-006 绕过探针 A/B/C + re-export 锚定变异 + shell `set -e` 语义探针）。

### 逐条处置

| # | 发现 | 判定 | 处置 |
|---|---|---|---|
| **A-C1** | `--base-ref-from-trace` 取不到锚点 ⇒ exit 0 + `authoritativeOutcome`，且 stderr **0 字节**、审计无从区分 | **部分成立** | 出口**不改**（plan §4.2 把"未传"与"trace 无锚点"合并为 `not-provided` 并指定为 EC-29 回归护栏，红用例 R2-3 锁定；改出口是 plan 级裁决，不由 implement 单方推翻）。但"无出声"这一半**确实是缺口**：EC-29 原文自己要求"authoritative 合同下应在输出中明确警示"，而实测 stderr 恒 0 字节。**已修**：声称了 `--base-ref-from-trace` 却取不到该 phase 锚点时输出 stderr warn（指名 trace 路径 + phase 名 + "已 commit 的改动整体看不见"）。**升级为 exit 3 / 新增第三个 enum 取值的问题上交编排器裁决** |
| **A-C2** | `--base-ref ""` 从 `length === 0` 守卫漏进 not-provided，且 `baseRefMissing:false` 与 `baseRefResolution:'not-provided'` 互相否证；**abort 的恢复口径 (a) 本身会踩这个坑** | **成立** | **已修**：`--base-ref` / `--base-ref-from-trace` 的空串与纯空白一律 exit 2（与缺值同出口）。新增两条红用例：空值 exit 2、以及"`baseRefMissing` 与 `baseRefResolution` 恒不互相否证"的同源断言 |
| **A-W1** | `diff-failed` 沿用 unresolvable 文案，会诱导操作者去重记锚点（对本形态无效，还会在 trace 留下事实错误的记录）；`spawnError` 全程丢弃、是死字段 | **成立** | **已修**：`ABORT_HINTS` 按 resolution 分支，`diff-failed` 用独立文案并明确劝阻重记锚点；`gitSpawnError` 一路走进 abort payload（spawn 层失败时 `gitStatus` 为 null、`gitStderr` 为空，它是唯一诊断来源）。**并补上了 diff-failed 的真实覆盖**（见下） |
| **A-W2** | not-provided 分支对 classifier 声称 `nameStatusOk: true` | **不成立（在当前出口下）** | 该分支下我们**确实没有执行过 diff**，`ok:true` + 空输入是如实描述。仅当 A-C1 被裁决为改出口时才需要跟着改；已在此登记依赖关系 |
| **B-W1** | 新文件头自述"原样搬出、只搬运不改行为"与最终态不符 | **成立** | **已修**：文件头改为按三档如实说明每个符号的出身（原样搬出 / 搬出时已是 P2 形态 / P3 重写），并提示不要对整份文件做 `git show HEAD:` 全等比较 |
| **B-W2** | `AUDIT_SCHEMA_VERSION` 上方的人工核对清单写"三处/两处"，实际是 **5 处写入点 / 4 处断言**——而它是唯一的检查清单（无 fixture 兜底），在新增两处写入点的同一次改动里没跟着更新 | **成立，且是本轮最有价值的一条** | **已修**：数字改正；并**新增静态断言** `schemaVersion 写入点数量与源码注释的人工核对清单一致`——清单本身现在被锚住（写入点数变了 / 注释数字对不上 / 出现字面量版本号，三者任一即红）。这条正是本仓 F254 教训的同形复发：注释里的"唯一/穷尽"断言必须有测试锚定 |
| **B-W3** | RG-006 扫描 ② 可被 `git rev-list -1 HEAD` 等同义命令完整绕过（实测 exit=0 通过）；本次把 `runGit` 变成 lib 导出**降低了绕过门槛** | **成立（门禁自身设计面，非本 fix 造成）** | 部分缓解：`runGit` 改回**模块私有**（全仓核实无外部消费点），移除"任何闭包成员可 import 一个通用 git 执行器"这个新增面。门禁判据从 token 黑名单改为结构性判据**不在 F258 范围**——建议开独立 fix 卡，此处登记 |
| **B-W4** | `DECISION=$(...) ; RC=$?` 在 `set -euo pipefail` 下拿不到——脚本在赋值处直接终止，`RC == 3` 这条**本次新增的最危险分支**永远进不去 | **成立** | **已修**：三处调用点统一改为 `RC=0` + `\|\| RC=$?`，并在 4b 的处置块里写明"不能写成 `; RC=$?`"及其原因 |
| **B-W5** | 新文件是第一个把被禁 token 写进注释的闭包成员，门禁绿灯挂在"注释排版恰好能被 strip 正则剥掉"上（实测：同一句话改成行尾 `//` 注释立刻红） | **成立** | **已修**：注释重写为不写出该 token（改为指名"git 那个惯用的 revision 解析子命令"+ 指向门禁判据所在的测试），把门禁绿灯与注释排版解耦。**未**采用"用非 ASCII 连字符伪装"的建议——那是让文本看起来像 token 却搜不到，是另一个陷阱 |
| **B-I2** | `classifyChangeSet(undefined/null)` 的 throw 路径失去覆盖 | **成立** | **已修**：R2-4 补一条 `[undefined, null]` 的 `assert.throws` |
| **B-I3** | re-export 注释"三个"与"那两个"自相矛盾 | **成立** | **已修** |
| **B-I1** | `cat-file -e ^{commit}` 对 tree-ish 判拒而 `git diff <tree-ish>..` 可用 ⇒ 该形态由 exit 0 变 exit 3 | **成立，方向为 fail-closed** | 不改（phase 锚点本就该是 commit，trace 记的也是 commit sha）。**已在代码注释里登记**该差异 |
| **B-I4** | `annotate-caveat` 三处调用点仍是裸调用、不检查退出码 | **成立，超范围** | 本次 scope 只覆盖 `decide`。登记为残留面 |
| **B-I5** | 简报称"只有 `runGit`/`collectChangeSet` 被重写"不准确：`deriveScopeSurfacesFromFingerprint` / `collectCoverageScope` 也是重写态（P2 改的） | **成立（我给审查者的简报不准确）** | 已在新文件头按三档如实说明；本交付报告的搬运清单同样按三档给出 |

### 复审引出的新增覆盖

原本登记为"未覆盖"的 `diff-failed` 分支，**在复审推动下找到了可靠构造并补上了真实用例**：

```
删掉 HEAD 的松散 tree 对象 ⇒ git cat-file -e <sha>^{commit} 仍 exit 0（commit 对象还在）
                            git diff --name-status -z <sha>..  ⇒ exit 128「无法读取树」
```

据此新增两条互为对照的红用例：
- 锚点可解析但 diff 失败 ⇒ exit 3 + `baseRefResolution:'diff-failed'` + hint **不含** rebase 文案、
  且明确劝阻重记锚点 + `gitSpawnError` 字段存在；
- 同一仓改为**索引损坏**（`.git/index` 写入垃圾）⇒ porcelain 失败但 base-ref 可用 ⇒
  **不** abort、exit 0、只标 `worktreeStatusReadFailed:true` + `changeClass:'unknown'`。

这对用例把"责任方不同 ⇒ 出口不同"这条设计判据从散文变成了机器断言。

### 复审后的全量验证

```
$ npm run test:plugins   → ℹ tests 1527 / ℹ pass 1527 / ℹ fail 0
$ npx vitest run         → Test Files 523 passed | 4 skipped (527)
                           Tests 7138 passed | 18 skipped | 21 todo (7177)
$ npm run build          → exit 0
$ npm run repo:check     → exit 0（含 graph-quality 七项、codex wrapper 一致性）
$ npm run release:check  → exit 0
```
