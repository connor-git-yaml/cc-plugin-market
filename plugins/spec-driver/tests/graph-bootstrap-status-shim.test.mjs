/**
 * graph-bootstrap-status-shim.test.mjs
 * Feature 241 — D8 模块迁移的转发壳回归安全网（plan §1.2 / P-W1）
 *
 * 为什么需要这个文件：D8 把 canonical 实现搬进 `plugins/spec-driver/scripts/lib/`，仓根
 * `scripts/lib/graph-bootstrap-status.mjs` 退化为转发壳。若转发壳只写 `export *`，
 * `sync-worktree-local-state.sh` 里 `node "$GRAPH_STATUS_HELPER" write-status ...` 这类
 * **把文件当 CLI 直接执行**的调用会静默失效——被 import 的 canonical 模块内
 * `import.meta.url` 是它自己的 URL，与 `process.argv[1]`（薄壳路径）不等，`invokedDirectly`
 * 恒为 false，`main()` 永不执行，三个子命令全部变成「exit 0 但什么都没做」的空转。
 *
 * 因此本文件的每条断言都盯**真实副作用**（落盘文件 / 结构化 stdout / 非零退出码 / 子进程确被 spawn），
 * 而不是退出码 0 —— 空转恰好也是 0。
 *
 * P-W1 已证伪 `tests/unit/worktree-lifecycle-hook.test.ts` 用例 (b) 能充当此证据：
 * 该用例把 `node` 从 PATH 剔除，helper 根本不会被执行。
 *
 * 执行顺序（T-W2）：T003 先对**迁移前**的仓根实现跑绿 → T004/T005 迁移 → T006 复跑仍绿。
 * 两次都绿即证明迁移前后 CLI 行为等价。
 *
 * 运行方式: node --test plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** 被测对象固定为**仓根**路径：迁移后它是薄壳，迁移前它是 canonical，两态都必须可当 CLI 执行。 */
const ROOT_HELPER = path.join(REPO_ROOT, 'scripts', 'lib', 'graph-bootstrap-status.mjs');
/** canonical 实现所在目录（符号链接用例需要分别对薄壳与 canonical 各验一次守卫）。 */
const PLUGIN_LIB_DIR = path.join(REPO_ROOT, 'plugins', 'spec-driver', 'scripts', 'lib');
const ROOT_LIB_DIR = path.join(REPO_ROOT, 'scripts', 'lib');

const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

let sandbox;

/** 以 CLI 形态执行仓根 helper（这正是 sync-worktree-local-state.sh 的调用形态）。 */
function runHelper(args, options = {}) {
  const result = spawnSync('node', [ROOT_HELPER, ...args], {
    cwd: options.cwd ?? sandbox,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

/** 造一个最小 git 项目 + 一份可解析的 graph.json。 */
function seedProject(root, { withGraph = true } = {}) {
  fs.mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  if (withGraph) {
    fs.writeFileSync(
      path.join(root, 'specs', '_meta', 'graph.json'),
      JSON.stringify({ graph: { sourceCommit: 'a'.repeat(40) }, nodes: [], edges: [] }),
    );
  }
}

/**
 * 落一个假 `spectra` 可执行文件，记录自己被调用的实参并伪造构建产物。
 * 存在与否直接区分「helper 真的 spawn 了子进程」与「helper 空转」。
 */
function seedFakeSpectra(root, { writeGraph }) {
  const binDir = path.join(root, 'fakebin');
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, 'fake-spectra');
  const graphWrite = writeGraph
    ? `mkdir -p "$PWD/specs/_meta"\nprintf '%s' '{"graph":{"sourceCommit":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}}' > "$PWD/specs/_meta/graph.json"\n`
    : '';
  fs.writeFileSync(
    binPath,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$PWD/fake-spectra-invocations.log"\n${graphWrite}exit 0\n`,
    { mode: 0o755 },
  );
  return binPath;
}

function readInvocations(root) {
  const logPath = path.join(root, 'fake-spectra-invocations.log');
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf-8').split('\n').filter((line) => line.length > 0);
}

describe('F241 D8 — 仓根 graph-bootstrap-status.mjs 的 CLI 转发不得静默空转', () => {
  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(TMP_BASE, 'graph-status-shim-'));
    seedProject(sandbox);
  });

  afterEach(() => {
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  });

  it('write-status：真实落盘 graph-bootstrap-status.json（空转只会 exit 0 而不产生文件）', () => {
    const statusPath = path.join(sandbox, 'specs', '_meta', 'graph-bootstrap-status.json');
    assert.equal(fs.existsSync(statusPath), false, '前置：状态文件此刻不应存在');

    const result = runHelper(['write-status', '--project-root', sandbox, '--build-attempted', 'true', '--build-succeeded', 'true']);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(fs.existsSync(statusPath), true, '状态文件必须被真实写出——未写出即 main() 未执行');

    const payload = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.bootstrapSource, 'local-build');
    assert.equal(payload.embeddedSourceCommitAtBootstrap, 'a'.repeat(40));
    assert.equal(payload.assessable, true);
    assert.equal(typeof payload.generatedAt, 'string');
  });

  it('write-status --dry-run：打印操作计划到 stdout（空转不会有任何输出）', () => {
    const result = runHelper(['write-status', '--project-root', sandbox, '--dry-run', 'true']);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.match(result.stdout, /\[dry-run\] 拟写状态文件/);
    assert.equal(
      fs.existsSync(path.join(sandbox, 'specs', '_meta', 'graph-bootstrap-status.json')),
      false,
      'dry-run 不得落盘',
    );
  });

  it('check-freshness：stdout 输出可解析的 freshness JSON（空转 stdout 为空）', () => {
    // 故意指向不存在的二进制：ENOENT 路径快且确定，产出 spectra-cli-missing 这一结构化结论
    const result = runHelper([
      'check-freshness',
      '--project-root',
      sandbox,
      '--spectra-bin',
      path.join(sandbox, 'no-such-spectra-binary'),
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.notEqual(result.stdout.trim(), '', 'stdout 为空即 main() 未执行');

    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.state, 'unknown-provenance');
    assert.equal(verdict.reason, 'spectra-cli-missing');
  });

  it('check-freshness：真实 spawn 子进程并把参数原样传给 spectra（数组形式，非 shell 拼接）', () => {
    const fakeBin = seedFakeSpectra(sandbox, { writeGraph: false });

    const result = runHelper(['check-freshness', '--project-root', sandbox, '--spectra-bin', fakeBin]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    const invocations = readInvocations(sandbox);
    assert.equal(invocations.length, 1, '假 spectra 必须恰被 spawn 一次——零次即 main() 未执行');
    assert.match(invocations[0], /^graph-quality --json --graph /);
  });

  it('attempt-build：真实 spawn 构建并在产物就绪时 exit 0', () => {
    const fakeBin = seedFakeSpectra(sandbox, { writeGraph: true });
    fs.rmSync(path.join(sandbox, 'specs', '_meta', 'graph.json'));

    const result = runHelper([
      'attempt-build',
      '--project-root',
      sandbox,
      '--spectra-bin',
      fakeBin,
      '--deadline-ms',
      '15000',
    ]);

    assert.equal(result.status, 0, `stdout=${result.stdout} stderr=${result.stderr}`);
    const invocations = readInvocations(sandbox);
    assert.equal(invocations.length, 1, '假 spectra 必须恰被 spawn 一次');
    assert.equal(invocations[0], 'batch --mode graph-only');
    assert.equal(fs.existsSync(path.join(sandbox, 'specs', '_meta', 'graph.json')), true);
  });

  it('attempt-build：spawn 失败时 exit 1 且 stdout 报 reason（空转会给 exit 0 + 空 stdout）', () => {
    const result = runHelper([
      'attempt-build',
      '--project-root',
      sandbox,
      '--spectra-bin',
      path.join(sandbox, 'no-such-spectra-binary'),
      '--deadline-ms',
      '15000',
    ]);

    assert.equal(result.status, 1, `stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stdout, /reason: spawn-error/);
  });

  it('未知子命令：exit 2 + stderr 提示（退出码 2 只可能来自 main()）', () => {
    const result = runHelper(['definitely-not-a-subcommand']);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /未知子命令/);
  });

  /**
   * T027a —— 符号链接路径下的自调用守卫回归（批 1 审查发现 1）。
   *
   * Node 默认解析符号链接，`import.meta.url` 给的是 **realpath**，而 `process.argv[1]` 是用户敲进来的
   * 字面路径。只要中间隔着一层符号链接（macOS 的 `/tmp` → `/private/tmp`、符号链接的插件安装目录、
   * Codex-managed worktree 里软链过来的 `scripts/`），`path.resolve` 两侧恒不相等 → `invokedDirectly`
   * 恒 false → `main()` 永不执行 → **exit 0 且什么都没做**。
   *
   * 这正是本文件开头警告的最危险形态，因此断言只盯真实副作用（落盘文件），绝不看退出码。
   * 薄壳与 canonical 各有一份守卫，必须分别验证——只修一处会留下另一条同样静默的入口。
   */
  for (const [label, realDir] of [
    ['仓根薄壳', ROOT_LIB_DIR],
    ['canonical 实现', PLUGIN_LIB_DIR],
  ]) {
    it(`${label}：经符号链接目录调用 write-status 仍真实落盘（守卫必须比 realpath）`, () => {
      const linkDir = path.join(sandbox, `link-to-${path.basename(path.dirname(realDir))}-lib-${label}`);
      fs.symlinkSync(realDir, linkDir, 'dir');
      const viaSymlink = path.join(linkDir, 'graph-bootstrap-status.mjs');
      assert.notEqual(viaSymlink, fs.realpathSync(viaSymlink), '前置：调用路径必须确实经过符号链接');

      const statusPath = path.join(sandbox, 'specs', '_meta', 'graph-bootstrap-status.json');
      assert.equal(fs.existsSync(statusPath), false, '前置：状态文件此刻不应存在');

      const result = spawnSync(
        'node',
        [viaSymlink, 'write-status', '--project-root', sandbox, '--build-attempted', 'true', '--build-succeeded', 'true'],
        { cwd: sandbox, encoding: 'utf-8', timeout: 60_000 },
      );

      assert.equal(result.status, 0, `stderr=${result.stderr}`);
      assert.equal(
        fs.existsSync(statusPath),
        true,
        '状态文件未落盘 = main() 未执行 = exit 0 的静默空转（符号链接击穿了自调用守卫）',
      );
      const payload = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      assert.equal(payload.bootstrapSource, 'local-build');
    });
  }

  /**
   * B1-W3 —— 原用例走 `-e` 形态，`process.argv[1]` 是 **undefined**，守卫在
   * `if (entry === undefined) return false` 就提前返回了，`realpathSync` 的 catch 分支
   * 一次都没被执行过——它测的是"argv[1] 为空"，不是"realpath 失败"。
   * 这里显式把 `process.argv[1]` 改写成一个确实不存在的路径，强制走进 catch。
   */
  it('自调用守卫在 argv[1] 指向不存在路径时不抛错（realpath 失败须优雅回退进 catch）', () => {
    const ghostEntry = path.join(sandbox, 'no-such-dir', 'ghost-entry.mjs');
    assert.equal(fs.existsSync(ghostEntry), false, '前置：该路径必须确实不存在');

    const statusPath = path.join(sandbox, 'specs', '_meta', 'graph-bootstrap-status.json');
    const script = [
      `process.argv[1] = ${JSON.stringify(ghostEntry)};`,
      `const mod = await import(${JSON.stringify(`file://${ROOT_HELPER}`)});`,
      // 直接调导出的守卫，确认它在 realpath 失败时返回 false 而不是抛错
      `if (mod.isInvokedDirectly(${JSON.stringify(`file://${ROOT_HELPER}`)}) !== false) {`,
      `  throw new Error('argv[1] 不可解析时守卫不应判为直接调用');`,
      `}`,
      `process.stdout.write('guard-ok\\n');`,
    ].join('\n');

    const result = spawnSync('node', ['--input-type=module', '-e', script], {
      cwd: sandbox,
      encoding: 'utf-8',
      timeout: 60_000,
    });

    assert.equal(result.status, 0, `realpath 失败必须优雅回退，不得抛错；stderr=${result.stderr}`);
    assert.match(result.stdout, /guard-ok/);
    assert.equal(fs.existsSync(statusPath), false, 'import 形态不得触发 main() 的副作用');
  });

  it('B1-W3 同一条 catch 路径下，canonical 的守卫行为与薄壳一致', () => {
    const ghostEntry = path.join(sandbox, 'another-missing', 'entry.mjs');
    const canonical = path.join(PLUGIN_LIB_DIR, 'graph-bootstrap-status.mjs');
    const script = [
      `process.argv[1] = ${JSON.stringify(ghostEntry)};`,
      `const mod = await import(${JSON.stringify(`file://${canonical}`)});`,
      `process.stdout.write(String(mod.isInvokedDirectly(${JSON.stringify(`file://${canonical}`)})) + '\\n');`,
    ].join('\n');

    const result = spawnSync('node', ['--input-type=module', '-e', script], {
      cwd: sandbox,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.stdout.trim(), 'false');
  });

  it('命名导出经仓根路径依然可 import（薄壳 export * 不得丢导出）', async () => {
    const moduleUrl = new URL(`file://${ROOT_HELPER}`);
    const mod = await import(moduleUrl.href);
    for (const name of [
      'SCHEMA_VERSION',
      'readEmbeddedSourceCommit',
      'resolveWorktreeHead',
      'readPreviousStatus',
      'determineBootstrapSource',
      'buildStatusPayload',
      'writeBootstrapStatus',
      'checkFreshness',
      'attemptLocalGraphBuild',
      'main',
    ]) {
      assert.ok(name in mod, `仓根路径缺少命名导出 ${name}`);
    }
  });
});
