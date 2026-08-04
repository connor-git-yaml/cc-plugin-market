/**
 * F255：采集面 ↔ freshness dirty 观测面一致性回归测试。
 *
 * 固化 fix-report 的 A1-A4 复现链：嵌套 `.gitignore` 覆盖的源码文件过去会被采集入图
 * （采集侧只读根 `.gitignore`），而 `git status` 不列出 ignored 文件 → 其改动永判 fresh。
 * 两侧对"哪个文件属于图的观测面"必须同向，否则就是隐性漏报。
 *
 * 全部用例使用真实 `git init` 构造的临时仓库——不 mock git 输出：本卡的整个论点就是
 * "采集侧要与 git 本体同源"，用假 git 输出会把同一份错误假设同时写进实现和测试。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectGenericLanguageCodeSkeletons } from '../../src/batch/generic-language-skeleton-collector.js';
import { evaluateFreshness } from '../../src/panoramic/graph/source-commit.js';
import { computeCollectorFingerprint } from '../../src/panoramic/graph/collector-fingerprint.js';

/** 写文件（自动建父目录）。 */
function writeFile(base: string, relativePath: string, content: string): void {
  const fullPath = path.join(base, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * 构造 fix-report A1-A4 的场景仓库：
 * - `main.go`：tracked 对照组
 * - `sub/.gitignore` 声明 `*.go` → `sub/foo.go` 为 untracked + ignored 的真实源码
 * - 根 `.gitignore` 为空：只有读取嵌套规则才能发现 `sub/foo.go` 被忽略
 */
function setupScenarioRepo(dir: string): string {
  writeFile(dir, '.gitignore', '');
  writeFile(dir, 'main.go', 'package main\n\nfunc Main() {}\n');
  writeFile(dir, 'sub/.gitignore', '*.go\n');
  writeFile(dir, 'sub/foo.go', 'package sub\n\nfunc Foo() {}\n');

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'f252-test@example.com']);
  git(dir, ['config', 'user.name', 'F255 Test']);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'initial']);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

/** 采集入口返回绝对路径 key，统一转为相对仓库根的 POSIX 路径便于断言。 */
async function collectRelativePaths(repoRoot: string): Promise<Set<string>> {
  const skeletons = await collectGenericLanguageCodeSkeletons(repoRoot);
  return new Set(
    [...skeletons.keys()].map((abs) => path.relative(repoRoot, abs).split(path.sep).join('/')),
  );
}

describe('F255 采集面与 freshness dirty 观测面一致性（真实 git 仓库）', () => {
  let repoRoot: string;
  let headSha: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f252-consistency-'));
    headSha = setupScenarioRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('用例 A：嵌套 .gitignore 覆盖的文件不应出现在采集结果中（fix-report A1 方向反转）', async () => {
    const collected = await collectRelativePaths(repoRoot);

    // 对照：tracked 源码正常入图（证明采集链路本身工作，排除"全都没采到"的假绿）
    expect(collected.has('main.go')).toBe(true);
    // 核心：sub/.gitignore 声明的 *.go 不得进入采集面
    expect(collected.has('sub/foo.go')).toBe(false);
  });

  it('用例 B：同一文件在采集面与 dirty 观测面的判定同向', async () => {
    const collected = await collectRelativePaths(repoRoot);

    /** 改动某文件后，freshness 判定是否把它算进 dirty 观测面。 */
    const reportedDirty = (relativePath: string): boolean => {
      const fullPath = path.join(repoRoot, relativePath);
      const original = fs.readFileSync(fullPath, 'utf-8');
      try {
        fs.writeFileSync(fullPath, `${original}\n// F255 probe\n`);
        const verdict = evaluateFreshness(headSha, repoRoot, computeCollectorFingerprint());
        return verdict.state === 'dirty' && (verdict.dirtyFiles ?? []).includes(relativePath);
      } finally {
        fs.writeFileSync(fullPath, original);
      }
    };

    for (const relativePath of ['main.go', 'sub/foo.go']) {
      expect(
        collected.has(relativePath),
        `${relativePath} 在采集面(${collected.has(relativePath)})与 dirty 观测面(${reportedDirty(relativePath)})的判定必须同向`,
      ).toBe(reportedDirty(relativePath));
    }
  });

  it('用例 C：tracked 对照组改动仍正确判 dirty（fix-report A4 不受本次修复影响）', () => {
    fs.appendFileSync(path.join(repoRoot, 'main.go'), '\n// touched\n');

    const verdict = evaluateFreshness(headSha, repoRoot, computeCollectorFingerprint());

    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('main.go');
  });
});
