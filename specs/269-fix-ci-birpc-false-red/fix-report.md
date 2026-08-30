# 问题修复报告 — F269 CI vitest birpc 假红收敛（F235 下一档）

## 问题描述

GitHub Actions run 33307096100（及 master 上 33304003606、33308646065）的 `Test` 步：
vitest 输出 **533 文件 / 7874 tests 全 passed** + `1 error`（`[vitest-worker]: Timeout calling
"onTaskUpdate"`，`node_modules/vitest/dist/chunks/rpc.-pEldfrD.js` onTimeoutError）→
`Process completed with exit code 1`。同 job 内独立的 `Test Plugins (mjs gate)` /
`Repo Check` / `Release Check` 全绿。与 F235（f8df35f，maxWorkers=CPU/2 收敛）同签名——
**零测试失败时 master CI 仍报红**。

## 确定性证据（非 flaky）

F268 合入后（533 文件时代）连续 3 个 run 同签名；527/526 文件时代同一 Test 步不触发：

| run | 位置 | Test Files | tests 累计 | Duration（墙钟） | onTaskUpdate 超时 |
|---|---|---|---|---|---|
| 32743318552（F264, 08-24） | master | 526 passed | 475.41s | 317.61s | **0 次**（当时红点是 mjs gate 3 条恒红，F268 已修） |
| 33289032855（F267） | master | 527 passed | 601.59s | 406.33s | **0 次**（同上） |
| 33304003606（F265） | master | 533 passed | 836.18s | 548.03s | **1 次** |
| 33307096100（F268 分支） | 分支 | 533 passed | 809.13s | 529.72s | **1 次** |
| 33308646065（F268, 修复前基线） | master | 533 passed | — | — | **1 次**；此 run 中 Test 是**唯一**红步 |

负载阈值效应明确：F265/F266/F267/F268 合入使测试面从 527 文件 / 累计 601s 涨到
533 文件 / 累计 809-836s（+35%），假红从偶发转为**逐 run 确定复现**。

**runner 规格修正**：任务描述中的「ubuntu-latest 2 核」不成立。两个 533 run 的
tests 累计 / 墙钟 ≈ 1.53×（809.13/529.72、836.18/548.03）证明实际并发 worker = 2，
即 `maxWorkers = floor(nproc/2) = 2` → **runner 为 4 vCPU**（与 F235 fix-report 实测一致）。
修复中加入 nproc 观测行，把 runner 规格变成日志可查的事实。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 测试全过为何 CI 仍红？ | vitest 捕获 1 个 unhandled error（worker→主进程 `onTaskUpdate` RPC 60s 超时），进程退出码 1；GitHub Actions 据退出码判失败 |
| Why 2 | RPC 为何超时且不可调？ | birpc `DEFAULT_TIMEOUT = 60_000` 硬编码，vitest 3.2.4 与 4.x 均**未暴露配置**（上游 issue #8164 open，无版本修复；见 research/online-research.md） |
| Why 3 | 应答延迟为何越过 60s？ | 4 vCPU 上「主进程 + 2 worker + spawn 孙进程」饱和竞争：collect 阶段累计 112-117s、tests 累计 809-836s。**非单点阻塞**——本 run 最大单测仅 16.1s、最大单文件墙钟 72.4s（`tests/integration/graph-quality-cli.test.ts`，66 tests，含大量 CLI spawn），是饱和窗口内 RPC 应答**排队延迟**累积越界 |
| Why 4 | F235 已修为何复发？ | F235 的 `maxWorkers=CPU/2`（CI=2 worker）当时估计仅剩 ~1.2× 安全余量（F235 implement 报告估计值；F235 verification 明确标注该倍数**未经独立验证、不应作为确凿结论呈现**——本次 533 文件时代 3/3 确定性复现恰好构成其事后实证）；测试面 +35% 后余量耗尽。公式随宿主自适应，但**没有随测试负载自适应** |
| Why 5 | 为何未被现有机制捕获？ | 该失败在基础设施层（进程退出码）而非断言层，无门禁量测「CI 并行度余量」；本地 18 核（9 worker，余量充裕）结构性不可复现——F232「本地全绿≠CI 绿：依赖宿主机属性」家族第 N 例，依赖属性 = CPU 核数与测试负载之比 |

**Root Cause**：CI 4 vCPU 下 vitest fork 并行度（2 worker + 孙进程）相对增长后的测试负载
过订阅，`onTaskUpdate` 应答排队延迟越过 birpc 硬编码且不可配置的 60s 超时 → unhandled
error → 全绿测试仍 exit 1。F235 的 CPU/2 公式在负载 +35% 后余量耗尽。

**Root Cause Chain**：Test 步 exit 1 → unhandled birpc 超时 → 60s 硬编码不可配（上游 open）
→ 4 vCPU 饱和排队 → CPU/2 余量被负载增长吃穿 → 无负载维度门禁 + 本地不可复现。

## Run 1 实证修正（重要——原「饱和排队」单一机制叙事被部分证伪）

验收 run 1（33311237734，commit fa723232）：`[ci-diag] nproc=4 VITEST_MAX_FORKS=1`
证明 runner 为 4 vCPU 且 env 全链路生效（tests 累计 580.09s / 墙钟 756.66s，串行化成立），
**但同签名超时仍出现 1 次**（533 全过 + 1 error）。1 fork 已消除 worker 间争抢 → 「饱和
排队」不能解释残余错误。逐时间戳挖掘该 run 日志：

- **唯一 ≥60s 的零输出静默窗口 = 64.8s**，结束于 `tests/integration/
  graph-quality-cli.test.ts (66 tests)` 完成行（第二名仅 35.6s，不足以触发 60s 超时）；
- 该文件 2-fork 时代 72.4s → 1 fork 64.8s，**基本不随并发度变化 = 固有耗时**；
- git 考古：**F266（3871dc04，本次假红确定化的同一批合入）给该文件 +502 行**，
  是它跨过 60s 阈值的直接推手——「+35% 聚合负载」的真实形态是增长集中在这一个文件。

**修正后的机制模型（两类触发面）**：
1. **多 worker 争抢排队类**——F235 时代的 2 错误主体；`VITEST_MAX_FORKS=1` 收口
   （run 1 实证：其余全部静默窗口 <36s）；
2. **单文件同步 spawn 链类**——66 个测试逐个 `execFileSync`/`spawnSync` 连成近连续
   同步链，worker 事件循环 >60s 无完整 poll 轮次：在途 `onTaskUpdate` 的应答早已抵达
   socket 缓冲区却无法被处理，同步链结束让出事件循环时 **timers 相位先于 poll 相位
   执行** → 60s 定时器必然先触发。**与 worker 数无关**（3→2→1 fork 错误数 2→1→1 的
   完整历史由两类叠加解释：F235 收掉①的大头，②随 F266 增长浮出成为常驻残余）。

**追加修法（T008）**：`graph-quality-cli.test.ts` 的 `runCLI`/`runCLIFull` 转
async/await——每次 spawn 等待期事件循环自由，连续同步阻塞上限从 ~65s 降到 <1s，
文件总时长不再构成威胁（60s 威胁量是「无让点的连续同步段」，不是文件墙钟本身）。
验收计数随新 SHA 重置：run 1 对方案 A 单独形态判 FAIL，A+T008 组合形态重跑连续
≥2 次验收。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `.github/workflows/ci.yml` | Test 步（L45-46） | `npm test` 以默认推导并行度跑 vitest | 注入 `VITEST_MAX_FORKS: 1` + nproc 观测行 |
| `vitest.config.ts` | L48-55 F235 注释块 | 「本仓库不设 poolOptions」表述将过时 | 补一句 CI env 覆盖说明（同步注释，不改行为） |

### 类似模式（需评估）

| 对象 | 评估 |
|------|------|
| `npm run test:plugins`（node --test） | `[安全]` 不走 vitest worker RPC；已核实 4 个含 "vitest" 字样的 mjs 文件（fix-compliance-core / goal-loop-core / check-codex-inventory / codex-runtime-doctor）均为字符串数据或注释，**零 vitest 执行面**，env 无意外传播 |
| 本地开发（18 核 → 9 worker） | `[安全]` env 仅在 CI 步注入，本地行为与速度零变化 |
| `Test Plugins` / `Repo Check` / `Release Check` 步 | `[安全]` 不跑 vitest；基线 run 33308646065 中全绿 |
| 未来测试负载继续增长 | `[残余风险]` 收敛是余量型而非结构型（60s 硬超时仍在）：1 worker 若再被吃穿，下一档是按 project 拆分串行步 / 跟进上游 #8164（已记入本报告「残余风险」节） |

### 同步更新清单
- 调用方：无（CI workflow 与测试运行器配置，无产品代码调用方）
- 测试：无需新增用例——验证对象是「真实 CI 连续 ≥2 次 Test 步全绿 exit 0」，本地无法构造等效环境（Why 5），验证走真实 CI（分支 push 触发，`on: push` 无分支过滤）
- 文档：`vitest.config.ts` F235 注释块补 CI 覆盖说明

## 修复策略

### 方案 A（推荐）：CI 专属 `VITEST_MAX_FORKS=1` env 注入（纯 ci.yml 收口）

Test 步加 `env: VITEST_MAX_FORKS: "1"` + 一行 nproc/env 观测输出，`npm test` 命令本身不动。

**生效链（已三重实证，非纸面推演）**：
1. **bundle 源码**：`coverage.DL5VHqXY.js` L3733-3743 `process.env.VITEST_MAX_FORKS` →
   `resolved.poolOptions.forks.maxForks`；L3076 pool 创建 `poolOptions.maxForks ??
   config.maxWorkers ?? 推导值` —— env 优先级**高于** F235 的 maxWorkers；
2. **Node API A/B**（本机实测）：无 env → `forks:{}`；`VITEST_MAX_FORKS=1` →
   `forks:{maxForks:1}`（`createVitest` resolved config）；
3. **运行时 A/B**（本机实测，进程树采样）：默认 9 个 fork（`node (vitest 1..9)`）→
   env 注入后**恰好 1 个** fork（`node (vitest 1)`）。

**收敛机制**：主进程 RPC 服务对象从 2 worker 减为 1，fork 及其孙进程与主进程的 CPU
争抢减半，4 vCPU 全部让给「主进程 + 1 worker + 其孙进程」，应答延迟远离 60s 阈值；
同时每个 spawn 孙进程跑得更快，单文件墙钟（当前峰值 72.4s）整体下压。

**代价**：Test 步墙钟预计 530s → ~800-1000s（tests 累计 809s 序列化，但争抢减半会部分
回收），job 总时长 ~10.5min → ~15-17min。对一个已连红近一月的 master，绿的 17min
优于红的 10.5min；实际数值由验证 run 实测回填。

**边界**：仅影响 CI；本地 `npx vitest run` 行为不变（F235 公式继续生效）。

### 方案 B（备选，不采纳）：`vitest --shard` 两段

F235 verification 转述的「下一档」建议。本次用数据证伪其机制必要性：shard 不减**瞬时**
争抢（每段仍 2 worker + 孙进程抢 4 vCPU），只减单次调用文件数；而本次失败形态是饱和
排队（无 >60s 单点，最大单测 16.1s），shard 对该机制非因果，且引入双倍 globalSetup/
collect 开销与两段退出码聚合复杂度。F235 当时的转述本身标注「未经实测」。

### 方案 C（排除）：升级 vitest 核对上游修复

在线核对结论（research/online-research.md）：上游 issue **#8164 仍 open**，无任何版本
标注修复；birpc 60s 超时在 vitest 3.2 与 4 中均**不可配置**（仅 testTimeout /
teardownTimeout / browser.connectTimeout 可调，均不影响 RPC 层）；社区 workaround 是改
bundle `DEFAULT_TIMEOUT`（hack，不入库）。major 升级换不来修复，排除。

### 方案 D（否决）：`dangerouslyIgnoreUnhandledErrors` / `continue-on-error`

vitest 3.2.4 仅有全量掩盖开关（无 `onUnhandledError` 精确过滤面，已核实 d.ts）。全量
掩盖会静音真实 unhandled error 通道，与 F235 方案 B 否决理由同族（门禁空转），否决。

## 对抗审查记录（Codex 审查暂停 · 暂停期异构档位）

Codex 配额耗尽期间按 CLAUDE.local.md 档位表执行**内部异构对抗 ×2**（门禁类改动，
不同切入角 + 不同模型；对抗代理只拿 diff 与客观问题陈述，不拿编排器机制分析）：

| 切入角 | 模型 | 判定 | 关键产出 |
|---|---|---|---|
| fail-open 构造面（该红时会不会不红） | opus | PASS-WITH-WARNINGS（0C/5W/4I） | 隔离 harness 复现同签名场景证明 1 fork 下 unhandled error 仍 exit 1（检测器未被触碰）；退出码/收集面/门禁条件全实测无恙；**W-1** 发现 `"0"` 真值埋雷（maxForks=0 静默跑零测试仍绿） |
| 修复失效 / no-op 构造面（env 会不会不生效/不够） | sonnet | PASS-WITH-WARNINGS（0C/2W/4I） | 源码 + 518 文件 × 150s 进程采样双证 env 全链路生效（capped 恒 ≤1 worker vs uncapped 7-9）；五 project 共享单一 Tinypool 无乘数效应；`concurrentTasksPerWorker=1` = 完全串行（比声称更强）；**独立**再次撞出 `"0"` 埋雷 |

处置：**W-1 采纳**（run 块首行加整数 ≥1 护栏，见 ci.yml）；**W-2 采纳**（1.2× 引用
洗白修正，本报告 Why 4 与 ci.yml 注释同步改）；**W-3 采纳**（删「唯一手段」过度
声称）；其余登记入下方残余风险。两角独立命中同一埋雷是异构档位有效性的正面信号。

**Delta 轮（T008 异步化改造，新代码必须再审——F244 先例）**：

| 切入角 | 模型 | 判定 | 关键产出 |
|---|---|---|---|
| 测试被架空构造面 + 新增失败面 | opus | **BLOCK**（2C/2W/4I）→ 修复后收口 | 变异测试 7 体（M1-M3 靶断言 / M4-M6 摘 await 70 处·首位·末位 / M7 中位）**100% 击杀零幸存**——转换本身断言网满力；**C-1** runCLIFull 缺 'error' 监听（EAGAIN/EMFILE 下 close 永不触发 → 60s 挂死 + unhandled error，与本 fix 要消灭的签名同形）；**C-2** tasks.md「tsc 类型网」判据为空网（tsconfig exclude tests/，listFiles 0 命中，70 处类型错误变异体照常运行） |

Delta 轮处置：**C-1 采纳**（'error'+'close' 双监听 + settled 守卫）；**C-2 采纳**——
该不实论据源自编排器派发 prompt（本报告作者之误，如实登记），tasks.md 判据改写为
真实证据链（运行时断言网 + 变异实测）；**W-1 采纳**（helper 注释「始终返回/从不
抛出」两句被实测证伪，改诚实版本 + SIGTERM 前提显式化）；**W-2 登记**（runCLIFull
maxBuffer 从 spawnSync 默认 1MB 变为 spawn 无界——行为变化，方向为改进，当前
fixture 远低于 1MB 不可达）；**I-2 登记**（execFile 不再把子进程 stderr 回显到父
stderr，CLIResult 三字段不受影响，仅 CI 日志噪声减少）。

## 残余风险（诚实登记）

- 方案 A 是**余量型收敛**：60s 硬超时与饱和排队机制仍在，只是把余量从 <1× 拉回到
  预计 ≥3×（1 worker 独占 4 vCPU；该倍数为预测值，待验收 run 实测回填）。测试负载
  若再增长数倍，需下一档：按 project 拆分串行 vitest 步（每步独立退出码）或跟进
  上游 #8164。
- **单文件内部并发孙进程仍存在**（对抗审查具体化实例：`tests/integration/
  atomic-write-concurrent.test.ts` 用 `bash -c 'A & B & wait'` 拉起 2 个并发 node
  孙进程，单文件峰值仍可达 4-5 个 OS 进程）——burst 是孤立且 <1s 的，相对 60s 阈值
  有两个数量级余量，不推翻收敛，但「maxForks=1 ≠ 全程 ≤2 进程」。
- **同步 spawn 链 watch-list（②类触发面的次级候选，run 1 实测静默窗口）**：
  `spec-drift-canonical-ast-e2e` 35.6s / `graph-quality-core` 26.7s /
  `collector-fingerprint-regen-script` 24.7s / `spec-drift-fingerprint` 23.7s——
  1 fork 下均 <60s（余量 ≥1.7×），本次不扩散改动；**任何 Feature 再向这些文件批量
  加 spawnSync 型用例时需警惕跨 60s**（graph-quality-core 在 2-fork 时代已到 51.3s，
  是保留 1 fork 的主要理由之一）。后续若再触发，优先把肇事文件 CLI helper 转 async
  （T008 同法），而非再降并发。
- **验收样本量 N=2 偏弱**：对一个 3/3 确定性复现、根因为边际效应的信号，2 次绿有
  信息量但非终点——合入后利用后续自然 push run 继续观察 5-10 次，一旦复现立即走
  T007 既定路径（回滚 + 按 project 拆步）。
- **串行化的探测能力损失**：跨文件并行干扰（共享 tmpdir 固定路径类竞态）在 1 fork
  下永远不会暴露；F251 已把最大共享面（dist 竞写）改为 globalSetup 单点 + fail-fast，
  该损失可接受但需知情。
- **墙钟型 perf 守卫余量放宽**：graph-builder <10s / graph-bootstrap-status <15s /
  sync-worktree-local-state <40s 等阈值在争抢减半后能容忍更大真实退化，登记备查。
- **`timeout-minutes` 未设**（job 默认 360min）：1 fork 下单文件挂起会阻塞整轮。
  故意不在本次加——在拿到 1 fork 真实墙钟数据前设紧阈值会引入新的假红源（正是本次
  在修的问题类别）；验收 2 run 落数据后可作为 follow-up 收窄。
- **test:plugins 首次真正在 Test 步内执行**：此前 vitest 恒 exit 1 使 `&&` 短路，
  该组合腿从未在 Test 步跑过；修复后它在 Test 步与 `if: always()` 的独立 mjs gate
  步各跑一次（重复执行是既有设计，独立步既往恒绿，风险低）。
- 验证依赖真实 CI（本地结构性不可复现），若连续 2 run 中仍现超时，方案 A 判失败，
  回滚并升级为按 project 拆步方案（已在 plan 中预留）。

## Spec 影响

- 需要更新的 spec：**无**（测试运行器 CI 并行度配置，不改产品行为与对外合同）。
