/**
 * source-commit 单测（F217 T019）
 * 覆盖 FR-009/010：
 * - resolveSourceCommit 三分支（git 成功/非 git 仓库/命令报错，spyOn child_process.execFileSync）
 * - evaluateFreshness 四态（fresh/dirty/stale/unknown-provenance，用真实临时 git 仓库）
 * - git status --porcelain=v1 -z --untracked-files=all 解析覆盖 rename/删除/路径含空格/
 *   全新 untracked 目录四类场景
 *
 * F249 扩展：evaluateFreshness 第三参 `recordedFingerprint` + 五级优先级 + `staleReasons`
 * （FR-009/FR-010/FR-018，SC-001/002/003/003b/003c/004/007/009/017）。
 *
 * 注意既有用例的调用签名变化：**所有期待 `fresh` / `dirty` 的用例都必须显式传入当前指纹**——
 * 不传等价于"图未记录指纹"，按 FR-010 会归入 `collector-fingerprint-unrecorded` 而判 stale，
 * 这不是回归而是本机制的核心语义。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveSourceCommit, evaluateFreshness, isSourceTreeDirty, isCommitSha } from './source-commit.js';
import {
  BEHAVIOR_VERSION,
  computeCollectorFingerprint,
  type CollectorFingerprint,
} from './collector-fingerprint.js';

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
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('fresh');
    expect(verdict.currentHead).toBe(head);
  });

  // ── M11 卡 D（簇⑦）：source-commit 的语义 = 「sourceCommit 之后的提交是否改动了采集面源码」，
  // 而不是「HEAD 是否移动」——只改文档 / 图产物 / 账本的 commit 不应让图变 stale，
  // 否则每次 commit 后 repo:check 必 warn（F270 / F275 / F277 三次再现）。
  it('M11-D：sourceCommit 之后只有文档 / 图产物类 commit（未触及采集面）→ 不算 source-commit stale，仍 fresh', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const graphHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# docs only\n');
    fs.mkdirSync(path.join(repoDir, 'specs', '_meta'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'specs', '_meta', 'graph.json'), '{}\n');
    const docsHead = commitAll(repoDir, 'docs + graph artifact');
    expect(docsHead).not.toBe(graphHead);
    const verdict = evaluateFreshness(graphHead, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('fresh');
    expect(verdict.currentHead).toBe(docsHead);
  });

  it('M11-D：sourceCommit 之后的 commit 改动了采集面源码（含删除）→ stale，并列出变化的源码路径', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'b.py'), 'b = 2\n');
    const graphHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# docs\n');
    commitAll(repoDir, 'docs');
    fs.rmSync(path.join(repoDir, 'b.py'));
    commitAll(repoDir, 'delete b.py');
    const verdict = evaluateFreshness(graphHead, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['source-commit']);
    expect(verdict.committedSourceChanges).toEqual(['b.py']);
  });

  it('M11-D：sourceCommit 不在当前历史里（历史改写 / 浅克隆）→ 按 stale 保守处理，不假装 fresh', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(repoDir, 'init');
    const verdict = evaluateFreshness('f'.repeat(40), repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['source-commit']);
  });

  it('sourceCommit 与当前 HEAD 不一致 → stale', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const firstHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'export const b = 2;\n');
    const secondHead = commitAll(repoDir, 'second');
    const verdict = evaluateFreshness(firstHead, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.recordedSourceCommit).toBe(firstHead);
    expect(verdict.currentHead).toBe(secondHead);
    // F249：指纹一致时唯一原因是 commit 不一致（不夹带指纹型原因）
    expect(verdict.staleReasons).toEqual(['source-commit']);
  });

  it('sourceCommit 与 HEAD 一致，但存在未提交的源码文件改动 → dirty', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('a.ts');
  });

  it('未提交改动仅涉及非源码文件（如 README.md）→ 不触发 dirty（过滤面按源码扩展名）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# hello\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# updated\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('fresh');
  });

  it('porcelain 解析 - 删除源码文件 → dirty，dirtyFiles 含被删除路径', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'gone.ts'), 'export const gone = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.rmSync(path.join(repoDir, 'gone.ts'));
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
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
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('new_name.ts');
    expect(verdict.dirtyFiles).toContain('old_name.ts');
  });

  it('porcelain 解析 - 路径含空格 → dirty 正确解析（-z 协议不引入引号转义歧义）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'my file.ts'), 'export const b = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('my file.ts');
  });

  it('porcelain 解析 - 全新 untracked 目录（--untracked-files=all 逐文件展开，不折叠为单条目录记录）→ dirty', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.mkdirSync(path.join(repoDir, 'newdir'));
    fs.writeFileSync(path.join(repoDir, 'newdir', 'inner.ts'), 'export const inner = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
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
      const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
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
// F249 决策 4 / FR-003：dirty 判定面 = 五管线并集，各管线按自身 matchSemantics 判定
//
// 原 FIX-4 的"全局大小写严格匹配"断言（含 getDirtySourceExtensions 扁平 Set 防漂移
// 测试）已随该导出函数一并移除——扁平 Set 契约无法表达混合语义。收敛后的验收由本
// describe 的端到端 evaluateFreshness 断言 +
// `tests/unit/collector-surface.test.ts` 的结构/AST/行为三重 oracle 共同承担。
// ============================================================

describe('evaluateFreshness：逐管线匹配语义（真实临时 git 仓库，F249 决策 4）', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  // C-04 语义翻转：收敛前此用例断言 fresh（理由是"tsjsSkeletonWalk 不扫描 .TS"），
  // 收敛后 dirty 判定面是五管线并集，`moduleDerivationScan` 管线大小写不敏感且覆盖
  // `.ts`，`legacy.TS` 经 toLowerCase 归一化后命中该面 → 判 dirty。
  it('未提交改动仅涉及大写 .TS 文件 → 触发 dirty（因 moduleDerivationScan 大小写不敏感面命中）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'legacy.TS'), 'export const b = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('legacy.TS');
  });

  // 反例：证明收敛不是"放宽为全局大小写不敏感"，而是逐管线语义各自保真后取并集。
  // `.PY` 落在所有管线匹配面之外：pyWalk 大小写敏感（`.py`/`.pyi` 不含 `.PY`）、
  // moduleDerivationScan 虽大小写不敏感但其扩展集不含 `.py`、java/go 面无关。
  it('未提交改动仅涉及大写 .PY 文件 → 不触发 dirty（pyWalk 大小写敏感 + moduleDerivationScan 不覆盖 .py）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'legacy.PY'), 'x = 1\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('fresh');
  });

  // ── SC-008 三类漏报修复样本（partial：本 Phase 验证 dirty 判定谓词本身）──

  it('SC-008 ①：仅新增未提交 .pyi 文件 → 触发 dirty（pyWalk 面含 .pyi，收敛前漏报）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'stub.pyi'), 'def f() -> int: ...\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('stub.pyi');
  });

  it('SC-008 ②：仅新增未提交 Foo.JAVA（大小写变体）→ 触发 dirty（javaAdapter 面大小写不敏感，收敛前漏报）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'Foo.JAVA'), 'public class Foo {}\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('Foo.JAVA');
  });

  it('SC-008 ③：仅新增未提交 foo.MJS（module 派生扫描大小写变体）→ 触发 dirty（moduleDerivationScan 面命中）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'foo.MJS'), 'export const foo = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('foo.MJS');
  });

  // rebase 调和（d27ba75 用例合并）：对方 F243 曾用 `getDirtySourceExtensions` 的扁平集合断言
  // ".mjs ∈ dirty 判定面"。该导出面已随扁平集合契约废除，语义在此以端到端 verdict 形式重锚。
  // 双面覆盖是有意的冗余：`.mjs` 同时落在 tsjsSkeletonWalk（本轮扩为 6 扩展）与
  // moduleDerivationScan（既有 8 扩展、大小写不敏感）两条管线面内，任一侧被误删都仍会 dirty；
  // 因此本用例锚定的是"用户可观测行为不回退"，扩面本身的单点归属由
  // `tests/unit/collector-surface.test.ts` 的结构 oracle 断言。
  it('rebase 调和：仅新增未提交小写 foo.mjs → 触发 dirty（tsjsSkeletonWalk 扩面 ∪ moduleDerivationScan 双面命中）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'foo.mjs'), 'export const foo = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('foo.mjs');
  });

  it('rebase 调和：仅新增未提交小写 foo.cjs → 触发 dirty（同上双面命中）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'foo.cjs'), 'module.exports = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('foo.cjs');
  });

  it('小写 .go / .java 常规样本同样触发 dirty（生产面本体，非仅大小写变体）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'main.go'), 'package main\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('main.go');
  });

  // ── W-004：纯点文件按各管线真实匹配形态判定（不再用统一的"切片 + 查表"近似）──

  it('W-004：仅新增未提交纯点文件 `.go` → 不触发 dirty（extname 族生产者根本不采集它）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, '.go'), 'package main\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    // 旧实现把 `.go` 切片成扩展名 `.go` → 误报 dirty；generic collector 的
    // `path.extname('.go')` 是空串，该文件不会进入任何图产物，故 fresh 才是诚实结论
    expect(verdict.state).toBe('fresh');
  });

  it('W-004：仅新增未提交纯点文件 `.ts` → 触发 dirty（endsWith 族生产者确实采集它）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, '.ts'), 'export const b = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    // 与上一条构成对拍：同为纯点文件，两族形态给出相反且各自正确的结论
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('.ts');
  });

  it('W-004：仅新增未提交纯点文件 `.py` → 触发 dirty（pyWalk/pythonSymbolScan 均为 endsWith 族）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, '.py'), 'x = 1\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toContain('.py');
  });
});

// ============================================================
// F249 FR-009/FR-010/FR-018：五级优先级 + staleReasons
//
// 本 describe 的用例全部走真实临时 git 仓库（与上方既有惯例一致），指纹侧则用
// computeCollectorFingerprint() 的真实产出做变形，构造"旧指纹 / 畸形指纹 / 缺失指纹"
// 三类输入——不 mock 指纹模块，保证判定链路是端到端的。
// ============================================================

/**
 * 制造一个"扩展面比当前更小"的旧指纹：从 tsjsSkeletonWalk 面里删掉一个扩展名。
 *
 * 这正是"在 SSoT 里新增一个扩展名之后，用扩展前记录的指纹去判定"的等价形态（SC-002 完整段）——
 * 无需真的改 SSoT 常量（那会污染同进程内其他用例）。
 */
function fingerprintWithNarrowerExtensionSurface(): CollectorFingerprint {
  const fingerprint = computeCollectorFingerprint();
  fingerprint.extensionSurface.tsjsSkeletonWalk.extensions =
    fingerprint.extensionSurface.tsjsSkeletonWalk.extensions.slice(1);
  return fingerprint;
}

/** 制造一个"仅 behaviorVersion 为旧值、其余字段与当前完全一致"的指纹（SC-001 端到端）。 */
function fingerprintWithOlderBehaviorVersion(): CollectorFingerprint {
  const fingerprint = computeCollectorFingerprint();
  fingerprint.behaviorVersion = BEHAVIOR_VERSION - 1;
  return fingerprint;
}

describe('evaluateFreshness：五级优先级 + staleReasons（F249 FR-009）', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  /** 建一次初始 commit 并返回 HEAD（本 describe 全部用例共用的前置）。 */
  function seedCommit(): string {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    return commitAll(repoDir, 'init');
  }

  // ── SC-001（端到端半段）──

  it('SC-001：commit 一致 + 工作树干净 + 指纹仅 behaviorVersion 为旧值 → stale，staleReasons 恰为 [collector-fingerprint]', () => {
    const head = seedCommit();
    const verdict = evaluateFreshness(head, repoDir, fingerprintWithOlderBehaviorVersion());
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint']);
  });

  // ── SC-002（完整段：扩展面变化后旧图判非 fresh）──

  it('SC-002：用扩展面更窄的旧指纹对当前版本判定 → 非 fresh（stale + collector-fingerprint）', () => {
    const head = seedCommit();
    const verdict = evaluateFreshness(head, repoDir, fingerprintWithNarrowerExtensionSurface());
    expect(verdict.state).not.toBe('fresh');
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint']);
  });

  // ── SC-003 / SC-003c：unrecorded（缺失与 null 同等）──

  it('SC-003：commit 一致但 fingerprint 为 undefined（存量旧图）→ stale + collector-fingerprint-unrecorded，不判 fresh', () => {
    const head = seedCommit();
    const verdict = evaluateFreshness(head, repoDir, undefined);
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-unrecorded']);
  });

  it('SC-003：省略第三参（旧调用点未传指纹）与显式 undefined 等价 → stale + unrecorded', () => {
    const head = seedCommit();
    const verdict = evaluateFreshness(head, repoDir);
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-unrecorded']);
  });

  it('SC-003c：fingerprint 为 null 且 recordedSourceCommit 非 null → 同归 unrecorded，非 fresh，不抛异常', () => {
    const head = seedCommit();
    expect(() => evaluateFreshness(head, repoDir, null)).not.toThrow();
    const verdict = evaluateFreshness(head, repoDir, null);
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-unrecorded']);
  });

  // ── FR-018：畸形指纹 → invalid（与 unrecorded 区分）──

  it.each<[string, unknown]>([
    ['空对象 {}', {}],
    ['formatVersion 非 1', { formatVersion: 2, extensionSurface: {}, behaviorVersion: 1 }],
    ['字符串', 'not-a-fingerprint'],
    ['数组', []],
    ['缺 extensionSurface', { formatVersion: 1, behaviorVersion: 1 }],
  ])('FR-018：畸形指纹（%s）→ stale + collector-fingerprint-invalid，不抛异常', (_label, malformed) => {
    const head = seedCommit();
    expect(() => evaluateFreshness(head, repoDir, malformed)).not.toThrow();
    const verdict = evaluateFreshness(head, repoDir, malformed);
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-invalid']);
  });

  // ── C-001：额外管线 key（"新增管线但忘 bump formatVersion"的真实形态）→ invalid，不再可能 fresh ──

  it('C-001：指纹多出一条未知管线 extensionSurface.shadow → stale + collector-fingerprint-invalid（绝不判 fresh）', () => {
    const head = seedCommit();
    const withShadowPipeline = JSON.parse(JSON.stringify(computeCollectorFingerprint())) as Record<
      string,
      unknown
    >;
    (withShadowPipeline.extensionSurface as Record<string, unknown>).shadow = {
      extensions: ['.zig'],
      matchSemantics: 'case-sensitive',
    };

    const verdict = evaluateFreshness(head, repoDir, withShadowPipeline);

    // 宽容口径下这份指纹会被判"合法且与当前相等"（已知五 key 全一致）→ fresh，
    // 而事实是它来自一个多了一条采集管线的 producer 版本 —— 严格集合把它挡在 fresh 之外
    expect(verdict.state).not.toBe('fresh');
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-invalid']);
  });

  it('C-001：指纹顶层多出未知字段 → 同样 stale + collector-fingerprint-invalid', () => {
    const head = seedCommit();
    const withExtraTopLevel = {
      ...(JSON.parse(JSON.stringify(computeCollectorFingerprint())) as Record<string, unknown>),
      producerFlavor: 'experimental',
    };

    const verdict = evaluateFreshness(head, repoDir, withExtraTopLevel);
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-invalid']);
  });

  // ── W-005：stateful accessor 指纹 → invalid，且 evaluateFreshness 不抛 ──

  it('W-005：首次读合法、二次读抛错的 getter 指纹 → stale + invalid，evaluateFreshness 不抛异常', () => {
    const head = seedCommit();
    const valid = computeCollectorFingerprint();
    let reads = 0;
    const stateful = Object.defineProperty(
      { formatVersion: 1, behaviorVersion: valid.behaviorVersion },
      'extensionSurface',
      {
        get() {
          reads += 1;
          if (reads === 1) return valid.extensionSurface;
          throw new Error('boom：第二次读取抛错');
        },
        enumerable: true,
        configurable: true,
      },
    );

    expect(() => evaluateFreshness(head, repoDir, stateful)).not.toThrow();
    const verdict = evaluateFreshness(head, repoDir, stateful);
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-invalid']);
  });

  // ── SC-003b：recordedSourceCommit 缺失时的短路不被指纹判定绕过 ──

  it.each<[string, unknown]>([
    ['合法当前指纹', computeCollectorFingerprint()],
    ['undefined', undefined],
    ['null', null],
    ['畸形值', { formatVersion: 'x' }],
  ])('SC-003b：recordedSourceCommit 为 null 时（fingerprint=%s）仍判 unknown-provenance', (_label, fingerprint) => {
    seedCommit();
    const verdict = evaluateFreshness(null, repoDir, fingerprint);
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.staleReasons).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ['合法当前指纹', computeCollectorFingerprint()],
    ['undefined', undefined],
    ['畸形值', {}],
  ])('SC-003b：recordedSourceCommit 为 undefined（字段缺失）时（fingerprint=%s）仍判 unknown-provenance', (_label, fingerprint) => {
    seedCommit();
    const verdict = evaluateFreshness(undefined, repoDir, fingerprint);
    expect(verdict.state).toBe('unknown-provenance');
  });

  // ── SC-004（完整段）：两者均一致 → fresh ──

  it('SC-004：sourceCommit 与 fingerprint 均一致 + 工作树干净 → fresh，且不带 staleReasons', () => {
    const head = seedCommit();
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('fresh');
    expect(verdict.staleReasons).toBeUndefined();
  });

  // ── SC-007：指纹判定 MUST 排在 dirty 之前，不被脏工作树吞没 ──

  it('SC-007：commit 一致 + fingerprint mismatch + 工作树脏 → stale（非 dirty）', () => {
    const head = seedCommit();
    // 工作树脏：改写已提交的源码文件
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    const verdict = evaluateFreshness(head, repoDir, fingerprintWithOlderBehaviorVersion());
    expect(verdict.state).toBe('stale');
    expect(verdict.state).not.toBe('dirty');
    expect(verdict.staleReasons).toEqual(['collector-fingerprint']);
    // M11 卡 D：stale 的 verdict 同时携带工作树状态（state 仍是 stale）——自动重建方据此拒绝在脏树上重建
    expect(verdict.dirtyFiles).toEqual(['a.ts']);
  });

  it('SC-007：同一输入重复运行 5 次，staleReasons 顺序完全一致（确定性）', () => {
    const head = seedCommit();
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    const results = Array.from({ length: 5 }, () =>
      evaluateFreshness(head, repoDir, fingerprintWithOlderBehaviorVersion()).staleReasons,
    );
    for (const reasons of results) {
      expect(reasons).toEqual(['collector-fingerprint']);
    }
  });

  // ── SC-009 前置：多原因并存，全部保留且顺序确定（source-commit 先于指纹型）──

  it('SC-009：commit mismatch + fingerprint mismatch 并存 → staleReasons 恰为 [source-commit, collector-fingerprint]', () => {
    seedCommit();
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'export const b = 2;\n');
    const secondHead = commitAll(repoDir, 'second');
    const verdict = evaluateFreshness(
      'a'.repeat(40),
      repoDir,
      fingerprintWithOlderBehaviorVersion(),
    );
    expect(verdict.state).toBe('stale');
    expect(verdict.currentHead).toBe(secondHead);
    expect(verdict.staleReasons).toEqual(['source-commit', 'collector-fingerprint']);
  });

  it('SC-009：commit mismatch + fingerprint 缺失并存 → [source-commit, collector-fingerprint-unrecorded]', () => {
    seedCommit();
    const verdict = evaluateFreshness('a'.repeat(40), repoDir, undefined);
    expect(verdict.staleReasons).toEqual(['source-commit', 'collector-fingerprint-unrecorded']);
  });

  it('SC-009：commit mismatch + fingerprint 畸形并存 → [source-commit, collector-fingerprint-invalid]', () => {
    seedCommit();
    const verdict = evaluateFreshness('a'.repeat(40), repoDir, { formatVersion: 99 });
    expect(verdict.staleReasons).toEqual(['source-commit', 'collector-fingerprint-invalid']);
  });

  it('SC-009：多原因样本重复运行 5 次顺序一致（下游文案渲染可依赖该顺序）', () => {
    seedCommit();
    for (let i = 0; i < 5; i += 1) {
      const verdict = evaluateFreshness('a'.repeat(40), repoDir, undefined);
      expect(verdict.staleReasons).toEqual(['source-commit', 'collector-fingerprint-unrecorded']);
    }
  });
});

// ============================================================
// SC-017（防守项 2）：currentHead 解析失败的短路优先于任何指纹判定
//
// 前置条件钉死：recordedSourceCommit 固定为非空 'abc123'（否则会先命中步骤 1 的短路，
// 测的就不是步骤 2 了），resolveSourceCommit 因目标目录非 git 仓库而返回 null。
// ============================================================

describe('SC-017：非 git 仓库（currentHead=null）时指纹状态不改变 unknown-provenance', () => {
  let nonGitDir: string;

  beforeEach(() => {
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-commit-sc017-'));
  });

  afterEach(() => {
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('前置校验：该目录确实非 git 仓库（resolveSourceCommit 返回 null）', () => {
    expect(resolveSourceCommit(nonGitDir)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['合法当前指纹', computeCollectorFingerprint()],
    ['缺失（undefined）', undefined],
    ['畸形（空对象）', {}],
  ])('fingerprint=%s + recordedSourceCommit=abc123 → unknown-provenance（不判 stale）', (_label, fingerprint) => {
    const verdict = evaluateFreshness('abc123', nonGitDir, fingerprint);
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.currentHead).toBeNull();
    expect(verdict.recordedSourceCommit).toBe('abc123');
    // 指纹型原因绝不能在此短路路径上冒出来
    expect(verdict.staleReasons).toBeUndefined();
  });
});

// ============================================================
// M11 卡 D 对抗审查回补（角 A fail-open / 角 B 假红副作用，2026-09-15）
// ============================================================

describe('M11-D 回补：committed diff 的判定面与 argv 面', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('C-1：采集面文件被 git mv 出采集面（rename 折叠成只列目的路径）→ 仍判 stale 并列出旧路径', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n'.repeat(20));
    const graphHead = commitAll(repoDir, 'init');
    realGit(repoDir, ['mv', 'a.ts', 'a.ts.bak']);
    commitAll(repoDir, 'move out of surface');
    const verdict = evaluateFreshness(graphHead, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['source-commit']);
    expect(verdict.committedSourceChanges).toEqual(['a.ts']);
  });

  it('C-4：只改 .gitignore 的 commit 改变了采集范围 → stale，并列出 .gitignore', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoDir, '.gitignore'), 'generated/\n');
    const graphHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '');
    commitAll(repoDir, 'stop ignoring generated/');
    const verdict = evaluateFreshness(graphHead, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.committedSourceChanges).toEqual(['.gitignore']);
  });

  it('C-4：未提交的 .gitignore 改动同样进 dirty 判定面（嵌套 .gitignore 亦然）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.mkdirSync(path.join(repoDir, 'sub'));
    fs.writeFileSync(path.join(repoDir, 'sub', '.gitignore'), 'x\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('dirty');
    expect(verdict.dirtyFiles).toEqual(['sub/.gitignore']);
  });

  it.each(['-s', '--quiet', '--diff-filter=X', 'HEAD', 'main', 'abc123'])(
    'C-2：recordedSourceCommit=%s 不是 commit SHA → 不进 git argv，按 stale 保守处理（区间里确有源码改动）',
    (recorded) => {
      fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
      commitAll(repoDir, 'init');
      fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
      commitAll(repoDir, 'change a');
      const verdict = evaluateFreshness(recorded, repoDir, computeCollectorFingerprint());
      expect(verdict.state).toBe('stale');
      expect(verdict.staleReasons).toEqual(['source-commit']);
      expect(verdict.recordedSourceCommit).toBe(recorded);
    },
  );

  it('C-2：recordedSourceCommit=--output=<file> 不会让 git 写文件', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    commitAll(repoDir, 'change a');
    const outFile = path.join(repoDir, 'PWNED.txt');
    const verdict = evaluateFreshness(`--output=${outFile}`, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('M1：两点 diff 而非三点——图建在后代 commit、HEAD 回到祖先时判 stale（图里有 HEAD 上不存在的文件）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const ancestor = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'export const b = 2;\n');
    const descendant = commitAll(repoDir, 'add b');
    realGit(repoDir, ['checkout', '-q', ancestor]);
    const verdict = evaluateFreshness(descendant, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.committedSourceChanges).toEqual(['b.ts']);
  });

  it('W-4：真实区间源码改动 + 指纹不一致并存 → [source-commit, collector-fingerprint]（不靠 readFailed 路径）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const graphHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    commitAll(repoDir, 'change a');
    const outdated: CollectorFingerprint = { ...computeCollectorFingerprint(), behaviorVersion: BEHAVIOR_VERSION - 1 };
    const verdict = evaluateFreshness(graphHead, repoDir, outdated);
    expect(verdict.staleReasons).toEqual(['source-commit', 'collector-fingerprint']);
    expect(verdict.committedSourceChanges).toEqual(['a.ts']);
  });

  it('W-5：stale 判定不再吞掉工作树状态——stale 的 verdict 同时携带 dirtyFiles（repo:sync 据此拒绝在脏树上重建）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const graphHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    commitAll(repoDir, 'change a');
    fs.writeFileSync(path.join(repoDir, 'c.ts'), 'export const c = 3;\n');
    const verdict = evaluateFreshness(graphHead, repoDir, computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.dirtyFiles).toEqual(['c.ts']);
  });
});

describe('M11-D 回补：脏工作树上建的图（sourceTreeDirty）', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('isSourceTreeDirty：干净树 false；未提交源码 true；只有未提交文档 false', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(repoDir, 'init');
    expect(isSourceTreeDirty(repoDir)).toBe(false);
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# doc\n');
    expect(isSourceTreeDirty(repoDir)).toBe(false);
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'export const b = 2;\n');
    expect(isSourceTreeDirty(repoDir)).toBe(true);
  });

  it('图记录 sourceTreeDirty=true、commit 一致、树已干净 → stale [source-tree-dirty-at-build]（丢弃的未提交内容可能仍在图里）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint(), true);
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['source-tree-dirty-at-build']);
  });

  it('图记录 sourceTreeDirty=true 而树仍脏 → dirty（未提交状态尚在，不升格 stale）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'export const b = 2;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint(), true);
    expect(verdict.state).toBe('dirty');
  });

  it('sourceTreeDirty 缺席 / false / 非布尔 → 不影响既有判定（fresh）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    for (const recorded of [undefined, null, false, 'true', 1]) {
      expect(evaluateFreshness(head, repoDir, computeCollectorFingerprint(), recorded).state).toBe('fresh');
    }
  });

  it('多原因顺序：source-commit 在前、source-tree-dirty-at-build 居中、指纹原因在后', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const graphHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    commitAll(repoDir, 'change a');
    const verdict = evaluateFreshness(graphHead, repoDir, undefined, true);
    expect(verdict.staleReasons).toEqual(['source-commit', 'source-tree-dirty-at-build', 'collector-fingerprint-unrecorded']);
  });
});

// ============================================================
// M11 卡 D delta 复审回补（2026-09-15）：判定面 pin / 形态边界 / 脏树建图在树脏期间可见 / 测过且干净可区分
// ============================================================

describe('M11-D delta 回补', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = initTempGitRepo();
    mockedExecFileSync.mockClear();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('CRITICAL-2：图记录 sourceTreeDirty=true 而树仍脏 → state 仍 dirty，但 verdict 带 builtFromDirtyTree:true（此前该记录在树脏期间被整个扔掉）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'other.ts'), 'export const o = 1;\n');
    const verdict = evaluateFreshness(head, repoDir, computeCollectorFingerprint(), true);
    expect(verdict.state).toBe('dirty');
    expect(verdict.builtFromDirtyTree).toBe(true);
    expect(verdict.dirtyFiles).toEqual(['other.ts']);
    const clean = evaluateFreshness(head, repoDir, computeCollectorFingerprint(), false);
    expect(clean.builtFromDirtyTree).toBeUndefined();
  });

  it('W-2：每个 state 都带测量结果——fresh / stale（树干净）带 dirtyFiles: []，与「没测」（字段缺席）可区分；unknown-provenance（无图）也带', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const head = commitAll(repoDir, 'init');
    expect(evaluateFreshness(head, repoDir, computeCollectorFingerprint()).dirtyFiles).toEqual([]);
    const stale = evaluateFreshness(head, repoDir, undefined);
    expect(stale.state).toBe('stale');
    expect(stale.dirtyFiles).toEqual([]);
    const noGraph = evaluateFreshness(null, repoDir);
    expect(noGraph.state).toBe('unknown-provenance');
    expect(noGraph.currentHead).toBe(head);
    expect(noGraph.dirtyFiles).toEqual([]);
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'export const b = 2;\n');
    expect(evaluateFreshness(null, repoDir).dirtyFiles).toEqual(['b.ts']);
  });

  it('非 git 目录：unknown-provenance 且不带任何工作树字段（真没测）', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-commit-nongit2-'));
    try {
      const verdict = evaluateFreshness(null, nonGitDir);
      expect(verdict.state).toBe('unknown-provenance');
      expect(verdict.currentHead).toBeNull();
      expect(verdict.dirtyFiles).toBeUndefined();
      expect(verdict.porcelainReadFailed).toBeUndefined();
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('W-6：committed diff 的 argv 钉住 --no-renames 等价 pin、diff.relative=false 与 --end-of-options（三者各自承重）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    const graphHead = commitAll(repoDir, 'init');
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 2;\n');
    commitAll(repoDir, 'change');
    mockedExecFileSync.mockClear();
    evaluateFreshness(graphHead, repoDir, computeCollectorFingerprint());
    const diffCall = mockedExecFileSync.mock.calls.find((call) => Array.isArray(call[1]) && (call[1] as string[]).includes('diff'));
    expect(diffCall).toBeDefined();
    const args = diffCall![1] as string[];
    expect(args.slice(0, 4)).toEqual(['-c', 'diff.renames=false', '-c', 'diff.relative=false']);
    expect(args).toContain('--end-of-options');
    expect(args.indexOf('--end-of-options')).toBeLessThan(args.indexOf(graphHead));
  });

  it('W-6 实证：diff.relative=true + projectRoot 在子目录时，仓库根的采集面改动仍判 stale（pin 不是装饰）', () => {
    fs.writeFileSync(path.join(repoDir, 'top.ts'), 'export const t = 1;\n');
    fs.mkdirSync(path.join(repoDir, 'sub'));
    fs.writeFileSync(path.join(repoDir, 'sub', 'a.ts'), 'export const a = 1;\n');
    const graphHead = commitAll(repoDir, 'init');
    realGit(repoDir, ['config', 'diff.relative', 'true']);
    fs.writeFileSync(path.join(repoDir, 'top.ts'), 'export const t = 2;\n');
    commitAll(repoDir, 'change top');
    const verdict = evaluateFreshness(graphHead, path.join(repoDir, 'sub'), computeCollectorFingerprint());
    expect(verdict.state).toBe('stale');
    expect(verdict.committedSourceChanges).toEqual(['top.ts']);
  });

  it('I-4：isCommitSha 形态边界——40 / 64 hex 合法；39 / 41 hex、大写、非 hex 都不合法', () => {
    expect(isCommitSha('a'.repeat(40))).toBe(true);
    expect(isCommitSha('b'.repeat(64))).toBe(true);
    for (const bad of ['a'.repeat(39), 'a'.repeat(41), 'a'.repeat(63), 'A'.repeat(40), 'g'.repeat(40), 'HEAD', 'main', '']) {
      expect(isCommitSha(bad), bad).toBe(false);
    }
  });

  it('M10：写盘侧 isSourceTreeDirty 在 porcelain 读取失败时按脏保守记录（docstring 明写的不变量）', () => {
    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'export const a = 1;\n');
    commitAll(repoDir, 'init');
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error('ENOBUFS');
    });
    expect(isSourceTreeDirty(repoDir)).toBe(true);
  });
});
