/**
 * F241 T041 — coverage-gap 聚合器（FR-014 / FR-015 / SC-010 / SC-011 / EC-18 / EC-21 / EC-22 / EC-30）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCoverageGapReport, formatCoverageGapReport } from '../../src/scaffold-kb/coverage-gap.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'covgap-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface RecordInput {
  terms: string[];
  hash: string;
  tool?: string;
  timestamp?: string;
}

function writeRecords(file: string, records: RecordInput[]): void {
  const path = join(dir, file);
  writeFileSync(path, '');
  for (const r of records) {
    appendFileSync(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        timestamp: r.timestamp ?? '2026-07-01T00:00:00.000Z',
        tool: r.tool ?? 'kb_search',
        terms: r.terms,
        normalizedQueryHash: r.hash,
        redactionTags: [],
        resultCount: 0,
        dbPathHash: 'abc',
      })}\n`,
    );
  }
}

describe('coverage-gap — 三状态互不相同（FR-014 / SC-010 / EC-22）', () => {
  it('采集关闭 → collection-disabled，且不读取目录内已有数据', () => {
    writeRecords('nohit-20260701.jsonl', [
      { terms: ['alpha'], hash: 'h1' },
      { terms: ['alpha'], hash: 'h2' },
    ]);
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: false });
    expect(r.status).toBe('collection-disabled');
    expect(r.items).toEqual([]);
    expect(r.totalRecords).toBe(0);
  });

  it('采集开启但无记录 → no-data', () => {
    expect(buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true }).status).toBe('no-data');
  });

  it('目录不存在 → no-data（EC-16，不崩）', () => {
    const r = buildCoverageGapReport({ nohitDir: join(dir, 'nope'), isCollectionEnabled: true });
    expect(r.status).toBe('no-data');
    expect(r.items).toEqual([]);
  });

  it('有记录但无条目达阈值 → no-gap-above-threshold', () => {
    writeRecords('nohit-20260701.jsonl', [{ terms: ['alpha'], hash: 'h1' }]);
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.status).toBe('no-gap-above-threshold');
    expect(r.items).toEqual([]);
    expect(r.totalRecords).toBe(1);
  });

  it('三态 items 均空但 status 互不相同（禁止空 backlog 冒充无缺口）', () => {
    const disabled = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: false });
    const noData = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    writeRecords('nohit-20260701.jsonl', [{ terms: ['alpha'], hash: 'h1' }]);
    const noGap = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    const statuses = [disabled.status, noData.status, noGap.status];
    expect(statuses).toEqual(['collection-disabled', 'no-data', 'no-gap-above-threshold']);
    expect(new Set(statuses).size).toBe(3);
    for (const r of [disabled, noData, noGap]) expect(r.items).toEqual([]);
  });
});

describe('coverage-gap — backlog 产出与绕过防线（FR-015 / SC-011 / EC-18 / EC-30）', () => {
  beforeEach(() => {
    const path = join(dir, 'nohit-20260701.jsonl');
    writeRecords('nohit-20260701.jsonl', [
      // term X：3 行、2 个不同 hash → 达阈值
      { terms: ['alpha', 'shared'], hash: 'h1', tool: 'kb_search', timestamp: '2026-07-01T10:00:00.000Z' },
      { terms: ['alpha'], hash: 'h1', tool: 'kb_search', timestamp: '2026-07-02T10:00:00.000Z' },
      { terms: ['alpha'], hash: 'h2', tool: 'kb_api_lookup', timestamp: '2026-07-03T10:00:00.000Z' },
      // term Y：3 行但同一 hash（同一句话查三遍）→ 被阈值挡住（C5 绕过形态防线）
      { terms: ['beta'], hash: 'h3' },
      { terms: ['beta'], hash: 'h3' },
      { terms: ['beta'], hash: 'h3' },
      // 独有词：1 行
      { terms: ['gamma'], hash: 'h4' },
    ]);
    // 损坏行（EC-18）
    appendFileSync(path, '{"terms":["broken",\n');
  });

  it('恰 1 条目（term X），distinctQueries=2 / occurrences=3，term Y 不在 items 中', () => {
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.status).toBe('ok');
    expect(r.items.map((i) => i.term)).toEqual(['alpha']);
    expect(r.items[0]!.distinctQueries).toBe(2);
    expect(r.items[0]!.occurrences).toBe(3);
    expect(r.items.some((i) => i.term === 'beta')).toBe(false);
    expect(r.items.some((i) => i.term === 'gamma')).toBe(false);
  });

  it('条目含 tools 集合与首末时间', () => {
    const item = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true }).items[0]!;
    expect([...item.tools].sort()).toEqual(['kb_api_lookup', 'kb_search']);
    expect(item.firstSeen).toBe('2026-07-01T10:00:00.000Z');
    expect(item.lastSeen).toBe('2026-07-03T10:00:00.000Z');
  });

  it('损坏行被跳过并计入 skippedLines，整体不失败（EC-18）', () => {
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.skippedLines).toBe(1);
    expect(r.totalRecords).toBe(7);
  });

  it('阈值口径锁死：同一 hash 重复 N 次只计 1（EC-30）', () => {
    rmSync(join(dir, 'nohit-20260701.jsonl'));
    writeRecords('nohit-20260702.jsonl', Array.from({ length: 20 }, () => ({ terms: ['beta'], hash: 'same' })));
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.status).toBe('no-gap-above-threshold');
    expect(r.items).toEqual([]);
  });

  it('跨多个日文件聚合同一 term', () => {
    rmSync(join(dir, 'nohit-20260701.jsonl'));
    writeRecords('nohit-20260701.jsonl', [{ terms: ['delta'], hash: 'q1' }]);
    writeRecords('nohit-20260702.jsonl', [{ terms: ['delta'], hash: 'q2' }]);
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.items.map((i) => i.term)).toEqual(['delta']);
    expect(r.items[0]!.distinctQueries).toBe(2);
  });
});

describe('coverage-gap — 占位 token 不冒充缺口词（EC-21）', () => {
  it('只剩占位 token 的记录不产出条目，但计入 totalRecords', () => {
    writeRecords('nohit-20260701.jsonl', [
      { terms: ['HIGH', 'ENTROPY', 'HIGHENTROPY'], hash: 'h1' },
      { terms: ['HIGH', 'ENTROPY', 'HIGHENTROPY'], hash: 'h2' },
      { terms: [], hash: 'h3' },
    ]);
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.items).toEqual([]);
    expect(r.status).toBe('no-gap-above-threshold');
    expect(r.totalRecords).toBe(3);
  });

  it('混合记录里占位 token 被剔除、真实词保留', () => {
    writeRecords('nohit-20260701.jsonl', [
      { terms: ['EMAIL', 'retry'], hash: 'h1' },
      { terms: ['EMAIL', 'retry'], hash: 'h2' },
    ]);
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.items.map((i) => i.term)).toEqual(['retry']);
  });
});

describe('coverage-gap — 输出格式（SC-010）', () => {
  it('输出含 minOccurrenceThreshold: 2，且 json/markdown 全文均不含 k-匿名 / k-anonymity 字样', () => {
    writeRecords('nohit-20260701.jsonl', [
      { terms: ['alpha'], hash: 'h1' },
      { terms: ['alpha'], hash: 'h2' },
    ]);
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.minOccurrenceThreshold).toBe(2);
    expect(r.schemaVersion).toBe(1);
    for (const format of ['json', 'markdown'] as const) {
      const text = formatCoverageGapReport(r, format);
      expect(text).not.toMatch(/k-匿名|k-anonymity|kAnonymity/i);
      expect(text.length).toBeGreaterThan(0);
    }
    expect(JSON.parse(formatCoverageGapReport(r, 'json')).minOccurrenceThreshold).toBe(2);
    expect(formatCoverageGapReport(r, 'markdown')).toContain('alpha');
  });

  it('markdown 打出 readErrors 计数（B2-3 诊断可见）', () => {
    writeRecords('nohit-20260701.jsonl', [{ terms: ['alpha'], hash: 'h1' }]);
    const md = formatCoverageGapReport(
      buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true }),
      'markdown',
    );
    expect(md).toContain('readErrors: 0');
  });

  it('markdown 在三种空态下也明确打出 status（不输出空表冒充无缺口）', () => {
    const disabled = formatCoverageGapReport(
      buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: false }),
      'markdown',
    );
    expect(disabled).toContain('collection-disabled');
    const noData = formatCoverageGapReport(
      buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true }),
      'markdown',
    );
    expect(noData).toContain('no-data');
  });
});

/**
 * F241 B2-3（M-3 A-W4 / B-W3）——「数据存在但读不出来」不得被报成「尚无记录」。
 *
 * 三态输出的可信度全靠这个区分：`no-data` 会让读的人以为采集正常、只是还没人问过；
 * 实际可能是权限/断链导致整份数据不可见。
 */
describe('coverage-gap — 读取失败可诊断（B2-3 第四态 data-unreadable）', () => {
  it('匹配文件存在但读取失败（断链）→ data-unreadable + readErrors 计数，不报 no-data', () => {
    symlinkSync(join(dir, 'definitely-missing-target'), join(dir, 'nohit-20260701.jsonl'));
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.status).toBe('data-unreadable');
    expect(r.readErrors).toBe(1);
    expect(r.totalRecords).toBe(0);
    expect(r.items).toEqual([]);
  });

  it('权限不足（chmod 000）→ 同样 data-unreadable', () => {
    const p = join(dir, 'nohit-20260702.jsonl');
    writeRecords('nohit-20260702.jsonl', [{ terms: ['alpha'], hash: 'h1' }]);
    chmodSync(p, 0o000);
    try {
      const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
      // root 身份下 chmod 000 仍可读 —— 该环境下退化为 no-gap-above-threshold，不做假断言
      if (r.readErrors === 0) {
        expect(r.status).toBe('no-gap-above-threshold');
        return;
      }
      expect(r.status).toBe('data-unreadable');
      expect(r.readErrors).toBe(1);
    } finally {
      chmodSync(p, 0o644);
    }
  });

  it('部分可读：坏文件计入 readErrors，好文件照常聚合（状态不被降级）', () => {
    symlinkSync(join(dir, 'definitely-missing-target'), join(dir, 'nohit-20260701.jsonl'));
    writeRecords('nohit-20260702.jsonl', [
      { terms: ['alpha'], hash: 'h1' },
      { terms: ['alpha'], hash: 'h2' },
    ]);
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    expect(r.status).toBe('ok');
    expect(r.readErrors).toBe(1);
    expect(r.items.map((i) => i.term)).toEqual(['alpha']);
  });

  it('四态互不相同，且 readErrors 是恒在字段（关闭态也为 0）', () => {
    const disabled = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: false });
    const noData = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    symlinkSync(join(dir, 'definitely-missing-target'), join(dir, 'nohit-20260701.jsonl'));
    const unreadable = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    writeRecords('nohit-20260702.jsonl', [{ terms: ['alpha'], hash: 'h1' }]);
    const noGap = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    const statuses = [disabled.status, noData.status, unreadable.status, noGap.status];
    expect(statuses).toEqual(['collection-disabled', 'no-data', 'data-unreadable', 'no-gap-above-threshold']);
    expect(new Set(statuses).size).toBe(4);
    for (const r of [disabled, noData, unreadable, noGap]) {
      expect(r.items).toEqual([]);
      expect(typeof r.readErrors).toBe('number');
    }
    expect(disabled.readErrors).toBe(0);
  });

  it('markdown 与 json 都打出 data-unreadable 的解释（不静默）', () => {
    symlinkSync(join(dir, 'definitely-missing-target'), join(dir, 'nohit-20260701.jsonl'));
    const r = buildCoverageGapReport({ nohitDir: dir, isCollectionEnabled: true });
    const md = formatCoverageGapReport(r, 'markdown');
    expect(md).toContain('data-unreadable');
    expect(md).toContain('readErrors: 1');
    expect(JSON.parse(formatCoverageGapReport(r, 'json')).readErrors).toBe(1);
  });
});
