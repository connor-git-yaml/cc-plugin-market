/**
 * Feature 166 — parseClaudeStreamJson 单测
 *
 * 验证 claude CLI stream-json 输出（NDJSON）的解析：
 * - events 数组按顺序聚合所有合法 JSON 行
 * - reasoningTrace 拼接 type:'assistant' 的 text/thinking blocks
 * - 排除 tool_use / redacted_thinking blocks
 * - malformedLineCount / totalLineCount 计数
 * - 容错处理：空字符串、malformed JSON、partial line、超大输出
 *
 * 覆盖 spec.md FR-010 (a)-(m) 13 个测试场景。
 */

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

interface ParsedClaudeStream {
  events: Array<Record<string, unknown>>;
  reasoningTrace: string;
  malformedLineCount: number;
  totalLineCount: number;
}

let parseClaudeStreamJson: (stdout: string) => ParsedClaudeStream;

async function loadParser(): Promise<void> {
  const mod = await import(pathToFileURL(resolve('scripts/lib/parse-claude-stream-json.mjs')).href);
  parseClaudeStreamJson = mod.parseClaudeStreamJson;
}

describe('parseClaudeStreamJson (Feature 166 FR-010)', () => {
  it('(a) 单条 type=assistant 含 text block → events.length=1 且 reasoningTrace 含 text', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello world' }] },
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    expect(r.events[0].type).toBe('assistant');
    expect(r.reasoningTrace).toBe('hello world');
    expect(r.malformedLineCount).toBe(0);
    expect(r.totalLineCount).toBe(1);
  });

  it('(b) 单条 type=user content array → events.length=1 且 reasoningTrace 为空（user 不计入 trace）', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'abc', content: 'result-data' }],
      },
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    expect(r.events[0].type).toBe('user');
    expect(r.reasoningTrace).toBe('');
  });

  it('(c) type=assistant 含 tool_use block → events 含该 block，reasoningTrace 不含 tool_use input 字面值', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'I will call a tool' },
          { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/secret/path.ts' } },
        ],
      },
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    expect(r.reasoningTrace).toBe('I will call a tool');
    expect(r.reasoningTrace).not.toContain('/secret/path.ts');
    expect(r.reasoningTrace).not.toContain('tool_use');
  });

  it('(d) type=user 含 tool_result block → events 完整保留（caller 可 filter）', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'File content here' }],
      },
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    const content = (r.events[0].message as { content: Array<Record<string, unknown>> }).content;
    expect(content[0].type).toBe('tool_result');
    expect(content[0].tool_use_id).toBe('tu1');
  });

  it('(e) malformed JSON line → malformedLineCount=1, totalLineCount=1, events.length=0', async () => {
    await loadParser();
    const stdout = '{abc not json';
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(0);
    expect(r.malformedLineCount).toBe(1);
    expect(r.totalLineCount).toBe(1);
  });

  it('(f) 空字符串输入 → 返回空结构', async () => {
    await loadParser();
    const r = parseClaudeStreamJson('');
    expect(r.events).toEqual([]);
    expect(r.reasoningTrace).toBe('');
    expect(r.malformedLineCount).toBe(0);
    expect(r.totalLineCount).toBe(0);
  });

  it('(g) 仅 type=system init event → events.length=1, reasoningTrace 为空', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc123',
      tools: ['Read', 'Edit'],
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    expect(r.events[0].type).toBe('system');
    expect(r.reasoningTrace).toBe('');
  });

  it('(h) 多个 assistant + 多个 text block → reasoningTrace 按事件顺序 + \\n 拼接', async () => {
    await loadParser();
    const stdout = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'first thought' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'second thought' },
            { type: 'text', text: 'third thought' },
          ],
        },
      }),
    ].join('\n');
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(2);
    expect(r.reasoningTrace).toBe('first thought\nsecond thought\nthird thought');
  });

  it('(i) tool_use input 内容不进 reasoningTrace（防混入工具调用参数）', async () => {
    await loadParser();
    const sensitiveSymbol = 'super_secret_function_name_xyz';
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'analysis text' },
          { type: 'tool_use', id: 'tu1', name: 'mcp__spectra__context', input: { symbolId: sensitiveSymbol } },
        ],
      },
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.reasoningTrace).toBe('analysis text');
    expect(r.reasoningTrace).not.toContain(sensitiveSymbol);
  });

  it('(j) end-to-end 复合 fixture（system+assistant×2+user+result）→ events.length=5', async () => {
    await loadParser();
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'reasoning step 1' }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'final answer' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.456, duration_ms: 12345 }),
    ];
    const stdout = lines.join('\n');
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(5);
    expect(r.events.map((e) => e.type)).toEqual(['system', 'assistant', 'user', 'assistant', 'result']);
    expect(r.reasoningTrace).toBe('reasoning step 1\nfinal answer');
    expect(r.totalLineCount).toBe(5);
    expect(r.malformedLineCount).toBe(0);
  });

  it('(k) redacted_thinking block 保留在 events，但不进 reasoningTrace', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'redacted_thinking', data: 'encrypted-payload-base64' },
          { type: 'text', text: 'visible answer' },
        ],
      },
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    const content = (r.events[0].message as { content: Array<Record<string, unknown>> }).content;
    expect(content[0].type).toBe('redacted_thinking'); // 保留在 events
    expect(r.reasoningTrace).toBe('visible answer'); // 但 trace 仅含 text
    expect(r.reasoningTrace).not.toContain('encrypted-payload-base64');
  });

  it('(l) partial last line（无换行结尾 + malformed）→ 最后一行计 malformed，前面行正常', async () => {
    await loadParser();
    const goodLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'complete' }] },
    });
    const stdout = goodLine + '\n' + '{"type":"asst'; // 最后一行 partial（缺尾部）
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    expect(r.reasoningTrace).toBe('complete');
    expect(r.malformedLineCount).toBe(1);
    expect(r.totalLineCount).toBe(2);
  });

  it('(m) 大输出（1000 lines mock）→ 流式按行解析无 OOM，events.length=1000', async () => {
    await loadParser();
    const lines: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      lines.push(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: `line-${i}` }] },
        }),
      );
    }
    const stdout = lines.join('\n');
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1000);
    expect(r.totalLineCount).toBe(1000);
    expect(r.malformedLineCount).toBe(0);
    expect(r.reasoningTrace.split('\n').length).toBe(1000);
  });

  it('(thinking block) type:thinking 含 thinking 字段 → 进入 reasoningTrace', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'I should check the code first', signature: 'abc' },
          { type: 'text', text: 'visible answer' },
        ],
      },
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.reasoningTrace).toContain('I should check the code first');
    expect(r.reasoningTrace).toContain('visible answer');
  });

  it('(空行处理) 空行计入 totalLineCount 但不计入 malformed（FR-008 spec 对齐）', async () => {
    await loadParser();
    const stdout = '\n\n' + JSON.stringify({ type: 'result', subtype: 'success' }) + '\n\n';
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    expect(r.totalLineCount).toBe(5); // 5 split items: ['', '', '{...}', '', '']
    expect(r.malformedLineCount).toBe(0);
  });

  it('(size guard) 超 50MB stdout 截断 + truncated=true + originalLength 保留', async () => {
    await loadParser();
    // 构造 51 MB stdout：51 个 1MB chunk
    const bigLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'x'.repeat(1024 * 1024 - 100) }] },
    });
    // 重复 51 次（每行 ~1MB）
    const lines: string[] = [];
    for (let i = 0; i < 51; i += 1) lines.push(bigLine);
    const stdout = lines.join('\n');
    expect(stdout.length).toBeGreaterThan(50 * 1024 * 1024);
    const r = parseClaudeStreamJson(stdout);
    expect(r.truncated).toBe(true);
    expect(r.originalLength).toBe(stdout.length);
    // 截断到 50MB 应只处理一部分行（少于 51）
    expect(r.events.length).toBeLessThan(51);
    expect(r.events.length).toBeGreaterThan(0);
  });

  it('(短输入 truncated=false) 小 stdout 不触发截断', async () => {
    await loadParser();
    const stdout = JSON.stringify({ type: 'result', subtype: 'success' });
    const r = parseClaudeStreamJson(stdout);
    expect(r.truncated).toBe(false);
    expect(r.originalLength).toBe(stdout.length);
  });

  it('(非 string 输入容错) 传入 null / undefined / number → 返回空结构', async () => {
    await loadParser();
    const r1 = parseClaudeStreamJson(null as unknown as string);
    expect(r1.events).toEqual([]);
    expect(r1.totalLineCount).toBe(0);

    const r2 = parseClaudeStreamJson(undefined as unknown as string);
    expect(r2.events).toEqual([]);

    const r3 = parseClaudeStreamJson(123 as unknown as string);
    expect(r3.events).toEqual([]);
  });

  // Feature 167 T-003a: tail result 补救测试
  it('(truncated + result in tail) 截断时 result event 仅在尾部 → events 末位保留', async () => {
    await loadParser();
    // 构造 > 50MB stdout：51 个 ~1MB assistant 行 + 1 个 result 行（在末尾，超出 50MB 截断点）
    const bigLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'x'.repeat(1024 * 1024 - 100) }] },
    });
    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 1.23,
    });
    const lines: string[] = [];
    for (let i = 0; i < 51; i += 1) lines.push(bigLine);
    lines.push(resultLine);
    const stdout = lines.join('\n');
    expect(stdout.length).toBeGreaterThan(50 * 1024 * 1024);
    const r = parseClaudeStreamJson(stdout);
    expect(r.truncated).toBe(true);
    // tail scan 应找到 result event 并 push 到末位
    const lastEvent = r.events[r.events.length - 1];
    expect(lastEvent?.type).toBe('result');
    expect(lastEvent?.total_cost_usd).toBe(1.23);
    expect(lastEvent?.is_error).toBe(false);
  });

  it('(is_error result event) is_error=true result → 仍保留在 events（parser 不过滤语义）', async () => {
    await loadParser();
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      total_cost_usd: 0,
    });
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1);
    expect(r.events[0].is_error).toBe(true);
    expect(r.events[0].total_cost_usd).toBe(0);
  });

  it('(合法 JSON 但非 event object) 例如纯数字、纯字符串、缺 type 字段 → 计 malformed', async () => {
    await loadParser();
    const stdout = ['123', '"just a string"', '{"foo":"bar"}', '{"type":"assistant","message":{"content":[{"type":"text","text":"good"}]}}'].join('\n');
    const r = parseClaudeStreamJson(stdout);
    expect(r.events.length).toBe(1); // 仅最后一行合法 event
    expect(r.malformedLineCount).toBe(3); // 前三行不是 event object
    expect(r.totalLineCount).toBe(4);
    expect(r.reasoningTrace).toBe('good');
  });
});
