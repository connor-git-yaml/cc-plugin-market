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

  it('adapter.buildDependencyGraph 方法存在', () => {
    // 验证 buildDependencyGraph 方法存在且可调用
    expect(typeof adapter.buildDependencyGraph).toBe('function');
  });
});
