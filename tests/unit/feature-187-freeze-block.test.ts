/**
 * Feature 187 — freezeBlock 语义冻结扩展单测（spec FR-005 / SC-009 / Codex C-2）。
 *
 * 核心：oracleSpecHash 覆盖 3 个判分语义模块源码摘要 → 改任一模块 hash 必变（堵"跑前换判分/改分类代码"）；
 * checkPreregistration 对 swebench-execution kind 强制 oracleSpecHash，不符即拦截。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  computeOracleSpecHash, readSemanticModuleShas, freezeBlock, parsePreregistration,
  checkPreregistration, computeTaskSetHash, FREEZE_SCHEMA_VERSION, SEMANTIC_MODULES,
} from '../../scripts/lib/preregistration-check.mjs';

const BASE_SPEC = {
  kind: 'swebench-execution', timeout: 300000, arch: 'arm64-first', datasetSource: 'local-jsonl',
  swebenchVersion: '4.1.0',
  semanticModuleShas: { 'classify-oracle.mjs': 'a'.repeat(64), 'phase-markers.mjs': 'b'.repeat(64), 'swebench-oracle.mjs': 'c'.repeat(64) },
};

describe('computeOracleSpecHash — 覆盖判分语义模块（Codex C-2）', () => {
  it('确定性：相同输入 → 相同 hash', () => {
    expect(computeOracleSpecHash(BASE_SPEC)).toBe(computeOracleSpecHash({ ...BASE_SPEC }));
  });

  it('改 classify-oracle.mjs 摘要 → hash 变化', () => {
    const mutated = { ...BASE_SPEC, semanticModuleShas: { ...BASE_SPEC.semanticModuleShas, 'classify-oracle.mjs': 'd'.repeat(64) } };
    expect(computeOracleSpecHash(mutated)).not.toBe(computeOracleSpecHash(BASE_SPEC));
  });

  it('改 phase-markers.mjs 摘要 → hash 变化（打点逻辑也是判分语义）', () => {
    const mutated = { ...BASE_SPEC, semanticModuleShas: { ...BASE_SPEC.semanticModuleShas, 'phase-markers.mjs': 'e'.repeat(64) } };
    expect(computeOracleSpecHash(mutated)).not.toBe(computeOracleSpecHash(BASE_SPEC));
  });

  it('改 swebench-oracle.mjs 摘要 → hash 变化', () => {
    const mutated = { ...BASE_SPEC, semanticModuleShas: { ...BASE_SPEC.semanticModuleShas, 'swebench-oracle.mjs': 'f'.repeat(64) } };
    expect(computeOracleSpecHash(mutated)).not.toBe(computeOracleSpecHash(BASE_SPEC));
  });

  it('改 timeout/arch 也变 hash', () => {
    expect(computeOracleSpecHash({ ...BASE_SPEC, timeout: 900000 })).not.toBe(computeOracleSpecHash(BASE_SPEC));
  });
});

describe('readSemanticModuleShas — 真实读 3 个语义模块', () => {
  it('返回 3 个模块的 sha256', () => {
    const shas = readSemanticModuleShas();
    for (const m of SEMANTIC_MODULES) {
      expect(shas[m], m).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('freezeBlock 扩展字段（FR-005）', () => {
  it('含 schemaVersion；传 oracleSpecInput 时算 oracleSpecHash', () => {
    const b = freezeBlock(['T1', 'T2'], { oracleSpecInput: BASE_SPEC, fixtureContentHash: 'x'.repeat(64), datasetSourceDigest: 'y'.repeat(64) });
    expect(b.schemaVersion).toBe(FREEZE_SCHEMA_VERSION);
    expect(b.oracleSpecHash).toBe(computeOracleSpecHash(BASE_SPEC));
    expect(b.fixtureContentHash).toBe('x'.repeat(64));
    expect(b.datasetSourceDigest).toBe('y'.repeat(64));
  });

  it('向后兼容：不传新字段时仍产出合法 taskSetHash', () => {
    const b = freezeBlock(['T1'], { seed: 's' });
    expect(b.taskSetHash).toBe(computeTaskSetHash(['T1']));
    expect(b.oracleSpecHash).toBeUndefined();
  });
});

describe('checkPreregistration — swebench-execution oracleSpecHash 门禁（SC-009）', () => {
  let dir: string;
  const taskIds = ['SWE-L001', 'SWE-L002'];
  const hash = computeTaskSetHash(taskIds);
  const oracleSpecHash = computeOracleSpecHash(BASE_SPEC);

  const writePrereg = (extra: string) => {
    const p = path.join(dir, `prereg-${Math.abs(hashCode(extra))}.md`);
    fs.writeFileSync(p, `---\nfrozen: true\ntaskSetHash: "${hash}"\n${extra}taskIds: [${taskIds.map((t) => `"${t}"`).join(', ')}]\n---\nbody\n`);
    return p;
  };
  function hashCode(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f187-prereg-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('swebench-execution + 缺 oracleSpecHash → hard-fail', () => {
    const p = writePrereg('');
    const r = checkPreregistration(taskIds, p, { oracleKind: 'swebench-execution' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/oracleSpecHash/);
  });

  it('swebench-execution + oracleSpecHash 匹配 live input → ok', () => {
    const p = writePrereg(`oracleSpecHash: "${oracleSpecHash}"\n`);
    const r = checkPreregistration(taskIds, p, { oracleKind: 'swebench-execution', oracleSpecInput: BASE_SPEC });
    expect(r.ok).toBe(true);
  });

  it('swebench-execution + oracleSpecHash 与 live 不符（改了分类代码）→ 拦截', () => {
    const p = writePrereg(`oracleSpecHash: "${oracleSpecHash}"\n`);
    const tampered = { ...BASE_SPEC, semanticModuleShas: { ...BASE_SPEC.semanticModuleShas, 'classify-oracle.mjs': '0'.repeat(64) } };
    const r = checkPreregistration(taskIds, p, { oracleKind: 'swebench-execution', oracleSpecInput: tampered });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/oracleSpecHash 不符/);
  });

  it('非 swebench-execution kind + 缺 oracleSpecHash → 放行 + warn（向后兼容旧 F176 prereg）', () => {
    const p = writePrereg('');
    const r = checkPreregistration(taskIds, p, { oracleKind: 'ast-diff' });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w: string) => /oracleSpecHash/.test(w))).toBe(true);
  });
});
