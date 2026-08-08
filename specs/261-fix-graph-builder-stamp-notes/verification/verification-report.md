# 验证报告 — F261 图产物 builder build stamp + implement 每 Phase 落 notes

- **阶段**：fix mode Phase 4c（工具链验证 + 验证证据核查）
- **执行方式**：全部**独立实跑**，未引用 implementation-notes 的任何自述结论
- **worktree**：`/Users/connorlu/.../worktrees/priceless-taussig-d61d73`，HEAD=`0d3e385f`
- **硬约束遵守**：全程零 git 写操作；worktree 零文件修改（`git status` 前后一致）；
  变异实验一律在 `/private/tmp/claude-501/.../scratchpad/mut` 副本上进行

---

## 一、五项命令实跑结果

退出码均用 `cmd > log 2>&1; echo $?` 单独取，规避 F235 birpc 陷阱。

| # | 命令 | 退出码 | 实际输出摘要 |
|---|------|--------|--------------|
| 1 | `npm run build` | **0** | `tsc` 零错误；postbuild 盖章 `commit=0d3e385f` |
| 2 | `npx vitest run` | **0** | `Test Files 530 passed \| 4 skipped (534)`；`Tests 7304 passed \| 18 skipped \| 21 todo (7343)`；日志中 `^ *FAIL ` 行计数 = **0** |
| 3 | `npm run test:plugins` | **0** | `tests 1580 / suites 267 / pass 1580 / fail 0` |
| 4 | `npm run repo:check` | **0** | `86 pass`，唯一 `warn` = `graph-quality:freshness`（在盘图 `sourceCommit=8d25c264` ≠ HEAD，**既有基线现象**，非本次引入） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

**与 implementation-notes 声称的对照**：第四轮终态表声称的 530/7304/1580/86-pass 计数与我方独立实跑**逐项一致**，未发现夸大。

---

## 二、验收判据 A–E 逐条复核

### A. 图产物含 builder 版本信息 —— **PASS**

在 `/private/tmp/.../scratchpad/proj` 建临时 git 项目，用**真 dist** 跑 `batch --mode graph-only`：

```
graph.graph.builder = {"formatVersion":1,"commit":"0d3e385f4927bf2b83f5f8d92b5cade0f5326e86",
                       "dirty":true,"sourceDirty":true,
                       "distSha256":"0159da33eb114c95c2bc8dcd9bcc49738c98290b91ff17ede64d6343b247bcc7"}
dist/.spectra-build-meta.json commit    = 0d3e385f4927bf2b83f5f8d92b5cade0f5326e86   ← 同源
dist/.spectra-build-meta.json distSha256= 0159da33eb114c95c2bc8dcd9bcc49738c98290b91ff17ede64d6343b247bcc7 ← 同源
```

- `builder` 非 null，`commit` / `distSha256` 与 build-meta **逐字符同源**
- build-meta 里的 `builtAtIso` / `distFileCount` / `note` **未进图**（确定性字段筛选生效）
- 同时确认 `sourceCommit=e5389679`（被分析项目 HEAD）与 `builder.commit`（Spectra 自身 build）
  是两条独立时间线 —— 正是立项要暴露的那一维

### B. "陈旧 builder 建的图"可被立刻看出 —— **PASS**

构造两版真 dist（均在 `/private/tmp` 副本上，**worktree 未动**）：
`distA` = 真 dist 副本 + 一行无害注释，再用仓库自己的 `stampBuild()` 重新盖章。
得到 **同 commit / 不同 distSha256** —— 即"未提交分支上 dist 变过"的主形态。

```
distA distSha256 = 0acff9f4df13720aa6a060f02cfe5ec2c590e11492cf0efe2116fda5f05e597d
当前 dist        = 0159da33eb114c95c2bc8dcd9bcc49738c98290b91ff17ede64d6343b247bcc7
```

用 distA 建图 → 在当前 dist 下跑 `graph-quality .`：

```
Overall Verdict: pass                                        ← 判定面不动
[freshness] fresh (recorded=e5389679…, current=e5389679…)    ← 既有四态静默放行
[builder] 图记录 commit 0d3e385 / dist 0acff9f4df13 (…)；当前运行 commit 0d3e385 / dist 0159da33eb11 (…)
          — 不是同一个 build：同一 commit 下 dist 内容不同（源码改了但未重新提交，两次 build 之间 dist 变过）；
            注意至少一侧 build 出自脏工作树，commit 不构成可复现身份
GQ_EXIT = 0
```

**结论**：freshness 判 `fresh`、verdict `pass`、exit 0 —— 现有门禁完全看不见这次事故；
而 `[builder]` 行**当场点名 dist 维度不同**并给出两侧短 sha。判据 B 达成，且确为 advisory-only。

### C. byte-stable 不回退 —— **PASS**

同一份真 dist 连跑两次 `graph-only`（两个独立 output-dir）：

```
cmp out1/_meta/graph.json out2/_meta/graph.json  → exit 0（逐字节相同）
sha256 双方均为 df0d775f5e40d74b55299a1dc9f4c4bf3632daee5d1d93abd44f76737b48e6a8
```

### D. implement.md 约定落地 + wrapper sha 门禁绿 —— **PASS**

- `git diff --stat plugins/spec-driver/agents/implement.md` = **19 insertions(+), 0 deletions(-)**
  → **结构性 additive**，不可能削弱既有委派硬约束 / F208 依从性判定 / goal_loop / 三层验证（无删除行）
- 新增块位于第 5 节「进度追踪」内，含四项必填字段（当前 Phase / 已完成任务 ID / 下一步 / 已知偏差）
  与"覆盖写非追加"约定
- 全仓仅此一份 `implement.md`，无镜像副本需同步
- repo:check 相关门禁全 `pass`：`delegation-contract:codex-wrapper-block-sync`、
  `delegation-contract:skill-block-sync`、`spec-driver-wrappers:*`（5 项）、
  `codex-plugin-consistency:*`（12 项）、`model-literal-gate:model-literal-scan`

### E. 红先行用例覆盖两项缺陷 + 变异抽查 —— **PASS（附 1 项守护力缺口，见第四节 W-1）**

副本基线：3 文件 `Tests 58 passed (58)`，`spec-driver-implement-notes-contract` `20 passed (20)`。

| # | 变异内容 | 结果 |
|---|----------|------|
| M1 | `community.ts` 的 `preserve-recorded` → `stamp-this-build`（**= 立项要抓的伪造 provenance 形态**） | **被杀** — 2 条红（`graph-command-sourcecommit.test.ts` 的 C-2 两条调用点护栏） |
| M2 | `graph-quality.ts` 的 `sameProduct = recorded.distSha256 === current.distSha256` → 恒 `true` | **被杀** — 3 条红（D1-2 / D1-3 / D2 判别文案） |
| M3 | `implement.md` 删掉「已知偏差」必填项那条 bullet | **存活（未被杀）** — 见第四节 W-1 |
| M4 | `implement.md` 删掉整段新增块 | **被杀** — 7 条红 |

变异后已全部还原：三文件 `diff` 与备份一致、`grep -c MUTATION` 全为 0；**worktree 全程未参与变异**。

---

## 三、"声称 vs 事实" 抽样证伪（6 条，全部独立核查）

| # | implementation-notes 的声称 | 核查方法 | 结论 |
|---|------------------------------|----------|------|
| 1 | "四条写盘链路全部覆盖" | `grep builderProvenance` 四文件 + `grep writeKnowledgeGraph(` 全 src | **属实**。四处各自显式声明：`graph-assembly.ts:270` / `batch-orchestrator.ts:1512` / `graph.ts:208` 为 `stamp-this-build`；`community.ts:102` 为 `preserve-recorded`。且 `writeKnowledgeGraph` 确为唯一出口（全 src 无其它 `graph.json` 直写点） |
| 2 | "`--json` / `--status` / exit code / overallVerdict / freshness 四态未被触碰" | diff 逐行 + **真 CLI 实跑 `--json`** | **属实**。diff 中 `--json` 分支 `JSON.stringify(report, null, 2)` 一字未改，只有 text 分支多传一个参数；实跑 `graph-quality . --json` → exit 0，顶层 key 11 项，`grep -c builder` = **0**；`source-commit.ts`（freshness）与 `graph-quality-report.schema.json` 均**零改动**；唯一 "status" 命中是注释里的 `git status --porcelain` |
| 3 | "repo:check 检查项确实没有新增（7 项精确清单未动）" | git diff 三处 | **属实**。`tests/integration/spec-drift-repo-check-regression.test.ts` **零改动**；`scripts/repo-check.mjs` **零改动**；`scripts/lib/` **零改动**。`scripts/` 下仅改 `graph-semantic-diff.mjs` 与 `regen-collector-fingerprint-fixtures.ts`，二者均未被 repo:check / package.json scripts / `.github/` 引用（grep 零命中） |
| 4 | "两处 pinned 资产改动最小且必要，无夹带漂移" | `git diff` 逐行 | **属实**。f220 charter 快照：9 insertions / 0 deletions，**去重后唯一新增行**就是 `      "builder": null,`；guardrail fixture：唯一实质变化是新增 `"builder": null`（+1 行，另 1 增 1 删纯属尾逗号 reflow）。两者均无无关漂移 |
| 5 | "implement.md 改动为 additive，未削弱既有硬约束" | `git diff --stat` | **属实**。19 insertions / **0 deletions** —— 无删除行即结构性保证 |
| 6 | "repo:sync 产出的 19 个再生噪声与本需求无关" | `git diff --name-only` 计数 + 内容 grep | **属实**。确为 19 个文件；其 diff 中 `implementation-notes\|进度落盘` 命中数 = **0** |

**未发现任何"声称与事实不符"。** 4 轮实施中被推翻的自述（如第三轮 D4 关于 `verifyBuildStamp` 的两条、第二轮 A-W1 磁盘侧口径）均已由实施方**自行在原处加推翻批注**并如实登记，未见掩盖。

---

## 四、验证铁律合规（Layer 1.5）

**状态：COMPLIANT**

implementation-notes 每轮均给出具体命令 + 退出码 + 输出计数（非描述性文字），且退出码显式说明用
`cmd > log 2>&1; echo $?` 单独取以规避 F235。扫描全文**未检出**"should pass / looks correct /
应该能正常工作"一类推测性表述；反而多处主动登记"无法取证"（如 `HAS_LLM_E2E=1` 门控用例、
`[E2E_DEFERRED]` 明确写"无"）。我方五项独立复跑与其声称计数逐项吻合。

---

## 五、结论分档

### CRITICAL：无

### WARNING

- **W-1（本次新发现，由变异 M3 实证）**：`tests/unit/spec-driver-implement-notes-contract.test.ts`
  对缺陷② 的守护是**字面量 `toContain` 子串检查**，在**字段粒度上可被绕过**。
  实证：删掉 implement.md 中「**已知偏差**」那条必填 bullet 后，20 条用例**全绿存活** —— 因为
  同节第 86 行的散文（"不回答'下一步动哪个文件、有哪些已知偏差'"）里恰好含同一子串，
  连"约定落在第 5 节之内"那条 section-scoped 断言也一并被满足。
  六个必填字面量中 `implementation-notes.md` / `当前 Phase` / `已完成任务 ID` 全仓唯一（可守），
  而 `下一步` / `已知偏差` / `覆盖` 各有 2 处命中（散文重复 → 可被绕过）。
  **影响有界**：整段删除仍被稳稳抓住（M4，7 条红），故不是空转断言，属"粗粒度有守护力、
  细粒度有缺口"。建议后续把断言锚到 bullet 结构（如 `- **已知偏差**：`）而非裸子串。
  本项**不阻断交付**——它削弱的是未来回归防线强度，不影响本次改动正确性。

- **W-2（交付范围，非代码缺陷）**：工作区含 **19 个 repo:sync 再生噪声文件**
  （`.specify/project-context.suggestions.{md,yaml}` + `specs/products/**/_generated/**`），
  经核实与本需求无关（内容 grep 零命中）。按"并行 feature 须排除再生制品、勿 `git add -A`"约定，
  **主编排器提交时须用显式路径排除这 19 个文件**。

### INFO

- **I-1**：`tasks.md` 的 **T034（对抗复审）checkbox 仍为未勾选**（33/34 done）。实质工作已完成
  （notes 记录四轮、两路异构对抗），属**记账滞后**而非工作缺失。另注意 T034 文案把本改动归类为
  "一般生产代码档位"，而 CLAUDE.local.md 要求门禁/判定器类须标注「Codex 暂停·异构档位缺席」——
  实施方**已在每轮复审节主动标注该缺席**（口径更严，无问题）。
- **I-2**：`repo:check` 的 `graph-quality:freshness` warn 为**既有基线现象**（在盘图
  `sourceCommit=8d25c264` ≠ HEAD `0d3e385f`），与本次改动无关，已实证确认。
- **I-3**：implementation-notes 末尾自行登记的 7 条残余风险（磁盘长期存在读不懂的 builder 值、
  外来绝对路径留盘、banner 回显消毒后键名、batch 主链声明是最弱一环、`{builder: undefined}`
  行为收敛、双源码直跑盲区、F8 跨环境 byte 一致收窄）我方抽查未发现表述夸大或隐瞒，
  可原样转入交付报告。
- **I-4**：`builder-stamp` 机制依赖 `postbuild-stamp.mjs` 盖章；`npx tsc` / IDE build task /
  `npm run build --ignore-scripts` 不触发盖章 → 该场景下 stamp 为 null（诚实降级）。
  已由实施方在文件头登记，非缺陷。

---

## 六、总体结果

| 层 | 结果 |
|----|------|
| Layer 1（Spec-Code 对齐） | 33/34 任务完成，唯一未勾为记账滞后（I-1）；plan §12「明确不做的事」逐条经我方抽查成立 |
| Layer 1.5（验证铁律） | **COMPLIANT** |
| Layer 2（原生工具链） | build ✅ / vitest ✅ / test:plugins ✅ / repo:check ✅ / release:check ✅ |
| 验收判据 A–E | **A PASS / B PASS / C PASS / D PASS / E PASS**（E 附 W-1 缺口） |
| 声称抽样证伪 | 6 条全部**属实**，零不实 |

### ✅ READY FOR REVIEW

0 CRITICAL / 2 WARNING（均不阻断，W-2 需在提交时按显式路径排除再生噪声）/ 4 INFO。
