/**
 * Feature 144: E2E Fixture 测试基础设施
 *
 * 不调真实 LLM，用 vi.mock('@anthropic-ai/sdk') 模块级拦截，
 * 完整运行 Spectra batch pipeline，断言 graph.json 等产物的结构和字段。
 *
 * 解决 M-101 Postmortem L6 教训：Mock-only 单测发现不了真实 pipeline bug。
 *
 * Codex 审查修复（2026-04-29）：
 * - vi.hoisted() 解决 MOCK_SPEC_MARKDOWN 的 hoisting 问题
 * - mkdtempSync 解决 Date.now() 并行竞态问题
 * - runBatch() 移到 beforeAll，消除 SC-003/004/005 对 SC-002 的隐式顺序依赖
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join, isAbsolute } from 'path';
import { tmpdir } from 'os';

// ─── vi.hoisted：所有需要在 mock factory 内使用的变量必须通过 hoisted 定义 ───
// 直接在 mock factory 中引用顶层 const 会因 vi.mock hoisting 导致求值顺序问题。
const mocks = vi.hoisted(() => {
  const mockSpecMarkdown = `
## 1. 意图

E2E fixture mock 模块，用于验证 Spectra batch pipeline 的产物结构。

## 2. 业务逻辑

包含基础数学计算逻辑：距离计算、归一化、质心计算。

## 3. 接口定义

| 名称 | 类型 | 签名 |
|------|------|------|
| distance | function | (a: Point, b: Point) => number |
| normalize | function | (values: number[]) => number[] |
| centroid | function | (points: Point[]) => Point |

## 4. 数据结构

Point 接口：{ x: number; y: number }

## 5. 约束条件

- 输入数组不为 null/undefined
- Point 坐标为有限数值

## 6. 边界条件

- 空数组：normalize([]) 返回 []；centroid([]) 返回 { x: 0, y: 0 }
- 所有值相等：normalize 返回全零数组

## 7. 技术债务

无已知技术债务。

## 8. 测试覆盖

基础函数已有单元测试覆盖。

## 9. 依赖关系

- index.ts 依赖 utils.ts（import distance, normalize）
- 零外部依赖
`.trim();

  const mockCreate = vi.fn().mockResolvedValue({
    id: 'msg_e2e_mock',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: mockSpecMarkdown }],
    model: 'claude-sonnet-4-6-20261001',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });

  return { mockCreate };
});

// ─── LLM Mock（hoisting 要求：必须在模块顶层声明）───────────────────────────
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
  Anthropic: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
}));

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

const FIXTURE_DIR = new URL('../fixtures/e2e/small-ts-project', import.meta.url).pathname;

// mkdtempSync 产生系统唯一临时目录，解决 Date.now() 并行竞态（Codex WARNING-2）
let TMP_OUTPUT_DIR: string;

// runBatch 结果共享给所有 SC 断言（消除 SC-003/004/005 对 SC-002 的隐式顺序依赖）
let batchResult: Awaited<ReturnType<typeof import('../../src/batch/batch-orchestrator.js').runBatch>>;

describe('Spectra batch pipeline E2E（fixture-based）', () => {
  beforeAll(async () => {
    // SC-001 前置：设置假 API Key，确保 llm-client 走 SDK 路径而非 CLI proxy
    process.env['ANTHROPIC_API_KEY'] = 'test-key-e2e-fixture';

    // bootstrapAdapters() 注册 TS/JS 等语言适配器（CLI 正常入口自动调用，测试中需手动调用）
    // 幂等：已注册时直接 return，多次调用不重复注册
    const { bootstrapAdapters } = await import('../../src/adapters/index.js');
    bootstrapAdapters();

    // 提前断言 fixture 目录存在（失败时给出明确错误，不产生误报 pass）
    expect(existsSync(FIXTURE_DIR), `fixture 目录不存在: ${FIXTURE_DIR}`).toBe(true);
    expect(existsSync(join(FIXTURE_DIR, 'src', 'index.ts')), 'fixture index.ts 不存在').toBe(true);
    expect(existsSync(join(FIXTURE_DIR, 'src', 'utils.ts')), 'fixture utils.ts 不存在').toBe(true);

    // 创建系统级唯一临时输出目录，避免 Date.now() 并行竞态（Codex WARNING-2）
    TMP_OUTPUT_DIR = mkdtempSync(join(tmpdir(), 'spectra-e2e-'));

    // 防御性断言：确认 outputDir 不在仓库内（防止意外写入主仓库）
    expect(isAbsolute(TMP_OUTPUT_DIR)).toBe(true);
    expect(TMP_OUTPUT_DIR).toContain(tmpdir());

    // 在 beforeAll 中运行 pipeline，SC-002/003/004/005 共享结果
    // 消除各 SC 间隐式顺序依赖（Codex WARNING-4）
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    batchResult = await runBatch(FIXTURE_DIR, {
      outputDir: TMP_OUTPUT_DIR,
      enableDebtIntelligence: false, // 关闭 debt pipeline，简化 mock 范围
      generateHtml: false,           // 关闭 HTML 生成，减少副作用
      enableAdr: false,              // ADR 在 v4.x 默认关闭
      progressMode: 'silent',        // 抑制控制台进度输出
    });
  }, 60_000);

  afterAll(() => {
    // 清理 env，避免污染同 worker 中的其他测试
    delete process.env['ANTHROPIC_API_KEY'];

    // 清理临时输出目录
    if (TMP_OUTPUT_DIR && existsSync(TMP_OUTPUT_DIR)) {
      rmSync(TMP_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it('SC-002: pipeline 完整执行不 crash', () => {
    // batchResult 在 beforeAll 中已产出，此处只做断言
    expect(batchResult).toBeDefined();
    expect(typeof batchResult.totalModules).toBe('number');
    expect(Array.isArray(batchResult.successful)).toBe(true);
    expect(Array.isArray(batchResult.failed)).toBe(true);

    // 额外验证 mockCreate 被实际调用（确保 mock 拦截生效，而非降级路径）
    expect(mocks.mockCreate).toHaveBeenCalled();
  });

  it('SC-003: graph.json 顶层结构符合合约', () => {
    const graphJsonPath = join(TMP_OUTPUT_DIR, '_meta', 'graph.json');
    expect(existsSync(graphJsonPath), `graph.json 不存在于: ${graphJsonPath}`).toBe(true);

    const raw = readFileSync(graphJsonPath, 'utf-8');
    const graph = JSON.parse(raw) as Record<string, unknown>;

    // 顶层必有 graph / nodes / links
    expect(graph).toHaveProperty('graph');
    expect(graph).toHaveProperty('nodes');
    expect(graph).toHaveProperty('links');

    // graph meta 必有 schemaVersion 和 nodeCount
    const meta = graph['graph'] as Record<string, unknown>;
    expect(meta).toHaveProperty('schemaVersion');
    expect(typeof meta['schemaVersion']).toBe('string');
    expect(meta).toHaveProperty('nodeCount');
    expect(typeof meta['nodeCount']).toBe('number');

    // nodes / links 必须是数组
    expect(Array.isArray(graph['nodes'])).toBe(true);
    expect(Array.isArray(graph['links'])).toBe(true);
  });

  it('SC-004: 每个 node 必有 id / kind / label / metadata 字段', () => {
    const graphJsonPath = join(TMP_OUTPUT_DIR, '_meta', 'graph.json');
    const raw = readFileSync(graphJsonPath, 'utf-8');
    const graph = JSON.parse(raw) as { nodes: Record<string, unknown>[] };

    // 至少有 1 个节点（防止 fixture 过于简单导致空图）
    expect(graph.nodes.length).toBeGreaterThan(0);

    for (const node of graph.nodes) {
      expect(node, `node 缺少必要字段: ${JSON.stringify(node)}`).toMatchObject({
        id: expect.any(String),
        kind: expect.any(String),
        label: expect.any(String),
        metadata: expect.any(Object),
      });
      // id 必须是非空字符串
      expect((node['id'] as string).length).toBeGreaterThan(0);
    }
  });

  it('SC-005: nodeCount 与 nodes.length 一致', () => {
    const graphJsonPath = join(TMP_OUTPUT_DIR, '_meta', 'graph.json');
    const raw = readFileSync(graphJsonPath, 'utf-8');
    const graph = JSON.parse(raw) as {
      graph: { nodeCount: number };
      nodes: unknown[];
    };

    expect(graph.graph.nodeCount).toBe(graph.nodes.length);
  });
});
