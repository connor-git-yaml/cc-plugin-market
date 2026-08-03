# 问题修复报告

## 问题描述

tests/unit/graph-quality-core.test.ts:85 在 beforeAll 中 `execFileSync('npm', ['run', 'build'])` 重写共享 `dist/`，而全量 vitest 并行下 10+ 个测试文件会 spawn `node dist/cli/index.js`——spawn 撞上半写状态的 dist 导致子进程输出不可解析，偶发命中 scripts/lib/graph-quality-core.mjs:134-137 的 JSON.parse 失败分支，表现为 tests/unit/graph-quality-core.test.ts:268 `expect(result.warnings).toEqual([])` 偶发红（隔离重跑必绿）。F250 交付期两次全量跑各复现 1 次（不同 run）。

附加放大项：该测试文件在 vitest 进程内用 TS 源计算 collector 指纹（经 `tests/helpers/freshness-stale-scenarios.ts` → `computeCollectorFingerprint`），而 spawn 的 dist CLI 用编译产物计算指纹——「源已改、dist 未重建」窗口内 freshness 用例从 flaky 变必红。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `result.warnings` 为何非空？ | `validateGraphQuality` 走进 `detector-output-parseable` warn 分支（graph-quality-core.mjs:134-147）：spawn 的 dist CLI 输出不是合法 JSON（子进程加载了半写/模块集不一致的 dist 后 crash 或输出残缺） |
| Why 2 | dist CLI 输出为何残缺？ | spawn 发生时 `dist/` 正被另一测试文件的 beforeAll `npm run build`（tsc 逐文件 emit，**非原子**）重写——子进程读到新旧模块混合或半写文件 |
| Why 3 | 为何会有并发 build？ | 全仓共 **5 处** beforeAll 无条件 build（graph-quality-core.test.ts:85、cli-e2e.test.ts:34、cli-e2e.test.ts:139、init-e2e.test.ts:44、graph-quality-cli.test.ts:97），vitest 多 worker（maxWorkers = min(12, CPU/2)）跨 projects 混排调度，任一 builder 与任一 dist 消费者（~14 个 spawn dist CLI 的测试文件）时间重叠即触发；builder 之间也会互相竞写 |
| Why 4 | 为何设计成每文件无条件 build？ | 各测试文件追求自给自足（CI 冷缓存下 dist 缺失、或需保证 dist 含本 Feature 新增子命令——「先红」TDD 语义），设计时把 `npm run build` 当作幂等且对外无副作用的操作，忽略了 dist/ 是**全 suite 共享可变资源**且 tsc emit 无原子性保证 |
| Why 5 | 为何未被现有机制捕获？ | 竞写窗口小（单次 build 10-30s vs 全量 suite 分钟级），偶发红隔离重跑必绿，被历次当作环境抖动记账（memory 中已有多条 flaky 记录同型）；无任何门禁检测「测试执行期 dist 被并发重写」这一状态本身 |

**Root Cause**: `dist/` 同时充当「多个测试文件 beforeAll 的构建目标」与「并行运行中的 10+ 测试文件的运行时依赖」，而构建（tsc 逐文件 emit）非原子、多 worker 调度又无任何互斥——共享可变资源缺乏「构建期与消费期」的时间隔离。

**Root Cause Chain**: warnings 偶发非空 → JSON.parse 失败分支（134-137）→ dist CLI 子进程读到半写 dist → 并发 `npm run build` 重写共享 dist → 5 处 beforeAll 无条件 build + 多 worker 并行 → dist 缺「单点构建、测试期只读」的资源纪律。

**放大项（独立成立）**: 指纹双底座——测试进程用 TS 源、dist CLI 用编译产物各算一次 collector 指纹，两者仅在「dist 与源同步」时相等。beforeAll 的无条件 build 恰是为压住这一错位而存在，故修法**不能是单纯删 build**，必须把「保证 dist 新鲜」这一职责转移到不与测试执行并发的位置。

## 影响范围扫描

### 同源问题（需同步修复：无条件 build 于并行窗口内执行）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| tests/unit/graph-quality-core.test.ts | L83-86 | beforeAll 无条件 `npm run build` | 移除 build，改为 dist 存在性 fail-fast 断言 |
| tests/integration/cli-e2e.test.ts | L32-38 | 同上 | 同上 |
| tests/integration/cli-e2e.test.ts | L139 | 同上（同文件第二个 describe） | 同上 |
| tests/integration/init-e2e.test.ts | L41-47 | 同上 | 同上 |
| tests/integration/graph-quality-cli.test.ts | L95-98 | 同上 | 同上 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| tests/integration/mcp-server-stdio.test.ts | L40 | dist 缺失 → skipIf 跳过（不 build） | 安全——只读判定，但 globalSetup 落地后 skip 分支近乎死代码，保留作防御 |
| ~14 个 spawn dist CLI 的测试文件（cli-coldstart / graph-quality-adversarial / graph-quality-lang-matrix / e2e stdio 等） | — | 只读消费 dist | 安全——竞写消除后即恢复确定性，无需改动 |
| tests/unit/graph-quality-core.test.ts | L284-300 | spawn `repo-check.mjs`（其内部再 spawn dist CLI） | 同根因受益者，无需单独改动 |

### 同步更新清单

- 调用方: vitest.config.ts（新增 `globalSetup` 声明）
- 测试: 上述 5 处 beforeAll 改造本身即测试改动；新增 globalSetup 脚本
- 文档: 无需（属测试基础设施内部纪律）
- 类型定义: 无

## 修复策略

### 方案 A（推荐）：vitest globalSetup 单点构建 + 测试执行期 dist 只读

1. 新增 vitest `globalSetup`（根级，worker 启动前串行执行一次）：检测 dist 新鲜度——`dist/cli/index.js` 缺失，或 `dist/.spectra-build-meta.json` 记录的构建输入已过期（新鲜度判据由 plan 细化，保守偏置：不确定即重建）→ 跑一次 `npm run build`；新鲜则跳过。
2. 移除 5 处 beforeAll 无条件 build，改为轻量 fail-fast 存在性断言（dist 缺失时给出「globalSetup 应已构建，请检查 vitest 配置」的明确报错，防未来绕过 vitest 直跑）。
3. 效果：测试执行期无任何进程写 dist → 竞写窗口归零；globalSetup 的新鲜度重建同时闭合指纹双底座错位窗口（源已改 → 重建 → 两侧指纹一致）。

选 A 的理由：一步到位消除「共享可变资源在消费期被写」这一类问题，而非对单个症状打补丁；单次全量跑还省去 4 次冗余 build（现状 5 处 build 串行叠加浪费墙钟）。

### 方案 B（备选）：真实 CLI 用例集中到专用 project 串行化

把 5 个 builder + 14 个 dist 消费者全部迁入一个 `fileParallelism: false` 的专用 project。缺点：迁移面大（unit/integration 分层被打破）、全量墙钟显著变长、且 builder 与**其他 project** 文件仍并发——除非全部迁入，隔离不完备。不推荐。

### 方案 C（对抗审查建议①的原样形态）：仅把 beforeAll 改为「缺失/过期才构建」

只缩小窗口不消除窗口：冷缓存 CI 上首个命中文件仍会在其他 worker 已开跑后 build。不推荐单独采用（其新鲜度判据被方案 A 的 globalSetup 吸收）。

## Spec 影响

- 需要更新的 spec: 无需更新（纯测试基础设施纪律，不触及产品行为面；F217/F249 的 spec 断言语义不变）

## 验证要求（来自任务约定）

- `npm run build` + `npx vitest run` 全量零失败
- **满载全量 vitest 复跑多轮（≥3 轮）零偶发**（本 bug 的复现形态即全量并行偶发）
- 变异验证：人为制造「测试执行期写 dist」不再可能（5 处 build 调用点全部消失，`grep -rn "run.*build" tests/` 仅剩注释/文案）
