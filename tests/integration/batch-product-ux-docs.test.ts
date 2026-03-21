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
import { parseYamlDocument } from '../../src/panoramic/parsers/yaml-config-parser.js';

const mocks = vi.hoisted(() => ({
  generateSpec: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  generateSpec: mocks.generateSpec,
}));

import { runBatch } from '../../src/batch/batch-orchestrator.js';

describe('runBatch product UX docs integration', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-product-ux-docs-'));

    fs.mkdirSync(path.join(projectRoot, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'models'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'specs', 'products', 'demo'), { recursive: true });

    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'product-doc-app',
        version: '1.0.0',
        dependencies: {
          express: '^4.0.0',
        },
      }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'README.md'),
      '# Product Doc App\n\nProduct Doc App 将架构文档与产品事实放在同一批量输出链路中。\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, '.env.example'),
      'PORT=3000\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'Dockerfile'),
      'FROM node:20\nWORKDIR /app\nCOPY . .\nCMD ["node", "dist/server.js"]\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'docker-compose.yml'),
      'services:\n  api:\n    build: .\n    ports:\n      - "3000:3000"\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'specs', 'products', 'demo', 'current-spec.md'),
      [
        '# Product Doc App — 产品规范活文档',
        '',
        '## 1. 产品概述',
        '',
        'Product Doc App 让团队把产品概览、用户旅程与技术文档打包交付。',
        '',
        '## 3. 用户画像与场景',
        '',
        '| 角色 | 描述 | 主要使用场景 |',
        '| --- | --- | --- |',
        '| 架构师 | 关注系统结构与交付路径 | 评审 bundle、阅读架构概览 |',
        '| 产品经理 | 关注定位与场景 | 校对产品概览、阅读用户旅程 |',
        '',
        '1. 交付文档包：为不同受众生成可导航的文档 bundle',
        '2. 审阅用户旅程：确认关键任务流与受众是否合理',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'models', 'user.ts'),
      'export interface User { id: string; }\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'api', 'routes.ts'),
      'import express from "express"; const router = express.Router(); router.get("/users", (_req, res) => res.json([])); export default router;\n',
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

  it('在 batch 中输出产品概览、用户旅程与 feature briefs，并进入 docs bundle / quality report', async () => {
    const result = await runBatch(projectRoot, {
      force: true,
      maxRetries: 1,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.projectDocs).toEqual(
      expect.arrayContaining([
        'specs/product-overview.md',
        'specs/user-journeys.md',
        'specs/feature-briefs/index.md',
      ]),
    );
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'product-overview.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'user-journeys.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'feature-briefs', 'index.md'))).toBe(true);

    const bundleManifest = parseYamlDocument(
      fs.readFileSync(path.join(projectRoot, 'specs', 'docs-bundle.yaml'), 'utf-8'),
    ) as {
      profiles?: Array<{ id: string; documents?: Array<{ sourceId?: string }> }>;
    };
    const onboardingProfile = bundleManifest.profiles?.find((profile) => profile.id === 'developer-onboarding');
    expect(onboardingProfile?.documents?.map((document) => document.sourceId)).toEqual(
      expect.arrayContaining(['product-overview', 'user-journeys', 'feature-briefs/index']),
    );

    const qualityReport = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'specs', 'quality-report.json'), 'utf-8'),
    ) as {
      requiredDocs: Array<{ docId: string; coverage: string }>;
      provenance: Array<{ documentId: string }>;
    };
    expect(qualityReport.requiredDocs.find((doc) => doc.docId === 'product-overview')?.coverage).toBe('covered');
    expect(qualityReport.requiredDocs.find((doc) => doc.docId === 'user-journeys')?.coverage).toBe('covered');
    expect(qualityReport.provenance.map((record) => record.documentId)).toEqual(
      expect.arrayContaining(['product-overview', 'user-journeys', 'feature-briefs/index']),
    );
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
