/**
 * direction-audit 集成测试
 * 覆盖：分类逻辑、text/json 输出格式、--snapshot 写入、--compare-snapshot 退出码、性能断言
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';
import { runDirectionAuditCommand } from '../../src/cli/commands/direction-audit.js';

// ============================================================
// 测试 fixture 构建辅助
// ============================================================

/** 构造最小 CLICommand，仅设置 direction-audit 所需字段 */
function makeCmd(overrides: Partial<CLICommand> = {}): CLICommand {
  return {
    subcommand: 'direction-audit',
    deep: false,
    force: false,
    version: false,
    help: false,
    global: false,
    remove: false,
    skillTarget: 'claude',
    ...overrides,
  };
}

/**
 * 小型 fixture graph.json（5-20 条边，涵盖各分类场景）
 * 节点：modA / modB / modC（module）、docX（spec）、docY（document）
 * 边：
 *   1. modA → modB，EXTRACTED → correct
 *   2. modA → modC，INFERRED → suspicious（panoramic-builder）
 *   3. modB → modC，cross-reference 关系 → suspicious（cross-reference-inference）
 *   4. modC → modA，EXTRACTED + metadata.reversedBy → incorrect
 *   5. docX → docY，双文档节点 → skipped
 *   6. modA → modC，AMBIGUOUS → suspicious（弱置信度）
 */
const FIXTURE_GRAPH = {
  directed: true,
  multigraph: false,
  graph: {
    name: 'spectra-knowledge-graph',
    generatedAt: '2026-04-19T00:00:00.000Z',
    nodeCount: 5,
    edgeCount: 6,
    sources: ['architecture-ir'],
    schemaVersion: '1.0',
  },
  nodes: [
    { id: 'modA/index.ts', kind: 'module', label: 'modA', metadata: {} },
    { id: 'modB/index.ts', kind: 'module', label: 'modB', metadata: {} },
    { id: 'modC/index.ts', kind: 'module', label: 'modC', metadata: {} },
    { id: 'specDocs/specX.md', kind: 'spec', label: 'specX', metadata: {} },
    { id: 'docArchive/docY.md', kind: 'document', label: 'docY', metadata: {} },
  ],
  links: [
    // correct：EXTRACTED 置信度
    {
      source: 'modA/index.ts',
      target: 'modB/index.ts',
      relation: 'imports',
      confidence: 'EXTRACTED',
      confidenceScore: 0.95,
      metadata: {},
    },
    // suspicious：INFERRED（LLM 推断）
    {
      source: 'modA/index.ts',
      target: 'modC/index.ts',
      relation: 'uses',
      confidence: 'INFERRED',
      confidenceScore: 0.65,
      metadata: {},
    },
    // suspicious：cross-reference 推断
    {
      source: 'modB/index.ts',
      target: 'modC/index.ts',
      relation: 'cross-reference',
      confidence: 'INFERRED',
      confidenceScore: 0.6,
      metadata: {},
    },
    // incorrect：有 reversedBy 标记
    {
      source: 'modC/index.ts',
      target: 'modA/index.ts',
      relation: 'imports',
      confidence: 'EXTRACTED',
      confidenceScore: 0.9,
      metadata: { reversedBy: 'modA/index.ts' },
    },
    // skipped：双文档节点（跨模块顶层目录，但两侧都是文档类型）
    {
      source: 'specDocs/specX.md',
      target: 'docArchive/docY.md',
      relation: 'references',
      confidence: 'INFERRED',
      confidenceScore: 0.5,
      metadata: {},
    },
    // suspicious：AMBIGUOUS
    {
      source: 'modA/index.ts',
      target: 'modC/index.ts',
      relation: 'related-to',
      confidence: 'AMBIGUOUS',
      confidenceScore: 0.3,
      metadata: {},
    },
  ],
};

// ============================================================
// 测试辅助：stdout 捕获
// ============================================================

/** 捕获 console.log / console.error 输出 */
function captureConsole(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

// ============================================================
// 测试套件
// ============================================================

describe('direction-audit 集成测试', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'direction-audit-test-'));
    // 重置 process.exitCode
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Test 1: text 格式输出
  // -----------------------------------------------------------------------
  describe('text 格式报告', () => {
    it('读取 fixture graph.json，生成 text 格式报告，包含正确统计数', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditFormat: 'text',
        }));
      } finally {
        cap.restore();
      }

      const output = cap.logs.join('\n');
      expect(output).toContain('Direction Audit Report');
      expect(output).toContain('Total cross-module edges:');
      // fixture 中 5 条跨模块边（doc→doc 的 skipped 也是跨模块但双文档）
      expect(output).toContain('correct:');
      expect(output).toContain('suspicious:');
      expect(output).toContain('incorrect:');
      expect(output).toContain('skipped:');
      // 不应以失败退出
      expect(process.exitCode).not.toBe(1);
    });

    it('text 报告含 incorrect 边时，详细列出 INCORRECT 条目', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditFormat: 'text',
        }));
      } finally {
        cap.restore();
      }

      const output = cap.logs.join('\n');
      expect(output).toContain('[INCORRECT]');
      expect(output).toContain('modC/index.ts');
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: JSON 格式输出，符合 schema
  // -----------------------------------------------------------------------
  describe('json 格式报告', () => {
    it('输出合法 JSON，包含 schema 要求的所有顶层字段', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditFormat: 'json',
        }));
      } finally {
        cap.restore();
      }

      const rawJson = cap.logs.join('\n');
      // 找到第一个 '{' 开始的 JSON
      const jsonStart = rawJson.indexOf('{');
      expect(jsonStart).toBeGreaterThanOrEqual(0);
      const report = JSON.parse(rawJson.slice(jsonStart)) as Record<string, unknown>;

      // 验证 schema 要求的顶层字段
      expect(report).toHaveProperty('graphPath');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('totalEdges');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('edges');
      expect(report).toHaveProperty('rootCauseBreakdown');

      // summary 字段
      const summary = report['summary'] as Record<string, number>;
      expect(summary).toHaveProperty('correct');
      expect(summary).toHaveProperty('suspicious');
      expect(summary).toHaveProperty('incorrect');
      expect(summary).toHaveProperty('skipped');
      expect(typeof summary['correct']).toBe('number');

      // rootCauseBreakdown 字段
      const rcb = report['rootCauseBreakdown'] as Record<string, number>;
      expect(rcb).toHaveProperty('astExtraction');
      expect(rcb).toHaveProperty('panoramicBuilder');
      expect(rcb).toHaveProperty('crossReferenceInference');
      expect(rcb).toHaveProperty('unknown');

      // edges 数组中每条边有 schema 要求的字段
      const edges = report['edges'] as Array<Record<string, unknown>>;
      expect(Array.isArray(edges)).toBe(true);
      for (const edge of edges) {
        expect(edge).toHaveProperty('sourceId');
        expect(edge).toHaveProperty('targetId');
        expect(edge).toHaveProperty('relation');
        expect(edge).toHaveProperty('result');
        expect(edge).toHaveProperty('confidence');
        expect(edge).toHaveProperty('rationale');
        const result = edge['result'] as string;
        expect(['correct', 'suspicious', 'incorrect', 'skipped']).toContain(result);
        const confidence = edge['confidence'] as number;
        expect(confidence).toBeGreaterThanOrEqual(0);
        expect(confidence).toBeLessThanOrEqual(1);
      }
    });

    it('JSON 报告中 summary 计数之和等于 totalEdges', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditFormat: 'json',
        }));
      } finally {
        cap.restore();
      }

      const rawJson = cap.logs.join('\n');
      const jsonStart = rawJson.indexOf('{');
      const report = JSON.parse(rawJson.slice(jsonStart)) as {
        totalEdges: number;
        summary: { correct: number; suspicious: number; incorrect: number; skipped: number };
        edges: unknown[];
      };

      const { correct, suspicious, incorrect, skipped } = report.summary;
      expect(correct + suspicious + incorrect + skipped).toBe(report.totalEdges);
      expect(report.edges.length).toBe(report.totalEdges);
    });

    it('fixture 中 incorrect=1, correct=1, suspicious>=2, skipped=1', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditFormat: 'json',
        }));
      } finally {
        cap.restore();
      }

      const rawJson = cap.logs.join('\n');
      const jsonStart = rawJson.indexOf('{');
      const report = JSON.parse(rawJson.slice(jsonStart)) as {
        summary: { correct: number; suspicious: number; incorrect: number; skipped: number };
      };

      expect(report.summary.incorrect).toBe(1);
      expect(report.summary.correct).toBe(1);
      expect(report.summary.suspicious).toBeGreaterThanOrEqual(2);
      expect(report.summary.skipped).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: --snapshot 写入
  // -----------------------------------------------------------------------
  describe('--snapshot 快照写入', () => {
    it('生成快照文件，包含 incorrectCount 和 incorrectHash', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');
      const snapshotPath = join(tmpDir, 'baseline.json');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditSnapshot: snapshotPath,
        }));
      } finally {
        cap.restore();
      }

      expect(process.exitCode).not.toBe(1);

      // 验证快照文件存在且格式正确
      const raw = readFileSync(snapshotPath, 'utf-8');
      const snapshot = JSON.parse(raw) as Record<string, unknown>;
      expect(snapshot).toHaveProperty('generatedAt');
      expect(snapshot).toHaveProperty('graphPath');
      expect(snapshot).toHaveProperty('incorrectCount');
      expect(snapshot).toHaveProperty('incorrectHash');
      expect(typeof snapshot['incorrectCount']).toBe('number');
      expect(typeof snapshot['incorrectHash']).toBe('string');
      // fixture 有 1 条 incorrect 边
      expect(snapshot['incorrectCount']).toBe(1);
      // hash 为 32 位十六进制
      const hashStr = snapshot['incorrectHash'] as string;
      expect(hashStr).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: --compare-snapshot，incorrect 不变 → exit 0
  // -----------------------------------------------------------------------
  describe('--compare-snapshot，incorrect 未增加', () => {
    it('当前 incorrect 与快照相同时，退出码为 0', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');
      const snapshotPath = join(tmpDir, 'baseline.json');

      // 先生成快照
      const cap1 = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditSnapshot: snapshotPath,
        }));
      } finally {
        cap1.restore();
      }
      process.exitCode = undefined;

      // 再对比快照（相同 graph.json → incorrect 数不变）
      const cap2 = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditCompareSnapshot: snapshotPath,
        }));
      } finally {
        cap2.restore();
      }

      expect(process.exitCode).not.toBe(1);
      const output = cap2.logs.join('\n');
      expect(output).toContain('incorrect');
    });
  });

  // -----------------------------------------------------------------------
  // Test 5: --compare-snapshot，incorrect 增加 → exit 1
  // -----------------------------------------------------------------------
  describe('--compare-snapshot，incorrect 增加', () => {
    it('incorrect 数增加时，退出码为 1', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');
      const snapshotPath = join(tmpDir, 'baseline.json');

      // 构造一个 baseline 快照，声称 incorrectCount=0（比实际少）
      const fakeSnapshot = {
        generatedAt: '2026-01-01T00:00:00.000Z',
        graphPath: graphPath,
        incorrectCount: 0,
        incorrectHash: 'da39a3ee5e6b4b0d3255bfef95601890',
      };
      writeFileSync(snapshotPath, JSON.stringify(fakeSnapshot), 'utf-8');

      // 运行对比（当前有 1 条 incorrect，baseline=0 → 回归）
      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditCompareSnapshot: snapshotPath,
        }));
      } finally {
        cap.restore();
      }

      expect(process.exitCode).toBe(1);
      const errOutput = cap.errors.join('\n');
      expect(errOutput).toContain('回归检测');
    });
  });

  // -----------------------------------------------------------------------
  // Test 6: 性能断言 — 1000 条边 < 5000ms（SC-005 守卫）
  // -----------------------------------------------------------------------
  describe('性能断言', () => {
    it('处理 1000 条跨模块边应在 5 秒内完成', async () => {
      // 生成 1000 条合成边（均为跨模块，各种 confidence level）
      const numEdges = 1000;
      const nodes = Array.from({ length: numEdges + 1 }, (_, i) => ({
        id: `module${i}/index.ts`,
        kind: 'module',
        label: `module${i}`,
        metadata: {},
      }));
      const confidenceLevels: Array<'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'> = [
        'EXTRACTED',
        'INFERRED',
        'AMBIGUOUS',
      ];
      const links = Array.from({ length: numEdges }, (_, i) => ({
        source: `module${i}/index.ts`,
        target: `module${i + 1}/index.ts`,
        relation: i % 3 === 0 ? 'imports' : i % 3 === 1 ? 'cross-reference' : 'uses',
        confidence: confidenceLevels[i % 3],
        confidenceScore: i % 3 === 0 ? 0.95 : i % 3 === 1 ? 0.65 : 0.3,
        metadata: {},
      }));

      const largeGraph = {
        directed: true,
        multigraph: false,
        graph: {
          name: 'spectra-knowledge-graph',
          generatedAt: '2026-04-19T00:00:00.000Z',
          nodeCount: nodes.length,
          edgeCount: links.length,
          sources: ['architecture-ir'],
          schemaVersion: '1.0',
        },
        nodes,
        links,
      };

      const graphPath = join(tmpDir, 'large-graph.json');
      writeFileSync(graphPath, JSON.stringify(largeGraph), 'utf-8');

      const start = Date.now();
      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditFormat: 'text',
        }));
      } finally {
        cap.restore();
      }
      const elapsed = Date.now() - start;

      // 1000 条边应远低于 5s（预计 < 100ms）
      expect(elapsed).toBeLessThan(5000);
      expect(process.exitCode).not.toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Test 7: graph.json 不存在时输出错误并 exit 1
  // -----------------------------------------------------------------------
  describe('失败路径：graph.json 不存在', () => {
    it('graph.json 不存在时，退出码为 1，输出明确错误信息', async () => {
      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: join(tmpDir, 'nonexistent-graph.json'),
        }));
      } finally {
        cap.restore();
      }

      expect(process.exitCode).toBe(1);
      const errOutput = cap.errors.join('\n');
      expect(errOutput).toContain('graph.json 不存在');
    });
  });

  // -----------------------------------------------------------------------
  // Test 8: --output 写入文件
  // -----------------------------------------------------------------------
  describe('--output 写入文件', () => {
    it('指定 --output 时，同时写入文件并打印到 stdout', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');
      const outputPath = join(tmpDir, 'report.json');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditOutput: outputPath,
          directionAuditFormat: 'json',
        }));
      } finally {
        cap.restore();
      }

      expect(process.exitCode).not.toBe(1);
      // 文件应已写入
      const content = readFileSync(outputPath, 'utf-8');
      const report = JSON.parse(content) as Record<string, unknown>;
      expect(report).toHaveProperty('summary');
    });
  });

  // -----------------------------------------------------------------------
  // Test 9: --compare-snapshot 快照文件不存在时 exit 1
  // -----------------------------------------------------------------------
  describe('失败路径：--compare-snapshot 文件不存在', () => {
    it('快照文件不存在时，退出码为 1，输出明确错误信息', async () => {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(FIXTURE_GRAPH), 'utf-8');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditCompareSnapshot: join(tmpDir, 'nonexistent-snapshot.json'),
        }));
      } finally {
        cap.restore();
      }

      expect(process.exitCode).toBe(1);
      const errOutput = cap.errors.join('\n');
      expect(errOutput).toContain('快照文件不存在');
    });
  });

  // -----------------------------------------------------------------------
  // Test 10: 空 graph.json（无边）不应崩溃
  // -----------------------------------------------------------------------
  describe('边界：空 graph.json', () => {
    it('无边的 graph.json 应正常处理，totalEdges=0', async () => {
      const emptyGraph = {
        directed: true,
        multigraph: false,
        graph: { name: 'spectra-knowledge-graph', generatedAt: '2026-04-19T00:00:00.000Z', nodeCount: 0, edgeCount: 0, sources: [], schemaVersion: '1.0' },
        nodes: [],
        links: [],
      };
      const graphPath = join(tmpDir, 'empty-graph.json');
      writeFileSync(graphPath, JSON.stringify(emptyGraph), 'utf-8');

      const cap = captureConsole();
      try {
        await runDirectionAuditCommand(makeCmd({
          directionAuditGraph: graphPath,
          directionAuditFormat: 'json',
        }));
      } finally {
        cap.restore();
      }

      expect(process.exitCode).not.toBe(1);
      const rawJson = cap.logs.join('\n');
      const jsonStart = rawJson.indexOf('{');
      const report = JSON.parse(rawJson.slice(jsonStart)) as { totalEdges: number };
      expect(report.totalEdges).toBe(0);
    });
  });
});
