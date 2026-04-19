/**
 * TsJsLanguageAdapter.extractComments 单元测试
 *
 * 核心验证：字符串字面量中的 "TODO" 不会被提取为 comment。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';

function writeTmp(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-ts-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('TsJsLanguageAdapter.extractComments', () => {
  const adapter = new TsJsLanguageAdapter();

  it('提取行注释', async () => {
    const file = writeTmp('a.ts', [
      'const x = 1;',
      '// TODO: refactor this',
      'const y = 2;',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.kind).toBe('line');
    expect(regions[0]?.text).toContain('TODO: refactor this');
    expect(regions[0]?.startLine).toBe(2);
  });

  it('提取块注释，保留内部换行', async () => {
    const file = writeTmp('b.ts', [
      '/*',
      ' * FIXME: need to handle null',
      ' * HACK: temporary workaround',
      ' */',
      'const x = 1;',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.kind).toBe('block');
    expect(regions[0]?.text).toContain('FIXME');
    expect(regions[0]?.text).toContain('HACK');
    expect(regions[0]?.startLine).toBe(1);
    expect(regions[0]?.endLine).toBe(4);
  });

  it('字符串字面量里的 "TODO" 不会被提取', async () => {
    const file = writeTmp('c.ts', [
      'const msg = "TODO is not a comment";',
      'const s = `TODO also not`;',
      "const t = 'TODO single';",
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions).toHaveLength(0);
  });

  it('提取 JSDoc（作为块注释）', async () => {
    const file = writeTmp('d.ts', [
      '/**',
      ' * @deprecated TODO remove after v2',
      ' */',
      'export function foo() {}',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions.some((r) => r.text.includes('TODO'))).toBe(true);
  });

  it('多个注释位置正确', async () => {
    const file = writeTmp('e.ts', [
      '// TODO 1',
      'const a = 1;',
      '// TODO 2',
      'const b = 2;',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions.length).toBe(2);
    expect(regions[0]?.startLine).toBe(1);
    expect(regions[1]?.startLine).toBe(3);
  });

  it('JSX/TSX 文件也能处理', async () => {
    const file = writeTmp('f.tsx', [
      'const A = () => {',
      '  // TODO inside component',
      '  return <div>{"not a TODO"}</div>;',
      '};',
    ].join('\n'));
    const regions = await adapter.extractComments(file);
    expect(regions.some((r) => r.text.includes('TODO inside component'))).toBe(true);
    // 字符串中 "not a TODO" 不应被提取为 comment
    expect(regions.some((r) => r.text.includes('not a TODO'))).toBe(false);
  });
});
