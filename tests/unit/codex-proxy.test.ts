/**
 * codex-proxy 单元测试
 * 验证 Codex CLI 子进程管理和 JSONL 输出解析
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { callLLMviaCodex, getDefaultCodexCLIProxyConfig } from '../../src/auth/codex-proxy.js';
import {
  LLMRateLimitError,
  LLMResponseError,
  LLMTimeoutError,
  LLMUnavailableError,
} from '../../src/core/llm-client.js';

const mockedSpawn = vi.mocked(spawn);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);

function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const stdinChunks: string[] = [];
  child.stdin = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      stdinChunks.push(chunk.toString());
      callback();
    },
  });
  child._stdinChunks = stdinChunks;
  child.kill = vi.fn();

  return child;
}

describe('codex-proxy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue('');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it('正常调用 → 解析 JSONL 事件 → 返回 LLMResponse', async () => {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('这是 Codex 回复');

    const promise = callLLMviaCodex('测试 prompt', { model: 'gpt-5.3-codex' });

    mockChild.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"这是 Codex 回复"}}\n'));
    mockChild.stdout.emit('data', Buffer.from('{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}\n'));
    mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":false}\n'));
    mockChild.emit('close', 0);

    const result = await promise;

    expect(result.content).toBe('这是 Codex 回复');
    expect(result.model).toBe('gpt-5.3-codex');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('超时 → 抛出 LLMTimeoutError + kill 进程', async () => {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);

    const promise = callLLMviaCodex('timeout prompt', { timeout: 1000 });

    vi.advanceTimersByTime(1100);
    mockChild.emit('close', null);

    await expect(promise).rejects.toThrow(LLMTimeoutError);
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('Codex 返回限额错误时抛出 LLMRateLimitError', async () => {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);

    const promise = callLLMviaCodex('rate limit prompt');

    mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":true,"result":"You\\u2019re out of extra usage"}\n'));
    mockChild.emit('close', 1);

    await expect(promise).rejects.toThrow(LLMRateLimitError);
  });

  it('spawn 失败 → 抛出 LLMUnavailableError', async () => {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);

    const promise = callLLMviaCodex('spawn fail');
    mockChild.emit('error', new Error('spawn ENOENT'));

    await expect(promise).rejects.toThrow(LLMUnavailableError);
  });

  it('stdin 正确传入 prompt', async () => {
    vi.useRealTimers();

    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('ok');

    const testPrompt = '这是 Codex 测试 prompt';
    const promise = callLLMviaCodex(testPrompt);

    mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":false}\n'));
    mockChild.emit('close', 0);

    await promise;
    expect(mockChild._stdinChunks.join('')).toBe(testPrompt);

    vi.useFakeTimers();
  });

  it('spawn 参数正确包含 exec/json/model 和 Codex 配置覆盖', async () => {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('ok');

    const promise = callLLMviaCodex('test', {
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      serviceTier: 'fast',
    });

    mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":false}\n'));
    mockChild.emit('close', 0);

    await promise;

    const spawnCall = mockedSpawn.mock.calls[0]!;
    const args = spawnCall[1] as string[];
    expect(args).toContain('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5.4');
    expect(args).toContain('model_reasoning_effort="xhigh"');
    expect(args).toContain('service_tier="fast"');
  });

  it('非零退出码且无结构化限额错误时抛出 LLMResponseError', async () => {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);

    const promise = callLLMviaCodex('error prompt');

    mockChild.stderr.emit('data', Buffer.from('unexpected failure'));
    mockChild.emit('close', 1);

    await expect(promise).rejects.toThrow(LLMResponseError);
  });

  // Feature 238 Slice 4 — FR-304/306/307/309 modelFlagMode 决策矩阵端到端断言
  describe('modelFlagMode 决策矩阵端到端（FR-304/306/307/309）', () => {
    it('T4.4 model_compat.aliases.codex[tier] 命中 → spawn 的 --model 参数值精确等于该 alias 字面值', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(`
preset: cost-efficient
model_compat:
  aliases:
    codex:
      sonnet: gpt-5.6-sol
`);

      const promise = callLLMviaCodex('test', {});

      mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":false}\n'));
      mockChild.emit('close', 0);

      await promise;

      const spawnCall = mockedSpawn.mock.calls[0]!;
      const args = spawnCall[1] as string[];
      expect(args).toContain('--model');
      expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.6-sol');
    });

    it('T4.8 delegate 默认解析路径：spawn args 不含 --model，result.model 以 delegated: 开头', async () => {
      // beforeEach 默认 mockedExistsSync.mockReturnValue(false) → 找不到任何
      // spec-driver.config.yaml → resolveCodexModelDecision 落到 delegate 兜底分支
      const preCheck = getDefaultCodexCLIProxyConfig({ cwd: '/nonexistent-for-test', env: {} });
      expect(preCheck.modelFlagMode).toBe('delegate');
      expect(preCheck.model.startsWith('delegated:')).toBe(true);

      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCodex('delegate prompt', {});

      mockChild.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n'));
      mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":false}\n'));
      mockChild.emit('close', 0);

      const result = await promise;

      const spawnCall = mockedSpawn.mock.calls[0]!;
      const args = spawnCall[1] as string[];
      expect(args).not.toContain('--model');
      expect(result.model.startsWith('delegated:')).toBe(true);
    });

    it('T4.10 getDefaultCodexCLIProxyConfig delegate 场景端到端保守超时 === 300000（FR-307）', () => {
      const result = getDefaultCodexCLIProxyConfig({ cwd: '/nonexistent-for-test', env: {} });

      expect(result.modelFlagMode).toBe('delegate');
      expect(result.timeout).toBe(300_000);
    });

    // Codex implement 审查修复轮 C1 — proxy 判定去前缀化攻击用例：
    // 调用方（无论经由 env REVERSE_SPEC_MODEL 还是直接传参）显式传入一个带
    // `delegated:` 前缀的字面串，必须仍被当作 required 显式 pin 原样传给 CLI，
    // 而不是被旧实现的 `cfg.model.startsWith('delegated:')` 判定误吞掉 `--model` flag。
    it('C1 攻击用例：直接调用 callLLMviaCodex 且显式传入 model="delegated:x" → spawn args 含 --model delegated:x（不被当作 delegate 静默省略）', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue('ok');

      const promise = callLLMviaCodex('伪装 delegate 攻击', { model: 'delegated:x', timeout: 5000 });

      mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":false}\n'));
      mockChild.emit('close', 0);

      await promise;

      const spawnCall = mockedSpawn.mock.calls[0]!;
      const args = spawnCall[1] as string[];
      expect(args).toContain('--model');
      expect(args[args.indexOf('--model') + 1]).toBe('delegated:x');
    });
  });
});
