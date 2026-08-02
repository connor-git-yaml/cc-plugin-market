/**
 * F241 E2 — 版本决议（FR-017 / EC-23~EC-27）
 *
 * 优先级自高到低：显式指定 > 唯一 lockfile 推断 > `package.json` range（弱信号）> 无信息。
 *
 * 两条**不可动摇**的口径：
 * 1. **多 lockfile 且无显式版本 → `ambiguous` 且 `version: null`**。绝不按
 *    `LOCK_FILE_PRIORITY` 擅自收敛为单值——那是把"我不知道"伪装成"我知道"（EC-24）。
 * 2. **高优先级采纳不吞掉低优先级证据**。显式值胜出时，lockfile 推断值仍必须出现在
 *    `candidates[]` 并标 `version-conflict`，否则调用方永远看不到"你指定的版本和你锁的
 *    版本不是一个"（EC-26）。同理 `node_modules` 实际安装版本与 lockfile 不一致时双呈现（EC-25）。
 *
 * 本模块是 total 函数：任何 IO / 解析失败都退化为"少一条证据"，不抛错、也不猜测。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOCKFILE_PROBE_ORDER,
  parseLockfileVersion,
  type LockfileProbeKind,
} from './lockfile-parser.js';

export type VersionStatus = 'explicit' | 'lockfile' | 'range-only' | 'ambiguous' | 'none';

export type VersionFlag =
  | 'version-conflict'
  | 'range-only'
  | 'multiple-lockfiles'
  | 'ecosystem-unsupported'
  | 'lockfile-install-mismatch';

export interface VersionCandidate {
  /** 具体版本；`source: 'package.json'` 时是 range 字符串（弱信号，故不进 `resolved.version`） */
  version: string;
  /** 证据来源：`explicit` / lockfile 文件名 / `package.json` / `node_modules` */
  source: string;
  detail: string;
}

export interface VersionResolution {
  resolved: { status: VersionStatus; version: string | null };
  candidates: VersionCandidate[];
  flags: VersionFlag[];
}

export interface ResolveVersionInput {
  projectRoot: string;
  packageName: string;
  explicitVersion?: string;
}

const NPM_KINDS: ReadonlySet<LockfileProbeKind> = new Set<LockfileProbeKind>(['npm', 'pnpm', 'yarn']);

/** 从 `package.json` 的三类依赖段里找 range（弱信号） */
function readDeclaredRange(projectRoot: string, packageName: string): string | null {
  try {
    const raw = readFileSync(join(projectRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      const deps = pkg[section];
      if (deps === null || typeof deps !== 'object') continue;
      const v = (deps as Record<string, unknown>)[packageName];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  } catch {
    // 无 package.json / 损坏 → 少一条证据，不是错误
  }
  return null;
}

/** 读 `node_modules/<pkg>/package.json` 的实际安装版本；不可检测时返回 null（**不猜测**，EC-25） */
function readInstalledVersion(projectRoot: string, packageName: string): string | null {
  try {
    const raw = readFileSync(join(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf-8');
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

interface LockfileEvidence {
  candidates: VersionCandidate[];
  /** 探测到但本轮不解析的生态（FR-016：明确不支持而非猜测） */
  sawUnsupportedEcosystem: boolean;
}

function collectLockfileEvidence(projectRoot: string, packageName: string): LockfileEvidence {
  const candidates: VersionCandidate[] = [];
  let sawUnsupportedEcosystem = false;
  const seenFiles = new Set<string>();

  for (const entry of LOCKFILE_PROBE_ORDER) {
    if (seenFiles.has(entry.file)) continue; // LOCK_FILE_PRIORITY 里同一 manager 可能有多个文件名
    const lockfilePath = join(projectRoot, entry.file);
    if (!existsSync(lockfilePath)) continue;
    seenFiles.add(entry.file);
    if (!NPM_KINDS.has(entry.kind)) {
      sawUnsupportedEcosystem = true;
      continue;
    }
    const parsed = parseLockfileVersion({ lockfilePath, packageName, kind: entry.kind });
    if (parsed.ok) {
      candidates.push({
        version: parsed.version,
        source: parsed.source,
        detail: `${entry.file} 解析出的已锁定版本`,
      });
      // B3-W1：同一 lockfile 内多个嵌套安装位置版本不一致时全量呈现，
      // 由下方 `ambiguous` 判定收口——不静默取遍历首项冒充唯一答案
      for (const alt of parsed.alternatives) {
        candidates.push({
          version: alt,
          source: parsed.source,
          detail: `${entry.file} 另一嵌套安装位置解析出的版本（同一锁文件内不一致）`,
        });
      }
      continue;
    }
    // 解析失败的原因如实带出：损坏的锁文件不等于"这个包没被锁住"
    if (parsed.reason !== 'package-not-found') {
      candidates.push({
        version: '',
        source: entry.file,
        detail: `${entry.file} 无法解析：${parsed.reason}`,
      });
    }
  }
  return { candidates, sawUnsupportedEcosystem };
}

/**
 * 决议某个包在给定项目下的版本。
 *
 * @param input.explicitVersion 调用方（查询）显式指定的版本，优先级最高
 */
export function resolveVersion(input: ResolveVersionInput): VersionResolution {
  const packageName = input.packageName.trim();
  const explicit = input.explicitVersion?.trim();
  const flags = new Set<VersionFlag>();
  const candidates: VersionCandidate[] = [];

  const evidence = collectLockfileEvidence(input.projectRoot, packageName);
  // 只有"真解析出版本"的条目才算 lockfile 证据；解析失败条目仅作可见性
  const lockCandidates = evidence.candidates.filter((c) => c.version.length > 0);
  const unparsable = evidence.candidates.filter((c) => c.version.length === 0);
  if (evidence.sawUnsupportedEcosystem) flags.add('ecosystem-unsupported');
  // `multiple-lockfiles` 只描述"锁文件有几个"，按 candidate 条数计会把 B3-W1 的
  // 单锁文件内嵌套歧义误标成多锁文件冲突
  const distinctLockfiles = new Set(lockCandidates.map((c) => c.source)).size;
  if (distinctLockfiles >= 2) flags.add('multiple-lockfiles');
  // 不可收敛的条件是"存在两个不同的具体版本"，与它们来自一个还是多个锁文件无关
  const distinctVersions = new Set(lockCandidates.map((c) => c.version));

  // node_modules 实际安装版本：只在有 lockfile 证据且**可检测**时参与（EC-25）
  const installedVersion = lockCandidates.length > 0 ? readInstalledVersion(input.projectRoot, packageName) : null;
  const installMismatch =
    installedVersion !== null && !lockCandidates.some((c) => c.version === installedVersion);
  if (installMismatch) flags.add('lockfile-install-mismatch');

  if (explicit !== undefined && explicit.length > 0) {
    candidates.push({ version: explicit, source: 'explicit', detail: '查询显式指定的版本' });
    candidates.push(...lockCandidates);
    if (lockCandidates.some((c) => c.version !== explicit)) flags.add('version-conflict');
    if (installMismatch && installedVersion !== null) {
      candidates.push({ version: installedVersion, source: 'node_modules', detail: '实际安装版本（与 lockfile 不一致）' });
    }
    candidates.push(...unparsable);
    return { resolved: { status: 'explicit', version: explicit }, candidates, flags: [...flags] };
  }

  candidates.push(...lockCandidates);
  if (installMismatch && installedVersion !== null) {
    candidates.push({ version: installedVersion, source: 'node_modules', detail: '实际安装版本（与 lockfile 不一致）' });
  }

  // 两条不收敛的路径共用 `ambiguous`（B3-W1 不新增状态）：
  // (a) 多个 lockfile 无显式版本（FR-017 / EC-24，即便版本恰好相同也不收敛）；
  // (b) 单个 lockfile 内多个嵌套安装位置版本不一致。
  if (distinctLockfiles >= 2 || distinctVersions.size >= 2) {
    candidates.push(...unparsable);
    return { resolved: { status: 'ambiguous', version: null }, candidates, flags: [...flags] };
  }
  if (distinctVersions.size === 1) {
    candidates.push(...unparsable);
    return {
      resolved: { status: 'lockfile', version: [...distinctVersions][0]! },
      candidates,
      flags: [...flags],
    };
  }

  const range = readDeclaredRange(input.projectRoot, packageName);
  if (range !== null) {
    flags.add('range-only');
    candidates.push({ version: range, source: 'package.json', detail: '声明的版本范围（弱信号，非具体版本）' });
    candidates.push(...unparsable);
    return { resolved: { status: 'range-only', version: null }, candidates, flags: [...flags] };
  }

  candidates.push(...unparsable);
  return { resolved: { status: 'none', version: null }, candidates, flags: [...flags] };
}
