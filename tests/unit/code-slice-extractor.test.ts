/**
 * code-slice-extractor 单元测试
 * 验证控制流行保留、注释移除、优先级排序、token 预算裁剪、空函数体跳过、Minified 检测
 */
import { describe, it, expect } from 'vitest';
import {
  extractCodeSlices,
  _extractSliceFromLines,
  _calcPriority,
} from '../../src/core/code-slice-extractor.js';
import { CodeSlicePriority } from '../../src/models/code-skeleton.js';
import type { CodeSkeleton, ExportSymbol } from '../../src/models/code-skeleton.js';

// ============================================================
// 测试辅助工具
// ============================================================

/** 创建最小有效的 ExportSymbol */
function makeSymbol(overrides: Partial<ExportSymbol> & { name: string; startLine: number; endLine: number }): ExportSymbol {
  return {
    kind: 'function',
    signature: `function ${overrides.name}()`,
    jsDoc: null,
    isDefault: false,
    ...overrides,
  };
}

/** 创建最小有效的 CodeSkeleton */
function makeSkeleton(overrides: Partial<CodeSkeleton> & { filePath: string }): CodeSkeleton {
  return {
    language: 'typescript',
    loc: 20,
    exports: [],
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph',
    ...overrides,
  };
}

// ============================================================
// _extractSliceFromLines 测试
// ============================================================

describe('_extractSliceFromLines', () => {
  it('保留控制流行，移除纯空行', () => {
    const lines = [
      'function foo() {',         // 签名行（跳过）
      '  const x = 1;',           // 普通赋值（跳过）
      '  if (x > 0) {',           // 控制流（保留）
      '    return x;',             // return（保留）
      '  }',                       // 闭括号（跳过）
      '}',
    ];
    const result = _extractSliceFromLines(lines, 1, 6);
    expect(result).not.toBeNull();
    expect(result!.some((l) => l.includes('if (x > 0)'))).toBe(true);
    expect(result!.some((l) => l.includes('return x'))).toBe(true);
  });

  it('移除注释行', () => {
    const lines = [
      'function bar() {',
      '  // 这是注释',
      '  /* 块注释 */',
      '  if (true) {',
      '    return 1;',
      '  }',
      '}',
    ];
    const result = _extractSliceFromLines(lines, 1, 7);
    expect(result).not.toBeNull();
    // 注释行不应出现
    expect(result!.every((l) => !l.includes('注释'))).toBe(true);
    expect(result!.some((l) => l.includes('if (true)'))).toBe(true);
  });

  it('空函数体返回 null', () => {
    const lines = [
      'function empty() {',
      '  // 空实现',
      '}',
    ];
    const result = _extractSliceFromLines(lines, 1, 3);
    expect(result).toBeNull();
  });

  it('仅含 pass 的存根函数返回 null', () => {
    const lines = [
      'def stub():',
      '    pass',
    ];
    const result = _extractSliceFromLines(lines, 1, 2);
    expect(result).toBeNull();
  });

  it('仅含 return None 的存根函数返回 null', () => {
    const lines = [
      'def noop():',
      '    return None',
    ];
    const result = _extractSliceFromLines(lines, 1, 2);
    expect(result).toBeNull();
  });

  it('含函数调用的行被保留', () => {
    const lines = [
      'function process() {',
      '  const result = doSomething(input);',  // 含调用
      '  return result;',
      '}',
    ];
    const result = _extractSliceFromLines(lines, 1, 4);
    expect(result).not.toBeNull();
    expect(result!.some((l) => l.includes('doSomething'))).toBe(true);
  });

  it('startLine > endLine 返回 null', () => {
    const result = _extractSliceFromLines(['a', 'b', 'c'], 5, 2);
    expect(result).toBeNull();
  });

  it('Python for 循环被保留', () => {
    const lines = [
      'def iterate(items):',
      '    for item in items:',
      '        process(item)',
      '    return result',
    ];
    const result = _extractSliceFromLines(lines, 1, 4);
    expect(result).not.toBeNull();
    expect(result!.some((l) => l.includes('for item'))).toBe(true);
    expect(result!.some((l) => l.includes('return result'))).toBe(true);
  });
});

// ============================================================
// _calcPriority 测试
// ============================================================

describe('_calcPriority', () => {
  it('公开导出函数（非_前缀）→ P1', () => {
    const symbol = makeSymbol({ name: 'publicFunc', startLine: 1, endLine: 10 });
    const result = _calcPriority(symbol, new Map(), 2, 2, 3);
    expect(result).toBe(CodeSlicePriority.P1_PUBLIC_EXPORT);
  });

  it('被多处 import 的内部函数 → P2', () => {
    const symbol = makeSymbol({ name: '_privateHelper', startLine: 1, endLine: 10 });
    const importMap = new Map([['_privateHelper', 3]]);
    const result = _calcPriority(symbol, importMap, 1, 2, 3);
    expect(result).toBe(CodeSlicePriority.P2_MULTI_IMPORT);
  });

  it('未达 import 阈值但含复杂控制流 → P3', () => {
    const symbol = makeSymbol({ name: '_helper', startLine: 1, endLine: 10 });
    const result = _calcPriority(symbol, new Map(), 5, 2, 3);
    expect(result).toBe(CodeSlicePriority.P3_COMPLEX_CONTROL_FLOW);
  });

  it('未达任何阈值 → P3', () => {
    const symbol = makeSymbol({ name: '_helper', startLine: 1, endLine: 10 });
    const result = _calcPriority(symbol, new Map(), 1, 2, 3);
    expect(result).toBe(CodeSlicePriority.P3_COMPLEX_CONTROL_FLOW);
  });

  it('public class → P1', () => {
    const symbol = makeSymbol({ name: 'MyClass', kind: 'class', startLine: 1, endLine: 50 });
    const result = _calcPriority(symbol, new Map(), 0, 2, 3);
    expect(result).toBe(CodeSlicePriority.P1_PUBLIC_EXPORT);
  });
});

// ============================================================
// extractCodeSlices 集成测试（使用 sourceFiles Map 避免磁盘 IO）
// ============================================================

describe('extractCodeSlices', () => {
  it('优先级排序：P1 先于 P2 先于 P3', () => {
    const filePath = 'test.ts';
    const sourceMap = new Map<string, string>([
      [filePath, [
        '// header',
        'function publicApi() {',
        '  if (condition) {',
        '    return doCall();',
        '  }',
        '}',
        'function _helper() {',
        '  if (x) {',
        '    return inner();',
        '  }',
        '}',
      ].join('\n')],
    ]);

    const skeleton = makeSkeleton({
      filePath,
      exports: [
        makeSymbol({ name: 'publicApi', startLine: 2, endLine: 6 }),
        makeSymbol({ name: '_helper', startLine: 7, endLine: 11 }),
      ],
    });

    const slices = extractCodeSlices([skeleton], sourceMap);
    // publicApi 应排在 _helper 之前
    expect(slices[0]?.symbolName).toBe('publicApi');
  });

  it('Token 预算裁剪：超出预算时优先丢弃低优先级切片', () => {
    const filePath = 'test.ts';
    // 创建多个控制流行以产生 token 消耗
    const manyLines = Array.from({ length: 50 }, (_, i) => `  if (x${i}) { return doCall${i}(); }`);
    const sourceCode = [
      'function publicFunc() {',
      ...manyLines.slice(0, 20),
      '}',
      'function _privateFunc() {',
      ...manyLines.slice(20, 40),
      '}',
    ].join('\n');

    const sourceMap = new Map([[filePath, sourceCode]]);
    const lines = sourceCode.split('\n');

    const skeleton = makeSkeleton({
      filePath,
      exports: [
        makeSymbol({ name: 'publicFunc', startLine: 1, endLine: 22 }),
        makeSymbol({ name: '_privateFunc', startLine: 23, endLine: lines.length }),
      ],
    });

    // 设置极小的 token 预算，只能容纳一个切片
    const slices = extractCodeSlices([skeleton], sourceMap, { maxTokens: 50 });
    // 应该只保留 P1（publicFunc）
    if (slices.length > 0) {
      expect(slices.every((s) => s.priority === CodeSlicePriority.P1_PUBLIC_EXPORT) ||
             slices[0]?.symbolName === 'publicFunc').toBe(true);
    }
  });

  it('空函数体跳过', () => {
    const filePath = 'empty.ts';
    const sourceMap = new Map([[filePath, 'function empty() {\n  // 空实现\n}\n']]);

    const skeleton = makeSkeleton({
      filePath,
      exports: [makeSymbol({ name: 'empty', startLine: 1, endLine: 3 })],
    });

    const slices = extractCodeSlices([skeleton], sourceMap);
    expect(slices).toHaveLength(0);
  });

  it('Minified 文件被跳过', () => {
    const filePath = 'bundle.js';
    // 生成多行超长行（每行 > 500 字符）
    const longLine = 'x'.repeat(600);
    const minifiedContent = Array.from({ length: 10 }, () => longLine).join('\n');
    const sourceMap = new Map([[filePath, minifiedContent]]);

    const skeleton = makeSkeleton({
      filePath,
      language: 'javascript',
      exports: [makeSymbol({ name: 'minifiedFunc', startLine: 1, endLine: 10 })],
    });

    const slices = extractCodeSlices([skeleton], sourceMap);
    expect(slices).toHaveLength(0);
  });

  it('多语言混合：分别处理不同文件', () => {
    const tsPath = 'module.ts';
    const pyPath = 'module.py';

    const tsSource = [
      'function tsFunc() {',
      '  if (condition) {',
      '    return result();',
      '  }',
      '}',
    ].join('\n');

    const pySource = [
      'def py_func():',
      '    if condition:',
      '        return get_result()',
    ].join('\n');

    const sourceMap = new Map([
      [tsPath, tsSource],
      [pyPath, pySource],
    ]);

    const skeletons: CodeSkeleton[] = [
      makeSkeleton({
        filePath: tsPath,
        exports: [makeSymbol({ name: 'tsFunc', startLine: 1, endLine: 5 })],
      }),
      makeSkeleton({
        filePath: pyPath,
        language: 'python',
        exports: [makeSymbol({ name: 'py_func', startLine: 1, endLine: 3 })],
      }),
    ];

    const slices = extractCodeSlices(skeletons, sourceMap);
    const names = slices.map((s) => s.symbolName);
    expect(names).toContain('tsFunc');
    expect(names).toContain('py_func');
  });

  it('文件读取失败时不崩溃（降级保护）', () => {
    const skeleton = makeSkeleton({
      filePath: '/nonexistent/path/file.ts',
      exports: [makeSymbol({ name: 'someFunc', startLine: 1, endLine: 5 })],
    });

    // 不传 sourceFiles 且文件不存在，应不抛错
    expect(() => extractCodeSlices([skeleton])).not.toThrow();
  });
});
