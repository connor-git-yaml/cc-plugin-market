/**
 * F217 T046 — 四语言图质量回归矩阵测试（US3）。
 *
 * 覆盖 SC-002：验证图质量六指标检测在 TS/JS、Python、Java、Go 四语言下
 * 正确工作，无跨语言误报/漏报。全部断言值均来自各语言 pinned graph 目录下
 * 人工手推的 README.md（禁止仅与上次运行结果 deepEqual 的弱断言）。
 *
 * ① Python：复用既有 `tests/fixtures/micrograd-baseline-graph/graph.json`
 *    （F215 in-repo pinned fixture，随 git 提交恒存在——不设 skip 条件，缺失时
 *    fail-fast，与 mcp-server-stdio.test.ts / agent-context-real-graph.test.ts
 *    同款约定）。**P4（T049）已重新生成本 fixture**（producer commit `1445edf`，
 *    F217 P1~P3 metadata 透传修复落地态）：5 个顶层 class 节点（Value/Layer/MLP/
 *    Module/Neuron）现已正确获得 `unifiedKind='symbol'`（T024 existing-node 合并
 *    分支修复生效的直接证据），断言已按新值全量翻新（不再如实记录旧缺口）。
 * ② TS/Java/Go：`tests/fixtures/graph-quality-{ts,java,go}-graph/graph.json`
 *    （F217 T043~T045 新建的 in-repo pinned fixture，恒实跑，无 skip 语义）。
 * ③ 四语言均对真实 dist CLI 跑一次 `graph-quality --json --graph <pinned-graph>`，
 *    断言五项结构指标 pass/fail 状态 + `freshness.state`（四份 pinned graph 的
 *    `sourceCommit` 均为 `null`/缺失，故 freshness 恒为 `unknown-provenance`，
 *    是诚实降级而非跳过评估）均出现在输出中。
 * ④ orphan 豁免例外分类断言（entrypoint/pure-type/test-export）不在此覆盖，
 *    正常 fixture 里所有节点都通过 contains 边天然 degree≥1，例外分类逻辑根本
 *    不会被触发（假覆盖）——豁免分类断言见 graph-quality-adversarial.test.ts（T048）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GraphQualityReport } from '../../src/panoramic/graph/quality/quality-types.js';

const CLI_PATH = resolve('dist/cli/index.js');

interface CLIResult {
  stdout: string;
  exitCode: number;
}

function runGraphQualityJson(graphPath: string): { result: CLIResult; report: GraphQualityReport } {
  let stdout: string;
  let exitCode = 0;
  try {
    stdout = execFileSync('node', [CLI_PATH, 'graph-quality', '--graph', graphPath, '--json'], {
      encoding: 'utf-8',
      timeout: 30_000,
    });
  } catch (err: unknown) {
    const error = err as { stdout?: string; status?: number };
    stdout = error.stdout ?? '';
    exitCode = error.status ?? 1;
  }
  return { result: { stdout, exitCode }, report: JSON.parse(stdout) as GraphQualityReport };
}

describe('四语言图质量回归矩阵（F217 T046）', () => {
  beforeAll(() => {
    // 与 graph-quality-cli.test.ts（T033）同款前置：确保 dist 含本次新增命令。
    if (!existsSync(CLI_PATH)) {
      execFileSync('npm', ['run', 'build'], { encoding: 'utf-8', timeout: 120_000 });
    }
  }, 120_000);

  describe('Python（micrograd，F215 in-repo pinned fixture，P4 重生成后验证 T024 修复）', () => {
    const GRAPH_PATH = resolve('tests/fixtures/micrograd-baseline-graph/graph.json');

    beforeAll(() => {
      if (!existsSync(GRAPH_PATH)) {
        throw new Error(
          `pinned fixture 缺失: ${GRAPH_PATH} —— 该文件应随 git 提交恒存在，` +
            `缺失说明检出不完整或漏提交，非"baseline 未采集"的可 skip 场景。` +
            `参见 tests/fixtures/micrograd-baseline-graph/README.md 的再生步骤重新生成。`,
        );
      }
    });

    it('顶层 function/class 分母精确断言：33 节点，全部 28 个 symbol 节点均具备 unifiedKind=symbol（T024 修复生效）', () => {
      const raw = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')) as {
        nodes: Array<{ id: string; metadata?: Record<string, unknown> }>;
      };
      expect(raw.nodes.length).toBe(33);

      const symbolNodes = raw.nodes.filter((n) => n.metadata?.['unifiedKind'] === 'symbol');
      expect(symbolNodes.length).toBe(28);

      // T024 修复目标的顶层 class 节点（Python existing-node 合并分支曾未补 unifiedKind）：
      // P4（T049）重新生成 fixture 后，这 5 个顶层 class 节点现已正确获得
      // unifiedKind='symbol' + exportKind='class'——直接验证 T024 修复对 Python 生效。
      const topLevelClassIds = [
        'micrograd/engine.py::Value',
        'micrograd/nn.py::Layer',
        'micrograd/nn.py::MLP',
        'micrograd/nn.py::Module',
        'micrograd/nn.py::Neuron',
      ];
      for (const id of topLevelClassIds) {
        const node = raw.nodes.find((n) => n.id === id);
        expect(node, `顶层 class 节点 ${id} 应存在于图中`).toBeDefined();
        expect(
          node?.metadata?.['unifiedKind'],
          `${id} 的 metadata.unifiedKind 应为 'symbol'（T024 existing-node 合并分支修复后，` +
            `顶层 class 节点不再因 Python extraction 分支未补齐而缺失 unifiedKind）`,
        ).toBe('symbol');
        expect(node?.metadata?.['exportKind'], `${id} 应携带 exportKind='class'`).toBe('class');
      }
    });

    it('五项结构指标 + freshness：全部 pass，contains 覆盖率 100%（T024 修复后无分母缩水）', () => {
      const { result, report } = runGraphQualityJson(GRAPH_PATH);
      expect(result.exitCode).toBe(0);

      expect(report.duplicateCanonicalId.status).toBe('pass');
      expect(report.danglingEdges.status).toBe('pass');
      expect(report.legacyAndIgnoredNodes.status).toBe('pass');
      expect(report.containsCoverage.status).toBe('pass');
      expect(report.containsCoverage.total).toBe(28);
      expect(report.containsCoverage.covered).toBe(28);
      expect(report.containsCoverage.ratio).toBe(1);
      expect(report.orphanRatio.status).toBe('pass');
      expect(report.orphanRatio.totalSymbolNodes).toBe(28);
      expect(report.orphanRatio.offendingIds).toEqual([]);

      // sourceCommit 字段在本 fixture 中缺失（F215 时代产物，早于 F217 sourceCommit 注入）——
      // FR-010：undefined 与显式 null 同等判定为 unknown-provenance，非异常。
      expect(report.freshness.state).toBe('unknown-provenance');
      expect(report.freshness.recordedSourceCommit).toBeNull();
      expect(report.overallVerdict).toBe('pass');
    });
  });

  describe.each([
    {
      lang: 'TS/JS',
      graphPath: resolve('tests/fixtures/graph-quality-ts-graph/graph.json'),
      expectedNodeCount: 10,
      expectedSymbolCount: 8,
      expectedEdgeCount: 11,
    },
    {
      lang: 'Java',
      graphPath: resolve('tests/fixtures/graph-quality-java-graph/graph.json'),
      expectedNodeCount: 18,
      expectedSymbolCount: 13,
      expectedEdgeCount: 13,
    },
    {
      lang: 'Go',
      graphPath: resolve('tests/fixtures/graph-quality-go-graph/graph.json'),
      expectedNodeCount: 13,
      expectedSymbolCount: 9,
      expectedEdgeCount: 9,
    },
  ])('$lang（新建 in-repo pinned fixture，README 手推数值，恒实跑）', ({
    graphPath,
    expectedNodeCount,
    expectedSymbolCount,
    expectedEdgeCount,
  }) => {
    it('pinned graph 结构规模与 README 手推数值一致', () => {
      const raw = JSON.parse(readFileSync(graphPath, 'utf-8')) as {
        graph: { sourceCommit?: string | null };
        nodes: Array<{ metadata?: Record<string, unknown> }>;
        links: unknown[];
      };
      expect(raw.graph.sourceCommit).toBeNull();
      expect(raw.nodes.length).toBe(expectedNodeCount);
      expect(raw.links.length).toBe(expectedEdgeCount);
      const symbolNodes = raw.nodes.filter((n) => n.metadata?.['unifiedKind'] === 'symbol');
      expect(symbolNodes.length).toBe(expectedSymbolCount);
    });

    it('完整六指标：五项结构指标全 pass + freshness=unknown-provenance（真实 CLI --json）', () => {
      const { result, report } = runGraphQualityJson(graphPath);
      expect(result.exitCode).toBe(0);

      expect(report.duplicateCanonicalId.status).toBe('pass');
      expect(report.containsCoverage.status).toBe('pass');
      expect(report.containsCoverage.total).toBe(expectedSymbolCount);
      expect(report.containsCoverage.covered).toBe(expectedSymbolCount);
      expect(report.containsCoverage.ratio).toBe(1);
      expect(report.orphanRatio.status).toBe('pass');
      expect(report.orphanRatio.totalSymbolNodes).toBe(expectedSymbolCount);
      expect(report.orphanRatio.offendingIds).toEqual([]);
      expect(report.danglingEdges.status).toBe('pass');
      expect(report.legacyAndIgnoredNodes.status).toBe('pass');
      expect(report.legacyAndIgnoredNodes.legacyHashNodeIds).toEqual([]);
      expect(report.legacyAndIgnoredNodes.ignoredPathNodeIds).toEqual([]);

      expect(report.freshness.state).toBe('unknown-provenance');
      expect(report.freshness.recordedSourceCommit).toBeNull();
      expect(report.overallVerdict).toBe('pass');
    });
  });
});
