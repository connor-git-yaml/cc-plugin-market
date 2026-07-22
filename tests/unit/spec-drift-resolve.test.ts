/**
 * T008：`scripts/lib/spec-drift-resolve.mjs` 单测（FR-001 / FR-002 / FR-009a,d / US1-AS5）。
 *
 * 基于 T007 fixture（`tests/fixtures/spec-drift/resolve/`），projectRoot 即该 fixture 目录，
 * 因此 ref 的 filePart 就是 `math-utils.ts` 等仓库（此处为 fixture 根）相对路径。
 *
 * 【实测边界，与 plan §6.4 的乐观表述不同】最小 graph 只含 ref 指定的那一个文件时：
 * - `exact` 是唯一可自动绑定的 matchKind；
 * - `levenshtein` 层置信度上限 0.75，恒低于 auto-resolve floor 0.9，故永不自动绑定：
 *   多候选 → ambiguous，单候选 → unresolved；
 * - `path-suffix` / `partial-name` 层在 file-qualified ref（FR-001 强制）下不可达。
 * 测试按**实测行为**断言，不按 plan 的乐观描述断言。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import {
  SUPPORTED_EXTENSIONS,
  parseManifest,
  resolveReferences,
} from '../../scripts/lib/spec-drift-resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'tests/fixtures/spec-drift/resolve');
const MANIFEST = path.join(FIXTURE_ROOT, 'manifest.json');

type ResolveResult = {
  id: string;
  status: string;
  symbolId: string | null;
  matchKind: string | null;
  fingerprint: string | null;
  resolvedFrom: string;
  reason?: string;
  candidates?: string[];
  preserved?: boolean;
};

let byId: Record<string, ResolveResult>;

beforeAll(async () => {
  const parsed = parseManifest(MANIFEST);
  expect(parsed.ok).toBe(true);
  const report = await resolveReferences(parsed.entries, { projectRoot: FIXTURE_ROOT });
  expect(report.reportStatus).toBe('ok');
  byId = Object.fromEntries(report.results.map((r: ResolveResult) => [r.id, r]));
});

describe('SUPPORTED_EXTENSIONS（N-3：MUST 与 TsJsLanguageAdapter 的八种扩展一致）', () => {
  it('恰好八种扩展，含 .mts/.cts', () => {
    expect([...SUPPORTED_EXTENSIONS].sort()).toEqual(
      ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'].sort(),
    );
  });
});

describe('parseManifest', () => {
  it('解析合法 JSON manifest', () => {
    const parsed = parseManifest(MANIFEST);
    expect(parsed.ok).toBe(true);
    expect(parsed.entries.length).toBeGreaterThanOrEqual(7);
    expect(parsed.entries[0]).toMatchObject({ id: 'r-exact', docPath: 'docs/a.md' });
  });

  it('文件不存在 → ok:false + manifest-missing', () => {
    const parsed = parseManifest(path.join(FIXTURE_ROOT, 'no-such-manifest.json'));
    expect(parsed).toMatchObject({ ok: false, reason: 'manifest-missing' });
  });

  it('非法 JSON → ok:false + manifest-parse-failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-manifest-'));
    const p = path.join(dir, 'm.json');
    fs.writeFileSync(p, '{ not json', 'utf8');
    expect(parseManifest(p)).toMatchObject({ ok: false, reason: 'manifest-parse-failed' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('条目缺必需字段 → ok:false + manifest-invalid-entry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-manifest-'));
    const p = path.join(dir, 'm.json');
    fs.writeFileSync(p, JSON.stringify([{ id: 'x', ref: 'a.ts::b' }]), 'utf8');
    expect(parseManifest(p)).toMatchObject({ ok: false, reason: 'manifest-invalid-entry' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('C-1 逐字段严格校验（仅查"存在性"会放过工具自产损坏 lock 的输入）', () => {
    function parseInline(entries: unknown): { ok: boolean; reason?: string; detail?: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-manifest-'));
      const p = path.join(dir, 'm.json');
      fs.writeFileSync(p, JSON.stringify(entries), 'utf8');
      const parsed = parseManifest(p);
      fs.rmSync(dir, { recursive: true, force: true });
      return parsed;
    }

    const valid = () => ({ id: 'x', ref: 'a.ts::b', docPath: 'docs/a.md', line: 3 });

    it.each(['id', 'ref', 'docPath'])('字符串字段 %s 为非字符串 → manifest-invalid-entry', (field) => {
      const parsed = parseInline([{ ...valid(), [field]: 42 }]);
      expect(parsed.ok).toBe(false);
      expect(parsed.reason).toBe('manifest-invalid-entry');
      expect(parsed.detail).toContain(field);
    });

    it.each(['id', 'ref', 'docPath'])('字符串字段 %s 为空串 / 全空白 → manifest-invalid-entry', (field) => {
      for (const value of ['', '  ']) {
        const parsed = parseInline([{ ...valid(), [field]: value }]);
        expect(parsed.ok, `${field}=${JSON.stringify(value)}`).toBe(false);
        expect(parsed.reason).toBe('manifest-invalid-entry');
      }
    });

    it.each([['字符串', '3'], ['零', 0], ['负数', -1], ['小数', 2.5], ['null', null]])(
      'line 为%s → manifest-invalid-entry',
      (_label, line) => {
        const parsed = parseInline([{ ...valid(), line }]);
        expect(parsed.ok).toBe(false);
        expect(parsed.detail).toContain('line');
      },
    );

    it('条目非对象（字符串 / 数组 / null）→ manifest-invalid-entry', () => {
      for (const entry of ['x', [1], null]) {
        const parsed = parseInline([entry]);
        expect(parsed.ok, JSON.stringify(entry)).toBe(false);
        expect(parsed.reason).toBe('manifest-invalid-entry');
      }
    });

    it('manifest 内 id 重复 → manifest-invalid-entry（id 是 lock 主键）', () => {
      const parsed = parseInline([valid(), { ...valid(), ref: 'a.ts::c' }]);
      expect(parsed.ok).toBe(false);
      expect(parsed.detail).toMatch(/重复/);
    });

    it('顶层 references 包装形态同样被逐字段校验', () => {
      const parsed = parseInline({ references: [{ ...valid(), line: 0 }] });
      expect(parsed.ok).toBe(false);
      expect(parsed.detail).toContain('line');
    });
  });
});

describe('W-7 路径 containment（ref 的 filePart 是不可信输入）', () => {
  it('`../` 逃逸出 project-root → unresolved，且 reason 明确指出逃逸', async () => {
    const report = await resolveReferences(
      [{ id: 'esc', ref: '../outside.ts::whatever', docPath: 'd.md', line: 1 }],
      { projectRoot: FIXTURE_ROOT },
    );
    const r = report.results[0];
    expect(r.status).toBe('unresolved');
    expect(r.reason).toMatch(/逃逸/);
    expect(r.symbolId).toBeNull();
  });

  it('绝对路径 ref → unresolved（不得读到 project-root 之外的真实文件）', async () => {
    const outsideAbs = path.join(REPO_ROOT, 'scripts/lib/spec-drift-paths.mjs');
    const report = await resolveReferences(
      [{ id: 'abs', ref: `${outsideAbs}::resolveWithinProject`, docPath: 'd.md', line: 1 }],
      { projectRoot: FIXTURE_ROOT },
    );
    const r = report.results[0];
    expect(r.status).toBe('unresolved');
    expect(r.reason).toMatch(/绝对路径|盘符|UNC/);
  });

  it('嵌套的 `a/../../b` 形式同样被拒（规范化后仍逃逸）', async () => {
    const report = await resolveReferences(
      [{ id: 'nested', ref: 'sub/../../outside.ts::x', docPath: 'd.md', line: 1 }],
      { projectRoot: FIXTURE_ROOT },
    );
    expect(report.results[0].status).toBe('unresolved');
    expect(report.results[0].reason).toMatch(/逃逸/);
  });
});

describe('resolveReferences —— 各状态命中面', () => {
  it('exact 命中：status ok + matchKind exact + canonical symbolId + 指纹已算出', () => {
    const r = byId['r-exact'];
    expect(r.status).toBe('ok');
    expect(r.matchKind).toBe('exact');
    expect(r.symbolId).toBe('math-utils.ts::computeTotal');
    expect(r.resolvedFrom).toBe('math-utils.ts::computeTotal');
    expect(r.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('拼写错误且同文件多候选 → ambiguous，返回 top-3 候选且不自动绑定', () => {
    const r = byId['r-typo'];
    expect(r.status).toBe('ambiguous');
    expect(r.symbolId).toBeNull();
    expect(r.candidates!.length).toBeGreaterThan(1);
    expect(r.candidates!.length).toBeLessThanOrEqual(3);
  });

  it('拼写错误但只有单个低置信候选 → unresolved（levenshtein 恒不到 auto-resolve 阈值）', () => {
    const r = byId['r-lone-typo'];
    expect(r.status).toBe('unresolved');
    expect(r.symbolId).toBeNull();
  });

  it('裸 symbol 名（非 file-qualified）→ unresolved（FR-001 硬合同）', () => {
    const r = byId['r-bare'];
    expect(r.status).toBe('unresolved');
    expect(r.symbolId).toBeNull();
    expect(r.reason).toMatch(/file-qualified/);
  });

  it('引用文件不存在 → unresolved', () => {
    const r = byId['r-missing-file'];
    expect(r.status).toBe('unresolved');
    expect(r.reason).toMatch(/文件不存在/);
  });

  it('member（Class.method）引用 MUST 被显式拒绝 → fingerprint-unavailable', () => {
    const r = byId['r-member'];
    expect(r.status).toBe('fingerprint-unavailable');
    expect(r.symbolId).toBeNull();
    expect(r.reason).toContain('member 粒度锚点本期不支持');
    expect(r.reason).toContain('top-level symbol');
  });

  it('非 TS/JS 语言（.py）→ unsupported-language，且 MUST NOT 有 fallback 指纹', () => {
    const r = byId['r-python'];
    expect(r.status).toBe('unsupported-language');
    expect(r.fingerprint).toBeNull();
    expect(r.symbolId).toBeNull();
  });
});

describe('--refresh 保留刷新前基线（US1-AS5 / W1）', () => {
  const baseline = {
    id: 'r-typo',
    symbolId: 'math-utils.ts::computeTotal',
    fingerprint: 'sha256:oldbaseline',
    matchKind: 'exact',
    resolvedFrom: 'math-utils.ts::computeTotal',
  };

  it('refresh 时重新解析落 ambiguous → 保留刷新前最后一次已知良好的 symbolId/fingerprint', async () => {
    const parsed = parseManifest(MANIFEST);
    const entries = parsed.entries.filter((e: { id: string }) => e.id === 'r-typo');
    const report = await resolveReferences(entries, {
      projectRoot: FIXTURE_ROOT,
      refresh: true,
      existingById: { 'r-typo': baseline },
    });
    const r = report.results[0];
    expect(r.status).toBe('ambiguous');
    expect(r.preserved).toBe(true);
    expect(r.symbolId).toBe(baseline.symbolId);
    expect(r.fingerprint).toBe(baseline.fingerprint);
  });

  it('refresh 时重新解析落 unresolved 且无基线 → 不伪造 symbolId', async () => {
    const parsed = parseManifest(MANIFEST);
    const entries = parsed.entries.filter((e: { id: string }) => e.id === 'r-bare');
    const report = await resolveReferences(entries, { projectRoot: FIXTURE_ROOT, refresh: true });
    expect(report.results[0].status).toBe('unresolved');
    expect(report.results[0].symbolId).toBeNull();
    expect(report.results[0].preserved).toBeFalsy();
  });
});

describe('dist 不可用降级（FR-011）', () => {
  it('distRoot 下无 dist/ 编译产物 → report 级 graph-unavailable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-nodist-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function foo() { return 1; }\n', 'utf8');
    const report = await resolveReferences(
      [{ id: 'x', ref: 'a.ts::foo', docPath: 'd.md', line: 1 }],
      { projectRoot: dir, distRoot: dir },
    );
    expect(report.reportStatus).toBe('graph-unavailable');
    expect(report.reason).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
