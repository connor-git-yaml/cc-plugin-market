/**
 * auth-detector 单元测试
 * 验证认证检测逻辑（API Key / CLI 可用性）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { detectAuth } from '../../src/auth/auth-detector.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Mock fs（用于非 macOS 平台的凭证检测）
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

const mockedExecSync = vi.mocked(execSync);

describe('auth-detector', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('detectAuth', () => {
    it('有 API Key 时检测为 api-key 类型', () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-test-key-123';

      const result = detectAuth();

      expect(result.preferred).not.toBeNull();
      expect(result.preferred!.type).toBe('api-key');
      expect(result.preferred!.available).toBe(true);
      expect(result.preferred!.details).toContain('已设置');
    });

    it('无 API Key + CLI 已安装已登录（macOS Keychain）→ 检测为 cli-proxy 类型', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which claude')) return '/usr/local/bin/claude';
        if (cmdStr.includes('--version')) return '2.1.0 (Claude Code)';
        // macOS Keychain 检测：security find-generic-password
        if (cmdStr.includes('find-generic-password')) return 'keychain: login.keychain-db';
        return '';
      });

      const result = detectAuth();

      expect(result.preferred).not.toBeNull();
      expect(result.preferred!.type).toBe('cli-proxy');
      expect(result.preferred!.available).toBe(true);
      expect(result.preferred!.details).toContain('已安装');
      expect(result.preferred!.details).toContain('已登录');
    });

    it('无 API Key + CLI 未安装 → 返回无可用方式 + 诊断信息', () => {
      delete process.env['ANTHROPIC_API_KEY'];

      // which claude → 找不到
      mockedExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = detectAuth();

      expect(result.preferred).toBeNull();
      expect(result.diagnostics).toContain('未找到可用的认证方式');

      // api-key 方式不可用
      const apiKeyMethod = result.methods.find((m) => m.type === 'api-key');
      expect(apiKeyMethod).toBeDefined();
      expect(apiKeyMethod!.available).toBe(false);

      // cli-proxy 方式不可用
      const cliMethod = result.methods.find((m) => m.type === 'cli-proxy');
      expect(cliMethod).toBeDefined();
      expect(cliMethod!.available).toBe(false);
      expect(cliMethod!.details).toContain('未安装');
    });

    it('无 API Key + CLI 已安装但 Keychain 无凭证 → 返回不可用 + 诊断信息', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which claude')) return '/usr/local/bin/claude';
        if (cmdStr.includes('--version')) return '2.1.0 (Claude Code)';
        // Keychain 中无凭证
        if (cmdStr.includes('find-generic-password')) {
          throw new Error('The specified item could not be found in the keychain');
        }
        return '';
      });

      const result = detectAuth();

      expect(result.preferred).toBeNull();

      const cliMethod = result.methods.find((m) => m.type === 'cli-proxy');
      expect(cliMethod).toBeDefined();
      expect(cliMethod!.available).toBe(false);
      expect(cliMethod!.details).toContain('未登录');
    });

    it('优先级排序：API Key > CLI Proxy', () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-test-key-456';
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which claude')) return '/usr/local/bin/claude';
        if (cmdStr.includes('--version')) return '2.1.0 (Claude Code)';
        if (cmdStr.includes('find-generic-password')) return 'keychain: login.keychain-db';
        return '';
      });

      const result = detectAuth();

      // 两种方式都可用
      expect(result.methods.filter((m) => m.available)).toHaveLength(2);

      // 优先选择 API Key
      expect(result.preferred!.type).toBe('api-key');
    });

    it('API Key 掩码正确显示', () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-abcdefghijklmnop';

      const result = detectAuth();

      const apiKeyMethod = result.methods.find((m) => m.type === 'api-key');
      expect(apiKeyMethod!.details).toMatch(/sk-ant-api/);
      // 不应包含完整 key
      expect(apiKeyMethod!.details).not.toContain('abcdefghijklmnop');
    });

    it('空白 API Key 视为未设置', () => {
      process.env['ANTHROPIC_API_KEY'] = '   ';

      mockedExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = detectAuth();

      const apiKeyMethod = result.methods.find((m) => m.type === 'api-key');
      expect(apiKeyMethod!.available).toBe(false);
    });
  });
});
