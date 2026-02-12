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
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },

    // 项目配置：unit / integration / golden-master / self-hosting
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
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
    ],
  },
});
