/**
 * Feature 156 W4 T-039 — AC-11：4 类 import baseline 验证
 *
 * 验证目标：
 *   buildUnifiedGraph 在 ts-import-types fixture 上派生 depends-on 边时，
 *   `static / dynamic / type-only / commonjs-require` 四类 importType 各产 ≥ 1 条边，
 *   且 metadata.importType 字段能正确区分。
 *
 * 关联 spec：AC-11 / FR-28 / clarify Q-D5
 *
 * 注：edge 通过 deriveImportEdges 写入 metadata.importType，
 *     module-derivation 派生 ModuleEdge.importType 时把 commonjs-require → static。
 *     本测试验证 UnifiedGraph 层（保留四类完整粒度）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapAdapters } from '../../src/adapters/index.js';
import { analyzeFile } from '../../src/core/ast-analyzer.js';
import { buildUnifiedGraph } from '../../src/knowledge-graph/index.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import type { UnifiedEdge } from '../../src/knowledge-graph/unified-graph.js';

beforeAll(() => {
  bootstrapAdapters();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, '../fixtures/156-w1.2-v2/ts-import-types');

/** 抽取 fixture 内 main.ts + 全部 4 个目标文件的 UnifiedGraph */
async function buildFixtureGraph() {
  const files = [
    path.join(FIXTURE, 'main.ts'),
    path.join(FIXTURE, 'static-target.ts'),
    path.join(FIXTURE, 'dynamic-target.ts'),
    path.join(FIXTURE, 'type-only-target.ts'),
    path.join(FIXTURE, 'cjs-target.cjs'),
  ];
  const codeSkeletons = new Map<string, CodeSkeleton>();
  for (const f of files) {
    const sk = await analyzeFile(f, { projectRoot: FIXTURE });
    if (sk) codeSkeletons.set(f, sk);
  }
  return buildUnifiedGraph({ projectRoot: FIXTURE, codeSkeletons });
}

describe('Feature 156 W4 T-039 — AC-11：4 类 import baseline', () => {
  it('main.ts 派生 depends-on 边覆盖 static/dynamic/type-only/commonjs-require 四类', async () => {
    const graph = await buildFixtureGraph();

    // 仅 main.ts 出口的 depends-on 边
    const mainPath = path.join(FIXTURE, 'main.ts');
    const dependsOnFromMain: UnifiedEdge[] = graph.edges.filter(
      (e) => e.relation === 'depends-on' && e.source === mainPath,
    );

    // 收集 importType（来自 edge.metadata.importType，由 deriveImportEdges 注入）
    const seenTypes = new Map<string, number>();
    for (const e of dependsOnFromMain) {
      const importType = (e.metadata as { importType?: string } | undefined)?.importType;
      if (importType) {
        seenTypes.set(importType, (seenTypes.get(importType) ?? 0) + 1);
      }
    }

    // AC-11：4 类各 ≥ 1 条
    expect(seenTypes.get('static') ?? 0).toBeGreaterThanOrEqual(1);
    expect(seenTypes.get('dynamic') ?? 0).toBeGreaterThanOrEqual(1);
    expect(seenTypes.get('type-only') ?? 0).toBeGreaterThanOrEqual(1);
    expect(seenTypes.get('commonjs-require') ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('每条 depends-on 边的 metadata.importType 必填（buildUnifiedGraph 派生路径不丢字段）', async () => {
    const graph = await buildFixtureGraph();
    const mainPath = path.join(FIXTURE, 'main.ts');
    const dependsOnFromMain = graph.edges.filter(
      (e) => e.relation === 'depends-on' && e.source === mainPath,
    );

    // main.ts 的所有 depends-on 边 importType 字段必填
    for (const e of dependsOnFromMain) {
      const importType = (e.metadata as { importType?: string } | undefined)?.importType;
      expect(importType).toBeDefined();
      expect(['static', 'dynamic', 'type-only', 'commonjs-require']).toContain(importType);
    }
  });

  it('四类 import 各自指向正确的 target 文件', async () => {
    const graph = await buildFixtureGraph();
    const mainPath = path.join(FIXTURE, 'main.ts');
    const dependsOnFromMain = graph.edges.filter(
      (e) => e.relation === 'depends-on' && e.source === mainPath,
    );

    // 收集 importType → target basename 集合
    const typeToTargets = new Map<string, Set<string>>();
    for (const e of dependsOnFromMain) {
      const importType = (e.metadata as { importType?: string } | undefined)?.importType;
      if (!importType) continue;
      const tgt = path.basename(e.target);
      let s = typeToTargets.get(importType);
      if (!s) {
        s = new Set();
        typeToTargets.set(importType, s);
      }
      s.add(tgt);
    }

    // static → static-target.ts
    expect([...(typeToTargets.get('static') ?? [])].some((t) => t.includes('static-target'))).toBe(
      true,
    );
    // dynamic → dynamic-target.ts
    expect(
      [...(typeToTargets.get('dynamic') ?? [])].some((t) => t.includes('dynamic-target')),
    ).toBe(true);
    // type-only → type-only-target.ts
    expect(
      [...(typeToTargets.get('type-only') ?? [])].some((t) => t.includes('type-only-target')),
    ).toBe(true);
    // commonjs-require → cjs-target.cjs
    expect(
      [...(typeToTargets.get('commonjs-require') ?? [])].some((t) => t.endsWith('.cjs')),
    ).toBe(true);
  });
});
