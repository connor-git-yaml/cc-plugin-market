/**
 * SpecStore 单元测试
 * 覆盖 4 种查询视图 + orphan 识别 + 身份过滤 + mergeIndexSpecs 兼容性
 */
import { describe, it, expect } from 'vitest';
import { SpecStore } from '../../src/spec-store/index.js';
import type { ModuleSpec, SpecFrontmatter } from '../../src/models/module-spec.js';
import type { StoredModuleSpecSummary } from '../../src/panoramic/builders/doc-graph-builder.js';

// ============================================================
// 测试辅助函数
// ============================================================

/** 构造最小合法 SpecFrontmatter（允许附加 sourceKind 用于测试） */
function makeFrontmatter(overrides: Partial<SpecFrontmatter> & { sourceKind?: string } = {}): SpecFrontmatter & { sourceKind?: string } {
  const { sourceKind, ...frontmatterFields } = overrides;
  const result: SpecFrontmatter & { sourceKind?: string } = {
    type: 'module-spec',
    version: 'v1',
    generatedBy: 'spectra v3.0',
    sourceTarget: 'src/foo/index.ts',
    relatedFiles: [],
    lastUpdated: new Date().toISOString(),
    confidence: 'medium',
    skeletonHash: 'a'.repeat(64),
    ...frontmatterFields,
  };
  if (sourceKind !== undefined) {
    result.sourceKind = sourceKind;
  }
  return result;
}

/** 构造最小合法 ModuleSpec */
function makeCurrentSpec(overrides: {
  outputPath?: string;
  sourceTarget?: string;
  confidence?: 'high' | 'medium' | 'low';
  sourceKind?: string;
} = {}): ModuleSpec {
  return {
    frontmatter: makeFrontmatter({
      sourceTarget: overrides.sourceTarget ?? 'src/foo/index.ts',
      confidence: overrides.confidence,
      sourceKind: overrides.sourceKind,
    }),
    sections: {
      intent: '模块意图',
      interfaceDefinition: '',
      businessLogic: '',
      dataStructures: '',
      constraints: '',
      edgeCases: '',
      technicalDebt: '',
      testCoverage: '',
      dependencies: '',
    },
    mermaidDiagrams: [],
    fileInventory: [],
    baselineSkeleton: {
      sourceTarget: overrides.sourceTarget ?? 'src/foo/index.ts',
      language: 'typescript',
      hash: 'a'.repeat(64),
      classes: [],
      functions: [],
      imports: [],
      exports: [],
    },
    outputPath: overrides.outputPath ?? 'specs/modules/foo.spec.md',
  } as ModuleSpec;
}

/** 构造最小合法 StoredModuleSpecSummary（允许附加 sourceKind 用于测试） */
function makeStoredSpec(overrides: Partial<StoredModuleSpecSummary> & { sourceKind?: string } = {}): StoredModuleSpecSummary & { sourceKind?: string } {
  const { sourceKind, ...rest } = overrides;
  const result: StoredModuleSpecSummary & { sourceKind?: string } = {
    specPath: 'specs/modules/stored.spec.md',
    sourceTarget: 'src/stored/index.ts',
    relatedFiles: [],
    linked: false,
    confidence: 'medium',
    version: 'v1',
    skeletonHash: 'b'.repeat(64),
    language: 'typescript',
    crossLanguageRefs: [],
    intentSummary: '存储 spec 摘要',
    outputPath: 'specs/modules/stored.spec.md',
    ...rest,
  };
  if (sourceKind !== undefined) {
    result.sourceKind = sourceKind;
  }
  return result;
}

/** 创建 toProjectPath 辅助函数（测试用，直接返回相对路径） */
function makeToProjectPath(projectRoot: string) {
  return (absPath: string) => {
    if (absPath.startsWith(projectRoot + '/')) {
      return absPath.slice(projectRoot.length + 1);
    }
    return absPath;
  };
}

// ============================================================
// 测试套件
// ============================================================

describe('SpecStore', () => {
  const projectRoot = '/project';
  const toProjectPath = makeToProjectPath(projectRoot);

  // 默认 existsFn：所有文件都存在
  const allExist = (_p: string) => true;
  // existsFn：所有文件都不存在
  const noneExist = (_p: string) => false;

  // ============================================================
  // TC-01：全量场景（force batch）
  // ============================================================
  it('TC-01 全量场景：currentSpecs=5, storedSpecs=0 → allKnownSpecs 返回 5', () => {
    const currentSpecs = Array.from({ length: 5 }, (_, i) =>
      makeCurrentSpec({
        outputPath: `specs/modules/mod${i}.spec.md`,
        sourceTarget: `src/mod${i}/index.ts`,
      }),
    );

    const store = new SpecStore({ currentSpecs, storedSpecs: [], projectRoot, toProjectPath, existsFn: allExist });

    expect(store.allKnownSpecs()).toHaveLength(5);
    expect(store.totalKnownCount()).toBe(5);
  });

  // ============================================================
  // TC-02：增量场景
  // ============================================================
  it('TC-02 增量场景：currentSpecs=1, storedSpecs=4（不同 outputPath）→ allKnownSpecs 返回 5', () => {
    const currentSpecs = [makeCurrentSpec({ outputPath: 'specs/modules/new.spec.md', sourceTarget: 'src/new/index.ts' })];
    const storedSpecs = Array.from({ length: 4 }, (_, i) =>
      makeStoredSpec({
        outputPath: `specs/modules/cached${i}.spec.md`,
        specPath: `specs/modules/cached${i}.spec.md`,
        sourceTarget: `src/cached${i}/index.ts`,
      }),
    );

    const store = new SpecStore({ currentSpecs, storedSpecs, projectRoot, toProjectPath, existsFn: allExist });

    expect(store.allKnownSpecs()).toHaveLength(5);
    expect(store.totalKnownCount()).toBe(5);
  });

  // ============================================================
  // TC-03：无改动场景（全部走缓存）
  // ============================================================
  it('TC-03 无改动场景：currentSpecs=0, storedSpecs=5 → allKnownSpecs 返回 5', () => {
    const storedSpecs = Array.from({ length: 5 }, (_, i) =>
      makeStoredSpec({
        outputPath: `specs/modules/cached${i}.spec.md`,
        specPath: `specs/modules/cached${i}.spec.md`,
        sourceTarget: `src/cached${i}/index.ts`,
      }),
    );

    const store = new SpecStore({ currentSpecs: [], storedSpecs, projectRoot, toProjectPath, existsFn: allExist });

    expect(store.allKnownSpecs()).toHaveLength(5);
  });

  // ============================================================
  // TC-04：AST-only 场景（llmModel 字段为空，数量不受影响）
  // ============================================================
  it('TC-04 AST-only 场景：allKnownSpecs 数量与全量一致（不受 LLM 字段影响）', () => {
    const currentSpecs = Array.from({ length: 3 }, (_, i) =>
      makeCurrentSpec({
        outputPath: `specs/modules/ast${i}.spec.md`,
        sourceTarget: `src/ast${i}/index.ts`,
      }),
    );

    const store = new SpecStore({ currentSpecs, storedSpecs: [], projectRoot, toProjectPath, existsFn: allExist });

    expect(store.allKnownSpecs()).toHaveLength(3);
    expect(store.totalKnownCount()).toBe(3);
  });

  // ============================================================
  // TC-05：覆盖/重复场景（相同 outputPath 以 currentSpec 为准）
  // ============================================================
  it('TC-05 相同 outputPath 时，currentSpec 覆盖 storedSpec', () => {
    const outputPath = 'specs/modules/overlap.spec.md';
    const currentSpec = makeCurrentSpec({
      outputPath,
      sourceTarget: 'src/overlap/index.ts',
      confidence: 'high',
    });
    const storedSpec = makeStoredSpec({
      outputPath,
      specPath: outputPath,
      sourceTarget: 'src/overlap/index.ts',
      confidence: 'low',
    });

    const store = new SpecStore({ currentSpecs: [currentSpec], storedSpecs: [storedSpec], projectRoot, toProjectPath, existsFn: allExist });

    const results = store.allKnownSpecs();
    // 去重后只有 1 条
    expect(results).toHaveLength(1);
    // 以 currentSpec 的 confidence 为准
    expect(results[0]!.frontmatter.confidence).toBe('high');
  });

  // ============================================================
  // TC-06：skeletonHash 规则（无 hash 的 storedSpec 被跳过）
  // ============================================================
  it('TC-06 storedSpec 缺少 skeletonHash 时，不进入合并结果', () => {
    const storedSpecWithoutHash = makeStoredSpec({
      outputPath: 'specs/modules/no-hash.spec.md',
      specPath: 'specs/modules/no-hash.spec.md',
      sourceTarget: 'src/no-hash/index.ts',
      skeletonHash: undefined,
    });
    const storedSpecWithHash = makeStoredSpec({
      outputPath: 'specs/modules/with-hash.spec.md',
      specPath: 'specs/modules/with-hash.spec.md',
      sourceTarget: 'src/with-hash/index.ts',
    });

    const store = new SpecStore({
      currentSpecs: [],
      storedSpecs: [storedSpecWithoutHash, storedSpecWithHash],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    const results = store.allKnownSpecs();
    // no-hash 的 spec 被跳过，只有 with-hash 的
    expect(results).toHaveLength(1);
    expect(results[0]!.outputPath).toBe('specs/modules/with-hash.spec.md');
  });

  // ============================================================
  // TC-07：Orphan 识别
  // ============================================================
  it('TC-07 storedSpec 的 sourceTarget 不存在时，进入 orphanSpecs()，不进入 allKnownSpecs()', () => {
    // orphan-module 的源文件不存在
    const existsFn = (p: string) => !p.includes('orphan-module');

    const orphanSpec = makeStoredSpec({
      outputPath: 'specs/modules/orphan.spec.md',
      specPath: 'specs/modules/orphan.spec.md',
      sourceTarget: 'src/orphan-module/index.ts',
    });
    const normalSpec = makeStoredSpec({
      outputPath: 'specs/modules/normal.spec.md',
      specPath: 'specs/modules/normal.spec.md',
      sourceTarget: 'src/normal/index.ts',
    });

    const store = new SpecStore({
      currentSpecs: [],
      storedSpecs: [orphanSpec, normalSpec],
      projectRoot,
      toProjectPath,
      existsFn,
    });

    // orphanSpecs 包含 orphan
    const orphans = store.orphanSpecs();
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.outputPath).toBe('specs/modules/orphan.spec.md');

    // allKnownSpecs 不包含 orphan
    const all = store.allKnownSpecs();
    expect(all).toHaveLength(1);
    expect(all[0]!.outputPath).toBe('specs/modules/normal.spec.md');
  });

  // ============================================================
  // TC-08：sourceKind='canonical' 参与 allKnownSpecs
  // ============================================================
  it('TC-08 sourceKind="canonical" 的 spec 出现在 allKnownSpecs()', () => {
    const spec = makeCurrentSpec({
      outputPath: 'specs/modules/canonical.spec.md',
      sourceTarget: 'src/canonical/index.ts',
      sourceKind: 'canonical',
    });

    const store = new SpecStore({ currentSpecs: [spec], storedSpecs: [], projectRoot, toProjectPath, existsFn: allExist });

    expect(store.allKnownSpecs()).toHaveLength(1);
  });

  // ============================================================
  // TC-09：sourceKind='bundle_copy' 不参与 allKnownSpecs
  // ============================================================
  it('TC-09 sourceKind="bundle_copy" 的 storedSpec 不出现在 allKnownSpecs()', () => {
    const bundleCopySpec = makeStoredSpec({
      outputPath: 'specs/bundles/foo.spec.md',
      specPath: 'specs/bundles/foo.spec.md',
      sourceTarget: 'src/foo/index.ts',
      sourceKind: 'bundle_copy',
    });

    const normalSpec = makeStoredSpec({
      outputPath: 'specs/modules/foo.spec.md',
      specPath: 'specs/modules/foo.spec.md',
      sourceTarget: 'src/foo/index.ts',
    });

    const store = new SpecStore({
      currentSpecs: [],
      storedSpecs: [bundleCopySpec, normalSpec],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    const results = store.allKnownSpecs();
    // bundle_copy 被过滤，只有 canonical
    expect(results).toHaveLength(1);
    expect(results[0]!.outputPath).toBe('specs/modules/foo.spec.md');
  });

  // ============================================================
  // TC-10：sourceKind='derived' 不参与 allKnownSpecs
  // ============================================================
  it('TC-10 sourceKind="derived" 的 storedSpec 不出现在 allKnownSpecs()', () => {
    const derivedSpec = makeStoredSpec({
      outputPath: 'specs/derived/foo-zh.spec.md',
      specPath: 'specs/derived/foo-zh.spec.md',
      sourceTarget: 'src/foo/index.ts',
      sourceKind: 'derived',
    });

    const store = new SpecStore({
      currentSpecs: [],
      storedSpecs: [derivedSpec],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    expect(store.allKnownSpecs()).toHaveLength(0);
  });

  // ============================================================
  // TC-11：sourceKind 缺失默认视为 canonical，参与 allKnownSpecs
  // ============================================================
  it('TC-11 sourceKind 字段缺失时默认视为 canonical，参与 allKnownSpecs()', () => {
    const legacySpec = makeStoredSpec({
      outputPath: 'specs/modules/legacy.spec.md',
      specPath: 'specs/modules/legacy.spec.md',
      sourceTarget: 'src/legacy/index.ts',
      // 不设置 sourceKind 字段
    });

    const store = new SpecStore({
      currentSpecs: [],
      storedSpecs: [legacySpec],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    expect(store.allKnownSpecs()).toHaveLength(1);
  });

  // ============================================================
  // TC-12：空输入
  // ============================================================
  it('TC-12 空输入：currentSpecs=[], storedSpecs=[] → allKnownSpecs() 返回空，不报错', () => {
    const store = new SpecStore({ currentSpecs: [], storedSpecs: [], projectRoot, toProjectPath, existsFn: allExist });

    expect(store.allKnownSpecs()).toEqual([]);
    expect(store.totalKnownCount()).toBe(0);
    expect(store.orphanSpecs()).toEqual([]);
    expect(store.currentRunSpecs()).toEqual([]);
    expect(store.storedOnlySpecs()).toEqual([]);
  });

  // ============================================================
  // TC-13：currentRunSpecs() 行为
  // ============================================================
  it('TC-13 currentRunSpecs() 仅返回本次生成的 spec', () => {
    const current1 = makeCurrentSpec({ outputPath: 'specs/modules/cur1.spec.md', sourceTarget: 'src/cur1/index.ts' });
    const current2 = makeCurrentSpec({ outputPath: 'specs/modules/cur2.spec.md', sourceTarget: 'src/cur2/index.ts' });
    const stored = makeStoredSpec({ outputPath: 'specs/modules/sto.spec.md', specPath: 'specs/modules/sto.spec.md', sourceTarget: 'src/sto/index.ts' });

    const store = new SpecStore({
      currentSpecs: [current1, current2],
      storedSpecs: [stored],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    const currentRun = store.currentRunSpecs();
    expect(currentRun).toHaveLength(2);
    expect(currentRun.map((s) => s.outputPath)).toContain('specs/modules/cur1.spec.md');
    expect(currentRun.map((s) => s.outputPath)).toContain('specs/modules/cur2.spec.md');
    // 不包含 stored spec
    expect(currentRun.map((s) => s.outputPath)).not.toContain('specs/modules/sto.spec.md');
  });

  // ============================================================
  // TC-14：storedOnlySpecs() 行为
  // ============================================================
  it('TC-14 storedOnlySpecs() 返回磁盘已有但本次未重新生成的 spec', () => {
    const current = makeCurrentSpec({ outputPath: 'specs/modules/cur.spec.md', sourceTarget: 'src/cur/index.ts' });
    const stored1 = makeStoredSpec({ outputPath: 'specs/modules/sto1.spec.md', specPath: 'specs/modules/sto1.spec.md', sourceTarget: 'src/sto1/index.ts' });
    const stored2 = makeStoredSpec({ outputPath: 'specs/modules/cur.spec.md', specPath: 'specs/modules/cur.spec.md', sourceTarget: 'src/cur/index.ts' });

    const store = new SpecStore({
      currentSpecs: [current],
      storedSpecs: [stored1, stored2],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    const storedOnly = store.storedOnlySpecs();
    // stored2 的 outputPath 与 current 相同，应被排除
    expect(storedOnly).toHaveLength(1);
    expect(storedOnly[0]!.outputPath).toBe('specs/modules/sto1.spec.md');
  });

  // ============================================================
  // TC-15：asDocGraphInput() 的 currentRun 标志正确性
  // ============================================================
  it('TC-15 asDocGraphInput() 的 moduleSpecs 包含本次生成，existingSpecs 包含磁盘已有', () => {
    const current = makeCurrentSpec({
      outputPath: 'specs/modules/cur.spec.md',
      sourceTarget: 'src/cur/index.ts',
    });
    const stored = makeStoredSpec({
      outputPath: 'specs/modules/sto.spec.md',
      specPath: 'specs/modules/sto.spec.md',
      sourceTarget: 'src/sto/index.ts',
    });

    const store = new SpecStore({
      currentSpecs: [current],
      storedSpecs: [stored],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    const { moduleSpecs, existingSpecs } = store.asDocGraphInput();

    // moduleSpecs 是本次生成的原始 ModuleSpec
    expect(moduleSpecs).toHaveLength(1);
    expect(moduleSpecs[0]!.outputPath).toBe('specs/modules/cur.spec.md');

    // existingSpecs 是磁盘已有（非本次生成）
    expect(existingSpecs).toHaveLength(1);
    expect(existingSpecs[0]!.specPath).toBe('specs/modules/sto.spec.md');
  });

  // ============================================================
  // TC-16：asDocGraphInput() 不包含 orphan 和非 canonical spec
  // ============================================================
  it('TC-16 asDocGraphInput() 的 existingSpecs 不包含 orphan 和 bundle_copy', () => {
    // orphan-module 的源文件不存在
    const existsFn = (p: string) => !p.includes('orphan-module');

    const orphanSpec = makeStoredSpec({
      outputPath: 'specs/modules/orphan.spec.md',
      specPath: 'specs/modules/orphan.spec.md',
      sourceTarget: 'src/orphan-module/index.ts',
    });

    const bundleCopySpec = makeStoredSpec({
      outputPath: 'specs/bundles/copy.spec.md',
      specPath: 'specs/bundles/copy.spec.md',
      sourceTarget: 'src/normal/index.ts',
      sourceKind: 'bundle_copy',
    });

    const normalSpec = makeStoredSpec({
      outputPath: 'specs/modules/normal.spec.md',
      specPath: 'specs/modules/normal.spec.md',
      sourceTarget: 'src/normal/index.ts',
    });

    const store = new SpecStore({
      currentSpecs: [],
      storedSpecs: [orphanSpec, bundleCopySpec, normalSpec],
      projectRoot,
      toProjectPath,
      existsFn,
    });

    const { existingSpecs } = store.asDocGraphInput();

    // orphan 被排除（源文件不存在），bundle_copy 也被排除，只有 normal
    expect(existingSpecs).toHaveLength(1);
    expect(existingSpecs[0]!.specPath).toBe('specs/modules/normal.spec.md');
  });

  // ============================================================
  // TC-17：allKnownSpecs 去重（同一 outputPath 只返回一条）
  // ============================================================
  it('TC-17 allKnownSpecs() 对同一 outputPath 只返回一条记录', () => {
    const outputPath = 'specs/modules/dup.spec.md';
    const currentSpec = makeCurrentSpec({ outputPath, sourceTarget: 'src/dup/index.ts' });
    const storedSpec = makeStoredSpec({ outputPath, specPath: outputPath, sourceTarget: 'src/dup/index.ts' });

    const store = new SpecStore({
      currentSpecs: [currentSpec],
      storedSpecs: [storedSpec],
      projectRoot,
      toProjectPath,
      existsFn: allExist,
    });

    const results = store.allKnownSpecs();
    expect(results).toHaveLength(1);
  });

  // ============================================================
  // TC-18：orphan 判断仅针对 canonical（bundle_copy 不做判断）
  // ============================================================
  it('TC-18 sourceKind=bundle_copy 的 spec 即使 sourceTarget 不存在也不进入 orphanSpecs()', () => {
    const bundleCopySpec = makeStoredSpec({
      outputPath: 'specs/bundles/copy.spec.md',
      specPath: 'specs/bundles/copy.spec.md',
      sourceTarget: 'src/foo/index.ts',
      sourceKind: 'bundle_copy',
    });

    const store = new SpecStore({
      currentSpecs: [],
      storedSpecs: [bundleCopySpec],
      projectRoot,
      toProjectPath,
      existsFn: noneExist,  // 所有文件都"不存在"
    });

    // bundle_copy 不做 orphan 判断，所以 orphanSpecs 为空
    expect(store.orphanSpecs()).toHaveLength(0);
  });
});
