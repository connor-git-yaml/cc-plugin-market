/**
 * Feature 176 — 本地 spectra plugin 目录构造（cohort 3 + spike 共用）。
 *
 * 作用：生成一个临时 Claude plugin 目录，名仍为 "spectra"（保证工具命名空间是
 * mcp__plugin_spectra_spectra__*），但 MCP server 指向**本仓库 build 的 dist**
 * （含 F177-F181），而不是全局安装的 npm 旧版 `spectra` CLI。
 *
 * 注意（spike 实测结论）：
 *   - 全局已装 spectra plugin 时，同名 plugin 的加载歧义未在 host 复现为崩溃
 *     （首跑 exit 1 的真因是 --allowedTools variadic 吃掉位置 prompt），但为消除
 *     "实际加载了哪个 build" 的不确定性，host-runbook 要求跑全量前禁用全局 spectra plugin。
 *   - 每次调用生成唯一 mkdtemp 目录（并行安全），调用方负责（或留给 OS tmp 清理）。
 *
 * 关联：tasks T-C1，spec FR-A-004（cohort3 必须用含 F177-F181 的 spectra）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * @param {string} distCli  本仓库 dist/cli/index.js 绝对路径（须先经版本门禁校验）
 * @returns {string} plugin 目录绝对路径（用于 claude --plugin-dir）
 */
export function writeLocalSpectraPluginDir(distCli) {
  if (!fs.existsSync(distCli)) {
    throw new Error(`[local-spectra-plugin] dist 不存在: ${distCli}；先 node scripts/build-spectra-stamped.mjs`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-spectra-plugin-'));
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'spectra',
      version: '4.2.0-f176-local',
      description: 'F176 local build (F177-F181) — eval cohort3 专用临时 plugin',
      mcpServers: './.mcp.json',
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { spectra: { command: 'node', args: [distCli, 'mcp-server'] } } }, null, 2),
  );
  return dir;
}

/** 全局 spectra plugin（cache）是否存在 —— 存在时实际加载哪个 build 有歧义，须警示/禁用。 */
export function globalSpectraPluginPresent() {
  return fs.existsSync(path.join(os.homedir(), '.claude/plugins/cache/cc-plugin-market/spectra'));
}
