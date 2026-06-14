/**
 * F186 T3 — `--version` build 元数据解析。
 *
 * 抽为独立无副作用模块（index.ts 顶层会 main()，单测直接 import 会触发整套 CLI bootstrap），
 * 便于对版本字符串组装逻辑做纯函数单测。
 */

import { readFileSync } from 'node:fs';

/**
 * 由 build-meta（F176 postbuild 盖章产物 dist/.spectra-build-meta.json）组装版本字符串。
 *
 * 有 commit（≥7 位）→ `spectra v<ver> (<commit7>)` 以区分新旧 build；
 * 无 / 读失败 / 解析失败 → 优雅降级为纯版本号 `spectra v<ver>`。
 *
 * 纯运行时 fs 读取（非静态 import gitignored 文件），clean checkout 缺 meta 不影响 tsc/vitest。
 */
export function resolveVersionString(metaPath: string, version: string): string {
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { commit?: unknown };
    if (typeof meta.commit === 'string' && meta.commit.length >= 7) {
      return `spectra v${version} (${meta.commit.slice(0, 7)})`;
    }
  } catch {
    // 缺 build-meta 或解析失败 → 优雅降级为纯版本号
  }
  return `spectra v${version}`;
}
