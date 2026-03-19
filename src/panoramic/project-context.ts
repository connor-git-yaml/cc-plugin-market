/**
 * ProjectContext 构建函数
 * 提供 buildProjectContext(projectRoot) 异步构建函数，
 * 执行包管理器检测、workspace 类型识别、多语言检测、配置文件扫描和 spec 文件发现五个子流程。
 *
 * @module panoramic/project-context
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ProjectContextSchema,
  type ProjectContext,
  type PackageManager,
  type WorkspaceType,
} from './interfaces.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { scanFiles } from '../utils/file-scanner.js';

// ============================================================
// Lock 文件优先级检测表（按优先级从高到低）
// ============================================================

/** lock 文件到包管理器的映射，按优先级排序 */
const LOCK_FILE_PRIORITY: Array<{ file: string; manager: PackageManager }> = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'uv.lock', manager: 'uv' },
  { file: 'Pipfile.lock', manager: 'pipenv' },
  { file: 'go.sum', manager: 'go' },
  { file: 'go.mod', manager: 'go' },
  { file: 'pom.xml', manager: 'maven' },
  { file: 'build.gradle', manager: 'gradle' },
  { file: 'build.gradle.kts', manager: 'gradle' },
];

// ============================================================
// 已知配置文件列表
// ============================================================

/** 精确匹配的已知配置文件名（14 个） */
const KNOWN_CONFIG_FILES: string[] = [
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  '.eslintrc',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.json',
  'jest.config.ts',
  'jest.config.js',
  'vitest.config.ts',
  'vitest.config.js',
];

/** 正则通配匹配的配置文件模式 */
const KNOWN_CONFIG_PATTERNS: RegExp[] = [
  /^tsconfig\..+\.json$/,
];

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 检测项目使用的包管理器
 * 按优先级顺序检查 lock 文件存在性，第一个匹配即返回
 *
 * @param projectRoot - 项目根目录绝对路径
 * @returns 包管理器枚举值
 */
function detectPackageManager(projectRoot: string): PackageManager {
  for (const { file, manager } of LOCK_FILE_PRIORITY) {
    if (fs.existsSync(path.join(projectRoot, file))) {
      return manager;
    }
  }
  return 'unknown';
}

/**
 * 检测项目 workspace 类型（单包或 Monorepo）
 * 满足任一条件即返回 'monorepo'，否则返回 'single'
 *
 * @param projectRoot - 项目根目录绝对路径
 * @returns workspace 类型枚举值
 */
function detectWorkspaceType(projectRoot: string): WorkspaceType {
  // 条件 (b): pnpm-workspace.yaml 存在
  if (fs.existsSync(path.join(projectRoot, 'pnpm-workspace.yaml'))) {
    return 'monorepo';
  }

  // 条件 (d): lerna.json 存在
  if (fs.existsSync(path.join(projectRoot, 'lerna.json'))) {
    return 'monorepo';
  }

  // 条件 (a): package.json 含 workspaces 字段
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.workspaces) {
        return 'monorepo';
      }
    } catch {
      // JSON.parse 失败时跳过，降级为 single
    }
  }

  // 条件 (c): pyproject.toml 含 [tool.uv.workspace] 段
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      if (/^\[tool\.uv\.workspace\]/m.test(content)) {
        return 'monorepo';
      }
    } catch {
      // readFileSync 失败时跳过，降级为 single
    }
  }

  return 'single';
}

/**
 * 检测项目中使用的编程语言列表
 * 复用 scanFiles 提取 languageStats，从中获取语言适配器 ID
 *
 * @param projectRoot - 项目根目录绝对路径
 * @returns 语言适配器 ID 列表
 */
function detectLanguages(projectRoot: string): string[] {
  const registry = LanguageAdapterRegistry.getInstance();

  // Registry 未初始化时返回空数组
  if (registry.isEmpty()) {
    return [];
  }

  try {
    const result = scanFiles(projectRoot, { projectRoot });
    if (result.languageStats) {
      return [...result.languageStats.keys()];
    }
  } catch {
    // scanFiles 异常时返回空数组
  }

  return [];
}

/**
 * 扫描项目根目录下的已知配置文件
 * 仅扫描根目录（深度 1），不递归子目录
 *
 * @param projectRoot - 项目根目录绝对路径
 * @returns 配置文件映射（文件名 -> 绝对路径）
 */
function scanConfigFiles(projectRoot: string): Map<string, string> {
  const configMap = new Map<string, string>();

  // 单次 readdirSync 获取目录列表，在内存中做精确匹配和正则匹配
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return configMap;
  }

  const knownSet = new Set(KNOWN_CONFIG_FILES);

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    // 精确匹配
    if (knownSet.has(entry.name)) {
      configMap.set(entry.name, path.join(projectRoot, entry.name));
      continue;
    }

    // 正则通配匹配
    for (const pattern of KNOWN_CONFIG_PATTERNS) {
      if (pattern.test(entry.name)) {
        configMap.set(entry.name, path.join(projectRoot, entry.name));
        break;
      }
    }
  }

  return configMap;
}

/**
 * 递归扫描 specs/ 目录下的 *.spec.md 文件
 *
 * @param projectRoot - 项目根目录绝对路径
 * @returns spec 文件绝对路径数组（排序后）
 */
function discoverExistingSpecs(projectRoot: string): string[] {
  const specsDir = path.join(projectRoot, 'specs');

  if (!fs.existsSync(specsDir)) {
    return [];
  }

  try {
    if (!fs.statSync(specsDir).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const specs: string[] = [];
  walkSpecsDir(specsDir, specs);
  specs.sort();
  return specs;
}

/**
 * 递归遍历目录收集 *.spec.md 文件
 *
 * @param dir - 当前遍历的目录
 * @param results - 结果收集数组
 */
function walkSpecsDir(dir: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // 不可读的目录静默跳过
    return;
  }

  for (const entry of entries) {
    // 跳过符号链接，防止循环遍历
    if (entry.isSymbolicLink()) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSpecsDir(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith('.spec.md')) {
      results.push(fullPath);
    }
  }
}

// ============================================================
// 主函数
// ============================================================

/**
 * 构建完整的 ProjectContext 对象
 *
 * 执行五个子流程：
 * 1. 包管理器检测（detectPackageManager）
 * 2. Workspace 类型识别（detectWorkspaceType）
 * 3. 多语言检测（detectLanguages，复用 scanFiles）
 * 4. 配置文件扫描（scanConfigFiles）
 * 5. 已有 spec 文件发现（discoverExistingSpecs）
 *
 * @param projectRoot - 项目根目录绝对路径
 * @returns 通过 ProjectContextSchema.parse() 验证的完整 ProjectContext 对象
 * @throws Error 当 projectRoot 不存在或不是目录时
 */
export async function buildProjectContext(
  projectRoot: string,
): Promise<ProjectContext> {
  // 验证 projectRoot 存在
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`项目根目录不存在: ${projectRoot}`);
  }

  // 验证 projectRoot 是目录
  if (!fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`路径不是目录: ${projectRoot}`);
  }

  // 执行五个子流程
  const packageManager = detectPackageManager(projectRoot);
  const workspaceType = detectWorkspaceType(projectRoot);
  const detectedLanguages = detectLanguages(projectRoot);
  const configFiles = scanConfigFiles(projectRoot);
  const existingSpecs = discoverExistingSpecs(projectRoot);

  // 组装 raw 对象并通过 Schema 验证
  const raw = {
    projectRoot,
    configFiles,
    packageManager,
    workspaceType,
    detectedLanguages,
    existingSpecs,
  };

  return ProjectContextSchema.parse(raw);
}
