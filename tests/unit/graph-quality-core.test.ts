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
