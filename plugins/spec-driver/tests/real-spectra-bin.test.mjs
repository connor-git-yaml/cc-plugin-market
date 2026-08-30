/**
 * real-spectra-bin.test.mjs
 * Feature 268 delta — `tests/lib/real-spectra-bin.mjs` 两级解析回退链的专属机制测试。
 *
 * 背景：F268 delta 对抗审查证实二级机制（wrapper 生成 / shQuote 转义 / --version 复验 /
 * memoize 缓存 / 进程退出清理）在任何本机装了全局 `spectra` 的开发机上**零执行覆盖**——
 * `resolveRealSpectraBin()` 恒在第一级 PATH 探针成功即返回，第二级代码路径只有 CI（无全局
 * 安装）才会跑到。这意味着二级机制此前只被 CI 隐式跑过，从未被本地钉住过任何断言。
 *
 * 职责边界：本文件**只测解析器自身的机制正确性**（给定 repoRoot fixture，两级回退链是否
 * 选对分支、是否安全转义、是否正确缓存）；**不测**真实 F241 刷新链的行为证据——那是
 * `graph-refresh-executor.test.mjs` / `graph-consumption-cli.test.mjs` 里三条 SC-002/SC-003
 * 集成用例的职责（它们钉的是「真实 spectra CLI 真实建出可查询图」，不可 mock）。本文件里的
 * `dist/cli/index.js` fixture 只是一段可执行的最小 node 脚本，用来验证「解析→包装→可执行」
 * 这条机制链本身，不冒充、不替代那三条真实链路证据。
 *
 * 隔离手段：全部用例经子进程隔离——`spawnSync(process.execPath, [childScript], { env: { PATH:
 * <node 所在目录> } })`，令子进程内的一级 PATH 探针在任何宿主机上确定性 ENOENT，与宿主是否
 * 装了全局 spectra 完全解耦（Node/libuv 对无 `/` 的命令按 `options.env.PATH` 而非当前进程
 * PATH 搜索，是本仓已在 masked-PATH CI 模拟场景中验证过的行为，见 fix-report.md T005）。
 *
 * 运行方式: node --test plugins/spec-driver/tests/real-spectra-bin.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = path.join(__dirname, 'lib', 'real-spectra-bin.mjs');
const HELPER_URL = pathToFileURL(HELPER_PATH).href;

const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

/** 最小可执行 fixture CLI：`--version` 打印可识别标记并 exit 0。 */
const FIXTURE_SUCCESS = [
  '#!/usr/bin/env node',
  "if (process.argv.slice(2).includes('--version')) {",
  "  process.stdout.write('spectra vTEST (fixture)\\n');",
  '  process.exit(0);',
  '}',
  'process.exit(1);',
  '',
].join('\n');

/** 最小可执行 fixture CLI：任何调用一律 exit 1（模拟「dist 缺模块 / 加载期崩溃」的假可用）。 */
const FIXTURE_REJECT = ['#!/usr/bin/env node', 'process.exit(1);', ''].join('\n');

/**
 * 子进程侧脚本：masked PATH 下动态 import 本 helper 并调用，结果 JSON.stringify 到 stdout。
 * 不使用模板字符串嵌套反引号，避免与父进程侧的字符串字面量转义规则纠缠。
 */
const CHILD_SCRIPT_SOURCE = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { spawnSync } from 'node:child_process';",
  '',
  'const [, , mode, ...rest] = process.argv;',
  '',
  'async function main() {',
  '  const { resolveRealSpectraBin } = await import(process.env.HELPER_URL);',
  '',
  "  if (mode === 'resolve-and-exec') {",
  '    const [repoRoot] = rest;',
  '    const bin = resolveRealSpectraBin({ repoRoot });',
  '    let exec = null;',
  '    if (bin !== null) {',
  "      const res = spawnSync(bin, ['--version'], { encoding: 'utf-8' });",
  "      exec = { status: res.status, stdout: res.stdout, errorCode: res.error ? (res.error.code || String(res.error)) : null };",
  '    }',
  '    process.stdout.write(JSON.stringify({ bin, exec }));',
  '    return;',
  '  }',
  '',
  "  if (mode === 'cache-sequence') {",
  '    const [repoRoot, distDir, fixtureContent] = rest;',
  '    const r1 = resolveRealSpectraBin({ repoRoot });',
  '    fs.mkdirSync(distDir, { recursive: true });',
  "    fs.writeFileSync(path.join(distDir, 'index.js'), fixtureContent, { mode: 0o755 });",
  '    const r2 = resolveRealSpectraBin({ repoRoot });',
  '    const r3 = resolveRealSpectraBin({ repoRoot });',
  '    process.stdout.write(JSON.stringify({ r1, r2, r3 }));',
  '    return;',
  '  }',
  '',
  "  throw new Error('f268-real-spectra-bin-test: unknown mode ' + mode);",
  '}',
  '',
  'main();',
  '',
].join('\n');

let sandbox;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(TMP_BASE, 'real-spectra-bin-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // best-effort：清理失败不影响测试结论
  }
});

/**
 * 在 masked PATH 子进程内跑 `mode` 场景，返回解析后的 JSON 结果。
 * PATH 只含 node 自身所在目录 —— 令一级探针在任何宿主机上确定性 ENOENT。
 */
function runChildScenario(mode, args) {
  const childScript = path.join(sandbox, `child-${mode}.mjs`);
  fs.writeFileSync(childScript, CHILD_SCRIPT_SOURCE);

  const res = spawnSync(process.execPath, [childScript, mode, ...args], {
    encoding: 'utf-8',
    env: {
      PATH: path.dirname(process.execPath),
      HELPER_URL,
      TEST_TMPDIR: sandbox,
    },
  });

  assert.equal(
    res.status,
    0,
    `子进程异常退出：status=${res.status} stdout=${res.stdout} stderr=${res.stderr}`,
  );
  return JSON.parse(res.stdout);
}

describe('resolveRealSpectraBin 二级机制 — a) 二级成功', () => {
  it('fake repoRoot 内造 dist/cli/index.js → 返回可执行 wrapper 绝对路径', () => {
    const repoRoot = path.join(sandbox, 'repo-success');
    fs.mkdirSync(path.join(repoRoot, 'dist', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'dist', 'cli', 'index.js'), FIXTURE_SUCCESS, { mode: 0o755 });

    const result = runChildScenario('resolve-and-exec', [repoRoot]);

    assert.equal(typeof result.bin, 'string');
    assert.ok(path.isAbsolute(result.bin), 'wrapper 路径应为绝对路径');
    assert.ok(result.exec, 'wrapper 应被 --version 复验探针执行');
    assert.equal(result.exec.status, 0);
    assert.match(result.exec.stdout, /spectra vTEST \(fixture\)/);
  });
});

describe('resolveRealSpectraBin 二级机制 — b) 二级缺失', () => {
  it('fake repoRoot 无 dist/cli/index.js → 返回 null（响亮失败契约留给调用方）', () => {
    const repoRoot = path.join(sandbox, 'repo-missing');
    fs.mkdirSync(repoRoot, { recursive: true });

    const result = runChildScenario('resolve-and-exec', [repoRoot]);

    assert.equal(result.bin, null);
    assert.equal(result.exec, null);
  });
});

describe('resolveRealSpectraBin 二级机制 — c) 复验拦截', () => {
  it('dist/cli/index.js 存在但 --version exit 1 → 返回 null（不冒充假可用）', () => {
    const repoRoot = path.join(sandbox, 'repo-reject');
    fs.mkdirSync(path.join(repoRoot, 'dist', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'dist', 'cli', 'index.js'), FIXTURE_REJECT, { mode: 0o755 });

    const result = runChildScenario('resolve-and-exec', [repoRoot]);

    assert.equal(result.bin, null, '复验探针 exit 1 应判失败，不得返回 wrapper 路径');
  });
});

describe('resolveRealSpectraBin 二级机制 — d) 转义安全', () => {
  it('repoRoot 路径含 $(...) 与空格 → wrapper 可执行且不发生命令注入', () => {
    const markerPath = path.join(sandbox, 'pwned-marker');
    const weirdRepoRoot = path.join(sandbox, `weird $(touch ${markerPath}) dir`);
    fs.mkdirSync(path.join(weirdRepoRoot, 'dist', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(weirdRepoRoot, 'dist', 'cli', 'index.js'), FIXTURE_SUCCESS, { mode: 0o755 });

    const result = runChildScenario('resolve-and-exec', [weirdRepoRoot]);

    assert.equal(typeof result.bin, 'string');
    assert.ok(result.exec, 'wrapper 应被复验探针执行');
    assert.equal(result.exec.status, 0, '转义正确时元字符不应破坏 wrapper 可执行性');
    assert.match(result.exec.stdout, /spectra vTEST \(fixture\)/);
    assert.equal(
      fs.existsSync(markerPath),
      false,
      'repoRoot 中的 $(touch …) 不得被 sh wrapper 当作命令注入执行',
    );
  });
});

describe('resolveRealSpectraBin 二级机制 — e) 缓存语义', () => {
  it('失败结果不缓存；成功结果同 repoRoot 二次调用命中缓存返回同一路径', () => {
    const repoRoot = path.join(sandbox, 'repo-cache');
    fs.mkdirSync(repoRoot, { recursive: true });
    const distDir = path.join(repoRoot, 'dist', 'cli');

    const result = runChildScenario('cache-sequence', [repoRoot, distDir, FIXTURE_SUCCESS]);

    assert.equal(result.r1, null, '首次调用时 dist 尚不存在，应失败');
    assert.equal(typeof result.r2, 'string', '补上 dist 后应成功——证明首次失败未被缓存污染后续调用');
    assert.equal(result.r2, result.r3, '同一 repoRoot 二次成功调用应命中缓存，返回同一 wrapper 路径');
  });
});
