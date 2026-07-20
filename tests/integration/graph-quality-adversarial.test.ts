/**
 * F217 T048 — 对抗注入 fixture 测试（US3）。
 *
 * 覆盖 SC-003~SC-009（原 7 个手工构造的最小 GraphJSON，逐项验证 100% 检出率 +
 * 精确定位信息）+ 豁免分类专项（新增 3 个，验证 orphanRatio.exemptedByCategory
 * 归类精度）+ SC-011（10 个 fixture 中触发 fail 的每一类指标 next-step 建议均非空）。
 *
 * 全部通过 spawn `node dist/cli/index.js graph-quality --json` 子进程验证，
 * 与 tests/fixtures/graph-quality-adversarial/*.json 手写字面量 fixture 配套
 * （不是真实建图产出，仅含触发对应指标 fail 所需的最小节点/边集合）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { GraphQualityReport } from '../../src/panoramic/graph/quality/quality-types.js';

const CLI_PATH = path.resolve('dist/cli/index.js');
const FIXTURE_DIR = path.resolve('tests/fixtures/graph-quality-adversarial');

interface CLIResult {
  stdout: string;
  exitCode: number;
}

function runCLI(args: string[], opts: { cwd?: string } = {}): CLIResult {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: opts.cwd,
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; status?: number };
    return { stdout: error.stdout ?? '', exitCode: error.status ?? 1 };
  }
}

function runGraphQualityJson(
  fixtureName: string,
  opts: { cwd?: string } = {},
): { result: CLIResult; report: GraphQualityReport } {
  const graphPath = path.join(FIXTURE_DIR, fixtureName);
  const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], opts);
  return { result, report: JSON.parse(result.stdout) as GraphQualityReport };
}

function gitConfig(dir: string): void {
  execFileSync('git', ['config', 'user.email', 'f217-adversarial-test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'F217 Adversarial Test' ], { cwd: dir });
}

describe('对抗注入 fixture 测试（F217 T048）', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      execFileSync('npm', ['run', 'build'], { encoding: 'utf-8', timeout: 120_000 });
    }
  }, 120_000);

  describe('SC-003 duplicate-canonical-id.json：语义重复 canonical ID 100% 检出', () => {
    it('检出重复三元组并精确定位 ids', () => {
      const { result, report } = runGraphQualityJson('duplicate-canonical-id.json');
      expect(result.exitCode).toBe(1);
      expect(report.overallVerdict).toBe('fail-strong-invariant');
      expect(report.duplicateCanonicalId.status).toBe('fail');
      expect(report.duplicateCanonicalId.groups).toEqual([
        {
          filePath: 'src/a.ts',
          symbolName: 'Foo',
          kind: 'component',
          ids: ['src/a.ts#Foo', 'src/a.ts::Foo'],
        },
      ]);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe('SC-004 dangling-edge.json：悬空边 100% 检出 + source/target/relation 三元组精确匹配', () => {
    it('检出悬空边并精确定位三元组', () => {
      const { result, report } = runGraphQualityJson('dangling-edge.json');
      expect(result.exitCode).toBe(1);
      expect(report.overallVerdict).toBe('fail-strong-invariant');
      expect(report.danglingEdges.status).toBe('fail');
      expect(report.danglingEdges.edges).toEqual([
        { source: 'src/a.ts::Foo', target: 'src/missing.ts::Bar', relation: 'calls' },
      ]);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe('SC-005 ignored-path-node.json：ignored 路径节点 100% 检出', () => {
    it('检出 node_modules/ 下的节点为 ignored-path', () => {
      const { result, report } = runGraphQualityJson('ignored-path-node.json');
      expect(result.exitCode).toBe(0);
      expect(report.overallVerdict).toBe('pass-with-warnings');
      expect(report.legacyAndIgnoredNodes.status).toBe('fail');
      expect(report.legacyAndIgnoredNodes.ignoredPathNodeIds).toEqual([
        'node_modules/pkg/index.js::foo',
      ]);
      expect(report.legacyAndIgnoredNodes.legacyHashNodeIds).toEqual([]);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe('SC-006 legacy-hash-node.json：遗留 `#` 节点 100% 检出', () => {
    it('检出遗留 # 分隔符 symbol 节点', () => {
      const { result, report } = runGraphQualityJson('legacy-hash-node.json');
      expect(result.exitCode).toBe(0);
      expect(report.overallVerdict).toBe('pass-with-warnings');
      expect(report.legacyAndIgnoredNodes.status).toBe('fail');
      expect(report.legacyAndIgnoredNodes.legacyHashNodeIds).toEqual(['src/a.py#foo']);
      expect(report.legacyAndIgnoredNodes.ignoredPathNodeIds).toEqual([]);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });

    it('FIX-9b（Codex 对抗审查）单指标隔离：legacy 节点有 contains 边（非 zero-degree）只触发 legacy-ignored，不触发 orphan-ratio', () => {
      const { report } = runGraphQualityJson('legacy-hash-node.json');
      // 修复前该 fixture 是零边孤立节点，会同时触发 orphan-ratio fail，
      // 掩盖了"单个 fixture 对应单一指标"的对抗测试设计意图。
      expect(report.orphanRatio.status).toBe('pass');
      expect(report.containsCoverage.status).toBe('pass');
      expect(
        report.nextSteps.some((step) =>
          step.includes('遗留') && step.includes('#') && step.includes('canonical') && step.includes('::'),
        ),
      ).toBe(true);
    });
  });

  describe('SC-007 stale-commit.json：freshness stale 判定 + 双值展示（隔离临时仓库）', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-quality-adversarial-stale-'));
      execFileSync('git', ['init', '-q'], { cwd: tmpDir });
      gitConfig(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# f217 stale fixture\n');
      execFileSync('git', ['add', '.'], { cwd: tmpDir });
      execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: tmpDir });
    });

    it('stale 判定成立（fixture 记录的全 f SHA 与临时仓库真实 HEAD 不一致）', () => {
      const { result, report } = runGraphQualityJson('stale-commit.json', { cwd: tmpDir });
      expect(result.exitCode).toBe(0);
      expect(report.overallVerdict).toBe('pass-with-warnings');
      expect(report.freshness.state).toBe('stale');
      expect(report.freshness.recordedSourceCommit).toBe(
        'ffffffffffffffffffffffffffffffffffffffff',
      );
      expect(report.freshness.currentHead).not.toBeNull();
      expect(report.freshness.currentHead).not.toBe(report.freshness.recordedSourceCommit);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });

    it('人读文本摘要同时展示 recordedSourceCommit 与 currentHead 两个值', () => {
      const graphPath = path.join(FIXTURE_DIR, 'stale-commit.json');
      const textResult = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir });
      const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();

      expect(textResult.stdout).toContain('ffffffffffffffffffffffffffffffffffffffff');
      expect(textResult.stdout).toContain(currentHead);
      expect(textResult.stdout).toContain('stale');
    });
  });

  describe('SC-008 coverage-gap.json：contains 覆盖率不足 100% 检出', () => {
    it('检出未被 contains 边覆盖的 symbol 节点', () => {
      const { result, report } = runGraphQualityJson('coverage-gap.json');
      expect(result.exitCode).toBe(0);
      expect(report.overallVerdict).toBe('pass-with-warnings');
      expect(report.containsCoverage.status).toBe('fail');
      expect(report.containsCoverage.total).toBe(2);
      expect(report.containsCoverage.covered).toBe(0);
      expect(report.containsCoverage.uncoveredIds).toEqual(['src/a.ts::Bar', 'src/a.ts::Foo']);
      // 用 calls 边驱动 degree>=1，验证本 fixture 与 orphan-ratio 解耦（未触发 orphan fail）
      expect(report.orphanRatio.status).toBe('pass');
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe('SC-009 orphan-excess.json：orphan 超标比例 100% 检出', () => {
    it('检出超过 5% 阈值的 zero-degree symbol 节点', () => {
      const { result, report } = runGraphQualityJson('orphan-excess.json');
      expect(result.exitCode).toBe(0);
      expect(report.overallVerdict).toBe('pass-with-warnings');
      expect(report.orphanRatio.status).toBe('fail');
      expect(report.orphanRatio.totalSymbolNodes).toBe(3);
      expect(report.orphanRatio.offendingIds).toEqual(['src/svc.ts::Orphaned']);
      expect(report.orphanRatio.offendingRatio).toBeCloseTo(1 / 3, 10);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe('豁免分类专项：exemptedByCategory 精确归位', () => {
    it('pure-type-orphan.json：exportKind=interface 的 zero-degree 节点归类为 pure-type', () => {
      const { report } = runGraphQualityJson('pure-type-orphan.json');
      expect(report.orphanRatio.status).toBe('fail');
      expect(report.orphanRatio.exemptedByCategory).toEqual({
        entrypoint: 0,
        'pure-type': 1,
        'test-export': 0,
      });
      // 豁免节点不计入 offendingIds，只有未豁免的普通 orphan 计入
      expect(report.orphanRatio.offendingIds).toEqual(['src/util.ts::helper']);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });

    it('test-export-orphan.json：符合测试文件模式的 zero-degree 节点归类为 test-export', () => {
      const { report } = runGraphQualityJson('test-export-orphan.json');
      expect(report.orphanRatio.status).toBe('fail');
      expect(report.orphanRatio.exemptedByCategory).toEqual({
        entrypoint: 0,
        'pure-type': 0,
        'test-export': 1,
      });
      expect(report.orphanRatio.offendingIds).toEqual(['src/util.ts::helper']);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });

    it('entrypoint-orphan.json：index.ts 等入口文件的 zero-degree 节点归类为 entrypoint', () => {
      const { report } = runGraphQualityJson('entrypoint-orphan.json');
      expect(report.orphanRatio.status).toBe('fail');
      expect(report.orphanRatio.exemptedByCategory).toEqual({
        entrypoint: 1,
        'pure-type': 0,
        'test-export': 0,
      });
      expect(report.orphanRatio.offendingIds).toEqual(['src/util.ts::helper']);
      expect(report.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe('SC-011：10 个 fixture 中触发 fail 的每一类指标各自 next-step 均非空', () => {
    const fixturesWithFailCategory: Array<{
      file: string;
      category:
        | 'duplicateCanonicalId'
        | 'danglingEdges'
        | 'legacyAndIgnoredNodes'
        | 'containsCoverage'
        | 'orphanRatio';
    }> = [
      { file: 'duplicate-canonical-id.json', category: 'duplicateCanonicalId' },
      { file: 'dangling-edge.json', category: 'danglingEdges' },
      { file: 'ignored-path-node.json', category: 'legacyAndIgnoredNodes' },
      { file: 'legacy-hash-node.json', category: 'legacyAndIgnoredNodes' },
      { file: 'coverage-gap.json', category: 'containsCoverage' },
      { file: 'orphan-excess.json', category: 'orphanRatio' },
    ];

    it.each(fixturesWithFailCategory)(
      '$file 触发的 $category fail 对应 nextSteps 非空',
      ({ file, category }) => {
        const { report } = runGraphQualityJson(file);
        expect(report[category].status).toBe('fail');
        expect(report.nextSteps.length).toBeGreaterThan(0);
      },
    );

    it('stale-commit.json 触发的 freshness fail（隔离临时仓库）对应 nextSteps 非空', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-quality-adversarial-stale-nextsteps-'));
      try {
        execFileSync('git', ['init', '-q'], { cwd: tmpDir });
        gitConfig(tmpDir);
        fs.writeFileSync(path.join(tmpDir, 'README.md'), '# f217 stale fixture\n');
        execFileSync('git', ['add', '.'], { cwd: tmpDir });
        execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: tmpDir });

        const { report } = runGraphQualityJson('stale-commit.json', { cwd: tmpDir });
        expect(report.freshness.state).toBe('stale');
        expect(report.nextSteps.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
