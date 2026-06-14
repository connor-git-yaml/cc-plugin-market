import { defineConfig } from 'vitest/config';
import path from 'path';

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
          include: ['tests/unit/**/*.test.ts', 'tests/adapters/**/*.test.ts', 'tests/models/**/*.test.ts', 'tests/panoramic/**/*.test.ts', 'tests/extraction/**/*.test.ts', 'tests/batch/**/*.test.ts', 'tests/spec-store/**/*.test.ts', 'tests/cli/**/*.test.ts', 'tests/utils/**/*.test.ts', 'tests/debt-scanner/**/*.test.ts', 'tests/kb/**/*.test.ts'],
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
