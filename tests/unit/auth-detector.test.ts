/**
 * auth-detector 单元测试
 * 验证认证检测逻辑（API Key / CLI 可用性）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { detectAuth } from '../../src/auth/auth-detector.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// Mock fs（用于非 macOS 平台的凭证检测）
// W2：Codex 凭据探测从 existsSync 改为 statSync（需区分 ENOENT / EACCES），
// 故 statSync 也必须纳入 mock —— 否则会打到跑测机器的真实 ~/.codex/auth.json，
// 让「未登录」类断言随机器是否登录过 Codex 而漂移。
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync),
  };
});

const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedStatSync = vi.mocked(statSync);

/** 构造带 errno 的 fs 异常，用于驱动 probeCodexPath 的分支 */
function fsError(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: mocked`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('auth-detector', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['CODEX_THREAD_ID'];
    delete process.env['CODEX_SHELL'];
    delete process.env['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'];
    // F240（FR-007）：Codex 凭据路径迁移到 CODEX_HOME helper 后，默认行为断言
    // 要求 CODEX_HOME 未设置——显式清除以免跑测机器的外部环境导致假失败。
    delete process.env['CODEX_HOME'];
    vi.clearAllMocks();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockedExistsSync.mockReturnValue(false);
    // 默认「路径确实不存在」，与上面 existsSync=false 语义对齐，
    // 使既有的「Codex 未登录」类断言保持原意且与跑测机器状态无关。
    mockedStatSync.mockImplementation(() => {
      throw fsError('ENOENT');
    });
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
      // existsSync 仍服务于 Claude 凭据路径探测（未迁移，保持原样）
      mockedExistsSync.mockImplementation((filePath: any) => String(filePath).includes('/.codex/auth.json'));
      // W2：Codex 凭据探测已改用 statSync（需区分 ENOENT / EACCES），故同步 mock。
      // 下方断言逐字未动，仅探测机制随实现变更而对齐。
      mockedStatSync.mockImplementation((filePath: unknown) => {
        if (String(filePath).includes('/.codex/auth.json')) {
          return { isDirectory: () => false } as unknown as ReturnType<typeof statSync>;
        }
        throw fsError('ENOENT');
      });

      const result = detectAuth();

      expect(result.preferred).not.toBeNull();
      expect(result.preferred!.type).toBe('cli-proxy');
      expect(result.preferred!.provider).toBe('codex');
      expect(result.diagnostics.some((item) => item.includes('Codex CLI > API Key > Claude CLI'))).toBe(true);
    });

    // ── F240 / FR-007(3)：新增的自定义 CODEX_HOME 用例（上方默认行为断言未删改）──

    it('自定义 CODEX_HOME 时到该目录下找 auth.json，而非 ~/.codex', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      process.env['CODEX_HOME'] = '/tmp/f240-auth-home';

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which codex')) return '/usr/local/bin/codex';
        if (cmdStr.includes('/usr/local/bin/codex --version')) return 'codex-cli 0.144.6';
        if (cmdStr.includes('find-generic-password')) throw new Error('not found');
        return '';
      });
      Object.defineProperty(process, 'platform', { value: 'linux' });

      // W2：探测点从 existsSync 改为 statSync（需区分 ENOENT / EACCES），故在此追踪 statSync
      const probed: string[] = [];
      mockedStatSync.mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        probed.push(p);
        if (p === '/tmp/f240-auth-home/auth.json') {
          return { isDirectory: () => false } as unknown as ReturnType<typeof statSync>;
        }
        throw fsError('ENOENT');
      });

      const result = detectAuth();

      // 确实探测了自定义目录下的 auth.json
      expect(probed).toContain('/tmp/f240-auth-home/auth.json');
      // 且没有再去探测家目录下的 ~/.codex/auth.json
      expect(probed.some((p) => p.endsWith('/.codex/auth.json') && p !== '/tmp/f240-auth-home/auth.json')).toBe(false);

      const codexMethod = result.methods.find((m) => m.provider === 'codex');
      expect(codexMethod!.details).toContain('已登录');
    });

    // ── Codex 对抗审查 W2：凭据探测失败 ≠ 未登录 ──

    it('🔴 W2 — 凭据路径 EACCES 时报"无法探测"而非"未登录"', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      process.env['CODEX_HOME'] = '/tmp/f240-auth-denied';

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which codex')) return '/usr/local/bin/codex';
        if (cmdStr.includes('/usr/local/bin/codex --version')) return 'codex-cli 0.144.6';
        throw new Error('not found');
      });
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockedStatSync.mockImplementation(() => {
        throw fsError('EACCES');
      });

      const result = detectAuth();
      const codexMethod = result.methods.find((m) => m.provider === 'codex')!;

      // 仍然不可用（确实用不了），但措辞必须说清是**探测不了**而非**没登录** ——
      // 否则用户会按提示去做无效的重新登录，真正的权限问题被永远掩盖。
      expect(codexMethod.available).toBe(false);
      expect(codexMethod.details).toContain('无法探测');
      expect(codexMethod.details).toContain('EACCES');
      expect(codexMethod.details).not.toContain('未登录');

      const codexDiag = result.diagnostics.find((d) => d.startsWith('Codex CLI:'))!;
      expect(codexDiag).toContain('无法探测');
      expect(codexDiag).not.toContain('未登录');
    });

    it('🔴 W2 — 凭据路径 ENOENT 时仍报"未登录"（既有语义不变）', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      process.env['CODEX_HOME'] = '/tmp/f240-auth-missing';

      mockedExecSync.mockImplementation((cmd: string) => {
        const cmdStr = typeof cmd === 'string' ? cmd : String(cmd);
        if (cmdStr.includes('which codex')) return '/usr/local/bin/codex';
        if (cmdStr.includes('/usr/local/bin/codex --version')) return 'codex-cli 0.144.6';
        throw new Error('not found');
      });
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const result = detectAuth();
      const codexMethod = result.methods.find((m) => m.provider === 'codex')!;

      expect(codexMethod.available).toBe(false);
      expect(codexMethod.details).toContain('未登录');
      expect(codexMethod.details).not.toContain('无法探测');
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
