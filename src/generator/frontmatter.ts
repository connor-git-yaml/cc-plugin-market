/**
 * YAML Frontmatter 生成器（含版本自增）
 * 参见 contracts/generator.md
 */
import type { SpecFrontmatter } from '../models/module-spec.js';

export interface FrontmatterInput {
  /** 源目标路径 */
  sourceTarget: string;
  /** 相关文件路径列表 */
  relatedFiles: string[];
  /** 置信度等级 */
  confidence: 'high' | 'medium' | 'low';
  /** baseline CodeSkeleton 的 SHA-256 哈希 */
  skeletonHash: string;
  /** 已有版本号（如 'v3'），用于自动递增 */
  existingVersion?: string;
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
  return {
    type: 'module-spec',
    version: incrementVersion(data.existingVersion),
    generatedBy: 'reverse-spec v2.0',
    sourceTarget: data.sourceTarget,
    relatedFiles: data.relatedFiles,
    lastUpdated: new Date().toISOString(),
    confidence: data.confidence,
    skeletonHash: data.skeletonHash,
  };
}
