/**
 * writeAtomicJson 单元测试
 *
 * 两组维度：
 * - **内容维度**（历史已有）：写入内容正确、目录自动创建、2 空格缩进；
 * - **inode 维度**（F267 补齐）：软链跟随、mode 保全、tmp 命名唯一性、失败不留残渣。
 *
 * 🔴 为什么补 inode 维度（F267 Root Cause）：`renameSync` 替换的是**整个 inode**，
 * 目标的「身份」（是不是软链）与「权限意图」（用户设的 mode）都随旧 inode 一起被丢弃。
 * 此前 4 个用例全是内容维度断言，把"写对了字节"当成"写对了"——测试的盲区恰好复刻了
 * 实现的盲区，故 D1/D2/D3/D4 四条缺陷结构性看不见。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomicJson } from '../../src/utils/atomic-write.js';

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * 用 `renameSync` 的 spy 捕获本次写入实际使用的 tmp 路径。
 * tmp 路径是实现内部细节、不出现在返回值里，而"tmp 命名是否唯一"正是 D3 的修复点本身——
 * 只能从 rename 的 oldPath 观测。spy 透传到真实实现，写入语义不受影响。
 */
function captureTmpPaths(run: () => void): string[] {
  const seen: string[] = [];
  const realRename = fs.renameSync;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
    seen.push(String(from));
    return realRename(from, to);
  }) as typeof fs.renameSync);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

describe('writeAtomicJson', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs) {
      removeTmpDir(dir);
    }
    tmpDirs.length = 0;
  });

  // ─── 内容维度 ────────────────────────────────────────────────────────────

  it('正常写入后内容正确', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'test.json');
    const data = { key: 'value', num: 42 };

    writeAtomicJson(filePath, data);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  it('目录不存在时自动创建', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'nested', 'deep', 'test.json');
    const data = { nested: true };

    writeAtomicJson(filePath, data);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  it('JSON 使用 2 空格缩进', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'indent.json');
    const data = { a: { b: 1 } };

    writeAtomicJson(filePath, data);

    const content = fs.readFileSync(filePath, 'utf-8');
    // 验证 2 空格缩进；同时钉住"无尾换行"——codex 侧 writeJsonAtomic 带尾换行，
    // 本侧刻意不跟进（序列化面不属于 F267 的 4 条缺陷，改它会动 3 个消费方的产物字节）
    expect(content).toBe(JSON.stringify(data, null, 2));
  });

  // ─── D1 软链跟随 ─────────────────────────────────────────────────────────

  it('软链目标：写入后软链仍是软链，且真实文件收到更新', () => {
    // dotfiles 用户把 `.claude/settings.json` 软链进自己的配置仓库是常见形态。
    // rename 到链接路径会把软链替换成普通文件：链接被悄悄拆掉，而用户真正在版本管理的
    // 那份文件永远收不到更新——两头都错。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const realPath = path.join(tmpDir, 'real.json');
    const linkPath = path.join(tmpDir, 'link.json');
    fs.writeFileSync(realPath, JSON.stringify({ origin: 'dotfiles' }), 'utf-8');
    fs.symlinkSync(realPath, linkPath);

    const data = { updated: true };
    // 跟随是 opt-in（F267 对抗审查 C1）：只有明确声明"这是用户可能软链托管的配置"才跟随。
    writeAtomicJson(linkPath, data, { followSymlinks: true });

    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(linkPath)).toBe(fs.realpathSync(realPath));
    expect(JSON.parse(fs.readFileSync(realPath, 'utf-8'))).toEqual(data);
  });

  // ─── D2 mode 保全 ────────────────────────────────────────────────────────

  it('已存在文件 mode 0600：写入后仍是 0600', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'private.json');
    fs.writeFileSync(filePath, JSON.stringify({ secret: 1 }), 'utf-8');
    fs.chmodSync(filePath, 0o600);

    writeAtomicJson(filePath, { secret: 2 });

    expect((fs.statSync(filePath).mode & 0o7777).toString(8)).toBe('600');
  });

  it('已存在文件的宽 mode 0666 被如实保全（保全 ≠ 加固）', () => {
    // 用户自己设的宽权限是他的决定，本函数只负责"不把它改掉"，不做顺手收紧——
    // 那等于替用户改他的配置。收紧默认值只允许发生在**首次创建**的路径上。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'wide.json');
    fs.writeFileSync(filePath, JSON.stringify({ a: 1 }), 'utf-8');
    fs.chmodSync(filePath, 0o666);

    writeAtomicJson(filePath, { a: 2 });

    expect((fs.statSync(filePath).mode & 0o7777).toString(8)).toBe('666');
  });

  it('新建文件默认 mode 0600', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'fresh.json');

    writeAtomicJson(filePath, { fresh: true });

    expect((fs.statSync(filePath).mode & 0o7777).toString(8)).toBe('600');
  });

  it('chmod 失败（无权限位文件系统）→ 降级继续：写入照常成功且不留 tmp 残渣', () => {
    // exFAT / SMB / 部分容器 overlay 上"权限被放宽"这个风险面本就不存在；让一个锦上添花的
    // 元数据动作把本可正常完成的写入拦下来，是新增了此前不存在的阻断面。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'nochmod.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
      const error: NodeJS.ErrnoException = new Error('operation not supported');
      error.code = 'ENOTSUP';
      throw error;
    });

    writeAtomicJson(filePath, { ok: true });

    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ ok: true });
    expect(fs.readdirSync(tmpDir).filter((name) => name.includes('.tmp'))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  // ─── D3 tmp 命名（并发互截修复点）────────────────────────────────────────

  it('随机 tmp 命名：同一目标连续两次写入产生不同 tmp 路径', () => {
    // 进程**内**唯一性：随机后缀保证同一进程里两次写入不会争用同一个 tmp 路径。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'unique.json');

    const tmpPaths = captureTmpPaths(() => {
      writeAtomicJson(filePath, { round: 1 });
      writeAtomicJson(filePath, { round: 2 });
    });

    expect(tmpPaths).toHaveLength(2);
    expect(tmpPaths[0]).not.toBe(tmpPaths[1]);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ round: 2 });
  });

  it('tmp 命名带 pid 分量：并发的两个进程各写各的 tmp，不会互相 rename 走对方的文件', () => {
    // 跨进程唯一性（D3 的实际形态）：固定名 `${target}.tmp` 下两个进程共用同一 tmp 路径，
    // 一方 rename 走后另一方的 rename 报 ENOENT——更坏的是"胜出方"rename 的可能是对方的
    // payload，等于静默丢更新。pid 分量把 tmp 路径按进程分隔开。
    // 单元测试只能断言命名形态；真实双进程验证见 tests/integration/atomic-write-concurrent.test.ts。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'pid.json');

    const [tmpPath] = captureTmpPaths(() => {
      writeAtomicJson(filePath, { payload: 'x' });
    });

    expect(tmpPath.startsWith(`${filePath}.tmp.${process.pid}.`)).toBe(true);
    // 随机分量改用 crypto.randomBytes(6)：定长 12 位十六进制，不会像
    // `Math.random().toString(36).slice(2,10)` 那样在极小值上退化出空串/单字符。
    expect(tmpPath).toMatch(/\.tmp\.\d+\.[0-9a-f]{12}$/);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ payload: 'x' });
  });

  it('旧格式残留 .tmp（无 pid/random 后缀）不影响新写入，也不被误清理', () => {
    // 升级前遗留的固定名残留对新实现是"别人的文件"：既不会被当成自己的 tmp 覆盖掉，
    // 也不该被顺手删除（清理只针对本次调用自己创建的那一个 tmp）。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'legacy.json');
    const legacyTmp = `${filePath}.tmp`;
    fs.writeFileSync(legacyTmp, '{"old": true}', 'utf-8');

    writeAtomicJson(filePath, { new: true });

    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ new: true });
    expect(fs.existsSync(legacyTmp)).toBe(true);
    expect(fs.readFileSync(legacyTmp, 'utf-8')).toBe('{"old": true}');
  });

  // ─── D4 失败清理 ─────────────────────────────────────────────────────────

  it('rename 失败时不留 tmp 残留（真实失败：目标路径被一个目录占住）', () => {
    // 不 mock，制造真实的 rename(2) 失败：newpath 是目录、oldpath 是普通文件 → EISDIR/ENOTDIR。
    // 断言"抛出原始错误"与"不留残渣"两件事同时成立——清理不得吞掉失败信号。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'occupied.json');
    fs.mkdirSync(filePath);

    expect(() => writeAtomicJson(filePath, { any: true })).toThrow();

    expect(fs.readdirSync(tmpDir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('tmp 路径被预置成软链时报错而非顺着链接写到未知位置（O_EXCL）', () => {
    // `flag: 'wx'` 的价值：tmp 路径若被攻击者预置成指向别处的软链，跟随写入会把内容
    // 落到未知位置。O_EXCL 让这种情况直接 EEXIST 报错，落进清理分支。
    // 这里断言的是"传了 wx"这一事实本身——tmp 名带 12 位加密随机后缀，无法预先占住，
    // 故用 spy 核实 flag，而不是去构造一个猜中随机数的场景。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'excl.json');
    const writeSpy = vi.spyOn(fs, 'writeFileSync');

    writeAtomicJson(filePath, { any: true });

    const opts = writeSpy.mock.calls[0]?.[2] as { flag?: string; mode?: number };
    expect(opts.flag).toBe('wx');
    expect(opts.mode).toBe(0o600);
  });

  // ─── C1 软链跟随是 opt-in（对抗审查引入的回归护栏）──────────────────────────

  it('默认不跟随软链：写我方产物时 rename 替换链接本身，链接指向的文件一个字节不动', () => {
    // 🔴 这条是安全护栏，不是行为偏好。git 原生存储软链（mode 120000），克隆即落盘：
    // 第三方仓库只要自带 `specs/_meta/graph.json -> ../../../../.ssh/authorized_keys`，
    // 跑一次 `spectra batch` 就会写穿过去。graph / cache / manifest 没有任何软链托管场景，
    // 对它们跟随软链是纯粹的攻击面，故默认必须是"不跟随"。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const victim = path.join(tmpDir, 'victim-outside-repo');
    const linkPath = path.join(tmpDir, 'graph.json');
    fs.writeFileSync(victim, 'ssh-rsa AAAA-NOT-JSON', 'utf-8');
    fs.symlinkSync(victim, linkPath);

    writeAtomicJson(linkPath, { graph: { nodeCount: 0 } });

    expect(fs.readFileSync(victim, 'utf-8')).toBe('ssh-rsa AAAA-NOT-JSON');
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(false);
    expect(JSON.parse(fs.readFileSync(linkPath, 'utf-8'))).toEqual({ graph: { nodeCount: 0 } });
  });

  it('跟随开启但 realpath 解析失败（软链环）：降级拆链但必须打印告警，不静默', () => {
    // 悬空软链 / 软链环 / 中间目录不可穿越三种形态下 realpath 都会失败并回落字面路径 ——
    // 也就是照样拆链。静默回落等于对调用方谎称"身份已保全"，而用户 dotfiles 的真实文件
    // 一个字节都没收到更新。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const a = path.join(tmpDir, 'a.json');
    const b = path.join(tmpDir, 'b.json');
    fs.symlinkSync(b, a);
    fs.symlinkSync(a, b);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writeAtomicJson(a, { any: true }, { followSymlinks: true });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/符号链接|ELOOP/);
    expect(fs.lstatSync(a).isSymbolicLink()).toBe(false);
  });

  it('EEXIST 时不删掉占住 tmp 路径的那个文件（清理只碰自己创建的 tmp）', () => {
    // 清理动作本身不能变成破坏动作：`flag:'wx'` 报 EEXIST 说明那个路径上的文件是**别人的**
    // （并发进程的 tmp，或被预置的诱饵），无条件 rmSync 会把它删掉。
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'excl2.json');
    const eexist = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw eexist;
    });
    const rmSpy = vi.spyOn(fs, 'rmSync');

    expect(() => writeAtomicJson(filePath, { any: true })).toThrow(/EEXIST/);

    expect(rmSpy).not.toHaveBeenCalled();
  });

  it('目标是目录时不拿目录的 mode 去 chmod tmp（非普通文件回落默认 0600）', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const dirTarget = path.join(tmpDir, 'adir');
    fs.mkdirSync(dirTarget, { mode: 0o755 });
    const chmodSpy = vi.spyOn(fs, 'chmodSync');

    expect(() => writeAtomicJson(dirTarget, { any: true })).toThrow();

    for (const call of chmodSpy.mock.calls) {
      expect((call[1] as number).toString(8)).toBe('600');
    }
    expect(fs.readdirSync(tmpDir).filter(f => f.includes('.tmp.'))).toEqual([]);
  });
});