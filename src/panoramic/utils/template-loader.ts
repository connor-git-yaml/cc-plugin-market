/**
 * 模板加载工具 — 统一 Handlebars 模板的查找、编译和缓存
 *
 * 消除 ConfigReferenceGenerator、WorkspaceIndexGenerator、
 * CrossPackageAnalyzer、DataModelGenerator 中重复的模板加载逻辑：
 * - findTemplatePath / getCompiledTemplate 模式统一为 loadTemplate()
 * - 进程级缓存（Map），避免同一模板重复编译
 * - resetTemplateCache() 供测试使用
 *
 * 查找策略：
 * 1. 从调用者所在文件目录（importMetaUrl）向上最多 5 级查找 templates/ 子目录
 * 2. 降级到 process.cwd()/templates/
 * 3. 均未命中时抛出 Error
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';

/** 模板编译缓存（进程级） */
const cache = new Map<string, Handlebars.TemplateDelegate>();

/**
 * 加载并编译 Handlebars 模板（带缓存）
 *
 * @param templateName - 模板文件名（如 'config-reference.hbs'）
 * @param importMetaUrl - 调用者的 import.meta.url，用于定位 templates/ 目录
 * @returns 编译后的 Handlebars 模板委托
 * @throws Error 模板文件找不到时
 */
export function loadTemplate(templateName: string, importMetaUrl: string): Handlebars.TemplateDelegate {
  if (cache.has(templateName)) return cache.get(templateName)!;

  const tplPath = findTemplatePath(templateName, importMetaUrl);
  const compiled = Handlebars.compile(fs.readFileSync(tplPath, 'utf-8'), { noEscape: true });
  cache.set(templateName, compiled);
  return compiled;
}

/**
 * 查找模板文件路径
 * 从 importMetaUrl 对应的目录向上最多 5 级查找 templates/ 子目录，
 * 降级到 process.cwd()/templates/
 *
 * @param templateName - 模板文件名
 * @param importMetaUrl - 调用者的 import.meta.url
 * @returns 模板文件绝对路径
 * @throws Error 找不到时
 */
function findTemplatePath(templateName: string, importMetaUrl: string): string {
  let dir = path.dirname(new URL(importMetaUrl).pathname);
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'templates', templateName);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }

  const fallback = path.join(process.cwd(), 'templates', templateName);
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(`无法找到模板文件: ${templateName}`);
}

/**
 * 重置模板缓存（仅限测试使用）
 */
export function resetTemplateCache(): void {
  cache.clear();
}
