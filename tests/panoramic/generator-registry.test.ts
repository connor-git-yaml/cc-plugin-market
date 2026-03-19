/**
 * GeneratorRegistry 单元测试
 * 覆盖 7 个核心场景：注册、冲突检测、查询、列出、过滤、启用/禁用、幂等初始化
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GeneratorRegistry,
  bootstrapGenerators,
} from '../../src/panoramic/generator-registry.js';
import type { GeneratorEntry } from '../../src/panoramic/generator-registry.js';
import type { DocumentGenerator, ProjectContext } from '../../src/panoramic/interfaces.js';

// ============================================================
// 测试辅助：Mock Generator 工厂
// ============================================================

/**
 * 创建一个最小化的 Mock DocumentGenerator
 */
function createMockGenerator(
  overrides: Partial<DocumentGenerator<any, any>> & { id: string; name: string; description: string },
): DocumentGenerator<any, any> {
  return {
    isApplicable: () => true,
    extract: async () => ({}),
    generate: async () => ({}),
    render: () => '',
    ...overrides,
  };
}

/**
 * 创建最小化的 ProjectContext 用于测试
 */
function createMockContext(): ProjectContext {
  return {
    projectRoot: '/mock/project',
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: [],
    existingSpecs: [],
  };
}

// ============================================================
// 测试用例
// ============================================================

describe('GeneratorRegistry', () => {
  // 每个测试前重置单例，避免测试间污染
  beforeEach(() => {
    GeneratorRegistry.resetInstance();
  });

  // ─── Phase 3: US1 — 注册与 ID 冲突检测 ───

  describe('register() - US1: 注册与 ID 冲突检测', () => {
    it('T006: 注册 3 个不同 id 的 Generator 后，list() 返回长度为 3 且按注册顺序排列', () => {
      const registry = GeneratorRegistry.getInstance();

      const genA = createMockGenerator({ id: 'gen-alpha', name: 'Alpha', description: 'Alpha generator' });
      const genB = createMockGenerator({ id: 'gen-beta', name: 'Beta', description: 'Beta generator' });
      const genC = createMockGenerator({ id: 'gen-gamma', name: 'Gamma', description: 'Gamma generator' });

      registry.register(genA);
      registry.register(genB);
      registry.register(genC);

      const entries = registry.list();
      expect(entries).toHaveLength(3);
      expect(entries[0].generator.id).toBe('gen-alpha');
      expect(entries[1].generator.id).toBe('gen-beta');
      expect(entries[2].generator.id).toBe('gen-gamma');
    });

    it('T007: 注册 id 重复的 Generator 时抛出冲突错误，Registry 中仍只保留原先实例', () => {
      const registry = GeneratorRegistry.getInstance();

      const original = createMockGenerator({ id: 'mock-readme', name: 'Original', description: 'Original gen' });
      const duplicate = createMockGenerator({ id: 'mock-readme', name: 'Duplicate', description: 'Duplicate gen' });

      registry.register(original);

      expect(() => registry.register(duplicate)).toThrowError(/冲突/);

      const entries = registry.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].generator.name).toBe('Original');
    });

    it('T008: 注册 id 不符合 kebab-case 格式时抛出格式错误，Registry 状态不变', () => {
      const registry = GeneratorRegistry.getInstance();

      // 含大写字母
      const upper = createMockGenerator({ id: 'GenUpper', name: 'Upper', description: 'Upper gen' });
      expect(() => registry.register(upper)).toThrowError(/格式错误/);

      // 含空格
      const space = createMockGenerator({ id: 'gen space', name: 'Space', description: 'Space gen' });
      expect(() => registry.register(space)).toThrowError(/格式错误/);

      // 含特殊字符
      const special = createMockGenerator({ id: 'gen_special!', name: 'Special', description: 'Special gen' });
      expect(() => registry.register(special)).toThrowError(/格式错误/);

      // 以数字开头
      const numStart = createMockGenerator({ id: '1gen', name: 'NumStart', description: 'NumStart gen' });
      expect(() => registry.register(numStart)).toThrowError(/格式错误/);

      // Registry 应该保持为空
      expect(registry.isEmpty()).toBe(true);
    });
  });

  // ─── Phase 4: US2 — 按 ID 查询与全量列出 ───

  describe('get() / list() / isEmpty() - US2: 查询与列出', () => {
    it('T012: get("data-model") 返回对应实例；get("non-existent-id") 返回 undefined', () => {
      const registry = GeneratorRegistry.getInstance();

      const genA = createMockGenerator({ id: 'mock-readme', name: 'Mock Readme', description: 'Readme gen' });
      const genB = createMockGenerator({ id: 'data-model', name: 'Data Model', description: 'Data model gen' });
      const genC = createMockGenerator({ id: 'config-ref', name: 'Config Ref', description: 'Config ref gen' });

      registry.register(genA);
      registry.register(genB);
      registry.register(genC);

      const found = registry.get('data-model');
      expect(found).toBeDefined();
      expect(found!.id).toBe('data-model');
      expect(found!.name).toBe('Data Model');

      const notFound = registry.get('non-existent-id');
      expect(notFound).toBeUndefined();
    });

    it('T013: list() 返回包含 3 个 GeneratorEntry 的数组，每个 entry 包含 generator 和 enabled 状态', () => {
      const registry = GeneratorRegistry.getInstance();

      const genA = createMockGenerator({ id: 'gen-a', name: 'A', description: 'A gen' });
      const genB = createMockGenerator({ id: 'gen-b', name: 'B', description: 'B gen' });
      const genC = createMockGenerator({ id: 'gen-c', name: 'C', description: 'C gen' });

      registry.register(genA);
      registry.register(genB);
      registry.register(genC);

      const entries = registry.list();
      expect(entries).toHaveLength(3);

      for (const entry of entries) {
        expect(entry).toHaveProperty('generator');
        expect(entry).toHaveProperty('enabled');
        expect(entry.generator).toHaveProperty('id');
        expect(typeof entry.enabled).toBe('boolean');
        expect(entry.enabled).toBe(true); // 默认启用
      }
    });

    it('T014: 空 Registry 调用 isEmpty() 返回 true，注册后返回 false；空 list() 返回空数组', () => {
      const registry = GeneratorRegistry.getInstance();

      expect(registry.isEmpty()).toBe(true);
      expect(registry.list()).toEqual([]);

      const gen = createMockGenerator({ id: 'gen-test', name: 'Test', description: 'Test gen' });
      registry.register(gen);

      expect(registry.isEmpty()).toBe(false);
    });
  });

  // ─── Phase 5: US3 — 按 ProjectContext 过滤 ───

  describe('filterByContext() - US3: 异步过滤', () => {
    it('T018: 3 个 Generator（A: true, B: false, C: Promise<true>），filterByContext 返回 [A, C]', async () => {
      const registry = GeneratorRegistry.getInstance();
      const ctx = createMockContext();

      const genA = createMockGenerator({
        id: 'gen-a',
        name: 'A',
        description: 'A gen',
        isApplicable: () => true,
      });
      const genB = createMockGenerator({
        id: 'gen-b',
        name: 'B',
        description: 'B gen',
        isApplicable: () => false,
      });
      const genC = createMockGenerator({
        id: 'gen-c',
        name: 'C',
        description: 'C gen',
        isApplicable: () => Promise.resolve(true),
      });

      registry.register(genA);
      registry.register(genB);
      registry.register(genC);

      const result = await registry.filterByContext(ctx);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('gen-a');
      expect(result[1].id).toBe('gen-c');
    });

    it('T019: isApplicable 抛出异常时，该 Generator 被跳过，不中断整体流程', async () => {
      const registry = GeneratorRegistry.getInstance();
      const ctx = createMockContext();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const genGood = createMockGenerator({
        id: 'gen-good',
        name: 'Good',
        description: 'Good gen',
        isApplicable: () => true,
      });
      const genBad = createMockGenerator({
        id: 'gen-bad',
        name: 'Bad',
        description: 'Bad gen',
        isApplicable: () => { throw new Error('boom'); },
      });
      const genAlsoGood = createMockGenerator({
        id: 'gen-also-good',
        name: 'AlsoGood',
        description: 'AlsoGood gen',
        isApplicable: () => Promise.resolve(true),
      });

      registry.register(genGood);
      registry.register(genBad);
      registry.register(genAlsoGood);

      const result = await registry.filterByContext(ctx);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('gen-good');
      expect(result[1].id).toBe('gen-also-good');

      // 验证 console.warn 被调用
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });

    it('isApplicable 返回 rejected Promise 时同样被跳过并记录警告', async () => {
      const registry = GeneratorRegistry.getInstance();
      const ctx = createMockContext();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const genGood = createMockGenerator({
        id: 'gen-good',
        name: 'Good',
        description: 'Good gen',
        isApplicable: () => true,
      });
      const genAsyncBad = createMockGenerator({
        id: 'gen-async-bad',
        name: 'AsyncBad',
        description: 'Async bad gen',
        isApplicable: () => Promise.reject(new Error('async boom')),
      });

      registry.register(genGood);
      registry.register(genAsyncBad);

      const result = await registry.filterByContext(ctx);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('gen-good');
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });

    it('禁用的 Generator 的 isApplicable 不被调用', async () => {
      const registry = GeneratorRegistry.getInstance();
      const ctx = createMockContext();

      const isApplicableSpy = vi.fn().mockReturnValue(true);
      const gen = createMockGenerator({
        id: 'gen-spy',
        name: 'Spy',
        description: 'Spy gen',
        isApplicable: isApplicableSpy,
      });

      registry.register(gen);
      registry.setEnabled('gen-spy', false);

      const result = await registry.filterByContext(ctx);
      expect(result).toHaveLength(0);
      expect(isApplicableSpy).not.toHaveBeenCalled();
    });

    it('T020: 空 Registry 调用 filterByContext 返回空数组，不抛异常', async () => {
      const registry = GeneratorRegistry.getInstance();
      const ctx = createMockContext();

      const result = await registry.filterByContext(ctx);
      expect(result).toEqual([]);
    });
  });

  // ─── Phase 6: US4 — 启用/禁用状态管理 ───

  describe('setEnabled() - US4: 启用/禁用管理', () => {
    it('T023: 新注册 Generator 默认 enabled=true；禁用后 list() 中 enabled 变为 false，filterByContext 不再包含', async () => {
      const registry = GeneratorRegistry.getInstance();
      const ctx = createMockContext();

      const gen = createMockGenerator({
        id: 'gen-toggle',
        name: 'Toggle',
        description: 'Toggle gen',
        isApplicable: () => true,
      });

      registry.register(gen);

      // 默认启用
      expect(registry.list()[0].enabled).toBe(true);
      let filtered = await registry.filterByContext(ctx);
      expect(filtered).toHaveLength(1);

      // 禁用
      registry.setEnabled('gen-toggle', false);
      expect(registry.list()[0].enabled).toBe(false);
      filtered = await registry.filterByContext(ctx);
      expect(filtered).toHaveLength(0);
    });

    it('T024: 禁用后再启用，list() 中 enabled 恢复为 true，filterByContext 重新包含', async () => {
      const registry = GeneratorRegistry.getInstance();
      const ctx = createMockContext();

      const gen = createMockGenerator({
        id: 'gen-toggle',
        name: 'Toggle',
        description: 'Toggle gen',
        isApplicable: () => true,
      });

      registry.register(gen);
      registry.setEnabled('gen-toggle', false);
      registry.setEnabled('gen-toggle', true);

      expect(registry.list()[0].enabled).toBe(true);
      const filtered = await registry.filterByContext(ctx);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('gen-toggle');
    });

    it('T025: 对不存在的 id 执行 setEnabled 抛出明确错误', () => {
      const registry = GeneratorRegistry.getInstance();

      expect(() => registry.setEnabled('non-existent', true)).toThrowError(
        "Generator 'non-existent' not found in registry",
      );
    });
  });

  // ─── Phase 7: US5 — 单例模式测试 ───

  describe('单例模式 - US5', () => {
    it('T027: 连续两次调用 getInstance() 返回同一对象引用', () => {
      const instance1 = GeneratorRegistry.getInstance();
      const instance2 = GeneratorRegistry.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('T028: 已注册多个 Generator，resetInstance() 后新实例 list() 返回空列表', () => {
      const registry = GeneratorRegistry.getInstance();

      registry.register(createMockGenerator({ id: 'gen-a', name: 'A', description: 'A gen' }));
      registry.register(createMockGenerator({ id: 'gen-b', name: 'B', description: 'B gen' }));
      expect(registry.list()).toHaveLength(2);

      GeneratorRegistry.resetInstance();

      const newRegistry = GeneratorRegistry.getInstance();
      expect(newRegistry.list()).toHaveLength(0);
      expect(newRegistry.isEmpty()).toBe(true);
    });
  });

  // ─── Phase 8: bootstrapGenerators 幂等初始化 ───

  describe('bootstrapGenerators() - 幂等初始化', () => {
    it('T029: 调用 bootstrapGenerators() 后 Registry 非空，包含 MockReadmeGenerator（id 为 "mock-readme"）', () => {
      bootstrapGenerators();

      const registry = GeneratorRegistry.getInstance();
      expect(registry.isEmpty()).toBe(false);

      const mockReadme = registry.get('mock-readme');
      expect(mockReadme).toBeDefined();
      expect(mockReadme!.id).toBe('mock-readme');
      expect(mockReadme!.name).toBe('Mock README Generator');
    });

    it('T030: 连续调用 bootstrapGenerators() 两次，Generator 数量不变，不抛异常', () => {
      bootstrapGenerators();
      const countAfterFirst = GeneratorRegistry.getInstance().list().length;

      expect(() => bootstrapGenerators()).not.toThrow();
      const countAfterSecond = GeneratorRegistry.getInstance().list().length;

      expect(countAfterFirst).toBe(countAfterSecond);
    });
  });
});
