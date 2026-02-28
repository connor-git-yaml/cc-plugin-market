/**
 * 漂移检测编排器
 * 端到端的 Spec 漂移检测流水线（US3）
 * 参见 contracts/diff-engine.md
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CodeSkeletonSchema, type CodeSkeleton } from '../models/code-skeleton.js';
import type { DriftItem } from '../models/drift-item.js';
import type { DriftReport } from '../models/module-spec.js';
import { analyzeFile, analyzeFiles } from '../core/ast-analyzer.js';
import { scanFiles } from '../utils/file-scanner.js';
import { compareSkeletons } from './structural-diff.js';
import { filterNoise } from './noise-filter.js';
import { evaluateBehaviorChange } from './semantic-diff.js';
import { renderDriftReport, initRenderer } from '../generator/spec-renderer.js';

// ============================================================
// 配置
// ============================================================

export interface DriftOptions {
  /** 跳过 LLM 语义评估，仅进行结构差异检测 */
  skipSemantic?: boolean;
  /** 自定义输出目录（默认：drift-logs/） */
  outputDir?: string;
}

// ============================================================
// 基线骨架加载
// ============================================================

/**
 * 从现有 spec 文件内容中提取序列化的基线 CodeSkeleton
 *
 * @param specContent - spec 文件的原始文本内容
 * @returns CodeSkeleton，parserUsed 指示来源
 */
export function loadBaselineSkeleton(specContent: string): CodeSkeleton {
  // 尝试从 HTML 注释中提取基线骨架
  const baselineMatch = /<!-- baseline-skeleton: (.+?) -->/.exec(specContent);

  if (baselineMatch?.[1]) {
    try {
      const parsed = JSON.parse(baselineMatch[1]);
      const validated = CodeSkeletonSchema.parse(parsed);
      return validated;
    } catch {
      // JSON 解析或 Zod 验证失败，降级
    }
  }

  // 降级：构建最小重建骨架
  return buildReconstructedSkeleton(specContent);
}

/**
 * 从 spec 的接口定义章节尽力重建部分骨架
 */
function buildReconstructedSkeleton(specContent: string): CodeSkeleton {
  const exports: CodeSkeleton['exports'] = [];

  // 尝试从接口定义章节提取签名
  const interfaceSection = extractSection(specContent, '接口定义');
  if (interfaceSection) {
    // 匹配 ### `functionName(...)` 或 ### `ClassName` 格式
    const signatureRe = /###\s+`([^`]+)`/g;
    let match;
    while ((match = signatureRe.exec(interfaceSection)) !== null) {
      const sig = match[1]!;
      const name = sig.split('(')[0]!.split(':')[0]!.trim();
      if (name) {
        exports.push({
          name,
          kind: sig.includes('(') ? 'function' : 'const',
          signature: sig,
          startLine: 1,
          endLine: 1,
          isDefault: false,
        });
      }
    }
  }

  return {
    filePath: 'reconstructed.ts',
    language: 'typescript',
    loc: 1,
    exports,
    imports: [],
    hash: '0'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'reconstructed',
  };
}

/**
 * 从 Markdown 中提取指定章节内容
 */
function extractSection(markdown: string, sectionTitle: string): string | null {
  // 匹配 ## 或 # 级别的章节标题
  const re = new RegExp(`^#{1,3}\\s+${sectionTitle}\\s*$`, 'm');
  const match = re.exec(markdown);
  if (!match) return null;

  const startIdx = match.index + match[0].length;
  // 找到下一个同级或更高级标题
  const nextSection = /^#{1,3}\s+/m.exec(markdown.slice(startIdx));
  const endIdx = nextSection ? startIdx + nextSection.index : markdown.length;

  return markdown.slice(startIdx, endIdx).trim();
}

// ============================================================
// 漂移检测编排
// ============================================================

/**
 * 端到端漂移检测编排器
 *
 * @param specPath - 现有 spec 文件路径
 * @param sourcePath - 当前源代码文件或目录路径
 * @param options - 漂移检测选项
 * @returns 完整的 DriftReport
 */
export async function detectDrift(
  specPath: string,
  sourcePath: string,
  options: DriftOptions = {},
): Promise<DriftReport> {
  const { skipSemantic = false, outputDir = 'drift-logs' } = options;

  // 步骤 1：从 spec 加载基线骨架
  const specContent = fs.readFileSync(specPath, 'utf-8');
  const baselineSkeleton = loadBaselineSkeleton(specContent);

  // 提取 spec 版本
  const versionMatch = /^version:\s*(.+)$/m.exec(specContent);
  const specVersion = versionMatch?.[1]?.trim() ?? 'v1';

  // 步骤 2：对当前源代码进行 AST 分析
  const currentSkeleton = await buildCurrentSkeleton(sourcePath);

  // 步骤 3：结构差异
  const rawItems = compareSkeletons(baselineSkeleton, currentSkeleton);

  // 步骤 4：噪声过滤
  const oldContent = serializeSkeleton(baselineSkeleton);
  const newContent = serializeSkeleton(currentSkeleton);
  const { substantive, filtered: filteredNoise } = filterNoise(rawItems, oldContent, newContent);

  // 步骤 5：语义差异（可选）
  let allItems: DriftItem[] = [...substantive];
  if (!skipSemantic) {
    // 对签名未变但函数体可能变更的情况进行语义评估
    const specDescription = extractSection(specContent, '业务逻辑') ?? '';
    for (const exp of currentSkeleton.exports) {
      const oldExp = baselineSkeleton.exports.find((e) => e.name === exp.name);
      if (oldExp && oldExp.signature === exp.signature) {
        // 签名相同但可能函数体变更 — 委托 LLM
        try {
          const semanticResult = await evaluateBehaviorChange(
            oldExp.signature,
            exp.signature,
            specDescription,
          );
          if (semanticResult) {
            allItems.push(semanticResult);
          }
        } catch {
          // LLM 不可用时跳过语义检测
        }
      }
    }
  }

  // 步骤 6：组装 DriftReport
  const summary = {
    totalChanges: allItems.length,
    high: allItems.filter((i) => i.severity === 'HIGH').length,
    medium: allItems.filter((i) => i.severity === 'MEDIUM').length,
    low: allItems.filter((i) => i.severity === 'LOW').length,
    additions: allItems.filter((i) => i.changeType === 'addition').length,
    removals: allItems.filter((i) => i.changeType === 'removal').length,
    modifications: allItems.filter((i) => i.changeType === 'modification').length,
  };

  const recommendation = generateRecommendation(summary);

  // 步骤 7：确定输出路径
  const moduleName = path.basename(specPath, '.spec.md');
  const dateStr = new Date().toISOString().slice(0, 10);
  const outputPath = path.join(outputDir, `${moduleName}-drift-${dateStr}.md`);

  const report: DriftReport = {
    specPath,
    sourcePath,
    generatedAt: new Date().toISOString(),
    specVersion,
    summary,
    items: allItems,
    filteredNoise,
    recommendation,
    outputPath,
  };

  // 步骤 8：渲染并写入漂移报告
  try {
    initRenderer();
    const rendered = renderDriftReport(report as unknown as Record<string, unknown>);

    // 确保输出目录存在
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, rendered, 'utf-8');
  } catch {
    // 渲染失败不阻塞报告返回
  }

  return report;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 构建当前源代码的骨架
 */
async function buildCurrentSkeleton(sourcePath: string): Promise<CodeSkeleton> {
  const stat = fs.statSync(sourcePath);

  if (stat.isFile()) {
    return analyzeFile(sourcePath);
  }

  // 目录：扫描所有文件并合并骨架
  const { files } = await scanFiles(sourcePath);
  if (files.length === 0) {
    return {
      filePath: sourcePath.endsWith('.ts') ? sourcePath : `${sourcePath}/index.ts`,
      language: 'typescript',
      loc: 0,
      exports: [],
      imports: [],
      hash: '0'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    };
  }

  const absoluteFiles = files.map((f) => path.join(sourcePath, f));
  const skeletons = await analyzeFiles(absoluteFiles);

  // 合并所有骨架的导出和导入
  const mergedExports = skeletons.flatMap((s) => s.exports);
  const mergedImports = skeletons.flatMap((s) => s.imports);
  const totalLoc = skeletons.reduce((sum, s) => sum + s.loc, 0);

  return {
    filePath: absoluteFiles[0]!,
    language: 'typescript',
    loc: totalLoc,
    exports: mergedExports,
    imports: mergedImports,
    hash: skeletons[0]?.hash ?? '0'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph',
  };
}

/**
 * 将骨架序列化为可比较的文本
 */
function serializeSkeleton(skeleton: CodeSkeleton): string {
  return skeleton.exports
    .map((e) => `${e.name}: ${e.signature}`)
    .join('\n');
}

/**
 * 基于漂移摘要生成建议
 */
function generateRecommendation(summary: {
  high: number;
  medium: number;
  low: number;
  totalChanges: number;
}): string {
  if (summary.totalChanges === 0) {
    return '未检测到漂移，规格与代码保持同步。';
  }

  const parts: string[] = [];

  if (summary.high > 0) {
    parts.push(`检测到 ${summary.high} 项高严重级别变更（Breaking Change），建议立即更新规格。`);
  }
  if (summary.medium > 0) {
    parts.push(`检测到 ${summary.medium} 项中等严重级别变更，建议在下次迭代中更新规格。`);
  }
  if (summary.low > 0) {
    parts.push(`检测到 ${summary.low} 项低严重级别变更，可选择性更新规格。`);
  }

  return parts.join(' ');
}
