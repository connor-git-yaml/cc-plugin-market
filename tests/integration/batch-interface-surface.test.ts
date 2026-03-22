import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { analyzeFiles } from '../../src/core/ast-analyzer.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import { renderSpec } from '../../src/generator/spec-renderer.js';

const mocks = vi.hoisted(() => ({
  generateSpec: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  generateSpec: mocks.generateSpec,
}));

import { runBatch } from '../../src/batch/batch-orchestrator.js';

describe('runBatch interface-surface integration', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-interface-surface-'));

    fs.mkdirSync(path.join(projectRoot, 'src', 'sample_sdk'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'pyproject.toml'),
      [
        '[project]',
        'name = "sample-sdk"',
        'version = "0.1.0"',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'sample_sdk', '__init__.py'),
      [
        'from .client import ClaudeSDKClient, query',
        '',
        '__all__ = ["ClaudeSDKClient", "query"]',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'sample_sdk', 'client.py'),
      [
        'class ClaudeSDKClient:',
        '    def query(self, prompt: str) -> str:',
        '        return prompt',
        '',
        '    def interrupt(self) -> None:',
        '        return None',
        '',
        'def query(prompt: str) -> str:',
        '    return prompt',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'sample_sdk', 'types.py'),
      [
        'class ClaudeAgentOptions:',
        '    def __init__(self, model: str):',
        '        self.model = model',
      ].join('\n'),
      'utf-8',
    );

    mocks.generateSpec.mockImplementation(async (
      targetPath: string,
      options: { outputDir?: string; projectRoot?: string; existingVersion?: string },
    ) => {
      const moduleSpec = await buildMockModuleSpec(
        options.projectRoot ?? projectRoot,
        targetPath,
        options.outputDir ?? path.join(projectRoot, 'specs'),
        options.existingVersion,
      );
      fs.mkdirSync(path.dirname(moduleSpec.outputPath), { recursive: true });
      fs.writeFileSync(moduleSpec.outputPath, renderSpec(moduleSpec), 'utf-8');

      return {
        specPath: moduleSpec.outputPath,
        skeleton: moduleSpec.baselineSkeleton,
        tokenUsage: 0,
        confidence: 'high' as const,
        warnings: [],
        moduleSpec,
      };
    });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
    vi.clearAllMocks();
  });

  it('对 Python SDK 项目产出 interface-surface 并用它满足 quality gate', async () => {
    const result = await runBatch(projectRoot, {
      force: true,
      maxRetries: 1,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.projectDocs).toEqual(expect.arrayContaining([
      'specs/interface-surface.md',
      'specs/quality-report.md',
    ]));
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'interface-surface.json'))).toBe(true);

    const interfaceSurfaceMarkdown = fs.readFileSync(
      path.join(projectRoot, 'specs', 'interface-surface.md'),
      'utf-8',
    );
    expect(interfaceSurfaceMarkdown).toContain('ClaudeSDKClient');
    expect(interfaceSurfaceMarkdown).toContain('ClaudeAgentOptions');
    expect(interfaceSurfaceMarkdown).toContain('query');

    const qualityReport = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'specs', 'quality-report.json'), 'utf-8'),
    ) as {
      requiredDocs: Array<{ docId: string; coverage: string }>;
    };
    expect(qualityReport.requiredDocs.find((doc) => doc.docId === 'interface-surface')?.coverage).toBe('covered');
    expect(qualityReport.requiredDocs.some((doc) => doc.docId === 'api-surface')).toBe(false);
  });
});

async function buildMockModuleSpec(
  projectRoot: string,
  targetPath: string,
  outputDir: string,
  existingVersion?: string,
): Promise<ModuleSpec> {
  const resolvedTarget = path.resolve(targetPath);
  const stat = fs.statSync(resolvedTarget);
  const relatedFiles = stat.isDirectory()
    ? collectFiles(projectRoot, resolvedTarget)
    : [path.relative(projectRoot, resolvedTarget).split(path.sep).join('/')];
  const analyzed = await analyzeFiles(relatedFiles.map((filePath) => path.join(projectRoot, filePath)));
  const skeleton = mergeSkeletons(analyzed);
  const sourceTarget = path.relative(projectRoot, resolvedTarget).split(path.sep).join('/');
  const specName = path.basename(resolvedTarget).replace(/\.[^.]+$/, '');
  const outputPath = path.join(outputDir, `${specName}.spec.md`);
  const version = incrementVersion(existingVersion);

  return {
    frontmatter: {
      type: 'module-spec',
      version,
      generatedBy: 'reverse-spec v2.2.0',
      sourceTarget,
      confidence: 'high',
      relatedFiles,
      lastUpdated: new Date().toISOString(),
      skeletonHash: skeleton.hash,
    },
    sections: {
      intent: `${sourceTarget} 负责 SDK 的公开接口`,
      interfaceDefinition: `${sourceTarget} interface`,
      businessLogic: `${sourceTarget} 封装主要公开调用链`,
      dataStructures: `${sourceTarget} data`,
      constraints: `${sourceTarget} constraints`,
      edgeCases: `${sourceTarget} edge`,
      technicalDebt: `${sourceTarget} debt`,
      testCoverage: `${sourceTarget} coverage`,
      dependencies: `${sourceTarget} deps`,
    },
    fileInventory: relatedFiles.map((filePath) => ({
      path: filePath,
      loc: 10,
      purpose: `${sourceTarget} file`,
    })),
    baselineSkeleton: skeleton,
    outputPath,
  };
}

function collectFiles(projectRoot: string, dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(projectRoot, fullPath));
      continue;
    }
    results.push(path.relative(projectRoot, fullPath).split(path.sep).join('/'));
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function mergeSkeletons(skeletons: CodeSkeleton[]): CodeSkeleton {
  if (skeletons.length === 1) {
    return skeletons[0]!;
  }

  const hash = createHash('sha256')
    .update(
      skeletons
        .slice()
        .sort((left, right) => left.filePath.localeCompare(right.filePath))
        .map((skeleton) => skeleton.hash)
        .join(''),
    )
    .digest('hex');

  return {
    filePath: skeletons[0]!.filePath,
    language: skeletons[0]!.language,
    loc: skeletons.reduce((total, skeleton) => total + skeleton.loc, 0),
    exports: skeletons.flatMap((skeleton) => skeleton.exports),
    imports: skeletons.flatMap((skeleton) => skeleton.imports),
    parseErrors: skeletons.flatMap((skeleton) => skeleton.parseErrors ?? []),
    hash,
    analyzedAt: new Date().toISOString(),
    parserUsed: skeletons[0]!.parserUsed,
  };
}

function incrementVersion(existingVersion?: string): string {
  if (!existingVersion) {
    return 'v1';
  }

  const matched = /^v(\d+)$/.exec(existingVersion);
  if (!matched?.[1]) {
    return 'v1';
  }
  return `v${parseInt(matched[1], 10) + 1}`;
}
