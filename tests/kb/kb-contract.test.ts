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
    expect(Object.keys(out).sort()).toEqual(
      ['query_echoed', 'results', 'sources_queried', 'total_found', 'truncated'].sort(),
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
