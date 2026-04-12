/**
 * Markdown 文档提取器（Feature 107）
 * 两阶段提取：
 * 1. 确定性提取（无 LLM）：标题树 + frontmatter 解析 → document 节点（EXTRACTED）
 * 2. LLM 实体提取（可选）：命名实体 + 决策段落 → 丰富 document metadata（INFERRED）
 * 3. 文件路径引用检测：反引号内文件路径 → references 边（INFERRED）
 */
import * as path from 'node:path';
import { createLogger } from '../panoramic/utils/logger.js';
import { callLLM } from '../panoramic/utils/llm-facade.js';
import type { ExtractionResult, ExtractedNode, ExtractedEdge } from './extraction-types.js';
import { EMPTY_EXTRACTION_RESULT } from './extraction-types.js';

const logger = createLogger('extraction-markdown');

// ============================================================
// Frontmatter 解析
// ============================================================

interface FrontmatterData {
  [key: string]: unknown;
}

/**
 * 解析 YAML frontmatter（--- 分隔块）
 * 仅支持一级 key: value 形式，足够覆盖 Markdown 文档的常见字段
 */
function parseFrontmatter(content: string): { frontmatter: FrontmatterData; body: string } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: {}, body: content };
  }

  const lines = content.split('\n');
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trimEnd() === '---') {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join('\n').trimStart();

  const frontmatter: FrontmatterData = {};
  for (const line of frontmatterLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ============================================================
// 标题树提取
// ============================================================

interface Heading {
  level: number;
  text: string;
}

/**
 * 从 Markdown body 提取标题列表
 * 识别 ATX 标题（# / ## / ###）
 */
function extractHeadings(body: string): Heading[] {
  const headings: Heading[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trimEnd());
    if (match && match[1] && match[2]) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

// ============================================================
// 文件路径引用检测
// ============================================================

/** 匹配反引号内的路径（如 `src/auth/auth.ts`） */
const FILE_PATH_PATTERN = /`([^`]*(?:\/[^`]*)+\.[a-zA-Z0-9]+)`/g;

/**
 * 扫描 Markdown body 中的文件路径引用
 * 生成 references 边（INFERRED）
 *
 * @param body - Markdown body 内容
 * @param sourceNodeId - 来源文档节点 ID
 * @returns 检测到的 references 边列表
 */
function detectFileReferences(body: string, sourceNodeId: string): ExtractedEdge[] {
  const edges: ExtractedEdge[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  FILE_PATH_PATTERN.lastIndex = 0;

  while ((match = FILE_PATH_PATTERN.exec(body)) !== null) {
    const filePath = match[1]!.trim();
    // 过滤掉看起来不像代码文件路径的内容
    if (filePath.length < 5 || seen.has(filePath)) continue;
    seen.add(filePath);

    // 生成模块 ID（使用 posix 格式）
    const targetId = `module:${filePath.replace(/\\/g, '/')}`;
    edges.push({
      source: sourceNodeId,
      target: targetId,
      relation: 'references',
      confidence: 'INFERRED',
      weight: 1.0,
    });
  }

  return edges;
}

// ============================================================
// LLM 实体提取
// ============================================================

/** LLM 实体提取 system prompt */
const ENTITY_EXTRACTION_SYSTEM_PROMPT = `你是一个结构化信息提取器。请从提供的 Markdown 文档中提取关键信息。

请以 JSON 格式返回，格式如下：
{
  "concepts": ["概念1", "概念2"],
  "decisions": ["决策描述1", "决策描述2"]
}

规则：
- concepts：文档中提到的核心技术概念、组件名称、服务名称（最多 10 个）
- decisions：文档中记录的设计决策或架构决定（最多 5 个）
- 如果没有相关内容，对应字段返回空数组
- 只返回 JSON，不添加其他内容`;

interface LLMExtractionResult {
  concepts: string[];
  decisions: string[];
}

/**
 * 调用 LLM 提取文档实体
 * 失败时返回 null（调用方降级处理）
 */
async function extractEntitiesWithLLM(body: string): Promise<LLMExtractionResult | null> {
  // 限制输入长度（约 8000 token ≈ 24000 字符）
  const truncatedBody = body.length > 24000 ? body.slice(0, 24000) + '\n...[内容过长已截断]' : body;

  let response: string | null;
  try {
    response = await callLLM(truncatedBody, {
      systemPrompt: ENTITY_EXTRACTION_SYSTEM_PROMPT,
      maxTokens: 1024,
      timeout: 8000,  // FR-016：超时 8 秒
      temperature: 0.1,
    });
  } catch (err) {
    logger.debug(`LLM 实体提取调用失败: ${String(err)}`);
    return null;
  }

  if (!response) return null;

  // 尝试解析 JSON
  try {
    // 尝试从 markdown 代码块中提取
    const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : response;
    const parsed = JSON.parse(jsonStr.trim()) as LLMExtractionResult;
    if (!Array.isArray(parsed.concepts) || !Array.isArray(parsed.decisions)) {
      return null;
    }
    return parsed;
  } catch {
    logger.debug('LLM 返回内容无法解析为 JSON，跳过 LLM 实体提取');
    return null;
  }
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 提取单个 Markdown 文件的节点和边
 *
 * @param filePath - 文件绝对路径
 * @param content - 文件内容
 * @param projectRoot - 项目根目录（计算相对路径）
 * @returns ExtractionResult（不抛出异常，失败时降级为 EMPTY_EXTRACTION_RESULT）
 */
export async function extractMarkdown(
  filePath: string,
  content: string,
  projectRoot: string,
): Promise<ExtractionResult> {
  try {
    const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const nodeId = `doc:${relPath}`;

    // 第一步：确定性提取（frontmatter + 标题树）
    const { frontmatter, body } = parseFrontmatter(content);
    const headings = extractHeadings(body);

    // 文档标题：优先使用 frontmatter.title，其次 H1 标题，最后用文件名
    const title =
      (typeof frontmatter.title === 'string' ? frontmatter.title : '') ||
      headings.find((h) => h.level === 1)?.text ||
      path.basename(filePath, path.extname(filePath));

    const docNode: ExtractedNode = {
      id: nodeId,
      label: title,
      kind: 'document',
      source_file: filePath,
      confidence: 'EXTRACTED',
      metadata: {
        frontmatter,
        headings: headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`),
      },
    };

    const nodes: ExtractedNode[] = [docNode];
    const edges: ExtractedEdge[] = [];

    // 第二步：文件路径引用检测 → references 边
    const refEdges = detectFileReferences(body, nodeId);
    edges.push(...refEdges);

    // 第三步：LLM 实体提取（可选，失败不影响确定性结果）
    if (body.trim().length > 0) {
      const llmResult = await extractEntitiesWithLLM(body).catch(() => null);
      if (llmResult) {
        // 将 LLM 提取结果追加到 metadata
        docNode.metadata = {
          ...docNode.metadata,
          concepts: llmResult.concepts,
          decisions: llmResult.decisions,
          llmEnriched: true,
        };
        // FR-003：LLM 富化后整体节点标注 INFERRED，不允许标记为 EXTRACTED
        docNode.confidence = 'INFERRED';
      }
    }

    return { nodes, edges };
  } catch (err) {
    logger.warn(`Markdown 提取失败: ${filePath} — ${String(err)}`);
    return EMPTY_EXTRACTION_RESULT;
  }
}
