/**
 * fix-compliance-io.mjs
 * Feature 208 — fix 依从性判定 I/O 边界（全部 fs 操作聚于此，分层参照 goal-loop-cli.mjs）
 *
 * 本文件承载：payload 解析 / transcript 读取 / 配置读取 / 审计事件落盘 / 特性目录磁盘核验。
 * BlockCountState 读写（loadBlockState/saveBlockState）由 T023 追加，刻意不在本文件初版实现
 * （避免与 US4 任务边界重叠）。
 *
 * 关键契约（contracts/fix-compliance-config-field.md）：判定路径**不 import config-schema.mjs**，
 * 改用零依赖的 simple-yaml.mjs parseYamlDocument 做非抛出式配置读取，杜绝拉入 zod 间接依赖链。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYamlDocument } from './simple-yaml.mjs';
import { normalizeTranscriptEntry, resolveEnforcementFromConfig } from './fix-compliance-core.mjs';

/**
 * transcript 体积上限（research.md D6 / T001 校准：实测 fix 会话 ≤0.31MB，20MB≈60 倍余量）。
 * 超限即判 transcript-too-large 走 FR-013 fail-open，作为主要性能防线（不引入运行时熔断）。
 */
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

// ────────────────────────────────────────
// payload 组
// ────────────────────────────────────────

/**
 * 解析 Stop hook stdin payload（data-model.md §1），非抛出式。
 * @param {string} stdinRaw
 * @returns {{ ok:boolean, payload:object|null, diagnostics:string[] }}
 */
export function readHookPayload(stdinRaw) {
  let parsed;
  try {
    parsed = JSON.parse(typeof stdinRaw === 'string' ? stdinRaw : '');
  } catch {
    return { ok: false, payload: null, diagnostics: ['payload-invalid'] };
  }
  const sessionId = parsed && parsed.session_id;
  const transcriptPath = parsed && parsed.transcript_path;
  if (typeof sessionId !== 'string' || sessionId.length === 0
    || typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return { ok: false, payload: null, diagnostics: ['payload-invalid'] };
  }
  return { ok: true, payload: parsed, diagnostics: [] };
}

// ────────────────────────────────────────
// transcript 组
// ────────────────────────────────────────

/**
 * 读取并逐行解析 transcript JSONL（data-model.md §2）。非抛出式 + 逐行容错。
 * @param {string} transcriptPath
 * @param {number} [maxBytes=MAX_TRANSCRIPT_BYTES] - 体积上限（可注入以便测试）
 * @returns {{ entries:object[], diagnostics:string[] }}
 */
export function readTranscriptEntries(transcriptPath, maxBytes = MAX_TRANSCRIPT_BYTES) {
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return { entries: [], diagnostics: ['transcript-unavailable'] };
  }
  if (!stat.isFile()) {
    return { entries: [], diagnostics: ['transcript-unavailable'] };
  }
  if (stat.size > maxBytes) {
    return { entries: [], diagnostics: ['transcript-too-large'] };
  }
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return { entries: [], diagnostics: ['transcript-unavailable'] };
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const entries = lines.map((line, index) => {
    try {
      return normalizeTranscriptEntry(JSON.parse(line), index, false);
    } catch {
      // 单行损坏不中断整体解析（data-model.md §2 parseError 语义）
      return normalizeTranscriptEntry(null, index, true);
    }
  });
  // 全损坏（非空行存在且全部解析失败）= FR-013 的"格式不可识别"：不能静默当非 fix 会话放行，
  // 必须走 fail-open + loud 诊断路径（codex implement 审查 C-1）。部分损坏维持逐行容错。
  if (entries.length > 0 && entries.every((entry) => entry.parseError)) {
    return { entries: [], diagnostics: ['transcript-unavailable'] };
  }
  return { entries, diagnostics: [] };
}

// ────────────────────────────────────────
// config 组（FR-015 三步顺序，非抛出式，不经 zod）
// ────────────────────────────────────────

/** 查找配置文件：projectRoot 优先，其次 .specify/ 下 */
function findConfigFile(projectRoot) {
  const primary = path.join(projectRoot, 'spec-driver.config.yaml');
  if (fs.existsSync(primary)) return primary;
  const fallback = path.join(projectRoot, '.specify', 'spec-driver.config.yaml');
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

/**
 * 读取并解析 fix_compliance.enforcement（fix-compliance-config-field.md 三步序）。
 * 类型化区分三态：缺失（默认非降级）/ 损坏或非法值（降级）/ 合法（采用）；
 * 禁止 catch-all 合并"配置错误"与"判定异常"——本函数只吞配置层解析异常。
 * @param {string} projectRoot
 * @returns {{ found:boolean, parseFailed:boolean, config:object|null, enforcement:string, configDegraded:boolean, diagnostics:string[] }}
 */
export function findAndParseConfig(projectRoot) {
  const configPath = findConfigFile(projectRoot);
  if (!configPath) {
    const resolved = resolveEnforcementFromConfig({ found: false, parseFailed: false, config: null });
    return { found: false, parseFailed: false, config: null, ...resolved, diagnostics: [] };
  }
  let config = null;
  let parseFailed = false;
  try {
    config = parseYamlDocument(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // 仅捕获配置文件读取/解析异常（读目录 EISDIR、权限等）→ 归约为 parseFailed（损坏）
    parseFailed = true;
  }
  const resolved = resolveEnforcementFromConfig({ found: true, parseFailed, config });
  const diagnostics = resolved.configDegraded ? ['config-degraded'] : [];
  return { found: true, parseFailed, config, ...resolved, diagnostics };
}

// ────────────────────────────────────────
// audit 组
// ────────────────────────────────────────

/**
 * 追加审计事件到 .specify/runs/YYYY-MM.jsonl（与 record-workflow-run.mjs 同目录/命名约定）。
 * 非抛出式：写入失败返回 ok:false（FR-013 精神，落盘失败不得让判定崩溃）。
 * @param {string} projectRoot
 * @param {object} event
 * @returns {{ ok:boolean, path:string|null }}
 */
export function appendAuditEvent(projectRoot, event) {
  try {
    const runsDir = path.join(projectRoot, '.specify', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    const month = new Date().toISOString().slice(0, 7);
    const targetFile = path.join(runsDir, `${month}.jsonl`);
    fs.appendFileSync(targetFile, `${JSON.stringify(event)}\n`, 'utf8');
    return { ok: true, path: targetFile };
  } catch {
    return { ok: false, path: null };
  }
}

// ────────────────────────────────────────
// featureDir 组（磁盘核验才是判据，提名只是候选）
// ────────────────────────────────────────

/**
 * 校验特性目录候选是否真实存在于磁盘（research.md D1：提名≠判据）。
 * @param {string} projectRoot
 * @param {string|null} relPath - resolveFeatureDirCandidate 提名的相对路径
 * @returns {{ existsOnDisk:boolean }}
 */
export function checkFeatureDirOnDisk(projectRoot, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return { existsOnDisk: false };
  }
  try {
    const full = path.join(projectRoot, relPath);
    return { existsOnDisk: fs.existsSync(full) && fs.statSync(full).isDirectory() };
  } catch {
    return { existsOnDisk: false };
  }
}

/**
 * 读取制品文件内容（ArtifactCheckResult 的磁盘侧输入，data-model.md §6）。
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {{ exists:boolean, content:string|null, nonEmpty:boolean }}
 */
export function readArtifactFile(projectRoot, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return { exists: false, content: null, nonEmpty: false };
  }
  try {
    const full = path.join(projectRoot, relPath);
    const stat = fs.statSync(full);
    if (!stat.isFile()) return { exists: false, content: null, nonEmpty: false };
    const content = fs.readFileSync(full, 'utf8');
    return { exists: true, content, nonEmpty: content.replace(/\s/g, '').length > 0 };
  } catch {
    return { exists: false, content: null, nonEmpty: false };
  }
}

// ────────────────────────────────────────
// BlockCountState 组（T023，FR-006 阻断计数持久态；data-model.md §8 + research.md D2/D4）
// ────────────────────────────────────────

/** 阻断计数状态主目录（相对 projectRoot）：.specify/runs/ 已被仓库既有 .gitignore 整段忽略 */
const STATE_SUBDIR = ['.specify', 'runs', '.fix-compliance-state'];
/** tmpdir 降级子目录名 */
const STATE_TMP_SUBDIR = 'spec-driver-fix-compliance';

/**
 * tmpdir 降级基路径。支持 env 覆盖以便测试模拟"两级存储均不可用"。
 * @returns {string}
 */
function stateTmpBase() {
  const override = process.env.SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP;
  return typeof override === 'string' && override.length > 0 ? override : os.tmpdir();
}

/**
 * session_id 白名单化清洗（research.md D2 [REVISED]）：仅保留 [A-Za-z0-9._-]，
 * 其余替换为 _；清洗后为空用 unknown-session。杜绝路径穿越/非法文件名。
 * @param {string} sessionId
 * @returns {string}
 */
export function sanitizeSessionId(sessionId) {
  const raw = typeof sessionId === 'string' ? sessionId : '';
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'unknown-session';
}

/** 主存储文件绝对路径 */
function primaryStatePath(projectRoot, sanitizedId) {
  return path.join(projectRoot, ...STATE_SUBDIR, `${sanitizedId}.json`);
}

/** tmpdir 降级文件绝对路径 */
function tmpStatePath(sanitizedId) {
  return path.join(stateTmpBase(), STATE_TMP_SUBDIR, `${sanitizedId}.json`);
}

/** 归一化磁盘读到的状态对象（缺字段按默认，向后兼容） */
function normalizeState(sessionId, parsed) {
  const src = parsed && typeof parsed === 'object' ? parsed : {};
  const blockCount = Number.isInteger(src.blockCount) && src.blockCount >= 0 ? src.blockCount : 0;
  return {
    sessionId,
    blockCount,
    // 历史文件缺 degradedRecorded 字段 → 按 false（向后兼容，data-model.md §8）
    degradedRecorded: src.degradedRecorded === true,
  };
}

/**
 * 读取阻断计数状态（主路径优先，回落 tmpdir）。文件缺失/损坏均按初始态返回（blockCount 0）。
 * load 不区分"存储不可用"——不可用信号由 saveBlockState 在写入时暴露（research.md D2）。
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {{ sessionId:string, blockCount:number, degradedRecorded:boolean }}
 */
export function loadBlockState(projectRoot, sessionId) {
  const sanitizedId = sanitizeSessionId(sessionId);
  for (const filePath of [primaryStatePath(projectRoot, sanitizedId), tmpStatePath(sanitizedId)]) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return normalizeState(sanitizedId, JSON.parse(raw));
    } catch {
      // 文件缺失/损坏/不可读 → 尝试下一路径
    }
  }
  return normalizeState(sanitizedId, null);
}

/** 尝试写单一路径，成功返回 true */
function tryWriteState(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 持久化阻断计数状态（主路径失败降级 tmpdir，两级均失败 → state-storage-unavailable）。
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {{ blockCount:number, degradedRecorded:boolean }} state
 * @returns {{ ok:boolean, path:string|null, degraded:boolean, diagnostics:string[] }}
 */
export function saveBlockState(projectRoot, sessionId, state) {
  const sanitizedId = sanitizeSessionId(sessionId);
  const payload = {
    sessionId: sanitizedId,
    blockCount: Number.isInteger(state && state.blockCount) && state.blockCount >= 0 ? state.blockCount : 0,
    degradedRecorded: Boolean(state && state.degradedRecorded),
    updatedAt: new Date().toISOString(),
  };

  const primary = primaryStatePath(projectRoot, sanitizedId);
  if (tryWriteState(primary, payload)) {
    return { ok: true, path: primary, degraded: false, diagnostics: [] };
  }
  const fallback = tmpStatePath(sanitizedId);
  if (tryWriteState(fallback, payload)) {
    return { ok: true, path: fallback, degraded: true, diagnostics: [] };
  }
  return { ok: false, path: null, degraded: true, diagnostics: ['state-storage-unavailable'] };
}

/**
 * 重置阻断计数状态（FR-006 增补：补救成功后的清零转移）。
 * 删除两级存储（主路径 + tmpdir 回落）中该 session 对应的状态文件，
 * 与"从未被阻断"状态同构——blockCount 与 degradedRecorded 一并归位，无字段级歧义。
 * 尽力而为、非抛出式：文件不存在（本就未阻断过）或删除失败均静默忽略，
 * 不产生可失败传播的下游（与 sweep 同为旁路维护语义，不同于 saveBlockState 需暴露
 * state-storage-unavailable 诊断——reset 失败的最坏后果只是"旧计数残留"，
 * 不影响本次放行判定，无需诊断落盘）。
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {void}
 */
export function resetBlockState(projectRoot, sessionId) {
  const sanitizedId = sanitizeSessionId(sessionId);
  // 两级都无条件尝试删除：不因主路径删除失败就跳过 tmpdir，否则 load 会回落读到
  // tmpdir 残留旧计数导致清零失效（fix-report 影响范围扫描：重置必须两级都清）。
  for (const filePath of [primaryStatePath(projectRoot, sanitizedId), tmpStatePath(sanitizedId)]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // 文件不存在 / 不可删 → 忽略（尽力而为，缺一级不影响另一级清除）
    }
  }
}
