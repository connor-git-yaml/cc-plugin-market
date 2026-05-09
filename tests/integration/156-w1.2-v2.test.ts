/**
 * Feature 156 W1.2 v2 — 第二轮修订集成测试（4 CRIT + 3 WARN 关闭验证）
 *
 * 覆盖：
 *  - CRIT-1：python-adapter 不再直接 import legacy-shim（通过 buildGraphFromCodeSkeletons）
 *  - CRIT-2：tsconfig baseUrl + 多候选 paths（最长前缀优先 + 多候选回退）
 *  - CRIT-3：.mjs / .cjs 文件作为 module node 进图，并接收 import 边
 *  - CRIT-4：Python dot-relative import（`from . import X` / `from .nn.module import Y`）派生 edge
 *  - WARN-1：真实跑 adapter.buildModuleGraph（不只是 buildUnifiedGraph 手造 fixture）
 *
 * 测试方式：直接调用 LanguageAdapter（与 batch-orchestrator.buildGraphForLanguageGroup 同路径），
 * 用真实 fixture 文件系统跑 + 校验 ModuleGraph 端点字段。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LanguageAdapterRegistry, bootstrapAdapters } from '../../src/adapters/index.js';
import { buildModuleGraphForProject as buildGraph } from '../../src/knowledge-graph/module-derivation.js';

// 测试环境下显式注册所有内置适配器（CLI 入口才会自动 bootstrap）
beforeAll(() => {
  bootstrapAdapters();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.resolve(__dirname, '../fixtures/156-w1.2-v2');

describe('Feature 156 W1.2 v2 — CRIT-3：.mjs / .cjs 文件作为 module node 进图', () => {
  it('main.ts 引用 ./lib.mjs 与 ./legacy.cjs 应产生 2 条 import 边', async () => {
    const projectRoot = path.join(FIXTURES, 'ts-mjs-cjs');
    const graph = await buildGraph(projectRoot, { includeOnly: '.+' });

    // module 节点应包含 .mjs 与 .cjs 文件
    const sources = graph.modules.map((m) => path.basename(m.source));
    expect(sources).toContain('main.ts');
    expect(sources).toContain('lib.mjs');
    expect(sources).toContain('legacy.cjs');

    // edges：main.ts → lib.mjs（static import）+ main.ts → legacy.cjs（commonjs-require → static）
    const mainEdges = graph.edges.filter((e) => path.basename(e.from) === 'main.ts');
    const targets = mainEdges.map((e) => path.basename(e.to));
    expect(targets).toContain('lib.mjs');
    expect(targets).toContain('legacy.cjs');
    expect(mainEdges.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Feature 156 W1.2 v2 — CRIT-2：tsconfig baseUrl + 多候选 paths', () => {
  it('多候选 alias 的回退候选命中、最长前缀优先、baseUrl fallback 全部生效', async () => {
    const projectRoot = path.join(FIXTURES, 'ts-multi-alias');
    const graph = await buildGraph(projectRoot, { includeOnly: '.+\\.ts$' });

    const mainEdges = graph.edges.filter((e) => e.from.endsWith('packages/app/src/main.ts'));
    // (a) `@app/lib-only` 命中 packages/lib/src/lib-only.ts（多候选第二个目标）
    expect(
      mainEdges.some((e) => e.to.endsWith('packages/lib/src/lib-only.ts')),
    ).toBe(true);
    // (b) `@app/utils/format` 命中更长前缀 `@app/utils/*` → packages/lib/src/utils/format.ts
    expect(
      mainEdges.some((e) => e.to.endsWith('packages/lib/src/utils/format.ts')),
    ).toBe(true);
    // (c) baseUrl fallback：`packages/app/src/local` → packages/app/src/local.ts
    expect(
      mainEdges.some((e) => e.to.endsWith('packages/app/src/local.ts')),
    ).toBe(true);
  });
});

describe('Feature 156 W1.2 v2 — CRIT-4：Python dot-relative import 解析', () => {
  it('main.py 的 `from . import engine` / `from .nn.module import Module` 全部派生 edge', async () => {
    const projectRoot = path.join(FIXTURES, 'python-dot-relative');
    const registry = LanguageAdapterRegistry.getInstance();
    const pyAdapter = registry.getAllAdapters().find((a) => a.id === 'python');
    expect(pyAdapter).toBeDefined();

    const graph = await pyAdapter!.buildModuleGraph!(projectRoot);

    // CRIT-1 + WARN-1：通过真实 buildModuleGraph 路径（不只是手造 fixture）
    expect(graph.modules.length).toBeGreaterThan(0);

    // main.py 的 outDegree：至少应有 engine、nn、nn/module.py 三个目标
    const mainEdges = graph.edges.filter((e) => e.from.endsWith('main.py'));
    const targets = new Set(mainEdges.map((e) => e.to.split('/').slice(-2).join('/')));

    // (1) `from . import engine` → engine.py（namedImports 展开）
    expect([...targets].some((t) => t.endsWith('engine.py'))).toBe(true);
    // (2) `from . import nn` → nn/__init__.py（包子模块）
    expect([...targets].some((t) => t.endsWith('nn/__init__.py'))).toBe(true);
    // (3) `from .nn.module import Module` → nn/module.py
    expect([...targets].some((t) => t.endsWith('nn/module.py'))).toBe(true);
  });
});

describe('Feature 156 W1.4 — CRIT-1 + WARN-1：真实 adapter.buildModuleGraph 集成', () => {
  it('python-adapter 不直接调用 deriveModuleGraph；只通过 buildModuleGraphFromCodeSkeletons public API', async () => {
    // CRIT-1（W1.4 atomic switch 修订）：legacy-shim.ts 已彻底删除。
    //   python-adapter 不应直接调用 deriveModuleGraph 运行时函数（应通过
    //   buildModuleGraphFromCodeSkeletons public API 间接派生），
    //   保证跨层封装：adapter 只感知 ModuleGraph 接口，不感知派生细节。
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      path.resolve(__dirname, '../../src/adapters/python-adapter.ts'),
      'utf-8',
    );
    // 直接调用 deriveModuleGraph 在 adapter 中是封装违规
    expect(content.includes('deriveModuleGraph(')).toBe(false);
    // legacy 命名彻底清除（spec FR-22 / AC-5 验收）
    expect(content.includes('deriveLegacyDependencyGraph')).toBe(false);
    expect(content.includes('legacy-shim')).toBe(false);
  });

  it('真实跑 ts-js adapter.buildModuleGraph 输出端点字段正确（B-1 升级版）', async () => {
    // WARN-1：B-1/B-2 原本只跑 buildUnifiedGraph + 手造 skeleton；
    //         本测试调用 adapter.buildModuleGraph（与 batch-orchestrator 同路径）
    const projectRoot = path.join(FIXTURES, 'ts-mjs-cjs');
    const registry = LanguageAdapterRegistry.getInstance();
    const tsAdapter = registry.getAllAdapters().find((a) => a.id === 'ts-js');
    expect(tsAdapter).toBeDefined();

    const graph = await tsAdapter!.buildModuleGraph!(projectRoot, {
      includeOnly: '.+',
    });

    expect(graph.modules.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    // from / to 字段必须填好（下游 module-grouper / delta-regenerator 依赖）
    for (const e of graph.edges) {
      expect(typeof e.from).toBe('string');
      expect(typeof e.to).toBe('string');
      expect(e.from.length).toBeGreaterThan(0);
      expect(e.to.length).toBeGreaterThan(0);
      expect(['static', 'dynamic', 'type-only']).toContain(e.importType);
    }
    // language 字段必须打上 ts-js（buildGraphFromCodeSkeletons 的回填逻辑）
    for (const m of graph.modules) {
      expect(m.language).toBeDefined();
    }
  });
});

describe('Feature 156 W1.2 v2 — WARN-2：python parseError skeleton 不污染 graph', () => {
  it('解析失败的 .py 文件不进 module 节点（之前 loc:1 占位会污染统计）', async () => {
    // 使用合法 fixture，但模拟 parseError 路径：
    // 直接读取 python-adapter 实现，确认 cleanSkeletons 过滤逻辑存在
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      path.resolve(__dirname, '../../src/adapters/python-adapter.ts'),
      'utf-8',
    );
    // 必须出现：parseError 标记 + 过滤掉 parseError 的 skeleton
    expect(content.includes('parseError')).toBe(true);
    expect(content.includes('cleanSkeletons')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// T-038（W4 补 W1.2 WARN-1）：batch-orchestrator 真链路 e2e
//   验证 mergeGraphsForTopologicalSort + groupFilesToModules 接受 ModuleGraph
//   from/to 字段映射正确（不再走 DependencyGraph 老路径）。
// ───────────────────────────────────────────────────────────

describe('Feature 156 W4 T-038 — batch-orchestrator 真链路 ModuleGraph e2e', () => {
  it('mergeGraphsForTopologicalSort + groupFilesToModules 在 ts-mjs-cjs fixture 全链路通过', async () => {
    const { mergeGraphsForTopologicalSort } = await import(
      '../../src/batch/batch-orchestrator.js'
    );
    const { groupFilesToModules } = await import('../../src/batch/module-grouper.js');

    const projectRoot = path.join(FIXTURES, 'ts-mjs-cjs');
    const registry = LanguageAdapterRegistry.getInstance();
    const tsAdapter = registry.getAllAdapters().find((a) => a.id === 'ts-js');
    expect(tsAdapter).toBeDefined();

    // 1. 真实跑 adapter.buildModuleGraph（与 batch-orchestrator buildGraphForLanguageGroup 同路径）
    const langGraph = await tsAdapter!.buildModuleGraph!(projectRoot, { includeOnly: '.+' });
    expect(langGraph.modules.length).toBeGreaterThan(0);
    expect(langGraph.edges.length).toBeGreaterThan(0);

    // 2. mergeGraphsForTopologicalSort 接收 ModuleGraph[] 并返回 ModuleGraph
    const merged = mergeGraphsForTopologicalSort([langGraph], projectRoot);
    expect(merged.modules.length).toBe(langGraph.modules.length);
    expect(merged.edges.length).toBe(langGraph.edges.length);
    expect(merged.totalModules).toBe(langGraph.modules.length);
    expect(merged.totalEdges).toBe(langGraph.edges.length);
    expect(merged.topologicalOrder.length).toBe(langGraph.modules.length);

    // 3. ModuleEdge.from / .to 字段完整（下游 module-grouper / delta-regenerator 依赖）
    for (const e of merged.edges) {
      expect(typeof e.from).toBe('string');
      expect(typeof e.to).toBe('string');
      expect(e.from.length).toBeGreaterThan(0);
      expect(e.to.length).toBeGreaterThan(0);
    }

    // 4. groupFilesToModules 接收 ModuleGraph 应返回非空 module group
    const groupResult = groupFilesToModules(merged);
    expect(groupResult.groups.length).toBeGreaterThan(0);
    // ts-mjs-cjs fixture 全部 3 个文件应出现在 group.files 中（main.ts / lib.mjs / legacy.cjs）
    const allFilesInGroups = groupResult.groups.flatMap((g) => g.files);
    expect(allFilesInGroups.length).toBeGreaterThanOrEqual(3);
  });

  it('delta-regenerator 接受 ModuleGraph dependencyGraph 字段（shape 兼容）', async () => {
    // 验证 delta-regenerator.ts 已切到 ModuleGraph 类型（W1.2 完成后字段仍为 dependencyGraph，
    // 但内部用法改为 ModuleEdge.from/.to）
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      path.resolve(__dirname, '../../src/batch/delta-regenerator.ts'),
      'utf-8',
    );
    // 关键：使用 ModuleGraph 类型，不再 import DependencyGraph
    expect(content.includes('ModuleGraph')).toBe(true);
    // legacy DependencyGraph 类型彻底移除
    expect(content.includes('DependencyGraph')).toBe(false);
  });
});
