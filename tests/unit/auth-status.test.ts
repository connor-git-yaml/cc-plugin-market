/**
 * auth-status 单元测试
 * 验证 auth-status 子命令解析和输出格式
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

// Mock auth-detector
vi.mock('../../src/auth/auth-detector.js', () => ({
  detectAuth: vi.fn(),
  verifyAuth: vi.fn(),
}));

import { detectAuth, verifyAuth } from '../../src/auth/auth-detector.js';
import type { AuthDetectionResult } from '../../src/auth/auth-detector.js';

const mockedDetectAuth = vi.mocked(detectAuth);
const mockedVerifyAuth = vi.mocked(verifyAuth);

describe('auth-status', () => {
  describe('parse-args', () => {
    it('正确解析 auth-status 子命令', () => {
      const result = parseArgs(['auth-status']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command.subcommand).toBe('auth-status');
        expect(result.command.verify).toBeFalsy();
      }
    });

    it('正确解析 auth-status --verify', () => {
      const result = parseArgs(['auth-status', '--verify']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command.subcommand).toBe('auth-status');
        expect(result.command.verify).toBe(true);
      }
    });
  });

  describe('runAuthStatus 输出', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.clearAllMocks();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('两种方式均可用时显示正确输出', async () => {
      const mockResult: AuthDetectionResult = {
        methods: [
          { type: 'api-key', available: true, details: '已设置 (sk-ant-...****)' },
          { type: 'cli-proxy', available: true, details: '已安装 (v2.1.0), 已登录' },
        ],
        preferred: { type: 'api-key', available: true, details: '已设置 (sk-ant-...****)' },
        diagnostics: [
          'ANTHROPIC_API_KEY: 已设置 (sk-ant-....****)',
          'Claude CLI: 已安装 (v2.1.0), 已登录',
          '优先级: API Key > CLI 代理',
        ],
      };
      mockedDetectAuth.mockReturnValue(mockResult);

      // 动态导入以使用 mock
      const { runAuthStatus } = await import('../../src/cli/commands/auth-status.js');
      await runAuthStatus({
        subcommand: 'auth-status',
        deep: false,
        force: false,
        version: false,
        help: false,
        global: false,
        remove: false,
      });

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('认证状态');
      expect(output).toContain('ANTHROPIC_API_KEY');
      expect(output).toContain('Claude CLI');
    });

    it('仅 CLI 可用时显示正确输出', async () => {
      const mockResult: AuthDetectionResult = {
        methods: [
          { type: 'api-key', available: false, details: '未设置' },
          { type: 'cli-proxy', available: true, details: '已安装 (v2.1.0), 已登录' },
        ],
        preferred: { type: 'cli-proxy', available: true, details: '已安装 (v2.1.0), 已登录' },
        diagnostics: [
          'ANTHROPIC_API_KEY: 未设置',
          'Claude CLI: 已安装 (v2.1.0), 已登录',
          '优先级: API Key > CLI 代理',
        ],
      };
      mockedDetectAuth.mockReturnValue(mockResult);

      const { runAuthStatus } = await import('../../src/cli/commands/auth-status.js');
      await runAuthStatus({
        subcommand: 'auth-status',
        deep: false,
        force: false,
        version: false,
        help: false,
        global: false,
        remove: false,
      });

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('认证状态');
      // CLI 可用
      expect(output).toMatch(/✓.*Claude CLI/);
      // API Key 不可用
      expect(output).toMatch(/✗.*ANTHROPIC_API_KEY/);
    });

    it('无任何可用方式时显示配置建议', async () => {
      const mockResult: AuthDetectionResult = {
        methods: [
          { type: 'api-key', available: false, details: '未设置' },
          { type: 'cli-proxy', available: false, details: '未安装' },
        ],
        preferred: null,
        diagnostics: [
          'ANTHROPIC_API_KEY: 未设置',
          'Claude CLI: 未安装',
          '未找到可用的认证方式',
        ],
      };
      mockedDetectAuth.mockReturnValue(mockResult);

      const { runAuthStatus } = await import('../../src/cli/commands/auth-status.js');
      await runAuthStatus({
        subcommand: 'auth-status',
        deep: false,
        force: false,
        version: false,
        help: false,
        global: false,
        remove: false,
      });

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('未找到可用的认证方式');
      expect(output).toContain('ANTHROPIC_API_KEY');
      expect(output).toContain('claude auth login');
    });
  });
});
