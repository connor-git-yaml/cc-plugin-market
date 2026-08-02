/**
 * F241 E2 — lockfile 版本解析器（FR-016 / EC-27 / EC-28）
 *
 * 从 npm 生态三种 lockfile 里提取指定包名的**已解析具体版本**。
 *
 * 三条口径：
 * 1. **只覆盖 npm 生态**（`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`）。
 *    go / maven / gradle / uv / pipenv 一律返回 `ecosystem-unsupported`，**不猜测**（FR-016）。
 * 2. **失败必须可辨识**。`file-too-large` / `file-unreadable` / `parse-error` /
 *    `package-not-found` 是四件完全不同的事，压成一个 `null` 会让调用方把"锁文件损坏"
 *    当成"这个包没被锁住"，进而给出一个错误的 `resolved.status: none`。
 * 3. **读之前先 stat**。lockfile 是外部输入，先量体积再决定读不读（EC-28）。
 *
 * 解析实现说明（B3-C1 整改）：三种 lockfile 一律**按结构解析**，不做逐行文本扫描——
 * 逐行扫描把"文本里出现了什么"当成"文档结构是什么"，两个方向的错都会发生：合法 YAML
 * 锚点行被漏读（误报 `package-not-found`），block scalar / 注释里的伪包键被误读（凭空
 * 取到一个错版本）。pnpm 复用仓内既有的 `parseYamlDocument`（**不引入新依赖**），
 * yarn 做 section 级块结构校验 + 版本形态校验。
 */

import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { LOCK_FILE_PRIORITY } from '../panoramic/project-context.js';
import { parseYamlDocument, type YamlValue } from '../panoramic/parsers/yaml-config-parser.js';
import { MAX_LOCKFILE_BYTES } from './governance-constants.js';

/** 本轮支持内容解析的 lockfile 种类（npm 生态） */
export type LockfileKind = 'npm' | 'pnpm' | 'yarn';

/** 能探测到但本轮**不解析**的生态（FR-016：明确不支持，不猜测） */
export type UnsupportedEcosystem = 'go' | 'maven' | 'gradle' | 'uv' | 'pipenv';

export type LockfileProbeKind = LockfileKind | UnsupportedEcosystem;

export type LockfileParseFailure =
  | 'ecosystem-unsupported'
  | 'file-too-large'
  | 'file-unreadable'
  | 'parse-error'
  | 'package-not-found';

export type LockfileParseResult =
  | {
      ok: true;
      version: string;
      source: string;
      /**
       * 同一个 lockfile 里解析出的**其它不一致版本**（B3-W1）。
       *
       * monorepo 下同一个包可能被锁在多个嵌套安装位置且版本不同。静默取遍历首项等于
       * "按 JS 对象键序碰运气"——把全部呈上去，由 `version-resolver` 判 `ambiguous`。
       * 正常情况为空数组。
       */
      alternatives: string[];
    }
  | { ok: false; reason: LockfileParseFailure };

export interface ParseLockfileInput {
  lockfilePath: string;
  packageName: string;
  kind: LockfileProbeKind;
}

/**
 * 文件读取注入缝（B3-W2）。
 *
 * "读取前先 stat" 是 EC-28 的行为合同，而"超限时返回 file-too-large"这一结果断言
 * **证明不了**它——先读进内存再量体积的实现同样能返回 file-too-large。要证明顺序，
 * 测试必须能观察调用序列，故把 IO 提到可注入位置；生产路径恒用 `DEFAULT_LOCKFILE_IO`。
 */
export interface LockfileIo {
  statSync: (path: string) => { isFile: () => boolean; size: number };
  readFileSync: (path: string) => string;
}

/** 生产 IO：直连 `node:fs`（注入缝的默认实参，不得与生产路径漂移） */
export const DEFAULT_LOCKFILE_IO: LockfileIo = {
  statSync: (path) => statSync(path),
  readFileSync: (path) => readFileSync(path, 'utf-8'),
};

/**
 * 探测顺序沿用 `LOCK_FILE_PRIORITY`（该常量只排优先级、不解析内容），
 * 避免本模块另排一份会与 ProjectContext 漂移的顺序表。
 */
export const LOCKFILE_PROBE_ORDER: ReadonlyArray<{ file: string; kind: LockfileProbeKind }> =
  LOCK_FILE_PRIORITY.map((e) => ({ file: e.file, kind: e.manager as LockfileProbeKind }));

/** 按文件名判定 lockfile 种类；不在 `LOCK_FILE_PRIORITY` 内 → `null` */
export function detectLockfileKind(fileName: string): LockfileProbeKind | null {
  const base = basename(fileName);
  return LOCKFILE_PROBE_ORDER.find((e) => e.file === base)?.kind ?? null;
}

function isSupportedKind(kind: LockfileProbeKind): kind is LockfileKind {
  return kind === 'npm' || kind === 'pnpm' || kind === 'yarn';
}

/** 读文件；先 stat 量体积（EC-28），非常规文件/超限/IO 错误各自给出可辨识原因 */
function readGuarded(
  path: string,
  io: LockfileIo,
): { ok: true; text: string } | { ok: false; reason: LockfileParseFailure } {
  let size: number;
  try {
    const st = io.statSync(path);
    if (!st.isFile()) return { ok: false, reason: 'file-unreadable' };
    size = st.size;
  } catch {
    return { ok: false, reason: 'file-unreadable' };
  }
  if (size > MAX_LOCKFILE_BYTES) return { ok: false, reason: 'file-too-large' };
  try {
    return { ok: true, text: io.readFileSync(path) };
  } catch {
    return { ok: false, reason: 'file-unreadable' };
  }
}

/** 版本值形态校验：具体版本必须以数字开头（`latest` / `[unterminated` 这类一律不是版本） */
function isConcreteVersion(value: string): boolean {
  return /^\d[0-9A-Za-z.+-]*$/.test(value);
}

function versionOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null;
  const v = (entry as { version?: unknown }).version;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 把一组版本收敛成 `{primary, alternatives}`：唯一值直接用，多值全量呈上去（B3-W1） */
function toResult(versions: string[], source: string): LockfileParseResult {
  const distinct = [...new Set(versions)];
  if (distinct.length === 0) return { ok: false, reason: 'package-not-found' };
  return { ok: true, version: distinct[0]!, source, alternatives: distinct.slice(1) };
}

/** `package-lock.json`：v2/v3 的 `packages["node_modules/<pkg>"]` 优先，v1 回落 `dependencies` */
function parseNpmLock(text: string, packageName: string): LockfileParseResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
  if (root === null || typeof root !== 'object') return { ok: false, reason: 'parse-error' };
  const obj = root as { packages?: unknown; dependencies?: unknown };

  if (obj.packages !== null && typeof obj.packages === 'object') {
    const packages = obj.packages as Record<string, unknown>;
    // 顶层安装位置是唯一权威位置：存在即直接采用，嵌套位置不参与（B3-W1）
    const direct = versionOf(packages[`node_modules/${packageName}`]);
    if (direct !== null) return { ok: true, version: direct, source: 'package-lock.json', alternatives: [] };
    // 无顶层安装：收集**全部**嵌套安装位置，不静默取遍历首项
    const suffix = `/node_modules/${packageName}`;
    const nested: string[] = [];
    for (const [key, entry] of Object.entries(packages)) {
      if (!key.endsWith(suffix)) continue;
      const v = versionOf(entry);
      if (v !== null) nested.push(v);
    }
    if (nested.length > 0) return toResult(nested, 'package-lock.json');
  }

  if (obj.dependencies !== null && typeof obj.dependencies === 'object') {
    const v = versionOf((obj.dependencies as Record<string, unknown>)[packageName]);
    if (v !== null) return { ok: true, version: v, source: 'package-lock.json', alternatives: [] };
  }
  return { ok: false, reason: 'package-not-found' };
}

/** 去掉包键上的引号与 pnpm 的 peer 后缀 `(a@1)(b@2)`、前导斜杠 */
function normalizePnpmPackageKey(rawKey: string): string {
  let key = rawKey.trim();
  if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
    key = key.slice(1, -1);
  }
  const peerIdx = key.indexOf('(');
  if (peerIdx !== -1) key = key.slice(0, peerIdx);
  if (key.startsWith('/')) key = key.slice(1);
  return key;
}

/**
 * 从一个 pnpm 包键里取出目标包的版本。
 *
 * 包键在各主版本里有三种形态——v5 `/<name>/<version>`、v6 `/<name>@<version>`、
 * v9 `<name>@<version>`。三者统一在剥掉前导斜杠与 peer 后缀之后，用 `<name>` + 分隔符
 * + 数字开头版本匹配。
 */
function pnpmKeyVersion(rawKey: string, packageName: string): string | null {
  const key = normalizePnpmPackageKey(rawKey);
  for (const sep of ['@', '/']) {
    const prefix = `${packageName}${sep}`;
    if (!key.startsWith(prefix)) continue;
    const version = key.slice(prefix.length);
    // 版本必须以数字开头且不含斜杠：排除 `/@scope/ui/other@1.0.0` 这类前缀同名的邻居键
    if (isConcreteVersion(version)) return version;
  }
  return null;
}

function asMapping(value: YamlValue | undefined): Record<string, YamlValue> | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, YamlValue>;
}

/**
 * `pnpm-lock.yaml`：**结构化 YAML 解析**（B3-C1）。
 *
 * 只认 `packages` / `snapshots` 两个段里的真实映射键；block scalar、注释、其它段落里
 * 长得像包键的文本一律不采信。结构不成立（空文件 / 语法损坏 / 缺 `lockfileVersion`）
 * 一律 `parse-error`，与「包确实不在锁里」严格区分。
 */
function parsePnpmLock(text: string, packageName: string): LockfileParseResult {
  const doc = parseYamlDocument(text);
  // 空文件 / 只有注释 / 语法损坏到解不出任何映射 → 结构不成立
  if (Object.keys(doc).length === 0) return { ok: false, reason: 'parse-error' };
  // `lockfileVersion` 是 pnpm-lock 自 v1 起的固定结构标记：缺它就不能当 pnpm-lock 读。
  // 宁可报 parse-error（"我不确定"）也不报 package-not-found（"我确定它不在"）。
  if (!('lockfileVersion' in doc)) return { ok: false, reason: 'parse-error' };

  const versions: string[] = [];
  for (const section of ['packages', 'snapshots'] as const) {
    if (!(section in doc)) continue;
    const mapping = asMapping(doc[section]);
    // 段落存在但不是映射 → 结构损坏，不能降级成"这个包不在锁里"
    if (mapping === null) return { ok: false, reason: 'parse-error' };
    for (const key of Object.keys(mapping)) {
      const v = pnpmKeyVersion(key, packageName);
      if (v !== null) versions.push(v);
    }
    if (versions.length > 0) break; // packages 段优先，命中即不再看 snapshots
  }
  return toResult(versions, 'pnpm-lock.yaml');
}

/** 从 yarn descriptor（`echarts@^5.0.0` / `echarts@npm:^5.0.0`）里取包名 */
function yarnDescriptorName(descriptor: string): string {
  let d = descriptor.trim();
  if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) d = d.slice(1, -1);
  const at = d.lastIndexOf('@');
  // scoped 包的前导 `@` 不是分隔符
  return at <= 0 ? d : d.slice(0, at);
}

interface YarnBlock {
  descriptors: string[];
  /** 块内的属性行（含缩进） */
  body: string[];
}

/**
 * 把 yarn.lock 切成块（section 级结构校验，B3-C1）。
 *
 * 合法形态只有四种行：空行、注释行、顶格 block header（`<descriptors>:`）、缩进属性行。
 * 出现第五种（顶格却不是 header）说明文件结构已损坏 → `null`。
 */
function splitYarnBlocks(text: string): YarnBlock[] | null {
  const blocks: YarnBlock[] = [];
  let current: YarnBlock | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) continue;
    if (line.trimStart().startsWith('#')) continue;

    if (/^\s/.test(line)) {
      // 缩进属性行必须属于某个块；孤儿属性行是结构损坏
      if (current === null) return null;
      current.body.push(line);
      continue;
    }

    if (!line.endsWith(':')) return null; // 顶格垃圾行
    const header = line.slice(0, -1).trim();
    if (header.length === 0) return null;
    current = { descriptors: header.split(','), body: [] };
    blocks.push(current);
  }

  return blocks.length > 0 ? blocks : null;
}

/**
 * `yarn.lock`：块结构（顶格 descriptor 行 + 缩进属性行）。
 * classic 写 `version "5.4.3"`，berry 写 `version: 5.5.0`，两种都收。
 *
 * B3-C1：`version` 行的**取值形态**也要校验——`version [unterminated` 长得像 version 行，
 * 但 `[unterminated` 不是版本；把它当成功版本返回，比返回 `parse-error` 危险得多。
 */
function parseYarnLock(text: string, packageName: string): LockfileParseResult {
  const blocks = splitYarnBlocks(text);
  if (blocks === null) return { ok: false, reason: 'parse-error' };

  for (const block of blocks) {
    if (!block.descriptors.some((d) => yarnDescriptorName(d) === packageName)) continue;
    for (const body of block.body) {
      const m = /^\s+version:?\s+(.*)$/.exec(body);
      if (m === null) continue;
      let value = m[1]!.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!isConcreteVersion(value)) return { ok: false, reason: 'parse-error' };
      return { ok: true, version: value, source: 'yarn.lock', alternatives: [] };
    }
  }
  return { ok: false, reason: 'package-not-found' };
}

/**
 * 解析某个 lockfile 中指定包的具体版本。
 *
 * 本函数是 total 函数：任何 IO / 解析异常都收敛为 `{ ok: false, reason }`，不抛。
 *
 * @param io 文件读取注入缝（B3-W2）；生产调用不传，恒用 `DEFAULT_LOCKFILE_IO`
 */
export function parseLockfileVersion(
  input: ParseLockfileInput,
  io: LockfileIo = DEFAULT_LOCKFILE_IO,
): LockfileParseResult {
  if (!isSupportedKind(input.kind)) return { ok: false, reason: 'ecosystem-unsupported' };
  if (typeof input.packageName !== 'string' || input.packageName.trim().length === 0) {
    return { ok: false, reason: 'package-not-found' };
  }
  const read = readGuarded(input.lockfilePath, io);
  if (!read.ok) return read;
  const packageName = input.packageName.trim();
  try {
    if (input.kind === 'npm') return parseNpmLock(read.text, packageName);
    if (input.kind === 'pnpm') return parsePnpmLock(read.text, packageName);
    return parseYarnLock(read.text, packageName);
  } catch {
    // 解析器本身不该抛，兜底为 parse-error 而非静默 package-not-found
    return { ok: false, reason: 'parse-error' };
  }
}
