/**
 * Feature 152 T-015 — TsJsLanguageAdapter 双路径 callSites merge 单测
 *
 * 覆盖 5 个场景（FR-5.3 + EC-11 + EC-1 降级）：
 *  1. extractCallSites=false（默认）→ CodeSkeleton.callSites 为 undefined（不含 callSites）
 *  2. extractCallSites=true + .ts 文件 → callSites 非空数组，含真实调用点
 *  3. extractCallSites=true + 无调用的 .ts 文件 → callSites=[]
 *  4. EC-11 隔离验证：merge 后 exports 来源仍为 ts-morph（含类型注解），不被 tree-sitter 覆盖
 *  5. .tsx 文件 + extractCallSites=true → tree-sitter 若 throw，降级为空 callSites，不抛异常
 *
 * 实施约束：
 * - 直接调用 new TsJsLanguageAdapter().analyzeFile()
 * - 使用 mkdtempSync 构造临时文件 fixture，不依赖固定路径
 */
import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';

// ============================================================
// 测试辅助函数
// ============================================================

const adapter = new TsJsLanguageAdapter();

/**
 * 将 TypeScript/TSX 源码写入临时文件，调用 adapter.analyzeFile()，返回 CodeSkeleton。
 * 测试结束后清理临时目录。
 */
async function analyzeSnippet(
  code: string,
  ext: '.ts' | '.tsx' | '.js' | '.jsx',
  options?: Parameters<TsJsLanguageAdapter['analyzeFile']>[1],
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-ts-adapter-'));
  const filePath = path.join(tmpDir, `snippet${ext}`);
  fs.writeFileSync(filePath, code, 'utf-8');
  try {
    return await adapter.analyzeFile(filePath, options);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// 测试套件
// ============================================================

describe('TsJsLanguageAdapter.analyzeFile — 双路径 callSites merge (Feature 152 T-015)', () => {
  /**
   * 场景 1：extractCallSites 默认关闭（undefined/false）
   * 期望：CodeSkeleton.callSites 为 undefined（ts-morph 单路径，不含 callSites）
   * 对应 FR-5.2：性能不回归
   */
  it('场景 1 — extractCallSites=false（默认）→ callSites=undefined', async () => {
    const code = `
export function foo(x: number): string {
  return String(x);
}

export function bar(): void {
  foo(42);
}
`;
    const skeleton = await analyzeSnippet(code, '.ts');
    // 默认路径：不传 extractCallSites=true，callSites 不输出
    expect(skeleton.callSites).toBeUndefined();
  });

  /**
   * 场景 2：extractCallSites=true + .ts 文件（含真实调用）
   * 期望：callSites 为非空数组，包含真实调用点信息
   * 对应 FR-5.3：双路径 merge
   */
  it('场景 2 — extractCallSites=true + .ts 含调用 → callSites 非空', async () => {
    const code = `
export function helper(n: number): number {
  return n * 2;
}

export function main(): number {
  return helper(21);
}
`;
    const skeleton = await analyzeSnippet(code, '.ts', { extractCallSites: true });
    // 双路径：callSites 应该是数组（非 undefined）
    expect(skeleton.callSites).toBeDefined();
    expect(Array.isArray(skeleton.callSites)).toBe(true);
    // 至少包含 helper() 调用
    const helperCall = skeleton.callSites!.find((c) => c.calleeName === 'helper');
    expect(helperCall).toBeDefined();
  });

  /**
   * 场景 3：extractCallSites=true + .ts 文件（无函数调用）
   * 期望：callSites=[]（空数组，不为 undefined）
   */
  it('场景 3 — extractCallSites=true + 无调用的 .ts → callSites=[]', async () => {
    const code = `
// 纯类型定义，无函数调用
export interface Config {
  host: string;
  port: number;
}

export const DEFAULT_PORT = 8080;
`;
    const skeleton = await analyzeSnippet(code, '.ts', { extractCallSites: true });
    // 无调用时 callSites 为空数组（tree-sitter 路径返回 []）
    expect(skeleton.callSites).toBeDefined();
    expect(Array.isArray(skeleton.callSites)).toBe(true);
    expect(skeleton.callSites!.length).toBe(0);
  });

  /**
   * 场景 4：EC-11 隔离验证
   * 双路径 merge 后，exports 来源仍为 ts-morph（含完整类型注解 signature）；
   * 不被 tree-sitter 路径覆盖。
   *
   * ts-morph 能提供带类型注解的 signature（如 'function foo(x: number): string'），
   * 而 tree-sitter 只能提供原始文本；EC-11 要求 merge 后只取 tree-sitter 的 callSites，
   * exports/imports 必须来自 ts-morph 主路径。
   */
  it('场景 4 — EC-11 隔离：merge 后 exports signature 含类型注解（来自 ts-morph）', async () => {
    const code = `
export function process(input: string, count: number): boolean {
  return input.length > count;
}
`;
    const skeleton = await analyzeSnippet(code, '.ts', { extractCallSites: true });

    // exports 应包含 process 函数（来自 ts-morph）
    expect(skeleton.exports.length).toBeGreaterThan(0);
    const processExport = skeleton.exports.find((e) => e.name === 'process');
    expect(processExport).toBeDefined();

    // ts-morph 的 signature 包含类型注解（tree-sitter 无法提供完整类型信息）
    expect(processExport!.signature).toContain('string');
    expect(processExport!.signature).toContain('number');
    expect(processExport!.signature).toContain('boolean');

    // parserUsed 应为 'ts-morph'（主路径）
    expect(skeleton.parserUsed).toBe('ts-morph');
  });

  /**
   * 场景 5：.tsx 文件 + extractCallSites=true
   * 若 tree-sitter 路径 throw（dialect 不可用等），
   * 期望：安全降级为空 callSites（callSites=[]），不抛异常，主路径结果完整保留。
   * 对应 EC-1：dialect 兼容降级
   */
  it('场景 5 — .tsx 文件 + extractCallSites=true → 不抛异常（EC-1 降级）', async () => {
    // 最小 TSX 组件：即使 tree-sitter 路径失败，主路径结果应完整
    const code = `
import React from 'react';

export interface ButtonProps {
  label: string;
  onClick: () => void;
}

export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
  return <button onClick={onClick}>{label}</button>;
};
`;
    // 不抛异常是核心验证点（直接 await，若抛出则测试自然失败）
    const skeleton = await analyzeSnippet(code, '.tsx', { extractCallSites: true });

    // 主路径结果完整保留
    expect(skeleton).toBeDefined();
    expect(skeleton.exports.length).toBeGreaterThan(0);
    // callSites 应为数组（可能为空，EC-1 降级后为 []，或 tree-sitter 成功则有内容）
    expect(Array.isArray(skeleton.callSites)).toBe(true);
  });

  // ─── Codex P2 复审补测（W-1 / W-2 / W-3）─────────────────

  /**
   * Codex P2 W-2 修复：spy-based EC-11 隔离强证
   * 验证：tree-sitter 返回的 sentinel exports/imports/parseErrors 不会泄漏到最终结果，
   * 仅 callSites 被采用。
   */
  it('场景 6 — W-2: spy 验证 EC-11 隔离 — 仅 callSites 被采用', async () => {
    const { TreeSitterAnalyzer } = await import('../../src/core/tree-sitter-analyzer.js');
    const { vi } = await import('vitest');

    const sentinelCallSite = {
      calleeName: 'sentinelCallee',
      calleeKind: 'free' as const,
      line: 999,
    };
    const sentinelExport = {
      name: 'SENTINEL_TS_EXPORT',
      kind: 'function' as const,
      signature: 'function SENTINEL_TS_EXPORT()',
      jsDoc: null,
      isDefault: false,
      startLine: 1,
      endLine: 1,
    };
    const sentinelImport = {
      moduleSpecifier: 'sentinel-tsmodule',
      isRelative: false,
      resolvedPath: null,
      isTypeOnly: false,
    };
    const spy = vi
      .spyOn(TreeSitterAnalyzer.getInstance(), 'analyze')
      .mockResolvedValue({
        filePath: '/sentinel.ts',
        language: 'typescript',
        loc: 1,
        exports: [sentinelExport],
        imports: [sentinelImport],
        parseErrors: undefined,
        hash: 'sentinel-hash',
        analyzedAt: '2026-05-08T00:00:00Z',
        parserUsed: 'tree-sitter',
        callSites: [sentinelCallSite],
      });

    try {
      const code = `export function realFunc(x: number): string { return ""; }`;
      const skeleton = await analyzeSnippet(code, '.ts', { extractCallSites: true });

      // EC-11：sentinel exports/imports 不应出现在结果中
      expect(skeleton.exports.find((e) => e.name === 'SENTINEL_TS_EXPORT')).toBeUndefined();
      expect(skeleton.imports.find((i) => i.moduleSpecifier === 'sentinel-tsmodule')).toBeUndefined();
      // 但 callSites 应该来自 sentinel
      expect(skeleton.callSites).toEqual([sentinelCallSite]);
      // exports 应该是 ts-morph 真实输出（含 realFunc）
      expect(skeleton.exports.find((e) => e.name === 'realFunc')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * Codex P2 W-1 修复：tree-sitter 返回 parseErrors 非空时降级
   * 即使没抛异常，只要有 parseErrors，callSites 必须强制为 []
   */
  it('场景 7 — W-1: tree-sitter parseErrors 非空时强制降级 callSites=[]', async () => {
    const { TreeSitterAnalyzer } = await import('../../src/core/tree-sitter-analyzer.js');
    const { vi } = await import('vitest');

    const spy = vi
      .spyOn(TreeSitterAnalyzer.getInstance(), 'analyze')
      .mockResolvedValue({
        filePath: '/erroneous.tsx',
        language: 'typescript',
        loc: 1,
        exports: [],
        imports: [],
        parseErrors: [{ line: 1, column: 0, message: 'unexpected JSX element' }],
        hash: 'h',
        analyzedAt: '2026-05-08T00:00:00Z',
        parserUsed: 'tree-sitter',
        callSites: [
          { calleeName: 'unreliable', calleeKind: 'free' as const, line: 1 },
        ],
      });

    try {
      const code = `export const x = 1;`;
      const skeleton = await analyzeSnippet(code, '.tsx', { extractCallSites: true });
      // 即使 tree-sitter 给了 callSites，因 parseErrors 非空，强制降级
      expect(skeleton.callSites).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * Codex P2 W-3 修复：.js 文件双路径 merge 集成验证
   */
  it('场景 8 — W-3: .js 文件 extractCallSites=true → callSites 非空', async () => {
    const code = `
function foo() { bar(); }
function bar() {}
`;
    const skeleton = await analyzeSnippet(code, '.js', { extractCallSites: true });
    expect(Array.isArray(skeleton.callSites)).toBe(true);
    // js 文件经 typescript-mapper 处理（已注册 javascript），应能抽到 bar 的 free call
    const barCall = skeleton.callSites?.find((c) => c.calleeName === 'bar');
    expect(barCall).toBeDefined();
    expect(barCall?.calleeKind).toBe('free');
  });

  /**
   * Codex P2 W-3 修复：.jsx 文件不抛异常
   */
  it('场景 9 — W-3: .jsx 文件 extractCallSites=true → 不抛异常，callSites 是数组', async () => {
    const code = `
function App() {
  doSomething();
  return <div>x</div>;
}
function doSomething() {}
`;
    const skeleton = await analyzeSnippet(code, '.jsx', { extractCallSites: true });
    expect(Array.isArray(skeleton.callSites)).toBe(true);
  });
});
