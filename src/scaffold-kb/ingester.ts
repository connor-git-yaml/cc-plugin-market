/**
 * F190 scaffold-kb — DocumentIngester
 *
 * 提供两种文档输入模式（FR-001）：
 * - `--dir`：递归扫描目录下的 *.md 文件，解析为 ParsedDoc
 * - `--llms-txt`：从远程 URL 取 llms.txt 格式，解析条目后逐一抓取文档
 *
 * 两种模式可同时使用：以 llms-txt 为主，--dir 作补充，按 id 去重（llms-txt 优先保留）。
 * EC-008：llms.txt URL 取回或格式解析失败 → throw（原子性，不返回部分结果）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ParsedDoc } from './types.js';

/**
 * ingestDocuments 的输入选项
 */
export interface IngestOptions {
  /** 本地 Markdown 文档目录 */
  dirPath?: string;
  /** 远程 llms.txt 索引 URL */
  llmsTxtUrl?: string;
  /** 语言标记（如 'zh' | 'en'），传给所有解析出的文档 */
  lang?: string;
  /**
   * 注入 fetch 实现（用于测试时替换真实网络请求）。
   * 缺省使用 Node.js 内置 `fetch`。
   * 函数签名：(url: string) => Promise<string>，返回响应正文字符串。
   */
  fetchImpl?: (url: string) => Promise<string>;
}

/** llms.txt 中解析出的单条条目 */
interface LlmsTxtEntry {
  /** 文档标题（若解析到；否则从 URL 提取最后路径段） */
  title: string;
  /** 文档 URL */
  url: string;
}

/**
 * 从 Markdown 内容中提取 `[text](target)` 格式的链接目标列表。
 * 仅提取相对路径链接（不以 http/https 开头）。
 */
function extractMarkdownLinks(content: string): string[] {
  const refs: string[] = [];
  // 匹配 [text](target) 格式
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(content)) !== null) {
    const target = m[2];
    if (target === undefined) continue;
    // 只保留相对路径引用（.md 链接等），过滤掉带协议的 URL
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      refs.push(target);
    }
  }
  return refs;
}

/**
 * 从 Markdown 内容中提取第一个 `# 标题` 行。
 * 若找不到，返回 undefined。
 */
function extractFirstH1(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const m = /^#\s+(.+)$/.exec(line.trim());
    if (m !== null && m[1] !== undefined) {
      return m[1].trim();
    }
  }
  return undefined;
}

/**
 * 递归遍历目录，收集所有 *.md 文件的绝对路径。
 * 不跟随符号链接，跳过隐藏目录（以 `.` 开头的目录，如 .git）。
 */
function walkMdFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // 无法读取的目录直接报错（不静默跳过，保证调用方感知）
    throw new Error(`无法读取目录 ${dir}: ${String(err)}`);
  }
  for (const entry of entries) {
    // 跳过符号链接与隐藏目录
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      results.push(...walkMdFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results.sort();
}

/**
 * 从目录扫描 *.md 并解析为 ParsedDoc 列表。
 * id = 文件相对于 dirPath 的路径（用 `/` 分隔）。
 */
function ingestDir(dirPath: string, lang: string): ParsedDoc[] {
  const resolvedDir = path.resolve(dirPath);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`目录不存在: ${resolvedDir}`);
  }
  if (!fs.statSync(resolvedDir).isDirectory()) {
    throw new Error(`路径不是目录: ${resolvedDir}`);
  }

  const absolutePaths = walkMdFiles(resolvedDir);
  const docs: ParsedDoc[] = [];

  for (const absPath of absolutePaths) {
    const relPath = path.relative(resolvedDir, absPath).replace(/\\/g, '/');
    const content = fs.readFileSync(absPath, 'utf-8');
    const title = extractFirstH1(content) ?? path.basename(absPath, '.md');
    const references = extractMarkdownLinks(content);

    docs.push({
      id: relPath,
      title,
      content,
      sourceUrl: absPath,
      lang,
      references: references.length > 0 ? references : undefined,
    });
  }

  return docs;
}

/**
 * 解析 llms.txt 格式，提取条目列表。
 *
 * 支持格式：
 * - `# 注释行`：跳过
 * - `- [title](url)`：Markdown 链接格式
 * - `https://...` 或 `http://...`：裸 URL
 * - 空行：跳过
 *
 * EC-008：若整个内容无法解析出任何有效条目 → throw（视为格式非法）。
 */
function parseLlmsTxt(content: string, sourceUrl: string): LlmsTxtEntry[] {
  const entries: LlmsTxtEntry[] = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    // 跳过空行与注释行
    if (!line || line.startsWith('#')) continue;

    // 尝试匹配 `- [title](url)` 格式
    const mdLink = /^-\s*\[([^\]]*)\]\(([^)]+)\)/.exec(line);
    if (mdLink !== null && mdLink[2] !== undefined) {
      const title = mdLink[1]?.trim() ?? '';
      const url = mdLink[2].trim();
      entries.push({
        title: title.length > 0 ? title : urlToTitle(url),
        url,
      });
      continue;
    }

    // 尝试匹配裸 URL
    if (line.startsWith('http://') || line.startsWith('https://')) {
      entries.push({ title: urlToTitle(line), url: line });
      continue;
    }

    // 其他行静默跳过（宽松解析，不因未知行格式而 throw）
  }

  if (entries.length === 0) {
    throw new Error(
      `llms.txt 格式非法或内容为空：无法从 ${sourceUrl} 解析出任何有效条目。` +
        '请确认 URL 返回了合法的 llms.txt 格式（每行 `- [title](url)` 或裸 URL）。',
    );
  }

  return entries;
}

/** 从 URL 中提取最后一个路径段作为标题 */
function urlToTitle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter((s) => s.length > 0);
    return parts[parts.length - 1] ?? url;
  } catch {
    return url;
  }
}

/**
 * 将 URL 转换为文档 id（去除协议头与尾部斜杠，作为稳定唯一 id）。
 * 例：`https://hono.dev/docs/api` → `hono.dev/docs/api`
 */
function urlToDocId(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * 从 llms.txt URL 模式拉取文档，返回 ParsedDoc 列表。
 *
 * EC-008 原子性保证：
 * - llms.txt URL 取回失败 → throw（不返回部分结果）
 * - llms.txt 格式非法（无有效条目）→ throw
 * - 单个文档 URL 取回失败 → throw（整个操作失败，不返回已成功的部分）
 */
async function ingestLlmsTxt(
  llmsTxtUrl: string,
  lang: string,
  fetchImpl: (url: string) => Promise<string>,
): Promise<ParsedDoc[]> {
  // 步骤 1：取 llms.txt 内容（失败 → throw，EC-008）
  let llmsTxtContent: string;
  try {
    llmsTxtContent = await fetchImpl(llmsTxtUrl);
  } catch (err) {
    throw new Error(
      `llms.txt 获取失败（URL: ${llmsTxtUrl}）：${String(err)}。` +
        '请检查网络连通性或 URL 是否正确。',
    );
  }

  // 步骤 2：解析 llms.txt（格式非法 → throw，EC-008）
  const entries = parseLlmsTxt(llmsTxtContent, llmsTxtUrl);

  // 步骤 3：逐条抓取文档（任一失败 → throw，EC-008 原子性）
  const docs: ParsedDoc[] = [];
  for (const entry of entries) {
    let docContent: string;
    try {
      docContent = await fetchImpl(entry.url);
    } catch (err) {
      throw new Error(
        `文档获取失败（URL: ${entry.url}，来自 ${llmsTxtUrl}）：${String(err)}。` +
          'llms.txt 构建已中止，未生成任何产物。',
      );
    }

    const title = extractFirstH1(docContent) ?? entry.title;
    const references = extractMarkdownLinks(docContent);
    const docId = urlToDocId(entry.url);

    docs.push({
      id: docId,
      title,
      content: docContent,
      sourceUrl: entry.url,
      lang,
      references: references.length > 0 ? references : undefined,
    });
  }

  return docs;
}

/**
 * 从多来源抓取文档，返回去重后的 ParsedDoc 列表。
 *
 * 行为契约：
 * - 两种模式均未提供 → throw（含用法提示）
 * - llms-txt 优先：同 id 以 llms-txt 结果保留
 * - EC-008：llms.txt 任一环节失败 → throw，不返回部分结果
 */
export async function ingestDocuments(opts: IngestOptions): Promise<ParsedDoc[]> {
  const { dirPath, llmsTxtUrl, lang = 'en', fetchImpl } = opts;

  // 参数校验：两者均未提供
  if (dirPath === undefined && llmsTxtUrl === undefined) {
    throw new Error(
      '参数错误：--dir 或 --llms-txt 至少需要提供其一。\n' +
        '用法：ingestDocuments({ dirPath: "/path/to/docs" }) 或\n' +
        '      ingestDocuments({ llmsTxtUrl: "https://example.com/llms.txt" })',
    );
  }

  // 实际使用的 fetch 实现（缺省用 Node.js 内置 fetch）
  const doFetch =
    fetchImpl ??
    (async (url: string): Promise<string> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return res.text();
    });

  // 以 id 为键的 Map 保证去重（先写入的优先，即 llms-txt 优先）
  const docMap = new Map<string, ParsedDoc>();

  // 步骤 1：处理 llms-txt 模式（先执行，使其条目优先被保留）
  if (llmsTxtUrl !== undefined) {
    const llmsDocs = await ingestLlmsTxt(llmsTxtUrl, lang, doFetch);
    for (const doc of llmsDocs) {
      docMap.set(doc.id, doc);
    }
  }

  // 步骤 2：处理 dir 模式（后执行，已有 id 的条目不覆盖）
  if (dirPath !== undefined) {
    const dirDocs = ingestDir(dirPath, lang);
    for (const doc of dirDocs) {
      if (!docMap.has(doc.id)) {
        docMap.set(doc.id, doc);
      }
    }
  }

  return Array.from(docMap.values());
}
