/**
 * multi-format-writer 单元测试
 *
 * 覆盖：
 * - T019: markdown 格式——仅生成 .md
 * - T020: json 格式——仅生成 .json，验证 JSON.parse() 成功
 * - T021: all 格式含 mermaid——生成 .md + .json + .mmd
 * - T022: all 格式不含 mermaid——生成 .md + .json，不生成空 .mmd
 * - T023: JSON 特殊字符——包含 Unicode、反斜杠的数据正确序列化
 * - T024: 输出目录自动创建——目录不存在时 mkdirSync recursive
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeMultiFormat } from '../../../src/panoramic/utils/multi-format-writer.js';
import type { WriteMultiFormatOptions } from '../../../src/panoramic/utils/multi-format-writer.js';

// ============================================================
// 辅助函数
// ============================================================

/** 创建临时目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'multi-format-test-'));
}

/** 清理临时目录 */
function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// 测试数据
// ============================================================

const SAMPLE_MARKDOWN = `# 数据模型文档

## 概览

| 指标 | 值 |
|------|-----|
| 模型总数 | 2 |

## User

| 字段 | 类型 | 说明 |
|------|------|------|
| name | str | 用户名 |
`;

const SAMPLE_STRUCTURED_DATA = {
  models: [
    {
      name: 'User',
      filePath: 'models.py',
      language: 'python',
      fields: [
        { name: 'name', typeStr: 'str', description: '用户名' },
      ],
    },
  ],
  summary: { totalModels: 1, totalFields: 1 },
};

const SAMPLE_MERMAID = `erDiagram
    User {
        str name
        int age
    }
    Admin ||--o{ User : "inherits"`;

// ============================================================
// 测试
// ============================================================

describe('writeMultiFormat', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      cleanupDir(tempDir);
    }
  });

  // T019: markdown 格式
  it('markdown 格式——仅生成 .md', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const result = writeMultiFormat({
      outputDir,
      baseName: 'data-model',
      outputFormat: 'markdown',
      markdown: SAMPLE_MARKDOWN,
      structuredData: SAMPLE_STRUCTURED_DATA,
      mermaidSource: SAMPLE_MERMAID,
    });

    // 仅生成 .md
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(path.join(outputDir, 'data-model.md'));

    // 文件内容正确
    const content = fs.readFileSync(result[0]!, 'utf-8');
    expect(content).toBe(SAMPLE_MARKDOWN);

    // 不生成 .json 和 .mmd
    expect(fs.existsSync(path.join(outputDir, 'data-model.json'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'data-model.mmd'))).toBe(false);
  });

  // T020: json 格式
  it('json 格式——仅生成 .json，验证 JSON.parse() 成功', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const result = writeMultiFormat({
      outputDir,
      baseName: 'data-model',
      outputFormat: 'json',
      markdown: SAMPLE_MARKDOWN,
      structuredData: SAMPLE_STRUCTURED_DATA,
    });

    // 仅生成 .json
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(path.join(outputDir, 'data-model.json'));

    // JSON 可被正确解析
    const content = fs.readFileSync(result[0]!, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0].name).toBe('User');
    expect(parsed.summary.totalModels).toBe(1);

    // 不生成 .md 和 .mmd
    expect(fs.existsSync(path.join(outputDir, 'data-model.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'data-model.mmd'))).toBe(false);
  });

  // T021: all 格式含 mermaid
  it('all 格式含 mermaid——生成 .md + .json + .mmd', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const result = writeMultiFormat({
      outputDir,
      baseName: 'data-model',
      outputFormat: 'all',
      markdown: SAMPLE_MARKDOWN,
      structuredData: SAMPLE_STRUCTURED_DATA,
      mermaidSource: SAMPLE_MERMAID,
    });

    // 生成三个文件
    expect(result).toHaveLength(3);
    expect(result).toContain(path.join(outputDir, 'data-model.md'));
    expect(result).toContain(path.join(outputDir, 'data-model.json'));
    expect(result).toContain(path.join(outputDir, 'data-model.mmd'));

    // 验证各文件内容
    const md = fs.readFileSync(path.join(outputDir, 'data-model.md'), 'utf-8');
    expect(md).toBe(SAMPLE_MARKDOWN);

    const json = JSON.parse(fs.readFileSync(path.join(outputDir, 'data-model.json'), 'utf-8'));
    expect(json.models[0].name).toBe('User');

    const mmd = fs.readFileSync(path.join(outputDir, 'data-model.mmd'), 'utf-8');
    expect(mmd).toContain('erDiagram');
    expect(mmd).toContain('User');
  });

  // T022: all 格式不含 mermaid
  it('all 格式不含 mermaid——生成 .md + .json，不生成空 .mmd', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const result = writeMultiFormat({
      outputDir,
      baseName: 'config-reference',
      outputFormat: 'all',
      markdown: SAMPLE_MARKDOWN,
      structuredData: SAMPLE_STRUCTURED_DATA,
      // 不提供 mermaidSource
    });

    // 仅生成 .md + .json
    expect(result).toHaveLength(2);
    expect(result).toContain(path.join(outputDir, 'config-reference.md'));
    expect(result).toContain(path.join(outputDir, 'config-reference.json'));

    // 不生成 .mmd
    expect(fs.existsSync(path.join(outputDir, 'config-reference.mmd'))).toBe(false);
  });

  // all 格式提供空字符串 mermaid 时也不生成 .mmd
  it('all 格式提供空字符串 mermaid 时也不生成 .mmd', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const result = writeMultiFormat({
      outputDir,
      baseName: 'data-model',
      outputFormat: 'all',
      markdown: SAMPLE_MARKDOWN,
      structuredData: SAMPLE_STRUCTURED_DATA,
      mermaidSource: '',
    });

    expect(result).toHaveLength(2);
    expect(fs.existsSync(path.join(outputDir, 'data-model.mmd'))).toBe(false);
  });

  it('all 格式支持额外导出文件，例如 Structurizr DSL', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const result = writeMultiFormat({
      outputDir,
      baseName: 'architecture-ir',
      outputFormat: 'all',
      markdown: SAMPLE_MARKDOWN,
      structuredData: SAMPLE_STRUCTURED_DATA,
      extraFiles: [{
        extension: 'dsl',
        content: 'workspace "test" { }',
      }],
    });

    expect(result).toContain(path.join(outputDir, 'architecture-ir.dsl'));
    expect(fs.readFileSync(path.join(outputDir, 'architecture-ir.dsl'), 'utf-8')).toBe('workspace "test" { }');
  });

  it('非 all 格式不会写出额外文件', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const result = writeMultiFormat({
      outputDir,
      baseName: 'architecture-ir',
      outputFormat: 'json',
      markdown: SAMPLE_MARKDOWN,
      structuredData: SAMPLE_STRUCTURED_DATA,
      extraFiles: [{
        extension: 'dsl',
        content: 'workspace "test" { }',
      }],
    });

    expect(result).toEqual([path.join(outputDir, 'architecture-ir.json')]);
    expect(fs.existsSync(path.join(outputDir, 'architecture-ir.dsl'))).toBe(false);
  });

  // T023: JSON 特殊字符
  it('JSON 特殊字符——包含 Unicode、反斜杠的数据正确序列化', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    const specialData = {
      name: '测试项目',
      path: 'C:\\Users\\test\\project',
      emoji: '🚀',
      quotes: '他说"你好"',
      newline: '第一行\n第二行',
    };

    const result = writeMultiFormat({
      outputDir,
      baseName: 'special',
      outputFormat: 'json',
      markdown: '',
      structuredData: specialData,
    });

    const content = fs.readFileSync(result[0]!, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.name).toBe('测试项目');
    expect(parsed.path).toBe('C:\\Users\\test\\project');
    expect(parsed.emoji).toBe('🚀');
    expect(parsed.quotes).toBe('他说"你好"');
    expect(parsed.newline).toBe('第一行\n第二行');
  });

  // T024: 输出目录自动创建
  it('输出目录自动创建——目录不存在时 mkdirSync recursive', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'a', 'b', 'c', 'output');

    // 验证目录不存在
    expect(fs.existsSync(outputDir)).toBe(false);

    const result = writeMultiFormat({
      outputDir,
      baseName: 'test',
      outputFormat: 'markdown',
      markdown: '# Test',
      structuredData: {},
    });

    // 目录被创建
    expect(fs.existsSync(outputDir)).toBe(true);
    // 文件被写入
    expect(result).toHaveLength(1);
    expect(fs.readFileSync(result[0]!, 'utf-8')).toBe('# Test');
  });

  // JSON 使用 2 空格缩进
  it('JSON 使用 2 空格缩进', () => {
    tempDir = createTempDir();
    const outputDir = path.join(tempDir, 'output');

    writeMultiFormat({
      outputDir,
      baseName: 'test',
      outputFormat: 'json',
      markdown: '',
      structuredData: { key: 'value' },
    });

    const content = fs.readFileSync(path.join(outputDir, 'test.json'), 'utf-8');
    expect(content).toBe('{\n  "key": "value"\n}');
  });
});
