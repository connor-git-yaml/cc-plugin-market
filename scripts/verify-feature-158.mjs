#!/usr/bin/env node
/**
 * Feature 158 T-050 — SWE-Bench Grounding Eval 独立验收脚本
 *
 * 6 个 CI 可验证检查点（FR-F-002 / SC-001 / SC-002 / SC-007 / SC-008 / SC-009a）：
 *   ① fixture 数量 ≥ 5（tests/baseline/swe-bench-lite/fixtures/SWE-L*.json）
 *   ② fixture JSON schema 合规（7 必须顶层字段 + swebenchMeta 子字段含 createdAt / dataset）
 *   ③ eval-mcp-augmented.mjs --dry-run 成功（spawn child 退出码 0）
 *   ④ dry-run stdout 含 `SPECTRA_MCP_TELEMETRY_PATH=` 字样
 *   ⑤ 147 §10 含 4 个子章节标题（10.1 实验设计 / 10.2 Pass Rate 矩阵 / 10.3 Token Cost / 10.4 结论）
 *     [注：原 spec/plan 用 §6 章节号，但 147 §6 已被 Fixture 完整清单占用，本 Feature 改用 §10 不破坏现有结构]
 *   ⑥ 147 §10 末尾跨链接到 157 detail 报告
 *
 * 输出：
 *   stdout — 每个 step 一行 JSON（pattern from verify-feature-156.mjs）
 *   `specs/158-swe-bench-lite-grounding-eval/impl-supplement/verification/verification-report.md`
 *
 * 退出码：
 *   0  — 全部 6 个检查点 PASS
 *   1  — 任一检查点 FAIL
 *
 * 范围声明：
 *   - 不在 verify 范围的 SC：SC-004（≥45 runs，post-eval 人工确认）/
 *     SC-005（§6 实质内容质量，T-063 spec-review）/ SC-006（Token Cost 数值合理性，
 *     T-062 数据填入后人工） / SC-009b（telemetry JSONL 端到端写入，T-060 pilot 后）
 *
 * 用法：
 *   node scripts/verify-feature-158.mjs
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// ───────────────────────────────────────────────────────────
// 路径常量
// ───────────────────────────────────────────────────────────

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'baseline', 'swe-bench-lite', 'fixtures');
const EVAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'eval-mcp-augmented.mjs');
const REPORT_147 = path.join(
  REPO_ROOT,
  'specs',
  '147-competitor-evaluation-platform',
  'competitive-evaluation-report.md',
);
const REPORT_OUT = path.join(
  REPO_ROOT,
  'specs',
  '158-swe-bench-lite-grounding-eval/impl-supplement',
  'verification',
  'verification-report.md',
);
const REPORT_157_LINK = '../158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md';

// ───────────────────────────────────────────────────────────
// step / report
// ───────────────────────────────────────────────────────────

const report = {
  feature: '158-swe-bench-lite-grounding-eval/impl-supplement',
  generatedAt: new Date().toISOString(),
  steps: [],
  pass: false,
  outOfScope: ['SC-004', 'SC-005', 'SC-006', 'SC-009b'],
};

function step(name, ok, detail) {
  report.steps.push({ name, ok, ...detail });
  process.stdout.write(`${JSON.stringify({ step: name, ok, ...detail })}\n`);
}

// ───────────────────────────────────────────────────────────
// 检查点 ①：fixture 数量
// ───────────────────────────────────────────────────────────

function checkFixtureCount() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    step('check-1-fixture-count', false, {
      reason: 'fixtures-dir-not-exist',
      dir: FIXTURES_DIR,
    });
    return { ok: false, fixtureFiles: [] };
  }
  const files = fs.readdirSync(FIXTURES_DIR).filter((n) => /^SWE-L\d+.*\.json$/.test(n));
  const ok = files.length >= 5;
  step('check-1-fixture-count', ok, { count: files.length, threshold: 5 });
  return { ok, fixtureFiles: files };
}

// ───────────────────────────────────────────────────────────
// 检查点 ②：fixture schema 合规
// ───────────────────────────────────────────────────────────

const REQUIRED_TOP_FIELDS = [
  'taskId',
  'description',
  'target',
  'startCommit',
  'prompt',
  'primaryOracle',
  'swebenchMeta',
];
const REQUIRED_META_FIELDS = ['createdAt', 'dataset'];

function checkFixtureSchema(files) {
  const issues = [];
  for (const f of files) {
    const fp = path.join(FIXTURES_DIR, f);
    let raw;
    try {
      raw = fs.readFileSync(fp, 'utf-8');
    } catch (e) {
      issues.push({ file: f, kind: 'read-failed', message: e.message });
      continue;
    }
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      issues.push({ file: f, kind: 'parse-failed', message: e.message });
      continue;
    }
    for (const field of REQUIRED_TOP_FIELDS) {
      if (!(field in json)) {
        issues.push({ file: f, kind: 'missing-top-field', field });
      }
    }
    if (json.swebenchMeta !== undefined && json.swebenchMeta !== null) {
      for (const field of REQUIRED_META_FIELDS) {
        if (!(field in json.swebenchMeta)) {
          issues.push({ file: f, kind: 'missing-meta-field', field });
        }
      }
    }
  }
  const ok = issues.length === 0 && files.length > 0;
  step('check-2-fixture-schema', ok, {
    filesChecked: files.length,
    issueCount: issues.length,
    sampleIssues: issues.slice(0, 5),
  });
  return ok;
}

// ───────────────────────────────────────────────────────────
// 检查点 ③ + ④：eval-mcp-augmented.mjs --dry-run + telemetry env
// ───────────────────────────────────────────────────────────

function checkDryRunAndTelemetryEnv(firstTaskId) {
  if (!fs.existsSync(EVAL_SCRIPT)) {
    step('check-3-dry-run', false, { reason: 'eval-script-not-exist', path: EVAL_SCRIPT });
    step('check-4-telemetry-env', false, { reason: 'eval-script-not-exist' });
    return false;
  }
  if (firstTaskId === undefined) {
    step('check-3-dry-run', false, { reason: 'no-fixture-task-id' });
    step('check-4-telemetry-env', false, { reason: 'no-fixture-task-id' });
    return false;
  }
  const proc = spawnSync(
    process.execPath,
    [EVAL_SCRIPT, '--group', 'A', '--task', firstTaskId, '--dry-run'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 30000,
      shell: false,
    },
  );
  const stdout = proc.stdout ?? '';
  const stderr = proc.stderr ?? '';
  const ok3 = proc.status === 0;
  step('check-3-dry-run', ok3, {
    exitCode: proc.status,
    stderr: stderr.slice(0, 200),
  });
  // 即使 ok3=false 也尝试解析 stdout 看 env 是否注入（dry-run 应在 stdout 输出 env 名）
  // SC-009a 要求 dry-run stdout 含 `SPECTRA_MCP_TELEMETRY_PATH=` 字样
  // 注：Group A 默认无 telemetry env；但本检查针对 Group C dry-run。改用 group=C
  const procC = spawnSync(
    process.execPath,
    [EVAL_SCRIPT, '--group', 'C', '--task', firstTaskId, '--dry-run'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 30000,
      shell: false,
    },
  );
  const stdoutC = procC.stdout ?? '';
  const ok4 = stdoutC.includes('SPECTRA_MCP_TELEMETRY_PATH=');
  step('check-4-telemetry-env', ok4, {
    groupCExitCode: procC.status,
    foundEnvMarker: ok4,
    stdoutSample: stdoutC.slice(0, 300),
  });
  return ok3 && ok4;
}

// ───────────────────────────────────────────────────────────
// 检查点 ⑤：147 §10 4 个子章节标题（§6 已被 fixture 清单占用）
// ───────────────────────────────────────────────────────────

const SUBSECTION_PATTERNS = [
  /###\s+10\.1\s+实验设计/,
  /###\s+10\.2\s+Pass\s+Rate\s+矩阵/,
  /###\s+10\.3\s+Token\s+Cost/,
  /###\s+10\.4\s+结论/,
];

function check147Subsections() {
  if (!fs.existsSync(REPORT_147)) {
    step('check-5-147-subsections', false, { reason: 'report-not-exist', path: REPORT_147 });
    return false;
  }
  let content;
  try {
    content = fs.readFileSync(REPORT_147, 'utf-8');
  } catch (e) {
    step('check-5-147-subsections', false, { reason: 'read-failed', message: e.message });
    return false;
  }
  const found = SUBSECTION_PATTERNS.map((re) => ({ pattern: re.source, matched: re.test(content) }));
  const ok = found.every((f) => f.matched);
  step('check-5-147-subsections', ok, { results: found });
  return ok;
}

// ───────────────────────────────────────────────────────────
// 检查点 ⑥：147 §10 跨链接到 157 detail 报告
// ───────────────────────────────────────────────────────────

function check147CrossLink() {
  if (!fs.existsSync(REPORT_147)) {
    step('check-6-147-cross-link', false, { reason: 'report-not-exist' });
    return false;
  }
  const content = fs.readFileSync(REPORT_147, 'utf-8');
  const ok = content.includes(REPORT_157_LINK);
  step('check-6-147-cross-link', ok, { expectedLink: REPORT_157_LINK });
  return ok;
}

// ───────────────────────────────────────────────────────────
// 报告渲染
// ───────────────────────────────────────────────────────────

async function writeReport() {
  await fsp.mkdir(path.dirname(REPORT_OUT), { recursive: true });
  const lines = [];
  lines.push('# Feature 158 Verification Report');
  lines.push('');
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Status**: ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| # | Step | Status | Detail |');
  lines.push('| --- | --- | --- | --- |');
  for (let i = 0; i < report.steps.length; i += 1) {
    const s = report.steps[i];
    const detail = { ...s };
    delete detail.name;
    delete detail.ok;
    const detailStr = JSON.stringify(detail).slice(0, 200).replace(/\|/g, '\\|');
    lines.push(`| ${i + 1} | ${s.name} | ${s.ok ? '✅' : '❌'} | \`${detailStr}\` |`);
  }
  lines.push('');
  lines.push('## Out of Verify Scope');
  lines.push('');
  lines.push('以下 SC 不在本脚本验收范围（需要 post-eval 人工 / 实测确认）：');
  lines.push('');
  lines.push('- **SC-004** — ≥45 runs（post-eval 人工确认 runs/ 目录文件数，T-061 之后）');
  lines.push('- **SC-005** — 147 §10 实质内容质量（T-063 spec-review 阶段确认）');
  lines.push('- **SC-006** — Token Cost 数值合理性（T-062 数据填入后人工核对）');
  lines.push('- **SC-009b** — telemetry JSONL 端到端写入（T-060 pilot 完成后实测确认）');
  lines.push('');
  await fsp.writeFile(REPORT_OUT, lines.join('\n'), 'utf-8');
}

// ───────────────────────────────────────────────────────────
// 主流程
// ───────────────────────────────────────────────────────────

async function main() {
  // ① fixture 数量
  const r1 = checkFixtureCount();
  // ② fixture schema
  const r2 = r1.fixtureFiles.length > 0 ? checkFixtureSchema(r1.fixtureFiles) : false;
  // ③ + ④ dry-run + telemetry env
  // 取第一个 fixture 的 taskId（从文件名推断也行：SWE-L001-... → taskId 在 JSON 里）
  let firstTaskId;
  if (r1.fixtureFiles.length > 0) {
    try {
      const raw = fs.readFileSync(path.join(FIXTURES_DIR, r1.fixtureFiles[0]), 'utf-8');
      const j = JSON.parse(raw);
      firstTaskId = j.taskId;
    } catch {
      // ignore
    }
  }
  const r34 = checkDryRunAndTelemetryEnv(firstTaskId);
  // ⑤ 147 §10 子章节
  const r5 = check147Subsections();
  // ⑥ 跨链接
  const r6 = check147CrossLink();

  report.pass = r1.ok && r2 && r34 && r5 && r6;

  await writeReport();

  process.stdout.write(
    JSON.stringify({ summary: 'verify-feature-158', pass: report.pass, reportPath: REPORT_OUT }) +
      '\n',
  );
  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`verify-feature-158 fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
