/**
 * git-hook-installer.ts 单元测试
 * 使用 mkdtempSync 构建含 .git 结构的临时目录，beforeEach/afterEach 清理，不 mock 模块
 * 覆盖：post-commit 追加/幂等/卸载/权限/错误处理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  installGitHook,
  removeGitHook,
  generatePostCommitSegment,
  resolveHookPath,
} from '../../src/hooks/git-hook-installer.js';

/** 创建含真实 .git/hooks/ 结构的临时目录 */
function makeTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-git-test-'));
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

/** 创建不含 .git/ 的普通临时目录 */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-nongit-test-'));
}

/** 读取 post-commit 文件内容 */
function readPostCommit(dir: string): string {
  return fs.readFileSync(path.join(dir, '.git', 'hooks', 'post-commit'), 'utf-8');
}

describe('git-hook-installer', () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── generatePostCommitSegment 测试 ───────────────────────────────────────

  describe('generatePostCommitSegment()', () => {
    beforeEach(() => {
      tmpDir = makeTempGitRepo();
    });

    it('输出包含 # --- spectra begin ---', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('# --- spectra begin ---');
    });

    it('输出包含 # --- spectra end ---', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('# --- spectra end ---');
    });

    it('建图命令为 spectra batch --mode graph-only，不再是读缓存的 spectra graph（F266 FR-003）', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('spectra batch --mode graph-only');
      // 旧命令不解析源码，会把完整图覆写成贫图 —— 段落里不得再出现
      expect(segment).not.toMatch(/spectra graph\b/);
    });

    it('超时保护提到 180s（graph-only 需真解析源码，30s 会稳定被误杀）（F266 FR-003）', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('180');
      expect(segment).toContain('kill');
      // 旧的 30s 超时值不得残留
      expect(segment).not.toMatch(/sleep 30\b/);
    });

    it('产物与成败诊断全部落日志文件，不再全静默（F266 FR-003 / 对抗审查 B1）', () => {
      const segment = generatePostCommitSegment();
      // 日志落 git dir，不污染工作区
      expect(segment).toContain('git rev-parse --git-dir');
      expect(segment).toContain('spectra-post-commit.log');
      // D6：建图产物本身 **append**（`>` 会让下一次运行截掉上一次刚写的失败标记）
      expect(segment).toContain('>> "$_spectra_log" 2>&1');
      expect(segment).not.toMatch(/spectra batch --mode graph-only > "/);
      // 超时分支：append 到日志（`>>`），而不是覆写、也不是打 stderr
      expect(segment).toMatch(/echo "\[spectra\] graph rebuild timed out[^\n]*>> "\$_spectra_log"/);
      // 失败分支（exit != 0）同样留痕，否则失败与成功在事后完全不可分
      expect(segment).toContain('wait "$_spectra_pid"');
      expect(segment).toMatch(/echo "\[spectra\] graph rebuild failed \(exit \$_spectra_exit\)"[^\n]*>> "\$_spectra_log"/);
    });

    it('外层子 shell MUST 重定向 stdout/stderr 到 /dev/null（对抗审查 B1：fd 泄漏会阻塞 commit）', () => {
      const segment = generatePostCommitSegment();
      // 承重断言：不释放继承自 git 的 fd，任何按 EOF 读 commit 输出的消费方
      // （命令替换 / CI / IDE）都会被拖到 spectra 结束（实测 7s，上限 180s）。
      // `&` 只让进程后台化，给不了这个保证。
      expect(segment).toContain(') > /dev/null 2>&1 &');
      // 诊断信息因此一律不得走 stderr —— 那正是上面要释放掉的那个 fd
      expect(segment).not.toMatch(/>&2/);
    });

    it('D6：每次运行写 run header + 超阈值轮转，日志 append 不会无界增长', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toMatch(/echo "\[spectra\] === run \$\(date[^\n]*>> "\$_spectra_log"/);
      expect(segment).toContain('_spectra_log.old');
      expect(segment).toContain('204800');
    });

    it('D6：并发闸用 mkdir 抢锁，抢不到只记一行就退出（不抢跑同一份 graph.json）', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('spectra-rebuild.lock');
      expect(segment).toContain('mkdir "$_spectra_lock"');
      expect(segment).toContain('skipped: another rebuild in progress');
      // 释放锁：正常结束与超时 kill 两条路径都会走到子 shell 末尾这一句
      expect(segment).toContain('rmdir "$_spectra_lock"');
      // 僵尸锁回收阈值必须 > 超时值，否则会把还活着的重建的锁抢走
      expect(segment).toContain('-mmin +4');
    });

    it('E1：僵尸锁回收走 mv 原子认领，rmdir 绝不落在锁路径本身（除释放外）', () => {
      const segment = generatePostCommitSegment();
      // 认领：目录 rename 只可能有一个赢家；输给别人的 racer 直接走让位分支
      expect(segment).toContain('_spectra_claim="$_spectra_lock.stale.$$"');
      expect(segment).toContain('mv "$_spectra_lock" "$_spectra_claim"');
      expect(segment).toContain('rmdir "$_spectra_claim"');
      // 承重：`rmdir "$_spectra_lock"` 只允许出现一次——本轮结束时的释放。
      // 回收路径上再出现一次，就是 E1 那条"删掉别人刚建好的活锁"的通路。
      expect((segment.match(/rmdir "\$_spectra_lock"/g) ?? []).length).toBe(1);
      // 判 stale 仍用 find -mmin，但它只决定"要不要尝试认领"
      expect(segment).toContain('-mmin +4');
    });

    it('E2：让位者留下重建请求标记，持锁者据此补跑（上限 2 轮）', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain('spectra-rebuild-requested');
      expect(segment).toContain('touch "$_spectra_requested"');
      // 消费点：本轮收尾后检查标记；无标记才 break
      expect(segment).toContain('[ -f "$_spectra_requested" ] || break');
      expect(segment).toContain('rm -f "$_spectra_requested"');
      // 有界：提交风暴不得把 hook 变成常驻重建器
      expect(segment).toContain('"$_spectra_pass" -ge 2');
    });

    it('INFO-3：超时 kill 之后必须先 wait 收尸，再走到释放锁那一行', () => {
      const segment = generatePostCommitSegment();
      // kill 与 wait 之间只允许注释/空白，不允许插入释放锁等其他动作
      expect(segment).toMatch(
        /kill "\$_spectra_pid" 2>\/dev\/null\n(?:\s*#[^\n]*\n)*\s*wait "\$_spectra_pid"/,
      );
    });

    it('生成的段落是合法 POSIX sh（sh -n 语法检查）', () => {
      tmpDir = makeTempGitRepo();
      const scriptPath = path.join(tmpDir, 'segment.sh');
      fs.writeFileSync(scriptPath, `#!/bin/sh\n${generatePostCommitSegment()}`, 'utf-8');
      // 语法错误会让 sh -n 非零退出并抛 —— 段落一旦写坏，用户每次 commit 都会看到报错
      expect(() => execFileSync('sh', ['-n', scriptPath])).not.toThrow();
    });

    it('包含文档提示 echo（FR-010）', () => {
      const segment = generatePostCommitSegment();
      expect(segment).toContain("[spectra] Docs changed");
    });
  });

  // ─── D6 实跑：两连发 commit 的日志留存 ────────────────────────────────────

  describe('D6 实跑：连续两次 commit 后，前一次的失败标记必须存活', () => {
    /**
     * 把 PATH 里所有能找到 `spectra` 的目录剔掉 —— 让 hook 内的建图命令稳定 `command not found`
     * （exit 127）。目的不是测建图，而是测**失败留痕**：这正是 `>` 覆写会吃掉的那条信息。
     * 用剔除法而不是硬写 `/usr/bin:/bin`，是为了不假设宿主机把 git 放在哪。
     */
    function pathWithoutSpectra(): string {
      const entries = (process.env['PATH'] ?? '').split(path.delimiter);
      return entries.filter((d) => d.length > 0 && !fs.existsSync(path.join(d, 'spectra'))).join(path.delimiter);
    }

    function commit(dir: string, file: string, env: NodeJS.ProcessEnv): void {
      fs.writeFileSync(path.join(dir, file), `// ${file}\n`, 'utf-8');
      execFileSync('git', ['add', '.'], { cwd: dir, env });
      execFileSync('git', ['commit', '-q', '-m', file], { cwd: dir, env });
    }

    /** 等到日志里出现 `expected` 条**已完成**的运行标记（run header 先于命令结束写下，等它会踩竞态） */
    async function waitForCompletedRuns(logPath: string, expected: number, budgetMs = 30_000): Promise<string> {
      const deadline = Date.now() + budgetMs;
      let content = '';
      while (Date.now() < deadline) {
        content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
        if ((content.match(/graph rebuild failed/g) ?? []).length >= expected) return content;
        await new Promise((r) => setTimeout(r, 200));
      }
      return content;
    }

    it('两次 commit → 日志里两条 run header + 两条失败标记（`>` 覆写下这里只会剩 1 条）', async () => {
      tmpDir = makeTempDir();
      const env = { ...process.env, PATH: pathWithoutSpectra() };
      execFileSync('git', ['init', '-q'], { cwd: tmpDir, env });
      execFileSync('git', ['config', 'user.email', 'f266@example.com'], { cwd: tmpDir, env });
      execFileSync('git', ['config', 'user.name', 'F266'], { cwd: tmpDir, env });
      installGitHook(tmpDir);
      const logPath = path.join(tmpDir, '.git', 'spectra-post-commit.log');

      // 首个 commit 没有 HEAD~1，hook 内 `git diff HEAD~1 HEAD` 为空 → 不触发重建
      commit(tmpDir, 'seed.ts', env);
      commit(tmpDir, 'a.ts', env);
      const afterFirst = await waitForCompletedRuns(logPath, 1);
      expect(afterFirst).toContain('graph rebuild failed');
      const firstHeader = /=== run [^\n]*/.exec(afterFirst)?.[0] ?? '';
      expect(firstHeader.length).toBeGreaterThan(0);

      commit(tmpDir, 'b.ts', env);
      const afterSecond = await waitForCompletedRuns(logPath, 2);

      expect((afterSecond.match(/=== run /g) ?? []).length).toBe(2);
      expect((afterSecond.match(/graph rebuild failed/g) ?? []).length).toBe(2);
      // 承重：第二次运行后的日志是第一次那份的**严格前缀扩展**（append 语义）。
      // `>` 覆写下这里会整段被替换掉，第一次的失败标记连同 header 一起消失。
      expect(afterSecond).toContain(firstHeader);
      expect(afterSecond.startsWith(afterFirst)).toBe(true);
    }, 60_000);
  });

  // ─── E2 实跑：重建窗口内到来的 commit 必须被补跑一轮 ──────────────────────

  describe('E2 实跑：多 commit 序列不再定格在首个 commit 的树态', () => {
    /**
     * 假 `spectra`：把每次被调用时的 HEAD 追加到记录文件，然后睡 3 秒撑开重建窗口。
     * "重建输入是哪个树态"这件事在真 spectra 上只能靠图产物间接推断，用 HEAD 直接打印
     * 才是对 E2 的正面证明（图恒定格在序列首 commit ⇔ 记录里只有第一个 HEAD）。
     */
    function installFakeSpectra(repoDir: string, recordPath: string): string {
      // 放在 .git/ 下：既不进工作树（不污染 git status / diff），又随 repo 一起清理
      const binDir = path.join(repoDir, '.git', 'f266-bin');
      fs.mkdirSync(binDir, { recursive: true });
      const fake = path.join(binDir, 'spectra');
      fs.writeFileSync(
        fake,
        `#!/bin/sh\ngit rev-parse HEAD >> "${recordPath}"\nsleep 3\n`,
        'utf-8',
      );
      fs.chmodSync(fake, 0o755);
      return binDir;
    }

    function commit(dir: string, file: string, env: NodeJS.ProcessEnv): string {
      fs.writeFileSync(path.join(dir, file), `// ${file}\n`, 'utf-8');
      execFileSync('git', ['add', '.'], { cwd: dir, env });
      execFileSync('git', ['commit', '-q', '-m', file], { cwd: dir, env });
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env, encoding: 'utf-8' }).trim();
    }

    async function waitForLines(file: string, expected: number, budgetMs = 40_000): Promise<string[]> {
      const deadline = Date.now() + budgetMs;
      let lines: string[] = [];
      while (Date.now() < deadline) {
        lines = (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '')
          .split('\n')
          .filter((l) => l.length > 0);
        if (lines.length >= expected) return lines;
        await new Promise((r) => setTimeout(r, 200));
      }
      return lines;
    }

    it('重建进行中到来的第二个 commit：让位 + 标记 + 补跑，第二轮重建的输入是最新 HEAD', async () => {
      tmpDir = makeTempDir();
      const recordPath = path.join(tmpDir, '.git-record.txt');
      execFileSync('git', ['init', '-q'], { cwd: tmpDir });
      execFileSync('git', ['config', 'user.email', 'f266@example.com'], { cwd: tmpDir });
      execFileSync('git', ['config', 'user.name', 'F266'], { cwd: tmpDir });
      const binDir = installFakeSpectra(tmpDir, recordPath);
      const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}` };
      installGitHook(tmpDir);
      const logPath = path.join(tmpDir, '.git', 'spectra-post-commit.log');

      commit(tmpDir, 'seed.ts', env); // 无 HEAD~1，不触发重建
      const headA = commit(tmpDir, 'a.ts', env); // 触发 pass 1（睡 3s）
      await new Promise((r) => setTimeout(r, 800));
      const headB = commit(tmpDir, 'b.ts', env); // 落在重建窗口内 → 让位 + touch 标记

      const runs = await waitForLines(recordPath, 2);
      // 第二轮记录 HEAD 之后还要睡 3s 才结束，锁此刻**应当**仍被持有；等它自然释放再验收尾
      const lockPath = path.join(tmpDir, '.git', 'spectra-rebuild.lock');
      const releaseDeadline = Date.now() + 30_000;
      while (fs.existsSync(lockPath) && Date.now() < releaseDeadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      const log = fs.readFileSync(logPath, 'utf-8');

      // 承重：第二个 commit 没有被丢弃 —— 补跑的那一轮看到的是**最新**树态
      expect(runs.length, `重建只跑了 ${runs.length} 次；修复前这里恒为 1（图定格在首个 commit）`).toBe(2);
      expect(runs[runs.length - 1], '末轮重建的输入必须是最新 HEAD，否则图仍旧定格').toBe(headB);
      // 第一轮看到的是 A 还是 B 取决于负载：假 spectra 是被后台子 shell fork 出来的，
      // 满载时它可能晚于 commit B 才真正执行 `git rev-parse`。那是采样时刻的抖动，
      // 不是本卡的合同——故只约束"必是这两个之一"，不钉死为 A（钉死会造出一条负载敏感的假红）。
      expect([headA, headB]).toContain(runs[0]);
      // 让位与补跑两件事都必须在日志里留痕（失败只能靠日志发现，见 B1 的价格）
      expect(log).toContain('skipped: another rebuild in progress');
      expect(log).toContain('(pass 2)');
      // 锁最终释放，不留残留标记
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.git', 'spectra-rebuild-requested'))).toBe(false);
    }, 90_000);
  });

  // ─── FR-005 护栏：plugins/spectra/hooks/post-commit.sh 不受本卡影响 ──────────

  describe('FR-005：独立的 plugins/spectra/hooks/post-commit.sh 未被本卡改动', () => {
    /** 仓库内该脚本的相对路径（source of truth，与 git show 的 pathspec 同源） */
    const PLUGIN_HOOK_REL = 'plugins/spectra/hooks/post-commit.sh';
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

    beforeEach(() => {
      // 本 describe 不用临时目录，但 afterEach 会 rm tmpDir，给它一个可安全删除的空目录
      tmpDir = makeTempDir();
    });

    it('工作树内容与 HEAD 版本逐字节一致（本卡未触碰该文件）', () => {
      const onDisk = fs.readFileSync(path.join(repoRoot, PLUGIN_HOOK_REL));
      const committed = execFileSync('git', ['show', `HEAD:${PLUGIN_HOOK_REL}`], {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
      expect(sha(onDisk)).toBe(sha(committed));
    });

    it('仍走独立的 spectra index --incremental 路径，未被 F266 的 graph-only 命令污染', () => {
      const content = fs.readFileSync(path.join(repoRoot, PLUGIN_HOOK_REL), 'utf-8');
      expect(content).toContain('spectra index --incremental');
      expect(content).not.toContain('graph-only');
    });
  });

  // ─── installGitHook 测试 ──────────────────────────────────────────────────

  describe('installGitHook()', () => {
    it('.git/ 目录不存在时抛出含 .git directory not found 的错误（FR-013）', () => {
      tmpDir = makeTempDir();
      expect(() => installGitHook(tmpDir)).toThrow('.git directory not found');
    });

    it('post-commit 不存在时创建带 #!/bin/sh 头部的可执行文件（FR-009）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      expect(fs.existsSync(hookPath)).toBe(false);

      installGitHook(tmpDir);

      expect(fs.existsSync(hookPath)).toBe(true);
      const content = readPostCommit(tmpDir);
      expect(content).toContain('#!/bin/sh');
    });

    it('已存在非 spectra 内容时追加，原内容完整保留（FR-009）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const existingContent = '#!/bin/sh\necho "other hook"\n';
      fs.writeFileSync(hookPath, existingContent, 'utf-8');
      fs.chmodSync(hookPath, 0o755);

      installGitHook(tmpDir);

      const content = readPostCommit(tmpDir);
      // 原内容保留
      expect(content).toContain('echo "other hook"');
      // spectra 段落追加
      expect(content).toContain('# --- spectra begin ---');
    });

    it('幂等：标记已存在时跳过，不重复追加（FR-009）', () => {
      tmpDir = makeTempGitRepo();
      installGitHook(tmpDir);
      installGitHook(tmpDir);

      const content = readPostCommit(tmpDir);
      // 只有一个 spectra begin 标记
      const count = (content.match(/# --- spectra begin ---/g) ?? []).length;
      expect(count).toBe(1);
    });

    it('安装后文件具有可执行权限', () => {
      tmpDir = makeTempGitRepo();
      installGitHook(tmpDir);

      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const stat = fs.statSync(hookPath);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });
  });

  // ─── removeGitHook 测试 ───────────────────────────────────────────────────

  describe('removeGitHook()', () => {
    it('精确删除标记段落，非 spectra 内容完整保留（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const otherContent = '#!/bin/sh\necho "other"\n';
      fs.writeFileSync(hookPath, otherContent, 'utf-8');
      fs.chmodSync(hookPath, 0o755);

      installGitHook(tmpDir);
      removeGitHook(tmpDir);

      const content = readPostCommit(tmpDir);
      // spectra 段落已删除
      expect(content).not.toContain('# --- spectra begin ---');
      expect(content).not.toContain('# --- spectra end ---');
      expect(content).not.toContain('nohup spectra graph');
      // 其他内容保留
      expect(content).toContain('echo "other"');
    });

    it('removeGitHook 后文件保持可执行权限（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      installGitHook(tmpDir);
      removeGitHook(tmpDir);

      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      const stat = fs.statSync(hookPath);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });

    it('post-commit 不存在时静默退出（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      // 不安装直接卸载
      expect(() => removeGitHook(tmpDir)).not.toThrow();
    });

    it('post-commit 存在但无 spectra 标记时静默退出（FR-012）', () => {
      tmpDir = makeTempGitRepo();
      const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-commit');
      fs.writeFileSync(hookPath, '#!/bin/sh\necho "no spectra"\n', 'utf-8');

      expect(() => removeGitHook(tmpDir)).not.toThrow();
      // 原内容未改变
      const content = readPostCommit(tmpDir);
      expect(content).toContain('echo "no spectra"');
    });
  });

  // ─── resolveHookPath + worktree 支持测试 ─────────────────────────────────

  describe('resolveHookPath()', () => {
    it('普通仓库：.git 是目录时返回 .git/hooks/post-commit', () => {
      tmpDir = makeTempGitRepo();
      const result = resolveHookPath(tmpDir);
      expect(result).toBe(path.join(tmpDir, '.git', 'hooks', 'post-commit'));
    });

    it('.git 不存在时抛出错误', () => {
      tmpDir = makeTempDir();
      expect(() => resolveHookPath(tmpDir)).toThrow('.git directory not found');
    });

    it('worktree：.git 是文件时解析 gitdir 并返回正确的 hook 路径', () => {
      tmpDir = makeTempDir();

      // 模拟 worktree 的 .git 文件结构：
      // tmpDir/.git → 文件，内容: "gitdir: /some/path/.git/worktrees/my-worktree"
      // 对应的 hooks 目录: /some/path/.git/worktrees/my-worktree/hooks/
      const fakeGitDir = path.join(tmpDir, 'actual-git-dir', 'worktrees', 'wt-1');
      fs.mkdirSync(fakeGitDir, { recursive: true });

      // 写入 .git 文件（模拟 worktree）
      fs.writeFileSync(path.join(tmpDir, '.git'), `gitdir: ${fakeGitDir}\n`, 'utf-8');

      const result = resolveHookPath(tmpDir);
      expect(result).toBe(path.join(fakeGitDir, 'hooks', 'post-commit'));
    });

    it('worktree：.git 文件格式错误时抛出可识别错误', () => {
      tmpDir = makeTempDir();
      fs.writeFileSync(path.join(tmpDir, '.git'), 'invalid content\n', 'utf-8');

      expect(() => resolveHookPath(tmpDir)).toThrow('Cannot parse .git file');
    });
  });

  describe('worktree 场景下 installGitHook / removeGitHook', () => {
    it('worktree 场景下安装和卸载 hook 正确写入 gitdir 指向的 hooks 目录', () => {
      tmpDir = makeTempDir();

      // 构造模拟 worktree 结构
      const fakeGitDir = path.join(tmpDir, 'actual-git-dir', 'worktrees', 'wt-1');
      fs.mkdirSync(fakeGitDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.git'), `gitdir: ${fakeGitDir}\n`, 'utf-8');

      // 安装
      installGitHook(tmpDir);

      // 验证 hook 写入了正确位置
      const hookPath = path.join(fakeGitDir, 'hooks', 'post-commit');
      expect(fs.existsSync(hookPath)).toBe(true);
      const content = fs.readFileSync(hookPath, 'utf-8');
      expect(content).toContain('# --- spectra begin ---');

      // 卸载
      removeGitHook(tmpDir);
      const updated = fs.readFileSync(hookPath, 'utf-8');
      expect(updated).not.toContain('# --- spectra begin ---');
    });
  });
});
