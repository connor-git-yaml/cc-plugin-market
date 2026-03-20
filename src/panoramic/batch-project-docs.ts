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
import {
  getBatchProjectOutputBaseName,
  isBatchProjectGeneratorId,
} from './output-filenames.js';
import type { ArchitectureOverviewOutput } from './architecture-overview-generator.js';

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
