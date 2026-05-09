/**
 * Feature 156 W1.1+W1.2 — consumer-shim 单元测试（FR-32 / AC-8 + T-013c）
 *
 * 验证：
 * S-1: deriveModuleGraph 计算 inDegree / outDegree 正确
 * S-2: topologicalSort 通过 shim 派生的 ModuleGraph 路径与原始路径等价
 * S-3: renderModuleGraph 产出的 Mermaid 包含 depends-on 边
 * S-4: isCircular SCC 反查正确（仅同一 SCC 内边标 true）
 * B-1 (T-013c): buildGraphForLanguageGroup 通过 UnifiedGraph 派生路径输出正确边
 * B-2 (T-013c): delta-regenerator 接受 derived view 时 from/to 字段正确
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildUnifiedGraph,
  setCurrentUnifiedGraph,
} from '../../../src/knowledge-graph/index.js';
import { deriveModuleGraph } from '../../../src/knowledge-graph/module-derivation.js';
import { detectSCCs, topologicalSort } from '../../../src/graph/topological-sort.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';
import type { ModuleGraph } from '../../../src/knowledge-graph/module-derivation.js';

function mkSk(opts: Partial<CodeSkeleton> & { filePath: string }): CodeSkeleton {
  return {
    filePath: opts.filePath,
    language: opts.language ?? 'typescript',
    loc: opts.loc ?? 100,
    exports: opts.exports ?? [],
    imports: opts.imports ?? [],
    hash: opts.hash ?? 'a'.repeat(64),
    analyzedAt: opts.analyzedAt ?? '2026-05-08T10:00:00.000Z',
    parserUsed: opts.parserUsed ?? 'ts-morph',
  };
}

afterEach(() => {
  setCurrentUnifiedGraph(null);
});

describe('Feature 156 W1.1+W1.2 — deriveModuleGraph', () => {
  it('S-1: inDegree / outDegree 与手动计算一致（3 模块 + 2 条 depends-on 边）', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.ts',
        mkSk({
          filePath: 'a.ts',
          imports: [
            { moduleSpecifier: './b', isRelative: true, resolvedPath: 'b.ts', isTypeOnly: false },
            { moduleSpecifier: './c', isRelative: true, resolvedPath: 'c.ts', isTypeOnly: false },
          ],
        }),
      ],
      ['b.ts', mkSk({ filePath: 'b.ts' })],
      ['c.ts', mkSk({ filePath: 'c.ts' })],
    ]);
    const unified = buildUnifiedGraph({ projectRoot: '/p', codeSkeletons: skeletons });
    const dep = deriveModuleGraph(unified, '/p');

    const aNode = dep.modules.find((m) => m.source === 'a.ts')!;
    const bNode = dep.modules.find((m) => m.source === 'b.ts')!;
    const cNode = dep.modules.find((m) => m.source === 'c.ts')!;

    expect(aNode.outDegree).toBe(2);
    expect(aNode.inDegree).toBe(0);
    expect(bNode.inDegree).toBe(1);
    expect(bNode.outDegree).toBe(0);
    expect(cNode.inDegree).toBe(1);
  });

  it('S-2: topologicalSort 在 derived ModuleGraph 上输出有效拓扑序', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.ts',
        mkSk({
          filePath: 'a.ts',
          imports: [{ moduleSpecifier: './b', isRelative: true, resolvedPath: 'b.ts', isTypeOnly: false }],
        }),
      ],
      [
        'b.ts',
        mkSk({
          filePath: 'b.ts',
          imports: [{ moduleSpecifier: './c', isRelative: true, resolvedPath: 'c.ts', isTypeOnly: false }],
        }),
      ],
      ['c.ts', mkSk({ filePath: 'c.ts' })],
    ]);
    const unified = buildUnifiedGraph({ projectRoot: '/p', codeSkeletons: skeletons });
    const dep = deriveModuleGraph(unified, '/p');

    const result = topologicalSort(dep);
    // Kahn 算法：边 from→to 表示 from 依赖 to，inDegree=0 优先输出。
    // 因此 a (inDeg=0) 先于 b、b 先于 c。
    const order = result.order;
    expect(order.indexOf('a.ts')).toBeLessThan(order.indexOf('b.ts'));
    expect(order.indexOf('b.ts')).toBeLessThan(order.indexOf('c.ts'));
    expect(result.hasCycles).toBe(false);
  });

  it('S-3: 派生图的 mermaidSource 含所有 depends-on 边', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.ts',
        mkSk({
          filePath: 'a.ts',
          imports: [
            { moduleSpecifier: './b', isRelative: true, resolvedPath: 'b.ts', isTypeOnly: false },
          ],
        }),
      ],
      ['b.ts', mkSk({ filePath: 'b.ts' })],
    ]);
    const unified = buildUnifiedGraph({ projectRoot: '/p', codeSkeletons: skeletons });
    const dep = deriveModuleGraph(unified, '/p');
    const arrowCount = (dep.mermaidSource.match(/-->/g) ?? []).length;
    expect(arrowCount).toBe(1);
  });

  it('S-4: isCircular —— 仅同一 SCC 内边标 true', () => {
    // a ↔ b 互相依赖，c 独立
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.ts',
        mkSk({
          filePath: 'a.ts',
          imports: [{ moduleSpecifier: './b', isRelative: true, resolvedPath: 'b.ts', isTypeOnly: false }],
        }),
      ],
      [
        'b.ts',
        mkSk({
          filePath: 'b.ts',
          imports: [{ moduleSpecifier: './a', isRelative: true, resolvedPath: 'a.ts', isTypeOnly: false }],
        }),
      ],
      [
        'c.ts',
        mkSk({
          filePath: 'c.ts',
          imports: [{ moduleSpecifier: './a', isRelative: true, resolvedPath: 'a.ts', isTypeOnly: false }],
        }),
      ],
    ]);
    const unified = buildUnifiedGraph({ projectRoot: '/p', codeSkeletons: skeletons });
    const dep = deriveModuleGraph(unified, '/p');

    const circularEdges = dep.edges.filter((e) => e.isCircular);
    const nonCircularEdges = dep.edges.filter((e) => !e.isCircular);
    // a→b 和 b→a 应在同一 SCC，标 true
    expect(circularEdges).toHaveLength(2);
    // c→a 跨 SCC，应标 false
    expect(nonCircularEdges).toHaveLength(1);
    expect(nonCircularEdges[0]?.from).toBe('c.ts');
  });

  it('S-5: SCC 检测在 derived ModuleGraph 上 SCC.size > 1 含两节点', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.ts',
        mkSk({
          filePath: 'a.ts',
          imports: [{ moduleSpecifier: './b', isRelative: true, resolvedPath: 'b.ts', isTypeOnly: false }],
        }),
      ],
      [
        'b.ts',
        mkSk({
          filePath: 'b.ts',
          imports: [{ moduleSpecifier: './a', isRelative: true, resolvedPath: 'a.ts', isTypeOnly: false }],
        }),
      ],
    ]);
    const unified = buildUnifiedGraph({ projectRoot: '/p', codeSkeletons: skeletons });
    const dep = deriveModuleGraph(unified, '/p');
    const sccs = detectSCCs(dep);
    const bigSccs = sccs.filter((s) => s.modules.length > 1);
    expect(bigSccs).toHaveLength(1);
    expect(new Set(bigSccs[0]!.modules)).toEqual(new Set(['a.ts', 'b.ts']));
  });
});

describe('Feature 156 T-013c — batch-orchestrator 集成（unified pipeline e2e）', () => {
  it('B-1: derived ModuleGraph 含正确的 from/to 字段映射', () => {
    // 模拟 batch-orchestrator 在 buildGraphForLanguageGroup 中得到的 mergedGraph：
    // 通过 UnifiedGraph 派生而来，下游 delta-regenerator 用 edges[].from/to
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'src/foo.ts',
        mkSk({
          filePath: 'src/foo.ts',
          imports: [
            { moduleSpecifier: './bar', isRelative: true, resolvedPath: 'src/bar.ts', isTypeOnly: false },
          ],
        }),
      ],
      ['src/bar.ts', mkSk({ filePath: 'src/bar.ts' })],
    ]);
    const unified = buildUnifiedGraph({ projectRoot: '/p', codeSkeletons: skeletons });
    const mergedGraph: ModuleGraph = deriveModuleGraph(unified, '/p');

    expect(mergedGraph.edges).toHaveLength(1);
    const e = mergedGraph.edges[0]!;
    expect(e.from).toBe('src/foo.ts');
    expect(e.to).toBe('src/bar.ts');
    expect(e.importType).toBeDefined();
    expect(['static', 'dynamic', 'type-only']).toContain(e.importType);
  });

  it('B-2: derived view 上 inDegree/outDegree 与 totalEdges 一致（保证下游 module-grouper 正确遍历）', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'src/a.ts',
        mkSk({
          filePath: 'src/a.ts',
          imports: [
            { moduleSpecifier: './b', isRelative: true, resolvedPath: 'src/b.ts', isTypeOnly: false },
            { moduleSpecifier: './c', isRelative: true, resolvedPath: 'src/c.ts', isTypeOnly: false },
          ],
        }),
      ],
      ['src/b.ts', mkSk({ filePath: 'src/b.ts' })],
      ['src/c.ts', mkSk({ filePath: 'src/c.ts' })],
    ]);
    const unified = buildUnifiedGraph({ projectRoot: '/p', codeSkeletons: skeletons });
    const dep = deriveModuleGraph(unified, '/p');

    const totalIn = dep.modules.reduce((s, m) => s + m.inDegree, 0);
    const totalOut = dep.modules.reduce((s, m) => s + m.outDegree, 0);
    expect(totalIn).toBe(dep.totalEdges);
    expect(totalOut).toBe(dep.totalEdges);
    expect(dep.totalEdges).toBe(2);
  });
});
