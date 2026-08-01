/**
 * judge-snapshot-doctor.test.mjs
 * Feature 236 — CLI 编排层确定性单测（checkJudgeSnapshotDrift）
 *
 * Part A：fixture 化确定性场景，覆盖 contracts 测试断言基准表全部 12 行。
 * Part B：真实仓库宽松 sanity check（不注入 fixture，仅验结构合法、不抛异常）。
 *
 * 运行: node --test plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkJudgeSnapshotDrift } from '../scripts/judge-snapshot-doctor.mjs';
import { JUDGE_FILE_SET } from '../scripts/lib/judge-snapshot-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const REPO_PLUGIN_SUBDIR = path.join('plugins', 'spec-driver');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-doctor-'));
});
afterEach(() => {
  try {
    walkChmod(tmp, 0o755);
  } catch {
    // ignore
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function walkChmod(dir, mode) {
  let entries;
  try {
    fs.chmodSync(dir, mode);
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkChmod(p, mode);
    else {
      try {
        fs.chmodSync(p, mode);
      } catch {
        // ignore
      }
    }
  }
}

/** 在 base 目录下写入 JUDGE_FILE_SET 6 个文件（可覆盖单文件内容 / 标记 missing） */
function writeJudgeFiles(base, overrides = {}) {
  for (const entry of JUDGE_FILE_SET) {
    if (Object.prototype.hasOwnProperty.call(overrides, entry) && overrides[entry] === null) {
      continue; // missing
    }
    const content = overrides[entry] !== undefined ? overrides[entry] : `content-of-${entry}`;
    const p = path.join(base, entry);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

/** 构造一个 spec-driver 仓库侧 projectRoot（含 plugins/spec-driver/<6文件>） */
function makeRepoProjectRoot(overrides = {}) {
  const projectRoot = path.join(tmp, 'repo');
  writeJudgeFiles(path.join(projectRoot, REPO_PLUGIN_SUBDIR), overrides);
  return projectRoot;
}

/** 构造一个合法快照目录（含 .claude-plugin/plugin.json + 6 文件） */
function makeSnapshotDir(name, overrides = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'spec-driver' }));
  writeJudgeFiles(dir, overrides);
  return dir;
}

/** 只写 manifest（合法插件根，不含 6 文件），用于解析歧义等场景 */
function makePluginRootOnly(name, pluginName = 'spec-driver') {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: pluginName }));
  return dir;
}

function writeInstalledMeta(claudeHome, candidates) {
  fs.mkdirSync(path.join(claudeHome, 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(claudeHome, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'spec-driver@cc-plugin-market': candidates } }),
  );
}

/** 空 claudeHome（无任何快照、无 installed_plugins.json） */
function emptyClaudeHome() {
  const h = path.join(tmp, 'claudeHome');
  fs.mkdirSync(h, { recursive: true });
  return h;
}

describe('checkJudgeSnapshotDrift — Part A 确定性 fixture 场景', () => {
  it('#1 projectRoot 无 fix-compliance-judge.mjs → not-applicable/repo-reference-missing', () => {
    const projectRoot = path.join(tmp, 'empty');
    fs.mkdirSync(projectRoot, { recursive: true });
    const r = checkJudgeSnapshotDrift({ projectRoot, env: {}, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'not-applicable');
    assert.equal(r.reason, 'repo-reference-missing');
    assert.deepStrictEqual(r.files, []);
  });

  it('#2 有仓库参照但无任何已安装快照 → not-applicable/no-installed-snapshot', () => {
    const projectRoot = makeRepoProjectRoot();
    const r = checkJudgeSnapshotDrift({ projectRoot, env: {}, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'not-applicable');
    assert.equal(r.reason, 'no-installed-snapshot');
  });

  it('#3 CLAUDE_PLUGIN_ROOT manifest 读取遇 EACCES → indeterminate/resolution/source-error', { skip: isRoot ? 'root' : false }, () => {
    const projectRoot = makeRepoProjectRoot();
    const badRoot = makePluginRootOnly('badEnvRoot');
    fs.chmodSync(path.join(badRoot, '.claude-plugin', 'plugin.json'), 0o000);
    // 即便存在其他可用快照也不应降级
    const claudeHome = emptyClaudeHome();
    const otherSnap = path.join(claudeHome, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver', '4.3.0');
    fs.mkdirSync(path.join(otherSnap, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(otherSnap, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'spec-driver' }));
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: badRoot }, claudeHome });
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'resolution');
    assert.equal(r.reason, 'source-error');
    assert.deepStrictEqual(r.detail, { source: 'claude-plugin-root', errorCode: 'EACCES' });
    assert.deepStrictEqual(r.files, []);
  });

  it('#4 installed_plugins.json 2 条不同 canonicalPath 均 ok → indeterminate/resolution/ambiguous', () => {
    const projectRoot = makeRepoProjectRoot();
    const claudeHome = emptyClaudeHome();
    const a = makePluginRootOnly('candA');
    const b = makePluginRootOnly('candB');
    writeInstalledMeta(claudeHome, [
      { scope: 'user', installPath: a },
      { scope: 'user', installPath: b },
    ]);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: {}, claudeHome });
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'resolution');
    assert.equal(r.reason, 'installed-plugins-metadata-ambiguous');
    assert.deepStrictEqual(r.files, []);
  });

  it('#4b 2 条候选 canonicalPath 相同（symlink）→ 非 indeterminate，正常解析进入比对', () => {
    const projectRoot = makeRepoProjectRoot();
    const claudeHome = emptyClaudeHome();
    const real = makeSnapshotDir('realSnap'); // 与 repo 内容一致 → in-sync
    const link = path.join(tmp, 'linkSnap');
    fs.symlinkSync(real, link);
    writeInstalledMeta(claudeHome, [
      { scope: 'user', installPath: real },
      { scope: 'user', installPath: link },
    ]);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: {}, claudeHome });
    assert.notEqual(r.status, 'indeterminate');
    assert.equal(r.resolutionSource, 'installed-plugins-metadata');
    assert.equal(r.status, 'in-sync');
  });

  it('#4c 1 条 invalid + 1 条 ok → 过滤后剩 1，正常解析进入比对', () => {
    const projectRoot = makeRepoProjectRoot();
    const claudeHome = emptyClaudeHome();
    const good = makeSnapshotDir('goodSnap');
    const bad = makePluginRootOnly('badNameSnap', 'not-spec-driver');
    writeInstalledMeta(claudeHome, [
      { scope: 'user', installPath: bad },
      { scope: 'user', installPath: good },
    ]);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: {}, claudeHome });
    assert.notEqual(r.status, 'indeterminate');
    assert.equal(r.resolutionSource, 'installed-plugins-metadata');
    assert.equal(r.status, 'in-sync');
  });

  it('#5 三路无候选 + 存在合法快照目录（scan present）→ indeterminate/resolution/no-active-snapshot-resolvable', () => {
    const projectRoot = makeRepoProjectRoot();
    const claudeHome = emptyClaudeHome();
    const snap = path.join(claudeHome, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver', '4.3.0');
    fs.mkdirSync(path.join(snap, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(snap, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'spec-driver' }));
    const r = checkJudgeSnapshotDrift({ projectRoot, env: {}, claudeHome });
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'resolution');
    assert.equal(r.reason, 'no-active-snapshot-resolvable');
  });

  it('#6 三路无候选 + scan cache 遇 EACCES → indeterminate/resolution/installed-snapshot-scan-error', { skip: isRoot ? 'root' : false }, () => {
    const projectRoot = makeRepoProjectRoot();
    const claudeHome = emptyClaudeHome();
    const market = path.join(claudeHome, 'plugins', 'cache', 'cc-plugin-market');
    fs.mkdirSync(market, { recursive: true });
    fs.chmodSync(market, 0o000);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: {}, claudeHome });
    fs.chmodSync(market, 0o755);
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'resolution');
    assert.equal(r.reason, 'installed-snapshot-scan-error');
  });

  it('#7 唯一候选解析成功 + 6 文件全一致 → in-sync', () => {
    const projectRoot = makeRepoProjectRoot();
    const snap = makeSnapshotDir('snap7');
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'in-sync');
    assert.equal(r.resolutionSource, 'claude-plugin-root');
    assert.equal(r.files.length, 6);
    assert.ok(r.files.every((f) => f.status === 'match'));
  });

  it('#8 1 文件不同 → drift（5 match + 1 mismatch）', () => {
    const projectRoot = makeRepoProjectRoot();
    const target = JUDGE_FILE_SET[1];
    const snap = makeSnapshotDir('snap8', { [target]: 'DIFFERENT-CONTENT' });
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'drift');
    assert.equal(r.files.filter((f) => f.status === 'match').length, 5);
    const mm = r.files.find((f) => f.file === target);
    assert.equal(mm.status, 'mismatch');
  });

  it('#9 快照侧缺失某文件 → drift（missingInSnapshot）', () => {
    const projectRoot = makeRepoProjectRoot();
    const target = JUDGE_FILE_SET[2];
    const snap = makeSnapshotDir('snap9', { [target]: null });
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'drift');
    assert.equal(r.files.find((f) => f.file === target).status, 'missingInSnapshot');
  });

  it('#10 某文件两侧均缺失 → drift（missingBoth）', () => {
    const target = JUDGE_FILE_SET[4];
    const projectRoot = makeRepoProjectRoot({ [target]: null });
    const snap = makeSnapshotDir('snap10', { [target]: null });
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'drift');
    assert.equal(r.files.find((f) => f.file === target).status, 'missingBoth');
  });

  it('#11 仓库侧某文件读取 EACCES、其余相同 → indeterminate/comparison，保留全部明细', { skip: isRoot ? 'root' : false }, () => {
    const projectRoot = makeRepoProjectRoot();
    const target = JUDGE_FILE_SET[2];
    const snap = makeSnapshotDir('snap11');
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, target), 0o000);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'comparison');
    assert.equal(r.reason, 'partial-file-read-failure');
    assert.ok(r.snapshotPath); // 快照路径保留非空
    assert.equal(r.resolutionSource, 'claude-plugin-root');
    assert.equal(r.files.length, 6);
    const bad = r.files.find((f) => f.file === target);
    assert.equal(bad.status, 'indeterminate');
    assert.equal(bad.side, 'repo');
    assert.equal(bad.errorCode, 'EACCES');
    assert.equal(r.files.filter((f) => f.status === 'match').length, 5);
  });

  it('#11b 入口文件(JUDGE_FILE_SET[0]) EACCES + active 快照有效 → comparison-indeterminate（非 not-applicable，C2）', { skip: isRoot ? 'root' : false }, () => {
    const projectRoot = makeRepoProjectRoot();
    const entry = JUDGE_FILE_SET[0];
    const snap = makeSnapshotDir('snap11b');
    // 入口存在但不可读（EACCES），active 快照可确定
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, entry), 0o000);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, entry), 0o644);
    // 关键：入口不可读绝不能被压成 not-applicable（那会静默吞掉真实漂移）
    assert.notEqual(r.status, 'not-applicable');
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'comparison');
    assert.equal(r.reason, 'partial-file-read-failure');
    assert.ok(r.snapshotPath);
    assert.equal(r.resolutionSource, 'claude-plugin-root');
    assert.equal(r.files.length, 6);
    const bad = r.files.find((f) => f.file === entry);
    assert.equal(bad.status, 'indeterminate');
    assert.equal(bad.side, 'repo');
    assert.equal(bad.errorCode, 'EACCES');
    // 其余 5 个文件仍被正常比对（已确认明细不被隐藏）
    assert.equal(r.files.filter((f) => f.status === 'match').length, 5);
  });

  it('#11c 入口 EACCES 但同时另有文件真实 mismatch → 已确认 mismatch 保留（不被入口不可读吞掉，C2）', { skip: isRoot ? 'root' : false }, () => {
    const projectRoot = makeRepoProjectRoot();
    const entry = JUDGE_FILE_SET[0];
    const mismatchTarget = JUDGE_FILE_SET[1];
    const snap = makeSnapshotDir('snap11c', { [mismatchTarget]: 'DRIFTED' });
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, entry), 0o000);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, entry), 0o644);
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'comparison');
    assert.equal(r.files.find((f) => f.file === mismatchTarget).status, 'mismatch');
    assert.equal(r.files.find((f) => f.file === entry).status, 'indeterminate');
  });

  it('#12 mismatch + EACCES 混合 → indeterminate/comparison，两者都保留', { skip: isRoot ? 'root' : false }, () => {
    const projectRoot = makeRepoProjectRoot();
    const mismatchTarget = JUDGE_FILE_SET[1];
    const eaccesTarget = JUDGE_FILE_SET[3];
    const snap = makeSnapshotDir('snap12', { [mismatchTarget]: 'CHANGED' });
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, eaccesTarget), 0o000);
    const r = checkJudgeSnapshotDrift({ projectRoot, env: { CLAUDE_PLUGIN_ROOT: snap }, claudeHome: emptyClaudeHome() });
    assert.equal(r.status, 'indeterminate');
    assert.equal(r.indeterminateKind, 'comparison');
    assert.equal(r.files.find((f) => f.file === mismatchTarget).status, 'mismatch');
    const bad = r.files.find((f) => f.file === eaccesTarget);
    assert.equal(bad.status, 'indeterminate');
    assert.equal(bad.side, 'repo');
    assert.equal(r.files.filter((f) => f.status === 'match').length, 4);
  });
});

describe('checkJudgeSnapshotDrift — Part B 真实仓库 sanity（非 FR 覆盖证据）', () => {
  const VALID_STATUS = new Set(['in-sync', 'drift', 'not-applicable', 'indeterminate']);
  const VALID_INDET_KIND = new Set(['resolution', 'comparison']);

  it('真实仓库根调用不抛异常，status 合法、结构合法', () => {
    const r = checkJudgeSnapshotDrift({ projectRoot: REPO_ROOT });
    assert.ok(VALID_STATUS.has(r.status), `status=${r.status}`);
    assert.ok(Array.isArray(r.files));
    if (r.status === 'indeterminate') {
      assert.ok(VALID_INDET_KIND.has(r.indeterminateKind), `indeterminateKind=${r.indeterminateKind}`);
    }
  });
});
