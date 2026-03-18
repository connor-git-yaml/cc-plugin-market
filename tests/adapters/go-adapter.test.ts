/**
 * GoLanguageAdapter 单元测试 + 集成测试
 * 覆盖 Feature 029 全部 MUST 级别 FR
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import { GoLanguageAdapter } from '../../src/adapters/go-adapter.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';

// ════════════════════════ Fixture 路径 ════════════════════════

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/multilang/go');
const basicGo = path.join(FIXTURE_DIR, 'basic.go');
const visibilityGo = path.join(FIXTURE_DIR, 'visibility.go');
const methodsGo = path.join(FIXTURE_DIR, 'methods.go');
const emptyGo = path.join(FIXTURE_DIR, 'empty.go');

// ════════════════════════ 静态属性测试 ════════════════════════

describe('GoLanguageAdapter 静态属性', () => {
  const adapter = new GoLanguageAdapter();

  it('id 为 "go"', () => {
    expect(adapter.id).toBe('go');
  });

  it('languages 为 ["go"]', () => {
    expect(adapter.languages).toEqual(['go']);
    expect(adapter.languages.length).toBe(1);
  });

  it('extensions 包含 .go', () => {
    expect(adapter.extensions.has('.go')).toBe(true);
    expect(adapter.extensions.size).toBe(1);
  });

  it('defaultIgnoreDirs 包含 vendor', () => {
    expect(adapter.defaultIgnoreDirs.has('vendor')).toBe(true);
  });

  it('实现 LanguageAdapter 接口全部方法', () => {
    expect(typeof adapter.analyzeFile).toBe('function');
    expect(typeof adapter.analyzeFallback).toBe('function');
    expect(typeof adapter.getTerminology).toBe('function');
    expect(typeof adapter.getTestPatterns).toBe('function');
  });
});

// ════════════════════════ analyzeFile 测试 ════════════════════════

describe('GoLanguageAdapter.analyzeFile()', () => {
  const adapter = new GoLanguageAdapter();

  it('提取导出函数（首字母大写）', async () => {
    const skeleton = await adapter.analyzeFile(basicGo);

    expect(skeleton.language).toBe('go');
    expect(skeleton.parserUsed).toBe('tree-sitter');

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('NewConfig');
    expect(names).toContain('Process');
  });

  it('提取导出类型：struct、interface', async () => {
    const skeleton = await adapter.analyzeFile(basicGo);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('Config');
    expect(names).toContain('Greeter');

    const config = skeleton.exports.find((e) => e.name === 'Config');
    expect(config).toBeDefined();
    expect(config!.kind).toBe('struct');

    const greeter = skeleton.exports.find((e) => e.name === 'Greeter');
    expect(greeter).toBeDefined();
    expect(greeter!.kind).toBe('interface');
  });

  it('排除私有符号（首字母小写）', async () => {
    const skeleton = await adapter.analyzeFile(basicGo);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).not.toContain('privateHelper');
  });

  it('可见性测试：仅导出大写标识符', async () => {
    const skeleton = await adapter.analyzeFile(visibilityGo);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('PublicFunc');
    expect(names).toContain('PublicStruct');
    expect(names).not.toContain('privateFunc');
    expect(names).not.toContain('privateStruct');
  });

  it('提取顶层导出函数和 struct（方法通过 struct 成员暴露）', async () => {
    const skeleton = await adapter.analyzeFile(methodsGo);

    const names = skeleton.exports.map((e) => e.name);
    // 顶层 struct 和独立函数
    expect(names).toContain('Server');
    expect(names).toContain('NewServer');

    // 方法接收者作为 struct 成员（如果 GoMapper 支持）
    const server = skeleton.exports.find((e) => e.name === 'Server');
    expect(server).toBeDefined();
    expect(server!.members).toBeDefined();
    expect(server!.members!.length).toBeGreaterThan(0);
    const memberNames = server!.members!.map((m) => m.name);
    expect(memberNames).toContain('Start');
    expect(memberNames).toContain('GetAddr');
  });

  it('空文件返回空 CodeSkeleton', async () => {
    const skeleton = await adapter.analyzeFile(emptyGo);

    expect(skeleton.language).toBe('go');
    expect(skeleton.exports).toEqual([]);
    expect(skeleton.imports).toEqual([]);
  });
});

// ════════════════════════ import 解析测试 ════════════════════════

describe('GoLanguageAdapter import 解析', () => {
  const adapter = new GoLanguageAdapter();

  it('解析分组 import 和单行 import', async () => {
    const skeleton = await adapter.analyzeFile(basicGo);
    const imports = skeleton.imports;

    // 分组 import: "fmt", "os"
    const fmtImport = imports.find((i) => i.moduleSpecifier === 'fmt');
    expect(fmtImport).toBeDefined();
    expect(fmtImport!.isRelative).toBe(false);

    const osImport = imports.find((i) => i.moduleSpecifier === 'os');
    expect(osImport).toBeDefined();

    // 单行 import: "strings"
    const stringsImport = imports.find((i) => i.moduleSpecifier === 'strings');
    expect(stringsImport).toBeDefined();
  });

  it('method 文件解析 import', async () => {
    const skeleton = await adapter.analyzeFile(methodsGo);
    const imports = skeleton.imports;

    const httpImport = imports.find((i) => i.moduleSpecifier === 'net/http');
    expect(httpImport).toBeDefined();
  });
});

// ════════════════════════ Registry 集成测试 ════════════════════════

describe('GoLanguageAdapter Registry 集成', () => {
  beforeAll(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterAll(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('getAdapter("example.go") 返回 GoLanguageAdapter', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter = registry.getAdapter('example.go');
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe('go');
  });

  it('不与 TsJsLanguageAdapter 和 PythonLanguageAdapter 冲突', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const tsAdapter = registry.getAdapter('example.ts');
    expect(tsAdapter).toBeDefined();
    expect(tsAdapter!.id).toBe('ts-js');

    const pyAdapter = registry.getAdapter('example.py');
    expect(pyAdapter).toBeDefined();
    expect(pyAdapter!.id).toBe('python');
  });

  it('getDefaultIgnoreDirs 包含 Go + Python + TS/JS 目录合集', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const dirs = registry.getDefaultIgnoreDirs();
    // Go 忽略目录
    expect(dirs.has('vendor')).toBe(true);
    // Python 忽略目录
    expect(dirs.has('__pycache__')).toBe(true);
    // TS/JS 忽略目录
    expect(dirs.has('node_modules')).toBe(true);
    expect(dirs.has('dist')).toBe(true);
  });
});

// ════════════════════════ analyzeFallback 测试 ════════════════════════

describe('GoLanguageAdapter.analyzeFallback()', () => {
  const adapter = new GoLanguageAdapter();

  it('对 Go 文件返回有效的 CodeSkeleton', async () => {
    const skeleton = await adapter.analyzeFallback(basicGo);

    expect(skeleton).toBeDefined();
    expect(skeleton.language).toBe('go');
    expect(skeleton.parserUsed).toBe('tree-sitter');
    expect(skeleton.exports.length).toBeGreaterThan(0);
  });
});

// ════════════════════════ getTerminology 测试 ════════════════════════

describe('GoLanguageAdapter.getTerminology()', () => {
  const adapter = new GoLanguageAdapter();
  const terminology = adapter.getTerminology();

  it('codeBlockLanguage 为 "go"', () => {
    expect(terminology.codeBlockLanguage).toBe('go');
  });

  it('exportConcept 描述首字母大写导出规则', () => {
    expect(terminology.exportConcept).toMatch(/首字母大写|大写/);
  });

  it('interfaceConcept 包含隐式实现描述', () => {
    expect(terminology.interfaceConcept).toMatch(/隐式|implicit/i);
  });

  it('typeSystemDescription 描述静态类型', () => {
    expect(terminology.typeSystemDescription).toMatch(/静态|static/i);
  });

  it('moduleSystem 描述 Go Modules', () => {
    expect(terminology.moduleSystem).toMatch(/Go Modules|go\.mod/i);
  });
});

// ════════════════════════ getTestPatterns 测试 ════════════════════════

describe('GoLanguageAdapter.getTestPatterns()', () => {
  const adapter = new GoLanguageAdapter();
  const patterns = adapter.getTestPatterns();

  it('匹配 xxx_test.go 文件', () => {
    expect(patterns.filePattern.test('handler_test.go')).toBe(true);
    expect(patterns.filePattern.test('main_test.go')).toBe(true);
  });

  it('不匹配非测试 Go 文件', () => {
    expect(patterns.filePattern.test('main.go')).toBe(false);
    expect(patterns.filePattern.test('handler.go')).toBe(false);
  });

  it('testDirs 为空数组（Go 测试文件与源文件共存）', () => {
    expect(patterns.testDirs).toEqual([]);
  });
});
