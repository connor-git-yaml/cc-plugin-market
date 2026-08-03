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

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f240-flow-home-'));
    target = path.join(codexHome, 'hooks.json');
    baseline = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'f240-flow-base-')), 'baseline.json');
  });

  afterEach(() => {
    fs.rmSync(codexHome, { recursive: true, force: true });
    fs.rmSync(path.dirname(baseline), { recursive: true, force: true });
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
});
