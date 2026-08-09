/**
 * Feature 152 T-011 — TypeScriptMapper.extractCallSites 单测
 *
 * 覆盖 20 个场景（T-011 tasks.md 表格 V3 修订版）：
 *  1.  foo()           → free
 *  2.  this.method()   → member（无 qualifier）
 *  3.  Class.method()  → member + qualifier
 *  4.  mod.fn()        → cross-module + qualifier
 *  5.  obj?.method()   → cross-module（optional chain，小写 obj）
 *  6.  箭头函数内 foo() → free，callerContext=箭头函数名
 *  7.  类方法内 baz()   → free，callerContext="Foo.bar"
 *  8.  C-4 修复：嵌套 callback 最近 scope 原则
 *  9.  import('./x')    → unresolved，calleeName="import"
 * 10.  C-3 修复：import().then(cb) 只含 1 条 callSite
 * 11.  super.method()   → super
 * 12.  super() 构造器自调用 → super，calleeName="super"
 * 13.  @Decorator() 带参 → decorator
 * 14.  W-3 修复：带参 decorator + 内层不双计数
 * 15.  bare @Decorator   → 不产出（长度 0）
 * 16.  new Foo()         → free，calleeName="Foo"
 * 17.  W-2 修复：new Function('code') → unresolved，calleeName="Function"
 * 18.  tagged template   → free（identifier tag）
 * 19.  eval('code')      → unresolved，calleeName="eval"
 * 20.  .tsx JSX fixture  → JSX 元素不产出 callSite（EC-9）
 */
import { describe, expect, it, beforeAll } from 'vitest';
import Parser from 'web-tree-sitter';

import { TreeSitterAnalyzer } from '../../src/core/tree-sitter-analyzer.js';
import { GrammarManager } from '../../src/core/grammar-manager.js';
import { TypeScriptMapper } from '../../src/core/query-mappers/typescript-mapper.js';
import { buildReceiverTypeEnv } from '../../src/core/query-mappers/typescript-receiver-env.js';
import type { CallSite } from '../../src/models/call-site.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// ============================================================
// 测试辅助函数
// ============================================================

let analyzer: TreeSitterAnalyzer;

beforeAll(() => {
  analyzer = TreeSitterAnalyzer.getInstance();
});

/**
 * 将 TypeScript 源码写入临时文件，通过 TreeSitterAnalyzer 分析后返回 callSites。
 * 通过 analyzer.analyze 调用，确保 TypeScriptMapper.extractCallSites 被正确调用。
 */
async function analyzeTs(code: string, ext = '.ts'): Promise<CallSite[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-ts-cs-'));
  const filePath = path.join(tmpDir, `snippet${ext}`);
  fs.writeFileSync(filePath, code, 'utf-8');
  try {
    const skeleton = await analyzer.analyze(filePath, 'typescript', {
      extractCallSites: true,
    });
    return skeleton.callSites ?? [];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * F260 — 同上，但返回整个 CodeSkeleton（imports 断言需要）。
 *
 * 走 `TreeSitterAnalyzer.analyze()` 而不是 `collectTsJsCodeSkeletons`：按 `ts-js-adapter.ts`
 * 的 EC-11 隔离，生产路径下 imports/exports 恒来自 ts-morph 主路径、tree-sitter 侧的 imports
 * 会被丢弃，用采集器驱动就完全测不到 M13 点名的「tree-sitter 静态 import 降级路径」。
 */
async function analyzeTsSkeleton(code: string, ext = '.ts'): Promise<CodeSkeleton> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-ts-imp-'));
  const filePath = path.join(tmpDir, `snippet${ext}`);
  fs.writeFileSync(filePath, code, 'utf-8');
  try {
    return await analyzer.analyze(filePath, 'typescript', { extractCallSites: true });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// 单测用例（20 个）
// ============================================================

describe('TypeScriptMapper.extractCallSites — Feature 152 T-011', () => {

  // 用例 1：顶层 identifier 调用 → free
  it('case 1 — foo() 顶层 identifier 调用产出 free', async () => {
    const code = `
function main() {
  foo();
}
function foo() {}
`;
    const callSites = await analyzeTs(code);
    const fooCall = callSites.find((c) => c.calleeName === 'foo' && c.calleeKind === 'free');
    expect(fooCall).toBeDefined();
    expect(fooCall?.callerContext).toBe('main');
  });

  // 用例 2：this.method() → member（无 qualifier）
  it('case 2 — this.method() 产出 member，无 qualifier', async () => {
    const code = `
class Foo {
  bar() {
    this.baz();
  }
  baz() {}
}
`;
    const callSites = await analyzeTs(code);
    const memberCall = callSites.find((c) => c.calleeName === 'baz' && c.calleeKind === 'member');
    expect(memberCall).toBeDefined();
    expect(memberCall?.calleeQualifier).toBeUndefined();
    expect(memberCall?.callerContext).toBe('Foo.bar');
  });

  // 用例 3：Class.method()（首字母大写）→ member + qualifier
  it('case 3 — Class.method() 首字母大写产出 member + qualifier', async () => {
    const code = `
function main() {
  MyClass.staticMethod();
}
`;
    const callSites = await analyzeTs(code);
    const classCall = callSites.find(
      (c) => c.calleeName === 'staticMethod' && c.calleeKind === 'member',
    );
    expect(classCall).toBeDefined();
    expect(classCall?.calleeQualifier).toBe('MyClass');
  });

  // 用例 4：mod.fn()（首字母小写）→ cross-module + qualifier
  it('case 4 — mod.fn() 首字母小写产出 cross-module + qualifier', async () => {
    const code = `
function run() {
  utils.helper();
}
`;
    const callSites = await analyzeTs(code);
    const crossCall = callSites.find(
      (c) => c.calleeName === 'helper' && c.calleeKind === 'cross-module',
    );
    expect(crossCall).toBeDefined();
    expect(crossCall?.calleeQualifier).toBe('utils');
  });

  // 用例 5：obj?.method() optional chain（小写 obj）→ cross-module
  it('case 5 — obj?.method() optional chain 产出 cross-module', async () => {
    const code = `
function test(obj: any) {
  obj?.doSomething();
}
`;
    const callSites = await analyzeTs(code);
    // optional chain 会产出 cross-module（小写 obj）
    const optCall = callSites.find(
      (c) => c.calleeName === 'doSomething' && c.calleeKind === 'cross-module',
    );
    expect(optCall).toBeDefined();
    expect(optCall?.calleeQualifier).toBe('obj');
  });

  // 用例 6：箭头函数内调用，callerContext = 箭头函数名
  it('case 6 — 箭头函数内 foo() 的 callerContext 为箭头函数名', async () => {
    const code = `
const handler = () => {
  foo();
};
function foo() {}
`;
    const callSites = await analyzeTs(code);
    const fooCall = callSites.find((c) => c.calleeName === 'foo' && c.calleeKind === 'free');
    expect(fooCall).toBeDefined();
    expect(fooCall?.callerContext).toBe('handler');
  });

  // 用例 7：class 方法内调用，callerContext = "ClassName.methodName"
  it('case 7 — class Foo { bar() { baz() } } 内 baz() 的 callerContext 为 "Foo.bar"', async () => {
    const code = `
class Foo {
  bar() {
    baz();
  }
}
function baz() {}
`;
    const callSites = await analyzeTs(code);
    const bazCall = callSites.find((c) => c.calleeName === 'baz' && c.calleeKind === 'free');
    expect(bazCall).toBeDefined();
    expect(bazCall?.callerContext).toBe('Foo.bar');
  });

  // 用例 8：C-4 修复 — 嵌套 callback 最近 scope 原则
  // class Foo { bar() { arr.map((x) => x.baz()) } } 中 x.baz() 的 callerContext 应为 <arrow:...>
  it('case 8 — C-4 修复：嵌套 callback 内调用 callerContext 为最近 arrow scope', async () => {
    const code = `
class Foo {
  bar(arr: any[]) {
    arr.map((x: any) => x.baz());
  }
}
`;
    const callSites = await analyzeTs(code);
    const bazCall = callSites.find((c) => c.calleeName === 'baz');
    expect(bazCall).toBeDefined();
    // C-4 修复：最近 scope 是匿名 arrow function，callerContext 应以 <arrow: 开头
    expect(bazCall?.callerContext).toMatch(/^<arrow:/);
    // 不应归属外层 Foo.bar
    expect(bazCall?.callerContext).not.toBe('Foo.bar');
  });

  // 用例 9：dynamic import → unresolved，calleeName="import"
  it('case 9 — import() 动态 import 产出 unresolved，calleeName="import"', async () => {
    const code = `
async function load() {
  await import('./engine');
}
`;
    const callSites = await analyzeTs(code);
    const importCall = callSites.find(
      (c) => c.calleeName === 'import' && c.calleeKind === 'unresolved',
    );
    expect(importCall).toBeDefined();
  });

  // 用例 10：C-3 修复 — import().then() 链式只含 1 条 import callSite
  it('case 10 — C-3 修复：import().then(cb) 只产出 1 条 import callSite，.then 不双计数', async () => {
    const code = `
function loadAndProcess() {
  import('./engine').then((mod) => {
    mod.run();
  });
}
`;
    const callSites = await analyzeTs(code);
    // 只应有 1 条 import callSite
    const importCalls = callSites.filter(
      (c) => c.calleeName === 'import' && c.calleeKind === 'unresolved',
    );
    expect(importCalls).toHaveLength(1);
    // .then 不应以 'then' + free 形式出现
    const thenCall = callSites.find((c) => c.calleeName === 'then' && c.calleeKind === 'cross-module');
    expect(thenCall).toBeUndefined();
  });

  // 用例 11：super.method() → super
  it('case 11 — super.method() 产出 super kind', async () => {
    const code = `
class Child extends Base {
  init() {
    super.init();
  }
}
`;
    const callSites = await analyzeTs(code);
    const superCall = callSites.find((c) => c.calleeName === 'init' && c.calleeKind === 'super');
    expect(superCall).toBeDefined();
  });

  // 用例 12：W-2 修复 — super() 构造器自调用 → super，calleeName="super"
  it('case 12 — super() 构造器自调用产出 super kind，calleeName="super"', async () => {
    const code = `
class Child extends Base {
  constructor(x: number) {
    super(x);
  }
}
`;
    const callSites = await analyzeTs(code);
    const superSelfCall = callSites.find(
      (c) => c.calleeName === 'super' && c.calleeKind === 'super',
    );
    expect(superSelfCall).toBeDefined();
  });

  // 用例 13：@Decorator() 带参 decorator → decorator kind
  it('case 13 — @Decorator() 带参 decorator 产出 decorator kind', async () => {
    const code = `
function MyDecorator() {
  return function(target: any) {};
}

@MyDecorator()
class Foo {}
`;
    const callSites = await analyzeTs(code);
    const decoratorCall = callSites.find(
      (c) => c.calleeName === 'MyDecorator' && c.calleeKind === 'decorator',
    );
    expect(decoratorCall).toBeDefined();
  });

  // 用例 14：W-3 修复 — 带参 decorator + 内层 call_expression 不双计数
  it('case 14 — W-3 修复：带参 decorator 只产出 1 条 decorator callSite，无额外 free/member', async () => {
    const code = `
function Validate(arg1: string, arg2: number) {
  return function(target: any) {};
}

@Validate('hello', 42)
class MyClass {}
`;
    const callSites = await analyzeTs(code);
    // 只应有 1 条 Validate decorator callSite
    const validateCalls = callSites.filter((c) => c.calleeName === 'Validate');
    expect(validateCalls).toHaveLength(1);
    expect(validateCalls[0]?.calleeKind).toBe('decorator');
    // 不应额外产出 free kind 的 Validate 调用
    const validateFree = callSites.find(
      (c) => c.calleeName === 'Validate' && c.calleeKind === 'free',
    );
    expect(validateFree).toBeUndefined();
  });

  // 用例 15：bare @Decorator（不带括号）→ 不产出 callSite
  it('case 15 — bare @Decorator 不带括号，不产出 callSite（CL-04）', async () => {
    const code = `
function readonly(target: any, key: string, descriptor: PropertyDescriptor) {
  return descriptor;
}

class Foo {
  @readonly
  bar() {}
}
`;
    const callSites = await analyzeTs(code);
    // bare decorator 不应产出任何 readonly callSite
    const readonlyCall = callSites.find((c) => c.calleeName === 'readonly');
    expect(readonlyCall).toBeUndefined();
  });

  // 用例 16：new Foo() → free，calleeName="Foo"（FR-1.3）
  it('case 16 — new Foo() 产出 free，calleeName="Foo"', async () => {
    const code = `
class Foo {}
function create() {
  return new Foo();
}
`;
    const callSites = await analyzeTs(code);
    const newFooCall = callSites.find((c) => c.calleeName === 'Foo' && c.calleeKind === 'free');
    expect(newFooCall).toBeDefined();
  });

  // 用例 17：W-2 修复 — new Function('code') → unresolved，calleeName="Function"
  it('case 17 — W-2 修复：new Function("code") 产出 unresolved，calleeName="Function"', async () => {
    const code = `
function createFn(code: string) {
  return new Function(code);
}
`;
    const callSites = await analyzeTs(code);
    const dynamicConstructor = callSites.find(
      (c) => c.calleeName === 'Function' && c.calleeKind === 'unresolved',
    );
    expect(dynamicConstructor).toBeDefined();
    // 不应产出 free kind 的 Function callSite
    const functionFree = callSites.find(
      (c) => c.calleeName === 'Function' && c.calleeKind === 'free',
    );
    expect(functionFree).toBeUndefined();
  });

  // 用例 18：tagged template（identifier tag）→ free
  it('case 18 — tagged template identifier tag 产出 free', async () => {
    const code = `
function html(strings: TemplateStringsArray, ...values: any[]) {
  return strings.join('');
}
const result = html\`<div>hello</div>\`;
`;
    const callSites = await analyzeTs(code);
    const tagCall = callSites.find((c) => c.calleeName === 'html' && c.calleeKind === 'free');
    expect(tagCall).toBeDefined();
  });

  // 用例 19：eval('code') → unresolved，calleeName="eval"
  it('case 19 — eval("code") 产出 unresolved，calleeName="eval"', async () => {
    const code = `
function run(code: string) {
  eval(code);
}
`;
    const callSites = await analyzeTs(code);
    const evalCall = callSites.find(
      (c) => c.calleeName === 'eval' && c.calleeKind === 'unresolved',
    );
    expect(evalCall).toBeDefined();
    // 不应为 free
    const evalFree = callSites.find(
      (c) => c.calleeName === 'eval' && c.calleeKind === 'free',
    );
    expect(evalFree).toBeUndefined();
  });

  // 用例 20：.tsx 文件 JSX fixture — JSX 元素不产出 Foo callSite（EC-9）
  it('case 20 — .tsx 文件 JSX <Foo /> 不产出 callSite（EC-9）', async () => {
    const code = `
import React from 'react';
function App() {
  return <Foo />;
}
function Foo() {
  return null;
}
`;
    // 使用 .tsx 扩展名
    const callSites = await analyzeTs(code, '.tsx');
    // JSX <Foo /> 不应产出名为 'Foo' 的 callSite（JSX 元素不是 call_expression）
    const jsxFooCall = callSites.find((c) => c.calleeName === 'Foo');
    expect(jsxFooCall).toBeUndefined();
  });

  // ─── Codex P1 复审补测（W-2~W-5）─────────────────────────

  // W-2 补测：Obj?.method() 大写 qualifier optional chain
  it('case 22 — W-2: Obj?.method() optional chain 大写 → member + qualifier', async () => {
    const code = `
function test(MaybeFoo: any) {
  MaybeFoo?.run();
}
`;
    const callSites = await analyzeTs(code);
    const optCall = callSites.find(
      (c) => c.calleeName === 'run' && c.calleeKind === 'member',
    );
    expect(optCall).toBeDefined();
    expect(optCall?.calleeQualifier).toBe('MaybeFoo');
  });

  // W-3 补测：tagged template member tag (ns.html`...`)
  it('case 23 — W-3: tagged template member tag → 委派 handleMemberCall', async () => {
    const code = `
const result = lib.html\`<div>x</div>\`;
`;
    const callSites = await analyzeTs(code);
    // tag = lib.html (member_expression)，按 handleMemberCall 规则：
    // qualifier='lib' 小写 → cross-module + qualifier='lib'
    const tagCall = callSites.find(
      (c) => c.calleeName === 'html' && c.calleeKind === 'cross-module',
    );
    expect(tagCall).toBeDefined();
    expect(tagCall?.calleeQualifier).toBe('lib');
  });

  // W-4 补测：new Foo.Sub() 委派 handleMemberCall
  it('case 24 — W-4: new Foo.Sub() member constructor → 委派 handleMemberCall', async () => {
    const code = `
const router = new express.Router();
`;
    const callSites = await analyzeTs(code);
    // constructor = express.Router (member_expression)，
    // qualifier='express' 小写 → cross-module + qualifier='express'
    const ctorCall = callSites.find(
      (c) => c.calleeName === 'Router' && c.calleeKind === 'cross-module',
    );
    expect(ctorCall).toBeDefined();
    expect(ctorCall?.calleeQualifier).toBe('express');
  });

  // W-5 补测：普通 Function() 调用（非 new）→ unresolved
  it('case 25 — W-5: Function("code") 普通调用（不带 new）→ unresolved', async () => {
    const code = `
const fn = Function("return 42");
`;
    const callSites = await analyzeTs(code);
    const funcCall = callSites.find((c) => c.calleeName === 'Function');
    expect(funcCall).toBeDefined();
    expect(funcCall?.calleeKind).toBe('unresolved');
  });

});

// ============================================================
// 直接调用 TypeScriptMapper.extractCallSites 的额外验证
// ============================================================

describe('TypeScriptMapper.extractCallSites — 直接调用骨架验证', () => {

  // 验证大文件 size guard 返回空数组
  it('size guard — source > 1MB 返回空数组', () => {
    const mapper = new TypeScriptMapper();
    // 构造一个假的 tree 对象（不解析，只测 size guard 分支）
    const largeSource = 'x'.repeat(1_000_001);

    // TypeScriptMapper.extractCallSites 在 source.length > 1MB 时直接返回 []
    // 我们传入一个最小化的 stub tree（rootNode 有 childCount=0）
    const stubTree = {
      rootNode: {
        childCount: 0,
        child: () => null,
        type: 'program',
        children: [],
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        hasError: false,
        isMissing: false,
        text: '',
        id: 0,
        parent: null,
        childForFieldName: () => null,
      },
    } as unknown as import('web-tree-sitter').Tree;

    const result = mapper.extractCallSites(stubTree, largeSource);
    expect(result).toEqual([]);
  });

});

// ============================================================
// F242 — enclosingNamedContext（resolver 归属回退链第二级）
//
// 设计见 specs/242-fix-callsite-syntax-coverage/plan.md 决策 1。
// 本组用例同时承担两个职责：
//   (a) callerContext 断言 = C-4 语义回归锚（本次修复不得改动 mapper 既有输出）
//   (b) enclosingNamedContext 断言 = 新增字段的期望值（含 undefined 省略分支）
//
// 【实测现状核实（T001 注意栏歧义点）】
// tree-sitter TS grammar 里匿名函数表达式的节点类型是 `function_expression`，
// 而 SCOPE_DEFINING_TYPES 收录的是 `function`——后者实际匹配到的是 `function`
// **关键字 token**（其子树不含函数体），因此 `<fn:` 前缀在当前 grammar 下
// 永不出现在任何 callSite 的 callerContext 上：函数表达式体内的调用会直接归属
// 其外层作用域。plan.md 形态 2 / 3b 描述的 `/^<fn:/` 与实测不符，
// 按 tasks.md「以实测现状为准」记录，本次不改 mapper 既有行为（超出 fix 范围）。
// ============================================================

describe('TypeScriptMapper.extractCallSites — F242 enclosingNamedContext', () => {

  // 形态 1：实参位置 arrow function 体内调用（kb-search.ts 验收案例的最小复刻）
  it('F242-1 — 具名函数内实参 arrow body 的调用：callerContext 匿名，enclosingNamedContext 为外层具名函数', async () => {
    const code = `
export function registerX(ctx: unknown) {
  withTelemetry('x', async (args: unknown) => executeX(ctx, args));
}
export function executeX(a: unknown, b: unknown) {}
`;
    const callSites = await analyzeTs(code);
    const call = callSites.find((c) => c.calleeName === 'executeX');
    expect(call).toBeDefined();
    // 回归锚：C-4 最近 scope 原则保持不变
    expect(call?.callerContext).toMatch(/^<arrow:/);
    // 新增：命名祖先可寻址，供 resolver 回退链第二级使用
    expect(call?.enclosingNamedContext).toBe('registerX');
  });

  // 形态 2：实参位置 function expression 体内调用
  // 实测现状：function_expression 不入栈 → callerContext 直接是外层具名函数，
  // 按省略规则 enclosingNamedContext 不填（等价 undefined）。
  it('F242-2 — 实参 function expression body 的调用：实测 callerContext 即外层具名函数，enclosingNamedContext 省略', async () => {
    const code = `
export function registerY(ctx: unknown) {
  wrap('y', function (args: unknown) { return executeY(ctx, args); });
}
export function executeY(a: unknown, b: unknown) {}
`;
    const callSites = await analyzeTs(code);
    const call = callSites.find((c) => c.calleeName === 'executeY');
    expect(call).toBeDefined();
    // 实测现状锚（非 plan 预期的 /^<fn:/，理由见本 describe 顶部说明）
    expect(call?.callerContext).toBe('registerY');
    // callerContext 已是命名上下文 → 省略规则生效
    expect(call?.enclosingNamedContext).toBeUndefined();
  });

  // 形态 3：嵌套两层匿名 callback → 跳过两层匿名直达命名祖先
  it('F242-3 — 嵌套两层匿名 arrow callback：enclosingNamedContext 跳过两层匿名直达 outer', async () => {
    const code = `
export function outer(arr: unknown[]) {
  arr.map((x: any) => x.filter((y: any) => inner(y)));
}
export function inner(y: unknown) {}
`;
    const callSites = await analyzeTs(code);
    const call = callSites.find((c) => c.calleeName === 'inner');
    expect(call).toBeDefined();
    // 回归锚：最近 scope 是最内层匿名 arrow
    expect(call?.callerContext).toMatch(/^<arrow:/);
    expect(call?.enclosingNamedContext).toBe('outer');
  });

  // 形态 3b-i：arrow IIFE 位于模块顶层 → 全栈皆匿名，无命名祖先 → 省略
  it('F242-3b-i — 顶层 arrow IIFE 内调用：栈内无命名祖先，enclosingNamedContext 省略', async () => {
    const code = `
(() => {
  helper();
})();
export function helper() {}
`;
    const callSites = await analyzeTs(code);
    const call = callSites.find((c) => c.calleeName === 'helper');
    expect(call).toBeDefined();
    expect(call?.callerContext).toMatch(/^<arrow:/);
    expect(call?.enclosingNamedContext).toBeUndefined();
  });

  // 形态 3b-ii：function expression IIFE 位于模块顶层
  // 实测现状：既无 callerContext 也无命名祖先（见顶部说明）
  it('F242-3b-ii — 顶层 function expression IIFE 内调用：实测 callerContext 与 enclosingNamedContext 均缺省', async () => {
    const code = `
(function () {
  helper();
})();
export function helper() {}
`;
    const callSites = await analyzeTs(code);
    const call = callSites.find((c) => c.calleeName === 'helper');
    expect(call).toBeDefined();
    expect(call?.callerContext).toBeUndefined();
    expect(call?.enclosingNamedContext).toBeUndefined();
  });

  // 模块顶层直接调用：callerContext 缺省，无命名祖先 → 省略（resolver 走模块兜底）
  it('F242-4 — 模块顶层直接调用：callerContext 与 enclosingNamedContext 均缺省', async () => {
    const code = `
const logger = createLogger('x');
export function createLogger(n: string) { return n; }
`;
    const callSites = await analyzeTs(code);
    const call = callSites.find((c) => c.calleeName === 'createLogger');
    expect(call).toBeDefined();
    expect(call?.callerContext).toBeUndefined();
    expect(call?.enclosingNamedContext).toBeUndefined();
  });

  // 类方法内的匿名 callback → 命名祖先是 "Class.method" 点分形态
  it('F242-5 — 类方法内匿名 callback：enclosingNamedContext 为 "Class.method" 点分形态', async () => {
    const code = `
export class Foo {
  bar(arr: unknown[]) {
    arr.map((x: any) => baz(x));
  }
}
export function baz(x: unknown) {}
`;
    const callSites = await analyzeTs(code);
    const call = callSites.find((c) => c.calleeName === 'baz');
    expect(call).toBeDefined();
    expect(call?.callerContext).toMatch(/^<arrow:/);
    expect(call?.enclosingNamedContext).toBe('Foo.bar');
  });

});

// ───────────────────────────────────────────────────────────
// F260 P2 — M13：H1 别名键收口的抽取侧（tree-sitter 静态 import 降级路径，plan §5 变更 #4）
//
// `_extractImportStatement` 今天只读 `import_specifier` 的 `name` 字段（源导出名），把
// `as` 右侧的本地绑定名整个丢掉，于是 `import { Foo as ExternalFoo }` 往 `namedImports`
// 写入 `'Foo'` —— 而 `'Foo'` 在本文件里根本没有这个绑定。resolver 侧 `aliasToTarget`
// 因此拿到一个「不该存在的键」，文件里恰好有别的东西叫 `Foo` 时就是确定性假边（H1）。
//
// 收口形态按 D1：新增 `namedImportBindings` 承载 imported/local 二元组，**仅当该条 import
// 至少有一个重命名说明符时产出**；一旦产出即为该条目 `namedImports` 的完整绑定视图
// （含未重命名项）——否则 `import { Foo, Foo as B }` 形态下会误杀合法绑定。
// ───────────────────────────────────────────────────────────

describe('F260 M13 — tree-sitter 静态 import 路径产出 namedImportBindings（H1 抽取侧）', () => {
  it('M13 — `import { Foo as ExternalFoo } from "./a.js"` 的 namedImportBindings 含 {imported:"Foo", local:"ExternalFoo"}', async () => {
    const skeleton = await analyzeTsSkeleton(`
import { Foo as ExternalFoo } from './a.js';
export function use(): void {
  ExternalFoo.run();
}
`);
    const imp = skeleton.imports.find((i) => i.moduleSpecifier === './a.js');
    expect(imp).toBeDefined();
    // 既有语义不变：namedImports 仍记源导出名（D1 明确否决改 namedImports 语义）
    expect(imp?.namedImports).toEqual(['Foo']);
    expect(imp?.namedImportBindings).toEqual([{ imported: 'Foo', local: 'ExternalFoo' }]);
  });

  it('M13b — 同一条 import 混合重命名与非重命名说明符时，namedImportBindings 是完整绑定视图', async () => {
    const skeleton = await analyzeTsSkeleton(`
import { Alpha, Beta as LocalBeta } from './m.js';
export function use(): void {
  Alpha.run();
  LocalBeta.run();
}
`);
    const imp = skeleton.imports.find((i) => i.moduleSpecifier === './m.js');
    expect(imp?.namedImportBindings).toEqual([
      { imported: 'Alpha', local: 'Alpha' },
      { imported: 'Beta', local: 'LocalBeta' },
    ]);
  });

  it('M13c — 无任何重命名说明符时不产出 namedImportBindings（D1 产出规则，保旧行为零变化）', async () => {
    const skeleton = await analyzeTsSkeleton(`
import { Alpha, Gamma } from './m.js';
export function use(): void {
  Alpha.run();
  Gamma.run();
}
`);
    const imp = skeleton.imports.find((i) => i.moduleSpecifier === './m.js');
    expect(imp?.namedImports).toEqual(['Alpha', 'Gamma']);
    expect(imp?.namedImportBindings).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// F260 P3 — M1–M15d：mapper 侧两遍式接收者类型环境（plan §D5 抽取层用例表）
//
// 本阶段只做**抽取层**：产出 `receiverType` / `receiverTypeSoleImportBinding`，
// resolver **不消费**。判据原样承接 plan 的 A1 / A3 / A4 / A5 / H4 / H7，不重新论证。
//
// 判据速查（出现分歧一律以 plan.md 为准）：
//  · A1 — 类名在本文件的**绑定点计数 ≥ 2（无论来源）⇒ 拦**；恰好 1 个且来自 import ⇒ 放行；
//         1 个但非 import 来源 ⇒ 拦；0 个 ⇒ 拦（fail-closed）。
//         `receiverTypeSoleImportBinding` 是**正向许可**语义，`undefined` 按 `false` 处理。
//  · A3 — `this.x` 的环境键按宿主 class 分桶（`ClassName#x`）；宿主是对象字面量方法 /
//         匿名类 / 带 `extends` 的类时一律弃权。
//  · A4 — 左值为已知 receiver 名的 `assignment_expression` 计为一个类型不可知的绑定点。
//  · A5 — 类型节点必须是裸 `type_identifier` 或 `generic_type` 的 name 部分。
//  · H4 — 两遍式：先全文件建环境、再走调用点（弃权对文件**开头**的调用点同样生效）。
//  · H7 — `new X().m()` 的构造器名走 AST（`new_expression.childForFieldName('constructor')`
//         且强制 `type === 'identifier'`），禁文本正则。
// ═══════════════════════════════════════════════════════════

/** 按 callee 名 + qualifier 定位唯一调用点（qualifier 省略则只按 callee 名）。 */
function findCall(
  callSites: CallSite[],
  calleeName: string,
  calleeQualifier?: string,
): CallSite | undefined {
  return callSites.find(
    (c) =>
      c.calleeName === calleeName &&
      (calleeQualifier === undefined || c.calleeQualifier === calleeQualifier),
  );
}

describe('F260 P3 — 接收者类型环境基础绑定形态（M1–M7）', () => {
  it('M1 — `const a = new Foo(); a.m()` 产出 receiverType=Foo 且 soleImportBinding=true', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export function use(): void {
  const a = new Foo();
  a.m();
}
`);
    const call = findCall(callSites, 'm', 'a');
    expect(call).toBeDefined();
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M2 — 类型注解 `const b: Foo = mk(); b.m()` 产出 receiverType=Foo', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
declare function mk(): Foo;
export function use(): void {
  const b: Foo = mk();
  b.m();
}
`);
    const call = findCall(callSites, 'm', 'b');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M3 — 形参 `function f(p: Foo) { p.m() }` 产出 receiverType=Foo', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export function f(p: Foo): void {
  p.m();
}
`);
    const call = findCall(callSites, 'm', 'p');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M4 — 类字段声明 `class C { private x: Foo; g(){ this.x.m() } }`（键 C#x）', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class C {
  private x: Foo;
  g(): void {
    this.x.m();
  }
}
`);
    const call = findCall(callSites, 'm', 'this.x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M5 — 类字段初始化 `class C { private x = new Foo(); … }`', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class C {
  private x = new Foo();
  g(): void {
    this.x.m();
  }
}
`);
    const call = findCall(callSites, 'm', 'this.x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M6 — `new Foo().m()` 走 AST childForFieldName("constructor") 取名（H7）', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export function use(): void {
  new Foo().m();
}
`);
    const call = findCall(callSites, 'm');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M7 — H7 守卫：`new (cond ? A : B)().m()` / `new registry[k]().m()` 不产出 receiverType', async () => {
    const callSites = await analyzeTs(`
import { A, B } from './a.js';
declare const cond: boolean;
declare const registry: Record<string, new () => A>;
declare const k: string;
export function use(): void {
  new (cond ? A : B)().m();
  new registry[k]().n();
}
`);
    expect(findCall(callSites, 'm')?.receiverType).toBeUndefined();
    expect(findCall(callSites, 'n')?.receiverType).toBeUndefined();
  });
});

describe('F260 P3 — 歧义弃权与 A1 绑定点计数（M8–M10c）', () => {
  it('M8 — 同名不同类型绑定：`let x: Foo` 与 `let x: Bar` 两处 x.m() 均弃权', async () => {
    const callSites = await analyzeTs(`
import { Foo, Bar } from './a.js';
export function f1(): void {
  let x: Foo;
  x.m();
}
export function f2(): void {
  let x: Bar;
  x.m();
}
`);
    const calls = callSites.filter((c) => c.calleeName === 'm' && c.calleeQualifier === 'x');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.receiverType).toBeUndefined();
  });

  it('M9 — 类型不可知同名绑定：`let x: Foo` + `let x = anything()` 两处均弃权', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
declare function anything(): unknown;
export function f1(): void {
  let x: Foo;
  x.m();
}
export function f2(): void {
  let x = anything();
  x.m();
}
`);
    const calls = callSites.filter((c) => c.calleeName === 'm' && c.calleeQualifier === 'x');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.receiverType).toBeUndefined();
  });

  it('M9b — A4 重赋值：`let x = new Foo(); if (c) x = new Bar(); x.m()` 弃权', async () => {
    const callSites = await analyzeTs(`
import { Foo, Bar } from './a.js';
declare const c: boolean;
export function use(): void {
  let x = new Foo();
  if (c) {
    x = new Bar();
  }
  x.m();
}
`);
    expect(findCall(callSites, 'm', 'x')?.receiverType).toBeUndefined();
  });

  it('M10 — A1 本地声明遮蔽 import：2 个绑定点 ⇒ soleImportBinding=false', async () => {
    const callSites = await analyzeTs(`
import { Service } from './s.js';
declare function mk(): Service;
export function h(): void {
  class Service {
    m(): void {}
  }
  void Service;
}
export function use(): void {
  const s: Service = mk();
  s.m();
}
`);
    const call = findCall(callSites, 'm', 's');
    expect(call?.receiverType).toBe('Service');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('M10b — A1 承重样本：import 遮蔽 import（两个绑定都来自 import）⇒ false', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './b.js';
export async function use(): Promise<void> {
  const { Foo } = await import('./a.js');
  const f = new Foo();
  f.m();
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('M10c — A1 零绑定 / 非 import 单绑定均 fail-closed ⇒ false', async () => {
    // 子样本 1：GlobalFoo 在本文件内**零**绑定点（环境声明来自别处）
    const zeroBinding = await analyzeTs(`
export function use(p: GlobalFoo): void {
  p.m();
}
`);
    const zeroCall = findCall(zeroBinding, 'm', 'p');
    expect(zeroCall?.receiverType).toBe('GlobalFoo');
    expect(zeroCall?.receiverTypeSoleImportBinding).toBe(false);

    // 子样本 2：唯一绑定点存在但非 import 来源（`declare const`）
    const nonImport = await analyzeTs(`
declare const Foo: unknown;
export function use(p: Foo): void {
  p.m();
}
`);
    const nonImportCall = findCall(nonImport, 'm', 'p');
    expect(nonImportCall?.receiverType).toBe('Foo');
    expect(nonImportCall?.receiverTypeSoleImportBinding).toBe(false);
  });
});

describe('F260 P3 — 不夺路 / 两遍式 / this 分桶 / 类型形状（M11–M12d）', () => {
  it('M11 — `this.m()` 直接 this 调用不产出 receiverType（不夺既有 Stage 2 路径）', async () => {
    const callSites = await analyzeTs(`
export class C {
  m(): void {}
  g(): void {
    this.m();
  }
}
`);
    const call = callSites.find((c) => c.calleeName === 'm' && c.calleeKind === 'member');
    expect(call).toBeDefined();
    expect(call?.receiverType).toBeUndefined();
    expect(call?.receiverTypeSoleImportBinding).toBeUndefined();
  });

  it('M12 — H4 两遍式：文件末尾才出现的二次绑定让文件开头的 x.m() 也弃权', async () => {
    const callSites = await analyzeTs(`
import { Foo, Bar } from './a.js';
export function early(): void {
  const x: Foo = mkFoo();
  x.m();
}
export function late(): void {
  const x: Bar = mkBar();
  void x;
}
declare function mkFoo(): Foo;
declare function mkBar(): Bar;
`);
    expect(findCall(callSites, 'm', 'x')?.receiverType).toBeUndefined();
  });

  it('M12b — A3 `this.x` 跨类串台：对象字面量方法宿主一律弃权', async () => {
    const callSites = await analyzeTs(`
import { Foo, Bar } from './a.js';
export class A {
  constructor(private client: Foo) {}
}
export function mk(client: Bar) {
  return {
    client,
    run() {
      this.client.m();
    },
  };
}
`);
    const call = findCall(callSites, 'm', 'this.client');
    expect(call).toBeDefined();
    expect(call?.receiverType).toBeUndefined();
  });

  it('M12c — A3 宿主带 extends：`class D extends Base { private x: Foo; g(){ this.x.m() } }` 弃权', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
declare class Base {}
export class D extends Base {
  private x: Foo;
  g(): void {
    this.x.m();
  }
}
`);
    const call = findCall(callSites, 'm', 'this.x');
    expect(call).toBeDefined();
    expect(call?.receiverType).toBeUndefined();
  });

  // M12e–M12g 由**变异测试**补强：A3 的三条宿主弃权判据（对象字面量方法 / 普通 function
  // 重绑 this / 静态块）在 M12b/M12c 之外还有独立的攻击形态——宿主**嵌套在一个真类里**。
  // M12b 的对象字面量写在顶层 function 里，上溯撞到普通 function 就停了，故它抓不到
  // 「memberHostBucket 不再对非 class_body 弃权」这一变异（实测该变异下 58 个用例零转红）。
  it('M12e — A3 宿主弃权：类方法内**嵌套**对象字面量的 `this.x` 不得借用外层类的字段', async () => {
    const callSites = await analyzeTs(`
import { Foo, Bar } from './a.js';
declare function mkBar(): Bar;
export class A {
  private client: Foo;
  g() {
    return {
      client: mkBar(),
      run() {
        this.client.m();
      },
    };
  }
}
`);
    const call = findCall(callSites, 'm', 'this.client');
    expect(call).toBeDefined();
    // 对象字面量方法里的 this 指向字面量自己（client 是 Bar），不是外层 class A（client 是 Foo）
    expect(call?.receiverType).toBeUndefined();
  });

  it('M12f — A3 宿主弃权：类方法内的普通 function 重绑 this，不得借用外层类的字段', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class A {
  private client: Foo;
  g(): void {
    function inner() {
      this.client.m();
    }
    void inner;
  }
}
`);
    const call = findCall(callSites, 'm', 'this.client');
    expect(call).toBeDefined();
    expect(call?.receiverType).toBeUndefined();
  });

  it('M12g — A3 宿主弃权：静态块里的 this 是类本身而非实例，不得借用实例字段', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class A {
  private client: Foo;
  static {
    this.client.m();
  }
}
`);
    const call = findCall(callSites, 'm', 'this.client');
    expect(call).toBeDefined();
    expect(call?.receiverType).toBeUndefined();
  });

  it('M12d — A5 类型形状：union / qualified / typeof / array 四否，generic 一是', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
declare const anchor: unknown;
export function f1(p1: Foo | undefined): void { p1.m(); }
export function f2(p2: NS.Foo): void { p2.m(); }
export function f3(p3: typeof anchor): void { p3.m(); }
export function f4(p4: Foo[]): void { p4.m(); }
export function f5(p5: Foo<number>): void { p5.m(); }
`);
    expect(findCall(callSites, 'm', 'p1')?.receiverType).toBeUndefined();
    expect(findCall(callSites, 'm', 'p2')?.receiverType).toBeUndefined();
    expect(findCall(callSites, 'm', 'p3')?.receiverType).toBeUndefined();
    expect(findCall(callSites, 'm', 'p4')?.receiverType).toBeUndefined();
    expect(findCall(callSites, 'm', 'p5')?.receiverType).toBe('Foo');
  });
});

describe('F260 P3 — fail-closed 不变量与四类 import 来源（M14–M15d）', () => {
  it('M14 — fail-closed 不变量：凡 receiverType 存在，receiverTypeSoleImportBinding 必存在', async () => {
    const samples = [
      `import { Foo } from './a.js';\nexport function u(): void { const a = new Foo(); a.m(); }`,
      `import { Foo } from './a.js';\ndeclare function mk(): Foo;\nexport function u(): void { const b: Foo = mk(); b.m(); }`,
      `import { Foo } from './a.js';\nexport function f(p: Foo): void { p.m(); }`,
      `import { Foo } from './a.js';\nexport class C { private x: Foo; g(): void { this.x.m(); } }`,
      `import { Foo } from './a.js';\nexport class C { private x = new Foo(); g(): void { this.x.m(); } }`,
      `import { Foo } from './a.js';\nexport function u(): void { new Foo().m(); }`,
    ];
    let withReceiverType = 0;
    for (const code of samples) {
      for (const cs of await analyzeTs(code)) {
        if (cs.receiverType === undefined) {
          // 反向不变量：没有类型就不该有标志（避免出现「标志有、类型无」的半开组合）
          expect(cs.receiverTypeSoleImportBinding).toBeUndefined();
          continue;
        }
        withReceiverType += 1;
        expect(typeof cs.receiverTypeSoleImportBinding).toBe('boolean');
      }
    }
    // 守护力自证：样本必须真的产出过 receiverType，否则这条断言是空转
    expect(withReceiverType).toBeGreaterThanOrEqual(samples.length);
  });

  it('M15 — dynamic 解构 `const { Foo } = await import(...)` 判为 import 来源 ⇒ true', async () => {
    const callSites = await analyzeTs(`
export async function use(): Promise<void> {
  const { Foo } = await import('./a.js');
  const f = new Foo();
  f.m();
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M15b — 静态 import 同形态 ⇒ true', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export function use(): void {
  const f = new Foo();
  f.m();
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M15c — `require(...)` 同形态 ⇒ true', async () => {
    const callSites = await analyzeTs(`
export function use(): void {
  const { Foo } = require('./a.js');
  const f = new Foo();
  f.m();
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('M15d — `import(...).then(cb)` 首参形参名同形态 ⇒ true（D2 判据表第三行）', async () => {
    const callSites = await analyzeTs(`
export function use(): void {
  void import('./a.js').then(({ Foo }) => {
    const f = new Foo();
    f.m();
  });
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// F260 P4b — 对抗审查收口（plan §13）
//
// 本段用例**按 `typescript-receiver-env.ts` 的源码判据面独立枚举**，不从既有断言反推
// （裁决 M5）。每一条「应弃权」型断言都必须有对应变异体将其杀死；
// 变异体清单与杀手矩阵见 `verification/p4b-attribution.md` §变异测试。
//
// 收口项：
//  · M1  —— 一切**值级绑定**（import / function / class / enum / namespace /
//           具名类与函数表达式）除进表 1 外必须同时进表 2 **中毒**；
//           否则同名且带类型注解的形参成为该名字的文件级唯一答案 ⇒ 确定性假边。
//  · M2  —— `resolveThisHostBucket` 遇 `static` 方法弃权（注册侧对静态字段本就 fail-closed，
//           查表侧不对称会让静态方法的 this.x 去查实例字段桶）。
//  · M3  —— `type_parameter`（函数级 + 类级）计入表 1，泛型形参名遮蔽同名 import。
//  · W-A —— 类表达式（`const K = class Same {}`）不分桶。
//  · W-B —— 增广赋值（`||=` / `??=`）与解构赋值同为 A4 绑定点。
// ═══════════════════════════════════════════════════════════

/**
 * 弃权型断言的统一入口（P4b）。
 *
 * 先断言**调用点确实被抽取到**，再断言它没有 `receiverType`。少了第一步，
 * 「调用点根本没产出」与「产出了但正确弃权」两种情况在断言上不可区分 ——
 * 那样的用例是真空绿，变异测试杀不死（F229 / 裁决 P3-2 的教训）。
 */
function expectAbstains(
  callSites: CallSite[],
  calleeName: string,
  calleeQualifier?: string,
): void {
  const call = findCall(callSites, calleeName, calleeQualifier);
  expect(call).toBeDefined();
  expect(call?.receiverType).toBeUndefined();
  expect(call?.receiverTypeSoleImportBinding).toBeUndefined();
}

/**
 * 取表 2 里所有**宿主分桶键**（`ClassName#field` 形态）的排序后集合（P5b-2）。
 *
 * `ReceiverTypeEnv` 只暴露按键查询，端到端断言因此只观测得到**被查询过**的键 ——
 * 「注册了一个永远不会被查的假键」这一整类缺陷在那个口径下不可观测（裁决 P5b-2）。
 * 这里在调用期间把 `globalThis.Map` 换成记录实例的子类，取回本次构建创建的全部 Map，
 * 再筛出含 `#` 的键：表 1 的键是裸类名、绝不含 `#`，故无需区分是哪张表，
 * 这个并集**就是**宿主分桶键空间。
 *
 * 已知耦合（如实登记）：该探针依赖「两张表用 `Map` 承载」这一实现事实。
 * 若实现换成别的容器，本用例会以「键集合为空」的形式**明红**（不是静默放行）。
 */
async function hostBucketKeys(code: string): Promise<string[]> {
  const grammar = await GrammarManager.getInstance().getGrammar('typescript');
  const parser = new Parser();
  parser.setLanguage(grammar);
  const tree = parser.parse(code);

  const created: Array<Map<unknown, unknown>> = [];
  class RecordingMap<K, V> extends Map<K, V> {
    constructor(entries?: readonly (readonly [K, V])[] | null) {
      super(entries);
      created.push(this as unknown as Map<unknown, unknown>);
    }
  }
  const RealMap = globalThis.Map;
  globalThis.Map = RecordingMap as unknown as MapConstructor;
  try {
    buildReceiverTypeEnv(tree);
  } finally {
    globalThis.Map = RealMap;
    tree.delete();
    parser.delete();
  }

  const keys = new Set<string>();
  for (const m of created) {
    for (const k of m.keys()) {
      if (typeof k === 'string' && k.includes('#')) keys.add(k);
    }
  }
  return [...keys].sort();
}

describe('F260 P4b M1 — 值级绑定必须同时进表 2 中毒（N1–N7）', () => {
  it('N1 — 具名 import 绑定中毒：同名形参不得成为该名字的唯一答案', async () => {
    const callSites = await analyzeTs(`
import { logger } from './logger.js';
import { A } from './a.js';
function helper(logger: A) { logger.q(); }
export function top() { logger.write(); }
`);
    expectAbstains(callSites, 'write', 'logger');
  });

  it('N1b — default import 绑定中毒', async () => {
    const callSites = await analyzeTs(`
import logger from './logger.js';
import { A } from './a.js';
function helper(logger: A) { logger.q(); }
export function top() { logger.write(); }
`);
    expectAbstains(callSites, 'write', 'logger');
  });

  it('N1c — namespace import（`* as ns`）绑定中毒', async () => {
    const callSites = await analyzeTs(`
import * as logger from './logger.js';
import { A } from './a.js';
function helper(logger: A) { logger.q(); }
export function top() { logger.write(); }
`);
    expectAbstains(callSites, 'write', 'logger');
  });

  it('N2 — 函数声明绑定中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
function send() {}
function helper(send: A) { send.q(); }
export function top() { send.write(); }
`);
    expectAbstains(callSites, 'write', 'send');
  });

  it('N3 — 本地 class 声明绑定中毒（净回归钉：此前会把正确边退化成假边）', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
export class Local { q() {} }
function helper(Local: A) { Local.q(); }
export function top() { Local.write(); }
`);
    expectAbstains(callSites, 'write', 'Local');
  });

  it('N4 — enum 声明绑定中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
enum Level { X }
function helper(Level: A) { Level.q(); }
export function top() { Level.write(); }
`);
    expectAbstains(callSites, 'write', 'Level');
  });

  it('N5 — namespace 声明绑定中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
namespace NS { export const v = 1; }
function helper(NS: A) { NS.q(); }
export function top() { NS.write(); }
`);
    expectAbstains(callSites, 'write', 'NS');
  });

  it('N6 — 具名**类表达式**的名字既进表 1 计数，也进表 2 中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
const K = class Same { m() {} };
function helper(Same: A) { Same.q(); }
export function top() { Same.write(); void K; }
`);
    expectAbstains(callSites, 'write', 'Same');
  });

  it('N6b — 具名**函数表达式**的名字同样中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
const f = function send() {};
function helper(send: A) { send.q(); }
export function top() { send.write(); void f; }
`);
    expectAbstains(callSites, 'write', 'send');
  });

  it('N7 — 正向保真：M1 的中毒不得误伤「无同名值绑定」的正常形参（recall 回归钉）', async () => {
    const callSites = await analyzeTs(`
import type { Foo } from './a.js';
export function use(candidate: Foo): void {
  candidate.m();
}
`);
    const call = findCall(callSites, 'm', 'candidate');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });
});

describe('F260 P4b M2 — 静态方法的 this 不得查实例字段桶（N8）', () => {
  it('N8 — `static boot() { this.conn.q() }` 弃权（注册侧对静态字段 fail-closed，查表侧须对称）', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
import { Reg } from './reg.js';
class C {
  conn: A;
  static conn: Reg = new Reg();
  static boot() { this.conn.q(); }
}
`);
    expectAbstains(callSites, 'q');
  });

  it('N8b — 正向保真：**实例**方法的 this.x 仍命中实例字段桶', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
class C {
  conn: A;
  run() { this.conn.q(); }
}
`);
    const call = findCall(callSites, 'q');
    expect(call?.receiverType).toBe('A');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });
});

describe('F260 P4b M3 — 泛型形参名遮蔽同名 import（N9–N10）', () => {
  it('N9 — 函数级 `function g<Foo>(x: Foo)`：Foo 有 2 个绑定点 ⇒ soleImportBinding=false', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './foo.js';
export function g<Foo>(x: Foo) { x.run(); }
`);
    const call = findCall(callSites, 'run', 'x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N10 — 类级 `class Box<Foo>`：同样计数 ⇒ soleImportBinding=false', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './foo.js';
export class Box<Foo> {
  private v: Foo;
  use() { this.v.run(); }
}
`);
    const call = findCall(callSites, 'run');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });
});

describe('F260 P4b W-A — 类表达式不分桶（N11）', () => {
  it('N11 — 两个同名类表达式：未声明字段的那个不得借用另一个的 `this.x` 桶', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
const K1 = class Same { x: A = null as any; m() { return this.x; } };
const K2 = class Same { n() { this.x.q(); } };
void K1; void K2;
`);
    expectAbstains(callSites, 'q');
  });
});

describe('F260 P4b W-B — 增广赋值与解构赋值同为 A4 绑定点（N12–N16）', () => {
  it('N12 — `x ||= …` 重绑后 x 中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare function make(): any;
let x: A = null as any;
x ||= make();
export function top() { x.q(); }
`);
    expectAbstains(callSites, 'q', 'x');
  });

  it('N13 — `x ??= …` 重绑后 x 中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare function make(): any;
let x: A = null as any;
x ??= make();
export function top() { x.q(); }
`);
    expectAbstains(callSites, 'q', 'x');
  });

  it('N14 — 对象解构赋值 `({ x } = …)` 重绑后 x 中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare function pair(): any;
let x: A = null as any;
({ x } = pair());
export function top() { x.q(); }
`);
    expectAbstains(callSites, 'q', 'x');
  });

  it('N15 — 数组解构赋值 `[x] = …` 重绑后 x 中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare function arr(): any;
let x: A = null as any;
[x] = arr();
export function top() { x.q(); }
`);
    expectAbstains(callSites, 'q', 'x');
  });

  it('N16 — 正向保真：`a.b = …` / `a[k] = …` 改的是属性，不得中毒接收者 a（recall 回归钉）', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export function use(k: string): void {
  const a = new Foo();
  a.field = 1;
  a[k] = 2;
  a.m();
}
`);
    const call = findCall(callSites, 'm', 'a');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });
});

describe('F260 P4b M5 — D2「import 来源」判据的反向样本（N17–N20）', () => {
  it('N17 — 非 `require` 的裸调用初值不算 import 来源 ⇒ soleImportBinding=false', async () => {
    const callSites = await analyzeTs(`
declare function acquire(m: string): any;
export function use(): void {
  const { Foo } = acquire('./a.js');
  const f = new Foo();
  f.m();
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N18 — 非 `import()` 的 await 初值不算 import 来源 ⇒ false', async () => {
    const callSites = await analyzeTs(`
declare function load(m: string): Promise<any>;
export async function use(): Promise<void> {
  const { Foo } = await load('./a.js');
  const f = new Foo();
  f.m();
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N19 — `import(...).then(cb)` 的**非首个**形参不算 import 来源 ⇒ false', async () => {
    const callSites = await analyzeTs(`
export function use(): void {
  void import('./a.js').then((mod, Foo?: any) => {
    void mod;
    const f = new Foo();
    f.m();
  });
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N20 — 首参但 `.then` 的接收者不是 `import(...)` ⇒ false', async () => {
    const callSites = await analyzeTs(`
declare function load(m: string): Promise<any>;
export function use(): void {
  void load('./a.js').then(({ Foo }) => {
    const f = new Foo();
    f.m();
  });
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N20b — 首参形参但外层不是 `.then`（`.catch`）⇒ false', async () => {
    const callSites = await analyzeTs(`
export function use(): void {
  void import('./a.js').catch(({ Foo }) => {
    const f = new Foo();
    f.m();
  });
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N20c — 回调不在 `.then` 的**首个**实参位（`then(other, cb)`）⇒ false', async () => {
    // ⚠️ 接收者必须是**裸** `import('...')`：套一层 `as any` 会让 isDynamicImportCall
    // 先行否决，用例对「首个实参位」这条判据就零判别力（实测该写法杀不死对应变异体）。
    const callSites = await analyzeTs(`
declare const first: () => void;
export function use(): void {
  void import('./a.js').then(first, ({ Foo }) => {
    const f = new Foo();
    f.m();
  });
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });
});

describe('F260 P4b M5 — A1「绑定点计数」的类型侧遮蔽反向样本（N21–N24）', () => {
  const shadowCase = (decl: string) => `
import { Foo } from './a.js';
${decl}
export function use(x: Foo): void {
  x.m();
}
`;

  it('N21 — `interface Foo {}` 遮蔽同名 import ⇒ soleImportBinding=false', async () => {
    const call = findCall(await analyzeTs(shadowCase('interface Foo { m(): void }')), 'm', 'x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N22 — `type Foo = …` 遮蔽同名 import ⇒ false', async () => {
    const call = findCall(await analyzeTs(shadowCase('type Foo = { m(): void };')), 'm', 'x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N23 — `enum Foo {}` 遮蔽同名 import ⇒ false', async () => {
    const call = findCall(await analyzeTs(shadowCase('enum Foo { A }')), 'm', 'x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N24 — `namespace Foo {}` 遮蔽同名 import ⇒ false', async () => {
    const call = findCall(await analyzeTs(shadowCase('namespace Foo { export const v = 1; }')), 'm', 'x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });

  it('N24b — `const K = class Foo {}` 的类表达式名同样计入遮蔽 ⇒ false', async () => {
    const call = findCall(await analyzeTs(shadowCase('const K = class Foo { m() {} }; void K;')), 'm', 'x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(false);
  });
});

describe('F260 P4b M5 — 表 2 中毒登记面的反向样本（N25–N30）', () => {
  it('N25 — `for…of` 绑定名中毒，不得借用同名形参的类型', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare const xs: any[];
function helper(it: A) { it.q(); }
export function top() {
  for (const it of xs) { it.write(); }
}
`);
    expectAbstains(callSites, 'write', 'it');
  });

  it('N26 — `catch (err)` 绑定名中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
function helper(err: A) { err.q(); }
export function top() {
  try { void 0; } catch (err) { err.write(); }
}
`);
    expectAbstains(callSites, 'write', 'err');
  });

  it('N27 — 箭头函数**单形参无括号**形态的绑定名中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare const xs: any[];
function helper(item: A) { item.q(); }
export const run = () => xs.map(item => item.write());
`);
    expectAbstains(callSites, 'write', 'item');
  });

  it('N28 — 变量**解构**绑定的元素类型不可知 ⇒ 中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare const pair: any;
function helper(part: A) { part.q(); }
export function top() {
  const { part } = pair;
  part.write();
}
`);
    expectAbstains(callSites, 'write', 'part');
  });

  it('N29 — 形参**解构**绑定同样中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
function helper(part: A) { part.q(); }
export function top({ part }: any) {
  part.write();
}
`);
    expectAbstains(callSites, 'write', 'part');
  });

  it('N30 — **静态字段**不登记实例桶：同名实例方法里的 this.x 不得拿到静态字段的类型', async () => {
    const callSites = await analyzeTs(`
import { Reg } from './reg.js';
class C {
  static conn: Reg = new Reg();
  run() { this.conn.q(); }
}
`);
    expectAbstains(callSites, 'q');
  });
});

describe('F260 P4b M5 — 参数属性 / 括号归一化 / 绑定名收集（N31–N34）', () => {
  it('N31 — `constructor(readonly x: Foo)` 参数属性登记进 `ClassName#x` 桶（正向）', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class C {
  constructor(readonly dep: Foo) {}
  run() { this.dep.m(); }
}
`);
    const call = findCall(callSites, 'm');
    expect(call?.receiverType).toBe('Foo');
  });

  it('N31b — `constructor(private x: Foo)` 同形态（accessibility_modifier 分支）', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class C {
  constructor(private dep: Foo) {}
  run() { this.dep.m(); }
}
`);
    expect(findCall(callSites, 'm')?.receiverType).toBe('Foo');
  });

  it('N31c — **非构造器**方法的同款形参不得登记进 `ClassName#x` 桶', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class C {
  setup(readonly dep: Foo) { void dep; }
  run() { this.dep.m(); }
}
`);
    expectAbstains(callSites, 'm');
  });

  it('N32 — `stripParens` 必须剥到底：三层括号的 `await import(...)` 仍判为 import 来源', async () => {
    const callSites = await analyzeTs(`
export async function use(): Promise<void> {
  const { Foo } = ((( await ((( import('./a.js') ))) )));
  const f = new Foo();
  f.m();
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N33 — `skipParenParents` 必须剥到底：回调被多层括号包裹仍判为 `.then` 首参', async () => {
    const callSites = await analyzeTs(`
export function use(): void {
  void import('./a.js').then((((({ Foo }) => {
    const f = new Foo();
    f.m();
  })))); 
}
`);
    const call = findCall(callSites, 'm', 'f');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N34 — 解构 rename 的 **key 侧**不是绑定名，不得计入遮蔽计数（正向保真）', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export async function use(x: Foo): Promise<void> {
  const { Foo: aliased } = await import('./b.js');
  void aliased;
  x.m();
}
`);
    const call = findCall(callSites, 'm', 'x');
    expect(call?.receiverType).toBe('Foo');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N35 — **匿名**类表达式不分桶（无 name ⇒ 弃权）', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
class Holder { x: A = null as any; }
const anon = class { n() { this.x.q(); } };
void anon; void Holder;
`);
    expectAbstains(callSites, 'q');
  });
});

describe('F260 P4b M5 — 变异测试补强轮暴露的判别力缺口（N36–N41）', () => {
  it('N31d — **无修饰符**的构造器形参不是参数属性，不得登记进 `ClassName#x` 桶', async () => {
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class C {
  constructor(dep: Foo) { void dep; }
  run() { this.dep.m(); }
}
`);
    expectAbstains(callSites, 'm');
  });

  it('N36 — A3 既定取舍：**对象字面量**内的箭头即使嵌在类方法里也弃权（fail-closed）', async () => {
    // 语义上此处 `this` 确实是 C 的实例，判据仍选择弃权 —— 这是 P3 定的保守取舍，
    // 不是漏洞。钉死它，避免有人「顺手放开」而在对象字面量宿主上重新打开串台面。
    const callSites = await analyzeTs(`
import { A } from './a.js';
class C {
  x: A = null as any;
  run() {
    const o = { m: () => { this.x.q(); } };
    void o;
  }
}
`);
    expectAbstains(callSites, 'q');
  });

  it('N37 — 正向保真：类方法内的**箭头**不重绑 this，上溯必须继续（不得提前停）', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
class C {
  x: A = null as any;
  run() {
    [1].forEach(() => { this.x.q(); });
  }
}
`);
    const call = findCall(callSites, 'q');
    expect(call?.receiverType).toBe('A');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N38 — 宿主判不出时不得退化成「用裸属性名当键」（否则同名局部变量会被借用）', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
declare class Base {}
const conn = new A();
class D extends Base {
  g() { this.conn.q(); }
}
void conn;
`);
    expectAbstains(callSites, 'q');
  });

  it('N39 — `other.b.m()` 的内层不是 `this`，不得去查宿主类的字段桶', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
class C {
  b: A = null as any;
  run(other: any) { other.b.m(); }
}
`);
    expectAbstains(callSites, 'm');
  });

  it('N40 — **匿名 function 表达式**同样重绑 this，不得借用外层类的字段', async () => {
    // M12f 用的是 `function inner() {}`（node type = function_declaration）；
    // `const f = function () {}` 是 function_expression，是另一个集合成员，必须单独钉。
    const callSites = await analyzeTs(`
import { Foo } from './a.js';
export class A {
  private client: Foo;
  g(): void {
    const f = function () {
      this.client.m();
    };
    void f;
  }
}
`);
    expectAbstains(callSites, 'm', 'this.client');
  });
});

describe('F260 P4b M5 — 绑定名收集边界：只有真正重绑的名字才算绑定点（N42–N44）', () => {
  it('N42 — 解构的**计算键**里出现的标识符不是绑定名，不得中毒该名字', async () => {
    // `{ [sel.id]: picked }` 只绑定 `picked`。若把 pair_pattern 的 key 侧也递归进去，
    // 计算键里的 `sel` 会被当成绑定名 ⇒ 同名形参被中毒 ⇒ 白掉一条真边（recall 回归）。
    const callSites = await analyzeTs(`
import { A } from './a.js';
export function use(sel: A, rec: Record<string, unknown>): void {
  const { [sel.id]: picked } = rec;
  void picked;
  sel.m();
}
`);
    const call = findCall(callSites, 'm', 'sel');
    expect(call?.receiverType).toBe('A');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N43 — `for (rec.slot of xs)` 赋值型左值的**属性名**不是绑定名，不得中毒同名形参', async () => {
    // for-of 的左值允许是赋值目标而非声明。`rec.slot` 重绑的是 `rec` 的属性，
    // 名字 `slot` 与 `rec` 都没有被重绑。
    //
    // ⚠️ 因果订正（P5b-2）：本用例**不是**由 `collectPatternNames` 里
    // `if (node.type === 'property_identifier') return;` 那一行守护的 —— `property_identifier`
    // 是叶子节点，删掉那条 `return` 后通用递归照样采不到它（子审查实测：删除后全绿），
    // 那是一行**死代码**。真正承重的是 `collectPatternNames` 的 `out.push` **白名单**
    // （只有 `identifier` / `shorthand_property_identifier_pattern` 会被 push），
    // 由改写 push 判据的变异体证实。
    // P5b-3 之后还多了一道更靠前的闸：`for_in_statement` 的左值形态白名单直接挡掉
    // `member_expression` 左值，本用例的输入根本走不到 `collectPatternNames`
    // （另见 N45 —— 那条才是白名单本身的杀手）。
    const callSites = await analyzeTs(`
import { A } from './a.js';
export function use(slot: A, rec: { slot: unknown }, xs: unknown[]): void {
  for (rec.slot of xs) {
    void 0;
  }
  slot.m();
}
`);
    const call = findCall(callSites, 'm', 'slot');
    expect(call?.receiverType).toBe('A');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N43b — 解构**赋值**左值里的属性名不是绑定名（`collectPatternNames` 的 push 白名单）', async () => {
    // N43 原本经 `for (rec.slot of xs)` 走到 `collectPatternNames`；P5b-3 给
    // `for_in_statement` 加了左值白名单之后，那条输入在更靠前的闸就被挡下，
    // 于是 `collectPatternNames` 对 `property_identifier` 的处置**失去了守护用例**
    // （变异测试实测：U16 从"被 N43 杀死"退化为存活）。本用例补回这条通路：
    // `({ slot: rec.slot } = src)` 的左值是 object_pattern（在白名单内）⇒ 一路递归到
    // member_expression，其 `property` 就是 `property_identifier`。
    // 采名只能采到 `rec`，采到 `slot` 就会中毒同名形参、白掉下面这条真边。
    const callSites = await analyzeTs(`
import { A } from './a.js';
export function use(slot: A, rec: { slot: unknown }, src: { slot: unknown }): void {
  ({ slot: rec.slot } = src);
  slot.m();
}
`);
    const call = findCall(callSites, 'm', 'slot');
    expect(call?.receiverType).toBe('A');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N44 — 宿主判不出的字段必须**整条不登记**：表 2 的宿主分桶键集合逐字受控', async () => {
    // `class D extends Base` 的字段按 A3 弃权（父类可能声明同名字段）。
    //
    // ⚠️ 断言口径订正（P5b-2）：原用例只做端到端断言（`this.conn.q()` 拿到 B），
    // 那只能杀死「兜底桶名**恰好等于**文件里某个真实类名」的变异体 —— 因为端到端只观测得到
    // 被查询的那个键。兜底桶名换成 `'__anon__'` / `''` / `String(node.parent?.id)` 时，
    // 假键从来不会被查，端到端全绿。故改为**直接对注册键集合断言**：
    // 表 2 里所有宿主分桶键（含 `#` 的键）必须逐字等于唯一合法的那一个。
    const code = `
import { A } from './a.js';
import { B } from './b.js';
declare class Base {}
class D extends Base {
  conn: A = null as any;
}
class anon {
  conn: B = null as any;
  g() { this.conn.q(); }
}
void D;
`;
    // 主断言：`D` 的字段整条不登记 ⇒ 键集合里不得出现任何宿主非真实类名的键
    expect(await hostBucketKeys(code)).toEqual(['anon#conn']);

    // 补充断言（原端到端口径保留）：真实存在的那个桶仍给出正确类型
    const callSites = await analyzeTs(code);
    expect(findCall(callSites, 'q')?.receiverType).toBe('B');
  });
});

// ═══════════════════════════════════════════════════════════
// F260 P5b — 收口轮补的杀手用例（N45–N48）
//
// 来源：plan §15 裁决 P5b-1 / P5b-2 / P5b-3。三组分别钉：
//   · N45 系列 —— `for_in_statement` 左值形态白名单（P5b-3 修的 recall bug）
//   · N46 系列 —— 表 2 的键 `'this'` 不被消费（Q01「等价」结论被证伪后的杀手）
//   · N47      —— ERROR 恢复形态下 `memberHostBucket` 仍要求 parent 是 class_body
//                 （U11「等价」结论被证伪后的杀手）
// ═══════════════════════════════════════════════════════════

describe('F260 P5b-3 — `for_in_statement` 左值形态白名单（W-B 的第二个入口）', () => {
  it('N45 — `for (rec.slot of xs)` 改的是属性，`rec` 不得被中毒（member_expression 左值）', async () => {
    // for-of / for-in 的左值允许是**赋值目标**而非声明。`rec.slot` 只重绑 `rec` 的属性，
    // `rec` 本身所指未变。`assignment_expression` 分支有 ASSIGNMENT_BINDING_TARGET_TYPES
    // 白名单挡住同款形态，`for_in_statement` 分支缺同一道闸时会把 `rec` 误当绑定名中毒，
    // 白掉下面这条真边（方向是丢边不是假边，但两个入口的判据必须对称）。
    const callSites = await analyzeTs(`
import { A } from './a.js';
export function use(rec: A, xs: unknown[]): void {
  for (rec.slot of xs) { void 0; }
  rec.m();
}
`);
    const call = findCall(callSites, 'm', 'rec');
    expect(call?.receiverType).toBe('A');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });

  it('N45b — `for (rec[0] of xs)` 同款（subscript_expression 左值）', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
export function use(rec: A, xs: unknown[][]): void {
  for (rec[0] of xs) { void 0; }
  rec.m();
}
`);
    expect(findCall(callSites, 'm', 'rec')?.receiverType).toBe('A');
  });

  it('N45c — 保真反向：`for (const rec of xs)` 是真绑定，仍必须中毒同名形参', async () => {
    // 白名单只放行「真正重绑名字」的形态。identifier / object_pattern / array_pattern
    // 三种声明形态一条都不能被顺手放过，否则 P5b-3 就从修 recall 变成开假边口子。
    const callSites = await analyzeTs(`
import { A } from './a.js';
export function use(rec: A, xs: unknown[]): void {
  for (const rec of xs) { void rec; }
  rec.m();
}
`);
    expectAbstains(callSites, 'm', 'rec');
  });

  it('N45d — 保真反向：`for (const { rec } of xs)` 解构声明同样中毒', async () => {
    const callSites = await analyzeTs(`
import { A } from './a.js';
export function use(rec: A, xs: Array<{ rec: unknown }>): void {
  for (const { rec } of xs) { void rec; }
  rec.m();
}
`);
    expectAbstains(callSites, 'm', 'rec');
  });
});

describe('F260 P5b-1 — 被证伪的两个「等价」变异体的杀手用例（N46–N47）', () => {
  it('N46 — 绑定位的 `this` 被词法器吐成普通 identifier，`this.q()` 仍必须弃权', async () => {
    // Q01 变异体把接收者形态 1 扩到裸 `this`（查 `env.lookupReceiverType('this')`）。
    // 原「等价」论证说键 `'this'` 永不可登记 —— 已被证伪：`const this = new Foo()` 在
    // tree-sitter 下**解析零 ERROR**，`this` 落在 variable_declarator 的 name 位且节点类型
    // 就是 `identifier` ⇒ 键 `'this'` 会被登记。磁盘上的 WIP / 半成品文件是 Spectra 的
    // 真实采集面，「tsc 会报错」不构成豁免。
    const callSites = await analyzeTs(`
const this = new Foo();
class C { m() { this.q(); } }
`);
    expectAbstains(callSites, 'q');
  });

  it('N46b — 带 import 的同形态（会点亮 sole=true 的那条）同样弃权', async () => {
    // 这条是真正危险的形态：`A` 在本文件恰好 1 个绑定点且来自 import ⇒ A1 放行 ⇒
    // 变异体产出的是一条带 `soleImportBinding=true` 的高置信假边。
    const callSites = await analyzeTs(`
import { A } from './a.js';
const this: A = null as any;
class C { m() { this.q(); } }
`);
    expectAbstains(callSites, 'q');
  });

  it('N47 — ERROR 恢复：ERROR 节点里的同名字段不得中毒 class_body 里的正常字段', async () => {
    // U11 变异体撤掉 `memberHostBucket` 的「parent 必须是 class_body」判据。
    // 原「等价」论证说 `public_field_definition` 的 parent 恒为 class_body —— 已被证伪：
    // 容错恢复下 `g!` 会落进一个**直挂 class_declaration 的 ERROR 节点**，
    // 其 parent.parent 正是具名类 `C`。撤掉判据后这个无类型的 `g` 会以 `C#g` 登记（type=null）
    // 并把 class_body 里正常字段 `g: A` 建的同名桶冲突中毒 ⇒ 丢边。
    const callSites = await analyzeTs(
      'class C { g!){ g: A = null as any; run(){ this.g.q(); } } }',
    );
    const call = findCall(callSites, 'q', 'this.g');
    expect(call?.receiverType).toBe('A');
  });

  it('N47b — 同形态 + import：ERROR 里的 `g` 不得白掉 sole=true 的那条边', async () => {
    const callSites = await analyzeTs(
      "import { A } from './a.js'; class C { g!){ g: A = null as any; run(){ this.g.q(); } } }",
    );
    const call = findCall(callSites, 'q', 'this.g');
    expect(call?.receiverType).toBe('A');
    expect(call?.receiverTypeSoleImportBinding).toBe(true);
  });
});
