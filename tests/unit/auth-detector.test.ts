/**
 * auth-detector 单元测试
 * 验证认证检测逻辑（API Key / CLI 可用性）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
const mockedExistsSync = vi.mocked(existsSync);

describe('auth-detector', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['CODEX_THREAD_ID'];
    delete process.env['CODEX_SHELL'];
    delete process.env['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'];
    vi.clearAllMocks();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockReturnValue(false);
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
        if (cmdStr.includes('which codex')) throw new Error('not found');
        if (cmdStr.includes('which claude')) return '/usr/local/bin/claude';
        if (cmdStr.includes('--version')) return '2.1.0 (Claude Code)';
        // macOS Keychain 检测：security find-generic-password
        if (cmdStr.includes('find-generic-password')) return 'keychain: login.keychain-db';
        return '';
      });

      const result = detectAuth();

      expect(result.preferred).not.toBeNull();
      expect(result.preferred!.type).toBe('cli-proxy');
      expect(result.preferred!.provider).toBe('claude');
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
      const codexMethod = result.methods.find((m) => m.type === 'cli-proxy' && m.provider === 'codex');
      const claudeMethod = result.methods.find((m) => m.type === 'cli-proxy' && m.provider === 'claude');
      expect(codexMethod).toBeDefined();
      expect(claudeMethod).toBeDefined();
      expect(codexMethod!.available).toBe(false);
      expect(claudeMethod!.available).toBe(false);
      expect(codexMethod!.details).toContain('未安装');
      expect(claudeMethod!.details).toContain('未安装');
    });

    it('无 API Key + CLI 已安装但 Keychain 无凭证 → 返回不可用 + 诊断信息', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which codex')) throw new Error('not found');
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

      const cliMethod = result.methods.find((m) => m.type === 'cli-proxy' && m.provider === 'claude');
      expect(cliMethod).toBeDefined();
      expect(cliMethod!.available).toBe(false);
      expect(cliMethod!.details).toContain('未登录');
    });

    it('优先级排序：API Key > CLI Proxy', () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-test-key-456';
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which codex')) throw new Error('not found');
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

    it('Codex 环境优先选择 Codex CLI', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      process.env['CODEX_THREAD_ID'] = 'thread-1';

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which codex')) return '/Applications/Codex.app/Contents/Resources/codex';
        if (cmdStr.includes('which claude')) return '/usr/local/bin/claude';
        if (cmdStr.includes('/Applications/Codex.app/Contents/Resources/codex --version')) return 'codex-cli 0.116.0';
        if (cmdStr.includes('/usr/local/bin/claude --version')) return '2.1.0 (Claude Code)';
        if (cmdStr.includes('find-generic-password')) throw new Error('not found');
        return '';
      });

      // mock ~/.codex/auth.json 存在，Claude Keychain 不存在
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockedExistsSync.mockImplementation((filePath: any) => String(filePath).includes('/.codex/auth.json'));

      const result = detectAuth();

      expect(result.preferred).not.toBeNull();
      expect(result.preferred!.type).toBe('cli-proxy');
      expect(result.preferred!.provider).toBe('codex');
      expect(result.diagnostics.some((item) => item.includes('Codex CLI > API Key > Claude CLI'))).toBe(true);
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
