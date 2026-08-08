/**
 * F217 T033 — graph-quality CLI 端到端测试。
 *
 * 覆盖：
 * ① exit code 矩阵：0（全 pass）/ 0（pass-with-warnings）/ 1（强不变量违反）/
 *    2（graph 缺失 · JSON 损坏 · schemaVersion 过旧）
 * ② --json / --status / text 三种输出格式的字段完整性
 * ③ dirty 态验证（临时 git 仓库 + 未提交改动）
 * ④ SC-010 独立复验：真实临时 git 仓库跑一次 `batch --mode graph-only` 建图后，
 *    再提交一次（HEAD 前进，图未重建），断言 graph-quality 报告 stale
 *
 * 全部通过 spawn `node dist/cli/index.js` 子进程验证，端到端覆盖 CLI 契约本身。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolve } from 'node:path';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import {
  ALL_STALE_REASONS,
  SC009_STALE_SCENARIOS,
  baseFreshnessGraph,
} from '../helpers/freshness-stale-scenarios.js';
import { assertDistBuilt } from '../helpers/dist-cli-guard.js';
import { validateAgainstSchema } from '../helpers/json-schema-subset-validator.js';

const CLI_PATH = resolve('dist/cli/index.js');
/** F261 T-R5d：`--json` 契约不回归的判据来源（与 T029 契约测试同一份 schema）。 */
const REPORT_SCHEMA_PATH = resolve(
  'specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json',
);

interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCLI(args: string[], opts: { cwd?: string } = {}): CLIResult {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: opts.cwd,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: error.status ?? 1 };
  }
}

/**
 * FIX-8：与 runCLI 不同，本 helper 无论 exit code 是否为 0 都保留 stdout/stderr 分离，
 * 供 --output 场景断言"写入通知在 stderr、stdout 只含结构化输出"。
 */
function runCLIFull(args: string[], opts: { cwd?: string } = {}): CLIResult {
  const res = spawnSync('node', [CLI_PATH, ...args], {
    encoding: 'utf-8',
    timeout: 30_000,
    cwd: opts.cwd,
  });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', exitCode: res.status ?? 1 };
}

function gitConfig(dir: string): void {
  execFileSync('git', ['config', 'user.email', 'f217-test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'F217 Test'], { cwd: dir });
}

/** 初始化临时 git 仓库并提交一次，返回初始 HEAD SHA。 */
function initGitRepoWithCommit(dir: string): string {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  gitConfig(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# f217 fixture\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
}

function writeGraph(graphPath: string, graph: GraphJSON): void {
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
}

/**
 * F249：委托共享 helper —— 默认写入**当前合法指纹**。
 *
 * 不带指纹时每个既有用例都会因 FR-010 归入 `collector-fingerprint-unrecorded` 而判 stale
 * ——那不是回归，而是本机制的核心语义（"证明不了一致就不放行"）。需要 unrecorded / invalid /
 * mismatch 场景的用例显式覆盖该字段（或直接用 `SC009_STALE_SCENARIOS`）。
 *
 * 跨进程可比性依据：`computeCollectorFingerprint()` 的产出确定性（FR-017/SC-014）保证本进程
 * 算出的指纹与被 spawn 的 dist CLI 子进程算出的完全一致。
 */
const baseGraph = baseFreshnessGraph;

describe('graph-quality CLI（F217 T033）', () => {
  beforeAll(() => {
    // F251：dist 构建已收拢到 vitest globalSetup（tests/global-setup.ts），
    // 此处只做 fail-fast 存在性断言，不再触发构建（避免与其他文件竞写 dist）。
    assertDistBuilt();
  });

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-quality-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('exit code 矩阵', () => {
    it('六指标 + freshness 全 pass → exit 0, overallVerdict=pass', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('pass');
      expect(report.freshness.state).toBe('fresh');
    });

    it('非强指标 fail（contains 覆盖率不足）→ exit 0, overallVerdict=pass-with-warnings', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      const graph = baseGraph({ sourceCommit: sha });
      graph.nodes.push({
        id: 'src/a.ts::Foo',
        kind: 'component',
        label: 'Foo',
        metadata: { unifiedKind: 'symbol', sourcePath: 'src/a.ts' },
      });
      writeGraph(graphPath, graph);

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('pass-with-warnings');
      expect(report.containsCoverage.status).toBe('fail');
    });

    it('强不变量违反（重复 canonical ID）→ exit 1, overallVerdict=fail-strong-invariant', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      const graph = baseGraph({ sourceCommit: sha });
      graph.nodes.push(
        { id: 'src/a.ts::Foo', kind: 'component', label: 'Foo', metadata: {} },
        { id: 'src/a.ts#Foo', kind: 'component', label: 'Foo', metadata: {} },
      );
      writeGraph(graphPath, graph);

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('fail-strong-invariant');
      expect(report.duplicateCanonicalId.status).toBe('fail');
      expect(report.duplicateCanonicalId.groups.length).toBeGreaterThan(0);
    });

    it('图产物不存在 → exit 2, cannot-assess/graph-missing', () => {
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('cannot-assess');
      expect(report.cannotAssessReason).toBe('graph-missing');
    });

    it('图产物 JSON 解析失败 → exit 2, cannot-assess/json-parse-error', () => {
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(graphPath, '{ this is not valid json', 'utf-8');

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('cannot-assess');
      expect(report.cannotAssessReason).toBe('json-parse-error');
    });

    it('图产物结构损坏（缺 nodes/links）→ exit 2, cannot-assess/json-parse-error', () => {
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(graphPath, JSON.stringify({ foo: 'bar' }), 'utf-8');

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.cannotAssessReason).toBe('json-parse-error');
    });

    it('schemaVersion 过旧（1.0）→ exit 2, cannot-assess/schema-too-old', () => {
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ schemaVersion: '1.0' }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('cannot-assess');
      expect(report.cannotAssessReason).toBe('schema-too-old');
    });

    it('FIX-7 红测试：schemaVersion 高于支持版本（3.0）→ exit 2, cannot-assess/schema-newer-than-supported', () => {
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      // 直接写字面量 JSON（不经 baseGraph 的 GraphJSON 类型收窄，schemaVersion 联合类型不允许 '3.0'）
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(
        graphPath,
        JSON.stringify({
          directed: false,
          multigraph: false,
          graph: {
            name: 'spectra-knowledge-graph',
            generatedAt: '2026-01-01T00:00:00.000Z',
            nodeCount: 0,
            edgeCount: 0,
            sources: ['unified-graph'],
            schemaVersion: '3.0',
          },
          nodes: [],
          links: [],
        }),
        'utf-8',
      );

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('cannot-assess');
      expect(report.cannotAssessReason).toBe('schema-newer-than-supported');
    });

    it('FIX-1 红测试①：顶层缺 directed/multigraph → exit 2, cannot-assess/json-parse-error（当前实现错误地 pass）', () => {
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(
        graphPath,
        JSON.stringify({ graph: { schemaVersion: '2.0' }, nodes: [], links: [] }),
        'utf-8',
      );

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('cannot-assess');
      expect(report.cannotAssessReason).toBe('json-parse-error');
    });

    it('FIX-1 红测试②：edge 缺 source/target → exit 2, cannot-assess/json-parse-error（当前实现错误地变强失败 exit 1）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      const graph = baseGraph({ sourceCommit: sha }) as unknown as Record<string, unknown>;
      (graph['links'] as unknown[]) = [{}];
      fs.mkdirSync(path.dirname(graphPath), { recursive: true });
      fs.writeFileSync(graphPath, JSON.stringify(graph), 'utf-8');

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('cannot-assess');
      expect(report.cannotAssessReason).toBe('json-parse-error');
    });
  });

  describe('三种输出格式', () => {
    it('--json 输出完整六字段（含 CLI 层组装的 freshness）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });
      const report = JSON.parse(result.stdout);

      for (const key of [
        'graphPath',
        'generatedAt',
        'schemaVersion',
        'duplicateCanonicalId',
        'containsCoverage',
        'orphanRatio',
        'danglingEdges',
        'legacyAndIgnoredNodes',
        'freshness',
        'overallVerdict',
        'nextSteps',
      ]) {
        expect(report).toHaveProperty(key);
      }
      expect(report.freshness).toHaveProperty('state');
      expect(report.freshness).toHaveProperty('recordedSourceCommit');
      expect(report.freshness).toHaveProperty('currentHead');
    });

    it('--status 仅输出三字段裁剪（overallVerdict 保留四态，不坍缩为二元）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      const graph = baseGraph({ sourceCommit: sha });
      graph.nodes.push({
        id: 'src/a.ts::Foo',
        kind: 'component',
        label: 'Foo',
        metadata: { unifiedKind: 'symbol', sourcePath: 'src/a.ts' },
      });
      writeGraph(graphPath, graph);

      const result = runCLI(['graph-quality', '--graph', graphPath, '--status', '--json'], { cwd: tmpDir });
      const status = JSON.parse(result.stdout);

      expect(Object.keys(status).sort()).toEqual(['freshness', 'graphExists', 'overallVerdict']);
      expect(status.graphExists).toBe(true);
      expect(status.freshness).toBe('fresh');
      expect(status.overallVerdict).toBe('pass-with-warnings');
    });

    it('默认 text 输出人读摘要逐项列出六指标状态 + next-step 建议', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      const graph = baseGraph({ sourceCommit: sha });
      graph.nodes.push(
        { id: 'src/a.ts::Foo', kind: 'component', label: 'Foo', metadata: {} },
        { id: 'src/a.ts#Foo', kind: 'component', label: 'Foo', metadata: {} },
      );
      writeGraph(graphPath, graph);

      const result = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('duplicate');
      expect(result.stdout).toContain('fail-strong-invariant');
      // next-step 建议非空（SC-011）
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('dirty 态验证（SC-014 前半）', () => {
    it('sourceCommit 与 HEAD 一致但工作树存在未提交源码改动 → dirty 提示，exit 0', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      // 未提交的源码改动
      fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'export const x = 1;\n');
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.freshness.state).toBe('dirty');
      expect(report.freshness.dirtyFiles).toContain('app.ts');

      const textResult = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir });
      expect(textResult.stdout).toContain('dirty');
    });
  });

  describe('--output 报告写入（FIX-8/8b）', () => {
    it('FIX-8：--json --output 时 stdout 只含可解析 JSON，写入通知转到 stderr', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));
      const outputPath = path.join(tmpDir, 'report.json');

      const result = runCLIFull(
        ['graph-quality', '--graph', graphPath, '--json', '--output', outputPath],
        { cwd: tmpDir },
      );

      expect(() => JSON.parse(result.stdout)).not.toThrow();
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('pass');
      expect(result.stdout).not.toContain('报告已写入');
      expect(result.stderr).toContain('报告已写入');
      expect(result.stderr).toContain(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
    });

    it('FIX-8b：--output 写入失败（目标父目录被同名文件占用）→ stderr 警告"报告写入失败"，exit code 仍按 verdict（不受写入失败影响）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      // 用一个已存在的普通文件占位，制造 "mkdirSync 想在此路径下建目录" 的写入失败场景
      const blockedPath = path.join(tmpDir, 'blocked-file');
      fs.writeFileSync(blockedPath, 'not a directory', 'utf-8');
      const badOutputPath = path.join(blockedPath, 'nested', 'report.json');

      const result = runCLIFull(
        ['graph-quality', '--graph', graphPath, '--json', '--output', badOutputPath],
        { cwd: tmpDir },
      );

      expect(result.exitCode).toBe(0); // 评估已完成，verdict=pass，写入失败不改变 exit code
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      expect(result.stderr).toContain('报告写入失败');
    });
  });

  describe('SC-010 独立复验：HEAD 真实前进场景', () => {
    it('batch --mode graph-only 真实建图后再提交一次，图未重建 → stale', () => {
      execFileSync('git', ['init', '-q'], { cwd: tmpDir });
      gitConfig(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export function hello(): number { return 1; }\n');
      execFileSync('git', ['add', '.'], { cwd: tmpDir });
      execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: tmpDir });

      const specsDir = path.join(tmpDir, 'specs');
      const batchResult = runCLI(
        ['batch', tmpDir, '--mode', 'graph-only', '--output-dir', specsDir],
        { cwd: tmpDir },
      );
      expect(batchResult.exitCode).toBe(0);

      const graphPath = path.join(specsDir, '_meta', 'graph.json');
      expect(fs.existsSync(graphPath)).toBe(true);
      const generatedGraph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
      expect(typeof generatedGraph.graph.sourceCommit).toBe('string');

      // HEAD 前进：再提交一次，图产物未重新生成
      fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export function hello(): number { return 2; }\n');
      execFileSync('git', ['add', '.'], { cwd: tmpDir });
      execFileSync('git', ['commit', '-q', '-m', 'second'], { cwd: tmpDir });

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });
      const report = JSON.parse(result.stdout);

      expect(report.freshness.state).toBe('stale');
      expect(report.freshness.recordedSourceCommit).toBe(generatedGraph.graph.sourceCommit);
      expect(report.freshness.currentHead).not.toBe(generatedGraph.graph.sourceCommit);
      // F249：真实建图链路已写入合法指纹，因此唯一 stale 原因是 commit 前进
      // （若此处出现 collector-fingerprint-unrecorded，说明 batch 写入点回归了）
      expect(report.freshness.staleReasons).toEqual(['source-commit']);
    }, 30_000);
  });

  // ============================================================
  // F249 T030 / SC-009：reason-aware 诊断（CLI 文本 + --json 两个消费面）
  // ============================================================

  describe('SC-009：五类 stale 样本在 CLI 文本与 --json 的诊断准确性', () => {
    /** 在临时 git 仓库落一份场景图，返回 graph.json 路径与当前 HEAD。 */
    function seedScenarioGraph(buildGraph: (head: string) => GraphJSON): string {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, buildGraph(sha));
      return graphPath;
    }

    for (const scenario of SC009_STALE_SCENARIOS) {
      it(`--json：${scenario.id}（${scenario.label}）→ stale + staleReasons=[${scenario.expectedStaleReasons.join(', ')}]`, () => {
        const graphPath = seedScenarioGraph(scenario.buildGraph);

        const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

        expect(result.exitCode).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.freshness.state).toBe('stale');
        expect(report.freshness.staleReasons).toEqual(scenario.expectedStaleReasons);
        // FR-011：指纹型 stale 不得静默降级为 pass
        expect(report.overallVerdict).toBe('pass-with-warnings');
      });

      it(`文本输出：${scenario.id} 的 [freshness] 行与 nextSteps 均含准确原因字面量，且不错配为其他原因`, () => {
        const graphPath = seedScenarioGraph(scenario.buildGraph);

        const result = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir });

        expect(result.stdout).toContain('[freshness] stale');
        for (const reason of scenario.expectedStaleReasons) {
          // 摘要行的 staleReasons 展示 + nextSteps 的 [reason] 前缀，两处都必须出现
          expect(result.stdout).toContain(`staleReasons: ${scenario.expectedStaleReasons.join(', ')}`);
          expect(result.stdout).toContain(`[${reason}]`);
        }
        // 错配防线：未命中的原因字面量 MUST NOT 出现在输出里
        // （例如 unrecorded 场景不得渲染出 sourceCommit 不一致的诊断）
        for (const reason of ALL_STALE_REASONS) {
          if (scenario.expectedStaleReasons.includes(reason)) continue;
          // `collector-fingerprint` 是另外两个原因名的前缀，裸子串判断会假阳性——
          // 改判 `[原因]` 这一 nextSteps 前缀形态（闭合方括号）的精确出现
          expect(result.stdout).not.toContain(`[${reason}]`);
        }
      });
    }

    it('SC-009：多原因样本重复运行 3 次，--json 的 staleReasons 顺序完全一致', () => {
      const multi = SC009_STALE_SCENARIOS.find((s) => s.id === 'multi-reason');
      expect(multi).toBeDefined();
      const graphPath = seedScenarioGraph(multi!.buildGraph);

      const observed = [1, 2, 3].map(() => {
        const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });
        return JSON.parse(result.stdout).freshness.staleReasons;
      });

      for (const reasons of observed) {
        expect(reasons).toEqual(multi!.expectedStaleReasons);
      }
    });

    it('对照组：commit 与指纹均一致 → fresh，--json 不含 staleReasons 字段', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });
      const report = JSON.parse(result.stdout);

      expect(report.freshness.state).toBe('fresh');
      expect(report.freshness.staleReasons).toBeUndefined();
    });

    it('对照组：dirty 态（commit + 指纹均一致、工作树脏）仍判 dirty，不被指纹判定误升为 stale', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'export const x = 1;\n');
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });
      const report = JSON.parse(result.stdout);

      expect(report.freshness.state).toBe('dirty');
      expect(report.freshness.staleReasons).toBeUndefined();
    });
  });

  // ============================================================
  // F249 T034 / SC-018：schemaVersion 1.0 双边界回归 oracle（非原子组成员）
  //
  // 验证本需求未改变 MIN_SUPPORTED_SCHEMA_VERSION 的既有双边界行为：1.0 旧图在
  // schemaVersion 关卡就被拒，判定链路根本走不到 freshness / 指纹比较分支。
  // ============================================================

  describe('SC-018：schemaVersion 1.0 判 schema-too-old，不进入 freshness/指纹分支', () => {
    it('1.0 旧图 + 不含 fingerprint 字段 → schema-too-old（exit 2）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      const graph = baseGraph({ schemaVersion: '1.0', sourceCommit: sha });
      delete graph.graph.fingerprint;
      writeGraph(graphPath, graph);

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.overallVerdict).toBe('cannot-assess');
      expect(report.cannotAssessReason).toBe('schema-too-old');
      // 判定链路未进入 freshness 分支的证据：cannot-assess 占位报告的 freshness 恒为
      // unknown-provenance 且不带任何 staleReasons（即使 sourceCommit 与 HEAD 明明一致）
      expect(report.freshness.state).toBe('unknown-provenance');
      expect(report.freshness.staleReasons).toBeUndefined();
    });

    it('1.0 旧图 + 含合法当前 fingerprint → 仍判 schema-too-old（fingerprint 不改变双边界）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ schemaVersion: '1.0', sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.cannotAssessReason).toBe('schema-too-old');
      expect(report.freshness.staleReasons).toBeUndefined();
    });

    it('1.0 旧图 + 畸形 fingerprint → 仍判 schema-too-old（不因指纹畸形改判为 stale）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      const graph = baseGraph({ schemaVersion: '1.0', sourceCommit: sha });
      (graph.graph as unknown as Record<string, unknown>)['fingerprint'] = { formatVersion: 'x' };
      writeGraph(graphPath, graph);

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout).cannotAssessReason).toBe('schema-too-old');
    });

    it('上边界未被本需求改变：schemaVersion 2.0 + 合法 fingerprint 仍可完整评估（非 cannot-assess）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).overallVerdict).not.toBe('cannot-assess');
    });
  });

  // ============================================================
  // F261 T009-T011 / T-R5b-d：builder stamp advisory（只在人读 text 面可见）
  // ============================================================

  describe('F261：builder advisory（text 面新增一行，判定面一律不动）', () => {
    /**
     * 第三轮 D1：比对对象是**当前正在运行的 builder**（本测试跑的是真 `dist/cli/index.js`，
     * 因此子进程里 `getBuilderStamp()` 恒为 `dist/.spectra-build-meta.json` 的投影，
     * 由 `assertDistBuilt()` 保证存在）。
     */
    type BuilderStampLike = NonNullable<GraphJSON['graph']['builder']>;

    /** 读出**当前 dist** 的 stamp——即子进程里 `getBuilderStamp()` 会拿到的那一份。 */
    function currentDistStamp(): BuilderStampLike {
      const meta = JSON.parse(
        fs.readFileSync(resolve('dist/.spectra-build-meta.json'), 'utf-8'),
      ) as Omit<BuilderStampLike, 'formatVersion'>;
      return {
        formatVersion: 1,
        commit: meta.commit,
        dirty: meta.dirty,
        sourceDirty: meta.sourceDirty,
        distSha256: meta.distSha256,
      };
    }

    /** 一份与当前 dist 毫无关系的 build 身份（"陈旧 dist 建的图"）。 */
    const FOREIGN_BUILDER: BuilderStampLike = {
      formatVersion: 1,
      commit: 'a'.repeat(40),
      dirty: false,
      sourceDirty: false,
      distSha256: '0'.repeat(64),
    };

    function seedGraph(builder: unknown): string {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(
        graphPath,
        baseGraph({ sourceCommit: sha, builder: builder as GraphJSON['graph']['builder'] }),
      );
      return graphPath;
    }

    it('D1：图由当前运行的 build 写出 → text 明说「由当前运行的 build 写出」', () => {
      const graphPath = seedGraph(currentDistStamp());

      const result = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir });

      expect(result.stdout).toContain('[builder]');
      expect(result.stdout).toContain('由当前运行的 build 写出');
      expect(result.stdout).not.toContain('不是同一个 build');
    });

    it('D1：图由另一版 build 写出 → text 判「不是同一个 build」并给出两侧短值', () => {
      const graphPath = seedGraph(FOREIGN_BUILDER);

      const result = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir });

      expect(result.stdout).toContain('[builder]');
      expect(result.stdout).toContain('不是同一个 build');
      expect(result.stdout).toContain('aaaaaaa');
      expect(result.stdout).toContain(currentDistStamp().commit.slice(0, 7));
    });

    /**
     * D2 的**主形态**端到端判据：未提交的 feature 分支上 `commit` 恒等于 HEAD，dist 落后多少次
     * 编辑都不改变它——只有 `distSha256` 这一维能分辨。修复前，这两次运行的 `[builder]` 行
     * **逐字相同**（真 dist 实证）。
     */
    it('D2：同 commit、仅 distSha256 不同 → 与"完全同一 build"的输出必须不同，且渲染 dist 前 12 位', () => {
      const current = currentDistStamp();
      const samePath = path.join(tmpDir, 'same', 'graph.json');
      const distDriftPath = path.join(tmpDir, 'drift', 'graph.json');
      const sha = initGitRepoWithCommit(tmpDir);
      const driftedDist = 'f'.repeat(64);
      writeGraph(
        samePath,
        baseGraph({ sourceCommit: sha, builder: current }),
      );
      writeGraph(
        distDriftPath,
        baseGraph({
          sourceCommit: sha,
          builder: { ...current, distSha256: driftedDist },
        }),
      );

      const builderLine = (graphPath: string): string => {
        const out = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir }).stdout;
        return out.split('\n').find((line) => line.startsWith('[builder]')) ?? '';
      };
      const sameLine = builderLine(samePath);
      const driftLine = builderLine(distDriftPath);

      expect(sameLine).not.toBe('');
      expect(driftLine).not.toBe(sameLine);
      expect(driftLine).toContain(driftedDist.slice(0, 12));
      expect(driftLine).toContain(current.distSha256.slice(0, 12));
      expect(driftLine).toContain('不是同一个 build');
    });

    it('D1：builder 键缺失（旧图产物）→ unrecorded，且与 unstamped/unrecognized 分列', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
      writeGraph(graphPath, baseGraph({ sourceCommit: sha }));

      const result = runCLI(['graph-quality', '--graph', graphPath], { cwd: tmpDir });

      expect(result.stdout).toContain('[builder]');
      expect(result.stdout).toContain('unrecorded');
    });

    it('D1：builder 显式 null → unstamped；不可解析 → unrecognized', () => {
      const nullPath = seedGraph(null);
      const nullResult = runCLI(['graph-quality', '--graph', nullPath], { cwd: tmpDir });
      expect(nullResult.stdout).toContain('unstamped');

      const bogusPath = path.join(tmpDir, 'bogus', 'graph.json');
      writeGraph(
        bogusPath,
        baseGraph({ builder: { formatVersion: 9 } as unknown as GraphJSON['graph']['builder'] }),
      );
      const bogusResult = runCLI(['graph-quality', '--graph', bogusPath], { cwd: tmpDir });
      expect(bogusResult.stdout).toContain('unrecognized');
      expect(bogusResult.stdout).not.toContain('unstamped');
    });

    it('T-R5c：advisory 不改判定——有/无 builder 两种输入的 exitCode、overallVerdict、freshness.state 逐字相同', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const withPath = path.join(tmpDir, 'with', 'graph.json');
      const withoutPath = path.join(tmpDir, 'without', 'graph.json');
      writeGraph(withPath, baseGraph({ sourceCommit: sha, builder: FOREIGN_BUILDER }));
      writeGraph(withoutPath, baseGraph({ sourceCommit: sha }));

      const withResult = runCLI(['graph-quality', '--graph', withPath, '--json'], { cwd: tmpDir });
      const withoutResult = runCLI(['graph-quality', '--graph', withoutPath, '--json'], {
        cwd: tmpDir,
      });

      expect(withResult.exitCode).toBe(withoutResult.exitCode);
      const a = JSON.parse(withResult.stdout);
      const b = JSON.parse(withoutResult.stdout);
      expect(a.overallVerdict).toBe(b.overallVerdict);
      expect(a.freshness.state).toBe(b.freshness.state);
      expect(a.freshness.staleReasons).toEqual(b.freshness.staleReasons);
      expect(a.nextSteps).toEqual(b.nextSteps);
    });

    it('T-R5d：两种输入的 --json 输出均过 schema 校验且 violations 为空（builder 未泄进 --json）', () => {
      const sha = initGitRepoWithCommit(tmpDir);
      const withPath = path.join(tmpDir, 'with', 'graph.json');
      const withoutPath = path.join(tmpDir, 'without', 'graph.json');
      writeGraph(withPath, baseGraph({ sourceCommit: sha, builder: FOREIGN_BUILDER }));
      writeGraph(withoutPath, baseGraph({ sourceCommit: sha }));

      const schema = JSON.parse(fs.readFileSync(REPORT_SCHEMA_PATH, 'utf-8')) as Record<
        string,
        unknown
      >;

      for (const graphPath of [withPath, withoutPath]) {
        const result = runCLI(['graph-quality', '--graph', graphPath, '--json'], { cwd: tmpDir });
        const report = JSON.parse(result.stdout);
        expect(validateAgainstSchema(report, schema).violations).toEqual([]);
        // 直接证明 builder 没被塞进报告顶层
        expect(Object.keys(report)).not.toContain('builder');
      }
    });

    /**
     * 复审 F1（第二轮）—— 第一轮 `short()` 对非字符串 `sourceCommit` 直接 `.slice`，整条
     * `graph-quality` 崩成 `exit 2`（`✗ 错误: 致命错误: sha.slice is not a function`）。
     * 该路径真实可达：`validateGraphJsonShape` 不校验 `sourceCommit` 类型，`evaluateFreshness`
     * 也容忍任意值。删掉 builder 键即恢复 exit 0 ⇒ 确为本特性引入的回归，且违反本特性自己的
     * "advisory 一律不改 exit code"不变量。这里用 CLI 真子进程钉住该不变量。
     */
    it('F1：sourceCommit 畸形（非字符串）时，有/无 builder 的 exitCode 逐字相同且不为 2', () => {
      initGitRepoWithCommit(tmpDir);
      /** `sourceCommit` 为数字：类型系统禁止，但磁盘上的 JSON 完全可以是这样（守卫不校验它）。 */
      const withMalformedSourceCommit = (extra: Partial<GraphJSON['graph']> = {}): GraphJSON => {
        const graph = baseGraph(extra);
        (graph.graph as { sourceCommit?: unknown }).sourceCommit = 123;
        return graph;
      };
      const withPath = path.join(tmpDir, 'with', 'graph.json');
      const withoutPath = path.join(tmpDir, 'without', 'graph.json');
      writeGraph(withPath, withMalformedSourceCommit({ builder: FOREIGN_BUILDER }));
      writeGraph(withoutPath, withMalformedSourceCommit());

      const withResult = runCLI(['graph-quality', '--graph', withPath], { cwd: tmpDir });
      const withoutResult = runCLI(['graph-quality', '--graph', withoutPath], { cwd: tmpDir });

      expect(withResult.exitCode).toBe(withoutResult.exitCode);
      expect(withResult.exitCode).not.toBe(2);
      expect(withResult.stdout).not.toContain('sha.slice');
      expect(withResult.stderr).not.toContain('sha.slice');
      // 仍应产出完整报告（含 builder advisory 行），而不是半路崩掉
      expect(withResult.stdout).toContain('[builder]');
    });

    it('T-R5d：--status 输出不受 builder 影响（三字段逐字不变）', () => {
      const graphPath = seedGraph(FOREIGN_BUILDER);

      const result = runCLI(['graph-quality', '--graph', graphPath, '--status', '--json'], {
        cwd: tmpDir,
      });

      const status = JSON.parse(result.stdout);
      expect(Object.keys(status).sort()).toEqual(['freshness', 'graphExists', 'overallVerdict']);
    });
  });
});
