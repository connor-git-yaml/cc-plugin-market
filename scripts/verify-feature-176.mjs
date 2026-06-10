#!/usr/bin/env node
/**
 * Feature 176 — 独立验收脚本（tasks T-F3；SC-001..008 逐条断言）。
 *
 * 设计（交接合同 C-3）：真实验收依赖 host 产物（spike-result / smoke-result /
 * aggregate/cohort-aggregate.json / Verified run fixtures）。这些文件只由真实 host
 * 运行产生（spike --dry-run 与 batch --dry-run 都不写）；本脚本校验其存在 + schema
 * + 来源标记。`--test-mode` 仅用于自测脚本逻辑（允许 F176_VERIFY_ROOT 指向合成
 * artifact 目录），**test-mode 结果不算真实验收**。
 *
 * 退出码：0=全 PASS；1=任一 FAIL。
 * 用法：node scripts/verify-feature-176.mjs [--test-mode]
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT, VERIFIED_ROOT_REL, runFixturePath, aggregateDir } from './lib/swe-bench-verified-paths.mjs';
import { verifySpectraVersion } from './lib/spectra-version-gate.mjs';
import { parsePreregistration, computeTaskSetHash } from './lib/preregistration-check.mjs';
import { scanForbiddenClaims } from './lib/forbidden-claims-scan.mjs';

const TEST_MODE = process.argv.includes('--test-mode');
const SPEC_DIR = path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort');
const VERIF = path.join(SPEC_DIR, 'verification');
const REPORT_M7 = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md');
const REPORT_MAIN = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/PUBLISH-REPORT.md');

const steps = [];
function step(id, ok, detail) {
  steps.push({ id, ok, detail });
  console.log(JSON.stringify({ step: id, ok, detail: detail.slice(0, 220) }));
}
function readIf(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null; }
function fm(text, key) { const m = text?.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')); return m ? m[1].trim() : null; }

// ── SC-001：smoke 5/5 success + cohort3 mcp>0（host 产物 smoke-result.md，交叉核对计数）──
function checkSmoke() {
  const t = readIf(path.join(VERIF, 'smoke-result.md'));
  if (!t) return step('SC-001:smoke', false, 'smoke-result.md 缺失（host 跑 batch --smoke 后生成）');
  // codex CRITICAL：不能只看 status —— 交叉核对 frontmatter 机器可读字段 + host source 标记
  const status = fm(t, 'status');
  const source = fm(t, 'source');
  const broken = Number(fm(t, 'brokenCount'));
  const c3Mcp = Number(fm(t, 'c3McpCallCount'));
  const runCount = Number(fm(t, 'runCount'));
  const ok = status === 'PASS' && /host/.test(source ?? '') && broken === 0 && c3Mcp > 0 && runCount === 5;
  step('SC-001:smoke', ok,
    `status=${status} source=${source} runs=${runCount} broken=${broken} c3Mcp=${c3Mcp}`
    + (ok ? '' : '（任一不符即 FAIL；防伪第二防线=仅真实 batch 写此文件 + git 历史 + 人工 review）'));
}

// ── SC-001b：版本门禁正向 + 负向（sandbox 可验）──
function checkVersionGate() {
  const distCli = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
  const pos = verifySpectraVersion(distCli, { allowDirty: true });
  step('SC-001b:gate-positive', pos.ok, pos.reason);
  // 负向：无 build-meta 的"旧 binary"必须被挡
  const fakeDist = fs.mkdtempSync(path.join(os.tmpdir(), 'f176-fake-dist-'));
  fs.mkdirSync(path.join(fakeDist, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(fakeDist, 'cli', 'index.js'), '// old npm binary simulacrum\n');
  const neg = verifySpectraVersion(path.join(fakeDist, 'cli', 'index.js'));
  step('SC-001b:gate-negative', !neg.ok, `旧 binary 被挡: ${neg.reason}`);
  fs.rmSync(fakeDist, { recursive: true, force: true });
}

// ── SC-002：cohort3 平均 mcp_tool_calls ≥ 2/run 且 cohort2 ≈ 0（host fixtures）──
// 单位口径（codex WARNING）：分母 = 每次任务执行（run；task×repeat），与报告 §4.4 一致
function checkMcpCalls(taskIds) {
  if (taskIds.length === 0) return step('SC-002:mcp-calls', false, '原因=预注册未冻结（taskIds 空）；先冻结再跑 full');
  const expected = taskIds.length * 3; // 每 cohort 期望 run 数（codex CRITICAL：缺 fixture 不得静默跳过）
  const sum = { c3: 0, c3Runs: 0, c2: 0, c2Runs: 0 };
  for (const taskId of taskIds) {
    for (let r = 1; r <= 3; r++) {
      for (const [cohort, key] of [['spec-driver-spectra-mcp', 'c3'], ['spec-driver', 'c2']]) {
        const fx = readIf(runFixturePath(taskId, cohort, r));
        if (!fx) continue;
        const obj = JSON.parse(fx);
        const trace = obj.perf?.mcpToolCalls ?? obj.perf?.mcpToolCallTrace ?? [];
        sum[key] += Array.isArray(trace) ? trace.reduce((s, t) => s + (t.callCount ?? 0), 0) : 0;
        sum[`${key}Runs`]++;
      }
    }
  }
  const missing = `缺 fixture: c3=${expected - sum.c3Runs}/${expected}, c2=${expected - sum.c2Runs}/${expected}`;
  if (sum.c3Runs < expected || sum.c2Runs < expected) {
    return step('SC-002:mcp-calls', false, `原因=fixture 不完整（${missing}）—— 不允许部分集合通过`);
  }
  const c3Avg = sum.c3 / sum.c3Runs;
  const c2Avg = sum.c2 / sum.c2Runs;
  step('SC-002:mcp-calls', c3Avg >= 2 && c3Avg > c2Avg, `cohort3 avg=${c3Avg.toFixed(2)}/run（需≥2）, cohort2 avg=${c2Avg.toFixed(2)}/run（应≈0）；分母=task×repeat`);
}

// ── SC-003：oracle-only lift 数据 + 预注册一致 + falsification 段存在（报告纪律）──
function checkLiftAndPrereg(aggregate, taskIds) {
  const pre = readIf(path.join(VERIF, 'preregistration.md'));
  const parsed = pre ? parsePreregistration(pre) : null;
  const preregHash = parsed?.hash ?? null;

  if (!aggregate) {
    step('SC-003:lift-data', false, 'aggregate/cohort-aggregate.json 缺失（host 跑 full 后生成）');
  } else {
    // codex WARNING：存在性不够 —— aggregate 须绑回预注册（taskSetHash）+ run 数完整 + host 来源
    const bound = aggregate.taskSetHash != null && aggregate.taskSetHash === preregHash;
    const complete = aggregate.expectedRunCount != null && aggregate.runCount === aggregate.expectedRunCount;
    const hostSrc = /host/.test(aggregate.source ?? '');
    const ok = aggregate.lift !== undefined && bound && complete && hostSrc;
    step('SC-003:lift-data', ok,
      `lift=${aggregate.lift ?? 'null(c1=0)'} 绑定预注册=${bound} run完整=${aggregate.runCount}/${aggregate.expectedRunCount ?? '?'} source=${aggregate.source ?? '?'}`
      + '（lift 数值≥1.5 与否不 FAIL 本步——纪律见 falsification 段；数值解读需报告人工审查）');
  }
  if (!pre) return step('SC-003:prereg', false, 'preregistration.md 缺失');
  const internalOk = parsed.frozen && parsed.taskIds.length > 0 && computeTaskSetHash(parsed.taskIds) === parsed.hash;
  step('SC-003:prereg', internalOk, `frozen=${parsed.frozen} taskIds=${parsed.taskIds.length} hash一致=${internalOk}`);
  const report = readIf(REPORT_M7) ?? '';
  step('SC-003:falsification-section', /10\.6|falsification/i.test(report), '报告含 §10.6/falsification 段（无论 lift 结果都必须存在）');
}

// ── SC-004：c3_vs_c4 数据存在（结论在报告判读）──
function checkC3vsC4(aggregate) {
  if (!aggregate?.c3_vs_c4) return step('SC-004:c3-vs-c4', false, 'aggregate.c3_vs_c4 缺失');
  const v = aggregate.c3_vs_c4;
  step('SC-004:c3-vs-c4', true, `c3=${v.c3PassRate?.toFixed?.(3)} c4=${v.c4PassRate?.toFixed?.(3)} c3≥c4=${v.c3AtLeastC4}（数据存在；达标与否如实入报告）`);
}

// ── SC-005：两报告存在 + 锚点口径正确（FR-C-001..008）──
function checkReports() {
  const m7 = readIf(REPORT_M7);
  if (!m7) return step('SC-005:reports', false, 'PUBLISH-REPORT-M7.md 缺失');
  const main = readIf(REPORT_MAIN) ?? '';
  const requirements = [
    ['M7 章节入主报告', /M7/.test(main) && /Verified/.test(main)],
    ['token-per-completed-task 节', /token-per-completed-task/i.test(m7)],
    ['Anthropic -98.7% 限定 code-execution-with-MCP', /code.execution.with.MCP/i.test(m7)],
    ['RepoGraph +32.8% 相对（非绝对 pp）', /32\.8%/.test(m7) && /相对/.test(m7)],
    ['Serena=LSP vs Spectra=纯AST 主体方向', /Serena[\s\S]{0,80}LSP/.test(m7) && /(纯 ?AST[\s\S]{0,40}(免|无需) ?build|Spectra[\s\S]{0,60}纯 ?AST)/.test(m7)],
    ['drift 定性栏 + M8 roadmap', /drift/i.test(m7) && /M8/.test(m7)],
    ['Codex 两模型重叠/独有分类', /(两模型|重叠)[\s\S]{0,40}(高置信|独有|盲点)/.test(m7)],
    ['leakage 背景（OpenAI 停报）', /(停报|stopped reporting|2026-02-23)/.test(m7)],
    ['internal-cohort-only 贯穿', /internal-cohort-only/.test(m7)],
  ];
  const failed = requirements.filter(([, ok]) => !ok).map(([name]) => name);
  step('SC-005:reports', failed.length === 0, failed.length === 0 ? '两报告 + 9 项锚点口径全命中' : `缺: ${failed.join('; ')}`);
}

// ── SC-006：dogfooding 四维度 + 候选非空──
function checkDogfooding() {
  const t = readIf(path.join(VERIF, 'm8-fix-candidates.md'));
  if (!t) return step('SC-006:dogfooding', false, 'm8-fix-candidates.md 缺失');
  const dims = ['可用性', '信息完整性', '流程顺畅度', '结果准确性'];
  const hasDims = dims.every((d) => t.includes(d));
  const hasFindings = (t.match(/\*\*去向/g) ?? []).length >= 1;
  step('SC-006:dogfooding', hasDims && hasFindings, `四维度=${hasDims} 候选条目=${(t.match(/\*\*去向/g) ?? []).length}`);
}

// ── SC-007：禁用词扫描（按句限定语）──
function checkForbiddenClaims() {
  const m7 = readIf(REPORT_M7);
  if (!m7) return step('SC-007:forbidden-claims', false, 'PUBLISH-REPORT-M7.md 缺失');
  const { violations, ok } = scanForbiddenClaims(m7);
  step('SC-007:forbidden-claims', ok, ok ? '0 违规' : `${violations.length} 违规，如 L${violations[0].line}: ${violations[0].sentence.slice(0, 80)}`);
}

// ── SC-008：评测数据未入库──
function checkNotCommitted() {
  const ignored = spawnSync('git', ['-C', PROJECT_ROOT, 'check-ignore', VERIFIED_ROOT_REL], { encoding: 'utf-8' }).status === 0;
  const tracked = (spawnSync('git', ['-C', PROJECT_ROOT, 'ls-files', VERIFIED_ROOT_REL], { encoding: 'utf-8' }).stdout ?? '').trim();
  const srcSpecStaged = (spawnSync('git', ['-C', PROJECT_ROOT, 'diff', '--cached', '--name-only'], { encoding: 'utf-8' }).stdout ?? '').includes('specs/src.spec.md');
  step('SC-008:not-committed', ignored && tracked === '' && !srcSpecStaged, `gitignore=${ignored} tracked=${tracked === '' ? '0' : tracked.split('\n').length} src.spec.md未staged=${!srcSpecStaged}`);
}

// ── synthetic 拒收（真实模式专属）──
function checkProvenance() {
  if (TEST_MODE) return step('provenance', true, '⚠️ --test-mode：仅自测脚本逻辑，不算真实验收');
  const spike = readIf(path.join(VERIF, 'spike-result.md'));
  const spikeOk = spike != null && fm(spike, 'status') === 'PASS_SUBAGENT' && /source:\s*host/.test(spike);
  step('provenance:spike-host', spikeOk, spikeOk ? 'spike-result 为 host 真实产物（source: host + PASS_SUBAGENT）' : 'spike-result 缺失/非 host 来源/未 PASS_SUBAGENT');
}

function main() {
  console.error(`[verify-176] ${TEST_MODE ? '--test-mode（自测，不算真实验收）' : '真实验收模式'}`);
  const pre = readIf(path.join(VERIF, 'preregistration.md'));
  const taskIds = pre ? parsePreregistration(pre).taskIds : [];
  const aggRaw = readIf(path.join(aggregateDir(), 'cohort-aggregate.json'));
  const aggregate = aggRaw ? JSON.parse(aggRaw) : null;

  checkProvenance();
  checkSmoke();
  checkVersionGate();
  checkMcpCalls(taskIds);
  checkLiftAndPrereg(aggregate, taskIds);
  checkC3vsC4(aggregate);
  checkReports();
  checkDogfooding();
  checkForbiddenClaims();
  checkNotCommitted();

  const failed = steps.filter((s) => !s.ok);
  console.error(`\n[verify-176] ${steps.length - failed.length}/${steps.length} PASS${failed.length ? `；FAIL: ${failed.map((f) => f.id).join(', ')}` : ' ✅'}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
