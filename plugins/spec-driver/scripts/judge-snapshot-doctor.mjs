/**
 * judge-snapshot-doctor.mjs
 * Feature 236 — 判定器快照漂移信号：CLI 编排层
 *
 * 独立、只读、开发者主动调用的 doctor 命令（npm run judge:doctor）。
 * 比对仓库侧与已安装快照侧的 6 个判定器文件，产出四态结果。
 * 不接入 repo:check、不接入 Stop hook、drift 恒退出码 0（诊断非门禁，FR-009）。
 * 输出只描述状态，不含任何重装/同步/修复建议（FR-011）。
 *
 * 运行相关测试:
 *   node --test plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs
 *   node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs
 */

import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import {
  JUDGE_FILE_SET,
  resolveActiveSnapshot,
  compareFile,
  aggregateStatus,
} from './lib/judge-snapshot-core.mjs';
import {
  computeSha256,
  validatePluginRoot,
  readSpecDriverPathFile,
  readInstalledPluginsMetadata,
  scanInstalledSnapshotPresence,
  canonicalize,
} from './lib/judge-snapshot-io.mjs';

/** 仓库侧判定器文件相对 projectRoot 的子目录前缀 */
const REPO_PLUGIN_SUBDIR = path.join('plugins', 'spec-driver');

/**
 * 解析命令行参数。仅支持 --project-root <path>。
 * 未知参数或缺值 → { ok:false, error }。
 */
function parseArgs(argv) {
  let projectRoot = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-root') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: '--project-root 需要一个路径参数' };
      }
      projectRoot = value;
      i += 1;
    } else {
      return { ok: false, error: `未知参数: ${arg}` };
    }
  }
  return { ok: true, projectRoot };
}

/**
 * 从 env.CLAUDE_PLUGIN_ROOT 组装 SourceProbe。
 */
function probeClaudePluginRoot(env) {
  const raw = env && typeof env.CLAUDE_PLUGIN_ROOT === 'string' ? env.CLAUDE_PLUGIN_ROOT.trim() : '';
  if (raw === '') return { kind: 'unavailable' };
  const validation = validatePluginRoot(raw);
  switch (validation.kind) {
    case 'ok':
      // 与 io 层 mapValidationToProbe 保持三来源对称：canonicalPath 须 realpath 规范化，
      // 否则 CLAUDE_PLUGIN_ROOT 指向 symlink 时输出未解析路径，行为与另两来源不一致（data-model §3.3）。
      return { kind: 'ok', path: raw, canonicalPath: canonicalize(raw) };
    case 'invalid':
      return { kind: 'invalid', reason: validation.reason };
    case 'error':
    default:
      return { kind: 'error', errorCode: validation.errorCode };
  }
}

/**
 * 核心编排（data-model.md §6）。projectRoot 为核心合同，env/claudeHome 可显式注入便于测试。
 */
export function checkJudgeSnapshotDrift({
  projectRoot,
  env = process.env,
  claudeHome = path.join(os.homedir(), '.claude'),
}) {
  // 步骤 1：仓库侧参照探测。仅「确定性缺失」(missing) 才判 not-applicable；
  // 「不确定性错误」(error/EACCES) 不得压成 not-applicable——入口存在但不可读时，
  // 快照若确定且内容真实漂移会被误吞（C2）。error 时不提前退出，继续解析 active snapshot，
  // 并在逐文件比较中把入口记为 indeterminate/repo（首次摘要结果复用，避免读入口两次）。
  const repoBase = path.join(projectRoot, REPO_PLUGIN_SUBDIR);
  const repoReference = path.join(repoBase, JUDGE_FILE_SET[0]);
  const repoReferenceProbe = computeSha256(repoReference);
  if (repoReferenceProbe.status === 'missing') {
    return {
      status: 'not-applicable',
      reason: 'repo-reference-missing',
      snapshotPath: null,
      resolutionSource: null,
      files: [],
    };
  }

  // 步骤 2：active 快照解析
  const sources = {
    claudePluginRoot: probeClaudePluginRoot(env),
    specDriverPath: readSpecDriverPathFile(projectRoot),
    installedMetadata: readInstalledPluginsMetadata(claudeHome),
  };
  const resolution = resolveActiveSnapshot(sources);

  if (resolution.resolutionSource === 'indeterminate') {
    // 2b：已有明确的错误/歧义信息 → 直接 indeterminate/resolution，不查 scanPresence
    if (resolution.reason === 'source-error' || resolution.reason === 'installed-plugins-metadata-ambiguous') {
      return {
        status: 'indeterminate',
        indeterminateKind: 'resolution',
        reason: resolution.reason,
        ...(resolution.detail ? { detail: resolution.detail } : {}),
        snapshotPath: null,
        resolutionSource: null,
        files: [],
      };
    }
    // 2c：no-active-snapshot-resolvable → 查 scanPresence 决定 not-applicable vs indeterminate
    const presence = scanInstalledSnapshotPresence(claudeHome);
    if (presence === 'absent') {
      return {
        status: 'not-applicable',
        reason: 'no-installed-snapshot',
        snapshotPath: null,
        resolutionSource: null,
        files: [],
      };
    }
    return {
      status: 'indeterminate',
      indeterminateKind: 'resolution',
      reason: presence === 'error' ? 'installed-snapshot-scan-error' : 'no-active-snapshot-resolvable',
      snapshotPath: null,
      resolutionSource: null,
      files: [],
    };
  }

  // 步骤 3：逐文件比对。入口文件（JUDGE_FILE_SET[0]）复用步骤 1 的探测结果，
  // 避免二次读盘；error 时 compareFile 将其判为 indeterminate/repo（保留其余已确认明细）。
  const files = JUDGE_FILE_SET.map((entry, index) => {
    const repoDigest = index === 0 ? repoReferenceProbe : computeSha256(path.join(repoBase, entry));
    const snapDigest = computeSha256(path.join(resolution.snapshotPath, entry));
    return { file: entry, ...compareFile(repoDigest, snapDigest) };
  });

  // 步骤 4：汇总
  const agg = aggregateStatus(files);
  if (agg === 'indeterminate') {
    return {
      status: 'indeterminate',
      indeterminateKind: 'comparison',
      reason: 'partial-file-read-failure',
      snapshotPath: resolution.snapshotPath,
      resolutionSource: resolution.resolutionSource,
      files,
    };
  }
  return {
    status: agg, // 'drift' | 'in-sync'
    snapshotPath: resolution.snapshotPath,
    resolutionSource: resolution.resolutionSource,
    files,
  };
}

const HEADER = [
  '判定器快照漂移诊断（judge-snapshot-doctor）',
  '============================================',
];

/** 逐文件明细区块（in-sync / drift / comparison-indeterminate 共用） */
function formatFileDetails(files) {
  const lines = [`文件明细（${files.length}）：`];
  for (const f of files) {
    let suffix = '';
    if (f.status === 'indeterminate') {
      suffix = `   (side: ${f.side}, errorCode: ${f.errorCode ?? 'unknown'})`;
    }
    lines.push(`  [${f.status}] ${f.file}${suffix}`);
  }
  return lines;
}

/** 汇总计数区块 */
function formatSummary(files) {
  const counts = {};
  for (const f of files) counts[f.status] = (counts[f.status] || 0) + 1;
  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
  return `汇总: ${parts.join(' / ')}`;
}

/**
 * 按 status（及 indeterminateKind）分支格式化人类可读报告（FR-011：不含修复建议）。
 */
function formatReport(result, projectRoot) {
  const lines = [...HEADER];
  if (projectRoot) lines.push(`projectRoot:      ${projectRoot}`);

  if (result.status === 'not-applicable') {
    lines.push('status:           not-applicable');
    lines.push(`reason:           ${result.reason}`);
    return lines.join('\n');
  }

  if (result.status === 'indeterminate' && result.indeterminateKind === 'resolution') {
    lines.push('status:           indeterminate（resolution：无法确定本机 active 快照目录）');
    lines.push(`reason:           ${result.reason}`);
    if (result.detail) {
      lines.push(
        `detail:           source=${result.detail.source}` +
          (result.detail.errorCode ? `, errorCode=${result.detail.errorCode}` : ''),
      );
    }
    return lines.join('\n');
  }

  // 以下三态均已定位快照目录，打印 snapshotPath / resolutionSource / 文件明细
  lines.push(`snapshotPath:     ${result.snapshotPath}`);
  lines.push(`resolutionSource: ${result.resolutionSource}`);

  if (result.status === 'indeterminate') {
    // comparison
    lines.push('status:           indeterminate（comparison：快照已定位，但部分文件读取失败，以下为已确认明细）');
  } else {
    lines.push(`status:           ${result.status}`);
  }
  lines.push('');
  lines.push(...formatFileDetails(result.files));
  lines.push('');
  lines.push(formatSummary(result.files));
  if (result.status === 'indeterminate') {
    lines.push('说明: 存在读取失败的文件，无法对其完成比较；已确认的明细如上，不因此被隐藏。');
  }
  return lines.join('\n');
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = 1;
    return;
  }
  const result = checkJudgeSnapshotDrift({ projectRoot: parsed.projectRoot });
  process.stdout.write(`${formatReport(result, parsed.projectRoot)}\n`);
  process.exitCode = 0;
}

// 仅作为入口脚本直接运行时执行（被 import 时不触发，便于单测）
function isDirectExecution() {
  return process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
}

if (isDirectExecution()) {
  main(process.argv.slice(2));
}
