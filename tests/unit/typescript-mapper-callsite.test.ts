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

import { TreeSitterAnalyzer } from '../../src/core/tree-sitter-analyzer.js';
import { TypeScriptMapper } from '../../src/core/query-mappers/typescript-mapper.js';
import type { CallSite } from '../../src/models/call-site.js';
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
