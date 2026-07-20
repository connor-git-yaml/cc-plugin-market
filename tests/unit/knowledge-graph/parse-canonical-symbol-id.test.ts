/**
 * Feature 214 T003（=plan T2）— parseCanonicalSymbolId 单点解析工具（FR-006）
 *
 * RED 写法【W1】：parseCanonicalSymbolId 在 T006 实现前尚不存在，
 * 用动态 import 探测导出，保证实现前测试可收集且以断言失败呈现 RED，
 * 而非 TS 编译 / collection error。
 */
import { describe, expect, it } from 'vitest';

/** 待实现函数的签名契约（FR-006） */
type ParseCanonicalSymbolId = (id: string) => {
  filePart: string;
  symbolPart: string | undefined;
};

async function loadParse(): Promise<ParseCanonicalSymbolId | undefined> {
  const mod = (await import('../../../src/knowledge-graph/relativize.js')) as Record<
    string,
    unknown
  >;
  const fn = mod.parseCanonicalSymbolId;
  return typeof fn === 'function' ? (fn as ParseCanonicalSymbolId) : undefined;
}

describe('parseCanonicalSymbolId (FR-006)', () => {
  it('作为命名导出存在于 relativize 模块', async () => {
    const parse = await loadParse();
    expect(parse).toBeTypeOf('function');
  });

  it('file::sym → filePart=file, symbolPart=sym', async () => {
    const parse = await loadParse();
    expect(parse).toBeDefined();
    const r = parse!('src/a.ts::foo');
    expect(r.filePart).toBe('src/a.ts');
    expect(r.symbolPart).toBe('foo');
  });

  it('file::Class.member → filePart=file, symbolPart=Class.member（成员点号保留在 symbolPart）', async () => {
    const parse = await loadParse();
    expect(parse).toBeDefined();
    const r = parse!('src/a.ts::Bar.baz');
    expect(r.filePart).toBe('src/a.ts');
    expect(r.symbolPart).toBe('Bar.baz');
  });

  it('file（无分隔符）→ filePart=整 id, symbolPart=undefined', async () => {
    const parse = await loadParse();
    expect(parse).toBeDefined();
    const r = parse!('src/a.ts');
    expect(r.filePart).toBe('src/a.ts');
    expect(r.symbolPart).toBeUndefined();
  });

  it('file#legacy（旧 # 分隔符，无 ::）→ filePart=整 id, symbolPart=undefined（# 不被识别为分隔符）', async () => {
    const parse = await loadParse();
    expect(parse).toBeDefined();
    const r = parse!('src/a.py#legacy');
    // # 不是 canonical 分隔符 → 整串作 filePart，不切分
    expect(r.filePart).toBe('src/a.py#legacy');
    expect(r.symbolPart).toBeUndefined();
  });

  it('只切分首个 :: — file::Class::weird 的 symbolPart 保留后续 ::', async () => {
    const parse = await loadParse();
    expect(parse).toBeDefined();
    const r = parse!('src/a.ts::Class::weird');
    expect(r.filePart).toBe('src/a.ts');
    expect(r.symbolPart).toBe('Class::weird');
  });
});
