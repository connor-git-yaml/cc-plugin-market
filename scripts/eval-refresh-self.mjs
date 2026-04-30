#!/usr/bin/env node
/**
 * Feature 147 Phase 5 — eval:refresh-self
 *
 * 升版后只重跑"自己"的 fixture（spectra / spec-driver / control），不动竞品 frozen fixture。
 * 流程：
 *   1. 跑 baseline-collect --target X --tool spectra（spectra 自己的 perf + quality）
 *   2. 跑 eval-judge --rubric spec-quality（重评 spec quality）
 *   3. 可选 --grounding 跑 grounding 重评
 *   4. 可选 --tasks 跑 spec-driver / control 任务重跑
 *
 * 用法：
 *   npm run eval:refresh-self                          # 仅 spectra perf + quality
 *   npm run eval:refresh-self -- --grounding           # +grounding
 *   npm run eval:refresh-self -- --tasks T1            # +tasks
 *   npm run eval:refresh-self -- --verify-artifacts    # 仅校验 fixture 完整
 *
 * 不跑竞品 fixture（frozenFixture: true 的 fixture 不动）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SELF_TARGETS = ['karpathy/micrograd', 'karpathy/nanoGPT', 'self-dogfood'];

function parseArgs(argv) {
  const args = {
    targets: SELF_TARGETS,
    grounding: false,
    tasks: [],
    verifyArtifacts: false,
    skipPerf: false,
    judgeInterRater: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--targets': args.targets = argv[++i].split(','); break;
      case '--grounding': args.grounding = true; break;
      case '--tasks': args.tasks = argv[++i].split(','); break;
      case '--verify-artifacts': args.verifyArtifacts = true; break;
      case '--skip-perf': args.skipPerf = true; break;
      case '--inter-rater': args.judgeInterRater = Number(argv[++i]); break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  return args;
}

function runStep(label, cmd, args) {
  console.log(`\n[refresh-self] >>> ${label}`);
  console.log(`[refresh-self] $ node ${cmd} ${args.join(' ')}`);
  const r = spawnSync('node', [path.join(PROJECT_ROOT, cmd), ...args], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`[refresh-self] step "${label}" failed (exit ${r.status})`);
    return false;
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.verifyArtifacts) {
    console.log('[refresh-self] verify-artifacts mode');
    const r = spawnSync('node', [path.join(PROJECT_ROOT, 'scripts/baseline-collect.mjs'), '--verify-artifacts'], { cwd: PROJECT_ROOT, stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }

  console.log(`[refresh-self] targets=${args.targets.join(',')} grounding=${args.grounding} tasks=${args.tasks.join(',') || '(none)'}`);

  // Step 1: spectra perf 重跑（如未 skip）
  if (!args.skipPerf) {
    for (const t of args.targets) {
      const ok = runStep(`spectra perf for ${t}`, 'scripts/baseline-collect.mjs', ['--target', t, '--tool', 'spectra', '--mode', 'full']);
      if (!ok) {
        console.warn(`[refresh-self] spectra perf for ${t} failed; continuing`);
      }
    }
  }

  // Step 2: spec-quality judge 重评
  for (const t of args.targets) {
    const fixturePath = path.join(PROJECT_ROOT, 'tests/baseline', t.split('/').pop(), 'spectra/full.json');
    if (!fs.existsSync(fixturePath)) {
      console.warn(`[refresh-self] fixture not found: ${fixturePath}; skipping judge`);
      continue;
    }
    runStep(`spec-quality judge for ${t}`, 'scripts/eval-judge.mjs', ['--fixture', fixturePath, '--rubric', 'spec-quality', '--inter-rater', String(args.judgeInterRater)]);
  }

  // Step 3 (optional): grounding 重评
  if (args.grounding) {
    runStep('grounding judge', 'scripts/eval-grounding.mjs', ['--target', 'karpathy/micrograd', '--task', 'tanh']);
  }

  // Step 4 (optional): task-execution 重跑
  for (const taskId of args.tasks) {
    for (const tool of ['spec-driver', 'control']) {
      runStep(`task ${taskId} × ${tool}`, 'scripts/eval-task-runner.mjs', ['--task', taskId, '--tool', tool, '--cleanup', 'on-success']);
      const fixturePath = path.join(PROJECT_ROOT, 'tests/baseline/tasks', taskId, tool, 'full.json');
      if (fs.existsSync(fixturePath)) {
        runStep(`task judge ${taskId} × ${tool}`, 'scripts/eval-judge.mjs', ['--fixture', fixturePath, '--rubric', 'task-execution', '--inter-rater', String(args.judgeInterRater)]);
      }
    }
  }

  console.log('\n[refresh-self] done. Run `npm run baseline:diff` to compare against previous git revision fixture.');
}

const isCliEntry = process.argv[1]?.endsWith('eval-refresh-self.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[refresh-self] error: ${err.message}`);
    process.exit(1);
  });
}
