#!/usr/bin/env node
// F237 — v008 复测 c3 pool 链 oracle_error（docker 死窗）离线重判器。
// F212（188 同先例）适配版：零重新生成，仅复用 runSwebenchInstance 判分；
// oracle 语义模块零改动；patch 取自 run_artifacts/<runId>/patch.diff（已实证本轮命名同 F212）。
// 超时用 1.2M ms（与本轮 pool 链口径一致，同 F212/188 P1 lineage deviation：容 image 冷拉，判分语义不变）。
// 用法：node f237-rejudge-oracle-errors.mjs [--dry-run]   （部署在 <eval-wt>/.calibration-output/bin/ 下跑）
import fs from 'node:fs';
import path from 'node:path';
import { runSwebenchInstance } from '../../scripts/lib/swebench-oracle.mjs';

// 脚本运行态部署在 <eval-wt>/.calibration-output/bin/ 下，两级 '..' 正好落回 eval worktree 根
// （与 F212 原版同一部署形状，沿用同一解析法，未做变更）。
const W = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
const dryRun = process.argv.includes('--dry-run');
const OUT = path.join(W, '.calibration-output', 'f237-rejudge-result.json');
// F237 只扫 c3（spec-driver-spectra-mcp）单 cohort，非 F212 A/B 双 cohort
const TOOLS = { c3: 'spec-driver-spectra-mcp' };
// pool 清单含 VB003：F237 pool 链取 pool-11.json 全部 11 个 taskIds（不按 SWE-V[0-9]{3} 前缀过滤）
const pool = JSON.parse(fs.readFileSync(path.join(W, 'specs/212-eval-rerun-m8-closeout/pool-11.json'), 'utf-8'))
  .taskIds;

// 枚举 E 态 run：fixture primaryOracle.classification === 'error'
const targets = [];
for (const [cohort, tool] of Object.entries(TOOLS)) {
  for (const t of pool) {
    for (const r of [1, 2, 3]) {
      // F237 pool 链 fixture 后缀为 `${tool}-c3-r${r}`（非 F212 A/B 链的 `${tool}-f176r${r}`）
      const fp = path.join(W, 'tests/baseline/tasks', t, `${tool}-c3-r${r}`, 'full.json');
      if (!fs.existsSync(fp)) continue;
      let cls;
      try { cls = JSON.parse(fs.readFileSync(fp, 'utf-8'))?.taskExecution?.primaryOracle?.classification; } catch { continue; }
      if (cls !== 'pass' && cls !== 'fail') {
        const patchP = path.join(W, 'run_artifacts', `${t}__${tool}__r${r}`, 'patch.diff');
        targets.push({ task: t, cohort, tool, r, patchP, hasPatch: fs.existsSync(patchP) });
      }
    }
  }
}
console.error(`[rejudge] E 态 run 共 ${targets.length}（缺 patch: ${targets.filter(x => !x.hasPatch).length}）`);
if (dryRun) { targets.forEach(x => console.error(` ${x.cohort} ${x.task} r${x.r} patch=${x.hasPatch}`)); process.exit(0); }

let prior = [];
if (fs.existsSync(OUT)) prior = JSON.parse(fs.readFileSync(OUT, 'utf-8')).results ?? [];
const doneKey = new Set(prior.map(p => `${p.task}|${p.cohort}|${p.r}`));
const results = [...prior];
const flush = () => fs.writeFileSync(OUT, JSON.stringify({
  meta: {
    generatedAt: new Date().toISOString(),
    timeoutMs: 1200000,
    // F237 离线重判 docker 镜像层瞬时故障 oracle_error（本轮命中 V007 r2 + VB003 r3）；
    // 188/F212 同先例；oracle 语义模块零改动
    note: 'F237 离线重判 docker 镜像层瞬时故障 oracle_error（本轮命中 V007 r2 + VB003 r3）；188/F212 同先例；oracle 语义模块零改动',
  },
  results,
}, null, 2));

for (const x of targets) {
  if (doneKey.has(`${x.task}|${x.cohort}|${x.r}`)) continue;
  if (!x.hasPatch) { results.push({ ...x, classification: 'error', failureSource: 'missing-patch', reason: 'run_artifacts patch 缺失，无法重判' }); flush(); continue; }
  const fixture = JSON.parse(fs.readFileSync(path.join(W, 'tests/baseline/swe-bench-verified/fixtures', `${x.task}.json`), 'utf-8'));
  const candidatePatch = fs.readFileSync(x.patchP, 'utf-8');
  const artifactsDir = path.join(W, 'run_artifacts', `f237-rejudge`, `${x.task}__${x.tool}__r${x.r}`);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const runId = `${x.task}__${x.tool}__f237rj${x.r}`; // 全新 runId，防与既有 runId 撞名，零复用零覆盖
  let res;
  try {
    res = runSwebenchInstance({ fixture, candidatePatch, artifactsDir, runId, timeoutMs: 1200000 });
  } catch (e) {
    res = { classification: 'error', failureSource: 'driver', reason: String(e.message).slice(0, 200) };
  }
  results.push({ task: x.task, cohort: x.cohort, r: x.r, classification: res.classification, failureSource: res.failureSource ?? null, reason: (res.reason ?? '').slice(0, 200) });
  console.error(`[rejudge] ${results.length}/${targets.length} ${x.cohort} ${x.task} r${x.r} → ${res.classification}`);
  flush();
}
flush();
console.error('[rejudge] 完成');
