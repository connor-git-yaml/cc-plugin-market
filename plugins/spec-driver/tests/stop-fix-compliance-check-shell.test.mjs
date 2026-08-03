/**
 * stop-fix-compliance-check-shell.test.mjs
 * Feature 240 / T028 — Stop hook 薄壳的插件根三级 fallback 与退出码合同
 *
 * 被测对象：plugins/spec-driver/hooks/stop-fix-compliance-check.sh
 *
 * 🔴 立此文件的直接理由：该脚本此前**全仓零测试覆盖**。它是阻断型 hook（exit 2 会打断
 * Claude Code 的 Stop 流程），改它而没有回归防线等于裸奔。T028 扩展了插件根解析链
 * （CLAUDE_PLUGIN_ROOT → PLUGIN_ROOT → BASH_SOURCE，见 spec FR-005 rev4 的优先级修订），
 * 本文件把各种环境变量组合各钉一条断言。
 *
 * 测试策略：造一个**假插件根**，其 scripts/fix-compliance-judge.mjs 是一枚探针 —— 它把
 * 自己的绝对路径写进 PROBE_OUT 指向的文件，并按 PROBE_EXIT 决定退出码。于是"薄壳解析出了
 * 哪个插件根"变成可观测事实，而不是靠读代码推断；同时完全不触碰真实判定器（不产生副作用）。
 *
 * 运行方式: node --test plugins/spec-driver/tests/stop-fix-compliance-check-shell.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_PLUGIN_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REAL_PLUGIN_ROOT, 'hooks', 'stop-fix-compliance-check.sh');

// 受限沙箱里 os.tmpdir() 可能 EPERM；沿用 pre-tool-use-guard.test.mjs 的 TEST_TMPDIR 覆盖约定。
const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

/** hook 以 `#!/usr/bin/env bash` 运行；直接用绝对路径 bash 调用，避免受限 PATH 解析不到解释器。 */
const BASH =
  ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash'].find((p) =>
    fs.existsSync(p),
  ) ?? 'bash';

const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

/**
 * 建临时目录并**取 realpath**。
 * 探针记录的是 `import.meta.url` 对应的 canonical 路径（Node 解析主入口时会解开符号链接），
 * 而 macOS 的 `os.tmpdir()` 落在 `/var → /private/var` 这条软链下。不对齐就会拿
 * 环境噪声当断言失败。
 */
function mkTemp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(TMP_BASE, prefix)));
  tempDirs.push(dir);
  return dir;
}

const PROBE_SOURCE = `#!/usr/bin/env node
// 测试探针：记录"薄壳最终解析出的 CLI 路径"，并按 PROBE_EXIT 决定退出码。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = process.env.PROBE_OUT;
if (out) fs.writeFileSync(out, fileURLToPath(import.meta.url), 'utf-8');
process.exit(Number(process.env.PROBE_EXIT ?? '0'));
`;

/** 造一个假插件根：<root>/scripts/fix-compliance-judge.mjs 为探针 */
function makeFakePluginRoot(label) {
  const root = mkTemp(`stop-hook-${label}-`);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'fix-compliance-judge.mjs'), PROBE_SOURCE, 'utf-8');
  return root;
}

/**
 * 造一份 hook 脚本的**副本**插件根：<root>/hooks/stop-fix-compliance-check.sh + 探针 CLI。
 * 用于 BASH_SOURCE 推导用例 —— 只有让脚本自身位于假根内，第三级 fallback 的结果才可观测，
 * 且不会去执行真实判定器。
 */
function makeCopiedPluginRoot() {
  const root = makeFakePluginRoot('copy');
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  const copied = path.join(root, 'hooks', 'stop-fix-compliance-check.sh');
  fs.copyFileSync(SCRIPT, copied);
  fs.chmodSync(copied, 0o755);
  return { root, script: copied };
}

/**
 * 执行 hook。
 * @param {{script?: string, env?: Record<string,string>, cwd?: string, probeExit?: string}} opts
 * @returns {{status: number, probePath: string|null, stdout: string, stderr: string}}
 */
function runHook({ script = SCRIPT, env = {}, cwd, probeExit } = {}) {
  const workdir = cwd ?? mkTemp('stop-hook-cwd-');
  const probeOut = path.join(mkTemp('stop-hook-probe-'), 'resolved.txt');
  const res = spawnSync(BASH, [script], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'test' }),
    cwd: workdir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME ?? workdir,
      PROBE_OUT: probeOut,
      PROBE_EXIT: probeExit ?? '0',
      ...env,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(res.error, undefined, `spawn 失败: ${res.error}`);
  assert.notEqual(res.status, null, `hook 未正常退出（signal=${res.signal}）`);
  return {
    status: res.status,
    probePath: fs.existsSync(probeOut) ? fs.readFileSync(probeOut, 'utf-8') : null,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

describe('stop-fix-compliance-check.sh（Feature 240 插件根三级 fallback）', () => {
  it('#1 仅 PLUGIN_ROOT → 解析到 PLUGIN_ROOT 下的 CLI，exit 0', () => {
    const root = makeFakePluginRoot('lvl1');
    const res = runHook({ env: { PLUGIN_ROOT: root } });

    assert.equal(res.probePath, path.join(root, 'scripts', 'fix-compliance-judge.mjs'));
    assert.equal(res.status, 0);
  });

  it('#2 仅 CLAUDE_PLUGIN_ROOT → 解析到 CLAUDE_PLUGIN_ROOT 下的 CLI，exit 0', () => {
    const root = makeFakePluginRoot('lvl2');
    const res = runHook({ env: { CLAUDE_PLUGIN_ROOT: root } });

    assert.equal(res.probePath, path.join(root, 'scripts', 'fix-compliance-judge.mjs'));
    assert.equal(res.status, 0);
  });

  it('#3 两者皆无 → 按 BASH_SOURCE 推导为 hooks/ 的上一级，exit 0', () => {
    const { root, script } = makeCopiedPluginRoot();
    const res = runHook({ script });

    assert.equal(res.probePath, path.join(root, 'scripts', 'fix-compliance-judge.mjs'));
    assert.equal(res.status, 0);
  });

  it('#4 优先级：两者同时存在时 CLAUDE_PLUGIN_ROOT 胜出（且都优先于 BASH_SOURCE 推导）', () => {
    // 🔴 spec FR-005 rev4：官方注入的 CLAUDE_PLUGIN_ROOT 排在通用的 PLUGIN_ROOT 之前。
    // PLUGIN_ROOT 是极通用变量名，环境里任何无关工具导出它都会挤掉权威值，而失效是静默的
    // （判定器找不到 → 兜底 exit 0 → 依从性判定整体失效却无信号）。
    const preferred = makeFakePluginRoot('win');
    const shadowed = makeFakePluginRoot('lose');
    const res = runHook({
      env: { CLAUDE_PLUGIN_ROOT: preferred, PLUGIN_ROOT: shadowed },
    });

    assert.equal(res.probePath, path.join(preferred, 'scripts', 'fix-compliance-judge.mjs'));
    assert.ok(!res.probePath.startsWith(shadowed));
    assert.ok(!res.probePath.startsWith(REAL_PLUGIN_ROOT));
  });

  it('#4b 环境污染：无关工具导出的 PLUGIN_ROOT 不得挤掉 Claude 注入的权威值', () => {
    const authoritative = makeFakePluginRoot('authoritative');
    // 模拟"某无关工具把自己的根导出成 PLUGIN_ROOT"：目录存在但里面没有我方判定器
    const pollution = mkTemp('unrelated-tool-');

    const res = runHook({ env: { CLAUDE_PLUGIN_ROOT: authoritative, PLUGIN_ROOT: pollution } });

    assert.equal(res.probePath, path.join(authoritative, 'scripts', 'fix-compliance-judge.mjs'));
    assert.equal(res.status, 0);
  });

  it('#4c 存在性探测：靠前一级探不到判定器时继续向下 fallback，而不是静默放行', () => {
    // CLAUDE_PLUGIN_ROOT 指向一个没有判定器的目录 → 必须落到 PLUGIN_ROOT 这一级
    const empty = mkTemp('no-judge-');
    const usable = makeFakePluginRoot('fallback-target');

    const res = runHook({ env: { CLAUDE_PLUGIN_ROOT: empty, PLUGIN_ROOT: usable }, probeExit: '2' });

    assert.equal(res.probePath, path.join(usable, 'scripts', 'fix-compliance-judge.mjs'));
    assert.equal(res.status, 2, '探测到的判定器必须真的被执行（exit 2 原样转发）');
  });

  it('#5 空串取值不算"已设置"，继续向下一级 fallback', () => {
    const root = makeFakePluginRoot('empty');
    const res = runHook({ env: { PLUGIN_ROOT: '', CLAUDE_PLUGIN_ROOT: root } });

    assert.equal(res.probePath, path.join(root, 'scripts', 'fix-compliance-judge.mjs'));
    assert.equal(res.status, 0);
  });

  it('#6 退出码合同：CLI 退出 2 → 原样转发 2（阻断）', () => {
    const root = makeFakePluginRoot('exit2');
    const res = runHook({ env: { PLUGIN_ROOT: root }, probeExit: '2' });

    assert.equal(res.status, 2);
  });

  it('#7 退出码合同：CLI 崩溃（非 0/2）→ 兜底放行 exit 0（FR-013 第二道保险）', () => {
    const root = makeFakePluginRoot('exit7');
    const res = runHook({ env: { PLUGIN_ROOT: root }, probeExit: '7' });

    assert.equal(res.status, 0);
  });

  it('#8 三级都定位不到 CLI → 仍 exit 0，不把 node 的 1 泄漏出去', () => {
    // 脚本副本所在的根里也没有判定器 ⇒ BASH_SOURCE 推导这一级同样探不到，
    // 三级全灭才是本用例要覆盖的边界（且全程不触碰真实判定器）。
    const barren = mkTemp('stop-hook-barren-');
    fs.mkdirSync(path.join(barren, 'hooks'), { recursive: true });
    const script = path.join(barren, 'hooks', 'stop-fix-compliance-check.sh');
    fs.copyFileSync(SCRIPT, script);
    fs.chmodSync(script, 0o755);
    const missing = mkTemp('stop-hook-missing-');

    const res = runHook({ script, env: { PLUGIN_ROOT: missing } });

    assert.equal(res.probePath, null);
    assert.equal(res.status, 0);
  });

  it('#9 FIX_COMPLIANCE_CLI 显式覆盖时优先于三级链', () => {
    const root = makeFakePluginRoot('explicit');
    const ignored = makeFakePluginRoot('ignored');
    const res = runHook({
      env: {
        PLUGIN_ROOT: ignored,
        FIX_COMPLIANCE_CLI: path.join(root, 'scripts', 'fix-compliance-judge.mjs'),
      },
    });

    assert.equal(res.probePath, path.join(root, 'scripts', 'fix-compliance-judge.mjs'));
    assert.equal(res.status, 0);
  });
});
