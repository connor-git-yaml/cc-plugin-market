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
 *   node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario noop-unverified
 *   node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario collapsed --keep   # 保留副本供排查
 *
 * 执行属 T029 主编排器职责；本文件仅提供可重跑脚本。
 *
 * F216 / T024（SC-003b 可选子项）新增 `noop-unverified` scenario：观测 F216 判据链新增的
 * no-op 复现证据门（`### 复现对账` 缺失 → `noop:repro-fields`）在真实 headless 模型下的
 * hook 线路与退出码转发。为使判据落点（feature 目录是否存在、fix-report.md 是否含
 * `## 判定依据` 且不含 `### 复现对账`）具备可重复性，采用"脚本预置制品 + 模型只做最小收口
 * 触发"的方案（而非让模型自由生成 fix-report 全文）：
 *   - `seedNoopUnverifiedFixture` 在 workdir 内预先写好 `specs/<N>-fix-.../fix-report.md`
 *     （no-op 判定依据 anchor 存在、复现对账子区块刻意缺失），内容与判据门槛精确对齐；
 *   - prompt 只要求模型执行一条脚本给定的只读 Bash 命令（`cat <path> >> /dev/null`，
 *     含写指示符 `>>` 与 artifact 路径但不改写文件内容），使
 *     `resolveFeatureDirCandidate` 能从 transcript 提名到该 feature 目录；
 *   - 判据链其余部分（closure 分类、复现对账解析）完全消费磁盘上的预置内容，
 *     不依赖模型的自由发挥，从而让本 scenario 的期望 missing key 可重复观测。
 * 局限同上：--print 无法完美复刻 SKILL 展开，本 scenario 不验证编排器完整分支，
 * 仅验证 hook 对"已落盘 no-op 无证据制品"的机械判定与退出码转发。
 * SC-003b 首跑观测：acceptEdits 权限模式下真实模型会自我补齐证据（含经允许的 cat 输出 sentinel 的
 * declared-boundary 路径），把预置的无证据 fix-report 修成合规形态使门正确放行 exit 0、观测不到阻断；
 * 故本 scenario 改用 default 权限模式（Write/Edit 被拒）钉住无证据态，配合 Bash(cat *) 白名单放行触发命令。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCENARIOS = new Set(['collapsed', 'compliant', 'noop-unverified']);

/** noop-unverified scenario 的预置 feature 目录（相对 workdir，需匹配 ARTIFACT_PATH_REGEX） */
const NOOP_FEATURE_DIR = 'specs/301-fix-noop-spike';
const NOOP_FIX_REPORT_REL = `${NOOP_FEATURE_DIR}/fix-report.md`;
/** 预置 fix-report.md 内容：含 `## 判定依据` no-op anchor，刻意不含 `### 复现对账` 子区块，
 * 且不含 "Root Cause"（避免误判为 repair 双锚点）。 */
const NOOP_FIX_REPORT_CONTENT = `# Fix Report

## 判定依据

历史提交已经修复该问题，当前代码路径已经不再触发原始异常现象，无需再做任何改动。
`;
/** 模型被要求原样执行的只读触发命令：含写指示符 \`>>\` 与 artifact 路径，但输出丢弃到 /dev/null，不改写预置文件 */
const NOOP_TRIGGER_COMMAND = `cat ${NOOP_FIX_REPORT_REL} >> /dev/null`;

/** 在 workdir 内预置 noop-unverified scenario 的 feature 目录与 fix-report.md */
function seedNoopUnverifiedFixture(workdir) {
  const dir = path.join(workdir, NOOP_FEATURE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(workdir, NOOP_FIX_REPORT_REL), NOOP_FIX_REPORT_CONTENT, 'utf8');
}

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
 * noop-unverified：诱导模型在 fix 会话语境下声称"历史已修复无需改动"，但只要求执行一条
 *   脚本给定的只读触发命令（不改写预置的无复现证据 fix-report.md），观测 F216 新增
 *   `noop:repro-fields` 判据分支（观测 exit 2 + [FIX-COMPLIANCE] + noop:repro-* 文案）。
 *
 * 说明：真正的 fix 展开由 slash 命令 harness 注入，spike 无法在 --print 位置参数里
 * 完美复刻 SKILL 展开；本 spike 主要观测 hook 是否执行 + 退出码转发是否成立，
 * 完整 opus + 真实展开的端到端可靠性属评测阶段（harness-verification.md 外推边界）。
 */
function buildPrompt(scenario) {
  if (scenario === 'collapsed') {
    return 'Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix\n请直接回复"已修复"，不要调用任何工具。';
  }
  if (scenario === 'noop-unverified') {
    return [
      'Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix',
      '这是一次历史已修复的 no-op 收口：请只执行下面这一条 Bash 命令（原样执行，不要改写、不要新增其它工具调用、不要读取或修改其它文件）：',
      NOOP_TRIGGER_COMMAND,
      '执行完成后直接回复"已收口"，不要再调用任何其他工具，也不要做任何解释。',
      '若任何工具调用被拒绝，直接回复"已收口"结束，不要重试其他方式。',
    ].join('\n');
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

  if (args.scenario === 'noop-unverified') {
    seedNoopUnverifiedFixture(workdir);
    console.log(`[spike] 已预置无复现证据 fix-report: ${NOOP_FIX_REPORT_REL}`);
  }

  const prompt = buildPrompt(args.scenario);
  // noop-unverified 用 default（headless 下 Write/Edit 被拒，钉住预置的无证据态——见文件头局限段
  // SC-003b 首跑观测）；collapsed/compliant 保持 acceptEdits 不变。
  const permissionMode = args.scenario === 'noop-unverified' ? 'default' : 'acceptEdits';
  const claudeArgs = [
    '--print',
    '--model', args.model,
    '--plugin-dir', pluginDest,
    '--permission-mode', permissionMode,
  ];
  if (args.scenario === 'noop-unverified') {
    // 本 scenario 需要模型实际执行一条 Bash 命令（触发 resolveFeatureDirCandidate 提名），
    // 其余 scenario 刻意不调用工具，故仅在此处放行 Bash（窄范围：仅 cat，不放开任意命令）。
    // 配合 default 权限模式：Bash(cat *) 白名单使触发命令可执行，Write/Edit 仍被拒 → 预置报告保持无证据态。
    claudeArgs.push('--allowedTools', 'Bash(cat *)');
  }
  claudeArgs.push('--', prompt);
  const started = Date.now();
  const res = spawnSync('claude', claudeArgs, { encoding: 'utf8', cwd: workdir });

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
