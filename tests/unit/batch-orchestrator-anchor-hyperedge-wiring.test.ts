/**
 * batch-orchestrator anchor/hyperedge 接通结构断言（Feature 133 P1-1）
 *
 * Phase 2 集成回归发现：F4 提供了 runAnchorIntegration / runHyperedgeIntegration
 * 集成接口作为公开 export，但 batch-orchestrator 在 buildKnowledgeGraph 之前从
 * 未调用过它们；F4 单测仅验证集成函数本身，没有 E2E 测试验证 graph.json 最终
 * 内容含有 anchor 边和 hyperedges。
 *
 * 这个结构性测试锁定 batch-orchestrator.ts 必须 import 并调用两个集成函数，
 * 防止未来有人误删或 refactor 时丢失接通；真实 E2E 行为由 verification 阶段
 * 在 graphify-mini fixture 上手动验证（需 ANTHROPIC_API_KEY）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BATCH_ORCHESTRATOR_PATH = resolve(
  import.meta.dirname,
  '../../src/batch/batch-orchestrator.ts',
);

describe('Feature 133 P1-1：batch-orchestrator anchor + hyperedge 接通', () => {
  const source = readFileSync(BATCH_ORCHESTRATOR_PATH, 'utf-8');

  it('imports runAnchorIntegration from doc-graph-builder', () => {
    expect(source).toMatch(/runAnchorIntegration[\s\S]*from\s+['"]\.\.\/panoramic\/builders\/doc-graph-builder/);
  });

  it('imports runHyperedgeIntegration from doc-graph-builder', () => {
    expect(source).toMatch(/runHyperedgeIntegration[\s\S]*from\s+['"]\.\.\/panoramic\/builders\/doc-graph-builder/);
  });

  it('imports chunkMarkdownFiles for hyperedge docChunks input', () => {
    expect(source).toMatch(/chunkMarkdownFiles[\s\S]*from\s+['"]\.\.\/panoramic\/anchoring\/chunker/);
  });

  it('imports createEmbeddingProvider for anchor provider input', () => {
    expect(source).toMatch(/createEmbeddingProvider[\s\S]*from\s+['"]\.\.\/panoramic\/anchoring\/providers\/factory/);
  });

  it('调用 runAnchorIntegration（实际接通生产路径）', () => {
    // 匹配带括号的实际调用（排除 import 和注释中的裸名引用）
    const callCount = (source.match(/runAnchorIntegration\s*\(/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('调用 runHyperedgeIntegration（实际接通生产路径）', () => {
    const callCount = (source.match(/runHyperedgeIntegration\s*\(/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('hyperedge 默认 opt-in：BatchOptions.hyperedgesEnabled === true 或 env === "true"', () => {
    // Feature 133 adversarial-review post-fix：
    // 默认 false（不再是 env=false 才关），需要显式 opt-in
    expect(source).toMatch(/options\.hyperedgesEnabled\s*===\s*true/);
    expect(source).toMatch(/SPECTRA_HYPEREDGES_ENABLED/);
    expect(source).toMatch(/===\s*['"]true['"]/);
  });

  it('semantic-integration 守卫：mode === "full" 且未触发 budget skip-enrichment', () => {
    // Feature 133 adversarial-review post-fix：reading / code-only 或 budget 降级
    // 模式都应跳过整个 anchor + hyperedge 集成块
    expect(source).toMatch(/effectiveMode\s*===\s*['"]full['"]/);
    expect(source).toMatch(/!budgetSkipEnrichmentAll/);
    expect(source).toMatch(/semanticIntegrationAllowed/);
  });

  it('集成失败时 warn 日志降级，不抛异常阻断 batch', () => {
    // anchor 集成 try/catch
    const anchorMatches = source.match(/anchor-integration:[^]*?(警告|失败)/g);
    expect(anchorMatches).toBeTruthy();
    // hyperedge 集成 try/catch
    const hyperMatches = source.match(/hyperedge-integration:[^]*?(警告|失败)/g);
    expect(hyperMatches).toBeTruthy();
  });
});
