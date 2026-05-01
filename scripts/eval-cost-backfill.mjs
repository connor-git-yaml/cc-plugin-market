#!/usr/bin/env node
/**
 * F147 Sprint 3 Phase B.2 — 25 task fixture cost 回填
 *
 * 用法：node scripts/eval-cost-backfill.mjs [--dry-run]
 * 扫描 tests/baseline/tasks/ 下所有 fixture，对 taskExecution.costUsd === null 的回填估算成本。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { backfillTaskFixtureCost } from './lib/llm-pricing.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(PROJECT_ROOT, 'tests/baseline/tasks');

function findFixtures(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  for (const taskDir of fs.readdirSync(rootDir)) {
    const taskPath = path.join(rootDir, taskDir);
    if (!fs.statSync(taskPath).isDirectory()) continue;
    for (const toolDir of fs.readdirSync(taskPath)) {
      const toolPath = path.join(taskPath, toolDir);
      if (!fs.statSync(toolPath).isDirectory()) continue;
      const fx = path.join(toolPath, 'full.json');
      if (fs.existsSync(fx)) out.push(fx);
    }
  }
  return out;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fixtures = findFixtures(TASKS_DIR);
  let updated = 0;
  let skipped = 0;
  let totalCost = 0;
  for (const fxPath of fixtures) {
    const original = JSON.parse(fs.readFileSync(fxPath, 'utf-8'));
    const before = original.taskExecution?.costUsd;
    const patched = backfillTaskFixtureCost(JSON.parse(JSON.stringify(original)));
    const after = patched.taskExecution?.costUsd;
    if (before == null && after != null) {
      totalCost += after;
      updated++;
      const rel = path.relative(PROJECT_ROOT, fxPath);
      console.log(`  ${rel}: $${after.toFixed(4)} (${patched.taskExecution.costUsdTier})`);
      if (!dryRun) {
        fs.writeFileSync(fxPath, JSON.stringify(patched, null, 2) + '\n', 'utf-8');
      }
    } else {
      skipped++;
    }
  }
  console.log('');
  console.log(`[cost-backfill] ${dryRun ? '[DRY RUN]' : ''} updated=${updated} skipped=${skipped} (already had cost or no model match)`);
  console.log(`[cost-backfill] aggregate back-filled cost: $${totalCost.toFixed(4)} (estimate tier — see fixture costUsdSource for vendor pricing date)`);
}

main();
