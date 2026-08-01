#!/usr/bin/env node
// F237 三 hash 预核验（固化版）—— 对应 plan.md §2.5、tasks.md T011
//
// 逻辑与 plan §2.5 给出的内联 `node -e` 脚本一致，文件化后供 T005 与后续任何复核调用
// （FR-003：三 hash + 环境核验记录）。
//
// 运行前提：process.cwd() 必须是评测 worktree 根目录（本文件可能被复制部署到
// `.calibration-output/bin/`，与被 import 的 scripts/**.mjs 不在同一相对位置），因此
// 所有依赖模块一律基于 process.cwd() 动态解析绝对路径后再 import（而非相对本文件路径 import）。

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 基于 process.cwd() 动态解析并 import 模块（不依赖本文件在磁盘上的实际位置）。
 * @param {string} relPath 相对评测 worktree 根目录的路径
 */
async function importFromCwd(relPath) {
  const abs = path.resolve(process.cwd(), relPath);
  return import(pathToFileURL(abs).href);
}

async function main() {
  const pc = await importFromCwd('scripts/lib/preregistration-check.mjs');
  const cb = await importFromCwd('scripts/swe-bench-verified-cohort-batch.mjs');
  const tr = await importFromCwd('scripts/eval-task-runner.mjs');

  const preregRel = 'specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md';
  const pre = pc.parsePreregistration(fs.readFileSync(preregRel, 'utf-8'));
  const manifest = cb.loadExperimentManifest('specs/212-eval-rerun-m8-closeout/ab-manifest.json');
  const gitState = cb.computePreregGitState({
    projectRoot: process.cwd(),
    preregRel,
    frozenGitCommit: pre.gitCommit,
  });
  const check = pc.checkPreregistration(pre.taskIds, preregRel, {
    oracleKind: 'swebench-execution',
    oracleSpecInput: cb.buildLiveOracleSpecInput(manifest),
    manifest,
    promptSha256: tr.computeDriverPromptSha256(),
    fixtureContentHash: pc.computeFixtureContentHash(pre.taskIds, 'tests/baseline/swe-bench-verified/fixtures'),
    gitState,
  });

  const result = { ok: check.ok, reason: check.reason ?? null, gitCommit: pre.gitCommit };
  const outLine = JSON.stringify(result, null, 2);
  console.log(outLine);

  // 留档（FR-003）：结果 JSON 写入 .calibration-output/f237-prehash-check.json，
  // 供 Phase E 报告 §9 与后续复核直接引用，不必重新跑一次才能看结论。
  const outDir = '.calibration-output';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'f237-prehash-check.json'), `${outLine}\n`, 'utf-8');

  if (check.ok === false) {
    // 三 hash 任一不等：逐项 diff 已含在 check.reason 中，禁止为了让检查通过而修改 hash
    // 值或跳过校验（plan §8 风险表第一行）；exit(2) 供调用方（T005/GATE-A）判定阻断。
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
