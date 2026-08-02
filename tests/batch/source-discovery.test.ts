/**
 * F243 — walkTsJsFiles / collectTsJsCodeSkeletons 的 .mjs/.cjs 覆盖回归测试
 *
 * 背景：walkTsJsFiles 的 endsWith 白名单此前只收 .ts/.tsx/.js/.jsx，与
 * TsJsLanguageAdapter.extensions 的声明面（含 .mjs/.cjs）脱节，导致全仓
 * .mjs/.cjs 文件结构性缺席知识图谱（impact/context 一律 symbol-not-found）。
 *
 * 本文件锁定修复后的两个不变量：
 * 1. .mjs/.cjs 被采集，且解析结果按各自实测能力落账：.mjs 的 ESM exports/imports
 *    完整可用（真能派生 symbol 与 import 边）；.cjs 的 require 依赖可解析为本地绝对
 *    路径，但 module.exports 提取为空（当前能力边界，见对应用例注释）
 * 2. 扩容判定面不等于"开大门"——TSJS_SKELETON_IGNORE_DIRS 命中的目录内
 *    .mjs/.cjs 仍被剪枝
 *
 * 放在 tests/batch/ 而非与 stages/source-discovery.ts 共置：F220 的 stage 依赖矩阵
 * 守护（tests/unit/batch/f220-export-surface.test.ts）会把 stages/ 下所有 .ts 视为
 * stage 模块，共置测试对被测模块的 import 会被误判为未授权 stage 依赖边。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  collectTsJsCodeSkeletons,
  TSJS_SKELETON_IGNORE_DIRS,
} from '../../src/batch/stages/source-discovery.js';

const tmpDirs: string[] = [];

function createFixture(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f242-source-discovery-'));
  tmpDirs.push(tmpDir);
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
  }
  return tmpDir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
  tmpDirs.length = 0;
});

describe('collectTsJsCodeSkeletons：.mjs/.cjs 覆盖（F243）', () => {
  it('.mjs 被采集，且 exports 非空（可派生 symbol 节点）', async () => {
    const tmpDir = createFixture({
      'lib/core.mjs': `
export function computeScore(a, b) {
  return a + b;
}

export const DEFAULT_LIMIT = 10;
`,
      'cli.mjs': `
import { computeScore, DEFAULT_LIMIT } from './lib/core.mjs';

export function run() {
  return computeScore(DEFAULT_LIMIT, 1);
}
`,
    });

    const result = await collectTsJsCodeSkeletons(tmpDir, { extractCallSites: true });

    const corePath = path.join(tmpDir, 'lib', 'core.mjs');
    const cliPath = path.join(tmpDir, 'cli.mjs');

    expect(result.has(corePath)).toBe(true);
    expect(result.has(cliPath)).toBe(true);

    // exports 非空是"入图"的实质前提：symbol 节点由 exports 派生
    const coreSkeleton = result.get(corePath);
    expect(coreSkeleton).toBeDefined();
    expect(coreSkeleton!.exports.map((e) => e.name)).toContain('computeScore');
  });

  it('.cjs 被采集，require 依赖解析到本地 .cjs；module.exports 提取为空（当前能力边界）', async () => {
    const tmpDir = createFixture({
      'local-dep.cjs': `
function helper(x) {
  return x * 2;
}

module.exports = { helper };
`,
      'legacy.cjs': `
const { helper } = require('./local-dep.cjs');
const path = require('node:path');

function legacyRun(x) {
  return helper(x) + path.sep.length;
}

module.exports = { legacyRun };
`,
    });

    const result = await collectTsJsCodeSkeletons(tmpDir, { extractCallSites: true });

    const legacyPath = path.join(tmpDir, 'legacy.cjs');
    const depPath = path.join(tmpDir, 'local-dep.cjs');

    expect(result.has(legacyPath)).toBe(true);
    expect(result.has(depPath)).toBe(true);

    const legacySkeleton = result.get(legacyPath)!;

    // require() 在 ast-analyzer 有显式识别分支：本地 specifier 解析到绝对路径，
    // 即 .cjs 之间的 import 边不悬空；node: 内置模块按外部依赖处理（resolvedPath 为 null）
    expect(legacySkeleton.imports).toHaveLength(2);
    const depImport = legacySkeleton.imports.find((imp) => imp.moduleSpecifier === './local-dep.cjs');
    expect(depImport).toBeDefined();
    expect(depImport!.resolvedPath).toBe(depPath);
    expect(depImport!.importType).toBe('commonjs-require');
    const builtinImport = legacySkeleton.imports.find((imp) => imp.moduleSpecifier === 'node:path');
    expect(builtinImport).toBeDefined();
    expect(builtinImport!.resolvedPath).toBeNull();

    // CJS module.exports 提取为当前能力边界外（ast-analyzer 无 `module.exports = ...` 提取
    // 分支），F243 登记残留；此断言锁定现状，防止能力变化时静默漂移而无人察觉
    expect(legacySkeleton.exports).toHaveLength(0);
    expect(result.get(depPath)!.exports).toHaveLength(0);
  });

  it('.mjs 的显式后缀 import 可解析为绝对路径（import 边不悬空）', async () => {
    const tmpDir = createFixture({
      'lib/core.mjs': 'export function computeScore(a, b) {\n  return a + b;\n}\n',
      'cli.mjs': "import { computeScore } from './lib/core.mjs';\n\nexport const run = () => computeScore(1, 2);\n",
    });

    const result = await collectTsJsCodeSkeletons(tmpDir);

    const cliSkeleton = result.get(path.join(tmpDir, 'cli.mjs'));
    expect(cliSkeleton).toBeDefined();

    const coreImport = cliSkeleton!.imports.find((imp) => imp.moduleSpecifier === './lib/core.mjs');
    expect(coreImport).toBeDefined();
    expect(coreImport!.resolvedPath).toBe(path.join(tmpDir, 'lib', 'core.mjs'));
  });

  it('TSJS_SKELETON_IGNORE_DIRS 命中的目录内 .mjs/.cjs 仍被剪枝（扩容不等于开大门）', async () => {
    // 前提断言：用真实常量取值，避免下游改动忽略集合后本用例静默失效
    expect(TSJS_SKELETON_IGNORE_DIRS.has('dist')).toBe(true);
    expect(TSJS_SKELETON_IGNORE_DIRS.has('node_modules')).toBe(true);

    const tmpDir = createFixture({
      'kept.mjs': 'export const kept = 1;\n',
      'dist/bundled.mjs': 'export const bundled = 1;\n',
      'node_modules/pkg/index.cjs': 'module.exports = { dep: 1 };\n',
      '.hidden/secret.mjs': 'export const secret = 1;\n',
    });

    const result = await collectTsJsCodeSkeletons(tmpDir);

    expect(result.has(path.join(tmpDir, 'kept.mjs'))).toBe(true);
    expect(result.has(path.join(tmpDir, 'dist', 'bundled.mjs'))).toBe(false);
    expect(result.has(path.join(tmpDir, 'node_modules', 'pkg', 'index.cjs'))).toBe(false);
    expect(result.has(path.join(tmpDir, '.hidden', 'secret.mjs'))).toBe(false);
  });
});
