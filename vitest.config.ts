import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'path';

// F235：显式约束测试并行度。
//
// 为什么需要：vitest 3 默认 pool='forks'，worker 数由 createForksPool 按
// `max(availableParallelism() - 1, 1)` 推导。这个推导只看 CPU 核数，不知道本仓库
// 487 个测试文件里有 ~49 个会 spawn 真实 node CLI 子进程——实际并发进程数是
// `1 主进程 + N worker + 若干孙进程`，实测在 4 vCPU 上峰值达 12 个 node 进程。
// worker↔主进程之间的 birpc 调用（onTaskUpdate 等）有 60s 硬超时，且该超时
// **vitest 未开放配置**（node_modules/vitest/dist/chunks/index.*.js 的
// DEFAULT_TIMEOUT = 6e4，worker 侧 createForksRpcOptions 不传 timeout），
// 超时会抛 unhandled error 让进程退出码为 1——即使全部测试都通过。
// 降低并发是唯一能在配置层收口的手段。
//
// 为什么是「一半」：每个 worker 平均要为自己 spawn 的孙进程和共享的主进程
// （承担所有 worker 的 Vite transform RPC，单线程）让出算力，按 1:1 预留即取半。
// 4 vCPU 的 CI → 2 个 worker（原 3 个），18 核开发机 → 9 个（原 17 个）。
//
// 为什么设上限 12：主进程是单线程瓶颈，worker 超过一定数量后只是加剧对它的争抢，
// 换不来吞吐。上限同时限制内存占用（每个 fork 是独立 node 进程）。
//
// 依赖前提：availableParallelism() 返回的是**进程实际可用**的 CPU 数
//（受 cgroup cpuset / CPU affinity 约束），在 GitHub runner 与容器里均成立；
// 若运行时不支持该 API 则回落到 os.cpus().length。
const availableCpus = os.availableParallelism?.() ?? os.cpus().length;
const maxTestWorkers = Math.max(1, Math.min(12, Math.floor(availableCpus / 2)));

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@graph': path.resolve(__dirname, 'src/graph'),
      '@diff': path.resolve(__dirname, 'src/diff'),
      '@generator': path.resolve(__dirname, 'src/generator'),
      '@batch': path.resolve(__dirname, 'src/batch'),
      '@models': path.resolve(__dirname, 'src/models'),
      '@utils': path.resolve(__dirname, 'src/utils'),
    },
  },
  test: {
    // 全局配置
    globals: false,
    environment: 'node',
    testTimeout: 30_000,

    // F235：maxWorkers / minWorkers 在 vitest 3 里属于 NonProjectOptions，
    // **只能**声明在根级 test.*——写进 projects[] 无效。因此这里不受 F233 记录的
    // 「projects 不继承根级配置」影响（testTimeout 那类才需要逐 project 重复声明）。
    // 优先级：poolOptions.forks.maxForks > maxWorkers > 内置推导；本仓库不设
    // poolOptions，用 maxWorkers 以便对 forks / threads 任一 pool 都生效。
    // 不设 minWorkers：vitest 会取 min(推导值, maxWorkers) == maxWorkers，
    // 与调整前「启动即拉满 worker」的行为一致，只是上限变小。
    maxWorkers: maxTestWorkers,

    // F251：dist/ 构建收拢到 globalSetup（所有 worker fork 之前的单进程阶段串行执行一次），
    // 消除「N 个测试文件各自 beforeAll 无条件 build」与「~14 个 spawn dist CLI 的测试文件」
    // 之间的构建期/消费期竞写窗口。根级声明（而非放进某个 project 条目）：vitest 的
    // `_initializeGlobalSetup` 恒会把 `getRootProject()` 纳入待初始化集合，保证任意调用形态
    // （全量 / --project 过滤 / 单文件）都执行且仅执行一次，不存在按 project 声明时「新增
    // 消费方所在 project 忘了同步声明」的遗漏面（详见 plan.md 决策点 1）。
    globalSetup: './tests/global-setup.ts',

    // 覆盖率报告
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // include: src/ 全量 + scripts/lib 下 4 语言 extractor（Feature 150）
      include: [
        'src/**/*.ts',
        'scripts/lib/ts-call-extractor.mjs',
        'scripts/lib/go-call-extractor.mjs',
        'scripts/lib/java-call-extractor.mjs',
        'scripts/lib/extractor-helpers.mjs',
      ],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      // Feature 150 SC-001 / FR-019：per-file ≥ 95% 阈值，避免全局聚合稀释
      // vitest 3.x schema：thresholds 顶层既可放全局阈值（branches/functions/lines/statements）
      // 也可放 glob key（如 'scripts/lib/ts-call-extractor.mjs'），后者覆盖单文件阈值
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
        // Codex CRITICAL 修订（Phase 4A）：extractor-helpers.mjs 也加 95% 阈值，
        // 避免被 80% 全局聚合稀释。其它 3 个 extractor.mjs 在 T-005/T-009/T-013
        // 实现时 stub 文件已就位（throw not implemented + 单测覆盖 throw）。
        'scripts/lib/extractor-helpers.mjs': {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        'scripts/lib/ts-call-extractor.mjs': {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        'scripts/lib/go-call-extractor.mjs': {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        'scripts/lib/java-call-extractor.mjs': {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        // Feature 171 SC-005：file-nav 两模块 per-file ≥ 95%
        'src/mcp/file-nav-tools.ts': {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        'src/mcp/lib/file-nav-helpers.ts': {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
      },
    },

    // 项目配置：unit / integration / golden-master / self-hosting
    projects: [
      {
        test: {
          name: 'unit',
          // F217：quality-engine 六指标判定函数按 plan.md/tasks.md 约定与源码同目录共置
          // （src/panoramic/graph/quality/*.test.ts），需显式纳入 include 才能被 `npx vitest run`
          // 实际执行——否则 TDD 红/绿验证形同虚设（zero-execution 测试无验证价值）。
          include: ['tests/unit/**/*.test.ts', 'tests/adapters/**/*.test.ts', 'tests/models/**/*.test.ts', 'tests/panoramic/**/*.test.ts', 'tests/extraction/**/*.test.ts', 'tests/batch/**/*.test.ts', 'tests/spec-store/**/*.test.ts', 'tests/cli/**/*.test.ts', 'tests/utils/**/*.test.ts', 'tests/debt-scanner/**/*.test.ts', 'tests/kb/**/*.test.ts', 'src/panoramic/graph/**/*.test.ts', 'src/batch/**/*.test.ts'],
          // F233 链 G：vitest 3 的 projects[] 不继承根级 test.* 配置（实测根级
          // globals=true 也传不进来），未声明即落回内置默认 5000ms。其余四个
          // project 都已显式声明 testTimeout，唯独 unit 漏，导致 spawn 真实 CLI
          // 子进程的用例在满载 CI（4 vCPU 跑 487 文件）上 5.3-7.3s 越界超时。
          // 此处与根级 testTimeout: 30_000 的意图对齐。
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'golden-master',
          include: ['tests/golden-master/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'self-hosting',
          include: ['tests/self-hosting/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      // Feature 144: E2E Fixture 测试基础设施
      // 不调真实 LLM，用 vi.mock('@anthropic-ai/sdk') 完整跑 batch pipeline，断言产物结构
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
