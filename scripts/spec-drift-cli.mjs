#!/usr/bin/env node
/**
 * Spec Drift CLI（FR-014，plan §10）—— 薄壳：解析参数 → 调 core → 格式化输出 → 映射退出码。
 *
 * 公开入口是 `package.json` 的三条 script：
 *   npm run drift:link   -- --manifest <path> [--refresh] [--id <id>]
 *   npm run drift:check  -- [--strict] [--format json]
 *   npm run drift:unlink -- <id>
 *
 * 退出码（plan §10.2）：0 干净成功 / 1 仅 check 的确认型 drift / 2 不可验证或操作性失败 / 3 lock 损坏。
 */
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { linkReferences, checkAnchors, unlinkAnchor, DEFAULT_LOCK_RELPATH } from './lib/spec-drift-core.mjs';

const SUBCOMMANDS = ['link', 'check', 'unlink'];

const USAGE = `用法：
  npm run drift:link   -- --manifest <path> [--refresh [--id <id>]] [选项]
  npm run drift:check  -- [--strict] [选项]
  npm run drift:unlink -- <id> [选项]

子命令：
  link     按引用清单建锚 / 刷新锚（--refresh），一次性原子写入 lock
  check    仅按 lock 内已持久化的 canonical symbolId 精确匹配重算指纹（不重新模糊解析）
  unlink   按 id 精确删除一条锚

通用选项：
  --project-root <path>  被检项目根（默认当前工作目录）
  --lock <path>          lock 文件路径（默认 <project-root>/${DEFAULT_LOCK_RELPATH}）
  --format json          输出结构化 JSON（默认人类可读文本）
  --help                 打印本用法并退出（退出码 0）

退出码：
  0  全部 fresh / 操作成功
  1  存在 stale / orphaned（确认型 drift，仅 check 使用）
  2  不可验证态（graph-unavailable / ambiguous / unresolved / ...）或操作性失败
  3  lock 文件损坏`;

/** 需要取值的 flag → args 字段名 */
const VALUE_FLAGS = Object.freeze({
  '--manifest': 'manifest',
  '--lock': 'lock',
  '--project-root': 'projectRoot',
  '--id': 'id',
  '--format': 'format',
});

/** `--format` 的合法取值全集（默认 text 为"未显式指定"时的隐含值，不可显式传入） */
const FORMAT_VALUES = Object.freeze(['json']);

/** 各子命令允许的位置参数个数 */
const POSITIONAL_ARITY = Object.freeze({ link: 0, check: 0, unlink: 1 });

/**
 * 参数解析 + 严格校验。
 *
 * 严格的理由：静默容忍会把"用户以为生效了"的调用变成默认行为——
 * `--lock`（缺值）会写默认 lock，`--format xml` 会静默吐文本给期待 JSON 的 CI 解析器，
 * `check junk` 会让打错的子命令被当成正常 check。这类静默降级在 CI 里不可观测。
 */
export function parseArgs(argv) {
  const args = {
    subcommand: null,
    positionals: [],
    manifest: null,
    lock: null,
    projectRoot: null,
    id: null,
    refresh: false,
    strict: false,
    format: 'text',
    help: false,
    unknown: [],
    errors: [],
  };
  const rest = [...argv];
  if (rest.length > 0 && SUBCOMMANDS.includes(rest[0])) {
    args.subcommand = rest.shift();
  }
  while (rest.length > 0) {
    const token = rest.shift();
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--refresh') {
      args.refresh = true;
      continue;
    }
    if (token === '--strict') {
      args.strict = true;
      continue;
    }
    const field = VALUE_FLAGS[token];
    if (field !== undefined) {
      // 后随另一个 flag 或已到末尾，都视为"缺值"：`--lock --format json` 里
      // 把 `--format` 当作 lock 路径吞掉，会同时毁掉两个参数。
      const next = rest[0];
      if (next === undefined || next.startsWith('--')) {
        args.errors.push(`${token} 需要一个取值`);
        continue;
      }
      rest.shift();
      args[field] = next;
      continue;
    }
    if (token.startsWith('-')) args.unknown.push(token);
    else args.positionals.push(token);
  }

  if (args.help) return args;

  if (args.format !== 'text' && !FORMAT_VALUES.includes(args.format)) {
    args.errors.push(`--format 只接受 ${FORMAT_VALUES.join(' / ')}，收到 "${args.format}"`);
  }
  if (args.subcommand !== null) {
    const arity = POSITIONAL_ARITY[args.subcommand];
    if (args.positionals.length > arity) {
      args.errors.push(
        `${args.subcommand} 最多接受 ${arity} 个位置参数，收到多余参数：${args.positionals.slice(arity).join(', ')}`,
      );
    }
  }
  if (args.id !== null && !(args.subcommand === 'link' && args.refresh)) {
    args.errors.push('--id 只在 `link --refresh` 下有效（用于限定刷新单条锚）');
  }
  return args;
}

function formatText(result) {
  const lines = [];
  if (result.reportStatus && result.reportStatus !== 'ok') {
    lines.push(`[${result.machineCode}] ${result.reportStatus}：${result.reason ?? ''}`);
    lines.push(`  next step: ${result.nextStep ?? ''}`);
  } else if (result.reason) {
    lines.push(`[spec-drift] ${result.reason}`);
  }

  for (const anchor of result.anchors ?? []) {
    const detail = anchor.status === 'stale' ? ` expected=${anchor.expectedFingerprint} actual=${anchor.actualFingerprint}` : '';
    lines.push(`  - ${anchor.id} [${anchor.machineCode}] ${anchor.symbolId ?? anchor.ref}${detail}`);
    if (anchor.status !== 'fresh') lines.push(`      ${anchor.reason ?? ''}（${anchor.nextStep}）`);
  }
  for (const item of result.results ?? []) {
    lines.push(`  - ${item.id} [${item.machineCode}] ${item.symbolId ?? item.ref}`);
    if (item.status !== 'ok') lines.push(`      ${item.reason ?? ''}（${item.nextStep}）`);
  }
  if (result.summary) lines.push(`summary: ${JSON.stringify(result.summary)}`);
  lines.push(`exitCode: ${result.exitCode}`);
  return lines.join('\n');
}

/**
 * CLI 主入口。供 e2e 以"公开入口"方式调用（FR-014）。
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @param {{write?: (line:string)=>void}} io 输出注入（测试用）
 * @returns {Promise<number>} 进程退出码
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const write = io.write ?? ((line) => console.log(line));
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return emitUnexpected(write, 'text', err);
  }

  if (args.help) {
    write(USAGE);
    return 0;
  }
  const format = args.format === 'json' ? 'json' : 'text';
  if (args.subcommand === null) {
    return emitUsageError(write, format, argv.length === 0 ? '缺少子命令' : `未知子命令 "${argv[0]}"`);
  }
  if (args.unknown.length > 0) {
    return emitUsageError(write, format, `未知参数 ${args.unknown.join(', ')}`);
  }
  if (args.errors.length > 0) {
    return emitUsageError(write, format, args.errors.join('；'));
  }

  try {
    return await runCommand(args, write, format);
  } catch (err) {
    return emitUnexpected(write, format, err);
  }
}

/** 参数级失败：恒 exit 2，json 模式下输出与正常报告同构的操作失败对象 */
function emitUsageError(write, format, reason) {
  if (format === 'json') {
    write(JSON.stringify({ ok: false, exitCode: 2, reportStatus: 'ok', degraded: false, reason }, null, 2));
  } else {
    write(USAGE);
    write(`\n错误：${reason}`);
  }
  return 2;
}

/**
 * 未预期异常兜底（C-1）。
 *
 * CLI 是 CI 消费入口：裸抛栈会让 `--format json` 的解析方拿到非 JSON 输出并二次崩溃，
 * 且退出码变成 node 默认的 1（= "确认型 drift"），语义完全错位。
 */
function emitUnexpected(write, format, err) {
  const message = err instanceof Error ? err.message : String(err);
  const reason = `spec-drift 内部错误：${message}`;
  if (format === 'json') {
    write(JSON.stringify({ ok: false, exitCode: 2, reportStatus: 'ok', degraded: true, reason }, null, 2));
  } else {
    write(`[spec-drift] ${reason}`);
  }
  return 2;
}

async function runCommand(args, write, format) {
  const projectRoot = path.resolve(args.projectRoot ?? process.cwd());
  const lockPath = args.lock ? path.resolve(args.lock) : path.join(projectRoot, DEFAULT_LOCK_RELPATH);

  let result;
  if (args.subcommand === 'link') {
    result = await linkReferences({
      projectRoot,
      manifestPath: args.manifest ? path.resolve(args.manifest) : null,
      lockPath,
      refresh: args.refresh,
      id: args.id,
    });
  } else if (args.subcommand === 'check') {
    result = await checkAnchors({ projectRoot, lockPath });
  } else {
    result = unlinkAnchor({ lockPath, id: args.positionals[0] ?? null });
  }

  const payload = { command: args.subcommand, ...result, lockPath, projectRoot };
  write(format === 'json' ? JSON.stringify(payload, null, 2) : formatText(payload));
  return payload.exitCode;
}

// 直接执行（而非被 import）时才驱动进程退出码。
// 手拼 `file://${argv[1]}` 在 Windows 上永远不等于 import.meta.url（盘符需编码成
// `file:///C:/...`），会让 npm script 静默不执行 main() 并以 exit 0 骗过 CI。
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main();
}
