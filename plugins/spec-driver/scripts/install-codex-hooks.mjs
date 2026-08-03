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
  installCodexHooks,
  removeCodexHooks,
} from './lib/codex-hooks-installer.mjs';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_INVALID_JSON = 3;

/** FR-010：安装成功后的信任提示（与 README / `codex-skills.sh` 的文案保持一致） */
export const HOOK_TRUST_NOTICE =
  '[提示] 首次使用需在 Codex 中完成 hooks 信任授予，否则本次写入的 hooks 不会执行。';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 默认插件根 = 本脚本的上一级目录（`plugins/spec-driver`），天然含归属锚点要求的目录分量 */
const DEFAULT_PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { codexHome: null, pluginRoot: DEFAULT_PLUGIN_ROOT, remove: false, json: false };
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

/** 按已解析参数执行（`run` 的内核；`main` 复用它以便消费同一份 args，不重复解析） */
function execute(args) {
  if (args.remove) {
    const result = removeCodexHooks({ codexHome: args.codexHome });
    return { action: 'remove', ...result };
  }
  const entries = generateCodexHooks({
    canonical: loadCanonical(args.pluginRoot),
    pluginRoot: args.pluginRoot,
  });
  const result = installCodexHooks({ codexHome: args.codexHome, entries });
  return { action: 'install', ...result };
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

function renderDiagnostic(diagnostic) {
  const suffix = `${diagnostic.event ? ` event=${diagnostic.event}` : ''}${
    diagnostic.command ? ` command=${diagnostic.command}` : ''
  }`;
  if (diagnostic.code === 'owned-entry-removed') {
    return `[codex-hooks] 🔴 owned-entry-removed command=${diagnostic.command} —— 已按归属锚点移除；若这不是我方条目，请用 <目标>.bak 回滚并反馈`;
  }
  const replacement = REPLACEMENT_WARNINGS[diagnostic.code];
  if (replacement) {
    return `[codex-hooks] 🔴 数据被替换 ${diagnostic.code}${suffix} —— ${replacement}；原文已备份到 <目标>.bak`;
  }
  return `[codex-hooks] 警告 ${diagnostic.code}${suffix}`;
}

function main(argv) {
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
    if (diagnostic.level === 'info' && diagnostic.code !== 'owned-entry-removed') continue;
    console.error(renderDiagnostic(diagnostic));
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
