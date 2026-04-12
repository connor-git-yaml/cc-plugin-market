/**
 * parse-args cache 子命令解析测试
 * 覆盖 T-012 验收标准的所有解析场景
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

describe('parseArgs — cache 子命令', () => {
  it("['cache', 'stats'] 解析 cacheOperation: 'stats'", () => {
    const result = parseArgs(['cache', 'stats']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('cache');
      expect(result.command.cacheOperation).toBe('stats');
    }
  });

  it("['cache', 'stats', '--output-dir', '/tmp/out'] 解析 outputDir", () => {
    const result = parseArgs(['cache', 'stats', '--output-dir', '/tmp/out']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('cache');
      expect(result.command.cacheOperation).toBe('stats');
      expect(result.command.outputDir).toBe('/tmp/out');
    }
  });

  it("['cache', 'clear'] 解析 cacheOperation: 'clear'", () => {
    const result = parseArgs(['cache', 'clear']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('cache');
      expect(result.command.cacheOperation).toBe('clear');
    }
  });

  it("['cache', 'clear', '--generator', 'workspace-index'] 解析 cacheGeneratorId", () => {
    const result = parseArgs(['cache', 'clear', '--generator', 'workspace-index']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('cache');
      expect(result.command.cacheOperation).toBe('clear');
      expect(result.command.cacheGeneratorId).toBe('workspace-index');
    }
  });

  it("['cache'] 返回 help: true", () => {
    const result = parseArgs(['cache']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('cache');
      expect(result.command.help).toBe(true);
    }
  });

  it("['cache', 'unknown-op'] 返回 ok: false", () => {
    const result = parseArgs(['cache', 'unknown-op']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_subcommand');
    }
  });
});
