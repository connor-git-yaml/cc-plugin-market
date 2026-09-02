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
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { ok: false, payload: null, diagnostics: ['payload-invalid'] };
  }
  // F240 FR-004：transcript_path 在 Codex 的 Stop payload schema 中是 nullable。缺席/为 null 的
  // payload 结构合法，判 payload-invalid 会给出误导性诊断（看着像 payload 坏了，其实只是没给路径）。
  // 放宽到"可缺席"，由下游 readTranscriptEntries 产出语义精确的 transcript-path-absent；
  // 类型非法（既非字符串又非 null）仍是真正的结构错误，维持 payload-invalid。
  const transcriptPath = parsed.transcript_path;
  if (transcriptPath !== undefined && transcriptPath !== null && typeof transcriptPath !== 'string') {
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
  // F240 FR-004：路径压根没给 与 路径给了却读不到 是两种不同的失效，诊断码必须可区分
  // （transcript-path-absent vs transcript-unavailable）。两者退出码同为 0，只是诊断更精确。
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return { entries: [], diagnostics: ['transcript-path-absent'] };
  }
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
    // F256：在途推迟预算，与 blockCount **分列且互不影响**——推迟不消耗阻断预算是其语义的必要
    // 组成，共用一个计数器会让在途停顿白白烧掉阻断额度。F256 之前写入的状态文件没有此字段，
    // 缺省 0（同 blockCount 的向后兼容口径）。
    inFlightDeferCount: Number.isInteger(src.inFlightDeferCount) && src.inFlightDeferCount >= 0
      ? src.inFlightDeferCount
      : 0,
    // F270 P3：解锁计时器。为「不计入 blockCount 但也不能立即放行」的裁决（证据陈旧 / 无法交叉
    // 校验 / 在途 undetermined / 重入 / 指纹无进展）计数——耗尽后走终态可见放行（不锁死），
    // 阈值 MUST ≥ BLOCK_LIMIT（delta-2 定时雷：被判方控桶权在手，阈值低于诚实地板即更坏绕过）。
    // 缺省 0（向后兼容）。
    nonBlockStopCount: Number.isInteger(src.nonBlockStopCount) && src.nonBlockStopCount >= 0
      ? src.nonBlockStopCount
      : 0,
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
 * @returns {string|null}
 */
function findPathBlocker(errPath) {
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
        // lstat 不跟随软链：挡路物若本身是软链，该删的就是这条软链而不是它的目标
        return fs.lstatSync(cursor).isDirectory() ? null : cursor;
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
 * @param {{ blockCount:number, degradedRecorded:boolean, inFlightDeferCount?:number, nonBlockStopCount?:number }} state
 * @returns {{ ok:boolean, path:string|null, degraded:boolean, diagnostics:string[], errors?:{path:string|null,stage:'mkdir'|'write'|null,code:string|null}[] }}
 */
export function saveBlockState(projectRoot, sessionId, state) {
  const sanitizedId = sanitizeSessionId(sessionId);
  const payload = {
    sessionId: sanitizedId,
    blockCount: Number.isInteger(state && state.blockCount) && state.blockCount >= 0 ? state.blockCount : 0,
    degradedRecorded: Boolean(state && state.degradedRecorded),
    inFlightDeferCount: Number.isInteger(state && state.inFlightDeferCount) && state.inFlightDeferCount >= 0
      ? state.inFlightDeferCount
      : 0,
    // F270 P3：整体覆写语义不变——调用方须原样带回本字段，否则被抹平（见 normalizeState 注释）。
    // （初版另有 firstNonBlockEntryBaseline 锚字段，被 P3 对抗双路命中"锚在可擦文件=backstop
    //   整体可擦"后撤销——backstop 改为单调量比常量，不存锚，见 judge routeNonBlock。）
    nonBlockStopCount: Number.isInteger(state && state.nonBlockStopCount) && state.nonBlockStopCount >= 0
      ? state.nonBlockStopCount
      : 0,
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
  return { ok: false, path: null, degraded: true, diagnostics: ['state-storage-unavailable'], errors };
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
