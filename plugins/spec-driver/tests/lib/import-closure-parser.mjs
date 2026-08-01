/**
 * import-closure-parser.mjs
 * Feature 236 — FR-002b 守卫测试专用基础设施（非生产运行期消费）
 *
 * 不从 plugins/spec-driver/scripts/lib/ 生产目录导出——它是守卫测试的自身实现细节。
 *
 * 【架构】静态 import 闭包 = Node 官方权威：不再手写 ESM 词法解析（四轮 codex critical
 * 证明手写 tokenizer 是无底洞），改用 `vm.SourceTextModule(src).moduleRequests`。
 * 该 API 需 --experimental-vm-modules flag，而 `npm run test:plugins`（node --test）默认
 * 不带此 flag，故用 spawnSync 子进程隔离：本模块只做进程编排 + JSON 解析，vm 逻辑全在
 * import-closure-helper.mjs 内。dynamic import 一律 fail-closed（judge 当前不使用该形态）。
 *
 * 由 judge-file-set-guard.test.mjs 与 judge-file-set-guard-parser.test.mjs 共同 import。
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HELPER = path.join(__dirname, 'import-closure-helper.mjs');

/**
 * helper 子进程墙钟上限（ms）。真实闭包约 24ms，10s 足够宽裕；
 * 若 helper 因 bug 挂起（保持事件循环存活却不退出），spawnSync 到点 SIGKILL
 * 并把 status.error（含 ETIMEDOUT）正规化为 fail-closed，避免 CI 静默卡死。
 */
const HELPER_TIMEOUT_MS = 10000;

/**
 * 解析 helper 路径与超时（每次调用读 env，便于 fail-closed 超时测试注入 hang helper）。
 * 两个 override 仅供本守卫的单测使用，生产/CI 常态路径不设这两个 env，走默认值。
 */
function resolveHelperPath() {
  const override = process.env.SPEC_DRIVER_JUDGE_HELPER_OVERRIDE;
  return override ? path.resolve(override) : DEFAULT_HELPER;
}
function resolveTimeoutMs() {
  const raw = process.env.SPEC_DRIVER_JUDGE_HELPER_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : HELPER_TIMEOUT_MS;
}

/**
 * spawn helper 子进程（带 --experimental-vm-modules），读回 JSON 结果。
 * 任何子进程失败 / 超时 / 非法 JSON → fail-closed（守卫宁可判失败也不静默放行）。
 */
function runHelper(args, input) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', resolveHelperPath(), ...args], {
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
    timeout: resolveTimeoutMs(),
    killSignal: 'SIGKILL',
  });
  // r.error 非空表示进程未正常完成：超时（ETIMEDOUT）、spawn 失败（ENOENT）、被信号杀死等。
  // 一律 fail-closed，绝不让 hang / 崩溃被当成"无依赖"静默放行。
  if (r.error) {
    const detail = `helper 子进程异常终止（${r.error.code || r.error.message || 'unknown'}）`.slice(0, 300);
    return { ok: false, unsupported: [{ file: '', line: 0, snippet: detail, kind: 'unrecognized-syntax' }] };
  }
  if (r.status !== 0) {
    const detail = (r.stderr || 'helper 子进程非零退出').slice(0, 300);
    return { ok: false, unsupported: [{ file: '', line: 0, snippet: detail, kind: 'unrecognized-syntax' }] };
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    return {
      ok: false,
      unsupported: [{ file: '', line: 0, snippet: `helper 输出非法 JSON: ${(r.stdout || '').slice(0, 120)}`, kind: 'unrecognized-syntax' }],
    };
  }
}

/**
 * 从单文件源码文本提取静态模块引用（供 fixture 单测）。
 * 静态 import specifier 由 Node moduleRequests 权威给出；检测到 dynamic import → fail-closed。
 * @returns {{ok:true,refs:string[]}|{ok:false,unsupported:Array}}
 */
export function extractModuleReferences(sourceText) {
  return runHelper(['--extract-stdin'], sourceText);
}

/**
 * BFS 遍历入口的相对 import 静态闭包（测试专用，非生产代码）。
 * 任一文件出现 dynamic import 或解析失败 → 整体 fail-closed。
 * @returns {{ok:true,files:string[]}|{ok:false,unsupported:Array}}
 */
export function resolveStaticImportClosure(entryAbsPath) {
  return runHelper(['--entry', path.resolve(entryAbsPath)]);
}
