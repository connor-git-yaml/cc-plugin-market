/**
 * 项目级配置文件加载器
 *
 * 支持 .reverse-spec.yaml / .reverse-spec.yml / .reverse-spec.json
 * 优先级：CLI 显式参数 > 配置文件 > 默认值
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseYamlDocument } from '../panoramic/parsers/yaml-config-parser.js';
import type { YamlObject } from '../panoramic/parsers/yaml-config-parser.js';

/** 项目级配置 schema */
export interface ProjectConfig {
  /** 输出目录（默认 'specs'） */
  outputDir?: string;
  /** 强制重新生成 */
  force?: boolean;
  /** 增量模式 */
  incremental?: boolean;
  /** 语言过滤 */
  languages?: string[];
  /** 深度分析 */
  deep?: boolean;
}

/** 配置文件搜索顺序 */
const CONFIG_FILENAMES = [
  '.reverse-spec.yaml',
  '.reverse-spec.yml',
  '.reverse-spec.json',
] as const;

/**
 * 在指定目录查找配置文件
 * 按 CONFIG_FILENAMES 顺序查找，返回第一个存在的文件路径
 */
export function findConfigFile(projectRoot: string): string | undefined {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(projectRoot, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return undefined;
}

/**
 * 加载并解析项目级配置文件
 * 配置文件不存在时返回空对象（不报错）
 * 配置文件存在但解析失败时输出警告并返回空对象
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = findConfigFile(projectRoot);
  if (!configPath) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const raw = configPath.endsWith('.json')
      ? (JSON.parse(content) as Record<string, unknown>)
      : parseYamlDocument(content);
    return validateConfig(raw);
  } catch (err) {
    console.warn(
      `\u26A0 配置文件解析失败 (${path.basename(configPath)}): ${
        err instanceof Error ? err.message : String(err)
      }，使用默认配置`,
    );
    return {};
  }
}

/**
 * 验证并提取有效配置字段
 * 忽略未知字段，对已知字段做类型校验
 */
function validateConfig(raw: YamlObject | Record<string, unknown>): ProjectConfig {
  const config: ProjectConfig = {};

  if (typeof raw['outputDir'] === 'string') {
    config.outputDir = raw['outputDir'];
  }
  if (typeof raw['force'] === 'boolean') {
    config.force = raw['force'];
  }
  if (typeof raw['incremental'] === 'boolean') {
    config.incremental = raw['incremental'];
  }
  if (typeof raw['deep'] === 'boolean') {
    config.deep = raw['deep'];
  }

  // languages: 支持 YAML 数组和 JSON 数组
  const rawLangs = raw['languages'];
  if (Array.isArray(rawLangs)) {
    const filtered = rawLangs.filter((v): v is string => typeof v === 'string');
    if (filtered.length > 0) {
      config.languages = filtered;
    }
  }

  return config;
}

/**
 * 合并配置：CLI 显式参数 > 配置文件 > 默认值
 *
 * @param cliOptions - CLI 解析出的选项
 * @param fileConfig - 配置文件加载的选项
 * @param explicitFlags - CLI 中显式提供的标志名集合
 */
export function mergeConfig(
  cliOptions: Partial<ProjectConfig>,
  fileConfig: ProjectConfig,
  explicitFlags: Set<string>,
): ProjectConfig {
  const merged: ProjectConfig = { ...fileConfig };

  // CLI 显式参数覆盖配置文件
  for (const key of explicitFlags) {
    if (key in cliOptions) {
      (merged as Record<string, unknown>)[key] = (cliOptions as Record<string, unknown>)[key];
    }
  }

  return merged;
}
