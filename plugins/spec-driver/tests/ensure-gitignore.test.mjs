/**
 * ensure-gitignore.test.mjs
 * Feature 207 — init 脚手架污染用户 repo git diff + .spec-driver-path 绝对路径泄漏
 *
 * 覆盖共享库 lib/ensure-gitignore.sh 及其两个调用方（init-project.sh / postinstall.sh）
 * 的 .gitignore 自举行为（幂等 + 非 git 目录安全 + 精确整行匹配 + 末尾无换行边界）。
 *
 * 测试策略：spawn bash 于 fs.mkdtempSync 临时目录，断言 .gitignore 落盘内容 / stdout 信号 / mtime。
 *
 * 运行方式: node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const LIB_PATH = path.join(SCRIPTS_DIR, 'lib', 'ensure-gitignore.sh');
const INIT_SCRIPT = path.join(SCRIPTS_DIR, 'init-project.sh');
const POSTINSTALL_SCRIPT = path.join(SCRIPTS_DIR, 'postinstall.sh');

const EXPECTED_ENTRIES = [
  '.specify/.spec-driver-path',
  '.specify/runs/',
  '.specify/scorecards/',
  '.specify/templates/',
];

// W5（环境健壮性）：受限沙箱里 os.tmpdir() 可能 EPERM；允许 TEST_TMPDIR 覆盖落点。
const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

function createTempDir() {
  return fs.mkdtempSync(path.join(TMP_BASE, 'gitignore-test-'));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

/**
 * source 共享库并对临时目录调用 ensure_spec_driver_gitignore，返回 { stdout, status }。
 */
function callEnsure(projectRoot) {
  const script = `source "${LIB_PATH}"; ensure_spec_driver_gitignore "${projectRoot}"`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { stdout: res.stdout.trim(), status: res.status };
}

/**
 * source 共享库并对临时目录调用 ensure_spec_driver_git_exclude，返回 { stdout, status }。
 */
function callEnsureExclude(projectRoot) {
  const script = `source "${LIB_PATH}"; ensure_spec_driver_git_exclude "${projectRoot}"`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { stdout: res.stdout.trim(), status: res.status };
}

/** 在临时目录初始化一个真实 git repo（.git 为目录）。 */
function gitInit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir });
}

function readExclude(dir) {
  return fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
}

function readGitignore(dir) {
  return fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
}

/** 逐条精确整行匹配某条目在文件中出现的次数（幂等断言用）。 */
function countExactLine(content, entry) {
  return content.split('\n').filter((line) => line === entry).length;
}

describe('ensure-gitignore.sh 共享库', () => {
  it('用例 1：全新注入 — 无 .gitignore 时创建含注释头 + 4 行条目，stdout=created:4', () => {
    const dir = createTempDir();
    try {
      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'created:4');

      const content = readGitignore(dir);
      assert.match(content, /# Spec Driver 本地缓存与运行态/, '应含注释头');
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(countExactLine(content, entry), 1, `应含且仅含一条 ${entry}`);
      }
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 2：幂等重跑 — 第二次返回 ready:0 且 mtime 不变', () => {
    const dir = createTempDir();
    try {
      const first = callEnsure(dir);
      assert.equal(first.stdout, 'created:4');

      const gitignorePath = path.join(dir, '.gitignore');
      const mtimeAfterFirst = fs.statSync(gitignorePath).mtimeMs;
      const contentAfterFirst = readGitignore(dir);

      const second = callEnsure(dir);
      assert.equal(second.status, 0);
      assert.equal(second.stdout, 'ready:0');

      const mtimeAfterSecond = fs.statSync(gitignorePath).mtimeMs;
      assert.equal(mtimeAfterSecond, mtimeAfterFirst, '幂等重跑不得触碰文件（mtime 不变）');
      assert.equal(readGitignore(dir), contentAfterFirst, '文件内容不变');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 3：部分已存在 — 预写 2 条 + 无关行，追加缺失 2 条不重复，stdout=appended:2', () => {
    const dir = createTempDir();
    try {
      const initial = [
        'node_modules/',
        '.specify/runs/',
        'dist/',
        '.specify/templates/',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(dir, '.gitignore'), initial, 'utf8');

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'appended:2');

      const content = readGitignore(dir);
      // 已存在的 2 条不得重复
      assert.equal(countExactLine(content, '.specify/runs/'), 1);
      assert.equal(countExactLine(content, '.specify/templates/'), 1);
      // 缺失的 2 条被追加
      assert.equal(countExactLine(content, '.specify/.spec-driver-path'), 1);
      assert.equal(countExactLine(content, '.specify/scorecards/'), 1);
      // 无关行保留
      assert.equal(countExactLine(content, 'node_modules/'), 1);
      assert.equal(countExactLine(content, 'dist/'), 1);
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 4：无 .gitignore 且非 git 目录 — 仍正常创建（不依赖 .git/ 存在）', () => {
    const dir = createTempDir();
    try {
      // 显式确认无 .git/ 与无 .gitignore
      assert.equal(fs.existsSync(path.join(dir, '.git')), false);
      assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false);

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'created:4');
      assert.equal(fs.existsSync(path.join(dir, '.gitignore')), true);
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 5：末尾无换行 — 追加后原行与新行分行清晰，原内容未被污染', () => {
    const dir = createTempDir();
    try {
      // 写入不含尾随换行的内容
      fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/', 'utf8');

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'appended:4');

      const content = readGitignore(dir);
      // 原行独立成行且未被污染（不与后续条目粘连成 node_modules/.specify/...）
      assert.equal(countExactLine(content, 'node_modules/'), 1);
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(countExactLine(content, entry), 1, `应含且仅含一条 ${entry}`);
      }
      // 确认没有粘连行
      assert.doesNotMatch(content, /node_modules\/\.specify/, '原行不得与新增条目粘连');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 6：postinstall.sh 只写 .git/info/exclude — .gitignore 不被创建/改动，.spec-driver-path 仍正常写入', () => {
    const dir = createTempDir();
    gitInit(dir); // .git 须为目录，exclude 注入才生效
    // 预先确保安装 marker 存在以规避首装横幅；仅在缺失时创建，afterAll 只清理自己创建的
    const markerPath = path.join(os.homedir(), '.claude', '.spec-driver-installed');
    let createdMarker = false;
    if (!fs.existsSync(markerPath)) {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, '', 'utf8');
      createdMarker = true;
    }
    try {
      const res = spawnSync('bash', [POSTINSTALL_SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      });
      assert.equal(res.status, 0, 'postinstall 不得以非零退出（SessionStart hook 防御）');

      // .spec-driver-path 正常写入
      const pathFile = path.join(dir, '.specify', '.spec-driver-path');
      assert.equal(fs.existsSync(pathFile), true, '.spec-driver-path 应被写入');

      // .git/info/exclude 生成，含 4 条（主防线）
      const excludeContent = readExclude(dir);
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(countExactLine(excludeContent, entry), 1, `exclude 应含且仅含一条 ${entry}`);
      }

      // .gitignore 不被创建（伦理面：SessionStart hook 不静默修改用户 tracked 文件）
      assert.equal(
        fs.existsSync(path.join(dir, '.gitignore')),
        false,
        'postinstall（SessionStart hook）不得创建/修改 .gitignore',
      );
    } finally {
      cleanupTempDir(dir);
      if (createdMarker) {
        try {
          fs.rmSync(markerPath, { force: true });
        } catch {
          // 忽略：只清理测试自己创建的 marker
        }
      }
    }
  });

  it('用例 8：精确匹配非误判 — 预写宽松变体 .specify/runs/debug.log 时 .specify/runs/ 仍被追加，stdout=appended:4', () => {
    const dir = createTempDir();
    try {
      // 宽松变体（子路径）不得被整行精确匹配误判为已含 .specify/runs/
      fs.writeFileSync(path.join(dir, '.gitignore'), '.specify/runs/debug.log\n', 'utf8');

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'appended:4', '4 条目标条目均视为缺失，全部追加');

      const content = readGitignore(dir);
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(countExactLine(content, entry), 1, `应追加且仅一条 ${entry}`);
      }
      // 宽松变体原行保留
      assert.equal(countExactLine(content, '.specify/runs/debug.log'), 1, '宽松变体原行保留');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 9：并发安全 — 10 个并发调用同一目录，终态每条目仅 1 行（不 flaky）', async () => {
    const dir = createTempDir();
    try {
      // .specify/ 目录须存在（锁目录父路径），模拟两个调用方均先建 .specify/
      fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });

      const script = `source "${LIB_PATH}"; ensure_spec_driver_gitignore "${dir}"`;
      // 并发 spawn 10 个进程，await 全部退出后再断言终态（只断言终态唯一性，不断言过程）
      await Promise.all(
        Array.from(
          { length: 10 },
          () =>
            new Promise((resolve) => {
              const child = spawn('bash', ['-c', script], { stdio: 'ignore' });
              child.on('exit', () => resolve());
              child.on('error', () => resolve());
            }),
        ),
      );

      // 并发争用下：拿到锁的进程做写入，其余返回 skipped:0；终态每条目必须恰好一行
      const content = readGitignore(dir);
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(
          countExactLine(content, entry),
          1,
          `并发终态：${entry} 必须恰好一行（无重复追加）`,
        );
      }
      // 锁目录须已被释放（正常路径瞬态清理，不残留孤儿锁）
      assert.equal(
        fs.existsSync(path.join(dir, '.specify', '.ensure-gitignore.lock')),
        false,
        '并发结束后锁目录应已释放',
      );
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 10：CRLF 行尾 — 预写 CRLF 4 条目时返回 ready:0 且文件不被改动', () => {
    const dir = createTempDir();
    try {
      // 4 条目以 CRLF 行尾预写（模拟 Windows 编辑器产出的 .gitignore）
      const crlfContent = EXPECTED_ENTRIES.map((e) => `${e}\r\n`).join('');
      const gitignorePath = path.join(dir, '.gitignore');
      fs.writeFileSync(gitignorePath, crlfContent, 'utf8');
      const mtimeBefore = fs.statSync(gitignorePath).mtimeMs;
      const bytesBefore = fs.readFileSync(gitignorePath);

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'ready:0', 'CRLF 行尾不得误判为缺失');

      const mtimeAfter = fs.statSync(gitignorePath).mtimeMs;
      assert.equal(mtimeAfter, mtimeBefore, '就位时不得触碰文件（mtime 不变）');
      const bytesAfter = fs.readFileSync(gitignorePath);
      assert.ok(bytesBefore.equals(bytesAfter), '原文件字节（含 CRLF 行尾）不被改写');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 11：大文件 + pipefail — >100KB .gitignore 且 4 条目在头部时返回 ready:0 不重复追加', () => {
    const dir = createTempDir();
    try {
      // 4 条目置于文件头部 + 大量填充行使总大小 >100KB（远超 64KB pipe buffer）。
      // 在 set -euo pipefail 下，旧实现 `printf | grep -q` 会因 grep 头部匹配即退触发
      // 写端 SIGPIPE（管道退出码 141），被 pipefail 放大 → 条目误判缺失 → 重复追加。
      const head = EXPECTED_ENTRIES.join('\n');
      // 每行约 40 字节，3000 行 ≈ 120KB
      const filler = Array.from({ length: 3000 }, (_, i) =>
        `# spec-driver-large-gitignore-filler-line-${i}`,
      ).join('\n');
      const gitignorePath = path.join(dir, '.gitignore');
      const bigContent = `${head}\n${filler}\n`;
      fs.writeFileSync(gitignorePath, bigContent, 'utf8');
      assert.ok(
        fs.statSync(gitignorePath).size > 100 * 1024,
        '.gitignore 应 >100KB 以触发 pipe buffer 边界',
      );
      const bytesBefore = fs.readFileSync(gitignorePath);

      // 显式在 set -euo pipefail 下调用（复现生产调用方语义）
      const script = `set -euo pipefail; source "${LIB_PATH}"; ensure_spec_driver_gitignore "${dir}"`;
      const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
      assert.equal(res.status, 0, 'pipefail 下仍应零退出');
      assert.equal(res.stdout.trim(), 'ready:0', '4 条目已在头部，不得误判缺失而追加');

      const content = readGitignore(dir);
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(countExactLine(content, entry), 1, `${entry} 必须恰好一行（无重复追加）`);
      }
      const bytesAfter = fs.readFileSync(gitignorePath);
      assert.ok(bytesBefore.equals(bytesAfter), '就位时文件字节不得被改动');

      // 附加覆盖 here-string 尾随换行语义：目标条目恰为文件最后一行（原文件无尾随换行）时，
      // command substitution 剥掉 view 尾随换行、here-string 补一个 \n，grep -x 仍精确匹配为已存在。
      const lastLineDir = createTempDir();
      try {
        const p = path.join(lastLineDir, '.gitignore');
        // 末尾无 '\n'，最后一行即某个目标条目
        fs.writeFileSync(p, ['node_modules/', ...EXPECTED_ENTRIES].join('\n'), 'utf8');
        const script2 = `set -euo pipefail; source "${LIB_PATH}"; ensure_spec_driver_gitignore "${lastLineDir}"`;
        const r2 = spawnSync('bash', ['-c', script2], { encoding: 'utf8' });
        assert.equal(r2.status, 0);
        assert.equal(
          r2.stdout.trim(),
          'ready:0',
          '最后一行的目标条目（原文件无尾随换行）应被 grep -x 精确匹配为已存在',
        );
      } finally {
        cleanupTempDir(lastLineDir);
      }
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 7：init-project.sh --json 端到端（git repo）— RESULTS 含 git_exclude:* 与 gitignore:created:4 双信号', () => {
    const dir = createTempDir();
    gitInit(dir); // git repo → exclude 主防线生效
    try {
      const res = spawnSync('bash', [INIT_SCRIPT, '--json'], {
        encoding: 'utf8',
        cwd: dir,
      });
      assert.equal(res.status, 0, 'init-project.sh 应零退出');

      const parsed = JSON.parse(res.stdout);
      assert.ok(Array.isArray(parsed.RESULTS), 'RESULTS 应为数组');

      // gitignore 兜底防线信号
      const gitignoreSignal = parsed.RESULTS.find((r) => r.startsWith('gitignore:'));
      assert.ok(gitignoreSignal, 'RESULTS 应含 gitignore:* 信号');
      assert.equal(gitignoreSignal, 'gitignore:created:4');

      // git_exclude 主防线信号（git init 已生成默认 exclude 模板 → 追加 4 条为 injected:4）
      const excludeSignal = parsed.RESULTS.find((r) => r.startsWith('git_exclude:'));
      assert.ok(excludeSignal, 'RESULTS 应含 git_exclude:* 信号');
      assert.equal(excludeSignal, 'git_exclude:injected:4');

      // 两条防线均落盘 4 条
      const content = readGitignore(dir);
      const excludeContent = readExclude(dir);
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(countExactLine(content, entry), 1, `gitignore 应含 ${entry}`);
        assert.equal(countExactLine(excludeContent, entry), 1, `exclude 应含 ${entry}`);
      }
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 12：symlink 拒写（含 dangling）— .gitignore 为 symlink 时返回 failed:0 且不跟随写外部', () => {
    const dir = createTempDir();
    const outsideTarget = path.join(createTempDir(), 'outside-target');
    try {
      // dangling symlink：指向不存在的目标（[[ ! -f ]] 为真，若无 -L 前置检测会走创建分支）
      fs.symlinkSync(outsideTarget, path.join(dir, '.gitignore'));
      assert.equal(fs.existsSync(outsideTarget), false, '前置：外部目标不存在');

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'failed:0', 'symlink 一律拒写');

      // 关键安全断言：`>` 未跟随 symlink 在外部创建文件
      assert.equal(
        fs.existsSync(outsideTarget),
        false,
        'dangling symlink 不得被跟随写入外部路径',
      );
    } finally {
      cleanupTempDir(dir);
      cleanupTempDir(path.dirname(outsideTarget));
    }
  });

  it('用例 13：negation 尊重 — 预置 !.specify/templates/ 时该条跳过不追加，其余 3 条正常，negation 原行未动', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, '.gitignore'), '!.specify/templates/\n', 'utf8');

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'appended:3', 'negation 命中条目不计入追加');

      const content = readGitignore(dir);
      // 被 un-ignore 的条目不追加
      assert.equal(
        countExactLine(content, '.specify/templates/'),
        0,
        '尊重 negation：.specify/templates/ 不得追加',
      );
      // negation 原行保留
      assert.equal(countExactLine(content, '!.specify/templates/'), 1, 'negation 原行未动');
      // 其余 3 条正常追加
      assert.equal(countExactLine(content, '.specify/.spec-driver-path'), 1);
      assert.equal(countExactLine(content, '.specify/runs/'), 1);
      assert.equal(countExactLine(content, '.specify/scorecards/'), 1);
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 14：NUL 防御 — 含 NUL 字节的 .gitignore 返回 failed:0 且文件字节不变', () => {
    const dir = createTempDir();
    try {
      const p = path.join(dir, '.gitignore');
      // 含 NUL 的非法文本文件
      fs.writeFileSync(p, Buffer.from('foo\x00bar\n', 'utf8'));
      const bytesBefore = fs.readFileSync(p);

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'failed:0', '含 NUL 文件一律拒写');

      const bytesAfter = fs.readFileSync(p);
      assert.ok(bytesBefore.equals(bytesAfter), 'NUL 文件字节不得被改动');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 15：git_exclude 注入 + 幂等 — git repo 首次追加 4 条，重跑 ready:0 mtime 不变', () => {
    const dir = createTempDir();
    gitInit(dir);
    try {
      const first = callEnsureExclude(dir);
      assert.equal(first.status, 0);
      // git init 已生成默认 exclude 模板文件 → 追加 4 条为 appended:4（非 created）
      assert.equal(first.stdout, 'appended:4');

      const excludePath = path.join(dir, '.git', 'info', 'exclude');
      const content = readExclude(dir);
      for (const entry of EXPECTED_ENTRIES) {
        assert.equal(countExactLine(content, entry), 1, `exclude 应含且仅含一条 ${entry}`);
      }

      const mtimeAfterFirst = fs.statSync(excludePath).mtimeMs;
      const second = callEnsureExclude(dir);
      assert.equal(second.status, 0);
      assert.equal(second.stdout, 'ready:0', '幂等重跑');
      assert.equal(
        fs.statSync(excludePath).mtimeMs,
        mtimeAfterFirst,
        '幂等重跑不得触碰 exclude（mtime 不变）',
      );
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 16：git_exclude 非 git 目录 skipped — 无 .git 时返回 skipped:0，不创建任何文件', () => {
    const dir = createTempDir();
    try {
      assert.equal(fs.existsSync(path.join(dir, '.git')), false, '前置：非 git 目录');
      const { stdout, status } = callEnsureExclude(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'skipped:0', '非 git 目录跳过 exclude 注入');
      assert.equal(fs.existsSync(path.join(dir, '.git')), false, '不得创建 .git');
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 17：git_exclude worktree/submodule（.git 为文件）skipped — 返回 skipped:0，不解析 gitdir', () => {
    const dir = createTempDir();
    try {
      // 模拟 worktree/submodule：.git 为文件（gitdir 指针）而非目录
      fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /somewhere/else\n', 'utf8');
      const { stdout, status } = callEnsureExclude(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'skipped:0', '.git 为文件时跳过（由 .gitignore 覆盖）');
      // .git 文件内容未被改动
      assert.equal(
        fs.readFileSync(path.join(dir, '.git'), 'utf8'),
        'gitdir: /somewhere/else\n',
        '.git 指针文件不被改动',
      );
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 18：孤儿锁 skipped:0 — 预置残留锁目录时不抢占（W1 反 ABA），返回 skipped:0 且文件未动', () => {
    const dir = createTempDir();
    try {
      // 预置一个"孤儿"锁目录（模拟持锁进程被 SIGKILL 后残留）
      fs.mkdirSync(path.join(dir, '.specify', '.ensure-gitignore.lock'), { recursive: true });

      const { stdout, status } = callEnsure(dir);
      assert.equal(status, 0);
      assert.equal(stdout, 'skipped:0', '抢锁失败一律 skipped，不 stale 抢占（避免 ABA 重复写）');

      // 未做任何写入
      assert.equal(
        fs.existsSync(path.join(dir, '.gitignore')),
        false,
        '孤儿锁存在时不得写入 .gitignore',
      );
    } finally {
      cleanupTempDir(dir);
    }
  });

  it('用例 19：git_exclude 创建分支写入失败（.git/info 为普通文件）— 返回 failed:0，无 stderr 泄漏，.git/info 未被破坏', () => {
    const dir = createTempDir();
    try {
      gitInit(dir);
      // 把 .git/info 从目录改成普通文件 → `> .git/info/exclude` 必然 "Not a directory" 失败。
      // 修复前（复合命令组重定向 + `if !` 吞退出码）会误报 created:4 且泄漏 stderr；
      // 修复后（简单命令写入 + 2>/dev/null 前置）应转 failed:0 且静默。
      const infoPath = path.join(dir, '.git', 'info');
      fs.rmSync(infoPath, { recursive: true, force: true });
      fs.writeFileSync(infoPath, '', 'utf8');
      assert.equal(fs.statSync(infoPath).isFile(), true, '前置：.git/info 为普通文件');

      const script = `source "${LIB_PATH}"; ensure_spec_driver_git_exclude "${dir}"`;
      const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });

      assert.equal(res.status, 0, '始终零退出');
      assert.equal(res.stdout.trim(), 'failed:0', '写入必然失败 → failed:0（非误报 created:4）');
      assert.doesNotMatch(
        res.stderr,
        /Not a directory/,
        'stderr 不得泄漏 "Not a directory"（2>/dev/null 已前置于 >）',
      );
      // .git/info 仍是普通文件，未被破坏
      assert.equal(fs.statSync(infoPath).isFile(), true, '.git/info 仍是文件，未被破坏');
    } finally {
      cleanupTempDir(dir);
    }
  });
});
