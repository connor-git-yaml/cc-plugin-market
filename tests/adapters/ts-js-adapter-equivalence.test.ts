/**
 * TsJsLanguageAdapter 行为等价性测试
 * 验证 adapter 方法与直接调用底层函数产出完全一致
 * 覆盖：analyzeFile 等价性、analyzeFallback 等价性
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { analyzeFileInternal } from '../../src/core/ast-analyzer.js';
import { analyzeFallback } from '../../src/core/tree-sitter-fallback.js';

/** 创建临时测试目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-js-adapter-equiv-'));
}

/** 创建文件 */
function createFile(base: string, name: string, content: string): string {
  const fullPath = path.join(base, name);
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

describe('TsJsLanguageAdapter 行为等价性', () => {
  let tmpDir: string;
  const adapter = new TsJsLanguageAdapter();

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adapter.analyzeFile() 与 ast-analyzer.analyzeFile() 对 .ts 文件产出一致', async () => {
    const filePath = createFile(tmpDir, 'sample.ts', `
export function hello(name: string): string {
  return \`Hello, \${name}\`;
}

export class Greeter {
  greet(name: string): string {
    return hello(name);
  }
}
`);

    const adapterResult = await adapter.analyzeFile(filePath);
    const directResult = await analyzeFileInternal(filePath);

    // analyzedAt 时间戳会有微小差异，先排除后比较
    expect(adapterResult.filePath).toBe(directResult.filePath);
    expect(adapterResult.language).toBe(directResult.language);
    expect(adapterResult.loc).toBe(directResult.loc);
    expect(adapterResult.hash).toBe(directResult.hash);
    expect(adapterResult.parserUsed).toBe(directResult.parserUsed);
    expect(adapterResult.exports).toEqual(directResult.exports);
    expect(adapterResult.imports).toEqual(directResult.imports);
  });

  it('adapter.analyzeFile() 与 ast-analyzer.analyzeFile() 对 .js 文件产出一致', async () => {
    const filePath = createFile(tmpDir, 'module.js', `
export function add(a, b) {
  return a + b;
}

export const PI = 3.14159;
`);

    const adapterResult = await adapter.analyzeFile(filePath);
    const directResult = await analyzeFileInternal(filePath);

    expect(adapterResult.filePath).toBe(directResult.filePath);
    expect(adapterResult.language).toBe(directResult.language);
    expect(adapterResult.loc).toBe(directResult.loc);
    expect(adapterResult.hash).toBe(directResult.hash);
    expect(adapterResult.parserUsed).toBe(directResult.parserUsed);
    expect(adapterResult.exports).toEqual(directResult.exports);
    expect(adapterResult.imports).toEqual(directResult.imports);
  });

  it('adapter.analyzeFallback() 与 tree-sitter-fallback.analyzeFallback() 产出一致', async () => {
    // 创建一个有效的 TS 文件用于 fallback 测试
    const filePath = createFile(tmpDir, 'fallback.ts', `
export function greet(name: string): void {
  console.log(name);
}

export class Parser {
  parse() {}
}
`);

    const adapterResult = await adapter.analyzeFallback(filePath);
    const directResult = await analyzeFallback(filePath);

    expect(adapterResult.filePath).toBe(directResult.filePath);
    expect(adapterResult.language).toBe(directResult.language);
    expect(adapterResult.loc).toBe(directResult.loc);
    expect(adapterResult.hash).toBe(directResult.hash);
    expect(adapterResult.parserUsed).toBe(directResult.parserUsed);
    expect(adapterResult.exports).toEqual(directResult.exports);
    expect(adapterResult.imports).toEqual(directResult.imports);
  });

  // F272 ⑦-B6：原「adapter.buildModuleGraph 方法存在」用例仅做 typeof === 'function'
  // 检查。⚠️ 注意：`buildModuleGraph` 在 `LanguageAdapter`（src/adapters/language-adapter.ts）
  // 里是**可选成员**（`buildModuleGraph?(`），不像 go/java/python 三处删除的是
  // analyzeFile / analyzeFallback / getTerminology / getTestPatterns 四个**必选**方法——
  // 那三处的删除依据才是"tsc 全权保证存在"；本处若援引同一套说辞是错的（变异实证：把
  // ts-js-adapter.ts 里 buildModuleGraph 改名后，`tsc --noEmit` 仍零错误通过，`typeof`
  // 检查论据被直接证伪）。本用例真正的删除依据是运行时覆盖：`buildModuleGraph` 已在
  // tests/integration/156-w1.2-v2.test.ts:122 与 :177 中被真实调用
  // （`tsAdapter!.buildModuleGraph!(...)`），方法缺失会在那两处报错变红（已变异验证），
  // 故删除此处仅做存在性检查的恒真用例。
});
