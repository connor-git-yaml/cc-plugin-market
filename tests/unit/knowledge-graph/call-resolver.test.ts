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
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  resolveCalls,
  buildModuleSymbolIndex,
  buildClassMemberIndex,
  buildImportIndex,
  buildClassMroIndex,
  extractClassName,
  type CallSiteWithFile,
} from '../../../src/knowledge-graph/call-resolver.js';
import { deriveImportEdges } from '../../../src/knowledge-graph/index.js';
import { collectTsJsCodeSkeletons } from '../../../src/batch/stages/source-discovery.js';
import { TreeSitterAnalyzer } from '../../../src/core/tree-sitter-analyzer.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';

// ───────────────────────────────────────────────────────────
// Mock helpers — 构造最小 CodeSkeleton
// ───────────────────────────────────────────────────────────

function mkSkeleton(opts: {
  filePath: string;
  // F260 P5：语言分流（B7 正向判据）需要构造非 ts/js/python 的骨架，故放宽到全枚举。
  language?: CodeSkeleton['language'];
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

// ───────────────────────────────────────────────────────────
// F259 — commonjs-require 兜底别名覆写同名静态绑定（确定性假边收口）
//
// fix-report.md 缺陷 1：registerSpecifierFallback 的调用闸此前只挡 `importType === 'dynamic'`，
// `commonjs-require` 走同一路径无闸 —— require('./dep.js') 的 lastSeg 'js' 会无条件覆盖
// 同名静态绑定 `import { js } from './lit.js'`，产出两端皆真实节点、能存活 graph-builder
// 悬空过滤的确定性假边。判据从「importType 值枚举」改为「imp.importType === undefined」这一
// 结构性存在性判据（TS/JS 两条抽取路径恒设置该字段，Python/Java/Go 三条路径恒不设置，见
// plan.md 判据设计表逐路径核实），避免新增 ImportSemanticType 枚举值时重蹈值枚举漏判覆盖。
// ───────────────────────────────────────────────────────────

describe('F259 — commonjs-require 兜底别名覆写同名静态绑定（确定性假边）', () => {
  function mkCallerWithRequireCollision(): Map<string, CodeSkeleton> {
    return mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './lit.js',
            isRelative: true,
            resolvedPath: 'src/lit.ts',
            namedImports: ['js'],
            isTypeOnly: false,
            importType: 'static',
          },
          {
            moduleSpecifier: './dep.js',
            isRelative: true,
            resolvedPath: 'src/dep.ts',
            isTypeOnly: false,
            importType: 'commonjs-require',
          },
        ],
      }),
    ]);
  }

  it("(a) require('./dep.js') 不得覆盖同名静态绑定 alias `js`（复刻 fix-report 探针）", () => {
    const skeletons = mkCallerWithRequireCollision();
    const info = buildImportIndex(skeletons).get('src/caller.ts');
    expect(info?.aliasToTarget.get('js')).toBe('src/lit.ts');
  });

  it("(b) `js()` 调用产出的边指向静态绑定目标，不产出指向 require 目标的 `::js` 假边", () => {
    const skeletons = mkCallerWithRequireCollision();
    const calls: CallSiteWithFile[] = [
      { calleeName: 'js', calleeKind: 'free', line: 3, callerFile: 'src/caller.ts' },
    ];
    const edges = resolveCalls(calls, skeletons);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target).toBe('src/lit.ts::js');
  });

  // (c) 「registerSpecifierFallback 双保险防御（不覆写已有 alias）」曾作为改动点 2 实现，
  // 经内部对抗复审裁定撤回：该函数全仓仅一个调用点，改动点 1 落地后 TS/JS 已不再进入该函数，
  // 防御的实际作用面收窄为纯 Python，把 last-write-wins 改成 first-write-wins 是一次范围外的
  // Python 语义变更（实测 6 个构造中 3 个行为改变，1 变坏 2 变好，并非单纯"防御"）。已撤回，
  // 详见 implementation-notes.md「已知残留」节；Python 侧 lastSeg 撞名（如 `import pkg.util` +
  // `import util` 均落在同一别名 key）沿用改动前 last-write-wins 行为，不在 F259 范围内。
});

describe('F259 — 回归：require 的 depends-on 边不受兜底别名闸收紧影响', () => {
  it("require('./dep.js') 场景下 depends-on 边仍存在（deriveImportEdges 只读 resolvedPath，与 aliasToTarget 无耦合）", () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/caller.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './dep.js',
            isRelative: true,
            resolvedPath: 'src/dep.ts',
            isTypeOnly: false,
            importType: 'commonjs-require',
          },
        ],
      }),
    ]);
    const edges = deriveImportEdges(skeletons);
    expect(edges).toContainEqual(
      expect.objectContaining({
        source: 'src/caller.ts',
        target: 'src/dep.ts',
        relation: 'depends-on',
      }),
    );
  });
});

describe('F259 — 副作用回归：side-effect-only 静态 import 不再注册垃圾别名', () => {
  it("import './x.css'（无 named/default/namespace）不向 aliasToTarget 注册 lastSeg 垃圾别名", () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'src/entry.ts',
        language: 'typescript',
        imports: [
          {
            moduleSpecifier: './x.css',
            isRelative: true,
            resolvedPath: 'src/x.css',
            isTypeOnly: false,
            importType: 'static',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('src/entry.ts');
    expect(info?.aliasToTarget.has('css')).toBe(false);
    expect(info?.aliasToTarget.has('./x.css')).toBe(false);
    expect(info?.aliasToTarget.size).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────
// F259 内部对抗复审裁定 3（WARNING-2）—— 不变量护栏：
// `ImportReference.importType` 在 code-skeleton.ts 是 `.optional()`，"TS/JS 采集路径恒设置该
// 字段"只是一条无机制保障的隐式约定，失效形态是**静默假边**（该 import 会被误判为 Python 语义
// 分支，重新掉进 registerSpecifierFallback）而非报错。用真实采集器（而非手写 skeleton 字面量）
// 对含 4 类 import（static/dynamic/type-only/commonjs-require）的 fixture 跑一遍，钉死这条
// 判据依赖的前提在**当前代码**下成立；未来若某条抽取路径漏填该字段，本用例会 fail-loud。
// ───────────────────────────────────────────────────────────

describe('F259 裁定 3 — TS/JS 采集器产出的每条 import 必填 importType（判据依赖的隐式约定钉死）', () => {
  it('collectTsJsCodeSkeletons 对 4 类 import fixture（static/dynamic/type-only/commonjs-require）产出的 import 条目均带 importType', async () => {
    const fixtureDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../fixtures/156-w1.2-v2/ts-import-types',
    );
    const skeletons = await collectTsJsCodeSkeletons(fixtureDir, { extractCallSites: true });
    const mainSkeleton = [...skeletons.values()].find((sk) => sk.filePath.endsWith('main.ts'));
    expect(mainSkeleton).toBeDefined();
    expect(mainSkeleton?.imports.length).toBeGreaterThanOrEqual(4);
    for (const imp of mainSkeleton?.imports ?? []) {
      expect(imp.importType, `import ${imp.moduleSpecifier} 缺失 importType`).toBeDefined();
    }
    // 逐类核对：main.ts 的 4 个 import 语句对应 4 类 importType 均出现（非仅"某条有值"）
    const seenTypes = new Set((mainSkeleton?.imports ?? []).map((imp) => imp.importType));
    expect(seenTypes).toEqual(
      new Set(['static', 'type-only', 'dynamic', 'commonjs-require']),
    );
  });
});

// ───────────────────────────────────────────────────────────
// F259 裁定 3 补充（内部对抗复审 W2，2026-08-06）——
//
// 上一个 describe 块用 `collectTsJsCodeSkeletons(..., { extractCallSites: true })` 驱动，
// 按 `ts-js-adapter.ts` EC-11 规则，registry 已注册 ts-js adapter 时 imports/exports **恒来自
// ts-morph 主路径**，tree-sitter 侧的 imports 会被丢弃——该用例完全没有覆盖注释点名的
// "tree-sitter 降级路径"。这里直接调用 `TreeSitterAnalyzer.getInstance().analyze()`，绕开
// EC-11 discard 规则，钉死 tree-sitter 路径自身（`typescript-mapper.ts::_extractImportStatement`
// + `tree-sitter-analyzer.ts::postProcessTsJsImports` 协同）产出的 4 类 import 均带 importType。
// ───────────────────────────────────────────────────────────

describe('F259 裁定 3 补充 — tree-sitter 降级路径（绕开 EC-11 discard）产出的 4 类 import 均带 importType', () => {
  it('TreeSitterAnalyzer.analyze() 直接产出的 static/type-only/dynamic/commonjs-require 四类 import 均定义 importType', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f259-tree-sitter-importtype-'));
    const filePath = path.join(tmpDir, 'main.ts');
    const code = [
      "import { staticHello } from './static-target';",
      "import type { TypeOnlyShape } from './type-only-target';",
      "const cjs = require('./cjs-target.cjs');",
      'async function run(): Promise<void> {',
      "  const dyn = await import('./dynamic-target');",
      '  void dyn; void cjs;',
      '}',
      '',
    ].join('\n');
    fs.writeFileSync(filePath, code, 'utf-8');
    try {
      const skeleton = await TreeSitterAnalyzer.getInstance().analyze(filePath, 'typescript');
      expect(skeleton.imports.length).toBeGreaterThanOrEqual(4);
      for (const imp of skeleton.imports) {
        expect(imp.importType, `tree-sitter 路径 import ${imp.moduleSpecifier} 缺失 importType`).toBeDefined();
      }
      const seenTypes = new Set(skeleton.imports.map((imp) => imp.importType));
      expect(seenTypes).toEqual(new Set(['static', 'type-only', 'dynamic', 'commonjs-require']));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────
// F260 P2 — H1 别名键收口（D1）+ re-export 索引对齐
//
// H1：`buildImportIndex` 把 `namedImports` 的元素当作「文件内绑定名」写进 `aliasToTarget`，
// 但两条 TS/JS 抽取路径记的都是**源导出名**。`import { Foo as ExternalFoo } from './a.js'`
// 因此往 b.ts 的表里写入键 `'Foo'` —— 这个名字在 b.ts 里根本没有绑定。文件里若恰好有别的
// 东西叫 `Foo`（非导出本地 class、块级声明…），`Foo.run()` 就会解析出
// `b.ts::use --calls--> a.ts::Foo.run` 这条**确定性假边**（target 节点存在 ⇒ 不悬空 ⇒
// 存活下游全部过滤）。是 F259「表里有一个不该存在的键」的同构复发。
//
// D1 定稿的收口形态是**弃权**而非「改成正确的键」：改键只解决键不解决值 —— `ImportInfo`
// 的值只有文件路径，`import { Foo as ExternalFoo }` 下会拼出 `a.ts::ExternalFoo.run`
// 这个不存在的节点。恢复这部分 recall 需要 `ImportInfo` 携带「源导出名」，登记 R-1。
// ───────────────────────────────────────────────────────────

describe('F260 R1/R2 — H1 别名键收口（D1：重命名 import 一律弃权）', () => {
  const aTs = mkSkeleton({
    filePath: 'a.ts',
    language: 'typescript',
    exports: [
      {
        name: 'Foo',
        kind: 'class',
        signature: 'class Foo',
        isDefault: false,
        startLine: 1,
        endLine: 10,
        members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: false }],
      },
    ],
  });

  it('R1 — 带 namedImportBindings 的重命名 import：`Foo.run()` 不再产出 b.ts::use → a.ts::Foo.run 假边', () => {
    const bTs = mkSkeleton({
      filePath: 'b.ts',
      language: 'typescript',
      exports: [
        { name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 },
      ],
      imports: [
        {
          moduleSpecifier: './a.js',
          isRelative: true,
          resolvedPath: 'a.ts',
          namedImports: ['Foo'],
          namedImportBindings: [{ imported: 'Foo', local: 'ExternalFoo' }],
          isTypeOnly: false,
          importType: 'static',
        },
      ],
    });
    const skeletons = mkSkeletonsMap([aTs, bTs]);

    // 索引层：源导出名 'Foo' 这个幽灵键不得存在；弃权集记的是**本地绑定名** 'ExternalFoo'
    // （记 'Foo' 会误伤 §6 的 retarget 场景：同文件另有 `import { Foo } from './c.js'` 时
    //  键 'Foo' 指向 c.ts 是正确解析，拦掉就把 retarget 变成丢边）
    const info = buildImportIndex(skeletons).get('b.ts');
    expect(info?.aliasToTarget.has('Foo')).toBe(false);
    expect(info?.renamedImportAliases).toEqual(new Set(['ExternalFoo']));

    // 解析层：非导出本地 class Foo（不在 sk.exports ⇒ resolver 侧结构性不可见）+ `Foo.run()`
    const callSites: CallSiteWithFile[] = [
      { callerFile: 'b.ts', calleeName: 'run', calleeKind: 'member', calleeQualifier: 'Foo', callerContext: 'use', line: 3 },
    ];
    const edges = resolveCalls(callSites, skeletons);
    expect(edges.some((e) => e.target === 'a.ts::Foo.run')).toBe(false);
    expect(edges).toEqual([
      { source: 'b.ts::use', target: '?::run', relation: 'calls', confidence: 'medium', directional: true },
    ]);
  });

  it('R1b — 弃权是双向的：真实绑定名 `ExternalFoo.run()` 同样不出边（R-1 登记的 recall 代价，钉死取舍）', () => {
    const bTs = mkSkeleton({
      filePath: 'b.ts',
      language: 'typescript',
      exports: [
        { name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 },
      ],
      imports: [
        {
          moduleSpecifier: './a.js',
          isRelative: true,
          resolvedPath: 'a.ts',
          namedImports: ['Foo'],
          namedImportBindings: [{ imported: 'Foo', local: 'ExternalFoo' }],
          isTypeOnly: false,
          importType: 'static',
        },
      ],
    });
    const skeletons = mkSkeletonsMap([aTs, bTs]);
    const info = buildImportIndex(skeletons).get('b.ts');
    // 「既不写 aliasToTarget 也不写别处」——不得为了保 recall 偷偷写成 ExternalFoo → a.ts，
    // 那会拼出 `a.ts::ExternalFoo.run` 这个不存在的节点（D1 否决 (a) 的直接理由）。
    expect(info?.aliasToTarget.has('ExternalFoo')).toBe(false);
    expect(info?.aliasToTarget.size).toBe(0);
    expect(info?.renamedImportAliases).toEqual(new Set(['ExternalFoo']));

    const edges = resolveCalls(
      [{ callerFile: 'b.ts', calleeName: 'run', calleeKind: 'member', calleeQualifier: 'ExternalFoo', callerContext: 'use', line: 3 }],
      skeletons,
    );
    expect(edges).toEqual([
      { source: 'b.ts::use', target: '?::run', relation: 'calls', confidence: 'medium', directional: true },
    ]);
  });

  it('R1c — 混合条目：同一条 import 里未重命名的说明符照旧写入 aliasToTarget（不误杀合法绑定）', () => {
    const bTs = mkSkeleton({
      filePath: 'b.ts',
      language: 'typescript',
      exports: [
        { name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 },
      ],
      imports: [
        {
          moduleSpecifier: './a.js',
          isRelative: true,
          resolvedPath: 'a.ts',
          namedImports: ['Foo', 'Bar'],
          namedImportBindings: [
            { imported: 'Foo', local: 'ExternalFoo' },
            { imported: 'Bar', local: 'Bar' },
          ],
          isTypeOnly: false,
          importType: 'static',
        },
      ],
    });
    const info = buildImportIndex(mkSkeletonsMap([aTs, bTs])).get('b.ts');
    expect(info?.aliasToTarget.get('Bar')).toBe('a.ts');
    expect(info?.aliasToTarget.has('Foo')).toBe(false);
    expect(info?.renamedImportAliases).toEqual(new Set(['ExternalFoo']));
  });

  it('R2 — 不带 namedImportBindings 的条目（Python / Java / Go / 旧 baseline）行为逐字不变', () => {
    const aPy = mkSkeleton({
      filePath: 'a.py',
      exports: [
        {
          name: 'Foo',
          kind: 'class',
          signature: 'class Foo:',
          isDefault: false,
          startLine: 1,
          endLine: 10,
          members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: false }],
        },
      ],
    });
    const bPy = mkSkeleton({
      filePath: 'b.py',
      exports: [
        { name: 'use', kind: 'function', signature: 'def use()', isDefault: false, startLine: 1, endLine: 5 },
      ],
      imports: [
        {
          moduleSpecifier: 'a',
          isRelative: true,
          resolvedPath: 'a.py',
          namedImports: ['Foo'],
          isTypeOnly: false,
        },
      ],
    });
    const skeletons = mkSkeletonsMap([aPy, bPy]);

    const info = buildImportIndex(skeletons).get('b.py');
    expect(info?.aliasToTarget.get('Foo')).toBe('a.py');
    // 弃权集恒空 —— 缺该字段的条目不得被新逻辑波及（这是 R2 唯一能在实现前判红的锚点：
    // 「行为不变」本身对旧代码恒真，只断言旧行为的用例是绿的，测不出任何东西）
    expect(info?.renamedImportAliases).toEqual(new Set());

    const edges = resolveCalls(
      [{ callerFile: 'b.py', calleeName: 'run', calleeKind: 'member', calleeQualifier: 'Foo', callerContext: 'use', line: 3 }],
      skeletons,
    );
    expect(edges).toEqual([
      { source: 'b.py::use', target: 'a.py::Foo.run', relation: 'calls', confidence: 'medium', directional: true },
    ]);
  });
});

// ───────────────────────────────────────────────────────────
// F260 R3 — buildClassMemberIndex 的 re-export 过滤（plan §5 变更 #1）
//
// ⚠️ 本用例约束的是**索引契约**，不是当前行为：`extractReExports`（`ast-analyzer.ts:141-173`）
// 构造的 `ExportSymbol` **不含 `members` 字段**，而 `buildClassMemberIndex` 首行即
// `if (!exp.members || exp.members.length === 0) continue` ⇒ re-export 条目今天已 100%
// 被跳过（plan §2.2-7），生产端不可达、零行为变化。这里用**人工构造带 members 的
// re-export 条目**把「re-export 别名不建 classKey」钉成结构对齐的显式契约，与
// `buildModuleSymbolIndex` 已有的 `kind === 're-export'` 跳过保持对称。
// ───────────────────────────────────────────────────────────

describe('F260 R3 — buildClassMemberIndex 对 re-export 条目不建 classKey（索引契约）', () => {
  it('R3 — kind==="re-export" 且人工构造带 members 的条目不进 classMemberIndex', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'facade.ts',
        language: 'typescript',
        exports: [
          {
            name: 'Facade',
            kind: 're-export',
            signature: "export { Facade } from './real.js'",
            isDefault: false,
            startLine: 1,
            endLine: 1,
            members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: false }],
          },
          {
            name: 'Real',
            kind: 'class',
            signature: 'class Real',
            isDefault: false,
            startLine: 3,
            endLine: 10,
            members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: false }],
          },
        ],
      }),
    ]);
    const idx = buildClassMemberIndex(skeletons);
    expect(idx.has('facade.ts::Facade')).toBe(false);
    // 对照组：同文件真身 class 条目照常建索引（过滤只针对 re-export，不误伤）
    expect(idx.get('facade.ts::Real')).toEqual(new Set(['run']));
  });
});

// ───────────────────────────────────────────────────────────
// F260 P4 — resolver 新分支（D2b 六条件与门）
//
// 新分支插在 **Stage 1 之后、Stage 2 之前**，只在 `cs.receiverType` 存在时进入；
// 六条件**全部成立**才出边，任一不成立 → fallthrough 到今天的原有路径，**不出任何新边**：
//
//   ① receiverType 存在
//   ② 该名字未被 suppressedDynamicAliases 抑制，且拦截**前置于本模块导出查找**（H5）
//   ③ 类名可定位：本模块导出命中；或 receiverTypeSoleImportBinding===true 且不在
//      renamedImportAliases（D1）且不是 defaultImport 引入的别名（A2）
//   ④ 定位到的 export 条目 kind==='class'
//   ⑤ 方法名存在于**条件 ④ 那一个 export 条目自己的 members**（A6：不得 ④ 查一个索引、
//      ⑤ 查 classMemberIndex —— 后者是 last-write-wins，与 deriveNodesFromSkeletons 的
//      first-write-wins 方向相反，声明合并下二者会指向同名的两个不同条目，R-12）
//   ⑥ 置信度统一 medium
//
// ⚠️ A8（type-only 弃权）**已被编排器撤回**：类型名怎么导入不改变调用事实，
//    「目标是 interface / type」那半边由条件 ④ 独立封死。R9 / R9b 把这条取舍钉成回归断言。
// ───────────────────────────────────────────────────────────

describe('F260 R4–R12 / R16 — resolver 新分支（D2b 六条件与门）', () => {
  /** 验收目标的最小复刻：adapter.ts 导出 class PythonLanguageAdapter#extractSymbolNodes */
  const adapterTs = mkSkeleton({
    filePath: 'adapter.ts',
    language: 'typescript',
    exports: [
      {
        name: 'PythonLanguageAdapter',
        kind: 'class',
        signature: 'class PythonLanguageAdapter',
        isDefault: false,
        startLine: 1,
        endLine: 80,
        members: [
          { name: 'extractSymbolNodes', kind: 'method', signature: 'extractSymbolNodes()', isStatic: false },
        ],
      },
    ],
  });

  /** caller 侧骨架工厂：默认走 dynamic named import（两个验收调用点的真实形态） */
  function mkCaller(opts: {
    imports?: CodeSkeleton['imports'];
    exports?: CodeSkeleton['exports'];
  } = {}): CodeSkeleton {
    return mkSkeleton({
      filePath: 'caller.ts',
      language: 'typescript',
      exports: opts.exports ?? [
        { name: 'runBatch', kind: 'function', signature: 'function runBatch()', isDefault: false, startLine: 1, endLine: 50 },
      ],
      imports: opts.imports ?? [
        {
          moduleSpecifier: '../adapters/python-adapter.js',
          isRelative: true,
          resolvedPath: 'adapter.ts',
          namedImports: ['PythonLanguageAdapter'],
          isTypeOnly: false,
          importType: 'dynamic',
        },
      ],
    });
  }

  it('R4 — F260 真实形态 A：`pythonAdapter.extractSymbolNodes()` + dynamic named import ⇒ medium 边', () => {
    const skeletons = mkSkeletonsMap([adapterTs, mkCaller()]);
    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'extractSymbolNodes',
          calleeKind: 'cross-module',
          calleeQualifier: 'pythonAdapter',
          callerContext: 'runBatch',
          receiverType: 'PythonLanguageAdapter',
          receiverTypeSoleImportBinding: true,
          line: 1217,
        },
      ],
      skeletons,
    );
    expect(edges).toEqual([
      {
        source: 'caller.ts::runBatch',
        target: 'adapter.ts::PythonLanguageAdapter.extractSymbolNodes',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R5 — F260 真实形态 B：`new PythonLanguageAdapter().extractSymbolNodes()` ⇒ 同款 medium 边（H7 已证伪「100% 确定」，不给 high）', () => {
    const skeletons = mkSkeletonsMap([adapterTs, mkCaller({
      exports: [
        { name: 'buildAstGraphOnly', kind: 'function', signature: 'function buildAstGraphOnly()', isDefault: false, startLine: 1, endLine: 50 },
      ],
    })]);
    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'extractSymbolNodes',
          calleeKind: 'cross-module',
          // 整段 new 表达式文本 —— 正是 fix-report §2 实测到的 qualifier 形态
          calleeQualifier: 'new PythonLanguageAdapter()',
          callerContext: 'buildAstGraphOnly',
          receiverType: 'PythonLanguageAdapter',
          receiverTypeSoleImportBinding: true,
          line: 241,
        },
      ],
      skeletons,
    );
    expect(edges).toEqual([
      {
        source: 'caller.ts::buildAstGraphOnly',
        target: 'adapter.ts::PythonLanguageAdapter.extractSymbolNodes',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R6 — 条件 ③ 守卫：receiverTypeSoleImportBinding===false（存在遮蔽）+ 同名 import 在表里 ⇒ 新分支不出边', () => {
    const skeletons = mkSkeletonsMap([adapterTs, mkCaller()]);
    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'extractSymbolNodes',
          calleeKind: 'cross-module',
          calleeQualifier: 'pythonAdapter',
          callerContext: 'runBatch',
          receiverType: 'PythonLanguageAdapter',
          receiverTypeSoleImportBinding: false,
          line: 1217,
        },
      ],
      skeletons,
    );
    // import 表里确实有这个键（对照组：证明拦住它的是 A1 判据而不是「查不到」）
    expect(buildImportIndex(skeletons).get('caller.ts')?.aliasToTarget.get('PythonLanguageAdapter')).toBe('adapter.ts');
    expect(edges).toEqual([]);
  });

  it('R6b — 条件 ③ 的 renamedImportAliases 子句守卫（裁决 P3-2 补强用例）：跨作用域 dynamic 绑定截胡重命名别名 ⇒ 不出边', () => {
    // 承重形态来自 ImportInfo.renamedImportAliases 的字段注释：「不写入」只保证**本条 import**
    // 不贡献键，挡不住别处把同名键写进表 —— 顶层 `import { Foo as X }` 让 X 成为重命名别名，
    // 而块级作用域里的 `const { X } = await import('./c.js')` 会在第二遍把键 X 写成 c.ts。
    // 少了这道闸，顶层的 `x.m()`（receiverType 推断为 X）会被另一个作用域的绑定截胡。
    const cTs = mkSkeleton({
      filePath: 'c.ts',
      language: 'typescript',
      exports: [
        {
          name: 'X',
          kind: 'class',
          signature: 'class X',
          isDefault: false,
          startLine: 1,
          endLine: 10,
          members: [{ name: 'm', kind: 'method', signature: 'm()', isStatic: false }],
        },
      ],
    });
    const callerTs = mkCaller({
      imports: [
        {
          moduleSpecifier: './a.js',
          isRelative: true,
          resolvedPath: 'a.ts',
          namedImports: ['Foo'],
          namedImportBindings: [{ imported: 'Foo', local: 'X' }],
          isTypeOnly: false,
          importType: 'static',
        },
        { moduleSpecifier: './c.js', isRelative: true, resolvedPath: 'c.ts', namedImports: ['X'], isTypeOnly: false, importType: 'dynamic' },
      ],
      exports: [{ name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 }],
    });
    const skeletons = mkSkeletonsMap([cTs, callerTs]);
    const info = buildImportIndex(skeletons).get('caller.ts');
    // 前提核实：键 X 确实在表里且指向 c.ts（否则本用例拦的是「查不到」而不是这道闸）
    expect(info?.aliasToTarget.get('X')).toBe('c.ts');
    expect(info?.renamedImportAliases.has('X')).toBe(true);

    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'm',
          calleeKind: 'cross-module',
          calleeQualifier: 'x',
          callerContext: 'use',
          receiverType: 'X',
          receiverTypeSoleImportBinding: true,
          line: 3,
        },
      ],
      skeletons,
    );
    expect(edges.some((e) => e.target === 'c.ts::X.m')).toBe(false);
    expect(edges).toEqual([]);
  });

  it('R7 — fail-closed：receiverType 存在但 receiverTypeSoleImportBinding 缺席（旧 baseline / 非 TS mapper）⇒ 不出边', () => {
    const skeletons = mkSkeletonsMap([adapterTs, mkCaller()]);
    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'extractSymbolNodes',
          calleeKind: 'cross-module',
          calleeQualifier: 'pythonAdapter',
          callerContext: 'runBatch',
          receiverType: 'PythonLanguageAdapter',
          // receiverTypeSoleImportBinding 刻意缺席 —— undefined 必须按 false 处理
          line: 1217,
        },
      ],
      skeletons,
    );
    expect(edges).toEqual([]);
  });

  it('R8 — H5 守卫：名字被 suppressedDynamicAliases 抑制且 caller 模块有同名本地导出类 ⇒ 不出边（拦截前置于本模块导出查找）', () => {
    // 同一别名 Alpha 有两条指向不同模块的 dynamic 绑定 ⇒ 歧义 ⇒ 入抑制集
    const callerTs = mkSkeleton({
      filePath: 'caller.ts',
      language: 'typescript',
      exports: [
        { name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 },
        {
          name: 'Alpha',
          kind: 'class',
          signature: 'class Alpha',
          isDefault: false,
          startLine: 7,
          endLine: 20,
          members: [{ name: 'm', kind: 'method', signature: 'm()', isStatic: false }],
        },
      ],
      imports: [
        { moduleSpecifier: './x.js', isRelative: true, resolvedPath: 'x.ts', namedImports: ['Alpha'], isTypeOnly: false, importType: 'dynamic' },
        { moduleSpecifier: './y.js', isRelative: true, resolvedPath: 'y.ts', namedImports: ['Alpha'], isTypeOnly: false, importType: 'dynamic' },
      ],
    });
    const skeletons = mkSkeletonsMap([callerTs]);
    expect(buildImportIndex(skeletons).get('caller.ts')?.suppressedDynamicAliases.has('Alpha')).toBe(true);

    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'm',
          calleeKind: 'cross-module',
          calleeQualifier: 'alpha',
          callerContext: 'use',
          receiverType: 'Alpha',
          // 刻意 false：本模块导出分支不看这个标志，所以拦住它的只能是 ②
          receiverTypeSoleImportBinding: false,
          line: 9,
        },
      ],
      skeletons,
    );
    expect(edges.some((e) => e.target === 'caller.ts::Alpha.m')).toBe(false);
    expect(edges).toEqual([]);
  });

  it('R9 — type-only import 指向 interface：不出边（由条件 ④ 保证，不是 A8）', () => {
    const rTs = mkSkeleton({
      filePath: 'r.ts',
      language: 'typescript',
      exports: [
        {
          name: 'Runner',
          kind: 'interface',
          signature: 'interface Runner',
          isDefault: false,
          startLine: 1,
          endLine: 5,
          members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: false }],
        },
      ],
    });
    const callerTs = mkCaller({
      imports: [
        { moduleSpecifier: './r.js', isRelative: true, resolvedPath: 'r.ts', namedImports: ['Runner'], isTypeOnly: true, importType: 'type-only' },
      ],
      exports: [{ name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 }],
    });
    const skeletons = mkSkeletonsMap([rTs, callerTs]);
    // type-only 条目照常进 aliasToTarget（buildImportIndex 只跳过 dynamic）⇒ 拦住它的必须是 ④
    expect(buildImportIndex(skeletons).get('caller.ts')?.aliasToTarget.get('Runner')).toBe('r.ts');

    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'run',
          calleeKind: 'cross-module',
          calleeQualifier: 'x',
          callerContext: 'use',
          receiverType: 'Runner',
          receiverTypeSoleImportBinding: true,
          line: 3,
        },
      ],
      skeletons,
    );
    expect(edges.some((e) => e.target === 'r.ts::Runner.run')).toBe(false);
    expect(edges).toEqual([]);
  });

  it('R9b — A8 撤回的回归钉：`import type { Foo }` 指向 **class** ⇒ 照常出边（类型名怎么导入不改变调用事实）', () => {
    const aTs = mkSkeleton({
      filePath: 'a.ts',
      language: 'typescript',
      exports: [
        {
          name: 'Foo',
          kind: 'class',
          signature: 'class Foo',
          isDefault: false,
          startLine: 1,
          endLine: 10,
          members: [{ name: 'm', kind: 'method', signature: 'm()', isStatic: false }],
        },
      ],
    });
    const callerTs = mkCaller({
      imports: [
        { moduleSpecifier: './a.js', isRelative: true, resolvedPath: 'a.ts', namedImports: ['Foo'], isTypeOnly: true, importType: 'type-only' },
      ],
      exports: [{ name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 }],
    });
    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'm',
          calleeKind: 'cross-module',
          calleeQualifier: 'x',
          callerContext: 'use',
          receiverType: 'Foo',
          receiverTypeSoleImportBinding: true,
          line: 3,
        },
      ],
      mkSkeletonsMap([aTs, callerTs]),
    );
    expect(edges).toEqual([
      { source: 'caller.ts::use', target: 'a.ts::Foo.m', relation: 'calls', confidence: 'medium', directional: true },
    ]);
  });

  it('R10 — 条件 ④ 守卫：本模块导出命中但条目 kind==="interface" ⇒ 不出边', () => {
    const callerTs = mkSkeleton({
      filePath: 'caller.ts',
      language: 'typescript',
      exports: [
        { name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 },
        {
          name: 'Local',
          kind: 'interface',
          signature: 'interface Local',
          isDefault: false,
          startLine: 7,
          endLine: 12,
          members: [{ name: 'm', kind: 'method', signature: 'm()', isStatic: false }],
        },
      ],
    });
    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'm',
          calleeKind: 'cross-module',
          calleeQualifier: 'local',
          callerContext: 'use',
          receiverType: 'Local',
          receiverTypeSoleImportBinding: false,
          line: 9,
        },
      ],
      mkSkeletonsMap([callerTs]),
    );
    expect(edges.some((e) => e.target === 'caller.ts::Local.m')).toBe(false);
    expect(edges).toEqual([]);
  });

  it('R10b — A6 声明合并：④ 与 ⑤ 必须绑定到**同一个** export 条目，且选条目走 first-write-wins（与 deriveNodesFromSkeletons 同序）', () => {
    /** class 在前的声明合并：`export class Foo` + `export interface Foo`（成员集不同） */
    const classFirst = mkSkeleton({
      filePath: 'a.ts',
      language: 'typescript',
      exports: [
        {
          name: 'Foo',
          kind: 'class',
          signature: 'class Foo',
          isDefault: false,
          startLine: 1,
          endLine: 10,
          members: [{ name: 'onClass', kind: 'method', signature: 'onClass()', isStatic: false }],
        },
        {
          name: 'Foo',
          kind: 'interface',
          signature: 'interface Foo',
          isDefault: false,
          startLine: 12,
          endLine: 16,
          members: [{ name: 'onInterface', kind: 'method', signature: 'onInterface()', isStatic: false }],
        },
      ],
    });
    const callerTs = mkCaller({
      imports: [
        { moduleSpecifier: './a.js', isRelative: true, resolvedPath: 'a.ts', namedImports: ['Foo'], isTypeOnly: false, importType: 'static' },
      ],
      exports: [{ name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 }],
    });
    const mkCs = (calleeName: string): CallSiteWithFile => ({
      callerFile: 'caller.ts',
      calleeName,
      calleeKind: 'cross-module',
      calleeQualifier: 'foo',
      callerContext: 'use',
      receiverType: 'Foo',
      receiverTypeSoleImportBinding: true,
      line: 3,
    });

    // class 条目自己的成员 ⇒ 出边
    expect(resolveCalls([mkCs('onClass')], mkSkeletonsMap([classFirst, callerTs]))).toEqual([
      { source: 'caller.ts::use', target: 'a.ts::Foo.onClass', relation: 'calls', confidence: 'medium', directional: true },
    ]);
    // 方法只存在于 interface 条目 ⇒ 不出边（⑤ 只认 ④ 那一条的 members）
    // 反面对照：classMemberIndex 是 last-write-wins ⇒ 它认为 a.ts::Foo 的成员集是 interface 那条，
    // 「④ 查一个索引、⑤ 查 classMemberIndex」的实现会在这里放行 onInterface（A6 要封死的正是它）
    expect(buildClassMemberIndex(mkSkeletonsMap([classFirst, callerTs])).get('a.ts::Foo')).toEqual(new Set(['onInterface']));
    expect(resolveCalls([mkCs('onInterface')], mkSkeletonsMap([classFirst, callerTs]))).toEqual([]);

    // interface 在前：deriveNodesFromSkeletons 是 first-write-wins ⇒ 图上 a.ts::Foo 的
    // metadata.exportKind 就是 'interface'。选条目若不与它同序，出的边会挂在 interface 符号节点上，
    // 直接打破 §7.1 断言 2。因此此序下**一律弃权**（recall 代价明确，取舍钉死在这里）。
    const interfaceFirst = mkSkeleton({
      filePath: 'a.ts',
      language: 'typescript',
      exports: [classFirst.exports[1]!, classFirst.exports[0]!],
    });
    expect(resolveCalls([mkCs('onClass')], mkSkeletonsMap([interfaceFirst, callerTs]))).toEqual([]);
  });

  it('R10c — A2 default import 守卫：`import Foo from "./a.js"` 且 a.ts 另有具名 `export class Foo` ⇒ 不出边', () => {
    const aTs = mkSkeleton({
      filePath: 'a.ts',
      language: 'typescript',
      exports: [
        {
          name: 'Foo',
          kind: 'class',
          signature: 'class Foo',
          isDefault: false,
          startLine: 1,
          endLine: 10,
          members: [{ name: 'm', kind: 'method', signature: 'm()', isStatic: false }],
        },
      ],
    });
    const callerTs = mkCaller({
      imports: [
        { moduleSpecifier: './a.js', isRelative: true, resolvedPath: 'a.ts', defaultImport: 'Foo', isTypeOnly: false, importType: 'static' },
      ],
      exports: [{ name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 }],
    });
    const skeletons = mkSkeletonsMap([aTs, callerTs]);
    // default 别名照常在 aliasToTarget 里（A2 只约束新分支，既有 Stage 2/3 一行未动 ⇒ R-11）
    expect(buildImportIndex(skeletons).get('caller.ts')?.aliasToTarget.get('Foo')).toBe('a.ts');

    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'm',
          calleeKind: 'cross-module',
          calleeQualifier: 'foo',
          callerContext: 'use',
          receiverType: 'Foo',
          receiverTypeSoleImportBinding: true,
          line: 3,
        },
      ],
      skeletons,
    );
    expect(edges.some((e) => e.target === 'a.ts::Foo.m')).toBe(false);
    expect(edges).toEqual([]);
  });

  it('R11 — 成员验证失败：目标类存在但成员集无该方法 ⇒ 不出边，且**不产 medium 占位**（占位是悬空边，只抬高 dangling）', () => {
    const aTs = mkSkeleton({
      filePath: 'a.ts',
      language: 'typescript',
      exports: [
        {
          name: 'Foo',
          kind: 'class',
          signature: 'class Foo',
          isDefault: false,
          startLine: 1,
          endLine: 10,
          members: [{ name: 'run', kind: 'method', signature: 'run()', isStatic: false }],
        },
      ],
    });
    const callerTs = mkCaller({
      imports: [
        { moduleSpecifier: './a.js', isRelative: true, resolvedPath: 'a.ts', namedImports: ['Foo'], isTypeOnly: false, importType: 'static' },
      ],
      exports: [{ name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 }],
    });
    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'missing',
          calleeKind: 'cross-module',
          calleeQualifier: 'foo',
          callerContext: 'use',
          receiverType: 'Foo',
          receiverTypeSoleImportBinding: true,
          line: 3,
        },
      ],
      mkSkeletonsMap([aTs, callerTs]),
    );
    expect(edges.some((e) => e.target.startsWith('a.ts::Foo.'))).toBe(false);
    expect(edges).toEqual([]);
  });

  it('R12 — 不夺路：receiverType 缺席的既有形态边集逐字不变；条件 ②–⑤ 弃权时 fallthrough 回同一条既有路径', () => {
    const uTs = mkSkeleton({
      filePath: 'u.ts',
      language: 'typescript',
      exports: [{ name: 'util', kind: 'function', signature: 'function util()', isDefault: false, startLine: 1, endLine: 3 }],
    });
    const callerTs = mkSkeleton({
      filePath: 'caller.ts',
      language: 'typescript',
      exports: [
        { name: 'helper', kind: 'function', signature: 'function helper()', isDefault: false, startLine: 1, endLine: 3 },
        { name: 'run', kind: 'function', signature: 'function run()', isDefault: false, startLine: 5, endLine: 30 },
        {
          name: 'C',
          kind: 'class',
          signature: 'class C',
          isDefault: false,
          startLine: 32,
          endLine: 50,
          members: [{ name: 'm', kind: 'method', signature: 'm()', isStatic: false }],
        },
      ],
      imports: [
        { moduleSpecifier: './u.js', isRelative: true, resolvedPath: 'u.ts', namedImports: ['util'], isTypeOnly: false, importType: 'static' },
      ],
    });
    const skeletons = mkSkeletonsMap([uTs, callerTs]);

    /** 六种既有形态，全部**不带** receiverType */
    const legacy: CallSiteWithFile[] = [
      { callerFile: 'caller.ts', calleeName: 'helper', calleeKind: 'free', callerContext: 'run', line: 1 },
      { callerFile: 'caller.ts', calleeName: 'm', calleeKind: 'member', calleeQualifier: 'C', callerContext: 'run', line: 2 },
      { callerFile: 'caller.ts', calleeName: 'util', calleeKind: 'cross-module', callerContext: 'run', line: 3 },
      { callerFile: 'caller.ts', calleeName: 'base', calleeKind: 'super', callerContext: 'C.m', line: 4 },
      { callerFile: 'caller.ts', calleeName: 'ghost', calleeKind: 'unresolved', callerContext: 'run', line: 5 },
      { callerFile: 'caller.ts', calleeName: 'nope', calleeKind: 'member', calleeQualifier: 'Unknown', callerContext: 'run', line: 6 },
    ];
    const expected = [
      { source: 'caller.ts::run', target: 'caller.ts::helper', relation: 'calls', confidence: 'high', directional: true },
      { source: 'caller.ts::run', target: 'caller.ts::C.m', relation: 'calls', confidence: 'high', directional: true },
      { source: 'caller.ts::run', target: 'u.ts::util', relation: 'calls', confidence: 'medium', directional: true },
      { source: 'caller.ts::C.m', target: '?::base', relation: 'calls', confidence: 'low', directional: true },
      { source: 'caller.ts::run', target: '?::ghost', relation: 'calls', confidence: 'low', directional: true },
      { source: 'caller.ts::run', target: '?::nope', relation: 'calls', confidence: 'medium', directional: true },
    ];
    expect(resolveCalls(legacy, skeletons)).toEqual(expected);

    // fallthrough 语义：给同一批调用点补上**过不了闸**的 receiverType（'Unknown' 在两侧
    // 都没有 export 条目 ⇒ 条件 ④ 弃权），边集必须**逐字不变** —— 弃权是 fallthrough，
    // 不是「返回一条 ?:: 占位」或「短路成 null」。
    const withDeclinedReceiver = legacy.map((cs) => ({
      ...cs,
      receiverType: 'Unknown',
      receiverTypeSoleImportBinding: true,
    }));
    expect(resolveCalls(withDeclinedReceiver, skeletons)).toEqual(expected);
  });

  it('R16 — dynamic 解构形态必须出边（验收断言 1 的单测镜像）：别名不在抑制集 ⇒ medium 边', () => {
    const aTs = mkSkeleton({
      filePath: 'a.ts',
      language: 'typescript',
      exports: [
        {
          name: 'Foo',
          kind: 'class',
          signature: 'class Foo',
          isDefault: false,
          startLine: 1,
          endLine: 10,
          members: [{ name: 'm', kind: 'method', signature: 'm()', isStatic: false }],
        },
      ],
    });
    const callerTs = mkCaller({
      imports: [
        { moduleSpecifier: './a.js', isRelative: true, resolvedPath: 'a.ts', namedImports: ['Foo'], isTypeOnly: false, importType: 'dynamic' },
      ],
      exports: [{ name: 'use', kind: 'function', signature: 'function use()', isDefault: false, startLine: 1, endLine: 5 }],
    });
    const skeletons = mkSkeletonsMap([aTs, callerTs]);
    const info = buildImportIndex(skeletons).get('caller.ts');
    expect(info?.suppressedDynamicAliases.has('Foo')).toBe(false);
    expect(info?.aliasToTarget.get('Foo')).toBe('a.ts');

    const edges = resolveCalls(
      [
        {
          callerFile: 'caller.ts',
          calleeName: 'm',
          calleeKind: 'cross-module',
          calleeQualifier: 'foo',
          callerContext: 'use',
          receiverType: 'Foo',
          receiverTypeSoleImportBinding: true,
          line: 3,
        },
      ],
      skeletons,
    );
    expect(edges).toEqual([
      { source: 'caller.ts::use', target: 'a.ts::Foo.m', relation: 'calls', confidence: 'medium', directional: true },
    ]);
  });
});

// ───────────────────────────────────────────────────────────
// F260 P4b — M1 净回归钉（plan §13）
//
// plan §13 M1 的第三个实测反例是**唯一一条从正确边退化成假边的净回归**：
// 本地 `class Local` 只进表 1、不进表 2 ⇒ 另一处 `function helper(Local: A)` 的形参
// 独占表 2 的 `Local` 键 ⇒ 顶层 `Local.q()` 拿到 `receiverType='A'`，
// 新分支抢在 Stage 2 之前把边指到 `a.ts::A.q`，而正确答案是本模块的 `Local.q`。
//
// 本用例走**真实抽取**（`collectTsJsCodeSkeletons` + `resolveCalls` 生产路径），
// 不手工构造 CallSite —— 只有端到端才能观测到「谁夺了路」。
// ───────────────────────────────────────────────────────────

describe('F260 P4b R17 — M1 净回归钉：本地类的调用边不得被同名形参的类型注解夺路', () => {
  it('R17 — `Local.q()` 解析到本模块 `Local.q`，不指向 import 来的 `A.q`', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f260-p4b-r17-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'a.ts'),
        'export class A {\n  q(): void {}\n}\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(tmpDir, 'caller.ts'),
        [
          "import { A } from './a.js';",
          'export class Local {',
          '  static q(): void {}',
          '}',
          'export function helper(Local: A): void { Local.q(); }',
          'export function top(): void { Local.q(); }',
          '',
        ].join('\n'),
        'utf-8',
      );

      const skeletons = await collectTsJsCodeSkeletons(tmpDir, { extractCallSites: true });
      const callerPath = path.join(tmpDir, 'caller.ts');
      const aPath = path.join(tmpDir, 'a.ts');
      const caller = skeletons.get(callerPath);
      expect(caller, 'caller.ts 未被采集').toBeDefined();

      // 前提钉死：`top` 里的 Local.q() 确实被抽取为调用点，且已按 M1 弃权
      const topCall = (caller?.callSites ?? []).find(
        (cs) => cs.calleeName === 'q' && cs.callerContext === 'top',
      );
      expect(topCall, 'top 内的 Local.q() 未被抽取').toBeDefined();
      expect(topCall?.receiverType).toBeUndefined();

      const callSites: CallSiteWithFile[] = [];
      for (const [filePath, sk] of skeletons) {
        for (const cs of sk.callSites ?? []) callSites.push({ ...cs, callerFile: filePath });
      }
      const edges = resolveCalls(callSites, skeletons);
      const fromTop = edges.filter((e) => e.source === `${callerPath}::top`);

      expect(fromTop.map((e) => e.target)).toContain(`${callerPath}::Local.q`);
      expect(fromTop.some((e) => e.target === `${aPath}::A.q`)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────
// F260 P5 — TS/JS `extends` MRO（plan §4-D3 / 变更 #12）
//
// `buildClassMroIndex` 的 SUPERCLASS_RE 是 Python 语法（`class Foo(Bar):`），
// 而 TS/JS class signature 形态是 `class Foo<T> extends Bar implements Baz`（不含圆括号）
// ⇒ 该索引对 TS **恒为空**，Stage 2 的 MRO 第二重验证与 Stage 4 的 super 解析在 TS 上是死代码。
//
// 本阶段补 TS/JS 分支，三条硬约束（plan §4-D3）逐条对应用例：
//   1. **A7 收窄**：TS/JS 分支内**仅 `kind === 'class'` 进 MRO**（R14b）。
//      原判据 `kind !== 'class' && kind !== 'interface'` 把 interface 也纳入处理范围；
//      不收窄则 `interface A extends B` 会进 MRO ⇒ interface-target 边 ⇒ 打破验收断言 2。
//      **Python / Java / Go 等非 ts/js 分支逐字保持原判据**（R15）。
//   2. **`implements` 截断**：只取 `extends` 之后、`implements` 之前的片段（R14）。
//   3. **B7 语言分流用正向判据**（`sk.language === 'typescript' | 'javascript'`），
//      禁止「非 Python 即 TS」的反向判据 —— fixture 里有 Java class（`public class Foo`），
//      反向判据会让 Java 骨架进 TS 分支，而 collector-fingerprint 护栏对此结构性抓不到（R14c）。
//
// 另两条来自审查的约束：R20/R21 钉 `lookupInMro` 的 superName 解析（同一张 `aliasToTarget`
// 表的第二个消费点）；R22 钉非裸标识符父类（`mixin(Base)` / `Base.Nested` / 类表达式）不出边。
// ───────────────────────────────────────────────────────────

/** P5 用例共用：构造一个带 members 的 TS class export 条目。 */
function tsClass(
  name: string,
  signature: string,
  memberNames: string[],
  kind: 'class' | 'interface' = 'class',
): CodeSkeleton['exports'][number] {
  return {
    name,
    kind,
    signature,
    isDefault: false,
    startLine: 1,
    endLine: 20,
    members: memberNames.map((m) => ({
      name: m,
      kind: 'method' as const,
      signature: `${m}()`,
      isStatic: false,
    })),
  };
}

/** P5 用例共用：`this.<callee>()` 形态的 callSite（mapper 对 this.x() 不产 qualifier）。 */
function thisCall(callerFile: string, hostClass: string, callee: string): CallSiteWithFile {
  return {
    callerFile,
    calleeName: callee,
    calleeKind: 'member',
    callerContext: `${hostClass}.run`,
    line: 7,
  };
}

describe('F260 R13–R15 — TS/JS extends MRO（A7 收窄 + implements 截断 + B7 语言分流）', () => {
  it('R13 — `class Sub extends Base` 且 Base 有 m ⇒ 产出 `base.ts::Base.m` 边（medium）', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'base.ts',
        language: 'typescript',
        exports: [tsClass('Base', 'class Base', ['m'])],
      }),
      mkSkeleton({
        filePath: 'sub.ts',
        language: 'typescript',
        exports: [tsClass('Sub', 'class Sub extends Base', ['run'])],
        imports: [
          {
            moduleSpecifier: './base.js',
            isRelative: true,
            resolvedPath: 'base.ts',
            namedImports: ['Base'],
            isTypeOnly: false,
            importType: 'static',
          },
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('sub.ts::Sub')).toEqual(['Base']);
    expect(resolveCalls([thisCall('sub.ts', 'Sub', 'm')], skeletons)).toEqual([
      {
        source: 'sub.ts::Sub.run',
        target: 'base.ts::Base.m',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R13b — JS 骨架（`language==="javascript"`）同样进 TS/JS 分支', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'base.mjs',
        language: 'javascript',
        exports: [tsClass('Base', 'class Base', ['m'])],
      }),
      mkSkeleton({
        filePath: 'sub.mjs',
        language: 'javascript',
        exports: [tsClass('Sub', 'class Sub extends Base', ['run'])],
        imports: [
          {
            moduleSpecifier: './base.mjs',
            isRelative: true,
            resolvedPath: 'base.mjs',
            namedImports: ['Base'],
            isTypeOnly: false,
            importType: 'static',
          },
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('sub.mjs::Sub')).toEqual(['Base']);
  });

  it('R13c — 端到端（真实抽取）：`this.m()` 与 `super.m()` 都解析到父类，签名形态不靠假设', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f260-p5-r13c-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'base.ts'),
        'export class Base {\n  m(): void {}\n}\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(tmpDir, 'sub.ts'),
        [
          "import { Base } from './base.js';",
          'export class Sub extends Base {',
          '  run(): void { this.m(); }',
          '  viaSuper(): void { super.m(); }',
          '}',
          '',
        ].join('\n'),
        'utf-8',
      );

      const skeletons = await collectTsJsCodeSkeletons(tmpDir, { extractCallSites: true });
      const subPath = path.join(tmpDir, 'sub.ts');
      const basePath = path.join(tmpDir, 'base.ts');
      // 前提钉死：ts-morph 产出的 class signature 形态确实是 `class Sub extends Base`
      const subExport = skeletons.get(subPath)?.exports.find((e) => e.name === 'Sub');
      expect(subExport?.signature).toBe('class Sub extends Base');

      const callSites: CallSiteWithFile[] = [];
      for (const [filePath, sk] of skeletons) {
        for (const cs of sk.callSites ?? []) callSites.push({ ...cs, callerFile: filePath });
      }
      const edges = resolveCalls(callSites, skeletons);
      // Stage 2 member 路径（this.m()）
      expect(edges).toContainEqual({
        source: `${subPath}::Sub.run`,
        target: `${basePath}::Base.m`,
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      });
      // Stage 4 super 路径（super.m()）
      expect(edges).toContainEqual({
        source: `${subPath}::Sub.viaSuper`,
        target: `${basePath}::Base.m`,
        relation: 'calls',
        confidence: 'low',
        directional: true,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('R14 — `class Foo extends Bar implements Baz`：MRO 不含 Baz，interface 成员不得被当父类方法', () => {
    // 判别性构造：**Bar 没有 m、Baz 有 m**。未在 ` implements ` 处截断时 MRO = ['Bar','Baz']，
    // lookupInMro 会命中 interface 条目 Baz 并产出 `foo.ts::Baz.m` —— 正是断言 2 的 interface-target 违规。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'foo.ts',
        language: 'typescript',
        exports: [
          tsClass('Foo', 'class Foo extends Bar implements Baz', ['run']),
          tsClass('Bar', 'class Bar', ['other']),
          tsClass('Baz', 'interface Baz', ['m'], 'interface'),
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('foo.ts::Foo')).toEqual(['Bar']);
    const edges = resolveCalls([thisCall('foo.ts', 'Foo', 'm')], skeletons);
    expect(edges.map((e) => e.target)).not.toContain('foo.ts::Baz.m');
    // MRO 落空 ⇒ 回落既有 medium 占位（Stage 2 原有行为，不产 interface-target 边）
    expect(edges).toEqual([
      {
        source: 'foo.ts::Foo.run',
        target: 'foo.ts::Foo.m',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R14b — A7 收窄：TS `interface A extends B` 不进 classMroIndex（interface-target 边的源头）', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'iface.ts',
        language: 'typescript',
        exports: [
          tsClass('A', 'interface A extends B', ['run'], 'interface'),
          tsClass('B', 'interface B', ['m'], 'interface'),
        ],
      }),
    ]);
    const idx = buildClassMroIndex(skeletons);
    expect(idx.has('iface.ts::A')).toBe(false);
    // 行为面：`this.m()` 落 medium 占位，不产出 `iface.ts::B.m` 这条 interface-target 边
    const edges = resolveCalls([thisCall('iface.ts', 'A', 'm')], skeletons);
    expect(edges.map((e) => e.target)).not.toContain('iface.ts::B.m');
  });

  it('R14c — B7 语言分流：`language==="java"` 的骨架不得被 TS extends 分支吃到', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'Foo.java',
        language: 'java',
        exports: [
          tsClass('Foo', 'public class Foo extends Bar', ['run']),
          tsClass('Bar', 'public class Bar', ['m']),
        ],
      }),
    ]);
    // 与修改前逐字一致：Java signature 无圆括号 ⇒ Python 正则不命中 ⇒ 无条目
    expect(buildClassMroIndex(skeletons).has('Foo.java::Foo')).toBe(false);
    expect(resolveCalls([thisCall('Foo.java', 'Foo', 'm')], skeletons)).toEqual([
      {
        source: 'Foo.java::Foo.run',
        target: 'Foo.java::Foo.m',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R15 — Python 分支逐字不变：圆括号父类 / Generic[T] 剥离 / object 过滤 / interface kind 继续允许', () => {
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
          {
            name: 'Container',
            kind: 'class',
            signature: 'class Container(Generic[T, U], Mapping[str, int]):',
            isDefault: false,
            startLine: 22,
            endLine: 40,
          },
          {
            name: 'Legacy',
            kind: 'class',
            signature: 'class Legacy(object):',
            isDefault: false,
            startLine: 42,
            endLine: 50,
          },
          // A7 的收窄**只对 TS/JS 生效** —— 非 ts/js 分支的 interface kind 必须继续进 MRO
          {
            name: 'IFoo',
            kind: 'interface',
            signature: 'class IFoo(IBase):',
            isDefault: false,
            startLine: 52,
            endLine: 60,
          },
        ],
      }),
    ]);
    const idx = buildClassMroIndex(skeletons);
    expect(idx.get('a.py::Foo')).toEqual(['Bar', 'Baz']);
    expect(idx.get('a.py::Container')).toEqual(['Generic', 'Mapping']);
    expect(idx.has('a.py::Legacy')).toBe(false); // 'object' 被过滤后 supers 为空
    expect(idx.get('a.py::IFoo')).toEqual(['IBase']);
  });

  it('R18 — `stripGenericParams` 同时支持 `<`：`extends Base<Cfg>` ⇒ 父类名 `Base`', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'base.ts',
        language: 'typescript',
        exports: [tsClass('Base', 'class Base<T>', ['m'])],
      }),
      mkSkeleton({
        filePath: 'sub.ts',
        language: 'typescript',
        exports: [tsClass('Sub', 'class Sub extends Base<Cfg>', ['run'])],
        imports: [
          {
            moduleSpecifier: './base.js',
            isRelative: true,
            resolvedPath: 'base.ts',
            namedImports: ['Base'],
            isTypeOnly: false,
            importType: 'static',
          },
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('sub.ts::Sub')).toEqual(['Base']);
    expect(resolveCalls([thisCall('sub.ts', 'Sub', 'm')], skeletons)[0]?.target).toBe(
      'base.ts::Base.m',
    );
  });

  it('R19 — 类型参数里的 `extends` 不得被当成继承子句（只认顶层 extends）', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'g.ts',
        language: 'typescript',
        exports: [
          // (a) 只有类型参数约束，没有真正的继承子句 ⇒ 不得产生任何 MRO 条目
          tsClass('Solo', 'class Solo<T extends Cfg>', ['run']),
          // (b) 类型参数约束 + 真正的继承子句 ⇒ 只取顶层那个
          tsClass('Sub', 'class Sub<T extends Cfg> extends Base', ['run']),
          // (c) 类型参数里含函数类型（`=>` 的 `>` 不得被当作尖括号闭合）
          tsClass('Fn', 'class Fn<T extends (x: number) => void> extends Base', ['run']),
          tsClass('Base', 'class Base', ['m']),
        ],
      }),
    ]);
    const idx = buildClassMroIndex(skeletons);
    expect(idx.has('g.ts::Solo')).toBe(false);
    expect(idx.get('g.ts::Sub')).toEqual(['Base']);
    expect(idx.get('g.ts::Fn')).toEqual(['Base']);
    expect(resolveCalls([thisCall('g.ts', 'Sub', 'm')], skeletons)[0]?.target).toBe('g.ts::Base.m');
  });

  it('R20 — D3-4 前半：重命名 import 的基类不经幽灵键解析（P2 收口在 lookupInMro 上自动继承）', () => {
    // `import { Base as Alias }`：P2 之后 `aliasToTarget` 不再写幽灵键 `Base`（本文件根本没有这个绑定），
    // 因此 lookupInMro 用源码里真实写出的父类名 `Alias` 去查表时天然落空 —— 无需额外拦截。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'base.ts',
        language: 'typescript',
        exports: [tsClass('Base', 'class Base', ['m'])],
      }),
      mkSkeleton({
        filePath: 'sub.ts',
        language: 'typescript',
        exports: [tsClass('Sub', 'class Sub extends Alias', ['run'])],
        imports: [
          {
            moduleSpecifier: './base.js',
            isRelative: true,
            resolvedPath: 'base.ts',
            namedImports: ['Base'],
            namedImportBindings: [{ imported: 'Base', local: 'Alias' }],
            isTypeOnly: false,
            importType: 'static',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('sub.ts');
    expect(info?.aliasToTarget.has('Base')).toBe(false); // 幽灵键已被 P2 收口
    expect(info?.renamedImportAliases.has('Alias')).toBe(true);
    expect(buildClassMroIndex(skeletons).get('sub.ts::Sub')).toEqual(['Alias']);
    // 父类定位落空 ⇒ 回落 Stage 2 既有 medium 占位，不产出 `base.ts::Base.m`
    expect(resolveCalls([thisCall('sub.ts', 'Sub', 'm')], skeletons)).toEqual([
      {
        source: 'sub.ts::Sub.run',
        target: 'sub.ts::Sub.m',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R21 — D3-4 后半：`lookupInMro` 必须显式拦 renamedImportAliases（跨作用域绑定截胡父类名）', () => {
    // 「不写入」只保证本条 import 不贡献键，挡不住**别处**把同名键写进表（见 ImportInfo
    // .renamedImportAliases 字段注释）：顶层 `import { Base as Alias }` 让 Alias 成为重命名别名，
    // 而块级作用域里的 `const { Alias } = await import('./other.js')` 会在第二遍把键 Alias 写成
    // other.ts。此时 `class Sub extends Alias` 的父类会被另一个作用域的绑定截胡，
    // 产出 `other.ts::Alias.m` 这条确定性假边（真身是 base.ts 的 Base）。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'base.ts',
        language: 'typescript',
        exports: [tsClass('Base', 'class Base', ['m'])],
      }),
      mkSkeleton({
        filePath: 'other.ts',
        language: 'typescript',
        exports: [tsClass('Alias', 'class Alias', ['m'])],
      }),
      mkSkeleton({
        filePath: 'sub.ts',
        language: 'typescript',
        exports: [tsClass('Sub', 'class Sub extends Alias', ['run'])],
        imports: [
          {
            moduleSpecifier: './base.js',
            isRelative: true,
            resolvedPath: 'base.ts',
            namedImports: ['Base'],
            namedImportBindings: [{ imported: 'Base', local: 'Alias' }],
            isTypeOnly: false,
            importType: 'static',
          },
          {
            moduleSpecifier: './other.js',
            isRelative: true,
            resolvedPath: 'other.ts',
            namedImports: ['Alias'],
            isTypeOnly: false,
            importType: 'dynamic',
          },
        ],
      }),
    ]);
    const info = buildImportIndex(skeletons).get('sub.ts');
    // 前提核实：键 Alias 确实在表里且指向 other.ts（否则本用例拦的是「查不到」而不是这道闸）
    expect(info?.aliasToTarget.get('Alias')).toBe('other.ts');
    expect(info?.renamedImportAliases.has('Alias')).toBe(true);
    const edges = resolveCalls([thisCall('sub.ts', 'Sub', 'm')], skeletons);
    expect(edges.map((e) => e.target)).not.toContain('other.ts::Alias.m');
    expect(edges).toEqual([
      {
        source: 'sub.ts::Sub.run',
        target: 'sub.ts::Sub.m',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R23 — `implements` 截断必须走**顶层且整词**判据（`extends implements_base` 不得被腰斩）', () => {
    // E03 变异体：`indexOfTopLevelKeyword(clause,'implements')` 退化成 `clause.indexOf('implements')`。
    // 父类名里含 `implements` 子串时（`implements_base` 是合法标识符），朴素 indexOf 会在
    // 词内命中并把父类名腰斩成空串 ⇒ 整条 MRO 条目消失（丢边）。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'x.ts',
        language: 'typescript',
        exports: [
          tsClass('Sub', 'class Sub extends implements_base', ['run']),
          tsClass('implements_base', 'class implements_base', ['m']),
        ],
      }),
    ]);
    const idx = buildClassMroIndex(skeletons);
    expect(idx.get('x.ts::Sub')).toEqual(['implements_base']);
    expect(resolveCalls([thisCall('x.ts', 'Sub', 'm')], skeletons)[0]?.target).toBe(
      'x.ts::implements_base.m',
    );
  });

  it('R24 — `=>` 的 `>` 不参与深度计算：箭头类型**之后**还有类型参数时不得提前归零', () => {
    // I04 变异体：撤掉 `input[i-1] !== '='` 例外。R19 的 (c) 用例杀不掉它 ——
    // 那里箭头是**最后一个**类型参数，提前归零发生在真正的顶层 extends 之前，两者结论相同。
    // 判别性形态必须让箭头**后面**还跟着一个带 `extends` 的类型参数：提前归零后，
    // 类型参数里的 `T extends Cfg` 会被当成顶层继承子句，父类名解析成 `Cfg> extends Base` 这种垃圾。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'g2.ts',
        language: 'typescript',
        exports: [
          tsClass('Fn2', 'class Fn2<F extends () => void, T extends Cfg> extends Base', ['run']),
          tsClass('Base', 'class Base', ['m']),
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('g2.ts::Fn2')).toEqual(['Base']);
    expect(resolveCalls([thisCall('g2.ts', 'Fn2', 'm')], skeletons)[0]?.target).toBe('g2.ts::Base.m');
  });

  it('R25 — `extends` 必须整词匹配：类名**内部**含该子串不得被当成继承子句', () => {
    // I07 / I08 变异体：分别撤掉左 / 右词边界校验。
    //   · `class my_extends extends Base`  —— 左边界（`_extends` 的 `_` 是词字符）
    //   · `class extends_helper extends Base` —— 右边界（`extends_` 的 `_` 是词字符）
    // 任一边界失守都会在**真正的**继承子句之前先命中类名里的子串，把父类名解析成垃圾。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'w.ts',
        language: 'typescript',
        exports: [
          tsClass('my_extends', 'class my_extends extends Base', ['run']),
          tsClass('extends_helper', 'class extends_helper extends Base', ['run']),
          tsClass('Base', 'class Base', ['m']),
        ],
      }),
    ]);
    const idx = buildClassMroIndex(skeletons);
    expect(idx.get('w.ts::my_extends')).toEqual(['Base']);
    expect(idx.get('w.ts::extends_helper')).toEqual(['Base']);
  });

  it('R26 — 括号深度必须下界钳制：多余的闭合尖括号不得把后续顶层判据整段废掉', () => {
    // I09 变异体：`depth = Math.max(0, depth - 1)` 改成 `depth - 1`。
    // 半成品 / 打错字的源码（`class Weird<A>> extends Base`）是真实采集面：不钳制时深度落到 -1，
    // 之后 `depth === 0` 判据恒不成立 ⇒ 顶层 extends 再也找不到 ⇒ 整条 MRO 条目消失。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'u.ts',
        language: 'typescript',
        exports: [
          tsClass('Weird', 'class Weird<A>> extends Base', ['run']),
          tsClass('Base', 'class Base', ['m']),
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('u.ts::Weird')).toEqual(['Base']);
  });

  it('R27 — `stripGenericParams` 取**先**出现的括号作切点（`Base<Item[]>` ⇒ `Base`）', () => {
    // S03 变异体：`Math.min(bracket, angle)` 改成 `Math.max`。
    // 同时含 `<` 与 `[` 的父类名（TS 里 `Base<Item[]>` 极常见）会被切在后一个括号上，
    // 留下 `Base<Item` 这种永远查不到的键。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 's.ts',
        language: 'typescript',
        exports: [
          tsClass('Sub', 'class Sub extends Base<Item[]>', ['run']),
          tsClass('Base', 'class Base<T>', ['m']),
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('s.ts::Sub')).toEqual(['Base']);
    expect(resolveCalls([thisCall('s.ts', 'Sub', 'm')], skeletons)[0]?.target).toBe('s.ts::Base.m');
  });

  it('R28 — MRO 至少上溯到**祖父**类（深度上限不得收到 1）', () => {
    // M02 变异体：`MAX_MRO_DEPTH` 从 8 收到 1。祖父类上的方法就查不到了（丢边）。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'd.ts',
        language: 'typescript',
        exports: [
          tsClass('C', 'class C extends B', ['run']),
          tsClass('B', 'class B extends A', ['other']),
          tsClass('A', 'class A', ['m']),
        ],
      }),
    ]);
    expect(resolveCalls([thisCall('d.ts', 'C', 'm')], skeletons)[0]?.target).toBe('d.ts::A.m');
  });

  it('R29 — MRO 深度上限是**硬**上限：超过 MAX_MRO_DEPTH 层的祖先不得被解析出来', () => {
    // M03 变异体：拆掉 `depth >= MAX_MRO_DEPTH` 这道 EC-4 兜底（只留 visited 去重）。
    // 上限是 fail-closed 的既定取舍：链路越长，"同名方法其实是各自重写"的概率越高，
    // 8 层之外一律不认，回落既有 medium 占位。这里 10 级链、方法只在最深一级 ⇒ 必须查不到。
    const chain = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'];
    const exports = chain.map((name, i) =>
      i < chain.length - 1
        ? tsClass(name, `class ${name} extends ${chain[i + 1]}`, i === 0 ? ['run'] : ['other'])
        : tsClass(name, `class ${name}`, ['m']),
    );
    const skeletons = mkSkeletonsMap([
      mkSkeleton({ filePath: 'deep.ts', language: 'typescript', exports }),
    ]);
    // 前提核实：链路本身建对了（否则本用例拦的是"链断了"而不是这道上限）
    expect(buildClassMroIndex(skeletons).get('deep.ts::C7')).toEqual(['C8']);
    const edges = resolveCalls([thisCall('deep.ts', 'C0', 'm')], skeletons);
    expect(edges.map((e) => e.target)).not.toContain('deep.ts::C9.m');
    expect(edges).toEqual([
      {
        source: 'deep.ts::C0.run',
        target: 'deep.ts::C0.m',
        relation: 'calls',
        confidence: 'medium',
        directional: true,
      },
    ]);
  });

  it('R30 — 顶层扫描的深度计数必须认 `[`：元组类型约束不得让后续 `extends` 提前变成顶层', () => {
    // I03 变异体：`indexOfTopLevelKeyword` 的深度计数去掉 `[`（`]` 仍减）。
    // 单独一个 `Item[]` 杀不掉它（少加一次、少减一次，抵消后结论相同）；判别性形态是
    // **类型参数里出现元组 / 索引类型，且其后还有一个带 `extends` 的类型参数**：
    // 少加多减会让深度在 `]` 处提前归零，把 `U extends Cfg` 当成顶层继承子句。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 't.ts',
        language: 'typescript',
        exports: [
          tsClass('Tup', 'class Tup<T extends [number], U extends Cfg> extends Base', ['run']),
          tsClass('Base', 'class Base', ['m']),
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('t.ts::Tup')).toEqual(['Base']);
    expect(resolveCalls([thisCall('t.ts', 'Tup', 'm')], skeletons)[0]?.target).toBe('t.ts::Base.m');
  });

  it('R31 — `bracketAwareSplit` 的深度计数必须认 `<`：泛型实参里的逗号不是父类分隔符', () => {
    // I01b 变异体：`bracketAwareSplit` 去掉 `<` 的深度累加（Python 侧只需要 `[`，
    // 但 P5 之后同一个函数也吃 TS 的 `extends Base<K, V>`）。
    // 不认 `<` 时 `Base<K, V>` 会被拆成 `Base` + `V>` 两个"父类"，凭空多一个垃圾条目。
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'gm.ts',
        language: 'typescript',
        exports: [
          tsClass('Sub', 'class Sub extends Base<K, V>', ['run']),
          tsClass('Base', 'class Base<A, B>', ['m']),
        ],
      }),
    ]);
    expect(buildClassMroIndex(skeletons).get('gm.ts::Sub')).toEqual(['Base']);
  });

  it('R22 — 非裸标识符父类（`mixin(Base)` / `Base.Nested` / 类表达式）经索引 miss 自然落空，无假边', () => {
    const skeletons = mkSkeletonsMap([
      mkSkeleton({
        filePath: 'm.ts',
        language: 'typescript',
        exports: [
          tsClass('A', 'class A extends mixin(Base)', ['run']),
          tsClass('B', 'class B extends Base.Nested', ['run']),
          tsClass('C', 'class C extends (class {})', ['run']),
          tsClass('Base', 'class Base', ['m']),
        ],
      }),
    ]);
    for (const host of ['A', 'B', 'C']) {
      const edges = resolveCalls([thisCall('m.ts', host, 'm')], skeletons);
      // 一律落既有 medium 占位，绝不指向 `m.ts::Base.m`
      expect(edges).toEqual([
        {
          source: `m.ts::${host}.run`,
          target: `m.ts::${host}.m`,
          relation: 'calls',
          confidence: 'medium',
          directional: true,
        },
      ]);
    }
  });
});
