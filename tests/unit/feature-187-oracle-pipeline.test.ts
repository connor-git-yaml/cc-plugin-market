/**
 * Feature 187 — phaseReached 解析 + 三分类全链路集成测试（Codex C-6，默认跑，不依赖 docker）。
 *
 * 用预录 log 夹具喂 parsePhaseFromLog → classifySwebenchResult，验证"打点→分类"真实链路。
 * 这是 C-6 的核心：决策表单测全绿 ≠ 判分对；marker 解析错会在这里被抓到。
 */
import { describe, expect, it } from 'vitest';
import { parsePhaseFromLog } from '../../scripts/lib/phase-markers.mjs';
import { classifySwebenchResult } from '../../scripts/lib/classify-oracle.mjs';

/** 模拟 runner：log → phaseReached → classification（合并打点与分类两层）。 */
function classifyFromLog({ logText, harnessExitCode = null, signal = null, timedOut = false, report = null, pytestExitCode = null }) {
  const { phaseReached, markerMissing } = parsePhaseFromLog(logText);
  const v = classifySwebenchResult({ harnessExitCode, signal, timedOut, phaseReached, logText, report, pytestExitCode });
  return { ...v, phaseReached, markerMissing };
}

describe('oracle pipeline — log → phase → 三分类（C-6 全链路）', () => {
  it('① marker 到 test_exec 后 timedOut → fail/candidate（Q1：候选让测试卡死）', () => {
    const log = [
      'INFO - Creating container for x...',
      'INFO - Container for x started: abc',
      'INFO - >>>>> Applied Patch:',
      'INFO - Eval script for x written ... copying to container...',
      // 测试开跑后被 watchdog 杀（无 Test runtime/Grading）
    ].join('\n');
    const r = classifyFromLog({ logText: log, timedOut: true, signal: 'SIGTERM' });
    expect(r.phaseReached).toBe('test_exec');
    expect(r.classification).toBe('fail');
    expect(r.failureSource).toBe('candidate');
  });

  it('② 无 phase marker 但有 pytest evidence + 失败 → fail/candidate（不洗成 infra）', () => {
    const log = '============ test session starts ============\ntesting/test_x.py::test_y FAILED\n=== short test summary ===';
    const r = classifyFromLog({ logText: log, harnessExitCode: 1 });
    expect(r.phaseReached).toBe('test_exec');
    expect(r.markerMissing).toBe(false); // evidence 兜住了，未触发告警
    expect(r.classification).toBe('fail');
    expect(r.failureSource).toBe('candidate');
  });

  it('③ 无 marker 无 evidence + 失败 → unknown + markerMissing 告警 → error/infra（保守，但暴露）', () => {
    const log = 'totally unrecognizable harness output blob';
    const r = classifyFromLog({ logText: log, harnessExitCode: 1 });
    expect(r.phaseReached).toBe('unknown');
    expect(r.markerMissing).toBe(true); // 触发告警，不静默累积
    expect(r.classification).toBe('error');
    expect(r.failureSource).toBe('infra');
  });

  it('④ image 阶段（空 log）+ timedOut → error/infra（镜像拉取慢，不冤枉候选）', () => {
    const r = classifyFromLog({ logText: '', timedOut: true, signal: 'SIGTERM' });
    expect(r.phaseReached).toBe('image');
    expect(r.classification).toBe('error');
    expect(r.failureSource).toBe('infra');
  });

  it('⑤ 完整成功链路 → pass（正控）', () => {
    const log = [
      'INFO - Creating container for x...',
      'INFO - >>>>> Applied Patch:',
      'INFO - Test runtime: 8.96 seconds',
      'INFO - Grading answer for x...',
      'INFO - Result for x: resolved: True',
    ].join('\n');
    const r = classifyFromLog({ logText: log, harnessExitCode: 0, report: { completed: true, resolved: true } });
    expect(r.phaseReached).toBe('done');
    expect(r.classification).toBe('pass');
  });

  it('⑥ patch apply 失败（test_exec 前）→ error/fixture（数据/输入问题，不算候选 fail）', () => {
    const log = [
      'INFO - Creating container for x...',
      'INFO - Container for x started: abc',
      'INFO - now applying to container...',
      'error: patch failed: src/foo.py:10',
      'error: patch does not apply',
    ].join('\n');
    const r = classifyFromLog({ logText: log, harnessExitCode: 1 });
    expect(r.phaseReached).toBe('patch_apply');
    expect(r.classification).toBe('error');
    expect(r.failureSource).toBe('fixture');
  });
});
