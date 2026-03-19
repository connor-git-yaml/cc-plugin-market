/**
 * WorkspaceIndexGenerator -- Monorepo 层级架构索引生成器
 *
 * 为 Monorepo 项目生成 packages/apps 层级索引文档。
 * 实现 DocumentGenerator<WorkspaceInput, WorkspaceOutput> 接口。
 *
 * 支持的 workspace 管理器：
 * - npm workspaces（package.json workspaces 字段）
 * - pnpm workspaces（pnpm-workspace.yaml）
 * - uv workspaces（pyproject.toml [tool.uv.workspace] 段）
 *
 * 技术决策：
 * - 纯 fs.readdirSync 展开 glob 模式，不引入 glob 库
 * - 纯正则解析 pnpm-workspace.yaml，不引入 YAML 库
 * - 纯正则解析 pyproject.toml，不引入 TOML 库
 * - Handlebars 模板渲染输出 Markdown
 *
 * @module panoramic/workspace-index-generator
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import type { DocumentGenerator, ProjectContext, GenerateOptions } from './interfaces.js';

// ============================================================
// 类型定义（T001）
// ============================================================

/**
 * 单个子包的元信息
 * 从子包的 package.json（npm/pnpm）或 pyproject.toml（uv）中提取
 */
export interface WorkspacePackageInfo {
  /** 包名（如 "@scope/core"、"octoagent-core"） */
  name: string;

  /** 子包相对于 projectRoot 的路径（如 "packages/core"） */
  path: string;

  /** 包描述（来自 description 字段，缺失时为空字符串） */
  description: string;

  /** 主要语言（TypeScript / JavaScript / Python / Unknown） */
  language: string;

  /** workspace 内部依赖列表（仅包名，不含版本） */
  dependencies: string[];
}

/**
 * extract() 步骤的输出
 * 包含项目级信息和所有子包的元信息列表
 */
export interface WorkspaceInput {
  /** 项目名称（来自根 package.json 或 pyproject.toml，降级为目录名） */
  projectName: string;

  /** workspace 管理器类型 */
  workspaceType: 'npm' | 'pnpm' | 'uv';

  /** 所有子包的元信息列表 */
  packages: WorkspacePackageInfo[];
}

/**
 * 按路径第一级目录分组的子包集合
 */
export interface WorkspaceGroup {
  /** 分组名称（第一级目录名，如 "packages"、"apps"） */
  name: string;

  /** 该分组下的子包列表 */
  packages: WorkspacePackageInfo[];
}

/**
 * generate() 步骤的输出
 * 包含渲染模板所需的全部数据
 */
export interface WorkspaceOutput {
  /** 文档标题（如 "Workspace 架构索引: my-project"） */
  title: string;

  /** 项目名称 */
  projectName: string;

  /** 生成日期（YYYY-MM-DD 格式） */
  generatedAt: string;

  /** 所有子包信息（按路径排序） */
  packages: WorkspacePackageInfo[];

  /** Mermaid graph TD 依赖拓扑图源代码 */
  dependencyDiagram: string;

  /** 子包总数 */
  totalPackages: number;

  /** 按层级目录分组的子包 */
  groups: WorkspaceGroup[];
}

// ============================================================
// 私有辅助函数
// ============================================================

/**
 * 展开 glob 模式为实际目录路径列表（T004）
 * 仅支持 `*` 通配符匹配单层目录名
 * 精确路径（不含 `*`）直接返回（如果存在）
 * 不存在的目录静默跳过
 *
 * @param projectRoot - 项目根目录
 * @param patterns - glob 模式列表（如 ["packages/*", "apps/gateway"]）
 * @returns 展开后的绝对目录路径列表
 */
function expandGlobPatterns(projectRoot: string, patterns: string[]): string[] {
  const result: string[] = [];

  for (const pattern of patterns) {
    // 检查是否包含 * 通配符
    if (pattern.includes('*')) {
      // 拆分为父目录和通配部分
      // 支持 "packages/*" 模式——仅末尾单层通配
      const parts = pattern.split('/');
      const starIndex = parts.findIndex((p) => p.includes('*'));
      if (starIndex < 0) continue;

      // 构建父目录路径
      const parentParts = parts.slice(0, starIndex);
      const parentDir = path.join(projectRoot, ...parentParts);

      // 通配后是否还有后续路径部分
      const suffixParts = parts.slice(starIndex + 1);

      try {
        const entries = fs.readdirSync(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const fullPath = path.join(parentDir, entry.name, ...suffixParts);
            // 验证展开后的路径是否实际存在
            if (fs.existsSync(fullPath)) {
              result.push(fullPath);
            }
          }
        }
      } catch {
        // 父目录不存在或不可读，静默跳过
      }
    } else {
      // 精确路径，直接检查存在性
      const fullPath = path.join(projectRoot, pattern);
      if (fs.existsSync(fullPath)) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

/**
 * 正则解析 pnpm-workspace.yaml 的 packages 列表（T005）
 * 逐行解析 `- "pattern"` 或 `- 'pattern'` 或 `- pattern` 条目
 *
 * @param content - pnpm-workspace.yaml 文件内容
 * @returns packages 列表
 */
function parsePnpmWorkspaceYaml(content: string): string[] {
  const result: string[] = [];
  const lines = content.split('\n');

  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 packages: 段开始
    if (/^packages\s*:/.test(trimmed)) {
      inPackages = true;
      continue;
    }

    // 如果当前在 packages 段中
    if (inPackages) {
      // 空行或注释跳过
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      // 检测列表项 - "pattern" / - 'pattern' / - pattern
      const match = trimmed.match(/^-\s+["']?([^"'\s]+)["']?\s*$/);
      if (match) {
        result.push(match[1]!);
        continue;
      }

      // 遇到非列表项且非空行，说明 packages 段结束
      if (!trimmed.startsWith('-')) {
        inPackages = false;
      }
    }
  }

  return result;
}

/**
 * 正则解析 pyproject.toml 的 [tool.uv.workspace] 段中 members 列表（T006）
 *
 * @param content - pyproject.toml 文件内容
 * @returns members 列表
 */
function parseUvWorkspaceToml(content: string): string[] {
  // 查找 [tool.uv.workspace] 段，提取到下一个 [section] 头之前的内容
  const sectionMatch = content.match(/\[tool\.uv\.workspace\]([\s\S]*?)(?=\n\[(?!\])|$)/);
  if (!sectionMatch) return [];

  const section = sectionMatch[1]!;

  // 提取 members = [...] 列表
  const membersMatch = section.match(/members\s*=\s*\[([\s\S]*?)\]/);
  if (!membersMatch) return [];

  const membersContent = membersMatch[1]!;
  const result: string[] = [];

  // 逐项提取被引号包裹的值
  const itemPattern = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(membersContent)) !== null) {
    result.push(match[1]!);
  }

  return result;
}

/**
 * 根据目录内文件特征推断主要语言（T007）
 *
 * @param packageDir - 子包目录绝对路径
 * @returns 推断的语言名称
 */
function detectLanguage(packageDir: string): string {
  try {
    const entries = fs.readdirSync(packageDir);
    const fileSet = new Set(entries);

    if (fileSet.has('tsconfig.json')) return 'TypeScript';
    if (fileSet.has('package.json')) return 'JavaScript';
    if (fileSet.has('pyproject.toml')) return 'Python';

    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/**
 * 将包名转义为合法的 Mermaid 节点 ID（T008）
 * 替换 @、/、-、. 等特殊字符为 _
 *
 * @param name - 原始包名
 * @returns 合法的 Mermaid 节点 ID
 */
function sanitizeMermaidId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * 从子包 pyproject.toml 提取元信息（T021）
 *
 * @param packageDir - 子包目录绝对路径
 * @param allPackageNames - workspace 中所有子包名的集合，用于匹配内部依赖
 * @returns 子包元信息，解析失败返回 null
 */
function extractPyprojectInfo(
  packageDir: string,
  allPackageNames: Set<string>,
): WorkspacePackageInfo | null {
  const pyprojectPath = path.join(packageDir, 'pyproject.toml');

  let content: string;
  try {
    content = fs.readFileSync(pyprojectPath, 'utf-8');
  } catch {
    return null;
  }

  // 提取 [project] 段（从 [project] 到下一个 [section] 头之前）
  const projectSectionMatch = content.match(/\[project\]([\s\S]*?)(?=\n\[(?!\])|$)/);
  if (!projectSectionMatch) return null;

  const projectSection = projectSectionMatch[1]!;

  // 提取 name
  const nameMatch = projectSection.match(/^name\s*=\s*["']([^"']+)["']/m);
  const name = nameMatch ? nameMatch[1]! : path.basename(packageDir);

  // 提取 description
  const descMatch = projectSection.match(/^description\s*=\s*["']([^"']*)["']/m);
  const description = descMatch ? descMatch[1]! : '';

  // 提取 dependencies 列表
  const depsMatch = projectSection.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m);
  const dependencies: string[] = [];

  if (depsMatch) {
    const depsContent = depsMatch[1]!;
    // 提取每个依赖项（取包名部分，忽略版本约束）
    const depPattern = /["']([a-zA-Z0-9_-]+)[^"']*["']/g;
    let depMatch: RegExpExecArray | null;
    while ((depMatch = depPattern.exec(depsContent)) !== null) {
      const depName = depMatch[1]!;
      if (allPackageNames.has(depName)) {
        dependencies.push(depName);
      }
    }
  }

  const language = detectLanguage(packageDir);

  return {
    name,
    path: '', // 由调用者填充
    description,
    language,
    dependencies,
  };
}

/**
 * 构建 Mermaid graph TD 依赖拓扑图（T030, T031）
 *
 * @param packages - 所有子包的元信息列表
 * @returns Mermaid 源代码字符串
 */
function buildMermaidDiagram(packages: WorkspacePackageInfo[]): string {
  const lines: string[] = ['graph TD'];

  // 添加所有节点
  for (const pkg of packages) {
    const nodeId = sanitizeMermaidId(pkg.name);
    lines.push(`    ${nodeId}["${pkg.name}"]`);
  }

  // 收集所有边
  const edges: string[] = [];
  for (const pkg of packages) {
    const sourceId = sanitizeMermaidId(pkg.name);
    for (const dep of pkg.dependencies) {
      const targetId = sanitizeMermaidId(dep);
      edges.push(`    ${sourceId} --> ${targetId}`);
    }
  }

  if (edges.length === 0) {
    lines.push('    %% 无内部依赖');
  } else {
    lines.push(...edges);
  }

  return lines.join('\n');
}

// ============================================================
// WorkspaceIndexGenerator 实现（T003）
// ============================================================

/**
 * Monorepo 层级架构索引生成器
 * 实现 DocumentGenerator<WorkspaceInput, WorkspaceOutput> 接口。
 * 从 Monorepo 项目中提取所有子包信息，生成层级索引文档和 Mermaid 依赖图。
 */
export class WorkspaceIndexGenerator
  implements DocumentGenerator<WorkspaceInput, WorkspaceOutput>
{
  readonly id = 'workspace-index' as const;
  readonly name = 'Monorepo 层级架构索引生成器' as const;
  readonly description = '为 Monorepo 项目生成 packages/apps 层级索引文档，包含子包列表和 Mermaid 包级依赖拓扑图';

  /** 缓存编译后的 Handlebars 模板 */
  private compiledTemplate: ReturnType<typeof Handlebars.compile> | null = null;

  /**
   * 判断当前项目是否适用此 Generator（T025）
   * 仅当 workspaceType === 'monorepo' 时返回 true
   */
  isApplicable(context: ProjectContext): boolean {
    return context.workspaceType === 'monorepo';
  }

  /**
   * 从项目中提取 workspace 信息（T012-T014, T020-T022）
   * 检测 workspace 管理器类型，解析 members 列表，读取子包元信息
   */
  async extract(context: ProjectContext): Promise<WorkspaceInput> {
    const projectRoot = context.projectRoot;

    // 尝试获取项目名称
    let projectName = path.basename(projectRoot);

    // 步骤 1: 检测 workspace 管理器类型并解析 members（T012）
    let workspaceType: 'npm' | 'pnpm' | 'uv' = 'npm';
    let memberPatterns: string[] = [];

    // 优先检查 pnpm-workspace.yaml
    const pnpmWorkspacePath = path.join(projectRoot, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWorkspacePath)) {
      try {
        const content = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
        memberPatterns = parsePnpmWorkspaceYaml(content);
        workspaceType = 'pnpm';
      } catch {
        console.warn('无法读取 pnpm-workspace.yaml，尝试其他检测方式');
        memberPatterns = [];
      }
    }

    // 其次检查 package.json workspaces
    if (memberPatterns.length === 0) {
      const packageJsonPath = path.join(projectRoot, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const content = fs.readFileSync(packageJsonPath, 'utf-8');
          const pkg = JSON.parse(content);

          if (pkg.name && typeof pkg.name === 'string') {
            projectName = pkg.name;
          }

          if (Array.isArray(pkg.workspaces)) {
            memberPatterns = pkg.workspaces;
            workspaceType = 'npm';
          } else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
            memberPatterns = pkg.workspaces.packages;
            workspaceType = 'npm';
          }
        } catch {
          console.warn('无法解析 package.json');
        }
      }
    }

    // 最后检查 pyproject.toml [tool.uv.workspace]（T020）
    if (memberPatterns.length === 0) {
      const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
      if (fs.existsSync(pyprojectPath)) {
        try {
          const content = fs.readFileSync(pyprojectPath, 'utf-8');

          // 提取项目名称
          const nameMatch = content.match(/\[project\][\s\S]*?^name\s*=\s*["']([^"']+)["']/m);
          if (nameMatch) {
            projectName = nameMatch[1]!;
          }

          if (/\[tool\.uv\.workspace\]/m.test(content)) {
            memberPatterns = parseUvWorkspaceToml(content);
            workspaceType = 'uv';
          }
        } catch {
          console.warn('无法解析 pyproject.toml');
        }
      }
    }

    // 也尝试从 pnpm 场景下读取 package.json 获取项目名
    if (workspaceType === 'pnpm') {
      const packageJsonPath = path.join(projectRoot, 'package.json');
      try {
        if (fs.existsSync(packageJsonPath)) {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          if (pkg.name && typeof pkg.name === 'string') {
            projectName = pkg.name;
          }
        }
      } catch {
        // 使用默认名称
      }
    }

    // 步骤 2: glob 展开获取子包目录列表（T013）
    const packageDirs = expandGlobPatterns(projectRoot, memberPatterns);

    // 步骤 3: 读取子包元信息
    const packages: WorkspacePackageInfo[] = [];

    if (workspaceType === 'uv') {
      // uv workspace: 两遍扫描
      // 第一遍：收集所有子包名称
      const allNames = new Set<string>();
      const tempInfos: Array<{ dir: string; relPath: string }> = [];

      for (const dir of packageDirs) {
        const relPath = path.relative(projectRoot, dir);
        const pyprojectPath = path.join(dir, 'pyproject.toml');
        if (!fs.existsSync(pyprojectPath)) continue;

        try {
          const content = fs.readFileSync(pyprojectPath, 'utf-8');
          const nameMatch = content.match(/\[project\][\s\S]*?^name\s*=\s*["']([^"']+)["']/m);
          if (nameMatch) {
            allNames.add(nameMatch[1]!);
          }
        } catch {
          // 忽略
        }
        tempInfos.push({ dir, relPath });
      }

      // 第二遍：提取完整元信息（T022）
      for (const { dir, relPath } of tempInfos) {
        const info = extractPyprojectInfo(dir, allNames);
        if (info) {
          info.path = relPath;
          packages.push(info);
        }
      }
    } else {
      // npm/pnpm workspace: 读取 package.json
      // 第一遍：收集所有子包名称
      const allNames = new Set<string>();
      const validDirs: Array<{ dir: string; relPath: string; pkg: any }> = [];

      for (const dir of packageDirs) {
        const relPath = path.relative(projectRoot, dir);
        const pkgJsonPath = path.join(dir, 'package.json');

        if (!fs.existsSync(pkgJsonPath)) continue;

        try {
          const content = fs.readFileSync(pkgJsonPath, 'utf-8');
          const pkg = JSON.parse(content);
          const name = typeof pkg.name === 'string' ? pkg.name : path.basename(dir);
          allNames.add(name);
          validDirs.push({ dir, relPath, pkg });
        } catch {
          // JSON 解析失败时记录警告并跳过（T014）
          console.warn(`无法解析 ${pkgJsonPath}，跳过该子包`);
        }
      }

      // 第二遍：提取完整元信息并匹配内部依赖
      for (const { dir, relPath, pkg } of validDirs) {
        const name = typeof pkg.name === 'string' ? pkg.name : path.basename(dir);
        const description = typeof pkg.description === 'string' ? pkg.description : '';
        const language = detectLanguage(dir);

        // 提取 workspace 内部依赖
        const dependencies: string[] = [];
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (allNames.has(depName)) {
            dependencies.push(depName);
          }
        }

        packages.push({
          name,
          path: relPath,
          description,
          language,
          dependencies,
        });
      }
    }

    return {
      projectName,
      workspaceType,
      packages,
    };
  }

  /**
   * 将提取的数据转换为结构化文档输出（T015, T030）
   */
  async generate(
    input: WorkspaceInput,
    _options?: GenerateOptions,
  ): Promise<WorkspaceOutput> {
    // 按路径排序
    const sortedPackages = [...input.packages].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    // 按路径第一级目录分组（T015）
    const groupMap = new Map<string, WorkspacePackageInfo[]>();
    for (const pkg of sortedPackages) {
      const parts = pkg.path.split('/');
      const groupName = parts.length > 1 ? parts[0]! : '.';
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, []);
      }
      groupMap.get(groupName)!.push(pkg);
    }

    const groups: WorkspaceGroup[] = [];
    for (const [name, pkgs] of groupMap) {
      groups.push({ name, packages: pkgs });
    }

    // 生成 Mermaid 依赖图（T030）
    const dependencyDiagram = buildMermaidDiagram(sortedPackages);

    return {
      title: `Workspace 架构索引: ${input.projectName}`,
      projectName: input.projectName,
      generatedAt: new Date().toISOString().split('T')[0]!,
      packages: sortedPackages,
      dependencyDiagram,
      totalPackages: sortedPackages.length,
      groups,
    };
  }

  /**
   * 使用 Handlebars 模板渲染为 Markdown（T016, T035）
   */
  render(output: WorkspaceOutput): string {
    const template = this.getCompiledTemplate();
    return template(output);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 获取编译后的 Handlebars 模板（带缓存）
   */
  private getCompiledTemplate(): ReturnType<typeof Handlebars.compile> {
    if (this.compiledTemplate) return this.compiledTemplate;

    const templatePath = this.findTemplatePath();
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    this.compiledTemplate = Handlebars.compile(templateSource);
    return this.compiledTemplate;
  }

  /**
   * 查找 workspace-index.hbs 模板文件路径
   */
  private findTemplatePath(): string {
    // 从当前文件位置向上查找 templates/ 目录
    let dir = path.dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'templates', 'workspace-index.hbs');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      dir = path.dirname(dir);
    }

    // 降级：尝试相对于 cwd 的路径
    const fallback = path.join(process.cwd(), 'templates', 'workspace-index.hbs');
    if (fs.existsSync(fallback)) {
      return fallback;
    }

    throw new Error('无法找到 workspace-index.hbs 模板文件');
  }
}

// 导出辅助函数供测试使用
export {
  expandGlobPatterns as _expandGlobPatterns,
  parsePnpmWorkspaceYaml as _parsePnpmWorkspaceYaml,
  parseUvWorkspaceToml as _parseUvWorkspaceToml,
  detectLanguage as _detectLanguage,
  sanitizeMermaidId as _sanitizeMermaidId,
  buildMermaidDiagram as _buildMermaidDiagram,
  extractPyprojectInfo as _extractPyprojectInfo,
};
