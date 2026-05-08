/**
 * Feature 152 T-005 — import-resolver 单测（含 TDD T-021a buildTsConfigContext）
 *
 * 覆盖 ≥ 21 条场景，含以下修复验证：
 * - C-1：from . import nn 形态由 collect 层拆解为 ".nn" 后调用 resolver
 * - C-2：alias-like 前缀（~/、#/ 等）无 tsconfig 时返回 unresolved
 * - C-5：isInsideProjectRoot 用 path.relative 而非字典序比较
 * - W-1：.json / .d.ts 相对路径返回 external
 * - W-4：tsconfig paths 精确 key + multi candidates 顺序断言
 * - W-5：resolvedPath 使用 POSIX 路径（含 '/'）
 * - T-021a：buildTsConfigContext rawConfig 转换
 *
 * 测试隔离：通过 vi.mock('fs') hoisting 方式 mock 文件系统，避免 ESM 限制。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

// ESM 环境下需在导入被测模块之前通过 vi.mock 声明 mock（hoisted）
vi.mock('fs', () => {
  // 创建可在测试中更新的文件集合（用全局对象持有引用，让每个测试可以覆盖）
  return {
    existsSync: vi.fn((p: string) => false),
    readFileSync: vi.fn((p: string, _options?: unknown) => {
      return JSON.stringify({ compilerOptions: {} });
    }),
  };
});

// 在 mock 之后导入被测模块（vitest 会确保 mock 先于实模块初始化）
import {
  resolvePythonImport,
  resolveTsJsImport,
  findNearestTsConfig,
  buildTsConfigContext,
  type TsConfigResolutionContext,
} from '../../../src/knowledge-graph/import-resolver.js';

// 导入 mock 版本的 fs，以便在测试中控制其行为
import * as fs from 'fs';

// ───────────────────────────────────────────────────────────
// Mock 工具
// ───────────────────────────────────────────────────────────

/**
 * 设置当前测试的虚拟文件系统：给定路径集合，让 fs.existsSync 返回 true
 */
function setupFs(existingFiles: string[], tsconfigs?: Record<string, string>): void {
  const fileSet = new Set(existingFiles);
  // 将所有 tsconfig.json 也加入文件集合
  if (tsconfigs) {
    for (const p of Object.keys(tsconfigs)) fileSet.add(p);
  }

  vi.mocked(fs.existsSync).mockImplementation((p) => fileSet.has(p.toString()));
  vi.mocked(fs.readFileSync).mockImplementation((p, _options) => {
    const filePath = p.toString();
    if (tsconfigs && filePath in tsconfigs) {
      return tsconfigs[filePath];
    }
    // 默认返回最小有效 tsconfig.json
    if (filePath.endsWith('tsconfig.json')) {
      return JSON.stringify({ compilerOptions: {} });
    }
    throw new Error(`readFileSync mock: unexpected path ${filePath}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────
// 测试套件
// ───────────────────────────────────────────────────────────

describe('import-resolver', () => {
  // ─── Python 场景 ─────────────────────────────────────────

  describe('resolvePythonImport — Python 绝对路径场景', () => {
    it('场景 1：from micrograd.engine import Value → kind=module，resolvedPath=micrograd/engine.py', () => {
      setupFs(['/proj/micrograd/engine.py']);
      const result = resolvePythonImport('micrograd.engine', '/proj/micrograd/nn.py', '/proj');
      expect(result.kind).toBe('module');
      expect(result.resolvedPath).toBe('micrograd/engine.py');
    });

    it('场景 5：import os（stdlib 内置）→ kind=external，resolvedPath=null', () => {
      setupFs([]);
      const result = resolvePythonImport('os', '/proj/main.py', '/proj');
      expect(result.kind).toBe('external');
      expect(result.resolvedPath).toBeNull();
    });

    it('场景 6a：同名 basename 冲突 — from a.utils → a/utils.py', () => {
      setupFs(['/proj/a/utils.py', '/proj/b/utils.py']);
      const resultA = resolvePythonImport('a.utils', '/proj/main.py', '/proj');
      expect(resultA.kind).toBe('module');
      expect(resultA.resolvedPath).toBe('a/utils.py');
    });

    it('场景 6b：同名 basename 冲突 — from b.utils → b/utils.py', () => {
      setupFs(['/proj/a/utils.py', '/proj/b/utils.py']);
      const resultB = resolvePythonImport('b.utils', '/proj/main.py', '/proj');
      expect(resultB.kind).toBe('module');
      expect(resultB.resolvedPath).toBe('b/utils.py');
    });

    it('Python package-init：pkg 目录含 __init__.py', () => {
      setupFs(['/proj/pkg/__init__.py']);
      const result = resolvePythonImport('pkg', '/proj/main.py', '/proj');
      expect(result.kind).toBe('package-init');
      expect(result.resolvedPath).toBe('pkg/__init__.py');
    });
  });

  describe('resolvePythonImport — Python 相对 import 场景', () => {
    it('场景 2（C-1 修复）：collect 层拆解为 ".nn" 后调用 → kind=relative-sibling', () => {
      // C-1 修复：collect 层把 "from . import nn" 拆解为 resolvePythonImport(".nn", callerFile, root)
      setupFs(['/proj/micrograd/nn.py']);
      // callerFile 在 micrograd/training.py，.nn → micrograd/nn.py
      const result = resolvePythonImport('.nn', '/proj/micrograd/training.py', '/proj');
      expect(result.kind).toBe('relative-sibling');
      expect(result.resolvedPath).toBe('micrograd/nn.py');
    });

    it('场景 3：from .. import X（祖先包）→ relative-sibling', () => {
      // callerFile 在 /proj/pkg/sub/module.py
      // ..utils → baseDir=/proj/pkg（上溯 1 级），/proj/pkg/utils.py
      setupFs(['/proj/pkg/utils.py']);
      const result = resolvePythonImport('..utils', '/proj/pkg/sub/module.py', '/proj');
      expect(result.kind).toBe('relative-sibling');
      expect(result.resolvedPath).toBe('pkg/utils.py');
    });

    it('场景 4：越过 projectRoot（4 个点）→ kind=unresolved，resolvedPath=null', () => {
      // callerFile 在 /proj/a.py，level=4 → 上溯 3 级，/proj 只有 1 层，必定越界
      setupFs([]);
      const result = resolvePythonImport('....x', '/proj/a.py', '/proj');
      expect(result.kind).toBe('unresolved');
      expect(result.resolvedPath).toBeNull();
    });
  });

  // ─── TypeScript/JavaScript 场景 ──────────────────────────

  describe('resolveTsJsImport — 相对路径场景', () => {
    it('场景 7：./engine 相对路径 → kind=relative，resolvedPath=src/engine.ts', () => {
      setupFs(['/proj/src/engine.ts']);
      const result = resolveTsJsImport('./engine', '/proj/src/index.ts', '/proj', null);
      expect(result.kind).toBe('relative');
      expect(result.resolvedPath).toBe('src/engine.ts');
    });

    it('场景 15（W-1 修复）：./config.json 相对 JSON → kind=external，resolvedPath=null', () => {
      setupFs(['/proj/src/config.json']);
      const result = resolveTsJsImport('./config.json', '/proj/src/index.ts', '/proj', null);
      expect(result.kind).toBe('external');
      expect(result.resolvedPath).toBeNull();
    });

    it('场景 16（W-1 修复）：./types.d.ts 相对类型声明 → kind=external，resolvedPath=null', () => {
      setupFs(['/proj/src/types.d.ts']);
      const result = resolveTsJsImport('./types.d.ts', '/proj/src/index.ts', '/proj', null);
      expect(result.kind).toBe('external');
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('resolveTsJsImport — paths alias 场景', () => {
    it('场景 8（W-4 修复）：tsconfig paths exact key（无 wildcard）→ kind=paths-alias', () => {
      // "react": ["./src/types/react"] — 精确 key，无 *
      setupFs(['/proj/src/types/react.ts']);
      const ctx: TsConfigResolutionContext = {
        configDir: '/proj',
        baseUrl: null,
        paths: new Map([['react', ['./src/types/react']]]),
      };
      const result = resolveTsJsImport('react', '/proj/src/index.ts', '/proj', ctx);
      expect(result.kind).toBe('paths-alias');
      expect(result.resolvedPath).toBe('src/types/react.ts');
    });

    it('场景 9：tsconfig paths wildcard ~/* → src/* → kind=paths-alias', () => {
      setupFs(['/proj/src/utils.ts']);
      const ctx: TsConfigResolutionContext = {
        configDir: '/proj',
        baseUrl: null,
        paths: new Map([['~/*', ['./src/*']]]),
      };
      const result = resolveTsJsImport('~/utils', '/proj/app/index.ts', '/proj', ctx);
      expect(result.kind).toBe('paths-alias');
      expect(result.resolvedPath).toBe('src/utils.ts');
    });

    it('场景 10（W-4 修复）：paths multi candidates — 第一个不存在，第二个存在 → 命中第二个', () => {
      // @/*: ["./src/*", "./libs/*"]，/proj/src/utils.ts 不存在，/proj/libs/utils.ts 存在
      setupFs(['/proj/libs/utils.ts']);
      const ctx: TsConfigResolutionContext = {
        configDir: '/proj',
        baseUrl: null,
        paths: new Map([['@/*', ['./src/*', './libs/*']]]),
      };
      const result = resolveTsJsImport('@/utils', '/proj/app/index.ts', '/proj', ctx);
      expect(result.kind).toBe('paths-alias');
      expect(result.resolvedPath).toBe('libs/utils.ts');
    });
  });

  describe('resolveTsJsImport — baseUrl 场景', () => {
    it('场景 11：baseUrl="." → 解析 components/Button → kind=absolute', () => {
      setupFs(['/proj/components/Button.ts']);
      const ctx: TsConfigResolutionContext = {
        configDir: '/proj',
        baseUrl: '.',
        paths: new Map(),
      };
      const result = resolveTsJsImport('components/Button', '/proj/app/index.ts', '/proj', ctx);
      expect(result.kind).toBe('absolute');
      expect(result.resolvedPath).toBe('components/Button.ts');
    });
  });

  describe('resolveTsJsImport — external 包场景', () => {
    it('场景 12：express bare npm 包 → kind=external，resolvedPath=null', () => {
      setupFs([]);
      const result = resolveTsJsImport('express', '/proj/src/index.ts', '/proj', null);
      expect(result.kind).toBe('external');
      expect(result.resolvedPath).toBeNull();
    });

    it('场景 13：@org/lib scoped 包 → kind=external', () => {
      setupFs([]);
      const result = resolveTsJsImport('@org/lib', '/proj/src/index.ts', '/proj', null);
      expect(result.kind).toBe('external');
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('resolveTsJsImport — unresolved / fallback 场景', () => {
    it('场景 14（C-2 修复）：~/utils 但无 tsconfig → kind=unresolved', () => {
      setupFs([]);
      // tsConfigContext=null，alias-like 前缀无法解析
      const result = resolveTsJsImport('~/utils', '/proj/src/index.ts', '/proj', null);
      expect(result.kind).toBe('unresolved');
      expect(result.resolvedPath).toBeNull();
    });

    it('场景 17：tsconfig.json 不存在，传 undefined → unresolved，不崩溃', () => {
      setupFs([]);
      expect(() => {
        resolveTsJsImport('~/utils', '/proj/src/index.ts', '/proj', undefined);
      }).not.toThrow();
      const result = resolveTsJsImport('~/utils', '/proj/src/index.ts', '/proj', undefined);
      expect(result.kind).toBe('unresolved');
    });
  });

  // ─── findNearestTsConfig 场景 ─────────────────────────────

  describe('findNearestTsConfig — tsconfig.json 查找', () => {
    it('场景 18：monorepo nearest-config — 两层 tsconfig，返回最近的 configDir', () => {
      // /proj/tsconfig.json 和 /proj/packages/core/tsconfig.json 都存在
      // filePath 在 /proj/packages/core/src/index.ts
      // 预期返回 /proj/packages/core（最近的）
      setupFs(
        ['/proj/tsconfig.json', '/proj/packages/core/tsconfig.json'],
        {
          '/proj/tsconfig.json': JSON.stringify({ compilerOptions: {} }),
          '/proj/packages/core/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
        },
      );

      const result = findNearestTsConfig('/proj/packages/core/src/index.ts', '/proj');
      expect(result).not.toBeNull();
      expect(result!.configDir).toBe('/proj/packages/core');
    });

    it('tsconfig.json 不存在时返回 null，不抛异常', () => {
      setupFs([]);
      let result: ReturnType<typeof findNearestTsConfig>;
      expect(() => {
        result = findNearestTsConfig('/proj/src/index.ts', '/proj');
      }).not.toThrow();
      expect(result!).toBeNull();
    });
  });

  // ─── POSIX 路径场景 ───────────────────────────────────────

  describe('场景 19（W-5 修复）：resolvedPath 必须使用 POSIX 格式（含 /）', () => {
    it('Python 解析结果不含 Windows 路径分隔符', () => {
      setupFs(['/proj/micrograd/engine.py']);
      const result = resolvePythonImport('micrograd.engine', '/proj/main.py', '/proj');
      // 无论在哪个平台，resolvedPath 都应使用 '/' 分隔
      expect(result.resolvedPath).not.toContain('\\');
      if (result.resolvedPath !== null) {
        expect(result.resolvedPath).toContain('/');
      }
    });

    it('TS 解析结果不含 Windows 路径分隔符', () => {
      setupFs(['/proj/src/engine.ts']);
      const result = resolveTsJsImport('./engine', '/proj/src/index.ts', '/proj', null);
      expect(result.resolvedPath).not.toContain('\\');
    });
  });

  // ─── C-5 isInsideProjectRoot 修复 ────────────────────────

  describe('场景 20（C-5 修复）：isInsideProjectRoot 逐段判断，不用字典序比较', () => {
    it("projectRoot='/proj' + candidate='/projection' → 不被视为在 projectRoot 内", () => {
      // /projection 按字典序 > /proj，但不在 /proj 子树内
      // 验证：从 /proj/a.py 上溯 4 级（....x），会越界，返回 unresolved
      setupFs(['/projection/x.py']); // /projection 存在，但不在 /proj 内
      const result = resolvePythonImport('....x', '/proj/a.py', '/proj');
      expect(result.kind).toBe('unresolved');
    });
  });

  // ─── T-021a buildTsConfigContext ────────────────────────

  describe('T-021a：buildTsConfigContext rawConfig 转换', () => {
    it('完整 rawConfig 转换：baseUrl + paths 正确解析', () => {
      const rawConfig = {
        compilerOptions: {
          baseUrl: 'src',
          paths: { '~/*': ['./libs/*'] },
        },
      };
      const ctx = buildTsConfigContext(rawConfig, '/proj');
      expect(ctx.configDir).toBe('/proj');
      expect(ctx.baseUrl).toBe('src');
      expect(ctx.paths).toBeInstanceOf(Map);
      expect(ctx.paths.get('~/*')).toEqual(['./libs/*']);
    });

    it('缺少 compilerOptions → baseUrl=null，paths=空 Map', () => {
      const rawConfig: Record<string, unknown> = {};
      const ctx = buildTsConfigContext(rawConfig, '/proj');
      expect(ctx.configDir).toBe('/proj');
      expect(ctx.baseUrl).toBeNull();
      expect(ctx.paths.size).toBe(0);
    });

    it('compilerOptions 存在但无 baseUrl → baseUrl=null', () => {
      const rawConfig = { compilerOptions: { paths: { '@/*': ['./src/*'] } } };
      const ctx = buildTsConfigContext(rawConfig, '/proj');
      expect(ctx.baseUrl).toBeNull();
      expect(ctx.paths.get('@/*')).toEqual(['./src/*']);
    });

    it('compilerOptions 存在但无 paths → paths=空 Map', () => {
      const rawConfig = { compilerOptions: { baseUrl: '.' } };
      const ctx = buildTsConfigContext(rawConfig, '/proj');
      expect(ctx.baseUrl).toBe('.');
      expect(ctx.paths.size).toBe(0);
    });
  });

  // ─── Codex P0 复审修复 ──────────────────────────────────

  describe('Codex P0 C-1 修复：paths 精确 key 优先于 wildcard', () => {
    it('当 wildcard 排在 exact 前（Map 插入顺序），仍优先匹配 exact key', () => {
      // 用户 tsconfig 的 paths 中 '~/*' 排在 'react' 前；resolveTsJsImport
      // 不应按 Map 插入顺序，必须显式分组 exact 优先
      setupFs(['/proj/src/types/react.ts', '/proj/src/react.ts']);
      const ctx: TsConfigResolutionContext = {
        configDir: '/proj',
        baseUrl: null,
        paths: new Map([
          ['~/*', ['./src/*']], // wildcard，会匹配 ~/anything
          ['react', ['./src/types/react']], // exact key
        ]),
      };
      const result = resolveTsJsImport('react', '/proj/src/main.ts', '/proj', ctx);
      expect(result.kind).toBe('paths-alias');
      // 必须命中 exact key（src/types/react.ts），不是 wildcard 的副作用解析
      expect(result.resolvedPath).toBe('src/types/react.ts');
    });
  });

  describe('Codex P0 C-2 修复：baseUrl undefined 不触发解析', () => {
    it('TsConfigResolutionContext.baseUrl 显式 undefined 时不进入 baseUrl 分支', () => {
      // 模拟非 TypeScript 严格调用方传入 baseUrl: undefined（绕过 string|null 类型）
      const ctx = {
        configDir: '/proj',
        baseUrl: undefined,
        paths: new Map<string, string[]>(),
      } as unknown as TsConfigResolutionContext;
      // bare 包名 + paths 全空 → 应返回 external（npm 包），不因 undefined 误执行 baseUrl 解析
      const result = resolveTsJsImport('express', '/proj/src/main.ts', '/proj', ctx);
      expect(result.kind).toBe('external');
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('Codex P0 C-3 修复：findNearestTsConfig 边界检查先于 fs 访问', () => {
    it("从 /projection 上溯不会读取 /proj 边界外的 tsconfig", () => {
      // 同时创建 /proj/tsconfig.json 和 /projection/tsconfig.json
      // 从 /projection/a.ts 上溯，projectRoot=/proj：
      // /projection 不在 /proj 子树内（C-5 修复 isInsideProjectRoot 逐段判断已生效）
      // 关键：findNearestTsConfig 必须**先**做边界检查再 fs.existsSync 探查
      setupFs([
        '/projection/tsconfig.json',
        '/projection/a.ts',
        '/proj/tsconfig.json',
      ]);
      const result = findNearestTsConfig('/projection/a.ts', '/proj');
      // 期望：因为 /projection 不在 /proj 内，循环立即终止；不返回任何 tsconfig
      expect(result).toBeNull();
    });
  });

  describe('quality-review CRITICAL 修复：findNearestTsConfig 损坏 tsconfig.json 不抛异常', () => {
    it('损坏的 tsconfig.json（语法错误）→ 跳过继续上溯，最终返回 null 不抛异常', () => {
      // 在 /proj/inner 放一个损坏的 tsconfig.json，/proj 无 tsconfig
      // 调用 findNearestTsConfig('/proj/inner/a.ts', '/proj') 应：
      // 1. 在 /proj/inner 发现 tsconfig.json，但 JSON.parse 抛异常
      // 2. catch 后继续上溯到 /proj，未发现 tsconfig
      // 3. 返回 null，**不**抛异常
      const corruptedJson = '{"compilerOptions": {invalid syntax/* with comment */}}';
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const ps = String(p);
        return ps === '/proj/inner/tsconfig.json';
      });
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        const ps = String(p);
        if (ps === '/proj/inner/tsconfig.json') return corruptedJson;
        throw new Error('unexpected read');
      });

      // 不应抛异常
      let result: ReturnType<typeof findNearestTsConfig> | undefined;
      expect(() => {
        result = findNearestTsConfig('/proj/inner/a.ts', '/proj');
      }).not.toThrow();
      // 损坏的 tsconfig 被跳过，上溯到 /proj 无 tsconfig → null
      expect(result).toBeNull();
    });
  });
});
