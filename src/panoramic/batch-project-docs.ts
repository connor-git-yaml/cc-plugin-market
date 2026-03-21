/**
 * batch-project-docs
 *
 * 将已注册的 panoramic 项目级 generators 真正接入 batch 主链路，
 * 统一处理 applicability、命名映射、多格式写出与架构叙事补充文档。
 */
import type { DocumentGenerator, ProjectContext } from './interfaces.js';
import { GeneratorRegistry, bootstrapGenerators } from './generator-registry.js';
import { buildProjectContext } from './project-context.js';
import { writeMultiFormat } from './utils/multi-format-writer.js';
import {
  buildArchitectureNarrative,
  renderArchitectureNarrative,
  type ArchitectureNarrativeOutput,
  type BatchGeneratedDocSummary,
} from './architecture-narrative.js';
import { generateBatchAdrDocs, type AdrIndexOutput } from './adr-decision-pipeline.js';
import { buildComponentView, renderComponentView } from './component-view-builder.js';
import { buildDynamicScenarios, renderDynamicScenarios } from './dynamic-scenarios-builder.js';
import { evaluateDocsQuality, renderDocsQualityReport } from './docs-quality-evaluator.js';
import { readDocsBundleManifest } from './docs-bundle-manifest-reader.js';
import {
  generateProductUxDocs,
  type GenerateProductUxDocsResult,
} from './product-ux-docs.js';
import {
  getBatchProjectOutputBaseName,
  isBatchProjectGeneratorId,
} from './output-filenames.js';
import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import type { ArchitectureIROutput } from './architecture-ir-generator.js';
import type { EventSurfaceOutput } from './event-surface-generator.js';
import type { PatternHintsOutput } from './pattern-hints-model.js';
import type { RuntimeTopologyOutput } from './runtime-topology-generator.js';
import { loadStoredModuleSpecs } from './stored-module-specs.js';

export interface BatchProjectDocsResult {
  projectContext: ProjectContext;
  generatedDocs: BatchGeneratedDocSummary[];
  architectureNarrative: ArchitectureNarrativeOutput;
}

interface GeneratedProjectDocResult extends BatchGeneratedDocSummary {
  structuredData: unknown;
}

export interface GenerateBatchProjectDocsOptions {
  projectRoot: string;
  outputDir: string;
}

export async function generateBatchProjectDocs(
  options: GenerateBatchProjectDocsOptions,
): Promise<BatchProjectDocsResult> {
  const projectContext = await buildProjectContext(options.projectRoot);
  bootstrapGenerators();

  const registry = GeneratorRegistry.getInstance();
  const applicableGenerators = (await registry.filterByContext(projectContext))
    .filter((generator) => isBatchProjectGeneratorId(generator.id));

  const generatedDocs: BatchGeneratedDocSummary[] = [];
  const structuredOutputs = new Map<string, unknown>();

  for (const generator of applicableGenerators) {
    try {
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
    } catch (error) {
      generatedDocs.push({
        generatorId: generator.id,
        writtenFiles: [],
        warnings: [`生成失败: ${String(error)}`],
      });
    }
  }

  const architectureOverview = structuredOutputs.get('architecture-overview') as ArchitectureOverviewOutput | undefined;
  const patternHints = structuredOutputs.get('pattern-hints') as PatternHintsOutput | undefined;
  const architectureNarrative = buildArchitectureNarrative({
    projectRoot: options.projectRoot,
    outputDir: options.outputDir,
    projectContext,
    architectureOverview,
    generatedDocs,
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

  const architectureIR = structuredOutputs.get('architecture-ir') as ArchitectureIROutput | undefined;
  const runtimeTopology = structuredOutputs.get('runtime-topology') as RuntimeTopologyOutput | undefined;
  const eventSurface = structuredOutputs.get('event-surface') as EventSurfaceOutput | undefined;
  let productUxDocs: GenerateProductUxDocsResult | undefined;

  if (architectureIR) {
    const storedModules = loadStoredModuleSpecs(options.outputDir, options.projectRoot);

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

  try {
    productUxDocs = generateProductUxDocs({
      projectRoot: options.projectRoot,
      outputDir: options.outputDir,
      projectContext,
      generatedDocs,
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

  try {
    const manifestRead = readDocsBundleManifest(options.outputDir, options.projectRoot);
    const qualityReport = evaluateDocsQuality({
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
      docsBundleManifest: manifestRead.manifest,
      dependencyWarnings: manifestRead.warnings,
    });
    const qualityWrittenFiles = writeMultiFormat({
      outputDir: options.outputDir,
      baseName: 'quality-report',
      outputFormat: 'all',
      markdown: renderDocsQualityReport(qualityReport),
      structuredData: qualityReport,
    });
    generatedDocs.push({
      generatorId: 'quality-report',
      writtenFiles: qualityWrittenFiles,
      warnings: [...qualityReport.dependencyWarnings, ...qualityReport.warnings],
    });
  } catch (error) {
    generatedDocs.push({
      generatorId: 'quality-report',
      writtenFiles: [],
      warnings: [`文档质量报告生成失败: ${String(error)}`],
    });
  }

  return {
    projectContext,
    generatedDocs,
    architectureNarrative,
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
