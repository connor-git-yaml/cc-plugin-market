/**
 * F186 T3 — build 元数据（F176 postbuild 盖章产物 `dist/.spectra-build-meta.json`）解析。
 *
 * 抽为独立无副作用模块（index.ts 顶层会 main()，单测直接 import 会触发整套 CLI bootstrap），
 * 便于对版本字符串组装逻辑做纯函数单测。
 *
 * F265 起这里是 build 盖章解析的**唯一**去处：`--version` 的人可读串与 MCP 自省的
 * 结构化 `{version, commit, dirty}` 走同一份读取规则，避免两条路径各自演化出
 * 不一致的"这个 build 是哪个 commit"答案。
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

/** F265 G0-3 — MCP `server_build_info` 工具的返回体（`McpSelfIntrospection`）。 */
export interface BuildInfo {
  version: string;
  commit: string | null;
  dirty: boolean | null;
}

/**
 * 由 build-meta 组装**结构化**自省信息（与 `resolveVersionString` 同源、同降级纪律）。
 *
 * 缺 meta（clean checkout / tsx 直跑源码 / 盖章失败）→ `commit`、`dirty` 均为 `null`
 * **而非省略键**：消费方（doctor 的 mcp-server 探针）只需判空值，不必判键是否存在。
 * 任何读取 / 解析失败都在此吞掉 —— 自省是附加能力，绝不能让 MCP server 起不来。
 *
 * `commit` 与 `resolveVersionString` 用同一条 ≥7 位判据（短于 7 位的东西无法与
 * `--version` 只暴露的 commit(7) 比对，留着只会制造 `unreadable` 噪声）；
 * 这里回传全长而不截断：截断是消费侧比较时的事，事实源该给多少给多少。
 */
export function resolveBuildInfo(metaPath: string, version: string): BuildInfo {
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { commit?: unknown; dirty?: unknown };
    return {
      version,
      commit: typeof meta.commit === 'string' && meta.commit.length >= 7 ? meta.commit : null,
      dirty: typeof meta.dirty === 'boolean' ? meta.dirty : null,
    };
  } catch {
    return { version, commit: null, dirty: null };
  }
}
