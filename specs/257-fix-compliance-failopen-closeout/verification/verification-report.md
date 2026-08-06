# F257 验证报告（Phase 4c 工具链验证 + 验证证据核查）

- **验证对象**：fix 依从性门禁判定器（Claude Code Stop hook）两处 fail-open 的收口
- **工作区**：`/Users/connorlu/.../worktrees/priceless-taussig-d61d73`（git worktree，未提交）
- **改动面**：7 文件 +1700 / -44（`git diff --stat` 与验证开始时逐字一致，见 §5）
- **验证日期**：2026-08-06
- **验证性质**：只读验证 + 受控变异复现（全部还原）；未做任何 git 写操作

---

## 1. 工具链验证表（逐条实跑）

| 命令 | 退出码 | 关键输出摘要 | 预存 flaky？ |
|------|--------|--------------|-------------|
| `npx vitest run` | **0** | Test Files 522 passed \| 4 skipped (526)；Tests **7111 passed** \| 18 skipped \| 21 todo (7150) | 否 — 本轮**零** flaky 命中（`watch-command` / `batch-orchestrator-incremental` / `community-analysis` perf / `cli-e2e --version` 四类均未打红） |
| `npm run test:plugins` | **0** | `ℹ pass 1536 / ℹ fail 0`（suites 261，duration ≈ 29s） | 否 |
| `npm run build` | **0** | tsc 零错误；postbuild 盖章 `commit=19bff52a (dirty)`（dirty 符合"工作区未提交"预期） | 否 |
| `npm run repo:check` | **0** | 全部 check 通过，**1 条 warning**：`graph-quality:freshness = warn`（图 `sourceCommit=8d25c264` 落后 HEAD `19bff52a` + collector fingerprint 未记录） | 否 — **进场即存在的既有项，非本次引入**（本 diff 不触及图产物） |
| `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` | 否 |
| `npm run judge:doctor` | **0** | `status: drift`（4 mismatch / 2 match / 1 missingInSnapshot），详见 §4 | 否 — **预期漂移**，非失败 |

**结论**：六条命令退出码全为 0，无失败、无超时、无 flaky 命中。

补充实跑（受影响测试文件单独复跑，用于确认变异还原后状态干净）：
`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs plugins/spec-driver/tests/fix-compliance-core.test.mjs`
→ `ℹ pass 763 / ℹ fail 0`。

---

## 2. 验收条件逐条核查表

| # | 验收条目 | 证据 | 结论 |
|---|---------|------|------|
| 1 | **缺陷 1 两向互补合同**：(a) 磁盘同 short-name 旧目录 + 本会话零产出 → exit 2 **且审计事件落盘**；(b) F256 同会话目录重编号 → 仍 exit 0 | (a) `fix-compliance-judge-cli.test.mjs:2398` **T-1a**：断言 `status === 2`、`events.length === 1`、`missing` 含 `feature-dir`、`diagnostics` 含 `feature-dir-witness-absent` —— 三项断言同时覆盖"阻断"与"审计落盘且可归因"。<br>(b) 同文件 `:2423` **T-1b**、`:2645` **T-1N**：断言 `compliant === true` / `missing === []` / `status === 0` / `readVerdictEvents() === []`。<br>另有 T-1c/d/e/f/g/h/i/j/k/L/M 共 11 条边界用例（子串边界、id 复用、Read 不发证、跨仓绝对路径、诊断码不落 `transcriptDiagnostics` 等）。 | **达成** |
| 2 | **缺陷 1 防假绿**：短路 short-name 分支后，标称 F256 互补的用例必须转红 | 亲自复现（§3 G1）：把 `fix-compliance-judge.mjs:354` 的 `if (!usable(resolvedPath) && candidate.path !== null)` 改为 `if (false && ...)` → **T-1b 与 T-1N 双双转红**（`pass 0 / fail 2`）。证明二者确实走该分支，非假绿。已还原并校验 sha256 与备份一致。 | **达成** |
| 3 | **缺陷 2**：删状态 N≫3 轮不得"全部 exit 0 且零终态记录"；重展开 `Skill(spec-driver-fix)` 攻击须被闸门三收敛 | `:2758` **T-2a**：6 轮每轮 `rm -rf .specify/runs/.fix-compliance-state`，断言 `statuses !== [0,0,0,0,0,0]` 且逐位 `= [0,0,0,0,0,2]`；计数逐轮严格递增；`counts[4] < 420 && counts[5] >= 420`；末条审计含 `delegation-in-flight-entry-budget-exhausted`。<br>`:2784` **T-2b**（重展开攻击）：每轮重新注入 `Skill(spec-driver-fix)` 展开痕迹 + 删状态，断言计数不回退、`statuses = [0,0,0,0,0,2]`，即**不是 N/N 全 exit 0**。<br>"零终态记录"一侧由 `:2817` **T-2d** 覆盖：推迟成功必落一条 `result:"paused"` 的 `workflow-run-summary`。 | **达成**（限界见 §6-a：两个断言分处 T-2a / T-2d，无单条用例同时钉住"非全 0"与"终态非零"） |
| 4 | **contract 与实现同真**（见证正则 / 闸门表 / 阈值论据 / 诊断码 / report 字段名） | 见证正则：contract L211 `^(specs\/\d+-fix-[a-z0-9-]+)\/fix-report\.md$` ≡ `fix-compliance-core.mjs:921` 逐字一致 ✅<br>闸门表：contract L88-92 三道闸门 + "取合取（AND）" ≡ `fix-compliance-judge.mjs:748` `countBudgetLeft && entryBudgetLeft` ✅<br>阈值论据：contract L119 "**420 落在约 P98.7**（147/149 < 420）…**不是"覆盖 P99"**" —— 已按要求更正，全文无残留"覆盖 P99"式主张（L108-109 是对前身版本的显式勘误）✅<br>诊断码：`feature-dir-witness-absent` / `delegation-in-flight-entry-budget-exhausted` 均已进 schema enum，且有守卫用例 T-1j / `:2901` 双向钉死（防死码）✅<br>report 字段：`assistantEntriesSinceEarliestFix` contract L187 ≡ 实现 L803 ✅<br>**但发现 2 处 contract 文本与实现脱节**（详见 §6-b、§6-c） | **部分达成** |
| 5 | **附带项**：`copyTree` 排除 `worktrees` + 分段级比较反例用例 | `tests/integration/repo-maintenance-sync-check.test.ts`：`copyTree` 新增 `CopyTreeOptions{exclude, sourceRoot}`，`cpSync` 用 `filter: src === excluded \|\| src.startsWith(excluded + sep)`（分段级，非 `includes`）；`:65` 新增用例断言 `.claude/worktrees` 被剪掉，而**名字含 worktrees 的无关路径** `.claude/skills/worktrees-helper/SKILL.md` 必须保留；调用点 `:103` 传 `{ exclude: ['worktrees'] }` | **达成** |
| 6 | **变异测试守护力**：抽查 ≥3 条亲自复现 | 亲自复现 **5 条**（M-1/M-2/M-3/M-4/M-5），全部转红并还原，详见 §3 | **达成（超额）** |
| 7 | **无 over-claim** | 全 diff 扫描 `完全消除 / 彻底杜绝 / 不再可能 / 彻底消除 / 完全杜绝 / 100% / 绝对安全 / 永久修复` → **0 命中**；`specs/257-*/` 目录 2 处命中均为**禁令句**（plan.md L509「禁止声称"彻底杜绝"」、L694「禁止"完全消除/彻底杜绝"式表述」），非主张。<br>正向抽查：contract L154-157 明确写"闸门三**不消除**删状态文件这一手法本身…把「**永久**免于裁决」降级为「**约 140 轮内**免于裁决」。**这是有界化，不是消除**" | **达成** |

---

## 3. 亲自复现的 guard 与变异（全部已还原）

方法：`cp` 备份两个源文件 → `python3` 精确字面替换（带 `assert count==1` 防静默失配）→ `node --test --test-name-pattern` 定向跑 → `cp` 还原 → `shasum -a 256` 与备份比对。

| 编号 | 变异内容 | 目标文件:锚点 | 跑的用例 | 结果 | 还原校验 |
|------|---------|--------------|---------|------|---------|
| **G1**（防假绿 guard） | short-name 分支整段短路：`if (!usable(...) && ...)` → `if (false && ...)` | judge.mjs:354 | T-1b, T-1N | **✖ 2 红 / 0 绿** | sha256 `709a6f02…` ✅ |
| **M-1** | 删见证过滤：`if (witnessedShortNames.has(shortName))` → `if (true)` | judge.mjs | T-1a, T-1c, T-1d, T-1L, T-1M | **✖ 5 红 / 0 绿** | ✅ |
| **M-2** | 见证正则加回 `verification/verification-report.md` | core.mjs:921 | C-1a, T-1L, T-1M | **✖ 3 红 / 0 绿** | sha256 `f83a8bad…` ✅ |
| **M-3** | 闸门并联 `&&` → `\|\|` | judge.mjs:748 | T-2a, T-2b, T-2c, T-2e | **✖ 4 红 / 0 绿** | ✅ |
| **M-4** | 阈值 `420` → `Number.MAX_SAFE_INTEGER` | judge.mjs | T-2a, T-2b, M-6 | **✖ 3 红 / 0 绿** | ✅ |
| **M-5** | 闸门三基线退回主锚点：`anchor.earliestFixLineIndex` → `anchor.anchorLineIndex` | judge.mjs:230 | T-2a, T-2b | **✖ T-2b 红**（T-2a 仍绿 — 该 fixture 单次展开、两基线等值，属预期） | sha256 `709a6f02…` ✅ |

⚠️ 过程记录（诚实登记）：M-2 首次用 `perl -0pi` 替换**静默失配**（转义问题），导致三条用例"全绿"——若不核对 `sed -n '921p'` 输出会误判为"变异未被抓住"。改用带 `assert` 的 python 替换后复现成功。**"变异后测试仍绿"必须先核实变异是否真的落盘。**

还原总校验：`diff <(git diff --stat) baseline-diffstat.txt` → **DIFFSTAT_IDENTICAL**；`git status --porcelain` 与开始时逐字一致（7 M + 1 ??）。

---

## 4. `judge:doctor` 漂移状态与生效说明

```
status:           drift
snapshotPath:     ~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.0
resolutionSource: spec-driver-path-file
[mismatch] scripts/fix-compliance-judge.mjs
[mismatch] scripts/lib/fix-compliance-core.mjs
[match]    scripts/lib/fix-compliance-execution-record.mjs
[mismatch] scripts/lib/fix-compliance-io.mjs
[missingInSnapshot] scripts/lib/is-invoked-directly.mjs
[match]    scripts/lib/simple-yaml.mjs
[mismatch] scripts/record-workflow-run.mjs
汇总: 4 mismatch / 2 match / 1 missingInSnapshot
```

🔴 **本次修复要到下次 plugin 发版（并被本机重新安装）后才对本机门禁生效。** 本机 Stop hook 消费的是已安装快照 `4.4.0`（F236 实证），而非 worktree 内的源码。因此：

- 本报告中所有 F257 行为验证都是**对 worktree 源码**的验证（通过 `node --test` 直接调用 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 子进程），**不代表本机 Stop hook 当前已具备该行为**；
- 4 条 `mismatch` 中，`fix-compliance-judge.mjs` / `fix-compliance-core.mjs` 是本次改动直接造成的；`fix-compliance-io.mjs` / `record-workflow-run.mjs` 的 mismatch 与 `is-invoked-directly.mjs` 的 `missingInSnapshot` 是**本次改动之前就存在**的历史漂移（本 diff 未触及这三个文件）；
- `JUDGE_FILE_SET`（7 项）无需更新：本次未增删判定器闭包文件。

---

## 5. 工作区完整性自证

```
开始时 / 结束时 git status --porcelain（逐字一致）：
 M plugins/spec-driver/scripts/fix-compliance-judge.mjs
 M plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
 M plugins/spec-driver/tests/fix-compliance-core.test.mjs
 M plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
 M specs/208-fix-mode-process-compliance/contracts/fix-compliance-judge-cli.md
 M specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json
 M tests/integration/repo-maintenance-sync-check.test.ts
?? specs/257-fix-compliance-failopen-closeout/

git diff --stat：7 files changed, 1700 insertions(+), 44 deletions(-)  ← DIFFSTAT_IDENTICAL
```

（本报告文件本身落在未跟踪目录 `specs/257-*/verification/` 内，不改变上述 tracked 文件状态。）
未执行任何 git 写操作（无 commit / add / stash / checkout / restore）。

---

## 6. 残余限界清单核对（fix-report + contract vs 本次实证）

### 已登记且核对无误的残余

| 残余 | 登记位置 | 核对 |
|------|---------|------|
| 类 X · 家族零写入 → 误阻断 | contract L246 起 + judge.mjs 注释 | ✅ 有用例 T-1c 固化为**预期行为** |
| 类 X-b · 制品经 `Bash` 写入（提名侧收 Bash、见证侧只收 Write/Edit；提名侧收 verification-report、见证侧只收 fix-report） | contract + judge.mjs 注释（第 4 轮补登记） | ✅ 两侧不对称在代码中确认属实 |
| 类 Y · 制品由子代理写入（sidechain 不可见），全语料 A/B 中 2/148 由 true 翻 false | contract | ✅ 明确标注为"真实的新增误阻断，已接受" |
| R11 · 绝对路径见证 + 判定根错位 | contract + fix-report | ✅ 有用例 T-1g / T-1h |
| R11-b · symlink / realpath 分歧（`/tmp` ↔ `/private/tmp`）→ 见证恒空 | contract + core.mjs 注释（第 4 轮补登记） | ✅ 代码确为纯字符串 `startsWith`，零 I/O 契约成立 |
| **见证不绑定终态**（W1：写完立刻回滚仍拿到见证）——按**承重逃逸面**登记 | contract + core.mjs + judge.mjs 注释 | ✅ 三处一致，未被写成"边角限界" |
| F227 已知限界一（主动冒用 + `cat X > /dev/null`）本次不消除 | contract | ✅ |
| 闸门三只把"永久免于裁决"降级为"约 140 轮内"，**不消除**删状态手法 | contract L154-157 + judge.mjs | ✅ 表述与实现同真 |
| 闸门三单调性以 transcript 不被 compaction 回退为前提 | contract L166-170 | ✅ |
| 阈值 420 标定语料为单机 149 份，外推有效性未验证 | contract L171-173 | ✅ |
| 推迟终态记录的 `runId` 与 skill 不同源 → 污染 adoption 指标 | contract + judge.mjs（第 4 轮补登记） | ✅ 标注"刻意不修 + 闭合方向二选一" |

### 发现的登记 / 同真缺口（本次核查新增，均非阻断级）

**a. 条 3 的两半断言分处两条用例。** T-2a 只断言 `statuses ≠ 全 0`，未读 `readWorkflowRuns()`；"终态记录非零"由 T-2d 单独覆盖（且只覆盖 1 轮）。原始验收表述"不得出现『全部 exit 0 且零终态记录』"是一个合取命题，当前无单条用例同时钉住两半。守护力实际存在（M-3/M-4 变异下 T-2a、T-2d 均可红），但严格意义上这是覆盖形态的缺口，不是覆盖缺失。

**b. 🔴 contract 保留了实现已明确判定为"被证伪"的论证。** contract L244-246 仍以下述演绎作为"家族级比较是承重的"的理由：

> 「同编号版本的采信正支结构性不可达（见证集合 ⊆ 提名集合 ⟹ 被见证目录必进候选历史 ⟹ 更早的 F227 历史兜底用同一个 `usable()` 先手命中；实跑 576 组排列穷举 0 命中）」

而实现侧 `fix-compliance-judge.mjs:305-308` 与 `fix-compliance-core.mjs:909` 都写着这段演绎**已被第 3 轮红队实证证伪、故删除、不得再作为放宽依据**（理由：「进 candidateHistory」不蕴含「usable」；576 组穷举没覆盖破绽形态）。**代码删掉的错误论证，contract 原样留着**。
另需指出：即使见证制品类已收窄为只认 `fix-report.md`，该演绎仍不成立——W1 形态（写 `fix-report.md` 拿回执后回滚）下被见证目录不在磁盘上、不 usable，F227 兜底同样不会先手命中。
影响：不改变任何运行时行为；但 fix-report 自己把"最值得记的教训"定为"形式证明与实证互相背书出假结论"，而该假结论仍留在合同文本里，后人据此放宽判据的风险未被消除。**建议**：把 contract L244-246 的括号内论证改为与代码注释同真（家族级的真实理由是 F256 场景中被见证的是**旧**目录、重锚定目标是**新**目录，同编号写法会整段抵消 F256）。

**c. contract 闸门三小节描述的实现结构已过时。** contract L99 写"闸门三为此**自带基线扫描**（`countAssistantEntriesSinceEarliestFixExpansion`），与主锚点并存、互不影响；**不得**为『统一』把两者合并"。但第 3 轮 WARNING-1 的性能修复后，实现已把两个基线合并到 `detectFixSkillExpansion` 的**同一趟**扫描里产出，`countAssistantEntriesSinceEarliestFixExpansion` 不再扫描、基线改由**入参**给入（core.mjs 注释明写"⚠️ 调用方**必须**传 `earliestFixLineIndex`，不得在此另起一遍展开扫描"，并有测试 `assert.equal(fn.length, 2)` 钉死）。**按 contract 现文本行事会把已被删掉的第二遍扫描加回来**（正是把最坏耗时从 10188ms 翻到 19785ms 的那一改）。建议同步修订该行。

**d. contract 未登记 N2 类逃逸（会话末尾展开另一个 spec-driver 技能 → `isFix=false` → 门禁整体卸载、零审计）。** fix-report 已如实登记（`CRITICAL-2`，标为既有面 / 建议另开 fix，且诚实注明"未端到端验证 Claude Code 是否真会注入该 user 文本"）。contract L166-170 只登记了 compaction 导致锚点消失的同族路径，未登记**主动展开另一技能**这一形态。这直接影响闸门三小节的量级读法：闸门三把"删状态"面收敛到约 140 轮，但相邻的 N2 面（若成立）成本仅一次工具调用且完全绕开三道闸门。属登记完备性缺口，不属本次修复范围内的功能缺陷。

**e. fix-report 自列的 Spec 影响项未全部兑现。** fix-report「Spec 影响」列出 `specs/256-fix-compliance-false-blocks/` 需"回指本 Feature 的收口结论（如实登记，非改写历史）"，但 `git status` 显示该目录**未被修改**。实际残留的被证伪表述：`specs/256-*/fix-report.md:212`「两道闸门任一不满足即恢复完整裁决，故不存在永久免于裁决的会话」、`:205`「使『永不回收』的派发最多推迟 3 次」——两句均已被 F257 实测证伪（contract 已更正，256 未回指）。属历史制品的溯源完整性问题，不影响运行时行为。

---

## 7. 诚实结论

### 完全达成
- 任务 A 六条命令**全部退出码 0**，无 flaky、无超时；`repo:check` 的唯一 warning 经核实为进场即存在的图新鲜度既有项。
- 验收条 1 / 2 / 3 / 5 / 6 / 7 达成，且**条 2（防假绿 guard）与条 6（变异守护力）由我亲自复现**，不是转述 fix-report 的纸面声称：G1 + M-1..M-5 共 6 次变异全部转红，全部还原并 sha256 校验。
- 无 over-claim：diff 与 spec 文本中所有关于"消除"的表述均为禁令或显式的"有界化，不是消除"。

### 部分达成
- **验收条 4（contract 与实现同真）判为部分达成**：正则 / 闸门表 / 阈值论据（420 ≈ P98.7，非"覆盖 P99"）/ 诊断码清单 / report 字段名逐项核对无误，但发现 §6-b（contract 保留已被实证证伪的演绎论证）与 §6-c（contract 描述的实现结构已被性能修复取代，照此行事会重新引入被删掉的第二遍扫描）两处脱节。两者均**不改变运行时行为**，但都是"后人据此改代码会踩坑"的文本级同真缺口。

### 我未能验证 / 不在本次验证范围（不得读成"通过"）
1. **本机 Stop hook 的实际行为未验证**，也无法验证：本机跑的是已安装快照 4.4.0，`judge:doctor` 报 `drift`。本报告全部行为结论仅对 worktree 源码成立，**修复要到下次 plugin 发版后才对本机门禁生效**。
2. **阈值 420 的标定数据我未独立重算**。contract 声称的 `N=149 / P50=61 / P99=647 / max=801 / 2 份越阈` 由 fix-report 记为"两方独立复现、逐位一致"，我**没有**重跑取数脚本核对；且该语料是本机私有 transcript（`~/.claude/projects`），在本 worktree 内不可复现。我能证实的只有：常量取值确为 420、有变异钉子 M-6 钉死数量级、contract 与代码注释对该数字的表述**互相一致**且不含"覆盖 P99"式过度声称。
3. **fix-report 中大量红队实跑证据我未逐条复现**（如"攻击组 30/30 全 exit 0"、"576 组排列穷举"、"8.1MB transcript A/B 10188ms → 19785ms"、"1296 份子代理文件 71 次命中"、"全语料 148 份 A/B 中 2 份翻转"）。这些依赖本机私有语料，验证环境不具备。我复现的是**其结论对应的回归钉子在当前代码上确实红/绿**——这能证明测试有守护力，**不能**证明那些语料统计数字本身准确。
4. **N1 / N2 / CRITICAL-2 等既有 fail-open 面本次未修，我也未验证其是否成立**。fix-report 已明确划出范围并建议另开 fix；我只核实了它们在 fix-report 中被如实登记，以及 contract 对其中一部分（compaction 面）有登记、对 N2 无登记（§6-d）。
5. **性能修复（单趟扫描）的实际耗时改善我未复测**。仅确认代码结构确为单趟、有对应回归锚点用例（`fix-compliance-core.test.mjs:4757` 诱饵前缀性能锚点）、以及 M-5 变异能钉住基线来源。

### 建议（非阻断）
- 修 §6-b：把 contract L244-246 括号内已被证伪的演绎替换为与代码注释同真的理由。
- 修 §6-c：把 contract L99 的"自带基线扫描 / 不得合并"改为"由 `detectFixSkillExpansion` 单趟顺带产出、调用方必须传入基线、不得另起第二遍扫描"。
- 补 §6-e：给 `specs/256-*/fix-report.md` 加一行回指 F257 的勘误（不改写历史，只追加）。
- 可选 §6-a：给 T-2a 补一条 `readWorkflowRuns().length > 0` 断言，使"非全 0 且终态非零"由单条用例合取钉死。
- 可选 §6-d：把 N2 形态补进 contract 的已知限界表，避免闸门三的"约 140 轮"量级被读成全局上界。

**总体结果：✅ 工具链验证全绿；验收条件 6/7 完全达成、1 项（contract 同真）部分达成。发现的 5 项缺口均为文本同真 / 覆盖形态 / 登记完备性问题，无一改变运行时行为，无一构成新的 fail-open。**

---

## 8. §6/§7 建议项的收口记录（本报告出具后追加，2026-08-06）

本节**只追加、不改写上文**（上文保留出具时的原貌）。Phase 4 三份审查（spec-review / quality-review /
本报告）的发现已合批收口，逐条对照如下。**生产逻辑零行为改动**——除 A3（测试 fixture 补反例）与
B（常量改名）外无代码语义变更；全量门禁重跑结果见下。

| 原编号 | 状态 | 处置 |
|---|---|---|
| §6-b（contract 保留已被证伪的"同编号不可达"演绎 + 576 组穷举） | ✅ **已修** | contract 该段替换为代码侧的**正向**理由（F256 真实场景中被见证的是已被 `git mv` 移走的旧目录 `251-fix-foo`，重锚定目标是磁盘上的 `254-fix-foo`，同编号写法会让正支不可达从而抵消 F256）；并把"576 组穷举"降级为"该轮穷举未覆盖 `verification-report.md` 形态，不构成证明" |
| §6-c（contract L99"闸门三自带基线扫描 / 不得合并"与实现相反） | ✅ **已修** | 改为如实描述：基线由 `detectFixSkillExpansion` **同一趟**产出 `earliestFixLineIndex`、经**显式入参**传入，计数函数体内不跑正则；并把「**`SKILL_EXPANSION_REGEX` 全链只允许扫一趟**，新增消费方必须复用返回值」正式登记进 contract 的「不变量」节（此前 contract 层完全没有这条） |
| §6-d（contract 未登记 N2 类逃逸） | ✅ **已补登记** | 写进 contract「推迟的三道闸门 · 已知限界」，注明**既有面、非 F257 引入**、已列独立跟进项，并显式点明它决定"约 140 轮"这个量级该怎么读（N2 面下该天花板不适用） |
| §6-e（`specs/256-*/fix-report.md` 未回指） | ✅ **已补** | 对 `:205`「最多推迟 3 次」与 `:212`「不存在永久免于裁决的会话」两句各追加一段 F257 更正说明；**保留原文不改写历史** |
| §6-a（T-2a 两半断言分处两条用例） | ⬜ **未做**（原列为"可选"） | 本轮硬约束为生产逻辑零行为改动、且不新增测试断言范围；覆盖形态缺口保留，守护力实际存在（M-3/M-4 下 T-2a、T-2d 均可红） |

同批另处理（不在本报告原有发现内，来自另两份审查）：

- **`tests/integration/repo-maintenance-sync-check.test.ts` 的白盒用例抓不到它宣称要抓的变异** —— 已修。
  原 fixture 用 `.claude/skills/worktrees-helper`（在**另一棵子树**下），而裸 `startsWith` 真正误伤的是
  **兄弟前缀**目录。已补 `.claude/worktrees-archive/a.md` 并断言其存在。
  **亲自做过变异验证**：把 `src === excluded || src.startsWith(excluded + sep)` 换成裸
  `src.startsWith(excluded)` → 用例转红，失败点正是 L92 的 `worktrees-archive` 断言，
  而原有的 `worktrees-helper` 断言（L93）**仍绿**——实证了旧 fixture 对该变异确无判别力；已还原复绿。
- **判定器悬挂交叉引用**（`（家族级，理由见上方 (a)/(b)）`，而上方唯一的 `(a)` 是"该演绎已被证伪故删除"、
  `(b)` 不存在）—— 改为指名引用「为何比较是 short-name 家族级」一段，去掉字母标号。
- **类 X 第三形态补登记**：会话中途重新展开 fix skill → 之前对制品的合法 Write 落到见证窗口外 →
  `feature-dir-witness-absent`。见证窗口用**最晚**锚点、闸门三用**最早**展开，方向刻意相反且两侧各自
  fail-closed。已补进 judge 的类 X 清单、contract 已知限界表，以及 `collectArtifactWriteWitnessDirs` 的 JSDoc。
- **常量改名** `POST_ANCHOR_ENTRY_DEFER_LIMIT` → **`EARLIEST_FIX_ENTRY_DEFER_LIMIT`**：旧名的
  `POST_ANCHOR_` 精确指向"判定主锚点 = **最晚**展开"，而那正是已被实测证伪的错误语义（用最晚锚点时
  攻击组 30/30 全 exit 0）。⚠️ **取值仍为 420，M-6 断言值仍为 420。**
  活代码 10 处引用（judge 3 / `fix-compliance-judge-cli.test.mjs` 6 / contract 1，其中 contract 的另一处
  已随 §6-c 改写移除）全部同步；`specs/257/**` 与 `specs/208/plan` 的历史记录**刻意不动**，仅由勘误
  E1′ 指向新名。
- **制品回流**：`specs/257-*/plan.md` 与 `tasks.md` 的**勘误块自身已失真**（写 `…(entries)` 单参、
  "自带基线扫描"，实现是双参且 `assert.equal(fn.length, 2)` 钉死）—— 已各追加 **E1′ 勘误更正**；
  `detectFixSkillExpansion` 新增返回字段 `earliestFixLineIndex` 已补进 plan §8 逐文件变更清单
  （此前完全没有）；plan §10 的 R 表由 R10 扩到 R11 / R11-b / R7-b / R7-c / R12 / R13；
  `fix-report.md` 补登记第 4 轮的三条残余（类 X-b / R11-b / adoption 指标污染）+ 本轮的类 X 形态 3；
  `tasks.md` 43 条 checkbox 按磁盘事实勾选 40 条，T030 / T040 / T043 保持未勾并逐条注明原因。

⚠️ **本节不改变上文任何"未能验证"条目**（§7 的 5 条仍然成立）：本轮同样未验证本机 Stop hook 实际行为、
未独立重算 420 的标定语料、未复现 fix-report 的红队统计数字、未验证 N1/N2/CRITICAL-2 是否端到端成立、
未复测性能修复的实际耗时改善。
