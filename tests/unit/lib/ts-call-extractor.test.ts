/**
 * Feature 150 — TS / TSX call site extractor 单元测试
 *
 * 覆盖 spec FR-005 + plan §Tree-sitter query 关键模式：
 *   - call_expression（function / method / arrow IIFE / dynamic import / eval）
 *   - new_expression（constructor）
 *   - decorator 内 call_expression（按 method 处理）
 *   - parse-error / 空目录 / unresolved 边界
 *   - .tsx 文件（本仓 tree-sitter-typescript.wasm 不含 tsx 子 grammar，按 spec
 *     edge case "语法错误源文件" 路径处理：parse-error + warnings + skip）
 *
 * 设计：每 case 在独立 tmpdir 写 inline 源码，避免依赖 baseline workspace。
 */

import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  extractTsCallSites,
  _classifyCallExpressionCallee,
  _classifyNewExpressionCallee,
  _resolveCaller,
  _processOneTsFile,
  _walkAst,
  _nodeLine,
} from '../../../scripts/lib/ts-call-extractor.mjs';
import { loadTreeSitterGrammar, createWarningsArray } from '../../../scripts/lib/extractor-helpers.mjs';

// ── 临时目录管理 ──

const tmpDirsToClean: string[] = [];

afterEach(() => {
  for (const dir of tmpDirsToClean) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tmpDirsToClean.length = 0;
});

function makeTempDir(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  tmpDirsToClean.push(tmp);
  return tmp;
}

interface TruthCall {
  caller: string;
  callee: string;
  file: string;
  line: number;
  kind: 'method' | 'function' | 'arrow' | 'constructor' | 'unresolved';
}

interface ExtractResult {
  language: 'ts';
  truthCalls: TruthCall[];
  warnings: Array<{ file: string; line?: number; code: string; message?: string }>;
  baseline?: { repo?: string; commit?: string; scope: string; generatedAt: string; extractorVersion: string };
}

function findCallByCallee(result: ExtractResult, callee: string): TruthCall | undefined {
  return result.truthCalls.find((c) => c.callee === callee);
}

// ── 1. basic call: function call ──

describe('extractTsCallSites — basic function call', () => {
  it('抽取 identifier callee → kind=function', async () => {
    const tmp = makeTempDir('ts-extract-basic');
    fs.writeFileSync(
      path.join(tmp, 'a.ts'),
      [
        'function foo() { return 42; }',
        'function bar() { foo(); }',
        'const v = bar();',
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;

    expect(result.language).toBe('ts');
    expect(Array.isArray(result.truthCalls)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);

    const fooCall = findCallByCallee(result, 'foo');
    expect(fooCall).toBeDefined();
    expect(fooCall?.kind).toBe('function');
    // line 是 1-based 行号（tree-sitter row 是 0-based，extractor 应统一返回 1-based）
    expect(fooCall?.line).toBe(2);

    const barCall = findCallByCallee(result, 'bar');
    expect(barCall).toBeDefined();
    expect(barCall?.kind).toBe('function');
  });
});

// ── 2. method call: obj.method() / arr.push() ──

describe('extractTsCallSites — method call', () => {
  it('抽取 member_expression callee → kind=method', async () => {
    const tmp = makeTempDir('ts-extract-method');
    fs.writeFileSync(
      path.join(tmp, 'b.ts'),
      [
        'const arr = [1, 2, 3];',
        'arr.push(4);',
        'const obj = { f() {} };',
        'obj.f();',
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;

    const pushCall = findCallByCallee(result, 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall?.kind).toBe('method');
    expect(pushCall?.line).toBe(2);

    const fCall = findCallByCallee(result, 'f');
    expect(fCall).toBeDefined();
    expect(fCall?.kind).toBe('method');
  });

  it('支持 super.method() / this.method() 也算 method', async () => {
    const tmp = makeTempDir('ts-extract-super');
    fs.writeFileSync(
      path.join(tmp, 'c.ts'),
      [
        'class A { greet() { return "hi"; } }',
        'class B extends A {',
        '  override greet() { super.greet(); this.foo(); return "yo"; }',
        '  foo() {}',
        '}',
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;

    const greetCalls = result.truthCalls.filter((c) => c.callee === 'greet');
    // 至少有 super.greet() 一次（this.greet 没出现，只有 super.greet）
    expect(greetCalls.length).toBeGreaterThanOrEqual(1);
    expect(greetCalls.every((c) => c.kind === 'method')).toBe(true);

    const fooMethodCall = findCallByCallee(result, 'foo');
    expect(fooMethodCall?.kind).toBe('method');
  });
});

// ── 3. constructor: new ClassName() / new Map<T>() ──

describe('extractTsCallSites — constructor (new_expression)', () => {
  it('抽取 new ClassName() → kind=constructor，含 generic type', async () => {
    const tmp = makeTempDir('ts-extract-ctor');
    fs.writeFileSync(
      path.join(tmp, 'd.ts'),
      [
        'class Foo { constructor() {} }',
        'const f = new Foo();',
        'const m = new Map<string, number>();',
        'const s = new Set();',
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;

    const fooCtor = findCallByCallee(result, 'Foo');
    expect(fooCtor).toBeDefined();
    expect(fooCtor?.kind).toBe('constructor');

    const mapCtor = findCallByCallee(result, 'Map');
    expect(mapCtor).toBeDefined();
    expect(mapCtor?.kind).toBe('constructor');

    const setCtor = findCallByCallee(result, 'Set');
    expect(setCtor).toBeDefined();
    expect(setCtor?.kind).toBe('constructor');
  });
});

// ── 4. arrow function call: IIFE / inline arrow callback ──

describe('extractTsCallSites — arrow function (IIFE)', () => {
  it('IIFE (() => 1)() callee 是 arrow_function → kind=arrow', async () => {
    const tmp = makeTempDir('ts-extract-arrow');
    fs.writeFileSync(
      path.join(tmp, 'e.ts'),
      [
        'const r = (() => 42)();',
        'const arr = [1, 2, 3];',
        'arr.map((x) => x * 2);',
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;

    // IIFE：callee 是 arrow_function（被 parenthesized_expression 包裹）→ kind=arrow
    const arrowCall = result.truthCalls.find((c) => c.kind === 'arrow');
    expect(arrowCall).toBeDefined();
    // arrow IIFE callee 名按 plan §kind 映射：通常用 '<arrow>' 或类似 placeholder
    // 严格行为由实现决定，但至少 kind=arrow 必须出现一次
  });
});

// ── 5. unresolved fallback: eval / dynamic import / new Function() ──

describe('extractTsCallSites — unresolved fallback', () => {
  it('eval(...) / 动态 import(...) / new Function() → kind=unresolved + warnings', async () => {
    const tmp = makeTempDir('ts-extract-unresolved');
    fs.writeFileSync(
      path.join(tmp, 'f.ts'),
      [
        "eval('1');",
        "const m = import('./mod');",
        "const F = new Function('x', 'return x');",
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;

    // eval 视为 unresolved
    const evalCall = result.truthCalls.find((c) => c.callee === 'eval');
    expect(evalCall).toBeDefined();
    expect(evalCall?.kind).toBe('unresolved');

    // 动态 import('./mod') callee 是 import token → unresolved
    const importCall = result.truthCalls.find((c) => c.kind === 'unresolved' && c.callee.toLowerCase().includes('import'));
    expect(importCall).toBeDefined();

    // new Function(...) callee 是 Function（构造）→ 仍按 constructor 抽出，但 callee=Function
    // 视实现可标 unresolved 也可标 constructor（按 spec edge case "Function 构造器"
    // 应为 unresolved-dynamic）
    const fnCtor = result.truthCalls.find((c) => c.callee === 'Function');
    expect(fnCtor).toBeDefined();
    expect(fnCtor?.kind).toBe('unresolved');

    // warnings 数组应记录 unresolved-dynamic
    const dynamicWarn = result.warnings.find(
      (w) => w.code === 'unresolved-dynamic',
    );
    expect(dynamicWarn).toBeDefined();
  });
});

// ── 6. parse-error edge case ──

describe('extractTsCallSites — parse-error skip', () => {
  it('语法错文件 → skip + warnings.code=parse-error；其它文件正常抽取', async () => {
    const tmp = makeTempDir('ts-extract-parse-err');
    // 故意造一个无法 parse 的源（注意：tree-sitter 容错较强，多数语法错仍能 parse 出 ERROR
    // 节点；这里写一个含 ERROR 的混合，extractor 应在 parse 后检测 hasError 标志）
    fs.writeFileSync(
      path.join(tmp, 'broken.ts'),
      'const x = ; ; ; >>> never close <<< ;;',
    );
    fs.writeFileSync(
      path.join(tmp, 'good.ts'),
      'function ok() {}\nok();',
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;

    // good.ts 仍正常抽取
    const okCall = findCallByCallee(result, 'ok');
    expect(okCall).toBeDefined();

    // broken.ts 触发 parse-error-partial warning（Codex CRITICAL #1+#2 修订：节点级 salvage）
    const parseErr = result.warnings.find((w) => /parse-error/.test(w.code));
    expect(parseErr).toBeDefined();
    expect(parseErr?.file).toMatch(/broken\.ts$/);
  });

  it('.tsx 文件（本仓 wasm 不支持 JSX）走 parse-error-partial 路径，但能 salvage 非 JSX 子树（Codex CRITICAL #1+#2）', async () => {
    const tmp = makeTempDir('ts-extract-tsx');
    // .tsx 含 JSX，本仓 tree-sitter-typescript.wasm 不含 tsx 子 grammar，
    // 但 import / function declaration 等非 JSX 子树仍可解析（节点级 salvage）
    fs.writeFileSync(
      path.join(tmp, 'comp.tsx'),
      [
        "import React from 'react';",
        'function App() { return <div onClick={() => alert("hi")}>hi</div>; }',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(tmp, 'plain.ts'), 'function f() {}\nf();');

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;
    // plain.ts 仍能抽
    const fCall = findCallByCallee(result, 'f');
    expect(fCall).toBeDefined();
    // .tsx 触发 partial warning（ERROR 子树 skip 但其它正常）
    const tsxWarn = result.warnings.find((w) => w.file.endsWith('comp.tsx'));
    expect(tsxWarn).toBeDefined();
    // 修订后 code 为 parse-error-partial（节点级 salvage 而非整文件 skip）
    expect(tsxWarn?.code).toMatch(/^parse-error/);
  });
});

// ── 7. decorator 内 call_expression ──

describe('extractTsCallSites — decorator metadata', () => {
  it('@Decorator() 内 call_expression 抽取 → kind=method（按 plan 表）', async () => {
    const tmp = makeTempDir('ts-extract-deco');
    fs.writeFileSync(
      path.join(tmp, 'g.ts'),
      [
        'function Log() { return (t: object) => t; }',
        '@Log()',
        'class Foo {}',
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;
    const logCall = findCallByCallee(result, 'Log');
    expect(logCall).toBeDefined();
    expect(logCall?.kind).toBe('method');
  });
});

// ── 8. 空目录 / 无 .ts 文件 ──

describe('extractTsCallSites — empty source root', () => {
  it('空目录返回空 truthCalls + 空 warnings + 不崩溃', async () => {
    const tmp = makeTempDir('ts-extract-empty');
    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;
    expect(result.truthCalls).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('不存在的 sourceRoot 抛错', async () => {
    await expect(
      extractTsCallSites({ sourceRoot: '/non-existent-12345-path' }),
    ).rejects.toThrow(/不存在|sourceRoot/);
  });

  it('缺 sourceRoot 参数抛错', async () => {
    await expect(extractTsCallSites({} as { sourceRoot: string })).rejects.toThrow(
      /sourceRoot/,
    );
  });

  it('options 非对象 (null) 抛错', async () => {
    await expect(
      extractTsCallSites(null as unknown as { sourceRoot: string }),
    ).rejects.toThrow(/options/);
  });

});

describe('_nodeLine — direct unit', () => {
  it('node 缺 startPosition → 行号 1', () => {
    expect(_nodeLine({})).toBe(1);
  });
  it('node = null/undefined → 行号 1', () => {
    expect(_nodeLine(null)).toBe(1);
    expect(_nodeLine(undefined)).toBe(1);
  });
  it('正常 startPosition.row=5 → 行号 6 (1-based)', () => {
    expect(_nodeLine({ startPosition: { row: 5 } })).toBe(6);
  });
});

describe('_classifyCallExpressionCallee — defensive paths', () => {
  it('member_expression 无 childForFieldName → 走 namedChildren fallback', () => {
    const fake = {
      type: 'member_expression',
      // childForFieldName 不是 function（保护分支）
      childForFieldName: null,
      namedChildren: [
        { type: 'identifier', text: 'a' },
        { type: 'property_identifier', text: 'b' },
      ],
      text: 'a.b',
    };
    expect(_classifyCallExpressionCallee(fake)).toEqual({ name: 'b', kind: 'method' });
  });

  it('member_expression namedChildren 非数组 → 走 text fallback', () => {
    const fake = {
      type: 'member_expression',
      childForFieldName: null,
      namedChildren: undefined, // 非数组分支
      text: 'a.b',
    };
    expect(_classifyCallExpressionCallee(fake)).toEqual({ name: 'a.b', kind: 'method' });
  });

  it('member_expression text 非 string → 走 <member> 兜底', () => {
    const fake = {
      type: 'member_expression',
      childForFieldName: null,
      namedChildren: [],
      // text 非 string 分支
      text: undefined,
    };
    expect(_classifyCallExpressionCallee(fake)).toEqual({ name: '<member>', kind: 'method' });
  });

  it('parenthesized_expression namedChildren 非数组 → 默认 <arrow>', () => {
    const fake = { type: 'parenthesized_expression', namedChildren: null };
    expect(_classifyCallExpressionCallee(fake)).toEqual({
      name: '<arrow>',
      kind: 'arrow',
    });
  });
});

describe('_walkAst — direct unit (fake AST)', () => {
  it('decorator 父节点 + identifier callee → kind=method 覆盖', () => {
    const decorator = { type: 'decorator' };
    const idNode = { type: 'identifier', text: 'Log' };
    const callExpr = {
      type: 'call_expression',
      namedChildren: [idNode],
      startPosition: { row: 0 },
      parent: decorator,
    };
    const root = {
      type: 'program',
      namedChildren: [decorator],
      parent: null,
    };
    decorator.namedChildren = [callExpr];
    decorator.parent = root;
    callExpr.parent = decorator;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = { append: vi => null }; // 未用
    // 用 createWarningsArray 真实实例
    const realWarn = createWarningsArray();
    _walkAst(root, 'x.ts', truthBuf, realWarn);
    expect(truthBuf.items).toHaveLength(1);
    expect(truthBuf.items[0]).toMatchObject({ callee: 'Log', kind: 'method' });
  });

  it('call_expression 无 namedChildren → callee=<unknown>', () => {
    const callExpr = {
      type: 'call_expression',
      namedChildren: undefined, // 防御分支
      startPosition: { row: 2 },
      parent: null,
    };
    const root = { type: 'program', namedChildren: [callExpr], parent: null };
    callExpr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkAst(root, 'x.ts', truthBuf, warnings);
    expect(truthBuf.items[0].kind).toBe('unresolved');
    expect(warnings.items[0].code).toBe('unresolved-dynamic');
  });

  it('new_expression 无 named identifier → 取 namedChildren[0] fallback', () => {
    // 模拟 grammar 边界：所有 children 都是 type_arguments 这类非 callee
    const typeArg = { type: 'type_arguments', text: '<T>' };
    const newExpr = {
      type: 'new_expression',
      namedChildren: [typeArg],
      startPosition: { row: 0 },
      parent: null,
    };
    const root = { type: 'program', namedChildren: [newExpr], parent: null };
    newExpr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkAst(root, 'x.ts', truthBuf, warnings);
    expect(truthBuf.items[0].callee).toBe('<T>');
    expect(truthBuf.items[0].kind).toBe('constructor');
  });

  it('new_expression 无 namedChildren → kind=unresolved', () => {
    const newExpr = {
      type: 'new_expression',
      namedChildren: undefined,
      startPosition: { row: 0 },
      parent: null,
    };
    const root = { type: 'program', namedChildren: [newExpr], parent: null };
    newExpr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkAst(root, 'x.ts', truthBuf, warnings);
    expect(truthBuf.items[0].kind).toBe('unresolved');
  });

  it('node 无 namedChildren → 不入栈子节点', () => {
    const root = {
      type: 'program',
      namedChildren: undefined,
      parent: null,
    };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkAst(root, 'x.ts', truthBuf, warnings);
    expect(truthBuf.items).toEqual([]);
  });
});

describe('_processOneTsFile — read / parse error catch', () => {
  it('文件不存在 → fs.readFileSync 抛 ENOENT → warnings 记录 parse-error', async () => {
    const tmp = makeTempDir('ts-process-readfail');
    const { parser } = await loadTreeSitterGrammar('ts');
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();

    _processOneTsFile(
      parser,
      path.join(tmp, '__no_such_file__.ts'),
      '__no_such_file__.ts',
      truthBuf,
      warnings,
    );

    expect(truthBuf.items).toEqual([]);
    expect(warnings.items.length).toBe(1);
    expect(warnings.items[0].code).toBe('parse-error');
    expect(warnings.items[0].message).toMatch(/ENOENT|extract-error/);
  });

  it('parser.parse throw → warnings 记录 parse-error', async () => {
    const tmp = makeTempDir('ts-process-parsefail');
    const filePath = path.join(tmp, 'a.ts');
    fs.writeFileSync(filePath, 'function a() {}');

    // 用 mock parser 制造 parse() 抛错
    const fakeParser = {
      parse: () => {
        throw new Error('mock-parse-throw');
      },
    };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _processOneTsFile(fakeParser, filePath, 'a.ts', truthBuf, warnings);

    expect(truthBuf.items).toEqual([]);
    expect(warnings.items.length).toBe(1);
    expect(warnings.items[0].code).toBe('parse-error');
    expect(warnings.items[0].message).toContain('mock-parse-throw');
  });

  it('walkAst throw（rootNode getter 抛错）→ warnings 记录 parse-error', async () => {
    const tmp = makeTempDir('ts-process-walkfail');
    const filePath = path.join(tmp, 'a.ts');
    fs.writeFileSync(filePath, 'function a() {}');

    const fakeParser = {
      parse: () => ({
        get rootNode() {
          throw new Error('mock-walk-throw');
        },
      }),
    };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _processOneTsFile(fakeParser, filePath, 'a.ts', truthBuf, warnings);
    expect(warnings.items[0].code).toBe('parse-error');
    expect(warnings.items[0].message).toContain('mock-walk-throw');
  });
});

// ── 9. metadata header（FR-014）──

describe('extractTsCallSites — metadata header', () => {
  it('options.baseline 存在时把 baseline 字段合入返回值', async () => {
    const tmp = makeTempDir('ts-extract-meta');
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'function x() {}\nx();');

    const result = (await extractTsCallSites({
      sourceRoot: tmp,
      baseline: {
        repo: 'honojs/hono',
        commit: 'abc123',
        scope: 'src',
      },
    })) as ExtractResult;

    expect(result.baseline).toBeDefined();
    expect(result.baseline?.repo).toBe('honojs/hono');
    expect(result.baseline?.commit).toBe('abc123');
    expect(result.baseline?.scope).toBe('src');
    expect(result.baseline?.extractorVersion).toBeTruthy();
    expect(result.baseline?.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('未传 baseline 时 baseline 字段缺省（仅含 truthCalls / warnings / language）', async () => {
    const tmp = makeTempDir('ts-extract-meta-default');
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'function x() {}');

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;
    expect(result.language).toBe('ts');
    // baseline 可缺失或可省略
    if (result.baseline !== undefined) {
      // 实现允许总是返回 baseline metadata，这种情况 scope 可为默认值
      expect(typeof result.baseline.extractorVersion).toBe('string');
    }
  });
});

// ── 10. caller 标识 ──

describe('extractTsCallSites — caller identification', () => {
  it('调用点的 caller 含文件路径或 location，不为空', async () => {
    const tmp = makeTempDir('ts-extract-caller');
    fs.writeFileSync(
      path.join(tmp, 'h.ts'),
      [
        'function alpha() { beta(); }',
        'function beta() {}',
        'alpha();',
      ].join('\n'),
    );

    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;
    for (const c of result.truthCalls) {
      expect(typeof c.caller).toBe('string');
      expect(c.caller.length).toBeGreaterThan(0);
      expect(typeof c.file).toBe('string');
      expect(c.file.endsWith('.ts')).toBe(true);
      expect(typeof c.line).toBe('number');
      expect(c.line).toBeGreaterThan(0);
    }
  });

  it('类方法内调用 → caller 含 ClassName.methodName 形态', async () => {
    const tmp = makeTempDir('ts-extract-caller-class');
    fs.writeFileSync(
      path.join(tmp, 'i.ts'),
      [
        'class Service {',
        '  run() { this.helper(); }',
        '  helper() { return 1; }',
        '}',
      ].join('\n'),
    );
    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;
    const helperCall = findCallByCallee(result, 'helper');
    expect(helperCall?.caller).toContain('Service.run');
  });

  it('arrow function 赋给 const → caller 取 declarator 名', async () => {
    const tmp = makeTempDir('ts-extract-caller-arrow');
    fs.writeFileSync(
      path.join(tmp, 'j.ts'),
      ['const top = () => { inner(); };', 'function inner() {}'].join('\n'),
    );
    const result = (await extractTsCallSites({ sourceRoot: tmp })) as ExtractResult;
    const innerCall = findCallByCallee(result, 'inner');
    expect(innerCall?.caller).toContain('top');
  });
});

// ── 11. 内部分类函数直接覆盖（fallback / defensive 路径）──

describe('_classifyCallExpressionCallee — direct unit', () => {
  it('null callee → unresolved + missing-callee', () => {
    expect(_classifyCallExpressionCallee(null)).toEqual({
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-callee',
    });
  });

  it('未知 type fallback → unresolved + unknown-callee-type', () => {
    expect(
      _classifyCallExpressionCallee({ type: 'mystery_node', text: 'mystery' }),
    ).toEqual({ name: 'mystery', kind: 'unresolved', dynamicReason: 'unknown-callee-type' });
  });

  it('未知 type 且 text 缺失 → name=<expr>', () => {
    expect(
      _classifyCallExpressionCallee({ type: 'mystery_node' }),
    ).toEqual({ name: '<expr>', kind: 'unresolved', dynamicReason: 'unknown-callee-type' });
  });

  it('member_expression with childForFieldName missing → 走 namedChildren fallback', () => {
    const fakeMember = {
      type: 'member_expression',
      childForFieldName: () => null,
      namedChildren: [
        { type: 'identifier', text: 'obj' },
        { type: 'property_identifier', text: 'method' },
      ],
      text: 'obj.method',
    };
    expect(_classifyCallExpressionCallee(fakeMember)).toEqual({
      name: 'method',
      kind: 'method',
    });
  });

  it('member_expression namedChildren 全空 → fallback 用 node.text', () => {
    const fakeMember = {
      type: 'member_expression',
      childForFieldName: () => null,
      namedChildren: [],
      text: 'obj.fallback',
    };
    expect(_classifyCallExpressionCallee(fakeMember)).toEqual({
      name: 'obj.fallback',
      kind: 'method',
    });
  });

  it('parenthesized_expression with empty children → 走 arrow fallback', () => {
    const fake = {
      type: 'parenthesized_expression',
      namedChildren: [],
    };
    expect(_classifyCallExpressionCallee(fake)).toEqual({ name: '<arrow>', kind: 'arrow' });
  });

  it('parenthesized_expression 包含非 arrow inner → 递归分类内层', () => {
    const inner = { type: 'identifier', text: 'foo' };
    const fake = { type: 'parenthesized_expression', namedChildren: [inner] };
    expect(_classifyCallExpressionCallee(fake)).toEqual({ name: 'foo', kind: 'function' });
  });

  it('function_expression 直接 callee → kind=arrow', () => {
    expect(
      _classifyCallExpressionCallee({ type: 'function_expression' }),
    ).toEqual({ name: '<arrow>', kind: 'arrow' });
  });

  it('chained call_expression → unresolved + chained-callee', () => {
    expect(
      _classifyCallExpressionCallee({ type: 'call_expression', text: 'a()()' }),
    ).toEqual({
      name: '<chained-call>',
      kind: 'unresolved',
      dynamicReason: 'chained-callee',
    });
  });
});

describe('_classifyNewExpressionCallee — direct unit', () => {
  it('null → unresolved + missing-ctor', () => {
    expect(_classifyNewExpressionCallee(null)).toEqual({
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-ctor',
    });
  });

  it('node 缺 text → name=<expr>', () => {
    expect(_classifyNewExpressionCallee({ type: 'identifier' })).toEqual({
      name: '<expr>',
      kind: 'constructor',
    });
  });

  it('Function 构造 → unresolved', () => {
    expect(
      _classifyNewExpressionCallee({ type: 'identifier', text: 'Function' }),
    ).toEqual({
      name: 'Function',
      kind: 'unresolved',
      dynamicReason: 'new-Function-ctor',
    });
  });

  it('普通 type_identifier → constructor', () => {
    expect(
      _classifyNewExpressionCallee({ type: 'type_identifier', text: 'Foo' }),
    ).toEqual({ name: 'Foo', kind: 'constructor' });
  });
});

describe('_resolveCaller — direct unit', () => {
  it('node.parent=null → <top-level>', () => {
    const node = { parent: null };
    expect(_resolveCaller(node, 'a/b.ts')).toBe('a/b.ts:<top-level>');
  });

  it('在 method_definition 内 → <file>:methodName', () => {
    const methodDef = {
      type: 'method_definition',
      namedChildren: [{ type: 'property_identifier', text: 'doWork' }],
      parent: null,
    };
    const callNode = { parent: methodDef };
    expect(_resolveCaller(callNode, 'svc.ts')).toBe('svc.ts:doWork');
  });

  it('class_declaration 不带 type_identifier → <anon-class>.method (Codex CRITICAL #3 修订: 嵌套 scope 立即返回)', () => {
    const methodDef = {
      type: 'method_definition',
      namedChildren: [{ type: 'property_identifier', text: 'm' }],
    };
    const classDecl = {
      type: 'class_declaration',
      namedChildren: [], // 没有 type_identifier
      parent: null,
    };
    methodDef.parent = classDecl;
    const callNode = { parent: methodDef };
    // 修订后：method_definition 立即返回（不再走 <top-level>），匿名 class 用 <anon-class>
    expect(_resolveCaller(callNode, 'x.ts')).toBe('x.ts:<anon-class>.m');
  });

  it('class + method → <file>:Class.method', () => {
    const methodDef = {
      type: 'method_definition',
      namedChildren: [{ type: 'property_identifier', text: 'm' }],
    };
    const classDecl = {
      type: 'class_declaration',
      namedChildren: [{ type: 'type_identifier', text: 'C' }],
      parent: null,
    };
    methodDef.parent = classDecl;
    const callNode = { parent: methodDef };
    expect(_resolveCaller(callNode, 'x.ts')).toBe('x.ts:C.m');
  });

  it('function_declaration without identifier → <anon-fn> (Codex CRITICAL #3 修订)', () => {
    const fnDecl = {
      type: 'function_declaration',
      namedChildren: [], // 缺 identifier (例如 default export anonymous)
      parent: null,
    };
    const callNode = { parent: fnDecl };
    // 修订后：function_declaration 立即返回（不再继续向外走 <top-level>），匿名用 <anon-fn>
    expect(_resolveCaller(callNode, 'x.ts')).toBe('x.ts:<anon-fn>');
  });

  it('arrow_function 父非 variable_declarator → <arrow:line> (Codex CRITICAL #3 修订: 嵌套 arrow 优先归属)', () => {
    const arrow = {
      type: 'arrow_function',
      parent: { type: 'arguments' }, // arrow 作为 callback，不在 declarator 下
      startPosition: { row: 0 },
    };
    const callNode = { parent: arrow };
    // 修订后：arrow scope 立即返回（不再走 <top-level>，避免 callback 内调用错算到外层）
    expect(_resolveCaller(callNode, 'x.ts')).toBe('x.ts:<arrow:1:0>');
  });

  it('arrow_function 父为 declarator 但缺 identifier → <arrow:line> (Codex CRITICAL #3 修订)', () => {
    const declarator = {
      type: 'variable_declarator',
      namedChildren: [], // 缺 identifier，theory only
      parent: null,
    };
    const arrow = {
      type: 'arrow_function',
      parent: declarator,
      startPosition: { row: 0 },
    };
    const callNode = { parent: arrow };
    expect(_resolveCaller(callNode, 'x.ts')).toBe('x.ts:<arrow:1:0>');
  });
});
