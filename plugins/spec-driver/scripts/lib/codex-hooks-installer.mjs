/**
 * codex-hooks-installer.mjs
 * Feature 240 / FR-011 — 向 `$CODEX_HOME/hooks.json` **合并写入**我方 hook 条目
 *
 * ## 这是一份「别人的文件」
 * `$CODEX_HOME/hooks.json` 是 Codex 的**全局唯一共享**声明文件（`_grounding.md` §8.1），
 * 用户自己和其他工具的条目都住在里面。本模块的第一不变量是 **除我方条目外，一个字节都不动**：
 * 顶层未知字段、第三方事件键、甚至形状畸形的第三方条目，一律原样透传。任何"顺手清理"都是
 * 静默数据丢失。
 *
 * ## 为什么是对称实现而不是复用 `src/hooks/hook-installer.ts`（plan §6.1）
 * 那份实现属 npm `spectra` 包（TS，需 `npm run build` 产 dist）；本模块属 spec-driver 插件
 * （纯 `.mjs`，从 plugin cache 直接 `node` 执行，**无构建步骤**）。让插件脚本 import dist 会给
 * 零构建分发模型引入构建期依赖。两侧数据形状也不同构（Claude 扁平 `{matcher, command}[]`，
 * Codex 两级嵌套 `{matcher, hooks: [{type, command}]}[]`）。
 * 漂移风险由 `tests/unit/hook-installer-semantics-parity.test.ts` 补偿：**共享的是"保证"而
 * 非"实现"** —— 同一张七语义合同表对两个 installer 各跑一遍。
 * 同理，下面的 `writeJsonAtomic` 与 `src/utils/atomic-write.ts` 功能重复，这是包边界强制产生的
 * 重复，不是疏漏。
 *
 * ## 归属判定不在本模块定义
 * `isOwnedEntry` 的唯一实现在 `codex-hooks-schema.mjs`（门禁与写入器共用；两处各写一份必然
 * 漂移 —— F238 教训），此处只做 re-export。归属锚点是 `command` 字符串里的**完整相对后缀**
 * （`spec-driver/…/scripts/postinstall.sh` 一类）+ 路径中的 `spec-driver` 目录分量，
 * **不使用任何自定义 JSON 字段**（FR-011.4）。
 *
 * ## 🔴 「共用 `isOwnedEntry`」对漂移是优点，对**过度认领**是结构性失明
 * 共用谓词能保证"写入器认为是自己的"与"门禁认为是我方的"永不漂移，但它同时意味着：任何被
 * 谓词**误判为我方**的第三方条目，会在保全判据的 before/after 两侧被同样摘掉，差异被抹平 ——
 * 判据在数学上无法检出它所依赖的谓词自身的错误，而过度认领恰是唯一会摧毁用户数据的方向。
 * 因此本模块额外提供两条**不依赖归属谓词**的补偿：
 * 1. `projectForeignOnly` 对非对象文档/非对象 `hooks` **保留原值**，杜绝两侧坍缩成同一空壳；
 * 2. 每一条被摘除的 command 逐条写入 `diagnostics`（`owned-entry-removed`）并由 CLI 打印，
 *    使误删可见、可回滚。
 *
 * ⚠️ 这两条补偿都只做到"可见"，**没有**做到"判 fail"。`validate-codex-hooks.mjs` 的命令字面量
 * 存活判据（判据 2）在调用方只声明写入集时确实独立于本谓词；但一旦把 `removedCommands`
 * （由本谓词派生的移除清单）也喂给 `--desired`，误删就会被自动豁免，该判据对这条命令随之
 * 降级为 warning（`foreign-command-removed-by-declaration`）。详见该文件
 * `checkForeignPreservation` 的说明 —— 不要再把它当作"能独立检出归属误认"的防线。
 *
 * 运行相关测试:
 *   npx vitest run tests/unit/codex-hooks-installer.test.ts
 *   npx vitest run tests/unit/hook-installer-semantics-parity.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { collectCommandLiterals, isOwnedEntry } from './codex-hooks-schema.mjs';

export { collectCommandLiterals, isOwnedEntry };

/** Codex 全局 hooks 声明文件名（`$CODEX_HOME` 下唯一位置，无项目级语义） */
export const HOOKS_FILE_NAME = 'hooks.json';

/** 非法 JSON 失败的结构化标识（挂在抛出的 Error 的 `code` 上，供 CLI 分流退出码） */
export const INVALID_JSON_ERROR_CODE = 'CODEX_HOOKS_INVALID_JSON';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析目标文件路径。
 * `codexHome` **必填**：本模块绝不自己去猜全局家目录 —— 家目录解析的唯一事实源是
 * `src/core/codex-home.ts`（Node 侧）与 `scripts/lib/codex-home.sh`（shell 侧），
 * 在这里再写第三份必然漂移，而漂移的后果是把条目写进错误的目录（或从错误的目录删）。
 */
export function resolveHooksPath(codexHome) {
  if (typeof codexHome !== 'string' || codexHome.length === 0) {
    throw new TypeError(
      'codex-hooks-installer: codexHome 必填且必须是非空字符串（请由调用方经 codex-home 解析后显式传入）',
    );
  }
  return path.join(codexHome, HOOKS_FILE_NAME);
}

/**
 * 读取并解析目标文件。
 * 🔴 非法 JSON 一律抛错（FR-011.6）：调用方在此之前**不得**发生任何写操作（含备份、含临时
 * 文件）。静默重建会把用户手写的 hooks 洗成空壳，属不可逆数据丢失；报错要求人工修复是唯一
 * 安全的处置。
 */
function readDocument(targetPath) {
  let raw;
  try {
    raw = fs.readFileSync(targetPath, 'utf-8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, raw: null, doc: {} };
    throw error;
  }
  try {
    return { exists: true, raw, doc: JSON.parse(raw) };
  } catch (error) {
    const failure = new Error(
      `codex-hooks-installer: ${targetPath} 不是合法 JSON（${error.message}）。` +
        '为避免覆盖用户数据，本次未做任何写操作，请手动修复该文件后重试。',
    );
    // 结构化标识：CLI 侧据此把「非法 JSON」与其他失败区分开 —— 前者必须 fail-loud 中断调用方
    // （静默降级会让用户以为 hooks 已装好），后者只告警不阻断 skills 安装（plan §6.6）。
    // 🔴 消费端 MUST 判本字段，不得对错误文案做字符串匹配（文案会变，合同不会）。
    failure.code = INVALID_JSON_ERROR_CODE;
    throw failure;
  }
}

/**
 * 写入落点：目标是符号链接时跟随到真实文件。
 * 用户把 `~/.codex/hooks.json` 软链进 dotfiles 仓库是常见配置；直接 `rename` 到链接路径会把
 * 软链替换成普通文件，等于悄悄拆掉用户的配置管理。链接悬空/不可解析时按字面路径处理。
 */
function resolveWriteTarget(targetPath) {
  try {
    if (fs.lstatSync(targetPath).isSymbolicLink()) return fs.realpathSync(targetPath);
  } catch {
    // 不存在或不可读：按字面路径处理，后续写入自身会给出准确 errno
  }
  return targetPath;
}

/** 目标不存在或权限位读不出时的保守默认（Codex 自己的 `auth.json`/`config.toml` 实测即 0600） */
const DEFAULT_TARGET_MODE = 0o600;

/**
 * 读目标文件当前的权限位（含 setuid/setgid/sticky 高位）。
 * `& 0o7777` 而非 `& 0o777`：后者会把用户刻意设置的高位静默丢掉。
 * 读不到（首次创建 / stat 失败）一律回落最严格的 0600 —— hooks.json 的内容会被 Codex
 * **当命令执行**，宽松 umask 下按默认 mode 创建就是世界可写，等于开一个本地注入面。
 */
function readTargetMode(filePath) {
  try {
    return fs.statSync(filePath).mode & 0o7777;
  } catch {
    return DEFAULT_TARGET_MODE;
  }
}

/**
 * 原子 JSON 写入（tmp + rename）。
 * tmp 文件名带 pid 与随机后缀：并发安装时两个进程各写各的 tmp，`rename` 是同目录内的原子替换，
 * 结果必为其中一方的**完整**文档，不会出现两份内容互相截断。
 * 任一环节失败都清理 tmp，绝不留半截文件在用户的 `$CODEX_HOME` 里。
 *
 * ## 🔴 权限位也是"别人的数据"（F262 / W3）
 * `rename` 替换的是**整个 inode**，权限元数据随新 inode 走：不做处理时用户的 0600 私密配置
 * 会被静默放宽成 0644（umask 000 下更是 0666 世界可写）。故写入前快照目标 mode，写入后按
 * 快照精确恢复：
 * - tmp **创建即 `mode: 0o600`**：`open(2)` 的 mode 受 umask 掩蔽，只会更严不会更松，
 *   因此这一步保证内容从落盘第一刻起就不宽于 0600，消除"chmod 之前以 0644 暴露"的窗口；
 * - 随后 `chmodSync` 精确化（chmod 不受 umask 影响），才能还原 0640 / setgid 这类原值。
 *
 * ⚠️ TOCTOU：stat 与 rename 之间目标 mode 若被并发修改，保全的是"写入开始时的快照"而非
 * 最终值。这不是原子操作，此处显式承认、不加任何伪补偿（重读校验只会把窗口挪个位置）。
 *
 * ⚠️ **保全 ≠ 加固**：已存在文件的宽 mode（用户自己设的 0666）会被如实保全，本函数不做
 * "顺手收紧"（那是替用户改他的配置）。下面 `mode: 0o700` 关闭的注入面只覆盖**首次创建**
 * 的路径分量 —— 已存在的宽目录同样原样不动。
 *
 * 🔴 `diagnostics` 必传（F262 / I-3）：本函数是模块私有的，唯一调用方 `commit` 传的是
 * 上层诊断数组的引用。给默认值会让将来的第二个调用方忘传时把 `target-mode-preserve-failed`
 * 这类告警静默落进一个随即被丢弃的数组里 —— 不给默认值，忘传即 TypeError。
 */
function writeJsonAtomic(filePath, data, { diagnostics }) {
  // 🔴 `mode: 0o700`（F262 / W3）：目录权限也是注入面的一半。umask 000 下按默认 mode 建出的
  // 是 0777 目录，同机任何本地用户都能 unlink 掉那份 0600 的 hooks.json 再放一份自己的进来，
  // 内容会被 Codex 当命令执行 —— 只收紧文件位等于没关门。
  // mkdir 的 mode 只作用于**本次新建**的路径分量；目录已存在时 mkdirSync 不改其 mode。
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const targetMode = readTargetMode(filePath);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  try {
    // `flag: 'wx'`（O_EXCL，F262 / I-1）：tmp 路径若被预置成已有文件或软链，直接报错落进下面的
    // 清理分支，而不是顺着别人的软链把内容写到未知位置。
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    });
    // 🔴 chmod 失败**不阻断安装**：无权限位的文件系统（exFAT / SMB / 部分容器 overlay）上
    // "权限被放宽"这个风险面本就不存在，让锦上添花的元数据动作反过来把本可正常写入的
    // hooks 拦下来，是新增了一个此前不存在的阻断面。此时最终权限仍不宽于 0600（tmp 的创建
    // mode），只是没能精确匹配原文件可能更严格的形态，故记 warning 让用户可核对。
    try {
      fs.chmodSync(tmpPath, targetMode);
    } catch (error) {
      diagnostics.push({
        level: 'warning',
        code: 'target-mode-preserve-failed',
        errno: error && typeof error === 'object' ? (error.code ?? null) : null,
      });
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw error;
  }
}

/**
 * 从一个事件的 group 数组中摘掉我方 handler。
 *
 * 保留规则（每一条都是"别人的数据"）：
 * - group 非对象、或 `group.hooks` 非数组 → 整组原样保留（不是我方写出的形状，不得当垃圾清掉）；
 * - group 内还剩非我方 handler → 保留该 group，仅替换其 `hooks` 数组，其余字段（含未知字段）透传；
 * - group 内**原本就只有**我方 handler 且已被摘空 → 整组删除（我方自己制造的空壳，留着是噪声）。
 *
 * @returns {{groups: unknown[], removedCommands: string[]}}
 */
function stripOwnedHandlers(groups) {
  const out = [];
  const removedCommands = [];
  for (const group of groups) {
    if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
      out.push(group);
      continue;
    }
    const kept = [];
    let dropped = 0;
    for (const handler of group.hooks) {
      if (isPlainObject(handler) && isOwnedEntry(handler.command)) {
        dropped += 1;
        removedCommands.push(String(handler.command));
        continue;
      }
      kept.push(handler);
    }
    if (dropped === 0) {
      out.push(group);
      continue;
    }
    if (kept.length === 0) continue;
    out.push({ ...group, hooks: kept });
  }
  return { groups: out, removedCommands };
}

/**
 * 摘掉全文件的我方条目，返回新的 `hooks` 映射。
 * @returns {{hooks: Record<string, unknown>, removed: number, removedCommands: string[],
 *            emptiedEvents: Set<string>}}
 */
function stripOwnedFromHooks(sourceHooks) {
  const hooks = {};
  const emptiedEvents = new Set();
  const removedCommands = [];
  for (const [event, value] of Object.entries(sourceHooks)) {
    if (!Array.isArray(value)) {
      // 事件值非数组：不是我方写出的形状，原样保留（是否替换由 install 侧按"我方是否要写该事件"决定）
      hooks[event] = value;
      continue;
    }
    const result = stripOwnedHandlers(value);
    removedCommands.push(...result.removedCommands);
    hooks[event] = result.groups;
    if (result.removedCommands.length > 0 && result.groups.length === 0) emptiedEvents.add(event);
  }
  return { hooks, removed: removedCommands.length, removedCommands, emptiedEvents };
}

/**
 * 把「本轮被摘除、且不会被重新写回」的 command 逐条登记为诊断（FR-011.4 的可观测性补偿）。
 *
 * 归属判定的误认方向会删除用户数据，而误认在结构上无法被共用同一谓词的判据检出。既然低概率
 * 误删无法完全排除，就 MUST 让它**可见、可回滚**：每条真正消失的 command 都进 diagnostics，
 * 由 CLI 逐条打印，配合 `.bak` 即可人工还原。
 *
 * 只登记「真正消失」的那些：安装时被摘掉又原样写回的我方条目（幂等的正常路径）不是删除，
 * 报出来只会淹没真信号。
 *
 * 🔴 返回值（F262 / W1b）：同一份「真正消失」的清单同时以**数据**形式回传。
 * `--desired` 的合同语义是"本轮写入器声明**写入/移除**的条目"，但此前移除只进 diagnostics，
 * 在数据面没有一等出口 —— 于是插件升版（旧路径命令被摘除重写）时，调用方无从声明"删了什么"，
 * 保全判据 2（`foreign-command-lost`）每次升版都误报。
 *
 * ⚠️ 这份清单**由归属谓词派生**（谁被摘掉是 `isOwnedEntry` 说了算），因此它当减数时会一并
 * 豁免掉谓词误认造成的误删。门禁侧据此把这部分豁免打成 warning，不要指望它还能判 fail。
 *
 * @returns {string[]} 本轮真正消失（未被重新写回）的 command 字面量
 */
function reportRemovedCommands(diagnostics, removedCommands, reinstatedCommands = []) {
  const reinstated = new Set(reinstatedCommands);
  const trulyRemoved = [];
  for (const command of removedCommands) {
    if (reinstated.has(command)) continue;
    trulyRemoved.push(command);
    diagnostics.push({ level: 'warning', code: 'owned-entry-removed', command });
  }
  return trulyRemoved;
}

/** 收集 `entries` 中我方本轮声明要写入的 command 字面量 */
function desiredCommands(entries) {
  const out = [];
  for (const groups of Object.values(entries.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) continue;
      for (const handler of group.hooks) {
        if (isPlainObject(handler) && typeof handler.command === 'string') out.push(handler.command);
      }
    }
  }
  return out;
}

/** 结构等价判定。两侧都由本模块按"保留原 key 顺序"构造，故 JSON 文本比较是可靠的等价判据。 */
function structurallyEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 提交一次写入：备份 → 原子写。
 *
 * 🔴 `.bak` 只在**尚不存在时**创建（`COPYFILE_EXCL`）。仅靠"无变更就不写"是不够的：
 * 插件版本升级（pluginRoot 从 `…/4.3.0` 变 `…/4.4.0`）是真实语义变更，第二次安装确有写入，
 * 若此时覆写备份，用户**原始**的 `hooks.json` 备份就永久消失了 —— 与归属误认叠加即成不可逆
 * 数据丢失。备份的价值恰恰在于"最早那一份"，而不是"上一次合并的结果"。
 */
function commit({ targetPath, exists, nextDoc, diagnostics = [] }) {
  const writeTarget = resolveWriteTarget(targetPath);
  let backupPath = null;
  if (exists) {
    backupPath = `${writeTarget}.bak`;
    try {
      fs.copyFileSync(writeTarget, backupPath, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        diagnostics.push({ level: 'info', code: 'backup-already-exists', path: backupPath });
      } else {
        throw error;
      }
    }
  }
  // 透传同一个 diagnostics 数组引用：权限保全失败的告警汇入既有诊断通道，无需新建返回面
  writeJsonAtomic(writeTarget, nextDoc, { diagnostics });
  return backupPath;
}

/**
 * 合并安装我方 hook 条目。
 *
 * @param {{codexHome: string, entries: {hooks: Record<string, unknown[]>}}} args
 *   `entries` 是 `codex-hooks-generator.mjs` 的产物（路径已展开为绝对路径）。
 * @returns {{ok: boolean, changed: boolean, targetPath: string, backupPath: string|null,
 *            ownedCount: number, writtenCommands: string[], removedCommands: string[],
 *            diagnostics: Array<{level: string, code: string, command?: string}>}}
 *   `writtenCommands` / `removedCommands` 合起来就是「本轮写入器自己声明动过的条目」，
 *   可整份喂给 `validate-codex-hooks.mjs --desired`（保全判据的减数）。
 *   ⚠️ 两者的可信度不同：前者是我方生成器的产物（与归属谓词无关），后者由谓词派生 ——
 *   门禁会对后者带来的豁免逐条打 warning，见该文件 `checkForeignPreservation`。
 */
export function installCodexHooks({ codexHome, entries } = {}) {
  const targetPath = resolveHooksPath(codexHome);
  if (!isPlainObject(entries) || !isPlainObject(entries.hooks)) {
    throw new TypeError('codex-hooks-installer: entries 必须是 { hooks: {...} } 形态的对象');
  }

  const diagnostics = [];
  /** 本轮写入器**自己声明**要写入的 command 字面量（保全判据的减数，见 validate CLI 的 --desired） */
  const writtenCommands = desiredCommands(entries);
  const { exists, doc } = readDocument(targetPath);

  let base = doc;
  if (!isPlainObject(base)) {
    if (exists) diagnostics.push({ level: 'warning', code: 'document-not-object-replaced' });
    base = {};
  }
  let sourceHooks = base.hooks;
  if (!isPlainObject(sourceHooks)) {
    if (sourceHooks !== undefined) {
      diagnostics.push({ level: 'warning', code: 'hooks-field-not-object-replaced' });
    }
    sourceHooks = {};
  }

  // 1) 摘掉全文件的我方旧条目 —— 跨事件摘，覆盖"上个版本把条目写到别的事件上"的历史包袱
  const stripped = stripOwnedFromHooks(sourceHooks);
  const nextHooks = stripped.hooks;
  // 被摘掉又原样写回的不算删除；只有真正消失的（旧版本路径 / 归属误认）才登记
  /** 本轮写入器**自己声明**移除的 command 字面量（与 `writtenCommands` 同为保全判据的减数） */
  const removedCommands = reportRemovedCommands(diagnostics, stripped.removedCommands, writtenCommands);

  // 2) 追加本次要写入的条目，落在既有第三方条目**之后**（不打乱他人顺序）
  const desiredEvents = new Set(Object.keys(entries.hooks));
  for (const event of desiredEvents) {
    const desired = Array.isArray(entries.hooks[event]) ? entries.hooks[event] : [];
    const current = nextHooks[event];
    let preserved;
    if (Array.isArray(current)) {
      preserved = current;
    } else if (current === undefined) {
      preserved = [];
    } else {
      preserved = [];
      diagnostics.push({ level: 'warning', code: 'event-value-not-array-replaced', event });
    }
    nextHooks[event] = [...preserved, ...desired];
  }

  // 3) 只删「因摘掉我方条目而变空、且本次也不再写入」的事件键；用户自己留下的空数组不动
  for (const event of stripped.emptiedEvents) {
    if (!desiredEvents.has(event) && Array.isArray(nextHooks[event]) && nextHooks[event].length === 0) {
      delete nextHooks[event];
    }
  }

  const nextDoc = { ...base, hooks: nextHooks };
  const ownedCount = countOwnedHandlers(nextDoc);

  // 无语义变更时一个字节都不写：既保住用户的原始缩进/格式，也保住最初那份 .bak
  const changed = !exists || !structurallyEqual(doc, nextDoc);
  if (!changed) {
    return {
      ok: true,
      changed: false,
      targetPath,
      backupPath: null,
      ownedCount,
      writtenCommands,
      removedCommands,
      diagnostics,
    };
  }

  const backupPath = commit({ targetPath, exists, nextDoc, diagnostics });
  return {
    ok: true,
    changed: true,
    targetPath,
    backupPath,
    ownedCount,
    writtenCommands,
    removedCommands,
    diagnostics,
  };
}

/**
 * 精确卸载：只摘掉我方条目。
 *
 * @param {{codexHome: string}} args
 * @returns {{ok: boolean, changed: boolean, removedCount: number, removedCommands?: string[],
 *            targetPath: string, backupPath: string|null,
 *            diagnostics: Array<{level: string, code: string, command?: string}>}}
 */
export function removeCodexHooks({ codexHome } = {}) {
  const targetPath = resolveHooksPath(codexHome);
  const diagnostics = [];
  const { exists, doc } = readDocument(targetPath);

  if (!exists) {
    diagnostics.push({ level: 'info', code: 'target-missing' });
    return { ok: true, changed: false, removedCount: 0, targetPath, backupPath: null, diagnostics };
  }
  if (!isPlainObject(doc) || !isPlainObject(doc.hooks)) {
    // 没有可识别的 hooks 结构 ⇒ 没有我方条目可删。此处**不做任何修复性写入**：
    // 卸载路径去改一份本就不认识的文档，只会平添数据丢失面。
    diagnostics.push({ level: 'info', code: 'nothing-to-remove' });
    return { ok: true, changed: false, removedCount: 0, targetPath, backupPath: null, diagnostics };
  }

  const stripped = stripOwnedFromHooks(doc.hooks);
  if (stripped.removed === 0) {
    diagnostics.push({ level: 'info', code: 'nothing-to-remove' });
    return { ok: true, changed: false, removedCount: 0, targetPath, backupPath: null, diagnostics };
  }

  for (const event of stripped.emptiedEvents) delete stripped.hooks[event];
  // 卸载路径下被摘掉的条目全部真正消失 —— 逐条登记，误删可见可回滚
  reportRemovedCommands(diagnostics, stripped.removedCommands);

  const nextDoc = { ...doc, hooks: stripped.hooks };
  const backupPath = commit({ targetPath, exists: true, nextDoc, diagnostics });
  return {
    ok: true,
    changed: true,
    removedCount: stripped.removed,
    removedCommands: stripped.removedCommands,
    targetPath,
    backupPath,
    diagnostics,
  };
}

/** 非对象文档 / 非对象 `hooks` 的原值保留槽（见 `projectForeignOnly` 的说明） */
export const RAW_DOCUMENT_KEY = '__codexHooksNonObjectDocument';
export const RAW_HOOKS_KEY = '__codexHooksNonObjectHooks';

/**
 * 把文档投影成「只剩第三方内容」的形态：摘掉全部我方条目，并丢弃因此变空的 group 与事件键。
 *
 * 用途是**第三方数据保全的机械判据**：安装前后各投影一次，两份投影必须逐字节相等
 * （SC-001 / plan §6.4 第 3 处校验对象的附加断言）。
 *
 * 🔴 非对象输入 MUST 保留原值，不得坍缩成 `{hooks:{}}`。
 * 早期实现对非对象 `doc` 直接返回 `{hooks:{}}`、对非对象 `doc.hooks` 取 `{}`，实测后果是：
 * 用户文档为 `[{...}]`（顶层数组）或 `hooks` 为数组时，安装器会整份替换掉用户内容，而**投影
 * 后两侧都是同一个空壳** ⇒ 判据报 pass，用户数据已丢。保留原值让两侧结构上不可能相等，
 * 该破坏路径立刻变红。
 *
 * ⚠️ 本判据仍与写入器共用 `isOwnedEntry`，因此**检不出归属谓词自身的过度认领**（见模块头部）。
 * 那一维交给 `validate-codex-hooks.mjs` 的命令字面量存活判据：只有当 `--desired` 不含
 * 由本谓词派生的 `removedCommands` 时它才判 fail；含时降级为 warning 级审计信号。
 */
export function projectForeignOnly(doc) {
  if (!isPlainObject(doc)) return { [RAW_DOCUMENT_KEY]: doc };
  if (doc.hooks !== undefined && !isPlainObject(doc.hooks)) {
    return { ...doc, hooks: { [RAW_HOOKS_KEY]: doc.hooks } };
  }
  const sourceHooks = isPlainObject(doc.hooks) ? doc.hooks : {};
  const stripped = stripOwnedFromHooks(sourceHooks);
  for (const event of stripped.emptiedEvents) delete stripped.hooks[event];
  return { ...doc, hooks: stripped.hooks };
}

/** 统计文档中我方 handler 的数量（供调用方与测试断言使用） */
export function countOwnedHandlers(doc) {
  if (!isPlainObject(doc) || !isPlainObject(doc.hooks)) return 0;
  let count = 0;
  for (const groups of Object.values(doc.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) continue;
      for (const handler of group.hooks) {
        if (isPlainObject(handler) && isOwnedEntry(handler.command)) count += 1;
      }
    }
  }
  return count;
}
