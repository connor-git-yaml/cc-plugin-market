/**
 * GoLanguageAdapter.extractComments 单元测试
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GoLanguageAdapter } from '../../src/adapters/go-adapter.js';

function writeTmp(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-go-'));
  const p = path.join(dir, 'a.go');
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('GoLanguageAdapter.extractComments', () => {
  const adapter = new GoLanguageAdapter();

  it('提取 // 行注释', async () => {
    const file = writeTmp([
      'package main',
      '',
      '// TODO: implement',
      'func main() {}',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions.some((r) => r.text.includes('TODO: implement'))).toBe(true);
  });

  it('提取 /* */ 块注释', async () => {
    const file = writeTmp([
      'package main',
      '',
      '/* FIXME:',
      ' * multi-line block comment',
      ' */',
      'func main() {}',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions.some((r) => r.kind === 'block' && r.text.includes('FIXME'))).toBe(true);
  });

  it('字符串字面量里的 TODO 不会被提取', async () => {
    const file = writeTmp([
      'package main',
      '',
      'var msg = "TODO in go string"',
      'var raw = `TODO in backtick string`',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(0);
  });
});
