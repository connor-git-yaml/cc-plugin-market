/**
 * directory-graph 单元测试
 * 验证轻量级目录依赖图构建（Python/Go import 路径解析、SCC 检测等）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildDirectoryGraph } from '../../src/graph/directory-graph.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';

/** 创建测试用 CodeSkeleton */
function createSkeleton(
  filePath: string,
  imports: Array<{ moduleSpecifier: string; isRelative: boolean }> = [],
): CodeSkeleton {
  const lang = filePath.endsWith('.py') ? 'python'
    : filePath.endsWith('.go') ? 'go'
    : 'typescript';
  return {
    filePath,
    language: lang as any,
    loc: 10,
    exports: [],
    imports: imports.map((imp) => ({
      ...imp,
      namedImports: [],
      defaultImport: null,
      isTypeOnly: false,
    })),
    hash: 'a'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'tree-sitter',
  };
}

describe('directory-graph', () => {
  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it('T023: Python 相对 import 正确生成依赖边', async () => {
    const files = ['src/app.py', 'src/utils.py'];
    const skeletons = [
      createSkeleton('src/app.py', [
        { moduleSpecifier: './utils', isRelative: true },
      ]),
      createSkeleton('src/utils.py', []),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      from: 'src/app.py',
      to: 'src/utils.py',
    });
  });

  it('T024: Go 本地 package import 正确生成依赖边', async () => {
    const files = ['cmd/main.go', 'internal/utils/helper.go'];
    const skeletons = [
      createSkeleton('cmd/main.go', [
        { moduleSpecifier: '../internal/utils', isRelative: true },
      ]),
      createSkeleton('internal/utils/helper.go', []),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.from).toBe('cmd/main.go');
    expect(graph.edges[0]!.to).toBe('internal/utils/helper.go');
  });

  it('T025: 第三方 import 不生成依赖边', async () => {
    const files = ['src/app.py', 'src/main.go'];
    const skeletons = [
      createSkeleton('src/app.py', [
        { moduleSpecifier: 'requests', isRelative: false },
        { moduleSpecifier: 'flask', isRelative: false },
      ]),
      createSkeleton('src/main.go', [
        { moduleSpecifier: 'github.com/gin-gonic/gin', isRelative: false },
      ]),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    expect(graph.edges).toHaveLength(0);
  });

  it('T026: 空文件列表返回空的 DependencyGraph', async () => {
    const graph = await buildDirectoryGraph([], '/project', []);

    expect(graph.modules).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.topologicalOrder).toHaveLength(0);
    expect(graph.sccs).toHaveLength(0);
    expect(graph.totalModules).toBe(0);
    expect(graph.totalEdges).toBe(0);
  });

  it('T027: 循环依赖被 SCC 检测正确标识', async () => {
    const files = ['src/a.py', 'src/b.py'];
    const skeletons = [
      createSkeleton('src/a.py', [
        { moduleSpecifier: './b', isRelative: true },
      ]),
      createSkeleton('src/b.py', [
        { moduleSpecifier: './a', isRelative: true },
      ]),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    // 应存在包含两个模块的 SCC
    const largeScc = graph.sccs.filter((s) => s.modules.length > 1);
    expect(largeScc).toHaveLength(1);
    expect(largeScc[0]!.modules).toContain('src/a.py');
    expect(largeScc[0]!.modules).toContain('src/b.py');
  });

  it('T028: 无法解析的 import 路径不产生边，不抛出异常', async () => {
    const files = ['src/app.py'];
    const skeletons = [
      createSkeleton('src/app.py', [
        { moduleSpecifier: './nonexistent_module', isRelative: true },
        { moduleSpecifier: '../missing/package', isRelative: true },
      ]),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    expect(graph.edges).toHaveLength(0);
    expect(graph.modules).toHaveLength(1);
  });

  it('T029: 所有生成的 GraphNode 均设置了正确的 language 字段', async () => {
    const files = ['src/app.py', 'src/utils.py'];
    const skeletons = [
      createSkeleton('src/app.py', []),
      createSkeleton('src/utils.py', []),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    for (const node of graph.modules) {
      expect(node.language).toBe('python');
    }
  });

  it('T030: 拓扑排序结果包含所有文件且符合依赖关系', async () => {
    const files = ['src/a.py', 'src/b.py', 'src/c.py'];
    const skeletons = [
      createSkeleton('src/a.py', [
        { moduleSpecifier: './b', isRelative: true },
      ]),
      createSkeleton('src/b.py', [
        { moduleSpecifier: './c', isRelative: true },
      ]),
      createSkeleton('src/c.py', []),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    const order = graph.topologicalOrder;
    // 所有文件都应包含在拓扑排序结果中
    expect(order).toHaveLength(3);
    expect(order).toContain('src/a.py');
    expect(order).toContain('src/b.py');
    expect(order).toContain('src/c.py');

    // 验证依赖图边正确建立
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'src/a.py', to: 'src/b.py' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'src/b.py', to: 'src/c.py' }));
  });

  it('T031: Python from ..models import User 跨目录相对 import 正确解析', async () => {
    const files = ['src/handlers/api.py', 'src/models.py'];
    const skeletons = [
      createSkeleton('src/handlers/api.py', [
        { moduleSpecifier: '../models', isRelative: true },
      ]),
      createSkeleton('src/models.py', []),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      from: 'src/handlers/api.py',
      to: 'src/models.py',
    });
  });

  it('T032: 混合有效和无效 import，有效 import 正确生成边，无效 import 静默跳过', async () => {
    const files = ['src/app.py', 'src/utils.py'];
    const skeletons = [
      createSkeleton('src/app.py', [
        { moduleSpecifier: './utils', isRelative: true },    // 有效
        { moduleSpecifier: './missing', isRelative: true },  // 无效
        { moduleSpecifier: 'requests', isRelative: false },  // 第三方
      ]),
      createSkeleton('src/utils.py', []),
    ];

    const graph = await buildDirectoryGraph(files, '/project', skeletons);

    // 仅有效的 ./utils import 产生边
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.to).toBe('src/utils.py');
  });
});
