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
 * 剥离每行行尾空白（space/tab）。
 * 渲染出口是"生成文本"的唯一序列化边界，LLM 段落的尾随空格若直通落盘会触发 `git diff --check` 告警。
 * 手写反向扫描而非 `/[ \t]+$/gm`（F221 Codex 对抗审查修订）：
 * - 正则版对"长空格段后接非空白"的行存在平方级回溯退化（实测 32k 空格单行 ~800ms）
 * - 正则 `$`（m 模式）把 U+2028/U+2029 也当行界，会误删字符串内容里的空格；split('\n') 只认 \n
 * 仅剥行尾，不折叠空行、不动行内空白（本仓库模板从不使用 Markdown 双空格硬换行）。
 */
function stripTrailingWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let end = line.length;
      while (end > 0) {
        const ch = line[end - 1];
        if (ch !== ' ' && ch !== '\t') break;
        end--;
      }
      return end === line.length ? line : line.slice(0, end);
    })
    .join('\n');
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

  // 将基线骨架序列化为 HTML 注释块（漂移检测 + panoramic 管线消费）
  const baselineJson = JSON.stringify(moduleSpec.baselineSkeleton);
  const baselineComment = `\n\n<!-- baseline-skeleton: ${baselineJson} -->\n`;

  // baseline JSON 不参与清洗：JSON.stringify 产物行尾本就无空白，而字符串值内可能
  // 含 U+2028/U+2029 等行界字符，任何文本级处理都可能改写内容（baseline 字节保真是漂移检测前提）
  return stripTrailingWhitespace(markdown) + baselineComment;
}

/**
 * 渲染架构索引
 */
export function renderIndex(data: Record<string, unknown>): string {
  if (!initialized || !indexSpecTemplate) {
    initRenderer();
  }
  return stripTrailingWhitespace(indexSpecTemplate!(data));
}

/**
 * 渲染漂移报告
 */
export function renderDriftReport(data: Record<string, unknown>): string {
  if (!initialized || !driftReportTemplate) {
    initRenderer();
  }
  return stripTrailingWhitespace(driftReportTemplate!(data));
}

/** 重置初始化状态（测试用） */
export function resetRenderer(): void {
  initialized = false;
  moduleSpecTemplate = null;
  indexSpecTemplate = null;
  driftReportTemplate = null;
}
