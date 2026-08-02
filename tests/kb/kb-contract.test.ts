/**
 * F190 T048/T050 — KB 工具契约 snapshot（SC-012）+ 工具名隔离（SC-013 第 3 条）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKb } from '../../src/scaffold-kb/index.js';
import { loadKbContext, type KbContext } from '../../src/kb-mcp/lib/kb-locator.js';
import { executeKbSearch } from '../../src/kb-mcp/tools/kb-search.js';
import { executeKbDocLookup } from '../../src/kb-mcp/tools/kb-doc-lookup.js';
import { executeKbApiLookup } from '../../src/kb-mcp/tools/kb-api-lookup.js';
import { createKbMcpServer } from '../../src/kb-mcp/server.js';

let workdir: string;
let ctx: KbContext;

function parse(r: { content: Array<{ text: string }> }): any {
  return JSON.parse(r.content[0]!.text);
}

beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'kb-contract-'));
  const vDocs = join(workdir, 'vdocs');
  mkdirSync(vDocs, { recursive: true });
  writeFileSync(join(vDocs, 'a.md'), '# A\n\n错误码 ERR_X 说明。\n');
  const vendorKb = join(workdir, 'vkb');
  await buildKb({ noLlm: true, dirPath: vDocs, outputPath: vendorKb, builtAt: 'B' });
  const loaded = await loadKbContext({ vendorKbPath: vendorKb });
  if (!loaded.ok) throw new Error(loaded.code);
  ctx = loaded.context;
});

afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe('SC-012 — KB 工具响应契约 shape', () => {
  it('kb_search 成功响应 shape（envelope + 固定字段）', () => {
    const r = executeKbSearch(ctx, { query: '错误码' });
    expect(r.isError).toBeUndefined();
    expect(Array.isArray(r.content)).toBe(true);
    expect(r.content[0]!.type).toBe('text');
    const out = parse(r);
    // F241 FR-021：kb_status 是**纯新增**顶层字段。此处仍是 exact 集合相等（**没有放宽**为
    // arrayContaining）——只是把新增字段如实纳入期望集，既有 5 个字段一个不少、一个不改。
    expect(Object.keys(out).sort()).toEqual(
      ['kb_status', 'query_echoed', 'results', 'sources_queried', 'total_found', 'truncated'].sort(),
    );
  });

  it('kb_search 错误响应 shape（isError + 顶层 code，与现有工具一致）', () => {
    const r = executeKbSearch(ctx, { query: '' });
    expect(r.isError).toBe(true);
    expect(typeof parse(r).code).toBe('string');
  });

  it('kb_doc_lookup 错误响应 shape', () => {
    const r = executeKbDocLookup(ctx, {});
    expect(r.isError).toBe(true);
    expect(parse(r).code).toBe('INVALID_LOOKUP_ARG');
  });
});

/**
 * F241 T061（FR-021 / SC-014 / P-W4）—— `kb_status` 追加范围钉死。
 *
 * 追加到**全部成功 envelope**（含 `document_fallback` 与 `not_found:true` 早返回，
 * 这两条同样是成功响应，调用方同样需要知道"查不到，是不是因为库太旧"）；
 * **error envelope 不追加**（错误响应形状不因治理字段扩大契约面）。
 */
describe('F241 FR-021 — kb_status 追加范围（SC-014）', () => {
  const SUBSET_KEYS = ['activityAgeDays', 'freshness', 'sourceVersions'];

  /** 注入一份非空实体表，让 `allEnts.length > 0`，从而走 not_found 早返回而非 document_fallback */
  function ctxWithEntities(): KbContext {
    if (ctx.vendor === null) throw new Error('fixture 需要 vendor 库');
    return {
      ...ctx,
      vendor: {
        ...ctx.vendor,
        entities: {
          schemaVersion: '1.0',
          builtAt: 'B',
          sdkVersion: '1.0',
          sourceKind: 'vendor',
          entities: [
            {
              id: 'someapi#function',
              name: 'someApi',
              qualifiedName: 'someApi',
              kind: 'function',
              sourceDocId: 'a.md',
              sourceChunkId: 'c1',
              lang: 'en',
              confidence: 0.8,
              extractionMethod: 'llm',
            },
          ],
        },
      },
    };
  }

  function expectKbStatus(out: Record<string, unknown>): void {
    expect(out['kb_status']).toBeDefined();
    const s = out['kb_status'] as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(SUBSET_KEYS);
    expect(['current', 'aging', 'stale', 'unknown']).toContain(s['freshness']);
    expect(Array.isArray(s['sourceVersions'])).toBe(true);
    expect(s['activityAgeDays'] === null || typeof s['activityAgeDays'] === 'number').toBe(true);
    // B3-C4 回归钉子：spec FR-021 明定 camelCase，实现不得单方面改外部契约
    expect(Object.keys(s).filter((k) => k.includes('_'))).toEqual([]);
  }

  it('kb_search 常规成功 envelope 含 kb_status', () => {
    expectKbStatus(parse(executeKbSearch(ctx, { query: '错误码' })));
  });

  it('kb_search 零命中成功 envelope 同样含 kb_status（"查不到"最需要新鲜度线索）', () => {
    const out = parse(executeKbSearch(ctx, { query: 'zzzqqq完全不存在的词' }));
    expect(out.total_found).toBe(0);
    expectKbStatus(out);
  });

  it('kb_search error envelope **不含** kb_status（P-W4 钉死）', () => {
    const r = executeKbSearch(ctx, { query: '' });
    expect(r.isError).toBe(true);
    expect(parse(r)['kb_status']).toBeUndefined();
  });

  it('kb_api_lookup 常规成功 envelope 含 kb_status', () => {
    const out = parse(executeKbApiLookup(ctx, { api_name: 'ERR_X' }));
    expectKbStatus(out);
  });

  it('kb_api_lookup document_fallback 分支含 kb_status', () => {
    // 无实体表 → allEnts 为空 → documentFallback
    const noEntities: KbContext = {
      ...ctx,
      vendor: ctx.vendor === null ? null : { ...ctx.vendor, entities: null },
      project: null,
    };
    const out = parse(executeKbApiLookup(noEntities, { api_name: 'ERR_X' }));
    expect(out.mode).toBe('document_fallback');
    expectKbStatus(out);
  });

  it('kb_api_lookup not_found:true 早返回分支含 kb_status', () => {
    const out = parse(executeKbApiLookup(ctxWithEntities(), { api_name: 'zzzNoSuchEntityName' }));
    expect(out.not_found).toBe(true);
    expectKbStatus(out);
  });

  it('kb_api_lookup error envelope **不含** kb_status', () => {
    const r = executeKbApiLookup(ctx, { api_name: '' });
    expect(r.isError).toBe(true);
    expect(parse(r)['kb_status']).toBeUndefined();
  });

  it('既有字段名称/类型/层级零变更：删掉 kb_status 后与接线前形状逐字段一致（RG-005）', () => {
    const search = parse(executeKbSearch(ctx, { query: '错误码' }));
    const { kb_status: _s, ...restSearch } = search;
    expect(Object.keys(restSearch).sort()).toEqual(
      ['query_echoed', 'results', 'sources_queried', 'total_found', 'truncated'].sort(),
    );
    expect(typeof restSearch.total_found).toBe('number');
    expect(Array.isArray(restSearch.results)).toBe(true);
    expect(typeof restSearch.truncated).toBe('boolean');
    expect(restSearch.query_echoed).toBe('错误码');
    expect(restSearch.sources_queried).toEqual(['vendor']);

    const notFound = parse(executeKbApiLookup(ctxWithEntities(), { api_name: 'zzzNoSuchEntityName' }));
    const { kb_status: _s2, ...restLookup } = notFound;
    expect(Object.keys(restLookup).sort()).toEqual(
      ['evidence_note', 'not_found', 'note', 'results', 'total_found'].sort(),
    );
    expect(restLookup.not_found).toBe(true);
    expect(restLookup.total_found).toBe(0);
    expect(restLookup.results).toEqual([]);
  });
});

describe('SC-013 第 3 条 — KB 工具名与 17 个 Spectra 工具名交集为空', () => {
  // 现有 17 个 Spectra MCP 工具名（src/mcp/server.ts 注册）
  const SPECTRA_TOOLS = [
    'prepare', 'generate', 'batch', 'diff', 'panoramic-query',
    'graph_query', 'graph_node', 'graph_path', 'graph_community', 'graph_god_nodes', 'graph_hyperedges',
    'impact', 'context', 'detect_changes',
    'view_file', 'search_in_file', 'list_directory',
  ];
  const KB_TOOLS = ['kb_search', 'kb_doc_lookup'];

  it('kb_* 工具名均不在 17 工具集合内', () => {
    for (const t of KB_TOOLS) {
      expect(SPECTRA_TOOLS).not.toContain(t);
      expect(t.startsWith('kb_')).toBe(true);
    }
  });

  it('createKbMcpServer 仅注册 KB 工具，不抛错（独立 server）', () => {
    expect(() => createKbMcpServer(ctx)).not.toThrow();
  });
});
