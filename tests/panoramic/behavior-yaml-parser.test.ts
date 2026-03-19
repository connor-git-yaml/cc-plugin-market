/**
 * BehaviorYamlParser 单元测试
 *
 * 覆盖场景：
 * - YAML 格式解析（states + actions）
 * - Markdown 格式解析（标题/段落/列表）
 * - 无效格式降级
 * - 空文件降级
 * - 文件不存在降级
 * - filePatterns 属性验证
 * - id 和 name 属性验证
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { BehaviorYamlParser } from '../../src/panoramic/parsers/behavior-yaml-parser.js';

// fixture 文件目录
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/behavior');

describe('BehaviorYamlParser', () => {
  const parser = new BehaviorYamlParser();

  // ============================================================
  // 元数据验证
  // ============================================================

  it('id 应为 "behavior-yaml"', () => {
    expect(parser.id).toBe('behavior-yaml');
  });

  it('name 应为 "Behavior YAML Parser"', () => {
    expect(parser.name).toBe('Behavior YAML Parser');
  });

  it('filePatterns 应包含 yaml/yml/md 三种模式', () => {
    const patterns = [...parser.filePatterns];
    expect(patterns).toContain('**/behavior/**/*.yaml');
    expect(patterns).toContain('**/behavior/**/*.yml');
    expect(patterns).toContain('**/behavior/**/*.md');
  });

  // ============================================================
  // YAML 格式解析
  // ============================================================

  it('解析 YAML 格式 —— 正确提取 states 和 actions', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'standard.yaml'));

    expect(result.states).toHaveLength(3);

    // idle 状态
    const idle = result.states.find((s) => s.name === 'idle');
    expect(idle).toBeDefined();
    expect(idle!.description).toBe('Waiting for user input');
    expect(idle!.actions).toEqual(['listen', 'display_prompt']);

    // processing 状态
    const processing = result.states.find((s) => s.name === 'processing');
    expect(processing).toBeDefined();
    expect(processing!.description).toBe('Handling a request');
    expect(processing!.actions).toEqual(['parse_input', 'validate_data', 'execute_command']);

    // error 状态
    const errorState = result.states.find((s) => s.name === 'error');
    expect(errorState).toBeDefined();
    expect(errorState!.actions).toEqual(['log_error', 'notify_user', 'retry']);
  });

  // ============================================================
  // Markdown 格式解析
  // ============================================================

  it('解析 Markdown 格式 —— 从标题/段落/列表提取状态', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'markdown-format.md'));

    expect(result.states.length).toBeGreaterThanOrEqual(3);

    // Initialization 状态
    const init = result.states.find((s) => s.name === 'Initialization');
    expect(init).toBeDefined();
    expect(init!.description).toContain('Set up the environment');
    expect(init!.actions).toContain('load_config');
    expect(init!.actions).toContain('check_dependencies');
    expect(init!.actions).toContain('initialize_modules');

    // Running 状态
    const running = result.states.find((s) => s.name === 'Running');
    expect(running).toBeDefined();
    expect(running!.actions).toContain('poll_queue');

    // Shutdown 状态
    const shutdown = result.states.find((s) => s.name === 'Shutdown');
    expect(shutdown).toBeDefined();
    expect(shutdown!.actions).toContain('flush_buffers');
  });

  // ============================================================
  // 无效格式降级
  // ============================================================

  it('解析无效格式 —— 返回 { states: [] }', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'invalid.yaml'));
    expect(result.states).toEqual([]);
  });

  // ============================================================
  // 空文件降级
  // ============================================================

  it('解析空文件 —— 返回降级结果', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'empty.yaml'));
    expect(result.states).toEqual([]);
  });

  // ============================================================
  // 文件不存在降级
  // ============================================================

  it('文件不存在 —— 返回降级结果而非抛异常', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'nonexistent.yaml'));
    expect(result.states).toEqual([]);
  });

  // ============================================================
  // parseAll 批量解析（Phase 5: T017）
  // ============================================================

  describe('parseAll', () => {
    it('3 个文件调用 parseAll —— 返回长度为 3', async () => {
      const filePaths = [
        path.join(FIXTURES_DIR, 'standard.yaml'),
        path.join(FIXTURES_DIR, 'markdown-format.md'),
        path.join(FIXTURES_DIR, 'invalid.yaml'),
      ];

      const results = await parser.parseAll(filePaths);
      expect(results).toHaveLength(3);
      // 第一个有 3 个 states
      expect(results[0]!.states).toHaveLength(3);
      // 第二个有 3 个 states（Markdown 格式）
      expect(results[1]!.states.length).toBeGreaterThanOrEqual(3);
      // 第三个无效格式，states 为空
      expect(results[2]!.states).toEqual([]);
    });

    it('空数组调用 parseAll —— 返回空数组', async () => {
      const results = await parser.parseAll([]);
      expect(results).toEqual([]);
    });

    it('含不存在文件的路径 —— 返回长度不变且降级结果在正确位置', async () => {
      const filePaths = [
        path.join(FIXTURES_DIR, 'standard.yaml'),
        path.join(FIXTURES_DIR, 'nonexistent.yaml'),
        path.join(FIXTURES_DIR, 'markdown-format.md'),
      ];

      const results = await parser.parseAll(filePaths);
      expect(results).toHaveLength(3);
      expect(results[0]!.states).toHaveLength(3);
      expect(results[1]!.states).toEqual([]);
      expect(results[2]!.states.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ============================================================
  // 容错边界测试（Phase 6: T020）
  // ============================================================

  describe('容错边界', () => {
    it('二进制内容文件 —— 返回降级结果', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavior-test-'));
      const tmpFile = path.join(tmpDir, 'binary.yaml');
      fs.writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      try {
        const result = await parser.parse(tmpFile);
        expect(result).toBeDefined();
        expect(result.states).toBeDefined();
        expect(Array.isArray(result.states)).toBe(true);
      } finally {
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
      }
    });
  });
});
