/**
 * judge-snapshot-io.mjs
 * Feature 236 — 判定器快照漂移信号：I/O 边界层
 *
 * 全部函数非抛出式（内部 try/catch 吞 I/O 异常，转换为判别式联合返回值），
 * 仅用 node:fs / node:path / node:crypto。判别式联合区分「确定性负判定（invalid/absent）」
 * 与「不确定性错误（error）」两种不同性质，绝不互相坍缩（C2 修订）。
 *
 * 运行相关测试: node --test plugins/spec-driver/tests/judge-snapshot-io.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** installed_plugins.json 中 spec-driver 插件的 key */
const PLUGIN_METADATA_KEY = 'spec-driver@cc-plugin-market';

/**
 * 现算文件 sha256（data-model.md §2）。非抛出式。
 * @param {string} absPath
 * @returns {{status:'ok',sha256:string}|{status:'missing',sha256:null}|{status:'error',sha256:null,errorCode?:string}}
 */
export function computeSha256(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    return { status: 'ok', sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { status: 'missing', sha256: null };
    return { status: 'error', sha256: null, errorCode: err && err.code ? err.code : 'unknown' };
  }
}

/**
 * 校验一个目录是否为合法 spec-driver 插件根（data-model.md §3.1 六步判别顺序）。
 * invalid = 确定性负判定（可安全 fallback）；error = 不确定性（不可 fallback）。
 * @param {string} dir
 * @returns {{kind:'ok'}|{kind:'invalid',reason:string}|{kind:'error',errorCode:string}}
 */
export function validatePluginRoot(dir) {
  // 1. dir 不存在
  let dirStat;
  try {
    dirStat = fs.statSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { kind: 'invalid', reason: 'dir-absent' };
    return { kind: 'error', errorCode: err && err.code ? err.code : 'unknown' };
  }
  if (!dirStat.isDirectory()) return { kind: 'invalid', reason: 'dir-absent' };

  // 2/3. 读取 manifest
  const manifestPath = path.join(dir, '.claude-plugin', 'plugin.json');
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { kind: 'invalid', reason: 'manifest-missing' };
    return { kind: 'error', errorCode: err && err.code ? err.code : 'unknown' };
  }

  // 4. JSON.parse 失败
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { kind: 'error', errorCode: 'manifest-json-parse-error' };
  }

  // 5. name 不匹配
  if (!manifest || manifest.name !== 'spec-driver') {
    return { kind: 'invalid', reason: 'name-mismatch' };
  }

  // 6. 全部通过
  return { kind: 'ok' };
}

/**
 * canonicalize 路径：realpathSync 解析 symlink，失败退化为 path.resolve。
 * 导出供 doctor 层复用，保证三来源 SourceProbe.canonicalPath 规范化行为一致（data-model §3.3）。
 */
export function canonicalize(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * 将 validatePluginRoot 结果映射为 SourceProbe（附带 path/canonicalPath）。
 */
function mapValidationToProbe(targetPath, validation) {
  switch (validation.kind) {
    case 'ok':
      return { kind: 'ok', path: targetPath, canonicalPath: canonicalize(targetPath) };
    case 'invalid':
      return { kind: 'invalid', reason: validation.reason };
    case 'error':
    default:
      return { kind: 'error', errorCode: validation.errorCode };
  }
}

/**
 * 读取 .specify/.spec-driver-path 并对其指向路径校验（data-model.md §3.3）。
 * @param {string} projectRoot
 * @returns {import('./judge-snapshot-core.mjs').SourceProbe}
 */
export function readSpecDriverPathFile(projectRoot) {
  const filePath = path.join(projectRoot, '.specify', '.spec-driver-path');
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { kind: 'unavailable' };
    return { kind: 'error', errorCode: err && err.code ? err.code : 'unknown' };
  }
  const target = content.trim();
  if (target === '') return { kind: 'unavailable' };
  return mapValidationToProbe(target, validatePluginRoot(target));
}

/**
 * 读取 ~/.claude/plugins/installed_plugins.json 中 spec-driver 条目（data-model.md §3.4）。
 * absent（无文件）/ error（读失败）/ invalid（JSON 损坏）/ ok（含 candidates）四态分明。
 * @param {string} claudeHome
 * @returns {import('./judge-snapshot-core.mjs').InstalledPluginsMetadataResult}
 */
export function readInstalledPluginsMetadata(claudeHome) {
  const filePath = path.join(claudeHome, 'plugins', 'installed_plugins.json');
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'error', errorCode: err && err.code ? err.code : 'unknown' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'json-parse-error' };
  }

  const entries =
    parsed && parsed.plugins && Array.isArray(parsed.plugins[PLUGIN_METADATA_KEY])
      ? parsed.plugins[PLUGIN_METADATA_KEY]
      : [];

  const candidates = entries.map((entry) => {
    const installPath = entry && typeof entry.installPath === 'string' ? entry.installPath : '';
    return {
      path: installPath,
      canonicalPath: canonicalize(installPath),
      scope: entry && (entry.scope === 'user' || entry.scope === 'project') ? entry.scope : null,
      valid: validatePluginRoot(installPath),
    };
  });

  return { kind: 'ok', candidates };
}

/**
 * 扫描 <claudeHome>/plugins/cache/<market>/spec-driver/<version>/ 是否存在任意版本目录
 * （合同：任意匹配版本目录存在即 present，不要求含 manifest、不要求 validatePluginRoot 通过）。
 * 扫描过程本身遇 I/O 错误 → 'error'（不得与「目录结构不存在」混为一谈）。
 * 禁止用 existsSync 判别需区分错误语义的路径——它无法区分 ENOENT 与 EACCES，
 * 会把不可访问误判为 absent（C3）；symlink 版本目录用 statSync 显式区分 ENOENT 与其他错误。
 * @param {string} claudeHome
 * @returns {'present'|'absent'|'error'}
 */
export function scanInstalledSnapshotPresence(claudeHome) {
  const cacheRoot = path.join(claudeHome, 'plugins', 'cache');
  let markets;
  try {
    markets = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return 'absent';
    return 'error';
  }

  for (const market of markets) {
    // market 目录可能是 symlink（与 version 层对称）：显式 statSync 跟随，
    // broken link(ENOENT) → 跳过，其他 I/O 错误 → error，不静默压成 absent。
    let marketIsDir = market.isDirectory();
    if (!marketIsDir && market.isSymbolicLink()) {
      try {
        marketIsDir = fs.statSync(path.join(cacheRoot, market.name)).isDirectory();
      } catch (err) {
        if (err && err.code === 'ENOENT') continue;
        return 'error';
      }
    }
    if (!marketIsDir) continue;
    const specDriverDir = path.join(cacheRoot, market.name, 'spec-driver');
    let versions;
    try {
      versions = fs.readdirSync(specDriverDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      return 'error';
    }
    for (const version of versions) {
      // 常规目录：存在即 present（不再探 manifest）
      if (version.isDirectory()) return 'present';
      // symlink 版本目录：显式 statSync 解析，区分 broken(ENOENT) 与不可访问(其他错误)
      if (version.isSymbolicLink()) {
        try {
          if (fs.statSync(path.join(specDriverDir, version.name)).isDirectory()) return 'present';
        } catch (err) {
          if (err && err.code === 'ENOENT') continue; // 断链 → 视为不存在，继续扫描
          return 'error';
        }
      }
    }
  }
  return 'absent';
}
