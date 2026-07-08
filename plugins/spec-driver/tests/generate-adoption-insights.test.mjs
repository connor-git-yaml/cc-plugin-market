/**
 * generate-adoption-insights.test.mjs
 * Feature 208 — 消费方兼容性回归（data-model.md §9，codex plan 审查 W-5）
 *
 * 断言新事件类型 fix-compliance-verdict 与 workflow-run-summary 共存于同一 JSONL 时，
 * 前者被静默 skip（不计入 invalidLineCount、不产生 warning），后者正常计入 adoption 统计。
 *
 * 运行: node --test plugins/spec-driver/tests/generate-adoption-insights.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateAdoptionInsights } from '../scripts/generate-adoption-insights.mjs';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adoption-insights-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeRunLog(lines) {
  const runsDir = path.join(tmp, '.specify', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, '2026-07.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

describe('generate-adoption-insights: fix-compliance-verdict 静默 skip（Feature 208）', () => {
  it('新事件类型不计入 invalidLineCount 且不产生 warning', () => {
    writeRunLog([
      { schemaVersion: 1, eventType: 'workflow-run-summary', workflowId: 'spec-driver-fix', runId: 'r1', result: 'success', finishedAt: '2026-07-09T12:00:00.000Z' },
      { schemaVersion: 1, eventType: 'fix-compliance-verdict', sessionId: 's1', compliant: false, missing: ['fix-report.md'] },
    ]);
    const result = generateAdoptionInsights({ projectRoot: tmp });

    // 返回对象：summary 事件被计入，新事件不污染
    assert.equal(result.totalRuns, 1, 'summary 事件应计入 totalRuns');
    assert.ok(
      !result.warnings.some((w) => w.includes('忽略无效 run event')),
      '不应对 fix-compliance-verdict 产生"忽略无效 run event"warning',
    );

    // 读回生成的 JSON 报告，断言 invalidLineCount 为 0
    const report = JSON.parse(fs.readFileSync(path.join(tmp, result.jsonPath), 'utf8'));
    assert.equal(report.stats.invalidLineCount, 0, 'fix-compliance-verdict 不应计入 invalidLineCount');
  });

  it('真正损坏的行仍计入 invalidLineCount（未误伤既有容错）', () => {
    const runsDir = path.join(tmp, '.specify', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, '2026-07.jsonl'),
      [
        JSON.stringify({ eventType: 'fix-compliance-verdict', sessionId: 's1' }),
        '{ broken json line',
      ].join('\n') + '\n',
    );
    const result = generateAdoptionInsights({ projectRoot: tmp });
    const report = JSON.parse(fs.readFileSync(path.join(tmp, result.jsonPath), 'utf8'));
    assert.equal(report.stats.invalidLineCount, 1, '损坏 JSON 行仍应计入，仅白名单事件豁免');
  });
});
