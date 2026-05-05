/**
 * Extractor stubs (Phase 4A 占位) 单测
 *
 * 验证 ts/go/java 三个 extractor stub 抛 not implemented 错误，让 vitest
 * coverage 95% per-file thresholds 实际生效（Codex CRITICAL 修订：避免 glob 空匹配）。
 *
 * Phase 4B (Java) / 4C (Go) / 4D (TS) 实现后此文件改为完整 case。
 */

import { describe, expect, it } from 'vitest';

describe('extractor stubs (Phase 4A)', () => {
  describe('ts-call-extractor', () => {
    it('throws not yet implemented (Phase 4D / T-013)', async () => {
      const { extractTsCallSites } = await import('../../../scripts/lib/ts-call-extractor.mjs');
      await expect(extractTsCallSites({ sourceRoot: '/tmp' })).rejects.toThrow(/not yet implemented.*Phase 4D/);
    });
  });

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
