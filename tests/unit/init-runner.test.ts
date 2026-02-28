/**
 * init 命令执行器单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

const mocks = vi.hoisted(() => ({
  installSkills: vi.fn(),
  removeSkills: vi.fn(),
  resolveTargetDir: vi.fn(),
  formatSummary: vi.fn(),
}));

vi.mock('../../src/installer/skill-installer.js', () => ({
  installSkills: mocks.installSkills,
  removeSkills: mocks.removeSkills,
  resolveTargetDir: mocks.resolveTargetDir,
  formatSummary: mocks.formatSummary,
}));

import { runInit } from '../../src/cli/commands/init.js';

function makeCommand(overrides: Partial<CLICommand> = {}): CLICommand {
  return {
    subcommand: 'init',
    deep: false,
    force: false,
    version: false,
    help: false,
    global: false,
    remove: false,
    skillTarget: 'claude',
    ...overrides,
  };
}

describe('runInit', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    mocks.resolveTargetDir.mockImplementation((mode: string, platform: string) => {
      return `${mode}-${platform}-dir`;
    });
    mocks.installSkills.mockImplementation(({ platform }: { platform: string }) => ({
      results: [{ status: 'installed', skillName: `${platform}-skill` }],
    }));
    mocks.removeSkills.mockImplementation(({ platform }: { platform: string }) => ({
      results: [{ status: 'removed', skillName: `${platform}-skill` }],
    }));
    mocks.formatSummary.mockReturnValue('summary');
  });

  it('默认安装模式应调用 installSkills', () => {
    runInit(makeCommand({ remove: false, skillTarget: 'claude' }));
    expect(mocks.installSkills).toHaveBeenCalledTimes(1);
    expect(mocks.removeSkills).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('remove 模式应调用 removeSkills', () => {
    runInit(makeCommand({ remove: true, skillTarget: 'claude' }));
    expect(mocks.removeSkills).toHaveBeenCalledTimes(1);
    expect(mocks.installSkills).not.toHaveBeenCalled();
  });

  it('skillTarget=both 时应同时处理 claude/codex', () => {
    runInit(makeCommand({ skillTarget: 'both' }));
    expect(mocks.installSkills).toHaveBeenCalledTimes(2);
  });

  it('全失败时设置 process.exitCode=1', () => {
    mocks.installSkills.mockReturnValue({
      results: [{ status: 'failed', skillName: 'x' }],
    });
    runInit(makeCommand({ skillTarget: 'claude' }));
    expect(process.exitCode).toBe(1);
  });
});

