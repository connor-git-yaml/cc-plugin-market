# 问题修复报告 — F273 F272 基线两条"满载 flaky"归因收口 + graph-bootstrap 紧 deadline 收敛

## 问题描述

F272（`specs/272-test-guard-asset-cleanup/verification/baseline-before.md`）在 commit
`f7a65aa9`、工作区零改动的满载基线跑批（2026-08-31 00:23–00:30，Duration 407.91s）中发现
两个测试文件失败、隔离下全绿，且**不在**仓库预存 flaky 清单：

- `tests/unit/graph-bootstrap-status.test.ts`（:910 「父进程快速 exit 0、后台孙进程稍后写图」用例）
- `tests/unit/sync-worktree-local-state.test.ts`（:215 外层 `beforeEach`/setupRepo，失败归属到
  恰好排队的纯正则用例 `pattern '\bcredential'`）

本卡任务：复现归因 → 能修则修 → 修不动则登记触发条件。

## 归因结论（两条失败是**两种不同机制**，且都不是"满载 flaky"四个字能概括的）

### 机制 A（决定性）：宿主合盖睡眠冻结 → 墙钟窗口假红——两条基线失败的直接成因

`pmset -g log` 时间线与基线跑批窗口逐分钟对齐：

```
00:19:22 Display off → 00:19:52 Entering Sleep ('Clamshell Sleep')   ← 合盖
00:19:55 / 00:21:03 / 00:21:57 / 00:22:51 / 00:23:59  DarkWake（每次 ~45s）与 Maintenance Sleep 交替
00:24:45 前后 → 00:30:00  连续深睡 ~5 分钟（无任何 DarkWake）
00:30:00 之后恢复周期性 DarkWake
```

基线跑批（00:23–00:30、407.91s）**正好横跨 00:24:45→00:30:00 的 ~5 分钟冻结段**。睡眠期间
用户态进程整体冻结、墙钟照走，恢复后所有已过期的墙钟窗口一起爆：

- vitest 默认 `hookTimeout` 10s（root 与各 project 均未显式声明，F233 只跟随了 `testTimeout`）
  → sync 测试外层 `beforeEach`（setupRepo 的 ~7 次 git 子进程链）被判 hook 超时，失败归属到
  恰好排队的纯进程内正则用例——该用例逻辑上不可能自己失败，这是归因的第一条铁证；
- `attemptLocalGraphBuild` 用例注入的 `deadlineMs: 5000`（:910）被 ~5min 冻结击穿 →
  `sleep 0.6` 后写图的孙进程产物落在 deadline 外 → `ok:false` 断言假红。

Duration 407.91s 本身就是冻结膨胀的产物（同 commit、同机器清醒时全量仅 64.17s；4 路并发
满载也只有 ~290s）。这与 F271 同夜账面记录的「宿主休眠杀长时子代理 + 墙钟假红判定法」同源。

**推论**：`sync-worktree-local-state.test.ts` 在基线里的红**不是**负载 flaky——本卡 25 次清醒
满载观察（下表）零失败、探针实测其 hook git 链满载最坏 414ms（距 10s 上限 24×），予以豁免，
不进预存 flaky 清单，也不做代码改动。

### 机制 B（真缺陷，已修）：graph-bootstrap-status 测试注入的紧 deadline 在纯负载下余量不足

清醒机器上的受控复现（iter3：4 个 scratch worktree 各跑 2 轮全量作负载 + 本 worktree 高频
循环跑两个目标文件），obs8 轮命中 3 个失败，签名全部为同一形态——**stub bash 的 spawn→完成
延迟（实测可达 ~2.5s）超过用例注入的 1000/1500ms deadline**，`runBoundedProcess` 判
`timedOut` 早退：

| 用例 | 注入 deadline | 失败签名 |
|---|---|---|
| 孙进程心跳（:838 附近） | 1000 | 组 KILL 时 stub 子 shell 还没写出第一条心跳 → `existsSync(heartbeat)` false |
| C4 JSON 损坏 | 1500 | `reason: 'timeout'` ≠ 期望 `'graph-unparsable'` |
| C4 缺 sourceCommit | 1500 | `reason: 'timeout'` ≠ 期望 `'graph-not-queryable'` |

该轮 pmset 无任何睡眠事件（14:20 起 FullWake），纯负载归因成立。基线 :910 用例（deadline
5000）是同一家族在机制 A 放大下的形态。

## 复现与证据总账（全部在 commit f7a65aa9 上采集）

| 轮次 | 形态 | 结果 |
|---|---|---|
| run1 | 空载全量 | 全绿，64.17s（基线 407.91s 的 6.4× 差直接指向环境而非代码） |
| iter1 | 3 路并发全量 ×3 观察 | 全绿，~261s |
| iter2 | 4 路并发全量 ×4 观察 | 全绿，~290s |
| iter3 | 4 路×2 轮负载 + 双文件循环 ×10 + 负载侧 8 次全量 | **obs8 命中 3 失败（机制 B 签名）**，其余全绿 |
| 探针 | 负载窗口内 setupRepo 等价 git 链 ×40 | avg 273ms / max 414ms（10s hook 上限的 24× 余量） |

sync 文件合计 25 次满载观察零失败；graph 文件 25 次中 1 次命中（且命中的是 1000/1500ms
紧档用例，非基线的 5000ms 用例）——与「基线红主因是睡眠冻结、纯负载只咬得动最紧的档」自洽。

## 修复（仅测试注入值与注释，零生产代码改动）

`tests/unit/graph-bootstrap-status.test.ts`：

1. **负输出三用例**（graph-missing / graph-unparsable / graph-not-queryable）：`deadlineMs`
   1500 → **6000**（实测最坏延迟 ~2.5s 的 2.4× 余量）。负输出路径会把 deadline 轮询耗满，
   deadline 即用例墙钟成本，6s 是余量与全量跑批成本的折中；
2. **孙进程心跳用例**：1000 → **6000**（grace 500 不变）；
3. **正输出/快退出用例**（exit 0 带图、late-artifact :910、non-zero-exit）：5000 → **15000**
   ——stub 完成即返回，放宽零成本，只抬高误判上界；
4. **`runWithFakeCli`（checkFreshness 系列共享入口）与 argv 数组传参用例**：显式钉
   `deadlineMs: 15_000`（原走默认 5000，argv 用例为复审 WARNING-1 命中的同形态漏收面）；
5. **不改**两个故意走 timeout 路径的用例（SIGTERM-ignore `deadlineMs:1000`、C5 卡死
   `deadlineMs:800`）——慢启动下 `timedOut` 依然先置位，断言在任何延迟下都成立。

所有改动用例最坏墙钟经逐个核算，均在各自 vitest 超时（20000 per-test / 30000 unit project）
内。成本：该文件隔离墙钟 ~26s → ~40s（+14s，全部来自负输出用例耗满更宽的 deadline）。

**不修的部分及理由**：

- `hookTimeout` 不提——sync hook 满载实测 414ms，10s 上限余量 24×；基线的 hook 超时是睡眠
  冻结所致，30s 同样挡不住 ~5min 冻结，加大只会稀释真 hang 的暴露速度；
- 睡眠冻结形态无法用任何有限 deadline 治理，收口方式是**判定规则**（见下）而非代码。

## 满载 flake 判定协议增补（对 F260 三条件协议的第 4 条）

隔离绿 + 零交集 + 不在预存清单，仍不足以判"负载 flaky"——**必须先对照跑批窗口查
`pmset -g log` 的 Sleep/DarkWake 事件**。跑批窗口与睡眠/冻结段重叠时，一切墙钟窗口类失败
（hookTimeout、testTimeout、用例内 deadline、perf 断言）优先按宿主冻结假红归因，勿当回归
挖、勿录入 flaky 清单。夜间/长跑批建议 `caffeinate -i npx vitest run` 直接消除该形态。

## 验证

- 隔离：`npx vitest run tests/unit/graph-bootstrap-status.test.ts` → 69/69 绿（修订两轮各验一次）
- 修后满载（iter4，4 路×2 轮负载 + 双文件循环观察，观察侧为修后代码）：见下方回填
- 提交前门禁：见下方回填

### 验证回填

**iter4 修后满载 A/B**（4 路×2 轮旧代码全量作负载 + 修后代码双文件循环观察，窗口内
pmset 零睡眠事件；本轮叠加了隔离验证跑批，负载重于 iter3）：

- **修后代码（观察侧）：9/9 轮双文件全绿**，另加同窗口 2 次隔离跑全绿；
- **旧代码（负载侧）：6/8 次全量 run 里 `graph-bootstrap-status.test.ts` 红**，10 个失败
  用例全部落在本卡已修的紧 deadline 家族（not-queryable ×4、心跳 ×3、unparsable ×2、
  missing ×1），无一例外——修法覆盖面与失败面精确重合；
- 同窗口 `sync-worktree-local-state.test.ts` 负载侧 8/8 绿（累计 33 次满载观察零失败），
  豁免结论进一步加固；
- **范围外新发现**：`tests/unit/eval-mcp-augmented-prompt.test.ts` 负载侧 2/8 红——tmp 文件名
  用 `Date.now()`，多进程并发同毫秒在共享 /tmp 撞名后被对方 `unlink`。已另开任务卡登记
  （修法：mkdtemp 每用例独立目录），不在本卡顺手改。

**提交前门禁**：全量 `npx vitest run` / `npm run build` / `npm run repo:check` —— 见 commit
前终验（三者零失败后才提交；全量跑批预期仍带 F235/F269 已登记的 birpc unhandled error
假红 exit 1，测试面判绿以 Test Files/Tests 计）。

## 对抗审查（Codex 暂停期档位：独立子代理异构对抗 ×1，测试代码非门禁类）

结论 **CRITICAL 0 / WARNING 2 / INFO 3**，两条 WARNING 均已修：

- W1：argv 传参用例走默认 5000ms deadline，同形态漏收 → 补 `deadlineMs: 15_000`；
- W2：正输出用例注释把睡眠冻结案例引为放宽依据属 over-claim（冻结击穿任何有限 deadline）
  → 注释改写为明确排除该形态并指向 pmset 归因规则；
- INFO-1（余量倍数口径美化）已按"对实测最坏延迟 2.4×"如实改写；INFO-2（负输出用例
  `it.concurrent` 并发化可省 ~12s）留作后续优化候选，不在本卡引入；INFO-3 为预算核算通过。

## 工具使用反馈（dogfooding）

- 本卡为测试基建/环境归因类修复，未走 Spec Driver 编排（诊断驱动、单文件测试常量改动；
  流程产物以本 fix-report 收口）；Spectra MCP 未用——目标是时序归因而非结构化上下文，
  证据源在 vitest 日志与 pmset，图谱帮不上。无工具缺陷反馈。
