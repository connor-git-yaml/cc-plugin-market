/**
 * Bug 142 — graph-query tokenize 单元测试
 *
 * 覆盖场景：
 * 1. PascalCase 拆分：'PQueue' → ['queue']（'p' 长度=1 被过滤）
 * 2. 连续大写 + PascalCase 混合：'XMLParser' → ['xml', 'parser']
 * 3. 普通空格分隔：'hello world' → ['hello', 'world']
 * 4. kebab-case：'priority-queue' → ['priority', 'queue']
 * 5. snake_case：'http_client' → ['http', 'client']
 * 6. dot 分隔：'foo.bar.baz' → ['foo', 'bar', 'baz']
 * 7. 中文不被错误拆分：'优先队列' → ['优先队列']
 * 8. 空字符串：'' → []
 * 9. 全单字符词：'a b c' → []（过滤 length ≤ 1）
 * 10. 重复词去重：'queue queue Queue' → ['queue']
 * 11. 实际 query 集成场景：'How does PQueue handle concurrency?' 含 'queue'
 * 12. GraphQueryEngine.query() 端到端：PascalCase 查询命中 priority-queue label
 */
import { describe, expect, it } from 'vitest';
import { tokenize, GraphQueryEngine } from '../../src/panoramic/graph/graph-query.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

function makeGraphMeta(): GraphJSON['graph'] {
  return {
    name: 'spectra-knowledge-graph',
    generatedAt: '2026-04-27T00:00:00.000Z',
    nodeCount: 0,
    edgeCount: 0,
    sources: ['architecture-ir'],
    schemaVersion: '2.0',
  };
}

describe('tokenize() — PascalCase / 多种分隔符拆分', () => {
  it('场景 1：PascalCase 拆分 PQueue → 含 queue（"p" 因长度=1 被过滤）', () => {
    const tokens = tokenize('PQueue');
    expect(tokens).toContain('queue');
    expect(tokens).not.toContain('p');
  });

  it('场景 2：连续大写 + PascalCase XMLParser → ["xml", "parser"]', () => {
    const tokens = tokenize('XMLParser');
    expect(tokens).toContain('xml');
    expect(tokens).toContain('parser');
  });

  it('场景 3：空格分隔 hello world → ["hello", "world"]', () => {
    expect(tokenize('hello world')).toEqual(['hello', 'world']);
  });

  it('场景 4：kebab-case priority-queue → ["priority", "queue"]', () => {
    expect(tokenize('priority-queue')).toEqual(['priority', 'queue']);
  });

  it('场景 5：snake_case http_client → ["http", "client"]', () => {
    expect(tokenize('http_client')).toEqual(['http', 'client']);
  });

  it('场景 6：dot 分隔 foo.bar.baz → ["foo", "bar", "baz"]', () => {
    expect(tokenize('foo.bar.baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('场景 7：中文整段保留，不被 PascalCase 正则误拆', () => {
    const tokens = tokenize('优先队列');
    // 中文无大小写差异，PascalCase 正则不命中；按分隔符拆分后整段保留
    expect(tokens).toContain('优先队列');
  });

  it('场景 8：空字符串 → []', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('场景 9：全单字符 a b c → []（length > 1 过滤）', () => {
    expect(tokenize('a b c')).toEqual([]);
  });

  it('场景 10：重复词去重，case-insensitive', () => {
    const tokens = tokenize('queue queue Queue');
    expect(tokens).toEqual(['queue']);
  });

  it('场景 11：实际查询 "How does PQueue handle concurrency?" 含 queue', () => {
    const tokens = tokenize('How does PQueue handle concurrency?');
    expect(tokens).toContain('queue');
    expect(tokens).toContain('how');
    expect(tokens).toContain('does');
    expect(tokens).toContain('handle');
    // 'concurrency?' 末尾问号不是分隔符，所以会保留为 'concurrency?'；
    // 但 query 引擎的 includes() 匹配仍能命中含 'concurrency' 的字符串
    expect(tokens.some((t) => t.includes('concurrency'))).toBe(true);
  });
});

describe('GraphQueryEngine.query() — PascalCase 端到端', () => {
  it('场景 12：query("PQueue") 命中 label="priority-queue" 节点', () => {
    const graph: GraphJSON = {
      directed: true,
      multigraph: false,
      graph: makeGraphMeta(),
      nodes: [
        {
          id: 'priority-queue',
          kind: 'module',
          label: 'priority-queue',
          metadata: { sourcePath: 'src/priority-queue.ts' },
        },
        {
          id: 'unrelated',
          kind: 'module',
          label: 'unrelated-module',
          metadata: { sourcePath: 'src/other.ts' },
        },
      ],
      links: [],
    };
    const engine = new GraphQueryEngine(graph);
    const result = engine.query('PQueue');

    // tokenize('PQueue') 含 'queue'，label 'priority-queue' lowercase 含 'queue' → 命中
    const matchedIds = result.nodes.map((n) => n.id);
    expect(matchedIds).toContain('priority-queue');
  });

  it('query("") 仍返回空结果（边界不退化）', () => {
    const graph: GraphJSON = {
      directed: true,
      multigraph: false,
      graph: makeGraphMeta(),
      nodes: [
        { id: 'foo', kind: 'module', label: 'foo', metadata: {} },
      ],
      links: [],
    };
    const engine = new GraphQueryEngine(graph);
    const result = engine.query('');
    expect(result.nodes).toHaveLength(0);
    expect(result.summary).toContain('查询词为空');
  });

  it('query("XMLParser") 命中 label="xml-parser" 节点（连续大写场景）', () => {
    const graph: GraphJSON = {
      directed: true,
      multigraph: false,
      graph: makeGraphMeta(),
      nodes: [
        { id: 'xml-parser', kind: 'module', label: 'xml-parser', metadata: { sourcePath: 'src/xml-parser.ts' } },
      ],
      links: [],
    };
    const engine = new GraphQueryEngine(graph);
    const result = engine.query('XMLParser');
    expect(result.nodes.map((n) => n.id)).toContain('xml-parser');
  });
});
