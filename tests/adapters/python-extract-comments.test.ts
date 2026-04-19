/**
 * PythonLanguageAdapter.extractComments 单元测试
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';

function writeTmp(content: string, ext = '.py'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-py-'));
  const p = path.join(dir, 'a' + ext);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('PythonLanguageAdapter.extractComments', () => {
  const adapter = new PythonLanguageAdapter();

  it('提取 # 行注释', async () => {
    const file = writeTmp([
      'x = 1',
      '# TODO: handle negative case',
      'y = 2',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.kind).toBe('line');
    expect(regions[0]?.text).toContain('TODO: handle negative case');
    expect(regions[0]?.startLine).toBe(2);
  });

  it('docstring 不会被当成 comment', async () => {
    const file = writeTmp([
      'def foo():',
      '    """TODO: not a comment, it is a docstring"""',
      '    pass',
      '',
      '# TODO: real comment',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.text).toContain('real comment');
  });

  it('字符串字面量里的 TODO 不会被提取', async () => {
    const file = writeTmp([
      'msg = "TODO in string"',
      "other = 'also TODO'",
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(0);
  });
});
