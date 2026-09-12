/**
 * F280 对抗复审修补（C-1 / W-1 / W-2）：panoramic-query(natural-language) 的 honesty 接线合同。
 *
 * 真实链路：server.ts handler → panoramic/query.ts → qa/index.ts → engine-cache / graph-query / graph-retriever 全真；
 * 只 mock qa pipeline 里会触网 / 读盘的下游步骤（LLM / embedding / debt / citation / prompt）。
 *
 * 三条合同：
 *   C-1  graph-format-stale 图上，工具的成功 / 失败状态不得因 honesty 附加而改变（F266 FR-011）：
 *        QA 层既有行为是成功体 + `graph-insufficient` 文案，honesty 附加后仍须如此，不得翻成 internal-error。
 *   W-1  honesty 描述的必须是**产出答案的那份图**：LLM 调用窗口内图被重建，标注仍绑定旧图（不二次加载）。
 *   W-2  零图证据（citations 为空）时 `resolutionOmitted` 结构化在场（F266 D4：零结果什么都不说比不带 honesty 还裸）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hoistedTypes = vi.hoisted(() => ({
  FakeMcpServer: class FakeMcpServer {
    public tools: Array<{
      name: string;
      handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
    }> = [];
    constructor(_config: Record<string, unknown>) {}
    tool(name: string, _description: string, _schema: Record<string, unknown>, handler: never): void {
      this.tools.push({ name, handler });
    }
  },
}));
const llm = vi.hoisted(() => ({ beforeAnswer: null as null | (() => void) }));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: hoistedTypes.FakeMcpServer }));
vi.mock('../../../src/config/project-config.js', () => ({ loadProjectConfig: vi.fn(() => ({})) }));
vi.mock('../../../src/core/single-spec-orchestrator.js', () => ({ prepareContext: vi.fn(), generateSpec: vi.fn() }));
vi.mock('../../../src/batch/batch-orchestrator.js', () => ({ runBatch: vi.fn(), buildAstGraphOnly: vi.fn() }));
vi.mock('../../../src/diff/drift-orchestrator.js', () => ({ detectDrift: vi.fn() }));
vi.mock('../../../src/panoramic/qa/llm-caller.js', () => ({
  callQnALlm: vi.fn(async () => {
    llm.beforeAnswer?.();
    return { answer: 'LLM-OK', parsedCitations: [], tokenUsage: { input: 1, output: 1, overBudget: false } };
  }),
}));
vi.mock('../../../src/panoramic/qa/rag-reranker.js', () => ({ rerankWithEmbedding: vi.fn(async () => ({ rankedChunks: [] })) }));
vi.mock('../../../src/panoramic/qa/debt-context.js', () => ({ injectDebtContext: vi.fn(async () => ({ triggered: false, citations: [] })) }));
vi.mock('../../../src/panoramic/qa/citation.js', () => ({ buildCitations: vi.fn(() => []) }));
vi.mock('../../../src/panoramic/qa/prompt-builder.js', () => ({ buildQnAPrompt: vi.fn(() => 'p') }));

import { createMcpServer } from '../../../src/mcp/server.js';
import { reloadGraph } from '../../../src/mcp/graph-tools.js';
import { clearEngineCache } from '../../../src/panoramic/qa/index.js';

type Honesty = {
  freshness?: { verdict?: { recordedSourceCommit?: unknown } };
  resolution?: unknown;
  resolutionOmitted?: { reason: string };
};
type Payload = Record<string, unknown> & { honesty?: Honesty };

function graphJson(nodes: Array<{ id: string; label: string }>, sourceCommit: string | null): string {
  return JSON.stringify({
    directed: true,
    multigraph: false,
    graph: {
      name: 'g', generatedAt: '1970-01-01T00:00:00.000Z', nodeCount: nodes.length, edgeCount: 0,
      schemaVersion: '2.0', sources: ['extraction'], skippedSources: [], sourceCommit,
    },
    nodes: nodes.map((n) => ({ id: n.id, kind: 'module', label: n.label, metadata: {} })),
    links: [],
  });
}

const roots: string[] = [];
function makeRoot(prefix: string): { root: string; graphPath: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  mkdirSync(join(root, 'specs', '_meta'), { recursive: true });
  return { root, graphPath: join(root, 'specs', '_meta', 'graph.json') };
}

function nlHandler() {
  const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
  const tool = server.tools.find((x) => x.name === 'panoramic-query');
  if (!tool) throw new Error('panoramic-query 未注册');
  return tool.handler;
}

async function ask(root: string, question: string) {
  const res = await nlHandler()({ operation: 'natural-language', projectRoot: root, question });
  return { res, payload: JSON.parse(res.content[0]!.text) as Payload };
}

// BFS 命中 ≥ 3 个节点才走到 LLM（否则 rag-only 二级降级）；label 含问题关键词
const ALPHA = [
  { id: 'src/alpha1.ts', label: 'alpha1' },
  { id: 'src/alpha2.ts', label: 'alpha2' },
  { id: 'src/alpha3.ts', label: 'alpha3' },
];

afterEach(() => {
  llm.beforeAnswer = null;
  reloadGraph();
  clearEngineCache();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('F280 panoramic-query(natural-language) honesty 接线合同', () => {
  it('C-1 · graph-format-stale 图：成功体 + graph-insufficient 文案照旧，不因 honesty 附加翻成 internal-error', async () => {
    const { root, graphPath } = makeRoot('f280-wire-stale-');
    // 绝对且不在 root 下的 module id、非 external → 旧绝对格式图 → 加载时 graph-format-stale
    writeFileSync(graphPath, graphJson([{ id: '/definitely/elsewhere/src/a.ts', label: 'a' }], 'A'), 'utf-8');
    const { res, payload } = await ask(root, 'hello');
    expect(res.isError).not.toBe(true);
    expect(payload['code']).toBeUndefined();
    expect(payload['fallbackMode']).toBe('graph-insufficient');
    // 图没能加载 → 没有可描述的图 → 不挂标注（不伪造 fresh）
    expect(payload.honesty).toBeUndefined();
  });

  it('W-2 · 零图证据（citations 为空）→ resolutionOmitted 结构化在场，freshness 照常', async () => {
    const { root, graphPath } = makeRoot('f280-wire-empty-');
    writeFileSync(graphPath, graphJson(ALPHA, 'A'), 'utf-8');
    // 关键词不命中任何节点 → BFS 0 命中 → canned 零结果（citations: []）
    const { payload } = await ask(root, 'zzz-nothing-matches');
    expect(payload['citations']).toEqual([]);
    expect(payload.honesty).toBeDefined();
    expect(payload.honesty!.freshness).toBeDefined();
    expect(payload.honesty!.resolution).toBeUndefined();
    expect(payload.honesty!.resolutionOmitted).toEqual({ reason: 'non-caller-oriented-query' });
  });

  it('W-2 · LLM 答了但未引用任何图节点（citations 为空）同样算零图证据', async () => {
    const { root, graphPath } = makeRoot('f280-wire-llm-empty-');
    writeFileSync(graphPath, graphJson(ALPHA, 'A'), 'utf-8');
    const { payload } = await ask(root, 'alpha');
    expect(String(payload['answer'])).toContain('LLM-OK');
    expect(payload['citations']).toEqual([]);
    expect(payload.honesty!.resolutionOmitted).toEqual({ reason: 'non-caller-oriented-query' });
  });

  it('W-2 · rag-only 二级降级（BFS 命中 1–2 个且精排 0 chunk）同样带 honesty + resolutionOmitted（delta 复审 W-B）', async () => {
    const { root, graphPath } = makeRoot('f280-wire-ragonly-');
    writeFileSync(graphPath, graphJson(ALPHA.slice(0, 2), 'A'), 'utf-8');
    const { payload } = await ask(root, 'alpha');
    expect(payload['fallbackMode']).toBe('rag-only');
    expect(payload['citations']).toEqual([]);
    expect(payload.honesty?.freshness).toBeDefined();
    expect(payload.honesty!.resolutionOmitted).toEqual({ reason: 'non-caller-oriented-query' });
  });

  it('W-1 · LLM 调用窗口内图被重建：honesty 仍描述产出答案的那份图（不二次加载）', async () => {
    const { root, graphPath } = makeRoot('f280-wire-race-');
    writeFileSync(graphPath, graphJson(ALPHA, 'A'), 'utf-8');
    llm.beforeAnswer = () => {
      // 答案尚未返回的窗口里重建图：多一个节点（size 变）+ sourceCommit A→B
      writeFileSync(graphPath, graphJson([...ALPHA, { id: 'src/alpha4.ts', label: 'alpha4' }], 'B'), 'utf-8');
    };
    const { payload } = await ask(root, 'alpha');
    expect(String(payload['answer'])).toContain('LLM-OK');
    expect(payload.honesty?.freshness?.verdict?.recordedSourceCommit).toBe('A');
  });

  it('缓存收敛本体：同进程重建 graph.json 后第二问落到新图', async () => {
    const { root, graphPath } = makeRoot('f280-wire-fresh-');
    writeFileSync(graphPath, graphJson(ALPHA, 'A'), 'utf-8');
    const first = await ask(root, 'alpha');
    expect(String(first.payload['answer'])).toContain('LLM-OK');
    writeFileSync(graphPath, graphJson([{ id: 'src/beta1.ts', label: 'beta1' }], 'B'), 'utf-8');
    const second = await ask(root, 'alpha');
    expect(String(second.payload['answer'])).toContain('图谱为空');
    expect(second.payload.honesty?.freshness?.verdict?.recordedSourceCommit).toBe('B');
  });
});
