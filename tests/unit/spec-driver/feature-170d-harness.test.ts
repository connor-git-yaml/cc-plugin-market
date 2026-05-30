/**
 * F170d T001 — driver-eval-core 纯函数 + harness args/config builder 单测
 *
 * 这些是 sandbox 可跑的纯函数测试，是 US2（Primary Outcome）机制正确性的代理验证：
 * 不跑真实 LLM，但验证 harness 会用正确的 --append-system-prompt / production namespace /
 * 注入块 ⊆ allowedTools。真实 driver 行为测在 tests/e2e/（host-only，.skip）。
 *
 * RED：core / harness stub throw → 全红。GREEN：实现后转绿。
 */
import { describe, it, expect } from 'vitest';
import {
  parseToolEvents,
  computeMetrics,
  wilsonCI,
  renderInjectionBlock,
} from '../../../scripts/lib/driver-eval-core.mjs';
import {
  buildMcpConfig,
  buildClaudeArgs,
  assertInjectionSubsetOfAllowed,
} from '../../../scripts/feature-170d-driver-preference.mjs';
import { extractCanonicalBlock } from '../../../plugins/spec-driver/lib/preference-rules.mjs';

const IMPACT = 'mcp__plugin_spectra_spectra__impact';
const CONTEXT = 'mcp__plugin_spectra_spectra__context';
const DETECT = 'mcp__plugin_spectra_spectra__detect_changes';

// ---- 合成 stream-json 行 helpers ----
function toolUseLine(id: string, name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
}
function toolResultLine(id: string, isError: boolean, payloadObj: unknown): string {
  const text = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
  return JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text }] }] },
  });
}
const IMPACT_SUCCESS_PAYLOAD = {
  affected: [{ id: 'a' }],
  summary: { directCallers: 2, transitive: 5, riskTier: 'medium' },
  effectiveDirection: 'upstream',
  topImpacted: [{ id: 'a', score: 1 }],
  nextStepHint: 'consider context on a',
};

describe('F170d T001 — driver-eval-core 纯函数', () => {
  describe('parseToolEvents', () => {
    it('按出现顺序提取全部 tool_use + 关联 tool_result（不止 impact）', () => {
      const stdout = [
        toolUseLine('tu1', IMPACT, { target: 'src/a.ts::foo' }),
        toolResultLine('tu1', false, IMPACT_SUCCESS_PAYLOAD),
        toolUseLine('tu2', 'Grep', { pattern: 'foo' }),
      ].join('\n');
      const events = parseToolEvents(stdout);
      expect(events.toolUses.map((t: { name: string }) => t.name)).toEqual([IMPACT, 'Grep']);
      expect(events.toolUses[0].seq).toBeLessThan(events.toolUses[1].seq);
      const r = events.resultsById.get('tu1');
      expect(r.isError).toBe(false);
      expect(r.payload.effectiveDirection).toBe('upstream');
    });

    it('忽略非 JSON / 非 tool 事件行，不崩溃', () => {
      const stdout = ['not json', '', '{"type":"system"}', toolUseLine('x', 'Read', { file: 'a' })].join('\n');
      const events = parseToolEvents(stdout);
      expect(events.toolUses).toHaveLength(1);
      expect(events.toolUses[0].name).toBe('Read');
    });
  });

  describe('computeMetrics — 三层指标 + Active Call', () => {
    it('成功 impact success envelope → resolved + compliant', () => {
      const ev = parseToolEvents([
        toolUseLine('t', IMPACT, { target: 'src/a.ts::foo' }),
        toolResultLine('t', false, IMPACT_SUCCESS_PAYLOAD),
      ].join('\n'));
      const m = computeMetrics(ev);
      expect(m.impactAttempt).toBe(true);
      expect(m.impactResolvedSuccess).toBe(true);
      expect(m.isCompliant).toBe(true);
      expect(m.distinctActiveCallCount).toBe(1);
    });

    it('impact error envelope（含 code 字段）→ attempt 但非 resolved', () => {
      const ev = parseToolEvents([
        toolUseLine('t', IMPACT, { target: 'bad::x' }),
        toolResultLine('t', false, { code: 'invalid-target', message: 'nope' }),
      ].join('\n'));
      const m = computeMetrics(ev);
      expect(m.impactAttempt).toBe(true);
      expect(m.impactResolvedSuccess).toBe(false);
      expect(m.isCompliant).toBe(false);
    });

    it('impact 失败 → 失败 result 之后出现 Grep → fallbackAfterImpactFailure=true', () => {
      const ev = parseToolEvents([
        toolUseLine('t1', IMPACT, { target: 'x::y' }),
        toolResultLine('t1', true, { code: 'graph-not-built' }),
        toolUseLine('t2', 'Grep', { pattern: 'y' }),
      ].join('\n'));
      const m = computeMetrics(ev);
      expect(m.impactAttempt).toBe(true);
      expect(m.impactResolvedSuccess).toBe(false);
      expect(m.fallbackAfterImpactFailure).toBe(true);
      expect(m.grepCount).toBe(1);
    });

    it('Grep 出现在 impact 失败 result 之前 → 不算 fallback（因果顺序，codex C-1）', () => {
      // 顺序：impact tool_use → Grep tool_use → impact error result
      // Grep 早于"失败已知"时刻，不是对失败的回退
      const ev = parseToolEvents([
        toolUseLine('t1', IMPACT, { target: 'x::y' }),
        toolUseLine('g1', 'Grep', { pattern: 'y' }),
        toolResultLine('t1', true, { code: 'graph-not-built' }),
      ].join('\n'));
      const m = computeMetrics(ev);
      expect(m.impactResolvedSuccess).toBe(false);
      expect(m.fallbackAfterImpactFailure).toBe(false);
      expect(m.grepCount).toBe(1);
    });

    it('纯 Grep run → 无 impact attempt', () => {
      const ev = parseToolEvents([
        toolUseLine('g1', 'Grep', { pattern: 'a' }),
        toolUseLine('g2', 'Grep', { pattern: 'b' }),
      ].join('\n'));
      const m = computeMetrics(ev);
      expect(m.impactAttempt).toBe(false);
      expect(m.grepCount).toBe(2);
      expect(m.isCompliant).toBe(false);
    });

    it('同 target 重复 impact 仅计 1（distinct 去重）', () => {
      const ev = parseToolEvents([
        toolUseLine('t1', IMPACT, { target: 'src/a.ts::foo' }),
        toolResultLine('t1', false, IMPACT_SUCCESS_PAYLOAD),
        toolUseLine('t2', IMPACT, { target: 'src/a.ts::foo' }),
        toolResultLine('t2', false, IMPACT_SUCCESS_PAYLOAD),
      ].join('\n'));
      const m = computeMetrics(ev);
      expect(m.distinctActiveCallCount).toBe(1);
      expect(m.isCompliant).toBe(true);
    });

    it('impact success 缺关键字段（如缺 nextStepHint）→ 非 resolved', () => {
      const partial = { ...IMPACT_SUCCESS_PAYLOAD };
      delete (partial as Record<string, unknown>).nextStepHint;
      const ev = parseToolEvents([
        toolUseLine('t', IMPACT, { target: 'src/a.ts::foo' }),
        toolResultLine('t', false, partial),
      ].join('\n'));
      const m = computeMetrics(ev);
      expect(m.impactResolvedSuccess).toBe(false);
    });
  });

  describe('wilsonCI', () => {
    it('5/10 点估计 0.5，CI 在 (0,1) 内', () => {
      const ci = wilsonCI(5, 10);
      expect(ci.point).toBeCloseTo(0.5, 5);
      expect(ci.lower).toBeGreaterThan(0);
      expect(ci.upper).toBeLessThan(1);
    });
    it('0/10 点估计 0', () => {
      expect(wilsonCI(0, 10).point).toBe(0);
    });
  });

  describe('renderInjectionBlock — 纯函数按 tools 过滤（ruleId 不被 tool collide）', () => {
    // 合成 template（遵循 anchor 契约：ruleId 身份 + tool 过滤键）
    const TPL = [
      '## 工具优先使用规则（M7 F170d）',
      '',
      '当面对以下类任务时，**优先调用 spectra MCP 工具而非 Read/Grep**：',
      '',
      '| 任务关键词 | 优先工具 | 理由 |',
      '|---|---|---|',
      '<!-- preference-rules:R1 tool=impact -->',
      `| "找 caller" / "caller analysis" | \`${IMPACT}\` (direction=upstream) | transitive caller chain |`,
      '<!-- preference-rules:R2 tool=impact -->',
      `| "评估改动影响" / "blast radius" | \`${IMPACT}\` | BFS 受影响 symbol 列表 |`,
      '<!-- preference-rules:R3 tool=context -->',
      `| "找 callee" / "依赖什么" | \`${CONTEXT}\` | symbol 360° 上下文 |`,
      '<!-- preference-rules:R4 tool=detect_changes -->',
      `| "git diff 影响" / "PR review 范围" | \`${DETECT}\` | 从 diff 派生 changedSymbols |`,
      '<!-- /preference-rules:rows -->',
      '',
      '### 关键原则',
      '- **Grep 仍是 fallback**：MCP 不可用时退回 Grep',
      '- **不能省略调用**：不要因为觉得 Grep 够用跳过 MCP',
      '- **chained 使用**：detect_changes → impact → context',
      '- **不要 N+1**：单次 impact 即可拿到 BFS 全 list',
    ].join('\n');

    it('implement(impact+context) → R1+R2+R3，无 detect_changes，无 :: target', () => {
      const block = renderInjectionBlock(TPL, [IMPACT, CONTEXT]);
      expect(block).toContain(IMPACT);
      expect(block).toContain(CONTEXT);
      expect(block).not.toContain(DETECT);
      // R1 与 R2 同为 impact，两行都必须在（ruleId 不被 tool collide）
      expect(block).toContain('caller analysis');
      expect(block).toContain('blast radius');
      expect(block).not.toContain('::');
      expect(block).toContain('Grep 仍是 fallback');
    });

    it('verify(impact+detect_changes) → R1+R2+R4，无 context', () => {
      const block = renderInjectionBlock(TPL, [IMPACT, DETECT]);
      expect(block).toContain(IMPACT);
      expect(block).toContain(DETECT);
      expect(block).not.toContain(CONTEXT);
      expect(block).toContain('PR review 范围');
    });
  });

  describe('extractCanonicalBlock — fail-loud（codex C3）', () => {
    it('block-start 无 block-end → throw（拒绝静默截断到 EOF）', () => {
      const broken = '前言\n<!-- preference-rules:block-start -->\n## 规则\n（缺 block-end）\n更多文档';
      expect(() => extractCanonicalBlock(broken)).toThrow(/block-end/);
    });
    it('无 block-start → 原样返回（兼容仅传 block 内容）', () => {
      expect(extractCanonicalBlock('## 规则\n内容')).toContain('## 规则');
    });
    it('block-start + block-end → 仅取其间', () => {
      const t = 'doc\n<!-- preference-rules:block-start -->\nINNER\n<!-- preference-rules:block-end -->\nfooter';
      const b = extractCanonicalBlock(t);
      expect(b).toContain('INNER');
      expect(b).not.toContain('footer');
      expect(b).not.toContain('doc');
    });
  });
});

describe('F170d T001 — harness args/config builder（US2 机制代理测）', () => {
  it('buildMcpConfig server key = plugin_spectra_spectra + 可执行（node + dist/cli + mcp-server）', () => {
    const cfg = buildMcpConfig('/tmp/wt');
    expect(cfg.mcpServers).toHaveProperty('plugin_spectra_spectra');
    expect(cfg.mcpServers).not.toHaveProperty('spectra');
    // 防 false-green（codex C-2）：必须是可执行配置，而非最小空对象
    const server = cfg.mcpServers.plugin_spectra_spectra;
    expect(server.command).toBe('node');
    const argsJoined = (server.args ?? []).join(' ');
    expect(argsJoined).toContain('dist/cli/index.js');
    expect(argsJoined).toContain('mcp-server');
  });

  it('buildClaudeArgs 含完整可执行 flag 集 + --append-system-prompt 参数紧随其值', () => {
    const args = buildClaudeArgs('/tmp/wt', 'SYS PROMPT BLOCK');
    // 防 false-green（codex C-2）：必须含 170c 同款可执行 flag
    expect(args).toContain('--print');
    expect(args).toContain('--model');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--mcp-config');
    // 必须 --strict-mcp-config：屏蔽 ambient `spectra` server，否则 driver 调旧命名被拦截
    // （US2 实测发现 mcpCalls=0 + impactAttempt=true 的根因）
    expect(args).toContain('--strict-mcp-config');
    // --append-system-prompt 的值必须紧随其后（位置正确，非散落）
    const sysIdx = args.indexOf('--append-system-prompt');
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(args[sysIdx + 1]).toBe('SYS PROMPT BLOCK');
    // allowedTools = production namespace 三件套 + Read/Grep/Glob
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toContain(IMPACT);
    expect(allowed).toContain(CONTEXT);
    expect(allowed).toContain(DETECT);
    expect(allowed).toContain('Grep');
  });

  it('assertInjectionSubsetOfAllowed：块工具 ⊆ allowedTools 通过；越界 throw', () => {
    const allowed = [IMPACT, CONTEXT, 'Read', 'Grep', 'Glob'];
    expect(() => assertInjectionSubsetOfAllowed(`use \`${IMPACT}\` and \`${CONTEXT}\``, allowed)).not.toThrow();
    expect(() => assertInjectionSubsetOfAllowed(`use \`${DETECT}\``, allowed)).toThrow();
  });
});
