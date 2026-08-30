import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
// @ts-expect-error — .mjs 无类型声明，运行时可解析
import { checkPublishGap } from '../../scripts/lib/publish-gap-check.mjs';

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
  execNpmView?: (packageName?: string) => string;
  execGit?: (args: string[], projectRoot: string) => string;
}

const gapCheckOf = (options: GapOptions): GapResult => checkPublishGap(options) as GapResult;

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

    it('(c) npm view 返回体缺 gitHead → missing-git-head', () => {
      const result = gapCheckOf({
        projectRoot: REPO_ROOT,
        publishedRefOverride: '',
        execNpmView: () => JSON.stringify({ version: '4.4.0' }),
      });
      expectIndeterminate(result, 'missing-git-head');
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
