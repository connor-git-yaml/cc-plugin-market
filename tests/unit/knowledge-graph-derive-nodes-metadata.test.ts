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
  deriveContainsEdges,
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

// F221：re-export 是别名门面而非真身（真身节点由目标文件贡献），
// 若不过滤会产出重复别名节点/悬空 contains 边，触碰 F217 duplicate/orphan/dangling 门。
describe('re-export 条目图派生过滤（F221）', () => {
  const facadeSkeletons = new Map<string, CodeSkeleton>([
    [
      'src/facade.ts',
      mkSk({
        filePath: 'src/facade.ts',
        exports: [
          {
            name: 'localFn',
            kind: 'function',
            signature: 'function localFn(): void',
            isDefault: false,
            startLine: 1,
            endLine: 2,
          },
          {
            name: 'reFn',
            kind: 're-export',
            signature: "export { reFn } from './real.js'",
            isDefault: false,
            startLine: 3,
            endLine: 3,
            reExportFrom: './real.js',
          },
        ],
      }),
    ],
  ]);

  it('⑩ deriveNodesFromSkeletons 不为 re-export 产出别名 symbol 节点', () => {
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: facadeSkeletons });
    expect(graph.nodes.find((n) => n.id === 'src/facade.ts::localFn')).toBeDefined();
    expect(graph.nodes.find((n) => n.id === 'src/facade.ts::reFn')).toBeUndefined();
  });

  it('⑩ deriveContainsEdges 不为 re-export 产出 contains 边', () => {
    const edges = deriveContainsEdges(facadeSkeletons);
    expect(edges.some((e) => e.target === 'src/facade.ts::localFn')).toBe(true);
    expect(edges.some((e) => e.target === 'src/facade.ts::reFn')).toBe(false);
  });
});

// F271 FR-001/FR-002/FR-003：lineRange 生产（symbol 产出、member 诚实缺席、key 形状为 {start,end}）
describe('lineRange 产出（F271 FR-001/002/003）', () => {
  it('FR-001/FR-003：symbol 节点 metadata.lineRange = { start, end }，数值等于 ExportSymbol 的 startLine/endLine', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'src/a.ts',
        mkSk({
          filePath: 'src/a.ts',
          exports: [
            {
              name: 'namedFn',
              kind: 'function',
              signature: 'function namedFn(): void',
              isDefault: false,
              startLine: 42,
              endLine: 57,
            },
          ],
        }),
      ],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    const symbolNode = graph.nodes.find((n) => n.id === 'src/a.ts::namedFn');
    expect(symbolNode).toBeDefined();
    // key 名铁律：消费端读 .start/.end，写成 { startLine, endLine } 会静默失效
    expect(symbolNode?.metadata?.['lineRange']).toEqual({ start: 42, end: 57 });
  });

  it('FR-002：member 节点 metadata 不含 lineRange key（诚实缺席，不用 class span 兜底）', () => {
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
              startLine: 10,
              endLine: 30,
              members: [
                { name: 'bar', kind: 'method', signature: 'bar(): void', isStatic: false },
              ],
            },
          ],
        }),
      ],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    const memberNode = graph.nodes.find((n) => n.id === 'src/a.ts::Foo.bar');
    expect(memberNode).toBeDefined();
    // 断言 key 不存在，而非仅断言 undefined —— {lineRange: undefined} 不是诚实缺席
    expect('lineRange' in (memberNode?.metadata ?? {})).toBe(false);
    // 同 fixture 下 class 自身的 symbol 节点必须有 lineRange（证明缺席是针对 member 而非整体失效）
    const classNode = graph.nodes.find((n) => n.id === 'src/a.ts::Foo');
    expect(classNode?.metadata?.['lineRange']).toEqual({ start: 10, end: 30 });
  });

  it('module 节点不产出 lineRange（无 symbol 级 span 来源）', () => {
    const skeletons = new Map<string, CodeSkeleton>([['src/a.ts', mkSk({ filePath: 'src/a.ts' })]]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    const moduleNode = graph.nodes.find((n) => n.id === 'src/a.ts');
    expect('lineRange' in (moduleNode?.metadata ?? {})).toBe(false);
  });
});

// F271 对抗审查 F1 — 同名符号（Python 遮蔽 / TS 重载 / declaration merging）的 span 并集。
// 修复前：first-wins 去重把后续同名 ExportSymbol 整条丢弃，lineRange 只剩第一条
// （重载场景下第一条常常只有签名行，函数体整段落在 view_file 视野外）。
describe('同名 symbol 的 lineRange 并集（F271 对抗审查 F1）', () => {
  /** 构造同文件内同名的多条 ExportSymbol（撞同一 canonical id） */
  function skeletonWithDuplicateSymbol(
    spans: ReadonlyArray<[number, number]>,
  ): ReadonlyMap<string, CodeSkeleton> {
    return new Map<string, CodeSkeleton>([
      [
        'src/a.ts',
        mkSk({
          filePath: 'src/a.ts',
          exports: spans.map(([startLine, endLine]) => ({
            name: 'dup',
            kind: 'function' as const,
            signature: 'function dup(): void',
            isDefault: false,
            startLine,
            endLine,
          })),
        }),
      ],
    ]);
  }

  it('(a) 同名函数两条 ExportSymbol (1,2)/(4,5) → 节点 lineRange 为并集 { start: 1, end: 5 }', () => {
    const graph = buildUnifiedGraph({
      projectRoot: '/proj',
      codeSkeletons: skeletonWithDuplicateSymbol([
        [1, 2],
        [4, 5],
      ]),
    });
    const dup = graph.nodes.filter((n) => n.id === 'src/a.ts::dup');
    // 去重仍生效：只有一个节点
    expect(dup).toHaveLength(1);
    expect(dup[0]?.metadata?.['lineRange']).toEqual({ start: 1, end: 5 });
  });

  it('(b) TS overload 形态三条 (1,1)/(2,2)/(3,5) → { start: 1, end: 5 }（不是只剩签名行）', () => {
    const graph = buildUnifiedGraph({
      projectRoot: '/proj',
      codeSkeletons: skeletonWithDuplicateSymbol([
        [1, 1],
        [2, 2],
        [3, 5],
      ]),
    });
    const dup = graph.nodes.find((n) => n.id === 'src/a.ts::dup');
    expect(dup?.metadata?.['lineRange']).toEqual({ start: 1, end: 5 });
  });

  it('lineRange 之外的 metadata 仍是 first-wins（不动 F214 身份合同）', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'src/a.ts',
        mkSk({
          filePath: 'src/a.ts',
          exports: [
            { name: 'dup', kind: 'function', signature: 'f1', isDefault: false, startLine: 1, endLine: 2 },
            // 第二条 kind 不同：若被后写覆盖，exportKind 会变成 'class'
            { name: 'dup', kind: 'class', signature: 'c1', isDefault: false, startLine: 4, endLine: 5 },
          ],
        }),
      ],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    const dup = graph.nodes.find((n) => n.id === 'src/a.ts::dup');
    expect(dup?.metadata?.['exportKind']).toBe('function');
    expect(dup?.metadata?.['lineRange']).toEqual({ start: 1, end: 5 });
  });
});

// F271 对抗审查 F2/F3 — 退化条目与畸形 span 一律诚实缺席
describe('lineRange 诚实缺席（F271 对抗审查 F2/F3）', () => {
  function symbolNodeWithSpan(
    span: { startLine: number; endLine: number },
    signature = 'function s(): void',
  ) {
    const skeletons = new Map<string, CodeSkeleton>([
      [
        'src/a.ts',
        mkSk({
          filePath: 'src/a.ts',
          exports: [
            {
              name: 's',
              kind: 'function',
              signature,
              isDefault: false,
              startLine: span.startLine,
              endLine: span.endLine,
            },
          ],
        }),
      ],
    ]);
    const graph = buildUnifiedGraph({ projectRoot: '/proj', codeSkeletons: skeletons });
    return graph.nodes.find((n) => n.id === 'src/a.ts::s');
  }

  it('F2：regex fallback 条目（signature 带 `[REGEX] ` 前缀）不写 lineRange —— 其 span 恒为签名单行的假值', () => {
    const node = symbolNodeWithSpan(
      { startLine: 7, endLine: 7 },
      '[REGEX] def compute(self, x):',
    );
    expect(node).toBeDefined();
    expect('lineRange' in (node?.metadata ?? {})).toBe(false);
    // 对照组：同样的单行 span，非 regex 条目正常写入（证明缺席是针对退化来源而非"单行"）
    const normal = symbolNodeWithSpan({ startLine: 7, endLine: 7 }, 'const s = 1');
    expect(normal?.metadata?.['lineRange']).toEqual({ start: 7, end: 7 });
  });

  it.each([
    ['start > end', { startLine: 9, endLine: 3 }],
    ['start = 0（非 1-indexed）', { startLine: 0, endLine: 5 }],
    ['负数行号', { startLine: -3, endLine: -1 }],
    ['非整数行号', { startLine: 1.5, endLine: 4 }],
  ])('F3：畸形 span（%s）诚实缺席，不把畸形值带进图', (_label, span) => {
    const node = symbolNodeWithSpan(span);
    expect(node).toBeDefined();
    expect('lineRange' in (node?.metadata ?? {})).toBe(false);
  });
});
