#!/usr/bin/env node
/**
 * check-codex-inventory.mjs
 * Feature 240 / FR-013 — Codex inventory 机械确认 Spectra 已启用（SC-022）
 *
 * 判据来源：`codex mcp list --json`（Codex 侧 MCP 清单）与 `codex plugin list --json`
 * （已安装 plugin 清单），两者的 `--json` 形态均经 `_grounding.md` §9.7 实测确证。
 *
 * 退出码：
 *   0  Spectra MCP server 条目存在且已启用
 *   2  参数非法 / CLI 自身异常
 *   3  条目缺失（entry-missing）
 *   4  条目存在但未启用（entry-disabled）
 *   5  codex CLI 不可用 —— **显式 skip 语义**，刻意非零：
 *      SC-022 要求"本轮实际执行一次"，静默按 0 通过等于把"没测"伪装成"通过"
 *
 * 🔴 脱敏：`codex mcp list --json` 的条目含 `transport.command` / `transport.env`
 * （绝对路径与凭据），plugin 清单含 `source.path`。本脚本**只**摘取
 * `{name, enabled}` 与受限 semver，其余字段结构性丢弃。
 *
 * 运行相关测试: npx vitest run tests/unit/check-codex-inventory.test.ts
 */

import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { normalizeVersion } from './lib/codex-runtime-doctor-core.mjs';

/** Spectra MCP server 在 Codex 侧可能注册的条目名（闭合集合，禁止模糊匹配） */
export const EXPECTED_MCP_SERVER_NAMES = Object.freeze(['spectra', 'plugin_spectra_spectra']);

/** Spectra plugin 在 Codex plugin 清单中的条目名 */
export const EXPECTED_PLUGIN_NAMES = Object.freeze(['spectra']);

export const INVENTORY_STATUSES = Object.freeze([
  'ok',
  'entry-missing',
  'entry-disabled',
  'codex-cli-unavailable',
  'probe-failed',
]);

const EXIT_CODES = Object.freeze({
  ok: 0,
  'entry-missing': 3,
  'entry-disabled': 4,
  'codex-cli-unavailable': 5,
  'probe-failed': 5,
});

const SUBPROCESS_TIMEOUT_MS = 5000;

function defaultExec(file, args) {
  return execFileSync(file, args, {
    timeout: SUBPROCESS_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** 只读 `code` / `status`，映射为固定枚举后丢弃原对象 */
function classifyErrorClass(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  if (code === 'ENOENT') return 'ENOENT';
  if (code === 'ETIMEDOUT') return 'ETIMEDOUT';
  if (code === 'EACCES' || code === 'EPERM') return 'EACCES';
  const status = err && typeof err === 'object' ? err.status : undefined;
  if (typeof status === 'number' && status !== 0) return 'non-zero-exit';
  return 'unknown';
}

/** @returns {{outcome:'found', data:unknown} | {outcome:'error'|'not-executable', errorClass:string}} */
function probeJson(exec, args) {
  let text;
  try {
    text = exec('codex', args, { timeout: SUBPROCESS_TIMEOUT_MS });
  } catch (err) {
    const errorClass = classifyErrorClass(err);
    return { outcome: errorClass === 'ENOENT' ? 'not-executable' : 'error', errorClass };
  }
  try {
    return { outcome: 'found', data: JSON.parse(text) };
  } catch {
    return { outcome: 'error', errorClass: 'parse-failed' };
  }
}

/**
 * inventory 判定。
 * @param {{exec?: Function}} deps
 */
export function checkCodexInventory({ exec = defaultExec } = {}) {
  const mcpProbe = probeJson(exec, ['mcp', 'list', '--json']);
  const pluginProbe = probeJson(exec, ['plugin', 'list', '--json']);

  // plugin 清单只是辅助信号；不可读不影响 SC-022 的主判据
  let pluginEntry = null;
  if (pluginProbe.outcome === 'found') {
    const installed = Array.isArray(pluginProbe.data?.installed) ? pluginProbe.data.installed : [];
    const hit = installed.find((item) => EXPECTED_PLUGIN_NAMES.includes(item?.name));
    if (hit) {
      pluginEntry = {
        name: hit.name,
        enabled: hit.enabled === true,
        semver: normalizeVersion(typeof hit.version === 'string' ? hit.version : null).semver,
      };
    }
  }

  const base = {
    mcpServer: null,
    pluginEntry,
    mcpProbe: { outcome: mcpProbe.outcome, errorClass: mcpProbe.errorClass ?? null },
    pluginProbe: { outcome: pluginProbe.outcome, errorClass: pluginProbe.errorClass ?? null },
  };

  if (mcpProbe.outcome === 'not-executable') {
    return { ...base, status: 'codex-cli-unavailable', errorClass: mcpProbe.errorClass };
  }
  if (mcpProbe.outcome === 'error') {
    return { ...base, status: 'probe-failed', errorClass: mcpProbe.errorClass };
  }

  const servers = Array.isArray(mcpProbe.data) ? mcpProbe.data : [];
  const hit = servers.find((item) => EXPECTED_MCP_SERVER_NAMES.includes(item?.name));
  if (!hit) {
    return { ...base, status: 'entry-missing', errorClass: null };
  }
  // 只摘取受限字段：transport / env / 路径一律不进结果
  const mcpServer = { name: hit.name, enabled: hit.enabled === true };
  return {
    ...base,
    mcpServer,
    status: mcpServer.enabled ? 'ok' : 'entry-disabled',
    errorClass: null,
  };
}

export function resolveExitCode(result) {
  return EXIT_CODES[result?.status] ?? 2;
}

const STATUS_TEXT = Object.freeze({
  ok: 'Spectra MCP server 条目存在且已启用',
  'entry-missing': 'Codex MCP 清单中缺少 Spectra 条目（entry-missing）',
  'entry-disabled': 'Codex MCP 清单中存在 Spectra 条目但未启用（entry-disabled）',
  'codex-cli-unavailable': 'codex CLI 不可用，本次 inventory 检查被跳过（skip，非通过）',
  'probe-failed': 'inventory 探测失败，结论不可判定（非通过）',
});

function formatText(result) {
  const lines = [
    'Codex inventory 机械确认（check-codex-inventory）',
    '================================================',
    `status:      ${result.status}`,
    `说明:        ${STATUS_TEXT[result.status] ?? '未知状态'}`,
    `mcpProbe:    ${result.mcpProbe.outcome}${result.mcpProbe.errorClass ? ` (${result.mcpProbe.errorClass})` : ''}`,
    `pluginProbe: ${result.pluginProbe.outcome}${result.pluginProbe.errorClass ? ` (${result.pluginProbe.errorClass})` : ''}`,
  ];
  if (result.mcpServer) {
    lines.push(`mcpServer:   name=${result.mcpServer.name}, enabled=${result.mcpServer.enabled}`);
  }
  if (result.pluginEntry) {
    lines.push(
      `pluginEntry: name=${result.pluginEntry.name}, enabled=${result.pluginEntry.enabled}, semver=${result.pluginEntry.semver ?? 'unknown'}`,
    );
  }
  return lines.join('\n');
}

export function parseArgs(argv) {
  let format = 'text';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--format') {
      const value = argv[i + 1];
      if (value !== 'json' && value !== 'text') {
        return { ok: false, error: '--format 只接受 json 或 text' };
      }
      format = value;
      i += 1;
    } else {
      return { ok: false, error: '存在未识别的参数' };
    }
  }
  return { ok: true, format };
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n用法: node plugins/spec-driver/scripts/check-codex-inventory.mjs [--format json|text]\n`);
    return 2;
  }
  let result;
  try {
    result = checkCodexInventory({});
  } catch (err) {
    process.stderr.write(`inventory 检查执行失败（errorClass=${classifyErrorClass(err)}）\n`);
    return 2;
  }
  process.stdout.write(parsed.format === 'json' ? `${JSON.stringify(result, null, 2)}\n` : `${formatText(result)}\n`);
  return resolveExitCode(result);
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  process.exitCode = main(process.argv.slice(2));
}
