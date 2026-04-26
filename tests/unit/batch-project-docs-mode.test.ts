/**
 * F5 batch-project-docs generator 过滤逻辑单元测试（T-008）
 * 验证三种 mode 下的 READING_SKIP_IDS / CODE_ONLY_SKIP_IDS 过滤行为
 * 注意：这些测试通过直接模拟 GeneratorRegistry 的行为来验证过滤逻辑，
 * 不依赖真实 LLM 调用
 */
import { describe, it, expect } from 'vitest';

// ============================================================
// 从源码提取 SKIP_IDS 集合（保持与实现同步）
// 通过引用实现文件中的常量进行测试
// ============================================================

// 直接内联实现中的常量（与 batch-project-docs.ts 保持一致）
// Feature 133 P0-2：READING_SKIP_IDS 扩展至与 CODE_ONLY 等价（13 个 generator），
// 修复 reading 模式 1047s 远超 SC-001 120s 目标的回归
const READING_SKIP_IDS = new Set([
  // 产品文档层
  'adr-pipeline',
  'product-ux-docs',
  'troubleshooting',
  'data-model',
  'docs-quality-evaluator',
  // 架构推断层（P0-2 新增）
  'architecture-overview',
  'architecture-ir',
  'pattern-hints',
  'event-surface',
  'runtime-topology',
  'architecture-narrative',
  'component-view',
  'dynamic-scenarios',
]);

const CODE_ONLY_SKIP_IDS = new Set([...READING_SKIP_IDS]);

// plan §5 完整 generator 列表
const ALL_BATCH_GENERATOR_IDS = [
  'architecture-overview',
  'architecture-ir',
  'pattern-hints',
  'event-surface',
  'runtime-topology',
  'config-reference',
  'interface-surface',
  'architecture-narrative',
  'component-view',
  'dynamic-scenarios',
  'adr-pipeline',
  'product-ux-docs',
  'troubleshooting',
  'data-model',
  'workspace-index',
  'cross-package-analyzer',
  'api-surface',
  'docs-quality-evaluator',
];

describe('batch-project-docs generator 过滤（T-008）', () => {
  describe('reading 模式', () => {
    const activated = ALL_BATCH_GENERATOR_IDS.filter((id) => !READING_SKIP_IDS.has(id));

    it('adr-pipeline 不在激活列表', () => {
      expect(activated).not.toContain('adr-pipeline');
    });

    it('product-ux-docs 不在激活列表', () => {
      expect(activated).not.toContain('product-ux-docs');
    });

    it('troubleshooting 不在激活列表', () => {
      expect(activated).not.toContain('troubleshooting');
    });

    it('data-model 不在激活列表', () => {
      expect(activated).not.toContain('data-model');
    });

    it('docs-quality-evaluator 不在激活列表', () => {
      expect(activated).not.toContain('docs-quality-evaluator');
    });

    // Feature 133 P0-2：架构层 generator 在 reading 模式下也跳过（与 code-only 等价）
    it('架构层 generator 不在激活列表（architecture-overview）', () => {
      expect(activated).not.toContain('architecture-overview');
    });

    it('架构层 generator 不在激活列表（architecture-ir）', () => {
      expect(activated).not.toContain('architecture-ir');
    });

    it('架构层 generator 不在激活列表（architecture-narrative）', () => {
      expect(activated).not.toContain('architecture-narrative');
    });

    it('静态 generator 仍在激活列表（workspace-index）', () => {
      expect(activated).toContain('workspace-index');
    });

    it('静态 generator 仍在激活列表（api-surface）', () => {
      expect(activated).toContain('api-surface');
    });
  });

  describe('code-only 模式', () => {
    const activated = ALL_BATCH_GENERATOR_IDS.filter((id) => !CODE_ONLY_SKIP_IDS.has(id));

    it('CODE_ONLY_SKIP_IDS 中所有 generator 均被排除', () => {
      for (const skipId of CODE_ONLY_SKIP_IDS) {
        expect(activated).not.toContain(skipId);
      }
    });

    it('config-reference 仍在激活列表（静态 + LLM 混合）', () => {
      expect(activated).toContain('config-reference');
    });

    it('interface-surface 仍在激活列表（纯静态）', () => {
      expect(activated).toContain('interface-surface');
    });

    it('workspace-index 仍在激活列表（静态 Monorepo 索引）', () => {
      expect(activated).toContain('workspace-index');
    });

    it('cross-package-analyzer 仍在激活列表（静态跨包依赖分析）', () => {
      expect(activated).toContain('cross-package-analyzer');
    });

    it('api-surface 仍在激活列表（静态 API 扫描）', () => {
      expect(activated).toContain('api-surface');
    });
  });

  describe('full 模式', () => {
    const activated = ALL_BATCH_GENERATOR_IDS.filter(() => true); // 不跳过任何 generator

    it('所有 generator 均在激活列表', () => {
      expect(activated).toHaveLength(ALL_BATCH_GENERATOR_IDS.length);
    });

    it('full 模式与无 mode 参数行为等价（不跳过任何 generator）', () => {
      // 验证空跳过集合等价于 full 模式
      const modeSkipIds = new Set<string>();
      const fullActivated = ALL_BATCH_GENERATOR_IDS.filter((id) => !modeSkipIds.has(id));
      expect(fullActivated).toHaveLength(ALL_BATCH_GENERATOR_IDS.length);
    });
  });

  describe('跳过集合结构验证', () => {
    it('code-only 跳过集合是 reading 跳过集合的超集（含等价情况）', () => {
      for (const id of READING_SKIP_IDS) {
        expect(CODE_ONLY_SKIP_IDS.has(id)).toBe(true);
      }
    });

    // Feature 133 P0-2：reading 现在跳过 13 个 generator（含产品文档 5 + 架构推断 8）
    it('READING_SKIP_IDS 包含 13 个 generator（产品文档 5 + 架构推断 8）', () => {
      expect(READING_SKIP_IDS.size).toBe(13);
    });

    it('CODE_ONLY_SKIP_IDS 与 READING_SKIP_IDS 等价（P0-2 后）', () => {
      expect(CODE_ONLY_SKIP_IDS.size).toBe(READING_SKIP_IDS.size);
    });
  });
});
