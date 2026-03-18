/**
 * batch-orchestrator 单元测试
 * 验证多语言编排核心功能：图合并、跨语言检测、跨语言提示、断点恢复（T066-T075）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  mergeGraphsForTopologicalSort,
  detectCrossLanguageRefs,
  generateCrossLanguageHint,
} from '../../src/batch/batch-orchestrator.js';
import { loadCheckpoint, saveCheckpoint, clearCheckpoint } from '../../src/batch/checkpoint.js';
import { groupFilesByLanguage } from '../../src/batch/language-grouper.js';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import type { DependencyGraph, DependencyEdge } from '../../src/models/dependency-graph.js';
import type { BatchState } from '../../src/models/module-spec.js';

const MULTILANG_FIXTURE = path.resolve(__dirname, '../fixtures/multilang-project');
const TS_FIXTURE = path.resolve(__dirname, '../fixtures/multilang/typescript');

/** 创建最小化 DependencyGraph */
function createGraph(
  modules: { source: string; language?: string }[],
  edges: DependencyEdge[] = [],
  projectRoot = '/test',
): DependencyGraph {
  return {
    projectRoot,
    modules: modules.map((m) => ({
      source: m.source,
      isOrphan: false,
      inDegree: edges.filter((e) => e.to === m.source).length,
      outDegree: edges.filter((e) => e.from === m.source).length,
      level: 0,
      language: m.language,
    })),
    edges,
    topologicalOrder: modules.map((m) => m.source),
    sccs: [],
    totalModules: modules.length,
    totalEdges: edges.length,
    analyzedAt: new Date().toISOString(),
    mermaidSource: 'graph TD',
  };
}

describe('batch-orchestrator 单元测试', () => {
  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  // ------------------------------------------------------------------
  // T066: 多语言项目正确触发语言分组和分组依赖图构建
  // ------------------------------------------------------------------
  it('T066: 多语言项目扫描后 languageStats 包含多种语言，groupFilesByLanguage 正确分组', () => {
    const result = scanFiles(MULTILANG_FIXTURE, { projectRoot: MULTILANG_FIXTURE });

    expect(result.languageStats).toBeDefined();
    expect(result.languageStats!.size).toBeGreaterThanOrEqual(2);

    // 使用 groupFilesByLanguage 分组
    const langResult = groupFilesByLanguage(result.files);
    expect(langResult.groups.length).toBeGreaterThanOrEqual(2);

    // 每个分组的 files 非空
    for (const group of langResult.groups) {
      expect(group.files.length).toBeGreaterThan(0);
      expect(group.adapterId).toBeTruthy();
      expect(group.languageName).toBeTruthy();
    }
  });

  // ------------------------------------------------------------------
  // T067: 纯 TypeScript 项目行为与增强前完全一致（向后兼容回归）
  // ------------------------------------------------------------------
  it('T067: 纯 TypeScript 项目仅检测到单一语言，不触发多语言路径', () => {
    const result = scanFiles(TS_FIXTURE, { projectRoot: TS_FIXTURE });

    expect(result.languageStats).toBeDefined();
    const langIds = Array.from(result.languageStats!.keys());

    // 仅一种语言
    expect(langIds).toHaveLength(1);
    expect(langIds[0]).toBe('ts-js');

    // isMultiLang 判定为 false
    const isMultiLang = langIds.length >= 2;
    expect(isMultiLang).toBe(false);
  });

  // ------------------------------------------------------------------
  // T068: languages 过滤参数仅处理 TS 模块
  // ------------------------------------------------------------------
  it('T068: languages 过滤仅保留指定语言，Python/Go 被跳过', () => {
    const result = scanFiles(MULTILANG_FIXTURE, { projectRoot: MULTILANG_FIXTURE });
    const langResult = groupFilesByLanguage(result.files, ['ts-js']);

    // 仅保留 ts-js 组
    expect(langResult.groups).toHaveLength(1);
    expect(langResult.groups[0]!.adapterId).toBe('ts-js');

    // 无警告
    expect(langResult.warnings).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // T069: languages 参数指定不存在的语言时返回友好警告
  // ------------------------------------------------------------------
  it('T069: 不存在的语言过滤产生警告', () => {
    const result = scanFiles(MULTILANG_FIXTURE, { projectRoot: MULTILANG_FIXTURE });
    const langResult = groupFilesByLanguage(result.files, ['rust']);

    expect(langResult.groups).toHaveLength(0);
    expect(langResult.warnings.length).toBeGreaterThan(0);
    expect(langResult.warnings[0]).toContain('rust');
  });

  // ------------------------------------------------------------------
  // T070: mergeGraphsForTopologicalSort 正确合并多个语言图
  // ------------------------------------------------------------------
  it('T070: mergeGraphsForTopologicalSort 合并多语言图的 modules/edges', () => {
    const graph1 = createGraph(
      [
        { source: 'src/api/routes.ts', language: 'ts-js' },
        { source: 'src/api/middleware.ts', language: 'ts-js' },
      ],
      [{ from: 'src/api/routes.ts', to: 'src/api/middleware.ts', type: 'import' }],
    );

    const graph2 = createGraph(
      [
        { source: 'scripts/deploy.py', language: 'python' },
        { source: 'scripts/cleanup.py', language: 'python' },
      ],
      [{ from: 'scripts/deploy.py', to: 'scripts/cleanup.py', type: 'import' }],
    );

    const graph3 = createGraph(
      [{ source: 'go-services/auth/handler.go', language: 'go' }],
    );

    const merged = mergeGraphsForTopologicalSort([graph1, graph2, graph3], '/test');

    // modules 合并
    expect(merged.modules).toHaveLength(5);
    expect(merged.totalModules).toBe(5);

    // edges 合并
    expect(merged.edges).toHaveLength(2);
    expect(merged.totalEdges).toBe(2);

    // 各语言节点均存在
    const languages = merged.modules.map((m) => m.language).filter(Boolean);
    expect(languages).toContain('ts-js');
    expect(languages).toContain('python');
    expect(languages).toContain('go');

    // SCC 合并（均为空）
    expect(merged.sccs).toHaveLength(0);

    // Mermaid 合并
    expect(merged.mermaidSource).toContain('graph TD');
  });

  // ------------------------------------------------------------------
  // T071: 断点恢复正确还原 languageGroups 和 filterLanguages
  // ------------------------------------------------------------------
  it('T071: 检查点保存和恢复 languageGroups/filterLanguages', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-orch-t071-'));
    const checkpointPath = path.join(tmpDir, 'checkpoint.json');

    try {
      const state: BatchState = {
        batchId: 'batch-t071',
        projectRoot: '/test',
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        totalModules: 5,
        processingOrder: ['src/api--ts-js', 'src/api--python', 'scripts'],
        completedModules: [
          {
            path: 'src/api--ts-js',
            specPath: 'specs/src/api--ts-js.spec.md',
            completedAt: new Date().toISOString(),
          },
        ],
        failedModules: [],
        currentModule: null,
        forceRegenerate: false,
        languageGroups: {
          'ts-js': ['src/api/routes.ts', 'src/api/middleware.ts'],
          python: ['scripts/deploy.py'],
        },
        filterLanguages: ['ts-js', 'python'],
      };

      saveCheckpoint(state, checkpointPath);
      const loaded = loadCheckpoint(checkpointPath);

      expect(loaded).not.toBeNull();
      expect(loaded!.languageGroups).toEqual(state.languageGroups);
      expect(loaded!.filterLanguages).toEqual(state.filterLanguages);
      expect(loaded!.completedModules).toHaveLength(1);
    } finally {
      clearCheckpoint(checkpointPath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ------------------------------------------------------------------
  // T072: 旧格式检查点（无 languageGroups）按单语言模式处理
  // ------------------------------------------------------------------
  it('T072: 旧格式检查点（无 languageGroups/filterLanguages）加载正常', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-orch-t072-'));
    const checkpointPath = path.join(tmpDir, 'checkpoint.json');

    try {
      // 模拟旧格式检查点（无 languageGroups 和 filterLanguages）
      const oldState = {
        batchId: 'batch-old',
        projectRoot: '/test',
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        totalModules: 3,
        processingOrder: ['src/api', 'src/services', 'src/utils'],
        completedModules: [],
        failedModules: [],
        currentModule: null,
        forceRegenerate: false,
        // 注意：无 languageGroups 和 filterLanguages
      };

      fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
      fs.writeFileSync(checkpointPath, JSON.stringify(oldState), 'utf-8');

      const loaded = loadCheckpoint(checkpointPath);

      expect(loaded).not.toBeNull();
      // 旧格式检查点 languageGroups/filterLanguages 为 undefined
      expect(loaded!.languageGroups).toBeUndefined();
      expect(loaded!.filterLanguages).toBeUndefined();
      // 其他字段正常
      expect(loaded!.batchId).toBe('batch-old');
      expect(loaded!.totalModules).toBe(3);
    } finally {
      clearCheckpoint(checkpointPath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ------------------------------------------------------------------
  // T073: 多语言项目的 generateCrossLanguageHint 包含标准化提示
  // ------------------------------------------------------------------
  it('T073: generateCrossLanguageHint 生成包含语言列表的跨语言调用提示', () => {
    const hint = generateCrossLanguageHint(['TypeScript', 'Python', 'Go']);

    // 包含语言名称
    expect(hint).toContain('TypeScript');
    expect(hint).toContain('Python');
    expect(hint).toContain('Go');

    // 包含标准化提示文本
    expect(hint).toContain('多种编程语言');
    expect(hint).toContain('跨语言调用');
    expect(hint).toContain('建议人工审查');
  });

  // ------------------------------------------------------------------
  // T074: 纯单语言项目不生成跨语言调用提示
  // ------------------------------------------------------------------
  it('T074: 单语言项目 isMultiLang=false 时不触发 crossLangHint', () => {
    const result = scanFiles(TS_FIXTURE, { projectRoot: TS_FIXTURE });
    const detectedLanguages = Array.from(result.languageStats!.keys());
    const isMultiLang = detectedLanguages.length >= 2;

    expect(isMultiLang).toBe(false);

    // 单语言时 crossLangHint 应为空字符串
    const crossLangHint = isMultiLang
      ? generateCrossLanguageHint(detectedLanguages)
      : '';
    expect(crossLangHint).toBe('');
  });

  // ------------------------------------------------------------------
  // T075: BatchResult 包含正确的 detectedLanguages 和 languageStats 类型定义
  // ------------------------------------------------------------------
  it('T075: 多语言扫描结果包含完整的语言信息用于 BatchResult', () => {
    const result = scanFiles(MULTILANG_FIXTURE, { projectRoot: MULTILANG_FIXTURE });

    const detectedLanguages = Array.from(result.languageStats!.keys());
    const languageStats = result.languageStats!;

    // detectedLanguages 为非空字符串数组
    expect(detectedLanguages.length).toBeGreaterThanOrEqual(2);
    for (const lang of detectedLanguages) {
      expect(typeof lang).toBe('string');
      expect(lang.length).toBeGreaterThan(0);
    }

    // languageStats 每条目包含完整字段
    for (const [, stat] of languageStats) {
      expect(stat.adapterId).toBeTruthy();
      expect(stat.fileCount).toBeGreaterThan(0);
      expect(stat.extensions.length).toBeGreaterThan(0);
    }
  });

  // ------------------------------------------------------------------
  // detectCrossLanguageRefs 辅助测试
  // ------------------------------------------------------------------
  describe('detectCrossLanguageRefs', () => {
    it('检测跨语言边引用', () => {
      const languageGroups = [
        { adapterId: 'ts-js', languageName: 'TypeScript', files: ['a.ts', 'b.ts'] },
        { adapterId: 'python', languageName: 'Python', files: ['c.py'] },
      ];

      const graph = createGraph(
        [
          { source: 'a.ts', language: 'ts-js' },
          { source: 'b.ts', language: 'ts-js' },
          { source: 'c.py', language: 'python' },
        ],
        [
          { from: 'a.ts', to: 'b.ts', type: 'import' },
          { from: 'a.ts', to: 'c.py', type: 'import' },
        ],
      );

      // a.ts 模块引用了 python 的 c.py
      const refs = detectCrossLanguageRefs(['a.ts', 'b.ts'], languageGroups, graph);

      expect(refs.length).toBeGreaterThan(0);
      expect(refs[0]).toContain('python');
    });

    it('同语言内引用不算跨语言', () => {
      const languageGroups = [
        { adapterId: 'ts-js', languageName: 'TypeScript', files: ['a.ts', 'b.ts'] },
      ];

      const graph = createGraph(
        [
          { source: 'a.ts', language: 'ts-js' },
          { source: 'b.ts', language: 'ts-js' },
        ],
        [{ from: 'a.ts', to: 'b.ts', type: 'import' }],
      );

      const refs = detectCrossLanguageRefs(['a.ts', 'b.ts'], languageGroups, graph);
      expect(refs).toHaveLength(0);
    });
  });
});
