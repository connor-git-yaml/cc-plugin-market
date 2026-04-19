/**
 * quality-report-patcher 单元测试
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  patchQualityReportWithDebt,
  renderDebtSection,
} from '../../src/debt-scanner/aggregator/quality-report-patcher.js';
import type { DebtMetrics } from '../../src/debt-scanner/types.js';

function tmp(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-patch-'));
  const p = path.join(dir, 'quality-report.md');
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

const metrics: DebtMetrics = {
  totalEntries: 7,
  byKind: { TODO: 3, FIXME: 2, HACK: 1, XXX: 0, NOTE: 1 },
  densityPerKloc: 0.7,
  oldestAgeDays: 90,
  openQuestionsCount: 2,
};

describe('patchQualityReportWithDebt', () => {
  it('文件不存在时返回 false 不报错', () => {
    const ok = patchQualityReportWithDebt({
      qualityReportPath: '/no/such/file.md',
      metrics,
    });
    expect(ok).toBe(false);
  });

  it('追加到尾部（原文件无 "## 技术债" 节）', () => {
    const p = tmp('# Quality Report\n\n## Required Docs\n\n- a\n');
    const changed = patchQualityReportWithDebt({ qualityReportPath: p, metrics });
    expect(changed).toBe(true);
    const out = fs.readFileSync(p, 'utf-8');
    expect(out).toContain('## 技术债');
    expect(out).toContain('总条目数：7');
    expect(out).toContain('technical-debt.md');
  });

  it('已存在节时替换（幂等）', () => {
    const original = [
      '# Quality',
      '',
      '## 技术债',
      '',
      '- 总条目数：99',
      '',
      '## 其它',
      '内容',
    ].join('\n');
    const p = tmp(original);
    const changed = patchQualityReportWithDebt({ qualityReportPath: p, metrics });
    expect(changed).toBe(true);
    const out = fs.readFileSync(p, 'utf-8');
    expect(out).toContain('总条目数：7');
    expect(out).not.toContain('总条目数：99');
    // 其它节应保留
    expect(out).toContain('## 其它');
    expect(out).toContain('内容');
  });

  it('存在 "## Required Docs" 锚点时插入到其节末尾（AC-4.1）', () => {
    const original = [
      '# Quality',
      '',
      '## Provenance Coverage',
      'content A',
      '',
      '## Required Docs',
      'content B',
      '',
      '## 健康度',
      'content C',
      '',
    ].join('\n');
    const p = tmp(original);
    const changed = patchQualityReportWithDebt({ qualityReportPath: p, metrics });
    expect(changed).toBe(true);
    const out = fs.readFileSync(p, 'utf-8');
    const debtIdx = out.indexOf('## 技术债');
    const requiredIdx = out.indexOf('## Required Docs');
    const healthIdx = out.indexOf('## 健康度');
    expect(requiredIdx).toBeGreaterThan(-1);
    expect(debtIdx).toBeGreaterThan(requiredIdx);
    expect(debtIdx).toBeLessThan(healthIdx);
  });

  it('缺少 "## Required Docs" 锚点时退化为尾部追加', () => {
    const p = tmp('# Quality\n\n## 其它\n内容\n');
    const changed = patchQualityReportWithDebt({ qualityReportPath: p, metrics });
    expect(changed).toBe(true);
    const out = fs.readFileSync(p, 'utf-8');
    expect(out).toContain('## 技术债');
    expect(out.lastIndexOf('## 技术债')).toBeGreaterThan(out.indexOf('## 其它'));
  });

  it('renderDebtSection 包含所有关键字段', () => {
    const s = renderDebtSection(metrics, 'technical-debt.md');
    expect(s).toContain('## 技术债');
    expect(s).toContain('总条目数：7');
    expect(s).toContain('TODO 3 / FIXME 2');
    expect(s).toContain('0.70 条/kLOC');
    expect(s).toContain('最老条目：90 天');
  });
});
