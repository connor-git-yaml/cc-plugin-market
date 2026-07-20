/**
 * Feature 214 T002（=plan T1）— deriveContainsEdges 语言无关派生（FR-001/002/011, SC-002）
 *
 * RED 写法：deriveContainsEdges 在 T007 实现前尚未导出；本测试直接引用命名导出，
 * 实现前调用即 TypeError（vitest esbuild 不做类型检查，运行时 undefined），
 * 断言失败可收集，无 collection error。
 *
 * 覆盖矩阵：
 * - TS 两级 module→class→member
 * - JS 顶层函数 + class member
 * - Python class member 四类（method/property/classmethod/staticmethod）对称
 * - Python 顶层函数一级边
 * - 无 module→member 扁平边
 * - 【C1】同名 getter/setter（+重载）折叠为单节点/单边
 * - 【C2】coverage oracle：分母从 CodeSkeleton 自动构造（exports + members），
 *   逐一断言每个 symbol/member 恰有正确层级的 contains 入边，coverage=100%
 */
import { describe, expect, it } from 'vitest';

import {
  buildUnifiedGraph,
  deriveContainsEdges,
  type UnifiedEdge,
} from '../../../src/knowledge-graph/index.js';
import type {
  CodeSkeleton,
  ExportSymbol,
  MemberInfo,
  Language,
} from '../../../src/models/code-skeleton.js';

// ───────────────────────── fixture helpers ─────────────────────────

function mkMember(name: string, kind: MemberInfo['kind']): MemberInfo {
  return { name, kind, signature: `${kind} ${name}()`, isStatic: kind === 'staticmethod' };
}

function mkExport(
  name: string,
  kind: ExportSymbol['kind'],
  members?: MemberInfo[],
): ExportSymbol {
  return {
    name,
    kind,
    signature: `${kind} ${name}`,
    isDefault: false,
    startLine: 1,
    endLine: 10,
    ...(members ? { members } : {}),
  };
}

function mkSk(filePath: string, language: Language, exports: ExportSymbol[]): CodeSkeleton {
  return {
    filePath,
    language,
    loc: 100,
    exports,
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-07-20T10:00:00.000Z',
    parserUsed: language === 'python' ? 'tree-sitter' : 'ts-morph',
  };
}

/** 边的 (source→target) 语义 key，仅取 contains 边 */
function containsPairs(edges: readonly UnifiedEdge[]): string[] {
  return edges
    .filter((e) => e.relation === 'contains')
    .map((e) => `${e.source}=>${e.target}`);
}

/** 从 skeletons 自动构造期望 contains 集合（C2 分母，非硬编码清单） */
function expectedContains(skeletons: Map<string, CodeSkeleton>): Set<string> {
  const set = new Set<string>();
  for (const [fp, sk] of skeletons) {
    for (const exp of sk.exports) {
      const symId = `${fp}::${exp.name}`;
      set.add(`${fp}=>${symId}`); // module→symbol/class
      for (const m of exp.members ?? []) {
        set.add(`${symId}=>${symId}.${m.name}`); // class→member（同名 member 天然折叠去重）
      }
    }
  }
  return set;
}

// ───────────────────────── TS 两级 ─────────────────────────

describe('deriveContainsEdges — TS module→class→member 两级（FR-002）', () => {
  it('class 含两方法 → module→class 一条 + class→method 两条，无 module→method 扁平边', () => {
    const sk = mkSk('src/svc.ts', 'typescript', [
      mkExport('AuthService', 'class', [mkMember('login', 'method'), mkMember('logout', 'method')]),
    ]);
    const skeletons = new Map([['src/svc.ts', sk]]);
    const edges = deriveContainsEdges(skeletons);
    const pairs = containsPairs(edges);

    const cls = 'src/svc.ts::AuthService';
    expect(pairs).toContain(`src/svc.ts=>${cls}`);
    expect(pairs).toContain(`${cls}=>${cls}.login`);
    expect(pairs).toContain(`${cls}=>${cls}.logout`);
    // 无 module→member 扁平直连边
    expect(pairs).not.toContain(`src/svc.ts=>${cls}.login`);
    expect(pairs).not.toContain(`src/svc.ts=>${cls}.logout`);
  });
});

// ───────────────────────── JS 顶层 + class ─────────────────────────

describe('deriveContainsEdges — JS 顶层函数 + class member', () => {
  it('顶层函数只产 module→function 一级；class 产两级', () => {
    const skeletons = new Map([
      ['a.js', mkSk('a.js', 'javascript', [
        mkExport('helper', 'function'),
        mkExport('Widget', 'class', [mkMember('render', 'method')]),
      ])],
    ]);
    const edges = deriveContainsEdges(skeletons);
    const pairs = containsPairs(edges);

    expect(pairs).toContain('a.js=>a.js::helper');
    // helper 无 member 层级
    expect(pairs.filter((p) => p.startsWith('a.js::helper=>'))).toHaveLength(0);
    expect(pairs).toContain('a.js=>a.js::Widget');
    expect(pairs).toContain('a.js::Widget=>a.js::Widget.render');
  });
});

// ───────────────────────── Python 四类 member 对称 ─────────────────────────

describe('deriveContainsEdges — Python class member 四类对称（FR-002）', () => {
  it('method/property/classmethod/staticmethod 各产一条 class→member，层级与 TS 一致', () => {
    const skeletons = new Map([
      ['m.py', mkSk('m.py', 'python', [
        mkExport('Model', 'class', [
          mkMember('forward', 'method'),
          mkMember('shape', 'property'),
          mkMember('from_config', 'classmethod'),
          mkMember('build', 'staticmethod'),
        ]),
      ])],
    ]);
    const edges = deriveContainsEdges(skeletons);
    const pairs = containsPairs(edges);

    const cls = 'm.py::Model';
    expect(pairs).toContain(`m.py=>${cls}`);
    for (const mem of ['forward', 'shape', 'from_config', 'build']) {
      expect(pairs).toContain(`${cls}=>${cls}.${mem}`);
      // 每个 member 只允许一条来自 class 的入边，无 module→member 扁平边
      expect(pairs).not.toContain(`m.py=>${cls}.${mem}`);
    }
    // class→member 恰四条
    expect(pairs.filter((p) => p.startsWith(`${cls}=>`))).toHaveLength(4);
  });

  it('Python 顶层函数只产 module→function 一级边，无虚假 member 层级', () => {
    const skeletons = new Map([
      ['t.py', mkSk('t.py', 'python', [mkExport('main', 'function')])],
    ]);
    const pairs = containsPairs(deriveContainsEdges(skeletons));
    expect(pairs).toEqual(['t.py=>t.py::main']);
  });
});

// ───────────────────────── C1 同名折叠 ─────────────────────────

describe('deriveContainsEdges — 同名 member 折叠为单节点/单边（FR-011, C1）', () => {
  it('getter/setter 同名 x → 单一 member 节点 + 单一 class→member 边（不重复）', () => {
    const skeletons = new Map([
      ['g.ts', mkSk('g.ts', 'typescript', [
        mkExport('Box', 'class', [mkMember('x', 'getter'), mkMember('x', 'setter')]),
      ])],
    ]);
    const edges = deriveContainsEdges(skeletons);
    const pairs = containsPairs(edges);
    const cls = 'g.ts::Box';
    // 同名 x 折叠：仅一条 class→Box.x 边
    expect(pairs.filter((p) => p === `${cls}=>${cls}.x`)).toHaveLength(1);

    // UnifiedGraph 生产端：节点也唯一（buildUnifiedGraph 内 deriveNodesFromSkeletons 去重）
    const graph = buildUnifiedGraph({ projectRoot: '.', codeSkeletons: skeletons });
    const memberNodes = graph.nodes.filter((n) => n.id === `${cls}.x`);
    expect(memberNodes).toHaveLength(1);
    // contains 边并入 UnifiedGraph 且唯一
    const gPairs = containsPairs(graph.edges);
    expect(gPairs.filter((p) => p === `${cls}=>${cls}.x`)).toHaveLength(1);
  });

  it('重载函数（同名多次）折叠为单一 member 节点', () => {
    const skeletons = new Map([
      ['o.ts', mkSk('o.ts', 'typescript', [
        mkExport('Api', 'class', [
          mkMember('call', 'method'),
          mkMember('call', 'method'),
          mkMember('call', 'method'),
        ]),
      ])],
    ]);
    const pairs = containsPairs(deriveContainsEdges(skeletons));
    expect(pairs.filter((p) => p === 'o.ts::Api=>o.ts::Api.call')).toHaveLength(1);
  });
});

// ───────────────────────── C2 coverage oracle ─────────────────────────

describe('deriveContainsEdges — coverage oracle 100%（SC-002, C2）', () => {
  it('混合 TS+JS+Python 全 fixture：每个 symbol/member 恰有正确层级 contains 入边，coverage=100%', () => {
    const skeletons = new Map<string, CodeSkeleton>([
      ['src/svc.ts', mkSk('src/svc.ts', 'typescript', [
        mkExport('AuthService', 'class', [mkMember('login', 'method'), mkMember('logout', 'method')]),
        mkExport('CONST', 'const'),
      ])],
      ['a.js', mkSk('a.js', 'javascript', [
        mkExport('helper', 'function'),
        mkExport('Widget', 'class', [mkMember('render', 'method')]),
      ])],
      ['m.py', mkSk('m.py', 'python', [
        mkExport('Model', 'class', [
          mkMember('forward', 'method'),
          mkMember('shape', 'property'),
          mkMember('from_config', 'classmethod'),
          mkMember('build', 'staticmethod'),
        ]),
        mkExport('main', 'function'),
      ])],
    ]);

    const actual = new Set(containsPairs(deriveContainsEdges(skeletons)));
    const expected = expectedContains(skeletons);

    // coverage=100%：期望集合每一项都被覆盖
    for (const want of expected) {
      expect(actual.has(want), `缺失 contains 边: ${want}`).toBe(true);
    }
    // 无多余边（不含 module→member 扁平边等噪声）
    expect(actual).toEqual(expected);
  });
});
