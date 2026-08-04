# 验证报告 — F256 fix 依从性判定器两处误报盲区

**验证时间**: 2026-08-05
**验证基座**: HEAD `27ca1372` + worktree 未提交改动（17 文件 / +1789 −20）
**工作目录**: `.claude/worktrees/priceless-taussig-d61d73`
**总体结论**: ✅ **PASS**（0 CRITICAL / 0 WARNING / 3 INFO）

本报告的每一条结论均由验证者**亲自执行命令**取得，未采信 implement / review 子代理的任何声称。
所有 before/after 对照均以 `git show HEAD:<path>` 抽出的**改动前版本**在 scratchpad 中实跑对照，
全程零 git 写操作、除本文件外零文件改动。

---

## Layer 2 · 门禁矩阵（全部亲自重跑）

| # | 命令 | 退出码 | 实际输出摘要 | 判定 |
|---|------|--------|-------------|------|
| 1 | `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs` | 0 | `tests 553 / suites 80 / pass 553 / fail 0`（1.26s） | ✅ PASS |
| 2 | `node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` | 0 | `tests 60 / suites 12 / pass 60 / fail 0`（0.09s） | ✅ PASS |
| 3 | `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | 0 | `tests 158 / suites 32 / pass 158 / fail 0`（6.80s） | ✅ PASS |
| 4 | `npm run test:plugins` | 0 | `tests 1484 / suites 256 / pass 1484 / fail 0`（36.3s） | ✅ PASS |
| 5 | `npx vitest run` | 0 | `Test Files 522 passed \| 4 skipped (526)` / `Tests 7110 passed \| 18 skipped \| 21 todo (7149)`（61.1s） | ✅ PASS |
| 6 | `npm run build` | 0 | `tsc` 零错误；postbuild 盖章 `commit=27ca1372 (dirty)` | ✅ PASS |
| 7 | `npm run repo:check` | 0 | 全族 pass，**1 条 warn**：`graph-quality:freshness` | ✅ PASS（warn 见下） |
| 8 | `npm run release:check` | 0 | `Release contract valid (contracts/release-contract.yaml)` | ✅ PASS |

**关于 #7 的 warn（据实标注，与本改动无关）**：
`[graph-quality] 图产物已 stale（source-commit, collector-fingerprint-unrecorded）：图记录的
sourceCommit 8d25c264… ≠ 当前 HEAD 27ca1372…`。图快照停在 F252 的 `8d25c264`，本次改动未触碰任何
图采集/建图代码路径（改动面全在 `plugins/spec-driver/scripts/`），属**预存**告警，不计入本次结论。

---

## 验证证据核查（逐条实测，非复述）

### E1 · 盲区 1 端到端：真实 F254 transcript + 重编号后的目录 → `compliant: true`

**PASS**（before/after 双跑对照）

复现命令：

```bash
T=~/.claude/projects/-Users-…-worktrees-serene-taussig-2c33c3/f3f2fe3b-5458-4dbe-8dab-cb9fb6e3966a.jsonl
# after（当前 worktree）
node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode report --transcript-path "$T" --project-root "$PWD"
# before（git show HEAD 抽出的改动前三文件跑同一份 transcript）
node <scratchpad>/base/scripts/fix-compliance-judge.mjs --mode report --transcript-path "$T" --project-root "$PWD"
```

| | closureForm | compliant | missing |
|---|---|---|---|
| **改动前**（HEAD `27ca1372`） | `undetermined` | `false` | `["feature-dir","fix-report.md"]` |
| **改动后**（本次改动） | `repair` | **`true`** | `[]` |

两侧 `delegationCounts` 逐字相同（`{implement:1, verify:3, other:3}`），确认差异**只**来自目录重锚定，
未顺手放宽任何委派判据。transcript 为 649 条 / 2.3 MB 的真实交付会话；磁盘侧 `specs/254-fix-graph-scope-extensions/`
制品齐备（fix-report.md + verification/verification-report.md）。fix-report §「证据基线」逐字复现的
签名 A 亦得到确认。

### E2 · 盲区 2 端到端：六个 stop 时点的在途检出

**PASS**（按 transcript 时间戳逐点截断回放，`head -n` 生成 6 份截断样本各跑一次 `--mode report`）

| stop 时点 | 截断至行号 | 实测 `inFlightDelegations` | 实测 `missing` | 是否全在白名单 | 结论 |
|-----------|-----------|---------------------------|---------------|--------------|------|
| 16:32:26 | 164 | 1 × `send-message` (`ad602324a1dd9715a`) | `["delegation:verify"]` | ✅ 是 | 检出在途 → **推迟** |
| 16:33:41 | 184 | 1 × `send-message` (同上) | `["delegation:verify"]` | ✅ 是 | 检出在途 → **推迟** |
| 16:48:49 | 232 | 1 × `send-message` (同上) | `[]`（compliant） | — | 检出在途（见 INFO-1） |
| 03:03:46 | 596 | **0** | `[]` | — | **不检出** → 正常裁决 |
| 03:05:02 | 611 | **0** | `[]` | — | **不检出** → 正常裁决 |
| 03:07:20 | 643 | **0** | `[]` | — | **不检出** → 正常裁决 |

「在途数」一列与 fix-report §「检测判据」表（1/1/1/0/0/0）**逐行吻合**。
同时确认 fix-report 主张的**正交性**成立：盲区 1 的三个 stop（03:0x）在途集合恒为空，
在途检测器没有"顺手治好"盲区 1 而掩盖其真实修复。

wire-format 断言亦经独立复核（自写 python 统计，非引用）：该 transcript 后台 Agent **0** 个、
同步 Agent **7** 个、`SendMessage` **7** 个、user 型 `<task-notification>` **10** 条 / 可提取配对 **10** 对
——与 fix-report §「关键取证」逐数吻合，其"任务描述建议的『缺 tool_result』检测法 0 命中"的证伪成立。

### E3 · CRITICAL 已闭合：坍塌会话 + `is_error` 后台派发 → exit 2

**PASS**（自建对抗 fixture，独立于仓库既有测试）

我不采信仓库自带用例，另写 `probe.mjs` 直接 spawn CLI 端到端复现三种绕过构造：

| 探针 | 构造 | 实测 | 判定 |
|------|------|------|------|
| **C1** | fix 展开 + 0 委派 + 0 制品 + 一次 `run_in_background:true` 派发且其 `tool_result` 为 `is_error:true` | `inFlight=[]`、`missing=["feature-dir","fix-report.md"]`、**exit 2** | ✅ 规则 2 的有效性门槛生效 |
| **C2** | 同上但后台派发**回执成功**（无完成通知）→ 在途**真成立** | `inFlight=[{kind:"background",id:"bg2"}]`、`missing=["feature-dir","fix-report.md"]`、**exit 2** | ✅ 闸门一（1c）独立生效 |
| **C3** | `Write` 提名目录但无制品 + `SendMessage` 在途（回执成功） | `inFlight` 非空、`missing=["feature-dir","fix-report.md"]`、**exit 2** | ✅ 同上 |

C1 与 C2 共同证明该 CRITICAL 是**双层**闭合的：即便攻击者构造出货真价实的在途信号（C2 绕过了规则 2 的
回执门槛），闸门一仍因 `feature-dir` / `fix-report.md` 不在白名单而拒绝推迟。单靠任一层都不够，两层都在。

### E4 · 有界化真的收敛：有限步内 推迟 → 阻断 → 降级

**PASS**

构造：制品齐备（fix-report.md + verification-report.md）+ implement 委派齐 + **缺 verify 委派**
（`missing=["delegation:verify"]`，全在白名单）+ 一条向永不响应 agent 的 `SendMessage`（在途恒成立）。
同一 `session_id` 连续跑 7 次 hook：

```
实测退出码序列: [0, 0, 0, 2, 2, 0(GATE-DEGRADED), 0(GATE-DEGRADED)]
                 └─ 推迟 ×3 ─┘  └ 阻断 ×2 ┘  └── FR-006 降级放行 ──┘
```

与设计声称（`IN_FLIGHT_DEFER_LIMIT=3` → `BLOCK_LIMIT=2` → 降级）**逐位吻合**。恒在途会话在 **5 步内**
必然走完全部裁决，不存在无限推迟。同时确认推迟**未**消耗阻断预算（3 次推迟后阻断计数仍从 0 起算）。

补充（E5）：把 `<task-notification>` 补进同一 transcript 后在途集合归零、恢复 exit 2 —— 确认推迟是
"时机未到"而非"永久豁免"，通知一到即照常裁决。

### E5 · `feature-dir` / `fix-report.md` 不可推迟（1c 闸门）

**PASS** — 由 C2 / C3 直接证实（在途成立但缺口含这两项 → exit 2）。
代码侧亦复核：`DEFERRABLE_MISSING_KEYS` 仅四项，`isDeferrableMissingSet` 取**全称**判定，
空集返回 `false`（fail-closed）。

### E6 · 载重经验数据的独立复算（反 over-claim 关键项）

fix-report / contract 把"推迟必须有界"的全部论证压在一组实测数字上。这组数字若是编的，整个有界化
设计就没有依据。**我另写扫描脚本重跑了一遍全量 transcript**（未复用其任何脚本或结论）：

| 断言（文档声称） | 我的独立扫描结果 | 判定 |
|---|---|---|
| `run_in_background:true` 派发 **202** 次 | **202** 次 | ✅ 逐数吻合 |
| 其中从未收到匹配 `<tool-use-id>` 通知 **43 次（21.3%）** | **43 次（21.3%）** | ✅ 逐数吻合 |
| Agent 派发总数 **1293**，未显式写字段 **29.2%** | **1297** 次 / **29.1%**（本机现为 2473 份 transcript，较其取证时多 7 份，差值即新增会话） | ✅ 实质吻合 |

结论：**"通知必达"确被真实数据证伪，反例自然发生率 21.3%**。据此把无界推迟改为有界，是有据可依的
真修复，不是纸面论证。

---

## 反向核查 · over-claim 审计

逐条比对 `fix-report.md` / `contracts/fix-compliance-judge-cli.md` / `spec.md` FR-015 矩阵 / schema
与代码**实际行为**，结论：**未发现 over-claim，未发现残留已被证伪的断言**。

| 文档断言 | 代码/实测核对 | 结论 |
|---|---|---|
| 初稿"通知必达 ⇒ 推迟无需上界"的论证 | fix-report 与 contract 均以 `⚠️` 显式保留原文并标注"已被实测证伪"，随后给出修订版 | ✅ 如实，未粉饰 |
| "两道闸门任一不满足即恢复完整裁决，不存在永久免于裁决的会话" | E3/E4 实测证实（C2 破闸门一 → 阻断；E4 破闸门二 → 5 步收敛） | ✅ 与实际行为一致 |
| "推迟不递增阻断计数、`blockCount` 记 `null`、`degraded` 记 `false`" | 代码 `buildAuditEvent({blockCount:null, degraded:false})`；schema `blockCount` 描述已同步补上该分支 | ✅ 一致 |
| "对 block 与 warn 两档一视同仁" | 推迟分支插在 compliant 早退之后、warn 分支之前 | ✅ 一致 |
| "持久化失败即不推迟（fail-closed）" | 代码 `if (saved.ok) {…return 0} deferExtraDiagnostics.push('state-storage-unavailable')` 后落回 `routeBlock` | ✅ 一致 |
| 已知限界"规则 2 只认显式 `run_in_background===true`，29.2% 派发未写该字段" | 代码 `block.input.run_in_background !== true → continue`；我复算得 29.1% | ✅ **主动登记了对自己不利的限界**，方向为 fail-closed（欠触发=多阻断） |
| 已知限界"短名兜底把 F227 限界一从『精确提名』放宽到『同 short-name 任一编号』" | 代码路径确如所述；且冒用者本可直接提名目标目录，非新开攻击面 | ✅ 如实登记 |
| 单调性"只可能把改动前阻断转为改动后放行" | 结构性复核：兜底整体包在 `candidate.ambiguous===false && !usable(resolvedPath)` 内；`featureDirUndetermined` 仅在 `ambiguous===true` 时为真，兜底不可能翻转它；主候选可用时循环与兜底均不执行 | ✅ 结构成立，非仅口头 |
| "`.filter(usable)` 是承重判据（防选中空壳）" | 代码确有该过滤；仓库变异钉子 M10/M11 覆盖；逻辑独立复核成立 | ✅ 一致 |
| 计数口径订正（16:48 由 2 改记 1，按 agent 去重） | E2 实测该点确为 1 | ✅ 订正后的口径才是对的 |
| 合同新增诊断码 | `delegation-in-flight` / `delegation-in-flight-budget-exhausted` 均已入 schema enum；judge-cli 测试含合同同步用例 | ✅ 同步完成 |

**未能由我独立复算的一项（如实标注，非缺陷）**：fix-report / contract 中"174 个不合规 fix 会话中 9 个
（5.2%）曾因在途被静默推迟"。该统计需对全量 transcript 逐份跑判定且结果强依赖各自 projectRoot 的
历史磁盘状态，本次不具备可复现条件。判定其**非载重**：闸门一（`DEFERRABLE_MISSING_KEYS` 全称判定）
的必要性已由 E3 的 C2/C3 直接证实，不依赖该比例数字成立。

---

## 回归面结论

| 既有 Feature | 不变量 | 核查方式 | 结论 |
|---|---|---|---|
| F208 | 坍塌会话（0 委派 0 制品）必 exit 2 | 自建探针 C1/C2/C3 全 exit 2 + 仓库用例全绿 | ✅ 未推翻 |
| F216 | no-op 收口证据门（118 处标注用例） | 三文件 771 用例零失败 | ✅ 未推翻 |
| F224 | 改名/原地编辑盲区 + fail-open **按维度**收窄（22 处） | 同上；且 `featureDirUndetermined` 判据逐字未动 | ✅ 未推翻 |
| F227 | 候选历史兜底 + `usable()` 谓词（9 处） | 新兜底**串接在其后**，未改其语义；先跑历史兜底、未命中才进新分支 | ✅ 未推翻 |
| F230 | 伪造 mv fail-open + 降级下界取交集（9 处） | `hasVerifyClassDelegation` 段逐字未动 | ✅ 未推翻 |
| F231 | 改名跟随只认光杆单命令（19 处） | `scanRenameCommandEvents` **逐字未动**——本次刻意从磁盘侧兜底，不回头放宽 bash 解析 | ✅ 未推翻（且方向正确） |
| F240 | transcript 方言识别 / 零落盘（13 处） | 同上，识别链路未触碰 | ✅ 未推翻 |
| 全仓 | TS 主线 | `npx vitest run` 7110 passed / 0 failed | ✅ 未推翻 |

向后兼容：`inFlightDeferCount` 缺字段按 0 起算（`normalizeState`），F256 之前写下的状态文件可直接读；
`saveBlockState` 为整体覆写，三处写入点均已显式带回不打算改动的字段（代码逐点复核 + 仓库回归钉子覆盖）。

---

## 遗留风险 / 已知限界（均已在制品中如实登记，本次不消除）

1. **规则 2 检测面偏窄**：只认显式 `run_in_background === true`，实测 29.1% 的 Agent 派发未写该字段。
   欠触发方向 fail-closed（多阻断，不误放行），且已声明顺序约束"先有界化，再考虑放宽"。
2. **短名兜底扩大了 F227 已知限界一**：从"必须精确提名该目录"放宽到"提名同 short-name 的任一编号"。
   属被接受限界的边际扩大——冒用者原本直接提名目标目录即可达成同样效果。
3. **恒在途仍可推迟 3 次**：向真实存在但恒不响应的 agent 重复派发，最多换来 3 次推迟，之后恢复裁决。
   属有意的预算设计，非缺陷。
4. **推迟在 warn 档同样消耗预算**：与 contract 声称一致（"两档一视同仁"），非偏差，仅此备案。

## INFO（不影响结论）

- **INFO-1**：E2 中 16:48:49 一行今日回放得 `compliant:true`（当时为签名 B 不合规）。原因是当前磁盘上
  `specs/254-…/` 制品已齐备，而 `--mode report` 的制品判据走**当下磁盘**。该行的「在途数=1」仍逐字复现，
  fix-report 该表描述的是**检测器行为**而非磁盘态，故不构成 over-claim。
- **INFO-2**：`repo:check` 的 `graph-quality:freshness` warn 为预存（图记于 `8d25c264` ≠ HEAD），与本改动无关。
- **INFO-3**：`postbuild` 盖章显示 `(dirty)`，因验证时工作区含未提交改动，属预期。

---

## 总体结论

✅ **PASS** — 8 条门禁全绿（含 1 条预存 warn）；两处盲区的端到端修复效果由 before/after 双跑实证；
第 2 轮三路对抗审查收敛出的 CRITICAL（无界吸收态）经自建对抗探针确认**双层闭合**（回执门槛 + 可推迟性闸门），
有界收敛序列 `[0,0,0,2,2,0(deg)]` 实测吻合；载重经验数据经独立全量重扫**逐数复现**；
文档侧未发现 over-claim，被证伪的初稿论证已显式标注保留而非删除粉饰；七个既有 Feature 的不变量均未被推翻。

**建议放行进入下一阶段**（阶段性 Codex 对抗审查 → commit）。
