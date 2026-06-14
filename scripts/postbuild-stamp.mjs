#!/usr/bin/env node
/**
 * F186 T3 — postbuild 盖章。
 *
 * `npm run build`（tsc）后自动把 git HEAD commit + dirty 状态盖章到
 * dist/.spectra-build-meta.json（复用 F176 stampBuild）。使得：
 *   - `spectra --version` 运行时可读该 meta 输出 `spectra v<ver> (<commit7>)`，区分新旧 build；
 *   - prepublishOnly 的 build 随之盖章 → 发布的 dist/ 内含 build-meta（dist/ 已在 files 字段）。
 *
 * 盖章失败（如非 git 环境）不应中断 build：`spectra --version` 会优雅降级为纯版本号。
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampBuild } from './lib/spectra-version-gate.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const meta = stampBuild(path.join(PROJECT_ROOT, 'dist'));
  console.error(`[postbuild:stamp] 盖章: commit=${meta.commit.slice(0, 8)}${meta.dirty ? ' (dirty)' : ''}`);
} catch (err) {
  // 盖章失败不阻断 build；--version 走优雅降级（纯版本号）
  console.error(`[postbuild:stamp] 盖章跳过（非致命）: ${err instanceof Error ? err.message : String(err)}`);
}
