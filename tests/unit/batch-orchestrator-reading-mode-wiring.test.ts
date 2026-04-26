/**
 * batch-orchestrator reading 模式分派结构断言（Feature 133 P0-2）
 *
 * Phase 2 集成回归发现：--mode=reading 实测 1047s 远超 SC-001 的 120s 目标。
 * 根因之一：batch-orchestrator 调用 generateSpec 时未根据 effectiveMode 传
 * skipEnrichment，导致 reading/code-only 模式仍跑模块 spec 的 LLM
 * enrichment（每模块多一次 3-4 分钟的 opus 调用）。
 *
 * 这个结构性测试锁定 batch-orchestrator.ts 必须在两处 generateSpec 调用
 * 都传 `skipEnrichment: effectiveMode !== 'full'`，防止未来 refactor
 * 时丢失 mode 分派；perf SLA 由 verification 阶段在 graphify-mini fixture
 * 上手动验证（需 ANTHROPIC_API_KEY）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BATCH_ORCHESTRATOR_PATH = resolve(
  import.meta.dirname,
  '../../src/batch/batch-orchestrator.ts',
);

const BATCH_PROJECT_DOCS_PATH = resolve(
  import.meta.dirname,
  '../../src/panoramic/batch-project-docs.ts',
);

describe('Feature 133 P0-2：batch-orchestrator reading 模式分派', () => {
  const orchestratorSource = readFileSync(BATCH_ORCHESTRATOR_PATH, 'utf-8');
  const projectDocsSource = readFileSync(BATCH_PROJECT_DOCS_PATH, 'utf-8');

  it('genOptions 在 reading/code-only 模式下设置 skipEnrichment（统一来源，不在调用点覆盖）', () => {
    // Post-review 修复：genOptions.skipEnrichment 在 L648 处统一设置，
    // 两处 generateSpec 调用不再各自覆盖（避免"先设错后覆盖"反模式）
    expect(orchestratorSource).toMatch(
      /skipEnrichment:\s*isSmallModule\s*\|\|\s*budgetSkipEnrichmentAll\s*\|\|\s*effectiveMode\s*!==\s*['"]full['"]/,
    );
  });

  it('READING_SKIP_IDS 包含产品文档 + 架构推断层（13 个 generator）', () => {
    // 解析 batch-project-docs.ts 中 READING_SKIP_IDS 集合字面值
    // Post-review 修复：READING_SKIP_IDS 改为 export const，匹配模式相应放宽
    const expectedGenerators = [
      // 产品文档层
      'adr-pipeline',
      'product-ux-docs',
      'troubleshooting',
      'data-model',
      'docs-quality-evaluator',
      // 架构推断层（P0-2 新增）
      'architecture-overview',
      'architecture-ir',
      'pattern-hints',
      'event-surface',
      'runtime-topology',
      'architecture-narrative',
      'component-view',
      'dynamic-scenarios',
    ];

    const skipIdsBlock = projectDocsSource.match(
      /READING_SKIP_IDS\s*:?\s*[A-Za-z<>\s]*=\s*new Set\(\[([\s\S]*?)\]\)/,
    )?.[1] ?? '';

    for (const id of expectedGenerators) {
      expect(skipIdsBlock).toContain(`'${id}'`);
    }
  });

  it('CODE_ONLY_SKIP_IDS 在 P0-2 后等价于 READING_SKIP_IDS', () => {
    // 修复后两个集合等价：CODE_ONLY_SKIP_IDS 用 spread READING_SKIP_IDS 构造
    // Post-review 修复：两者都改为 export const，匹配模式放宽接受类型注解
    expect(projectDocsSource).toMatch(
      /CODE_ONLY_SKIP_IDS\s*:?\s*[A-Za-z<>\s]*=\s*new Set\(\[\.\.\.READING_SKIP_IDS\]\)/,
    );
  });
});
