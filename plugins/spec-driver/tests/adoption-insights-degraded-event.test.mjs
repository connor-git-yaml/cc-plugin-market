/**
 * adoption-insights-degraded-event.test.mjs
 * Feature 211 — compliant-reset 语义下的消费方去重（codex 审查 W-1）
 *
 * 背景：211 的 compliant-reset 使同一 session 后续再次降级会重写 workflow-run-summary
 * 终态事件——同一 (workflowId, runId) 可产生多条终态。adoption 聚合若对每条 summary
 * 直接计数，同一 run 会被重复计入 totalRuns。本用例断言聚合层按 (workflowId, runId)
 * 去重，取时间最晚的一条作为该 run 的最终 result，run 计数按唯一 runId 计。
 *
 * 运行: node --test plugins/spec-driver/tests/adoption-insights-degraded-event.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateAdoptionInsights } from '../scripts/generate-adoption-insights.mjs';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adoption-insights-degraded-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeRunLog(lines) {
  const runsDir = path.join(tmp, '.specify', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, '2026-07.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function readReport(result) {
  return JSON.parse(fs.readFileSync(path.join(tmp, result.jsonPath), 'utf8'));
}

describe('generate-adoption-insights: 按 (workflowId, runId) 去重（Feature 211）', () => {
  it('同 runId 的多条终态事件只计一次 run（非重复计数）', () => {
    writeRunLog([
      // 同一会话第一轮阻断周期收口 → 终态 failed（较早）
      { schemaVersion: 1, eventType: 'workflow-run-summary', workflowId: 'spec-driver-fix', runId: 'r1', result: 'failed', recordedAt: '2026-07-09T12:00:00.000Z' },
      // compliant-reset 后同一 runId 第二轮降级重写终态 failed（较晚）
      { schemaVersion: 1, eventType: 'workflow-run-summary', workflowId: 'spec-driver-fix', runId: 'r1', result: 'failed', recordedAt: '2026-07-09T12:05:00.000Z' },
      // 另一个真实 run
      { schemaVersion: 1, eventType: 'workflow-run-summary', workflowId: 'spec-driver-fix', runId: 'r2', result: 'success', recordedAt: '2026-07-09T12:10:00.000Z' },
    ]);
    const result = generateAdoptionInsights({ projectRoot: tmp });

    // 唯一 runId 数 = 2（r1 去重 + r2），而非按事件条数计的 3
    assert.equal(result.totalRuns, 2, '同 runId 重复终态事件应去重，totalRuns 计唯一 runId');

    const report = readReport(result);
    assert.equal(report.stats.validRunCount, 2, 'validRunCount 应按唯一 runId 计');
    const fixWorkflow = report.workflowSummaries.find((w) => w.id === 'spec-driver-fix');
    assert.ok(fixWorkflow, '应存在 spec-driver-fix workflow 摘要');
    assert.equal(fixWorkflow.totalRuns, 2, 'workflow 级 totalRuns 亦去重');
    assert.equal(fixWorkflow.failedRuns, 1, 'r1 去重后只计 1 次 failed');
    assert.equal(fixWorkflow.successRuns, 1, 'r2 计 1 次 success');
  });

  it('重复 runId 取时间最晚一条的 result（latest-wins）', () => {
    writeRunLog([
      // 较早：中间某轮以 success 结束（会被更晚的终态覆盖）
      { schemaVersion: 1, eventType: 'workflow-run-summary', workflowId: 'spec-driver-fix', runId: 'r9', result: 'success', recordedAt: '2026-07-09T12:00:00.000Z' },
      // 较晚：compliant-reset 后同 runId 再次降级，终态为 failed
      { schemaVersion: 1, eventType: 'workflow-run-summary', workflowId: 'spec-driver-fix', runId: 'r9', result: 'failed', recordedAt: '2026-07-09T12:05:00.000Z' },
    ]);
    const result = generateAdoptionInsights({ projectRoot: tmp });

    assert.equal(result.totalRuns, 1, '同 runId 去重后只计 1 次 run');
    const report = readReport(result);
    const fixWorkflow = report.workflowSummaries.find((w) => w.id === 'spec-driver-fix');
    assert.ok(fixWorkflow, '应存在 spec-driver-fix workflow 摘要');
    assert.equal(fixWorkflow.failedRuns, 1, '取最晚一条 result=failed');
    assert.equal(fixWorkflow.successRuns, 0, '较早的 success 被更晚终态覆盖，不计入');
  });
});
