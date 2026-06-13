/**
 * Feature 187 — phaseReached marker 解析纯函数单测（Codex C-3/C-6）。
 *
 * marker 文本取自 Phase 0 真实 run_instance.log（见 verification/phase0-gate-result.md）。
 * 核心：① 每个 marker 推进到期望 phase；② 阶段单调前进（取最远阶段，不回退）；
 * ③ 无 marker 但有 pytest/OOM 证据 → test_exec（evidence-based，防烂 patch 洗成 infra）；
 * ④ 真无证据 → unknown + markerMissing 标记（强告警，不静默累积）。
 */
import { describe, expect, it } from 'vitest';
import { parsePhaseFromLog } from '../../scripts/lib/phase-markers.mjs';

describe('parsePhaseFromLog — 真实 marker → phase', () => {
  it('空 log → image（拉取/构建中，最早阶段）', () => {
    expect(parsePhaseFromLog('').phaseReached).toBe('image');
  });

  it('Creating container → container_start', () => {
    expect(parsePhaseFromLog('INFO - Creating container for pytest-dev__pytest-11143...').phaseReached).toBe('container_start');
  });

  it('Container started → container_start', () => {
    expect(parsePhaseFromLog('INFO - Container for x started: abc123').phaseReached).toBe('container_start');
  });

  it('>>>>> Applied Patch → patch_apply', () => {
    const log = 'Creating container for x...\nContainer for x started: a\n>>>>> Applied Patch:\nApplied patch src/foo.py cleanly.';
    expect(parsePhaseFromLog(log).phaseReached).toBe('patch_apply');
  });

  it('Eval script + Test runtime → test_exec', () => {
    const log = 'Container for x started: a\n>>>>> Applied Patch:\nEval script for x written ... copying to container...\nTest runtime: 8.96 seconds';
    expect(parsePhaseFromLog(log).phaseReached).toBe('test_exec');
  });

  it('Grading answer → report_parse', () => {
    const log = 'Test runtime: 8.96 seconds\nTest output for x written to ...\nGrading answer for x...';
    expect(parsePhaseFromLog(log).phaseReached).toBe('report_parse');
  });

  it('Result resolved → done（最远阶段）', () => {
    const log = 'Grading answer for x...\nReport for x: resolved: True\nResult for x: resolved: True';
    expect(parsePhaseFromLog(log).phaseReached).toBe('done');
  });
});

describe('parsePhaseFromLog — 单调前进（不回退）', () => {
  it('多阶段 marker 混杂 → 取最远阶段', () => {
    // 即使 image/container marker 在后面又出现，也取已达的最远 done
    const log = 'Creating container for x\nApplied Patch:\nTest runtime: 1s\nGrading answer for x\nResult for x: resolved: False\nCreating container for x';
    expect(parsePhaseFromLog(log).phaseReached).toBe('done');
  });
});

describe('parsePhaseFromLog — evidence-based（Codex C-3 防反向污染）', () => {
  it('无 phase marker 但有 pytest 证据 → test_exec', () => {
    const r = parsePhaseFromLog('============ test session starts ============\nfoo.py::test_bar PASSED');
    expect(r.phaseReached).toBe('test_exec');
    expect(r.phaseEvidence).toMatch(/pytest|PASSED|session/i);
  });

  it('无 marker 但有 OOMKilled 证据 → test_exec（候选爆内存，不洗成 infra）', () => {
    const r = parsePhaseFromLog('some container output\nOOMKilled');
    expect(r.phaseReached).toBe('test_exec');
  });

  it('FAILED 证据 → test_exec', () => {
    expect(parsePhaseFromLog('testing/test_x.py::test_y FAILED').phaseReached).toBe('test_exec');
  });
});

describe('parsePhaseFromLog — 真无证据 → unknown + 告警标记', () => {
  it('完全无信息的非空 log → unknown + markerMissing', () => {
    const r = parsePhaseFromLog('garbled non-informative bytes \x00\x01');
    expect(r.phaseReached).toBe('unknown');
    expect(r.markerMissing).toBe(true);
  });

  it('正常匹配到 marker 时 markerMissing=false', () => {
    expect(parsePhaseFromLog('Creating container for x').markerMissing).toBe(false);
  });
});
