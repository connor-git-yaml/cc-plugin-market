/**
 * ConfigReferenceGenerator — 配置参考手册生成器
 * 从 YAML/TOML/.env 配置文件生成配置参考手册。
 * 实现 DocumentGenerator<ConfigReferenceInput, ConfigReferenceOutput> 接口。
 *
 * 解析逻辑已委托给 ArtifactParserRegistry 中注册的配置 Parser：
 * - YamlConfigParser（id: yaml-config）
 * - EnvConfigParser（id: env-config）
 * - TomlConfigParser（id: toml-config）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentGenerator, ProjectContext, GenerateOptions } from './interfaces.js';
import type { ConfigEntry } from './parsers/types.js';
import { ArtifactParserRegistry } from './parser-registry.js';
import type { ConfigEntries } from './parsers/types.js';
import { loadTemplate } from './utils/template-loader.js';
import { enrichConfigDescriptions } from './utils/llm-enricher.js';

// ============================================================
// 类型定义
// ============================================================

/** 配置文件格式类型 */
export type ConfigFormat = 'yaml' | 'toml' | 'env';

// ConfigEntry 类型从 parsers/types.ts 重导出，保持向后兼容
export type { ConfigEntry } from './parsers/types.js';

/**
 * 单个配置文件的解析结果
 */
export interface ConfigFileResult {
  /** 配置文件相对于项目根目录的路径 */
  filePath: string;
  /** 文件格式类型 */
  format: ConfigFormat;
  /** 该文件中的所有配置项 */
  entries: ConfigEntry[];
}

/**
 * extract() 步骤的输出（TInput）
 */
export interface ConfigReferenceInput {
  /** 所有发现的配置文件解析结果 */
  files: ConfigFileResult[];
  /** 项目名称 */
  projectName: string;
}

/**
 * generate() 步骤的输出（TOutput）
 */
export interface ConfigReferenceOutput {
  /** 文档标题 */
  title: string;
  /** 项目名称 */
  projectName: string;
  /** 生成时间戳 */
  generatedAt: string;
  /** 按文件名排序的配置文件结果 */
  files: ConfigFileResult[];
  /** 配置项总数 */
  totalEntries: number;
}

// ============================================================
// 配置文件扩展名匹配
// ============================================================

/** YAML 文件扩展名 */
const YAML_EXTENSIONS = ['.yaml', '.yml'];

/** TOML 文件扩展名 */
const TOML_EXTENSIONS = ['.toml'];

/** .env 文件名匹配模式 */
const ENV_PATTERN = /^\.env(\..*)?$/;

/** 排除的目录名 */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '__pycache__', '.venv', 'venv',
]);

// ============================================================
// 辅助函数
// ============================================================

/**
 * 判断文件是否为配置文件（YAML/TOML/.env）
 */
function isConfigFile(fileName: string): ConfigFormat | null {
  const ext = path.extname(fileName).toLowerCase();
  if (YAML_EXTENSIONS.includes(ext)) return 'yaml';
  if (TOML_EXTENSIONS.includes(ext)) return 'toml';
  if (ENV_PATTERN.test(fileName)) return 'env';
  return null;
}

// ============================================================
// ConfigReferenceGenerator 实现
// ============================================================

/**
 * 配置参考手册生成器
 * 实现 DocumentGenerator<ConfigReferenceInput, ConfigReferenceOutput> 接口。
 * 从项目中发现并解析 YAML/TOML/.env 配置文件，生成结构化的配置参考手册。
 */
export class ConfigReferenceGenerator
  implements DocumentGenerator<ConfigReferenceInput, ConfigReferenceOutput>
{
  readonly id = 'config-reference' as const;
  readonly name = '配置参考手册生成器' as const;
  readonly description = '从 YAML/TOML/.env 配置文件生成配置参考手册，包含每个配置项的名称、类型、默认值、说明';

  /**
   * 判断当前项目是否包含支持的配置文件
   */
  isApplicable(context: ProjectContext): boolean {
    // 检查 configFiles 中是否有匹配的文件
    for (const fileName of context.configFiles.keys()) {
      if (isConfigFile(fileName) !== null) {
        return true;
      }
    }

    // 扫描项目根目录
    try {
      const entries = fs.readdirSync(context.projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && isConfigFile(entry.name) !== null) {
          return true;
        }
      }
    } catch {
      // 目录不可读时降级为 false
    }

    return false;
  }

  /**
   * 从项目中提取配置文件信息
   */
  async extract(context: ProjectContext): Promise<ConfigReferenceInput> {
    const files = await this.discoverAndParseConfigFiles(context.projectRoot);

    // 尝试从 package.json 获取项目名称
    let projectName = path.basename(context.projectRoot);
    const pkgJsonPath = path.join(context.projectRoot, 'package.json');
    try {
      if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (typeof pkg.name === 'string') {
          projectName = pkg.name;
        }
      }
    } catch {
      // 使用默认名称
    }

    return { files, projectName };
  }

  /**
   * 将提取的数据转换为结构化的文档输出
   */
  async generate(
    input: ConfigReferenceInput,
    options?: GenerateOptions,
  ): Promise<ConfigReferenceOutput> {
    // 按文件路径排序
    let sortedFiles = [...input.files].sort((a, b) =>
      a.filePath.localeCompare(b.filePath),
    );

    // LLM 语义增强（仅在 useLLM=true 时启用）
    if (options?.useLLM) {
      sortedFiles = await enrichConfigDescriptions(sortedFiles);
    }

    const totalEntries = sortedFiles.reduce(
      (sum, f) => sum + f.entries.length,
      0,
    );

    return {
      title: `配置参考手册: ${input.projectName}`,
      projectName: input.projectName,
      generatedAt: new Date().toISOString().split('T')[0]!,
      files: sortedFiles,
      totalEntries,
    };
  }

  /**
   * 使用 Handlebars 模板渲染为 Markdown
   */
  render(output: ConfigReferenceOutput): string {
    const template = loadTemplate('config-reference.hbs', import.meta.url);
    return template(output);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 发现并解析项目中的所有配置文件
   * 扫描项目根目录和一级子目录，通过 ArtifactParserRegistry 获取 Parser 进行解析
   */
  private async discoverAndParseConfigFiles(
    projectRoot: string,
  ): Promise<ConfigFileResult[]> {
    const results: ConfigFileResult[] = [];
    const discovered = new Set<string>();

    // 扫描根目录
    this.scanDirectory(projectRoot, projectRoot, discovered);

    // 扫描一级子目录
    try {
      const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          const subDir = path.join(projectRoot, entry.name);
          this.scanDirectory(subDir, projectRoot, discovered);
        }
      }
    } catch {
      // 目录不可读时跳过
    }

    const parserRegistry = ArtifactParserRegistry.getInstance();

    // 解析每个发现的文件
    for (const filePath of discovered) {
      const relativePath = path.relative(projectRoot, filePath);
      const fileName = path.basename(filePath);
      const format = isConfigFile(fileName);
      if (!format) continue;

      try {
        // 通过 ParserRegistry 获取适用的 Parser
        const matchedParsers = parserRegistry.getByFilePattern(filePath);

        if (matchedParsers.length > 0) {
          // 使用第一个匹配的 Parser 进行解析
          const parseResult = await matchedParsers[0]!.parse(filePath) as ConfigEntries;
          results.push({ filePath: relativePath, format, entries: parseResult.entries });
        } else {
          // 无匹配 Parser 时返回空 entries
          results.push({ filePath: relativePath, format, entries: [] });
        }
      } catch {
        // 文件不可读时跳过，不报错
        results.push({ filePath: relativePath, format, entries: [] });
      }
    }

    return results;
  }

  /**
   * 扫描目录查找配置文件
   */
  private scanDirectory(
    dir: string,
    _projectRoot: string,
    discovered: Set<string>,
  ): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && isConfigFile(entry.name) !== null) {
          discovered.add(path.join(dir, entry.name));
        }
      }
    } catch {
      // 不可读目录静默跳过
    }
  }

}
