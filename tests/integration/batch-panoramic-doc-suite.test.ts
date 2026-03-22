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

describe('runBatch panoramic 项目级文档套件接入', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-panoramic-doc-suite-'));

    fs.mkdirSync(path.join(projectRoot, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'models'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'events'), { recursive: true });

    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'doc-suite-app',
        version: '1.0.0',
        dependencies: {
          express: '^4.0.0',
        },
      }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
        },
      }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, '.env.example'),
      'DATABASE_URL=postgres://localhost/app\nPORT=3000\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'Dockerfile'),
      `
FROM node:20 AS build
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
CMD ["node", "dist/server.js"]
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'docker-compose.yml'),
      `
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime
    environment:
      DATABASE_URL: postgres://postgres/app
    ports:
      - "3000:3000"
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'models', 'user.ts'),
      `
export interface User {
  id: string;
  email: string;
}

export class UserService {
  findById(id: string): User {
    return { id, email: 'user@example.com' };
  }
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'api', 'routes.ts'),
      `
import express from 'express';
import { UserService } from '../models/user';

const router = express.Router();
const service = new UserService();

router.get('/users/:id', (req, res) => {
  res.json(service.findById(req.params.id));
});

export default router;
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'events', 'bus.ts'),
      `
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();

export function publishUserCreated(payload: { id: string; email: string }): void {
  bus.emit('user.created', payload);
}

export function onUserCreated(handler: (payload: { id: string; email: string }) => void): void {
  bus.on('user.created', handler);
}
`.trim(),
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

  it('batch 自动写出 applicable panoramic 文档与 architecture narrative', async () => {
    const result = await runBatch(projectRoot, {
      force: true,
      maxRetries: 1,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.projectDocs).toEqual(
      expect.arrayContaining([
        'specs/api-surface.md',
        'specs/architecture-ir.md',
        'specs/docs/adr/index.md',
        'specs/architecture-narrative.md',
        'specs/architecture-overview.md',
        'specs/component-view.md',
        'specs/config-reference.md',
        'specs/data-model.md',
        'specs/dynamic-scenarios.md',
        'specs/event-surface.md',
        'specs/pattern-hints.md',
        'specs/quality-report.md',
        'specs/runtime-topology.md',
      ]),
    );
    expect(result.docsBundleManifestPath).toBe('specs/docs-bundle.yaml');
    expect(result.docsBundleProfiles?.map((profile) => profile.id)).toEqual([
      'developer-onboarding',
      'architecture-review',
      'api-consumer',
      'ops-handover',
    ]);

    expect(fs.existsSync(path.join(projectRoot, 'specs', 'api-surface.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'architecture-ir.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'architecture-ir.mmd'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'architecture-ir.dsl'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'docs', 'adr', 'index.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'architecture-overview.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'architecture-overview.mmd'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'architecture-narrative.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'component-view.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'component-view.mmd'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'data-model.mmd'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'dynamic-scenarios.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'quality-report.json'))).toBe(true);
    const adrFiles = fs.readdirSync(path.join(projectRoot, 'specs', 'docs', 'adr'))
      .filter((fileName) => /^adr-\d{4}-.+\.md$/i.test(fileName));
    expect(adrFiles.length).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'docs-bundle.yaml'))).toBe(true);

    const narrativeMarkdown = fs.readFileSync(
      path.join(projectRoot, 'specs', 'architecture-narrative.md'),
      'utf-8',
    );
    expect(narrativeMarkdown).toContain('## 3. 关键模块');
    expect(narrativeMarkdown).toContain('## 5. 关键方法 / 函数');
    expect(narrativeMarkdown).toContain('UserService');

    const componentViewMarkdown = fs.readFileSync(
      path.join(projectRoot, 'specs', 'component-view.md'),
      'utf-8',
    );
    expect(componentViewMarkdown).toContain('## 4. 关键组件');

    const dynamicScenariosMarkdown = fs.readFileSync(
      path.join(projectRoot, 'specs', 'dynamic-scenarios.md'),
      'utf-8',
    );
    expect(dynamicScenariosMarkdown).toContain('## 2. 场景列表');

    const adrIndexMarkdown = fs.readFileSync(
      path.join(projectRoot, 'specs', 'docs', 'adr', 'index.md'),
      'utf-8',
    );
    expect(adrIndexMarkdown).toContain('## ADR 草稿列表');

    const qualityReportJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'specs', 'quality-report.json'), 'utf-8'),
    ) as {
      status: string;
      bundleCoverage: string;
      dependencyWarnings: string[];
      provenance: Array<{ documentId: string }>;
      requiredDocs: Array<{ docId: string; coverage: string; includedInBundles: string[] }>;
    };
    expect(qualityReportJson.dependencyWarnings).not.toEqual(
      expect.arrayContaining(['缺少 docs-bundle manifest，发布覆盖度只能按 partial 模式估算。']),
    );
    expect(qualityReportJson.requiredDocs.find((doc) => doc.docId === 'component-view')?.includedInBundles)
      .toEqual(expect.arrayContaining(['architecture-review']));
    expect(qualityReportJson.requiredDocs.find((doc) => doc.docId === 'dynamic-scenarios')?.includedInBundles)
      .toEqual(expect.arrayContaining(['architecture-review']));
    expect(qualityReportJson.requiredDocs.find((doc) => doc.docId === 'docs/adr/index')?.includedInBundles)
      .toEqual(expect.arrayContaining(['architecture-review']));
    expect(qualityReportJson.provenance.map((record) => record.documentId)).toEqual(
      expect.arrayContaining([
        'architecture-narrative',
        'component-view',
        'dynamic-scenarios',
        'docs/adr/index',
      ]),
    );

    const coverageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'specs', '_coverage-report.json'), 'utf-8'),
    ) as {
      generatorCoverage: Array<{ generatorId: string; generatedCount: number }>;
    };

    expect(
      coverageJson.generatorCoverage.find((entry) => entry.generatorId === 'architecture-ir')?.generatedCount,
    ).toBe(1);
    expect(
      coverageJson.generatorCoverage.find((entry) => entry.generatorId === 'architecture-overview')?.generatedCount,
    ).toBe(1);
    expect(
      coverageJson.generatorCoverage.find((entry) => entry.generatorId === 'runtime-topology')?.generatedCount,
    ).toBe(1);
  });

  it('无 runtime/workspace 时仍生成 architecture narrative', async () => {
    fs.rmSync(path.join(projectRoot, 'Dockerfile'));
    fs.rmSync(path.join(projectRoot, 'docker-compose.yml'));

    const result = await runBatch(projectRoot, {
      force: true,
      maxRetries: 1,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.projectDocs).toContain('specs/architecture-narrative.md');
    expect(result.projectDocs).toContain('specs/quality-report.md');
    expect(result.projectDocs).not.toContain('specs/architecture-overview.md');
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'architecture-narrative.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'quality-report.md'))).toBe(true);
    expect(result.docsBundleManifestPath).toBe('specs/docs-bundle.yaml');
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
      generatedBy: 'reverse-spec v2.1.0',
      sourceTarget,
      relatedFiles,
      lastUpdated: new Date().toISOString(),
      confidence: 'high',
      skeletonHash: skeleton.hash,
    },
    sections: {
      intent: `${sourceTarget} 负责模块对外职责与边界`,
      interfaceDefinition: `${sourceTarget} interface`,
      businessLogic: `${sourceTarget} 封装主要业务逻辑与控制流`,
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
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(projectRoot, fullPath));
      continue;
    }
    if (entry.isFile()) {
      results.push(path.relative(projectRoot, fullPath).split(path.sep).join('/'));
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
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
    loc: skeletons.reduce((sum, skeleton) => sum + skeleton.loc, 0),
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
