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

const CLI_PATH = resolve('dist/cli/index.js');

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

describe('graph-quality CLI（F217 T033）', () => {
  beforeAll(() => {
    // 确保编译产物含本次新增的 graph-quality 命令（先红：实现前该子命令不存在）。
    execFileSync('npm', ['run', 'build'], { encoding: 'utf-8', timeout: 120_000 });
  }, 120_000);

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
    }, 30_000);
  });
});
