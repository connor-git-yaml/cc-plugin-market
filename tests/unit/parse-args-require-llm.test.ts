/**
 * Feature 222 — `--require-llm` CLI flag 解析测试
 *
 * why 需要专门覆盖：command-runner 类测试全部直接构造 `CLICommand` 对象绕过 parseArgs，
 * 于是「flag → command 字段」这段线纯靠人工核对——任一子命令分支漏写字段、或重构
 * return 对象时丢掉它，全套测试仍会通过。
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

/** 各消费该 flag 的子命令的最小可解析参数（flag 之外的必填位置参数） */
const SUBCOMMAND_CASES: Array<{ name: string; argv: string[] }> = [
  { name: 'generate', argv: ['generate', 'src/'] },
  { name: 'batch', argv: ['batch'] },
  { name: 'diff', argv: ['diff', 'specs/a.spec.md', 'src/'] },
  { name: 'watch', argv: ['watch'] },
];

describe('parseArgs --require-llm (Feature 222)', () => {
  for (const { name, argv } of SUBCOMMAND_CASES) {
    it(`${name}: 传 --require-llm → requireLlm = true`, () => {
      const result = parseArgs([...argv, '--require-llm']);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command.requireLlm).toBe(true);
      }
    });

    it(`${name}: 不传 --require-llm → requireLlm 为 falsy`, () => {
      const result = parseArgs(argv);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command.requireLlm).toBeFalsy();
      }
    });
  }

  it('flag 位于位置参数之前时不吞掉位置参数', () => {
    const result = parseArgs(['generate', '--require-llm', 'src/']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.target).toBe('src/');
      expect(result.command.requireLlm).toBe(true);
    }
  });

  it('diff 的两个位置参数在 flag 前置时仍正确归位', () => {
    const result = parseArgs(['diff', '--require-llm', 'specs/a.spec.md', 'src/']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.specFile).toBe('specs/a.spec.md');
      expect(result.command.target).toBe('src/');
      expect(result.command.requireLlm).toBe(true);
    }
  });
});
