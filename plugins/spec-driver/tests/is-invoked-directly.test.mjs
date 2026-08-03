/**
 * is-invoked-directly.test.mjs
 * F246 — 共享入口守卫 `isInvokedDirectly` 的语义单测 + 符号链接集成回归。
 *
 * 被修复的失败形态：旧守卫比对未 canonical 化的 `process.argv[1]` 与已 canonical 化的
 * `import.meta.url`，符号链接路径下恒 false → `main()` 不执行 → **exit 0 且零副作用**。
 * 因此集成用例一律**先断言真实副作用**（产物落盘 / stdout 内容），退出码只作辅助信号——
 * 只断退出码的测试对本 bug 完全失明（bug 的表征恰恰就是"一切正常"）。
 *
 * 运行: node --test plugins/spec-driver/tests/is-invoked-directly.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isInvokedDirectly } from '../scripts/lib/is-invoked-directly.mjs';

const HELPER_URL = new URL('../scripts/lib/is-invoked-directly.mjs', import.meta.url).href;
const HELPER_PATH = fileURLToPath(HELPER_URL);
// tests → spec-driver → plugins → 仓库根
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let tmp;
let savedArgv;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f246-guard-'));
  savedArgv = [...process.argv];
});
afterEach(() => {
  process.argv = savedArgv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ────────────────────────────────────────
// T006 helper 单元语义
// ────────────────────────────────────────

describe('isInvokedDirectly — 单元语义', () => {
  it('case 1 direct：argv[1] 为模块自身真实路径 → true', () => {
    process.argv[1] = HELPER_PATH;
    assert.equal(isInvokedDirectly(HELPER_URL), true);
  });

  it('case 1b direct（symlink）：argv[1] 经符号链接指向模块自身 → true（本 fix 的核心语义）', () => {
    const linked = path.join(tmp, 'linked-helper.mjs');
    fs.symlinkSync(HELPER_PATH, linked);
    process.argv[1] = linked;
    // 旧写法（path.resolve 词法归一 / 手拼 file:// 字符串）在此恒为 false
    assert.notEqual(path.resolve(linked), HELPER_PATH);
    assert.equal(isInvokedDirectly(HELPER_URL), true);
  });

  it('case 2 imported：argv[1] 为另一个文件（模拟 test runner 入口）→ false', () => {
    const other = path.join(tmp, 'other-entry.mjs');
    fs.writeFileSync(other, 'export const x = 1;\n');
    process.argv[1] = other;
    assert.equal(isInvokedDirectly(HELPER_URL), false);
  });

  it('case 3 argv[1] 缺失 → false，且不抛错', () => {
    process.argv[1] = undefined;
    assert.doesNotThrow(() => isInvokedDirectly(HELPER_URL));
    assert.equal(isInvokedDirectly(HELPER_URL), false);
  });

  it('case 4 realpath 失败 → 回退 path.resolve，不抛错，结果 false', () => {
    const missing = path.join(tmp, 'never-created.mjs');
    assert.equal(fs.existsSync(missing), false);
    process.argv[1] = missing;
    assert.doesNotThrow(() => isInvokedDirectly(HELPER_URL));
    assert.equal(isInvokedDirectly(HELPER_URL), false);
  });

  // 反向误判防线：ESM 按完整 URL（含 search/hash）区分模块实例，而 fileURLToPath 会丢弃这两段。
  // 若不在 helper 里拦截，`?query` / `#hash` 副本会与主入口同路径 → 误判 true → main() 跑两次。
  it('case 5 moduleUrl 带 ?query（import 副本）且路径同 argv[1] → false', () => {
    process.argv[1] = HELPER_PATH;
    assert.equal(isInvokedDirectly(HELPER_URL), true); // 对照：无 query 时为 true
    assert.equal(isInvokedDirectly(`${HELPER_URL}?f246-import-copy`), false);
  });

  it('case 6 moduleUrl 带 #hash（import 副本）且路径同 argv[1] → false', () => {
    process.argv[1] = HELPER_PATH;
    assert.equal(isInvokedDirectly(`${HELPER_URL}#f246-import-copy`), false);
  });
});

// ────────────────────────────────────────
// T007 符号链接集成回归：经 symlink 路径实跑脚本，断言真实副作用
// ────────────────────────────────────────

describe('symlink 路径下脚本仍真实执行 main()（回归：exit 0 静默空转）', () => {
  it('record-workflow-run.mjs 经 symlink 调用 → run 事件真实落盘', () => {
    const linkRoot = path.join(tmp, 'link');
    fs.symlinkSync(REPO_ROOT, linkRoot);
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot);

    const cli = path.join(linkRoot, 'plugins/spec-driver/scripts/record-workflow-run.mjs');
    const res = spawnSync(process.execPath, [
      cli,
      '--project-root', projectRoot,
      '--workflow-id', 'spec-driver-fix',
      '--run-id', 'f246-symlink',
      '--result', 'success',
    ], { encoding: 'utf8' });

    // 先断副作用：文件必须真实落盘（旧守卫下该目录根本不会被创建）
    const runsDir = path.join(projectRoot, '.specify', 'runs');
    assert.equal(fs.existsSync(runsDir), true, `runs 目录未创建（main() 未执行）stdout=${res.stdout} stderr=${res.stderr}`);
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.jsonl'));
    assert.equal(files.length, 1, `期望 1 个 jsonl，实际 ${files.length}`);
    const lines = fs.readFileSync(path.join(runsDir, files[0]), 'utf8').split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.workflowId, 'spec-driver-fix');
    assert.equal(event.runId, 'f246-symlink');
    assert.equal(event.result, 'success');

    // 退出码仅作辅助信号（本 bug 下它同样是 0）
    assert.equal(res.status, 0, res.stderr);
  });

  it('verify-feature-176.mjs --test-mode 经 symlink 调用 → stdout 产出逐 step JSON', () => {
    const linkRoot = path.join(tmp, 'link');
    fs.symlinkSync(REPO_ROOT, linkRoot);

    const cli = path.join(linkRoot, 'scripts/verify-feature-176.mjs');
    const res = spawnSync(process.execPath, [cli, '--test-mode'], { encoding: 'utf8' });

    // 旧守卫下 stdout 为空且 exit 0；此处只断"main() 确实跑出了逐 step 输出"，
    // 不断言具体 PASS/FAIL（真实验收结果依赖仓库产物状态，与本回归无关）。
    const steps = res.stdout
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o && typeof o.step === 'string' && typeof o.ok === 'boolean' && typeof o.detail === 'string');

    assert.ok(steps.length >= 1, `期望至少 1 行 {step,ok,detail} JSON，实际 0 行（main() 未执行）stdout=${JSON.stringify(res.stdout)}`);
  });
});

// ────────────────────────────────────────
// Codex 审查轮回归锁：query 型 import 副本不得触发第二次 main()
// ────────────────────────────────────────

describe('带 query 的 import 副本不重复执行 main()（回归：反向误判 true）', () => {
  it('spec-drift-cli.mjs 经 --import "<self>?query" 预载后 --help 只输出一次用法头', () => {
    const cli = path.join(REPO_ROOT, 'scripts/spec-drift-cli.mjs');
    // ESM 视 `file://…mjs?f246-import-copy` 与 `file://…mjs` 为两个模块实例，故 CLI 被求值两次；
    // 守卫若丢弃 query 后比路径，两次都判 true → main() 跑两次（修复前实测用法头出现 2 次）。
    const res = spawnSync(process.execPath, [
      '--import', `${pathToFileURL(cli).href}?f246-import-copy`,
      cli,
      '--help',
    ], { encoding: 'utf8' });

    const usageHeaders = res.stdout.split('\n').filter((l) => l.startsWith('用法：'));
    assert.equal(
      usageHeaders.length,
      1,
      `期望用法头恰好 1 次，实际 ${usageHeaders.length} 次（>1 = import 副本被误判为直接执行）stdout=${JSON.stringify(res.stdout)} stderr=${res.stderr}`,
    );
    assert.equal(res.status, 0, res.stderr);
  });
});
