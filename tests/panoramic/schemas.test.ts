/**
 * Zod Schema 单元测试
 * 验证 GeneratorMetadataSchema、ArtifactParserMetadataSchema、
 * GenerateOptionsSchema、ProjectContextSchema 的合法/非法输入
 */
import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  GeneratorMetadataSchema,
  ArtifactParserMetadataSchema,
  GenerateOptionsSchema,
  ProjectContextSchema,
  type GeneratorMetadata,
  type ArtifactParserMetadata,
  type GenerateOptions,
  type ProjectContext,
} from '../../src/panoramic/interfaces.js';

// ============================================================
// GeneratorMetadataSchema
// ============================================================

describe('GeneratorMetadataSchema', () => {
  it('合法输入通过验证', () => {
    const valid = {
      id: 'data-model',
      name: 'Data Model Generator',
      description: '从项目中提取数据模型并生成文档',
    };
    const result = GeneratorMetadataSchema.parse(valid);
    expect(result.id).toBe('data-model');
    expect(result.name).toBe('Data Model Generator');
    expect(result.description).toBe('从项目中提取数据模型并生成文档');
  });

  it('缺失 id 字段抛出 ZodError', () => {
    const invalid = {
      name: 'Data Model Generator',
      description: '描述',
    };
    expect(() => GeneratorMetadataSchema.parse(invalid)).toThrow(ZodError);
  });

  it('id 非 kebab-case 抛出 ZodError', () => {
    // 大写字母
    expect(() =>
      GeneratorMetadataSchema.parse({
        id: 'DataModel',
        name: 'test',
        description: 'test',
      }),
    ).toThrow(ZodError);

    // 以数字开头
    expect(() =>
      GeneratorMetadataSchema.parse({
        id: '123-model',
        name: 'test',
        description: 'test',
      }),
    ).toThrow(ZodError);

    // 包含下划线
    expect(() =>
      GeneratorMetadataSchema.parse({
        id: 'data_model',
        name: 'test',
        description: 'test',
      }),
    ).toThrow(ZodError);

    // 空字符串
    expect(() =>
      GeneratorMetadataSchema.parse({
        id: '',
        name: 'test',
        description: 'test',
      }),
    ).toThrow(ZodError);
  });
});

// ============================================================
// ArtifactParserMetadataSchema
// ============================================================

describe('ArtifactParserMetadataSchema', () => {
  it('合法输入通过验证', () => {
    const valid = {
      id: 'skill-md',
      name: 'SKILL.md Parser',
      filePatterns: ['**/SKILL.md'],
    };
    const result = ArtifactParserMetadataSchema.parse(valid);
    expect(result.id).toBe('skill-md');
    expect(result.filePatterns).toEqual(['**/SKILL.md']);
  });

  it('空 filePatterns 数组抛出 ZodError', () => {
    expect(() =>
      ArtifactParserMetadataSchema.parse({
        id: 'skill-md',
        name: 'SKILL.md Parser',
        filePatterns: [],
      }),
    ).toThrow(ZodError);
  });

  it('filePatterns 包含空字符串抛出 ZodError', () => {
    expect(() =>
      ArtifactParserMetadataSchema.parse({
        id: 'skill-md',
        name: 'SKILL.md Parser',
        filePatterns: [''],
      }),
    ).toThrow(ZodError);
  });
});

// ============================================================
// GenerateOptionsSchema
// ============================================================

describe('GenerateOptionsSchema', () => {
  it('空对象使用默认值填充', () => {
    const result = GenerateOptionsSchema.parse({});
    expect(result.useLLM).toBe(false);
    expect(result.templateOverride).toBeUndefined();
    expect(result.outputFormat).toBe('markdown');
  });

  it('useLLM 覆盖默认值', () => {
    const result = GenerateOptionsSchema.parse({ useLLM: true });
    expect(result.useLLM).toBe(true);
  });

  it('templateOverride 字符串通过', () => {
    const result = GenerateOptionsSchema.parse({
      templateOverride: '/path/to/template.hbs',
    });
    expect(result.templateOverride).toBe('/path/to/template.hbs');
  });

  it('无效 outputFormat 抛出 ZodError', () => {
    expect(() =>
      GenerateOptionsSchema.parse({ outputFormat: 'html' }),
    ).toThrow(ZodError);
  });
});

// ============================================================
// ProjectContextSchema
// ============================================================

describe('ProjectContextSchema', () => {
  it('合法输入通过验证', () => {
    const valid = {
      projectRoot: '/home/user/project',
      configFiles: new Map([['package.json', '/home/user/project/package.json']]),
    };
    const result = ProjectContextSchema.parse(valid);
    expect(result.projectRoot).toBe('/home/user/project');
    expect(result.configFiles.get('package.json')).toBe('/home/user/project/package.json');
  });

  it('空 projectRoot 抛出 ZodError', () => {
    expect(() =>
      ProjectContextSchema.parse({
        projectRoot: '',
        configFiles: new Map(),
      }),
    ).toThrow(ZodError);
  });

  it('空 configFiles Map 通过验证', () => {
    const result = ProjectContextSchema.parse({
      projectRoot: '/tmp/project',
      configFiles: new Map(),
    });
    expect(result.configFiles.size).toBe(0);
  });
});

// ============================================================
// z.infer 与 interface 类型兼容性检查
// ============================================================

describe('z.infer 与 interface 类型兼容性', () => {
  it('GeneratorMetadata z.infer 类型可赋值给 GeneratorMetadata', () => {
    const data = GeneratorMetadataSchema.parse({
      id: 'test-gen',
      name: 'Test',
      description: 'Test description',
    });
    // 类型兼容性：z.infer 结果可赋值给手写类型
    const typed: GeneratorMetadata = data;
    expect(typed.id).toBe('test-gen');
  });

  it('ArtifactParserMetadata z.infer 类型可赋值给 ArtifactParserMetadata', () => {
    const data = ArtifactParserMetadataSchema.parse({
      id: 'test-parser',
      name: 'Test',
      filePatterns: ['**/*.md'],
    });
    const typed: ArtifactParserMetadata = data;
    expect(typed.filePatterns).toHaveLength(1);
  });

  it('GenerateOptions z.infer 类型可赋值给 GenerateOptions', () => {
    const data = GenerateOptionsSchema.parse({});
    const typed: GenerateOptions = data;
    expect(typed.useLLM).toBe(false);
  });

  it('ProjectContext z.infer 类型可赋值给 ProjectContext', () => {
    const data = ProjectContextSchema.parse({
      projectRoot: '/tmp',
      configFiles: new Map(),
    });
    const typed: ProjectContext = data;
    expect(typed.projectRoot).toBe('/tmp');
  });
});
