/**
 * Feature 238 Slice 2 — detect-codex-capability.mjs 单测
 *
 * 覆盖：
 *   - parseFeaturesListOutput：首 token 精确匹配 `multi_agent` + 取行末最后一个非空 token 的
 *     解析规则（FR-203/209），覆盖七类 reason 中除子进程边界外的全部纯文本分支
 *     （native / no-feature-row / malformed-effective / effective-false），并验证
 *     `multi_agent_mode`/`multi_agent_v2` 干扰行不被误判、多词 stage 变体的行末取值规则
 *   - detectCodexCapability：mock `node:child_process` 覆盖 binary-missing / timeout /
 *     unsupported-command / command-failed 四类子进程边界（FR-201/202/203）
 *   - detectCodexVersion：正常解析版本字符串；失败（ENOENT/非零退出）返回 null 不抛异常（FR-207/208）
 *   - renderCapabilityMarkdown：sidecar 三要素 schema（capability 行 + ISO 8601 时间戳行 +
 *     codex --version 结果行），degraded 结果额外含 reason 字段（FR-206/207）
 *
 * Mock 手法与 tests/unit/codex-proxy.test.ts 一致：vi.mock('node:child_process')。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import {
  parseFeaturesListOutput,
  detectCodexCapability,
  detectCodexVersion,
  renderCapabilityMarkdown,
} from '../../../plugins/spec-driver/scripts/lib/detect-codex-capability.mjs';

const mockedExecFileSync = vi.mocked(execFileSync);

const ISO_8601_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

describe('detect-codex-capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------
  // T2.1 / T2.2 — parseFeaturesListOutput 纯函数解析规则
  // ---------------------------------------------------------------------
  describe('parseFeaturesListOutput', () => {
    it('T2.1 native：multi_agent 行 effective=true → {capability: native, reason: null}', () => {
      const stdout = [
        'multi_agent                          stable             true',
        'multi_agent_mode                     removed            false',
        'multi_agent_v2                       under development  false',
      ].join('\n');
      expect(parseFeaturesListOutput(stdout)).toEqual({ capability: 'native', reason: null });
    });

    it('no-feature-row：输出不含首 token 精确等于 multi_agent 的行', () => {
      const stdout = [
        'multi_agent_mode                     removed            false',
        'enable_fanout                        under development  false',
      ].join('\n');
      expect(parseFeaturesListOutput(stdout)).toEqual({
        capability: 'degraded',
        reason: 'no-feature-row',
      });
    });

    it('no-feature-row：空输出', () => {
      expect(parseFeaturesListOutput('')).toEqual({
        capability: 'degraded',
        reason: 'no-feature-row',
      });
    });

    it('malformed-effective：行末最后一个非空 token 非 true/false', () => {
      const stdout = 'multi_agent   stable   maybe';
      expect(parseFeaturesListOutput(stdout)).toEqual({
        capability: 'degraded',
        reason: 'malformed-effective',
      });
    });

    it('effective-false：行末最后一个非空 token 为 false', () => {
      const stdout = 'multi_agent   stable   false';
      expect(parseFeaturesListOutput(stdout)).toEqual({
        capability: 'degraded',
        reason: 'effective-false',
      });
    });

    it('multi_agent_mode / multi_agent_v2 干扰行不被误判（首 token 精确匹配非前缀/子串）', () => {
      const stdout = [
        'multi_agent_mode                     removed            false',
        'multi_agent_v2                       under development  false',
        'multi_agent                          stable             true',
      ].join('\n');
      expect(parseFeaturesListOutput(stdout)).toEqual({ capability: 'native', reason: null });
    });

    it('multi_agent_mode / multi_agent_v2 干扰行且真实行 effective=false 时正确判定为 effective-false（非误判为 no-feature-row）', () => {
      const stdout = [
        'multi_agent_mode                     removed            false',
        'multi_agent                          stable             false',
        'multi_agent_v2                       under development  false',
      ].join('\n');
      expect(parseFeaturesListOutput(stdout)).toEqual({
        capability: 'degraded',
        reason: 'effective-false',
      });
    });

    it('多词 stage 变体：multi_agent under development true → 取行末最后一个非空 token 而非固定列位裁切', () => {
      const stdout = 'multi_agent   under development   true';
      expect(parseFeaturesListOutput(stdout)).toEqual({ capability: 'native', reason: null });
    });

    it('列宽/空白变体：Tab 混合分隔仍可解析（FR-209 容错）', () => {
      const stdout = 'multi_agent\t\tstable\t\ttrue';
      expect(parseFeaturesListOutput(stdout)).toEqual({ capability: 'native', reason: null });
    });

    it('列宽/空白变体：单空格窄列宽仍可解析（FR-209 容错）', () => {
      const stdout = 'multi_agent stable true';
      expect(parseFeaturesListOutput(stdout)).toEqual({ capability: 'native', reason: null });
    });

    it('研究附 2 真实四行样例：完整 codex features list 输出解析出 native', () => {
      const stdout = [
        'multi_agent                          stable             true',
        'multi_agent_mode                     removed            false',
        'multi_agent_v2                       under development  false',
        'enable_fanout                        under development  false',
      ].join('\n');
      expect(parseFeaturesListOutput(stdout)).toEqual({ capability: 'native', reason: null });
    });
  });

  // ---------------------------------------------------------------------
  // T2.3 — detectCodexCapability 子进程边界分类
  // ---------------------------------------------------------------------
  describe('detectCodexCapability', () => {
    it('execFileSync 抛 ENOENT → binary-missing', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      });
      expect(detectCodexCapability()).toEqual({ capability: 'degraded', reason: 'binary-missing' });
    });

    it('execFileSync 抛 killed/SIGTERM → timeout', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' });
      });
      expect(detectCodexCapability()).toEqual({ capability: 'degraded', reason: 'timeout' });
    });

    it('stderr 含 unrecognized subcommand → unsupported-command', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('exit status 2'), {
          status: 2,
          stderr: "error: unrecognized subcommand 'features'\n\nUsage: codex [OPTIONS]",
        });
      });
      expect(detectCodexCapability()).toEqual({
        capability: 'degraded',
        reason: 'unsupported-command',
      });
    });

    it('其余非零退出（非 ENOENT/超时/unsupported-command）→ command-failed', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('exit status 1'), {
          status: 1,
          stderr: 'unexpected internal error',
        });
      });
      expect(detectCodexCapability()).toEqual({ capability: 'degraded', reason: 'command-failed' });
    });

    it('无 stderr 字段的非零退出仍归类为 command-failed（不抛异常）', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('exit status 1'), { status: 1 });
      });
      expect(detectCodexCapability()).toEqual({ capability: 'degraded', reason: 'command-failed' });
    });

    it('成功路径：stdout 交给 parseFeaturesListOutput 解析', () => {
      mockedExecFileSync.mockReturnValue('multi_agent   stable   true\n');
      expect(detectCodexCapability()).toEqual({ capability: 'native', reason: null });
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'codex',
        ['features', 'list'],
        expect.objectContaining({ timeout: 5000 }),
      );
    });
  });

  // ---------------------------------------------------------------------
  // T2.3b — detectCodexVersion 子进程 mock
  // ---------------------------------------------------------------------
  describe('detectCodexVersion', () => {
    it('正常输出解析为版本字符串（去除首尾空白）', () => {
      mockedExecFileSync.mockReturnValue('codex-cli 0.144.6\n');
      expect(detectCodexVersion()).toBe('codex-cli 0.144.6');
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        'codex',
        ['--version'],
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it('ENOENT → 返回 null（不抛异常，不阻断 sidecar 写入）', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      });
      expect(() => detectCodexVersion()).not.toThrow();
      expect(detectCodexVersion()).toBeNull();
    });

    it('非零退出 → 返回 null（不抛异常）', () => {
      mockedExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('exit status 1'), { status: 1 });
      });
      expect(() => detectCodexVersion()).not.toThrow();
      expect(detectCodexVersion()).toBeNull();
    });

    it('空白输出 → 返回 null（不作为合法版本字符串）', () => {
      mockedExecFileSync.mockReturnValue('   \n');
      expect(detectCodexVersion()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // T2.3c — renderCapabilityMarkdown schema 三要素
  // ---------------------------------------------------------------------
  describe('renderCapabilityMarkdown', () => {
    it('native 结果含 capability 行 + ISO 8601 时间戳行 + codex --version 结果行三要素', () => {
      const md = renderCapabilityMarkdown({
        capability: 'native',
        reason: null,
        version: 'codex-cli 0.144.6',
      });
      expect(md).toContain('- Subagent Capability: native');
      expect(md).toMatch(ISO_8601_RE);
      expect(md).toContain('codex-cli 0.144.6');
    });

    it('degraded 结果的 capability 行含机械可解析的 reason 字段', () => {
      const md = renderCapabilityMarkdown({
        capability: 'degraded',
        reason: 'binary-missing',
        version: null,
      });
      expect(md).toContain('- Subagent Capability: degraded(reason=binary-missing)');
      expect(md).toMatch(ISO_8601_RE);
    });

    it('version 为 null 时版本行仍存在（不缺失该要素，标注未知）', () => {
      const md = renderCapabilityMarkdown({
        capability: 'degraded',
        reason: 'timeout',
        version: null,
      });
      const versionLine = md.split('\n').find((line) => line.toLowerCase().includes('version'));
      expect(versionLine).toBeDefined();
    });

    it('七类 reason 均可正确渲染为机械可解析行', () => {
      const reasons = [
        'binary-missing',
        'command-failed',
        'unsupported-command',
        'timeout',
        'no-feature-row',
        'malformed-effective',
        'effective-false',
      ];
      for (const reason of reasons) {
        const md = renderCapabilityMarkdown({ capability: 'degraded', reason, version: null });
        expect(md).toContain(`- Subagent Capability: degraded(reason=${reason})`);
      }
    });
  });
});
