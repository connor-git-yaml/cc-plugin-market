/**
 * .specify/templates 基础模板同步器
 * 用于首次运行时自动补齐 Spec Driver 依赖的模板文件。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_TEMPLATES = [
  'plan-template.md',
  'spec-template.md',
  'tasks-template.md',
  'checklist-template.md',
  'constitution-template.md',
  'agent-file-template.md',
] as const;

export interface EnsureSpecifyTemplatesResult {
  copied: string[];
  missing: string[];
}

export interface EnsureSpecifyTemplatesOptions {
  /**
   * 模板源目录列表（按优先级）。
   * 默认自动探测 package 内置路径和开发态路径。
   */
  sourceDirs?: string[];
}

function getDefaultSourceDirs(): string[] {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return [
    // 运行态（dist/ -> package root）
    path.resolve(__dirname, '../../plugins/spec-driver/templates/specify-base'),
    // 开发态兜底（仓库根 .specify/templates）
    path.resolve(__dirname, '../../.specify/templates'),
    // 当前项目内置（若项目自身 vendored 了 spec-driver）
    path.resolve(process.cwd(), 'plugins/spec-driver/templates/specify-base'),
  ];
}

function resolveTemplateSource(
  templateName: string,
  sourceDirs: string[],
): string | null {
  for (const dir of sourceDirs) {
    const candidate = path.join(dir, templateName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * 确保项目 .specify/templates 基础模板存在（幂等）。
 */
export function ensureSpecifyTemplates(
  projectRoot: string,
  options: EnsureSpecifyTemplatesOptions = {},
): EnsureSpecifyTemplatesResult {
  const sourceDirs = options.sourceDirs ?? getDefaultSourceDirs();
  const targetDir = path.join(projectRoot, '.specify', 'templates');
  fs.mkdirSync(targetDir, { recursive: true });

  const copied: string[] = [];
  const missing: string[] = [];

  for (const templateName of REQUIRED_TEMPLATES) {
    const targetPath = path.join(targetDir, templateName);
    if (fs.existsSync(targetPath)) {
      continue;
    }

    const sourcePath = resolveTemplateSource(templateName, sourceDirs);
    if (!sourcePath) {
      missing.push(templateName);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    copied.push(templateName);
  }

  return { copied, missing };
}

