/**
 * graph-persistence 端到端集成测试
 * 验收标准：AC-101-03、AC-101-05、AC-101-06、AC-101-07、AC-101-08、AC-101-09
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildKnowledgeGraph, writeKnowledgeGraph } from '../../src/panoramic/graph/index.js';
import type { DocGraph } from '../../src/panoramic/builders/doc-graph-builder.js';
import type { ArchitectureIR, ArchitectureIRElement, ArchitectureIRRelationship } from '../../src/panoramic/models/architecture-ir-model.js';

// ============================================================
// 测试辅助函数
// ============================================================

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graph-persistence-test-'));
}

/** 构建 mock DocGraph */
function makeMockDocGraph(specPaths: string[]): DocGraph {
  return {
    projectRoot: '/tmp/test-project',
    generatedAt: '2026-04-12T00:00:00.000Z',
    specs: specPaths.map((specPath) => ({
      specPath,
      sourceTarget: specPath.replace('.spec.md', '').replace('specs/', 'src/'),
      relatedFiles: [`${specPath.replace('.spec.md', '.ts')}`],
      linked: true,
      confidence: 'medium' as const,
      currentRun: true,
    })),
    sourceToSpec: [],
    references: [],
    missingSpecs: [],
    unlinkedSpecs: [],
  };
}

/** 构建 mock ArchitectureIR */
function makeMockArchitectureIR(nodeCount: number = 5): ArchitectureIR {
  const elements: ArchitectureIRElement[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: `element-${i}`,
    name: `Element ${i}`,
    kind: 'component' as const,
    description: `描述 ${i}`,
    technology: 'TypeScript',
    tags: [],
    sourceTags: ['workspace-index' as const],
    evidence: [],
    metadata: {},
  }));
  const relationships: ArchitectureIRRelationship[] = elements.slice(1).map((elem, i) => ({
    id: `rel-${i}`,
    sourceId: `element-${i}`,
    destinationId: elem.id,
    kind: 'depends-on' as const,
    description: `依赖关系 ${i}`,
    tags: [],
    sourceTags: ['workspace-index' as const],
    evidence: [],
    metadata: {},
  }));
  return {
    projectName: 'test-project',
    generatedAt: '2026-04-12T00:00:00.000Z',
    sourceTags: ['workspace-index'],
    warnings: [],
    elements,
    relationships,
    views: [],
    stats: {
      totalElements: elements.length,
      totalRelationships: relationships.length,
      totalViews: 0,
      availableViews: 0,
      totalWarnings: 0,
      sourceCount: 1,
    },
    metadata: {},
  };
}

// ============================================================
// 测试套件
// ============================================================

describe('graph-persistence — graph.json 基础字段检查（AC-101-03）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('buildKnowledgeGraph 返回值包含所有必填字段', () => {
    const ir = makeMockArchitectureIR(3);
    const result = buildKnowledgeGraph({ architectureIR: ir });

    // 基础结构检查
    expect(typeof result.directed).toBe('boolean');
    expect(result.multigraph).toBe(false);
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.links)).toBe(true);
    expect(result.graph).toBeDefined();
    expect(result.graph.schemaVersion).toBe('1.0');
    expect(typeof result.graph.generatedAt).toBe('string');
    expect(result.graph.nodeCount).toBe(result.nodes.length);
    expect(result.graph.edgeCount).toBe(result.links.length);
  });

  it('writeKnowledgeGraph 写入后文件存在且内容合法', () => {
    const docGraph = makeMockDocGraph(['specs/auth.spec.md', 'specs/api.spec.md']);
    const graphJson = buildKnowledgeGraph({ docGraph });
    const writtenPath = writeKnowledgeGraph(graphJson, tmpDir);

    // 文件存在
    expect(fs.existsSync(writtenPath)).toBe(true);

    // 内容合法 JSON
    const content = fs.readFileSync(writtenPath, 'utf-8');
    const parsed = JSON.parse(content) as typeof graphJson;

    // 必填字段校验
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.links)).toBe(true);
    expect(parsed.graph.generatedAt).toBeDefined();
    expect(parsed.graph.schemaVersion).toBe('1.0');
    expect(parsed.graph.nodeCount).toBe(parsed.nodes.length);
    expect(parsed.graph.edgeCount).toBe(parsed.links.length);
  });

  it('使用两个数据源时 sources 字段包含对应来源', () => {
    const ir = makeMockArchitectureIR(2);
    const docGraph = makeMockDocGraph(['specs/auth.spec.md']);
    const graphJson = buildKnowledgeGraph({ architectureIR: ir, docGraph });

    expect(graphJson.graph.sources).toContain('architecture-ir');
    expect(graphJson.graph.sources).toContain('doc-graph');
  });
});

describe('graph-persistence — 原子写入安全性（AC-101-05）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入后不存在 .tmp 残留文件', () => {
    const graphJson = buildKnowledgeGraph({ docGraph: makeMockDocGraph(['specs/a.spec.md']) });
    const writtenPath = writeKnowledgeGraph(graphJson, tmpDir);

    // .tmp 文件不应存在（renameSync 已覆盖）
    expect(fs.existsSync(`${writtenPath}.tmp`)).toBe(false);
    // 正式文件存在
    expect(fs.existsSync(writtenPath)).toBe(true);
  });

  it('写入路径正确为 _meta/graph.json', () => {
    const graphJson = buildKnowledgeGraph({});
    const writtenPath = writeKnowledgeGraph(graphJson, tmpDir);

    expect(writtenPath.endsWith('_meta/graph.json') || writtenPath.endsWith('_meta\\graph.json')).toBe(true);
  });
});

describe('graph-persistence — 容错降级（AC-101-07）', () => {
  it('所有数据源均为 undefined 时 buildKnowledgeGraph 不抛出', () => {
    expect(() => buildKnowledgeGraph({})).not.toThrow();
    const result = buildKnowledgeGraph({});
    expect(result.graph.schemaVersion).toBe('1.0');
  });

  it('architectureIR 为 undefined 时 skippedSources 包含 architecture-ir', () => {
    const result = buildKnowledgeGraph({ docGraph: makeMockDocGraph(['specs/a.spec.md']) });
    const skippedNames = result.graph.skippedSources?.map((s) => s.source) ?? [];
    expect(skippedNames).toContain('architecture-ir');
  });

  it('仅含 DocGraph 时仍生成有效 graph.json', () => {
    const docGraph = makeMockDocGraph(['specs/auth.spec.md', 'specs/api.spec.md']);
    const result = buildKnowledgeGraph({ docGraph });
    expect(result.nodes.length).toBe(2);
    expect(result.graph.schemaVersion).toBe('1.0');
  });
});

describe('graph-persistence — 有向图模式', () => {
  it('directed: true 时 directed 字段为 true', () => {
    const result = buildKnowledgeGraph({ directed: true });
    expect(result.directed).toBe(true);
  });

  it('directed: false（默认）时 directed 字段为 false', () => {
    const result = buildKnowledgeGraph({});
    expect(result.directed).toBe(false);
  });
});

describe('graph-persistence — inputHash 计算', () => {
  it('提供 docGraph 时 inputHash 为 16 位十六进制字符串', () => {
    const docGraph = makeMockDocGraph(['specs/auth.spec.md']);
    const result = buildKnowledgeGraph({ docGraph });

    expect(result.graph.inputHash).toBeDefined();
    expect(typeof result.graph.inputHash).toBe('string');
    expect(result.graph.inputHash!.length).toBe(16);
    // 验证为十六进制
    expect(/^[0-9a-f]{16}$/.test(result.graph.inputHash!)).toBe(true);
  });

  it('无数据源时 inputHash 为 undefined', () => {
    const result = buildKnowledgeGraph({});
    expect(result.graph.inputHash).toBeUndefined();
  });
});

describe('graph-persistence — 文件大小（AC-101-09 部分）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('500 节点规模的 graph.json 文件大小 < 5 MB', () => {
    const ir = makeMockArchitectureIR(500);
    const graphJson = buildKnowledgeGraph({ architectureIR: ir });
    const writtenPath = writeKnowledgeGraph(graphJson, tmpDir);

    const stat = fs.statSync(writtenPath);
    const sizeMB = stat.size / (1024 * 1024);
    // 500 节点规模应远小于 5 MB
    expect(sizeMB).toBeLessThan(5);
  });
});

describe('graph-persistence — NetworkX 兼容性（AC-101-03 + NFR-101-02）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('graph.json 符合 NetworkX node-link 格式', () => {
    const ir = makeMockArchitectureIR(3);
    const graphJson = buildKnowledgeGraph({ architectureIR: ir });
    const writtenPath = writeKnowledgeGraph(graphJson, tmpDir);

    const parsed = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as Record<string, unknown>;

    // NetworkX node-link 必填字段
    expect('directed' in parsed).toBe(true);
    expect('multigraph' in parsed).toBe(true);
    expect('graph' in parsed).toBe(true);
    expect('nodes' in parsed).toBe(true);
    expect('links' in parsed).toBe(true);

    // multigraph 必须为 false
    expect(parsed['multigraph']).toBe(false);

    // nodes 每个元素必须有 id 字段（NetworkX 要求）
    const nodes = parsed['nodes'] as Array<Record<string, unknown>>;
    for (const node of nodes) {
      expect(typeof node['id']).toBe('string');
    }
  });
});
