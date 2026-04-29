# Feature 146 技术调研：LLM 并发优化器

**生成时间**: 2026-04-29
**调研模式**: 独立模式（未参考 product-research.md）
**涵盖问题**: Q1 SDK 重试行为 / Q2 并发库选型 / Q3 token 累加 / Q4 错误隔离 / Q5 进度展示 / Q6 测试策略

---

## Q1：Anthropic SDK 内置重试与限速行为（CRITICAL）

### 调研发现

通过直接读取 `node_modules/@anthropic-ai/sdk@0.39.0/src/core.ts` 源码（git tag `sdk-v0.39.0`）确认：

**默认 `maxRetries` = 2**（构造函数 line 230）：
- SDK 客户端默认执行最多 2 次重试（即最多 3 次尝试）
- 通过构造函数参数 `new Anthropic({ maxRetries: N })` 或单次请求级别覆盖

**`shouldRetry()` 覆盖的 HTTP 状态码**（line 757-777）：
```
x-should-retry: true  → 强制重试
x-should-retry: false → 强制不重试
408  → 重试（Request Timeout）
409  → 重试（Conflict）
429  → 重试（Rate Limit）
>= 500 → 重试（含 500、502、503、529）
```

**529（overloaded_error）行为**：
- 529 满足 `>= 500` 条件，SDK v0.39.0 **会自动重试** 529 错误
- Anthropic 服务端在 529 响应中通常附带 `x-should-retry: true` 头，进一步确保重试
- [Issue #791](https://github.com/anthropics/anthropic-sdk-typescript/issues/791) 描述的"529 不重试"问题针对的是早期版本；v0.39.0 已通过 `>= 500` 覆盖

**退避策略**（`retryRequest()` lines 779-807）：
```
初始延迟：0.5 秒
最大延迟：8.0 秒
公式：min(0.5 × 2^n, 8.0) × (1 - random() × 0.25)
即：含 ±25% jitter 的指数退避，上限 8 秒
优先使用 retry-after-ms / Retry-After 响应头
```

**与项目现有重试逻辑的冲突分析**：

`llm-client.ts` 在 SDK **之上**又叠加了独立的重试逻辑（`callLLMviaSdk` 函数，line 304 循环，最多 3 次尝试）：
- SDK 层：自动重试 2 次，退避 0.5s-8s
- 应用层：在 SDK 3 次尝试失败后，再循环 3 次（每次均重新触发 SDK 的 2 次内部重试）
- **理论最差情况**：1 个 LLM 调用可产生 3（应用）× 3（SDK）= 9 次实际 HTTP 请求

**并发场景下的重要影响**：
- SDK 的重试逻辑是**无状态、单请求级别**的，不感知其他并发请求
- 当 N 个并发请求同时触发 429 时，每个请求都会独立执行 2 次 SDK 重试，加上应用层重试，**总请求数可放大 9N 倍**
- 批量并发场景下必须在**应用层**增加全局退避协调（SDK 退避仅对单请求有效）

### 备选方案

**方案 A（现状）**：纯依赖 SDK 内置重试 + 应用层 maxRetries 循环
- 优点：零额外代码
- 缺点：并发场景下重试风暴无法协调，可能触发更多 429

**方案 B（推荐）**：保留 SDK 内置重试 + 应用层 `concurrency` 限制作为速率总闸
- 优点：SDK 处理单请求级退避，应用层 `concurrency` 限制总体流量；双层防护
- 缺点：不感知 Retry-After 头指定的全局等待时间

**方案 C**：禁用 SDK 内置重试（`maxRetries: 0`），全部交由应用层统一管理
- 优点：重试逻辑统一，行为可预测
- 缺点：需要在应用层重新实现退避 + Retry-After 头解析，代码量增加

### 推荐

**方案 B**。理由：SDK 退避已经过生产验证（含 jitter、Retry-After 头解析），不必重新实现。应用层的 `concurrency` 并发上限是最有效的速率保护手段——10 并发比 1 并发产生 10 倍的 429 风险，合理的 `concurrency` 值（建议 3-5）本身就是最佳的速率保护。

### 代码示例

```typescript
// llm-client.ts 中的 SDK 客户端构建（不改动）
const client = new Anthropic({
  apiKey: cfg.apiKey,
  timeout: cfg.timeout,
  // SDK 默认 maxRetries = 2，无需显式设置
  // 并发场景下总体流量由调用方 concurrency 参数控制
});

// batch-orchestrator.ts 中并发调用是速率保护的主要手段
// 推荐 concurrency 默认值从 1 改为 3（待 spec 确认）
const concurrency = options.concurrency ?? 3;
```

### 引用

- Anthropic SDK v0.39.0 源码：`src/core.ts` lines 230, 757-807（通过 git tag `sdk-v0.39.0` 读取）
- [Anthropic Rate Limits 文档](https://docs.anthropic.com/en/api/rate-limits)
- [SDK Issue #791: 529 retry behavior](https://github.com/anthropics/anthropic-sdk-typescript/issues/791)
- 本项目 `src/core/llm-client.ts` lines 296-385（`callLLMviaSdk` 函数）

---

## Q2：Node.js 并发调度库选型（HIGH）

### 调研发现

**现有实现分析**（`batch-orchestrator.ts` lines 920-951）：

项目当前已有手写信号量实现：
```typescript
// 当前实现：手写 pending 数组 + activeCount 计数器
const pending: Promise<void>[] = [];
let activeCount = 0;

for (const moduleName of processingOrder) {
  while (activeCount >= concurrency) {
    if (pending.length === 0) break;
    await Promise.race(pending);
  }
  activeCount++;
  const task = processOneModule(moduleName).finally(() => {
    activeCount--;
    const idx = pending.indexOf(task);
    if (idx >= 0) pending.splice(idx, 1);
  });
  pending.push(task);
}
await Promise.allSettled(pending);
```

**已知问题**（注释 "H2 修复" 可见）：该实现有 `pending.length === 0` 时 `Promise.race([])` 死锁的历史 bug，说明手写实现存在边界情况风险。

**各方案对比**：

| 维度 | 手写 Semaphore（当前） | p-limit | p-queue | Web Streams |
|------|----------------------|---------|---------|-------------|
| 新增依赖 | 无 | 是（~400B gzip） | 是（~2KB gzip） | 无 |
| 代码复杂度 | 中（已有 bug 历史） | 低（3 行） | 中 | 高 |
| 功能丰富度 | 基础 | 基础 | 丰富（优先级/pause/resume） | 流式 |
| 周下载量 | - | ~100M | ~20M | - |
| ESM 支持 | - | 纯 ESM | 纯 ESM | 原生 |
| Mock 友好性 | 一般 | 好 | 好 | 一般 |
| 已有 bug 风险 | 有（已修复） | 极低 | 极低 | 无生产验证 |

**package.json 依赖分析**：项目当前无 `p-limit` 或 `p-queue`，所有并发相关逻辑手写。项目已是纯 ESM（`"type": "module"`），`p-limit` 和 `p-queue` 均为纯 ESM 包，兼容无忧。

### 备选方案

**方案 A（当前）**：保留手写信号量实现，修复边界情况
- 优点：零依赖
- 缺点：已有 bug 历史，维护负担高，代码量多

**方案 B（推荐）**：引入 `p-limit`，替换手写信号量
- 优点：100M 周下载、生产验证充分、API 极简（3 行）、体积极小（~400B gzip）
- 缺点：增加 1 个新依赖

**方案 C**：引入 `p-queue`，支持未来扩展（优先级、pause/resume）
- 优点：功能全面，支持优先级队列（高优先级模块先处理）
- 缺点：体积比 p-limit 大 5 倍，当前不需要优先级功能

### 推荐

**方案 B（p-limit）**。理由：
1. 当前实现已有 bug 历史（`Promise.race([])` 死锁），说明手写信号量难以覆盖所有边界情况
2. 功能需求简单（仅需限制并发数），p-limit 完美匹配
3. 100M 周下载量意味着极高的社区验证
4. `p-queue` 的优先级功能在本场景无需（按拓扑顺序处理，优先级已由拓扑排序决定）
5. 体积极小，对项目 bundle 几乎无影响

### 代码示例

```typescript
import pLimit from 'p-limit';

// batch-orchestrator.ts 步骤 4 重构
const limit = pLimit(concurrency);

const tasks = processingOrder.map((moduleName) =>
  limit(() => processOneModule(moduleName))
);

await Promise.allSettled(tasks);
```

对比现有 30 行手写实现，替换为 4 行，且无 `Promise.race([])` 死锁风险。

**测试中 mock 并发行为**：
```typescript
// vitest 中验证并发上限
import pLimit from 'p-limit';

it('并发上限生效', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;

  const limit = pLimit(3);
  const tasks = Array.from({ length: 10 }, (_, i) =>
    limit(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 10));
      concurrent--;
    })
  );
  await Promise.all(tasks);
  expect(maxConcurrent).toBe(3);
});
```

### 引用

- [p-limit npm 页面](https://www.npmjs.com/package/p-limit)（~100M 周下载）
- [p-limit vs p-queue 对比](https://www.pkgpulse.com/blog/p-limit-vs-p-queue-vs-bottleneck-concurrency-control-2026)
- 本项目 `src/batch/batch-orchestrator.ts` lines 920-951（当前手写实现）

---

## Q3：并发场景下的 token usage 累加正确性（HIGH）

### 调研发现

**JavaScript 单线程模型**：Node.js 运行时是单线程事件循环，Promise/async-await 实现的是**协作式多任务**而非操作系统级并发。

关键事实：
- `await` 是**挂起点**，不是抢占点
- 两个 `await` 之间的同步代码**原子执行**，不会被其他协程打断
- `accumulator += value` 是同步赋值，不存在竞态

**具体分析**：
```typescript
// 场景：多个并发 processOneModule 同时运行
async function processOneModule(moduleName: string): Promise<void> {
  const result = await generateSpec(...); // ← await 点，可能切换到其他协程
  // 以下是同步代码：
  cumulativeInputTokens += result.costMetadata.tokenUsage.input; // 安全
  successful.push(moduleName); // 安全
  costRecords.push({...});    // 安全
}
```

**为什么安全**：
- `await generateSpec()` 返回后，执行权回到本协程
- `cumulativeInputTokens += ...` 执行完毕前，不会让出执行权
- JavaScript 数组的 `push()` 同样是同步操作，不存在数据竞争

**唯一真正的"竞争"场景**：读-修改-写模式中，如果读和写之间存在 `await`：
```typescript
// 危险（但不是本项目的模式）：
const old = cumulativeInputTokens;  // 读
await somethingAsync();              // ← 切换，其他协程可能修改
cumulativeInputTokens = old + value; // 写旧值
```

**本项目的 `+=` 是安全的**，因为它没有中间 `await`。

**AsyncLocalStorage / Mutex 必要性评估**：不需要。这些工具用于：
- AsyncLocalStorage：在异步调用链中传递上下文（类似线程本地存储），与竞态无关
- Mutex：操作系统/多线程场景下的互斥锁，JavaScript 单线程不需要

**需要注意的真实并发问题**：
```typescript
// ⚠️ 这是需要注意的场景（非竞态，而是逻辑隔离）
// cumulativeInputTokens 当前是 processOneModule 的局部变量 → 每模块独立计数
// failed / successful / costRecords 是闭包外的共享数组 → push 顺序不确定但安全
```

并发下 `failed[]` / `successful[]` 的 push 顺序会与顺序执行不同，但数组内容本身不会丢失或损坏。

### 备选方案

**方案 A（推荐）**：直接使用 `+=` 和 `push()`，无需额外同步原语
- 理由：JavaScript 单线程模型保证安全

**方案 B**：引入封装类统一管理 batch 累加状态
- 适合：当共享状态较多且需要类型安全时
- 不适合：当前场景过度设计

**方案 C**：使用 `Promise.allSettled` 收集结果后统一 reduce
- 优点：函数式，避免闭包共享状态
- 缺点：需要重构 processOneModule 返回值类型

### 推荐

**方案 A**。JavaScript 单线程模型已提供足够保证，引入 Mutex/AsyncLocalStorage 反而增加复杂度。代码审查时注意确保没有"读-await-写"模式即可。

### 代码示例

```typescript
// 安全：+=、push 都是同步操作，await 之后执行权回到本协程
async function processOneModule(moduleName: string): Promise<void> {
  try {
    const result = await generateSpec(targetPath, genOptions);
    // ↓ await 返回后同步执行，安全
    if (result.costMetadata?.tokenUsage.input) {
      cumulativeInputTokens += result.costMetadata.tokenUsage.input;
    }
    successful.push(moduleName);
    costRecords.push({ moduleName, cost: result.costMetadata! });
  } catch (error) {
    failed.push({ path: moduleName, error: String(error) });
  }
}
```

### 引用

- [Node.js Event Loop 官方文档](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick)
- [MDN: Concurrency model and Event Loop](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop)
- 本项目 `src/batch/batch-orchestrator.ts` lines 676-680（`cumulativeInputTokens` 累加逻辑）

---

## Q4：错误隔离与失败聚合（MEDIUM）

### 调研发现

**现有 `BatchResult.failed[]` 语义**（`batch-orchestrator.ts` lines 157-201）：
```typescript
export interface BatchResult {
  successful: string[];  // 成功模块名列表
  failed: FailedModule[];// 失败模块详情列表
  skipped: string[];     // 跳过模块列表
  degraded: string[];    // 降级模块列表（低置信度但有产出）
}
```

`FailedModule` 类型包含 `path`、`error`、`failedAt`、`retryCount`、`degradedToAstOnly`、`reason` 字段。

**现有错误处理模式**（`processOneModule` 函数 lines 859-904）：
- try/catch 包裹整个模块处理逻辑
- catch 块更新 `cumulativeInputTokens`、推入 `failed[]`、调用 `reporter.complete('failed')`
- `moduleSuccess = false` → while 循环继续重试
- 单个模块失败**不阻塞其他模块**：因为 `processOneModule` 内部处理了所有异常

**关键观察**：当前并发实现用 `Promise.allSettled(pending)` 等待所有任务（line 950），这意味着即使某个 task 内部 throw 出来（理论上不应该，因为 processOneModule 有 catch），也不会导致其他任务被取消。

**`Promise.allSettled` vs `Promise.all` 分析**：

| 特性 | Promise.allSettled | Promise.all + try/catch |
|------|-------------------|------------------------|
| 单个失败影响 | 完全隔离 | 需要每个 task 自行 catch |
| 结果收集 | 包含所有结果（fulfilled/rejected） | 需额外处理 |
| 适合场景 | 批处理（每个任务独立） | 全部成功才有意义的场景 |

当前实现：`processOneModule` 内部 catch 所有异常，理论上永不 reject。`Promise.allSettled` 是正确选择，提供了额外的安全网。

**并发下失败聚合的额外考虑**：
- 多个模块同时失败时，`failed[]` 的 push 顺序与执行顺序不完全一致（但这不影响正确性）
- `checkedState` 的 `saveCheckpoint` 在每个模块完成后调用，并发时多个模块可能在短时间内竞争写入 checkpoint 文件（潜在风险！）

### 备选方案

**方案 A（当前 + 推荐）**：`processOneModule` 内部 catch，`Promise.allSettled` 等待
- 优点：双重安全网，代码清晰
- 已是正确实现

**方案 B**：每个 task 返回 `Result<T, E>` 类型，统一在外层 reduce
- 优点：函数式，类型安全
- 缺点：需要重构 processOneModule 签名

**方案 C**：`Promise.all` + 每个 task 自行 catch 后 resolve
- 与方案 A 等价，只是更明确

### 推荐

**维持方案 A**。`processOneModule` 的 try/catch + `Promise.allSettled` 组合已经正确。

**需要新增处理的并发问题**：checkpoint 文件并发写入竞争。当多个模块同时完成时，`saveCheckpoint` 会在极短时间内被多次调用。现有实现中 `saveCheckpoint` 是同步 `fs.writeFileSync`（因 JS 单线程，不会真正并发写），但**文件写入顺序不确定**。建议 spec 阶段明确这是否是需要处理的问题（低优先级，因为 checkpoint 最终态正确）。

### 代码示例

```typescript
// 推荐：p-limit + Promise.allSettled 组合
import pLimit from 'p-limit';
const limit = pLimit(concurrency);

const tasks = processingOrder.map((moduleName) =>
  limit(async () => {
    try {
      await processOneModule(moduleName);
    } catch (err) {
      // 安全网：processOneModule 理应内部 catch，此处兜底
      failed.push({
        path: moduleName,
        error: String(err),
        failedAt: new Date().toISOString(),
        retryCount: 0,
        degradedToAstOnly: false,
      });
    }
  })
);

await Promise.allSettled(tasks); // 所有任务完成后继续
```

### 引用

- MDN: [Promise.allSettled()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
- 本项目 `src/batch/batch-orchestrator.ts` lines 859-918（catch 块实现）
- 本项目 `src/models/module-spec.ts`（`FailedModule` 类型定义）

---

## Q5：进度展示在并发下的实现（MEDIUM）

### 调研发现

**现有 `progressMode` 机制**（`src/batch/progress-reporter.ts` 全文）：

`ProgressReporter` 接口：
```typescript
interface ProgressReporter {
  start(modulePath: string): void;     // 开始处理模块
  stage(modulePath: string, progress: StageProgress): void; // 阶段进度
  complete(modulePath: string, status: 'success' | 'failed' | 'skipped' | 'degraded'): void;
  finish(): BatchSummary;
}
```

两种模式：
- **tty 模式**：ANSI 控制码清行重绘，进度条固定底部（`renderProgressBar` 函数）
- **pipe 模式**：纯文本行日志，适合 CI/重定向

**并发下的具体问题**：

1. **交错输出**：顺序执行时，某模块的 `start → stage → complete` 事件是连续的。并发时，多个模块的 `start / stage / complete` 事件交错，TTY 模式的"清行重绘"逻辑假设上一行是当前模块的输出，并发时这个假设失效。

2. **进度计数器安全性**：`completed` 是 `createReporter` 闭包内的局部变量，每次 `complete()` 调用时 `completed++`。由于 JS 单线程，`complete()` 的调用不会并发，`++` 是安全的。

3. **"进行中"状态**：当前 reporter 无法展示"正在处理中"的模块列表（只有 started/completed 事件），并发时用户看不到有多少模块"正在进行"。

**建议的并发友好进度格式**：
```
[完成 5 / 进行中 3 / 排队 12 / 总计 20] =========           25%
  正在处理: src/core/llm-client.ts, src/batch/orchestrator.ts, src/graph/...
```

**是否需要引入 ora/cli-progress**：

- `ora`：仅支持单 spinner，不适合并发多任务展示
- `cli-progress`：支持 multi-bar，可为每个并发任务展示独立进度条，但并发数动态变化时管理复杂
- **结论**：基于现有 `ProgressReporter` 接口扩展更合适，代价小，接口契约稳定

### 备选方案

**方案 A**：不改动 reporter，接受并发下日志交错（最小改动）
- 优点：零实现成本
- 缺点：用户体验差，无法判断哪些模块在处理

**方案 B（推荐）**：扩展 `ProgressReporter` 接口，增加 `activeCount()` 和 `queueCount()` 方法，TTY 模式底部进度行改为展示三维状态
- 优点：复用现有抽象，不引入新依赖
- 缺点：需要 reporter 感知 p-limit 的队列状态（通过注入 `limit.pendingCount` / `limit.activeCount`）

**方案 C**：引入 `cli-progress` MultiBar
- 优点：视觉效果好
- 缺点：引入新依赖，维护成本高，CI pipe 模式下需要禁用

### 推荐

**方案 B**，分两步实施：
1. 第一步（MVP）：在 TTY 模式的进度条中增加 `进行中: N` 计数，仅需把 `p-limit` 的 `activeCount` 传入 reporter
2. 第二步（可选）：增加"正在处理"模块名展示

### 代码示例

```typescript
// progress-reporter.ts 扩展：在 renderProgressBar 中增加 active 参数
function renderProgressBar(
  completed: number,
  total: number,
  active: number = 0,
): string {
  const percent = total > 0 ? completed / total : 0;
  const barWidth = 20;
  const filled = Math.floor(percent * barWidth);
  const bar = '='.repeat(filled).padEnd(barWidth, ' ');
  const queued = total - completed - active;
  return `[${bar}] ${completed}/${total} | 进行中: ${active} | 排队: ${queued}`;
}

// batch-orchestrator.ts 中传入 activeCount
import pLimit from 'p-limit';
const limit = pLimit(concurrency);

// 每次绘制进度条时注入 limit.activeCount
reporter.updateActive(limit.activeCount);
```

### 引用

- 本项目 `src/batch/progress-reporter.ts`（全文分析）
- [p-limit API: activeCount / pendingCount](https://github.com/sindresorhus/p-limit#limitactivecount)

---

## Q6：测试策略（MEDIUM）

### 调研发现

**F144 E2E 测试模式分析**（`tests/e2e/batch-pipeline.e2e.test.ts`）：

核心模式：
1. **`vi.hoisted()` 解决 mock hoisting**：mock factory 中引用的变量必须通过 `vi.hoisted()` 定义，否则因 `vi.mock()` 提升导致求值顺序问题
2. **`vi.mock('@anthropic-ai/sdk')`**：模块级拦截 SDK，返回预定义的 `mockCreate` 函数
3. **`mkdtempSync` 解决并行竞态**：每次测试使用唯一临时目录，避免 `Date.now()` 冲突
4. **`beforeAll` 统一运行 pipeline**：消除各 test case 对 pipeline 执行顺序的隐式依赖
5. **`progressMode: 'silent'`**：注意 E2E 测试中传了 `'silent'` 但当前 `ProgressMode` 类型为 `'tty' | 'pipe'`（这是一个待处理 mismatch）

**并发特定测试需求**：
1. **验证并发上限生效**：让某些 LLM 调用"人为变慢"，断言同时执行的请求数不超过 `concurrency`
2. **验证错误隔离**：某个模块的 LLM 调用失败，其他模块正常完成
3. **验证 token 累加正确性**：并发时 `costRecords` 的总 token 数与顺序执行一致

**如何 mock LLM 调用让某些请求"故意慢"**：
```typescript
// 使用 vi.fn() + mockImplementation 控制延迟
const callDelay = new Map<string, number>();

const mockCreate = vi.fn().mockImplementation(async (params) => {
  // 根据 prompt 内容决定延迟（批处理时 prompt 包含模块路径）
  const delay = callDelay.get('slow') ?? 0;
  await new Promise(r => setTimeout(r, delay));
  return { /* 正常响应 */ };
});

// 在测试中设置：前 3 个调用慢 50ms
let callCount = 0;
mockCreate.mockImplementation(async () => {
  callCount++;
  if (callCount <= 3) await new Promise(r => setTimeout(r, 50));
  return normalResponse;
});
```

**验证并发上限**：通过跟踪 `mockCreate` 同时被调用的次数：
```typescript
let concurrentCalls = 0;
let maxConcurrentCalls = 0;

mockCreate.mockImplementation(async () => {
  concurrentCalls++;
  maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
  await new Promise(r => setTimeout(r, 20)); // 人为延迟
  concurrentCalls--;
  return normalResponse;
});

await runBatch(FIXTURE_DIR, { concurrency: 3, outputDir: TMP_OUTPUT_DIR });
expect(maxConcurrentCalls).toBeLessThanOrEqual(3);
```

**与 F144 测试的集成方式**：
- 应在 F144 的 `batch-pipeline.e2e.test.ts` 文件中**新增**并发测试 describe block
- 复用 `beforeAll` 中的 mock 基础设施
- 或新建 `tests/e2e/batch-concurrency.e2e.test.ts` 文件隔离关注点（推荐后者）

### 备选方案

**方案 A（推荐）**：新建 `tests/e2e/batch-concurrency.e2e.test.ts`，复用 F144 的 mock 模式
- 使用 `vi.useFakeTimers()` + `mockCreate` delay 控制时序
- 独立 fixture 目录（模块数 ≥ `concurrency × 2` 才能真正测到并发）

**方案 B**：单元测试 `processOneModule` 函数
- 优点：隔离性好，速度快
- 缺点：`processOneModule` 是 `runBatch` 内部闭包，无法直接单元测试

**方案 C**：在 F144 existing E2E 文件中增加 describe
- 优点：复用已有 beforeAll
- 缺点：耦合度高，单次测试运行时间增加

### 推荐

**方案 A**：新建独立 E2E 文件，fixture 使用至少 6 个模块（`concurrency=3` 时够两批）。

### 代码示例

```typescript
// tests/e2e/batch-concurrency.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mocks = vi.hoisted(() => {
  let concurrentCalls = 0;
  let maxConcurrentCalls = 0;

  const mockCreate = vi.fn().mockImplementation(async () => {
    concurrentCalls++;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
    // 人为延迟 20ms，确保有重叠时间窗口
    await new Promise<void>((r) => setTimeout(r, 20));
    concurrentCalls--;
    return {
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '## 1. 意图\nmock\n## 2. 业务逻辑\nmock' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
  });

  return { mockCreate, getConcurrencyMetrics: () => ({ maxConcurrentCalls }) };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
}));

describe('并发调度 E2E', () => {
  let TMP_DIR: string;

  beforeAll(async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    TMP_DIR = mkdtempSync(join(tmpdir(), 'spectra-concurrency-'));
    const { bootstrapAdapters } = await import('../../src/adapters/index.js');
    bootstrapAdapters();
  });

  afterAll(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    if (TMP_DIR) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('concurrency=3 时同时执行不超过 3 个 LLM 调用', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    const FIXTURE = new URL('../fixtures/e2e/small-ts-project', import.meta.url).pathname;

    await runBatch(FIXTURE, {
      outputDir: TMP_DIR,
      concurrency: 3,
      enableDebtIntelligence: false,
      generateHtml: false,
      enableAdr: false,
      progressMode: 'pipe',
    });

    const { maxConcurrentCalls } = mocks.getConcurrencyMetrics();
    expect(maxConcurrentCalls).toBeLessThanOrEqual(3);
    expect(maxConcurrentCalls).toBeGreaterThan(1); // 确认并发真的生效了
  });
});
```

### 引用

- 本项目 `tests/e2e/batch-pipeline.e2e.test.ts`（F144 模式参考，全文）
- [Vitest: vi.mock() 文档](https://vitest.dev/api/vi#vi-mock)
- [Vitest: vi.hoisted() 文档](https://vitest.dev/api/vi#vi-hoisted)

---

## 对 spec/plan 阶段的影响

### 影响 spec.md 的发现

1. **Q1 双层重试冲突**：spec 需要明确"SDK 默认 maxRetries=2 已处理单请求重试，应用层 `callLLMviaSdk` 的 3 次循环是否继续保留，或在并发场景下是否需要调整"。若保留，需说明理论最大 HTTP 请求数（9N）是可接受的设计决策。

2. **Q1 529 行为**：spec 可以明确依赖 SDK v0.39.0 的 `>= 500` 覆盖处理 529，无需在应用层单独处理。但须注意 SDK 升级可能改变此行为，建议在 spec 约束条件中记录此依赖。

3. **Q2 p-limit 引入**：spec 需包含"引入 `p-limit` 作为新依赖"的功能需求，并说明替换现有手写信号量实现的范围（`batch-orchestrator.ts` lines 920-951）。

4. **Q4 checkpoint 并发写入**：并发下多个模块同时完成时，`saveCheckpoint` 的写入顺序不确定。spec 需明确是否需要对此做保护（建议：checkpoint 最终状态正确，低优先级，暂不处理，但需记录技术债务）。

5. **Q5 `progressMode: 'silent'`**：E2E 测试中使用了 `'silent'` 模式但当前类型为 `'tty' | 'pipe'`。spec 应包含"新增 `'silent'` 进度模式（抑制所有输出）"的功能需求，或确认这是测试 bug。

### 影响 plan.md 的发现

1. **Q2 迁移策略**：plan 应包含"保留 `concurrency <= 1` 的顺序路径（向后兼容）"，以及"替换 lines 927-951 的手写信号量为 `p-limit`"的具体实施步骤。

2. **Q3 安全确认**：plan 可将"token 累加竞态分析"标记为已澄清（无竞态风险），plan 中不需要特别处理，但代码注释应说明 JS 单线程保证。

3. **Q5 进度展示分阶段**：plan 建议将进度展示改造作为 P2（可选），MVP 阶段接受日志交错。P1 仅做并发上限控制和错误隔离。

4. **Q6 测试文件归属**：plan 需要创建 `tests/e2e/batch-concurrency.e2e.test.ts`（新文件），以及一个包含 ≥6 个模块的 fixture（或扩展现有 `tests/fixtures/e2e/small-ts-project/`）。

5. **Q1 默认 concurrency 值**：plan 应确定推荐默认值。基于 Anthropic rate limit 实践（RPM 一般 50-60）和单次 LLM 调用延迟（Sonnet 约 15-30s），并发 3-5 是合理窗口，超出会显著增加 429 风险。建议 plan 中将 `BatchOptions.concurrency` 默认值从 `1` 改为 `3`，并在文档中说明可配置范围（1-10）。
