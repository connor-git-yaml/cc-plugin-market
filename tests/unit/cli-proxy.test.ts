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
import { existsSync } from 'node:fs';
import {
  callLLMviaCli,
  buildClaudeCliArgs,
  resolveHeadlessCwd,
  HEADLESS_ISOLATION_ARGS,
  findAncestorProjectMarkers,
  __resetHeadlessWarningsForTests,
} from '../../src/auth/cli-proxy.js';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

      // 模拟 stream-json 输出（旧顶层字段格式，向后兼容）
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

    // ============================================================
    // Feature 133 P0-1：token 提取从嵌套 usage 字段读取
    // ============================================================
    // 根因：Claude CLI 实际 stream-json 输出中 type=result message 把
    // input_tokens/output_tokens 嵌套在 usage.* 下，但旧代码当顶层字段读，
    // 导致所有 module spec frontmatter 的 tokenUsage 全为 0。
    // 这组 case 锁定修复后的行为，避免回归。

    it('Feature 133 P0-1：从嵌套 usage 字段提取 token（Claude CLI 当前实际格式）', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('test', { model: 'claude-sonnet-4-6' });

      // Claude CLI 真实输出格式：token 嵌套在 usage 下
      mockChild.stdout.emit('data', Buffer.from(
        '{"type":"result","subtype":"success","result":"reply","model":"claude-sonnet-4-6","usage":{"input_tokens":1500,"output_tokens":300,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}\n',
      ));
      mockChild.emit('close', 0);

      const result = await promise;

      expect(result.inputTokens).toBe(1500);
      expect(result.outputTokens).toBe(300);
      expect(result.content).toBe('reply');
    });

    it('Feature 133 P0-1：嵌套 usage 优先于顶层字段（防止格式混淆）', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('test');

      // 同时存在嵌套和顶层时，嵌套应优先（顶层是旧格式或 mock 残留）
      mockChild.stdout.emit('data', Buffer.from(
        '{"type":"result","result":"r","input_tokens":99,"output_tokens":99,"usage":{"input_tokens":2000,"output_tokens":500}}\n',
      ));
      mockChild.emit('close', 0);

      const result = await promise;

      expect(result.inputTokens).toBe(2000);
      expect(result.outputTokens).toBe(500);
    });

    it('Feature 133 P0-1：result 不含任何 token 字段时返回 0（不抛错）', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('test');

      mockChild.stdout.emit('data', Buffer.from(
        '{"type":"result","result":"reply"}\n',
      ));
      mockChild.emit('close', 0);

      const result = await promise;

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.content).toBe('reply');
    });

    // ============================================================
    // Fix 134：input 累加 cache_creation_input_tokens + cache_read_input_tokens
    // ============================================================
    // 根因：prompt caching 启用时，主输入会进 cache_read_input_tokens，
    // input_tokens 主字段只剩"非 cached"增量部分（5 模块累计 input=30 vs
    // output=35,759 异常）。修复：累加三个 input 子字段。

    it('Fix 134：累加 cache_creation_input_tokens + cache_read_input_tokens（prompt caching 真实场景）', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('test', { model: 'claude-sonnet-4-6' });

      // 真实 prompt caching 场景：input_tokens 是非 cached 增量，
      // 主输入大量进 cache_read_input_tokens
      mockChild.stdout.emit('data', Buffer.from(
        '{"type":"result","subtype":"success","result":"reply","model":"claude-sonnet-4-6","usage":{"input_tokens":100,"output_tokens":300,"cache_creation_input_tokens":200,"cache_read_input_tokens":1500}}\n',
      ));
      mockChild.emit('close', 0);

      const result = await promise;

      // 100 + 200 + 1500 = 1800
      expect(result.inputTokens).toBe(1800);
      expect(result.outputTokens).toBe(300);
    });

    it('Fix 134：仅有 cache_read_input_tokens 时仍累加（input_tokens 缺失）', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('test');

      mockChild.stdout.emit('data', Buffer.from(
        '{"type":"result","result":"r","usage":{"output_tokens":50,"cache_read_input_tokens":800}}\n',
      ));
      mockChild.emit('close', 0);

      const result = await promise;

      // 0 + 0 + 800 = 800（input_tokens 缺失，cache_creation 缺失，cache_read=800）
      expect(result.inputTokens).toBe(800);
      expect(result.outputTokens).toBe(50);
    });

    it('Fix 134：cache 子字段缺失时退化为 input_tokens 主字段（向后兼容）', async () => {
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLMviaCli('test');

      // 旧格式或无 prompt caching 场景：只有 input_tokens
      mockChild.stdout.emit('data', Buffer.from(
        '{"type":"result","result":"r","usage":{"input_tokens":2000,"output_tokens":500}}\n',
      ));
      mockChild.emit('close', 0);

      const result = await promise;

      // 2000 + 0 + 0 = 2000
      expect(result.inputTokens).toBe(2000);
      expect(result.outputTokens).toBe(500);
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

  // ============================================================
  // M11 卡 E：无头调用瘦身——一次只回「ok」的 claude --print 今天的 usage ≈ 67k input 侧 token
  // （工具 schema 31k + cwd 下 CLAUDE.md 28k + 设置/技能/会话 + Claude Code 人设系统提示），
  // 与 spectra 的 prompt 无关。SDK 路径只发 spectra 自己的 system prompt，CLI 路径必须对齐。
  // ============================================================
  describe('M11 卡 E：无头调用隔离', () => {
    it('buildClaudeCliArgs：--safe-mode 禁 CLAUDE.md / 技能 / 插件 / hooks / MCP，--tools 空压掉内建工具 schema，单轮、不存会话，并用 --system-prompt 传 spectra 的系统提示', () => {
      const args = buildClaudeCliArgs({ model: 'claude-sonnet-4-6', systemPrompt: '你是规范生成器' });
      expect(args.slice(0, 6)).toEqual(['--print', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-4-6']);
      for (const flag of HEADLESS_ISOLATION_ARGS) expect(args).toContain(flag);
      expect(args[args.indexOf('--max-turns') + 1]).toBe('1');
      expect(args).toContain('--safe-mode');
      expect(args[args.indexOf('--tools') + 1]).toBe('');
      expect(args).toContain('--no-session-persistence');
      expect(args).toContain('--disable-slash-commands');
      expect(args[args.indexOf('--system-prompt') + 1]).toBe('你是规范生成器');
      // 变参旗标（--tools）之后必须紧跟下一个旗标或结束，否则会吞掉后续参数
      const next = args[args.indexOf('--tools') + 2];
      expect(next === undefined || next.startsWith('--')).toBe(true);
    });

    it('buildClaudeCliArgs：未提供 systemPrompt 时不传 --system-prompt（沿用旧的整段拼接调用方式）', () => {
      const args = buildClaudeCliArgs({ model: 'claude-sonnet-4-6' });
      expect(args).not.toContain('--system-prompt');
      expect(args).toContain('--tools');
    });

    it('resolveHeadlessCwd：子进程 cwd 是仓库之外的专用空目录（存在、不含 CLAUDE.md、不等于进程 cwd）', () => {
      const cwd = resolveHeadlessCwd();
      expect(existsSync(cwd)).toBe(true);
      expect(cwd).not.toBe(process.cwd());
      expect(cwd.startsWith(process.cwd())).toBe(false);
      expect(existsSync(`${cwd}/CLAUDE.md`)).toBe(false);
      expect(resolveHeadlessCwd()).toBe(cwd);
    });

    it('spawn 使用隔离 args + 专用 cwd；systemPrompt 走 --system-prompt，stdin 只收用户内容', async () => {
      vi.useRealTimers();
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);
      const promise = callLLMviaCli('用户内容', { model: 'claude-sonnet-4-6', systemPrompt: '系统提示' });
      mockChild.stdout.emit('data', Buffer.from('{"type":"result","result":"ok","usage":{"input_tokens":10,"output_tokens":2}}\n'));
      mockChild.emit('close', 0);
      await promise;
      const [bin, args, options] = mockedSpawn.mock.calls[0]! as unknown as [string, string[], { cwd?: string }];
      expect(bin).toBe('claude');
      expect(args).toEqual(buildClaudeCliArgs({ model: 'claude-sonnet-4-6', systemPrompt: '系统提示' }));
      expect(options.cwd).toBe(resolveHeadlessCwd());
      expect(mockChild._stdinChunks.join('')).toBe('用户内容');
    });

    it('响应暴露 cacheCreationInputTokens / cacheReadInputTokens；inputTokens 仍是三项之和（向后兼容）', async () => {
      vi.useRealTimers();
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);
      const promise = callLLMviaCli('p', { model: 'claude-sonnet-4-6' });
      mockChild.stdout.emit('data', Buffer.from('{"type":"result","result":"ok","usage":{"input_tokens":3,"cache_creation_input_tokens":40747,"cache_read_input_tokens":26085,"output_tokens":4}}\n'));
      mockChild.emit('close', 0);
      const r = await promise;
      expect(r.inputTokens).toBe(3 + 40747 + 26085);
      expect(r.cacheCreationInputTokens).toBe(40747);
      expect(r.cacheReadInputTokens).toBe(26085);
    });

    it('旧版 CLI 不认识隔离旗标（exit 1 + unknown option）→ LLMResponseError 指名旗标并提示升级 Claude Code，不静默退回', async () => {
      vi.useRealTimers();
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);
      const promise = callLLMviaCli('p', { model: 'claude-sonnet-4-6' });
      mockChild.stderr.emit('data', Buffer.from("error: unknown option '--disable-slash-commands'\n"));
      mockChild.emit('close', 1);
      await expect(promise).rejects.toThrow(LLMResponseError);
      await expect(promise).rejects.toThrow(/--disable-slash-commands/);
      await expect(promise).rejects.toThrow(/升级 Claude Code/);
    });

    it('旧顶层字段格式没有 cache 子字段时，cache 字段为 0 而不是 undefined', async () => {
      vi.useRealTimers();
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);
      const promise = callLLMviaCli('p', { model: 'claude-sonnet-4-6' });
      mockChild.stdout.emit('data', Buffer.from('{"type":"result","result":"ok","input_tokens":100,"output_tokens":50}\n'));
      mockChild.emit('close', 0);
      const r = await promise;
      expect(r.cacheCreationInputTokens).toBe(0);
      expect(r.cacheReadInputTokens).toBe(0);
    });
  });
});

// ============================================================
// M11 卡 E 对抗审查回补（2026-09-15）：stream-json 错误形态 / 隔离失效可见 / cwd 自愈 / 认证设置透传 / 成本真值
// ============================================================

describe('cli-proxy · M11 卡 E 对抗审查回补', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    __resetHeadlessWarningsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function runWith(lines: string[], exitCode: number, stderr = ''): Promise<any> {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);
    const promise = callLLMviaCli('用户内容', { model: 'claude-sonnet-4-6', systemPrompt: 'SYS' });
    mockChild.stdout.emit('data', Buffer.from(lines.join('\n') + '\n'));
    if (stderr) mockChild.stderr.emit('data', Buffer.from(stderr));
    mockChild.emit('close', exitCode);
    return promise;
  }

  it('C-2：exit 1 + stderr 为空 + result.subtype=error_max_turns / is_error=true（无 result 字段）→ LLMResponseError 指名 subtype，不把「[object Object]」当正文', async () => {
    await expect(runWith([
      '{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"partial"}]}}',
      '{"type":"result","subtype":"error_max_turns","is_error":true,"usage":{"input_tokens":10,"output_tokens":5}}',
    ], 1)).rejects.toThrow(/error_max_turns/);
  });

  it('C-2：exit 0 但 result.is_error=true（error_during_execution：过载 / OAuth 过期）→ 拒绝，不产出空壳 spec', async () => {
    await expect(runWith([
      '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"","usage":{"input_tokens":10,"output_tokens":0}}',
    ], 0)).rejects.toThrow(/error_during_execution/);
  });

  it('C-2：exit 1 + stderr 完全为空 → 不再被「纯 WARN」豁免（空 stderr 不是 WARN）', async () => {
    await expect(runWith([
      '{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":10,"output_tokens":1}}',
    ], 1)).rejects.toThrow(/exit 1/);
  });

  it('C-2：stderr 只有 [WARN] 行时仍豁免（Agent SDK 环境的 Fast mode 警告）', async () => {
    const r = await runWith([
      '{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":10,"output_tokens":1}}',
    ], 1, '[WARN] fast mode unavailable\n');
    expect(r.content).toBe('ok');
  });

  it('C-2：assistant.message 是对象时从 content[].text 取文本，而不是字符串拼接', async () => {
    const r = await runWith([
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"第一段"},{"type":"text","text":"第二段"}]}}',
      '{"type":"result","subtype":"success","usage":{"input_tokens":10,"output_tokens":1}}',
    ], 0);
    expect(r.content).toBe('第一段第二段');
  });

  it('C-2：stream-json 已解析出 JSON 行但没有任何正文 → 报「输出为空」，不把整段 JSON 原文当 spec 正文', async () => {
    await expect(runWith([
      '{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}',
      '{"type":"result","subtype":"success","result":"","usage":{"input_tokens":10,"output_tokens":0}}',
    ], 0)).rejects.toThrow(/输出为空/);
  });

  it('C-1：result.total_cost_usd 透出为 reportedCostUsd（Claude Code 自报、已含正确的缓存定价）；缺席时为 undefined', async () => {
    const withCost = await runWith([
      '{"type":"result","subtype":"success","result":"ok","total_cost_usd":0.234517,"usage":{"input_tokens":10,"output_tokens":1}}',
    ], 0);
    expect(withCost.reportedCostUsd).toBe(0.234517);
    const without = await runWith([
      '{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":10,"output_tokens":1}}',
    ], 0);
    expect(without.reportedCostUsd).toBeUndefined();
  });

  it('W-10：system/init 自报 tools / mcp_servers 非空（隔离旗标没生效）→ console.warn 一次，调用照常返回', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runWith([
      '{"type":"system","subtype":"init","tools":["Bash","Read"],"mcp_servers":[{"name":"x","status":"connected"}]}',
      '{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":10,"output_tokens":1}}',
    ], 0);
    expect(r.content).toBe('ok');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/隔离/);
  });

  it('W-4：resolveHeadlessCwd 不缓存已删除的目录——目录被系统清理后再次调用会重建', () => {
    const first = resolveHeadlessCwd();
    rmSync(first, { recursive: true, force: true });
    expect(existsSync(first)).toBe(false);
    const again = resolveHeadlessCwd();
    expect(again).toBe(first);
    expect(existsSync(again)).toBe(true);
  });

  it('W-9：findAncestorProjectMarkers 在祖先链上发现 CLAUDE.md / .claude 时返回该目录（TMPDIR 落在某仓库内时 cwd 隔离会静默失效）', () => {
    const root = mkdtempSync(join(tmpdir(), 'headless-leak-'));
    const nested = join(root, 'repo', 'deep', 'tmp');
    mkdirSync(nested, { recursive: true });
    expect(findAncestorProjectMarkers(nested)).toBeNull();
    writeFileSync(join(root, 'repo', 'CLAUDE.md'), '# rules\n');
    expect(findAncestorProjectMarkers(nested)).toBe(join(root, 'repo'));
    rmSync(join(root, 'repo', 'CLAUDE.md'));
    mkdirSync(join(root, 'repo', '.claude'));
    expect(findAncestorProjectMarkers(nested)).toBe(join(root, 'repo'));
    rmSync(root, { recursive: true, force: true });
  });

  it('C-Δ3：隔离用 --safe-mode（Claude Code 自己读认证设置，凭据不上 argv）；argv 不得出现 --settings / --setting-sources / --mcp-config', () => {
    const args = buildClaudeCliArgs({ model: 'm', systemPrompt: 'S' });
    expect(args).toContain('--safe-mode');
    for (const forbidden of ['--settings', '--setting-sources', '--mcp-config', '--strict-mcp-config']) {
      expect(args, forbidden).not.toContain(forbidden);
    }
    // --tools '' 是变参旗标：其后只能紧跟另一个旗标（--system-prompt）或结束，否则吞掉后续参数
    const toolsIdx = args.indexOf('--tools');
    expect(args[toolsIdx + 1]).toBe('');
    expect(args[toolsIdx + 2] === undefined || args[toolsIdx + 2]!.startsWith('--')).toBe(true);
  });

  it('C-Δ3：argv 里没有任何取自设置文件的值（没有 apiKeyHelper / env / ANTHROPIC 字样）', async () => {
    const mockChild = createMockChild();
    mockedSpawn.mockReturnValue(mockChild);
    const promise = callLLMviaCli('用户内容', { model: 'claude-sonnet-4-6', systemPrompt: 'SYS' });
    mockChild.stdout.emit('data', Buffer.from('{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":1,"output_tokens":1}}\n'));
    mockChild.emit('close', 0);
    await promise;
    const argv = (mockedSpawn.mock.calls[0]![1] as string[]).join(' ');
    expect(argv).not.toMatch(/apiKeyHelper|ANTHROPIC|"env"/);
  });

  it('W-Δ2：错误判定的两半各自承重——{subtype:success,is_error:true} 与 {subtype:error_max_turns}（无 is_error）都拒绝', async () => {
    await expect(runWith(['{"type":"result","subtype":"success","is_error":true,"result":"x","usage":{"input_tokens":1,"output_tokens":1}}'], 0)).rejects.toThrow(/subtype=success/);
    await expect(runWith(['{"type":"result","subtype":"error_max_turns","usage":{"input_tokens":1,"output_tokens":1}}'], 0)).rejects.toThrow(/error_max_turns/);
    // subtype 只要不是 success 就是失败（不是只认 "error"）
    await expect(runWith(['{"type":"result","subtype":"error_during_execution","usage":{"input_tokens":1,"output_tokens":1}}'], 0)).rejects.toThrow(/error_during_execution/);
  });

  it('W-Δ2：[WARN] 豁免还要求 stdout 非空——stderr 全 WARN 但 stdout 为空时仍按错误拒绝', async () => {
    await expect(runWith([], 1, '[WARN] fast mode unavailable\n')).rejects.toThrow(/exit 1/);
  });

  it('W-Δ8：error_during_execution（过载 / 网络）带 statusCode 503，让 llm-client 视为可重试；error_max_turns 不带', async () => {
    const overloaded = await runWith(['{"type":"result","subtype":"error_during_execution","is_error":true,"usage":{"input_tokens":1,"output_tokens":0}}'], 1).catch((e) => e);
    expect(overloaded).toBeInstanceOf(LLMResponseError);
    expect((overloaded as LLMResponseError).statusCode).toBe(503);
    // 非重试类错误沿用退出码（exit 1 ⇒ statusCode 1），绝不冒充 5xx
    const maxTurns = await runWith(['{"type":"result","subtype":"error_max_turns","is_error":true,"usage":{"input_tokens":1,"output_tokens":0}}'], 1).catch((e) => e);
    expect((maxTurns as LLMResponseError).statusCode).toBe(1);
  });

  it('W-Δ10：once 标记有测试复位钩子——复位后第二次触发仍会 console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const init = '{"type":"system","subtype":"init","tools":["Bash"],"mcp_servers":[]}';
    const ok = '{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":1,"output_tokens":1}}';
    __resetHeadlessWarningsForTests();
    await runWith([init, ok], 0);
    __resetHeadlessWarningsForTests();
    await runWith([init, ok], 0);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
