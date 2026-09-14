/**
 * M11 卡 E 对抗审查回补（INFO）：frontmatter 的 tokenUsage.cacheCreation / cacheRead 与 reportedCostUsd 此前从不落盘——
 * `TokenUsageSchema` 的可选字段在往返链上是死的，任何从 frontmatter 重算成本的消费者都会把全部 input 按 fresh 计。
 */
import { describe, it, expect } from 'vitest';
import { renderSpec } from '../../src/generator/spec-renderer.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';

function moduleSpecWith(frontmatterExtra: Record<string, unknown>): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'vitest',
      sourceTarget: 'src/demo',
      relatedFiles: ['src/demo/a.ts'],
      lastUpdated: '2026-09-15T00:00:00.000Z',
      confidence: 'high',
      skeletonHash: 'a'.repeat(64),
      durationMs: 1200,
      llmModel: 'claude-sonnet-4-6',
      fallbackReason: null,
      ...frontmatterExtra,
    } as ModuleSpec['frontmatter'],
    sections: {
      intent: '意图', interfaceDefinition: '接口', businessLogic: '逻辑', dataStructures: '数据',
      constraints: '约束', edgeCases: '边界', technicalDebt: '债务', testCoverage: '覆盖', dependencies: '依赖',
    },
    fileInventory: [{ path: 'src/demo/a.ts', loc: 10, purpose: '导出 foo' }],
    baselineSkeleton: {
      filePath: 'src/demo/a.ts', language: 'typescript', loc: 10, exports: [], imports: [],
      hash: 'a'.repeat(64), analyzedAt: '2026-09-15T00:00:00.000Z', parserUsed: 'ts-morph',
    },
    outputPath: 'specs/demo.spec.md',
  };
}

function frontmatterOf(markdown: string): string {
  const end = markdown.indexOf('\n---', 4);
  return markdown.slice(0, end);
}

describe('module-spec frontmatter 的成本字段落盘', () => {
  it('tokenUsage 带 cacheCreation / cacheRead 与 reportedCostUsd 时逐行写进 frontmatter', () => {
    const md = renderSpec(moduleSpecWith({
      tokenUsage: { input: 70000, output: 4000, cacheCreation: 40000, cacheRead: 26000 },
      reportedCostUsd: 0.234517,
    }));
    const fm = frontmatterOf(md);
    expect(fm).toMatch(/^tokenUsage:\n  input: 70000\n  output: 4000\n  cacheCreation: 40000\n  cacheRead: 26000\n/m);
    expect(fm).toMatch(/^reportedCostUsd: 0\.234517$/m);
  });

  it('没有 cache / 报告成本字段的旧形态 → 只写 input / output，不写空行也不写 0（旧产物逐字节不变）', () => {
    const fm = frontmatterOf(renderSpec(moduleSpecWith({ tokenUsage: { input: 70000, output: 4000 } })));
    expect(fm).toMatch(/^tokenUsage:\n  input: 70000\n  output: 4000\ndurationMs: 1200$/m);
    expect(fm).not.toMatch(/cacheCreation|cacheRead|reportedCostUsd/);
  });
});
