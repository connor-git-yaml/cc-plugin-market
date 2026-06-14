/**
 * Feature 176 — 预注册一致性校验单测（tasks T-A3；FR-A-002b 防 falsification 规避）。
 */
import { describe, expect, it } from 'vitest';
import {
  computeTaskSetHash,
  checkPreregistration,
  parsePreregistration,
  freezeBlock,
  computeOracleSpecHash,
  computeFixtureContentHash,
} from '../../scripts/lib/preregistration-check.mjs';
import { computeDriverPromptSha256 } from '../../scripts/eval-task-runner.mjs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// W1-W6（F197）共用：构造 swebench-execution 预注册产物。须含 taskSetHash + oracleSpecHash
// （否则 :157 缺-oracleSpecHash hard-fail 提前拦截，测不到 promptSha256/fixtureContentHash/gitState 真实比对）。
const SWEBENCH_SPEC = {
  kind: 'swebench-execution', timeout: 300000, arch: 'arm64-first', datasetSource: 'local-jsonl',
  swebenchVersion: '4.1.0',
  semanticModuleShas: { 'classify-oracle.mjs': 'a'.repeat(64) },
};

function writeSwebenchPrereg(dir: string, ids: string[], extraLines: string[] = []) {
  const hash = computeTaskSetHash(ids);
  const oracleSpecHash = computeOracleSpecHash(SWEBENCH_SPEC);
  const p = path.join(dir, `swebench-prereg-${Math.random().toString(36).slice(2)}.md`);
  const fm = [
    '---', 'frozen: true', `taskSetHash: ${hash}`, `oracleSpecHash: ${oracleSpecHash}`,
    ...extraLines, `taskIds: [${ids.map((t) => `"${t}"`).join(', ')}]`, '---', 'body',
  ].join('\n');
  fs.writeFileSync(p, fm);
  return p;
}

describe('computeTaskSetHash', () => {
  it('顺序无关', () => {
    expect(computeTaskSetHash(['b', 'a', 'c'])).toBe(computeTaskSetHash(['c', 'b', 'a']));
  });
  it('去重', () => {
    expect(computeTaskSetHash(['a', 'a', 'b'])).toBe(computeTaskSetHash(['a', 'b']));
  });
  it('不同集合不同 hash', () => {
    expect(computeTaskSetHash(['a', 'b'])).not.toBe(computeTaskSetHash(['a', 'b', 'c']));
  });
});

describe('checkPreregistration', () => {
  function writePrereg(dir: string, ids: string[], frozen: boolean) {
    const hash = computeTaskSetHash(ids);
    const p = path.join(dir, 'preregistration.md');
    fs.writeFileSync(
      p,
      `---\nfrozen: ${frozen}\ntaskSetHash: ${hash}\ntaskIds: [${ids.join(', ')}]\n---\n# prereg\n`,
    );
    return p;
  }

  it('task 集一致 → ok', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-prereg-'));
    const p = writePrereg(dir, ['t1', 't2', 't3'], true);
    expect(checkPreregistration(['t3', 't1', 't2'], p).ok).toBe(true);
  });

  it('task 集不符（跑后换 task）→ hard-fail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-prereg-'));
    const p = writePrereg(dir, ['t1', 't2', 't3'], true);
    const r = checkPreregistration(['t1', 't2', 'tX'], p);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不符');
  });

  it('未冻结 → fail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-prereg-'));
    const p = writePrereg(dir, ['t1'], false);
    expect(checkPreregistration(['t1'], p).ok).toBe(false);
  });

  it('文件不存在 → fail', () => {
    expect(checkPreregistration(['t1'], '/nonexistent/prereg.md').ok).toBe(false);
  });
});

describe('freezeBlock', () => {
  it('产出 frozen=true + 排序 taskIds + hash', () => {
    const b = freezeBlock(['t2', 't1'], { seed: 176 });
    expect(b.frozen).toBe(true);
    expect(b.taskIds).toEqual(['t1', 't2']);
    expect(b.taskSetHash).toBe(computeTaskSetHash(['t1', 't2']));
    expect(b.count).toBe(2);
  });
});

describe('freeze-preregistration 脚本（runbook 4c 自动化）', async () => {
  const { renderFrozenPrereg, listFixtureTaskIds } = await import('../../scripts/freeze-preregistration.mjs');

  it('渲染→解析→校验 round-trip（多行 taskIds 列表）', () => {
    const original = '---\nfrozen: false\ntaskSetHash: TBD\n---\n\n# 正文保留\n不变量段落。\n';
    const block = freezeBlock(['SWE-V002-b', 'SWE-V001-a'], { seed: 176 });
    const next = renderFrozenPrereg(original, block, 'abc123def456');
    // 正文保留
    expect(next).toContain('# 正文保留');
    // 解析回来与冻结块一致
    const parsed = parsePreregistration(next);
    expect(parsed.frozen).toBe(true);
    expect(parsed.taskIds).toEqual(['SWE-V001-a', 'SWE-V002-b']);
    expect(parsed.hash).toBe(block.taskSetHash);
    // checkPreregistration 闭环
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-freeze-'));
    const p = path.join(dir, 'preregistration.md');
    fs.writeFileSync(p, next);
    expect(checkPreregistration(['SWE-V002-b', 'SWE-V001-a'], p).ok).toBe(true);
    expect(checkPreregistration(['SWE-V001-a', 'tampered'], p).ok).toBe(false);
  });

  it('listFixtureTaskIds 过滤 _ 前缀与非 json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-fx-'));
    fs.writeFileSync(path.join(dir, 'SWE-V001-a.json'), '{}');
    fs.writeFileSync(path.join(dir, 'SWE-V001-a.goldpatch.diff'), '');
    fs.writeFileSync(path.join(dir, '_DEGRADATION_NOTE.md'), '');
    expect(listFixtureTaskIds(dir)).toEqual(['SWE-V001-a']);
  });
});

// ───────────────────────────────────────────────────────────
// F197 W2：promptSha256 比对（write-only → 解析+比对闭环）
// ───────────────────────────────────────────────────────────

describe('W2 promptSha256比对', () => {
  const ids = ['SWE-V001-a', 'SWE-V002-b'];
  const livePrompt = 'p'.repeat(64);

  it('computeDriverPromptSha256() 确定性 + 钉死定义 = sha256(buildDriverPrompt.toString())', async () => {
    const a = computeDriverPromptSha256();
    const b = computeDriverPromptSha256();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // 钉死定义（W-6）：与 sha256(buildDriverPrompt 源码) 逐字一致
    const crypto = await import('node:crypto');
    const { buildDriverPrompt } = await import('../../scripts/eval-task-runner.mjs');
    const expected = crypto.createHash('sha256').update(buildDriverPrompt.toString()).digest('hex');
    expect(a).toBe(expected);
  });

  it('改 buildDriverPrompt 源一字节 → hash 变（用独立 fixture 函数模拟，不改生产函数）', async () => {
    const crypto = await import('node:crypto');
    const fakePromptV1 = (x: string) => `prompt:${x}`;
    const fakePromptV2 = (x: string) => `prompt :${x}`; // 多一个空格
    const h1 = crypto.createHash('sha256').update(fakePromptV1.toString()).digest('hex');
    const h2 = crypto.createHash('sha256').update(fakePromptV2.toString()).digest('hex');
    expect(h1).not.toBe(h2);
  });

  it('prereg 含 promptSha256 + opts 传不符 live → ok=false 且 reason 含 promptSha256', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w2-'));
    const p = writeSwebenchPrereg(dir, ids, [`promptSha256: ${'f'.repeat(64)}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, promptSha256: livePrompt });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/promptSha256/);
  });

  it('prereg 无 promptSha256，opts 传 live → ok=true（向后兼容）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w2-'));
    const p = writeSwebenchPrereg(dir, ids, []);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, promptSha256: livePrompt });
    expect(r.ok).toBe(true);
  });

  it('prereg 有 promptSha256，opts 不传 → ok=true（只 present+live 才比对）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w2-'));
    const p = writeSwebenchPrereg(dir, ids, [`promptSha256: ${livePrompt}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC });
    expect(r.ok).toBe(true);
  });

  it('prereg 与 opts promptSha256 一致 → ok=true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w2-'));
    const p = writeSwebenchPrereg(dir, ids, [`promptSha256: ${livePrompt}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, promptSha256: livePrompt });
    expect(r.ok).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// F197 W3：gitState 外锚拦截
// ───────────────────────────────────────────────────────────

describe('W3 gitState外锚', () => {
  const ids = ['SWE-V001-a', 'SWE-V002-b'];
  const frozenCommit = '55696ab';

  it('trackedClean=false → ok=false（dirty worktree）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w3-'));
    const p = writeSwebenchPrereg(dir, ids, [`gitCommit: ${frozenCommit}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, gitState: { trackedClean: false, codeMatchesFrozen: true } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/未提交|dirty/);
  });

  it('codeMatchesFrozen=false（prereg 含 gitCommit）→ ok=false（代码漂移）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w3-'));
    const p = writeSwebenchPrereg(dir, ids, [`gitCommit: ${frozenCommit}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, gitState: { trackedClean: true, codeMatchesFrozen: false } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/漂移|冻结/);
  });

  it('两者均 true → ok=true（不拦截）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w3-'));
    const p = writeSwebenchPrereg(dir, ids, [`gitCommit: ${frozenCommit}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, gitState: { trackedClean: true, codeMatchesFrozen: true } });
    expect(r.ok).toBe(true);
  });

  it('gitState 仅在 swebench-execution kind 生效（ast-diff 不校验 git）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-w3-'));
    const hash = computeTaskSetHash(ids);
    const p = path.join(dir, 'ast-prereg.md');
    fs.writeFileSync(p, `---\nfrozen: true\ntaskSetHash: ${hash}\ntaskIds: [${ids.map((t) => `"${t}"`).join(', ')}]\n---\nbody`);
    const r = checkPreregistration(ids, p, { oracleKind: 'ast-diff', gitState: { trackedClean: false, codeMatchesFrozen: false } });
    expect(r.ok).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// F197 CRITICAL：fixtureContentHash 闭环（taskId 不变内容换版被拦）
// ───────────────────────────────────────────────────────────

describe('CRITICAL fixtureContentHash闭环', () => {
  const ids = ['t1'];

  it('computeFixtureContentHash 对 fixture 内容变化敏感（改一字节 → hash 变）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-fch-'));
    fs.writeFileSync(path.join(dir, 't1.json'), '{"a":1}');
    const h1 = computeFixtureContentHash(['t1'], dir);
    fs.writeFileSync(path.join(dir, 't1.json'), '{"a":2}');
    const h2 = computeFixtureContentHash(['t1'], dir);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
  });

  it('computeFixtureContentHash 顺序/重复无关', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-fch-'));
    fs.writeFileSync(path.join(dir, 'a.json'), '{"x":1}');
    fs.writeFileSync(path.join(dir, 'b.json'), '{"y":2}');
    expect(computeFixtureContentHash(['a', 'b'], dir)).toBe(computeFixtureContentHash(['b', 'a', 'a'], dir));
  });

  // F197 W2：fixture 缺失时 computeFixtureContentHash 裸 throw（合理语义），由 caller（cohort-batch
  // entryValidation）兜成 structured problem + exit 2，而非顶层崩。此处锁定底层 throw 契约不被静默吞。
  it('computeFixtureContentHash 缺文件 → throw（caller 负责兜 structured 错误，不静默返回空）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-fch-miss-'));
    expect(() => computeFixtureContentHash(['nonexistent'], dir)).toThrow();
  });

  it('taskId 不变但 fixture 内容换版 → checkPreregistration 比对拦截（ok=false 含 fixtureContentHash）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-fch-'));
    fs.writeFileSync(path.join(dir, 't1.json'), '{"v":"frozen"}');
    const frozenFCH = computeFixtureContentHash(ids, dir);
    // fixture 换版（taskId 不变）
    fs.writeFileSync(path.join(dir, 't1.json'), '{"v":"swapped"}');
    const liveFCH = computeFixtureContentHash(ids, dir);
    const p = writeSwebenchPrereg(dir, ids, [`fixtureContentHash: ${frozenFCH}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, fixtureContentHash: liveFCH });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/fixtureContentHash/);
  });

  it('prereg 无 fixtureContentHash（旧格式）→ ok=true（向后兼容）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-fch-'));
    const p = writeSwebenchPrereg(dir, ids, []);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, fixtureContentHash: 'a'.repeat(64) });
    expect(r.ok).toBe(true);
  });

  it('prereg 有 fixtureContentHash 且 opts 一致 → ok=true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f197-fch-'));
    const fch = 'b'.repeat(64);
    const p = writeSwebenchPrereg(dir, ids, [`fixtureContentHash: ${fch}`]);
    const r = checkPreregistration(ids, p, { oracleKind: 'swebench-execution', oracleSpecInput: SWEBENCH_SPEC, fixtureContentHash: fch });
    expect(r.ok).toBe(true);
  });
});
