/**
 * judge-snapshot-io.test.mjs
 * Feature 236 — I/O 边界层单测（io）
 *
 * 用 os.tmpdir() 构造临时目录 fixture，覆盖每个函数的判别式联合分支
 * （absent / invalid / error 三态分明，不互相坍缩）。
 *
 * 运行: node --test plugins/spec-driver/tests/judge-snapshot-io.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  computeSha256,
  validatePluginRoot,
  readSpecDriverPathFile,
  readInstalledPluginsMetadata,
  scanInstalledSnapshotPresence,
} from '../scripts/lib/judge-snapshot-io.mjs';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-io-'));
});
afterEach(() => {
  try {
    // 恢复权限以便清理
    fs.chmodSync(tmp, 0o755);
  } catch {
    // ignore
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 构造一个合法插件根：<dir>/.claude-plugin/plugin.json（name 可覆盖） */
function makePluginRoot(dir, name = 'spec-driver') {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
}

describe('computeSha256', () => {
  it('文件存在且可读 → ok + 64 位十六进制，确定性', () => {
    const f = path.join(tmp, 'a.txt');
    fs.writeFileSync(f, 'hello');
    const r1 = computeSha256(f);
    const r2 = computeSha256(f);
    assert.equal(r1.status, 'ok');
    assert.match(r1.sha256, /^[0-9a-f]{64}$/);
    assert.equal(r1.sha256, crypto.createHash('sha256').update('hello').digest('hex'));
    assert.equal(r1.sha256, r2.sha256);
  });

  it('文件不存在 → missing（不抛出）', () => {
    assert.deepStrictEqual(computeSha256(path.join(tmp, 'nope.txt')), {
      status: 'missing',
      sha256: null,
    });
  });

  it('父路径为文件（ENOTDIR）→ error（确定性，不依赖权限，root/CI 可覆盖）', () => {
    const notADir = path.join(tmp, 'plain.txt');
    fs.writeFileSync(notADir, 'x');
    const r = computeSha256(path.join(notADir, 'child.txt'));
    assert.equal(r.status, 'error');
    assert.equal(r.sha256, null);
    assert.equal(r.errorCode, 'ENOTDIR');
  });

  it('文件无读权限 → error/EACCES（root 环境跳过）', { skip: isRoot ? 'root 环境无权限语义' : false }, () => {
    const f = path.join(tmp, 'locked.txt');
    fs.writeFileSync(f, 'secret');
    fs.chmodSync(f, 0o000);
    const r = computeSha256(f);
    assert.equal(r.status, 'error');
    assert.equal(r.sha256, null);
    assert.equal(r.errorCode, 'EACCES');
  });
});

describe('validatePluginRoot — §3.1 六步判别顺序', () => {
  it('dir 不存在 → invalid/dir-absent', () => {
    assert.deepStrictEqual(validatePluginRoot(path.join(tmp, 'ghost')), {
      kind: 'invalid',
      reason: 'dir-absent',
    });
  });

  it('dir 存在但 plugin.json 不存在 → invalid/manifest-missing', () => {
    const d = path.join(tmp, 'noManifest');
    fs.mkdirSync(d, { recursive: true });
    assert.deepStrictEqual(validatePluginRoot(d), { kind: 'invalid', reason: 'manifest-missing' });
  });

  it('plugin.json 读取遇非 ENOENT I/O 错误（EACCES）→ error（root 跳过）', { skip: isRoot ? 'root' : false }, () => {
    const d = path.join(tmp, 'lockedManifest');
    makePluginRoot(d);
    fs.chmodSync(path.join(d, '.claude-plugin', 'plugin.json'), 0o000);
    const r = validatePluginRoot(d);
    assert.equal(r.kind, 'error');
    assert.equal(r.errorCode, 'EACCES');
  });

  it('plugin.json JSON.parse 失败 → error/manifest-json-parse-error', () => {
    const d = path.join(tmp, 'brokenJson');
    fs.mkdirSync(path.join(d, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude-plugin', 'plugin.json'), '{ broken');
    assert.deepStrictEqual(validatePluginRoot(d), {
      kind: 'error',
      errorCode: 'manifest-json-parse-error',
    });
  });

  it('name !== spec-driver → invalid/name-mismatch', () => {
    const d = path.join(tmp, 'wrongName');
    makePluginRoot(d, 'some-other-plugin');
    assert.deepStrictEqual(validatePluginRoot(d), { kind: 'invalid', reason: 'name-mismatch' });
  });

  it('全部通过 → ok', () => {
    const d = path.join(tmp, 'good');
    makePluginRoot(d);
    assert.deepStrictEqual(validatePluginRoot(d), { kind: 'ok' });
  });
});

describe('readSpecDriverPathFile', () => {
  function writeSpecPath(projectRoot, content) {
    fs.mkdirSync(path.join(projectRoot, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.specify', '.spec-driver-path'), content);
  }

  it('文件不存在 → unavailable', () => {
    assert.deepStrictEqual(readSpecDriverPathFile(tmp), { kind: 'unavailable' });
  });

  it('内容为空/空白 → unavailable', () => {
    writeSpecPath(tmp, '   \n  ');
    assert.deepStrictEqual(readSpecDriverPathFile(tmp), { kind: 'unavailable' });
  });

  it('内容为有效路径且 validatePluginRoot ok → ok + path/canonicalPath', () => {
    const target = path.join(tmp, 'snap');
    makePluginRoot(target);
    writeSpecPath(tmp, target);
    const r = readSpecDriverPathFile(tmp);
    assert.equal(r.kind, 'ok');
    assert.equal(r.path, target);
    assert.equal(r.canonicalPath, fs.realpathSync(target));
  });

  it('内容指向路径 validatePluginRoot invalid → 映射 invalid', () => {
    writeSpecPath(tmp, path.join(tmp, 'ghost-target'));
    assert.deepStrictEqual(readSpecDriverPathFile(tmp), { kind: 'invalid', reason: 'dir-absent' });
  });

  it('文件读取本身失败（EACCES）→ error（root 跳过）', { skip: isRoot ? 'root' : false }, () => {
    writeSpecPath(tmp, '/whatever');
    fs.chmodSync(path.join(tmp, '.specify', '.spec-driver-path'), 0o000);
    const r = readSpecDriverPathFile(tmp);
    assert.equal(r.kind, 'error');
    assert.equal(r.errorCode, 'EACCES');
  });
});

describe('readInstalledPluginsMetadata', () => {
  function writeMeta(claudeHome, obj) {
    fs.mkdirSync(path.join(claudeHome, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(claudeHome, 'plugins', 'installed_plugins.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  it('文件不存在 → absent', () => {
    assert.deepStrictEqual(readInstalledPluginsMetadata(tmp), { kind: 'absent' });
  });

  it('JSON 损坏 → invalid/json-parse-error（不是 absent）', () => {
    writeMeta(tmp, '{ "plugins": ');
    assert.deepStrictEqual(readInstalledPluginsMetadata(tmp), {
      kind: 'invalid',
      reason: 'json-parse-error',
    });
  });

  it('合法但无 spec-driver 条目 → ok/candidates:[]', () => {
    writeMeta(tmp, { version: 2, plugins: { 'other@market': [] } });
    assert.deepStrictEqual(readInstalledPluginsMetadata(tmp), { kind: 'ok', candidates: [] });
  });

  it('含条目 → ok/candidates 含 path/canonicalPath/scope/valid', () => {
    const snap = path.join(tmp, 'snapdir');
    makePluginRoot(snap);
    writeMeta(tmp, {
      version: 2,
      plugins: {
        'spec-driver@cc-plugin-market': [
          { scope: 'user', installPath: snap, version: '4.3.0' },
        ],
      },
    });
    const r = readInstalledPluginsMetadata(tmp);
    assert.equal(r.kind, 'ok');
    assert.equal(r.candidates.length, 1);
    const c = r.candidates[0];
    assert.equal(c.path, snap);
    assert.equal(c.canonicalPath, fs.realpathSync(snap));
    assert.equal(c.scope, 'user');
    assert.deepStrictEqual(c.valid, { kind: 'ok' });
  });

  it('scope 缺失 → null；canonicalPath 无法 realpath 时退化为 resolve', () => {
    const ghost = path.join(tmp, 'ghost-install');
    writeMeta(tmp, {
      version: 2,
      plugins: {
        'spec-driver@cc-plugin-market': [{ installPath: ghost }],
      },
    });
    const r = readInstalledPluginsMetadata(tmp);
    assert.equal(r.candidates[0].scope, null);
    assert.equal(r.candidates[0].canonicalPath, path.resolve(ghost));
    assert.equal(r.candidates[0].valid.kind, 'invalid');
  });

  it('文件读取失败（EACCES）→ error（root 跳过）', { skip: isRoot ? 'root' : false }, () => {
    writeMeta(tmp, { version: 2, plugins: {} });
    fs.chmodSync(path.join(tmp, 'plugins', 'installed_plugins.json'), 0o000);
    const r = readInstalledPluginsMetadata(tmp);
    assert.equal(r.kind, 'error');
    assert.equal(r.errorCode, 'EACCES');
  });
});

describe('scanInstalledSnapshotPresence', () => {
  it('无任何插件 cache 结构 → absent', () => {
    assert.equal(scanInstalledSnapshotPresence(tmp), 'absent');
  });

  it('存在匹配 <market>/spec-driver/<version>/.claude-plugin/plugin.json → present', () => {
    const snap = path.join(tmp, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver', '4.3.0');
    makePluginRoot(snap);
    assert.equal(scanInstalledSnapshotPresence(tmp), 'present');
  });

  it('cache 存在但无 spec-driver 目录 → absent', () => {
    makePluginRoot(path.join(tmp, 'plugins', 'cache', 'other-market', 'other-plugin', '1.0.0'));
    assert.equal(scanInstalledSnapshotPresence(tmp), 'absent');
  });

  it('版本目录存在但无 manifest → present（合同：任意版本目录存在即 present，C3）', () => {
    // 仅建目录，不写 .claude-plugin/plugin.json —— 修复前 existsSync(manifest) 误判为 absent
    fs.mkdirSync(path.join(tmp, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver', '4.3.0'), {
      recursive: true,
    });
    assert.equal(scanInstalledSnapshotPresence(tmp), 'present');
  });

  it('spec-driver 下 version 条目为普通文件（非目录/非 symlink）→ absent（W2b：锁定 fall-through 分支）', () => {
    const specDriverDir = path.join(tmp, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver');
    fs.mkdirSync(specDriverDir, { recursive: true });
    // 版本条目是文件而非目录：既不 isDirectory 也不 isSymbolicLink → 不计 present
    fs.writeFileSync(path.join(specDriverDir, 'README.txt'), 'not a version dir');
    assert.equal(scanInstalledSnapshotPresence(tmp), 'absent');
  });

  it('market 目录为 symlink（指向真实目录含版本目录）→ present（W1：market symlink 也跟随）', () => {
    const cacheRoot = path.join(tmp, 'plugins', 'cache');
    fs.mkdirSync(cacheRoot, { recursive: true });
    // 真实 market 目录建在别处，cache 下用 symlink 指向它
    const realMarket = path.join(tmp, 'real-market');
    fs.mkdirSync(path.join(realMarket, 'spec-driver', '4.3.0'), { recursive: true });
    fs.symlinkSync(realMarket, path.join(cacheRoot, 'cc-plugin-market'), 'dir');
    assert.equal(scanInstalledSnapshotPresence(tmp), 'present');
  });

  it('market 为断链 symlink → 跳过（不误报 present/error），无其他 market → absent（W1）', () => {
    const cacheRoot = path.join(tmp, 'plugins', 'cache');
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.symlinkSync(path.join(tmp, 'ghost-market-target'), path.join(cacheRoot, 'broken-market'), 'dir');
    assert.equal(scanInstalledSnapshotPresence(tmp), 'absent');
  });

  it('扫描 cache 根父路径为文件（ENOTDIR）→ error（确定性，root/CI 可覆盖）', () => {
    // plugins 是文件 → readdirSync(plugins/cache) 抛 ENOTDIR（非 ENOENT）→ error
    fs.writeFileSync(path.join(tmp, 'plugins'), 'i am a file');
    assert.equal(scanInstalledSnapshotPresence(tmp), 'error');
  });

  it('spec-driver 下 version 枚举遇 EACCES → error（不得压成 absent，C3）', { skip: isRoot ? 'root 环境无权限语义' : false }, () => {
    const specDriverDir = path.join(tmp, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver');
    fs.mkdirSync(specDriverDir, { recursive: true });
    fs.chmodSync(specDriverDir, 0o000);
    const r = scanInstalledSnapshotPresence(tmp);
    // 恢复以便清理
    fs.chmodSync(specDriverDir, 0o755);
    assert.equal(r, 'error');
  });

  it('扫描 cache 根本身遇 I/O 错误（EACCES）→ error（root 跳过）', { skip: isRoot ? 'root' : false }, () => {
    const cache = path.join(tmp, 'plugins', 'cache');
    fs.mkdirSync(cache, { recursive: true });
    // 在 cache 下建一个不可读的 market 子目录，迫使遍历失败
    const market = path.join(cache, 'cc-plugin-market');
    fs.mkdirSync(market, { recursive: true });
    fs.chmodSync(market, 0o000);
    const r = scanInstalledSnapshotPresence(tmp);
    // 恢复以便清理
    fs.chmodSync(market, 0o755);
    assert.equal(r, 'error');
  });
});
