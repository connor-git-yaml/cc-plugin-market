#!/usr/bin/env node
/**
 * Feature 162 Phase B2 (T038) — GLM judge calibration runner
 *
 * iter-2 修订（Codex C-5 + C-6 critical 修复）：
 *
 *   C-5: validateRecordsIntegrity 现把 oracleFails 纳入 invalid 判定。
 *        旧实现：totalFails > 0 && (glmFails > 0 || codexFails > 0) → 当
 *        15 条 record 全为 oracle 异常（method:'exception'）时仍返回 valid，
 *        calibration 阈值评估在零有效 oracle 数据上跑，结论不可信。
 *        新实现：oracleFails > 0 也直接 invalid，error message 一并报告 oracle 异常数。
 *
 *   C-6: fallback 路径强制 2-judge 一致同意制 (fail-closed)。
 *        spec FR-025 + plan §2.5：fallback 启用时只有 Opus + Kimi 同时判 pass 才视为
 *        final pass；任一判 fail 或两 judge 分歧 → fail-closed。
 *        旧实现：fallback IoU 仍走 codex baseline 单点 set，未实现 fail-closed
 *        语义，违背 spec 要求。
 *        新实现：
 *          - 在 fallback 路径中新建 `extractFallbackFailClosedPassSet`，仅当
 *            Opus + Kimi 双 judge 都打 pass 才加入 set
 *          - record 增加 judges.disagreement / judges.tieBreakResult 字段
 *          - 阈值评估改用 fail-closed set vs oracle 计算 IoU
 *
 * 历史修订（iter-1，Codex C-1/C-2/C-3/C-4/W-1/W-2/W-3）：
 *
 *   C-1: jury 包含 GLM judge **与** 旧 Codex judge（codex:gpt-5.5），
 *        每个 (fixture, run) 同时记录 glm/codex/kimi 三个分数；阈值评估
 *        计算 3 组 IoU：
 *          - IoU(GLM_pass, oracle_pass)   — FR-022 GLM 达标判定
 *          - IoU(Codex_pass, oracle_pass) — 旧 Codex baseline（记录用）
 *          - IoU(GLM_pass, Codex_pass)    — GLM vs 旧 Codex 一致性
 *        + Pearson(GLM_score, oracle_pass_int)。
 *
 *   C-2: oracle 真实跑 driver patch vs goldpatch 比对（FR-D-002 同 oracle）：
 *        primary 路径用 normalized diff token Jaccard；degraded 路径用纯
 *        string-level normalized 比对，confidence < 1。
 *
 *   C-3: 跑批后硬校验 successfulRecords.length === 15（5 fixture × 3 runs）
 *        且每条 record 必须含 glm_score（不为 null）；不达 → 退出非 0 + 明确
 *        错误 + 不进入阈值评估。
 *
 *   C-4: prompt 构造统一从 scripts/lib/judge-prompt-builder.mjs 导入，
 *        与生产 eval-judge-jury.mjs 共享同一份 prompt 字符串。
 *
 *   W-1: dry-run mock 引入受控随机性（80% driver 与 expected 一致 / 20% 偏离；
 *        judge score ±1 噪声），让 IoU/Pearson 落在 [0.7, 0.95] 区间，证明
 *        wiring 真实而非自确认。固定 seed 保证可重复。
 *
 *   W-2: artifact record schema 增加 driver_patch / oracle.method/confidence /
 *        judges.{glm,codex,kimi}.{score,refusal_detected,raw_response} / error。
 *
 *   W-3: --use-fallback-jury 路径仍含 Kimi (siliconflow)，所以也校验
 *        SILICONFLOW_API_KEY；只有 jury 完全是 claude-cli 时才能跳过此校验。
 *
 * 用法：
 *   node scripts/calibrate-glm-judge.mjs --dry-run
 *     mock LLM + oracle，验证骨架 + 受控随机性下 IoU/Pearson < 1.0
 *
 *   node scripts/calibrate-glm-judge.mjs --api-key-check
 *     检查 SILICONFLOW_API_KEY 就绪；缺失 → 退出码 73 (EX_CANTCREAT)
 *
 *   SILICONFLOW_API_KEY=sk-... node scripts/calibrate-glm-judge.mjs \
 *     [--rubric-version v1] [--use-fallback-jury]
 *     真实 calibration（每轮 ~$5 + ChatGPT Pro 配额）
 *
 * @file scripts/calibrate-glm-judge.mjs
 * @see specs/162-codex-driver-glm-judge-eval/plan.md §2.5.1-§2.5.5 + §0.1
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pearson } from './lib/pearson.mjs';
import { buildAdversarialPrompt } from './lib/judge-prompt-builder.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================
// 常量 & 阈值
// ============================================================

const FIXTURE_LIST_PATH = path.join(
  REPO_ROOT,
  'specs/162-codex-driver-glm-judge-eval/calibration-fixture-list.json',
);
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests/baseline/swe-bench-lite/fixtures');
const RUNBOOK_PATH = path.join(
  REPO_ROOT,
  'specs/162-codex-driver-glm-judge-eval/calibration-runbook.md',
);
const RESULT_ARTIFACT_PATH = path.join(
  REPO_ROOT,
  'specs/162-codex-driver-glm-judge-eval/calibration-result.json',
);

// 阈值（plan §2.5.5）
const THRESHOLD_IOU_PASS = 0.7;
const THRESHOLD_PEARSON = 0.6;
const THRESHOLD_IOU_REFUSAL = 0.5;

// jury 配置
//
// NEW jury（C-1 修复后）：3 judge + 1 旧 Codex baseline = 4 调用
//   - claude-cli:claude-opus-4-7  (Anthropic, US)         → 仅记录到 record，不参与 GLM 主阈值
//   - siliconflow:Pro/zai-org/GLM-5.1                     → FR-022 主考察对象
//   - siliconflow:Pro/moonshotai/Kimi-K2.6                → 中立 third party
//   - codex:gpt-5.5                                       → 旧 Codex baseline（FR-022 字面"GLM vs Codex"）
//
// FALLBACK jury（GLM 三轮 calibration 仍未达，启用 2-judge fail-closed）：
//   - claude-cli:claude-opus-4-7
//   - siliconflow:Pro/moonshotai/Kimi-K2.6
//   - codex:gpt-5.5（仍跑用于记录 baseline，不参与阈值评估）
const NEW_JURY = [
  'claude-cli:claude-opus-4-7',
  'siliconflow:Pro/zai-org/GLM-5.1',
  'siliconflow:Pro/moonshotai/Kimi-K2.6',
];
const FALLBACK_JURY = [
  'claude-cli:claude-opus-4-7',
  'siliconflow:Pro/moonshotai/Kimi-K2.6',
];

// 旧 Codex judge：calibration 必跑（C-1 FR-022 字面"GLM vs 旧 Codex 对比"）
// 即使 fallback 路径也跑，用于 baseline 数据保留
const CODEX_BASELINE_JUDGE = 'codex:gpt-5.5';

// jury_pass 阈值：score (0-10) ≥ 5 视为 pass
const JURY_PASS_THRESHOLD = 5;

// 拒答检测正则（plan §2.5.4）
const REFUSAL_PATTERNS = [
  /^I (cannot|can't|won't|am unable to)/i,
  /(我无法|我不能|抱歉.{0,20}(无法|不能))/,
  /^(Sorry|Apologies),? (I (cannot|can't))/i,
  /\bcannot (assist|help|comply)\b/i,
];

// 期望数据点（C-3 硬校验）：5 fixture × 3 runs = 15
const EXPECTED_DATA_POINTS = 15;

// ============================================================
// 受控伪随机数（W-1 dry-run 引入 noise）
// ============================================================

/**
 * Mulberry32 — 32-bit deterministic PRNG（小且可移植，无需依赖）。
 * 同一 seed 下每次跑产出相同序列，保证 dry-run 可重复（CI / vitest 可断言）。
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// CLI 参数解析
// ============================================================

function parseArgs(argv) {
  const args = {
    dryRun: false,
    apiKeyCheck: false,
    rubricVersion: 'v1',
    useFallbackJury: false,
    dryRunSeed: 1, // W-1：dry-run noise seed，保证可重复
  };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--dry-run') args.dryRun = true;
    else if (tok === '--api-key-check') args.apiKeyCheck = true;
    else if (tok === '--rubric-version') {
      i += 1;
      args.rubricVersion = argv[i];
    } else if (tok === '--use-fallback-jury') args.useFallbackJury = true;
    else if (tok === '--dry-run-seed') {
      i += 1;
      args.dryRunSeed = Number.parseInt(argv[i], 10);
      if (Number.isNaN(args.dryRunSeed)) {
        console.error(`invalid --dry-run-seed: ${argv[i]}`);
        process.exit(64);
      }
    } else if (tok === '--help' || tok === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${tok}`);
      printHelp();
      process.exit(64); // EX_USAGE
    }
  }
  return args;
}

function printHelp() {
  console.log(`Feature 162 Phase B2 — GLM judge calibration runner

Usage:
  node scripts/calibrate-glm-judge.mjs --dry-run
  node scripts/calibrate-glm-judge.mjs --api-key-check
  SILICONFLOW_API_KEY=... node scripts/calibrate-glm-judge.mjs \\
    [--rubric-version v1] [--use-fallback-jury]

Options:
  --dry-run            mock LLM + oracle 调用，仅验证骨架 + 受控随机性
  --dry-run-seed N     dry-run noise seed（默认 1，CI 可重复）
  --api-key-check      检查 SILICONFLOW_API_KEY 是否就绪
  --rubric-version v   rubric 版本号（v1 / v2 / v3，最多 3 轮）
  --use-fallback-jury  跳过 GLM，直接用回退 2-judge（Opus + Kimi）

Artifacts:
  ${path.relative(REPO_ROOT, RESULT_ARTIFACT_PATH)}   calibration 结果
  ${path.relative(REPO_ROOT, RUNBOOK_PATH)}      ops runbook
`);
}

// ============================================================
// 模块 1：fixture 加载
// ============================================================

/**
 * 加载 5 个 frozen fixture（依据 calibration-fixture-list.json）。
 */
function loadCalibrationFixtures() {
  if (!fs.existsSync(FIXTURE_LIST_PATH)) {
    throw new Error(`fixture list not found: ${FIXTURE_LIST_PATH}`);
  }
  const list = JSON.parse(fs.readFileSync(FIXTURE_LIST_PATH, 'utf8'));
  const fixtures = [];
  for (const entry of list.fixtures) {
    const matches = fs
      .readdirSync(FIXTURES_DIR)
      .filter((f) => f.startsWith(`${entry.id}-`) && f.endsWith('.json'));
    if (matches.length === 0) {
      throw new Error(`fixture file not found for id ${entry.id} in ${FIXTURES_DIR}`);
    }
    const fixturePath = path.join(FIXTURES_DIR, matches[0]);
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const goldpatchName = matches[0].replace(/\.json$/, '.goldpatch.diff');
    fixtures.push({
      id: entry.id,
      label: entry.label,
      taskType: entry.task_type,
      expectedOutcome: entry.expected_outcome,
      runsPerFixture: entry.runs_per_fixture,
      prompt: fixtureData.prompt,
      goldpatchPath: path.join(FIXTURES_DIR, goldpatchName),
    });
  }
  return fixtures;
}

// ============================================================
// 模块 2：driver 调用（含 mock 模式）
// ============================================================

/**
 * driver 阶段：调 codex:gpt-5.5 生成 patch。
 *
 * dry-run 模式（W-1 修复）：根据 expectedOutcome + 受控随机性返回 mock patch：
 *   - expectedOutcome === 'pass'：80% 返回 close-to-goldpatch（oracle 应 pass）
 *                                  20% 返回 noisy patch（oracle 应 fail）
 *   - expectedOutcome === 'fail'：80% 返回 noisy patch（oracle fail）
 *                                  20% 返回 close-to-goldpatch（oracle pass，模拟惊喜）
 *   - expectedOutcome === 'refusal'：100% 返回拒答文本
 */
async function runDriver({ fixture, runId, dryRun, callExecutorImpl, rng }) {
  if (dryRun) {
    if (fixture.expectedOutcome === 'refusal') {
      return {
        ok: true,
        patch: 'I cannot assist with this request as it violates safety guidelines.',
        tokensUsed: 50,
      };
    }
    // 受控随机：80% 与 expected 一致，20% 偏离
    const r = rng();
    const matchExpected = r < 0.8;
    let patch;
    if (
      (fixture.expectedOutcome === 'pass' && matchExpected) ||
      (fixture.expectedOutcome === 'fail' && !matchExpected)
    ) {
      // close-to-goldpatch：直接读 goldpatch 内容，oracle 应判 pass
      try {
        patch = fs.readFileSync(fixture.goldpatchPath, 'utf8');
      } catch {
        patch = `--- a/file.py\n+++ b/file.py\n@@ -1 +1 @@\n-old\n+new ${fixture.id}\n`;
      }
    } else {
      // noisy patch：与 goldpatch 显著不同，oracle 应判 fail
      patch = `--- a/unrelated.py\n+++ b/unrelated.py\n@@ -1 +1 @@\n-irrelevant ${fixture.id} run${runId}\n+totally different change ${r.toFixed(4)}\n`;
    }
    return { ok: true, patch, tokensUsed: 200 };
  }
  // 实跑路径
  if (!callExecutorImpl) {
    throw new Error('runDriver: callExecutorImpl not provided in non-dry-run mode');
  }
  const result = await callExecutorImpl({
    model: 'codex:gpt-5.5',
    prompt: fixture.prompt,
    options: { reasoningEffort: 'medium' },
  });
  return {
    ok: result.ok,
    patch: result.text || '',
    tokensUsed: (result.promptTokens || 0) + (result.completionTokens || 0),
    error: result.error || null,
  };
}

// ============================================================
// 模块 3：oracle —— 实跑 patch vs goldpatch 比对（C-2 修复）
// ============================================================

/**
 * 把 unified diff 规范化为语义 token multiset：
 *   - 仅保留 +/- 行（去 file/hunk header / context line / 空行）
 *   - 去 +/- 前缀，trim
 *   - 跳过注释行（# / //）和纯空白行
 *   - 拆 token（空白分词，保留重复）
 *
 * 与 scripts/eval-diff-fuzzy-match.mjs §normalize 算法对齐（C-2 plan §0.1
 * 同 oracle 路径），保持 calibration 与生产 oracle 一致。
 */
function normalizeDiffToTokens(diffText) {
  if (typeof diffText !== 'string' || diffText.length === 0) return [];
  const tokens = [];
  for (const rawLine of diffText.split('\n')) {
    if (rawLine.length === 0) continue;
    if (rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) continue;
    if (rawLine.startsWith('@@')) continue;
    if (rawLine.startsWith('\\ No newline')) continue;
    if (rawLine.startsWith('diff --git') || rawLine.startsWith('index ')) continue;
    const first = rawLine[0];
    if (first !== '+' && first !== '-') continue; // 跳过 context line
    const body = rawLine.slice(1).trimEnd().trim();
    if (body.length === 0) continue;
    // 跳过纯注释行（# Python / // C/JS）— 不影响功能 oracle
    if (body.startsWith('#') || body.startsWith('//')) continue;
    for (const tok of body.split(/\s+/)) {
      if (tok.length > 0) tokens.push(tok);
    }
  }
  return tokens;
}

/**
 * Multiset Jaccard：|min(M1, M2)| / |max(M1, M2)|（与 fuzzy-match 算法一致）
 */
function multisetJaccard(tokensA, tokensB) {
  const ca = new Map();
  for (const t of tokensA) ca.set(t, (ca.get(t) ?? 0) + 1);
  const cb = new Map();
  for (const t of tokensB) cb.set(t, (cb.get(t) ?? 0) + 1);
  let interSize = 0;
  let unionSize = 0;
  const allKeys = new Set([...ca.keys(), ...cb.keys()]);
  for (const k of allKeys) {
    const a = ca.get(k) ?? 0;
    const b = cb.get(k) ?? 0;
    interSize += Math.min(a, b);
    unionSize += Math.max(a, b);
  }
  if (unionSize === 0) return 1.0; // 双方都空，视为一致
  return interSize / unionSize;
}

/**
 * oracle 阶段（C-2 修复）：driver patch 与 fixture goldpatch 实测比对。
 *
 * primary path: 基于 normalized token Jaccard 判定（threshold 0.6 与 plan §0.1
 *   eval-diff-fuzzy-match 默认对齐；calibration 用 0.6 而非 0.4 因要求更严）。
 *
 * degraded path: 若 goldpatch 文件读取失败 / driver patch 为空 / 比对函数
 *   抛错，降级为 string-level normalized 比对（去注释/空白行后逐行比较 set），
 *   confidence 标 0.5。
 *
 * refusal 特殊：driver 返回拒答文本（detectRefusal === true）→ 不能与 goldpatch
 *   有意义比对，oracle 直接判 fail（refusal 不视为功能修复）。
 */
function runOracle({ fixture, driverOutput }) {
  // 拒答情况：oracle 直接判 fail
  if (detectRefusal(driverOutput)) {
    return { passed: false, confidence: 1.0, method: 'refusal-direct-fail', similarity: 0 };
  }
  // 读 goldpatch
  let goldpatch;
  try {
    goldpatch = fs.readFileSync(fixture.goldpatchPath, 'utf8');
  } catch (err) {
    return {
      passed: false,
      confidence: 0.0,
      method: 'degraded-goldpatch-missing',
      similarity: 0,
      error: err.message,
    };
  }
  // primary: token multiset Jaccard
  try {
    const tokensActual = normalizeDiffToTokens(driverOutput);
    const tokensGold = normalizeDiffToTokens(goldpatch);
    if (tokensActual.length === 0 && tokensGold.length === 0) {
      return { passed: true, confidence: 1.0, method: 'token-jaccard', similarity: 1.0 };
    }
    if (tokensActual.length === 0) {
      return { passed: false, confidence: 1.0, method: 'token-jaccard', similarity: 0 };
    }
    const sim = multisetJaccard(tokensActual, tokensGold);
    // 阈值 0.6（与 eval-diff-fuzzy-match 默认 60 / 100 对齐）
    const passed = sim >= 0.6;
    return { passed, confidence: 1.0, method: 'token-jaccard', similarity: sim };
  } catch (err) {
    // degraded: 简单 string-level set 比对
    try {
      const linesA = new Set(
        driverOutput
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => (l.startsWith('+') || l.startsWith('-')) && l.length > 1),
      );
      const linesB = new Set(
        goldpatch
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => (l.startsWith('+') || l.startsWith('-')) && l.length > 1),
      );
      const inter = [...linesA].filter((l) => linesB.has(l)).length;
      const union = new Set([...linesA, ...linesB]).size;
      const sim = union === 0 ? 1.0 : inter / union;
      return {
        passed: sim >= 0.6,
        confidence: 0.5,
        method: 'degraded-string-level',
        similarity: sim,
        error: err.message,
      };
    } catch (err2) {
      return {
        passed: false,
        confidence: 0.0,
        method: 'degraded-failed',
        similarity: 0,
        error: `${err.message} | ${err2.message}`,
      };
    }
  }
}

// ============================================================
// 模块 4：jury —— GLM + Codex baseline + Kimi（C-1 修复）
// ============================================================

/**
 * jury 阶段（C-1 修复）：每个 (fixture, run) 同时调 GLM + 旧 Codex + Kimi
 * (+ Opus 留作记录)。返回 { glm, codex, kimi, opus? } 标准化字典。
 *
 * dry-run 模式（W-1 修复）：mock score 引入受控噪声 ±1，让聚合 IoU/Pearson
 *   不必为 1.0；对 oracle 实际 pass/fail 弱相关。
 */
async function runJury({
  fixture,
  driverOutput,
  judges,
  dryRun,
  callBackendImpl,
  runId,
  oracleResult,
  rng,
}) {
  // C-1：calibration 必须包含 codex baseline judge 用于 GLM-vs-Codex 对比
  // 即使 fallback jury 不含 GLM 也必须含 Codex，以记录 baseline
  const fullJudgeList = [...judges];
  if (!fullJudgeList.includes(CODEX_BASELINE_JUDGE)) {
    fullJudgeList.push(CODEX_BASELINE_JUDGE);
  }

  if (dryRun) {
    // mock：base 靠近阈值 5（pass=6.2, fail=3.8），叠加 noise，让部分数据点跨阈值 5。
    //   - NEW jury 路径（含 GLM）：noise [-1.5, 1.5]，IoU/Pearson ∈ [0.7, 0.95]
    //   - FALLBACK 路径：noise 增至 [-2.5, 2.5]，使 Opus/Kimi 出现 ~3-5 个分歧 case，
    //     验证 fail-closed 真实激活（C-6 iter-2 要求）。
    // 设计意图（W-1 + C-6）：流水线 wiring 真实而非自确认；固定 seed 保证 CI 可重复。
    const oracleBase = oracleResult?.passed ? 6.5 : 3.5;
    // 通过 judge slot 决定 noise 幅度；fallback 路径 (Opus + Kimi) 给更大 noise
    // 以触发分歧。Codex baseline 始终走小 noise 模拟稳定 baseline。
    const isFallbackPath = !fullJudgeList.some((j) => j.toLowerCase().includes('glm'));
    const out = {};
    for (const judge of fullJudgeList) {
      const slot = classifyJudgeSlot(judge);
      // fallback 路径下 Opus/Kimi 用更大 noise，触发分歧
      const noiseAmplitude = isFallbackPath && (slot === 'opus' || slot === 'kimi') ? 4.0 : 3.0;
      const noise = (rng() - 0.5) * noiseAmplitude;
      const score = Math.max(0, Math.min(10, Math.round(oracleBase + noise)));
      out[slot] = {
        judge,
        score,
        rationale: `[mock] judge=${judge} fixture=${fixture.id} run=${runId} score=${score} oracle=${oracleResult?.passed}`,
        rawResponse: `{"score": ${score}, "rationale": "..."}`,
        refusalDetected: false,
        ok: true,
      };
    }
    return out;
  }

  // 实跑路径
  if (!callBackendImpl) {
    throw new Error('runJury: callBackendImpl not provided in non-dry-run mode');
  }
  const judgePrompt = buildAdversarialPrompt({
    taskPrompt: fixture.prompt,
    diff: driverOutput || '(no patch produced)',
  });
  const results = await Promise.all(
    fullJudgeList.map(async (judge) => {
      try {
        const r = await callBackendImpl({
          model: judge,
          prompt: judgePrompt,
          options: { temperature: 0.0, maxTokens: 800 },
        });
        if (!r.ok) {
          return {
            judge,
            score: null,
            rationale: '',
            rawResponse: r.text || '',
            refusalDetected: false,
            ok: false,
            error: r.error,
          };
        }
        const parsed = parseJudgeResponse(r.text);
        return {
          judge,
          score: parsed.ok ? parsed.score : null,
          rationale: parsed.rationale,
          rawResponse: r.text,
          refusalDetected: detectRefusal(r.text),
          ok: parsed.ok,
        };
      } catch (err) {
        return {
          judge,
          score: null,
          rationale: '',
          rawResponse: '',
          refusalDetected: false,
          ok: false,
          error: { message: err.message },
        };
      }
    }),
  );
  // 把 results 数组按 slot 名（glm/codex/kimi/opus）展开成字典
  const out = {};
  for (const res of results) {
    const slot = classifyJudgeSlot(res.judge);
    out[slot] = res;
  }
  return out;
}

/**
 * 把 judge 名归类到 slot：glm / codex / kimi / opus / other
 */
function classifyJudgeSlot(judgeName) {
  const lower = judgeName.toLowerCase();
  if (lower.includes('glm')) return 'glm';
  if (lower.startsWith('codex:') || lower.includes('gpt-5.5')) return 'codex';
  if (lower.includes('kimi')) return 'kimi';
  if (lower.includes('opus') || lower.includes('claude')) return 'opus';
  return 'other';
}

function parseJudgeResponse(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, score: null, rationale: '' };
  }
  try {
    const m = text.match(/\{[^{}]*"score"[^{}]*\}/s);
    if (!m) return { ok: false, score: null, rationale: '' };
    const obj = JSON.parse(m[0]);
    if (typeof obj.score !== 'number') return { ok: false, score: null, rationale: '' };
    return { ok: true, score: obj.score, rationale: obj.rationale || '' };
  } catch {
    return { ok: false, score: null, rationale: '' };
  }
}

// ============================================================
// 模块 5：surface refusal detection
// ============================================================

function detectRefusal(driverOutput) {
  if (typeof driverOutput !== 'string' || driverOutput.length === 0) return false;
  const head = driverOutput.slice(0, 500);
  return REFUSAL_PATTERNS.some((re) => re.test(head));
}

// ============================================================
// 模块 6：聚合指标计算（IoU 三组 / Pearson）
// ============================================================

/**
 * IoU(A_pass, B_pass)：A 与 B 的 pass set 交并比。
 * passSet 由 score >= JURY_PASS_THRESHOLD 决定（GLM/Codex/Kimi 等 judge）
 * 或 oracle.passed 决定（oracle）。
 */
function computeIoU(setA, setB) {
  const inter = [...setA].filter((k) => setB.has(k)).length;
  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return 1.0;
  return inter / union;
}

/**
 * 从 records 抽取某 slot 的 pass set（key = `${fixtureId}|${runId}`）
 */
function extractJudgePassSet(records, slot) {
  const out = new Set();
  for (const r of records) {
    const key = `${r.fixtureId}|${r.runId}`;
    const j = r.judges?.[slot];
    if (j && typeof j.score === 'number' && j.score >= JURY_PASS_THRESHOLD) {
      out.add(key);
    }
  }
  return out;
}

function extractOraclePassSet(records) {
  const out = new Set();
  for (const r of records) {
    const key = `${r.fixtureId}|${r.runId}`;
    if (r.oracle?.passed) out.add(key);
  }
  return out;
}

/**
 * C-6：fallback 2-judge fail-closed pass set。
 *
 * 仅当 Opus + Kimi 同时打 pass（score >= JURY_PASS_THRESHOLD）时加入 set。
 * 任一 judge 缺失分数 / 打 fail / 两者分歧 → 不计 pass（fail-closed）。
 *
 * 设计依据：spec FR-025 + plan §2.5，fallback 不再追求 IoU，
 * 而是用一致同意制约束 jury 对争议样本的悲观判定。
 */
function extractFallbackFailClosedPassSet(records) {
  const out = new Set();
  for (const r of records) {
    const key = `${r.fixtureId}|${r.runId}`;
    const opusScore = r.judges?.opus?.score;
    const kimiScore = r.judges?.kimi?.score;
    if (typeof opusScore !== 'number' || typeof kimiScore !== 'number') continue;
    const opusPass = opusScore >= JURY_PASS_THRESHOLD;
    const kimiPass = kimiScore >= JURY_PASS_THRESHOLD;
    if (opusPass && kimiPass) out.add(key);
  }
  return out;
}

/**
 * C-6：在 record.judges 上附加 fallback 一致性诊断字段：
 *   - judges.disagreement (boolean): Opus 与 Kimi 是否分歧（XOR pass 状态）
 *   - judges.tieBreakResult ('pass' | 'fail-closed' | 'n/a'):
 *       双 pass → 'pass'；任一 fail / 分歧 / 缺数据 → 'fail-closed'
 *
 * 只在 fallback path 调用，避免污染 NEW jury 路径的 record schema。
 */
function annotateFallbackConsensus(records) {
  for (const r of records) {
    if (!r.judges) continue;
    const opusScore = r.judges.opus?.score;
    const kimiScore = r.judges.kimi?.score;
    const hasBoth = typeof opusScore === 'number' && typeof kimiScore === 'number';
    if (!hasBoth) {
      r.judges.disagreement = false;
      r.judges.tieBreakResult = 'fail-closed';
      continue;
    }
    const opusPass = opusScore >= JURY_PASS_THRESHOLD;
    const kimiPass = kimiScore >= JURY_PASS_THRESHOLD;
    r.judges.disagreement = opusPass !== kimiPass;
    r.judges.tieBreakResult = opusPass && kimiPass ? 'pass' : 'fail-closed';
  }
}

function extractRefusalDetectedSet(records) {
  const out = new Set();
  for (const r of records) {
    const key = `${r.fixtureId}|${r.runId}`;
    if (r.driverRefusalDetected) out.add(key);
  }
  return out;
}

function extractExpectedRefusalSet(records) {
  const out = new Set();
  for (const r of records) {
    const key = `${r.fixtureId}|${r.runId}`;
    if (r.expectedOutcome === 'refusal') out.add(key);
  }
  return out;
}

/**
 * Pearson(GLM_score, oracle_pass_int)：FR-023 主指标。
 */
function computePearsonGlmOracle(records) {
  const xs = [];
  const ys = [];
  for (const r of records) {
    const glmScore = r.judges?.glm?.score;
    if (typeof glmScore !== 'number') continue;
    xs.push(glmScore);
    ys.push(r.oracle?.passed ? 1 : 0);
  }
  if (xs.length < 2) return 0;
  return pearson(xs, ys);
}

// ============================================================
// 模块 7：calibration 主循环
// ============================================================

async function runCalibrationRound({
  fixtures,
  judges,
  dryRun,
  callExecutorImpl,
  callBackendImpl,
  rngSeed,
}) {
  const records = [];
  const errors = [];
  // W-1：所有 dry-run 随机均使用此 RNG，固定 seed → 可重复
  const rng = makeRng(rngSeed);
  for (const fixture of fixtures) {
    for (let runId = 1; runId <= fixture.runsPerFixture; runId += 1) {
      const startedAt = new Date().toISOString();
      try {
        // 1. driver
        const driver = await runDriver({ fixture, runId, dryRun, callExecutorImpl, rng });
        if (!driver.ok) {
          errors.push({
            fixtureId: fixture.id,
            runId,
            stage: 'driver',
            error: driver.error,
          });
          records.push({
            fixtureId: fixture.id,
            runId,
            startedAt,
            finalizedAt: new Date().toISOString(),
            expectedOutcome: fixture.expectedOutcome,
            driverPatch: '',
            driverTokens: 0,
            oracle: { passed: false, confidence: 0, method: 'driver-failed' },
            judges: {},
            driverRefusalDetected: false,
            error: { phase: 'driver', message: driver.error?.message ?? 'driver failed' },
          });
          continue;
        }

        // 2. oracle (real patch vs goldpatch)
        const oracle = runOracle({ fixture, driverOutput: driver.patch });

        // 3. jury（含 GLM + Codex baseline + Kimi + Opus）
        const judgeResults = await runJury({
          fixture,
          driverOutput: driver.patch,
          judges,
          dryRun,
          callBackendImpl,
          runId,
          oracleResult: oracle,
          rng,
        });

        // 4. surface refusal detection
        const refusalDetected = detectRefusal(driver.patch);

        records.push({
          fixtureId: fixture.id,
          runId,
          startedAt,
          finalizedAt: new Date().toISOString(),
          expectedOutcome: fixture.expectedOutcome,
          driverPatch: driver.patch,
          driverTokens: driver.tokensUsed,
          oracle,
          judges: judgeResults,
          driverRefusalDetected: refusalDetected,
          error: null,
        });
      } catch (err) {
        errors.push({
          fixtureId: fixture.id,
          runId,
          stage: 'unknown',
          error: { message: err.message },
        });
        records.push({
          fixtureId: fixture.id,
          runId,
          startedAt,
          finalizedAt: new Date().toISOString(),
          expectedOutcome: fixture.expectedOutcome,
          driverPatch: '',
          driverTokens: 0,
          oracle: { passed: false, confidence: 0, method: 'exception' },
          judges: {},
          driverRefusalDetected: false,
          error: { phase: 'unknown', message: err.message },
        });
      }
    }
  }
  return { records, errors };
}

/**
 * C-3：硬校验 records 完整性。
 *
 * 通过条件：
 *   1. records.length === EXPECTED_DATA_POINTS (15)
 *   2. 每条 record 必须含 GLM judge score（GLM judge slot 存在 + score 是 number）
 *
 * 任一条件失败 → 返回 invalid + 详细 reason，主入口拒绝进入阈值评估。
 *
 * fallback jury 例外：使用 --use-fallback-jury 时不要求 glm slot 存在
 *   （此时 calibration 只评估 codex baseline + kimi）。
 */
function validateRecordsIntegrity(records, { expectGlm }) {
  if (records.length !== EXPECTED_DATA_POINTS) {
    return {
      valid: false,
      reason: `仅 ${records.length}/${EXPECTED_DATA_POINTS} records 存在`,
      missing: EXPECTED_DATA_POINTS - records.length,
    };
  }
  let glmFails = 0;
  let codexFails = 0;
  let oracleFails = 0;
  for (const r of records) {
    if (r.error) {
      // record 自身打了 error 标记（driver/jury/oracle 任一阶段失败）
      if (r.error.phase === 'driver') codexFails += 1;
      else oracleFails += 1;
      continue;
    }
    if (expectGlm) {
      const glmScore = r.judges?.glm?.score;
      if (typeof glmScore !== 'number') {
        glmFails += 1;
      }
    }
    const codexScore = r.judges?.codex?.score;
    if (typeof codexScore !== 'number') {
      codexFails += 1;
    }
    // C-5：oracle 异常直接计入 oracleFails（method:'exception' 或 confidence 为 0）
    // 让 calibration 不能依赖零有效 oracle 数据通过
    if (
      !r.oracle ||
      r.oracle.method === 'exception' ||
      r.oracle.method === 'driver-failed' ||
      r.oracle.confidence === 0
    ) {
      oracleFails += 1;
    }
  }
  // C-5：oracleFails > 0 也直接 invalid（旧实现把 oracleFails 排除在 invalid 条件外）
  if (glmFails > 0 || codexFails > 0 || oracleFails > 0) {
    return {
      valid: false,
      reason: `Calibration round records 不完整：GLM 失败 ${glmFails} 个 / Codex 失败 ${codexFails} 个 / oracle 异常 ${oracleFails} 个，不达 plan iter-2 W-3 统计功效要求（需 15/15 全部 valid）`,
      glmFails,
      codexFails,
      oracleFails,
    };
  }
  return { valid: true, glmFails, codexFails, oracleFails };
}

/**
 * 计算阈值评估指标：3 组 IoU + Pearson。
 * 仅在 records 完整性校验通过后调用。
 */
function evaluateThresholds(records, { useFallbackJury }) {
  const oracleSet = extractOraclePassSet(records);
  const glmSet = extractJudgePassSet(records, 'glm');
  const codexSet = extractJudgePassSet(records, 'codex');
  const refusalDetectedSet = extractRefusalDetectedSet(records);
  const expectedRefusalSet = extractExpectedRefusalSet(records);

  // C-1：3 组 IoU
  const iouGlmOracle = useFallbackJury ? null : computeIoU(glmSet, oracleSet);
  const iouCodexOracle = computeIoU(codexSet, oracleSet); // baseline
  const iouGlmCodex = useFallbackJury ? null : computeIoU(glmSet, codexSet); // FR-022 字面"GLM vs Codex"

  // Pearson(GLM, oracle)
  const pearsonCorr = useFallbackJury ? null : computePearsonGlmOracle(records);

  // Refusal IoU
  const iouRefusal = computeIoU(refusalDetectedSet, expectedRefusalSet);

  // C-6：fallback fail-closed IoU（仅 fallback 路径计算）
  const fallbackFailClosedSet = useFallbackJury
    ? extractFallbackFailClosedPassSet(records)
    : null;
  const iouFallbackFailClosed = useFallbackJury
    ? computeIoU(fallbackFailClosedSet, oracleSet)
    : null;

  // 统计 fallback 分歧数（disagreement 计数）
  const fallbackDisagreementCount = useFallbackJury
    ? records.filter((r) => r.judges?.disagreement === true).length
    : null;

  // 主阈值判定
  let passed;
  let failures;
  if (useFallbackJury) {
    // C-6：fallback 用 2-judge 一致同意制 IoU（fail-closed），不再用 codex baseline 单点
    // codex baseline IoU 仍记录用于 baseline 对比，但不影响 pass/fail
    passed =
      iouFallbackFailClosed >= THRESHOLD_IOU_PASS &&
      iouRefusal >= THRESHOLD_IOU_REFUSAL;
    failures = {
      iouFallbackFailClosed: iouFallbackFailClosed < THRESHOLD_IOU_PASS,
      iouRefusal: iouRefusal < THRESHOLD_IOU_REFUSAL,
    };
  } else {
    passed =
      iouGlmOracle >= THRESHOLD_IOU_PASS &&
      pearsonCorr >= THRESHOLD_PEARSON &&
      iouRefusal >= THRESHOLD_IOU_REFUSAL;
    failures = {
      iouGlmOracle: iouGlmOracle < THRESHOLD_IOU_PASS,
      pearsonCorr: pearsonCorr < THRESHOLD_PEARSON,
      iouRefusal: iouRefusal < THRESHOLD_IOU_REFUSAL,
    };
  }

  return {
    iouGlmOracle,
    iouCodexOracle,
    iouGlmCodex,
    pearsonCorr,
    iouRefusal,
    iouFallbackFailClosed,
    fallbackDisagreementCount,
    passed,
    failures,
  };
}

// ============================================================
// 模块 8：API key 检查（W-3 修复）
// ============================================================

/**
 * 校验 SiliconFlow API key（GLM + Kimi 都依赖）。
 * 仅当 jury 完全是 claude-cli backend 时才能跳过——目前 NEW + FALLBACK 均含 Kimi。
 */
function checkApiKeyOrExit() {
  const key = process.env.SILICONFLOW_API_KEY;
  if (!key || key.trim().length === 0) {
    console.error('SILICONFLOW_API_KEY missing — calibration cannot run.');
    console.error('');
    console.error('GLM-5.1 + Kimi-K2.6 judges depend on SiliconFlow API.');
    console.error(`Refer to runbook: ${path.relative(process.cwd(), RUNBOOK_PATH)}`);
    console.error('');
    console.error('Steps:');
    console.error('  1. Provision SILICONFLOW_API_KEY (https://siliconflow.cn)');
    console.error('  2. Re-run: SILICONFLOW_API_KEY=sk-... node scripts/calibrate-glm-judge.mjs');
    process.exit(73); // EX_CANTCREAT
  }
  console.log('SILICONFLOW_API_KEY present — calibration ready.');
  return true;
}

/**
 * 判断 jury 是否完全不依赖 SiliconFlow（即所有 judge 都不是 siliconflow:* 前缀）。
 * 用于决定是否需要校验 SILICONFLOW_API_KEY。
 */
function juryNeedsSiliconflow(judges) {
  // calibration 必跑 codex baseline，但 codex 不需要 SiliconFlow
  // 只要任一 judge 是 siliconflow:* 前缀就需要
  return judges.some((j) => j.startsWith('siliconflow:'));
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --api-key-check 模式：检查 key + 退出
  if (args.apiKeyCheck) {
    // W-3：fallback 模式也需要 SILICONFLOW（含 Kimi）
    const judges = args.useFallbackJury ? FALLBACK_JURY : NEW_JURY;
    if (juryNeedsSiliconflow(judges)) {
      checkApiKeyOrExit();
    } else {
      console.log('jury 不含 siliconflow backend，跳过 SILICONFLOW_API_KEY 校验');
    }
    return;
  }

  // 实跑模式：jury 含 siliconflow → 必须有 key（dry-run 跳过此检查）
  if (!args.dryRun) {
    const judges = args.useFallbackJury ? FALLBACK_JURY : NEW_JURY;
    if (juryNeedsSiliconflow(judges) && !process.env.SILICONFLOW_API_KEY) {
      console.error('ERROR: SILICONFLOW_API_KEY missing for real calibration run.');
      console.error(`See runbook: ${path.relative(process.cwd(), RUNBOOK_PATH)}`);
      process.exit(73);
    }
  }

  console.log('=== Feature 162 Phase B2 — GLM judge calibration ===');
  console.log(`mode: ${args.dryRun ? 'DRY-RUN (mock LLM)' : 'REAL CALIBRATION'}`);
  console.log(`rubric version: ${args.rubricVersion}`);
  console.log(
    `jury: ${args.useFallbackJury ? 'FALLBACK (Opus + Kimi)' : 'NEW (Opus + GLM + Kimi)'} + Codex baseline`,
  );

  // 1. fixtures
  const fixtures = loadCalibrationFixtures();
  console.log(`loaded ${fixtures.length} fixtures: ${fixtures.map((f) => f.id).join(', ')}`);

  // 2. jury
  const judges = args.useFallbackJury ? FALLBACK_JURY : NEW_JURY;
  console.log(`judges (${judges.length}): ${judges.join(', ')}`);
  console.log(`baseline judge (always): ${CODEX_BASELINE_JUDGE}`);

  // 3. 实跑 LLM 调用注入（dry-run 模式不需要）
  let callExecutorImpl = null;
  let callBackendImpl = null;
  if (!args.dryRun) {
    const dispatcher = await import('./lib/llm-backend-dispatcher.mjs');
    callBackendImpl = dispatcher.callBackend;
    callExecutorImpl = dispatcher.callBackend;
  }

  // 4. 跑一轮 calibration
  console.log('\n--- running calibration round ---');
  const { records, errors } = await runCalibrationRound({
    fixtures,
    judges,
    dryRun: args.dryRun,
    callExecutorImpl,
    callBackendImpl,
    rngSeed: args.dryRunSeed,
  });

  console.log(
    `records collected: ${records.length} / ${EXPECTED_DATA_POINTS} expected`,
  );
  console.log(`errors: ${errors.length}`);
  if (errors.length > 0) {
    for (const e of errors.slice(0, 5)) {
      console.log(
        `  [error] ${e.fixtureId}/run-${e.runId} stage=${e.stage}: ${JSON.stringify(e.error)}`,
      );
    }
  }

  // 5. C-3：硬校验 records 完整性
  const integrity = validateRecordsIntegrity(records, { expectGlm: !args.useFallbackJury });
  if (!integrity.valid) {
    console.error('\n=== RECORDS INTEGRITY FAILURE ===');
    console.error(integrity.reason);
    // 仍写 artifact 便于排查
    const partialArtifact = buildArtifact({
      args,
      judges,
      records,
      errors,
      evalResult: null,
      integrity,
    });
    fs.mkdirSync(path.dirname(RESULT_ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(RESULT_ARTIFACT_PATH, JSON.stringify(partialArtifact, null, 2));
    console.error(
      `\npartial artifact written: ${path.relative(process.cwd(), RESULT_ARTIFACT_PATH)}`,
    );
    process.exit(2); // 不达统计功效，区别于阈值未达 (1)
  }

  // 6. C-6：fallback 路径在评估前给 records 标注一致性诊断
  if (args.useFallbackJury) {
    annotateFallbackConsensus(records);
  }

  // 7. 阈值评估
  const evalResult = evaluateThresholds(records, { useFallbackJury: args.useFallbackJury });
  console.log('\n--- metrics ---');
  if (!args.useFallbackJury) {
    console.log(
      `IoU(GLM_pass, oracle_pass):   ${evalResult.iouGlmOracle.toFixed(4)} (FR-022 threshold ${THRESHOLD_IOU_PASS})`,
    );
    console.log(`IoU(GLM_pass, Codex_pass):    ${evalResult.iouGlmCodex.toFixed(4)} (FR-022 字面，记录用)`);
    console.log(
      `Pearson(GLM_score, oracle):   ${evalResult.pearsonCorr.toFixed(4)} (FR-023 threshold ${THRESHOLD_PEARSON})`,
    );
  } else {
    // C-6：fallback fail-closed 主指标
    console.log(
      `IoU(Fallback_failClosed, oracle): ${evalResult.iouFallbackFailClosed.toFixed(4)} (FR-025 threshold ${THRESHOLD_IOU_PASS}, 2-judge 一致同意制)`,
    );
    console.log(
      `fallback disagreement count:  ${evalResult.fallbackDisagreementCount} / ${records.length} (Opus vs Kimi 分歧 → fail-closed)`,
    );
  }
  console.log(`IoU(Codex_pass, oracle_pass): ${evalResult.iouCodexOracle.toFixed(4)} (baseline)`);
  console.log(`IoU(refusal_detected, expected): ${evalResult.iouRefusal.toFixed(4)} (FR-024 threshold ${THRESHOLD_IOU_REFUSAL})`);
  console.log(`overall: ${evalResult.passed ? 'PASS' : 'FAIL'}`);

  // 7. 写 artifact
  const artifact = buildArtifact({
    args,
    judges,
    records,
    errors,
    evalResult,
    integrity,
  });
  fs.mkdirSync(path.dirname(RESULT_ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(RESULT_ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  console.log(`\nartifact written: ${path.relative(process.cwd(), RESULT_ARTIFACT_PATH)}`);

  // 8. 阈值未达 → 提示
  if (!evalResult.passed) {
    console.log('\n=== THRESHOLD NOT MET ===');
    if (!args.useFallbackJury) {
      if (evalResult.failures.iouGlmOracle) {
        console.log(`  - IoU(GLM, oracle) ${evalResult.iouGlmOracle.toFixed(4)} < ${THRESHOLD_IOU_PASS}`);
        console.log('    → adjust rubric: clarify pass/fail criteria for jury (see plan §2.5.5)');
      }
      if (evalResult.failures.pearsonCorr) {
        console.log(`  - Pearson ${evalResult.pearsonCorr.toFixed(4)} < ${THRESHOLD_PEARSON}`);
        console.log('    → adjust rubric: ask judges for finer-grained 0-10 scoring rubric');
      }
    } else {
      // C-6：fallback fail-closed
      if (evalResult.failures.iouFallbackFailClosed) {
        console.log(
          `  - IoU(Fallback_failClosed, oracle) ${evalResult.iouFallbackFailClosed.toFixed(4)} < ${THRESHOLD_IOU_PASS}`,
        );
        console.log(
          `    → 2-judge 分歧 ${evalResult.fallbackDisagreementCount} 个 / 一致 pass ${records.length - evalResult.fallbackDisagreementCount} 个，fail-closed 过严`,
        );
        console.log(
          '    → adjust rubric or escalate to spec FR-025 fallback exit criteria review',
        );
      }
    }
    if (evalResult.failures.iouRefusal) {
      console.log(`  - Refusal IoU ${evalResult.iouRefusal.toFixed(4)} < ${THRESHOLD_IOU_REFUSAL}`);
      console.log('    → adjust REFUSAL_PATTERNS in calibrate-glm-judge.mjs');
    }
    const nextVer = args.rubricVersion === 'v1' ? 'v2' : args.rubricVersion === 'v2' ? 'v3' : null;
    if (nextVer) {
      console.log(`\nRetry: node scripts/calibrate-glm-judge.mjs --rubric-version ${nextVer}`);
    } else {
      console.log('\n3 rubric rounds exhausted. Engage fallback:');
      console.log('  node scripts/calibrate-glm-judge.mjs --use-fallback-jury');
    }
    process.exit(1);
  }

  console.log('\n=== CALIBRATION PASSED ===');
}

/**
 * 把 calibration 结果序列化为 artifact JSON（含完整 record schema）。
 */
function buildArtifact({ args, judges, records, errors, evalResult, integrity }) {
  return {
    feature: 162,
    phase: 'B2',
    rubricVersion: args.rubricVersion,
    mode: args.dryRun ? 'dry-run' : 'real',
    dryRunSeed: args.dryRun ? args.dryRunSeed : null,
    judges,
    baselineJudge: CODEX_BASELINE_JUDGE,
    judgesPolicy: args.useFallbackJury ? 'fallback-2-judge' : 'new-3-judge',
    timestamp: new Date().toISOString(),
    thresholds: {
      iouPass: THRESHOLD_IOU_PASS,
      pearson: THRESHOLD_PEARSON,
      iouRefusal: THRESHOLD_IOU_REFUSAL,
    },
    integrity,
    metrics: evalResult
      ? {
          iouGlmOracle: evalResult.iouGlmOracle,
          iouCodexOracle: evalResult.iouCodexOracle,
          iouGlmCodex: evalResult.iouGlmCodex,
          pearsonCorr: evalResult.pearsonCorr,
          iouRefusal: evalResult.iouRefusal,
          // C-6：fallback fail-closed 指标（仅 fallback 路径非 null）
          iouFallbackFailClosed: evalResult.iouFallbackFailClosed,
          fallbackDisagreementCount: evalResult.fallbackDisagreementCount,
        }
      : null,
    passed: evalResult?.passed ?? false,
    failures: evalResult?.failures ?? null,
    records,
    errors,
  };
}

// 仅在直接执行时跑（便于单元测试 import 而不触发 main）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch((err) => {
    console.error('FATAL:', err.stack || err.message);
    process.exit(70); // EX_SOFTWARE
  });
}

// ============================================================
// 单元测试用 export
// ============================================================
export {
  parseArgs,
  loadCalibrationFixtures,
  runDriver,
  runOracle,
  runJury,
  detectRefusal,
  computeIoU,
  computePearsonGlmOracle,
  evaluateThresholds,
  validateRecordsIntegrity,
  runCalibrationRound,
  parseJudgeResponse,
  classifyJudgeSlot,
  normalizeDiffToTokens,
  multisetJaccard,
  juryNeedsSiliconflow,
  makeRng,
  buildArtifact,
  extractFallbackFailClosedPassSet,
  annotateFallbackConsensus,
  extractOraclePassSet,
  extractJudgePassSet,
  JURY_PASS_THRESHOLD,
  NEW_JURY,
  FALLBACK_JURY,
  CODEX_BASELINE_JUDGE,
  THRESHOLD_IOU_PASS,
  THRESHOLD_PEARSON,
  THRESHOLD_IOU_REFUSAL,
  EXPECTED_DATA_POINTS,
};
