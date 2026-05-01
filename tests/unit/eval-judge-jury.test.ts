import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

interface JuryModule {
  parseArgs: (argv: string[]) => Record<string, unknown>;
  parseJudgeJson: (text: string) => { score: number; rationale: string; issues: string[] };
  median: (arr: number[]) => number | null;
  aggregateJury: (scores: number[]) => {
    juryMedian: number | null;
    juryMean: number | null;
    jurySpread: number | null;
    juryAgreement: 'no-data' | 'single-judge' | 'high' | 'medium' | 'low';
  };
  buildAdversarialPrompt: (input: { taskPrompt: string; diff: string }) => string;
  anonymizeDiff: (diff: string, reverseMap: Map<string, string>) => string;
  callJudgeViaSdk: (input: {
    model: string;
    prompt: string;
    clientFactory: () => Promise<{ messages: { create: (...args: unknown[]) => Promise<unknown> } }>;
  }) => Promise<{ judge: string; score: number | null; rationale: string; issues: string[] }>;
  runJuryOnFixture: (input: {
    fixturePath: string;
    judges?: string[];
    dryRun?: boolean;
    clientFactory?: () => Promise<unknown>;
    taskFixturesDir: string;
  }) => Promise<{ juryMedian: number | null; juryScores: Array<{ judge: string; score: number | null }> }>;
}

let cached: JuryModule | undefined;
async function loadJury(): Promise<JuryModule> {
  if (cached) return cached;
  const url = pathToFileURL(resolve('scripts/eval-judge-jury.mjs')).href;
  cached = (await import(url)) as JuryModule;
  return cached;
}

describe('eval-judge-jury', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jury-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseArgs', () => {
    it('parses --fixture', async () => {
      const { parseArgs } = await loadJury();
      const a = parseArgs(['--fixture', '/path/full.json']);
      expect(a.fixture).toBe('/path/full.json');
    });

    it('parses --task --tool', async () => {
      const { parseArgs } = await loadJury();
      const a = parseArgs(['--task', 'T1', '--tool', 'spec-driver']);
      expect(a.task).toBe('T1');
      expect(a.tool).toBe('spec-driver');
    });

    it('parses --judges comma list', async () => {
      const { parseArgs } = await loadJury();
      const a = parseArgs(['--all', '--judges', 'claude-sonnet-4-6,claude-opus-4-7,gpt-4o']);
      expect(a.judges).toEqual(['claude-sonnet-4-6', 'claude-opus-4-7', 'gpt-4o']);
    });

    it('throws when neither --fixture nor --task+tool nor --all', async () => {
      const { parseArgs } = await loadJury();
      expect(() => parseArgs([])).toThrow(/fixture.*task.*tool.*all required/);
    });
  });

  describe('parseJudgeJson', () => {
    it('extracts JSON from raw text', async () => {
      const { parseJudgeJson } = await loadJury();
      const r = parseJudgeJson('{"score": 7, "rationale": "ok", "issues": ["x", "y"]}');
      expect(r.score).toBe(7);
      expect(r.rationale).toBe('ok');
      expect(r.issues).toEqual(['x', 'y']);
    });

    it('extracts JSON from markdown code fence', async () => {
      const { parseJudgeJson } = await loadJury();
      const r = parseJudgeJson('```json\n{"score": 8, "rationale": "good", "issues": []}\n```');
      expect(r.score).toBe(8);
      expect(r.issues).toEqual([]);
    });

    it('extracts JSON when LLM adds preamble text', async () => {
      const { parseJudgeJson } = await loadJury();
      const r = parseJudgeJson('好的，下面是评分：\n{"score": 5, "rationale": "ok", "issues": ["a"]}\n');
      expect(r.score).toBe(5);
    });

    it('throws when no JSON object in response', async () => {
      const { parseJudgeJson } = await loadJury();
      expect(() => parseJudgeJson('no json here')).toThrow(/no JSON object/);
    });

    it('coerces string score to number', async () => {
      const { parseJudgeJson } = await loadJury();
      const r = parseJudgeJson('{"score": "6", "rationale": "x", "issues": []}');
      expect(r.score).toBe(6);
    });
  });

  describe('aggregateJury', () => {
    it('median + mean + spread + agreement: high', async () => {
      const { aggregateJury } = await loadJury();
      const a = aggregateJury([7, 8]);
      expect(a.juryMedian).toBe(7.5);
      expect(a.juryMean).toBe(7.5);
      expect(a.jurySpread).toBe(1);
      expect(a.juryAgreement).toBe('high');
    });

    it('agreement: medium when spread=2', async () => {
      const { aggregateJury } = await loadJury();
      expect(aggregateJury([6, 8]).juryAgreement).toBe('medium');
    });

    it('agreement: low when spread > 2', async () => {
      const { aggregateJury } = await loadJury();
      expect(aggregateJury([4, 8]).juryAgreement).toBe('low');
    });

    it('agreement: single-judge when 1 score', async () => {
      const { aggregateJury } = await loadJury();
      expect(aggregateJury([7]).juryAgreement).toBe('single-judge');
    });

    it('agreement: no-data when empty', async () => {
      const { aggregateJury } = await loadJury();
      const a = aggregateJury([]);
      expect(a.juryAgreement).toBe('no-data');
      expect(a.juryMedian).toBeNull();
    });

    it('odd count median picks middle', async () => {
      const { aggregateJury } = await loadJury();
      expect(aggregateJury([3, 7, 8]).juryMedian).toBe(7);
    });
  });

  describe('anonymizeDiff', () => {
    it('replaces tool names with <TOOL>', async () => {
      const { anonymizeDiff } = await loadJury();
      const reverseMap = new Map([['<TOOL_A>', 'spec-driver-spectra']]);
      const out = anonymizeDiff('--- a/spec-driver-spectra/file.py', reverseMap);
      expect(out).toBe('--- a/<TOOL>/file.py');
    });

    it('hard-codes spec-driver-{opus,spectra} replacement (defense in depth)', async () => {
      const { anonymizeDiff } = await loadJury();
      const out = anonymizeDiff('path: spec-driver-opus/x', new Map());
      expect(out).toContain('<TOOL>');
      expect(out).not.toContain('spec-driver-opus');
    });
  });

  describe('buildAdversarialPrompt', () => {
    it('includes task prompt + diff + adversarial instructions', async () => {
      const { buildAdversarialPrompt } = await loadJury();
      const p = buildAdversarialPrompt({ taskPrompt: 'add tanh', diff: '+def tanh' });
      expect(p).toContain('add tanh');
      expect(p).toContain('+def tanh');
      expect(p).toMatch(/严格的代码评审者/);
      expect(p).toMatch(/找出.*至少 2 个.*问题/);
      expect(p).toContain('"score"');
      expect(p).toContain('"issues"');
    });

    it('does not leak fixture identity / tool name', async () => {
      const { buildAdversarialPrompt } = await loadJury();
      const p = buildAdversarialPrompt({ taskPrompt: 'task', diff: 'diff' });
      // Prompt explicitly tells judge NOT to guess identity
      expect(p).toMatch(/匿名化/);
      expect(p).toMatch(/不要尝试猜测/);
    });
  });

  describe('callJudgeViaSdk (with mocked clientFactory)', () => {
    it('calls SDK with correct args + parses response', async () => {
      const { callJudgeViaSdk } = await loadJury();
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"score": 8, "rationale": "good", "issues": ["x"]}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      const clientFactory = vi.fn().mockResolvedValue({ messages: { create } });
      const r = await callJudgeViaSdk({ model: 'claude-opus-4-7', prompt: 'p', clientFactory });
      expect(r.judge).toBe('claude-opus-4-7');
      expect(r.score).toBe(8);
      expect(r.issues).toEqual(['x']);
      expect(r.promptTokens).toBe(100);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        model: 'claude-opus-4-7',
        max_tokens: 1500,
        temperature: 0.3,
        messages: [{ role: 'user', content: 'p' }],
      }));
    });

    it('returns score=null with rawText preserved on parse error', async () => {
      const { callJudgeViaSdk } = await loadJury();
      const clientFactory = vi.fn().mockResolvedValue({
        messages: { create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'lol no JSON here' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }) },
      });
      const r = await callJudgeViaSdk({ model: 'claude-opus-4-7', prompt: 'p', clientFactory });
      expect(r.score).toBeNull();
      expect(r.rationale).toMatch(/parse error/);
    });
  });

  describe('runJuryOnFixture (integration with mocked SDK)', () => {
    it('writes juryScores + median + spread back to fixture', async () => {
      const { runJuryOnFixture } = await loadJury();
      // build fake fixture + task fixture
      const taskFxDir = join(tempDir, 'task-fixtures');
      mkdirSync(taskFxDir, { recursive: true });
      writeFileSync(join(taskFxDir, 'T1.json'), JSON.stringify({ taskId: 'T1', prompt: 'add tanh' }));

      const fixturePath = join(tempDir, 'full.json');
      writeFileSync(fixturePath, JSON.stringify({
        meta: { tool: 'spec-driver-opus' },
        taskExecution: { taskId: 'T1', tool: 'spec-driver-opus', diffStat: '+def tanh\n' },
      }));

      const create = vi.fn()
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"score": 7, "rationale": "decent", "issues": ["i1", "i2"]}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"score": 8, "rationale": "good", "issues": ["i3"]}' }],
          usage: { input_tokens: 110, output_tokens: 60 },
        });
      const clientFactory = vi.fn().mockResolvedValue({ messages: { create } });

      const result = await runJuryOnFixture({
        fixturePath,
        judges: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        clientFactory,
        taskFixturesDir: taskFxDir,
      });

      expect(result.juryMedian).toBe(7.5);
      expect(result.juryScores).toHaveLength(2);
      expect(create).toHaveBeenCalledTimes(2);

      // 验证写回 fixture
      const written = JSON.parse(readFileSync(fixturePath, 'utf-8'));
      expect(written.taskExecution.juryScores).toHaveLength(2);
      expect(written.taskExecution.juryMedian).toBe(7.5);
      expect(written.taskExecution.jurySpread).toBe(1);
      expect(written.taskExecution.juryAgreement).toBe('high');
      expect(written.taskExecution.juryAnonymized).toBe(true);
      expect(written.taskExecution.juryAdversarial).toBe(true);
    });

    it('continues when 1 judge fails (records null score)', async () => {
      const { runJuryOnFixture } = await loadJury();
      const taskFxDir = join(tempDir, 'task-fixtures');
      mkdirSync(taskFxDir, { recursive: true });
      writeFileSync(join(taskFxDir, 'T1.json'), JSON.stringify({ taskId: 'T1', prompt: 'x' }));
      const fixturePath = join(tempDir, 'full.json');
      writeFileSync(fixturePath, JSON.stringify({ taskExecution: { taskId: 'T1' } }));

      const create = vi.fn()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"score": 6, "rationale": "ok", "issues": []}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });
      const clientFactory = vi.fn().mockResolvedValue({ messages: { create } });

      const result = await runJuryOnFixture({
        fixturePath,
        judges: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        clientFactory,
        taskFixturesDir: taskFxDir,
      });

      expect(result.juryScores).toHaveLength(2);
      expect(result.juryScores[0].score).toBeNull();
      expect(result.juryScores[1].score).toBe(6);
      expect(result.juryMedian).toBe(6); // only 1 valid score
    });

    it('dry-run returns mock scores without calling SDK', async () => {
      const { runJuryOnFixture } = await loadJury();
      const taskFxDir = join(tempDir, 'task-fixtures');
      mkdirSync(taskFxDir, { recursive: true });
      writeFileSync(join(taskFxDir, 'T1.json'), JSON.stringify({ taskId: 'T1', prompt: 'x' }));
      const fixturePath = join(tempDir, 'full.json');
      writeFileSync(fixturePath, JSON.stringify({ taskExecution: { taskId: 'T1' } }));

      const clientFactory = vi.fn(); // should NOT be called

      const result = await runJuryOnFixture({
        fixturePath,
        judges: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        dryRun: true,
        clientFactory,
        taskFixturesDir: taskFxDir,
      });

      expect(clientFactory).not.toHaveBeenCalled();
      expect(result.juryScores).toHaveLength(2);
      expect(result.juryScores.every((j) => j.rationale.includes('dry-run'))).toBe(true);
    });

    it('throws when fixture has no taskId', async () => {
      const { runJuryOnFixture } = await loadJury();
      const fixturePath = join(tempDir, 'full.json');
      writeFileSync(fixturePath, JSON.stringify({ taskExecution: {} }));
      await expect(
        runJuryOnFixture({ fixturePath, dryRun: true, taskFixturesDir: tempDir }),
      ).rejects.toThrow(/no taskId/);
    });
  });

  describe('atomicWriteJson', () => {
    it('writes via tmp + rename (no partial writes on crash)', async () => {
      const url = pathToFileURL(resolve('scripts/eval-judge-jury.mjs')).href;
      const { atomicWriteJson } = (await import(url)) as { atomicWriteJson: (p: string, o: unknown) => void };
      const target = join(tempDir, 'data.json');
      atomicWriteJson(target, { a: 1, b: 'hello' });
      expect(readFileSync(target, 'utf-8')).toContain('"a": 1');
      // Verify no leftover .tmp files
      const leftovers = require('node:fs').readdirSync(tempDir).filter((n: string) => n.endsWith('.tmp'));
      expect(leftovers).toHaveLength(0);
    });

    it('overwrites existing file atomically', async () => {
      const url = pathToFileURL(resolve('scripts/eval-judge-jury.mjs')).href;
      const { atomicWriteJson } = (await import(url)) as { atomicWriteJson: (p: string, o: unknown) => void };
      const target = join(tempDir, 'data.json');
      writeFileSync(target, JSON.stringify({ old: true }));
      atomicWriteJson(target, { new: true });
      expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ new: true });
    });
  });
});
