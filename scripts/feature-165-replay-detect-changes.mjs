#!/usr/bin/env node
/**
 * Feature 165 Phase D-1 — 编排器直接调用 handleDetectChanges 拿真实 changedSymbols
 *
 * 背景：cohort C 9-run smoke 中 claude CLI subprocess 401 auth fail，
 * 9/9 detectChangesCallCount=0，driver 未拿到 grounding payload。
 * 本脚本作为 auth blocker workaround：编排器在 GUI session 内（auth 正常）
 * 直接调用 detect_changes 函数，对 3 fixture 的第一个 C run worktree 取真实
 * changedSymbols 输出，供 Phase D-2 注入 Agent subagent prompt 模拟 driver。
 *
 * 不是真实 cohort C protocol（绕过 MCP server JSON-RPC + driver LLM 自主调用）。
 * 仅用于补充 mechanism+behavior 信号；不修改 §10.5.1.5 T053 充要标准判定。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = process.cwd();
const RUNS_DIR = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-lite/runs/C');

// 3 fixture，每个取 run-{taskId}-C-1.json 的 worktreePath
const TASKS = ['SWE-L001', 'SWE-L003', 'SWE-L005'];

async function main() {
  // 动态 import handleDetectChanges
  const mcpModule = await import(path.join(PROJECT_ROOT, 'dist/mcp/agent-context-tools.js'));
  const { handleDetectChanges } = mcpModule;
  if (typeof handleDetectChanges !== 'function') {
    throw new Error('handleDetectChanges 未从 dist/mcp/agent-context-tools.js 导出');
  }

  const results = [];
  for (const taskId of TASKS) {
    const taskDir = path.join(RUNS_DIR, taskId);
    if (!fs.existsSync(taskDir)) {
      console.error(`[skip] ${taskId}: ${taskDir} 不存在`);
      continue;
    }
    // 取该 fixture 的第一个 run-*-C-1.json（取 worktreePath）
    const runFiles = fs.readdirSync(taskDir)
      .filter((f) => f.endsWith('-C-1.json'))
      .sort();
    if (runFiles.length === 0) {
      console.error(`[skip] ${taskId}: 无 C-1 run 文件`);
      continue;
    }
    const runFile = path.join(taskDir, runFiles[0]);
    const run = JSON.parse(fs.readFileSync(runFile, 'utf-8'));
    const wtDir = run.worktreePath;
    if (!wtDir || !fs.existsSync(wtDir)) {
      console.error(`[skip] ${taskId}: worktreePath ${wtDir} 不存在`);
      continue;
    }
    const graphPath = path.join(wtDir, 'specs/_meta/graph.json');
    if (!fs.existsSync(graphPath)) {
      console.error(`[skip] ${taskId}: graph.json 缺失 (${graphPath})`);
      continue;
    }

    // 取 git diff HEAD~1
    let diffText = '';
    try {
      diffText = execFileSync('git', ['-C', wtDir, 'diff', 'HEAD~1'], {
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch (e) {
      console.error(`[err] ${taskId} git diff failed: ${e.message}`);
      continue;
    }

    console.log(`\n=== ${taskId} @ ${wtDir} ===`);
    console.log(`diff size: ${diffText.length} bytes`);

    // 调用 detect_changes（projectRoot = worktree，diff 文本传入）
    let toolResult;
    try {
      toolResult = await handleDetectChanges({
        diff: diffText,
        projectRoot: wtDir,
      });
    } catch (e) {
      console.error(`[err] ${taskId} handleDetectChanges threw: ${e.message}`);
      continue;
    }

    // 解析 ToolResult.content[0].text
    const text = toolResult?.content?.[0]?.text ?? '';
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error(`[err] ${taskId} response not JSON: ${text.slice(0, 200)}`);
      continue;
    }

    const isError = toolResult.isError === true;
    const errorCode = parsed?.code ?? null;
    const changedSymbols = parsed?.changedSymbols ?? [];
    const affectedSymbols = parsed?.affectedSymbols ?? [];
    const riskSummary = parsed?.riskSummary ?? {};

    console.log(`  isError: ${isError}, errorCode: ${errorCode}`);
    console.log(`  changedSymbols count: ${changedSymbols.length}`);
    console.log(`  affectedSymbols count: ${affectedSymbols.length}`);
    console.log(`  riskTier: ${riskSummary.riskTier}, totalChanged: ${riskSummary.totalChanged}, totalAffected: ${riskSummary.totalAffected}`);
    if (changedSymbols.length > 0) {
      console.log(`  first changedSymbol: ${JSON.stringify(changedSymbols[0])}`);
    }

    results.push({
      taskId,
      target: run.taskId.includes('pytest') ? 'pytest' : run.taskId.includes('astropy') ? 'astropy' : 'sympy',
      worktreePath: wtDir,
      diffSize: diffText.length,
      isError,
      errorCode,
      changedSymbolsCount: changedSymbols.length,
      affectedSymbolsCount: affectedSymbols.length,
      riskTier: riskSummary.riskTier ?? null,
      changedSymbols, // 完整列表，供 D-2 注入 subagent
    });
  }

  const outFile = path.join(PROJECT_ROOT, 'tests/baseline/swe-bench-lite/runs/C/_f165-phase-d1-detect-changes.json');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n[done] 写入 ${outFile} (${results.length} fixture results)`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
