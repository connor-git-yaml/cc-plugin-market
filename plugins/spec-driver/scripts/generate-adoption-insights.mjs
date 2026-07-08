#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  getLegacyProductScorecardReportJsonPath,
  getLegacyProductWorkflowIndexJsonPath,
  getProductAdoptionReportJsonPath,
  getProductAdoptionReportMarkdownPath,
  getProductScorecardReportJsonPath,
  getProductWorkflowIndexJsonPath,
  toRelativePosix,
} from './lib/product-artifact-paths.mjs';
import { appendWarningsSection, dedupeStringValues } from './lib/script-diagnostics.mjs';
import { readJsonArtifact, writeJsonArtifact, writeMarkdownArtifact } from './lib/script-report-io.mjs';

const SCHEMA_VERSION = 1;
const PRODUCT_ID = 'spec-driver';

/**
 * 已知的非 summary 事件类型白名单（Feature 208，data-model.md §9）。
 * 这些事件与 workflow-run-summary 共存于同一 .specify/runs/*.jsonl，但不参与 adoption 统计。
 * why 需要白名单：normalizeRunEvent 对非 summary 行返回 null → 原逻辑会计入 invalidLineCount 并
 * 产生"忽略无效 run event"warning，污染 adoption 报告 invalid 统计。白名单命中者静默 skip。
 */
const KNOWN_NON_SUMMARY_EVENT_TYPES = new Set(['fix-compliance-verdict']);

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--project-root') {
      args.projectRoot = argv[index + 1] ?? args.projectRoot;
      index += 1;
    }
  }

  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

export function generateAdoptionInsights(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const generatedAt = new Date().toISOString();
  const workflowIndex = readJsonArtifact(getProductWorkflowIndexJsonPath(projectRoot, PRODUCT_ID))
    ?? readJsonArtifact(getLegacyProductWorkflowIndexJsonPath(projectRoot, PRODUCT_ID))
    ?? {
    workflows: [],
    goldenPaths: [],
  };
  const scorecard = readJsonArtifact(getProductScorecardReportJsonPath(projectRoot, PRODUCT_ID))
    ?? readJsonArtifact(getLegacyProductScorecardReportJsonPath(projectRoot, PRODUCT_ID));
  const runLogResult = readRunLogs(projectRoot);
  const metrics = calculateMetrics(runLogResult.events, workflowIndex.workflows);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    productId: PRODUCT_ID,
    status: determineStatus(metrics),
    summary: buildSummary(metrics),
    stats: {
      logFileCount: runLogResult.logFileCount,
      validRunCount: metrics.totalRuns,
      invalidLineCount: runLogResult.invalidLineCount,
      workflowCount: metrics.workflowSummaries.length,
      runsWithPhaseDurations: metrics.runsWithPhaseDurations,
    },
    workflowSummaries: metrics.workflowSummaries,
    friction: {
      rerunHotspots: metrics.rerunHotspots,
      gatePauseHotspots: metrics.gatePauseHotspots,
      verificationFailureHotspots: metrics.verificationFailureHotspots,
      slowestPhases: metrics.slowestPhases,
    },
    scorecardContext: scorecard
      ? {
          status: scorecard.status ?? null,
          score: scorecard.score ?? null,
          reportPath: toRelativePosix(projectRoot, getProductScorecardReportJsonPath(projectRoot, PRODUCT_ID)),
        }
      : null,
    warnings: dedupeStringValues(runLogResult.warnings),
  };

  const jsonPath = getProductAdoptionReportJsonPath(projectRoot, PRODUCT_ID);
  const markdownPath = getProductAdoptionReportMarkdownPath(projectRoot, PRODUCT_ID);
  writeJsonArtifact(jsonPath, report);
  writeMarkdownArtifact(markdownPath, renderMarkdown(report));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    productId: PRODUCT_ID,
    status: report.status,
    jsonPath: toRelativePosix(projectRoot, jsonPath),
    markdownPath: toRelativePosix(projectRoot, markdownPath),
    totalRuns: metrics.totalRuns,
    warnings: report.warnings,
  };
}

function readRunLogs(projectRoot) {
  const runsDir = path.join(projectRoot, '.specify', 'runs');
  if (!fs.existsSync(runsDir)) {
    return {
      events: [],
      logFileCount: 0,
      invalidLineCount: 0,
      warnings: ['未找到 .specify/runs/，adoption 报告将以空样本生成'],
    };
  }

  const filePaths = fs.readdirSync(runsDir)
    .filter((fileName) => fileName.endsWith('.jsonl'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(runsDir, fileName));
  const warnings = [];
  const events = [];
  let invalidLineCount = 0;

  for (const filePath of filePaths) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      try {
        const parsed = JSON.parse(line);
        // 已知非 summary 事件类型（如 fix-compliance-verdict）静默 skip：不计 invalid、不产生 warning
        if (isObject(parsed) && KNOWN_NON_SUMMARY_EVENT_TYPES.has(parsed.eventType)) {
          continue;
        }
        const normalized = normalizeRunEvent(parsed);
        if (normalized) {
          events.push(normalized);
        } else {
          invalidLineCount += 1;
          warnings.push(`忽略无效 run event: ${relativePosix(projectRoot, filePath)}:${index + 1}`);
        }
      } catch {
        invalidLineCount += 1;
        warnings.push(`忽略损坏的 JSONL 行: ${relativePosix(projectRoot, filePath)}:${index + 1}`);
      }
    }
  }

  if (events.length === 0) {
    warnings.push('未发现可用的 workflow run 事件，adoption 报告仅输出空摘要');
  }

  return {
    events,
    logFileCount: filePaths.length,
    invalidLineCount,
    warnings,
  };
}

function normalizeRunEvent(entry) {
  if (!isObject(entry) || entry.eventType !== 'workflow-run-summary') {
    return null;
  }
  const workflowId = asString(entry.workflowId);
  const runId = asString(entry.runId);
  const result = asString(entry.result);
  if (!workflowId || !runId || !result) {
    return null;
  }
  return {
    workflowId,
    runId,
    result,
    recordedAt: normalizeIso(entry.recordedAt),
    startedAt: normalizeIso(entry.startedAt),
    finishedAt: normalizeIso(entry.finishedAt),
    durationMs: normalizeNumber(entry.durationMs),
    rerun: entry.rerun === true,
    rerunPhase: asString(entry.rerunPhase),
    completedPhases: asStringArray(entry.completedPhases),
    phaseDurations: normalizePhaseDurations(entry.phaseDurations),
    gatePauses: normalizeGatePauses(entry.gatePauses),
    verificationFailures: normalizeVerificationFailures(entry.verificationFailures),
    artifacts: asStringArray(entry.artifacts),
    warnings: asStringArray(entry.warnings),
  };
}

function calculateMetrics(events, workflowDefs) {
  const workflowMap = new Map(
    (Array.isArray(workflowDefs) ? workflowDefs : [])
      .filter((workflow) => isObject(workflow) && typeof workflow.id === 'string')
      .map((workflow) => [workflow.id, workflow]),
  );
  const grouped = new Map();
  const rerunPhaseCounts = new Map();
  const gatePauseCounts = new Map();
  const verificationCounts = new Map();
  const phaseDurationCounts = new Map();
  let runsWithPhaseDurations = 0;

  for (const event of events) {
    if (!grouped.has(event.workflowId)) {
      grouped.set(event.workflowId, []);
    }
    grouped.get(event.workflowId).push(event);

    if (event.rerun && event.rerunPhase) {
      incrementCounter(rerunPhaseCounts, event.rerunPhase, 1);
    }
    for (const gatePause of event.gatePauses) {
      const key = `${gatePause.gate}${gatePause.phase ? ` @ ${gatePause.phase}` : ''}`;
      incrementCounter(gatePauseCounts, key, 1);
    }
    for (const failure of event.verificationFailures) {
      const key = failure.reason + (failure.path ? ` (${failure.path})` : '');
      incrementCounter(verificationCounts, key, 1);
    }
    if (event.phaseDurations.length > 0) {
      runsWithPhaseDurations += 1;
    }
    for (const phaseDuration of event.phaseDurations) {
      if (!phaseDuration.phase || typeof phaseDuration.durationMs !== 'number') {
        continue;
      }
      const existing = phaseDurationCounts.get(phaseDuration.phase) ?? { totalDurationMs: 0, sampleCount: 0 };
      existing.totalDurationMs += phaseDuration.durationMs;
      existing.sampleCount += 1;
      phaseDurationCounts.set(phaseDuration.phase, existing);
    }
  }

  const workflowIds = new Set([...workflowMap.keys(), ...grouped.keys()]);
  const workflowSummaries = Array.from(workflowIds)
    .sort((left, right) => left.localeCompare(right))
    .map((workflowId) => summarizeWorkflow(workflowId, grouped.get(workflowId) ?? [], workflowMap.get(workflowId)));

  const totalRuns = workflowSummaries.reduce((sum, workflow) => sum + workflow.totalRuns, 0);
  const totalSuccessRuns = workflowSummaries.reduce((sum, workflow) => sum + workflow.successRuns, 0);
  const totalFailedRuns = workflowSummaries.reduce((sum, workflow) => sum + workflow.failedRuns, 0);
  const totalPausedRuns = workflowSummaries.reduce((sum, workflow) => sum + workflow.pausedRuns, 0);
  const totalPartialRuns = workflowSummaries.reduce((sum, workflow) => sum + workflow.partialRuns, 0);

  return {
    totalRuns,
    totalSuccessRuns,
    totalFailedRuns,
    totalPausedRuns,
    totalPartialRuns,
    runsWithPhaseDurations,
    workflowSummaries,
    rerunHotspots: counterToSortedArray(rerunPhaseCounts, 'phase'),
    gatePauseHotspots: counterToSortedArray(gatePauseCounts, 'gate'),
    verificationFailureHotspots: counterToSortedArray(verificationCounts, 'failure'),
    slowestPhases: Array.from(phaseDurationCounts.entries())
      .map(([phase, entry]) => ({
        phase,
        sampleCount: entry.sampleCount,
        averageDurationMs: Math.round(entry.totalDurationMs / entry.sampleCount),
      }))
      .sort((left, right) => right.averageDurationMs - left.averageDurationMs)
      .slice(0, 5),
  };
}

function summarizeWorkflow(workflowId, events, workflowDef) {
  const totalRuns = events.length;
  const successRuns = events.filter((entry) => entry.result === 'success').length;
  const failedRuns = events.filter((entry) => entry.result === 'failed').length;
  const pausedRuns = events.filter((entry) => entry.result === 'paused').length;
  const partialRuns = events.filter((entry) => entry.result === 'partial').length;
  const rerunRuns = events.filter((entry) => entry.rerun).length;
  const durations = events
    .map((entry) => entry.durationMs)
    .filter((entry) => typeof entry === 'number' && Number.isFinite(entry));
  const lastRunAt = events
    .map((entry) => entry.finishedAt ?? entry.recordedAt)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  return {
    id: workflowId,
    title: asString(workflowDef?.title) ?? workflowId,
    persona: asString(workflowDef?.persona) ?? 'unknown',
    totalRuns,
    successRuns,
    failedRuns,
    pausedRuns,
    partialRuns,
    rerunRuns,
    successRate: percentage(successRuns, totalRuns),
    failureRate: percentage(failedRuns, totalRuns),
    rerunRate: percentage(rerunRuns, totalRuns),
    averageDurationMs: durations.length > 0
      ? Math.round(durations.reduce((sum, entry) => sum + entry, 0) / durations.length)
      : null,
    lastRunAt,
  };
}

function buildSummary(metrics) {
  const topWorkflow = [...metrics.workflowSummaries]
    .sort((left, right) => right.totalRuns - left.totalRuns)[0] ?? null;

  return {
    totalRuns: metrics.totalRuns,
    activeWorkflowCount: metrics.workflowSummaries.filter((workflow) => workflow.totalRuns > 0).length,
    overallSuccessRate: percentage(metrics.totalSuccessRuns, metrics.totalRuns),
    overallFailureRate: percentage(metrics.totalFailedRuns, metrics.totalRuns),
    overallPausedRate: percentage(metrics.totalPausedRuns, metrics.totalRuns),
    topWorkflow: topWorkflow
      ? {
          id: topWorkflow.id,
          title: topWorkflow.title,
          totalRuns: topWorkflow.totalRuns,
        }
      : null,
  };
}

function determineStatus(metrics) {
  if (metrics.totalRuns === 0) {
    return 'insufficient-data';
  }
  if (metrics.totalFailedRuns > 0 || metrics.totalPausedRuns > 0 || metrics.rerunHotspots.length > 0) {
    return 'attention';
  }
  return 'healthy';
}

function renderMarkdown(report) {
  const lines = [
    '# Spec Driver Adoption Report',
    '',
    `- Generated At: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Total Runs: ${report.summary.totalRuns}`,
    `- Active Workflows: ${report.summary.activeWorkflowCount}`,
    `- Overall Success Rate: ${formatPercentage(report.summary.overallSuccessRate)}`,
    `- Overall Failure Rate: ${formatPercentage(report.summary.overallFailureRate)}`,
    `- Overall Paused Rate: ${formatPercentage(report.summary.overallPausedRate)}`,
    report.summary.topWorkflow
      ? `- Most Used Workflow: \`${report.summary.topWorkflow.id}\` (${report.summary.topWorkflow.totalRuns} runs)`
      : '- Most Used Workflow: 无数据',
    '',
    '## Workflow Usage',
    '',
    '| Workflow | Persona | Runs | Success | Failure | Paused | Rerun | Avg Duration | Last Run |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.workflowSummaries.map((workflow) => (
      `| \`${workflow.id}\` | ${workflow.persona} | ${workflow.totalRuns} | ${formatPercentage(workflow.successRate)} | ${formatPercentage(workflow.failureRate)} | ${workflow.pausedRuns} | ${formatPercentage(workflow.rerunRate)} | ${formatDuration(workflow.averageDurationMs)} | ${workflow.lastRunAt ?? '-'} |`
    )),
    '',
    '## Friction Hotspots',
    '',
    '### Rerun Hotspots',
    '',
    ...renderHotspots(report.friction.rerunHotspots, 'phase'),
    '',
    '### Gate Pause Hotspots',
    '',
    ...renderHotspots(report.friction.gatePauseHotspots, 'gate'),
    '',
    '### Verification Failure Hotspots',
    '',
    ...renderHotspots(report.friction.verificationFailureHotspots, 'failure'),
    '',
    '### Slowest Phases',
    '',
    ...renderSlowestPhases(report.friction.slowestPhases),
    '',
    '## Data Quality',
    '',
    `- Log Files: ${report.stats.logFileCount}`,
    `- Valid Runs: ${report.stats.validRunCount}`,
    `- Invalid Lines: ${report.stats.invalidLineCount}`,
    `- Runs With Phase Durations: ${report.stats.runsWithPhaseDurations}`,
  ];

  if (report.scorecardContext) {
    lines.push('');
    lines.push('## Scorecard Context');
    lines.push('');
    lines.push(`- Status: ${report.scorecardContext.status}`);
    lines.push(`- Score: ${report.scorecardContext.score}`);
    lines.push(`- Report: ${report.scorecardContext.reportPath}`);
  }

  appendWarningsSection(lines, report.warnings);

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderHotspots(items, keyField) {
  if (items.length === 0) {
    return ['- 无'];
  }
  return items.map((item) => `- ${item[keyField]}: ${item.count}`);
}

function renderSlowestPhases(items) {
  if (items.length === 0) {
    return ['- 无'];
  }
  return items.map((item) => `- ${item.phase}: ${formatDuration(item.averageDurationMs)}（samples=${item.sampleCount}）`);
}

function counterToSortedArray(counterMap, keyName) {
  return Array.from(counterMap.entries())
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

function incrementCounter(counterMap, key, count) {
  counterMap.set(key, (counterMap.get(key) ?? 0) + count);
}

function percentage(part, total) {
  if (!total) {
    return 0;
  }
  return Number(((part / total) * 100).toFixed(1));
}

function formatPercentage(value) {
  return `${value.toFixed(1)}%`;
}

function formatDuration(durationMs) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return '-';
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function normalizePhaseDurations(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => ({
      phase: asString(entry?.phase),
      durationMs: normalizeNumber(entry?.durationMs),
    }))
    .filter((entry) => entry.phase && entry.durationMs !== null);
}

function normalizeGatePauses(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => ({
      gate: asString(entry?.gate),
      phase: asString(entry?.phase),
    }))
    .filter((entry) => entry.gate);
}

function normalizeVerificationFailures(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => ({
      reason: asString(entry?.reason) ?? 'unknown',
      path: asString(entry?.path),
    }));
}

function normalizeIso(value) {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => asString(entry)).filter(Boolean);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function relativePosix(projectRoot, candidatePath) {
  return path.relative(projectRoot, candidatePath).split(path.sep).join('/');
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      'Spec Driver Adoption Insights',
      `Status: ${result.status}`,
      `Runs: ${result.totalRuns}`,
      `Markdown: ${result.markdownPath}`,
      `JSON: ${result.jsonPath}`,
      ...(result.warnings.length > 0 ? ['Warnings:', ...result.warnings.map((warning) => `  - ${warning}`)] : []),
    ].join('\n') + '\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateAdoptionInsights(args);
  printResult(result, args.json);
}
