#!/usr/bin/env node
/**
 * Feature 147 Phase 2 — LLM-as-judge（opus 双盲评分）
 *
 * 输入 fixture path → anonymize tool 标识 → 拼 rubric prompt → 子进程调 claude opus
 * → 解析 SCORE + RATIONALE → reverse-map → 写回 fixture quality 段
 *
 * 用法：
 *   node scripts/eval-judge.mjs --fixture <path> --rubric spec-quality [--inter-rater 2]
 *   node scripts/eval-judge.mjs --fixture <path> --rubric task-execution
 *
 * 不依赖 npm 包；用 claude CLI 子进程调用 opus。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SUPPORTED_RUBRICS = ['spec-quality', 'task-execution', 'commit-quality', 'grounding', 'documentation-quality'];
const JUDGE_MODEL = 'claude-opus-4-7';
const RUBRIC_DIR = path.join(__dirname, 'lib', 'rubric-templates');

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    fixture: null,
    rubric: 'spec-quality',
    interRater: 1,
    dryRun: false,
    contextOverride: null, // grounding 模式用：指定 grounding context 而不是 fixture
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--fixture': args.fixture = argv[++i]; break;
      case '--rubric': args.rubric = argv[++i]; break;
      case '--inter-rater': args.interRater = Number(argv[++i]); break;
      case '--dry-run': args.dryRun = true; break;
      case '--context-override': args.contextOverride = argv[++i]; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!SUPPORTED_RUBRICS.includes(args.rubric)) {
    throw new Error(`--rubric must be one of ${SUPPORTED_RUBRICS.join('|')}`);
  }
  return args;
}

// ============================================================
// Anonymization（双盲 judge 关键 — Codex C4）
// ============================================================

const TOOL_NAMES = ['spectra', 'graphify', 'aider-repomap', 'aider', 'cody', 'superpowers', 'gstack', 'spec-driver', 'control'];

export function anonymizeFixture(fixture) {
  const reverseMap = new Map(); // anonName → realName
  const aliasIndex = { TOOL: 0, DIR: 0, AUTHOR: 0, DOC: 0 };

  function alias(prefix, realValue) {
    if (!realValue || typeof realValue !== 'string') return realValue;
    for (const [anonName, real] of reverseMap.entries()) {
      if (real === realValue) return anonName;
    }
    const anonName = `<${prefix}_${String.fromCharCode(65 + aliasIndex[prefix]++)}>`;
    reverseMap.set(anonName, realValue);
    return anonName;
  }

  function stripPath(p) {
    if (!p || typeof p !== 'string') return p;
    let result = p;
    for (const tool of TOOL_NAMES) {
      // case-insensitive 替换路径段
      result = result.replace(new RegExp(`/${tool}/`, 'gi'), `/${alias('DIR', tool)}/`);
      result = result.replace(new RegExp(`/${tool}-`, 'gi'), `/${alias('DIR', tool + '-')}/`);
    }
    return result;
  }

  const anonymized = JSON.parse(JSON.stringify(fixture));
  if (anonymized.meta) {
    if (anonymized.meta.tool) {
      const aliased = alias('TOOL', anonymized.meta.tool);
      anonymized.meta.tool = aliased;
    }
    for (const k of ['outputDir', 'stdoutLogPath', 'stderrLogPath']) {
      if (anonymized.meta[k]) anonymized.meta[k] = stripPath(anonymized.meta[k]);
    }
    if (Array.isArray(anonymized.meta.args)) {
      anonymized.meta.args = anonymized.meta.args.map((a) => stripPath(a));
    }
    if (anonymized.meta.command) {
      for (const tool of TOOL_NAMES) {
        if (anonymized.meta.command.includes(tool)) {
          anonymized.meta.command = anonymized.meta.command.replace(tool, alias('TOOL', tool));
        }
      }
    }
  }
  if (anonymized.taskExecution?.tool) {
    anonymized.taskExecution.tool = alias('TOOL', anonymized.taskExecution.tool);
  }
  return { anonymized, reverseMap };
}

export function reverseAnonymize(text, reverseMap) {
  let result = text;
  for (const [anonName, real] of reverseMap.entries()) {
    result = result.split(anonName).join(real); // string replace all without escaping regex
  }
  return result;
}

// ============================================================
// Rubric prompt 加载
// ============================================================

export function loadRubric(rubricName) {
  const tplPath = path.join(RUBRIC_DIR, `${rubricName}.md`);
  if (!fs.existsSync(tplPath)) {
    throw new Error(`rubric template not found: ${tplPath}`);
  }
  return fs.readFileSync(tplPath, 'utf-8');
}

// ============================================================
// 工具产物加载（documentation-quality / spec-quality rubric 用）
//
// 不同工具产物形态：
//   - spectra: outputDir/modules/*.spec.md（多文件）
//   - graphify: outputDir/GRAPH_REPORT.md
//   - aider-repomap: outputDir/aider-repomap-stdout.log
// ============================================================

export function summarizeToolOutput(outputDir, tool, maxBytes = 12000) {
  if (!outputDir || !fs.existsSync(outputDir)) return '(outputDir not found)';

  // 1. spectra: 拼 spec.md 摘录
  const modulesDir = path.join(outputDir, 'modules');
  if (fs.existsSync(modulesDir) && tool === 'spectra') {
    const files = fs.readdirSync(modulesDir).filter((n) => n.endsWith('.spec.md')).slice(0, 5);
    const samples = [];
    for (const f of files) {
      const content = fs.readFileSync(path.join(modulesDir, f), 'utf-8');
      const lines = content.split('\n');
      const sample = lines.slice(0, 80).join('\n');
      const headings = lines.filter((l) => /^#+\s/.test(l)).slice(0, 20).join('\n');
      samples.push(`### File ${f}\n${sample.length > 2000 ? sample.slice(0, 2000) + '\n...(truncated)' : sample}\n\n--- All headings ---\n${headings}`);
    }
    return samples.join('\n\n---\n\n').slice(0, maxBytes);
  }

  // 2. graphify: 取 GRAPH_REPORT.md
  const graphReport = path.join(outputDir, 'GRAPH_REPORT.md');
  if (fs.existsSync(graphReport) && tool === 'graphify') {
    return `### File GRAPH_REPORT.md\n${fs.readFileSync(graphReport, 'utf-8').slice(0, maxBytes)}`;
  }

  // 3. aider-repomap: 取 stdout log
  const aiderLog = path.join(outputDir, 'aider-repomap-stdout.log');
  if (fs.existsSync(aiderLog) && tool === 'aider-repomap') {
    return `### File aider-repomap-stdout.log\n${fs.readFileSync(aiderLog, 'utf-8').slice(0, maxBytes)}`;
  }

  // 4. 其他 tool 或 fallback：扫 outputDir 找 .md 文件
  if (fs.existsSync(outputDir)) {
    const mdFiles = fs.readdirSync(outputDir).filter((n) => n.endsWith('.md'));
    if (mdFiles.length > 0) {
      return `### File ${mdFiles[0]}\n${fs.readFileSync(path.join(outputDir, mdFiles[0]), 'utf-8').slice(0, maxBytes)}`;
    }
  }
  return '(no recognizable output artifacts)';
}

// 兼容 alias（保留 spec-quality rubric 的旧调用）
export function summarizeSpecContent(outputDir, maxModules = 5) {
  return summarizeToolOutput(outputDir, 'spectra', maxModules * 2400);
}

// ============================================================
// Judge 调用
// ============================================================

export function buildJudgePrompt({ rubricTemplate, fixture, contextOverride }) {
  const fixtureSummary = JSON.stringify({
    schemaVersion: fixture.schemaVersion,
    meta: {
      tool: fixture.meta?.tool,
      mode: fixture.meta?.mode,
      targetProject: fixture.meta?.targetProject,
      targetCommit: fixture.meta?.targetCommit?.slice(0, 7),
    },
    perf: fixture.perf,
    output: fixture.output,
    quality: fixture.quality,
    taskExecution: fixture.taskExecution,
  }, null, 2);

  // 按 fixture 的 meta.tool 加载对应工具的产物（公平比较：spectra/graphify/aider 各自 native artifact）
  const tool = fixture.meta?.tool ?? 'spectra';
  const specContent = contextOverride ?? summarizeToolOutput(fixture.meta?.outputDir, tool);

  return `${rubricTemplate}

## Fixture Summary

\`\`\`json
${fixtureSummary}
\`\`\`

## Spec / Output Sample

${specContent}

---

按 rubric 给出最终评分（1-10 整数）+ 简短 rationale（≤ 200 字中文）。**严格按以下格式输出，不要 markdown wrapper**：

SCORE: <整数 1-10>
RATIONALE: <简短中文 rationale>
`;
}

export function callJudge(prompt, { dryRun = false, model = JUDGE_MODEL } = {}) {
  if (dryRun) {
    return { rawOutput: 'SCORE: 7\nRATIONALE: dry-run mock score', exitCode: 0, durationMs: 0 };
  }
  const start = process.hrtime.bigint();
  const r = spawnSync(
    'claude',
    ['--print', '--model', model, '--output-format', 'text', '--permission-mode', 'plan', prompt],
    { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
  );
  const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  return {
    rawOutput: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status,
    durationMs,
  };
}

export function parseJudgeOutput(rawOutput) {
  const scoreMatch = rawOutput.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
  const rationaleMatch = rawOutput.match(/RATIONALE:\s*([\s\S]+?)(?:\n\n|$)/i);
  return {
    score: scoreMatch ? Number(scoreMatch[1]) : null,
    rationale: rationaleMatch ? rationaleMatch[1].trim() : null,
  };
}

// ============================================================
// 主 judge 流程
// ============================================================

export async function judgeFixture({ fixturePath, rubric, interRater = 1, dryRun = false }) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const rubricTemplate = loadRubric(rubric);
  // 关键：在 anonymize 之前根据 真实 meta.tool 加载对应产物（anonymize 后 tool 名是占位符）
  const realTool = fixture.meta?.tool ?? 'spectra';
  const realOutputDir = fixture.meta?.outputDir;
  const specContentRaw = summarizeToolOutput(realOutputDir, realTool);
  const { anonymized, reverseMap } = anonymizeFixture(fixture);
  // specContent 也要 strip 工具名（防止 judge 通过 outputDir 路径或 GRAPH_REPORT 里的工具名识别身份）
  let specContent = specContentRaw;
  for (const [anon, real] of reverseMap.entries()) {
    specContent = specContent.split(real).join(anon);
  }
  const prompt = buildJudgePrompt({ rubricTemplate, fixture: anonymized, contextOverride: specContent });

  const runs = [];
  for (let i = 0; i < interRater; i++) {
    const r = callJudge(prompt, { dryRun });
    if (r.exitCode !== 0) {
      console.error(`[judge run ${i + 1}/${interRater}] failed:`, r.stderr.slice(0, 500));
    }
    const parsed = parseJudgeOutput(r.rawOutput);
    runs.push({
      runIndex: i + 1,
      score: parsed.score,
      rationaleAnonymized: parsed.rationale,
      durationMs: r.durationMs,
      exitCode: r.exitCode,
    });
    console.log(`[judge ${rubric}] run ${i + 1}/${interRater}: score=${parsed.score}, ${r.durationMs}ms`);
  }

  // 计算 inter-rater
  const scores = runs.map((r) => r.score).filter((s) => s != null);
  const avgScore = scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : null;
  const interRaterDelta = scores.length >= 2 ? Math.abs(scores[0] - scores[1]) : null;

  // reverse anonymization in rationale + 写回 fixture
  const finalRationale = runs[0]?.rationaleAnonymized
    ? reverseAnonymize(runs[0].rationaleAnonymized, reverseMap)
    : null;

  // 写回 fixture quality 段
  if (rubric === 'spec-quality') {
    fixture.quality = fixture.quality ?? {};
    fixture.quality.judgeSpecQuality = {
      score: avgScore,
      rationale: finalRationale,
      interRaterDelta,
      runs,
      judgedAt: new Date().toISOString(),
      judgeModel: JUDGE_MODEL,
    };
  } else if (rubric === 'documentation-quality') {
    fixture.quality = fixture.quality ?? {};
    fixture.quality.judgeDocumentationQuality = {
      score: avgScore,
      rationale: finalRationale,
      interRaterDelta,
      runs,
      judgedAt: new Date().toISOString(),
      judgeModel: JUDGE_MODEL,
      sourceArtifact: realTool === 'spectra' ? 'modules/*.spec.md' :
                      realTool === 'graphify' ? 'GRAPH_REPORT.md' :
                      realTool === 'aider-repomap' ? 'aider-repomap-stdout.log' : 'unknown',
    };
  } else if (rubric === 'task-execution' && fixture.taskExecution) {
    fixture.taskExecution.rubricJudgeScore = avgScore;
    fixture.taskExecution.rubricJudgeRationale = finalRationale;
    fixture.taskExecution.interRaterDelta = interRaterDelta;
  }

  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  return { fixturePath, score: avgScore, interRaterDelta, runs };
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture) throw new Error('--fixture required');
  if (!fs.existsSync(args.fixture)) throw new Error(`fixture not found: ${args.fixture}`);

  console.log(`[eval-judge] fixture=${path.relative(PROJECT_ROOT, args.fixture)} rubric=${args.rubric} inter-rater=${args.interRater}`);
  const r = await judgeFixture({
    fixturePath: args.fixture,
    rubric: args.rubric,
    interRater: args.interRater,
    dryRun: args.dryRun,
  });
  console.log(`[eval-judge] done: avg score=${r.score}, inter-rater delta=${r.interRaterDelta}`);
}

const isCliEntry = process.argv[1]?.endsWith('eval-judge.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[eval-judge] error: ${err.message}`);
    process.exit(1);
  });
}
