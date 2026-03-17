/**
 * JavaLanguageAdapter 单元测试 + 集成测试
 * 覆盖 Feature 030 全部 MUST 级别 FR
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import { JavaLanguageAdapter } from '../../src/adapters/java-adapter.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';

// ════════════════════════ Fixture 路径 ════════════════════════

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/multilang/java');
const basicJava = path.join(FIXTURE_DIR, 'Basic.java');
const genericsJava = path.join(FIXTURE_DIR, 'Generics.java');
const modifiersJava = path.join(FIXTURE_DIR, 'Modifiers.java');
const recordJava = path.join(FIXTURE_DIR, 'Record.java');
const emptyJava = path.join(FIXTURE_DIR, 'empty.java');

// ════════════════════════ 静态属性测试 ════════════════════════

describe('JavaLanguageAdapter 静态属性', () => {
  const adapter = new JavaLanguageAdapter();

  it('id 为 "java"', () => {
    expect(adapter.id).toBe('java');
  });

  it('languages 为 ["java"]', () => {
    expect(adapter.languages).toEqual(['java']);
    expect(adapter.languages.length).toBe(1);
  });

  it('extensions 包含 .java', () => {
    expect(adapter.extensions.has('.java')).toBe(true);
    expect(adapter.extensions.size).toBe(1);
  });

  it('defaultIgnoreDirs 包含 MUST 级目录（target, build, out, .gradle）', () => {
    const dirs = adapter.defaultIgnoreDirs;
    expect(dirs.has('target')).toBe(true);
    expect(dirs.has('build')).toBe(true);
    expect(dirs.has('out')).toBe(true);
    expect(dirs.has('.gradle')).toBe(true);
  });

  it('defaultIgnoreDirs 包含 SHOULD 级目录（.idea, .settings, .mvn）', () => {
    const dirs = adapter.defaultIgnoreDirs;
    expect(dirs.has('.idea')).toBe(true);
    expect(dirs.has('.settings')).toBe(true);
    expect(dirs.has('.mvn')).toBe(true);
  });

  it('实现 LanguageAdapter 接口全部方法', () => {
    expect(typeof adapter.analyzeFile).toBe('function');
    expect(typeof adapter.analyzeFallback).toBe('function');
    expect(typeof adapter.getTerminology).toBe('function');
    expect(typeof adapter.getTestPatterns).toBe('function');
  });
});

// ════════════════════════ analyzeFile 测试 ════════════════════════

describe('JavaLanguageAdapter.analyzeFile()', () => {
  const adapter = new JavaLanguageAdapter();

  it('提取 public class、interface、enum', async () => {
    const skeleton = await adapter.analyzeFile(basicJava);

    expect(skeleton.language).toBe('java');
    expect(skeleton.parserUsed).toBe('tree-sitter');

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('Basic');

    const basic = skeleton.exports.find((e) => e.name === 'Basic');
    expect(basic).toBeDefined();
    expect(basic!.kind).toBe('class');
  });

  it('提取类成员：方法、字段、构造器', async () => {
    const skeleton = await adapter.analyzeFile(basicJava);

    const basic = skeleton.exports.find((e) => e.name === 'Basic');
    expect(basic).toBeDefined();
    expect(basic!.members).toBeDefined();
    expect(basic!.members!.length).toBeGreaterThan(0);

    const memberNames = basic!.members!.map((m) => m.name);
    // public 方法
    expect(memberNames).toContain('getName');
    expect(memberNames).toContain('setName');
  });

  it('提取泛型类定义', async () => {
    const skeleton = await adapter.analyzeFile(genericsJava);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('Container');

    const container = skeleton.exports.find((e) => e.name === 'Container');
    expect(container).toBeDefined();
    expect(container!.kind).toBe('class');
  });

  it('提取 abstract class 和 final class', async () => {
    const skeleton = await adapter.analyzeFile(modifiersJava);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('AbstractService');

    const abstractService = skeleton.exports.find((e) => e.name === 'AbstractService');
    expect(abstractService).toBeDefined();
  });

  it('提取 Java 16+ record 类型', async () => {
    const skeleton = await adapter.analyzeFile(recordJava);

    const names = skeleton.exports.map((e) => e.name);
    expect(names).toContain('Point');
  });

  it('空文件返回空 CodeSkeleton', async () => {
    const skeleton = await adapter.analyzeFile(emptyJava);

    expect(skeleton.language).toBe('java');
    expect(skeleton.exports).toEqual([]);
    expect(skeleton.imports).toEqual([]);
  });
});

// ════════════════════════ import 解析测试 ════════════════════════

describe('JavaLanguageAdapter import 解析', () => {
  const adapter = new JavaLanguageAdapter();

  it('解析普通 import 语句', async () => {
    const skeleton = await adapter.analyzeFile(basicJava);
    const imports = skeleton.imports;

    // JavaMapper: import java.util.List → moduleSpecifier: "java.util", namedImports: ["List"]
    const listImport = imports.find(
      (i) => i.moduleSpecifier === 'java.util' && i.namedImports?.includes('List'),
    );
    expect(listImport).toBeDefined();
    expect(listImport!.isRelative).toBe(false);

    const mapImport = imports.find(
      (i) => i.moduleSpecifier === 'java.util' && i.namedImports?.includes('Map'),
    );
    expect(mapImport).toBeDefined();
  });

  it('解析泛型文件的 import', async () => {
    const skeleton = await adapter.analyzeFile(genericsJava);
    const imports = skeleton.imports;

    const listImport = imports.find(
      (i) => i.moduleSpecifier === 'java.util' && i.namedImports?.includes('List'),
    );
    expect(listImport).toBeDefined();
  });

  it('解析 Record 文件的 import', async () => {
    const skeleton = await adapter.analyzeFile(recordJava);
    const imports = skeleton.imports;

    const dateImport = imports.find(
      (i) => i.moduleSpecifier === 'java.time' && i.namedImports?.includes('LocalDate'),
    );
    expect(dateImport).toBeDefined();
  });
});

// ════════════════════════ Registry 集成测试 ════════════════════════

describe('JavaLanguageAdapter Registry 集成', () => {
  beforeAll(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterAll(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('getAdapter("Example.java") 返回 JavaLanguageAdapter', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const adapter = registry.getAdapter('Example.java');
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe('java');
  });

  it('不与其他适配器冲突', () => {
    const registry = LanguageAdapterRegistry.getInstance();

    const tsAdapter = registry.getAdapter('example.ts');
    expect(tsAdapter!.id).toBe('ts-js');

    const pyAdapter = registry.getAdapter('example.py');
    expect(pyAdapter!.id).toBe('python');

    const goAdapter = registry.getAdapter('example.go');
    expect(goAdapter!.id).toBe('go');
  });

  it('getDefaultIgnoreDirs 包含 Java + Go + Python + TS/JS 目录合集', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const dirs = registry.getDefaultIgnoreDirs();
    // Java 忽略目录
    expect(dirs.has('target')).toBe(true);
    expect(dirs.has('build')).toBe(true);
    expect(dirs.has('.gradle')).toBe(true);
    // Go 忽略目录
    expect(dirs.has('vendor')).toBe(true);
    // Python 忽略目录
    expect(dirs.has('__pycache__')).toBe(true);
    // TS/JS 忽略目录
    expect(dirs.has('node_modules')).toBe(true);
  });
});

// ════════════════════════ analyzeFallback 测试 ════════════════════════

describe('JavaLanguageAdapter.analyzeFallback()', () => {
  const adapter = new JavaLanguageAdapter();

  it('对 Java 文件返回有效的 CodeSkeleton', async () => {
    const skeleton = await adapter.analyzeFallback(basicJava);

    expect(skeleton).toBeDefined();
    expect(skeleton.language).toBe('java');
    expect(skeleton.parserUsed).toBe('tree-sitter');
    expect(skeleton.exports.length).toBeGreaterThan(0);
  });
});

// ════════════════════════ getTerminology 测试 ════════════════════════

describe('JavaLanguageAdapter.getTerminology()', () => {
  const adapter = new JavaLanguageAdapter();
  const terminology = adapter.getTerminology();

  it('codeBlockLanguage 为 "java"', () => {
    expect(terminology.codeBlockLanguage).toBe('java');
  });

  it('exportConcept 描述 public 修饰符', () => {
    expect(terminology.exportConcept).toMatch(/public/i);
  });

  it('importConcept 包含 static import 描述', () => {
    expect(terminology.importConcept).toMatch(/static/i);
  });

  it('typeSystemDescription 描述静态类型和泛型', () => {
    expect(terminology.typeSystemDescription).toMatch(/静态|static/i);
    expect(terminology.typeSystemDescription).toMatch(/泛型|generic/i);
  });

  it('interfaceConcept 包含 interface 和 abstract class', () => {
    expect(terminology.interfaceConcept).toMatch(/interface/i);
    expect(terminology.interfaceConcept).toMatch(/abstract/i);
  });

  it('moduleSystem 描述 Java Modules', () => {
    expect(terminology.moduleSystem).toMatch(/JPMS|Java Modules|package/i);
  });
});

// ════════════════════════ getTestPatterns 测试 ════════════════════════

describe('JavaLanguageAdapter.getTestPatterns()', () => {
  const adapter = new JavaLanguageAdapter();
  const patterns = adapter.getTestPatterns();

  it('匹配 *Test.java 文件', () => {
    expect(patterns.filePattern.test('UserServiceTest.java')).toBe(true);
  });

  it('匹配 Test*.java 文件', () => {
    expect(patterns.filePattern.test('TestUserService.java')).toBe(true);
  });

  it('匹配 *Tests.java 文件', () => {
    expect(patterns.filePattern.test('UserServiceTests.java')).toBe(true);
  });

  it('匹配 *IT.java 集成测试文件', () => {
    expect(patterns.filePattern.test('UserServiceIT.java')).toBe(true);
  });

  it('不匹配普通 Java 文件', () => {
    expect(patterns.filePattern.test('UserService.java')).toBe(false);
    expect(patterns.filePattern.test('Main.java')).toBe(false);
  });

  it('testDirs 包含 src/test/java', () => {
    expect(patterns.testDirs).toContain('src/test/java');
  });
});
