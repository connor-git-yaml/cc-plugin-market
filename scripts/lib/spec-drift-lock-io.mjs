/**
 * Spec Drift —— lock 制品读写（FR-003 / FR-015，plan §8）。
 *
 * lock 只存"绑定与预期指纹"，绝不持久化运行时派生状态（status/stale/fresh 被禁）。
 * 校验为**全字段精确校验**：十项必需字段齐全 + 类型正确 + 无被禁字段，
 * 任一不满足即 lock-corrupt——宽松容忍会把 lock 结构性损坏误报成代码漂移。
 */
import fs from 'node:fs';
import path from 'node:path';

/** lock 文件整体结构版本（顶层单一字段，FR-015 判定对象） */
export const LOCK_SCHEMA_VERSION = '1';

/** FR-003 定义的 anchor 条目十项必需字段 */
export const REQUIRED_ANCHOR_FIELDS = Object.freeze([
  'id',
  'ref',
  'docPath',
  'line',
  'symbolId',
  'fingerprint',
  'fingerprintVersion',
  'normalizationProfile',
  'resolvedFrom',
  'matchKind',
]);

/** 运行时派生态字段，MUST NOT 出现在 lock 中 */
export const BANNED_ANCHOR_FIELDS = Object.freeze(['status', 'stale', 'fresh']);

/** 唯一的数值型字段，其余必需字段均为字符串 */
const NUMERIC_ANCHOR_FIELDS = new Set(['line']);

export function createEmptyLock() {
  return { schemaVersion: LOCK_SCHEMA_VERSION, anchors: [] };
}

/** 查找同目录下上一次写入中断残留的 `<lock>.tmp-*` 文件 */
function findResidualTempFiles(lockPath) {
  const dir = path.dirname(lockPath);
  const prefix = `${path.basename(lockPath)}.tmp-`;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith(prefix));
}

function corrupt(reason) {
  return { corrupt: true, reason, exists: true, anchors: [] };
}

/**
 * 校验单条 anchor，返回错误原因字符串；合法返回 null。
 */
function validateAnchor(anchor, index) {
  if (anchor === null || typeof anchor !== 'object' || Array.isArray(anchor)) {
    return `anchors[${index}] 不是对象`;
  }
  for (const field of REQUIRED_ANCHOR_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(anchor, field)) {
      return `anchors[${index}] 缺必需字段 ${field}`;
    }
    const value = anchor[field];
    if (NUMERIC_ANCHOR_FIELDS.has(field)) {
      // 行号必须是正整数：负数 / 小数 / 0 都无法定位 Markdown 行，
      // 放行会让"结构性损坏"伪装成合法绑定并一路流到报告里。
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        return `anchors[${index}] 字段 ${field} 非法（应为正整数，收到 ${JSON.stringify(value)}）`;
      }
    } else if (typeof value !== 'string' || value.trim() === '') {
      return `anchors[${index}] 字段 ${field} 类型错误（应为非空 string）`;
    }
  }
  for (const banned of BANNED_ANCHOR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(anchor, banned)) {
      return `anchors[${index}] 含被禁字段 ${banned}（运行时派生态不得写回 lock）`;
    }
  }
  return null;
}

/**
 * 校验整份 lock 数据结构（读路径与写路径共用**同一套** schema）。
 *
 * 写路径复用它的意义在于：工具绝不能自产一份下次读取会判 lock-corrupt 的 lock。
 *
 * @returns {string|null} 错误原因；合法返回 null
 */
export function validateLockStructure(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'lock 顶层不是对象';
  }
  if (typeof parsed.schemaVersion !== 'string') {
    return 'lock 顶层缺 schemaVersion 或类型错误';
  }
  if (parsed.schemaVersion !== LOCK_SCHEMA_VERSION) {
    return `lock schemaVersion 不兼容（文件 ${parsed.schemaVersion} vs 当前工具 ${LOCK_SCHEMA_VERSION}）`;
  }
  if (!Array.isArray(parsed.anchors)) {
    return 'lock 顶层 anchors 不是数组';
  }

  const seenIds = new Set();
  for (let i = 0; i < parsed.anchors.length; i += 1) {
    const reason = validateAnchor(parsed.anchors[i], i);
    if (reason !== null) return reason;
    // id 是 unlink / refresh 的唯一主键：重复 id 会让"精确删除单条"变成批量误删。
    const id = parsed.anchors[i].id;
    if (seenIds.has(id)) return `anchors[${i}] id 重复："${id}"（lock 内 id MUST 全局唯一）`;
    seenIds.add(id);
  }
  return null;
}

/**
 * 读取并全量校验 lock。
 *
 * @returns {{corrupt:false, exists:boolean, schemaVersion:string, anchors:object[]}
 *          | {corrupt:true, reason:string, exists:boolean, anchors:[]}}
 */
export function readLock(lockPath) {
  const residual = findResidualTempFiles(lockPath);
  if (residual.length > 0) {
    return corrupt(`检测到残留临时文件 ${residual.join(', ')}（上一次写入中断，请人工确认后删除）`);
  }

  if (!fs.existsSync(lockPath)) {
    return { corrupt: false, exists: false, schemaVersion: LOCK_SCHEMA_VERSION, anchors: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    return corrupt(`lock 文件不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }

  const structureReason = validateLockStructure(parsed);
  if (structureReason !== null) return corrupt(structureReason);

  return {
    corrupt: false,
    exists: true,
    schemaVersion: parsed.schemaVersion,
    anchors: parsed.anchors,
  };
}

/**
 * 原子写：临时文件 + rename（POSIX 同文件系统内原子）。
 * 写入前检测残留 tmp 文件，存在则拒绝继续（不静默清理，FR-015）。
 */
export function writeLockAtomic(lockPath, data) {
  // 写盘前用读路径同一套 schema 自检：工具绝不允许自产一份下次读会判 lock-corrupt 的 lock。
  const invalid = validateLockStructure(data);
  if (invalid !== null) {
    throw new Error(`拒绝写入非法 lock（自产损坏防线）：${invalid}`);
  }
  const residual = findResidualTempFiles(lockPath);
  if (residual.length > 0) {
    throw new Error(`拒绝写入：检测到残留临时文件 ${residual.join(', ')}，请人工确认后删除`);
  }
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const tmpPath = `${lockPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, lockPath);
}
