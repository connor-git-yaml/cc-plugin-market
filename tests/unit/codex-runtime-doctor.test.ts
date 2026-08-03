/**
 * Feature 240 / T044 — 四方一致性诊断的核心判定单测（SC-012）。
 *
 * 覆盖：
 * - `aggregateOverallStatus` 真值表 4 行 + 「任一 check 非 ok/not-applicable 时 MUST NOT 为 ok」不变量（穷举组合）
 * - 按产品分组的比较矩阵（spectra / spec-driver 各自独立比较，禁止混用）
 * - `marketplace.metadata.version` 显式排除
 * - `normalizeVersion` 归一化（`spectra v4.4.0 (0ae3eb7)` → `4.4.0`；不可解析 → indeterminate 而非 fail）
 * - `PLUGIN_BUILD_PROBES` 5 探针：`probedSources.length === 5` 且 id 集合恰等
 * - `createCheck` 的受限类型强制（非法枚举即构造失败）
 * - hook-trust 四情形固定状态值（T048）
 * - `--dangerously-bypass-hook-trust` 产品目录五处零命中门禁（T048，与 T065 共用）
 *
 * 运行：npx vitest run tests/unit/codex-runtime-doctor.test.ts
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const coreUrl = new URL(
  '../../plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs',
  import.meta.url,
).href;
const ioUrl = new URL(
  '../../plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs',
  import.meta.url,
).href;

const core = await import(coreUrl);
const io = await import(ioUrl);

/** 造一个最小 check 对象（只喂 aggregate 用得到的字段） */
function stub(status: string) {
  return { id: `stub.${status}`, category: 'repo-version', product: null, status };
}

/** 在临时目录里造一个仅含所需文件的 fixture 仓库 + Codex 家目录 */
function makeFixture(options: {
  spectraVersion?: string | null;
  specDriverVersion?: string | null;
  marketplaceVersion?: string;
  contractContent?: string;
  hooksJson?: string | null;
  configToml?: string | null;
}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-doctor-'));
  const projectRoot = path.join(base, 'repo');
  const codexHome = path.join(base, 'codex-home');
  fs.mkdirSync(path.join(projectRoot, 'contracts'), { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });

  if (options.contractContent !== undefined) {
    fs.writeFileSync(path.join(projectRoot, 'contracts', 'release-contract.yaml'), options.contractContent);
  } else {
    const lines = [
      'schemaVersion: 1',
      'marketplace:',
      '  metadata:',
      `    version: "${options.marketplaceVersion ?? '1.0.0'}"`,
      'products:',
      '  spectra:',
      `    version: "${options.spectraVersion ?? '4.4.0'}"`,
      '  spec-driver:',
      `    version: "${options.specDriverVersion ?? '4.4.0'}"`,
      '',
    ];
    fs.writeFileSync(path.join(projectRoot, 'contracts', 'release-contract.yaml'), lines.join('\n'));
  }
  if (options.hooksJson != null) {
    fs.writeFileSync(path.join(codexHome, 'hooks.json'), options.hooksJson);
  }
  if (options.configToml != null) {
    fs.writeFileSync(path.join(codexHome, 'config.toml'), options.configToml);
  }
  return { base, projectRoot, codexHome };
}

/** 注入型 exec：按 file 名分派固定结果，未登记的一律 ENOENT */
function makeExec(table: Record<string, { stdout?: string; stderr?: string; status?: number; throws?: unknown }>) {
  return (file: string) => {
    const hit = table[file];
    if (!hit) {
      const err: NodeJS.ErrnoException = new Error('spawn failed');
      err.code = 'ENOENT';
      throw err;
    }
    if (hit.throws) throw hit.throws;
    if ((hit.status ?? 0) !== 0) {
      const err = Object.assign(new Error('non-zero'), {
        status: hit.status,
        stdout: hit.stdout ?? '',
        stderr: hit.stderr ?? '',
      });
      throw err;
    }
    return hit.stdout ?? '';
  };
}

describe('F240 T045 — aggregateOverallStatus 真值表', () => {
  it('全部 ok（允许含 not-applicable）→ ok', () => {
    expect(core.aggregateOverallStatus([stub('ok'), stub('not-applicable'), stub('ok')]).overallStatus).toBe('ok');
  });

  it('无 fail、无 indeterminate、有 warning → warning', () => {
    expect(core.aggregateOverallStatus([stub('ok'), stub('warning')]).overallStatus).toBe('warning');
  });

  it('有 indeterminate、无 fail → warning（clarify #5）', () => {
    expect(core.aggregateOverallStatus([stub('ok'), stub('indeterminate')]).overallStatus).toBe('warning');
  });

  it('有 fail（无论其他）→ fail', () => {
    expect(core.aggregateOverallStatus([stub('ok'), stub('indeterminate'), stub('fail')]).overallStatus).toBe('fail');
    expect(core.aggregateOverallStatus([stub('fail')]).overallStatus).toBe('fail');
  });

  it('空 checks 集 → warning + reason no-checks-executed（防御分支）', () => {
    const agg = core.aggregateOverallStatus([]);
    expect(agg.overallStatus).toBe('warning');
    expect(agg.reason).toBe('no-checks-executed');
  });

  it('不变量：任一 check 非 ok/not-applicable 时 overallStatus MUST NOT 为 ok（穷举全部状态组合）', () => {
    const statuses = core.CHECK_STATUSES as string[];
    // 长度 1~3 的全部组合穷举
    const combos: string[][] = [];
    for (const a of statuses) {
      combos.push([a]);
      for (const b of statuses) {
        combos.push([a, b]);
        for (const c of statuses) combos.push([a, b, c]);
      }
    }
    for (const combo of combos) {
      const overall = core.aggregateOverallStatus(combo.map(stub)).overallStatus;
      const hasNonBenign = combo.some((s) => s !== 'ok' && s !== 'not-applicable');
      if (hasNonBenign) {
        expect(overall, `组合 ${combo.join(',')} 不应聚合为 ok`).not.toBe('ok');
      } else {
        expect(overall, `组合 ${combo.join(',')} 应聚合为 ok`).toBe('ok');
      }
    }
  });
});

describe('F240 T045 — normalizeVersion 归一化', () => {
  it('带 v 前缀与 commit 后缀 → 提取 4.4.0（SC-012 指名用例）', () => {
    expect(core.normalizeVersion('spectra v4.4.0 (0ae3eb7)')).toEqual({
      semver: '4.4.0',
      rawShape: 'decorated-semver',
    });
  });

  it('裸 semver → bare-semver', () => {
    expect(core.normalizeVersion('4.4.0')).toEqual({ semver: '4.4.0', rawShape: 'bare-semver' });
  });

  it('无法提取语义版本 → semver null + unparseable（MUST NOT 直接字符串比较后判 fail）', () => {
    expect(core.normalizeVersion('volta error: could not run command')).toEqual({
      semver: null,
      rawShape: 'unparseable',
    });
  });

  it('空/缺失 → absent', () => {
    expect(core.normalizeVersion('')).toEqual({ semver: null, rawShape: 'absent' });
    expect(core.normalizeVersion(null)).toEqual({ semver: null, rawShape: 'absent' });
  });

  it('只取首个匹配（避免被后缀里的数字串误导）', () => {
    expect(core.normalizeVersion('spectra v4.4.0 (1.2.3)').semver).toBe('4.4.0');
  });
});

describe('F240 T045 — PLUGIN_BUILD_PROBES 5 探针（clarify #3 强标准）', () => {
  it('常量恰为 5 项且 id 集合固定', () => {
    expect(core.PLUGIN_BUILD_PROBES).toHaveLength(5);
    expect([...core.PLUGIN_BUILD_PROBES]).toEqual([
      'codex-plugin-manifest',
      'codex-cli-help',
      'codex-doctor-checks',
      'codex-home-paths',
      'app-server-rpc',
    ]);
  });

  it('plugin-build check 的 details.probedSources 恒为 5 项且 id 集合恰等于常量', async () => {
    const fx = makeFixture({});
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    for (const product of ['spectra', 'spec-driver']) {
      const check = report.checks[`plugin-build.${product}`];
      expect(check, `plugin-build.${product} 必须存在`).toBeTruthy();
      expect(check.details.probedSources).toHaveLength(5);
      expect(check.details.probedSources.map((p: { id: string }) => p.id)).toEqual([
        ...core.PLUGIN_BUILD_PROBES,
      ]);
      for (const probe of check.details.probedSources) {
        expect(core.PROBE_OUTCOMES).toContain(probe.outcome);
        expect(Object.keys(probe).sort()).toEqual(['errorClass', 'id', 'outcome']);
      }
    }
  });

  /** 造一个 Codex 快照缓存：plugins/cache/<market>/<plugin>/<snapshotHash>/.codex-plugin/plugin.json */
  function seedSnapshot(codexHome: string, market: string, plugin: string, snapshot: string, version: string) {
    const dir = path.join(codexHome, 'plugins', 'cache', market, plugin, snapshot, '.codex-plugin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: plugin, version }));
  }

  it('注册表 → 快照 → manifest：版本只从 plugin.json 读，快照目录名（哈希）绝不当版本用', () => {
    const fx = makeFixture({
      spectraVersion: '4.4.0',
      configToml: '[plugins."spectra@some-market"]\nenabled = true\n',
    });
    // 快照目录名刻意写成一个看起来像高版本号的哈希，验证它不会被当版本
    seedSnapshot(fx.codexHome, 'some-market', 'spectra', '9999', '4.4.0');
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['plugin-build.spectra'];
    expect(check.status).toBe('ok');
    expect(check.details.semver).toBe('4.4.0');
    expect(check.details.activeInstallPath).toBe('plugins/cache/some-market/spectra/9999');
    expect(check.details.probedSources.find((p: any) => p.id === 'codex-plugin-manifest').outcome).toBe('found');
  });

  it('多个快照给出不同版本 → 该来源判 error（不得「取第一个」或「取最高」猜一个）', () => {
    const fx = makeFixture({
      spectraVersion: '4.4.0',
      configToml: '[plugins."spectra@some-market"]\nenabled = true\n',
    });
    seedSnapshot(fx.codexHome, 'some-market', 'spectra', 'aaaa1111', '4.4.0');
    seedSnapshot(fx.codexHome, 'some-market', 'spectra', 'bbbb2222', '3.0.0');
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['plugin-build.spectra'];
    expect(check.details.probedSources.find((p: any) => p.id === 'codex-plugin-manifest').outcome).toBe('error');
    // 无任何来源给出确定版本 → indeterminate，绝不落 ok/fail
    expect(check.status).toBe('indeterminate');
  });

  it('codex plugin list --json（级 1）优先于快照 manifest（级 2/3）', () => {
    const fx = makeFixture({
      spectraVersion: '4.4.0',
      configToml: '[plugins."spectra@some-market"]\nenabled = true\n',
    });
    seedSnapshot(fx.codexHome, 'some-market', 'spectra', 'aaaa1111', '3.0.0');
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: (file: string, args: string[]) => {
        if (file === 'codex' && args[0] === 'plugin') {
          return JSON.stringify({ installed: [{ name: 'spectra', enabled: true, version: '4.4.0' }] });
        }
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['plugin-build.spectra'];
    expect(check.status).toBe('ok');
    expect(check.details.semver).toBe('4.4.0');
  });

  it('plugin build 版本与仓库不一致 → fail + reinstall-plugin', () => {
    const fx = makeFixture({ spectraVersion: '4.4.0' });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: (file: string, args: string[]) => {
        if (file === 'codex' && args[0] === 'plugin') {
          return JSON.stringify({ installed: [{ name: 'spectra', enabled: true, version: '3.0.0' }] });
        }
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['plugin-build.spectra'];
    expect(check.status).toBe('fail');
    expect(check.remediation.code).toBe('reinstall-plugin');
    expect(report.overallStatus).toBe('fail');
  });

  it('未启用的 plugin 条目不被采信（enabled=false → 该来源 absent）', () => {
    const fx = makeFixture({ spectraVersion: '4.4.0' });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: (file: string, args: string[]) => {
        if (file === 'codex' && args[0] === 'plugin') {
          return JSON.stringify({ installed: [{ name: 'spectra', enabled: false, version: '3.0.0' }] });
        }
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(report.checks['plugin-build.spectra'].status).toBe('indeterminate');
  });

  it('全部探针非 found 时才允许 indeterminate + reason codex-active-marker-unknown', () => {
    const fx = makeFixture({});
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['plugin-build.spectra'];
    expect(check.status).toBe('indeterminate');
    expect(check.details.probedSources.every((p: { outcome: string }) => p.outcome !== 'found')).toBe(true);
  });
});

describe('F240 T045 — 按产品分组的比较矩阵', () => {
  it('spectra 与 spec-driver 的仓库版本各自独立读取（不混用）', () => {
    const fx = makeFixture({ spectraVersion: '4.4.0', specDriverVersion: '3.1.2' });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(report.checks['repo-version.spectra'].details.semver).toBe('4.4.0');
    expect(report.checks['repo-version.spec-driver'].details.semver).toBe('3.1.2');
    expect(report.checks['repo-version.spectra'].details.versionField).toBe('products.spectra.version');
    expect(report.checks['repo-version.spec-driver'].details.versionField).toBe('products.spec-driver.version');
  });

  it('marketplace.metadata.version 被显式排除，从未出现在任何 check 的比较输入中', () => {
    const fx = makeFixture({ spectraVersion: '4.4.0', specDriverVersion: '4.4.0', marketplaceVersion: '9.9.9' });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({ spectra: { stdout: 'spectra v9.9.9 (0ae3eb7)\n' } }),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect([...core.EXCLUDED_VERSION_PATHS]).toEqual(['marketplace.metadata.version']);
    // 9.9.9 只可能来自 marketplace（被排除）→ 若它出现在 repo-version 侧即为回归
    expect(report.checks['repo-version.spectra'].details.semver).toBe('4.4.0');
    expect(report.checks['repo-version.spec-driver'].details.semver).toBe('4.4.0');
    // 而 global-cli 侧的 9.9.9 来自子进程，应判 drift（fail），证明比较确实发生在 products.* 上
    expect(report.checks['global-cli.spectra'].status).toBe('fail');
  });

  it('global-cli.spec-driver 与 mcp-server.spec-driver 为 not-applicable（不是 indeterminate）', () => {
    const fx = makeFixture({});
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(report.checks['global-cli.spec-driver'].status).toBe('not-applicable');
    expect(report.checks['mcp-server.spec-driver'].status).toBe('not-applicable');
    expect(report.checks['mcp-server.spectra'].status).toBe('indeterminate');
    expect(report.checks['mcp-server.spectra'].details.knownGap).toBe(true);
  });

  it('版本一致 → ok；版本漂移 → fail；无法解析 → indeterminate（而非 fail）', () => {
    const fx = makeFixture({ spectraVersion: '4.4.0' });
    const mk = (stdout: string) =>
      io.runDoctor({
        projectRoot: fx.projectRoot,
        codexHome: fx.codexHome,
        env: {},
        exec: makeExec({ spectra: { stdout } }),
        now: () => new Date('2026-08-03T00:00:00.000Z'),
      }).checks['global-cli.spectra'];

    expect(mk('spectra v4.4.0 (0ae3eb7)\n').status).toBe('ok');
    expect(mk('spectra v4.5.0 (0ae3eb7)\n').status).toBe('fail');
    expect(mk('volta error: could not locate binary\n').status).toBe('indeterminate');
  });

  it('volta 包装脚本非零退出 → indeterminate + errorClass non-zero-exit（不是 fail）', () => {
    const fx = makeFixture({});
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({ spectra: { status: 1, stderr: 'Volta error: could not run\n' } }),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['global-cli.spectra'];
    expect(check.status).toBe('indeterminate');
    expect(check.details.errorClass).toBe('non-zero-exit');
    expect(check.details.exitCode).toBe(1);
  });

  it('release-contract 不可读 → repo-version 落 indeterminate（不是 fail）', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-nocontract-'));
    const projectRoot = path.join(base, 'repo');
    const codexHome = path.join(base, 'codex-home');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    const report = io.runDoctor({
      projectRoot,
      codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(report.checks['repo-version.spectra'].status).toBe('indeterminate');
    expect(report.checks['repo-version.spectra'].details.errorClass).toBe('ENOENT');
  });
});

describe('F240 T045 — 报告 schema 与 createCheck 类型强制（SC-012）', () => {
  it('报告与 codex doctor --json 同构，checks 覆盖五个 category', () => {
    const fx = makeFixture({});
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe('2026-08-03T00:00:00.000Z');
    expect(core.OVERALL_STATUSES).toContain(report.overallStatus);

    const categories = new Set(Object.values(report.checks).map((c: any) => c.category));
    expect([...categories].sort()).toEqual(
      ['global-cli', 'hook-trust', 'mcp-server', 'plugin-build', 'repo-version'].sort(),
    );
    for (const [id, check] of Object.entries<any>(report.checks)) {
      expect(check.id).toBe(id);
      expect(core.CHECK_CATEGORIES).toContain(check.category);
      expect(core.CHECK_STATUSES).toContain(check.status);
      expect(typeof check.summary).toBe('string');
      expect(check.summary.length).toBeGreaterThan(0);
      expect(typeof check.details).toBe('object');
      if (check.remediation !== null) {
        expect(Object.keys(check.remediation).sort()).toEqual(['code', 'command', 'text']);
        expect(core.REMEDIATION_CODES).toContain(check.remediation.code);
        expect(check.remediation.command === null || typeof check.remediation.command === 'string').toBe(true);
      }
      expect(check.product === null || core.PRODUCTS.includes(check.product)).toBe(true);
    }
  });

  it('createCheck 对非法枚举值构造失败（不是静默降级）', () => {
    const ok = () =>
      core.createCheck({
        id: 'x.y',
        category: 'repo-version',
        product: 'spectra',
        status: 'ok',
        summaryCode: 'repo-version-read',
        summaryParams: { product: 'spectra', semver: '1.2.3' },
        details: { versionField: 'products.spectra.version', semver: '1.2.3', rawShape: 'bare-semver' },
        remediationCode: null,
      });
    expect(ok).not.toThrow();

    expect(() => core.createCheck({ ...pick(ok()), status: 'bogus' } as never)).toThrow();
    expect(() =>
      core.createCheck({
        id: 'x.y',
        category: 'not-a-category',
        product: null,
        status: 'ok',
        summaryCode: 'repo-version-read',
        summaryParams: { product: 'spectra', semver: '1.2.3' },
        details: {},
        remediationCode: null,
      }),
    ).toThrow();
    expect(() =>
      core.createCheck({
        id: 'x.y',
        category: 'repo-version',
        product: null,
        status: 'ok',
        summaryCode: 'no-such-summary-code',
        summaryParams: {},
        details: {},
        remediationCode: null,
      }),
    ).toThrow();
    expect(() =>
      core.createCheck({
        id: 'x.y',
        category: 'repo-version',
        product: null,
        status: 'ok',
        summaryCode: 'repo-version-read',
        summaryParams: { product: 'spectra', semver: '1.2.3' },
        details: {},
        remediationCode: 'invent-a-code',
      }),
    ).toThrow();
  });

  it('sanitizeDetails 丢弃未登记的键与不合类型的值（不降级为原样输出）', () => {
    const cleaned = core.sanitizeDetails('global-cli', {
      binaryName: 'spectra',
      semver: '4.4.0',
      hadVPrefix: true,
      commitSuffixPresent: true,
      exitCode: 3,
      rawShape: 'decorated-semver',
      // 以下均须被丢弃
      notInSchema: 'whatever',
      // 🔴 C1：`versionLine` 已从 schema 中整体移除 —— 语法合法的版本行同样能承载
      // 一个 commit 形状的凭据，因此报告里不再有任何字段可以装下子进程原文。
      // 这里刻意仍然喂它，断言它作为「未登记键」被丢弃。
      versionLine: 'spectra v4.4.0 (0ae3eb7)',
    });
    expect(cleaned).toEqual({
      binaryName: 'spectra',
      semver: '4.4.0',
      hadVPrefix: true,
      commitSuffixPresent: true,
      exitCode: 3,
      rawShape: 'decorated-semver',
    });
    expect('notInSchema' in cleaned).toBe(false);
    expect('versionLine' in cleaned).toBe(false);

    const bad = core.sanitizeDetails('global-cli', {
      semver: 'not-a-semver',
      exitCode: 9999,
      rawShape: 'made-up-shape',
    });
    expect('semver' in bad).toBe(false);
    expect('exitCode' in bad).toBe(false);
    expect('rawShape' in bad).toBe(false);
    expect(bad.errorClass).toBe('parse-failed');
  });

  it('buildRemediation 只产出固定枚举 code 与模板文案', () => {
    for (const code of core.REMEDIATION_CODES) {
      const r = core.buildRemediation(code);
      expect(r.code).toBe(code);
      expect(typeof r.text).toBe('string');
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.command === null || typeof r.command === 'string').toBe(true);
    }
    expect(() => core.buildRemediation('nope')).toThrow();
    // FR-009 / SC-013：hook 信任步骤未经人工实测前，command 恒为 null
    expect(core.buildRemediation('grant-hook-trust').command).toBeNull();
  });
});

function pick(check: Record<string, unknown>) {
  return {
    id: check.id,
    category: check.category,
    product: check.product,
    status: check.status,
    summaryCode: 'repo-version-read',
    summaryParams: { product: 'spectra', semver: '1.2.3' },
    details: {},
    remediationCode: null,
  };
}

/**
 * Codex 对抗审查 W1 / W2 —— 「伪确定性」回归。
 *
 * 这一组的共同主题：**语法合法 / 集合残缺 / 根本没查** 三种情况此前都会被折叠成
 * 一个确定性结论（`ok` 或 `absent`）。每条用例都先复现审查里给出的攻击输入，
 * 再断言结论已歧义化。
 */
describe('F240 修复 W1 — 版本行整行语法校验（禁止「输出里恰好含一个 semver」冒充成功读取）', () => {
  /** 只跑 global-cli.spectra 一个 check，省去无关噪声 */
  function globalCliCheck(stdout: string, repoVersion = '4.4.0') {
    const fx = makeFixture({ spectraVersion: repoVersion });
    return io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({ spectra: { stdout } }),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['global-cli.spectra'];
  }

  it('垃圾 stdout 恰好含仓库同款 semver → indeterminate（此前误判 ok）', () => {
    const check = globalCliCheck('warning: expected 4.4.0 but no binary was executed\n');
    expect(check.status).toBe('indeterminate');
    expect(check.details.semver ?? null).toBeNull();
    expect(check.details.errorClass).toBe('version-parse-failed');
    expect(check.details.rawShape).toBe('unparseable');
  });

  it('程序名不是 spectra → indeterminate（版本行必须整行自证来源）', () => {
    expect(globalCliCheck('notspectra v4.4.0 (0ae3eb7)\n').status).toBe('indeterminate');
    // 裸 semver 缺少程序名，同样不足以自证 → 保守判不可判定
    expect(globalCliCheck('4.4.0\n').status).toBe('indeterminate');
  });

  it('ANSI 着色 / CRLF 的合法版本行仍能解析（剥壳发生在语法校验之前）', () => {
    const check = globalCliCheck('\u001B[32mspectra v4.4.0 (0ae3eb7)\u001B[0m\r\n');
    expect(check.status).toBe('ok');
    expect(check.details.semver).toBe('4.4.0');
  });

  it('parseVersionLine 只回传派生字段，commit 值本身不出现在返回值任何位置', () => {
    const parsed = core.parseVersionLine('spectra v4.4.0 (cafebabe)', { expectedProgram: 'spectra' });
    expect(parsed).toEqual({ ok: true, semver: '4.4.0', hadVPrefix: true, commitSuffixPresent: true });
    expect(JSON.stringify(parsed).includes('cafebabe')).toBe(false);
    // 程序名不匹配 / 语法外文本 → 一律判负
    expect(core.parseVersionLine('spectra v4.4.0', { expectedProgram: 'codex' }).ok).toBe(false);
    expect(core.parseVersionLine('spectra v4.4.0 extra', { expectedProgram: 'spectra' }).ok).toBe(false);
  });
});

describe('F240 修复 W2 — plugin fallback 不得从残缺快照集合猜出确定结论', () => {
  function seedSnapshot(codexHome: string, snapshot: string, version: string) {
    const dir = path.join(codexHome, 'plugins', 'cache', 'some-market', 'spectra', snapshot, '.codex-plugin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'spectra', version }));
  }

  function runWithSnapshots(seed: (codexHome: string) => void) {
    const fx = makeFixture({
      spectraVersion: '4.4.0',
      configToml: '[plugins."spectra@some-market"]\nenabled = true\n',
    });
    seed(fx.codexHome);
    return io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['plugin-build.spectra'];
  }

  it('快照 B 的 manifest 不可读 → 结论歧义化为 snapshot-unreadable，绝不用剩下的 A 下结论', () => {
    const check = runWithSnapshots((codexHome) => {
      seedSnapshot(codexHome, 'aaaa1111', '4.4.0');
      // 快照 B 是个合法快照目录，但 manifest 缺失 → 我们不知道 B 是什么版本
      fs.mkdirSync(path.join(codexHome, 'plugins', 'cache', 'some-market', 'spectra', 'bbbb2222'), {
        recursive: true,
      });
    });
    const probe = check.details.probedSources.find((p: { id: string }) => p.id === 'codex-plugin-manifest');
    expect(probe.outcome).toBe('error');
    expect(probe.errorClass).toBe('snapshot-unreadable');
    expect(check.status).toBe('indeterminate');
    // 🔴 关键：既不得声称版本，更不得把 A 的路径标成 active
    expect(check.details.semver ?? null).toBeNull();
    expect(check.details.activeInstallPath ?? null).toBeNull();
  });

  it('manifest JSON 畸形同样歧义化（此前直接 return parse-failed 也算歧义，但版本必须不出现）', () => {
    const check = runWithSnapshots((codexHome) => {
      const dir = path.join(codexHome, 'plugins', 'cache', 'some-market', 'spectra', 'cccc3333', '.codex-plugin');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'plugin.json'), '{');
    });
    expect(check.status).toBe('indeterminate');
    expect(check.details.semver ?? null).toBeNull();
  });

  it('同版本多快照 → 版本可比较，但 activeInstallPath 必须缺席 + 记 multiple-snapshots', () => {
    const check = runWithSnapshots((codexHome) => {
      seedSnapshot(codexHome, 'aaaa1111', '4.4.0');
      seedSnapshot(codexHome, 'bbbb2222', '4.4.0');
    });
    const probe = check.details.probedSources.find((p: { id: string }) => p.id === 'codex-plugin-manifest');
    expect(probe.outcome).toBe('found');
    expect(probe.errorClass).toBe('multiple-snapshots');
    expect(check.status).toBe('ok');
    expect(check.details.semver).toBe('4.4.0');
    // 目录顺序不是事实依据 —— 不许指认任何一个为 active
    expect(check.details.activeInstallPath ?? null).toBeNull();
  });

  it('唯一且完整的候选才允许输出 activeInstallPath', () => {
    const check = runWithSnapshots((codexHome) => seedSnapshot(codexHome, 'aaaa1111', '4.4.0'));
    expect(check.details.activeInstallPath).toBe('plugins/cache/some-market/spectra/aaaa1111');
  });

  it('plugins/ 不存在时仍独立探测 .codex-global-state.json（此前直接短路成 absent）', () => {
    const fx = makeFixture({ spectraVersion: '4.4.0' });
    expect(fs.existsSync(path.join(fx.codexHome, 'plugins'))).toBe(false);
    fs.writeFileSync(
      path.join(fx.codexHome, '.codex-global-state.json'),
      JSON.stringify({ activePluginVersions: { spectra: '4.4.0' } }),
    );
    const check = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['plugin-build.spectra'];
    expect(check.details.probedSources.find((p: { id: string }) => p.id === 'codex-home-paths').outcome).toBe(
      'found',
    );
    expect(check.status).toBe('ok');
  });

  it('app-server 探针只跑了 --help ⇒ 记 not-probed，而不是确定性的 absent', () => {
    const fx = makeFixture({});
    const check = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: (file: string, args: string[]) => {
        if (file === 'codex' && args[0] === 'debug') return 'Usage: codex debug app-server [OPTIONS]\n';
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['plugin-build.spectra'];
    const probe = check.details.probedSources.find((p: { id: string }) => p.id === 'app-server-rpc');
    expect(probe.outcome).toBe('not-probed');
    expect(core.PROBE_OUTCOMES).toContain('not-probed');
  });
});

describe('F240 修复 W3 — 非法 hooks.json 是配置问题，不是「未授信」', () => {
  function hookCheck(hooksJson: string) {
    const fx = makeFixture({ hooksJson, configToml: '[mcp_servers.x]\nurl = "https://example.invalid"\n' });
    return io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['hook-trust'];
  }

  it('内容为 `{` → indeterminate + parse-failed，且**不给** grant-hook-trust', () => {
    const check = hookCheck('{');
    expect(check.status).toBe('indeterminate');
    expect(check.details.trustStatus).toBe('indeterminate');
    expect(check.remediation.code).toBe('manual-investigate');
    const probe = check.details.attemptedProbes.find((p: { id: string }) => p.id === 'codex-home-hooks-json');
    expect(probe.outcome).toBe('error');
    expect(probe.errorClass).toBe('parse-failed');
  });

  it('顶层不是对象（数组 / 标量）同样落 indeterminate', () => {
    for (const content of ['[]', '"just-a-string"', '42']) {
      const check = hookCheck(content);
      expect(check.status, `hooks.json=${content}`).toBe('indeterminate');
      expect(check.remediation.code).toBe('manual-investigate');
    }
  });

  it('合法 JSON 对象仍走原判定链（untrusted）——修复没有把正常路径一起改坏', () => {
    const check = hookCheck('{"Stop":[]}');
    expect(check.status).toBe('warning');
    expect(check.details.trustStatus).toBe('untrusted');
    expect(check.remediation.code).toBe('grant-hook-trust');
  });
});

describe('F240 T048 — hook-trust 四情形固定状态值（FR-009）', () => {
  it('hooks.json 不存在 → not-applicable（与 A3 解耦）', () => {
    const fx = makeFixture({ hooksJson: null });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['hook-trust'];
    expect(check.status).toBe('not-applicable');
    expect(check.details.trustStatus).toBe('not-applicable');
  });

  it('hooks.json 存在 + config.toml 无 hooks.state 段 → untrusted / warning + grant-hook-trust', () => {
    const fx = makeFixture({
      hooksJson: '{"Stop":[]}',
      configToml: '[mcp_servers.x]\nurl = "https://example.invalid"\n',
    });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['hook-trust'];
    expect(check.status).toBe('warning');
    expect(check.details.trustStatus).toBe('untrusted');
    expect(check.remediation.code).toBe('grant-hook-trust');
    expect(check.remediation.command).toBeNull();
  });

  it('hooks.json 存在 + hooks.state 段存在（形态未经实测确证）→ indeterminate，绝不假设已信任', () => {
    const fx = makeFixture({
      hooksJson: '{"Stop":[]}',
      configToml: '[hooks.state]\ntrusted_hash = "deadbeef"\n',
    });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['hook-trust'];
    expect(check.status).toBe('indeterminate');
    expect(check.details.trustStatus).toBe('indeterminate');
    expect(check.details.attemptedProbes.length).toBeGreaterThan(0);
    for (const probe of check.details.attemptedProbes) {
      expect(core.HOOK_TRUST_PROBES).toContain(probe.id);
      expect(core.PROBE_OUTCOMES).toContain(probe.outcome);
    }
  });

  it('classifyHookTrust 纯函数覆盖 trusted / modified 两态（T062 确证后接线）', () => {
    const trusted = core.classifyHookTrust({
      hooksJsonPresent: true,
      configProbe: { outcome: 'found', errorClass: null },
      stateSection: { kind: 'confirmed', trustedHash: 'a'.repeat(64) },
      currentHash: 'a'.repeat(64),
    });
    expect(trusted.status).toBe('ok');
    expect(trusted.trustStatus).toBe('trusted');

    const modified = core.classifyHookTrust({
      hooksJsonPresent: true,
      configProbe: { outcome: 'found', errorClass: null },
      stateSection: { kind: 'confirmed', trustedHash: 'a'.repeat(64) },
      currentHash: 'b'.repeat(64),
    });
    expect(modified.status).toBe('warning');
    expect(modified.trustStatus).toBe('modified');
    expect(modified.remediationCode).toBe('grant-hook-trust');
  });

  it('config.toml 读取失败 → indeterminate（MUST NOT 静默假设已信任）', () => {
    const verdict = core.classifyHookTrust({
      hooksJsonPresent: true,
      configProbe: { outcome: 'error', errorClass: 'EACCES' },
      stateSection: { kind: 'unavailable' },
      currentHash: null,
    });
    expect(verdict.status).toBe('indeterminate');
    expect(verdict.trustStatus).toBe('indeterminate');
  });
});

describe('F240 T048 — `--dangerously-bypass-hook-trust` 产品目录零命中门禁（五处）', () => {
  const flag = ['--dangerously', 'bypass', 'hook', 'trust'].join('-');
  const scanTargets = ['src', 'plugins', 'scripts', 'README.md', 'docs'];

  for (const target of scanTargets) {
    it(`${target} 中零命中`, () => {
      const abs = path.join(repoRoot, target);
      if (!fs.existsSync(abs)) return;
      let out = '';
      try {
        out = execFileSync('grep', ['-rn', '--', flag, abs], { encoding: 'utf-8' });
      } catch (err) {
        // grep 无命中时退出码 1
        const status = (err as { status?: number }).status;
        expect(status, `grep 在 ${target} 上异常退出`).toBe(1);
        return;
      }
      expect(out.trim(), `${target} 不应出现 ${flag}`).toBe('');
    });
  }
});
