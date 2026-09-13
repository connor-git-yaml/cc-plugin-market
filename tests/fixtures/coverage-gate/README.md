# coverage-gate 判定样本（F292）

全部样本都是 **vitest 3.2.4 实跑产物**（与本仓 `vitest`/`@vitest/coverage-v8` 同版本），`CI=true` 采集、**保留 ANSI 转义**——
CI 上 tinyrainbow 因 `"CI" in env` 开色，判定器必须先剥色才能匹配，样本若剥了色就测不到这条失效面。

采集环境：scratch 迷你工程（2 个 passing 用例 + 1 个可控失败/未处理错误用例 + v8 覆盖率 text reporter），
birpc 超时用自定义 reporter 在**主进程**同步空转 61s 逼 worker 的 RPC 调用命中 vitest 硬编码 60s 超时复现。

| 样本 | 形态 | 实跑退出码 | 期望判定 |
|---|---|---|---|
| `clean-pass.ansi.txt` | 全过 + 覆盖率表完整 | 0 | 放行 |
| `birpc-timeout-pass.ansi.txt` | 全过 + `Errors 1 error`（birpc 超时）+ 表完整 | 1 | 放行（已知假红） |
| `birpc-timeout-empty-counts.ansi.txt` | birpc 超时把任务结果打丢：汇总为 `Test Files   (1)` / `Tests   (2)`，**零 passed 计数** | 1 | 硬红（零正向证据） |
| `unhandled-other.ansi.txt` | 非 birpc 的真实未处理错误（`Errors 1 error`）+ 表完整 | 1 | 硬红 |
| `tests-failed.ansi.txt` | 1 用例失败（vitest 失败时**不打印覆盖率表**） | 1 | 硬红 |
| `threshold-miss.ansi.txt` | 表完整 + 表后 `ERROR: Coverage for ... does not meet ...` | 1 | 硬红 |
| `truncated-before-summary.ansi.txt` | 从 birpc 样本在汇总行**之前**截断 | 1 | 硬红 |
| `summary-no-coverage-table.ansi.txt` | 汇总全过但覆盖率表缺失（从 birpc 样本在表头前截断） | 1 | 硬红 |

两处外科加工（内容格式逐字来自实跑，仅做替换/拼接，见 `specs/292-*/fix-report.md` §证据）：
1. `birpc-timeout-*`：实跑超时的 RPC 名是 `snapshotSaved`（阻塞点决定名字），按 CI 实况把字面量替换为 `onTaskUpdate`；
   报错块结构、栈行、`Errors N error` 行均为实跑原样。
2. `birpc-timeout-pass.ansi.txt`：把实跑 birpc 报错块 + `Errors` 行嫁接进 `clean-pass` 实跑日志，
   以得到「计数完整 + 表完整 + 无阈值行 + 有 birpc 签名」这一 CI 声称的放行形态（实跑 birpc 那次覆盖率归零、带阈值行，不能直接当放行样本）。

## delta 轮（对抗审查返工）新增 4 份样本

**采集约定纠正**：上表 8 份样本采集时只设了 `CI=true`，**没有**设 `GITHUB_ACTIONS=true`——这正是两条
CRITICAL 能逃过初版实现的共因：vitest 的 `GithubActionsReporter`（打印 `::error ...` 工作流命令行注解，
把已经在日志正文出现过一次的未处理错误标题+栈原样复制一份）只在检测到 `GITHUB_ACTIONS=true` 时才启用，
本仓 CI 也确实跑在真实 GitHub Actions 上（会产出这类注解）。旧 8 份样本从未见过注解，判定器的
(b) 检查因此从未在"注解把签名复制一份"这个真实场景下被验证过。**往后新增覆盖率判定样本，采集环境
必须同时含 `CI=true` 与 `GITHUB_ACTIONS=true`。**

| 样本 | 形态 | 实跑退出码 | 期望判定 |
|---|---|---|---|
| `ci-run-34710678418-birpc-pass.ansi.txt` | **真实 CI 日志裁剪版**（F285 首跑 run 34710678418）：549 passed/9 skipped、8206 passed/35 skipped/12 todo、`Errors 1 error`、1 条 birpc 签名、表完整、**无** `::error` 注解（栈帧全在 `node_modules`，`GithubActionsReporter` 对无源文件位置的错误跳过生成注解） | 1 | 放行（已知假红，真实 CI 实况） |
| `gha-unhandled-other.ansi.txt` | 真实 GHA 跑批：非 birpc 的未处理错误（`Error: boom unhandled`）+ 1 条 `::error` 注解 | 1 | 硬红 |
| `gha-birpc-and-real-crash.ansi.txt` | 真实 GHA 跑批：1 条 birpc 签名的手抛错误 + 1 条真崩溃 `Error: boom real crash`，两条各自都有 `::error` 注解复制——注解把 birpc 签名复制一份，初版实现（全文子串计数未剔除注解）会让签名命中数(2)恰好等于 Errors 计数(2)而误判放行；delta 轮改为逐条核对未处理错误标题行数与家族签名后**必须红** | 1 | 硬红（CRITICAL 回归主证据，见 `verification/mutation-evidence.md`） |
| `gha-birpc-empty-counts.ansi.txt` | 真实 GHA birpc 超时，任务结果同样被打丢（`Test Files   (1)` / `Tests   (2)`） | 1 | 硬红（(a) 兜底） |

采集环境：前三份与上表同一套 scratch 迷你工程，额外设 `GITHUB_ACTIONS=true` 触发 vitest 内置
`github-actions` reporter 输出 `::error` 注解（由主编排器亲自采集）。

`ci-run-34710678418-birpc-pass.ansi.txt` 的采集口径（与上面三份不同，如实写清）：

```bash
gh run view 34710678418 --job 103598784375 --log      # F285 首跑，coverage 步当时尚未重定向到 coverage.log，
                                                       # 故 vitest 输出连同 ANSI 直接落在 step 日志里
# 取 `Coverage (thresholds enforced)` 步的行 → 去掉 GH 日志的 `job\tstep\ttimestamp ` 前缀
# → 去掉 runner 注入的 ##[group]/##[endgroup]/##[error] 与 Run/shell/env 回显 → 还原成 coverage.log 形状
```

还原出的**完整**日志共 4609 行 / 420 KB，入库版**只裁掉中段 4216 行逐用例进度输出**（`✓ <file> (N tests) Xms`
这类与判定无关的行），保留首行 `npm run test:coverage`、完整 Unhandled Errors 区块、汇总三行与整张覆盖率表。
裁剪位置以 `[…F292 取样裁剪：…]` 显式标注。**完整未裁剪版同样实测判定为 pass**，且其顶格
`Error:`/`Exception:` 标题行恰好 1 条（= `Errors 1 error`），即 delta 轮 (b) 的「标题行数 == Errors 计数」
在真实生产语料上成立——这是入库裁剪版不可能自证的事实，故在此登记。

## delta-2 轮（第三轮对抗审查，专攻 delta 轮新判据本身）新增 2 份样本

第三轮对抗审查专门攻击 delta 轮刚写出的"标题行数 == Errors 计数"判据本身，挖出两处
CRITICAL：(1) 标题提取不锚定 vitest 自己打印的分区头，可被顶格伪造文本掩盖真实错误；
(2) 家族签名允许 payload 尾巴，会放行 `onUnhandledError`/`fetch`/`transform`/`resolveId`
四个通道携带真实内容的超时（这些通道超时意味着"结果不可信"，不是"纯粹调用没收到回应"）。

| 样本 | 形态 | 实跑退出码 | 期望判定 |
|---|---|---|---|
| `gha-stdout-fake-signature.ansi.txt` | 真实 vitest 3.2.4 实跑：测试用 `console.log` 顶格打印两行伪造的 birpc 签名字面量（`Error: [vitest-worker]: Timeout calling "onTaskUpdate"/"snapshotSaved"`），同时用 `Promise.reject('boom-primitive-one'/'-two')` 真实触发两条 `Unhandled Rejection`（标题 `Unknown Error: boom-primitive-*`）。delta 轮实现（全文标题正则、不锚定分区）会把伪造行当成标题计入，数量与家族签名恰好对得上，误判放行；delta-2 轮改为分区锚定后必须判红 | 1 | 硬红（C-1 CRITICAL 主证据） |
| `gha-onunhandlederror-timeout-real.ansi.txt` | 真实 vitest 3.2.4 实跑：`onCollected` 首次回调同步阻塞 61s（早于任何测试执行），顶层 `Promise.reject` 触发的 `catchError`→`rpc.onUnhandledError()` 调用未被 await，超时后其被拒绝的 promise 自身成为新的未处理拒绝，递归触发第二次 `catchError` 调用并成功送达，产出 `Error: [vitest-worker]: Timeout calling "onUnhandledError" with "boom-onUnhandledError-real"`（C-2 目标形态）。因阻塞发生在收集阶段，测试从未真正执行，`(a)`（零 passed）与 `(c)`（无覆盖率表）也同时判红——是"多重原因同时判红"的真实语料，C-2 的单独隔离证明见 `tests/unit/coverage-gate.test.ts` 的合成串用例，本样本仅作为"该消息形态在生产环境确实会出现"的存在性佐证 | 1 | 硬红（多重原因） |

`gha-stdout-fake-signature.ansi.txt` 采集环境：与上方三份 GHA 样本同一套 scratch 迷你
工程（`CI=true GITHUB_ACTIONS=true`），额外新增一个测试用例文件（`tc2/a.test.mjs`）在
`it()` 内用 `console.log` 打印伪造签名字面量，并在模块顶层用 `Promise.reject` 制造两条
真实未处理拒绝。

`gha-onunhandlederror-timeout-real.ansi.txt` 采集口径（真实复现，非外科替换，详见
`specs/292-fix-coverage-gate-positive-evidence/verification/mutation-evidence.md`
delta-2 轮 C-2 章节的"真实复现记录"——含 3 次尝试的完整过程）：

```bash
# scratch 工程：$SCRATCHPAD/vt
# block-reporter-collected.mjs：onCollected 首次回调同步空转 61s
# tc3/a.test.mjs：顶层 Promise.reject('boom-onUnhandledError-real') + 1 个普通 it()
CI=true GITHUB_ACTIONS=true node_modules/.bin/vitest run --config cfg-c5.mjs
```
