/**
 * SkillMdParser 单元测试
 *
 * 覆盖场景：
 * - 标准 SKILL.md 解析（含 frontmatter + sections）
 * - 无 frontmatter 降级（从一级标题推断 name）
 * - 空文件降级
 * - 重复标题保留
 * - 文件不存在降级
 * - filePatterns 属性验证
 * - id 和 name 属性验证
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { SkillMdParser } from '../../src/panoramic/parsers/skill-md-parser.js';

// fixture 文件目录
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/skill-md');

describe('SkillMdParser', () => {
  const parser = new SkillMdParser();

  // ============================================================
  // 元数据验证
  // ============================================================

  it('id 应为 "skill-md"', () => {
    expect(parser.id).toBe('skill-md');
  });

  it('name 应为 "SKILL.md Parser"', () => {
    expect(parser.name).toBe('SKILL.md Parser');
  });

  it('filePatterns 应为 ["**/SKILL.md"]', () => {
    expect([...parser.filePatterns]).toEqual(['**/SKILL.md']);
  });

  // ============================================================
  // 标准 SKILL.md 解析
  // ============================================================

  it('解析标准 SKILL.md —— 正确提取 frontmatter 和 sections', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'standard.skill.md'));

    // frontmatter 字段
    expect(result.name).toBe('code-review');
    expect(result.description).toBe('Automated code review skill');
    expect(result.version).toBe('1.2.0');

    // 一级标题
    expect(result.title).toBe('Code Review Skill');

    // sections
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0]!.heading).toBe('Commands');
    expect(result.sections[1]!.heading).toBe('Workflow');
    expect(result.sections[2]!.heading).toBe('Constraints');

    // section 内容包含原始 Markdown
    expect(result.sections[0]!.content).toContain('/review');
    expect(result.sections[1]!.content).toContain('Developer opens a PR');
  });

  // ============================================================
  // 无 frontmatter 降级
  // ============================================================

  it('解析无 frontmatter 的 SKILL.md —— 从一级标题推断 name', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'no-frontmatter.skill.md'));

    // name 从一级标题推断
    expect(result.name).toBe('Deploy Automation');
    expect(result.description).toBe('');
    expect(result.version).toBeUndefined();

    // 一级标题
    expect(result.title).toBe('Deploy Automation');

    // sections
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.heading).toBe('Steps');
    expect(result.sections[1]!.heading).toBe('Configuration');
  });

  // ============================================================
  // 空文件降级
  // ============================================================

  it('解析空文件 —— 返回降级结果', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'empty.skill.md'));

    expect(result.name).toBe('');
    expect(result.description).toBe('');
    expect(result.title).toBe('');
    expect(result.sections).toEqual([]);
  });

  // ============================================================
  // 重复标题
  // ============================================================

  it('解析含重复标题的 SKILL.md —— 保留全部同名条目', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'duplicate-headings.skill.md'));

    // 应有 4 个 sections（Commands x2, Notes x2）
    expect(result.sections).toHaveLength(4);

    const commandSections = result.sections.filter((s) => s.heading === 'Commands');
    expect(commandSections).toHaveLength(2);

    const notesSections = result.sections.filter((s) => s.heading === 'Notes');
    expect(notesSections).toHaveLength(2);

    // 内容各不相同
    expect(commandSections[0]!.content).toContain('/start');
    expect(commandSections[1]!.content).toContain('/stop');
  });

  // ============================================================
  // 文件不存在降级
  // ============================================================

  it('文件不存在 —— 返回降级结果而非抛异常', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'nonexistent.skill.md'));

    expect(result.name).toBe('');
    expect(result.description).toBe('');
    expect(result.title).toBe('');
    expect(result.sections).toEqual([]);
  });

  // ============================================================
  // parseAll 批量解析（Phase 5: T016）
  // ============================================================

  describe('parseAll', () => {
    it('3 个文件调用 parseAll —— 返回长度为 3', async () => {
      const filePaths = [
        path.join(FIXTURES_DIR, 'standard.skill.md'),
        path.join(FIXTURES_DIR, 'no-frontmatter.skill.md'),
        path.join(FIXTURES_DIR, 'duplicate-headings.skill.md'),
      ];

      const results = await parser.parseAll(filePaths);
      expect(results).toHaveLength(3);
      expect(results[0]!.name).toBe('code-review');
      expect(results[1]!.name).toBe('Deploy Automation');
      expect(results[2]!.name).toBe('multi-section');
    });

    it('空数组调用 parseAll —— 返回空数组', async () => {
      const results = await parser.parseAll([]);
      expect(results).toEqual([]);
    });

    it('含 1 个不存在文件的 3 个路径 —— 返回长度为 3 且降级结果在正确位置', async () => {
      const filePaths = [
        path.join(FIXTURES_DIR, 'standard.skill.md'),
        path.join(FIXTURES_DIR, 'nonexistent.skill.md'),
        path.join(FIXTURES_DIR, 'no-frontmatter.skill.md'),
      ];

      const results = await parser.parseAll(filePaths);
      expect(results).toHaveLength(3);

      // 第一个正常
      expect(results[0]!.name).toBe('code-review');
      // 第二个降级
      expect(results[1]!.name).toBe('');
      expect(results[1]!.sections).toEqual([]);
      // 第三个正常
      expect(results[2]!.name).toBe('Deploy Automation');
    });
  });

  // ============================================================
  // 容错边界测试（Phase 6: T019）
  // ============================================================

  describe('容错边界', () => {
    it('二进制内容文件 —— 返回降级结果', async () => {
      // 创建临时二进制文件
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-md-test-'));
      const tmpFile = path.join(tmpDir, 'binary.skill.md');
      fs.writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]));

      try {
        const result = await parser.parse(tmpFile);
        // 二进制内容无法产生有意义的解析，应返回降级或空结果
        expect(result).toBeDefined();
        expect(result.sections).toBeDefined();
        expect(Array.isArray(result.sections)).toBe(true);
      } finally {
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
      }
    });

    it('非 UTF-8 编码文件 —— 返回降级结果', async () => {
      // 创建包含非 UTF-8 字节序列的临时文件
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-md-test-'));
      const tmpFile = path.join(tmpDir, 'non-utf8.skill.md');
      // Latin-1 编码的内容，包含超出 ASCII 的字节
      fs.writeFileSync(tmpFile, Buffer.from([0xff, 0xfe, 0xe9, 0xe8, 0xe0]));

      try {
        const result = await parser.parse(tmpFile);
        // 即使内容混乱，也应该不抛异常
        expect(result).toBeDefined();
        expect(result.sections).toBeDefined();
      } finally {
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
      }
    });
  });
});
