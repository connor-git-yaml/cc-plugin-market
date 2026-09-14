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
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parseYamlDocument } from './simple-yaml.mjs';
import { normalizeTranscriptEntry, resolveEnforcementFromConfig, FIX_DIR_NAME_REGEX } from './fix-compliance-core.mjs';

/**
 * transcript 体积上限（research.md D6 / T001 校准：实测 fix 会话 ≤0.31MB，20MB≈60 倍余量）。
 * 超限即判 transcript-too-large 走 FR-013 fail-open，作为主要性能防线（不引入运行时熔断）。
 */
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

/**
 * io 层诊断码 canonical 表（F287 卡 A · G0 补：两路对抗复审均指出 io 仍裸发字面量、不在任何表内，
 * T0-U2 的 ⊆ schema 守卫覆盖不到）。payload-invalid 的真实产出点在 judge（readHookPayload 的 diagnostics
 * 返回值 judge 不消费，此处引用同一表项只为单源）。
 */
export const IO_DIAGNOSTICS = Object.freeze({
  payloadInvalid: 'payload-invalid',
  transcriptPathAbsent: 'transcript-path-absent',
  transcriptUnavailable: 'transcript-unavailable',
  transcriptTooLarge: 'transcript-too-large',
  configDegraded: 'config-degraded',
});

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
    return { ok: false, payload: null, diagnostics: [IO_DIAGNOSTICS.payloadInvalid] };
  }
  const sessionId = parsed && parsed.session_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { ok: false, payload: null, diagnostics: [IO_DIAGNOSTICS.payloadInvalid] };
  }
  // F240 FR-004：transcript_path 在 Codex 的 Stop payload schema 中是 nullable。缺席/为 null 的
  // payload 结构合法，判 payload-invalid 会给出误导性诊断（看着像 payload 坏了，其实只是没给路径）。
  // 放宽到"可缺席"，由下游 readTranscriptEntries 产出语义精确的 transcript-path-absent；
  // 类型非法（既非字符串又非 null）仍是真正的结构错误，维持 payload-invalid。
  const transcriptPath = parsed.transcript_path;
  if (transcriptPath !== undefined && transcriptPath !== null && typeof transcriptPath !== 'string') {
    return { ok: false, payload: null, diagnostics: [IO_DIAGNOSTICS.payloadInvalid] };
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
  // F240 FR-004：路径压根没给 与 路径给了却读不到 是两种不同的失效，诊断码必须可区分
  // （transcript-path-absent vs transcript-unavailable）。两者退出码同为 0，只是诊断更精确。
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return { entries: [], diagnostics: [IO_DIAGNOSTICS.transcriptPathAbsent] };
  }
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return { entries: [], diagnostics: [IO_DIAGNOSTICS.transcriptUnavailable] };
  }
  if (!stat.isFile()) {
    return { entries: [], diagnostics: [IO_DIAGNOSTICS.transcriptUnavailable] };
  }
  if (stat.size > maxBytes) {
    return { entries: [], diagnostics: [IO_DIAGNOSTICS.transcriptTooLarge] };
  }
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return { entries: [], diagnostics: [IO_DIAGNOSTICS.transcriptUnavailable] };
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
    return { entries: [], diagnostics: [IO_DIAGNOSTICS.transcriptUnavailable] };
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
  const diagnostics = resolved.configDegraded ? [IO_DIAGNOSTICS.configDegraded] : [];
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
 * 按 short-name 枚举 `specs/` 下形如 `NNN-fix-<shortName>` 的目录（F256 盲区 1）。
 *
 * 存在理由：改名跟随只有 transcript 一条事实源，复合命令重编号后候选会停在磁盘上已消失的旧编号。
 * 本函数提供 judge 层重锚定所需的**磁盘侧**枚举能力——core 是纯函数层，磁盘判据必须落在 io。
 *
 * 只读一层 `specs/` 目录项做字面量后缀比对：一次 `readdirSync`，无递归、无 glob 引擎、非全仓扫描。
 * 开销随 `specs/` 目录项数**线性**（不是常数——措辞勿再写成常数级），且与 transcript 规模、
 * 候选历史长度均无关，因此不构成按攻击者可控输入增长的扫描面（判定器跑在同步 Stop hook 上，
 * F227/F231 有 O(N²) 与灾难性回溯的 DoS 前科）。
 *
 * 用 `endsWith` 字面量比对 + 数字前缀校验而非动态构造正则：`shortName` 来自用户可控的 transcript
 * 文本，字符串操作天然规避正则元字符转义问题，且"是否可能误配"更易人眼审计。
 *
 * 非抛出式：`specs/` 缺失/不可读均返回空数组。本函数**只枚举不核验制品**——
 * "含 fix-report.md 才采信"的判据留在 judge 的 usable() 谓词，与 F227 兜底同源。
 * @param {string} projectRoot
 * @param {string} shortName - 已由 extractFixShortName 抽取的 <short> 段
 * @returns {string[]} 匹配目录相对路径（`specs/NNN-fix-<shortName>`），按编号升序排列
 */
export function listFeatureDirCandidatesByShortName(projectRoot, shortName) {
  if (typeof shortName !== 'string' || shortName.length === 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(projectRoot, 'specs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const suffix = `-fix-${shortName}`;
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!name.endsWith(suffix)) continue;
    const numPart = name.slice(0, name.length - suffix.length);
    if (!/^\d+$/.test(numPart)) continue;
    matches.push({ num: Number(numPart), relPath: `specs/${name}` });
  }
  // 按编号数值升序（非字典序）：judge 侧「取编号最大者」直接取末项，排序语义是其正确性前提
  matches.sort((a, b) => a.num - b.num);
  return matches.map((m) => m.relPath);
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

/**
 * io 侧诊断码表（F287 卡 A · G0）：`state-storage-unavailable` 由本模块（两级存储均不可写）**首发**，
 * judge 侧三处复用同一码时一律引用本表，不在 `JUDGE_DIAGNOSTICS` 重复登记（两表各持一份 = 新的漂移面）。
 * 可见性（是否进用户 stderr）由 judge 的 `USER_FACING_DIAGNOSTIC_CODES` 统一裁定，本表不带 userFacing 列。
 */
export const STATE_STORAGE_DIAGNOSTICS = Object.freeze({
  unavailable: 'state-storage-unavailable',
  // F288 卡 B · G1：锁不可得（有界重试耗尽 ⟹ 降级为无锁 RMW = 改动前行为，不改裁决方向）/ 陈旧锁被接管
  lockUnavailable: 'state-lock-unavailable',
  lockTakenOver: 'state-lock-taken-over',
});

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

/**
 * F291a（M11 卡 B · 方案①′）：阻断预算按 **目标** 记账的桶键。
 *
 * 状态文件仍是每会话一份 `<sid>.json`（锁也按会话），文件内 `targets[<桶键>]` 分目标记 blockCount /
 * degradedRecorded / nonBlockStopCount / lastCountedFingerprint；`inFlightDeferCount` 是会话属性留在顶层。
 * 桶键 = 规范化后的 fix 目标目录字面量（`specs/NNN-fix-<name>`）：
 *   - 先 trim / `\`→`/` / `path.posix.normalize`（吞掉 `./`、`//`、`a/../`）/ 去尾斜杠，再过 FIX_DIR_NAME_REGEX；
 *   - 不合规范形态 / 空 / 非字符串 ⇒ `NO_TARGET_BUDGET_KEY`——「定位不到目标」的轮次有自己的桶，**绝不**向任何具名目标捐赠预算。
 * why 不再用 sha256 前 8 位（对抗审查 C-1）：32 bit 可离线碰撞（实测 4.4 分钟），且被判方可影响键的输入（Tier 2 sidechain
 * 标记的 candidatePath）；字面量键 + 规范化让 `specs/<垃圾>/../302-fix-b` 落回 B 自己的桶。
 * why 不再复合文件名（对抗审查 C-2 / C-3）：复合文件让「合规清零」只清当前目标、兄弟桶残留（回到 A 首次即 0 往返放行）；
 * 裸 sid 兜底文件由判定器自己产生、又被每个目标回落读到（万能捐赠者）；session 级的在途推迟预算也被按目标放大 N 倍。
 * @param {unknown} targetDir
 * @returns {string}
 */
export const NO_TARGET_BUDGET_KEY = '__no-target__';

export function targetBudgetKey(targetDir) {
  if (typeof targetDir !== 'string') return NO_TARGET_BUDGET_KEY;
  let normalized = targetDir.trim().replace(/\\/g, '/');
  if (normalized.length === 0) return NO_TARGET_BUDGET_KEY;
  normalized = path.posix.normalize(normalized).replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  return FIX_DIR_NAME_REGEX.test(normalized) ? normalized : NO_TARGET_BUDGET_KEY;
}

/** 规范 fix 目录字面量（`specs/NNN-fix-<name>`），不合规范返回 null——sidechain 标记 candidatePath 的读侧校验用。 */
export function canonicalFixDirPath(value) {
  const key = targetBudgetKey(value);
  return key === NO_TARGET_BUDGET_KEY ? null : key;
}

const HEX64_RE = /^[0-9a-f]{64}$/;

/** 单个目标桶的归一化（缺字段按默认，向后兼容） */
function normalizeTargetBudget(src) {
  const s = src && typeof src === 'object' ? src : {};
  return {
    blockCount: Number.isInteger(s.blockCount) && s.blockCount >= 0 ? s.blockCount : 0,
    degradedRecorded: s.degradedRecorded === true,
    nonBlockStopCount: Number.isInteger(s.nonBlockStopCount) && s.nonBlockStopCount >= 0 ? s.nonBlockStopCount : 0,
    lastCountedFingerprint: typeof s.lastCountedFingerprint === 'string' && HEX64_RE.test(s.lastCountedFingerprint) ? s.lastCountedFingerprint : null,
  };
}

/** 读某目标桶（缺席即初始态）。 */
export function targetBudgetOf(state, key) {
  return normalizeTargetBudget(state && state.targets ? state.targets[key] : undefined);
}

/** 写回某目标桶（纯函数，返回新 state）。 */
export function withTargetBudget(state, key, budget) {
  return { ...state, targets: { ...((state && state.targets) || {}), [key]: normalizeTargetBudget(budget) } };
}

/**
 * 预算随目标身份链迁移：当前桶键缺席、而 lineage（同一目标的历史路径：F224 改名跟随的旧名 / F227 候选历史 /
 * F256 短名重锚定前后）里有桶时，把 blockCount 最高的那个桶搬到当前键并删掉 lineage 里其余桶。
 * why：否则每轮合法改名 / 重编号都让桶键漂移、blockCount 永远停在 0 ⇒ 永远拿不到 BLOCK_LIMIT 后的降级逃生口
 * （对抗审查 C-3：光杆 mv 与复合 git mv 两条路径各实测 8 轮零自愈）。取最高而非求和：lineage 各成员是同一目标，
 * 已付的往返只该算一次。
 * @returns {{ state: object, migratedFrom: string|null }}
 */
export function migrateTargetBudget(state, key, lineage = []) {
  const targets = { ...((state && state.targets) || {}) };
  if (targets[key] !== undefined) return { state, migratedFrom: null };
  let best = null;
  for (const k of lineage) {
    if (typeof k !== 'string' || k === key || targets[k] === undefined) continue;
    if (best === null || normalizeTargetBudget(targets[k]).blockCount > normalizeTargetBudget(targets[best]).blockCount) best = k;
  }
  if (best === null) return { state, migratedFrom: null };
  const moved = targets[best];
  for (const k of lineage) if (k !== key) delete targets[k];
  targets[key] = moved;
  return { state: { ...state, targets }, migratedFrom: best };
}

/** 主存储文件绝对路径 */
function primaryStatePath(projectRoot, sanitizedId) {
  return path.join(projectRoot, ...STATE_SUBDIR, `${sanitizedId}.json`);
}

/** tmpdir 降级文件绝对路径 */
function tmpStatePath(sanitizedId) {
  return path.join(stateTmpBase(), STATE_TMP_SUBDIR, `${sanitizedId}.json`);
}

/**
 * 归一化磁盘读到的状态对象（缺字段按默认，向后兼容）。
 *
 * F291a：形状 = `{ sessionId, inFlightDeferCount, targets: { [桶键]: { blockCount, degradedRecorded, nonBlockStopCount,
 * lastCountedFingerprint } } }`。改造前文件的**顶层** blockCount / degradedRecorded / nonBlockStopCount / lastCountedFingerprint
 * 一律**不迁移**（fail-closed 迁移：旧会话最多多付一轮预算；绝不把 session 级预算捐给任何目标——那正是 F289 delta CRITICAL）。
 * `inFlightDeferCount`（F256 在途推迟预算，会话属性）照旧留在顶层。
 * 🔴 各桶字段都在被判方写域：预置计数只能换来再被阻断（放行须 transcript 上 harness 回灌的阻断反馈 ≥ BLOCK_LIMIT，见 judge
 * releaseCorroborated）；`null` lastCountedFingerprint 是「该目标首次」态（G2 路由三分里与「指纹相同」同落 nonBlock 分支）。
 */
function normalizeState(sessionId, parsed) {
  const src = parsed && typeof parsed === 'object' ? parsed : {};
  const targets = {};
  if (src.targets && typeof src.targets === 'object' && !Array.isArray(src.targets)) {
    for (const [key, value] of Object.entries(src.targets)) {
      if (typeof key === 'string' && key.length > 0) targets[key] = normalizeTargetBudget(value);
    }
  }
  return {
    sessionId,
    inFlightDeferCount: Number.isInteger(src.inFlightDeferCount) && src.inFlightDeferCount >= 0
      ? src.inFlightDeferCount
      : 0,
    targets,
  };
}

/**
 * 读取阻断计数状态（主路径优先，回落 tmpdir）。文件缺失/损坏均按初始态返回（blockCount 0）。
 * load 不区分"存储不可用"——不可用信号由 saveBlockState 在写入时暴露（research.md D2）。
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {{ sessionId:string, inFlightDeferCount:number, targets:Record<string, object> }}
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

/**
 * 写单一路径；失败时**抛出**原始 fs 错误，并在其上标注失败阶段。
 *
 * why 抛出而非返回布尔（F276 卡 C）：两级皆败时 stderr 必须告诉用户**哪一级、在哪个阶段、撞了什么错误码、
 * 挡路的是哪个对象**，否则诚实的存储故障用户读完阻断反馈仍不知道该动哪个文件。原先的布尔版把 errno
 * 整个吞掉，`saveBlockState` 无从收集。收集点上移到 `saveBlockState` 的两处 try/catch。
 *
 * `stage` 用不可枚举属性挂在错误对象上：mkdir 与 write 两阶段的 `err.path` 语义不同（见 saveBlockState），
 * 不区分阶段就无法解释渲染出来的那条路径到底是什么。不可枚举是为了不污染错误对象的序列化面。
 *
 * @param {string} filePath
 * @param {object} payload
 * @throws {NodeJS.ErrnoException & { stage:'mkdir'|'write' }}
 */
function writeStateOrThrow(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (err) {
    throw markWriteStage(err, 'mkdir');
  }
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (err) {
    throw markWriteStage(err, 'write');
  }
}

/**
 * 给 fs 错误打上失败阶段标记（非对象类抛出物包装成 Error，保证下游读取不炸）。
 * 标记走不可枚举属性，避免污染错误对象的序列化面。
 *
 * 🔴 `defineProperty` 在**被冻结**的错误对象上会抛 TypeError；若不兜住，`saveBlockState` 捕到的就是
 * 那个 TypeError 而非原始 fs 错误 ⟹ `path/stage/code` 三个字段一起变成 `null` ⟹ 把本特性唯一要
 * 产出的诊断信息静默销毁（诚实故障用户读完 stderr 仍不知道该动哪个文件）。Node 自带 fs 错误不冻结，
 * 生产不可达，但"打标记失败"绝不该反过来吃掉被打标记的对象——失败时按原对象返回，只丢 stage。
 */
function markWriteStage(err, stage) {
  const target = (err && typeof err === 'object') ? err : new Error(String(err));
  try {
    Object.defineProperty(target, 'stage', { value: stage, enumerable: false, configurable: true });
  } catch {
    // 冻结/密封对象：保留原始 errno 与 path，只损失 stage 标注
  }
  return target;
}

/**
 * 把一次写入失败降解成可渲染 / 可审计的描述项。
 *
 * 🔴 `path` **一律取 `err.path`**，不得取传进去的状态文件路径：`writeStateOrThrow` 的 mkdir 建的是
 * `dirname(filePath)`，此时挡路的是**父目录位置的那个对象**（如 `.specify/runs/.fix-compliance-state`
 * 本身是个文件），而状态文件路径指向的是别的对象——渲染错对象会诱导消费者对**审计与终态所在的目录**下手。
 * write 阶段的 `err.path` 才是状态文件本身。Node 在两处均填 `err.path`，直接透传即可。
 *
 * 🔴 `blocker`（IW-2/IM-1 增补）：`err.path` 是**被尝试创建/写入的目标**，`ENOTDIR` 下它本身并不存在
 * ——挡路的是它某一级祖先上的那个非目录对象（如 `.specify/runs` 被占成了文件）。只渲染 `err.path`
 * 会让"删掉挡路物"这条补救口指向一个不存在的路径，与同行的「勿删 .specify/runs 目录」互相矛盾，
 * 唯一正确动作恰好被禁止。故这里沿祖先链探测出**真正该删的那一个对象**单独成字段。
 *
 * 🔴 `blocker` **零判定消费**：与 `code` / `path` 同为解释性字段，只进 stderr 渲染与审计；
 * 判定侧不得读它做分支（否则又给被判方送回一个可构造的输入）。
 *
 * 🔴 已知盲区（登记，不追加防线）：判据用 `existsSync`（跟随软链），故**悬空软链**挡路时探测不到它、
 * 会继续上溯到父目录 ⟹ `blocker=null` ⟹ 退化为无括注的原措辞（保守方向，不会指错对象）。
 *
 * @returns {{ path:string|null, stage:'mkdir'|'write'|null, code:string|null, blocker:string|null }}
 */
function describeWriteFailure(err) {
  const errPath = (err && typeof err.path === 'string') ? err.path : null;
  return {
    path: errPath,
    stage: (err && (err.stage === 'mkdir' || err.stage === 'write')) ? err.stage : null,
    code: (err && typeof err.code === 'string') ? err.code : null,
    blocker: findPathBlocker(errPath),
  };
}

/**
 * 沿 `errPath` 祖先链（含自身）向上找**第一个存在**的节点；它若不是目录即为挡路物。
 *
 * why 找"第一个存在的节点"而不是"第一个非目录节点"：路径解析在遇到第一个存在节点时就已定死结果，
 * 再往上必然全是目录（否则更下层不会存在）。第一个存在节点是目录 ⟹ 失败原因不是"被文件占位"
 * （典型为 EACCES / EISDIR）⟹ 返回 null，让文案退回原措辞而不是指一个无辜目录让人删。
 *
 * 尽力而为、非抛出：任何 fs 异常一律降级成 null（本函数只服务文案，绝不能把解释路径变成新的失败源）。
 *
 * 🔴 「是否目录」判定用 **`statSync`（跟随软链）而非 `lstatSync`**（4b 修补期探针实测反转）：
 * 祖先链上第一个存在节点若是**指向目录的有效软链**（`.specify/runs` 是软链、或
 * `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 指到 `/tmp/x` 这类路径，而失败发生在更深一级如 EACCES），
 * `lstat` 会判它"非目录" ⟹ stderr 说「删除挡路对象 /tmp」——**该场景可达且会误导模型删掉正常目录**。
 * 跟随后：软链→目录 ⟹ `null`（退回原措辞，保守）；软链→文件 ⟹ 返回该软链路径（该删的确实是它）。
 * 悬空软链仍在上一步被 `existsSync` 判为不存在 ⟹ 继续上溯 ⟹ `null`，保守方向不变。
 *
 * 🔴 **导出仅为单测直调探针**（4b W-5：悬空软链 / 首个存在节点是目录 / 相对路径 / 不可解析路径
 * 四条降级分支经 `saveBlockState` 公开面构造不出来）。生产侧唯一调用点是 `describeWriteFailure`。
 * @returns {string|null}
 */
export function findPathBlocker(errPath) {
  if (typeof errPath !== 'string' || errPath.length === 0) return null;
  let cursor = errPath;
  // 上溯步数有界：dirname 到达根后自返回，正常必然收敛；上限只为杜绝异常路径形态下的死循环
  for (let step = 0; step < 256; step += 1) {
    let exists = false;
    try {
      exists = fs.existsSync(cursor);
    } catch {
      return null;
    }
    if (exists) {
      try {
        // 🔴 stat **跟随**软链：软链→目录说明它根本没挡路（判 null）；软链→文件才是挡路物，
        // 且此时返回的是软链自身路径（该删的就是这条软链，不是它的目标）——两个需求同时满足。
        return fs.statSync(cursor).isDirectory() ? null : cursor;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;   // 已到根仍无存在节点
    cursor = parent;
  }
  return null;
}

/**
 * 持久化阻断计数状态（主路径失败降级 tmpdir，两级均失败 → state-storage-unavailable）。
 *
 * 🔴 整份状态**整体覆写**、不做字段级合并：调用方必须把本次不打算改动的字段原样带回
 * （见 fix-compliance-judge.mjs 各写入点），否则会被静默抹平为默认值。刻意不在此处做
 * read-modify-write 合并——判定器的每条写入路径都恰好先 load 过一次，隐式合并只会让
 * "谁负责保住哪个字段"变得不可审计。
 * @param {string} projectRoot
 * @param {string} sessionId
 * 🔴 两级皆败时**额外**返回 `errors:[{path,stage,code,blocker},{…}]`（主路径在前、回落在后）。
 * 该字段**只为 stderr 解释与审计可观测性服务，零判定消费**——判定侧不得读其任何字段做分支：按 errno
 * 分流的两种形态均已实测被击穿（黑名单可换手法造新 errno 绕过；白名单可用两条 `ln -s /` 让两级同为
 * `EROFS` 绕过——软链跟随让 errno 变成**被判方可选的输入**）。`!saved.ok` 一律 fail-closed，
 * 上界只有 transcript 派生的反馈计数（见 fix-compliance-judge.mjs 的 routeStorageUnavailable）。
 * 成功面（含回落成功）**不带** `errors` 键。
 *
 * @param {{ inFlightDeferCount?:number, targets?:Record<string, object> }} state
 * @returns {{ ok:boolean, path:string|null, degraded:boolean, diagnostics:string[],
 *             errors?:{path:string|null,stage:'mkdir'|'write'|null,code:string|null,blocker:string|null}[] }}
 */
export function saveBlockState(projectRoot, sessionId, state) {
  const sanitizedId = sanitizeSessionId(sessionId);
  // F291a：整体覆写语义不变——调用方须原样带回 inFlightDeferCount 与全部 targets，否则被抹平（mutator 一律 `...state` 展开）。
  const normalized = normalizeState(sanitizedId, state);
  const payload = {
    sessionId: sanitizedId,
    inFlightDeferCount: normalized.inFlightDeferCount,
    targets: normalized.targets,
    updatedAt: new Date().toISOString(),
  };

  // 两级写入各包一层收集点：成功面的返回对象**逐字不变**（D7），只有两级皆败才多出 errors[]。
  const errors = [];
  const primary = primaryStatePath(projectRoot, sanitizedId);
  try {
    writeStateOrThrow(primary, payload);
    return { ok: true, path: primary, degraded: false, diagnostics: [] };
  } catch (err) {
    errors.push(describeWriteFailure(err));
  }
  const fallback = tmpStatePath(sanitizedId);
  try {
    writeStateOrThrow(fallback, payload);
    return { ok: true, path: fallback, degraded: true, diagnostics: [] };
  } catch (err) {
    errors.push(describeWriteFailure(err));
  }
  return { ok: false, path: null, degraded: true, diagnostics: [STATE_STORAGE_DIAGNOSTICS.unavailable], errors };
}

// ────────────────────────────────────────
// F288 卡 B · G1：状态文件并发安全（锁内 RMW）
// ────────────────────────────────────────

/** 锁重试：60 × 8ms ≈ 480ms（B-9 原型口径；同步睡眠，不忙等） */
const LOCK_RETRY_MAX = 60;
const LOCK_RETRY_WAIT_MS = 8;
/** 陈旧锁墙钟兜底：300s，覆盖 F273 实证的宿主合盖睡眠 ~5min 冻结（单独墙钟判据会把活着的持锁者误接管） */
const LOCK_STALE_MS = 300 * 1000;
/** F290 W-1：test-only 接管 trace 延迟的硬上限（1s）——配合「每次调用一次」把最坏放大压到 1s */
const LOCK_TRACE_DELAY_MAX_MS = 1000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * pid 存活探针（存在性判据，不是归属判据——第 3 轮裁决 2：不做 pidStartedAt，安全性不押在锁判据上）。
 * EPERM（存在但无权探测 = 不是本用户的判定器进程）按**不存活**：对抗复审 W-4 实测 `{pid:1}` 伪造锁曾让锁永不被接管
 * （每个 Stop +480ms 有界 DoS + 本会话 G1 退回改动前）。误判活锁为陈旧的后果只是退回无锁 RMW（= 改动前行为）。
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 取会话级状态锁：`<状态目录>/<sanitizedId>.lock`（`openSync 'wx'` O_EXCL）。
 *
 * 语义（F288 卡 B · G1，第 3 轮裁决 1/2 后的终版）：
 *   - 锁必须包住 load（只包 write 等于没包）；临界区不裹 IO（审计 / 终态 / stderr 全在锁外，F227 DoS 面）。
 *   - 陈旧锁接管：持锁 pid 不存活（含无权探测的 pid）、墙钟超 300s、startedAt 在未来（伪造）、或内容不可解析且 mtime ≥ 2s
 *     ⟹ 改名后 unlink 再重试，落 `state-lock-taken-over`。`.lock` 若被占成目录：改名成功但 unlink 失败 ⟹ 每次 Stop 残留一个
 *     `.lock.stale.*` 目录（只在被判方主动占位时发生，方向 = 退回无锁 RMW，登记不修）。
 *   - 有界重试耗尽 ⟹ `acquired:false` + `state-lock-unavailable`；调用方**降级为无锁 RMW（= 改动前行为）**，
 *     不改裁决方向（锁的可得性既不额外放行也不额外阻断：被判方长期占锁的全部收益 = 把 G1 退回改动前）。
 *   - 锁只能落在**一个**位置（主状态目录）；只有主目录本身不可用（mkdir / open 非 EEXIST 失败）才退到 tmp 目录——
 *     「主目录忙」不得退到 tmp（两把不同的锁互不排斥 = 互斥被打破，比不加锁更坏）。
 *   - 锁文件只由持有者按 `lockId` 比对后 unlink（`releaseStateLock`）；`resetBlockState` 不删锁。
 *   - 绝不抛：任何 fs 异常转成返回态（拿不到锁就 throw 会让 judge 顶层 catch fail-open 静默关门禁）。
 *
 * @returns {{ acquired:boolean, lockPath:string|null, lockId:string|null, diagnostics:string[] }}
 */
export function acquireStateLock(projectRoot, sessionId) {
  const sanitizedId = sanitizeSessionId(sessionId);
  // F290 W-1：test-only trace 延迟每次调用最多生效一次（见下方钩子处的放大面论证）
  let traceApplied = false;
  const diagnostics = [];
  const candidates = [
    path.join(projectRoot, ...STATE_SUBDIR, `${sanitizedId}.lock`),
    path.join(stateTmpBase(), STATE_TMP_SUBDIR, `${sanitizedId}.lock`),
  ];
  for (const lockPath of candidates) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    } catch {
      continue;   // 该级目录不可用 → 下一级
    }
    const lockId = crypto.randomBytes(8).toString('hex');
    // 🔴 锁文件必须**带内容原子出现**：先写临时文件再 `linkSync` 到锁路径（同目录硬链接，EEXIST 即锁已存在）。
    // 用 `openSync 'wx'` + 再写内容会留下「文件已在但内容为空」的窗口，等待者读到空内容判为陈旧 ⟹ 接管 ⟹ 互斥被打破
    // （8 进程并发实测丢更新）。
    const stagingPath = `${lockPath}.${process.pid}.${lockId}.tmp`;
    let levelUnusable = false;
    try {
      fs.writeFileSync(stagingPath, `${JSON.stringify({ lockId, pid: process.pid, startedAt: Date.now() })}\n`, { flag: 'wx' });
    } catch {
      continue;   // 该级目录不可写 → 下一级
    }
    try {
      for (let attempt = 0; attempt <= LOCK_RETRY_MAX; attempt += 1) {
        try {
          fs.linkSync(stagingPath, lockPath);
          return { acquired: true, lockPath, lockId, diagnostics };
        } catch (err) {
          if (!err || err.code !== 'EEXIST') { levelUnusable = true; break; }
          let holder = null;
          let holderMtime = 0;
          let vanished = false;
          try {
            holderMtime = fs.statSync(lockPath).mtimeMs;
            holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          } catch (readErr) {
            // 对抗复审 B-W1：ENOENT = 锁在 stat/read 之间被别人删/接管走 ⟹ 不是陈旧、更不能去接管
            // （否则会 rename 掉别人刚 link 上来的活锁 ⇒ 双持锁 / 丢更新）；重试 link 见分晓。
            if (readErr && readErr.code === 'ENOENT') vanished = true;
            holder = null;
          }
          if (vanished) {
            if (attempt < LOCK_RETRY_MAX) sleepSync(LOCK_RETRY_WAIT_MS);
            continue;
          }
          // 内容不可解析但文件很新（< 2s）：按新鲜处理（防止把刚出现、尚未可读的锁误判为陈旧）
          const unreadableButRecent = holder === null && holderMtime > 0 && (Date.now() - holderMtime) < 2000;
          // startedAt 必须 ≤ now：未来时间戳是伪造（对抗复审 W-4：否则 300s 墙钟兜底被一个未校验字段整个绕掉）
          const now = Date.now();
          const fresh = unreadableButRecent || (holder && typeof holder === 'object'
            && pidAlive(holder.pid)
            && Number.isFinite(holder.startedAt) && holder.startedAt <= now && (now - holder.startedAt) < LOCK_STALE_MS);
          if (!fresh) {
            // 接管：先把陈旧锁改名成唯一名（rename 只会成功一次，两个等待者不会互相删掉对方刚建的新锁），
            // 再核对被 rename 走的确实是我们判陈旧的那把锁（对抗复审 B-W1：read→rename 之间锁可能被换成活锁）。
            const stalePath = `${lockPath}.stale.${process.pid}.${lockId}`;
            const judgedLockId = holder && typeof holder === 'object' ? holder.lockId : null;
            // F290 test-only trace hook：在「读到 holder 判陈旧」与「rename 接管」之间注入可控延迟，
            // 让 B-W1 的微秒级接管身份竞态可确定性复现（card-b T1-C6）。生产从不设该环境变量 ⟹ 零行为。
            // 🔴 对抗复审 W-1（放大面收窄）：`.claude/settings.json` 的 `env` 字段可把该变量**持久化**到
            // 下次会话的所有 hook 子进程（供应链 / 评审疏漏路径），而接管重试循环上限 LOCK_RETRY_MAX=60；
            // 若每轮都睡满上限，单次 acquireStateLock 墙钟可被推到 60×上限，越过宿主 hook 超时后
            // 「超时按放行处理」等价门禁被绕过。故双重收窄：上限 1000ms（T1-C6 只需 150ms）+ **每次
            // acquireStateLock 调用最多生效一次**（traceApplied 闭锁），最坏放大 = 1s，不足以越过超时。
            const traceDelay = Number(process.env.SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS);
            if (!traceApplied && Number.isFinite(traceDelay) && traceDelay > 0) {
              traceApplied = true;
              sleepSync(Math.min(traceDelay, LOCK_TRACE_DELAY_MAX_MS));
            }
            try {
              fs.renameSync(lockPath, stalePath);
              // 身份核对：judgedLockId 已知时，stalePath 的 lockId 必须与之相符；不符说明窗口内换成了别的锁 ⟹ rename 回去、不接管。
              let identityOk = true;
              if (judgedLockId !== null) {
                try {
                  const moved = JSON.parse(fs.readFileSync(stalePath, 'utf8'));
                  identityOk = moved && moved.lockId === judgedLockId;
                } catch { identityOk = false; }
              }
              if (!identityOk) {
                try { fs.renameSync(stalePath, lockPath); } catch { /* 目标已被新持有者占回，弃权 */ }
              } else {
                try { fs.unlinkSync(stalePath); } catch { /* 留下的陈旧副本无害 */ }
                if (!diagnostics.includes(STATE_STORAGE_DIAGNOSTICS.lockTakenOver)) diagnostics.push(STATE_STORAGE_DIAGNOSTICS.lockTakenOver);
              }
            } catch {
              // 已被别的等待者接管 → 下一轮 link 见分晓
            }
            continue;
          }
          if (attempt < LOCK_RETRY_MAX) sleepSync(LOCK_RETRY_WAIT_MS);
        }
      }
    } finally {
      try { fs.unlinkSync(stagingPath); } catch { /* 已不存在 */ }
    }
    if (!levelUnusable) break;   // 主目录可用但一直忙：不得退到 tmp 级别的另一把锁
  }
  return { acquired: false, lockPath: null, lockId: null, diagnostics: [...diagnostics, STATE_STORAGE_DIAGNOSTICS.lockUnavailable] };
}

/** 释放锁：只在锁文件内 lockId 与自己一致时 unlink（防误删别人接管后的锁）；绝不抛。 */
export function releaseStateLock(lock) {
  if (!lock || !lock.acquired || !lock.lockPath) return;
  try {
    const current = JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'));
    if (current && current.lockId === lock.lockId) fs.unlinkSync(lock.lockPath);
  } catch {
    // 锁文件已不在 / 不可读 → 无事可做
  }
}

/**
 * 锁内 read-modify-write（F288 卡 B · G1）：`acquire → load → mutator(state) → save → release`。
 *
 * `mutator(state)` 返回 `{ next, result }`：`next` 为要写回的完整状态（null = 不写回）；`result` 原样透传给调用方
 * （路由决策在锁内做、副作用在锁外做——「锁内决定谁来写终态，锁外真正去写」，R2-8）。
 * mutator 抛错不向外抛（A-6：顶层 catch 会把它兜成放行）：按 `ok:false` + `mutatorError` 返回，调用方走 fail-closed。
 *
 * 锁不可得 ⟹ 不跳过、不推迟：同样执行 load → mutator → save（= 改动前的无锁 RMW），并在 diagnostics 带
 * `state-lock-unavailable`；两级存储都写不进 ⟹ `ok:false` + `errors`（与 saveBlockState 同形，交给
 * judge 的 routeStorageUnavailable）。`lockUnavailable` 与 `ok:false` 是两个独立返回态，绝不合并（D-1）。
 *
 * @param {string} projectRoot
 * @param {string} sessionId
 * @param {(state:object) => { next:object|null, result?:any }} mutator
 * @returns {{ ok:boolean, written:boolean, state:object, result:any, lockUnavailable:boolean, degraded:boolean,
 *            diagnostics:string[], errors?:object[], mutatorError?:unknown, path:string|null }}
 */
export function mutateBlockState(projectRoot, sessionId, mutator) {
  const lock = acquireStateLock(projectRoot, sessionId);
  const diagnostics = [...lock.diagnostics];
  let outcome;
  try {
    const loaded = loadBlockState(projectRoot, sessionId);
    let decision;
    try {
      decision = mutator(loaded);
    } catch (err) {
      outcome = { ok: false, written: false, state: loaded, result: undefined, degraded: false, path: null, mutatorError: err };
    }
    if (!outcome) {
      const next = decision && decision.next && typeof decision.next === 'object' ? decision.next : null;
      const result = decision ? decision.result : undefined;
      if (next === null) {
        outcome = { ok: true, written: false, state: loaded, result, degraded: false, path: null };
      } else {
        const saved = saveBlockState(projectRoot, sessionId, next);
        outcome = saved.ok
          ? { ok: true, written: true, state: loadBlockState(projectRoot, sessionId), result, degraded: saved.degraded, path: saved.path }
          : { ok: false, written: false, state: loaded, result, degraded: true, path: null, errors: saved.errors };
        if (!saved.ok) diagnostics.push(...saved.diagnostics);
      }
    }
  } finally {
    releaseStateLock(lock);
  }
  return { ...outcome, lockUnavailable: !lock.acquired, diagnostics };
}

// ────────────────────────────────────────
// F289 · sidechain 标记（SubagentStop 检测 → 主 Stop 执法的接力载体）
// ────────────────────────────────────────

/** 单个标记文件体积上限：形状是几个短字段，超过即视为畸形不读 */
const SIDECHAIN_MARKER_MAX_BYTES = 64 * 1024;

function sidechainMarkerBasename(sanitizedSession, sanitizedAgent) {
  return `${sanitizedSession}.sidechain.${sanitizedAgent}.json`;
}

/**
 * 写 sidechain fix 标记（由 SubagentStop 侧 CLI 调用；两级回落与状态文件同家族、同目录）。
 * 键 = session_id + agent_id：同一会话多个子代理各一份，互不覆盖。绝不抛。
 * @returns {{ ok:boolean, path:string|null, errors:object[] }}
 */
export function writeSidechainMarker(projectRoot, { sessionId, agentId, agentType, fixLineIndex, candidatePath }) {
  const sanitizedSession = sanitizeSessionId(sessionId);
  const sanitizedAgent = sanitizeSessionId(agentId);
  const payload = {
    sessionId: sanitizedSession,
    agentId: sanitizedAgent,
    agentType: typeof agentType === 'string' ? agentType.slice(0, 64) : '',
    fixLineIndex: Number.isInteger(fixLineIndex) ? fixLineIndex : null,
    candidatePath: typeof candidatePath === 'string' ? candidatePath : null,
    recordedAt: new Date().toISOString(),
  };
  const errors = [];
  for (const dir of [path.join(projectRoot, ...STATE_SUBDIR), path.join(stateTmpBase(), STATE_TMP_SUBDIR)]) {
    const target = path.join(dir, sidechainMarkerBasename(sanitizedSession, sanitizedAgent));
    try {
      writeStateOrThrow(target, payload);
      return { ok: true, path: target, errors };
    } catch (err) {
      errors.push(describeWriteFailure(err));
    }
  }
  return { ok: false, path: null, errors };
}

/**
 * 列出本会话的 sidechain 标记（两级目录都读；只认 `sessionId` 字段与文件名一致的记录；畸形 / 超限文件跳过）。
 * 只读不删：`resetBlockState` 也不删它（合规后同会话再次 Stop 仍走 Tier 2 评估，方向 fail-closed）。
 * @returns {Array<{ sessionId:string, agentId:string, agentType:string, fixLineIndex:number|null, candidatePath:string|null, recordedAt:string|null, path:string }>}
 */
export function listSidechainMarkers(projectRoot, sessionId) {
  const sanitizedSession = sanitizeSessionId(sessionId);
  const prefix = `${sanitizedSession}.sidechain.`;
  const out = [];
  for (const dir of [path.join(projectRoot, ...STATE_SUBDIR), path.join(stateTmpBase(), STATE_TMP_SUBDIR)]) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.size > SIDECHAIN_MARKER_MAX_BYTES) continue;
        const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || parsed.sessionId !== sanitizedSession) continue;
        out.push({
          sessionId: sanitizedSession,
          agentId: typeof parsed.agentId === 'string' ? parsed.agentId : '',
          agentType: typeof parsed.agentType === 'string' ? parsed.agentType : '',
          fixLineIndex: Number.isInteger(parsed.fixLineIndex) ? parsed.fixLineIndex : null,
          // F291a（对抗审查 C-1）：读侧规范化 + FIX_DIR_NAME_REGEX 校验——非规范拼写（`specs/<垃圾>/../302-fix-b`）折回规范名，
          // 折不回的当缺席；标记文件在被判方写域，这里的字符串是预算桶键的输入之一
          candidatePath: canonicalFixDirPath(parsed.candidatePath),
          recordedAt: typeof parsed.recordedAt === 'string' ? parsed.recordedAt : null,
          path: full,
        });
      } catch {
        // 畸形 / 不可读 → 跳过（标记只是接力载体，读不到即视为缺席）
      }
    }
  }
  out.sort((a, b) => String(a.recordedAt || '').localeCompare(String(b.recordedAt || '')));
  return out;
}

// ────────────────────────────────────────
// 同步读全 stdin（judge 与 SubagentStop 侧 CLI 共用）
// ────────────────────────────────────────

/** EAGAIN 有界等待：每次 5 ms、最多 2000 次（≈10 s）；写端始终不续写才放弃 */
const STDIN_EAGAIN_WAIT_MS = 5;
const STDIN_EAGAIN_MAX_SPINS = 2000;

/**
 * F287 对抗复审 C-1（既有，自 F208）：`fs.readFileSync(0)` 在管道 fd0 处于非阻塞态时（本进程 `import 'node:process'`
 * 即触发）读空 64 KB 管道缓冲、写端尚未续写 → 抛 EAGAIN → 被吞成 '' → payload-invalid → exit 0。wrapper 的
 * `printf '%s' "$STDIN_PAYLOAD" | node …` / `cat | node …` 恰是这一形态。改为 readSync 循环：EAGAIN 有界等待后重试，
 * 读到 EOF（0 字节）才结束；其它错误返回已读内容。
 */
export function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  let spins = 0;
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      if (err && err.code === 'EAGAIN' && spins < STDIN_EAGAIN_MAX_SPINS) {
        spins += 1;
        sleepSync(STDIN_EAGAIN_WAIT_MS);
        continue;
      }
      if (err && err.code === 'EOF') break;
      return Buffer.concat(chunks).toString('utf8');
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 重置阻断计数状态（FR-006 增补：补救成功后的清零转移）。
 * 删除两级存储（主路径 + tmpdir 回落）中该 session 对应的状态文件，
 * 与"从未被阻断"状态同构——blockCount / degradedRecorded / inFlightDeferCount 一并归位，
 * 无字段级歧义（新增状态字段无需改动本函数，删文件即全量清零；回归钉子见 judge-cli 测试）。
 * 尽力而为、非抛出式：文件不存在（本就未阻断过）或删除失败均静默忽略，
 * 不产生可失败传播的下游（与 sweep 同为旁路维护语义，不同于 saveBlockState 需暴露
 * state-storage-unavailable 诊断——reset 失败的最坏后果只是"旧计数残留"，
 * 不影响本次放行判定，无需诊断落盘）。
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {void}
 */
export function resetBlockState(projectRoot, sessionId) {
  // F288 卡 B（R2-9）：reset 是幂等删除、无 read-modify-write ⟹ 不需要互斥，锁不可得时照样生效（F211 清零不得被锁吞掉）；
  // 只删状态文件、不删锁文件（锁只由持有者按 lockId 比对后 unlink）。
  // F291a：会话文件整份删除 = 本会话**全部目标**的预算同时清零（FR-006「补救成功清零转移」按会话，对抗审查 C-2：
  // 只清当前目标会让兄弟桶残留、回到旧目标首次评估即 0 往返放行）。
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
