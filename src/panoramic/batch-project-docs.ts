/**
 * batch-project-docs
 *
 * 将已注册的 panoramic 项目级 generators 真正接入 batch 主链路，
 * 统一处理 applicability、命名映射、多格式写出与架构叙事补充文档。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DocumentGenerator, ProjectContext } from './interfaces.js';
import { GeneratorRegistry, bootstrapGenerators } from './generator-registry.js';
import { CacheManager } from './cache/cache-manager.js';
import { ContentHasherImpl } from './cache/content-hasher.js';
import { ManifestManagerImpl } from './cache/manifest-manager.js';
import { buildProjectContext } from './project-context.js';
import { writeMultiFormat } from './utils/multi-format-writer.js';
import {
  buildArchitectureNarrative,
  renderArchitectureNarrative,
  type ArchitectureNarrativeOutput,
  type BatchGeneratedDocSummary,
} from './pipelines/architecture-narrative.js';
import { generateBatchAdrDocs, type AdrIndexOutput } from './pipelines/adr-decision-pipeline.js';
import { buildComponentView, renderComponentView } from './builders/component-view-builder.js';
import { buildDynamicScenarios, renderDynamicScenarios } from './builders/dynamic-scenarios-builder.js';
import { evaluateDocsQuality, renderDocsQualityReport } from './pipelines/docs-quality-evaluator.js';
import { renderQualityCostSection, type CostSummary } from '../batch/cost-summary.js';
import { readDocsBundleManifest } from './pipelines/docs-bundle-manifest-reader.js';
import {
  generateProductUxDocs,
  type GenerateProductUxDocsResult,
} from './pipelines/product-ux-docs.js';
import {
  getBatchProjectOutputBaseName,
  isBatchProjectGeneratorId,
} from './output-filenames.js';
import type { ArchitectureOverviewOutput } from './generators/architecture-overview-generator.js';
import type { ArchitectureIROutput } from './generators/architecture-ir-generator.js';
import type { EventSurfaceOutput } from './generators/event-surface-generator.js';
import type { PatternHintsOutput } from './models/pattern-hints-model.js';
import type { RuntimeTopologyOutput } from './generators/runtime-topology-generator.js';
import { loadStoredModuleSpecs } from './stored-module-specs.js';
import type { BatchMode } from './qa/types.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('batch-project-docs');

/**
 * 这些 generator 的 structuredData 被后续 pipeline 阶段在内存中直接消费
 * （architectureNarrative、component-view、dynamic-scenarios、ADR 等）。
 * 缓存命中时无法恢复 structuredData，因此跳过缓存，始终全量运行。
 */
const CACHE_SKIP_GENERATOR_IDS = new Set([
  'architecture-overview',
  'pattern-hints',
  'architecture-ir',
  'event-surface',
  'runtime-topology',
]);

export interface BatchProjectDocsResult {
  projectContext: ProjectContext;
  generatedDocs: BatchGeneratedDocSummary[];
  /**
   * Feature 133（adversarial-review post-fix）：reading / code-only 模式
   * 跳过整个产品文档 pipeline 后此字段为 undefined；full 模式必填。
   */
  architectureNarrative?: ArchitectureNarrativeOutput;
  qualityInputs: BatchDocsQualityInputs;
  /** Feature 101: 供 graph-persistence 消费的 Architecture IR（可选） */
  architectureIR?: ArchitectureIROutput['ir'];
}

interface GeneratedProjectDocResult extends BatchGeneratedDocSummary {
  structuredData: unknown;
}

export interface BatchDocsQualityInputs {
  projectRoot: string;
  outputDir: string;
  projectContext: ProjectContext;
  generatedDocs: BatchGeneratedDocSummary[];
  /**
   * Feature 133（adversarial-review post-fix）：reading / code-only 模式
   * 跳过整个 narrative 生成时此字段为 undefined；下游 generateDocsQualityReport
   * 等消费方需处理 undefined 情况
   */
  architectureNarrative?: ArchitectureNarrativeOutput;
  architectureOverview?: ArchitectureOverviewOutput;
  patternHints?: PatternHintsOutput;
  componentView?: ReturnType<typeof buildComponentView>;
  dynamicScenarios?: ReturnType<typeof buildDynamicScenarios>;
  runtimeTopology?: RuntimeTopologyOutput;
  adrIndex?: AdrIndexOutput;
  productOverview?: GenerateProductUxDocsResult['overview'];
  userJourneys?: GenerateProductUxDocsResult['journeys'];
  featureBriefIndex?: GenerateProductUxDocsResult['featureBriefIndex'];
  /** docs-bundle manifest 所在目录（默认 outputDir） */
  manifestSearchDir?: string;
  /** Feature 127：LLM 成本汇总，存在时在 quality-report.md 追加"LLM 成本与预算"节 */
  costSummary?: CostSummary;
}

/**
 * F5：reading 模式跳过的 generator ID 集合（产品文档层 + 架构推断层）
 *
 * Feature 133 P0-2 修复：原集合只列了 5 个 generator，导致 reading 模式实测
 * 1047s 远超 SC-001 的 120s 目标。reading 模式应该让用户"快速读懂代码"，
 * 不需要架构 IR / 产品文档 / 事件面 / 故事流等重型推断；只产出 modules/
 * 下的 spec + _meta 索引即可。
 *
 * Post-review 修复：导出常量供测试共享，消除 3 处拷贝维护负担（DRY）。
 */
export const READING_SKIP_IDS: ReadonlySet<string> = new Set([
  // 产品文档层
  'adr-pipeline',
  'product-ux-docs',
  'troubleshooting',
  'data-model',
  'docs-quality-evaluator',
  // 架构推断层（Feature 133 P0-2 新增）
  'architecture-overview',
  'architecture-ir',
  'pattern-hints',
  'event-surface',
  'runtime-topology',
  'architecture-narrative',
  'component-view',
  'dynamic-scenarios',
]);

/**
 * F5：code-only 模式跳过的 generator ID 集合
 * Feature 133 P0-2 后：reading 与 code-only 在 generator 跳过上等价；保留
 * 独立常量便于未来分化（如 code-only 进一步禁用模块 spec LLM enrichment）。
 */
export const CODE_ONLY_SKIP_IDS: ReadonlySet<string> = new Set([...READING_SKIP_IDS]);

export interface GenerateBatchProjectDocsOptions {
  projectRoot: string;
  outputDir: string;
  /** specs 根目录（用于扫描模块 specs，默认 outputDir） */
  specsRootDir?: string;
  /** F5：批处理运行模式（full | reading | code-only，默认 full） */
  mode?: BatchMode;
  /**
   * Feature 135 Bug 1：是否显式启用 ADR pipeline。
   * v4.0.1 临时禁用（默认 false），evidence-binding 重构完成后（v4.1）恢复默认。
   * 需用 CLI `--enable-adr` 显式开启。
   */
  enableAdr?: boolean;
  /**
   * Feature 140 FR-010 — README 全量内容（来自 extraction-pipeline，仅 --include-docs=true 时存在）。
   * 透传给 architecture-narrative pipeline 作为 shared header；
   * 未来 Step 4 (Phase 3b) MapReduce 重构后，本字段会注入 narrative cluster orchestrator 的
   * Map prompt sharedHeader 中。
   */
  readmeContent?: string;
}

export async function generateBatchProjectDocs(
  options: GenerateBatchProjectDocsOptions,
): Promise<BatchProjectDocsResult> {
  const projectContext = await buildProjectContext(options.projectRoot);
  bootstrapGenerators();

  const registry = GeneratorRegistry.getInstance();
  const effectiveMode: BatchMode = options.mode ?? 'full';

  // F5：按 mode 过滤 generator，reading/code-only 模式跳过对应集合中的 generator
  const modeSkipIds =
    effectiveMode === 'code-only' ? CODE_ONLY_SKIP_IDS :
    effectiveMode === 'reading' ? READING_SKIP_IDS :
    new Set<string>(); // full 模式不跳过任何 generator

  const applicableGenerators = (await registry.filterByContext(projectContext))
    .filter((generator) => isBatchProjectGeneratorId(generator.id))
    .filter((generator) => !modeSkipIds.has(generator.id));

  const generatedDocs: BatchGeneratedDocSummary[] = [];
  const structuredOutputs = new Map<string, unknown>();

  // 初始化内容哈希缓存（Feature 100）
  // 注入点说明：此缓存层位于 DeltaRegenerator.plan() 之后、runProjectGenerator() 之前
  // 两套缓存平行独立——DeltaRegenerator 负责模块级增量（AST skeleton hash），
  // ContentHashCache 负责 generator 级缓存命中检查（内容 hash）
  const cacheManager = new CacheManager(
    new ContentHasherImpl(),
    new ManifestManagerImpl(),
  );
  await cacheManager.initialize(options.outputDir);

  for (const generator of applicableGenerators) {
    try {
      // upstream generators 跳过缓存：其 structuredData 被后续 pipeline 阶段在内存消费
      if (CACHE_SKIP_GENERATOR_IDS.has(generator.id)) {
        const generatedDoc = await runProjectGenerator(generator, projectContext, options.outputDir);
        generatedDocs.push({
          generatorId: generatedDoc.generatorId,
          writtenFiles: generatedDoc.writtenFiles,
          warnings: generatedDoc.warnings,
        });
        structuredOutputs.set(generator.id, generatedDoc.structuredData);
        await cacheManager.record(generator, projectContext, generatedDoc.writtenFiles);
        continue;
      }

      // 缓存命中检查（leaf generators）
      const cacheHit = await cacheManager.check(generator, projectContext);
      if (cacheHit !== false) {
        // 命中：复用已记录的输出路径，跳过 extract → generate → render
        generatedDocs.push({
          generatorId: generator.id,
          writtenFiles: cacheHit.outputFiles,
          warnings: [],
        });
        continue;
      }

      const generatedDoc = await runProjectGenerator(
        generator,
        projectContext,
        options.outputDir,
      );
      generatedDocs.push({
        generatorId: generatedDoc.generatorId,
        writtenFiles: generatedDoc.writtenFiles,
        warnings: generatedDoc.warnings,
      });
      structuredOutputs.set(generator.id, generatedDoc.structuredData);

      // 记录成功执行的结果到缓存（outputFiles 取自 generatedDoc.writtenFiles）
      await cacheManager.record(generator, projectContext, generatedDoc.writtenFiles);
    } catch (error) {
      // 生成失败时保留旧 entry 不变（不删除、不更新），避免偶发失败破坏历次缓存
      generatedDocs.push({
        generatorId: generator.id,
        writtenFiles: [],
        warnings: [`生成失败: ${String(error)}`],
      });
    }
  }

  // 所有 generator 执行完毕后，原子写入 manifest
  await cacheManager.flush();

  // architecture-overview / pattern-hints / architecture-ir / runtime-topology /
  // event-surface 这些 generator 已被 mode skip 过滤；reading / code-only 模式下
  // structuredOutputs 中读不到对应键，全部得到 undefined（下游 builder 自行处理）
  const architectureOverview = structuredOutputs.get('architecture-overview') as ArchitectureOverviewOutput | undefined;
  const patternHints = structuredOutputs.get('pattern-hints') as PatternHintsOutput | undefined;
  const architectureIR = structuredOutputs.get('architecture-ir') as ArchitectureIROutput | undefined;
  const runtimeTopology = structuredOutputs.get('runtime-topology') as RuntimeTopologyOutput | undefined;
  const eventSurface = structuredOutputs.get('event-surface') as EventSurfaceOutput | undefined;

  // Feature 133（adversarial-review post-fix）：硬编码后处理 pipeline 也尊重 mode
  // 之前的实现只让 modeSkipIds 过滤 registry-based generators，但下面这块
  // architecture-narrative / component-view / dynamic-scenarios / adr-pipeline /
  // product-ux-docs 是无条件跑的，导致 reading / code-only 模式仍然写出这些
  // 应被跳过的文件、消耗下游耗时。本次把整段包在 mode === 'full' 守卫内。
  let architectureNarrative: ArchitectureNarrativeOutput | undefined;
  let productUxDocs: GenerateProductUxDocsResult | undefined;

  if (effectiveMode === 'full') {
    architectureNarrative = buildArchitectureNarrative({
      projectRoot: options.projectRoot,
      outputDir: options.outputDir,
      specsRootDir: options.specsRootDir,
      projectContext,
      architectureOverview,
      generatedDocs,
      // Feature 140 T24：透传 readmeContent 给 narrative（仅 --include-docs=true 时存在）
      ...(options.readmeContent !== undefined ? { readmeContent: options.readmeContent } : {}),
    });
    const narrativeWrittenFiles = writeMultiFormat({
      outputDir: options.outputDir,
      baseName: 'architecture-narrative',
      outputFormat: 'all',
      markdown: renderArchitectureNarrative(architectureNarrative),
      structuredData: architectureNarrative,
    });
    generatedDocs.push({
      generatorId: 'architecture-narrative',
      writtenFiles: narrativeWrittenFiles,
      warnings: [],
    });

    if (architectureIR) {
      const storedModules = loadStoredModuleSpecs(options.specsRootDir ?? options.outputDir, options.projectRoot);

      try {
        const componentView = buildComponentView({
          architectureIR: architectureIR.ir,
          storedModules,
          architectureNarrative,
          runtime: runtimeTopology,
          eventSurface,
        });
        const componentWrittenFiles = writeMultiFormat({
          outputDir: options.outputDir,
          baseName: 'component-view',
          outputFormat: 'all',
          markdown: renderComponentView(componentView),
          structuredData: componentView,
          mermaidSource: componentView.mermaidDiagram,
        });
        generatedDocs.push({
          generatorId: 'component-view',
          writtenFiles: componentWrittenFiles,
          warnings: componentView.warnings,
        });
        structuredOutputs.set('component-view', componentView);

        const dynamicScenarios = buildDynamicScenarios({
          componentView: componentView.model,
          storedModules,
          runtime: runtimeTopology,
          eventSurface,
        });
        const scenarioWrittenFiles = writeMultiFormat({
          outputDir: options.outputDir,
          baseName: 'dynamic-scenarios',
          outputFormat: 'all',
          markdown: renderDynamicScenarios(dynamicScenarios),
          structuredData: dynamicScenarios,
        });
        generatedDocs.push({
          generatorId: 'dynamic-scenarios',
          writtenFiles: scenarioWrittenFiles,
          warnings: dynamicScenarios.warnings,
        });
        structuredOutputs.set('dynamic-scenarios', dynamicScenarios);
      } catch (error) {
        generatedDocs.push({
          generatorId: 'component-view',
          writtenFiles: [],
          warnings: [`组件视图生成失败: ${String(error)}`],
        });
        generatedDocs.push({
          generatorId: 'dynamic-scenarios',
          writtenFiles: [],
          warnings: ['动态链路生成跳过：依赖的 component-view 生成失败'],
        });
      }
    } else {
      generatedDocs.push({
        generatorId: 'component-view',
        writtenFiles: [],
        warnings: ['组件视图生成跳过：缺少 architecture-ir 输出'],
      });
      generatedDocs.push({
        generatorId: 'dynamic-scenarios',
        writtenFiles: [],
        warnings: ['动态链路生成跳过：缺少 architecture-ir 输出'],
      });
    }

    // Feature 135 Bug 1：ADR pipeline 默认禁用，需要显式 --enable-adr 开启
    if (options.enableAdr) {
      try {
        const adrDocs = generateBatchAdrDocs({
          projectRoot: options.projectRoot,
          outputDir: options.outputDir,
          projectContext,
          generatedDocs,
          architectureNarrative,
          architectureOverview,
          patternHints,
        });
        generatedDocs.push({
          generatorId: 'adr-pipeline',
          writtenFiles: adrDocs.writtenFiles,
          warnings: adrDocs.warnings,
        });
        structuredOutputs.set('adr-index', adrDocs.index);
      } catch (error) {
        generatedDocs.push({
          generatorId: 'adr-pipeline',
          writtenFiles: [],
          warnings: [`ADR 草稿生成失败: ${String(error)}`],
        });
      }
    } else {
      // ADR pipeline 在 v4.0.1 临时禁用，evidence-binding 重构完成后（v4.1）恢复
      logger.warn(
        'ADR pipeline 已临时禁用（v4.0.1）。如需生成 ADR，请用 --enable-adr 显式开启（注意：当前版本 ADR 内容质量尚未保证）。',
      );

      // 中和遗留 ADR 文件：从 v4.0.0 升级时，先前批次写入的 adr-*.md 仍在磁盘上，
      // 用户可能把这些当作当前批次产物信任。写入 _PIPELINE_DISABLED.md 并改写 index.md
      // 以明确标注这些文件来自先前批次、内容可能存在 hallucination，但不删除用户文件。
      const adrDir = path.join(options.outputDir, 'docs', 'adr');
      if (fs.existsSync(adrDir)) {
        const disabledNotice =
          `# ADR Pipeline 已禁用（Spectra v4.0.1）\n\n` +
          `> 警告：ADR 自动生成流水线在 Spectra v4.0.1 中临时禁用（evidence-binding 重构中）。\n` +
          `>\n` +
          `> **本目录下的 ADR 文件可能由 v4.0.0 或更早版本生成，已知存在 hallucination 问题** —\n` +
          `> 内容可能与你的项目无关（如把 Spectra 自身的 "JSON 流式协议" 写进你的项目）。\n` +
          `> **请勿将这些文件视为当前批次的产物。**\n` +
          `>\n` +
          `> 如需重新启用 ADR 生成，请加 \`--enable-adr\` flag；\n` +
          `> 但当前版本 ADR 内容质量尚未保证，建议等 v4.1 evidence-binding 重构完成后再用。\n`;

        const noticePath = path.join(adrDir, '_PIPELINE_DISABLED.md');
        fs.writeFileSync(noticePath, disabledNotice, 'utf-8');

        // 改写 index.md 为 supersede notice，避免下游读 index 时看到 stale links
        const indexPath = path.join(adrDir, 'index.md');
        if (fs.existsSync(indexPath)) {
          fs.writeFileSync(
            indexPath,
            `# ADR Pipeline 已禁用\n\n` +
            `当前批次未生成新 ADR。详见 [_PIPELINE_DISABLED.md](./_PIPELINE_DISABLED.md)。\n\n` +
            `本目录下的其他 \`adr-*.md\` 文件来自先前批次，可能包含 hallucinated 内容，请勿信任。\n`,
            'utf-8',
          );
        }

        logger.warn('ADR pipeline 已禁用 — 已在 ' + adrDir + ' 下写入 _PIPELINE_DISABLED.md 标记');
      } else {
        logger.warn('ADR pipeline 已禁用（未发现遗留 ADR 目录，无需中和）');
      }

      generatedDocs.push({
        generatorId: 'adr-pipeline',
        writtenFiles: [],
        warnings: ['ADR pipeline 临时禁用（v4.0.1），evidence-binding 重构完成后（v4.1）恢复默认'],
      });
    }

    try {
      productUxDocs = generateProductUxDocs({
        projectRoot: options.projectRoot,
        outputDir: options.outputDir,
        projectContext,
      });
      generatedDocs.push({
        generatorId: 'product-ux-docs',
        writtenFiles: productUxDocs.writtenFiles,
        warnings: productUxDocs.warnings,
      });
      structuredOutputs.set('product-overview', productUxDocs.overview);
      structuredOutputs.set('user-journeys', productUxDocs.journeys);
      structuredOutputs.set('feature-briefs/index', productUxDocs.featureBriefIndex);
    } catch (error) {
      generatedDocs.push({
        generatorId: 'product-ux-docs',
        writtenFiles: [],
        warnings: [`产品 / UX 文档生成失败: ${String(error)}`],
      });
    }
  }

  return {
    projectContext,
    generatedDocs,
    architectureNarrative,
    architectureIR: architectureIR?.ir,
    qualityInputs: {
      projectRoot: options.projectRoot,
      outputDir: options.outputDir,
      projectContext,
      generatedDocs,
      architectureNarrative,
      architectureOverview,
      patternHints,
      componentView: structuredOutputs.get('component-view') as ReturnType<typeof buildComponentView> | undefined,
      dynamicScenarios: structuredOutputs.get('dynamic-scenarios') as ReturnType<typeof buildDynamicScenarios> | undefined,
      runtimeTopology,
      adrIndex: structuredOutputs.get('adr-index') as AdrIndexOutput | undefined,
      productOverview: productUxDocs?.overview,
      userJourneys: productUxDocs?.journeys,
      featureBriefIndex: productUxDocs?.featureBriefIndex,
    },
  };
}

export function generateDocsQualityReport(
  options: BatchDocsQualityInputs,
): BatchGeneratedDocSummary {
  // Feature 133（adversarial-review post-fix）：reading / code-only 模式下
  // architectureNarrative 是 undefined，这种情况不应该走到这里（caller 在
  // batch-orchestrator 已加 mode === 'full' 守卫）。这里做防御性运行时校验，
  // 把 optional 类型收窄为 evaluateDocsQuality 期望的 required 类型
  if (!options.architectureNarrative) {
    throw new Error(
      'generateDocsQualityReport 调用方未提供 architectureNarrative — 该函数仅在 mode === "full" 时可用',
    );
  }
  const manifestRead = readDocsBundleManifest(options.manifestSearchDir ?? options.outputDir, options.projectRoot);
  const qualityReport = evaluateDocsQuality({
    projectRoot: options.projectRoot,
    outputDir: options.outputDir,
    projectContext: options.projectContext,
    generatedDocs: options.generatedDocs,
    architectureNarrative: options.architectureNarrative,
    architectureOverview: options.architectureOverview,
    patternHints: options.patternHints,
    componentView: options.componentView,
    dynamicScenarios: options.dynamicScenarios,
    runtimeTopology: options.runtimeTopology,
    adrIndex: options.adrIndex,
    productOverview: options.productOverview,
    userJourneys: options.userJourneys,
    featureBriefIndex: options.featureBriefIndex,
    docsBundleManifest: manifestRead.manifest,
    dependencyWarnings: manifestRead.warnings,
  });
  let markdown = renderDocsQualityReport(qualityReport);
  // Feature 127：在质量报告末尾追加 "LLM 成本与预算" 节
  if (options.costSummary) {
    markdown = markdown.trimEnd() + '\n\n' + renderQualityCostSection(options.costSummary);
  }
  const qualityWrittenFiles = writeMultiFormat({
    outputDir: options.outputDir,
    baseName: 'quality-report',
    outputFormat: 'all',
    markdown,
    structuredData: qualityReport,
  });

  return {
    generatorId: 'quality-report',
    writtenFiles: qualityWrittenFiles,
    warnings: [...qualityReport.dependencyWarnings, ...qualityReport.warnings],
  };
}

async function runProjectGenerator(
  generator: DocumentGenerator<any, any>,
  projectContext: ProjectContext,
  outputDir: string,
): Promise<GeneratedProjectDocResult> {
  const input = await generator.extract(projectContext);
  const structuredData = await generator.generate(input, {
    useLLM: false,
    outputFormat: 'all',
  });
  const markdown = await Promise.resolve(generator.render(structuredData));
  const writtenFiles = writeMultiFormat({
    outputDir,
    baseName: getBatchProjectOutputBaseName(generator.id),
    outputFormat: 'all',
    markdown,
    structuredData,
    mermaidSource: extractMermaidSource(generator.id, structuredData),
    extraFiles: extractAdditionalFiles(generator.id, structuredData, getBatchProjectOutputBaseName(generator.id)),
  });

  return {
    generatorId: generator.id,
    writtenFiles,
    warnings: extractWarnings(structuredData),
    structuredData,
  };
}

function extractWarnings(structuredData: unknown): string[] {
  if (!structuredData || typeof structuredData !== 'object') {
    return [];
  }

  const warnings = (structuredData as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.filter((item): item is string => typeof item === 'string');
}

function extractMermaidSource(generatorId: string, structuredData: unknown): string | undefined {
  if (!structuredData || typeof structuredData !== 'object') {
    return undefined;
  }

  switch (generatorId) {
    case 'data-model':
      return getStringField(structuredData, 'erDiagram');
    case 'workspace-index':
      return getStringField(structuredData, 'dependencyDiagram');
    case 'cross-package-deps':
      return getStringField(structuredData, 'mermaidDiagram');
    case 'architecture-overview':
      return joinMermaidSections(structuredData as {
        systemContext?: { mermaidDiagram?: string };
        deploymentView?: { mermaidDiagram?: string };
        layeredView?: { mermaidDiagram?: string };
      });
    case 'architecture-ir':
      return getNestedStringField(structuredData, ['exports', 'mermaid', 'combinedDiagram']);
    case 'pattern-hints':
      return joinMermaidSections((structuredData as {
        architectureOverview?: {
          systemContext?: { mermaidDiagram?: string };
          deploymentView?: { mermaidDiagram?: string };
          layeredView?: { mermaidDiagram?: string };
        };
      }).architectureOverview ?? {});
    case 'event-surface':
      return [
        getStringField(structuredData, 'eventFlowMermaid'),
        getStringField(structuredData, 'stateAppendixMermaid'),
      ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('\n\n%% ----\n\n') || undefined;
    default:
      return undefined;
  }
}

function getStringField(target: unknown, field: string): string | undefined {
  if (!target || typeof target !== 'object') {
    return undefined;
  }
  const value = (target as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function joinMermaidSections(input: {
  systemContext?: { mermaidDiagram?: string };
  deploymentView?: { mermaidDiagram?: string };
  layeredView?: { mermaidDiagram?: string };
}): string | undefined {
  const sections = [
    input.systemContext?.mermaidDiagram ? `%% system-context\n${input.systemContext.mermaidDiagram}` : null,
    input.deploymentView?.mermaidDiagram ? `%% deployment\n${input.deploymentView.mermaidDiagram}` : null,
    input.layeredView?.mermaidDiagram ? `%% layered\n${input.layeredView.mermaidDiagram}` : null,
  ].filter((item): item is string => item !== null && item.trim().length > 0);

  return sections.length > 0 ? sections.join('\n\n%% ----\n\n') : undefined;
}

function extractAdditionalFiles(
  generatorId: string,
  structuredData: unknown,
  baseName: string,
): Array<{ fileName?: string; extension?: string; content: string }> | undefined {
  if (generatorId !== 'architecture-ir') {
    return undefined;
  }

  const structurizrDsl = getNestedStringField(structuredData, ['exports', 'structurizrDsl']);
  if (!structurizrDsl) {
    return undefined;
  }

  return [{
    fileName: `${baseName}.dsl`,
    content: structurizrDsl,
  }];
}

function getNestedStringField(target: unknown, pathSegments: string[]): string | undefined {
  let current: unknown = target;

  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' && current.trim().length > 0 ? current : undefined;
}
