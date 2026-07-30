/**
 * community-analysis 端到端集成测试
 * 覆盖完整分析管道：GraphJSON → 社区检测 → God Node → 异常边 → 报告生成
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { runCommunityAnalysis } from '../../src/panoramic/community/index.js';
import type { GraphJSON, GraphNode, GraphEdge } from '../../src/panoramic/graph/graph-types.js';

// ============================================================
// 辅助函数
// ============================================================

function makeNode(id: string, kind: GraphNode['kind'] = 'module'): GraphNode {
  return { id, kind, label: id, metadata: {} };
}

function makeEdge(
  source: string,
  target: string,
  relation = 'depends-on',
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' = 'EXTRACTED',
): GraphEdge {
  const scores = { EXTRACTED: 0.95, INFERRED: 0.65, AMBIGUOUS: 0.25 };
  return { source, target, relation, confidence, confidenceScore: scores[confidence] };
}

function makeGraphJSON(nodes: GraphNode[], links: GraphEdge[]): GraphJSON {
  return {
    directed: false, multigraph: false,
    graph: { name: 'spectra-knowledge-graph', generatedAt: new Date().toISOString(), nodeCount: nodes.length, edgeCount: links.length, sources: ['architecture-ir'], schemaVersion: '1.0' },
    nodes, links,
  };
}

/**
 * 构造规模缩放测试用的环形图：每个节点连出 2-4 条边
 *
 * 用确定性 LCG 而非 Math.random——缩放比判据要求两个规模的边密度严格同分布，
 * 否则两次测量的差异里会混入随机边数波动，污染增长率信号。
 */
function buildScaleTestGraph(nodeCount: number, seed: number): GraphJSON {
  let state = seed;
  const nextRandom = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  const nodes = Array.from({ length: nodeCount }, (_, i) => makeNode(`n${i}`));
  const links: GraphEdge[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const neighborCount = 2 + Math.floor(nextRandom() * 3);
    for (let j = 0; j < neighborCount; j++) {
      links.push(makeEdge(`n${i}`, `n${(i + j + 1) % nodeCount}`));
    }
  }
  return makeGraphJSON(nodes, links);
}

/** 一次管道执行的耗时观测：cpu 为本进程实耗 CPU 时间，wall 为墙钟 */
interface AnalysisCost {
  /** 本进程 user+system CPU 时间（ms）——不含被其他进程抢占的等待，故抗宿主负载 */
  cpu: number;
  /** 墙钟耗时（ms）——仅用于兜底的挂死检测 */
  wall: number;
}

/**
 * 跑一次完整分析管道并同时记录 CPU 时间与墙钟
 *
 * 为什么 cpu 而非 wall 做主判据：墙钟包含被别的进程抢占 CPU 的等待，满载时两个规模
 * 被抢占的比例并不相同（实测同一次全量 vitest 里 wall 比值在 1.44-10.85 之间乱跳，
 * 而 cpu 比值稳定在 3.56-5.67）。process.cpuUsage() 只累计本进程实际占用的 CPU，
 * 天然扣掉了这部分噪声。
 *
 * 前提：vitest 3 默认 pool='forks' + isolate=true，每个测试文件独占一个 fork 进程，
 * 同进程内不会并发跑别的测试文件，故本进程 CPU 时间可归因于本用例。
 * 若将来把 pool 改为 'threads'，同进程会混入其他文件的 CPU，该前提失效需重新设计。
 */
function measureAnalysis(graphJson: GraphJSON, outputDir: string): AnalysisCost {
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  runCommunityAnalysis(graphJson, outputDir);
  const wall = performance.now() - start;
  const delta = process.cpuUsage(cpuBefore);
  return { cpu: (delta.user + delta.system) / 1000, wall };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// 测试用例
// ============================================================

describe('runCommunityAnalysis 端到端', () => {
  it('生成完整的 GRAPH_REPORT.md', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      makeEdge('c', 'd', 'depends-on', 'INFERRED'),
    ];
    const graphJson = makeGraphJSON(nodes, links);

    const reportPath = runCommunityAnalysis(graphJson, tmpDir);

    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, 'utf-8');

    // 验证报告包含所有 5 个必需区块
    expect(content).toContain('# 架构图谱分析报告');
    expect(content).toContain('## 概述');
    expect(content).toContain('## God Nodes');
    expect(content).toContain('## 社区列表');
    expect(content).toContain('## Surprising Connections');
    expect(content).toContain('## Knowledge Gaps');
  });

  it('报告写入 _meta/GRAPH_REPORT.md', () => {
    const graphJson = makeGraphJSON(
      [makeNode('a'), makeNode('b')],
      [makeEdge('a', 'b')],
    );
    const reportPath = runCommunityAnalysis(graphJson, tmpDir);
    expect(reportPath).toBe(path.join(tmpDir, '_meta', 'GRAPH_REPORT.md'));
  });

  it('minSize 选项传递到社区检测', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeNode(id));
    const links = [
      makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c'),
      makeEdge('d', 'e'), makeEdge('e', 'f'), makeEdge('d', 'f'),
      makeEdge('c', 'd'),
    ];
    const graphJson = makeGraphJSON(nodes, links);

    const reportPath = runCommunityAnalysis(graphJson, tmpDir, { minSize: 10 });
    const content = fs.readFileSync(reportPath, 'utf-8');
    // 应该没有满足 minSize=10 的社区
    expect(content).toContain('未检测到有效社区');
  });

  it('1000→4000 节点算法复杂度不退化（负载无关的规模缩放比判据）', () => {
    // ── 判据说明（F234）────────────────────────────────────────────────
    // 本用例守护的是"算法复杂度不退化"——一个关于**增长率**的性质。旧版断言
    // `expect(elapsed).toBeLessThan(30000)` 用单个规模的一次绝对耗时来验证它，
    // 判据与守护目标错配：单点耗时不含任何增长率信息，实际测的只是"这台机器忙不忙"。
    // 后果双向失效——宿主负载升高就误报（CI 实测 31851ms 越过 30000ms 阈值，同一
    // 用例本地隔离重跑仅约 3.5s），而真出现复杂度退化时又抓不住（本次实测：把
    // betweenness 的采样上限去掉这一真实退化，5000 节点耗时 19.2s，旧阈值照样放行）。
    //
    // 现判据：测 T(n) 与 T(4n) 的增长比。管道成本 = Louvain O(n log n) +
    // betweenness 采样（源节点数被 sampleSize 上限 1000 钳住，故对 n≥1000 呈
    // O(V+E) 线性）。因此 1000→4000 的预期比值约 4-5；退化为 O(n²) 时趋向 16。
    // 取 8 作判别线，两侧各留约 1.6-2× 余量。
    // 用 4× 而非 2× 跨度：跨度越大信号越强——2× 跨度下线性 2.2 / 二次 4，与噪声
    // 区间几乎贴脸。
    //
    // 负载无关性实证（详见 verification 记录）：
    //   - 空载 CPU 比值 4.01-4.88
    //   - 全量 vitest（487 文件并行）下 CPU 比值 3.56-5.67，而同批次墙钟比值
    //     1.44-10.85 —— 这正是不能用墙钟做主判据的直接证据
    //   - 拉满 CPU（120 个 busy loop）使单次耗时膨胀约 10-21×，比值仍在同一区间
    // 另加最多 3 轮重测：真实复杂度退化是确定性的（每轮都越界），而并发噪声是随机的，
    // 连续 3 轮同时越界的概率可忽略。
    // ──────────────────────────────────────────────────────────────────
    const smallSize = 1000;
    const largeSize = 4000;
    /** 增长比判别线：线性实测 4-5.7，O(n²) 退化约 16 */
    const maxGrowthRatio = 8;
    /** 越界后的重测轮数上限——用于区分"确定性退化"与"一次性并发噪声" */
    const maxAttempts = 3;

    // JIT 预热：避免第一次测量额外承担热点函数的编译开销而虚高，从而扭曲比值
    runCommunityAnalysis(buildScaleTestGraph(600, 7), path.join(tmpDir, 'warmup'));

    const smallGraph = buildScaleTestGraph(smallSize, 1);
    const largeGraph = buildScaleTestGraph(largeSize, 2);
    const smallDir = path.join(tmpDir, 'scale-small');
    const largeDir = path.join(tmpDir, 'scale-large');

    let growthRatio = Infinity;
    let lastLargeWall = 0;
    const attemptLog: string[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const small = measureAnalysis(smallGraph, smallDir);
      const large = measureAnalysis(largeGraph, largeDir);
      growthRatio = large.cpu / small.cpu;
      lastLargeWall = large.wall;
      attemptLog.push(
        `#${attempt} cpu ${small.cpu.toFixed(0)}→${large.cpu.toFixed(0)}ms ratio=${growthRatio.toFixed(2)}`,
      );
      if (growthRatio < maxGrowthRatio) break;
    }

    // 确认两次测量都真的跑完了整条管道——否则"耗时"可能测的是提前返回的空管道
    expect(fs.existsSync(path.join(smallDir, '_meta', 'GRAPH_REPORT.md'))).toBe(true);
    expect(fs.existsSync(path.join(largeDir, '_meta', 'GRAPH_REPORT.md'))).toBe(true);

    expect(
      growthRatio,
      `T(${smallSize})→T(${largeSize}) 缩放比连续越界：${attemptLog.join('; ')}`,
    ).toBeLessThan(maxGrowthRatio);

    // 兜底上限仅在死循环/挂死时给出比"超时"更清晰的失败信息，**不承担复杂度判定
    // 职责**（复杂度由上面的 growthRatio 判定）。故意留极大余量：满载实测曾达 71s。
    expect(lastLargeWall).toBeLessThan(120_000);
  }, 420_000);
});
