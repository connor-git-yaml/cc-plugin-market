/**
 * F217 T021 — deriveNodesFromSkeletons metadata 透传单测。
 *
 * 断言 symbol/member 节点 metadata 新增 exportKind: exp.kind（symbol）/
 * memberKind: m.kind（member）字段（决策 2 增补：orphan-check pure-type 例外分类判定依据）。
 * 通过公开 API buildUnifiedGraph 间接验证（deriveNodesFromSkeletons 为模块私有函数）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildUnifiedGraph,
  setCurrentUnifiedGraph,
} from '../../src/knowledge-graph/index.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';

function mkSk(opts: Partial<CodeSkeleton> & { filePath: string }): CodeSkeleton {
  return {
    filePath: opts.filePath,
    language: opts.language ?? 'typescript',
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
  setCurrentUnifiedGraph(null);
});

describe('deriveNodesFromSkeletons metadata 透传（间接经 buildUnifiedGraph 验证）', () => {
  it('symbol 节点 metadata 含 exportKind = exp.kind', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'src/a.ts',
        mkSk({
          filePath: 'src/a.ts',
          exports: [
            {
              name: 'IFoo',
              kind: 'interface',
              signature: 'interface IFoo {}',
              isDefault: false,
              startLine: 1,
              endLine: 1,
            },
          ],
        }),
      ],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    const symbolNode = graph.nodes.find((n) => n.id === 'src/a.ts::IFoo');
    expect(symbolNode).toBeDefined();
    expect(symbolNode?.metadata?.['exportKind']).toBe('interface');
  });

  it('member 节点 metadata 含 memberKind = m.kind', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'src/a.ts',
        mkSk({
          filePath: 'src/a.ts',
          exports: [
            {
              name: 'Foo',
              kind: 'class',
              signature: 'class Foo {}',
              isDefault: false,
              startLine: 1,
              endLine: 10,
              members: [
                {
                  name: 'bar',
                  kind: 'method',
                  signature: 'bar(): void',
                  isStatic: false,
                },
              ],
            },
          ],
        }),
      ],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    const memberNode = graph.nodes.find((n) => n.id === 'src/a.ts::Foo.bar');
    expect(memberNode).toBeDefined();
    expect(memberNode?.metadata?.['memberKind']).toBe('method');
  });

  it('module 节点不受影响，仍保留既有 callSitesCount 字段', () => {
    const skeletons = new Map<string, CodeSkeleton>([['src/a.ts', mkSk({ filePath: 'src/a.ts' })]]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    const moduleNode = graph.nodes.find((n) => n.id === 'src/a.ts');
    expect(moduleNode).toBeDefined();
    expect(moduleNode?.metadata?.['callSitesCount']).toBe(0);
    expect(moduleNode?.metadata?.['exportKind']).toBeUndefined();
  });
});
