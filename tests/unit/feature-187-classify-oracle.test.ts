/**
 * Feature 187 — classifySwebenchResult 穷尽式三分类决策表单测（spec FR-002-a；Codex C-1/C-3）。
 *
 * 表驱动覆盖 spec「Oracle 结果统一合同」14 行决策表 + fallback。核心不变量：
 * - test_exec 阶段前的失败 = infra/fixture → error（剔除分母）
 * - test_exec 阶段中的 timeout/OOM/crash = candidate → fail（计入分母，用户裁决 Q1）
 * - exit 139/SIGSEGV = arm64 仿真伪影 → error/infra（例外，优先级高于 Q1）
 * - 未知组合 fallback：phase>=test_exec→fail，否则 error；绝不静默
 */
import { describe, expect, it } from 'vitest';
import { classifySwebenchResult, classifyRunForRanking } from '../../scripts/lib/classify-oracle.mjs';

// 决策表逐行：[描述, 输入, 期望 classification, 期望 failureSource]
const CASES: Array<[string, Record<string, unknown>, string, string]> = [
  // 行 1：docker daemon 不可用
  ['exit125 docker daemon down', { harnessExitCode: 125, phaseReached: 'image', logText: '' }, 'error', 'infra'],
  // 行 2：命令未找到
  ['exit126 cmd not exec', { harnessExitCode: 126, phaseReached: 'container_start', logText: '' }, 'error', 'infra'],
  ['exit127 cmd not found', { harnessExitCode: 127, phaseReached: 'container_start', logText: '' }, 'error', 'infra'],
  // 行 3：镜像层失败
  ['BuildImageError', { harnessExitCode: 1, phaseReached: 'image', logText: 'swebench BuildImageError: build failed' }, 'error', 'infra'],
  ['ImagePullError', { harnessExitCode: 1, phaseReached: 'image', logText: 'ImagePullError: manifest unknown' }, 'error', 'infra'],
  // 行 4：segfault（arm64/QEMU 伪影）— 即使在 test_exec 也判 infra（优先级高于 Q1 行 8）
  ['exit139 segfault at test_exec', { harnessExitCode: 139, phaseReached: 'test_exec', logText: '' }, 'error', 'infra'],
  ['SIGSEGV signal at test_exec', { harnessExitCode: null, signal: 'SIGSEGV', phaseReached: 'test_exec', logText: '' }, 'error', 'infra'],
  // 行 5：patch apply 失败（test_exec 前）= fixture/输入问题
  ['patch does not apply', { harnessExitCode: 1, phaseReached: 'patch_apply', logText: 'error: patch does not apply' }, 'error', 'fixture'],
  // 行 6：pytest exit 5（未收集到测试）
  ['pytest exit 5 no tests', { harnessExitCode: 1, phaseReached: 'test_exec', pytestExitCode: 5, logText: 'no tests ran' }, 'error', 'fixture'],
  // 行 7：测试开跑前 timeout → infra
  ['timedOut at image phase', { timedOut: true, harnessExitCode: null, signal: 'SIGTERM', phaseReached: 'image', logText: '' }, 'error', 'infra'],
  ['timedOut at patch_apply', { timedOut: true, harnessExitCode: null, signal: 'SIGKILL', phaseReached: 'patch_apply', logText: '' }, 'error', 'infra'],
  // 行 8：测试开跑后 timeout/OOM/crash → candidate fail（Q1 核心）
  ['timedOut at test_exec (Q1)', { timedOut: true, harnessExitCode: null, signal: 'SIGTERM', phaseReached: 'test_exec', logText: '' }, 'fail', 'candidate'],
  ['OOMKilled at test_exec (Q1)', { harnessExitCode: 137, phaseReached: 'test_exec', logText: 'Container OOMKilled' }, 'fail', 'candidate'],
  ['SIGKILL at test_exec (Q1)', { harnessExitCode: null, signal: 'SIGKILL', phaseReached: 'test_exec', logText: '' }, 'fail', 'candidate'],
  // 行 9：真实通过
  ['exit0 resolved=true', { harnessExitCode: 0, phaseReached: 'done', report: { completed: true, resolved: true }, logText: '' }, 'pass', 'none'],
  // 行 10：真实失败（含 passToPass 回归）
  ['exit0 resolved=false', { harnessExitCode: 0, phaseReached: 'done', report: { completed: true, resolved: false }, logText: '' }, 'fail', 'candidate'],
  // 行 11：harness 未正常完成
  ['exit0 completed=false', { harnessExitCode: 0, phaseReached: 'report_parse', report: { completed: false }, logText: '' }, 'error', 'infra'],
  // 行 12：pytest 自身异常 2/3/4
  ['pytest exit 3 internal', { harnessExitCode: 1, phaseReached: 'test_exec', pytestExitCode: 3, logText: '' }, 'error', 'infra'],
  // 行 13：report/log 缺失
  ['report missing', { harnessExitCode: 0, phaseReached: 'done', report: null, logText: '' }, 'error', 'infra'],
  // 行 14 fallback：phase>=test_exec 未知组合 → fail
  ['unknown combo at test_exec', { harnessExitCode: 1, phaseReached: 'test_exec', logText: 'weird unparseable' }, 'fail', 'candidate'],
  // 行 14 fallback：phase<test_exec（含 unknown）未知组合 → error
  ['unknown combo at unknown phase', { harnessExitCode: 1, phaseReached: 'unknown', logText: '' }, 'error', 'infra'],
  // C1 三交叉（F197）：report.completed===true + resolved===true 必须权威优先于 timeout/OOM 启发式，
  // 不被 log 含 "Killed"/"OOMKilled"/exit137 误洗成 fail（排名污染根因）。
  ['C1: resolved=true × log 含 "Killed"', { report: { completed: true, resolved: true }, logText: 'process Killed', phaseReached: 'done' }, 'pass', 'none'],
  ['C1: resolved=true × log 含 "OOMKilled" × exit137', { report: { completed: true, resolved: true }, logText: 'Container OOMKilled', harnessExitCode: 137, phaseReached: 'done' }, 'pass', 'none'],
  ['C1: resolved=true × harnessExitCode=137', { report: { completed: true, resolved: true }, harnessExitCode: 137, phaseReached: 'done', logText: '' }, 'pass', 'none'],
];

describe('classifySwebenchResult — 14 行穷尽决策表', () => {
  for (const [desc, input, expectCls, expectSrc] of CASES) {
    it(`${desc} → ${expectCls}/${expectSrc}`, () => {
      const r = classifySwebenchResult(input);
      expect(r.classification, `classification for ${desc}`).toBe(expectCls);
      expect(r.failureSource, `failureSource for ${desc}`).toBe(expectSrc);
    });
  }

  it('每个结果都带可排查的 reason（fallback 不静默）', () => {
    const r = classifySwebenchResult({ harnessExitCode: 1, phaseReached: 'test_exec', logText: 'x' });
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('C1: report.completed=true × resolved=null → fall through（不被强判 pass）', () => {
    // resolved 非 true/false 时不能用 report 强判 pass，须 fall through 到启发式/fallback。
    const r = classifySwebenchResult({ report: { completed: true, resolved: null }, harnessExitCode: 0, phaseReached: 'done', logText: '' });
    expect(r.classification).not.toBe('pass');
  });

  it('pass 必须同时满足 exit0 + completed + resolved（仅 exit0 不够）', () => {
    // exit0 但 report 缺失 → 不能判 pass
    expect(classifySwebenchResult({ harnessExitCode: 0, phaseReached: 'done', report: null, logText: '' }).classification).not.toBe('pass');
    // exit0 + completed 但 resolved 缺失 → 不能判 pass
    expect(classifySwebenchResult({ harnessExitCode: 0, phaseReached: 'done', report: { completed: true }, logText: '' }).classification).not.toBe('pass');
  });
});

describe('classifyRunForRanking — 排名口径（Codex C-1：error 必须剔除分母）', () => {
  it('pass → true（计入分子）', () => {
    expect(classifyRunForRanking({ classification: 'pass' })).toBe(true);
  });
  it('fail → false（计入分母）', () => {
    expect(classifyRunForRanking({ classification: 'fail' })).toBe(false);
  });
  it('error → null（剔除分母，不污染排名）', () => {
    expect(classifyRunForRanking({ classification: 'error' })).toBeNull();
  });
  it('legacy unavailable → null（向后兼容旧分类值）', () => {
    expect(classifyRunForRanking({ classification: 'unavailable' })).toBeNull();
  });
  it('缺失/未知 → null（保守剔除，不冤枉也不放过）', () => {
    expect(classifyRunForRanking(null)).toBeNull();
    expect(classifyRunForRanking({})).toBeNull();
  });
});
