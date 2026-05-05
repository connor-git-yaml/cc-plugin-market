/**
 * Feature 150 Phase 4B — Java call site extractor 单元测试
 *
 * 覆盖 spec FR-007 / plan §Tree-sitter query 关键模式 Java 部分（2026-05-05 修订后真实
 * node types）+ FR-020 单测覆盖矩阵：
 *   - method_invocation：基础方法调用 / overloading / static dispatch / super.method() / this.method() / interface default
 *   - object_creation_expression：new ClassName() / new GenericType<T>()
 *   - explicit_constructor_invocation：构造器内 super() / this()
 *   - unresolved：Class.forName / 反射类（label-only 视为 method，但保留 unresolved 触发路径）
 *   - parse-error / phantom call 防护 / lambda scope / anonymous class scope
 *
 * 设计：每 case 在独立 tmpdir 写 inline source，避免依赖 baseline workspace。
 * Codex Phase 4D 经验教训预防：phantom call (sibling ERROR) / caller scope 嵌套优先 /
 * POSIX path 归一 / arrow caller 行+列唯一化。
 */

import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  extractJavaCallSites,
  _classifyMethodInvocation,
  _classifyObjectCreation,
  _classifyExplicitConstructorInvocation,
  _resolveJavaCaller,
  _processOneJavaFile,
  _walkJavaAst,
  _javaNodeLine,
} from '../../../scripts/lib/java-call-extractor.mjs';
import {
  loadTreeSitterGrammar,
  createWarningsArray,
} from '../../../scripts/lib/extractor-helpers.mjs';

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
  kind: 'method' | 'static' | 'constructor' | 'super' | 'unresolved';
}

interface ExtractWarning {
  file: string;
  line?: number;
  code: string;
  message?: string;
}

interface ExtractResult {
  language: 'java';
  truthCalls: TruthCall[];
  warnings: ExtractWarning[];
  baseline?: {
    repo?: string;
    commit?: string;
    scope: string;
    generatedAt: string;
    extractorVersion: string;
  };
}

function findCallByCallee(
  result: ExtractResult,
  callee: string,
): TruthCall | undefined {
  return result.truthCalls.find((c) => c.callee === callee);
}

function findAllByCallee(result: ExtractResult, callee: string): TruthCall[] {
  return result.truthCalls.filter((c) => c.callee === callee);
}

// ── 1. basic method call: obj.foo() ──

describe('extractJavaCallSites — basic method call', () => {
  it('抽取 method_invocation → kind=method', async () => {
    const tmp = makeTempDir('java-extract-basic');
    fs.writeFileSync(
      path.join(tmp, 'A.java'),
      [
        'public class A {',
        '  void caller() { obj.foo(); }',
        '  Object obj;',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;

    expect(result.language).toBe('java');
    expect(Array.isArray(result.truthCalls)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);

    const fooCall = findCallByCallee(result, 'foo');
    expect(fooCall).toBeDefined();
    expect(fooCall?.kind).toBe('method');
    expect(fooCall?.line).toBe(2);
  });

  it('caller 包含 ClassName.methodName 形态', async () => {
    const tmp = makeTempDir('java-extract-caller');
    fs.writeFileSync(
      path.join(tmp, 'Service.java'),
      [
        'class Service {',
        '  void run() { helper(); }',
        '  void helper() { }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const helper = findCallByCallee(result, 'helper');
    expect(helper).toBeDefined();
    expect(helper?.caller).toContain('Service.run');
  });
});

// ── 2. method overloading: same callee name, multiple signatures ──

describe('extractJavaCallSites — method overloading', () => {
  it('label-only 视为同 callee，多个 overload call 计两条', async () => {
    const tmp = makeTempDir('java-extract-overload');
    fs.writeFileSync(
      path.join(tmp, 'O.java'),
      [
        'class O {',
        '  void caller() {',
        '    obj.foo(1);',
        '    obj.foo("hi");',
        '  }',
        '  Object obj;',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const foos = findAllByCallee(result, 'foo');
    // 两次 obj.foo(...) 都按 label-only 抽到同名 callee
    expect(foos.length).toBe(2);
    expect(foos.every((c) => c.kind === 'method')).toBe(true);
  });
});

// ── 3. static dispatch: Math.max(...) (Codex Phase 4B CRITICAL #1 修订) ──

describe('extractJavaCallSites — static dispatch', () => {
  it('Math.max(1, 2) → kind=static (object 是 type_identifier "Math")', async () => {
    const tmp = makeTempDir('java-extract-static');
    fs.writeFileSync(
      path.join(tmp, 'S.java'),
      [
        'class S {',
        '  void caller() { int x = Math.max(1, 2); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const max = findCallByCallee(result, 'max');
    expect(max).toBeDefined();
    // Codex Phase 4B CRITICAL #1: object="Math" (uppercase identifier) → 必须分类为 static
    expect(max?.kind).toBe('static');
  });

  it('Logger.getLogger("foo") → kind=static (uppercase identifier "Logger")', async () => {
    const tmp = makeTempDir('java-extract-static-logger');
    fs.writeFileSync(
      path.join(tmp, 'L.java'),
      [
        'class L {',
        '  void caller() { var x = Logger.getLogger("foo"); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const get = findCallByCallee(result, 'getLogger');
    expect(get).toBeDefined();
    expect(get?.kind).toBe('static');
  });

  it('list.add(1) → kind=method (instance, lowercase identifier "list")', async () => {
    const tmp = makeTempDir('java-extract-instance-method');
    fs.writeFileSync(
      path.join(tmp, 'M.java'),
      [
        'import java.util.ArrayList;',
        'class M {',
        '  void caller() { var list = new ArrayList<Integer>(); list.add(1); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const add = findCallByCallee(result, 'add');
    expect(add).toBeDefined();
    // 小写 identifier 应保持 method 不被误判 static
    expect(add?.kind).toBe('method');
  });

  it('Outer.Inner.staticMethod() → kind=static (Round 2 修订: field_access 末段 PascalCase 检测)', async () => {
    // Codex Round 2 CRITICAL #2: tree-sitter 在表达式上下文把 `Outer.Inner` parse 为 field_access。
    // 末段 field "Inner" 是 PascalCase → 整个 receiver 推断为类型路径 → kind=static
    const tmp = makeTempDir('java-extract-static-scoped');
    fs.writeFileSync(
      path.join(tmp, 'O.java'),
      [
        'class O {',
        '  static class Outer {',
        '    static class Inner {',
        '      static int staticMethod() { return 0; }',
        '    }',
        '  }',
        '  void caller() { int x = Outer.Inner.staticMethod(); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const sm = findCallByCallee(result, 'staticMethod');
    expect(sm).toBeDefined();
    expect(sm?.kind).toBe('static');
  });

  // Codex Round 3 CRITICAL: java.util.UUID.randomUUID() — HikariCP PoolBase.java:360 真实场景
  it('java.util.UUID.randomUUID() → kind=static (Round 3 修订: FQN package walk)', async () => {
    const tmp = makeTempDir('java-extract-fqn-uuid');
    fs.writeFileSync(
      path.join(tmp, 'P.java'),
      [
        'class P {',
        '  void caller() {',
        '    final var id = java.util.UUID.randomUUID();',
        '  }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const r = findCallByCallee(result, 'randomUUID');
    expect(r).toBeDefined();
    expect(r?.kind).toBe('static');
  });

  // Codex Round 3 CRITICAL: 简短 acronym 类型直接调用
  it('UUID.randomUUID() (无包前缀, 走 acronym 白名单) → kind=static', async () => {
    const tmp = makeTempDir('java-extract-uuid-short');
    fs.writeFileSync(
      path.join(tmp, 'U.java'),
      [
        'import java.util.UUID;',
        'class U {',
        '  void caller() { final var id = UUID.randomUUID(); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const r = findCallByCallee(result, 'randomUUID');
    expect(r).toBeDefined();
    expect(r?.kind).toBe('static');
  });

  // Codex Round 2 CRITICAL #1: HikariCP 风格的 LOGGER 常量调用必须是 method
  it('LOGGER.debug(...) → kind=method (修复 HikariCP 53 条 LOGGER 误判)', async () => {
    const tmp = makeTempDir('java-extract-logger-const');
    fs.writeFileSync(
      path.join(tmp, 'L.java'),
      [
        'import org.slf4j.Logger;',
        'import org.slf4j.LoggerFactory;',
        'class L {',
        '  private static final Logger LOGGER = LoggerFactory.getLogger(L.class);',
        '  void caller() { LOGGER.debug("hi"); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const debug = findCallByCallee(result, 'debug');
    expect(debug).toBeDefined();
    // LOGGER 是 SCREAMING_SNAKE_CASE 常量 (instance)，不是类型
    expect(debug?.kind).toBe('method');
  });
});

// ── 4. interface default method ──

describe('extractJavaCallSites — interface default method', () => {
  it('interface 内 default method 内部调用 spliterator() → kind=method', async () => {
    const tmp = makeTempDir('java-extract-iface');
    fs.writeFileSync(
      path.join(tmp, 'I.java'),
      [
        'public interface I {',
        '  default void run() { spliterator(); }',
        '  java.util.Spliterator spliterator();',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const sp = findCallByCallee(result, 'spliterator');
    expect(sp).toBeDefined();
    expect(sp?.kind).toBe('method');
    expect(sp?.caller).toContain('I.run');
  });
});

// ── 5. constructor (object_creation_expression) ──

describe('extractJavaCallSites — constructor', () => {
  it('new ArrayList<>() → kind=constructor，callee=ArrayList', async () => {
    const tmp = makeTempDir('java-extract-ctor');
    fs.writeFileSync(
      path.join(tmp, 'C.java'),
      [
        'import java.util.ArrayList;',
        'class C {',
        '  void caller() {',
        '    ArrayList<Integer> a = new ArrayList<Integer>();',
        '    Foo f = new Foo();',
        '  }',
        '}',
        'class Foo {}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const arrCtor = findCallByCallee(result, 'ArrayList');
    expect(arrCtor).toBeDefined();
    expect(arrCtor?.kind).toBe('constructor');

    const fooCtor = findCallByCallee(result, 'Foo');
    expect(fooCtor).toBeDefined();
    expect(fooCtor?.kind).toBe('constructor');
  });

  it('array_creation_expression (new int[]{...}) 不视为 constructor 调用', async () => {
    const tmp = makeTempDir('java-extract-arr');
    fs.writeFileSync(
      path.join(tmp, 'C.java'),
      [
        'class C {',
        '  void caller() {',
        '    int[] a = new int[]{1, 2, 3};',
        '    String[] b = new String[10];',
        '  }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    // array_creation_expression 应被忽略（不是 object_creation_expression）
    expect(result.truthCalls.find((c) => c.callee === 'int')).toBeUndefined();
    expect(result.truthCalls.find((c) => c.callee === 'String')).toBeUndefined();
  });
});

// ── 6. super.method() — method_invocation with super keyword as object ──

describe('extractJavaCallSites — super.method() (method_invocation)', () => {
  it('super.toString() → kind=super，callee=toString', async () => {
    const tmp = makeTempDir('java-extract-super-method');
    fs.writeFileSync(
      path.join(tmp, 'B.java'),
      [
        'class B extends Object {',
        '  public String toString() { return super.toString(); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const sup = findCallByCallee(result, 'toString');
    expect(sup).toBeDefined();
    expect(sup?.kind).toBe('super');
    expect(sup?.caller).toContain('B.toString');
  });
});

// ── 7. explicit_constructor_invocation: super() / this() in constructor ──

describe('extractJavaCallSites — explicit_constructor_invocation (super()/this())', () => {
  it('构造器内 super(arg) → kind=super, callee=super', async () => {
    const tmp = makeTempDir('java-extract-ctor-super');
    fs.writeFileSync(
      path.join(tmp, 'D.java'),
      [
        'class D extends Object {',
        '  D() { super(); }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const sup = findCallByCallee(result, 'super');
    expect(sup).toBeDefined();
    expect(sup?.kind).toBe('super');
    // constructor caller 形态：ClassName.<init>
    expect(sup?.caller).toMatch(/D\.<init>/);
  });

  it('构造器内 this(...) → kind=super, callee=this', async () => {
    const tmp = makeTempDir('java-extract-ctor-this');
    fs.writeFileSync(
      path.join(tmp, 'E.java'),
      [
        'class E {',
        '  E() { this(0); }',
        '  E(int x) { }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const sup = findCallByCallee(result, 'this');
    expect(sup).toBeDefined();
    expect(sup?.kind).toBe('super');
  });
});

// ── 8. unresolved: Class.forName / reflection (Codex Phase 4B CRITICAL #2 修订) ──

describe('extractJavaCallSites — unresolved reflection', () => {
  it('Class.forName(...) → kind=unresolved + dynamicReason="unresolved-reflection" (FR-009)', async () => {
    const tmp = makeTempDir('java-extract-refl');
    fs.writeFileSync(
      path.join(tmp, 'R.java'),
      [
        'class R {',
        '  void caller() throws Exception {',
        '    Class.forName("X");',
        '  }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const fn = findCallByCallee(result, 'forName');
    expect(fn).toBeDefined();
    // Codex Phase 4B CRITICAL #2: 反射 method 必须标 unresolved（FR-009 dynamic call 识别）
    expect(fn?.kind).toBe('unresolved');
  });

  it('Method.invoke(...) → kind=unresolved (反射 invoke)', async () => {
    const tmp = makeTempDir('java-extract-refl-invoke');
    fs.writeFileSync(
      path.join(tmp, 'R.java'),
      [
        'import java.lang.reflect.Method;',
        'class R {',
        '  void caller(Method m, Object obj) throws Exception {',
        '    m.invoke(obj);',
        '  }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const inv = findCallByCallee(result, 'invoke');
    expect(inv).toBeDefined();
    expect(inv?.kind).toBe('unresolved');
  });

  it('Class.getDeclaredMethod(...) → kind=unresolved', async () => {
    const tmp = makeTempDir('java-extract-refl-getmethod');
    fs.writeFileSync(
      path.join(tmp, 'R.java'),
      [
        'class R {',
        '  void caller(Class<?> c) throws Exception {',
        '    c.getDeclaredMethod("foo");',
        '  }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const m = findCallByCallee(result, 'getDeclaredMethod');
    expect(m).toBeDefined();
    expect(m?.kind).toBe('unresolved');
  });
});

// ── 9. parse-error / partial salvage ──

describe('extractJavaCallSites — parse-error skip', () => {
  it('语法错文件 → parse-error-partial warning，但 sibling 文件正常抽取', async () => {
    const tmp = makeTempDir('java-extract-parse-err');
    fs.writeFileSync(
      path.join(tmp, 'broken.java'),
      'class B { void m() { ;;; >>>> never close <<<<< ; ',
    );
    fs.writeFileSync(
      path.join(tmp, 'good.java'),
      ['class G {', '  void m() { ok(); }', '  void ok() {}', '}'].join('\n'),
    );

    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const ok = findCallByCallee(result, 'ok');
    expect(ok).toBeDefined();

    const parseErr = result.warnings.find((w) => /parse-error/.test(w.code));
    expect(parseErr).toBeDefined();
    expect(parseErr?.file).toMatch(/broken\.java$/);
  });

  it('空目录返回空 truthCalls + 空 warnings', async () => {
    const tmp = makeTempDir('java-extract-empty');
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    expect(result.truthCalls).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('不存在的 sourceRoot 抛错', async () => {
    await expect(
      extractJavaCallSites({ sourceRoot: '/non-existent-12345-path' }),
    ).rejects.toThrow(/不存在|sourceRoot/);
  });

  it('缺 sourceRoot 抛错', async () => {
    await expect(
      extractJavaCallSites({} as { sourceRoot: string }),
    ).rejects.toThrow(/sourceRoot/);
  });

  it('options 为 null 抛错', async () => {
    await expect(
      extractJavaCallSites(null as unknown as { sourceRoot: string }),
    ).rejects.toThrow(/options/);
  });
});

// ── 10. lambda scope: caller 归属嵌套 lambda ──

describe('extractJavaCallSites — lambda caller scope', () => {
  it('lambda 内的 method call → caller 是 <lambda:line:col>，不归属外层 method', async () => {
    const tmp = makeTempDir('java-extract-lambda');
    fs.writeFileSync(
      path.join(tmp, 'L.java'),
      [
        'import java.util.function.Function;',
        'class L {',
        '  void caller() {',
        '    Function<Integer, Integer> g = x -> doIt(x);',
        '  }',
        '  int doIt(int x) { return x; }',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const doIt = findCallByCallee(result, 'doIt');
    expect(doIt).toBeDefined();
    // 修订：lambda 内 callee 优先归属最近 lambda scope
    expect(doIt?.caller).toMatch(/<lambda:\d+:\d+>/);
  });
});

// ── 11. anonymous class scope ──

describe('extractJavaCallSites — anonymous class caller scope', () => {
  it('匿名类内 method 内调用 → caller 含 method 名 (无强制类名要求)', async () => {
    const tmp = makeTempDir('java-extract-anon');
    fs.writeFileSync(
      path.join(tmp, 'A.java'),
      [
        'class A {',
        '  void caller() {',
        '    Runnable r = new Runnable() {',
        '      public void run() { doIt(); }',
        '    };',
        '  }',
        '  void doIt() {}',
        '}',
      ].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const doIt = findCallByCallee(result, 'doIt');
    expect(doIt).toBeDefined();
    // 至少 caller 含 .run（method 名）
    expect(doIt?.caller).toMatch(/\.run/);
  });
});

// ── 12. metadata header (FR-014) ──

describe('extractJavaCallSites — metadata header', () => {
  it('options.baseline 存在时把 baseline 字段合入返回值', async () => {
    const tmp = makeTempDir('java-extract-meta');
    fs.writeFileSync(
      path.join(tmp, 'M.java'),
      'class M { void m() {} }',
    );
    const result = (await extractJavaCallSites({
      sourceRoot: tmp,
      baseline: {
        repo: 'brettwooldridge/HikariCP',
        commit: 'abc123',
        scope: 'src/main',
      },
    })) as ExtractResult;
    expect(result.baseline).toBeDefined();
    expect(result.baseline?.repo).toBe('brettwooldridge/HikariCP');
    expect(result.baseline?.commit).toBe('abc123');
    expect(result.baseline?.scope).toBe('src/main');
    expect(result.baseline?.extractorVersion).toBeTruthy();
    expect(result.baseline?.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── 13. POSIX path 归一 ──

describe('extractJavaCallSites — POSIX path normalization', () => {
  it('file 字段统一用 / 分隔（跨 OS byte-stable）', async () => {
    const tmp = makeTempDir('java-extract-path');
    const subDir = path.join(tmp, 'sub', 'pkg');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(subDir, 'Z.java'),
      ['class Z {', '  void m() { foo(); }', '  void foo() {}', '}'].join('\n'),
    );
    const result = (await extractJavaCallSites({ sourceRoot: tmp })) as ExtractResult;
    const fooCall = findCallByCallee(result, 'foo');
    expect(fooCall?.file).toBe('sub/pkg/Z.java');
    expect(fooCall?.file.includes('\\')).toBe(false);
  });
});

// ── 14. 内部分类函数直接覆盖（fallback / defensive 路径）──

describe('_javaNodeLine — direct unit', () => {
  it('node 缺 startPosition → 行号 1', () => {
    expect(_javaNodeLine({})).toBe(1);
  });
  it('node = null/undefined → 行号 1', () => {
    expect(_javaNodeLine(null)).toBe(1);
    expect(_javaNodeLine(undefined)).toBe(1);
  });
  it('正常 startPosition.row=4 → 行号 5 (1-based)', () => {
    expect(_javaNodeLine({ startPosition: { row: 4 } })).toBe(5);
  });
});

describe('_classifyMethodInvocation — direct unit', () => {
  it('object 是 super keyword → kind=super', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'super' };
        if (n === 'name') return { type: 'identifier', text: 'foo' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({ name: 'foo', kind: 'super' });
  });

  it('object 是 identifier → kind=method', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'obj' };
        if (n === 'name') return { type: 'identifier', text: 'foo' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({ name: 'foo', kind: 'method' });
  });

  it('无 object（裸调用）→ kind=method (interface default 内裸调用)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return null;
        if (n === 'name') return { type: 'identifier', text: 'spliterator' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({
      name: 'spliterator',
      kind: 'method',
    });
  });

  it('childForFieldName 不可用 → fallback', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: null,
      namedChildren: [],
    };
    expect(_classifyMethodInvocation(fake).name).toBe('<unknown>');
    expect(_classifyMethodInvocation(fake).kind).toBe('unresolved');
  });

  it('null 传入 → unresolved', () => {
    expect(_classifyMethodInvocation(null)).toEqual({
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-method-invocation',
    });
  });

  it('name 字段不存在 → unresolved', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: () => null,
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('unresolved');
  });

  // Codex Phase 4B CRITICAL #1: static call 区分
  it('object 是 type_identifier (Math) → kind=static', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'type_identifier', text: 'Math' };
        if (n === 'name') return { type: 'identifier', text: 'max' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({ name: 'max', kind: 'static' });
  });

  it('object 是 scoped_type_identifier (Outer.Inner) → kind=static', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'scoped_type_identifier', text: 'Outer.Inner' };
        if (n === 'name') return { type: 'identifier', text: 'staticMethod' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({ name: 'staticMethod', kind: 'static' });
  });

  it('object 是 identifier 且首字母大写 (Logger) → kind=static (Java 命名约定)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'Logger' };
        if (n === 'name') return { type: 'identifier', text: 'getLogger' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({ name: 'getLogger', kind: 'static' });
  });

  it('object 是 identifier 但小写 (instance) → kind=method (不被误判为 static)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'logger' };
        if (n === 'name') return { type: 'identifier', text: 'info' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({ name: 'info', kind: 'method' });
  });

  it('object 是 field_access (chain.foo) → kind=method (非 type identifier)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'field_access', text: 'this.field' };
        if (n === 'name') return { type: 'identifier', text: 'something' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({ name: 'something', kind: 'method' });
  });

  // Codex Phase 4B CRITICAL #2: 反射 unresolved
  it('Class.forName(...) (callee=forName) → kind=unresolved + dynamicReason=unresolved-reflection', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'type_identifier', text: 'Class' };
        if (n === 'name') return { type: 'identifier', text: 'forName' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake)).toEqual({
      name: 'forName',
      kind: 'unresolved',
      dynamicReason: 'unresolved-reflection',
    });
  });

  it('m.invoke(...) (callee=invoke) → kind=unresolved (反射)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'm' };
        if (n === 'name') return { type: 'identifier', text: 'invoke' };
        return null;
      },
    };
    const result = _classifyMethodInvocation(fake);
    expect(result.kind).toBe('unresolved');
    expect(result.dynamicReason).toBe('unresolved-reflection');
  });

  it('c.newInstance() (callee=newInstance) → kind=unresolved (反射)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'c' };
        if (n === 'name') return { type: 'identifier', text: 'newInstance' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('unresolved');
  });

  it('c.getDeclaredMethod(...) → kind=unresolved (反射查找)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'c' };
        if (n === 'name') return { type: 'identifier', text: 'getDeclaredMethod' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('unresolved');
  });

  it('object 是单字符大写 identifier (X) → kind=method (Round 2 修订: 单字符无小写 → 不算 PascalCase)', () => {
    // Round 2 CRITICAL #1: 单字符大写无 lowercase letter，按保守归到 instance method
    // (避免误把单字符变量/泛型参数当作类型)
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'X' };
        if (n === 'name') return { type: 'identifier', text: 'do' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  // Codex Round 2 CRITICAL #1: 全大写常量 (LOGGER, MAX_SIZE) 必须当作 instance, 不被误判为 static
  it('object 是 LOGGER (SCREAMING_SNAKE_CASE 常量) → kind=method (修复 HikariCP LOGGER 误判)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'LOGGER' };
        if (n === 'name') return { type: 'identifier', text: 'debug' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  it('object 是 MAX_SIZE (含下划线) → kind=method (常量, 非类型)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'MAX_SIZE' };
        if (n === 'name') return { type: 'identifier', text: 'compute' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  it('object 是 DB_URL (全大写带下划线) → kind=method', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'DB_URL' };
        if (n === 'name') return { type: 'identifier', text: 'split' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  // Codex Round 2 CRITICAL #2: field_access receiver 末段是 PascalCase → static (FQN/嵌套调用)
  it('field_access 末段是 PascalCase ("Outer.Inner") → kind=static (嵌套类型路径)', () => {
    // 模拟 Outer.Inner.foo() 在表达式上下文：
    //   method_invocation
    //     ├ object: field_access
    //     │   ├ object: identifier "Outer"
    //     │   └ field: identifier "Inner"
    //     └ name: "foo"
    const fieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'Outer' };
        if (n === 'field') return { type: 'identifier', text: 'Inner' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return fieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'foo' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('field_access 末段是小写 (instance.field.foo) → kind=method', () => {
    // obj.config.compute() 末段 "config" 小写 → instance method chain
    const fieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'obj' };
        if (n === 'field') return { type: 'identifier', text: 'config' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return fieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'compute' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  it('field_access 末段是 LOGGER (常量) → kind=method (this.LOGGER.debug())', () => {
    const fieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'this' };
        if (n === 'field') return { type: 'identifier', text: 'LOGGER' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return fieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'debug' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  // Codex Round 2 CRITICAL #3: 反射 set 扩充
  it('Class.getConstructor(...) → kind=unresolved (Round 2 反射扩充)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'c' };
        if (n === 'name') return { type: 'identifier', text: 'getConstructor' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('unresolved');
  });

  it('Class.getDeclaredConstructor(...) → kind=unresolved', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'c' };
        if (n === 'name') return { type: 'identifier', text: 'getDeclaredConstructor' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('unresolved');
  });

  it('Proxy.newProxyInstance(...) → kind=unresolved (动态代理)', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'type_identifier', text: 'Proxy' };
        if (n === 'name') return { type: 'identifier', text: 'newProxyInstance' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('unresolved');
  });

  // Codex Round 3 CRITICAL: acronym 类型 + FQN package detection
  it('UUID.randomUUID() (acronym 白名单) → kind=static', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'UUID' };
        if (n === 'name') return { type: 'identifier', text: 'randomUUID' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('URL.create() (acronym 白名单) → kind=static', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'URL' };
        if (n === 'name') return { type: 'identifier', text: 'create' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('XML.parse() (acronym 白名单) → kind=static', () => {
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'XML' };
        if (n === 'name') return { type: 'identifier', text: 'parse' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('LOGGER.debug() (常量, 不在 acronym 白名单) → kind=method (不被误判为 static)', () => {
    // 验证 LOGGER 不在 JAVA_ACRONYM_TYPE_NAMES 中，仍然是 method
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return { type: 'identifier', text: 'LOGGER' };
        if (n === 'name') return { type: 'identifier', text: 'debug' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  it('java.util.UUID.randomUUID() (FQN package walk) → kind=static', () => {
    // 模拟 java.util.UUID 树形：
    //   method_invocation
    //     ├ object: field_access (field=UUID)
    //     │   ├ object: field_access (field=util)
    //     │   │   ├ object: identifier "java"
    //     │   │   └ field: identifier "util"
    //     │   └ field: identifier "UUID"
    //     └ name: "randomUUID"
    const javaIdent = { type: 'identifier', text: 'java' };
    const javaUtilFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return javaIdent;
        if (n === 'field') return { type: 'identifier', text: 'util' };
        return null;
      },
    };
    const javaUtilUUIDFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return javaUtilFieldAccess;
        if (n === 'field') return { type: 'identifier', text: 'UUID' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return javaUtilUUIDFieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'randomUUID' };
        return null;
      },
    };
    // FQN walk 找到 leftmost "java" lowercase → 整条链是 FQN 类型 → static
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('com.foo.MYTYPE.method() (FQN + 自定义 acronym) → kind=static', () => {
    // 项目自定义全大写类型 (不在白名单) 但通过 FQN 包路径识别
    const comIdent = { type: 'identifier', text: 'com' };
    const comFooFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return comIdent;
        if (n === 'field') return { type: 'identifier', text: 'foo' };
        return null;
      },
    };
    const comFooMyTypeFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return comFooFieldAccess;
        if (n === 'field') return { type: 'identifier', text: 'MYTYPE' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return comFooMyTypeFieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'method' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('Foo.LOGGER.debug() (leftmost uppercase + 末段全大写) → kind=method (不算 FQN type)', () => {
    // Foo.LOGGER.debug() — Foo 是 PascalCase 类型，LOGGER 是 Foo 的常量字段
    // → 不应被误判为 static (因 leftmost "Foo" 不是 lowercase package)
    const fooIdent = { type: 'identifier', text: 'Foo' };
    const fooLoggerFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return fooIdent;
        if (n === 'field') return { type: 'identifier', text: 'LOGGER' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return fooLoggerFieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'debug' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  // Codex Round 4 CRITICAL: package-root 白名单 vs lowercase leftmost 启发式
  it('obj.foo.LOGGER.debug() (leftmost "obj" 不是包根) → kind=method', () => {
    // 关键回归测试：上轮 Round 3 的 lowercase leftmost 启发式会误判这种形态为 static
    // Round 4 修复：用 JAVA_PACKAGE_ROOT_NAMES 白名单 (java/javax/com/org/...) 替换
    const objIdent = { type: 'identifier', text: 'obj' };
    const objFooFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return objIdent;
        if (n === 'field') return { type: 'identifier', text: 'foo' };
        return null;
      },
    };
    const objFooLoggerFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return objFooFieldAccess;
        if (n === 'field') return { type: 'identifier', text: 'LOGGER' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return objFooLoggerFieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'debug' };
        return null;
      },
    };
    // obj 不在 JAVA_PACKAGE_ROOT_NAMES → 非 FQN 类型路径 → method
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  it('javax.servlet.ServletContext.method() (jakarta package root) → kind=static', () => {
    const javaxIdent = { type: 'identifier', text: 'javax' };
    const javaxServletFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return javaxIdent;
        if (n === 'field') return { type: 'identifier', text: 'servlet' };
        return null;
      },
    };
    // 末段已经是 PascalCase ("ServletContext")，会走 Path 1 (无需 Round 4 fix)
    // 但为了完整性测试 javax 包根识别
    const fullPath = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return javaxServletFieldAccess;
        if (n === 'field') return { type: 'identifier', text: 'ServletContext' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return fullPath;
        if (n === 'name') return { type: 'identifier', text: 'method' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('com.LOGGER.debug() (链长 < 3) → kind=method (避免短链误判)', () => {
    // segments=[com, LOGGER]，长度 2 < 3 → 不符合"包路径.类型"形态
    const comIdent = { type: 'identifier', text: 'com' };
    const comLoggerFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return comIdent;
        if (n === 'field') return { type: 'identifier', text: 'LOGGER' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return comLoggerFieldAccess;
        if (n === 'name') return { type: 'identifier', text: 'debug' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });

  it('com.foo.MyType.method() (PascalCase 末段, 走 Path 1) → kind=static', () => {
    // 验证 Round 3 PascalCase 末段路径仍然工作
    const comIdent = { type: 'identifier', text: 'com' };
    const comFooFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return comIdent;
        if (n === 'field') return { type: 'identifier', text: 'foo' };
        return null;
      },
    };
    const fullPath = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return comFooFieldAccess;
        if (n === 'field') return { type: 'identifier', text: 'MyType' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return fullPath;
        if (n === 'name') return { type: 'identifier', text: 'method' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('static');
  });

  it('com.MIXED_case.MYTYPE (中间段含大写 → 不是包) → kind=method', () => {
    // segments=[com, MIXED_case, MYTYPE]
    // packageSegments=[com, MIXED_case]，"MIXED_case" 不匹配 ^[a-z][a-z0-9_]*$
    // → 非 FQN 包路径 → method
    const comIdent = { type: 'identifier', text: 'com' };
    const middleFieldAccess = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return comIdent;
        if (n === 'field') return { type: 'identifier', text: 'MIXED_case' };
        return null;
      },
    };
    const fullPath = {
      type: 'field_access',
      childForFieldName: (n: string) => {
        if (n === 'object') return middleFieldAccess;
        if (n === 'field') return { type: 'identifier', text: 'MYTYPE' };
        return null;
      },
    };
    const fake = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'object') return fullPath;
        if (n === 'name') return { type: 'identifier', text: 'method' };
        return null;
      },
    };
    expect(_classifyMethodInvocation(fake).kind).toBe('method');
  });
});

describe('_classifyObjectCreation — direct unit', () => {
  it('type=type_identifier → kind=constructor，callee 是 type 名', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') return { type: 'type_identifier', text: 'Foo' };
        return null;
      },
    };
    expect(_classifyObjectCreation(fake)).toEqual({ name: 'Foo', kind: 'constructor' });
  });

  it('type=generic_type → 拆出内层 type_identifier 作 callee', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') {
          return {
            type: 'generic_type',
            namedChildren: [{ type: 'type_identifier', text: 'ArrayList' }],
          };
        }
        return null;
      },
    };
    expect(_classifyObjectCreation(fake)).toEqual({
      name: 'ArrayList',
      kind: 'constructor',
    });
  });

  it('null → unresolved', () => {
    expect(_classifyObjectCreation(null)).toEqual({
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-object-creation',
    });
  });

  it('type 字段不存在 → unresolved', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: () => null,
    };
    expect(_classifyObjectCreation(fake).kind).toBe('unresolved');
  });

  it('childForFieldName 不可用 → unresolved', () => {
    const fake = { type: 'object_creation_expression', childForFieldName: null };
    expect(_classifyObjectCreation(fake).kind).toBe('unresolved');
  });

  it('generic_type 没 type_identifier 内部 → 退回 generic_type.text', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') {
          return { type: 'generic_type', namedChildren: [], text: 'Weird' };
        }
        return null;
      },
    };
    expect(_classifyObjectCreation(fake).name).toBe('Weird');
  });

  it('generic_type namedChildren 非数组 → 退回 generic_type.text', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') {
          return { type: 'generic_type', namedChildren: undefined, text: 'NoArr' };
        }
        return null;
      },
    };
    expect(_classifyObjectCreation(fake).name).toBe('NoArr');
  });

  it('generic_type 没 type_identifier 也没 text → unresolved', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') {
          return { type: 'generic_type', namedChildren: [] }; // 无 text
        }
        return null;
      },
    };
    expect(_classifyObjectCreation(fake).kind).toBe('unresolved');
  });

  // Codex Phase 4B WARNING #3 修订：scoped_type_identifier (Outer.Inner / a.b.C)
  // 必须 normalize 到末尾段，与 graph 的 label-only 节点对齐
  it('scoped_type_identifier "a.b.C" → callee=C (末段, WARNING #3 修订)', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') return { type: 'scoped_type_identifier', text: 'a.b.C' };
        return null;
      },
    };
    expect(_classifyObjectCreation(fake)).toEqual({
      name: 'C',
      kind: 'constructor',
    });
  });

  it('scoped_type_identifier "Outer.Inner" → callee=Inner (末段)', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') return { type: 'scoped_type_identifier', text: 'Outer.Inner' };
        return null;
      },
    };
    expect(_classifyObjectCreation(fake).name).toBe('Inner');
  });

  it('未知 type kind 但有 text "x.y" → fallback 用 text 末段', () => {
    // _normalizeJavaTypeName 对所有有 text 分支统一应用
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') return { type: 'unknown_kind', text: 'pkg.Foo' };
        return null;
      },
    };
    expect(_classifyObjectCreation(fake).name).toBe('Foo');
  });

  it('type_identifier 但 text 不是 string → fallback 通过 unrecognized', () => {
    const fake = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => {
        if (n === 'type') return { type: 'type_identifier' }; // 无 text
        return null;
      },
    };
    expect(_classifyObjectCreation(fake).kind).toBe('unresolved');
  });
});

describe('_classifyExplicitConstructorInvocation — direct unit', () => {
  it('constructor=super → callee=super, kind=super', () => {
    const fake = {
      type: 'explicit_constructor_invocation',
      childForFieldName: (n: string) => {
        if (n === 'constructor') return { type: 'super', text: 'super' };
        return null;
      },
    };
    expect(_classifyExplicitConstructorInvocation(fake)).toEqual({
      name: 'super',
      kind: 'super',
    });
  });

  it('constructor=this → callee=this, kind=super', () => {
    const fake = {
      type: 'explicit_constructor_invocation',
      childForFieldName: (n: string) => {
        if (n === 'constructor') return { type: 'this', text: 'this' };
        return null;
      },
    };
    expect(_classifyExplicitConstructorInvocation(fake)).toEqual({
      name: 'this',
      kind: 'super',
    });
  });

  it('null → unresolved', () => {
    expect(_classifyExplicitConstructorInvocation(null)).toEqual({
      name: '<unknown>',
      kind: 'unresolved',
      dynamicReason: 'missing-explicit-constructor',
    });
  });

  it('constructor 字段缺 → unresolved', () => {
    const fake = {
      type: 'explicit_constructor_invocation',
      childForFieldName: () => null,
    };
    expect(_classifyExplicitConstructorInvocation(fake).kind).toBe('unresolved');
  });

  it('childForFieldName 不可用 → unresolved', () => {
    const fake = {
      type: 'explicit_constructor_invocation',
      childForFieldName: null,
    };
    expect(_classifyExplicitConstructorInvocation(fake).kind).toBe('unresolved');
  });

  it('constructor 字段 type 既非 super 也非 this → unresolved + dynamicReason', () => {
    const fake = {
      type: 'explicit_constructor_invocation',
      childForFieldName: (n: string) => {
        if (n === 'constructor') return { type: 'identifier', text: 'weird' };
        return null;
      },
    };
    const result = _classifyExplicitConstructorInvocation(fake);
    expect(result.kind).toBe('unresolved');
    expect(result.name).toBe('weird');
    expect(result.dynamicReason).toBe('unrecognized-explicit-constructor-kind');
  });

  it('constructor 字段 type 不识别且无 text → name=<unknown>', () => {
    const fake = {
      type: 'explicit_constructor_invocation',
      childForFieldName: (n: string) => {
        if (n === 'constructor') return { type: 'identifier' }; // 无 text
        return null;
      },
    };
    expect(_classifyExplicitConstructorInvocation(fake).name).toBe('<unknown>');
  });
});

describe('_resolveJavaCaller — direct unit', () => {
  it('node.parent=null → <top-level>', () => {
    expect(_resolveJavaCaller({ parent: null }, 'a.java')).toBe('a.java:<top-level>');
  });

  it('在 method_declaration 内 → <file>:Class.method', () => {
    const classDecl = {
      type: 'class_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'Foo' } : null,
      parent: null,
    };
    const classBody = { type: 'class_body', parent: classDecl };
    classDecl.parent = null;
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'bar' } : null,
      parent: classBody,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:Foo.bar');
  });

  it('在 constructor_declaration 内 → <file>:Class.<init>', () => {
    const classDecl = {
      type: 'class_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'Foo' } : null,
      parent: null,
    };
    const classBody = { type: 'class_body', parent: classDecl };
    const ctorDecl = {
      type: 'constructor_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'Foo' } : null,
      parent: classBody,
    };
    const callNode = { parent: ctorDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:Foo.<init>');
  });

  it('在 lambda_expression 内 → <file>:<lambda:line:col>', () => {
    const lambda = {
      type: 'lambda_expression',
      parent: null,
      startPosition: { row: 4, column: 12 },
    };
    const callNode = { parent: lambda };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe(
      'x.java:<lambda:5:12>',
    );
  });

  it('method_declaration 缺 name 字段 → <anon-method>', () => {
    const classDecl = {
      type: 'class_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'A' } : null,
      parent: null,
    };
    const classBody = { type: 'class_body', parent: classDecl };
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: () => null,
      parent: classBody,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:A.<anon-method>');
  });

  it('method_declaration 没有外层 class → 仅 method 名（无 className 前缀）', () => {
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'lone' } : null,
      parent: null,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:lone');
  });

  it('在 interface_declaration body 内 method → <file>:Iface.method', () => {
    const ifaceDecl = {
      type: 'interface_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'Iface' } : null,
      parent: null,
    };
    const ifaceBody = { type: 'interface_body', parent: ifaceDecl };
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'run' } : null,
      parent: ifaceBody,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:Iface.run');
  });

  it('class_declaration 缺 name → <anon-class>', () => {
    const classDecl = {
      type: 'class_declaration',
      childForFieldName: () => null,
      parent: null,
    };
    const classBody = { type: 'class_body', parent: classDecl };
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'm' } : null,
      parent: classBody,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:<anon-class>.m');
  });

  it('class_declaration childForFieldName 不可用 → <anon-class>', () => {
    const classDecl = {
      type: 'class_declaration',
      childForFieldName: null,
      parent: null,
    };
    const classBody = { type: 'class_body', parent: classDecl };
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'm' } : null,
      parent: classBody,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:<anon-class>.m');
  });

  it('method_declaration childForFieldName 不可用 → <anon-method>', () => {
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: null,
      parent: null,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:<anon-method>');
  });

  it('constructor_declaration 无外层 class → <init> (无 className 前缀)', () => {
    const ctorDecl = {
      type: 'constructor_declaration',
      childForFieldName: () => null,
      parent: null, // 没有外层 class_body / class_declaration
    };
    const callNode = { parent: ctorDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:<init>');
  });

  it('lambda_expression 缺 startPosition.column → 默认 0', () => {
    const lambda = {
      type: 'lambda_expression',
      parent: null,
      startPosition: { row: 7 }, // 没有 column 字段
    };
    const callNode = { parent: lambda };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:<lambda:8:0>');
  });

  it('node 为 null → <top-level>', () => {
    expect(_resolveJavaCaller(null, 'x.java')).toBe('x.java:<top-level>');
  });

  it('object_creation_expression 上找到 → <anon-class> (匿名类内 method)', () => {
    const objCreate = { type: 'object_creation_expression', parent: null };
    const classBody = { type: 'class_body', parent: objCreate };
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'run' } : null,
      parent: classBody,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:<anon-class>.run');
  });

  it('enum_declaration 内 method → <file>:Enum.method', () => {
    const enumDecl = {
      type: 'enum_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'E' } : null,
      parent: null,
    };
    const enumBody = { type: 'enum_body', parent: enumDecl };
    const methodDecl = {
      type: 'method_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'name' } : null,
      parent: enumBody,
    };
    const callNode = { parent: methodDecl };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:E.name');
  });

  // Codex Phase 4B WARNING #1 修订：record types (Java 14+) compact constructor
  it('在 record 的 compact_constructor_declaration 内 → <file>:Record.<init>', () => {
    const recordDecl = {
      type: 'record_declaration',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'Point' } : null,
      parent: null,
    };
    const classBody = { type: 'class_body', parent: recordDecl };
    const compactCtor = {
      type: 'compact_constructor_declaration',
      parent: classBody,
    };
    const callNode = { parent: compactCtor };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:Point.<init>');
  });

  it('compact_constructor_declaration 无外层 record → <init> (无 className 前缀)', () => {
    const compactCtor = {
      type: 'compact_constructor_declaration',
      parent: null,
    };
    const callNode = { parent: compactCtor };
    expect(_resolveJavaCaller(callNode, 'x.java')).toBe('x.java:<init>');
  });
});

describe('_walkJavaAst — direct unit (fake AST)', () => {
  it('ERROR 节点跳过子树（不抽 phantom call）', () => {
    const callExpr = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'identifier', text: 'phantom' };
        return null;
      },
      startPosition: { row: 0 },
      parent: null,
      hasError: false,
      namedChildren: [],
    };
    const errorNode = {
      type: 'ERROR',
      namedChildren: [callExpr],
      parent: null,
    };
    callExpr.parent = errorNode;
    const root = { type: 'program', namedChildren: [errorNode] };
    errorNode.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items).toHaveLength(0);
  });

  it('phantom call (callee hasError) → skip 抽取，但 children 仍 walk', () => {
    // 模拟：method_invocation 含 args 内嵌套真实 call，但自己的 callee.hasError=true
    const innerCall = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'name') return { type: 'identifier', text: 'real' };
        return null;
      },
      startPosition: { row: 1 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const outerName = { type: 'identifier', text: 'broken', hasError: true };
    const outerCall = {
      type: 'method_invocation',
      childForFieldName: (n: string) => {
        if (n === 'name') return outerName;
        return null;
      },
      startPosition: { row: 0 },
      hasError: true,
      parent: null,
      namedChildren: [innerCall],
      children: [outerName, innerCall],
    };
    innerCall.parent = outerCall;
    const root = { type: 'program', namedChildren: [outerCall] };
    outerCall.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    // outer phantom 抽不进，inner 真实 call 仍抽
    expect(truthBuf.items).toHaveLength(1);
    expect(truthBuf.items[0].callee).toBe('real');
  });

  it('phantom (sibling ERROR) → skip 抽取', () => {
    const name = { type: 'identifier', text: 'foo' };
    const errSibling = { type: 'ERROR' };
    const callExpr = {
      type: 'method_invocation',
      childForFieldName: (n: string) => (n === 'name' ? name : null),
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [],
      children: [name, errSibling],
    };
    const root = { type: 'program', namedChildren: [callExpr] };
    callExpr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items).toHaveLength(0);
  });

  it('object_creation phantom → skip', () => {
    const typeNode = { type: 'type_identifier', text: 'Foo', hasError: true };
    const errSibling = { type: 'ERROR' };
    const objExpr = {
      type: 'object_creation_expression',
      childForFieldName: (n: string) => (n === 'type' ? typeNode : null),
      startPosition: { row: 0 },
      hasError: true,
      parent: null,
      namedChildren: [typeNode],
      children: [typeNode, errSibling],
    };
    const root = { type: 'program', namedChildren: [objExpr] };
    objExpr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items).toHaveLength(0);
  });

  it('node 缺 namedChildren → 不入栈', () => {
    const root = { type: 'program', namedChildren: undefined, parent: null };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items).toEqual([]);
  });

  it('MISSING 节点跳过子树', () => {
    const callExpr = {
      type: 'method_invocation',
      childForFieldName: (n: string) =>
        n === 'name' ? { type: 'identifier', text: 'foo' } : null,
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const missing = {
      type: 'method_invocation',
      isMissing: true,
      namedChildren: [callExpr],
      parent: null,
    };
    callExpr.parent = missing;
    const root = { type: 'program', namedChildren: [missing] };
    missing.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items).toHaveLength(0);
  });

  it('method_invocation 缺 name 字段 → unresolved 且 warnings 含 unresolved-reflection', () => {
    const callExpr = {
      type: 'method_invocation',
      childForFieldName: () => null, // 无 name 字段
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const root = { type: 'program', namedChildren: [callExpr] };
    callExpr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items).toHaveLength(1);
    expect(truthBuf.items[0].kind).toBe('unresolved');
    expect(warnings.items[0].code).toBe('unresolved-reflection');
  });

  it('object_creation 缺 type 字段 → unresolved + warnings', () => {
    const objExpr = {
      type: 'object_creation_expression',
      childForFieldName: () => null,
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const root = { type: 'program', namedChildren: [objExpr] };
    objExpr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items[0].kind).toBe('unresolved');
    expect(warnings.items[0].code).toBe('unresolved-reflection');
  });

  it('explicit_constructor_invocation type 非 super/this → unresolved + warnings', () => {
    const ctorNode = { type: 'identifier', text: 'weird' };
    const expr = {
      type: 'explicit_constructor_invocation',
      childForFieldName: (n: string) => (n === 'constructor' ? ctorNode : null),
      startPosition: { row: 0 },
      hasError: false,
      parent: null,
      namedChildren: [],
    };
    const root = { type: 'program', namedChildren: [expr] };
    expr.parent = root;

    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items[0].kind).toBe('unresolved');
    expect(warnings.items[0].code).toBe('unresolved-reflection');
  });

  it('stack 中含 null/undefined 节点 → 跳过（防御）', () => {
    const root = {
      type: 'program',
      namedChildren: [null as unknown as object, undefined as unknown as object],
      parent: null,
    };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _walkJavaAst(root, 'x.java', truthBuf, warnings);
    expect(truthBuf.items).toEqual([]);
    expect(warnings.items).toEqual([]);
  });
});

describe('_processOneJavaFile — read / parse error', () => {
  it('文件不存在 → ENOENT → warnings.code=parse-error', async () => {
    const tmp = makeTempDir('java-process-readfail');
    const { parser } = await loadTreeSitterGrammar('java');
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();

    _processOneJavaFile(
      parser,
      path.join(tmp, '__no_such_file__.java'),
      '__no_such_file__.java',
      truthBuf,
      warnings,
    );

    expect(truthBuf.items).toEqual([]);
    expect(warnings.items.length).toBe(1);
    expect(warnings.items[0].code).toBe('parse-error');
    expect(warnings.items[0].message).toMatch(/ENOENT|extract-error/);
  });

  it('parser.parse throw → warnings.code=parse-error', async () => {
    const tmp = makeTempDir('java-process-parsefail');
    const filePath = path.join(tmp, 'a.java');
    fs.writeFileSync(filePath, 'class A {}');
    const fakeParser = {
      parse: () => {
        throw new Error('mock-parse-throw');
      },
    };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _processOneJavaFile(fakeParser, filePath, 'a.java', truthBuf, warnings);
    expect(warnings.items[0].code).toBe('parse-error');
    expect(warnings.items[0].message).toContain('mock-parse-throw');
  });

  it('hasError=true → warnings 含 parse-error-partial 但仍尝试 walk', async () => {
    const tmp = makeTempDir('java-process-haserror');
    const filePath = path.join(tmp, 'broken.java');
    fs.writeFileSync(filePath, 'class B { void m() { ;;; >>>>; ');
    const { parser } = await loadTreeSitterGrammar('java');
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _processOneJavaFile(parser, filePath, 'broken.java', truthBuf, warnings);
    const partial = warnings.items.find((w) => w.code === 'parse-error-partial');
    expect(partial).toBeDefined();
  });

  it('parser.parse throw 非 Error 对象 → warnings.message 用 String(err)', async () => {
    const tmp = makeTempDir('java-process-non-err');
    const filePath = path.join(tmp, 'a.java');
    fs.writeFileSync(filePath, 'class A {}');
    const fakeParser = {
      parse: () => {
        // throw a plain string, not an Error instance — goes through the
        // String(err) fallback (line 511 branch coverage)
        throw 'plain-string-thrown';
      },
    };
    const truthBuf: { items: TruthCall[] } = { items: [] };
    const warnings = createWarningsArray();
    _processOneJavaFile(fakeParser, filePath, 'a.java', truthBuf, warnings);
    expect(warnings.items[0].code).toBe('parse-error');
    expect(warnings.items[0].message).toContain('plain-string-thrown');
  });
});
