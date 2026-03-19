/**
 * MockReadmeGenerator — 接口设计验证用的 Mock 实现
 * 模拟一个 README 文档生成器，从 ProjectContext 的 package.json 信息中
 * 提取项目名称和描述，生成简单的 README Markdown。
 *
 * 唯一目的：验证 DocumentGenerator 接口的四步生命周期在实际使用中是可行的。
 */
import type { DocumentGenerator, ProjectContext, GenerateOptions } from './interfaces.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * MockReadmeGenerator 的 extract() 输出类型
 * 从 package.json 中提取的项目基本信息
 */
export interface ReadmeInput {
  /** 项目名称（从 package.json 的 name 字段提取） */
  projectName: string;
  /** 项目描述（从 package.json 的 description 字段提取） */
  description: string;
  /** 是否存在 package.json */
  hasPackageJson: boolean;
}

/**
 * README 文档的单个章节
 */
export interface ReadmeSection {
  /** 章节标题 */
  heading: string;
  /** 章节内容 */
  content: string;
}

/**
 * MockReadmeGenerator 的 generate() 输出类型
 * 结构化的 README 文档数据
 */
export interface ReadmeOutput {
  /** README 标题 */
  title: string;
  /** 项目描述段落 */
  description: string;
  /** README 的各个章节 */
  sections: ReadmeSection[];
}

// ============================================================
// MockReadmeGenerator 实现
// ============================================================

/**
 * Mock README 文档生成器
 * 实现 DocumentGenerator<ReadmeInput, ReadmeOutput> 接口的全部方法，
 * 作为接口设计的冒烟验证。
 *
 * 生命周期：isApplicable -> extract -> generate -> render
 */
export class MockReadmeGenerator implements DocumentGenerator<ReadmeInput, ReadmeOutput> {
  /** 唯一标识符 */
  readonly id = 'mock-readme' as const;

  /** 显示名称 */
  readonly name = 'Mock README Generator' as const;

  /** 功能描述 */
  readonly description = '从 package.json 提取项目信息，生成简单的 README.md 文档';

  /**
   * 判断当前项目是否适用此 Generator
   * 同步检查 configFiles 中是否包含 package.json
   *
   * @param context - 项目上下文
   * @returns 如果 configFiles 包含 package.json 则返回 true
   */
  isApplicable(context: ProjectContext): boolean {
    return context.configFiles.has('package.json');
  }

  /**
   * 从项目上下文中提取 README 所需的输入数据
   * 读取 package.json 内容提取 name 和 description，缺失时使用默认值
   *
   * @param context - 项目上下文
   * @returns ReadmeInput 数据
   */
  async extract(context: ProjectContext): Promise<ReadmeInput> {
    const packageJsonContent = context.configFiles.get('package.json');
    if (!packageJsonContent) {
      return {
        projectName: 'unknown-project',
        description: 'No description provided',
        hasPackageJson: false,
      };
    }

    try {
      const parsed = JSON.parse(packageJsonContent) as Record<string, unknown>;
      return {
        projectName: typeof parsed['name'] === 'string' ? parsed['name'] : 'unknown-project',
        description: typeof parsed['description'] === 'string' ? parsed['description'] : 'No description provided',
        hasPackageJson: true,
      };
    } catch {
      // JSON 解析失败，使用默认值
      return {
        projectName: 'unknown-project',
        description: 'No description provided',
        hasPackageJson: true,
      };
    }
  }

  /**
   * 将 ReadmeInput 转换为 ReadmeOutput
   * 生成包含 Installation 和 Usage 两个默认 section 的文档结构
   *
   * @param input - extract 步骤的输出
   * @param _options - 生成选项（当前未使用）
   * @returns ReadmeOutput 文档结构
   */
  async generate(input: ReadmeInput, _options?: GenerateOptions): Promise<ReadmeOutput> {
    const sections: ReadmeSection[] = [
      {
        heading: 'Installation',
        content: `npm install ${input.projectName}`,
      },
      {
        heading: 'Usage',
        content: `Import and use ${input.projectName} in your project.`,
      },
    ];

    return {
      title: input.projectName,
      description: input.description,
      sections,
    };
  }

  /**
   * 将 ReadmeOutput 渲染为 Markdown 字符串
   * 同步拼接标题 + 描述 + sections
   *
   * @param output - generate 步骤的输出
   * @returns Markdown 字符串
   */
  render(output: ReadmeOutput): string {
    const lines: string[] = [];

    // 标题
    lines.push(`# ${output.title}`);
    lines.push('');

    // 描述
    lines.push(output.description);
    lines.push('');

    // 各章节
    for (const section of output.sections) {
      lines.push(`## ${section.heading}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
  }
}
