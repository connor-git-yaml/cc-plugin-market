/**
 * SkillMdParser — SKILL.md 文件解析器
 *
 * 解析策略：
 * 1. 正则提取 YAML frontmatter（--- 分隔块）
 * 2. 逐行匹配 key: value 提取 name/description/version
 * 3. 匹配一级标题（#）作为 title
 * 4. 按二级标题（##）分割内容，每段包含 heading 和 content
 *
 * 容错降级：
 * - 无 frontmatter 时从一级标题推断 name
 * - 空文件返回 { name: '', description: '', title: '', sections: [] }
 */
import { AbstractArtifactParser } from './abstract-artifact-parser.js';
import type { SkillMdInfo, SkillMdSection } from './types.js';

/** frontmatter 匹配正则：匹配 --- 开头和 --- 结尾之间的内容 */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** frontmatter 键值对匹配正则 */
const KV_LINE_RE = /^(\w[\w-]*):\s*(.*)$/;

/** 一级标题匹配正则 */
const H1_RE = /^#\s+(.+)$/m;

/** 二级标题匹配正则（非全局，matchAll 时动态创建全局版本） */
const H2_RE = /^##\s+(.+)$/m;

/**
 * SKILL.md 文件解析器
 * 实现 ArtifactParser<SkillMdInfo> 接口
 */
export class SkillMdParser extends AbstractArtifactParser<SkillMdInfo> {
  readonly id = 'skill-md' as const;
  readonly name = 'SKILL.md Parser' as const;
  readonly filePatterns = ['**/SKILL.md'] as const;

  /**
   * 从 SKILL.md 内容解析为结构化数据
   */
  protected doParse(content: string, _filePath: string): SkillMdInfo {
    // 空内容直接返回降级结果
    if (!content.trim()) {
      return this.createFallback();
    }

    // 提取 frontmatter
    const frontmatter = this.extractFrontmatter(content);

    // 移除 frontmatter 后的 body
    const body = content.replace(FRONTMATTER_RE, '').trim();

    // 提取一级标题
    const h1Match = H1_RE.exec(body);
    const title = h1Match ? h1Match[1]!.trim() : '';

    // 如果没有 frontmatter，从一级标题推断 name
    const name = frontmatter.name || title;
    const description = frontmatter.description || '';
    const version = frontmatter.version || undefined;

    // 提取二级标题分段
    const sections = this.extractSections(body);

    return { name, description, version, title, sections };
  }

  /**
   * 降级结果
   */
  protected createFallback(): SkillMdInfo {
    return { name: '', description: '', title: '', sections: [] };
  }

  /**
   * 从 frontmatter 块提取 key-value 对
   */
  private extractFrontmatter(content: string): Record<string, string> {
    const match = FRONTMATTER_RE.exec(content);
    if (!match) return {};

    const result: Record<string, string> = {};
    const lines = match[1]!.split('\n');

    for (const line of lines) {
      const kvMatch = KV_LINE_RE.exec(line.trim());
      if (kvMatch) {
        result[kvMatch[1]!] = kvMatch[2]!.trim();
      }
    }

    return result;
  }

  /**
   * 按 ## 二级标题分割 body，提取每个分段的 heading 和 content
   * 使用 matchAll + 新建全局正则，避免共享全局正则的 lastIndex 状态污染
   */
  private extractSections(body: string): SkillMdSection[] {
    const sections: SkillMdSection[] = [];

    // 找到所有 ## 标题的位置（使用 matchAll 避免全局正则状态问题）
    const matches: Array<{ heading: string; index: number }> = [];
    for (const m of body.matchAll(new RegExp(H2_RE.source, 'gm'))) {
      matches.push({ heading: m[1]!.trim(), index: m.index! });
    }

    if (matches.length === 0) return sections;

    // 逐个提取标题下方的内容
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i]!;
      const next = matches[i + 1];

      // 当前标题行结束位置（跳过标题行本身）
      const headingLineEnd = body.indexOf('\n', current.index);
      const contentStart = headingLineEnd === -1 ? body.length : headingLineEnd + 1;

      // 下一个标题的起始位置，或 body 末尾
      const contentEnd = next ? next.index : body.length;

      const content = body.slice(contentStart, contentEnd).trim();
      sections.push({ heading: current.heading, content });
    }

    return sections;
  }
}
