/**
 * F192 T021 — 真实 demo KB（marketplace 分发产物）的 kb_api_lookup E2E（W-6 真实三件套）。
 * 校验 demo-kb-{zh,en}/kb 含 api-entities 且 kb_api_lookup 正常 + 诚实边界 + not_found。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadKbContext } from '../../src/kb-mcp/lib/kb-locator.js';
import { executeKbApiLookup } from '../../src/kb-mcp/tools/kb-api-lookup.js';

function parse(res: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(res.content[0]!.text);
}

describe.each(['demo-kb-en', 'demo-kb-zh'])('真实 demo KB（%s）kb_api_lookup', (plugin) => {
  const vendorKbPath = `plugins/${plugin}/kb`;

  it('api-entities 已加载（FR-019：demo 含实体层）', async () => {
    const r = await loadKbContext({ vendorKbPath });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.context.vendor?.entities).not.toBeNull();
      expect((r.context.vendor?.entities?.entities.length ?? 0)).toBeGreaterThan(0);
      expect(r.context.vendor?.entities?.sourceKind).toBe('vendor');
    }
  });

  it('查询返回良构响应 + 诚实边界（无代码级断言词）', async () => {
    const r = await loadKbContext({ vendorKbPath });
    if (!r.ok) throw new Error('load failed');
    // 取实体表里真实存在的一个 name 来查（确保 total_found>0 且走匹配路径）
    const sample = r.context.vendor!.entities!.entities[0]!.name;
    const out = parse(executeKbApiLookup(r.context, { api_name: sample, top_n: 3 }));
    expect((out['results'] as unknown[]).length).toBeGreaterThan(0);
    expect(out['evidence_note']).toContain('evidence-grade');
    expect(JSON.stringify(out)).not.toMatch(/已验证|verified|保证存在/);
  });

  it('查无实体 → not_found，不编造', async () => {
    const r = await loadKbContext({ vendorKbPath });
    if (!r.ok) throw new Error('load failed');
    const out = parse(executeKbApiLookup(r.context, { api_name: 'definitelyNotAnApiXyz123' }));
    expect(out['not_found']).toBe(true);
  });

  it('FIXTURE.json 源清单：每条 source 有 license 或 synthetic（W-6 通用定位机械校验）', () => {
    const m = JSON.parse(readFileSync(`${vendorKbPath.replace('/kb', '')}/FIXTURE.json`, 'utf-8')) as {
      sources: Array<{ id: string; license: string | null; synthetic: boolean }>;
    };
    expect(m.sources.length).toBeGreaterThan(0);
    for (const s of m.sources) {
      const hasLicense = typeof s.license === 'string' && s.license.trim().length > 0;
      expect(hasLicense || s.synthetic === true, `source ${s.id} 缺有效 license 且非 synthetic（空串不算）`).toBe(true);
    }
  });
});
