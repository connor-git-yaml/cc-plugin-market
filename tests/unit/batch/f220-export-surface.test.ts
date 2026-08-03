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
 * 4. 生产文件（facade + stages）禁止 import 测试命名模块（*.test/*.spec）—— 保证 F244
 *    引入的「共置测试豁免」不会被反向利用为生产 ESM 图逃逸面：tsconfig 的
 *    `exclude: src/**\/*.test.ts` 只管根文件发现，不管被生产代码 import 的文件是否
 *    进入编译闭包与 dist 产物
 * 5. stages/ 共置测试禁止 import facade —— 测试可自由 import stage 模块（F243 合法用例），
 *    但不得成为 facade ESM 环的闭合边（Codex delta 轮 CRITICAL：facade → 生产 stage
 *    bridge.ts → 共置测试豁免的 evil.spec.ts → 反向 import facade，二跳桥接绕过①②③④
 *    全部检查）
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
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

/**
 * 共置测试文件命名模式（仓库测试命名惯例：`*.test.ts` / `*.spec.ts`），收集器需排除。
 * 排除本身不构成生产 ESM 图逃逸面 —— 该安全性由「生产文件禁止 import 测试命名模块」
 * 合同保证（见 collectTestNamedImportViolations）。收集器前置条件已 `endsWith('.ts')`，
 * 故 `.mts` 变体在此分支不可达，不纳入本正则。
 */
const COLOCATED_TEST_RE = /\.(test|spec)\.ts$/;

function listStageFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listStageFilesRecursive(abs));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !COLOCATED_TEST_RE.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

/** 收集 stages/ 下共置测试文件（*.test.ts / *.spec.ts），供「共置测试禁止 import facade」判定使用 */
function listColocatedTestFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listColocatedTestFilesRecursive(abs));
    else if (entry.isFile() && entry.name.endsWith('.ts') && COLOCATED_TEST_RE.test(entry.name)) {
      out.push(abs);
    }
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
  // query/hash 变体与 cjs/cts 后缀归一化，防拼写变体绕过（同时闭合矩阵侧同源盲区）
  spec = spec.replace(/[?#].*$/, '');
  return resolve(dirname(fromFile), spec).replace(/\.(js|ts|mjs|mts|cjs|cts)$/, '');
}

/**
 * 依赖矩阵违规判定（从既有「stage 依赖矩阵」it 块提取为纯函数，逻辑与消息文案一字不改，
 * 仅将硬编码的 STAGES_DIR/FACADE_PATH/ALLOWED_STAGE_EDGES 替换为形参），
 * 使其可用 fixture 目录独立驱动，与真实 stages/ 扫描解耦。
 */
function collectStageViolations(
  stageFiles: string[],
  stagesDir: string,
  facadePath: string,
  allowedEdges: ReadonlySet<string> = ALLOWED_STAGE_EDGES,
): string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const facadeResolved = facadePath.replace(/\.ts$/, '');
  const violations: string[] = [];

  for (const file of stageFiles) {
    const sf = project.addSourceFileAtPath(file);
    const fileName = file.slice(stagesDir.length + 1);
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
      if (resolved && resolved.startsWith(stagesDir)) {
        const target = resolved.slice(stagesDir.length + 1) + '.ts';
        const edge = `${fileName}→${target}`;
        if (fileName !== target && !allowedEdges.has(edge)) {
          violations.push(`${fileName}: 未授权 stage 依赖边 ${edge}`);
        }
      }
    }
  }
  return violations;
}

/**
 * 共置测试禁止 import facade 判定（拦截点与 HEAD 时代等价，仅豁免 stage→stage 矩阵边）。
 *
 * 背景（Codex delta 轮 CRITICAL）：F244 把共置测试整体逐出 collectStageViolations 扫描集后，
 * 出现二跳桥接绕过：facade → ./bridge.js（bridge.ts 位于 src/batch/ 等扫描集之外——既非 facade
 * 也非 stages/ 生产模块，出边从不被本守护检查）→
 * bridge → ./stages/evil.spec.js（共置测试豁免，未被任何判定扫描到）→
 * evil.spec.ts → ../batch-orchestrator.js（构成 facade ESM 环，HEAD 时代会被拒但现在漏检）。
 * 本函数恢复"共置测试禁止 import facade"的独立检查，但**不检查 stage→stage 边**——
 * 那正是 F243 要保留的合法用例（测试可自由 import 被测 stage 模块）。
 */
function collectColocatedTestFacadeViolations(
  testFiles: string[],
  stagesDir: string,
  facadePath: string,
): string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const facadeResolved = facadePath.replace(/\.ts$/, '');
  const violations: string[] = [];

  for (const file of testFiles) {
    const sf = project.addSourceFileAtPath(file);
    const fileName = file.slice(stagesDir.length + 1);
    for (const spec of collectModuleSpecifiers(sf)) {
      // 裸包名/别名：非相对路径不得指向 facade
      if (!spec.startsWith('.')) {
        if (/batch-orchestrator/.test(spec)) {
          violations.push(`${fileName}: 共置测试禁止 import facade (${spec})`);
        }
        continue;
      }
      const resolved = resolveSpecifier(file, spec);
      if (resolved === facadeResolved) {
        violations.push(`${fileName}: 共置测试禁止 import facade (${spec})`);
      }
      // 注意：不检查 resolved 是否落在 stagesDir 内的 stage→stage 边——
      // 测试 import 被测 stage 模块是 F243 认定的合法用例，非本判定职责范围。
    }
  }
  return violations;
}

/**
 * 生产文件（facade + stages）导入面合同：禁止 import 测试命名模块（*.test/*.spec）。
 *
 * 背景：tsconfig 的 `exclude: src/**\/*.test.ts` 只约束"编译器自动发现的根文件"，
 * 并不阻止生产文件显式 import 一个测试命名文件、进而把该文件拖入编译闭包与 dist 产物 ——
 * F244 为共置测试新增的收集器豁免（COLOCATED_TEST_RE）如果没有这条合同兜底，
 * 会变成"生产代码经由共置测试文件反向拉测试图"的逃逸面（Codex W1）。
 * 判定覆盖两类 specifier：
 * 1. 相对路径：经 resolveSpecifier 归一化（已去 .js/.ts/.mjs/.mts 后缀）后以 .test/.spec 结尾；
 * 2. 非相对路径（裸包名/别名）：字面量本身携带 .test.<ext> / .spec.<ext> 后缀。
 */
function collectTestNamedImportViolations(productionFiles: string[]): string[] {
  const violations: string[] = [];
  // 检测侧大小写不敏感（/i）= 保护面扩大，防止 .TEST.ts / .Spec.js 等变体绕过；
  // 豁免侧 COLOCATED_TEST_RE 保持大小写敏感 = 保守 fail-closed，宁可少豁免不多放行。
  const bareTestSpecRe = /\.(test|spec)\.(js|ts|mjs|mts|cjs)(?:$|\?)/i;
  const resolvedTestSuffixRe = /\.(test|spec)$/i;

  for (const file of productionFiles) {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(file);
    for (const spec of collectModuleSpecifiers(sf)) {
      if (spec.startsWith('.')) {
        const resolved = resolveSpecifier(file, spec);
        if (resolved && resolvedTestSuffixRe.test(resolved)) {
          violations.push(`${basename(file)}: 生产文件 import 测试命名模块 (${spec})`);
        }
      } else if (bareTestSpecRe.test(spec)) {
        violations.push(`${basename(file)}: 生产文件 import 测试命名模块 (${spec})`);
      }
    }
  }
  return violations;
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
    const stageFiles = listStageFilesRecursive(STAGES_DIR);
    const violations = collectStageViolations(stageFiles, STAGES_DIR, FACADE_PATH);
    expect(violations).toEqual([]);
  });

  it('生产文件（facade + stages 生产模块）禁止 import 测试命名模块', () => {
    if (!existsSync(STAGES_DIR)) return; // B0 之前 stages 尚不存在，合同空转通过
    const productionFiles = [FACADE_PATH, ...listStageFilesRecursive(STAGES_DIR)];
    const violations = collectTestNamedImportViolations(productionFiles);
    expect(violations).toEqual([]);
  });

  it('stages/ 共置测试禁止 import facade（防 facade ESM 环经测试文件闭合）', () => {
    if (!existsSync(STAGES_DIR)) return; // B0 之前 stages 尚不存在，合同空转通过
    const testFiles = listColocatedTestFilesRecursive(STAGES_DIR);
    const violations = collectColocatedTestFacadeViolations(testFiles, STAGES_DIR, FACADE_PATH);
    expect(violations).toEqual([]);
  });
});

describe('F244 共置测试排除回归（收集器 + 违规判定纯函数）', () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('绿：共置测试（a.test.ts import 被测模块 a.ts）不参与判定，零 violation', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f243-stage-guard-'));
    const stagesDir = join(tmpDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    writeFileSync(join(stagesDir, 'a.ts'), 'export function a() {}\n');
    writeFileSync(
      join(stagesDir, 'a.test.ts'),
      "import { a } from './a.js';\nexport function useA() { return a(); }\n",
    );
    writeFileSync(join(stagesDir, 'a.spec.ts'), "import './a.js';\n");
    const facadePath = join(tmpDir, 'facade.ts');

    const stageFiles = listStageFilesRecursive(stagesDir);
    expect(stageFiles).not.toContain(join(stagesDir, 'a.test.ts'));
    expect(stageFiles).not.toContain(join(stagesDir, 'a.spec.ts'));
    expect(stageFiles).toContain(join(stagesDir, 'a.ts'));

    const violations = collectStageViolations(stageFiles, stagesDir, facadePath);
    expect(violations).toEqual([]);
  });

  it('红①：矩阵外 stage 间边（a.ts import ./b.ts）仍被拦截', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f243-stage-guard-'));
    const stagesDir = join(tmpDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    writeFileSync(join(stagesDir, 'a.ts'), "import { b } from './b.js';\nexport function a() { return b(); }\n");
    writeFileSync(join(stagesDir, 'b.ts'), 'export function b() {}\n');
    const facadePath = join(tmpDir, 'facade.ts');

    const stageFiles = listStageFilesRecursive(stagesDir);
    const violations = collectStageViolations(stageFiles, stagesDir, facadePath);
    expect(violations).toContain('a.ts: 未授权 stage 依赖边 a.ts→b.ts');
  });

  it('红②：生产模块 import facade 仍被拦截', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f243-stage-guard-'));
    const stagesDir = join(tmpDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    writeFileSync(
      join(stagesDir, 'a.ts'),
      "import { runBatch } from '../facade.js';\nexport function a() { return runBatch; }\n",
    );
    const facadePath = join(tmpDir, 'facade.ts');

    const stageFiles = listStageFilesRecursive(stagesDir);
    const violations = collectStageViolations(stageFiles, stagesDir, facadePath);
    expect(violations.some((v) => v.startsWith('a.ts: import facade'))).toBe(true);
  });

  it('红③：facade 经 import 测试命名文件反向拉测试图仍被拦截（W1 绕过场景复刻）', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f243-stage-guard-'));
    const stagesDir = join(tmpDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    const facadePath = join(tmpDir, 'facade.ts');
    writeFileSync(facadePath, "import './stages/evil.spec.js';\n");
    writeFileSync(join(stagesDir, 'evil.spec.ts'), "import '../facade.js';\n");

    const violations = collectTestNamedImportViolations([facadePath]);
    expect(violations.some((v) => v.includes('facade.ts: 生产文件 import 测试命名模块'))).toBe(true);
  });

  it('红④：测试命名 specifier 解析落在 stages 目录外仍被拦截（第二盲区）', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f243-stage-guard-'));
    const stagesDir = join(tmpDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    const aPath = join(stagesDir, 'a.ts');
    writeFileSync(aPath, "import { h } from '../shared/helper.test.js';\nexport function a() { return h; }\n");

    const violations = collectTestNamedImportViolations([aPath]);
    expect(violations.some((v) => v.includes('a.ts: 生产文件 import 测试命名模块'))).toBe(true);
  });

  it('红⑤：共置测试 import facade 触发违规判定（二跳桥接绕过复刻）；同时 import stage 模块（F243 合法用例）不产生 violation', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f243-colocated-facade-'));
    const stagesDir = join(tmpDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    writeFileSync(join(stagesDir, 'a.ts'), 'export function a() {}\n');
    writeFileSync(join(stagesDir, 'evil.spec.ts'), "import '../facade.js';\n");
    writeFileSync(join(stagesDir, 'clean.spec.ts'), "import './a.js';\n");
    const facadePath = join(tmpDir, 'facade.ts');

    const testFiles = listColocatedTestFilesRecursive(stagesDir);
    const violations = collectColocatedTestFacadeViolations(testFiles, stagesDir, facadePath);

    expect(violations).toContain('evil.spec.ts: 共置测试禁止 import facade (../facade.js)');
    expect(violations.some((v) => v.includes('clean.spec.ts'))).toBe(false);
  });

  it('红⑥：resolveSpecifier 归一化 query/hash 与 cjs 后缀变体，防止测试命名判定被绕过', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f243-query-cjs-'));
    const stagesDir = join(tmpDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    const aPath = join(stagesDir, 'a.ts');
    writeFileSync(
      aPath,
      "import { h } from './b.spec.js?v=1';\nimport { g } from './c.spec.cjs';\nexport function a() { return h ?? g; }\n",
    );

    const violations = collectTestNamedImportViolations([aPath]);
    expect(violations.some((v) => v.includes('a.ts: 生产文件 import 测试命名模块 (./b.spec.js?v=1)'))).toBe(true);
    expect(violations.some((v) => v.includes('a.ts: 生产文件 import 测试命名模块 (./c.spec.cjs)'))).toBe(true);
  });
});
