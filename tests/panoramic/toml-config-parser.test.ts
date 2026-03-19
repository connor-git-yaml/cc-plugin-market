/**
 * TomlConfigParser 单元测试
 * 覆盖 TOML 配置文件解析逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TomlConfigParser, parseTomlContent } from '../../src/panoramic/parsers/toml-config-parser.js';

// ============================================================
// 辅助函数
// ============================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toml-config-parser-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// parseTomlContent 函数测试
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
// TomlConfigParser 类测试
// ============================================================

describe('TomlConfigParser', () => {
  const parser = new TomlConfigParser();
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('id 为 "toml-config"', () => {
    expect(parser.id).toBe('toml-config');
  });

  it('name 为 "TOML Config Parser"', () => {
    expect(parser.name).toBe('TOML Config Parser');
  });

  it('filePatterns 包含 .toml', () => {
    expect(parser.filePatterns).toContain('**/*.toml');
  });

  it('parse() 解析 TOML 文件返回 ConfigEntries', async () => {
    const filePath = path.join(tempDir, 'config.toml');
    fs.writeFileSync(filePath, `[project]
name = "my-tool"
# 版本号
version = "2.0.0"`);

    const result = await parser.parse(filePath);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.keyPath).toBe('project.name');
    expect(result.entries[1]!.description).toBe('版本号');
  });

  it('parse() 空文件返回空 entries', async () => {
    const filePath = path.join(tempDir, 'empty.toml');
    fs.writeFileSync(filePath, '');

    const result = await parser.parse(filePath);
    expect(result.entries).toHaveLength(0);
  });

  it('parse() 文件不存在时降级返回空 entries', async () => {
    const result = await parser.parse('/non/existent/config.toml');
    expect(result.entries).toHaveLength(0);
  });

  it('parseAll() 批量解析多个文件', async () => {
    const file1 = path.join(tempDir, 'a.toml');
    const file2 = path.join(tempDir, 'b.toml');
    fs.writeFileSync(file1, 'key1 = "value1"');
    fs.writeFileSync(file2, 'key2 = "value2"');

    const results = await parser.parseAll([file1, file2]);
    expect(results).toHaveLength(2);
    expect(results[0]!.entries).toHaveLength(1);
    expect(results[1]!.entries).toHaveLength(1);
  });
});
