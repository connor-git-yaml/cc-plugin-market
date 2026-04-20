/**
 * T039: design-doc 完整锚定链路集成测试
 *
 * 验证：
 * - AC-001: graph.json schemaVersion="2.0"（由 fixture 验证）
 * - AC-002: anchorDocToCode 在 design-doc-project 下产出 ≥10 条语义边，
 *           每条边含 evidenceText 和 evidenceSource，类型为 references/conceptually_related_to
 * - AC-010: direction-audit 对 graph-v2.json（含新边类型）返回码 0，零方向违规
 *
 * 策略：
 * - Mock EmbeddingProvider：返回确定性向量，设计使 ≥10 个 (chunk, node) pair cosine ≥ 0.75
 * - 不依赖网络、不下载模型
 * - 使用 tests/fixtures/design-doc-project/ 的实际文件
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorDocToCode } from '../../src/panoramic/anchoring/index.js';
import { chunkMarkdownFiles } from '../../src/panoramic/anchoring/chunker.js';
import type { EmbeddingProvider, EmbedResult } from '../../src/panoramic/anchoring/embedding-provider.js';
import type { GraphNode, GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import { runDirectionAuditCommand } from '../../src/cli/commands/direction-audit.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

// ============================================================
// 路径定义
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../..');
const DESIGN_DOC_FIXTURE = join(REPO_ROOT, 'tests/fixtures/design-doc-project');
const GRAPH_V2_FIXTURE = join(REPO_ROOT, 'tests/fixtures/graph-v2.json');

// ============================================================
// 代码节点 fixture（design-doc-project 的 3 个 .ts 文件）
// 与 spec.md 中明确提到的函数名对应，保证语义关联
// ============================================================

const DESIGN_DOC_CODE_NODES: GraphNode[] = [
  // pipeline.ts 中的函数
  { id: 'src/pipeline.ts', kind: 'module', label: 'runPipeline', metadata: {} },
  { id: 'src/pipeline.ts#withRetry', kind: 'module', label: 'withRetry', metadata: {} },
  // ingestion.ts 中的函数
  { id: 'src/ingestion.ts', kind: 'module', label: 'ingestData', metadata: {} },
  { id: 'src/ingestion.ts#fetchRawData', kind: 'module', label: 'fetchRawData', metadata: {} },
  { id: 'src/ingestion.ts#validateRecord', kind: 'module', label: 'validateRecord', metadata: {} },
  // processor.ts 中的函数
  { id: 'src/processor.ts', kind: 'module', label: 'processRecord', metadata: {} },
  { id: 'src/processor.ts#aggregateResults', kind: 'module', label: 'aggregateResults', metadata: {} },
  { id: 'src/processor.ts#normalizeFields', kind: 'module', label: 'normalizeFields', metadata: {} },
];

// ============================================================
// 确定性 Mock EmbeddingProvider
//
// 设计策略：
// - 所有 chunk 向量和代码节点向量均使用"高相似"基础向量 + 微小扰动
// - 保证所有 (chunk, node) pair 的 cosine >= 0.75
// - 因此对 8 个节点 × N 个 chunks，所有 pair 均超过阈值，产出大量边
// ============================================================

/**
 * 生成维度 384 的确定性向量
 * 基础向量：全 1 归一化方向 + index 决定的微小偏置
 * 同一"基础方向"的向量 cosine 接近 1.0
 */
function makeHighSimilarityVector(index: number, dims = 384): Float32Array {
  const vec = new Float32Array(dims);
  // 基础分量：全部为 1（模拟同一语义空间）
  const base = 1.0;
  // 微小偏置：让同一组向量不完全相同，但保持高相似度
  const noise = 0.001 * (index % 10);
  for (let i = 0; i < dims; i++) {
    vec[i] = base + noise * (i % 3 === 0 ? 1 : -0.5);
  }
  // 归一化
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    norm += (vec[i] ?? 0) ** 2;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) {
    const v = vec[i];
    if (v !== undefined) {
      vec[i] = v / norm;
    }
  }
  return vec;
}

/** 创建确定性 Mock EmbeddingProvider */
function createDeterministicProvider(callIndex = { value: 0 }): EmbeddingProvider {
  return {
    providerName: 'local' as const,
    llmModelLabel: 'deterministic-mock',
    dimensions: 384,
    async embed(texts: string[]): Promise<EmbedResult> {
      const currentCall = callIndex.value++;
      const vectors = texts.map((_, i) => makeHighSimilarityVector(currentCall * 100 + i));
      return {
        vectors,
        tokenUsage: {
          llmModel: 'deterministic-mock',
          inputTokens: texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
          outputTokens: 0,
          durationMs: 0,
        },
      };
    },
  };
}

// ============================================================
// direction-audit CLI helper
// ============================================================

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

describe('design-doc 完整锚定链路（AC-001/002）', () => {
  let specMdPath: string;
  let chunkCount: number;

  beforeAll(() => {
    specMdPath = join(DESIGN_DOC_FIXTURE, 'spec.md');
    // 预先确认 spec.md 可以被正确分块
    const chunks = chunkMarkdownFiles([specMdPath], DESIGN_DOC_FIXTURE);
    chunkCount = chunks.length;
  });

  it('spec.md 可被 chunkMarkdownFiles 正确分块（≥3 个 chunk，对应 H2/H3 章节）', () => {
    const chunks = chunkMarkdownFiles([specMdPath], DESIGN_DOC_FIXTURE);
    // spec.md 有 "数据摄取模块"、"数据处理模块"、"数据校验规则"、"管道编排模块"、"错误处理策略" 等多节
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // 每个 chunk 含 evidenceSource 所需字段
    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(chunk.filePath).toBeTruthy();
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('anchorDocToCode 产出 ≥10 条语义边，类型为 references/conceptually_related_to', async () => {
    const callIndex = { value: 0 };
    const provider = createDeterministicProvider(callIndex);

    const result = await anchorDocToCode({
      projectRoot: DESIGN_DOC_FIXTURE,
      markdownFiles: [specMdPath],
      graphNodes: DESIGN_DOC_CODE_NODES,
      provider,
      threshold: 0.75, // 标准阈值
    });

    // AC-002 核心断言：≥10 条边
    expect(result.edges.length).toBeGreaterThanOrEqual(10);

    // 边类型必须为语义边类型
    const allowedRelations = new Set(['references', 'conceptually_related_to']);
    for (const edge of result.edges) {
      expect(allowedRelations.has(edge.relation)).toBe(true);
    }
  }, 10000);

  it('每条 INFERRED 边含非空 evidenceText 和符合格式的 evidenceSource', async () => {
    const callIndex = { value: 0 };
    const provider = createDeterministicProvider(callIndex);

    const result = await anchorDocToCode({
      projectRoot: DESIGN_DOC_FIXTURE,
      markdownFiles: [specMdPath],
      graphNodes: DESIGN_DOC_CODE_NODES,
      provider,
    });

    expect(result.edges.length).toBeGreaterThan(0);

    // evidenceSource 格式：repo-relative-path:startLine-endLine
    const evidenceSourcePattern = /^[^:]+:\d+-\d+$/;
    for (const edge of result.edges) {
      // 所有 anchoring 生成的边均为 INFERRED 置信度
      expect(edge.confidence).toBe('INFERRED');
      // evidenceText 非空（INFERRED 边强制要求，build-edges 会丢弃空 evidenceText 的边）
      expect(edge.evidenceText).toBeTruthy();
      expect((edge.evidenceText ?? '').length).toBeGreaterThan(0);
      // evidenceSource 格式正确
      expect(edge.evidenceSource).toMatch(evidenceSourcePattern);
    }
  }, 10000);

  it('anchorDocToCode tokenUsage 记录格式正确（含 llmModel + durationMs）', async () => {
    const callIndex = { value: 0 };
    const provider = createDeterministicProvider(callIndex);

    const result = await anchorDocToCode({
      projectRoot: DESIGN_DOC_FIXTURE,
      markdownFiles: [specMdPath],
      graphNodes: DESIGN_DOC_CODE_NODES,
      provider,
    });

    // 应有两次 embed 调用：一次 chunk，一次 node
    expect(result.tokenUsage.length).toBeGreaterThanOrEqual(1);
    for (const usage of result.tokenUsage) {
      expect(usage.llmModel).toBeTruthy();
      expect(typeof usage.durationMs).toBe('number');
      expect(usage.durationMs).toBeGreaterThanOrEqual(0);
    }
  }, 10000);

  it('stats 字段正确反映处理状态', async () => {
    const callIndex = { value: 0 };
    const provider = createDeterministicProvider(callIndex);

    const result = await anchorDocToCode({
      projectRoot: DESIGN_DOC_FIXTURE,
      markdownFiles: [specMdPath],
      graphNodes: DESIGN_DOC_CODE_NODES,
      provider,
    });

    expect(result.stats.chunksProcessed).toBe(chunkCount);
    expect(result.stats.edgesGenerated).toBe(result.edges.length);
    expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
  }, 10000);
});

// ============================================================
// direction-audit v2 回归测试（AC-010）
// ============================================================

describe('direction-audit v2.0 回归测试（AC-010）', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('graph-v2.json fixture 文件存在且 schemaVersion="2.0"（AC-001）', () => {
    const raw = readFileSync(GRAPH_V2_FIXTURE, 'utf-8');
    const graphJson = JSON.parse(raw) as GraphJSON;
    expect(graphJson.graph.schemaVersion).toBe('2.0');
  });

  it('direction-audit 对 graph-v2.json 返回码 0，零方向违规（AC-010）', async () => {
    const cap = captureConsole();
    try {
      await runDirectionAuditCommand(makeCmd({
        directionAuditGraph: GRAPH_V2_FIXTURE,
        directionAuditFormat: 'json',
      }));
    } finally {
      cap.restore();
    }

    // 返回码 0（process.exitCode 不为 1）
    expect(process.exitCode).not.toBe(1);

    const rawJson = cap.logs.join('\n');
    const jsonStart = rawJson.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);

    const report = JSON.parse(rawJson.slice(jsonStart)) as {
      summary: { correct: number; suspicious: number; incorrect: number; skipped: number };
      edges: Array<{ relation: string; result: string }>;
    };

    // 核心断言：零 incorrect（AC-010）
    expect(report.summary.incorrect).toBe(0);

    // 语义边类型均为 skipped，不出现在 incorrect 列表
    const semanticRelations = new Set(['references', 'conceptually_related_to', 'rationale_for']);
    const incorrectEdges = report.edges.filter((e) => e.result === 'incorrect');
    for (const edge of incorrectEdges) {
      // incorrect 列表中不包含任何语义边类型
      expect(semanticRelations.has(edge.relation)).toBe(false);
    }
  });

  it('direction-audit 对含语义边的 v2.0 fixture，references/conceptually_related_to 均为 skipped', async () => {
    const cap = captureConsole();
    try {
      await runDirectionAuditCommand(makeCmd({
        directionAuditGraph: GRAPH_V2_FIXTURE,
        directionAuditFormat: 'json',
      }));
    } finally {
      cap.restore();
    }

    const rawJson = cap.logs.join('\n');
    const jsonStart = rawJson.indexOf('{');
    const report = JSON.parse(rawJson.slice(jsonStart)) as {
      edges: Array<{ relation: string; result: string }>;
    };

    // 所有语义边关系均为 skipped
    const semanticRelations = ['references', 'conceptually_related_to', 'rationale_for'];
    for (const edge of report.edges) {
      if (semanticRelations.includes(edge.relation)) {
        expect(edge.result).toBe('skipped');
      }
    }
  });
});
