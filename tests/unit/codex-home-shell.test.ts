/**
 * Feature 240 / T009（SC-009）：shell 侧 resolve_codex_home 边界矩阵 + 双实现逐字节对拍
 *
 * 为何需要对拍（plan.md §7.2）：`CODEX_HOME` 的解析在 Node 侧（`src/core/codex-home.ts`）与
 * shell 侧（`plugins/spec-driver/scripts/lib/codex-home.sh`）各有一份实现。两份实现漂移会导致
 * 同一个 `CODEX_HOME` 在 CLI 链路与 `codex-skills.sh` 链路上解析出**不同目录** ——
 * 逐字节对拍是防止该漂移的唯一机械手段（照搬 F239「对拍测试护双实现」）。
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCodexHome, resolveCodexHomeFromProcess } from '../../src/core/codex-home.js';

const LIB = fileURLToPath(
  new URL('../../plugins/spec-driver/scripts/lib/codex-home.sh', import.meta.url),
);

const FAKE_HOME = '/fake/home/u';

/** 调用 shell 侧纯函数：两个参数均显式传入，函数体不读任何全局 */
function shResolve(codexHome: string, home: string): string {
  return execFileSync(
    'bash',
    ['-c', 'source "$1"; resolve_codex_home "$2" "$3"', '_', LIB, codexHome, home],
    { encoding: 'utf-8' },
  ).replace(/\n$/, '');
}

/** 调用 shell 侧薄封装：从环境读取（对称于 resolveCodexHomeFromProcess） */
function shResolveFromEnv(env: NodeJS.ProcessEnv): string {
  return execFileSync('bash', ['-c', 'source "$1"; resolve_codex_home_from_env', '_', LIB], {
    encoding: 'utf-8',
    env,
  }).replace(/\n$/, '');
}

/**
 * 🔴 W1 新增：调用**完整消费链**（解析 + 子路径拼接），而非仅纯函数。
 *
 * 为何必须单独有这个 harness：上面的 shResolve 只对拍纯函数 stdout，
 * 而 Codex 实测反例正是「纯函数对拍通过、消费链却漂移」——
 * `codex-skills.sh` 曾写 `"$(resolve_codex_home_from_env)/skills"`，
 * 在 CODEX_HOME=/tmp/x/ 下产出 `/tmp/x//skills`，纯函数层面完全看不出来。
 */
function shResolveSubdir(env: NodeJS.ProcessEnv, sub: string): string {
  return execFileSync(
    'bash',
    ['-c', 'source "$1"; resolve_codex_home_subdir "$2"', '_', LIB, sub],
    { encoding: 'utf-8', env },
  ).replace(/\n$/, '');
}

/** 运行一段 shell 并返回退出码与 stderr（用于 fail-loud 断言） */
function shRun(script: string, env?: NodeJS.ProcessEnv): { status: number; stderr: string } {
  try {
    execFileSync('bash', ['-c', script, '_', LIB], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stderr: string };
    return { status: e.status, stderr: e.stderr ?? '' };
  }
}

describe('codex-home.sh — 语法与可 source 性', () => {
  it('bash -n 语法检查通过', () => {
    expect(() => execFileSync('bash', ['-n', LIB], { encoding: 'utf-8' })).not.toThrow();
  });

  it('可被 source 且导出两个函数', () => {
    const out = execFileSync(
      'bash',
      ['-c', 'source "$1"; declare -F resolve_codex_home resolve_codex_home_from_env', '_', LIB],
      { encoding: 'utf-8' },
    );
    expect(out).toContain('resolve_codex_home');
    expect(out).toContain('resolve_codex_home_from_env');
  });
});

describe('resolve_codex_home — SC-009 边界矩阵（shell 侧 9 项）', () => {
  it('行1/行2 — 空值（unset 与空串在 shell 下同形）→ fallback <home>/.codex', () => {
    expect(shResolve('', FAKE_HOME)).toBe(`${FAKE_HOME}/.codex`);
  });

  it('行3 — 绝对路径原样返回', () => {
    expect(shResolve('/tmp/x', FAKE_HOME)).toBe('/tmp/x');
  });

  it('行4 — 相对路径原样返回，不隐式转绝对', () => {
    expect(shResolve('./x', FAKE_HOME)).toBe('./x');
  });

  it('行5 — 尾部斜杠原样返回', () => {
    expect(shResolve('/tmp/x/', FAKE_HOME)).toBe('/tmp/x/');
  });

  it('行6 — 含空格路径不因空格断词（所有引用均加双引号）', () => {
    expect(shResolve('/tmp/a b', FAKE_HOME)).toBe('/tmp/a b');
    // 家目录含空格时 fallback 同样不断词
    expect(shResolve('', '/home/first last')).toBe('/home/first last/.codex');
  });

  it('行7~行9 — symlink / 不存在 / 无权限目录均原样返回，不做 I/O 校验', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'f240-sh-'));
    try {
      const target = join(tmpRoot, 'real');
      const link = join(tmpRoot, 'link');
      mkdirSync(target);
      symlinkSync(target, link);
      const noPerm = join(tmpRoot, 'no-perm');
      mkdirSync(noPerm);
      chmodSync(noPerm, 0o000);

      expect(shResolve(link, FAKE_HOME)).toBe(link); // preserve symlink
      expect(shResolve(join(tmpRoot, 'missing', 'deep'), FAKE_HOME)).toBe(
        join(tmpRoot, 'missing', 'deep'),
      );
      expect(shResolve(noPerm, FAKE_HOME)).toBe(noPerm);

      chmodSync(noPerm, 0o755);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('resolve_codex_home — fail-loud 契约', () => {
  it('参数不足（少于 2 个）时非零退出并写 stderr，不静默取全局', () => {
    let status = 0;
    let stderr = '';
    try {
      execFileSync('bash', ['-c', 'source "$1"; resolve_codex_home', '_', LIB], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status: number; stderr: string };
      status = e.status;
      stderr = e.stderr;
    }
    expect(status).not.toBe(0);
    expect(stderr).toContain('resolve_codex_home');
  });

  it('fallback 分支下家目录为空时 fail-loud（与 Node 侧同步）', () => {
    let status = 0;
    try {
      execFileSync('bash', ['-c', 'source "$1"; resolve_codex_home "" ""', '_', LIB], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      status = (err as { status: number }).status;
    }
    expect(status).not.toBe(0);
    // Node 侧对同一输入抛 TypeError —— 两侧同为 fail-loud
    expect(() => resolveCodexHome({ env: {}, homedir: () => '' })).toThrow(TypeError);
  });
});

describe('resolve_codex_home_from_env — 唯一环境读取点', () => {
  it('CODEX_HOME 有值时返回其值', () => {
    expect(shResolveFromEnv({ CODEX_HOME: '/tmp/from-env', HOME: FAKE_HOME })).toBe('/tmp/from-env');
  });

  it('CODEX_HOME unset 时 fallback（与 Node 侧 unset 语义一致）', () => {
    const env = { HOME: FAKE_HOME, PATH: process.env['PATH'] } as NodeJS.ProcessEnv;
    expect(shResolveFromEnv(env)).toBe(`${FAKE_HOME}/.codex`);
    expect(resolveCodexHome({ env: {}, homedir: () => FAKE_HOME })).toBe(`${FAKE_HOME}/.codex`);
  });

  it('CODEX_HOME 为空串时视同未设置（与 Node 侧一致）', () => {
    expect(shResolveFromEnv({ CODEX_HOME: '', HOME: FAKE_HOME })).toBe(`${FAKE_HOME}/.codex`);
  });
});

describe('🔴 Node ↔ shell 双实现逐字节对拍', () => {
  // 覆盖 SC-009 九项输入 + 家目录的多种形态（含 path.join 会折叠的重复斜杠）
  const codexHomeInputs = [
    '', // unset / 空串
    '/tmp/x', // 绝对
    './x', // 相对
    'relative/dir', // 相对（无 ./ 前缀）
    '/tmp/x/', // 尾斜杠
    '/tmp/a b', // 含空格
    '/tmp/does/not/exist', // 不存在
    '/tmp/x//y', // 内部重复斜杠
    '~/literal-tilde', // 波浪号字面量（不得被展开）
  ];
  const homeInputs = ['/fake/home/u', '/fake/home/u/', '//fake/home/u', '/fake/home/u//', '/h me/u'];

  for (const codexHome of codexHomeInputs) {
    for (const home of homeInputs) {
      it(`对拍 CODEX_HOME=${JSON.stringify(codexHome)} HOME=${JSON.stringify(home)}`, () => {
        const nodeOut = resolveCodexHome({
          env: codexHome === '' ? {} : { CODEX_HOME: codexHome },
          homedir: () => home,
        });
        expect(shResolve(codexHome, home)).toBe(nodeOut);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 Codex 对抗审查 W1 修复的机械守护
//
// 分三块：
//   (1) 完整消费链对拍 —— 抓纯函数对拍抓不到的拼接漂移；
//   (2) 已消除的差异（换行符）—— 断言两侧统一 fail-loud；
//   (3) 保留的已知差异（HOME unset / dot-segment）—— 断言其**当前实际行为**，
//       使注释里登记的差异表与代码同步；差异一旦被谁"顺手修好"或恶化，这里会红。
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 W1(1) — 完整消费链（解析 + 拼接）逐字节对拍', () => {
  // 这些 base 形态正是纯函数对拍**看不出问题**、拼接后才漂移的
  const bases = [
    '/tmp/x', // 基准
    '/tmp/x/', // 尾斜杠 ← Codex 实测反例：曾产出 /tmp/x//skills
    '/tmp/x//', // 多重尾斜杠
    '/tmp/a//b', // 内部重复斜杠 ← path.join 会折叠
    '/', // 根目录
    '//', // 双斜杠根
    '/tmp/a b', // 含空格
    'relative/dir', // 相对路径
  ];

  for (const base of bases) {
    it(`消费链对拍 CODEX_HOME=${JSON.stringify(base)} + "skills"`, () => {
      const nodeOut = join(
        resolveCodexHome({ env: { CODEX_HOME: base }, homedir: () => FAKE_HOME }),
        'skills',
      );
      expect(shResolveSubdir({ CODEX_HOME: base, HOME: FAKE_HOME }, 'skills')).toBe(nodeOut);
    });
  }

  it('fallback 分支的消费链同样对拍（CODEX_HOME unset）', () => {
    for (const home of ['/fake/home/u', '/fake/home/u/', '//fake/home/u']) {
      const nodeOut = join(resolveCodexHome({ env: {}, homedir: () => home }), 'skills');
      const env = { HOME: home, PATH: process.env['PATH'] } as NodeJS.ProcessEnv;
      expect(shResolveSubdir(env, 'skills')).toBe(nodeOut);
    }
  });

  it('🔴 反向守卫：拼接结果永不含 `//`（杜绝 codex-skills.sh 曾有的 /tmp/x//skills）', () => {
    for (const base of bases) {
      const out = shResolveSubdir({ CODEX_HOME: base, HOME: FAKE_HOME }, 'skills');
      expect(out, `base=${base} 产出含 //: ${out}`).not.toContain('//');
    }
  });

  it('resolve_codex_home_subdir 缺参数时 fail-loud，不产出裸家目录', () => {
    const r = shRun('source "$1"; resolve_codex_home_subdir', { HOME: FAKE_HOME } as NodeJS.ProcessEnv);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('resolve_codex_home_subdir');
  });

  it('codex_path_join 缺参数时 fail-loud', () => {
    const r = shRun('source "$1"; codex_path_join /tmp/x');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('codex_path_join');
  });
});

/**
 * 🔴 W1 修复轮实测踩到的坑：斜杠折叠曾写作 `${v//\/\//\/}`，
 * 在 bash 5.x 下正确，但在 **bash 3.2**（macOS 自带 /bin/bash）下替换串里的 `\/`
 * 产出**字面反斜杠** —— `//x` 被写坏成 `\/x`。
 *
 * 本仓库脚本以 `#!/usr/bin/env bash` 启动，实际解释器由用户 PATH 决定；
 * 开发机装了 Homebrew bash 5.x 时该缺陷**结构性不可见**（照搬 F232「本地全绿≠他机绿」教训）。
 * 故此处对系统上**每一个**可用 bash 分别跑一遍，而不只是默认那一个。
 */
describe('🔴 W1(2a) — 跨 bash 版本可移植性（bash 3.2 与 5.x 必须同结果）', () => {
  const candidates = ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash'];
  const available = candidates.filter((p) => existsSync(p));

  function versionOf(shell: string): string {
    return execFileSync(shell, ['-c', 'echo "$BASH_VERSION"'], { encoding: 'utf-8' }).trim();
  }

  it('至少能找到一个 bash 解释器（否则本块空转，需修 candidates 列表）', () => {
    expect(available.length).toBeGreaterThan(0);
  });

  for (const shell of available) {
    it(`${shell} — 折叠斜杠零反斜杠污染，且与 Node path.join 一致`, () => {
      const version = versionOf(shell);
      for (const base of ['/tmp/x/', '/tmp/x//', '/tmp/a//b', '/', '//']) {
        const out = execFileSync(
          shell,
          ['-c', 'source "$1"; resolve_codex_home_subdir "$2"', '_', LIB, 'skills'],
          { encoding: 'utf-8', env: { CODEX_HOME: base, HOME: FAKE_HOME } },
        ).replace(/\n$/, '');

        expect(out, `${shell} ${version} base=${base} 出现反斜杠`).not.toContain('\\');
        expect(out, `${shell} ${version} base=${base}`).toBe(join(base, 'skills'));
      }
    });

    it(`${shell} — fallback 分支折叠家目录斜杠同样零污染`, () => {
      const version = versionOf(shell);
      for (const home of ['//fake/home/u', '/fake/home/u//', '/fake//home//u']) {
        const out = execFileSync(
          shell,
          ['-c', 'source "$1"; resolve_codex_home "" "$2"', '_', LIB, home],
          { encoding: 'utf-8', env: {} },
        ).replace(/\n$/, '');

        expect(out, `${shell} ${version} home=${home} 出现反斜杠`).not.toContain('\\');
        expect(out, `${shell} ${version} home=${home}`).toBe(join(home, '.codex'));
      }
    });
  }
});

describe('🔴 W1(2) — 已消除的差异：含换行符的取值两侧统一 fail-loud', () => {
  // 背景：shell 消费端一律用 $(...) 取值，command substitution 剥掉全部尾部换行，
  // Node 侧原样保留 → 同一个 CODEX_HOME 在两条链路指向不同目录，
  // 且 `remove --global` 会据此删除**错误的目录**。故两侧改为直接拒绝。

  it('Node 侧：CODEX_HOME 含换行 → 抛 TypeError', () => {
    expect(() =>
      resolveCodexHome({ env: { CODEX_HOME: '/tmp/nl\n' }, homedir: () => FAKE_HOME }),
    ).toThrow(TypeError);
    expect(() =>
      resolveCodexHome({ env: { CODEX_HOME: '/tmp/a\nb' }, homedir: () => FAKE_HOME }),
    ).toThrow(TypeError);
  });

  it('Node 侧：家目录含换行 → 抛 TypeError（fallback 分支同样拦）', () => {
    expect(() => resolveCodexHome({ env: {}, homedir: () => '/home/nl\n' })).toThrow(TypeError);
  });

  it('shell 侧：CODEX_HOME 含换行 → 非零退出 + stderr 说明', () => {
    const r = shRun('source "$1"; resolve_codex_home_from_env', {
      CODEX_HOME: '/tmp/nl\n',
      HOME: FAKE_HOME,
    } as NodeJS.ProcessEnv);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('含换行符');
  });

  it('shell 侧：家目录含换行 → 非零退出（fallback 分支同样拦）', () => {
    const r = shRun('source "$1"; resolve_codex_home "" "/home/nl\n"');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('含换行符');
  });

  it('消费链也随之 fail-loud（不会静默拼出被剥了换行的错误目录）', () => {
    const r = shRun('source "$1"; resolve_codex_home_subdir skills', {
      CODEX_HOME: '/tmp/nl\n',
      HOME: FAKE_HOME,
    } as NodeJS.ProcessEnv);
    expect(r.status).not.toBe(0);
  });

  it('🔴 \\r 不在拦截面内（两侧对 \\r 行为一致，不构成分叉，不扩大拦截）', () => {
    const withCr = '/tmp/cr\r';
    const nodeOut = resolveCodexHome({ env: { CODEX_HOME: withCr }, homedir: () => FAKE_HOME });
    expect(nodeOut).toBe(withCr);
    expect(shResolve(withCr, FAKE_HOME)).toBe(withCr);
  });
});

describe('🔴 W1(3) — 保留的已知差异（注释差异表的机械镜像，非等价性声称）', () => {
  it('差异2 — HOME 与 CODEX_HOME 同时 unset：shell fail-loud / Node 走系统账户 fallback', () => {
    // shell 侧：${HOME:-} 展开为空 → 非零退出
    const r = shRun('source "$1"; resolve_codex_home_from_env', {
      PATH: process.env['PATH'],
    } as NodeJS.ProcessEnv);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('家目录取值为空');

    // Node 侧：os.homedir 有系统账户 fallback，即便 HOME unset 也能拿到家目录，
    // 故走的是正常 fallback 分支而**不是** fail-loud —— 这正是两侧的已知差异。
    const savedHome = process.env['HOME'];
    const savedCodexHome = process.env['CODEX_HOME'];
    try {
      delete process.env['HOME'];
      delete process.env['CODEX_HOME'];
      const nodeOut = resolveCodexHomeFromProcess();
      expect(nodeOut.endsWith('/.codex')).toBe(true);
      expect(nodeOut.startsWith('/')).toBe(true);
    } finally {
      if (savedHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = savedHome;
      if (savedCodexHome === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = savedCodexHome;
    }
  });

  it('差异3 — 家目录含 dot-segment：Node 词法规约 / shell 原样拼接', () => {
    // 断言的是**当前实际行为**，不是"应该相等"。两侧在此确实不同，注释已如实登记。
    const cases: Array<[string, string, string]> = [
      // [家目录, Node 结果, shell 结果]
      ['.', '.codex', './.codex'],
      ['/tmp/a/../b', '/tmp/b/.codex', '/tmp/a/../b/.codex'],
      ['/tmp/./a', '/tmp/a/.codex', '/tmp/./a/.codex'],
    ];
    for (const [home, expectedNode, expectedShell] of cases) {
      expect(resolveCodexHome({ env: {}, homedir: () => home }), `Node/${home}`).toBe(expectedNode);
      expect(shResolve('', home), `shell/${home}`).toBe(expectedShell);
      // 显式固化"两者不同"，防止有人把差异表当成等价表
      expect(expectedNode).not.toBe(expectedShell);
    }
  });

  it('差异3 只影响 fallback 分支：显式 CODEX_HOME 含 dot-segment 时两侧仍逐字节一致', () => {
    for (const v of ['./x', '/tmp/a/../b', '/tmp/./a']) {
      const nodeOut = resolveCodexHome({ env: { CODEX_HOME: v }, homedir: () => FAKE_HOME });
      expect(nodeOut).toBe(v); // 原样返回，Node 侧也不规约
      expect(shResolve(v, FAKE_HOME)).toBe(v);
    }
  });
});
