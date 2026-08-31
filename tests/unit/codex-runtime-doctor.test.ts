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
 * - hook-trust 探针 id 与其 outcome 语义一致（`config-toml-readable` 管文件、`config-toml-hooks-state` 管段）
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
  /**
   * F275 对抗审查后新增：是否在 `$CODEX_HOME` 下造一个空的 `plugins` 目录，模拟"这台机器上
   * 确实装过某个 Codex 插件"（前置门 `shouldSkipNativeProbe` 只看这个目录在不在，不深入到
   * 具体插件）。默认 `false`（沿用旧 fixture 的"全新家目录"形态）——需要驱动
   * `app-server-hooks-list` 真正被调用的用例（原生环境相关测试）须显式传 `true`，
   * 否则前置门会在 `hooksJson` 也不存在时跳过 RPC，注入的假 `exec` 永远不会被调用。
   */
  pluginsDir?: boolean;
  /**
   * F275 对抗审查后新增：是否在 `$CODEX_HOME/plugins/cache/<marketplace>/spec-driver` 下
   * 造一个真实存在的目录，模拟"本插件确实通过 Codex 插件管理器安装过"（tie-break 用的
   * cache 证据）。传 `true` 时隐含创建 `plugins` 目录（无需再单独传 `pluginsDir: true`）。
   */
  pluginSpecDriverCache?: boolean;
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
  if (options.pluginSpecDriverCache) {
    fs.mkdirSync(path.join(codexHome, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver'), {
      recursive: true,
    });
  } else if (options.pluginsDir) {
    fs.mkdirSync(path.join(codexHome, 'plugins'), { recursive: true });
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

  // ─── F267 / D7：`.find` 取「首个匹配」而非「首个可用」──────────────────────
  //
  // 两条探针的搜索谓词都只表达了"是不是我要找的那一条"，可用性判定被放在 `.find` **之后**。
  // 判定被拆成两半、中间隔了一个会提前终止的搜索：第一个形式匹配但语义不可用的候选，会把
  // 后面真正可用的那条**屏蔽**掉，探针误报 `absent`。两条用例的断言目标刻意对称。

  it('D7-a 畸形段（无 marketplace）排在合法段之前时，plugin-manifest 探针仍返回 found', () => {
    const fx = makeFixture({
      spectraVersion: '4.4.0',
      // 无 `@market` 的同名段是真实可发生的形态（手工编辑 config.toml / 旧版写法残留）
      configToml:
        '[plugins."spectra"]\nenabled = true\n\n[plugins."spectra@some-market"]\nenabled = true\n',
    });
    seedSnapshot(fx.codexHome, 'some-market', 'spectra', 'abc123hash', '4.4.0');

    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });

    const check = report.checks['plugin-build.spectra'];
    const probe = check.details.probedSources.find((p: any) => p.id === 'codex-plugin-manifest');
    expect(probe.outcome).toBe('found');
    expect(check.details.activeInstallPath).toBe('plugins/cache/some-market/spectra/abc123hash');
  });

  it('D7-b 版本不可解析的条目排在合法条目之前时，cli-inventory 探针仍返回 found', () => {
    const fx = makeFixture({ spectraVersion: '4.4.0' });

    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: (file: string, args: string[]) => {
        if (file === 'codex' && args[0] === 'plugin') {
          return JSON.stringify({
            installed: [
              // 同名 + enabled，但版本串解析不出 semver → 形式匹配、语义不可用
              { name: 'spectra', enabled: true, version: 'nightly' },
              { name: 'spectra', enabled: true, version: '4.4.0' },
            ],
          });
        }
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });

    const check = report.checks['plugin-build.spectra'];
    const probe = check.details.probedSources.find((p: any) => p.id === 'codex-cli-help');
    expect(probe.outcome).toBe('found');
    expect(check.details.semver).toBe('4.4.0');
    expect(check.status).toBe('ok');
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

describe('F262 / W2 — config.toml 词法扫描形态清单', () => {
  /** 造一个 Codex 快照缓存（与上一组同形；本组自持一份，避免跨 describe 取用私有 helper）*/
  function seedSnapshot(
    codexHome: string,
    market: string,
    plugin: string,
    snapshot: string,
    version: string,
  ) {
    const dir = path.join(codexHome, 'plugins', 'cache', market, plugin, snapshot, '.codex-plugin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: plugin, version }));
  }

  /**
   * 跑一次 doctor：仓库两产品版本均为 4.4.0，磁盘上预置若干快照。
   *
   * 判别信号刻意选"最终 status"而非"probe 是否 absent"：预置一个**明显与仓库版本不符**的
   * 旧/假快照后，段头解析一旦被污染（键泄漏给前一段、幻影段被注册），该产品就会被判 `fail`
   * （版本漂移 + reinstall 指引）；解析正确时它只能落 `indeterminate`。
   * 这样"误报"与"正确"落在两个不同的枚举值上，不会靠弱信号蒙混过关。
   */
  function runWithConfig(
    configToml: string,
    snapshots: Array<{ market: string; plugin: string; snapshot: string; version: string }> = [],
  ) {
    const fx = makeFixture({ spectraVersion: '4.4.0', specDriverVersion: '4.4.0', configToml });
    for (const s of snapshots) seedSnapshot(fx.codexHome, s.market, s.plugin, s.snapshot, s.version);
    return io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
  }

  it('行尾注释（主形态）：段头被注释吞掉 → 前一产品被诬告漂移、后一产品判不出', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        '',
        '[plugins."spectra@m"] # 用户自己加的备注',
        'enabled = true',
        '',
      ].join('\n'),
      [
        { market: 'm', plugin: 'spec-driver', snapshot: 'aaaa1111', version: '3.0.0' },
        { market: 'm', plugin: 'spectra', snapshot: 'bbbb2222', version: '4.4.0' },
      ],
    );

    // spectra 段头必须被认出来 → 读到 4.4.0 快照 → ok
    expect(report.checks['plugin-build.spectra'].status).toBe('ok');
    expect(report.checks['plugin-build.spectra'].details.semver).toBe('4.4.0');
    // spec-driver 明确 enabled=false，不得被后面泄漏的 `enabled = true` 点燃成"漂移"
    expect(report.checks['plugin-build.spec-driver'].status).toBe('indeterminate');
  });

  it('段头含 `\\"` 转义：注释剥离不得在转义引号处误判引号状态', () => {
    // 🔴 仓内 `simple-yaml.mjs` 的注释剥离恰好是"有引号互斥、无转义感知"，照抄即在此形态失败：
    // `\"` 被当成闭合引号后，后面的 `#` 会被认成串内字符 → 注释不剥 → 段头不匹配 → 键泄漏。
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        '',
        '[mcp_servers."a\\"b"] # 备注',
        'enabled = true',
        '',
      ].join('\n'),
      [{ market: 'm', plugin: 'spec-driver', snapshot: 'aaaa1111', version: '3.0.0' }],
    );

    expect(report.checks['plugin-build.spec-driver'].status).toBe('indeterminate');
  });

  it('`[[array-of-tables]]` 必须重置段边界，不得让键泄漏回前一 plugin 段', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        '',
        '[[profiles.batch]]',
        'enabled = true',
        '',
      ].join('\n'),
      [{ market: 'm', plugin: 'spec-driver', snapshot: 'aaaa1111', version: '3.0.0' }],
    );

    expect(report.checks['plugin-build.spec-driver'].status).toBe('indeterminate');
  });

  it('FORM-D 多行字符串值泄漏：`"""…"""` 内的 `enabled = true` 不得生效', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        'description = """',
        'enabled = true',
        '"""',
        '',
      ].join('\n'),
      [{ market: 'm', plugin: 'spec-driver', snapshot: 'aaaa1111', version: '3.0.0' }],
    );

    expect(report.checks['plugin-build.spec-driver'].status).toBe('indeterminate');
  });

  it('FORM-E 多行字符串幻影段：串内的 `[plugins."x@y"]` 不得被注册为真实条目', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        'notes = """',
        '[plugins."spectra@evil-market"]',
        'enabled = true',
        '"""',
        '',
      ].join('\n'),
      [{ market: 'evil-market', plugin: 'spectra', snapshot: 'cccc3333', version: '9.9.9' }],
    );

    // 幻影段被注册 ⇒ 会去读 evil-market 下的 9.9.9 假快照并判 fail（漂移误报）
    expect(report.checks['plugin-build.spectra'].status).toBe('indeterminate');
    expect(report.checks['plugin-build.spectra'].details.semver ?? null).toBeNull();
  });

  it('单引号里的 `#` 不算注释，正常段头照常识别（剥注释不得剥过头）', () => {
    const report = runWithConfig(
      [
        "[mcp_servers.x]",
        "token = 'a#b'",
        '',
        '[plugins."spectra@m"]',
        'enabled = true',
        '',
      ].join('\n'),
      [{ market: 'm', plugin: 'spectra', snapshot: 'bbbb2222', version: '4.4.0' }],
    );

    expect(report.checks['plugin-build.spectra'].status).toBe('ok');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F262 修复轮 —— 幻影多行串（三连引号标记出现在「不该被当作定界符」的位置）
  //
  // 共用判别信号：spec-driver 明写 `enabled = false` 且只有一个 3.0.0 旧快照，
  // spectra 明写 `enabled = true` 且有一个与仓库同版的 4.4.0 快照。于是
  // - 解析正确 ⇒ spec-driver `indeterminate`（没被点燃）+ spectra `ok`（4.4.0 匹配）；
  // - 幻影串吞掉 spectra 段头 ⇒ `enabled = true` 泄漏回 spec-driver ⇒ spec-driver `fail`
  //   （3.0.0 漂移误报）+ spectra `indeterminate`。
  // 两种结局落在不同枚举值上，误报无法蒙混过关。
  // ───────────────────────────────────────────────────────────────────────────
  const PHANTOM_SNAPSHOTS = [
    { market: 'm', plugin: 'spec-driver', snapshot: 'aaaa1111', version: '3.0.0' },
    { market: 'm', plugin: 'spectra', snapshot: 'bbbb2222', version: '4.4.0' },
  ];

  function expectNoPhantomSwallow(report: any) {
    expect(report.checks['plugin-build.spec-driver'].status).toBe('indeterminate');
    expect(report.checks['plugin-build.spectra'].status).toBe('ok');
    expect(report.checks['plugin-build.spectra'].details.semver).toBe('4.4.0');
  }

  it('🔴 单行 literal string 里的 `"""` 不是多行串定界符（主向量：偶数个杂散标记会吞掉整段）', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        'note = \'multiline 写法是 """\'',
        '',
        '[plugins."spectra@m"]',
        'note = \'收尾例子 """\'',
        'enabled = true',
        '',
      ].join('\n'),
      PHANTOM_SNAPSHOTS,
    );

    expectNoPhantomSwallow(report);
  });

  it('🔴 单行 basic string 里的 `\'\'\'` 不是多行串定界符', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        'note = "literal 写法是 \'\'\'"',
        '',
        '[plugins."spectra@m"]',
        'note = "收尾例子 \'\'\'"',
        'enabled = true',
        '',
      ].join('\n'),
      PHANTOM_SNAPSHOTS,
    );

    expectNoPhantomSwallow(report);
  });

  it('🔴 注释里的 `"""` 不是多行串定界符（偶数个 ⇒ 幻影串中途闭合、被吞区间含段头）', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        '# 备注：多行写法是 """',
        '',
        '[plugins."spectra@m"]',
        '# 又一条备注 """',
        'enabled = true',
        '',
      ].join('\n'),
      PHANTOM_SNAPSHOTS,
    );

    expectNoPhantomSwallow(report);
  });

  it('行内成对 `"""a"""` 闭合后不得留下跨行状态', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        'desc = """inline"""',
        '',
        '[plugins."spectra@m"]',
        'enabled = true',
        '',
      ].join('\n'),
      PHANTOM_SNAPSHOTS,
    );

    expectNoPhantomSwallow(report);
  });

  it('`""""` 四引号 / 开标记行带行尾注释 / 闭合行尾接内容：三种边界形态都不得错判', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        // `""""` = 开多行 basic 串 + 串内第一个字符是 `"`；行尾的 `#` 落在串内，不是注释
        'quad = """" # 这个井号在串内',
        // 串内的键值行必须不生效（否则 spec-driver 被点燃成 3.0.0 漂移）
        'enabled = true',
        // 闭合三连引号之后的行尾内容要继续正常扫描，不得整行丢弃
        '""" 收尾后还有内容',
        '',
        '[plugins."spectra@m"]',
        'enabled = true',
        '',
      ].join('\n'),
      PHANTOM_SNAPSHOTS,
    );

    expectNoPhantomSwallow(report);
  });

  it('🔴 段头含 `]`（无法解析）必须视为段边界：既不建条目，也不得让键泄漏给前一段', () => {
    const report = runWithConfig(
      [
        '[plugins."spec-driver@m"]',
        'enabled = false',
        '',
        // 段名内侧含 `]` ⇒ `^\[([^\]]+)\]$` 结构性失配。此时 MUST 重置段边界（保守 absent），
        // 而不是"不认识就跳过"——跳过会让下面的 `enabled = true` 归属回 spec-driver 段。
        '[plugins."spectra@m]evil"]',
        'enabled = true',
        '',
      ].join('\n'),
      [
        { market: 'm', plugin: 'spec-driver', snapshot: 'aaaa1111', version: '3.0.0' },
        { market: 'm]evil', plugin: 'spectra', snapshot: 'cccc3333', version: '9.9.9' },
      ],
    );

    // 前一段不被泄漏点燃
    expect(report.checks['plugin-build.spec-driver'].status).toBe('indeterminate');
    // 该段自身不建条目 ⇒ 不会去读 `m]evil` 下的 9.9.9 假快照
    expect(report.checks['plugin-build.spectra'].status).toBe('indeterminate');
    expect(report.checks['plugin-build.spectra'].details.semver ?? null).toBeNull();
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
    // F265：`knownGap` 已随 `server_build_info` 的落地被移除 —— 那个缺口不再成立。
    // 本 fixture 的 exec 对一切命令抛 ENOENT，故自省通道打不通 ⇒ indeterminate + ENOENT，
    // 语义从"产品没有这个能力"变成"这次没问到"。
    expect('knownGap' in report.checks['mcp-server.spectra'].details).toBe(false);
    expect(report.checks['mcp-server.spectra'].details.probeMethod).toBe('stdio-server-build-info');
    expect(report.checks['mcp-server.spectra'].details.errorClass).toBe('ENOENT');
    // F265 对抗审查 C-2：报告自述探测对象 —— PATH 上的二进制，不是客户端连着的进程
    expect(report.checks['mcp-server.spectra'].details.probeTarget).toBe('path-binary');
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

  it('🔴 F262 / W2：裸 `[hooks]`（Codex 产品特性段）不是信任记录段 → 照常判 untrusted', () => {
    // `[hooks]` 是 Codex 自己的功能开关段，不是 `hooks.state` 那种信任记录；
    // 旧判据 `^hooks(\.|$)` 会把它当成"信任记录已存在"，于是把**可执行的** grant-hook-trust
    // 指引降级成 manual-investigate —— 用户被告知"去人工排查"，而实际动作是去 Codex 里授权。
    const fx = makeFixture({
      hooksJson: '{"Stop":[]}',
      configToml: '[hooks]\nsome_feature = true\n',
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

describe('F275 T005 — classifyHookTrust 的 nativeProbe 三段优先级（纯函数，不经 io.runDoctor）', () => {
  /** 合并器 fallback 侧的固定 fixture：与旧「段缺失 → untrusted」用例同构（回归锚对照组） */
  const fallbackUntrustedInput = {
    hooksJsonPresent: true,
    configProbe: { outcome: 'found', errorClass: null },
    stateSection: { kind: 'absent' },
    currentHash: null,
  };
  /** 合并器 fallback 侧另一固定 fixture：会给出 trusted 结论，用于验证优先级真正生效（不是侥幸凑对） */
  const fallbackTrustedInput = {
    hooksJsonPresent: true,
    configProbe: { outcome: 'found', errorClass: null },
    stateSection: { kind: 'confirmed', trustedHash: 'a'.repeat(64) },
    currentHash: 'a'.repeat(64),
  };

  it('nativeProbe=null → 走原四分支（回归锚，与现有行为逐字一致），第 4 条留痕 outcome=not-probed', () => {
    const verdict = core.classifyHookTrust(fallbackUntrustedInput);
    expect(verdict.status).toBe('warning');
    expect(verdict.trustStatus).toBe('untrusted');
    expect(verdict.summaryCode).toBe('hook-trust-untrusted');
    expect(verdict.remediationCode).toBe('grant-hook-trust');
    const native = verdict.probes.find((p) => p.id === 'app-server-hooks-list');
    expect(native).toEqual({ id: 'app-server-hooks-list', outcome: 'not-probed', errorClass: null });
  });

  it("outcome='found', entries 含 untrusted → untrusted/warning/grant-hook-trust（覆盖合并器侧本会给出的 trusted 结论）", () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['trusted', 'untrusted', 'trusted'] },
    });
    expect(verdict.status).toBe('warning');
    expect(verdict.trustStatus).toBe('untrusted');
    expect(verdict.summaryCode).toBe('hook-trust-native-untrusted');
    expect(verdict.remediationCode).toBe('grant-hook-trust');
  });

  it("outcome='found', entries 含 modified（无 untrusted）→ modified/warning", () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['trusted', 'modified'] },
    });
    expect(verdict.status).toBe('warning');
    expect(verdict.trustStatus).toBe('modified');
    expect(verdict.summaryCode).toBe('hook-trust-native-modified');
    expect(verdict.remediationCode).toBe('grant-hook-trust');
  });

  it("outcome='found', entries 含 managed（无 untrusted/modified）→ indeterminate/hook-trust-native-managed", () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['trusted', 'managed'] },
    });
    expect(verdict.status).toBe('indeterminate');
    expect(verdict.trustStatus).toBe('indeterminate');
    expect(verdict.summaryCode).toBe('hook-trust-native-managed');
    expect(verdict.remediationCode).toBe('manual-investigate');
  });

  it("outcome='found', entries 全 trusted → trusted/ok/remediation=null", () => {
    const verdict = core.classifyHookTrust({
      ...fallbackUntrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['trusted', 'trusted'] },
    });
    expect(verdict.status).toBe('ok');
    expect(verdict.trustStatus).toBe('trusted');
    expect(verdict.summaryCode).toBe('hook-trust-native-trusted');
    expect(verdict.remediationCode).toBeNull();
  });

  it('协议漂移防御：entries 含闭集外的第 5 个值 → 整体 error/parse-failed，不猜测聚合', () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['trusted', 'some-unknown-fifth-value'] },
    });
    expect(verdict.status).toBe('indeterminate');
    expect(verdict.trustStatus).toBe('indeterminate');
    expect(verdict.summaryCode).toBe('hook-trust-native-probe-failed');
    expect(verdict.summaryParams).toEqual({ errorClass: 'parse-failed' });
    expect(verdict.remediationCode).toBe('manual-investigate');
  });

  it("outcome='absent'（RPC 成功但我方条目为 0）→ 回退合并器 fallback，逐字不变", () => {
    const verdict = core.classifyHookTrust({
      ...fallbackUntrustedInput,
      nativeProbe: { outcome: 'absent', errorClass: null, entries: [] },
    });
    expect(verdict.status).toBe('warning');
    expect(verdict.trustStatus).toBe('untrusted');
    expect(verdict.summaryCode).toBe('hook-trust-untrusted');
  });

  it("outcome='not-executable'（codex 二进制缺失，ENOENT）+ hooksJsonPresent=true → 回退合并器 fallback，逐字不变", () => {
    const verdict = core.classifyHookTrust({
      ...fallbackUntrustedInput,
      nativeProbe: { outcome: 'not-executable', errorClass: 'ENOENT', entries: [] },
    });
    expect(verdict.status).toBe('warning');
    expect(verdict.trustStatus).toBe('untrusted');
    expect(verdict.summaryCode).toBe('hook-trust-untrusted');
  });
});

describe('F275 对抗审查后修订 — classifyHookTrust 终版判定矩阵六行逐行用例', () => {
  const fallbackUntrustedInput = {
    hooksJsonPresent: true,
    configProbe: { outcome: 'found', errorClass: null },
    stateSection: { kind: 'absent' },
    currentHash: null,
  };
  const fallbackTrustedInput = {
    hooksJsonPresent: true,
    configProbe: { outcome: 'found', errorClass: null },
    stateSection: { kind: 'confirmed', trustedHash: 'a'.repeat(64) },
    currentHash: 'a'.repeat(64),
  };
  /** 无合并器痕迹的输入（`hooksJsonPresent: false`），用于驱动矩阵行 5/6 */
  const noMergerInput = {
    hooksJsonPresent: false,
    configProbe: { outcome: 'absent', errorClass: null },
    stateSection: { kind: 'absent' },
    currentHash: null,
  };

  it('行 4a：outcome=error + hooksJsonPresent=true → 回退合并器判据，采用合并器侧本会给出的 trusted 结论（消误报 C-2）', () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'error', errorClass: 'rpc-error', entries: [] },
    });
    expect(verdict.status).toBe('ok');
    expect(verdict.trustStatus).toBe('trusted');
    expect(verdict.summaryCode).toBe('hook-trust-trusted');
    expect(verdict.remediationCode).toBeNull();
    // RPC 失败仅留痕，不影响最终判定（探测事实仍可查）
    const native = verdict.probes.find((p) => p.id === 'app-server-hooks-list');
    expect(native).toEqual({ id: 'app-server-hooks-list', outcome: 'error', errorClass: 'rpc-error' });
  });

  it('行 4b：outcome=not-executable + hooksJsonPresent=true → 回退合并器判据（untrusted 分支）', () => {
    const verdict = core.classifyHookTrust({
      ...fallbackUntrustedInput,
      nativeProbe: { outcome: 'not-executable', errorClass: 'ENOENT', entries: [] },
    });
    expect(verdict.status).toBe('warning');
    expect(verdict.trustStatus).toBe('untrusted');
    expect(verdict.summaryCode).toBe('hook-trust-untrusted');
  });

  it('行 5a：outcome=error + hooksJsonPresent=false + pluginCacheEvidence=true → indeterminate/hook-trust-native-unreachable（消假阴 C4）', () => {
    const verdict = core.classifyHookTrust({
      ...noMergerInput,
      nativeProbe: { outcome: 'error', errorClass: 'rpc-error', entries: [] },
      pluginCacheEvidence: true,
    });
    expect(verdict.status).toBe('indeterminate');
    expect(verdict.trustStatus).toBe('indeterminate');
    expect(verdict.summaryCode).toBe('hook-trust-native-unreachable');
    expect(verdict.summaryParams).toEqual({ errorClass: 'rpc-error' });
    expect(verdict.remediationCode).toBe('manual-investigate');
    const cacheProbe = verdict.probes.find((p) => p.id === 'codex-home-plugin-cache');
    expect(cacheProbe).toEqual({ id: 'codex-home-plugin-cache', outcome: 'found', errorClass: null });
  });

  it('行 5b：outcome=not-executable + hooksJsonPresent=false + pluginCacheEvidence=true → indeterminate（与 error 同一处置方向）', () => {
    const verdict = core.classifyHookTrust({
      ...noMergerInput,
      nativeProbe: { outcome: 'not-executable', errorClass: 'ENOENT', entries: [] },
      pluginCacheEvidence: true,
    });
    expect(verdict.status).toBe('indeterminate');
    expect(verdict.trustStatus).toBe('indeterminate');
    expect(verdict.summaryCode).toBe('hook-trust-native-unreachable');
    expect(verdict.summaryParams).toEqual({ errorClass: 'ENOENT' });
  });

  it('行 6a：outcome=error + hooksJsonPresent=false + pluginCacheEvidence=false → not-applicable（消误报 C-1 噪声）', () => {
    const verdict = core.classifyHookTrust({
      ...noMergerInput,
      nativeProbe: { outcome: 'error', errorClass: 'rpc-error', entries: [] },
    });
    expect(verdict.status).toBe('not-applicable');
    expect(verdict.trustStatus).toBe('not-applicable');
    expect(verdict.summaryCode).toBe('hook-trust-not-applicable-no-evidence');
    expect(verdict.remediationCode).toBeNull();
    const cacheProbe = verdict.probes.find((p) => p.id === 'codex-home-plugin-cache');
    expect(cacheProbe).toEqual({ id: 'codex-home-plugin-cache', outcome: 'absent', errorClass: null });
  });

  it('行 6b：outcome=not-executable + hooksJsonPresent=false + pluginCacheEvidence=false → not-applicable', () => {
    const verdict = core.classifyHookTrust({
      ...noMergerInput,
      nativeProbe: { outcome: 'not-executable', errorClass: 'EACCES', entries: [] },
    });
    expect(verdict.status).toBe('not-applicable');
    expect(verdict.trustStatus).toBe('not-applicable');
    expect(verdict.summaryCode).toBe('hook-trust-not-applicable-no-evidence');
  });

  it('行 3：outcome=not-probed（前置门跳过）+ hooksJsonPresent=false → not-applicable/hook-trust-not-probed（诚实标注"没探"）', () => {
    const verdict = core.classifyHookTrust({
      ...noMergerInput,
      nativeProbe: { outcome: 'not-probed', errorClass: null, entries: [] },
    });
    expect(verdict.status).toBe('not-applicable');
    expect(verdict.trustStatus).toBe('not-applicable');
    expect(verdict.summaryCode).toBe('hook-trust-not-probed');
  });

  it('行 2：outcome=absent（RPC 成功、确证我方条目为 0）→ 回退合并器判据，与 hooksJsonPresent 无关', () => {
    const verdict = core.classifyHookTrust({
      ...noMergerInput,
      nativeProbe: { outcome: 'absent', errorClass: null, entries: [] },
    });
    expect(verdict.status).toBe('not-applicable');
    expect(verdict.trustStatus).toBe('not-applicable');
    // absent 属于既有 `hook-trust-not-applicable`（未标注"没探"），与 not-probed 措辞不同
    expect(verdict.summaryCode).toBe('hook-trust-not-applicable');
  });

  it('聚合优先级区分性用例：[modified, untrusted] → untrusted（不是侥幸命中，真按优先级取严）', () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['modified', 'untrusted'] },
    });
    expect(verdict.trustStatus).toBe('untrusted');
    expect(verdict.summaryCode).toBe('hook-trust-native-untrusted');
  });

  it('聚合优先级区分性用例：[trusted, modified] → modified', () => {
    const verdict = core.classifyHookTrust({
      ...fallbackUntrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['trusted', 'modified'] },
    });
    expect(verdict.trustStatus).toBe('modified');
    expect(verdict.summaryCode).toBe('hook-trust-native-modified');
  });

  it('聚合优先级区分性用例：[managed, untrusted] → untrusted（untrusted 优先级高于 managed）', () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['managed', 'untrusted'] },
    });
    expect(verdict.trustStatus).toBe('untrusted');
    expect(verdict.summaryCode).toBe('hook-trust-native-untrusted');
  });

  it('双注册聚合：[trusted, trusted, untrusted] → untrusted（任一来源 untrusted 即取严）', () => {
    const verdict = core.classifyHookTrust({
      ...fallbackTrustedInput,
      nativeProbe: { outcome: 'found', errorClass: null, entries: ['trusted', 'trusted', 'untrusted'] },
    });
    expect(verdict.trustStatus).toBe('untrusted');
  });
});

describe('F275 T015 — io.mjs 三形态 + 边界集成用例（伪造 helper 输出驱动 hook-trust 类目）', () => {
  /** 伪造 helper（`process.execPath`）打印给定的 nativeProbe JSON 后驱动一次 runDoctor */
  function runHookTrust(
    fixtureOptions: Parameters<typeof makeFixture>[0],
    exec: ReturnType<typeof makeExec>,
  ) {
    const fx = makeFixture(fixtureOptions);
    return io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['hook-trust'] as {
      status: string;
      summary: string;
      remediation: { code: string | null } | null;
      details: { trustStatus: string };
    };
  }
  function makeExecWithNativeProbe(payload: unknown) {
    return makeExec({ [process.execPath]: { stdout: JSON.stringify(payload) } });
  }

  it('无插件环境：helper 探测「我方条目为 0」→ 回退合并器，逐字复用现有 T048 对照锚', () => {
    // 🔴 F275 对抗审查后修订：前置门只看 `$CODEX_HOME/plugins` 目录 + hooksJson 是否存在，
    // 二者皆无时会直接跳过 RPC（不调用注入的 exec）。本用例的意图是验证"RPC 真的探测过、
    // 确证我方条目为 0"这条路径，因此需要 `pluginsDir: true` 让前置门不拦截。
    const check = runHookTrust(
      { hooksJson: null, pluginsDir: true },
      makeExecWithNativeProbe({ outcome: 'absent', errorClass: null, entries: [] }),
    );
    expect(check.status).toBe('not-applicable');
    expect(check.details.trustStatus).toBe('not-applicable');
  });

  it('仅合并器环境（helper 本身 ENOENT，process.execPath 不在表中）：现有全部 4 个固定状态值断言逐字保持不变', () => {
    expect(runHookTrust({ hooksJson: null }, makeExec({})).status).toBe('not-applicable');

    const untrusted = runHookTrust(
      { hooksJson: '{"Stop":[]}', configToml: '[mcp_servers.x]\nurl = "https://example.invalid"\n' },
      makeExec({}),
    );
    expect(untrusted.status).toBe('warning');
    expect(untrusted.details.trustStatus).toBe('untrusted');

    const indeterminate = runHookTrust(
      { hooksJson: '{"Stop":[]}', configToml: '[hooks.state]\ntrusted_hash = "deadbeef"\n' },
      makeExec({}),
    );
    expect(indeterminate.status).toBe('indeterminate');
    expect(indeterminate.details.trustStatus).toBe('indeterminate');

    const bareHooks = runHookTrust(
      { hooksJson: '{"Stop":[]}', configToml: '[hooks]\nsome_feature = true\n' },
      makeExec({}),
    );
    expect(bareHooks.status).toBe('warning');
    expect(bareHooks.details.trustStatus).toBe('untrusted');
  });

  it('【硬约束 5】无插件环境不得误报 warning：helper ENOENT 且本地无 hooks.json → status 不为 warning（F264「判不出⇒按启用算」镜像面）', () => {
    const check = runHookTrust({ hooksJson: null }, makeExec({}));
    expect(check.status).not.toBe('warning');
    expect(check.status).toBe('not-applicable');
  });

  it('原生环境 —— all untrusted → status=warning trustStatus=untrusted remediation.code=grant-hook-trust', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginsDir: true },
      makeExecWithNativeProbe({
        outcome: 'found',
        errorClass: null,
        entries: ['untrusted', 'untrusted', 'untrusted', 'untrusted', 'untrusted'],
      }),
    );
    expect(check.status).toBe('warning');
    expect(check.details.trustStatus).toBe('untrusted');
    expect(check.remediation?.code).toBe('grant-hook-trust');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-untrusted', {}));
  });

  it('原生环境 —— 含 modified（无 untrusted）→ status=warning trustStatus=modified', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginsDir: true },
      makeExecWithNativeProbe({ outcome: 'found', errorClass: null, entries: ['trusted', 'modified'] }),
    );
    expect(check.status).toBe('warning');
    expect(check.details.trustStatus).toBe('modified');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-modified', {}));
  });

  it('原生环境 —— 含 managed（无 untrusted/modified）→ status=indeterminate trustStatus=indeterminate', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginsDir: true },
      makeExecWithNativeProbe({ outcome: 'found', errorClass: null, entries: ['trusted', 'managed'] }),
    );
    expect(check.status).toBe('indeterminate');
    expect(check.details.trustStatus).toBe('indeterminate');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-managed', {}));
  });

  it('原生环境 —— 全 trusted → status=ok trustStatus=trusted remediation=null', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginsDir: true },
      makeExecWithNativeProbe({ outcome: 'found', errorClass: null, entries: ['trusted', 'trusted'] }),
    );
    expect(check.status).toBe('ok');
    expect(check.details.trustStatus).toBe('trusted');
    expect(check.remediation).toBeNull();
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-trusted', {}));
  });

  it('F275 对抗审查后修订：RPC 明确失败（rpc-error）+ hooksJsonPresent=true → 回退合并器判据，采用合并器侧结论（消误报 C-2）', () => {
    // 🔴 旧行为（已被两路异构对抗证伪）：RPC 失败无条件短路成 indeterminate，即使合并器侧
    // 能给出确定结论也被掩盖。终版矩阵行 4：hooksJsonPresent=true 时合并器结论本身可信，
    // RPC 失败只留痕（见下方 attemptedProbes 断言），不再压制这个可判定的结论。
    const check = runHookTrust(
      { hooksJson: '{"Stop":[]}', configToml: '[mcp_servers.x]\nurl = "https://example.invalid"\n' },
      makeExecWithNativeProbe({ outcome: 'error', errorClass: 'rpc-error', entries: [] }),
    ) as unknown as {
      status: string;
      details: { trustStatus: string; attemptedProbes: Array<{ id: string; outcome: string; errorClass: string | null }> };
      remediation: { code: string | null } | null;
    };
    expect(check.status).toBe('warning');
    expect(check.details.trustStatus).toBe('untrusted');
    expect(check.remediation?.code).toBe('grant-hook-trust');
    const nativeProbeEntry = check.details.attemptedProbes.find((p) => p.id === 'app-server-hooks-list');
    expect(nativeProbeEntry).toEqual({ id: 'app-server-hooks-list', outcome: 'error', errorClass: 'rpc-error' });
  });

  it('helper 输出畸形（entries 含闭集外的值）+ 有插件 cache 证据 → indeterminate/hook-trust-native-unreachable（终版矩阵行 5）', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginSpecDriverCache: true },
      makeExecWithNativeProbe({ outcome: 'found', errorClass: null, entries: ['trusted', 'some-unknown-fifth-value'] }),
    );
    expect(check.status).toBe('indeterminate');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-unreachable', { errorClass: 'parse-failed' }));
  });

  it('helper 输出畸形（整体不是合法 JSON）+ 有插件 cache 证据 → indeterminate/hook-trust-native-unreachable', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginSpecDriverCache: true },
      makeExec({ [process.execPath]: { stdout: '{not valid json' } }),
    );
    expect(check.status).toBe('indeterminate');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-unreachable', { errorClass: 'parse-failed' }));
  });

  it('helper 输出畸形（outcome 不在四值内）+ 有插件 cache 证据 → indeterminate/hook-trust-native-unreachable', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginSpecDriverCache: true },
      makeExecWithNativeProbe({ outcome: 'something-unexpected', errorClass: null, entries: [] }),
    );
    expect(check.status).toBe('indeterminate');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-unreachable', { errorClass: 'parse-failed' }));
  });

  it('helper 输出畸形（entries 夹带非字符串项：对象而非字符串）+ 有插件 cache 证据 → indeterminate/hook-trust-native-unreachable', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginSpecDriverCache: true },
      makeExecWithNativeProbe({ outcome: 'found', errorClass: null, entries: [{ trustStatus: 'trusted' }] }),
    );
    expect(check.status).toBe('indeterminate');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-unreachable', { errorClass: 'parse-failed' }));
  });

  it('helper 输出畸形（整体不是合法 JSON）+ 无任何插件安装痕迹 → not-applicable/hook-trust-not-applicable-no-evidence（终版矩阵行 6）', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginsDir: true },
      makeExec({ [process.execPath]: { stdout: '{not valid json' } }),
    );
    expect(check.status).toBe('not-applicable');
    expect(check.summary).toBe(core.buildSummary('hook-trust-not-applicable-no-evidence', {}));
  });

  it('B3：helper stdout 前缀夹带非 JSON 噪声行（模拟 NODE_OPTIONS preload 输出）→ 取最后一个非空行解析，不误判 parse-failed', () => {
    const check = runHookTrust(
      { hooksJson: null, pluginsDir: true },
      makeExec({
        [process.execPath]: {
          stdout: [
            '(node:12345) Warning: some preload noise',
            '',
            JSON.stringify({ outcome: 'found', errorClass: null, entries: ['trusted'] }),
            '',
          ].join('\n'),
        },
      }),
    );
    expect(check.status).toBe('ok');
    expect(check.details.trustStatus).toBe('trusted');
    expect(check.summary).toBe(core.buildSummary('hook-trust-native-trusted', {}));
  });

  it('前置门跳过：无 plugins 目录 + 无 hooksJson → helper 从不被 spawn，直接 not-applicable/hook-trust-not-probed', () => {
    // 🔴 `exec` 是 io.runDoctor 全部检查共用的注入执行器（repo-version 不用它，但
    // global-cli/plugin-build/mcp-server 都会调），因此不能断言"从未被调用"，只能断言
    // "从未以 helper 路径为参数被调用"——这才是前置门真正要保证的事。
    let helperInvoked = false;
    const baseExec = makeExec({});
    const exec = ((file: string, args: string[] = [], options?: unknown) => {
      if (args.some((a) => a.includes('codex-hooks-list-probe.mjs'))) {
        helperInvoked = true;
      }
      return baseExec(file, args, options as never);
    }) as unknown as ReturnType<typeof makeExec>;
    const check = runHookTrust({ hooksJson: null }, exec);
    expect(helperInvoked).toBe(false);
    expect(check.status).toBe('not-applicable');
    expect(check.summary).toBe(core.buildSummary('hook-trust-not-probed', {}));
  });
});

describe('F240 — `config-toml-hooks-state` 的 outcome 必须描述「段」而非「文件可读性」', () => {
  type Probe = { id: string; outcome: string; errorClass: string | null };
  type HookCheck = {
    status: string;
    remediation: { code: string | null };
    details: { trustStatus: string; attemptedProbes: Probe[] };
  };
  function hookProbes(configToml: string | null): { check: HookCheck; probes: Probe[] } {
    const fx = makeFixture({ hooksJson: '{"Stop":[]}', configToml });
    const check = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeExec({}),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['hook-trust'] as HookCheck;
    return { check, probes: check.details.attemptedProbes };
  }
  const byId = (probes: Probe[], id: string) => probes.find((p) => p.id === id);

  it('真机场景：config.toml 可读但全文无 hooks 段 → 段探针 absent、文件探针 found', () => {
    const { check, probes } = hookProbes('[mcp_servers.x]\nurl = "https://example.invalid"\n');
    expect(byId(probes, 'config-toml-readable')?.outcome).toBe('found');
    // 🔴 修复前此处是 'found'——一条 id 叫 `...hooks-state` 的记录报 found，会被读成「找到了段」
    expect(byId(probes, 'config-toml-hooks-state')?.outcome).toBe('absent');
    // 判定结论逐字不变
    expect(check.status).toBe('warning');
    expect(check.details.trustStatus).toBe('untrusted');
    expect(check.remediation.code).toBe('grant-hook-trust');
  });

  it('段存在 → 段探针 found，且判定仍为 indeterminate（不假设已信任）', () => {
    const { check, probes } = hookProbes('[hooks.state]\ntrusted_hash = "deadbeef"\n');
    expect(byId(probes, 'config-toml-readable')?.outcome).toBe('found');
    expect(byId(probes, 'config-toml-hooks-state')?.outcome).toBe('found');
    expect(check.status).toBe('indeterminate');
    expect(check.details.trustStatus).toBe('indeterminate');
  });

  it('config.toml 不存在 → 文件探针 absent；「没有文件」蕴含「没有段」，段探针同为 absent', () => {
    const { check, probes } = hookProbes(null);
    expect(byId(probes, 'config-toml-readable')?.outcome).toBe('absent');
    expect(byId(probes, 'config-toml-hooks-state')?.outcome).toBe('absent');
    expect(check.details.trustStatus).toBe('untrusted');
  });

  it('config.toml 读不出 → 两条探针同记 error + errorClass，且段绝不落 absent', () => {
    const verdict = core.classifyHookTrust({
      hooksJsonPresent: true,
      configProbe: { outcome: 'error', errorClass: 'EACCES' },
      stateSection: { kind: 'unavailable' },
      currentHash: null,
    });
    const probes = verdict.probes as Probe[];
    expect(byId(probes, 'config-toml-readable')).toEqual({
      id: 'config-toml-readable',
      outcome: 'error',
      errorClass: 'EACCES',
    });
    expect(byId(probes, 'config-toml-hooks-state')).toEqual({
      id: 'config-toml-hooks-state',
      outcome: 'error',
      errorClass: 'EACCES',
    });
    expect(verdict.status).toBe('indeterminate');
  });

  it('段这条路径没真走过（kind 未知）→ not-probed，不得伪装成 absent（W2 不变量）', () => {
    const verdict = core.classifyHookTrust({
      hooksJsonPresent: true,
      configProbe: { outcome: 'found', errorClass: null },
      stateSection: { kind: 'some-unmodelled-kind' },
      currentHash: null,
    });
    const probes = verdict.probes as Probe[];
    expect(byId(probes, 'config-toml-hooks-state')?.outcome).toBe('not-probed');
    expect(verdict.status).toBe('indeterminate');
  });

  it('全部 id 均在 HOOK_TRUST_PROBES 内，故能通过 details 净化漏斗（不被结构性丢弃）', () => {
    for (const id of [
      'config-toml-readable',
      'config-toml-hooks-state',
      'app-server-hooks-list',
      'codex-home-plugin-cache',
    ]) {
      expect(core.HOOK_TRUST_PROBES).toContain(id);
    }
    const { probes } = hookProbes('[mcp_servers.x]\nurl = "https://example.invalid"\n');
    // 🔴 F275 对抗审查后修订：本 fixture 的 hooksJson 存在 → 前置门不拦截，io.runDoctor 会
    // 真的调用注入的 exec（`makeExec({})`，process.execPath 未登记 → ENOENT）；classifyHookTrust
    // 因而收到 `nativeProbe.outcome === 'not-executable'`，而不是旧版假设的 `not-probed`。
    // `codex-home-plugin-cache` 是新增的第 5 条留痕（纯文件读，本 fixture 未造 cache 目录 → absent）。
    expect(probes.map((p) => p.id)).toEqual([
      'codex-home-hooks-json',
      'config-toml-readable',
      'config-toml-hooks-state',
      'app-server-hooks-list',
      'codex-home-plugin-cache',
    ]);
    const nativeProbeEntry = probes.find((p) => p.id === 'app-server-hooks-list');
    expect(nativeProbeEntry?.outcome).toBe('not-executable');
    expect(nativeProbeEntry?.errorClass).toBe('ENOENT');
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

// ─────────────────────────────────────────────────────────────────────────────
// F265 G0-3 — commit 维度（T025 变异测试矩阵行 5 / 行 7）
// ─────────────────────────────────────────────────────────────────────────────

/** 两个真实形态的 40 位 SHA（前 7 位不同），用于构造 match / mismatch */
const HEAD_A = 'ee6e8314da4a591128d7bbfea1b28d4248ee8ab8';
const HEAD_B = '0ae3eb7012345678901234567890123456789abc';

/**
 * F265 — 按 `(file, args)` 分派的假 exec。
 *
 * 既有 `makeExec` 只按 `file` 分派，区分不了 `spectra --version` 与
 * `spectra mcp-server` —— 而 commit 维度恰恰要给这两条喂不同的东西，
 * 否则测的就不是"两个通道各自读到什么"，而是"同一段文本被读了两遍"。
 */
function makeCommitExec(opts: {
  /** `git rev-parse HEAD` 的 stdout；`null` ⇒ 该命令 ENOENT（模拟非 git 工作区 / 无 git） */
  head?: string | null;
  /** `spectra --version` 的 stdout；`null` ⇒ ENOENT */
  versionLine?: string | null;
  /** `spectra mcp-server` 的自省结果 */
  mcp?:
    | { version?: string; commit?: string | null; dirty?: boolean | null }
    | 'tool-not-found'
    | 'garbage'
    | null;
}) {
  const enoent = (): never => {
    const err: NodeJS.ErrnoException = new Error('spawn ENOENT');
    err.code = 'ENOENT';
    throw err;
  };
  const initLine = JSON.stringify({
    result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'spectra' } },
    jsonrpc: '2.0',
    id: 1,
  });
  return (file: string, args: string[] = []): string => {
    if (file === 'git') {
      if (opts.head === null || opts.head === undefined) return enoent();
      return `${opts.head}\n`;
    }
    if (file === 'spectra' && args[0] === 'mcp-server') {
      const spec = opts.mcp;
      if (spec === null || spec === undefined) return enoent();
      if (spec === 'garbage') return 'volta error: could not locate binary\n';
      const callLine =
        spec === 'tool-not-found'
          ? JSON.stringify({
              result: {
                content: [{ type: 'text', text: 'MCP error -32602: Tool server_build_info not found' }],
                isError: true,
              },
              jsonrpc: '2.0',
              id: 2,
            })
          : JSON.stringify({
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      version: spec.version ?? '4.5.0',
                      commit: spec.commit ?? null,
                      dirty: spec.dirty ?? null,
                    }),
                  },
                ],
              },
              jsonrpc: '2.0',
              id: 2,
            });
      return `${initLine}\n${callLine}\n`;
    }
    if (file === 'spectra') {
      if (opts.versionLine === null || opts.versionLine === undefined) return enoent();
      return opts.versionLine;
    }
    return enoent();
  };
}

describe('F265 T025 — compareCommits 纯函数（变异测试矩阵行 5）', () => {
  it('两个不同的 7 位十六进制 → mismatch', () => {
    expect(core.compareCommits('ee6e831', '0ae3eb7')).toBe('mismatch');
  });

  it('相同 → match；长短不一但前 7 位相同 → match（--version 只暴露 commit(7)）', () => {
    expect(core.compareCommits('ee6e831', 'ee6e831')).toBe('match');
    expect(core.compareCommits(HEAD_A, 'ee6e831')).toBe('match');
    // 大小写不敏感：git 输出恒小写，但外部来源不保证
    expect(core.compareCommits('EE6E831', 'ee6e831')).toBe('match');
  });

  it('W-2：比较宽度取较短一方的长度，而不是恒取 7 位', () => {
    // 双方都给了 14 位 ⇒ 就该比 14 位。恒取 7 位意味着只用 28 bit 判同一性，
    // 两个不同 build 撞前 7 位就会被判成同一份代码（对抗审查 W-2）。
    expect(core.compareCommits(`${'ee6e831'}aaaaaaa`, `${'ee6e831'}bbbbbbb`)).toBe('mismatch');
    // 双方都是全长 SHA ⇒ 全长比较：只有末位不同也必须是 mismatch
    const a = `${'ee6e8314da4a591128d7bbfea1b28d4248ee8ab'}8`;
    const b = `${'ee6e8314da4a591128d7bbfea1b28d4248ee8ab'}0`;
    expect(core.compareCommits(a, b)).toBe('mismatch');
    // 一方只暴露 commit(7)（`spectra --version` 的形态）⇒ 退到 7 位比较，仍 match
    expect(core.compareCommits(HEAD_A, HEAD_A.slice(0, 7))).toBe('match');
  });

  it('任一侧缺席（null / undefined / 空串）→ absent，且 absent 优先于 unreadable', () => {
    expect(core.compareCommits(null, HEAD_A)).toBe('absent');
    expect(core.compareCommits(HEAD_A, null)).toBe('absent');
    expect(core.compareCommits(undefined, HEAD_A)).toBe('absent');
    expect(core.compareCommits(HEAD_A, '   ')).toBe('absent');
    expect(core.compareCommits(null, null)).toBe('absent');
    // 一侧缺席、另一侧畸形 ⇒ absent（"没得比"比"读不懂"更贴近事实）
    expect(core.compareCommits(null, 'not-a-commit')).toBe('absent');
  });

  it('两侧都有值但形态不是 commit（非十六进制 / 不足 7 位 / 超 40 位 / 非字符串）→ unreadable', () => {
    expect(core.compareCommits('zzzzzzz', HEAD_A)).toBe('unreadable');
    expect(core.compareCommits('ee6e83', HEAD_A)).toBe('unreadable');
    expect(core.compareCommits(`${HEAD_A}0`, HEAD_A)).toBe('unreadable');
    expect(core.compareCommits(123, HEAD_A)).toBe('unreadable');
    expect(core.compareCommits({ commit: HEAD_A }, HEAD_A)).toBe('unreadable');
  });

  it('返回值恒落在 COMMIT_COMPARISONS 域内（commit 维度对外的唯一出口）', () => {
    const inputs = [null, undefined, '', '   ', 'zzz', 'ee6e831', HEAD_A, HEAD_B, 7, {}, []];
    for (const a of inputs) {
      for (const b of inputs) {
        expect([...core.COMMIT_COMPARISONS]).toContain(core.compareCommits(a, b));
      }
    }
    expect([...core.COMMIT_COMPARISONS]).toEqual(['match', 'mismatch', 'absent', 'unreadable']);
  });
});

describe('F265 T025 — commit 维度接进四方报告', () => {
  it('repo-version：基准可读 ⇒ available；无 git ⇒ absent（基准立不住则其余三方也必 absent）', () => {
    const fx = makeFixture({ spectraVersion: '4.5.0' });
    const withGit = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeCommitExec({ head: HEAD_A }),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    // I-1：基准方登记的是"基准立没立得住"，不是一次自比结论
    expect(withGit.checks['repo-version.spectra'].details.baselineCommit).toBe('available');
    expect('commitComparison' in withGit.checks['repo-version.spectra'].details).toBe(false);

    const noGit = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeCommitExec({ head: null, versionLine: 'spectra v4.5.0 (ee6e831)\n' }),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(noGit.checks['repo-version.spectra'].details.baselineCommit).toBe('absent');
    expect(noGit.checks['global-cli.spectra'].details.commitComparison).toBe('absent');
  });

  it('global-cli：版本号相同但 commit 不同 ⇒ warning（不是 ok，也不是 fail）', () => {
    const fx = makeFixture({ spectraVersion: '4.5.0' });
    const run = (versionLine: string) =>
      io.runDoctor({
        projectRoot: fx.projectRoot,
        codexHome: fx.codexHome,
        env: {},
        exec: makeCommitExec({ head: HEAD_A, versionLine }),
        now: () => new Date('2026-08-03T00:00:00.000Z'),
      }).checks['global-cli.spectra'];

    const same = run('spectra v4.5.0 (ee6e831)\n');
    expect(same.status).toBe('ok');
    expect(same.details.commitComparison).toBe('match');

    const drifted = run('spectra v4.5.0 (0ae3eb7)\n');
    expect(drifted.status).toBe('warning');
    expect(drifted.details.commitComparison).toBe('mismatch');
    expect(drifted.details.semver).toBe('4.5.0');
    // 🔴 版本号一致，所以这不能是 fail —— 它是"你自用的 CLI 不是这次改动"的提示
    expect(drifted.summary).toContain('commitComparison=mismatch');

    // 无 commit 后缀 ⇒ absent，绝不因"比不了"降级成 warning
    const bare = run('spectra v4.5.0\n');
    expect(bare.status).toBe('ok');
    expect(bare.details.commitComparison).toBe('absent');
  });

  it('mcp-server：自省成功 ⇒ 按 commit 落 ok / warning；旧 build 无该工具 ⇒ indeterminate + rpc-error', () => {
    const fx = makeFixture({ spectraVersion: '4.5.0' });
    const run = (mcp: Parameters<typeof makeCommitExec>[0]['mcp']) =>
      io.runDoctor({
        projectRoot: fx.projectRoot,
        codexHome: fx.codexHome,
        env: {},
        exec: makeCommitExec({ head: HEAD_A, versionLine: 'spectra v4.5.0 (ee6e831)\n', mcp }),
        now: () => new Date('2026-08-03T00:00:00.000Z'),
      }).checks['mcp-server.spectra'];

    const match = run({ version: '4.5.0', commit: HEAD_A, dirty: false });
    expect(match.status).toBe('ok');
    expect(match.details.commitComparison).toBe('match');
    expect(match.details.semver).toBe('4.5.0');
    expect(match.details.probeMethod).toBe('stdio-server-build-info');
    expect(match.details.probeTarget).toBe('path-binary');
    expect(match.details.buildDirty).toBe(false);

    const mismatch = run({ version: '4.5.0', commit: HEAD_B, dirty: false });
    expect(mismatch.status).toBe('warning');
    expect(mismatch.details.commitComparison).toBe('mismatch');
    expect(mismatch.remediation?.code).toBe('reload-mcp-client');

    // 自省通道通了但对方没盖章（clean checkout / tsx 直跑）⇒ 比不了，不是错
    const noStamp = run({ version: '4.5.0', commit: null, dirty: null });
    expect(noStamp.status).toBe('indeterminate');
    expect(noStamp.details.commitComparison).toBe('absent');
    // W-1：「没给」的文案说的就是"没有 commit 信息"
    expect(noStamp.summary).toContain('没有 commit 信息');
    // dirty 不是布尔（这里是 null）⇒ 该键不写，且**不得**倒灌 parse-failed
    expect('buildDirty' in noStamp.details).toBe(false);
    expect('errorClass' in noStamp.details).toBe(false);

    // 🔴 C-1：commit 相同但 build 编自未提交的工作树 ⇒ warning，不是 ok。
    // 开发期这是主路径；渲染成干净的 ok 等于让诊断在最常见的场景下说假话。
    const dirty = run({ version: '4.5.0', commit: HEAD_A, dirty: true });
    expect(dirty.status).toBe('warning');
    expect(dirty.details.commitComparison).toBe('match');
    expect(dirty.details.buildDirty).toBe(true);
    expect(dirty.summary).toContain('dirty');
    expect(dirty.summary).toContain('未提交的工作树');

    // 旧 build（4.4.0）没有 server_build_info ⇒ SDK 回 isError 的正常响应
    const oldBuild = run('tool-not-found');
    expect(oldBuild.status).toBe('indeterminate');
    expect(oldBuild.details.errorClass).toBe('rpc-error');
    expect(oldBuild.details.commitComparison).toBe('absent');

    // stdout 不是 NDJSON（PATH 上摆着别的东西 / 包装脚本噪声）⇒ parse-failed，不崩
    const garbage = run('garbage');
    expect(garbage.status).toBe('indeterminate');
    expect(garbage.details.errorClass).toBe('parse-failed');
  });

  it('🔴 plugin-build 的 commitComparison 恒为 absent（变异测试矩阵行 7）', () => {
    // 任何输入变化都不得让它变成别的值：manifest schema 没有 commit 字段，
    // 快照目录名是快照哈希而非 build 标识（F236），拿它冒充 commit 是造假不是修复。
    const variants: Array<Parameters<typeof makeCommitExec>[0]> = [
      { head: HEAD_A },
      { head: null },
      { head: HEAD_A, versionLine: 'spectra v4.5.0 (ee6e831)\n' },
      { head: HEAD_A, versionLine: 'spectra v4.5.0 (0ae3eb7)\n', mcp: { commit: HEAD_A } },
      { head: HEAD_B, mcp: 'tool-not-found' },
    ];
    for (const opts of variants) {
      const fx = makeFixture({ spectraVersion: '4.5.0' });
      const report = io.runDoctor({
        projectRoot: fx.projectRoot,
        codexHome: fx.codexHome,
        env: {},
        exec: makeCommitExec(opts),
        now: () => new Date('2026-08-03T00:00:00.000Z'),
      });
      for (const product of ['spectra', 'spec-driver']) {
        expect(
          report.checks[`plugin-build.${product}`].details.commitComparison,
          `plugin-build.${product} 的 commitComparison 必须恒为 absent`,
        ).toBe('absent');
      }
    }
  });

  it('`none-available` 已无产出路径：probeMethod 域只剩实际使用的探测方法', () => {
    // 报告里再出现 `none-available` 就是在陈述一个不再成立的事实（缺口已由
    // server_build_info 关闭）；自省失败走 errorClass，而不是退回"没有通道"。
    expect(core.SUMMARY_CODES).not.toContain('mcp-server-known-gap');
    expect(core.SUMMARY_CODES).toContain('mcp-server-commit-match');
    expect(core.SUMMARY_CODES).toContain('mcp-server-commit-mismatch');
    expect(core.SUMMARY_CODES).toContain('mcp-server-introspection-unavailable');
    // W-1：「没给 commit」与「给了但读不懂」拆成两个码，不再共用一句文案
    expect(core.SUMMARY_CODES).not.toContain('mcp-server-commit-indeterminate');
    expect(core.SUMMARY_CODES).toContain('mcp-server-commit-absent');
    expect(core.SUMMARY_CODES).toContain('mcp-server-commit-unreadable');
    // C-1：commit 相同但脏树的独立码
    expect(core.SUMMARY_CODES).toContain('mcp-server-commit-match-dirty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F265 对抗审查修复批 —— mcp-server 侧的诚实性（C-1 / C-2 / W-1 / W-3）
// ─────────────────────────────────────────────────────────────────────────────

describe('F265 对抗审查 — mcp-server 消费面', () => {
  const runMcp = (mcp: Parameters<typeof makeCommitExec>[0]['mcp'], head: string | null = HEAD_A) => {
    const fx = makeFixture({ spectraVersion: '4.5.0' });
    return io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: makeCommitExec({ head, versionLine: 'spectra v4.5.0 (ee6e831)\n', mcp }),
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    }).checks['mcp-server.spectra'];
  };

  it('W-1：回传了 commit 但形态不合法 ⇒ commit-unreadable，与 absent 文案分开', () => {
    const check = runMcp({ version: '4.5.0', commit: 'not-a-commit', dirty: false });
    expect(check.status).toBe('indeterminate');
    expect(check.details.commitComparison).toBe('unreadable');
    expect(check.summary).toContain('形态不合法');
    // 与「没有 commit 信息」是两句不同的话
    expect(check.summary).not.toContain('没有 commit 信息');
  });

  it('C-2：summary 说的是 PATH 上的二进制，不再声称探到了"正在运行的" server', () => {
    const match = runMcp({ version: '4.5.0', commit: HEAD_A, dirty: false });
    expect(match.summary).toContain('PATH 上的');
    expect(match.summary).not.toContain('正在运行的');

    const mismatch = runMcp({ version: '4.5.0', commit: HEAD_B, dirty: false });
    expect(mismatch.summary).toContain('PATH 上的');
    expect(mismatch.summary).not.toContain('正在运行的');
    // remediation 也要说清结论的适用范围：客户端连着的旧进程需重连
    expect(mismatch.remediation.text).toContain('重连');
  });

  it('C-1：dirty 只认布尔 true —— false / 缺失 / 非布尔一律不降级为 warning', () => {
    expect(runMcp({ version: '4.5.0', commit: HEAD_A, dirty: false }).status).toBe('ok');
    // 缺字段（旧 build 只回 version+commit）⇒ 不知道脏不脏 ⇒ 按已知的说，判 ok
    const missing = runMcp({ version: '4.5.0', commit: HEAD_A });
    expect(missing.status).toBe('ok');
    expect('buildDirty' in missing.details).toBe(false);
    // commit 不同的情况下，dirty 与否都不改变 mismatch 结论
    expect(runMcp({ version: '4.5.0', commit: HEAD_B, dirty: true }).status).toBe('warning');
    expect(runMcp({ version: '4.5.0', commit: HEAD_B, dirty: true }).details.commitComparison).toBe(
      'mismatch',
    );
  });

  it('W-3：无界 version 串不进报告 —— 超长 / 形态不符一律 semver:null', () => {
    // 200KB 的 version 串（对抗代理实测能一路进 details）
    const huge = runMcp({ version: `4.5.0${'0'.repeat(200_000)}`, commit: HEAD_A, dirty: false });
    expect(huge.details.semver).toBeNull();
    expect(JSON.stringify(huge).length).toBeLessThan(4000);

    // 33 字符（上限 32）⇒ 拒；32 字符内但整串不是受限 semver ⇒ 拒
    expect(runMcp({ version: `4.5.0 ${'x'.repeat(27)}`, commit: HEAD_A }).details.semver).toBeNull();
    expect(runMcp({ version: 'v4.5.0-beta.1', commit: HEAD_A }).details.semver).toBeNull();
    // 合法形态照常放行（`v` 前缀是受限形态的一部分）
    expect(runMcp({ version: 'v4.5.0', commit: HEAD_A }).details.semver).toBe('4.5.0');
  });
});
