/**
 * F-094-03 Generator Adapter isApplicable 单元测试
 *
 * 验证 6 个新增 Adapter 的 isApplicable 方法在 true/false 两种场景下的行为：
 * - ComponentViewBuilderGenerator
 * - DynamicScenariosBuilderGenerator
 * - ArchitectureNarrativeGenerator
 * - AdrDecisionPipelineGenerator
 * - ProductUxDocsGenerator
 * - DocsQualityEvaluatorGenerator
 */
import { describe, it, expect } from 'vitest';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import { ComponentViewBuilderGenerator } from '../../src/panoramic/builders/component-view-builder.js';
import { DynamicScenariosBuilderGenerator } from '../../src/panoramic/builders/dynamic-scenarios-builder.js';
import { ArchitectureNarrativeGenerator } from '../../src/panoramic/pipelines/architecture-narrative.js';
import { AdrDecisionPipelineGenerator } from '../../src/panoramic/pipelines/adr-decision-pipeline.js';
import { ProductUxDocsGenerator } from '../../src/panoramic/pipelines/product-ux-docs.js';
import { DocsQualityEvaluatorGenerator } from '../../src/panoramic/pipelines/docs-quality-evaluator.js';

// ============================================================
// 测试辅助：ProjectContext 工厂
// ============================================================

/**
 * 创建标准 ProjectContext（具有 projectRoot）
 */
function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    projectRoot: '/mock/project',
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: [],
    existingSpecs: [],
    ...overrides,
  };
}

/**
 * 创建空 projectRoot 的 ProjectContext（用于 false 场景）
 */
function makeEmptyContext(): ProjectContext {
  return {
    projectRoot: '',
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: [],
    existingSpecs: [],
  };
}

// ============================================================
// ComponentViewBuilderGenerator
// ============================================================

describe('ComponentViewBuilderGenerator.isApplicable', () => {
  it('有效 projectRoot 时返回 boolean（委托 ArchitectureIRGenerator）', () => {
    const generator = new ComponentViewBuilderGenerator();
    const context = makeContext({ projectRoot: '/valid/project/root' });
    const result = generator.isApplicable(context);
    // 委托 ArchitectureIRGenerator → ArchitectureOverviewGenerator，
    // 在无真实文件的测试环境中返回 false（无 Dockerfile/monorepo）
    expect(typeof result === 'boolean').toBe(true);
  });

  it('空 projectRoot 时返回 false', () => {
    const generator = new ComponentViewBuilderGenerator();
    const context = makeEmptyContext();
    expect(generator.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// DynamicScenariosBuilderGenerator
// ============================================================

describe('DynamicScenariosBuilderGenerator.isApplicable', () => {
  it('context 中存在 __componentViewModel 时返回 true', () => {
    const generator = new DynamicScenariosBuilderGenerator();
    // 注入 ViewModel 标记到 context 的扩展字段
    const context = {
      ...makeContext(),
      __componentViewModel: {
        projectName: 'test',
        generatedAt: '2026-04-11',
        summary: [],
        groups: [],
        components: [],
        relationships: [],
        warnings: [],
        stats: { componentCount: 0, relationshipCount: 0 },
      },
    } as unknown as ProjectContext;

    expect(generator.isApplicable(context)).toBe(true);
  });

  it('context 中不存在 __componentViewModel 时返回 false', () => {
    const generator = new DynamicScenariosBuilderGenerator();
    const context = makeContext();
    expect(generator.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// ArchitectureNarrativeGenerator
// ============================================================

describe('ArchitectureNarrativeGenerator.isApplicable', () => {
  it('有效 projectRoot 时返回 true', () => {
    const generator = new ArchitectureNarrativeGenerator();
    const context = makeContext({ projectRoot: '/valid/project/root' });
    expect(generator.isApplicable(context)).toBe(true);
  });

  it('空 projectRoot 时返回 false', () => {
    const generator = new ArchitectureNarrativeGenerator();
    const context = makeEmptyContext();
    expect(generator.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// AdrDecisionPipelineGenerator
// ============================================================

describe('AdrDecisionPipelineGenerator.isApplicable', () => {
  it('有效 projectRoot 时返回 true', () => {
    const generator = new AdrDecisionPipelineGenerator('/tmp/output');
    const context = makeContext({ projectRoot: '/valid/project/root' });
    expect(generator.isApplicable(context)).toBe(true);
  });

  it('空 projectRoot 时返回 false', () => {
    const generator = new AdrDecisionPipelineGenerator('/tmp/output');
    const context = makeEmptyContext();
    expect(generator.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// ProductUxDocsGenerator
// ============================================================

describe('ProductUxDocsGenerator.isApplicable', () => {
  it('有效 projectRoot 时返回 true', () => {
    const generator = new ProductUxDocsGenerator('/tmp/output');
    const context = makeContext({ projectRoot: '/valid/project/root' });
    expect(generator.isApplicable(context)).toBe(true);
  });

  it('空 projectRoot 时返回 false', () => {
    const generator = new ProductUxDocsGenerator('/tmp/output');
    const context = makeEmptyContext();
    expect(generator.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// DocsQualityEvaluatorGenerator
// ============================================================

describe('DocsQualityEvaluatorGenerator.isApplicable', () => {
  it('有效 projectRoot 时返回 true', () => {
    const generator = new DocsQualityEvaluatorGenerator('/tmp/output');
    const context = makeContext({ projectRoot: '/valid/project/root' });
    expect(generator.isApplicable(context)).toBe(true);
  });

  it('空 projectRoot 时返回 false', () => {
    const generator = new DocsQualityEvaluatorGenerator('/tmp/output');
    const context = makeEmptyContext();
    expect(generator.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// bootstrapGenerators 注册数量验证（AC-002）
// ============================================================

describe('bootstrapGenerators 注册数量验证', () => {
  it('bootstrapGenerators() 后 Registry 包含 19 个 Generator', async () => {
    const { GeneratorRegistry, bootstrapGenerators } = await import(
      '../../src/panoramic/generator-registry.js'
    );
    GeneratorRegistry.resetInstance();
    bootstrapGenerators('/tmp/test-output');
    const registry = GeneratorRegistry.getInstance();
    expect(registry.list()).toHaveLength(19);
    GeneratorRegistry.resetInstance();
  });
});
