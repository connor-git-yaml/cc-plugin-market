import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { analyzeFiles } from '../../src/core/ast-analyzer.js';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';
import { scanStoredModuleSpecs } from '../../src/panoramic/doc-graph-builder.js';
import { DeltaRegenerator } from '../../src/batch/delta-regenerator.js';

describe('DeltaRegenerator', () => {
  let projectRoot: string;
  let specsDir: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-regenerator-'));
    specsDir = path.join(projectRoot, 'specs');
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
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
  });

  it('无既有 spec 时回退全量重生成', async () => {
    const regenerator = new DeltaRegenerator();
    const report = await regenerator.plan({
      projectRoot,
      dependencyGraph: createDependencyGraph(projectRoot),
      moduleGroups: createModuleGroups(),
      storedSpecs: [],
    });

    expect(report.mode).toBe('full');
    expect(report.fallbackReason).toBe('no-existing-specs');
    expect(report.directChanges.map((entry) => entry.sourceTarget)).toEqual([
      'src/api',
      'src/auth',
      'src/jobs',
    ]);
  });

  it('skeleton hash 未变化时全部保持 unchanged', async () => {
    await writeStoredSpecs(projectRoot, specsDir);
    const storedSpecs = scanStoredModuleSpecs(specsDir, projectRoot);

    const regenerator = new DeltaRegenerator();
    const report = await regenerator.plan({
      projectRoot,
      dependencyGraph: createDependencyGraph(projectRoot),
      moduleGroups: createModuleGroups(),
      storedSpecs,
    });

    expect(report.mode).toBe('incremental');
    expect(report.directChanges).toHaveLength(0);
    expect(report.propagatedChanges).toHaveLength(0);
    expect(report.unchangedTargets).toEqual([
      'src/api',
      'src/auth',
      'src/jobs',
    ]);
  });

  it('被依赖模块变更时会级联命中依赖方', async () => {
    await writeStoredSpecs(projectRoot, specsDir);
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'auth', 'service.ts'),
      `
export function authorize(value: string): string {
  return \`token:\${value.trim()}\`;
}
`.trim(),
      'utf-8',
    );

    const regenerator = new DeltaRegenerator();
    const report = await regenerator.plan({
      projectRoot,
      dependencyGraph: createDependencyGraph(projectRoot),
      moduleGroups: createModuleGroups(),
      storedSpecs: scanStoredModuleSpecs(specsDir, projectRoot),
    });

    expect(report.directChanges.map((entry) => entry.sourceTarget)).toEqual(['src/auth']);
    expect(report.propagatedChanges.map((entry) => entry.sourceTarget)).toEqual(['src/api']);
    expect(report.unchangedTargets).toEqual(['src/jobs']);
  });

  it('root 散文件按文件级 sourceTarget 判断是否重生成', async () => {
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'entry.ts'),
      `
export const entry = 'v1';
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'setup.ts'),
      `
export const setup = 'v1';
`.trim(),
      'utf-8',
    );
    await writeRootStoredSpec(projectRoot, specsDir, 'src/entry.ts');
    await writeRootStoredSpec(projectRoot, specsDir, 'src/setup.ts');

    fs.writeFileSync(
      path.join(projectRoot, 'src', 'entry.ts'),
      `
export const entry = 'v2';
`.trim(),
      'utf-8',
    );

    const regenerator = new DeltaRegenerator();
    const report = await regenerator.plan({
      projectRoot,
      dependencyGraph: createRootDependencyGraph(projectRoot),
      moduleGroups: [
        {
          name: 'root',
          dirPath: 'src',
          files: ['src/entry.ts', 'src/setup.ts'],
        },
      ],
      storedSpecs: scanStoredModuleSpecs(specsDir, projectRoot),
    });

    expect(report.directChanges.map((entry) => entry.sourceTarget)).toEqual(['src/entry.ts']);
    expect(report.unchangedTargets).toEqual(['src/setup.ts']);
  });
});

function createModuleGroups() {
  return [
    { name: 'auth', dirPath: 'src/auth', files: ['src/auth/service.ts'] },
    { name: 'api', dirPath: 'src/api', files: ['src/api/routes.ts'] },
    { name: 'jobs', dirPath: 'src/jobs', files: ['src/jobs/job.ts'] },
  ];
}

function createDependencyGraph(projectRoot: string): DependencyGraph {
  return {
    projectRoot,
    modules: [
      createNode('src/auth/service.ts'),
      createNode('src/api/routes.ts'),
      createNode('src/jobs/job.ts'),
    ],
    edges: [
      {
        from: 'src/api/routes.ts',
        to: 'src/auth/service.ts',
        isCircular: false,
        importType: 'static',
      },
    ],
    topologicalOrder: ['src/auth/service.ts', 'src/api/routes.ts', 'src/jobs/job.ts'],
    sccs: [],
    totalModules: 3,
    totalEdges: 1,
    analyzedAt: '2026-03-20T00:00:00.000Z',
    mermaidSource: 'graph TD',
  };
}

function createRootDependencyGraph(projectRoot: string): DependencyGraph {
  return {
    projectRoot,
    modules: [
      createNode('src/entry.ts'),
      createNode('src/setup.ts'),
    ],
    edges: [],
    topologicalOrder: ['src/entry.ts', 'src/setup.ts'],
    sccs: [],
    totalModules: 2,
    totalEdges: 0,
    analyzedAt: '2026-03-20T00:00:00.000Z',
    mermaidSource: 'graph TD',
  };
}

function createNode(source: string) {
  return {
    source,
    isOrphan: false,
    inDegree: 0,
    outDegree: 0,
    level: 0,
  };
}

async function writeStoredSpecs(projectRoot: string, specsDir: string): Promise<void> {
  fs.mkdirSync(specsDir, { recursive: true });
  await writeModuleStoredSpec(projectRoot, specsDir, 'src/auth', ['src/auth/service.ts']);
  await writeModuleStoredSpec(projectRoot, specsDir, 'src/api', ['src/api/routes.ts']);
  await writeModuleStoredSpec(projectRoot, specsDir, 'src/jobs', ['src/jobs/job.ts']);
}

async function writeModuleStoredSpec(
  projectRoot: string,
  specsDir: string,
  sourceTarget: string,
  relatedFiles: string[],
): Promise<void> {
  const hash = await computeHash(projectRoot, relatedFiles);
  const specName = `${path.basename(sourceTarget)}.spec.md`;
  fs.writeFileSync(
    path.join(specsDir, specName),
    `---
type: module-spec
version: v1
generatedBy: reverse-spec
sourceTarget: ${sourceTarget}
relatedFiles:
${relatedFiles.map((item) => `  - ${item}`).join('\n')}
lastUpdated: 2026-03-20T00:00:00.000Z
confidence: high
skeletonHash: ${hash}
---

# ${sourceTarget}

## 1. 意图
${sourceTarget} intent

## 2. 接口定义
interface

## 3. 业务逻辑
logic
`,
    'utf-8',
  );
}

async function writeRootStoredSpec(
  projectRoot: string,
  specsDir: string,
  sourceTarget: string,
): Promise<void> {
  fs.mkdirSync(specsDir, { recursive: true });
  const hash = await computeHash(projectRoot, [sourceTarget]);
  const specName = `${path.basename(sourceTarget, path.extname(sourceTarget))}.spec.md`;
  fs.writeFileSync(
    path.join(specsDir, specName),
    `---
type: module-spec
version: v1
generatedBy: reverse-spec
sourceTarget: ${sourceTarget}
relatedFiles:
  - ${sourceTarget}
lastUpdated: 2026-03-20T00:00:00.000Z
confidence: high
skeletonHash: ${hash}
---

# ${sourceTarget}

## 1. 意图
${sourceTarget} intent
`,
    'utf-8',
  );
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
