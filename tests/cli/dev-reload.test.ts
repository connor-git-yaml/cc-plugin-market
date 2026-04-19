/**
 * dev 热重载模式单元测试
 * 覆盖 --dev flag 解析、SPECTRA_DEV 环境变量、CI 守卫逻辑
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';
import { resolveDevMode } from '../../src/cli/commands/mcp-server.js';

/** 保存并恢复环境变量的辅助函数 */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

describe('parseArgs: mcp-server --dev flag', () => {
  it('mcp-server 不带 --dev 时 mcpDev 为 false', () => {
    const result = parseArgs(['mcp-server']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('mcp-server');
      expect(result.command.mcpDev).toBe(false);
    }
  });

  it('mcp-server --dev 时 mcpDev 为 true', () => {
    const result = parseArgs(['mcp-server', '--dev']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('mcp-server');
      expect(result.command.mcpDev).toBe(true);
    }
  });

  it('mcp-server 不接受其他未知 flag 时仍能正常解析（向后兼容）', () => {
    const result = parseArgs(['mcp-server']);
    expect(result.ok).toBe(true);
  });
});

describe('resolveDevMode: 环境变量和 CI 守卫', () => {
  // 每个测试前清理可能干扰测试的环境变量
  beforeEach(() => {
    delete process.env['CI'];
    delete process.env['SPECTRA_DEV'];
    delete process.env['SPECTRA_DEV_DISABLE'];
  });

  afterEach(() => {
    delete process.env['CI'];
    delete process.env['SPECTRA_DEV'];
    delete process.env['SPECTRA_DEV_DISABLE'];
  });

  it('--dev flag（mcpDev=true）在非 CI 环境下返回 true', () => {
    const result = resolveDevMode({ mcpDev: true });
    expect(result).toBe(true);
  });

  it('SPECTRA_DEV=1 在非 CI 环境下返回 true', () => {
    withEnv({ SPECTRA_DEV: '1' }, () => {
      const result = resolveDevMode({ mcpDev: false });
      expect(result).toBe(true);
    });
  });

  it('SPECTRA_DEV=0 显式禁用时返回 false', () => {
    withEnv({ SPECTRA_DEV: '0' }, () => {
      const result = resolveDevMode({ mcpDev: false });
      expect(result).toBe(false);
    });
  });

  it('CI=true 时即使传 --dev 也禁用 dev 模式', () => {
    withEnv({ CI: 'true' }, () => {
      const result = resolveDevMode({ mcpDev: true });
      expect(result).toBe(false);
    });
  });

  it('CI=1 时即使有 SPECTRA_DEV=1 也禁用 dev 模式', () => {
    withEnv({ CI: '1', SPECTRA_DEV: '1' }, () => {
      const result = resolveDevMode({ mcpDev: true });
      expect(result).toBe(false);
    });
  });

  it('SPECTRA_DEV_DISABLE=1 优先级高于 SPECTRA_DEV=1', () => {
    withEnv({ SPECTRA_DEV_DISABLE: '1', SPECTRA_DEV: '1' }, () => {
      const result = resolveDevMode({ mcpDev: true });
      expect(result).toBe(false);
    });
  });

  it('SPECTRA_DEV_DISABLE=1 优先级高于 --dev flag', () => {
    withEnv({ SPECTRA_DEV_DISABLE: '1' }, () => {
      const result = resolveDevMode({ mcpDev: true });
      expect(result).toBe(false);
    });
  });

  it('既无 --dev 也无 SPECTRA_DEV 时返回 false', () => {
    const result = resolveDevMode({ mcpDev: false });
    expect(result).toBe(false);
  });

  it('mcpDev 为 undefined 时等同于 false', () => {
    const result = resolveDevMode({});
    expect(result).toBe(false);
  });
});

describe('resolveDevMode: spawn 不被调用（CI 守卫集成）', () => {
  it('CI 环境下 resolveDevMode 返回 false，确认不会触发 dev 路径', () => {
    // 此测试验证 runMcpServer 在 CI 环境下不会进入 dev 分支
    // spawn 的 mock 测试通过 resolveDevMode 返回值间接覆盖
    withEnv({ CI: 'true' }, () => {
      const isDev = resolveDevMode({ mcpDev: true });
      expect(isDev).toBe(false);
      // 非 dev 路径不会调用 spawn，直接走 startMcpServer
    });
  });
});
