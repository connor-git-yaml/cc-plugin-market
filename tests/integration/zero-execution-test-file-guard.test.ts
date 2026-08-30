/**
 * 零执行测试文件守卫（FR-011 / 决策 3）
 *
 * 见 specs/272-test-guard-asset-cleanup/contracts/zero-execution-test-file-guard.md。
 *
 * 覆盖域边界（诚实声明，异构对抗审查 F272 缺陷 7 后收窄措辞）：本守卫只能证明"磁盘侧存在的
 * `.test.ts`/`.spec.ts` 文件是否落在任一 vitest project 的 include 范围内"——不能证明"落在
 * include 范围内的文件一定会被真的执行到"。整文件 `describe.skip(...)`/`it.skip(...)` 这类
 * 形态仍会被 `vitest list --filesOnly` 收集（它只做 glob 匹配，不解析文件内容判断是否被跳过），
 * 因此**不在本守卫覆盖面内**，是已知边界而非缺陷。
 *
 * 断言：磁盘侧真实存在的 `*.test.ts`/`*.spec.ts` 集合 减去 vitest 实际会收集的集合，
 * 差集必须恰好等于一份显式白名单（附理由）。任何新增的"不在任何 vitest project include
 * 范围内"的测试文件都会让本守卫当场变红，封死 ①（src/panoramic/qa/__tests__ 陈旧副本）
 * 类缺陷的复发面。
 *
 * 磁盘侧事实源改用 git（F272 异构对抗审查缺陷 2/3 后的修法，而非早期版本的手写目录递归）：
 * - `git ls-files`（tracked）+ `git ls-files --others --exclude-standard`（未提交但磁盘存在的
 *   游离文件）取并集，天然遵循 `.gitignore`——不需要自己维护排除名单，也不会像早期版本那样
 *   把 `.claude/worktrees/<nested-checkout>/` 这类被 gitignore 的嵌套 worktree（`.gitignore:75`
 *   显式登记）扫进来。手写递归版本曾把这类嵌套 checkout 里的测试文件误判为"游离测试"，在
 *   本仓当前状态下会制造出四位数的假阳性（截至写这段注释时，仓库同级还并行着数个
 *   `.claude/worktrees/*` checkout）。
 * - `--others --exclude-standard` 是为了**仍能抓到新建但未提交的游离测试文件**——这正是
 *   缺陷 ① 的复发形态：一份测试文件被复制/新建但从未接入任何 project 的 include。
 * - 不再需要 `lstat` 判断符号链接：git 本身不会跟随符号链接枚举其指向的仓外内容（`_reference/`
 *   是指向仓外目录的符号链接），改用 git 后这个问题结构性消失，不是靠额外判断规避的。
 * - **磁盘存在性过滤是必需的**：`git ls-files`（不带 `--others`）报的是 git index 快照，
 *   工作区里存在"已 `rm` 但尚未 `git add`/`git rm` stage"的文件时，index 仍会把它算作
 *   tracked 而列出——这不是理论风险，F272 本卡开发过程中就实际出现过（`src/panoramic/qa/
 *   __tests__/` 下 8 个陈旧副本已从磁盘删除但改动尚未 stage）。若不加这道过滤，这 8 个磁盘上
 *   已不存在的路径会被枚举进 diskSet，而它们当然也不会出现在 vitest 收集集合里，从而产生
 *   8 条与白名单不符的幽灵差异，让守卫在正常开发流程中假红。因此磁盘侧事实源 MUST 是
 *   "git 记录到的路径" ∩ "fs.existsSync 为真"，而不是单纯的 git index 快照。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve('.');

interface WhitelistEntry {
  path: string;
  reason: string;
}

const ZERO_EXECUTION_WHITELIST: WhitelistEntry[] = [
  {
    path: 'tests/fixtures/graph-quality-ts/greeter-service.test.ts',
    reason:
      'TS/JS pinned graph fixture 的输入语料（被 spectra graph-only 构建器当作目标项目源码解析），' +
      '不是待执行的 vitest 测试文件；有意不落在任何 project 的 include 范围内',
  },
];

/**
 * 跑一条 `git` 只读枚举命令，返回按 NUL 分隔解析出的相对路径列表。
 *
 * 非零退出码必须 throw，不能吞成空数组——空集合会让下面的差集计算恒为空（诊断不出任何
 * 幽灵文件），等价于把整个守卫 fail-open 掉。
 */
function runGitLsFiles(args: string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      `\`git ${args.join(' ')}\` 退出码非 0（${result.status}）：\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }

  return result.stdout.split('\0').filter((entry) => entry.length > 0);
}

/**
 * 磁盘侧真实存在的 `.test.ts`/`.spec.ts` 集合：git 记录到的路径（tracked ∪ 未提交游离文件）
 * 与 `fs.existsSync` 求交集。见文件头注释——两个来源缺一不可。
 */
function collectDiskTestFiles(): string[] {
  const patterns = ['*.test.ts', '*.spec.ts'];
  const tracked = runGitLsFiles(['ls-files', '-z', '--', ...patterns]);
  const untracked = runGitLsFiles(['ls-files', '-z', '--others', '--exclude-standard', '--', ...patterns]);
  const candidates = new Set([...tracked, ...untracked]);
  return [...candidates]
    .filter((relPath) => existsSync(join(PROJECT_ROOT, relPath)))
    .sort();
}

/**
 * vitest 收集侧全集 —— 权威事实源，不自行解析 vitest.config.ts 的 include。
 * 输出行形如 `[project] path/to/file.test.ts`，剥掉行首 `[<project>] ` 前缀，
 * 而不是匹配路径里的目录名（写死 `(src|tests)/...` 会在其它顶层目录也被
 * include 收集时给出与事实相反的诊断）。同时接受 `.spec.ts` 后缀（`.claude/rules/tests.md`
 * 明确测试文件可以以 `.test.ts` 或 `.spec.ts` 结尾；本仓当前 0 个 `.spec.ts` 文件，
 * 但收集侧若不同步支持，一旦将来出现 `.spec.ts` 测试，磁盘侧与收集侧会同时漏检，
 * 差集恒为空，守卫对这类文件形同虚设）。
 */
function collectVitestFiles(): string[] {
  const result = spawnSync('npx', ['vitest', 'list', '--filesOnly'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
  });

  if (result.status !== 0) {
    throw new Error(
      `\`npx vitest list --filesOnly\` 退出码非 0（${result.status}）：\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }

  const lines = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const files: string[] = [];
  const linePattern = /^\[[^\]]+\]\s+(.+\.(?:test|spec)\.ts)$/;
  for (const line of lines) {
    const match = linePattern.exec(line);
    if (match) {
      files.push(match[1]);
    }
  }
  return files;
}

describe('零执行测试文件守卫（FR-011）', () => {
  it('磁盘侧存在但不在任何 vitest project include 范围内的 .test.ts/.spec.ts 文件必须恰好等于白名单', () => {
    const diskSet = new Set(collectDiskTestFiles());
    const collectedSet = new Set(collectVitestFiles());

    const diff = [...diskSet].filter((p) => !collectedSet.has(p)).sort();
    const whitelistPaths = ZERO_EXECUTION_WHITELIST.map((e) => e.path).sort();

    if (diff.join('\n') !== whitelistPaths.join('\n')) {
      const unexpected = diff.filter((p) => !whitelistPaths.includes(p));
      const message =
        `零执行测试文件守卫失败。差集与白名单不一致：\n` +
        `实际差集（${diff.length} 个）：\n${diff.map((p) => `  - ${p}`).join('\n')}\n` +
        `白名单（${whitelistPaths.length} 个）：\n${whitelistPaths.map((p) => `  - ${p}`).join('\n')}\n` +
        (unexpected.length > 0
          ? `意外条目（未被任何 vitest project 的 include 收集）：\n${unexpected
              .map((p) => `  - ${p}`)
              .join('\n')}\n`
          : '') +
        `提示：该文件未被任何 vitest project 的 include 收集，若为语料/fixture 文件请加入白名单并附理由；` +
        `若为遗漏的测试文件请检查 vitest.config.ts 的 include`;
      throw new Error(message);
    }

    expect(diff).toEqual(whitelistPaths);
  });
});
