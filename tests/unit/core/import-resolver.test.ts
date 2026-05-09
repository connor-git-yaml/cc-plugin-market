/**
 * Feature 156 W1.0 — import-resolver 单测（FR-28 / AC-11）
 *
 * 覆盖 4 类 ImportType + path alias + index fallback，验证 resolveTsJsImport / detectImportType
 * 在 tests/fixtures/ts-import-scenarios/ 上的真实输出（无 mock，使用真实 ts-morph 与 fs）。
 */
import { describe, expect, it, afterEach } from 'vitest';
import * as path from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import {
  resolveTsJsImport,
  detectImportType,
  resolveImportsForFile,
  type ImportType,
} from '../../../src/core/import-resolver.js';
import { analyzeFileInternal, resetProject } from '../../../src/core/ast-analyzer.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/ts-import-scenarios');

afterEach(() => {
  // 测试间清理 ts-morph 单例 Project（避免 source file 句柄串台）
  resetProject();
});

describe('resolveTsJsImport — 文件路径解析（FR-28）', () => {
  it('解析相对 import 到绝对路径（自动补 .ts 扩展名）', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    const resolved = resolveTsJsImport('./foo', fromFile, FIXTURE_DIR);
    expect(resolved).not.toBeNull();
    expect(resolved).toBe(path.join(FIXTURE_DIR, 'foo.ts'));
  });

  it('返回 null 当 specifier 是 npm 包（不解析外部依赖）', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    expect(resolveTsJsImport('lodash', fromFile, FIXTURE_DIR)).toBeNull();
    expect(resolveTsJsImport('node:fs', fromFile, FIXTURE_DIR)).toBeNull();
  });

  it('解析 alias（@/foo → src/foo）', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    // 用 fixture 目录冒充 src，验证 alias 替换路径正确（即使目标文件不存在也能拼路径）
    const resolved = resolveTsJsImport(
      '@/foo',
      fromFile,
      FIXTURE_DIR,
      { pathAliases: { '@/*': './*' } },
    );
    // alias 命中后命中 fixture/foo.ts
    expect(resolved).toBe(path.join(FIXTURE_DIR, 'foo.ts'));
  });

  it('返回 null 当 specifier 不可解析（文件不存在）', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    expect(resolveTsJsImport('./nonexistent', fromFile, FIXTURE_DIR)).toBeNull();
  });

  it('CRIT-1：specifier 以 .js 结尾时优先解析对应 .ts（TS ESM 惯例）', () => {
    // foo.ts 存在；foo.js 不存在；`./foo.js` 必须解析到 foo.ts
    const fromFile = path.join(FIXTURE_DIR, 'js-ext-import.ts');
    const resolved = resolveTsJsImport('./foo.js', fromFile, FIXTURE_DIR);
    expect(resolved).toBe(path.join(FIXTURE_DIR, 'foo.ts'));
  });

  it('CRIT-1：当 .js 候选不存在时 fallback 到原 specifier 行为', () => {
    const fromFile = path.join(FIXTURE_DIR, 'js-ext-import.ts');
    // 无 nonexistent.ts 也无 nonexistent.js → null（不抛错，不卡住）
    expect(resolveTsJsImport('./nonexistent.js', fromFile, FIXTURE_DIR)).toBeNull();
  });
});

describe('detectImportType — 4 类 import 判别（FR-28 / AC-11）', () => {
  function loadFixture(filename: string) {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { noLib: true, skipLibCheck: true, noResolve: true, allowJs: true, jsx: 2 },
    });
    return project.addSourceFileAtPath(path.join(FIXTURE_DIR, filename));
  }

  it('static-import.ts → "static"', () => {
    const sf = loadFixture('static-import.ts');
    const decls = sf.getImportDeclarations();
    expect(decls.length).toBeGreaterThan(0);
    expect(detectImportType(decls[0]!)).toBe<ImportType>('static');
  });

  it('type-only-import.ts → "type-only"', () => {
    const sf = loadFixture('type-only-import.ts');
    const decls = sf.getImportDeclarations();
    expect(decls.length).toBeGreaterThan(0);
    expect(detectImportType(decls[0]!)).toBe<ImportType>('type-only');
  });

  it('dynamic-import.ts → "dynamic"', () => {
    const sf = loadFixture('dynamic-import.ts');
    // 动态 import 是 CallExpression 节点（callee = ImportKeyword）
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    const dynamicCall = calls.find((c) => c.getExpression().getKind() === SyntaxKind.ImportKeyword);
    expect(dynamicCall).toBeDefined();
    expect(detectImportType(dynamicCall!)).toBe<ImportType>('dynamic');
  });

  it('commonjs-require.ts → "commonjs-require"', () => {
    const sf = loadFixture('commonjs-require.ts');
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    const requireCall = calls.find((c) => c.getExpression().getText() === 'require');
    expect(requireCall).toBeDefined();
    expect(detectImportType(requireCall!)).toBe<ImportType>('commonjs-require');
  });

  it('WARN-1：混合 default + type named (`import Foo, { type Bar }`) 归 "static"，不归 type-only', () => {
    const sf = loadFixture('mixed-default-and-type-named.ts');
    const decls = sf.getImportDeclarations();
    expect(decls.length).toBe(1);
    // default 仍是运行时值导入；不应仅因 named 全是 type-only 就归类 type-only
    expect(detectImportType(decls[0]!)).toBe<ImportType>('static');
  });
});

describe('analyzeFile 集成 — 4 类 fixture 的 imports[].resolvedPath / importType', () => {
  it('static-import.ts: resolvedPath 指向 foo.ts，importType=static', async () => {
    const sk: CodeSkeleton = await analyzeFileInternal(path.join(FIXTURE_DIR, 'static-import.ts'), {
      projectRoot: FIXTURE_DIR,
    });
    expect(sk.imports.length).toBeGreaterThan(0);
    const imp = sk.imports.find((i) => i.moduleSpecifier === './foo');
    expect(imp).toBeDefined();
    expect(imp!.resolvedPath).toBe(path.join(FIXTURE_DIR, 'foo.ts'));
    expect(imp!.importType).toBe('static');
  });

  it('type-only-import.ts: importType=type-only', async () => {
    const sk: CodeSkeleton = await analyzeFileInternal(path.join(FIXTURE_DIR, 'type-only-import.ts'), {
      projectRoot: FIXTURE_DIR,
    });
    const imp = sk.imports.find((i) => i.moduleSpecifier === './bar');
    expect(imp).toBeDefined();
    expect(imp!.resolvedPath).toBe(path.join(FIXTURE_DIR, 'bar.ts'));
    expect(imp!.importType).toBe('type-only');
  });

  it('dynamic-import.ts: importType=dynamic + resolvedPath 指向 baz', async () => {
    const sk: CodeSkeleton = await analyzeFileInternal(path.join(FIXTURE_DIR, 'dynamic-import.ts'), {
      projectRoot: FIXTURE_DIR,
    });
    const imp = sk.imports.find((i) => i.moduleSpecifier === './baz');
    expect(imp).toBeDefined();
    expect(imp!.importType).toBe('dynamic');
    expect(imp!.resolvedPath).toBe(path.join(FIXTURE_DIR, 'baz.ts'));
  });

  it('commonjs-require.ts: importType=commonjs-require + resolvedPath 指向 baz', async () => {
    const sk: CodeSkeleton = await analyzeFileInternal(path.join(FIXTURE_DIR, 'commonjs-require.ts'), {
      projectRoot: FIXTURE_DIR,
    });
    const imp = sk.imports.find((i) => i.moduleSpecifier === './baz');
    expect(imp).toBeDefined();
    expect(imp!.importType).toBe('commonjs-require');
    expect(imp!.resolvedPath).toBe(path.join(FIXTURE_DIR, 'baz.ts'));
  });
});

// ───────────────────────────────────────────────────────────
// T-005：buildUnifiedGraph 集成 — 4 类 fixture 各产 ≥ 1 条 depends-on 边
// ───────────────────────────────────────────────────────────

describe('T-005 集成：buildUnifiedGraph 在 4 类 fixture 上产出 depends-on 边', () => {
  it('4 类 fixture（static / type-only / dynamic / commonjs-require）各产 ≥ 1 条 depends-on 边', async () => {
    const { buildUnifiedGraph } = await import('../../../src/knowledge-graph/index.js');
    const fixtures = ['static-import.ts', 'type-only-import.ts', 'dynamic-import.ts', 'commonjs-require.ts'];
    const skMap = new Map<string, CodeSkeleton>();
    for (const f of fixtures) {
      const fp = path.join(FIXTURE_DIR, f);
      const sk = await analyzeFileInternal(fp, { projectRoot: FIXTURE_DIR });
      skMap.set(fp, sk);
    }
    // 同时加入被引用的文件，避免 deriveImportEdges 因 target 不在 skMap 中跳过
    for (const target of ['foo.ts', 'bar.ts', 'baz.ts']) {
      const fp = path.join(FIXTURE_DIR, target);
      const sk = await analyzeFileInternal(fp, { projectRoot: FIXTURE_DIR });
      skMap.set(fp, sk);
    }

    const unified = buildUnifiedGraph({
      projectRoot: FIXTURE_DIR,
      codeSkeletons: skMap,
    });
    const dependsOn = unified.edges.filter((e) => e.relation === 'depends-on');
    // 4 个 fixture 至少各产 1 条边（共 ≥ 4）
    expect(dependsOn.length).toBeGreaterThanOrEqual(4);

    // 每个 fixture 至少有一条出边
    for (const f of fixtures) {
      const fp = path.join(FIXTURE_DIR, f);
      const out = dependsOn.filter((e) => e.source === fp);
      expect(out.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('WARN-3：deriveImportEdges 不再污染 evidence；importType 写入 metadata', async () => {
    const { buildUnifiedGraph } = await import('../../../src/knowledge-graph/index.js');
    const fixtures = ['static-import.ts', 'type-only-import.ts', 'dynamic-import.ts', 'commonjs-require.ts'];
    const skMap = new Map<string, CodeSkeleton>();
    for (const f of fixtures.concat(['foo.ts', 'bar.ts', 'baz.ts'])) {
      const fp = path.join(FIXTURE_DIR, f);
      const sk = await analyzeFileInternal(fp, { projectRoot: FIXTURE_DIR });
      skMap.set(fp, sk);
    }
    const unified = buildUnifiedGraph({ projectRoot: FIXTURE_DIR, codeSkeletons: skMap });
    const dependsOn = unified.edges.filter((e) => e.relation === 'depends-on');
    expect(dependsOn.length).toBeGreaterThanOrEqual(4);

    // evidence 字段必须是纯 specifier，不再含 "static:" / "dynamic:" 等前缀
    for (const e of dependsOn) {
      expect(e.evidence).toBeDefined();
      expect(e.evidence!).not.toMatch(/^(static|dynamic|type-only|commonjs-require):/);
    }

    // dynamic-import.ts 的 import('./baz') 必产 metadata.importType === 'dynamic'
    const dynFile = path.join(FIXTURE_DIR, 'dynamic-import.ts');
    const dynEdge = dependsOn.find((e) => e.source === dynFile);
    expect(dynEdge).toBeDefined();
    expect(dynEdge!.metadata?.importType).toBe('dynamic');
    // evidence 也应是纯 specifier
    expect(dynEdge!.evidence).toBe('./baz');
  });

  it('循环 fixture (circular-a/b)：deriveModuleGraph 输出 isCircular=true', async () => {
    const { buildUnifiedGraph } = await import('../../../src/knowledge-graph/index.js');
    const { deriveModuleGraph } = await import('../../../src/knowledge-graph/module-derivation.js');
    const skMap = new Map<string, CodeSkeleton>();
    for (const f of ['circular-a.ts', 'circular-b.ts']) {
      const fp = path.join(FIXTURE_DIR, f);
      const sk = await analyzeFileInternal(fp, { projectRoot: FIXTURE_DIR });
      skMap.set(fp, sk);
    }
    const unified = buildUnifiedGraph({ projectRoot: FIXTURE_DIR, codeSkeletons: skMap });
    const moduleGraph = deriveModuleGraph(unified, FIXTURE_DIR);
    expect(moduleGraph.edges.length).toBeGreaterThanOrEqual(2);
    // 循环 fixture：所有边应被标记 isCircular=true
    for (const e of moduleGraph.edges) {
      expect(e.isCircular).toBe(true);
    }
  });
});

describe('resolveImportsForFile helper（批量后处理）', () => {
  it('对未 resolve 的 imports 数组逐项填 resolvedPath + importType', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    const result = resolveImportsForFile(
      [
        { moduleSpecifier: './foo', isRelative: true, resolvedPath: null, isTypeOnly: false },
        { moduleSpecifier: './bar', isRelative: true, resolvedPath: null, isTypeOnly: true },
        { moduleSpecifier: 'lodash', isRelative: false, resolvedPath: null, isTypeOnly: false },
      ],
      fromFile,
      FIXTURE_DIR,
    );
    expect(result[0]!.resolvedPath).toBe(path.join(FIXTURE_DIR, 'foo.ts'));
    expect(result[0]!.importType).toBe('static');
    expect(result[1]!.resolvedPath).toBe(path.join(FIXTURE_DIR, 'bar.ts'));
    expect(result[1]!.importType).toBe('type-only');
    expect(result[2]!.resolvedPath).toBeNull();
  });
});
