/**
 * Feature 162 Phase A T020 — llm-backend-dispatcher 单元测试
 *
 * 12 case 矩阵：
 *   8 基础 case：4 backend × {success / error / token-usage 解析}
 *     - siliconflow-success / siliconflow-error
 *     - openai-success     / openai-error
 *     - claude-cli-success / claude-cli-error
 *     - codex-cli-success  / codex-cli-error
 *   4 retry matrix case (FR-014)：
 *     - RM-1 transient → success（retry 1 次）
 *     - RM-2 quota → fail（0 retry）
 *     - RM-3 truncation → fail（0 retry, partial=true）
 *     - RM-4 schema-invalid → fail（0 retry, rawResponse 记录）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  callBackend,
  classifyError,
  normalizeModelId,
  isRetryable,
  MODEL_ALIASES,
} from '../../scripts/lib/llm-backend-dispatcher.mjs';

// ============================================================
// Mock 工具：构造 OpenAI-compat / spawn 注入 deps
// ============================================================

interface OpenAiCompletionResponse {
  choices: Array<{ message: { content: string }; finish_reason: string }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

function makeOpenAiSuccess(text: string, in_: number, out: number, finishReason = 'stop'): OpenAiCompletionResponse {
  return {
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    usage: { prompt_tokens: in_, completion_tokens: out },
  };
}

function makeMemFs(files: Record<string, string>) {
  const written: Record<string, string> = { ...files };
  return {
    existsSync: (p: string) => p in written,
    readFileSync: (p: string, _enc: string) => written[p] ?? '',
    unlinkSync: (p: string) => { delete written[p]; },
    _written: written,
  };
}

beforeEach(() => {
  // 清空可能影响 callBackend 的 env
  delete process.env.SILICONFLOW_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

// ============================================================
// 8 基础 case
// ============================================================

describe('callBackend — 8 基础 case', () => {
  // --- siliconflow ---
  it('siliconflow-success：返回标准 shape + token usage', async () => {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    const r = await callBackend({
      model: 'siliconflow:Pro/zai-org/GLM-5.1',
      prompt: '{"x":1}',
      deps: {
        openaiCreate: async (_req: unknown) => makeOpenAiSuccess('{"score":7}', 100, 50),
      },
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{"score":7}');
    expect(r.promptTokens).toBe(100);
    expect(r.completionTokens).toBe(50);
    expect(r.finishReason).toBe('stop');
    expect(r.partial).toBe(false);
    expect(r.retried).toBe(0);
  });

  it('siliconflow-error：HTTP 503 抛错被分类为 transient（max retry 1 后仍 fail）', async () => {
    process.env.SILICONFLOW_API_KEY = 'test-key';
    let calls = 0;
    const r = await callBackend({
      model: 'siliconflow:Pro/zai-org/GLM-5.1',
      prompt: 'x',
      deps: {
        openaiCreate: async (_req: unknown) => {
          calls++;
          const err = new Error('upstream 503') as Error & { status: number };
          err.status = 503;
          throw err;
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('transient');
    expect(r.error?.retryable).toBe(true);
    expect(calls).toBe(2); // 1 原始 + 1 retry
    expect(r.retried).toBe(1);
  });

  // --- openai ---
  it('openai-success：基本路径走通', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const r = await callBackend({
      model: 'openai:gpt-4o',
      prompt: 'x',
      deps: {
        openaiCreate: async (_req: unknown) => makeOpenAiSuccess('hi', 10, 5),
      },
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('hi');
    expect(r.promptTokens).toBe(10);
    expect(r.completionTokens).toBe(5);
  });

  it('openai-error：HTTP 429 → quota（不 retry）', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    let calls = 0;
    const r = await callBackend({
      model: 'openai:gpt-4o',
      prompt: 'x',
      deps: {
        openaiCreate: async (_req: unknown) => {
          calls++;
          const err = new Error('rate_limit_exceeded') as Error & { status: number };
          err.status = 429;
          throw err;
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('quota');
    expect(r.error?.retryable).toBe(false);
    expect(calls).toBe(1);
    expect(r.retried).toBe(0);
  });

  // --- claude-cli ---
  it('claude-cli-success：stop_reason=end_turn → finishReason=stop；token 字段映射', async () => {
    const stdoutJson = JSON.stringify({
      result: 'patch JSON content',
      usage: { input_tokens: 200, output_tokens: 80 },
      stop_reason: 'end_turn',
      total_cost_usd: 0.012,
    });
    const r = await callBackend({
      model: 'claude-cli:claude-opus-4-7',
      prompt: 'x',
      deps: {
        spawnImpl: async (_cmd: string, _args: string[]): Promise<SpawnResult> => ({
          status: 0, stdout: stdoutJson, stderr: '', killed: false,
        }),
      },
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('patch JSON content');
    expect(r.promptTokens).toBe(200);
    expect(r.completionTokens).toBe(80);
    expect(r.finishReason).toBe('stop');
  });

  it('claude-cli-error：spawn exit !=0 → finishReason=error', async () => {
    const r = await callBackend({
      model: 'claude-cli:claude-opus-4-7',
      prompt: 'x',
      deps: {
        spawnImpl: async (_cmd: string, _args: string[]): Promise<SpawnResult> => ({
          status: 1, stdout: '', stderr: 'auth failed', killed: false,
        }),
      },
    });
    expect(r.ok).toBe(false);
    expect(r.finishReason).toBe('error');
    // auth failed 不属 transient/quota → unknown
    expect(['unknown', 'schema-invalid']).toContain(r.error?.code);
  });

  // --- codex-cli ---
  it('codex-cli-success：tmpFile + stderr token 解析；promptTokens=null', async () => {
    const memfs = makeMemFs({
      '/tmp/codex-out-test': 'codex generated patch text',
    });
    const r = await callBackend({
      model: 'codex:gpt-5.5',
      prompt: 'x',
      options: { reasoningEffort: 'medium' },
      deps: {
        tmpDir: '/tmp',
        spawnImpl: async (_cmd: string, args: string[]): Promise<SpawnResult> => {
          // 把 tmpFile 强制改名以匹配 memfs 注入的 key
          const tmpFileIdx = args.indexOf('--output-last-message') + 1;
          const realPath = args[tmpFileIdx];
          memfs._written[realPath] = 'codex generated patch text';
          return {
            status: 0, stdout: '', stderr: 'tokens used\n12,345\n', killed: false,
          };
        },
        fsImpl: memfs,
      },
    });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('codex generated patch text');
    expect(r.promptTokens).toBe(null); // codex CLI 不返回分项
    expect(r.completionTokens).toBe(12345);
    expect(r.finishReason).toBe('stop');
  });

  it('codex-cli-error：spawn exit !=0', async () => {
    const memfs = makeMemFs({});
    const r = await callBackend({
      model: 'codex:gpt-5.5',
      prompt: 'x',
      deps: {
        tmpDir: '/tmp',
        spawnImpl: async (_cmd: string, _args: string[]): Promise<SpawnResult> => ({
          status: 2, stdout: '', stderr: 'codex CLI fatal', killed: false,
        }),
        fsImpl: memfs,
      },
    });
    expect(r.ok).toBe(false);
    expect(r.finishReason).toBe('error');
  });
});

// ============================================================
// 4 retry matrix case (FR-014)
// ============================================================

describe('callBackend — retry matrix (FR-014)', () => {
  it('RM-1 transient → success：第一次 503，第二次 200，retried=1', async () => {
    process.env.SILICONFLOW_API_KEY = 'k';
    let calls = 0;
    const r = await callBackend({
      model: 'siliconflow:Pro/zai-org/GLM-5.1',
      prompt: 'x',
      deps: {
        openaiCreate: async (_req: unknown) => {
          calls++;
          if (calls === 1) {
            const err = new Error('upstream 503') as Error & { status: number };
            err.status = 503;
            throw err;
          }
          return makeOpenAiSuccess('ok', 50, 20);
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.retried).toBe(1);
    expect(calls).toBe(2);
  }, 10_000);

  it('RM-2 quota → fail：HTTP 429，0 retry', async () => {
    process.env.SILICONFLOW_API_KEY = 'k';
    let calls = 0;
    const r = await callBackend({
      model: 'siliconflow:Pro/zai-org/GLM-5.1',
      prompt: 'x',
      deps: {
        openaiCreate: async (_req: unknown) => {
          calls++;
          const err = new Error('rate_limit_exceeded: too many requests') as Error & { status: number };
          err.status = 429;
          throw err;
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('quota');
    expect(r.error?.retryable).toBe(false);
    expect(calls).toBe(1);
    expect(r.retried).toBe(0);
  });

  it('RM-3 truncation → fail：finishReason=length，partial=true', async () => {
    process.env.SILICONFLOW_API_KEY = 'k';
    const r = await callBackend({
      model: 'siliconflow:Pro/zai-org/GLM-5.1',
      prompt: 'x',
      deps: {
        openaiCreate: async (_req: unknown) =>
          makeOpenAiSuccess('{"diff":"--- a', 100, 100, 'length'),
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('truncated');
    expect(r.partial).toBe(true);
    expect(r.error?.retryable).toBe(false);
    expect(r.retried).toBe(0);
  });

  it('RM-4 schema-invalid → fail：JSON.parse 失败 → rawResponse 记录', async () => {
    // 用 claude-cli 路径触发：spawn 返回非 JSON stdout → handler 内部抛 parse error
    const r = await callBackend({
      model: 'claude-cli:claude-opus-4-7',
      prompt: 'x',
      deps: {
        spawnImpl: async (_cmd: string, _args: string[]): Promise<SpawnResult> => ({
          status: 0, stdout: 'not a json', stderr: '', killed: false,
        }),
      },
    });
    expect(r.ok).toBe(false);
    // claude-cli 的 JSON.parse fail → err.message 含 'json'，分类为 schema-invalid
    expect(r.error?.code).toBe('schema-invalid');
    expect(r.error?.retryable).toBe(false);
    expect(r.error?.rawResponse).toBeDefined();
    expect(r.retried).toBe(0);
  });
});

// ============================================================
// 辅助函数 sanity（不计入 12 case；防止辅助 fn regression）
// ============================================================

// ============================================================
// Phase A iter-2 新增：W-1 schema 完整性 + W-3 codex 鉴权预检
// ============================================================

describe('Phase A iter-2 — W-1 schema 完整性检查（success path fail-fast）', () => {
  it('W-1 success-path schema-invalid：text 是 JSON 但只含 rationale 缺内容字段 → schema-invalid + rawResponse 含原文', async () => {
    process.env.SILICONFLOW_API_KEY = 'k';
    let calls = 0;
    const r = await callBackend({
      model: 'siliconflow:Pro/zai-org/GLM-5.1',
      prompt: 'x',
      deps: {
        openaiCreate: async (_req: unknown) => {
          calls++;
          return makeOpenAiSuccess('{"rationale":"x"}', 30, 10, 'stop');
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('schema-invalid');
    expect(r.error?.retryable).toBe(false);
    expect(r.error?.rawResponse).toContain('rationale');
    // fail-fast：不 retry，calls 必须 === 1
    expect(calls).toBe(1);
    expect(r.retried).toBe(0);
  });
});

describe('Phase A iter-2 — W-3 codex CLI 鉴权预检', () => {
  it('W-3 codex 鉴权失败：precheck spawn 返回非 0 → 友好错误信息指引安装 + 登录 + 替代 backend', async () => {
    let precheckCalled = false;
    let mainCalled = false;
    const r = await callBackend({
      model: 'codex:gpt-5.5',
      prompt: 'x',
      deps: {
        tmpDir: '/tmp',
        spawnImpl: async (_cmd: string, args: string[]): Promise<SpawnResult> => {
          // 第一次 spawn 是 precheck（args=['--version']）
          if (args.length === 1 && args[0] === '--version') {
            precheckCalled = true;
            return { status: 127, stdout: '', stderr: 'command not found: codex', killed: false };
          }
          mainCalled = true;
          return { status: 0, stdout: '', stderr: '', killed: false };
        },
        fsImpl: makeMemFs({}),
      },
    });
    expect(precheckCalled).toBe(true);
    expect(mainCalled).toBe(false); // 鉴权失败时不应继续真实调用
    expect(r.ok).toBe(false);
    expect(r.finishReason).toBe('error');
    // 错误信息必须含友好指引（命中安装 + 登录 + SPECTRA_EVAL_EXECUTOR 至少一项）
    const message = r.error?.message ?? '';
    expect(message).toMatch(/codex CLI 未登录或未安装/);
    expect(message).toMatch(/codex login/);
    expect(message).toMatch(/SPECTRA_EVAL_EXECUTOR/);
  });

  it('W-3 codex 鉴权通过：precheck spawn 返回 0 → 继续走真实调用路径', async () => {
    const memfs = makeMemFs({});
    let precheckCalled = false;
    let mainCalled = false;
    const r = await callBackend({
      model: 'codex:gpt-5.5',
      prompt: 'x',
      deps: {
        tmpDir: '/tmp',
        spawnImpl: async (_cmd: string, args: string[]): Promise<SpawnResult> => {
          if (args.length === 1 && args[0] === '--version') {
            precheckCalled = true;
            return { status: 0, stdout: 'codex 1.0.0\n', stderr: '', killed: false };
          }
          mainCalled = true;
          // 模拟真实 codex exec 调用：写 tmpFile + stderr token 解析
          const tmpFileIdx = args.indexOf('--output-last-message') + 1;
          const realPath = args[tmpFileIdx];
          memfs._written[realPath] = 'codex content here';
          return { status: 0, stdout: '', stderr: 'tokens used\n5,000\n', killed: false };
        },
        fsImpl: memfs,
      },
    });
    expect(precheckCalled).toBe(true);
    expect(mainCalled).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('codex content here');
    expect(r.completionTokens).toBe(5000);
  });
});

describe('辅助函数 sanity', () => {
  it('normalizeModelId 5 关键 case', () => {
    expect(normalizeModelId('codex:gpt-5.5')).toBe('gpt-5.5');
    expect(normalizeModelId('Codex:GPT-5.5')).toBe('gpt-5.5');
    expect(normalizeModelId('siliconflow:Pro/zai-org/GLM-5.1')).toBe('glm-5.1');
    expect(normalizeModelId('claude-cli:claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(normalizeModelId('Pro/moonshotai/Kimi-K2.6')).toBe('kimi-k2.6');
  });

  it('classifyError + isRetryable', () => {
    expect(classifyError(null, 'length', '')).toBe('truncation');
    expect(isRetryable('truncation')).toBe(false);
    expect(isRetryable('transient')).toBe(true);
    expect(isRetryable('quota')).toBe(false);
    const err429 = Object.assign(new Error('quota_exceeded'), { status: 429 });
    expect(classifyError(err429, null, '')).toBe('quota');
    const err503 = Object.assign(new Error('bad gateway'), { status: 503 });
    expect(classifyError(err503, null, '')).toBe('transient');
  });

  it('MODEL_ALIASES 必须含 26+ entry', () => {
    expect(Object.keys(MODEL_ALIASES).length).toBeGreaterThanOrEqual(26);
  });
});
