/**
 * Feature 195 — graph-only 零 LLM 建图路径单测
 *
 * 覆盖 SC-003：
 * - (a) 零 LLM：spy generateSpec / anchor / hyperedge 入口，断言调用次数 = 0
 * - (b) 结构一致性：graph-only 的 calls/depends-on 边 + Python 符号节点子集
 *       与「batch 同款 AST 输入」产物一致（不跑完整 batch，避免 W-003 脆性）
 * - (b2) byte 稳定：连跑两次 graph.json 逐字节相等
 * - (b3) 三语言矩阵（EC-002）：仅 Python / 仅 TS / 混合
 * - schema 不漂移（FR-004）+ portable 守卫（SC-002）+ EC-001 空图
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 零 LLM 证明（W-005：spy 调用计数，非 import 缺席——batch-orchestrator 顶层本就 import generateSpec）。
// 用 partial mock 保留模块其余真实导出，只把 LLM 入口替换为 spy。
const llmSpies = vi.hoisted(() => ({
  generateSpec: vi.fn(),
  runAnchorIntegration: vi.fn(),
  runHyperedgeIntegration: vi.fn(),
  createEmbeddingProvider: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, generateSpec: llmSpies.generateSpec };
});
vi.mock('../../src/panoramic/builders/doc-graph-builder.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    runAnchorIntegration: llmSpies.runAnchorIntegration,
    runHyperedgeIntegration: llmSpies.runHyperedgeIntegration,
  };
});
// W5（codex round-3）：覆盖 embedding provider 入口——graph-only 绝不应触发向量化
vi.mock('../../src/panoramic/anchoring/providers/factory.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, createEmbeddingProvider: llmSpies.createEmbeddingProvider };
});

// F249 T032：module-derivation 整模块 partial mock —— `buildModuleGraphForProject` 换成 spy，
// 用于证明 graph-only 链路全程不触达 moduleDerivationScan 管线（FR-006 的前提断言）。
// 必须 hoisted + 整模块 mock：graph-assembly.ts 是静态 import 该函数，事后 vi.spyOn(模块对象)
// 改不到已绑定的 import binding。
const moduleDerivationSpies = vi.hoisted(() => ({
  buildModuleGraphForProject: vi.fn(),
}));

vi.mock('../../src/knowledge-graph/module-derivation.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const real = actual['buildModuleGraphForProject'] as (
    ...args: unknown[]
  ) => Promise<unknown>;
  // 委托真实实现：本测试要的是"有没有被调用"，不是"调用后返回什么"——
  // 换成 stub 会让其他用例（若将来触达该路径）静默拿到假图。
  moduleDerivationSpies.buildModuleGraphForProject.mockImplementation((...args: unknown[]) =>
    real(...args),
  );
  return { ...actual, buildModuleGraphForProject: moduleDerivationSpies.buildModuleGraphForProject };
});

import { buildAstGraphOnly } from '../../src/batch/batch-orchestrator.js';
import { resolveSourceCommit } from '../../src/panoramic/graph/source-commit.js';
import {
  computeCollectorFingerprint,
  isValidCollectorFingerprint,
} from '../../src/panoramic/graph/collector-fingerprint.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

const tmpDirs: string[] = [];

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f195-graph-only-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  return dir;
}

function readGraph(dir: string): GraphJSON {
  const graphPath = path.join(dir, 'specs', '_meta', 'graph.json');
  return JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;
}

const JAVA_FIXTURE: Record<string, string> = {
  'src/main/java/com/acme/Widget.java':
    'package com.acme;\n\npublic class Widget {\n    public String name() {\n        return "widget";\n    }\n}\n',
};
const GO_FIXTURE: Record<string, string> = {
  'server.go':
    'package server\n\nfunc NewServer() *Server {\n\treturn &Server{}\n}\n\ntype Server struct {}\n',
};

const TS_FIXTURE: Record<string, string> = {
  'src/a.ts': 'export function foo(): number {\n  return 1;\n}\n',
  'src/b.ts':
    "import { foo } from './a.js';\n\nexport function bar(): number {\n  return foo() + 1;\n}\n",
};
const PY_FIXTURE: Record<string, string> = {
  'a.py': 'def foo():\n    return 1\n',
  'b.py': 'from a import foo\n\n\ndef bar():\n    return foo() + 1\n',
};

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildAstGraphOnly — 零 LLM（SC-003a）', () => {
  it('不调用 generateSpec / anchor / hyperedge 任何 LLM 入口', async () => {
    const dir = makeProject({ ...TS_FIXTURE, ...PY_FIXTURE });
    const result = await buildAstGraphOnly(dir);

    expect(llmSpies.generateSpec).toHaveBeenCalledTimes(0);
    expect(llmSpies.runAnchorIntegration).toHaveBeenCalledTimes(0);
    expect(llmSpies.runHyperedgeIntegration).toHaveBeenCalledTimes(0);
    expect(llmSpies.createEmbeddingProvider).toHaveBeenCalledTimes(0);
    expect(fs.existsSync(result.graphPath)).toBe(true);
  });
});

describe('buildAstGraphOnly — schema 不漂移（FR-004）', () => {
  it('产出合法 GraphJSON：directed/multigraph/name/schemaVersion/nodes/links/sources', async () => {
    const dir = makeProject(TS_FIXTURE);
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(graph.directed).toBe(false);
    expect(graph.multigraph).toBe(false);
    expect(graph.graph.name).toBe('spectra-knowledge-graph');
    expect(['1.0', '2.0']).toContain(graph.graph.schemaVersion);
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.links)).toBe(true);
    // unified-graph 数据源应被使用（calls + depends-on 的来源）
    expect(graph.graph.sources).toContain('unified-graph');
    // graph.nodeCount/edgeCount 与数组长度一致
    expect(graph.graph.nodeCount).toBe(graph.nodes.length);
    expect(graph.graph.edgeCount).toBe(graph.links.length);
  });

  it('返回 GraphOnlyResult 统计与产物一致', async () => {
    const dir = makeProject(TS_FIXTURE);
    const result = await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(result.nodeCount).toBe(graph.nodes.length);
    expect(result.edgeCount).toBe(graph.links.length);
    expect(result.callEdgeCount).toBe(
      graph.links.filter((e) => e.relation === 'calls').length,
    );
    expect(result.dependsOnEdgeCount).toBe(
      graph.links.filter((e) => e.relation === 'depends-on').length,
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('buildAstGraphOnly — portable 守卫（SC-002）', () => {
  it('graph.json 无绝对路径节点（绝对路径节点数 = 0）', async () => {
    const dir = makeProject({ ...TS_FIXTURE, ...PY_FIXTURE });
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    const absoluteIds = graph.nodes.filter(
      (n) => n.id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(n.id) || n.id.includes(os.tmpdir()),
    );
    expect(absoluteIds).toHaveLength(0);
  });
});

describe('buildAstGraphOnly — byte 稳定（SC-003 b2 / NFR-002）', () => {
  it('同一 fixture 连跑两次 graph.json 逐字节相等', async () => {
    const dir = makeProject({ ...TS_FIXTURE, ...PY_FIXTURE });
    await buildAstGraphOnly(dir);
    const first = fs.readFileSync(path.join(dir, 'specs', '_meta', 'graph.json'));
    await buildAstGraphOnly(dir);
    const second = fs.readFileSync(path.join(dir, 'specs', '_meta', 'graph.json'));
    expect(second.equals(first)).toBe(true);
  });
});

describe('buildAstGraphOnly — 三语言矩阵（EC-002）', () => {
  it('仅 TS：含 TS 节点 + depends-on 边，无 Python 符号', async () => {
    const dir = makeProject(TS_FIXTURE);
    const result = await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(graph.nodes.some((n) => n.id.endsWith('.ts'))).toBe(true);
    // import { foo } from './a.js' → b 依赖 a（W6：断言具体方向，非仅 count>0）
    expect(result.dependsOnEdgeCount).toBeGreaterThan(0);
    const bToA = graph.links.some(
      (e) =>
        e.relation === 'depends-on' &&
        e.source.includes('b.ts') &&
        e.target.includes('a.ts'),
    );
    expect(bToA).toBe(true);
    expect(result.pythonSymbolCount).toBe(0);
    expect(graph.nodes.some((n) => n.id.endsWith('.py'))).toBe(false);
  });

  it('仅 Python：含 Python 符号节点，无 TS 节点', async () => {
    const dir = makeProject(PY_FIXTURE);
    const result = await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(result.pythonSymbolCount).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.id.includes('.py'))).toBe(true);
    expect(graph.nodes.some((n) => n.id.endsWith('.ts'))).toBe(false);
  });

  it('混合：同时含 TS 与 Python 节点', async () => {
    const dir = makeProject({ ...TS_FIXTURE, ...PY_FIXTURE });
    const result = await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(graph.nodes.some((n) => n.id.endsWith('.ts'))).toBe(true);
    expect(graph.nodes.some((n) => n.id.includes('.py'))).toBe(true);
    expect(result.pythonSymbolCount).toBeGreaterThan(0);
  });
});

describe('buildAstGraphOnly — F217 T029: generic collector 接入 + sourceCommit 注入', () => {
  it('接入 collectGenericLanguageCodeSkeletons：Java/Go 节点进入 graph-only 产物', async () => {
    const dir = makeProject({ ...JAVA_FIXTURE, ...GO_FIXTURE });
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(graph.nodes.some((n) => n.id.endsWith('Widget.java'))).toBe(true);
    expect(graph.nodes.some((n) => n.id.endsWith('server.go'))).toBe(true);
    // Java class 顶层符号节点也应进入图（module→symbol contains 边语言无关派生）
    expect(graph.nodes.some((n) => n.id.endsWith('Widget.java::Widget'))).toBe(true);
  });

  it('写盘前注入 graphJson.graph.sourceCommit = resolveSourceCommit(resolvedRoot)', async () => {
    // makeProject 产出的临时目录非 git 仓库 → resolveSourceCommit 应为 null
    const dir = makeProject(TS_FIXTURE);
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(graph.graph.sourceCommit).toBe(resolveSourceCommit(dir));
    expect(graph.graph.sourceCommit).toBeNull();
  });
});

// ============================================================
// F249 T031/T032 — graph-only 写入路径的 collector fingerprint（SC-011/SC-013）
// ============================================================

describe('buildAstGraphOnly — F249: collector fingerprint 写入（SC-011/SC-013）', () => {
  it('SC-011：graph-only 产出图 100% 含合法 fingerprint（isValidCollectorFingerprint=true）', async () => {
    const dir = makeProject({ ...TS_FIXTURE, ...PY_FIXTURE });
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(graph.graph.fingerprint).toBeDefined();
    expect(graph.graph.fingerprint).not.toBeNull();
    expect(isValidCollectorFingerprint(graph.graph.fingerprint)).toBe(true);
  });

  it('SC-013：写入图的指纹与公共导出 computeCollectorFingerprint() 序列化后 byte-identical', async () => {
    const dir = makeProject(TS_FIXTURE);
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    // byte-identical 而非仅"语义相等"：直连 API 与内部写入路径必须产出同一份字节
    expect(JSON.stringify(graph.graph.fingerprint)).toBe(
      JSON.stringify(computeCollectorFingerprint()),
    );
  });

  it('空图（无可解析源码）同样写入合法 fingerprint（指纹描述采集器，与图内容多少无关）', async () => {
    const dir = makeProject({ 'README.md': '# empty\n' });
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(isValidCollectorFingerprint(graph.graph.fingerprint)).toBe(true);
  });

  // ── T032：FR-006 前提锁定 ──

  it('T032 前置：spy 确实拦截到了 buildModuleGraphForProject（否则"零调用"断言是空转的）', async () => {
    // "断言某函数没被调用"最典型的假绿是 mock 根本没生效（spy 永远 0 次，测试永远绿）。
    // 先证明 spy 在同一 module specifier 上是活的，零调用断言才有意义。
    const { buildModuleGraphForProject } = await import(
      '../../src/knowledge-graph/module-derivation.js'
    );
    const dir = makeProject(TS_FIXTURE);
    moduleDerivationSpies.buildModuleGraphForProject.mockClear();

    await buildModuleGraphForProject(dir);

    expect(moduleDerivationSpies.buildModuleGraphForProject).toHaveBeenCalledTimes(1);
  });

  it('FR-006：buildAstGraphOnly 全程不调用 buildModuleGraphForProject（moduleDerivationScan 仅 full batch 消费）', async () => {
    // 该前提是 SC-002/SC-005 护栏盲区判定的基础：graph-only 不执行 module 派生扫描，
    // 因此 a-track 重建对比永远抓不到 #7/#8 管线的行为漂移（护栏必须双轨）。
    // 若哪天 graph-only 悄悄接入了该管线，本断言先红，而不是让盲区判定悄悄失去依据。
    const dir = makeProject({ ...TS_FIXTURE, ...PY_FIXTURE });
    moduleDerivationSpies.buildModuleGraphForProject.mockClear();

    await buildAstGraphOnly(dir);

    expect(moduleDerivationSpies.buildModuleGraphForProject).toHaveBeenCalledTimes(0);
  });
});

describe('buildAstGraphOnly — EC-001 空目录', () => {
  it('无可解析源码 → 产出合法空图，不抛错', async () => {
    const dir = makeProject({ 'README.md': '# empty\n' });
    const result = await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    expect(result.nodeCount).toBe(0);
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
    expect(fs.existsSync(result.graphPath)).toBe(true);
  });
});

describe('buildAstGraphOnly — 结构一致性（SC-003b）', () => {
  it('graph-only 的 calls/depends-on 边集与「同款 AST 输入」直接建图一致', async () => {
    // 不跑完整 batch（W-003：community degree / anchor 边等会使深比较脆）。
    // 改为用 batch 构建 unifiedGraph 的同款 primitives 直接重建期望子集，
    // 证明 graph-only 忠实反映 batch 会注入的 unifiedGraph，且 schema 一致。
    const dir = makeProject({ ...TS_FIXTURE, ...PY_FIXTURE });
    await buildAstGraphOnly(dir);
    const graph = readGraph(dir);

    const { collectPythonCodeSkeletons, collectTsJsCodeSkeletons } = await import(
      '../../src/batch/batch-orchestrator.js'
    );
    const { buildUnifiedGraph } = await import('../../src/knowledge-graph/index.js');
    const { buildKnowledgeGraph } = await import('../../src/panoramic/graph/index.js');
    const { PythonLanguageAdapter } = await import('../../src/adapters/python-adapter.js');

    const py = await collectPythonCodeSkeletons(dir);
    const tsjs = await collectTsJsCodeSkeletons(dir, { extractCallSites: true });
    const skeletons = new Map([...py, ...tsjs]);
    const unifiedGraph = buildUnifiedGraph({ projectRoot: dir, codeSkeletons: skeletons });
    const pySymbols = await new PythonLanguageAdapter().extractSymbolNodes(dir);
    const expected = buildKnowledgeGraph({
      unifiedGraph,
      extractionResults: pySymbols,
    });

    const tuples = (g: GraphJSON, rel: string) =>
      new Set(
        g.links
          .filter((e) => e.relation === rel)
          .map((e) => `${e.source}${e.target}`),
      );

    expect(tuples(graph, 'calls')).toEqual(tuples(expected, 'calls'));
    expect(tuples(graph, 'depends-on')).toEqual(tuples(expected, 'depends-on'));

    // Python 符号 component 节点子集一致
    const componentIds = (g: GraphJSON) =>
      new Set(g.nodes.filter((n) => n.kind === 'component').map((n) => n.id));
    expect(componentIds(graph)).toEqual(componentIds(expected));

    // W4 缓解：除「与重建一致」外，再 pin 具体期望拓扑，降低循环论证成分——
    // TS 端 b 依赖 a、Python 端 b 依赖 a 的边必须真实存在。
    expect(
      graph.links.some(
        (e) => e.relation === 'depends-on' && e.source.includes('b.ts') && e.target.includes('a.ts'),
      ),
    ).toBe(true);
    expect(
      graph.links.some(
        (e) => e.relation === 'depends-on' && e.source.includes('b.py') && e.target.includes('a.py'),
      ),
    ).toBe(true);
  });
});
