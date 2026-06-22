#!/usr/bin/env node
/**
 * Feature 188 — 离线重判驱动（offline re-judge）
 *
 * 用真实 FAIL_TO_PASS oracle（F187/F197 的 swebench-execution）对 M7-F176 已存的 133 份候选
 * patch 离线重判：**不重新生成**（零 driver 调用），仅复用 `runSwebenchInstance` 判分。
 * 零改 oracle 语义（swebench-oracle / classify-oracle / phase-markers 一行不动）。
 *
 * 设计依据见 specs/188-eval-rerun-m8-revalidation/{spec,plan,tasks}.md。
 * Codex 修复点：W1（前置拦截）/ C3（合成校验）/ W2（untracked 三分类 + ambiguous）/ C2（fixture 同源）。
 *
 * 用法：
 *   node scripts/eval-offline-rejudge.mjs \
 *     --patches-root ~/.spec-driver-bench-patches/m7-f176 \
 *     --fixtures-dir tests/baseline/swe-bench-verified/fixtures \
 *     --prereg specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md \
 *     --out run_artifacts/188-rejudge/result.json [--resume] [--dry-run] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runSwebenchInstance } from './lib/swebench-oracle.mjs';
import {
  computeFixtureContentHash,
  computeTaskSetHash,
  parsePreregistration,
  SEMANTIC_MODULES,
} from './lib/preregistration-check.mjs';

// ════════════════════════ 纯函数（单测覆盖） ════════════════════════

/**
 * untracked 文件路径四分类（CL-1 / FR-011 / Codex W2）：
 *   - tooling: 运行态/工具产物（.specify、runner 日志、spec-driver 自身 specs/0NN 产物、
 *     pytest changelog .rst、.venv*），**非候选代码**，一律排除，不入判分。
 *   - test: 候选自写测试（CL-1 排除）。
 *   - source: 候选非测试源码（CL-1 并入 candidatePatch）。
 *   - ambiguous: repo-specific 盲区（嵌套 tests/、testing/ 目录、非 .py test data、
 *     候选写进 tests/ 的修复）→ 人工复核桶，不擅自并入。
 */
export function classifyUntrackedPath(relPath) {
  const p = String(relPath).replace(/^\.\//, '');
  // 工具/运行态产物（最高优先级排除）。W2：specs/ 仅匹配 spec-driver 的 `NNN-<slug>/` 目录命名
  // （三位编号 + kebab slug，spec-driver workflow 在目标 repo 里生成的产物），不误伤目标 repo 自带的
  // `specs/foo.py` 等源码路径。
  if (
    /^\.specify\//.test(p) ||
    /(^|\/)task-runner-std(out|err)\.log$/.test(p) ||
    /^specs\/\d{3}-[a-z][a-z0-9-]*\//.test(p) ||
    /^\.venv/.test(p) ||
    /^\.git\//.test(p) ||
    /^changelog\/.+\.(rst|txt|md)$/.test(p)  // pytest changelog 约定，文档非源码
  ) return 'tooling';
  // 明确测试（顶层 tests/ 或标准 pytest 命名）
  if (
    /(^|\/)test_[^/]*\.py$/.test(p) ||
    /(^|\/)[^/]*_test\.py$/.test(p) ||
    /(^|\/)conftest\.py$/.test(p) ||
    /^tests\//.test(p)
  ) return 'test';
  // repo-specific 盲区 → ambiguous（非 .py、嵌套 tests/、testing/）
  if (/\/tests?\//.test(p) || /\/testing\//.test(p) || !/\.py$/.test(p)) return 'ambiguous';
  // 其余 .py = 候选非测试源码
  return 'source';
}

/**
 * 结构化校验 unified diff（C3：catch 合成 bug，使其成驱动错误而非被 oracle 剔分母）。
 * 空串合法（空 patch = 候选未产出修复 → 交 oracle 判 fail，非驱动错误）。
 */
export function isWellFormedDiff(text) {
  if (text == null || text === '') return true;
  const lines = String(text).split('\n');
  // W4：收紧 —— 必须有真实文件头（`diff --git`）或成对的 `---`/`+++` 头，单独一行 `@@` 不算合法。
  const hasGitHeader = lines.some((l) => /^diff --git /.test(l));
  const hasMinus = lines.some((l) => /^--- /.test(l));
  const hasPlus = lines.some((l) => /^\+\+\+ /.test(l));
  return hasGitHeader || (hasMinus && hasPlus);
}

/** 合成 new-file unified diff（git apply 兼容）。仅在 untracked 含 source 时使用。 */
export function synthNewFileDiff(relPath, content) {
  const body = String(content ?? '');
  const header = `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/${relPath}\n`;
  if (body === '') return header; // 空文件无 hunk
  const trimmed = body.endsWith('\n') ? body.slice(0, -1) : body;
  const lines = trimmed.split('\n');
  const hunk = `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => `+${l}`).join('\n') + '\n';
  const noNewline = body.endsWith('\n') ? '' : '\\ No newline at end of file\n';
  return header + hunk + noNewline;
}

/**
 * CL-1 candidatePatch 构造（FR-011）。
 * untrackedSource: 已分类为 source 的 [{ relPath, content }]（本数据集经验为空 → 返回 patchDiff）。
 */
export function buildCandidatePatch(patchDiff, untrackedSource = []) {
  const base = patchDiff || '';
  if (!untrackedSource.length) return base;
  const tail = untrackedSource.map(({ relPath, content }) => synthNewFileDiff(relPath, content));
  const head = base === '' ? '' : base.replace(/\n*$/, '\n');
  return (head + tail.join('')).replace(/\n*$/, '\n');
}

/**
 * 排名口径聚合（FR-002 / FR-012）：pass→分子+分母、fail→分母、error/缺失→剔分母。
 * error_rate > 30% 的 cohort 标 lowConfidence（FR-012，剔分母虚高防护）。
 */
export function aggregateByCohort(perAnswer) {
  const byCohort = new Map();
  for (const a of perAnswer) {
    if (!byCohort.has(a.cohort)) byCohort.set(a.cohort, []);
    byCohort.get(a.cohort).push(a);
  }
  const out = [];
  for (const [cohort, rows] of [...byCohort.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const n_total = rows.length;
    const n_pass = rows.filter((r) => r.classification === 'pass').length;
    const n_fail = rows.filter((r) => r.classification === 'fail').length;
    const n_error = n_total - n_pass - n_fail; // error/缺失/未知
    const n_valid = n_pass + n_fail;
    const error_rate = n_total ? n_error / n_total : 0;
    const untrackedNonTestPct = avg(rows.map((r) => (r.untrackedSourceCount > 0 ? 1 : 0)));
    const ambiguousCount = rows.reduce((s, r) => s + (r.untrackedAmbiguousCount || 0), 0);
    const lowConfidence = error_rate > 0.30;
    out.push({
      cohort,
      n_total,
      n_valid,
      n_pass,
      n_fail,
      n_error,
      error_rate: round4(error_rate),
      passRate: n_valid ? round4(n_pass / n_valid) : null,
      lowConfidence,
      // W1：消费方排名只应取 rankEligible=true 的 cohort，避免高 error 剔分母后 1/1 虚高被当满分。
      rankEligible: !lowConfidence && n_valid > 0,
      untrackedNonTestPct: round4(untrackedNonTestPct),
      ambiguousCount,
    });
  }
  return out;
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ════════════════════════ I/O 辅助 ════════════════════════

/** 列 untracked.tgz 内文件路径（不解包内容）。 */
function listUntracked(tgzPath) {
  if (!fs.existsSync(tgzPath)) return [];
  try {
    return execFileSync('tar', ['tzf', tgzPath], { encoding: 'utf-8' })
      .split('\n')
      .map((l) => l.replace(/^\.\//, '').trim())
      .filter((l) => l && !l.endsWith('/'));
  } catch {
    return [];
  }
}

/**
 * 遍历 patches-root 收集答卷。C4：每个 task/cohort/r 叶子目录都收，**缺 patch.diff 的不静默丢弃**，
 * 而是标 `missingPatch:true`（计入分母 + 报告披露），防选择性缩小分母。
 */
export function discoverAnswerSheets(patchesRoot) {
  const sheets = [];
  for (const task of safeReaddir(patchesRoot)) {
    const taskDir = path.join(patchesRoot, task);
    if (!isDir(taskDir)) continue;
    for (const cohort of safeReaddir(taskDir)) {
      const cohortDir = path.join(taskDir, cohort);
      if (!isDir(cohortDir)) continue;
      for (const r of safeReaddir(cohortDir)) {
        const rDir = path.join(cohortDir, r);
        if (!isDir(rDir)) continue;
        const patchPath = path.join(rDir, 'patch.diff');
        sheets.push({
          task, cohort, repeat: r, patchPath,
          tgzPath: path.join(rDir, 'untracked.tgz'),
          missingPatch: !fs.existsSync(patchPath),
        });
      }
    }
  }
  return sheets.sort((a, b) =>
    `${a.task}/${a.cohort}/${a.repeat}`.localeCompare(`${b.task}/${b.cohort}/${b.repeat}`));
}

const safeReaddir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ════════════════════════ FR-014 前置拦截（W1） ════════════════════════

/**
 * 硬启动前置：与 batch runner 同等抗污染保护。任一不过 → throw（main 捕获 exit 2）。
 *   1. fixtureContentHash 同源（C2，证 fixtures 与 F176 字节一致）。
 *   2. taskSetHash 一致（task 集未被篡改）。
 *   3. 5 个 oracle 语义模块自 prereg.gitCommit 未变（FR-013，judging 语义零漂移）。
 */
export function runPreflight({ taskIds, fixturesDir, preregPath, repoRoot }) {
  const block = parsePreregistration(fs.readFileSync(preregPath, 'utf-8'));
  const diagnostics = [];

  const fchash = computeFixtureContentHash(taskIds, fixturesDir);
  if (block.fixtureContentHash && fchash !== block.fixtureContentHash) {
    throw new Error(`[preflight] fixtureContentHash 不符（C2）：实测 ${fchash.slice(0, 12)}… vs 冻结 ${String(block.fixtureContentHash).slice(0, 12)}…`);
  }
  diagnostics.push(`fixtureContentHash 同源确认 ${fchash.slice(0, 12)}…`);

  // C1：parsePreregistration 返回的 taskSetHash 字段名是 `hash`（非 taskSetHash），早前比对被静默跳过。
  const tshash = computeTaskSetHash(taskIds);
  if (!block.hash) throw new Error('[preflight] prereg 缺 taskSetHash（hash），拒绝裸跑');
  if (tshash !== block.hash) {
    throw new Error(`[preflight] taskSetHash 不符：实测 ${tshash.slice(0, 12)}… vs 冻结 ${String(block.hash).slice(0, 12)}…`);
  }
  diagnostics.push(`taskSetHash 一致 ${tshash.slice(0, 12)}…`);

  const frozenCommit = block.gitCommit;
  if (!frozenCommit) throw new Error('[preflight] prereg 缺 gitCommit，无法核验 oracle 漂移（FR-013），拒绝裸跑');
  const drifted = [];
  for (const mod of SEMANTIC_MODULES) {
    const rel = mod.endsWith('.py') ? `scripts/${mod}` : `scripts/lib/${mod}`;
    try {
      // C5：省略 HEAD —— `git diff <commit> -- <path>` 比对的是**工作区**与冻结提交，
      // 同时捕获"提交历史漂移"与"未提交工作区改动"，杜绝跑前偷改判分模块未提交即生效。
      execFileSync('git', ['diff', '--quiet', frozenCommit, '--', rel], { cwd: repoRoot });
    } catch {
      drifted.push(rel);
    }
  }
  if (drifted.length) {
    throw new Error(`[preflight] oracle 语义模块自 F176 冻结(${frozenCommit.slice(0, 8)})后漂移（FR-013，含未提交改动）：${drifted.join(', ')} — 禁跑中换判分`);
  }
  diagnostics.push(`oracle 5 语义模块自 ${frozenCommit.slice(0, 8)} 零漂移（含工作区）`);
  return { block, diagnostics };
}

// ════════════════════════ 主流程 ════════════════════════

function parseArgs(argv) {
  // timeoutMs 默认 20min：离线重判镜像未预缓存，首个 sympy / pytest run 需冷建 env 镜像（~8-9min），
  // 远超 oracle 默认 300s watchdog（实测 smoke 因此超时误判 infra）。cache_level=env 下 env 镜像建一次即缓存，
  // 后续 instance run 快（~1-3min），故 20min 上限既容冷建又防真挂死。可 --timeout-ms 覆盖。
  const a = { patchesRoot: null, fixturesDir: null, preregPath: null, out: null, resume: false, dryRun: false, limit: null, timeoutMs: 1_200_000 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--patches-root': a.patchesRoot = argv[++i]; break;
      case '--fixtures-dir': a.fixturesDir = argv[++i]; break;
      case '--prereg': a.preregPath = argv[++i]; break;
      case '--out': a.out = argv[++i]; break;
      case '--resume': a.resume = true; break;
      case '--dry-run': a.dryRun = true; break;
      case '--limit': a.limit = Number(argv[++i]); break;
      case '--timeout-ms': a.timeoutMs = Number(argv[++i]); break;
      default: break;
    }
  }
  return a;
}

function expandHome(p) {
  return p && p.startsWith('~') ? path.join(process.env.HOME || '', p.slice(1)) : p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const patchesRoot = expandHome(args.patchesRoot);
  const fixturesDir = args.fixturesDir;
  if (!patchesRoot || !fixturesDir || !args.out) {
    console.error('用法: --patches-root <dir> --fixtures-dir <dir> --out <json> [--prereg <md>] [--resume] [--dry-run] [--limit N]');
    process.exit(64);
  }

  // C2：FR-014 前置拦截**强制**。正式跑（非 dry-run）必须传 --prereg，否则 fail-closed 拒绝裸跑。
  const sheets0 = discoverAnswerSheets(patchesRoot);
  const taskIds = [...new Set(sheets0.map((s) => s.task))].sort();
  let frozenFixtureHash = null;
  if (args.preregPath) {
    const { block, diagnostics } = runPreflight({ taskIds, fixturesDir, preregPath: args.preregPath, repoRoot });
    diagnostics.forEach((d) => console.error(`[preflight] ✓ ${d}`));
    frozenFixtureHash = block.fixtureContentHash;
  } else if (args.dryRun) {
    console.error('[preflight] ⚠️ dry-run 跳过抗污染前置');
  } else {
    console.error('[preflight] ✗ 正式跑必须传 --prereg（W1/C2 抗污染前置不可绕过）');
    process.exit(2);
  }

  // C4：缺 patch.diff 的答卷不丢弃，标 missingPatch 计入分母。可选 --expect-count 断言总数（默认不强制）。
  const sheets = args.limit ? sheets0.slice(0, args.limit) : sheets0;
  const missingCount = sheets0.filter((s) => s.missingPatch).length;
  console.error(`[rejudge] 发现 ${sheets0.length} 份答卷（缺 patch.diff ${missingCount} 份），本次处理 ${sheets.length}（task 数 ${taskIds.length}）`);

  // W3：resume 版本锚定 —— 已有结果的 fixtureContentHash 必须与当前一致，否则拒绝复用过期/污染判分。
  let done = new Map();
  if (args.resume && fs.existsSync(args.out)) {
    const prev = JSON.parse(fs.readFileSync(args.out, 'utf-8'));
    const prevHash = prev.meta?.fixtureContentHash;
    const curHash = (() => { try { return computeFixtureContentHash(taskIds, fixturesDir); } catch { return null; } })();
    if (prevHash && curHash && prevHash !== curHash) {
      console.error(`[rejudge] ✗ resume fixtureContentHash 不符（${String(prevHash).slice(0,12)}… vs ${curHash.slice(0,12)}…），拒绝复用过期判分`);
      process.exit(2);
    }
    for (const a of prev.perAnswer || []) done.set(`${a.task}/${a.cohort}/${a.repeat}`, a);
    console.error(`[rejudge] resume：已有 ${done.size} 份判分（hash 锚定一致），跳过`);
  }

  const fixtureCache = new Map();
  const loadFixture = (task) => {
    if (!fixtureCache.has(task)) {
      const fp = path.join(fixturesDir, `${task}.json`);
      fixtureCache.set(task, JSON.parse(fs.readFileSync(fp, 'utf-8')));
    }
    return fixtureCache.get(task);
  };

  const artifactsDir = path.join(repoRoot, 'run_artifacts', '188-rejudge');
  const perAnswer = [];
  let processed = 0;
  for (const s of sheets) {
    const key = `${s.task}/${s.cohort}/${s.repeat}`;
    if (done.has(key)) { perAnswer.push(done.get(key)); continue; }

    const base = { task: s.task, cohort: s.cohort, repeat: s.repeat,
      untrackedSourceCount: 0, untrackedAmbiguousCount: 0 };

    // C4：缺 patch.diff → 显式 error 计入分母（不静默丢弃缩小分母）。
    if (s.missingPatch) {
      perAnswer.push({ ...base, classification: 'error', failureSource: 'missing-patch',
        reason: 'C4：答卷缺 patch.diff，计入分母不丢弃', applyOk: false });
      continue;
    }

    const patchDiff = fs.readFileSync(s.patchPath, 'utf-8');
    // untracked 分类（本数据集经验全 tooling；保留 source 并入分支忠实 CL-1）
    const untracked = listUntracked(s.tgzPath).map((rel) => ({ rel, cls: classifyUntrackedPath(rel) }));
    const sourceFiles = untracked.filter((u) => u.cls === 'source');
    const ambiguousCount = untracked.filter((u) => u.cls === 'ambiguous').length;
    base.untrackedSourceCount = sourceFiles.length;
    base.untrackedAmbiguousCount = ambiguousCount;

    // C3：本数据集经验 sourceFiles 恒为空。若出现 untracked source，**不**伪造空内容喂 oracle
    //（会系统性偏置该 cohort），而是 fail-stop 该答卷待人工抽取真实内容并入。
    if (sourceFiles.length > 0) {
      perAnswer.push({ ...base, classification: 'error', failureSource: 'untracked-source-manual',
        reason: `C3：检出 ${sourceFiles.length} 个 untracked 非测试源码（${sourceFiles.map((u) => u.rel).join(',')}），需人工抽取内容并入 candidatePatch，禁伪造空内容`, applyOk: false });
      console.error(`[rejudge] ⚠️ ${key} 含 untracked source → 人工处理（不伪造）`);
      continue;
    }

    const candidatePatch = buildCandidatePatch(patchDiff, []); // 经验路径 = patch.diff 原文

    // C3：合成结构校验（patch.diff 应为合法 diff；空 patch 合法 → 候选 fail）
    if (!isWellFormedDiff(candidatePatch)) {
      perAnswer.push({ ...base, classification: 'error', failureSource: 'driver-synthesis',
        reason: 'C3：candidatePatch 结构非法，不喂 oracle', applyOk: false });
      console.error(`[rejudge] ⚠️ ${key} patch 结构非法 — 需查`);
      continue;
    }

    if (args.dryRun) {
      perAnswer.push({ ...base, classification: 'dry-run', reason: `patch ${patchDiff.length}B`, applyOk: true });
      continue;
    }

    const runId = `188rj-${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    let res;
    try {
      res = runSwebenchInstance({ fixture: loadFixture(s.task), candidatePatch, artifactsDir, runId, timeoutMs: args.timeoutMs });
    } catch (e) {
      res = { classification: 'error', failureSource: 'driver', reason: `驱动捕获异常: ${String(e.message)}` };
    }
    perAnswer.push({ ...base, classification: res.classification, failureSource: res.failureSource, reason: res.reason, applyOk: true });
    processed++;
    if (processed % 10 === 0) {
      console.error(`[rejudge] 进度 ${processed}/${sheets.length - done.size}`);
      writeOut(args.out, perAnswer, taskIds, fixturesDir); // 增量落盘（断点保护）
    }
  }

  writeOut(args.out, perAnswer, taskIds, fixturesDir);
  const perCohort = aggregateByCohort(perAnswer);
  console.error('\n[rejudge] ===== per-cohort 真 oracle 通过率 =====');
  for (const c of perCohort) {
    console.error(`  ${c.cohort.padEnd(28)} pass ${c.n_pass}/${c.n_valid} = ${c.passRate == null ? 'n/a' : (c.passRate * 100).toFixed(1) + '%'}` +
      ` | error ${c.n_error}/${c.n_total} (${(c.error_rate * 100).toFixed(0)}%)${c.lowConfidence ? ' ⚠️低置信' : ''}`);
  }
  console.error(`[rejudge] 完成，结果落盘 ${args.out}`);
}

function writeOut(outPath, perAnswer, taskIds, fixturesDir) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const perCohort = aggregateByCohort(perAnswer);
  const payload = {
    meta: {
      feature: 188,
      kind: 'offline-rejudge',
      taskIds,
      fixtureContentHash: (() => { try { return computeFixtureContentHash(taskIds, fixturesDir); } catch { return null; } })(),
      n_answers: perAnswer.length,
    },
    perCohort,
    perAnswer,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

// 仅 CLI 直跑时执行 main（被单测 import 时不跑）
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message || e); process.exit(2); });
}
