/**
 * YamlConfigParser 单元测试
 * 覆盖 YAML 配置文件解析逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { YamlConfigParser, parseYamlContent } from '../../src/panoramic/parsers/yaml-config-parser.js';

// ============================================================
// 辅助函数
// ============================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-config-parser-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// parseYamlContent 函数测试
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
// YamlConfigParser 类测试
// ============================================================

describe('YamlConfigParser', () => {
  const parser = new YamlConfigParser();
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('id 为 "yaml-config"', () => {
    expect(parser.id).toBe('yaml-config');
  });

  it('name 为 "YAML Config Parser"', () => {
    expect(parser.name).toBe('YAML Config Parser');
  });

  it('filePatterns 包含 .yaml 和 .yml', () => {
    expect(parser.filePatterns).toContain('**/*.yaml');
    expect(parser.filePatterns).toContain('**/*.yml');
  });

  it('parse() 解析 YAML 文件返回 ConfigEntries', async () => {
    const filePath = path.join(tempDir, 'config.yaml');
    fs.writeFileSync(filePath, `# 端口号
port: 3000
host: localhost`);

    const result = await parser.parse(filePath);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.keyPath).toBe('port');
    expect(result.entries[0]!.description).toBe('端口号');
  });

  it('parse() 空文件返回空 entries', async () => {
    const filePath = path.join(tempDir, 'empty.yaml');
    fs.writeFileSync(filePath, '');

    const result = await parser.parse(filePath);
    expect(result.entries).toHaveLength(0);
  });

  it('parse() 文件不存在时降级返回空 entries', async () => {
    const result = await parser.parse('/non/existent/file.yaml');
    expect(result.entries).toHaveLength(0);
  });

  it('parseAll() 批量解析多个文件', async () => {
    const file1 = path.join(tempDir, 'a.yaml');
    const file2 = path.join(tempDir, 'b.yml');
    fs.writeFileSync(file1, 'key1: value1');
    fs.writeFileSync(file2, 'key2: value2');

    const results = await parser.parseAll([file1, file2]);
    expect(results).toHaveLength(2);
    expect(results[0]!.entries).toHaveLength(1);
    expect(results[1]!.entries).toHaveLength(1);
  });
});
