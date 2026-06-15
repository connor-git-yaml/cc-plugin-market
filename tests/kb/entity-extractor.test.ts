/**
 * F192 T004 — entity-extractor：LLM 抽取 + heuristic 兜底 + 成本护栏 + section 聚合
 * 注入 callLLM/llmAvailable 保证确定性（不打真实网络/认证）。
 */

import { describe, it, expect } from 'vitest';
import { extractEntities, aggregateSections } from '../../src/scaffold-kb/entity-extractor.js';
import type { Chunk, ExtractionSection } from '../../src/scaffold-kb/types.js';

function section(text: string, over: Partial<ExtractionSection> = {}): ExtractionSection {
  return { docId: 'd1', anchor: 'a1', lang: 'en', chunkIds: ['d1#a1'], text, ...over };
}

const LLM_JSON = JSON.stringify([
  {
    name: 'createChart',
    qualifiedName: 'echarts.createChart',
    kind: 'function',
    signature: 'createChart(dom, options)',
    params: [{ name: 'dom', type: 'HTMLElement', required: true }],
    sinceVersion: '1.0',
    confidence: 1.5, // 越界 → clamp 到 1
    evidenceQuote: '通过 createChart 创建实例',
  },
]);

describe('aggregateSections', () => {
  it('同 docId+anchor 的多 chunk 聚合为一 section（W-4）', () => {
    const chunks: Chunk[] = [
      { chunkId: 'd1#a1', docId: 'd1', contentRaw: '签名部分', anchor: 'a1' },
      { chunkId: 'd1#a1-2', docId: 'd1', contentRaw: '参数部分', anchor: 'a1' },
      { chunkId: 'd1#a2', docId: 'd1', contentRaw: '另一节', anchor: 'a2' },
    ];
    const secs = aggregateSections(chunks, new Map([['d1', 'zh']]));
    expect(secs).toHaveLength(2);
    expect(secs[0]!.chunkIds).toEqual(['d1#a1', 'd1#a1-2']);
    expect(secs[0]!.text).toContain('签名部分');
    expect(secs[0]!.text).toContain('参数部分');
    expect(secs[0]!.lang).toBe('zh');
  });
});

describe('extractEntities', () => {
  it('LLM 路径：注入 JSON → 映射 ApiEntity（confidence clamp、id、跨 chunk）', async () => {
    const r = await extractEntities([section('文本', { chunkIds: ['c1', 'c2'] })], {
      callLLM: async () => LLM_JSON,
      llmAvailable: () => true,
    });
    expect(r.method).toBe('llm');
    const e = r.entities[0]!;
    expect(e.name).toBe('createChart');
    expect(e.qualifiedName).toBe('echarts.createChart');
    expect(e.extractionMethod).toBe('llm');
    expect(e.confidence).toBe(1); // clamp
    expect(e.sourceChunkId).toBe('c1');
    expect(e.sourceChunkIds).toEqual(['c1', 'c2']);
    expect(e.params?.[0]).toMatchObject({ name: 'dom', type: 'HTMLElement' });
  });

  it('--no-llm → 全 heuristic', async () => {
    const r = await extractEntities([section('调用 `foo(a, b)` 完成。')], {
      noLlm: true,
      callLLM: async () => LLM_JSON, // 即使注入也不应调用
      llmAvailable: () => true,
    });
    expect(r.method).toBe('heuristic');
    expect(r.entities.some((e) => e.name === 'foo' && e.extractionMethod === 'heuristic')).toBe(true);
  });

  it('无认证（llmAvailable=false）→ heuristic 兜底', async () => {
    const r = await extractEntities([section('调用 `bar(x)` 。')], {
      llmAvailable: () => false,
    });
    expect(r.method).toBe('heuristic');
    expect(r.entities.some((e) => e.name === 'bar')).toBe(true);
  });

  it('LLM 返回 null（错误）→ 该 section heuristic 兜底', async () => {
    const r = await extractEntities([section('调用 `baz(y)` 。')], {
      callLLM: async () => null,
      llmAvailable: () => true,
    });
    expect(r.method).toBe('heuristic');
    expect(r.entities.some((e) => e.name === 'baz')).toBe(true);
  });

  it('LLM 返回坏 JSON → heuristic 兜底（不崩）', async () => {
    const r = await extractEntities([section('调用 `qux(z)` 。')], {
      callLLM: async () => 'not json at all {',
      llmAvailable: () => true,
    });
    expect(r.method).toBe('heuristic');
    expect(r.entities.some((e) => e.name === 'qux')).toBe(true);
  });

  it('LLM 返回合法空数组 → method=llm（不误触 heuristic）', async () => {
    const r = await extractEntities([section('纯说明无 API')], {
      callLLM: async () => '[]',
      llmAvailable: () => true,
    });
    expect(r.method).toBe('llm');
    expect(r.entities).toEqual([]);
  });

  it('成本护栏：maxSections 截断 → coverage 反映', async () => {
    const secs = [section('a', { docId: 'd1' }), section('b', { docId: 'd2' }), section('c', { docId: 'd3' })];
    const r = await extractEntities(secs, { noLlm: true, maxSections: 2 });
    expect(r.coverage).toEqual({ totalSections: 3, extractedSections: 2 });
  });

  it('禁编造：LLM 漏给 name 的条目被丢弃', async () => {
    const r = await extractEntities([section('x')], {
      callLLM: async () => JSON.stringify([{ kind: 'function', signature: '()' }, { name: 'real' }]),
      llmAvailable: () => true,
    });
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.name).toBe('real');
  });
});
