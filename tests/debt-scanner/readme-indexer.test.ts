/**
 * readme-indexer 单元测试
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { indexDebtInReadme } from '../../src/debt-scanner/aggregator/readme-indexer.js';

function makeSpecsDir(readmeContent: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-readme-'));
  if (readmeContent !== null) {
    fs.writeFileSync(path.join(dir, 'README.md'), readmeContent, 'utf-8');
  }
  return dir;
}

describe('indexDebtInReadme', () => {
  it('README.md 不存在 → 返回 false 不报错', () => {
    const dir = makeSpecsDir(null);
    expect(indexDebtInReadme(dir)).toBe(false);
  });

  it('没有 "质量审计" 节 → 返回 false', () => {
    const dir = makeSpecsDir('# Specs\n\n## 其它\n');
    expect(indexDebtInReadme(dir)).toBe(false);
  });

  it('在 "质量审计" 节末尾插入链接', () => {
    const dir = makeSpecsDir([
      '# Specs',
      '',
      '## 质量审计',
      '',
      '- [覆盖率](coverage.md)',
      '',
      '## 其它',
    ].join('\n'));
    expect(indexDebtInReadme(dir)).toBe(true);
    const out = fs.readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(out).toContain('[技术债清单](project/technical-debt.md)');
    expect(out).toContain('## 其它');
  });

  it('已存在链接时幂等（返回 false）', () => {
    const dir = makeSpecsDir([
      '# Specs',
      '',
      '## 质量审计',
      '',
      '- [技术债清单](project/technical-debt.md)',
      '',
    ].join('\n'));
    expect(indexDebtInReadme(dir)).toBe(false);
  });
});
