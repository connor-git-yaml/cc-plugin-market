/**
 * Feature 222 回归防线：baseline 采集链路的"严格 + 全量"不变量。
 *
 * why 需要专门锁定：CLI 零认证已从硬退改为降级继续并 exit 0，baseline 脚本若只靠退出码
 * 判定成功，就会把 AST-only 产物当作 LLM baseline 收录；而只加 --require-llm 不加 --full 时，
 * 上一次失败写下的降级产物会被增量 cache 跳过（记为 skipped 而非 degraded），严格校验读到
 * 空降级列表后照样 exit 0。两个 flag 必须成对出现在真实调用路径，且不得出现在 dry-run。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildDryRunBatchArgs, buildRealBatchArgs } from '../../scripts/baseline-collect.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('baseline-collect 参数构造', () => {
  const commonArgs = {
    cliPath: '/tmp/dist/cli/index.js',
    targetPath: '/tmp/target',
    mode: 'full',
    outputDir: '/tmp/out',
  };

  it('真实 LLM 调用必须同时携带 --full 与 --require-llm', () => {
    const args = buildRealBatchArgs(commonArgs);
    expect(args).toContain('--full');
    expect(args).toContain('--require-llm');
    // 目标与输出目录仍需正确透传，避免只满足 flag 断言的空壳实现
    expect(args).toContain(commonArgs.targetPath);
    expect(args.slice(args.indexOf('--output-dir'))).toEqual(['--output-dir', commonArgs.outputDir]);
  });

  it('dry-run 调用不得携带 --require-llm（零 LLM 路径，严格校验恒为假通过）', () => {
    const args = buildDryRunBatchArgs(commonArgs);
    expect(args).toContain('--dry-run');
    expect(args).not.toContain('--require-llm');
  });
});

describe('build-swe-l-graphs.sh 参数构造', () => {
  const script = readFileSync(
    resolve(PROJECT_ROOT, 'scripts/baselines/build-swe-l-graphs.sh'),
    'utf-8',
  );

  it('真实 LLM 调用的 flag 常量同时含 --full 与 --require-llm 且被实际展开', () => {
    expect(script).toMatch(/^REAL_LLM_BATCH_FLAGS=\((?=.*--full)(?=.*--require-llm).*\)$/m);
    expect(script).toContain('"${REAL_LLM_BATCH_FLAGS[@]}"');
  });

  it('dry-run 调用行不得携带 --full / --require-llm', () => {
    const dryRunLine = script.split('\n').find((line) => line.includes('--dry-run'));
    expect(dryRunLine).toBeDefined();
    expect(dryRunLine).not.toContain('--require-llm');
    expect(dryRunLine).not.toMatch(/--full\b/);
  });
});
