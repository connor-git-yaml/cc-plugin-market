#!/usr/bin/env node
/**
 * F170d — Driver Preference Shaping E2E harness（RED stub）
 *
 * 在 F170c SC-002 harness 基础上，通过 --append-system-prompt 注入「工具优先使用规则」
 * 引导块，实测 guided active-call rate（≥ 50% primary gate）。
 *
 * 与 170c 的唯一变量：system-prompt 注入引导块（忠实模拟 Phase A 投递通道）。
 * namespace 与 production 统一：.mcp.json server key = plugin_spectra_spectra。
 *
 * 复用 scripts/lib/driver-eval-core.mjs 的纯函数（不复制 170c）。
 *
 * RED phase：builder 函数 throw，等 GREEN 实现。CLI guard 确保被 import 时不执行 main。
 */

import path from 'node:path';

const RED = (name) => {
  throw new Error(`RED: feature-170d-driver-preference.${name} not implemented`);
};

/** 构建 .mcp.json 内容；server key 必须为 plugin_spectra_spectra（与 production namespace 一致）。 */
export function buildMcpConfig(_wtDir) {
  return RED('buildMcpConfig');
}

/** 构建 claude --print args；allowedTools 用 production namespace + 含 --append-system-prompt。 */
export function buildClaudeArgs(_wtDir, _systemPrompt) {
  return RED('buildClaudeArgs');
}

/** 读 template 文件并按指定 agent 的 tools 渲染注入块（wrapper，内部调 core.renderInjectionBlock）。 */
export function buildInjectionBlock(_agent) {
  return RED('buildInjectionBlock');
}

/** 断言注入块中出现的 fully-qualified 工具 ⊆ allowedTools，否则 throw。 */
export function assertInjectionSubsetOfAllowed(_block, _allowedTools) {
  return RED('assertInjectionSubsetOfAllowed');
}

async function main() {
  return RED('main');
}

// CLI guard：仅在直接 `node scripts/feature-170d-driver-preference.mjs` 执行时跑 main，
// 被 vitest import 时不执行（修 codex C-1：用 endsWith 而非 string===URL 比较）。
const isCliEntry = process.argv[1] != null
  && path.resolve(process.argv[1]).endsWith('feature-170d-driver-preference.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(2);
  });
}
