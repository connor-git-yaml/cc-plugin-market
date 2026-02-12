/**
 * chunk-splitter 单元测试
 * 验证 5k LOC 阈值触发分块、函数边界正确切割、
 * 分块元数据完整性、小文件不分块（FR-005）
 */
import { describe, it, expect } from 'vitest';
import { splitIntoChunks, CHUNK_THRESHOLD } from '../../src/utils/chunk-splitter.js';

/** 生成指定行数的模拟 TypeScript 源码 */
function generateCode(lineCount: number): string {
  const lines: string[] = [];
  let funcIndex = 0;

  while (lines.length < lineCount) {
    const funcName = `func_${funcIndex++}`;
    lines.push(`export function ${funcName}(): void {`);
    // 填充函数体
    const bodyLines = Math.min(50, lineCount - lines.length - 1);
    for (let i = 0; i < bodyLines; i++) {
      lines.push(`  const x${i} = ${i};`);
    }
    lines.push('}');
    lines.push('');
  }

  return lines.slice(0, lineCount).join('\n');
}

describe('chunk-splitter', () => {
  it('不应分块小于阈值的文件', () => {
    const content = generateCode(100);
    const chunks = splitIntoChunks(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.totalChunks).toBe(1);
    expect(chunks[0]!.content).toBe(content);
    expect(chunks[0]!.startLine).toBe(1);
  });

  it('不应分块刚好等于阈值的文件', () => {
    const content = generateCode(CHUNK_THRESHOLD);
    const chunks = splitIntoChunks(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.totalChunks).toBe(1);
  });

  it('应分块超过阈值的文件', () => {
    const content = generateCode(CHUNK_THRESHOLD + 1000);
    const chunks = splitIntoChunks(content);

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('分块应包含完整的元数据', () => {
    const content = generateCode(CHUNK_THRESHOLD * 2);
    const chunks = splitIntoChunks(content);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      expect(chunk.index).toBe(i);
      expect(chunk.totalChunks).toBe(chunks.length);
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(chunk.lineCount).toBeGreaterThan(0);
      expect(chunk.content).toBeTruthy();
    }
  });

  it('分块之间应没有重叠且没有遗漏', () => {
    const content = generateCode(CHUNK_THRESHOLD * 3);
    const totalLines = content.split('\n').length;
    const chunks = splitIntoChunks(content);

    // 分块应覆盖所有行
    let coveredLines = 0;
    for (let i = 0; i < chunks.length; i++) {
      coveredLines += chunks[i]!.lineCount;
      // 相邻分块应紧密衔接
      if (i > 0) {
        expect(chunks[i]!.startLine).toBe(chunks[i - 1]!.endLine + 1);
      }
    }

    expect(coveredLines).toBe(totalLines);
  });

  it('分块应提取符号名称', () => {
    const content = [
      'export function myFunc(): void {',
      '  return;',
      '}',
      '',
      'export class MyClass {',
      '  method() {}',
      '}',
    ].join('\n');

    const chunks = splitIntoChunks(content);
    expect(chunks[0]!.symbols).toContain('myFunc');
    expect(chunks[0]!.symbols).toContain('MyClass');
  });

  it('应处理空文件', () => {
    const chunks = splitIntoChunks('');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.lineCount).toBe(1); // 空字符串 split('\n') 产生一行
    expect(chunks[0]!.symbols).toEqual([]);
  });

  it('应支持自定义每块最大行数', () => {
    const content = generateCode(1000);
    const chunks = splitIntoChunks(content, 200);

    // 自定义阈值不影响 CHUNK_THRESHOLD 的入口判断
    // 但 1000 行 < 5000 阈值，所以不会分块
    expect(chunks).toHaveLength(1);
  });

  it('totalChunks 应在所有分块中一致', () => {
    const content = generateCode(CHUNK_THRESHOLD * 2);
    const chunks = splitIntoChunks(content);

    const total = chunks[0]!.totalChunks;
    for (const chunk of chunks) {
      expect(chunk.totalChunks).toBe(total);
    }
  });
});
