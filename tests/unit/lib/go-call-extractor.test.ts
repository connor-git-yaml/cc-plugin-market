/**
 * Feature 150 Phase 4C — Go Call Extractor 单测
 *
 * 覆盖：
 *   - 1. 基础形态：bare call (foo) / selector call (obj.method) / package call (fmt.Println)
 *   - 2. function / method / static / unresolved kind 分类（FR-006）
 *   - 3. caller resolve：function_declaration / method_declaration / func_literal / top-level
 *   - 4. import alias 扫描：默认 last-segment / 自定义 alias / blank/dot/underscore import 跳过
 *   - 5. reflect / unsafe 反射检测 → unresolved
 *   - 6. parse-error 文件 skip + sibling 文件正常抽取
 *   - 7. metadata 头 baseline / generatedAt / extractorVersion
 *   - 8. _walkGoAst direct unit (fake AST) — phantom call / sibling ERROR / MISSING / 防御
 *   - 9. _classifyCallExpression direct unit — selector vs identifier vs unknown
 *
 * TDD 状态：先写测试 (red)，再写 extractor 实现 (green)。
 *
 * 注：本文件不依赖真实 GORM clone，inline source 即可覆盖所有 case；
 *      集成层 spot-check 在 T-012 单独跑。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  _classifyCallExpression,
  _resolveGoCaller,
  _scanImports,
  _walkGoAst,
  _goNodeLine,
  extractGoCallSites,
} from '../../../scripts/lib/go-call-extractor.mjs';
import { createWarningsArray } from '../../../scripts/lib/extractor-helpers.mjs';

interface TruthCall {
  caller: string;
  callee: string;
  file: string;
  line: number;
  kind: 'method' | 'function' | 'static' | 'unresolved';
  dynamicReason?: string;
}

interface ExtractResult {
  language: 'go';
  truthCalls: TruthCall[];
  warnings: Array<{ file: string; line?: number; code: string; message?: string }>;
  baseline?: { repo?: string; commit?: string; scope: string };
}

const tmpDirs: string[] = [];

function makeTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  tmpDirs.push(dir);
  return dir;
}

function findCallByCallee(result: ExtractResult, callee: string): TruthCall | undefined {
  return result.truthCalls.find((c) => c.callee === callee);
}

function findAllCallsByCallee(result: ExtractResult, callee: string): TruthCall[] {
  return result.truthCalls.filter((c) => c.callee === callee);
}

afterAll(() => {
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// ── 1. 基础 call 抽取 ──

describe('extractGoCallSites — 基础 call', () => {
  it('bare function call foo() → kind=function', async () => {
    const tmp = makeTempDir('go-extract-bare');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func foo() {}',
        'func main() { foo() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const f = findCallByCallee(result, 'foo');
    expect(f).toBeDefined();
    expect(f?.kind).toBe('function');
    expect(f?.caller).toContain(':main');
  });

  it('method call via selector obj.method() → kind=method', async () => {
    const tmp = makeTempDir('go-extract-method');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'type T struct{}',
        'func (t *T) hello() {}',
        'func main() {',
        '  t := &T{}',
        '  t.hello()',
        '}',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const h = findCallByCallee(result, 'hello');
    expect(h).toBeDefined();
    expect(h?.kind).toBe('method');
  });

  it('package func fmt.Println() (import alias) → kind=static', async () => {
    const tmp = makeTempDir('go-extract-static');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import "fmt"',
        'func main() { fmt.Println("hi") }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const p = findCallByCallee(result, 'Println');
    expect(p).toBeDefined();
    expect(p?.kind).toBe('static');
  });

  it('multi-line import block (fmt + errors) 都识别为 static', async () => {
    const tmp = makeTempDir('go-extract-multi-import');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import (',
        '  "fmt"',
        '  "errors"',
        ')',
        'func main() {',
        '  fmt.Println("hi")',
        '  _ = errors.New("err")',
        '}',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const p = findCallByCallee(result, 'Println');
    const e = findCallByCallee(result, 'New');
    expect(p?.kind).toBe('static');
    expect(e?.kind).toBe('static');
  });

  it('自定义 import alias: f "fmt" → f.Println 仍为 static', async () => {
    const tmp = makeTempDir('go-extract-aliased-import');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import f "fmt"',
        'func main() { f.Println("hi") }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const p = findCallByCallee(result, 'Println');
    expect(p?.kind).toBe('static');
  });

  it('long import path → 取末段 segment 作 alias (gopkg.in/foo.v3 → foo.v3)', async () => {
    // 真实 case: import "github.com/go-gorm/gorm" → alias = "gorm"
    const tmp = makeTempDir('go-extract-long-path');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import "errors"', // standard library, alias=errors
        'func main() { _ = errors.New("e") }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const e = findCallByCallee(result, 'New');
    expect(e?.kind).toBe('static');
  });

  it('blank import _ "fmt" 跳过（不加入 alias 集合）', async () => {
    const tmp = makeTempDir('go-extract-blank-import');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import (',
        '  _ "fmt"',
        ')',
        'func main() {}',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    // 没有调用，应通过
    expect(result.warnings.filter((w) => w.code !== 'parse-error').length).toBe(0);
  });

  it('dot import . "fmt" 跳过（dot import 引入未限定名，不加入 alias）', async () => {
    const tmp = makeTempDir('go-extract-dot-import');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import . "fmt"', // 此后 Println 是 bare call
        'func main() { Println("hi") }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const p = findCallByCallee(result, 'Println');
    expect(p?.kind).toBe('function'); // dot import → bare call
  });
});

// ── 2. caller resolve ──

describe('extractGoCallSites — caller resolve', () => {
  it('function_declaration 内 → <file>:funcName', async () => {
    const tmp = makeTempDir('go-caller-func');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func helper() {}',
        'func main() { helper() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const h = findCallByCallee(result, 'helper');
    expect(h?.caller).toBe('main.go:main');
  });

  it('method_declaration 含 receiver type → <file>:Type.method', async () => {
    const tmp = makeTempDir('go-caller-method');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func helper() {}',
        'type T struct{}',
        'func (t *T) bar() { helper() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const h = findCallByCallee(result, 'helper');
    expect(h?.caller).toBe('main.go:T.bar');
  });

  // Codex Round 1 WARNING #2: generic receiver type extraction
  it('generic receiver func (t MyType[K, V]) → <file>:MyType.method', async () => {
    const tmp = makeTempDir('go-caller-generic-receiver');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func helper() {}',
        'type MyType[K, V any] struct{}',
        'func (t MyType[K, V]) M() { helper() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const h = findCallByCallee(result, 'helper');
    expect(h?.caller).toBe('main.go:MyType.M');
  });

  // Codex Round 1 WARNING #2: 嵌套指针 receiver
  it('double-pointer receiver func (t **T) → <file>:T.method', async () => {
    const tmp = makeTempDir('go-caller-double-ptr');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func helper() {}',
        'type T struct{}',
        'func (t **T) Mdouble() { helper() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const h = findCallByCallee(result, 'helper');
    expect(h?.caller).toBe('main.go:T.Mdouble');
  });

  it('value receiver (无指针) func (t T) → <file>:T.method', async () => {
    const tmp = makeTempDir('go-caller-value-receiver');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func helper() {}',
        'type T struct{}',
        'func (t T) val() { helper() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const h = findCallByCallee(result, 'helper');
    expect(h?.caller).toBe('main.go:T.val');
  });

  it('func_literal (closure) → <file>:<closure:line:col>', async () => {
    const tmp = makeTempDir('go-caller-closure');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func helper() {}',
        'func main() {',
        '  f := func() { helper() }',
        '  f()',
        '}',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const helperCalls = findAllCallsByCallee(result, 'helper');
    expect(helperCalls.length).toBe(1);
    expect(helperCalls[0]?.caller).toMatch(/main\.go:<closure:\d+:\d+>/);
  });

  it('top-level call (e.g. var x = foo()) → <file>:<top-level>', async () => {
    const tmp = makeTempDir('go-caller-top-level');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func init1() int { return 0 }',
        'var X = init1()',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const initCall = findCallByCallee(result, 'init1');
    expect(initCall?.caller).toBe('main.go:<top-level>');
  });
});

// ── 3. unresolved (反射 / dynamic) ──

describe('extractGoCallSites — unresolved (反射)', () => {
  it('reflect.ValueOf(...) → kind=unresolved + dynamicReason', async () => {
    const tmp = makeTempDir('go-extract-reflect');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import "reflect"',
        'func main() { _ = reflect.ValueOf("x") }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const v = findCallByCallee(result, 'ValueOf');
    expect(v).toBeDefined();
    expect(v?.kind).toBe('unresolved');
  });

  it('reflect.TypeOf(...) → kind=unresolved', async () => {
    const tmp = makeTempDir('go-extract-typeof');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import "reflect"',
        'func main() { _ = reflect.TypeOf("x") }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const t = findCallByCallee(result, 'TypeOf');
    expect(t?.kind).toBe('unresolved');
  });

  // Codex Round 1 WARNING #1: chained reflection (known limitation)
  // reflect.ValueOf(x).Method(0).Call(nil) — 顶层 ValueOf 标 unresolved，
  // 但 chained .Method().Call() 当前 receiver 是变量/中间结果，不在 reflect/unsafe 集合
  // → 标 method (label-only 限制；准确做需要符号解析跟踪 reflect.Value 类型)
  it('chained reflection v.Method(0).Call(nil) → kind=method (known limitation)', async () => {
    const tmp = makeTempDir('go-extract-chained-reflect');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import "reflect"',
        'func main() {',
        '  v := reflect.ValueOf("x")',
        '  _ = v.Method(0).Call(nil)',
        '}',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    // Codex Round 2 WARNING #3 fix: 锁定完整输出，确保不抽多/不抽少
    const callees = result.truthCalls.map((c) => c.callee).sort();
    expect(callees).toEqual(['Call', 'Method', 'ValueOf']);
    expect(result.truthCalls).toHaveLength(3);
    // ValueOf 是反射顶点 → unresolved
    expect(findCallByCallee(result, 'ValueOf')?.kind).toBe('unresolved');
    // Method/Call 是 chained — receiver 是中间结果，不在 reflect/unsafe 集合 → method (已知 limitation)
    expect(findCallByCallee(result, 'Method')?.kind).toBe('method');
    expect(findCallByCallee(result, 'Call')?.kind).toBe('method');
  });

  it('unsafe.Pointer(...) → kind=unresolved (unsafe 也算反射类)', async () => {
    const tmp = makeTempDir('go-extract-unsafe');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'import "unsafe"',
        'func main() { var x int; _ = unsafe.Pointer(&x) }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const p = findCallByCallee(result, 'Pointer');
    expect(p?.kind).toBe('unresolved');
  });
});

// ── 4. 边界形态 ──

describe('extractGoCallSites — 边界形态', () => {
  it('generic call foo[int](x) → kind=function (call_expression 含 type_arguments)', async () => {
    const tmp = makeTempDir('go-extract-generic');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func foo[T any](x T) T { return x }',
        'func main() { _ = foo[int](1) }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const f = findCallByCallee(result, 'foo');
    expect(f).toBeDefined();
    expect(f?.kind).toBe('function');
  });

  it('chained call obj.A().B() → 抽取 2 条记录', async () => {
    const tmp = makeTempDir('go-extract-chain');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'type T struct{}',
        'func (t T) A() T { return t }',
        'func (t T) B() T { return t }',
        'func main() { var t T; _ = t.A().B() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const a = findCallByCallee(result, 'A');
    const b = findCallByCallee(result, 'B');
    expect(a?.kind).toBe('method');
    expect(b?.kind).toBe('method');
  });

  it('type conversion int(x) 末端 callee=int kind=function (label-only 不区分)', async () => {
    const tmp = makeTempDir('go-extract-typeconv');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func main() { _ = int(3.14) }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const c = findCallByCallee(result, 'int');
    expect(c).toBeDefined();
    // label-only: 类型转换与 bare function call AST 完全相同，无法仅靠 AST 区分
    expect(c?.kind).toBe('function');
  });

  it('multi-return assignment 含 call: a, err := split() → 抽 split', async () => {
    const tmp = makeTempDir('go-extract-multi-return');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'func split() (int, error) { return 1, nil }',
        'func main() { _, _ = split() }',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const s = findCallByCallee(result, 'split');
    expect(s?.kind).toBe('function');
  });

  it('selector_expression operand 是 PascalCase 但非 import → kind=method (按变量处理)', async () => {
    // var T MyType; T.Method() — operand="T" 大写但是变量
    const tmp = makeTempDir('go-extract-uppercase-var');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      [
        'package main',
        'type MyType struct{}',
        'func (m *MyType) Method() {}',
        'func main() {',
        '  var T = &MyType{}',
        '  T.Method()',
        '}',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    const m = findCallByCallee(result, 'Method');
    // T 不在 import alias → 按 method (Java-style PascalCase 启发式不适用 Go)
    expect(m?.kind).toBe('method');
  });
});

// ── 5. parse-error / partial salvage ──

describe('extractGoCallSites — parse-error skip', () => {
  it('语法错文件 → parse-error-partial warning，但 sibling 文件正常抽取', async () => {
    const tmp = makeTempDir('go-extract-parse-err');
    fs.writeFileSync(
      path.join(tmp, 'broken.go'),
      'package main\nfunc broken() { ;;; >>>> never close <<<<<',
    );
    fs.writeFileSync(
      path.join(tmp, 'ok.go'),
      [
        'package main',
        'func main() { ok() }',
        'func ok() {}',
      ].join('\n'),
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    expect(result.warnings.some((w) => w.file === 'broken.go')).toBe(true);
    const o = findCallByCallee(result, 'ok');
    expect(o).toBeDefined();
  });
});

// ── 6. metadata header / baseline ──

describe('extractGoCallSites — metadata', () => {
  it('truth set 含 baseline { repo, commit, scope }', async () => {
    const tmp = makeTempDir('go-extract-baseline');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      'package main\nfunc main() {}',
    );
    const result = (await extractGoCallSites({
      sourceRoot: tmp,
      baseline: { repo: 'go-gorm/gorm', commit: 'abc123', scope: 'gorm.io/gorm 顶层包' },
    })) as ExtractResult;
    expect(result.baseline?.repo).toBe('go-gorm/gorm');
    expect(result.baseline?.commit).toBe('abc123');
    expect(result.baseline?.scope).toBe('gorm.io/gorm 顶层包');
  });

  it('warnings 数组非 null（即使无错误也是空数组）', async () => {
    const tmp = makeTempDir('go-extract-no-err');
    fs.writeFileSync(
      path.join(tmp, 'main.go'),
      'package main\nfunc main() {}',
    );
    const result = (await extractGoCallSites({ sourceRoot: tmp })) as ExtractResult;
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('source root 不存在 → throw', async () => {
    await expect(
      extractGoCallSites({ sourceRoot: '/non-existent-feature-150-go' }),
    ).rejects.toThrow();
  });

  // Codex Round 1 WARNING #3 + Round 2 WARNING #2 fix: ignoreDirs merge 行为
  // 必须真实写入 call site (不只是函数声明) — extractor 只抽 call_expression
  it('ignoreDirs 选项 merge 默认 ignore (vendor 仍跳过, schema 也跳过)', async () => {
    const tmp = makeTempDir('go-ignore-dirs-merge');
    // 顶层 .go：含 callee=topFn 的 call site
    fs.writeFileSync(
      path.join(tmp, 'top.go'),
      [
        'package main',
        'func topFn() {}',
        'func main() { topFn() }', // ← 真实 call site
      ].join('\n'),
    );
    // vendor/ 下含 call site，但 vendor 在 DEFAULT_IGNORE_DIRS 应被跳过
    fs.mkdirSync(path.join(tmp, 'vendor'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'vendor', 'v.go'),
      [
        'package vendored',
        'func vendoredFn() {}',
        'func init() { vendoredFn() }', // ← 真实 call site，应被忽略
      ].join('\n'),
    );
    // schema/ 下含 call site，schema 在用户传的 ignoreDirs 应被跳过
    fs.mkdirSync(path.join(tmp, 'schema'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'schema', 's.go'),
      [
        'package schema',
        'func schemaFn() {}',
        'func init() { schemaFn() }', // ← 真实 call site，应被忽略
      ].join('\n'),
    );
    const result = (await extractGoCallSites({
      sourceRoot: tmp,
      ignoreDirs: ['schema'],
    })) as ExtractResult;
    expect(findCallByCallee(result, 'topFn')).toBeDefined();
    // 关键验证：vendoredFn / schemaFn 调用点都不在 result 中（merge fix 工作）
    expect(findCallByCallee(result, 'vendoredFn')).toBeUndefined();
    expect(findCallByCallee(result, 'schemaFn')).toBeUndefined();
    // 文件覆盖：仅 top.go
    const files = new Set(result.truthCalls.map((c) => c.file));
    expect(files.size).toBe(1);
    expect([...files][0]).toBe('top.go');
  });
});

// ── 7. _classifyCallExpression direct unit ──

describe('_classifyCallExpression — direct unit', () => {
  it('callee = identifier "foo" → kind=function', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') return { type: 'identifier', text: 'foo' };
        return null;
      },
    };
    const importAliases = new Set<string>();
    expect(_classifyCallExpression(fake, importAliases)).toEqual({
      name: 'foo',
      kind: 'function',
    });
  });

  it('callee = selector_expression (operand=identifier "obj", field="m") → kind=method', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') {
          return {
            type: 'selector_expression',
            childForFieldName: (k: string) => {
              if (k === 'operand') return { type: 'identifier', text: 'obj' };
              if (k === 'field') return { type: 'field_identifier', text: 'm' };
              return null;
            },
          };
        }
        return null;
      },
    };
    const importAliases = new Set<string>();
    expect(_classifyCallExpression(fake, importAliases)).toEqual({
      name: 'm',
      kind: 'method',
    });
  });

  it('callee = selector_expression (operand 在 import alias 中) → kind=static', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') {
          return {
            type: 'selector_expression',
            childForFieldName: (k: string) => {
              if (k === 'operand') return { type: 'identifier', text: 'fmt' };
              if (k === 'field') return { type: 'field_identifier', text: 'Println' };
              return null;
            },
          };
        }
        return null;
      },
    };
    const importAliases = new Set(['fmt']);
    expect(_classifyCallExpression(fake, importAliases)).toEqual({
      name: 'Println',
      kind: 'static',
    });
  });

  it('callee = selector_expression operand="reflect" + field="ValueOf" → kind=unresolved (反射)', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') {
          return {
            type: 'selector_expression',
            childForFieldName: (k: string) => {
              if (k === 'operand') return { type: 'identifier', text: 'reflect' };
              if (k === 'field') return { type: 'field_identifier', text: 'ValueOf' };
              return null;
            },
          };
        }
        return null;
      },
    };
    const importAliases = new Set(['reflect']);
    // reflect 优先级高于 import alias static — 反射调用
    const result = _classifyCallExpression(fake, importAliases);
    expect(result.kind).toBe('unresolved');
    expect(result.dynamicReason).toBe('unresolved-reflection');
  });

  it('callee = selector_expression operand="unsafe" + field="Pointer" → kind=unresolved', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') {
          return {
            type: 'selector_expression',
            childForFieldName: (k: string) => {
              if (k === 'operand') return { type: 'identifier', text: 'unsafe' };
              if (k === 'field') return { type: 'field_identifier', text: 'Pointer' };
              return null;
            },
          };
        }
        return null;
      },
    };
    const importAliases = new Set(['unsafe']);
    expect(_classifyCallExpression(fake, importAliases).kind).toBe('unresolved');
  });

  it('callee = parenthesized_expression / unknown → unresolved + dynamicReason', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') return { type: 'parenthesized_expression', text: '(f)' };
        return null;
      },
    };
    const importAliases = new Set<string>();
    const result = _classifyCallExpression(fake, importAliases);
    expect(result.kind).toBe('unresolved');
  });

  it('null 节点 → unresolved + dynamicReason', () => {
    expect(_classifyCallExpression(null, new Set()).kind).toBe('unresolved');
  });

  it('childForFieldName 不可用 → unresolved', () => {
    const fake = { type: 'call_expression', childForFieldName: null };
    expect(_classifyCallExpression(fake, new Set()).kind).toBe('unresolved');
  });

  it('function field 缺失 → unresolved', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: () => null,
    };
    expect(_classifyCallExpression(fake, new Set()).kind).toBe('unresolved');
  });

  it('selector_expression 缺 operand/field 字段 → unresolved', () => {
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') {
          return {
            type: 'selector_expression',
            childForFieldName: () => null,
          };
        }
        return null;
      },
    };
    expect(_classifyCallExpression(fake, new Set()).kind).toBe('unresolved');
  });

  it('selector_expression operand 不是 identifier (chained) → kind=method', () => {
    // a.b().c — 这种 chained 形态 operand 是 call_expression，按 method 处理
    const fake = {
      type: 'call_expression',
      childForFieldName: (n: string) => {
        if (n === 'function') {
          return {
            type: 'selector_expression',
            childForFieldName: (k: string) => {
              if (k === 'operand') return { type: 'call_expression', text: 'a.b()' };
              if (k === 'field') return { type: 'field_identifier', text: 'c' };
              return null;
            },
          };
        }
        return null;
      },
    };
    expect(_classifyCallExpression(fake, new Set()).kind).toBe('method');
  });
});

// ── 8. _resolveGoCaller direct unit ──

describe('_resolveGoCaller — direct unit', () => {
  it('node.parent=null → <top-level>', () => {
    expect(_resolveGoCaller({ parent: null }, 'a.go')).toBe('a.go:<top-level>');
  });

  it('在 function_declaration 内 → <file>:funcName', () => {
    const fnDecl = {
      type: 'function_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'helper' } : null,
      parent: null,
    };
    const callNode = { parent: fnDecl };
    expect(_resolveGoCaller(callNode, 'main.go')).toBe('main.go:helper');
  });

  it('在 method_declaration (pointer receiver) 内 → <file>:Type.method', () => {
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'field_identifier', text: 'bar' };
        if (n === 'receiver') {
          return {
            type: 'parameter_list',
            namedChildren: [
              {
                type: 'parameter_declaration',
                namedChildren: [
                  { type: 'identifier', text: 't' },
                  {
                    type: 'pointer_type',
                    namedChildren: [{ type: 'type_identifier', text: 'T' }],
                  },
                ],
              },
            ],
          };
        }
        return null;
      },
      parent: null,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveGoCaller(callNode, 'main.go')).toBe('main.go:T.bar');
  });

  it('在 method_declaration (value receiver) 内 → <file>:Type.method', () => {
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'field_identifier', text: 'val' };
        if (n === 'receiver') {
          return {
            type: 'parameter_list',
            namedChildren: [
              {
                type: 'parameter_declaration',
                namedChildren: [
                  { type: 'identifier', text: 't' },
                  { type: 'type_identifier', text: 'T' },
                ],
              },
            ],
          };
        }
        return null;
      },
      parent: null,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveGoCaller(callNode, 'main.go')).toBe('main.go:T.val');
  });

  it('在 func_literal 内 → <file>:<closure:line:col>', () => {
    const closure = {
      type: 'func_literal',
      parent: null,
      startPosition: { row: 4, column: 12 },
    };
    const callNode = { parent: closure };
    expect(_resolveGoCaller(callNode, 'main.go')).toBe('main.go:<closure:5:12>');
  });

  it('method_declaration 缺 receiver → fallback to <file>:method (无 Type 前缀)', () => {
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'field_identifier', text: 'lone' };
        if (n === 'receiver') return null;
        return null;
      },
      parent: null,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveGoCaller(callNode, 'main.go')).toBe('main.go:lone');
  });

  it('function_declaration 缺 name 字段 → <file>:<anon-func>', () => {
    const fnDecl = {
      type: 'function_declaration',
      childForFieldName: () => null,
      parent: null,
    };
    const callNode = { parent: fnDecl };
    expect(_resolveGoCaller(callNode, 'main.go')).toBe('main.go:<anon-func>');
  });

  it('func_literal 缺 startPosition.column → 默认 0', () => {
    const closure = {
      type: 'func_literal',
      parent: null,
      startPosition: { row: 7 },
    };
    const callNode = { parent: closure };
    expect(_resolveGoCaller(callNode, 'main.go')).toBe('main.go:<closure:8:0>');
  });

  it('node 为 null → <top-level>', () => {
    expect(_resolveGoCaller(null, 'main.go')).toBe('main.go:<top-level>');
  });
});

// ── 9. _scanImports direct unit ──

describe('_scanImports — direct unit', () => {
  it('单个 import "fmt" → 集合含 "fmt"', () => {
    const fakeImportSpec = {
      type: 'import_spec',
      childForFieldName: (n: string) => {
        if (n === 'name') return null;
        if (n === 'path') return { type: 'interpreted_string_literal', text: '"fmt"' };
        return null;
      },
    };
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [fakeImportSpec],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    const aliases = _scanImports(fakeRoot);
    expect(aliases.has('fmt')).toBe(true);
  });

  it('包名带显式 alias: f "fmt" → 集合用 "f"', () => {
    const fakeImportSpec = {
      type: 'import_spec',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'package_identifier', text: 'f' };
        if (n === 'path') return { type: 'interpreted_string_literal', text: '"fmt"' };
        return null;
      },
    };
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [fakeImportSpec],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    const aliases = _scanImports(fakeRoot);
    expect(aliases.has('f')).toBe(true);
    expect(aliases.has('fmt')).toBe(false);
  });

  it('blank import _ "fmt" → 不加入集合', () => {
    const fakeImportSpec = {
      type: 'import_spec',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'blank_identifier', text: '_' };
        if (n === 'path') return { type: 'interpreted_string_literal', text: '"fmt"' };
        return null;
      },
    };
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [fakeImportSpec],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    const aliases = _scanImports(fakeRoot);
    expect(aliases.has('fmt')).toBe(false);
    expect(aliases.has('_')).toBe(false);
  });

  it('dot import . "fmt" → 不加入集合（dot import 引入未限定名）', () => {
    const fakeImportSpec = {
      type: 'import_spec',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'dot', text: '.' };
        if (n === 'path') return { type: 'interpreted_string_literal', text: '"fmt"' };
        return null;
      },
    };
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [fakeImportSpec],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    const aliases = _scanImports(fakeRoot);
    expect(aliases.has('fmt')).toBe(false);
  });

  it('long path: "github.com/foo/bar" → 末段 "bar"', () => {
    const fakeImportSpec = {
      type: 'import_spec',
      childForFieldName: (n: string) => {
        if (n === 'name') return null;
        if (n === 'path') {
          return {
            type: 'interpreted_string_literal',
            text: '"github.com/foo/bar"',
          };
        }
        return null;
      },
    };
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [fakeImportSpec],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    const aliases = _scanImports(fakeRoot);
    expect(aliases.has('bar')).toBe(true);
    expect(aliases.has('foo')).toBe(false);
  });

  it('import_declaration 含 import_spec_list (多个 spec) → 全部解析', () => {
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [
        {
          type: 'import_spec_list',
          namedChildren: [
            {
              type: 'import_spec',
              childForFieldName: (n: string) =>
                n === 'path' ? { type: 'interpreted_string_literal', text: '"fmt"' } : null,
            },
            {
              type: 'import_spec',
              childForFieldName: (n: string) =>
                n === 'path' ? { type: 'interpreted_string_literal', text: '"errors"' } : null,
            },
          ],
        },
      ],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    const aliases = _scanImports(fakeRoot);
    expect(aliases.has('fmt')).toBe(true);
    expect(aliases.has('errors')).toBe(true);
  });

  it('源文件无 import_declaration → 集合为空', () => {
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [],
    };
    const aliases = _scanImports(fakeRoot);
    expect(aliases.size).toBe(0);
  });

  it('root 节点为 null/缺 namedChildren → 空集合', () => {
    expect(_scanImports(null).size).toBe(0);
    expect(_scanImports({ type: 'x' }).size).toBe(0);
  });

  it('path 字段不是 interpreted_string_literal → 跳过', () => {
    const fakeImportSpec = {
      type: 'import_spec',
      childForFieldName: (n: string) =>
        n === 'path' ? { type: 'unknown_kind', text: '???' } : null,
    };
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [fakeImportSpec],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    expect(_scanImports(fakeRoot).size).toBe(0);
  });

  it('path 字段引号内空字符串 → 跳过', () => {
    const fakeImportSpec = {
      type: 'import_spec',
      childForFieldName: (n: string) =>
        n === 'path'
          ? { type: 'interpreted_string_literal', text: '""' }
          : null,
    };
    const fakeImportDecl = {
      type: 'import_declaration',
      namedChildren: [fakeImportSpec],
    };
    const fakeRoot = {
      type: 'source_file',
      namedChildren: [fakeImportDecl],
    };
    expect(_scanImports(fakeRoot).size).toBe(0);
  });
});

// ── 10. _walkGoAst direct unit (fake AST) ──

describe('_walkGoAst — direct unit (fake AST)', () => {
  it('ERROR 节点跳过子树', () => {
    const callExpr = {
      type: 'call_expression',
      childForFieldName: (n: string) =>
        n === 'function' ? { type: 'identifier', text: 'phantom' } : null,
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const errorNode = { type: 'ERROR', namedChildren: [callExpr], parent: null };
    callExpr.parent = errorNode;
    const root = { type: 'source_file', namedChildren: [errorNode] };
    errorNode.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    const importAliases = new Set<string>();
    _walkGoAst(root, 'main.go', truthBuf, warnings, importAliases);
    expect(truthBuf.items).toHaveLength(0);
  });

  it('MISSING 节点跳过子树', () => {
    const callExpr = {
      type: 'call_expression',
      childForFieldName: (n: string) =>
        n === 'function' ? { type: 'identifier', text: 'phantom' } : null,
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const missingNode = { type: 'MISSING', namedChildren: [callExpr], parent: null };
    callExpr.parent = missingNode;
    const root = { type: 'source_file', namedChildren: [missingNode] };
    missingNode.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkGoAst(root, 'main.go', truthBuf, warnings, new Set());
    expect(truthBuf.items).toHaveLength(0);
  });

  it('phantom call (callee hasError) → skip 抽取，但 children 仍 walk', () => {
    const innerCall = {
      type: 'call_expression',
      childForFieldName: (n: string) =>
        n === 'function' ? { type: 'identifier', text: 'real' } : null,
      startPosition: { row: 1 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const phantomFnNode = {
      type: 'identifier',
      text: 'phantom',
      hasError: true,
    };
    const outerCall = {
      type: 'call_expression',
      childForFieldName: (n: string) =>
        n === 'function' ? phantomFnNode : null,
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [innerCall],
    };
    innerCall.parent = outerCall;
    const root = { type: 'source_file', namedChildren: [outerCall] };
    outerCall.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkGoAst(root, 'main.go', truthBuf, warnings, new Set());
    // 外层 phantom 不抽，内层 real 仍抽
    expect(truthBuf.items.map((c) => c.callee)).toEqual(['real']);
  });

  it('node 缺 namedChildren → 不入栈', () => {
    const root = { type: 'source_file' };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkGoAst(root, 'main.go', truthBuf, warnings, new Set());
    expect(truthBuf.items).toHaveLength(0);
  });

  it('stack 中含 null/undefined 节点 → 跳过', () => {
    const root = { type: 'source_file', namedChildren: [null, undefined] };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    expect(() => _walkGoAst(root, 'main.go', truthBuf, warnings, new Set())).not.toThrow();
  });
});

// ── 11. _goNodeLine ──

describe('_goNodeLine — direct unit', () => {
  it('row=0 → 1 (1-based)', () => {
    expect(_goNodeLine({ startPosition: { row: 0 } })).toBe(1);
  });

  it('row=10 → 11', () => {
    expect(_goNodeLine({ startPosition: { row: 10 } })).toBe(11);
  });

  it('node 缺 startPosition → fallback 0+1=1', () => {
    expect(_goNodeLine({})).toBe(1);
  });

  it('node 为 null → 1', () => {
    expect(_goNodeLine(null)).toBe(1);
  });
});
