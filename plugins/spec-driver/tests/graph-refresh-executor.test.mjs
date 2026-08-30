/**
 * graph-refresh-executor.test.mjs
 * Feature 241 — 刷新执行层（FR-007，SC-002/006）
 *
 * 本文件的职责边界：**只测 reason 映射**。刷新失败后的出口改写（刷新前 present → consume-degraded、
 * missing/corrupt → unavailable）属于决策层，由 `graph-consumption-decision.test.mjs` 覆盖，
 * 两边不重叠 —— 同一条规则被两个文件各断一次，改规则时只有一边红，是最难查的那类测试债。
 *
 * 依赖注入缝（P-W2）：`attemptLocalGraphBuild` 是可选具名参数。注入 fake 才能穷举四类失败分支
 * 而不必真的把 spectra 卸载/挂起；但**至少保留两条不注入的集成用例**，否则"映射表全绿、真实
 * 调用签名早就对不上"这类漂移测不出来。
 *
 * SC-002 集成用例的「真实 spectra」解析走 `tests/lib/real-spectra-bin.mjs` 的两级回退链
 * （PATH 全局安装 ∨ 仓内 dist/cli/index.js 构建产物），CI runner 无全局安装时不再恒红（F268）。
 *
 * 运行方式: node --test plugins/spec-driver/tests/graph-refresh-executor.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { executeRefresh } from '../scripts/lib/graph-refresh-executor.mjs';
import { DEGRADED_REASONS } from '../scripts/lib/graph-consumption-decision.mjs';
import { resolveRealSpectraBin } from './lib/real-spectra-bin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(__dirname, '..', 'scripts', 'lib', 'graph-refresh-executor.mjs');
const MODULE_SOURCE = fs.readFileSync(MODULE_PATH, 'utf-8');

const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

let sandbox;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(TMP_BASE, 'graph-refresh-executor-'));
});

afterEach(() => {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
});

/** 造一个能被 spectra AST walker 认出的最小 TS 项目（两文件一条 calls 边）。 */
function seedTsProject(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function helper(): number {\n  return 1;\n}\n');
  fs.writeFileSync(
    path.join(root, 'src', 'b.ts'),
    "import { helper } from './a';\nexport function main(): number {\n  return helper() + 1;\n}\n",
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'f241-refresh-fixture', version: '1.0.0', private: true }, null, 2)}\n`,
  );
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
}

/** 计数式 fake：既回放指定结果，也记录被调用次数与实参。 */
function fakeBuild(result) {
  const calls = [];
  const fn = async (options) => {
    calls.push(options);
    return result;
  };
  fn.calls = calls;
  return fn;
}

describe('FR-007 四类失败 → 四个 refresh-failed-* 枚举值', () => {
  const MAPPING = [
    ['spawn-error', DEGRADED_REASONS.REFRESH_FAILED_SPECTRA_MISSING],
    ['timeout', DEGRADED_REASONS.REFRESH_FAILED_TIMEOUT],
    ['non-zero-exit', DEGRADED_REASONS.REFRESH_FAILED_NONZERO_EXIT],
    ['graph-not-queryable', DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE],
  ];

  for (const [reason, expected] of MAPPING) {
    it(`attemptLocalGraphBuild reason=${reason} → ${expected}`, async () => {
      const build = fakeBuild({ ok: false, reason });
      const outcome = await executeRefresh({
        projectRoot: sandbox,
        spectraBin: 'spectra',
        refreshPolicy: 'allowed',
        attemptLocalGraphBuild: build,
      });

      assert.equal(outcome.attempted, true);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.degradedReason, expected);
      assert.equal(build.calls.length, 1, '单次 executeRefresh 只应 spawn 一次构建（FR-008）');
    });
  }

  it('另两个产物类失败（graph-missing-after-build / graph-unparsable）同归 artifact-unusable', async () => {
    for (const reason of ['graph-missing-after-build', 'graph-unparsable']) {
      const outcome = await executeRefresh({
        projectRoot: sandbox,
        spectraBin: 'spectra',
        refreshPolicy: 'allowed',
        attemptLocalGraphBuild: fakeBuild({ ok: false, reason }),
      });
      assert.equal(outcome.degradedReason, DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE, reason);
    }
  });

  it('未识别 reason → artifact-unusable，但原始 reason 必须保留在 detail 里（不静默吞掉）', async () => {
    const outcome = await executeRefresh({
      projectRoot: sandbox,
      spectraBin: 'spectra',
      refreshPolicy: 'allowed',
      attemptLocalGraphBuild: fakeBuild({ ok: false, reason: 'brand-new-failure-mode' }),
    });
    assert.equal(outcome.degradedReason, DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE);
    assert.match(String(outcome.detail), /brand-new-failure-mode/);
  });

  it('映射出的 reason 全部落在 DEGRADED_REASONS 封闭枚举内', async () => {
    const reasons = ['spawn-error', 'timeout', 'non-zero-exit', 'graph-not-queryable', 'whatever'];
    for (const reason of reasons) {
      const outcome = await executeRefresh({
        projectRoot: sandbox,
        spectraBin: 'spectra',
        refreshPolicy: 'allowed',
        attemptLocalGraphBuild: fakeBuild({ ok: false, reason }),
      });
      assert.ok(Object.values(DEGRADED_REASONS).includes(outcome.degradedReason), reason);
    }
  });
});

describe('FR-007 成功路径与 policy 守卫', () => {
  it('ok:true → degradedReason 为 null，durationMs 为非负数', async () => {
    const outcome = await executeRefresh({
      projectRoot: sandbox,
      spectraBin: 'spectra',
      refreshPolicy: 'allowed',
      attemptLocalGraphBuild: fakeBuild({ ok: true }),
    });
    assert.equal(outcome.attempted, true);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.degradedReason, null);
    assert.equal(typeof outcome.durationMs, 'number');
    assert.ok(outcome.durationMs >= 0);
  });

  it('refreshPolicy=declined → 根本不 spawn（attempted:false，durationMs 为 null）', async () => {
    const build = fakeBuild({ ok: true });
    const outcome = await executeRefresh({
      projectRoot: sandbox,
      spectraBin: 'spectra',
      refreshPolicy: 'declined',
      attemptLocalGraphBuild: build,
    });
    assert.equal(outcome.attempted, false);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.degradedReason, null);
    assert.equal(outcome.durationMs, null);
    assert.equal(build.calls.length, 0, 'declined 下不得触碰构建器');
  });

  it('projectRoot / spectraBin 原样透传给构建器（签名漂移守卫）', async () => {
    const build = fakeBuild({ ok: true });
    await executeRefresh({
      projectRoot: sandbox,
      spectraBin: '/custom/path/spectra',
      refreshPolicy: 'allowed',
      attemptLocalGraphBuild: build,
    });
    assert.equal(build.calls[0].projectRoot, sandbox);
    assert.equal(build.calls[0].spectraBin, '/custom/path/spectra');
  });
});

describe('D8 约束：executor 不得自带第二份 spawn / deadline 实现', () => {
  it('源码无 child_process / spawn / setTimeout —— 有界子进程逻辑只有 canonical 一份', () => {
    const withoutComments = MODULE_SOURCE.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of ['child_process', 'spawn(', 'spawnSync', 'setTimeout', 'SIGKILL']) {
      assert.equal(
        withoutComments.includes(forbidden),
        false,
        `executor 出现 ${forbidden} —— 两份各自维护的 deadline 逻辑迟早漂移（D8 禁止复制）`,
      );
    }
  });

  it('默认构建器绑定 canonical 模块（唯一 import 来源）', () => {
    assert.match(MODULE_SOURCE, /from '\.\/graph-bootstrap-status\.mjs'/);
  });
});

describe('FR-007 / SC-002 集成用例（不注入 fake，走真实 attemptLocalGraphBuild）', () => {
  it('真实 spectra + 最小 git fixture：真实 graph-only 重建成功并产出可查询图', async () => {
    // 真实 spectra 的解析来源：PATH 全局安装 ∨ 仓内 dist/cli/index.js 构建产物
    //（全局发布版 ∨ 本仓构建产物，均为真实 spectra CLI；解析细节与边界见该文件头）
    const bin = resolveRealSpectraBin();
    if (bin === null) {
      assert.fail(
        '本机 spectra CLI 不可用（PATH 全局安装与仓内 dist/cli/index.js 构建产物两级解析均失败），' +
          'SC-002 的真实刷新证据无法取得——不得以 mock 冒充（请先 npm run build 或安装全局 spectra 后重跑）',
      );
    }

    seedTsProject(sandbox);
    const graphPath = path.join(sandbox, 'specs', '_meta', 'graph.json');
    assert.equal(fs.existsSync(graphPath), false, '前置：fixture 此刻无图');

    const outcome = await executeRefresh({
      projectRoot: sandbox,
      spectraBin: bin,
      refreshPolicy: 'allowed',
      // 刻意不传 attemptLocalGraphBuild：走默认绑定的 canonical 真实实现
    });

    assert.equal(outcome.attempted, true);
    assert.equal(outcome.ok, true, `真实重建应成功，实得 ${JSON.stringify(outcome)}`);
    assert.equal(outcome.degradedReason, null);
    assert.ok(outcome.durationMs > 0, '真实重建耗时应为正数');

    assert.equal(fs.existsSync(graphPath), true, '真实产物必须落盘');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    assert.equal(typeof graph.graph.sourceCommit, 'string');
    assert.ok(graph.graph.sourceCommit.length > 0);
    assert.ok((graph.nodes ?? []).length > 0, '图内应有节点');
  });

  it('真实实现 + 不存在的 spectraBin → refresh-failed-spectra-missing（真实 ENOENT，非 mock）', async () => {
    seedTsProject(sandbox);
    const outcome = await executeRefresh({
      projectRoot: sandbox,
      spectraBin: path.join(sandbox, 'no-such-spectra-binary'),
      refreshPolicy: 'allowed',
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.degradedReason, DEGRADED_REASONS.REFRESH_FAILED_SPECTRA_MISSING);
  });
});
