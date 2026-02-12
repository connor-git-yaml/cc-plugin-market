/**
 * ast-analyzer 单元测试
 * 验证 ts-morph AST 提取、导出/导入识别、成员提取、降级处理
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  analyzeFile,
  analyzeFiles,
  resetProject,
  FileNotFoundError,
  UnsupportedFileError,
} from '../../src/core/ast-analyzer.js';

/** 创建临时 TS 文件 */
function createTempFile(content: string, ext = '.ts'): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-test-'));
  const filePath = path.join(tmpDir, `test${ext}`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** 清理临时文件 */
function cleanup(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('ast-analyzer', () => {
  afterEach(() => {
    resetProject();
  });

  describe('analyzeFile', () => {
    it('应提取导出函数', async () => {
      const filePath = createTempFile(
        'export function hello(name: string): string { return `Hello ${name}`; }',
      );
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports).toHaveLength(1);
        expect(skeleton.exports[0]!.name).toBe('hello');
        expect(skeleton.exports[0]!.kind).toBe('function');
        expect(skeleton.exports[0]!.signature).toContain('hello');
        expect(skeleton.exports[0]!.signature).toContain('string');
        expect(skeleton.parserUsed).toBe('ts-morph');
      } finally {
        cleanup(filePath);
      }
    });

    it('应提取导出类及其成员', async () => {
      const filePath = createTempFile(`
export class MyService {
  private name: string;
  constructor(name: string) { this.name = name; }
  public greet(): string { return this.name; }
  static create(): MyService { return new MyService('default'); }
}
`);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports).toHaveLength(1);
        const cls = skeleton.exports[0]!;
        expect(cls.name).toBe('MyService');
        expect(cls.kind).toBe('class');
        expect(cls.members).toBeDefined();
        expect(cls.members!.length).toBeGreaterThanOrEqual(3);

        // 检查成员类型
        const methodNames = cls.members!.map((m) => m.name);
        expect(methodNames).toContain('greet');
        expect(methodNames).toContain('constructor');
      } finally {
        cleanup(filePath);
      }
    });

    it('应提取导出接口', async () => {
      const filePath = createTempFile(`
export interface Config {
  host: string;
  port: number;
  debug?: boolean;
}
`);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports).toHaveLength(1);
        expect(skeleton.exports[0]!.name).toBe('Config');
        expect(skeleton.exports[0]!.kind).toBe('interface');
        expect(skeleton.exports[0]!.members).toBeDefined();
      } finally {
        cleanup(filePath);
      }
    });

    it('应提取导出类型别名', async () => {
      const filePath = createTempFile(
        "export type Status = 'active' | 'inactive' | 'pending';",
      );
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports).toHaveLength(1);
        expect(skeleton.exports[0]!.name).toBe('Status');
        expect(skeleton.exports[0]!.kind).toBe('type');
      } finally {
        cleanup(filePath);
      }
    });

    it('应提取导入引用', async () => {
      const filePath = createTempFile(`
import { readFile } from 'node:fs';
import path from 'node:path';
import type { Config } from './config';
export const x = 1;
`);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.imports.length).toBeGreaterThanOrEqual(3);

        const fsImport = skeleton.imports.find(
          (i) => i.moduleSpecifier === 'node:fs',
        );
        expect(fsImport).toBeDefined();
        expect(fsImport!.isRelative).toBe(false);
        expect(fsImport!.namedImports).toContain('readFile');

        const configImport = skeleton.imports.find(
          (i) => i.moduleSpecifier === './config',
        );
        expect(configImport).toBeDefined();
        expect(configImport!.isRelative).toBe(true);
        expect(configImport!.isTypeOnly).toBe(true);
      } finally {
        cleanup(filePath);
      }
    });

    it('应正确计算文件哈希', async () => {
      const content = 'export const x = 42;';
      const filePath = createTempFile(content);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.hash).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        cleanup(filePath);
      }
    });

    it('应对不支持的文件类型抛出错误', async () => {
      await expect(analyzeFile('test.py')).rejects.toThrow(UnsupportedFileError);
    });

    it('应对不存在的文件抛出错误', async () => {
      await expect(analyzeFile('/nonexistent/file.ts')).rejects.toThrow(FileNotFoundError);
    });

    it('应正确识别 TypeScript 和 JavaScript', async () => {
      const tsFile = createTempFile('export const a = 1;', '.ts');
      const jsFile = createTempFile('export const b = 2;', '.js');
      try {
        const tsSkeleton = await analyzeFile(tsFile);
        const jsSkeleton = await analyzeFile(jsFile);
        expect(tsSkeleton.language).toBe('typescript');
        expect(jsSkeleton.language).toBe('javascript');
      } finally {
        cleanup(tsFile);
        cleanup(jsFile);
      }
    });

    it('应提取 JSDoc 注释', async () => {
      const filePath = createTempFile(`
/**
 * 计算两个数的和
 * @param a - 第一个数
 * @param b - 第二个数
 */
export function add(a: number, b: number): number { return a + b; }
`);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports[0]!.jsDoc).toBeDefined();
        expect(skeleton.exports[0]!.jsDoc).toContain('计算两个数的和');
      } finally {
        cleanup(filePath);
      }
    });
  });

  describe('analyzeFiles', () => {
    it('应批量分析多个文件', async () => {
      const file1 = createTempFile('export const a = 1;');
      const file2 = createTempFile('export function b(): void {}');
      try {
        const skeletons = await analyzeFiles([file1, file2]);
        expect(skeletons).toHaveLength(2);
        expect(skeletons[0]!.exports[0]!.name).toBe('a');
        expect(skeletons[1]!.exports[0]!.name).toBe('b');
      } finally {
        cleanup(file1);
        cleanup(file2);
      }
    });

    it('应调用进度回调', async () => {
      const file1 = createTempFile('export const a = 1;');
      const progress: Array<[number, number]> = [];
      try {
        await analyzeFiles([file1], {
          onProgress: (completed, total) => progress.push([completed, total]),
        });
        expect(progress).toEqual([[1, 1]]);
      } finally {
        cleanup(file1);
      }
    });
  });
});
