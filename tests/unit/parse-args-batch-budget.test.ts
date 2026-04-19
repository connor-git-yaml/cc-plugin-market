/**
 * Feature 127: batch 子命令的 --dry-run / --budget / --on-over-budget 参数解析测试
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

describe('parseArgs batch flags (Feature 127)', () => {
  it('--dry-run 被正确识别', () => {
    const result = parseArgs(['batch', '--dry-run']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('batch');
      expect(result.command.dryRun).toBe(true);
    }
  });

  it('不传 --dry-run 时 dryRun 字段为 undefined', () => {
    const result = parseArgs(['batch']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.dryRun).toBeUndefined();
    }
  });

  it('--budget <N> 被正确识别为 batchBudget', () => {
    const result = parseArgs(['batch', '--budget', '5000']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchBudget).toBe(5000);
    }
  });

  it('--on-over-budget 合法值：continue / cheaper-model / skip-enrichment / cancel', () => {
    const vals = ['continue', 'cheaper-model', 'skip-enrichment', 'cancel'] as const;
    for (const v of vals) {
      const r = parseArgs(['batch', '--budget', '100', '--on-over-budget', v]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.command.onOverBudget).toBe(v);
      }
    }
  });

  it('--on-over-budget 非法值返回 invalid_option', () => {
    const result = parseArgs(['batch', '--on-over-budget', 'yolo']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_option');
      expect(result.error.message).toContain('on-over-budget');
    }
  });

  it('--budget 后跟的值不能被视为 positional target', () => {
    const result = parseArgs(['batch', 'src/', '--budget', '5000']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.target).toBe('src/');
      expect(result.command.batchBudget).toBe(5000);
    }
  });

  it('--on-over-budget 后跟的值不能被视为 positional target', () => {
    const result = parseArgs(['batch', '--on-over-budget', 'cancel', 'src/']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.target).toBe('src/');
      expect(result.command.onOverBudget).toBe('cancel');
    }
  });
});
