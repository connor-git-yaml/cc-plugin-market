/**
 * DataModelGenerator 单元测试
 * 覆盖 isApplicable / extract / generate / render 全生命周期
 * 以及纯函数辅助方法（字段提取、关系分析、ER 图生成）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import type { CodeSkeleton, ExportSymbol } from '../../src/models/code-skeleton.js';
import type * as LlmEnricher from '../../src/panoramic/utils/llm-enricher.js';

vi.mock('../../src/panoramic/utils/llm-enricher.js', async () => {
  const actual = await vi.importActual<typeof LlmEnricher>(
    '../../src/panoramic/utils/llm-enricher.js',
  );

  return {
    ...actual,
    enrichModelDescriptions: vi.fn(async (models: unknown[]) =>
      JSON.parse(JSON.stringify(models))),
    enrichFieldDescriptions: vi.fn(async (models: unknown[]) =>
      JSON.parse(JSON.stringify(models))),
  };
});

import {
  DataModelGenerator,
  extractPythonFieldsFromLines,
  extractTypeScriptModelsFromSkeleton,
  parsePydanticFieldCall,
  buildModelRelations,
  generateMermaidErDiagram,
  type DataModel,
  type DataModelField,
  type DataModelInput,
  type DataModelOutput,
  type ModelRelation,
} from '../../src/panoramic/data-model-generator.js';
import { GeneratorRegistry } from '../../src/panoramic/generator-registry.js';
import {
  enrichFieldDescriptions,
  enrichModelDescriptions,
} from '../../src/panoramic/utils/llm-enricher.js';

const mockEnrichFieldDescriptions = vi.mocked(enrichFieldDescriptions);
const mockEnrichModelDescriptions = vi.mocked(enrichModelDescriptions);

// ============================================================
// 辅助函数
// ============================================================

/** 构建含 Python 的 ProjectContext */
function createPythonContext(): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map([['pyproject.toml', '']]),
    detectedLanguages: ['python'],
    packageManager: 'uv',
    workspaceType: 'single',
    existingSpecs: [],
  };
}

/** 构建含 TypeScript 的 ProjectContext */
function createTsContext(): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map([['tsconfig.json', '{}']]),
    detectedLanguages: ['typescript'],
    packageManager: 'npm',
    workspaceType: 'single',
    existingSpecs: [],
  };
}

/** 构建含 Python + TypeScript 的 ProjectContext */
function createMixedContext(): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map(),
    detectedLanguages: ['python', 'typescript'],
    packageManager: 'npm',
    workspaceType: 'single',
    existingSpecs: [],
  };
}

/** 构建仅含 Go 的 ProjectContext */
function createGoContext(): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map([['go.mod', '']]),
    detectedLanguages: ['go'],
    packageManager: 'go',
    workspaceType: 'single',
    existingSpecs: [],
  };
}

/** 构建空 detectedLanguages 的 ProjectContext */
function createEmptyLangContext(): ProjectContext {
  return {
    projectRoot: '/home/user/project',
    configFiles: new Map(),
    detectedLanguages: [],
    packageManager: 'unknown',
    workspaceType: 'single',
    existingSpecs: [],
  };
}

/** 构建 mock CodeSkeleton */
function createMockTsSkeleton(exports: ExportSymbol[]): CodeSkeleton {
  return {
    filePath: '/home/user/project/src/models.ts',
    language: 'typescript',
    loc: 100,
    exports,
    imports: [],
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'tree-sitter',
  };
}

// ============================================================
// isApplicable
// ============================================================

describe('DataModelGenerator.isApplicable', () => {
  const generator = new DataModelGenerator();

  it('Python 项目返回 true', () => {
    expect(generator.isApplicable(createPythonContext())).toBe(true);
  });

  it('TypeScript 项目返回 true', () => {
    expect(generator.isApplicable(createTsContext())).toBe(true);
  });

  it('Python + TypeScript 混合项目返回 true', () => {
    expect(generator.isApplicable(createMixedContext())).toBe(true);
  });

  it('Go-only 项目返回 false', () => {
    expect(generator.isApplicable(createGoContext())).toBe(false);
  });

  it('空 detectedLanguages 返回 false', () => {
    expect(generator.isApplicable(createEmptyLangContext())).toBe(false);
  });
});

// ============================================================
// parsePydanticFieldCall
// ============================================================

describe('parsePydanticFieldCall', () => {
  it('解析 default 和 description', () => {
    const result = parsePydanticFieldCall('Field(default="hello", description="说明文字")');
    expect(result.default).toBe('"hello"');
    expect(result.description).toBe('说明文字');
  });

  it('解析 default_factory', () => {
    const result = parsePydanticFieldCall('Field(default_factory=list)');
    expect(result.default).toBe('list()');
    expect(result.description).toBeNull();
  });

  it('解析位置参数作为默认值', () => {
    const result = parsePydanticFieldCall('Field("default_val")');
    expect(result.default).toBe('"default_val"');
  });

  it('省略号 ... 不作为默认值', () => {
    const result = parsePydanticFieldCall('Field(..., description="必填字段")');
    expect(result.default).toBeNull();
    expect(result.description).toBe('必填字段');
  });

  it('仅 description', () => {
    const result = parsePydanticFieldCall("Field(description='用户名')");
    expect(result.default).toBeNull();
    expect(result.description).toBe('用户名');
  });
});

// ============================================================
// extractPythonFieldsFromLines
// ============================================================

describe('extractPythonFieldsFromLines', () => {
  it('提取 @dataclass 字段（名称、类型、默认值）', () => {
    const source = [
      '@dataclass',
      'class User:',
      '    name: str',
      '    age: int = 25',
      '    email: Optional[str] = None',
      '',
      '    def greet(self):',
      '        pass',
    ];

    const fields = extractPythonFieldsFromLines(source, 1, source.length);

    expect(fields).toHaveLength(3);
    expect(fields[0]).toEqual({
      name: 'name',
      typeStr: 'str',
      optional: false,
      defaultValue: null,
      description: null,
    });
    expect(fields[1]).toEqual({
      name: 'age',
      typeStr: 'int',
      optional: false,
      defaultValue: '25',
      description: null,
    });
    expect(fields[2]).toEqual({
      name: 'email',
      typeStr: 'Optional[str]',
      optional: true,
      defaultValue: 'None',
      description: null,
    });
  });

  it('提取 Pydantic BaseModel 字段（含 Field()）', () => {
    const source = [
      'class Config(BaseModel):',
      '    host: str = "localhost"',
      '    port: int = Field(default=8080, description="服务端口")',
      '    tags: List[str] = Field(default_factory=list)',
    ];

    const fields = extractPythonFieldsFromLines(source, 1, source.length);

    expect(fields).toHaveLength(3);
    expect(fields[0]).toEqual({
      name: 'host',
      typeStr: 'str',
      optional: false,
      defaultValue: '"localhost"',
      description: null,
    });
    expect(fields[1]).toEqual({
      name: 'port',
      typeStr: 'int',
      optional: false,
      defaultValue: '8080',
      description: '服务端口',
    });
    expect(fields[2]).toEqual({
      name: 'tags',
      typeStr: 'List[str]',
      optional: false,
      defaultValue: 'list()',
      description: null,
    });
  });

  it('跳过方法定义和注释', () => {
    const source = [
      'class Model(BaseModel):',
      '    # 这是注释',
      '    name: str',
      '',
      '    def validate(self):',
      '        pass',
      '',
      '    async def save(self):',
      '        pass',
    ];

    const fields = extractPythonFieldsFromLines(source, 1, source.length);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.name).toBe('name');
  });

  it('处理复杂嵌套类型', () => {
    const source = [
      'class Complex(BaseModel):',
      '    data: Dict[str, List[Optional[int]]]',
      '    mapping: Mapping[str, Any] = {}',
    ];

    const fields = extractPythonFieldsFromLines(source, 1, source.length);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.typeStr).toBe('Dict[str, List[Optional[int]]]');
    expect(fields[1]!.typeStr).toBe('Mapping[str, Any]');
    expect(fields[1]!.defaultValue).toBe('{}');
  });

  it('跳过私有字段（双下划线开头）', () => {
    const source = [
      '@dataclass',
      'class User:',
      '    name: str',
      '    __secret: str',
      '    _protected: str',
    ];

    const fields = extractPythonFieldsFromLines(source, 1, source.length);
    // __secret 跳过，_protected 保留
    expect(fields).toHaveLength(2);
    expect(fields.map(f => f.name)).toEqual(['name', '_protected']);
  });

  it('空类返回空数组', () => {
    const source = [
      '@dataclass',
      'class Empty:',
      '    pass',
    ];

    const fields = extractPythonFieldsFromLines(source, 1, source.length);
    expect(fields).toHaveLength(0);
  });

  it('处理 None | str 联合类型的可选判断', () => {
    const source = [
      'class Model(BaseModel):',
      '    value: str | None = None',
      '    other: None | int = None',
    ];

    const fields = extractPythonFieldsFromLines(source, 1, source.length);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.optional).toBe(true);
    expect(fields[1]!.optional).toBe(true);
  });
});

// ============================================================
// extractTypeScriptModelsFromSkeleton
// ============================================================

describe('extractTypeScriptModelsFromSkeleton', () => {
  it('提取 interface 属性', () => {
    const skeleton = createMockTsSkeleton([
      {
        name: 'User',
        kind: 'interface',
        signature: 'interface User',
        isDefault: false,
        startLine: 1,
        endLine: 5,
        members: [
          { name: 'name', kind: 'property', signature: 'name: string', isStatic: false },
          { name: 'age', kind: 'property', signature: 'age: number', isStatic: false },
          { name: 'email', kind: 'property', signature: 'email?: string', isStatic: false },
        ],
      },
    ]);

    const models = extractTypeScriptModelsFromSkeleton(skeleton, '/home/user/project');

    expect(models).toHaveLength(1);
    expect(models[0]!.name).toBe('User');
    expect(models[0]!.kind).toBe('interface');
    expect(models[0]!.language).toBe('typescript');
    expect(models[0]!.fields).toHaveLength(3);
    expect(models[0]!.fields[0]).toEqual({
      name: 'name',
      typeStr: 'string',
      optional: false,
      defaultValue: null,
      description: null,
    });
    expect(models[0]!.fields[2]).toEqual({
      name: 'email',
      typeStr: 'string',
      optional: true,
      defaultValue: null,
      description: null,
    });
  });

  it('提取 interface 的 extends 关系', () => {
    const skeleton = createMockTsSkeleton([
      {
        name: 'Admin',
        kind: 'interface',
        signature: 'interface Admin extends User',
        isDefault: false,
        startLine: 1,
        endLine: 3,
        members: [
          { name: 'role', kind: 'property', signature: 'role: string', isStatic: false },
        ],
      },
    ]);

    const models = extractTypeScriptModelsFromSkeleton(skeleton, '/home/user/project');
    expect(models[0]!.bases).toEqual(['User']);
  });

  it('跳过无字段的 type alias（联合类型等）', () => {
    const skeleton = createMockTsSkeleton([
      {
        name: 'Status',
        kind: 'type',
        signature: 'type Status',
        isDefault: false,
        startLine: 1,
        endLine: 1,
        // 无 members（联合类型 type Status = 'active' | 'inactive'）
      },
    ]);

    const models = extractTypeScriptModelsFromSkeleton(skeleton, '/home/user/project');
    expect(models).toHaveLength(0);
  });

  it('跳过方法成员，只保留属性', () => {
    const skeleton = createMockTsSkeleton([
      {
        name: 'Service',
        kind: 'interface',
        signature: 'interface Service',
        isDefault: false,
        startLine: 1,
        endLine: 5,
        members: [
          { name: 'name', kind: 'property', signature: 'name: string', isStatic: false },
          { name: 'start', kind: 'method', signature: 'start(): void', isStatic: false },
        ],
      },
    ]);

    const models = extractTypeScriptModelsFromSkeleton(skeleton, '/home/user/project');
    expect(models[0]!.fields).toHaveLength(1);
    expect(models[0]!.fields[0]!.name).toBe('name');
  });
});

// ============================================================
// buildModelRelations
// ============================================================

describe('buildModelRelations', () => {
  it('检测继承关系', () => {
    const models: DataModel[] = [
      {
        name: 'User',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [{ name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null }],
        bases: [],
        description: null,
      },
      {
        name: 'Admin',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [{ name: 'role', typeStr: 'str', optional: false, defaultValue: null, description: null }],
        bases: ['User'],
        description: null,
      },
    ];

    const relations = buildModelRelations(models);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toEqual({
      source: 'Admin',
      target: 'User',
      type: 'inherits',
    });
  });

  it('检测单值引用关系', () => {
    const models: DataModel[] = [
      {
        name: 'Address',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [{ name: 'city', typeStr: 'str', optional: false, defaultValue: null, description: null }],
        bases: [],
        description: null,
      },
      {
        name: 'User',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [{ name: 'address', typeStr: 'Address', optional: false, defaultValue: null, description: null }],
        bases: [],
        description: null,
      },
    ];

    const relations = buildModelRelations(models);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toEqual({
      source: 'User',
      target: 'Address',
      type: 'has',
    });
  });

  it('检测集合引用关系', () => {
    const models: DataModel[] = [
      {
        name: 'Tag',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [],
        bases: [],
        description: null,
      },
      {
        name: 'Post',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [{ name: 'tags', typeStr: 'List[Tag]', optional: false, defaultValue: null, description: null }],
        bases: [],
        description: null,
      },
    ];

    const relations = buildModelRelations(models);
    expect(relations).toHaveLength(1);
    expect(relations[0]!.type).toBe('contains');
  });

  it('关系去重', () => {
    const models: DataModel[] = [
      {
        name: 'User',
        filePath: 'a.py',
        language: 'python',
        kind: 'dataclass',
        fields: [],
        bases: [],
        description: null,
      },
      {
        name: 'Admin',
        filePath: 'a.py',
        language: 'python',
        kind: 'dataclass',
        fields: [{ name: 'user', typeStr: 'User', optional: false, defaultValue: null, description: null }],
        bases: ['User'],
        description: null,
      },
    ];

    const relations = buildModelRelations(models);
    // 继承 + has 是不同类型的关系，都应保留
    expect(relations).toHaveLength(2);
    const types = relations.map(r => r.type).sort();
    expect(types).toEqual(['has', 'inherits']);
  });

  it('空模型列表返回空关系', () => {
    expect(buildModelRelations([])).toEqual([]);
  });
});

// ============================================================
// generateMermaidErDiagram
// ============================================================

describe('generateMermaidErDiagram', () => {
  it('生成含实体和字段的 ER 图', () => {
    const models: DataModel[] = [
      {
        name: 'User',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [
          { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
          { name: 'age', typeStr: 'int', optional: false, defaultValue: null, description: null },
        ],
        bases: [],
        description: null,
      },
    ];

    const diagram = generateMermaidErDiagram(models, []);
    expect(diagram).toContain('erDiagram');
    expect(diagram).toContain('User {');
    expect(diagram).toContain('str name');
    expect(diagram).toContain('int age');
  });

  it('生成继承关系线', () => {
    const models: DataModel[] = [
      {
        name: 'User',
        filePath: 'a.py',
        language: 'python',
        kind: 'dataclass',
        fields: [],
        bases: [],
        description: null,
      },
      {
        name: 'Admin',
        filePath: 'a.py',
        language: 'python',
        kind: 'dataclass',
        fields: [],
        bases: ['User'],
        description: null,
      },
    ];
    const relations: ModelRelation[] = [
      { source: 'Admin', target: 'User', type: 'inherits' },
    ];

    const diagram = generateMermaidErDiagram(models, relations);
    expect(diagram).toContain('User ||--o{ Admin : "inherits"');
  });

  it('生成 has 和 contains 关系线', () => {
    const models: DataModel[] = [
      { name: 'A', filePath: 'a.ts', language: 'typescript', kind: 'interface', fields: [], bases: [], description: null },
      { name: 'B', filePath: 'a.ts', language: 'typescript', kind: 'interface', fields: [], bases: [], description: null },
    ];
    const relations: ModelRelation[] = [
      { source: 'A', target: 'B', type: 'has' },
      { source: 'A', target: 'B', type: 'contains' },
    ];

    const diagram = generateMermaidErDiagram(models, relations);
    expect(diagram).toContain('A ||--o| B : "has"');
    expect(diagram).toContain('A ||--|{ B : "contains"');
  });

  it('空模型列表返回空字符串', () => {
    expect(generateMermaidErDiagram([], [])).toBe('');
  });
});

// ============================================================
// generate
// ============================================================

describe('DataModelGenerator.generate', () => {
  const generator = new DataModelGenerator();

  it('输出包含排序后的模型和统计摘要', async () => {
    const input: DataModelInput = {
      models: [
        {
          name: 'Config',
          filePath: 'src/config.ts',
          language: 'typescript',
          kind: 'interface',
          fields: [{ name: 'host', typeStr: 'string', optional: false, defaultValue: null, description: null }],
          bases: [],
          description: null,
        },
        {
          name: 'User',
          filePath: 'models.py',
          language: 'python',
          kind: 'dataclass',
          fields: [
            { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
            { name: 'age', typeStr: 'int', optional: false, defaultValue: null, description: null },
          ],
          bases: [],
          description: null,
        },
      ],
      relations: [],
      sourceFiles: ['models.py', 'src/config.ts'],
    };

    const output = await generator.generate(input);

    expect(output.summary.totalModels).toBe(2);
    expect(output.summary.totalFields).toBe(3);
    expect(output.summary.byLanguage).toEqual({ python: 1, typescript: 1 });
    expect(output.summary.byKind).toEqual({ dataclass: 1, interface: 1 });
    // 按语言排序，python 在 typescript 前
    expect(output.models[0]!.language).toBe('python');
    expect(output.models[1]!.language).toBe('typescript');
    expect(output.erDiagram).toContain('erDiagram');
  });

  it('空输入生成空统计', async () => {
    const input: DataModelInput = {
      models: [],
      relations: [],
      sourceFiles: [],
    };

    const output = await generator.generate(input);
    expect(output.summary.totalModels).toBe(0);
    expect(output.summary.totalFields).toBe(0);
    expect(output.erDiagram).toBe('');
  });
});

// ============================================================
// render
// ============================================================

describe('DataModelGenerator.render', () => {
  const generator = new DataModelGenerator();

  it('输出合法 Markdown（包含标题、表格和 ER 图）', () => {
    const output: DataModelOutput = {
      models: [
        {
          name: 'User',
          filePath: 'models.py',
          language: 'python',
          kind: 'dataclass',
          fields: [
            { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
            { name: 'age', typeStr: 'int', optional: false, defaultValue: '25', description: '年龄' },
          ],
          bases: [],
          description: null,
        },
      ],
      relations: [],
      erDiagram: 'erDiagram\n    User {\n        str name\n        int age\n    }',
      summary: {
        totalModels: 1,
        totalFields: 2,
        byLanguage: { python: 1 },
        byKind: { dataclass: 1 },
      },
    };

    const markdown = generator.render(output);
    expect(markdown).toContain('# 数据模型文档');
    expect(markdown).toContain('## Python 数据模型');
    expect(markdown).toContain('### User');
    expect(markdown).toContain('| `name` |');
    expect(markdown).toContain('| `age` |');
    expect(markdown).toContain('`25`');
    expect(markdown).toContain('年龄');
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('erDiagram');
  });

  it('空模型列表输出"未检测到"提示', () => {
    const output: DataModelOutput = {
      models: [],
      relations: [],
      erDiagram: '',
      summary: { totalModels: 0, totalFields: 0, byLanguage: {}, byKind: {} },
    };

    const markdown = generator.render(output);
    expect(markdown).toContain('未检测到数据模型定义');
  });

  it('同时包含 Python 和 TypeScript 模型', () => {
    const output: DataModelOutput = {
      models: [
        {
          name: 'PyModel',
          filePath: 'a.py',
          language: 'python',
          kind: 'pydantic',
          fields: [{ name: 'x', typeStr: 'int', optional: false, defaultValue: null, description: null }],
          bases: [],
          description: null,
        },
        {
          name: 'TsModel',
          filePath: 'a.ts',
          language: 'typescript',
          kind: 'interface',
          fields: [{ name: 'y', typeStr: 'string', optional: false, defaultValue: null, description: null }],
          bases: [],
          description: null,
        },
      ],
      relations: [],
      erDiagram: 'erDiagram\n    PyModel {\n        int x\n    }\n    TsModel {\n        string y\n    }',
      summary: {
        totalModels: 2,
        totalFields: 2,
        byLanguage: { python: 1, typescript: 1 },
        byKind: { pydantic: 1, interface: 1 },
      },
    };

    const markdown = generator.render(output);
    expect(markdown).toContain('## Python 数据模型');
    expect(markdown).toContain('## TypeScript 数据模型');
    expect(markdown).toContain('### PyModel');
    expect(markdown).toContain('### TsModel');
  });
});

// ============================================================
// 只读属性
// ============================================================

describe('DataModelGenerator 只读属性', () => {
  const generator = new DataModelGenerator();

  it('id 为 "data-model"', () => {
    expect(generator.id).toBe('data-model');
  });

  it('name 为 "Data Model Generator"', () => {
    expect(generator.name).toBe('Data Model Generator');
  });

  it('description 非空', () => {
    expect(generator.description.length).toBeGreaterThan(0);
  });
});

// ============================================================
// GeneratorRegistry 集成
// ============================================================

describe('DataModelGenerator Registry 集成', () => {
  beforeEach(() => {
    GeneratorRegistry.resetInstance();
  });

  it('bootstrapGenerators() 后可通过 get("data-model") 获取', async () => {
    const { bootstrapGenerators } = await import('../../src/panoramic/generator-registry.js');
    bootstrapGenerators();

    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('data-model');
    expect(generator).toBeDefined();
    expect(generator!.id).toBe('data-model');
  });

  it('filterByContext 对 Python 项目返回 DataModelGenerator', async () => {
    const { bootstrapGenerators } = await import('../../src/panoramic/generator-registry.js');
    bootstrapGenerators();

    const registry = GeneratorRegistry.getInstance();
    const applicable = await registry.filterByContext(createPythonContext());
    const ids = applicable.map(g => g.id);
    expect(ids).toContain('data-model');
  });

  it('filterByContext 对 Go-only 项目不返回 DataModelGenerator', async () => {
    const { bootstrapGenerators } = await import('../../src/panoramic/generator-registry.js');
    bootstrapGenerators();

    const registry = GeneratorRegistry.getInstance();
    const applicable = await registry.filterByContext(createGoContext());
    const ids = applicable.map(g => g.id);
    expect(ids).not.toContain('data-model');
  });
});

// ============================================================
// 全链路 e2e（mock 数据）
// ============================================================

describe('DataModelGenerator 全链路 e2e（mock 数据）', () => {
  const generator = new DataModelGenerator();

  it('generate → render 输出完整 Markdown', async () => {
    const input: DataModelInput = {
      models: [
        {
          name: 'User',
          filePath: 'models.py',
          language: 'python',
          kind: 'dataclass',
          fields: [
            { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
            { name: 'email', typeStr: 'Optional[str]', optional: true, defaultValue: 'None', description: '邮箱地址' },
          ],
          bases: [],
          description: null,
        },
        {
          name: 'Admin',
          filePath: 'models.py',
          language: 'python',
          kind: 'dataclass',
          fields: [
            { name: 'role', typeStr: 'str', optional: false, defaultValue: null, description: null },
          ],
          bases: ['User'],
          description: null,
        },
      ],
      relations: [{ source: 'Admin', target: 'User', type: 'inherits' }],
      sourceFiles: ['models.py'],
    };

    const output = await generator.generate(input);
    expect(output.summary.totalModels).toBe(2);
    expect(output.erDiagram).toContain('inherits');

    const markdown = generator.render(output);
    expect(markdown).toContain('# 数据模型文档');
    expect(markdown).toContain('### User');
    expect(markdown).toContain('### Admin');
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('邮箱地址');
    expect(typeof markdown).toBe('string');
    expect(markdown.length).toBeGreaterThan(100);
  });
});

// ============================================================
// T010: DataModelGenerator useLLM=true 集成测试
// ============================================================

describe('DataModelGenerator.generate with useLLM=true（集成测试）', () => {
  const generator = new DataModelGenerator();

  beforeEach(() => {
    mockEnrichModelDescriptions.mockClear();
    mockEnrichFieldDescriptions.mockClear();
  });

  it('useLLM=true 时触发 llm-enricher 路径且不依赖真实外部模型', async () => {
    const input: DataModelInput = {
      models: [{
        name: 'TestModel',
        filePath: 'test.py',
        language: 'python',
        kind: 'dataclass',
        fields: [
          { name: 'field1', typeStr: 'str', optional: false, defaultValue: null, description: null },
          { name: 'field2', typeStr: 'int', optional: false, defaultValue: null, description: '已有说明' },
        ],
        bases: [],
        description: null,
      }],
      relations: [],
      sourceFiles: ['test.py'],
    };

    const output = await generator.generate(input, { useLLM: true });

    expect(mockEnrichModelDescriptions).toHaveBeenCalledTimes(1);
    expect(mockEnrichFieldDescriptions).toHaveBeenCalledTimes(1);
    expect(output.summary.totalModels).toBe(1);
    expect(output.summary.totalFields).toBe(2);
    expect(output.models[0]!.fields[1]!.description).toBe('已有说明');
  });
});

// ============================================================
// T032: useLLM=false 回归测试
// ============================================================

describe('DataModelGenerator 回归测试——useLLM=false 不调用 LLM', () => {
  const generator = new DataModelGenerator();

  // T032: useLLM=false（默认）时不调用任何 LLM 接口
  it('useLLM=false（默认）时 generate() 不调用任何 LLM 接口', async () => {
    mockEnrichModelDescriptions.mockClear();
    mockEnrichFieldDescriptions.mockClear();

    const input: DataModelInput = {
      models: [{
        name: 'User',
        filePath: 'models.py',
        language: 'python',
        kind: 'dataclass',
        fields: [
          { name: 'name', typeStr: 'str', optional: false, defaultValue: null, description: null },
        ],
        bases: [],
        description: null,
      }],
      relations: [],
      sourceFiles: ['models.py'],
    };

    // useLLM=false（默认）
    const output = await generator.generate(input);

    // description 保持为 null（未被 LLM 增强）
    expect(mockEnrichModelDescriptions).not.toHaveBeenCalled();
    expect(mockEnrichFieldDescriptions).not.toHaveBeenCalled();
    expect(output.models[0]!.fields[0]!.description).toBeNull();
    expect(output.summary.totalModels).toBe(1);
  });

  // T034: useLLM 参数未传递时默认为 false
  it('useLLM 参数未传递时默认为 false，行为与变更前一致', async () => {
    mockEnrichModelDescriptions.mockClear();
    mockEnrichFieldDescriptions.mockClear();

    const input: DataModelInput = {
      models: [{
        name: 'Config',
        filePath: 'config.ts',
        language: 'typescript',
        kind: 'interface',
        fields: [
          { name: 'host', typeStr: 'string', optional: false, defaultValue: null, description: null },
          { name: 'port', typeStr: 'number', optional: false, defaultValue: null, description: '端口号' },
        ],
        bases: [],
        description: null,
      }],
      relations: [],
      sourceFiles: ['config.ts'],
    };

    // 不传 options
    const output = await generator.generate(input);

    // description 保持原样
    expect(mockEnrichModelDescriptions).not.toHaveBeenCalled();
    expect(mockEnrichFieldDescriptions).not.toHaveBeenCalled();
    expect(output.models[0]!.fields[0]!.description).toBeNull();
    expect(output.models[0]!.fields[1]!.description).toBe('端口号');
    expect(output.erDiagram).toContain('Config');
  });
});
