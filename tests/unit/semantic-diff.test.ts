/**
 * semantic-diff 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callLLM: vi.fn(),
  buildSystemPrompt: vi.fn(),
  assembleContext: vi.fn(),
}));

vi.mock('../../src/core/llm-client.js', () => ({
  callLLM: mocks.callLLM,
  buildSystemPrompt: mocks.buildSystemPrompt,
}));

vi.mock('../../src/core/context-assembler.js', () => ({
  assembleContext: mocks.assembleContext,
}));

import { evaluateBehaviorChange } from '../../src/diff/semantic-diff.js';

describe('evaluateBehaviorChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSystemPrompt.mockReturnValue('semantic system prompt');
    mocks.assembleContext.mockResolvedValue({ prompt: 'ctx' });
  });

  it('LLM 返回 hasDrift=true 时产出 DriftItem', async () => {
    mocks.callLLM.mockResolvedValue({
      content:
        '```json\n{"hasDrift":true,"severity":"HIGH","description":"breaking","proposedUpdate":"update spec"}\n```',
    });

    const result = await evaluateBehaviorChange(
      'function a(){return 1}',
      'function a(){return 2}',
      'must return stable value',
    );

    expect(result).toBeTruthy();
    expect(result!.severity).toBe('HIGH');
    expect(result!.category).toBe('Behavior');
    expect(result!.description).toBe('breaking');
  });

  it('LLM 返回 hasDrift=false 时返回 null', async () => {
    mocks.callLLM.mockResolvedValue({
      content: '```json\n{"hasDrift":false}\n```',
    });

    const result = await evaluateBehaviorChange('a', 'b', 'spec');
    expect(result).toBeNull();
  });

  it('LLM 响应无 JSON code block 时返回 null', async () => {
    mocks.callLLM.mockResolvedValue({
      content: 'plain text without json',
    });

    const result = await evaluateBehaviorChange('a', 'b', 'spec');
    expect(result).toBeNull();
  });

  it('LLM 抛错时吞掉异常并返回 null', async () => {
    mocks.callLLM.mockRejectedValue(new Error('network error'));

    const result = await evaluateBehaviorChange('a', 'b', 'spec');
    expect(result).toBeNull();
  });
});

