/**
 * ConfigReferenceGenerator — 配置参考手册生成器
 * 从 YAML/TOML/.env 配置文件生成配置参考手册。
 * 实现 DocumentGenerator<ConfigReferenceInput, ConfigReferenceOutput> 接口。
 *
 * Feature 037 依赖降级：解析逻辑直接在此文件内部实现，
 * 不依赖 ArtifactParser 输出。
 * // TODO: Feature 037 完成后重构为 ArtifactParser 对接
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import type { DocumentGenerator, ProjectContext, GenerateOptions } from './interfaces.js';

// ============================================================
// 类型定义
// ============================================================

/** 配置文件格式类型 */
export type ConfigFormat = 'yaml' | 'toml' | 'env';

/**
 * 单个配置项的结构化表示
 */
export interface ConfigEntry {
  /** 点号分隔的配置项路径（如 database.host） */
  keyPath: string;
  /** 推断的值类型 */
  type: string;
  /** 当前值的字符串表示 */
  defaultValue: string;
  /** 从注释提取的说明文本 */
  description: string;
}

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
 * 从字符串值推断类型
 */
export function inferType(value: string): string {
  const trimmed = value.trim();

  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return 'null';
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (/^-?\d+$/.test(trimmed)) return 'number';
  if (/^-?\d+\.\d+$/.test(trimmed)) return 'number';
  if (trimmed.startsWith('[')) return 'array';
  if (trimmed.startsWith('{')) return 'object';

  return 'string';
}

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
// 解析函数
// ============================================================

/**
 * 解析 YAML 文件为 ConfigEntry 数组
 * 使用行级正则解析，提取键值对、缩进层级和注释
 *
 * // TODO: Feature 037 完成后重构为 ArtifactParser 对接
 */
export function parseYamlContent(content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const lines = content.split('\n');

  // 用缩进堆栈跟踪当前路径
  const pathStack: Array<{ indent: number; key: string }> = [];
  let pendingComment = '';

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // 空行重置 pending comment
    if (trimmed.trim() === '') {
      pendingComment = '';
      continue;
    }

    // 纯注释行
    if (/^\s*#/.test(trimmed)) {
      const commentText = trimmed.replace(/^\s*#\s*/, '');
      if (pendingComment) {
        pendingComment += ' ' + commentText;
      } else {
        pendingComment = commentText;
      }
      continue;
    }

    // 匹配 key: value 或 key: (纯嵌套头)
    const match = trimmed.match(/^(\s*)([\w][\w.-]*)\s*:\s*(.*?)$/);
    if (!match) {
      pendingComment = '';
      continue;
    }

    const indent = match[1]!.length;
    const key = match[2]!;
    let rawValue = match[3]!;

    // 提取行内注释
    let inlineComment = '';
    const commentMatch = rawValue.match(/^(.*?)\s+#\s+(.*)$/);
    if (commentMatch) {
      rawValue = commentMatch[1]!.trim();
      inlineComment = commentMatch[2]!;
    }

    // 更新路径堆栈
    while (pathStack.length > 0 && pathStack[pathStack.length - 1]!.indent >= indent) {
      pathStack.pop();
    }
    pathStack.push({ indent, key });

    // 构建完整 keyPath
    const keyPath = pathStack.map((p) => p.key).join('.');

    // 有值 -> 叶节点
    if (rawValue !== '') {
      // 去除引号
      let cleanValue = rawValue;
      if (
        (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
        (cleanValue.startsWith("'") && cleanValue.endsWith("'"))
      ) {
        cleanValue = cleanValue.slice(1, -1);
      }

      const description = pendingComment || inlineComment;
      entries.push({
        keyPath,
        type: inferType(cleanValue),
        defaultValue: cleanValue,
        description,
      });
    }
    // 无值 -> 父节点（不作为 entry，但保留在堆栈中）

    pendingComment = '';
  }

  return entries;
}

/**
 * 解析 .env 文件为 ConfigEntry 数组
 *
 * // TODO: Feature 037 完成后重构为 ArtifactParser 对接
 */
export function parseEnvContent(content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const lines = content.split('\n');
  let pendingComment = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行重置 pending comment
    if (trimmed === '') {
      pendingComment = '';
      continue;
    }

    // 注释行
    if (trimmed.startsWith('#')) {
      const commentText = trimmed.replace(/^#\s*/, '');
      if (pendingComment) {
        pendingComment += ' ' + commentText;
      } else {
        pendingComment = commentText;
      }
      continue;
    }

    // KEY=VALUE 匹配
    const match = trimmed.match(/^([A-Za-z_][\w.]*)\s*=\s*(.*)$/);
    if (!match) {
      pendingComment = '';
      continue;
    }

    const key = match[1]!;
    let value = match[2]!;

    // 去除引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.push({
      keyPath: key,
      type: inferType(value),
      defaultValue: value,
      description: pendingComment,
    });

    pendingComment = '';
  }

  return entries;
}

/**
 * 解析 TOML 文件为 ConfigEntry 数组
 *
 * // TODO: Feature 037 完成后重构为 ArtifactParser 对接
 */
export function parseTomlContent(content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  const lines = content.split('\n');
  let currentSection = '';
  let pendingComment = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行重置 pending comment
    if (trimmed === '') {
      pendingComment = '';
      continue;
    }

    // 注释行
    if (trimmed.startsWith('#')) {
      const commentText = trimmed.replace(/^#\s*/, '');
      if (pendingComment) {
        pendingComment += ' ' + commentText;
      } else {
        pendingComment = commentText;
      }
      continue;
    }

    // Section 头 [section.name]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      pendingComment = '';
      continue;
    }

    // key = value 匹配
    const kvMatch = trimmed.match(/^([\w][\w.-]*)\s*=\s*(.+)$/);
    if (!kvMatch) {
      pendingComment = '';
      continue;
    }

    const key = kvMatch[1]!;
    let value = kvMatch[2]!;

    // 提取行内注释
    let inlineComment = '';
    // 处理未被引号包裹的行内注释
    if (!value.startsWith('"') && !value.startsWith("'") && !value.startsWith('[') && !value.startsWith('{')) {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) {
        inlineComment = value.slice(commentIdx + 2).trim();
        value = value.slice(0, commentIdx).trim();
      }
    }

    // 去除引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const keyPath = currentSection ? `${currentSection}.${key}` : key;
    const description = pendingComment || inlineComment;

    entries.push({
      keyPath,
      type: inferType(value),
      defaultValue: value,
      description,
    });

    pendingComment = '';
  }

  return entries;
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

  /** 缓存编译后的 Handlebars 模板 */
  private compiledTemplate: ReturnType<typeof Handlebars.compile> | null = null;

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
    _options?: GenerateOptions,
  ): Promise<ConfigReferenceOutput> {
    // 按文件路径排序
    const sortedFiles = [...input.files].sort((a, b) =>
      a.filePath.localeCompare(b.filePath),
    );

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
    const template = this.getCompiledTemplate();
    return template(output);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 发现并解析项目中的所有配置文件
   * 扫描项目根目录和一级子目录
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

    // 解析每个发现的文件
    for (const filePath of discovered) {
      const relativePath = path.relative(projectRoot, filePath);
      const fileName = path.basename(filePath);
      const format = isConfigFile(fileName);
      if (!format) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        let entries: ConfigEntry[];

        switch (format) {
          case 'yaml':
            entries = parseYamlContent(content);
            break;
          case 'env':
            entries = parseEnvContent(content);
            break;
          case 'toml':
            entries = parseTomlContent(content);
            break;
        }

        results.push({ filePath: relativePath, format, entries });
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

  /**
   * 获取编译后的 Handlebars 模板（带缓存）
   */
  private getCompiledTemplate(): ReturnType<typeof Handlebars.compile> {
    if (this.compiledTemplate) return this.compiledTemplate;

    // 查找模板文件：从 src/panoramic/ 向上查找到项目根目录的 templates/
    const templatePath = this.findTemplatePath();
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    this.compiledTemplate = Handlebars.compile(templateSource);
    return this.compiledTemplate;
  }

  /**
   * 查找 config-reference.hbs 模板文件路径
   */
  private findTemplatePath(): string {
    // 从当前文件位置向上查找 templates/ 目录
    let dir = path.dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'templates', 'config-reference.hbs');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      dir = path.dirname(dir);
    }

    // 降级：尝试相对于 __dirname 的常见路径
    const fallback = path.join(process.cwd(), 'templates', 'config-reference.hbs');
    if (fs.existsSync(fallback)) {
      return fallback;
    }

    throw new Error('无法找到 config-reference.hbs 模板文件');
  }
}
