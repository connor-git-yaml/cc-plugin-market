/**
 * Feature 176 — spike 解析 / 路径常量 / 版本门禁 守卫路径 单测（[sandbox] 可验证部分）。
 *
 * 真实 spike PASS/FAIL 由 host 跑（需 claude OAuth），本文件只覆盖纯逻辑：
 *   - parsePluginMcpCalls：plugin-namespace vs driver-namespace 区分、空/畸形鲁棒
 *   - swe-bench-verified-paths：repeatIndex 隔离 + 校验
 *   - spectra-version-gate：缺 dist / 缺 build-meta 的 hard-fail 守卫
 */
import { describe, expect, it } from 'vitest';
import { parsePluginMcpCalls } from '../../scripts/spike-cohort3-plugin-mcp.mjs';
import {
  runFixturePath,
  runCombDir,
  VERIFIED_ROOT_REL,
} from '../../scripts/lib/swe-bench-verified-paths.mjs';
import { verifySpectraVersion, BUILD_META_NAME, BUILD_INPUT_PATHS } from '../../scripts/lib/spectra-version-gate.mjs';

describe('parsePluginMcpCalls', () => {
  it('区分 plugin-namespace 与 driver-namespace 调用', () => {
    const stdout = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_spectra_spectra__context' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_spectra_spectra__impact' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__spectra__context' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
    ].join('\n');
    const r = parsePluginMcpCalls(stdout);
    expect(r.pluginCallCount).toBe(2);
    expect(r.driverCallCount).toBe(1);
    expect(r.anySpectra).toBe(true);
  });

  it('无 spectra 调用时 anySpectra=false', () => {
    const stdout = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } });
    const r = parsePluginMcpCalls(stdout);
    expect(r.pluginCallCount).toBe(0);
    expect(r.driverCallCount).toBe(0);
    expect(r.anySpectra).toBe(false);
  });

  it('畸形/非 JSON 行不抛错', () => {
    const stdout = ['not json', '', '{bad', JSON.stringify({ type: 'result' })].join('\n');
    expect(() => parsePluginMcpCalls(stdout)).not.toThrow();
    expect(parsePluginMcpCalls(stdout).pluginCallCount).toBe(0);
  });

  it('兼容顶层 content 数组形态', () => {
    const stdout = JSON.stringify({ content: [{ type: 'tool_use', name: 'mcp__plugin_spectra_spectra__detect_changes' }] });
    expect(parsePluginMcpCalls(stdout).pluginCallCount).toBe(1);
  });

  it('统计 Task 子代理调用 + pluginAfterTask（子代理归因）', () => {
    const stdout = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Task' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_spectra_spectra__context' }] } }),
    ].join('\n');
    const r = parsePluginMcpCalls(stdout);
    expect(r.taskCallCount).toBe(1);
    expect(r.pluginCallCount).toBe(1);
    expect(r.pluginAfterTask).toBe(true);
  });

  it('plugin 在 Task 之前 → pluginAfterTask=false（仅 driver 可达）', () => {
    const stdout = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_spectra_spectra__context' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Task' }] } }),
    ].join('\n');
    const r = parsePluginMcpCalls(stdout);
    expect(r.pluginAfterTask).toBe(false);
  });

  it('全递归：tool_use 藏在非 content 包装层（delta/start）也能抓到', () => {
    const stdout = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', block: { type: 'tool_use', name: 'mcp__plugin_spectra_spectra__impact' } },
    });
    expect(parsePluginMcpCalls(stdout).pluginCallCount).toBe(1);
  });
});

describe('swe-bench-verified-paths', () => {
  it('runFixturePath 含 repeatIndex 隔离', () => {
    const p = runFixturePath('SWE-V001-foo', 'spec-driver-spectra-mcp', 2);
    expect(p).toContain(`${VERIFIED_ROOT_REL}/tasks/SWE-V001-foo/spec-driver-spectra-mcp/r2/full.json`);
  });

  it('repeatIndex 非法值抛错', () => {
    expect(() => runFixturePath('t', 'c', 0)).toThrow();
    expect(() => runFixturePath('t', 'c', -1)).toThrow();
    expect(() => runFixturePath('t', 'c', 1.5)).toThrow();
  });

  it('缺 taskId / cohort 抛错', () => {
    // @ts-expect-error 故意缺参
    expect(() => runFixturePath(undefined, 'c', 1)).toThrow();
  });

  it('runCombDir 不含 repeatIndex（combo 根）', () => {
    expect(runCombDir('t', 'c')).toContain(`${VERIFIED_ROOT_REL}/tasks/t/c`);
    expect(runCombDir('t', 'c')).not.toContain('/r');
  });
});

describe('spectra-version-gate 守卫路径', () => {
  it('dist 不存在 → ok=false', () => {
    const r = verifySpectraVersion('/nonexistent/dist/cli/index.js');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('dist 不存在');
  });

  it('BUILD_META_NAME 是 .spectra-build-meta.json', () => {
    expect(BUILD_META_NAME).toBe('.spectra-build-meta.json');
  });

  it('BUILD_INPUT_PATHS 只含 build 输入（src/tsconfig/package），不含 specs 等再生 doc', () => {
    // sourceDirty 只看这些；再生 doc 脏不阻断 spike/batch（CON-2: specs/src.spec.md 保持未提交）
    expect(BUILD_INPUT_PATHS).toContain('src');
    expect(BUILD_INPUT_PATHS).toContain('package.json');
    expect(BUILD_INPUT_PATHS.some((p: string) => p.startsWith('specs'))).toBe(false);
  });
});
