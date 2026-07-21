/**
 * F220 G3 — batch-orchestrator 导出面合同守护（ts-morph 版）
 *
 * Codex G 层审查 C4/C5 修复：初版用正则做文本合同，可被注释（`// export { runBatch }`）、
 * 字符串字面量、`export type { X as Y }` 别名、`export type * from`、`.././` 拼写、
 * 动态 import()、子目录相对路径等平凡绕过。本版全部改用 TypeScript 编译器事实：
 * 1. `getExportedDeclarations()` 枚举 facade 真实导出面（名字 + 声明种类），与冻结的
 *    14 符号（11 value + 3 interface）做双向精确断言 —— 注释/字符串/别名无法伪装
 * 2. star export（含 `export type *`）由 ExportDeclaration AST 节点直接禁止
 * 3. stage 依赖矩阵：递归扫描 stages/**，收集静态 import / re-export / 动态 import()
 *    的 module specifier，path.resolve 归一化后比对 —— 拼写变体一律现形；
 *    允许边仅 ②graph-assembly → ①source-discovery，其余 stage 间边与任何
 *    stage → facade 边（ESM 环 TDZ 风险）全部拒绝
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Project, SyntaxKind, type SourceFile } from 'ts-morph';

import * as orchestrator from '../../../src/batch/batch-orchestrator.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FACADE_PATH = join(REPO_ROOT, 'src', 'batch', 'batch-orchestrator.ts');
const STAGES_DIR = join(REPO_ROOT, 'src', 'batch', 'stages');

/** 冻结的 runtime value 导出（interface 在运行时擦除，不在此列） */
const FROZEN_VALUE_EXPORTS = [
  'PY_SKELETON_IGNORE_DIRS',
  'TSJS_SKELETON_IGNORE_DIRS',
  'buildAstGraphOnly',
  'buildDesignDocAbsPaths',
  'collectPythonCodeSkeletons',
  'collectTsJsCodeSkeletons',
  'detectCrossLanguageRefs',
  'generateCrossLanguageHint',
  'mergeGraphsForTopologicalSort',
  'normalizeConcurrency',
  'runBatch',
] as const;

/** 冻结的 type-only 导出 */
const FROZEN_TYPE_EXPORTS = ['BatchOptions', 'BatchResult', 'GraphOnlyResult'] as const;

/**
 * stage 间允许依赖边（Spectra impact 实证：buildAstGraphOnly(②) 调用 skeleton 采集器(①)，
 * 单向无环）。矩阵外的任何 stage→stage 边 = 红。
 */
const ALLOWED_STAGE_EDGES = new Set(['graph-assembly.ts→source-discovery.ts']);

function listStageFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listStageFilesRecursive(abs));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

/** 收集一个源文件的全部 module specifier（静态 import / re-export from / 动态 import()） */
function collectModuleSpecifiers(sf: SourceFile): string[] {
  const specs: string[] = [];
  for (const imp of sf.getImportDeclarations()) {
    specs.push(imp.getModuleSpecifierValue());
  }
  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (spec) specs.push(spec);
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const arg = call.getArguments()[0];
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
      specs.push(arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue());
    }
  }
  return specs;
}

/** 相对 specifier → 归一化绝对路径（去 .js/.ts 后缀，供跨拼写比对） */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // 裸包名/别名：非相对路径，另行断言
  return resolve(dirname(fromFile), spec).replace(/\.(js|ts|mjs|mts)$/, '');
}

describe('F220 导出面合同（G3 / ts-morph）', () => {
  it('runtime 导出集合与冻结的 11 个 value 符号双向差集为空', () => {
    const actual = Object.keys(orchestrator).sort();
    expect(actual).toEqual([...FROZEN_VALUE_EXPORTS].sort());
  });

  it('编译器级导出面：14 符号双向精确 + value/type 种类正确 + 无别名伪装', () => {
    const project = new Project({ compilerOptions: { allowJs: false }, skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(FACADE_PATH);
    // re-export 目标文件需在 project 内才能解析声明种类
    if (existsSync(STAGES_DIR)) {
      for (const f of listStageFilesRecursive(STAGES_DIR)) project.addSourceFileAtPath(f);
    }

    const exported = sf.getExportedDeclarations();
    const exportedNames = [...exported.keys()].sort();
    expect(exportedNames).toEqual([...FROZEN_VALUE_EXPORTS, ...FROZEN_TYPE_EXPORTS].sort());

    for (const typeName of FROZEN_TYPE_EXPORTS) {
      const decls = exported.get(typeName) ?? [];
      expect(decls.length, `${typeName} 声明缺失`).toBeGreaterThan(0);
      for (const d of decls) {
        expect(d.getKind(), `${typeName} 应为 interface`).toBe(SyntaxKind.InterfaceDeclaration);
      }
    }
    for (const valueName of FROZEN_VALUE_EXPORTS) {
      const decls = exported.get(valueName) ?? [];
      expect(decls.length, `${valueName} 声明缺失`).toBeGreaterThan(0);
      for (const d of decls) {
        expect(
          [SyntaxKind.FunctionDeclaration, SyntaxKind.VariableDeclaration].includes(d.getKind()),
          `${valueName} 应为 function/const（实际 kind=${d.getKindName()}）`,
        ).toBe(true);
      }
    }
  });

  it('facade 禁用 star export（含 export type * —— AST 级检测，注释无法伪装）', () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(FACADE_PATH);
    const starExports = sf.getExportDeclarations().filter((d) => !d.hasNamedExports());
    expect(
      starExports.map((d) => d.getText()),
      'facade 不得使用 export * / export type *',
    ).toEqual([]);
  });

  it('stage 依赖矩阵：禁 import facade（任意拼写/动态 import）；stage 间仅允许 ②→①', () => {
    if (!existsSync(STAGES_DIR)) return; // B0 之前 stages 尚不存在，合同空转通过
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const facadeResolved = FACADE_PATH.replace(/\.ts$/, '');
    const stageFiles = listStageFilesRecursive(STAGES_DIR);
    const violations: string[] = [];

    for (const file of stageFiles) {
      const sf = project.addSourceFileAtPath(file);
      const fileName = file.slice(STAGES_DIR.length + 1);
      for (const spec of collectModuleSpecifiers(sf)) {
        // 裸包名（p-limit 等三方依赖）放行，但任何非相对 specifier 不得指向 facade
        if (!spec.startsWith('.')) {
          if (/batch-orchestrator/.test(spec)) violations.push(`${fileName}: 非相对路径指向 facade (${spec})`);
          continue;
        }
        const resolved = resolveSpecifier(file, spec);
        if (resolved === facadeResolved) {
          violations.push(`${fileName}: import facade (${spec})`);
          continue;
        }
        // stage → stage 边收集（解析路径落在 stages/ 内）
        if (resolved && resolved.startsWith(STAGES_DIR)) {
          const target = resolved.slice(STAGES_DIR.length + 1) + '.ts';
          const edge = `${fileName}→${target}`;
          if (fileName !== target && !ALLOWED_STAGE_EDGES.has(edge)) {
            violations.push(`${fileName}: 未授权 stage 依赖边 ${edge}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
