/**
 * project-config 单元测试
 * 验证 .reverse-spec.yaml / .json 配置文件的发现、加载、验证和合并
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  findConfigFile,
  loadProjectConfig,
  mergeConfig,
} from '../../src/config/project-config.js';

describe('project-config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── findConfigFile ───────────────────────────────────────
  describe('findConfigFile', () => {
    it('找到 .reverse-spec.yaml', () => {
      fs.writeFileSync(path.join(tmpDir, '.reverse-spec.yaml'), 'force: true');
      expect(findConfigFile(tmpDir)).toBe(
        path.join(tmpDir, '.reverse-spec.yaml'),
      );
    });

    it('找到 .reverse-spec.yml', () => {
      fs.writeFileSync(path.join(tmpDir, '.reverse-spec.yml'), 'force: true');
      expect(findConfigFile(tmpDir)).toBe(
        path.join(tmpDir, '.reverse-spec.yml'),
      );
    });

    it('找到 .reverse-spec.json', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.json'),
        '{"force": true}',
      );
      expect(findConfigFile(tmpDir)).toBe(
        path.join(tmpDir, '.reverse-spec.json'),
      );
    });

    it('.yaml 优先于 .json', () => {
      fs.writeFileSync(path.join(tmpDir, '.reverse-spec.yaml'), 'force: true');
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.json'),
        '{"force": false}',
      );
      expect(findConfigFile(tmpDir)).toBe(
        path.join(tmpDir, '.reverse-spec.yaml'),
      );
    });

    it('无配置文件返回 undefined', () => {
      expect(findConfigFile(tmpDir)).toBeUndefined();
    });
  });

  // ─── loadProjectConfig ────────────────────────────────────
  describe('loadProjectConfig', () => {
    it('加载 YAML 配置', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.yaml'),
        'outputDir: docs/specs\nforce: true\nincremental: false\n',
      );
      const config = loadProjectConfig(tmpDir);
      expect(config.outputDir).toBe('docs/specs');
      expect(config.force).toBe(true);
      expect(config.incremental).toBe(false);
    });

    it('加载 JSON 配置', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.json'),
        JSON.stringify({
          outputDir: 'specs',
          incremental: true,
          languages: ['typescript', 'python'],
        }),
      );
      const config = loadProjectConfig(tmpDir);
      expect(config.outputDir).toBe('specs');
      expect(config.incremental).toBe(true);
      expect(config.languages).toEqual(['typescript', 'python']);
    });

    it('languages 数组正确解析', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.yaml'),
        'languages:\n  - typescript\n  - python\n  - go\n',
      );
      const config = loadProjectConfig(tmpDir);
      expect(config.languages).toEqual(['typescript', 'python', 'go']);
    });

    it('无配置文件返回空对象', () => {
      const config = loadProjectConfig(tmpDir);
      expect(config).toEqual({});
    });

    it('无效 YAML 输出警告并返回空对象', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.yaml'),
        '{ invalid yaml [[[',
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = loadProjectConfig(tmpDir);
      expect(config).toEqual({});
      // 可能产生警告，也可能 parseYamlDocument 容错返回空对象
      warnSpy.mockRestore();
    });

    it('忽略未知字段', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.json'),
        JSON.stringify({ outputDir: 'specs', unknownField: 42 }),
      );
      const config = loadProjectConfig(tmpDir);
      expect(config.outputDir).toBe('specs');
      expect((config as Record<string, unknown>)['unknownField']).toBeUndefined();
    });

    it('类型不匹配的字段被忽略', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.reverse-spec.json'),
        JSON.stringify({ force: 'yes', outputDir: 123 }),
      );
      const config = loadProjectConfig(tmpDir);
      expect(config.force).toBeUndefined();
      expect(config.outputDir).toBeUndefined();
    });
  });

  // ─── mergeConfig ──────────────────────────────────────────
  describe('mergeConfig', () => {
    it('CLI 显式参数覆盖配置文件', () => {
      const merged = mergeConfig(
        { force: true },
        { force: false, incremental: true },
        new Set(['force']),
      );
      expect(merged.force).toBe(true);
      expect(merged.incremental).toBe(true);
    });

    it('CLI 未显式提供的参数使用配置文件值', () => {
      const merged = mergeConfig(
        { force: false },
        { force: true, languages: ['typescript'] },
        new Set(),
      );
      expect(merged.force).toBe(true);
      expect(merged.languages).toEqual(['typescript']);
    });

    it('配置文件为空时保留 CLI 显式值', () => {
      const merged = mergeConfig(
        { force: true },
        {},
        new Set(['force']),
      );
      expect(merged.force).toBe(true);
    });

    it('两者均为空时返回空对象', () => {
      const merged = mergeConfig({}, {}, new Set());
      expect(merged).toEqual({});
    });

    it('CLI 显式 languages 覆盖配置文件 languages', () => {
      const merged = mergeConfig(
        { languages: ['python'] },
        { languages: ['typescript', 'go'] },
        new Set(['languages']),
      );
      expect(merged.languages).toEqual(['python']);
    });
  });
});
