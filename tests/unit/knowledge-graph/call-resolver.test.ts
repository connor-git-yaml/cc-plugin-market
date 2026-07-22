/**
 * Feature 151 T-007 — call-resolver 4 阶段单测（FR-2 + CL-04 + Codex C-4 + EC-2/3/4/12/13）
 *
 * 覆盖：
 * - 共享抽象 5 case（语言无关）：4 阶段 + unresolved 兜底
 * - Python 7 case：free / self.method / Class.method / __add__ / super() / @decorator / cross-module
 * - classMemberIndex 双重验证（Codex C-4）
 * - dynamic call skip / import * → low（EC-12 / EC-13）
 * - MRO 死循环防御（EC-4）
 */
import { describe, expect, it } from 'vitest';

import {
  resolveCalls,
  buildModuleSymbolIndex,
  buildClassMemberIndex,
  buildImportIndex,
  buildClassMroIndex,
  extractClassName,
  type CallSiteWithFile,
} from '../../../src/knowledge-graph/call-resolver.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';

// ───────────────────────────────────────────────────────────
// Mock helpers — 构造最小 CodeSkeleton
// ───────────────────────────────────────────────────────────

function mkSkeleton(opts: {
  filePath: string;
  language?: 'python' | 'typescript';
  exports?: CodeSkeleton['exports'];
  imports?: CodeSkeleton['imports'];
}): CodeSkeleton {
  return {
    filePath: opts.filePath,
    language: opts.language ?? 'python',
    loc: 100,
    exports: opts.exports ?? [],
    imports: opts.imports ?? [],
    hash: 'a'.repeat(64),
    analyzedAt: '2026-05-08T10:00:00.000Z',
    parserUsed: 'tree-sitter',
  };
}

function mkSkeletonsMap(skeletons: CodeSkeleton[]): Map<string, CodeSkeleton> {
  const m = new Map<string, CodeSkeleton>();
  for (const sk of skeletons) m.set(sk.filePath, sk);
  return m;
}

// ───────────────────────────────────────────────────────────
// Index builders（5 单测，独立验证 4 个索引）
// ───────────────────────────────────────────────────────────

describe('索引构建函数（T-007a）', () => {
  it('buildModuleSymbolIndex：file → Set<exportName>', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        exports: [
          { name: 'foo', kind: 'function', signature: 'def foo()', isDefault: false, startLine: 1, endLine: 5 },
          { name: 'Bar', kind: 'class', signature: 'class Bar:', isDefault: false, startLine: 7, endLine: 20 },
        ],
      }),
    ]);
    const idx = buildModuleSymbolIndex(skeletons);
    expect(idx.get('a.py')).toEqual(new Set(['foo', 'Bar']));
  });

  it('buildClassMemberIndex：file::Class → Set<methodName>', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        exports: [
          {
            name: 'Value',
            kind: 'class',
            signature: 'class Value:',
            isDefault: false,
            startLine: 1,
            endLine: 50,
            members: [
              { name: '__init__', kind: 'method', signature: '__init__()', isStatic: false },
              { name: '__add__', kind: 'method', signature: '__add__()', isStatic: false },
              { name: 'forward', kind: 'method', signature: 'forward()', isStatic: false },
            ],
          },
        ],
      }),
    ]);
    const idx = buildClassMemberIndex(skeletons);
    expect(idx.get('a.py::Value')).toEqual(new Set(['__init__', '__add__', 'forward']));
  });

  it('buildImportIndex：含 namedImports / defaultImport / 通配 *', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        imports: [
          {
            moduleSpecifier: 'numpy',
            isRelative: false,
            resolvedPath: 'site/numpy/__init__.py',
            namedImports: ['array', 'zeros'],
            isTypeOnly: false,
          },
          {
            moduleSpecifier: 'utils',
            isRelative: true,
            resolvedPath: './utils.py',
            namedImports: ['*'],
            isTypeOnly: false,
          },
        ],
      }),
    ]);
    const idx = buildImportIndex(skeletons);
    const info = idx.get('a.py');
    expect(info?.aliasToTarget.get('array')).toBe('site/numpy/__init__.py');
    expect(info?.aliasToTarget.get('zeros')).toBe('site/numpy/__init__.py');
    expect(info?.starImportTargets.has('./utils.py')).toBe(true);
  });

  it('buildClassMroIndex：从 signature 提取 superclass', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        exports: [
          {
            name: 'Foo',
            kind: 'class',
            signature: 'class Foo(Bar, Baz):',
            isDefault: false,
            startLine: 1,
            endLine: 20,
          },
        ],
      }),
    ]);
    const idx = buildClassMroIndex(skeletons);
    expect(idx.get('a.py::Foo')).toEqual(['Bar', 'Baz']);
  });

  it('Codex P1 W-3：buildClassMroIndex 处理 Generic[T, U] 不拆坏', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        exports: [
          {
            name: 'Container',
            kind: 'class',
            signature: 'class Container(Generic[T, U], Mapping[str, int]):',
            isDefault: false,
            startLine: 1,
            endLine: 20,
          },
        ],
      }),
    ]);
    const idx = buildClassMroIndex(skeletons);
    // 应该是 ['Generic', 'Mapping'] — 不应该被 split(',') 拆成 4 段
    expect(idx.get('a.py::Container')).toEqual(['Generic', 'Mapping']);
  });

  it('extractClassName：从 callerContext 提取 className', () => {
    expect(extractClassName('Foo.bar')).toBe('Foo');
    expect(extractClassName('Outer.Inner.method')).toBe('Inner');
    expect(extractClassName('toplevelFn')).toBeUndefined();
    expect(extractClassName(undefined)).toBeUndefined();
    expect(extractClassName('')).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────
// 共享抽象 5 case（语言无关，US-2）
// ───────────────────────────────────────────────────────────

describe('call-resolver 共享抽象（≥ 5 case，US-2 验收）', () => {
  it('Stage 1 — free function 同模块 export → high', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        exports: [
          { name: 'helper', kind: 'function', signature: 'def helper()', isDefault: false, startLine: 1, endLine: 5 },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'helper', calleeKind: 'free', line: 10, callerFile: 'a.py' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(1);
    expect(edges[0].relation).toBe('calls');
    expect(edges[0].confidence).toBe('high');
    expect(edges[0].directional).toBe(true);
    expect(edges[0].target).toBe('a.py::helper');
  });

  it('Stage 2 — member 类 + 方法双重验证 → high (Codex C-4)', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        exports: [
          {
            name: 'Value',
            kind: 'class',
            signature: 'class Value:',
            isDefault: false,
            startLine: 1,
            endLine: 50,
            members: [
              { name: 'forward', kind: 'method', signature: 'forward()', isStatic: false },
            ],
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'forward', calleeKind: 'member', line: 30, callerFile: 'a.py', callerContext: 'Value.train' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0].confidence).toBe('high');
    expect(edges[0].target).toBe('a.py::Value.forward');
  });

  it('Stage 2 — 类存在但方法不在自身或 MRO → medium 占位 (Codex C-4)', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        exports: [
          {
            name: 'Value',
            kind: 'class',
            signature: 'class Value:',
            isDefault: false,
            startLine: 1,
            endLine: 50,
            members: [{ name: 'forward', kind: 'method', signature: 'forward()', isStatic: false }],
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'unknownMethod', calleeKind: 'member', line: 30, callerFile: 'a.py', callerContext: 'Value.train' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0].confidence).toBe('medium'); // 占位 — 不伪造 high
    expect(edges[0].target).toBe('a.py::Value.unknownMethod');
  });

  it('Stage 3 — cross-module import 命中 → medium', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        imports: [
          {
            moduleSpecifier: 'numpy',
            isRelative: false,
            resolvedPath: 'numpy/__init__.py',
            namedImports: ['array'],
            isTypeOnly: false,
          },
        ],
      }),
      mkSkeleton({
        filePath: 'numpy/__init__.py',
        exports: [
          { name: 'array', kind: 'function', signature: 'def array()', isDefault: false, startLine: 1, endLine: 5 },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'array', calleeKind: 'cross-module', line: 10, callerFile: 'a.py' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0].confidence).toBe('medium');
    expect(edges[0].target).toBe('numpy/__init__.py::array');
  });

  it('Stage 4 unresolved 兜底 — dunder / decorator → low', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({ filePath: 'a.py' }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: '__add__', calleeKind: 'dunder', line: 10, callerFile: 'a.py' },
      { calleeName: 'staticmethod', calleeKind: 'decorator', line: 5, callerFile: 'a.py' },
      { calleeName: 'unknownFn', calleeKind: 'unresolved', line: 20, callerFile: 'a.py' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(3);
    for (const e of edges) {
      expect(e.confidence).toBe('low');
    }
  });
});

// ───────────────────────────────────────────────────────────
// Python 7 case（FR-5 验收）
// ───────────────────────────────────────────────────────────

describe('call-resolver Python 7 case 覆盖（FR-5）', () => {
  it('Python case 1 — free function `foo()` 同模块 → high', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'engine.py',
        exports: [
          { name: 'foo', kind: 'function', signature: 'def foo()', isDefault: false, startLine: 1, endLine: 3 },
        ],
      }),
    ]);
    const edges = resolveCalls(
      [{ calleeName: 'foo', calleeKind: 'free', line: 10, callerFile: 'engine.py' }],
      skeletons,
    );
    expect(edges[0].confidence).toBe('high');
  });

  it('Python case 2 — `self.method()` 类成员 → high', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'engine.py',
        exports: [
          {
            name: 'Value',
            kind: 'class',
            signature: 'class Value:',
            isDefault: false,
            startLine: 1,
            endLine: 100,
            members: [{ name: 'compute', kind: 'method', signature: 'compute()', isStatic: false }],
          },
        ],
      }),
    ]);
    const edges = resolveCalls(
      [
        {
          calleeName: 'compute',
          calleeKind: 'member',
          line: 30,
          callerFile: 'engine.py',
          callerContext: 'Value.run',
        },
      ],
      skeletons,
    );
    expect(edges[0].confidence).toBe('high');
    expect(edges[0].target).toBe('engine.py::Value.compute');
  });

  it('Python case 3 — `Class.method()` static 调用 (Codex P1 C-2 用 calleeQualifier 解析) → high', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'engine.py',
        exports: [
          {
            name: 'Engine',
            kind: 'class',
            signature: 'class Engine:',
            isDefault: false,
            startLine: 1,
            endLine: 100,
            members: [{ name: 'static_helper', kind: 'staticmethod', signature: 'static_helper()', isStatic: true }],
          },
        ],
      }),
    ]);
    // Codex P1 C-2 修订：mapper 现在为 Class.method 形式填 calleeQualifier='Engine'
    const edges = resolveCalls(
      [
        {
          calleeName: 'static_helper',
          calleeKind: 'member',
          line: 30,
          callerFile: 'engine.py',
          callerContext: 'Engine.run',
          calleeQualifier: 'Engine',
        },
      ],
      skeletons,
    );
    expect(edges[0].confidence).toBe('high');
    expect(edges[0].target).toBe('engine.py::Engine.static_helper');
  });

  it('Python case 4 — dunder `__add__` 通过 `a + b` → low (EC-3)', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({ filePath: 'engine.py' }),
    ]);
    const edges = resolveCalls(
      [{ calleeName: '__add__', calleeKind: 'dunder', line: 50, callerFile: 'engine.py' }],
      skeletons,
    );
    expect(edges[0].confidence).toBe('low');
    expect(edges[0].target).toContain('__add__');
  });

  it('Python case 5 — `super().__init__()` MRO 解析 → low', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'engine.py',
        exports: [
          {
            name: 'Parent',
            kind: 'class',
            signature: 'class Parent:',
            isDefault: false,
            startLine: 1,
            endLine: 50,
            members: [{ name: '__init__', kind: 'method', signature: '__init__()', isStatic: false }],
          },
          {
            name: 'Child',
            kind: 'class',
            signature: 'class Child(Parent):',
            isDefault: false,
            startLine: 60,
            endLine: 80,
            members: [{ name: '__init__', kind: 'method', signature: '__init__()', isStatic: false }],
          },
        ],
      }),
    ]);
    const edges = resolveCalls(
      [
        {
          calleeName: '__init__',
          calleeKind: 'super',
          line: 70,
          callerFile: 'engine.py',
          callerContext: 'Child.__init__',
        },
      ],
      skeletons,
    );
    expect(edges[0].confidence).toBe('low');
    expect(edges[0].target).toBe('engine.py::Parent.__init__');
  });

  it('Python case 6 — 带参 `@app.route("/x")` decorator → low', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({ filePath: 'app.py' }),
    ]);
    const edges = resolveCalls(
      [{ calleeName: 'route', calleeKind: 'decorator', line: 10, callerFile: 'app.py' }],
      skeletons,
    );
    expect(edges[0].confidence).toBe('low');
  });

  it('Python case 7 — cross-module `module.func()` (Codex P1 C-2 calleeQualifier 解析) → medium', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'main.py',
        imports: [
          {
            moduleSpecifier: 'engine',
            isRelative: true,
            resolvedPath: 'engine.py',
            namedImports: ['engine'],
            isTypeOnly: false,
          },
        ],
      }),
      mkSkeleton({
        filePath: 'engine.py',
        exports: [
          { name: 'array', kind: 'function', signature: 'def array()', isDefault: false, startLine: 1, endLine: 5 },
        ],
      }),
    ]);
    // Codex P1 C-2 修订：mapper 为 module.func 形式填 calleeQualifier='engine'
    // resolver Stage 3 用 qualifier 找 import 别名 → 命中 engine.py
    const edges = resolveCalls(
      [
        {
          calleeName: 'array',
          calleeKind: 'cross-module',
          line: 10,
          callerFile: 'main.py',
          calleeQualifier: 'engine',
        },
      ],
      skeletons,
    );
    expect(edges[0].confidence).toBe('medium');
    expect(edges[0].target).toBe('engine.py::array');
  });
});

// ───────────────────────────────────────────────────────────
// Edge case 验收（EC-4 / EC-12 / EC-13）
// ───────────────────────────────────────────────────────────

describe('call-resolver edge cases', () => {
  it('EC-13 import * → low', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'main.py',
        imports: [
          {
            moduleSpecifier: 'utils',
            isRelative: true,
            resolvedPath: 'utils.py',
            namedImports: ['*', 'mystery_fn'],
            isTypeOnly: false,
          },
        ],
      }),
    ]);
    const edges = resolveCalls(
      [{ calleeName: 'mystery_fn', calleeKind: 'cross-module', line: 5, callerFile: 'main.py' }],
      skeletons,
    );
    expect(edges[0].confidence).toBe('low');
  });

  it('EC-4 MRO ≤ 8 层防御循环', () => {
    // 构造类继承环：A → B → A → ...，确保 lookupInMro 不会无限递归
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'cycle.py',
        exports: [
          {
            name: 'A',
            kind: 'class',
            signature: 'class A(B):',
            isDefault: false,
            startLine: 1,
            endLine: 10,
            members: [{ name: 'foo', kind: 'method', signature: 'foo()', isStatic: false }],
          },
          {
            name: 'B',
            kind: 'class',
            signature: 'class B(A):',
            isDefault: false,
            startLine: 12,
            endLine: 20,
            members: [],
          },
        ],
      }),
    ]);
    // 不应抛 stack overflow
    const edges = resolveCalls(
      [
        {
          calleeName: 'unknown_method',
          calleeKind: 'super',
          line: 15,
          callerFile: 'cycle.py',
          callerContext: 'A.use',
        },
      ],
      skeletons,
    );
    // 应安全返回 low（unresolved 兜底）
    expect(edges[0].confidence).toBe('low');
  });

  it('EC-12 dynamic call (calleeKind 异常) → null skip', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({ filePath: 'a.py' }),
    ]);
    // 模拟 mapper 抽出来的不识别 calleeKind（如 manually corrupt 数据）— resolver 应 skip
    const edges = resolveCalls(
      [
        // @ts-expect-error 故意构造异常 calleeKind 验证 skip 行为
        { calleeName: 'dynamicCall', calleeKind: 'unknown_kind' as 'free', line: 1, callerFile: 'a.py' },
      ],
      skeletons,
    );
    // 异常 calleeKind 应被 fallback 到 dynamic call skip 路径
    expect(edges).toHaveLength(0);
  });
});

// F221：re-export 名若进模块符号索引，经 facade import 的调用会解析到
// 被图派生过滤掉的别名节点 → dangling call edge；跳过保持与修复前解析口径一致。
describe('buildModuleSymbolIndex re-export 过滤（F221）', () => {
  it('⑪ re-export 条目名字不进入模块符号索引', () => {
    const sk = mkSkeleton({
      filePath: 'src/facade.ts',
      language: 'typescript',
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
    });
    const idx = buildModuleSymbolIndex(mkSkeletonsMap([sk]));
    expect(idx.get('src/facade.ts')?.has('localFn')).toBe(true);
    expect(idx.get('src/facade.ts')?.has('reFn')).toBe(false);
  });
});
