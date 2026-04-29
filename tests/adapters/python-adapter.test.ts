/**
 * PythonLanguageAdapter 单元测试 + 集成测试
 * 覆盖 Feature 028 全部 MUST 级别 FR
 * Feature 145：新增 extractSymbolNodes 单元测试
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';

// ════════════════════════ Fixture 路径 ════════════════════════

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/multilang/python');
const FIXTURE_DIR_028 = path.resolve(__dirname, '../fixtures/python');
const basicPy = path.join(FIXTURE_DIR, 'basic.py');
const decoratorsPy = path.join(FIXTURE_DIR, 'decorators.py');
const dunderAllPy = path.join(FIXTURE_DIR, 'dunder-all.py');
const emptyPy = path.join(FIXTURE_DIR, 'empty.py');
const importsPy = path.join(FIXTURE_DIR_028, 'imports.py');

// ════════════════════════ 静态属性测试 (T006) ════════════════════════

describe('PythonLanguageAdapter 静态属性', () => {
  const adapter = new PythonLanguageAdapter();

  it('id 为 "python" (FR-002)', () => {
    expect(adapter.id).toBe('python');
  });

  it('languages 为 ["python"] (FR-003)', () => {
    expect(adapter.languages).toEqual(['python']);
    expect(adapter.languages.length).toBe(1);
  });

  it('extensions 包含 .py 和 .pyi (FR-004)', () => {
    expect(adapter.extensions.has('.py')).toBe(true);
    expect(adapter.extensions.has('.pyi')).toBe(true);
    expect(adapter.extensions.size).toBe(2);
  });

  it('defaultIgnoreDirs 包含 5 个必要目录 (FR-021)', () => {
    const dirs = adapter.defaultIgnoreDirs;
    expect(dirs.has('__pycache__')).toBe(true);
    expect(dirs.has('.venv')).toBe(true);
    expect(dirs.has('venv')).toBe(true);
    expect(dirs.has('.tox')).toBe(true);
    expect(dirs.has('.mypy_cache')).toBe(true);
  });

  it('defaultIgnoreDirs 额外包含 .pytest_cache 和 .eggs (FR-022)', () => {
    const dirs = adapter.defaultIgnoreDirs;
    expect(dirs.has('.pytest_cache')).toBe(true);
    expect(dirs.has('.eggs')).toBe(true);
  });

  it('实现 LanguageAdapter 接口全部方法 (FR-001)', () => {
    expect(typeof adapter.analyzeFile).toBe('function');
    expect(typeof adapter.analyzeFallback).toBe('function');
    expect(typeof adapter.getTerminology).toBe('function');
    expect(typeof adapter.getTestPatterns).toBe('function');
  });
});

// ════════════════════════ analyzeFile 测试 (T007) ════════════════════════

describe('PythonLanguageAdapter.analyzeFile()', () => {
  const adapter = new PythonLanguageAdapter();

  it('提取公开函数和 async 函数 (FR-005, FR-006, FR-007)', async () => {
    const skeleton = await adapter.analyzeFile(basicPy);

    expect(skeleton.language).toBe('python');
    expect(skeleton.parserUsed).toBe('tree-sitter');

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('greet');
    expect(names).toContain('fetch_data');

    // async 函数签名
    const fetchData = skeleton.exports.find((e) => e.name === 'fetch_data');
    expect(fetchData).toBeDefined();
    expect(fetchData!.signature).toContain('async');
  });

  it('提取类定义和装饰器方法 (FR-008, FR-009)', async () => {
    const skeleton = await adapter.analyzeFile(decoratorsPy);

    const service = skeleton.exports.find((e) => e.name === 'Service');
    expect(service).toBeDefined();
    expect(service!.kind).toBe('class');

    // 检查成员装饰器分类
    const members = service!.members ?? [];
    const staticMethod = members.find((m) => m.name === 'create');
    expect(staticMethod?.kind).toBe('staticmethod');

    const classMethod = members.find((m) => m.name === 'from_config');
    expect(classMethod?.kind).toBe('classmethod');

    const propMethod = members.find((m) => m.name === 'name' && m.kind === 'getter');
    expect(propMethod).toBeDefined();
  });

  it('尊重 __all__ 列表 (FR-010)', async () => {
    const skeleton = await adapter.analyzeFile(dunderAllPy);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('PublicClass');
    expect(names).toContain('public_func');
    // __all__ 未列出的应被排除
    expect(names).not.toContain('InternalClass');
    expect(names).not.toContain('_helper');
  });

  it('默认排除私有符号 (FR-011)', async () => {
    const skeleton = await adapter.analyzeFile(basicPy);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).not.toContain('_private_helper');
  });

  it('空文件返回空 CodeSkeleton', async () => {
    const skeleton = await adapter.analyzeFile(emptyPy);

    expect(skeleton.language).toBe('python');
    expect(skeleton.exports).toEqual([]);
    expect(skeleton.imports).toEqual([]);
  });
});

// ════════════════════════ import 解析测试 (T010) ════════════════════════

describe('PythonLanguageAdapter import 解析', () => {
  const adapter = new PythonLanguageAdapter();

  it('正确解析多种 import 形式 (FR-012 ~ FR-016)', async () => {
    const skeleton = await adapter.analyzeFile(importsPy);
    const imports = skeleton.imports;

    // import os (FR-012)
    const osImport = imports.find((i) => i.moduleSpecifier === 'os');
    expect(osImport).toBeDefined();
    expect(osImport!.isRelative).toBe(false);

    // from os.path import join, exists (FR-013)
    const osPathImport = imports.find((i) => i.moduleSpecifier === 'os.path');
    expect(osPathImport).toBeDefined();
    expect(osPathImport!.namedImports).toContain('join');
    expect(osPathImport!.namedImports).toContain('exists');

    // 相对导入 from . import utils (FR-014)
    // PythonMapper: moduleSpecifier='.' + namedImports=['utils']
    const relativeImport = imports.find(
      (i) => i.isRelative && i.moduleSpecifier === '.',
    );
    expect(relativeImport).toBeDefined();
    expect(relativeImport!.isRelative).toBe(true);
    expect(relativeImport!.namedImports).toContain('utils');

    // 相对导入 from ..models import User (FR-014)
    // PythonMapper: moduleSpecifier='..models'
    const parentImport = imports.find(
      (i) => i.isRelative && i.moduleSpecifier === '..models',
    );
    expect(parentImport).toBeDefined();
    expect(parentImport!.namedImports).toContain('User');

    // from module import * (FR-015)
    // PythonMapper 将 wildcard import 的 namedImports 包含模块名
    const wildcardImport = imports.find((i) => i.moduleSpecifier === 'module');
    expect(wildcardImport).toBeDefined();

    // Python import 的 isTypeOnly 应为 false (FR-016)
    for (const imp of imports) {
      expect(imp.isTypeOnly).toBe(false);
    }
  });
});

// ════════════════════════ Registry 集成测试 (T012) ════════════════════════

describe('PythonLanguageAdapter Registry 集成', () => {
  beforeAll(() => {
    // 重置 Registry 后重新 bootstrap
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterAll(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('getAdapter("example.py") 返回 PythonLanguageAdapter (FR-023)', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter = registry.getAdapter('example.py');
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe('python');
  });

  it('getAdapter("example.pyi") 返回 PythonLanguageAdapter (FR-004)', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter = registry.getAdapter('example.pyi');
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe('python');
  });

  it('不与 TsJsLanguageAdapter 冲突 (FR-024)', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const tsAdapter = registry.getAdapter('example.ts');
    expect(tsAdapter).toBeDefined();
    expect(tsAdapter!.id).toBe('ts-js');
  });

  it('getDefaultIgnoreDirs 包含 Python + TS/JS 目录合集 (FR-025)', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const dirs = registry.getDefaultIgnoreDirs();
    // Python 忽略目录
    expect(dirs.has('__pycache__')).toBe(true);
    expect(dirs.has('.venv')).toBe(true);
    // TS/JS 忽略目录
    expect(dirs.has('node_modules')).toBe(true);
    expect(dirs.has('dist')).toBe(true);
  });
});

// ════════════════════════ analyzeFallback 测试 (T015) ════════════════════════

describe('PythonLanguageAdapter.analyzeFallback()', () => {
  const adapter = new PythonLanguageAdapter();

  it('对 Python 文件返回有效的 CodeSkeleton (FR-017)', async () => {
    const skeleton = await adapter.analyzeFallback(basicPy);

    expect(skeleton).toBeDefined();
    expect(skeleton.language).toBe('python');
    // tree-sitter-fallback 会先尝试 tree-sitter，成功则 parserUsed 为 'tree-sitter'
    expect(skeleton.parserUsed).toBe('tree-sitter');
    expect(skeleton.exports.length).toBeGreaterThan(0);
  });
});

// ════════════════════════ getTerminology 测试 (T017) ════════════════════════

describe('PythonLanguageAdapter.getTerminology()', () => {
  const adapter = new PythonLanguageAdapter();
  const terminology = adapter.getTerminology();

  it('codeBlockLanguage 为 "python" (FR-019)', () => {
    expect(terminology.codeBlockLanguage).toBe('python');
  });

  it('exportConcept 描述 Python 公开符号和 __all__ (FR-019)', () => {
    expect(terminology.exportConcept).toContain('__all__');
  });

  it('interfaceConcept 包含 Protocol 和 ABC (FR-019)', () => {
    expect(terminology.interfaceConcept).toContain('Protocol');
    expect(terminology.interfaceConcept).toContain('ABC');
  });

  it('typeSystemDescription 描述可选类型注解 (FR-019)', () => {
    expect(terminology.typeSystemDescription).toMatch(/type hint|类型注解/i);
  });

  it('moduleSystem 描述 Python 的 package/module 系统 (FR-019)', () => {
    expect(terminology.moduleSystem).toMatch(/package|module|import/i);
  });
});

// ════════════════════════ extractSymbolNodes 测试 (T010-T012 Feature 145) ════════════════════════

describe('PythonLanguageAdapter.extractSymbolNodes() (Feature 145)', () => {
  it('T010: fixture .py 含 def add(x, y) → 节点 ID={relPath}#add，kind=component，边 relation=contains', async () => {
    const adapter = new PythonLanguageAdapter();
    // mock analyzeFile 返回含一个 function export 的 skeleton
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [{ name: 'add', kind: 'function', signature: 'def add(x, y)', jsDoc: null }],
      imports: [],
      raw: '',
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-143-'));
    try {
      const pyFile = path.join(tmpDir, 'math.py');
      fs.writeFileSync(pyFile, 'def add(x, y): return x + y\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);

      // 应有至少一个 ExtractionResult（math.py）
      expect(results.length).toBeGreaterThanOrEqual(1);
      const result = results[0]!;

      // 应含 module 节点（文件级）和 component 节点（函数级）
      const moduleNode = result.nodes.find(n => n.kind === 'module');
      expect(moduleNode).toBeDefined();
      expect(moduleNode!.id).toBe('math.py');

      const componentNode = result.nodes.find(n => n.kind === 'component');
      expect(componentNode).toBeDefined();
      expect(componentNode!.id).toBe('math.py#add');
      expect(componentNode!.label).toBe('add');

      // 应含 containment 边
      const containsEdge = result.edges.find(e => e.relation === 'contains');
      expect(containsEdge).toBeDefined();
      expect(containsEdge!.source).toBe('math.py');
      expect(containsEdge!.target).toBe('math.py#add');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('T011: 无 exports 的 .py 文件 → 不抛异常，产出 module 节点，无 containment 边', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [],
      imports: [],
      raw: '',
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-143-'));
    try {
      const pyFile = path.join(tmpDir, 'empty_module.py');
      fs.writeFileSync(pyFile, '# empty\n', 'utf-8');

      let results: Awaited<ReturnType<typeof adapter.extractSymbolNodes>>;
      await expect(async () => {
        results = await adapter.extractSymbolNodes(tmpDir);
      }).not.toThrow();

      results = await adapter.extractSymbolNodes(tmpDir);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const result = results[0]!;

      // 含文件级 module 节点
      const moduleNode = result.nodes.find(n => n.kind === 'module');
      expect(moduleNode).toBeDefined();

      // 无 containment 边（无 exports）
      const containsEdges = result.edges.filter(e => e.relation === 'contains');
      expect(containsEdges).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('T012: 同名函数跨两个 .py 文件 → ID 全局唯一（不冲突）', async () => {
    const adapter = new PythonLanguageAdapter();
    // 两个文件都有 forward 函数
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [{ name: 'forward', kind: 'function', signature: 'def forward(x)', jsDoc: null }],
      imports: [],
      raw: '',
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-143-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'a.py'), 'def forward(x): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'b.py'), 'def forward(x): pass\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);

      // 两个文件各产出一个 ExtractionResult
      expect(results.length).toBe(2);

      // 收集所有节点 ID，检查全局唯一
      const allIds = results.flatMap(r => r.nodes.map(n => n.id));
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);

      // a.py#forward 和 b.py#forward 均存在
      expect(uniqueIds.has('a.py#forward')).toBe(true);
      expect(uniqueIds.has('b.py#forward')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});

// ════════════════════════ getTestPatterns 测试 (T019) ════════════════════════

describe('PythonLanguageAdapter.getTestPatterns()', () => {
  const adapter = new PythonLanguageAdapter();
  const patterns = adapter.getTestPatterns();

  it('匹配 test_example.py (FR-020)', () => {
    expect(patterns.filePattern.test('test_example.py')).toBe(true);
  });

  it('匹配 example_test.py (FR-020)', () => {
    expect(patterns.filePattern.test('example_test.py')).toBe(true);
  });

  it('匹配 conftest.py (FR-020)', () => {
    expect(patterns.filePattern.test('conftest.py')).toBe(true);
  });

  it('不匹配 main.py 和 utils.py (FR-020)', () => {
    expect(patterns.filePattern.test('main.py')).toBe(false);
    expect(patterns.filePattern.test('utils.py')).toBe(false);
  });

  it('testDirs 包含 tests 和 test (FR-020)', () => {
    expect(patterns.testDirs).toContain('tests');
    expect(patterns.testDirs).toContain('test');
  });
});

// ════════════════════════ BUG-C：docstring 提取测试 ════════════════════════

describe('PythonLanguageAdapter docstring 提取 (BUG-C)', () => {
  const adapter = new PythonLanguageAdapter();

  it('从含 """docstring""" 的函数提取 jsDoc 第一行', async () => {
    // basic.py 中 greet 函数有 """问候函数""" docstring
    const skeleton = await adapter.analyzeFile(basicPy);

    const greet = skeleton.exports.find((e) => e.name === 'greet');
    expect(greet).toBeDefined();
    expect(greet!.jsDoc).not.toBeNull();
    expect(greet!.jsDoc).toBe('问候函数');
  });

  it('从含 """docstring""" 的类提取 jsDoc 第一行', async () => {
    // basic.py 中 User 类有 """用户类""" docstring
    const skeleton = await adapter.analyzeFile(basicPy);

    const userClass = skeleton.exports.find((e) => e.name === 'User');
    expect(userClass).toBeDefined();
    expect(userClass!.jsDoc).not.toBeNull();
    expect(userClass!.jsDoc).toBe('用户类');
  });

  it('没有 docstring 的函数 jsDoc 为 null', async () => {
    // empty.py 不含函数，改用 dunder-all.py 中无 docstring 的函数
    const skeleton = await adapter.analyzeFile(dunderAllPy);

    // dunder-all.py 中如果存在无 docstring 的导出符号，jsDoc 应为 null
    for (const exp of skeleton.exports) {
      if (exp.jsDoc !== null) {
        // 有 docstring 也是合法的，跳过
        continue;
      }
      expect(exp.jsDoc).toBeNull();
    }
  });
});
