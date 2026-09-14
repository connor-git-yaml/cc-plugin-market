import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { checkPublishGap, readBuildMetaFromTarball, buildPackEnv, BuildMetaMissingError, TarballReadError, defaultExecNpmPackMeta } from '../../scripts/lib/publish-gap-check.mjs';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = resolve('.');

// 4.4.0 的 npm tarball 实际打包自这个 commit（npm registry gitHead 实测值）。
// 用它做「领先 N≥5」的锚点是**单调稳定**的：`<pinned>..HEAD -- src/` 的计数只会随时间增长，
// 不会掉回阈值以下，因此这条用例不会随 master 前移而变脆。本卡实测该值为 18。
const PUBLISHED_ANCHOR = '0ae3eb70b1b6b2a318f3ef926594ca8d0784a2f3';

// 形态合法（40 位十六进制）但本地仓不可能存在的 ref。
const NONEXISTENT_REF = 'f'.repeat(40);

// .mjs 侧无类型声明，这里给出测试所需的最小结构描述（避免 any——见 .claude/rules/tests.md）。
interface GapCheck {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail';
  evidence: Record<string, unknown>;
}
interface GapResult {
  checks: GapCheck[];
  warnings: string[];
}
interface GapOptions {
  projectRoot: string;
  publishedRefOverride?: string;
  execNpmView?: (packageName?: string, ctx?: { projectRoot: string }) => string;
  execGit?: (args: string[], projectRoot: string) => string;
  execNpmPackMeta?: (packageName: string, publishedVersion: string | null, ctx?: { projectRoot: string }) => string;
}

const gapCheckOf = (options: GapOptions): GapResult => checkPublishGap(options) as GapResult;

/** 在本地造一个真实 tgz：`package/dist/.spectra-build-meta.json` 可有可无；用真实 tar 走生产读取路径。 */
function makeTarball(meta: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'pg-tgz-'));
  mkdirSync(join(dir, 'package', 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package', 'package.json'), '{"name":"spectra-cli","version":"4.4.0"}');
  if (meta !== null) writeFileSync(join(dir, 'package', 'dist', '.spectra-build-meta.json'), meta);
  const tgz = join(dir, 'spectra-cli-4.4.0.tgz');
  execFileSync('tar', ['-czf', tgz, '-C', dir, 'package']);
  return tgz;
}

/** 名字非法的临时项目根（测 package.json name 白名单；git 探针不会到达） */
function makeProjectRootWithName(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pg-root-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }));
  return dir;
}

/** npm view 从不被调用的哨兵：一旦被调用说明 env-override 分支没生效。 */
function forbiddenNpmView(): string {
  throw new Error('execNpmView MUST NOT be called when publishedRefOverride is provided');
}

// ── C-4：注入 ref 恒留痕 ─────────────────────────────────────────────────────
// 走 `SPECTRA_PUBLISHED_REF` 时必然多出一条 override 提示 warning。它与领先量 warning
// 是两条不同的串，因此断言"有没有领先量 warning"时必须先把它滤掉，否则测的是别的东西。
const OVERRIDE_MARKER = 'SPECTRA_PUBLISHED_REF';
const overrideWarnings = (r: GapResult) => r.warnings.filter((w) => w.includes(OVERRIDE_MARKER));
const gapWarnings = (r: GapResult) => r.warnings.filter((w) => !w.includes(OVERRIDE_MARKER));

/**
 * 只放行真实 git 会成功的探针、其余按需失败的假 execGit。
 * 三个前置探针（`rev-parse --git-dir` / `cat-file -e HEAD:src` / `cat-file -e <ref>^{commit}`）
 * 各对应一种 indeterminate 病因，必须能被单独打断才测得出"病因分得开"。
 */
function fakeGit(handlers: {
  revParse?: () => string;
  catFile?: (rev: string) => string;
  revList?: (args: string[]) => string;
}) {
  return (args: string[]): string => {
    if (args[0] === 'rev-parse') return handlers.revParse ? handlers.revParse() : '.git\n';
    if (args[0] === 'cat-file') return handlers.catFile ? handlers.catFile(args[2] ?? '') : '';
    if (args[0] === 'rev-list') return handlers.revList ? handlers.revList(args) : '0\n';
    throw new Error(`unexpected git args: ${args.join(' ')}`);
  };
}

describe('checkPublishGap', () => {
  describe('N>=5 时产出非阻断 warning', () => {
    it('注入已发布锚点 commit（其后 src commit 数 >= 5）时出现领先量文案，且不 fail', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
      });

      const gapCheck = result.checks.find((c) => c.id === 'gap');
      if (gapCheck === undefined) throw new Error('gap check 缺失');
      expect(gapCheck.evidence.sourceStatus).toBe('ok');
      expect(gapCheck.evidence.publishedCommitStatus).toBe('resolved');
      expect(gapCheck.evidence.srcCommitsAhead).toBeGreaterThanOrEqual(5);
      // W-1：warn 分支的 title 必须说的是"超阈值"，不是反话
      expect(gapCheck.title).toBe('发布断层领先量超阈值');

      expect(gapWarnings(result).join('\n')).toMatch(/领先已发布版本/);
      expect(gapWarnings(result).join('\n')).toMatch(/个 src commit/);

      // 结构性保证：判据自身没有 fail 语义，check 至多是 warn。
      expect(gapCheck.status).toBe('warn');
      expect(result.checks.every((c) => c.status !== 'fail')).toBe(true);
    });

    it('warning 文案不泄露 commit 原串（与 doctor 脱敏同口径）', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
      });
      expect(result.warnings.join('\n')).not.toContain(PUBLISHED_ANCHOR);
      expect(result.warnings.join('\n')).not.toContain(PUBLISHED_ANCHOR.slice(0, 7));
    });
  });

  describe('N<5 时不误报', () => {
    it('注入 HEAD 自身（领先 0 个 src commit）时不产出领先量 warning', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: 'HEAD',
        execNpmView: forbiddenNpmView,
      });

      const gapCheck = result.checks.find((c) => c.id === 'gap');
      if (gapCheck === undefined) throw new Error('gap check 缺失');
      expect(gapCheck.status).toBe('pass');
      expect(gapCheck.evidence.sourceStatus).toBe('ok');
      expect(gapCheck.evidence.srcCommitsAhead).toBe(0);
      expect(gapWarnings(result)).toEqual([]);
    });

    it('N 正好等于 4（阈值下沿）时不产出领先量 warning', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({ revList: () => '4\n' }),
      });
      expect(gapWarnings(result)).toEqual([]);
      expect(result.checks[0]?.status).toBe('pass');
      expect(result.checks[0]?.title).toBe('发布断层领先量在阈值内');
      expect(result.checks[0]?.evidence.srcCommitsAhead).toBe(4);
    });

    it('N 正好等于 5（阈值本身）时产出 warning', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({ revList: () => '5\n' }),
      });
      expect(gapWarnings(result)).toHaveLength(1);
      expect(result.checks[0]?.status).toBe('warn');
    });
  });

  describe('量测面如实声明（C-2：只量 src/，plugins/ 断层看不见）', () => {
    it('evidence 声明 pathspec，且 warning 文案点明量测面', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({ revList: () => '9\n' }),
      });
      expect(result.checks[0]?.evidence.pathspec).toEqual(['src/']);
      expect(gapWarnings(result)[0]).toContain('量测面仅 src/');
    });

    it('indeterminate 路径同样声明 pathspec（读者据此知道这条判据在量什么）', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: NONEXISTENT_REF,
        execNpmView: forbiddenNpmView,
      });
      expect(result.checks[0]?.evidence.pathspec).toEqual(['src/']);
    });

    it('C-1：rev-list 必须带 --full-history（默认 history simplification 会把 -s ours 合并的 src 改动数说成 0）', () => {
      const seen: string[][] = [];
      gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({
          revList: (args) => {
            seen.push(args);
            return '7\n';
          },
        }),
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain('--full-history');
      // pathspec 以 `-- src/` 形式传入（量测面口径与 evidence 同源）
      expect(seen[0]?.slice(seen[0].indexOf('--'))).toEqual(['--', 'src/']);
    });
  });

  describe('C-4：注入 ref 无条件留痕', () => {
    const expectOverrideWarning = (result: GapResult) => {
      expect(overrideWarnings(result)).toHaveLength(1);
      expect(overrideWarnings(result)[0]).toContain('不代表真实发布状态');
    };

    it('pass 路径（N=0，看起来最"干净"的绿）也带 override 提示', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: 'HEAD',
        execNpmView: forbiddenNpmView,
      });
      expect(result.checks[0]?.status).toBe('pass');
      expectOverrideWarning(result);
    });

    it('warn 路径与 indeterminate 路径同样带，且与领先量 warning 是两条不同的串', () => {
      const warn = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
      });
      expectOverrideWarning(warn);
      expect(warn.warnings).toHaveLength(overrideWarnings(warn).length + gapWarnings(warn).length);

      const indeterminate = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: NONEXISTENT_REF,
        execNpmView: forbiddenNpmView,
      });
      expectOverrideWarning(indeterminate);
    });

    it('走真实事实源（npm-view）时不出现 override 提示', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmView: () => JSON.stringify({ version: '4.4.0', gitHead: PUBLISHED_ANCHOR }),
      });
      expect(overrideWarnings(result)).toEqual([]);
      expect(result.checks[0]?.evidence.refSource).toBe('npm-view');
    });
  });

  describe('事实源不可达时 indeterminate 且可见', () => {
    const expectIndeterminate = (result: GapResult, reason: string) => {
      const gapCheck = result.checks.find((c) => c.id === 'gap');
      if (gapCheck === undefined) throw new Error('gap check 缺失');
      expect(gapCheck.status).toBe('warn');
      expect(gapCheck.evidence.sourceStatus).toBe('indeterminate');
      expect(gapCheck.evidence.reason).toBe(reason);
      // 必须可见：进 warnings，不静默跳过（F258 教训）。
      expect(gapWarnings(result)).toHaveLength(1);
      expect(gapWarnings(result)[0]).toContain('indeterminate');
      // 且不得被误判为「无领先」——不出现 pass 状态的 check。
      expect(result.checks.some((c) => c.status === 'pass')).toBe(false);
    };

    it('(a) 注入本地不存在的 40 位十六进制 ref → unreachable-commit（唯一挂 fetch-depth 提示的病因）', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: NONEXISTENT_REF,
        execNpmView: forbiddenNpmView,
      });
      expectIndeterminate(result, 'unreachable-commit');
      expect(gapWarnings(result)[0]).toContain('fetch-depth');
      expect(result.warnings[0]).not.toContain(NONEXISTENT_REF);
    });

    it('(b) 不设覆盖入口 + npm view 超时抛错 → network', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmView: () => {
          const err: NodeJS.ErrnoException = new Error('spawnSync npm ETIMEDOUT');
          err.code = 'ETIMEDOUT';
          throw err;
        },
      });
      expectIndeterminate(result, 'network');
      // W-3：网络类文案不得把"包不存在"混进来
      expect(gapWarnings(result)[0]).toContain('不可达');
    });

    it('(c) npm view 返回体缺 gitHead 且 tarball 拉取失败 → tarball-fetch-failed', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmPackMeta: () => {
          throw new Error('simulated npm pack failure');
        },
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
      });
      expectIndeterminate(result, 'tarball-fetch-failed');
    });

    it('(c2) 缺 gitHead 时回退读 tarball 的 dist/.spectra-build-meta.json，commit 作为已发布锚点', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: (name, version) => {
          expect(name).toBe('spectra-cli');
          expect(version).toBe('4.4.0');
          return JSON.stringify({ commit: PUBLISHED_ANCHOR, dirty: false });
        },
      });
      const gap = result.checks.find((c) => c.id === 'gap');
      expect(gap?.evidence['sourceStatus']).not.toBe('indeterminate');
      expect(gap?.evidence['refSource']).toBe('tarball-build-meta');
      expect(gap?.evidence['publishedVersion']).toBe('4.4.0');
      // 锚点在本地可达且其后 src commit ≥ 5 → 必有领先量 warning（与 (a) 同口径）
      expect(gapWarnings(result).some((w) => w.includes('领先'))).toBe(true);
    });

    it('(c3) tarball 内 build-meta 的 commit 不是 40 位 hex → missing-build-meta；不是 JSON → tarball-read-failed（成员在但读不出）', () => {
      // 短 sha（7 位）也不接受：锚点必须是唯一可解析的全长 commit
      for (const meta of [JSON.stringify({ dirty: false }), JSON.stringify({ commit: 'HEAD' }), JSON.stringify({ commit: '0ae3eb7' })]) {
        const result = gapCheckOf({
          projectRoot: REPO_ROOT,
          execNpmView: () => JSON.stringify({ version: '4.4.0' }),
          execNpmPackMeta: () => meta,
        });
        expectIndeterminate(result, 'missing-build-meta');
      }
      // 成员在但不是 JSON（重复成员被 tar -xO 拼接 / 篡改 / 损坏）不是"未盖章"（第三轮审查 WARNING-1）
      const notJson = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => 'not-json',
      });
      expectIndeterminate(notJson, 'tarball-read-failed');
    });

    it('(c3d) 真实 tar：0 字节 tgz → TarballReadError；成员重复（tar -xO 拼接成非 JSON）→ tarball-read-failed', () => {
      const empty = join(mkdtempSync(join(tmpdir(), 'pg-empty-')), 'spectra-cli-4.4.0.tgz');
      writeFileSync(empty, '');
      expect(() => readBuildMetaFromTarball(empty)).toThrow(TarballReadError);
      // 同名成员两次：tar -r 追加后再 gzip
      const dir = mkdtempSync(join(tmpdir(), 'pg-dup-'));
      mkdirSync(join(dir, 'package', 'dist'), { recursive: true });
      writeFileSync(join(dir, 'package', 'dist', '.spectra-build-meta.json'), JSON.stringify({ commit: PUBLISHED_ANCHOR }));
      const tar = join(dir, 'dup.tar');
      execFileSync('tar', ['-cf', tar, '-C', dir, 'package']);
      execFileSync('tar', ['-rf', tar, '-C', dir, 'package']);
      execFileSync('gzip', ['-k', tar]);
      const raw = readBuildMetaFromTarball(`${tar}.gz`);
      expect(() => JSON.parse(raw)).toThrow();
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => raw,
      });
      expectIndeterminate(result, 'tarball-read-failed');
    });

    it('(c15) 任何畸形输入都不抛出、不产生已解析的零 warning 假绿（消费方裸调本函数）', () => {
      const cases: Array<Partial<GapOptions>> = [
        { execNpmView: () => 'garbage' },
        { execNpmView: () => '[]' },
        { execNpmView: () => 'null' },
        { execNpmView: () => JSON.stringify({ version: '4.4.0' }), execNpmPackMeta: () => { throw null; } },
        { execNpmView: () => JSON.stringify({ version: '4.4.0' }), execNpmPackMeta: () => ({}) as unknown as string },
        { execNpmView: () => JSON.stringify({ version: '4.4.0' }), execNpmPackMeta: () => undefined as unknown as string },
        { execNpmView: () => JSON.stringify({ version: '4.4.0' }), execNpmPackMeta: () => JSON.stringify({ __proto__: { commit: PUBLISHED_ANCHOR } }) },
        { execNpmView: () => JSON.stringify({ version: '4.4.0', gitHead: { toString: () => PUBLISHED_ANCHOR } }) },
      ];
      for (const extra of cases) {
        const result = gapCheckOf({ projectRoot: REPO_ROOT, ...extra });
        expect(Object.keys(result).sort()).toEqual(['checks', 'warnings']);
        expect(result.checks.some((c) => c.status === 'pass')).toBe(false);
        expect(gapWarnings(result).length).toBe(1);
      }
    });
    it('(c3b) 真实 tar：tarball 里没有 build-meta 成员（4.1.1/4.2.0 这类盖章前版本）→ missing-build-meta，而不是拉取失败', () => {
      const tgz = makeTarball(null);
      expect(() => readBuildMetaFromTarball(tgz)).toThrow(BuildMetaMissingError);
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => readBuildMetaFromTarball(tgz),
      });
      expectIndeterminate(result, 'missing-build-meta');
    });

    it('(c3c) 真实 tar：tarball 未落盘（dry-run 环境 npm pack 只报 filename）→ tarball-fetch-failed', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => readBuildMetaFromTarball(join(tmpdir(), 'pg-nonexistent', 'x.tgz')),
      });
      expectIndeterminate(result, 'tarball-fetch-failed');
    });

    it('(c6) 真实 tar：tarball 内有 build-meta → 经生产读取路径解析出锚点', () => {
      const tgz = makeTarball(JSON.stringify({ commit: PUBLISHED_ANCHOR, dirty: true, sourceDirty: false }));
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => readBuildMetaFromTarball(tgz),
      });
      const gap = result.checks.find((c) => c.id === 'gap');
      expect(gap?.evidence['refSource']).toBe('tarball-build-meta');
      expect(gap?.evidence['sourceStatus']).toBe('ok');
    });

    it('(c7) version 缺失 / range / dist-tag / 目录 spec 一律 published-version-unknown，且绝不调用 npm pack（不回退 latest）', () => {
      // `+build` 也在此列：npm 解析 spec 时丢掉 build metadata，回验 version 必然不等（第二角 I-1），入口即判
      for (const view of [{}, { version: '4' }, { version: 'latest' }, { version: '.' }, { version: '4.6.0 ' }, { version: 42 }, { version: '4.6.0+build.5' }]) {
        const result = gapCheckOf({
          projectRoot: REPO_ROOT,
          execNpmView: () => JSON.stringify(view),
          execNpmPackMeta: () => {
            throw new Error(`execNpmPackMeta MUST NOT be called for version ${JSON.stringify((view as { version?: unknown }).version)}`);
          },
        });
        expectIndeterminate(result, 'published-version-unknown');
      }
    });

    it('(c8) package.json name 不是合法 npm 包名（以 - 开头 / 含空白）→ package-name-invalid；name 为空 → package-name-unreadable；两者都不调用 npm view / pack', () => {
      const forbiddenPack = () => {
        throw new Error('execNpmPackMeta MUST NOT be called for an invalid package name');
      };
      for (const name of ['-x', '--registry=http://127.0.0.1:1/', 'Spectra CLI']) {
        const result = gapCheckOf({ projectRoot: makeProjectRootWithName(name), execNpmView: forbiddenNpmView, execNpmPackMeta: forbiddenPack });
        expectIndeterminate(result, 'package-name-invalid');
        // 文案必须说"不合法"而不是"读不到"（第二角 W-1：名字明明读到了）
        expect(gapWarnings(result)[0]).toContain('不是合法的 npm 包名');
        expect(gapWarnings(result)[0]).not.toContain('读不到');
      }
      const empty = gapCheckOf({ projectRoot: makeProjectRootWithName(''), execNpmView: forbiddenNpmView, execNpmPackMeta: forbiddenPack });
      expectIndeterminate(empty, 'package-name-unreadable');
    });

    it('(c8b) npm 老包名允许大写（JSONStream 一类）：白名单放行，npm view 以原名被调用', () => {
      const seen: string[] = [];
      const result = gapCheckOf({
        projectRoot: makeProjectRootWithName('JSONStream'),
        execNpmView: (packageName?: string) => {
          seen.push(String(packageName));
          return JSON.stringify({ version: '1.3.5', gitHead: PUBLISHED_ANCHOR });
        },
      });
      expect(seen).toEqual(['JSONStream']);
      // 临时项目根没有 git，链路在 git 探针处停下——这恰好证明包名已通过白名单并走完 npm view（reason 与包名无关）
      expect(result.checks[0]?.evidence.refSource).toBe('npm-view');
      expect(result.checks[0]?.evidence.reason).toBe('git-unavailable');
    });

    it('(c9) dirty 看全树不算数：只有 sourceDirty:true 才产出「dist 不可由锚点复现」warning', () => {
      const dirtyOnly = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => JSON.stringify({ commit: PUBLISHED_ANCHOR, dirty: true, sourceDirty: false }),
      });
      expect(dirtyOnly.warnings.some((w) => w.includes('sourceDirty'))).toBe(false);
      const sourceDirty = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => JSON.stringify({ commit: PUBLISHED_ANCHOR, dirty: true, sourceDirty: true }),
      });
      expect(sourceDirty.warnings.some((w) => w.includes('sourceDirty:true'))).toBe(true);
    });

    it('(c10) npm pack 的环境剥掉 npm_config_dry_run / npm_config_tag（publish --dry-run 与跨 tag 错配）', () => {
      const env = buildPackEnv({ PATH: '/usr/bin', npm_config_dry_run: 'true', npm_config_tag: 'next', npm_config_registry: 'https://r' });
      expect(env['npm_config_dry_run']).toBeUndefined();
      expect(env['npm_config_tag']).toBeUndefined();
      expect(env['npm_config_registry']).toBe('https://r');
      expect(env['PATH']).toBe('/usr/bin');
    });

    it('(c11) tarball 锚点在本地不可达 → unreachable-commit-tarball，处方与 registry 锚点相同（浅克隆 → fetch-depth: 0），不得声称 fetch-depth 无效', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => JSON.stringify({ commit: NONEXISTENT_REF, sourceDirty: false }),
      });
      expectIndeterminate(result, 'unreachable-commit-tarball');
      // 第二角审查 C-1：`--depth 1` 克隆下 tarball 里的 commit 同样不可达、`git fetch --unshallow` 后即 resolved——
      // 此前文案的"fetch-depth: 0 对这类根因无效"是假的排除断言，且被本用例锁死过。
      // 残余（第三轮审查 WARNING-2，如实登记）：本断言只锁住「必须给出浅克隆处方」与「不得出现『无效』字样」，
      // 换个措辞重新写进排除断言（如"对这一侧不起作用"）测试抓不到——文案的排除语义无法用字面断言穷尽。
      expect(gapWarnings(result)[0]).toContain('fetch-depth: 0');
      expect(gapWarnings(result)[0]).not.toContain('无效');
    });

    it('(c12) registry 的 gitHead 不是 40 位 commit sha（代理型 registry 改写成 HEAD / 分支名）→ 视同缺席走 tarball 路径，不得拿本地可解析的串算出零 warning 假绿', () => {
      for (const gitHead of ['HEAD', 'master', '  HEAD  ', 'v4.4.0']) {
        let packCalls = 0;
        const result = gapCheckOf({
          projectRoot: REPO_ROOT,
          execNpmView: () => JSON.stringify({ version: '4.4.0', gitHead }),
          execNpmPackMeta: () => {
            packCalls += 1;
            return JSON.stringify({ commit: PUBLISHED_ANCHOR, sourceDirty: false });
          },
        });
        expect(packCalls).toBe(1);
        expect(result.checks[0]?.evidence.refSource).toBe('tarball-build-meta');
        expect(result.checks[0]?.evidence.sourceStatus).toBe('ok');
      }
      // 大写 / 带空白的真 sha 归一化后仍走 registry 路径
      const upper = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0', gitHead: `  ${PUBLISHED_ANCHOR.toUpperCase()}  ` }),
        execNpmPackMeta: () => {
          throw new Error('execNpmPackMeta MUST NOT be called when gitHead is a valid sha');
        },
      });
      expect(upper.checks[0]?.evidence.refSource).toBe('npm-view');
      expect(upper.checks[0]?.evidence.sourceStatus).toBe('ok');
    });

    it('(c13) prerelease 精确版本（4.7.0-beta.1）放行到 tarball 路径并 resolved（合法能力有护栏，第二角 I-2）', () => {
      const seen: Array<string | null> = [];
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.7.0-beta.1' }),
        execNpmPackMeta: (_name, version) => {
          seen.push(version);
          return JSON.stringify({ commit: PUBLISHED_ANCHOR, sourceDirty: false });
        },
      });
      expect(seen).toEqual(['4.7.0-beta.1']);
      expect(result.checks[0]?.evidence.refSource).toBe('tarball-build-meta');
      expect(result.checks[0]?.evidence.publishedVersion).toBe('4.7.0-beta.1');
      expect(result.checks[0]?.evidence.sourceStatus).toBe('ok');
    });

    it('(c14) 包在但读不出（本机无 tar / 包损坏）→ tarball-read-failed，与「未盖章」missing-build-meta 分开', () => {
      const tgz = makeTarball(JSON.stringify({ commit: PUBLISHED_ANCHOR, sourceDirty: false }));
      // 本机没有 tar：PATH 指向不存在的目录
      const savedPath = process.env.PATH;
      process.env.PATH = '/nonexistent-bin';
      try {
        expect(() => readBuildMetaFromTarball(tgz)).toThrow(TarballReadError);
      } finally {
        process.env.PATH = savedPath;
      }
      // 包损坏（截断的 gzip）
      const corrupt = join(mkdtempSync(join(tmpdir(), 'pg-corrupt-')), 'x.tgz');
      writeFileSync(corrupt, readFileSync(tgz).subarray(0, 64));
      expect(() => readBuildMetaFromTarball(corrupt)).toThrow(TarballReadError);
      // 成员不存在仍是 BuildMetaMissingError（与 c3b 同口径）
      expect(() => readBuildMetaFromTarball(makeTarball(null))).toThrow(BuildMetaMissingError);
      // 判据层：TarballReadError → tarball-read-failed，文案指向本机 tar 而不是"该版本未盖章"
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => {
          throw new TarballReadError('本机没有可执行的 tar');
        },
      });
      expectIndeterminate(result, 'tarball-read-failed');
      expect(gapWarnings(result)[0]).toContain('tar');
      expect(gapWarnings(result)[0]).not.toContain('盖章前');
    });

    it('(c4) build-meta 标 sourceDirty:true 时锚点仍可用，但额外产出「dist 不可由锚点复现」warning', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
        execNpmPackMeta: () => JSON.stringify({ commit: PUBLISHED_ANCHOR, sourceDirty: true }),
      });
      const gap = result.checks.find((c) => c.id === 'gap');
      expect(gap?.evidence['refSource']).toBe('tarball-build-meta');
      expect(result.warnings.some((w) => w.includes('sourceDirty:true'))).toBe(true);
    });

    it('(c5) gitHead 存在时不得调用 tarball 回退（registry 字段优先，避免无谓下载）', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        execNpmView: () => JSON.stringify({ version: '4.4.0', gitHead: PUBLISHED_ANCHOR }),
        execNpmPackMeta: () => {
          throw new Error('execNpmPackMeta MUST NOT be called when gitHead is present');
        },
      });
      const gap = result.checks.find((c) => c.id === 'gap');
      expect(gap?.evidence['refSource']).toBe('npm-view');
    });

    it('(d) npm view 返回非 JSON → malformed-response', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmView: () => 'npm ERR! code E404',
      });
      expectIndeterminate(result, 'malformed-response');
    });

    it('(e) git rev-list 返回非数字（仓库损坏形态）→ count-unparseable，不误判为无领先', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({ revList: () => 'not-a-number\n' }),
      });
      expectIndeterminate(result, 'count-unparseable');
      // 这条病因与"commit 不可达"无关，不该出现 fetch-depth 的误导性提示
      expect(gapWarnings(result)[0]).not.toContain('fetch-depth');
    });

    it('(f) git rev-list 执行失败 → revlist-failed（与 count-unparseable 分开）', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({
          revList: () => {
            throw new Error('fatal: bad revision');
          },
        }),
      });
      expectIndeterminate(result, 'revlist-failed');
      expect(gapWarnings(result)[0]).not.toContain('fetch-depth');
    });

    it('(g) git 本身不可用 / 不在 git 工作区 → git-unavailable', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({
          revParse: () => {
            const err: NodeJS.ErrnoException = new Error('spawn git ENOENT');
            err.code = 'ENOENT';
            throw err;
          },
        }),
      });
      expectIndeterminate(result, 'git-unavailable');
    });

    it('(h) C-3：量测路径在 HEAD 上不存在 → pathspec-empty，而不是静悄悄的 N=0 pass', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
        execGit: fakeGit({
          catFile: (rev) => {
            // 只让"量测路径存在性"这一条探针失败（src 被改名 / project-root 指错）
            if (rev === 'HEAD:src') throw new Error("fatal: path 'src' does not exist in 'HEAD'");
            return '';
          },
          // 🔴 这条 stub 是本用例的要害：即便 rev-list 老老实实回 0，
          // 判据也必须落 indeterminate 而不是 pass —— 「0」在这里不是事实而是幻觉。
          revList: () => '0\n',
        }),
      });
      expectIndeterminate(result, 'pathspec-empty');
    });

    it('(i) W-3：npm view 报 E404 → package-not-found，不再统称"网络不可达"', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmView: () => {
          const err = new Error('npm view failed') as Error & { stdout?: string };
          err.stdout = JSON.stringify({
            error: { code: 'E404', summary: 'spectra-cli - Not found' },
          });
          throw err;
        },
      });
      expectIndeterminate(result, 'package-not-found');
      expect(gapWarnings(result)[0]).toContain('E404');
    });

    it('(j) npm view 失败但 stdout 不是 E404 JSON → 仍归 network（不冒充已知病因）', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmView: () => {
          const err = new Error('npm view failed') as Error & { stdout?: string };
          err.stdout = 'npm ERR! network request failed';
          throw err;
        },
      });
      expectIndeterminate(result, 'network');
    });

    it('(k) 读不到 package.json 的 name → package-name-unreadable（W-3：包名不再硬编码）', () => {
      const result = gapCheckOf({
        // 存在但没有 package.json 的目录：包名读不出来就不该猜一个去查
        projectRoot: resolve('./scripts'),
        publishedRefOverride: '',
        execNpmView: forbiddenNpmView,
      });
      expectIndeterminate(result, 'package-name-unreadable');
    });

    it('包名取自 package.json 的 name 字段（而非硬编码常量）', () => {
      let queried: string | undefined;
      gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmView: (packageName?: string) => {
          queried = packageName;
          return JSON.stringify({ version: '4.4.0', gitHead: PUBLISHED_ANCHOR });
        },
      });
      expect(queried).toBe('spectra-cli');
    });
  });

  describe('结构性不变量：返回值没有 errors 键', () => {
    // 架构决策 A：checkPublishGap 的输出永远不能进 payload.errors，否则 release:check 会变红，
    // 而 prepublishOnly 串着 release:check——判据能变红就等于发布路径被自己堵死。
    // 这条断言把不变量锁进用例，防止未来合并时手滑接进 errors。
    it('ok 路径不含 errors 键', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: PUBLISHED_ANCHOR,
        execNpmView: forbiddenNpmView,
      });
      expect(Object.keys(result).includes('errors')).toBe(false);
      expect(Object.keys(result).sort()).toEqual(['checks', 'warnings']);
    });

    it('indeterminate 路径同样不含 errors 键', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: NONEXISTENT_REF,
        execNpmView: forbiddenNpmView,
      });
      expect(Object.keys(result).includes('errors')).toBe(false);
      expect(Object.keys(result).sort()).toEqual(['checks', 'warnings']);
    });

    it('pass 路径同样不含 errors 键', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: 'HEAD',
        execNpmView: forbiddenNpmView,
      });
      expect(Object.keys(result).includes('errors')).toBe(false);
      expect(Object.keys(result).sort()).toEqual(['checks', 'warnings']);
    });
  });

  describe('SPECTRA_PUBLISHED_REF 环境变量入口', () => {
    it('未显式传 publishedRefOverride 时读环境变量', () => {
      const saved = process.env.SPECTRA_PUBLISHED_REF;
      process.env.SPECTRA_PUBLISHED_REF = PUBLISHED_ANCHOR;
      try {
        const result = gapCheckOf({ projectRoot: REPO_ROOT, execNpmView: forbiddenNpmView });
        expect(result.checks[0]?.evidence.refSource).toBe('env-override');
        expect(overrideWarnings(result)).toHaveLength(1);
      } finally {
        if (saved === undefined) delete process.env.SPECTRA_PUBLISHED_REF;
        else process.env.SPECTRA_PUBLISHED_REF = saved;
      }
    });
  });

  describe('合并进 release:check 后的 check id（I-1）', () => {
    it('模块内 id 为 `gap`，合并层前缀后成 `publish-gap:gap`（不再是 publish-gap:publish-gap）', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: 'HEAD',
        execNpmView: forbiddenNpmView,
      });
      expect(result.checks.map((c) => c.id)).toEqual(['gap']);
    });
  });
});

// ── 生产实现 `defaultExecNpmPackMeta`：用 PATH 上的 npm shim 离线覆盖（第二角 W-3：此前从未被执行）──
describe('defaultExecNpmPackMeta（生产实现，npm shim）', () => {
  /**
   * 造一个假 npm：记录 cwd / argv / npm_config_dry_run，把 fixture tgz 复制进 `--pack-destination`
   * （磁盘名与它报的 filename 可以不同——npm 8 对 scoped 包报带 `/` 的串），再打印 `--json` 返回体。
   */
  function makeNpmShim(spec: { name: string; version: string; filename: string; tgz: string | null; diskName?: string; extraTgz?: boolean; view?: string }): { bin: string; log: string } {
    const bin = mkdtempSync(join(tmpdir(), 'pg-npm-shim-'));
    const log = join(bin, 'calls.log');
    const copy = spec.tgz === null ? '' : `cp "${spec.tgz}" "$dest/${spec.diskName ?? 'pkg.tgz'}"`;
    const extra = spec.extraTgz && spec.tgz !== null ? `cp "${spec.tgz}" "$dest/extra.tgz"` : '';
    const script = [
      '#!/bin/sh',
      `printf '%s\\n' "cwd=$(pwd -P)" "argv=$*" "dry_run=\${npm_config_dry_run-<unset>}" >> "${log}"`,
      `if [ "$1" = "view" ]; then printf '%s' '${spec.view ?? '{}'}'; exit 0; fi`,
      'dest=""; prev=""',
      'for a in "$@"; do if [ "$prev" = "--pack-destination" ]; then dest="$a"; fi; prev="$a"; done',
      copy,
      extra,
      `printf '%s' '[{"name":"${spec.name}","version":"${spec.version}","filename":"${spec.filename}"}]'`,
      '',
    ].join('\n');
    writeFileSync(join(bin, 'npm'), script, { mode: 0o755 });
    return { bin, log };
  }
  const withShim = <T,>(bin: string, fn: () => T): T => {
    const savedPath = process.env.PATH;
    const savedDryRun = process.env.npm_config_dry_run;
    process.env.PATH = `${bin}:${savedPath ?? ''}`;
    process.env.npm_config_dry_run = 'true';
    try {
      return fn();
    } finally {
      process.env.PATH = savedPath;
      if (savedDryRun === undefined) delete process.env.npm_config_dry_run;
      else process.env.npm_config_dry_run = savedDryRun;
    }
  };
  const META = JSON.stringify({ commit: PUBLISHED_ANCHOR, sourceDirty: false });

  it('接线：cwd = 项目根、argv 精确、剥掉 npm_config_dry_run、按枚举到的唯一 tgz 读 build-meta', () => {
    const tgz = makeTarball(META);
    const { bin, log } = makeNpmShim({ name: 'spectra-cli', version: '4.4.0', filename: 'spectra-cli-4.4.0.tgz', tgz, diskName: 'spectra-cli-4.4.0.tgz' });
    const root = makeProjectRootWithName('spectra-cli');
    const meta = withShim(bin, () => defaultExecNpmPackMeta('spectra-cli', '4.4.0', { projectRoot: root }));
    expect(JSON.parse(meta).commit).toBe(PUBLISHED_ANCHOR);
    const lines = readFileSync(log, 'utf-8').trim().split('\n');
    expect(lines[0]).toBe(`cwd=${realpathSync(root)}`);
    expect(lines[1]).toMatch(/^argv=pack spectra-cli@4\.4\.0 --pack-destination \S+ --json$/);
    expect(lines[2]).toBe('dry_run=<unset>');
  });

  it('npm 8 形态：scoped 包报 `@scope/name-1.0.0.tgz` 而磁盘上是 `scope-name-1.0.0.tgz` → 仍读到（不相信 filename）', () => {
    const tgz = makeTarball(META);
    const { bin } = makeNpmShim({ name: '@scope/name', version: '1.0.0', filename: '@scope/name-1.0.0.tgz', tgz, diskName: 'scope-name-1.0.0.tgz' });
    const meta = withShim(bin, () => defaultExecNpmPackMeta('@scope/name', '1.0.0', { projectRoot: makeProjectRootWithName('@scope/name') }));
    expect(JSON.parse(meta).commit).toBe(PUBLISHED_ANCHOR);
  });

  it('回验：npm 返回的 version 与请求不一致 → 拒绝采信（不读任何 tgz）', () => {
    const tgz = makeTarball(META);
    const { bin } = makeNpmShim({ name: 'spectra-cli', version: '4.4.1', filename: 'spectra-cli-4.4.1.tgz', tgz });
    expect(() => withShim(bin, () => defaultExecNpmPackMeta('spectra-cli', '4.4.0', { projectRoot: makeProjectRootWithName('spectra-cli') }))).toThrow(/不一致/);
  });

  it('目标目录里 tgz 不唯一（0 个 / 2 个）→ 拒绝采信，不猜哪个是本次的', () => {
    const tgz = makeTarball(META);
    const none = makeNpmShim({ name: 'spectra-cli', version: '4.4.0', filename: 'spectra-cli-4.4.0.tgz', tgz: null });
    expect(() => withShim(none.bin, () => defaultExecNpmPackMeta('spectra-cli', '4.4.0', { projectRoot: makeProjectRootWithName('spectra-cli') }))).toThrow(/唯一/);
    const two = makeNpmShim({ name: 'spectra-cli', version: '4.4.0', filename: 'spectra-cli-4.4.0.tgz', tgz, extraTgz: true });
    expect(() => withShim(two.bin, () => defaultExecNpmPackMeta('spectra-cli', '4.4.0', { projectRoot: makeProjectRootWithName('spectra-cli') }))).toThrow(/唯一/);
  });

  it('入口守卫：非法包名 / 非精确版本（含 +build）在调用 npm 之前就拒绝', () => {
    const { bin, log } = makeNpmShim({ name: 'x', version: '1.0.0', filename: 'x-1.0.0.tgz', tgz: null });
    for (const [name, version] of [['-x', '1.0.0'], ['spectra-cli', '.'], ['spectra-cli', 'latest'], ['spectra-cli', '4.6.0+build.5']]) {
      expect(() => withShim(bin, () => defaultExecNpmPackMeta(name, version, { projectRoot: REPO_ROOT }))).toThrow(/拒绝 pack/);
    }
    expect(() => readFileSync(log)).toThrow();
  });

  it('回验：npm 返回的包名与请求不一致（同版本号）→ 拒绝采信（第三轮审查 WARNING-3：合取守卫的包名半边此前无用例）', () => {
    const tgz = makeTarball(META);
    const { bin } = makeNpmShim({ name: 'evil-other-pkg', version: '4.4.0', filename: 'evil-other-pkg-4.4.0.tgz', tgz });
    expect(() => withShim(bin, () => defaultExecNpmPackMeta('spectra-cli', '4.4.0', { projectRoot: makeProjectRootWithName('spectra-cli') }))).toThrow(/不一致/);
  });

  it('两条事实源同一 cwd：不注入任何替身时 npm view 与 npm pack 都以项目根为 cwd 执行（第三轮审查 WARNING-4）', () => {
    const tgz = makeTarball(META);
    const { bin, log } = makeNpmShim({ name: 'spectra-cli', version: '4.4.0', filename: 'spectra-cli-4.4.0.tgz', tgz, diskName: 'spectra-cli-4.4.0.tgz', view: JSON.stringify({ version: '4.4.0' }) });
    const root = makeProjectRootWithName('spectra-cli');
    const result = withShim(bin, () => gapCheckOf({ projectRoot: root }));
    // 临时项目根没有 git：链路在 git 探针停下，但两次 npm 调用已发生且 cwd 都是项目根
    expect(result.checks[0]?.evidence.refSource).toBe('tarball-build-meta');
    expect(result.checks[0]?.evidence.reason).toBe('git-unavailable');
    const calls = readFileSync(log, 'utf-8').trim().split('\n');
    expect(calls.filter((l) => l.startsWith('cwd='))).toEqual([`cwd=${realpathSync(root)}`, `cwd=${realpathSync(root)}`]);
    expect(calls.filter((l) => l.startsWith('argv='))).toEqual(['argv=view spectra-cli --json', expect.stringMatching(/^argv=pack spectra-cli@4\.4\.0 --pack-destination \S+ --json$/)]);
  });
});

