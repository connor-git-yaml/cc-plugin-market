/**
 * Feature 187 — experiment manifest 参数化单测（spec FR-006）。
 *
 * 去 F176 焊死的 model/output-format/cleanup/repeat/skipJury/quotaCheckInterval；
 * manifest 未提供字段保留默认（向后兼容）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadExperimentManifest, MANIFEST_DEFAULTS, buildRunMatrix } from '../../scripts/swe-bench-verified-cohort-batch.mjs';

describe('loadExperimentManifest（FR-006）', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f187-mf-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('无 manifest → 全默认', () => {
    expect(loadExperimentManifest(null)).toEqual(MANIFEST_DEFAULTS);
  });

  it('JSON manifest 覆盖字段，未提供的保留默认（向后兼容）', () => {
    const p = path.join(dir, 'm.json');
    fs.writeFileSync(p, JSON.stringify({ repeat: 5, skipJury: true, swebenchOracle: true }));
    const m = loadExperimentManifest(p);
    expect(m.repeat).toBe(5);
    expect(m.skipJury).toBe(true);
    expect(m.swebenchOracle).toBe(true);
    expect(m.model).toBe(MANIFEST_DEFAULTS.model); // 未提供 → 默认
    expect(m.cleanup).toBe('on-success');
  });

  it('YAML manifest（顶层 key: value + 注释）解析', () => {
    const p = path.join(dir, 'm.yaml');
    fs.writeFileSync(p, '# experiment\nrepeat: 3   # 每 task 跑 3 次\ncleanup: never\nswebenchOracle: true\n');
    const m = loadExperimentManifest(p);
    expect(m.repeat).toBe(3);
    expect(m.cleanup).toBe('never');
    expect(m.swebenchOracle).toBe(true);
  });

  it('manifest 文件不存在 → throw', () => {
    expect(() => loadExperimentManifest(path.join(dir, 'nope.json'))).toThrow(/不存在/);
  });
});

describe('buildRunMatrix repeat 参数化（FR-006）', () => {
  const taskIds = ['T1', 'T2'];
  it('repeatOverride=null → mode 默认（full=3）', () => {
    const m = buildRunMatrix('full', taskIds, null, null);
    const perTask = m.filter((r: { taskId: string }) => r.taskId === 'T1');
    // 5 cohort × 3 repeat
    expect(perTask.length).toBe(5 * 3);
  });

  it('repeatOverride=5 → 覆盖（每 cohort 5 次）', () => {
    const m = buildRunMatrix('full', taskIds, null, 5);
    const perTaskCohort = m.filter((r: { taskId: string; cohort: string }) => r.taskId === 'T1' && r.cohort === 'baseline-claude');
    expect(perTaskCohort.length).toBe(5);
  });
});
