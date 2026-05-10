/**
 * Feature 162 Phase B2 (C-4 修复) — 共享 judge prompt 一致性测试
 *
 * 验证 calibration runner 与生产 jury 调用产生**完全相同**的 adversarial prompt。
 *
 * 设计：
 *   - 两端都从 scripts/lib/judge-prompt-builder.mjs 导入 buildAdversarialPrompt
 *   - 此外 eval-judge-jury.mjs 重新 export 同名符号（向后兼容）
 *   - 测试同输入下两个 export 产出 byte-identical
 *
 * 防护意图：
 *   - 杜绝 calibration 通过的 prompt 与生产实跑 prompt 漂移导致 calibration 失效
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface SharedModule {
  buildAdversarialPrompt: (input: { taskPrompt: string; diff: string }) => string;
}
interface JuryModule {
  buildAdversarialPrompt: (input: { taskPrompt: string; diff: string }) => string;
}

async function loadShared(): Promise<SharedModule> {
  const url = pathToFileURL(resolve('scripts/lib/judge-prompt-builder.mjs')).href;
  return (await import(url)) as SharedModule;
}

async function loadJury(): Promise<JuryModule> {
  const url = pathToFileURL(resolve('scripts/eval-judge-jury.mjs')).href;
  return (await import(url)) as JuryModule;
}

describe('judge-prompt-builder shared (Feature 162 C-4)', () => {
  it('shared module 与 eval-judge-jury 导出的 buildAdversarialPrompt 字符串完全一致', async () => {
    const shared = await loadShared();
    const jury = await loadJury();
    const input = { taskPrompt: 'add tanh activation', diff: '+def tanh(x):\n+    return ...' };
    const a = shared.buildAdversarialPrompt(input);
    const b = jury.buildAdversarialPrompt(input);
    expect(a).toBe(b);
  });

  it('shared 与 jury 导出指向同一函数引用（避免分支拷贝）', async () => {
    const shared = await loadShared();
    const jury = await loadJury();
    expect(jury.buildAdversarialPrompt).toBe(shared.buildAdversarialPrompt);
  });

  it('snapshot：prompt 关键 anchor 仍存在（防 prompt 被无意改动）', async () => {
    const shared = await loadShared();
    const p = shared.buildAdversarialPrompt({ taskPrompt: 'TASK', diff: 'DIFF' });
    expect(p).toMatch(/严格的代码评审者/);
    expect(p).toMatch(/匿名化/);
    expect(p).toContain('TASK');
    expect(p).toContain('DIFF');
    expect(p).toContain('"score"');
    expect(p).toContain('"rationale"');
    expect(p).toContain('"issues"');
    expect(p).toMatch(/找出.*至少 2 个.*问题/);
  });
});
