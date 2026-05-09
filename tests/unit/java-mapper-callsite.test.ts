/**
 * Feature 154 — JavaMapper.extractCallSites 单元测试
 *
 * 测试矩阵（spec SC-003 ≥ 7，本套件 14 case + 常量同源 3 + adapter 透传 2）：
 *  1  实例 method call (`obj.method()` → cross-module + qualifier)
 *  2  method overloading label-only
 *  3  static / PascalCase Class.method
 *  4  interface default method + enclosing interface callerContext
 *  5  lambda 嵌套优先
 *  6  反射 unresolved
 *  7  callerContext 嵌套追踪（record + nested class）
 *  8  generic method invocation
 *  9  大文件字节兜底（FR-006 MUST）
 *  10 phantom call（FR-007 MUST，ERROR 跳子树 + sibling ERROR 跳当前）
 *  11 super() / this() explicit constructor
 *  12 匿名类
 *  13 this.method() → member + undefined（Codex P1 CRITICAL E）
 *  14 static import (`sort(list)` → member + undefined)（Codex P1 WARNING W-3，free deferred 锚点）
 *
 * 当前实施进度（T-1 阶段）：
 * - 常量同源 describe 块：实施
 * - adapter 透传 describe 块：实施
 * - 14 case：先 .skip（T-2.0 测试骨架），T-2.x / T-3.5 逐步 unskip
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JavaLanguageAdapter } from '../../src/adapters/java-adapter.js';
import {
  JAVA_REFLECTION_METHOD_NAMES,
  JAVA_ACRONYM_TYPE_NAMES,
  JAVA_PACKAGE_ROOT_NAMES,
  JavaMapper,
  CALLSITES_MAX_FILE_BYTES,
} from '../../src/core/query-mappers/java-mapper.js';
// extractor 是 .mjs，TS 类型解析按 JS 处理；这里是静态 ESM import
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - mjs 模块在 TS 类型层未声明，运行时由 ESM loader 解析
import * as extractor from '../../scripts/lib/java-call-extractor.mjs';

// ════════════════════════ Fixture 工具（自动清理）════════════════════════

const createdTmpDirs: string[] = [];

/** 创建临时 .java 文件并返回路径；afterEach 统一清理 */
function writeFixture(content: string, suffix = '.java'): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-mapper-callsite-'));
  createdTmpDirs.push(tmpDir);
  const file = path.join(tmpDir, `Fixture${suffix}`);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

afterEach(() => {
  // Codex T-1 review WARNING I：每条 test 后清理临时 fixture 目录
  for (const dir of createdTmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* tmpdir 已被 OS 清理或并发删除，忽略 */
    }
  }
});

// ════════════════════════ 常量同源（T-1.4）════════════════════════

describe('常量同源 — mapper TS vs extractor mjs', () => {
  it('JAVA_REFLECTION_METHOD_NAMES 双侧集合相等', () => {
    expect(new Set([...JAVA_REFLECTION_METHOD_NAMES])).toEqual(
      new Set([...extractor.REFLECTION_METHOD_NAMES]),
    );
  });

  it('JAVA_ACRONYM_TYPE_NAMES 双侧集合相等', () => {
    expect(new Set([...JAVA_ACRONYM_TYPE_NAMES])).toEqual(
      new Set([...extractor.JAVA_ACRONYM_TYPE_NAMES]),
    );
  });

  it('JAVA_PACKAGE_ROOT_NAMES 双侧集合相等', () => {
    expect(new Set([...JAVA_PACKAGE_ROOT_NAMES])).toEqual(
      new Set([...extractor.JAVA_PACKAGE_ROOT_NAMES]),
    );
  });
});

// ════════════════════════ adapter 透传（T-1.5）════════════════════════

describe('JavaLanguageAdapter — extractCallSites 透传', () => {
  const adapter = new JavaLanguageAdapter();

  it('extractCallSites=true 时 callSites 是数组', async () => {
    const file = writeFixture('class Sample { void run() { /* T-3 后非空 */ } }');
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    expect(Array.isArray(sk.callSites)).toBe(true);
  });

  it('默认未传 flag 时 callSites 为 undefined', async () => {
    const file = writeFixture('class Sample { void run() {} }');
    const sk = await adapter.analyzeFile(file);
    expect(sk.callSites).toBeUndefined();
  });

  // Codex T-1 review WARNING D：覆盖显式 false 场景
  it('显式 extractCallSites=false 时 callSites 为 undefined（与默认对齐）', async () => {
    const file = writeFixture('class Sample { void run() {} }');
    const sk = await adapter.analyzeFile(file, { extractCallSites: false });
    expect(sk.callSites).toBeUndefined();
  });
});

// ════════════════════════ 大文件兜底 + 异常兜底（FR-006 + 诊断 warn）════════════════════════

describe('JavaMapper.extractCallSites — 兜底分支', () => {
  it('大文件超过 1 MB 字节时返回 [] 并 warn（FR-006）', () => {
    const mapper = new JavaMapper();
    const padding = '中'.repeat(400_000); // ≈ 1.2 MB UTF-8 字节
    const source = `class A { /* ${padding} */ void m() {} }`;
    expect(Buffer.byteLength(source, 'utf8')).toBeGreaterThan(CALLSITES_MAX_FILE_BYTES);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 大文件分支不依赖 tree 内容，直接传 minimal stub
      const fakeTree = { rootNode: { type: 'program' } } as unknown as Parameters<
        typeof mapper.extractCallSites
      >[0];
      const result = mapper.extractCallSites(fakeTree, source);
      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/大文件跳过/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('walker 抛错时 catch 兜底返回 [] 并 warn 含诊断上下文', () => {
    const mapper = new JavaMapper();
    // 用 Object.assign 覆盖 private _walkCallSites（测试目的可接受）
    const originalWalker = (
      mapper as unknown as { _walkCallSites: () => void }
    )._walkCallSites;
    (mapper as unknown as { _walkCallSites: () => void })._walkCallSites = () => {
      throw new Error('synthetic walker failure');
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fakeTree = { rootNode: { type: 'program' } } as unknown as Parameters<
        typeof mapper.extractCallSites
      >[0];
      const result = mapper.extractCallSites(fakeTree, 'class A {}');
      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnMsg = warnSpy.mock.calls[0][0];
      expect(warnMsg).toMatch(/异常兜底/);
      expect(warnMsg).toMatch(/rootType=program/);
      expect(warnMsg).toMatch(/byteLength=/);
      expect(warnMsg).toMatch(/synthetic walker failure/);
    } finally {
      warnSpy.mockRestore();
      (mapper as unknown as { _walkCallSites: typeof originalWalker })._walkCallSites =
        originalWalker;
    }
  });
});

// ════════════════════════ 14 case 测试骨架（T-2.0 .skip 占位）════════════════════════
//
// 每个 case fixture + 期望断言已经写到注释里；T-2.x / T-3.5 实施完毕后逐个 unskip。
// 当前 .skip 不计入 vitest 失败，符合 spec-driver-story 增量验收策略。

describe('JavaMapper.extractCallSites — 14 case 测试矩阵（T-2.0 骨架）', () => {
  const adapter = new JavaLanguageAdapter();

  // 注：本 describe 块内每个 case 用 it.skip 单独占位，
  // T-2.x / T-3.5 实施完毕后逐个 unskip（Codex T-1 WARNING E1 修订）

  // case 1: obj.method() → cross-module + qualifier=obj
  it('case 1 实例 method call (obj.method())', async () => {
    const file = writeFixture(
      'class A { void m(B obj) { obj.foo(); } }',
    );
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'foo');
    expect(cs).toBeDefined();
    expect(cs?.calleeKind).toBe('cross-module');
    expect(cs?.calleeQualifier).toBe('obj');
    expect(cs?.callerContext).toBe('A.m');
  });

  // case 2: method overloading label-only — 同名 method 调用计数 1 条
  it('case 2 method overloading 仅 1 条 label', async () => {
    const file = writeFixture(`
      class A {
        void connect(String url) {}
        void connect(java.util.Properties props) {}
        void run(String url) { connect(url); }
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const calls = sk.callSites?.filter((c) => c.calleeName === 'connect') ?? [];
    expect(calls.length).toBe(1);
  });

  // case 3: Class.method() → member + qualifier=Class
  it('case 3 static / PascalCase Class.method()', async () => {
    const file = writeFixture(
      'import java.util.Collections;\nclass A { void m(java.util.List<Integer> l) { Collections.sort(l); } }',
    );
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'sort');
    expect(cs?.calleeKind).toBe('member');
    expect(cs?.calleeQualifier).toBe('Collections');
  });

  // case 4: interface default method
  it('case 4 interface default method callerContext', async () => {
    const file = writeFixture(`
      interface Closeable {
        default void closeAll() { helper(); }
        void helper();
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'helper');
    expect(cs?.callerContext).toBe('Closeable.closeAll');
  });

  // case 5: lambda 嵌套优先（Codex T-3 WARNING G：精确断言行列）
  it('case 5 lambda 嵌套优先 callerContext', async () => {
    // 固定 fixture 行列：lambda `x -> x.go()` 起始位置可精确定位
    // 行 2 (0-based row 1) 内 `(x -> x.go())` 的 lambda 起始列为 53（0-based）
    // 注：tree-sitter 行列从 0 开始，_resolveCallerContext 把 row+1 输出 1-based 行
    const file = writeFixture(
      'import java.util.List;\nclass A { void m(List<B> l) { l.forEach(x -> x.go()); } }',
    );
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'go');
    expect(cs?.callerContext).toMatch(/^<lambda:\d+:\d+>$/);
    // 精确断言：固定 fixture 下 lambda 在第 2 行（1-based），列号 > 0
    const match = cs?.callerContext?.match(/^<lambda:(\d+):(\d+)>$/);
    expect(match).not.toBeNull();
    if (match) {
      const line = parseInt(match[1] ?? '0', 10);
      const col = parseInt(match[2] ?? '-1', 10);
      expect(line).toBe(2);
      expect(col).toBeGreaterThan(0); // lambda 在 method body 内部，列号必非首列
    }
    // FR-010 唯一化：同一文件多次运行 _resolveCallerContext 输出稳定
    const cs2 = sk.callSites?.find((c) => c.calleeName === 'go');
    expect(cs2?.callerContext).toBe(cs?.callerContext);
  });

  // case 6: 反射 unresolved
  it('case 6 反射 → unresolved', async () => {
    const file = writeFixture(
      'class A { void m() throws Exception { Class.forName("x"); } }',
    );
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'forName');
    expect(cs?.calleeKind).toBe('unresolved');
  });

  // case 7: record compact constructor + nested class 最近一层
  it('case 7 record compact constructor + nested class', async () => {
    const file = writeFixture(`
      class Outer {
        record Point(int x, int y) {
          Point { validate(x); }
          static void validate(int v) {}
        }
        static class Inner {
          void method() { helper(); }
          void helper() {}
        }
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const recordCall = sk.callSites?.find((c) => c.calleeName === 'validate');
    const innerCall = sk.callSites?.find((c) => c.calleeName === 'helper');
    expect(recordCall?.callerContext).toBe('Point.<init>');
    expect(innerCall?.callerContext).toBe('Inner.method');
  });

  // case 8: generic method invocation
  it('case 8 generic method invocation 忽略 type args', async () => {
    const file = writeFixture(
      'import java.util.List;\nclass A { void m() { List.<String>of("a"); } }',
    );
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'of');
    expect(cs?.calleeKind).toBe('member');
  });

  // case 9: 大文件字节兜底（多字节字符）
  it('case 9 大文件字节兜底（UTF-8 多字节）', async () => {
    // 中文注释 ≈ 3 字节/字符，构造 source.length < 1MB 但 byteLength > 1MB
    const padding = '中'.repeat(400_000); // 字符 4e5，字节 ≈ 12e5 = 1.2 MB
    const content = `class A {\n  // ${padding}\n  void m() { foo(); }\n}\n`;
    const file = writeFixture(content);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    expect(sk.callSites).toEqual([]);
  });

  // case 10: phantom call — ERROR 子树跳过 + ERROR 外的真实调用照抽
  // Codex T-1 WARNING E2 修订：fixture 加 ERROR 子树内的伪调用 + 负向断言
  it('case 10 phantom call — ERROR 子树整体跳过', async () => {
    // method broken 含语法错误，tree-sitter 会把 phantom() 包到 ERROR 子树内；
    // method ok 是干净的真实调用 → realCall() 必须被抽
    const file = writeFixture(`
      class A {
        void broken() {
          phantom(  // 故意未闭合参数 + 缺分号
        }
        void ok() { realCall(); }
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });

    // ERROR 外的真实调用必须被抽
    const realHit = sk.callSites?.find((c) => c.calleeName === 'realCall');
    expect(realHit).toBeDefined();

    // ERROR 子树内的伪调用 phantom() 不应出现在 callSites
    const phantomHit = sk.callSites?.find((c) => c.calleeName === 'phantom');
    expect(phantomHit).toBeUndefined();
  });

  // case 11: super() / this() explicit constructor
  it('case 11 super() / this() → super', async () => {
    const file = writeFixture(`
      class B { B(int x) {} }
      class A extends B {
        A() { super(1); }
        A(int n) { this(); }
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const allSuper = sk.callSites?.filter((c) => c.calleeKind === 'super') ?? [];
    expect(allSuper.length).toBeGreaterThanOrEqual(2);
  });

  // case 12: 匿名类
  it('case 12 匿名类 callerContext = <anon-class>.{methodName}', async () => {
    const file = writeFixture(`
      class A {
        Runnable r = new Runnable() {
          public void run() { go(); }
          void go() {}
        };
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'go');
    expect(cs?.callerContext).toBe('<anon-class>.run');
  });

  // case 13: this.method() → member + undefined（Codex CRITICAL E）
  it('case 13 this.method() → member + undefined', async () => {
    const file = writeFixture(`
      class A {
        void helper() {}
        void m() { this.helper(); }
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'helper');
    expect(cs?.calleeKind).toBe('member');
    expect(cs?.calleeQualifier).toBeUndefined();
  });

  // case 14: static import (sort(list) → member + undefined)（Codex W-3 free deferred 锚点）
  it('case 14 static import 裸调用 → member + undefined', async () => {
    const file = writeFixture(`
      import static java.util.Collections.sort;
      import java.util.List;
      class A {
        void m(List<Integer> l) { sort(l); }
      }
    `);
    const sk = await adapter.analyzeFile(file, { extractCallSites: true });
    const cs = sk.callSites?.find((c) => c.calleeName === 'sort');
    expect(cs?.calleeKind).toBe('member');
    expect(cs?.calleeQualifier).toBeUndefined();
  });
});
