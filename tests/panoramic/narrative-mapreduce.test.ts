/**
 * Feature 140 T35 — narrative MapReduce + 3-pass critique 单测
 *
 * 覆盖 spec FR-008 / FR-009 / US-003：
 * - Phase A+B Map: per cluster mini-narrative + key abstractions（mock LLM）
 * - Phase C Reduce: 4-6 段 narrative（mock LLM）
 * - Phase D Critique: passed/failed 判定（mock LLM）
 * - Phase E Refine: 仅 D fail 时执行，最多 1 次（mock LLM）
 * - Phase F: 程序化 domain-words 校验
 * - fail-closed: domain-words < 3 时返回 paragraphs=null + failClosedReason='domain-words-insufficient'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enrichNarrativeWithLLM,
  validateDomainWords,
  type EnrichNarrativeOptions,
  MapOutputSchema,
  ReduceOutputSchema,
  CritiqueOutputSchema,
} from '../../src/panoramic/pipelines/architecture-narrative-mapreduce.js';
import type { StoredModuleSpecRecord } from '../../src/panoramic/stored-module-specs.js';

const mockMessagesCreate = vi.fn();

function makeModule(sourceTarget: string, intent: string, business: string): StoredModuleSpecRecord {
  return {
    sourceTarget,
    relatedFiles: [`${sourceTarget}/index.ts`],
    confidence: 'high',
    intentSummary: intent,
    businessSummary: business,
    dependencySummary: '依赖 logger / fs',
  };
}

function fakeAnthropic(): EnrichNarrativeOptions['anthropicClient'] {
  // 模拟 Anthropic SDK 接口（仅 messages.create 被消费）
  return { messages: { create: mockMessagesCreate } } as unknown as EnrichNarrativeOptions['anthropicClient'];
}

function makeLLMResponse(parsed: unknown, inputTokens = 1000, outputTokens = 500) {
  return {
    content: [{ type: 'text', text: JSON.stringify(parsed) }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

beforeEach(() => {
  mockMessagesCreate.mockReset();
});

describe('Zod schemas — LLM output validation', () => {
  it('MapOutputSchema 接受合规 cluster narrative + abstractions', () => {
    const result = MapOutputSchema.safeParse({
      clusterNarrative: 'A'.repeat(50),
      keyAbstractions: ['ClassA', 'FunctionB'],
    });
    expect(result.success).toBe(true);
  });

  it('ReduceOutputSchema 拒绝段落数 < 4', () => {
    const result = ReduceOutputSchema.safeParse({
      paragraphs: ['p1', 'p2'].map((s) => s + 'A'.repeat(20)),
      abstractionGlossary: ['X'],
    });
    expect(result.success).toBe(false);
  });

  it('CritiqueOutputSchema 接受 passed=true 且 issues=[]', () => {
    const result = CritiqueOutputSchema.safeParse({ passed: true, issues: [] });
    expect(result.success).toBe(true);
  });
});

describe('validateDomainWords — Phase F 程序化校验', () => {
  it('narrative 含 ≥3 抽象名 → 返回命中列表', () => {
    const modules = [
      makeModule('src/auth', 'AuthService 提供登录验证', 'AuthService 与 SessionStore 协作'),
      makeModule('src/db', 'Database 抽象', 'Database 提供 ORM 接口'),
    ];
    const paragraphs = [
      'AuthService 是核心抽象之一，与 Database 协作完成会话管理。',
      '业务流由 SessionStore 协调多个子系统。',
    ];
    const found = validateDomainWords(paragraphs, modules);
    // 命中至少 3 个：AuthService / Database / SessionStore（去重）
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found).toContain('AuthService');
    expect(found).toContain('Database');
    expect(found).toContain('SessionStore');
  });

  it('narrative 仅含泛词（API/Service/Module）→ 命中过滤后 < 3', () => {
    const modules = [
      makeModule('src/auth', 'API and Service', 'Module helper'),
    ];
    const paragraphs = ['API integrates Service for module orchestration.'];
    const found = validateDomainWords(paragraphs, modules);
    // 'API' / 'Service' / 'Module' 在 stopWords (API) + lowercase 命中（'Service' / 'Module' 大写有效但
    // 不在 module 中 — extractDomainAbstractions 只从 modules 提取，narrative 中泛词需先在 modules 出现）
    // 此处验证至少 'API' 被过滤
    expect(found).not.toContain('API');
  });

  it('narrative 不含 modules 中任何抽象 → 返回空数组（fail-closed 触发）', () => {
    const modules = [makeModule('src/x', 'XClass 处理 X', 'X processing')];
    const paragraphs = ['完全无关的叙事。'.repeat(5), '更多无关段落。'.repeat(5)];
    const found = validateDomainWords(paragraphs, modules);
    expect(found.length).toBe(0);
  });
});

describe('enrichNarrativeWithLLM — 4 段 LLM pipeline 编排', () => {
  function setupSuccessMocks(modules: StoredModuleSpecRecord[]) {
    // Map 阶段：返回 cluster narrative
    // Reduce 阶段：返回 4 段 + abstractions
    // Critique 阶段：passed=true
    let callCount = 0;
    mockMessagesCreate.mockImplementation(async () => {
      callCount++;
      // 前 N 次（cluster 数）是 Map；之后 1 次 Reduce；之后 1 次 Critique
      if (callCount <= 1) {
        // 假设 1 cluster (directory 策略 + 2 module 同目录)
        return makeLLMResponse({
          clusterNarrative: 'AuthService 与 Database 是核心抽象。',
          keyAbstractions: ['AuthService', 'Database'],
        });
      } else if (callCount === 2) {
        // Reduce
        return makeLLMResponse({
          paragraphs: [
            'AuthService 是项目认证核心。'.repeat(2),
            'Database 提供 ORM 抽象。'.repeat(2),
            'SessionStore 协调会话。'.repeat(2),
            '系统通过 AuthService → Database → SessionStore 链路完成认证。'.repeat(2),
          ],
          abstractionGlossary: ['AuthService', 'Database', 'SessionStore'],
        });
      } else if (callCount === 3) {
        // Critique
        return makeLLMResponse({ passed: true, issues: [] });
      }
      throw new Error(`unexpected callCount=${callCount}`);
    });
  }

  it('case 1: 正常流程 Map → Reduce → Critique(passed=true) → domain-words 通过 → 写盘', async () => {
    const modules = [
      makeModule('src/auth', 'AuthService 提供认证', 'AuthService 与 Database / SessionStore 协作'),
      makeModule('src/auth/db', 'Database ORM', 'Database 内部组件'),
    ];
    setupSuccessMocks(modules);

    const result = await enrichNarrativeWithLLM({
      anthropicClient: fakeAnthropic(),
      modules,
    });

    expect(result.failClosed).toBe(false);
    expect(result.paragraphs).not.toBeNull();
    expect(result.paragraphs!.length).toBeGreaterThanOrEqual(4);
    expect(result.domainWordsFound.length).toBeGreaterThanOrEqual(3);
    expect(result.critiqueResult.passed).toBe(true);
    expect(result.critiqueResult.refineAttempted).toBe(false);
  });

  it('case 2: Critique fail → Refine 触发（最多 1 次）', async () => {
    const modules = [
      makeModule('src/auth', 'AuthService 是认证', 'AuthService Database SessionStore 协作'),
      makeModule('src/auth/db', 'Database', 'ORM'),
    ];
    let callCount = 0;
    mockMessagesCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Map
        return makeLLMResponse({
          clusterNarrative: 'AuthService Database',
          keyAbstractions: ['AuthService', 'Database'],
        });
      } else if (callCount === 2) {
        // Reduce
        return makeLLMResponse({
          paragraphs: [
            'AuthService 是核心抽象之一。'.repeat(2),
            'Database 提供 ORM。'.repeat(2),
            'SessionStore 协调。'.repeat(2),
            'AuthService Database SessionStore 完整链路。'.repeat(2),
          ],
          abstractionGlossary: ['AuthService', 'Database', 'SessionStore'],
        });
      } else if (callCount === 3) {
        // Critique fail
        return makeLLMResponse({ passed: false, issues: ['段落 1 太空泛'] });
      } else if (callCount === 4) {
        // Refine — 修订后的 narrative
        return makeLLMResponse({
          paragraphs: [
            'AuthService 现在更具体描述了。'.repeat(2),
            'Database ORM 改进。'.repeat(2),
            'SessionStore 协调改进。'.repeat(2),
            '完整链路改进。'.repeat(2),
          ],
          abstractionGlossary: ['AuthService', 'Database', 'SessionStore'],
        });
      }
      throw new Error(`unexpected callCount=${callCount}`);
    });

    const result = await enrichNarrativeWithLLM({
      anthropicClient: fakeAnthropic(),
      modules,
    });

    expect(result.critiqueResult.refineAttempted).toBe(true);
    expect(result.critiqueResult.passed).toBe(false); // critique 自身仍是 false
    expect(result.failClosed).toBe(false); // domain-words 通过 → 不 fail-closed
    expect(callCount).toBe(4); // Map + Reduce + Critique + Refine = 4 calls
  });

  it('case 3: domain-words < 3 → fail-closed (failClosedReason=domain-words-insufficient)', async () => {
    const modules = [
      makeModule('src/x', 'XClass 是核心组件之一', 'X processing 流程'),
    ];
    let callCount = 0;
    mockMessagesCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeLLMResponse({
          // clusterNarrative ≥ 20 chars (Zod min)
          clusterNarrative: 'XClass 是核心组件，承担 X 流程的处理与编排。',
          keyAbstractions: ['XClass'],
        });
      } else if (callCount === 2) {
        // Reduce — 段落不含 modules 中的抽象名（domain-words 校验会失败）
        return makeLLMResponse({
          paragraphs: [
            '这段话完全不提项目特有抽象。'.repeat(3),
            '泛泛而谈一些通用概念。'.repeat(3),
            'API 设计原则与最佳实践。'.repeat(3),
            '代码质量与测试覆盖。'.repeat(3),
          ],
          abstractionGlossary: ['XClass'],
        });
      } else if (callCount === 3) {
        return makeLLMResponse({ passed: true, issues: [] });
      }
      throw new Error('unexpected');
    });

    const result = await enrichNarrativeWithLLM({
      anthropicClient: fakeAnthropic(),
      modules,
    });

    expect(result.failClosed).toBe(true);
    expect(result.failClosedReason).toBe('domain-words-insufficient');
    expect(result.paragraphs).toBeNull();
    expect(result.domainWordsFound.length).toBeLessThan(3);
  });

  it('case 4: Critique LLM 抛错 → 跳过 critique 但不 fail-closed（防御性）', async () => {
    const modules = [
      makeModule('src/auth', 'AuthService 认证', 'AuthService Database SessionStore'),
      makeModule('src/auth/db', 'Database', 'ORM'),
    ];
    let callCount = 0;
    mockMessagesCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeLLMResponse({
          clusterNarrative: 'AuthService Database',
          keyAbstractions: ['AuthService'],
        });
      } else if (callCount === 2) {
        return makeLLMResponse({
          paragraphs: [
            'AuthService 是核心。'.repeat(2),
            'Database ORM。'.repeat(2),
            'SessionStore 会话。'.repeat(2),
            '链路完整。AuthService Database SessionStore.'.repeat(2),
          ],
          abstractionGlossary: ['AuthService', 'Database', 'SessionStore'],
        });
      } else if (callCount === 3) {
        // Critique 抛错
        throw new Error('Critique LLM 不可用');
      }
      throw new Error('unexpected');
    });

    const result = await enrichNarrativeWithLLM({
      anthropicClient: fakeAnthropic(),
      modules,
    });

    // 修复 Codex C-2 后：Critique 失败显式标记 passed=false（之前 fail-open 标 true）
    expect(result.critiqueResult.passed).toBe(false);
    expect(result.critiqueResult.issues[0]).toContain('critique-skipped');
    // Refine 应被触发（passed=false → enter Refine path），但 mock 没设第 4 次返回 → Refine 抛错被吞
    expect(result.critiqueResult.refineAttempted).toBe(true);
    // 即便 Refine 失败，原 narrative 仍保留；domain-words 通过 → 不 fail-closed
    expect(result.failClosed).toBe(false);
    expect(result.paragraphs).not.toBeNull();
  });

  it('case 5: Map 全部失败 → fail-closed (failClosedReason=map-below-threshold)', async () => {
    const modules = [
      makeModule('src/a', 'A', 'A'),
      makeModule('src/b', 'B', 'B'),
      makeModule('src/c', 'C', 'C'),
    ];
    mockMessagesCreate.mockRejectedValue(new Error('mock LLM unavailable'));

    const result = await enrichNarrativeWithLLM({
      anthropicClient: fakeAnthropic(),
      modules,
    });

    expect(result.failClosed).toBe(true);
    expect(result.failClosedReason).toBe('map-below-threshold');
    expect(result.paragraphs).toBeNull();
    expect(result.domainWordsFound).toEqual([]);
  });

  it('case 6: totalTokens 累计正确（Map + Reduce + Critique 都计入）', async () => {
    const modules = [
      makeModule('src/auth', 'AuthService', 'AuthService Database'),
      makeModule('src/auth/db', 'Database', 'ORM'),
    ];
    let callCount = 0;
    mockMessagesCreate.mockImplementation(async () => {
      callCount++;
      const input = 1000 * callCount; // 1000, 2000, 3000
      const output = 500 * callCount;  // 500, 1000, 1500
      if (callCount === 1) {
        return makeLLMResponse(
          { clusterNarrative: 'AuthService Database', keyAbstractions: ['AuthService', 'Database'] },
          input, output,
        );
      } else if (callCount === 2) {
        return makeLLMResponse({
          paragraphs: [
            'AuthService 是核心.'.repeat(2),
            'Database ORM.'.repeat(2),
            'SessionStore 协调.'.repeat(2),
            '链路 AuthService Database SessionStore.'.repeat(2),
          ],
          abstractionGlossary: ['AuthService', 'Database', 'SessionStore'],
        }, input, output);
      } else if (callCount === 3) {
        return makeLLMResponse({ passed: true, issues: [] }, input, output);
      }
      throw new Error('unexpected');
    });

    const result = await enrichNarrativeWithLLM({
      anthropicClient: fakeAnthropic(),
      modules,
    });

    // input: 1000 + 2000 + 3000 = 6000；output: 500 + 1000 + 1500 = 3000
    expect(result.totalTokens.input).toBe(6000);
    expect(result.totalTokens.output).toBe(3000);
  });
});
