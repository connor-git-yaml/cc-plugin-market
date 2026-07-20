/**
 * orphan-check 单测（F217 T015）
 * 覆盖 FR-005：degree=0（含 contains 边）判定、三类例外分类（entrypoint/pure-type/test-export）
 * 各自独立断言、全部例外命中导致"超标分子=0"边界、allNodeZeroDegreeRatio 信息展示字段独立断言
 * （不影响 pass/fail）、分母为 0 时 not-applicable。
 */
import { describe, it, expect } from 'vitest';
import { checkOrphanRatio, type OrphanCheckTestPatterns } from './orphan-check.js';
import type { GraphEdge, GraphJSON, GraphNode } from '../graph-types.js';

function symbolNode(
  id: string,
  metadata: Record<string, unknown> = {},
): GraphNode {
  return { id, kind: 'component', label: id, metadata: { unifiedKind: 'symbol', ...metadata } };
}
function moduleNode(id: string): GraphNode {
  return { id, kind: 'module', label: id, metadata: { unifiedKind: 'module' } };
}
function edge(source: string, target: string, relation = 'contains'): GraphEdge {
  return { source, target, relation, confidence: 'EXTRACTED', confidenceScore: 1 };
}

function makeGraph(nodes: GraphNode[], links: GraphEdge[] = []): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: links.length,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
    },
    nodes,
    links,
  };
}

const noTestPatterns = (): OrphanCheckTestPatterns | null => null;

describe('checkOrphanRatio', () => {
  it('分母为 0（无 symbol 节点）时判定为 not-applicable', () => {
    const graph = makeGraph([moduleNode('src/a.ts')]);
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.status).toBe('not-applicable');
    expect(result.totalSymbolNodes).toBe(0);
    expect(result.offendingRatio).toBeNull();
    expect(result.offendingIds).toEqual([]);
  });

  it('pass：全部 symbol 节点 degree>0（无 orphan）', () => {
    const graph = makeGraph(
      [moduleNode('src/a.ts'), symbolNode('src/a.ts::foo')],
      [edge('src/a.ts', 'src/a.ts::foo')],
    );
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.status).toBe('pass');
    expect(result.rawOrphanCount).toBe(0);
    expect(result.offendingRatio).toBe(0);
  });

  it('fail：zero-degree symbol 超过 5% 阈值且未落入任何例外分类', () => {
    // 20 个 symbol 节点，1 个 zero-degree（5%边界之上，1/20=5% 恰好等于阈值应 pass；
    // 改造成 2/20=10% 触发 fail）
    const nodes: GraphNode[] = [];
    const links: GraphEdge[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(symbolNode(`src/a.ts::sym${i}`));
    }
    // 前 18 个有 contains 入边，后 2 个 zero-degree 且不落例外
    for (let i = 0; i < 18; i++) {
      links.push(edge('src/a.ts', `src/a.ts::sym${i}`));
    }
    const graph = makeGraph(nodes, links);
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.status).toBe('fail');
    expect(result.rawOrphanCount).toBe(2);
    expect(result.offendingIds).toEqual(['src/a.ts::sym18', 'src/a.ts::sym19']);
    expect(result.offendingRatio).toBeCloseTo(0.1);
  });

  it('恰好 5% 阈值（≤5%）判定为 pass', () => {
    const nodes: GraphNode[] = [];
    const links: GraphEdge[] = [];
    for (let i = 0; i < 20; i++) nodes.push(symbolNode(`src/a.ts::sym${i}`));
    for (let i = 0; i < 19; i++) links.push(edge('src/a.ts', `src/a.ts::sym${i}`));
    // sym19 zero-degree，1/20=5%，边界 <=5% 应 pass
    const graph = makeGraph(nodes, links);
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.status).toBe('pass');
    expect(result.offendingRatio).toBeCloseTo(0.05);
  });

  it('例外分类 - entrypoint：zero-degree 且 sourcePath basename 命中 main./index./__init__.py 不计入超标分子', () => {
    const graph = makeGraph([
      symbolNode('main.ts::start', { sourcePath: 'main.ts' }),
      symbolNode('src/index.ts::run', { sourcePath: 'src/index.ts' }),
      symbolNode('pkg/__init__.py::setup', { sourcePath: 'pkg/__init__.py' }),
    ]);
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.rawOrphanCount).toBe(3);
    expect(result.exemptedByCategory.entrypoint).toBe(3);
    expect(result.offendingIds).toEqual([]);
    expect(result.status).toBe('pass');
  });

  it('例外分类 - pure-type：metadata.exportKind 为 interface/type 不计入超标分子', () => {
    const graph = makeGraph([
      symbolNode('src/a.ts::IFoo', { exportKind: 'interface', sourcePath: 'src/a.ts' }),
      symbolNode('src/a.ts::TBar', { exportKind: 'type', sourcePath: 'src/a.ts' }),
    ]);
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.exemptedByCategory['pure-type']).toBe(2);
    expect(result.offendingIds).toEqual([]);
  });

  it('例外分类 - test-export：注入的 getTestPatterns 命中不计入超标分子', () => {
    const getTestPatterns = (sourcePath: string): OrphanCheckTestPatterns | null => {
      if (sourcePath.endsWith('.ts')) {
        return { filePattern: /\.test\.ts$/, testDirs: ['__tests__'] };
      }
      return null;
    };
    const graph = makeGraph([
      symbolNode('src/a.test.ts::helper', { sourcePath: 'src/a.test.ts' }),
      symbolNode('src/__tests__/b.ts::helper2', { sourcePath: 'src/__tests__/b.ts' }),
    ]);
    const result = checkOrphanRatio(graph, { getTestPatterns });
    expect(result.exemptedByCategory['test-export']).toBe(2);
    expect(result.offendingIds).toEqual([]);
  });

  it('查不到适配器（getTestPatterns 返回 null）时保守失败——不归为 test-export 例外', () => {
    const graph = makeGraph([symbolNode('src/a.rs::foo', { sourcePath: 'src/a.rs' })]);
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.exemptedByCategory['test-export']).toBe(0);
    expect(result.offendingIds).toEqual(['src/a.rs::foo']);
    expect(result.status).toBe('fail');
  });

  it('例外分类 - test-export：多段路径 testDirs（如 Java 的 src/test/java）根前缀匹配', () => {
    const getTestPatterns = (): OrphanCheckTestPatterns => ({
      filePattern: /^(.*Test|Test.*|.*Tests|.*IT)\.java$/,
      testDirs: ['src/test/java'],
    });
    const graph = makeGraph([
      // 根前缀命中：路径以 src/test/java/ 开头
      symbolNode('src/test/java/com/example/Helper.java::setup', {
        sourcePath: 'src/test/java/com/example/Helper.java',
      }),
    ]);
    const result = checkOrphanRatio(graph, { getTestPatterns });
    expect(result.exemptedByCategory['test-export']).toBe(1);
    expect(result.offendingIds).toEqual([]);
  });

  it('例外分类 - test-export：多段路径 testDirs 中间段匹配（非根前缀）', () => {
    const getTestPatterns = (): OrphanCheckTestPatterns => ({
      filePattern: /^(.*Test|Test.*|.*Tests|.*IT)\.java$/,
      testDirs: ['src/test/java'],
    });
    const graph = makeGraph([
      // 中间段命中：src/test/java 出现在路径中间而非根前缀
      symbolNode('module-a/src/test/java/com/example/Helper.java::setup', {
        sourcePath: 'module-a/src/test/java/com/example/Helper.java',
      }),
    ]);
    const result = checkOrphanRatio(graph, { getTestPatterns });
    expect(result.exemptedByCategory['test-export']).toBe(1);
    expect(result.offendingIds).toEqual([]);
  });

  it('全部 zero-degree 节点均命中例外分类时，超标分子为 0（edge case）', () => {
    const graph = makeGraph([
      symbolNode('main.ts::start', { sourcePath: 'main.ts' }),
      symbolNode('src/a.ts::IFoo', { exportKind: 'interface', sourcePath: 'src/a.ts' }),
    ]);
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.offendingIds).toEqual([]);
    expect(result.offendingRatio).toBe(0);
    expect(result.status).toBe('pass');
  });

  it('allNodeZeroDegreeRatio 为信息展示字段，不参与 pass/fail 判定', () => {
    // 构造：symbol 节点全部有边（orphanRatio pass），但存在大量 zero-degree 的 module 节点
    const graph = makeGraph(
      [
        symbolNode('src/a.ts::foo'),
        moduleNode('src/b.ts'),
        moduleNode('src/c.ts'),
        moduleNode('src/d.ts'),
      ],
      [edge('src/a.ts', 'src/a.ts::foo')],
    );
    const result = checkOrphanRatio(graph, { getTestPatterns: noTestPatterns });
    expect(result.status).toBe('pass'); // symbol 侧无 orphan
    // 4 个节点中 src/b/c/d.ts 三个 module 节点 zero-degree（src/a.ts 有 contains 出边）
    expect(result.allNodeZeroDegreeRatio).toBeCloseTo(3 / 4);
  });
});
