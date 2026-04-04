#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCHEMA_VERSION = 1;
const VALID_RESULTS = new Set(['success', 'partial', 'paused', 'failed']);

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    workflowId: null,
    runId: null,
    result: null,
    startedAt: null,
    finishedAt: new Date().toISOString(),
    durationMs: null,
    rerun: false,
    rerunPhase: null,
    completedPhases: [],
    phaseDurations: [],
    gatePauses: [],
    verificationFailures: [],
    artifacts: [],
    warnings: [],
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--project-root':
        args.projectRoot = argv[index + 1] ?? args.projectRoot;
        index += 1;
        break;
      case '--workflow-id':
        args.workflowId = argv[index + 1] ?? args.workflowId;
        index += 1;
        break;
      case '--run-id':
        args.runId = argv[index + 1] ?? args.runId;
        index += 1;
        break;
      case '--result':
        args.result = argv[index + 1] ?? args.result;
        index += 1;
        break;
      case '--started-at':
        args.startedAt = argv[index + 1] ?? args.startedAt;
        index += 1;
        break;
      case '--finished-at':
        args.finishedAt = argv[index + 1] ?? args.finishedAt;
        index += 1;
        break;
      case '--duration-ms':
        args.durationMs = parseOptionalNumber(argv[index + 1]);
        index += 1;
        break;
      case '--rerun':
        args.rerun = true;
        break;
      case '--rerun-phase':
        args.rerunPhase = argv[index + 1] ?? args.rerunPhase;
        index += 1;
        break;
      case '--completed-phases':
        args.completedPhases.push(...splitList(argv[index + 1]));
        index += 1;
        break;
      case '--phase-duration':
        args.phaseDurations.push(parsePhaseDuration(argv[index + 1]));
        index += 1;
        break;
      case '--gate-pause':
        args.gatePauses.push(parseGatePause(argv[index + 1]));
        index += 1;
        break;
      case '--verification-failure':
        args.verificationFailures.push(parseVerificationFailure(argv[index + 1]));
        index += 1;
        break;
      case '--artifact':
        args.artifacts.push(...splitList(argv[index + 1]));
        index += 1;
        break;
      case '--warning':
        args.warnings.push(...splitList(argv[index + 1]));
        index += 1;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        break;
    }
  }

  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

export function recordWorkflowRun(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const workflowId = normalizeString(options.workflowId);
  const result = normalizeString(options.result);
  if (!workflowId) {
    throw new Error('缺少必填参数: --workflow-id');
  }
  if (!result || !VALID_RESULTS.has(result)) {
    throw new Error(`无效或缺失的 --result: ${result ?? 'null'}，有效值: ${Array.from(VALID_RESULTS).join(', ')}`);
  }

  const finishedAt = normalizeIsoTimestamp(options.finishedAt) ?? new Date().toISOString();
  const startedAt = normalizeIsoTimestamp(options.startedAt);
  const completedPhases = dedupeStringValues(options.completedPhases ?? []);
  const artifacts = dedupeStringValues(
    (options.artifacts ?? []).map((entry) => normalizeArtifactPath(entry, projectRoot)).filter(Boolean),
  );
  const phaseDurations = normalizePhaseDurations(options.phaseDurations ?? []);
  const gatePauses = normalizeGatePauses(options.gatePauses ?? []);
  const verificationFailures = normalizeVerificationFailures(options.verificationFailures ?? [], projectRoot);
  const warnings = dedupeStringValues(options.warnings ?? []);
  const durationMs = resolveDurationMs(options.durationMs, startedAt, finishedAt);
  const runId = normalizeString(options.runId) ?? `${workflowId}-${Date.now()}`;
  const rerun = options.rerun === true || options.rerun === 'true';
  const rerunPhase = normalizeString(options.rerunPhase);

  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventType: 'workflow-run-summary',
    recordedAt: finishedAt,
    workflowId,
    runId,
    result,
    startedAt,
    finishedAt,
    durationMs,
    rerun,
    rerunPhase,
    completedPhases,
    phaseDurations,
    gatePauses,
    verificationFailures,
    artifacts,
    warnings,
  };

  const runsDir = path.join(projectRoot, '.specify', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const targetFile = path.join(runsDir, `${finishedAt.slice(0, 7)}.jsonl`);
  fs.appendFileSync(targetFile, `${JSON.stringify(event)}\n`, 'utf-8');

  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    workflowId,
    result,
    jsonlPath: toPosix(path.relative(projectRoot, targetFile)),
    warnings,
  };
}

function normalizeIsoTimestamp(value) {
  const parsed = normalizeString(value);
  if (!parsed) {
    return null;
  }
  const timestamp = Date.parse(parsed);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function resolveDurationMs(durationMs, startedAt, finishedAt) {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
    return durationMs;
  }
  if (!startedAt || !finishedAt) {
    return null;
  }
  const delta = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}

function parseOptionalNumber(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePhaseDuration(rawValue) {
  const value = normalizeString(rawValue);
  if (!value) {
    return null;
  }
  const separatorIndex = value.includes('=') ? value.indexOf('=') : value.indexOf(':');
  if (separatorIndex < 1) {
    return null;
  }
  const phase = value.slice(0, separatorIndex).trim();
  const durationMs = Number(value.slice(separatorIndex + 1).trim());
  if (!phase || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  return { phase, durationMs };
}

function parseGatePause(rawValue) {
  const value = normalizeString(rawValue);
  if (!value) {
    return null;
  }
  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 1) {
    return { gate: value, phase: null };
  }
  return {
    gate: value.slice(0, separatorIndex).trim(),
    phase: normalizeString(value.slice(separatorIndex + 1)),
  };
}

function parseVerificationFailure(rawValue) {
  const value = normalizeString(rawValue);
  if (!value) {
    return null;
  }
  const separatorIndex = value.indexOf('::');
  if (separatorIndex < 0) {
    return {
      reason: value,
      path: null,
    };
  }
  const pathPart = value.slice(0, separatorIndex).trim();
  const reasonPart = value.slice(separatorIndex + 2).trim();
  return {
    path: pathPart,
    reason: reasonPart || 'unknown',
  };
}

function normalizePhaseDurations(phaseDurations) {
  return phaseDurations
    .filter(Boolean)
    .map((entry) => ({
      phase: normalizeString(entry.phase),
      durationMs: typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) && entry.durationMs >= 0
        ? entry.durationMs
        : null,
    }))
    .filter((entry) => entry.phase && entry.durationMs !== null);
}

function normalizeGatePauses(gatePauses) {
  return gatePauses
    .filter(Boolean)
    .map((entry) => ({
      gate: normalizeString(entry.gate),
      phase: normalizeString(entry.phase),
    }))
    .filter((entry) => entry.gate);
}

function normalizeVerificationFailures(verificationFailures, projectRoot) {
  return verificationFailures
    .filter(Boolean)
    .map((entry) => ({
      reason: normalizeString(entry.reason) ?? 'unknown',
      path: normalizeArtifactPath(entry.path, projectRoot),
    }));
}

function normalizeArtifactPath(candidatePath, projectRoot) {
  const normalized = normalizeString(candidatePath);
  if (!normalized) {
    return null;
  }
  const absolutePath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(projectRoot, normalized);
  return toPosix(path.relative(projectRoot, absolutePath));
}

function splitList(rawValue) {
  const value = normalizeString(rawValue);
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function dedupeStringValues(values) {
  return Array.from(new Set(values.map((value) => normalizeString(value)).filter(Boolean)));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      'Spec Driver Workflow Run Recorded',
      `Workflow: ${result.workflowId}`,
      `Run ID: ${result.runId}`,
      `Result: ${result.result}`,
      `JSONL: ${result.jsonlPath}`,
      ...(result.warnings.length > 0 ? ['Warnings:', ...result.warnings.map((warning) => `  - ${warning}`)] : []),
    ].join('\n') + '\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = recordWorkflowRun(args);
  printResult(result, args.json);
}
