---
feature: 292-fix-coverage-gate-positive-evidence
kind: verification-report
phase: Phase 4c-delta-3（第四轮代码质量审查返工后的终态独立复核）
---

# F292 verify 独立复核报告（delta-3 终态）

角色：verify 子代理，本报告是对 **delta-3 轮返工之后的终态**做的独立复核，取代此前覆盖
delta-2 轮终态的旧版本（旧版本的 §0-§8 结构与大部分数字仍有效，本次在其基础上补齐 delta-3
的新判据、新变异实证、新数字，并重新给出总体结论）。本报告的一切数字均由本子代理**独立实跑**
得出，不采信 implement/编排器先前的口头声称。所有实跑证据均未修改仓库任何跟踪文件：变异测试
在 `scripts/lib/coverage-gate-core.mjs` 原地临时替换 + `cp`/`md5` 逐字节复原，撤销后重跑确认
恢复；**全程未执行任何 git 操作**（不 add/commit/stash/checkout）。

## 0. 总体结论

**PASS**（本子代理独立复核未发现 CRITICAL）。

- **delta-3 背景**：Phase 4b 代码质量审查在 delta-2 终态实现上又抓到 1 处 CRITICAL——
  `checkCoverageTable` 三处 `.match()`（无 `g`，取全文**第一处**）与同文件其它检查统一用
  `lastMatch`（取**最后一处**）的语义不一致，同时开了两个方向的洞：(1) fail-open——汇总行后
  先打印诱饵完整表（100%），真正收尾的坍塌表（0%）被漏看；(2) 镜像误伤——汇总行**之前**出现
  一份格式相似的诱饵表，会让日志真正收尾的合法表被误判为"出现在汇总行之前"。已修复为：先
  `lastMatch` 锁定最后一处 `Coverage report from`，再仅在其后子串里找 `% Stmts` / `All files`，
  三锚点结构性落在同一张表上。
- Layer 1（Spec-Code 对齐）：本卡是 fix 类修复（CI 判定器 fail-open），无独立 spec.md 的 FR
  编号体系，对齐依据是 `fix-report.md` 的问题陈述与 `tasks.md` 的任务清单；判定器实现、CLI
  薄壳、14 份 fixture、mutation-evidence 四类产物均已在磁盘核实存在，delta-3 新增的两条判据
  测试与文件头/README 记录一致。
- Layer 1.5（验证铁律）：**COMPLIANT**——制品附带的验证记录含具体命令 + 真实输出（`npx vitest
  run` 逐行汇总、fixture 逐份 exit code），未见"should pass"类推测性表述；本子代理对全部关键
  声称做了独立重跑复核，全部一致。
- Layer 2（工具链）：build / vitest 全量 / repo:check 三项本子代理独立复核均 exit 0（见 §1）。
- **一条 CRITICAL 级"未验证项"必须显式登记**（沿用旧版本判断，delta-3 后依旧成立）：本次
  改动的全部文件（`scripts/lib/coverage-gate-core.mjs` / `scripts/coverage-gate.mjs` /
  `.github/workflows/ci.yml` / fixtures / 测试文件）**均未提交、未 push，从未在真实 GitHub
  Actions 上运行过一次**（`git status` 显示两个 `??` 新脚本文件、`ci.yml` 与
  `release-ci-gates.test.ts` 为 `M` 未 commit，`specs/292-.../` 整目录未跟踪）。判定器的行为
  只在本地 vitest 单测 + 本子代理的本地实跑中被验证过。这不是"已消除"的风险，是尚未发生的
  验证空白，如实登记，不计入 CRITICAL 计数（制品本身已如实承认，未 over-claim "已在 CI 验证"）。

---

## 1. 全量门禁复跑（本子代理亲自跑，delta-3 终态）

### 1.1 `npx vitest run`（全量，2026-09-14 04:04:27 起跑）

```
Test Files  557 passed | 4 skipped (561)
     Tests  8293 passed | 15 skipped | 12 todo (8320)
  Start at  04:04:27
  Duration  67.01s (transform 6.43s, setup 0ms, collect 44.47s, tests 489.33s, environment 41ms, prepare 16.29s)
```
exit code: 0（vitest 未抛异常，命令自身正常结束）。**与旧版本报告记录的 delta-2 终态数字
（8291 passed）相比 +2**——恰好等于 delta-3 轮新增的两条判据测试（`CRITICAL fail-open 方向`
+ `镜像误伤方向`），数字变化方向与量级均可解释，非漂移。

### 1.2 `npm run build`

```
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> tsc
[postbuild:stamp] 盖章: commit=d0b0484d (dirty)
```
exit code: 0。

### 1.3 `npm run repo:check`

全部检查项 `pass`，唯一 `warn`：`graph-quality:freshness`（图产物 sourceCommit 落后当前 HEAD，
与本次改动无关，纯环境噪声，本仓 CLAUDE.local.md 已知问题）。exit code: 0。

未独立重跑 `npm run release:check` 与 `npm run test:plugins`（本卡未改动 release-contract /
plugin 元数据 / .mjs 插件面，风险面不涉及；仅记录未复核，不计入残余风险高优先级——与旧版本
判断一致）。

---

## 2. 14 份 fixture 判定对账（逐份独立实跑，delta-3 终态）

命令：`npx vitest run tests/unit/coverage-gate.test.ts`（内含遍历 14 份 fixture 的 CLI 子进程
对拍用例）+ 本子代理逐一核对与 README 声明的实跑退出码/期望判定一致。

| 样本 | 实跑 status | README 期望判定 | 实际 verdict | exit code | 结论 |
|---|---|---|---|---|---|
| clean-pass.ansi.txt | 0 | 放行 | pass | 0 | OK |
| birpc-timeout-pass.ansi.txt | 1 | 放行 | pass | 0 | OK |
| birpc-timeout-empty-counts.ansi.txt | 1 | 硬红 | red | 1 | OK |
| unhandled-other.ansi.txt | 1 | 硬红 | red | 1 | OK |
| tests-failed.ansi.txt | 1 | 硬红 | red | 1 | OK |
| threshold-miss.ansi.txt | 1 | 硬红 | red | 1 | OK |
| truncated-before-summary.ansi.txt | 1 | 硬红 | red | 1 | OK |
| summary-no-coverage-table.ansi.txt | 1 | 硬红 | red | 1 | OK |
| ci-run-34710678418-birpc-pass.ansi.txt | 1 | 放行（真实 CI 实况） | pass | 0 | OK |
| gha-unhandled-other.ansi.txt | 1 | 硬红 | red | 1 | OK |
| gha-birpc-and-real-crash.ansi.txt | 1 | 硬红 | red | 1 | OK |
| gha-birpc-empty-counts.ansi.txt | 1 | 硬红 | red | 1 | OK |
| gha-stdout-fake-signature.ansi.txt | 1 | 硬红 | red | 1 | OK |
| gha-onunhandlederror-timeout-real.ansi.txt | 1 | 硬红 | red | 1 | OK |

**14/14 全部一致，零偏差。**delta-3 只改动 `checkCoverageTable` 内部三处匹配语义，未改变任何
既有 fixture 的期望判定，14 份对账表与旧版本报告的记录逐字一致。

---

## 3. delta-3 两条新判据的独立变异实证

### 3.1 复核 `checkCoverageTable` 源码

已 Read `scripts/lib/coverage-gate-core.mjs`（第 313-374 行）确认现状：`reportMatch =
lastMatch('Coverage report from', '', stripped)`；`afterReport = stripped.slice(reportMatch.index
+ reportMatch[0].length)`；`stmtsMatch = afterReport.match(/%\s*Stmts/)`；`allFilesLineMatch =
afterReport.match(/^[ \t]*All files[ \t]*\|[ \t]*([\d.]+)/m)`；顺序判据收窄为
`stmtsMatch.index < allFilesLineMatch.index`（相对 index，`reportMatch` 已通过 `slice` 结构性
排在两者之前）——与文件头 delta-3 轮说明、`mutation-evidence.md` 记录的修法完全一致。

### 3.2 独立变异实证（本子代理自行操作，不采信 mutation-evidence.md 既有记录）

**方法**：
1. `cp scripts/lib/coverage-gate-core.mjs $SCRATCHPAD/coverage-gate-core.mjs.orig`，记录
   `md5 = 15ad4e7001e1864834e4560a59205e1a`。
2. 用 node 脚本原地替换 `checkCoverageTable`：还原为审查前的实现——三处独立 `.match()`（无
   `g`）各自取全文**第一处**，顺序判据改回三方绝对 index 比较
   `reportMatch.index < stmtsMatch.index && stmtsMatch.index < allFilesLineMatch.index`，
   其余代码不动。
3. 跑 `npx vitest run tests/unit/coverage-gate.test.ts`。
4. `cp` 回 `.orig` 复原，`md5` 比对确认逐字节一致（`15ad4e7001e1864834e4560a59205e1a`），重跑
   确认恢复全绿。

**变异后实测结果**：`Test Files 1 failed (1)` / `Tests 2 failed | 42 passed (44)`，**恰好且仅**
以下两条从绿翻红/翻绿，其余 42 条（含 R6a/R6b/W-1/summary-no-coverage-table 等既有 (c) 相关
用例）不受影响：

- `CRITICAL fail-open 方向：早期诱饵完整表（100%）不得掩盖日志真正收尾表的坍塌（0%）`：
  `AssertionError: expected 'pass' to be 'red'`（诱饵表 100% 被第一处匹配锁定，真正收尾的
  坍塌表 0% 被漏看，与设计意图完全吻合）。
- `镜像误伤方向：汇总行之前出现的诱饵表不得让日志真正收尾的合法表被误判为"出现在汇总行之前"`：
  `AssertionError: expected 'red' to be 'pass'`（诱饵表被第一处匹配锁定为"表"，其位置在汇总行
  之前触发误红，日志真正收尾的合法表被忽视）。

撤销变异、`md5` 比对逐字节复原后重跑：`Test Files 1 passed (1)` / `Tests 44 passed (44)`，
44/44 全绿恢复。

**结论**：变异恰好翻转 delta-3 声称要修复的两个方向（fail-open + 镜像误伤），且不影响其余
42 条既有用例，证明该修复对当前测试集构成必要且精确的覆盖——与 `mutation-evidence.md` delta-3
小节记录的"42 passed | 2 failed（共 44）"逐字节一致。

### 3.3 复核 `mutation-evidence.md` delta-3 小节与本子代理实测的一致性

已 Read `verification/mutation-evidence.md` 第 464-529 行。记录内容（修法描述、翻红的两条用例
名称、"42 passed | 2 failed（共 44）"、撤销后"44/44 全绿"、R6a 用例构造被改写的说明）与本子
代理 §3.2 的独立实测**完全一致，未发现不一致点**。

R6a 用例改写复核：已 Read `tests/unit/coverage-gate.test.ts` 第 198-228 行，确认现状是"同一张
表内部把 `All files` 提前到 `% Stmts` 之前"（`reorderedTable` 变量），而非旧构造"把 `All files`
整段放在 `Coverage report from` 之前"——与 `mutation-evidence.md` 的说明及 README 未涉及的
"顺带修正"记录吻合，该用例实测通过（见 §1.1 全量 44/44 中已含此用例）。

---

## 4. acceptance (i)-(v) 逐条承载与证据（delta-3 终态，本子代理实跑）

| # | 验收描述 | 承载 fixture/用例 | 实测退出码 | 实测 verdict | 一致? |
|---|---|---|---|---|---|
| (i) | 截断在汇总之前 + 含超时签名 ⇒ 红 | `truncated-before-summary.ansi.txt` | 1 | red | ✅ |
| (ii) | 汇总全过 + 表完整 + 超时签名 ⇒ 放行 | `birpc-timeout-pass.ansi.txt`（另有更贴近真实 CI 的 `ci-run-34710678418-birpc-pass.ansi.txt` 双重覆盖同一验收） | 1 | pass | ✅ |
| (iii) | 汇总含 failed ⇒ 红 | `tests-failed.ansi.txt` | 1 | red | ✅（触发负向检查 `Tests N failed`，行锚正则，先于三项正向检查生效） |
| (iv) | 含 does not meet ⇒ 红 | `threshold-miss.ansi.txt` | 1 | red | ✅（触发负向检查 `ERROR: Coverage for ... does not meet`） |
| (v) | 汇总全过但覆盖率表缺失 + 超时签名 ⇒ 红 | `summary-no-coverage-table.ansi.txt` | 1 | red | ✅（(c) 检查判红："覆盖率表不完整"） |

全部 5 条验收均有实测 fixture 承载且实跑结果与预期一致；delta-3 的改动范围限于 `checkCoverageTable`
内部三处匹配语义（"取第一处"→"取最后一处并结构性锚定同一张表"），不改变 (i)-(v) 这五条基本
验收的判定路径，逐条复核后均无回归。

---

## 5. 旧版本报告已做的复核项（沿用，delta-3 未触及，故结论不变）

以下内容已在 delta-2 终态复核中独立验证过，delta-3 只改动 `checkCoverageTable` 内部实现细节，
未触及这些检查项的逻辑，本子代理抽查确认结论仍然成立，不再重复全部操作：

- **§4a/4b（旧编号）三项正向检查逐条禁用变异**：(a) 汇总计数、(b) 未处理错误逐条核对——两项
  与 delta-3 改动的 (c) 检查相互独立，逻辑未变。本子代理抽查 (b) 检查源码（第 272-311 行）
  确认与旧版本报告描述一致，未受 delta-3 影响。
- **mutation-evidence.md delta-2 轮 C-1/C-2 抽查**：已在旧版本报告 §5a/5b 独立核实（vitest
  源码引用真实存在），delta-3 未改动这部分逻辑，结论沿用。
- **fix-report.md 残余风险表 R-1/R-3 措辞核对**：已在旧版本报告 §6 核实为"已收窄"而非夸大的
  "已解决"，delta-3 新增的 R-9 条目已在本报告 §6 单独核对（见下）。

---

## 6. over-claim 猎杀（含 delta-3 新增内容）

逐一核对 `fix-report.md` / `mutation-evidence.md` / 文件头注释中"已验证/已消除/必须红"类表述：

- **R-9（delta-3 新增）**：`fix-report.md` 第 134 行原文——"`checkCoverageTable` 三要素用无
  `g` 标志 `.match()` 各自取全文第一处匹配，与全文件其它检查统一用 `lastMatch` 取最后一处的
  语义不一致——**已被 delta-3 轮修复**：三处改用 `lastMatch` 并结构性锚定同一张表……两个方向
  均已用合成串隔离验证 + 变异测试确认（撤销修复后两条新用例精确翻转，其余 42 条不受影响）"。
  **本子代理独立复核**：§3.2 的独立变异实证精确复现了"撤销后 42 passed | 2 failed，且恰好是
  这两条用例翻转"这一具体量化声称，**未发现夸大，表述准确**。
- `fix-report.md` §残余风险表 R-1/R-3 仍标注为"已大幅收窄"/"已收窄"（非笼统"已解决"），且
  R-1 额外如实登记了"固有边界未消除"（分区头本身仍是纯文本匹配，理论上可被精确复刻的伪造
  分区绕过）——**未发现夸大**。
- 文件头 delta-3 轮说明（第 22-38 行）对两个方向的描述（fail-open / 镜像误伤）与 §3.2 实测的
  失败断言信息（`expected 'pass' to be 'red'` / `expected 'red' to be 'pass'`）方向完全对应，
  **未发现方向性夸大或错标**。
- `verification/mutation-evidence.md` delta-3 小节（第 500-529 行）的具体数字（"44/44 全绿变为
  42 passed | 2 failed"、"撤销后 44/44 全绿恢复"）已在 §3.3 独立复现，**逐字节一致，未发现
  数字夸大或篡改**。
- 未发现"真实 CI 已验证"类表述——制品均只声称本地 vitest + 手工构造样本的验证，与 §0 指出的
  "未提交、未跑过真实 CI"事实不矛盾。

**未发现 CRITICAL 级 over-claim。**

### WARNING（沿用旧版本报告已登记的 2 条，delta-3 未改变其性质）

1. `mutation-evidence.md` C-2 一节的一处内部文档组织瑕疵（段落标题与内容引用的样本文件名
   易读混淆）——纯文档可读性问题，不影响判定结论，不阻断交付。
2. R-4（(a)(b)(c) 三项间无交叉勾稽）与 R-6（"All files"整体坍塌兜底的局限）性质接近但分开
   登记，属文档组织层面的轻微冗余，非缺陷。

---

## 7. 残余风险与未验证项（如实登记，不粉饰）

1. **【CRITICAL 级別注意，登记为已知事实而非新发现】本次改动尚未在真实 GitHub Actions 上跑过**——
   截至本次复核（2026-09-14），`scripts/lib/coverage-gate-core.mjs`、`scripts/coverage-gate.mjs`、
   `.github/workflows/ci.yml`、全部 fixture 与测试文件均**未 commit、未 push**（`git status`
   仍显示与 delta-3 复核前相同的未跟踪/已修改状态）。GHA runner 的真实 shell 语义（`set +e`
   跨 shell/version 行为、`actions/upload-artifact@v4` 在 `if: always()` 下能否稳定拿到
   `coverage.log`、真实的 `GITHUB_ACTIONS=true` reporter 输出与本地采集的 fixture 是否存在
   本地未曾复现的差异形态）**只有推送后首个真实 CI run 才能给出最终验收**。本子代理的一切
   PASS 结论均建立在本地 vitest + 手工/半自动采集的 14 份真实语料样本之上，**不构成"已在生产
   CI 环境验证"的证据**。
2. delta-3 引入的 `checkCoverageTable` 修复本身有一个**结构性未覆盖的组合场景**：若日志中
   出现 3 张及以上的表（诱饵表 A → 诱饵表 B → 真实收尾表 C），当前实现的"先锚最后一处
   report 头、再在其后子串找剩余两要素"依然只保证锚定**最后一张表**，这与设计意图一致，
   本子代理未发现该场景下的新退化；但**多张诱饵表叠加**的具体形态未见对应合成串测试用例
   （现有两条用例均只构造"1 诱饵 + 1 真实"两张表的场景）——如实登记为未覆盖的边界组合，
   非缺陷，供后续按需补测。
3. R-1（分区头可被精确复刻的伪造文案绕过）、R-4（三项检查无交叉勾稽）、R-5（判据冻结在
   vitest 3.2.4 输出形态）、R-6（W-1 只兜聚合归零坍塌）、R-7（`status===0` 收紧的已知取舍）
   均为 `fix-report.md` 已如实登记的固有边界/有意取舍，delta-3 未改变其分类，本子代理认可其
   准确性，未发现被错误标注为"已解决"。
4. 本子代理未复跑 `npm run release:check` 与 `npm run test:plugins`（本卡改动面未触及对应
   合同），风险极低但如实标注未独立复核。

---

## 8. 三档结论

- **CRITICAL：0**
- **WARNING：2**（见 §6，均为文档可读性/组织层面，不影响判定器行为正确性，沿用旧版本已登记项）
- **INFO**：真实 CI 尚未运行（见 §7 #1，最高优先级残余项）；delta-3 修复未覆盖"3 张及以上表"
  的组合场景合成串（见 §7 #2）；未复核 release:check / test:plugins（见 §7 #4）

## 总体结果：✅ READY（PASS，delta-3 终态；附残余风险清单，**待真实 CI 首跑收尾**）
