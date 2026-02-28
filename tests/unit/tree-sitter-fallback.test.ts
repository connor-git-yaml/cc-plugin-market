/**
 * tree-sitter-fallback 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeFallback } from '../../src/core/tree-sitter-fallback.js';

describe('analyzeFallback', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('可从文本提取导出与导入并标记 parserUsed=tree-sitter', async () => {
    const filePath = path.join(tempDir, 'sample.ts');
    fs.writeFileSync(
      filePath,
      `
import type { User } from './types';
import fs from 'node:fs';
import { helper as h } from './utils';

export interface IUser { id: string }
export const answer = 42;
export default function run() {}
`,
      'utf-8',
    );

    const skeleton = await analyzeFallback(filePath);
    expect(skeleton.parserUsed).toBe('tree-sitter');
    expect(skeleton.language).toBe('typescript');
    expect(skeleton.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(skeleton.parseErrors?.[0]?.message).toContain('降级');
    expect(skeleton.exports.some((e) => e.name === 'IUser')).toBe(true);
    expect(skeleton.exports.some((e) => e.name === 'answer')).toBe(true);
    expect(skeleton.imports.some((i) => i.moduleSpecifier === './types')).toBe(true);
    expect(skeleton.imports.some((i) => i.moduleSpecifier === 'node:fs')).toBe(true);
  });

  it('js 文件语言应识别为 javascript', async () => {
    const filePath = path.join(tempDir, 'sample.js');
    fs.writeFileSync(filePath, 'export function run() {}', 'utf-8');

    const skeleton = await analyzeFallback(filePath);
    expect(skeleton.language).toBe('javascript');
  });

  it('文件不存在时抛出可读错误', async () => {
    const missing = path.join(tempDir, 'missing.ts');
    await expect(analyzeFallback(missing)).rejects.toThrow('无法读取文件');
  });
});

