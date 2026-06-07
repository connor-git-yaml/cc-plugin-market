/**
 * Feature 181 — 单一权威 import-resolver 单测（TS/JS）
 *
 * 收口后 core/import-resolver.ts 是唯一权威 TS/JS resolver（返回 ResolveResult）。
 * 本文件覆盖（合并历史 core ESM/扩展能力 + kg alias/guard/POSIX 语义）：
 *   - 相对解析：ESM ext map（./foo.js→foo.ts）/ 直接命中 / index / .mjs.cjs
 *   - alias：最长前缀 / 精确 key 优先 wildcard / 多候选 / baseUrl 叠加（TS 官方语义）
 *   - guard：projectRoot 为真时越界→unresolved；projectRoot='' 返回绝对 + 跳过守卫
 *   - .json / .d.ts → external；external/unresolved 区分
 *   - findNearestTsConfig / buildTsConfigContext（ts API，含 extends 链）
 *   - resolveTsJsImportToAbsolute（AST 消费方绝对路径封装）
 *
 * 测试用真实 fs：复用 tests/fixtures/ts-import-scenarios + 临时目录 fixture（无 mock，
 * 因 buildTsConfigContext 经 ts.sys 读盘，fs mock 不生效）。
 */
import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resolveTsJsImport,
  resolveTsJsImportToAbsolute,
  findNearestTsConfig,
  buildTsConfigContext,
  type TsConfigResolutionContext,
} from '../../../src/core/import-resolver.js';
import { analyzeFileInternal, resetProject } from '../../../src/core/ast-analyzer.js';
import type { CodeSkeleton } from '../../../src/models/code-skeleton.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/ts-import-scenarios');

const tmpDirs: string[] = [];

/** 创建临时项目 fixture（写入文件，返回 root 绝对路径） */
function createFixture(files: Record<string, string>): string {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'f181-resolver-')));
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
  }
  tmpDirs.push(tmpDir);
  return tmpDir;
}

afterEach(() => {
  resetProject();
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
  tmpDirs.length = 0;
});

describe('resolveTsJsImport — 相对路径解析（ResolveResult）', () => {
  it('相对 import 自动补 .ts 扩展名 → kind=relative，resolvedPath 为相对 POSIX', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    const r = resolveTsJsImport('./foo', fromFile, FIXTURE_DIR);
    expect(r.kind).toBe('relative');
    expect(r.resolvedPath).toBe('foo.ts');
  });

  it('CRIT-1 ESM ext map：./foo.js 命中 foo.ts（TS ESM 惯例）', () => {
    const fromFile = path.join(FIXTURE_DIR, 'js-ext-import.ts');
    const r = resolveTsJsImport('./foo.js', fromFile, FIXTURE_DIR);
    expect(r.kind).toBe('relative');
    expect(r.resolvedPath).toBe('foo.ts');
  });

  it('npm 包 / node: 内置 → external，resolvedPath=null', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    expect(resolveTsJsImport('lodash', fromFile, FIXTURE_DIR).kind).toBe('external');
    expect(resolveTsJsImport('node:fs', fromFile, FIXTURE_DIR).kind).toBe('external');
  });

  it('文件不存在 → unresolved', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    const r = resolveTsJsImport('./nonexistent', fromFile, FIXTURE_DIR);
    expect(r.kind).toBe('unresolved');
    expect(r.resolvedPath).toBeNull();
  });

  it('.js 候选不存在时不抛错，fallback 后 → unresolved', () => {
    const fromFile = path.join(FIXTURE_DIR, 'js-ext-import.ts');
    expect(resolveTsJsImport('./nonexistent.js', fromFile, FIXTURE_DIR).resolvedPath).toBeNull();
  });

  it('W-1：相对 .json → external（不入图）', () => {
    const root = createFixture({
      'src/index.ts': '',
      'src/config.json': '{}',
    });
    const r = resolveTsJsImport('./config.json', path.join(root, 'src/index.ts'), root);
    expect(r.kind).toBe('external');
    expect(r.resolvedPath).toBeNull();
  });

  it('W-1：相对 .d.ts → external', () => {
    const root = createFixture({
      'src/index.ts': '',
      'src/types.d.ts': 'export {};',
    });
    const r = resolveTsJsImport('./types.d.ts', path.join(root, 'src/index.ts'), root);
    expect(r.kind).toBe('external');
  });

  it('.mjs / .cjs target 可解析（含 ESM .mjs→.mts map）', () => {
    const root = createFixture({
      'src/index.ts': '',
      'src/lib.mjs': 'export const x = 1;',
      'src/legacy.cjs': 'module.exports = {};',
    });
    expect(resolveTsJsImport('./lib.mjs', path.join(root, 'src/index.ts'), root).resolvedPath).toBe('src/lib.mjs');
    expect(resolveTsJsImport('./legacy.cjs', path.join(root, 'src/index.ts'), root).resolvedPath).toBe('src/legacy.cjs');
  });

  it('目录 index 解析（./sub → sub/index.ts）', () => {
    const root = createFixture({
      'src/index.ts': '',
      'src/sub/index.ts': 'export const y = 2;',
    });
    const r = resolveTsJsImport('./sub', path.join(root, 'src/index.ts'), root);
    expect(r.resolvedPath).toBe('src/sub/index.ts');
  });
});

describe('resolveTsJsImport — projectRoot 守卫条件化（R4/R5）', () => {
  it('projectRoot 为真：相对 import 解析到 projectRoot 外 → unresolved（防图污染）', () => {
    // 在 tmp 下建两个兄弟目录：proj/ 与 outside/，proj 内文件 import ../outside/x
    const base = createFixture({
      'proj/src/index.ts': '',
      'outside/x.ts': 'export const z = 3;',
    });
    const projectRoot = path.join(base, 'proj');
    const r = resolveTsJsImport('../../outside/x.js', path.join(projectRoot, 'src/index.ts'), projectRoot);
    expect(r.kind).toBe('unresolved');
    expect(r.resolvedPath).toBeNull();
  });

  it("projectRoot='' ：跳过守卫，返回绝对路径（历史 core 独立调用行为）", () => {
    const base = createFixture({
      'proj/src/index.ts': '',
      'outside/x.ts': 'export const z = 3;',
    });
    const fromFile = path.join(base, 'proj/src/index.ts');
    const r = resolveTsJsImport('../../outside/x.js', fromFile, '');
    expect(r.kind).toBe('relative');
    expect(r.resolvedPath).toBe(path.join(base, 'outside/x.ts')); // 绝对路径
    expect(path.isAbsolute(r.resolvedPath!)).toBe(true);
  });
});

describe('resolveTsJsImport — paths alias / baseUrl（TS 官方语义）', () => {
  it('精确 key（无 wildcard）→ paths-alias', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { react: ['./src/types/react'] } } }),
      'src/types/react.ts': 'export const r = 1;',
      'src/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('react', path.join(root, 'src/index.ts'), root, ctx);
    expect(r.kind).toBe('paths-alias');
    expect(r.resolvedPath).toBe('src/types/react.ts');
  });

  it('wildcard ~/* → src/*', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '~/*': ['./src/*'] } } }),
      'src/utils.ts': 'export const u = 1;',
      'app/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('~/utils', path.join(root, 'app/index.ts'), root, ctx);
    expect(r.kind).toBe('paths-alias');
    expect(r.resolvedPath).toBe('src/utils.ts');
  });

  it('多候选：第一个不存在，命中第二个', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*', './libs/*'] } } }),
      'libs/utils.ts': 'export const u = 1;',
      'app/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('@/utils', path.join(root, 'app/index.ts'), root, ctx);
    expect(r.resolvedPath).toBe('libs/utils.ts');
  });

  it('最长前缀优先：@app/utils/* 胜过 @app/*', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@app/*': ['./packages/app/*'], '@app/utils/*': ['./packages/lib/utils/*'] } },
      }),
      'packages/lib/utils/format.ts': 'export const f = 1;',
      'src/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('@app/utils/format', path.join(root, 'src/index.ts'), root, ctx);
    expect(r.kind).toBe('paths-alias');
    expect(r.resolvedPath).toBe('packages/lib/utils/format.ts');
  });

  it('精确 key 优先于 wildcard（即使 wildcard Map 插入在前）', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '~/*': ['./src/*'], react: ['./src/types/react'] } },
      }),
      'src/types/react.ts': 'export const r = 1;',
      'src/react.ts': 'export const wrong = 1;',
      'src/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('react', path.join(root, 'src/index.ts'), root, ctx);
    expect(r.resolvedPath).toBe('src/types/react.ts');
  });

  it('同前缀长度：精确 key 优先于 wildcard（react 胜过 react*，即使 react* Map 在前）', () => {
    // Codex W#3：react（exact，prefixLen=5）与 react*（wildcard，indexOf('*')=5）同前缀长度，
    // 排序须 exact 优先（TS 官方 exact-before-wildcard），不依赖 Map 插入顺序
    const root = createFixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { 'react*': ['./src/wildcard*'], react: ['./src/types/react'] } },
      }),
      'src/types/react.ts': 'export const r = 1;',
      'src/wildcard.ts': 'export const wrong = 1;',
      'src/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('react', path.join(root, 'src/index.ts'), root, ctx);
    expect(r.kind).toBe('paths-alias');
    expect(r.resolvedPath).toBe('src/types/react.ts');
  });

  it('baseUrl 解析（非相对 specifier）→ absolute', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
      'components/Button.ts': 'export const b = 1;',
      'app/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('components/Button', path.join(root, 'app/index.ts'), root, ctx);
    expect(r.kind).toBe('absolute');
    expect(r.resolvedPath).toBe('components/Button.ts');
  });

  it('baseUrl 叠加 paths（baseUrl="src" + paths "@/*":["*"]）', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { '@/*': ['*'] } } }),
      'src/foo.ts': 'export const foo = 1;',
      'src/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    const r = resolveTsJsImport('@/foo', path.join(root, 'src/index.ts'), root, ctx);
    expect(r.kind).toBe('paths-alias');
    expect(r.resolvedPath).toBe('src/foo.ts');
  });
});

describe('resolveTsJsImport — external / unresolved 区分', () => {
  it('bare npm 包 → external', () => {
    const r = resolveTsJsImport('express', '/proj/src/index.ts', '/proj', null);
    expect(r.kind).toBe('external');
  });

  it('scoped 包 @org/lib → external', () => {
    const r = resolveTsJsImport('@org/lib', '/proj/src/index.ts', '/proj', null);
    expect(r.kind).toBe('external');
  });

  it('alias-like ~/ 无 tsconfig → unresolved', () => {
    const r = resolveTsJsImport('~/utils', '/proj/src/index.ts', '/proj', null);
    expect(r.kind).toBe('unresolved');
  });

  it('@/ alias-like 无 tsconfig → unresolved', () => {
    const r = resolveTsJsImport('@/utils', '/proj/src/index.ts', '/proj', null);
    expect(r.kind).toBe('unresolved');
  });

  it('传 undefined tsConfigContext 不崩溃', () => {
    expect(() => resolveTsJsImport('~/utils', '/proj/src/index.ts', '/proj', undefined)).not.toThrow();
  });

  it('W-5：resolvedPath 为 POSIX 格式（不含反斜杠）', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    const r = resolveTsJsImport('./foo', fromFile, FIXTURE_DIR);
    expect(r.resolvedPath).not.toContain('\\');
  });
});

describe('resolveTsJsImportToAbsolute — AST 消费方绝对路径封装', () => {
  it('projectRoot 为真：相对结果归一为绝对路径', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    const abs = resolveTsJsImportToAbsolute('./foo', fromFile, FIXTURE_DIR);
    expect(abs).toBe(path.join(FIXTURE_DIR, 'foo.ts'));
  });

  it("projectRoot=''：直接返回绝对路径", () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    const abs = resolveTsJsImportToAbsolute('./foo', fromFile, '');
    expect(abs).toBe(path.join(FIXTURE_DIR, 'foo.ts'));
  });

  it('external/unresolved → null', () => {
    const fromFile = path.join(FIXTURE_DIR, 'static-import.ts');
    expect(resolveTsJsImportToAbsolute('lodash', fromFile, FIXTURE_DIR)).toBeNull();
    expect(resolveTsJsImportToAbsolute('./nope', fromFile, FIXTURE_DIR)).toBeNull();
  });
});

describe('findNearestTsConfig — monorepo nearest 查找', () => {
  it('两层 tsconfig 返回最近的路径', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      'packages/core/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
      'packages/core/src/index.ts': '',
    });
    const found = findNearestTsConfig(path.join(root, 'packages/core/src/index.ts'), root);
    expect(found).toBe(path.join(root, 'packages/core/tsconfig.json'));
  });

  it('无 tsconfig → null，不抛异常', () => {
    const root = createFixture({ 'src/index.ts': '' });
    let result: string | null = 'x';
    expect(() => {
      result = findNearestTsConfig(path.join(root, 'src/index.ts'), root);
    }).not.toThrow();
    expect(result).toBeNull();
  });

  it('C-3/C-5：边界外目录（projection vs proj）不返回越界 tsconfig', () => {
    const base = createFixture({
      'proj/tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      'projection/tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      'projection/a.ts': '',
    });
    const found = findNearestTsConfig(path.join(base, 'projection/a.ts'), path.join(base, 'proj'));
    expect(found).toBeNull();
  });
});

describe('buildTsConfigContext — ts API 解析（含 extends 链）', () => {
  it('baseUrl + paths 正确解析', () => {
    const root = createFixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { '~/*': ['./libs/*'] } } }),
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    expect(ctx).not.toBeNull();
    expect(ctx.configDir).toBe(root);
    expect(ctx.paths.get('~/*')).toEqual(['./libs/*']);
  });

  it('无 compilerOptions → baseUrl=null，paths 空', () => {
    const root = createFixture({ 'tsconfig.json': JSON.stringify({}) });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    expect(ctx.baseUrl).toBeNull();
    expect(ctx.paths.size).toBe(0);
  });

  it('extends 链：base 定义的 paths 被继承（ts API 能力）', () => {
    const root = createFixture({
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@base/*': ['./shared/*'] } } }),
      'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json' }),
      'shared/util.ts': 'export const u = 1;',
      'src/index.ts': '',
    });
    const ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'))!;
    // extends 链合并后应含 base 的 paths
    expect(ctx.paths.has('@base/*')).toBe(true);
    const r = resolveTsJsImport('@base/util', path.join(root, 'src/index.ts'), root, ctx);
    expect(r.kind).toBe('paths-alias');
    expect(r.resolvedPath).toBe('shared/util.ts');
  });

  it('损坏 tsconfig.json → null，不抛异常', () => {
    const root = createFixture({ 'tsconfig.json': '{ invalid json /* x */ }' });
    let ctx: TsConfigResolutionContext | null = {} as TsConfigResolutionContext;
    expect(() => {
      ctx = buildTsConfigContext(path.join(root, 'tsconfig.json'));
    }).not.toThrow();
    // ts.readConfigFile 容错：损坏时返回 null 或空 context，均不崩溃
    expect(ctx === null || ctx.paths.size === 0).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────
// analyzeFile 集成 — 4 类 fixture 的 imports[].resolvedPath / importType（AST 路径绝对）
// ───────────────────────────────────────────────────────────

describe('analyzeFile 集成 — imports[].resolvedPath / importType（绝对路径保持）', () => {
  it('static-import.ts: resolvedPath 指向 foo.ts（绝对），importType=static', async () => {
    const sk: CodeSkeleton = await analyzeFileInternal(path.join(FIXTURE_DIR, 'static-import.ts'), {
      projectRoot: FIXTURE_DIR,
    });
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
  it('4 类 fixture 各产 ≥ 1 条 depends-on 边', async () => {
    const { buildUnifiedGraph } = await import('../../../src/knowledge-graph/index.js');
    const fixtures = ['static-import.ts', 'type-only-import.ts', 'dynamic-import.ts', 'commonjs-require.ts'];
    const skMap = new Map<string, CodeSkeleton>();
    for (const f of fixtures.concat(['foo.ts', 'bar.ts', 'baz.ts'])) {
      const fp = path.join(FIXTURE_DIR, f);
      skMap.set(fp, await analyzeFileInternal(fp, { projectRoot: FIXTURE_DIR }));
    }
    const unified = buildUnifiedGraph({ projectRoot: FIXTURE_DIR, codeSkeletons: skMap });
    const dependsOn = unified.edges.filter((e) => e.relation === 'depends-on');
    expect(dependsOn.length).toBeGreaterThanOrEqual(4);
    for (const f of fixtures) {
      const fp = path.join(FIXTURE_DIR, f);
      expect(dependsOn.filter((e) => e.source === fp).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('WARN-3：deriveImportEdges 不污染 evidence；importType 写入 metadata', async () => {
    const { buildUnifiedGraph } = await import('../../../src/knowledge-graph/index.js');
    const fixtures = ['static-import.ts', 'type-only-import.ts', 'dynamic-import.ts', 'commonjs-require.ts'];
    const skMap = new Map<string, CodeSkeleton>();
    for (const f of fixtures.concat(['foo.ts', 'bar.ts', 'baz.ts'])) {
      const fp = path.join(FIXTURE_DIR, f);
      skMap.set(fp, await analyzeFileInternal(fp, { projectRoot: FIXTURE_DIR }));
    }
    const unified = buildUnifiedGraph({ projectRoot: FIXTURE_DIR, codeSkeletons: skMap });
    const dependsOn = unified.edges.filter((e) => e.relation === 'depends-on');
    expect(dependsOn.length).toBeGreaterThanOrEqual(4);
    for (const e of dependsOn) {
      expect(e.evidence).toBeDefined();
      expect(e.evidence!).not.toMatch(/^(static|dynamic|type-only|commonjs-require):/);
    }
    const dynFile = path.join(FIXTURE_DIR, 'dynamic-import.ts');
    const dynEdge = dependsOn.find((e) => e.source === dynFile);
    expect(dynEdge).toBeDefined();
    expect(dynEdge!.metadata?.importType).toBe('dynamic');
    expect(dynEdge!.evidence).toBe('./baz');
  });

  it('循环 fixture (circular-a/b)：deriveModuleGraph 输出 isCircular=true', async () => {
    const { buildUnifiedGraph } = await import('../../../src/knowledge-graph/index.js');
    const { deriveModuleGraph } = await import('../../../src/knowledge-graph/module-derivation.js');
    const skMap = new Map<string, CodeSkeleton>();
    for (const f of ['circular-a.ts', 'circular-b.ts']) {
      const fp = path.join(FIXTURE_DIR, f);
      skMap.set(fp, await analyzeFileInternal(fp, { projectRoot: FIXTURE_DIR }));
    }
    const unified = buildUnifiedGraph({ projectRoot: FIXTURE_DIR, codeSkeletons: skMap });
    const moduleGraph = deriveModuleGraph(unified, FIXTURE_DIR);
    expect(moduleGraph.edges.length).toBeGreaterThanOrEqual(2);
    for (const e of moduleGraph.edges) {
      expect(e.isCircular).toBe(true);
    }
  });
});
