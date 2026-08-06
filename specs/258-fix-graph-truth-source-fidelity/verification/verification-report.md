# F258 验证闭环报告（Phase 4c：工具链验证 + 验证证据核查）

- **特性**：258-fix-graph-truth-source-fidelity（图事实源三处失真收口）
- **基线**：`19bff52a`，改动全部未提交
- **工作目录**：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/funny-driscoll-fc77bb`
- **执行者**：验证闭环子代理（独立复跑，**未引用**编排器/实现方给出的任何数字）
- **审查档位**：Codex 配额耗尽，**Codex 对抗审查暂停 · 异构档位缺席**（本批含门禁/判定器类改动，commit message 须标注）

> 本报告的每一条结论都附命令与实际输出，供第三方复核。凡"未能独立验证"的地方均显式标注。

---

## 1. 五道门禁实跑结果

全部由本 agent 在本 worktree 内**重新执行**，非引用。

| # | 命令 | 退出码 | 实测数字 | 与 `fix-report.md` 声称值 |
|---|---|---|---|---|
| 1 | `npm run build` | **0** | tsc 零错误；`[postbuild:stamp] 盖章: commit=19bff52a (dirty)` | 一致 |
| 2 | `npx vitest run` | **0** | `Test Files 523 passed \| 4 skipped (527)`<br>`Tests 7154 passed \| 18 skipped \| 21 todo (7193)`<br>Duration 59.70s | **逐字一致** |
| 3 | `npm run test:plugins` | **0** | `ℹ tests 1528 / ℹ pass 1528 / ℹ fail 0` | **逐字一致** |
| 4 | `npm run repo:check` | **0** | `- *: pass` 87 条；warn 0；fail 0<br>含 `graph-quality:ignore-undeterminable: pass` | **一致**（87 项） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` | 一致 |

**无差异。** 编排器上一轮给出的 build 0 / vitest 7154 / plugins 1528 / repo:check 0 / release:check 0 全部复现。

> 一处**非矛盾**的表述差异（已查明，不计问题）：`repo:check` 报 `graph-quality:freshness: pass`，
> 而 `fix-report.md` 引用的独立 `graph-quality` 命令报 `freshness: dirty`。两者不冲突——
> F217 FR-026 明确规定 dirty 态（工作树有未提交改动）**不产生 warning**，故 repo:check 侧计 pass。

---

## 2. 三条缺陷验收的实跑证据

### 缺陷 1 — `.gitignore` 命中但文件不在盘上 ⇒ oracle 判 IGNORED（与 `git check-ignore` 同答案）

**结论：PASS（实跑，6/6 同答案）**

构造 fixture 仓（`$SP/d1/repo`）：根 `.gitignore` 为 `*.log` + `generated/`；`nested/.gitignore` 为 `secret.txt`（F255 嵌套形态）；
tracked 与 untracked、在盘与离盘四象限齐备。用 `tsx` 直接对 `src/utils/gitignore-oracle.ts` 发问，
并与 `git check-ignore` 权威答案逐条对拍：

```
path                     | oracle.verdict | git check-ignore | 同答案?
gone.log                 | ignored        | IGNORED          | YES   ← 缺陷 1 的核心形态（离盘 + 根规则命中）
nested/gone-secret.txt   | not-ignored    | not-ignored      | YES
nested/secret.txt        | ignored        | IGNORED          | YES   ← F255 嵌套 .gitignore 形态
generated/ghost.ts       | ignored        | IGNORED          | YES   ← 缺陷 1 形态（离盘 + 目录规则命中）
nested/deep/keep.ts      | not-ignored    | not-ignored      | YES
ondisk.log               | ignored        | IGNORED          | YES

F255 walk 热路径 createGitignoreFilter('nested/secret.txt') = true（期望 true）
drain = {"count":0,"samples":[],"budgetExhausted":false,"degraded":false}
```

- `gone.log` / `generated/ghost.ts` 是**离盘且规则命中**的两种形态（前者文件规则、后者目录规则），
  两者都判 `ignored`，与 git 同答案 —— 缺陷 1 的原病（离盘一律 fail-open 成 not-ignored）已消除。
- **F255 未回退**：`nested/secret.txt`（在盘 + 被嵌套 `.gitignore` 覆盖）经 walk 热路径 `isIgnoredOnDisk` 仍返回 `true`。
- 全程 `count=0 / degraded=false`，未引入噪声。

### 缺陷 2 — base-ref 不可达时不得静默变 skip-impact

**结论：PASS（实跑）**

```
$ node plugins/spec-driver/scripts/graph-consumption-cli.mjs decide \
    --project-root <worktree> --refresh-policy declined \
    --base-ref deadbeefdeadbeefdeadbeefdeadbeefdeadbeef --format json --dry-run
EXIT=3
{
  "schemaVersion": 4,
  "error": "base-ref-unresolvable",
  "baseRef": "deadbeef...",
  "baseRefResolution": "unresolvable",
  "gitStatus": 128,
  "gitStderr": "致命错误：Not a valid object name deadbeef...^{commit}\n",
  "gitSpawnError": null,
  "hint": "phase 起点锚点不可达（rebase 改写历史会造成该形态）。不得据此判定变更类别；…本次不提供影响面证据。",
  "auditWritten": false
}
[stderr] [error] phase 起点锚点不可信（unresolvable）：deadbeef…
```

- 悬空 ref 名（`refs/heads/no-such-branch-xyz`）同样 **exit 3**，payload 同形。
- **对照组**：可达锚点 `--base-ref HEAD~1` → **exit 0**，正常产出决策
  （`changeClass: modifies-existing` / `coverageScope: in-graph-scope`）—— abort 不是死路，恢复口径可用。
- **不存在静默 skip-impact**：错误路径不产出决策 payload，只产出封闭键集的 error payload，且 `auditWritten:false`。

> **口径订正**：任务书提到的观测字段名为 `baseRefMissing`，实现中实际字段是 **`baseRefResolution: "unresolvable"`**
> （另有 `gitStatus` / `gitStderr` / `gitSpawnError` 三个佐证字段）。字段语义如实、命名与任务书表述不同，非缺陷。

### 缺陷 3 — `.PY` / `.PYI` 不再被判 in-graph-scope

**结论：PASS（实跑，且额外验证了"事实源本身诚实"）**

（a）消费侧逐管线判定（`surfaceMatchesFileMjs`）：

```
 a.py    pyWalk=true   pythonSymbolScan=true
 a.PY    pyWalk=false  pythonSymbolScan=false   ← 缺陷 3 已收口
 a.pyi   pyWalk=true   pythonSymbolScan=true
 a.PYI   pyWalk=false  pythonSymbolScan=false   ← 缺陷 3 已收口
 a.Py    pyWalk=false  pythonSymbolScan=false
 a.ts    tsjsSkeletonWalk=true   moduleDerivationScan=true
 a.TS    tsjsSkeletonWalk=false  moduleDerivationScan=true  ← 语义维两侧不同，被逐管线锚定住
```

（b）跨语言合同：TS 侧 SSoT `computeCollectorFingerprint()` 与 mjs 侧 `GRAPH_SCOPE_SURFACES`
**逐管线 extensions + matchSemantics 完全一致**（五条管线，实跑对拍通过）。

（c）**最关键的一步 —— 判定与真实采集行为是否同解**（不是只做自洽）：
构造仅含 `src/mod_lower.py` / `src/MOD_UPPER.PY` / `src/stub_upper.PYI` 的 git 仓，跑本地 dist 建图：

```
$ node <worktree>/dist/cli/index.js batch --mode graph-only
  节点: 2 | 边: 1 | Python 符号: 1

图节点 id:  src/mod_lower.py  /  src/mod_lower.py::lower_case_fn
含 MOD_UPPER?   false
含 stub_upper?  false
```

即真实采集器**确实只收 lowercase `.py`**，`case-sensitive` 是对运行时行为的如实描述，
消费侧判 `.PY` 面外与生产侧同解。**这条是本阶段独立新增的证据**（此前证据链只到"两侧自洽"）。

---

## 3. 变异证据核查

### 3.1 逐条完整性审阅（`verification/mutation-evidence.md`）

| 段 | 变异条数 | 每条是否有用例全名 | 是否有断言失败输出 | 撤销复核 |
|---|---|---|---|---|
| P1 | M1 / M2 / M3 / M9 / M10（5 条） | ✅ 全有 | ✅ 全有 | ✅ diff + grep 计数 |
| P2 | M6 / M7 / M8（3 条） | ✅ 全有 | ✅ 全有 | ✅ 逐字节 diff + 复跑归零 |
| P3 | M4 / M5（2 条） | ✅ 全有（M4 列 8 条、M5 列 3 条） | ✅ 有（贴前 5 行） | ✅ grep + 复跑归零 |
| 审查修复轮 | MR-1..MR-6（6 条） | ✅ 全有 | ✅ 全有 | ✅ 逐字节还原 5 文件 + 全仓 grep=0 |

**未见"只有描述没有证据"的条目。** 未做变异的两项（M-5 纯文档裁决、M-7 纯注释）已**显式登记**在
「未做变异测试的必修项（如实登记）」一节，并说明 M-5 的行为改由正向用例钉住 —— 登记诚实，不是漏做。

### 3.2 M6 偏差登记的诚实性核实

**结论：诚实，且登记方式值得肯定。**

plan §10.2 预期「M6 ⇒ R3-3 变红」，实测 R3-3 **未**变红。文档没有掩盖，而是：
(a) 明写「与 plan 预期的偏差（如实登记，非守护缺口）」；
(b) 给出机制解释——R3-3 由 `deriveScopeSurfacesFromFingerprint` 的 entry 级严格校验守护，
畸形指纹在进入匹配器**之前**已被整体拒绝，故匹配器变异影响不到它，属**纵深防御**；
(c) 明确拒绝"为让 R3-3 敏感而拆掉 §5.4 entry 校验"（那是把纵深压成单点）。
同时 M6 自身**另有两条用例变红**，守护并未缺席。这条登记比"全部符合预期"更可信。

同类诚实登记还有两处：M5 的 `nameStatusOk:false → unknown` 两条**未**变红（说明 required 与
fail-loud 是两条独立守护）、MR-3 的 `M-3b` **不**变红（说明两条断言各守一侧）。

### 3.3 亲自复现的两条变异（在 scratchpad 副本内注入，工作树零改动）

复现环境：`rsync` 出的独立副本 `$SP/mut`（排除 `node_modules`/`dist`/`.git`，`node_modules` 软链回主仓；
副本内 `git init` + 建 dist）。副本基线残留 6 条 **环境性**失败（全部集中在
`generic-language-skeleton-collector.test.ts`，因 F253 的 tracked-ignored fixture 在副本里 tracked 态不同），
两个目标文件 `tests/unit/gitignore-oracle.test.ts`(24) 与 `tests/unit/graph-quality-core.test.ts`(28) 副本内**全绿**，
故以"新增失败"为判据。

**复现 ①：MR-1（`degraded` 恒 false —— 那条 CRITICAL 的 fail-open 面）**

注入：`src/utils/gitignore-oracle.ts` 的 `const degraded = index === null && hasGitDirUpward(walkBase);` → `false`。

结果：**6 → 10 失败，新增 4 条**：

```
× F255 真实语义锚定… > M-1: 忽略清单预取失败 ⇒ 采集面出声报告降级（不因 count===0 而静默）
× createGitignoreOracle：三态 verdict（F258） > M-1: git 仓内预取失败 ⇒ degraded=true（count 恒 0 不构成"无不可判路径"的证据）
× createGitignoreOracle：三态 verdict（F258） > R1-6: 从子目录扫描 + 畸形 .git ⇒ 降级 warn 恰 1 次
× F258：ignore-undeterminable warn check > M-1: 忽略清单预取失败（三态 oracle 整体降级）⇒ 仍报 warn，且 evidence 标出降级
```

`mutation-evidence.md` 声称 3 条，我实测 4 条 —— 差异原因是我的注入**同时**掐掉了 `if (degraded)` 的
stderr warn（文档版本刻意保留 warn 以证明"只有 stderr 是不够的"），故多杀一条 R1-6。
**方向一致、力度更强，不构成矛盾**。文档声称的三层（oracle / 门禁 core / 采集面）各一条全部复现。

**复现 ②：M4（abort 分支 `return 3` → `return 0`）**

注入：`plugins/spec-driver/scripts/graph-consumption-cli.mjs:440`。

结果：`ℹ tests 110 / pass 101 / fail 9`（基线 110/110/0），**新增 9 条**，含文档列出的全部 8 条
（R2-1 / R2-2 / T054 / R2-5①②③ / --dry-run / gitStderr 截断），外加审查修复轮新增的
`锚点可解析但 git diff 失败 → 同样 exit 3`。文档写 8 条是 P3 当时的实数，本轮用例增加后为 9 条，**不是缩水**。

两条变异均已**逐字节还原**（`diff -q` 无输出，`grep -c MUTATION` = 0），且还原后复跑归零。

> **方法学脚注（供第三方复现时避坑）**：vitest 的 globalSetup 会在跑测时**重建 dist**。
> 若在副本内注入变异 → 跑 vitest → 撤销源码但**不重建 dist**，随后任何走 `dist/` 的验证都会
> 读到带变异的产物。本 agent 一度因此误判 §5 的 fail-loud 复核失败，重建 dist 后消失。
> 撤销变异后 **MUST 重跑 `npm run build`** 再做任何 dist 级验证。

---

## 4. 回归护栏逐条对照

| 护栏 | 判据 | 实跑证据 | 结论 |
|---|---|---|---|
| **F255 原病不回退**（嵌套 `.gitignore` 覆盖的文件不再入图永判 fresh） | 嵌套规则命中的在盘文件仍判 ignored | §2 缺陷 1 表：`nested/secret.txt` → `ignored`（与 git 同答案）；walk 热路径 `isIgnoredOnDisk` 亦返回 `true` | ✅ 未回退 |
| **F217 六指标** | 本仓重建后全 pass | 见下方 §4.1 | ✅ pass |
| **F193 加载期 stale / F249 collector 指纹** | 判据输入结构不变、版本未被本次 bump | `git diff 19bff52a -- src/panoramic/graph/collector-fingerprint.ts` 中 `BEHAVIOR_VERSION` / `formatVersion` **数值行零改动**（当前值 `formatVersion:1` / `behaviorVersion:2`，均为 F254 既有值） | ✅ 无冲突 |
| **F254 图自述面优先** | `scopeExtensionsSource` 仍优先取图指纹 | 实跑 decide 输出 `"scopeExtensionsSource": "graph-fingerprint"`、`"coverageUnionApplied": false` | ✅ 无冲突 |
| **判据互不打架**（不能一个说 fresh 一个说 stale） | 同一图态下各判据同向 | 本仓：`freshness dirty`(CLI) / `pass`(repo:check，FR-026 规定 dirty 不 warn)；副本仓：CLI `stale [staleReasons: source-commit]` 与 core 侧同向 | ✅ 一致 |
| **降级路径 fail-loud** | 打坏 `git ls-files` 门禁仍出声 | 见下方 §4.2（**本 agent 独立构造复现**） | ✅ 出声 |

### 4.1 本仓六指标（**本地 dist**，未使用 PATH 上的全局 `spectra`）

```
$ node <worktree>/dist/cli/index.js batch --mode graph-only
  节点: 7539 | 边: 12683 (calls 3829, depends-on 2608) | Python 符号: 16 | 耗时: 5.2s

$ node <worktree>/dist/cli/index.js graph-quality
  Overall Verdict: pass
  [duplicate-canonical-id] pass
  [contains-coverage]      pass (6246/6246, 100.0%)
  [orphan-ratio]           pass (超标 0/6246, 0.0%; 全节点 zero-degree 率 1.5%)
  [dangling-edge]          pass
  [legacy-ignored]         pass
  [freshness]              dirty（工作树有未提交改动，属预期）
  Next steps: 图可能未反映未提交改动…
```

节点/边/覆盖率数字与 `fix-report.md` 记载**逐字一致**。`nextSteps` **无** `[ignore-undeterminable]` 条目
⇒ 本仓既无不可判路径、三态 oracle 也未降级。

### 4.2 降级 fail-loud 的独立复现（本 agent 自建，非复核他人结论）

构造 PATH shim：只让 `git ls-files … --ignored …` 这一条命令 exit 128，其余 git 命令原样透传
（shim 日志确认命中：`SHIM2 CALLED: ls-files --others --ignored --exclude-standard --directory -z`）。

**人读通道（stderr）**：

```
⚠ git 仓库内忽略清单预取失败，已降级为仅根 .gitignore 近似过滤
[graph-quality] [ignore-undeterminable] [oracle-degraded] git 仓库内忽略清单预取失败…
三态忽略判定已整体降级为仅根 .gitignore 近似解析的二态结果：本次运行**不产出**不可判计数，
因此"0 个不可判路径"不构成"忽略判定无盲区"的证据…
```

**机读通道（`nextSteps`）**：同一条文案进入报告 `Next steps`，含 `[ignore-undeterminable] [oracle-degraded]` 双 token。

**真正的门禁侧（`scripts/lib/graph-quality-core.mjs`，repo:check 消费者）**：

```json
{ "id": "ignore-undeterminable",
  "title": "图质量门的忽略判定无不可判路径、且三态 oracle 未降级",
  "status": "warn",
  "evidence": { "detail": "[ignore-undeterminable] [oracle-degraded] …", "degraded": true } }
```

**这条是 M-1 那个 CRITICAL 的终验**：同一构造下 `[legacy-ignored]` 确实从 `fail (ignored: 5)` 翻成 `pass`
（因为 oracle 退成二态近似），但**不再静默** —— 门禁同时报 `warn` 且 `degraded:true` 进入结构化 evidence。
"打坏 git 就能让门全绿"已不成立。编排器给出的结论独立复现成功。

---

## 5. defer 项登记完整性核查

| defer 项 | 登记位置 | 登记是否如实 | 结论 |
|---|---|---|---|
| **P2 对抗 C-1/W-1**：`coverageUnionApplied` 在 `freshness=fresh` 时把 union 面当真相面 ⇒ 全信 `consume-impact` | `graph-consumption-cli.mjs:597-605` + `graph-consumption-decision.mjs:74-84` + `review-round-decisions.md` D-1 + `fix-report.md` | **如实，且是本次做得最好的一处** | ✅ PASS |
| **4b W-4**：诊断走 `nextSteps` 文本契约 vs schema 可选字段 | `review-round-decisions.md` D-2 + `fix-report.md:403` + `graph-quality.ts:296-311` | 如实，并**主动加码**承认本轮新增 `[oracle-degraded]` **加深**了对文本契约的依赖 | ✅ PASS |
| 其余 I 级问题 | `review-round-decisions.md:88` | 「全部 defer，未逐条落账（本 agent 未拿到审查原始全文，只拿到编排器分流后的必修清单）」 | ⚠️ 见 INFO-4 |

**C-1/W-1 的 over-claim 撤回已逐字核实**（这是任务书点名要查的）：

- `graph-consumption-cli.mjs`：原话「不会反向」已被显式标注 `⚠️ **但"不会反向"这句原话是 over-claim，
  已按实证撤回（F258 审查修复轮）**`，随后**正面描述了那个反向方向**（fresh × allowed 时落在 union 内、
  图自述面外的目标拿到全信 `consume-impact`，且 annotate 侧同时静默），并注明「病灶来自 F254 W-1 而非本 fix，
  按独立 fix 卡登记」「这里只保证登记如实——原文案会让下一轮审查者按"方向安全"放过它」。
- `graph-consumption-decision.mjs`：`C-002` 的 JSDoc 改为「**C-002 的现状要如实说**…"两处判据消费同一份面"
  这句话在 `refresh-policy=allowed` 下**已经不成立**」，并点明两侧同时静默的后果。

**判定：over-claim 已改写为如实表述，且 defer 理由（pre-existing / 来自 F254）经我核对属实**
（`coverageUnionApplied = refreshAllowed && derived.surfaces !== null` 的 union 分支逻辑确非本次引入）。

---

## 6. [Spec 合规] 结论

**总评：PASS（含 1 项 WARNING、4 项 INFO）**

### 6.1 tasks.md 勾选态抽查（5 条，逐条核实产物真实存在）

| 任务 | 声称产物 | 实际核实 | 结论 |
|---|---|---|---|
| T022（契约注释重写，4 文件） | 撤下"以 git 本体为事实源"over-claim | `src/utils/file-scanner.ts:9`、`python-adapter.ts:163`、`source-discovery.ts:268,429`、`collector-fingerprint.ts:87`、`gitignore-oracle.ts:10` 全部改为**反面引用**（"不得再写成…"/"已删除"） | ✅ 真实 |
| T054（3 种异常 ref 退出码谱） | 实测退出码 + 收口 exit 3 | 用例 `T054 三种异常 ref 形态…全部收口到 exit 3` 存在且在 M4 变异下变红；本 agent 另实跑 2 种形态确认 exit 3 | ✅ 真实 |
| T070（本仓 graph-only + 六指标） | 六指标全 pass | §4.1 本 agent 复跑，数字逐字一致 | ✅ 真实 |
| T081（M-4 越界守卫） | `isOutsideWalkBase` | `src/utils/gitignore-oracle.ts:340-344` 实存并被 `computeVerdict:439` 调用；KL-2 表同步更新 | ✅ 真实 |
| T085（制品回填） | 4 份制品 | `fix-report.md` 有「验证结果」节、`review-round-decisions.md` 新建、`mutation-evidence.md` 有「审查修复轮」段、tasks.md 85/85 勾选 | ✅ 真实 |

**抽查 5/5 全部为真，无"推定勾选"。** tasks.md 共 85 条，全部勾选、0 条未勾。

### 6.2 KL-1..KL-6 是否用测试钉住**实际行为**（而非期望行为）

| KL | 钉桩用例 | 钉的是实际行为？ |
|---|---|---|
| KL-1 | `R1-5: KL-1 已知限制（非 bug）——嵌套未注册 git 仓内的**在盘**路径仍判 not-ignored` | ✅ 断言 `not-ignored`（**与 git 的 IGNORED 分叉**），钉的是分歧本身 |
| KL-2 | `KL-2 已知限制：离盘不可判形态族` 2 条 + `M-4: 在盘的仓外绝对路径 / .. 越界 ⇒ undeterminable 且计数出声` | ✅ 且 M-4 修复后**文档承诺与运行时已对齐** |
| KL-3 | `M-3: L3 只信 files 的逐条肯定答复，不消费 --directory 折叠前缀` + `M-3b`（反向） | ✅ 双向钉住 |
| KL-4 | `KL-4 已知限制（非 bug）——未提交的 .gitignore 改动即可翻转 ignoredPathNodeIds` | ✅ 断言"同一 HEAD 下结论翻转"这一**缺陷现状** |
| KL-5 | `R1-8: KL-5 …在盘 symlink 穿越判 not-ignored 且静默不计数` | ✅ 断言"静默不计数"这一**不理想的实际行为** |
| KL-6 | `R1-9: KL-6 …未归一化 / 大小写不一致的输入落在盘分支且静默` | ✅ 同上 |

**全部钉的是实际行为，不是期望行为** —— 这正是 KL 表该有的写法（KL-4/KL-5/KL-6 三条明确断言了"错的/静默的"当前结论）。

**INFO-2**：任务书写的是「KL-1..KL-7」，但 **KL-7 并不存在**。`review-round-decisions.md` M-4 一行已说明：
"**未**采用备选的『改写 KL-2 + 新增 KL-7』分支"——即 KL-7 是被否决的设计分支，现行 KL 表为 **KL-1..KL-6**。
任务书的编号是陈旧引用，不是制品缺口。

### 6.3 fix-report.md「验证结果」节的 over-claim 扫描

- 五道门禁数字：**与我实跑逐字一致，零 over-claim**。
- 本仓 graph-only 复跑数字：**逐字一致**，且已自我限定为「零信息量回归护栏，**不是**缺陷 1 的验收证据」——这句限定是诚实的。
- 净增用例「vitest +16 / plugins +1」：未独立复核（需 checkout 基线，受"禁 git 写操作"约束），**标注为未验证项**。
- **INFO-1（唯一发现的数字瑕疵）**：`fix-report` M-7 行称「全仓 `grep "以 git 本体为事实源"` 现仅剩 **4 处**」，
  实测为 **6 行 / 5 文件**（见 §6.1 T022）。**方向无害**（多出的 2 处同样是反面引用，结论"全部是不得这么写的反面引用"仍成立），
  属计数口径笔误，非 over-claim。

---

## 7. [代码质量] 结论

**总评：PASS（含 1 项 WARNING、2 项 INFO）**

### 7.1 值得肯定的部分

- **三态建模的收口方式正确**：`undeterminable` 由两类消费方（采集面 / 图质量门）**同向**收口为 not-ignored，
  避免了"无差别 fail-loud 刷屏"与"fail-open 复活原病"两个坏方向；诊断经有界 `drainUndeterminable()` 取回。
- **出声判据 `count > 0 || degraded || budgetExhausted` 是正确的三出口**，且两个纯函数
  （`shouldVoiceUndeterminable` / `describeUndeterminable`）被导出直测 —— 这是让 `budgetExhausted`
  这个 E2E 成本极高的出口**能被变异杀死**的唯一务实做法。
- **`degraded` 的粘性语义 + drain 不重置**处理正确。
- **defer 项的 over-claim 撤回**（§5）示范性强：不只是删掉错话，而是把**反向的危害**正面写出来，
  并说明"下一轮审查者会按原文案放过它"。

### 7.2 WARNING-1 —— `BEHAVIOR_VERSION` 不 bump 的**书面论证在一点上可被证伪**（结论仍成立，理由需更正）

**这是本阶段独立发现的问题，此前三份审查与变异测试均未覆盖。**

书面论证（`probePresence` JSDoc、M-4 裁决、`fix-report`）反复使用同一句：
> 走本出口后消费方按 `not-ignored` 处理 = **与旧行为逐字节一致**，故 `gitignore-interpretation`
> 责任项未被触发、`BEHAVIOR_VERSION` 不 bump。

该句对 M-4（`isOutsideWalkBase`）成立，但对 **M-3 把 L3 从 `prefetchLookup` 收窄为 `prefetchFileLookup`** **不成立**。
我构造出了可复现的反例：

```
.gitignore 内容: "col/"          ← 目录型规则 ⇒ git 真折叠，不列内部条目
$ git ls-files --others --ignored --exclude-standard --directory
col/                              ← files 集合中没有 col/a.ts
$ git check-ignore -q -- col/a.ts ; echo $?
0                                 ← git 权威答案 = IGNORED
$ chmod 0444 col                  ← lstat(col/a.ts) ⇒ EACCES ⇒ 落 L3

verdict('col/a.ts') = undeterminable
drain = {"count":1,"samples":["col/a.ts"],…}
```

- **修复前**（二态 `prefetchLookup`，含 `dirPrefixes`）：`col/a.ts` 命中折叠前缀 `col` ⇒ `ignored` ⇒ **跳过**。
- **修复后**（L3 只查 `files`）：`undeterminable` ⇒ 消费方按 not-ignored ⇒ **照常采集**。

即被采集的文件集合**确实会变**，"逐字节一致"在这一支被证伪。

**为什么最终结论（不 bump）仍然正确**：`generic-language-skeleton-collector.ts::walkFiles` 在**目录层**就剪枝：

```ts
if (entry.isDirectory()) { … if (isIgnored(relativePath)) continue; }
```

`col` 本身在盘、走 L1 查表命中 `dirPrefixes` ⇒ 判 ignored ⇒ **整个目录被剪掉，walk 永不询问 `col/a.ts`**。
任何能匹配 `X/y` 的折叠前缀 `X` 都必然在 walk 中先被询问并剪枝，故该形态在**采集面结构性不可达**。

**问题在于：真正成立的是"walk 目录层剪枝"这个论证，而制品里写的是"逐字节一致"那个已被证伪的论证。**
按本仓自己的教训（M-4 / M-7：*"文档承诺了运行时没做的事比行为缺陷更危险，下一轮审查者会按它放过"*），
这属于同类问题 —— 一个**看起来已论证、实则论证有洞**的不变量。

补充说明：图质量门侧（`legacy-ignored-check`，输入是图节点 filePart、**无目录剪枝**）该形态**是可达的**，
判定会从 `ignored` 变为 `undeterminable`；但那里 `count` 会 +1 并出声（实测 `count:1, samples:["col/a.ts"]`），
属**有声降级**而非静默，危害等级低。

**建议处置（不阻断交付）**：把 `probePresence` / M-4 裁决里的"逐字节一致"论证按支拆开——
M-4 支保留原论证，M-3 支改为"采集面由 walk 目录层剪枝保证不可达；图质量门侧可达但计数出声"，
并补一条钉住剪枝前提的用例（一旦有新消费方绕过 walk 直接对文件路径发问，该前提即失效）。
建议以独立 fix 卡登记，与 §5 的 C-1/W-1 同批。

### 7.3 INFO-3 —— KL-2 submodule 用例存在**环境性空过**风险

`tests/unit/gitignore-oracle.test.ts:639` 在 `git submodule add` 失败时 `console.warn('[skip] …')` 后
**直接 `return`** —— 该用例会**计入 pass 但一条断言都没跑**。本机实测该分支**未**触发
（`npx vitest run tests/unit/gitignore-oracle.test.ts` → 24 passed，无 `[skip]` 输出），故当前证据有效。
但在禁用 `file://` submodule 的 CI 上，这条会静默退化为空过（与本 fix 一贯反对的"沉默即绿灯"同型）。
建议改用 `it.skip` / `ctx.skip()` 让跳过在报告中**可见**。

### 7.4 INFO-4 —— I 级审查项未逐条落账

`review-round-decisions.md:88` 如实说明「其余 I 级问题全部 defer，未逐条落账（本 agent 未拿到审查原始全文，
只拿到编排器分流后的必修清单）」。**登记本身诚实**（明确交代了信息缺口的来源），但客观后果是
I 级项目前**没有可追溯清单**，下一轮无法核对是否遗漏。建议由编排器补挂三份审查原文或 I 级条目索引。

---

## 8. 总评

### 8.1 结论：**可交付**（READY，附 1 项 WARNING 建议以独立 fix 卡登记）

| 维度 | 结论 |
|---|---|
| 五道门禁 | ✅ 全过，**数字与 fix-report 逐字一致，零差异** |
| 三条缺陷验收 | ✅ 全部**实跑**达成（缺陷 3 另补了"事实源诚实性"这一层此前缺失的证据） |
| 变异证据 | ✅ 16 条全部有用例全名 + 断言输出 + 撤销复核；亲自复现 2 条（MR-1 / M4）均变红 |
| 偏差登记诚实性 | ✅ M6 偏差、M5/M-3b 未变红、M-5/M-7 未做变异 —— 三处均主动登记且解释机制 |
| 回归护栏 | ✅ F255 未回退；F217 六指标 pass；F193/F249/F254 判据输入零改动、无相互矛盾 |
| 降级 fail-loud | ✅ 独立构造复现：stderr + `nextSteps` + 门禁 `warn` + 结构化 `degraded:true` 四通道齐发 |
| defer 登记 | ✅ C-1/W-1 与 W-4 均如实，over-claim 已按实证撤回；I 级项未逐条落账（INFO-4） |
| Spec 合规 | **PASS**（1 WARNING / 4 INFO） |
| 代码质量 | **PASS**（1 WARNING / 2 INFO） |

### 8.2 问题清单（无 CRITICAL）

| 级别 | 编号 | 摘要 | 建议 |
|---|---|---|---|
| ⚠️ WARNING | W-1 | `BEHAVIOR_VERSION` 不 bump 的书面论证（"逐字节一致"）在 M-3 的 L3 收窄支**可被证伪**；结论仍对，但真正的理由是 walk 目录层剪枝，未写下来 | 拆分论证 + 补钉剪枝前提的用例；独立 fix 卡 |
| ℹ️ INFO | I-1 | `fix-report` 称 over-claim 残留「仅剩 4 处」，实测 6 行 / 5 文件（方向无害） | 订正计数 |
| ℹ️ INFO | I-2 | 任务书引用「KL-1..KL-7」，实际 KL-7 不存在（被否决的设计分支），现行为 KL-1..KL-6 | 订正引用 |
| ℹ️ INFO | I-3 | KL-2 submodule 用例失败时 `return` ⇒ 环境受限 CI 上会**空过计 pass**（本机未触发） | 改 `ctx.skip()` 让跳过可见 |
| ℹ️ INFO | I-4 | 三份审查的 I 级条目未逐条落账（缺口来源已如实说明） | 编排器补挂原文/索引 |
| ℹ️ INFO | I-5 | 「净增用例 vitest +16 / plugins +1」未独立复核（需 checkout 基线，受禁 git 写操作约束） | 标注为未验证项 |

### 8.3 硬约束遵守声明

- 全程**零 git 写操作**（无 stash / checkout / commit / add / reset / clean）。
- **未修改**工作树任何源码与测试；本 agent 仅写入本报告一个文件。
- 变异注入全部在 scratchpad 副本 `$SP/mut` 内完成，两条变异均已逐字节还原并复跑归零。
- 未使用 `-u`，未更新任何快照。
- 工作树内唯一被写入的产物是 `specs/_meta/graph.json`（§4.1 的 graph-only 重建）——
  该路径由 `.gitignore:80 specs/_meta/` 覆盖，**非 tracked 源码**，且任务书明确要求执行该步。
- 所有 spectra CLI 调用均使用 `node <worktree>/dist/cli/index.js` 显式本地路径，
  **未**使用 PATH 上的全局 `spectra`（旧产物 `v4.4.0 (0ae3eb7)`）。
