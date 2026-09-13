---
feature: 292-fix-coverage-gate-positive-evidence
kind: implementation-notes
---

# 实现进度快照 — F292 CI coverage 判定器：从负向证据换正向证据

**当前 Phase**：Phase 8 / 共 8（全量门禁与本地/真实 CI 验证）+ **delta 轮 + delta-2 轮 +
delta-3 轮（第四轮代码质量审查返工，专攻 `checkCoverageTable` 内部一致性）均已完成** ——
T001-T018 + delta 轮 R1-R8 + delta-2 轮 C-1/C-2/W-1/W-2/W-3/I-1/I-2 + delta-3 轮 1 项
CRITICAL 全部完成，仅剩 T019（commit）/ T020（push 观察真实 CI）未执行。

**已完成任务 ID**：T001-T018（首轮全部）；delta 轮 R1-R8（返工 1 全部）；delta-2 轮
C-1/C-2/W-1/W-2/W-3/I-1/I-2（返工 2 全部）；delta-3 轮 1 项 CRITICAL（返工 3，见下方
逐条说明）

**下一步**：T019（单次 commit，改动范围严格限定在下方文件清单）——**本次 implement
子代理运行时约束明确禁止任何 git 操作**（不 commit/不 stash/不 add），故 T019/T020 未执行，
留给编排器主线程或后续会话按 CLAUDE.md 分支交付约定完成。commit 时改动文件清单：

- 修改：`scripts/lib/coverage-gate-core.mjs`、`tests/unit/coverage-gate.test.ts`、
  `specs/292-fix-coverage-gate-positive-evidence/fix-report.md`、
  `specs/292-fix-coverage-gate-positive-evidence/verification/mutation-evidence.md`、
  `specs/292-fix-coverage-gate-positive-evidence/implementation-notes.md`（本文件）
- **未改动**（delta-3 轮评估后决定不改，见 fix-report.md「delta-3 轮处置记录」INFO 项）：
  `scripts/coverage-gate.mjs`
- **未改动**（delta-2/delta-3 轮均无需再动）：`.github/workflows/ci.yml`、
  `tests/unit/release-ci-gates.test.ts`、`tests/fixtures/coverage-gate/README.md`
- 新增 fixture（delta-2 轮采集，真实 vitest 3.2.4 实跑，delta-3 轮未新增 fixture——本轮
  用合成串隔离验证，不需要新的真实语料）：
  `tests/fixtures/coverage-gate/gha-stdout-fake-signature.ansi.txt`、
  `tests/fixtures/coverage-gate/gha-onunhandlederror-timeout-real.ansi.txt`

## delta-3 轮返工逐条说明（第四轮代码质量审查，专攻 `checkCoverageTable` 内部一致性）

主编排器亲自实跑复现 1 处 CRITICAL：`checkCoverageTable` 用无 `g` 标志的 `.match()`
各自独立抓 `Coverage report from`/`% Stmts`/`All files`（全文**第一处**匹配），与同文件
其它检查统一用 `lastMatch`（全文**最后一处**）的"锚定日志真正收尾"语义相悖，同时开了
fail-open（诱饵完整表在前、真实坍塌表在后 ⇒ 锁定诱饵表放行）与镜像误伤（诱饵表出现在
汇总行之前 ⇒ 合法收尾表被误判为"表在汇总行之前"）两个方向的洞。

**修法**：`reportMatch` 改用 `lastMatch('Coverage report from', '', stripped)` 锁定
最后一张表的表头；`% Stmts`/`All files` 改为只在 `afterReport =
stripped.slice(reportMatch.index + reportMatch[0].length)` 这段子串里查找，结构性
保证三个锚点落在同一张表上（不是再套一层 `lastMatch`，因为 `afterReport` 已经被截断
到最后一张表的起点之后，子串内的首次出现天然就是该表自己的字段，不会漂到别的表）。
顺序判据同步收窄为 `stmtsMatch.index < allFilesLineMatch.index`（`reportMatch` 已
通过 `slice` 结构性排在两者之前，无需再比较）。

新增 2 条合成串隔离测试（`tests/unit/coverage-gate.test.ts` 新 describe 块
`delta-3 轮代码质量审查返工`）：
1. fail-open 方向：早期诱饵完整表（100%）+ 真实收尾坍塌表（0%）⇒ 判红（撤销修复后
   翻转为 pass）。
2. 镜像方向：诱饵表出现在汇总行之前 + 真实收尾合法表出现在汇总行之后 ⇒ 判 pass
   （撤销修复后翻转为 red）。

**顺带修正**既有 R6a 用例：其原构造把 `All files` 整段放在 `Coverage report from`
之前，在新语义下这实为"表不完整"而非"顺序错乱"，已改为"同一张表内部把 `All files`
提前到 `% Stmts` 之前"，真实复现"同一张表、顺序被打乱"的场景。

变异实证：`cp` 到 scratchpad 留底 → 临时还原为审查前的三处独立 `.match()` 实现 →
`npx vitest run tests/unit/coverage-gate.test.ts` 从 44/44 变为 **42 passed | 2
failed**，且**只有**新增的 2 条用例翻转，其余 42 条不受影响 → `cp` 逐字节还原 →
重跑 44/44 恢复。详见 `verification/mutation-evidence.md`「delta-3 轮」小节。

**INFO 顺带项（已评估，选择不改）**：`scripts/coverage-gate.mjs` 的
`process.exit(result.exitCode)` 与 `scripts/check-model-literals.mjs` 的
`process.exitCode = 1` 风格不同。核实仓内 `scripts/*.mjs` 后发现 `process.exitCode`
才是少数派（仅 6 个文件，集中在可被 import 复用的门禁库），`process.exit()` 是独立
CLI 叶子脚本的主流写法（49 个文件）；`coverage-gate.mjs` 属于后者，与
`check-model-literals.mjs`（设计为可复用库）职责不同，不构成对齐关系，故不改。详见
fix-report.md「delta-3 轮处置记录」。

## delta-2 轮返工逐条说明（第三轮异构对抗，专攻 delta 轮新判据本身）

主编排器亲自在 vitest 3.2.4 源码（`node_modules/vitest/dist/chunks/rpc.-pEldfrD.js` /
`execute.B7h3T_Hc.js` / `coverage.DL5VHqXY.js`）与实跑上坐实 C-1/C-2 两条 CRITICAL，指令
明确要求直接照修、不重新论证要不要修。

- **C-1（CRITICAL）**：`checkErrorSignature` 的标题提取从"全文正则扫描任意一行整行像标题"
  改为"只从 vitest 自己打印的未处理错误分区头（`⎯+ Unhandled Error/Unhandled Rejection/
  Uncaught Exception ⎯+`，注意不是复数横幅 `Unhandled Errors`）之后提取第一条非空行"。
  新增 `UNHANDLED_SECTION_HEADER` 正则与 `extractUnhandledSectionTitles` 函数。真实语料
  `gha-stdout-fake-signature.ansi.txt`（vitest 3.2.4 实跑：测试用 `console.log` 顶格打印
  两行伪造签名，同时真实抛出两条 `Unknown Error: boom-primitive-*`）验证：旧实现（delta
  轮）把伪造行当标题计入、真实错误标题格式不匹配旧正则被漏检，两个巧合叠加误判放行；
  新实现分区锚定后正确判红。
- **C-2（CRITICAL）**：`BIRPC_TITLE_STRICT`（原 `BIRPC_SIGNATURE_FAMILY`）从子串测试改为
  整行严格匹配、禁止任何 payload 尾巴（`^Error: \[vitest-(?:worker|pool|api)\]: Timeout
  calling "[A-Za-z0-9_$]+"$`），自动排除 `onUnhandledError`/`fetch`/`transform`/
  `resolveId` 四个通道（vitest 源码 `onTimeoutError` 回调会给这四个方法名的超时消息追加
  ` with "<payload>"`，其中 `onUnhandledError` 恰是 worker 上报真实未处理错误的 RPC 通道，
  超时意味着一条真实错误的上报未确认送达，不属于"已知假红"）。真实复现
  `gha-onunhandlederror-timeout-real.ansi.txt`（阻塞 reporter 在 `onCollected` 首次回调
  同步空转 61s，逼出真实的 `Timeout calling "onUnhandledError" with "<真实消息>"`，见
  mutation-evidence.md 的"真实复现记录"三次尝试过程）+ 合成串隔离验证双重确认。
- **W-1（WARNING）**：`checkCoverageTable` 新增 "All files" 首项百分比 > 0 兜底（解析
  `/^[ \t]*All files[ \t]*\|[ \t]*([\d.]+)/m`）。合成串隔离验证：其余检查全过、仅
  All files 归零的日志单独触发判红。**残余风险如实登记**：只能检测"整体聚合归零"，
  无法检测"部分文件覆盖率丢失但聚合仍达标"。
- **W-2（WARNING）**：新增两条测试——(1) 源码断言 `scripts/coverage-gate.mjs` 必须
  `import` 且调用 `judgeCoverageLog`；(2) 遍历全部 14 份真实 fixture，CLI 子进程 exitCode
  必须与直调 `judgeCoverageLog` 逐份相等。变异验证：把 CLI 换成"不 import core、内部写回
  旧负向 grep 逻辑"的变体，两条新测试均失败，而**既有** release-ci-gates 的两条 core 子串
  断言与 CLI 既有 5 条用例全绿——证实这两条新测试是此前唯一缺失的绑定断言。
- **W-3（WARNING）**：`status===0` 分支不再零正向证据直接放行，改为也要求 (a)(c) 通过
  （不要求 (b)，因为没有非零退出需要解释）。合成串隔离验证：`status=0` + 零 passed 计数
  + 完整表格的日志，旧逻辑放行、新逻辑判红。**已知取舍如实登记**：全量 skip（零 passed）
  的跑批在 `status=0` 下现在也会被判红。
- **I-1（INFO）**：负向检查新增第二条负阈值形态 `^[ \t]*ERROR: Uncovered .*exceed
  .*threshold[ \t]*\(.*\).*$`（vitest 源码已核实：`thresholds.<key> < 0` 时产出
  `ERROR: Uncovered ${key} (${uncovered}) exceed ... threshold (${absoluteThreshold})`
  文案）。**如实登记**：本仓当前阈值均为正百分比，该形态在现行配置下不可达，属提前覆盖。
- **I-2（INFO）**：`scripts/coverage-gate.mjs` 打印标签从 `signatureCount(onTaskUpdate)=`
  改为 `birpcTimeoutTitles=`（已与 C-1/C-2 后的口径对齐，不再暗示钉死单一方法名）。

**变异实证方法论**：对核心逻辑逐条改动前先 `cp` 到 scratchpad 留底
（`coverage-gate-core.mjs.golden` / `coverage-gate.mjs.golden`），改动后用
`npx vitest run tests/unit/coverage-gate.test.ts -t "<关键词>"` 单独验证目标用例翻红，
再 `cp` 逐字节还原、重跑全量确认恢复。六条判据（C-1/C-2/W-1/W-2/W-3/I-1）逐一验证，
详细命令与输出记录在 `verification/mutation-evidence.md` 的"delta-2 轮"小节。

## delta 轮返工逐条说明（R1-R8，第二轮对抗审查返工，历史记录不变）

按主编排器两路独立异构对抗审查（角 A fail-open 视角 / 角 B 误伤面视角）的返工指令逐条处置：

- **R1（CRITICAL）**：`release-ci-gates.test.ts` 的 coverage 步守护断言从 `toContain` 链改为
  `toEqual` 精确钉 6 行序列 + 步骤级 `if` 不存在性断言 + SWALLOW 检查。本机实测 4 种变异体
  （gate_status 后插 0 / 追加第二次判定调用 `|| true` / status 后插 0 / 步骤级加 `if: false`）
  在旧断言下全部漏放，新断言下全部正确判红；撤销变异后全绿恢复（见 mutation-evidence.md）。
- **R2（CRITICAL）**：`checkErrorSignature` 从"全文子串计数 birpc 签名字面量"改为"逐条核对
  未处理错误标题行数与 Errors 汇总计数相等、且每条标题都落在 birpc 家族签名内"，并新增
  `stripGithubWorkflowCommands` 剔除 `::error` 等工作流命令行（防止注解复制污染判定）。
  真实语料 `gha-birpc-and-real-crash.ansi.txt`（1 条 birpc 签名错误 + 1 条真崩溃，注解复制
  签名后子串命中数恰好等于 Errors 计数）验证：旧实现误判放行，新实现正确判红。
- **R3（WARNING）**：birpc 签名从字面量 `Timeout calling "onTaskUpdate"` 改为家族正则
  `\[vitest-(?:worker|pool|api)\]: Timeout calling "[A-Za-z0-9_$]+"`，容忍不同 RPC 通道/
  方法名（真实语料证实超时方法名随阻塞点变化，如 `snapshotSaved`）。同步改
  `release-ci-gates.test.ts` 里"core 必须含签名字面量"断言为钉家族正则的判别性片段。
  **delta-2 轮已进一步收窄**（见上方 C-2）：整行严格匹配、禁止 payload 尾巴。
- **R4（WARNING）**：两条负向检查从无锚 `\s` 跨行匹配改为行锚 `^[ \t]*...$/m`，`\s`
  收窄为 `[ \t]`。合成串验证：跨行拼接的 "Tests\n3 failed to parse" 与非锚定的
  "coverage for X does not meet spec"（子进程 stderr 泄漏噪声）不再误触发负向检查。
- **R5（WARNING）**：汇总类别段抽取从硬编码 `(passed|failed|skipped|todo)` 改为通用词法
  `(\d+)[ \t]+([A-Za-z]+)` + 白名单判定，未知类别（含 `errored`、`flaky`）一律判红——
  刻意不将 `flaky` 纳入白名单（至少失败过一次，属"结果不确定"而非"确凿通过"）。
- **R6（WARNING）**：覆盖率表完整性检查新增顺序约束（三要素必须依次为 `Coverage report
  from` → `% Stmts` → `All files`）与位置约束（必须出现在汇总行之后）。合成串分别验证
  顺序错乱与位置错乱两种变异均判红，正常顺序/位置仍放行。**delta-2 轮新增** All files
  首项百分比 > 0 兜底（见上方 W-1）。
- **R7（INFO，登记为改进而非回归修复）**：ANSI 剥离正则扩展为覆盖非 SGR 的 CSI 序列与
  OSC-8 超链接序列；换行符归一化为统一处理 CRLF 与裸 `\r`。经消融实验确认：CRLF 场景
  因 JS 正则 `^`/`$`/m 本身把 `\r` 当作独立行终止符处理而"意外"已经安全（不算本次修复的
  必要条件，如实记录，不夸大风险），但**裸 `\r`（无 `\n`）场景**与 **OSC-8 序列包裹分隔线**
  两种场景在旧实现下确实会被误判为红（`split('\n')` 无法正确分行 / 窄 ANSI 正则留下控制
  字符污染行首匹配）——均已消融实验验证是真实的、可复现的行为差异。
- **R8**：本文件与 `mutation-evidence.md`、`tests/fixtures/coverage-gate/README.md` 均已
  按要求回填/更正（delta 轮 + delta-2 轮均已回填）。

**已知偏差**：

1. **Phase 7 异构对抗审查发现并修复 1 CRITICAL + 1 WARNING**（首轮遗留记录，delta/delta-2
   轮均未变）：
   - CRITICAL：`parseSummaryLine`/evidence 展示正则早期实现用无 `g` 标志的 `.exec()`，
     只取日志中第一处匹配而非真正的收尾汇总行，可被诱饵行劫持把已知红判定翻成 pass。
     已修复（新增 `lastMatch` helper，取全文最后一处匹配）并补充回归测试。
   - WARNING：CLI 薄壳 `Number.isInteger(Number(statusArg))` 对空字符串误判为合法整数 0。
     已修复（改用严格整数字符串正则）并补充回归测试。
   - WARNING（未处置，登记为残余风险，delta/delta-2 轮均未处理，超出返工范围）：(a)(b)(c)
     三项正向检查互相独立、无交叉勾稽，理论上可拼出"500 passed 但覆盖率表只有 1 个 0% 文件"
     这类自相矛盾但仍判 pass 的日志。判定为任何纯日志文本判定器的固有信任边界，加交叉
     校验属于提高攻击成本而非消除风险，留待用户后续拍板（fix-report.md R-4）。

2. **T012 记录已修正**（delta 轮历史记录，delta-2 轮未变）：mutation-evidence.md 原记载
   "checkSummaryCounts 短路后翻转 3 条、总数 19"，是 Phase 7 新增 2 条回归测试**之前**的
   数字。已重跑同一变异实测翻转 4 条，总用例数更正为 21（delta 轮当时数字，delta-2 轮后
   已增至 42，见下方"当前用例总数"）。

3. **`stripGithubWorkflowCommands` 与"逐条核对标题行"两项修复存在部分重叠、非各自独立
   必要**（delta 轮历史记录，delta-2 轮的分区锚定进一步强化了这层独立性——分区头本身
   不可能出现在 `::error` 注解行内，双重覆盖关系依然成立且更稳固）。

4. **R7 的 CRLF 子场景不构成本次要修复的回归**（delta 轮记录，未变）。

5. **无 `[E2E_DEFERRED]` 标记**：本轮（delta-2/delta-3）验证方式为单元测试 + 合成串隔离 +
   真实语料复现，均可在当前环境完整执行，无需标注 deferred。T020（真实 CI push 观察）
   仍待后续会话执行，标注为待办而非 deferred（不是无法验证，只是本次运行禁止 git push）。

6. **未改动 `specs/src.spec.md` 等再生产物**：`git status --porcelain` 确认本轮改动范围
   严格限定在上方文件清单，未触及任何再生产物、未改动 `.github/workflows/ci.yml`（delta/
   delta-2/delta-3 三轮修复全部落在判定器核心与测试断言层，YAML 步骤本身在首轮已经是
   "跑批落日志 → 交判定器 → 用判定器 exit code 收尾"的最小形态，无需再改）。

7. **当前用例总数**：`tests/unit/coverage-gate.test.ts` 共 44 个测试用例（在 delta-2 轮
   42 条基础上，delta-3 轮新增 2 条合成串隔离用例：fail-open 方向 + 镜像误伤方向；R6a
   既有用例的构造做了顺带修正，用例总数未变）。全量 `npx vitest run
   tests/unit/coverage-gate.test.ts`：**44/44 全绿**。联跑
   `tests/unit/coverage-gate.test.ts tests/unit/release-ci-gates.test.ts`：**55/55 全绿**。

8. **delta-3 轮变异验证零残留**：撤销/恢复变异后 `grep -rn "MUTATION"
   scripts/lib/coverage-gate-core.mjs scripts/coverage-gate.mjs` 复核零命中；`diff`
   核对 `scripts/lib/coverage-gate-core.mjs` 与 delta-2 轮结尾版本逐字节还原成功
   （仅新增的注释与 `checkCoverageTable` 函数体的结构性重写保留）。

## 三项门禁最终验证结果（本轮亲自实跑，原始数字，delta-3 轮）

- `npx vitest run tests/unit/coverage-gate.test.ts tests/unit/release-ci-gates.test.ts`：
  **2 个测试文件通过，55 个测试通过，零失败**。
- 14 份 fixture 逐份 CLI 实跑（`node scripts/coverage-gate.mjs <fixture> <status>`）：
  **判定与 delta-2 轮完全一致，无一份翻转**（逐份 verdict/exitCode 见下表）。

| fixture | status | verdict | exitCode |
|---|---|---|---|
| clean-pass.ansi.txt | 0 | pass | 0 |
| birpc-timeout-pass.ansi.txt | 1 | pass | 0 |
| birpc-timeout-empty-counts.ansi.txt | 1 | red | 1 |
| unhandled-other.ansi.txt | 1 | red | 1 |
| tests-failed.ansi.txt | 1 | red | 1 |
| threshold-miss.ansi.txt | 1 | red | 1 |
| truncated-before-summary.ansi.txt | 1 | red | 1 |
| summary-no-coverage-table.ansi.txt | 1 | red | 1 |
| ci-run-34710678418-birpc-pass.ansi.txt | 1 | pass | 0 |
| gha-unhandled-other.ansi.txt | 1 | red | 1 |
| gha-birpc-and-real-crash.ansi.txt | 1 | red | 1 |
| gha-birpc-empty-counts.ansi.txt | 1 | red | 1 |
| gha-stdout-fake-signature.ansi.txt | 1 | red | 1 |
| gha-onunhandlederror-timeout-real.ansi.txt | 1 | red | 1 |

- `npx vitest run`（全量）：**557 个测试文件通过 | 4 个跳过（共 561），8293 个测试通过 |
  15 个跳过 | 12 个 todo（共 8320），零失败**，耗时 64.09s。
- `npm run build`：**退出码 0**，`tsc` 零类型错误，`postbuild:stamp` 正常盖章
  （`commit=d0b0484d (dirty)`）。
- `npm run repo:check`：**退出码 0**，全部门禁 `pass`，唯一 `warn` 是既有的图产物
  staleness 警告（`source-commit` 与当前 HEAD 不一致，需要重跑
  `spectra batch --mode graph-only` 重建图；与本次改动无关，且 warn 不阻断门禁）。
