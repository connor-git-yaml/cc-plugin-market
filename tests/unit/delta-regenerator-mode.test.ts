/**
 * Bug 142 — DeltaRegenerator mode-aware cache 单元测试
 *
 * 覆盖场景：
 * 1. 跨模式 cache miss（stored=reading + effectiveMode=full）
 * 2. 跨模式 cache miss（stored=full + effectiveMode=reading）
 * 3. 同模式 + hash 未变 → unchanged
 * 4. 同模式 + hash 变化 → skeleton-changed（mode 检查不应覆盖 hash 检查）
 * 5. 旧 spec 无 generatedByMode + effectiveMode 传入 → mode-changed（安全降级）
 * 6. effectiveMode 不传入（向后兼容）+ 旧 spec → unchanged（不退化）
 * 7. 全部 effectiveMode 不传入（向后兼容）+ 同模式 spec → unchanged
 * 8. effectiveMode='code-only' + stored=undefined → mode-changed
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import type { ModuleGraph } from '../../src/knowledge-graph/module-derivation.js';
import type { StoredModuleSpecSummary } from '../../src/panoramic/builders/doc-graph-builder.js';
import { DeltaRegenerator } from '../../src/batch/delta-regenerator.js';
// Feature 182：删除本地 computeHashFor 私有复刻（曾逐字复刻读侧 localeCompare 公式造成假绿），
// 改用唯一权威 computeModuleSkeletonHash，保证测试与生产共用同一 hash 实现。
import { computeModuleSkeletonHash } from '../../src/core/skeleton-hash.js';

describe('DeltaRegenerator — mode-aware cache (Bug 142)', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-regenerator-mode-'));
    fs.mkdirSync(path.join(projectRoot, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'auth', 'service.ts'),
      `export function authorize(value: string): string {\n  return value.trim();\n}\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext' } }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
  });

  it('场景 1：stored=reading + effectiveMode=full → mode-changed', async () => {
    const hash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: hash,
      generatedByMode: 'reading',
    });

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
      effectiveMode: 'full',
    });

    expect(report.mode).toBe('incremental');
    expect(report.directChanges).toHaveLength(1);
    expect(report.directChanges[0]?.reason).toBe('mode-changed');
    expect(report.directChanges[0]?.sourceTarget).toBe('src/auth');
  });

  it('场景 2：stored=full + effectiveMode=reading → mode-changed', async () => {
    const hash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: hash,
      generatedByMode: 'full',
    });

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
      effectiveMode: 'reading',
    });

    expect(report.directChanges).toHaveLength(1);
    expect(report.directChanges[0]?.reason).toBe('mode-changed');
  });

  it('场景 3：同模式 + hash 未变 → unchanged', async () => {
    const hash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: hash,
      generatedByMode: 'full',
    });

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
      effectiveMode: 'full',
    });

    expect(report.directChanges).toHaveLength(0);
    expect(report.unchangedTargets).toEqual(['src/auth']);
  });

  it('场景 4：同模式 + hash 变化 → skeleton-changed（mode 检查不应屏蔽 hash 检查）', async () => {
    // 先写入 stored hash 用旧文件计算
    const oldHash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: oldHash,
      generatedByMode: 'full',
    });

    // 更改源文件改变 hash
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'auth', 'service.ts'),
      `export function authorize(value: string): string {\n  return \`token:\${value.trim()}\`;\n}\n`,
      'utf-8',
    );

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
      effectiveMode: 'full',
    });

    expect(report.directChanges).toHaveLength(1);
    expect(report.directChanges[0]?.reason).toBe('skeleton-changed');
  });

  it('场景 5：旧 spec 无 generatedByMode + effectiveMode 传入 → mode-changed（安全降级）', async () => {
    const hash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: hash,
      // 故意不设置 generatedByMode 模拟旧 spec
    });

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
      effectiveMode: 'full',
    });

    expect(report.directChanges).toHaveLength(1);
    expect(report.directChanges[0]?.reason).toBe('mode-changed');
  });

  it('场景 6：effectiveMode 不传 + 旧 spec 无 generatedByMode → unchanged（向后兼容不退化）', async () => {
    const hash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: hash,
    });

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
      // 故意不传 effectiveMode
    });

    expect(report.directChanges).toHaveLength(0);
    expect(report.unchangedTargets).toEqual(['src/auth']);
  });

  it('场景 7：effectiveMode 不传 + stored 有 generatedByMode → unchanged（向后兼容）', async () => {
    const hash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: hash,
      generatedByMode: 'reading',
    });

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
    });

    expect(report.directChanges).toHaveLength(0);
  });

  it('场景 8：effectiveMode=code-only + stored.generatedByMode=undefined → mode-changed', async () => {
    const hash = await computeModuleSkeletonHash(projectRoot, ['src/auth/service.ts']);
    const stored = makeStoredSpec({
      sourceTarget: 'src/auth',
      skeletonHash: hash,
    });

    const report = await new DeltaRegenerator().plan({
      projectRoot,
      dependencyGraph: makeGraph(projectRoot),
      moduleGroups: makeGroups(),
      storedSpecs: [stored],
      effectiveMode: 'code-only',
    });

    expect(report.directChanges[0]?.reason).toBe('mode-changed');
  });
});

// ============================================================
// 辅助构造函数
// ============================================================

function makeStoredSpec(overrides: Partial<StoredModuleSpecSummary>): StoredModuleSpecSummary {
  return {
    specPath: 'specs/modules/auth.spec.md',
    sourceTarget: 'src/auth',
    relatedFiles: ['src/auth/service.ts'],
    linked: false,
    intentSummary: 'auth intent',
    outputPath: 'specs/modules/auth.spec.md',
    ...overrides,
  };
}

function makeGroups() {
  return [
    { name: 'auth', dirPath: 'src/auth', files: ['src/auth/service.ts'] },
  ];
}

function makeGraph(projectRoot: string): ModuleGraph {
  return {
    projectRoot,
    modules: [
      { source: 'src/auth/service.ts', isOrphan: false, inDegree: 0, outDegree: 0, level: 0 },
    ],
    edges: [],
    topologicalOrder: ['src/auth/service.ts'],
    sccs: [],
    totalModules: 1,
    totalEdges: 0,
    analyzedAt: '2026-04-27T00:00:00.000Z',
    mermaidSource: 'graph TD',
  };
}

