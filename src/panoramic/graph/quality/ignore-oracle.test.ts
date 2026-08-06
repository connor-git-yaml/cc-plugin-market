/**
 * ignore-oracle 单测（F217 T011，P0 修正后）
 * 覆盖 FR-008 增补：
 * - 真实 import PY_SKELETON_IGNORE_DIRS / TSJS_SKELETON_IGNORE_DIRS，断言两常量
 *   ⊆ GRAPH_COLLECTOR_IGNORE_DIRS（图生产者 ignore 合同的单一事实源，定义于 ignore-oracle.ts）
 * - isIgnoredPath 对 .gitignore 命中路径与 GRAPH_COLLECTOR_IGNORE_DIRS 命中路径均返回 true
 * - P0 回归断言：specs/**\/contracts/*.ts 类路径不应被误判为 ignored
 *   （file-scanner.ts 的 BUILTIN_IGNORE_DIRS 含 'specs'/'examples' 是 spec 生成扫描器语义，
 *   与图生产者"specs/ 下真实源码需入图"的合同冲突——本仓库曾因此误报 551 个 ignored-path 节点）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createIgnoreOracle, GRAPH_COLLECTOR_IGNORE_DIRS } from './ignore-oracle.js';
import { checkLegacyAndIgnoredNodes } from './legacy-ignored-check.js';
import type { GraphJSON } from '../graph-types.js';
import { PY_SKELETON_IGNORE_DIRS, TSJS_SKELETON_IGNORE_DIRS } from '../../../batch/batch-orchestrator.js';

describe('ignore-oracle: 一致性单测', () => {
  it('PY_SKELETON_IGNORE_DIRS ⊆ GRAPH_COLLECTOR_IGNORE_DIRS', () => {
    for (const dir of PY_SKELETON_IGNORE_DIRS) {
      expect(
        GRAPH_COLLECTOR_IGNORE_DIRS.has(dir),
        `PY_SKELETON_IGNORE_DIRS 中的 "${dir}" 应在 GRAPH_COLLECTOR_IGNORE_DIRS 内`,
      ).toBe(true);
    }
  });

  it('TSJS_SKELETON_IGNORE_DIRS ⊆ GRAPH_COLLECTOR_IGNORE_DIRS', () => {
    for (const dir of TSJS_SKELETON_IGNORE_DIRS) {
      expect(
        GRAPH_COLLECTOR_IGNORE_DIRS.has(dir),
        `TSJS_SKELETON_IGNORE_DIRS 中的 "${dir}" 应在 GRAPH_COLLECTOR_IGNORE_DIRS 内`,
      ).toBe(true);
    }
  });

  // 反向说明：GRAPH_COLLECTOR_IGNORE_DIRS 允许是两者的真超集（union 语义），
  // 不要求恰好相等——未来某语言 collector 单独新增忽略目录，只需同步补充本集合，
  // 不强制另一语言也认识该目录。
});

describe('createIgnoreOracle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-oracle-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('.gitignore 命中路径返回 true', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'generated/\n*.stub.ts\n');
    const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;

    expect(isIgnoredPath('generated/auto.ts')).toBe(true);
    expect(isIgnoredPath('pkg/foo.stub.ts')).toBe(true);
    expect(isIgnoredPath('pkg/core.ts')).toBe(false);
  });

  it('内置忽略目录命中路径返回 true（即使未在 .gitignore 中显式声明）', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;

    expect(isIgnoredPath('dist/index.js')).toBe(true);
    expect(isIgnoredPath('.git/HEAD')).toBe(true);
    expect(isIgnoredPath('src/core/valid.ts')).toBe(false);
  });

  it('无 .gitignore 时仍能正常按内置目录判定', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
    expect(isIgnoredPath('coverage/report.html')).toBe(true);
    expect(isIgnoredPath('src/a.ts')).toBe(false);
  });

  it('P0 回归：specs/ 下真实源码路径不应被误判为 ignored（与图生产者合同对齐）', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
    expect(isIgnoredPath('specs/217-graph-quality-gates/contracts/graph-quality-report.schema.ts')).toBe(
      false,
    );
    expect(isIgnoredPath('examples/demo.ts')).toBe(false);
  });

  it('P0 回归：node_modules 等图生产者真正忽略的目录仍判定为 ignored', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
    expect(isIgnoredPath('node_modules/pkg/index.ts')).toBe(true);
  });

  // ============================================================
  // FIX-5（Codex WARNING）：按语言分派到对应生产者忽略集合，而非无差别 union。
  // 此前 union 判定会导致：Go 文件误判命中 .gradle（Java 目录）反而正确排除了
  // vendor（因为 vendor 在 union 里）；但也会让 tmp/venv 这类"仅某语言生产者
  // 排除"的目录误伤到不该排除的语言（如 PY 生产者不排 tmp，TSJS 生产者不排 venv）。
  // ============================================================
  describe('按语言分派（FIX-5）', () => {
    it('vendor/x.go → ignored（Go generic adapter defaultIgnoreDirs 含 vendor，此前假阴性）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('vendor/x.go')).toBe(true);
    });

    it('.gradle/x.java → ignored（Java generic adapter defaultIgnoreDirs 含 .gradle）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('.gradle/x.java')).toBe(true);
    });

    it('tmp/a.py → 不 ignored（PY collector 忽略集合不含 tmp，此前 union 误伤为假阳性）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('tmp/a.py')).toBe(false);
    });

    it('venv/a.ts → 不 ignored（TSJS collector 忽略集合不含 venv，此前 union 误伤为假阳性）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('venv/a.ts')).toBe(false);
    });

    it('venv/a.py → 仍 ignored（PY collector 忽略集合本身含 venv，语言分派不应破坏 PY 自身合同）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('venv/a.py')).toBe(true);
    });

    it('tmp/a.ts → 仍 ignored（TSJS collector 忽略集合本身含 tmp，语言分派不应破坏 TSJS 自身合同）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('tmp/a.ts')).toBe(true);
    });

    // F243：.mjs/.cjs 纳入 TSJS 扫描面后，也必须走 TSJS 分派分支而非未知扩展名 union 兜底，
    // 否则 oracle 判定面与 collector 实际扫描面再次脱节（ignored 检查漏检/误检）。
    it('tmp/a.mjs → 仍 ignored（.mjs 路由到 TSJS 分支，TSJS 忽略集合含 tmp）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('tmp/a.mjs')).toBe(true);
    });

    it('venv/a.mjs → 不 ignored（.mjs 走 TSJS 分支，TSJS 忽略集合不含 venv；若退回 union 兜底会误判 true）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('venv/a.mjs')).toBe(false);
    });

    it('venv/a.cjs → 不 ignored（.cjs 同样走 TSJS 分支）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('venv/a.cjs')).toBe(false);
    });

    it('未知扩展名（如 .rb）仍用 union 兜底（保守）：node_modules/x.rb → ignored', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('node_modules/x.rb')).toBe(true);
    });

    // F252：分派改由 surfaceMatchesFile 按各管线真实匹配形态求值后，大小写不敏感族
    // （Java/Go）的纯 dotfile 不再被误分派到该语言专属忽略集合。判据取"首段目录只存在于
    // 该语言 adapter 的 defaultIgnoreDirs、不在 GRAPH_COLLECTOR_IGNORE_DIRS union 内"，
    // 因此旧的误分派逻辑判 true、新的 union 兜底判 false，两者可区分。
    it('vendor/.go → 不 ignored（纯 dotfile 不再误分派到 Go 专属忽略集合，F252 行为变化点）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      // generic collector 的 path.extname('.go') === ''，根本不会采集这个文件
      expect(isIgnoredPath('vendor/.go')).toBe(false);
    });

    it('.gradle/.java → 不 ignored（纯 dotfile 不再误分派到 Java 专属忽略集合，F252 行为变化点）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('.gradle/.java')).toBe(false);
    });

    it('vendor/foo.go（真实 Go 文件，非纯 dotfile）→ 仍 ignored（case-insensitive 族非 dotfile 场景零变化）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('vendor/foo.go')).toBe(true);
    });

    // 纯 dotfile 分歧是**双向**的：上面两例取"目录段只在语言专属集合内"（vendor/.gradle）
    // 得到 true→false，本例取相反判别式——目录段只在 union 内、不在该语言专属集合内。
    // 'tmp' ∈ GRAPH_COLLECTOR_IGNORE_DIRS 但 ∉ javaIgnoreDirs()，故末尾切片式提取会算出
    // '.java' 分派到 Java 专属集合而判 false，union 兜底则判 true。
    it('tmp/.java → ignored（union 兜底后 union 独有目录段新命中，反向 flip 钉住）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('tmp/.java')).toBe(true);
    });

    // 第二类分歧：path.extname 剥掉尾随分隔符（path.extname('vendor/f.go/') === '.go'），
    // 而末尾切片式提取保留分隔符得到 '.go/'、不落任何采集面。故分派移动方向与纯 dotfile
    // 相反——本例走 Go 专属集合（含 vendor）判 true，union 兜底（不含 vendor）则判 false。
    it('vendor/f.go/ → ignored（尾随分隔符经 path.extname 剥离后命中 Go 面，第二类分歧钉住）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir).isIgnored;
      expect(isIgnoredPath('vendor/f.go/')).toBe(true);
    });
  });
});

/**
 * F258 — 三态收敛与消费方保守方向。
 *
 * 与上面 `createIgnoreOracle` 族的 tmpDir 不同，本族使用**真实 git 仓库**：
 * 三态只在 git 模式下产生（L0 非 git 上下文永不产出 undeterminable）。
 */
describe('createIgnoreOracle：三态收敛（F258）', () => {
  let repoDir: string;

  function git(args: string[], cwd = repoDir): void {
    execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  function initRepo(dir = repoDir): void {
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'f258-test@example.com'], dir);
    git(['config', 'user.name', 'F258 Test'], dir);
  }

  function writeFile(relativePath: string, content = 'export {}'): void {
    const full = path.join(repoDir, relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  /** 造一份只含给定 filePart 的最小图，走真实 checkLegacyAndIgnoredNodes。 */
  function graphWith(fileParts: string[]): GraphJSON {
    return {
      directed: true,
      multigraph: false,
      graph: { schemaVersion: '2.0' },
      nodes: fileParts.map((filePart) => ({
        id: `${filePart}::Sym`,
        kind: 'component',
        label: 'Sym',
        metadata: { unifiedKind: 'symbol', sourcePath: filePart },
      })),
      links: [],
    } as unknown as GraphJSON;
  }

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f258-ignore-oracle-'));
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  // R1-4（复刻 fix-report R4）：仓内 symlink 指向被忽略目录，查其下**离盘**路径
  it('R1-4: 离盘 symlink 穿越路径 ⇒ undeterminable ⇒ 消费方按 not-ignored 处理 + 计数出声', () => {
    writeFile('.gitignore', 'ignored_dir/\n');
    writeFile('src/a.ts');
    writeFile('ignored_dir/real.ts');
    initRepo();
    git(['add', '.gitignore', 'src/a.ts']);
    git(['commit', '-q', '-m', 'init']);
    fs.symlinkSync('ignored_dir', path.join(repoDir, 'link_to_ign'));

    const oracle = createIgnoreOracle(repoDir);
    // link_to_ign/ghost.ts 不在盘 ⇒ 走权威查询 ⇒ exit 128 拒答 ⇒ undeterminable
    const report = checkLegacyAndIgnoredNodes(graphWith(['link_to_ign/ghost.ts']), oracle.isIgnored);

    // 保守方向：判不了 ⇒ 按 not-ignored ⇒ **不计入违规**（不得让环境噪声把门变红）
    expect(report.ignoredPathNodeIds).toEqual([]);
    // 但必须出声，不静默
    const drained = oracle.drainUndeterminable();
    expect(drained.count).toBe(1);
    expect(drained.samples).toContain('link_to_ign/ghost.ts');
  });

  it('R1-4b: 离盘且规则真命中的节点 ⇒ 计入 ignoredPathNodeIds（门在该维度不再漏报）', () => {
    writeFile('.gitignore', 'legacy/\n');
    writeFile('src/a.ts');
    initRepo();
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);

    const oracle = createIgnoreOracle(repoDir);
    const report = checkLegacyAndIgnoredNodes(
      graphWith(['legacy/old.ts', 'src/a.ts']),
      oracle.isIgnored,
    );

    expect(report.ignoredPathNodeIds).toEqual(['legacy/old.ts::Sym']);
    expect(oracle.drainUndeterminable().count).toBe(0);
  });

  // R1-5（复刻 fix-report R2）：KL-1 已知限制，非 bug
  it('R1-5: KL-1 已知限制（非 bug）——嵌套未注册 git 仓内的**在盘**路径仍判 not-ignored', () => {
    writeFile('.gitignore', '*.gen.ts\n');
    writeFile('src/a.ts');
    initRepo();
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);

    // 嵌套未注册的 git 仓：git ls-files 不枚举进去，check-ignore 却判 IGNORED
    const subrepo = path.join(repoDir, 'subrepo');
    fs.mkdirSync(subrepo, { recursive: true });
    initRepo(subrepo);
    writeFile('subrepo/a.gen.ts');

    const oracle = createIgnoreOracle(repoDir);

    // 在盘 ⇒ L1 查表 MISS ⇒ not-ignored；与 check-ignore 的 IGNORED 分叉，登记为 KL-1
    expect(oracle.isIgnored('subrepo/a.gen.ts')).toBe(false);
    expect(oracle.drainUndeterminable().count).toBe(0);
  });

  // KL-4（R6）：freshness 三维不记录忽略规则内容 ⇒ 同一份图两次运行结论可翻转
  it('KL-4 已知限制（非 bug）——未提交的 .gitignore 改动即可翻转 ignoredPathNodeIds', () => {
    writeFile('.gitignore', '*.log\n');
    writeFile('src/a.ts');
    initRepo();
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);

    const graph = graphWith(['legacy/old.ts']);

    const before = checkLegacyAndIgnoredNodes(graph, createIgnoreOracle(repoDir).isIgnored);
    expect(before.ignoredPathNodeIds).toEqual([]);

    // 只改工作树、**不提交**——HEAD sha 不变，freshness 三维一个都不动
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '*.log\nlegacy/\n');

    const after = checkLegacyAndIgnoredNodes(graph, createIgnoreOracle(repoDir).isIgnored);
    expect(after.ignoredPathNodeIds).toEqual(['legacy/old.ts::Sym']);
    // 同一份图、同一个 HEAD，结论已翻转 —— 这是 defer 的 KL-4，本 fix 不修，只钉住
  });
});
