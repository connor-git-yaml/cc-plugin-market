/**
 * Feature 181 — import-resolver 单一权威收口 · 回归护栏（Batch 0 golden）
 *
 * 🔴 硬门：本测试在「当前双实现 HEAD」上落 golden，重构（core/kg resolveTsJsImport 收口）
 * 全程必须保持 byte-identical。覆盖收口最高风险面：
 *   - ESM ext map（`./util.js` → `util.ts`，baseline 216 文件主导分支）
 *   - 目录 index 解析（`./sub` → `sub/index.ts`）
 *   - 相对父级（`../util.js`）+ 动态 import
 *   - 两条 graph 路径（collectTsJsCodeSkeletons + buildModuleGraphForProject）解析结果一致
 *
 * 确定性：fixture 文件内容固定 + 提取物显式排序（Codex W#1：walkTsJsFiles 用无序
 * readdirSync，不排序会文件系统抖动伪红）。fixture 为相对 import only（无 alias），
 * 镜像 self-dogfood/hono baseline 的实际 import 形态。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapAdapters } from '../../src/adapters/index.js';
import { collectTsJsCodeSkeletons } from '../../src/batch/batch-orchestrator.js';
import { buildModuleGraphForProject } from '../../src/knowledge-graph/module-derivation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/181-import-resolver');

beforeAll(() => {
  bootstrapAdapters();
});

/** 绝对路径 → 相对 fixture root 的 POSIX 路径（快照稳定） */
function rel(abs: string): string {
  if (!abs) return abs;
  if (!path.isAbsolute(abs)) return abs.split(path.sep).join('/');
  return path.relative(FIXTURE_ROOT, abs).split(path.sep).join('/');
}

describe('F181 Batch 0 — import 解析 byte-identical golden（双路径）', () => {
  it('collectTsJsCodeSkeletons：相对 import 解析（含 ESM map / index / dynamic）', async () => {
    const skeletons = await collectTsJsCodeSkeletons(FIXTURE_ROOT);
    const lines: string[] = [];
    for (const [absFile, sk] of skeletons) {
      for (const imp of sk.imports) {
        lines.push(
          `${rel(absFile)} :: ${imp.moduleSpecifier} -> ${imp.resolvedPath ? rel(imp.resolvedPath) : 'null'}`,
        );
      }
    }
    lines.sort();
    expect(lines).toMatchInlineSnapshot(`
      [
        "src/index.ts :: ./sub/index.js -> src/sub/index.ts",
        "src/index.ts :: ./types.js -> src/types.ts",
        "src/index.ts :: ./util.js -> src/util.ts",
        "src/sub/index.ts :: ../util.js -> src/util.ts",
        "src/sub/index.ts :: ../util.js -> src/util.ts",
      ]
    `);
  });

  it('buildModuleGraphForProject：depends-on 边（module-derivation 路径）', async () => {
    const graph = await buildModuleGraphForProject(FIXTURE_ROOT);
    const edges = graph.edges
      .map((e) => `${rel(e.from)} -> ${rel(e.to)} [${e.importType}]`)
      .sort();
    expect(edges).toMatchInlineSnapshot(`
      [
        "src/index.ts -> src/sub/index.ts [static]",
        "src/index.ts -> src/types.ts [type-only]",
        "src/index.ts -> src/util.ts [static]",
        "src/sub/index.ts -> src/util.ts [dynamic]",
        "src/sub/index.ts -> src/util.ts [static]",
      ]
    `);
  });

  it('跨路径一致性：两条路径对每条 relative import 解析的 target 相同', async () => {
    const skeletons = await collectTsJsCodeSkeletons(FIXTURE_ROOT);
    const graph = await buildModuleGraphForProject(FIXTURE_ROOT);

    // collect 路径：caller(rel) -> set(target rel)
    const collectTargets = new Map<string, Set<string>>();
    for (const [absFile, sk] of skeletons) {
      const caller = rel(absFile);
      const set = collectTargets.get(caller) ?? new Set<string>();
      for (const imp of sk.imports) {
        if (imp.resolvedPath) set.add(rel(imp.resolvedPath));
      }
      collectTargets.set(caller, set);
    }

    // module-derivation 路径：caller(rel) -> set(target rel)
    const graphTargets = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      const from = rel(e.from);
      const set = graphTargets.get(from) ?? new Set<string>();
      set.add(rel(e.to));
      graphTargets.set(from, set);
    }

    // 对两路径都解析出 target 的 caller，断言 graph 的 target ⊆ collect 的 target
    // （module-derivation 合并 commonjs/dynamic、可能去重；collect 保留全部 import，
    //   故 graph 边集是 collect 解析集的子集——核心契约：同一 import 解析到同一 target）
    for (const [caller, gTargets] of graphTargets) {
      const cTargets = collectTargets.get(caller);
      expect(cTargets, `caller ${caller} 应在 collect 路径出现`).toBeDefined();
      for (const t of gTargets) {
        expect(cTargets!.has(t), `${caller} -> ${t} 应在 collect 路径解析出相同 target`).toBe(true);
      }
    }
  });
});
