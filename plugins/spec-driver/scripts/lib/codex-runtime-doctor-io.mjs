/**
 * codex-runtime-doctor-io.mjs
 * Feature 240 / A4-2 — 四方一致性诊断：I-O 适配层
 *
 * 唯一职责：把外部世界（release contract 文件、`spectra` / `codex` 子进程、
 * `$CODEX_HOME` 下的文件）读进来，并**立即**归约为受限类型
 * （semver / errorClass 枚举 / probe outcome / 受约束相对路径），随后丢弃原对象。
 *
 * 🔴 结构性防线（plan §8.7(4)）：
 * - 子进程一律以 `stdio[2] = 'ignore'` 启动 —— 子进程的错误输出**从不进入本进程**，
 *   于是它在结构上不可能被写进报告；
 * - 错误对象只被读取 `code` / `status` 两个字段，映射为固定枚举后立刻丢弃；
 * - 本层不构造任何 check，也不产出任何面向用户的文案，那是 core 层构造漏斗的事。
 *
 * 依赖注入合同（plan §8.1）：`{ projectRoot, codexHome, env, exec, now }`。
 * `exec` 可注入是为了让单测不依赖本机是否装了 Codex / Spectra。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseYamlDocument } from './simple-yaml.mjs';
import {
  PRODUCTS,
  PRODUCT_VERSION_PATHS,
  PLUGIN_BUILD_PROBES,
  createCheck,
  assembleReport,
  normalizeVersion,
  parseVersionLine,
  toScopedRelPath,
  classifyHookTrust,
} from './codex-runtime-doctor-core.mjs';

/** 子进程探测的默认墙钟上限。诊断命令必须有界，宁可落 ETIMEDOUT 也不挂起。 */
const SUBPROCESS_TIMEOUT_MS = 5000;

/**
 * `codex doctor --json` 的专属上限。
 *
 * 实测（本机，node `execFileSync`）：该命令含网络可达性体检，耗时 1.5~7.3s 且波动大，
 * 在默认 5s 上限下会**稳定** ETIMEDOUT。那样这个排查点永远只能记 `error`，
 * 而 clarify #3 要的是一份**可复审的排查记录** —— 「查过了，那里没有」(`absent`)
 * 比「没查成」(`error`) 强得多，且 `_grounding.md` §5.2 已确证它的 18 个 check
 * 与我方版本零重叠，所以多等这几秒换到的是一个确定性否定结论。
 */
const CODEX_DOCTOR_TIMEOUT_MS = 15000;

const RELEASE_CONTRACT_REL = path.join('contracts', 'release-contract.yaml');

/**
 * 默认子进程执行器：只回传 stdout 文本，子进程错误输出直接丢弃（见文件头结构性防线）。
 * @returns {string}
 */
function defaultExec(file, args, options = {}) {
  return execFileSync(file, args, {
    timeout: options.timeout ?? SUBPROCESS_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * 把任意失败归约为 `errorClass` 固定枚举。只读 `code` / `status`，不碰任何文本字段。
 * @param {unknown} err
 * @param {{rpc?: boolean}} [opts]
 */
function classifyErrorClass(err, opts = {}) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  if (code === 'ENOENT') return 'ENOENT';
  if (code === 'ETIMEDOUT') return 'ETIMEDOUT';
  if (code === 'EACCES' || code === 'EPERM') return 'EACCES';
  const status = err && typeof err === 'object' ? err.status : undefined;
  if (typeof status === 'number' && status !== 0) return opts.rpc ? 'rpc-error' : 'non-zero-exit';
  return opts.rpc ? 'rpc-error' : 'unknown';
}

function extractExitCode(err) {
  const status = err && typeof err === 'object' ? err.status : undefined;
  return typeof status === 'number' ? status : null;
}

/**
 * 跑一条命令并归约结果。
 * @returns {{kind:'ok', text:string} | {kind:'error', errorClass:string, exitCode:number|null}}
 */
function runCommand(exec, file, args, opts = {}) {
  try {
    const text = exec(file, args, { timeout: opts.timeout ?? SUBPROCESS_TIMEOUT_MS });
    return { kind: 'ok', text: typeof text === 'string' ? text : '' };
  } catch (err) {
    return { kind: 'error', errorClass: classifyErrorClass(err, opts), exitCode: extractExitCode(err) };
  }
}

/**
 * 同一次诊断内对**完全相同的命令**只真跑一次。
 *
 * 必要性：四方 × 两产品的矩阵下，`codex plugin list --json` / `codex doctor --json` /
 * `codex debug app-server --help` 这三条命令的输出与产品无关，逐产品重跑纯属浪费
 * ——实测重跑一次 `codex doctor --json` 就要多花 5~15s，直接决定本命令能不能用。
 * 缓存成功值与抛出的错误两种结果，保证被缓存路径与首次调用行为完全一致。
 */
function memoizeExec(exec) {
  const cache = new Map();
  return (file, args = [], options = {}) => {
    // 🔴 分隔符必须以**转义序列**书写，不能把裸 NUL 字节敲进源文件：源码里出现 NUL
    // 会让 git 把整个文件判为 binary，`git diff` 退化成「Binary files differ」，
    // 于是这个文件对文本审查与 grep 类门禁**全部失明**（W5）。
    const key = `${file}\u0000${args.join('\u0000')}`;
    const hit = cache.get(key);
    if (hit) {
      if (hit.kind === 'ok') return hit.value;
      throw hit.error;
    }
    try {
      const value = exec(file, args, options);
      cache.set(key, { kind: 'ok', value });
      return value;
    } catch (err) {
      cache.set(key, { kind: 'error', error: err });
      throw err;
    }
  };
}

/** 文件读取失败 → errorClass 枚举（错误对象的 path / 文本一律不回传） */
function classifyFsError(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'ENOENT';
  if (code === 'EACCES' || code === 'EPERM') return 'EACCES';
  if (code === 'EISDIR') return 'parse-failed';
  return 'unknown';
}

function readTextFile(absPath) {
  try {
    return { kind: 'ok', text: fs.readFileSync(absPath, 'utf-8') };
  } catch (err) {
    return { kind: 'error', errorClass: classifyFsError(err) };
  }
}

function fileExists(absPath) {
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 一方：仓库版本（contracts/release-contract.yaml）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 读取按产品分组的仓库声明版本。
 * 🔴 只读 `PRODUCT_VERSION_PATHS` 登记的两条路径；`marketplace.metadata.version`
 * （`EXCLUDED_VERSION_PATHS`）在此结构性地不可达。
 */
function readRepoVersions(projectRoot) {
  const absPath = path.join(projectRoot, RELEASE_CONTRACT_REL);
  const read = readTextFile(absPath);
  if (read.kind === 'error') {
    return { kind: 'error', errorClass: read.errorClass, absPath };
  }
  let doc;
  try {
    doc = parseYamlDocument(read.text);
  } catch {
    return { kind: 'error', errorClass: 'parse-failed', absPath };
  }
  const products = doc && typeof doc === 'object' ? doc.products : undefined;
  const versions = {};
  for (const product of PRODUCTS) {
    const raw = products && typeof products === 'object' ? products[product]?.version : undefined;
    versions[product] = normalizeVersion(typeof raw === 'string' ? raw : null);
  }
  return { kind: 'ok', versions, absPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// 二方：全局 CLI
// ─────────────────────────────────────────────────────────────────────────────

/** 只有 spectra 有独立全局 CLI；spec-driver 侧是 not-applicable（设计上不存在对应物） */
const GLOBAL_CLI_BINARIES = Object.freeze({ spectra: 'spectra' });

/**
 * 读全局 CLI 版本。
 *
 * 🔴 W1：判定**只**采信 `parseVersionLine` 的整行语法校验，且要求版本行以
 * `binaryName` 开头。此前用 `normalizeVersion` 在首行里「找一个 semver」，
 * 于是 `warning: expected 4.4.0 but no binary was executed` 这种垃圾输出
 * 会被当成一次成功的版本读取并判 `ok`。
 *
 * 🔴 C1：返回值里没有任何原始子串 —— 只有三段数字拼装的 `semver` 与两个
 * 派生布尔位，commit 的值本身在 core 层就已被丢弃。
 */
function probeGlobalCli(exec, binaryName) {
  const result = runCommand(exec, binaryName, ['--version']);
  if (result.kind === 'error') {
    return { kind: 'error', errorClass: result.errorClass, exitCode: result.exitCode };
  }
  const parsed = parseVersionLine(result.text, { expectedProgram: binaryName });
  if (!parsed.ok) {
    return { kind: 'ok', semver: null, rawShape: 'unparseable' };
  }
  return {
    kind: 'ok',
    semver: parsed.semver,
    rawShape: parsed.hadVPrefix || parsed.commitSuffixPresent ? 'decorated-semver' : 'bare-semver',
    hadVPrefix: parsed.hadVPrefix,
    commitSuffixPresent: parsed.commitSuffixPresent,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 三方：plugin build（5 个可枚举排查点，全部执行，任一抛错不跳过其余）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * config.toml 的单遍词法扫描器：注释剥离与字符串跟踪由**同一次左到右逐字符遍历**完成。
 *
 * 🔴 为什么必须合一（F262 修复轮）：先前是"多行串跟踪跑在原始行上、注释剥离另跑一遍"两个
 * 互不知情的扫描。于是 `"""` / `'''` 只要**出现过**就被当定界符，无论它落在注释里、落在
 * 单行 basic string 里（`"… ''' …"`）还是落在单行 literal string 里（`'… """ …'`）。
 * 这类杂散标记为**偶数**个时，幻影串会中途闭合，被吞区间若含段头，后面的 `enabled = true`
 * 就错归属给上一个 plugin 段 —— 直接产出 fail 级的版本漂移误报（而非安全方向的 absent）。
 *
 * 扫描状态：
 * - `openTriple`：跨行的多行串定界符（`"""` 或 `'''`），只有在「串外且非注释」处出现的
 *   三连引号才会开启它；串内只寻找**对应**的闭合定界符，其余字符一律吞掉；
 *   闭合后该行剩余部分继续正常扫描（含可能的行尾注释）。
 * - 单行 basic string（`"`）：`\` 转义下一字符，故 `\"` 不闭串（仓内 `simple-yaml.mjs`
 *   的无转义版本会在 `[mcp_servers."a\"b"] # note` 上把注释留下、整行不匹配段头）。
 * - 单行 literal string（`'`）：无转义语义。
 * - 单行串在行尾仍未闭合是非法 TOML；此处不报错，保守吞掉该行剩余（不可判定内容）。
 * - `#` 出现在一切串外 ⇒ 行止。
 *
 * `consumeLine` 返回该行**归约后的可判定文本**（串内内容与注释已剔除，单行串的内容原样保留
 * —— 段头名恰恰住在单行串里）。
 */
function createTomlScanner() {
  let openTriple = null;
  return {
    consumeLine(rawLine) {
      let out = '';
      let i = 0;
      while (i < rawLine.length) {
        if (openTriple !== null) {
          if (rawLine.startsWith(openTriple, i)) {
            openTriple = null;
            i += 3;
          } else {
            i += 1; // 多行串内容：整体丢弃，不参与任何段头/键值判定
          }
          continue;
        }
        const ch = rawLine[i];
        if (ch === '#') break; // 串外注释 ⇒ 行止
        if (rawLine.startsWith('"""', i) || rawLine.startsWith("'''", i)) {
          openTriple = rawLine.slice(i, i + 3);
          i += 3;
          continue;
        }
        if (ch === '"' || ch === "'") {
          const end = scanSingleLineString(rawLine, i, ch);
          if (end === null) return out; // 行尾未闭合（非法 TOML）⇒ 保守吞掉剩余
          out += rawLine.slice(i, end);
          i = end;
          continue;
        }
        out += ch;
        i += 1;
      }
      return out;
    },
  };
}

/**
 * 从 `start`（引号本身）扫到单行字符串的闭合引号，返回闭合引号之后的下标；未闭合返回 null。
 * basic string（`"`）内 `\` 转义下一字符；literal string（`'`）内无转义语义。
 */
function scanSingleLineString(rawLine, start, quote) {
  const escaping = quote === '"';
  let i = start + 1;
  while (i < rawLine.length) {
    const ch = rawLine[i];
    if (escaping && ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return null;
}

/**
 * config.toml 行规范化管线（`parsePluginRegistry` 与 `hasHooksStateSection` 共用同一判据）。
 *
 * 每行经 `createTomlScanner` 归约后 trim，再依次尝试 `[[x]]`（数组表）与 `[x]`（普通表）。
 *
 * ## 段边界承诺（判据的一部分）
 * **任何以 `[` 开头的归约行都是段边界**（`isSectionBoundary`，消费方必须重置归属），
 * 其中**能成功解析出段名的**才带 `headerName`。二者刻意分离：`[plugins."a]b@y"]`、
 * `[mcp_servers."a]b"]` 这类段名内含 `]` 的形态对 `^\[([^\]]+)\]$` 结构性失配，
 * 若"解析不出就跳过"，后续 `enabled = true` 会泄漏回上一个 plugin 段 —— 保守的方向是
 * 「判不出归属」（absent → indeterminate），绝不是「错归属」（fail 级误报）。
 *
 * ## 🔴 不支持形态清单
 * 下列形态**不会**被解析成注册条目，落 `absent → indeterminate` 的安全方向（已有测试锚定）：
 * - 段头内侧空白：`[ plugins."x@y" ]`
 * - literal string 键：`[plugins.'x@y']`
 * - 段名内含 `]`：`[plugins."a]b@y"]`（按上述承诺当段边界处理）
 * - 点分键写法：`plugins."x@y".enabled = true`
 * - 无 `@marketplace` 的段名、名字里含多个 `@`
 * - `[[plugins."x@y"]]` 数组表（[推断] Codex 侧预期反序列化失败，absent 与事实同向）
 *
 * ## 已知过度近似（方向安全，但会主动放弃判定）
 * 本模块不跟踪「值上下文」，因此多行数组的续行 `[1, 2],` 这类以 `[` 开头的行也会被当成段边界，
 * 提前断开归属 —— 结论落 absent → indeterminate，与上面的段边界承诺同向。
 * 反过来，单行字符串**连同定界引号一起**保留在归约文本里（`'[plugins."x@y"]'` 归约后仍以 `'`
 * 开头），所以字符串**内容**无法伪造出段头；这一点已实测。
 * 这些形态写下来是因为：枚举式判据每漏记一种真实形态就漏一次（F259 教训），
 * 而"全部落安全方向"这种总括式承诺一旦不真，就是把盲区伪装成保证。
 *
 * @returns {Array<{text: string, headerName: string|null, isArrayTable: boolean,
 *                  isSectionBoundary: boolean}>}
 */
function normalizeTomlLines(tomlText) {
  const scanner = createTomlScanner();
  const lines = [];
  for (const rawLine of tomlText.split('\n')) {
    const text = scanner.consumeLine(rawLine).trim();
    const arrayTable = /^\[\[([^\]]+)\]\]$/.exec(text);
    if (arrayTable) {
      lines.push({ text, headerName: arrayTable[1], isArrayTable: true, isSectionBoundary: true });
      continue;
    }
    const table = /^\[([^\]]+)\]$/.exec(text);
    if (table) {
      lines.push({ text, headerName: table[1], isArrayTable: false, isSectionBoundary: true });
      continue;
    }
    lines.push({
      text,
      headerName: null,
      isArrayTable: false,
      isSectionBoundary: text.startsWith('['),
    });
  }
  return lines;
}

/** 从 config.toml 中提取 `[plugins."<name>@<market>"]` 段（词法扫描，不做通用 TOML 解析） */
function parsePluginRegistry(tomlText) {
  const entries = [];
  let current = null;
  for (const line of normalizeTomlLines(tomlText)) {
    if (line.isSectionBoundary) {
      // 段边界一律先断开归属：数组表、非 plugins 段、解析不出名字的段头都只重置、不建条目
      current = null;
      const pluginKey =
        line.headerName !== null && !line.isArrayTable
          ? /^plugins\."([^"]+)"$/.exec(line.headerName)
          : null;
      if (pluginKey) {
        const [name, marketplace] = pluginKey[1].split('@');
        current = { name, marketplace: marketplace ?? null, enabled: false };
        entries.push(current);
      }
      continue;
    }
    if (current && /^enabled\s*=\s*true$/.test(line.text)) {
      current.enabled = true;
    }
  }
  return entries;
}

/**
 * config.toml 是否含 `hooks.state` 类段（FR-009 的信任记录落点，§9.7）。
 *
 * 🔴 判据收窄到 `hooks.state` 前缀（原为 `^hooks(\.|$)`）：`[hooks]` 是 Codex 自己的产品特性段，
 * 把它误判成信任记录段会让**可执行**的 `grant-hook-trust` 指引降级成 `manual-investigate` ——
 * 用户被告知"去人工排查"，而实际动作只是去 Codex 里授权。
 * 段的确切形态仍未经实测确证（T062 挂账），故命中时依旧只归 `present-unconfirmed`（indeterminate），
 * 绝不猜测解析出"已信任"。
 */
function hasHooksStateSection(tomlText) {
  for (const line of normalizeTomlLines(tomlText)) {
    if (line.headerName === null) continue;
    if (/^hooks\.state(\.|$)/.test(line.headerName)) return true;
  }
  return false;
}

/**
 * 探针 1 `codex-plugin-manifest`：注册表（config.toml）→ 定位快照目录 → 读快照内 manifest。
 *
 * 🔴 快照目录名是**快照哈希**（`_grounding.md` §9.7），**绝不能**当版本用；
 * 版本只从 `.codex-plugin/plugin.json` 的 `version` 字段读。同理，
 * 「取最高版本号」兜底在此结构性不可构造（F236 教训的 Codex 侧映射）。
 */
function probeCodexPluginManifest(codexHome, product) {
  const configPath = path.join(codexHome, 'config.toml');
  const read = readTextFile(configPath);
  if (read.kind === 'error') {
    if (read.errorClass === 'ENOENT') return { outcome: 'absent', errorClass: null };
    return { outcome: 'error', errorClass: read.errorClass };
  }
  const entry = parsePluginRegistry(read.text).find((item) => item.name === product && item.enabled);
  if (!entry || !entry.marketplace) return { outcome: 'absent', errorClass: null };

  const pluginDir = path.join(codexHome, 'plugins', 'cache', entry.marketplace, entry.name);
  let snapshots;
  try {
    snapshots = fs.readdirSync(pluginDir, { withFileTypes: true });
  } catch (err) {
    const errorClass = classifyFsError(err);
    return errorClass === 'ENOENT'
      ? { outcome: 'absent', errorClass: null }
      : { outcome: 'error', errorClass };
  }
  // 🔴 注册表只说明「哪个 plugin 是 active」，**不说明哪个快照是 active**。
  // 快照目录名是哈希（§9.7），既不能按版本号排序也不能「取第一个」——后者是
  // F236「取最高版本号」同一类错误的变体：用一个无依据的顺序冒充确定性判定。
  // 故这里收集全部快照的版本，只有**语义版本唯一**时才敢比较版本。
  const found = [];
  // 🔴 W2：任何**未能读出版本**的候选快照都必须让本来源的结论歧义化。
  // 此前对读不出的快照 `continue`，等于「拿剩下那个能读的快照冒充确定结论」：
  // 快照 B 的 manifest 缺失/权限不足时，报告会照样声称 A 的版本就是 active 版本，
  // 甚至把 A 的路径标成 `activeInstallPath` —— 注册表从未说过 A 是 active。
  let unreadable = false;
  for (const snapshot of snapshots) {
    if (!snapshot.isDirectory()) continue;
    const manifestPath = path.join(pluginDir, snapshot.name, '.codex-plugin', 'plugin.json');
    const manifest = readTextFile(manifestPath);
    if (manifest.kind === 'error') {
      unreadable = true;
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(manifest.text);
    } catch {
      unreadable = true;
      continue;
    }
    const normalized = normalizeVersion(typeof parsed?.version === 'string' ? parsed.version : null);
    if (normalized.semver === null) {
      unreadable = true;
      continue;
    }
    found.push({ ...normalized, installDir: path.join(pluginDir, snapshot.name) });
  }
  // 存在读不出的候选 ⇒ 候选集合不完整 ⇒ 本来源已执行但不可判定，绝不用残缺集合下结论
  if (unreadable) return { outcome: 'error', errorClass: 'snapshot-unreadable' };
  if (found.length === 0) return { outcome: 'absent', errorClass: null };

  const distinct = new Set(found.map((item) => item.semver));
  if (distinct.size > 1) {
    // 多个快照给出不同版本 ⇒ 本来源无法确定 active 版本。
    // 归 `error`（已执行但不可判定）而非 `found`，绝不猜一个出来。
    return { outcome: 'error', errorClass: 'unknown' };
  }
  const [resolved] = found;
  if (found.length > 1) {
    // 同版本多候选：版本可比较（它们本来就一样），但**没有任何事实依据**指认
    // 哪一个快照目录是 active。此时报版本、不报路径。
    return {
      outcome: 'found',
      errorClass: 'multiple-snapshots',
      semver: resolved.semver,
      rawShape: resolved.rawShape,
      installDir: null,
    };
  }
  return {
    outcome: 'found',
    errorClass: null,
    semver: resolved.semver,
    rawShape: resolved.rawShape,
    installDir: resolved.installDir,
  };
}

/**
 * 探针 2 `codex-cli-help`：Codex CLI 自带的 plugin inventory。
 *
 * 偏离说明（plan §4 消解 #3 原文是「`codex --help` / `codex plugin --help` 的 stdout」）：
 * `_grounding.md` §9.7 已实测确证 `codex plugin list --json` 存在且机器可读 ——
 * 先跑一次 help 再跑一次真命令等于双倍子进程开销却零额外信号，故这里直接执行
 * 该子命令；命令不存在时（ENOENT / 非零退出）落 `not-executable` / `error`，
 * 与「help 里查不到这个子命令」在报告语义上等价。
 */
function probeCodexCliInventory(exec, product) {
  const result = runCommand(exec, 'codex', ['plugin', 'list', '--json']);
  if (result.kind === 'error') {
    return {
      outcome: result.errorClass === 'ENOENT' ? 'not-executable' : 'error',
      errorClass: result.errorClass,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { outcome: 'error', errorClass: 'parse-failed' };
  }
  const installed = Array.isArray(parsed?.installed) ? parsed.installed : [];
  const entry = installed.find((item) => item?.name === product && item?.enabled === true);
  if (!entry) return { outcome: 'absent', errorClass: null };
  const normalized = normalizeVersion(typeof entry.version === 'string' ? entry.version : null);
  if (normalized.semver === null) return { outcome: 'absent', errorClass: null };
  return { outcome: 'found', errorClass: null, semver: normalized.semver, rawShape: normalized.rawShape };
}

/** 探针 3 `codex-doctor-checks`：官方体检的 check 集合里是否存在覆盖 plugin 版本的 check */
function probeCodexDoctorChecks(exec, product) {
  const result = runCommand(exec, 'codex', ['doctor', '--json'], { timeout: CODEX_DOCTOR_TIMEOUT_MS });
  if (result.kind === 'error') {
    return {
      outcome: result.errorClass === 'ENOENT' ? 'not-executable' : 'error',
      errorClass: result.errorClass,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { outcome: 'error', errorClass: 'parse-failed' };
  }
  const checks = parsed && typeof parsed.checks === 'object' && parsed.checks !== null ? parsed.checks : {};
  for (const check of Object.values(checks)) {
    const details = check && typeof check.details === 'object' && check.details !== null ? check.details : {};
    const candidate = details[`${product}Version`] ?? details[product];
    const normalized = normalizeVersion(typeof candidate === 'string' ? candidate : null);
    if (normalized.semver !== null) {
      return { outcome: 'found', errorClass: null, semver: normalized.semver, rawShape: normalized.rawShape };
    }
  }
  return { outcome: 'absent', errorClass: null };
}

/**
 * 探针 4 `codex-home-paths`：`$CODEX_HOME/` 下已知路径的 active 标记探测。
 * §9.7 实测：Codex 侧**不存在** `installed_plugins.json` 等价物；本探针把这个否定
 * 结论固化为可复审的排查记录，而不是靠"随手 try 一个路径没找到"。
 */
function probeCodexHomePaths(codexHome, product) {
  // 🔴 W2：`plugins/` 是否存在与 `.codex-global-state.json` 是否存在是**两个独立信号**。
  // 此前 `plugins/` 不在就直接 return，等于把「另一条路径根本没查」写成
  // 「查过了，那里没有」。本探针的价值恰恰在于把否定结论做成可复审的排查记录。
  const statePath = path.join(codexHome, '.codex-global-state.json');
  if (!fileExists(statePath)) return { outcome: 'absent', errorClass: null };
  const read = readTextFile(statePath);
  if (read.kind === 'error') return { outcome: 'error', errorClass: read.errorClass };
  let parsed;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return { outcome: 'error', errorClass: 'parse-failed' };
  }
  const candidate = parsed && typeof parsed === 'object' ? parsed.activePluginVersions?.[product] : undefined;
  const normalized = normalizeVersion(typeof candidate === 'string' ? candidate : null);
  if (normalized.semver === null) return { outcome: 'absent', errorClass: null };
  return { outcome: 'found', errorClass: null, semver: normalized.semver, rawShape: normalized.rawShape };
}

/**
 * 探针 5 `app-server-rpc`：app-server 的可执行性探测。
 *
 * 刻意只查 `--help`（零配额、有界）而不发真实 RPC：本命令是开发者随手跑的诊断，
 * 不应消耗订阅配额，也不应因一次 RPC 挂起而阻塞。
 *
 * 🔴 W2：正因为**没有真的发过 RPC**，`--help` 成功时的结局是 `not-probed` 而**不是**
 * `absent`。`absent` 必须留给「真探测过且确定没有」；把「没查」记成「查过了没有」，
 * 等于凭空为报告增加一条虚假的否定证据。若未来确证存在返回 active plugin 的 RPC
 * 方法，把本探针升级为真实调用后才有资格产出 `absent` / `found`。
 */
function probeAppServerRpc(exec) {
  const result = runCommand(exec, 'codex', ['debug', 'app-server', '--help'], { rpc: true });
  if (result.kind === 'error') {
    return {
      outcome: result.errorClass === 'ENOENT' ? 'not-executable' : 'error',
      errorClass: result.errorClass,
    };
  }
  return { outcome: 'not-probed', errorClass: null };
}

/**
 * 按 `PLUGIN_BUILD_PROBES` 的固定顺序执行全部 5 个排查点。
 * 任一探针抛错记 `error`（仍算「已执行」），**不得**因此跳过其余探针。
 */
function collectPluginBuildProbes({ exec, codexHome, product }) {
  const byId = {
    'codex-plugin-manifest': () => probeCodexPluginManifest(codexHome, product),
    'codex-cli-help': () => probeCodexCliInventory(exec, product),
    'codex-doctor-checks': () => probeCodexDoctorChecks(exec, product),
    'codex-home-paths': () => probeCodexHomePaths(codexHome, product),
    'app-server-rpc': () => probeAppServerRpc(exec),
  };
  const results = [];
  for (const id of PLUGIN_BUILD_PROBES) {
    let outcome;
    try {
      outcome = byId[id]();
    } catch (err) {
      outcome = { outcome: 'error', errorClass: classifyErrorClass(err) };
    }
    results.push({ id, ...outcome });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// check 组装
// ─────────────────────────────────────────────────────────────────────────────

function buildRepoVersionCheck({ product, contract, roots }) {
  const id = `repo-version.${product}`;
  const contractRelPath = toScopedRelPath(contract.absPath, roots);
  if (contract.kind === 'error') {
    return createCheck({
      id,
      category: 'repo-version',
      product,
      status: 'indeterminate',
      summaryCode: 'repo-version-unreadable',
      summaryParams: { errorClass: contract.errorClass },
      details: { contractPath: contractRelPath, errorClass: contract.errorClass },
      remediationCode: 'manual-investigate',
    });
  }
  const normalized = contract.versions[product];
  if (normalized.semver === null) {
    return createCheck({
      id,
      category: 'repo-version',
      product,
      status: 'indeterminate',
      summaryCode: 'repo-version-unparseable',
      summaryParams: { product },
      details: {
        contractPath: contractRelPath,
        versionField: PRODUCT_VERSION_PATHS[product],
        semver: null,
        rawShape: normalized.rawShape,
      },
      remediationCode: 'manual-investigate',
    });
  }
  return createCheck({
    id,
    category: 'repo-version',
    product,
    status: 'ok',
    summaryCode: 'repo-version-read',
    summaryParams: { product, semver: normalized.semver },
    details: {
      contractPath: contractRelPath,
      versionField: PRODUCT_VERSION_PATHS[product],
      semver: normalized.semver,
      rawShape: normalized.rawShape,
    },
  });
}

function buildGlobalCliCheck({ product, exec, repoSemver }) {
  const id = `global-cli.${product}`;
  const binaryName = GLOBAL_CLI_BINARIES[product];
  if (!binaryName) {
    return createCheck({
      id,
      category: 'global-cli',
      product,
      status: 'not-applicable',
      summaryCode: 'global-cli-not-applicable',
      summaryParams: { product },
    });
  }
  const probe = probeGlobalCli(exec, binaryName);
  if (probe.kind === 'error') {
    return createCheck({
      id,
      category: 'global-cli',
      product,
      status: 'indeterminate',
      summaryCode: 'global-cli-unavailable',
      summaryParams: { product, errorClass: probe.errorClass },
      details: { binaryName, errorClass: probe.errorClass, exitCode: probe.exitCode },
      remediationCode: 'upgrade-global-cli',
    });
  }
  if (probe.semver === null) {
    return createCheck({
      id,
      category: 'global-cli',
      product,
      status: 'indeterminate',
      summaryCode: 'global-cli-unparseable',
      summaryParams: { product },
      // 版本行整行语法校验未通过 —— 以固定枚举表达原因，不承载任何原文
      details: { binaryName, semver: null, rawShape: probe.rawShape, errorClass: 'version-parse-failed' },
      remediationCode: 'manual-investigate',
    });
  }
  const details = {
    binaryName,
    semver: probe.semver,
    hadVPrefix: probe.hadVPrefix,
    commitSuffixPresent: probe.commitSuffixPresent,
    rawShape: probe.rawShape,
  };
  if (repoSemver === null) {
    return createCheck({
      id,
      category: 'global-cli',
      product,
      status: 'indeterminate',
      summaryCode: 'global-cli-compare-unavailable',
      summaryParams: { product },
      details,
      remediationCode: 'manual-investigate',
    });
  }
  if (repoSemver === probe.semver) {
    return createCheck({
      id,
      category: 'global-cli',
      product,
      status: 'ok',
      summaryCode: 'global-cli-match',
      summaryParams: { product, semver: probe.semver },
      details,
    });
  }
  return createCheck({
    id,
    category: 'global-cli',
    product,
    status: 'fail',
    summaryCode: 'global-cli-drift',
    summaryParams: { product, semver: repoSemver, observed: probe.semver },
    details,
    remediationCode: 'upgrade-global-cli',
  });
}

function buildPluginBuildCheck({ product, exec, codexHome, repoSemver, roots }) {
  const id = `plugin-build.${product}`;
  const probes = collectPluginBuildProbes({ exec, codexHome, product });
  const probedSources = probes.map((probe) => ({
    id: probe.id,
    outcome: probe.outcome,
    errorClass: probe.errorClass ?? null,
  }));
  // 解析优先级：CLI inventory（级 1）→ 注册表 + 快照 manifest（级 2/3）→ 家目录路径
  const priority = ['codex-cli-help', 'codex-plugin-manifest', 'codex-home-paths', 'codex-doctor-checks'];
  let resolved = null;
  for (const probeId of priority) {
    const hit = probes.find((probe) => probe.id === probeId && probe.outcome === 'found');
    if (hit) {
      resolved = hit;
      break;
    }
  }

  if (resolved === null) {
    return createCheck({
      id,
      category: 'plugin-build',
      product,
      status: 'indeterminate',
      summaryCode: 'plugin-build-unknown',
      summaryParams: { product },
      details: { probedSources },
      remediationCode: 'manual-investigate',
    });
  }

  const details = {
    probedSources,
    semver: resolved.semver,
    rawShape: resolved.rawShape,
  };
  if (resolved.installDir) {
    details.activeInstallPath = toScopedRelPath(resolved.installDir, roots);
  }
  if (repoSemver === null) {
    return createCheck({
      id,
      category: 'plugin-build',
      product,
      status: 'indeterminate',
      summaryCode: 'plugin-build-compare-unavailable',
      summaryParams: { product },
      details,
      remediationCode: 'manual-investigate',
    });
  }
  if (repoSemver === resolved.semver) {
    return createCheck({
      id,
      category: 'plugin-build',
      product,
      status: 'ok',
      summaryCode: 'plugin-build-match',
      summaryParams: { product, semver: resolved.semver },
      details,
    });
  }
  return createCheck({
    id,
    category: 'plugin-build',
    product,
    status: 'fail',
    summaryCode: 'plugin-build-drift',
    summaryParams: { product, semver: repoSemver, observed: resolved.semver },
    details,
    remediationCode: 'reinstall-plugin',
  });
}

/** 只有 spectra 有 MCP server；且它当前**不暴露版本自省能力**，是已知产品缺口 */
function buildMcpServerCheck({ product }) {
  const id = `mcp-server.${product}`;
  if (product !== 'spectra') {
    return createCheck({
      id,
      category: 'mcp-server',
      product,
      status: 'not-applicable',
      summaryCode: 'mcp-server-not-applicable',
      summaryParams: { product },
    });
  }
  return createCheck({
    id,
    category: 'mcp-server',
    product,
    status: 'indeterminate',
    summaryCode: 'mcp-server-known-gap',
    summaryParams: { product },
    details: { probeMethod: 'none-available', knownGap: true },
  });
}

/**
 * 读并**最小校验** `$CODEX_HOME/hooks.json`。
 *
 * 🔴 W3：只判存在性会把「文件在但内容是 `{`」报成 `untrusted` + `grant-hook-trust` ——
 * 那是个误导性结论：真正的问题是配置不可解析，授予信任修不好它。
 * 校验只做到「能解析 + 顶层是对象」为止：再往里断言结构就是在猜 Codex 的 schema，
 * 而 §9.7 明令未经实测确证的形态不得猜测解析。
 *
 * @returns {{present: boolean, probe: {outcome: string, errorClass: string|null}}}
 */
function readHooksJson(hooksJsonPath) {
  if (!fileExists(hooksJsonPath)) {
    return { present: false, probe: { outcome: 'absent', errorClass: null } };
  }
  const read = readTextFile(hooksJsonPath);
  if (read.kind === 'error') {
    return { present: true, probe: { outcome: 'error', errorClass: read.errorClass } };
  }
  let parsed;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return { present: true, probe: { outcome: 'error', errorClass: 'parse-failed' } };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { present: true, probe: { outcome: 'error', errorClass: 'parse-failed' } };
  }
  return { present: true, probe: { outcome: 'found', errorClass: null } };
}

function buildHookTrustCheck({ codexHome, roots }) {
  const hooksJsonPath = path.join(codexHome, 'hooks.json');
  const hooksJson = readHooksJson(hooksJsonPath);

  const configPath = path.join(codexHome, 'config.toml');
  const read = readTextFile(configPath);
  // 🔴 `configProbe` 只承载**文件级**事实（读到了 / 不在 / 读不出），对应输出里的
  // `config-toml-readable`；「hooks.state 段在不在」由 `stateSection` 单独承载，
  // 其探针结局由 core 的 `deriveHooksStateProbe` 从 stateSection 推导，二者不得混用同一条记录。
  let configProbe;
  let stateSection;
  if (read.kind === 'error') {
    if (read.errorClass === 'ENOENT') {
      configProbe = { outcome: 'absent', errorClass: null };
      stateSection = { kind: 'absent' };
    } else {
      configProbe = { outcome: 'error', errorClass: read.errorClass };
      stateSection = { kind: 'unavailable' };
    }
  } else {
    configProbe = { outcome: 'found', errorClass: null };
    stateSection = hasHooksStateSection(read.text)
      ? // 🔴 段的确切形态（键名层级 / 哈希算法 / 哈希输入）未经实测确证（T062 挂账），
        // §9.7 明令此时归 indeterminate 而非猜测解析
        { kind: 'present-unconfirmed' }
      : { kind: 'absent' };
  }

  const verdict = classifyHookTrust({
    hooksJsonPresent: hooksJson.present,
    hooksJsonProbe: hooksJson.probe,
    configProbe,
    stateSection,
    currentHash: null,
  });
  return createCheck({
    id: 'hook-trust',
    category: 'hook-trust',
    product: null,
    status: verdict.status,
    summaryCode: verdict.summaryCode,
    summaryParams: verdict.summaryParams ?? {},
    details: {
      attemptedProbes: verdict.probes,
      trustStatus: verdict.trustStatus,
      hooksJsonPath: toScopedRelPath(hooksJsonPath, roots),
    },
    remediationCode: verdict.remediationCode,
  });
}

/**
 * 四方一致性诊断主入口。
 *
 * @param {{projectRoot: string, codexHome: string,
 *          env?: Record<string, string|undefined>,
 *          exec?: Function, now?: () => Date}} deps
 */
export function runDoctor({ projectRoot, codexHome, env = {}, exec: rawExec = defaultExec, now = () => new Date() }) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new TypeError('runDoctor：projectRoot 必须为非空字符串');
  }
  if (typeof codexHome !== 'string' || codexHome.length === 0) {
    throw new TypeError('runDoctor：codexHome 必须为非空字符串');
  }
  void env; // 🔴 环境变量只用于上游解析 codexHome；诊断本身从不读取、更不输出 env

  const exec = memoizeExec(rawExec);
  const roots = { projectRoot, codexHome };
  const contract = readRepoVersions(projectRoot);
  const repoSemverOf = (product) =>
    contract.kind === 'ok' ? contract.versions[product].semver : null;

  const checks = [];
  for (const product of PRODUCTS) {
    checks.push(buildRepoVersionCheck({ product, contract, roots }));
  }
  for (const product of PRODUCTS) {
    checks.push(buildGlobalCliCheck({ product, exec, repoSemver: repoSemverOf(product) }));
  }
  for (const product of PRODUCTS) {
    checks.push(
      buildPluginBuildCheck({ product, exec, codexHome, repoSemver: repoSemverOf(product), roots }),
    );
  }
  for (const product of PRODUCTS) {
    checks.push(buildMcpServerCheck({ product }));
  }
  checks.push(buildHookTrustCheck({ codexHome, roots }));

  return assembleReport({ checks, generatedAt: now().toISOString() });
}
