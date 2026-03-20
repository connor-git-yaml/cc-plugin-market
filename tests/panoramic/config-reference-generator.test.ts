/**
 * ConfigReferenceGenerator 单元测试
 * 覆盖解析函数（YAML/TOML/.env）、inferType、全生命周期 e2e
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import type * as LlmEnricher from '../../src/panoramic/utils/llm-enricher.js';

vi.mock('../../src/panoramic/utils/llm-enricher.js', async () => {
  const actual = await vi.importActual<typeof LlmEnricher>(
    '../../src/panoramic/utils/llm-enricher.js',
  );

  return {
    ...actual,
    enrichConfigDescriptions: vi.fn(async (files: unknown[]) =>
      JSON.parse(JSON.stringify(files))),
  };
});

import { ConfigReferenceGenerator } from '../../src/panoramic/config-reference-generator.js';
import { parseYamlContent } from '../../src/panoramic/parsers/yaml-config-parser.js';
import { parseEnvContent } from '../../src/panoramic/parsers/env-config-parser.js';
import { parseTomlContent } from '../../src/panoramic/parsers/toml-config-parser.js';
import { inferType } from '../../src/panoramic/parsers/types.js';
import { GeneratorRegistry } from '../../src/panoramic/generator-registry.js';
import { ArtifactParserRegistry, bootstrapParsers } from '../../src/panoramic/parser-registry.js';
import { enrichConfigDescriptions } from '../../src/panoramic/utils/llm-enricher.js';

const mockEnrichConfigDescriptions = vi.mocked(enrichConfigDescriptions);

// ============================================================
// 辅助函数
// ============================================================

/** 创建临时目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-ref-test-'));
}

/** 清理临时目录 */
function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 构建 ProjectContext */
function createContext(projectRoot: string): ProjectContext {
  const configFiles = new Map<string, string>();

  // 扫描根目录文件加入 configFiles
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        configFiles.set(entry.name, path.join(projectRoot, entry.name));
      }
    }
  } catch {
    // 忽略
  }

  return { projectRoot, configFiles };
}

// ============================================================
// inferType
// ============================================================

describe('inferType', () => {
  it('识别 number 类型', () => {
    expect(inferType('42')).toBe('number');
    expect(inferType('-1')).toBe('number');
    expect(inferType('3.14')).toBe('number');
    expect(inferType('-0.5')).toBe('number');
  });

  it('识别 boolean 类型', () => {
    expect(inferType('true')).toBe('boolean');
    expect(inferType('false')).toBe('boolean');
  });

  it('识别 null 类型', () => {
    expect(inferType('null')).toBe('null');
    expect(inferType('~')).toBe('null');
    expect(inferType('')).toBe('null');
  });

  it('识别 array 类型', () => {
    expect(inferType('[1, 2, 3]')).toBe('array');
  });

  it('识别 object 类型', () => {
    expect(inferType('{key: value}')).toBe('object');
  });

  it('默认返回 string 类型', () => {
    expect(inferType('hello')).toBe('string');
    expect(inferType('localhost')).toBe('string');
    expect(inferType('/path/to/file')).toBe('string');
  });
});

// ============================================================
// parseYamlContent
// ============================================================

describe('parseYamlContent', () => {
  it('解析简单键值对', () => {
    const content = `name: my-app
port: 8080
debug: true`;

    const entries = parseYamlContent(content);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      keyPath: 'name',
      type: 'string',
      defaultValue: 'my-app',
      description: '',
    });
    expect(entries[1]).toEqual({
      keyPath: 'port',
      type: 'number',
      defaultValue: '8080',
      description: '',
    });
    expect(entries[2]).toEqual({
      keyPath: 'debug',
      type: 'boolean',
      defaultValue: 'true',
      description: '',
    });
  });

  it('解析嵌套结构（点号路径）', () => {
    const content = `database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: secret`;

    const entries = parseYamlContent(content);
    expect(entries).toHaveLength(4);
    expect(entries[0]!.keyPath).toBe('database.host');
    expect(entries[1]!.keyPath).toBe('database.port');
    expect(entries[2]!.keyPath).toBe('database.credentials.username');
    expect(entries[3]!.keyPath).toBe('database.credentials.password');
  });

  it('提取上方注释作为说明', () => {
    const content = `# 应用端口号
port: 3000
# 数据库连接地址
host: localhost`;

    const entries = parseYamlContent(content);
    expect(entries[0]!.description).toBe('应用端口号');
    expect(entries[1]!.description).toBe('数据库连接地址');
  });

  it('提取行内注释作为说明', () => {
    const content = `port: 3000 # 服务器端口`;

    const entries = parseYamlContent(content);
    expect(entries[0]!.description).toBe('服务器端口');
  });

  it('上方注释优先于行内注释', () => {
    const content = `# 上方说明
port: 3000 # 行内说明`;

    const entries = parseYamlContent(content);
    expect(entries[0]!.description).toBe('上方说明');
  });

  it('处理引号包裹的值', () => {
    const content = `name: "my-project"
path: '/usr/local'`;

    const entries = parseYamlContent(content);
    expect(entries[0]!.defaultValue).toBe('my-project');
    expect(entries[1]!.defaultValue).toBe('/usr/local');
  });

  it('空文件返回空数组', () => {
    const entries = parseYamlContent('');
    expect(entries).toHaveLength(0);
  });

  it('多行注释合并', () => {
    const content = `# 这是第一行注释
# 这是第二行注释
port: 3000`;

    const entries = parseYamlContent(content);
    expect(entries[0]!.description).toBe('这是第一行注释 这是第二行注释');
  });

  it('空行隔断注释关联', () => {
    const content = `# 这个注释不应关联到 port

port: 3000`;

    const entries = parseYamlContent(content);
    expect(entries[0]!.description).toBe('');
  });
});

// ============================================================
// parseEnvContent
// ============================================================

describe('parseEnvContent', () => {
  it('解析标准 KEY=VALUE 格式', () => {
    const content = `DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000
DEBUG=true`;

    const entries = parseEnvContent(content);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      keyPath: 'DATABASE_URL',
      type: 'string',
      defaultValue: 'postgres://localhost:5432/mydb',
      description: '',
    });
    expect(entries[1]!.type).toBe('number');
    expect(entries[2]!.type).toBe('boolean');
  });

  it('提取上方注释关联到环境变量', () => {
    const content = `# 数据库连接字符串
DATABASE_URL=postgres://localhost/db
# 服务器端口
PORT=3000`;

    const entries = parseEnvContent(content);
    expect(entries[0]!.description).toBe('数据库连接字符串');
    expect(entries[1]!.description).toBe('服务器端口');
  });

  it('去除引号包裹的值', () => {
    const content = `NAME="my-app"
PATH='/usr/local/bin'`;

    const entries = parseEnvContent(content);
    expect(entries[0]!.defaultValue).toBe('my-app');
    expect(entries[1]!.defaultValue).toBe('/usr/local/bin');
  });

  it('空文件返回空数组', () => {
    const entries = parseEnvContent('');
    expect(entries).toHaveLength(0);
  });

  it('忽略无效行', () => {
    const content = `VALID=value
这不是有效行
  也不是
ANOTHER=ok`;

    const entries = parseEnvContent(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.keyPath).toBe('VALID');
    expect(entries[1]!.keyPath).toBe('ANOTHER');
  });

  it('空行隔断注释关联', () => {
    const content = `# 不应关联

PORT=3000`;

    const entries = parseEnvContent(content);
    expect(entries[0]!.description).toBe('');
  });
});

// ============================================================
// parseTomlContent
// ============================================================

describe('parseTomlContent', () => {
  it('解析简单键值对', () => {
    const content = `name = "my-app"
version = "1.0.0"
port = 8080`;

    const entries = parseTomlContent(content);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      keyPath: 'name',
      type: 'string',
      defaultValue: 'my-app',
      description: '',
    });
    expect(entries[2]!.type).toBe('number');
  });

  it('解析 [section] 分组', () => {
    const content = `[database]
host = "localhost"
port = 5432

[server]
bind = "0.0.0.0"`;

    const entries = parseTomlContent(content);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.keyPath).toBe('database.host');
    expect(entries[1]!.keyPath).toBe('database.port');
    expect(entries[2]!.keyPath).toBe('server.bind');
  });

  it('解析嵌套 section', () => {
    const content = `[tool.uv.workspace]
members = ["packages/*"]`;

    const entries = parseTomlContent(content);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.keyPath).toBe('tool.uv.workspace.members');
  });

  it('提取上方注释', () => {
    const content = `# 数据库配置
[database]
# 连接主机
host = "localhost"`;

    const entries = parseTomlContent(content);
    expect(entries[0]!.description).toBe('连接主机');
  });

  it('提取行内注释', () => {
    const content = `port = 8080 # 服务端口`;

    const entries = parseTomlContent(content);
    expect(entries[0]!.description).toBe('服务端口');
  });

  it('空文件返回空数组', () => {
    const entries = parseTomlContent('');
    expect(entries).toHaveLength(0);
  });
});

// ============================================================
// ConfigReferenceGenerator — isApplicable
// ============================================================

describe('ConfigReferenceGenerator.isApplicable', () => {
  const generator = new ConfigReferenceGenerator();
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // 确保 ParserRegistry 已初始化（ConfigReferenceGenerator 依赖 ParserRegistry）
    ArtifactParserRegistry.resetInstance();
    bootstrapParsers();
  });

  afterEach(() => {
    cleanupDir(tempDir);
    ArtifactParserRegistry.resetInstance();
  });

  it('项目包含 .yaml 文件时返回 true', () => {
    fs.writeFileSync(path.join(tempDir, 'config.yaml'), 'key: value');
    const ctx = createContext(tempDir);
    expect(generator.isApplicable(ctx)).toBe(true);
  });

  it('项目包含 .env 文件时返回 true', () => {
    fs.writeFileSync(path.join(tempDir, '.env'), 'KEY=value');
    const ctx = createContext(tempDir);
    expect(generator.isApplicable(ctx)).toBe(true);
  });

  it('项目包含 .toml 文件时返回 true', () => {
    fs.writeFileSync(path.join(tempDir, 'config.toml'), 'key = "value"');
    const ctx = createContext(tempDir);
    expect(generator.isApplicable(ctx)).toBe(true);
  });

  it('项目无配置文件时返回 false', () => {
    fs.writeFileSync(path.join(tempDir, 'index.ts'), 'console.log("hello")');
    const ctx = createContext(tempDir);
    expect(generator.isApplicable(ctx)).toBe(false);
  });

  it('空目录返回 false', () => {
    const ctx = createContext(tempDir);
    expect(generator.isApplicable(ctx)).toBe(false);
  });
});

// ============================================================
// ConfigReferenceGenerator — 全生命周期 e2e
// ============================================================

describe('ConfigReferenceGenerator 全生命周期 e2e', () => {
  const generator = new ConfigReferenceGenerator();
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // 确保 ParserRegistry 已初始化
    ArtifactParserRegistry.resetInstance();
    bootstrapParsers();
    // 复制模板文件到 tempDir/templates/
    const srcTemplateDir = path.join(process.cwd(), 'templates');
    const destTemplateDir = path.join(tempDir, 'templates');
    fs.mkdirSync(destTemplateDir, { recursive: true });
    fs.copyFileSync(
      path.join(srcTemplateDir, 'config-reference.hbs'),
      path.join(destTemplateDir, 'config-reference.hbs'),
    );
  });

  afterEach(() => {
    cleanupDir(tempDir);
    ArtifactParserRegistry.resetInstance();
  });

  it('YAML 文件: extract → generate → render 完整链路', async () => {
    const yamlContent = `# 应用配置
app:
  # 应用名称
  name: my-service
  # 端口号
  port: 3000
  debug: false`;

    fs.writeFileSync(path.join(tempDir, 'config.yaml'), yamlContent);
    const ctx = createContext(tempDir);

    // extract
    const input = await generator.extract(ctx);
    expect(input.files.length).toBeGreaterThanOrEqual(1);

    const yamlFile = input.files.find((f) => f.filePath === 'config.yaml');
    expect(yamlFile).toBeDefined();
    expect(yamlFile!.format).toBe('yaml');
    expect(yamlFile!.entries.length).toBe(3);

    // generate
    const output = await generator.generate(input);
    expect(output.totalEntries).toBe(3);
    expect(output.files.length).toBeGreaterThanOrEqual(1);

    // render
    const markdown = generator.render(output);
    expect(markdown).toContain('config.yaml');
    expect(markdown).toContain('app.name');
    expect(markdown).toContain('app.port');
    expect(markdown).toContain('应用名称');
    expect(markdown).toContain('端口号');
  });

  it('.env 文件: extract → generate → render 完整链路', async () => {
    const envContent = `# 数据库连接
DATABASE_URL=postgres://localhost/mydb
# 运行端口
PORT=5000
SECRET_KEY=abc123`;

    fs.writeFileSync(path.join(tempDir, '.env'), envContent);
    const ctx = createContext(tempDir);

    const input = await generator.extract(ctx);
    const envFile = input.files.find((f) => f.filePath === '.env');
    expect(envFile).toBeDefined();
    expect(envFile!.entries.length).toBe(3);
    expect(envFile!.entries[0]!.description).toBe('数据库连接');

    const output = await generator.generate(input);
    const markdown = generator.render(output);
    expect(markdown).toContain('DATABASE_URL');
    expect(markdown).toContain('PORT');
    expect(markdown).toContain('数据库连接');
  });

  it('TOML 文件: extract → generate → render 完整链路', async () => {
    const tomlContent = `[project]
name = "my-tool"
version = "2.0.0"

[database]
# 数据库端口
port = 5432
host = "localhost"`;

    fs.writeFileSync(path.join(tempDir, 'config.toml'), tomlContent);
    const ctx = createContext(tempDir);

    const input = await generator.extract(ctx);
    const tomlFile = input.files.find((f) => f.filePath === 'config.toml');
    expect(tomlFile).toBeDefined();
    expect(tomlFile!.entries.length).toBe(4);
    expect(tomlFile!.entries[0]!.keyPath).toBe('project.name');

    const output = await generator.generate(input);
    const markdown = generator.render(output);
    expect(markdown).toContain('project.name');
    expect(markdown).toContain('database.port');
    expect(markdown).toContain('数据库端口');
  });

  it('多文件聚合: YAML + .env + TOML', async () => {
    fs.writeFileSync(path.join(tempDir, 'app.yaml'), 'port: 3000');
    fs.writeFileSync(path.join(tempDir, '.env'), 'DB_HOST=localhost');
    fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), '[tool.test]\nkey = "value"');

    const ctx = createContext(tempDir);

    const input = await generator.extract(ctx);
    expect(input.files.length).toBe(3);

    const output = await generator.generate(input);
    expect(output.totalEntries).toBe(3);
    expect(output.files.length).toBe(3);

    const markdown = generator.render(output);
    expect(markdown).toContain('app.yaml');
    expect(markdown).toContain('.env');
    expect(markdown).toContain('pyproject.toml');
  });

  it('空配置文件: entries 为空但不报错', async () => {
    fs.writeFileSync(path.join(tempDir, 'empty.yaml'), '');
    const ctx = createContext(tempDir);

    const input = await generator.extract(ctx);
    const emptyFile = input.files.find((f) => f.filePath === 'empty.yaml');
    expect(emptyFile).toBeDefined();
    expect(emptyFile!.entries).toHaveLength(0);
  });
});

// ============================================================
// ConfigReferenceGenerator — 只读属性
// ============================================================

describe('ConfigReferenceGenerator 只读属性', () => {
  const generator = new ConfigReferenceGenerator();

  it('id 为 "config-reference"', () => {
    expect(generator.id).toBe('config-reference');
  });

  it('name 非空', () => {
    expect(generator.name.length).toBeGreaterThan(0);
  });

  it('description 非空', () => {
    expect(generator.description.length).toBeGreaterThan(0);
  });
});

// ============================================================
// GeneratorRegistry 集成
// ============================================================

describe('ConfigReferenceGenerator — GeneratorRegistry 集成', () => {
  beforeEach(() => {
    GeneratorRegistry.resetInstance();
    ArtifactParserRegistry.resetInstance();
    bootstrapParsers();
  });

  afterEach(() => {
    GeneratorRegistry.resetInstance();
    ArtifactParserRegistry.resetInstance();
  });

  it('可通过 Registry 按 id 查询', () => {
    const registry = GeneratorRegistry.getInstance();
    registry.register(new ConfigReferenceGenerator());

    const found = registry.get('config-reference');
    expect(found).toBeDefined();
    expect(found!.id).toBe('config-reference');
  });

  it('在 list() 中可见', () => {
    const registry = GeneratorRegistry.getInstance();
    registry.register(new ConfigReferenceGenerator());

    const list = registry.list();
    const entry = list.find((e) => e.generator.id === 'config-reference');
    expect(entry).toBeDefined();
    expect(entry!.enabled).toBe(true);
  });

  it('filterByContext 对包含配置文件的项目返回 ConfigReferenceGenerator', async () => {
    const tempDir = createTempDir();
    try {
      fs.writeFileSync(path.join(tempDir, 'config.yaml'), 'key: value');

      const registry = GeneratorRegistry.getInstance();
      registry.register(new ConfigReferenceGenerator());

      const ctx = createContext(tempDir);
      const applicable = await registry.filterByContext(ctx);
      expect(applicable.some((g) => g.id === 'config-reference')).toBe(true);
    } finally {
      cleanupDir(tempDir);
    }
  });

  it('filterByContext 对无配置文件的项目不返回 ConfigReferenceGenerator', async () => {
    const tempDir = createTempDir();
    try {
      fs.writeFileSync(path.join(tempDir, 'index.ts'), 'export {}');

      const registry = GeneratorRegistry.getInstance();
      registry.register(new ConfigReferenceGenerator());

      const ctx = createContext(tempDir);
      const applicable = await registry.filterByContext(ctx);
      expect(applicable.some((g) => g.id === 'config-reference')).toBe(false);
    } finally {
      cleanupDir(tempDir);
    }
  });
});

// ============================================================
// T016: ConfigReferenceGenerator useLLM=true 集成测试
// ============================================================

describe('ConfigReferenceGenerator.generate with useLLM=true（集成测试）', () => {
  const generator = new ConfigReferenceGenerator();

  beforeEach(() => {
    mockEnrichConfigDescriptions.mockClear();
  });

  it('useLLM=true 时触发 llm-enricher 路径且不依赖真实外部模型', async () => {
    const input = {
      files: [{
        filePath: 'config.yaml',
        format: 'yaml' as const,
        entries: [
          { keyPath: 'app.name', type: 'string' as const, defaultValue: 'test', description: '' },
          { keyPath: 'app.port', type: 'number' as const, defaultValue: '3000', description: '已有说明' },
        ],
      }],
      projectName: 'test-project',
    };

    const output = await generator.generate(input, { useLLM: true });

    expect(mockEnrichConfigDescriptions).toHaveBeenCalledTimes(1);
    expect(output.totalEntries).toBe(2);
    expect(output.files).toHaveLength(1);
    expect(output.files[0]!.entries[1]!.description).toBe('已有说明');
  });
});

// ============================================================
// T033: useLLM=false 回归测试
// ============================================================

describe('ConfigReferenceGenerator 回归测试——useLLM=false 不调用 LLM', () => {
  const generator = new ConfigReferenceGenerator();

  it('useLLM=false（默认）时 generate() 不调用任何 LLM 接口', async () => {
    mockEnrichConfigDescriptions.mockClear();

    const input = {
      files: [{
        filePath: 'config.yaml',
        format: 'yaml' as const,
        entries: [
          { keyPath: 'app.name', type: 'string' as const, defaultValue: 'test', description: '' },
          { keyPath: 'app.port', type: 'number' as const, defaultValue: '3000', description: '端口号' },
        ],
      }],
      projectName: 'test-project',
    };

    // useLLM=false（默认）
    const output = await generator.generate(input);

    // description 保持原样
    expect(mockEnrichConfigDescriptions).not.toHaveBeenCalled();
    expect(output.files[0]!.entries[0]!.description).toBe('');
    expect(output.files[0]!.entries[1]!.description).toBe('端口号');
    expect(output.totalEntries).toBe(2);
  });
});
