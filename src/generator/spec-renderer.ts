/**
 * Handlebars Spec 渲染器
 * 将 ModuleSpec 渲染为最终 Markdown（FR-006/FR-007/FR-008/FR-009）
 * 参见 contracts/generator.md
 */
import Handlebars from 'handlebars';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleSpec } from '../models/module-spec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '../../templates');

let moduleSpecTemplate: Handlebars.TemplateDelegate | null = null;
let indexSpecTemplate: Handlebars.TemplateDelegate | null = null;
let driftReportTemplate: Handlebars.TemplateDelegate | null = null;
let initialized = false;

/**
 * 注册自定义 Handlebars Helpers
 */
function registerHelpers(): void {
  // 格式化 TypeScript 签名为 Markdown 代码
  Handlebars.registerHelper('formatSignature', (signature: string) => {
    if (!signature) return '';
    return new Handlebars.SafeString(`\`${signature}\``);
  });

  // 智能判空
  Handlebars.registerHelper('hasContent', (value: unknown) => {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
  });

  // 文件路径转 Spec 链接
  Handlebars.registerHelper('specLink', (filePath: string) => {
    if (!filePath) return '';
    const specName = path.basename(filePath, path.extname(filePath));
    return new Handlebars.SafeString(`[${specName}](${specName}.spec.md)`);
  });

  // Mermaid 类图包装
  Handlebars.registerHelper('mermaidClass', (source: string) => {
    if (!source) return '';
    return new Handlebars.SafeString(`\`\`\`mermaid\n${source}\n\`\`\``);
  });
}

/**
 * 一次性初始化：编译模板、注册 Helpers
 * 必须在首次调用 renderSpec() 之前执行
 */
export function initRenderer(): void {
  if (initialized) return;

  registerHelpers();

  // 编译模板
  const moduleSpecSrc = fs.readFileSync(
    path.join(TEMPLATES_DIR, 'module-spec.hbs'),
    'utf-8',
  );
  moduleSpecTemplate = Handlebars.compile(moduleSpecSrc, { noEscape: true });

  const indexSpecSrc = fs.readFileSync(
    path.join(TEMPLATES_DIR, 'index-spec.hbs'),
    'utf-8',
  );
  indexSpecTemplate = Handlebars.compile(indexSpecSrc, { noEscape: true });

  const driftReportSrc = fs.readFileSync(
    path.join(TEMPLATES_DIR, 'drift-report.hbs'),
    'utf-8',
  );
  driftReportTemplate = Handlebars.compile(driftReportSrc, { noEscape: true });

  initialized = true;
}

/**
 * 使用 Handlebars 模板将 ModuleSpec 渲染为 Markdown
 *
 * @param moduleSpec - 完整的 ModuleSpec 数据
 * @returns 包含 YAML frontmatter + 9 章节 + Mermaid + 基线骨架的完整 Markdown
 */
export function renderSpec(moduleSpec: ModuleSpec): string {
  if (!initialized || !moduleSpecTemplate) {
    initRenderer();
  }

  const markdown = moduleSpecTemplate!(moduleSpec);

  // 将基线骨架序列化为 HTML 注释块（漂移检测用）
  const baselineJson = JSON.stringify(moduleSpec.baselineSkeleton);
  const baselineComment = `\n\n<!-- baseline-skeleton: ${baselineJson} -->\n`;

  return markdown + baselineComment;
}

/**
 * 渲染架构索引
 */
export function renderIndex(data: Record<string, unknown>): string {
  if (!initialized || !indexSpecTemplate) {
    initRenderer();
  }
  return indexSpecTemplate!(data);
}

/**
 * 渲染漂移报告
 */
export function renderDriftReport(data: Record<string, unknown>): string {
  if (!initialized || !driftReportTemplate) {
    initRenderer();
  }
  return driftReportTemplate!(data);
}

/** 重置初始化状态（测试用） */
export function resetRenderer(): void {
  initialized = false;
  moduleSpecTemplate = null;
  indexSpecTemplate = null;
  driftReportTemplate = null;
}
