/**
 * schema v2.0 类型 + golden-master fixture 单元测试
 * 覆盖 graph-types.ts 的 v1.0/v2.0 双版本兼容性、evidence 字段、hyperedges 结构校验
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  GraphJSON,
  Hyperedge,
  GraphEdge,
} from '../../src/panoramic/graph/graph-types.js';
import { SEMANTIC_EDGE_RELATIONS } from '../../src/panoramic/graph/graph-types.js';

// 项目根目录（worktree 根）
const ROOT = join(fileURLToPath(import.meta.url), '../../..');

// ============================================================
// 辅助函数
// ============================================================

/** 读取并解析 fixture JSON 文件 */
function loadFixture(name: string): GraphJSON {
  const raw = readFileSync(join(ROOT, 'tests/fixtures', name), 'utf-8');
  return JSON.parse(raw) as GraphJSON;
}

// ============================================================
// 测试用例 1：v1.0 fixture 可赋值给 GraphJSON 类型
// ============================================================
describe('graph-types-v2 schema 单元测试', () => {
  describe('测试用例 1：v1.0 fixture 基础兼容性', () => {
    it('graph-v1.json 可被解析，schemaVersion 为 1.0，无 hyperedges 字段', () => {
      const graph = loadFixture('graph-v1.json');

      // schemaVersion 为 '1.0'
      expect(graph.graph.schemaVersion).toBe('1.0');

      // 基础结构完整
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.links)).toBe(true);
      expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(graph.links.length).toBeGreaterThanOrEqual(1);

      // v1.0 不含 hyperedges 字段
      expect(graph.hyperedges).toBeUndefined();

      // links 不含 evidenceText/evidenceSource
      for (const link of graph.links) {
        expect(link.evidenceText).toBeUndefined();
        expect(link.evidenceSource).toBeUndefined();
      }
    });
  });

  // ============================================================
  // 测试用例 2：v2.0 fixture 兼容性 + hyperedges 非空
  // ============================================================
  describe('测试用例 2：v2.0 fixture 兼容性', () => {
    it('graph-v2.json 可被解析，schemaVersion 为 2.0，hyperedges 非空', () => {
      const graph = loadFixture('graph-v2.json');

      // schemaVersion 为 '2.0'
      expect(graph.graph.schemaVersion).toBe('2.0');

      // hyperedges 存在且非空
      expect(graph.hyperedges).toBeDefined();
      expect(Array.isArray(graph.hyperedges)).toBe(true);
      expect((graph.hyperedges as Hyperedge[]).length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 测试用例 3：evidenceText 长度 <= 200 字符
  // ============================================================
  describe('测试用例 3：evidenceText 长度约束', () => {
    it('v2.0 fixture 中所有 evidenceText 字段长度 <= 200 字符', () => {
      const graph = loadFixture('graph-v2.json');

      for (const link of graph.links as GraphEdge[]) {
        if (link.evidenceText !== undefined) {
          expect(link.evidenceText.length).toBeLessThanOrEqual(200);
        }
      }
    });
  });

  // ============================================================
  // 测试用例 4：hyperedge 结构合规验证
  // ============================================================
  describe('测试用例 4：hyperedge 结构合规验证', () => {
    it('v2.0 fixture 中 hyperedge label <= 8 字符，nodes >= 3，rationale 非空', () => {
      const graph = loadFixture('graph-v2.json');
      const hyperedges = graph.hyperedges as Hyperedge[];

      for (const he of hyperedges) {
        // label <= 8 Unicode 字符
        const labelLen = [...he.label].length;
        expect(labelLen).toBeLessThanOrEqual(8);

        // nodes >= 3
        expect(he.nodes.length).toBeGreaterThanOrEqual(3);

        // rationale 非空
        expect(he.rationale.length).toBeGreaterThan(0);

        // confidence 是合法枚举值
        expect(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']).toContain(he.confidence);

        // id 非空
        expect(he.id.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // 测试用例 5：schemaVersion 联合类型编译期验证
  // ============================================================
  describe('测试用例 5：schemaVersion 联合类型兼容性', () => {
    it("'1.0' 和 '2.0' 均可赋值给 GraphJSON 的 schemaVersion 字段", () => {
      // 编译期验证：TypeScript 应接受两种字面量
      const v1Schema = '1.0' as GraphJSON['graph']['schemaVersion'];
      const v2Schema = '2.0' as GraphJSON['graph']['schemaVersion'];

      expect(v1Schema).toBe('1.0');
      expect(v2Schema).toBe('2.0');

      // 运行时验证：两个 fixture 均可赋值
      const graphV1 = loadFixture('graph-v1.json');
      const graphV2 = loadFixture('graph-v2.json');

      // 类型系统允许 '1.0' → 联合类型兼容
      const version1: '1.0' | '2.0' = graphV1.graph.schemaVersion;
      const version2: '1.0' | '2.0' = graphV2.graph.schemaVersion;
      expect(['1.0', '2.0']).toContain(version1);
      expect(['1.0', '2.0']).toContain(version2);
    });
  });

  // ============================================================
  // 额外验证：SEMANTIC_EDGE_RELATIONS 注册表可从模块导入
  // ============================================================
  describe('SEMANTIC_EDGE_RELATIONS 注册表导出验证', () => {
    it('SEMANTIC_EDGE_RELATIONS 包含三个正确的语义边类型键', () => {
      expect(SEMANTIC_EDGE_RELATIONS.REFERENCES).toBe('references');
      expect(SEMANTIC_EDGE_RELATIONS.CONCEPTUALLY_RELATED_TO).toBe('conceptually_related_to');
      expect(SEMANTIC_EDGE_RELATIONS.RATIONALE_FOR).toBe('rationale_for');
    });

    it('v2.0 fixture 中包含已注册的语义边类型', () => {
      const graph = loadFixture('graph-v2.json');
      const semanticRelations = new Set(Object.values(SEMANTIC_EDGE_RELATIONS));

      const semanticLinks = graph.links.filter((l) => semanticRelations.has(l.relation as typeof SEMANTIC_EDGE_RELATIONS[keyof typeof SEMANTIC_EDGE_RELATIONS]));
      expect(semanticLinks.length).toBeGreaterThan(0);
    });
  });
});
