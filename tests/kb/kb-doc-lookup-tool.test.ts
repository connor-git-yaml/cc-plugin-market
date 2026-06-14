/**
 * F190 T042 — kb_doc_lookup 工具：doc_id/keyword 导航 + 参数校验 + doc-graph 降级
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKb } from '../../src/scaffold-kb/index.js';
import { loadKbContext, type KbContext } from '../../src/kb-mcp/lib/kb-locator.js';
import { executeKbDocLookup } from '../../src/kb-mcp/tools/kb-doc-lookup.js';

let workdir: string;
let ctx: KbContext;
let vendorKb: string;

function parse(r: { content: Array<{ text: string }> }): any {
  return JSON.parse(r.content[0]!.text);
}

beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'kb-lookup-'));
  const vDocs = join(workdir, 'vdocs');
  mkdirSync(vDocs, { recursive: true });
  // init.md 引用 auth.md（doc-graph 边）
  writeFileSync(join(vDocs, 'init.md'), '# 初始化\n\n调用 sdk.Init()。详见 [鉴权](auth.md)。\n');
  writeFileSync(join(vDocs, 'auth.md'), '# 鉴权\n\n鉴权失败返回 ERR_AUTH_FAILED。\n');
  vendorKb = join(workdir, 'vkb');
  await buildKb({ dirPath: vDocs, outputPath: vendorKb, builtAt: 'B' });
  const loaded = await loadKbContext({ vendorKbPath: vendorKb });
  if (!loaded.ok) throw new Error(loaded.code);
  ctx = loaded.context;
});

afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe('kb_doc_lookup — 导航', () => {
  it('doc_id 精确查询返回文档 + references', () => {
    const out = parse(executeKbDocLookup(ctx, { doc_id: 'init.md' }));
    expect(out.total_found).toBe(1);
    const doc = out.docs[0];
    expect(doc.doc_id).toBe('init.md');
    expect(doc.title).toBe('初始化');
    expect(doc.references).toContain('auth.md'); // init → auth 引用
    expect(doc.source_kind).toBe('vendor');
  });

  it('被引用关系 referenced_by', () => {
    const out = parse(executeKbDocLookup(ctx, { doc_id: 'auth.md' }));
    expect(out.docs[0].referenced_by).toContain('init.md');
  });

  it('keyword 标题模糊匹配', () => {
    const out = parse(executeKbDocLookup(ctx, { keyword: '鉴权' }));
    expect(out.docs.some((d: any) => d.doc_id === 'auth.md')).toBe(true);
  });
});

describe('kb_doc_lookup — 参数校验（EC-010）', () => {
  it('doc_id 与 keyword 均缺失 → INVALID_LOOKUP_ARG', () => {
    expect(parse(executeKbDocLookup(ctx, {})).code).toBe('INVALID_LOOKUP_ARG');
  });
  it('两者同时提供 → doc_id 优先 + warning（非报错）', () => {
    const r = executeKbDocLookup(ctx, { doc_id: 'init.md', keyword: '鉴权' });
    expect(r.isError).toBeUndefined();
    const out = parse(r);
    expect(out.docs[0].doc_id).toBe('init.md'); // doc_id 优先
    expect(out.warnings?.some((w: string) => w.includes('doc_id'))).toBe(true);
  });
  it('非法 source_filter → INVALID_SOURCE_FILTER', () => {
    expect(parse(executeKbDocLookup(ctx, { doc_id: 'x', source_filter: 'bogus' as any })).code).toBe(
      'INVALID_SOURCE_FILTER',
    );
  });
});

describe('kb_doc_lookup — doc-graph 缺失降级（EC-007）', () => {
  it('删除 doc-graph.json 后 kb_doc_lookup 降级（warning，不崩溃），kb_search 不受影响', async () => {
    // 删除 doc-graph.json，仅留 chunks.sqlite
    rmSync(join(vendorKb, 'doc-graph.json'), { force: true });
    const loaded = await loadKbContext({ vendorKbPath: vendorKb });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const out = parse(executeKbDocLookup(loaded.context, { doc_id: 'init.md' }));
    expect(out.total_found).toBe(0);
    expect(out.warnings?.some((w: string) => w.includes('doc-graph'))).toBe(true);
  });
});
