/**
 * sanitizeFilename() 单元测试
 * 测试先行（TDD）：在实现前确认测试失败
 * FR 追踪: FR-005
 */

import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../../src/panoramic/exporters/obsidian-exporter.js';

describe('sanitizeFilename', () => {
  it('正常文件名不含特殊字符时原样返回', () => {
    expect(sanitizeFilename('hello-world')).toBe('hello-world');
  });

  it('将 / 替换为 -', () => {
    const result = sanitizeFilename('src/utils/helper');
    expect(result).not.toContain('/');
    expect(result).toBe('src-utils-helper');
  });

  it('将 : 替换为 -', () => {
    const result = sanitizeFilename('module:type');
    expect(result).not.toContain(':');
    expect(result).toBe('module-type');
  });

  it('将 \\ 替换为 -', () => {
    const result = sanitizeFilename('path\\to\\file');
    expect(result).not.toContain('\\');
    expect(result).toBe('path-to-file');
  });

  it('将 * ? " 替换为 -', () => {
    expect(sanitizeFilename('file*.ts')).toBe('file-.ts');
    expect(sanitizeFilename('file?.ts')).toBe('file-.ts');
    expect(sanitizeFilename('file"name')).toBe('file-name');
  });

  it('将 < > | 替换为 -', () => {
    expect(sanitizeFilename('a<b>c')).toBe('a-b-c');
    expect(sanitizeFilename('a|b')).toBe('a-b');
  });

  it('将空格替换为 -', () => {
    expect(sanitizeFilename('hello world')).toBe('hello-world');
  });

  it('合并连续 - 为单个 -', () => {
    expect(sanitizeFilename('a//b')).toBe('a-b');
    expect(sanitizeFilename('a: b')).toBe('a-b');
    expect(sanitizeFilename('a---b')).toBe('a-b');
  });

  it('去除首部 -', () => {
    expect(sanitizeFilename('/leading')).toBe('leading');
  });

  it('去除尾部 -', () => {
    expect(sanitizeFilename('trailing/')).toBe('trailing');
  });

  it('去除首尾 -', () => {
    expect(sanitizeFilename('/both/')).toBe('both');
  });

  it('复合特殊字符：src/utils/helper:type', () => {
    expect(sanitizeFilename('src/utils/helper:type')).toBe('src-utils-helper-type');
  });

  it('module:type?x 的特殊字符处理', () => {
    const result = sanitizeFilename('module:type?x');
    expect(result).not.toMatch(/[/:*?"<>|\\]/);
    expect(result).toBe('module-type-x');
  });

  it('空字符串返回空字符串', () => {
    expect(sanitizeFilename('')).toBe('');
  });

  it('仅特殊字符时返回空字符串', () => {
    expect(sanitizeFilename('///')).toBe('');
  });

  it('长度恰好 200 的字符串不截断', () => {
    const name = 'a'.repeat(200);
    const result = sanitizeFilename(name);
    expect(result.length).toBe(200);
  });

  it('长度 201 时截断为前 195 字符 + 4 字符 FNV-1a 哈希', () => {
    const name = 'b'.repeat(201);
    const result = sanitizeFilename(name);
    // 195 前缀 + 4 位哈希 = 199 字符
    expect(result.length).toBe(199);
    expect(result.slice(0, 195)).toBe('b'.repeat(195));
    // 后 4 位是 16 进制哈希
    expect(result.slice(195)).toMatch(/^[0-9a-f]{4}$/);
  });

  it('长度超 200 的不同字符串产生不同哈希后缀', () => {
    const name1 = 'a'.repeat(201);
    const name2 = 'b'.repeat(201);
    const result1 = sanitizeFilename(name1);
    const result2 = sanitizeFilename(name2);
    expect(result1.slice(195)).not.toBe(result2.slice(195));
  });
});
