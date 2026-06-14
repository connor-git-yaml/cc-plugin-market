/**
 * F190 scaffold-kb — doc-graph-builder 单元测试
 *
 * 覆盖：
 * - 节点字段映射（id/title/lang/sourceUrl 必填）
 * - references → edges（relation 默认 'references'）
 * - 悬空引用跳过（目标 id 不在 docs 集合内）
 * - schemaVersion 字段存在（EC-009）
 * - 顶层字段完整性（source/builtAt/sdkVersion）
 * - 幂等性：相同输入去掉 builtAt 后 JSON 字节级一致
 * - 空 docs 边界（空节点、空边）
 * - 节点去重排序（按 id 升序）
 * - 边排序（按 source,target 升序）
 * - sdkVersion 为 null 时正确写入
 */

import { describe, it, expect } from 'vitest';
import { buildDocGraph } from '../../src/scaffold-kb/doc-graph-builder.js';
import type { ParsedDoc } from '../../src/scaffold-kb/types.js';

// -----------------------------------------------------------------------
// 测试数据工厂
// -----------------------------------------------------------------------

/** 创建最小合法 ParsedDoc */
function makeDoc(overrides: Partial<ParsedDoc> & { id: string }): ParsedDoc {
  return {
    id: overrides.id,
    title: overrides.title ?? `Title of ${overrides.id}`,
    content: overrides.content ?? `Content of ${overrides.id}`,
    sourceUrl: overrides.sourceUrl ?? `https://example.com/${overrides.id}`,
    lang: overrides.lang ?? 'en',
    references: overrides.references,
  };
}

/** 固定时间戳，保证幂等测试不受系统时间影响 */
const FIXED_BUILT_AT = '2026-06-14T00:00:00.000Z';

/** 默认测试 opts */
const defaultOpts = {
  source: 'directory' as const,
  sdkVersion: '1.2.3',
  builtAt: FIXED_BUILT_AT,
};

// -----------------------------------------------------------------------
// 空边界
// -----------------------------------------------------------------------

describe('buildDocGraph — 空 docs 边界', () => {
  it('空文档列表返回空 nodes 和空 edges', () => {
    const graph = buildDocGraph([], defaultOpts);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('空 docs 时 schemaVersion 仍存在', () => {
    const graph = buildDocGraph([], defaultOpts);
    expect(graph.schemaVersion).toBe('1.0');
  });
});

// -----------------------------------------------------------------------
// 节点字段映射
// -----------------------------------------------------------------------

describe('buildDocGraph — 节点字段映射', () => {
  it('每篇 ParsedDoc 映射为一个 DocNode，必填字段齐全', () => {
    const doc = makeDoc({
      id: 'docs/quickstart',
      title: '快速入门',
      sourceUrl: 'https://sdk.example.com/quickstart',
      lang: 'zh',
    });

    const graph = buildDocGraph([doc], defaultOpts);

    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0];
    expect(node).toBeDefined();
    // 使用非空断言（noUncheckedIndexedAccess 要求先确认存在）
    if (node === undefined) throw new Error('node[0] should exist');
    expect(node.id).toBe('docs/quickstart');
    expect(node.title).toBe('快速入门');
    expect(node.lang).toBe('zh');
    expect(node.sourceUrl).toBe('https://sdk.example.com/quickstart');
  });

  it('summary 和 tags 不写入节点（ParsedDoc 不携带时）', () => {
    const doc = makeDoc({ id: 'a' });
    const graph = buildDocGraph([doc], defaultOpts);
    const node = graph.nodes[0];
    if (node === undefined) throw new Error('node[0] should exist');
    // ParsedDoc 无 summary/tags 字段，DocNode 的可选字段不应被设为 undefined
    expect('summary' in node).toBe(false);
    expect('tags' in node).toBe(false);
  });

  it('多文档时节点数量与 docs.length 一致', () => {
    const docs = [makeDoc({ id: 'a' }), makeDoc({ id: 'b' }), makeDoc({ id: 'c' })];
    const graph = buildDocGraph(docs, defaultOpts);
    expect(graph.nodes).toHaveLength(3);
  });
});

// -----------------------------------------------------------------------
// schemaVersion 存在（EC-009）
// -----------------------------------------------------------------------

describe('buildDocGraph — schemaVersion', () => {
  it('schemaVersion 字段存在且值为 "1.0"', () => {
    const graph = buildDocGraph([makeDoc({ id: 'x' })], defaultOpts);
    expect(graph.schemaVersion).toBe('1.0');
  });

  it('schemaVersion 在空 docs 时也存在', () => {
    const graph = buildDocGraph([], { source: 'llms.txt', sdkVersion: null, builtAt: FIXED_BUILT_AT });
    expect(graph.schemaVersion).toBe('1.0');
  });
});

// -----------------------------------------------------------------------
// 顶层字段
// -----------------------------------------------------------------------

describe('buildDocGraph — 顶层字段', () => {
  it('source 字段来自 opts.source', () => {
    const g1 = buildDocGraph([], { source: 'llms.txt', sdkVersion: null, builtAt: FIXED_BUILT_AT });
    expect(g1.source).toBe('llms.txt');

    const g2 = buildDocGraph([], { source: 'directory', sdkVersion: null, builtAt: FIXED_BUILT_AT });
    expect(g2.source).toBe('directory');
  });

  it('builtAt 字段来自 opts.builtAt', () => {
    const graph = buildDocGraph([], { source: 'directory', sdkVersion: null, builtAt: '2026-01-01T00:00:00Z' });
    expect(graph.builtAt).toBe('2026-01-01T00:00:00Z');
  });

  it('sdkVersion 为字符串时正确写入', () => {
    const graph = buildDocGraph([], { source: 'directory', sdkVersion: '2.0.0', builtAt: FIXED_BUILT_AT });
    expect(graph.sdkVersion).toBe('2.0.0');
  });

  it('sdkVersion 为 null 时写入 null', () => {
    const graph = buildDocGraph([], { source: 'directory', sdkVersion: null, builtAt: FIXED_BUILT_AT });
    expect(graph.sdkVersion).toBeNull();
  });
});

// -----------------------------------------------------------------------
// references → edges
// -----------------------------------------------------------------------

describe('buildDocGraph — references → edges', () => {
  it('doc.references 中存在的 id 生成 DocEdge，relation 为 "references"', () => {
    const docs = [
      makeDoc({ id: 'a', references: ['b'] }),
      makeDoc({ id: 'b' }),
    ];
    const graph = buildDocGraph(docs, defaultOpts);

    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0];
    if (edge === undefined) throw new Error('edge[0] should exist');
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
    expect(edge.relation).toBe('references');
  });

  it('多篇文档的 references 合并为多条边', () => {
    const docs = [
      makeDoc({ id: 'a', references: ['b', 'c'] }),
      makeDoc({ id: 'b', references: ['c'] }),
      makeDoc({ id: 'c' }),
    ];
    const graph = buildDocGraph(docs, defaultOpts);
    // a→b, a→c, b→c
    expect(graph.edges).toHaveLength(3);
  });

  it('同一对 (source,target) 重复引用时去重', () => {
    const docs = [
      makeDoc({ id: 'a', references: ['b', 'b'] }),
      makeDoc({ id: 'b' }),
    ];
    const graph = buildDocGraph(docs, defaultOpts);
    expect(graph.edges).toHaveLength(1);
  });

  it('无 references 字段的文档不产生边', () => {
    const docs = [makeDoc({ id: 'a' }), makeDoc({ id: 'b' })];
    const graph = buildDocGraph(docs, defaultOpts);
    expect(graph.edges).toHaveLength(0);
  });

  it('references 为空数组时不产生边', () => {
    const docs = [makeDoc({ id: 'a', references: [] }), makeDoc({ id: 'b' })];
    const graph = buildDocGraph(docs, defaultOpts);
    expect(graph.edges).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// 悬空引用跳过
// -----------------------------------------------------------------------

describe('buildDocGraph — 悬空引用跳过', () => {
  it('目标 id 不在 docs 集合内的引用不生成边', () => {
    const docs = [makeDoc({ id: 'a', references: ['ghost-id'] })];
    const graph = buildDocGraph(docs, defaultOpts);
    expect(graph.edges).toHaveLength(0);
  });

  it('混合有效和悬空引用：只建有效边', () => {
    const docs = [
      makeDoc({ id: 'a', references: ['b', 'nonexistent'] }),
      makeDoc({ id: 'b' }),
    ];
    const graph = buildDocGraph(docs, defaultOpts);
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0];
    if (edge === undefined) throw new Error('edge[0] should exist');
    expect(edge.target).toBe('b');
  });

  it('所有 references 都是悬空引用时 edges 为空', () => {
    const docs = [makeDoc({ id: 'a', references: ['x', 'y', 'z'] })];
    const graph = buildDocGraph(docs, defaultOpts);
    expect(graph.edges).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// 幂等性
// -----------------------------------------------------------------------

describe('buildDocGraph — 幂等性', () => {
  /** 去掉 builtAt 后对比两次产出是否字节级一致 */
  function withoutBuiltAt(graph: ReturnType<typeof buildDocGraph>): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { builtAt: _omit, ...rest } = graph;
    return JSON.stringify(rest);
  }

  it('相同输入两次调用（builtAt 相同），JSON 字节级一致', () => {
    const docs = [
      makeDoc({ id: 'b', references: ['a'] }),
      makeDoc({ id: 'a', references: [] }),
      makeDoc({ id: 'c', references: ['a', 'b'] }),
    ];
    const opts = { source: 'directory' as const, sdkVersion: '1.0.0', builtAt: FIXED_BUILT_AT };
    const g1 = buildDocGraph(docs, opts);
    const g2 = buildDocGraph(docs, opts);
    expect(withoutBuiltAt(g1)).toBe(withoutBuiltAt(g2));
  });

  it('不同 builtAt 时，去掉 builtAt 后仍字节级一致', () => {
    const docs = [makeDoc({ id: 'x', references: ['y'] }), makeDoc({ id: 'y' })];
    const g1 = buildDocGraph(docs, { source: 'llms.txt', sdkVersion: null, builtAt: '2026-01-01T00:00:00Z' });
    const g2 = buildDocGraph(docs, { source: 'llms.txt', sdkVersion: null, builtAt: '2026-12-31T23:59:59Z' });
    expect(withoutBuiltAt(g1)).toBe(withoutBuiltAt(g2));
  });

  it('输入顺序不同时，去掉 builtAt 后结果仍一致（排序幂等）', () => {
    const docs1 = [
      makeDoc({ id: 'c' }),
      makeDoc({ id: 'a', references: ['b'] }),
      makeDoc({ id: 'b' }),
    ];
    const docs2 = [
      makeDoc({ id: 'b' }),
      makeDoc({ id: 'c' }),
      makeDoc({ id: 'a', references: ['b'] }),
    ];
    const opts = { source: 'directory' as const, sdkVersion: null, builtAt: FIXED_BUILT_AT };
    const g1 = buildDocGraph(docs1, opts);
    const g2 = buildDocGraph(docs2, opts);
    expect(withoutBuiltAt(g1)).toBe(withoutBuiltAt(g2));
  });
});

// -----------------------------------------------------------------------
// 节点/边排序
// -----------------------------------------------------------------------

describe('buildDocGraph — 排序稳定性', () => {
  it('nodes 按 id 升序排列（lexicographic）', () => {
    const docs = [
      makeDoc({ id: 'z/page' }),
      makeDoc({ id: 'a/page' }),
      makeDoc({ id: 'm/page' }),
    ];
    const graph = buildDocGraph(docs, defaultOpts);
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toEqual(['a/page', 'm/page', 'z/page']);
  });

  it('edges 按 (source, target) 升序排列', () => {
    const docs = [
      makeDoc({ id: 'c', references: ['a'] }),
      makeDoc({ id: 'b', references: ['a'] }),
      makeDoc({ id: 'a' }),
    ];
    const graph = buildDocGraph(docs, defaultOpts);
    const pairs = graph.edges.map((e) => `${e.source}→${e.target}`);
    // 期望 b→a, c→a（source 字母序）
    expect(pairs).toEqual(['b→a', 'c→a']);
  });

  it('同一 source 的多条 edges 按 target 升序排列', () => {
    const docs = [
      makeDoc({ id: 'a', references: ['z', 'b', 'm'] }),
      makeDoc({ id: 'b' }),
      makeDoc({ id: 'm' }),
      makeDoc({ id: 'z' }),
    ];
    const graph = buildDocGraph(docs, defaultOpts);
    const targets = graph.edges.map((e) => e.target);
    expect(targets).toEqual(['b', 'm', 'z']);
  });
});
