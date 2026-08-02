/**
 * F242 — calls 边端到端存活测试。
 *
 * 这是唯一验证「边真正救回、真的存活过 graph-builder 悬空过滤」的层级：
 * mapper / resolver 层单测只验证中间产物正确，边最终是否进图由本文件断言。
 *
 * 流水线复刻生产路径：
 *   TsJsLanguageAdapter.analyzeFile(extractCallSites: true)
 *     → buildUnifiedGraph（resolveCalls + deriveNodesFromSkeletons + 相对化）
 *     → buildKnowledgeGraph（第五路注入 + 步骤 4 悬空边过滤）
 *
 * 三条验收边（对应 fix-report.md 双支根因）：
 *   1. `a.ts::A → a.ts::B`   —— R1 命名祖先回退（形态 1，kb-search.ts 验收案例复刻）
 *   2. `a.ts → a.ts::C`      —— R1 模块兜底（未导出 main() 场景复刻）
 *   3. `a.ts → b.ts::D`      —— R1 模块兜底 + R2 动态 import 绑定（形态 2 验收案例复刻）
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { buildUnifiedGraph } from '../../src/knowledge-graph/index.js';
import { buildKnowledgeGraph } from '../../src/panoramic/graph/graph-builder.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

const FILE_A = `
export function A(items: unknown[]): void {
  withTelemetry('a', () => B(items));
}

export function B(items: unknown[]): void {
  void items;
}

export function C(): void {}

// 未导出入口函数 —— 复刻 src/cli/index.ts::main 的真实形态
async function main(): Promise<void> {
  C();
  const { D } = await import('./b.js');
  await D();
}

// 导出函数内的动态 import —— 对照组：source 应保持符号级精度
export async function loadDynamic(): Promise<void> {
  const { D } = await import('./b.js');
  await D();
}

function withTelemetry(name: string, fn: () => void): void {
  void name;
  fn();
}

void main();
`;

const FILE_B = `
export function D(): void {}
`;

describe('F242 — calls 边端到端存活（悬空过滤后）', () => {
  let tmpDir: string;
  let graph: GraphJSON;

  beforeAll(async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'f242-survival-')));
    const fileA = path.join(tmpDir, 'a.ts');
    const fileB = path.join(tmpDir, 'b.ts');
    fs.writeFileSync(fileA, FILE_A, 'utf-8');
    fs.writeFileSync(fileB, FILE_B, 'utf-8');

    const adapter = new TsJsLanguageAdapter();
    const skeletons = new Map<string, CodeSkeleton>();
    for (const f of [fileA, fileB]) {
      skeletons.set(
        f,
        await adapter.analyzeFile(f, { extractCallSites: true, projectRoot: tmpDir }),
      );
    }

    const unified = buildUnifiedGraph({ projectRoot: tmpDir, codeSkeletons: skeletons });
    graph = buildKnowledgeGraph({ unifiedGraph: unified, directed: true });
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 最终图（悬空过滤后）是否含指定 calls 边 */
  const hasCallEdge = (source: string, target: string): boolean =>
    graph.links.some(
      (l) => l.source === source && l.target === target && l.relation === 'calls',
    );

  it('验收边 1 — 命名祖先回退：实参 arrow callback 内的调用归属外层具名函数', () => {
    expect(hasCallEdge('a.ts::A', 'a.ts::B')).toBe(true);
  });

  it('验收边 2 — 模块兜底：未导出 main() 内的调用归属模块节点', () => {
    expect(hasCallEdge('a.ts', 'a.ts::C')).toBe(true);
  });

  it('验收边 3 — 动态 import 解构：未导出 main() 内的跨模块调用可解析且边存活', () => {
    expect(hasCallEdge('a.ts', 'b.ts::D')).toBe(true);
  });

  it('精度对照 — 导出函数内的动态 import 调用保持符号级 source（不被降级到模块）', () => {
    expect(hasCallEdge('a.ts::loadDynamic', 'b.ts::D')).toBe(true);
  });

  it('不变量 — 最终图零悬空边（两端点必须都在节点集合中）', () => {
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const dangling = graph.links.filter(
      (l) => !nodeIds.has(l.source) || !nodeIds.has(l.target),
    );
    expect(dangling).toEqual([]);
  });
});
