# F292 问题修复报告 — CI coverage job 放行分支的 fail-open 缺口

## 问题描述

`.github/workflows/ci.yml` 的 `Coverage (thresholds enforced)` 步骤（F285b 引入，commit `6b595a04`）在
「`npm run test:coverage` 非零退出 + 日志含 birpc `Timeout calling "onTaskUpdate"` 签名」时打 `::warning` 放行，
warning 文案宣称「全部用例通过且阈值达标」。但两道前置检查都是**负向 grep**（没打印失败行 ⇒ 认为没失败），
脚本从未**正向**确认「打印了通过汇总」与「覆盖率报告确实生成」。2026-09-13 的 release commit `d0b0484d`
（run `34769332914`，job `103755927661`）实际走了这条放行分支。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 为何可能零证据放行？ | 放行判据 = `status≠0` ∧ 签名存在 ∧ 两条负向 grep 不命中；日志被截断时两条负向 grep 天然不命中 |
| Why 2 | 日志为何可能被截断在汇总之前？ | F285 自己的注释写明该超时发生在「coverage 收尾转换阶段主进程阻塞 >60s」——正是汇总与覆盖率表输出所在阶段；实跑确认 birpc 超时会让**任务结果整体丢失**（`Test Files   (1)` / `Tests   (2)`，零 passed 计数） |
| Why 3 | 为何用负向判据而非正向？ | F285b 是首跑假红的**当场处置**，以「把已知噪声排除掉」的减法思路成文，没走「放行必须有正向证据」的加法思路 |
| Why 4 | 为何这条减法判据当时看着够用？ | 首跑 run `34710678418` 人工看过完整日志（549 文件全过、All files 88.13），把**那一次的人工观察**当成了脚本的恒定前提，写进 warning 文案 |
| Why 5 | 为何未被现有机制捕获？ | 守护测试 `tests/unit/release-ci-gates.test.ts` 只钉「命令串 / 三段判定顺序」这些**形状**，从不喂日志样本测**判定行为**；且 `tail -n 40` 窗口看不到汇总行（汇总在覆盖率表之前），人工复核也复核不到 |

**Root Cause**：放行判据由「负向证据（没看到失败行）」构成，而非「正向证据（看到了通过汇总与完整覆盖率报告）」；
在该假红的成因恰好就是「收尾输出阶段阻塞」的前提下，负向判据与失败形态**同向失效**——最该拦的截断场景恰是它最挡不住的。

## 实证（本卡采集，vitest 3.2.4 同版本实跑，`CI=true`）

1. **CI 日志带 ANSI**：run `34769332914` 的 `test` job 原始日志 `Test Files` 行实为
   `\e[2m Test Files \e[22m \e[1m\e[32m551 passed\e[39m…`。⇒ 现有第二道负向 grep `Tests +[0-9]+ failed|Test Files +[0-9]+ failed`
   在 CI 上**结构性匹配不到**彩色失败行（数字与 `failed` 之间夹着转义序列，`Files` 与数字之间也是）。
   这是任务描述未列出的**第二个 fail-open**：真实用例失败 + 一次 birpc 超时 ⇒ 现逻辑放行。
2. **测试失败时 vitest 根本不打印覆盖率表**（`tests-failed.ansi.txt` 实跑确认）。
3. **未处理错误进汇总的 `Errors  N error` 行**，覆盖率表照常打印（`unhandled-other.ansi.txt`）。
   ⇒ 「非 birpc 的真实未处理错误」与「一次 birpc 超时」共存时，现逻辑同样放行——**第三个 fail-open**。
4. **阈值失败行在覆盖率表之后**（`ERROR: Coverage for branches (66.66%) does not meet "src/a.mjs" threshold (99%)`）。
5. **birpc 超时可复现**（主进程 reporter 同步阻塞 61s）：`Errors  1 error` ↔ 1 行签名；且**存在计数被打丢的形态**
   （`Test Files   (1)`），此形态下日志里不存在任何「通过」证据。
6. `npm`（本机 11.9.0）失败时不在日志尾部追加内容；CI 侧实况亦然（`tail -n 40` 末行恰为覆盖率表收尾分隔线）。

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|---|---|---|---|
| `.github/workflows/ci.yml` | L186-198 | 负向 grep 放行 + ANSI 盲区 + 文案 over-claim + `tail -n 40` | 换正向证据判定器（本卡） |

### 类似模式（已评估）
| 文件 | 位置 | 模式 | 评估结果 |
|---|---|---|---|
| `.github/workflows/ci.yml` | L139-145 `Type Check Tests (full, report-only)` | 对日志做 `grep -c 'error TS'` 取数 | **安全**：`tsc --pretty false` 无 ANSI；且该步 `continue-on-error: true`，只报不阻断 |
| 其余 workflow（`baseline-collect.yml` 等） | — | 无「按日志内容决定放行」的判据 | 安全 |
| `tests/integration/graph-quality-cli.test.ts` | 提及 onTaskUpdate | 注释/说明，非判据 | 安全 |

### 同步更新清单
- 守护测试：`tests/unit/release-ci-gates.test.ts`（coverage 步合同随之改）+ 新增判定器行为测试
- 文档：CI 步注释、warning 文案

## 修复策略

### 方案 A（推荐）— 判定逻辑抽成可单测脚本 + 正向证据

> **落点与判据的后续修订（如实登记，勿按本节原文读实现）**：plan 阶段把落点从本节设想的
> `scripts/ci/coverage-gate.mjs` 改为仓内既有惯例 `scripts/lib/coverage-gate-core.mjs`（纯函数）
> + `scripts/coverage-gate.mjs`（CLI 薄壳）；delta 轮对抗审查后 (b) 由「签名子串计数 == Errors 数」
> 重写为「未处理错误标题行**逐条**核对 + 家族签名 + 横幅第三佐证」，并在判定前剔除 GitHub Actions
> 工作流命令行；**delta-2 轮**（第三轮异构对抗，专攻 delta 轮新判据本身）再改：(b) 的标题提取
> 从"整行看起来像标题"改为"只从 vitest 自己打印的分区头之后提取"，家族签名从子串测试收窄为
> "整行严格匹配、禁止 payload 尾巴"；(c) 新增 "All files" 首项百分比 > 0 兜底；`status===0`
> 也要求 (a)(c) 正向证据；负向检查新增负阈值形态。最终判据以 `scripts/lib/coverage-gate-core.mjs`
> 的文件头与本文件末尾附录为准。

新增判定器（纯函数 `judgeCoverageLog({ log, status })` + CLI 薄壳），CI 步退化为
「跑 coverage → 落 log → 交判定器」。判定规则（本节为首版设计，delta 轮修订见上方提示与文末附录）：

- **负向（任何 status 下都查）**：`does not meet` / `ERROR: Coverage for` 命中 ⇒ 红；汇总行含 `failed` ⇒ 红。
- **放行路径（仅 `status≠0` 时才需要）必须同时满足**：
  (a) 汇总块存在且 `Test Files` / `Tests` 两行的计数**全部**落在 `{passed, skipped, todo}` 白名单内、`passed ≥ 1`（计数为空 ⇒ 红）；
  (b) `Errors  N error(s)` 存在且 **N == birpc 签名行数**（保证「所有未处理错误都是该已知假红」，杜绝真实错误搭便车）；
  (c) 覆盖率报告完整：有 `Coverage report from`、有 `% Stmts` 表头、有 `All files` 行，且**全日志最后一个非空行**是该表的收尾分隔线（其后无任何内容 ⇒ 无阈值行、无截断后噪声）。
- 任一缺失 ⇒ 保持原始非零退出（硬红）。`status == 0` 时沿用「vitest 说通过就是通过」，只跑负向检查。
- 判定器把汇总块、`All files` 行、签名计数、判定与理由**显式打印**（人工复核不再依赖 `tail -n 40`），并上传 `coverage.log` 为 artifact。

### 方案 B（备选）— 保留 YAML 内联、只加正向 grep
改动小，但判定逻辑仍无法单测、无法做变异实证，且 ANSI 剥离在 shell 里易写错。**不采纳**。

## Spec 影响
无需更新既有 spec（F285 的 spec 级口径不变：coverage 仍是 advisory 通知门）。CI 合同变化由守护测试承载。

---

## 附：对抗审查后的口径修正与残余风险（编排器亲自实测，delta 轮）

### 被实测**修正**的两条审查结论（登记，避免以讹传讹）

1. 角 A 的 C-1 声称「单条纯 birpc 在真实 CI 上会被 `github-actions` reporter 注解复制成 2 条签名 ⇒ 永久判红」。
   **实测不成立**：真实 birpc 超时错误的栈帧全在 `node_modules`/node internals，`GithubActionsReporter`
   对拿不到源文件位置的错误跳过注解——我用阻塞 reporter 复现的真 birpc 跑批（`GITHUB_ACTIONS=true`）里
   `::error` 计数为 **0**；F285 首跑的**真实 CI 日志**同样零注解、签名恰好 1 条。角 A 的构造用的是
   测试里手抛、消息恰好含签名的**假** birpc（有源文件位置才会被注解）。
   但其暴露的结构性缺陷成立：**全文子串计签名与错误身份无绑定**，等式可被"数量凑巧"满足（我已独立复现
   `verdict=pass` 而日志里躺着一条真崩溃 `boom real crash`），故 (b) 仍按逐条核对重写。
2. 我自己的三次变异构造一度落空（在**未剥色**原文里替换剥色后才存在的字面量、以及把 `status=0`
   注入到了上游 typecheck 步）——变异实证必须先验证「注入点确实落在目标处」再解读结果，否则会把
   "变异没生效"读成"守护有效"。已按此重做，四种 YAML 接线变异（`gate_status=0` / 追加第二次判定调用 /
   `status=0` / 步骤级 `if: false`）在新断言下**逐一实测变红**。

### delta-3 轮（第四轮代码质量审查返工）处置记录

- **CRITICAL（已修）**：`checkCoverageTable` 的三要素判据统一改用 `lastMatch` 且结构性
  锚定同一张表，详见上表 R-9 与 `verification/mutation-evidence.md`「delta-3 轮」。
- **INFO（顺带项，已评估，选择不改）**：`scripts/coverage-gate.mjs` 末尾用
  `process.exit(result.exitCode)`，与姊妹薄壳 `scripts/check-model-literals.mjs` 的
  `process.exitCode = 1` 风格不同。核实后发现 `process.exitCode` 才是仓内的**少数派**
  写法（`scripts/*.mjs` 中仅 6 个文件使用，且集中在可被其它脚本 import 复用的门禁/
  校验库如 `repo-check.mjs`/`validate-release-contracts.mjs`）；`process.exit()` 是
  绝大多数**独立 CLI 叶子脚本**（`node scripts/xxx.mjs` 直接调用、不被 import）的主流
  写法（49 个文件）。`coverage-gate.mjs` 正是这类独立 CLI 叶子脚本，与
  `check-model-literals.mjs`（被设计为可复用库、`validateModelLiteralGate` 可被其它
  脚本 import）职责不同，不构成"应该对齐"的姊妹关系。且改为 `process.exitCode` 需要
  移除末尾的显式 `process.exit()`，对本脚本这种"日志已经全部同步 console.log 完毕、
  无长驻 handle"的场景两种写法退出码语义等价，但保留现状不引入不必要的改动面（本卡
  唯一必修项是 (c) 检查的一致性缺陷，与此项无关），故选择**不改**。

### 残余风险（未消除，不写成"已解决"）

| # | 风险 | 方向 | 说明 |
|---|---|---|---|
| R-1 | ~~覆盖率日志里若混入顶格 `Error: …` 行会误判红~~——**已被 delta-2 轮 C-1 大幅收窄**：标题不再靠"整行看起来像 Error:"这种脆弱启发式判定，改为只从 vitest 自己打印的分区头（`⎯+ Unhandled Error/Rejection/Uncaught Exception ⎯+`）之后提取，分区之外的任意顶格文本（含测试自己 console.log 打印的伪造内容）天然被排除，不再参与判定 | 已大幅收窄 | 真实语料 `gha-stdout-fake-signature.ansi.txt` 复现过旧实现的漏检+误判放行，delta-2 轮改为分区锚定后正确判红；如实登记：此前的 R-1 描述的"误伤"风险实际不成立，真正的风险方向是相反的"漏检"（本轮 C-1 CRITICAL）。**固有边界未消除**：分区头本身仍是纯文本匹配（`^⎯+ (?:Unhandled Error\|Unhandled Rejection\|Uncaught Exception) ⎯+$`），测试代码若在 stdout 精确复刻整条分区头文案（而非仅复刻标题行），理论上仍可伪造出一个"看起来像分区"的假分区——这是任何纯日志文本判定器共有的固有边界，未被本轮或此前任何一轮消除 |
| R-2 | birpc 超时若把任务结果整体打丢（实测形态 `Test Files   (1)`），新判据判红 | 收紧（意图内） | 这正是本卡要堵的洞：旧逻辑会在"日志里没有任何通过证据"时放行。代价是这类跑批从"绿+warning"变成红 |
| R-3 | ~~签名家族放宽到 `[vitest-(worker\|pool\|api)]: Timeout calling "<任意方法名>"`，某些通道超时是否可信待拍板~~——**已被 delta-2 轮 C-2 收窄**：改为整行严格匹配、禁止任何 payload 尾巴，自动排除 `onUnhandledError`/`fetch`/`transform`/`resolveId` 四个携带真实内容的通道（这些通道的超时消息天然带 payload，永远无法匹配不带尾巴的严格正则） | 已收窄 | 真实复现（`gha-onunhandlederror-timeout-real.ansi.txt`）+ 合成串隔离验证双重确认；放行仍需 (a)(b)(c) 三项正向证据全齐 |
| R-4 | (a)(b)(c) 三项之间无交叉勾稽（如"8000 passed"与"覆盖率表只有 1 个文件"自相矛盾仍放行） | 固有边界 | 纯日志文本判定器的信任边界；加交叉校验只提高伪造成本，超出本卡范围，登记待拍板 |
| R-5 | 判据冻结在 vitest 3.2.4 的输出形态 | 误伤（fail-closed） | 上游改文案/分隔符会让判定器倾向报红而非放绿；判定器把"看到了什么/没看到什么"打印出来，加上 `coverage.log` artifact，定位成本被压到一次日志阅读 |
| R-6 | （delta-2 轮新增，W-1）"All files" 首项百分比 > 0 只能兜住"整体聚合归零"这一种坍塌形态 | 固有边界 | 无法检测"部分文件覆盖率丢失、但聚合仍达标"（如漏统计一个大文件、聚合百分比看起来仍正常）；本仓 80% 阈值门槛本可再兜一层，但阈值一旦被架空（如临时调成 0）就没有第二道防线，仍需人工偶尔抽查覆盖率报告本身 |
| R-7 | （delta-2 轮新增，W-3）`status===0` 收紧为也要求 (a)(c) 正向证据 | 收紧（意图内） | 全量 skip（零 passed）的跑批在 `status=0` 下现在也会被判红，这是有意取舍：不允许"vitest 自己说 0 退出码"作为唯一证据，必须至少有汇总计数与覆盖率表两项正向佐证 |
| R-8 | （delta-2 轮新增，I-1）负阈值形态负向检查在本仓当前配置下不可达 | 提前覆盖 | `vitest.config.ts` 覆盖率阈值均为正百分比，`ERROR: Uncovered ... exceed ... threshold ...` 文案不会出现；阈值配置改成负数（`thresholds.<key> < 0`）才会激活该检查，属未雨绸缪而非当前生效防线 |
| R-9 | ~~`checkCoverageTable` 三要素用无 `g` 标志 `.match()` 各自取全文第一处匹配，与全文件其它检查统一用 `lastMatch` 取最后一处的语义不一致~~——**已被 delta-3 轮修复**：三处改用 `lastMatch` 并结构性锚定同一张表（先定位最后一处 `Coverage report from`，再只在其后子串里找 `% Stmts`/`All files`） | 已消除 | 该不一致同时开了两个方向的洞：多份表场景下，早期诱饵完整表可掩盖真实收尾坍塌表（fail-open）；反向地，汇总行之前的诱饵表可让日志真正收尾的合法表被误判为"出现在汇总行之前"（镜像误伤）。两个方向均已用合成串隔离验证 + 变异测试确认（撤销修复后两条新用例精确翻转，其余 42 条不受影响），见 verification/mutation-evidence.md「delta-3 轮」 |
