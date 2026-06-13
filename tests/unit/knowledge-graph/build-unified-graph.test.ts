/**
 * Feature 151 T-008 — buildUnifiedGraph 端到端单测（FR-3 + Codex C-3）
 *
 * 验证：
 * - deriveImportEdges 从 CodeSkeleton.imports 派生 depends-on 边
 * - buildUnifiedGraph 同时产 calls + depends-on 边
 * - setCurrentUnifiedGraph / getCurrentUnifiedGraph 单例 cache
 * - schemaVersion / metadata 字段完整
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildUnifiedGraph,
  deriveImportEdges,
  getCurrentUnifiedGraph,
  setCurrentUnifiedGraph,
  UNIFIED_GRAPH_SCHEMA_VERSION,
  UnifiedGraphSchema,
} from '../../../src/knowledge-graph/index.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';

function mkSk(opts: Partial<CodeSkeleton> & { filePath: string }): CodeSkeleton {
  return {
    filePath: opts.filePath,
    language: opts.language ?? 'python',
    loc: opts.loc ?? 100,
    exports: opts.exports ?? [],
    imports: opts.imports ?? [],
    hash: opts.hash ?? 'a'.repeat(64),
    analyzedAt: opts.analyzedAt ?? '2026-05-08T10:00:00.000Z',
    parserUsed: opts.parserUsed ?? 'tree-sitter',
    callSites: opts.callSites,
  };
}

afterEach(() => {
  // 清理单例 cache，避免 test 间污染
  setCurrentUnifiedGraph(null);
});

describe('deriveImportEdges (Codex C-3 修订)', () => {
  it('从 imports[].resolvedPath 派生 depends-on 边', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.py',
        mkSk({
          filePath: 'a.py',
          imports: [
            {
              moduleSpecifier: 'b',
              isRelative: true,
              resolvedPath: 'b.py',
              namedImports: ['Foo'],
              isTypeOnly: false,
            },
          ],
        }),
      ],
      ['b.py', mkSk({ filePath: 'b.py' })],
    ]);
    const edges = deriveImportEdges(skeletons);
    expect(edges).toHaveLength(1);
    const e = edges[0];
    expect(e.source).toBe('a.py');
    expect(e.target).toBe('b.py');
    expect(e.relation).toBe('depends-on');
    expect(e.confidence).toBe('high');
    expect(e.directional).toBe(true);
    expect(e.evidence).toBe('b');
  });

  it('忽略 resolvedPath 缺失的 import', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.py',
        mkSk({
          filePath: 'a.py',
          imports: [
            {
              moduleSpecifier: 'unresolved.lib',
              isRelative: false,
              namedImports: ['x'],
              isTypeOnly: false,
            },
          ],
        }),
      ],
    ]);
    const edges = deriveImportEdges(skeletons);
    expect(edges).toHaveLength(0);
  });

  it('忽略自引用 (resolvedPath === callerFile)', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'a.py',
        mkSk({
          filePath: 'a.py',
          imports: [
            {
              moduleSpecifier: 'a',
              isRelative: true,
              resolvedPath: 'a.py',
              namedImports: ['self_ref'],
              isTypeOnly: false,
            },
          ],
        }),
      ],
    ]);
    expect(deriveImportEdges(skeletons)).toHaveLength(0);
  });
});

describe('buildUnifiedGraph (FR-3)', () => {
  it('mock CodeSkeleton (含 callSites + imports) → UnifiedGraph 含 calls + depends-on 边', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'main.py',
        mkSk({
          filePath: 'main.py',
          imports: [
            {
              moduleSpecifier: 'utils',
              isRelative: true,
              resolvedPath: 'utils.py',
              namedImports: ['helper'],
              isTypeOnly: false,
            },
          ],
          callSites: [
            { calleeName: 'helper', calleeKind: 'cross-module', line: 10 },
          ],
          exports: [
            { name: 'main', kind: 'function', signature: 'def main()', isDefault: false, startLine: 1, endLine: 20 },
          ],
        }),
      ],
      [
        'utils.py',
        mkSk({
          filePath: 'utils.py',
          exports: [
            { name: 'helper', kind: 'function', signature: 'def helper()', isDefault: false, startLine: 1, endLine: 5 },
          ],
        }),
      ],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: '/repo', codeSkeletons: skeletons });

    // schema 校验
    expect(() => UnifiedGraphSchema.parse(graph)).not.toThrow();
    expect(graph.metadata.schemaVersion).toBe(UNIFIED_GRAPH_SCHEMA_VERSION);
    // Feature 193 决策 1：metadata.projectRoot 持久化为相对标记 '.'（可移植）
    expect(graph.metadata.projectRoot).toBe('.');

    // 边类型分组
    const callEdges = graph.edges.filter((e) => e.relation === 'calls');
    const dependEdges = graph.edges.filter((e) => e.relation === 'depends-on');
    expect(callEdges).toHaveLength(1);
    expect(callEdges[0].confidence).toBe('medium'); // cross-module → medium
    expect(callEdges[0].target).toBe('utils.py::helper');
    expect(dependEdges).toHaveLength(1);
    expect(dependEdges[0].source).toBe('main.py');
    expect(dependEdges[0].target).toBe('utils.py');

    // 节点派生
    const moduleNodes = graph.nodes.filter((n) => n.kind === 'module');
    expect(moduleNodes).toHaveLength(2);
    const symbolNodes = graph.nodes.filter((n) => n.kind === 'symbol');
    expect(symbolNodes.length).toBeGreaterThan(0);

    // module 节点 metadata 含 callSitesCount
    const mainNode = moduleNodes.find((n) => n.id === 'main.py');
    expect(mainNode?.metadata?.callSitesCount).toBe(1);
    const utilsNode = moduleNodes.find((n) => n.id === 'utils.py');
    expect(utilsNode?.metadata?.callSitesCount).toBe(0);
  });

  it('preBuiltNodes 提供时跳过自动节点派生', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      ['a.py', mkSk({ filePath: 'a.py' })],
    ]);
    const customNodes = [
      { id: 'custom-1', label: 'Custom 1', kind: 'spec' as const },
      { id: 'custom-2', label: 'Custom 2', kind: 'document' as const },
    ];
    const graph = buildUnifiedGraph({
      projectRoot: '/repo',
      codeSkeletons: skeletons,
      preBuiltNodes: customNodes,
    });
    expect(graph.nodes).toEqual(customNodes);
  });

  it('空 codeSkeletons → 空图但 schema 仍然合法', () => {
    const graph = buildUnifiedGraph({
      projectRoot: '/repo',
      codeSkeletons: new Map(),
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(() => UnifiedGraphSchema.parse(graph)).not.toThrow();
  });
});

describe('单例 cache (FR-7 DI provider + Codex W-1)', () => {
  it('setCurrentUnifiedGraph + getCurrentUnifiedGraph 配对', () => {
    expect(getCurrentUnifiedGraph()).toBeNull(); // 初始
    const g = buildUnifiedGraph({ projectRoot: '/repo', codeSkeletons: new Map() });
    setCurrentUnifiedGraph(g);
    expect(getCurrentUnifiedGraph()).toBe(g);
    setCurrentUnifiedGraph(null);
    expect(getCurrentUnifiedGraph()).toBeNull();
  });
});
