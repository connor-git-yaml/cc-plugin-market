/**
 * Feature 176 — batch 编排器单测（tasks T-E1 [sandbox] 部分）。
 * 真实跑批（smoke/full）是 host artifact（交接合同 C-3），此处只测纯逻辑：
 * run 矩阵 / oracle 三分类 / spike gate 读取 / resume 状态闭环 / cohort 映射。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseArgs,
  buildRunMatrix,
  classifyLegacyOracle,
  readOracleResult,
  readSpikeStatus,
  computePreregGitState,
  COHORT_TO_TOOL,
} from '../../scripts/swe-bench-verified-cohort-batch.mjs';
import { COHORT_IDS } from '../../scripts/lib/cohort-aggregate.mjs';
import { SUPPORTED_TOOLS } from '../../scripts/eval-task-runner.mjs';
import { classifyRuns, writeRunStarted, writeRunFinalizedSuccess, writeRunFinalizedFailed } from '../../scripts/lib/eval-quota-store.mjs';

describe('parseArgs', () => {
  it('--smoke 默认 skip jury；--full 默认跑 jury', () => {
    expect(parseArgs(['--smoke']).skipJury).toBe(true);
    expect(parseArgs(['--full']).skipJury).toBe(false);
  });
  it('缺 mode / 非法 on-quota 抛错', () => {
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(['--full', '--on-quota', 'ask'])).toThrow();
  });
  it('默认 on-quota=pause（非交互可无人值守）', () => {
    expect(parseArgs(['--full']).onQuota).toBe('pause');
  });
});

describe('buildRunMatrix', () => {
  const tasks = ['SWE-V001', 'SWE-V002'];
  it('smoke = 5 cohort × 1 task × 1', () => {
    const m = buildRunMatrix('smoke', tasks);
    expect(m.length).toBe(5);
    expect(new Set(m.map((x) => x.cohort)).size).toBe(5);
    expect(new Set(m.map((x) => x.taskId))).toEqual(new Set(['SWE-V001']));
  });
  it('full = task × 5 cohort × 3', () => {
    const m = buildRunMatrix('full', tasks);
    expect(m.length).toBe(2 * 5 * 3);
    expect(m.filter((x) => x.repeatIndex === 3).length).toBe(10);
  });
  it('无 task 抛错', () => {
    expect(() => buildRunMatrix('full', [])).toThrow();
  });
});

describe('classifyLegacyOracle（FR-A-001b 三分类）', () => {
  it('passed=true → pass', () => {
    expect(classifyLegacyOracle({ passed: true, details: [] })).toBe('pass');
  });
  it('正常测试失败（exit 1）→ fail', () => {
    expect(classifyLegacyOracle({ passed: false, details: [{ exitCode: 1 }] })).toBe('fail');
  });
  it('全部 check 是环境信号（exit 127 命令不存在）→ unavailable（剔除分母不算 fail）', () => {
    expect(classifyLegacyOracle({ passed: false, details: [{ exitCode: 127 }, { exitCode: 126 }] })).toBe('unavailable');
  });
  it('部分环境信号 + 部分真实失败 → fail（保守，不轻易剔除）', () => {
    expect(classifyLegacyOracle({ passed: false, details: [{ exitCode: 127 }, { exitCode: 1 }] })).toBe('fail');
  });
  it('全 timedOut → unavailable', () => {
    expect(classifyLegacyOracle({ passed: false, details: [{ exitCode: null, timedOut: true }] })).toBe('unavailable');
  });
  it('oracleResult 缺失 → unavailable', () => {
    expect(classifyLegacyOracle(null)).toBe('unavailable');
  });

  it('details 是 JSON 字符串（assembleTaskFixture 实际落盘形态）→ 正确解析分类', () => {
    // host smoke 实测：fixture.taskExecution.primaryOracle.details 是 stringify 后的字符串
    expect(classifyLegacyOracle({ passed: false, details: JSON.stringify([{ exitCode: 127 }]) })).toBe('unavailable');
    expect(classifyLegacyOracle({ passed: false, details: JSON.stringify([{ exitCode: 1 }]) })).toBe('fail');
    expect(classifyLegacyOracle({ passed: false, details: '{bad json' })).toBe('fail'); // 解析失败保守 fail
  });
});

describe('readOracleResult（权威字段路径 — host smoke 实测修正）', () => {
  it('优先 taskExecution.primaryOracle（assembleTaskFixture 实际位置）', () => {
    const fx = { taskExecution: { primaryOracle: { passed: true } } };
    expect(readOracleResult(fx)?.passed).toBe(true);
  });
  it('回退 oracleResult 路径 + 全缺 → null', () => {
    expect(readOracleResult({ oracleResult: { passed: false } })?.passed).toBe(false);
    expect(readOracleResult({})).toBeNull();
  });
});

describe('readSpikeStatus（FR-A-007b gate 输入）', () => {
  it('解析 frontmatter status', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-spike-'));
    const p = path.join(dir, 'spike-result.md');
    fs.writeFileSync(p, '---\nfeature: 176\nstatus: PASS_SUBAGENT\n---\n# x\n');
    expect(readSpikeStatus(p)).toBe('PASS_SUBAGENT');
  });
  it('文件缺失 → null（gate 拒绝）', () => {
    expect(readSpikeStatus('/nonexistent/spike.md')).toBeNull();
  });
});

describe('COHORT_TO_TOOL 映射完整性', () => {
  it('5 个 cohort 全部映射到 SUPPORTED_TOOLS', () => {
    for (const cohort of COHORT_IDS) {
      const tool = COHORT_TO_TOOL[cohort];
      expect(tool, `cohort ${cohort} 缺映射`).toBeTruthy();
      expect(SUPPORTED_TOOLS).toContain(tool);
    }
  });
  it('cohort1=control（裸 claude）/ cohort3=spec-driver-spectra-mcp', () => {
    expect(COHORT_TO_TOOL['baseline-claude']).toBe('control');
    expect(COHORT_TO_TOOL['spec-driver-spectra-mcp']).toBe('spec-driver-spectra-mcp');
  });
});

describe('resume 状态闭环（quota-store run-*.json 合同）', () => {
  it('writeRunFinalizedSuccess 后 classifyRuns.finalized 含该 id；failed 不在 finalized', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-state-'));
    const okId = 'SWE-V001__baseline-claude__r1';
    const badId = 'SWE-V001__GStack__r1';
    writeRunStarted({ runFilePath: path.join(dir, `run-${okId}.json`), runId: okId });
    writeRunFinalizedSuccess({ runFilePath: path.join(dir, `run-${okId}.json`), runId: okId, startedAt: new Date().toISOString(), payload: { oracleState: 'pass' } });
    writeRunStarted({ runFilePath: path.join(dir, `run-${badId}.json`), runId: badId });
    writeRunFinalizedFailed({ runFilePath: path.join(dir, `run-${badId}.json`), runId: badId, startedAt: new Date().toISOString(), errorPhase: 'run', error: 'boom' });

    const cls = classifyRuns({ runDir: dir });
    expect(cls.finalized.map((f: any) => f.id)).toContain(okId);
    expect(cls.finalized.map((f: any) => f.id)).not.toContain(badId);
    expect(cls.failedFinalized.map((f: any) => f.id)).toContain(badId); // failed 可重跑
  });
});

// ───────────────────────────────────────────────────────────
// F197 W3：computePreregGitState 纯函数（注入 fake gitRun，覆盖 clean/dirty/drift）
// ───────────────────────────────────────────────────────────

describe('computePreregGitState — git 外锚状态（注入 fake gitRun）', () => {
  const base = { projectRoot: '/repo', preregRel: 'specs/176/prereg.md', frozenGitCommit: '55696ab' };

  it('worktree clean + 代码无漂移 → trackedClean=true, codeMatchesFrozen=true', () => {
    const gitRun = (args: string[]) => {
      if (args.includes('--quiet')) return { status: 0, stdout: '' };
      return { status: 0, stdout: '' }; // drift diff 空
    };
    const r = computePreregGitState({ ...base, gitRun });
    expect(r.trackedClean).toBe(true);
    expect(r.codeMatchesFrozen).toBe(true);
  });

  it('worktree dirty（diff --quiet exit≠0）→ trackedClean=false', () => {
    const gitRun = (args: string[]) => {
      if (args.includes('--quiet')) return { status: 1, stdout: '' };
      return { status: 0, stdout: '' };
    };
    const r = computePreregGitState({ ...base, gitRun });
    expect(r.trackedClean).toBe(false);
  });

  it('代码自冻结后漂移（drift diff 非空）→ codeMatchesFrozen=false', () => {
    const gitRun = (args: string[]) => {
      if (args.includes('--quiet')) return { status: 0, stdout: '' };
      return { status: 0, stdout: 'diff --git a/x b/x\n+changed' };
    };
    const r = computePreregGitState({ ...base, gitRun });
    expect(r.codeMatchesFrozen).toBe(false);
  });

  it('W-3：drift diff git 报错（exit≠0，含 frozen commit 不存在）→ codeMatchesFrozen=false（不因 stdout 空误放行）', () => {
    const gitRun = (args: string[]) => {
      if (args.includes('--quiet')) return { status: 0, stdout: '' };
      return { status: 128, stdout: '' }; // git 报错，stdout 空
    };
    const r = computePreregGitState({ ...base, gitRun });
    expect(r.codeMatchesFrozen).toBe(false);
  });

  it('无 frozenGitCommit → codeMatchesFrozen=true（无锚可比，仅靠 trackedClean）', () => {
    const gitRun = (args: string[]) => ({ status: 0, stdout: '' });
    const r = computePreregGitState({ ...base, frozenGitCommit: null, gitRun });
    expect(r.codeMatchesFrozen).toBe(true);
  });
});
