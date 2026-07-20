/**
 * source-commit 单测（F217 T019）
 * 覆盖 FR-009/010：
 * - resolveSourceCommit 三分支（git 成功/非 git 仓库/命令报错，spyOn child_process.execFileSync）
 * - evaluateFreshness 四态（fresh/dirty/stale/unknown-provenance，用真实临时 git 仓库）
 * - git status --porcelain=v1 -z --untracked-files=all 解析覆盖 rename/删除/路径含空格/
 *   全新 untracked 目录四类场景
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveSourceCommit, evaluateFreshness, getDirtySourceExtensions } from './source-commit.js';
import { JavaLanguageAdapter } from '../../adapters/java-adapter.js';
import { GoLanguageAdapter } from '../../adapters/go-adapter.js';

// F217 T019：默认委托真实实现（evaluateFreshness 系列用例需要真实 git 行为，
// 不能全 mock）；resolveSourceCommit 三分支测试通过 mockImplementationOnce
// 临时覆盖单次调用，afterEach 还原为委托真实实现，避免污染后续用例。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const mockedExecFileSync = vi.mocked(execFileSync);
const defaultExecFileSyncImpl = mockedExecFileSync.getMockImplementation();

describe('resolveSourceCommit（mock child_process.execFileSync 单次覆盖）', () => {
  it('git 成功：返回 trim 后的 commit SHA', () => {
    mockedExecFileSync.mockImplementationOnce(() => 'abc123def456\n' as unknown as Buffer);
    const result = resolveSourceCommit('/fake/project');
    expect(result).toBe('abc123def456');
  });

  it('非 git 仓库：execFileSync 抛异常 → 返回 null（不抛出）', () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error('fatal: not a git repository');
    });
    expect(resolveSourceCommit('/fake/non-git-project')).toBeNull();
  });

  it('命令报错（如 git 不存在于 PATH）：返回 null（不抛出）', () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error('spawnSync git ENOENT');
    });
    expect(resolveSourceCommit('/fake/project')).toBeNull();
  });
});

// ============================================================
// evaluateFreshness：真实临时 git 仓库（不 mock，避免与真实 git 行为漂移）
// ============================================================

function realGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-commit-test-'));
  realGit(dir, ['init', '-q']);
  realGit(dir, ['config', 'user.email', 'test@example.com']);
  realGit(dir, ['config', 'user.name', 'Test']);
  return dir;
}

function commitAll(dir: string, message: string): string {
  realGit(dir, ['add', '-A']);
  realGit(dir, ['commit', '-q', '-m', message]);
  return realGit(dir, ['rev-parse', 'HEAD']).trim();
}

describe('evaluateFreshness（真实临时 git 仓库）', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('recordedSourceCommit 为 null → unknown-provenance', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(repoDir, 'init');
    const verdict = evaluateFreshness(null, repoDir);
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.recordedSourceCommit).toBeNull();
  });

  it('recordedSourceCommit 为 undefined（字段缺失，旧版本图产物）→ unknown-provenance', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(repoDir, 'init');
    const verdict = evaluateFreshness(undefined, repoDir);
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.recordedSourceCommit).toBeUndefined();
  });

  it('currentHead 无法解析（非 git 目录）→ unknown-provenance，绝不据此比较出 stale', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-commit-nongit-'));
    try {
      const verdict = evaluateFreshness('deadbeef', nonGitDir);
      expect(verdict.state).toBe('unknown-provenance');
      expect(verdict.currentHead).toBeNull();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('sourceCommit 与当前 HEAD 一致、工作树无改动 → fresh', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('fresh');
    expect(verdict.currentHead).toBe(head);
  });

  it('sourceCommit 与当前 HEAD 不一致 → stale', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const firstHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'export const b = 2;\n');
    const secondHead = commitAll(repoDir, 'second');
    const verdict = evaluateFreshness(firstHead, repoDir);
    expect(verdict.state).toBe('stale');
    expect(verdict.recordedSourceCommit).toBe(firstHead);
    expect(verdict.currentHead).toBe(secondHead);
  });

  it('sourceCommit 与 HEAD 一致，但存在未提交的源码文件改动 → dirty', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('a.ts');
  });

  it('未提交改动仅涉及非源码文件（如 README.md）→ 不触发 dirty（过滤面按源码扩展名）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# hello\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# updated\n');
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('fresh');
  });

  it('porcelain 解析 - 删除源码文件 → dirty，dirtyFiles 含被删除路径', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'gone.ts'), 'export const gone = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.rmSync(path.join(repoDir, 'gone.ts'));
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('gone.ts');
  });

  it('porcelain 解析 - rename（git mv + stage）→ dirty，dirtyFiles 含新旧两条路径', () => {
    fs.writeFileSync(
      path.join(repoDir, 'old_name.ts'),
      'export const value = 1;\nexport const pad1 = 2;\nexport const pad2 = 3;\n',
    );
    const head = commitAll(repoDir, 'init');
    realGit(repoDir, ['mv', 'old_name.ts', 'new_name.ts']);
    realGit(repoDir, ['add', '-A']);
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('new_name.ts');
    expect(verdict.dirtyFiles).toContain('old_name.ts');
  });

  it('porcelain 解析 - 路径含空格 → dirty 正确解析（-z 协议不引入引号转义歧义）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'my file.ts'), 'export const b = 1;\n');
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('my file.ts');
  });

  it('porcelain 解析 - 全新 untracked 目录（--untracked-files=all 逐文件展开，不折叠为单条目录记录）→ dirty', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.mkdirSync(path.join(repoDir, 'newdir'));
    fs.writeFileSync(path.join(repoDir, 'newdir', 'inner.ts'), 'export const inner = 1;\n');
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('newdir/inner.ts');
  });

  it('detached HEAD 场景：rev-parse 正常解析出具体 SHA，不写 null', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    realGit(repoDir, ['checkout', '-q', head]);
    const resolved = resolveSourceCommit(repoDir);
    expect(resolved).toBe(head);
  });

  // ============================================================
  // FIX-3（Codex WARNING）：porcelain 读取失败 → 保守判 dirty，而非误判 fresh
  // ============================================================

  it('FIX-3 红测试：git status --porcelain 读取失败（模拟 ENOBUFS）→ 保守判 dirty 且 porcelainReadFailed=true', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');

    mockedExecFileSync.mockImplementation((cmd, args, options) => {
      if (Array.isArray(args) && args[0] === 'status') {
        throw Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' });
      }
      return defaultExecFileSyncImpl!(cmd, args, options);
    });

    try {
      const verdict = evaluateFreshness(head, repoDir);
      expect(verdict.state).toBe('dirty');
      expect(verdict.porcelainReadFailed).toBe(true);
      // rev-parse 分支语义不变：仍能正常解析出 currentHead
      expect(verdict.currentHead).toBe(head);
    } finally {
      mockedExecFileSync.mockImplementation(defaultExecFileSyncImpl!);
    }
  });

  it('rev-parse 的 catch 语义不受 FIX-3 影响：非 git 仓库仍判 unknown-provenance（不受 porcelain 修复干扰）', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-commit-nongit-fix3-'));
    try {
      const verdict = evaluateFreshness('deadbeef', nonGitDir);
      expect(verdict.state).toBe('unknown-provenance');
      expect(verdict.currentHead).toBeNull();
      expect(verdict.porcelainReadFailed).toBeUndefined();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// FIX-4（Codex WARNING）：dirty 扩展名集合与生产者对齐（一致性测试防漂移）
// ============================================================

describe('getDirtySourceExtensions（FIX-4：一致性防漂移）', () => {
  it('导出集合 === TSJS 采集扩展 ∪ {".py"} ∪ JavaLanguageAdapter().extensions ∪ GoLanguageAdapter().extensions', () => {
    const expected = new Set<string>([
      '.ts', '.tsx', '.js', '.jsx',
      '.py',
      ...new JavaLanguageAdapter().extensions,
      ...new GoLanguageAdapter().extensions,
    ]);
    const actual = getDirtySourceExtensions();
    expect(actual).toEqual(expected);
  });

  it('大小写严格匹配（不做 toLowerCase 归一化）：生产者不收 .TS，freshness 也不该把它算 dirty', () => {
    const extensions = getDirtySourceExtensions();
    expect(extensions.has('.ts')).toBe(true);
    expect(extensions.has('.TS')).toBe(false);
  });
});

describe('evaluateFreshness：大小写严格匹配（真实临时 git 仓库，FIX-4）', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('未提交改动仅涉及大写 .TS 扩展名文件 → 不触发 dirty（生产者不扫描 .TS，大小写严格匹配）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'legacy.TS'), 'export const b = 1;\n');
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('fresh');
  });
});
