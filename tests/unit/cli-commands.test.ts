/**
 * CLI 参数解析单元测试
 * 覆盖 contracts/skill-registrar.md 中定义的 8 个测试用例
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

describe('parseArgs', () => {
  it('解析 generate 子命令', () => {
    const result = parseArgs(['generate', 'src/']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('generate');
      expect(result.command.target).toBe('src/');
    }
  });

  it('解析 batch --force', () => {
    const result = parseArgs(['batch', '--force']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('batch');
      expect(result.command.force).toBe(true);
    }
  });

  it('解析 batch --output-dir', () => {
    const result = parseArgs(['batch', '--output-dir', 'custom-specs']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('batch');
      expect(result.command.outputDir).toBe('custom-specs');
    }
  });

  it('解析 diff 子命令', () => {
    const result = parseArgs(['diff', 'a.md', 'src/']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('diff');
      expect(result.command.specFile).toBe('a.md');
      expect(result.command.target).toBe('src/');
    }
  });

  it('--version 标志', () => {
    const result = parseArgs(['--version']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.version).toBe(true);
    }
  });

  it('--help 标志', () => {
    const result = parseArgs(['--help']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.help).toBe(true);
    }
  });

  it('无效子命令', () => {
    const result = parseArgs(['invalid']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_subcommand');
    }
  });

  it('generate 缺少 target', () => {
    const result = parseArgs(['generate']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('missing_target');
    }
  });

  it('--output-dir 选项', () => {
    const result = parseArgs(['generate', 'src/', '--output-dir', 'out/']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.outputDir).toBe('out/');
    }
  });

  it('无参数时显示帮助', () => {
    const result = parseArgs([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.help).toBe(true);
    }
  });

  it('-v 短选项', () => {
    const result = parseArgs(['-v']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.version).toBe(true);
    }
  });

  it('generate --deep 选项', () => {
    const result = parseArgs(['generate', 'src/', '--deep']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.deep).toBe(true);
    }
  });

  it('diff 缺少参数', () => {
    const result = parseArgs(['diff', 'a.md']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('missing_args');
    }
  });
});
