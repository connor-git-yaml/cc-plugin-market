import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { analyzeFiles } from '../../src/core/ast-analyzer.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';

const mocks = vi.hoisted(() => ({
  generateSpec: vi.fn(),
}));

vi.mock('../../src/core/single-spec-orchestrator.js', () => ({
  generateSpec: mocks.generateSpec,
}));

import { runBatch } from '../../src/batch/batch-orchestrator.js';

describe('runBatch 增量重生成接入', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-incremental-'));
    fs.mkdirSync(path.join(projectRoot, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'jobs'), { recursive: true });

    fs.writeFileSync(
      path.join(projectRoot, 'src', 'auth', 'service.ts'),
      `
export function authorize(value: string): string {
  return value.trim();
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'api', 'routes.ts'),
      `
import { authorize } from '../auth/service';

export function route(input: string): string {
  return authorize(input);
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'jobs', 'job.ts'),
      `
export function runJob(): string {
  return 'ok';
}
`.trim(),
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

    mocks.generateSpec.mockImplementation(async (targetPath: string, options: { outputDir?: string; projectRoot?: string; existingVersion?: string }) => {
      const moduleSpec = await buildMockModuleSpec(
        options.projectRoot ?? projectRoot,
        targetPath,
        options.outputDir ?? path.join(projectRoot, 'specs'),
        options.existingVersion,
      );

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

  it('仅重生成直接命中和传播命中的 spec，无关 spec mtime 不变', async () => {
    const firstRun = await runBatch(projectRoot, {
      force: true,
      maxRetries: 1,
    });

    expect(firstRun.failed).toHaveLength(0);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'auth.spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'api.spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'specs', 'jobs.spec.md'))).toBe(true);

    const jobsSpecPath = path.join(projectRoot, 'specs', 'jobs.spec.md');
    const jobsBefore = fs.statSync(jobsSpecPath).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'auth', 'service.ts'),
      `
export function authorize(value: string): string {
  return \`token:\${value.trim()}\`;
}
`.trim(),
      'utf-8',
    );

    mocks.generateSpec.mockClear();

    const result = await runBatch(projectRoot, {
      incremental: true,
      maxRetries: 1,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.deltaReportPath).toBe('specs/_delta-report.md');
    expect(result.skipped).toContain('jobs');

    const calledTargets = mocks.generateSpec.mock.calls.map((call) => path.relative(projectRoot, call[0]));
    expect(calledTargets).toEqual(['src/auth', 'src/api']);

    const jobsAfter = fs.statSync(jobsSpecPath).mtimeMs;
    expect(jobsAfter).toBe(jobsBefore);

    const deltaReport = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'specs', '_delta-report.json'), 'utf-8'),
    ) as {
      directChanges: Array<{ sourceTarget: string }>;
      propagatedChanges: Array<{ sourceTarget: string }>;
      unchangedTargets: string[];
    };

    expect(deltaReport.directChanges.map((entry) => entry.sourceTarget)).toEqual(['src/auth']);
    expect(deltaReport.propagatedChanges.map((entry) => entry.sourceTarget)).toEqual(['src/api']);
    expect(deltaReport.unchangedTargets).toEqual(['src/jobs']);
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
  const hash = await computeHash(projectRoot, relatedFiles);
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
      skeletonHash: hash,
    },
    sections: {
      intent: `${sourceTarget} intent`,
      interfaceDefinition: `${sourceTarget} interface`,
      businessLogic: `${sourceTarget} logic`,
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
    baselineSkeleton: {
      filePath: relatedFiles[0]!,
      language: 'typescript',
      loc: 10,
      exports: [],
      imports: [],
      hash,
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    },
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

async function computeHash(projectRoot: string, relatedFiles: string[]): Promise<string> {
  const analyzed = await analyzeFiles(relatedFiles.map((filePath) => path.join(projectRoot, filePath)));
  if (analyzed.length === 1) {
    return analyzed[0]!.hash;
  }

  return createHash('sha256')
    .update(
      analyzed
        .slice()
        .sort((left, right) => left.filePath.localeCompare(right.filePath))
        .map((skeleton) => skeleton.hash)
        .join(''),
    )
    .digest('hex');
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
