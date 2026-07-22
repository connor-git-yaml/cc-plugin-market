#!/usr/bin/env node

/**
 * fix-compliance-judge.mjs
 * Feature 208 — fix 模式流程依从性判定 CLI 编排入口（唯一由 hooks.json 挂载的生产路径）
 *
 * 分层契约（research.md D3）：本文件是 I/O 编排层，负责
 *   解析参数与 stdin payload → 编排 io 层读取（config/transcript/state）→ 调用 core 纯函数判定
 *   → 编排 io 层写入（审计事件 / 阻断计数 / 降级放行的 record-workflow-run 终态事件）
 *   → 决定退出码与 stderr 反馈文本。
 *
 * 不变量（contracts/fix-compliance-judge-cli.md）：
 *   - 零 LLM / 零子代理委派：全程无 `Task(` / 模型 API 调用。
 *   - 顶层 try/catch 兜底（FR-013）：任何未捕获异常在 hook 模式下转化为 exit 0，不泄漏崩溃退出码。
 *   - `--mode report` 恒 exit 0、只打印 verdict JSON、零落盘副作用。
 *   - 不读取任务 ID / 任务描述文本作为判据（FR-011）。
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { realpathSync } from 'node:fs';
import {
  detectFixSkillExpansion,
  extractDelegationsAfter,
  resolveFeatureDirCandidate,
  classifyClosureForm,
  extractExecutionRecordsAfter,
  judgeCompliance,
  MISSING_ACTION_TEXT,
  DUAL_PATH_GUIDANCE,
  GATE_DEGRADED_PREFIX_LINE,
} from './lib/fix-compliance-core.mjs';
import {
  readHookPayload,
  readTranscriptEntries,
  findAndParseConfig,
  appendAuditEvent,
  checkFeatureDirOnDisk,
  readArtifactFile,
  loadBlockState,
  saveBlockState,
  resetBlockState,
} from './lib/fix-compliance-io.mjs';
import { recordWorkflowRun } from './record-workflow-run.mjs';

/** stderr 反馈前缀（FR-010，与既有 stop-task-check.sh 的 `[提醒]` 相区分） */
const PREFIX_BLOCK = '[FIX-COMPLIANCE]';
const PREFIX_WARN = '[FIX-COMPLIANCE][WARN]';
const PREFIX_DEGRADED = '[FIX-COMPLIANCE][GATE-DEGRADED]';

/** 会话内不合规阻断上限（FR-006）：达到后降级放行 */
const BLOCK_LIMIT = 2;

// ────────────────────────────────────────
// 参数解析
// ────────────────────────────────────────

export function parseArgs(argv) {
  const args = { mode: 'hook', projectRoot: process.cwd(), transcriptPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--mode') {
      args.mode = argv[i + 1] ?? args.mode;
      i += 1;
    } else if (token === '--project-root') {
      args.projectRoot = argv[i + 1] ?? args.projectRoot;
      i += 1;
    } else if (token === '--transcript-path') {
      args.transcriptPath = argv[i + 1] ?? args.transcriptPath;
      i += 1;
    }
  }
  if (args.mode !== 'hook' && args.mode !== 'report') args.mode = 'hook';
  return args;
}

// ────────────────────────────────────────
// stdin 读取（同步，避免异步竞态；hook payload 体量极小）
// ────────────────────────────────────────

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// ────────────────────────────────────────
// 判定编排（纯读取，不落盘；hook 与 report 共用）
// ────────────────────────────────────────

/**
 * 编排一次完整判定：读配置 → 读 transcript → 锚定 → 抽取委派/制品 → core 判定。
 * @returns {{
 *   enforcement:string, configDegraded:boolean,
 *   isFix:boolean, mode:string|null,
 *   transcriptDiagnostics:string[],
 *   verdict:object|null,
 * }}
 */
function evaluate(projectRoot, transcriptPath, cfg = null) {
  const config = cfg || findAndParseConfig(projectRoot);
  const enforcement = config.enforcement;
  const configDegraded = config.configDegraded;
  const configDiagnostics = config.diagnostics || [];

  const { entries, diagnostics: transcriptDiagnostics } = readTranscriptEntries(transcriptPath);
  if (transcriptDiagnostics.length > 0) {
    // transcript 不可用/超限 → FR-013 fail-open（无法得出判定结论）
    return {
      enforcement, configDegraded, isFix: false, mode: null,
      transcriptDiagnostics, verdict: null,
    };
  }

  const anchor = detectFixSkillExpansion(entries);
  const isFix = anchor.found && anchor.mode === 'fix';
  if (!isFix) {
    return {
      enforcement, configDegraded, isFix: false, mode: anchor.mode,
      transcriptDiagnostics: [], verdict: null,
    };
  }

  const candidate = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);

  // F227 D：主候选磁盘不可用时的只读兜底——状态机（core 层）逐字不变，
  // 磁盘判据完全下沉到这里，且仅在 ambiguous 为假、且 candidate.path 不可用时才介入。
  //
  // **单调性不变量（本兜底的正确性根据，改动时必须逐条保住）**：兜底解析只可能把
  // "改动前阻断"转为"改动后放行"，绝不可能把"改动前放行"转为"改动后阻断"。逐分支论证：
  //   - ambiguous === true → 兜底完全不介入（连 usable() 探针都不调用），
  //     F224 的 fail-open 降级通道（下方 FR-004 收窄段 → transcriptDiagnostics
  //     feature-dir-unresolvable → runHook 见诊断即 exit 0）逐字保持；
  //   - ambiguous === false 且主候选可用 → 循环体不执行，resolvedPath === candidate.path，
  //     本函数剩余部分与改动前逐字等价；
  //   - ambiguous === false 且主候选不可用 → 改动前必然是"特性目录/诊断报告缺失"类 exit 2 阻断，
  //     兜底后要么仍阻断（missing 原因可能不同，仍是 exit 2），要么转为放行。
  // 反面教训（必须保留此约束的原因）：若允许 ambiguous === true 时也兜底，被选中的历史候选
  // 可能 usable（有 fix-report.md）却不足以通过完整合规判定（本仓库 48 个含 fix-report.md 的
  // 历史 NNN-fix-* 目录中有 21 个没有 verification/verification-report.md），
  // 于是 featureDirUndetermined 由真变假 → 不再早退 → compliant:false → routeBlock → exit 2，
  // 把今天的 exit 0 放行反转为新增误阻断，正是本次要修的那类缺陷。
  //
  // 限界三（范围说明）：本次修复只覆盖"主候选被幽灵路径覆写、指向磁盘上不存在的目录"这一支。
  // 由 transcript 中伪造的 `mv` 文本导致 ambiguous=true 从而落入 F224 fail-open 的另一支
  // **不在本次范围**（介入它必然引入新的误阻断），已另开独立跟进项。
  const usable = (dir) => dir !== null && readArtifactFile(projectRoot, `${dir}/fix-report.md`).exists;
  let resolvedPath = candidate.path;
  if (candidate.ambiguous === false && !usable(resolvedPath)) {
    const history = Array.isArray(candidate.candidates) ? candidate.candidates : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (usable(history[i])) {
        resolvedPath = history[i];
        break;
      }
    }
    // 循环内一个都没命中 → resolvedPath 保持初值 candidate.path（含 null）：完全回落现状
  }

  // F224 FR-004/FR-005：候选目录确已失效但新位置无法机械定位（如改名到非 NNN-fix-<name> 目录）。
  // 这只让**特性目录这一个维度**变得不确定，绝不意味着其余判据也无从判断——
  // 因此这里只记标记，不早退：委派抽取与 judgeCompliance 必须照常跑完（见下方 FR-004 收窄段）。
  const featureDirUndetermined = resolvedPath === null && candidate.ambiguous === true;

  const delegations = extractDelegationsAfter(entries, anchor.anchorLineIndex);
  const featureDirCheck = checkFeatureDirOnDisk(projectRoot, resolvedPath);
  const fixReport = resolvedPath
    ? readArtifactFile(projectRoot, `${resolvedPath}/fix-report.md`)
    : { exists: false, content: null, nonEmpty: false };
  const verificationReport = resolvedPath
    ? readArtifactFile(projectRoot, `${resolvedPath}/verification/verification-report.md`)
    : { exists: false, content: null, nonEmpty: false };

  // F216：只分类一次 closure（AD-4 正交结构），据 hasNoopAnchor 决定是否提取执行证据，
  // 并把 closure 透传 judgeCompliance 避免 evaluate/judge 重复分类（plan I8）。
  const closure = fixReport.exists
    ? classifyClosureForm(fixReport.content)
    : { closureForm: 'undetermined', hasRepairAnchor: false, hasNoopAnchor: false };
  // no-op 锚点分支才配对 fix 锚点后窗口的 Bash 执行证据；纯 repair（hasNoopAnchor=false）零介入（FR-007）
  const executionRecords = closure.hasNoopAnchor
    ? extractExecutionRecordsAfter(entries, anchor.anchorLineIndex)
    : [];

  const verdict = judgeCompliance({
    delegations,
    featureDir: { path: resolvedPath, existsOnDisk: featureDirCheck.existsOnDisk },
    fixReport: { exists: fixReport.exists, content: fixReport.content },
    verificationReport: { exists: verificationReport.exists, nonEmpty: verificationReport.nonEmpty },
    closure,
    executionRecords,
    enforcement,
    configDegraded,
    diagnostics: configDiagnostics,
  });

  // F224 CRITICAL 收窄（Phase 5 后修复轮）：fail-open 必须**按维度**生效，不得整体短路。
  // 早前实现在 judge 之前直接 return，等于用"目录无法定位"一并赦免了与目录解析无关的委派证据要求，
  // 于是只要多敲一条 `git mv <候选> <非规范名>`，零委派的坍塌会话也能把 exit 2 变成 exit 0——
  // 直接击穿 F208 设立本门禁的目的。收窄口径：
  //   委派证据本身已足以证明坍塌（implement 与 verify 均为 0，无论制品落在哪个目录都构不成一次合规收口）
  //   → 维持阻断，按既有 missing 语义输出；
  //   仅当存在收口类委派、唯一不确定的确实是"制品落在哪个目录"时 → 才走 degraded 放行。
  const counts = verdict.delegationCounts;
  const hasClosureDelegation = counts.implement > 0 || counts.verify > 0;
  if (featureDirUndetermined && hasClosureDelegation) {
    return {
      enforcement, configDegraded, isFix: true, mode: anchor.mode,
      transcriptDiagnostics: ['feature-dir-unresolvable'], verdict: null,
    };
  }

  return {
    enforcement, configDegraded, isFix: true, mode: anchor.mode,
    transcriptDiagnostics: [], verdict,
  };
}

// ────────────────────────────────────────
// FR-010 反馈文本机械拼装（core 常量拼装，非自由生成）
// ────────────────────────────────────────

/**
 * 由 missing 枚举拼装反馈文本：稳定动作行 + 双路径指引。
 * @param {string[]} missing
 * @param {{ degraded?:boolean, diagnostics?:string[] }} [opts]
 */
export function buildFeedbackText(missing, opts = {}) {
  const actionLines = (Array.isArray(missing) ? missing : [])
    .map((key) => MISSING_ACTION_TEXT[key])
    .filter(Boolean);
  const segments = [];
  if (opts.degraded) segments.push(GATE_DEGRADED_PREFIX_LINE);
  segments.push(...actionLines);
  segments.push('', DUAL_PATH_GUIDANCE);
  if (Array.isArray(opts.diagnostics) && opts.diagnostics.length > 0) {
    segments.push('', `诊断: ${opts.diagnostics.join(', ')}`);
  }
  return segments.join('\n');
}

// ────────────────────────────────────────
// 审计事件构造（contracts/fix-compliance-verdict-event.schema.json）
// ────────────────────────────────────────

function buildAuditEvent({ sessionId, enforcement, verdict, blockCount, degraded, extraDiagnostics }) {
  const diag = new Set([
    ...((verdict && verdict.diagnostics) || []),
    ...(extraDiagnostics || []),
  ]);
  return {
    schemaVersion: 1,
    eventType: 'fix-compliance-verdict',
    recordedAt: new Date().toISOString(),
    sessionId,
    enforcement,
    closureForm: verdict ? verdict.closureForm : 'undetermined',
    compliant: verdict ? verdict.compliant : null,
    missing: verdict ? verdict.missing : [],
    blockCount: enforcement === 'block' ? (typeof blockCount === 'number' ? blockCount : null) : null,
    degraded: Boolean(degraded),
    diagnostics: [...diag],
  };
}

// ────────────────────────────────────────
// hook 模式路由（阻断 / 警告 / 降级放行）
// ────────────────────────────────────────

/**
 * 处理不合规 + block 档：阻断计数路由（FR-006 有界化）。
 * @returns {number} 退出码
 */
function routeBlock(projectRoot, sessionId, verdict) {
  const loaded = loadBlockState(projectRoot, sessionId);
  const count = loaded.blockCount;

  if (count < BLOCK_LIMIT) {
    // 未达上限：尝试持久化 N+1 → 成功则硬阻断，失败（存储不可用）则等同已达上限降级放行
    const nextCount = count + 1;
    const saved = saveBlockState(projectRoot, sessionId, {
      blockCount: nextCount,
      degradedRecorded: loaded.degradedRecorded,
    });
    if (saved.ok) {
      appendAuditEvent(projectRoot, buildAuditEvent({
        sessionId, enforcement: 'block', verdict, blockCount: nextCount, degraded: false,
      }));
      process.stderr.write(`${PREFIX_BLOCK} ${buildFeedbackText(verdict.missing)}\n`);
      return 2;
    }
    // 存储不可用 → 无法可靠维持计数，按等同"已达上限"降级放行（research.md D2）
    return releaseDegraded(projectRoot, sessionId, verdict, {
      alreadyRecorded: false,
      storageUnavailable: true,
    });
  }

  // 已达上限（count >= 2）→ 降级放行
  return releaseDegraded(projectRoot, sessionId, verdict, {
    alreadyRecorded: loaded.degradedRecorded,
    storageUnavailable: false,
  });
}

/**
 * 降级放行：exit 0 + [GATE-DEGRADED] reason + 幂等终态双写（首次）或轻量审计（重复）。
 * @returns {number} 恒 0
 */
function releaseDegraded(projectRoot, sessionId, verdict, { alreadyRecorded, storageUnavailable }) {
  const extraDiagnostics = storageUnavailable ? ['state-storage-unavailable'] : [];
  const blockCount = BLOCK_LIMIT;
  // 存储不可用无法读写幂等标记 → 允许重复终态（宁可可审计不可静默丢失，research.md D2/D4）
  const shouldWriteTerminal = storageUnavailable || !alreadyRecorded;

  if (shouldWriteTerminal) {
    try {
      recordWorkflowRun({
        projectRoot,
        workflowId: 'spec-driver-fix',
        runId: sessionId,
        result: 'failed',
        warnings: [`${PREFIX_DEGRADED} fix 会话在 ${BLOCK_LIMIT + 1} 次不合规尝试后降级放行，缺失: ${verdict.missing.join(', ')}`],
        complianceVerdict: {
          closureForm: verdict.closureForm,
          compliant: verdict.compliant,
          missing: verdict.missing,
          degraded: true,
          blockCount,
        },
      });
    } catch {
      // 终态写入失败不得让降级路由崩溃（FR-013 精神）
    }
    // 首次降级成功后置幂等标记（存储可用时才有意义）
    if (!storageUnavailable) {
      saveBlockState(projectRoot, sessionId, { blockCount, degradedRecorded: true });
    }
  }

  appendAuditEvent(projectRoot, buildAuditEvent({
    sessionId, enforcement: 'block', verdict, blockCount, degraded: true, extraDiagnostics,
  }));
  process.stderr.write(`${PREFIX_DEGRADED} ${buildFeedbackText(verdict.missing, { degraded: true, diagnostics: extraDiagnostics })}\n`);
  return 0;
}

/**
 * FR-013 fail-open 的 loud 半边：判定能力失效时 best-effort 落盘 degraded 诊断事件，
 * 使"漏拦"在事后审计中可被发现而非彻底隐没。写入自身失败不得影响放行（双重兜底）。
 */
function tryAppendFailOpenEvent(projectRoot, sessionId, enforcement, diagnostics, configDiagnostics = []) {
  try {
    // 合并配置层诊断（如 config-degraded）——配置非法与判定异常同时发生时两类信息都不得丢失
    // （codex implement 审查 W-2，FR-015 可追溯性）
    const merged = [...new Set([
      ...(Array.isArray(configDiagnostics) ? configDiagnostics : []),
      ...(Array.isArray(diagnostics) ? diagnostics : []),
    ])];
    appendAuditEvent(projectRoot, {
      schemaVersion: 1,
      eventType: 'fix-compliance-verdict',
      recordedAt: new Date().toISOString(),
      sessionId: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : 'unknown',
      enforcement: enforcement === 'warn' ? 'warn' : 'block',
      closureForm: 'undetermined',
      compliant: null,
      missing: [],
      blockCount: null,
      degraded: true,
      diagnostics: merged,
    });
  } catch {
    // 诊断落盘失败不得让 fail-open 路径崩溃
  }
}

/**
 * hook 模式主路由。
 * @returns {number} 退出码
 */
function runHook(projectRoot, payload) {
  // FR-015 判定顺序：(1) 非抛出式配置解析 →(2) off 立即零接触退出（在任何 transcript 读取之前）
  const cfg = findAndParseConfig(projectRoot);
  if (cfg.enforcement === 'off') return 0;

  const result = evaluate(projectRoot, payload.transcript_path, cfg);

  // transcript 不可用/超限 → FR-013 fail-open 放行 + loud 诊断落盘（合并配置层诊断）
  if (result.transcriptDiagnostics.length > 0) {
    tryAppendFailOpenEvent(projectRoot, payload.session_id, cfg.enforcement, result.transcriptDiagnostics, cfg.diagnostics);
    return 0;
  }
  // 非 fix 会话 → 零接触放行（US5：健康路径不产生任何落盘），不 reset 保持零落盘语义
  if (!result.isFix || !result.verdict) return 0;
  // 合规 → 重置该 session 阻断状态（补救成功清零转移，FR-006 增补）后静默放行。
  // 无条件调用（不区分 block/warn）：warn 档从不 bump 计数、其状态文件本就不存在，
  // reset 对其为空操作；off 档已在函数入口短路，永不触达此分支。
  if (result.verdict.compliant) {
    resetBlockState(projectRoot, payload.session_id);
    return 0;
  }

  const sessionId = payload.session_id;

  if (result.enforcement === 'warn') {
    appendAuditEvent(projectRoot, buildAuditEvent({
      sessionId, enforcement: 'warn', verdict: result.verdict, blockCount: null, degraded: false,
    }));
    process.stderr.write(`${PREFIX_WARN} ${buildFeedbackText(result.verdict.missing)}\n`);
    return 0;
  }

  // enforcement=block
  return routeBlock(projectRoot, sessionId, result.verdict);
}

// ────────────────────────────────────────
// report 模式（只读，恒 exit 0，仅 stdout verdict JSON）
// ────────────────────────────────────────

function runReport(projectRoot, transcriptPath) {
  const result = evaluate(projectRoot, transcriptPath);
  const out = {
    mode: result.mode,
    fixSession: result.isFix,
    enforcement: result.enforcement,
    configDegraded: result.configDegraded,
    transcriptDiagnostics: result.transcriptDiagnostics,
    ...(result.verdict || {}),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  return 0;
}

// ────────────────────────────────────────
// main（顶层 try/catch 兜底 FR-013）
// ────────────────────────────────────────

export function main(argv, stdinRaw) {
  const args = parseArgs(argv);
  try {
    if (args.mode === 'report') {
      // report 优先用 --transcript-path，缺省时回落 stdin payload
      let transcriptPath = args.transcriptPath;
      if (!transcriptPath) {
        const parsed = readHookPayload(stdinRaw);
        transcriptPath = parsed.ok ? parsed.payload.transcript_path : null;
      }
      return runReport(args.projectRoot, transcriptPath);
    }
    // hook 模式：stdin payload 必需
    const parsed = readHookPayload(stdinRaw);
    if (!parsed.ok) {
      // payload 非法 → FR-013 fail-open 放行 + loud 诊断落盘（off 档除外，维持零接触）
      const cfg = findAndParseConfig(args.projectRoot);
      if (cfg.enforcement !== 'off') {
        tryAppendFailOpenEvent(args.projectRoot, null, cfg.enforcement, ['payload-invalid'], cfg.diagnostics);
      }
      return 0;
    }
    return runHook(args.projectRoot, parsed.payload);
  } catch {
    // 任何未预期异常 → fail-open 放行（FR-013）+ best-effort loud 诊断（自身再失败则彻底静默放行）
    try {
      const cfg = findAndParseConfig(args.projectRoot);
      if (cfg.enforcement !== 'off') {
        tryAppendFailOpenEvent(args.projectRoot, null, cfg.enforcement, ['internal-error'], cfg.diagnostics);
      }
    } catch {
      // 连诊断都写不了 → 仍然放行
    }
    return 0;
  }
}

// 仅作为入口脚本直接运行时执行（被 import 时不触发，便于单测）
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const argv = process.argv.slice(2);
  const stdinRaw = readStdinSync();
  const code = main(argv, stdinRaw);
  process.exit(code);
}
