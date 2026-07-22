/**
 * C2 接线兜底：`validateSpecDrift` 的未预期 reject MUST 收敛成 spec-drift 族的 error，
 * 而不是让整个 `repo:check` 吐栈——否则消费方连其余 12 族的结论都拿不到。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../scripts/lib/spec-drift-core.mjs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    validateSpecDrift: async () => {
      throw Object.assign(new Error('permission denied, open drift target'), { code: 'EACCES' });
    },
  };
});

// @ts-expect-error —— .mjs 治理脚本无类型声明
import { validateRepository } from '../../scripts/lib/repo-maintenance-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

interface Check {
  id: string;
  status: string;
  evidence: Record<string, unknown>;
}
interface ValidationResult {
  status: string;
  checks: Check[];
  warnings: string[];
  errors: string[];
}

describe('validateRepository —— spec-drift 族异常兜底', () => {
  it('validateSpecDrift reject 时不抛穿，整份报告仍可用且该族记为 error', async () => {
    const result = (await validateRepository(REPO_ROOT)) as ValidationResult;

    const drift = result.checks.filter((c) => c.id.startsWith('spec-drift:'));
    expect(drift).toHaveLength(1);
    expect(drift[0].id).toBe('spec-drift:anchors-status');
    expect(drift[0].status).toBe('fail');

    const messages = result.errors.filter((m) => m.startsWith('[spec-drift]'));
    expect(messages.join('\n')).toMatch(/permission denied/);
    expect(result.status).toBe('fail');

    // 其余检查族仍完整产出（不因 spec-drift 崩溃而丢失）
    expect(result.checks.filter((c) => !c.id.startsWith('spec-drift:')).length).toBeGreaterThan(10);
  }, 120_000);
});
