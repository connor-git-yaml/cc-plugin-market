# 问题修复报告 — F235 vitest worker RPC 超时（CI 最后一环）

## 问题描述

F232（六链）→ F233（两链）→ F234（一链）之后，真实 CI 的**测试本身已全部通过**，
但 workflow 仍以 exit 1 失败：

```text
Test Files  478 passed | 9 skipped (487)      ← 0 failed
Tests      5755 passed | 36 skipped | 21 todo  ← 0 failed
Errors  2 errors

⎯⎯⎯ Unhandled Error ⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError node_modules/vitest/dist/chunks/rpc.*.js:53:10
 ❯ Timeout._onTimeout node_modules/vitest/dist/chunks/index.*.js:59:62
```

**这不是测试失败，是 vitest 基础设施在满载下的 worker↔主进程 RPC 超时**，
2 个 unhandled error 使 vitest 进程退出码为 1，进而让 CI 判 failure。

## 确定性证据（非 flaky）

两个**不同 commit**、**不同作者**（本会话与并行会话）的 CI run 结果**逐字一致**：

| run | commit | Test Files | Tests | onTaskUpdate 超时 |
|---|---|---|---|---|
| 30599748873 | `af0cc13`（F234） | 478 passed / 0 failed | 5755 passed / 0 failed | **2 次** |
| 30599823004 | `9a22ce9`（并行会话 F231） | 478 passed / 0 failed | 5755 passed / 0 failed | **2 次** |

同样的失败形态、同样的次数 → **可复现的确定性问题**，不是负载抖动导致的偶发。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 测试全过为何 CI 仍红？ | vitest 报 `Errors 2 errors`（unhandled），进程退出码 1；GitHub Actions 据退出码判失败 |
| Why 2 | 这 2 个 error 是什么？ | `[vitest-worker]: Timeout calling "onTaskUpdate"` —— worker 进程向主进程上报测试进度的 RPC 调用超时 |
| Why 3 | RPC 为何超时？ | 主进程/worker 在满载下被 CPU 饿死，无法在 RPC 超时窗口内完成应答。本次 CI 实测：总时长 418s、测试累计 960s（远超墙钟 → 高度并行）、collect 阶段 140s |
| Why 4 | 为何满载到这个程度？ | `vitest.config.ts` **完全没有 pool / maxForks / fileParallelism / poolOptions 配置**，vitest 3 默认 `pool='forks'` 且 worker 数按**宿主 CPU 数**推导。CI runner 仅 **4 vCPU** 却要跑 **487 个测试文件**，其中含多个 spawn 真实 CLI 子进程的重测试——worker 数与实际可用算力严重过订阅 |
| Why 5 | 为何本地从不出现？ | 开发机 **18 核**，同样的默认推导得到充裕的 worker 数，且每个 worker 分到的算力远高于 CI，RPC 应答从不越界。这是 F232 记录的「测试依赖宿主机属性」家族的又一实例——**依赖的是宿主 CPU 核数** |

**Root Cause**：`vitest.config.ts` 未对并行度设限，vitest 按宿主 CPU 数推导 worker 数；
CI runner（4 vCPU）在 487 文件规模下严重过订阅，worker↔主进程的 `onTaskUpdate` RPC
在超时窗口内得不到调度，产生 unhandled error 使进程退出码为 1——**尽管所有测试都通过**。

与 F232 链 D/E/F 同族（依赖宿主机属性），本次依赖的属性是**CPU 核数**；
与 F233/F234 同族（负载敏感），但表现层不是断言失败而是**基础设施 RPC 超时**。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 问题 | 修复方向 |
|---|---|---|
| `vitest.config.ts` | 无任何并行度约束，worker 数完全随宿主 CPU 浮动 | 显式约束并行度，使 CI 与本地都在可控范围内 |

### 类似模式（需评估）

| 对象 | 评估 |
|---|---|
| `npm run test:plugins`（`scripts/run-plugin-tests.mjs`） | **不受影响**：F232 已确认它走 `node --test`，不使用 vitest worker RPC；CI 中该步骤稳定通过（807/919 用例） |
| 本地开发体验 | 需注意：并行度设死会拖慢 18 核开发机的全量跑。修复应**按可用 CPU 自适应**并设上限，而非硬编码一个小常数 |
| 其余 CI 步骤（lint/build/建图/mjs gate） | 本次 CI 均 ✓，不受影响 |

### 同步更新清单
- 调用方：无（纯测试运行器配置）
- 测试：本项修复的验证对象就是"全量 vitest 能否稳定 exit 0"，无需新增用例
- 文档：无合同描述该配置

## 修复策略

### 方案 A（推荐）：显式约束 vitest 并行度，按可用 CPU 自适应并设上限

在 `vitest.config.ts` 顶层 `test` 声明 `poolOptions.forks.maxForks`（及必要的 `minForks`），
取值按 `os.availableParallelism()`（或 `os.cpus().length`）计算并设上限，
使 4 vCPU 的 CI 不会过订阅，同时 18 核开发机仍能享受足够并行。

**关键约束**：
- 必须**实测**修复后 CI 形态下 `onTaskUpdate` 超时归零——本机 18 核无法直接复现，
  须用**限核手段**（如容器 `--cpus=4`、`taskset`/`cpulimit`，或临时把 maxForks 调到能触发的值）
  构造 4 vCPU 等效环境验证，否则又是"本地全绿≠CI 绿"（F232 元教训）
- 不得为压制该错误而**削弱测试覆盖**（如 `--silent`、`fileParallelism: false` 全串行虽可能规避但严重拖慢，
  或用 `--passWithNoTests` 之类掩盖）
- 需评估修复后 CI 总时长变化（并行度下降会拉长），确认在可接受范围

**备选考虑（由实现阶段实测决定）**：若 vitest 3.2.4 暴露 RPC 超时相关配置，
提高该超时亦是一条路；但**降低过订阅是治本**（RPC 超时只是过订阅的症状），
提高超时属治标，且会掩盖未来真实的 worker 挂死。优先方案 A，除非实测证明 A 不可行。

### 方案 B（不推荐）：忽略 unhandled error / 让 CI 容忍非零退出

**不推荐**：`Unhandled Errors` 是 vitest 的真实告警通道（其自身提示
"This might cause false positive tests"），屏蔽它等于关闭一个诊断信号；
且"测试全过但进程异常"本身就该被看见。用 `continue-on-error` 或过滤退出码
会把这个信号永久静音，与 F232 修复"门禁空转"的初衷背道而驰。

## Spec 影响

无需更新任何 spec：测试运行器并行度配置，不改变产品行为与对外合同。
