/**
 * F170d T002 — 静态结构测（SC-001 / SC-005 / SC-006 / SC-008 机械化守护）
 *
 * 全部 sandbox 可跑，不依赖 LLM / dist / graph。期望从 template（单一事实源）+ agent
 * frontmatter 派生，避免硬编码漂移。
 *
 * RED：template / marker 块未建 → 断言失败（防御式读，非 collect 崩溃）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PLUGIN = path.join(ROOT, 'plugins/spec-driver');
const TEMPLATE = path.join(PLUGIN, 'templates/preference-rules.md');

const NS = 'mcp__plugin_spectra_spectra__';
const ANCHOR_PHRASE = '优先调用 spectra MCP 工具';
const BEGIN = '<!-- BEGIN preference-rules';
const END = '<!-- END preference-rules -->';

// US1 矩阵：agent → 期望命中的 toolKey（impact 含 R1/R2 两行）
const AGENT_TOOLKEYS: Record<string, string[]> = {
  plan: ['impact', 'context'],
  implement: ['impact', 'context'],
  'spec-review': ['impact', 'context'],
  'quality-review': ['impact', 'context'],
  verify: ['impact', 'detect_changes'],
};

const SKILLS = [
  'spec-driver-feature',
  'spec-driver-story',
  'spec-driver-fix',
  'spec-driver-refactor',
  'spec-driver-implement',
];

function readOrEmpty(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}
function agentPath(name: string): string {
  return path.join(PLUGIN, 'agents', `${name}.md`);
}
function skillPath(name: string): string {
  return path.join(PLUGIN, 'skills', name, 'SKILL.md');
}

/** 解析 template anchor → ruleId → { tool, rowText }（rowText = anchor 下一行表格行）。 */
function parseTemplateRules(tpl: string): Map<string, { tool: string; rowText: string }> {
  const map = new Map<string, { tool: string; rowText: string }>();
  const lines = tpl.split('\n');
  const re = /<!--\s*preference-rules:(R\d)\s+tool=([a-z_]+)\s*-->/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) {
      const rowText = (lines[i + 1] ?? '').trim();
      map.set(m[1], { tool: m[2], rowText });
    }
  }
  return map;
}
function extractBlock(agentText: string): string {
  const b = agentText.indexOf(BEGIN);
  const e = agentText.indexOf(END);
  if (b < 0 || e < 0 || e < b) return '';
  return agentText.slice(b, e + END.length);
}
/** 解析 frontmatter tools: 行中的 mcp__plugin_spectra_spectra__X，返回 toolKey 集合。 */
function parseFrontmatterToolKeys(agentText: string): Set<string> {
  const m = agentText.match(/^tools:\s*\[(.*)\]/m);
  const keys = new Set<string>();
  if (!m) return keys;
  const re = new RegExp(`${NS.replace(/_/g, '_')}(\\w+)`, 'g');
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(m[1])) !== null) keys.add(mm[1]);
  return keys;
}

describe('F170d SC-001 — 5 agent 含按 tools 过滤的工具优先使用规则块', () => {
  for (const [agent, toolKeys] of Object.entries(AGENT_TOOLKEYS)) {
    it(`${agent}.md 含 marker 块 + anchor 短语 + 关键原则`, () => {
      const text = readOrEmpty(agentPath(agent));
      expect(text).toContain(BEGIN);
      expect(text).toContain(END);
      const block = extractBlock(text);
      expect(block).toContain(ANCHOR_PHRASE);
      expect(block).toContain('### 关键原则');
      expect(block).toContain('Grep 仍是 fallback');
      // 命中 toolKey 的 fully-qualified 名应出现
      for (const k of toolKeys) expect(block).toContain(`${NS}${k}`);
    });
  }
});

describe('F170d SC-006 — 块内容与 template 单一源一致（按 ruleId 比对）+ 工具 ⊆ frontmatter', () => {
  it('template 存在且含 R1-R4 anchor', () => {
    const tpl = readOrEmpty(TEMPLATE);
    const rules = parseTemplateRules(tpl);
    expect([...rules.keys()].sort()).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(rules.get('R1')!.tool).toBe('impact');
    expect(rules.get('R2')!.tool).toBe('impact');
    expect(rules.get('R3')!.tool).toBe('context');
    expect(rules.get('R4')!.tool).toBe('detect_changes');
  });

  for (const [agent, toolKeys] of Object.entries(AGENT_TOOLKEYS)) {
    it(`${agent}.md 块的 R 行按 ruleId == template，且工具 ⊆ frontmatter tools`, () => {
      const tpl = readOrEmpty(TEMPLATE);
      const rules = parseTemplateRules(tpl);
      const block = extractBlock(readOrEmpty(agentPath(agent)));
      // 防御 false-green（codex W-1）：template 与 agent 块必须非空，否则下方循环空跑误判通过
      expect(rules.size, 'template 未建或无 anchor').toBeGreaterThanOrEqual(4);
      expect(block, `${agent} 未注入 preference-rules 块`).not.toBe('');
      // 期望 ruleId = tool ∈ toolKeys 的所有规则（R1/R2 同 impact 都要在）
      const expectedRuleIds = [...rules.entries()]
        .filter(([, v]) => toolKeys.includes(v.tool))
        .map(([id]) => id);
      expect(expectedRuleIds.length, '期望 ruleId 集为空').toBeGreaterThan(0);
      for (const id of expectedRuleIds) {
        expect(block, `${agent} 缺 ${id} 行`).toContain(rules.get(id)!.rowText);
      }
      // 非命中 tool 的 fully-qualified 名不得出现
      const allKeys = ['impact', 'context', 'detect_changes'];
      for (const k of allKeys.filter((x) => !toolKeys.includes(x))) {
        expect(block, `${agent} 不应含 ${k}`).not.toContain(`${NS}${k}`);
      }
      // 工具 ⊆ frontmatter tools
      const fmKeys = parseFrontmatterToolKeys(readOrEmpty(agentPath(agent)));
      for (const k of toolKeys) expect(fmKeys.has(k), `${agent} frontmatter 缺 ${k}`).toBe(true);
      // 无 target 泄漏
      expect(block).not.toContain('::');
    });
  }
});

/** 提取以 `## 子代理调度时的工具优先级提示` 起、到下个 `## ` 标题止的 section 文本。 */
function extractHintSection(skillText: string): string {
  const lines = skillText.split('\n');
  const start = lines.findIndex((l) => /^##\s+子代理调度时的工具优先级提示/.test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

describe('F170d SC-005 — 5 SKILL.md 含子代理调度优先级提示块（块内含内容，防关键词 stuffing）', () => {
  for (const skill of SKILLS) {
    it(`${skill}/SKILL.md 提示块存在 + 块内引用 template 路径 + namespace + 优先语义`, () => {
      const text = readOrEmpty(skillPath(skill));
      const section = extractHintSection(text);
      // 防 false-green（codex W-1）：内容必须在提示块 section 内，而非全文件任意位置
      expect(section, `${skill} 缺「子代理调度时的工具优先级提示」section`).not.toBe('');
      expect(section).toContain('templates/preference-rules.md');
      expect(section).toContain(NS);
      expect(section).toContain('优先');
      // section 必须邻近 dispatch/委派 语义（同文件含委派子代理说明）
      expect(text).toMatch(/委派|Task\(|子代理/);
    });
  }
});

describe('F170d SC-008 — frontmatter tools 冻结守护（不被 sync 误改）', () => {
  // 冻结期望（F170a 对齐后的 MCP 工具集，order-insensitive）
  const FROZEN: Record<string, string[]> = {
    plan: ['context', 'impact'],
    implement: ['context', 'impact'],
    verify: ['detect_changes', 'impact'],
    'spec-review': ['impact', 'context'],
    'quality-review': ['impact', 'context'],
  };
  for (const [agent, expected] of Object.entries(FROZEN)) {
    it(`${agent}.md frontmatter MCP 工具集未变`, () => {
      const keys = [...parseFrontmatterToolKeys(readOrEmpty(agentPath(agent)))].sort();
      expect(keys).toEqual([...expected].sort());
    });
  }
});
