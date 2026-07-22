/**
 * ast-analyzer 单元测试
 * 验证 ts-morph AST 提取、导出/导入识别、成员提取、降级处理
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';

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
  beforeEach(() => {
    // 确保 Registry 已注册适配器（analyzeFile 通过 Registry 路由）
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterEach(() => {
    resetProject();
    LanguageAdapterRegistry.resetInstance();
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
      // .py 现在被 PythonLanguageAdapter 支持，使用 .rb 测试
      await expect(analyzeFile('test.rb')).rejects.toThrow(UnsupportedFileError);
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

  // ── F221: re-export 门面语法级提取 ──────────────────────────
  // why 单文件 Project：被 re-export 的目标文件不存在也应能识别，这正是修复本质
  //（getExportedDeclarations 对跨文件目标静默丢符号，需语法级独立提取）。fixture 无需真的创建 './x.js'。
  describe('re-export 提取（F221）', () => {
    it('① named re-export 产出 kind=re-export 条目并携带 reExportFrom', async () => {
      const filePath = createTempFile(`export { a, b } from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        expect(reExports).toHaveLength(2);
        expect(reExports.map((e) => e.name).sort()).toEqual(['a', 'b']);
        for (const e of reExports) {
          expect(e.reExportFrom).toBe('./x.js');
          expect(e.members).toBeUndefined();
          expect(e.startLine).toBeGreaterThan(0);
          expect(e.endLine).toBeGreaterThan(0);
        }
      } finally {
        cleanup(filePath);
      }
    });

    it('② alias re-export 取别名为 name 且签名含 `a as b`', async () => {
      const filePath = createTempFile(`export { a as b } from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        expect(reExports).toHaveLength(1);
        expect(reExports[0]!.name).toBe('b');
        expect(reExports[0]!.signature).toContain('a as b');
        expect(reExports[0]!.reExportFrom).toBe('./x.js');
      } finally {
        cleanup(filePath);
      }
    });

    it('②b `as default` 重导出与 extractSymbol 的 isDefault 口径一致', async () => {
      const filePath = createTempFile(`export { a as default } from './x.js';\nexport { b } from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        expect(reExports).toHaveLength(2);
        const asDefault = reExports.find((e) => e.name === 'default');
        expect(asDefault?.isDefault).toBe(true);
        expect(reExports.find((e) => e.name === 'b')?.isDefault).toBe(false);
      } finally {
        cleanup(filePath);
      }
    });

    it('⑬ string-literal alias `as "default"` 取字面值且 isDefault=true', async () => {
      const filePath = createTempFile(`export { foo as "default" } from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        expect(reExports).toHaveLength(1);
        expect(reExports[0]!.name).toBe('default');
        expect(reExports[0]!.isDefault).toBe(true);
        expect(reExports[0]!.signature).toContain('foo as "default"');
      } finally {
        cleanup(filePath);
      }
    });

    it('⑭ module specifier 含单引号时签名重建保持合法引号', async () => {
      const filePath = createTempFile(`export { foo } from "./it's.js";`);
      try {
        const skeleton = await analyzeFile(filePath);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        expect(reExports).toHaveLength(1);
        expect(reExports[0]!.reExportFrom).toBe("./it's.js");
        expect(reExports[0]!.signature).toContain(`from "./it's.js"`);
      } finally {
        cleanup(filePath);
      }
    });

    it('⑮ 空 clause `export {} from` 不产条目', async () => {
      const filePath = createTempFile(`export {} from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports.filter((e) => e.kind === 're-export')).toHaveLength(0);
      } finally {
        cleanup(filePath);
      }
    });

    it('③ 语句级 type-only re-export 标记 isTypeOnly 且签名含 `export type {`', async () => {
      const filePath = createTempFile(`export type { T } from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        expect(reExports).toHaveLength(1);
        expect(reExports[0]!.isTypeOnly).toBe(true);
        expect(reExports[0]!.signature).toContain('export type {');
      } finally {
        cleanup(filePath);
      }
    });

    it('④ 说明符级 type 修饰仅标记该说明符', async () => {
      const filePath = createTempFile(`export { type T, v } from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        const t = reExports.find((e) => e.name === 'T');
        const v = reExports.find((e) => e.name === 'v');
        expect(t?.isTypeOnly).toBe(true);
        expect(v?.isTypeOnly).toBe(false);
      } finally {
        cleanup(filePath);
      }
    });

    it('⑤ 本地 `export { localFn }`（无 specifier）不产 re-export 且不重复', async () => {
      const filePath = createTempFile(`function localFn() {}\nexport { localFn };`);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports.filter((e) => e.kind === 're-export')).toHaveLength(0);
        expect(skeleton.exports.filter((e) => e.name === 'localFn')).toHaveLength(1);
      } finally {
        cleanup(filePath);
      }
    });

    it('⑥ `export * from` 无法枚举（已知限界）不产条目', async () => {
      const filePath = createTempFile(`export * from './x.js';`);
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports.filter((e) => e.kind === 're-export')).toHaveLength(0);
      } finally {
        cleanup(filePath);
      }
    });

    it('⑦ facade 集成：3 本地声明 + 11 named re-export（含 1 type-only）→ 14 符号', async () => {
      const filePath = createTempFile(
        [
          'export function localA() {}',
          'export const localB = 1;',
          'export class LocalC {}',
          "export { r1, r2, r3, r4, r5 } from './m1.js';",
          "export { r6, r7, r8 } from './m2.js';",
          "export type { R9 } from './m3.js';",
          "export { r10, r11 } from './m4.js';",
        ].join('\n'),
      );
      try {
        const skeleton = await analyzeFile(filePath);
        expect(skeleton.exports).toHaveLength(14);
        const reExports = skeleton.exports.filter((e) => e.kind === 're-export');
        expect(reExports).toHaveLength(11);
        expect(reExports.filter((e) => e.isTypeOnly)).toHaveLength(1);
        expect(reExports.find((e) => e.name === 'R9')?.isTypeOnly).toBe(true);
      } finally {
        cleanup(filePath);
      }
    });
  });
});
