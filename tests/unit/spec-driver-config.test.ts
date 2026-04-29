/**
 * Feature 146: spec-driver.config.yaml 的 batch.concurrency 字段读取
 *
 * 重点覆盖 Codex 对抗审查 CRITICAL #2 修复：
 * 字符串数字（YAML quoted "3"）必须可解析，不能静默 fallback 为 undefined，
 * 否则 CLI > config > 默认值的优先级链对配置层失效。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readBatchConcurrency } from '../../src/config/spec-driver-config.js';

describe('readBatchConcurrency — Feature 146 配置读取', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spec-driver-config-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(content: string): void {
    writeFileSync(join(tmpDir, 'spec-driver.config.yaml'), content);
  }

  it('文件不存在 → undefined（调用方降级到默认值）', () => {
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });

  it('字段不存在 → undefined', () => {
    writeConfig('preset: balanced\n');
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });

  it('batch 节存在但无 concurrency → undefined', () => {
    writeConfig('batch:\n  other: value\n');
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });

  it('数字字段 → 直接返回', () => {
    writeConfig('batch:\n  concurrency: 5\n');
    expect(readBatchConcurrency(tmpDir)).toBe(5);
  });

  it('CRITICAL #2: 字符串数字 "3" → 解析为 3（YAML quoted 形式）', () => {
    writeConfig('batch:\n  concurrency: "3"\n');
    expect(readBatchConcurrency(tmpDir)).toBe(3);
  });

  it('CRITICAL #2: 字符串数字 "10" → 解析为 10', () => {
    writeConfig("batch:\n  concurrency: '10'\n");
    expect(readBatchConcurrency(tmpDir)).toBe(10);
  });

  it('CRITICAL #2: 带前后空格的字符串数字 → 解析成功', () => {
    writeConfig('batch:\n  concurrency: "  4  "\n');
    expect(readBatchConcurrency(tmpDir)).toBe(4);
  });

  it('小数字段 → 原样返回（由 normalizeConcurrency 兜底 floor）', () => {
    writeConfig('batch:\n  concurrency: 3.7\n');
    expect(readBatchConcurrency(tmpDir)).toBe(3.7);
  });

  it('负数字段 → 原样返回（由 normalizeConcurrency 兜底规范化为 1）', () => {
    writeConfig('batch:\n  concurrency: -1\n');
    expect(readBatchConcurrency(tmpDir)).toBe(-1);
  });

  it('非数字字符串（"abc"）→ undefined', () => {
    writeConfig('batch:\n  concurrency: "abc"\n');
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });

  it('空字符串 → undefined', () => {
    writeConfig('batch:\n  concurrency: ""\n');
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });

  it('布尔值 → undefined', () => {
    writeConfig('batch:\n  concurrency: true\n');
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });

  it('数组 → undefined', () => {
    writeConfig('batch:\n  concurrency: [1, 2, 3]\n');
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });

  it('YAML 解析失败（语法错误）→ undefined', () => {
    writeConfig('batch:\n  concurrency: : invalid : yaml\n');
    expect(readBatchConcurrency(tmpDir)).toBeUndefined();
  });
});
