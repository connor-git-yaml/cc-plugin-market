#!/usr/bin/env node
/**
 * Feature 147 Sprint 1 — Cross-LLM Jury（去 self-judge bias 的机器版"双盲"）
 *
 * 多个不同 LLM 独立评同一份 fixture，匿名化工具身份 + 对抗性 prompt（要求找问题）。
 * 取代 single self-judge 模式，让评分有 inter-rater agreement 信号。
 *
 * 用法：
 *   ANTHROPIC_API_KEY=sk-... node scripts/eval-judge-jury.mjs --fixture <path>
 *   node scripts/eval-judge-jury.mjs --task T1-... --tool spec-driver
 *   node scripts/eval-judge-jury.mjs --all
 *   node scripts/eval-judge-jury.mjs --judges claude-sonnet-4-6,claude-opus-4-7
 *   node scripts/eval-judge-jury.mjs --dry-run                         # mock score 不调 LLM
 *
 * 写回 fixture.taskExecution:
 *   juryScores: [{judge, score, rationale, issues}], juryMedian, juryMean, jurySpread,
 *   juryRunAt, juryAnonymized, juryAdversarial
 *
 * Cost (real run): ~$0.05 per judge per fixture; 2 judges × 30 fixture ≈ $3
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { anonymizeFixture } from './eval-judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASK_FIXTURES_DIR = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'tests/baseline/tasks');

export const DEFAULT_JUDGES = ['claude-sonnet-4-6', 'claude-opus-4-7'];
const MAX_DIFF_BYTES = 30000;

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    fixture: null,
    task: null,
    tool: null,
    all: false,
    judges: DEFAULT_JUDGES,
    dryRun: false,
    maxDiffBytes: MAX_DIFF_BYTES,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--fixture': args.fixture = argv[++i]; break;
      case '--task': args.task = argv[++i]; break;
      case '--tool': args.tool = argv[++i]; break;
      case '--all': args.all = true; break;
      case '--judges': args.judges = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--dry-run': args.dryRun = true; break;
      case '--max-diff-bytes': args.maxDiffBytes = Number(argv[++i]); break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.fixture && !(args.task && args.tool) && !args.all) {
    throw new Error('--fixture <path> or (--task <id> --tool <name>) or --all required');
  }
  if (args.judges.length === 0) throw new Error('--judges must include at least 1 model');
  return args;
}

// ============================================================
// Diff 提取 + 匿名化
// ============================================================

export function extractDiff({ wtDir, fallbackDiffStat, maxBytes }) {
  let diff;
  if (wtDir && fs.existsSync(wtDir)) {
    // Try HEAD~1 first, fallback to all commits ahead of master
    const r1 = spawnSync('git', ['-C', wtDir, 'diff', 'HEAD~1..HEAD'], { encoding: 'utf-8' });
    if (r1.status === 0 && r1.stdout) {
      diff = r1.stdout;
    } else {
      const r2 = spawnSync('git', ['-C', wtDir, 'diff', 'master..HEAD'], { encoding: 'utf-8' });
      diff = r2.status === 0 ? r2.stdout : (fallbackDiffStat ?? '(no diff available)');
    }
  } else {
    diff = fallbackDiffStat ?? '(no diff available; worktree no longer exists)';
  }
  if (diff.length > maxBytes) {
    diff = diff.slice(0, maxBytes) + `\n... (truncated, original ${diff.length} bytes)`;
  }
  return diff;
}

export function anonymizeDiff(diff, reverseMap) {
  let result = diff;
  for (const [_anonName, real] of reverseMap.entries()) {
    if (typeof real === 'string' && real.length > 2) {
      result = result.split(real).join('<TOOL>');
    }
  }
  // 也 strip 常见路径 marker
  result = result.replace(/spec-driver-(opus|spectra)/g, '<TOOL>');
  return result;
}

// ============================================================
// Adversarial prompt
// ============================================================

export function buildAdversarialPrompt({ taskPrompt, diff }) {
  return `你是一个**严格的代码评审者**。下面是某 AI 工具针对一个编程任务的产出 diff。
工具身份已匿名化（不要尝试猜测身份；猜测无意义）。

## 任务描述

\`\`\`
${taskPrompt}
\`\`\`

## 工具产出 git diff

\`\`\`diff
${diff}
\`\`\`

## 评分要求

按 0-10 整数评分（10=完美，5=可接受但有显著问题，1-3=严重缺陷）。综合考虑：
- **正确性**：实现是否完成任务核心目标，逻辑/数学/接口是否正确
- **边界**：是否处理关键 edge cases
- **测试**：是否有针对性测试，覆盖度
- **可读性**：命名、注释、代码结构

**关键要求**：找出该产出至少 2 个具体问题（指出具体行/逻辑/缺漏，不是泛泛批评）。
如果产出确实接近完美，说明"无显著问题"，仍给出 1-2 个可改进点。

## 输出严格 JSON（无 markdown wrapper、无前后缀文字）

{
  "score": <0-10 整数>,
  "rationale": "<2-4 句中文，说明给分依据>",
  "issues": ["<问题 1，含具体位置或方面>", "<问题 2>"]
}
`;
}

// ============================================================
// Anthropic SDK 调用（dependency injection 让 unit test 可 mock）
// ============================================================

export async function defaultClientFactory() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY env not set; export it or use --dry-run');
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000 });
}

export function parseJudgeJson(text) {
  // 提取 JSON object（容忍 markdown code fence wrapper 或前后空白）
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error('no JSON object in response');
  const obj = JSON.parse(objMatch[0]);
  return {
    score: typeof obj.score === 'number' ? obj.score : Number(obj.score),
    rationale: String(obj.rationale ?? ''),
    issues: Array.isArray(obj.issues) ? obj.issues.map(String) : [],
  };
}

export async function callJudgeViaSdk({ model, prompt, clientFactory = defaultClientFactory }) {
  const client = await clientFactory();
  const r = await client.messages.create({
    model,
    max_tokens: 1500,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (r.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  let parsed;
  try {
    parsed = parseJudgeJson(text);
  } catch (e) {
    return {
      judge: model,
      score: null,
      rationale: `[parse error: ${e.message}]`,
      issues: [],
      judgedAt: new Date().toISOString(),
      promptTokens: r.usage?.input_tokens ?? null,
      completionTokens: r.usage?.output_tokens ?? null,
      rawText: text.slice(0, 500),
    };
  }
  return {
    judge: model,
    score: parsed.score,
    rationale: parsed.rationale,
    issues: parsed.issues,
    judgedAt: new Date().toISOString(),
    promptTokens: r.usage?.input_tokens ?? null,
    completionTokens: r.usage?.output_tokens ?? null,
  };
}

// ============================================================
// Aggregation
// ============================================================

export function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function aggregateJury(scores) {
  const valid = scores.filter((s) => s != null && !Number.isNaN(s));
  if (valid.length === 0) {
    return { juryMedian: null, juryMean: null, jurySpread: null, juryAgreement: 'no-data' };
  }
  const med = median(valid);
  const mean = Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10;
  const spread = Math.max(...valid) - Math.min(...valid);
  let agreement;
  if (valid.length < 2) agreement = 'single-judge';
  else if (spread <= 1) agreement = 'high';
  else if (spread <= 2) agreement = 'medium';
  else agreement = 'low';
  return { juryMedian: med, juryMean: mean, jurySpread: spread, juryAgreement: agreement };
}

// ============================================================
// 主流程
// ============================================================

export async function runJuryOnFixture({
  fixturePath,
  judges = DEFAULT_JUDGES,
  dryRun = false,
  clientFactory,
  taskFixturesDir = TASK_FIXTURES_DIR,
  maxDiffBytes = MAX_DIFF_BYTES,
}) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const taskId = fixture.taskExecution?.taskId ?? fixture.meta?.taskId;
  if (!taskId) throw new Error(`fixture ${fixturePath} has no taskId`);

  const taskFixturePath = path.join(taskFixturesDir, `${taskId}.json`);
  if (!fs.existsSync(taskFixturePath)) throw new Error(`task fixture not found: ${taskFixturePath}`);
  const taskFx = JSON.parse(fs.readFileSync(taskFixturePath, 'utf-8'));

  const wtDir = fixture.meta?.outputDir;
  const rawDiff = extractDiff({ wtDir, fallbackDiffStat: fixture.taskExecution?.diffStat, maxBytes: maxDiffBytes });
  const { reverseMap } = anonymizeFixture(fixture);
  const anonymizedDiff = anonymizeDiff(rawDiff, reverseMap);

  const prompt = buildAdversarialPrompt({ taskPrompt: taskFx.prompt, diff: anonymizedDiff });

  const juryScores = [];
  for (const judge of judges) {
    if (dryRun) {
      juryScores.push({
        judge,
        score: 7,
        rationale: '[dry-run mock score; no LLM called]',
        issues: ['[dry-run] mock issue 1', '[dry-run] mock issue 2'],
        judgedAt: new Date().toISOString(),
        promptTokens: null,
        completionTokens: null,
      });
      continue;
    }
    try {
      const r = await callJudgeViaSdk({ model: judge, prompt, clientFactory });
      juryScores.push(r);
      console.error(`[jury] ${judge}: score=${r.score}`);
    } catch (e) {
      console.error(`[jury] ${judge} FAILED: ${e.message}`);
      juryScores.push({
        judge,
        score: null,
        rationale: `[error: ${e.message}]`,
        issues: [],
        judgedAt: new Date().toISOString(),
      });
    }
  }

  const validScores = juryScores.map((j) => j.score).filter((s) => s != null);
  const agg = aggregateJury(validScores);

  fixture.taskExecution = fixture.taskExecution ?? {};
  fixture.taskExecution.juryScores = juryScores;
  fixture.taskExecution.juryMedian = agg.juryMedian;
  fixture.taskExecution.juryMean = agg.juryMean;
  fixture.taskExecution.jurySpread = agg.jurySpread;
  fixture.taskExecution.juryAgreement = agg.juryAgreement;
  fixture.taskExecution.juryRunAt = new Date().toISOString();
  fixture.taskExecution.juryAnonymized = true;
  fixture.taskExecution.juryAdversarial = true;

  // Atomic write: tmp + fsync + rename，防止中途崩溃损坏 fixture json
  atomicWriteJson(fixturePath, fixture);
  return { fixturePath, juryScores, ...agg };
}

/**
 * Atomic file write via temp + rename.
 * 防止 ctrl-C / crash / 磁盘满导致 fixture 被截断成 invalid JSON。
 */
export function atomicWriteJson(targetPath, obj) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  const content = JSON.stringify(obj, null, 2) + '\n';
  let fd;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeSync(fd, content, 0, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    // 验证 tmp 是合法 JSON（不应失败因为我们刚 stringify 出的，但 defensive）
    JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    fs.renameSync(tmpPath, targetPath);
  } catch (e) {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
    if (fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
    throw e;
  }
}

export function listAllFixtures() {
  if (!fs.existsSync(FIXTURES_ROOT)) return [];
  const fixtures = [];
  for (const taskDir of fs.readdirSync(FIXTURES_ROOT)) {
    const fullTaskDir = path.join(FIXTURES_ROOT, taskDir);
    if (!fs.statSync(fullTaskDir).isDirectory()) continue;
    for (const toolDir of fs.readdirSync(fullTaskDir)) {
      const fp = path.join(fullTaskDir, toolDir, 'full.json');
      if (fs.existsSync(fp)) fixtures.push(fp);
    }
  }
  return fixtures;
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let fixturePaths;
  if (args.fixture) {
    fixturePaths = [args.fixture];
  } else if (args.task && args.tool) {
    fixturePaths = [path.join(FIXTURES_ROOT, args.task, args.tool, 'full.json')];
  } else {
    fixturePaths = listAllFixtures();
  }

  console.error(`[jury] judges: ${args.judges.join(', ')}; ${args.dryRun ? 'DRY-RUN' : 'live'}; ${fixturePaths.length} fixture(s)`);

  for (const fp of fixturePaths) {
    if (!fs.existsSync(fp)) {
      console.error(`[jury] SKIP missing: ${path.relative(PROJECT_ROOT, fp)}`);
      continue;
    }
    console.error(`\n[jury] === ${path.relative(PROJECT_ROOT, fp)} ===`);
    try {
      const r = await runJuryOnFixture({
        fixturePath: fp,
        judges: args.judges,
        dryRun: args.dryRun,
        maxDiffBytes: args.maxDiffBytes,
      });
      console.error(`[jury] median=${r.juryMedian} mean=${r.juryMean} spread=${r.jurySpread} agreement=${r.juryAgreement}`);
    } catch (e) {
      console.error(`[jury] FAILED: ${e.message}`);
    }
  }
}

const isCliEntry = process.argv[1]?.endsWith('eval-judge-jury.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[jury] error: ${err.message}`);
    process.exit(1);
  });
}
