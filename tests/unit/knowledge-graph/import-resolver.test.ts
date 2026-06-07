/**
 * Feature 152 / Feature 181 — knowledge-graph import-resolver 单测（Python only）
 *
 * Feature 181 收口后：TS/JS resolveTsJsImport + tsconfig loader 已迁到
 * core/import-resolver.ts（见 tests/unit/core/import-resolver.test.ts）。
 * 本文件仅保留 Python 解析（resolvePythonImport）覆盖：
 * - C-1：from . import nn 形态由 collect 层拆解为 ".nn" 后调用 resolver
 * - C-5：isInsideProjectRoot 用 path.relative 而非字典序比较（越界 unresolved）
 * - W-5：resolvedPath 使用 POSIX 路径（含 '/'）
 *
 * 测试隔离：通过 vi.mock('fs') hoisting 方式 mock 文件系统（kg resolver 用 'fs'）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ESM 环境下需在导入被测模块之前通过 vi.mock 声明 mock（hoisted）
vi.mock('fs', () => {
  return {
    existsSync: vi.fn((_p: string) => false),
    readFileSync: vi.fn((_p: string, _options?: unknown) => {
      return JSON.stringify({ compilerOptions: {} });
    }),
  };
});

import { resolvePythonImport } from '../../../src/knowledge-graph/import-resolver.js';
import * as fs from 'fs';

/** 设置当前测试的虚拟文件系统：给定路径集合，让 fs.existsSync 返回 true */
function setupFs(existingFiles: string[]): void {
  const fileSet = new Set(existingFiles);
  vi.mocked(fs.existsSync).mockImplementation((p) => fileSet.has(p.toString()));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolvePythonImport — Python 绝对路径场景', () => {
  it('场景 1：from micrograd.engine import Value → kind=module，resolvedPath=micrograd/engine.py', () => {
    setupFs(['/proj/micrograd/engine.py']);
    const result = resolvePythonImport('micrograd.engine', '/proj/micrograd/nn.py', '/proj');
    expect(result.kind).toBe('module');
    expect(result.resolvedPath).toBe('micrograd/engine.py');
  });

  it('场景 5：import os（stdlib 内置）→ kind=external，resolvedPath=null', () => {
    setupFs([]);
    const result = resolvePythonImport('os', '/proj/main.py', '/proj');
    expect(result.kind).toBe('external');
    expect(result.resolvedPath).toBeNull();
  });

  it('场景 6a：同名 basename 冲突 — from a.utils → a/utils.py', () => {
    setupFs(['/proj/a/utils.py', '/proj/b/utils.py']);
    const resultA = resolvePythonImport('a.utils', '/proj/main.py', '/proj');
    expect(resultA.kind).toBe('module');
    expect(resultA.resolvedPath).toBe('a/utils.py');
  });

  it('场景 6b：同名 basename 冲突 — from b.utils → b/utils.py', () => {
    setupFs(['/proj/a/utils.py', '/proj/b/utils.py']);
    const resultB = resolvePythonImport('b.utils', '/proj/main.py', '/proj');
    expect(resultB.kind).toBe('module');
    expect(resultB.resolvedPath).toBe('b/utils.py');
  });

  it('Python package-init：pkg 目录含 __init__.py', () => {
    setupFs(['/proj/pkg/__init__.py']);
    const result = resolvePythonImport('pkg', '/proj/main.py', '/proj');
    expect(result.kind).toBe('package-init');
    expect(result.resolvedPath).toBe('pkg/__init__.py');
  });
});

describe('resolvePythonImport — Python 相对 import 场景', () => {
  it('场景 2（C-1 修复）：collect 层拆解为 ".nn" 后调用 → kind=relative-sibling', () => {
    setupFs(['/proj/micrograd/nn.py']);
    const result = resolvePythonImport('.nn', '/proj/micrograd/training.py', '/proj');
    expect(result.kind).toBe('relative-sibling');
    expect(result.resolvedPath).toBe('micrograd/nn.py');
  });

  it('场景 3：from .. import X（祖先包）→ relative-sibling', () => {
    setupFs(['/proj/pkg/utils.py']);
    const result = resolvePythonImport('..utils', '/proj/pkg/sub/module.py', '/proj');
    expect(result.kind).toBe('relative-sibling');
    expect(result.resolvedPath).toBe('pkg/utils.py');
  });

  it('场景 4：越过 projectRoot（4 个点）→ kind=unresolved，resolvedPath=null', () => {
    setupFs([]);
    const result = resolvePythonImport('....x', '/proj/a.py', '/proj');
    expect(result.kind).toBe('unresolved');
    expect(result.resolvedPath).toBeNull();
  });
});

describe('场景 19（W-5 修复）：resolvedPath 必须使用 POSIX 格式（含 /）', () => {
  it('Python 解析结果不含 Windows 路径分隔符', () => {
    setupFs(['/proj/micrograd/engine.py']);
    const result = resolvePythonImport('micrograd.engine', '/proj/main.py', '/proj');
    expect(result.resolvedPath).not.toContain('\\');
    if (result.resolvedPath !== null) {
      expect(result.resolvedPath).toContain('/');
    }
  });
});

describe('场景 20（C-5 修复）：isInsideProjectRoot 逐段判断，不用字典序比较', () => {
  it("projectRoot='/proj' + candidate='/projection' → 不被视为在 projectRoot 内", () => {
    setupFs(['/projection/x.py']);
    const result = resolvePythonImport('....x', '/proj/a.py', '/proj');
    expect(result.kind).toBe('unresolved');
  });
});
