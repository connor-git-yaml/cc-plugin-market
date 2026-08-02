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

// ───────────────────────────────────────────────────────────
// F242 — 边 source 归属回退链（isAddressable / resolveSourceId）
//
// 设计见 specs/242-fix-callsite-syntax-coverage/plan.md 决策 2：
//   callerContext 可寻址 → `file::callerContext`
//   否则 enclosingNamedContext 可寻址 → `file::enclosingNamedContext`
//   否则 → `file`（模块节点兜底）
// ───────────────────────────────────────────────────────────

describe('F242 — 边 source 归属回退链', () => {
  const tsSkeletons = (): Map<string, CodeSkeleton> =>
    mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/a.ts',
        language: 'typescript',
        exports: [
          { name: 'registerX', kind: 'function', signature: 'function registerX(): void', isDefault: false, startLine: 1, endLine: 5 },
          { name: 'executeX', kind: 'function', signature: 'function executeX(): void', isDefault: false, startLine: 7, endLine: 9 },
          {
            name: 'Foo',
            kind: 'class',
            signature: 'class Foo',
            isDefault: false,
            startLine: 11,
            endLine: 20,
            members: [{ name: 'bar', kind: 'method', signature: 'bar()', isStatic: false }],
          },
        ],
      }),
    ]);

  it('① 匿名 callerContext + 可寻址 enclosingNamedContext → source 用命名祖先', () => {
    const calls: CallSiteWithFile[] = [
      {
        calleeName: 'executeX',
        calleeKind: 'free',
        line: 3,
        callerFile: 'src/a.ts',
        callerContext: '<arrow:3:21>',
        enclosingNamedContext: 'registerX',
      },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe('src/a.ts::registerX');
    expect(edges[0]!.target).toBe('src/a.ts::executeX');
  });

  it('①b 匿名 callerContext + 点分可寻址 enclosingNamedContext（Class.member）→ source 用成员节点', () => {
    const calls: CallSiteWithFile[] = [
      {
        calleeName: 'executeX',
        calleeKind: 'free',
        line: 13,
        callerFile: 'src/a.ts',
        callerContext: '<arrow:13:15>',
        enclosingNamedContext: 'Foo.bar',
      },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges[0]!.source).toBe('src/a.ts::Foo.bar');
  });

  it('② 匿名 callerContext + enclosingNamedContext 缺失 → source 退化为纯模块路径', () => {
    const calls: CallSiteWithFile[] = [
      {
        calleeName: 'executeX',
        calleeKind: 'free',
        line: 3,
        callerFile: 'src/a.ts',
        callerContext: '<arrow:3:21>',
      },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges[0]!.source).toBe('src/a.ts');
    expect(edges[0]!.source).not.toContain('::');
  });

  it('②b 未导出的命名 callerContext（如 main）→ source 退化为纯模块路径', () => {
    const calls: CallSiteWithFile[] = [
      {
        calleeName: 'executeX',
        calleeKind: 'free',
        line: 30,
        callerFile: 'src/a.ts',
        callerContext: 'main',
      },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges[0]!.source).toBe('src/a.ts');
  });

  it('②c callerContext 与 enclosingNamedContext 均不可寻址 → source 退化为纯模块路径', () => {
    const calls: CallSiteWithFile[] = [
      {
        calleeName: 'executeX',
        calleeKind: 'free',
        line: 30,
        callerFile: 'src/a.ts',
        callerContext: '<arrow:30:4>',
        enclosingNamedContext: 'notExported',
      },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges[0]!.source).toBe('src/a.ts');
  });

  it('②d callerContext 缺失（模块顶层调用）→ source 退化为纯模块路径（不再产 <module> 占位）', () => {
    const calls: CallSiteWithFile[] = [
      { calleeName: 'executeX', calleeKind: 'free', line: 1, callerFile: 'src/a.ts' },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges[0]!.source).toBe('src/a.ts');
    expect(edges[0]!.source).not.toContain('<module>');
  });

  it('③ callerContext 本身可寻址（既有 Stage 1 场景）→ source 保持 file::callerContext（回归锚）', () => {
    const calls: CallSiteWithFile[] = [
      {
        calleeName: 'executeX',
        calleeKind: 'free',
        line: 3,
        callerFile: 'src/a.ts',
        callerContext: 'registerX',
        // 即便 enclosingNamedContext 存在也不应被优先（省略规则下正常不会同时出现）
        enclosingNamedContext: 'Foo.bar',
      },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges[0]!.source).toBe('src/a.ts::registerX');
  });

  it('③b Class.member 形态 callerContext 可寻址 → source 保持 file::Class.member（回归锚）', () => {
    const calls: CallSiteWithFile[] = [
      {
        calleeName: 'executeX',
        calleeKind: 'free',
        line: 13,
        callerFile: 'src/a.ts',
        callerContext: 'Foo.bar',
      },
    ];
    const edges = resolveCalls(calls, tsSkeletons());
    expect(edges[0]!.source).toBe('src/a.ts::Foo.bar');
  });

  it('④ 语言无关：Python callSite（无 enclosingNamedContext 字段）同样走模块兜底', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'engine.py',
        exports: [
          { name: 'helper', kind: 'function', signature: 'def helper()', isDefault: false, startLine: 1, endLine: 3 },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      // Python 模块顶层调用：callerContext 缺失
      { calleeName: 'helper', calleeKind: 'free', line: 20, callerFile: 'engine.py' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.source).toBe('engine.py');
    expect(edges[0]!.target).toBe('engine.py::helper');
  });
});

// ───────────────────────────────────────────────────────────
// F242 — buildImportIndex 的 namespaceImport 落表（R2 target 侧）
// ───────────────────────────────────────────────────────────

describe('F242 — buildImportIndex namespaceImport 落表', () => {
  it('namespaceImport 绑定名进入 aliasToTarget，供 Stage 3 qualifier 解析', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/a.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './b.js',
            isRelative: true,
            resolvedPath: 'src/b.ts',
            isTypeOnly: false,
            importType: 'dynamic',
            namespaceImport: 'mod',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/a.ts');
    expect(info?.aliasToTarget.get('mod')).toBe('src/b.ts');
  });

  it('有 namespaceImport 时不再落 moduleSpecifier lastSeg 垃圾 alias', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/a.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './commands/scaffold-kb.js',
            isRelative: true,
            resolvedPath: 'src/commands/scaffold-kb.ts',
            isTypeOnly: false,
            importType: 'dynamic',
            namespaceImport: 'mod',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/a.ts');
    expect(info?.aliasToTarget.get('mod')).toBe('src/commands/scaffold-kb.ts');
    // 'js' 是 moduleSpecifier.split('.').pop() 的产物，绑定已可用时不应再注册
    expect(info?.aliasToTarget.has('js')).toBe(false);
  });

  it('回归锚：无任何绑定时仍保留 lastSeg / moduleSpecifier 兜底 alias（Python import X 路径）', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        imports: [
          { moduleSpecifier: 'numpy', isRelative: false, resolvedPath: 'site/numpy/__init__.py', isTypeOnly: false },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('a.py');
    expect(info?.aliasToTarget.get('numpy')).toBe('site/numpy/__init__.py');
  });
});

// ───────────────────────────────────────────────────────────
// F242 审查轮 C1 — dynamic 绑定歧义弃权（同名 alias 指向多 target）
//
// dynamic import 的绑定是**块级作用域**事实，而 ImportInfo 是文件级索引。
// 同一文件里两个函数各自 `const m = await import(...)` 指向不同模块时，
// 文件级 last-write-wins 会让先出现的那条调用解析到后者 → 确定性假边。
// 修法：dynamic 候选唯一才写入，歧义整体弃权（回到 F242 前的未覆盖状态）。
// ───────────────────────────────────────────────────────────

describe('F242 审查轮 C1 — dynamic 绑定歧义弃权', () => {
  const dynImport = (
    moduleSpecifier: string,
    resolvedPath: string | null,
    binding: { namespaceImport?: string; namedImports?: string[] },
  ) => ({
    moduleSpecifier,
    isRelative: true,
    resolvedPath,
    isTypeOnly: false,
    importType: 'dynamic' as const,
    ...binding,
  });

  const targetSkeletons = (): CodeSkeleton[] => [
    mkSkeleton({
      filePath: 'src/a.ts',
      language: 'typescript',
      exports: [
        { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
      ],
    }),
    mkSkeleton({
      filePath: 'src/b.ts',
      language: 'typescript',
      exports: [
        { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
      ],
    }),
  ];

  it('(a) 同 alias 双 dynamic 指向不同 target → 该 alias 整体不落表，两个 callSite 都不产 cross-module 边', () => {
    const skeletons = mkSkeletonsMap([
      ...targetSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          dynImport('./a.js', 'src/a.ts', { namespaceImport: 'm' }),
          dynImport('./b.js', 'src/b.ts', { namespaceImport: 'm' }),
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('m')).toBe(false);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'cross-module', line: 3, callerFile: 'src/caller.ts', calleeQualifier: 'm' },
      { calleeName: 'run', calleeKind: 'cross-module', line: 8, callerFile: 'src/caller.ts', calleeQualifier: 'm' },
    ];
    const edges = resolveCalls(calls, skeletons);
    // cross-module 未命中 alias → 落 Stage 4 之外（cross-module 不在 fallthrough 白名单）→ skip
    for (const e of edges) {
      expect(e.target).not.toBe('src/a.ts::run');
      expect(e.target).not.toBe('src/b.ts::run');
    }
  });

  it('(a2) 同 alias 双 dynamic 但 namedImports 形态 → 同样弃权', () => {
    const skeletons = mkSkeletonsMap([
      ...targetSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          dynImport('./a.js', 'src/a.ts', { namedImports: ['run'] }),
          dynImport('./b.js', 'src/b.ts', { namedImports: ['run'] }),
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('run')).toBe(false);
  });

  it('(b) 同 alias 双 dynamic 指向同一 target → 无歧义，正常解析', () => {
    const skeletons = mkSkeletonsMap([
      ...targetSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          dynImport('./a.js', 'src/a.ts', { namespaceImport: 'm' }),
          dynImport('./a.js', 'src/a.ts', { namespaceImport: 'm' }),
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.get('m')).toBe('src/a.ts');
  });

  it('(c) 静态 named import 与 dynamic 绑定同名冲突 → 静态获胜（保持 F242 前行为）', () => {
    const skeletons = mkSkeletonsMap([
      ...targetSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './a.js',
            isRelative: true,
            resolvedPath: 'src/a.ts',
            namedImports: ['run'],
            isTypeOnly: false,
            importType: 'static',
          },
          dynImport('./b.js', 'src/b.ts', { namedImports: ['run'] }),
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.get('run')).toBe('src/a.ts');

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'free', line: 3, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/a.ts::run');
  });

  it('(c2) 静态在后、dynamic 在前时静态同样获胜（顺序无关）', () => {
    const skeletons = mkSkeletonsMap([
      ...targetSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          dynImport('./b.js', 'src/b.ts', { namedImports: ['run'] }),
          {
            moduleSpecifier: './a.js',
            isRelative: true,
            resolvedPath: 'src/a.ts',
            namedImports: ['run'],
            isTypeOnly: false,
            importType: 'static',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.get('run')).toBe('src/a.ts');
  });

  it('(d) 回归锚：唯一 dynamic 绑定（cli/index.ts 形态）照常解析', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/commands/scaffold-kb.ts',
        language: 'typescript',
        exports: [
          { name: 'runScaffoldKb', kind: 'function', signature: 'function runScaffoldKb(): void', isDefault: false, startLine: 1, endLine: 3 },
        ],
      }),
      mkSkeleton({
        filePath: 'src/cli/index.ts',
        language: 'typescript',
        imports: [
          dynImport('./commands/scaffold-kb.js', 'src/commands/scaffold-kb.ts', { namedImports: ['runScaffoldKb'] }),
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/cli/index.ts');
    expect(info?.aliasToTarget.get('runScaffoldKb')).toBe('src/commands/scaffold-kb.ts');

    const calls: CallSiteWithFile[] = [
      { calleeName: 'runScaffoldKb', calleeKind: 'free', line: 42, callerFile: 'src/cli/index.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/commands/scaffold-kb.ts::runScaffoldKb');
  });

  it('(e) dynamic 绑定 target 未解析（resolvedPath=null）→ 弃权，不落 null alias', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [dynImport('some-pkg', null, { namespaceImport: 'pkg' })],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('pkg')).toBe(false);
  });

  // 复审轮修复 2 修订：dynamic 无绑定项不再走 specifier 兜底（见下方「修复 2」describe）。
  // 该兜底是为 Python `import numpy` 这类无绑定语法准备的，dynamic specifier 是路径，
  // 兜底出来的 lastSeg 只会是扩展名垃圾，且会无条件覆盖同名静态绑定。
  it('(f) 无绑定的 dynamic import 不再注册 specifier 兜底 alias', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: 'lodash',
            isRelative: false,
            resolvedPath: 'node_modules/lodash/index.js',
            isTypeOnly: false,
            importType: 'dynamic',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('lodash')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
// F242 审查轮 W3 — 大写 namespace alias 不再走类解析
//
// mapper 用首字母大小写启发式区分 `Class.method()` 与 `mod.fn()`，
// 大写 namespace 绑定（`const M = await import(...)` / `import * as M`）
// 会被标成 member 走 Stage 2，产出 `b.ts::M.D` 这种错形 target。
// 修法：Stage 2 入口先查 namespaceAliases —— 绑定表是确定性事实，优先于启发式。
// ───────────────────────────────────────────────────────────

describe('F242 审查轮 W3 — 大写 namespace alias 走模块成员解析', () => {
  const bSkeleton = () =>
    mkSkeleton({
      filePath: 'src/b.ts',
      language: 'typescript',
      exports: [
        { name: 'D', kind: 'function', signature: 'function D(): void', isDefault: false, startLine: 1, endLine: 3 },
        // 同名类陷阱：b.ts 恰好导出 class M 且含成员 D 时，旧实现会产出真假边
        {
          name: 'M',
          kind: 'class',
          signature: 'class M',
          isDefault: false,
          startLine: 5,
          endLine: 20,
          members: [{ name: 'D', kind: 'method', signature: 'D()', isStatic: true }],
        },
      ],
    });

  it('(a) dynamic 大写 namespace `M.D()` → 解析为 src/b.ts::D（非 M.D 错形）', () => {
    const skeletons = mkSkeletonsMap([
      bSkeleton(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './b.js',
            isRelative: true,
            resolvedPath: 'src/b.ts',
            isTypeOnly: false,
            importType: 'dynamic',
            namespaceImport: 'M',
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'D', calleeKind: 'member', line: 4, callerFile: 'src/caller.ts', calleeQualifier: 'M' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target).toBe('src/b.ts::D');
    expect(edges[0]!.confidence).toBe('medium');
  });

  it('(b) 静态 `import * as NS` 大写 qualifier 成员调用 → src/b.ts::D', () => {
    const skeletons = mkSkeletonsMap([
      bSkeleton(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './b.js',
            isRelative: true,
            resolvedPath: 'src/b.ts',
            isTypeOnly: false,
            importType: 'static',
            namespaceImport: 'NS',
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'D', calleeKind: 'member', line: 4, callerFile: 'src/caller.ts', calleeQualifier: 'NS' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/b.ts::D');
  });

  it('(b2) 静态 `import * as ns` 小写 qualifier 走 Stage 3 → src/b.ts::D（既有路径不变）', () => {
    const skeletons = mkSkeletonsMap([
      bSkeleton(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './b.js',
            isRelative: true,
            resolvedPath: 'src/b.ts',
            isTypeOnly: false,
            importType: 'static',
            namespaceImport: 'ns',
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'D', calleeKind: 'cross-module', line: 4, callerFile: 'src/caller.ts', calleeQualifier: 'ns' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/b.ts::D');
  });

  it('(c) 回归锚：named import 的类静态方法仍走 remote class 路径产 file::Class.method', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/x.ts',
        language: 'typescript',
        exports: [
          {
            name: 'SomeClass',
            kind: 'class',
            signature: 'class SomeClass',
            isDefault: false,
            startLine: 1,
            endLine: 20,
            members: [{ name: 'staticMethod', kind: 'method', signature: 'staticMethod()', isStatic: true }],
          },
        ],
      }),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './x.js',
            isRelative: true,
            resolvedPath: 'src/x.ts',
            namedImports: ['SomeClass'],
            isTypeOnly: false,
            importType: 'static',
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'staticMethod', calleeKind: 'member', line: 4, callerFile: 'src/caller.ts', calleeQualifier: 'SomeClass' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/x.ts::SomeClass.staticMethod');
  });

  it('(d) 歧义弃权的 dynamic namespace alias 不进 namespaceAliases（不产模块成员边）', () => {
    const skeletons = mkSkeletonsMap([
      bSkeleton(),
      mkSkeleton({
        filePath: 'src/a.ts',
        language: 'typescript',
        exports: [
          { name: 'D', kind: 'function', signature: 'function D(): void', isDefault: false, startLine: 1, endLine: 3 },
        ],
      }),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './a.js',
            isRelative: true,
            resolvedPath: 'src/a.ts',
            isTypeOnly: false,
            importType: 'dynamic',
            namespaceImport: 'M',
          },
          {
            moduleSpecifier: './b.js',
            isRelative: true,
            resolvedPath: 'src/b.ts',
            isTypeOnly: false,
            importType: 'dynamic',
            namespaceImport: 'M',
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'D', calleeKind: 'member', line: 4, callerFile: 'src/caller.ts', calleeQualifier: 'M' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).not.toBe('src/a.ts::D');
    expect(edges[0]!.target).not.toBe('src/b.ts::D');
    expect(edges[0]!.target).toBe('?::D');
  });
});

// ───────────────────────────────────────────────────────────
// F242 复审轮 修复 1 — suppressedDynamicAliases 阻断歧义 alias 的后续回退
//
// C1 首轮只做到「歧义别名不落 aliasToTarget」，但弃权后的调用点仍会继续
// 往下走 Stage 2 类启发式 / Stage 3 查表，等于把「已知不确定」重新伪装成
// 「确定结论」：caller 模块恰好导出同名类时会产出**本地类边**（high，能存活
// 下游全部过滤）。修法是把歧义别名显式登记到 ImportInfo.suppressedDynamicAliases，
// 在 Stage 2 / Stage 3 入口拦截，落到 `?::` 占位（下游悬空过滤丢弃）。
//
// 同时收紧候选身份：从 target 单值改为 (bindingKind, target) 二元组 ——
// 同一 alias 既被 named 解构又被 namespace 整体绑定时，即使 target 相同，
// `M.D()` 的语义也完全不同（named 下 M 是符号、正确目标 `b.ts::M.D`；
// namespace 下 M 是模块、正确目标 `b.ts::D`），无从判别只能弃权。
// ───────────────────────────────────────────────────────────

describe('F242 复审轮 修复 1 — suppressedDynamicAliases 阻断歧义回退', () => {
  const dyn = (
    moduleSpecifier: string,
    resolvedPath: string | null,
    binding: { namespaceImport?: string; namedImports?: string[] },
  ) => ({
    moduleSpecifier,
    isRelative: true,
    resolvedPath,
    isTypeOnly: false,
    importType: 'dynamic' as const,
    ...binding,
  });

  /** src/a.ts 与 src/b.ts：各导出一个 run / D */
  const abSkeletons = (): CodeSkeleton[] => [
    mkSkeleton({
      filePath: 'src/a.ts',
      language: 'typescript',
      exports: [
        { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
        { name: 'D', kind: 'function', signature: 'function D(): void', isDefault: false, startLine: 5, endLine: 7 },
      ],
    }),
    mkSkeleton({
      filePath: 'src/b.ts',
      language: 'typescript',
      exports: [
        { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
        { name: 'D', kind: 'function', signature: 'function D(): void', isDefault: false, startLine: 5, endLine: 7 },
        {
          name: 'M',
          kind: 'class',
          signature: 'class M',
          isDefault: false,
          startLine: 9,
          endLine: 20,
          members: [{ name: 'D', kind: 'method', signature: 'D()', isStatic: true }],
        },
      ],
    }),
  ];

  it('(a) 反例 A — 歧义 alias 与 caller 本地同名类撞名时不产本地类边', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        // caller 自身恰好导出 class M { run() } —— 旧实现会拿它当 Stage 2 类启发式的落点
        exports: [
          {
            name: 'M',
            kind: 'class',
            signature: 'class M',
            isDefault: false,
            startLine: 1,
            endLine: 20,
            members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: false }],
          },
        ],
        imports: [
          dyn('./a.js', 'src/a.ts', { namespaceImport: 'M' }),
          dyn('./a.js', 'src/a.ts', { namespaceImport: 'M' }),
          dyn('./b.js', 'src/b.ts', { namespaceImport: 'M' }),
        ],
      }),
    ]);

    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('M')).toBe(false);
    expect(info?.suppressedDynamicAliases.has('M')).toBe(true);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'member', line: 30, callerFile: 'src/caller.ts', calleeQualifier: 'M' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(1);
    // 关键断言：不得落到 caller 本地类（这是 100% 假边，且 high confidence 能存活全部下游过滤）
    expect(edges[0]!.target).not.toBe('src/caller.ts::M.run');
    expect(edges[0]!.target).toBe('?::run');
    expect(edges[0]!.confidence).toBe('low');
  });

  it('(b) 反例 B — 同 target 但 named / namespace 两种绑定语义 → 弃权，不进 namespaceAliases', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          // const { M } = await import('./b.js')  —— M 是 b.ts 导出的符号（类）
          dyn('./b.js', 'src/b.ts', { namedImports: ['M'] }),
          // const M = await import('./b.js')      —— M 是 b.ts 模块命名空间
          dyn('./b.js', 'src/b.ts', { namespaceImport: 'M' }),
        ],
      }),
    ]);

    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('M')).toBe(false);
    expect(info?.namespaceAliases.has('M')).toBe(false);
    expect(info?.suppressedDynamicAliases.has('M')).toBe(true);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'D', calleeKind: 'member', line: 12, callerFile: 'src/caller.ts', calleeQualifier: 'M' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(1);
    // namespace 语义会给出 src/b.ts::D，named 语义会给出 src/b.ts::M.D —— 两者都是猜测，一律不产
    expect(edges[0]!.target).not.toBe('src/b.ts::D');
    expect(edges[0]!.target).not.toBe('src/b.ts::M.D');
    expect(edges[0]!.target).toBe('?::D');
  });

  it('(b2) Stage 3 侧同样拦截 — 歧义 alias 作 cross-module qualifier 不查表', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          dyn('./a.js', 'src/a.ts', { namespaceImport: 'm' }),
          dyn('./b.js', 'src/b.ts', { namespaceImport: 'm' }),
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.suppressedDynamicAliases.has('m')).toBe(true);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'cross-module', line: 3, callerFile: 'src/caller.ts', calleeQualifier: 'm' },
    ];
    const edges = resolveCalls(calls, skeletons);
    // cross-module 未命中 alias 且不在 Stage 4 fallthrough 白名单 → 整条 skip
    expect(edges).toHaveLength(0);
  });

  it('(c1) 回归锚 — 纯 named 唯一绑定不受影响（不进 suppressedDynamicAliases，照常解析）', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [dyn('./b.js', 'src/b.ts', { namedImports: ['M'] })],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.suppressedDynamicAliases.has('M')).toBe(false);
    expect(info?.aliasToTarget.get('M')).toBe('src/b.ts');
    expect(info?.namespaceAliases.has('M')).toBe(false);

    // named 绑定的 M 指代 b.ts 里的类 M → `M.D()` 应走 remote class 路径
    const calls: CallSiteWithFile[] = [
      { calleeName: 'D', calleeKind: 'member', line: 12, callerFile: 'src/caller.ts', calleeQualifier: 'M' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/b.ts::M.D');
  });

  it('(c2) 回归锚 — 纯 namespace 唯一绑定不受影响（模块成员解析照常）', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [dyn('./b.js', 'src/b.ts', { namespaceImport: 'M' })],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.suppressedDynamicAliases.has('M')).toBe(false);
    expect(info?.namespaceAliases.has('M')).toBe(true);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'D', calleeKind: 'member', line: 12, callerFile: 'src/caller.ts', calleeQualifier: 'M' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/b.ts::D');
  });

  it('(c3) 回归锚 — 普通未知 qualifier（非歧义别名）行为一字不变，仍产 medium 占位', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({ filePath: 'src/caller.ts', language: 'typescript' }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'member', line: 3, callerFile: 'src/caller.ts', calleeQualifier: 'Unknown' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('?::run');
    expect(edges[0]!.confidence).toBe('medium');
  });
});

// ───────────────────────────────────────────────────────────
// F242 确认轮 修复 1 — 抑制集补全（null target）+ Stage 1 拦截
//
// 复审轮把歧义别名登记进抑制集并在 Stage 2 / Stage 3 拦截，但留了两条绕行：
//
// 反例 A（Stage 1 绕行）：alias 已判歧义，可 calleeKind=free 的调用点在任何拦截
//   之前就被 Stage 1「本地导出命中」截胡，caller 恰好导出同名函数时产 high 假边。
// 反例 B（null-target 绕行）：唯一 dynamic 变体但 resolvedPath=null 时，旧实现只是
//   不落 aliasToTarget、**不进抑制集** —— 绑定真实存在却指向未知，Stage 2 回落到
//   caller 本地同名类，同样产 high 假边。
//
// 统一修法：抑制集语义从「多变体歧义」扩为「存在 dynamic 绑定但未产生可信
// aliasToTarget 条目」，并在 Stage 1 一并拦截。静态获胜的那条不入集（静态绑定权威）。
// ───────────────────────────────────────────────────────────

describe('F242 确认轮 修复 1 — 抑制集补全 + Stage 1 拦截', () => {
  const dyn = (
    moduleSpecifier: string,
    resolvedPath: string | null,
    binding: { namespaceImport?: string; namedImports?: string[] },
  ) => ({
    moduleSpecifier,
    isRelative: true,
    resolvedPath,
    isTypeOnly: false,
    importType: 'dynamic' as const,
    ...binding,
  });

  const abSkeletons = (): CodeSkeleton[] => [
    mkSkeleton({
      filePath: 'src/a.ts',
      language: 'typescript',
      exports: [
        { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
      ],
    }),
    mkSkeleton({
      filePath: 'src/b.ts',
      language: 'typescript',
      exports: [
        { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
      ],
    }),
  ];

  it('(a) 反例 A — 歧义 alias 与 caller 本地同名导出撞名时 Stage 1 不得截胡', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        // caller 自身也导出 run —— 旧实现的 Stage 1 会直接命中它并产 high 假边
        exports: [
          { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
        ],
        imports: [
          dyn('./a.js', 'src/a.ts', { namedImports: ['run'] }),
          dyn('./b.js', 'src/b.ts', { namedImports: ['run'] }),
        ],
      }),
    ]);

    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.suppressedDynamicAliases.has('run')).toBe(true);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'free', line: 30, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target).not.toBe('src/caller.ts::run');
    expect(edges[0]!.target).toBe('?::run');
    expect(edges[0]!.confidence).toBe('low');
  });

  it('(b) 反例 B — 唯一变体但 target 未解析时进抑制集，Stage 2 不回落本地类', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        exports: [
          {
            name: 'M',
            kind: 'class',
            signature: 'class M',
            isDefault: false,
            startLine: 1,
            endLine: 20,
            members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: true }],
          },
        ],
        // const M = await import('external-pkg') —— 绑定真实存在，但模块解析不出路径
        imports: [
          { ...dyn('external-pkg', null, { namespaceImport: 'M' }), isRelative: false },
        ],
      }),
    ]);

    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('M')).toBe(false);
    expect(info?.suppressedDynamicAliases.has('M')).toBe(true);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'member', line: 30, callerFile: 'src/caller.ts', calleeQualifier: 'M' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target).not.toBe('src/caller.ts::M.run');
    expect(edges[0]!.target).toBe('?::run');
    expect(edges[0]!.confidence).toBe('low');
  });

  it('(b2) 反例 B 的 free 形态 — null-target 绑定同样拦住 Stage 1', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        exports: [
          { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
        ],
        imports: [
          { ...dyn('external-pkg', null, { namedImports: ['run'] }), isRelative: false },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'free', line: 9, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('?::run');
    expect(edges[0]!.confidence).toBe('low');
  });

  it('(c) 回归锚 — 无任何 dynamic 绑定时普通本地导出调用 Stage 1 照常 high', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        exports: [
          { name: 'run', kind: 'function', signature: 'function run(): void', isDefault: false, startLine: 1, endLine: 3 },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.suppressedDynamicAliases.size).toBe(0);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'free', line: 9, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/caller.ts::run');
    expect(edges[0]!.confidence).toBe('high');
  });

  it('(c2) 回归锚 — 静态绑定同名时 Stage 1 本地导出仍优先（拦截不误伤主路径）', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        exports: [
          { name: 'other', kind: 'function', signature: 'function other(): void', isDefault: false, startLine: 1, endLine: 3 },
        ],
        imports: [
          {
            moduleSpecifier: './a.js',
            isRelative: true,
            resolvedPath: 'src/a.ts',
            namedImports: ['run'],
            isTypeOnly: false,
            importType: 'static' as const,
          },
        ],
      }),
    ]);
    const calls: CallSiteWithFile[] = [
      { calleeName: 'other', calleeKind: 'free', line: 5, callerFile: 'src/caller.ts' },
      { calleeName: 'run', calleeKind: 'free', line: 6, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/caller.ts::other');
    expect(edges[0]!.confidence).toBe('high');
    expect(edges[1]!.target).toBe('src/a.ts::run');
  });

  it('(d) 静态获胜的 dynamic 别名不入抑制集（C1(a) 登记项语义不变）', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './a.js',
            isRelative: true,
            resolvedPath: 'src/a.ts',
            namedImports: ['run'],
            isTypeOnly: false,
            importType: 'static' as const,
          },
          dyn('./b.js', 'src/b.ts', { namedImports: ['run'] }),
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.suppressedDynamicAliases.has('run')).toBe(false);
    expect(info?.aliasToTarget.get('run')).toBe('src/a.ts');

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'free', line: 3, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/a.ts::run');
  });

  it('(e) 唯一且可解析的 dynamic 绑定照常解析（抑制集不得扩大化）', () => {
    const skeletons = mkSkeletonsMap([
      ...abSkeletons(),
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [dyn('./a.js', 'src/a.ts', { namedImports: ['run'] })],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.suppressedDynamicAliases.size).toBe(0);

    const calls: CallSiteWithFile[] = [
      { calleeName: 'run', calleeKind: 'free', line: 3, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('src/a.ts::run');
    expect(edges[0]!.confidence).toBe('medium');
  });
});

// ───────────────────────────────────────────────────────────
// F242 复审轮 修复 2 — dynamic 无绑定项不再注册 specifier 兜底别名
//
// registerSpecifierFallback 是给 Python `import numpy` 这类「无绑定名可用」
// 语法准备的：那里 moduleSpecifier 的最后一段就是调用时写的名字。
// TS 的 dynamic specifier 是**路径**，lastSeg 恒为 'js' / 'mjs' 之类扩展名，
// 不但永远不是有意义的调用名，还会无条件 set() 覆盖同名静态绑定 → 假边。
// ───────────────────────────────────────────────────────────

describe('F242 复审轮 修复 2 — dynamic 无绑定项跳过 specifier 兜底', () => {
  it('(a) 裸 `import("./b.js")` 不得覆盖同名静态 alias `js`', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: 'lit',
            isRelative: false,
            resolvedPath: 'node_modules/lit/index.js',
            namedImports: ['js'],
            isTypeOnly: false,
            importType: 'static',
          },
          {
            moduleSpecifier: './b.js',
            isRelative: true,
            resolvedPath: 'src/b.ts',
            isTypeOnly: false,
            importType: 'dynamic',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.get('js')).toBe('node_modules/lit/index.js');

    const calls: CallSiteWithFile[] = [
      { calleeName: 'js', calleeKind: 'free', line: 9, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges[0]!.target).toBe('node_modules/lit/index.js::js');
  });

  it('(b) 裸 dynamic import 不再产生任何 lastSeg / moduleSpecifier 别名', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './b.js',
            isRelative: true,
            resolvedPath: 'src/b.ts',
            isTypeOnly: false,
            importType: 'dynamic',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.has('js')).toBe(false);
    expect(info?.aliasToTarget.has('./b.js')).toBe(false);
    expect(info?.aliasToTarget.size).toBe(0);
  });

  it('(b2) 多个裸 dynamic import 之间也不再 last-write-wins（都不注册）', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          { moduleSpecifier: './a.js', isRelative: true, resolvedPath: 'src/a.ts', isTypeOnly: false, importType: 'dynamic' as const },
          { moduleSpecifier: './b.js', isRelative: true, resolvedPath: 'src/b.ts', isTypeOnly: false, importType: 'dynamic' as const },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.size).toBe(0);
  });

  it('(c) 回归锚 — 静态无绑定 import 的 specifier 兜底保持不变（Python import X 路径）', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'a.py',
        imports: [
          { moduleSpecifier: 'numpy', isRelative: false, resolvedPath: 'site/numpy/__init__.py', isTypeOnly: false },
          { moduleSpecifier: 'os.path', isRelative: false, resolvedPath: 'site/os/path.py', isTypeOnly: false },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('a.py');
    expect(info?.aliasToTarget.get('numpy')).toBe('site/numpy/__init__.py');
    expect(info?.aliasToTarget.get('path')).toBe('site/os/path.py');
    expect(info?.aliasToTarget.get('os.path')).toBe('site/os/path.py');
  });
});
