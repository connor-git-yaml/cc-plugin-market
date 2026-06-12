/**
 * Feature 182 — skeleton-hash 唯一权威 hash 实现单元测试
 *
 * 覆盖场景：
 * (a) 单文件 combineSkeletonHashes 直接返回原始 hash（不经二次 sha256）
 * (b) code-unit 序 vs localeCompare 序差异用例：合并结果使用 code-unit 排序
 * (c) 混合大小写确定性：相同文件集不同传入顺序产生相同 hash（排序幂等性）
 * (d) wrapper 层单文件返回与分析产物一致
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { analyzeFiles } from '../../src/core/ast-analyzer.js';
import {
  combineSkeletonHashes,
  computeModuleSkeletonHash,
  type SkeletonHashEntry,
} from '../../src/core/skeleton-hash.js';

describe('combineSkeletonHashes（纯函数）', () => {
  it('(a) 单文件直接返回原始 hash，不经二次 sha256', () => {
    const rawHash = 'a'.repeat(64);
    const result = combineSkeletonHashes([{ sortKey: 'src/only.ts', hash: rawHash }]);
    expect(result).toBe(rawHash);
  });

  it('(b) code-unit 序与 localeCompare 序相反时，合并使用 code-unit 排序', () => {
    // Zebra（Z=90）与 apple（a=97）：code-unit 下 Zebra < apple（大写在前），
    // localeCompare 下 apple < Zebra（大小写不敏感 a < z）—— 两序相反。
    const hashZ = 'z'.repeat(64);
    const hashA = '1'.repeat(64);
    const entries: SkeletonHashEntry[] = [
      { sortKey: 'src/apple.ts', hash: hashA },
      { sortKey: 'src/Zebra.ts', hash: hashZ },
    ];

    const result = combineSkeletonHashes(entries);

    // code-unit 排序：Zebra 在前 → hashZ + hashA
    const expectedCodeUnit = createHash('sha256').update(hashZ + hashA).digest('hex');
    // localeCompare 排序（旧读侧公式）：apple 在前 → hashA + hashZ
    const localeCompareResult = createHash('sha256').update(hashA + hashZ).digest('hex');

    expect(result).toBe(expectedCodeUnit);
    expect(result).not.toBe(localeCompareResult);
  });

  it('(c) 相同文件集不同传入顺序产生相同 hash（排序幂等）', () => {
    const entriesOrder1: SkeletonHashEntry[] = [
      { sortKey: 'src/Button.ts', hash: 'b'.repeat(64) },
      { sortKey: 'src/input.ts', hash: 'i'.repeat(64) },
      { sortKey: 'src/Zebra.ts', hash: 'z'.repeat(64) },
    ];
    const entriesOrder2: SkeletonHashEntry[] = [
      entriesOrder1[2]!,
      entriesOrder1[0]!,
      entriesOrder1[1]!,
    ];

    expect(combineSkeletonHashes(entriesOrder1)).toBe(combineSkeletonHashes(entriesOrder2));
  });

  it('(c-2) 不同公共祖先 base 下 code-unit 相对序不变 → hash 一致', () => {
    // 写侧 cwd-relative 与读侧 projectRoot-relative 仅差公共前缀，相对序应一致。
    const cwdRelative: SkeletonHashEntry[] = [
      { sortKey: 'Zebra.ts', hash: 'z'.repeat(64) },
      { sortKey: 'apple.ts', hash: '1'.repeat(64) },
    ];
    const projectRelative: SkeletonHashEntry[] = [
      { sortKey: 'src/components/Zebra.ts', hash: 'z'.repeat(64) },
      { sortKey: 'src/components/apple.ts', hash: '1'.repeat(64) },
    ];

    expect(combineSkeletonHashes(cwdRelative)).toBe(combineSkeletonHashes(projectRelative));
  });
});

describe('computeModuleSkeletonHash（wrapper）', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skeleton-hash-'));
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext' } }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
  });

  it('(d) 单文件 wrapper 返回与 analyzeFiles 产物一致', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'only.ts'),
      'export function f(x: string): string {\n  return x.trim();\n}\n',
      'utf-8',
    );

    const result = await computeModuleSkeletonHash(projectRoot, ['src/only.ts']);
    const analyzed = await analyzeFiles([path.join(projectRoot, 'src', 'only.ts')]);

    expect(result).toBe(analyzed[0]!.hash);
  });

  it('空文件集返回 undefined', async () => {
    expect(await computeModuleSkeletonHash(projectRoot, [])).toBeUndefined();
  });

  it('多文件确定性：相同文件集传入顺序不影响 hash', async () => {
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'Alpha.ts'),
      'export const a = 1;\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'beta.ts'),
      'export const b = 2;\n',
      'utf-8',
    );

    const order1 = await computeModuleSkeletonHash(projectRoot, ['src/Alpha.ts', 'src/beta.ts']);
    const order2 = await computeModuleSkeletonHash(projectRoot, ['src/beta.ts', 'src/Alpha.ts']);

    expect(order1).toBeDefined();
    expect(order1).toBe(order2);
  });
});
