/**
 * Feature 176 — Spectra 版本门禁（cohort 3 必须用含 F177-F181 的 build）。
 *
 * 背景（关键，spec FR-A-004b / SC-001b）：`node dist/cli/index.js --version` 对
 * 「本地含 F177-F181 的 build」和「npm 上不含 F177-F181 的旧 4.2.0」**都报 v4.2.0**，
 * 版本号无法区分。因此门禁不靠版本号，而靠：
 *   (1) build-time 把 git HEAD commit + dirty 状态盖章到 dist/.spectra-build-meta.json；
 *   (2) gate-time 校验 F177/F181 sentinel commit 是 meta.commit 的祖先（即 build 源含这些改动）；
 *   (3) staleness：dist 产物不得早于关键 src 源文件（防止 src 更新后忘了 rebuild）。
 * 旧 npm binary 没有我们的 build-meta（或 commit 不含 sentinel）→ 被挡下。
 *
 * 关联：tasks T-A4。被 spike(T-B1) / batch(T-E1) / verify(T-F3) 入口调用，失败 hard-fail。
 */

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from './swe-bench-verified-paths.mjs';

export const BUILD_META_NAME = '.spectra-build-meta.json';

/** tsc 编译 dist 的输入：sourceDirty 只看这些路径（再生 doc 脏不算）。 */
export const BUILD_INPUT_PATHS = ['src', 'tsconfig.json', 'tsconfig.build.json', 'package.json', 'package-lock.json'];

/**
 * F177-F181 的 sentinel commit（master 已 ship，用 40 位完整 SHA 避免 ambiguous）。
 * 门禁要求它们都是 build 源 commit 的祖先；可经 opts.sentinels 覆盖。
 */
export const DEFAULT_SENTINELS = [
  { feature: 'F177', commit: 'e23c623fa6264477d39f8d65da0ee6fa923612e3', desc: '统一 MCP 响应契约 + withTelemetry' },
  { feature: 'F181', commit: '989bf9b0a3cabacb8a5dc2ca65bb61462c01b949', desc: 'import-resolver 单一权威收口' },
];

/** dist 目录所有 .js 的内容指纹（merkle-ish）：任何 dist 改动都会变 → 防"盖章后重 tsc 不重盖章"绕过。 */
export function hashDistTree(distDir) {
  const files = [];
  const walkJs = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkJs(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walkJs(distDir);
  files.sort();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const rel = path.relative(distDir, f);
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(f));
    h.update('\0');
  }
  return { sha256: h.digest('hex'), fileCount: files.length };
}

function git(args, cwd = PROJECT_ROOT) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

/**
 * build-time 调用：把当前 git HEAD + dirty 状态盖章到 dist/.spectra-build-meta.json。
 * @returns {object} 写入的 meta
 */
export function stampBuild(distDir = path.join(PROJECT_ROOT, 'dist'), builtAtIso) {
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0) throw new Error(`[version-gate] git rev-parse HEAD 失败: ${head.stderr}`);
  const dirty = git(['status', '--porcelain']).stdout.length > 0;
  // sourceDirty 只看 build 输入（tsc 编译 dist 的源）。理由：评测要求"dist 可由某 commit 的源复现"，
  // 这只取决于 src/ + tsconfig + package；像 specs/src.spec.md 这类再生 doc 脏不影响 dist 复现性，
  // 不应阻断 spike/batch（CON-2 明确该 doc 保持未提交）。
  const sourceDirty = git(['status', '--porcelain', '--', ...BUILD_INPUT_PATHS]).stdout.length > 0;
  // 在写 meta 前算 dist 内容指纹（meta 自身是 .json 不计入 .js 指纹）
  const distHash = hashDistTree(distDir);
  const meta = {
    commit: head.stdout,
    dirty,
    sourceDirty,
    distSha256: distHash.sha256,
    distFileCount: distHash.fileCount,
    builtAtIso: builtAtIso ?? new Date().toISOString(),
    note: 'F176 版本门禁凭据；勿手改。distSha256 绑定 dist 内容；sourceDirty 只看 build 输入。',
  };
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, BUILD_META_NAME), JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  return meta;
}

/** 关键 src 源文件集合：dist 必须不早于它们（staleness 检测）。 */
const STALENESS_SOURCES = [
  'src/mcp',
  'src/core/import-resolver.ts',
  'package.json',
];

function newestMtimeMs(relPaths) {
  let newest = 0;
  for (const rel of relPaths) {
    const abs = path.join(PROJECT_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const f of walk(abs)) newest = Math.max(newest, fs.statSync(f).mtimeMs);
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/**
 * gate-time 校验。
 * @param {string} distCli  dist/cli/index.js 绝对路径
 * @param {object} [opts]   { sentinels, allowDirty=true, checkStaleness=true }
 * @returns {{ok:boolean, reason:string, meta:object|null, checks:object}}
 */
export function verifySpectraVersion(distCli, opts = {}) {
  const sentinels = opts.sentinels ?? DEFAULT_SENTINELS;
  const allowDirty = opts.allowDirty ?? true;
  const checkStaleness = opts.checkStaleness ?? true;
  const checks = {};

  if (!fs.existsSync(distCli)) {
    return { ok: false, reason: `dist 不存在: ${distCli}（先 node scripts/build-spectra-stamped.mjs）`, meta: null, checks };
  }
  const metaPath = path.join(path.dirname(path.dirname(distCli)), BUILD_META_NAME); // dist/cli/index.js → dist/.spectra-build-meta.json
  if (!fs.existsSync(metaPath)) {
    return {
      ok: false,
      reason: `缺 build-meta（${BUILD_META_NAME}）。这通常意味着用的是旧 npm binary 而非本地 build。请 node scripts/build-spectra-stamped.mjs。`,
      meta: null, checks,
    };
  }
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); }
  catch (e) { return { ok: false, reason: `build-meta 解析失败: ${e.message}`, meta: null, checks }; }

  // (1) sentinel 祖先校验：F177/F181 commit 必须都是 build 源 commit 的祖先
  for (const s of sentinels) {
    const r = git(['merge-base', '--is-ancestor', s.commit, meta.commit]);
    checks[`sentinel:${s.feature}`] = r.status === 0;
    if (r.status !== 0) {
      return {
        ok: false,
        reason: `build 源 commit ${meta.commit.slice(0, 8)} 不含 ${s.feature}(${s.commit}) — ${s.desc}。疑似旧版/错误分支 build。`,
        meta, checks,
      };
    }
  }

  // (2) dist 内容指纹：重算 dist 树 hash 与盖章值比对 —— 防"盖章后重 tsc 换实现不重盖章"绕过（codex CRITICAL）
  const distDir = path.dirname(path.dirname(distCli)); // dist/cli/index.js → dist
  if (meta.distSha256) {
    const now = hashDistTree(distDir);
    checks.distSha256 = { stamped: meta.distSha256.slice(0, 12), actual: now.sha256.slice(0, 12), match: now.sha256 === meta.distSha256 };
    if (now.sha256 !== meta.distSha256) {
      return {
        ok: false,
        reason: `dist 内容与盖章指纹不符（dist 在盖章后被改动/重编译但未重新盖章）。请 node scripts/build-spectra-stamped.mjs。`,
        meta, checks,
      };
    }
  } else {
    // 旧 meta 无 distSha256 → 视为不可信，要求重盖
    return { ok: false, reason: `build-meta 缺 distSha256（旧格式/被篡改）。请 node scripts/build-spectra-stamped.mjs。`, meta, checks };
  }

  // (3) dirty — 只看 build 输入（sourceDirty）。再生 doc（如 specs/src.spec.md）脏不阻断。
  //     旧 meta 无 sourceDirty 时回退到全树 dirty（向后兼容）。
  const effectiveDirty = meta.sourceDirty ?? meta.dirty;
  checks.dirty = meta.dirty;
  checks.sourceDirty = effectiveDirty;
  if (effectiveDirty && !allowDirty) {
    return { ok: false, reason: `build 输入源（src/tsconfig/package）有未提交改动，且 allowDirty=false（评测要求 src clean committed build）`, meta, checks };
  }

  // (4) staleness：dist 不得早于关键 src
  if (checkStaleness) {
    const distMtime = fs.statSync(distCli).mtimeMs;
    const srcMtime = newestMtimeMs(STALENESS_SOURCES);
    checks.staleness = { distMtimeMs: distMtime, srcMtimeMs: srcMtime, stale: srcMtime > distMtime };
    if (srcMtime > distMtime) {
      return {
        ok: false,
        reason: `dist 早于关键 src（src 更新后未 rebuild）。dist=${new Date(distMtime).toISOString()} < src=${new Date(srcMtime).toISOString()}。请 node scripts/build-spectra-stamped.mjs。`,
        meta, checks,
      };
    }
  }

  return {
    ok: true,
    reason: `OK：build 源 ${meta.commit.slice(0, 8)}${meta.dirty ? '(dirty)' : ''} 含 ${sentinels.map((s) => s.feature).join('+')}`,
    meta, checks,
  };
}
