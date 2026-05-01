#!/usr/bin/env node
/**
 * Feature 147 Sprint 1 — Task Fixture Sanity Check
 *
 * 检测 task fixture 的 oracle 是否会在 startCommit + setupCommands 之后立即 PASS。
 * 如果 PASS → 说明 task 没有实际工作可做（startCommit 已含答案，或 setup 没有
 * 制造出"待解决问题"），oracle 是假阳性，所有评分都 invalid。
 *
 * Catch the T2 类 bug：nanoGPT@3adf61e 的 train.py 已经有 cosine LR scheduler，
 * 但 oracle 仅 grep `def get_lr` —— 任何工具不做任何事都 PASS。
 *
 * 用法：
 *   node scripts/eval-task-fixture-check.mjs --task T1-micrograd-add-tanh
 *   node scripts/eval-task-fixture-check.mjs --all
 *   node scripts/eval-task-fixture-check.mjs --task T1 --verbose
 *
 * Exit code:
 *   0 = 全部 fixture OK（setup 后 oracle FAIL，符合预期）
 *   1 = 有 fixture INVALID（oracle 假阳性）
 *   2 = error（baseline workspace 缺失等）
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTaskFixture, prepareWorktree, runPrimaryOracle } from './eval-task-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASK_FIXTURES_DIR = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures');

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = { task: null, all: false, verbose: false, keepWorktree: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--task': args.task = argv[++i]; break;
      case '--all': args.all = true; break;
      case '--verbose': args.verbose = true; break;
      case '--keep-worktree': args.keepWorktree = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.task && !args.all) throw new Error('--task <id> or --all required');
  return args;
}

// ============================================================
// 单 fixture sanity check（pure 逻辑，dependency injection 便于 unit test）
// ============================================================

/**
 * @param {object} taskFixture - 已加载的 task fixture JSON
 * @param {object} deps - dependency injection
 * @param {Function} deps.prepareWorktreeFn - (opts) => { wtDir }
 * @param {Function} deps.runOracleFn - ({ wtDir, oracle }) => { passed, ... }
 * @param {Function} [deps.runSetupCmdsFn] - (wtDir, cmds, env) => void
 * @returns {{status: 'ok'|'invalid'|'error', reason: string, oracleResult?: object}}
 */
export function checkFixtureSanity(taskFixture, deps) {
  const { prepareWorktreeFn, runOracleFn, runSetupCmdsFn } = deps;
  if (!taskFixture.taskId || !taskFixture.target || !taskFixture.startCommit) {
    return { status: 'error', reason: 'fixture missing taskId/target/startCommit' };
  }
  if (!taskFixture.primaryOracle) {
    return { status: 'error', reason: 'fixture missing primaryOracle' };
  }

  let wt;
  try {
    wt = prepareWorktreeFn({
      taskId: taskFixture.taskId,
      tool: 'sanity-check',
      target: taskFixture.target,
      startCommit: taskFixture.startCommit,
    });
  } catch (e) {
    return { status: 'error', reason: `worktree prep failed: ${e.message}` };
  }

  if (Array.isArray(taskFixture.setupCommands) && taskFixture.setupCommands.length > 0 && runSetupCmdsFn) {
    try {
      runSetupCmdsFn(wt.wtDir, taskFixture.setupCommands);
    } catch (e) {
      return { status: 'error', reason: `setup failed: ${e.message}`, wtDir: wt.wtDir };
    }
  }

  const oracleResult = runOracleFn({ wtDir: wt.wtDir, oracle: taskFixture.primaryOracle });
  if (oracleResult.passed) {
    return {
      status: 'invalid',
      reason: 'oracle 在 startCommit + setup 后立即 PASS — 说明 task 没有实际工作（fixture 设计错误）',
      oracleResult,
      wtDir: wt.wtDir,
    };
  }
  return { status: 'ok', reason: 'oracle 在 setup 后 FAIL（符合预期：task 有实际工作）', oracleResult, wtDir: wt.wtDir };
}

// ============================================================
// CLI 实跑封装：注入真实的 prepare + setupCmds runner
// ============================================================

function realSetupCmdsRunner(wtDir, cmds) {
  const env = { ...process.env, SPECTRA_REPO_ROOT: PROJECT_ROOT };
  for (const cmd of cmds) {
    const r = spawnSync('bash', ['-c', cmd], { cwd: wtDir, encoding: 'utf-8', env });
    if (r.status !== 0) throw new Error(`setup cmd failed: ${cmd}\nstderr: ${r.stderr}`);
  }
  // commit setup state
  spawnSync('git', ['-C', wtDir, 'add', '-A'], { encoding: 'utf-8' });
  spawnSync('git', ['-C', wtDir, 'commit', '-m', 'sanity-check: task setup'], { encoding: 'utf-8' });
}

export function runSanityCheck(taskFixture, { keepWorktree = false } = {}) {
  // 用 temp BENCH_HOME 防止污染主 bench worktrees
  const hadEnv = 'SPEC_DRIVER_BENCH_HOME' in process.env;
  const savedEnv = process.env.SPEC_DRIVER_BENCH_HOME;
  const tmpBench = fs.mkdtempSync(path.join(os.tmpdir(), 'sanity-bench-'));
  process.env.SPEC_DRIVER_BENCH_HOME = tmpBench;
  try {
    return checkFixtureSanity(taskFixture, {
      prepareWorktreeFn: prepareWorktree,
      runOracleFn: runPrimaryOracle,
      runSetupCmdsFn: realSetupCmdsRunner,
    });
  } finally {
    // 关键：原本未设置时不能恢复成 string 'undefined'
    if (hadEnv) process.env.SPEC_DRIVER_BENCH_HOME = savedEnv;
    else delete process.env.SPEC_DRIVER_BENCH_HOME;
    if (!keepWorktree) {
      fs.rmSync(tmpBench, { recursive: true, force: true });
    } else {
      console.error(`[sanity-check] worktree kept: ${tmpBench}`);
    }
  }
}

function listAllTaskFixtures() {
  if (!fs.existsSync(TASK_FIXTURES_DIR)) return [];
  return fs.readdirSync(TASK_FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskIds = args.all ? listAllTaskFixtures() : [args.task];
  if (taskIds.length === 0) {
    console.error('[sanity-check] no task fixtures found');
    process.exit(2);
  }

  let invalidCount = 0;
  let errorCount = 0;
  const summary = [];
  for (const taskId of taskIds) {
    let taskFixture;
    try {
      taskFixture = loadTaskFixture(taskId);
    } catch (e) {
      console.error(`[${taskId}] LOAD ERROR: ${e.message}`);
      summary.push({ taskId, status: 'error', reason: e.message });
      errorCount++;
      continue;
    }
    const result = runSanityCheck(taskFixture, { keepWorktree: args.keepWorktree });
    summary.push({ taskId, ...result });
    if (result.status === 'invalid') {
      invalidCount++;
      console.error(`❌ ${taskId}: INVALID — ${result.reason}`);
      if (args.verbose && result.oracleResult?.details) {
        console.error('   oracle details:', JSON.stringify(result.oracleResult.details, null, 2).slice(0, 800));
      }
    } else if (result.status === 'error') {
      errorCount++;
      console.error(`⚠️  ${taskId}: ERROR — ${result.reason}`);
    } else {
      console.log(`✅ ${taskId}: OK — ${result.reason}`);
    }
  }

  console.log('');
  console.log(`Summary: ${summary.length} fixture(s) checked, ${invalidCount} invalid, ${errorCount} error`);

  if (invalidCount > 0) process.exit(1);
  if (errorCount > 0 && summary.every((s) => s.status === 'error')) process.exit(2);
  process.exit(0);
}

const isCliEntry = process.argv[1]?.endsWith('eval-task-fixture-check.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[sanity-check] error: ${err.message}`);
    process.exit(2);
  });
}
