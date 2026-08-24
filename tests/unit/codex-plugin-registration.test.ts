/**
 * Feature 264 / T003 — 双注册守卫核心判据单测（D1/D2）
 *
 * 被测对象：`plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs`
 *
 * 覆盖 `specs/264-fix-codex-hooks-distribution/fix-report.md` 实测口径 E1~E3 + absent +
 * 畸形 TOML + 任意 marketplace 匹配。
 *
 * 🔴 **判据方向（异构对抗第一轮后修订，与初版相反）**：cache 证据是主信号，config.toml 的
 * **显式 `enabled = false`** 是唯一豁免；任何"判不出"都不构成豁免 ⇒ 拒绝安装。
 * 理由见被测模块头部：漏拦 = 静默双注册（用户看不见，且损坏的正是依从性门禁本身）；
 * 误拒 = 一条中文指引 + 现成的 `--force-hooks` 逃生口（可见、可覆盖）。两个方向不对称。
 *
 * 运行：npx vitest run tests/unit/codex-plugin-registration.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODULE_URL = new URL(
  '../../plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs',
  import.meta.url,
).href;
const { detectNativePluginRegistration } = (await import(MODULE_URL)) as {
  detectNativePluginRegistration: (params: {
    codexHome: string;
    pluginName: string;
    marketplaceName?: string | null;
  }) => {
    registered: boolean;
    marketplace: string | null;
    evidencePaths: string[];
    diagnostics: Array<{ level: string; code: string }>;
  };
};

const PLUGIN_NAME = 'spec-driver';

/** canonical hooks.json 的最小子集：只需一条能命中 isOwnedEntry 的 owned handler */
const OWNED_HOOKS_DOC = {
  hooks: {
    Stop: [
      {
        matcher: '',
        hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/stop-task-check.sh' }],
      },
    ],
  },
};

const FOREIGN_HOOKS_DOC = {
  hooks: {
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'bash /opt/vendor/stop.sh' }] }],
  },
};

describe('codex-plugin-registration / detectNativePluginRegistration', () => {
  let codexHome: string;

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f264-registration-'));
  });

  afterEach(() => {
    fs.rmSync(codexHome, { recursive: true, force: true });
  });

  function writeConfig(content: string): void {
    fs.writeFileSync(path.join(codexHome, 'config.toml'), content, 'utf-8');
  }

  function seedCache(marketplace: string, snapshot: string, doc: unknown = OWNED_HOOKS_DOC): void {
    const dir = path.join(codexHome, 'plugins', 'cache', marketplace, PLUGIN_NAME, snapshot, 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(doc), 'utf-8');
  }

  it('E3：表存在但未写 enabled 键 + cache 命中 owned handler → registered:true（Codex 照常注册）', () => {
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\n');
    seedCache('cc-plugin-market', 'snap1');

    const result = detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME });

    expect(result.registered).toBe(true);
    expect(result.marketplace).toBe('cc-plugin-market');
  });

  it('enabled = true 显式 + cache 命中 → registered:true', () => {
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\nenabled = true\n');
    seedCache('cc-plugin-market', 'snap1');

    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(true);
  });

  it('E2：enabled = false，cache 仍在 → registered:false（只看 cache 目录会误拒）', () => {
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\nenabled = false\n');
    seedCache('cc-plugin-market', 'snap1');

    const result = detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME });
    expect(result.registered).toBe(false);
    expect(result.marketplace).toBeNull();
  });

  it('E1：codex plugin remove 之后（表与 cache 同时消失）→ registered:false', () => {
    writeConfig('[mcp_servers.x]\ntoken = "a"\n');
    // 无 plugins 段，也无 cache 目录（remove 同时删掉两者）

    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(false);
  });

  it('config.toml 不存在（absent，全新环境）→ registered:false', () => {
    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(false);
  });

  it('畸形 TOML（段名带 `]`）+ cache 命中 → registered:true（判不出豁免即拒绝）', () => {
    // 初版在这里判 false（沿用 normalizeTomlLines 的 absent 容错方向），实测那是 fail-open：
    // config.toml 解析不出 ≠ 插件没注册，而 cache 证据明明还在。
    writeConfig('[plugins."spec-driver@cc-plugin-market]evil"]\nenabled = true\n');
    seedCache('cc-plugin-market', 'snap1');

    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(true);
  });

  it('表存在 + enabled 未写 + cache 目录存在但缺 hooks/hooks.json → registered:false（放行）', () => {
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\n');
    fs.mkdirSync(path.join(codexHome, 'plugins', 'cache', 'cc-plugin-market', PLUGIN_NAME, 'snap1'), {
      recursive: true,
    });

    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(false);
  });

  it('cache 内 hooks.json 只含第三方 handler（不含 owned）→ registered:false', () => {
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\n');
    seedCache('cc-plugin-market', 'snap1', FOREIGN_HOOKS_DOC);

    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(false);
  });

  it('marketplace 名不写死：来自任意 marketplace 的注册同样命中', () => {
    writeConfig('[plugins."spec-driver@some-other-market"]\n');
    seedCache('some-other-market', 'snap1');

    const result = detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME });
    expect(result.registered).toBe(true);
    expect(result.marketplace).toBe('some-other-market');
  });

  it('显式传入 marketplaceName 时按该 marketplace 窄化过滤，不匹配则不命中', () => {
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\n');
    seedCache('cc-plugin-market', 'snap1');

    const result = detectNativePluginRegistration({
      codexHome,
      pluginName: PLUGIN_NAME,
      marketplaceName: 'other-market',
    });
    expect(result.registered).toBe(false);
  });

  it('🔴 幽灵 cache：台账里完全没提到本插件 → registered:false（否则是永久性误拒）', () => {
    // 「`codex plugin remove` 会连表带 cache 一起删，故不存在幽灵 cache」这条假设**已被实测推翻**：
    // 本机真实 ~/.codex 的 `openai-curated-remote/` 下有 5 个插件目录在 config.toml 里零对应条目，
    // `github` 更是同时躺在两个 cache 目录里而台账只有一条。换 marketplace 名 / 拷贝 ~/.codex /
    // 插件改名都会留下残留。据残留拒绝 = 用户被永久拦住且没有可操作出口。
    writeConfig('[plugins."other-plugin@cc-plugin-market"]\nenabled = true\n');
    seedCache('cc-plugin-market', 'snap1');

    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(false);
  });

  it('多个快照，其中一个含 owned handler 即命中（不要求全部快照都含）', () => {
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\n');
    seedCache('cc-plugin-market', 'snap-old', FOREIGN_HOOKS_DOC);
    seedCache('cc-plugin-market', 'snap-new', OWNED_HOOKS_DOC);

    expect(detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME }).registered).toBe(true);
  });

  it('cache 内 hooks.json 非法 JSON + 台账说启用 → 不崩溃，落保守侧拒绝并留下诊断', () => {
    // 「读不出」不等于「没有」：此时无法断言 Codex 注册了什么，而放行的代价是静默双注册。
    writeConfig('[plugins."spec-driver@cc-plugin-market"]\n');
    const dir = path.join(codexHome, 'plugins', 'cache', 'cc-plugin-market', PLUGIN_NAME, 'snap1', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), '{ not valid json }', 'utf-8');

    const result = detectNativePluginRegistration({ codexHome, pluginName: PLUGIN_NAME });
    expect(result.registered).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('cache-scan-inconclusive');
  });

  it('codexHome 缺失/空串 → fail-loud（不猜家目录）', () => {
    expect(() =>
      detectNativePluginRegistration({ pluginName: PLUGIN_NAME } as unknown as { codexHome: string; pluginName: string }),
    ).toThrow(/codexHome/);
    expect(() => detectNativePluginRegistration({ codexHome: '', pluginName: PLUGIN_NAME })).toThrow(
      /codexHome/,
    );
  });

  it('pluginName 缺失/空串 → fail-loud', () => {
    expect(() =>
      detectNativePluginRegistration({ codexHome } as unknown as { codexHome: string; pluginName: string }),
    ).toThrow(/pluginName/);
    expect(() => detectNativePluginRegistration({ codexHome, pluginName: '' })).toThrow(/pluginName/);
  });
});

/**
 * F264 — 异构对抗第一轮抓到的绕过面与误拒面回归钉子
 *
 * 每一条都对应一个**已实测**的构造（审查报告 C1 / W1 / W2 / W4 / S3~S6）。
 * 初版实现（config.toml 与 cache 对等 AND、判不出即放行）在 BLOCK 组的每一条上都会红。
 */
describe('F264 — 对抗构造回归（绕过面全部必须 BLOCK）', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'f264-adv-'));
  });
  afterEach(() => {
    // chmod 还原，否则 rmSync 在权限用例后会 EACCES
    for (const rel of ['config.toml', 'plugins/cache/cc-plugin-market/spec-driver']) {
      try {
        fs.chmodSync(path.join(home, rel), 0o755);
      } catch {
        /* 不存在即跳过 */
      }
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  const config = (content: string) => fs.writeFileSync(path.join(home, 'config.toml'), content);
  const cacheDir = (marketplace: string) =>
    path.join(home, 'plugins', 'cache', marketplace, PLUGIN_NAME);
  function seed(marketplace: string, snapshot: string, doc: unknown = OWNED_HOOKS_DOC): string {
    const dir = path.join(cacheDir(marketplace), snapshot, 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(doc, null, 2));
    return path.join(cacheDir(marketplace), snapshot);
  }
  const detect = () => detectNativePluginRegistration({ codexHome: home, pluginName: PLUGIN_NAME });

  const ENABLED_TRUE = '[plugins."spec-driver@cc-plugin-market"]\nenabled = true\n';

  it('🔴 C1：快照目录是指向真目录的 symlink → 必须 BLOCK（Dirent.isDirectory 是 lstat 语义，会漏掉）', () => {
    // 本机真实 Codex cache 里存在这种形态（openai-bundled/chrome/latest -> .../26.810.41047）。
    const store = path.join(home, 'store', '4.4.2', 'hooks');
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, 'hooks.json'), JSON.stringify(OWNED_HOOKS_DOC));
    fs.mkdirSync(cacheDir('cc-plugin-market'), { recursive: true });
    fs.symlinkSync(path.join(home, 'store', '4.4.2'), path.join(cacheDir('cc-plugin-market'), 'latest'));
    config(ENABLED_TRUE);

    expect(detect().registered).toBe(true);
  });

  it.each([
    ['段头内侧空格', '[ plugins."spec-driver@cc-plugin-market" ]\nenabled = true\n'],
    ['tab 段头', '[\tplugins."spec-driver@cc-plugin-market"]\nenabled = true\n'],
    ['literal string 键', "[plugins.'spec-driver@cc-plugin-market']\nenabled = true\n"],
    ['inline table', '[plugins]\n"spec-driver@cc-plugin-market" = { enabled = true }\n'],
    ['点分键', 'plugins."spec-driver@cc-plugin-market".enabled = true\n'],
    ['两级引号段名', '[plugins."spec-driver"."cc-plugin-market"]\nenabled = true\n'],
    ['profile 段', '[profiles.work.plugins."spec-driver@cc-plugin-market"]\nenabled = true\n'],
    ['数组表', '[[plugins."spec-driver@cc-plugin-market"]]\nenabled = true\n'],
    ['段名缺 @marketplace', '[plugins."spec-driver"]\nenabled = true\n'],
  ])('W1/W4/S3：合法但我方解析不出的 TOML 形态（%s）+ cache 命中 → 必须 BLOCK', (_label, toml) => {
    config(toml);
    seed('cc-plugin-market', '4.4.2');
    expect(detect().registered).toBe(true);
  });

  it('W2：config.toml 的 @marketplace token 与 cache 一级目录名不一致 → 仍 BLOCK（cache 侧遍历全部目录，不做名字推导）', () => {
    config('[plugins."spec-driver@ccmp"]\nenabled = true\n');
    seed('ccmp-remote', '4.4.2');
    expect(detect().registered).toBe(true);
  });

  it('S6：cache 内 hooks.json 带 UTF-8 BOM → 仍 BLOCK（BOM 会让 JSON.parse 抛错而静默丢证据）', () => {
    fs.mkdirSync(path.join(cacheDir('cc-plugin-market'), '4.4.2', 'hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir('cc-plugin-market'), '4.4.2', 'hooks', 'hooks.json'),
      `﻿${JSON.stringify(OWNED_HOOKS_DOC)}`,
    );
    config(ENABLED_TRUE);
    expect(detect().registered).toBe(true);
  });

  it('config.toml 完全不存在但 cache 有 owned hooks → BLOCK（缺文件不构成豁免）', () => {
    seed('cc-plugin-market', '4.4.2');
    expect(detect().registered).toBe(true);
  });

  it('S4：config.toml 不可读 → BLOCK，且必须留下可见诊断（不得静默）', () => {
    // 这份 config.toml 里其实写着 enabled=false（本该豁免），但读不出来 ⇒ 按"无豁免"处理。
    config('[plugins."spec-driver@cc-plugin-market"]\nenabled = false\n');
    seed('cc-plugin-market', '4.4.2');
    fs.chmodSync(path.join(home, 'config.toml'), 0o000);

    const result = detect();
    expect(result.registered).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('config-unreadable');
  });
});

describe('F264 — 对抗构造回归（误拒面：以下一律不得 BLOCK）', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'f264-adv-allow-'));
  });
  afterEach(() => {
    try {
      fs.chmodSync(path.join(home, 'plugins', 'cache', 'cc-plugin-market', PLUGIN_NAME), 0o755);
    } catch {
      /* 不存在即跳过 */
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  const config = (content: string) => fs.writeFileSync(path.join(home, 'config.toml'), content);
  function seed(marketplace: string, snapshot: string, doc: unknown = OWNED_HOOKS_DOC): void {
    const dir = path.join(home, 'plugins', 'cache', marketplace, PLUGIN_NAME, snapshot, 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(doc, null, 2));
  }
  const detect = () => detectNativePluginRegistration({ codexHome: home, pluginName: PLUGIN_NAME });

  it.each([
    ['规范写法', '[plugins."spec-driver@cc-plugin-market"]\nenabled = false\n'],
    ['无空格', '[plugins."spec-driver@cc-plugin-market"]\nenabled=false\n'],
    ['尾随注释', '[plugins."spec-driver@cc-plugin-market"]\nenabled = false  # 我关了\n'],
  ])('E2：显式 enabled=false（%s）→ 放行合并器', (_label, toml) => {
    config(toml);
    seed('cc-plugin-market', '4.4.2');
    expect(detect().registered).toBe(false);
  });

  it('多 marketplace：证据落在被关掉的那个（名字精确对上）→ 放行', () => {
    config(
      '[plugins."spec-driver@cc-plugin-market"]\nenabled = false\n\n[plugins."spec-driver@other"]\nenabled = true\n',
    );
    seed('cc-plugin-market', '4.4.2'); // 证据只在被关掉的那个 marketplace 下
    expect(detect().registered).toBe(false);
  });

  it('多 marketplace：证据落在开着的那个 → 拒绝，且点名的 token 在 config.toml 里找得到', () => {
    config(
      '[plugins."spec-driver@cc-plugin-market"]\nenabled = false\n\n[plugins."spec-driver@other"]\nenabled = true\n',
    );
    seed('other', '4.4.2');
    const result = detect();
    expect(result.registered).toBe(true);
    expect(result.marketplace).toBe('other');
  });

  it('🔴 C1：证据目录名对不上任何 token，但表已显式关闭 → 放行（名字匹配是单向优待，不是硬绑定）', () => {
    // 本机实测 cache 一级目录名与 config token 不一一对应（openai-curated vs openai-curated-remote）。
    // 若要求必须对上，用户写的 enabled=false 就永远豁免不了。
    config('[plugins."spec-driver@my-mkt"]\nenabled = false\n');
    seed('my-mkt-remote', '1.0.0');
    expect(detect().registered).toBe(false);
  });

  it('台账 enabled 但 cache 里没有我方 hooks（如更早的无 hooks 插件版本）→ 放行', () => {
    // Codex 没有东西可注册，拦下来纯属误拒。
    config('[plugins."spec-driver@cc-plugin-market"]\nenabled = true\n');
    expect(detect().registered).toBe(false);
  });

  it('S5：cache 不可读 + 台账说启用 → 落保守侧拒绝，并留下两条可见诊断', () => {
    // 这条刻意与"cache 干净地扫完但确实没有我方 hooks"区分开：前者「判不出」，后者「确定没有」。
    // 把两者混为一谈正是第一轮 fail-open 的成因。
    config('[plugins."spec-driver@cc-plugin-market"]\nenabled = true\n');
    seed('cc-plugin-market', '4.4.2');
    fs.chmodSync(path.join(home, 'plugins', 'cache', 'cc-plugin-market', PLUGIN_NAME), 0o000);

    const result = detect();
    expect(result.registered).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['cache-scan-unreadable', 'cache-scan-inconclusive']),
    );
  });

  it('别的插件名恰好以 spec-driver 为前缀 → 不误认', () => {
    config('[plugins."spec-driver-x@mp"]\nenabled = true\n');
    const dir = path.join(home, 'plugins', 'cache', 'mp', 'spec-driver-x', '1.0.0', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(OWNED_HOOKS_DOC));
    expect(detect().registered).toBe(false);
  });
});

/**
 * F264 / 第二轮 W3 — 拒绝时必须给出**可自救的证据**
 *
 * 只给一个 marketplace 名不够：本机实测该名可能来自 cache 目录而在 config.toml 里根本不存在，
 * 误拒的用户拿着它无从下手。命中路径必须逐条回传。
 */
describe('F264 — 拒绝判定必须回传证据路径', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'f264-evidence-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('命中时 evidencePaths 指向真实存在的 cache hooks.json', () => {
    fs.writeFileSync(
      path.join(home, 'config.toml'),
      '[plugins."spec-driver@cc-plugin-market"]\nenabled = true\n',
    );
    const dir = path.join(home, 'plugins', 'cache', 'cc-plugin-market', PLUGIN_NAME, '4.4.2', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(OWNED_HOOKS_DOC));

    const result = detectNativePluginRegistration({ codexHome: home, pluginName: PLUGIN_NAME });

    expect(result.registered).toBe(true);
    expect(result.evidencePaths).toHaveLength(1);
    expect(fs.existsSync(result.evidencePaths[0])).toBe(true);
    expect(result.evidencePaths[0]).toBe(path.join(dir, 'hooks.json'));
  });

  it('未命中时 evidencePaths 为空', () => {
    const result = detectNativePluginRegistration({ codexHome: home, pluginName: PLUGIN_NAME });
    expect(result.registered).toBe(false);
    expect(result.evidencePaths).toEqual([]);
  });
});

/**
 * F264 / 第一轮审查 CRITICAL-1 与 WARNING-2 — 「config.toml 里提到插件名」必须是**结构化**判据
 *
 * 全文件子串匹配会把下面三种情形误判成"已注册"，而守卫此时会吐出一句**假陈述**
 * （"已由 Codex 原生注册生效，无需再跑合并器"），用户没有理由怀疑它、也就想不到用 `--force-hooks`。
 */
describe('F264 — plugins 语境 + token 边界的结构化提及判据', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'f264-mention-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const config = (content: string) => fs.writeFileSync(path.join(home, 'config.toml'), content);
  function seedGhostCache(marketplace = 'ghostmkt'): void {
    const dir = path.join(home, 'plugins', 'cache', marketplace, PLUGIN_NAME, 'snap1', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(OWNED_HOOKS_DOC));
  }
  const detect = () => detectNativePluginRegistration({ codexHome: home, pluginName: PLUGIN_NAME });

  it.each([
    [
      '用户注释掉插件段来停用（无 disable 子命令时最自然的手改）',
      '# 暂时停用\n#[plugins."spec-driver@ghostmkt"]\n#enabled = true\n',
    ],
    [
      '[projects."/…/spec-driver"] 信任目录路径里含插件名（本机实测有 8 条 projects 段）',
      'model = "gpt-5.6"\n[projects."/Users/dev/code/spec-driver"]\ntrust_level = "trusted"\n',
    ],
    [
      '名字含子串的第三方插件 spec-driver-lite 已注册',
      '[plugins."spec-driver-lite@other"]\nenabled = true\n',
    ],
  ])('🔴 %s → 不得判为已注册（否则守卫会说一句假话）', (_label, toml) => {
    config(toml);
    seedGhostCache();
    expect(detect().registered).toBe(false);
  });

  it.each([
    ['段头内侧空格', '[ plugins."spec-driver@ghostmkt" ]\nenabled = false\n'],
    ['literal string 键', "[plugins.'spec-driver@ghostmkt']\nenabled = false\n"],
    ['inline table 同行 enabled', '[plugins]\n"spec-driver@ghostmkt" = { enabled = false }\n'],
  ])('我方解析不出的合法写法（%s）里的显式 enabled=false 仍须豁免', (_label, toml) => {
    config(toml);
    seedGhostCache();
    expect(detect().registered).toBe(false);
  });

  it.each([
    ['段头内侧空格', '[ plugins."spec-driver@ghostmkt" ]\nenabled = true\n'],
    ['inline table', '[plugins]\n"spec-driver@ghostmkt" = { enabled = true }\n'],
    ['点分键', 'plugins."spec-driver@ghostmkt".enabled = true\n'],
    ['profile 段', '[profiles.work.plugins."spec-driver@ghostmkt"]\nenabled = true\n'],
  ])('同样这些写法在 enabled=true 时仍须拦（收紧不得反向打开绕过面：%s）', (_label, toml) => {
    config(toml);
    seedGhostCache();
    expect(detect().registered).toBe(true);
  });

  it('非法 TOML（未闭合三引号）→ 放行：真机实测此时 Codex 报 Invalid configuration 且注册 0 条', () => {
    // codex-cli 0.144.6 隔离 CODEX_HOME 实测：注入未闭合 `"""` 后 hooks/list 返回
    // `hooks: []` + errors 里带 `invalid multi-line basic string`。配置整份失效 ⇒ 无可注册。
    config('x = """\nunclosed\n[plugins."spec-driver@ghostmkt"]\nenabled = true\n');
    seedGhostCache();
    expect(detect().registered).toBe(false);
  });
});
