/**
 * PythonLanguageAdapter 单元测试 + 集成测试
 * 覆盖 Feature 028 全部 MUST 级别 FR
 * Feature 145：新增 extractSymbolNodes 单元测试
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
// F250 探针依赖：unified 路 skeleton 采集面（对照组）与知识图谱写入层 upsert 收敛
import { walkPyFiles } from '../../src/batch/stages/source-discovery.js';
import { upsertEdge, upsertNode } from '../../src/panoramic/graph/graph-builder.js';
import type { GraphEdge, GraphNode } from '../../src/panoramic/graph/graph-types.js';

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

  // F272 ⑦-B6：原「实现 LanguageAdapter 接口全部方法 (FR-001)」用例仅做
  // typeof === 'function' 检查——adapter 是 `new PythonLanguageAdapter()` 静态构造，
  // 类型即 LanguageAdapter，该检查由 tsc 全权保证，运行时永不可能为假。四个方法均
  // 已在下方独立 describe 块（analyzeFile / analyzeFallback / getTerminology /
  // getTestPatterns）中被真实调用覆盖，故删除此恒真用例。
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
      // Feature 214：Python symbol ID 收敛为 canonical :: 分隔符（原 hash 分隔符已弃用）
      expect(componentNode!.id).toBe('math.py::add');
      expect(componentNode!.label).toBe('add');

      // 应含 containment 边
      const containsEdge = result.edges.find(e => e.relation === 'contains');
      expect(containsEdge).toBeDefined();
      expect(containsEdge!.source).toBe('math.py');
      expect(containsEdge!.target).toBe('math.py::add');
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

      // Feature 214：a.py::forward 和 b.py::forward 均存在（canonical :: 分隔符）
      expect(uniqueIds.has('a.py::forward')).toBe(true);
      expect(uniqueIds.has('b.py::forward')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  // F271 FR-005：Python extraction 第四路产出 lineRange（与 TS/JS 主路径同标准）
  it('F271 FR-005: 具名函数的 component 节点 metadata.lineRange = { start, end }，数值取自 ExportSymbol span', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [
        {
          name: 'add',
          kind: 'function',
          signature: 'def add(x, y)',
          jsDoc: null,
          isDefault: false,
          startLine: 12,
          endLine: 19,
        },
      ],
      imports: [],
      raw: '',
    } as unknown as CodeSkeleton);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-f271-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'math.py'), 'def add(x, y): return x + y\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);
      const componentNode = results[0]!.nodes.find((n) => n.kind === 'component');
      expect(componentNode).toBeDefined();
      // key 名铁律：消费端读 .start/.end
      expect(componentNode!.metadata?.['lineRange']).toEqual({ start: 12, end: 19 });
      // 既有字段不受影响
      expect(componentNode!.metadata?.['symbolKind']).toBe('function');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('F271 FR-003: ExportSymbol 缺 span 时 lineRange 诚实缺席（不写 { start: undefined }）', async () => {
    const adapter = new PythonLanguageAdapter();
    // 降级/异常解析路径可能产出无行号的 export，此时不得写入畸形 lineRange
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [{ name: 'add', kind: 'function', signature: 'def add(x, y)', jsDoc: null }],
      imports: [],
      raw: '',
    } as unknown as CodeSkeleton);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-f271-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'math.py'), 'def add(x, y): return x + y\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);
      const componentNode = results[0]!.nodes.find((n) => n.kind === 'component');
      expect(componentNode).toBeDefined();
      expect('lineRange' in (componentNode!.metadata ?? {})).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  // F271 对抗审查 F1：同文件内同名 def（条件定义 / try-except 双份 / 遮蔽）撞同一 canonical id。
  // 修复前逐条 push 多个同 id 节点，靠下游 nodeMap upsert（last-wins）折叠 → lineRange 随机取末条。
  it('F271 对抗审查 F1: 同名 def 折叠为单节点，lineRange 取所有条目的并集', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [
        { name: 'run', kind: 'function', signature: 'def run()', jsDoc: null, isDefault: false, startLine: 3, endLine: 8 },
        { name: 'run', kind: 'function', signature: 'def run()', jsDoc: null, isDefault: false, startLine: 20, endLine: 26 },
      ],
      imports: [],
      raw: '',
    } as unknown as CodeSkeleton);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-f271-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'cond.py'), 'def run(): pass\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);
      const componentNodes = results[0]!.nodes.filter((n) => n.kind === 'component');
      expect(componentNodes).toHaveLength(1);
      expect(componentNodes[0]!.metadata?.['lineRange']).toEqual({ start: 3, end: 26 });
      // contains 边同步折叠（同 source/target/relation 的重复边无意义）
      const containsEdges = results[0]!.edges.filter((e) => e.relation === 'contains');
      expect(containsEdges).toHaveLength(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  // F271 对抗审查 F2/F3：regex 退化条目与畸形 span 一律诚实缺席
  it('F271 对抗审查 F2: regex fallback 条目（`[REGEX] ` 前缀签名）不写 lineRange', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'regex',
      exports: [
        {
          name: 'add',
          kind: 'function',
          // tree-sitter-fallback 的退化标记；其 span 恒为签名单行，是假 span
          signature: '[REGEX] def add(x, y):',
          jsDoc: null,
          isDefault: false,
          startLine: 5,
          endLine: 5,
        },
      ],
      imports: [],
      raw: '',
    } as unknown as CodeSkeleton);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-f271-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'math.py'), 'def add(x, y): return x + y\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);
      const componentNode = results[0]!.nodes.find((n) => n.kind === 'component');
      expect(componentNode).toBeDefined();
      expect('lineRange' in (componentNode!.metadata ?? {})).toBe(false);
      // 节点本身仍产出（只是缺席行号），签名保留退化标记供诊断
      expect(componentNode!.metadata?.['signature']).toContain('[REGEX] ');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('F271 对抗审查 F3: 畸形 span（start > end / 0 行号）诚实缺席', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [
        { name: 'reversed_span', kind: 'function', signature: 'def reversed_span()', jsDoc: null, isDefault: false, startLine: 9, endLine: 2 },
        { name: 'zero_start', kind: 'function', signature: 'def zero_start()', jsDoc: null, isDefault: false, startLine: 0, endLine: 4 },
      ],
      imports: [],
      raw: '',
    } as unknown as CodeSkeleton);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-f271-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'bad.py'), 'def reversed_span(): pass\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);
      const componentNodes = results[0]!.nodes.filter((n) => n.kind === 'component');
      expect(componentNodes).toHaveLength(2);
      for (const node of componentNodes) {
        expect('lineRange' in (node.metadata ?? {})).toBe(false);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});

// ════════════════════════ scanPyFiles 遵循 .gitignore (F194) ════════════════════════

describe('scanPyFiles 遵循 .gitignore (F194)', () => {
  /**
   * 从 extractSymbolNodes 结果中收集所有 module 节点的 id（= 相对 POSIX 路径）。
   * scanPyFiles 是私有方法，通过其唯一调用方 extractSymbolNodes 间接验证文件集。
   */
  function collectModuleIds(
    results: Awaited<ReturnType<PythonLanguageAdapter['extractSymbolNodes']>>,
  ): Set<string> {
    const ids = new Set<string>();
    for (const r of results) {
      for (const n of r.nodes) {
        if (n.kind === 'module') ids.add(n.id);
      }
    }
    return ids;
  }

  function makeAdapter(): PythonLanguageAdapter {
    const adapter = new PythonLanguageAdapter();
    // mock analyzeFile 返回空 skeleton，避免 TreeSitter 真实解析依赖
    const emptySkeleton: CodeSkeleton = {
      language: 'python',
      filePath: 'mock.py',
      loc: 1,
      parserUsed: 'tree-sitter',
      exports: [],
      imports: [],
      hash: '0'.repeat(64),
      analyzedAt: new Date().toISOString(),
    };
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue(emptySkeleton);
    return adapter;
  }

  it('T-GITIGNORE-01: 目录模式 generated/ → 含 keep 文件，不含被忽略目录下文件', async () => {
    const adapter = makeAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f193-py-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'generated/\n', 'utf-8');
      fs.mkdirSync(path.join(tmpDir, 'pkg'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'generated'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'pkg', 'core.py'), 'def f(): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'generated', 'auto_stub.py'), 'def g(): pass\n', 'utf-8');

      const ids = collectModuleIds(await adapter.extractSymbolNodes(tmpDir));

      // 正向：keep 文件存在（防空结果假绿）
      expect(ids.has('pkg/core.py')).toBe(true);
      // 负向：被忽略目录下文件不存在
      expect(ids.has('generated/auto_stub.py')).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('T-GITIGNORE-02: 通配模式 local_*.py → 含 keep 文件，命中文件被跳过', async () => {
    const adapter = makeAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f193-py-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'local_*.py\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'core.py'), 'def f(): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'local_scratch.py'), 'def g(): pass\n', 'utf-8');

      const ids = collectModuleIds(await adapter.extractSymbolNodes(tmpDir));

      expect(ids.has('core.py')).toBe(true);
      expect(ids.has('local_scratch.py')).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('T-GITIGNORE-03a: negation 最后匹配优先 local_*.py + !local_important.py', async () => {
    const adapter = makeAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f193-py-'));
    try {
      // 单独 !pattern 是 no-op，需 local_*.py + !local_important.py 两行（最后匹配优先）
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'local_*.py\n!local_important.py\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'core.py'), 'def f(): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'local_scratch.py'), 'def g(): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'local_important.py'), 'def h(): pass\n', 'utf-8');

      const ids = collectModuleIds(await adapter.extractSymbolNodes(tmpDir));

      // negation 生效：local_important.py 被重新包含
      expect(ids.has('local_important.py')).toBe(true);
      // keep 文件存在
      expect(ids.has('core.py')).toBe(true);
      // 其余 local_*.py 仍被排除
      expect(ids.has('local_scratch.py')).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('T-GITIGNORE-03b: 已剪枝目录内 negation 不放宽 generated/ + !generated/keep.py', async () => {
    const adapter = makeAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f193-py-'));
    try {
      // 目录被剪枝后，其下文件不可达——negation 不放宽（与 file-scanner walkDir / git 语义一致）
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'generated/\n!generated/keep.py\n', 'utf-8');
      fs.mkdirSync(path.join(tmpDir, 'generated'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'core.py'), 'def f(): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'generated', 'keep.py'), 'def g(): pass\n', 'utf-8');

      const ids = collectModuleIds(await adapter.extractSymbolNodes(tmpDir));

      // keep 文件存在
      expect(ids.has('core.py')).toBe(true);
      // 目录剪枝优先：generated/keep.py 仍被剪掉
      expect(ids.has('generated/keep.py')).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('T-GITIGNORE-04: 无 .gitignore → 行为等同修复前（无回归）', async () => {
    const adapter = makeAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f193-py-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'pkg'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'generated'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'pkg', 'core.py'), 'def f(): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'generated', 'auto_stub.py'), 'def g(): pass\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'local_scratch.py'), 'def h(): pass\n', 'utf-8');

      const ids = collectModuleIds(await adapter.extractSymbolNodes(tmpDir));

      // 无 .gitignore：全部非硬编码忽略文件都在结果中
      expect(ids.has('pkg/core.py')).toBe(true);
      expect(ids.has('generated/auto_stub.py')).toBe(true);
      expect(ids.has('local_scratch.py')).toBe(true);
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

// ════════════════════════ F250：.pyi 纳入符号采集面 ════════════════════════

/**
 * F250 防回归探针组。
 *
 * 覆盖 `.pyi` 扩集到 `PYTHON_SYMBOL_SCAN_SURFACE` 后的两条精度护栏与配套事实：
 * - 护栏 A（FR-004）：`.pyi` 永不作为 import 解析目标（`pyModuleMap` 显式跳过）
 * - 护栏 B（FR-005/FR-010）：extraction 路 module 节点 label 按**真实**扩展名剥离，
 *   正常分支与 parseError 降级分支两处都要生效
 * - FR-002：`scanPyFiles` 消费 SSoT 常量而非硬编码字面量判断
 * - SC-005 对照组：extraction 路与 unified 路的硬编码剪枝集差异（本仓唯一 `.pyi`
 *   落在 `tests` 剪枝集内，故本仓真实图行为增量为零）
 * - FR-011（可选）：`@overload` 同名多签名经写入层 upsert 后按 id 收敛
 */
describe('PythonLanguageAdapter .pyi 符号采集面（F250）', () => {
  /** 收集 extraction 路产出的 module 节点（id → label），供 label/覆盖面断言复用。 */
  function moduleNodes(
    results: Awaited<ReturnType<PythonLanguageAdapter['extractSymbolNodes']>>,
  ): Map<string, string> {
    const byId = new Map<string, string>();
    for (const result of results) {
      for (const node of result.nodes) {
        if (node.kind === 'module') byId.set(node.id, node.label);
      }
    }
    return byId;
  }

  /** 造一个空 skeleton（只测采集面/label 时无需真实解析开销）。 */
  function emptySkeleton(): CodeSkeleton {
    return {
      language: 'python',
      filePath: 'mock.py',
      loc: 1,
      parserUsed: 'tree-sitter',
      exports: [],
      imports: [],
      hash: '0'.repeat(64),
      analyzedAt: new Date().toISOString(),
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── T-guard-a-b：护栏 A（import 解析目标排除）+ FR-003b（modules[] 视图完整性）──

  /**
   * **可观测性如实标注（勿误读本探针的守护力）**：护栏 A 的实现（`pyModuleMap` 构建时对
   * `.pyi` 显式 `continue`）在当前黑盒下**行为不可观测**——即使把那行 `continue` 删掉，
   * `.pyi` 写入 map 的键是 `mod.pyi`，而绝对 import 的 `topModule` 恒不含点，永远取不到
   * 该键，本探针照样绿。
   *
   * 本探针实际锁定的是**解析结果的等价行为**（import 恒指向 `.py`），而非"那行 continue
   * 存在与否"。护栏 A 的真实价值在未来：一旦有人把 `stripFileExtension` 顺手统一到本处
   * 键生成，`.pyi` 的键会塌缩为 `mod` 与同目录 `mod.py` 撞键——届时本探针**将变红**，
   * 这正是它作为回归防线的兑现时刻。
   */
  it('T-guard-a-b: shadow 对下绝对 import 恒解析到 .py，无任何指向 .pyi 的边；.pyi 作为 import 来源正常', async () => {
    const adapter = new PythonLanguageAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-guard-a-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'mod.py'), 'def mod_fn():\n    return 1\n', 'utf-8');
      // mod.pyi 自身也发起一次 import —— 用于验证 `.pyi` 作为 import **来源**不受护栏 A 影响
      fs.writeFileSync(
        path.join(tmpDir, 'mod.pyi'),
        'import helper\ndef mod_fn() -> int: ...\n',
        'utf-8',
      );
      fs.writeFileSync(path.join(tmpDir, 'helper.py'), 'def helper_fn():\n    return 2\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'user.py'), 'import mod\n', 'utf-8');

      const graph = await adapter.buildModuleGraph(tmpDir);
      const sources = graph.modules.map((m) => m.source).sort();

      // FR-003b：`.pyi` 完整参与 ModuleGraph 分析视图（护栏 A 只排除"作为 import 目标"）
      expect(sources).toEqual(['helper.py', 'mod.py', 'mod.pyi', 'user.py']);

      // 护栏 A 核心断言：不存在任何以 `.pyi` 为目标的边
      expect(graph.edges.filter((e) => e.to === 'mod.pyi')).toEqual([]);
      // user.py 的绝对 import 必须解析到实现文件 mod.py
      expect(graph.edges.some((e) => e.from === 'user.py' && e.to === 'mod.py')).toBe(true);
      // `.pyi` 作为 import 来源不受影响，正常产出指向 .py 的 depends-on 边
      expect(graph.edges.some((e) => e.from === 'mod.pyi' && e.to === 'helper.py')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('T-guard-a-relative: 相对 import（from . import mod）同样恒解析到 .py，不指向 .pyi', async () => {
    const adapter = new PythonLanguageAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-guard-a-rel-'));
    try {
      // 相对 import 走 resolvePythonImport 的 Case A（纯点号 specifier + namedImports 展开），
      // 与绝对 import 的 pyModuleMap 路径完全不同 —— FR-004 第二条要求单独钉死该路径：
      // `tryResolveAtDir` 的候选恒为字面 `X.py` / `X/__init__.py`，`.pyi` 不进候选集合。
      const pkgDir = path.join(tmpDir, 'pkg');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'mod.py'), 'def mod_fn():\n    return 1\n', 'utf-8');
      fs.writeFileSync(path.join(pkgDir, 'mod.pyi'), 'def mod_fn() -> int: ...\n', 'utf-8');
      fs.writeFileSync(path.join(pkgDir, 'user.py'), 'from . import mod\n', 'utf-8');

      const graph = await adapter.buildModuleGraph(tmpDir);

      // 相对 import 确实解析成功且指向实现文件（活性对照：不能因"零边"而假绿）
      expect(graph.edges.some((e) => e.from === 'pkg/user.py' && e.to === 'pkg/mod.py')).toBe(true);
      // 候选集合不含 `.pyi`：不存在任何指向 stub 的边
      expect(graph.edges.filter((e) => e.to === 'pkg/mod.pyi')).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── T-label-normal / T-label-parse-error / T-C1-dotfile：护栏 B ──

  it('T-label-normal: mod.py 与 mod.pyi 的 module 节点 label 均剥离为 mod，id 保留完整后缀', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue(emptySkeleton());

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-label-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'mod.py'), 'def mod_fn():\n    return 1\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'mod.pyi'), 'def mod_fn() -> int: ...\n', 'utf-8');

      const byId = moduleNodes(await adapter.extractSymbolNodes(tmpDir));

      // id 保留完整 relPath（两节点天然区分），label 均剥离真实扩展名
      expect([...byId.keys()].sort()).toEqual(['mod.py', 'mod.pyi']);
      expect(byId.get('mod.py')).toBe('mod');
      expect(byId.get('mod.pyi')).toBe('mod');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('T-label-parse-error: parseError 降级分支的 label 同样按真实扩展名剥离（FR-010）', async () => {
    const adapter = new PythonLanguageAdapter();
    // `.pyi` 解析失败走降级分支，`.py` 正常 —— 钉死"两处分支都要修"
    vi.spyOn(adapter, 'analyzeFile').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('.pyi')) throw new Error('synthetic parse failure');
      return emptySkeleton();
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-label-err-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'mod.py'), 'def mod_fn():\n    return 1\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, 'mod.pyi'), 'def mod_fn( -> broken\n', 'utf-8');

      const results = await adapter.extractSymbolNodes(tmpDir);
      const stubModule = results
        .flatMap((r) => r.nodes)
        .find((n) => n.kind === 'module' && n.id === 'mod.pyi');

      expect(stubModule).toBeDefined();
      // 确实走了 parseError 降级分支（否则这条探针会退化为重测正常分支）
      expect(stubModule!.metadata).toEqual({ parseError: true });
      expect(stubModule!.label).toBe('mod');
      // 不静默丢弃错误、不中断整体批处理：同目录 .py 仍正常产出
      expect(moduleNodes(results).get('mod.py')).toBe('mod');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('T-C1-dotfile: 纯点文件 `.py`/`.pyi` 的 label 为其原文件名（已声明的可接受行为 delta）', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue(emptySkeleton());

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-dotfile-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '.py'), '# 纯点文件\n', 'utf-8');
      fs.writeFileSync(path.join(tmpDir, '.pyi'), '# 纯点文件\n', 'utf-8');

      const byId = moduleNodes(await adapter.extractSymbolNodes(tmpDir));

      // `path.extname('.py') === ''` → 不剥离，label 即原名。
      // 旧实现 `path.basename(relPath, '.py')` 对 `.py` 返回空串——空 label 更接近 bug，
      // 新行为（`.py`）是 plan.md C1 显式声明为可接受的 delta，此处钉住防止被当作回归"修回去"。
      expect(byId.get('.py')).toBe('.py');
      expect(byId.get('.pyi')).toBe('.pyi');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── T-FR002：scanPyFiles 消费 SSoT 而非硬编码 ──

  it('T-FR002: 目录内只有 .pyi 文件时 extractSymbolNodes 仍产出 module 节点（锁定 SSoT 消费点）', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue(emptySkeleton());

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-stub-only-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'stub.pyi'), 'def stub_fn() -> int: ...\n', 'utf-8');

      const byId = moduleNodes(await adapter.extractSymbolNodes(tmpDir));

      // 若 scanPyFiles 被改回硬编码 `entry.name.endsWith('.py')`，这里会扫到零文件而变红
      expect([...byId.keys()]).toEqual(['stub.pyi']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── T-SC005-control：两套硬编码剪枝集差异的对照组 ──

  it('T-SC005-control: 本仓唯一 .pyi 落在 scanPyFiles 剪枝集内，但 walkPyFiles 会采集它', async () => {
    const REPO_ROOT = process.cwd();
    const GUARDRAIL_PYI = 'tests/fixtures/collector-fingerprint-guardrail/src/py/mod.pyi';

    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue(emptySkeleton());

    // extraction 路：`tests` 在 scanPyFiles 硬编码剪枝集内 → 不覆盖该文件
    const scannedIds = moduleNodes(await adapter.extractSymbolNodes(REPO_ROOT));
    expect(scannedIds.has(GUARDRAIL_PYI)).toBe(false);
    // 活性对照：extraction 路确实扫到了仓内 `.py`（否则"不含"会因扫到零文件而假绿）
    expect(scannedIds.size).toBeGreaterThan(0);

    // unified 路 skeleton 采集面：PY_SKELETON_IGNORE_DIRS 不剪 `tests` → 覆盖该文件
    const walked: string[] = [];
    walkPyFiles(REPO_ROOT, walked, () => false, REPO_ROOT);
    const walkedRelPaths = walked.map((p) => path.relative(REPO_ROOT, p).split(path.sep).join('/'));
    // 断言完整相对路径而非 basename：隔离 gitignore 等变量，只测两套剪枝集差异这一个变量
    expect(walkedRelPaths).toContain(GUARDRAIL_PYI);
  });

  // ── T-overload（FR-011，可选探针）──

  // 【F271 前提迁移】本探针原先钉死"extraction 路本身**不**去重（rawNodes 恰为 2 条）、
  // 收敛只由写入层 upsert 提供"。F271 对抗审查 F1 把折叠前移到了 extraction 侧——因为
  // last-wins 的写入层收敛会让同名符号的 lineRange 随机取到末条，必须在能看到全部条目的
  // 地方取并集。原断言按设计 fail-loud 报出了这次前提变化，故在此显式改写而非放宽：
  //   - extraction 侧现在恰为 1 条节点，且 lineRange 是两条 overload 的并集（证明第二条
  //     确实被"合并"而不是被"丢弃"——这是替代旧 `length === 2` 的防假绿锚点）；
  //   - 写入层 upsert 仍必须幂等收敛（下方 nodeMap/edgeMap 断言原样保留）。
  it('T-overload: @overload 同名多签名在 extraction 侧折叠为单节点（lineRange 取并集），写入层 upsert 仍幂等收敛', async () => {
    const adapter = new PythonLanguageAdapter();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-overload-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'ov.pyi'),
        [
          'from typing import overload',
          '',
          '@overload',
          'def parse(raw: str) -> int: ...',
          '@overload',
          'def parse(raw: bytes) -> str: ...',
        ].join('\n') + '\n',
        'utf-8',
      );

      const results = await adapter.extractSymbolNodes(tmpDir);
      const rawNodes = results.flatMap((r) => r.nodes);
      const rawEdges = results.flatMap((r) => r.edges);

      // 前置事实（F271 后）：extraction 路按 symbolId 折叠，两个 @overload 恰为 1 条节点。
      // 精确条数而非 `>= 1`：既防"折叠失效退回重复节点"，也防"折叠过头把不同符号并掉"。
      const parseNodes = rawNodes.filter((n) => n.id === 'ov.pyi::parse');
      expect(parseNodes).toHaveLength(1);
      // 防假绿锚点：折叠必须是"并集"而非"丢弃后来者"——两条 overload 分别在第 3-4 行与
      // 第 5-6 行，只有真正合并才能得到跨越两者的 span。若退化为 first-wins/last-wins，
      // end 会停在 4 或 start 会滑到 5，本断言立刻红。
      expect(parseNodes[0]!.metadata?.['lineRange']).toEqual({ start: 3, end: 6 });
      // 其余 metadata 仍 first-wins（签名取第一条 overload）
      expect(parseNodes[0]!.metadata?.['signature']).toBe('def parse(raw: str) -> int');

      // 收敛发生在写入层：upsertNode（按 id）/ upsertEdge（按 source|target|relation|directed）
      const nodeMap = new Map<string, GraphNode>();
      const edgeMap = new Map<string, GraphEdge>();
      for (const node of rawNodes) {
        upsertNode(nodeMap, {
          id: node.id,
          kind: node.kind === 'module' ? 'module' : 'component',
          label: node.label,
          metadata: { ...node.metadata },
        });
      }
      for (const edge of rawEdges) {
        upsertEdge(
          edgeMap,
          {
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
            confidence: 'EXTRACTED',
            confidenceScore: edge.weight,
            directional: true,
          },
          true,
        );
      }

      // 同名 overload 收敛为单一节点 + 单一 contains 边
      expect([...nodeMap.keys()].sort()).toEqual(['ov.pyi', 'ov.pyi::parse']);
      expect([...edgeMap.values()]).toHaveLength(1);
      expect([...edgeMap.values()][0]!.target).toBe('ov.pyi::parse');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
