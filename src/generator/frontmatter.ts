/**
 * YAML Frontmatter 生成器（含版本自增）
 * 参见 contracts/generator.md
 */
import { createRequire } from 'node:module';
import type { CostBreakdown, SpecFrontmatter, TokenUsage } from '../models/module-spec.js';

/** 模块级缓存，避免每次生成 frontmatter 都重复读取 package.json */
let _versionCache: string | undefined;

/**
 * 从 package.json 动态读取 Spectra 版本号，返回 "spectra vX.Y.Z" 格式字符串。
 * 读取失败时返回 "spectra (unknown version)" 并打印警告，避免硬编码版本字符串。
 * 结果在模块生命周期内缓存，多次调用不重复 I/O。
 */
export function getSpectraVersionString(): string {
  if (_versionCache !== undefined) {
    return _versionCache;
  }
  try {
    const _require = createRequire(import.meta.url);
    const pkg = _require('../../package.json') as { version: string };
    _versionCache = `spectra v${pkg.version}`;
  } catch {
    process.stderr.write('[warn] frontmatter: 读取 package.json 版本失败，降级为 unknown version\n');
    _versionCache = 'spectra (unknown version)';
  }
  return _versionCache;
}

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
  /** 生成本 spec 时的批处理模式（Bug 142）；单文件 generate 不传，batch 流程传入 effectiveMode */
  generatedByMode?: 'full' | 'reading' | 'code-only';
  /**
   * Feature 140 FR-012 — context 来源 input token 细分。
   * 由 single-spec-orchestrator 从 `AssembledContext.tokenBreakdown` + LLM response usage
   * 组装传入；AST-only / 失败模式不传。
   */
  costBreakdown?: CostBreakdown;
  /**
   * Feature 140 FR-012 — context 是否因 budget 被裁剪。
   * 由 single-spec-orchestrator 从 `AssembledContext.truncated` 透传。
   */
  contextTruncated?: boolean;
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
    generatedBy: getSpectraVersionString(),
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

  // 批处理模式标记（Bug 142）；仅 batch 流程传入，单文件 generate 不写入
  if (data.generatedByMode !== undefined) {
    frontmatter.generatedByMode = data.generatedByMode;
  }

  // Feature 140 FR-012：context 来源 input token 细分 + 是否被 budget 裁剪
  // 仅 single-spec-orchestrator 主流程传入；AST-only 模式 / 早期失败路径不写入此字段
  // （下游聚合 Top N 时遇缺失字段视为未观测，跳过）。
  if (data.costBreakdown !== undefined) {
    frontmatter.costBreakdown = data.costBreakdown;
  }
  if (data.contextTruncated !== undefined) {
    frontmatter.contextTruncated = data.contextTruncated;
  }

  return frontmatter;
}
