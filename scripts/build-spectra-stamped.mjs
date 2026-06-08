#!/usr/bin/env node
/**
 * Feature 176 — 带版本盖章的 spectra build。
 *
 * 跑 `npm run build`（tsc）后，把 git HEAD commit + dirty 状态盖章到
 * dist/.spectra-build-meta.json，供版本门禁（spectra-version-gate.mjs）校验
 * cohort 3 用的确实是含 F177-F181 的本地 build（而非 npm 上的旧 4.2.0）。
 *
 * 用法：node scripts/build-spectra-stamped.mjs
 * 关联：tasks T-A4，spec FR-A-004b。
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampBuild, verifySpectraVersion } from './lib/spectra-version-gate.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.error('[build:stamped] tsc 编译中…');
const build = spawnSync('npm', ['run', 'build'], { cwd: PROJECT_ROOT, encoding: 'utf-8', stdio: 'inherit' });
if (build.status !== 0) {
  console.error('[build:stamped] npm run build 失败');
  process.exit(build.status ?? 1);
}

const meta = stampBuild(path.join(PROJECT_ROOT, 'dist'));
console.error(`[build:stamped] 盖章: commit=${meta.commit.slice(0, 8)}${meta.dirty ? ' (dirty)' : ''} builtAt=${meta.builtAtIso}`);

// 自校验：build 完应立即通过门禁
const distCli = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
const gate = verifySpectraVersion(distCli);
if (!gate.ok) {
  console.error(`[build:stamped] ⚠️ 版本门禁未过：${gate.reason}`);
  process.exit(2);
}
console.error(`[build:stamped] ✅ 版本门禁通过：${gate.reason}`);
