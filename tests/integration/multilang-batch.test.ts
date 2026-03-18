/**
 * 多语言混合项目集成测试
 * 验证多语言支持的完整流程（Feature 031）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { groupFilesByLanguage } from '../../src/batch/language-grouper.js';
import { groupFilesToModules } from '../../src/batch/module-grouper.js';
import { buildDirectoryGraph } from '../../src/graph/directory-graph.js';
import { generateIndex } from '../../src/generator/index-generator.js';
import { mergeGraphsForTopologicalSort } from '../../src/batch/batch-orchestrator.js';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from '../../src/batch/checkpoint.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import type { DependencyGraph } from '../../src/models/dependency-graph.js';
import type { BatchState } from '../../src/models/module-spec.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/multilang-project');

describe('多语言混合项目集成', () => {
  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('T095/SC-001: 多语言项目扫描检测到多种语言', () => {
    const result = scanFiles(FIXTURE_DIR, { projectRoot: FIXTURE_DIR });

    expect(result.languageStats).toBeDefined();
    const langIds = Array.from(result.languageStats!.keys());

    // 应检测到 ts-js、python、go
    expect(langIds).toContain('ts-js');
    expect(langIds).toContain('python');
    expect(langIds).toContain('go');
  });

  it('T096/SC-003: 纯 TypeScript fixture 的 scanFiles 行为向后兼容', () => {
    const tsFixture = path.resolve(__dirname, '../fixtures/multilang/typescript');
    const result = scanFiles(tsFixture, { projectRoot: tsFixture });

    // files 返回类型仍为 string[]
    expect(Array.isArray(result.files)).toBe(true);
    // languageStats 仅一个条目
    if (result.languageStats) {
      expect(result.languageStats.size).toBe(1);
      expect(result.languageStats.has('ts-js')).toBe(true);
    }
  });

  it('T097/SC-002: 架构索引的语言分布统计准确', () => {
    const result = scanFiles(FIXTURE_DIR, { projectRoot: FIXTURE_DIR });
    const languageStats = result.languageStats!;

    // 创建空的 graph 和 specs 用于索引生成
    const graph: DependencyGraph = {
      projectRoot: FIXTURE_DIR,
      modules: [],
      edges: [],
      topologicalOrder: [],
      sccs: [],
      totalModules: 0,
      totalEdges: 0,
      analyzedAt: new Date().toISOString(),
      mermaidSource: 'graph TD',
    };

    const index = generateIndex([], graph, languageStats);

    expect(index.languageDistribution).toBeDefined();
    expect(index.languageDistribution!.length).toBeGreaterThanOrEqual(2);

    // 所有条目的 fileCount 应 > 0
    for (const dist of index.languageDistribution!) {
      expect(dist.fileCount).toBeGreaterThan(0);
    }

    // percentage 之和约 100%
    const total = index.languageDistribution!.reduce((s, d) => s + d.percentage, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });

  it('T098/SC-005: languages 过滤仅保留指定语言', () => {
    const result = scanFiles(FIXTURE_DIR, { projectRoot: FIXTURE_DIR });
    const langResult = groupFilesByLanguage(result.files, ['ts-js']);

    expect(langResult.groups).toHaveLength(1);
    expect(langResult.groups[0]!.adapterId).toBe('ts-js');

    // 所有文件都是 .ts/.tsx
    for (const file of langResult.groups[0]!.files) {
      expect(file).toMatch(/\.(ts|tsx|js|jsx)$/);
    }
  });

  it('T099/SC-007: 混合语言目录被正确拆分为双连字符子模块', () => {
    const result = scanFiles(FIXTURE_DIR, { projectRoot: FIXTURE_DIR });

    // 构建简单图用于分组
    const graph: DependencyGraph = {
      projectRoot: FIXTURE_DIR,
      modules: result.files.map((f) => ({
        source: f,
        isOrphan: true,
        inDegree: 0,
        outDegree: 0,
        level: 0,
      })),
      edges: [],
      topologicalOrder: [],
      sccs: [],
      totalModules: result.files.length,
      totalEdges: 0,
      analyzedAt: new Date().toISOString(),
      mermaidSource: '',
    };

    // 使用 basePrefix='' 分组（fixture 文件分布在 src/、scripts/、go-services/ 等多个顶级目录）
    const groupResult = groupFilesToModules(graph, { languageAware: true });

    // src 目录下有 .ts, .py, .go 三种语言，应拆分为双连字符子模块
    const srcGroups = groupResult.groups
      .filter((g) => g.name.startsWith('src'))
      .map((g) => g.name)
      .sort();

    // 至少包含两种语言的 src 子模块
    expect(srcGroups.length).toBeGreaterThanOrEqual(2);

    // 验证双连字符命名格式
    const multiLangNames = srcGroups.filter((n) => n.includes('--'));
    expect(multiLangNames.length).toBeGreaterThanOrEqual(2);

    // 验证每个子模块有正确的 language 设置
    for (const group of groupResult.groups) {
      if (group.name.includes('--')) {
        expect(group.language).toBeDefined();
      }
    }
  });

  it('T100/SC-004: 不支持的语言文件触发包含语言名称的警告', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    scanFiles(FIXTURE_DIR, { projectRoot: FIXTURE_DIR });

    // 应有警告（.rs 和 .cpp 不支持）
    expect(warnSpy).toHaveBeenCalled();
    const warns = warnSpy.mock.calls.map((c) => c[0] as string);
    const warnText = warns.join(' ');
    expect(warnText).toContain('Rust');
    expect(warnText).toContain('C++');

    warnSpy.mockRestore();
  });

  it('T101/SC-006: 语言检测结果与实际文件匹配', () => {
    const result = scanFiles(FIXTURE_DIR, { projectRoot: FIXTURE_DIR });
    const languageStats = result.languageStats!;
    const detectedLanguages = Array.from(languageStats.keys());

    // 每个检测到的语言都有对应的文件
    for (const lang of detectedLanguages) {
      const stat = languageStats.get(lang)!;
      expect(stat.fileCount).toBeGreaterThan(0);
      expect(stat.extensions.length).toBeGreaterThan(0);
    }

    // 文件总数应等于各语言文件数之和
    const totalFromStats = Array.from(languageStats.values())
      .reduce((s, stat) => s + stat.fileCount, 0);
    expect(totalFromStats).toBe(result.files.length);
  });

  it('mergeGraphsForTopologicalSort 正确合并多个语言图', () => {
    const graph1: DependencyGraph = {
      projectRoot: '/test',
      modules: [
        { source: 'a.ts', isOrphan: false, inDegree: 0, outDegree: 1, level: 0, language: 'ts-js' },
      ],
      edges: [],
      topologicalOrder: ['a.ts'],
      sccs: [],
      totalModules: 1,
      totalEdges: 0,
      analyzedAt: new Date().toISOString(),
      mermaidSource: 'graph TD\n  a',
    };

    const graph2: DependencyGraph = {
      projectRoot: '/test',
      modules: [
        { source: 'b.py', isOrphan: false, inDegree: 0, outDegree: 0, level: 0, language: 'python' },
      ],
      edges: [],
      topologicalOrder: ['b.py'],
      sccs: [],
      totalModules: 1,
      totalEdges: 0,
      analyzedAt: new Date().toISOString(),
      mermaidSource: 'graph TD\n  b',
    };

    const merged = mergeGraphsForTopologicalSort([graph1, graph2], '/test');

    expect(merged.modules).toHaveLength(2);
    expect(merged.totalModules).toBe(2);
    expect(merged.modules.map((m) => m.source).sort()).toEqual(['a.ts', 'b.py']);
  });

  // ────────────────────────────────────────────────────────────
  // T102/FR-013: 多语言批量断点恢复
  // ────────────────────────────────────────────────────────────
  it('T102: 多语言批量中断后恢复正确还原状态', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multilang-resume-'));
    const checkpointPath = path.join(tmpDir, 'checkpoint.json');

    try {
      // 模拟多语言批量处理进行到一半时保存检查点
      const result = scanFiles(FIXTURE_DIR, { projectRoot: FIXTURE_DIR });
      const langResult = groupFilesByLanguage(result.files);

      const languageGroupsRecord: Record<string, string[]> = {};
      for (const group of langResult.groups) {
        languageGroupsRecord[group.adapterId] = group.files;
      }

      const state: BatchState = {
        batchId: `batch-${Date.now()}`,
        projectRoot: FIXTURE_DIR,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        totalModules: 6,
        processingOrder: [
          'src/api--ts-js',
          'src/services--ts-js',
          'src/services--python',
          'src/services--go',
          'scripts--python',
          'go-services/auth--go',
        ],
        completedModules: [
          {
            path: 'src/api--ts-js',
            specPath: 'specs/src/api--ts-js.spec.md',
            completedAt: new Date().toISOString(),
          },
          {
            path: 'src/services--ts-js',
            specPath: 'specs/src/services--ts-js.spec.md',
            completedAt: new Date().toISOString(),
          },
        ],
        failedModules: [],
        currentModule: null,
        forceRegenerate: false,
        languageGroups: languageGroupsRecord,
        filterLanguages: undefined,
      };

      // 保存检查点
      saveCheckpoint(state, checkpointPath);

      // 模拟恢复
      const loaded = loadCheckpoint(checkpointPath);

      expect(loaded).not.toBeNull();
      // 验证多语言扩展字段
      expect(loaded!.languageGroups).toBeDefined();
      expect(Object.keys(loaded!.languageGroups!).length).toBeGreaterThanOrEqual(2);

      // 验证已完成模块正确
      expect(loaded!.completedModules).toHaveLength(2);
      const completedPaths = new Set(loaded!.completedModules.map((m) => m.path));
      expect(completedPaths.has('src/api--ts-js')).toBe(true);
      expect(completedPaths.has('src/services--ts-js')).toBe(true);

      // 验证未完成模块可继续处理
      const remaining = loaded!.processingOrder.filter((m) => !completedPaths.has(m));
      expect(remaining.length).toBe(4);
      expect(remaining).toContain('src/services--python');
      expect(remaining).toContain('go-services/auth--go');
    } finally {
      clearCheckpoint(checkpointPath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
