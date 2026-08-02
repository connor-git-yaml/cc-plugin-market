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

// ============================================================
// F242 — 动态 import 绑定抽取 + 静态命名空间绑定（R2 target 侧）
//
// 设计见 specs/242-fix-callsite-syntax-coverage/plan.md 决策 3。
// 动态 import()/require() 分支此前只记 moduleSpecifier，不抓绑定名，
// 导致 buildImportIndex 无 alias、被调符号 Stage 3 解析失败产 `?::` 占位。
// ============================================================

describe('ast-analyzer — F242 动态 import 绑定抽取', () => {
  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterEach(() => {
    resetProject();
    LanguageAdapterRegistry.resetInstance();
  });

  /** 取指定 moduleSpecifier 的 import 记录 */
  async function importOf(code: string, specifier: string) {
    const filePath = createTempFile(code);
    try {
      const skeleton = await analyzeFile(filePath);
      return skeleton.imports.find((i) => i.moduleSpecifier === specifier);
    } finally {
      cleanup(filePath);
    }
  }

  // 形态 4：顶层 await import() 解构
  it('形态 4 — 顶层 `const { fn } = await import(...)` 抓到 namedImports', async () => {
    const imp = await importOf(
      "const { runScaffoldKb } = await import('./commands/scaffold-kb.js');\nexport const x = 1;\n",
      './commands/scaffold-kb.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.importType).toBe('dynamic');
    expect(imp!.namedImports).toEqual(['runScaffoldKb']);
  });

  // 形态 5：函数体内 await import() 解构（位置不限于模块顶层）
  it('形态 5 — 函数体内 `const { fn } = await import(...)` 同样抓到 namedImports', async () => {
    const imp = await importOf(
      [
        'export async function main(): Promise<void> {',
        "  const { runScaffoldKb } = await import('./commands/scaffold-kb.js');",
        '  await runScaffoldKb();',
        '}',
      ].join('\n'),
      './commands/scaffold-kb.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toEqual(['runScaffoldKb']);
  });

  // 形态 5b：rename 解构 — 口径与静态 import 的 getName() 一致（记 property 名）
  it('形态 5b — rename 解构 `{ a: b }` 记 property 名 a（与静态 import 口径一致）', async () => {
    const imp = await importOf(
      "const { runScaffoldKb: run } = await import('./x.js');\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namedImports).toEqual(['runScaffoldKb']);
  });

  // 形态 5c：await import() 命名空间绑定
  it('形态 5c — `const m = await import(...)` 抓到 namespaceImport', async () => {
    const imp = await importOf(
      "const mod = await import('./x.js');\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namespaceImport).toBe('mod');
  });

  // 形态 6：import().then(m => ...) 命名空间形参绑定
  it('形态 6 — `import(...).then(m => m.fn())` 抓到 namespaceImport', async () => {
    const imp = await importOf(
      "import('./x.js').then((m) => m.fn());\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namespaceImport).toBe('m');
  });

  // 形态 6b：import().then(({ fn }) => ...) 解构形参绑定
  it('形态 6b — `import(...).then(({ fn }) => fn())` 抓到 namedImports', async () => {
    const imp = await importOf(
      "import('./x.js').then(({ fn }) => fn());\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namedImports).toEqual(['fn']);
  });

  // 附加项（plan 决策 3 并入）：静态 import * as ns
  it('附加 — 静态 `import * as ns from ...` 抓到 namespaceImport', async () => {
    const imp = await importOf(
      "import * as ns from './x.js';\nexport const y = ns;\n",
      './x.js',
    );
    expect(imp!.namespaceImport).toBe('ns');
  });

  // 负向锚：无绑定的裸动态 import 不应臆造字段
  it('负向锚 — 裸 `await import(...)` 无绑定时不产出绑定字段', async () => {
    const imp = await importOf(
      "export async function go(): Promise<void> { await import('./x.js'); }\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });

  // 负向锚：CommonJS require 解构本次不动（plan Non-Goals 显式排除）
  it('负向锚 — `const { a } = require(...)` 本次不抽取绑定（plan Non-Goals）', async () => {
    const imp = await importOf(
      "const { a } = require('./x.js');\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.importType).toBe('commonjs-require');
    expect(imp!.namedImports).toBeUndefined();
  });

  // 负向锚（Codex W1）：`.then` 作为值传参时，外层 call 的首参与本 import 无关
  it('负向锚 — `.then` 仅作为值传参时不产出绑定（callee 同一性校验）', async () => {
    const imp = await importOf(
      "declare function consume(cb: unknown, t: unknown): void;\nconsume((m) => m.run(), import('./x.js').then);\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.importType).toBe('dynamic');
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });

  // 正向锚（Codex 复审轮 W1）：括号只是语法包装，`.then` 仍是外层 CallExpression 的 callee，
  // 绑定必须照常抽到 —— identity 守卫要剥掉 ParenthesizedExpression 再比较。
  it('正向锚 — `(import(...).then)(cb)` 括号包裹仍是同一 callee，正常产出绑定', async () => {
    const imp = await importOf(
      "(import('./x.js').then)((m) => m.fn());\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namespaceImport).toBe('m');
  });

  it('正向锚 — 多层括号 `((import(...).then))(cb)` 同样产出绑定', async () => {
    const imp = await importOf(
      "((import('./x.js').then))(({ fn }) => fn());\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namedImports).toEqual(['fn']);
  });

  it('负向锚 — 括号包裹但 `.then` 只是实参时仍不产绑定（剥括号不放宽同一性）', async () => {
    const imp = await importOf(
      "declare function consume(cb: unknown, t: unknown): void;\nconsume((m) => m.run(), (import('./x.js').then));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });

  // 正向锚（Codex 确认轮 W1）：括号包在 **import 调用自身** 上时（receiver 侧），
  // import CallExpression 的直接父节点是 ParenthesizedExpression，
  // await / then 两条入口路径都进不去 —— 入口判定前必须先剥掉自身的括号父链。
  it('正向锚 — receiver 单层括号 `(import(...)).then(cb)` 正常产出绑定', async () => {
    const imp = await importOf(
      "(import('./x.js')).then((m) => m.fn());\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namespaceImport).toBe('m');
  });

  it('正向锚 — receiver 双层括号 `((import(...))).then(cb)` 正常产出绑定', async () => {
    const imp = await importOf(
      "((import('./x.js'))).then(({ fn }) => fn());\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toEqual(['fn']);
  });

  it('正向锚 — receiver 括号 + await 形态 `await ((import(...)))` 正常产出绑定', async () => {
    const imp = await importOf(
      "const mod = await ((import('./x.js')));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namespaceImport).toBe('mod');
  });

  it('正向锚 — receiver 括号 + await 解构形态照常记源导出名', async () => {
    const imp = await importOf(
      "const { fn } = await ((import('./x.js')));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namedImports).toEqual(['fn']);
  });

  it('负向锚 — receiver 括号但 `.then` 只是实参时仍不产绑定（剥 receiver 括号不放宽同一性）', async () => {
    const imp = await importOf(
      "declare function consume(cb: unknown, t: unknown): void;\nconsume((m) => m.run(), (import('./x.js')).then);\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });

  it('负向锚 — receiver 括号包裹的裸 `(import(...))` 仍不产绑定', async () => {
    const imp = await importOf(
      "export async function go(): Promise<void> { await ((import('./x.js'))); }\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });

  // ----------------------------------------------------------
  // Codex 第五轮 W1/W2：括号归一化必须是**函数内完备不变量**——
  // 「本函数内任意深度括号出现在任何接缝，都不改变抽取结果」。
  // 前四轮只覆盖了 import 调用自身父链与 `.then` callee 两处接缝，
  // 剩下的 (1) AwaitExpression 上方父链、(2) `.then` 回调实参 两处仍会漏抽。
  // ----------------------------------------------------------

  // 接缝 1（await 上方括号）：AST 是 Call → Await → Paren → VariableDeclaration，
  // 未剥括号时 `awaitExpr.getParent()` 拿到的是 ParenthesizedExpression 而非声明。
  it('正向锚 — await 上方单层括号 `const m = ((await import(...)))` 抓到 namespaceImport', async () => {
    const imp = await importOf(
      "const m = ((await import('./x.js')));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namespaceImport).toBe('m');
  });

  it('正向锚 — await 上方三层括号同样抓到 namespaceImport', async () => {
    const imp = await importOf(
      "const m = ((((await import('./x.js')))));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namespaceImport).toBe('m');
  });

  it('正向锚 — await 上方括号 + 解构形态照常记源导出名', async () => {
    const imp = await importOf(
      "const { fn: local } = ((await import('./x.js')));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namedImports).toEqual(['fn']);
  });

  // 接缝 2（`.then` 回调实参括号）：实参是 ParenthesizedExpression 包着 ArrowFunction，
  // 未剥括号时 isArrowFunction / isFunctionExpression 判定直接落空。
  it('正向锚 — `.then(((m) => m.run()))` 回调外裹括号仍抓到 namespaceImport', async () => {
    const imp = await importOf(
      "import('./x.js').then(((m) => m.run()));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namespaceImport).toBe('m');
  });

  it('正向锚 — `.then(((({ fn }) => fn())))` 多层括号解构回调仍抓到 namedImports', async () => {
    const imp = await importOf(
      "import('./x.js').then(((({ fn }) => fn())));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namedImports).toEqual(['fn']);
  });

  it('正向锚 — 括号包裹的 function 表达式回调 `.then((function (m) { ... }))` 仍抓到绑定', async () => {
    const imp = await importOf(
      "import('./x.js').then((function (m: { run(): void }) { m.run(); }));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namespaceImport).toBe('m');
  });

  // 组合形态：receiver 括号 + await 上方括号同时出现
  it('正向锚 — 组合形态 `((await ((import(...)))))` 正常抓到绑定', async () => {
    const imp = await importOf(
      "const m = ((await ((import('./x.js')))));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namespaceImport).toBe('m');
  });

  it('正向锚 — 组合形态 receiver 括号 + 回调括号 `((import(...))).then(((m) => ...))`', async () => {
    const imp = await importOf(
      "((import('./x.js'))).then(((m) => m.run()));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp!.namespaceImport).toBe('m');
  });

  // 负向锚：剥实参括号**不得**放宽 callee 同一性判据——
  // `.then` 只是作为值传给别的函数时，即使首参被括号包着也不能采信。
  it('负向锚 — 首参带括号但 `.then` 仅作为值传参时仍不产绑定', async () => {
    const imp = await importOf(
      "declare function consume(cb: unknown, t: unknown): void;\nconsume(((m) => m.run()), (import('./x.js').then));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });

  // 负向锚：括号剥完仍不是函数的实参不产绑定（不因剥括号而误判非函数值）
  it('负向锚 — `.then(((notAFunction)))` 剥完括号非函数仍不产绑定', async () => {
    const imp = await importOf(
      "declare const notAFunction: (m: unknown) => void;\nimport('./x.js').then(((notAFunction)));\nexport const y = 1;\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });

  // 负向锚：await 上方括号后不是 VariableDeclaration 时仍不产绑定
  it('负向锚 — `((await import(...)))` 非赋值上下文仍不产绑定', async () => {
    const imp = await importOf(
      "export async function go(): Promise<void> { console.log(((await import('./x.js')))); }\n",
      './x.js',
    );
    expect(imp).toBeDefined();
    expect(imp!.namedImports).toBeUndefined();
    expect(imp!.namespaceImport).toBeUndefined();
  });
});
