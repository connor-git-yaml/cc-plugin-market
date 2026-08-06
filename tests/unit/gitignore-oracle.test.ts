/**
 * F258 — 三态 gitignore oracle 单测。
 *
 * 全部用例使用**真实 git 仓库**，不 mock 子进程：F255 的教训是"测试与实现共享同一份
 * 错误假设"，缺陷 1 之所以能长期存活，正是因为既有用例全部先在盘上创建文件再断言，
 * 存在性前提被测试自身满足。本文件的判别力全部来自"文件不在盘"这个维度。
 *
 * 覆盖：
 * - R1-1 离盘路径按规则命中（含目录路径输入契约，INFO-3）
 * - R1-2 tracked-but-deleted 的 tracked 豁免
 * - R1-3 `--directory` over-collapse 不得污染离盘判定（复刻 fix-report R3 的 d3）
 * - R1-6 降级探针基准修正（从子目录扫描仍 warn 一次，附带项 6.1）
 * - R1-7 存在性探测 errno 三分（D1）
 * - R1-8 KL-5 在盘 symlink 穿越（**已知限制，非 bug**）
 * - R1-9 KL-6 归一化 / 大小写前提（**已知限制，非 bug**）
 * - R1-10 git worktree 内判定与主仓一致（回归护栏）
 * - KL-2 不可判形态族（submodule / 仓外 / 越界 / 空串）
 * - L2 预算的具名出口 `l2-budget-exhausted`（D7）
 *
 * 审查修复轮补充：
 * - M-1 L0 整体降级自我声明（`degraded`），堵住"打坏 git 反而让门变绿"
 * - M-2 `budgetExhausted` 与 `count` 是两件事
 * - M-3 L3 只查 `files`、不查 `dirPrefixes`（KL-3 不变量）
 * - M-4 在盘的绝对路径 / `..` 越界与 KL-2 承诺一致
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGitignoreOracle } from '../../src/utils/gitignore-oracle.js';

function createFile(base: string, relativePath: string, content = ''): void {
  const fullPath = path.join(base, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/** 当前进程是否为 root——root 下 chmod 000 不产生 EACCES，相关用例必须显式跳过。 */
function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

describe('createGitignoreOracle：三态 verdict（F258）', () => {
  let repoDir: string;

  function git(args: string[], cwd = repoDir): void {
    execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  function initRepo(dir = repoDir): void {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'f258-test@example.com'], dir);
    git(['config', 'user.name', 'F258 Test'], dir);
  }

  function commitAll(dir = repoDir): void {
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'init'], dir);
  }

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f258-gitignore-oracle-'));
  });

  afterEach(() => {
    // chmod 复原：EACCES 用例会把目录设成 000，否则 rmSync 自身失败
    for (const name of ['restricted', 'weird']) {
      const dir = path.join(repoDir, name);
      if (fs.existsSync(dir)) {
        try {
          fs.chmodSync(dir, 0o755);
        } catch {
          /* 忽略：目录可能已被删除 */
        }
      }
    }
    fs.rmSync(repoDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ============================================================
  // R1-1：离盘路径必须按"规则是否命中"回答，而不是按"盘上有没有"
  // ============================================================

  it('R1-1: 离盘且规则命中的路径判 ignored（缺陷 1 的卡面）', () => {
    createFile(repoDir, '.gitignore', 'legacy/\n*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    const oracle = createGitignoreOracle(repoDir);

    // legacy/old.ts 与 foo.gen.ts 都**不在盘上**——修复前预取清单 MISS 一律判 not-ignored
    expect(oracle.verdict('legacy/old.ts')).toBe('ignored');
    expect(oracle.verdict('foo.gen.ts')).toBe('ignored');
    // 规则未命中的离盘路径仍是 not-ignored（不能修成"离盘一律 ignored"）
    expect(oracle.verdict('src/ghost.ts')).toBe('not-ignored');
    expect(oracle.drainUndeterminable().count).toBe(0);
  });

  it('R1-1b: verdict 接受目录相对路径（INFO-3 输入契约），且离盘目录形态与 git 同解', () => {
    createFile(repoDir, '.gitignore', 'legacy/\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    createFile(repoDir, 'legacy/kept.ts', 'export {}');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);

    /** 直接问 git 本体，作为同解判据（不把期望值写死成我们自己的实现） */
    function gitVerdict(spec: string): 'ignored' | 'not-ignored' | 'undeterminable' {
      try {
        execFileSync('git', ['check-ignore', '-q', '--', spec], {
          cwd: repoDir,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        return 'ignored';
      } catch (error) {
        return (error as { status?: number }).status === 1 ? 'not-ignored' : 'undeterminable';
      }
    }

    const oracle = createGitignoreOracle(repoDir);

    // 在盘目录（generic collector 对目录 dirent 也会发问）
    expect(oracle.verdict('legacy')).toBe('ignored');
    expect(oracle.verdict('src')).toBe('not-ignored');

    // 离盘目录路径：git 自身对**目录型规则 + 无尾斜杠 + 路径不在盘**答 not-ignored
    // （它无从判断该 path spec 是不是目录）。这是 git 的口径，不是本 oracle 的缺陷——
    // 断言"与权威口径同解"而不是断言我们更聪明。
    fs.rmSync(path.join(repoDir, 'legacy'), { recursive: true, force: true });
    // 换新实例：verdict 在实例内记忆化，同一路径的旧答案不会因磁盘变化而自动失效
    const offDiskOracle = createGitignoreOracle(repoDir);

    expect(gitVerdict('legacy')).toBe('not-ignored');
    expect(offDiskOracle.verdict('legacy')).toBe(gitVerdict('legacy'));

    // 带尾斜杠的离盘目录形态则命中目录型规则，两侧同样同解
    expect(gitVerdict('legacy/')).toBe('ignored');
    expect(offDiskOracle.verdict('legacy/')).toBe(gitVerdict('legacy/'));
    // 其下的离盘文件路径照常命中
    expect(offDiskOracle.verdict('legacy/old.ts')).toBe('ignored');
  });

  // ============================================================
  // R1-2：tracked 豁免必须与 git 同源，且不因文件被删而翻转
  // ============================================================

  it('R1-2: tracked-but-deleted 仍判 not-ignored（tracked 豁免，不加 --no-index 的直接后果）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'keep.gen.ts', 'tracked');
    initRepo();
    git(['add', '-f', 'keep.gen.ts']);
    git(['commit', '-q', '-m', 'add forced']);
    fs.rmSync(path.join(repoDir, 'keep.gen.ts'));

    const oracle = createGitignoreOracle(repoDir);

    expect(oracle.verdict('keep.gen.ts')).toBe('not-ignored');
    // 对照：同规则命中但从未 tracked 的离盘路径仍是 ignored
    expect(oracle.verdict('other.gen.ts')).toBe('ignored');
  });

  // ============================================================
  // R1-3：`--directory` 折叠前缀不得污染离盘判定（复刻 fix-report R3 的 d3）
  // ============================================================

  it('R1-3: 离盘路径不消费 dirPrefixes——over-collapse 的 generated/ 不得把 notes.ts 判成 ignored', () => {
    createFile(repoDir, '.gitignore', '*.log\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    createFile(repoDir, 'generated/debug.log', 'log');
    createFile(repoDir, 'generated/notes.ts', 'export {}');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);

    // 删除 notes.ts ⇒ generated/ 下只剩被忽略的未跟踪内容 ⇒ 清单折叠成 `generated/`
    fs.rmSync(path.join(repoDir, 'generated/notes.ts'));
    const collapsed = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      { cwd: repoDir, encoding: 'utf-8' },
    );
    expect(collapsed).toContain('generated/');

    const oracle = createGitignoreOracle(repoDir);

    // git check-ignore 对 generated/notes.ts 的权威答案是 NOT-IGNORED——
    // 若分层实现先查 dirPrefix 再判存在性，这里会反向误判成 ignored
    expect(oracle.verdict('generated/notes.ts')).toBe('not-ignored');
    // 在盘分支仍照常消费 dirPrefixes（不得把折叠前缀整体废掉）
    expect(oracle.verdict('generated/debug.log')).toBe('ignored');
  });

  // ============================================================
  // M-3（审查修复轮）：L3 只查 `files`，**不查** `dirPrefixes`
  //
  // 判别力来源：`col/` 因内含条目全部被忽略而被 `--directory` 折叠，但 `col/` 本身**无**规则
  // 命中（`git check-ignore col` exit 1）。若 L3 沿用消费 `dirPrefixes` 的查找函数，
  // `col/<超长段>/keep.ts` 这条 ENAMETOOLONG 路径会命中折叠前缀被判 `ignored`——比
  // `undeterminable` **更错**（git 的权威答案是 not-ignored），且计数为 0 ⇒ 静默。
  // ============================================================

  it('M-3: L3（errno 不可判）只信 `files` 的逐条肯定答复，不消费 `--directory` 折叠前缀', () => {
    createFile(repoDir, '.gitignore', '*.log\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    createFile(repoDir, 'col/a.log', 'log');
    createFile(repoDir, 'col/b.log', 'log');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);

    // 前提校验：`col/` 确实被折叠进 dirPrefixes，而它本身并未被规则命中
    const collapsed = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      { cwd: repoDir, encoding: 'utf-8' },
    );
    expect(collapsed).toContain('col/');
    let colRuleHit: number | null;
    try {
      execFileSync('git', ['check-ignore', '-q', '--', 'col'], {
        cwd: repoDir,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      colRuleHit = 0;
    } catch (error) {
      colRuleHit = (error as { status?: number }).status ?? null;
    }
    expect(colRuleHit).toBe(1); // exit 1 = git 判 col 本身 not-ignored

    // 单段超过 NAME_MAX ⇒ lstat 抛 ENAMETOOLONG ⇒ presence=undeterminable ⇒ L3
    const tooLong = 'L'.repeat(300);
    const probePath = `col/${tooLong}/keep.ts`;
    let probeErrno: string | undefined;
    try {
      fs.lstatSync(path.resolve(repoDir, probePath));
    } catch (error) {
      probeErrno = (error as { code?: string }).code;
    }
    if (probeErrno !== 'ENAMETOOLONG') {
      console.warn(`[skip] M-3：本文件系统对 300 字符路径段返回 ${probeErrno}，无法构造 L3 形态`);
      return;
    }

    const oracle = createGitignoreOracle(repoDir);

    // 折叠前缀不得让"判不了"变成"判是"——后者与 git 的权威答案（not-ignored）方向相反
    expect(oracle.verdict(probePath)).toBe('undeterminable');
    expect(oracle.drainUndeterminable().count).toBe(1);
  });

  it('M-3b: L3 仍消费 `files` 的精确条目（P1 差分实证的 EACCES 反例不得被回退）', () => {
    if (isRoot()) {
      console.warn('[skip] M-3b：当前以 root 运行，chmod 无法构造 EACCES');
      return;
    }
    createFile(repoDir, '.gitignore', '*.log\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    createFile(repoDir, 'weird/secret.log', 'log');
    createFile(repoDir, 'weird/keep.ts', 'export {}');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts', 'weird/keep.ts']);
    git(['commit', '-q', '-m', 'init']);

    const oracle = createGitignoreOracle(repoDir);
    fs.chmodSync(path.join(repoDir, 'weird'), 0o444); // 有 r 无 x ⇒ lstat 子项 EACCES

    // `weird/secret.log` 是 files 里的精确条目 ⇒ 仍判 ignored（采集集合逐字节不变）
    expect(oracle.verdict('weird/secret.log')).toBe('ignored');
    expect(oracle.drainUndeterminable().count).toBe(0);
  });

  // ============================================================
  // M-4（审查修复轮）：在盘的绝对路径 / `..` 越界必须与 KL-2 的承诺一致
  //
  // 修复前：只有**离盘**才走 L2 得 exit 128；**在盘**被 L1 截住 ⇒ 查表 MISS ⇒ not-ignored，
  // 静默不计数——文档（KL-2）承诺了运行时没做的事。
  // ============================================================

  it('M-4: 在盘的仓外绝对路径 / `..` 越界 ⇒ undeterminable 且计数出声（与 KL-2 承诺一致）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    const oracle = createGitignoreOracle(repoDir);

    // ① 在盘的仓内绝对路径（输入契约要求相对路径，绝对路径是合同违反 ⇒ 判不了）
    expect(fs.existsSync(path.join(repoDir, 'src/a.ts'))).toBe(true);
    expect(oracle.verdict(path.join(repoDir, 'src/a.ts'))).toBe('undeterminable');

    // ② 在盘的仓外绝对路径（/etc/hosts 在 macOS/Linux 恒在盘）
    if (fs.existsSync('/etc/hosts')) {
      expect(oracle.verdict('/etc/hosts')).toBe('undeterminable');
    }

    // ③ 在盘的 `..` 越界路径（父目录下真实存在的文件）
    const parentProbe = path.join(path.dirname(repoDir), `f258-m4-${path.basename(repoDir)}.ts`);
    fs.writeFileSync(parentProbe, 'export {}');
    try {
      expect(oracle.verdict(`../${path.basename(parentProbe)}`)).toBe('undeterminable');
    } finally {
      fs.rmSync(parentProbe, { force: true });
    }

    const drained = oracle.drainUndeterminable();
    expect(drained.count).toBeGreaterThanOrEqual(3);
  });

  // ============================================================
  // M-1（审查修复轮）：L0 整体降级必须自我声明
  //
  // 修复前："打坏 git" ⇒ prefetchLookup===null ⇒ 永不产出 undeterminable ⇒ drain 恒 count:0
  // ⇒ 两个消费方都不出声 ⇒ repo:check 的 ignore-undeterminable 反而报 pass。
  // ============================================================

  it('M-1: git 仓内预取失败 ⇒ degraded=true（count 恒 0 不构成"无不可判路径"的证据）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();
    // 真实失败路径（不 mock 子进程）：损坏 index ⇒ `git ls-files` exit 128，
    // 而 `git rev-parse HEAD` 仍正常 ⇒ 精确复刻"只有忽略清单预取塌了"的形态
    fs.writeFileSync(path.join(repoDir, '.git', 'index'), 'garbage');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const oracle = createGitignoreOracle(repoDir);

    // L0 二态：本该 undeterminable 的越界路径拿到的是根 .gitignore 近似解析的二态结果
    expect(oracle.verdict('../f258-outside.gen.ts')).not.toBe('undeterminable');

    const drained = oracle.drainUndeterminable();
    expect(drained.count).toBe(0);
    expect(drained.degraded).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('M-1b: 非 git 上下文的 L0 不算 degraded（没有 git 可降级，出声只会是噪声）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');

    const oracle = createGitignoreOracle(repoDir);

    expect(oracle.drainUndeterminable().degraded).toBe(false);
  });

  it('M-1c: 正常 git 上下文 degraded=false（不制造常态噪声）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    const oracle = createGitignoreOracle(repoDir);
    expect(oracle.verdict('src/a.ts')).toBe('not-ignored');

    expect(oracle.drainUndeterminable().degraded).toBe(false);
  });

  // ============================================================
  // M-2（审查修复轮）：budgetExhausted 与 count 是两件事
  // ============================================================

  it('M-2: 预算恰在最后一次 L2 后耗尽 ⇒ count=0 但 budgetExhausted=true（不得被 count 吞掉）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    const oracle = createGitignoreOracle(repoDir, repoDir, { l2BudgetMs: 0 });

    // 只问一条离盘路径：它照常拿到答案，但预算在这次调用后即判耗尽
    expect(oracle.verdict('first.gen.ts')).toBe('ignored');

    const drained = oracle.drainUndeterminable();
    expect(drained.count).toBe(0);
    expect(drained.budgetExhausted).toBe(true);
    expect(drained.degraded).toBe(false);
  });

  // ============================================================
  // R1-6：降级探针基准修正（附带项 6.1）
  // ============================================================

  it('R1-6: 从子目录扫描 + 畸形 .git ⇒ 降级 warn 恰 1 次（探针改为向上逐级查找）', () => {
    // 畸形 .git 文件让预取必然失败（真实失败路径，不 mock 子进程）
    createFile(repoDir, '.git', 'not a valid gitfile');
    createFile(repoDir, '.gitignore', 'generated/\n');
    createFile(repoDir, 'sub/keep.ts', 'export {}');
    const subDir = path.join(repoDir, 'sub');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 修复前探针查的是 `<子目录>/.git`，结构性不存在 ⇒ git 仓内的降级被静默
    createGitignoreOracle(subDir, subDir);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('降级');
  });

  it('R1-6b: 真正的非 git 目录（向上逐级也找不到 .git）仍静默，不制造新噪声', () => {
    createFile(repoDir, '.gitignore', 'generated/\n');
    createFile(repoDir, 'sub/keep.ts', 'export {}');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const oracle = createGitignoreOracle(path.join(repoDir, 'sub'), path.join(repoDir, 'sub'));

    expect(warnSpy).not.toHaveBeenCalled();
    // L0 分支永不产出 undeterminable
    expect(oracle.verdict('')).not.toBe('undeterminable');
  });

  // ============================================================
  // R1-7：存在性探测 errno 三分（D1）
  //
  // 判别力来源：这两条路径若被当成"离盘"转去问 `git check-ignore`，会得到 **ignored**
  // （git 只匹配规则、不 stat）。断言 `undeterminable` 因此同时证明了"没有落 L2"。
  // ============================================================

  it('R1-7a: EACCES（父目录 chmod 000）⇒ undeterminable，不得当离盘、不得落 L2', () => {
    if (isRoot()) {
      console.warn('[skip] R1-7a：当前以 root 运行，chmod 000 不产生 EACCES，无法构造该形态');
      return;
    }
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    createFile(repoDir, 'restricted/f.gen.ts', 'x');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);
    fs.chmodSync(path.join(repoDir, 'restricted'), 0o000);

    const oracle = createGitignoreOracle(repoDir);

    expect(oracle.verdict('restricted/f.gen.ts')).toBe('undeterminable');
    const drained = oracle.drainUndeterminable();
    expect(drained.count).toBe(1);
    expect(drained.samples).toContain('restricted/f.gen.ts');
    expect(drained.budgetExhausted).toBe(false);
  });

  it('R1-7b: ELOOP（自指 symlink 环）⇒ undeterminable，不得当离盘、不得落 L2', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();
    fs.symlinkSync('loop', path.join(repoDir, 'loop'));

    const oracle = createGitignoreOracle(repoDir);

    expect(oracle.verdict('loop/f.gen.ts')).toBe('undeterminable');
    expect(oracle.drainUndeterminable().count).toBe(1);
  });

  /**
   * BEHAVIOR_VERSION 不 bump 的**承重断言**（由本 fix 的差分实证反例发现）。
   *
   * `chmod 0444 dir`（有 r 无 x）时 `readdirSync` 仍能列名、`lstatSync` 抛 EACCES ⇒ walk 能
   * 枚举到该 dirent 并对它发问。若 L3 只按 errno 三分直接返回 `undeterminable`，消费方按
   * not-ignored 处理 ⇒ **该文件会被采集**，而修复前它命中预取清单是被跳过的 ⇒ 被采集的
   * 文件集合发生变化 ⇒ `gitignore-interpretation` 责任项被触发、`BEHAVIOR_VERSION` 必须 bump。
   *
   * 故 L3 必须先查一次内存预取清单。本用例钉住这条不变量：**采集面逐字节不变**。
   */
  it('L3 前置查预取清单：EACCES 但命中预取清单的路径仍判 ignored（采集集合逐字节不变）', () => {
    if (isRoot()) {
      console.warn('[skip] L3 预取兜底：当前以 root 运行，chmod 0444 不产生 EACCES');
      return;
    }
    createFile(repoDir, '.gitignore', '*.log\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);
    createFile(repoDir, 'weird/secret.log', 'data');
    createFile(repoDir, 'weird/keep.ts', 'export {}');

    // 预取发生在 chmod 之前 ⇒ secret.log 进得了清单
    const prefetched = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      { cwd: repoDir, encoding: 'utf-8' },
    );
    expect(prefetched).toContain('weird/secret.log');

    fs.chmodSync(path.join(repoDir, 'weird'), 0o444);
    try {
      // 前提复核：readdir 可列名（walk 枚举得到）、lstat 抛 EACCES（走 L3）
      expect(fs.readdirSync(path.join(repoDir, 'weird')).sort()).toEqual(['keep.ts', 'secret.log']);
      expect(() => fs.lstatSync(path.join(repoDir, 'weird', 'secret.log'))).toThrow();

      const oracle = createGitignoreOracle(repoDir);

      // 命中预取清单 ⇒ 仍是 ignored（= 修复前的答案），**不得**退化成 undeterminable
      expect(oracle.verdict('weird/secret.log')).toBe('ignored');
      // 未命中清单的才落 undeterminable（消费方按 not-ignored 处理 = 修复前也是采集）
      expect(oracle.verdict('weird/keep.ts')).toBe('undeterminable');
    } finally {
      fs.chmodSync(path.join(repoDir, 'weird'), 0o755);
    }
  });

  // ============================================================
  // R1-8：KL-5 —— 在盘 symlink 穿越。**已知限制，非 bug**（本 fix 明确不修）
  // ============================================================

  it('R1-8: KL-5 已知限制（非 bug）——在盘 symlink 穿越判 not-ignored 且静默不计数', () => {
    createFile(repoDir, '.gitignore', 'ignored_dir/\n');
    createFile(repoDir, 'ignored_dir/f.ts', 'export {}');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);
    fs.symlinkSync('ignored_dir', path.join(repoDir, 'link_to_ign'));

    // git 本体的答案是"拒答"（exit 128：路径规格位于符号链接之后）
    let gitExit = 0;
    try {
      execFileSync('git', ['check-ignore', '-q', '--', 'link_to_ign/f.ts'], {
        cwd: repoDir,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (error) {
      gitExit = (error as { status?: number }).status ?? -1;
    }
    expect(gitExit).toBe(128);

    const oracle = createGitignoreOracle(repoDir);

    // lstat 对**中间段**跟随 ⇒ 判在盘 ⇒ L1 查表 MISS ⇒ not-ignored，且永远到不了 L2
    expect(oracle.verdict('link_to_ign/f.ts')).toBe('not-ignored');
    // 钉住"它确实是静默的"：不计数、不 warn
    expect(oracle.drainUndeterminable().count).toBe(0);
  });

  // ============================================================
  // R1-9：KL-6 —— 归一化 / 大小写前提。**已知限制，非 bug**
  // ============================================================

  it('R1-9: KL-6 已知限制（非 bug）——未归一化 / 大小写不一致的输入落在盘分支且静默', () => {
    createFile(repoDir, '.gitignore', 'ignored_dir/\n');
    createFile(repoDir, 'ignored_dir/f.ts', 'export {}');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);

    const caseInsensitiveFs = fs.existsSync(path.join(repoDir, 'IGNORED_DIR', 'f.ts'));
    const oracle = createGitignoreOracle(repoDir);

    // 前提满足（path.relative 产出形态 + 大小写一致）时不受影响
    expect(oracle.verdict('ignored_dir/f.ts')).toBe('ignored');

    // 未归一化形态：与磁盘无关，任何平台都可复现
    expect(oracle.verdict('./ignored_dir/f.ts')).toBe('not-ignored');

    if (!caseInsensitiveFs) {
      console.warn('[skip] R1-9 大小写分支：当前文件系统 case-sensitive，IGNORED_DIR/f.ts 不在盘，无法复现该形态');
    } else {
      expect(oracle.verdict('IGNORED_DIR/f.ts')).toBe('not-ignored');
    }

    // 两形态均落在盘分支 ⇒ 静默、不计数（这正是 KL-6 的"原病保留"）
    expect(oracle.drainUndeterminable().count).toBe(0);
  });

  // ============================================================
  // R1-10：git worktree 一致性（锁定不回退的回归护栏）
  // ============================================================

  it('R1-10: git worktree 内判定与主仓逐条一致', () => {
    createFile(repoDir, '.gitignore', 'legacy/\n*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    const wtDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'f258-wt-')), 'wt');
    try {
      git(['worktree', 'add', '-q', '-b', 'f258-wt-branch', wtDir]);

      const mainOracle = createGitignoreOracle(repoDir);
      const wtOracle = createGitignoreOracle(wtDir);

      for (const probe of ['legacy/old.ts', 'foo.gen.ts', 'src/a.ts', 'src/ghost.ts', 'legacy']) {
        expect(wtOracle.verdict(probe), `worktree 与主仓对 ${probe} 的判定必须一致`).toBe(
          mainOracle.verdict(probe),
        );
      }
    } finally {
      fs.rmSync(path.dirname(wtDir), { recursive: true, force: true });
    }
  });

  // ============================================================
  // KL-2：离盘不可判形态族（无差别 fail-loud 与 fail-open 都不可接受）
  // ============================================================

  describe('KL-2 已知限制：离盘不可判形态族（走 L2 得 exit 128）', () => {
    it('仓外绝对路径 / `..` 越界 / 空串 ⇒ undeterminable', () => {
      createFile(repoDir, '.gitignore', '*.gen.ts\n');
      createFile(repoDir, 'src/a.ts', 'export {}');
      initRepo();
      commitAll();

      const oracle = createGitignoreOracle(repoDir);

      expect(oracle.verdict(path.join(os.tmpdir(), 'f258-outside-ghost.gen.ts'))).toBe(
        'undeterminable',
      );
      expect(oracle.verdict('../f258-outside-ghost.gen.ts')).toBe('undeterminable');
      expect(oracle.verdict('')).toBe('undeterminable');

      const drained = oracle.drainUndeterminable();
      expect(drained.count).toBe(3);
      expect(drained.budgetExhausted).toBe(false);
    });

    it('正式 submodule 内的离盘路径 ⇒ undeterminable', () => {
      const subSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'f258-submodule-src-'));
      try {
        initRepo(subSrc);
        createFile(subSrc, 'a.txt', 'hi');
        commitAll(subSrc);

        createFile(repoDir, '.gitignore', '*.gen.ts\n');
        createFile(repoDir, 'src/a.ts', 'export {}');
        initRepo();
        commitAll();
        try {
          git([
            '-c',
            'protocol.file.allow=always',
            'submodule',
            'add',
            '-q',
            subSrc,
            'sub',
          ]);
        } catch {
          console.warn('[skip] KL-2 submodule：本环境不允许 file:// submodule，无法构造该形态');
          return;
        }

        const oracle = createGitignoreOracle(repoDir);

        expect(oracle.verdict('sub/ghost.gen.ts')).toBe('undeterminable');
        expect(oracle.drainUndeterminable().count).toBe(1);
      } finally {
        fs.rmSync(subSrc, { recursive: true, force: true });
      }
    });
  });

  // ============================================================
  // L2 预算的具名出口（D7）
  // ============================================================

  it('L2 预算耗尽 ⇒ 后续离盘路径一律 undeterminable 且 budgetExhausted=true（l2-budget-exhausted）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    // l2BudgetMs=0：第一次 L2 查询照常发起，之后预算即判定耗尽（确定性，不依赖机器速度）
    const oracle = createGitignoreOracle(repoDir, repoDir, { l2BudgetMs: 0 });

    expect(oracle.verdict('first.gen.ts')).toBe('ignored');
    // 同样命中规则的离盘路径，因预算耗尽而"没去判"——判别力来自它本该是 ignored
    expect(oracle.verdict('second.gen.ts')).toBe('undeterminable');
    expect(oracle.verdict('third.gen.ts')).toBe('undeterminable');

    const drained = oracle.drainUndeterminable();
    expect(drained.count).toBe(2);
    expect(drained.budgetExhausted).toBe(true);
  });

  it('默认预算下不会误判耗尽（默认值必须显著大于单次查询成本）', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    const oracle = createGitignoreOracle(repoDir);

    expect(oracle.verdict('a.gen.ts')).toBe('ignored');
    expect(oracle.verdict('b.gen.ts')).toBe('ignored');
    expect(oracle.drainUndeterminable().budgetExhausted).toBe(false);
  });

  it('记忆化：同一路径重复发问只计一次 undeterminable', () => {
    createFile(repoDir, '.gitignore', '*.gen.ts\n');
    createFile(repoDir, 'src/a.ts', 'export {}');
    initRepo();
    commitAll();

    const oracle = createGitignoreOracle(repoDir);

    expect(oracle.verdict('../ghost.gen.ts')).toBe('undeterminable');
    expect(oracle.verdict('../ghost.gen.ts')).toBe('undeterminable');

    expect(oracle.drainUndeterminable().count).toBe(1);
  });
});
