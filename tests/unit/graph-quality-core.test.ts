/**
 * F217 T037/T039 — repo:check 图质量子检查集成测试。
 *
 * 覆盖 SC-012 四态：graph 缺失→skip；JSON 损坏→warning；强不变量违反→error（阻断）；
 * 非强不变量问题→warning（不阻断）；dist CLI 缺失→warning；dirty 态不产生 warning（FR-026）。
 *
 * spawnSync 真实覆盖 exit 1（强不变量违反）与 exit 2（无法评估）两条分支——不 mock
 * spawnSync 返回值，而是构造真实触发这两个 exit code 的 --graph 输入跑真实 dist CLI 子进程
 * （dist/ 通过 symlink 复用已构建产物，避免每个 test 重复拷贝 ~8MB）。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error — .mjs 无类型声明，运行时可解析
import { validateGraphQuality } from '../../scripts/lib/graph-quality-core.mjs';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import {
  ALL_STALE_REASONS,
  SC009_STALE_SCENARIOS,
  baseFreshnessGraph,
} from '../helpers/freshness-stale-scenarios.js';
import { assertDistBuilt } from '../helpers/dist-cli-guard.js';

const REPO_ROOT = resolve('.');

interface CheckEntry {
  id: string;
  title: string;
  status: string;
  evidence: Record<string, unknown>;
}

interface CheckResult {
  status: string;
  checks: CheckEntry[];
  warnings: string[];
  errors: string[];
}

/**
 * F249：委托共享 helper —— 默认携带当前合法指纹。
 *
 * 既有"期待零 warning"的用例（如 dirty 态不告警）必须带指纹，否则会因 FR-010 归入
 * `collector-fingerprint-unrecorded` 而产生 stale warning——那是本机制的预期语义而非回归。
 */
const baseGraph = baseFreshnessGraph;

function writeGraph(projectRoot: string, graph: GraphJSON): string {
  const graphPath = join(projectRoot, 'specs', '_meta', 'graph.json');
  mkdirSync(join(graphPath, '..'), { recursive: true });
  writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
  return graphPath;
}

/** 复用已构建的 dist/（symlink，避免每个 test 拷贝 ~8MB）。 */
function linkDist(projectRoot: string): void {
  symlinkSync(join(REPO_ROOT, 'dist'), join(projectRoot, 'dist'), 'dir');
}

function gitConfig(dir: string): void {
  execFileSync('git', ['config', 'user.email', 'f217-core-test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'F217 Core Test'], { cwd: dir });
}

function initGitRepoWithCommit(dir: string): string {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  gitConfig(dir);
  writeFileSync(join(dir, 'README.md'), '# f217 core fixture\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
}

describe('graph-quality-core.mjs（F217 T037/T038）', () => {
  beforeAll(() => {
    // F251：dist 构建已收拢到 vitest globalSetup（tests/global-setup.ts），
    // 此处只做 fail-fast 存在性断言，不再触发构建（避免与其他文件竞写 dist）。
    assertDistBuilt();
  });

  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'graph-quality-core-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('graph.json 不存在 → 优雅跳过（FR-017：既非 warning 也非 error）', () => {
    linkDist(projectRoot);

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.checks.some((c) => c.status === 'skip')).toBe(true);
  });

  it('dist/cli/index.js 不存在 → warning（含"未构建"/"npm run build"提示）', () => {
    const sha = initGitRepoWithCommit(projectRoot);
    writeGraph(projectRoot, baseGraph({ sourceCommit: sha }));
    // 不 linkDist：dist 缺失

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.errors).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes('未构建') || w.includes('npm run build')),
    ).toBe(true);
  });

  it('图产物 JSON 解析失败 → warning（FR-027：既非 skip 也非 error）', () => {
    linkDist(projectRoot);
    initGitRepoWithCommit(projectRoot);
    const graphPath = join(projectRoot, 'specs', '_meta', 'graph.json');
    mkdirSync(join(graphPath, '..'), { recursive: true });
    writeFileSync(graphPath, '{ this is not valid json', 'utf-8');

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('schemaVersion 过旧（cannot-assess）→ warning，真实覆盖 dist CLI exit 2 分支', () => {
    linkDist(projectRoot);
    writeGraph(projectRoot, baseGraph({ schemaVersion: '1.0' }));

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  /**
   * F266 T003/T006：把"消费侧无需改动"这个核实结论固化为回归网。
   *
   * T003 核实结论：`graph-quality-core.mjs` **不存在** `cannotAssessReason` 值白名单——
   * cannot-assess 的路由完全由 `report.overallVerdict === 'cannot-assess'` 决定，reason
   * 只作为文案/evidence 透传（带 `?? 'unknown'` 兜底）。因此新增 `empty-graph` 自动继承
   * warn 严重度，无需改 .mjs。
   *
   * 但"结论正确"和"结论会一直正确"是两回事：若将来有人把这里改成按 reason 值分派
   * （F259 的"判据写成值枚举=每加一个值漏一次"前车之鉴），下面这条会立刻红。
   */
  describe('F266：empty-graph（新增 cannotAssessReason）在消费侧的映射行为', () => {
    it('空图 → warn 严重度（非 error、非 skip），且 warning 文案与 evidence 携带 empty-graph 字面量', () => {
      linkDist(projectRoot);
      const sha = initGitRepoWithCommit(projectRoot);
      const graph = baseGraph({ sourceCommit: sha });
      graph.nodes = [];
      graph.links = [];
      writeGraph(projectRoot, graph);

      const result = validateGraphQuality({ projectRoot }) as CheckResult;

      expect(result.status).toBe('warn');
      expect(result.errors).toEqual([]);
      // 文案必须把成因说清楚，否则 CI 上的人拿到的只是"评估失败"这种无处方的噪声
      expect(result.warnings.some((w) => w.includes('empty-graph'))).toBe(true);

      const assessable = result.checks.find((c) => c.id === 'graph-assessable');
      expect(assessable?.status).toBe('warn');
      expect(assessable?.evidence['cannotAssessReason']).toBe('empty-graph');
    });

    it('A6a：no-symbol-nodes 同样自动继承 warn 严重度（消费侧无 reason 白名单的回归网）', () => {
      linkDist(projectRoot);
      const sha = initGitRepoWithCommit(projectRoot);
      const graph = baseGraph({ sourceCommit: sha });
      graph.nodes = graph.nodes.filter((n) => n.metadata?.['unifiedKind'] !== 'symbol');
      graph.links = [];
      writeGraph(projectRoot, graph);

      const result = validateGraphQuality({ projectRoot }) as CheckResult;

      expect(result.status).toBe('warn');
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes('no-symbol-nodes'))).toBe(true);
      const assessable = result.checks.find((c) => c.id === 'graph-assessable');
      expect(assessable?.evidence['cannotAssessReason']).toBe('no-symbol-nodes');
    });

    it('与既有 cannot-assess 成因（schema-too-old）严重度一致——新 reason 未被降级或漏判', () => {
      linkDist(projectRoot);
      const emptyRoot = projectRoot;
      const sha = initGitRepoWithCommit(emptyRoot);
      const emptyGraph = baseGraph({ sourceCommit: sha });
      emptyGraph.nodes = [];
      emptyGraph.links = [];
      writeGraph(emptyRoot, emptyGraph);
      const emptyResult = validateGraphQuality({ projectRoot: emptyRoot }) as CheckResult;

      // 同一临时仓库改写成 schema-too-old，对照严重度
      writeGraph(emptyRoot, baseGraph({ schemaVersion: '1.0', sourceCommit: sha }));
      const oldSchemaResult = validateGraphQuality({ projectRoot: emptyRoot }) as CheckResult;

      expect(emptyResult.status).toBe(oldSchemaResult.status);
      expect(emptyResult.errors).toEqual(oldSchemaResult.errors);
      expect(
        emptyResult.checks.find((c) => c.id === 'graph-assessable')?.status,
      ).toBe(oldSchemaResult.checks.find((c) => c.id === 'graph-assessable')?.status);
    });
  });

  it('强不变量违反（重复 canonical ID）→ error（阻断），真实覆盖 dist CLI exit 1 分支', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    const graph = baseGraph({ sourceCommit: sha });
    graph.nodes.push(
      { id: 'src/a.ts::Foo', kind: 'component', label: 'Foo', metadata: {} },
      { id: 'src/a.ts#Foo', kind: 'component', label: 'Foo', metadata: {} },
    );
    writeGraph(projectRoot, graph);

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.status).toBe('fail');
  });

  it('非强不变量问题（contains 覆盖率不足）→ warning（不阻断）', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    const graph = baseGraph({ sourceCommit: sha });
    graph.nodes.push({
      id: 'src/a.ts::Foo',
      kind: 'component',
      label: 'Foo',
      metadata: { unifiedKind: 'symbol', sourcePath: 'src/a.ts' },
    });
    writeGraph(projectRoot, graph);

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.status).not.toBe('fail');
  });

  it('dirty 态不产生 warning（FR-026，工作树未提交改动不应阻断日常提交流程）', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    writeFileSync(join(projectRoot, 'app.ts'), 'export const x = 1;\n');
    writeGraph(projectRoot, baseGraph({ sourceCommit: sha }));

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('commit 级 stale → warning', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    writeGraph(projectRoot, baseGraph({ sourceCommit: 'f'.repeat(40) }));
    void sha;

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ============================================================
  // F249 T026/T030 — SC-009：repo:check 消费面的 reason-aware 文案 + evidence 透传
  //
  // C-05 的直接落地：**文案与 evidence 两处都断言**。只改人读文案会让按结构化字段消费的
  // 下游（CI 聚合 / 状态面板）继续拿不到原因，反之只填 evidence 则人读输出仍在撒谎。
  // ============================================================

  describe('SC-009：五类 stale 样本的 warning 文案与 evidence', () => {
    /** 取 freshness 子检查条目（唯一 id 为 'freshness' 的 check）。 */
    function freshnessCheck(result: CheckResult): CheckEntry {
      const entry = result.checks.find((c) => c.id === 'freshness');
      expect(entry).toBeDefined();
      return entry!;
    }

    for (const scenario of SC009_STALE_SCENARIOS) {
      it(`${scenario.id}（${scenario.label}）→ warn，文案与 evidence.staleReasons 均准确`, () => {
        linkDist(projectRoot);
        const sha = initGitRepoWithCommit(projectRoot);
        writeGraph(projectRoot, scenario.buildGraph(sha));

        const result = validateGraphQuality({ projectRoot }) as CheckResult;

        // FR-012：指纹型 stale 与 commit 型 stale 同为 warn，不静默放行、也不升级为 error
        expect(result.errors).toEqual([]);
        const check = freshnessCheck(result);
        expect(check.status).toBe('warn');
        expect(check.evidence['state']).toBe('stale');
        // evidence 透传（C-05 前半）
        expect(check.evidence['staleReasons']).toEqual(scenario.expectedStaleReasons);

        // 文案透传（C-05 后半）：命中的原因字面量必须出现，未命中的必须不出现
        const warningText = result.warnings.join('\n');
        for (const reason of scenario.expectedStaleReasons) {
          expect(warningText).toContain(reason);
        }
        for (const reason of ALL_STALE_REASONS) {
          if (scenario.expectedStaleReasons.includes(reason)) continue;
          // `collector-fingerprint` 是另两个原因名的前缀，用 `原因：` 冒号形态精确判定
          expect(warningText).not.toContain(`${reason}：`);
        }
      });
    }

    it('fresh 态：evidence.staleReasons 为空数组，且零 warning', () => {
      linkDist(projectRoot);
      const sha = initGitRepoWithCommit(projectRoot);
      writeGraph(projectRoot, baseGraph({ sourceCommit: sha }));

      const result = validateGraphQuality({ projectRoot }) as CheckResult;

      expect(result.warnings).toEqual([]);
      const check = freshnessCheck(result);
      expect(check.status).toBe('pass');
      expect(check.evidence['staleReasons']).toEqual([]);
    });

    it('dirty 态（FR-026 噪音哲学不变）：仍零 warning，evidence.staleReasons 为空数组', () => {
      linkDist(projectRoot);
      const sha = initGitRepoWithCommit(projectRoot);
      writeFileSync(join(projectRoot, 'app.ts'), 'export const x = 1;\n');
      writeGraph(projectRoot, baseGraph({ sourceCommit: sha }));

      const result = validateGraphQuality({ projectRoot }) as CheckResult;

      expect(result.warnings).toEqual([]);
      const check = freshnessCheck(result);
      expect(check.evidence['state']).toBe('dirty');
      expect(check.evidence['staleReasons']).toEqual([]);
    });
  });
});

describe('repo-maintenance-core.mjs 接入 graph-quality（F217 T039）', () => {
  it('validateRepository 聚合结果中已注册 graph-quality 子检查族', async () => {
    const { validateRepository } = await import('../../scripts/lib/repo-maintenance-core.mjs');
    const result = (await validateRepository(REPO_ROOT)) as CheckResult;

    expect(result.checks.some((c) => c.id.startsWith('graph-quality:'))).toBe(true);
  });

  it('npm run repo:check 在本仓库真实跑一次不因 graph-quality 报 error', () => {
    expect(existsSync(join(REPO_ROOT, 'specs', '_meta', 'graph.json'))).toBe(true);
    let stdout: string;
    try {
      stdout = execFileSync('node', ['scripts/repo-check.mjs', '--json'], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      });
    } catch (err: unknown) {
      const error = err as { stdout?: string };
      stdout = error.stdout ?? '';
    }
    const parsed = JSON.parse(stdout) as CheckResult;
    const graphQualityChecks = parsed.checks.filter((c) => c.id.startsWith('graph-quality:'));
    expect(graphQualityChecks.length).toBeGreaterThan(0);
    expect(graphQualityChecks.some((c) => c.status === 'fail')).toBe(false);
  });
});

/**
 * F258（D4）— `ignore-undeterminable` warn check：三态 oracle 诊断出口的 repo:check 侧消费者。
 *
 * 本 describe 同时承担"跨侧 token 双向钉住"的职责：`nextSteps` 是一条**文本契约**
 * （schema 顶层 additionalProperties:false 挡住了结构化字段），生产者在 TS 侧、消费者在
 * .mjs 侧，两份手写副本一旦漂移就静默断链，只能靠这条断言抓。
 */
describe('F258：ignore-undeterminable warn check', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'f258-graph-quality-core-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('生产者（TS）与消费者（.mjs）的机读 token 逐字相等', async () => {
    const { IGNORE_UNDETERMINABLE_TOKEN: producerToken } = await import(
      '../../src/cli/commands/graph-quality.js'
    );
    const { IGNORE_UNDETERMINABLE_TOKEN: consumerToken } = await import(
      // @ts-expect-error — .mjs 无类型声明，运行时可解析
      '../../scripts/lib/graph-quality-core.mjs'
    );

    expect(consumerToken).toBe(producerToken);
    expect(producerToken).toBe('[ignore-undeterminable]');
  });

  /**
   * 审查修复轮 M-1 / M-2：出声判据与文案的三形态直测。
   *
   * 为什么直测纯函数而不是全走 E2E：`budgetExhausted` 那条出口要真把 L2 预算跑穿才能构造，
   * E2E 成本与不确定性都太高，于是它长期没有任何断言按住——正是审查抓到"budget-only 完全静默"
   * 的原因。判据与文案是纯函数，直接对它们下断言才能让这条出口被变异杀掉。
   */
  describe('M-1/M-2: shouldVoiceUndeterminable × describeUndeterminable 的三形态', () => {
    const quiet = { count: 0, samples: [], budgetExhausted: false, degraded: false };

    it('三位皆空 ⇒ 不出声（不制造常态噪声）', async () => {
      const { shouldVoiceUndeterminable } = await import('../../src/cli/commands/graph-quality.js');
      expect(shouldVoiceUndeterminable(quiet)).toBe(false);
    });

    it('count-only ⇒ 出声，且文案给出计数与样本', async () => {
      const { shouldVoiceUndeterminable, describeUndeterminable } = await import(
        '../../src/cli/commands/graph-quality.js'
      );
      const summary = { ...quiet, count: 2, samples: ['a/ghost.ts', 'b/ghost.ts'] };

      expect(shouldVoiceUndeterminable(summary)).toBe(true);
      const text = describeUndeterminable(summary);
      expect(text).toContain('2 个节点路径');
      expect(text).toContain('a/ghost.ts');
      expect(text).not.toContain('[oracle-degraded]');
    });

    it('budget-only（count===0 且 budgetExhausted）⇒ 仍出声，文案指名 l2-budget-exhausted', async () => {
      const { shouldVoiceUndeterminable, describeUndeterminable } = await import(
        '../../src/cli/commands/graph-quality.js'
      );
      const summary = { ...quiet, budgetExhausted: true };

      // 修复前判据是 `count > 0` ⇒ 这条具名出口完全静默
      expect(shouldVoiceUndeterminable(summary)).toBe(true);
      expect(describeUndeterminable(summary)).toContain('[l2-budget-exhausted]');
    });

    it('degraded ⇒ 出声，且文案必须否定"0 个不可判 = 没问题"这条读法', async () => {
      const { shouldVoiceUndeterminable, describeUndeterminable } = await import(
        '../../src/cli/commands/graph-quality.js'
      );
      const summary = { ...quiet, degraded: true };

      expect(shouldVoiceUndeterminable(summary)).toBe(true);
      const text = describeUndeterminable(summary);
      expect(text).toContain('[oracle-degraded]');
      expect(text).toContain('降级');
      expect(text).toContain('不构成');
    });

    it('degraded 优先于另外两条文案（该态下 count / budgetExhausted 结构性恒空，沿用会说反）', async () => {
      const { describeUndeterminable } = await import('../../src/cli/commands/graph-quality.js');

      expect(describeUndeterminable({ ...quiet, degraded: true, budgetExhausted: true, count: 3 })).toContain(
        '[oracle-degraded]',
      );
    });
  });

  it('M-1: 降级子 token 同样跨侧逐字相等（evidence.degraded 的判据不得挂在中文措辞上）', async () => {
    const { IGNORE_ORACLE_DEGRADED_TOKEN: producerToken } = await import(
      '../../src/cli/commands/graph-quality.js'
    );
    const { IGNORE_ORACLE_DEGRADED_TOKEN: consumerToken } = await import(
      // @ts-expect-error — .mjs 无类型声明，运行时可解析
      '../../scripts/lib/graph-quality-core.mjs'
    );

    expect(consumerToken).toBe(producerToken);
    expect(producerToken).toBe('[oracle-degraded]');
  });

  it('存在不可判节点 ⇒ 出现 ignore-undeterminable warn check（且 detail 透传文案）', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    // 仓内 symlink 指向被忽略目录；其下**离盘**路径 ⇒ git check-ignore exit 128 ⇒ undeterminable
    writeFileSync(join(projectRoot, '.gitignore'), 'ignored_dir/\n');
    mkdirSync(join(projectRoot, 'ignored_dir'), { recursive: true });
    symlinkSync(join(projectRoot, 'ignored_dir'), join(projectRoot, 'link_to_ign'), 'dir');

    const graph = baseGraph({ sourceCommit: sha });
    graph.nodes.push({
      id: 'link_to_ign/ghost.ts::Sym',
      kind: 'component',
      label: 'Sym',
      metadata: {},
    });
    writeGraph(projectRoot, graph);

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    const check = result.checks.find((c) => c.id === 'ignore-undeterminable');
    expect(check).toBeDefined();
    expect(check!.status).toBe('warn');
    expect(String(check!.evidence['detail'])).toContain('[ignore-undeterminable]');
    expect(result.warnings.some((w) => w.startsWith('[ignore-undeterminable]'))).toBe(true);
    // 保守方向：判不了不得升级为 error，也不得把门判红
    expect(result.errors).toEqual([]);
  });

  /**
   * 审查修复轮 M-1：**打坏 git 不得让这道门变绿**。
   *
   * 修复前：`git ls-files` 失败 ⇒ oracle 整体降级为二态 ⇒ 结构性永不产出 undeterminable ⇒
   * drain 恒 `{count:0}` ⇒ CLI 的 `count > 0` 判据不成立 ⇒ `nextSteps` 无 token ⇒
   * 本 check 报 **pass**，标题还写着"无不可判路径（三态 oracle）"——而三态 oracle 根本没在跑。
   * 这是一条可被主动触发的 fail-open 面（审查实证：shim 只让 `git ls-files` 失败即 warn→pass）。
   */
  it('M-1: 忽略清单预取失败（三态 oracle 整体降级）⇒ 仍报 warn，且 evidence 标出降级', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    writeGraph(projectRoot, baseGraph({ sourceCommit: sha }));
    // 真实失败路径（不 mock 子进程）：损坏 index ⇒ `git ls-files` exit 128，
    // 而 `git rev-parse HEAD` 仍正常 ⇒ 精确复刻"只有忽略清单预取塌了"的形态
    writeFileSync(join(projectRoot, '.git', 'index'), 'garbage');

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    const check = result.checks.find((c) => c.id === 'ignore-undeterminable');
    expect(check).toBeDefined();
    expect(check!.status).toBe('warn');
    expect(check!.evidence['degraded']).toBe(true);
    expect(String(check!.evidence['detail'])).toContain('降级');
    // 保守方向不变：降级只出声，不把门判红
    expect(result.errors).toEqual([]);
  });

  it('无不可判节点 ⇒ check 为 pass 且零 warning（不制造噪声）', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    writeGraph(projectRoot, baseGraph({ sourceCommit: sha }));

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    const check = result.checks.find((c) => c.id === 'ignore-undeterminable');
    expect(check).toBeDefined();
    expect(check!.status).toBe('pass');
    expect(check!.evidence['degraded']).toBe(false);
    expect(result.warnings.some((w) => w.startsWith('[ignore-undeterminable]'))).toBe(false);
  });

  it('早退分支不误报：cannot-assess / dist 未构建 两条路径都不产出该 check', () => {
    // ① cannot-assess（schemaVersion 过旧）
    linkDist(projectRoot);
    writeGraph(projectRoot, baseGraph({ schemaVersion: '1.0' }));
    const cannotAssess = validateGraphQuality({ projectRoot }) as CheckResult;
    expect(cannotAssess.checks.some((c) => c.id === 'ignore-undeterminable')).toBe(false);

    // ② dist 未构建
    const bare = mkdtempSync(join(tmpdir(), 'f258-graph-quality-core-bare-'));
    try {
      const sha = initGitRepoWithCommit(bare);
      writeGraph(bare, baseGraph({ sourceCommit: sha }));
      const distMissing = validateGraphQuality({ projectRoot: bare }) as CheckResult;
      expect(distMissing.checks.some((c) => c.id === 'ignore-undeterminable')).toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

/**
 * F266 第三轮对抗审查 E3 —— cannot-assess 在消费侧的**分档**放行。
 *
 * 缺陷本体：`graph-quality-core.mjs` 对 `cannot-assess` 一律早退。这在 D1 之前是对的
 * （那时报告的六指标全是 pass 占位，读它就是伪造绿 check），但 D1 让 `no-symbol-nodes`
 * 走后置降级、报告体携带**真实指标**之后，同一条早退就把 legacy-ignored 真发现、
 * freshness stale、F258 的 `[ignore-undeterminable]` 诊断一并吞掉——门禁一句都不说。
 *
 * 判据是结构标记 `metricsPopulated`（存在性判定，非 reason 值枚举，F259 教训）。
 */
describe('F266-E3：cannot-assess 报告按 metricsPopulated 分档消费', () => {
  let projectRoot: string;

  beforeAll(() => {
    assertDistBuilt();
  });

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'f266-e3-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /**
   * 无 symbol 节点 + legacy `#` 节点（warning 级真发现）+ sourceCommit 与 HEAD 不一致（stale）。
   * `#` 节点走 `sourceTag: 'extraction'` + `.py` 的 legacy 判据，**不带** `unifiedKind: 'symbol'`
   * ——否则它自己就会让 `hasNoSymbolNodes` 为假，测的就不再是本场景。
   */
  function writeNoSymbolGraphWithFindings(root: string): void {
    const graph = baseGraph({ sourceCommit: 'f'.repeat(40) });
    graph.nodes = graph.nodes.filter((n) => n.metadata?.['unifiedKind'] !== 'symbol');
    graph.nodes.push({
      id: 'src/legacy.py#LegacyThing',
      kind: 'component',
      label: 'LegacyThing',
      metadata: { sourceTag: 'extraction', sourcePath: 'src/legacy.py' },
    });
    graph.links = [];
    writeGraph(root, graph);
  }

  it('metricsPopulated（no-symbol-nodes）→ 逐维度 check 全部恢复可达：legacy-ignored + freshness + graph-assessable 三条 warn', () => {
    linkDist(projectRoot);
    initGitRepoWithCommit(projectRoot);
    writeNoSymbolGraphWithFindings(projectRoot);

    const result = validateGraphQuality({ projectRoot }) as CheckResult;

    const assessable = result.checks.find((c) => c.id === 'graph-assessable');
    expect(assessable?.status).toBe('warn');
    expect(assessable?.evidence['cannotAssessReason']).toBe('no-symbol-nodes');
    expect(assessable?.evidence['metricsPopulated']).toBe(true);

    // 承重①：warning 级真发现不再被 cannot-assess 吞掉
    const legacy = result.checks.find((c) => c.id === 'legacy-ignored-nodes');
    expect(legacy).toBeDefined();
    expect(legacy!.status).toBe('warn');
    expect(legacy!.evidence['legacyCount']).toBe(1);
    expect(result.warnings.some((w) => w.includes('遗留'))).toBe(true);

    // 承重②：freshness stale 恢复可见（图恒定格在旧 commit 正是最需要说出口的时刻）
    const freshness = result.checks.find((c) => c.id === 'freshness');
    expect(freshness).toBeDefined();
    expect(freshness!.status).toBe('warn');
    expect(freshness!.evidence['state']).toBe('stale');

    // 承重③：F258 的三态 oracle 诊断探测点恢复可达
    expect(result.checks.some((c) => c.id === 'ignore-undeterminable')).toBe(true);

    // 方向不变：只出声、不阻断（强不变量未违反 ⇒ 绝不翻 fail）
    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
  });

  it('文案按成因分档：no-symbol-nodes 不再被归因成"graph.json 损坏或过旧"，改透传报告自己的处方', () => {
    linkDist(projectRoot);
    initGitRepoWithCommit(projectRoot);
    writeNoSymbolGraphWithFindings(projectRoot);

    const result = validateGraphQuality({ projectRoot }) as CheckResult;
    const assessWarning = result.warnings.find((w) => w.includes('no-symbol-nodes'));

    expect(assessWarning).toBeDefined();
    // 错误归因必须消失：这张图既没损坏也不是"过旧"，它是缺 symbol 层
    expect(assessWarning).not.toContain('请检查 graph.json 是否损坏或过旧后重建');
    // 处方来自报告自身的 nextSteps 首条（noSymbolNodesNextStep）
    expect(assessWarning).toContain('symbol');
  });

  it('回归对照：占位报告（empty-graph / schema-too-old）逐字维持早退——不发射任何逐维度 check', () => {
    linkDist(projectRoot);
    const sha = initGitRepoWithCommit(projectRoot);
    const emptyGraph = baseGraph({ sourceCommit: sha });
    emptyGraph.nodes = [];
    emptyGraph.links = [];
    writeGraph(projectRoot, emptyGraph);

    const empty = validateGraphQuality({ projectRoot }) as CheckResult;
    const emptyAssessable = empty.checks.find((c) => c.id === 'graph-assessable');
    expect(emptyAssessable?.evidence['metricsPopulated']).toBe(false);
    // 占位六指标无信息量，继续读只会发出编造的 pass —— 早退语义必须原样保留
    for (const id of ['legacy-ignored-nodes', 'freshness', 'contains-coverage', 'orphan-ratio', 'duplicate-canonical-id', 'dangling-edge', 'ignore-undeterminable']) {
      expect(empty.checks.some((c) => c.id === id)).toBe(false);
    }
    expect(empty.warnings.some((w) => w.includes('请检查 graph.json 是否损坏或过旧后重建'))).toBe(true);
    expect(empty.status).toBe('warn');
    expect(empty.errors).toEqual([]);

    // schema-too-old 同档（真正"过旧"的那条路，旧文案在这里才是对的）
    const staleSchemaRoot = mkdtempSync(join(tmpdir(), 'f266-e3-schema-'));
    try {
      linkDist(staleSchemaRoot);
      writeGraph(staleSchemaRoot, baseGraph({ schemaVersion: '1.0' }));
      const old = validateGraphQuality({ projectRoot: staleSchemaRoot }) as CheckResult;
      expect(old.checks.find((c) => c.id === 'graph-assessable')?.evidence['metricsPopulated']).toBe(false);
      expect(old.checks.some((c) => c.id === 'freshness')).toBe(false);
      expect(old.warnings.some((w) => w.includes('请检查 graph.json 是否损坏或过旧后重建'))).toBe(true);
    } finally {
      rmSync(staleSchemaRoot, { recursive: true, force: true });
    }
  });
});
