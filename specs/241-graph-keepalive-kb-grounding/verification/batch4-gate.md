# F241 批 4 门禁（T073，同时是全局收口门禁）执行记录

batch4-base：`27cb5a63ec30205583ac5d0245e265bb3e8c170c`（trace.md `[07:05:50] batch_base: batch4=`）
批 4 只产出 pilot 制品（`pilot/report.md` + `pilot/ledger-verify.mjs`），**未改动任何 `src/**` 或 `plugins/**` 代码**。

---

## 0. T067 红态证据（先写脚本、比对目标未就绪）

`ledger-verify.mjs` 写好后、`report.md` 撰写前首跑：

```
$ node specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs
report.md 读取失败（比对目标尚未就绪，这是 T067 先写脚本阶段的预期红态）：
  Error: ENOENT: no such file or directory, open '.../pilot/report.md'
EXIT=1
```

转绿见下方 SC-016。

### 校验器非空转证明（变异测试）

一个只会打印"通过"的校验器等于没有校验。对 8 个变异体逐一验证其判别力：

| 变异 | 结果 |
|---|---|
| 基线（未变异） | violations=0 ✅ |
| 报告把名义命中率改成 60.0% | 捕获 1 条 `[mismatch]` ✅ |
| 报告把「经交叉核对证实结果错误」改成 3 | 捕获 1 条 `[mismatch]` ✅ |
| 台账把**未计入 M-1** 的 `0-3` 行 `crossCheckedWrong` 翻转 | violations=0 ——**正确行为**（该行 `countsTowardM1:false`，本不该影响任何对外数字） |
| 台账把**计入 M-1** 的 `1-8` 行 `crossCheckedWrong` 翻转 | 捕获 4 条（错误数 10→9、假命中 4→3、可信命中 5→6、可信命中率 25.0%→30.0%）✅ |
| 台账把 `1-1` 的类别 `hit`→`miss-empty` | 捕获 6 条 ✅ |
| 台账引入四分类外的新类别 `partial-hit` | 捕获 `[category]` + 5 条计数漂移 ✅ |
| 台账 `seq` 段内回退（`1-22`→`1-2`） | 捕获 2 条单调性违规 ✅ |
| 报告删掉 `<!-- ledger-verify:m1:end -->` 标记 | 捕获「找不到成对标记区块」✅ |

---

## 1. SC-015 —— 口径冻结先于取数，且未回改

### (a) 预测集冻结时间 早于 首个 implement 代码提交

```
$ git log --format=%aI -- specs/241-graph-keepalive-kb-grounding/pilot/predicted-impact-set.md
2026-08-03T01:10:25+08:00        （唯一一次提交 = 0ee233c，spec 阶段）

$ git log -1 --format=%aI fd9af7f
2026-08-03T04:03:57+08:00        （首个 implement 代码提交，批 1）

epoch 差 = 1785701037 - 1785690625 = 10412s（2h53m32s）
判定：PASS —— 冻结早于 implement
```

> 补充：`predicted-impact-set.md` 全历史**只有一次提交**，不存在"先提交占位、implement 后再回填"的可能。

### (b) `measurement-design.md` 自首次提交起零改动

```
$ git diff 0ee233c -- specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md
（空输出）
diff 字节数: 0
diff 行数:   0

$ git log --format='%h %aI' -- .../pilot/measurement-design.md
0ee233c 2026-08-03T01:10:25+08:00        （同样只有一次提交）
判定：PASS
```

**SC-015 结论：PASS**（两条均按预期）

---

## 2. SC-016 —— ledger 重算与报告逐项一致

```
$ node specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs
ledger-verify 通过：27 行台账（迁移基线 11 行），report.md 逐项一致
  四分类：hit 8 / fuzzy-hit 1 / miss-empty 7 / miss-structural 4（计入 20）
  名义命中率 45.0%；交叉核对证实错误 10（其中计为命中 4）；修正后可信命中率 25.0%
  .mjs 侧 0/3 = 0.0%（O-5 结构性封顶）
EXIT=0
```

15 个数字全部由台账重算并与 `report.md` 标记区块逐项比对，零不一致。

**SC-016 结论：PASS**

---

## 3. SC-017 —— 五项诚实性关键词

```
PASS  「N=1」命中 3 次
PASS  「判读者非盲」命中 1 次
PASS  「单次采样」命中 2 次
PASS  「自我选择偏置」命中 1 次
PASS  「结构性封顶」命中 4 次
---- 机器 grep 结论: SC-017 五项全命中 (exit 0)
```

### 外推表述人工审查（W5 裁决：黑名单不可穷举，改人工审查项）

黑名单抽查（辅助手段，非判据）：

```
$ grep -n "提升 [0-9]\|提升了\|提高 [0-9]\|说明 grounding\|证明 grounding\|grounding 有用\|grounding 无用\|因此 grounding" report.md
（无命中）
```

**人工审查结论**：报告三处结论性表述均为方向记录且带否定式限定——
执行摘要写「均未显示 grounding 的正向信号……不构成任何可外推的效用判断」；
M-3 节写「3 vs 2 这个差值在统计上无意义。禁止把它外推为任何方向的效用判断」；
M-3 附带记录明确把 9 条真 finding 归因于「把对抗审查加倍」而非 grounding。
**未发现「提升 X%」类外推表述，未发现将 N=1 差值宣称为效用结论的措辞。**

**SC-017 结论：PASS**

---

## 4. 六项门禁实跑

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `npx vitest run` | **0** | `Test Files 496 passed \| 4 skipped (500)`；`Tests 6293 passed \| 18 skipped \| 21 todo (6332)`；50.95s |
| 2 | `node --test plugins/spec-driver/tests/*.mjs` | **0** | `tests 1272 / suites 228 / pass 1272 / fail 0 / cancelled 0 / skipped 0 / todo 0`；17.4s |
| 3 | `npm run build` | **0** | 类型检查零错误；`[postbuild:stamp] 盖章: commit=27cb5a63 (dirty)` |
| 4 | `npm run repo:check` | **0** | `status=warn`：**85 pass / 0 fail / 1 warn**（唯一 warn 见下） |
| 5 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)`（SC-018） |
| 6 | `spectra graph-quality --json` | **0** | `overallVerdict = pass-with-warnings`（RG-007 允许值之一） |

### 门禁 1 与基线对照

tasks.md T073 要求「总文件/测试数不低于改动前基线 490 文件 / 6017 测试」：
实测 **500 文件（496 passed + 4 skipped）/ 6332 测试（6293 passed）**，均为净增，PASS。

### 门禁 4 的唯一 warn —— 就是 O-9 本身，不是回归

```
warnings:
  - [graph-quality] 图产物记录的 sourceCommit（bc3bfb5e...）与当前 HEAD（27cb5a63...）
    不一致（commit 级 stale），请重新建图。
```

**与批 3 门禁记录（86 项全 pass、0 warn）的差异说明**：批 3 门禁跑在提交 `27cb5a6` **之前**，
彼时图锚 `bc3bfb5` == HEAD 故 `freshness: pass`；批 3 一 commit，图锚立刻落后一个 commit 转 warn。
**这正是 pilot 观测 O-9「图在每次 commit 后必然 commit 级 stale」的第三次现场复现**，
warn-not-fail 是设计内的正确门禁行为（`repo:check` 退出码仍为 0）。

**未执行重建**：本批任务约束明确禁止在本仓根跑 `spectra graph` / `spectra batch`；
且批 4 零代码改动，重建对本批门禁的判定无影响。

### 门禁 6 六指标明细（只读执行，图文件未被修改）

| 指标 | 状态 | 值 |
|---|---|---|
| duplicateCanonicalId | pass | 0 组 |
| containsCoverage | pass | 5143/5143 = 1.0 |
| orphanRatio | pass | offending 0（allNodeZeroDegree 2.16%） |
| danglingEdges | pass | 0 |
| legacyAndIgnoredNodes | pass | 0 |
| freshness | **stale** | recorded `bc3bfb5` vs HEAD `27cb5a6`（同上，O-9） |
| **overallVerdict** | — | **pass-with-warnings** ✅ RG-007 |

---

## 5. T-C5 补齐项

### 5.1 T071 / T072 全部验证命令重跑

本文件第 1、3 节即为撰写阶段之后的**重跑**记录（非撰写时那一次），两轮结论一致。

### 5.2 M-3 prompt 同构性重新人工 diff + `diff.hash` 复核

```
$ cat pilot/m3/diff.hash
7a888daa1d14b1b37fa04bd9f0d02efcc29bdc60c64348e83019dafda45022c1

$ shasum -a 256 pilot/m3/batch2.diff
7a888daa1d14b1b37fa04bd9f0d02efcc29bdc60c64348e83019dafda45022c1  batch2.diff
→ 一致 ✅
```

```
$ diff pilot/m3/prompt-a.md pilot/m3/prompt-b.md
15a16,30
> （15 行 grounding 段：4 条 impact/context 查询结果 + 图 freshness 状态）
```

`prompt-a.md` 15 行 / `prompt-b.md` 30 行。**唯一差异是 b 组在第 15 行之后追加的 15 行 grounding 段**，
前 15 行逐字节相同——两组 prompt 除 grounding 包外逐字相同，同构性成立 ✅

> 人工核对该 grounding 段内容：4 条查询中 3 条是**已知错误**的结果
> （`executeKbSearch` / `executeKbApiLookup` 报 0 caller、`loadKbContext` 报 1 caller），
> 按 `m3-preregistration.md` 的「grounding 的错误也原样给」原则未做人工修正——预注册兑现 ✅

### 5.3 continuous capture 收口检查

| 项 | 值 |
|---|---|
| `pilot/ledger.jsonl` 总行数 | **27**（11 行迁移基线 + 16 行 continuous capture） |
| `pilot/mcp-call-log.md` 表格条目数 | **27** |
| 两侧 `seq` 集合逐项比对 | **完全一致**（`diff` 空输出） |
| `seq` 全程单调 | ✅（`ledger-schema-check.mjs` 全局单调 + `ledger-verify.mjs` 分段内单调，双侧 exit 0） |
| 迁移条款（前 11 行 `timestamp:null` + `timestampNote` 非空；其后真实 ISO 8601） | ✅ exit 0 |

> 批 4 自身零新增 MCP 调用（本批为报告撰写与校验，未发起 symbol 查询），故 27 行相对批 3 收口时不变。

---

## 门禁结论

**PASS** —— 六项命令全部零失败（exit 0），SC-015 / SC-016 / SC-017 三条验收全部按预期，
T-C5 三项补齐项全部核实。唯一 warn 为 `graph-quality:freshness`，经查证是 pilot 观测 O-9 的
预期复现而非回归，且 `repo:check` 退出码为 0。

**批 4 完成，F241 implement 阶段收口，可进入 verify 阶段。**

---

## 本批如实上报的偏差

1. **发现 `metrics-raw.md` v2 的一处分类描述错误**（headline 数字不受影响）：
   「precision 噪声逐条」小节称 8 个噪声文件「全部来自 `withTelemetry` 的 upstream 链
   （`src/mcp/**` 5 个 + kb-doc-lookup + kb-server）」。机器复算逐项枚举后为：
   `src/mcp/**` **4** 个、withTelemetry 链合计 **6** 条，另 **2** 条（`schema-compat.ts` /
   `search-core.ts`）来自 `hasProvenanceColumns` 锚点；且其列出项相加为 7 而非 8。
   `report.md` 已改为逐文件枚举 + 标注来源锚点，并在「口径缺陷 (b)」如实登记为**同类失误第三次**。
   **coverage 2/21、precision 2/10、missed 19、coverage′ 2/14 四个 headline 数字经独立复算全部无误。**

2. **纠正 `trace.md:46-47` 的一处 over-claim**：原文写 O-3/O-7 两类漏边「已立 follow-up 卡」。
   全仓检索证实**不存在任何独立 follow-up 卡文件**——O-3 登记在 F241 spec Non-Goals #5、
   O-5 登记在 M9 §7.5.4 + spec D6，而 **O-7 收窄结论与 O-8 只存在于本 pilot 目录的 markdown 里**。
   `report.md`「图缺陷发现清单」已按实际登记状态逐条标注，并提示 O-7/O-8 需在 M9 收官或 M10 补正式登记。

3. **B4 决策矩阵证据的适用范围已在报告中显式收窄**：SC-002/003/004/005 的实测来自单测、
   集成测试与 CLI 手跑，**本 feature 自身的 implement 并未运行 goal_loop**
   （effective-orchestration 实测 implement phase `agent_mode = single`，且 spec Non-Goals #10
   禁止改默认开关）。报告中已声明「这不是生产 goal_loop 端到端 pilot」，避免 over-claim。

4. **SC-002 / SC-003 首跑即绿、无独立红态**，沿用 `batch1-red-evidence.md` T019 的如实标注。
