/**
 * F183 修复 2：buildTsConfigContext 两失败分支 warn + 限频单测（T-03）
 *
 * 验证 monorepo 子包 tsconfig 损坏时不再「双静默」：
 *   - configFile.error 分支（语法损坏 tsconfig）→ logger.warn 触发一次
 *   - 相同 configPath 第二次调用 → warn 不重复（warnedConfigPaths 限频）
 *   - 不同 configPath → 各自 warn 一次（cache 不误伤）
 *   - catch 分支（readConfigFile throw）→ warn 触发一次
 *   - 所有失败路径仍 return null（行为语义不变）
 *
 * Codex C-1：logger 是模块级私有实例无法 vi.spyOn，改 vi.spyOn(process.stderr, 'write')
 * 断言（logger 默认 warn 级别写 stderr）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('buildTsConfigContext 失败分支 warn 限频（T-03）', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.resetModules();
    vi.doUnmock('ts-morph');
  });

  it('configFile.error 分支：语法损坏 tsconfig → warn 一次且含 configPath；二次调用不重复；仍 return null', async () => {
    const { buildTsConfigContext } = await import('../../../src/core/import-resolver.js');
    const tmp = mkdtempSync(join(tmpdir(), 'f183-tsconfig-err-'));
    try {
      // 语法损坏：缺闭合大括号 → ts.readConfigFile 返回 { error }
      const badPath = join(tmp, 'tsconfig.json');
      writeFileSync(badPath, '{ "compilerOptions": ', 'utf8');

      const first = buildTsConfigContext(badPath);
      expect(first).toBeNull();
      const callsAfterFirst = stderrSpy.mock.calls.filter((c) =>
        String(c[0]).includes(badPath),
      );
      expect(callsAfterFirst.length).toBe(1);

      // 相同 configPath 第二次调用 → warn 不重复触发（限频）
      const second = buildTsConfigContext(badPath);
      expect(second).toBeNull();
      const callsAfterSecond = stderrSpy.mock.calls.filter((c) =>
        String(c[0]).includes(badPath),
      );
      expect(callsAfterSecond.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('不同 configPath → 各自 warn 一次（cache 不误伤其他路径）', async () => {
    const { buildTsConfigContext } = await import('../../../src/core/import-resolver.js');
    const tmp = mkdtempSync(join(tmpdir(), 'f183-tsconfig-multi-'));
    try {
      const pathA = join(tmp, 'a.json');
      const pathB = join(tmp, 'b.json');
      writeFileSync(pathA, '{ "compilerOptions": ', 'utf8');
      writeFileSync(pathB, '{ "compilerOptions": ', 'utf8');

      expect(buildTsConfigContext(pathA)).toBeNull();
      expect(buildTsConfigContext(pathB)).toBeNull();

      const callsA = stderrSpy.mock.calls.filter((c) => String(c[0]).includes(pathA));
      const callsB = stderrSpy.mock.calls.filter((c) => String(c[0]).includes(pathB));
      expect(callsA.length).toBe(1);
      expect(callsB.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('catch 分支：readConfigFile throw → warn 触发一次且仍 return null', async () => {
    vi.resetModules();
    vi.doMock('ts-morph', () => ({
      ts: {
        readConfigFile: () => {
          throw new Error('boom');
        },
        sys: { readFile: () => undefined },
        parseJsonConfigFileContent: () => ({ options: {} }),
      },
    }));

    const { buildTsConfigContext } = await import('../../../src/core/import-resolver.js');
    const tmp = mkdtempSync(join(tmpdir(), 'f183-tsconfig-catch-'));
    try {
      const cfgPath = join(tmp, 'tsconfig.json');
      writeFileSync(cfgPath, '{}', 'utf8');

      const result = buildTsConfigContext(cfgPath);
      expect(result).toBeNull();
      const calls = stderrSpy.mock.calls.filter((c) => String(c[0]).includes(cfgPath));
      expect(calls.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
