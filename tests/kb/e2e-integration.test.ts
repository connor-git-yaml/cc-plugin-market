/**
 * F190 T052 — E2E 集成路径（SC-001/003/004）
 * 模拟"安装 demo plugin → 经 KB MCP 查询 → 命中并引用来源文档"，中英双 plugin 各一条路径。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadKbContext } from '../../src/kb-mcp/lib/kb-locator.js';
import { executeKbSearch } from '../../src/kb-mcp/tools/kb-search.js';

const ROOT = process.cwd();

function parse(r: { content: Array<{ text: string }> }): any {
  return JSON.parse(r.content[0]!.text);
}

interface DemoCase {
  name: string;
  dir: string;
  query: string;
  expectDoc: string;
}

const CASES: DemoCase[] = [
  { name: 'demo-kb-en', dir: 'plugins/demo-kb-en', query: 'HTTPException', expectDoc: 'exception-error-handling.md' },
  { name: 'demo-kb-zh', dir: 'plugins/demo-kb-zh', query: '提示框', expectDoc: 'option-tooltip.md' },
];

describe('SC-001/003/004 — demo plugin 安装即用 E2E', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it('plugin.json 存在且为 test fixture', () => {
        const pj = JSON.parse(readFileSync(join(ROOT, c.dir, '.claude-plugin/plugin.json'), 'utf-8'));
        expect(pj.name).toBe(c.name);
        expect(pj._testOnly).toBe(true);
      });

      it('.mcp.json 经 spectra bin + ${CLAUDE_PLUGIN_ROOT} 启动（不用绝对路径/node 入口）', () => {
        const mcp = JSON.parse(readFileSync(join(ROOT, c.dir, '.mcp.json'), 'utf-8'));
        const server = Object.values(mcp.mcpServers)[0] as { command: string; args: string[] };
        expect(server.command).toBe('spectra');
        expect(server.args).toContain('serve');
        expect(server.args.join(' ')).toContain('${CLAUDE_PLUGIN_ROOT}/kb');
      });

      it('kb/ 产物随 plugin 分发（doc-graph.json + chunks.sqlite）', () => {
        expect(existsSync(join(ROOT, c.dir, 'kb/doc-graph.json'))).toBe(true);
        expect(existsSync(join(ROOT, c.dir, 'kb/chunks.sqlite'))).toBe(true);
      });

      it('加载厂商库 → kb_search 命中并带来源标注（source_kind/doc_id/built_at）', async () => {
        const loaded = await loadKbContext({ vendorKbPath: join(ROOT, c.dir, 'kb') });
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        const out = parse(executeKbSearch(loaded.context, { query: c.query }));
        expect(out.results.length).toBeGreaterThan(0);
        const hit = out.results.find((r: any) => r.doc_id === c.expectDoc);
        expect(hit, `期望命中 ${c.expectDoc}`).toBeTruthy();
        expect(hit.source_kind).toBe('vendor');
        expect(hit.built_at).toBeTruthy();
        expect(hit.content).toContain('[KB-EVIDENCE'); // 带来源 envelope
      });
    });
  }
});
