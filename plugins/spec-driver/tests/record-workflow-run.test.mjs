/**
 * record-workflow-run.test.mjs
 * Feature 208 — FR-014 向后兼容回归 + complianceVerdict 新增字段结构断言
 *
 * 硬性契约（contracts/record-workflow-run-fields.md）：
 *   1. 未传 --compliance-* / options.complianceVerdict → 事件 JSON 不含 complianceVerdict 键（字节级，非 null）。
 *   2. 现有 5 个 SKILL 调用方（fix/story/implement/doc/resume）参数组合行为逐字不变。
 *   3. 显式传参时 complianceVerdict 字段结构符合契约。
 *
 * 运行: node --test plugins/spec-driver/tests/record-workflow-run.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordWorkflowRun } from '../scripts/record-workflow-run.mjs';

const CLI = fileURLToPath(new URL('../scripts/record-workflow-run.mjs', import.meta.url));

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'record-run-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readSingleEvent() {
  const runsDir = path.join(tmp, '.specify', 'runs');
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  const lines = fs.readFileSync(path.join(runsDir, files[0]), 'utf8').split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 1);
  return { raw: lines[0], parsed: JSON.parse(lines[0]) };
}

function runCliArgs(args) {
  const res = spawnSync('node', [CLI, '--project-root', tmp, ...args], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
}

// ────────────────────────────────────────
// FR-014 向后兼容：未传参 → 不含 complianceVerdict 键（字节级）
// ────────────────────────────────────────

describe('向后兼容：未传 complianceVerdict 时事件不含该键', () => {
  it('编程调用不传 complianceVerdict → 事件无 complianceVerdict 键', () => {
    recordWorkflowRun({
      projectRoot: tmp, workflowId: 'spec-driver-fix', runId: 'r1', result: 'success',
      completedPhases: ['diagnose', 'plan', 'implement', 'verify'],
    });
    const { raw, parsed } = readSingleEvent();
    assert.equal(raw.includes('complianceVerdict'), false);
    assert.equal('complianceVerdict' in parsed, false);
    assert.equal(parsed.eventType, 'workflow-run-summary');
  });

  it('显式传 complianceVerdict:null → 仍不含该键', () => {
    recordWorkflowRun({
      projectRoot: tmp, workflowId: 'spec-driver-fix', runId: 'r2', result: 'success',
      complianceVerdict: null,
    });
    const { raw } = readSingleEvent();
    assert.equal(raw.includes('complianceVerdict'), false);
  });

  // 5 个 SKILL 调用方参数组合逐字重放，断言事件字节级不含新键
  const CALLERS = [
    { id: 'spec-driver-fix', phases: 'diagnose,plan,implement,verify' },
    { id: 'spec-driver-story', phases: 'specify,clarify,plan,tasks,implement,verify' },
    { id: 'spec-driver-implement', phases: 'intake,plan-review,tasks,implement,verify,closure' },
    { id: 'spec-driver-doc', phases: 'scan,design,generate,verify' },
    { id: 'spec-driver-resume', phases: 'implement,verify' },
  ];
  for (const caller of CALLERS) {
    it(`${caller.id} 调用方参数组合 → 无 complianceVerdict 键`, () => {
      runCliArgs([
        '--workflow-id', caller.id,
        '--run-id', 'branch-x',
        '--result', 'success',
        '--completed-phases', caller.phases,
        '--artifact', 'specs/x/fix-report.md',
      ]);
      const { raw, parsed } = readSingleEvent();
      assert.equal(raw.includes('complianceVerdict'), false);
      assert.equal(parsed.workflowId, caller.id);
      assert.deepEqual(parsed.completedPhases, caller.phases.split(','));
    });
  }
});

// ────────────────────────────────────────
// 新增能力：显式传参时 complianceVerdict 字段结构
// ────────────────────────────────────────

describe('新增能力：complianceVerdict 字段', () => {
  it('编程传 complianceVerdict → 事件含结构化字段', () => {
    recordWorkflowRun({
      projectRoot: tmp, workflowId: 'spec-driver-fix', runId: 'r3', result: 'failed',
      warnings: ['[GATE-DEGRADED] 降级放行'],
      complianceVerdict: {
        closureForm: 'undetermined', compliant: false, missing: ['fix-report.md'],
        degraded: true, blockCount: 2,
      },
    });
    const { parsed } = readSingleEvent();
    assert.deepEqual(parsed.complianceVerdict, {
      closureForm: 'undetermined', compliant: false, missing: ['fix-report.md'],
      degraded: true, blockCount: 2,
    });
    assert.equal(parsed.result, 'failed');
  });

  it('CLI --compliance-* flags → 事件含结构化字段', () => {
    runCliArgs([
      '--workflow-id', 'spec-driver-fix', '--run-id', 'r4', '--result', 'failed',
      '--compliance-closure-form', 'undetermined',
      '--compliance-compliant', 'false',
      '--compliance-missing', 'fix-report.md,delegation:implement',
      '--compliance-degraded', 'true',
      '--compliance-block-count', '2',
    ]);
    const { parsed } = readSingleEvent();
    assert.equal(parsed.complianceVerdict.closureForm, 'undetermined');
    assert.equal(parsed.complianceVerdict.compliant, false);
    assert.deepEqual(parsed.complianceVerdict.missing, ['fix-report.md', 'delegation:implement']);
    assert.equal(parsed.complianceVerdict.degraded, true);
    assert.equal(parsed.complianceVerdict.blockCount, 2);
  });

  it('部分字段传参 → 仅出现被显式提供的字段', () => {
    recordWorkflowRun({
      projectRoot: tmp, workflowId: 'spec-driver-fix', runId: 'r5', result: 'failed',
      complianceVerdict: { degraded: true },
    });
    const { parsed } = readSingleEvent();
    assert.deepEqual(parsed.complianceVerdict, { degraded: true });
  });

  it('complianceVerdict 为空对象 → 不追加该键', () => {
    recordWorkflowRun({
      projectRoot: tmp, workflowId: 'spec-driver-fix', runId: 'r6', result: 'success',
      complianceVerdict: {},
    });
    const { raw } = readSingleEvent();
    assert.equal(raw.includes('complianceVerdict'), false);
  });
});
