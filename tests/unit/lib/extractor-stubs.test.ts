/**
 * Extractor stubs 单测（Phase 4A 占位）
 *
 * Phase 4D 已交付 TS extractor 真实实现（详见 tests/unit/lib/ts-call-extractor.test.ts），
 * 此文件保留 go / java 两个 stub 单测，让 vitest coverage 95% per-file thresholds
 * 在 Phase 4B/4C 仍未实现时仍能命中（避免 glob 空匹配）。
 *
 * Phase 4B (Java T-006) / 4C (Go T-010) 实现后此文件可清空或合并到对应 *.test.ts。
 */

import { describe, expect, it } from 'vitest';

describe('extractor stubs (Phase 4A 残留 — go/java)', () => {
  describe('go-call-extractor', () => {
    it('throws not yet implemented (Phase 4C / T-010)', async () => {
      const { extractGoCallSites } = await import('../../../scripts/lib/go-call-extractor.mjs');
      await expect(extractGoCallSites({ sourceRoot: '/tmp' })).rejects.toThrow(/not yet implemented.*Phase 4C/);
    });
  });

  describe('java-call-extractor', () => {
    it('throws not yet implemented (Phase 4B / T-006)', async () => {
      const { extractJavaCallSites } = await import('../../../scripts/lib/java-call-extractor.mjs');
      await expect(extractJavaCallSites({ sourceRoot: '/tmp' })).rejects.toThrow(/not yet implemented.*Phase 4B/);
    });
  });
});
