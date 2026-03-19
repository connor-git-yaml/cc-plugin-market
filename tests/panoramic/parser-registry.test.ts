/**
 * ArtifactParserRegistry 单元测试
 * 覆盖核心场景：单例、注册、冲突检测、查询、列出、按文件模式匹配、启用/禁用、幂等初始化
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ArtifactParserRegistry,
  bootstrapParsers,
} from '../../src/panoramic/parser-registry.js';
import type { ParserEntry } from '../../src/panoramic/parser-registry.js';
import { AbstractArtifactParser } from '../../src/panoramic/parsers/abstract-artifact-parser.js';

// ============================================================
// 测试辅助：Mock Parser 工厂
// ============================================================

/**
 * 创建一个最小化的 Mock ArtifactParser
 */
class MockParser extends AbstractArtifactParser<{ data: string }> {
  readonly id: string;
  readonly name: string;
  readonly filePatterns: readonly string[];

  constructor(id: string, name: string, filePatterns: string[]) {
    super();
    this.id = id;
    this.name = name;
    this.filePatterns = filePatterns;
  }

  protected doParse(_content: string, _filePath: string): { data: string } {
    return { data: 'mock' };
  }

  protected createFallback(): { data: string } {
    return { data: '' };
  }
}

// ============================================================
// 测试用例
// ============================================================

describe('ArtifactParserRegistry', () => {
  // 每个测试前重置单例，避免测试间污染
  beforeEach(() => {
    ArtifactParserRegistry.resetInstance();
  });

  // ─── 注册与 ID 冲突检测 ───

  describe('register() - 注册与 ID 冲突检测', () => {
    it('注册 3 个不同 id 的 Parser 后，list() 返回长度为 3 且按注册顺序排列', () => {
      const registry = ArtifactParserRegistry.getInstance();

      const parserA = new MockParser('parser-alpha', 'Alpha', ['**/*.alpha']);
      const parserB = new MockParser('parser-beta', 'Beta', ['**/*.beta']);
      const parserC = new MockParser('parser-gamma', 'Gamma', ['**/*.gamma']);

      registry.register(parserA);
      registry.register(parserB);
      registry.register(parserC);

      const entries = registry.list();
      expect(entries).toHaveLength(3);
      expect(entries[0]!.parser.id).toBe('parser-alpha');
      expect(entries[1]!.parser.id).toBe('parser-beta');
      expect(entries[2]!.parser.id).toBe('parser-gamma');
    });

    it('注册 id 重复的 Parser 时抛出冲突错误，Registry 中仍只保留原先实例', () => {
      const registry = ArtifactParserRegistry.getInstance();

      const original = new MockParser('my-parser', 'Original', ['**/*.orig']);
      const duplicate = new MockParser('my-parser', 'Duplicate', ['**/*.dup']);

      registry.register(original);

      expect(() => registry.register(duplicate)).toThrowError(/冲突/);

      const entries = registry.list();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.parser.name).toBe('Original');
    });

    it('注册 id 不符合 kebab-case 格式时抛出格式错误，Registry 状态不变', () => {
      const registry = ArtifactParserRegistry.getInstance();

      // 含大写字母
      expect(() => registry.register(new MockParser('ParserUpper', 'Upper', ['**/*.x']))).toThrowError(/格式错误/);

      // 含空格
      expect(() => registry.register(new MockParser('parser space', 'Space', ['**/*.x']))).toThrowError(/格式错误/);

      // 以数字开头
      expect(() => registry.register(new MockParser('1parser', 'NumStart', ['**/*.x']))).toThrowError(/格式错误/);

      // Registry 应该保持为空
      expect(registry.isEmpty()).toBe(true);
    });
  });

  // ─── 按 ID 查询与全量列出 ───

  describe('get() / list() / isEmpty() - 查询与列出', () => {
    it('get() 返回对应实例；不存在的 id 返回 undefined', () => {
      const registry = ArtifactParserRegistry.getInstance();

      const parserA = new MockParser('parser-a', 'A', ['**/*.a']);
      const parserB = new MockParser('parser-b', 'B', ['**/*.b']);

      registry.register(parserA);
      registry.register(parserB);

      const found = registry.get('parser-b');
      expect(found).toBeDefined();
      expect(found!.id).toBe('parser-b');
      expect(found!.name).toBe('B');

      const notFound = registry.get('non-existent');
      expect(notFound).toBeUndefined();
    });

    it('list() 返回包含 Parser 和 enabled 状态的数组', () => {
      const registry = ArtifactParserRegistry.getInstance();

      registry.register(new MockParser('parser-a', 'A', ['**/*.a']));
      registry.register(new MockParser('parser-b', 'B', ['**/*.b']));

      const entries = registry.list();
      expect(entries).toHaveLength(2);

      for (const entry of entries) {
        expect(entry).toHaveProperty('parser');
        expect(entry).toHaveProperty('enabled');
        expect(entry.parser).toHaveProperty('id');
        expect(typeof entry.enabled).toBe('boolean');
        expect(entry.enabled).toBe(true); // 默认启用
      }
    });

    it('空 Registry 调用 isEmpty() 返回 true，注册后返回 false', () => {
      const registry = ArtifactParserRegistry.getInstance();

      expect(registry.isEmpty()).toBe(true);
      expect(registry.list()).toEqual([]);

      registry.register(new MockParser('parser-test', 'Test', ['**/*.test']));

      expect(registry.isEmpty()).toBe(false);
    });
  });

  // ─── 按文件模式匹配 ───

  describe('getByFilePattern() - 文件路径匹配', () => {
    it('根据扩展名匹配 *.yaml Parser', () => {
      const registry = ArtifactParserRegistry.getInstance();

      const yamlParser = new MockParser('yaml-parser', 'YAML', ['**/*.yaml', '**/*.yml']);
      const tomlParser = new MockParser('toml-parser', 'TOML', ['**/*.toml']);

      registry.register(yamlParser);
      registry.register(tomlParser);

      const matched = registry.getByFilePattern('/project/config.yaml');
      expect(matched).toHaveLength(1);
      expect(matched[0]!.id).toBe('yaml-parser');
    });

    it('根据 .yml 扩展名匹配', () => {
      const registry = ArtifactParserRegistry.getInstance();
      registry.register(new MockParser('yaml-parser', 'YAML', ['**/*.yaml', '**/*.yml']));

      const matched = registry.getByFilePattern('/project/app.yml');
      expect(matched).toHaveLength(1);
      expect(matched[0]!.id).toBe('yaml-parser');
    });

    it('根据精确文件名匹配（如 SKILL.md）', () => {
      const registry = ArtifactParserRegistry.getInstance();
      registry.register(new MockParser('skill-md', 'SKILL.md', ['**/SKILL.md']));

      const matched = registry.getByFilePattern('/project/plugins/my-plugin/SKILL.md');
      expect(matched).toHaveLength(1);
      expect(matched[0]!.id).toBe('skill-md');
    });

    it('根据文件名前缀.* 匹配（如 .env.*）', () => {
      const registry = ArtifactParserRegistry.getInstance();
      registry.register(new MockParser('env-parser', 'Env', ['**/.env', '**/.env.*']));

      // 精确匹配 .env
      const matched1 = registry.getByFilePattern('/project/.env');
      expect(matched1).toHaveLength(1);

      // 匹配 .env.local
      const matched2 = registry.getByFilePattern('/project/.env.local');
      expect(matched2).toHaveLength(1);
    });

    it('不匹配的文件返回空数组', () => {
      const registry = ArtifactParserRegistry.getInstance();
      registry.register(new MockParser('yaml-parser', 'YAML', ['**/*.yaml']));

      const matched = registry.getByFilePattern('/project/index.ts');
      expect(matched).toHaveLength(0);
    });

    it('禁用的 Parser 不出现在 getByFilePattern 结果中', () => {
      const registry = ArtifactParserRegistry.getInstance();

      registry.register(new MockParser('yaml-parser', 'YAML', ['**/*.yaml']));
      registry.setEnabled('yaml-parser', false);

      const matched = registry.getByFilePattern('/project/config.yaml');
      expect(matched).toHaveLength(0);
    });

    it('多个 Parser 匹配同一文件时全部返回', () => {
      const registry = ArtifactParserRegistry.getInstance();

      // 两个 Parser 都匹配 .yaml 文件
      registry.register(new MockParser('yaml-generic', 'Generic YAML', ['**/*.yaml']));
      registry.register(new MockParser('yaml-config', 'Config YAML', ['**/*.yaml']));

      const matched = registry.getByFilePattern('/project/config.yaml');
      expect(matched).toHaveLength(2);
      expect(matched[0]!.id).toBe('yaml-generic');
      expect(matched[1]!.id).toBe('yaml-config');
    });

    it('Dockerfile 和 Dockerfile.* 模式匹配', () => {
      const registry = ArtifactParserRegistry.getInstance();
      registry.register(new MockParser('dockerfile', 'Dockerfile', ['**/Dockerfile', '**/Dockerfile.*']));

      const matched1 = registry.getByFilePattern('/project/Dockerfile');
      expect(matched1).toHaveLength(1);

      const matched2 = registry.getByFilePattern('/project/Dockerfile.prod');
      expect(matched2).toHaveLength(1);
    });
  });

  // ─── 启用/禁用状态管理 ───

  describe('setEnabled() - 启用/禁用管理', () => {
    it('新注册 Parser 默认 enabled=true；禁用后 list() 中 enabled 变为 false', () => {
      const registry = ArtifactParserRegistry.getInstance();

      registry.register(new MockParser('parser-toggle', 'Toggle', ['**/*.x']));

      // 默认启用
      expect(registry.list()[0]!.enabled).toBe(true);

      // 禁用
      registry.setEnabled('parser-toggle', false);
      expect(registry.list()[0]!.enabled).toBe(false);
    });

    it('禁用后再启用，enabled 恢复为 true', () => {
      const registry = ArtifactParserRegistry.getInstance();

      registry.register(new MockParser('parser-toggle', 'Toggle', ['**/*.x']));
      registry.setEnabled('parser-toggle', false);
      registry.setEnabled('parser-toggle', true);

      expect(registry.list()[0]!.enabled).toBe(true);
    });

    it('对不存在的 id 执行 setEnabled 抛出明确错误', () => {
      const registry = ArtifactParserRegistry.getInstance();

      expect(() => registry.setEnabled('non-existent', true)).toThrowError(
        "Parser 'non-existent' not found in registry",
      );
    });
  });

  // ─── 单例模式测试 ───

  describe('单例模式', () => {
    it('连续两次调用 getInstance() 返回同一对象引用', () => {
      const instance1 = ArtifactParserRegistry.getInstance();
      const instance2 = ArtifactParserRegistry.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('resetInstance() 后新实例 list() 返回空列表', () => {
      const registry = ArtifactParserRegistry.getInstance();

      registry.register(new MockParser('parser-a', 'A', ['**/*.a']));
      registry.register(new MockParser('parser-b', 'B', ['**/*.b']));
      expect(registry.list()).toHaveLength(2);

      ArtifactParserRegistry.resetInstance();

      const newRegistry = ArtifactParserRegistry.getInstance();
      expect(newRegistry.list()).toHaveLength(0);
      expect(newRegistry.isEmpty()).toBe(true);
    });
  });

  // ─── bootstrapParsers 幂等初始化 ───

  describe('bootstrapParsers() - 幂等初始化', () => {
    it('调用 bootstrapParsers() 后 Registry 非空，包含 6 个内置 Parser', () => {
      bootstrapParsers();

      const registry = ArtifactParserRegistry.getInstance();
      expect(registry.isEmpty()).toBe(false);

      const entries = registry.list();
      expect(entries).toHaveLength(6);

      // 验证原有 3 个 Parser
      expect(registry.get('skill-md')).toBeDefined();
      expect(registry.get('behavior-yaml')).toBeDefined();
      expect(registry.get('dockerfile')).toBeDefined();

      // 验证新增 3 个配置 Parser
      expect(registry.get('yaml-config')).toBeDefined();
      expect(registry.get('env-config')).toBeDefined();
      expect(registry.get('toml-config')).toBeDefined();
    });

    it('连续调用 bootstrapParsers() 两次，Parser 数量不变，不抛异常', () => {
      bootstrapParsers();
      const countAfterFirst = ArtifactParserRegistry.getInstance().list().length;

      expect(() => bootstrapParsers()).not.toThrow();
      const countAfterSecond = ArtifactParserRegistry.getInstance().list().length;

      expect(countAfterFirst).toBe(countAfterSecond);
    });
  });
});
