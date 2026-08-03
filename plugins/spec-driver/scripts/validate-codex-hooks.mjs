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
 * 第三方数据保全有**两条独立 fail code**（见 `checkForeignPreservation`）：
 * `foreign-entries-mutated`（结构投影不等）与 `foreign-command-lost`（命令字面量未声明地消失）。
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
 *   --desired <path>       本轮写入器**自己声明**写入/移除的条目（`{hooks:{...}}` 文档或
 *                          command 字符串数组）。只有它们被允许从 baseline 中消失。
 *   --canonical-source     被校验对象是 canonical hooks.json（含 ${CLAUDE_PLUGIN_ROOT} 占位）
 *   --skip-shape           跳过我方 command 的形状校验（绝对路径 / 无插值 / type / 脚本存在）
 *   --format json|text     输出格式，默认 text
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { collectCommandLiterals, validateCodexHooksDocument } from './lib/codex-hooks-schema.mjs';
import { HOOKS_FILE_NAME, projectForeignOnly } from './lib/codex-hooks-installer.mjs';
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
 * 从 `--desired` 文件读出「本轮写入器自己声明写入/移除的 command 字面量」。
 * 接受两种形态：`{hooks:{...}}` 文档（生成器产物）或 command 字符串数组。
 */
function readDesiredCommands(file) {
  const parsed = readDoc(file, '本轮写入声明');
  if (Array.isArray(parsed)) {
    if (!parsed.every((item) => typeof item === 'string')) {
      throw new UndeterminedError(`本轮写入声明 ${file} 必须是 command 字符串数组`);
    }
    return parsed;
  }
  return collectCommandLiterals(parsed);
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
 * **写入器自己声明写了什么**（`--desired`）当减数，完全不经过归属谓词，因此能独立检出误删。
 *
 * 🔴 `--desired` 缺省时减数为空集（最严格口径）：baseline 里的任何 command 消失都判 fail。
 * 需要合法删除旧条目（版本升级换路径、卸载）时，调用方 MUST 显式声明删了什么。
 */
function checkForeignPreservation(baselineFile, targetDoc, desiredFile) {
  const baselineDoc = readDoc(baselineFile, '基线快照');
  const before = JSON.stringify(projectForeignOnly(baselineDoc));
  const after = JSON.stringify(projectForeignOnly(targetDoc));

  const allowedToDisappear = new Set(desiredFile === null ? [] : readDesiredCommands(desiredFile));
  const survivors = new Set(collectCommandLiterals(targetDoc));
  const lostCommands = [
    ...new Set(
      collectCommandLiterals(baselineDoc).filter(
        (command) => !survivors.has(command) && !allowedToDisappear.has(command),
      ),
    ),
  ];

  return {
    checked: true,
    ok: before === after && lostCommands.length === 0,
    projectionEqual: before === after,
    baseline: baselineFile,
    desired: desiredFile,
    lostCommands,
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
    // 与投影判据相互独立：即使投影相等（归属谓词过度认领会把差异抹平），命令消失仍判 fail
    for (const command of foreignPreservation.lostCommands) {
      findings.push({
        level: 'fail',
        layer: 'preservation',
        code: 'foreign-command-lost',
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
