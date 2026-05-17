#!/usr/bin/env node
// Phase E-1 — 扩 9 worktree replay
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = '/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/stoic-mccarthy-e70d74';
const RUNS_DIR = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-lite/runs/C');
const TASKS = ['SWE-L001', 'SWE-L003', 'SWE-L005'];

const { handleDetectChanges } = await import(path.join(PROJECT_ROOT, 'dist/mcp/agent-context-tools.js'));

const results = [];
for (const taskId of TASKS) {
  const taskDir = path.join(RUNS_DIR, taskId);
  const runFiles = fs.readdirSync(taskDir).filter((f) => /run-.*-C-\d+\.json$/.test(f)).sort();
  for (const f of runFiles) {
    const run = JSON.parse(fs.readFileSync(path.join(taskDir, f), 'utf-8'));
    const wtDir = run.worktreePath;
    if (!wtDir || !fs.existsSync(wtDir)) { continue; }
    let diffText = '';
    try {
      diffText = execFileSync('git', ['-C', wtDir, 'diff', 'HEAD~1'], { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
    } catch { continue; }
    const r = await handleDetectChanges({ diff: diffText, projectRoot: wtDir });
    const text = r?.content?.[0]?.text ?? '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const cs = parsed?.changedSymbols ?? [];
    const af = parsed?.affectedSymbols ?? [];
    const rs = parsed?.riskSummary ?? {};
    results.push({
      taskId, runFile: f,
      target: run.taskId.includes('pytest') ? 'pytest' : run.taskId.includes('astropy') ? 'astropy' : 'sympy',
      worktreePath: wtDir,
      diffSize: diffText.length,
      isError: r.isError === true,
      errorCode: parsed?.code ?? null,
      changedSymbolsFileCount: cs.length,
      affectedSymbolsCount: af.length,
      totalChanged: rs.totalChanged ?? 0,
      riskTier: rs.riskTier ?? null,
      // 截取首个 file 的 symbol 列表 (前 10 个) 作为代表样本
      sampleSymbols: cs[0]?.symbols?.slice(0, 10) ?? [],
      sampleFile: cs[0]?.file ?? null,
    });
  }
}
const outFile = path.join(RUNS_DIR, '_f165-phase-e1-detect-changes-9runs.json');
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`[done] ${results.length} runs replayed → ${outFile}`);
// Print summary
for (const r of results) {
  console.log(`  ${r.runFile} | ${r.target} | totalChanged=${r.totalChanged} | sampleFile=${r.sampleFile}`);
}
