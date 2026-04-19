/**
 * JavaLanguageAdapter.extractComments 单元测试
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JavaLanguageAdapter } from '../../src/adapters/java-adapter.js';

function writeTmp(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-java-'));
  const p = path.join(dir, 'A.java');
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('JavaLanguageAdapter.extractComments', () => {
  const adapter = new JavaLanguageAdapter();

  it('提取 // 行注释', async () => {
    const file = writeTmp([
      'class A {',
      '  // TODO: fix me',
      '  void f() {}',
      '}',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions.some((r) => r.text.includes('TODO: fix me'))).toBe(true);
  });

  it('提取 /* */ 块注释与 /** */ Javadoc', async () => {
    const file = writeTmp([
      '/** FIXME: javadoc style */',
      'class A {',
      '  /* HACK:',
      '   * block comment',
      '   */',
      '  void f() {}',
      '}',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions.some((r) => r.text.includes('FIXME'))).toBe(true);
    expect(regions.some((r) => r.text.includes('HACK'))).toBe(true);
  });

  it('字符串字面量里的 TODO 不会被提取', async () => {
    const file = writeTmp([
      'class A {',
      '  String msg = "TODO in string";',
      '}',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(0);
  });
});
