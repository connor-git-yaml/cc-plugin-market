/**
 * LLM 主题推断单元测试（使用 StubLLMClient）
 */
import { describe, it, expect } from 'vitest';
import { inferOpenQuestionTopics } from '../../src/debt-scanner/design-docs/llm-topic-inferrer.js';
import { StubLLMClient } from '../../src/debt-scanner/llm-clients.js';
import type { OpenQuestionCandidate } from '../../src/debt-scanner/design-docs/index.js';
import type { OpenQuestionEntry } from '../../src/debt-scanner/types.js';

function makeCandidate(docPath: string, snippet: string): OpenQuestionCandidate {
  return {
    absPath: '/tmp/' + docPath,
    docPath,
    headingPath: '# H1',
    snippet,
  };
}

describe('inferOpenQuestionTopics', () => {
  it('无候选时不调用 LLM', async () => {
    const stub = new StubLLMClient(() => ({ text: '', inputTokens: 0, outputTokens: 0, model: 'stub' }));
    const res = await inferOpenQuestionTopics({
      confirmed: [],
      llmCandidates: [],
      llmClient: stub,
    });
    expect(res.llmCalls).toBe(0);
    expect(stub.calls).toHaveLength(0);
  });

  it('confirmed 条目直接透传', async () => {
    const confirmed: OpenQuestionEntry[] = [
      { snippet: 'TBD', docPath: 'a.md', headingPath: '#', source: 'rule', topics: [] },
    ];
    const res = await inferOpenQuestionTopics({
      confirmed,
      llmCandidates: [],
    });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]?.source).toBe('rule');
  });

  it('dryRun=true 跳过 LLM，返回 fallbackReason=dry-run', async () => {
    const stub = new StubLLMClient(() => ({ text: '', inputTokens: 0, outputTokens: 0, model: 'stub' }));
    const res = await inferOpenQuestionTopics({
      confirmed: [],
      llmCandidates: [makeCandidate('a.md', 'why?')],
      llmClient: stub,
      dryRun: true,
    });
    expect(stub.calls).toHaveLength(0);
    expect(res.fallbackReason).toBe('dry-run');
  });

  it('无 llmClient 时 fallbackReason=no-llm-client', async () => {
    const res = await inferOpenQuestionTopics({
      confirmed: [],
      llmCandidates: [makeCandidate('a.md', 'why?')],
    });
    expect(res.fallbackReason).toBe('no-llm-client');
  });

  it('budget 超出触发 budget-exhausted 降级', async () => {
    const stub = new StubLLMClient(() => ({ text: '', inputTokens: 0, outputTokens: 0, model: 'stub' }));
    const res = await inferOpenQuestionTopics({
      confirmed: [],
      llmCandidates: [makeCandidate('a.md', 'why?')],
      llmClient: stub,
      budgetLimit: 1, // 强制超额
    });
    expect(stub.calls).toHaveLength(0);
    expect(res.fallbackReason).toBe('budget-exhausted');
  });

  it('StubLLMClient 返回 JSON 时成功填充 topics', async () => {
    const candidate = makeCandidate('a.md', 'Should we use X or Y?');
    const key = candidate.docPath + '|' + candidate.snippet;
    const stub = new StubLLMClient(() => ({
      text: JSON.stringify({
        results: [
          { id: 'c0', key, isOpenQuestion: true, topics: ['validation', 'parser'] },
        ],
      }),
      inputTokens: 100,
      outputTokens: 30,
      model: 'stub-haiku',
    }));

    const res = await inferOpenQuestionTopics({
      confirmed: [],
      llmCandidates: [candidate],
      llmClient: stub,
    });
    expect(res.llmCalls).toBe(1);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]?.source).toBe('llm');
    expect(res.entries[0]?.topics).toEqual(['validation', 'parser']);
    expect(res.tokenUsage.input).toBe(100);
    expect(res.tokenUsage.output).toBe(30);
    expect(res.llmModel).toBe('stub-haiku');
  });

  it('LLM 判定 isOpenQuestion=false 的候选不会进入结果', async () => {
    const c = makeCandidate('a.md', 'rhetorical?');
    const key = c.docPath + '|' + c.snippet;
    const stub = new StubLLMClient(() => ({
      text: JSON.stringify({ results: [{ key, isOpenQuestion: false, topics: [] }] }),
      inputTokens: 10,
      outputTokens: 5,
      model: 'stub',
    }));
    const res = await inferOpenQuestionTopics({
      confirmed: [],
      llmCandidates: [c],
      llmClient: stub,
    });
    expect(res.entries).toHaveLength(0);
  });

  it('LLM 抛错时降级为 budget-exhausted，不中断流程', async () => {
    const stub = new StubLLMClient(() => { throw new Error('network'); });
    const res = await inferOpenQuestionTopics({
      confirmed: [],
      llmCandidates: [makeCandidate('a.md', 'why?')],
      llmClient: stub,
    });
    expect(res.fallbackReason).toBe('budget-exhausted');
  });
});
