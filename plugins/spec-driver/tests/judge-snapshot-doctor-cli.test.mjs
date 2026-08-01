/**
 * judge-snapshot-doctor-cli.test.mjs
 * Feature 236 — CLI 进程级确定性测试（spawnSync 真实子进程）
 *
 * 走真实 CLI 边界（不经 import），验证退出码语义（FR-009）、stdout/stderr 分流、
 * 无修复建议文案（FR-011）、npm run judge:doctor 挂载（FR-009）。
 *
 * 运行: node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCTOR = path.join(REPO_ROOT, 'plugins', 'spec-driver', 'scripts', 'judge-snapshot-doctor.mjs');
const REPO_PLUGIN_SUBDIR = path.join('plugins', 'spec-driver');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// 修复建议类措辞黑名单（FR-011）——不含 'sync'（会与 in-sync 状态值冲突）
const REMEDIATION_WORDS = ['建议', '重新安装', '重装', '请运行', '修复', 'reinstall', '同步快照', '覆盖快照'];

const JUDGE_FILE_SET = [
  'scripts/fix-compliance-judge.mjs',
  'scripts/lib/fix-compliance-core.mjs',
  'scripts/lib/fix-compliance-execution-record.mjs',
  'scripts/lib/fix-compliance-io.mjs',
  'scripts/lib/simple-yaml.mjs',
  'scripts/record-workflow-run.mjs',
];

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cli-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeJudgeFiles(base, overrides = {}) {
  for (const entry of JUDGE_FILE_SET) {
    if (overrides[entry] === null) continue;
    const content = overrides[entry] !== undefined ? overrides[entry] : `content-of-${entry}`;
    const p = path.join(base, entry);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

function makeRepoProjectRoot(overrides = {}) {
  const projectRoot = path.join(tmp, `repo-${Math.random().toString(36).slice(2)}`);
  writeJudgeFiles(path.join(projectRoot, REPO_PLUGIN_SUBDIR), overrides);
  return projectRoot;
}

function makeSnapshotDir(name, overrides = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'spec-driver' }));
  writeJudgeFiles(dir, overrides);
  return dir;
}

/**
 * 构造 manifest 为损坏 JSON 的插件根：validatePluginRoot → error/manifest-json-parse-error
 * → 经 CLAUDE_PLUGIN_ROOT 探测得 source-error → 稳定产出 resolution-indeterminate，
 * 无需权限测试即可覆盖该态（W2）。
 */
function makeBrokenEnvRoot(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{ broken json');
  return dir;
}

/** 断言无任何修复建议措辞（FR-011） */
function assertNoRemediation(stdout) {
  for (const word of REMEDIATION_WORDS) {
    assert.ok(!stdout.includes(word), `stdout 不应含修复措辞 "${word}"：\n${stdout}`);
  }
}

function runDoctor(args, env = {}) {
  return spawnSync('node', [DOCTOR, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('judge-snapshot-doctor CLI（spawnSync）', () => {
  it('drift 场景退出码 0（FR-009：drift 不是失败）', () => {
    const projectRoot = makeRepoProjectRoot();
    const snap = makeSnapshotDir('snapDrift', { [JUDGE_FILE_SET[1]]: 'CHANGED' });
    const r = runDoctor(['--project-root', projectRoot], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /drift/);
  });

  it('非法参数（未知 flag）退出码 1，错误写 stderr，stdout 为空', () => {
    const r = runDoctor(['--unknown-flag']);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.length > 0, 'stderr 应有错误提示');
    assert.equal(r.stdout, '', 'stdout 应为空（错误只走 stderr）');
  });

  it('--project-root 缺值 退出码 1，错误写 stderr，stdout 为空', () => {
    const r = runDoctor(['--project-root']);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.length > 0);
    assert.equal(r.stdout, '', 'stdout 应为空（错误只走 stderr）');
  });

  it('正常场景报告写 stdout，stderr 为空', () => {
    const projectRoot = makeRepoProjectRoot();
    const snap = makeSnapshotDir('snapSync');
    const r = runDoctor(['--project-root', projectRoot], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /in-sync/);
    assert.equal(r.stderr.trim(), '');
  });

  // 四态逐一锁定：每态断言「实际 status 文本 + 退出码 0 + stderr 空 + 无修复文案」（W2）
  it('四态-1 drift：status 文本=drift，退出码 0，stderr 空，无修复文案', () => {
    const projectRoot = makeRepoProjectRoot();
    const snap = makeSnapshotDir('sDrift', { [JUDGE_FILE_SET[1]]: 'X' });
    const r = runDoctor(['--project-root', projectRoot], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.match(r.stdout, /^status:\s+drift\s*$/m);
    assert.doesNotMatch(r.stdout, /^status:\s+in-sync/m);
    assertNoRemediation(r.stdout);
  });

  it('四态-2 in-sync：status 文本=in-sync，退出码 0，stderr 空，无修复文案', () => {
    const projectRoot = makeRepoProjectRoot();
    const snap = makeSnapshotDir('sSync');
    const r = runDoctor(['--project-root', projectRoot], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.match(r.stdout, /^status:\s+in-sync\s*$/m);
    assertNoRemediation(r.stdout);
  });

  it('四态-3 not-applicable：status 文本=not-applicable，退出码 0，stderr 空，无修复文案', () => {
    const empty = path.join(tmp, 'emptyRepo');
    fs.mkdirSync(empty, { recursive: true });
    const r = runDoctor(['--project-root', empty], { CLAUDE_PLUGIN_ROOT: '' });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.match(r.stdout, /^status:\s+not-applicable\s*$/m);
    assertNoRemediation(r.stdout);
  });

  it('四态-4 indeterminate/resolution：损坏 env manifest 稳定构造（无需权限），退出码 0，stderr 空，无修复文案', () => {
    const projectRoot = makeRepoProjectRoot();
    const brokenRoot = makeBrokenEnvRoot('sBrokenEnv');
    const r = runDoctor(['--project-root', projectRoot], { CLAUDE_PLUGIN_ROOT: brokenRoot });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.match(r.stdout, /^status:\s+indeterminate（resolution/m);
    assert.match(r.stdout, /^reason:\s+source-error\s*$/m);
    assertNoRemediation(r.stdout);
  });

  it('四态-4b indeterminate/comparison：仓库入口文件 [0] EACCES（root 跳过），退出码 0，stderr 空，无修复文案', { skip: isRoot ? 'root' : false }, () => {
    const projectRoot = makeRepoProjectRoot();
    const snap = makeSnapshotDir('sIndetCmp');
    // 真 chmod 入口文件 JUDGE_FILE_SET[0]（名实相符），使 compareFile 走 repo-side error 分支
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, JUDGE_FILE_SET[0]), 0o000);
    const r = runDoctor(['--project-root', projectRoot], { CLAUDE_PLUGIN_ROOT: snap });
    fs.chmodSync(path.join(projectRoot, REPO_PLUGIN_SUBDIR, JUDGE_FILE_SET[0]), 0o644);
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.match(r.stdout, /^status:\s+indeterminate（comparison/m);
    assertNoRemediation(r.stdout);
  });

  it('npm run judge:doctor 挂载可执行且退出码符合规则（依赖 T011）', () => {
    const empty = path.join(tmp, 'emptyRepoNpm');
    fs.mkdirSync(empty, { recursive: true });
    const r = spawnSync('npm', ['run', '--silent', 'judge:doctor', '--', '--project-root', empty], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '' },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /not-applicable/);
  });
});
