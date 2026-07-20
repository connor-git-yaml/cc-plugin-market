/**
 * batch-orchestrator 单元测试
 * 验证多语言编排核心功能：图合并、跨语言检测、跨语言提示、断点恢复（T066-T075）
 * Feature 145 T016-T017：designDocAbsPaths 磁盘优先合并策略
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// F217 T029：runBatch 早期 UnifiedGraph 段集成测试需要跑真实文件 I/O 但不触发 LLM 调用——
// 复用 tests/integration/batch-paths.test.ts 已确立的 detectAuth mock 模式，强制 AST-only 降级。
vi.mock('../../src/auth/auth-detector.js', () => ({
  detectAuth: vi.fn(() => ({
    methods: [
      { type: 'api-key', provider: 'anthropic', available: false, details: '未设置' },
      { type: 'cli-proxy', provider: 'codex', available: false, details: '测试中禁用' },
      { type: 'cli-proxy', provider: 'claude', available: false, details: '测试中禁用' },
    ],
    preferred: null,
    diagnostics: ['unit test forces AST-only fallback'],
  })),
}));

import {
  mergeGraphsForTopologicalSort,
  detectCrossLanguageRefs,
  generateCrossLanguageHint,
  buildDesignDocAbsPaths,
  runBatch,
} from '../../src/batch/batch-orchestrator.js';
import { loadCheckpoint, saveCheckpoint, clearCheckpoint } from '../../src/batch/checkpoint.js';
import { groupFilesByLanguage } from '../../src/batch/language-grouper.js';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { resolveSourceCommit } from '../../src/panoramic/graph/source-commit.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import type { ModuleGraph, ModuleEdge } from '../../src/knowledge-graph/module-derivation.js';
import type { BatchState } from '../../src/models/module-spec.js';

const MULTILANG_FIXTURE = path.resolve(__dirname, '../fixtures/multilang-project');
const TS_FIXTURE = path.resolve(__dirname, '../fixtures/multilang/typescript');

/** 创建最小化 ModuleGraph */
function createGraph(
  modules: { source: string; language?: string }[],
  edges: ModuleEdge[] = [],
  projectRoot = '/test',
): ModuleGraph {
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

  // H2 修复：并发调度器在 pending 为空时不应死锁
  describe('H2: 并发调度器 pending 空数组不死锁', () => {
    it('模拟并发调度：pending 空时能正确退出 while 循环', async () => {
      // 复现 H2 的修复逻辑：while (activeCount >= concurrency) 循环内
      // 若 pending 为空，必须 break，否则 Promise.race([]) 永不 resolve
      const concurrency = 3;
      const results: number[] = [];

      // 模拟并发调度器的核心逻辑（提取自 batch-orchestrator）
      async function simulateConcurrentScheduler(items: number[]): Promise<void> {
        const pending: Promise<void>[] = [];
        let activeCount = 0;

        for (const item of items) {
          while (activeCount >= concurrency) {
            // H2 修复的关键守卫：pending 为空时 break，避免 Promise.race([]) 死锁
            if (pending.length === 0) break;
            await Promise.race(pending);
          }

          activeCount++;
          const task = (async () => {
            await Promise.resolve(); // 模拟异步工作
            results.push(item);
          })().finally(() => {
            activeCount--;
            const idx = pending.indexOf(task);
            if (idx >= 0) pending.splice(idx, 1);
          });
          pending.push(task);
        }

        await Promise.allSettled(pending);
      }

      // 添加超时保护：如果死锁，测试会因超时失败
      await Promise.race([
        simulateConcurrentScheduler([1, 2, 3, 4, 5]),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('死锁：并发调度器未在 1s 内完成')), 1000),
        ),
      ]);

      // 验证所有 items 都被处理
      expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it('concurrency > modules 数量时也能正确完成（activeCount 始终 < concurrency）', async () => {
      // 仅 2 个模块，concurrency = 5，activeCount 永远不会达到 concurrency
      // 修复前：while 循环条件永不为真，不会死锁；但验证修复不引入回归
      const concurrency = 5;
      const results: number[] = [];

      const pending: Promise<void>[] = [];
      let activeCount = 0;

      for (const item of [10, 20]) {
        while (activeCount >= concurrency) {
          if (pending.length === 0) break;
          await Promise.race(pending);
        }

        activeCount++;
        const task = (async () => {
          await Promise.resolve();
          results.push(item);
        })().finally(() => {
          activeCount--;
          const idx = pending.indexOf(task);
          if (idx >= 0) pending.splice(idx, 1);
        });
        pending.push(task);
      }

      await Promise.allSettled(pending);
      expect(results.sort((a, b) => a - b)).toEqual([10, 20]);
    });
  });
});

// ============================================================
// Feature 145 T016-T017：buildDesignDocAbsPaths 磁盘优先合并策略
// ============================================================

describe('buildDesignDocAbsPaths (Feature 145 P1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-p1-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // T016：writtenFiles=[] 但 outputDir/project/ 下有 .md 文件 → designDocAbsPaths 非空
  it('T016: writtenFiles 为空但 outputDir/project/ 有 .md 文件 → designDocAbsPaths 包含磁盘文件', () => {
    // 在 tmpDir 下创建 outputDir/project/ 目录和两个 .md 文件
    const outputDir = path.join(tmpDir, 'output');
    const projectDir = path.join(outputDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'spec1.md'), '# spec1', 'utf-8');
    fs.writeFileSync(path.join(projectDir, 'spec2.md'), '# spec2', 'utf-8');

    const projectRoot = path.join(tmpDir, 'project-root');
    fs.mkdirSync(projectRoot, { recursive: true });

    // writtenFiles 为空（模拟 generateBatchProjectDocs 未返回任何文件）
    const { paths, fromDocsCount, fromDiskCount } = buildDesignDocAbsPaths(
      [],
      projectRoot,
      outputDir,
    );

    // 应从磁盘扫描到 2 个 .md 文件
    expect(paths.length).toBe(2);
    expect(fromDocsCount).toBe(0);
    expect(fromDiskCount).toBe(2);
    // hyperedge 集成不应被跳过（designDocAbsPaths.length > 0）
  });

  // T017：outputDir/project/ 不存在 → designDocAbsPaths 为空但不抛出异常
  it('T017: outputDir/project/ 目录不存在 → designDocAbsPaths 为空，不抛异常', () => {
    const outputDir = path.join(tmpDir, 'nonexistent-output');
    const projectRoot = path.join(tmpDir, 'project-root');
    fs.mkdirSync(projectRoot, { recursive: true });

    // 断言不抛异常
    expect(() => {
      const { paths } = buildDesignDocAbsPaths([], projectRoot, outputDir);
      expect(paths).toHaveLength(0);
    }).not.toThrow();
  });
});

// ============================================================
// F217 T029: runBatch 早期 UnifiedGraph 段 — generic collector 接入 + sourceCommit 注入
// ============================================================

describe('runBatch — F217 T029: generic collector 接入 + sourceCommit 注入', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-orchestrator-f217-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
  });

  function readGraph(dir: string): GraphJSON {
    return JSON.parse(
      fs.readFileSync(path.join(dir, 'specs', '_meta', 'graph.json'), 'utf-8'),
    ) as GraphJSON;
  }

  it('接入 collectGenericLanguageCodeSkeletons：Java/Go 节点进入 runBatch 主写盘产物，且 sourceCommit 已注入', async () => {
    fs.mkdirSync(path.join(projectRoot, 'src', 'main', 'java', 'com', 'acme'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'main', 'java', 'com', 'acme', 'Widget.java'),
      'package com.acme;\n\npublic class Widget {\n    public String name() {\n        return "widget";\n    }\n}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'server.go'),
      'package server\n\nfunc NewServer() *Server {\n\treturn &Server{}\n}\n\ntype Server struct {}\n',
      'utf-8',
    );

    const result = await runBatch(projectRoot, { force: false });
    expect(result.failed).toHaveLength(0);

    const graph = readGraph(projectRoot);
    expect(graph.nodes.some((n) => n.id.endsWith('Widget.java'))).toBe(true);
    expect(graph.nodes.some((n) => n.id.endsWith('server.go'))).toBe(true);

    // 非 git 临时目录 → resolveSourceCommit 应为 null，与写盘产物一致
    expect(graph.graph.sourceCommit).toBe(resolveSourceCommit(projectRoot));
    expect(graph.graph.sourceCommit).toBeNull();
  }, 30_000);
});
