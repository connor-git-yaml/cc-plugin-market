/**
 * DockerfileParser 单元测试
 *
 * 覆盖场景：
 * - 单阶段解析
 * - 多阶段解析（多个 FROM + AS alias）
 * - 多行拼接（续行符 \）
 * - 注释和空行过滤
 * - FROM 前 ARG
 * - 空文件降级
 * - 文件不存在降级
 * - filePatterns 属性验证
 * - id 和 name 属性验证
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { DockerfileParser } from '../../src/panoramic/parsers/dockerfile-parser.js';

// fixture 文件目录
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/dockerfile');

describe('DockerfileParser', () => {
  const parser = new DockerfileParser();

  // ============================================================
  // 元数据验证
  // ============================================================

  it('id 应为 "dockerfile"', () => {
    expect(parser.id).toBe('dockerfile');
  });

  it('name 应为 "Dockerfile Parser"', () => {
    expect(parser.name).toBe('Dockerfile Parser');
  });

  it('filePatterns 应包含 Dockerfile 和 Dockerfile.* 模式', () => {
    const patterns = [...parser.filePatterns];
    expect(patterns).toContain('**/Dockerfile');
    expect(patterns).toContain('**/Dockerfile.*');
  });

  // ============================================================
  // 单阶段解析
  // ============================================================

  it('解析单阶段 Dockerfile —— stages 长度为 1', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'single-stage.Dockerfile'));

    expect(result.stages).toHaveLength(1);

    const stage = result.stages[0]!;
    expect(stage.baseImage).toBe('node:20-alpine');
    expect(stage.alias).toBeUndefined();

    // 应包含 WORKDIR、COPY、RUN、EXPOSE、CMD 等指令
    const types = stage.instructions.map((i) => i.type);
    expect(types).toContain('WORKDIR');
    expect(types).toContain('COPY');
    expect(types).toContain('RUN');
    expect(types).toContain('EXPOSE');
    expect(types).toContain('CMD');
  });

  // ============================================================
  // 多阶段解析
  // ============================================================

  it('解析多阶段 Dockerfile —— 正确提取多个 stage', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'multi-stage.Dockerfile'));

    expect(result.stages).toHaveLength(2);

    // builder 阶段
    const builder = result.stages[0]!;
    expect(builder.baseImage).toBe('node:20-alpine');
    expect(builder.alias).toBe('builder');

    // runner 阶段
    const runner = result.stages[1]!;
    expect(runner.baseImage).toBe('node:20-alpine');
    expect(runner.alias).toBe('runner');

    // runner 阶段应包含 COPY --from=builder、ENV 等指令
    const runnerTypes = runner.instructions.map((i) => i.type);
    expect(runnerTypes).toContain('COPY');
    expect(runnerTypes).toContain('ENV');
    expect(runnerTypes).toContain('CMD');
  });

  // ============================================================
  // 多行拼接
  // ============================================================

  it('解析多行拼接 —— 续行符被正确拼接', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'multiline.Dockerfile'));

    expect(result.stages).toHaveLength(1);

    const stage = result.stages[0]!;

    // 找到 RUN 指令
    const runInst = stage.instructions.find((i) => i.type === 'RUN');
    expect(runInst).toBeDefined();

    // 多行应被拼接为单条，args 不含行尾 \
    expect(runInst!.args).not.toContain('\\\n');
    expect(runInst!.args).toContain('apt-get update');
    expect(runInst!.args).toContain('rm -rf');

    // 找到 ENV 指令
    const envInst = stage.instructions.find((i) => i.type === 'ENV');
    expect(envInst).toBeDefined();
    expect(envInst!.args).toContain('APP_HOME=/opt/app');
    expect(envInst!.args).toContain('APP_PORT=3000');
  });

  // ============================================================
  // 注释和空行过滤
  // ============================================================

  it('解析仅含注释的 Dockerfile —— stages 为空', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'comments-only.Dockerfile'));
    expect(result.stages).toEqual([]);
  });

  // ============================================================
  // FROM 前 ARG
  // ============================================================

  it('解析 FROM 前 ARG —— 全局 ARG 不归属 stage', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'arg-before-from.Dockerfile'));

    // 应有 1 个 stage
    expect(result.stages).toHaveLength(1);

    const stage = result.stages[0]!;
    expect(stage.baseImage).toBe('node:${NODE_VERSION}-alpine${ALPINE_VERSION}');

    // stage 内的指令不应包含全局 ARG
    const argInstructions = stage.instructions.filter((i) => i.type === 'ARG');
    expect(argInstructions).toHaveLength(0);
  });

  // ============================================================
  // 空文件降级
  // ============================================================

  it('空文件 —— 返回 { stages: [] }', async () => {
    // 使用 empty fixture（借用 skill-md 的空文件来测试空内容场景）
    const result = await parser.parse(path.join(FIXTURES_DIR, '..', 'skill-md', 'empty.skill.md'));
    expect(result.stages).toEqual([]);
  });

  // ============================================================
  // 文件不存在降级
  // ============================================================

  it('文件不存在 —— 返回降级结果而非抛异常', async () => {
    const result = await parser.parse(path.join(FIXTURES_DIR, 'nonexistent.Dockerfile'));
    expect(result.stages).toEqual([]);
  });

  // ============================================================
  // parseAll 批量解析（Phase 5: T018）
  // ============================================================

  describe('parseAll', () => {
    it('3 个文件调用 parseAll —— 返回长度为 3', async () => {
      const filePaths = [
        path.join(FIXTURES_DIR, 'single-stage.Dockerfile'),
        path.join(FIXTURES_DIR, 'multi-stage.Dockerfile'),
        path.join(FIXTURES_DIR, 'multiline.Dockerfile'),
      ];

      const results = await parser.parseAll(filePaths);
      expect(results).toHaveLength(3);
      expect(results[0]!.stages).toHaveLength(1);
      expect(results[1]!.stages).toHaveLength(2);
      expect(results[2]!.stages).toHaveLength(1);
    });

    it('空数组调用 parseAll —— 返回空数组', async () => {
      const results = await parser.parseAll([]);
      expect(results).toEqual([]);
    });

    it('含不存在文件的路径 —— 返回长度不变且降级结果在正确位置', async () => {
      const filePaths = [
        path.join(FIXTURES_DIR, 'single-stage.Dockerfile'),
        path.join(FIXTURES_DIR, 'nonexistent.Dockerfile'),
        path.join(FIXTURES_DIR, 'multi-stage.Dockerfile'),
      ];

      const results = await parser.parseAll(filePaths);
      expect(results).toHaveLength(3);
      expect(results[0]!.stages).toHaveLength(1);
      expect(results[1]!.stages).toEqual([]);
      expect(results[2]!.stages).toHaveLength(2);
    });
  });

  // ============================================================
  // 容错边界测试（Phase 6: T021）
  // ============================================================

  describe('容错边界', () => {
    it('二进制内容文件 —— 返回降级结果', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dockerfile-test-'));
      const tmpFile = path.join(tmpDir, 'Dockerfile');
      fs.writeFileSync(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      try {
        const result = await parser.parse(tmpFile);
        expect(result).toBeDefined();
        expect(result.stages).toBeDefined();
        expect(Array.isArray(result.stages)).toBe(true);
      } finally {
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
      }
    });

    it('仅注释行的 Dockerfile（无 FROM） —— 返回 { stages: [] }', async () => {
      const result = await parser.parse(path.join(FIXTURES_DIR, 'comments-only.Dockerfile'));
      expect(result.stages).toEqual([]);
    });
  });
});
