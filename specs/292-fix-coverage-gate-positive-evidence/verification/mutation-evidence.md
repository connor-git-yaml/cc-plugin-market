---
feature: 292-fix-coverage-gate-positive-evidence
kind: mutation-evidence
based_on: plan.md 决策4「变异隔离表」/ tasks.md T012-T015
---

# 变异实证记录 — F292 coverage-gate 判定器

本记录对应 tasks.md Phase 6（T012-T015）。每条正向/负向检查逐一**临时**注释/短路，实跑
`npx vitest run tests/unit/coverage-gate.test.ts`，如实记录哪些用例从绿转红（翻转），撤销后
重跑确认全绿恢复。全部改动均为一次性操作，未保留在最终代码里（`git diff` 应只见
`coverage-gate-core.mjs` 的正式实现，不含任何 `MUTATION-*` 注释残留）。

## T012 — 变异 (a) 汇总计数检查

**改动**：`checkSummaryCounts` 函数体首行改为 `return { ok: true, reason: null };`（恒真短路，
其后原逻辑变成死代码但未删除，仅用于本次实证）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts`

**从绿转红的用例（Phase 7 刚完成时实测 3 条/总数 19；delta 轮对旧代码状态重新实跑更正为
4 条/总数 21——见下方「T012 记录更正」）**：
1. `F292 · judgeCoverageLog — 8 份真实样本 > birpc-timeout-empty-counts.ansi.txt（status=1）⇒ verdict=red exitCode=1`
   （实际收到 `pass`，因为计数被打丢的空壳形态本应只被 (a) 拦截）
2. `F292 · judgeCoverageLog — 8 份真实样本 > birpc-timeout-empty-counts.ansi.txt 现仅触发 (a)：Errors(1)==签名数(1) 本身满足`
   （断言 `reasons` 应含 `(a)` 且不含 `(b)`，短路后 `reasons` 变为"三项正向检查全部满足"文案，两个 `toMatch` 都不再成立）
3. `F292 · judgeCoverageLog — 变异隔离用例 > 汇总计数 (a)：挖空 passed 计数（其余签名/Errors/表格不动）⇒ 单独判红`
   （T004 合成串，专为隔离 (a) 编写）
4. `F292 · judgeCoverageLog — 异构对抗审查回归 > CRITICAL 回归：诱饵行不得劫持真实收尾汇总行（早期实现用无 g 标志 .exec 只取第一处匹配）`
   （该用例断言 `reasons` 含 `(a)`；短路后 (a) 恒真，判定翻为 pass，断言失败——Phase 7
   完成后新增的这条回归测试同样依赖 (a) 检查真的生效，本次重跑之前的旧记录漏记了它）

**其余 17 条用例不受影响**（未涉及计数为空/未知类别的场景）。

**撤销**：还原 `checkSummaryCounts` 原实现，重跑确认全绿。

### T012 记录更正（delta 轮，2026-09-14）

主编排器复核时发现：上表"3 条/19"是 Phase 7 补充 2 条回归测试**之前**的旧数字，与
`coverage-gate.test.ts` 当前实际用例总数（21）不一致。delta 轮对**返工之前**的代码状态
（即本文件上方记载的 `coverage-gate-core.mjs` 首轮实现 + `coverage-gate.test.ts` 含 Phase 7
两条回归测试的版本）重新实跑同一变异（`checkSummaryCounts` 函数体首行改
`return { ok: true, reason: null };`）：

```
$ npx vitest run tests/unit/coverage-gate.test.ts
...
 Test Files  1 failed (1)
      Tests  4 failed | 17 passed (21)
```

翻转的 4 条用例即上方列出的 1-4（比旧记录多出第 4 条：`CRITICAL 回归：诱饵行不得劫持真实
收尾汇总行`）。撤销变异后重跑：`21 passed (21)`，确认恢复干净。**结论**：本条记录的准确
数字应为 **4 条翻转 / 总数 21**，不是旧文档的 3 条/19；已在上方表格中更正，原因是 Phase 7
新增的回归测试同样构成 (a) 检查的隐式覆盖，之前整理表格时遗漏了这层依赖关系，属于文档
记录疏漏，非算法本身有问题。

---

## T013 — 变异 (b) Errors 数 == 签名数检查

**改动**：`checkErrorSignature` 函数体首行改为
`return { ok: true, reason: null, errorLine: null, errCount: 0, sigCount: 0 };`（恒真短路）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts`

**从绿转红的用例（4 条）**：
1. `F292 · judgeCoverageLog — 8 份真实样本 > unhandled-other.ansi.txt（status=1）⇒ verdict=red exitCode=1`
   （实际收到 `pass`——真实未处理错误搭 birpc 假红的便车被放行，正是本次要堵的第三个洞）
2. `F292 · judgeCoverageLog — 8 份真实样本 > birpc-timeout-empty-counts.ansi.txt 现仅触发 (a)：Errors(1)==签名数(1) 本身满足`
   （该用例断言 `evidence.errorCount===1`；短路后 `errCount` 被恒定置 0，断言失败——
   属于 evidence 字段被恒真桩值污染的**伴随翻转**，不是独立的语义漏洞，特此如实登记，
   不算作预期表格外的意外发现）
3. `F292 · judgeCoverageLog — 变异隔离用例 > 签名数不匹配 (b)：unhandled-other 的 Errors=1 但签名文本是 boom unhandled，signatureCount=0≠1`
   （T005 用例 1）
4. `F292 · judgeCoverageLog — 变异隔离用例 > Errors 行缺失 (b)：全过日志却手写 status=1 且无 Errors 行 ⇒ 判红`
   （T005 用例 2，合成串）

**与 tasks.md 预期对照**：tasks.md 预期「至少 unhandled-other + T005 Errors 行缺失合成串」两条，
实测多出 1 条（`birpc-timeout-empty-counts` 的 evidence 一致性断言），原因如上，非算法缺陷。

**撤销**：还原 `checkErrorSignature` 原实现，重跑确认 19/19 全绿。

---

## T014 — 变异 (c) 覆盖率表完整性 / 末行收尾检查

**改动**：`checkCoverageTable` 函数体首行改为 `return { ok: true, reason: null };`（恒真短路）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts`

**从绿转红的用例（3 条）**：
1. `F292 · judgeCoverageLog — 8 份真实样本 > summary-no-coverage-table.ansi.txt（status=1）⇒ verdict=red exitCode=1`
   （实际收到 `pass`——汇总全过但覆盖率表整体缺失，本应被 (c) 拦截）
2. `F292 · judgeCoverageLog — 变异隔离用例 > 覆盖率表缺失 (c)：summary-no-coverage-table 汇总全过但表缺失 ⇒ 判红`
3. `F292 · judgeCoverageLog — 变异隔离用例 > 末行非收尾分隔线 (c)：表完整但收尾分隔线后追加无害噪声 ⇒ 单独判红`
   （T006 合成串，证明"末行必须是分隔线"独立生效）

**与 tasks.md 预期的偏差（诚实登记，非缺陷）**：tasks.md 原预期还应包含
`tests-failed.ansi.txt` 翻转，**实测未翻转**。核实原因：`tests-failed.ansi.txt` 的汇总行
含 `1 failed`，在到达 (c) 检查之前就已被**负向检查**（`Tests\s+\d+\s+failed`）短路判红——
(c) 检查根本没被执行到，因此单独禁用 (c) 不会影响该用例的判定结果。这是判定算法「负向检查
优先于正向检查」设计意图的正确体现（也是 T007/T015 专门验证的性质），不是 (c) 检查本身失效
的证据，故本任务的隔离证明以上述 3 条真实翻转用例为准，不强行凑够 tasks.md 描述的数量。

**撤销**：还原 `checkCoverageTable` 原实现，重跑确认 19/19 全绿。

---

## T015 — 变异负向检查（阈值未达 / 汇总 failed）

**改动**：把两条负向检查的 `if` 条件短路为 `if (false && ...)`（恒不命中）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts`

**首次尝试与修正**：第一版 T007 合成串（`birpc-timeout-pass.ansi.txt` 内容后直接追加一行
`ERROR: Coverage for ... does not meet ...`）在负向检查关闭后**没有**从红翻转为 pass——
排查发现该合成串同时违反了 (c)（追加内容让"末行不再是收尾分隔线"），verdict 仍判红，
但判红理由变成了 `(c)`，而非预期的"负向检查命中"，说明原合成串把负向检查与 (c) 检查
耦合在了一起，无法单独证明负向检查的优先级。

修正：把阈值未达行插在收尾分隔线**之前**、并在其后补一份相同的分隔线收尾（保持
"末行即分隔线"不变量成立，让 (a)(b)(c) 三项正向检查在语义上均满足），只让"日志中含有
`does not meet` 文本"这一个变量生效。同步更新了 `tests/unit/coverage-gate.test.ts` 中
该用例的实现（用例名同步改为「本应放行的样本混入阈值未达行（收尾分隔线保持完整）」）。

**从绿转红的用例（修正后，1 条，符合预期）**：
1. `F292 · judgeCoverageLog — 变异隔离用例 > 负向检查优先级：本应放行的样本混入阈值未达行（收尾分隔线保持完整）⇒ 依旧判红（负向检查优先于三项正向检查）`
   （实际收到 `pass`——三项正向检查全部满足时，若无负向检查兜底，含阈值未达文本的样本会被误判放行）

**其余 18 条用例不受影响**（该合成串的构造刻意排除对 (a)(b)(c) 的影响，唯一变量是负向检查开关）。

**撤销**：还原两条负向检查的 `if` 条件，重跑确认 19/19 全绿。

---

## 汇总结论

- 四组变异 —— (a) 汇总计数 / (b) Errors-签名匹配 / (c) 覆盖率表完整性 / 负向检查优先级 ——
  每组都能定位到至少 1 条专属用例发生红→绿的误判翻转，证明四项检查均为**必要**（删掉任一项
  都会让至少一种已知假红/假绿场景重新被放行）。
- 撤销后复跑 `npx vitest run tests/unit/coverage-gate.test.ts`：19/19 全绿。
- 最终代码 `scripts/lib/coverage-gate-core.mjs` 不含任何变异期间引入的 `MUTATION-*` 标记或
  短路逻辑（已逐条撤销并复核 `grep -n "MUTATION"` 零命中）。
- 唯一的实现调整：修正了 `tests/unit/coverage-gate.test.ts` 中「负向检查优先级」合成串的构造方式，
  使其不再与 (c) 检查耦合，属于测试用例本身的精化，不涉及 `coverage-gate-core.mjs` 逻辑改动。

---

## Phase 7 异构对抗审查发现与修复（附于变异实证之后）

按 CLAUDE.local.md 常设规则，本卡改动落在门禁/判定器类别，须过异构对抗审查（Codex 配额暂停期间，
执行者换为独立子代理 `general-purpose`，非 Codex，档位缺席已在 commit message 标注）。

审查覆盖 plan.md §7 两个切入角，独立子代理**用真实 fixture + 实跑脚本**（非纸面推演）复现如下发现：

| 级别 | 发现 | 触发条件 | 后果 | 处置 |
|---|---|---|---|---|
| CRITICAL | `parseSummaryLine`/evidence 展示正则用无 `g` 标志的 `.exec()`，只取日志中**第一处**匹配而非真正的收尾汇总行 | 在真实"计数被打丢"样本（`birpc-timeout-empty-counts.ansi.txt`）前追加两行顶格诱饵文本 `Test Files 1 passed (1)` / `Tests 2 passed (2)` | (a) 检查被诱饵行劫持，本该红的判定翻成 pass；且 CLI 打印给人工复核的 evidence 也被同一诱饵污染 | **已修复**：新增 `lastMatch` helper，所有汇总/Errors 行匹配改取全文最后一处；已用原触发场景验证判定恢复为红，且新增回归测试 `CRITICAL 回归：诱饵行不得劫持真实收尾汇总行` |
| WARNING | CLI 薄壳 `Number.isInteger(Number(statusArg))` 对空字符串误判为合法（`Number('')===0`） | `node scripts/coverage-gate.mjs <log> ""` | 空字符串 status 被静默当成 `0`（成功），绕过全部正向检查——与文件头部"fail-closed"声明的承诺不符；经核实当前 `ci.yml` 的 `"${status}"` 取自 bash `$?`，不存在能产出空串的已知路径，故为防御纵深缺口而非当前可外部触发路径 | **已修复**：argv 校验改用严格正则 `/^-?\d+$/`，拒绝空串/纯空白串；新增回归测试 `WARNING 回归：空字符串 status 不得被 Number.isInteger 静默当成 0` |
| WARNING | (a)(b)(c) 三项正向检查互相独立评估、无交叉勾稽 | 构造"500 passed / 9999 passed"但覆盖率表只有 1 个 0% 文件的自相矛盾日志 | 仍判 pass——判定器只能相信 vitest 自己吐出的文本，这是任何纯日志文本判定器的固有信任边界，非本次改动引入的新缺陷 | **不处置（用户可后续拍板）**：加交叉校验只是提高攻击成本而非消除风险，且会引入新的耦合面，超出本次 fix-report 范围；已如实登记为残余风险 |
| INFO ×5 | 非 SGR CSI 序列 / CRLF 换行 / 零宽字符 / 类别正则大小写与噪声词 / 签名子串计数与断言失败源码回显耦合 | 各自构造场景实跑验证 | 均确认方向安全（宁可误报红不放过真失败）或已被负向检查兜底，不构成 fail-open | 不处置，已如实登记 |

修复后重跑 `npx vitest run tests/unit/coverage-gate.test.ts tests/unit/release-ci-gates.test.ts`：
32/32 全绿（含 2 条新增回归测试）。

---

## delta 轮对抗审查返工验证记录（R1-R8，2026-09-14）

主编排器两路独立异构对抗（角 A fail-open 视角 / 角 B 误伤面视角）在上述 Phase 7 修复之后
再挖出多处问题（详见 fix-report.md 更新与 implementation-notes.md 「delta 轮返工逐条说明」）。
本节记录每一条返工要求的实际变异实证——**先在旧代码/旧断言上复现问题（红→绿或误放），
再在新实现上验证已收敛**，撤销临时改动后全绿恢复。

### R1 — YAML 接线四种变异体（返工前守护断言全部漏放）

**命令**：手工在 `.github/workflows/ci.yml` 的 `Coverage (thresholds enforced)` 步逐一注入
以下 4 种变异（每次只改一处，跑完立即用 `cp` 还原、`diff` 确认字节级一致），跑
`npx vitest run tests/unit/release-ci-gates.test.ts -t "coverage job"`：

| 变异 | 改动 | 返工前（旧 `toContain` 断言） | 返工后（新 `toEqual` + if 不存在性断言） |
|---|---|---|---|
| A | `gate_status=$?` 后插一行 `gate_status=0` | ✓ 通过（漏放） | ✗ 判红（`toEqual` 精确钉 6 行序列不匹配） |
| B | `gate_status=$?` 后追加 `node scripts/coverage-gate.mjs coverage.log "0" \|\| true` | ✓ 通过（漏放） | ✗ 判红 |
| D | `status=$?` 后插一行 `status=0` | ✓ 通过（漏放） | ✗ 判红 |
| E | 步骤级加 `if: false` | ✓ 通过（漏放） | ✗ 判红（`ifLine` 不存在性断言失败） |

四次变异均已撤销并用 `diff /tmp/ci.yml.bak .github/workflows/ci.yml` 确认与原始文件字节级
一致（`RESTORED OK`）。返工后 `npx vitest run tests/unit/release-ci-gates.test.ts` 恢复
11/11 全绿。

### R2 — CRITICAL：`::error` 注解复制的 birpc 签名让含真实崩溃的批次误判放行

**命令**：把 `checkErrorSignature` 临时替换回 delta 轮之前的全文子串计数实现（保留其余新
增改动不变，包括 `stripGithubWorkflowCommands`），对真实语料 `gha-birpc-and-real-crash.ansi.txt`
（1 条 birpc 签名手抛错误 + 1 条真崩溃 `boom real crash`，两条各自都有 `::error` 注解）跑
`judgeCoverageLog`：

```
gha-birpc-and-real-crash.ansi.txt => red ["(b) Errors 计数(2) 与已知 birpc 签名计数(1) 不相等"]
```

（此时 `stripGithubWorkflowCommands` 仍在生效，已把注解复制的签名副本剔除，子串计数=1≠2，
正确判红——证明**仅靠剔除注解**已足以修复。）

再额外关闭 `stripGithubWorkflowCommands`（即完整复现 delta 轮之前的状态：旧子串计数 + 不剥
注解）：

```
gha-birpc-and-real-crash.ansi.txt（旧子串计数 + 不剥注解）=> pass ["三项正向检查全部满足：..."]
```

**复现了 CRITICAL 本身**：注解复制的签名副本(1)+正文签名(1)=子串命中数 2，恰好等于 Errors
计数 2，误判放行。两处修复（逐条标题核对 / 剔除注解）在当前实现中同时生效，任一单独存在
都足以修复该 CRITICAL（详见 implementation-notes.md 已知偏差 3，如实记录"双重覆盖"而非两个
互相独立必要的条件）。返工后（当前实现）对该 fixture 判红（`(b) 至少一条未处理错误标题不
属于已知 birpc 超时家族签名`），已固化为 `coverage-gate.test.ts` 主样本表 + delta 轮回归
用例 `R2 CRITICAL`。

### R3 — 家族正则容忍不同 RPC 通道/方法名

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "R3"`，用合成串遍历
`[vitest-worker]:onTaskUpdate` / `[vitest-worker]:snapshotSaved` / `[vitest-pool]:onCollected`
/ `[vitest-api]:onUserConsoleLog` 四种组合，全部放行；反例 `[vitest-fake]:onTaskUpdate`
（伪造非 birpc 家族通道）判红。用**旧字面量实现**（钉死 `onTaskUpdate`）重跑同一合成串：
`snapshotSaved`/`onCollected`/`onUserConsoleLog` 三种全部误判红（因为字面量根本不匹配），
证明字面量钉死会在正常的假红变体上制造无谓噪声。

### R4 — 跨行拼接噪声 / 非锚定负向检查误伤

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "R4"`。在真实放行样本
`birpc-timeout-pass.ansi.txt` 中注入 `Tests\n3 failed to parse` 与非锚定的
`coverage for module-x does not meet spec requirements` 噪声，新实现仍判 pass。用**旧无锚
正则**（`/does not meet|ERROR: Coverage for/` 与 `/Tests\s+\d+\s+failed|.../`）重跑同一
注入样本：两条负向检查均被触发，误判红——证明旧实现存在真实的误伤面。

### R5 — 未知汇总类别（含 flaky）

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "R5"`。分别注入 `1 errored`
与 `1 flaky` 到 Tests 汇总行，新实现均判红（`(a)` 未知类别）。用**旧硬编码类别正则**
（`(passed|failed|skipped|todo)`）重跑：`errored`/`flaky` 段被正则直接跳过、不出现在抽取
结果里，`(a)` 检查看到"仍有 passed>=1 且全部已知类别落在白名单"即放行——证明旧实现对
未知类别是"视而不见"而非"识别并拒绝"。

### R6 — 覆盖率表顺序/位置约束

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "R6"`。R6a（三要素顺序错乱：
`All files` 提前到 `Coverage report from` 之前）与 R6b（整张表出现在汇总行之前）均判红；
正常顺序/位置的 sanity 分支仍放行。用**旧实现**（只做存在性检查、无顺序/位置约束）重跑
同一构造：两种变异均被误判 pass——证明旧实现确实缺这层约束。

### R7 — ANSI/换行边界（消融实验，非回归修复）

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "R7"`。

- R7a（裸 `\r`，无 `\n`）：新实现（含 CRLF/裸 `\r` 归一化）判 pass；关闭归一化重跑（`stripAnsi`
  跳过 `\r`→`\n` 替换）：`checkCoverageTable` 的 `split('\n')` 把整份日志当成一整行，末行
  非分隔线，误判红（`(c) 全日志最后一个非空行不是覆盖率表收尾分隔线（实为: "RUN ...`）——
  证明裸 `\r` 场景是真实差异。
- R7b（OSC-8 包裹分隔线）：新实现（宽 ANSI 正则）判 pass；换回旧窄 ANSI 正则
  （只剥 `\x1b\[[0-9;]*m`）重跑：`\x1b]8;;url\x07` 前缀原样保留在行首，`/^-+\|/` 不匹配，
  误判红——证明 OSC-8 场景是真实差异。
- 消融实验额外发现（如实记录，未构成新增修复项）：CRLF（`\r\n`）场景即便关闭归一化，
  当前检查仍判 pass——因为 JS 正则 `^`/`$` 在 `/m` 模式下把 `\r` 本身视为独立的行终止符，
  `[ \t]*$` 恰好能在 `\r` 之前收尾匹配成功，`.trim()` 也会清掉行尾 `\r`。归一化对这一子
  场景是防御纵深而非必要修复，测试用例因此改用裸 `\r`（而非 CRLF）以确保测到真实差异。

### 汇总（delta 轮）

- 返工涉及的 8 项（R1-R8）中，R1-R6 均已用"旧代码/旧断言复现问题 → 新代码/新断言收敛"
  的对照方式验证；R7 的两个子场景（裸 `\r`、OSC-8）同样完成对照验证，CRLF 子场景经消融
  确认不构成真实差异，已如实记录而非虚报。
- `npx vitest run tests/unit/coverage-gate.test.ts`：33/33 全绿（21 首轮 + 12 delta 轮新增，
  含 4 份新真实样本 + 9 条合成/回归用例）。
- `npx vitest run tests/unit/coverage-gate.test.ts tests/unit/release-ci-gates.test.ts`：
  44/44 全绿。
- 所有临时变异（YAML 注入、核心逻辑替换文件）均在 `/tmp/` 或原地改后立即用 `cp`/`diff`
  撤销，最终交付代码 `git diff` 不含任何 `MUTATION-*`/`TEMP-*` 标记（已用
  `grep -rn "MUTATION\|TEMP-OLD\|TEMP:" scripts/lib/coverage-gate-core.mjs
  .github/workflows/ci.yml` 复核零命中）。

---

## delta-2 轮（第三轮异构对抗，专攻 delta 轮新判据本身）

第三轮独立异构对抗审查专门攻击 delta 轮刚写出的"标题行数 == Errors 计数"判据本身，
挖出 2 CRITICAL + 3 WARNING + 2 INFO。主编排器亲自在 vitest 3.2.4 源码
（`node_modules/vitest/dist/chunks/rpc.-pEldfrD.js` / `execute.B7h3T_Hc.js` /
`coverage.DL5VHqXY.js`）与实跑上坐实 C-1/C-2，直接照修。

### 变异方法论（本轮统一做法）

对 `scripts/lib/coverage-gate-core.mjs`（以及一次对 `scripts/coverage-gate.mjs`）逐条禁用
新判据，每次改动前用 `cp` 到 `$SCRATCHPAD/coverage-gate-core.mjs.golden`（及
`coverage-gate.mjs.golden`）留底，改后用 `npx vitest run tests/unit/coverage-gate.test.ts
-t "<关键词>"` 单独验证该判据对应用例翻红，再用 `cp $SCRATCHPAD/*.golden scripts/...`
逐字节还原、重跑全量确认恢复 42/42（含 CLI 44/44 联跑），杜绝"改完忘记撤销"混入交付代码。

### C-1 CRITICAL — 标题提取未锚定分区（`extractUnhandledSectionTitles`）

**判据**：标题只能从 `UNHANDLED_SECTION_HEADER`（`⎯+ Unhandled Error/Unhandled
Rejection/Uncaught Exception ⎯+`）之后提取，不再用全文正则扫描任意"看起来像标题"的行。

**真实语料**：`gha-onunhandlederror-timeout-real.ansi.txt` fixture 名字写错前缀，实际
主证据是 `gha-stdout-fake-signature.ansi.txt`——vitest 3.2.4 实跑，测试用 `console.log`
在 stdout 顶格打印两行伪造签名 `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` /
`"snapshotSaved"`，同时真实抛出两条 `Promise.reject('boom-primitive-*')` 触发的
`Unhandled Rejection`（标题 `Unknown Error: boom-primitive-*`）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "C-1"`。

**变异**：把 `extractUnhandledSectionTitles` 替换为 delta 轮的全文正则实现
（`/^(?:[A-Za-z_$][\w$]*)?(?:Error|Exception):\s.*$/gm` 扫全文）。

**结果**：
- `C-1 CRITICAL：伪造的顶格...` 用例：`expected 'pass' to be 'red'`（伪造行被当成标题
  计入，2 == Errors(2) 且都匹配家族签名，误判放行）。
- 主用例表 `gha-stdout-fake-signature.ansi.txt（status=1）⇒ verdict=red` 用例同样翻红
  （`expected 'pass' to be 'red'`）。
撤销变异后重跑 `npx vitest run tests/unit/coverage-gate.test.ts`：42/42 全绿，恢复。

### C-2 CRITICAL — 家族签名允许 payload 尾巴（`BIRPC_TITLE_STRICT`）

**判据**：整行严格匹配 `^Error: \[vitest-(?:worker|pool|api)\]: Timeout calling
"[A-Za-z0-9_$]+"$`，禁止任何 ` with "..."` payload 尾巴。

**真实复现**（非外科替换，真实 vitest 3.2.4 实跑成功，见下方"真实复现记录"）：
`tests/fixtures/coverage-gate/gha-onunhandlederror-timeout-real.ansi.txt`。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "C-2"`。

**变异**：把 `BIRPC_TITLE_STRICT`（严格正则）替换为 delta 轮的子串测试对象
（`{ test: (s) => /\[vitest-(?:worker|pool|api)\]: Timeout calling "[A-Za-z0-9_$]+"/.test(s) }`）。

**结果**：合成串隔离用例（单分区、单标题、汇总/表格均合法，唯一变量是标题带
` with "boom real message"` payload 尾巴）：`expected 'pass' to be 'red'`——旧子串正则
把带 payload 的超时误判为已知假红而放行。撤销变异后重跑：42/42 全绿，恢复。

**真实复现记录（如实登记采集口径）**：
1. 第 1 次尝试：`block-reporter.mjs`（`onTaskUpdate` 首次回调阻塞 61s）+ 顶层
   `Promise.reject`——实测 `Unhandled Rejection` 被正常报告（无超时），另一条不相关的
   `snapshotSaved` 超时。**不是目标形态**。
2. 第 2 次尝试：`block-reporter-init.mjs`（`onInit` 阻塞 61s）+ 顶层 `Promise.reject`——
   实测 `Unhandled Rejection` 仍被正常报告（无超时）。**不是目标形态**。
3. 第 3 次尝试（成功）：`block-reporter-collected.mjs`（`onCollected` 首次回调阻塞
   61s，`onCollected` 在收集阶段早于任何测试执行触发）+ 顶层 `Promise.reject`——真实产出
   3 条级联错误：①"Unknown Error: boom-onUnhandledError-real"（原始拒绝，正常报告）
   ②"Error: [vitest-worker]: Timeout calling \"onUnhandledError\" with \"boom
   real message\"→实际内容为 boom-onUnhandledError-real"（**目标形态**：worker 的
   `catchError`→`rpc.onUnhandledError()` 调用未被 await，超时后其被拒绝的 promise
   自身成为新的未处理拒绝，递归触发第二次 catchError 调用，此次成功送达并被正常报告）
   ③"Error: [vitest-worker]: Timeout calling \"resolveSnapshotPath\""（级联的第三条，
   同样的阻塞窗口下另一 RPC 调用超时）。
   命令：`CI=true GITHUB_ACTIONS=true node_modules/.bin/vitest run --config cfg-c5.mjs`
   （scratch 工程 `$SCRATCHPAD/vt`，`cfg-c5.mjs` + `block-reporter-collected.mjs`）。
   **如实登记**：该真实 fixture 因阻塞发生在收集阶段，测试从未真正执行，`(a)`（零 passed）
   与 `(c)`（无覆盖率表）也同时判红，且该样本另有 2 条不匹配严格签名的标题（①的
   "Unknown Error"、③的 "resolveSnapshotPath" 本身合法但①already 破坏 allTitlesAreBirpc）
   ——是"多重原因同时判红"的真实语料，**不能单独隔离证明 C-2**，故 C-2 的单独隔离证明
   用上方合成串完成，真实语料仅作为"该消息形态在生产环境确实会出现"的存在性佐证。

### W-1 WARNING — 覆盖率表 "All files" 首项百分比 > 0（`checkCoverageTable`）

**判据**：解析 `All files` 行首个百分比数值，要求 `> 0`。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "W-1"`。

**变异**：把 `checkCoverageTable` 里的 `if (!(firstPct > 0))` 改为 `if (false &&
!(firstPct > 0))`（恒不触发）。

**结果**：合成串隔离用例（`All files | 0 | 0 | 0 | 0 |`，其余汇总/签名合法）：
`expected 'pass' to be 'red'`。撤销变异后重跑：42/42 全绿，恢复。

**残余风险如实登记**：只兜住"整体聚合归零"这一种坍塌形态；"部分文件覆盖率丢失、但聚合
仍达标"（如漏统计一个大文件、聚合百分比看起来仍正常）无法被本检查发现。已写入
fix-report.md 残余风险表。

### W-2 WARNING — CLI 薄壳与 core 绑定断言

**判据**：新增两条测试——(1) 源码断言 `scripts/coverage-gate.mjs` 必须 `import` 且调用
`judgeCoverageLog`；(2) 遍历全部 14 份 fixture，CLI 子进程 exitCode 必须与直调
`judgeCoverageLog` 的 exitCode 逐份相等。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "W-2"`。

**变异**：把 `scripts/coverage-gate.mjs` 整体替换为"不 import core、内部写回旧的负向
grep 逻辑"的变体（`/does not meet|failed/` 子串测试）。

**结果**：
- 源码断言用例：直接失败（`expect(src).toMatch(...)` 不匹配）。
- 逐份对拍用例：`fixture=birpc-timeout-empty-counts.ansi.txt status=1: expected +0 to
  be 1`（旧 grep 逻辑对"计数被打丢"样本无 `does not meet`/`failed` 字样，误判放行）。
- **对照验证**：同一份变异下 `npx vitest run tests/unit/release-ci-gates.test.ts` 仍
  11/11 全绿——证实审查描述准确：既有 release-ci-gates 的两条 core 子串断言与 CLI 既有
  5 条用例**都没有**在 CLI 与 core 分道扬镳时报警，W-2 新增的两条测试是唯一能捕获该
  退化的守护。
撤销变异后重跑（`cp $SCRATCHPAD/coverage-gate.mjs.golden scripts/coverage-gate.mjs`）：
`npx vitest run tests/unit/coverage-gate.test.ts tests/unit/release-ci-gates.test.ts`：
53/53 全绿，恢复。

### W-3 WARNING — status===0 也要求 (a)(c) 正向证据

**判据**：`status===0` 分支不再零正向证据直接放行，改为同时要求 `checkSummaryCounts` 与
`checkCoverageTable` 通过（不要求 `checkErrorSignature`，因为没有非零退出需要解释）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "W-3"`。

**变异**：把 `status === 0` 分支还原为 delta 轮的零检查直接 `pass`。

**结果**：合成串隔离用例（`status=0`、`Test Files   (1)` / `Tests   (2)` 零 passed
计数、覆盖率表完整）：`expected 'pass' to be 'red'`——旧逻辑对全量 skip 的绿批直接放行。
撤销变异后重跑：42/42 全绿，恢复。

**已知取舍如实登记**：全量 skip（零 passed）的跑批在 `status=0` 下现在会被判红，这是
有意收紧，已写入本文件与 fix-report.md 残余风险表。

### I-1 INFO — 负阈值形态负向检查

**判据**：新增第二条负向检查 `^[ \t]*ERROR: Uncovered .*exceed .*threshold[ \t]*\(.*\).*$`，
匹配 vitest 负阈值配置（`thresholds.<key> < 0`）产出的 `ERROR: Uncovered <key> (N) exceed
... threshold (M)` 文案（`coverage.DL5VHqXY.js:4163-4177` 已核实源码）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "I-1"`。

**变异**：把该负向检查的 `if` 条件改为 `if (false && ...)`（恒不触发）。

**结果**：合成串隔离用例（在放行样本尾部追加 `ERROR: Uncovered statements (33) exceed
threshold (30)`）：`expected 'pass' to be 'red'`。撤销变异后重跑：42/42 全绿，恢复。

**如实登记**：本仓当前 `vitest.config.ts` 覆盖率阈值均为正百分比，该负向检查形态在
现行配置下不可达，属提前覆盖（阈值配置改成负数才会激活）。

### I-2 INFO — CLI 打印标签更正（非行为变更，未做变异测试）

`scripts/coverage-gate.mjs` 打印的 `signatureCount(onTaskUpdate)=` 改为
`birpcTimeoutTitles=`——仅字面量更正，不改变判定逻辑，不适用变异测试方法论（改动
本身没有"可禁用的行为"）。已用 `node scripts/coverage-gate.mjs
tests/fixtures/coverage-gate/gha-stdout-fake-signature.ansi.txt 1` 实跑确认新标签
正确输出（`birpcTimeoutTitles=0`）。

### 汇总（delta-2 轮）

| 判据 | 变异方式 | 翻红用例 | 状态 |
|---|---|---|---|
| C-1 分区锚定 | 恢复全文标题正则 | `C-1 CRITICAL` + 主表 `gha-stdout-fake-signature` | ✅ 撤销后恢复 |
| C-2 禁载荷尾巴 | 恢复子串测试 | `C-2 CRITICAL`（合成串） | ✅ 撤销后恢复 |
| W-1 All files>0 | 恒不触发判据 | `W-1 WARNING`（合成串） | ✅ 撤销后恢复 |
| W-2 CLI 绑定 | CLI 换成旧 grep 逻辑 | `W-2` 两条用例 + release-ci-gates 对照 | ✅ 撤销后恢复 |
| W-3 status=0 正向检查 | 恢复零检查放行 | `W-3 WARNING`（合成串） | ✅ 撤销后恢复 |
| I-1 第二族阈值 | 恒不触发判据 | `I-1 INFO`（合成串） | ✅ 撤销后恢复 |

- `npx vitest run tests/unit/coverage-gate.test.ts`：42/42 全绿（33 delta 轮 + 9 delta-2
  轮新增：2 份新真实样本主表用例 + 7 条 delta-2 专项 describe 用例，另有 2 条 W-2 用例
  计入 CLI describe 小计，故净增 9 条）。
- `npx vitest run tests/unit/coverage-gate.test.ts tests/unit/release-ci-gates.test.ts`：
  53/53 全绿。
- 每条变异改完立即用 `npx vitest run ... -t "<关键词>"` 单独验证翻红，再用 `cp
  $SCRATCHPAD/*.golden scripts/...` 逐字节还原（非手工反向编辑，避免"改回去但漏了一行"），
  重跑全量确认零残留；`git diff` 最终复核 `scripts/lib/coverage-gate-core.mjs` 与
  `scripts/coverage-gate.mjs` 均不含 `MUTATION-*` 标记（已用 `grep -rn "MUTATION"
  scripts/lib/coverage-gate-core.mjs scripts/coverage-gate.mjs` 复核零命中）。

## delta-3 轮（第四轮代码质量审查返工，专攻 `checkCoverageTable` 内部一致性）

主编排器亲自实跑复现的 1 处 CRITICAL：`checkCoverageTable` 用无 `g` 标志的 `.match()`
各自独立抓 `Coverage report from` / `% Stmts` / `All files`（全文**第一处**匹配），与
同文件其它检查（`parseSummaryLine`/`checkErrorSignature`/evidence 抽取）统一用
`lastMatch`（全文**最后一处**）的语义相悖，同时开了两个方向的洞：

1. **fail-open**：汇总行之后先打印一份诱饵完整表（100%），真正收尾的坍塌表（0%）在更
   后面 ⇒ 取第一处会锁定诱饵表 ⇒ `All files>0` 兜底被绕过 ⇒ 误判 pass。
2. **镜像误伤**：汇总行之前出现一份格式相似的诱饵表 ⇒ 取第一处会让
   `reportMatch.index < testsLine.index` 判定成立 ⇒ 日志真正收尾的合法表被误判为
   "出现在汇总行之前" ⇒ 误判 red。

**修法**：`reportMatch` 改为 `lastMatch('Coverage report from', '', stripped)`；
`% Stmts` / `All files` 改为只在 `reportMatch` 之后的子串（`afterReport =
stripped.slice(reportMatch.index + reportMatch[0].length)`）里查找**第一处**——不是
再套一层 `lastMatch`，因为 `afterReport` 本身已经被截断到"最后一张表"的起点之后，
子串内的第一处即为该表自己的表头/汇总行，天然不会再漂到别的表（避免"三个独立
`lastMatch` 各自漂到不同表"的新歧义）。顺序判据同步收窄为
`stmtsMatch.index < allFilesLineMatch.index`（两者均为 `afterReport` 内的相对
index，`reportMatch` 已通过 `slice` 结构性地排在两者之前，无需再比较绝对 index 与
相对 index）。

### 新增测试

1. `delta-3 轮代码质量审查返工 > CRITICAL fail-open 方向：早期诱饵完整表（100%）不得
   掩盖日志真正收尾表的坍塌（0%）` — 判红，断言 `reasons` 含 `(c)` 且 `整体坍塌`。
2. `delta-3 轮代码质量审查返工 > 镜像误伤方向：汇总行之前出现的诱饵表不得让日志真正
   收尾的合法表被误判为"出现在汇总行之前"` — 判 pass（镜像方向）。

**命令**：`npx vitest run tests/unit/coverage-gate.test.ts -t "delta-3"`

**变异**：把 `checkCoverageTable` 整体临时还原为审查前的实现（三处独立 `.match()`
取全文第一处、`reportMatch.index < stmtsMatch.index && stmtsMatch.index <
allFilesLineMatch.index` 三方绝对 index 比较），其余代码不动。

**结果（实跑记录，逐条用例名 + 数量）**：`npx vitest run
tests/unit/coverage-gate.test.ts` 从 44/44 全绿变为 **42 passed | 2 failed（共 44）**，
且**只有**这两条新增用例翻转，其余 42 条（含 R6a/R6b/W-1/summary-no-coverage-table
等所有既有 (c) 相关用例）保持不变：

- `CRITICAL fail-open 方向：早期诱饵完整表（100%）不得掩盖日志真正收尾表的坍塌（0%）`：
  `AssertionError: expected 'pass' to be 'red'`（诱饵表 100% 被锁定，坍塌表被漏看）。
- `镜像误伤方向：汇总行之前出现的诱饵表不得让日志真正收尾的合法表被误判为"出现在汇总
  行之前"`：`AssertionError: expected 'red' to be 'pass'`（诱饵表被锁定为"表"，其位置
  在汇总行之前触发误红）。

撤销变异（`cp $SCRATCHPAD/coverage-gate-core.mjs.after-fix
scripts/lib/coverage-gate-core.mjs`，逐字节还原后 `diff` 确认零残差）后重跑：
`npx vitest run tests/unit/coverage-gate.test.ts`：**44/44 全绿**恢复；
`grep -rn "MUTATION" scripts/lib/coverage-gate-core.mjs scripts/coverage-gate.mjs`
复核零命中。

### 汇总（delta-3 轮）

| 判据 | 变异方式 | 翻红/翻绿用例 | 状态 |
|---|---|---|---|
| (c) 三要素统一锚定最后一张表 · fail-open 方向 | 恢复三处独立 `.match()` 第一处匹配 | `CRITICAL fail-open 方向`（合成串） | ✅ 撤销后恢复 |
| (c) 三要素统一锚定最后一张表 · 镜像误伤方向 | 同上 | `镜像误伤方向`（合成串） | ✅ 撤销后恢复 |

**顺带修正**：既有 R6a 用例（"覆盖率表三要素顺序错乱"）原构造把 `All files` 整段放在
`Coverage report from` **之前**，在"先锚最后一处 report 头、再在其后子串找剩余两要素"
的新语义下，这实为"表不完整"（report 头之后压根没有 `All files` 行）而非"顺序错乱"，
导致该用例在应用本轮修复后短暂失败（`(c) 覆盖率表不完整` vs 期望 `顺序错乱`）。已改为
"同一张表内部把 `All files` 提前到 `% Stmts` 之前"的构造，真实复现"同一张表、顺序被
打乱"的场景，撤销/恢复变异后与其余 43 条一并全绿。
