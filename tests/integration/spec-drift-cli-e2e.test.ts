/**
 * T018：C1 端到端测试（FR-002 / FR-014 / SC-006）。
 *
 * ⚠️ MUST 经 `npm run drift:*` 执行（而非直接 spawn 脚本路径）——只有这样才能证明
 * `package.json` 的 script 注册本身有效（plan §10.4 对 C-6 的处置内核）。
 *
 * 【与 tasks.md 措辞的一处必要偏差】T018 写的是 `{cwd: tmpRepo}`，但临时目录里没有
 * `package.json`，`npm run` 在那里根本找不到 `drift:*` script。因此 cwd 固定为**仓库根**
 * （drift 是仓库内治理工具，与 `repo:check` 同层，plan §10.4 已裁决），
 * 被检项目通过 `--project-root` / `--lock` 指向临时目录——公开 npm 入口这一验收内核不变。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE_SRC = path.join(REPO_ROOT, 'tests/fixtures/spec-drift/e2e');

let sandbox: string;
let lockPath: string;
let manifestPath: string;

/** 经公开 npm script 入口执行 drift 子命令 */
function drift(script: 'drift:link' | 'drift:check' | 'drift:unlink', args: string[]) {
  const res = spawnSync('npm', ['run', '--silent', script, '--', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

const commonArgs = () => ['--project-root', sandbox, '--lock', lockPath];
const readLockFile = () => JSON.parse(fs.readFileSync(lockPath, 'utf8'));

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-e2e-'));
  fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
  fs.copyFileSync(
    path.join(FIXTURE_SRC, 'sample-module.ts'),
    path.join(sandbox, 'src/sample-module.ts'),
  );
  manifestPath = path.join(sandbox, 'manifest.json');
  fs.copyFileSync(path.join(FIXTURE_SRC, 'manifest.json'), manifestPath);
  lockPath = path.join(sandbox, '.specify/spec-drift.lock.json');
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('C1 端到端闭环（经 npm run drift:* 公开入口）', () => {
  it('link → 重复 link 拒绝 → refresh → check fresh → 改动后 stale → unlink', () => {
    // (2) 首次 link
    const linked = drift('drift:link', [...commonArgs(), '--manifest', manifestPath]);
    expect(linked.code, linked.stdout + linked.stderr).toBe(0);
    const lock = readLockFile();
    expect(lock.schemaVersion).toBe('1');
    expect(lock.anchors).toHaveLength(1);
    expect(lock.anchors[0]).toMatchObject({
      id: 'e2e-addNumbers',
      symbolId: 'src/sample-module.ts::addNumbers',
      matchKind: 'exact',
    });
    expect(lock.anchors[0].fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    // (3) 同 id 未加 --refresh 重复 link → 拒绝
    const dup = drift('drift:link', [...commonArgs(), '--manifest', manifestPath]);
    expect(dup.code).not.toBe(0);
    expect(dup.stdout).toMatch(/--refresh/);

    // (5) 未改动 → check fresh，退出码 0
    const clean = drift('drift:check', commonArgs());
    expect(clean.code, clean.stdout).toBe(0);
    expect(clean.stdout).toContain('DRIFT_FRESH');

    // (6) 改标识符 → check stale，退出码 1
    const target = path.join(sandbox, 'src/sample-module.ts');
    fs.writeFileSync(
      target,
      fs.readFileSync(target, 'utf8').replace('const total = a + b;', 'const total = a * b;'),
      'utf8',
    );
    const drifted = drift('drift:check', [...commonArgs(), '--format', 'json']);
    expect(drifted.code).toBe(1);
    const report = JSON.parse(drifted.stdout);
    expect(report.anchors[0]).toMatchObject({ status: 'stale', machineCode: 'DRIFT_STALE' });
    expect(report.anchors[0].expectedFingerprint).not.toBe(report.anchors[0].actualFingerprint);

    // (4) --refresh 按当前代码重算指纹 → 再 check 回到 fresh
    const refreshed = drift('drift:link', [...commonArgs(), '--manifest', manifestPath, '--refresh']);
    expect(refreshed.code, refreshed.stdout).toBe(0);
    expect(readLockFile().anchors[0].fingerprint).not.toBe(lock.anchors[0].fingerprint);
    expect(drift('drift:check', commonArgs()).code).toBe(0);

    // (7) unlink 精确删除
    const unlinked = drift('drift:unlink', [...commonArgs(), 'e2e-addNumbers']);
    expect(unlinked.code, unlinked.stdout).toBe(0);
    expect(readLockFile().anchors).toHaveLength(0);
    // 无锚 → check 退出码 0
    expect(drift('drift:check', commonArgs()).code).toBe(0);
  }, 180_000);

  it('(8) --help 退出码 0 且打印用法；--format json 输出可解析 JSON', () => {
    const help = drift('drift:check', ['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('npm run drift:link');

    drift('drift:link', [...commonArgs(), '--manifest', manifestPath]);
    const json = drift('drift:check', [...commonArgs(), '--format', 'json']);
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.command).toBe('check');
    expect(parsed.summary.fresh).toBe(1);
    expect(parsed.exitCode).toBe(0);
  }, 120_000);

  it('SC-002：同文件 sibling symbol 变动不误伤本锚（端到端）', () => {
    drift('drift:link', [...commonArgs(), '--manifest', manifestPath]);
    const target = path.join(sandbox, 'src/sample-module.ts');
    fs.writeFileSync(
      target,
      fs.readFileSync(target, 'utf8').replace('return a * b;', 'return a * b * 2;'),
      'utf8',
    );
    const res = drift('drift:check', [...commonArgs(), '--format', 'json']);
    expect(res.code, res.stdout).toBe(0);
    expect(JSON.parse(res.stdout).anchors[0].status).toBe('fresh');
  }, 120_000);
});
