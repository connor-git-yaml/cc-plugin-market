/**
 * F5 batch-orchestrator mode 分派单元测试（T-007）
 * 验证 runBatch() 的三处 mode 注入点行为
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BatchMode } from '../../src/panoramic/qa/types.js';

// ============================================================
// mode 校验逻辑（独立测试，不依赖文件系统）
// ============================================================

describe('runBatch mode 校验（FR-005）', () => {
  it('传入 undefined mode 不报错（默认 full）', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    // /nonexistent 会因路径不存在而失败，但不应因 mode 校验失败
    await expect(
      runBatch('/no-such-path-xyz-abc-123', { mode: undefined }),
    ).rejects.not.toThrow(/full \| reading \| code-only/);
  });

  it('传入 full 不报错', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    await expect(
      runBatch('/no-such-path-xyz-abc-123', { mode: 'full' }),
    ).rejects.not.toThrow(/full \| reading \| code-only/);
  });

  it('传入 reading 不报错', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    await expect(
      runBatch('/no-such-path-xyz-abc-123', { mode: 'reading' }),
    ).rejects.not.toThrow(/full \| reading \| code-only/);
  });

  it('传入 code-only 不报错', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    await expect(
      runBatch('/no-such-path-xyz-abc-123', { mode: 'code-only' }),
    ).rejects.not.toThrow(/full \| reading \| code-only/);
  });

  it('传入非法 mode 时抛出包含枚举值的错误（FR-005）', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    await expect(
      runBatch('/no-such-path-xyz-abc-123', { mode: 'invalid' as BatchMode }),
    ).rejects.toThrow(/full \| reading \| code-only/);
  });

  it('错误信息包含非法值本身', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    await expect(
      runBatch('/no-such-path-xyz-abc-123', { mode: 'speedy' as BatchMode }),
    ).rejects.toThrow(/speedy/);
  });
});
