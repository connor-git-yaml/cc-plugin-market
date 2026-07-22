/**
 * T010：`scripts/lib/spec-drift-fingerprint.mjs` 单测 —— **C1 过渡态范围**。
 *
 * ⚠️ 本阶段指纹算法是迁移自 F189 prototype 的「symbol 源切片 + 逐行空白归一化」，
 * `normalizationProfile = 'source-slice-whitespace-v1'`。
 * 因此 SC-001 承诺的「注释 / JSDoc / 格式化改动判 fresh」**在本阶段尚未成立**——
 * 本文件只断言过渡态的真实语义；C3（T030）会重写并扩展为 canonical AST 语义全集。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import {
  FINGERPRINT_VERSION,
  NORMALIZATION_PROFILE,
  normalizeWhitespace,
  computeCanonicalFingerprint,
  createSharedProject,
  hasSyntacticErrors,
} from '../../scripts/lib/spec-drift-fingerprint.mjs';

const SOURCE = [
  '// 头部注释',
  'export function addNumbers(a: number, b: number): number {',
  '  const total = a + b;',
  '  return total;',
  '}',
  '',
  'export function other(): void {}',
].join('\n');

/** symbol addNumbers 的 1-based 闭区间 span */
const SPAN = { startLine: 2, endLine: 5 };

const fp = (sourceText: string, span = SPAN) =>
  computeCanonicalFingerprint({ sourceText, ...span }) as string;

describe('spec-drift-fingerprint（C1 过渡态）', () => {
  it('版本常量：FINGERPRINT_VERSION 为 "1"，NORMALIZATION_PROFILE 为 source-slice-whitespace-v1', () => {
    expect(FINGERPRINT_VERSION).toBe('1');
    expect(NORMALIZATION_PROFILE).toBe('source-slice-whitespace-v1');
  });

  it('指纹格式为 sha256:<64 位十六进制>', () => {
    expect(fp(SOURCE)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('同一 symbol 未改动时指纹稳定不变（多次计算一致）', () => {
    expect(fp(SOURCE)).toBe(fp(SOURCE));
  });

  it('改标识符 → 指纹不同', () => {
    const changed = SOURCE.replace('const total', 'const sum').replace('return total', 'return sum');
    expect(fp(changed)).not.toBe(fp(SOURCE));
  });

  it('改字面值/运算符 → 指纹不同', () => {
    const changed = SOURCE.replace('a + b', 'a - b');
    expect(fp(changed)).not.toBe(fp(SOURCE));
  });

  it('同文件他处（span 外）改动不影响本 span 指纹', () => {
    const changed = SOURCE.replace('export function other(): void {}', 'export function other(): number { return 42; }');
    expect(fp(changed)).toBe(fp(SOURCE));
  });

  it('[过渡态语义] span 内注释改动 → 指纹不同（SC-001 的注释免疫是 C3 目标，此阶段尚未成立）', () => {
    const withComment = SOURCE.replace('  return total;', '  // 求和结果\n  return total;');
    // span 也随之变长一行
    expect(fp(withComment, { startLine: 2, endLine: 6 })).not.toBe(fp(SOURCE));
  });

  it('[过渡态语义] 仅缩进 / 行内空白改动 → 指纹相同（逐行空白归一化）', () => {
    const reindented = SOURCE.replace('  const total = a + b;', '      const  total  =  a  +  b;');
    expect(fp(reindented)).toBe(fp(SOURCE));
  });

  it('normalizeWhitespace：折叠行内空白 + 去首尾 + 丢空行，但保留换行结构（ASI 语义安全）', () => {
    expect(normalizeWhitespace('  a  =  1 ;\n\n\t b = 2 ')).toBe('a = 1 ;\nb = 2');
    // 换行不可被折叠：`return\n1` 与 `return 1` 在 ASI 下语义不同
    expect(normalizeWhitespace('return\n1')).not.toBe(normalizeWhitespace('return 1'));
  });

  it('span 越界（startLine 超出文件行数）→ 返回 null，不静默产出错误指纹', () => {
    expect(computeCanonicalFingerprint({ sourceText: SOURCE, startLine: 999, endLine: 1000 })).toBeNull();
  });

  it('W-6：仅 endLine 越界（startLine 合法）→ 返回 null，MUST NOT 静默截断到文件末尾', () => {
    const totalLines = SOURCE.split('\n').length;
    // 截断行为的危险在于：它会与"把 symbol 尾部若干行删掉"产生同一个指纹，
    // 使真实 drift 被判 fresh。故越界必须返回 null（→ fingerprint-unavailable）。
    expect(computeCanonicalFingerprint({ sourceText: SOURCE, startLine: 2, endLine: totalLines + 1 })).toBeNull();
    // 恰好等于总行数是合法边界，不得误判
    expect(computeCanonicalFingerprint({ sourceText: SOURCE, startLine: 2, endLine: totalLines })).not.toBeNull();
  });

  it('W-6：startLine > endLine 或非正 startLine → 返回 null', () => {
    expect(computeCanonicalFingerprint({ sourceText: SOURCE, startLine: 5, endLine: 2 })).toBeNull();
    expect(computeCanonicalFingerprint({ sourceText: SOURCE, startLine: 0, endLine: 3 })).toBeNull();
  });

  describe('hasSyntacticErrors（供 check 侧 parser-health 判定，plan §9.1 步骤 4）', () => {
    const withTmpFile = (name: string, content: string, fn: (abs: string) => void) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fp-'));
      const abs = path.join(dir, name);
      fs.writeFileSync(abs, content, 'utf8');
      try {
        fn(abs);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    it('语法完好的文件 → hasErrors 为 false', () => {
      withTmpFile('ok.ts', 'export const foo = 1;\n', (abs) => {
        const project = createSharedProject();
        expect(hasSyntacticErrors(project, abs)).toEqual({ ok: true, hasErrors: false });
      });
    });

    it('语法错误的文件 → hasErrors 为 true（ts-morph 错误恢复不抛异常，必须靠语法诊断判定）', () => {
      withTmpFile('bad.ts', 'export const foo = ;\n', (abs) => {
        const project = createSharedProject();
        expect(hasSyntacticErrors(project, abs)).toEqual({ ok: true, hasErrors: true });
      });
    });

    it('纯类型错误（语法完好）→ hasErrors 为 false（MUST NOT 用 getPreEmitDiagnostics 误判）', () => {
      withTmpFile('typeerr.ts', 'export const foo: number = "not a number";\n', (abs) => {
        const project = createSharedProject();
        expect(hasSyntacticErrors(project, abs)).toEqual({ ok: true, hasErrors: false });
      });
    });
  });
});
