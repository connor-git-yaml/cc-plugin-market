/**
 * Feature 240 / T025 — Codex hooks 安装→校验→卸载全链路（FR-011 / FR-010 / SC-001 / SC-008）
 *
 * 与单测的分工：单测钉写入器的**语义**，本文件钉两个 CLI 与 `codex-skills.sh` 挂接点的
 * **端到端行为**（退出码合同、FR-010 提示、project/global 作用域、非法 JSON 的 fail-loud）。
 *
 * 🔴 每个用例都在隔离的临时 `CODEX_HOME` 下跑，**绝不触碰真实 `~/.codex`**。
 *
 * 运行：npx vitest run tests/integration/codex-hooks-install-flow.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN_ROOT = path.join(repoRoot, 'plugins', 'spec-driver');
const INSTALL_CLI = path.join(PLUGIN_ROOT, 'scripts', 'install-codex-hooks.mjs');
const VALIDATE_CLI = path.join(PLUGIN_ROOT, 'scripts', 'validate-codex-hooks.mjs');
const SKILLS_SH = path.join(PLUGIN_ROOT, 'scripts', 'codex-skills.sh');

/**
 * 本 feature 的**全部**生产文件（I1）。
 * 绕过 hook 信任那个 DANGEROUS flag 的守卫必须覆盖全集 —— 只守 3 个入口而放着 3 个 lib
 * 与 1 个 hook 脚本不管，等于给绕过留了 4 个没人看的门。
 */
const PRODUCTION_FILES = [
  INSTALL_CLI,
  VALIDATE_CLI,
  SKILLS_SH,
  path.join(PLUGIN_ROOT, 'scripts', 'lib', 'codex-hooks-generator.mjs'),
  path.join(PLUGIN_ROOT, 'scripts', 'lib', 'codex-hooks-installer.mjs'),
  path.join(PLUGIN_ROOT, 'scripts', 'lib', 'codex-hooks-schema.mjs'),
  path.join(PLUGIN_ROOT, 'hooks', 'stop-fix-compliance-check.sh'),
];

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ValidationReport {
  ok: boolean;
  status: string;
  ownedEvents: string[];
  findings: Array<{ level: string; layer?: string; code: string; command?: string }>;
  foreignPreservation: {
    checked: boolean;
    ok: boolean;
    projectionEqual: boolean;
    lostCommands: string[];
    removedByDeclaration: string[];
  };
}

/**
 * 🔴 用 `spawnSync` 而非 `execFileSync`：后者在**成功**路径上只返回 stdout，stderr 被丢弃。
 * 本文件多条断言恰恰针对退出码 0 时写到 stderr 的诊断与提示（W5 / I6），
 * 用 execFileSync 会把它们一律看成空串 —— 断言变成永真的摆设。
 */
function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): RunResult {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    timeout: 60_000,
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

const FOREIGN_DOC = {
  description: '用户自己的 hooks',
  hooks: {
    PermissionRequest: [
      { matcher: 'vendor', hooks: [{ type: 'command', command: 'bash /opt/vendor/permission.sh' }] },
    ],
    SomeFutureEvent: [
      { matcher: '', hooks: [{ type: 'command', command: 'bash /opt/vendor/future.sh' }] },
    ],
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'bash /opt/vendor/stop.sh' }] }],
  },
};

describe('Codex hooks 安装 / 校验 / 卸载全链路', () => {
  let codexHome: string;
  let target: string;
  let baseline: string;
  /** F262：本用例造出的"升级后插件根"沙箱，逐个回收 */
  let upgradedBases: string[] = [];

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-flow-home-'));
    target = path.join(codexHome, 'hooks.json');
    baseline = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'f240-flow-base-')), 'baseline.json');
    upgradedBases = [];
  });

  afterEach(() => {
    fs.rmSync(codexHome, { recursive: true, force: true });
    fs.rmSync(path.dirname(baseline), { recursive: true, force: true });
    for (const base of upgradedBases) fs.rmSync(base, { recursive: true, force: true });
  });

  function seedForeign(): string {
    const raw = `${JSON.stringify(FOREIGN_DOC, null, 2)}\n`;
    fs.writeFileSync(target, raw, 'utf-8');
    fs.writeFileSync(baseline, raw, 'utf-8');
    return raw;
  }

  function installCli(extra: string[] = []): RunResult {
    return run('node', [INSTALL_CLI, '--codex-home', codexHome, '--plugin-root', PLUGIN_ROOT, ...extra]);
  }

  /** F262 新增回归组共用：把任意文档同时落到 target 与 baseline（安装前状态即基线） */
  function seedBoth(doc: unknown): void {
    const raw = `${JSON.stringify(doc, null, 2)}\n`;
    fs.writeFileSync(target, raw, 'utf-8');
    fs.writeFileSync(baseline, raw, 'utf-8');
  }

  /** F262 新增回归组共用：把任意内容落成 `--desired` 文件 */
  function writeDesiredFile(content: string, name = 'desired.json'): string {
    const file = path.join(path.dirname(baseline), name);
    fs.writeFileSync(file, content, 'utf-8');
    return file;
  }

  /**
   * F262 新增回归组共用：造一个「升级后的插件根」——新版本目录 + `spec-driver` 分量
   *（归属锚点要求），`hooks/` 与 `scripts/` 软链回真实插件根。
   * 🔴 不能用纯虚构路径：`install-codex-hooks.mjs` 会从 pluginRoot 读 canonical 文档，
   * 读不到直接退 1，用例会退化成"升版根本没发生"的空转。
   */
  function makeUpgradedPluginRoot(): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'f262-upgraded-'));
    upgradedBases.push(base);
    const root = path.join(base, '9.9.9', 'spec-driver');
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(path.join(PLUGIN_ROOT, 'hooks'), path.join(root, 'hooks'));
    fs.symlinkSync(path.join(PLUGIN_ROOT, 'scripts'), path.join(root, 'scripts'));
    return root;
  }

  /** F262 新增回归组共用：升版安装（旧路径命令被摘除、写入新路径命令） */
  function upgradeInstallCli(extra: string[] = []): RunResult {
    return run('node', [
      INSTALL_CLI,
      '--codex-home',
      codexHome,
      '--plugin-root',
      makeUpgradedPluginRoot(),
      ...extra,
    ]);
  }

  /** F262 新增回归组共用：跑保全门禁并解析 JSON 报告 */
  function gateJson(extra: string[] = []): { exitCode: number; report: ValidationReport } {
    const result = run('node', [
      VALIDATE_CLI,
      '--target',
      target,
      '--baseline',
      baseline,
      ...extra,
      '--format',
      'json',
    ]);
    return { exitCode: result.exitCode, report: JSON.parse(result.stdout) as ValidationReport };
  }

  it('安装 → 校验 → 卸载：第三方条目全程逐字节保留', () => {
    const before = seedForeign();

    const installed = installCli();
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain('首次使用需在 Codex 中完成 hooks 信任授予');

    const validated = run('node', [
      VALIDATE_CLI,
      '--target',
      target,
      '--baseline',
      baseline,
      '--format',
      'json',
    ]);
    expect(validated.exitCode).toBe(0);
    const report = JSON.parse(validated.stdout) as {
      ok: boolean;
      status: string;
      ownedEvents: string[];
      foreignPreservation: { checked: boolean; ok: boolean };
      findings: Array<{ level: string; code: string }>;
    };
    expect(report.ok).toBe(true);
    // 含未知第三方事件名 ⇒ warning 而非 fail（对我方判定不构成失败）
    expect(report.status).toBe('warning');
    expect(report.findings.filter((f) => f.level === 'fail')).toEqual([]);
    expect([...report.ownedEvents].sort()).toEqual(
      ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'].sort(),
    );
    expect(report.foreignPreservation).toMatchObject({ checked: true, ok: true });

    const removed = installCli(['--remove']);
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain('移除 5 个条目');
    // 🔴 W1：stdout MUST NOT 声称"第三方条目原样保留" —— 那是本进程无法证实的断言
    //（归属锚点误认时被删的恰恰是第三方条目）。被摘除的 command 改为逐条打印到 stderr。
    expect(removed.stdout).not.toContain('第三方条目原样保留');
    expect(removed.stderr.match(/owned-entry-removed/g) ?? []).toHaveLength(5);

    // 卸载后文档结构等价于安装前（缩进可能不同，故比 parse 后的序列化）
    const after = JSON.parse(fs.readFileSync(target, 'utf-8')) as unknown;
    expect(JSON.stringify(after)).toBe(JSON.stringify(JSON.parse(before)));
  });

  it('重复安装为无变更（幂等），退出码仍为 0', () => {
    seedForeign();
    expect(installCli().exitCode).toBe(0);
    const again = installCli();
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('已是最新');
  });

  it('🔴 非法 JSON：install 以专用退出码 3 fail-loud，且不改动目标文件', () => {
    const bad = '{ "hooks": { oops }}}';
    fs.writeFileSync(target, bad, 'utf-8');

    const result = installCli();

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('不是合法 JSON');
    expect(fs.readFileSync(target, 'utf-8')).toBe(bad);
    expect(fs.readdirSync(codexHome)).toEqual(['hooks.json']);
  });

  it('--codex-home 缺失且 CODEX_HOME 未设置 → 退出码 1，不猜家目录', () => {
    const result = run('node', [INSTALL_CLI], { CODEX_HOME: '' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--codex-home');
  });

  it('校验 CLI 的退出码分流：越界 owned 条目 → 1；目标不可读 → 2', () => {
    fs.writeFileSync(
      target,
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            {
              matcher: '',
              hooks: [
                { type: 'command', command: `bash ${PLUGIN_ROOT}/hooks/stop-task-check.sh` },
              ],
            },
          ],
        },
      }),
      'utf-8',
    );
    const outOfScope = run('node', [VALIDATE_CLI, '--target', target, '--format', 'json']);
    expect(outOfScope.exitCode).toBe(1);
    expect(outOfScope.stdout).toContain('product-event-out-of-scope');

    const missing = run('node', [
      VALIDATE_CLI,
      '--target',
      path.join(codexHome, 'nope.json'),
      '--format',
      'json',
    ]);
    expect(missing.exitCode).toBe(2);

    const noArgs = run('node', [VALIDATE_CLI]);
    expect(noArgs.exitCode).toBe(2);
  });

  it('第三方条目被篡改时 --baseline 判 fail（保全断言不是摆设）', () => {
    seedForeign();
    installCli();
    // 模拟"写入器误删了第三方条目"
    const doc = JSON.parse(fs.readFileSync(target, 'utf-8')) as { hooks: Record<string, unknown> };
    delete doc.hooks['PermissionRequest'];
    fs.writeFileSync(target, JSON.stringify(doc, null, 2), 'utf-8');

    const result = run('node', [
      VALIDATE_CLI,
      '--target',
      target,
      '--baseline',
      baseline,
      '--format',
      'json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('foreign-entries-mutated');
  });

  it('canonical hooks.json 自身过得了门禁（--canonical-source）', () => {
    const result = run('node', [
      VALIDATE_CLI,
      '--target',
      path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'),
      '--canonical-source',
      '--format',
      'json',
    ]);
    expect(result.exitCode).toBe(0);
  });

  describe('codex-skills.sh 挂接点', () => {
    it('install --global 写入 hooks 并打印信任提示；remove --global 清理', () => {
      seedForeign();

      const installed = run('bash', [SKILLS_SH, 'install', '--global'], { CODEX_HOME: codexHome });
      expect(installed.exitCode).toBe(0);
      expect(installed.stdout).toContain('首次使用需在 Codex 中完成 hooks 信任授予');

      const doc = JSON.parse(fs.readFileSync(target, 'utf-8')) as {
        hooks: Record<string, unknown>;
      };
      expect(Object.keys(doc.hooks)).toEqual(
        expect.arrayContaining(['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']),
      );

      const removed = run('bash', [SKILLS_SH, 'remove', '--global'], { CODEX_HOME: codexHome });
      expect(removed.exitCode).toBe(0);
      const afterRemove = JSON.parse(fs.readFileSync(target, 'utf-8')) as unknown;
      expect(JSON.stringify(afterRemove)).toBe(JSON.stringify(FOREIGN_DOC));
    });

    it('project 模式不写 hooks（Codex hooks 无项目级语义）', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-flow-proj-'));
      try {
        const result = run('bash', [SKILLS_SH, 'install'], {
          CODEX_HOME: codexHome,
          CODEX_SKILL_PROJECT_ROOT: projectRoot,
        });
        expect(result.exitCode).toBe(0);
        expect(fs.existsSync(target)).toBe(false);
        expect(result.stdout).not.toContain('hooks 信任授予');
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it('🔴 hooks.json 非法 JSON 时 install --global fail-loud（不冒充装好了）', () => {
      fs.writeFileSync(target, '{ nope }', 'utf-8');
      const result = run('bash', [SKILLS_SH, 'install', '--global'], { CODEX_HOME: codexHome });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('不是合法 JSON');
    });
  });

  it('🔴 信任模型：安装链路不产出也不写入任何绕过信任的配置', () => {
    seedForeign();
    const result = installCli();

    expect(result.stdout).not.toContain('dangerously-bypass-hook-trust');
    expect(result.stderr).not.toContain('dangerously-bypass-hook-trust');
    for (const file of fs.readdirSync(codexHome)) {
      expect(fs.readFileSync(path.join(codexHome, file), 'utf-8')).not.toContain(
        'dangerously-bypass-hook-trust',
      );
    }
    // 生产脚本自身也不得含该 flag（只允许出现在测试内部）—— I1：覆盖本 feature 全部 7 个生产文件
    expect(PRODUCTION_FILES).toHaveLength(7);
    for (const script of PRODUCTION_FILES) {
      expect(fs.existsSync(script)).toBe(true);
      expect(fs.readFileSync(script, 'utf-8')).not.toContain('dangerously-bypass-hook-trust');
    }
  });

  // ─── C1：第三方数据保全门禁的破坏路径矩阵 ─────────────────────────────────

  describe('🔴 C1 第三方数据保全门禁：破坏路径矩阵（每行都是审查方实跑构造的攻击）', () => {
    /** 把 install --json 汇报的 writtenCommands 落盘，作为保全判据的「减数」 */
    function writeDesired(installResult: RunResult): string {
      const parsed = JSON.parse(installResult.stdout) as { writtenCommands: string[] };
      const file = path.join(path.dirname(baseline), 'desired.json');
      fs.writeFileSync(file, JSON.stringify(parsed.writtenCommands), 'utf-8');
      return file;
    }

    function seedRaw(doc: unknown): void {
      const raw = `${JSON.stringify(doc, null, 2)}\n`;
      fs.writeFileSync(target, raw, 'utf-8');
      fs.writeFileSync(baseline, raw, 'utf-8');
    }

    function gate(desired: string | null): { exitCode: number; report: ValidationReport } {
      const result = run('node', [
        VALIDATE_CLI,
        '--target',
        target,
        '--baseline',
        baseline,
        ...(desired === null ? [] : ['--desired', desired]),
        '--format',
        'json',
      ]);
      return { exitCode: result.exitCode, report: JSON.parse(result.stdout) as ValidationReport };
    }

    it('(1) 顶层非对象：整份用户文档被替换 → MUST fail（旧实现两侧坍缩成空壳后判 pass）', () => {
      seedRaw([{ hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'bash /opt/vendor/stop.sh' }] }] } }]);

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      const { exitCode, report } = gate(writeDesired(installed));

      expect(exitCode).toBe(1);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
    });

    it('(2) hooks 字段是数组：整块第三方条目被丢弃 → MUST fail', () => {
      seedRaw({
        description: '用户自己的 hooks',
        hooks: [{ matcher: '', hooks: [{ type: 'command', command: 'bash /opt/vendor/stop.sh' }] }],
      });

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      const { exitCode, report } = gate(writeDesired(installed));

      expect(exitCode).toBe(1);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
    });

    it('(3) 🔴 归属误认领：第三方条目被删 → MUST fail（投影判据在此结构性失明）', () => {
      // `/opt/other/spec-driver/scripts/postinstall.sh` 是**第三方**路径，但它满足我方全部归属
      // 硬条件 —— 与我方真实条目在字符串上不可区分。写入器会把它当自己的条目摘掉。
      // 投影判据与写入器共用 isOwnedEntry ⇒ 它在 before/after 两侧被同样摘掉，差异被抹平。
      const misclaimed = 'bash /opt/other/spec-driver/scripts/postinstall.sh';
      seedRaw({
        hooks: {
          PermissionRequest: [{ matcher: 'vendor', hooks: [{ type: 'command', command: misclaimed }] }],
        },
      });

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      // 写入器**自己也承认**它删了这一条（W1 的可观测性补偿）
      const installReport = JSON.parse(installed.stdout) as {
        diagnostics: Array<{ code: string; command?: string }>;
      };
      expect(
        installReport.diagnostics.filter((d) => d.code === 'owned-entry-removed').map((d) => d.command),
      ).toEqual([misclaimed]);

      const { exitCode, report } = gate(writeDesired(installed));

      expect(exitCode).toBe(1);
      // 🔴 关键：投影判据判「相等」，靠的是不经过归属谓词的命令字面量判据把它抓出来
      expect(report.foreignPreservation.projectionEqual).toBe(true);
      expect(report.foreignPreservation.lostCommands).toEqual([misclaimed]);
      expect(report.findings.map((f) => f.code)).toContain('foreign-command-lost');
    });

    it('(4) 事件值非数组且撞我方事件 → MUST fail（此前唯一被抓到的一行，不得回归）', () => {
      seedRaw({ description: '用户自己的 hooks', hooks: { Stop: 'oops' } });

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      const { exitCode, report } = gate(writeDesired(installed));

      expect(exitCode).toBe(1);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
    });

    it('正常安装（无破坏）仍判 pass —— 判据不是靠"一律报错"过关的', () => {
      seedForeign();
      const installed = installCli(['--json']);
      const { exitCode, report } = gate(writeDesired(installed));

      expect(exitCode).toBe(0);
      expect(report.foreignPreservation).toMatchObject({
        ok: true,
        projectionEqual: true,
        lostCommands: [],
      });
      expect(report.findings.filter((f) => f.level === 'fail')).toEqual([]);
    });

    it('--desired 缺省时减数为空集：卸载后未声明地删掉我方条目也会被判 fail（最严格口径）', () => {
      seedForeign();
      installCli();
      // 以安装后的状态为新基线，再卸载 —— 不给 --desired 就等于声称"什么都没删"
      fs.copyFileSync(target, baseline);
      installCli(['--remove']);

      const { exitCode, report } = gate(null);

      expect(exitCode).toBe(1);
      expect(report.findings.map((f) => f.code)).toContain('foreign-command-lost');
      expect(report.foreignPreservation.lostCommands).toHaveLength(5);
    });
  });

  // ─── F262 / W1a：用户预存空数组事件键不得被判成第三方数据被破坏 ───────────

  describe('🔴 W1a 第三方保全比较语义豁免：用户预存空数组事件键不误报', () => {
    it('用户预存 {hooks:{Stop:[]}} + 正常安装 → 保全判据 pass（零数据丢失却报 fail 是误报）', () => {
      seedBoth({ description: '用户自己的 hooks', hooks: { Stop: [] } });

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      const desired = writeDesiredFile(installed.stdout);

      const { exitCode, report } = gateJson(['--desired', desired]);

      expect(report.foreignPreservation.projectionEqual).toBe(true);
      expect(report.foreignPreservation.lostCommands).toEqual([]);
      expect(report.findings.map((f) => f.code)).not.toContain('foreign-entries-mutated');
      expect(exitCode).toBe(0);
    });

    it('🔴 M1 变异：安装器把用户的空事件键整个删掉 → 仍 MUST fail（豁免不得越界成"任你删"）', () => {
      // 手工构造"被变异过的写入器"的产物：baseline 里 Stop 是用户预存的空数组，
      // target 里该键被整个抹掉 —— 这是真正的用户数据（键本身）丢失。
      const foreign = {
        matcher: 'vendor',
        hooks: [{ type: 'command', command: 'bash /opt/vendor/permission.sh' }],
      };
      fs.writeFileSync(
        baseline,
        JSON.stringify({ hooks: { Stop: [], PermissionRequest: [foreign] } }, null, 2),
        'utf-8',
      );
      fs.writeFileSync(target, JSON.stringify({ hooks: { PermissionRequest: [foreign] } }, null, 2), 'utf-8');

      const { exitCode, report } = gateJson();

      expect(report.foreignPreservation.projectionEqual).toBe(false);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
      expect(exitCode).toBe(1);
    });

    it('🔴 W-1 强形态：4 个我方事件键全被用户预存为空数组 + 正常安装 → 仍 pass（豁免要真管用）', () => {
      seedBoth({
        description: '用户自己的 hooks',
        hooks: { SessionStart: [], PreToolUse: [], PostToolUse: [], Stop: [] },
      });

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      const desired = writeDesiredFile(installed.stdout, 'desired-four-empty.json');

      const { exitCode, report } = gateJson(['--desired', desired]);

      expect(report.foreignPreservation.projectionEqual).toBe(true);
      expect(report.findings.map((f) => f.code)).not.toContain('foreign-entries-mutated');
      expect(exitCode).toBe(0);
    });

    it('🔴 W-1 注入：after 侧该键被塞进第三方内容 → MUST fail（豁免只看键在不在是内容盲）', () => {
      // 豁免的正当性来自"合法安装的归一化终态 = after 投影里该键已不存在"（我方条目 strip 后
      // 整键被删）。只查"键在 after 原始文档里物理存在"时，攻击者往该键塞任何东西都能白嫖豁免。
      fs.writeFileSync(baseline, JSON.stringify({ hooks: { Stop: [] } }, null, 2), 'utf-8');
      fs.writeFileSync(
        target,
        JSON.stringify(
          {
            hooks: {
              Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'bash /tmp/evil/backdoor.sh' }] }],
            },
          },
          null,
          2,
        ),
        'utf-8',
      );

      const { exitCode, report } = gateJson();

      expect(report.foreignPreservation.projectionEqual).toBe(false);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
      expect(exitCode).toBe(1);
    });

    it('🔴 W-1 类型销毁：after 侧该键被写成 null → MUST fail（键还在但值已不是数组）', () => {
      fs.writeFileSync(baseline, JSON.stringify({ hooks: { Stop: [] } }, null, 2), 'utf-8');
      fs.writeFileSync(target, JSON.stringify({ hooks: { Stop: null } }, null, 2), 'utf-8');

      const { exitCode, report } = gateJson();

      expect(report.foreignPreservation.projectionEqual).toBe(false);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
      expect(exitCode).toBe(1);
    });

    it('🔴 RAW 槽：hooks 字段是空数组、被整份换成标准结构 → 仍 MUST fail（豁免不得吃掉 RAW 槽）', () => {
      // `doc.hooks = []` 时投影落 RAW_HOOKS_KEY 槽，其值恰好也是空数组 ——
      // 若豁免按"值是空数组"一刀切，两侧会坍缩成同一空壳，用户整份 hooks 被替换却判 pass。
      seedBoth({ description: '用户自己的 hooks', hooks: [] });

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      const desired = writeDesiredFile(installed.stdout);

      const { exitCode, report } = gateJson(['--desired', desired]);

      expect(report.foreignPreservation.projectionEqual).toBe(false);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
      expect(exitCode).toBe(1);
    });

    it('🔴 RAW 槽（非空形态）：hooks 是数组且内容被改写 → 仍 MUST fail', () => {
      fs.writeFileSync(baseline, JSON.stringify({ hooks: [{ foo: 1 }] }, null, 2), 'utf-8');
      fs.writeFileSync(target, JSON.stringify({ hooks: [{ foo: 2 }] }, null, 2), 'utf-8');

      const { exitCode, report } = gateJson();

      expect(report.foreignPreservation.projectionEqual).toBe(false);
      expect(report.findings.map((f) => f.code)).toContain('foreign-entries-mutated');
      expect(exitCode).toBe(1);
    });
  });

  // ─── F262 / W1b：升版路径的"移除清单"要能被门禁直接消费 ────────────────

  describe('🔴 W1b 升版路径：--desired 直接消费 install --json 完整输出', () => {
    const upgradeInstall = () => upgradeInstallCli(['--json']);

    it('把 install --json 的完整输出直接作 --desired → 升版零误报', () => {
      seedForeign();
      expect(installCli(['--json']).exitCode).toBe(0);
      // 以首次安装后的状态为基线，再升版
      fs.copyFileSync(target, baseline);

      const upgraded = upgradeInstall();
      expect(upgraded.exitCode).toBe(0);
      // 升版确实摘掉了旧路径的 5 条命令（否则本用例退化成"没发生升版"的空转）
      expect(
        (JSON.parse(upgraded.stdout) as { diagnostics: Array<{ code: string }> }).diagnostics.filter(
          (d) => d.code === 'owned-entry-removed',
        ),
      ).toHaveLength(5);
      const desired = writeDesiredFile(upgraded.stdout, 'desired-upgrade.json');

      const { exitCode, report } = gateJson(['--desired', desired, '--skip-shape']);

      // 旧路径命令的消失是写入器自己声明过的（removedCommands），不该被判成第三方数据丢失
      expect(report.foreignPreservation.lostCommands).toEqual([]);
      expect(report.findings.map((f) => f.code)).not.toContain('foreign-command-lost');
      expect(exitCode).toBe(0);

      // 🔴 C1：`removedCommands` 这份减数由归属谓词派生，判据 2 对它只能降级为 warning ——
      // 故豁免 MUST 可见（判据无法区分"真升版"与"归属误认误删"，两者都要人工过目一眼）。
      expect(report.foreignPreservation.removedByDeclaration).toHaveLength(5);
      expect(
        report.findings.filter((f) => f.code === 'foreign-command-removed-by-declaration'),
      ).toHaveLength(5);
      expect(report.status).toBe('warning');
      expect(report.ok).toBe(true);
    });

    it('🔴 同一升版场景不传 --desired → 仍 MUST fail（最严格口径不因新形态而放宽）', () => {
      seedForeign();
      expect(installCli(['--json']).exitCode).toBe(0);
      fs.copyFileSync(target, baseline);
      expect(upgradeInstall().exitCode).toBe(0);

      const { exitCode, report } = gateJson(['--skip-shape']);

      expect(exitCode).toBe(1);
      expect(report.findings.map((f) => f.code)).toContain('foreign-command-lost');
      expect(report.foreignPreservation.lostCommands).toHaveLength(5);
    });

    it('旧两种 --desired 形态继续工作（command 字符串数组 / {hooks:{...}} 生成器文档）', () => {
      seedForeign();
      const installed = installCli(['--json']);
      const parsed = JSON.parse(installed.stdout) as { writtenCommands: string[] };

      const asArray = writeDesiredFile(JSON.stringify(parsed.writtenCommands), 'desired-array.json');
      expect(gateJson(['--desired', asArray]).exitCode).toBe(0);

      // `{hooks:{...}}` 文档形态：直接拿安装后的目标文件当声明（其命令字面量集合即写入集）
      const asDocument = writeDesiredFile(fs.readFileSync(target, 'utf-8'), 'desired-doc.json');
      expect(gateJson(['--desired', asDocument]).exitCode).toBe(0);
    });
  });

  // ─── F262 / C1：removedCommands 减数的豁免可见性 ──────────────────────────

  describe('🔴 C1 removedCommands 豁免可见性：归属误认不再被静默吞掉', () => {
    const MISCLAIMED = 'bash /opt/othertool/spec-driver/scripts/postinstall.sh';

    it('归属误认 + 第三形态 --desired → exit 0 但 status=warning + 专用 code + 命令可见', () => {
      // `/opt/othertool/...` 是**第三方**路径，却满足我方全部归属硬条件 ⇒ 安装时被 strip 误删，
      // 并进 install 结果的 removedCommands。第三形态把它并进减数后，判据 2 不再判 fail ——
      // 这是"升版零误报"的确定代价，因此必须留下 warning 级审计痕迹，而不是静默 pass。
      seedBoth({
        hooks: {
          PermissionRequest: [{ matcher: 'vendor', hooks: [{ type: 'command', command: MISCLAIMED }] }],
        },
      });

      const installed = installCli(['--json']);
      expect(installed.exitCode).toBe(0);
      // 写入器自己承认删了这一条（否则本用例退化成"误删根本没发生"的空转）
      expect(
        (JSON.parse(installed.stdout) as { removedCommands: string[] }).removedCommands,
      ).toEqual([MISCLAIMED]);
      const desired = writeDesiredFile(installed.stdout, 'desired-misclaim.json');

      const { exitCode, report } = gateJson(['--desired', desired]);

      expect(exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.status).toBe('warning');
      expect(report.foreignPreservation.lostCommands).toEqual([]);
      expect(report.foreignPreservation.removedByDeclaration).toEqual([MISCLAIMED]);
      expect(
        report.findings.find((f) => f.code === 'foreign-command-removed-by-declaration'),
      ).toMatchObject({ level: 'warning', layer: 'preservation', command: MISCLAIMED });
    });

    it('调用方显式声明的减数（数组形态）不打 warning —— 只有谓词派生的豁免才需人工过目', () => {
      seedForeign();
      const installed = installCli(['--json']);
      const parsed = JSON.parse(installed.stdout) as { writtenCommands: string[] };
      const asArray = writeDesiredFile(
        JSON.stringify(parsed.writtenCommands),
        'desired-array-nowarn.json',
      );

      const { report } = gateJson(['--desired', asArray]);

      expect(report.foreignPreservation.removedByDeclaration).toEqual([]);
      expect(report.findings.map((f) => f.code)).not.toContain(
        'foreign-command-removed-by-declaration',
      );
    });

    it('🔴 数组形态下归属误认仍 MUST fail（既有口径不因 C1 而放宽）', () => {
      seedBoth({
        hooks: {
          PermissionRequest: [{ matcher: 'vendor', hooks: [{ type: 'command', command: MISCLAIMED }] }],
        },
      });
      const installed = installCli(['--json']);
      const parsed = JSON.parse(installed.stdout) as { writtenCommands: string[] };
      const asArray = writeDesiredFile(
        JSON.stringify(parsed.writtenCommands),
        'desired-array-misclaim.json',
      );

      const { exitCode, report } = gateJson(['--desired', asArray]);

      expect(exitCode).toBe(1);
      expect(report.foreignPreservation.lostCommands).toEqual([MISCLAIMED]);
      expect(report.findings.map((f) => f.code)).toContain('foreign-command-lost');
    });
  });

  // ─── F262 / W-2：--desired 形态识别收严 ──────────────────────────────────

  describe('🔴 W-2 --desired 形态识别：remove --json 输出与畸形字段', () => {
    it('`--remove --json` 的输出作 --desired → removedCommands 进减数（不再 5 条假 lost）', () => {
      seedForeign();
      expect(installCli().exitCode).toBe(0);
      // 以安装后的状态为新基线，再卸载 —— 卸载删掉的正是我方那 5 条
      fs.copyFileSync(target, baseline);

      const removed = installCli(['--remove', '--json']);
      expect(removed.exitCode).toBe(0);
      expect((JSON.parse(removed.stdout) as { removedCommands: string[] }).removedCommands).toHaveLength(5);
      const desired = writeDesiredFile(removed.stdout, 'desired-remove.json');

      const { report } = gateJson(['--desired', desired]);

      // 卸载后我方条目为零 ⇒ 产品层必然 4 条 product-event-missing（与保全无关），
      // 故这里只钉**保全层**：不得再有 foreign-command-lost。
      expect(report.foreignPreservation.lostCommands).toEqual([]);
      expect(report.findings.filter((f) => f.layer === 'preservation' && f.level === 'fail')).toEqual([]);
      // 豁免全部来自 removedCommands ⇒ 5 条都要可见
      expect(report.foreignPreservation.removedByDeclaration).toHaveLength(5);
    });

    it('🔴 I-2 形态判定是优先级而非互斥：混合形态走 install-result 分支，hooks 里的命令不进减数', () => {
      // `{"hooks":{…},"writtenCommands":[]}` 两种形态的特征都占。这里钉的是**实际优先级**
      // （先探 install-result 字段，命中即走该分支），而不是此前注释里那句被实测证伪的
      //「三形态结构上互斥」。
      seedForeign();
      expect(installCli().exitCode).toBe(0);
      fs.copyFileSync(target, baseline);
      installCli(['--remove']);

      // hooks 文档形态：命令字面量集合即减数 ⇒ 卸载掉的 5 条被声明，保全层无 fail
      const asDocument = writeDesiredFile(
        fs.readFileSync(baseline, 'utf-8'),
        'desired-mixed-doc.json',
      );
      expect(
        gateJson(['--desired', asDocument]).report.foreignPreservation.lostCommands,
      ).toEqual([]);

      // 同一份文档补一个空 writtenCommands ⇒ 走 install-result 分支，hooks 里的命令被忽略
      const mixed = JSON.parse(fs.readFileSync(baseline, 'utf-8')) as Record<string, unknown>;
      mixed.writtenCommands = [];
      const asMixed = writeDesiredFile(JSON.stringify(mixed), 'desired-mixed.json');
      expect(
        gateJson(['--desired', asMixed]).report.foreignPreservation.lostCommands,
      ).toHaveLength(5);
    });

    it('🔴 畸形 --desired（writtenCommands 非数组）→ exit 2 fail-loud，不静默塌成空减数', () => {
      seedForeign();
      expect(installCli().exitCode).toBe(0);
      fs.copyFileSync(target, baseline);
      const desired = writeDesiredFile('{"writtenCommands": "not-array"}', 'desired-malformed.json');

      const result = run('node', [
        VALIDATE_CLI,
        '--target',
        target,
        '--baseline',
        baseline,
        '--desired',
        desired,
        '--format',
        'json',
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('writtenCommands');
    });

    it('🔴 畸形 --desired（removedCommands 元素非字符串）→ 同样 exit 2', () => {
      seedForeign();
      expect(installCli().exitCode).toBe(0);
      fs.copyFileSync(target, baseline);
      const desired = writeDesiredFile(
        '{"writtenCommands": [], "removedCommands": [42]}',
        'desired-malformed-removed.json',
      );

      const result = run('node', [
        VALIDATE_CLI,
        '--target',
        target,
        '--baseline',
        baseline,
        '--desired',
        desired,
        '--format',
        'json',
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('removedCommands');
    });
  });

  // ─── W5：--json 输出必须可被机器解析 ─────────────────────────────────────

  describe('🔴 W5 --json 输出可解析', () => {
    it('stdout 恰为一份 JSON，信任提示走 stderr（此前追加提示导致 JSON.parse 报错）', () => {
      seedForeign();

      const result = installCli(['--json']);

      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      const parsed = JSON.parse(result.stdout) as { action: string; ownedCount: number };
      expect(parsed.action).toBe('install');
      expect(parsed.ownedCount).toBe(5);
      // 提示本身没丢，只是换到了 stderr
      expect(result.stdout).not.toContain('hooks 信任授予');
      expect(result.stderr).toContain('hooks 信任授予');
    });

    it('--remove --json 同样可解析', () => {
      seedForeign();
      installCli();
      const result = installCli(['--remove', '--json']);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { action: string; removedCount: number };
      expect(parsed).toMatchObject({ action: 'remove', removedCount: 5 });
    });
  });

  // ─── W4：路径特殊字符的端到端矩阵 ────────────────────────────────────────

  describe('🔴 W4 pluginRoot 含特殊字符时 install 与 validate 都不得误报', () => {
    /** 造一个路径含特殊字符的插件根：hooks/ 与 scripts/ 软链回真实插件根 */
    function makePluginRootNamed(dirName: string): string {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-root-'));
      const root = path.join(base, dirName, 'spec-driver');
      fs.mkdirSync(root, { recursive: true });
      fs.symlinkSync(path.join(PLUGIN_ROOT, 'hooks'), path.join(root, 'hooks'));
      fs.symlinkSync(path.join(PLUGIN_ROOT, 'scripts'), path.join(root, 'scripts'));
      return root;
    }

    it.each([
      ['空格', 'some dir'],
      ['等号（此前 install 硬失败 exit 1 ×4 owned-command-not-absolute）', 'opt=1'],
      ["单引号（此前 validate 假红 ×5 owned-command-target-missing）", "o'brien"],
    ])('%s：install exit 0 且 validate pass', (_label, dirName) => {
      const root = makePluginRootNamed(dirName);
      try {
        const installed = run('node', [
          INSTALL_CLI,
          '--codex-home',
          codexHome,
          '--plugin-root',
          root,
        ]);
        expect(installed.stderr).toBe('');
        expect(installed.exitCode).toBe(0);

        const validated = run('node', [VALIDATE_CLI, '--target', target, '--format', 'json']);
        const report = JSON.parse(validated.stdout) as ValidationReport;
        expect(report.findings.filter((f) => f.level === 'fail')).toEqual([]);
        expect(validated.exitCode).toBe(0);
      } finally {
        fs.rmSync(path.dirname(path.dirname(root)), { recursive: true, force: true });
      }
    });
  });

  it('I5：--codex-home 取空串时，错误文案 MUST 点名该参数', () => {
    const result = run('node', [INSTALL_CLI, '--codex-home', ''], { CODEX_HOME: '' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--codex-home');
    expect(result.stderr).toContain('空串');
  });

  it('I6：替换用户数据这类警告在 CLI 里是醒目告警（含后果与回滚指引）', () => {
    fs.writeFileSync(target, JSON.stringify({ description: 'x', hooks: 'not-an-object' }), 'utf-8');

    const result = installCli();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('hooks-field-not-object-replaced');
    expect(result.stderr).toContain('已被替换');
    expect(result.stderr).toContain('.bak');
  });

  // ─── F262 / W4：.bak 语义的可观测性（行为不变，只让事实可见）────────────

  describe('🔴 W4 .bak 可观测性（W4）', () => {
    it('升版时 backup-already-exists 不再被静默吞掉，且打印真实 .bak 路径', () => {
      seedForeign();
      expect(installCli().exitCode).toBe(0);
      expect(fs.existsSync(`${target}.bak`)).toBe(true);

      const upgraded = upgradeInstallCli();

      expect(upgraded.exitCode).toBe(0);
      expect(upgraded.stderr).toContain('backup-already-exists');
      expect(upgraded.stderr).toContain(`${target}.bak`);
      // 只陈述本进程可证实的事实：不得指认这份 .bak 的来历
      expect(upgraded.stderr).toContain('未覆盖');
      // 行为本身不变：最早那一份 .bak 原地不动
      expect(fs.readFileSync(`${target}.bak`, 'utf-8')).toBe(
        `${JSON.stringify(FOREIGN_DOC, null, 2)}\n`,
      );
    });

    it('owned-entry-removed 的回滚指引提示先核对 .bak 内容（升版会一次刷 5 条）', () => {
      seedForeign();
      expect(installCli().exitCode).toBe(0);

      const upgraded = upgradeInstallCli();

      expect(upgraded.stderr.match(/owned-entry-removed/g) ?? []).toHaveLength(5);
      expect(upgraded.stderr).toContain('核对');
      expect(upgraded.stderr).toContain(`${target}.bak`);
    });

    it('数据被替换类告警打印真实 .bak 路径，不再是占位符 `<目标>.bak`', () => {
      fs.writeFileSync(target, JSON.stringify([1, 2, 3]), 'utf-8');

      const result = installCli();

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('document-not-object-replaced');
      expect(result.stderr).toContain(`${target}.bak`);
      expect(result.stderr).not.toContain('<目标>.bak');
    });

    it('死分支收口不引入新噪声：target-missing / nothing-to-remove 仍保持静默', () => {
      // 这两条 info 的语义已被 stdout 的成功文案覆盖，重复打印只会淹没真信号。
      const missing = installCli(['--remove']);
      expect(missing.exitCode).toBe(0);
      expect(missing.stderr).not.toContain('target-missing');

      seedForeign();
      const nothing = installCli(['--remove']);
      expect(nothing.exitCode).toBe(0);
      expect(nothing.stderr).not.toContain('nothing-to-remove');

      // I6 场景同样不得混入这两条
      fs.writeFileSync(target, JSON.stringify({ description: 'x', hooks: 'not-an-object' }), 'utf-8');
      const replaced = installCli();
      expect(replaced.stderr).not.toContain('target-missing');
      expect(replaced.stderr).not.toContain('nothing-to-remove');
    });
  });
});
