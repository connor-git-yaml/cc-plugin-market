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
  parseJudgeBackend: (judgeModel: string) => {
    provider: 'anthropic' | 'openai-compat' | 'claude-cli' | 'codex-cli';
    vendor: string;
    model: string;
    baseURL: string | null;
    apiKeyEnv: string | null;
  };
  spawnAsync: (cmd: string, args: string[], opts?: { timeoutMs?: number; stdin?: string | null }) => Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
    killed: boolean;
  }>;
  normalizeSdkError: (e: unknown) => {
    message: string;
    status: number | null;
    code: string | null;
    type: string | null;
    requestId: string | null;
    retryAfterMs: number | null;
    isRateLimit: boolean;
    isServerError: boolean;
  };
  callJudgeViaSdk: (input: {
    model: string;
    prompt: string;
    clientFactory: (model: string) => Promise<{
      backend?: { vendor: string };
      invoke: (prompt: string) => Promise<{ text: string; promptTokens: number | null; completionTokens: number | null }>;
    }>;
  }) => Promise<{ judge: string; vendor?: string | null; score: number | null; rationale: string; issues: string[] }>;
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

    it('falls back to regex when rationale contains unescaped quotes (GLM-5.1 bug)', async () => {
      const { parseJudgeJson } = await loadJury();
      // 真实 GLM-5.1 bug 复现：rationale 内嵌 "1-2 个" 引号未转义破坏 JSON
      const buggy = '```json\n{\n  "score": 4,\n  "rationale": "test_engine.py 新增 30 行对于"1-2 个简单 unit test"要求超出。",\n  "issues": ["x"]\n}\n```';
      const r = parseJudgeJson(buggy);
      expect(r.score).toBe(4); // 至少 score 提取成功
      expect(r.issues[0]).toMatch(/parse-recovered/);
    });

    it('fallback regex 不被 rationale 内嵌的 "score: 0" 字眼误导 (Codex CRITICAL)', async () => {
      const { parseJudgeJson } = await loadJury();
      // 攻击场景：JSON 损坏 + rationale 在真实 score 之前提到 "score": 0
      // 旧 regex: /"score"\s*:\s*(\d+)/  → 会先匹配 rationale 字符串里的 0
      // 新 regex: 必须紧跟 { 或 , 才算 top-level 键
      const tricky = '{\n  "rationale": "工具说 \\"score\\": 0 不合理，"score":0 也是错误的，"\n  ,"score": 7\n}';
      const r = parseJudgeJson(tricky);
      expect(r.score).toBe(7); // 必须取 top-level 字段，不是 rationale 里的 0
    });

    it('throws if score also unparseable in fallback', async () => {
      const { parseJudgeJson } = await loadJury();
      const noScore = '{"rationale": "x"}';
      expect(() => parseJudgeJson(noScore)).toThrow();
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

    it('uses full KNOWN_TOOL_NAMES as defense-in-depth (Codex WARN)', async () => {
      const { anonymizeDiff } = await loadJury();
      // 即使 reverseMap 没含 'graphify' / 'superpowers' / 'gstack' 等名字，也要 strip
      const dirty = '+ from graphify import x\n+ # superpowers brainstorm phase\n+ // gstack review';
      const out = anonymizeDiff(dirty, new Map());
      expect(out).not.toMatch(/graphify/i);
      expect(out).not.toMatch(/superpowers/i);
      expect(out).not.toMatch(/gstack/i);
      expect(out).toContain('<TOOL>');
    });

    it('case-insensitive tool name strip (e.g. comments with capitalized names)', async () => {
      const { anonymizeDiff } = await loadJury();
      const out = anonymizeDiff('// Used by Spectra and SuperPowers', new Map());
      expect(out).not.toMatch(/spectra|superpowers/i);
    });

    it('long-name precedes short-name (spec-driver-spectra before spec-driver)', async () => {
      const { anonymizeDiff } = await loadJury();
      const out = anonymizeDiff('using spec-driver-spectra workflow', new Map());
      // 不能让 spec-driver 先匹配，留下 -spectra 残段
      expect(out).not.toContain('-spectra');
      expect(out).toContain('<TOOL>');
    });

    it('short tool name uses word-boundary (Codex CRITICAL: control vs uncontrolled)', async () => {
      const { anonymizeDiff } = await loadJury();
      // 'control' 不应该拆 'uncontrolled' / 'controller' / 'controlled'
      const dirty = '+ # an uncontrolled scenario, the controller catches errors';
      const out = anonymizeDiff(dirty, new Map());
      expect(out).toContain('uncontrolled');   // 不能被改成 un<TOOL>led
      expect(out).toContain('controller');     // 不能被改成 <TOOL>ler
      expect(out).not.toContain('un<TOOL>');
    });

    it('short tool name still strips standalone usage (control as bench label)', async () => {
      const { anonymizeDiff } = await loadJury();
      // standalone 'control' as eval tool name 仍要 strip
      const dirty = 'baseline tool: control vs spec-driver';
      const out = anonymizeDiff(dirty, new Map());
      expect(out).toMatch(/baseline tool: <TOOL>/i);
    });

    it('reverseMap short value also gets word-boundary protection', async () => {
      const { anonymizeDiff } = await loadJury();
      const reverseMap = new Map([['<TOOL_X>', 'aider']]);
      const dirty = 'aider helps; raider unrelated';
      const out = anonymizeDiff(dirty, reverseMap);
      expect(out).toContain('raider');           // 不能拆 'raider'
      expect(out).toMatch(/^<TOOL> helps/);      // 'aider' 单独出现要 strip
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

  describe('parseJudgeBackend (multi-vendor dispatcher)', () => {
    it('parses claude-* as Anthropic native', async () => {
      const { parseJudgeBackend } = await loadJury();
      const b = parseJudgeBackend('claude-sonnet-4-6');
      expect(b.provider).toBe('anthropic');
      expect(b.vendor).toBe('anthropic');
      expect(b.model).toBe('claude-sonnet-4-6');
      expect(b.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
      expect(b.baseURL).toBeNull();
    });

    it('parses siliconflow:<model> with vendor + baseURL', async () => {
      const { parseJudgeBackend } = await loadJury();
      const b = parseJudgeBackend('siliconflow:zai-org/GLM-4.6');
      expect(b.provider).toBe('openai-compat');
      expect(b.vendor).toBe('siliconflow');
      expect(b.model).toBe('zai-org/GLM-4.6');
      expect(b.apiKeyEnv).toBe('SILICONFLOW_API_KEY');
      expect(b.baseURL).toMatch(/siliconflow\.cn/);
    });

    it('parses openai:<model> as native OpenAI', async () => {
      const { parseJudgeBackend } = await loadJury();
      const b = parseJudgeBackend('openai:gpt-4o');
      expect(b.provider).toBe('openai-compat');
      expect(b.vendor).toBe('openai');
      expect(b.model).toBe('gpt-4o');
      expect(b.apiKeyEnv).toBe('OPENAI_API_KEY');
      expect(b.baseURL).toMatch(/openai\.com/);
    });

    it('parses claude-cli:<model> as Anthropic via CLI subscription (no apiKey)', async () => {
      const { parseJudgeBackend } = await loadJury();
      const b = parseJudgeBackend('claude-cli:claude-opus-4-7');
      expect(b.provider).toBe('claude-cli');
      expect(b.vendor).toBe('anthropic');
      expect(b.model).toBe('claude-opus-4-7');
      expect(b.apiKeyEnv).toBeNull();
    });

    it('parses codex:<model> as OpenAI via Codex CLI subscription (no apiKey)', async () => {
      const { parseJudgeBackend } = await loadJury();
      const b = parseJudgeBackend('codex:gpt-5.5');
      expect(b.provider).toBe('codex-cli');
      expect(b.vendor).toBe('openai');
      expect(b.model).toBe('gpt-5.5');
      expect(b.apiKeyEnv).toBeNull();
    });

    it('SILICONFLOW_BASE_URL env override works', async () => {
      const { parseJudgeBackend } = await loadJury();
      const original = process.env.SILICONFLOW_BASE_URL;
      process.env.SILICONFLOW_BASE_URL = 'https://custom.proxy/v1';
      try {
        const b = parseJudgeBackend('siliconflow:zai-org/GLM-4.6');
        expect(b.baseURL).toBe('https://custom.proxy/v1');
      } finally {
        if (original === undefined) delete process.env.SILICONFLOW_BASE_URL;
        else process.env.SILICONFLOW_BASE_URL = original;
      }
    });
  });

  describe('callJudgeViaSdk (adapter-pattern client)', () => {
    it('calls injected client.invoke + returns parsed score + vendor', async () => {
      const { callJudgeViaSdk } = await loadJury();
      const invoke = vi.fn().mockResolvedValue({
        text: '{"score": 8, "rationale": "good", "issues": ["x"]}',
        promptTokens: 100,
        completionTokens: 50,
      });
      const clientFactory = vi.fn().mockResolvedValue({
        backend: { vendor: 'siliconflow' },
        invoke,
      });
      const r = await callJudgeViaSdk({ model: 'siliconflow:zai-org/GLM-4.6', prompt: 'p', clientFactory });
      expect(r.judge).toBe('siliconflow:zai-org/GLM-4.6');
      expect(r.vendor).toBe('siliconflow');
      expect(r.score).toBe(8);
      expect(r.issues).toEqual(['x']);
      expect(r.promptTokens).toBe(100);
      expect(invoke).toHaveBeenCalledWith('p');
      expect(clientFactory).toHaveBeenCalledWith('siliconflow:zai-org/GLM-4.6');
    });

    it('returns score=null with rawText preserved on parse error', async () => {
      const { callJudgeViaSdk } = await loadJury();
      const clientFactory = vi.fn().mockResolvedValue({
        backend: { vendor: 'anthropic' },
        invoke: vi.fn().mockResolvedValue({
          text: 'lol no JSON here',
          promptTokens: 100,
          completionTokens: 50,
        }),
      });
      const r = await callJudgeViaSdk({ model: 'claude-opus-4-7', prompt: 'p', clientFactory });
      expect(r.score).toBeNull();
      expect(r.rationale).toMatch(/parse error/);
    });

    it('clientFactory receives full judgeModel (not stripped)', async () => {
      const { callJudgeViaSdk } = await loadJury();
      const clientFactory = vi.fn().mockResolvedValue({
        invoke: vi.fn().mockResolvedValue({ text: '{"score": 5, "rationale": "x", "issues": []}', promptTokens: 1, completionTokens: 1 }),
      });
      await callJudgeViaSdk({ model: 'siliconflow:Qwen/Qwen3-Coder-30B-A3B-Instruct', prompt: 'p', clientFactory });
      // clientFactory 必须收到完整 'siliconflow:...' 字符串以便它内部 dispatch backend
      expect(clientFactory).toHaveBeenCalledWith('siliconflow:Qwen/Qwen3-Coder-30B-A3B-Instruct');
    });

    it('captures finishReason + truncated flag from invoke (Codex WARN)', async () => {
      const { callJudgeViaSdk } = await loadJury();
      const clientFactory = vi.fn().mockResolvedValue({
        backend: { vendor: 'siliconflow' },
        invoke: vi.fn().mockResolvedValue({
          text: '{"score": 7, "rationale": "x", "issues": []}',
          promptTokens: 100, completionTokens: 4000,
          finishReason: 'length',
          truncated: true,
        }),
      });
      const r = await callJudgeViaSdk({ model: 'siliconflow:x', prompt: 'p', clientFactory }) as Record<string, unknown>;
      expect(r.finishReason).toBe('length');
      expect(r.truncated).toBe(true);
    });

    it('truncated flag preserved on parse error', async () => {
      const { callJudgeViaSdk } = await loadJury();
      const clientFactory = vi.fn().mockResolvedValue({
        backend: { vendor: 'siliconflow' },
        invoke: vi.fn().mockResolvedValue({
          text: '{"score": 7, "rati', // truncated mid-key
          promptTokens: 100, completionTokens: 4000,
          finishReason: 'length',
          truncated: true,
        }),
      });
      const r = await callJudgeViaSdk({ model: 'siliconflow:x', prompt: 'p', clientFactory }) as Record<string, unknown>;
      expect(r.score).toBeNull();
      expect(r.rationale).toMatch(/truncated=true/);
      expect(r.truncated).toBe(true);
    });
  });

  describe('spawnAsync (CLI subprocess helper)', () => {
    it('captures stdout from echo', async () => {
      const { spawnAsync } = await loadJury();
      const r = await spawnAsync('echo', ['hello world']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('hello world');
      expect(r.killed).toBe(false);
    });

    it('captures stderr separately', async () => {
      const { spawnAsync } = await loadJury();
      const r = await spawnAsync('sh', ['-c', 'echo to-stderr 1>&2; echo to-stdout']);
      expect(r.stdout).toContain('to-stdout');
      expect(r.stderr).toContain('to-stderr');
    });

    it('returns non-zero status on failure', async () => {
      const { spawnAsync } = await loadJury();
      const r = await spawnAsync('sh', ['-c', 'exit 42']);
      expect(r.status).toBe(42);
    });

    it('kills process on timeout (does NOT hang on stdin)', async () => {
      const { spawnAsync } = await loadJury();
      // 关键：stdio[0]='ignore' 防止 child 等 stdin 卡死。'cat' 不带参数会等 stdin 直到 EOF；
      // 我们 ignore stdin → cat 立即结束 (空输入) — 不该触发 timeout
      const r = await spawnAsync('cat', [], { timeoutMs: 2000 });
      expect(r.killed).toBe(false);
      expect(r.status).toBe(0);
    });

    it('forwards stdin when provided', async () => {
      const { spawnAsync } = await loadJury();
      const r = await spawnAsync('cat', [], { stdin: 'piped input\n' });
      expect(r.stdout).toContain('piped input');
      expect(r.status).toBe(0);
    });

    it('respects timeout for genuine hang', async () => {
      const { spawnAsync } = await loadJury();
      const t0 = Date.now();
      const r = await spawnAsync('sleep', ['10'], { timeoutMs: 500 });
      expect(r.killed).toBe(true);
      expect(Date.now() - t0).toBeLessThan(2000);
    });
  });

  describe('normalizeSdkError (Codex WARN: SDK retry metadata)', () => {
    it('extracts status / code / type / requestId / retryAfter from SDK error', async () => {
      const { normalizeSdkError } = await loadJury();
      const sdkErr = {
        message: 'rate limit exceeded',
        status: 429,
        code: 'rate_limit_exceeded',
        type: 'rate_limit_error',
        request_id: 'req-abc',
        headers: { 'retry-after': '5' },
      };
      const ne = normalizeSdkError(sdkErr);
      expect(ne.status).toBe(429);
      expect(ne.isRateLimit).toBe(true);
      expect(ne.code).toBe('rate_limit_exceeded');
      expect(ne.requestId).toBe('req-abc');
      expect(ne.retryAfterMs).toBe(5000);
    });

    it('marks 5xx as isServerError', async () => {
      const { normalizeSdkError } = await loadJury();
      const ne = normalizeSdkError({ message: 'upstream error', status: 503 });
      expect(ne.isServerError).toBe(true);
      expect(ne.isRateLimit).toBe(false);
    });

    it('handles plain Error (no status)', async () => {
      const { normalizeSdkError } = await loadJury();
      const ne = normalizeSdkError(new Error('network down'));
      expect(ne.message).toBe('network down');
      expect(ne.status).toBeNull();
      expect(ne.isRateLimit).toBe(false);
    });

    it('handles non-Error input gracefully', async () => {
      const { normalizeSdkError } = await loadJury();
      const ne = normalizeSdkError('string error');
      expect(ne.message).toContain('string error');
    });
  });

  describe('runJuryOnFixture (integration with mocked SDK)', () => {
    it('writes juryScores + median + spread back to fixture', async () => {
      const { runJuryOnFixture } = await loadJury();
      const taskFxDir = join(tempDir, 'task-fixtures');
      mkdirSync(taskFxDir, { recursive: true });
      writeFileSync(join(taskFxDir, 'T1.json'), JSON.stringify({ taskId: 'T1', prompt: 'add tanh' }));

      const fixturePath = join(tempDir, 'full.json');
      writeFileSync(fixturePath, JSON.stringify({
        meta: { tool: 'spec-driver-opus' },
        taskExecution: { taskId: 'T1', tool: 'spec-driver-opus', diffStat: '+def tanh\n' },
      }));

      // 新 adapter contract: clientFactory 收 model arg → 返回 { backend, invoke }
      const invoke1 = vi.fn().mockResolvedValue({
        text: '{"score": 7, "rationale": "decent", "issues": ["i1", "i2"]}',
        promptTokens: 100, completionTokens: 50,
      });
      const invoke2 = vi.fn().mockResolvedValue({
        text: '{"score": 8, "rationale": "good", "issues": ["i3"]}',
        promptTokens: 110, completionTokens: 60,
      });
      const clientFactory = vi.fn()
        .mockResolvedValueOnce({ backend: { vendor: 'siliconflow' }, invoke: invoke1 })
        .mockResolvedValueOnce({ backend: { vendor: 'siliconflow' }, invoke: invoke2 });

      const result = await runJuryOnFixture({
        fixturePath,
        judges: ['siliconflow:zai-org/GLM-4.6', 'siliconflow:moonshotai/Kimi-K2-Instruct-0905'],
        clientFactory,
        taskFixturesDir: taskFxDir,
      });

      expect(result.juryMedian).toBe(7.5);
      expect(result.juryScores).toHaveLength(2);
      expect(invoke1).toHaveBeenCalled();
      expect(invoke2).toHaveBeenCalled();

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

      const clientFactory = vi.fn()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce({
          backend: { vendor: 'anthropic' },
          invoke: vi.fn().mockResolvedValue({
            text: '{"score": 6, "rationale": "ok", "issues": []}',
            promptTokens: 100, completionTokens: 50,
          }),
        });

      const result = await runJuryOnFixture({
        fixturePath,
        judges: ['claude-sonnet-4-6', 'claude-opus-4-7'],
        clientFactory,
        taskFixturesDir: taskFxDir,
      });

      expect(result.juryScores).toHaveLength(2);
      expect(result.juryScores[0].score).toBeNull();
      expect(result.juryScores[1].score).toBe(6);
      expect(result.juryMedian).toBe(6);
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
