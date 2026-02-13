/**
 * cli-proxy 单元测试
 * 验证 Claude CLI 子进程管理和输出解析
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { callLLMviaCli } from '../../src/auth/cli-proxy.js';
import {
  LLMTimeoutError,
  LLMResponseError,
  LLMUnavailableError,
} from '../../src/core/llm-client.js';

const mockedSpawn = vi.mocked(spawn);

/** 创建 mock 子进程 */
function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  // 创建可写的 stdin
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

describe('cli-proxy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  describe('callLLMviaCli', () => {
    it('正常调用 → 解析 stream-json → 返回 LLMResponse', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('测试 prompt', { model: 'claude-sonnet-4-5-20250929' });

      // 模拟 stream-json 输出
      mockChild.stdout.emit('data', Buffer.from(
        '{"type":"result","result":"这是 LLM 回复","model":"claude-sonnet-4-5-20250929","input_tokens":100,"output_tokens":50}\n',
      ));
      mockChild.emit('close', 0);

      const result = await promise;

      expect(result.content).toBe('这是 LLM 回复');
      expect(result.model).toBe('claude-sonnet-4-5-20250929');
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('超时 → 抛出 LLMTimeoutError + kill 进程', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('timeout prompt', { timeout: 1000 });

      // 推进时间触发超时
      vi.advanceTimersByTime(1100);

      // 模拟 kill 后进程退出
      mockChild.emit('close', null);

      await expect(promise).rejects.toThrow(LLMTimeoutError);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('非零退出码 → 抛出 LLMResponseError', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('error prompt');

      mockChild.stderr.emit('data', Buffer.from('authentication failed'));
      mockChild.emit('close', 1);

      await expect(promise).rejects.toThrow(LLMResponseError);
      await expect(promise).rejects.toThrow(/authentication failed/);
    });

    it('spawn 失败 → 抛出 LLMUnavailableError', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('fail prompt');

      // 模拟 spawn 错误事件
      mockChild.emit('error', new Error('spawn ENOENT'));

      await expect(promise).rejects.toThrow(LLMUnavailableError);
    });

    it('子进程环境不包含 ANTHROPIC_API_KEY', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-should-be-removed';
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('env test');

      mockChild.stdout.emit('data', Buffer.from('{"type":"result","result":"ok"}\n'));
      mockChild.emit('close', 0);

      await promise;

      // 验证 spawn 的环境变量
      const spawnCall = mockedSpawn.mock.calls[0]!;
      const spawnOptions = spawnCall[2] as { env?: Record<string, string> };
      expect(spawnOptions.env).toBeDefined();
      expect(spawnOptions.env!['ANTHROPIC_API_KEY']).toBeUndefined();
    });

    it('stdin 正确传入 prompt', async () => {
      vi.useRealTimers(); // 此测试不需要 fake timers

      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const testPrompt = '这是一个测试 prompt，包含中文内容';
      const promise = callLLMviaCli(testPrompt);

      // stdin.write 在 Writable mock 中同步完成，直接发送响应
      mockChild.stdout.emit('data', Buffer.from('{"type":"result","result":"reply"}\n'));
      mockChild.emit('close', 0);

      await promise;

      // 验证 stdin 收到了正确的 prompt
      expect(mockChild._stdinChunks.join('')).toBe(testPrompt);

      vi.useFakeTimers(); // 恢复 fake timers
    });

    it('spawn 参数正确传递 model', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('test', { model: 'claude-opus-4-6' });

      mockChild.stdout.emit('data', Buffer.from('{"type":"result","result":"ok"}\n'));
      mockChild.emit('close', 0);

      await promise;

      const spawnCall = mockedSpawn.mock.calls[0]!;
      const args = spawnCall[1] as string[];
      expect(args).toContain('--print');
      expect(args).toContain('--verbose');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--model');
      expect(args).toContain('claude-opus-4-6');
    });
  });
});
