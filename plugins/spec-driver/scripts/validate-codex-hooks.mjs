#!/usr/bin/env node
/**
 * validate-codex-hooks.mjs
 * Feature 240 / T024 — Codex hooks 声明的两层门禁 CLI（FR-002 / SC-001 / SC-002）
 *
 * ## 🔴 判定作用域（plan §6.4 / C4）：只判我方的那部分
 * `$CODEX_HOME/hooks.json` 是**全局唯一共享**文件，用户和其他工具的条目都住在里面。因此：
 * - 「恰四事件」只对 **owned 条目覆盖的事件集合**成立，不是对整份文件的事件集合；
 * - 用户已有的合法第三方条目（如 `PermissionRequest`）必须保留，且**不判 fail**；
 * - 最终文件里出现未知事件名（Codex 版本演进会扩充全集）→ **warning 而非 fail**。
 *
 * 反过来说：把这三条写反，本门禁就变成了「用我方校验逼用户删自己的数据」，与 FR-011 的
 * 非破坏性合并直接冲突。这是本文件存在的主要风险面，改动前请先读 `codex-hooks-schema.mjs`
 * 顶部的作用域表。
 *
 * ## 退出码合同（消费端按码分流，勿改语义）
 * | 码 | 含义 |
 * |---|---|
 * | 0 | pass 或 warning（含"有第三方未知事件名"的情形） |
 * | 1 | fail：我方条目违反 schema 层或产品层判据 / 第三方数据未被保全 |
 * | 2 | 无法判定：参数缺失、目标不存在或不可读、目标不是合法 JSON |
 *
 * 第三方数据保全有**两条 fail code**（见 `checkForeignPreservation`）：
 * `foreign-entries-mutated`（结构投影不等）与 `foreign-command-lost`（命令字面量未声明地消失）；
 * 外加一条 warning：`foreign-command-removed-by-declaration` —— 命令的消失被 `--desired` 里
 * **由归属谓词派生**的 `removedCommands` 豁免掉了，不阻断但要人工过目。
 *
 * 🔴 2 与 1 必须分开：「读不到就当通过」是静默假成功，「读不到就当失败」会让门禁在无关的
 * 环境问题上误报。二者都得能被调用方区分出来。
 *
 * ## 用法
 *   node validate-codex-hooks.mjs --target "$CODEX_HOME/hooks.json" [--format json]
 *   node validate-codex-hooks.mjs --codex-home "$CODEX_HOME" [--baseline <安装前快照>]
 *   node validate-codex-hooks.mjs --target plugins/spec-driver/hooks/hooks.json --canonical-source
 *
 * 选项：
 *   --target <path>        被校验文件（与 --codex-home 二选一）
 *   --codex-home <dir>     取 <dir>/hooks.json 为被校验文件
 *   --baseline <path>      安装前的文件快照；据此断言**第三方条目逐字节保留**
 *   --desired <path>       本轮写入器**自己声明**写入/移除的条目（command 字符串数组、
 *                          `install-codex-hooks.mjs --json` / `--remove --json` 的完整输出、
 *                          或 `{hooks:{...}}` 文档）。只有它们被允许从 baseline 中消失。
 *                          升版换路径时把 `install --json` 的 stdout 整份喂进来即可
 *                          （写入 ∪ 移除都算声明过），代价是 `removedCommands` 覆盖到的消失
 *                          只降级为 warning，不再判 fail。
 *   --canonical-source     被校验对象是 canonical hooks.json（含 ${CLAUDE_PLUGIN_ROOT} 占位）
 *   --skip-shape           跳过我方 command 的形状校验（绝对路径 / 无插值 / type / 脚本存在）
 *   --format json|text     输出格式，默认 text
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { collectCommandLiterals, validateCodexHooksDocument } from './lib/codex-hooks-schema.mjs';
import {
  HOOKS_FILE_NAME,
  RAW_DOCUMENT_KEY,
  RAW_HOOKS_KEY,
  projectForeignOnly,
} from './lib/codex-hooks-installer.mjs';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';

export const EXIT_OK = 0;
export const EXIT_GATE_FAIL = 1;
export const EXIT_UNDETERMINED = 2;

class UndeterminedError extends Error {}

function parseArgs(argv) {
  const args = {
    target: null,
    codexHome: null,
    baseline: null,
    desired: null,
    canonicalSource: false,
    skipShape: false,
    format: 'text',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new UndeterminedError(`${token} 缺少取值`);
      i += 1;
      return value;
    };
    switch (token) {
      case '--target':
        args.target = next();
        break;
      case '--codex-home':
        args.codexHome = next();
        break;
      case '--baseline':
        args.baseline = next();
        break;
      case '--desired':
        args.desired = next();
        break;
      case '--canonical-source':
        args.canonicalSource = true;
        break;
      case '--skip-shape':
        args.skipShape = true;
        break;
      case '--format':
        args.format = next();
        break;
      default:
        throw new UndeterminedError(`未知参数: ${token}`);
    }
  }
  if (args.format !== 'text' && args.format !== 'json') {
    throw new UndeterminedError(`--format 只接受 text|json，收到 ${args.format}`);
  }
  // 空串等同未给出（与 codex-home.sh 的既定语义一致），且错误文案必须点名参数本身
  if (args.codexHome !== null && args.codexHome.length === 0) {
    throw new UndeterminedError('--codex-home 取值为空串；请给出非空目录，或改用 --target <path>');
  }
  if (args.target !== null && args.target.length === 0) {
    throw new UndeterminedError('--target 取值为空串；请给出被校验文件路径');
  }
  if (args.target === null && args.codexHome === null) {
    throw new UndeterminedError('必须给出 --target <path> 或 --codex-home <dir>');
  }
  // --desired 只在保全判据里当减数用；没有 --baseline 时它完全不参与判定。
  // 静默忽略会让"调用方以为门禁在跑保全检查"这类接线错误无声通过 —— 必须 fail-loud。
  if (args.desired !== null && args.baseline === null) {
    throw new UndeterminedError('--desired 必须与 --baseline 同时给出（它只在保全判据里当减数）');
  }
  if (args.target === null) args.target = path.join(args.codexHome, HOOKS_FILE_NAME);
  return args;
}

function readDoc(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (error) {
    throw new UndeterminedError(`无法读取${label} ${file}：${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new UndeterminedError(`${label} ${file} 不是合法 JSON：${error.message}`);
  }
}

/**
 * `install-codex-hooks.mjs --json` 的输出形态判据（F262 / W1b、W-2）。
 *
 * 🔴 判定按**优先级**，不是"三形态结构互斥"（那个论断是错的：
 * `{"hooks":{…},"writtenCommands":[]}` 两边特征都占，实测走本分支、`hooks` 里的命令不进减数）。
 * 优先级即：顶层对象上只要**物理存在** `writtenCommands` 或 `removedCommands` 之一，
 * 就按 install/remove 结果对象解读，其余情形才回落到 `{hooks:{...}}` 文档。
 *
 * 为什么两个字段都要认：`--remove --json` 的输出只有 `removedCommands`（无 `writtenCommands`），
 * 此前会被当成生成器文档、`collectCommandLiterals` 取到空集 —— 卸载后跑保全门禁凭空多出
 * 5 条 `foreign-command-lost`（假 fail 方向）。
 */
function isInstallResultShape(parsed) {
  if (!isPlainObject(parsed)) return false;
  return (
    Object.prototype.hasOwnProperty.call(parsed, 'writtenCommands') ||
    Object.prototype.hasOwnProperty.call(parsed, 'removedCommands')
  );
}

/**
 * 读结果对象里的一个命令清单字段。
 * 缺失 / `null` 视为空集（`--remove --json` 在"无可删条目"时不带 `removedCommands`）；
 * 存在但不是字符串数组 → fail-loud（与数组形态"非字符串就 throw"同策略）。
 * 🔴 绝不静默滤成空集：减数被悄悄清空会把正常升版判成第三方数据丢失，是假 fail 方向，
 * 而假 fail 的代价是调用方学会忽略这条门禁。
 */
function readCommandListField(parsed, field, file) {
  const value = parsed[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new UndeterminedError(
      `本轮写入声明 ${file} 的 ${field} 必须是 command 字符串数组或 null`,
    );
  }
  return value;
}

/**
 * 写入 ∪ 移除，去重后作为保全判据的减数。
 * @returns {{declared: string[], derivedFromOwnership: string[]}}
 *   `derivedFromOwnership` 是**只**由 `removedCommands` 贡献的那部分 —— 它由归属谓词派生，
 *   命中豁免时要打 warning（见 `checkForeignPreservation`）。
 */
function collectInstallResultCommands(parsed, file) {
  const written = readCommandListField(parsed, 'writtenCommands', file);
  const removed = readCommandListField(parsed, 'removedCommands', file);
  const writtenSet = new Set(written);
  return {
    declared: [...new Set([...written, ...removed])],
    derivedFromOwnership: [...new Set(removed.filter((command) => !writtenSet.has(command)))],
  };
}

/**
 * 从 `--desired` 文件读出「本轮写入器自己声明写入/移除的 command 字面量」。
 * 接受三种形态：command 字符串数组、`install/remove --json` 的完整结果对象、`{hooks:{...}}`
 * 文档（生成器产物）。
 *
 * 🔴 减数的两种来源可信度不同，必须分开返回（F262 / C1）：
 * - 数组形态、`{hooks:{...}}` 文档、结果对象里的 `writtenCommands` —— 是调用方或生成器对
 *   **写入**的声明，与 `isOwnedEntry` 无关；
 * - 结果对象里的 `removedCommands` —— **由归属谓词派生**（谁被摘掉是 `isOwnedEntry` 说了算），
 *   谓词误认第三方条目时，误删会随之进减数、把判据 2 对该条命令关掉。
 * 后者记进 `derivedFromOwnership`，由上层降级为 warning 并列进报告，绝不静默豁免。
 *
 * @returns {{declared: string[], derivedFromOwnership: string[]}}
 */
function readDesiredDeclaration(file) {
  const parsed = readDoc(file, '本轮写入声明');
  if (Array.isArray(parsed)) {
    if (!parsed.every((item) => typeof item === 'string')) {
      throw new UndeterminedError(`本轮写入声明 ${file} 必须是 command 字符串数组`);
    }
    return { declared: parsed, derivedFromOwnership: [] };
  }
  if (isInstallResultShape(parsed)) return collectInstallResultCommands(parsed, file);
  return { declared: collectCommandLiterals(parsed), derivedFromOwnership: [] };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 比较语义豁免：**用户预存的空数组事件键**（F262 / W1a）。
 *
 * 症状：用户文件里有 `{"hooks":{"Stop":[]}}` 这种空事件键，安装器把我方条目追加进 `Stop`，
 * 投影时这些条目被摘掉又让该事件变空 ⇒ `emptiedEvents` 把键删掉；而 baseline 侧的空键
 * 原样保留 —— 同一次安装在两侧产生了不同的规范化，字节比较不等，报 `foreign-entries-mutated`
 * 而 `lostCommands` 为空（零数据丢失的纯误报）。
 *
 * 判据：baseline 投影中值为**空数组**的事件键，当且仅当同时满足以下两条时豁免 ——
 * 1. 该键在 after 的**原始文档** `hooks` 对象里**物理存在**（键没被删）；
 * 2. 该键在 after 的**投影**里**已不存在**（内容全是我方条目，strip 后整键被丢弃）。
 *
 * 🔴 第 2 条是内容判据，缺了它豁免就是内容盲（F262 / W-1，两向实测）：
 * - `Stop: [{command:"bash /tmp/evil/backdoor.sh"}]`（注入）—— 第三方内容 strip 不掉，
 *   after 投影里该键仍在，只查第 1 条会把注入豁免成 pass；
 * - `Stop: null`（类型销毁）—— 键还在但值已不是数组，投影原样保留该键，同样被假豁免。
 * 合法安装的归一化终态恰恰是"after 投影里没有该键"，故加上第 2 条对真误报零代价。
 *
 * 🔴 豁免为什么不会变成"任你删"：
 * - 第 1 条挡住"整键被删"（变异 M1）：after 文档没有该键 → 不豁免 → 照样判 fail；
 * - `RAW_DOCUMENT_KEY` / `RAW_HOOKS_KEY` 显式排除：`doc.hooks = []` 时 RAW 槽的值恰好
 *   也是空数组，若按"值是空数组"一刀切，用户整份 hooks 被替换会坍缩成同一空壳而假 pass；
 * - 只动结构投影这一条口径，命令字面量存活口径（`lostCommands`）完全不受影响。
 *
 * @returns {[unknown, unknown]} 豁免后的 `[before, after]` 投影（纯函数，不改动入参）
 */
function exemptEmptyEventKeys(beforeProjected, afterProjected, afterDoc) {
  const unchanged = [beforeProjected, afterProjected];
  if (!isPlainObject(beforeProjected) || !isPlainObject(afterProjected)) return unchanged;
  if (!isPlainObject(beforeProjected.hooks) || !isPlainObject(afterProjected.hooks)) return unchanged;
  const afterDocHooks = isPlainObject(afterDoc) ? afterDoc.hooks : undefined;
  if (!isPlainObject(afterDocHooks)) return unchanged;

  const exempt = [];
  for (const [event, value] of Object.entries(beforeProjected.hooks)) {
    if (event === RAW_DOCUMENT_KEY || event === RAW_HOOKS_KEY) continue;
    if (!Array.isArray(value) || value.length !== 0) continue;
    if (!Object.prototype.hasOwnProperty.call(afterDocHooks, event)) continue;
    // 内容判据：after 投影里还留着该键 ⇒ 里面有非我方内容（注入 / 非数组值），不豁免
    if (Object.prototype.hasOwnProperty.call(afterProjected.hooks, event)) continue;
    exempt.push(event);
  }
  if (exempt.length === 0) return unchanged;

  const strip = (projected) => {
    const hooks = { ...projected.hooks };
    for (const event of exempt) delete hooks[event];
    return { ...projected, hooks };
  };
  return [strip(beforeProjected), strip(afterProjected)];
}

/**
 * 第三方数据保全判据 —— **两条相互独立的口径，缺一不可**。
 *
 * 1. **结构投影**（`projectForeignOnly` 两侧逐字节相等）：能抓住整份文档 / 整个事件块被替换、
 *    第三方 group 被打乱等结构性破坏。
 * 2. **命令字面量存活**：`after ⊇ (baseline − desired)`。
 *
 * 🔴 为什么必须有第 2 条：第 1 条的投影与写入器**共用同一个 `isOwnedEntry`**。凡被该谓词
 * 误判为我方的第三方条目，会在 before/after 两个投影里被同样摘掉 —— 判据在数学上无法检出
 * 它所依赖的谓词自身的错误，而"过度认领"恰是唯一会摧毁用户数据的方向。第 2 条改用
 * **写入器自己声明动过什么**（`--desired`）当减数。
 *
 * 🔴 但第 2 条的独立性**取决于减数的来源**（F262 / C1，如实登记）：
 * | 减数来源 | 是否经过归属谓词 | 误删时判据 2 的表现 |
 * |---|---|---|
 * | command 字符串数组 / `{hooks:{...}}` 文档 / 结果对象的 `writtenCommands` | 否 | 仍判 **fail** |
 * | 结果对象的 `removedCommands`（第三形态自动携带） | **是**（谓词决定摘谁） | 降级为 **warning** |
 * 也就是说：把 `install --json` 整份喂进来换取"升版零误报"，代价是判据 2 对被谓词误认的那条
 * 命令不再判 fail。判据本身**无法区分**"真升版摘掉旧路径"与"误认摘掉第三方条目"——
 * 二者在数据面完全同形。故对每一条**仅因 `removedCommands` 而被豁免**的 baseline 消失命令，
 * 产出 `foreign-command-removed-by-declaration`（warning，不改退出码），并列进
 * `removedByDeclaration`：不阻断 CI，但在日志与报告里留下可审计的一行"有条目经声明消失，
 * 请人工过目"。
 *
 * 🔴 `--desired` 缺省时减数为空集（最严格口径）：baseline 里的任何 command 消失都判 fail。
 * 需要合法删除旧条目（版本升级换路径、卸载）时，调用方 MUST 显式声明删了什么。
 */
function checkForeignPreservation(baselineFile, targetDoc, desiredFile) {
  const baselineDoc = readDoc(baselineFile, '基线快照');
  const [beforeProjected, afterProjected] = exemptEmptyEventKeys(
    projectForeignOnly(baselineDoc),
    projectForeignOnly(targetDoc),
    targetDoc,
  );
  const before = JSON.stringify(beforeProjected);
  const after = JSON.stringify(afterProjected);

  const declaration =
    desiredFile === null
      ? { declared: [], derivedFromOwnership: [] }
      : readDesiredDeclaration(desiredFile);
  const allowedToDisappear = new Set(declaration.declared);
  const ownershipDerived = new Set(declaration.derivedFromOwnership);
  const survivors = new Set(collectCommandLiterals(targetDoc));
  const disappeared = [
    ...new Set(collectCommandLiterals(baselineDoc).filter((command) => !survivors.has(command))),
  ];
  const lostCommands = disappeared.filter((command) => !allowedToDisappear.has(command));
  const removedByDeclaration = disappeared.filter(
    (command) => allowedToDisappear.has(command) && ownershipDerived.has(command),
  );

  return {
    checked: true,
    ok: before === after && lostCommands.length === 0,
    projectionEqual: before === after,
    baseline: baselineFile,
    desired: desiredFile,
    lostCommands,
    removedByDeclaration,
    ...(before === after ? {} : { before, after }),
  };
}

export function runValidation(argv) {
  const args = parseArgs(argv);
  const doc = readDoc(args.target, '目标文件');

  const report = validateCodexHooksDocument(doc, {
    checkCommandShape: !args.skipShape && !args.canonicalSource,
    canonicalSource: args.canonicalSource,
    pathExists: (p) => fs.existsSync(p),
  });

  const findings = [...report.findings];
  let foreignPreservation = {
    checked: false,
    ok: true,
    projectionEqual: true,
    baseline: null,
    desired: null,
    lostCommands: [],
    removedByDeclaration: [],
  };
  if (args.baseline !== null) {
    foreignPreservation = checkForeignPreservation(args.baseline, doc, args.desired);
    if (!foreignPreservation.projectionEqual) {
      findings.push({
        level: 'fail',
        layer: 'preservation',
        code: 'foreign-entries-mutated',
        baseline: args.baseline,
      });
    }
    // 减数不含该命令时，判据 2 独立于投影判据：即使投影相等（归属谓词过度认领会把差异抹平），
    // 命令消失仍判 fail
    for (const command of foreignPreservation.lostCommands) {
      findings.push({
        level: 'fail',
        layer: 'preservation',
        code: 'foreign-command-lost',
        baseline: args.baseline,
        command,
      });
    }
    // 🔴 由归属谓词派生的 `removedCommands` 换来的豁免：不改退出码，但必须留痕可审计
    //（判据无法区分"真升版"与"归属误认误删"，见 checkForeignPreservation）
    for (const command of foreignPreservation.removedByDeclaration) {
      findings.push({
        level: 'warning',
        layer: 'preservation',
        code: 'foreign-command-removed-by-declaration',
        baseline: args.baseline,
        command,
      });
    }
  }

  const hasFail = findings.some((f) => f.level === 'fail');
  const hasWarning = findings.some((f) => f.level === 'warning');
  return {
    schemaVersion: 1,
    target: args.target,
    ok: !hasFail,
    status: hasFail ? 'fail' : hasWarning ? 'warning' : 'pass',
    ownedEvents: report.ownedEvents,
    foreignEvents: report.foreignEvents,
    foreignPreservation,
    findings,
    exitCode: hasFail ? EXIT_GATE_FAIL : EXIT_OK,
  };
}

function renderText(result) {
  const lines = [
    `[codex-hooks] 目标: ${result.target}`,
    `[codex-hooks] 结论: ${result.status}`,
    `[codex-hooks] 我方 owned 事件(${result.ownedEvents.length}): ${result.ownedEvents.join(', ') || '(无)'}`,
    `[codex-hooks] 第三方事件(${result.foreignEvents.length}): ${result.foreignEvents.join(', ') || '(无)'}`,
  ];
  if (result.foreignPreservation.checked) {
    const preservation = result.foreignPreservation;
    lines.push(
      `[codex-hooks] 第三方条目保全: ${preservation.ok ? '是' : '否'}（基线 ${preservation.baseline}）`,
      `[codex-hooks]   · 结构投影相等: ${preservation.projectionEqual ? '是' : '否'}`,
      `[codex-hooks]   · 命令字面量消失(未声明): ${preservation.lostCommands.length}${
        preservation.desired === null ? '（未给 --desired，减数为空集）' : ''
      }`,
      `[codex-hooks]   · 经 removedCommands 声明而消失(需人工过目): ${preservation.removedByDeclaration.length}`,
    );
  }
  for (const finding of result.findings) {
    lines.push(
      `[codex-hooks] ${finding.level.toUpperCase()} ${finding.layer}/${finding.code}${finding.event ? ` event=${finding.event}` : ''}${finding.command ? ` command=${finding.command}` : ''}`,
    );
  }
  return lines.join('\n');
}

function main(argv) {
  let result;
  try {
    result = runValidation(argv);
  } catch (error) {
    if (error instanceof UndeterminedError) {
      console.error(`[codex-hooks] 无法判定: ${error.message}`);
      return EXIT_UNDETERMINED;
    }
    throw error;
  }
  const format = argv.includes('--format') ? argv[argv.indexOf('--format') + 1] : 'text';
  if (format === 'json') console.log(JSON.stringify(result, null, 2));
  else console.log(renderText(result));
  return result.exitCode;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
