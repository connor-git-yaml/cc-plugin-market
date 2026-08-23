#!/usr/bin/env node
/**
 * install-codex-hooks.mjs
 * Feature 240 / T025 — 把我方 hook 条目**合并写入** `$CODEX_HOME/hooks.json`（FR-011 / FR-010）
 *
 * 由 `codex-skills.sh install --global` 在 skills 安装成功后调用；`remove --global` 走 `--remove`。
 * **project 模式不调用本脚本** —— Codex hooks 只有全局位置，无项目级语义（`_grounding.md` §8.1）。
 *
 * ## 单一事实源
 * 条目内容一律从 canonical `plugins/spec-driver/hooks/hooks.json` 派生（见
 * `lib/codex-hooks-generator.mjs`），**不存在并列的 `hooks.codex.json`** —— 两份声明必然漂移。
 *
 * ## `--codex-home` 为什么必填
 * 家目录解析的事实源只有两处：`src/core/codex-home.ts`（Node）与 `scripts/lib/codex-home.sh`
 * （shell，含 `CODEX_HOME` 优先、空串等同未设置、换行 fail-loud 等已对拍语义）。本脚本再写
 * 第三份必然漂移，而漂移的后果是把条目写进（或从）**错误的目录**删。故：调用方显式传入，
 * 缺失即 fail-loud；只接受 `CODEX_HOME` 环境变量作为等价的显式来源，**绝不 fallback 到
 * `~/.codex`**（那正是需要完整解析语义的那一支）。
 *
 * ## 退出码合同（`codex-skills.sh` 按码分流，勿改语义）
 * | 码 | 含义 | 调用方处置 |
 * |---|---|---|
 * | 0 | 成功（含"无变更"） | 继续 |
 * | 1 | 一般失败（权限、IO、参数） | **仅告警**，不阻断 skills 安装（plan §6.6） |
 * | 3 | 目标 `hooks.json` 不是合法 JSON | **fail-loud 中断**：静默降级会让用户以为 hooks 已装好 |
 * | 4 | 双注册守卫命中：Codex 已原生注册本插件（Feature 264 D3） | **不阻断** skills 安装；本次拒绝写入 `hooks.json`（一个字节都不写），由 `codex-skills.sh` 打印中文指引；`--force-hooks` 可覆盖 |
 *
 * ## 双注册守卫（Feature 264，`specs/264-fix-codex-hooks-distribution/`）
 * `codex plugin add` 之后 Codex 会直接注册插件包内的 `hooks/hooks.json`（主路径），本脚本
 * 只是**降级为 fallback**——仅在插件未被原生注册时才需要合并写入。`action === 'install'`
 * 分支前置调用 `codex-plugin-registration.mjs` 的 `detectNativePluginRegistration`：命中
 * 且未传 `--force-hooks` → 退出码 4，中断写入；`--remove` 分支不受影响（用户需要能随时清理
 * 历史遗留的合并写入条目）。逃生口 `--force-hooks` 服务"Codex 版本老到不读插件 hooks"的
 * 人工判断，命中时仍会打印代价说明（将产生重复 hook）。
 *
 * ## 🔴 信任模型：本脚本只写声明，不碰信任
 * Codex 首次执行 hooks 需要用户在 Codex 内完成信任授予。本脚本**严禁**写入任何绕过信任的
 * 配置，也**严禁**调用 Codex 那个绕过 hook 信任的危险 flag；安装成功后只打印提示，由用户
 * 自己在 Codex 里授权。
 *
 * 🔴 该 flag 的**字面量**刻意不出现在本文件（含注释）里：
 * `tests/integration/codex-hooks-install-flow.test.ts` 的守卫断言是"生产脚本全文不含该字面量"，
 * 这是零启发式、无法被绕过的判据。一旦为了写注释而放宽成"忽略注释行"，守卫就退化成了
 * 需要词法解析的猜测（F231 已实证该类判据是逃逸面而非防线）。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { generateCodexHooks, CANONICAL_HOOKS_RELATIVE_PATH } from './lib/codex-hooks-generator.mjs';
import {
  INVALID_JSON_ERROR_CODE,
  assertHooksDocumentParsable,
  countOwnedHandlers,
  installCodexHooks,
  removeCodexHooks,
  resolveHooksPath,
} from './lib/codex-hooks-installer.mjs';
import { detectNativePluginRegistration } from './lib/codex-plugin-registration.mjs';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_INVALID_JSON = 3;
export const EXIT_ALREADY_REGISTERED = 4;

/** Codex 插件 manifest（`.claude-plugin/plugin.json`）里的 `name` 字段值，双注册守卫按此匹配。 */
const CODEX_PLUGIN_NAME = 'spec-driver';

/** FR-010：安装成功后的信任提示（与 README / `codex-skills.sh` 的文案保持一致） */
export const HOOK_TRUST_NOTICE =
  '[提示] 首次使用需在 Codex 中完成 hooks 信任授予，否则本次写入的 hooks 不会执行。';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 默认插件根 = 本脚本的上一级目录（`plugins/spec-driver`），天然含归属锚点要求的目录分量 */
const DEFAULT_PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');

class UsageError extends Error {}

function parseArgs(argv) {
  const args = {
    codexHome: null,
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    remove: false,
    json: false,
    forceHooks: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${token} 缺少取值`);
      i += 1;
      return value;
    };
    switch (token) {
      case '--codex-home':
        args.codexHome = next();
        break;
      case '--plugin-root':
        args.pluginRoot = path.resolve(next());
        break;
      case '--remove':
        args.remove = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--force-hooks':
        args.forceHooks = true;
        break;
      default:
        throw new UsageError(`未知参数: ${token}`);
    }
  }
  // 空串等同未设置（与 codex-home.sh 的既定语义一致）——但要能在错误文案里区分二者
  const emptyFlag = args.codexHome !== null && args.codexHome.length === 0;
  if (args.codexHome === null || emptyFlag) {
    const fromEnv = process.env.CODEX_HOME;
    args.codexHome = typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null;
  }
  if (args.codexHome === null) {
    throw new UsageError(
      `${emptyFlag ? '--codex-home 取值为空串（空串等同未设置）。' : ''}` +
        '必须显式给出 --codex-home <dir>（或设置非空 CODEX_HOME）。' +
        '本脚本不自行推导家目录，以免与 codex-home.sh / codex-home.ts 漂移后写错目录。',
    );
  }
  return args;
}

function loadCanonical(pluginRoot) {
  const file = path.join(pluginRoot, CANONICAL_HOOKS_RELATIVE_PATH);
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * 数一数 `$CODEX_HOME/hooks.json` 里现存多少条我方历史合并器条目。
 * 纯只读、绝不抛：文件不存在 / 非法 JSON / 读不动一律返回 0 —— 这只是给提示文案用的计数，
 * 不参与任何判定，让它有能力打断安装流程是得不偿失的。
 */
function countStaleMergedEntries(codexHome) {
  try {
    return countOwnedHandlers(JSON.parse(fs.readFileSync(resolveHooksPath(codexHome), 'utf-8')));
  } catch {
    return 0;
  }
}

/** 按已解析参数执行（`run` 的内核；`main` 复用它以便消费同一份 args，不重复解析） */
function execute(args) {
  if (args.remove) {
    const result = removeCodexHooks({ codexHome: args.codexHome });
    return { action: 'remove', ...result };
  }
  // 🔴 顺序不可调换（F264 / 第二轮 W1）：目标文件"非法 JSON ⇒ 退出码 3 fail-loud"这条通道
  // 必须**先于**守卫求值。守卫命中与否不改变"这份文件坏了必须先修"的事实；把守卫放前面会让
  // 一份已损坏的全局 hooks.json 被报成"一切正常，无需再装"。
  assertHooksDocumentParsable(args.codexHome);

  // Feature 264 / D3：双注册守卫只跑在 install 分支。命中且未传 `--force-hooks` → 一个字节
  // 都不写，直接返回 skipped 结果；`main()` 据此分流到 EXIT_ALREADY_REGISTERED。
  const registration = detectNativePluginRegistration({
    codexHome: args.codexHome,
    pluginName: CODEX_PLUGIN_NAME,
  });
  if (registration.registered && !args.forceHooks) {
    // 🔴 守卫自己的 diagnostics 必须随结果一并出栈：它承载的是"某侧判不出"的可见信号
    // （cache 不可读 / config.toml 不可读 等），静默丢弃就回到了对抗审查抓到的那片盲区。
    return {
      action: 'install',
      skipped: true,
      marketplace: registration.marketplace,
      // 🔴 形状不能与正常安装结果脱节（F264 / 第二轮 W5）：`validate-codex-hooks.mjs --desired`
      // 的文档明写"把 install --json 的完整输出整份喂进来"，其解析器按有无 `writtenCommands`
      // 分流。守卫命中时确实**什么都没写、什么都没删**，故如实给两个空数组 —— 而不是让字段
      // 整个消失、把下游打成"无法识别的 --desired"。
      writtenCommands: [],
      removedCommands: [],
      // 命中证据路径：误拒时用户要能看见"是哪个文件让你拒的"（第二轮 W3）
      evidencePaths: registration.evidencePaths,
      // 🔴 拒绝安装只挡住**新的**双注册；用户机器上可能已经有一批**历史**合并器条目
      //（插件注册之前装的），那才是此刻正在生效的双注册。守卫不替用户删这些条目
      //（那是 `--remove` 的职责，删错就是数据丢失），但**必须把它变成可见的**：
      // 只说"已跳过写入"会让用户以为问题已解决，而 Stop hook 仍在每轮跑两遍。
      staleMergedEntries: countStaleMergedEntries(args.codexHome),
      diagnostics: registration.diagnostics,
    };
  }
  const entries = generateCodexHooks({
    canonical: loadCanonical(args.pluginRoot),
    pluginRoot: args.pluginRoot,
  });
  const result = installCodexHooks({ codexHome: args.codexHome, entries });
  return {
    action: 'install',
    skipped: false,
    // 逃生口命中：守卫本会拦但用户显式覆盖，main() 据此打印代价说明（marketplace 一并带上，
    // 未命中时为 null，`main()` 的判据只看 forcedOverNativeRegistration，不会误用它）
    forcedOverNativeRegistration: registration.registered && args.forceHooks,
    marketplace: registration.marketplace,
    ...result,
    // 守卫诊断并入既有诊断通道（顺序在前：它描述的是写入之前的判定环节）
    diagnostics: [...registration.diagnostics, ...(result.diagnostics ?? [])],
  };
}

export function run(argv) {
  return execute(parseArgs(argv));
}

/**
 * 「替换了用户原有内容」这一类诊断的醒目文案。
 * 这三种情形都意味着**目标文件里本不该被我方碰的部分被换掉了**（顶层非对象、`hooks` 非对象、
 * 事件值非数组）。它们此前只打印一个 code，用户无从判断发生了什么、能不能回滚 —— 必须提级为
 * 带后果说明与 `.bak` 指引的告警。
 */
const REPLACEMENT_WARNINGS = {
  'document-not-object-replaced':
    '目标 hooks.json 顶层不是 JSON 对象，其原有内容已被替换为标准结构',
  'hooks-field-not-object-replaced': '目标 hooks.json 的 hooks 字段不是对象，其原有内容已被替换',
  'event-value-not-array-replaced': '该事件的原有值不是数组，已被替换为数组',
};

/**
 * 渲染一条诊断。
 *
 * 🔴 涉及 `.bak` 的文案一律打印**本次真实的 backupPath**：目标是符号链接时 `.bak` 落在
 * realpath 所在目录，占位符 `<目标>.bak` 指的是错误位置，照着它去找文件只会扑空。
 */
function renderDiagnostic(diagnostic, backupPath) {
  // 🔴 不含 `path`：唯一带 `path` 的诊断是 `backup-already-exists`，它有专属提前 return，
  // 走不到通用兜底。留着那段拼接只会让人以为通用分支也能渲染路径。
  const suffix = `${diagnostic.event ? ` event=${diagnostic.event}` : ''}${
    diagnostic.command ? ` command=${diagnostic.command}` : ''
  }`;
  const backupLabel = backupPath ?? '<目标>.bak';
  if (diagnostic.code === 'owned-entry-removed') {
    // 🔴 升版换路径时这条一次会刷出多条；且 `.bak` 是**最早**那一份（可能早于用户近期的手工
    // 改动），照着整份回滚会把那些改动一起抹掉。故指引必须先要求核对内容。
    return `[codex-hooks] 🔴 owned-entry-removed command=${diagnostic.command} —— 已按归属锚点移除；若这不是我方条目，请先核对 ${backupLabel} 的内容再决定是否回滚，并反馈`;
  }
  if (diagnostic.code === 'backup-already-exists') {
    // 🔴 只陈述本进程可证实的事实：EEXIST 只证明「文件已在」，不足以指认它是谁写的
    //（可能是用户自带的备份，也可能是删掉后第二次安装重建的）。任何"这份 .bak 是首次安装前
    // 状态"的指认式文案，在这两个场景下都是假陈述。
    return `[codex-hooks] 提示 backup-already-exists —— ${diagnostic.path ?? backupLabel} 已存在，本次未覆盖；本工具仅在 .bak 不存在时创建备份（保留最早一份），不随每次写入刷新`;
  }
  if (diagnostic.code === 'target-mode-preserve-failed') {
    return `[codex-hooks] 警告 target-mode-preserve-failed${diagnostic.errno ? ` errno=${diagnostic.errno}` : ''} —— 内容已正常写入，但目标原有权限位未能恢复（当前不宽于 0600），请手动核对`;
  }
  const replacement = REPLACEMENT_WARNINGS[diagnostic.code];
  if (replacement) {
    return `[codex-hooks] 🔴 数据被替换 ${diagnostic.code}${suffix} —— ${replacement}；原文已备份到 ${backupLabel}`;
  }
  return `[codex-hooks] 警告 ${diagnostic.code}${suffix}`;
}

/**
 * 静默的 info 级 code 白名单。
 *
 * 这两条的语义已被 stdout 侧的成功文案完整覆盖（"没有我方条目，无需清理"），重复打印只会
 * 淹没真信号。**其余 info 一律打印** —— 此前的判据是 `code !== 'owned-entry-removed'`，
 * 而该 code 恒为 warning 级、从来进不了这个分支，等于"所有 info 全静默"，
 * `backup-already-exists`（唯一能澄清 `.bak` 语义的信号）因此从未被用户看到过。
 */
const SILENCED_INFO_CODES = new Set(['target-missing', 'nothing-to-remove']);

/** `--help` / `-h` 的用法文案（Feature 264：补 `--force-hooks` 说明） */
function printUsage() {
  console.log(
    [
      '用法:',
      '  node install-codex-hooks.mjs --codex-home <dir> [--plugin-root <dir>] [--remove] [--json] [--force-hooks]',
      '',
      '说明:',
      '  --codex-home   Codex 家目录（必填，或设置非空 CODEX_HOME 环境变量）',
      '  --plugin-root  插件根目录（默认本脚本的上一级目录）',
      '  --remove       卸载已合并写入的我方 hook 条目（不受双注册守卫影响）',
      '  --json         以 JSON 格式输出结果（人类可读提示改走 stderr）',
      '  --force-hooks  跳过双注册守卫强制写入（Codex 已原生注册时会导致同一 hook 被注册两次）',
    ].join('\n'),
  );
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return EXIT_OK;
  }

  let args;
  let result;
  try {
    args = parseArgs(argv);
    result = execute(args);
  } catch (error) {
    if (error && error.code === INVALID_JSON_ERROR_CODE) {
      console.error(`[codex-hooks] ${error.message}`);
      return EXIT_INVALID_JSON;
    }
    console.error(`[codex-hooks] ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_FAILED;
  }

  // Feature 264 / D3：守卫命中，一个字节都没写。单独分流，不进入下方的 install/remove 通用渲染
  // 逻辑（那段逻辑假设 result 里有 changed/ownedCount 等只有真正写入才有的字段）。
  if (result.action === 'install' && result.skipped) {
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(
        `[codex-hooks] 已检测到 Codex 原生插件注册（marketplace=${result.marketplace ?? '未知'}），跳过合并写入以避免同一 hook 被注册两次；若确认当前 Codex 版本不读取插件内 hooks，可追加 --force-hooks 强制安装`,
      );
      // 🔴 判定证据必须可见（第二轮 W3）：只给一个 marketplace 名，误拒的用户无从自救。
      for (const evidencePath of result.evidencePaths ?? []) {
        console.error(`[codex-hooks] 判定依据：${evidencePath}`);
      }
      if (result.staleMergedEntries > 0) {
        console.error(
          `[codex-hooks] ⚠️ 但 ${resolveHooksPath(args.codexHome)} 里仍有 ${result.staleMergedEntries} 条历史合并器条目 —— ` +
            '它们与插件注册叠加，此刻就是双注册状态（Stop hook 每轮跑两遍）。' +
            '清理方式（只删 hook 条目、不动 skills）：`node "$PLUGIN_DIR/scripts/install-codex-hooks.mjs" --codex-home "$CODEX_HOME" --remove`；' +
            '若连 Codex 包装 skills 一起卸载，才用 `bash "$PLUGIN_DIR/scripts/codex-skills.sh" remove --global`',
        );
      }
      for (const diagnostic of result.diagnostics ?? []) {
        console.error(`[codex-hooks] ${diagnostic.level ?? 'info'} ${diagnostic.code}`);
      }
    }
    return EXIT_ALREADY_REGISTERED;
  }

  if (args.json) {
    // 🔴 `--json` 下 stdout MUST 只有那一份 JSON：任何附加文字都会让 JSON.parse 在
    // "Unexpected non-whitespace character after JSON" 上失败，机器消费方直接瞎掉。
    // 人类可读的提示与诊断一律走 stderr。
    console.log(JSON.stringify(result, null, 2));
  } else if (result.action === 'remove') {
    // 🔴 措辞刻意不写「第三方条目原样保留」：那是一句**无法由本进程证实**的断言 ——
    // 移除依据是归属锚点，锚点误认时被删的恰恰是第三方条目，此时该句就是假陈述。
    // 只陈述可证实的事实（按锚点移除了哪几条，逐条打印），保全结论交给 validate CLI 的
    // `--baseline`/`--desired` 判据给出。
    console.log(
      result.removedCount > 0
        ? `[codex-hooks] 已按归属锚点从 ${result.targetPath} 移除 ${result.removedCount} 个条目（逐条见下方清单，其余条目未改动）`
        : `[codex-hooks] ${result.targetPath} 中没有我方条目，无需清理`,
    );
  } else {
    console.log(
      result.changed
        ? `[codex-hooks] 已写入 ${result.targetPath}（我方条目 ${result.ownedCount} 个，未匹配归属锚点的条目未改动）`
        : `[codex-hooks] ${result.targetPath} 已是最新，未做改动`,
    );
  }
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.level === 'info' && SILENCED_INFO_CODES.has(diagnostic.code)) continue;
    console.error(renderDiagnostic(diagnostic, result.backupPath));
  }
  // Feature 264 / D3：`--force-hooks` 覆盖了双注册守卫的代价说明；`console.error` 而非
  // `console.log`，保证 `--json` 模式下 stdout 仍只有那一份 JSON。
  if (result.forcedOverNativeRegistration) {
    console.error(
      `[codex-hooks] 警告 --force-hooks 已跳过双注册检测（marketplace=${result.marketplace}）：若 Codex 确已原生注册本插件，本次强制写入将导致同一 hook 被注册两次（例如 Stop hook 每次会跑两遍）；如非必要请勿加此参数`,
    );
  }
  if (result.action === 'install') {
    if (args.json) console.error(HOOK_TRUST_NOTICE);
    else console.log(HOOK_TRUST_NOTICE);
  }
  return EXIT_OK;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
