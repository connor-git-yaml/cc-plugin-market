/**
 * ArchitectureIRGenerator
 *
 * 统一导出 panoramic 架构事实为 Architecture IR，并派生 JSON / Structurizr DSL / Mermaid 互通产物。
 */
import type { DocumentGenerator, GenerateOptions, ProjectContext } from './interfaces.js';
import { ArchitectureOverviewGenerator, type ArchitectureOverviewOutput } from './architecture-overview-generator.js';
import type { RuntimeTopologyOutput } from './runtime-topology-generator.js';
import type { WorkspaceOutput } from './workspace-index-generator.js';
import type { CrossPackageOutput } from './cross-package-analyzer.js';
import { buildArchitectureIR } from './architecture-ir-builder.js';
import { buildArchitectureIRMermaidExport } from './architecture-ir-mermaid-adapter.js';
import { exportArchitectureIRJson, exportArchitectureIRStructurizrDsl } from './architecture-ir-exporters.js';
import type { ArchitectureIR, ArchitectureIRExportBundle } from './architecture-ir-model.js';
import { loadTemplate } from './utils/template-loader.js';

export interface ArchitectureIRInput {
  projectName: string;
  architectureOverview: ArchitectureOverviewOutput;
  runtime?: RuntimeTopologyOutput;
  workspace?: WorkspaceOutput;
  crossPackage?: CrossPackageOutput;
  warnings: string[];
}

export interface ArchitectureIROutput {
  title: string;
  generatedAt: string;
  ir: ArchitectureIR;
  exports: ArchitectureIRExportBundle;
  warnings: string[];
}

export class ArchitectureIRGenerator
  implements DocumentGenerator<ArchitectureIRInput, ArchitectureIROutput>
{
  readonly id = 'architecture-ir' as const;
  readonly name = '架构中间表示导出器' as const;
  readonly description = '复用现有 panoramic 架构事实，导出统一 Architecture IR、Structurizr DSL 与 Mermaid 互通结果';

  isApplicable(context: ProjectContext): boolean {
    return new ArchitectureOverviewGenerator().isApplicable(context);
  }

  async extract(context: ProjectContext): Promise<ArchitectureIRInput> {
    const overviewGenerator = new ArchitectureOverviewGenerator();
    const overviewInput = await overviewGenerator.extract(context);
    const architectureOverview = await overviewGenerator.generate(overviewInput);

    return {
      projectName: architectureOverview.model.projectName,
      architectureOverview,
      runtime: overviewInput.runtime,
      workspace: overviewInput.workspace,
      crossPackage: overviewInput.crossPackage,
      warnings: [...new Set([...overviewInput.warnings, ...architectureOverview.warnings])].sort((a, b) => a.localeCompare(b)),
    };
  }

  async generate(
    input: ArchitectureIRInput,
    _options?: GenerateOptions,
  ): Promise<ArchitectureIROutput> {
    const ir = buildArchitectureIR({
      architectureOverview: input.architectureOverview,
      runtime: input.runtime,
      workspace: input.workspace,
      crossPackage: input.crossPackage,
    });
    const exports: ArchitectureIRExportBundle = {
      json: exportArchitectureIRJson(ir),
      structurizrDsl: exportArchitectureIRStructurizrDsl(ir),
      mermaid: buildArchitectureIRMermaidExport(ir),
    };

    return {
      title: `Architecture IR: ${input.projectName}`,
      generatedAt: new Date().toISOString().split('T')[0]!,
      ir,
      exports,
      warnings: [...new Set([...input.warnings, ...ir.warnings])].sort((a, b) => a.localeCompare(b)),
    };
  }

  render(output: ArchitectureIROutput): string {
    const template = loadTemplate('architecture-ir.hbs', import.meta.url);
    return template(output);
  }
}
