import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';
import { InterfaceSurfaceGenerator } from '../../src/panoramic/interface-surface-generator.js';
import { renderSpec } from '../../src/generator/spec-renderer.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'interface-surface-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function createContext(
  projectRoot: string,
  existingSpecs: string[],
  overrides: Partial<ProjectContext> = {},
): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: ['python'],
    existingSpecs,
    ...overrides,
  };
}

function writeModuleSpec(
  projectRoot: string,
  specPath: string,
  sourceTarget: string,
  skeleton: CodeSkeleton,
): void {
  const moduleSpec: ModuleSpec = {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'reverse-spec v2.2.0',
      sourceTarget,
      relatedFiles: [sourceTarget],
      lastUpdated: '2026-03-22T00:00:00.000Z',
      confidence: 'high',
      skeletonHash: skeleton.hash,
    },
    sections: {
      intent: `${sourceTarget} 暴露 SDK 对外接口`,
      interfaceDefinition: `${sourceTarget} interface`,
      businessLogic: `${sourceTarget} 封装公开调用链`,
      dataStructures: `${sourceTarget} data`,
      constraints: `${sourceTarget} constraints`,
      edgeCases: `${sourceTarget} edge`,
      technicalDebt: `${sourceTarget} debt`,
      testCoverage: `${sourceTarget} coverage`,
      dependencies: `${sourceTarget} deps`,
    },
    fileInventory: [
      {
        path: sourceTarget,
        loc: 20,
        purpose: `${sourceTarget} file`,
      },
    ],
    baselineSkeleton: skeleton,
    outputPath: specPath,
  };

  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, renderSpec(moduleSpec), 'utf-8');
}

describe('InterfaceSurfaceGenerator', () => {
  let tmpDir: string;
  let generator: InterfaceSurfaceGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new InterfaceSurfaceGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
    GeneratorRegistry.resetInstance();
  });

  it('对 Python SDK 项目从 stored module specs 提取公开模块、符号与关键方法', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      [
        '[project]',
        'name = "sample-sdk"',
        'version = "0.1.0"',
      ].join('\n'),
      'utf-8',
    );

    const specsDir = path.join(tmpDir, 'specs');
    const entrySpec = path.join(specsDir, 'sample_sdk.spec.md');
    const typesSpec = path.join(specsDir, 'types.spec.md');

    writeModuleSpec(tmpDir, entrySpec, 'src/sample_sdk/__init__.py', {
      filePath: 'src/sample_sdk/__init__.py',
      language: 'python',
      loc: 24,
      exports: [
        {
          name: 'ClaudeSDKClient',
          kind: 'class',
          signature: 'class ClaudeSDKClient',
          isDefault: false,
          startLine: 1,
          endLine: 20,
          members: [
            {
              name: 'query',
              kind: 'method',
              signature: 'query(prompt: str) -> Result',
              isStatic: false,
            },
            {
              name: 'interrupt',
              kind: 'method',
              signature: 'interrupt() -> None',
              isStatic: false,
            },
          ],
        },
        {
          name: 'query',
          kind: 'function',
          signature: 'query(prompt: str) -> Result',
          isDefault: false,
          startLine: 21,
          endLine: 24,
        },
      ],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: '2026-03-22T00:00:00.000Z',
      parserUsed: 'baseline',
    });
    writeModuleSpec(tmpDir, typesSpec, 'src/sample_sdk/types.py', {
      filePath: 'src/sample_sdk/types.py',
      language: 'python',
      loc: 16,
      exports: [
        {
          name: 'ClaudeAgentOptions',
          kind: 'data_class',
          signature: 'class ClaudeAgentOptions',
          isDefault: false,
          startLine: 1,
          endLine: 16,
          members: [
            {
              name: 'model',
              kind: 'property',
              signature: 'model: str',
              isStatic: false,
            },
          ],
        },
      ],
      imports: [],
      hash: 'b'.repeat(64),
      analyzedAt: '2026-03-22T00:00:00.000Z',
      parserUsed: 'baseline',
    });

    const context = createContext(tmpDir, [entrySpec, typesSpec]);
    await expect(generator.isApplicable(context)).resolves.toBe(true);

    const input = await generator.extract(context);
    const output = await generator.generate(input);
    const markdown = generator.render(output);

    expect(output.projectName).toBe('sample-sdk');
    expect(output.entryModules.map((module) => module.sourceTarget)).toEqual([
      'src/sample_sdk/__init__.py',
    ]);
    expect(output.keySymbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(['ClaudeSDKClient', 'ClaudeAgentOptions', 'query']),
    );
    expect(output.keyMethods.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(['query', 'interrupt']),
    );
    expect(markdown).toContain('# Interface Surface: sample-sdk');
    expect(markdown).toContain('`src/sample_sdk/__init__.py`');
    expect(markdown).toContain('ClaudeSDKClient');
  });

  it('对带有 runtime 信号的服务项目不启用 interface-surface', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'service-app',
        version: '1.0.0',
        dependencies: { express: '^4.0.0' },
      }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:20\n', 'utf-8');

    const specPath = path.join(tmpDir, 'specs', 'routes.spec.md');
    writeModuleSpec(tmpDir, specPath, 'src/routes.ts', {
      filePath: 'src/routes.ts',
      language: 'typescript',
      loc: 18,
      exports: [
        {
          name: 'router',
          kind: 'const',
          signature: 'const router: Router',
          isDefault: true,
          startLine: 1,
          endLine: 18,
        },
      ],
      imports: [],
      hash: 'c'.repeat(64),
      analyzedAt: '2026-03-22T00:00:00.000Z',
      parserUsed: 'ts-morph',
    });

    const context = createContext(tmpDir, [specPath], {
      detectedLanguages: ['ts-js'],
      configFiles: new Map([
        ['package.json', path.join(tmpDir, 'package.json')],
        ['Dockerfile', path.join(tmpDir, 'Dockerfile')],
      ]),
    });

    await expect(generator.isApplicable(context)).resolves.toBe(false);
  });

  it('bootstrapGenerators 后可通过 interface-surface id 查询', () => {
    bootstrapGenerators();
    const generatorInstance = GeneratorRegistry.getInstance().get('interface-surface');
    expect(generatorInstance).toBeDefined();
    expect(generatorInstance?.id).toBe('interface-surface');
  });
});
