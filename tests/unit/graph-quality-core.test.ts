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

function baseGraph(overrides: Partial<GraphJSON['graph']> = {}): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 0,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
      ...overrides,
    },
    nodes: [],
    links: [],
  };
}

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
    // dist 需含本次新增的 graph-quality 命令（先红：实现前该子命令不存在）。
    execFileSync('npm', ['run', 'build'], { encoding: 'utf-8', timeout: 120_000 });
  }, 120_000);

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
