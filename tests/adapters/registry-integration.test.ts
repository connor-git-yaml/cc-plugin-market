/**
 * Registry 集成测试
 * 使用 MockLanguageAdapter 验证端到端扩展流程（SC-003, US2）
 *
 * 测试场景：
 * 1. Mock 适配器注册后 Registry 正确路由
 * 2. file-scanner 扫描含 .mock 文件的目录时，.mock 文件出现在结果中
 * 3. analyzeFile 路由 .mock 文件时调用 mock 适配器
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { analyzeFile } from '../../src/core/ast-analyzer.js';
import type { LanguageAdapter, LanguageTerminology, TestPatterns } from '../../src/adapters/language-adapter.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';

/** 创建临时测试目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'registry-integ-'));
}

/** 创建文件 */
function createFile(base: string, name: string, content = ''): string {
  const fullPath = path.join(base, name);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

/**
 * Mock 语言适配器，声明支持 .mock 扩展名
 * 返回固定的 CodeSkeleton 用于验证路由正确性
 */
class MockLanguageAdapter implements LanguageAdapter {
  readonly id = 'mock-lang';
  readonly languages = ['typescript'] as const;
  readonly extensions = new Set(['.mock']);
  readonly defaultIgnoreDirs = new Set<string>();

  /** 记录 analyzeFile 被调用的路径 */
  analyzedPaths: string[] = [];

  async analyzeFile(filePath: string): Promise<CodeSkeleton> {
    this.analyzedPaths.push(filePath);
    return {
      filePath,
      language: 'typescript',
      loc: 1,
      exports: [
        {
          name: 'mockExport',
          kind: 'function',
          signature: 'function mockExport(): void',
          jsDoc: null,
          isDefault: false,
          startLine: 1,
          endLine: 1,
        },
      ],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    };
  }

  async analyzeFallback(filePath: string): Promise<CodeSkeleton> {
    return this.analyzeFile(filePath);
  }

  getTerminology(): LanguageTerminology {
    return {
      codeBlockLanguage: 'mock',
      exportConcept: 'export',
      importConcept: 'import',
      typeSystemDescription: 'mock type system',
      interfaceConcept: 'interface',
      moduleSystem: 'mock modules',
    };
  }

  getTestPatterns(): TestPatterns {
    return {
      filePattern: /\.test\.mock$/,
      testDirs: ['tests'],
    };
  }
}

describe('Registry 集成测试（Mock 适配器）', () => {
  let tmpDir: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
  });

  it('Mock 适配器注册后 getAdapter 返回该适配器', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const mockAdapter = new MockLanguageAdapter();
    registry.register(mockAdapter);

    const found = registry.getAdapter('example.mock');
    expect(found).toBe(mockAdapter);
    expect(found?.id).toBe('mock-lang');
  });

  it('file-scanner 扫描含 .mock 文件的目录时，.mock 文件出现在结果中', () => {
    const registry = LanguageAdapterRegistry.getInstance();
    registry.register(new MockLanguageAdapter());

    // 创建混合目录
    createFile(tmpDir, 'app.ts', 'export const x = 1;');
    createFile(tmpDir, 'plugin.mock', 'mock content');
    createFile(tmpDir, 'readme.md', '# README');

    const result = scanFiles(tmpDir);

    // .ts 和 .mock 都应在结果中
    expect(result.files).toContain('app.ts');
    expect(result.files).toContain('plugin.mock');
    // .md 不应在结果中
    expect(result.files).not.toContain('readme.md');
  });

  it('analyzeFile 路由 .mock 文件时调用 mock 适配器', async () => {
    const registry = LanguageAdapterRegistry.getInstance();
    const mockAdapter = new MockLanguageAdapter();
    registry.register(mockAdapter);

    const filePath = createFile(tmpDir, 'test.mock', 'mock code');
    const skeleton = await analyzeFile(filePath);

    // 验证返回的是 mock 适配器生成的骨架
    expect(skeleton.exports).toHaveLength(1);
    expect(skeleton.exports[0]!.name).toBe('mockExport');
    // 验证 mock 适配器确实被调用
    expect(mockAdapter.analyzedPaths).toContain(filePath);
  });
});
