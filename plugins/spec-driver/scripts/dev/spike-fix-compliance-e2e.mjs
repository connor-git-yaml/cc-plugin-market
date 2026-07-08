#!/usr/bin/env node

/**
 * spike-fix-compliance-e2e.mjs
 * Feature 208 / T028 — fix 依从性 Stop hook 的手工 headless E2E spike。
 *
 * ⚠️ 手工触发脚本：会 spawn `claude --print` 消耗真实订阅凭据（haiku + 极简任务，
 * 单次 <$0.05），**不计入 `npm test`**、不在 CI 自动跑。用途 = 在与评测同构的
 * headless 入口（--plugin-dir 注入插件副本 + Stop hook 挂载）下，观测
 * `stop-fix-compliance-check.sh` 的 exit code 与 `[FIX-COMPLIANCE]` 反馈闭环。
 *
 * 手法复刻 specs/208-.../research/harness-verification.md 的"插件副本 + hook-trace"实锤：
 *   1. 拷贝 plugins/spec-driver 到 scratchpad/os.tmpdir 副本（不污染源码）
 *   2. 副本 hooks.json 追加 Stop → stop-fix-compliance-check.sh
 *   3. claude --print --plugin-dir <副本> 跑 collapsed / compliant 极简场景
 *   4. 打印 hook-trace 时间线与最终 exit code
 *
 * 用法：
 *   node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario collapsed
 *   node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario compliant
 *   node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario collapsed --keep   # 保留副本供排查
 *
 * 执行属 T029 主编排器职责；本文件仅提供可重跑脚本。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCENARIOS = new Set(['collapsed', 'compliant']);

function parseArgs(argv) {
  const args = { scenario: 'collapsed', keep: false, model: 'claude-haiku-4-5' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scenario') { args.scenario = argv[i + 1] ?? args.scenario; i += 1; } else if (argv[i] === '--keep') { args.keep = true; } else if (argv[i] === '--model') { args.model = argv[i + 1] ?? args.model; i += 1; }
  }
  if (!SCENARIOS.has(args.scenario)) {
    throw new Error(`未知场景: ${args.scenario}（可选: ${[...SCENARIOS].join(', ')}）`);
  }
  return args;
}

/** 递归拷贝插件源码到副本目录（node 20 fs.cpSync） */
function copyPluginTo(destRoot) {
  const pluginSrc = fileURLToPath(new URL('../..', import.meta.url)); // plugins/spec-driver
  const dest = path.join(destRoot, 'spec-driver');
  fs.cpSync(pluginSrc, dest, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`) && !src.endsWith(`${path.sep}node_modules`),
  });
  return dest;
}

/** 在副本 hooks.json 的 Stop 数组挂载新 hook（幂等：T026 之后源码已自带该条目，重复追加会双挂双计数） */
function mountStopHook(pluginDest) {
  const hooksPath = path.join(pluginDest, 'hooks', 'hooks.json');
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  hooks.hooks.Stop = hooks.hooks.Stop || [];
  const alreadyMounted = hooks.hooks.Stop.some((entry) =>
    (entry.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('stop-fix-compliance-check.sh')));
  if (!alreadyMounted) {
    hooks.hooks.Stop.push({
      matcher: '',
      hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/stop-fix-compliance-check.sh' }],
    });
    fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');
  }
  return alreadyMounted;
}

/**
 * 构造极简 headless prompt。
 * collapsed：诱导模型直接输出"完成"而不走委派（观测 exit 2 + [FIX-COMPLIANCE]）。
 * compliant：仅要求回一个字（不会触发 fix 展开 → 非 fix 会话零接触，作为对照）。
 *
 * 说明：真正的 fix 展开由 slash 命令 harness 注入，spike 无法在 --print 位置参数里
 * 完美复刻 SKILL 展开；本 spike 主要观测 hook 是否执行 + 退出码转发是否成立，
 * 完整 opus + 真实展开的端到端可靠性属评测阶段（harness-verification.md 外推边界）。
 */
function buildPrompt(scenario) {
  if (scenario === 'collapsed') {
    return 'Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix\n请直接回复"已修复"，不要调用任何工具。';
  }
  return 'say only ok';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scratchBase = process.env.SCRATCHPAD || os.tmpdir();
  const workdir = fs.mkdtempSync(path.join(scratchBase, 'fix-compliance-spike-'));
  const pluginCopyRoot = path.join(workdir, 'plugins');
  fs.mkdirSync(pluginCopyRoot, { recursive: true });

  console.log(`[spike] scenario=${args.scenario} model=${args.model}`);
  console.log(`[spike] workdir=${workdir}`);

  const pluginDest = copyPluginTo(pluginCopyRoot);
  mountStopHook(pluginDest);
  console.log(`[spike] 插件副本已就绪 + Stop hook 已挂载: ${pluginDest}/hooks/hooks.json`);

  const prompt = buildPrompt(args.scenario);
  const started = Date.now();
  const res = spawnSync('claude', [
    '--print',
    '--model', args.model,
    '--plugin-dir', pluginDest,
    '--permission-mode', 'acceptEdits',
    '--', prompt,
  ], { encoding: 'utf8', cwd: workdir });

  const elapsedMs = Date.now() - started;
  console.log('──────── hook-trace / 输出 ────────');
  console.log(`[spike] exit=${res.status} elapsedMs=${elapsedMs}`);
  console.log('[spike] stdout:');
  console.log(res.stdout || '(空)');
  console.log('[spike] stderr（关注 [FIX-COMPLIANCE] / [GATE-DEGRADED] 前缀）:');
  console.log(res.stderr || '(空)');
  console.log('───────────────────────────────────');

  if (args.keep) {
    console.log(`[spike] --keep：保留副本 ${workdir}`);
  } else {
    fs.rmSync(workdir, { recursive: true, force: true });
    console.log('[spike] 已清理副本');
  }
}

main();
