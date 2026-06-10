/**
 * Feature 176 — 预注册一致性校验单测（tasks T-A3；FR-A-002b 防 falsification 规避）。
 */
import { describe, expect, it } from 'vitest';
import {
  computeTaskSetHash,
  checkPreregistration,
  parsePreregistration,
  freezeBlock,
} from '../../scripts/lib/preregistration-check.mjs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('computeTaskSetHash', () => {
  it('顺序无关', () => {
    expect(computeTaskSetHash(['b', 'a', 'c'])).toBe(computeTaskSetHash(['c', 'b', 'a']));
  });
  it('去重', () => {
    expect(computeTaskSetHash(['a', 'a', 'b'])).toBe(computeTaskSetHash(['a', 'b']));
  });
  it('不同集合不同 hash', () => {
    expect(computeTaskSetHash(['a', 'b'])).not.toBe(computeTaskSetHash(['a', 'b', 'c']));
  });
});

describe('checkPreregistration', () => {
  function writePrereg(dir: string, ids: string[], frozen: boolean) {
    const hash = computeTaskSetHash(ids);
    const p = path.join(dir, 'preregistration.md');
    fs.writeFileSync(
      p,
      `---\nfrozen: ${frozen}\ntaskSetHash: ${hash}\ntaskIds: [${ids.join(', ')}]\n---\n# prereg\n`,
    );
    return p;
  }

  it('task 集一致 → ok', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-prereg-'));
    const p = writePrereg(dir, ['t1', 't2', 't3'], true);
    expect(checkPreregistration(['t3', 't1', 't2'], p).ok).toBe(true);
  });

  it('task 集不符（跑后换 task）→ hard-fail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-prereg-'));
    const p = writePrereg(dir, ['t1', 't2', 't3'], true);
    const r = checkPreregistration(['t1', 't2', 'tX'], p);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不符');
  });

  it('未冻结 → fail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-prereg-'));
    const p = writePrereg(dir, ['t1'], false);
    expect(checkPreregistration(['t1'], p).ok).toBe(false);
  });

  it('文件不存在 → fail', () => {
    expect(checkPreregistration(['t1'], '/nonexistent/prereg.md').ok).toBe(false);
  });
});

describe('freezeBlock', () => {
  it('产出 frozen=true + 排序 taskIds + hash', () => {
    const b = freezeBlock(['t2', 't1'], { seed: 176 });
    expect(b.frozen).toBe(true);
    expect(b.taskIds).toEqual(['t1', 't2']);
    expect(b.taskSetHash).toBe(computeTaskSetHash(['t1', 't2']));
    expect(b.count).toBe(2);
  });
});

describe('freeze-preregistration 脚本（runbook 4c 自动化）', async () => {
  const { renderFrozenPrereg, listFixtureTaskIds } = await import('../../scripts/freeze-preregistration.mjs');

  it('渲染→解析→校验 round-trip（多行 taskIds 列表）', () => {
    const original = '---\nfrozen: false\ntaskSetHash: TBD\n---\n\n# 正文保留\n不变量段落。\n';
    const block = freezeBlock(['SWE-V002-b', 'SWE-V001-a'], { seed: 176 });
    const next = renderFrozenPrereg(original, block, 'abc123def456');
    // 正文保留
    expect(next).toContain('# 正文保留');
    // 解析回来与冻结块一致
    const parsed = parsePreregistration(next);
    expect(parsed.frozen).toBe(true);
    expect(parsed.taskIds).toEqual(['SWE-V001-a', 'SWE-V002-b']);
    expect(parsed.hash).toBe(block.taskSetHash);
    // checkPreregistration 闭环
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-freeze-'));
    const p = path.join(dir, 'preregistration.md');
    fs.writeFileSync(p, next);
    expect(checkPreregistration(['SWE-V002-b', 'SWE-V001-a'], p).ok).toBe(true);
    expect(checkPreregistration(['SWE-V001-a', 'tampered'], p).ok).toBe(false);
  });

  it('listFixtureTaskIds 过滤 _ 前缀与非 json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-fx-'));
    fs.writeFileSync(path.join(dir, 'SWE-V001-a.json'), '{}');
    fs.writeFileSync(path.join(dir, 'SWE-V001-a.goldpatch.diff'), '');
    fs.writeFileSync(path.join(dir, '_DEGRADATION_NOTE.md'), '');
    expect(listFixtureTaskIds(dir)).toEqual(['SWE-V001-a']);
  });
});
