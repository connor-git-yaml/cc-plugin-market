# 问题修复报告 — F233 CI 残余两链：unit 超时预算失配 + 墙钟 perf 断言

## 问题描述

F232（`457ab2b`）修复 CI 六重失效后，真实 Ubuntu CI（run 30357317974）从 **8 个失败文件降到 3 个**，
链 A/B/C 病征完全归零（`dist-missing` 0 次、`DRIFT_GRAPH_UNAVAILABLE` 0 次、mjs gate 由空转变为真实通过 807 用例），
链 D/E/F 对应的 5 个文件全部转绿。但 CI 整体仍 failure，剩余 3 个失败：

| 文件 | 错误 | 归属 |
|---|---|---|
| `tests/unit/spec-drift-check.test.ts` | `Test timed out in 5000ms`（用例实耗 5322ms） | 链 G |
| `tests/unit/graph-quality-core.test.ts` | `Test timed out in 5000ms`（用例实耗 7285ms） | 链 G |
| `tests/e2e/batch-concurrency.e2e.test.ts` | `expected 11922 to be less than 10367.35` | 链 H |

两条链都**不是** F232 六链的回归，而是 F232 修好前六链后才暴露出来的次生问题。

## 5-Why 根因追溯

### 链 G：unit project 超时预算失配

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 两个 unit 用例为何超时？ | 报 `timed out in 5000ms`，而根级配置写的是 `testTimeout: 30_000`（`vitest.config.ts:20`） |
| Why 2 | 根级 30s 为何没生效？ | vitest 3 的 `projects[]` **不继承**根级 `test` 配置；project 未声明即落回 vitest 内置默认 5000ms |
| Why 3 | 为何只有 unit 受影响？ | `integration`(60s) / `golden-master`(120s) / `self-hosting`(120s) / `e2e`(60s) **四个 project 都显式声明了 testTimeout，唯独 `unit` 块只有 `name` 与 `include`**（L89-96） |
| Why 4 | 为何本地从未暴露？ | 这两个用例都 spawn 真实 CLI 子进程（`repo:check` / drift check）。开发机空载时 1-3s 内完成，5s 预算够用；CI 4 vCPU 跑 487 个文件时涨到 5.3-7.3s，越界 |
| Why 5 | 为何 F232 没修？ | F232 期间已定位该配置缺口并记为"flaky 放大器"，但当时它被链 B/C 的大面积失败掩盖、未成为阻断项，遂未纳入范围 |

**Root Cause（链 G）**：`vitest.config.ts` 的 `unit` project 遗漏 `testTimeout` 声明，
而 vitest 3 的 projects 不继承根级配置，使该 project 实际运行在 5000ms 预算下（根级意图为 30_000）——
一个纯粹的**配置疏漏**，与被测代码无关。

**实证**（本次现场探针，已清理无残留）：往 `tests/unit/` 放一个 `await sleep(8000)` 的用例——
若继承根级 30s 应通过，实际得到 `× ... 5004ms → Test timed out in 5000ms`，确证预算为 5000ms。

### 链 H：墙钟 perf 断言在满载 runner 上不成立

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | `SC-006` 为何失败？ | 断言 `parElapsed < seqElapsed * 0.95`，实测并行 11922ms **反而慢于**顺序 10913ms |
| Why 2 | 并行为何慢于顺序？ | 该断言测的是**真实墙钟**。4 vCPU runner 同时跑 487 个测试文件时，concurrency=3 拿不到额外核心，调度与上下文切换开销反超收益 |
| Why 3 | 为何原 8 失败清单里没有它？ | F232 前 CI 因缺 dist/graph 让大批测试**快速失败**，机器负载低，该断言侥幸通过；六链修好后全量真跑，负载上来才翻面 |
| Why 4 | 该断言的守护目标是什么？ | 「concurrency=3 确实并行执行 LLM 调用」 |
| Why 5 | 这个目标是否已被别处覆盖？ | **是**。同文件 `SC-003`（L207-208）断言 `maxConcurrentCalls ∈ (1, 3]`，这是**结构性**证据：并发若退化为顺序，`maxConcurrentCalls` 必为 1 → SC-003 必红。SC-006 的墙钟检查与之高度重叠，却自带对宿主负载的敏感性 |

**Root Cause（链 H）**：`SC-006` 用**墙钟耗时对比**验证一个已被 `SC-003` 用**结构性计数**充分覆盖的性质；
墙钟量在共享 CI runner 上不是稳定信号，该断言把"机器忙不忙"误报为"并发坏没坏"。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|---|---|---|---|
| `vitest.config.ts` | `unit` project 块（L89-96） | 缺 `testTimeout` | 补 `testTimeout: 30_000`，与根级意图一致 |
| `tests/e2e/batch-concurrency.e2e.test.ts` | `SC-006`（L211-258） | 墙钟 perf 断言 | 改为负载无关判据，或在 CI 下跳过并说明理由（SC-003 保留守护力） |

### 类似模式（需评估）

| 对象 | 评估结果 |
|---|---|
| 其余 4 个 project 的 testTimeout | **安全**：`integration`/`golden-master`/`self-hosting`/`e2e` 均已显式声明，不受本缺口影响 |
| `hookTimeout` 等其他根级配置 | **需一并核查**：同一"projects 不继承根级"机制对 `hookTimeout`/`retry` 等字段同样适用，实现时应扫一遍根级还声明了哪些 `test.*` 字段而 `unit` 缺失 |
| 全仓其他墙钟断言 | **已知同族、本次不扩大范围**：项目记忆载有 `community-analysis 5000 节点 perf 测试 wall-clock flaky`、`cli-e2e --version 满载 flaky`。它们与链 H 同源（满载下墙钟/子进程超时不可靠），但本次只修实际阻断 CI 的 SC-006，其余留待专项治理 |

### 同步更新清单

- 调用方：无（配置项与单个测试断言，无生产代码消费者）
- 测试：链 G 修复本身即由"两个原超时用例转绿"验证；链 H 需保留 SC-003 守护力不被削弱
- 文档：无合同文档描述这两处

## 修复策略

### 方案 A（推荐）

- **链 G**：`unit` project 补 `testTimeout: 30_000`。同时核查根级其他 `test.*` 字段（如 `hookTimeout`）是否也存在同类未继承缺口。
- **链 H**：优先把 SC-006 改造为**负载无关**判据（基于 mock 侧可观测的并发时间线而非真实墙钟）；
  若改造成本不成比例，则在 CI 环境跳过该用例并在注释写明「SC-003 的 `maxConcurrentCalls` 结构性断言才是并发退化的真实守护，SC-006 仅作本地体感参考」。
  **硬约束：不得削弱 SC-003。**

### 方案 B（备选）：只放宽 SC-006 阈值（如 0.95 → 1.5）

**不推荐**：阈值放宽到"并行比顺序慢 50% 仍算通过"时，该断言已丧失全部判别力，
等于留一个永远为真的测试假装有守护——比明确跳过更具误导性。

## Spec 影响

无需更新任何 spec：链 G 是配置疏漏、链 H 是测试策略调整，均不改变产品行为与对外合同。
