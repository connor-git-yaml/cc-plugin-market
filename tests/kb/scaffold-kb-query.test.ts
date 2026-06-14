/**
 * F191 SC-001/SC-006 — scaffold-kb query CLI：probe / markdown / json / 降级 / 参数校验
 */

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { parseArgs } from '../../src/cli/utils/parse-args.js';
import { runScaffoldKb } from '../../src/cli/commands/scaffold-kb.js';

const ROOT = process.cwd();
const ZH_KB = join(ROOT, 'plugins/demo-kb-zh/kb');

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number | undefined }> {
  const r = parseArgs(args);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  (process.stdout.write as unknown) = (s: string): boolean => {
    chunks.push(String(s));
    return true;
  };
  try {
    await runScaffoldKb(r.command);
  } finally {
    (process.stdout.write as unknown) = orig;
  }
  const exitCode = process.exitCode;
  process.exitCode = prevExit;
  return { stdout: chunks.join(''), exitCode };
}

describe('scaffold-kb query CLI', () => {
  it('--probe 打印能力 sentinel', async () => {
    const { stdout } = await runCli(['scaffold-kb', 'query', '--probe']);
    expect(stdout.trim()).toBe('scaffold-kb-query:1');
  });

  it('markdown 查询命中：含非指令前导 + envelope + 来源', async () => {
    const { stdout, exitCode } = await runCli([
      'scaffold-kb', 'query', '--requirement', '怎么配置坐标轴和提示框', '--vendor-kb', ZH_KB, '--top-k', '3',
    ]);
    expect(exitCode).not.toBe(1);
    expect(stdout).toContain('参考资料');
    expect(stdout).toContain('[KB-EVIDENCE');
    expect(stdout).toMatch(/option-xaxis\.md|option-tooltip\.md/);
  });

  it('json 格式输出结构化结果', async () => {
    const { stdout } = await runCli([
      'scaffold-kb', 'query', '--requirement', '坐标轴', '--vendor-kb', ZH_KB, '--format', 'json',
    ]);
    const parsed = JSON.parse(stdout);
    expect(parsed.query).toBeTruthy();
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
  });

  it('KB 不可用 → 降级（不设 exitCode=1，stdout 空）', async () => {
    const { stdout, exitCode } = await runCli([
      'scaffold-kb', 'query', '--requirement', '坐标轴', '--vendor-kb', '/nonexistent/kb',
    ]);
    expect(exitCode).not.toBe(1); // 降级非错误
    expect(stdout.trim()).toBe('');
  });

  it('缺 --requirement → exitCode 1', async () => {
    const { exitCode } = await runCli(['scaffold-kb', 'query', '--vendor-kb', ZH_KB]);
    expect(exitCode).toBe(1);
  });
});
