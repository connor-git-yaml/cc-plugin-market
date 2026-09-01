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
import { JUDGE_FILE_SET } from '../scripts/lib/judge-snapshot-core.mjs';
import { deriveDelta, classifyGitResult, isCommitShaShape } from '../scripts/judge-snapshot-doctor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCTOR = path.join(REPO_ROOT, 'plugins', 'spec-driver', 'scripts', 'judge-snapshot-doctor.mjs');
const REPO_PLUGIN_SUBDIR = path.join('plugins', 'spec-driver');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// 修复建议类措辞黑名单（FR-011）——不含 'sync'（会与 in-sync 状态值冲突）
const REMEDIATION_WORDS = ['建议', '重新安装', '重装', '请运行', '修复', 'reinstall', '同步快照', '覆盖快照'];

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

// ---------------------------------------------------------------------------
// Feature 278 项④ —— `--since <ref>` 增量漂移视图（FR-012~FR-017 / SC-004）
// ---------------------------------------------------------------------------

/**
 * 造临时 git 仓时屏蔽用户级 / 系统级 git 配置（gpg 签名、hooksPath、模板目录等），
 * 否则本机配置会让 commit 在别人机器上随机失败。
 */
const HERMETIC_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'f278',
  GIT_AUTHOR_EMAIL: 'f278@example.invalid',
  GIT_COMMITTER_NAME: 'f278',
  GIT_COMMITTER_EMAIL: 'f278@example.invalid',
};

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: HERMETIC_GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
}

/** 本机 git 是否支持 sha256 对象格式（老版本不支持 → S10 无从构造，跳过而非假绿） */
function supportsSha256Repo() {
  const probe = path.join(tmp, `sha256probe-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(probe, { recursive: true });
  const r = spawnSync('git', ['init', '-q', '--object-format=sha256', probe], {
    encoding: 'utf8',
    env: HERMETIC_GIT_ENV,
  });
  return r.status === 0;
}

/**
 * 造一个 projectRoot 同时是 git 仓根的临时仓库，含两个 commit：
 * commit1 = 基线（`--since` 的目标 ref），commit2 = 当前工作树。
 * overrides 语义与 writeJudgeFiles 一致：值为 null 表示该文件在该 commit 下不存在。
 * @returns {{ projectRoot: string, baselineCommit: string }}
 */
function makeGitProjectRoot(name, firstOverrides = {}, secondOverrides = {}, initArgs = []) {
  const projectRoot = path.join(tmp, name);
  const base = path.join(projectRoot, REPO_PLUGIN_SUBDIR);
  fs.mkdirSync(base, { recursive: true });
  git(projectRoot, ['init', '-q', '-b', 'main', ...initArgs]);

  writeJudgeFiles(base, firstOverrides);
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['commit', '-q', '--no-gpg-sign', '-m', 'baseline']);
  const baselineCommit = git(projectRoot, ['rev-parse', 'HEAD']);

  // 第二个 commit 前清空判定器目录，才能表达「第一个 commit 有、当前没有」这类形态
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  writeJudgeFiles(base, secondOverrides);
  git(projectRoot, ['add', '-A']);
  // --allow-empty：两次内容相同的场景（S2/S5）本就无差异，空提交是这些用例的正当形态
  git(projectRoot, ['commit', '-q', '--no-gpg-sign', '--allow-empty', '-m', 'current']);

  return { projectRoot, baselineCommit };
}

/** 取增量视图区块内某个文件的明细行；主报告的文件明细行形状相近，必须限定在区块之后找 */
function sinceLineFor(stdout, file) {
  const idx = stdout.indexOf('增量视图');
  assert.ok(idx >= 0, `stdout 应含增量视图区块：\n${stdout}`);
  return stdout.slice(idx).split('\n').find((l) => l.includes(file) && l.includes('['));
}

describe('judge-snapshot-doctor CLI --since（F278 项④）', () => {
  it('S1 非 git 目录 + --since：exit 1 + stderr 指明不在 git 仓库内 + stdout 空', () => {
    const projectRoot = makeRepoProjectRoot();
    const snap = makeSnapshotDir('sinceS1');
    const r = runDoctor(['--project-root', projectRoot, '--since', 'HEAD~1'], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 1);
    // 钉到 'git 仓库' 才有区分力：改前 `--since` 是未知参数，也恰好 exit 1
    assert.ok(r.stderr.includes('git 仓库'), `stderr 应指明不在 git 仓库内，实际：${r.stderr}`);
    assert.equal(r.stdout, '', 'stdout 应完全为空（不得输出一份全 introduced 的假报告）');
  });

  it('S2 合法 git 仓 + 无效 ref：exit 1 + stderr 指明无效的 git ref + stdout 空', () => {
    const { projectRoot } = makeGitProjectRoot('sinceS2repo');
    const snap = makeSnapshotDir('sinceS2snap', {});
    const r = runDoctor(['--project-root', projectRoot, '--since', 'NOSUCHREF278'], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('无效的 git ref'), `stderr 应指明无效的 git ref，实际：${r.stderr}`);
    assert.equal(r.stdout, '', 'stdout 应完全为空');
  });

  it('S3 文件在两个 commit 间被改过（当前与快照一致）：exit 0 + 增量视图标 resolved', () => {
    const changed = JUDGE_FILE_SET[1];
    const { projectRoot, baselineCommit } = makeGitProjectRoot(
      'sinceS3repo',
      { [changed]: 'BASELINE-CONTENT' }, // commit1：该文件内容与快照不同
      {}, // commit2 = 当前工作树：全部默认内容
    );
    const snap = makeSnapshotDir('sinceS3snap', {}); // 快照 = 当前 repo
    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('增量视图'), `stdout 应含增量视图区块：\n${r.stdout}`);
    const line = sinceLineFor(r.stdout, changed);
    assert.ok(line, `应有 ${changed} 的增量明细行：\n${r.stdout}`);
    assert.ok(line.includes('[resolved]'), `该行应判 resolved，实际：${line}`);
    // 同时钉住两个原始 status 的字面量：只断言 delta 标签会放过「baselineStatus 打成 [object Object]」这类失真
    assert.ok(line.includes('(基线 mismatch → 当前 match)'), `该行应打印两侧原始 status，实际：${line}`);
    assertNoRemediation(r.stdout);
  });

  it('S4 文件在基线 ref 下不存在：exit 0 + 判 added-since + 该行标注「该 ref 下不存在」', () => {
    const added = JUDGE_FILE_SET[1];
    const { projectRoot, baselineCommit } = makeGitProjectRoot(
      'sinceS4repo',
      { [added]: null }, // commit1：该文件不存在
      {},
    );
    const snap = makeSnapshotDir('sinceS4snap', {});
    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const line = sinceLineFor(r.stdout, added);
    assert.ok(line, `应有 ${added} 的增量明细行：\n${r.stdout}`);
    // C-3：absent-at-ref 必须进入分类，而不是仅作旁注（FR-015(b)「判定为该 ref 之后新增」）
    assert.ok(line.includes('[added-since]'), `该行应判 added-since，实际：${line}`);
    assert.ok(
      line.includes('(基线 missingInRepo → 当前 match, 该 ref 下不存在)'),
      `该行应同时打印两侧原始 status 与 absentAtRef 标记，实际：${line}`,
    );
    // 汇总行必须体现 added-since——旁注方案正是在这里把它整个吞掉的
    assert.ok(
      r.stdout.includes('增量汇总: 9 unchanged / 1 added-since'),
      `增量汇总应逐字含 added-since 计数：\n${r.stdout}`,
    );
    assertNoRemediation(r.stdout);
  });

  it('S5 对照组：不带 --since 时输出不含增量区块，既有断言全部成立', () => {
    const { projectRoot } = makeGitProjectRoot('sinceS5repo');
    const snap = makeSnapshotDir('sinceS5snap', {});
    const r = runDoctor(['--project-root', projectRoot], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
    assert.match(r.stdout, /^status:\s+in-sync\s*$/m);
    assert.ok(!r.stdout.includes('增量视图'), '不带 --since 时不得出现增量区块');
    assertNoRemediation(r.stdout);
  });

  // -------------------------------------------------------------------------
  // 返工补齐：fail-open 方向的端到端守护（复审 C-1 / C-2 / C-3 / W-1~W-3）
  // -------------------------------------------------------------------------

  it('S6 基线对象不可读（子树对象被删）：exit 1 + stdout 完全为空（C-1 fail-open 方向）', () => {
    // 此前用 `rev-parse --verify --quiet <sha>:<path>` 做存在性探针：本机 git 2.53.0 实测
    // 「路径真不存在」与「基线对象损坏」都是 exit 1 + 0 字节 stderr，退出码与 stderr 都无区分度，
    // 于是「读不出来」被静默降级成「该 ref 下不存在」，报告照常 exit 0 产出。
    const { projectRoot, baselineCommit } = makeGitProjectRoot('sinceS6repo');
    const snap = makeSnapshotDir('sinceS6snap', {});

    // 删掉基线 commit 的 scripts/lib 子树对象（fresh init 后对象均为 loose，不会在 pack 里）
    const libTree = git(projectRoot, ['rev-parse', `${baselineCommit}:${'plugins/spec-driver/scripts/lib'}`]);
    const objectFile = path.join(projectRoot, '.git', 'objects', libTree.slice(0, 2), libTree.slice(2));
    assert.ok(fs.existsSync(objectFile), `前置条件：子树对象应为 loose object，实际找不到 ${objectFile}`);
    fs.rmSync(objectFile);

    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 1, `基线不可读必须 fail-loud，实际 exit=${r.status}\nstdout=${r.stdout}`);
    assert.equal(r.stdout, '', 'stdout 必须完全为空（不得产出一份基于假基线的报告）');
    assert.ok(r.stderr.includes('无法枚举'), `stderr 应指明基线子树枚举失败，实际：${r.stderr}`);
  });

  it('S6b 基线 blob 对象被删（清单仍列全，读内容时才炸）：exit 1 + stdout 空', () => {
    // 与 S6 打的是**不同**分支：ls-tree 不读 blob，故清单 exit 0 且列全，
    // 直到 `cat-file blob` 才 exit 128。这条 fatal 分支若被改成「当作该 ref 下不存在」，
    // 只有本用例会红。
    const { projectRoot, baselineCommit } = makeGitProjectRoot('sinceS6brepo');
    const snap = makeSnapshotDir('sinceS6bsnap', {});
    const target = `plugins/spec-driver/${JUDGE_FILE_SET[0]}`;
    const blob = git(projectRoot, ['rev-parse', `${baselineCommit}:${target}`]);
    const objectFile = path.join(projectRoot, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
    assert.ok(fs.existsSync(objectFile), `前置条件：blob 应为 loose object，实际找不到 ${objectFile}`);
    fs.rmSync(objectFile);

    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 1, `blob 不可读必须 fail-loud，实际 exit=${r.status}\nstdout=${r.stdout}`);
    assert.equal(r.stdout, '', 'stdout 必须完全为空');
    assert.ok(r.stderr.includes('git 对象存在但不可读'), `stderr 应指明对象不可读，实际：${r.stderr}`);
  });

  it('S6c 基线 ref 下该路径是 gitlink（非普通文件）：exit 1 + stdout 空，不得当成「该 ref 下不存在」', () => {
    const projectRoot = path.join(tmp, 'sinceS6crepo');
    const base = path.join(projectRoot, REPO_PLUGIN_SUBDIR);
    fs.mkdirSync(base, { recursive: true });
    git(projectRoot, ['init', '-q', '-b', 'main']);
    writeJudgeFiles(base, {});
    git(projectRoot, ['add', '-A']);
    // 把其中一个判定器路径在 index 里换成 gitlink（160000 commit），提交后 ls-tree 的 type 即为 commit
    const gitPath = `plugins/spec-driver/${JUDGE_FILE_SET[8]}`;
    git(projectRoot, ['update-index', '--add', '--cacheinfo', `160000,${'0'.repeat(39)}1,${gitPath}`]);
    git(projectRoot, ['commit', '-q', '--no-gpg-sign', '-m', 'gitlink baseline']);
    const baselineCommit = git(projectRoot, ['rev-parse', 'HEAD']);
    const snap = makeSnapshotDir('sinceS6csnap', {});

    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 1, `非普通文件条目必须 fail-loud，实际 exit=${r.status}\nstdout=${r.stdout}`);
    assert.equal(r.stdout, '', 'stdout 必须完全为空');
    assert.ok(r.stderr.includes('不是普通文件'), `stderr 应指明该路径不是普通文件，实际：${r.stderr}`);
  });

  it('S7 本次改动引入的漂移：exit 0 + [introduced] + 增量汇总逐字为「9 unchanged / 1 introduced」', () => {
    // 此前两条端到端用例都以「当前 match」收尾，没有任何用例产出过 introduced 行——
    // 把 introduced 一律改判 unchanged 的变异体 0 红，正是因为这条路径从未被跑过。
    const broken = JUDGE_FILE_SET[2];
    const { projectRoot, baselineCommit } = makeGitProjectRoot(
      'sinceS7repo',
      {}, // commit1：全部默认内容（= 快照内容）→ 基线 match
      { [broken]: 'CHANGED-BY-THIS-WORK' }, // commit2 = 当前工作树：该文件被改坏 → 当前 mismatch
    );
    const snap = makeSnapshotDir('sinceS7snap', {});
    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const line = sinceLineFor(r.stdout, broken);
    assert.ok(line, `应有 ${broken} 的增量明细行：\n${r.stdout}`);
    assert.ok(line.includes('[introduced]'), `该行应判 introduced，实际：${line}`);
    assert.ok(line.includes('(基线 match → 当前 mismatch)'), `该行应打印两侧原始 status，实际：${line}`);
    // 逐字钉住汇总行：既守护「汇总行存在」，也守护 DELTA_VOCABULARY 的打印顺序
    assert.ok(
      r.stdout.includes('增量汇总: 9 unchanged / 1 introduced'),
      `增量汇总应逐字为「9 unchanged / 1 introduced」：\n${r.stdout}`,
    );
    assertNoRemediation(r.stdout);
  });

  it('S8 往 JUDGE_FILE_SET 加文件（快照是旧版没有它）：判 added-since，不得判 pre-existing（C-3）', () => {
    // 真实场景：F246/F270 近期 4 次往 JUDGE_FILE_SET 加过文件。改前该场景输出
    // 「[pre-existing] … (基线 missingBoth → 当前 missingInSnapshot, 该 ref 下不存在)」，
    // 100% 由本次改动引入的 drift 被答成「开工前就有的」，且汇总行把旁注整个吞掉。
    const newcomer = JUDGE_FILE_SET[4]; // scripts/lib/in-flight-verdict.mjs
    const { projectRoot, baselineCommit } = makeGitProjectRoot(
      'sinceS8repo',
      { [newcomer]: null }, // commit1：仓库里还没有这个文件
      {}, // commit2 = 当前：文件已加入
    );
    // 已安装快照是旧版，不含该文件
    const snap = makeSnapshotDir('sinceS8snap', { [newcomer]: null });
    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const line = sinceLineFor(r.stdout, newcomer);
    assert.ok(line, `应有 ${newcomer} 的增量明细行：\n${r.stdout}`);
    assert.ok(line.includes('[added-since]'), `该行应判 added-since，实际：${line}`);
    assert.ok(!line.includes('[pre-existing]'), `绝不能判 pre-existing（那是替本次改动开脱），实际：${line}`);
    assert.ok(
      line.includes('(基线 missingBoth → 当前 missingInSnapshot, 该 ref 下不存在)'),
      `该行应打印两侧原始 status，实际：${line}`,
    );
    assert.ok(
      r.stdout.includes('增量汇总: 9 unchanged / 1 added-since'),
      `汇总行必须体现 added-since：\n${r.stdout}`,
    );
    assertNoRemediation(r.stdout);
  });

  it('S9 GIT_DIR 泄漏：projectRoot 非 git 仓 + 注入他仓 GIT_DIR，仍须 exit 1 + stdout 空（W-1）', () => {
    // `git -C <dir>` 不覆盖 $GIT_DIR；git hook 恒导出该变量。不剔除就会拿另一个仓库当基线，
    // 对一个根本不是 git 仓库的目录产出一份完整且看似正常的增量报告。
    const donor = makeGitProjectRoot('sinceS9donor');
    const projectRoot = makeRepoProjectRoot(); // 普通目录，不是 git 仓
    const snap = makeSnapshotDir('sinceS9snap');
    const r = runDoctor(['--project-root', projectRoot, '--since', 'HEAD'], {
      CLAUDE_PLUGIN_ROOT: snap,
      GIT_DIR: path.join(donor.projectRoot, '.git'),
    });
    assert.equal(r.status, 1, `注入 GIT_DIR 后仍须 fail-loud，实际 exit=${r.status}\nstdout=${r.stdout}`);
    assert.equal(r.stdout, '', 'stdout 必须完全为空');
    assert.ok(r.stderr.includes('不在 git 仓库内'), `stderr 应指明不在 git 仓库内，实际：${r.stderr}`);
  });

  it('S10 sha256 object-format 仓：--since 正常可用（W-2：40 位 hex 守卫曾在此永久误拒）', () => {
    if (!supportsSha256Repo()) return; // 老版本 git 不支持 --object-format=sha256
    const changed = JUDGE_FILE_SET[1];
    const { projectRoot, baselineCommit } = makeGitProjectRoot(
      'sinceS10repo',
      { [changed]: 'BASELINE-CONTENT' },
      {},
      ['--object-format=sha256'],
    );
    assert.equal(baselineCommit.length, 64, `sha256 仓的 commit sha 应为 64 位，实际 ${baselineCommit}`);
    const snap = makeSnapshotDir('sinceS10snap', {});
    const r = runDoctor(['--project-root', projectRoot, '--since', baselineCommit], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 0, `sha256 仓上 --since 应可用，实际 exit=${r.status} stderr=${r.stderr}`);
    const line = sinceLineFor(r.stdout, changed);
    assert.ok(line && line.includes('[resolved]'), `该行应判 resolved，实际：${line}`);
  });

  it('S11 --since + not-applicable：打印降级说明行，不静默省略增量区块（W-3）', () => {
    const projectRoot = path.join(tmp, 'sinceS11repo');
    fs.mkdirSync(projectRoot, { recursive: true });
    git(projectRoot, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(projectRoot, 'README.md'), 'no judge files here');
    git(projectRoot, ['add', '-A']);
    git(projectRoot, ['commit', '-q', '--no-gpg-sign', '-m', 'only readme']);
    const r = runDoctor(['--project-root', projectRoot, '--since', 'HEAD'], { CLAUDE_PLUGIN_ROOT: '' });
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    assert.match(r.stdout, /^status:\s+not-applicable\s*$/m);
    assert.ok(
      r.stdout.includes('无文件明细可叠加（当前诊断状态为 not-applicable，未进入逐文件比较阶段）'),
      `应逐字打印降级说明行：\n${r.stdout}`,
    );
    assert.ok(!r.stdout.includes('增量汇总'), 'files 为空时不应出现增量汇总行');
    assertNoRemediation(r.stdout);
  });

  it('S14 git 不可执行（PATH 指向空目录）：exit 1 + 指明「git 不可用」，不得误报成「不在 git 仓库内」', () => {
    // spawn 失败（ENOENT）与「这里不是 git 仓库」是两回事：前者是 git 根本没跑成，
    // 把它归进后者会让人以为诊断已经跑过并给出了判断。
    const { projectRoot } = makeGitProjectRoot('sinceS14repo');
    const snap = makeSnapshotDir('sinceS14snap', {});
    // 用 process.execPath 直接起 node：清空 PATH 后 'node' 自身也解析不到
    const r = spawnSync(process.execPath, [DOCTOR, '--project-root', projectRoot, '--since', 'HEAD'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: snap, PATH: path.join(tmp, 'no-such-bin-dir') },
    });
    assert.equal(r.status, 1, `git 不可执行必须 fail-loud，实际 exit=${r.status}\nstdout=${r.stdout}`);
    assert.equal(r.stdout, '', 'stdout 必须完全为空');
    assert.ok(r.stderr.includes('git 不可用'), `stderr 应指明 git 不可用，实际：${r.stderr}`);
    assert.ok(r.stderr.includes('ENOENT'), `stderr 应带上 spawn 失败原因，实际：${r.stderr}`);
    assert.ok(!r.stderr.includes('不在 git 仓库内'), `不得把 spawn 失败误报成「不在 git 仓库内」，实际：${r.stderr}`);
  });

  it('S12 projectRoot 是仓库子目录：exit 1（基线与当前侧会读到不同目录）', () => {
    const { projectRoot } = makeGitProjectRoot('sinceS12repo');
    const subdir = path.join(projectRoot, REPO_PLUGIN_SUBDIR);
    const snap = makeSnapshotDir('sinceS12snap', {});
    const r = runDoctor(['--project-root', subdir, '--since', 'HEAD'], { CLAUDE_PLUGIN_ROOT: snap });
    assert.equal(r.status, 1, `子目录调用应 fail-loud，实际 exit=${r.status}\nstdout=${r.stdout}`);
    assert.equal(r.stdout, '', 'stdout 必须完全为空');
    assert.ok(r.stderr.includes('不是 git 仓库根'), `stderr 应指明不是仓库根，实际：${r.stderr}`);
  });
});

describe('classifyGitResult —— spawnSync 失败形态穷尽（F278 项④ C-1）', () => {
  // 只有 exit 形态携带「git 的判断」；其余三种都是「git 根本没跑成」，
  // 绝不允许落进「该路径不存在」这一业务结论。
  it('error 非空（ENOENT 等）→ spawn', () => {
    const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    assert.deepStrictEqual(classifyGitResult({ error: err, status: null, signal: null }), {
      kind: 'spawn',
      detail: 'ENOENT',
    });
  });

  it('被信号杀死（status:null, signal:SIGKILL, error:undefined）→ signal，绝不是成功也绝不是 exit', () => {
    // 这正是复审实测的 OOM killer / `timeout -s KILL` 形态：
    // `exists.error` 为假、`status !== 0` 为真 → 旧代码会把它读成「该 ref 下不存在」。
    const out = classifyGitResult({ error: undefined, status: null, signal: 'SIGKILL' });
    assert.deepStrictEqual(out, { kind: 'signal', detail: 'SIGKILL' });
    assert.notEqual(out, null);
    assert.notEqual(out.kind, 'exit');
  });

  it('status === null 且无 signal → no-status（这一形态此前完全没被穷尽）', () => {
    assert.deepStrictEqual(classifyGitResult({ error: undefined, status: null, signal: null }), {
      kind: 'no-status',
      detail: 'null',
    });
  });

  it('status === undefined → no-status（不得被 typeof 之外的宽松判断放过）', () => {
    assert.equal(classifyGitResult({ error: undefined, status: undefined, signal: null }).kind, 'no-status');
  });

  it('status 非零 → exit（唯一携带 git 判断的形态）', () => {
    assert.deepStrictEqual(classifyGitResult({ error: undefined, status: 128, signal: null }), {
      kind: 'exit',
      detail: '128',
    });
  });

  it('status === 0 且无 error/signal → null（真正成功）', () => {
    assert.equal(classifyGitResult({ error: undefined, status: 0, signal: null }), null);
  });
});

describe('isCommitShaShape —— 承重守卫（F278 项④ W-2）', () => {
  it('40 位（sha1 仓）与 64 位（sha256 仓）都接受', () => {
    assert.equal(isCommitShaShape('a'.repeat(40)), true);
    assert.equal(isCommitShaShape('0123456789abcdef'.repeat(4)), true); // 64 位
  });

  it('空串必须被拒——否则 `${sha}:<path>` 退化成 `:<path>`（读暂存区），把索引内容冒充成基线', () => {
    assert.equal(isCommitShaShape(''), false);
  });

  it('畸形输入一律拒绝（长度不符 / 非 hex / 大写 / ref 名）', () => {
    assert.equal(isCommitShaShape('a'.repeat(39)), false);
    assert.equal(isCommitShaShape('a'.repeat(41)), false);
    assert.equal(isCommitShaShape('a'.repeat(63)), false);
    assert.equal(isCommitShaShape('a'.repeat(65)), false);
    assert.equal(isCommitShaShape('A'.repeat(40)), false);
    assert.equal(isCommitShaShape('HEAD'), false);
    assert.equal(isCommitShaShape(`${'a'.repeat(40)}\n`), false);
  });
});

describe('deriveDelta 派生矩阵（F278 项④，返工后 6×6×2）', () => {
  const STATUSES = ['match', 'mismatch', 'missingInRepo', 'missingInSnapshot', 'missingBoth', 'indeterminate'];

  // 行 = baselineStatus，列 = currentStatus。本表是 deriveDelta 派生表的**唯一可执行副本**：
  // JSDoc 里那份表没有任何机器校验，二者不符时以本表为准。
  // 刻意写成字面量而非再算一遍——由实现推导出来的期望值不构成守护
  const MATRIX_PRESENT_AT_REF = [
    ['unchanged', 'introduced', 'introduced', 'introduced', 'introduced', 'indeterminate'],
    ['resolved', 'pre-existing', 'pre-existing', 'pre-existing', 'pre-existing', 'indeterminate'],
    ['resolved', 'pre-existing', 'pre-existing', 'pre-existing', 'pre-existing', 'indeterminate'],
    ['resolved', 'pre-existing', 'pre-existing', 'pre-existing', 'pre-existing', 'indeterminate'],
    ['resolved', 'pre-existing', 'pre-existing', 'pre-existing', 'pre-existing', 'indeterminate'],
    ['indeterminate', 'indeterminate', 'indeterminate', 'indeterminate', 'indeterminate', 'indeterminate'],
  ];

  // absentAtRef=true：除 indeterminate 优先与 missingBoth×missingBoth 两个边界外，一律 added-since
  const ADDED_ROW = ['added-since', 'added-since', 'added-since', 'added-since', 'unchanged', 'indeterminate'];
  const INDET_ROW = ['indeterminate', 'indeterminate', 'indeterminate', 'indeterminate', 'indeterminate', 'indeterminate'];
  const MATRIX_ABSENT_AT_REF = [ADDED_ROW, ADDED_ROW, ADDED_ROW, ADDED_ROW, ADDED_ROW, INDET_ROW];

  it('absentAtRef=false 的 6×6 与派生表逐格一致', () => {
    for (let row = 0; row < STATUSES.length; row += 1) {
      for (let col = 0; col < STATUSES.length; col += 1) {
        assert.equal(
          deriveDelta(STATUSES[row], STATUSES[col], false),
          MATRIX_PRESENT_AT_REF[row][col],
          `absentAtRef=false baseline=${STATUSES[row]} × current=${STATUSES[col]}`,
        );
      }
    }
  });

  it('absentAtRef=true 的 6×6 与派生表逐格一致', () => {
    for (let row = 0; row < STATUSES.length; row += 1) {
      for (let col = 0; col < STATUSES.length; col += 1) {
        assert.equal(
          deriveDelta(STATUSES[row], STATUSES[col], true),
          MATRIX_ABSENT_AT_REF[row][col],
          `absentAtRef=true baseline=${STATUSES[row]} × current=${STATUSES[col]}`,
        );
      }
    }
  });

  it('边界 1：absentAtRef && current=match → added-since（不是 resolved，没有既存漂移可被消除）', () => {
    assert.equal(deriveDelta('missingInRepo', 'match', true), 'added-since');
  });

  it('边界 2：missingBoth × missingBoth（三处皆无）→ unchanged（不是 added-since，什么都没被新增）', () => {
    assert.equal(deriveDelta('missingBoth', 'missingBoth', true), 'unchanged');
  });

  it('indeterminate 优先于 absentAtRef：读取失败不得被折叠进 added-since', () => {
    assert.equal(deriveDelta('indeterminate', 'match', true), 'indeterminate');
    assert.equal(deriveDelta('missingBoth', 'indeterminate', true), 'indeterminate');
  });
});
