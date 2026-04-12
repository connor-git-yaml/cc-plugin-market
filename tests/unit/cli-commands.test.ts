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

  it('解析 batch --incremental', () => {
    const result = parseArgs(['batch', '--incremental']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('batch');
      expect(result.command.incremental).toBe(true);
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

  // ────────────────────────────────────────────────────────────
  // T094-05: --languages 选项
  // ────────────────────────────────────────────────────────────
  it('解析 batch --languages typescript,python', () => {
    const result = parseArgs(['batch', '--languages', 'typescript,python']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('batch');
      expect(result.command.languages).toEqual(['typescript', 'python']);
    }
  });

  it('batch --languages 单个语言', () => {
    const result = parseArgs(['batch', '--languages', 'go']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.languages).toEqual(['go']);
    }
  });

  it('无 --languages 时 languages 为 undefined', () => {
    const result = parseArgs(['batch']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.languages).toBeUndefined();
    }
  });

  it('--languages 在非 batch 命令下报错', () => {
    const result = parseArgs(['generate', 'src/', '--languages', 'typescript']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_option');
      expect(result.error.message).toContain('--languages');
    }
  });

  it('batch --languages 生成 _explicitFlags', () => {
    const result = parseArgs(['batch', '--force', '--languages', 'typescript']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command._explicitFlags).toBeDefined();
      expect(result.command._explicitFlags!.has('force')).toBe(true);
      expect(result.command._explicitFlags!.has('languages')).toBe(true);
      expect(result.command._explicitFlags!.has('incremental')).toBe(false);
    }
  });

  // ────────────────────────────────────────────────────────────
  // T007: watch 子命令相关测试
  // ────────────────────────────────────────────────────────────
  it('解析 watch 子命令（无选项）', () => {
    const result = parseArgs(['watch']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('watch');
      expect(result.command.watchDebounce).toBeUndefined();
      expect(result.command.watchVerbose).toBe(false);
    }
  });

  it('解析 watch --debounce 5', () => {
    const result = parseArgs(['watch', '--debounce', '5']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('watch');
      expect(result.command.watchDebounce).toBe(5);
    }
  });

  it('解析 watch --verbose', () => {
    const result = parseArgs(['watch', '--verbose']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('watch');
      expect(result.command.watchVerbose).toBe(true);
    }
  });

  it('解析 watch --debounce 和 --verbose 组合', () => {
    const result = parseArgs(['watch', '--debounce', '10', '--verbose']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('watch');
      expect(result.command.watchDebounce).toBe(10);
      expect(result.command.watchVerbose).toBe(true);
    }
  });
});
