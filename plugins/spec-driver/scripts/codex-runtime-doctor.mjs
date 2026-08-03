#!/usr/bin/env node
/**
 * codex-runtime-doctor.mjs
 * Feature 240 / A4-2 — 四方一致性诊断 CLI 编排层（FR-008 / FR-009 / FR-012）
 *
 * 定位与 `judge-snapshot-doctor.mjs` 完全一致：**诊断不阻断**。
 * 不接入 `hooks.json`、不接入 `repo:check`，默认恒退出 0；
 * 仅 `--strict` 下 `overallStatus === 'fail'` 才退出 1（为未来 CI 接入预留的显式开关）。
 *
 * 用法:
 *   node plugins/spec-driver/scripts/codex-runtime-doctor.mjs [--project-root <path>]
 *                                                            [--format json|text]
 *                                                            [--strict]
 *   npm run codex:doctor
 *
 * 退出码真值表（plan §8.2）:
 *   ok / warning / fail(未 --strict) → 0
 *   fail + --strict                  → 1
 *   CLI 自身异常（参数非法 / 未捕获错误） → 2
 *
 * 运行相关测试:
 *   npx vitest run tests/unit/codex-runtime-doctor.test.ts
 *   npx vitest run tests/unit/codex-runtime-doctor-cli.test.ts
 *   npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts
 */

import process from 'node:process';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';
import { runDoctor } from './lib/codex-runtime-doctor-io.mjs';
import { formatTextReport, buildSummary } from './lib/codex-runtime-doctor-core.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CODEX_HOME_HELPER = path.join(SCRIPT_DIR, 'lib', 'codex-home.sh');

/**
 * 解析 Codex 家目录。
 *
 * 🔴 **不在此处手拼 `~/.codex`**（FR-006/FR-007 硬约束）。本仓库的家目录解析事实源有二：
 * Node 侧 `src/core/codex-home.ts`（属 npm `spectra` 包，需 build 产出 dist）与 shell 侧
 * `lib/codex-home.sh`。本 CLI 从 plugin cache 直接 `node` 执行、**没有 build 步骤**，
 * 不能依赖 dist；因此走 shell 侧 helper —— 复用既有事实源，而不是新增第三份实现
 * （新增即引入必然漂移的第三方，F238 教训）。
 */
function resolveCodexHome() {
  const out = execFileSync(
    'bash',
    ['-c', 'set -euo pipefail; . "$1"; resolve_codex_home_from_env', 'bash', CODEX_HOME_HELPER],
    // 有界：家目录解析是同步前置步骤，卡住会让整条诊断挂起
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, killSignal: 'SIGKILL' },
  );
  return out.replace(/\n+$/, '');
}

const USAGE = [
  '用法: node plugins/spec-driver/scripts/codex-runtime-doctor.mjs [选项]',
  '  --project-root <path>   仓库根（默认当前工作目录）',
  '  --format json|text      输出格式（默认 text）',
  '  --strict                overallStatus 为 fail 时以退出码 1 结束（默认不阻断）',
].join('\n');

/**
 * 参数解析。
 *
 * 🔴 错误信息 MUST NOT 回显任何 argv 片段（FR-012(3)：CLI 顶层错误也走模板漏斗）。
 * I1：错误文案不再是就地写死的字面量，而是与 check 的 summary 共用同一个
 * `buildSummary` 构造器 —— 「顶层错误同一漏斗」是**结构合同**，靠「这条字面量恰好
 * 不含变量」维持的安全性会在下一次有人顺手拼一个变量进去时无声失效。
 */
function argError(reason) {
  return { ok: false, reason, error: buildSummary('cli-argument-error', { reason }) };
}

export function parseArgs(argv) {
  let projectRoot = process.cwd();
  let format = 'text';
  let strict = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-root') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return argError('missing-project-root');
      }
      projectRoot = value;
      i += 1;
    } else if (arg === '--format') {
      const value = argv[i + 1];
      if (value !== 'json' && value !== 'text') {
        return argError('invalid-format');
      }
      format = value;
      i += 1;
    } else if (arg === '--strict') {
      strict = true;
    } else {
      return argError('unknown-argument');
    }
  }
  return { ok: true, projectRoot, format, strict };
}

/** 退出码真值表的唯一实现点 */
export function resolveExitCode(overallStatus, strict) {
  if (overallStatus === 'fail' && strict) return 1;
  return 0;
}

/** 把任意异常归约为 errorClass 枚举（与 io 层同口径，只读 code，不碰任何文本） */
function classifyTopLevelError(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  if (code === 'ENOENT') return 'ENOENT';
  if (code === 'ETIMEDOUT') return 'ETIMEDOUT';
  if (code === 'EACCES' || code === 'EPERM') return 'EACCES';
  return 'unknown';
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    return 2;
  }

  let report;
  try {
    report = runDoctor({
      projectRoot: path.resolve(parsed.projectRoot),
      codexHome: resolveCodexHome(),
      env: process.env,
    });
  } catch (err) {
    // 🔴 只输出 errorClass 枚举 + 固定模板文案，绝不输出原始异常内容
    process.stderr.write(`${buildSummary('cli-internal-error', { errorClass: classifyTopLevelError(err) })}\n`);
    return 2;
  }

  const rendered = parsed.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : `${formatTextReport(report)}\n`;
  process.stdout.write(rendered);
  return resolveExitCode(report.overallStatus, parsed.strict);
}

if (isInvokedDirectly(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
