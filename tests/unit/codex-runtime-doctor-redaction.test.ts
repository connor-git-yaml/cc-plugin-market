/**
 * Feature 240 / T046 — 四方诊断输出强制脱敏（SC-014 / FR-012）。
 *
 * 机制不是「过滤掉看起来像密钥的字符串」（F228 已实测：内容启发式必被改写绕过），
 * 而是**值级 typed schema + 全通道模板化构造**：每个 details 键映射到一个受约束类型，
 * `createCheck` 是唯一构造出口，`summary` / `remediation` 只能来自固定模板表，
 * 顶层错误只输出 `errorClass` 枚举。因此凭据在结构上没有可承载的字段。
 *
 * 覆盖：11 个注入点 × 5 个输出通道 × 4 种编码 × 2 个 canary
 * （明文 canary + commit 形状的十六进制 canary —— 后者攻击的是受限语法的**允许域内部**）。
 *
 * 运行：npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE_PATH = path.join(repoRoot, 'plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs');
const IO_PATH = path.join(repoRoot, 'plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs');
const CLI_PATH = path.join(repoRoot, 'plugins/spec-driver/scripts/codex-runtime-doctor.mjs');
// F275 / T016：新增独立探针 helper，纳入结构性静态守卫的扫描集（不允许游离在外）
const PROBE_HELPER_PATH = path.join(repoRoot, 'plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs');

const core = await import(new URL('../../plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs', import.meta.url).href);
const io = await import(new URL('../../plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs', import.meta.url).href);
// F275 / T019：helper 层行为性 canary 测试的消费方——只用 `readAppServerResponse`/
// `deriveResult` 两个纯函数，不调用 `main()`（它恒 `process.exit(0)`，会杀掉测试进程）。
const probeHelper = await import(
  new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs', import.meta.url).href
);

/** canary 刻意含 `/` 与 `+`，使 URL-encoded / base64 形态与明文可区分 */
const CANARY = 'F240CANARY/sk-live+9a8b7c6d5e4f3a2b1c0d';

/**
 * 🔴 C1 canary：31 位十六进制串。
 *
 * 它与一个 git commit SHA **在语法上完全同构** —— 符合受限版本行的 commit 后缀
 * 语法 `\([0-9a-f]{7,40}\)`。长度取 31 是刻意的：`spectra v4.4.0 (<31>)` 恰好 48 字符，
 * 正好卡在受限版本行的长度上限之内 —— 否则会被长度检查挡下，测的就不是允许域内部
 * 而是长度上限了（那等于又一次「其实没攻击到」）。
 *
 * 上一版 canary 全由 `/`、`+`、大写字母构成，天生匹配不上版本行语法，于是 allowlist
 * 的**允许域内部**从未被攻击过。语法能证明「这串东西形状像 commit」，但证明不了
 * 「它不是凭据」—— 所以正确的修法不是收紧语法，而是让报告里根本没有字段能承载它。
 */
const HEX_CANARY = 'cafebabedeadbeeffeedface0123456';

/**
 * 🔴 F265 C1 canary：**40 位**十六进制串 —— 与一个完整 git SHA 逐字符同构。
 *
 * F265 给 doctor 加了 commit 维度，于是新增了三个持有 commit 原串的地方
 * （`git rev-parse HEAD` 的 stdout、版本行的后缀、MCP 自省回传的 `commit`）。
 * 「这串东西是 commit 不是密钥」在语法上依然证明不了，所以防线仍然只能是
 * 「报告里没有字段能承载它」：比对只在读取函数的局部作用域内发生，
 * 跨出去的只有 `match|mismatch|absent|unreadable` 四个字面量。
 * 取 40 位（而非 HEX_CANARY 的 31 位）是因为真实 SHA 就是 40 位，
 * 且它会**超出**受限版本行 48 字符上限——正好逼出「版本行走拒绝分支时，
 * 另外两个通道（git / MCP）有没有把它带出来」这条此前不存在的路径。
 */
const HEX40_CANARY = 'deadbeefcafebabefeedface0123456789abcdef';

function encodedForms(value: string): Record<string, string> {
  return {
    plain: value,
    base64: Buffer.from(value, 'utf-8').toString('base64'),
    'url-encoded': encodeURIComponent(value),
    'json-unicode-escaped': [...value]
      .map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join(''),
  };
}

const FORMS = encodedForms(CANARY);
const HEX_FORMS = encodedForms(HEX_CANARY);
const HEX40_FORMS = encodedForms(HEX40_CANARY);

/**
 * 断言两个 canary 的四种编码形式在给定通道文本中均不出现。
 * 两个 canary 对所有注入点一起断言：hex canary 在非 4/11 号注入点本就不该出现，
 * 多断一次零成本，却能挡住「某个分支顺手把版本行原文抄进去」这类回归。
 */
function assertNoCanary(channel: string, text: string) {
  for (const [encoding, form] of Object.entries(FORMS)) {
    expect(text.includes(form), `通道 ${channel} 泄漏了 canary（编码：${encoding}）`).toBe(false);
  }
  for (const [encoding, form] of Object.entries(HEX_FORMS)) {
    expect(text.includes(form), `通道 ${channel} 泄漏了 hex canary（编码：${encoding}）`).toBe(false);
  }
  for (const [encoding, form] of Object.entries(HEX40_FORMS)) {
    expect(text.includes(form), `通道 ${channel} 泄漏了 40 位 hex canary（编码：${encoding}）`).toBe(false);
  }
}

/** MCP 自省成功响应的 NDJSON（第 2 行即 `tools/call` 的结果） */
function mcpIntrospectionStdout(commit: string): string {
  const payload = JSON.stringify({ version: '4.4.0', commit, dirty: false });
  return [
    JSON.stringify({ result: { protocolVersion: '2025-06-18', capabilities: {} }, jsonrpc: '2.0', id: 1 }),
    JSON.stringify({ result: { content: [{ type: 'text', text: payload }] }, jsonrpc: '2.0', id: 2 }),
    '',
  ].join('\n');
}

/**
 * 同一注入点的 in-process（`exec`）与子进程（PATH 上的真脚本）两种表达，必须等价 ——
 * 否则第五通道等于没覆盖到该注入点。
 * `cat >/dev/null` 是必须的：doctor 会往 stdin 喂 JSON-RPC 请求，脚本不读就会 EPIPE。
 */
function commitCanaryBinScripts(commit: string): Record<string, string> {
  return {
    git: `#!/bin/sh\necho ${commit}\n`,
    spectra: [
      '#!/bin/sh',
      'if [ "$1" = "mcp-server" ]; then',
      '  cat >/dev/null',
      `  echo '${mcpIntrospectionStdout(commit).trim()}'`,
      '  exit 0',
      'fi',
      `echo "spectra v4.4.0 (${commit.slice(0, 7)})"`,
      '',
    ].join('\n'),
  };
}

interface Fixture {
  base: string;
  projectRoot: string;
  codexHome: string;
  binDir: string;
  env: Record<string, string | undefined>;
  exec: (file: string, args?: string[]) => string;
}

/** 默认 exec：一律 ENOENT（不依赖本机是否装 Codex / Spectra） */
function enoentExec(): never {
  const err: NodeJS.ErrnoException = new Error('spawn ENOENT');
  err.code = 'ENOENT';
  throw err;
}

interface FixtureOverrides {
  env?: Record<string, string | undefined>;
  exec?: Fixture['exec'];
  dirName?: string;
  contract?: string;
  /**
   * 供 **CLI 子进程通道**使用的假可执行文件（脚本正文）。
   * in-process 通道靠注入 `exec`，子进程通道注入不进去 —— 只能在 PATH 上摆一个真的
   * 可执行文件。二者必须表达同一个注入点，否则第五通道等于没覆盖到该注入点。
   */
  binScripts?: Record<string, string>;
}

function baseFixture(overrides: FixtureOverrides = {}): Fixture {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-redact-'));
  const projectRoot = path.join(base, overrides.dirName ?? 'repo');
  const codexHome = path.join(base, 'codex-home');
  const binDir = path.join(base, 'bin');
  fs.mkdirSync(path.join(projectRoot, 'contracts'), { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'contracts', 'release-contract.yaml'),
    overrides.contract ??
      ['schemaVersion: 1', 'products:', '  spectra:', '    version: "4.4.0"', '  spec-driver:', '    version: "4.4.0"', ''].join('\n'),
  );
  for (const [name, body] of Object.entries(overrides.binScripts ?? {})) {
    const file = path.join(binDir, name);
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
  }
  return {
    base,
    projectRoot,
    codexHome,
    binDir,
    env: overrides.env ?? {},
    exec: overrides.exec ?? (enoentExec as unknown as Fixture['exec']),
  };
}

/** 第五通道：真跑 CLI 子进程，收 stdout + stderr（json 与 text 两种渲染都收） */
function cliChannel(fx: Fixture): string {
  const env: Record<string, string> = {
    PATH: `${fx.binDir}:/bin:/usr/bin`,
    HOME: fx.base,
    CODEX_HOME: fx.codexHome,
  };
  for (const [key, value] of Object.entries(fx.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  const once = (args: string[]): string => {
    try {
      return execFileSync(process.execPath, [CLI_PATH, '--project-root', fx.projectRoot, ...args], {
        encoding: 'utf-8',
        env,
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
  };
  return `${once(['--format', 'json'])}\n${once(['--format', 'text'])}`;
}

/**
 * 跑一次诊断并把**全部五个输出通道**摊平为 { 通道名: 文本 }。
 *
 * 🔴 W4：此前 CLI 通道只在单独一个用例里查一次，于是「9 注入点 × 5 通道」实际只跑到
 * 9 × 4。现在每个注入点都真跑一遍 CLI 子进程，五通道由同一个断言循环统一覆盖。
 */
function channelsOf(fx: Fixture): Record<string, string> {
  const report = io.runDoctor({
    projectRoot: fx.projectRoot,
    codexHome: fx.codexHome,
    env: fx.env,
    exec: fx.exec,
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
  const statuses = Object.values<{ status: string }>(report.checks).map((c) => c.status);
  const channels: Record<string, string> = {
    json: JSON.stringify(report),
    text: core.formatTextReport(report),
  };
  // 「错误分支」与「indeterminate 分支」不是独立渲染器，而是同一批 check 的不同状态；
  // 这里显式挑出这两类 check 单独序列化，保证断言确实作用在这两条分支的产物上。
  const failing = Object.values<{ status: string }>(report.checks).filter(
    (c) => c.status === 'fail' || c.status === 'warning',
  );
  const indeterminate = Object.values<{ status: string }>(report.checks).filter(
    (c) => c.status === 'indeterminate',
  );
  channels['error-branch'] = JSON.stringify(failing);
  channels['indeterminate-branch'] = JSON.stringify(indeterminate);
  channels['cli-subprocess'] = cliChannel(fx);
  // 断言这两条分支确实被走到（否则断言等于空跑）
  expect(statuses.some((s) => s === 'indeterminate' || s === 'warning' || s === 'fail')).toBe(true);
  return channels;
}

describe('F240 T047 — canary 十一注入点 × 五通道 × 四编码（SC-014）', () => {
  const cases: Array<{ name: string; make: () => Fixture }> = [
    {
      name: '注入点 1：$CODEX_HOME/config.toml 的 mcp_servers api_key',
      make: () => {
        const fx = baseFixture();
        fs.writeFileSync(
          path.join(fx.codexHome, 'config.toml'),
          [`[mcp_servers.canary]`, `api_key = "${CANARY}"`, '', '[plugins."spectra@some-market"]', 'enabled = true', ''].join('\n'),
        );
        fs.writeFileSync(path.join(fx.codexHome, 'hooks.json'), '{"Stop":[]}');
        return fx;
      },
    },
    {
      name: '注入点 2：$CODEX_HOME/auth.json 凭据',
      make: () => {
        const fx = baseFixture();
        fs.writeFileSync(path.join(fx.codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: CANARY }));
        return fx;
      },
    },
    {
      name: '注入点 3：环境变量',
      make: () =>
        baseFixture({
          env: { SOME_TOKEN: CANARY, CODEX_HOME: undefined, ANOTHER_SECRET: CANARY },
        }),
    },
    {
      name: '注入点 4：子进程 stdout',
      make: () =>
        baseFixture({
          exec: ((file: string) => {
            if (file === 'spectra') return `spectra v4.4.0 (0ae3eb7) ${CANARY}\n`;
            return enoentExec();
          }) as Fixture['exec'],
          binScripts: { spectra: `#!/bin/sh\necho "spectra v4.4.0 (0ae3eb7) ${CANARY}"\n` },
        }),
    },
    {
      name: '注入点 5：子进程 stderr（非零退出）',
      make: () =>
        baseFixture({
          exec: ((file: string) => {
            if (file === 'spectra') {
              throw Object.assign(new Error(`failed: ${CANARY}`), {
                status: 2,
                stdout: '',
                stderr: `volta error ${CANARY}\n`,
              });
            }
            return enoentExec();
          }) as Fixture['exec'],
          binScripts: { spectra: `#!/bin/sh\necho "volta error ${CANARY}" >&2\nexit 2\n` },
        }),
    },
    {
      /**
       * 🔴 W4：本用例**只**注入 app-server RPC 错误，不再兼任「嵌套 probe 失败」。
       * 两者的代码路径不同（前者是 runCommand 的 catch，后者是 collectPluginBuildProbes
       * 内部的解析失败），一个用例兼任等于其中一条从未被单独证明过。
       */
      name: '注入点 6：app-server RPC 错误对象（仅 RPC 路径）',
      make: () =>
        baseFixture({
          exec: ((file: string, args?: string[]) => {
            if (file === 'codex' && (args ?? []).includes('app-server')) {
              throw Object.assign(new Error(`rpc failure ${CANARY}`), {
                status: 1,
                stdout: `{"error":{"message":"${CANARY}"}}`,
                stderr: CANARY,
              });
            }
            return enoentExec();
          }) as Fixture['exec'],
          binScripts: {
            codex: [
              '#!/bin/sh',
              'if [ "$2" = "app-server" ]; then',
              `  echo '{"error":{"message":"${CANARY}"}}'`,
              `  echo "${CANARY}" >&2`,
              '  exit 1',
              'fi',
              'exit 127',
              '',
            ].join('\n'),
          },
        }),
    },
    {
      name: '注入点 7：文件读取失败（错误对象 path 含 canary）',
      make: () => {
        // projectRoot 目录名本身含 canary → fs 错误对象的 `path` 必然携带它
        const fx = baseFixture({ dirName: `repo-${CANARY.replace(/[/+]/g, '_')}` });
        fs.rmSync(path.join(fx.projectRoot, 'contracts', 'release-contract.yaml'));
        // 同时把明文 canary 放进 codexHome 路径不可读的场景
        return fx;
      },
    },
    {
      name: '注入点 8：release-contract.yaml 畸形字段值含 canary',
      make: () =>
        baseFixture({
          contract: [
            'schemaVersion: 1',
            'products:',
            '  spectra:',
            `    version: "${CANARY}"`,
            '  spec-driver:',
            `    version: "${CANARY}"`,
            '',
          ].join('\n'),
        }),
    },
    {
      name: '注入点 9：$CODEX_HOME/hooks.json 第三方条目 command 含 canary',
      make: () => {
        const fx = baseFixture();
        fs.writeFileSync(
          path.join(fx.codexHome, 'hooks.json'),
          JSON.stringify({
            PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `bash /opt/x.sh --key ${CANARY}` }] }],
          }),
        );
        return fx;
      },
    },
    {
      /**
       * 🔴 W4：与注入点 6 分离的**嵌套 probe 失败**路径 —— 探针内部读到了一个畸形
       * 的快照 manifest（内容含 canary），失败发生在 `collectPluginBuildProbes`
       * 里面而不是子进程调用处。
       */
      name: '注入点 10：嵌套 probe 失败（快照 manifest 畸形 JSON 含 canary）',
      make: () => {
        const fx = baseFixture();
        fs.writeFileSync(
          path.join(fx.codexHome, 'config.toml'),
          '[plugins."spectra@some-market"]\nenabled = true\n',
        );
        const snapshotDir = path.join(
          fx.codexHome,
          'plugins',
          'cache',
          'some-market',
          'spectra',
          'aaaa1111',
          '.codex-plugin',
        );
        fs.mkdirSync(snapshotDir, { recursive: true });
        // 故意畸形：JSON.parse 抛错时错误对象与原文都不得进入报告
        fs.writeFileSync(path.join(snapshotDir, 'plugin.json'), `{"version": "${CANARY}`);
        return fx;
      },
    },
    {
      /**
       * 🔴 C1 的核心回归：canary 本身就是一个**语法允许域内部**的 40 位十六进制串。
       * 它完全符合受限版本行的 commit 后缀语法与 48 字符上限，此前会原样进入
       * `details.versionLine`。原 canary 含 `/` 与 `+`，天然不匹配版本行语法，
       * 因此从未攻击过 allowlist 允许域内部 —— 这个洞由本用例补上。
       */
      name: '注入点 11：commit 形状的十六进制凭据（语法允许域内部）',
      make: () =>
        baseFixture({
          exec: ((file: string) => {
            if (file === 'spectra') return `spectra v4.4.0 (${HEX_CANARY})\n`;
            return enoentExec();
          }) as Fixture['exec'],
          binScripts: { spectra: `#!/bin/sh\necho "spectra v4.4.0 (${HEX_CANARY})"\n` },
        }),
    },
    {
      /**
       * 🔴 F265 注入点：commit 维度的**三个**新原串持有点一次性全打
       * —— `git rev-parse HEAD`（比对基准）、版本行后缀、MCP 自省回传的 `commit`。
       * 三处同喂一个 40 位 hex 凭据形状的串，比对结论会正常算出来（见下方正面用例），
       * 但报告的五个通道里都不该出现它本身。
       */
      name: '注入点 12：commit 维度三处原串（git HEAD / 版本行后缀 / MCP 自省）',
      make: () =>
        baseFixture({
          exec: ((file: string, args?: string[]) => {
            if (file === 'git') return `${HEX40_CANARY}\n`;
            if (file === 'spectra' && (args ?? [])[0] === 'mcp-server') {
              return mcpIntrospectionStdout(HEX40_CANARY);
            }
            if (file === 'spectra') return `spectra v4.4.0 (${HEX40_CANARY.slice(0, 7)})\n`;
            return enoentExec();
          }) as Fixture['exec'],
          binScripts: commitCanaryBinScripts(HEX40_CANARY),
        }),
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} — 五通道四编码双 canary 均无泄漏`, () => {
      const fx = testCase.make();
      const channels = channelsOf(fx);
      for (const [name, text] of Object.entries(channels)) {
        assertNoCanary(name, text);
      }
      // 结构性附加断言：绝对路径（含用户名的家目录形态）不得出现
      expect(channels.json.includes(fx.codexHome)).toBe(false);
      expect(channels.json.includes(fx.projectRoot)).toBe(false);
    });
  }

  /**
   * 🔴 「没泄漏」有两种可能：(a) 值被结构性丢弃；(b) 输入压根没被接受，于是走了拒绝分支。
   * 只有 (a) 才证明 C1 被真正修好。本用例正面断言我们确实落在 allowlist 允许域内部：
   * 版本行**被接受了**（status=ok、semver 读出来了、commit 后缀被识别到了），
   * 而 commit 的值本身依然不在报告里。
   */
  it('注入点 11 确实命中 allowlist 允许域内部：版本行被接受，但 commit 值仍不出现', () => {
    const line = `spectra v4.4.0 (${HEX_CANARY})`;
    // 前置证明：这一行完全符合受限语法且未触长度上限（否则本用例等于空跑）
    expect(core.constrainVersionLine(line)).toBe(line);
    expect(line.length).toBeLessThanOrEqual(48);

    const fx = baseFixture({
      exec: ((file: string) => {
        if (file === 'spectra') return `${line}\n`;
        return enoentExec();
      }) as Fixture['exec'],
    });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: fx.exec,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const check = report.checks['global-cli.spectra'];
    expect(check.status).toBe('ok');
    expect(check.details.semver).toBe('4.4.0');
    expect(check.details.commitSuffixPresent).toBe(true);
    expect(check.details.hadVPrefix).toBe(true);
    // 承载原文的字段已从 schema 中整体移除
    expect('versionLine' in check.details).toBe(false);
    assertNoCanary('hex-allowlist-json', JSON.stringify(report));
    assertNoCanary('hex-allowlist-text', core.formatTextReport(report));
  });

  /**
   * 🔴 与注入点 11 同款的"非空跑"证明，针对 F265 的 commit 维度。
   *
   * 「报告里没有那串 hex」有两种成因：(a) 值被结构性丢弃；(b) 比对压根没跑起来
   * （探测失败 ⇒ 全 absent ⇒ 断言自动成立）。只有 (a) 才算证明。本用例正面断言
   * 比对**确实发生了**：三方各自读到了那个 40 位串并算出 `match`，
   * 而串本身在五个通道里一次都不出现。
   */
  it('注入点 12 确实跑到了比对：三方均算出 match，但 40 位 commit 原串一次都不出现', () => {
    const fx = baseFixture({
      exec: ((file: string, args?: string[]) => {
        if (file === 'git') return `${HEX40_CANARY}\n`;
        if (file === 'spectra' && (args ?? [])[0] === 'mcp-server') {
          return mcpIntrospectionStdout(HEX40_CANARY);
        }
        if (file === 'spectra') return `spectra v4.4.0 (${HEX40_CANARY.slice(0, 7)})\n`;
        return enoentExec();
      }) as Fixture['exec'],
    });
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: {},
      exec: fx.exec,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });

    // 三方都真的比过了（否则本用例等于空跑）
    // repo-version 侧登记的是"基准立没立得住"（I-1 后不再是自比出来的 match）
    expect(report.checks['repo-version.spectra'].details.baselineCommit).toBe('available');
    expect(report.checks['global-cli.spectra'].details.commitComparison).toBe('match');
    expect(report.checks['mcp-server.spectra'].details.commitComparison).toBe('match');
    expect(report.checks['mcp-server.spectra'].status).toBe('ok');
    // 🔴 plugin-build 恒 absent：该方 manifest 里根本没有 commit 字段，
    // 快照目录哈希不是 build 标识（F236），如实说"没有"好过拿代理值冒充
    expect(report.checks['plugin-build.spectra'].details.commitComparison).toBe('absent');
    expect(report.checks['plugin-build.spec-driver'].details.commitComparison).toBe('absent');

    // 而 40 位串本身在两个渲染通道里一次都不出现
    assertNoCanary('commit-dimension-json', JSON.stringify(report));
    assertNoCanary('commit-dimension-text', core.formatTextReport(report));
  });

  it('第五通道：CLI 顶层错误输出同样不泄漏（参数非法路径含 canary）', () => {
    let stderrText = '';
    let status = 0;
    try {
      execFileSync(process.execPath, [CLI_PATH, '--project-root', `/nonexistent/${CANARY}`, '--format', 'json'], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: path.dirname(process.execPath), SOME_TOKEN: CANARY },
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: string; stdout?: string };
      status = e.status ?? 0;
      stderrText = `${e.stderr ?? ''}${e.stdout ?? ''}`;
    }
    assertNoCanary('cli-top-level-error', stderrText);
    expect([0, 1, 2]).toContain(status);
  });

  it('CLI 未知参数（含 canary）时顶层错误只给固定模板，不回显 argv', () => {
    let combined = '';
    try {
      execFileSync(process.execPath, [CLI_PATH, `--${CANARY}`], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: path.dirname(process.execPath) },
      });
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; status?: number };
      combined = `${e.stderr ?? ''}${e.stdout ?? ''}`;
      expect(e.status).toBe(2);
    }
    assertNoCanary('cli-unknown-arg', combined);
  });
});

/** 粗剥 JS 注释：静态守卫要判的是「代码里有没有这么写」，不是「注释里提没提」 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('F240 T047 — 结构性静态守卫（禁止内容启发式 / 禁止保存原始输出）', () => {
  const sources = {
    core: fs.readFileSync(CORE_PATH, 'utf-8'),
    io: fs.readFileSync(IO_PATH, 'utf-8'),
    cli: fs.readFileSync(CLI_PATH, 'utf-8'),
    // F275 / T016：独立探针 helper——它确实有一处必须触碰原始子进程输出流的代码
    // （见 `withoutDeclaredRawIoSite` 与「RAW-IO-SITE 标记对唯一性」用例），但仍须被
    // 纳入本文件全部既有结构性静态守卫（DETAILS_SCHEMA / err.message-stack / 密钥
    // 特征正则 / 裸 NUL 字节等），不允许游离在扫描范围之外。
    probeHelper: fs.readFileSync(PROBE_HELPER_PATH, 'utf-8'),
  };

  it('DETAILS_SCHEMA 常量存在、被冻结，且被 createCheck 强制应用', () => {
    expect(core.DETAILS_SCHEMA).toBeTruthy();
    expect(Object.isFrozen(core.DETAILS_SCHEMA)).toBe(true);
    expect(Object.keys(core.DETAILS_SCHEMA).sort()).toEqual(
      ['global-cli', 'hook-trust', 'mcp-server', 'plugin-build', 'repo-version'].sort(),
    );
    // 静态信号：源码中 createCheck 必须调用 sanitizeDetails（保留，但它**不是**主判据）
    const createCheckBody = sources.core.slice(sources.core.indexOf('export function createCheck'));
    expect(createCheckBody.includes('sanitizeDetails(')).toBe(true);
  });

  /**
   * 🔴 W4：上面那条静态检查只证明源码里出现过 `sanitizeDetails(` 这串字符 ——
   * 留一句死引用就能骗过它。唯一出口是**行为性质**，必须用行为断言。
   */
  it('createCheck 行为性守卫：未登记键与越界值一律无法透传（不依赖源码文本）', () => {
    const check = core.createCheck({
      id: 'guard.global-cli',
      category: 'global-cli',
      product: 'spectra',
      status: 'ok',
      summaryCode: 'global-cli-match',
      summaryParams: { product: 'spectra', semver: '4.4.0' },
      details: {
        binaryName: 'spectra',
        semver: '4.4.0',
        // 未登记键（含直接塞凭据的两种写法）
        leakedSecret: CANARY,
        versionLine: `spectra v4.4.0 (${HEX_CANARY})`,
        rawOutput: `spectra v4.4.0 (0ae3eb7) ${CANARY}`,
        // 已登记键但值越界
        rawShape: 'made-up-shape',
        exitCode: 9999,
        errorClass: CANARY,
      },
      remediationCode: null,
    });
    expect(Object.keys(check.details).sort()).toEqual(['binaryName', 'errorClass', 'semver']);
    // 越界的 errorClass 被丢弃后由漏斗补成固定枚举，而不是原样透传
    expect(core.ERROR_CLASSES).toContain(check.details.errorClass);
    assertNoCanary('createCheck-details', JSON.stringify(check));

    // 未登记的 category 与越界 summaryParams 一律构造失败，不静默降级
    expect(() => core.createCheck({ id: 'x', category: 'made-up', status: 'ok', summaryCode: 'global-cli-match' })).toThrow();
    expect(() =>
      core.createCheck({
        id: 'x',
        category: 'global-cli',
        product: 'spectra',
        status: 'ok',
        summaryCode: 'global-cli-match',
        summaryParams: { product: 'spectra', semver: CANARY },
      }),
    ).toThrow();
  });

  /**
   * 🔴 W5：源码里的裸 NUL 字节会让 git 把整个文件判为 binary，
   * `git diff` 退化成「Binary files differ」，文本审查与 grep 类门禁对该文件全部失明。
   * 门禁范围取 `plugins/spec-driver/scripts` 下**全部** `.mjs`：这类字节几乎总是
   * 「随手当分隔符敲进去」的产物，按目录扫比逐文件登记更抗遗漏。
   */
  it('plugins/spec-driver/scripts 下全部 .mjs 源文件不含裸 NUL 字节', () => {
    const scriptsRoot = path.join(repoRoot, 'plugins/spec-driver/scripts');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(abs);
      }
    };
    walk(scriptsRoot);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => fs.readFileSync(file).includes(0));
    expect(offenders.map((file) => path.relative(repoRoot, file))).toEqual([]);
  });

  it('不复用 secret-redactor（内容启发式黑名单），且实现中不存在密钥特征正则', () => {
    for (const [name, text] of Object.entries(sources)) {
      // 判据是「不 import」而非「不提及」—— plan §8.7 明确要求把「为何不复用」写进
      // core 模块头注释，因此文本层面的提及是**规定动作**，不能当成违规信号。
      expect(/(?:from|require\s*\()\s*['"][^'"]*secret-redactor/.test(text), `${name} 不应 import secret-redactor`).toBe(
        false,
      );
      // 内容特征黑名单的典型标志：熵计算 / 密钥关键字正则。
      // 只扫**可执行代码**（剥掉注释）——注释里说明「为何不用熵启发式」是规定动作。
      const code = stripComments(text);
      expect(/shannon|entropy/i.test(code), `${name} 不应含熵启发式`).toBe(false);
      expect(/\/[^/\n]*(api[_-]?key|password|secret|bearer)[^/\n]*\/[gimsuy]*/i.test(code), `${name} 不应含密钥特征正则`).toBe(
        false,
      );
    }
  });

  it('源码中 err.message / err.stack 零命中（顶层错误只输出 errorClass 枚举）', () => {
    for (const [name, text] of Object.entries(sources)) {
      expect(text.includes('.message'), `${name} 不得读取 error.message`).toBe(false);
      expect(text.includes('.stack'), `${name} 不得读取 error.stack`).toBe(false);
    }
  });

  /** 剥掉本进程自己的 `process.stdout` / `process.stderr`（那是输出通道，不是被诊断对象的原始输出） */
  function withoutOwnStdio(text: string): string {
    return text.replace(/process\.(stdout|stderr)/g, 'process.OWN_STREAM');
  }

  /**
   * F275 / T017（硬约束 6b）：剥掉 `codex-hooks-list-probe.mjs` 里被一对全文件唯一的
   * 标记注释包裹的代码块——与 `withoutOwnStdio()` 剥离 `process.stdout`/`process.stderr`
   * 的手法同构，只是豁免范围从"一个固定字面量"换成"一段被显式标记包裹、经下方独立
   * 用例保证只出现一次的代码块"。**仅**对 `sources.probeHelper` 应用；`core`/`io`/`cli`
   * 三个来源继续保持零豁免（不调用本函数）。
   */
  function withoutDeclaredRawIoSite(text: string): string {
    return text.replace(/\/\* RAW-IO-SITE-BEGIN \*\/[\s\S]*?\/\* RAW-IO-SITE-END \*\//, '');
  }

  it('`.stdout` / `.stderr` 从不出现在 createCheck 实参 / summary 赋值 / JSON.stringify 参数位置', () => {
    const forbiddenContexts = ['createCheck(', 'summary', 'JSON.stringify('];
    for (const [name, text] of Object.entries(sources)) {
      for (const [index, line] of withoutOwnStdio(text).split('\n').entries()) {
        const touchesRaw = line.includes('.stdout') || line.includes('.stderr');
        if (!touchesRaw) continue;
        for (const ctx of forbiddenContexts) {
          expect(line.includes(ctx), `${name}:${index + 1} 把原始输出带进了 ${ctx}`).toBe(false);
        }
      }
    }
  });

  it('三层实现全都不读取被诊断进程的 stdout / stderr 属性（结构性防线）', () => {
    for (const [name, text] of Object.entries(sources)) {
      // 🔴 只有 probeHelper 经过 RAW-IO-SITE 剥离；core/io/cli 三个来源继续零豁免，
      // 不得新增任何豁免分支（这是本用例本身的护栏，不是本卡要放宽的对象）。
      const stripped =
        name === 'probeHelper' ? withoutDeclaredRawIoSite(withoutOwnStdio(text)) : withoutOwnStdio(text);
      expect(stripped.includes('.stdout'), `${name} 不得读取子进程 stdout 属性`).toBe(false);
      expect(stripped.includes('.stderr'), `${name} 不得读取子进程 stderr 属性`).toBe(false);
    }
  });

  it('RAW-IO-SITE 标记对在 probeHelper 中严格出现且仅出现一次（防止豁免范围被悄悄扩大）', () => {
    const beginCount = (sources.probeHelper.match(/RAW-IO-SITE-BEGIN/g) ?? []).length;
    const endCount = (sources.probeHelper.match(/RAW-IO-SITE-END/g) ?? []).length;
    expect(beginCount).toBe(1);
    expect(endCount).toBe(1);
  });

  /**
   * 🔴 C1 的结构性不变量：报告 schema 里**不存在**任何「可承载子进程原文」的类型。
   * 值级 typed schema 的全部说服力都建立在这一点上 —— 只要有一个字段的类型是
   * 「一段通过了某个语法检查的原始字符串」，凭据就有了落脚点（版本行的 commit 后缀
   * 与十六进制凭据同构，正是这样被击穿的）。
   */
  it('DETAILS_SCHEMA 的值类型全部来自受限类型白名单，无自由文本承载类型', () => {
    const ALLOWED_TYPES = ['enum', 'semver', 'boundedInt', 'scopedRelPath', 'boolean', 'probeList'];
    for (const [category, schema] of Object.entries<Record<string, string>>(core.DETAILS_SCHEMA)) {
      for (const [key, type] of Object.entries(schema)) {
        expect(ALLOWED_TYPES, `${category}.${key} 使用了未登记的值类型 ${type}`).toContain(type);
      }
    }
    // 具名回归：曾经承载版本行原文的键必须已从全部 category 中消失
    for (const schema of Object.values<Record<string, string>>(core.DETAILS_SCHEMA)) {
      expect('versionLine' in schema).toBe(false);
    }
  });

  it('受限类型：constrainVersionLine 对超出语法的输入一律置 null', () => {
    expect(core.constrainVersionLine('spectra v4.4.0 (0ae3eb7)')).toBe('spectra v4.4.0 (0ae3eb7)');
    expect(core.constrainVersionLine('4.4.0')).toBe('4.4.0');
    expect(core.constrainVersionLine(`spectra v4.4.0 (0ae3eb7) ${CANARY}`)).toBeNull();
    expect(core.constrainVersionLine(CANARY)).toBeNull();
    // 纯字符白名单不足以拦截 canary（它全是 [A-Za-z0-9-]），必须是完整语法约束
    expect(core.constrainVersionLine('F240CANARY-3f9a2c7e1b4d4a8e9c2f6d5e8a1b3c7f')).toBeNull();
  });

  it('受限类型：toScopedRelPath 对已知根之外的路径返回固定枚举值', () => {
    const roots = { projectRoot: '/tmp/repo', codexHome: '/tmp/codex' };
    expect(core.toScopedRelPath('/tmp/repo/contracts/release-contract.yaml', roots)).toBe(
      'contracts/release-contract.yaml',
    );
    expect(core.toScopedRelPath('/etc/passwd', roots)).toBe('outside-known-roots');
    expect(core.toScopedRelPath(`/tmp/repo/${CANARY}`, roots)).toBe('outside-known-roots');
    expect(core.toScopedRelPath(null, roots)).toBe('outside-known-roots');
  });

  /**
   * F275 对抗审查后新增（D4）：`managed`/`untrusted`/`trusted`/`modified` 四值闭集在
   * core（`NATIVE_TRUST_VALUE_SET`）、io（`RAW_NATIVE_TRUST_VALUES`）、helper
   * （`NATIVE_TRUST_VALUES`）三处各自维护一份字面量数组。三份漂移的后果是某一层悄悄
   * 放行 / 拒绝一个其余两层不认的值（如新增第 5 个值时漏改一处）。把隐性同步契约变成
   * 一条会红的测试（质量 W-2）。
   */
  it('四值闭集(managed/untrusted/trusted/modified)字面量数组在 core/io/helper 三处逐字一致', () => {
    const TRUST_SET_LITERAL_RE = /\[\s*'managed'\s*,\s*'untrusted'\s*,\s*'trusted'\s*,\s*'modified'\s*\]/;
    const extract = (text: string): string | null => {
      const m = text.match(TRUST_SET_LITERAL_RE);
      return m ? m[0].replace(/\s+/g, '') : null;
    };
    const coreLiteral = extract(sources.core);
    const ioLiteral = extract(sources.io);
    const helperLiteral = extract(sources.probeHelper);
    expect(coreLiteral, 'core.mjs 未找到四值闭集字面量数组').not.toBeNull();
    expect(ioLiteral, 'io.mjs 的四值闭集字面量数组与 core.mjs 不一致').toBe(coreLiteral);
    expect(helperLiteral, 'helper 的四值闭集字面量数组与 core.mjs 不一致').toBe(coreLiteral);
  });
});

describe('F275 T018（硬约束 6c）— io 层对 hooks-list-probe helper 输出的防御性二次校验', () => {
  /**
   * 伪造 `process.execPath` 调用返回一个"看起来合法但夹带额外字段"的 JSON——
   * `probeAppServerHooksList` 的 allowlist 只读 `outcome`/`errorClass`/`entries` 三键，
   * 任何多余字段（哪怕命中 own-entry 判据用到的 `sourcePath`/`pluginId`/`command`）都
   * 不得被放行，更不得出现在 `check.details`/序列化报告的任何输出通道里。
   */
  it('helper 输出夹带额外字段（sourcePath / pluginId / command 含 canary）→ 不进入任何输出通道', () => {
    const fx = baseFixture({
      exec: ((file: string) => {
        if (file === process.execPath) {
          return JSON.stringify({
            outcome: 'found',
            errorClass: null,
            entries: ['trusted', 'untrusted'],
            // 夹带的额外字段：allowlist 之外，必须被丢弃
            sourcePath: CANARY,
            pluginId: CANARY,
            command: CANARY,
            key: CANARY,
          });
        }
        return enoentExec();
      }) as Fixture['exec'],
    });
    // F275 对抗审查后新增前置门：无 `plugins` 目录 + 无 `hooksJson` 时会跳过 RPC 探测，
    // 注入的假 exec 就不会被调用。本用例要测的正是 io 层对 exec 返回值的防御性二次校验，
    // 必须先让前置门放行（造一个空的 `plugins` 目录即可，粒度与前置门判据一致）。
    fs.mkdirSync(path.join(fx.codexHome, 'plugins'), { recursive: true });
    const channels = channelsOf(fx);
    for (const [name, text] of Object.entries(channels)) {
      assertNoCanary(name, text);
      expect(text.includes('sourcePath'), `通道 ${name} 泄漏了额外字段名 sourcePath`).toBe(false);
      expect(text.includes('pluginId'), `通道 ${name} 泄漏了额外字段名 pluginId`).toBe(false);
    }
    // 行为面核对：allowlist 之外的字段确未影响 entries 聚合本身（untrusted 覆盖 trusted）
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: fx.env,
      exec: fx.exec,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(report.checks['hook-trust'].details.trustStatus).toBe('untrusted');
  });

  it('helper 输出 entries 数组里塞一个对象而非字符串 → io 层归约为 error/parse-failed，不泄漏', () => {
    const fx = baseFixture({
      exec: ((file: string) => {
        if (file === process.execPath) {
          return JSON.stringify({
            outcome: 'found',
            errorClass: null,
            entries: [{ trustStatus: 'trusted', sourcePath: CANARY }],
          });
        }
        return enoentExec();
      }) as Fixture['exec'],
    });
    // 同上：需先放行前置门，且本用例还需要插件 cache 证据把 tie-break 引向
    // indeterminate（否则终版矩阵行 6 会判 not-applicable，测不到 sanitize 逻辑本身）。
    fs.mkdirSync(path.join(fx.codexHome, 'plugins', 'cache', 'cc-plugin-market', 'spec-driver'), {
      recursive: true,
    });
    const channels = channelsOf(fx);
    for (const [name, text] of Object.entries(channels)) {
      assertNoCanary(name, text);
      expect(text.includes('sourcePath'), `通道 ${name} 泄漏了额外字段名 sourcePath`).toBe(false);
    }
    const report = io.runDoctor({
      projectRoot: fx.projectRoot,
      codexHome: fx.codexHome,
      env: fx.env,
      exec: fx.exec,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    expect(report.checks['hook-trust'].status).toBe('indeterminate');
    expect(report.checks['hook-trust'].summary).toBe(
      core.buildSummary('hook-trust-native-unreachable', { errorClass: 'parse-failed' }),
    );
  });
});

describe('F275 T019（硬约束 6d）— helper 层行为性 canary 测试（不依赖词法扫描的兜底）', () => {
  /**
   * 造一个最小的假 `codex app-server` 双工对象：不真的 spawn，只是一个 `EventEmitter`，
   * 挂 `stdout`（另一个 `EventEmitter`）、`stdin.write`（no-op）、`kill`（no-op）。
   * 收到 `readAppServerResponse` 写入的请求后，异步把伪造的 `hooks/list` 响应
   * （`{id:2, result: payload}`）当作一行 NDJSON 推给 `stdout` 的 `data` 事件。
   */
  function makeFakeSpawnFn(payload: unknown) {
    return () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: (data: string) => void };
        kill: (signal: string) => void;
      };
      child.stdout = new EventEmitter();
      child.stdin = { write: () => {} };
      child.kill = () => {};
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: 2, result: payload })}\n`));
      });
      return child as unknown as ReturnType<typeof import('node:child_process').spawn>;
    };
  }

  /**
   * 能被 `command` 判定为"我方"的条目（命中 F275 对抗审查后修订的 command 层判据）。
   *
   * 🔴 `source` 刻意用 `'user'` 而非 `'plugin'`：修订后 `source==='plugin'` 的条目只认
   * `pluginId`/`sourcePath` 两个结构化字段（假阴 C2 收口，第三方插件 command 提及我方
   * 路径不再被误认领），本用例的 `pluginId`/`sourcePath` 恰好是 canary 垃圾值、不构成
   * 合法归属证据，若仍标 `source:'plugin'` 会导致该条目整体不被认领（entries 变空），
   * 测不到本用例真正想测的东西——命令层判据命中后，垃圾自由文本字段是否泄漏。
   */
  function ownEntryWithCanaries(canary: string) {
    return {
      source: 'user',
      command:
        'bash /home/user/.codex/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh',
      trustStatus: 'untrusted',
      // 三个自由文本字段均嵌入 canary —— `deriveResult` MUST NOT 把它们写进返回值
      sourcePath: canary,
      pluginId: canary,
      key: canary,
    };
  }

  it.each([
    ['CANARY', CANARY, FORMS],
    ['HEX_CANARY', HEX_CANARY, HEX_FORMS],
    ['HEX40_CANARY', HEX40_CANARY, HEX40_FORMS],
  ])('%s 三种自由文本字段（sourcePath/pluginId/key）不出现在 helper 最终 JSON 的任何编码形式中', async (_label, canary, forms) => {
    const projectRoot = '/tmp/fake-project-root';
    const payload = { data: [{ cwd: projectRoot, hooks: [ownEntryWithCanaries(canary)] }] };
    const readerOutcome = await probeHelper.readAppServerResponse(makeFakeSpawnFn(payload), projectRoot, 1000);
    expect(readerOutcome.kind).toBe('ok');
    const result =
      readerOutcome.kind === 'ok' ? probeHelper.deriveResult(readerOutcome.response, projectRoot) : null;
    expect(result).toEqual({ outcome: 'found', errorClass: null, entries: ['untrusted'] });
    const finalJson = JSON.stringify(result);
    for (const [encoding, form] of Object.entries(forms as Record<string, string>)) {
      expect(finalJson.includes(form), `helper 最终 JSON 泄漏了 canary（编码：${encoding}）`).toBe(false);
    }
    // 行为性断言的核心：不是"字面没提到 canary"，而是结果里压根没有能承载它的字段
    expect(Object.keys(result as object).sort()).toEqual(['entries', 'errorClass', 'outcome']);
  });
});
