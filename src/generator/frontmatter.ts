/**
 * YAML Frontmatter 生成器（含版本自增）
 * 参见 contracts/generator.md
 */
import type { SpecFrontmatter, TokenUsage } from '../models/module-spec.js';

export interface FrontmatterInput {
  /** 源目标路径 */
  sourceTarget: string;
  /** 人类可读的模块显示名（默认取目录名） */
  displayName?: string;
  /** 相关文件路径列表 */
  relatedFiles: string[];
  /** 置信度等级 */
  confidence: 'high' | 'medium' | 'low';
  /** baseline CodeSkeleton 的 SHA-256 哈希 */
  skeletonHash: string;
  /** 已有版本号（如 'v3'），用于自动递增 */
  existingVersion?: string;
  /** 模块主要编程语言（多语言项目时设置） */
  language?: string;
  /** 跨语言引用（如 ['go:services/auth', 'python:scripts/deploy']） */
  crossLanguageRefs?: string[];
  /** 本次生成消耗的 token 使用量（Feature 127） */
  tokenUsage?: TokenUsage;
  /** LLM + enrichment 总耗时（毫秒）（Feature 127） */
  durationMs?: number;
  /** 实际使用的 LLM 模型 ID（Feature 127） */
  llmModel?: string;
  /** 降级原因（Feature 127）；未降级时为 null，未知时不传 */
  fallbackReason?: string | null;
  /** spec 身份类型（Feature 128，canonical / derived / bundle_copy） */
  sourceKind?: 'canonical' | 'derived' | 'bundle_copy';
  /** 派生来源 spec 的 outputPath（Feature 128）；canonical 时为 null 或 undefined */
  derivedFrom?: string | null;
}

/**
 * 版本号自增
 * v1 → v2, v3 → v4
 * 新规格无已有版本时返回 v1
 */
function incrementVersion(existing?: string): string {
  if (!existing) return 'v1';
  const match = /^v(\d+)$/.exec(existing);
  if (!match) return 'v1';
  return `v${parseInt(match[1]!, 10) + 1}`;
}

/**
 * 生成 YAML Frontmatter 数据
 *
 * @param data - Frontmatter 输入
 * @returns SpecFrontmatter
 */
export function generateFrontmatter(data: FrontmatterInput): SpecFrontmatter {
  const frontmatter: SpecFrontmatter = {
    type: 'module-spec',
    version: incrementVersion(data.existingVersion),
    generatedBy: 'spectra v3.0',
    sourceTarget: data.sourceTarget,
    relatedFiles: data.relatedFiles,
    lastUpdated: new Date().toISOString(),
    confidence: data.confidence,
    skeletonHash: data.skeletonHash,
  };

  // displayName（人类可读标题）
  if (data.displayName) {
    frontmatter.displayName = data.displayName;
  }

  // 多语言项目扩展字段（仅设置时填充）
  if (data.language) {
    frontmatter.language = data.language;
  }
  if (data.crossLanguageRefs && data.crossLanguageRefs.length > 0) {
    frontmatter.crossLanguageRefs = data.crossLanguageRefs;
  }

  // 成本元数据（Feature 127）— 4 个字段作为一组写入
  // 只要 tokenUsage 传入就把全组写入，包括 output=0 / durationMs=0 / llmModel='' 等 AST-only 情形
  if (data.tokenUsage) {
    frontmatter.tokenUsage = data.tokenUsage;
    frontmatter.durationMs = typeof data.durationMs === 'number' ? data.durationMs : 0;
    frontmatter.llmModel = typeof data.llmModel === 'string' ? data.llmModel : '';
    frontmatter.fallbackReason =
      data.fallbackReason === undefined ? null : data.fallbackReason;
  }

  // spec 身份字段（Feature 128，bundle_copy / derived 时由调用方注入）
  if (data.sourceKind !== undefined) {
    frontmatter.sourceKind = data.sourceKind;
  }
  if (data.derivedFrom !== undefined) {
    frontmatter.derivedFrom = data.derivedFrom;
  }

  return frontmatter;
}
