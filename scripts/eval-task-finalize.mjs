#!/usr/bin/env node
/**
 * Feature 147 — In-session task finalize helper
 *
 * Caller（主 session）完成任务实施后，调用本脚本：
 *   1. 跑 oracle 验证
 *   2. 测产物 metrics
 *   3. 写完整 schema 1.1 fixture（含 in-session caveat + model 字段）
 *
 * 用法：
 *   node scripts/eval-task-finalize.mjs --task T1-... --tool spec-driver-spectra \
 *     --wall-ms 60000 --rubric-score 7 --rubric-rationale "..."
 *
 * NOTE：Sprint 2 后默认走 scripts/eval-task-executor.mjs (GLM unified executor + cross-LLM jury)；
 * finalize.mjs 仅 legacy 用途（in-session executor + manual rubric）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadTaskFixture, runPrimaryOracle, captureProductMetrics, assembleTaskFixture } from './eval-task-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BENCH_HOME = process.env.SPEC_DRIVER_BENCH_HOME ?? path.join(process.env.HOME, '.spec-driver-bench-worktrees');

function parseArgs(argv) {
  const args = { task: null, tool: null, wallMs: null, rubricScore: null, rubricRationale: null, executionMode: 'in-session-opus', cleanup: 'never' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--task': args.task = argv[++i]; break;
      case '--tool': args.tool = argv[++i]; break;
      case '--wall-ms': args.wallMs = Number(argv[++i]); break;
      case '--rubric-score': args.rubricScore = Number(argv[++i]); break;
      case '--rubric-rationale': args.rubricRationale = argv[++i]; break;
      case '--execution-mode': args.executionMode = argv[++i]; break;
      case '--cleanup': args.cleanup = argv[++i]; break;
    }
  }
  if (!args.task || !args.tool) throw new Error('--task and --tool required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskFixture = loadTaskFixture(args.task);
  const wtDir = path.join(BENCH_HOME, args.task, args.tool);
  if (!fs.existsSync(wtDir)) throw new Error(`worktree not found: ${wtDir}`);

  const oracleResult = runPrimaryOracle({ wtDir, oracle: taskFixture.primaryOracle });
  console.error(`[finalize] oracle ${oracleResult.kind}: ${oracleResult.passed ? 'PASS' : 'FAIL'}`);

  const productMetrics = captureProductMetrics(wtDir);

  const fixture = assembleTaskFixture({
    taskId: args.task,
    tool: args.tool,
    taskFixture,
    wtDir,
    runResult: { wallMs: args.wallMs ?? 0, stdout: '', stderr: '', exitCode: 0, timedOut: false },
    oracleResult,
    productMetrics,
  });

  // In-session caveat：标 model + executionMode + 不双盲（self-bias warning）
  fixture.meta.model = 'claude-opus-4-7';
  fixture.meta.command = 'in-session';     // 明示无 spawn claude CLI
  fixture.meta.args = null;                // 否则会保留误导的 ['--model','sonnet-4-6']
  fixture.taskExecution.model = 'claude-opus-4-7';
  fixture.taskExecution.executionMode = args.executionMode;
  fixture.taskExecution.executorRuntime = 'main-session-opus-4-7';
  fixture.taskExecution.modelDisclaimer = 'legacy in-session opus executor — Sprint 2 引入 GLM unified executor 后此路径已不推荐使用，仅保留供 backward compat';
  fixture.taskExecution.rubricJudgeScore = args.rubricScore;
  fixture.taskExecution.rubricJudgeRationale = args.rubricRationale;
  fixture.taskExecution.judgedBy = 'self-judge-main-session-opus-4-7';
  fixture.taskExecution.interRaterDelta = null; // 主 session self-judge，无法双盲

  const fixtureDir = path.join(PROJECT_ROOT, 'tests/baseline/tasks', args.task, args.tool);
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, 'full.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  console.error(`[finalize] fixture written: ${path.relative(PROJECT_ROOT, fixturePath)}`);

  if (args.cleanup === 'on-success' && oracleResult.passed) {
    fs.rmSync(wtDir, { recursive: true, force: true });
    console.error(`[finalize] worktree cleaned`);
  }
  console.log(JSON.stringify({ ok: true, oraclePass: oracleResult.passed, productMetrics }, null, 2));
}

main().catch((err) => {
  console.error(`[finalize] error: ${err.message}`);
  process.exit(1);
});
