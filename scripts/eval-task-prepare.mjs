#!/usr/bin/env node
/**
 * Feature 147 — In-session task prep helper
 *
 * 不 spawn claude CLI，而是为主 session（Claude Code agent）准备 worktree +
 * 输出 prompt，让 caller（我）自己执行任务并写 fixture。
 *
 * 用法：
 *   node scripts/eval-task-prepare.mjs --task T1-micrograd-add-tanh --tool spec-driver-opus
 *   → stdout 输出 worktree path + 完整 prompt（含 spectra context if spec-driver-spectra）
 *
 * 设计目的：绕过 Claude CLI OAuth 401，让主 session 当 sonnet/opus runtime
 * （主 session 自己评分时承担 self-bias 警告）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTaskFixture, prepareWorktree, buildDriverPrompt, loadSpectraContext, runPrimaryOracle } from './eval-task-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { task: null, tool: null, skipSanity: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task') args.task = argv[++i];
    else if (a === '--tool') args.tool = argv[++i];
    else if (a === '--skip-sanity') args.skipSanity = true;
  }
  if (!args.task || !args.tool) throw new Error('--task and --tool required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskFixture = loadTaskFixture(args.task);
  const wt = prepareWorktree({
    taskId: args.task,
    tool: args.tool,
    target: taskFixture.target,
    startCommit: taskFixture.startCommit,
  });
  // setup commands（注入 SPECTRA_REPO_ROOT 让 fixture 引用本仓库的 helper script）
  if (Array.isArray(taskFixture.setupCommands) && taskFixture.setupCommands.length > 0) {
    const setupEnv = { ...process.env, SPECTRA_REPO_ROOT: PROJECT_ROOT };
    for (const cmd of taskFixture.setupCommands) {
      const r = spawnSync('bash', ['-c', cmd], { cwd: wt.wtDir, encoding: 'utf-8', env: setupEnv });
      if (r.status !== 0) throw new Error(`setup failed: ${cmd}\n${r.stderr}`);
    }
    spawnSync('git', ['-C', wt.wtDir, 'add', '-A'], { encoding: 'utf-8' });
    spawnSync('git', ['-C', wt.wtDir, 'commit', '-m', 'eval-bench: task setup'], { encoding: 'utf-8' });
  }

  // Sanity check: oracle 不能在 setup 后立即 PASS（fail-fast catch fixture 设计错误如 T2 startCommit 已含答案）
  if (!args.skipSanity) {
    const sanityResult = runPrimaryOracle({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
    if (sanityResult.passed) {
      throw new Error(
        `❌ FIXTURE SANITY FAIL: ${args.task} 的 primaryOracle 在 startCommit + setupCommands 后立即 PASS — ` +
        `task 没有实际工作可做（fixture 设计错误），所有评分将 invalid。\n` +
        `修复 fixture json（如加 setupCommands 制造问题），或 --skip-sanity 强制跳过。`
      );
    }
  }

  const spectraContext = args.tool === 'spec-driver-spectra' ? loadSpectraContext(taskFixture.target) : null;
  const prompt = buildDriverPrompt({ tool: args.tool, taskPrompt: taskFixture.prompt, spectraContext });
  console.log(JSON.stringify({
    task: args.task,
    tool: args.tool,
    wtDir: wt.wtDir,
    branch: wt.branchName,
    target: taskFixture.target,
    primaryOracle: taskFixture.primaryOracle,
    spectraContextBytes: spectraContext?.length ?? 0,
    promptBytes: prompt.length,
    prompt,
  }, null, 2));
}

main().catch((err) => {
  console.error(`[task-prepare] error: ${err.message}`);
  process.exit(1);
});
