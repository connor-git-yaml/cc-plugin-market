import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
// @ts-expect-error — .mjs 无类型声明，运行时可解析
import { runCensus } from '../../scripts/adoption-census.mjs';

// 全部用临时目录 fixture，绝不读真实 ~/.claude 或 ~/.codex，也不写任何仓内路径。
let root: string;
let claudeDir: string;
let codexDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adoption-census-'));
  claudeDir = join(root, 'claude-projects');
  codexDir = join(root, 'codex-sessions');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeJsonl(dir: string, name: string, records: unknown[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

function claudeToolUse(name: string, id: string) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name }] } };
}

// .mjs 侧无类型声明，这里给出测试所需的最小结构描述（避免 any——见 .claude/rules/tests.md）。
interface ToolCount {
  name: string;
  callCount: number;
}
interface UnknownEntry extends ToolCount {
  nameSanitized: boolean;
}
interface CensusResult {
  generatedAt: string;
  sourceDirs: string[];
  sourceStatus: 'found' | 'not-found' | 'empty';
  tools: ToolCount[];
  zeroCallTools: string[];
  unknownCallCount: number;
  unknownToolCount: number;
  unknownServerCount: number;
  // 默认（非 verbose）恒为 null：unknown 桶里的名字来自全机第三方 transcript（W-4）
  unknownDetail: UnknownEntry[] | null;
  scanned: {
    claudeFiles: number;
    codexFiles: number;
    unparsableLines: number;
    unreadableFiles: number;
  };
}

const census = (options: {
  claudeDir: string;
  codexDir: string;
  verbose?: boolean;
}): Promise<CensusResult> => runCensus(options) as Promise<CensusResult>;

/** verbose 下的逐名清单；非 verbose 时为 null，用例里直接断言 null 而不是走这个 helper */
function detailOf(result: CensusResult): UnknownEntry[] {
  if (result.unknownDetail === null) throw new Error('本用例需要 verbose 输出');
  return result.unknownDetail;
}

function toolCount(result: CensusResult, name: string): number | undefined {
  return result.tools.find((t) => t.name === name)?.callCount;
}

describe('adoption-census', () => {
  describe('空目录 / 缺失目录边界', () => {
    it('两个数据源目录都存在但为空 → sourceStatus=empty，不抛异常', async () => {
      mkdirSync(claudeDir, { recursive: true });
      mkdirSync(codexDir, { recursive: true });

      const result = await census({ claudeDir, codexDir });

      expect(result.sourceStatus).toBe('empty');
      expect(result.tools).toHaveLength(18); // 17 已知工具 + unknown 桶
      expect(result.zeroCallTools).toHaveLength(17);
      expect(result.scanned.claudeFiles).toBe(0);
      expect(result.scanned.codexFiles).toBe(0);
    });

    it('两个数据源目录都不存在 → sourceStatus=not-found，不抛异常', async () => {
      const result = await census({
        claudeDir: join(root, 'nope-claude'),
        codexDir: join(root, 'nope-codex'),
      });
      expect(result.sourceStatus).toBe('not-found');
      expect(result.zeroCallTools).toHaveLength(17);
    });

    it('目录存在但只有非 .jsonl 文件 → 仍是 empty', async () => {
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'notes.txt'), 'hello', 'utf-8');
      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      expect(result.sourceStatus).toBe('empty');
    });
  });

  describe('未知工具名归入 unknown 桶而非丢弃', () => {
    it('伪造的 mcp__unknown_tool_x__foo 进 unknown 桶，不崩溃、不误计进已知工具', async () => {
      writeJsonl(claudeDir, 'session.jsonl', [
        claudeToolUse('mcp__unknown_tool_x__foo', 'tu-unknown-1'),
        claudeToolUse('mcp__plugin_spectra_spectra__impact', 'tu-impact-1'),
        // 非 mcp__ 的内置工具不参与统计
        claudeToolUse('Bash', 'tu-bash-1'),
      ]);

      const result = await census({ claudeDir, codexDir: join(root, 'nope'), verbose: true });

      expect(result.sourceStatus).toBe('found');
      expect(toolCount(result, 'unknown')).toBe(1);
      expect(toolCount(result, 'impact')).toBe(1);
      expect(detailOf(result)).toContainEqual({
        name: 'mcp__unknown_tool_x__foo',
        callCount: 1,
        nameSanitized: false,
      });
      // Bash 不是 mcp__ 前缀，既不入已知桶也不入 unknown 桶
      expect(detailOf(result).some((t) => t.name === 'Bash')).toBe(false);
    });

    it('spectra 命名空间下的未知短名单独可见，不静默并入 unknown 名单', async () => {
      writeJsonl(claudeDir, 'session.jsonl', [
        claudeToolUse('mcp__plugin_spectra_spectra__server_build_info', 'tu-sbi-1'),
      ]);
      const result = await census({ claudeDir, codexDir: join(root, 'nope'), verbose: true });
      expect(toolCount(result, 'unknown')).toBe(1);
      // I-2：保留 transcript 原始全名 —— 漂移证据就在前缀上，归一化掉等于把它擦了
      expect(detailOf(result)).toContainEqual({
        name: 'mcp__plugin_spectra_spectra__server_build_info',
        callCount: 1,
        nameSanitized: false,
      });
    });
  });

  describe('两种命名空间前缀都要认', () => {
    it('mcp__spectra__* 与 mcp__plugin_spectra_spectra__* 聚合到同一个短名桶', async () => {
      writeJsonl(claudeDir, 'a.jsonl', [
        claudeToolUse('mcp__spectra__context', 'tu-1'),
        claudeToolUse('mcp__plugin_spectra_spectra__context', 'tu-2'),
      ]);
      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      expect(toolCount(result, 'context')).toBe(2);
      expect(result.zeroCallTools).not.toContain('context');
    });
  });

  describe('Codex 侧 schema（实测确认的两条路径）', () => {
    it('event_msg / mcp_tool_call_end 的 invocation.{server,tool} 被重组为扁平名', async () => {
      writeJsonl(codexDir, 'rollout.jsonl', [
        {
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_end',
            call_id: 'exec-1',
            invocation: { server: 'plugin_spectra_spectra', tool: 'impact' },
          },
        },
        {
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_end',
            call_id: 'exec-2',
            invocation: { server: 'playwright', tool: 'browser_click' },
          },
        },
      ]);
      const result = await census({ claudeDir: join(root, 'nope'), codexDir, verbose: true });
      expect(toolCount(result, 'impact')).toBe(1);
      expect(detailOf(result)).toContainEqual({
        name: 'mcp__playwright__browser_click',
        callCount: 1,
        nameSanitized: false,
      });
    });

    it('response_item / function_call 的扁平 name 被识别', async () => {
      writeJsonl(codexDir, 'rollout.jsonl', [
        {
          type: 'response_item',
          payload: { type: 'function_call', call_id: 'fc-1', name: 'mcp__spectra__graph_query' },
        },
      ]);
      const result = await census({ claudeDir: join(root, 'nope'), codexDir });
      expect(toolCount(result, 'graph_query')).toBe(1);
    });

    it('只认 mcp_tool_call_end，不认 _begin（避免一次调用计两次）', async () => {
      writeJsonl(codexDir, 'rollout.jsonl', [
        {
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_begin',
            call_id: 'exec-1',
            invocation: { server: 'spectra', tool: 'impact' },
          },
        },
        {
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_end',
            call_id: 'exec-1',
            invocation: { server: 'spectra', tool: 'impact' },
          },
        },
      ]);
      const result = await census({ claudeDir: join(root, 'nope'), codexDir });
      expect(toolCount(result, 'impact')).toBe(1);
    });
  });

  describe('防御性解析：schema 猜错的代价是漏统计而非崩溃', () => {
    it('半截 JSON / 空行 / 结构不符的行被跳过并计数，不抛异常', async () => {
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        join(claudeDir, 'broken.jsonl'),
        [
          '{"type":"assistant","message":{"content":[{"type":"tool_use"', // 半截
          '',
          'not json at all',
          JSON.stringify({ type: 'assistant', message: { content: 'a string, not an array' } }),
          JSON.stringify({ type: 'assistant', message: null }),
          JSON.stringify(claudeToolUse('mcp__spectra__detect_changes', 'tu-ok')),
        ].join('\n') + '\n',
        'utf-8',
      );

      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      expect(toolCount(result, 'detect_changes')).toBe(1);
      expect(result.scanned.unparsableLines).toBe(2); // 半截 + not json（空行不计）
    });

    it('JSON 字符串内含裸 U+2028 / U+2029 时该行仍被正确解析（不用 readline 的原因）', async () => {
      // node:readline 会把 U+2028 / U+2029 当行终止符，但它们在 JSON 字符串里是合法裸字符。
      // 本机真实 transcript 实测命中过这个形态：readline 会把一条完整记录从中间劈开，
      // 两半都 JSON.parse 失败，整条调用被静默丢弃。本用例锁死"只按 \n 切"的行为。
      const withSeparators = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu-sep',
              name: 'mcp__plugin_spectra_spectra__view_file',
              input: { snippet: `line1\u2028line2\u2029line3` },
            },
          ],
        },
      };
      mkdirSync(claudeDir, { recursive: true });
      // 刻意不经 JSON.stringify 的转义：把裸码位直接写进文件，复现真实形态。
      const raw = JSON.stringify(withSeparators)
        .replace('\\u2028', '\u2028')
        .replace('\\u2029', '\u2029');
      expect(raw).toContain('\u2028');
      expect(raw).toContain('\u2029');
      writeFileSync(join(claudeDir, 'sep.jsonl'), raw + '\n', 'utf-8');

      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      expect(toolCount(result, 'view_file')).toBe(1);
      expect(result.scanned.unparsableLines).toBe(0);
    });

    it('单行超过 8MB 缓冲上限 → 丢弃该行并计数，不 OOM、不崩溃（W-5）', async () => {
      mkdirSync(claudeDir, { recursive: true });
      // 🔴 这一行刻意是**合法且能统计出结果**的 JSON（9MB padding，不用真的 40MB —— 越过
      // 上限就走同一条分支）。用一条"本来就 parse 不了"的垃圾长行做 fixture 是测不出
      // 上限的：没有上限时它也会落进 unparsableLines，两种实现的观测值完全一样。
      const overlongRecord = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu-overlong',
              name: 'mcp__plugin_spectra_spectra__graph_node',
              input: { padding: 'x'.repeat(9 * 1024 * 1024) },
            },
          ],
        },
      };
      writeFileSync(
        join(claudeDir, 'huge.jsonl'),
        // 超长行**之后**紧跟一条正常记录：验证丢弃逻辑会一路丢到下一个换行符为止，
        // 而不是把残余当成新行反复计数、或把后续正常记录一起吃掉。
        `${JSON.stringify(overlongRecord)}\n${JSON.stringify(claudeToolUse('mcp__spectra__impact', 'tu-after'))}\n`,
        'utf-8',
      );

      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      // 上限生效：这一行根本没进 JSON.parse，那次 graph_node 调用因此统计不到
      expect(result.scanned.unparsableLines).toBe(1);
      expect(toolCount(result, 'graph_node')).toBe(0);
      // 超长行之后的正常记录仍被正确统计（残余没有污染后续行）
      expect(toolCount(result, 'impact')).toBe(1);
    }, 30_000);

    it('tool_use 缺 name 字段时跳过该块', async () => {
      writeJsonl(claudeDir, 'a.jsonl', [
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x' }] } },
      ]);
      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      expect(toolCount(result, 'unknown')).toBe(0);
    });
  });

  describe('去重与输出结构', () => {
    it('同一 callId 在多个文件中重复出现时只计一次', async () => {
      writeJsonl(claudeDir, 'a.jsonl', [claudeToolUse('mcp__spectra__impact', 'tu-dup')]);
      writeJsonl(claudeDir, 'b.jsonl', [claudeToolUse('mcp__spectra__impact', 'tu-dup')]);
      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      expect(toolCount(result, 'impact')).toBe(1);
    });

    it('输出满足 AdoptionCensusOutput schema', async () => {
      mkdirSync(claudeDir, { recursive: true });
      const result = await census({ claudeDir, codexDir });
      expect(typeof result.generatedAt).toBe('string');
      expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
      expect(result.sourceDirs).toEqual([claudeDir, codexDir]);
      expect(['found', 'not-found', 'empty']).toContain(result.sourceStatus);
      for (const tool of result.tools) {
        expect(typeof tool.name).toBe('string');
        expect(Number.isInteger(tool.callCount)).toBe(true);
      }
      expect(Array.isArray(result.zeroCallTools)).toBe(true);
      expect(result.zeroCallTools.every((n) => typeof n === 'string')).toBe(true);
    });

    it('输出里 unknownDetail 默认为 null，聚合计数恒在（W-4）', async () => {
      writeJsonl(claudeDir, 'a.jsonl', [
        claudeToolUse('mcp__acme_internal__lookup_customer', 'tu-1'),
        claudeToolUse('mcp__acme_internal__lookup_order', 'tu-2'),
        claudeToolUse('mcp__other__thing', 'tu-3'),
      ]);
      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      // 🔴 默认输出不含任何第三方工具名：扫描面是全机 transcript
      expect(result.unknownDetail).toBeNull();
      expect(JSON.stringify(result)).not.toContain('lookup_customer');
      // 但聚合计数必须在，否则"有没有 unknown"这件事也一起丢了
      expect(result.unknownCallCount).toBe(3);
      expect(result.unknownToolCount).toBe(3);
      expect(result.unknownServerCount).toBe(2);
      expect(toolCount(result, 'unknown')).toBe(3);
    });

    it('--verbose 下逐名清单出现，名字过白名单字符 + 64 截断并标注被改写（W-4）', async () => {
      const injected = 'mcp__evil__tool\n::warning::injected "quote"';
      const overlong = `mcp__long__${'a'.repeat(200)}`;
      writeJsonl(claudeDir, 'a.jsonl', [
        claudeToolUse(injected, 'tu-1'),
        claudeToolUse(overlong, 'tu-2'),
      ]);
      const result = await census({ claudeDir, codexDir: join(root, 'nope'), verbose: true });

      const names = detailOf(result).map((t) => t.name);
      // 控制字符 / 引号 / 冒号一律不成形
      expect(names.some((n) => n.includes('\n'))).toBe(false);
      expect(names.some((n) => n.includes('"'))).toBe(false);
      expect(names.some((n) => n.includes(':'))).toBe(false);
      for (const name of names) {
        expect(name).toMatch(/^[A-Za-z0-9_-]*$/);
        expect(name.length).toBeLessThanOrEqual(64);
      }
      // 被改写过的名字必须自报，不能装作原样
      expect(detailOf(result).every((t) => t.nameSanitized)).toBe(true);
      // 聚合计数与 verbose 与否无关
      expect(result.unknownCallCount).toBe(2);
    });

    it('🔴 `~` 相对化只作用于输出：家目录下的数据源仍被正常扫描（不因相对化而恒 not-found）', async () => {
      // os.homedir() 在 POSIX 上优先读 HOME，借此把临时目录临时当作家目录，
      // 从而在不碰真实 ~ 的前提下走到"数据源在家目录下"这条路径。
      const savedHome = process.env.HOME;
      process.env.HOME = root;
      try {
        writeJsonl(claudeDir, 'a.jsonl', [claudeToolUse('mcp__spectra__impact', 'tu-1')]);
        const result = await census({ claudeDir, codexDir });
        // 输出是相对形式……
        expect(result.sourceDirs[0]).toBe(join('~', 'claude-projects'));
        // ……但扫描用的仍是绝对路径：状态与计数都必须成立
        expect(result.sourceStatus).toBe('found');
        expect(toolCount(result, 'impact')).toBe(1);
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
      }
    });

    it('数据源路径与 stderr 提示走 `~` 相对形式，不吐家目录绝对路径（W-4）', async () => {
      const result = await census({
        claudeDir: join(homedir(), 'nonexistent-adoption-census-fixture'),
        codexDir: join(root, 'nope'),
      });
      expect(result.sourceDirs[0]).toBe(join('~', 'nonexistent-adoption-census-fixture'));
      expect(result.sourceDirs.join(' ')).not.toContain(homedir());
      // 家目录之外的路径保持原样（相对化不是无差别改写）
      expect(result.sourceDirs[1]).toBe(join(root, 'nope'));
    });

    it('zeroCallTools 只列已知工具，不含 unknown 桶', async () => {
      writeJsonl(claudeDir, 'a.jsonl', [claudeToolUse('mcp__spectra__impact', 'tu-1')]);
      const result = await census({ claudeDir, codexDir: join(root, 'nope') });
      expect(result.zeroCallTools).not.toContain('impact');
      expect(result.zeroCallTools).not.toContain('unknown');
      expect(result.zeroCallTools).toHaveLength(16);
    });
  });
});
