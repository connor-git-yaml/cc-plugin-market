/**
 * Feature 240 / T007（SC-009）：resolveCodexHome 边界矩阵与 fail-loud 契约
 *
 * 语义来源：spec.md FR-006 + plan.md §7.1。
 *
 * 🔴 T006 实测结论（_grounding.md §9.6）对本文件的直接约束：
 * 1. 空串 CODEX_HOME 在官方 `codex doctor` 下等同未设置（回显 ~/.codex）——我方语义与之一致，
 *    这一行**可以**声称与 doctor 对齐。
 * 2. 官方 doctor 对**不存在的目录**是 `config.load: fail`，**不是**"原样返回"。
 *    因此"不存在路径"一行属**我方自定义语义**：helper 只做取值与 fallback，
 *    不做任何存在性校验（纯函数、零 I/O），存在性由各调用点按需 fail-loud。
 *    🔴 MUST NOT 在任何注释/文档中声称该行"与 codex doctor 对齐"。
 * 3. doctor 会做规范化（去尾斜杠 / 转绝对 / 解 symlink）。我方**显式选择不做规范化**，
 *    理由：规范化涉及 I/O（realpath 需读文件系统），会破坏纯函数属性并使 shell 侧对拍复杂化。
 *    该选择由下方"原样返回"系列用例固化，并由 codex-home-shell.test.ts 的对拍测试保证两侧一致。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCodexHome, resolveCodexHomeFromProcess } from '../../src/core/codex-home.js';

const SOURCE_PATH = fileURLToPath(new URL('../../src/core/codex-home.ts', import.meta.url));

/** 固定的假 HOME，保证用例不受运行机器真实家目录影响 */
const FAKE_HOME = '/fake/home/u';
const deps = (codexHome?: string, home = FAKE_HOME) => ({
  env: codexHome === undefined ? {} : { CODEX_HOME: codexHome },
  homedir: () => home,
});

describe('resolveCodexHome — SC-009 边界矩阵（9 项）', () => {
  let tmpRoot: string;
  let symlinkPath: string;
  let symlinkTarget: string;
  let noPermDir: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'f240-codex-home-'));
    symlinkTarget = join(tmpRoot, 'real-codex-dir');
    symlinkPath = join(tmpRoot, 'linked-codex-dir');
    mkdirSync(symlinkTarget);
    symlinkSync(symlinkTarget, symlinkPath);
    noPermDir = join(tmpRoot, 'no-perm');
    mkdirSync(noPermDir);
    chmodSync(noPermDir, 0o000);
  });

  afterAll(() => {
    // 先恢复权限，否则 rm -rf 在部分平台会失败
    try {
      chmodSync(noPermDir, 0o755);
    } catch {
      /* 已删除或平台不支持时忽略 */
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ── 行 1 / 行 2：unset 与空串走 fallback ────────────────────────────────
  it('行1 — CODEX_HOME unset → join(homedir(), ".codex")', () => {
    expect(resolveCodexHome(deps(undefined))).toBe(join(FAKE_HOME, '.codex'));
  });

  it('行2 — CODEX_HOME 为空串 → 视同未设置，走 fallback（与 codex doctor 实测行为一致）', () => {
    expect(resolveCodexHome(deps(''))).toBe(join(FAKE_HOME, '.codex'));
  });

  // ── 行 3~9：非空即原样返回，不做任何规范化 ──────────────────────────────
  it('行3 — 绝对路径原样返回', () => {
    expect(resolveCodexHome(deps('/tmp/x'))).toBe('/tmp/x');
  });

  it('行4 — 相对路径原样返回，不隐式 resolve 为绝对路径（我方自定义语义，doctor 会转绝对）', () => {
    expect(resolveCodexHome(deps('./x'))).toBe('./x');
    expect(resolveCodexHome(deps('relative/dir'))).toBe('relative/dir');
  });

  it('行5 — 尾部斜杠原样返回；下游用 path.join 拼接不产生 //', () => {
    expect(resolveCodexHome(deps('/tmp/x/'))).toBe('/tmp/x/');
    // 下游拼接契约：消费点必须用 path.join，从而吸收尾斜杠
    expect(join(resolveCodexHome(deps('/tmp/x/')), 'skills')).toBe('/tmp/x/skills');
  });

  it('行6 — 含空格路径原样返回', () => {
    expect(resolveCodexHome(deps('/tmp/a b'))).toBe('/tmp/a b');
  });

  it('行7 — symlink 路径 preserve，不做 realpath 解引用（我方自定义语义，doctor 会解 symlink）', () => {
    const result = resolveCodexHome(deps(symlinkPath));
    expect(result).toBe(symlinkPath);
    expect(result).not.toBe(symlinkTarget);
  });

  it('行8 — 不存在的路径原样返回，helper 不做存在性校验（我方自定义语义，doctor 对此为 fail）', () => {
    const missing = join(tmpRoot, 'definitely', 'not', 'there');
    expect(resolveCodexHome(deps(missing))).toBe(missing);
  });

  it('行9 — 无读写权限的目录原样返回，不抛错、不误判为"未设置"', () => {
    expect(resolveCodexHome(deps(noPermDir))).toBe(noPermDir);
    expect(resolveCodexHome(deps(noPermDir))).not.toBe(join(FAKE_HOME, '.codex'));
  });
});

describe('resolveCodexHome — fail-loud 显式注入契约', () => {
  it('不传参调用抛 TypeError（deps 必填，禁止静默降级为默认行为）', () => {
    // .mjs / JS 调用方绕过 TS 类型检查仍可不传参，故运行期必须守卫
    expect(() => (resolveCodexHome as unknown as () => string)()).toThrow(TypeError);
  });

  it('deps 非对象抛 TypeError', () => {
    for (const bad of [null, undefined, 'x', 42, true]) {
      expect(() => resolveCodexHome(bad as never)).toThrow(TypeError);
    }
  });

  it('deps.env 缺失或非对象抛 TypeError', () => {
    expect(() => resolveCodexHome({ homedir: () => FAKE_HOME } as never)).toThrow(TypeError);
    expect(() => resolveCodexHome({ env: 'nope', homedir: () => FAKE_HOME } as never)).toThrow(
      TypeError,
    );
    expect(() => resolveCodexHome({ env: null, homedir: () => FAKE_HOME } as never)).toThrow(
      TypeError,
    );
  });

  it('deps.homedir 缺失或非函数抛 TypeError', () => {
    expect(() => resolveCodexHome({ env: {} } as never)).toThrow(TypeError);
    expect(() => resolveCodexHome({ env: {}, homedir: '/x' } as never)).toThrow(TypeError);
  });

  it('fallback 分支下 homedir() 返回空串时 fail-loud，绝不产出 cwd 相对的 ".codex"', () => {
    // join('', '.codex') === '.codex' —— 相对路径会让写操作落进当前工作目录，
    // 属静默灾难；且 shell 侧无法逐字节对拍该形态，故两侧统一 fail-loud。
    expect(() => resolveCodexHome(deps(undefined, ''))).toThrow(TypeError);
  });

  // ── Codex 对抗审查 W1：含换行符的取值两侧统一 fail-loud ──
  // 理由：shell 消费端一律以 $() 取值，command substitution 剥掉全部尾部换行，
  // Node 侧原样保留 → 同一个 CODEX_HOME 在两条链路指向不同目录，
  // 而 `remove --global` 会据此删除**错误的目录**。跨实现对拍见 codex-home-shell.test.ts。
  it('CODEX_HOME 含换行时抛 TypeError（消除与 shell 侧的静默分叉）', () => {
    expect(() => resolveCodexHome(deps('/tmp/nl\n'))).toThrow(TypeError);
    expect(() => resolveCodexHome(deps('/tmp/a\nb'))).toThrow(TypeError);
  });

  it('家目录含换行时抛 TypeError（fallback 分支同样拦）', () => {
    expect(() => resolveCodexHome(deps(undefined, '/home/nl\n'))).toThrow(TypeError);
  });

  it('🔴 \\r 不在拦截面内：两侧对 \\r 行为一致，不构成分叉，故不扩大拦截', () => {
    expect(resolveCodexHome(deps('/tmp/cr\r'))).toBe('/tmp/cr\r');
  });

  it('CODEX_HOME 非空时不触碰 homedir（不做无谓调用，亦不受其失败影响）', () => {
    let called = 0;
    const result = resolveCodexHome({
      env: { CODEX_HOME: '/tmp/explicit' },
      homedir: () => {
        called += 1;
        throw new Error('homedir 不应被调用');
      },
    });
    expect(result).toBe('/tmp/explicit');
    expect(called).toBe(0);
  });
});

describe('resolveCodexHomeFromProcess — 全仓唯一环境读取点', () => {
  const original = process.env['CODEX_HOME'];

  afterAll(() => {
    if (original === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = original;
  });

  it('读取真实 process 环境：设置 CODEX_HOME 时返回其值', () => {
    process.env['CODEX_HOME'] = '/tmp/from-process';
    expect(resolveCodexHomeFromProcess()).toBe('/tmp/from-process');
  });

  it('读取真实 process 环境：未设置时 fallback 到 <home>/.codex', () => {
    delete process.env['CODEX_HOME'];
    // 不硬编码真实家目录，只断言形态：以 .codex 结尾且为绝对路径
    const result = resolveCodexHomeFromProcess();
    expect(result.endsWith(`${'/'}.codex`)).toBe(true);
    expect(result.startsWith('/')).toBe(true);
  });
});

describe('静态守卫 — 纯函数不得隐式读取全局', () => {
  const source = readFileSync(SOURCE_PATH, 'utf-8');

  /** 截取某个 export function 的源码区间（到下一个顶层 export 或文件尾） */
  function sliceFunction(name: string): string {
    const start = source.indexOf(`export function ${name}(`);
    expect(start, `未找到 ${name} 定义`).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start + 1);
    const nextExport = rest.indexOf('\nexport ');
    return nextExport === -1 ? rest : rest.slice(0, nextExport);
  }

  it('resolveCodexHome 函数体内零命中 process.env', () => {
    expect(sliceFunction('resolveCodexHome')).not.toContain('process.env');
  });

  it('resolveCodexHome 函数体内不直接调用 homedir()，只经 deps 注入', () => {
    const body = sliceFunction('resolveCodexHome');
    // 允许 deps.homedir(...) 形式，剔除后不得残留任何 homedir( 调用
    const withoutInjected = body.split('deps.homedir(').join('');
    expect(withoutInjected).not.toContain('homedir(');
  });

  it('resolveCodexHomeFromProcess 是全文件唯一读取 process.env / homedir() 的位置', () => {
    const fromProcessBody = sliceFunction('resolveCodexHomeFromProcess');
    const outside = source.split(fromProcessBody).join('');

    expect(outside).not.toContain('process.env');
    // 顶层 import 的 `homedir }` 不含调用括号，故只需保证剩余文本无 homedir( 调用
    expect(outside.split('deps.homedir(').join('')).not.toContain('homedir(');
    // 反向确认：唯一读取点自身确实读了这两者（防止断言因实现搬走而空转）
    expect(fromProcessBody).toContain('process.env');
    expect(fromProcessBody).toContain('homedir(');
  });
});
