#!/usr/bin/env node
/**
 * Feature 238 Slice 2 — Codex 子代理能力（multi_agent）install-time 探测 helper。
 *
 * Q3 技术选型裁决（见 specs/238-codex-wrapper-completeness/plan.md §0）：解析
 * `codex features list` 的 stdout 用 Node helper 而非 shell awk/grep，理由是
 * FR-203 定义的七类 reason 分支需要确定性单测覆盖（尤其 timeout 场景不能真实等待）。
 * 本模块把"解析 stdout 的纯函数"与"如何拿到 stdout（子进程 spawn/超时/异常）"分离，
 * 前者可用 fixture 字符串直接单测，后者只需对 `node:child_process` 做少量 mock
 * （手法与 tests/unit/codex-proxy.test.ts 一致）。
 *
 * 架构不变量（spec.md「架构决策」）：本模块的探测结果只写入本地 gitignored 的
 * sidecar 文件（`.codex/spec-driver-capability.md`），永远不参与 wrapper 三份
 * tracked 产物（`.codex/skills/`、`plugins/spec-driver/skills-codex/`、
 * extract-wrapper-body.mjs 处理后的 sha256 校验正文）的生成——本文件不应被这些
 * 生成路径 import。
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

/**
 * @typedef {'native'|'degraded'} CapabilityState
 * @typedef {'binary-missing'|'command-failed'|'unsupported-command'|'timeout'|'no-feature-row'|'malformed-effective'|'effective-false'|null} CapabilityReason
 * @typedef {{capability: CapabilityState, reason: CapabilityReason}} CapabilityVerdict
 */

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * 解析 `codex features list` 的 stdout，定位首 token 精确等于 `multi_agent` 的行
 * （排除 `multi_agent_mode`/`multi_agent_v2` 等干扰行），取该行末尾最后一个非空 token
 * 作为 effective state（而非固定列位裁切——stage 列可能是多词，如 `under development`，
 * 见 research 附 2 一手样例）。
 *
 * @param {string} stdout
 * @returns {CapabilityVerdict}
 */
export function parseFeaturesListOutput(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/);
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    if (tokens[0] !== 'multi_agent') continue;

    // I2（Codex implement 审查修复轮，顺手修复）：effective token 统一 lowercase
    // 后再比较——`codex features list` 输出的大小写惯例未做机械保证，`TRUE`/`FALSE`
    // 不应被误判为 malformed-effective（保守方向 not affected：非 true/false 变体
    // 仍归 malformed-effective）。
    const effective = tokens[tokens.length - 1].toLowerCase();
    if (effective === 'true') {
      return { capability: 'native', reason: null };
    }
    if (effective === 'false') {
      return { capability: 'degraded', reason: 'effective-false' };
    }
    return { capability: 'degraded', reason: 'malformed-effective' };
  }
  return { capability: 'degraded', reason: 'no-feature-row' };
}

/**
 * 把子进程异常归类为 FR-203 的四类子进程边界 reason（不含 no-feature-row/
 * malformed-effective/effective-false——那三类由 parseFeaturesListOutput 在成功
 * 路径产出）。
 *
 * @param {unknown} err
 * @returns {CapabilityVerdict}
 */
function classifySubprocessError(err) {
  const code = /** @type {{code?: string}} */ (err)?.code;
  if (code === 'ENOENT') {
    return { capability: 'degraded', reason: 'binary-missing' };
  }

  // W3（Codex implement 审查修复轮，timeout 分类硬化）：`err.code === 'ETIMEDOUT'`
  // 必须最优先判为 timeout。实测 macOS 上 `execFileSync` 的 `timeout` 选项真实
  // 触发的超时形态是 `code === 'ETIMEDOUT'`，且 `signal` 可能为 `null`、
  // `status` 可能为 `0`（子进程被 timeout 机制杀死后未必带 killed/SIGTERM 标记）。
  // 旧实现按 `killed === true || signal === 'SIGTERM'` 判定会把这类真实超时
  // 错分为 command-failed。
  if (code === 'ETIMEDOUT') {
    return { capability: 'degraded', reason: 'timeout' };
  }

  const rawStderr = /** @type {{stderr?: unknown}} */ (err)?.stderr;
  const stderrText =
    typeof rawStderr === 'string'
      ? rawStderr
      : rawStderr && typeof (/** @type {{toString?: unknown}} */ (rawStderr).toString) === 'function'
        ? String(rawStderr)
        : '';
  if (stderrText.toLowerCase().includes('unrecognized subcommand')) {
    return { capability: 'degraded', reason: 'unsupported-command' };
  }

  // signal === 'SIGTERM' 但无 ETIMEDOUT：子进程自身收到 SIGTERM 终止（如被外部
  // 信号杀死），并非本次探测的超时，归为 command-failed 而非误判为 timeout。
  return { capability: 'degraded', reason: 'command-failed' };
}

/**
 * 探测本机 Codex CLI 的 `multi_agent` 能力状态。FR-201：只读命令、5 秒超时上限；
 * FR-202：显式 try/catch 捕获非零退出/超时/进程不存在，不让探测失败中止调用方的
 * `set -euo pipefail` 流程。
 *
 * @param {{timeout?: number, env?: NodeJS.ProcessEnv, cwd?: string}} [opts]
 * @returns {CapabilityVerdict}
 */
export function detectCodexCapability(opts = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, env, cwd } = opts;
  let stdout;
  try {
    stdout = execFileSync('codex', ['features', 'list'], {
      timeout,
      // W3：显式 SIGKILL——`execFileSync` 默认用 SIGTERM 杀超时子进程，子进程可
      // 忽略/屏蔽 SIGTERM，导致 5 秒超时上限实际失真（进程继续挂起）。
      killSignal: 'SIGKILL',
      encoding: 'utf-8',
      ...(env !== undefined ? { env } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
    });
  } catch (err) {
    return classifySubprocessError(err);
  }
  return parseFeaturesListOutput(stdout);
}

/**
 * 探测本机 `codex --version` 输出。失败（binary 不存在、非零退出、超时等）一律
 * 返回 `null`，不抛异常——FR-207/208：sidecar 是尽力而为的诊断产物，版本探测失败
 * 不得阻断 sidecar 写入或 install 流程。
 *
 * @param {{timeout?: number, env?: NodeJS.ProcessEnv, cwd?: string}} [opts]
 * @returns {string|null}
 */
export function detectCodexVersion(opts = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, env, cwd } = opts;
  try {
    const stdout = execFileSync('codex', ['--version'], {
      timeout,
      killSignal: 'SIGKILL',
      encoding: 'utf-8',
      ...(env !== undefined ? { env } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
    });
    const trimmed = String(stdout ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * 拼出 sidecar（`.codex/spec-driver-capability.md`）完整 Markdown 正文。
 * 三要素：capability 行（机械可解析，degraded 时含 reason）、ISO 8601 探测时间戳行、
 * `codex --version` 结果行。时间戳在渲染时用真实 `new Date().toISOString()` 生成
 * （非探测时刻缓存值——sidecar 反映的是"本次 install 写入时刻"）。
 *
 * @param {{capability: CapabilityState, reason: CapabilityReason, version: string|null}} result
 * @returns {string}
 */
export function renderCapabilityMarkdown(result) {
  const { capability, reason, version } = result;
  const timestamp = new Date().toISOString();
  const capabilityLine =
    capability === 'native'
      ? '- Subagent Capability: native'
      : `- Subagent Capability: degraded(reason=${reason})`;

  return [
    '# Spec Driver Codex Capability',
    '',
    '（本文件由 install-time 探测生成，本地运行态产物，不参与任何 tracked wrapper 产物；见 .gitignore）',
    '',
    capabilityLine,
    `- Detected At: ${timestamp}`,
    `- Codex Version: ${version ?? 'unknown'}`,
    '',
  ].join('\n');
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    // 与 extract-wrapper-body.mjs 保持同一实现：用 fileURLToPath 而非
    // new URL(...).pathname，后者在安装路径含空格/非 ASCII 时保留 %20 转义。
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// CLI 入口：默认单行 JSON；`--markdown` 输出 renderCapabilityMarkdown 结果
// （codex-skills.sh 直接 `> "$sidecar_path"` 重定向消费，零 JSON 解析、零 jq 依赖）。
if (isDirectExecution()) {
  const capability = detectCodexCapability();
  const version = detectCodexVersion();
  const result = { ...capability, version };

  if (process.argv.includes('--markdown')) {
    process.stdout.write(renderCapabilityMarkdown(result));
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
