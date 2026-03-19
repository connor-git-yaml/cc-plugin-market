/**
 * EnvConfigParser 单元测试
 * 覆盖 .env 配置文件解析逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EnvConfigParser, parseEnvContent } from '../../src/panoramic/parsers/env-config-parser.js';

// ============================================================
// 辅助函数
// ============================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-config-parser-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// parseEnvContent 函数测试
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
// EnvConfigParser 类测试
// ============================================================

describe('EnvConfigParser', () => {
  const parser = new EnvConfigParser();
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('id 为 "env-config"', () => {
    expect(parser.id).toBe('env-config');
  });

  it('name 为 ".env Config Parser"', () => {
    expect(parser.name).toBe('.env Config Parser');
  });

  it('filePatterns 包含 .env 和 .env.*', () => {
    expect(parser.filePatterns).toContain('**/.env');
    expect(parser.filePatterns).toContain('**/.env.*');
  });

  it('parse() 解析 .env 文件返回 ConfigEntries', async () => {
    const filePath = path.join(tempDir, '.env');
    fs.writeFileSync(filePath, `# 数据库
DATABASE_URL=postgres://localhost/db
PORT=5000`);

    const result = await parser.parse(filePath);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.keyPath).toBe('DATABASE_URL');
    expect(result.entries[0]!.description).toBe('数据库');
  });

  it('parse() 空文件返回空 entries', async () => {
    const filePath = path.join(tempDir, '.env');
    fs.writeFileSync(filePath, '');

    const result = await parser.parse(filePath);
    expect(result.entries).toHaveLength(0);
  });

  it('parse() 文件不存在时降级返回空 entries', async () => {
    const result = await parser.parse('/non/existent/.env');
    expect(result.entries).toHaveLength(0);
  });

  it('parseAll() 批量解析多个文件', async () => {
    const file1 = path.join(tempDir, '.env');
    const file2 = path.join(tempDir, '.env.local');
    fs.writeFileSync(file1, 'KEY1=value1');
    fs.writeFileSync(file2, 'KEY2=value2');

    const results = await parser.parseAll([file1, file2]);
    expect(results).toHaveLength(2);
    expect(results[0]!.entries).toHaveLength(1);
    expect(results[1]!.entries).toHaveLength(1);
  });
});
