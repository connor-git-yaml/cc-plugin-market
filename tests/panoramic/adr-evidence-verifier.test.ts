/**
 * Feature 140 T41 — adr-evidence-verifier 单测
 *
 * 覆盖 spec FR-005 的所有验证分支：
 *  - 文件不存在 → verified=false (file-not-found)
 *  - 行号越界 → verified=false (line-out-of-range)
 *  - location 格式非法 → verified=false (invalid-location-format)
 *  - snippet 精确匹配 → verified=true
 *  - snippet 空白差 ≤ 10% → verified=true
 *  - snippet 差 > 10% → verified=false (snippet-mismatch)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  verifyEvidenceRefs,
  type EvidenceRefInput,
} from '../../src/panoramic/pipelines/adr-evidence-verifier.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-evidence-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): string {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return relPath;
}

describe('verifyEvidenceRefs — Feature 140 FR-005', () => {
  it('case 1: 文件不存在 → verified=false (file-not-found)', () => {
    const refs: EvidenceRefInput[] = [
      { source: 'src/missing.ts', location: 'L1-5', snippet: 'function foo()' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(false);
    expect(result[0]!.verificationReason).toBe('file-not-found');
  });

  it('case 2: 行号越界（>文件总行数）→ verified=false (line-out-of-range)', () => {
    writeFile('src/short.ts', 'line1\nline2\nline3');
    const refs: EvidenceRefInput[] = [
      { source: 'src/short.ts', location: 'L1-100', snippet: 'irrelevant' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(false);
    expect(result[0]!.verificationReason).toBe('line-out-of-range');
  });

  it('case 3: location 格式非法 → verified=false (invalid-location-format)', () => {
    writeFile('src/foo.ts', 'line1\nline2');
    const refs: EvidenceRefInput[] = [
      { source: 'src/foo.ts', location: 'invalid', snippet: 'line1' },
      { source: 'src/foo.ts', location: 'L0-5', snippet: 'line1' }, // 行号 < 1
      { source: 'src/foo.ts', location: 'L5-3', snippet: 'line1' }, // start > end
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    for (const r of result) {
      expect(r.verified).toBe(false);
      expect(r.verificationReason).toBe('invalid-location-format');
    }
  });

  it('case 4: snippet 精确匹配 → verified=true', () => {
    writeFile('src/foo.ts', 'line1\nfunction hello() {\n  return 42;\n}');
    const refs: EvidenceRefInput[] = [
      { source: 'src/foo.ts', location: 'L2-4', snippet: 'function hello() {\n  return 42;\n}' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(true);
    expect(result[0]!.verificationReason).toBeUndefined();
  });

  it('case 5: snippet 空白差异 ≤ 10% → verified=true（容忍格式漂移）', () => {
    writeFile('src/foo.ts', 'line1\nfunction hello() {\n  return 42;\n}');
    const refs: EvidenceRefInput[] = [
      // LLM 可能输出多余空格 / 改变缩进 / 改变换行风格
      {
        source: 'src/foo.ts',
        location: 'L2-4',
        snippet: 'function hello()  {  return  42;  }', // 多余空格 + 单行
      },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(true);
  });

  it('case 6: snippet 差 > 10% → verified=false (snippet-mismatch)', () => {
    writeFile('src/foo.ts', 'function hello() {\n  return 42;\n}');
    const refs: EvidenceRefInput[] = [
      {
        source: 'src/foo.ts',
        location: 'L1-3',
        // 完全不同的代码（LLM 编造）
        snippet: 'function bar() {\n  throw new Error("totally fabricated");\n}',
      },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(false);
    expect(result[0]!.verificationReason).toBe('snippet-mismatch');
  });

  it('case 7: 单行 location（L42 不带 dash）→ 视为单行范围', () => {
    writeFile('src/foo.ts', 'line1\nline2\nline3');
    const refs: EvidenceRefInput[] = [
      { source: 'src/foo.ts', location: 'L2', snippet: 'line2' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(true);
  });

  it('case 8: 绝对路径 source → 直接使用不拼接 projectRoot', () => {
    const absPath = writeFile('src/abs.ts', 'absolute test\n');
    const refs: EvidenceRefInput[] = [
      { source: path.join(tmpDir, absPath), location: 'L1', snippet: 'absolute test' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(true);
  });

  it('case 9: 多条 evidenceRef 混合（部分通过、部分失败）→ 各自标记', () => {
    writeFile('src/good.ts', 'real content\nmore real');
    const refs: EvidenceRefInput[] = [
      { source: 'src/good.ts', location: 'L1', snippet: 'real content' },
      { source: 'src/missing.ts', location: 'L1', snippet: 'fake' },
      { source: 'src/good.ts', location: 'L1', snippet: 'totally wrong fabricated content' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(true);
    expect(result[1]!.verified).toBe(false);
    expect(result[1]!.verificationReason).toBe('file-not-found');
    expect(result[2]!.verified).toBe(false);
    expect(result[2]!.verificationReason).toBe('snippet-mismatch');
  });

  it('case 10: 空 snippet 输入（防御性）→ 视为不匹配', () => {
    writeFile('src/foo.ts', 'real content');
    const refs: EvidenceRefInput[] = [
      { source: 'src/foo.ts', location: 'L1', snippet: '' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    expect(result[0]!.verified).toBe(false);
    expect(result[0]!.verificationReason).toBe('snippet-mismatch');
  });

  it('case 10b: path traversal — `../etc/passwd` 即便存在也视为 file-not-found（修复 Codex W-2）', () => {
    // 创建项目外的"文件"（用 tmpDir 父目录，模拟 path traversal）
    const outsideFile = path.join(path.dirname(tmpDir), 'outside.ts');
    fs.writeFileSync(outsideFile, 'sensitive content', 'utf-8');
    try {
      const refs: EvidenceRefInput[] = [
        // 用相对路径 ../outside.ts 试图跳出 projectRoot
        { source: '../outside.ts', location: 'L1', snippet: 'sensitive content' },
        // 也试绝对路径
        { source: outsideFile, location: 'L1', snippet: 'sensitive content' },
      ];
      const result = verifyEvidenceRefs(refs, tmpDir);
      // 两条都被视为 file-not-found（path traversal 防护）
      for (const r of result) {
        expect(r.verified).toBe(false);
        expect(r.verificationReason).toBe('file-not-found');
      }
    } finally {
      fs.rmSync(outsideFile, { force: true });
    }
  });

  it('case 11: 大小写敏感（snippet "Hello" vs file "hello"）→ 不匹配', () => {
    writeFile('src/foo.ts', 'function hello() {}');
    const refs: EvidenceRefInput[] = [
      { source: 'src/foo.ts', location: 'L1', snippet: 'function HELLO() {}' },
    ];
    const result = verifyEvidenceRefs(refs, tmpDir);
    // Hello 与 hello 编辑距离 = 1 / max(18, 18) = 0.056 ≤ 0.1
    // 实际：两个完全相同除大小写，距离 5（5 个字母），ratio = 5/19 = 26% > 10%
    // → 不匹配
    expect(result[0]!.verified).toBe(false);
  });
});
