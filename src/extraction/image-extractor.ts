/**
 * 图像/图表 Vision 提取器（Feature 107）
 * 通过 Claude Vision API 分析图像，生成 diagram 节点（INFERRED）
 *
 * 三级降级路径（FR-008）：
 * 1. ANTHROPIC_API_KEY 不存在 → 跳过全部图像，返回 EMPTY_EXTRACTION_RESULT
 * 2. Vision API 调用失败 → 单张图片跳过，返回 EMPTY_EXTRACTION_RESULT
 * 3. LLM 返回无法解析为 JSON → 返回 EMPTY_EXTRACTION_RESULT
 *
 * 安全：API key 脱敏（FR-022），日志只显示前 4 位 + ***
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../panoramic/utils/logger.js';
import type { ExtractionResult, ExtractedNode, ExtractedEdge } from './extraction-types.js';
import { EMPTY_EXTRACTION_RESULT } from './extraction-types.js';

const logger = createLogger('extraction-image');

// ============================================================
// 常量
// ============================================================

/** 默认 Vision 模型（可通过 SPECTRA_VISION_MODEL 环境变量覆盖） */
const DEFAULT_VISION_MODEL = 'claude-sonnet-4-5';

/** 文件大小上限：10 MB（FR-009） */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** 支持的二进制图像格式（可转换为 base64 传入 Vision API） */
const BINARY_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

/** SVG 以文本方式处理（不转 base64） */
const SVG_EXTENSION = '.svg';

// ============================================================
// 接口定义
// ============================================================

/** 图像提取器选项 */
export interface ImageExtractorOptions {
  /** 项目根目录（用于计算相对路径） */
  projectRoot: string;
  /**
   * Anthropic 客户端工厂函数（可注入用于测试）
   * 如果为 undefined，使用默认 new Anthropic({ apiKey })
   */
  anthropicClientFactory?: (apiKey: string) => Pick<Anthropic, 'messages'>;
}

// ============================================================
// API key 脱敏（FR-022）
// ============================================================

/**
 * 脱敏 API key，仅显示前 4 位 + ***
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 4) return '****';
  return key.slice(0, 4) + '***';
}

// ============================================================
// Vision API 调用
// ============================================================

/** Vision 提取 system prompt */
const VISION_SYSTEM_PROMPT = `你是一个结构化信息提取器，专门分析软件工程图表。
请分析提供的图像，提取图中的组件、关系和描述。

以 JSON 格式返回：
{
  "description": "图表的简短描述（一句话）",
  "components": ["组件1", "组件2", "组件3"]
}

只返回 JSON，不添加其他内容。`;

interface VisionExtractionResult {
  description: string;
  components: string[];
}

/**
 * 调用 Vision API 分析图像
 *
 * @param client - Anthropic 客户端
 * @param imageContent - 图像内容（base64 字符串或 SVG 文本）
 * @param mediaType - MIME 类型
 * @param isSvg - 是否为 SVG 文本
 * @param model - 使用的模型
 * @returns 解析结果或 null（降级）
 */
async function callVisionApi(
  client: Pick<Anthropic, 'messages'>,
  imageContent: string,
  mediaType: 'image/png' | 'image/jpeg' | 'image/svg+xml',
  isSvg: boolean,
  model: string,
): Promise<VisionExtractionResult | null> {
  const messageContent: Anthropic.MessageCreateParamsNonStreaming['messages'][0]['content'] = isSvg
    ? `以下是一个 SVG 图表的内容：\n\n${imageContent}\n\n请分析此图表。`
    : [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType as 'image/png' | 'image/jpeg',
            data: imageContent,
          },
        },
      ];

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: messageContent,
      },
    ],
  });

  const textContent = (response as Anthropic.Message).content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  if (!textContent) return null;

  // 解析 JSON
  try {
    const codeBlockMatch = textContent.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : textContent;
    const parsed = JSON.parse(jsonStr.trim()) as VisionExtractionResult;
    if (typeof parsed.description !== 'string') return null;
    return {
      description: parsed.description,
      components: Array.isArray(parsed.components) ? parsed.components : [],
    };
  } catch {
    return null;
  }
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 从单个图像文件提取节点和边
 *
 * @param filePath - 图像文件绝对路径
 * @param options - 提取器选项
 * @returns ExtractionResult（不抛出异常，失败时返回 EMPTY_EXTRACTION_RESULT）
 */
export async function extractImage(
  filePath: string,
  options: ImageExtractorOptions,
): Promise<ExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();

  // 格式过滤：只支持 PNG/JPG/JPEG/SVG
  if (!BINARY_IMAGE_EXTENSIONS.has(ext) && ext !== SVG_EXTENSION) {
    logger.debug(`不支持的图像格式，跳过: ${filePath}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 降级级别 1：API key 检查（FR-022 脱敏）
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey || !apiKey.trim()) {
    logger.info('ANTHROPIC_API_KEY 未设置，跳过图像提取（Vision API 不可用）');
    return EMPTY_EXTRACTION_RESULT;
  }

  // 文件大小检查（FR-009）
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      logger.warn(`图像文件过大（${sizeMB} MB），跳过: ${filePath}`);
      return EMPTY_EXTRACTION_RESULT;
    }
  } catch (err) {
    logger.warn(`无法读取文件信息，跳过: ${filePath} — ${String(err)}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 计算相对路径
  const relPath = path.relative(options.projectRoot, filePath).replace(/\\/g, '/');
  const nodeId = `diagram:${relPath}`;

  // 读取文件内容
  let imageContent: string;
  let mediaType: 'image/png' | 'image/jpeg' | 'image/svg+xml';
  const isSvg = ext === SVG_EXTENSION;

  try {
    if (isSvg) {
      // SVG 以文本方式读取
      imageContent = fs.readFileSync(filePath, 'utf-8');
      mediaType = 'image/svg+xml';
    } else {
      // 二进制图像转 base64
      const buffer = fs.readFileSync(filePath);
      imageContent = buffer.toString('base64');
      mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';
    }
  } catch (err) {
    logger.warn(`读取图像文件失败: ${filePath} — ${String(err)}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 构建 Anthropic 客户端
  const model = process.env['SPECTRA_VISION_MODEL'] ?? DEFAULT_VISION_MODEL;
  const client = options.anthropicClientFactory
    ? options.anthropicClientFactory(apiKey)
    : new Anthropic({ apiKey });

  // 降级级别 2/3：Vision API 调用 + JSON 解析
  let visionResult: VisionExtractionResult | null;
  try {
    visionResult = await callVisionApi(client, imageContent, mediaType, isSvg, model);
  } catch (err) {
    // 降级级别 2：API 调用失败
    logger.warn(`Vision API 调用失败，跳过: ${filePath} — ${String(err)}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 降级级别 3：解析失败
  if (!visionResult) {
    logger.debug(`Vision 返回内容无法解析为 JSON，跳过: ${filePath}`);
    return EMPTY_EXTRACTION_RESULT;
  }

  // 构建 diagram 节点
  const nodes: ExtractedNode[] = [
    {
      id: nodeId,
      label: visionResult.description || path.basename(filePath),
      kind: 'diagram',
      source_file: filePath,
      confidence: 'INFERRED',
      metadata: {
        description: visionResult.description,
        components: visionResult.components,
        model,
        apiKeyMasked: maskApiKey(apiKey),
      },
    },
  ];

  const edges: ExtractedEdge[] = [];

  // depicts 边：diagram → 识别到的组件（INFERRED）
  for (const component of visionResult.components) {
    edges.push({
      source: nodeId,
      target: `component:${component}`,
      relation: 'depicts',
      confidence: 'INFERRED',
      weight: 1.0,
    });
  }

  return { nodes, edges };
}
